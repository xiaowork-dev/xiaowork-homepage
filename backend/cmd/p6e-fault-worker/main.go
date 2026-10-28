//go:build p6e_fault && linux

// This executable is built only by the dedicated P6-E test Dockerfile. It is
// absent from every application/production image and has no HTTP listener.
package main

import (
	"context"
	"flag"
	"fmt"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/xiaowork-dev/xiaowork-homepage/backend/internal/publishfs"
	"github.com/xiaowork-dev/xiaowork-homepage/backend/internal/publishmodel"
	"github.com/xiaowork-dev/xiaowork-homepage/backend/internal/publishworker"
)

type checkpointControl struct {
	publishworker.Control
	stopBeforeResult bool
}

func stop(point string) {
	fmt.Println("P6E_TEST_CHECKPOINT " + point)
	// Linux PID namespace init can ignore a self-directed SIGSTOP. Wait on a
	// fixed private tmpfs sentinel instead; the external harness can SIGKILL
	// the container or explicitly continue only this test executable.
	for {
		if _, err := os.Stat("/tmp/p6e-continue"); err == nil {
			_ = os.Remove("/tmp/p6e-continue")
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
}

func (c checkpointControl) Result(ctx context.Context, id string, request publishmodel.ResultRequest) (publishmodel.ResultResponse, error) {
	if c.stopBeforeResult && request.Outcome == "activated" {
		stop("before-result-http")
	}
	return c.Control.Result(ctx, id, request)
}

func main() {
	mode := flag.String("test-mode", "none", "fixed isolated acceptance checkpoint")
	source := flag.String("source-revision", "", "reviewed source")
	builder := flag.String("builder-id", "", "reviewed builder")
	flag.Parse()
	if !publishmodel.SourceHash.MatchString(*source) || *builder == "" || flag.NArg() != 0 {
		os.Exit(2)
	}
	allowed := map[string]bool{"none": true, "before-current-rename": true, "after-current-rename": true, "after-receipt": true, "before-result-http": true}
	if !allowed[*mode] {
		os.Exit(2)
	}
	store, err := publishfs.Open("/publications")
	if err != nil {
		os.Exit(3)
	}
	defer store.Close()
	if *mode != "none" && *mode != "before-result-http" {
		store.SetFaultForTest(func(point string) error {
			if point == *mode {
				stop(point)
			}
			return nil
		})
	}
	control, err := publishworker.NewUnixClient("/run/publishing/publisher.sock")
	if err != nil {
		os.Exit(4)
	}
	ctx, cancel := signal.NotifyContext(context.Background(), syscall.SIGTERM, syscall.SIGINT)
	defer cancel()
	runner := publishworker.Runner{Control: checkpointControl{control, *mode == "before-result-http"}, Store: store, Builder: publishworker.FixedBuilder{}, SourceRevision: *source, BuilderID: *builder}
	if err = runner.Run(ctx); err != nil && ctx.Err() == nil {
		fmt.Println("P6E_TEST_WORKER_STOPPED_RECOVERY_REQUIRED")
		os.Exit(1)
	}
}
