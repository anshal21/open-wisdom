// Package pyrun executes a notebook's Python cell.
//
// # What this is, and what it is not
//
// A Python cell is the one place in this product where a figure can appear
// that the verification engine never saw. That is why every result here is
// stamped `unverified` unconditionally, and why the isolation story has to be
// stated plainly rather than implied by the word "sandbox".
//
// ALWAYS ENFORCED:
//   - Wall-clock timeout. On Unix the whole process GROUP is killed, so a
//     script that spawns children cannot outlive its cell. Off Unix only the
//     interpreter itself is killed. This is the backstop that holds even when
//     every rlimit below is unavailable.
//   - A fresh temporary working directory per run, removed afterwards.
//   - A stripped environment: the interpreter sees PATH, HOME and nothing
//     else. The parent's env holds API keys and must never cross this line.
//   - Captured stdout/stderr are truncated, so `while True: print(1)` fills a
//     buffer of known size instead of the machine's memory.
//
// ENFORCED WHERE THE OS ALLOWS — verify, do not assume:
//
//   - Address space (RLIMIT_AS), CPU seconds (RLIMIT_CPU) and process count
//     (RLIMIT_NPROC), applied by the child to itself via preamble.go with soft
//     AND hard limits set so a script cannot raise them back.
//
//     These are NOT portable. **macOS does not implement RLIMIT_AS at all** —
//     `ulimit -v` fails with EINVAL — so on a Mac the memory cap does not
//     exist and a cell can allocate until the machine swaps. Linux enforces
//     it. Rather than guess, every run reports which caps the kernel actually
//     accepted in Result.LimitsApplied; read that before stating a guarantee.
//
// NOT ENFORCED — read this before running untrusted code:
//   - Network access. A script can open sockets, exfiltrate anything it can
//     read, and fetch anything it likes.
//   - Filesystem reads outside the working directory. The whole disk is
//     readable as the server's user, including this product's SQLite store.
//   - Writes outside the working directory, subject to the same user's
//     permissions.
//   - Process/user isolation of any kind. There is no container, no namespace,
//     no seccomp filter, no separate uid.
//
// This is resource isolation, not a security boundary. It is appropriate for a
// single-tenant local install where the person writing the Python already has
// a shell on the box. It is NOT sufficient for multi-tenant hosting; that
// needs a container or VM per run, and this package should be replaced rather
// than extended when that day comes.
package pyrun

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"time"
)

// Config controls the runner. Zero values are replaced by the defaults below,
// so a partially-populated Config is still safe.
type Config struct {
	// Enabled gates the whole feature. When false, running a Python cell
	// reports that it is switched off rather than pretending to execute.
	Enabled bool
	// Interpreter is the python binary to invoke. Looked up on PATH.
	Interpreter string
	// Timeout bounds wall-clock time for one run.
	Timeout time.Duration
	// MemoryBytes caps the child's address space (RLIMIT_AS).
	MemoryBytes uint64
	// MaxOutputBytes caps captured stdout and stderr, each independently.
	MaxOutputBytes int
}

// Defaults are deliberately conservative: a notebook cell is an interactive
// thing, and a run that needs more than ten seconds or half a gigabyte wants a
// SQL cell or a real pipeline, not a text box in a browser.
const (
	DefaultInterpreter    = "python3"
	DefaultTimeout        = 10 * time.Second
	DefaultMemoryBytes    = 512 << 20 // 512 MiB
	DefaultMaxOutputBytes = 256 << 10 // 256 KiB
)

func (c Config) withDefaults() Config {
	if c.Interpreter == "" {
		c.Interpreter = DefaultInterpreter
	}
	if c.Timeout <= 0 {
		c.Timeout = DefaultTimeout
	}
	if c.MemoryBytes == 0 {
		c.MemoryBytes = DefaultMemoryBytes
	}
	if c.MaxOutputBytes <= 0 {
		c.MaxOutputBytes = DefaultMaxOutputBytes
	}
	return c
}

