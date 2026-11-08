//go:build windows

package publishgate

import "io/fs"

// Windows is a development platform only; production runs on Linux.
func ownedSingleLink(fs.FileInfo) error { return nil }

func syncDir(string) error { return nil }
