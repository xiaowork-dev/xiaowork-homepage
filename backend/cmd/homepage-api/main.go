package main

import (
	"bufio"
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/netip"
	"net/url"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"github.com/xiaowork-dev/xiaowork-homepage/backend/internal/authn"
	"github.com/xiaowork-dev/xiaowork-homepage/backend/internal/contentdata"
	"github.com/xiaowork-dev/xiaowork-homepage/backend/internal/devtls"
	"github.com/xiaowork-dev/xiaowork-homepage/backend/internal/httpapi"
	"github.com/xiaowork-dev/xiaowork-homepage/backend/internal/store"
	"golang.org/x/term"
)

func main() {
	if err := run(); err != nil {
		log.Print(err)
		os.Exit(1)
	}
}
func run() error {
	if len(os.Args) != 2 {
		return errors.New("usage: homepage-api <serve|migrate|info|healthcheck|init-secret|init-admin|reset-admin|import-v1|prepare-dev|dev-ca>")
	}
	command := os.Args[1]
	if command == "healthcheck" {
		client := http.Client{Timeout: 2 * time.Second}
		res, e := client.Get("http://127.0.0.1:8081/readyz")
		if e != nil {
			return errors.New("healthcheck failed")
		}
		defer res.Body.Close()
		if res.StatusCode != 200 {
			return errors.New("healthcheck not ready")
		}
		return nil
	}
	secretPath := env("XIAOWORK_SECRET_PATH", ".data/v11-dev/secrets/session.key")
	authority := env("XIAOWORK_DEV_AUTHORITY_DIR", ".data/v11-dev/authority")
	tlsDir := env("XIAOWORK_DEV_TLS_DIR", ".data/v11-dev/tls")
	origin := env("XIAOWORK_ORIGIN", "https://localhost:3443")
	if command == "dev-ca" {
		b, e := os.ReadFile(filepath.Join(authority, "ca.crt"))
		if e != nil {
			return errors.New("local CA absent; run explicit prepare-dev first")
		}
		_, e = os.Stdout.Write(b)
		return e
	}
	if command == "init-secret" {
		if e := os.MkdirAll(filepath.Dir(secretPath), 0700); e != nil {
			return e
		}
		if e := authn.CreateSecret(secretPath); e != nil {
			return e
		}
		fmt.Println("Persistent session key created; no account created")
		return nil
	}
	allowed := map[string]bool{"serve": true, "migrate": true, "info": true, "init-admin": true, "reset-admin": true, "import-v1": true, "prepare-dev": true}
	if !allowed[command] {
		return errors.New("unsupported command")
	}
	create := command == "migrate" || command == "prepare-dev"
	if command == "prepare-dev" {
		u, e := url.Parse(origin)
		if e != nil || u.Scheme != "https" || (u.Hostname() != "localhost" && u.Hostname() != "127.0.0.1" && u.Hostname() != "::1") {
			return errors.New("prepare-dev only accepts a loopback HTTPS origin")
		}
	}
	path := env("XIAOWORK_DB_PATH", ".data/v11-dev/content.sqlite")
	if create {
		if e := os.MkdirAll(filepath.Dir(path), 0700); e != nil {
			return e
		}
	}
	db, e := store.Open(path, create)
	if e != nil {
		return e
	}
	defer db.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	if create {
		if e = store.Migrate(ctx, db); e != nil {
			return e
		}
		if command == "prepare-dev" {
			if e = os.MkdirAll(filepath.Dir(secretPath), 0700); e != nil {
				return e
			}
			if _, e = os.Lstat(secretPath); os.IsNotExist(e) {
				e = authn.CreateSecret(secretPath)
			}
			if e != nil {
				return e
			}
			if _, e = authn.ReadSecret(secretPath); e != nil {
				return e
			}
			if e = devtls.Ensure(authority, tlsDir); e != nil {
				return e
			}
		}
		fmt.Printf("schema=%d prepared explicitly; no account or business content seeded\n", store.SchemaVersion)
		return nil
	}
	if e = store.Check(ctx, db); e != nil {
		return e
	}
	if command == "info" {
		var v string
		if e = db.QueryRowContext(ctx, "SELECT sqlite_version()").Scan(&v); e != nil {
			return e
		}
		fmt.Printf("schema=%d sqlite=%s stage=p6b-api\n", store.SchemaVersion, v)
		return nil
	}
	if command == "init-admin" || command == "reset-admin" {
		if !term.IsTerminal(int(os.Stdin.Fd())) {
			return errors.New("administrator commands require an interactive TTY; password arguments, environment variables and pipes are not accepted")
		}
		var count int
		if e = db.QueryRowContext(ctx, "SELECT count(*) FROM administrators").Scan(&count); e != nil {
			return e
		}
		if command == "init-admin" && count != 0 {
			return errors.New("administrator already exists; refusing initialization")
		}
		if command == "reset-admin" && count != 1 {
			return errors.New("initialize the administrator first")
		}
		username := ""
		if command == "init-admin" {
			fmt.Fprint(os.Stderr, "Administrator username: ")
			line, e := bufio.NewReader(os.Stdin).ReadString('\n')
			if e != nil {
				return errors.New("cannot read username")
			}
			username = strings.TrimSpace(line)
			if !authn.ValidUsername(username) {
				return errors.New("invalid username")
			}
		}
		fmt.Fprint(os.Stderr, "New password (12-128 characters, hidden): ")
		password, e := term.ReadPassword(int(os.Stdin.Fd()))
		fmt.Fprintln(os.Stderr)
		if e != nil {
			return errors.New("cannot securely read password")
		}
		defer clear(password)
		if e = authn.ValidatePassword(password); e != nil {
			return e
		}
		fmt.Fprint(os.Stderr, "Confirm new password (hidden): ")
		confirmation, e := term.ReadPassword(int(os.Stdin.Fd()))
		fmt.Fprintln(os.Stderr)
		if e != nil {
			return errors.New("cannot securely read confirmation")
		}
		defer clear(confirmation)
		if !bytes.Equal(password, confirmation) {
			return errors.New("password confirmation does not match")
		}
		if command == "init-admin" {
			e = authn.InitAdministrator(ctx, db, username, password)
		} else {
			e = authn.ResetAdministrator(ctx, db, password)
		}
		if e != nil {
			return e
		}
		fmt.Println("Administrator operation completed; credentials were not printed")
		return nil
	}
	if command == "import-v1" {
		file, e := os.Open(env("XIAOWORK_IMPORT_PATH", "seed/v1.json"))
		if e != nil {
			return errors.New("reviewed seed file unavailable")
		}
		defer file.Close()
		result, e := contentdata.Import(ctx, db, io.LimitReader(file, 4<<20))
		if e != nil {
			return e
		}
		fmt.Printf("V1 import complete: %+v\n", result)
		return nil
	}
	secret, e := authn.ReadSecret(secretPath)
	if e != nil {
		return e
	}
	defer clear(secret)
	var proxies []netip.Prefix
	for _, raw := range strings.Split(os.Getenv("XIAOWORK_TRUSTED_PROXY_CIDRS"), ",") {
		if raw == "" {
			continue
		}
		p, e := netip.ParsePrefix(strings.TrimSpace(raw))
		if e != nil || p.Bits() == 0 {
			return errors.New("invalid trusted proxy CIDR")
		}
		proxies = append(proxies, p)
	}
	app, e := httpapi.New(db, httpapi.Config{Origin: origin, Secret: secret, UploadDir: env("XIAOWORK_UPLOAD_DIR", ".data/v11-dev/uploads"), TrustedProxyCIDRs: proxies,
		LocalPublish: os.Getenv("XIAOWORK_LOCAL_PUBLISH") == "1", PublicationsDir: os.Getenv("XIAOWORK_PUBLICATIONS_DIR"), PublicationVerifyURL: os.Getenv("XIAOWORK_PUBLICATION_VERIFY_URL"), WorkerSocket: os.Getenv("XIAOWORK_WORKER_SOCKET"), SourceRevision: os.Getenv("XIAOWORK_SOURCE_REVISION"), BuilderID: os.Getenv("XIAOWORK_BUILDER_ID")})
	if e != nil {
		return e
	}
	server := httpapi.Server(env("XIAOWORK_LISTEN", "127.0.0.1:8081"), app.Handler())
	stop, done := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer done()
	errs := make(chan error, 2)
	var workerServer *http.Server
	if os.Getenv("XIAOWORK_LOCAL_PUBLISH") == "1" {
		listener, err := app.WorkerListener()
		if err != nil {
			return err
		}
		defer listener.Close()
		workerServer = httpapi.Server("", app.WorkerHandler())
		workerServer.WriteTimeout = 90 * time.Second
		go func() { errs <- workerServer.Serve(listener) }()
	}
	go func() { errs <- server.ListenAndServe() }()
	log.Print("private draft API started; production publishing disabled")
	select {
	case e := <-errs:
		return e
	case <-stop.Done():
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if workerServer != nil {
			if e = workerServer.Shutdown(ctx); e != nil {
				return e
			}
		}
		return server.Shutdown(ctx)
	}
}
func env(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}
