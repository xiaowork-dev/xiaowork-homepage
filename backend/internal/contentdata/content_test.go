package contentdata

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/xiaowork-dev/xiaowork-homepage/backend/internal/store"
)

func testDB(t *testing.T) *sql.DB {
	t.Helper()
	db, err := store.Open(filepath.Join(t.TempDir(), "content.sqlite"), true)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	if err := store.Migrate(context.Background(), db); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec("INSERT INTO administrators(id,username,password_hash,created_at,updated_at) VALUES(1,'content-test',?,1,1)", strings.Repeat("test-hash-only", 4)); err != nil {
		t.Fatal(err)
	}
	return db
}
func seedBytes(t *testing.T) []byte {
	t.Helper()
	raw, err := os.ReadFile("../../seed/v1.json")
	if err != nil {
		t.Fatal(err)
	}
	return raw
}
func importFixture(t *testing.T, db *sql.DB) ImportSummary {
	t.Helper()
	summary, err := Import(context.Background(), db, bytes.NewReader(seedBytes(t)))
	if err != nil {
		t.Fatal(err)
	}
	return summary
}
func transaction(t *testing.T, db *sql.DB, fn func(*sql.Tx) error) {
	t.Helper()
	tx, err := db.Begin()
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback()
	if err := fn(tx); err != nil {
		t.Fatal(err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}
}

func TestV1ImportPreservesContentAndNeverOverwritesEdits(t *testing.T) {
	db := testDB(t)
	ctx := context.Background()
	summary := importFixture(t, db)
	if summary.SourceRevision != "e6205c074191a2a1ea021234cf7ae26cc70fbd7a" || summary.ProjectCount != 3 || summary.CategoryCount != 3 || summary.AlreadyImported {
		t.Fatalf("unexpected provenance: %+v", summary)
	}
	projects, err := Projects(ctx, db)
	if err != nil || len(projects) != 3 {
		t.Fatalf("projects: %v %v", projects, err)
	}
	for index, p := range projects {
		if p.Status != "unconfirmed" || len(p.TechStack) != 0 || p.DemoURL != nil || p.RepositoryURL != nil || p.CoverKind != "placeholder" || !*p.IsPlaceholder || p.Order != int64(index+1) {
			t.Fatalf("import invented project information: %+v", p)
		}
	}
	profile, ready, err := ProfileView(ctx, db)
	if err != nil || !ready || len(profile.About.PersonalIntroduction) != 0 || profile.About.Resume != nil {
		t.Fatalf("profile authenticity lost: %+v %v", profile, err)
	}
	settings, ready, err := SettingsView(ctx, db)
	if err != nil || !ready || settings.SiteTitle == "" || settings.Pages.Home.Title == "" || settings.FooterText != "用代码构建想法。" {
		t.Fatalf("settings lost: %+v %v", settings, err)
	}
	transaction(t, db, func(tx *sql.Tx) error {
		p := projects[0]
		p.Name = "用户编辑后的标题"
		_, err := SaveProject(ctx, tx, p.ID, p.ProjectInput, false, 2_000_000_000)
		return err
	})
	again := importFixture(t, db)
	if !again.AlreadyImported {
		t.Fatal("second import must report no-op")
	}
	saved, err := ProjectByID(ctx, db, projects[0].ID)
	if err != nil || saved.Name != "用户编辑后的标题" {
		t.Fatal("repeat import overwrote edits")
	}
	var history, provenance int
	db.QueryRow("SELECT count(*) FROM workspace_changes").Scan(&history)
	db.QueryRow("SELECT count(*) FROM content_imports").Scan(&provenance)
	if history != 1 || provenance != 1 {
		t.Fatalf("repeat import created history: %d %d", history, provenance)
	}
	for _, query := range []string{"UPDATE content_imports SET source_revision='changed'", "DELETE FROM content_imports", "UPDATE workspace_changes SET action='changed'", "DELETE FROM workspace_changes"} {
		if _, err := db.Exec(query); err == nil {
			t.Fatal("immutable provenance/history changed")
		}
	}
}

func TestImportRejectsTamperingAndNonemptyWorkspaceAtomically(t *testing.T) {
	db := testDB(t)
	raw := seedBytes(t)
	changed := bytes.Replace(raw, []byte("XiaoWork Blog"), []byte("Forged Blog!!"), 1)
	if _, err := Import(context.Background(), db, bytes.NewReader(changed)); err == nil {
		t.Fatal("tampered payload accepted")
	}
	var assets int
	db.QueryRow("SELECT count(*) FROM assets").Scan(&assets)
	if assets != 0 {
		t.Fatal("failed import leaked partial assets")
	}
	if _, err := db.Exec("INSERT INTO project_categories(id,slug,name,created_at,updated_at) VALUES('user','user','用户分类',1,1)"); err != nil {
		t.Fatal(err)
	}
	if _, err := Import(context.Background(), db, bytes.NewReader(raw)); err == nil {
		t.Fatal("must not overwrite existing workspace")
	}
	var categories int
	db.QueryRow("SELECT count(*) FROM project_categories").Scan(&categories)
	if categories != 1 {
		t.Fatal("nonempty rejection changed content")
	}
	if err := strictSeedJSON([]byte(`{"schemaVersion":1,"schemaVersion":1}`), &Seed{}); err == nil {
		t.Fatal("duplicate JSON accepted")
	}
}

func TestProjectLifecycleCategoryReferencesAndAtomicOrdering(t *testing.T) {
	db := testDB(t)
	importFixture(t, db)
	ctx := context.Background()
	p, err := ProjectByID(ctx, db, "xiaowork-blog")
	if err != nil {
		t.Fatal(err)
	}
	transaction(t, db, func(tx *sql.Tx) error { _, err := ArchiveProject(ctx, tx, p.ID, true, 2_000_000_000); return err })
	archived, _ := ProjectByID(ctx, db, p.ID)
	if archived.ArchivedAt == nil || *archived.Visible {
		t.Fatal("archive must hide project")
	}
	transaction(t, db, func(tx *sql.Tx) error {
		if err := DeleteCategory(ctx, tx, "cat-website"); err == nil {
			t.Fatal("category used by archived/hidden drafts was deleted")
		}
		return nil
	})
	transaction(t, db, func(tx *sql.Tx) error { _, err := ArchiveProject(ctx, tx, p.ID, false, 2_000_000_001); return err })
	restored, _ := ProjectByID(ctx, db, p.ID)
	if restored.ArchivedAt != nil || *restored.Visible {
		t.Fatal("restore must remain hidden")
	}
	transaction(t, db, func(tx *sql.Tx) error {
		_, err := SaveCategory(ctx, tx, "cat-new", "new-category", "新分类", true, 2_000_000_002)
		return err
	})
	transaction(t, db, func(tx *sql.Tx) error { return DeleteCategory(ctx, tx, "cat-new") })
	tx, err := db.Begin()
	if err != nil {
		t.Fatal(err)
	}
	if err := Order(ctx, tx, "projects", []string{"xiaowork-blog", "xiaowork-blog", "xiaowork-erp"}, 2_000_000_002); err == nil {
		t.Fatal("duplicate IDs must fail")
	}
	tx.Rollback()
	items, _ := Projects(ctx, db)
	if items[0].ID != "xiaowork-blog" {
		t.Fatal("invalid sort partially changed rows")
	}
	transaction(t, db, func(tx *sql.Tx) error {
		return Order(ctx, tx, "projects", []string{"xiaowork-erp", "xiaowork-nav", "xiaowork-blog"}, 2_000_000_003)
	})
	items, _ = Projects(ctx, db)
	if items[0].ID != "xiaowork-erp" || items[2].Order != 3 {
		t.Fatal("sort did not persist")
	}
}

func TestProfileSettingsShareIntroductionAndPreserveOtherFields(t *testing.T) {
	db := testDB(t)
	importFixture(t, db)
	ctx := context.Background()
	profile, _, _ := ProfileView(ctx, db)
	settings, _, _ := SettingsView(ctx, db)
	originalTitle := settings.SiteTitle
	profile.Site.Introduction = []string{"已确认的新简介"}
	profile.Site.Name = "XiaoWork Modified"
	transaction(t, db, func(tx *sql.Tx) error { return SaveProfile(ctx, tx, profile, 2_000_000_000) })
	settings, _, _ = SettingsView(ctx, db)
	if settings.HomeIntroduction[0] != "已确认的新简介" || settings.SiteTitle != originalTitle {
		t.Fatal("profile changed settings or duplicated introduction")
	}
	settings.HomeIntroduction = []string{"设置页中的已确认简介"}
	settings.FooterText = "已确认的页脚"
	transaction(t, db, func(tx *sql.Tx) error { return SaveSettings(ctx, tx, settings, 2_000_000_001) })
	profile, _, _ = ProfileView(ctx, db)
	if profile.Site.Introduction[0] != "设置页中的已确认简介" || profile.Site.Name != "XiaoWork Modified" {
		t.Fatal("settings cleared profile")
	}
	var refs int
	db.QueryRow("SELECT count(*) FROM document_draft_assets WHERE document_kind='site'").Scan(&refs)
	if refs != 2 {
		t.Fatalf("brand/share refs lost: %d", refs)
	}
	missing := "unknown-asset"
	profile.Site.AvatarAssetID = &missing
	tx, _ := db.Begin()
	if err := SaveProfile(ctx, tx, profile, 2_000_000_002); err == nil {
		t.Fatal("unknown asset accepted")
	}
	tx.Rollback()
	var siteRaw string
	db.QueryRow("SELECT content_json FROM workspace_documents WHERE kind='site'").Scan(&siteRaw)
	var site map[string]json.RawMessage
	json.Unmarshal([]byte(siteRaw), &site)
	var storedSettings map[string]json.RawMessage
	json.Unmarshal(site["settings"], &storedSettings)
	if _, duplicated := storedSettings["homeIntroduction"]; duplicated {
		t.Fatal("introduction stored twice")
	}
}

func TestContentValidationRejectsActiveHTMLAndUnsafeURLs(t *testing.T) {
	for _, value := range []string{"javascript:alert(1)", "http://example.com", "https://localhost/", "https://127.0.0.1/", "https://10.2.3.4/", "https://127.1/", "https://0x7f.0.0.1/", "https://2130706433/", "https://0177.0.0.1/", "https://example..com/", "https://example.123/", "https://example.0x7f/", "https://-example.com/", "https://example-.com/", "https://" + strings.Repeat("a", 64) + ".com/", "https://例子.com/", "https://[::1]/", "https://[fd00::1]/", "https://example.com/admin/", "https://user:pass@example.com/", "https://example.com:8443/"} {
		if PublicURL(value, false) {
			t.Fatalf("unsafe URL accepted: %s", value)
		}
	}
	if !PublicURL("https://github.com/xiaowork-dev/xiaowork-homepage", false) || !PublicURL("mailto:hello@example.com", true) {
		t.Fatal("valid confirmed link rejected")
	}
	for _, value := range []string{"https://8.8.8.8/", "https://[2001:4860:4860::8888]/", "https://xn--fsqu00a.com/", "https://github.com./"} {
		if !PublicURL(value, false) {
			t.Fatalf("valid public host rejected: %s", value)
		}
	}
	if Text("<script>alert(1)</script>", 1, 100, true) || Text("bad\x00text", 1, 100, true) {
		t.Fatal("active markup/control accepted")
	}
	db := testDB(t)
	importFixture(t, db)
	p, _ := ProjectByID(context.Background(), db, "xiaowork-blog")
	p.Status = "invented"
	if ValidateProject(p.ProjectInput) == nil {
		t.Fatal("unknown status accepted")
	}
}
