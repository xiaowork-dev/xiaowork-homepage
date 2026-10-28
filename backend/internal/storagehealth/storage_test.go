package storagehealth

import (
	"context"
	"os"
	"path/filepath"
	"testing"
)

func TestCapacityBoundariesAndUnknownFailClosed(t *testing.T) {
	for _, c := range []struct {
		free, total uint64
		want        string
	}{
		{0, 0, "unknown"}, {101, 100, "unknown"}, {MinimumFreeBytes - 1, 10 << 30, "critical"},
		{MinimumFreeBytes, 10 << 30, "warning"}, {2 << 30, 100 << 30, "warning"},
		{2 << 30, 101 << 30, "critical"}, {10 << 30, 100 << 30, "ok"},
	} {
		got := classify(c.free, c.total, MinimumFreeBytes)
		if got != c.want {
			t.Fatalf("free=%d total=%d got=%s want=%s", c.free, c.total, got, c.want)
		}
		if CanWrite(Area{State: got}) != (got == "ok" || got == "warning") {
			t.Fatal("unsafe admission")
		}
	}
}

func TestActualStorageMeasurementDoesNotFollowLinks(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "data"), []byte("safe"), 0600); err != nil {
		t.Fatal(err)
	}
	outside := t.TempDir()
	if err := os.WriteFile(filepath.Join(outside, "other"), []byte("never counted"), 0600); err != nil {
		t.Fatal(err)
	}
	// Windows may prohibit creating symlinks without elevation. Linux acceptance
	// always exercises this branch; ordinary measurement is still tested there.
	_ = os.Symlink(outside, filepath.Join(dir, "link"))
	n, files, complete := Measure(context.Background(), dir)
	if n != 4 || files != 1 || !complete {
		t.Fatalf("unexpected measurement %d/%d/%t", n, files, complete)
	}
	a := Inspect("uploads", dir, MinimumFreeBytes)
	if a.State == "unknown" || a.FreeBytes == 0 || a.TotalBytes == 0 {
		t.Fatalf("OS stats unavailable: %+v", a)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, _, complete = Measure(ctx, dir); complete {
		t.Fatal("canceled scan claimed complete")
	}
	if CanWrite(Inspect("missing", filepath.Join(dir, "absent"), MinimumFreeBytes)) {
		t.Fatal("missing storage admitted")
	}
}
