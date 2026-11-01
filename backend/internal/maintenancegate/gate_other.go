//go:build !linux

package maintenancegate

import "context"

func enter(string, bool) (func(), error)          { return nil, ErrBlocked }
func initialize(string) error                     { return ErrBlocked }
func inspect(string) (State, error)               { return State{}, ErrBlocked }
func begin(context.Context, string, string) error { return ErrBlocked }
func complete(string, string) error               { return ErrBlocked }
