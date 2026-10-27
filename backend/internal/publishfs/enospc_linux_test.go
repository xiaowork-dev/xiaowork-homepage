//go:build linux && p6d_fault

package publishfs

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"syscall"
	"testing"

	"golang.org/x/sys/unix"
)

// Run only in a disposable container with --tmpfs /fault:size=64k. This is a
// real kernel ENOSPC, not a fake full disk and never a write to a business volume.
func TestRealTinyFilesystemENOSPCPreservesActiveRelease(t *testing.T) {
	var stat unix.Statfs_t
	if err := unix.Statfs("/fault", &stat); err != nil || stat.Type != unix.TMPFS_MAGIC || stat.Blocks*uint64(stat.Bsize) > 128<<10 {
		t.Fatal("dedicated tiny /fault tmpfs required")
	}
	directory, err := os.MkdirTemp("/fault", "p6d-enospc-")
	if err != nil {
		t.Fatal(err)
	}
	s, err := Open(directory)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	unlock, err := s.Lock()
	if err != nil {
		t.Fatal(err)
	}
	defer unlock()
	a, hash := sealed(t, s, testID("rel", 'a'), testID("job", 'a'))
	intent, receipt := proof(a, a.JobID, "", hash)
	if err = s.Activate(intent, receipt); err != nil {
		t.Fatal(err)
	}
	large := t.TempDir()
	if err = os.WriteFile(filepath.Join(large, "large.js"), []byte(strings.Repeat("x", 1<<20)), 0600); err != nil {
		t.Fatal(err)
	}
	b := manifest(testID("rel", 'b'), testID("job", 'b'))
	_, err = s.Prepare(b.JobID, b, large)
	if !errors.Is(err, syscall.ENOSPC) {
		t.Fatalf("expected actual ENOSPC, got %v", err)
	}
	current, err := s.Current()
	if err != nil || current != a.ReleaseID {
		t.Fatal("ENOSPC changed current")
	}
	if _, actual, err := s.VerifyRelease(a.ReleaseID); err != nil || actual != hash {
		t.Fatal("ENOSPC damaged retained active artifact")
	}
	t.Log("actual kernel ENOSPC; current remains A; full retained A manifest verified; no B activation")
}
