//go:build linux

package publishworker

import (
	"encoding/json"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"

	"golang.org/x/sys/unix"
)

type processJournal struct {
	PID   int    `json:"pid"`
	Start string `json:"start"`
	Boot  string `json:"boot"`
}

func configureProcess(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true, Pdeathsig: syscall.SIGKILL}
	cmd.Cancel = func() error { return killProcessTree(cmd) }
	cmd.WaitDelay = 5 * time.Second
}
func killProcessTree(cmd *exec.Cmd) error {
	if cmd.Process == nil {
		return nil
	}
	err := unix.Kill(-cmd.Process.Pid, unix.SIGKILL)
	if errors.Is(err, unix.ESRCH) {
		return nil
	}
	return err
}
func processStart(pid int) (string, error) {
	data, err := os.ReadFile("/proc/" + strconv.Itoa(pid) + "/stat")
	if err != nil {
		return "", err
	}
	end := strings.LastIndexByte(string(data), ')')
	if end < 0 {
		return "", errors.New("invalid process identity")
	}
	fields := strings.Fields(string(data)[end+1:])
	if len(fields) < 20 {
		return "", errors.New("invalid process identity")
	}
	return fields[19], nil
}
func recordBuild(work string, pid int) error {
	start, err := processStart(pid)
	if err != nil {
		return err
	}
	boot, err := os.ReadFile("/proc/sys/kernel/random/boot_id")
	if err != nil {
		return err
	}
	data, _ := json.Marshal(processJournal{PID: pid, Start: start, Boot: strings.TrimSpace(string(boot))})
	file, err := os.OpenFile(filepath.Join(work, "build-process.json"), os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if err != nil {
		return errors.New("unreconciled build journal")
	}
	if _, err = file.Write(data); err == nil {
		err = file.Sync()
	}
	file.Close()
	return err
}
func clearBuild(work string) error { return os.Remove(filepath.Join(work, "build-process.json")) }
func checkOrphanBuild(work string) error {
	data, err := os.ReadFile(filepath.Join(work, "build-process.json"))
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	var journal processJournal
	if strictJSON(data, &journal) != nil || journal.PID < 2 || journal.Start == "" {
		return errors.New("unreconciled build journal")
	}
	boot, err := os.ReadFile("/proc/sys/kernel/random/boot_id")
	if err != nil {
		return err
	}
	if strings.TrimSpace(string(boot)) != journal.Boot {
		return clearBuild(work)
	}
	start, err := processStart(journal.PID)
	if err == nil && start == journal.Start {
		if err = unix.Kill(-journal.PID, unix.SIGKILL); err != nil && !errors.Is(err, unix.ESRCH) {
			return err
		}
	}
	if err = unix.Kill(-journal.PID, 0); !errors.Is(err, unix.ESRCH) {
		return errors.New("orphan build group requires isolated container restart")
	}
	return clearBuild(work)
}
