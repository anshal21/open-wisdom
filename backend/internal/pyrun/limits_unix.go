//go:build unix

package pyrun

import (
	"os/exec"
	"syscall"
)

// applyLimits puts the child in its own process group.
//
// That is all this function does, and the process group is the load-bearing
// part: without it a timeout kills the interpreter and leaves whatever it
// spawned still running. The memory and CPU caps are NOT set here — Go's
// SysProcAttr does not portably expose setrlimit-on-fork — they are applied by
// the child itself through the preamble in preamble.go, which sets both the
// soft AND hard limits so the script cannot raise them back.
func applyLimits(cmd *exec.Cmd, memoryBytes uint64) {
	if cmd.SysProcAttr == nil {
		cmd.SysProcAttr = &syscall.SysProcAttr{}
	}
	cmd.SysProcAttr.Setpgid = true
}

// killGroup terminates the child and everything it started.
func killGroup(cmd *exec.Cmd) {
	if cmd.Process == nil {
		return
	}
	pgid, err := syscall.Getpgid(cmd.Process.Pid)
	if err != nil {
		// Fall back to the single process rather than doing nothing.
		_ = cmd.Process.Kill()
		return
	}
	// A negative pid addresses the whole group.
	_ = syscall.Kill(-pgid, syscall.SIGKILL)
}
