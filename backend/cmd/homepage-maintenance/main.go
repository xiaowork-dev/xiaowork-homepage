package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"os"
	"time"

	"github.com/xiaowork-dev/xiaowork-homepage/backend/internal/maintenance"
)

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, "maintenance refused:", err)
		os.Exit(1)
	}
}
func run() error {
	if len(os.Args) < 2 {
		return errors.New("usage: homepage-maintenance inspect|backup|verify|restore|compatible|inspect-current|repair-current [flags]")
	}
	f := flag.NewFlagSet(os.Args[1], flag.ContinueOnError)
	source := f.String("source", "/source", "fixed mounted data root")
	target := f.String("target", "/backup/set", "new destination")
	schema := f.Int("schema", 0, "expected database schema")
	member := f.String("member", "", "one exact redundant current.next member")
	plan := f.String("plan-sha256", "", "previously inspected maintenance plan digest")
	reason := f.String("reason", "", "non-secret operator audit reason")
	if err := f.Parse(os.Args[2:]); err != nil {
		return err
	}
	if f.NArg() != 0 {
		return errors.New("unexpected arguments")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()
	var value any
	var err error
	switch os.Args[1] {
	case "inspect":
		value, err = maintenance.Inspect(ctx, *source)
	case "backup":
		value, err = maintenance.Backup(ctx, *source, *target)
	case "verify":
		value, err = maintenance.Verify(ctx, *source)
	case "restore":
		value, err = maintenance.Restore(ctx, *source, *target)
	case "compatible":
		err = maintenance.Compatible(*schema)
		value = map[string]bool{"compatible": err == nil}
	case "inspect-current":
		value, err = maintenance.InspectCurrentRepair(ctx, *source)
	case "repair-current":
		value, err = maintenance.RepairCurrent(ctx, *source, *member, *plan, *reason)
	case "secret-status":
		var ready bool
		ready, err = maintenance.SecretStatus(*source)
		value = map[string]bool{"ready": ready}
	default:
		return errors.New("unknown command")
	}
	if err != nil {
		return err
	}
	return json.NewEncoder(os.Stdout).Encode(value)
}
