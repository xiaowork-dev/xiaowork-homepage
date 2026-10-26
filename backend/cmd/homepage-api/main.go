package main

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	"github.com/xiaowork-dev/xiaowork-homepage/backend/internal/httpapi"
	"github.com/xiaowork-dev/xiaowork-homepage/backend/internal/store"
)

func main() {
	if err := run(); err != nil {
		log.Print(err)
		os.Exit(1)
	}
}

func run() error {
	if len(os.Args) != 2 {
		return errors.New("usage: homepage-api <serve|migrate|info|healthcheck>")
	}
	command := os.Args[1]
	if command == "healthcheck" {
		client := http.Client{Timeout: 2 * time.Second}
		response, err := client.Get("http://127.0.0.1:8081/readyz")
		if err != nil {
			return errors.New("healthcheck failed")
		}
		defer response.Body.Close()
		if response.StatusCode != http.StatusOK {
			return errors.New("healthcheck not ready")
		}
		return nil
	}
	if command != "serve" && command != "migrate" && command != "info" {
		return errors.New("unsupported command")
	}
	path := env("XIAOWORK_DB_PATH", ".data/v11-dev/content.sqlite")
	if command == "migrate" {
		if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
			return err
		}
	}
	db, err := store.Open(path, command == "migrate")
	if err != nil {
		return err
	}
	defer db.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if command == "migrate" {
		if err := store.Migrate(ctx, db); err != nil {
			return err
		}
		fmt.Println("P6-A schema initialized; no administrator or content has been seeded")
		return nil
	}
	if err := store.Check(ctx, db); err != nil {
		return err
	}
	if command == "info" {
		var version string
		if err := db.QueryRowContext(ctx, "SELECT sqlite_version()").Scan(&version); err != nil {
			return err
		}
		fmt.Printf("schema=%d sqlite=%s stage=p6a-scaffold\n", store.SchemaVersion, version)
		return nil
	}
	server := httpapi.Server(env("XIAOWORK_LISTEN", "127.0.0.1:8081"), db)
	stop, done := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer done()
	errors := make(chan error, 1)
	go func() { errors <- server.ListenAndServe() }()
	log.Print("P6-A API scaffold started; management endpoints disabled")
	select {
	case err := <-errors:
		return err
	case <-stop.Done():
		shutdown, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		return server.Shutdown(shutdown)
	}
}

func env(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}
