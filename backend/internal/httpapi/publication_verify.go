package httpapi

import (
	"bytes"
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime"
	"net/http"
	"path"
	"strings"
	"time"

	"github.com/xiaowork-dev/xiaowork-homepage/backend/internal/publishdata"
	"github.com/xiaowork-dev/xiaowork-homepage/backend/internal/publishfs"
	"github.com/xiaowork-dev/xiaowork-homepage/backend/internal/publishmodel"
)

func (a *App) verifyManifest(j publicationJob) (publishmodel.Manifest, string, error) {
	s, e := publishfs.OpenReadOnly(a.config.PublicationsDir)
	if e != nil {
		return publishmodel.Manifest{}, "", e
	}
	defer s.Close()
	m, hash, e := s.VerifyRelease(j.ReleaseID)
	if e != nil {
		return m, hash, e
	}
	if m.SnapshotID != j.SnapshotID || m.SnapshotSHA256 != j.SnapshotHash || m.WorkspaceRevision != j.WorkspaceRevision || m.Origin != "https://xiaoworks.com" {
		return m, hash, errors.New("artifact snapshot mismatch")
	}
	if j.Kind == "rollback" {
		var known string
		var source, builder string
		e = a.db.QueryRow(`SELECT r.manifest_sha256,d.source_revision,d.builder_id FROM releases r JOIN publication_job_details d ON d.job_id=r.publish_job_id WHERE r.id=? AND r.snapshot_id=? AND r.kind='publication'`, j.ReleaseID, j.SnapshotID).Scan(&known, &source, &builder)
		if e != nil || hash != known || m.SourceRevision != source || m.BuilderID != builder || m.SourceRevision != a.config.SourceRevision || m.BuilderID != a.config.BuilderID {
			return m, hash, errors.New("incompatible rollback artifact")
		}
	} else if m.JobID != j.ID || m.SourceRevision != j.SourceRevision || m.BuilderID != j.BuilderID || m.Kind != j.Kind {
		return m, hash, errors.New("artifact assignment mismatch")
	}
	return m, hash, nil
}

