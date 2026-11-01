// Package maintenancegate coordinates trusted offline maintenance with API and
// publisher processes. Runtime mounts are read-only; only the offline operator
// can change the durable state. Kernel locks and the state serve different roles.
package maintenancegate

import (
	"context"
	"errors"
)

var ErrBlocked = errors.New("maintenance barrier unavailable or recovery required")

type State struct {
	Format int    `json:"format"`
	Mode   string `json:"mode"`
	Phase  string `json:"phase"`
	Owner  string `json:"owner"`
}

// Enter holds a shared activity lease until Close. Its admission/state check is
// serialized with Begin; do not release it before the SQLite commit or result.
func Enter(root string) (func(), error) { return enter(root, false) }

// Continue is only for the private same-UID worker result/heartbeat protocol.
// It permits finishing an already admitted task while maintenance drains it.
// New claims MUST use Enter instead.
func Continue(root string) (func(), error) { return enter(root, true) }

func Init(root string) error                              { return initialize(root) }
func Inspect(root string) (State, error)                  { return inspect(root) }
func Begin(ctx context.Context, root, owner string) error { return begin(ctx, root, owner) }
func Complete(root, owner string) error                   { return complete(root, owner) }
