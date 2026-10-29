package maintenance

import (
	"context"
	"encoding/binary"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/xiaowork-dev/xiaowork-homepage/backend/internal/store"
)

func readonlyFixture(t *testing.T, wal bool) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "content.sqlite")
	db, err := store.Open(path, true)
	if err != nil {
		t.Fatal(err)
	}
	if err = store.Migrate(context.Background(), db); err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec("UPDATE workspace SET revision=37,updated_at=1 WHERE id=1"); err != nil {
		t.Fatal(err)
	}
	if !wal {
		if err = db.Close(); err != nil {
			t.Fatal(err)
		}
		return path
	}
	// Take a stopped/quiescent file-set fixture while this test's only connection
	// is idle; the real read-only volume matrix uses an exited fixture process.
	destination := filepath.Join(t.TempDir(), "content.sqlite")
	for _, suffix := range databaseSuffixes {
		data, err := os.ReadFile(path + suffix)
		if os.IsNotExist(err) {
			continue
		}
		if err != nil {
			t.Fatal(err)
		}
		if err = os.WriteFile(destination+suffix, data, 0600); err != nil {
			t.Fatal(err)
		}
	}
	if err = db.Close(); err != nil {
		t.Fatal(err)
	}
	return destination
}

func TestOfflineDatabaseStableCleanAndCommittedWAL(t *testing.T) {
	for _, withWAL := range []bool{false, true} {
		name := "stable-no-wal"
		if withWAL {
			name = "committed-wal"
		}
		t.Run(name, func(t *testing.T) {
			path := readonlyFixture(t, withWAL)
			before, err := sourceMembers(path, "")
			if err != nil {
				t.Fatal(err)
			}
			view, err := openReadOnly(path)
			if err != nil {
				t.Fatal(err)
			}
			if view.temp == filepath.Dir(path) {
				t.Fatal("SQLite was given the original directory")
			}
			var revision int
			if err = view.QueryRow("SELECT revision FROM workspace WHERE id=1").Scan(&revision); err != nil || revision != 37 {
				t.Fatalf("committed state: revision=%d error=%v", revision, err)
			}
			if err = store.Check(context.Background(), view.DB); err != nil {
				t.Fatal(err)
			}
			if err = view.Close(); err != nil {
				t.Fatal(err)
			}
			if err = view.Close(); err != nil {
				t.Fatal("idempotent Close", err)
			}
			if _, err = os.Lstat(view.temp); !os.IsNotExist(err) {
				t.Fatal("private copy was not cleaned", err)
			}
			after, err := sourceMembers(path, "")
			if err != nil || !equalDatabaseMembers(before, after) {
				t.Fatal("source metadata/bytes changed", err)
			}
		})
	}
}

func TestOfflineDatabaseRebuildsIndexOnlyInPrivateCopy(t *testing.T) {
	path := readonlyFixture(t, true)
	if err := os.Remove(path + "-shm"); err != nil {
		t.Fatal(err)
	}
	view, err := openReadOnly(path)
	if err != nil {
		t.Fatal(err)
	}
	var revision int
	if err = view.QueryRow("SELECT revision FROM workspace WHERE id=1").Scan(&revision); err != nil || revision != 37 {
		t.Fatalf("WAL without index lost committed data: %d %v", revision, err)
	}
	if err = view.Close(); err != nil {
		t.Fatal(err)
	}
	if _, err = os.Lstat(path + "-shm"); !os.IsNotExist(err) {
		t.Fatal("created source WAL index", err)
	}
}