func (a *App) verifyHTTP(ctx context.Context, m publishmodel.Manifest) error {
	ctx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	transport := &http.Transport{Proxy: nil, DisableKeepAlives: false, MaxIdleConns: 2, IdleConnTimeout: 10 * time.Second, ResponseHeaderTimeout: 3 * time.Second}
	defer transport.CloseIdleConnections()
	client := &http.Client{Transport: transport, Timeout: 5 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	found := map[string]bool{}
	for _, file := range m.Files {
		if file.Bytes > 16<<20 {
			return errors.New("HTTP artifact resource over verification budget")
		}
		req, e := http.NewRequestWithContext(ctx, "GET", a.config.PublicationVerifyURL+"/"+file.Path, nil)
		if e != nil {
			return e
		}
		req.Header.Set("Cache-Control", "no-cache")
		res, e := client.Do(req)
		if e != nil {
			return errors.New("publication HTTP unavailable")
		}
		raw, e := io.ReadAll(io.LimitReader(res.Body, file.Bytes+1))
		res.Body.Close()
		if e != nil || res.StatusCode != 200 || int64(len(raw)) != file.Bytes || fmt.Sprintf("%x", sha256.Sum256(raw)) != file.SHA256 {
			return errors.New("publication HTTP differs from immutable artifact")
		}
		found[file.Path] = true
		if file.Path == publishmodel.MarkerPath {
			var marker publishmodel.Marker
			if e = json.Unmarshal(raw, &marker); e != nil || marker.SchemaVersion != 1 || marker.ReleaseID != m.ReleaseID || marker.SnapshotID != m.SnapshotID || marker.SnapshotSHA256 != m.SnapshotSHA256 || marker.WorkspaceRevision != m.WorkspaceRevision {
				return errors.New("publication HTTP marker mismatch")
			}
		}
	}
	for _, required := range []string{"index.html", "projects/index.html", "about/index.html", publishmodel.MarkerPath, "robots.txt", "sitemap.xml"} {
		if !found[required] {
			return errors.New("required artifact page missing")
		}
	}
	return nil
}

func (a *App) verifyActive(ctx context.Context, id string) error {
	current, e := a.currentRelease()
	if e != nil || current != id || !publishmodel.ValidID(id, "rel") {
		return errors.New("active pointer mismatch")
	}
	var jobID string
	e = a.db.QueryRowContext(ctx, `SELECT j.id FROM publish_jobs j WHERE j.reconciled_release_id=? AND j.status='succeeded' AND j.kind IN ('publish','rollback') ORDER BY j.reconciled_at DESC LIMIT 1`, id).Scan(&jobID)
	if e != nil {
		return e
	}
	j, e := publicationJobByID(ctx, a.db, jobID)
	if e != nil {
		return e
	}
	m, hash, e := a.verifyManifest(j)
	if e != nil || hash != j.ManifestHash {
		return errors.New("active artifact invalid")
	}
	if e = a.verifyHTTP(ctx, m); e != nil {
		return e
	}
	current, e = a.currentRelease()
	if e != nil || current != id {
		return errors.New("active pointer changed during verification")
	}
	return nil
}

type releaseView struct {
	ID                string  `json:"id"`
	SnapshotID        string  `json:"snapshotId"`
	Kind              string  `json:"kind"`
	WorkspaceRevision string  `json:"workspaceRevision"`
	CreatedAt         string  `json:"createdAt"`
	ExpiresAt         *string `json:"expiresAt"`
	Active            bool    `json:"active"`
	Verified          bool    `json:"verified"`
	PreviewURL        *string `json:"previewUrl"`
}

func (a *App) releases(ctx context.Context) ([]releaseView, error) {
	rows, e := a.db.QueryContext(ctx, `SELECT r.id,r.snapshot_id,r.kind,s.source_revision,r.created_at,r.expires_at,r.manifest_sha256 FROM releases r JOIN snapshots s ON s.id=r.snapshot_id WHERE EXISTS(SELECT 1 FROM publish_jobs j WHERE j.reconciled_release_id=r.id AND j.status='succeeded') ORDER BY r.created_at DESC,r.id DESC LIMIT 100`)
	if e != nil {
		return nil, e
	}
	items := []releaseView{}
	hashes := []string{}
	for rows.Next() {
		var v releaseView
		var revision, created int64
		var expires sql.NullInt64
		var hash string
		if e = rows.Scan(&v.ID, &v.SnapshotID, &v.Kind, &revision, &created, &expires, &hash); e != nil {
			rows.Close()
			return nil, e
		}
		v.WorkspaceRevision = revisionLabel(revision)
		v.CreatedAt = publicationTime(created)
		if expires.Valid {
			t := publicationTime(expires.Int64)
			v.ExpiresAt = &t
		}
		items = append(items, v)
		hashes = append(hashes, hash)
	}
	e = rows.Err()
	rows.Close()
	if e != nil {
		return nil, e
	}
	current, _ := a.currentRelease()
	s, e := publishfs.OpenReadOnly(a.config.PublicationsDir)
	if e != nil {
		return items, nil
	}
	defer s.Close()
	for i := range items {
		v := &items[i]
		v.Active = v.Kind == "publication" && current == v.ID
		m, hash, err := s.VerifyRelease(v.ID)
		v.Verified = err == nil && hash == hashes[i] && m.SnapshotID == v.SnapshotID && m.SourceRevision == a.config.SourceRevision && m.BuilderID == a.config.BuilderID
		if v.Kind == "preview" && v.ExpiresAt != nil {
			expiry, _ := time.Parse(time.RFC3339, *v.ExpiresAt)
			v.Verified = v.Verified && expiry.After(a.now())
			if v.Verified {
				u := apiPrefix + "/previews/" + v.ID + "/"
				v.PreviewURL = &u
			}
		}
	}
	return items, nil
}
func (a *App) listReleases(w http.ResponseWriter, r *http.Request) {
	if !a.config.LocalPublish {
		a.publishingUnavailable(w, r)
		return
	}
	if e := queryOnly(r); e != nil {
		writeError(w, r, e)
		return
	}
	items, e := a.releases(r.Context())
	if e != nil {
		writeError(w, r, e)
		return
	}
	writeData(w, r, 200, map[string]any{"items": items})
}
func (a *App) getRelease(w http.ResponseWriter, r *http.Request) {
	if !a.config.LocalPublish {
		a.publishingUnavailable(w, r)
		return
	}
	if e := queryOnly(r); e != nil {
		writeError(w, r, e)
		return
	}
	items, e := a.releases(r.Context())
	if e != nil {
		writeError(w, r, e)
		return
	}
	for _, v := range items {
		if v.ID == r.PathValue("id") {
			writeData(w, r, 200, map[string]any{"release": v})
			return
		}
	}
	writeError(w, r, problem(404, "NOT_FOUND", "版本不存在。"))
}

func (a *App) servePreview(w http.ResponseWriter, r *http.Request) {
	if !a.config.LocalPublish {
		a.publishingUnavailable(w, r)
		return
	}
	if e := queryOnly(r); e != nil {
		writeError(w, r, e)
		return
	}
	id := r.PathValue("id")
	name := previewName(r.PathValue("resource"))
	if !publishmodel.ValidID(id, "pre") || !publishfs.SafePath(name) || strings.Contains(r.URL.RawPath, "%") {
		writeError(w, r, problem(404, "NOT_FOUND", "预览资源不存在。"))
		return
	}
	var manifestHash string
	e := a.db.QueryRowContext(r.Context(), `SELECT r.manifest_sha256 FROM releases r WHERE r.id=? AND r.kind='preview' AND r.expires_at>? AND EXISTS(SELECT 1 FROM publish_jobs j WHERE j.reconciled_release_id=r.id AND j.status='succeeded' AND j.kind='preview')`, id, a.now().Unix()).Scan(&manifestHash)
	if e != nil {
		writeError(w, r, problem(404, "NOT_FOUND", "预览已过期或尚未验证。"))
		return
	}
	s, e := publishfs.OpenReadOnly(a.config.PublicationsDir)
	if e != nil {
		writeError(w, r, problem(503, "PREVIEW_UNAVAILABLE", "预览暂不可用。"))
		return
	}
	defer s.Close()
	m, hash, e := s.ReadManifest(id)
	if e != nil || hash != manifestHash {
		writeError(w, r, problem(503, "PREVIEW_UNAVAILABLE", "预览完整性校验失败。"))
		return
	}
	var expected *publishmodel.File
	for i := range m.Files {
		if m.Files[i].Path == name {
			expected = &m.Files[i]
			break
		}
	}
	if expected == nil || expected.Bytes > 16<<20 {
		writeError(w, r, problem(404, "NOT_FOUND", "预览资源不存在。"))
		return
	}
	raw, e := s.ReadPublic(id, name, 16<<20)
	if e != nil || int64(len(raw)) != expected.Bytes || publishfs.Hash(raw) != expected.SHA256 {
		writeError(w, r, problem(503, "PREVIEW_UNAVAILABLE", "预览资源完整性校验失败。"))
		return
	}
	w.Header().Set("Content-Type", mime.TypeByExtension(path.Ext(name)))
	w.Header().Set("Content-Security-Policy", "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; object-src 'none'; base-uri 'self'; frame-ancestors 'self'; connect-src 'self'")
	w.Header().Set("Content-Length", fmt.Sprint(len(raw)))
	w.WriteHeader(200)
	if r.Method != "HEAD" {
		_, _ = io.Copy(w, bytes.NewReader(raw))
	}
}

func (a *App) verifySnapshotMedia(ctx context.Context, id string) error {
	assets, e := publishdata.Assets(ctx, a.db, id)
	if e != nil {
		return e
	}
	root, e := a.mediaRoot()
	if e != nil {
		return e
	}
	defer root.Close()
	for _, asset := range assets {
		if asset.StorageKind == "upload" {
			var approved int
			var deleted sql.NullInt64
			if e = a.db.QueryRowContext(ctx, `SELECT public_use_confirmed,deleted_at FROM asset_metadata WHERE asset_id=?`, asset.ID).Scan(&approved, &deleted); e != nil || approved != 1 || deleted.Valid {
				return errors.New("snapshot media approval changed")
			}
			if e = verifyMediaBlob(root, "derived/"+asset.SHA256+publishdata.Extension(asset.MediaType), asset.SHA256, asset.Bytes); e != nil {
				return e
			}
		}
	}
	return nil
}
