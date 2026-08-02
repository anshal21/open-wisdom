package pyrun

import (
	"context"
	"fmt"
	"os/exec"
	"runtime"
	"strings"
	"testing"
	"time"
)

// requirePython skips rather than fails when the box has no interpreter: the
// runner's contract is "python if present", and a CI image without it should
// not turn the whole suite red.
func requirePython(t *testing.T) {
	t.Helper()
	if _, err := exec.LookPath(DefaultInterpreter); err != nil {
		t.Skipf("no %s on PATH", DefaultInterpreter)
	}
}

func testRunner(t *testing.T, timeout time.Duration) *Runner {
	t.Helper()
	return New(Config{Enabled: true, Timeout: timeout})
}

func TestDisabledRunnerRefuses(t *testing.T) {
	r := New(Config{Enabled: false})
	if _, err := r.Run(context.Background(), "print(1)"); err != ErrDisabled {
		t.Errorf("got %v, want ErrDisabled", err)
	}
}

func TestCapturesStdout(t *testing.T) {
	requirePython(t)
	res, err := testRunner(t, 10*time.Second).Run(context.Background(), "print('hello')")
	if err != nil {
		t.Fatalf("run: %v", err)
	}
	if !strings.Contains(res.Stdout, "hello") {
		t.Errorf("stdout = %q, want it to contain hello", res.Stdout)
	}
	if res.Err != "" {
		t.Errorf("a clean script must report no error, got %q", res.Err)
	}
}

// A script that never returns must be stopped and reported as stopped — the
// single most important guarantee here, since a notebook cell is a text box
// anyone can type `while True:` into.
func TestTimeoutStopsRunawayScript(t *testing.T) {
	requirePython(t)
	start := time.Now()
	res, err := testRunner(t, 1*time.Second).Run(context.Background(), "while True:\n    pass\n")
	if err != nil {
		t.Fatalf("run: %v", err)
	}
	if elapsed := time.Since(start); elapsed > 5*time.Second {
		t.Errorf("took %s — the timeout did not stop it", elapsed)
	}
	if !strings.Contains(res.Err, "stopped") {
		t.Errorf("err = %q, want it to say the cell was stopped", res.Err)
	}
}

// A raising script is a normal outcome, not a runner failure.
func TestFailingScriptIsNotARunnerError(t *testing.T) {
	requirePython(t)
	res, err := testRunner(t, 10*time.Second).Run(context.Background(), "raise ValueError('boom')")
	if err != nil {
		t.Fatalf("a script that raises must not fail the runner: %v", err)
	}
	if res.Err == "" {
		t.Error("want an error message describing the failure")
	}
	if !strings.Contains(res.Stderr, "boom") {
		t.Errorf("stderr = %q, want the traceback", res.Stderr)
	}
	if res.ExitCode == 0 {
		t.Error("want a non-zero exit code")
	}
}

// The traceback must point at the line the user typed, not at their line plus
// the preamble's height.
func TestTracebackLineNumbersMatchUserSource(t *testing.T) {
	requirePython(t)
	// The raise is on line 2 of what the user wrote.
	res, err := testRunner(t, 10*time.Second).Run(context.Background(), "x = 1\nraise ValueError('boom')\n")
	if err != nil {
		t.Fatalf("run: %v", err)
	}
	if !strings.Contains(res.Stderr, "line 2") {
		t.Errorf("stderr = %q, want it to blame line 2 of the user's source", res.Stderr)
	}
}

// The output.json convention turns a script into a table.
func TestOutputJSONBecomesTable(t *testing.T) {
	requirePython(t)
	src := `import json
json.dump({"columns":[{"name":"n","type":"quantitative"}],"rows":[[1],[2]]}, open("output.json","w"))
print("done")`
	res, err := testRunner(t, 10*time.Second).Run(context.Background(), src)
	if err != nil {
		t.Fatalf("run: %v", err)
	}
	if res.Table == nil {
		t.Fatalf("want a table from output.json; stdout=%q stderr=%q", res.Stdout, res.Stderr)
	}
	if len(res.Table.Rows) != 2 {
		t.Errorf("rows = %d, want 2", len(res.Table.Rows))
	}
	if res.Table.Columns[0].Label != "n" {
		t.Errorf("an absent label must default to the name, got %q", res.Table.Columns[0].Label)
	}
}

// Malformed output.json is not a table and not a failure — a script may write
// that filename for its own reasons.
func TestMalformedOutputJSONIsIgnored(t *testing.T) {
	requirePython(t)
	res, err := testRunner(t, 10*time.Second).Run(context.Background(),
		`open("output.json","w").write("not json")`)
	if err != nil {
		t.Fatalf("run: %v", err)
	}
	if res.Table != nil {
		t.Error("malformed output.json must not produce a table")
	}
	if res.Err != "" {
		t.Errorf("and must not fail the run, got %q", res.Err)
	}
}

