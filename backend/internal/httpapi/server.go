package httpapi

import (
	"context"
	"database/sql"
	"errors"
	"github.com/xiaowork-dev/xiaowork-homepage/backend/internal/store"
	"log"
	"net/http"
	"net/netip"
	"net/url"
	"os"
	"strings"
	"time"
)

const apiPrefix = "/api/admin/v1"

type Config struct {
	Origin            string
	Secret            []byte
	UploadDir         string
	TrustedProxyCIDRs []netip.Prefix
	Clock             func() time.Time
}
type App struct {
	db         *sql.DB
	config     Config
	now        func() time.Time
	authSlots  chan struct{}
	authQueue  chan struct{}
	uploadSlot chan struct{}
}

func New(db *sql.DB, config Config) (*App, error) {
	u, err := url.Parse(config.Origin)
	if err != nil || u.Scheme != "https" || u.Host == "" || u.User != nil || u.Path != "" || u.RawQuery != "" || u.Fragment != "" || u.String() != config.Origin {
		return nil, errors.New("an exact approved HTTPS origin is required")
	}
	if u.Hostname() != "xiaoworks.com" && u.Hostname() != "localhost" && u.Hostname() != "127.0.0.1" && u.Hostname() != "::1" {
		return nil, errors.New("only fixed production or exact loopback origin allowed")
	}
	if u.Hostname() == "xiaoworks.com" && config.Origin != "https://xiaoworks.com" {
		return nil, errors.New("production origin is fixed")
	}
	if len(config.Secret) != 32 || config.UploadDir == "" {
		return nil, errors.New("persistent 32-byte secret and private uploads required")
	}
	if err = os.MkdirAll(config.UploadDir, 0700); err != nil {
		return nil, errors.New("private uploads unavailable")
	}
	if err = store.Check(context.Background(), db); err != nil {
		return nil, err
	}
	clock := config.Clock
	if clock == nil {
		clock = time.Now
	}
	config.Secret = append([]byte(nil), config.Secret...)
	return &App{db: db, config: config, now: clock, authSlots: make(chan struct{}, 2), authQueue: make(chan struct{}, 4), uploadSlot: make(chan struct{}, 1)}, nil
}
func (a *App) Handler() http.Handler {
	management := http.NewServeMux()
	a.registerAuth(management)
	a.registerContent(management)
	a.registerMedia(management)
	unavailable := func(w http.ResponseWriter, r *http.Request) {
		writeError(w, r, problem(503, "WORKER_UNAVAILABLE", "静态预览、发布与恢复将在 P6-D 实现。"))
	}
	for _, p := range []string{"/publish-jobs", "/preview-jobs", "/rollback-jobs", "/jobs", "/jobs/", "/releases", "/releases/", "/previews/"} {
		management.HandleFunc(apiPrefix+p, unavailable)
	}
	management.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		var allowed []string
		for _, method := range []string{"GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"} {
			probe := r.Clone(r.Context())
			probe.Method = method
			_, pattern := management.Handler(probe)
			if pattern != "/" {
				allowed = append(allowed, method)
			}
		}
		if len(allowed) != 0 {
			w.Header().Set("Allow", strings.Join(allowed, ", "))
			writeError(w, r, problem(405, "METHOD_NOT_ALLOWED", "此接口不支持该方法。"))
			return
		}
		writeError(w, r, problem(404, "NOT_FOUND", "接口不存在。"))
	})
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, r *http.Request) {
		writeData(w, r, 200, map[string]string{"status": "ok", "stage": "p6b-api"})
	})
	mux.HandleFunc("GET /readyz", func(w http.ResponseWriter, r *http.Request) {
		if err := store.Check(r.Context(), a.db); err != nil {
			writeError(w, r, problem(503, "NOT_READY", "数据库未就绪。"))
			return
		}
		writeData(w, r, 200, map[string]string{"status": "ready", "stage": "p6b-api"})
	})
	guarded := a.authorize(management)
	mux.Handle(apiPrefix, guarded)
	mux.Handle(apiPrefix+"/", guarded)
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		writeError(w, r, problem(404, "NOT_FOUND", "接口不存在。"))
	})
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		state := &requestState{ID: newID("req")}
		r = r.WithContext(context.WithValue(r.Context(), requestStateKey{}, state))
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("X-Robots-Tag", "noindex, nofollow, noarchive")
		w.Header().Set("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'")
		w.Header().Set("Referrer-Policy", "no-referrer")
		defer func() {
			if recover() != nil {
				log.Printf("request failed id=%s", state.ID)
				writeError(w, r, problem(500, "INTERNAL_ERROR", "请求处理失败。"))
			}
		}()
		mux.ServeHTTP(w, r)
	})
}
func Server(address string, handler http.Handler) *http.Server {
	return &http.Server{Addr: address, Handler: handler, ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 30 * time.Second, WriteTimeout: 30 * time.Second, IdleTimeout: 60 * time.Second, MaxHeaderBytes: 16 << 10}
}
