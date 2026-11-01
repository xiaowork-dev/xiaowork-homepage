// Trusted offline control-volume provisioning and maintenance protocol. This
// executable is present only in the maintenance image, never API or Worker.
package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"time"

	"github.com/xiaowork-dev/xiaowork-homepage/backend/internal/maintenancegate"
)

func main() {
	root := flag.String("root", "/control", "dedicated persistent control directory")
	owner := flag.String("owner", "", "offline operation owner UUID")
	flag.Parse()
	var e error
	if flag.NArg() != 1 {
		e = maintenancegate.ErrBlocked
	} else {
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
	}
	if e != nil {
		fmt.Fprintln(os.Stderr, e)
		os.Exit(1)
	}
	s, e := maintenancegate.Inspect(*root)
	if e != nil {
		fmt.Fprintln(os.Stderr, e)
		os.Exit(1)
	}
	if e = json.NewEncoder(os.Stdout).Encode(s); e != nil {
		os.Exit(1)
	}
}
