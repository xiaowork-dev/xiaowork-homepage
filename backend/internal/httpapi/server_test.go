package httpapi

import (
	"bytes"
	"context"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"github.com/xiaowork-dev/xiaowork-homepage/backend/internal/store"
)

func TestManagementRequiresApprovedOriginSecretAndHTTPS(t *testing.T) {
	db, err := store.Open(filepath.Join(t.TempDir(), "server.sqlite"), true)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if err := store.Migrate(context.Background(), db); err != nil {
		t.Fatal(err)
	}
	for _, config := range []Config{
		{Origin: "http://127.0.0.1:3210", Secret: bytes.Repeat([]byte{1}, 32), UploadDir: t.TempDir()},
		{Origin: "https://attacker.invalid", Secret: bytes.Repeat([]byte{1}, 32), UploadDir: t.TempDir()},
		{Origin: "https://xiaoworks.com:443", Secret: bytes.Repeat([]byte{1}, 32), UploadDir: t.TempDir()},
		{Origin: "https://127.0.0.1:3210", Secret: nil, UploadDir: t.TempDir()},
	} {
		if _, err = New(db, config); err == nil {
			t.Fatal("unsafe origin or missing secret accepted")
		}
	}
	app, err := New(db, Config{Origin: "https://127.0.0.1:3210", Secret: bytes.Repeat([]byte{1}, 32), UploadDir: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	for _, path := range []string{"/api/admin/v1", "/api/admin/v1/projects", "/api/admin/v1/media", "/api/admin/v1/auth/login-challenge"} {
		recorder := httptest.NewRecorder()
		request := httptest.NewRequest("GET", "http://127.0.0.1:3210"+path, nil)
		request.Header.Set("X-Forwarded-Proto", "https")
		app.Handler().ServeHTTP(recorder, request)
		if recorder.Code != 400 || recorder.Header().Get("Set-Cookie") != "" {
			t.Fatalf("insecure request accepted: %s %d", path, recorder.Code)
		}
	}
}

func TestHealthReadinessAndUnimplementedPublishing(t *testing.T) {
	f := newAuthFixture(t)
	for _, path := range []string{"/healthz", "/readyz"} {
		response, err := f.server.Client().Get(f.server.URL + path)
		if err != nil {
			t.Fatal(err)
		}
		response.Body.Close()
		if response.StatusCode != 200 || response.Header.Get("Cache-Control") != "no-store" {
			t.Fatalf("health failure %s %d", path, response.StatusCode)
		}
	}
	client := f.client(t)
	f.request(t, client, "GET", "/projects", nil, "", 401)
	csrf, _ := f.loginAs(t, client, "xiaowork", authTestPassword, 200)
	for _, path := range []string{"/publish-jobs", "/preview-jobs", "/rollback-jobs"} {
		envelope, _ := f.request(t, client, "POST", path, map[string]any{}, csrf, 503)
		if envelope["error"].(map[string]any)["code"] != "WORKER_UNAVAILABLE" {
			t.Fatal("unimplemented publishing returned unexpected result")
		}
	}
	f.request(t, client, "GET", "/not-a-real-interface", nil, "", 404)
	if _, err := f.db.Exec("UPDATE schema_migrations SET checksum=? WHERE version=(SELECT max(version) FROM schema_migrations)", "changed"); err != nil {
		t.Fatal(err)
	}
	response, err := f.server.Client().Get(f.server.URL + "/readyz")
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if response.StatusCode != http.StatusServiceUnavailable {
		t.Fatal("schema drift must fail readiness")
	}
}
