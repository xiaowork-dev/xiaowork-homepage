//go:build !linux

package publishworker

import (
	"errors"
	"os/exec"
)

// Actual publication builds require Linux process groups and offline container
// isolation. Windows remains a host for pure filesystem/protocol unit tests.
func configureProcess(cmd *exec.Cmd)         {}
func killProcessTree(cmd *exec.Cmd) error    { return errors.New("offline builder requires Linux") }
func recordBuild(work string, pid int) error { return errors.New("offline builder requires Linux") }
func clearBuild(work string) error           { return errors.New("offline builder requires Linux") }
func checkOrphanBuild(work string) error     { return errors.New("offline builder requires Linux") }
