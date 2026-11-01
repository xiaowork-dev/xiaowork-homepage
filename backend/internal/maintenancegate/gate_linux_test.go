//go:build linux

package maintenancegate

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"
)

const testOwner = "12345678-1234-1234-1234-123456789abc"

func TestGateProcessHelper(t *testing.T) {
	mode := os.Getenv("P6E_GATE_HELPER")
	if mode == "" {
		return
	}
	root := os.Getenv("P6E_GATE_ROOT")
	signal := os.Getenv("P6E_GATE_SIGNAL")
	if mode == "lease" {
		release, e := Enter(root)
		if e != nil {
			t.Fatal(e)
		}
		defer release()
		if e = os.WriteFile(signal, []byte("lease-held"), 0600); e != nil {
			t.Fatal(e)
		}
		select {}
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if e := Begin(ctx, root, testOwner); e != nil {
		t.Fatal(e)
	}
	if e := os.WriteFile(signal, []byte("drained"), 0600); e != nil {
		t.Fatal(e)
	}
	if mode == "supervisor-exit" {
		os.Exit(47)
	}
	select {}
}
func process(t *testing.T, root, mode string) *exec.Cmd {
	t.Helper()
	signal := filepath.Join(t.TempDir(), "signal")
	c := exec.Command(os.Args[0], "-test.run=^TestGateProcessHelper$", "-test.timeout=25s")
	c.Env = append(os.Environ(), "P6E_GATE_HELPER="+mode, "P6E_GATE_ROOT="+root, "P6E_GATE_SIGNAL="+signal)
	if e := c.Start(); e != nil {
		t.Fatal(e)
	}
	t.Cleanup(func() { _ = c.Process.Kill(); _ = c.Wait() })
	if mode == "lease" {
		wait(t, func() bool { _, e := os.Stat(signal); return e == nil })
	}
	return c
}
func wait(t *testing.T, predicate func() bool) {
	t.Helper()
	until := time.Now().Add(5 * time.Second)
	for !predicate() {
		if time.Now().After(until) {
			t.Fatal("process barrier deadline exceeded")
		}
		time.Sleep(10 * time.Millisecond)
	}
}
func testRoot(t *testing.T) string {
	t.Helper()
	root := t.TempDir()
	if e := os.Chmod(root, 0700); e != nil {
		t.Fatal(e)
	}
	if e := Init(root); e != nil {
		t.Fatal(e)
	}
	return root
}

func TestGateCrossProcessKillAndPersistentRecovery(t *testing.T) {
	root := testRoot(t)
	reader := process(t, root, "lease")
	operator := process(t, root, "begin")
	wait(t, func() bool { s, e := Inspect(root); return e == nil && s.Phase == "draining" })
	if release, e := Enter(root); e == nil {
		release()
		t.Fatal("new admission crossed maintenance")
	}
	if e := operator.Process.Kill(); e != nil {
		t.Fatal(e)
	}
	_ = operator.Wait()
	_ = reader.Process.Kill()
	_ = reader.Wait()
	if release, e := Enter(root); e == nil {
		release()
		t.Fatal("SIGKILL reopened admissions")
	}
	if e := Begin(context.Background(), root, testOwner); e == nil {
		t.Fatal("retry adopted an unknown operation")
	}
	if e := Complete(root, testOwner); e == nil {
		t.Fatal("undrained state was automatically acknowledged")
	}
	t.Logf("controller=SIGKILL reader=SIGKILL state=recovery-required/draining; new admission/begin/complete all refused")
}

func TestGateDrainWaitsForAdmittedLease(t *testing.T) {
	root := testRoot(t)
	release, e := Enter(root)
	if e != nil {
		t.Fatal(e)
	}
	done := make(chan error, 1)
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	go func() { done <- Begin(ctx, root, testOwner) }()
	wait(t, func() bool { s, e := Inspect(root); return e == nil && s.Phase == "draining" })
	select {
	case e := <-done:
		t.Fatalf("Begin returned before the admitted task drained: %v", e)
	case <-time.After(50 * time.Millisecond):
	}
	continuation, e := Continue(root)
	if e != nil {
		t.Fatal(e)
	}
	continuation()
	release()
	if e = <-done; e != nil {
		t.Fatal(e)
	}
	if _, e = Continue(root); e == nil {
		t.Fatal("late result crossed drained state")
	}
	if e = Complete(root, testOwner); e != nil {
		t.Fatal(e)
	}
	t.Log("real flock contention waited; admitted result allowed during draining; late result refused after drained")
}
func TestGateSupervisorExitAndNormalCompletion(t *testing.T) {
	root := testRoot(t)
	c := process(t, root, "supervisor-exit")
	e := c.Wait()
	if e == nil || c.ProcessState.ExitCode() != 47 {
		t.Fatal("supervisor did not exit 47", e)
	}
	s, e := Inspect(root)
	if e != nil || s.Phase != "drained" {
		t.Fatal(s, e)
	}
	if release, e := Enter(root); e == nil {
		release()
		t.Fatal("supervisor death unlocked barrier")
	}
	if e = Complete(root, "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"); e == nil {
		t.Fatal("wrong operator completed maintenance")
	}
	if e = Complete(root, testOwner); e != nil {
		t.Fatal(e)
	}
	release, e := Enter(root)
	if e != nil {
		t.Fatal(e)
	}
	release()
	if e = Init(root); e == nil {
		t.Fatal("startup reset an existing control volume")
	}
	t.Log("supervisor exit=47; blocked until explicit verified-owner completion; publication admission restored")
}
func TestGateRejectsUnknownControlState(t *testing.T) {
	for _, mode := range []string{"missing", "corrupt", "permissions", "symlink", "hardlink", "unfinished-write"} {
		t.Run(mode, func(t *testing.T) {
			root := testRoot(t)
			switch mode {
			case "missing":
				if e := os.Remove(filepath.Join(root, "state.json")); e != nil {
					t.Fatal(e)
				}
			case "corrupt":
				if e := os.WriteFile(filepath.Join(root, "state.json"), []byte(`{"format":1,"mode":"ready","phase":"idle","owner":"","unknown":true}`), 0600); e != nil {
					t.Fatal(e)
				}
			case "permissions":
				if e := os.Chmod(root, 0000); e != nil {
					t.Fatal(e)
				}
				defer os.Chmod(root, 0700)
			case "symlink":
				p := filepath.Join(root, "activity.lock")
				if e := os.Remove(p); e != nil {
					t.Fatal(e)
				}
				if e := os.Symlink("admission.lock", p); e != nil {
					t.Fatal(e)
				}
			case "hardlink":
				if e := os.Link(filepath.Join(root, "admission.lock"), filepath.Join(root, "alias")); e != nil {
					t.Fatal(e)
				}
			case "unfinished-write":
				if e := os.WriteFile(filepath.Join(root, "state.next"), []byte("partial"), 0600); e != nil {
					t.Fatal(e)
				}
			}
			if release, e := Enter(root); e == nil {
				release()
				t.Fatal("unsafe control state admitted")
			}
			if e := Begin(context.Background(), root, testOwner); e == nil {
				t.Fatal("unsafe control state entered maintenance")
			}
			t.Logf("case=%s admission=refused maintenance=refused", mode)
		})
	}
}
func TestGateReadonlyMount(t *testing.T) {
	root := os.Getenv("P6E_READONLY_GATE")
	if root == "" {
		t.Skip("explicit RO volume test only")
	}
	release, e := Enter(root)
	if e != nil {
		t.Fatal(e)
	}
	release()
	if e = Begin(context.Background(), root, testOwner); e == nil {
		t.Fatal("runtime RO volume unexpectedly writable")
	}
	f, e := os.Create(filepath.Join(root, "must-not-create"))
	if e == nil {
		f.Close()
		t.Fatal("runtime mounted RW")
	}
	fmt.Println("RO_KERNEL_PROOF: Enter=allowed; Begin/write=EROFS; flock on O_RDONLY=passed")
}

func TestGateBlockedMount(t *testing.T) {
	root := os.Getenv("P6E_BLOCKED_GATE")
	if root == "" {
		t.Skip("explicit persisted control-volume test only")
	}
	s, e := Inspect(root)
	if e != nil {
		t.Fatal(e)
	}
	if s.Mode != "recovery-required" || s.Phase != "drained" {
		t.Fatal(s)
	}
	if release, e := Enter(root); e == nil {
		release()
		t.Fatal("new process crossed the persistent barrier")
	}
	if release, e := Continue(root); e == nil {
		release()
		t.Fatal("late private result crossed drained state")
	}
	fmt.Printf("PERSISTENT_BARRIER_PROOF: state=%+v; new process Enter/Continue=refused\n", s)
}
