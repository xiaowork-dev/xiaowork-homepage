//go:build linux

package httpapi

import (
	"bytes"
	"context"
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestWorkerRealUnixSocketIsPrivateAndPublicPathsCannotClaim(t *testing.T) {
	f, _, _ := publicationFixture(t)
	dir, e := os.MkdirTemp("", "xw-uds-")
	if e != nil {
		t.Fatal(e)
	}
	defer os.RemoveAll(dir)
	if e = os.Chmod(dir, 0700); e != nil {
		t.Fatal(e)
	}
	name := filepath.Join(dir, "api.sock")
	f.app.config.WorkerSocket = name
	listener, e := f.app.WorkerListener()
	if e != nil {
		t.Fatal(e)
	}
	defer listener.Close()
	info, e := os.Lstat(name)
	if e != nil || info.Mode().Perm() != 0600 {
		t.Fatal("worker socket permissions are not 0600")
	}
	server := Server("", f.app.WorkerHandler())
	defer server.Close()
	go server.Serve(listener)
	transport := &http.Transport{Proxy: nil, DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
		return (&net.Dialer{Timeout: time.Second}).DialContext(ctx, "unix", name)
	}}
	defer transport.CloseIdleConnections()
	client := &http.Client{Transport: transport, Timeout: 3 * time.Second}
	req, _ := http.NewRequest("POST", "http://publisher/internal/publisher/v1/claim", bytes.NewBufferString(`{"protocolVersion":1,"workerId":"publisher-v1"}`))
	req.Header.Set("Content-Type", "application/json")
	res, e := client.Do(req)
	if e != nil {
		t.Fatal(e)
	}
	raw, _ := io.ReadAll(res.Body)
	res.Body.Close()
	if res.StatusCode != 200 || !bytes.Contains(raw, []byte(`"job":null`)) {
		t.Fatalf("private same-UID request failed: %d %s", res.StatusCode, raw)
	}
	if second, e := f.app.WorkerListener(); e == nil {
		second.Close()
		t.Fatal("live socket silently replaced")
	}
	file := filepath.Join(dir, "ordinary-file")
	if e = os.WriteFile(file, []byte("keep"), 0600); e != nil {
		t.Fatal(e)
	}
	if l, e := listenPrivateWorker(file); e == nil {
		l.Close()
		t.Fatal("ordinary file replaced by socket")
	}
	kept, _ := os.ReadFile(file)
	if string(kept) != "keep" {
		t.Fatal("socket setup damaged existing file")
	}
	os.Chmod(dir, 0755)
	if l, e := listenPrivateWorker(filepath.Join(dir, "unsafe.sock")); e == nil {
		l.Close()
		t.Fatal("non-private parent accepted")
	}
}
