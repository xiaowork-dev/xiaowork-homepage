package contentdata

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"sort"
	"strings"
	"time"
)

type Queryer interface {
	QueryContext(context.Context, string, ...any) (*sql.Rows, error)
	QueryRowContext(context.Context, string, ...any) *sql.Row
}

func CurrentRevision(ctx context.Context, q Queryer) (int64, error) {
	var revision int64
	err := q.QueryRowContext(ctx, "SELECT revision FROM workspace WHERE id=1").Scan(&revision)
	return revision, err
}
func formatTime(value int64) string { return time.Unix(value, 0).UTC().Format(time.RFC3339) }
func Categories(ctx context.Context, q Queryer) ([]Category, error) {
	rows, err := q.QueryContext(ctx, `SELECT c.id,c.slug,c.name,c.sort_order,count(p.id) FROM project_categories c LEFT JOIN project_drafts p ON p.category_id=c.id GROUP BY c.id ORDER BY c.sort_order,c.id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []Category{}
	for rows.Next() {
		var c Category
		if err := rows.Scan(&c.ID, &c.Slug, &c.Name, &c.Order, &c.ProjectCount); err != nil {
			return nil, err
		}
		result = append(result, c)
	}
	return result, rows.Err()
}
func CategoryByID(ctx context.Context, q Queryer, id string) (Category, error) {
	if err := RequiredID(id); err != nil {
		return Category{}, err
	}
	items, err := Categories(ctx, q)
	if err != nil {
		return Category{}, err
	}
	for _, item := range items {
		if item.ID == id {
			return item, nil
		}
	}
	return Category{}, NotFound()
}

const projectSelect = `SELECT p.id,p.slug,p.name,p.summary,p.description,c.slug,p.tech_stack_json,p.status,p.featured,p.visible,p.is_placeholder,p.cover_alt,p.cover_kind,p.demo_url,p.repository_url,p.sort_order,p.created_at,p.updated_at,p.archived_at,coalesce(a.id,''),coalesce(a.storage_kind,'') FROM project_drafts p JOIN project_categories c ON c.id=p.category_id LEFT JOIN project_draft_assets pa ON pa.project_id=p.id AND pa.role='cover' LEFT JOIN assets a ON a.id=pa.asset_id`

func Projects(ctx context.Context, q Queryer) ([]Project, error) {
	rows, err := q.QueryContext(ctx, projectSelect+" ORDER BY p.sort_order,p.id")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []Project{}
	for rows.Next() {
		var p Project
		var stack, storage string
		var created, updated int64
		var archived sql.NullInt64
		var demo, repo sql.NullString
		var featured, visible, placeholder bool
		if err := rows.Scan(&p.ID, &p.Slug, &p.Name, &p.Summary, &p.Description, &p.Category, &stack, &p.Status, &featured, &visible, &placeholder, &p.CoverAlt, &p.CoverKind, &demo, &repo, &p.Order, &created, &updated, &archived, &p.Cover.ID, &storage); err != nil {
			return nil, err
		}
		if err := json.Unmarshal([]byte(stack), &p.TechStack); err != nil {
			return nil, err
		}
		p.Featured = &featured
		p.Visible = &visible
		p.IsPlaceholder = &placeholder
		p.CreatedAt = formatTime(created)
		p.UpdatedAt = formatTime(updated)
		if archived.Valid {
			value := formatTime(archived.Int64)
			p.ArchivedAt = &value
		}
		if demo.Valid {
			p.DemoURL = &demo.String
		}
		if repo.Valid {
			p.RepositoryURL = &repo.String
		}
		p.Cover.Kind = "media"
		if storage == "builtin" {
			p.Cover.Kind = "builtin"
		}
		result = append(result, p)
	}
	return result, rows.Err()
}
func ProjectByID(ctx context.Context, q Queryer, id string) (Project, error) {
	if err := RequiredID(id); err != nil {
		return Project{}, err
	}
	items, err := Projects(ctx, q)
	if err != nil {
		return Project{}, err
	}
	for _, item := range items {
		if item.ID == id {
			return item, nil
		}
	}
	return Project{}, NotFound()
}

// CheckAsset enforces private asset identity, deletion and public-use approval.
// It is shared by covers, avatar/brand and SEO fields, never by arbitrary paths.
func CheckAsset(ctx context.Context, q Queryer, id, kind string, confirmation bool) error {
	var storage string
	var confirmed int
	var deleted sql.NullInt64
	err := q.QueryRowContext(ctx, `SELECT a.storage_kind,m.public_use_confirmed,m.deleted_at FROM assets a JOIN asset_metadata m ON m.asset_id=a.id WHERE a.id=?`, id).Scan(&storage, &confirmed, &deleted)
	if errors.Is(err, sql.ErrNoRows) {
		return invalid("asset")
	}
	if err != nil {
		return err
	}
	if deleted.Valid || kind == "builtin" && storage != "builtin" || kind == "media" && storage != "upload" || confirmation && storage == "upload" && confirmed != 1 {
		return invalid("asset")
	}
	return nil
}
func SaveProject(ctx context.Context, tx *sql.Tx, id string, p ProjectInput, create bool, now int64) (Project, error) {
	// Technical tags are exact strings after trimming. Empty/duplicate entries
	// are normalized as promised by the contract, never inferred from URLs.
	if p.TechStack != nil {
		tags := []string{}
		seen := map[string]bool{}
		for _, tag := range p.TechStack {
			tag = strings.TrimSpace(tag)
			if tag != "" && !seen[tag] {
				tags = append(tags, tag)
				seen[tag] = true
			}
		}
		p.TechStack = tags
	}
	if err := ValidateProject(p); err != nil {
		return Project{}, err
	}
	if err := CheckAsset(ctx, tx, p.Cover.ID, p.Cover.Kind, p.CoverKind == "screenshot"); err != nil {
		return Project{}, err
	}
	if p.CoverKind == "screenshot" && *p.IsPlaceholder {
		return Project{}, invalid("isPlaceholder")
	}
	if p.CoverKind == "screenshot" && p.Cover.Kind == "builtin" {
		var key string
		if err := tx.QueryRowContext(ctx, "SELECT storage_key FROM assets WHERE id=?", p.Cover.ID).Scan(&key); err != nil {
			return Project{}, err
		}
		if strings.Contains(strings.ToLower(key), "placeholder") {
			return Project{}, invalid("coverKind")
		}
	}
	var categoryID string
	if err := tx.QueryRowContext(ctx, "SELECT id FROM project_categories WHERE slug=?", p.Category).Scan(&categoryID); errors.Is(err, sql.ErrNoRows) {
		return Project{}, invalid("category")
	} else if err != nil {
		return Project{}, err
	}
	if create {
		var order int64
		if err := tx.QueryRowContext(ctx, "SELECT coalesce(max(sort_order),0)+1 FROM project_drafts").Scan(&order); err != nil {
			return Project{}, err
		}
		_, err := tx.ExecContext(ctx, `INSERT INTO project_drafts(id,category_id,slug,name,summary,description,tech_stack_json,status,featured,visible,is_placeholder,cover_alt,cover_kind,demo_url,repository_url,sort_order,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, id, categoryID, p.Slug, p.Name, p.Summary, p.Description, jsonString(p.TechStack), p.Status, *p.Featured, *p.Visible, *p.IsPlaceholder, p.CoverAlt, p.CoverKind, nullableString(p.DemoURL), nullableString(p.RepositoryURL), order, now, now)
		if err != nil {
			return Project{}, DBError(err)
		}
	} else {
		existing, err := ProjectByID(ctx, tx, id)
		if err != nil {
			return Project{}, err
		}
		if existing.ArchivedAt != nil && *p.Visible {
			return Project{}, invalid("visible")
		}
		_, err = tx.ExecContext(ctx, `UPDATE project_drafts SET category_id=?,slug=?,name=?,summary=?,description=?,tech_stack_json=?,status=?,featured=?,visible=?,is_placeholder=?,cover_alt=?,cover_kind=?,demo_url=?,repository_url=?,updated_at=? WHERE id=?`, categoryID, p.Slug, p.Name, p.Summary, p.Description, jsonString(p.TechStack), p.Status, *p.Featured, *p.Visible, *p.IsPlaceholder, p.CoverAlt, p.CoverKind, nullableString(p.DemoURL), nullableString(p.RepositoryURL), now, id)
		if err != nil {
			return Project{}, DBError(err)
		}
	}
	if _, err := tx.ExecContext(ctx, "DELETE FROM project_draft_assets WHERE project_id=?", id); err != nil {
		return Project{}, err
	}
	if _, err := tx.ExecContext(ctx, "INSERT INTO project_draft_assets(project_id,role,asset_id) VALUES(?,'cover',?)", id, p.Cover.ID); err != nil {
		return Project{}, err
	}
	return ProjectByID(ctx, tx, id)
}
func ArchiveProject(ctx context.Context, tx *sql.Tx, id string, archive bool, now int64) (Project, error) {
	p, err := ProjectByID(ctx, tx, id)
	if err != nil {
		return Project{}, err
	}
	if archive && p.ArchivedAt != nil || !archive && p.ArchivedAt == nil {
		return Project{}, conflict("CONTENT_CONFLICT", "项目归档状态已改变。")
	}
	var archived any
	if archive {
		archived = now
	}
	_, err = tx.ExecContext(ctx, "UPDATE project_drafts SET archived_at=?,visible=0,updated_at=? WHERE id=?", archived, now, id)
	if err != nil {
		return Project{}, err
	}
	return ProjectByID(ctx, tx, id)
}
func SaveCategory(ctx context.Context, tx *sql.Tx, id, slug, name string, create bool, now int64) (Category, error) {
	if !Text(name, 1, 80, false) || create && !Slug(slug) {
		return Category{}, invalid("category")
	}
	if create {
		_, err := tx.ExecContext(ctx, `INSERT INTO project_categories(id,slug,name,sort_order,created_at,updated_at) VALUES(?,?,?,(SELECT coalesce(max(sort_order),0)+1 FROM project_categories),?,?)`, id, slug, name, now, now)
		if err != nil {
			return Category{}, DBError(err)
		}
	} else {
		if _, err := CategoryByID(ctx, tx, id); err != nil {
			return Category{}, err
		}
		if _, err := tx.ExecContext(ctx, "UPDATE project_categories SET name=?,updated_at=? WHERE id=?", name, now, id); err != nil {
			return Category{}, err
		}
	}
	return CategoryByID(ctx, tx, id)
}
func DeleteCategory(ctx context.Context, tx *sql.Tx, id string) error {
	c, err := CategoryByID(ctx, tx, id)
	if err != nil {
		return err
	}
	if c.ProjectCount > 0 {
		return conflict("CATEGORY_REFERENCED", "分类仍被项目草稿引用。")
	}
	_, err = tx.ExecContext(ctx, "DELETE FROM project_categories WHERE id=?", id)
	return err
}
func Order(ctx context.Context, tx *sql.Tx, kind string, ids []string, now int64) error {
	var query, update string
	if kind == "projects" {
		query = "SELECT id FROM project_drafts WHERE archived_at IS NULL"
		update = "UPDATE project_drafts SET sort_order=?,updated_at=? WHERE id=?"
	} else if kind == "categories" {
		query = "SELECT id FROM project_categories"
		update = "UPDATE project_categories SET sort_order=?,updated_at=? WHERE id=?"
	} else {
		return invalid("order")
	}
	rows, err := tx.QueryContext(ctx, query)
	if err != nil {
		return err
	}
	valid := map[string]bool{}
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return err
		}
		valid[id] = true
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return err
	}
	if ids == nil || len(ids) != len(valid) {
		return invalid("ids")
	}
	for _, id := range ids {
		if !valid[id] {
			return invalid("ids")
		}
		delete(valid, id)
	}
	for index, id := range ids {
		if _, err := tx.ExecContext(ctx, update, index+1, now, id); err != nil {
			return err
		}
	}
	return nil
}

