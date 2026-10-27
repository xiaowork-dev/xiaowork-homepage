//go:build linux

package publishworker

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"
)

func TestProcessTreeHelper(t *testing.T) {
	if os.Getenv("XIAOWORK_PROCESS_HELPER") == "" {
		return
	}
	if os.Getenv("XIAOWORK_PROCESS_CHILD") == "1" {
		for {
			time.Sleep(time.Second)
		}
	}
	child := exec.Command(os.Args[0], "-test.run=^TestProcessTreeHelper$")
	child.Env = append(os.Environ(), "XIAOWORK_PROCESS_CHILD=1")
	if child.Start() != nil {
		os.Exit(3)
	}
	if os.WriteFile(os.Getenv("XIAOWORK_CHILD_PID"), []byte(strconv.Itoa(child.Process.Pid)), 0600) != nil {
		os.Exit(4)
	}
	for {
		time.Sleep(time.Second)
	}
}

func childAlive(pid int) bool {
	data, err := os.ReadFile("/proc/" + strconv.Itoa(pid) + "/stat")
	if err != nil {
		return false
	}
	end := strings.LastIndexByte(string(data), ')')
	fields := strings.Fields(string(data)[end+1:])
	return len(fields) > 0 && fields[0] != "Z"
}
func TestActualTimeoutKillsWholeBuildProcessGroup(t *testing.T) {
	pidFile := filepath.Join(t.TempDir(), "child.pid")
	ctx, cancel := context.WithTimeout(context.Background(), 1200*time.Millisecond)
	defer cancel()
	cmd := exec.CommandContext(ctx, os.Args[0], "-test.run=^TestProcessTreeHelper$")
	cmd.Env = append(os.Environ(), "XIAOWORK_PROCESS_HELPER=1", "XIAOWORK_CHILD_PID="+pidFile)
	configureProcess(cmd)
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	if err := cmd.Wait(); err == nil {
		t.Fatal("timeout did not execute")
	}
	data, err := os.ReadFile(pidFile)
	if err != nil {
		t.Fatal("child was not started before timeout", err)
	}
	pid, _ := strconv.Atoi(string(data))
	deadline := time.Now().Add(2 * time.Second)
	for childAlive(pid) && time.Now().Before(deadline) {
		time.Sleep(20 * time.Millisecond)
	}
	if childAlive(pid) {
		t.Fatal("descendant survived build timeout")
	}
}

func TestStartupStopsVerifiedOrphanAndRejectsUnknownJournal(t *testing.T) {
	work := t.TempDir()
	cmd := exec.CommandContext(context.Background(), os.Args[0], "-test.run=^TestProcessTreeHelper$")
	cmd.Env = append(os.Environ(), "XIAOWORK_PROCESS_HELPER=1", "XIAOWORK_PROCESS_CHILD=1")
	configureProcess(cmd)
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	defer cmd.Wait()
	defer killProcessTree(cmd)
	if err := recordBuild(work, cmd.Process.Pid); err != nil {
		t.Fatal(err)
	}
	// The first check may observe the just-killed group before process reaping;
	// it must close the gate. A retry after Wait can clear the same journal.
	err := checkOrphanBuild(work)
	if err == nil && childAlive(cmd.Process.Pid) {
		t.Fatal("orphan survived accepted startup")
	}
	cmd.Wait()
	if err = checkOrphanBuild(work); err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(filepath.Join(work, "build-process.json"), []byte(`{"pid":1,"start":"x","boot":"x"}`), 0600); err != nil {
		t.Fatal(err)
	}
	if err = checkOrphanBuild(work); err == nil {
		t.Fatal("unknown process identity accepted")
	}
}

func TestBuildOutputAncestorSymlinkCannotRedirectMarker(t *testing.T) {
	job, _ := fixture()
	root := t.TempDir()
	outside := t.TempDir()
	if err := os.Mkdir(filepath.Join(outside, "public"), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outside, filepath.Join(root, ".output")); err != nil {
		t.Fatal(err)
	}
	if err := writeMarker(filepath.Join(root, ".output", "public"), job); err == nil {
		t.Fatal("followed builder-created ancestor symlink")
	}
	if _, err := os.Stat(filepath.Join(outside, "public", "__xiaowork-release.json")); !os.IsNotExist(err) {
		t.Fatal("wrote outside generated job tree")
	}
}
