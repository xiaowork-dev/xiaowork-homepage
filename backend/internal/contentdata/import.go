package contentdata

import (
	"bytes"
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"
)

type SourceFile struct {
	Path     string `json:"path"`
	SHA256   string `json:"sha256"`
	ByteSize int64  `json:"byteSize"`
}
type SeedAsset struct {
	ID        string `json:"id"`
	Path      string `json:"path"`
	SHA256    string `json:"sha256"`
	MediaType string `json:"mediaType"`
	ByteSize  int64  `json:"byteSize"`
	Width     int64  `json:"width"`
	Height    int64  `json:"height"`
	Alt       string `json:"alt"`
}
type SeedProject struct {
	ID    string `json:"id"`
	Order int64  `json:"order"`
	ProjectInput
}
type SeedCategory struct {
	ID    string `json:"id"`
	Slug  string `json:"slug"`
	Name  string `json:"name"`
	Order int64  `json:"order"`
}
type SeedPayload struct {
	Categories []SeedCategory `json:"categories"`
	Projects   []SeedProject  `json:"projects"`
	Profile    Profile        `json:"profile"`
	Settings   Settings       `json:"settings"`
	Assets     []SeedAsset    `json:"assets"`
}
type Seed struct {
	SchemaVersion  int             `json:"schemaVersion"`
	SourceRevision string          `json:"sourceRevision"`
	Manifest       []SourceFile    `json:"manifest"`
	ManifestSHA256 string          `json:"manifestSha256"`
	PayloadSHA256  string          `json:"payloadSha256"`
	Payload        json.RawMessage `json:"payload"`
}
type ImportSummary struct {
	SourceRevision  string `json:"sourceRevision"`
	ManifestSHA256  string `json:"manifestSha256"`
	PayloadSHA256   string `json:"payloadSha256"`
	ProjectCount    int    `json:"projectCount"`
	CategoryCount   int    `json:"categoryCount"`
	AlreadyImported bool   `json:"alreadyImported"`
}

var hashPattern = regexp.MustCompile(`^[0-9a-f]{64}$`)
var sourcePattern = regexp.MustCompile(`^[0-9a-f]{40}$`)
var builtinPathPattern = regexp.MustCompile(`^(images/projects/(blog|nav|erp)/placeholder\.svg|images/social/xiaowork-share\.png|favicon\.svg)$`)

