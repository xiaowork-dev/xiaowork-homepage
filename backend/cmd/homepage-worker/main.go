package main

import (
	"context"
	"flag"
	"fmt"
	"os"
	"os/signal"
	"runtime"
	"syscall"

	"github.com/xiaowork-dev/xiaowork-homepage/backend/internal/publishfs"
	"github.com/xiaowork-dev/xiaowork-homepage/backend/internal/publishmodel"
	"github.com/xiaowork-dev/xiaowork-homepage/backend/internal/publishworker"
)

func main() {
	socket := flag.String("socket", "/run/publishing/publisher.sock", "private API Unix socket")
	root := flag.String("root", "/publications", "publication volume")
	source := flag.String("source-revision", "", "reviewed source commit SHA")
	builder := flag.String("builder-id", "", "immutable reviewed builder identity")
	flag.Parse()
	if runtime.GOOS != "linux" || !publishmodel.SourceHash.MatchString(*source) || *builder == "" || len(*builder) > 160 || flag.NArg() != 0 {
		fmt.Fprintln(os.Stderr, "worker requires Linux, reviewed source revision and immutable builder identity")
		os.Exit(2)
	}
	store, err := publishfs.Open(*root)
	if err != nil {
		fmt.Fprintln(os.Stderr, "publication filesystem unavailable")
		os.Exit(1)
	}
	defer store.Close()
	control, err := publishworker.NewUnixClient(*socket)
	if err != nil {
		fmt.Fprintln(os.Stderr, "private publisher socket invalid")
		os.Exit(1)
	}
	ctx, cancel := signal.NotifyContext(context.Background(), syscall.SIGTERM, syscall.SIGINT)
	defer cancel()
	runner := publishworker.Runner{Control: control, Store: store, Builder: publishworker.FixedBuilder{}, SourceRevision: *source, BuilderID: *builder}
	if err = runner.Run(ctx); err != nil && ctx.Err() == nil {
		fmt.Fprintln(os.Stderr, "worker stopped; publication gate requires reconciliation")
		os.Exit(1)
	}
}
