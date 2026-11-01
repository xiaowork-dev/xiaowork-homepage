//go:build linux

package maintenance

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestMetadataRejectsWritableSource(t *testing.T) {
	root := t.TempDir()
	for _, role := range []string{"authority", "db", "publications", "secrets", "tls", "uploads"} {
		if err := os.Mkdir(filepath.Join(root, role), 0700); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := ReadOnlyMetadata(root); err == nil || !strings.Contains(err.Error(), "kernel read-only") {
		t.Fatalf("writable source must be refused: %v", err)
	}
}