// CanonicalJSON matches the explicit exporter: sorted object keys, compact UTF-8,
// no HTML escaping, integer source values and JSON escapes for U+2028/U+2029.
func CanonicalJSON(value any) ([]byte, error) {
	var raw []byte
	var err error
	if message, ok := value.(json.RawMessage); ok {
		raw = message
	} else {
		raw, err = json.Marshal(value)
		if err != nil {
			return nil, err
		}
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.UseNumber()
	var object any
	if err := decoder.Decode(&object); err != nil {
		return nil, err
	}
	var out bytes.Buffer
	encoder := json.NewEncoder(&out)
	encoder.SetEscapeHTML(false)
	if err := encoder.Encode(object); err != nil {
		return nil, err
	}
	return bytes.TrimSuffix(out.Bytes(), []byte("\n")), nil
}
func digest(value any) (string, error) {
	raw, err := CanonicalJSON(value)
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("%x", sha256.Sum256(raw)), nil
}

// strictSeedJSON rejects duplicate keys, invalid UTF-8 and excessive nesting
// before typed decoding; local CLI input does not bypass the runtime schema.
func strictSeedJSON(raw []byte, dst any) error {
	if !utf8.Valid(raw) {
		return invalid("seed")
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.UseNumber()
	var walk func(int) error
	walk = func(depth int) error {
		if depth > 64 {
			return invalid("seed")
		}
		token, err := decoder.Token()
		if err != nil {
			return invalid("seed")
		}
		if d, ok := token.(json.Delim); ok {
			switch d {
			case '{':
				seen := map[string]bool{}
				for decoder.More() {
					key, err := decoder.Token()
					name, ok := key.(string)
					if err != nil || !ok || seen[name] {
						return invalid("seed")
					}
					seen[name] = true
					if err := walk(depth + 1); err != nil {
						return err
					}
				}
				end, err := decoder.Token()
				if err != nil || end != json.Delim('}') {
					return invalid("seed")
				}
			case '[':
				for decoder.More() {
					if err := walk(depth + 1); err != nil {
						return err
					}
				}
				end, err := decoder.Token()
				if err != nil || end != json.Delim(']') {
					return invalid("seed")
				}
			default:
				return invalid("seed")
			}
		}
		return nil
	}
	if err := walk(0); err != nil {
		return err
	}
	if _, err := decoder.Token(); err != io.EOF {
		return invalid("seed")
	}
	return DecodeStrict(raw, dst)
}

func validateSeed(seed Seed) (SeedPayload, error) {
	var payload SeedPayload
	if seed.SchemaVersion != 1 || !sourcePattern.MatchString(seed.SourceRevision) || !hashPattern.MatchString(seed.ManifestSHA256) || !hashPattern.MatchString(seed.PayloadSHA256) || len(seed.Manifest) < 7 || len(seed.Manifest) > 100 {
		return payload, invalid("seed provenance")
	}
	manifestHash, err := digest(seed.Manifest)
	if err != nil || manifestHash != seed.ManifestSHA256 {
		return payload, invalid("manifestSha256")
	}
	payloadHash, err := digest(seed.Payload)
	if err != nil || payloadHash != seed.PayloadSHA256 {
		return payload, invalid("payloadSha256")
	}
	if err := strictSeedJSON(seed.Payload, &payload); err != nil {
		return payload, err
	}
	if len(payload.Projects) > 1000 || len(payload.Categories) > 100 || len(payload.Assets) > 1000 || payload.Projects == nil || payload.Categories == nil || payload.Assets == nil {
		return payload, invalid("seed collections")
	}
	files := map[string]SourceFile{}
	for _, file := range seed.Manifest {
		if file.Path == "" || strings.Contains(file.Path, "..") || strings.ContainsAny(file.Path, "\\\x00") || strings.HasPrefix(file.Path, "/") || !hashPattern.MatchString(file.SHA256) || file.ByteSize < 1 || file.ByteSize > 4<<20 || files[file.Path].Path != "" {
			return payload, invalid("manifest")
		}
		files[file.Path] = file
	}
	for _, required := range []string{"app/data/site.ts", "app/data/about.ts", "app/data/projects.ts", "app/data/project-covers.ts", "shared/seo.ts", "nuxt.config.ts", "app/components/SiteFooter.vue"} {
		if files[required].Path == "" {
			return payload, invalid("manifest sources")
		}
	}
	assets := map[string]bool{}
	for _, asset := range payload.Assets {
		file, exists := files["public/"+asset.Path]
		if !validReference(Reference{Kind: "builtin", ID: asset.ID}) || assets[asset.ID] || !builtinPathPattern.MatchString(asset.Path) || !exists || file.SHA256 != asset.SHA256 || file.ByteSize != asset.ByteSize || !hashPattern.MatchString(asset.SHA256) || asset.Width < 1 || asset.Width > 32768 || asset.Height < 1 || asset.Height > 32768 || !Text(asset.Alt, 1, 500, true) {
			return payload, invalid("builtin asset")
		}
		if strings.HasSuffix(asset.Path, ".svg") && asset.MediaType != "image/svg+xml" || strings.HasSuffix(asset.Path, ".png") && asset.MediaType != "image/png" {
			return payload, invalid("builtin mime")
		}
		assets[asset.ID] = true
	}
	ids, slugs := map[string]bool{}, map[string]bool{}
	for _, category := range payload.Categories {
		if !validReference(Reference{Kind: "builtin", ID: category.ID}) || !Slug(category.Slug) || !Text(category.Name, 1, 80, false) || category.Order < 0 || ids[category.ID] || slugs[category.Slug] {
			return payload, invalid("seed category")
		}
		ids[category.ID] = true
		slugs[category.Slug] = true
	}
	ids = map[string]bool{}
	projectSlugs := map[string]bool{}
	for _, project := range payload.Projects {
		if err := ValidateProject(project.ProjectInput); err != nil {
			return payload, err
		}
		if !validReference(Reference{Kind: "builtin", ID: project.ID}) || ids[project.ID] || projectSlugs[project.Slug] || project.Order < 0 || !slugs[project.Category] || project.Cover.Kind != "builtin" || !assets[project.Cover.ID] {
			return payload, invalid("seed project")
		}
		ids[project.ID] = true
		projectSlugs[project.Slug] = true
	}
	if err := ValidateProfile(payload.Profile); err != nil {
		return payload, err
	}
	if err := ValidateSettings(payload.Settings); err != nil {
		return payload, err
	}
	if jsonString(payload.Profile.Site.Introduction) != jsonString(payload.Settings.HomeIntroduction) {
		return payload, invalid("homeIntroduction")
	}
	return payload, nil
}

// Import is an explicit local CLI operation only. It never overwrites an
// existing workspace and never changes public HTML or production files.
func Import(ctx context.Context, db *sql.DB, input io.Reader) (ImportSummary, error) {
	const maximum = 2 << 20
	raw, err := io.ReadAll(io.LimitReader(input, maximum+1))
	if err != nil {
		return ImportSummary{}, err
	}
	if len(raw) > maximum {
		return ImportSummary{}, invalid("seed size")
	}
	var seed Seed
	if err := strictSeedJSON(raw, &seed); err != nil {
		return ImportSummary{}, err
	}
	payload, err := validateSeed(seed)
	if err != nil {
		return ImportSummary{}, err
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return ImportSummary{}, err
	}
	defer tx.Rollback()
	// Write lock first: parallel CLI/API attempts cannot pass the empty check.
	if _, err := tx.ExecContext(ctx, "UPDATE workspace SET revision=revision WHERE id=1"); err != nil {
		return ImportSummary{}, err
	}
	var existing ImportSummary
	err = tx.QueryRowContext(ctx, "SELECT source_revision,manifest_sha256,payload_sha256,project_count,category_count FROM content_imports WHERE id=1").Scan(&existing.SourceRevision, &existing.ManifestSHA256, &existing.PayloadSHA256, &existing.ProjectCount, &existing.CategoryCount)
	if err == nil {
		existing.AlreadyImported = true
		return existing, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return ImportSummary{}, err
	}
	var revision, content, accounts int64
	if err := tx.QueryRowContext(ctx, "SELECT revision FROM workspace WHERE id=1").Scan(&revision); err != nil {
		return ImportSummary{}, err
	}
	if err := tx.QueryRowContext(ctx, "SELECT (SELECT count(*) FROM project_drafts)+(SELECT count(*) FROM project_categories)+(SELECT count(*) FROM workspace_documents)+(SELECT count(*) FROM assets)").Scan(&content); err != nil {
		return ImportSummary{}, err
	}
	if err := tx.QueryRowContext(ctx, "SELECT count(*) FROM administrators WHERE id=1").Scan(&accounts); err != nil {
		return ImportSummary{}, err
	}
	if accounts != 1 {
		return ImportSummary{}, &Error{Status: 503, Code: "SETUP_REQUIRED", Message: "请先通过受控 CLI 初始化管理员。"}
	}
	if revision != 0 || content != 0 {
		return ImportSummary{}, conflict("IMPORT_NOT_EMPTY", "工作区已有内容或修改记录，拒绝覆盖。")
	}
	now := time.Now().UTC().Unix()
	for _, asset := range payload.Assets {
		if _, err := tx.ExecContext(ctx, `INSERT INTO assets(id,storage_kind,storage_key,sha256,media_type,byte_size,width,height,created_at) VALUES(?,'builtin',?,?,?,?,?,?,?)`, asset.ID, asset.Path, asset.SHA256, asset.MediaType, asset.ByteSize, asset.Width, asset.Height, now); err != nil {
			return ImportSummary{}, err
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO asset_metadata(asset_id,display_name,alt,public_use_confirmed,public_confirmed_at,public_confirmed_by,public_confirmation_note,created_at,updated_at) VALUES(?,?,?,1,?,1,?,?,?)`, asset.ID, asset.ID, asset.Alt, now, "既有已确认仓库静态资源；导入不代表真实项目截图。", now, now); err != nil {
			return ImportSummary{}, err
		}
	}
	for _, category := range payload.Categories {
		if _, err := tx.ExecContext(ctx, `INSERT INTO project_categories(id,slug,name,sort_order,created_at,updated_at) VALUES(?,?,?,?,?,?)`, category.ID, category.Slug, category.Name, category.Order, now, now); err != nil {
			return ImportSummary{}, err
		}
	}
	for _, project := range payload.Projects {
		if _, err := SaveProject(ctx, tx, project.ID, project.ProjectInput, true, now); err != nil {
			return ImportSummary{}, err
		}
		if _, err := tx.ExecContext(ctx, "UPDATE project_drafts SET sort_order=? WHERE id=?", project.Order, project.ID); err != nil {
			return ImportSummary{}, err
		}
	}
	if err := SaveProfile(ctx, tx, payload.Profile, now); err != nil {
		return ImportSummary{}, err
	}
	if err := SaveSettings(ctx, tx, payload.Settings, now); err != nil {
		return ImportSummary{}, err
	}
	summary := ImportSummary{SourceRevision: seed.SourceRevision, ManifestSHA256: seed.ManifestSHA256, PayloadSHA256: seed.PayloadSHA256, ProjectCount: len(payload.Projects), CategoryCount: len(payload.Categories)}
	if _, err := tx.ExecContext(ctx, `INSERT INTO content_imports(id,workspace_id,source_revision,manifest_sha256,payload_sha256,imported_at,project_count,category_count) VALUES(1,1,?,?,?,?,?,?)`, seed.SourceRevision, seed.ManifestSHA256, seed.PayloadSHA256, now, summary.ProjectCount, summary.CategoryCount); err != nil {
		return ImportSummary{}, err
	}
	if _, err := tx.ExecContext(ctx, "UPDATE workspace SET revision=1,updated_at=? WHERE id=1", now); err != nil {
		return ImportSummary{}, err
	}
	change := map[string]any{"summary": summary, "categories": payload.Categories, "projects": payload.Projects, "profile": payload.Profile, "settings": payload.Settings}
	changeJSON := jsonString(change)
	if utf8.RuneCountInString(changeJSON) > 1<<20 {
		return ImportSummary{}, invalid("import history size")
	}
	if _, err := tx.ExecContext(ctx, "INSERT INTO workspace_changes(revision,actor_administrator_id,action,changed_at,change_json) VALUES(1,1,'content.import',?,?)", now, changeJSON); err != nil {
		return ImportSummary{}, err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO audit_events(actor_administrator_id,action,resource_type,resource_id,outcome,metadata_json,created_at) VALUES(1,'content.import','workspace','1','success',?,?)`, jsonString(summary), now); err != nil {
		return ImportSummary{}, err
	}
	if err := tx.Commit(); err != nil {
		return ImportSummary{}, err
	}
	return summary, nil
}
