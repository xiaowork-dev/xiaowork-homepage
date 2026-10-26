package httpapi

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"time"

	"github.com/xiaowork-dev/xiaowork-homepage/backend/internal/store"
)

func Handler(db *sql.DB) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, r *http.Request) {
		respond(w, http.StatusOK, map[string]string{"status": "ok", "stage": "p6a-scaffold"})
	})
	mux.HandleFunc("GET /readyz", func(w http.ResponseWriter, r *http.Request) {
		if err := store.Check(r.Context(), db); err != nil {
			respond(w, http.StatusServiceUnavailable, map[string]string{"status": "not-ready"})
			return
		}
		respond(w, http.StatusOK, map[string]string{"status": "ready", "stage": "p6a-scaffold"})
	})
	// Fail closed until P6-B implements and tests authentication. There is no CRUD/login stub.
	unavailable := func(w http.ResponseWriter, r *http.Request) {
		respond(w, http.StatusServiceUnavailable, map[string]string{"code": "ADMIN_NOT_IMPLEMENTED", "message": "P6-A 开发骨架，管理功能尚未实现"})
	}
	mux.HandleFunc("/api/admin/v1", unavailable)
	mux.HandleFunc("/api/admin/v1/", unavailable)
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		respond(w, http.StatusNotFound, map[string]string{"code": "NOT_FOUND"})
	})
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("X-Robots-Tag", "noindex, nofollow")
		w.Header().Set("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'")
		mux.ServeHTTP(w, r)
	})
}

func Server(address string, db *sql.DB) *http.Server {
	return &http.Server{
		Addr: address, Handler: Handler(db), ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout: 15 * time.Second, WriteTimeout: 15 * time.Second,
		IdleTimeout: 60 * time.Second, MaxHeaderBytes: 16 << 10,
	}
}

func respond(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}