// OutputFile is the filename a script writes in its working directory to
// return a table. Anything else it prints is stdout.
const OutputFile = "output.json"

// Result is one run. Err is a plain-English description of why the script
// failed; a failing script is a normal outcome of editing a notebook, so the
// caller reports it as a 200 with this field set rather than as a 5xx.
type Result struct {
	Stdout   string
	Stderr   string
	Table    *Table
	ExitCode int
	Err      string
	// LimitsApplied names the resource caps the OS actually accepted, as
	// reported by the child itself — "memory", "cpu", "processes". A cap this
	// runner asked for and did not get is absent here. Callers that need to
	// state a guarantee must read this rather than trust the Config.
	LimitsApplied []string
}

// Applied reports whether a named cap took effect on this run.
func (r *Result) Applied(limit string) bool {
	for _, l := range r.LimitsApplied {
		if l == limit {
			return true
		}
	}
	return false
}

// Table is the structured result convention: a script that writes
// output.json with these keys gets rendered as a table beside its stdout.
type Table struct {
	Columns []Column `json:"columns"`
	Rows    [][]any  `json:"rows"`
}

// Column mirrors the shape every other surface uses for a result column.
type Column struct {
	Name  string `json:"name"`
	Label string `json:"label"`
	Type  string `json:"type"`
}

// Runner executes Python cells under Config.
type Runner struct{ cfg Config }

// New builds a Runner. Call it once and share it; there is no per-run state.
func New(cfg Config) *Runner { return &Runner{cfg: cfg.withDefaults()} }

// Enabled reports whether Python execution is switched on.
func (r *Runner) Enabled() bool { return r.cfg.Enabled }

// ErrDisabled is returned when Python execution is switched off.
var ErrDisabled = errors.New("python execution is disabled")

