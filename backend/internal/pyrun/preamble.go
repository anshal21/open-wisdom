package pyrun

import (
	"fmt"
	"strings"
)

// LimitsFile is where the preamble records which caps the OS actually
// accepted. The runner reads it back so it can report the truth instead of
// assuming its own configuration took effect.
const LimitsFile = "limits.json"

// preamble is prepended to every cell before execution. It applies the
// resource caps from inside the interpreter, because Go cannot portably set
// them on the child at fork time.
//
// Both the soft and the hard limit are set. That matters: a process may raise
// its own soft limit up to the hard limit at will, so setting the soft limit
// alone would be a suggestion rather than a cap. Lowering the hard limit is
// irreversible without CAP_SYS_RESOURCE, which the server does not have and
// should not want.
//
// PLATFORM REALITY: not every limit exists everywhere. macOS does not
// implement RLIMIT_AS at all — `ulimit -v` fails with EINVAL — so the address
// space cap is a Linux-only guarantee. Rather than swallow that difference,
// the preamble writes limits.json naming exactly which caps were applied, and
// Result.LimitsApplied carries it out to the caller. A limit we could not set
// is reported as missing, never as enforced.
//
// LINE ACCOUNTING: the preamble contributes preambleLines lines, so a
// traceback's line numbers can be mapped back to what the user actually typed.
func preamble(memoryBytes uint64, cpuSeconds int) string {
	return fmt.Sprintf(`_applied = []
try:
    import json as _j, resource as _rs
    for _n, _v in (("memory", _rs.RLIMIT_AS), ("cpu", _rs.RLIMIT_CPU), ("processes", _rs.RLIMIT_NPROC)):
        _lim = {"memory": %d, "cpu": %d, "processes": 256}[_n]
        try:
            _rs.setrlimit(_v, (_lim, _lim))
            _applied.append(_n)
        except Exception:
            pass
    _j.dump(_applied, open(%q, "w"))
    del _j, _rs, _n, _v, _lim
except Exception:
    pass
del _applied
`, memoryBytes, cpuSeconds, LimitsFile)
}

// preambleLines is how many lines the preamble occupies, DERIVED from the
// preamble itself rather than hand-maintained. A hardcoded count silently
// drifts the moment someone adds a line, and the symptom — every traceback
// blaming the wrong line — is subtle enough to survive review.
var preambleLines = strings.Count(preamble(0, 0), "\n")

// rewriteTraceback shifts the line numbers in a Python traceback back by the
// preamble's height, so an error on the user's first line reports as line 1
// rather than line 17. A stack trace pointing at code the user cannot see is
// worse than no stack trace.
func rewriteTraceback(stderr, scriptPath string) string {
	if stderr == "" {
		return stderr
	}
	lines := strings.Split(stderr, "\n")
	marker := `File "` + scriptPath + `", line `
	for i, ln := range lines {
		idx := strings.Index(ln, marker)
		if idx < 0 {
			continue
		}
		rest := ln[idx+len(marker):]
		end := 0
		for end < len(rest) && rest[end] >= '0' && rest[end] <= '9' {
			end++
		}
		if end == 0 {
			continue
		}
		n := 0
		for _, c := range rest[:end] {
			n = n*10 + int(c-'0')
		}
		n -= preambleLines
		if n < 1 {
			// Inside the preamble itself: not the user's code, and not
			// something they can act on. Leave the frame rather than claim a
			// line number that maps to nothing.
			continue
		}
		lines[i] = ln[:idx] + `File "cell.py", line ` + fmt.Sprint(n) + rest[end:]
	}
	return strings.Join(lines, "\n")
}
