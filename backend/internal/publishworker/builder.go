package publishworker

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"github.com/xiaowork-dev/xiaowork-homepage/backend/internal/publishfs"
	"github.com/xiaowork-dev/xiaowork-homepage/backend/internal/publishmodel"
)

const SourceRoot = "/builder"
const WorkRoot = "/work"
const UploadRoot = "/uploads"
const NodeExecutable = "/usr/local/bin/node"
const NuxtCLI = "/builder/node_modules/nuxt/bin/nuxt.mjs"
const BuildTimeout = 10 * time.Minute

type Builder interface {
	Build(context.Context, publishmodel.Assignment) (string, func(), error)
}

// FixedBuilder has no job-configurable command, source path, executable,
// network target or environment. The paths below are fixed by the image.
type FixedBuilder struct{}

func (FixedBuilder) Build(parent context.Context, job publishmodel.Assignment) (string, func(), error) {
	noop := func() {}
	if !publishfs.ValidID(job.ID, "job") {
		return "", noop, errors.New("invalid build identity")
	}
	if err := checkOrphanBuild(WorkRoot); err != nil {
		return "", noop, err
	}
	work := filepath.Join(WorkRoot, job.ID)
	if err := os.Mkdir(work, 0700); err != nil {
		return "", noop, errors.New("build directory unavailable")
	}
	cleanup := func() { _ = os.RemoveAll(work) } // generated immediate child, never a user path
	if err := prepareSource(SourceRoot, work); err != nil {
		return "", cleanup, err
	}
	if err := os.WriteFile(filepath.Join(work, "content-snapshot.json"), job.Snapshot, 0600); err != nil {
		return "", cleanup, err
	}
	if err := copyMedia(UploadRoot, work, job); err != nil {
		return "", cleanup, err
	}
	if err := os.Mkdir(filepath.Join(work, "tmp"), 0700); err != nil {
		return "", cleanup, err
	}
	ctx, cancel := context.WithTimeout(parent, BuildTimeout)
	defer cancel()
	cmd := exec.CommandContext(ctx, NodeExecutable, NuxtCLI, "generate", work)
	cmd.Dir = work
	cmd.Env = []string{"PATH=/usr/local/bin:/usr/bin", "HOME=" + work, "TMPDIR=" + filepath.Join(work, "tmp"), "NODE_ENV=production", "CI=1", "NUXT_TELEMETRY_DISABLED=1", "NUXT_PUBLIC_SITE_URL=https://xiaoworks.com", "XIAOWORK_SNAPSHOT_FILE=" + filepath.Join(work, "content-snapshot.json"), "XIAOWORK_SNAPSHOT_SHA256=" + job.SnapshotSHA256, "XIAOWORK_RELEASE_ID=" + job.ReleaseID}
	if job.Kind == "preview" {
		cmd.Env = append(cmd.Env, "XIAOWORK_PREVIEW_ID="+job.ReleaseID)
	}
	// Build output may contain content. It is bounded and discarded, never
	// returned to the API, browser, audit logs, or parent process stdout.
	output := &discardAfter{remaining: 64 << 10}
	cmd.Stdout = output
	cmd.Stderr = output
	configureProcess(cmd)
	if err := cmd.Start(); err != nil {
		return "", cleanup, errors.New("fixed builder start failed")
	}
	if err := recordBuild(WorkRoot, cmd.Process.Pid); err != nil {
		_ = killProcessTree(cmd)
		_ = cmd.Wait()
		return "", cleanup, err
	}
	err := cmd.Wait()
	// Always kill remaining descendants, including children that outlived an
	// otherwise successful Node leader, before deleting its process journal.
	if terminateErr := killProcessTree(cmd); terminateErr != nil && err == nil {
		err = terminateErr
	}
	if clearErr := clearBuild(WorkRoot); clearErr != nil && err == nil {
		err = clearErr
	}
	if err != nil {
		return "", cleanup, errors.New("fixed offline build failed")
	}
	return filepath.Join(work, ".output", "public"), cleanup, nil
}

type discardAfter struct{ remaining int }

func (b *discardAfter) Write(p []byte) (int, error) {
	b.remaining -= min(len(p), max(b.remaining, 0))
	return len(p), nil
}

var sourceDirectories = []string{"app", "shared", "server"}
var sourceFiles = []string{"nuxt.config.ts", "package.json", "package-lock.json", "tsconfig.json"}

func prepareSource(source, destination string) error {
	r, err := os.OpenRoot(source)
	if err != nil {
		return err
	}
	defer r.Close()
	for _, name := range sourceFiles {
		if err = copyRegular(r, name, filepath.Join(destination, name), 16<<20, ""); err != nil {
			return err
		}
	}
	for _, directory := range sourceDirectories {
		if err = os.Mkdir(filepath.Join(destination, directory), 0700); err != nil {
			return err
		}
		sub, err := r.OpenRoot(directory)
		if err != nil {
			return err
		}
		count := 0
		var total int64
		err = fs.WalkDir(sub.FS(), ".", func(name string, e fs.DirEntry, err error) error {
			if err != nil {
				return err
			}
			if name == "." {
				return nil
			}
			if !publishfs.SafePath(name) || e.Type()&os.ModeSymlink != 0 {
				return publishfs.ErrUnsafe
			}
			if e.IsDir() {
				return os.Mkdir(filepath.Join(destination, directory, filepath.FromSlash(name)), 0700)
			}
			info, err := e.Info()
			if err != nil {
				return err
			}
			count++
			total += info.Size()
			if count > 20000 || total > 128<<20 {
				return publishfs.ErrUnsafe
			}
			return copyRegular(sub, name, filepath.Join(destination, directory, filepath.FromSlash(name)), 16<<20, "")
		})
		sub.Close()
		if err != nil {
			return err
		}
	}
	if err = os.Mkdir(filepath.Join(destination, "public"), 0700); err != nil {
		return err
	}
	// Repository-owned assets are a closed allowlist. README files and any
	// future accidental public upload are not automatically included.
	paths := map[string]bool{"theme-init.js": true, "health.json": true, "images/projects/placeholder.svg": true}
	for _, p := range publishmodel.BuiltinPaths {
		paths[p] = true
	}
	for name := range paths {
		target := filepath.Join(destination, "public", filepath.FromSlash(name))
		if err = os.MkdirAll(filepath.Dir(target), 0700); err != nil {
			return err
		}
		if err = copyRegular(r, "public/"+name, target, 16<<20, ""); err != nil {
			return err
		}
	}
	return os.Symlink(filepath.Join(source, "node_modules"), filepath.Join(destination, "node_modules"))
}