// The parent's environment holds model API keys. A cell must not see them.
func TestEnvironmentIsStripped(t *testing.T) {
	requirePython(t)
	t.Setenv("ANALYST_SECRET_TOKEN", "super-secret-value")
	res, err := testRunner(t, 10*time.Second).Run(context.Background(),
		"import os; print(os.environ.get('ANALYST_SECRET_TOKEN', 'ABSENT'))")
	if err != nil {
		t.Fatalf("run: %v", err)
	}
	if strings.Contains(res.Stdout, "super-secret-value") {
		t.Fatal("the parent environment leaked into a python cell")
	}
	if !strings.Contains(res.Stdout, "ABSENT") {
		t.Errorf("stdout = %q, want ABSENT", res.Stdout)
	}
}

// Captured output is bounded, so a print loop is an annoyance and not an OOM.
func TestOutputIsTruncated(t *testing.T) {
	requirePython(t)
	r := New(Config{Enabled: true, Timeout: 10 * time.Second, MaxOutputBytes: 1024})
	res, err := r.Run(context.Background(), "for _ in range(100000):\n    print('x' * 80)\n")
	if err != nil {
		t.Fatalf("run: %v", err)
	}
	if len(res.Stdout) > 4096 {
		t.Errorf("stdout kept %d bytes despite a 1KiB cap", len(res.Stdout))
	}
	if !strings.Contains(res.Stdout, "truncated") {
		t.Error("truncation must be visible in the output, not silent")
	}
}

// The memory cap is applied by the child to itself, and RLIMIT_AS does not
// exist on every platform — macOS has no implementation of it. The contract
// this test defends is therefore not "memory is always capped" but "the runner
// never claims a cap it did not get": where the OS accepted the limit it must
// actually bite, and where it did not, LimitsApplied must say so.
func TestMemoryCapIsEnforcedWhereTheOSAllows(t *testing.T) {
	requirePython(t)
	r := New(Config{Enabled: true, Timeout: 20 * time.Second, MemoryBytes: 64 << 20})
	res, err := r.Run(context.Background(), "x = bytearray(512 * 1024 * 1024)\nprint('allocated')")
	if err != nil {
		t.Fatalf("run: %v", err)
	}
	allocated := strings.Contains(res.Stdout, "allocated")

	if res.Applied("memory") {
		if allocated {
			t.Error("the runner reported a memory cap that did not hold — worse than no cap")
		}
		return
	}
	// No cap available here. Say so loudly rather than passing in silence:
	// anyone reading this run's output must not infer a guarantee.
	t.Logf("RLIMIT_AS unavailable on %s — memory is NOT capped; limits applied: %v",
		runtime.GOOS, res.LimitsApplied)
	if !allocated {
		t.Log("allocation failed anyway, but not because of a limit this runner set")
	}
}

// Whatever the platform, the runner must not report a cap it never obtained.
func TestLimitsAppliedReportsOnlyRealCaps(t *testing.T) {
	requirePython(t)
	res, err := testRunner(t, 10*time.Second).Run(context.Background(), "print('ok')")
	if err != nil {
		t.Fatalf("run: %v", err)
	}
	for _, l := range res.LimitsApplied {
		switch l {
		case "memory", "cpu", "processes":
		default:
			t.Errorf("unknown limit reported: %q", l)
		}
	}
	if runtime.GOOS == "darwin" && res.Applied("memory") {
		t.Error("macOS has no RLIMIT_AS; reporting a memory cap here is a false guarantee")
	}
}

// The preamble's height must not depend on the values interpolated into it,
// or the traceback offset would vary with the configured limits.
func TestPreambleHeightIsStable(t *testing.T) {
	a := strings.Count(preamble(1<<20, 5), "\n")
	b := strings.Count(preamble(999<<20, 3600), "\n")
	if a != b || a != preambleLines {
		t.Errorf("preamble height varies: %d vs %d, constant says %d", a, b, preambleLines)
	}
}

func TestRewriteTracebackShiftsByPreambleHeight(t *testing.T) {
	// A frame at preambleLines+2 is the user's line 2.
	raw := fmt.Sprintf("Traceback (most recent call last):\n  File \"/tmp/x/cell.py\", line %d, in <module>\nValueError: boom",
		preambleLines+2)
	got := rewriteTraceback(raw, "/tmp/x/cell.py")
	if !strings.Contains(got, "line 2,") {
		t.Errorf("got %q, want the frame rewritten to line 2", got)
	}
	if !strings.Contains(got, "ValueError: boom") {
		t.Error("the message itself must survive rewriting")
	}
	if strings.Contains(got, "/tmp/x/cell.py") {
		t.Error("the temp path must be replaced with cell.py — the user never saw /tmp")
	}
}

// A frame inside the preamble maps to no user line and must be left alone
// rather than rewritten to a number that points at nothing.
func TestRewriteTracebackLeavesPreambleFramesAlone(t *testing.T) {
	raw := `  File "/tmp/x/cell.py", line 3, in <module>`
	got := rewriteTraceback(raw, "/tmp/x/cell.py")
	if got != raw {
		t.Errorf("got %q, want the preamble frame untouched", got)
	}
}
