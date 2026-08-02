//go:build !unix

package pyrun

import "os/exec"

// applyLimits is a no-op off Unix: there is no process group to set, and the
// resource caps come from the preamble the child applies to itself.
func applyLimits(cmd *exec.Cmd, memoryBytes uint64) {}

// killGroup kills the child alone. Anything it spawned survives — stated
// rather than papered over, because it changes what a timeout guarantees.
func killGroup(cmd *exec.Cmd) {
	if cmd.Process != nil {
		_ = cmd.Process.Kill()
	}
}
