package httpapi

import (
	"context"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"github.com/xiaowork-dev/xiaowork-homepage/backend/internal/store"
)

func TestScaffoldFailsClosed(t *testing.T) {
	db, err := store.Open(filepath.Join(t.TempDir(), "test.sqlite"), true)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if err := store.Migrate(context.Background(), db); err != nil {
		t.Fatal(err)
	}
	handler := Handler(db)
	for _, path := range []string{"/api/admin/v1", "/api/admin/v1/auth/login", "/api/admin/v1/projects", "/api/admin/v1/publish", "/api/admin/v1/media"} {
		for _, method := range []string{"GET", "POST", "PUT", "DELETE"} {
			response := httptest.NewRecorder()
			handler.ServeHTTP(response, httptest.NewRequest(method, path, nil))
			if response.Code != http.StatusServiceUnavailable || response.Header().Get("Cache-Control") != "no-store" || response.Header().Get("X-Robots-Tag") != "noindex, nofollow" || response.Header().Get("Set-Cookie") != "" {
				t.Fatalf("management scaffold unexpectedly open: %s %s %d", method, path, response.Code)
			}
		}
	}
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, httptest.NewRequest("GET", "/readyz", nil))
	if response.Code != 200 {
		t.Fatal(response.Code)
	}
	db.Close()
	response = httptest.NewRecorder()
	handler.ServeHTTP(response, httptest.NewRequest("GET", "/readyz", nil))
	if response.Code != 503 {
		t.Fatal("closed database must not be ready")
	}
}
