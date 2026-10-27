//go:build linux

package publishfs

import (
	"context"
	"os"
	"os/exec"
	"testing"
	"time"
)

// This helper intentionally exits the real process without any defer, cleanup,
// unlock, or receipt repair. Fault selection exists only in the test binary.
func TestActivationCrashProcessHelper(t *testing.T) {
	root := os.Getenv("XIAOWORK_CRASH_TEST_ROOT")
	if root == "" {
		return
	}
	s, err := Open(root)
	if err != nil {
		os.Exit(70)
	}
	if _, err = s.Lock(); err != nil {
		os.Exit(71)
	}
	b, digest, err := s.VerifyRelease(testID("rel", '2'))
	if err != nil {
		os.Exit(72)
	}
	i, r := proof(b, testID("job", '2'), testID("rel", '1'), digest)
	point := os.Getenv("XIAOWORK_CRASH_TEST_POINT")
	s.SetFaultForTest(func(p string) error {
		if p == point {
			os.Exit(79)
		}
		return nil
	})
	if err = s.Activate(i, r); err != nil {
		os.Exit(73)
	}
	os.Exit(74)
}

func TestActualProcessCrashAtEveryAtomicActivationBoundary(t *testing.T) {
	for _, point := range []string{"after-intent", "before-current-rename", "after-current-rename", "after-receipt"} {
		t.Run(point, func(t *testing.T) {
			root := t.TempDir()
			s, err := Open(root)
			if err != nil {
				t.Fatal(err)
			}
			unlock, err := s.Lock()
			if err != nil {
				t.Fatal(err)
			}
			a, ad := sealed(t, s, testID("rel", '1'), testID("job", '1'))
			ai, ar := proof(a, testID("job", '1'), "", ad)
			if err = s.Activate(ai, ar); err != nil {
				t.Fatal(err)
			}
			sealed(t, s, testID("rel", '2'), testID("job", '2'))
			if err = unlock(); err != nil {
				t.Fatal(err)
			}
			s.Close()
			ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
			defer cancel()
			cmd := exec.CommandContext(ctx, os.Args[0], "-test.run=^TestActivationCrashProcessHelper$")
			cmd.Env = append(os.Environ(), "XIAOWORK_CRASH_TEST_ROOT="+root, "XIAOWORK_CRASH_TEST_POINT="+point)
			output, err := cmd.CombinedOutput()
			exit, ok := err.(*exec.ExitError)
			if !ok || exit.ExitCode() != 79 {
				t.Fatalf("crash helper did not reach boundary: %v %s", err, output)
			}
			// A new instance must acquire the kernel lock after abrupt death.
			recovered, err := Open(root)
			if err != nil {
				t.Fatal(err)
			}
			defer recovered.Close()
			release, err := recovered.Lock()
			if err != nil {
				t.Fatal("dead process retained lock", err)
			}
			defer release()
			current, err := recovered.Current()
			if err != nil {
				t.Fatal(err)
			}
			want := testID("rel", '1')
			if point == "after-current-rename" || point == "after-receipt" {
				want = testID("rel", '2')
			}
			if current != want {
				t.Fatalf("current=%s want=%s", current, want)
			}
			if _, _, err = recovered.VerifyRelease(current); err != nil {
				t.Fatal("crash exposed incomplete output", err)
			}
			if _, err = recovered.ReadIntent(testID("job", '2')); err != nil {
				t.Fatal("missing durable task intent", err)
			}
			if want == testID("rel", '2') {
				if _, err = recovered.CompleteActivationReceipt(testID("job", '2')); err != nil {
					t.Fatal("could not reconcile pointer/receipt gap", err)
				}
				if receipt, _, err := recovered.ReadReceipt(testID("job", '2')); err != nil || receipt.Outcome != "activated" {
					t.Fatal(receipt, err)
				}
			} else if _, _, err = recovered.ReadReceipt(testID("job", '2')); !os.IsNotExist(err) {
				t.Fatal("pre-switch crash manufactured completion proof", err)
			}
		})
	}
}