// Run executes source and returns what it produced.
//
// An error is returned only when the RUNNER failed — a temp dir that cannot be
// created, an interpreter that is not installed. A script that raises, loops
// forever, or exits non-zero is a successful run of a broken script: that
// comes back in Result.Err with the output captured.
func (r *Runner) Run(ctx context.Context, source string) (*Result, error) {
	if !r.cfg.Enabled {
		return nil, ErrDisabled
	}

	bin, err := exec.LookPath(r.cfg.Interpreter)
	if err != nil {
		return nil, fmt.Errorf("python interpreter %q not found: %w", r.cfg.Interpreter, err)
	}

	dir, err := os.MkdirTemp("", "analyst-py-*")
	if err != nil {
		return nil, fmt.Errorf("create work dir: %w", err)
	}
	defer os.RemoveAll(dir)

	// The caps ride in with the script: the child applies them to itself
	// before a line of user code runs.
	cpuSeconds := int(r.cfg.Timeout.Seconds()) + 1
	script := filepath.Join(dir, "cell.py")
	body := preamble(r.cfg.MemoryBytes, cpuSeconds) + source
	if err := os.WriteFile(script, []byte(body), 0o600); err != nil {
		return nil, fmt.Errorf("write cell script: %w", err)
	}

	runCtx, cancel := context.WithTimeout(ctx, r.cfg.Timeout)
	defer cancel()

	// -I is isolated mode: ignores PYTHON* env vars and keeps the user's
	// site-packages and cwd off sys.path, so a run cannot be steered by
	// anything left lying around in the server's home directory.
	cmd := exec.Command(bin, "-I", script)
	cmd.Dir = dir
	// A stripped environment. The parent's holds model API keys; inheriting it
	// would hand every notebook author the workspace's credentials.
	cmd.Env = []string{
		"PATH=/usr/bin:/bin:/usr/local/bin",
		"HOME=" + dir,
		"PYTHONDONTWRITEBYTECODE=1",
		"PYTHONUNBUFFERED=1",
	}
	var stdout, stderr cappedBuffer
	stdout.limit = r.cfg.MaxOutputBytes
	stderr.limit = r.cfg.MaxOutputBytes
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	applyLimits(cmd, r.cfg.MemoryBytes)

	if err := cmd.Start(); err != nil {
		return nil, fmt.Errorf("start python: %w", err)
	}

	// Wait in the background so the timeout can kill the whole process group.
	// cmd.Wait alone would return when the parent dies while orphaned children
	// keep the CPU; killing the group is what makes the timeout mean something.
	done := make(chan error, 1)
	go func() { done <- cmd.Wait() }()

	var waitErr error
	timedOut := false
	select {
	case waitErr = <-done:
	case <-runCtx.Done():
		timedOut = errors.Is(runCtx.Err(), context.DeadlineExceeded)
		killGroup(cmd)
		waitErr = <-done
	}

	// Tracebacks are rewritten so line numbers point at the user's code, not
	// at their code plus a preamble they never wrote.
	res := &Result{
		Stdout: stdout.String(),
		Stderr: rewriteTraceback(stderr.String(), script),
	}
	if stdout.truncated {
		res.Stdout += "\n… output truncated"
	}
	if stderr.truncated {
		res.Stderr += "\n… output truncated"
	}

	switch {
	case timedOut:
		res.ExitCode = -1
		res.Err = fmt.Sprintf("The cell ran longer than %s and was stopped.", r.cfg.Timeout)
	case waitErr != nil:
		var ee *exec.ExitError
		if errors.As(waitErr, &ee) {
			res.ExitCode = ee.ExitCode()
			res.Err = "The script exited with an error. See the output below."
		} else {
			return nil, fmt.Errorf("run python: %w", waitErr)
		}
	}

	// The table convention is honoured even for a failing script: a cell that
	// wrote its result and then raised on cleanup still produced the result.
	if t := readTable(filepath.Join(dir, OutputFile)); t != nil {
		res.Table = t
	}
	res.LimitsApplied = readLimits(filepath.Join(dir, LimitsFile))
	return res, nil
}

// readTable loads the output.json convention. A malformed or absent file is
// simply not a table — a script is never failed for the shape of a file it
// may not have meant to write.
func readTable(path string) *Table {
	b, err := os.ReadFile(path)
	if err != nil {
		return nil
	}
	var t Table
	if err := json.Unmarshal(b, &t); err != nil {
		return nil
	}
	if len(t.Columns) == 0 {
		return nil
	}
	for i := range t.Columns {
		if t.Columns[i].Label == "" {
			t.Columns[i].Label = t.Columns[i].Name
		}
		if t.Columns[i].Type == "" {
			t.Columns[i].Type = "nominal"
		}
	}
	return &t
}

// readLimits loads the caps the child reported applying. An unreadable file
// means none were applied — the safe reading, since it never claims a
// guarantee that may not hold.
func readLimits(path string) []string {
	b, err := os.ReadFile(path)
	if err != nil {
		return nil
	}
	var out []string
	if err := json.Unmarshal(b, &out); err != nil {
		return nil
	}
	return out
}

// cappedBuffer keeps at most limit bytes and remembers that it dropped some.
// A runaway print loop is a bounded annoyance rather than an OOM.
type cappedBuffer struct {
	buf       bytes.Buffer
	limit     int
	truncated bool
}

func (c *cappedBuffer) Write(p []byte) (int, error) {
	if room := c.limit - c.buf.Len(); room > 0 {
		if len(p) <= room {
			c.buf.Write(p)
		} else {
			c.buf.Write(p[:room])
			c.truncated = true
		}
	} else if len(p) > 0 {
		c.truncated = true
	}
	// Report the full length: the child must believe its write succeeded, or
	// python raises BrokenPipeError and the failure looks like the script's.
	return len(p), nil
}

func (c *cappedBuffer) String() string { return c.buf.String() }
