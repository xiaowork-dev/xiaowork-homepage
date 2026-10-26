package devtls

import (
	"bytes"
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

func TestLocalTLSIsStableAndRefusesPartialState(t *testing.T) {
	root := t.TempDir()
	ca, server := filepath.Join(root, "ca"), filepath.Join(root, "server")
	if e := Ensure(ca, server); e != nil {
		t.Fatal(e)
	}
	before, _ := os.ReadFile(filepath.Join(ca, "ca.crt"))
	if e := Ensure(ca, server); e != nil {
		t.Fatal(e)
	}
	after, _ := os.ReadFile(filepath.Join(ca, "ca.crt"))
	if string(before) != string(after) {
		t.Fatal("CA changed on repeat")
	}
	if e := os.Remove(filepath.Join(server, "tls.crt")); e != nil {
		t.Fatal(e)
	}
	if Ensure(ca, server) == nil {
		t.Fatal("partial credentials must fail closed")
	}
}

func TestLocalTLSRejectsBroadPOSIXFilePermissions(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("Windows chmod does not prove POSIX private-key permissions; run this check in the Linux test container")
	}
	for _, relative := range []string{"ca/ca.key", "server/tls.key", "ca/ca.crt", "server/tls.crt"} {
		t.Run(relative, func(t *testing.T) {
			root := t.TempDir()
			ca, server := filepath.Join(root, "ca"), filepath.Join(root, "server")
			if err := Ensure(ca, server); err != nil {
				t.Fatal(err)
			}
			path := filepath.Join(root, filepath.FromSlash(relative))
			before, err := os.ReadFile(path)
			if err != nil {
				t.Fatal(err)
			}
			if info, err := os.Stat(path); err != nil || info.Mode().Perm() != 0600 {
				t.Fatal("new TLS credential is not mode 0600", err)
			}
			if err = os.Chmod(path, 0644); err != nil {
				t.Fatal(err)
			}
			if err = Ensure(ca, server); err == nil {
				t.Fatal("group/other-readable TLS credential accepted")
			}
			after, err := os.ReadFile(path)
			if err != nil || !bytes.Equal(before, after) {
				t.Fatal("rejected credential was silently replaced", err)
			}
			if err = os.Chmod(path, 0600); err != nil {
				t.Fatal(err)
			}
			if err = Ensure(ca, server); err != nil {
				t.Fatal("restored private credential should be usable", err)
			}
		})
	}
}

func TestLocalTLSRejectsBroadPOSIXDirectoryPermissions(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("Windows chmod does not prove POSIX private-directory permissions; run this check in the Linux test container")
	}
	for _, relative := range []string{"ca", "server"} {
		t.Run(relative, func(t *testing.T) {
			root := t.TempDir()
			ca, server := filepath.Join(root, "ca"), filepath.Join(root, "server")
			if err := Ensure(ca, server); err != nil {
				t.Fatal(err)
			}
			directory := filepath.Join(root, relative)
			if info, err := os.Stat(directory); err != nil || info.Mode().Perm() != 0700 {
				t.Fatal("new TLS directory is not mode 0700", err)
			}
			if err := os.Chmod(directory, 0755); err != nil {
				t.Fatal(err)
			}
			if err := Ensure(ca, server); err == nil {
				t.Fatal("group/other-accessible TLS directory accepted")
			}
			if err := os.Chmod(directory, 0700); err != nil {
				t.Fatal(err)
			}
			if err := Ensure(ca, server); err != nil {
				t.Fatal("restored private TLS directory should be usable", err)
			}
		})
	}
}

func TestLocalTLSRejectsInitiallyBroadPOSIXDirectories(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("Windows chmod does not prove POSIX initial-directory permissions; run this check in the Linux test container")
	}
	for _, relative := range []string{"ca", "server"} {
		t.Run(relative, func(t *testing.T) {
			root := t.TempDir()
			ca, server := filepath.Join(root, "ca"), filepath.Join(root, "server")
			directory := filepath.Join(root, relative)
			if err := os.MkdirAll(directory, 0700); err != nil {
				t.Fatal(err)
			}
			if err := os.Chmod(directory, 0755); err != nil {
				t.Fatal(err)
			}
			if err := Ensure(ca, server); err == nil {
				t.Fatal("first-time TLS preparation accepted an existing broad-permission directory")
			}
			for _, path := range []string{filepath.Join(ca, "ca.crt"), filepath.Join(ca, "ca.key"), filepath.Join(server, "tls.crt"), filepath.Join(server, "tls.key")} {
				if _, err := os.Stat(path); !os.IsNotExist(err) {
					t.Fatal("rejected first-time preparation wrote TLS credentials", err)
				}
			}
			if err := os.Chmod(directory, 0700); err != nil {
				t.Fatal(err)
			}
			if err := Ensure(ca, server); err != nil {
				t.Fatal("first-time preparation should work after explicit permission repair", err)
			}
		})
	}
}
