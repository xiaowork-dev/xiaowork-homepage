package publishdata

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"time"

	"github.com/xiaowork-dev/xiaowork-homepage/backend/internal/contentdata"
	"github.com/xiaowork-dev/xiaowork-homepage/backend/internal/contentlimits"
	"github.com/xiaowork-dev/xiaowork-homepage/backend/internal/publishmodel"
)

func Extension(mediaType string) string {
	switch mediaType {
	case "image/png":
		return ".png"
	case "image/jpeg":
		return ".jpg"
	case "image/webp":
		return ".webp"
	case "image/avif":
		return ".avif"
	}
	return ""
}

// Freeze stores a whitelist public projection and its references in the caller's
// transaction. Hidden and archived project fields never enter this JSON.
func Project(ctx context.Context, tx contentdata.Queryer, id string, revision, now int64) (publishmodel.Snapshot, []byte, string, error) {
	var s publishmodel.Snapshot
	profile, ready, err := contentdata.ProfileView(ctx, tx)
	if err != nil {
		return s, nil, "", err
	}
	if !ready {
		return s, nil, "", errors.New("workspace not initialized")
	}
	settings, ready, err := contentdata.SettingsView(ctx, tx)
	if err != nil {
		return s, nil, "", err
	}
	if !ready {
		return s, nil, "", errors.New("workspace not initialized")
	}
	if err = contentdata.ValidateProfile(profile); err != nil {
		return s, nil, "", err
	}
	if err = contentdata.ValidateSettings(settings); err != nil {
		return s, nil, "", err
	}
	s = publishmodel.Snapshot{SchemaVersion: 1, SnapshotID: id, WorkspaceRevision: contentdata.Revision(revision), CreatedAt: time.Unix(now, 0).UTC().Format(time.RFC3339), SiteProfile: profile.Site, AboutProfile: profile.About, SiteSettings: settings, VisibleProjects: []publishmodel.PublicProject{}, Categories: []publishmodel.PublicCategory{}, MediaManifest: []publishmodel.Media{}, LegacyAssetAllowlist: []string{}}
	projects, err := contentdata.Projects(ctx, tx)
	if err != nil {
		return s, nil, "", err
	}
	used := map[string]bool{"builtin-brand-icon": true, "builtin-social-share": true}
	categories := map[string]bool{}
	for _, p := range projects {
		if p.ArchivedAt != nil || p.Visible == nil || !*p.Visible {
			continue
		}
		if err = contentdata.ValidateProject(p.ProjectInput); err != nil {
			return s, nil, "", err
		}
		s.VisibleProjects = append(s.VisibleProjects, publishmodel.PublicProject{ID: p.ID, Order: p.Order, ProjectInput: p.ProjectInput})
		used[p.Cover.ID] = true
		categories[p.Category] = true
	}
	allCategories, err := contentdata.Categories(ctx, tx)
	if err != nil {
		return s, nil, "", err
	}
	for _, c := range allCategories {
		if categories[c.Slug] {
			s.Categories = append(s.Categories, publishmodel.PublicCategory{Slug: c.Slug, Name: c.Name, Order: c.Order})
		}
	}
	for _, ref := range []*string{profile.Site.AvatarAssetID, profile.Site.BrandAssetID, settings.DefaultShareAssetID, settings.Pages.Home.ShareAssetID, settings.Pages.Projects.ShareAssetID, settings.Pages.About.ShareAssetID} {
		if ref != nil {
			used[*ref] = true
		}
	}
	ids := make([]string, 0, len(used))
	for id := range used {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	var mediaBytes int64
	for _, assetID := range ids {
		var m publishmodel.Media
		var kind, key string
		var confirmed bool
		var deleted sql.NullInt64
		err = tx.QueryRowContext(ctx, `SELECT a.id,a.storage_kind,a.storage_key,a.sha256,a.media_type,a.byte_size,a.width,a.height,m.alt,m.public_use_confirmed,m.deleted_at FROM assets a JOIN asset_metadata m ON m.asset_id=a.id WHERE a.id=?`, assetID).Scan(&m.ID, &kind, &key, &m.SHA256, &m.MediaType, &m.ByteSize, &m.Width, &m.Height, &m.Alt, &confirmed, &deleted)
		if err != nil {
			return s, nil, "", err
		}
		if deleted.Valid || !publishmodel.HexHash.MatchString(m.SHA256) || m.ByteSize < 1 || m.ByteSize > contentlimits.MaxPublishedFileBytes {
			return s, nil, "", errors.New("snapshot media unavailable")
		}
		mediaBytes += m.ByteSize
		if mediaBytes > contentlimits.MaxSnapshotMediaBytes {
			return s, nil, "", errors.New("snapshot media exceeds build budget")
		}
		if kind == "builtin" {
			expected, ok := publishmodel.BuiltinPaths[m.ID]
			if !ok || expected != key {
				return s, nil, "", errors.New("unknown builtin asset")
			}
			s.LegacyAssetAllowlist = append(s.LegacyAssetAllowlist, m.ID)
		} else {
			ext := Extension(m.MediaType)
			if kind != "upload" || !confirmed || ext == "" || key != "derived/"+m.SHA256+ext {
				return s, nil, "", errors.New("unconfirmed or invalid media")
			}
			m.Path = "media/" + m.SHA256 + ext
			s.MediaManifest = append(s.MediaManifest, m)
		}
	}
	raw, err := contentdata.CanonicalJSON(s)
	if err != nil {
		return s, nil, "", err
	}
	if len(raw) > 512<<10 {
		return s, nil, "", errors.New("public snapshot exceeds publication budget")
	}
	hash := fmt.Sprintf("%x", sha256.Sum256(raw))
	return s, raw, hash, nil
}

func Freeze(ctx context.Context, tx *sql.Tx, id string, revision, now int64) (publishmodel.Snapshot, []byte, string, error) {
	s, raw, hash, err := Project(ctx, tx, id, revision, now)
	if err != nil {
		return s, raw, hash, err
	}
	if _, err = tx.ExecContext(ctx, `INSERT INTO snapshots(id,source_revision,projection_version,public_json,content_sha256,created_at) VALUES(?,?,1,?,?,?)`, id, revision, string(raw), hash, now); err != nil {
		return s, nil, "", err
	}
	refs := map[string]string{}
	for _, id := range s.LegacyAssetAllowlist {
		refs[id] = publishmodel.BuiltinPaths[id]
	}
	for _, media := range s.MediaManifest {
		refs[media.ID] = media.Path
	}
	for assetID, publicPath := range refs {
		if _, err = tx.ExecContext(ctx, `INSERT INTO snapshot_assets(snapshot_id,asset_id,public_path) VALUES(?,?,?)`, id, assetID, publicPath); err != nil {
			return s, nil, "", err
		}
	}
	_, err = tx.ExecContext(ctx, `UPDATE snapshots SET sealed_at=? WHERE id=?`, now, id)
	return s, raw, hash, err
}

func Load(ctx context.Context, q contentdata.Queryer, id string) (publishmodel.Snapshot, json.RawMessage, string, error) {
	var s publishmodel.Snapshot
	var raw, hash string
	var sealed sql.NullInt64
	err := q.QueryRowContext(ctx, `SELECT public_json,content_sha256,sealed_at FROM snapshots WHERE id=?`, id).Scan(&raw, &hash, &sealed)
	if err != nil {
		return s, nil, "", err
	}
	if !sealed.Valid || fmt.Sprintf("%x", sha256.Sum256([]byte(raw))) != hash {
		return s, nil, "", errors.New("sealed snapshot integrity mismatch")
	}
	err = json.Unmarshal([]byte(raw), &s)
	if err == nil && (s.SchemaVersion != 1 || s.SnapshotID != id) {
		err = errors.New("snapshot schema mismatch")
	}
	return s, json.RawMessage(raw), hash, err
}

func Assets(ctx context.Context, q contentdata.Queryer, snapshotID string) ([]publishmodel.MediaAsset, error) {
	rows, err := q.QueryContext(ctx, `SELECT a.id,a.storage_kind,a.sha256,a.byte_size,a.media_type,s.public_path FROM snapshot_assets s JOIN assets a ON a.id=s.asset_id WHERE s.snapshot_id=? ORDER BY a.id,s.public_path`, snapshotID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []publishmodel.MediaAsset{}
	for rows.Next() {
		var a publishmodel.MediaAsset
		if err = rows.Scan(&a.ID, &a.StorageKind, &a.SHA256, &a.Bytes, &a.MediaType, &a.PublicPath); err != nil {
			return nil, err
		}
		result = append(result, a)
	}
	return result, rows.Err()
}