func extension(mime string) string {
	switch mime {
	case "image/png":
		return "png"
	case "image/jpeg":
		return "jpg"
	case "image/webp":
		return "webp"
	case "image/avif":
		return "avif"
	case "image/svg+xml":
		return "svg"
	}
	return ""
}

func copyMedia(uploadRoot, work string, job publishmodel.Assignment) error {
	if len(job.Assets) == 0 {
		return nil
	}
	r, err := os.OpenRoot(uploadRoot)
	if err != nil {
		return err
	}
	defer r.Close()
	for _, asset := range job.Assets {
		if asset.StorageKind == "builtin" {
			name, ok := publishmodel.BuiltinPaths[asset.ID]
			if !ok || name != asset.PublicPath {
				return publishfs.ErrUnsafe
			}
			data, err := os.ReadFile(filepath.Join(work, "public", filepath.FromSlash(name)))
			if err != nil || int64(len(data)) != asset.Bytes || publishfs.Hash(data) != asset.SHA256 {
				return publishfs.ErrMismatch
			}
			continue
		}
		ext := extension(asset.MediaType)
		if asset.StorageKind != "upload" || ext == "" || ext == "svg" || !publishfs.ValidHash(asset.SHA256) || asset.PublicPath != "media/"+asset.SHA256+"."+ext || asset.Bytes <= 0 || asset.Bytes > 32<<20 {
			return publishfs.ErrUnsafe
		}
		target := filepath.Join(work, "public", filepath.FromSlash(asset.PublicPath))
		if err = os.MkdirAll(filepath.Dir(target), 0700); err != nil {
			return err
		}
		if err = copyRegular(r, "derived/"+asset.SHA256+"."+ext, target, asset.Bytes, asset.SHA256); err != nil {
			return err
		}
		info, err := os.Stat(target)
		if err != nil || info.Size() != asset.Bytes {
			return publishfs.ErrMismatch
		}
	}
	return nil
}

func copyRegular(root *os.Root, name, destination string, limit int64, expectedHash string) error {
	if !publishfs.SafePath(name) {
		return publishfs.ErrUnsafe
	}
	for _, part := range pathComponents(name) {
		info, err := root.Lstat(part)
		if err != nil {
			return err
		}
		if info.Mode()&os.ModeSymlink != 0 {
			return publishfs.ErrUnsafe
		}
	}
	input, err := root.Open(name)
	if err != nil {
		return err
	}
	defer input.Close()
	info, err := input.Stat()
	if err != nil || !info.Mode().IsRegular() || info.Size() > limit {
		return publishfs.ErrUnsafe
	}
	data, err := io.ReadAll(io.LimitReader(input, limit+1))
	if err != nil {
		return err
	}
	if int64(len(data)) > limit || int64(len(data)) != info.Size() {
		return publishfs.ErrUnsafe
	}
	if expectedHash != "" && publishfs.Hash(data) != expectedHash {
		return publishfs.ErrMismatch
	}
	f, err := os.OpenFile(destination, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if err != nil {
		return err
	}
	if _, err = f.Write(data); err == nil {
		err = f.Sync()
	}
	closeErr := f.Close()
	if err != nil {
		return err
	}
	return closeErr
}

func pathComponents(name string) []string {
	parts := strings.Split(name, "/")
	out := make([]string, 0, len(parts))
	for i := range parts {
		out = append(out, strings.Join(parts[:i+1], "/"))
	}
	return out
}

func writeMarker(directory string, job publishmodel.Assignment) error {
	marker := publishmodel.Marker{SchemaVersion: 1, ReleaseID: job.ReleaseID, SnapshotID: job.SnapshotID, SnapshotSHA256: job.SnapshotSHA256, WorkspaceRevision: job.WorkspaceRevision}
	data, err := json.Marshal(marker)
	if err != nil {
		return err
	}
	r, err := safeOutputRoot(directory)
	if err != nil {
		return err
	}
	defer r.Close()
	f, err := r.OpenFile(publishmodel.MarkerPath, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if err != nil {
		return err
	}
	if _, err = f.Write(data); err == nil {
		err = f.Sync()
	}
	closeErr := f.Close()
	if err != nil {
		return err
	}
	return closeErr
}

// The build process is unprivileged and already stopped, but its output still
// must not be allowed to redirect a later privileged filesystem operation.
func safeOutputRoot(directory string) (*os.Root, error) {
	absolute, err := filepath.Abs(directory)
	if err != nil {
		return nil, err
	}
	for current := absolute; ; current = filepath.Dir(current) {
		info, err := os.Lstat(current)
		if err != nil {
			return nil, err
		}
		if info.Mode()&os.ModeSymlink != 0 || !info.IsDir() {
			return nil, publishfs.ErrUnsafe
		}
		if filepath.Dir(current) == current {
			break
		}
	}
	return os.OpenRoot(absolute)
}