type siteDocument struct {
	Profile  SiteProfile     `json:"siteProfile"`
	Settings json.RawMessage `json:"settings,omitempty"`
}

func readSite(ctx context.Context, q Queryer) (siteDocument, error) {
	var raw string
	err := q.QueryRowContext(ctx, "SELECT content_json FROM workspace_documents WHERE kind='site'").Scan(&raw)
	if errors.Is(err, sql.ErrNoRows) {
		return siteDocument{}, nil
	}
	if err != nil {
		return siteDocument{}, err
	}
	var doc siteDocument
	err = json.Unmarshal([]byte(raw), &doc)
	return doc, err
}
func ProfileView(ctx context.Context, q Queryer) (Profile, bool, error) {
	site, err := readSite(ctx, q)
	if err != nil {
		return Profile{}, false, err
	}
	result := Profile{Site: site.Profile}
	var raw string
	err = q.QueryRowContext(ctx, "SELECT content_json FROM workspace_documents WHERE kind='profile'").Scan(&raw)
	if errors.Is(err, sql.ErrNoRows) {
		return result, false, nil
	}
	if err != nil {
		return result, false, err
	}
	if err := json.Unmarshal([]byte(raw), &result.About); err != nil {
		return result, false, err
	}
	return result, result.Site.Name != "", nil
}
func SettingsView(ctx context.Context, q Queryer) (Settings, bool, error) {
	doc, err := readSite(ctx, q)
	if err != nil {
		return Settings{}, false, err
	}
	if len(doc.Settings) == 0 {
		return Settings{}, false, nil
	}
	var s Settings
	if err := json.Unmarshal(doc.Settings, &s); err != nil {
		return Settings{}, false, err
	}
	s.HomeIntroduction = doc.Profile.Introduction
	return s, true, nil
}
func writeDocument(ctx context.Context, tx *sql.Tx, kind string, value any, now int64) error {
	_, err := tx.ExecContext(ctx, `INSERT INTO workspace_documents(kind,content_json,updated_at) VALUES(?,?,?) ON CONFLICT(kind) DO UPDATE SET content_json=excluded.content_json,updated_at=excluded.updated_at`, kind, jsonString(value), now)
	return err
}
func SaveProfile(ctx context.Context, tx *sql.Tx, p Profile, now int64) error {
	if err := ValidateProfile(p); err != nil {
		return err
	}
	site, err := readSite(ctx, tx)
	if err != nil {
		return err
	}
	site.Profile = p.Site
	if err := syncDocumentRefs(ctx, tx, "site", map[string]*string{"siteProfile.avatarAssetId": p.Site.AvatarAssetID, "siteProfile.brandAssetId": p.Site.BrandAssetID}, "siteProfile."); err != nil {
		return err
	}
	if err := writeDocument(ctx, tx, "site", site, now); err != nil {
		return err
	}
	return writeDocument(ctx, tx, "profile", p.About, now)
}
func SaveSettings(ctx context.Context, tx *sql.Tx, s Settings, now int64) error {
	if err := ValidateSettings(s); err != nil {
		return err
	}
	site, err := readSite(ctx, tx)
	if err != nil {
		return err
	}
	site.Profile.Introduction = s.HomeIntroduction
	fields := map[string]any{}
	if err := json.Unmarshal([]byte(jsonString(s)), &fields); err != nil {
		return err
	}
	delete(fields, "homeIntroduction")
	site.Settings = json.RawMessage(jsonString(fields))
	// Ensure the document exists before its foreign-key references are installed.
	if err := writeDocument(ctx, tx, "site", site, now); err != nil {
		return err
	}
	refs := map[string]*string{"settings.defaultShareAssetId": s.DefaultShareAssetID, "settings.pages.home.shareAssetId": s.Pages.Home.ShareAssetID, "settings.pages.projects.shareAssetId": s.Pages.Projects.ShareAssetID, "settings.pages.about.shareAssetId": s.Pages.About.ShareAssetID}
	return syncDocumentRefs(ctx, tx, "site", refs, "settings.")
}
func syncDocumentRefs(ctx context.Context, tx *sql.Tx, kind string, refs map[string]*string, prefix string) error {
	keys := make([]string, 0, len(refs))
	for path, id := range refs {
		keys = append(keys, path)
		if id != nil {
			if err := CheckAsset(ctx, tx, *id, "", true); err != nil {
				return err
			}
		}
	}
	sort.Strings(keys)
	// A site row is needed before initial profile references can be registered.
	if _, err := tx.ExecContext(ctx, `INSERT INTO workspace_documents(kind,content_json,updated_at) VALUES(?,'{}',0) ON CONFLICT(kind) DO NOTHING`, kind); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, "DELETE FROM document_draft_assets WHERE document_kind=? AND field_path LIKE ?", kind, prefix+"%"); err != nil {
		return err
	}
	for _, path := range keys {
		if id := refs[path]; id != nil {
			if _, err := tx.ExecContext(ctx, "INSERT INTO document_draft_assets(document_kind,field_path,asset_id) VALUES(?,?,?)", kind, path, *id); err != nil {
				return err
			}
		}
	}
	return nil
}

