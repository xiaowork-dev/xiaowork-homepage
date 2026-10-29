//go:build linux

package maintenance

import (
	"errors"
	"os"
	"path/filepath"
	"testing"
)

func TestOfflineDatabaseSourceDirectoryNotWritable(t *testing.T) {
	path := readonlyFixture(t, false)
	if err := os.Chmod(path, 0444); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(filepath.Dir(path), 0555); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { os.Chmod(filepath.Dir(path), 0700) })
	before, err := sourceMembers(path, "")
	if err != nil {
		t.Fatal(err)
	}
	view, err := openReadOnly(path)
	if err != nil {
		t.Fatal(err)
	}
	if err = view.Close(); err != nil {
		t.Fatal(err)
	}
	after, err := sourceMembers(path, "")
	if err != nil || !equalDatabaseMembers(before, after) {
		t.Fatal("source bytes/metadata changed", err)
	}
}

func TestOfflineDatabaseRefusesUnreadableAndLink(t *testing.T) {
	t.Run("unreadable", func(t *testing.T) {
		if os.Geteuid() == 0 {
			t.Skip("requires non-root Linux user; separate real-volume test runs uid10001")
		}
		path := readonlyFixture(t, false)
		if err := os.Chmod(path, 0000); err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { os.Chmod(path, 0600) })
		_, err := openReadOnly(path)
		var readErr *DatabaseReadError
		if !errors.As(err, &readErr) || readErr.Kind != "permission" {
			t.Fatalf("unreadable file: %v", err)
		}
	})
	t.Run("symbolic-link", func(t *testing.T) {
		path := readonlyFixture(t, false)
		alias := filepath.Join(filepath.Dir(path), "alias.sqlite")
		if err := os.Symlink(path, alias); err != nil {
			t.Fatal(err)
		}
		_, err := openReadOnly(alias)
		var readErr *DatabaseReadError
		if !errors.As(err, &readErr) || readErr.Kind != "unsafe-file" {
			t.Fatalf("symlink accepted: %v", err)
		}
	})
}