func TestOfflineDatabaseRejectsUnsafeOrUnprovenFileSets(t *testing.T) {
	for _, test := range []struct {
		name   string
		wal    bool
		change func(*testing.T, string)
		kind   string
	}{
		{"absent", false, func(t *testing.T, p string) {
			if err := os.Remove(p); err != nil {
				t.Fatal(err)
			}
		}, "absent"},
		{"corrupt-main", false, func(t *testing.T, p string) {
			if err := os.WriteFile(p, []byte("not a sqlite file"), 0600); err != nil {
				t.Fatal(err)
			}
		}, "corrupt"},
		{"nonempty-journal", false, func(t *testing.T, p string) {
			if err := os.WriteFile(p+"-journal", []byte("unproven recovery"), 0600); err != nil {
				t.Fatal(err)
			}
		}, "journal-state-unproven"},
		{"orphan-shm", false, func(t *testing.T, p string) {
			if err := os.WriteFile(p+"-shm", []byte("unknown shared memory"), 0600); err != nil {
				t.Fatal(err)
			}
		}, "wal-state-unproven"},
		{"truncated-wal", true, func(t *testing.T, p string) {
			info, e := os.Stat(p + "-wal")
			if e != nil {
				t.Fatal(e)
			}
			if e = os.Truncate(p+"-wal", info.Size()-1); e != nil {
				t.Fatal(e)
			}
		}, "wal-state-unproven"},
		{"checksum-wal", true, func(t *testing.T, p string) {
			data, e := os.ReadFile(p + "-wal")
			if e != nil {
				t.Fatal(e)
			}
			data[len(data)-1] ^= 1
			if e = os.WriteFile(p+"-wal", data, 0600); e != nil {
				t.Fatal(e)
			}
		}, "wal-state-unproven"},
		{"uncommitted-wal-tail", true, appendUncommittedFrame, "wal-state-unproven"},
	} {
		t.Run(test.name, func(t *testing.T) {
			path := readonlyFixture(t, test.wal)
			test.change(t, path)
			before, err := sourceMembers(path, "")
			if err != nil && test.name != "absent" {
				t.Fatal(err)
			}
			view, err := openReadOnly(path)
			if view != nil {
				view.Close()
				t.Fatal("unsafe file set accepted")
			}
			var readErr *DatabaseReadError
			if !errors.As(err, &readErr) || readErr.Kind != test.kind {
				t.Fatalf("expected %s, got %v", test.kind, err)
			}
			if test.name != "absent" {
				after, e := sourceMembers(path, "")
				if e != nil || !equalDatabaseMembers(before, after) {
					t.Fatal("failed inspection modified source", e)
				}
			}
		})
	}
}

func appendUncommittedFrame(t *testing.T, path string) {
	t.Helper()
	data, err := os.ReadFile(path + "-wal")
	if err != nil {
		t.Fatal(err)
	}
	page := int(binary.BigEndian.Uint32(data[8:12]))
	frame := append([]byte(nil), data[len(data)-24-page:]...)
	a, b := binary.BigEndian.Uint32(frame[16:20]), binary.BigEndian.Uint32(frame[20:24])
	binary.BigEndian.PutUint32(frame[4:8], 0)
	var order binary.ByteOrder = binary.LittleEndian
	if binary.BigEndian.Uint32(data[:4]) == 0x377f0683 {
		order = binary.BigEndian
	}
	checksum := func(d []byte) {
		for i := 0; i < len(d); i += 8 {
			a += order.Uint32(d[i:i+4]) + b
			b += order.Uint32(d[i+4:i+8]) + a
		}
	}
	checksum(frame[:8])
	checksum(frame[24:])
	binary.BigEndian.PutUint32(frame[16:20], a)
	binary.BigEndian.PutUint32(frame[20:24], b)
	if err = os.WriteFile(path+"-wal", append(data, frame...), 0600); err != nil {
		t.Fatal(err)
	}
}

func TestOfflineDatabaseFinalVerificationRejectsSourceMetadataChange(t *testing.T) {
	path := readonlyFixture(t, false)
	view, err := openReadOnly(path)
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now().Add(time.Hour)
	if err = os.Chtimes(path, now, now); err != nil {
		t.Fatal(err)
	}
	if err = view.Close(); err == nil || !strings.Contains(err.Error(), "source-changed") {
		t.Fatalf("changed source was not rejected: %v", err)
	}
}

func TestOfflineDatabaseRejectsSchemaAsSchemaNotIO(t *testing.T) {
	root := t.TempDir()
	emptyRoots(t, root)
	path := filepath.Join(root, "db", "content.sqlite")
	db, err := store.Open(path, true)
	if err != nil {
		t.Fatal(err)
	}
	if err = store.Migrate(context.Background(), db); err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec("UPDATE schema_migrations SET version=99 WHERE version=3"); err != nil {
		t.Fatal(err)
	}
	db.Close()
	_, err = Inspect(context.Background(), root)
	var readErr *DatabaseReadError
	if !errors.As(err, &readErr) || readErr.Kind != "schema-incompatible" {
		t.Fatalf("expected schema-incompatible, got %v", err)
	}
}