// The active filesystem protocol is P6-D. Never infer an active publication
// from the latest successful DB row alone.
func Dashboard(ctx context.Context, q Queryer) (map[string]any, error) {
	projects, err := Projects(ctx, q)
	if err != nil {
		return nil, err
	}
	categories, err := Categories(ctx, q)
	if err != nil {
		return nil, err
	}
	revision, err := CurrentRevision(ctx, q)
	if err != nil {
		return nil, err
	}
	var total, visible, featured int
	for _, p := range projects {
		if p.ArchivedAt == nil {
			total++
			if *p.Visible {
				visible++
				if *p.Featured {
					featured++
				}
			}
		}
	}
	rows, err := q.QueryContext(ctx, `SELECT action,resource_type,resource_id,outcome,created_at FROM audit_events ORDER BY id DESC LIMIT 20`)
	if err != nil {
		return nil, err
	}
	events := []map[string]any{}
	for rows.Next() {
		var action, kind, outcome string
		var id sql.NullString
		var created int64
		if err := rows.Scan(&action, &kind, &id, &outcome, &created); err != nil {
			rows.Close()
			return nil, err
		}
		var value any
		if id.Valid {
			value = id.String
		}
		events = append(events, map[string]any{"action": action, "resourceType": kind, "resourceId": value, "outcome": outcome, "createdAt": formatTime(created)})
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return nil, err
	}
	return map[string]any{"revision": Revision(revision), "activeReleaseId": nil, "activeVerified": false, "publicationState": "not-integrated", "workerAvailable": false, "counts": map[string]any{"projects": total, "visibleProjects": visible, "categories": len(categories), "featuredProjects": featured, "publishedProjects": nil}, "draftDiff": map[string]any{"available": false, "changed": nil, "added": nil, "modified": nil, "removed": nil}, "recentEvents": events}, nil
}

func DecodeStrict(data []byte, dst any) error {
	if !json.Valid(data) {
		return invalid("json")
	}
	decoder := json.NewDecoder(strings.NewReader(string(data)))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(dst); err != nil {
		return invalid("json")
	}
	return nil
}
func ExplainMissing(initialized bool) any {
	if initialized {
		return nil
	}
	return map[string]string{"code": "CONTENT_NOT_INITIALIZED", "message": "内容尚未导入或配置。"}
}
func RequiredID(id string) error {
	if len(id) == 0 || len(id) > 80 || strings.ContainsAny(id, "/\\.\x00") {
		return NotFound()
	}
	return nil
}
