// Trusted offline control-volume provisioning and maintenance protocol. This
// executable is present only in the maintenance image, never API or Worker.
package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"os"
	"time"

	"github.com/xiaowork-dev/xiaowork-homepage/backend/internal/maintenancegate"
	"github.com/xiaowork-dev/xiaowork-homepage/backend/internal/publishgate"
)

func main() {
	root := flag.String("root", "/control", "dedicated persistent control directory")
	owner := flag.String("owner", "", "offline operation owner UUID")
	// Production publishing authorization (authorize-publish / revoke-publish).
	project := flag.String("project", "", "exact V1.1 project name")
	source := flag.String("source", "", "complete reviewed source SHA")
	schema := flag.Int("schema", 0, "reviewed SQLite schema version")
	workerImage := flag.String("worker-image", "", "reviewed worker image ID")
	apiImage := flag.String("api-image", "", "reviewed API image ID")
	days := flag.Int("days", 7, "authorization validity in days (1-30)")
	backupPath := flag.String("backup-path", "", "host path of the verified backup")
	backupSHA := flag.String("backup-manifest-sha256", "", "verified backup content manifest SHA256")
	backupAt := flag.String("backup-verified-at", "", "RFC3339 time the backup was verified")
	note := flag.String("note", "", "non-secret approval or revocation note")
	flag.Parse()
	if flag.NArg() != 1 {
		fail(maintenancegate.ErrBlocked)
	}
	switch flag.Arg(0) {
	case "authorize-publish":
		if *days < 1 || *days > 30 {
			fail(errors.New("days must be between 1 and 30"))
		}
		verified, err := time.Parse(time.RFC3339Nano, *backupAt)
		if err != nil {
			fail(errors.New("backup-verified-at must be RFC3339"))
		}
		id, err := publishgate.NewID()
		if err != nil {
			fail(err)
		}
		now := time.Now().UTC()
		a := publishgate.Authorization{
			Format: 1, ID: id, Project: *project, Origin: publishgate.ProductionOrigin,
			Source: *source, Schema: *schema, WorkerImage: *workerImage, APIImage: *apiImage,
			IssuedAt: now, ExpiresAt: now.Add(time.Duration(*days) * 24 * time.Hour),
			Backup:       publishgate.Backup{Path: *backupPath, ContentManifestSHA256: *backupSHA, VerifiedAt: verified.UTC()},
			ApprovalNote: *note,
		}
		if err = publishgate.Authorize(*root, a); err != nil {
			fail(err)
		}
		emit(publishgate.Inspect(*root))
		return
	case "revoke-publish":
		if _, err := publishgate.Revoke(*root, *note, time.Now()); err != nil {
			fail(err)
		}
		emit(publishgate.Inspect(*root))
		return
	case "publish-status":
		emit(publishgate.Inspect(*root))
		return
	}
	var e error
	switch flag.Arg(0) {
	case "init":
		e = maintenancegate.Init(*root)
	case "begin":
		ctx, cancel := context.WithTimeout(context.Background(), 12*time.Minute)
		defer cancel()
		e = maintenancegate.Begin(ctx, *root, *owner)
	case "complete":
		e = maintenancegate.Complete(*root, *owner)
	case "status":
	default:
		e = maintenancegate.ErrBlocked
	}
	if e != nil {
		fail(e)
	}
	s, e := maintenancegate.Inspect(*root)
	if e != nil {
		fail(e)
	}
	emit(s)
}

func emit(v any) {
	if e := json.NewEncoder(os.Stdout).Encode(v); e != nil {
		os.Exit(1)
	}
}

func fail(e error) {
	fmt.Fprintln(os.Stderr, e)
	os.Exit(1)
}
