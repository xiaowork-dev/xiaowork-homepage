//go:build linux

package publishfs

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestPendingActivationLinksListsOnlyCurrentNextMembers(t *testing.T) {
	dir := t.TempDir()
	s, err := Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	if links, err := s.PendingActivationLinks(); err != nil || len(links) != 0 {
		t.Fatalf("fresh store: %v %v", links, err)
	}
	name := "current.next." + strings.Repeat("a", 64)
	if err = os.Symlink("releases/rel_"+strings.Repeat("b", 32), filepath.Join(dir, name)); err != nil {
		t.Fatal(err)
	}
	if err = os.Symlink("releases/rel_"+strings.Repeat("c", 32), filepath.Join(dir, "current")); err != nil {
		t.Fatal(err)
	}
	links, err := s.PendingActivationLinks()
	if err != nil || len(links) != 1 || links[0] != name {
		t.Fatalf("leftover link not reported exactly: %v %v", links, err)
	}
	ro, err := OpenReadOnly(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer ro.Close()
	if links, err = ro.PendingActivationLinks(); err != nil || len(links) != 1 {
		t.Fatalf("read-only store must report the leftover too: %v %v", links, err)
	}
}
