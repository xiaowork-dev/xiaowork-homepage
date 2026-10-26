package httpapi

import (
	"bytes"
	"image"
	"image/png"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"github.com/xiaowork-dev/xiaowork-homepage/backend/internal/mediautils"
)

func mediaTestPNG(t *testing.T) []byte {
	t.Helper()
	var b bytes.Buffer
	if err := png.Encode(&b, image.NewNRGBA(image.Rect(0, 0, 2, 2))); err != nil {
		t.Fatal(err)
	}
	return b.Bytes()
}

func TestMediaPrivateStorageIsContentAddressedAndNeverOverwrites(t *testing.T) {
	a := &App{config: Config{UploadDir: filepath.Join(t.TempDir(), "uploads")}}
	root, err := a.mediaRoot()
	if err != nil {
		t.Fatal(err)
	}
	defer root.Close()
	image, err := mediautils.Sanitize(bytes.NewReader(mediaTestPNG(t)), "private.png", "image/png")
	if err != nil {
		t.Fatal(err)
	}
	key, err := storeMediaBlob(root, image)
	if err != nil {
		t.Fatal(err)
	}
	if key != "derived/"+image.SHA256+".png" {
		t.Fatal("client name used in storage path")
	}
	if _, err := storeMediaBlob(root, image); err != nil {
		t.Fatalf("identical bytes should reuse immutable blob: %v", err)
	}
	if err := verifyMediaBlob(root, key, image.SHA256, int64(len(image.Bytes))); err != nil {
		t.Fatal(err)
	}
	entries, err := os.ReadDir(filepath.Join(a.config.UploadDir, "tmp"))
	if err != nil || len(entries) != 0 {
		t.Fatalf("completed requests left temporary originals: %v %v", entries, err)
	}
	info, err := root.Stat(key)
	if err != nil {
		t.Fatal(err)
	}
	if runtime.GOOS != "windows" && info.Mode().Perm() != 0600 {
		t.Fatalf("blob permissions=%o", info.Mode().Perm())
	}
	corrupt := bytes.Repeat([]byte{'x'}, len(image.Bytes))
	if err := root.WriteFile(key, corrupt, 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := storeMediaBlob(root, image); err == nil {
		t.Fatal("corrupt existing blob must not be silently overwritten or accepted")
	}
	actual, err := root.ReadFile(key)
	if err != nil || !bytes.Equal(actual, corrupt) {
		t.Fatal("existing blob was overwritten")
	}
}

func TestMediaStorageRefusesTraversalSymlinksAndMissingContent(t *testing.T) {
	a := &App{config: Config{UploadDir: filepath.Join(t.TempDir(), "uploads")}}
	root, err := a.mediaRoot()
	if err != nil {
		t.Fatal(err)
	}
	defer root.Close()
	for _, key := range []string{"../private.sqlite", "derived/../private.sqlite", "derived/" + strings.Repeat("a", 64) + ".svg", "derived/" + strings.Repeat("a", 63) + ".png", "derived\\" + strings.Repeat("a", 64) + ".png"} {
		if _, err := openMediaBlob(root, key, 1); err == nil {
			t.Fatalf("unsafe storage key accepted: %q", key)
		}
	}
	key := "derived/" + strings.Repeat("a", 64) + ".png"
	if _, err := openMediaBlob(root, key, 1); err == nil {
		t.Fatal("missing object accepted")
	}
	if err := root.WriteFile("private-file", []byte("private-test-value"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := root.Symlink("../private-file", key); err != nil {
		t.Logf("symlink creation unavailable on this host; traversal/missing checks ran: %v", err)
		return
	}
	if _, err := openMediaBlob(root, key, 18); err == nil {
		t.Fatal("symlink must not be served even when its target stays inside private root")
	}
}
