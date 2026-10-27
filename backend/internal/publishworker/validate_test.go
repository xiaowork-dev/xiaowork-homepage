package publishworker

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"html"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/xiaowork-dev/xiaowork-homepage/backend/internal/contentdata"
	"github.com/xiaowork-dev/xiaowork-homepage/backend/internal/publishfs"
	"github.com/xiaowork-dev/xiaowork-homepage/backend/internal/publishmodel"
)

func ident(prefix string, n byte) string { return prefix + "_" + strings.Repeat(string(n), 32) }
func fixture() (publishmodel.Assignment, publishmodel.Snapshot) {
	yes := true
	github := "https://github.com/xiaowork-dev"
	s := publishmodel.Snapshot{SchemaVersion: 1, SnapshotID: ident("snap", '1'), WorkspaceRevision: "ws-5", CreatedAt: "2026-10-27T00:00:00Z",
		SiteProfile:     contentdata.SiteProfile{Name: "XiaoWork", Role: "Developer", Introduction: []string{"Public introduction"}, Directions: []string{"Web"}, Technologies: []string{"Go"}, GitHubURL: &github},
		AboutProfile:    contentdata.AboutProfile{BrandIntroduction: "Public brand", PersonalIntroduction: []string{"Public biography"}, Capabilities: []contentdata.Capability{}, Principles: []contentdata.Principle{}, Contacts: []contentdata.Contact{}},
		SiteSettings:    contentdata.Settings{SiteTitle: "Public site", SiteDescription: "Site description", DefaultSEODescription: "Default description", HomeIntroduction: []string{"Home introduction"}, SocialLinks: []contentdata.SocialLink{}, Pages: contentdata.PageSEOSet{Home: contentdata.PageSEO{Title: "Home title", Description: "Home description"}, Projects: contentdata.PageSEO{Title: "Projects title", Description: "Projects description"}, About: contentdata.PageSEO{Title: "About title", Description: "About description"}}},
		VisibleProjects: []publishmodel.PublicProject{{ID: "project-blog", Order: 0, ProjectInput: contentdata.ProjectInput{Slug: "blog", Name: "Blog public", Summary: "Public blog summary", Category: "web", TechStack: []string{}, Status: "unconfirmed", Featured: &yes, Visible: &yes, IsPlaceholder: &yes, Cover: contentdata.Reference{Kind: "builtin", ID: "builtin-cover-blog"}, CoverAlt: "Blog placeholder", CoverKind: "placeholder"}}}, Categories: []publishmodel.PublicCategory{{Slug: "web", Name: "Web", Order: 0}}, MediaManifest: []publishmodel.Media{}, LegacyAssetAllowlist: []string{"builtin-cover-blog", "builtin-social-share", "builtin-brand-icon"}}
	data, _ := json.Marshal(s)
	j := publishmodel.Assignment{ID: ident("job", '1'), Kind: "publish", SnapshotID: s.SnapshotID, SnapshotSHA256: publishfs.Hash(data), Snapshot: data, WorkspaceRevision: s.WorkspaceRevision, ReleaseID: ident("rel", '1'), LeaseToken: base64.RawURLEncoding.EncodeToString(make([]byte, 32)), LeaseExpiresAt: "2026-10-27T00:05:00Z", SourceRevision: strings.Repeat("b", 40), BuilderID: "sha256:" + strings.Repeat("c", 64), Assets: []publishmodel.MediaAsset{}}
	return j, s
}

func outputFixture(t *testing.T, job publishmodel.Assignment, s publishmodel.Snapshot) string {
	t.Helper()
	root := t.TempDir()
	prefix := "/_releases/" + job.ReleaseID + "/"
	base := "/"
	if job.Kind == "preview" {
		base = "/api/admin/v1/previews/" + job.ReleaseID + "/"
		prefix = base
	}
	assets := strings.TrimPrefix(prefix, "/")
	if job.Kind == "preview" {
		assets = ""
	}
	write := func(name, body string) {
		target := filepath.Join(root, filepath.FromSlash(name))
		if err := os.MkdirAll(filepath.Dir(target), 0700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(target, []byte(body), 0600); err != nil {
			t.Fatal(err)
		}
	}
	for _, name := range []string{"assets/favicon.svg", "assets/images/social/xiaowork-share.png", "assets/theme-init.js", "_nuxt/app.js", "_nuxt/app.css"} {
		write(assets+name, "resource")
	}
	for i, route := range []string{"/", "/projects/", "/about/"} {
		page := []contentdata.PageSEO{s.SiteSettings.Pages.Home, s.SiteSettings.Pages.Projects, s.SiteSettings.Pages.About}[i]
		body := "XiaoWork"
		if i == 1 {
			body += " Blog public Public blog summary"
		}
		text := fmt.Sprintf(`<html><head><title>%s</title><meta name="description" content="%s"><meta property="og:title" content="%s"><meta property="og:description" content="%s"><meta property="og:url" content="https://xiaoworks.com%s"><meta property="og:image" content="https://xiaoworks.com%sassets/images/social/xiaowork-share.png"><meta name="xiaowork-release" content="%s"><meta name="xiaowork-snapshot" content="%s"><link rel="canonical" href="https://xiaoworks.com%s"><link rel="icon" href="%sassets/favicon.svg"><link rel="stylesheet" href="%s_nuxt/app.css"><script src="%s_nuxt/app.js"></script></head><body>%s<a href="%sabout/">About</a><a href="https://github.com/xiaowork-dev">GitHub</a></body></html>`, html.EscapeString(page.Title), page.Description, page.Title, page.Description, route, prefix, job.ReleaseID, job.SnapshotSHA256, route, prefix, prefix, prefix, body, base)
		name := strings.Trim(route, "/") + "/index.html"
		if route == "/" {
			name = "index.html"
		}
		write(name, text)
	}
	write("404.html", "not found")
	write("health.json", `{"status":"ok"}`)
	write("robots.txt", "User-agent: *\nSitemap: https://xiaoworks.com/sitemap.xml\n")
	write("sitemap.xml", `<urlset><url><loc>https://xiaoworks.com/</loc></url><url><loc>https://xiaoworks.com/projects/</loc></url><url><loc>https://xiaoworks.com/about/</loc></url></urlset>`)
	if err := writeMarker(root, job); err != nil {
		t.Fatal(err)
	}
	return root
}

func TestSealedAssignmentStrictProjection(t *testing.T) {
	job, _ := fixture()
	if _, err := ValidateAssignment(job, job.SourceRevision, job.BuilderID); err != nil {
		t.Fatal(err)
	}
	for _, change := range []string{"hash", "private", "hidden", "missing-media", "identity", "source", "unconfirmed-media"} {
		t.Run(change, func(t *testing.T) {
			j, s := fixture()
			switch change {
			case "hash":
				j.SnapshotSHA256 = strings.Repeat("f", 64)
			case "private":
				var raw map[string]any
				json.Unmarshal(j.Snapshot, &raw)
				raw["passwordHash"] = "secret"
				j.Snapshot, _ = json.Marshal(raw)
				j.SnapshotSHA256 = publishfs.Hash(j.Snapshot)
			case "hidden":
				no := false
				s.VisibleProjects[0].Visible = &no
				j.Snapshot, _ = json.Marshal(s)
				j.SnapshotSHA256 = publishfs.Hash(j.Snapshot)
			case "missing-media":
				s.VisibleProjects[0].Cover = contentdata.Reference{Kind: "media", ID: "media-missing"}
				j.Snapshot, _ = json.Marshal(s)
				j.SnapshotSHA256 = publishfs.Hash(j.Snapshot)
			case "identity":
				j.ReleaseID = "../../outside"
			case "source":
				j.SourceRevision = strings.Repeat("d", 40)
			case "unconfirmed-media":
				j.Assets = []publishmodel.MediaAsset{{ID: "unknown", StorageKind: "upload", SHA256: strings.Repeat("a", 64), Bytes: 10, MediaType: "image/png", PublicPath: "media/test.png"}}
			}
			if _, err := ValidateAssignment(j, job.SourceRevision, job.BuilderID); err == nil {
				t.Fatal("accepted invalid sealed assignment")
			}
		})
	}
}

func TestActualOutputValidationAndFailureGates(t *testing.T) {
	j, s := fixture()
	root := outputFixture(t, j, s)
	if err := ValidateOutput(root, j, s); err != nil {
		t.Fatal(err)
	}
	for _, change := range []string{"wrong-seo", "wrong-marker", "missing-resource", "external-resource", "unversioned-resource", "payload", "private-file", "bad-chunk", "noindex", "missing-project"} {
		t.Run(change, func(t *testing.T) {
			j, s := fixture()
			root := outputFixture(t, j, s)
			file := filepath.Join(root, "index.html")
			data, _ := os.ReadFile(file)
			switch change {
			case "wrong-seo":
				data = []byte(strings.Replace(string(data), "Home title", "Wrong title", 1))
			case "wrong-marker":
				os.WriteFile(filepath.Join(root, publishmodel.MarkerPath), []byte(`{}`), 0600)
			case "missing-resource":
				os.Remove(filepath.Join(root, "_releases", j.ReleaseID, "_nuxt", "app.js"))
			case "external-resource":
				data = []byte(strings.Replace(string(data), "src=\"/_releases/"+j.ReleaseID+"/_nuxt/app.js\"", "src=\"https://evil.invalid/app.js\"", 1))
			case "unversioned-resource":
				data = []byte(strings.Replace(string(data), "src=\"/_releases/"+j.ReleaseID+"/_nuxt/app.js\"", "src=\"/theme-init.js\"", 1))
			case "payload":
				os.WriteFile(filepath.Join(root, "_payload.json"), []byte(`{}`), 0600)
			case "private-file":
				os.WriteFile(filepath.Join(root, "private.sqlite"), []byte("private"), 0600)
			case "bad-chunk":
				os.WriteFile(filepath.Join(root, "_releases", j.ReleaseID, "_nuxt", "app.js"), []byte(`import("./missing.js")`), 0600)
			case "noindex":
				data = []byte(strings.Replace(string(data), "</head>", `<meta name="robots" content="noindex"></head>`, 1))
			case "missing-project":
				p := filepath.Join(root, "projects", "index.html")
				d, _ := os.ReadFile(p)
				os.WriteFile(p, []byte(strings.ReplaceAll(string(d), "Public blog summary", "")), 0600)
			}
			os.WriteFile(file, data, 0600)
			if err := ValidateOutput(root, j, s); err == nil {
				t.Fatal("invalid generated output accepted")
			}
		})
	}
}

func TestPreviewUsesPrivateResourcePrefix(t *testing.T) {
	j, s := fixture()
	j.Kind = "preview"
	j.ReleaseID = ident("pre", '1')
	root := outputFixture(t, j, s)
	if err := ValidateOutput(root, j, s); err != nil {
		t.Fatal(err)
	}
}

func TestMediaCopyVerifiesHashAndNeverHardlinks(t *testing.T) {
	root, work := t.TempDir(), t.TempDir()
	os.Mkdir(filepath.Join(root, "derived"), 0700)
	os.Mkdir(filepath.Join(work, "public"), 0700)
	data := []byte("sanitized bytes")
	hash := publishfs.Hash(data)
	source := filepath.Join(root, "derived", hash+".png")
	os.WriteFile(source, data, 0600)
	j, _ := fixture()
	j.Assets = []publishmodel.MediaAsset{{ID: "media-one", StorageKind: "upload", SHA256: hash, Bytes: int64(len(data)), MediaType: "image/png", PublicPath: "media/" + hash + ".png"}}
	if err := copyMedia(root, work, j); err != nil {
		t.Fatal(err)
	}
	os.WriteFile(source, []byte("mutated"), 0600)
	copied, err := os.ReadFile(filepath.Join(work, "public", "media", hash+".png"))
	if err != nil || string(copied) != string(data) {
		t.Fatal("media shared writable inode", err)
	}
	other := t.TempDir()
	os.Mkdir(filepath.Join(other, "public"), 0700)
	if err := copyMedia(root, other, j); err == nil {
		t.Fatal("corrupt media accepted")
	}
}

func TestURLValidationDoesNotFetchOrAcceptUnknownExternalLinks(t *testing.T) {
	files := map[string]bool{"_releases/" + ident("rel", '1') + "/_nuxt/app.js": true}
	prefix := "/_releases/" + ident("rel", '1') + "/"
	allowed := map[string]bool{"https://github.com/example?tab=repositories": true}
	if err := verifyURL("https://github.com/example?tab=repositories", false, prefix, "/", files, allowed); err != nil {
		t.Fatal(err)
	}
	for _, u := range []string{"//evil.invalid/x.js", "https://evil.invalid/x.js", "/theme-init.js", "/_releases/../private", "javascript:alert(1)", "http://127.0.0.1/"} {
		if verifyURL(u, true, prefix, "/", files, allowed) == nil {
			t.Fatal("accepted", u)
		}
	}
}

func TestMarkerNeverOverwritesBuildControlledFile(t *testing.T) {
	j, s := fixture()
	root := outputFixture(t, j, s)
	original, err := os.ReadFile(filepath.Join(root, publishmodel.MarkerPath))
	if err != nil {
		t.Fatal(err)
	}
	if err = writeMarker(root, j); err == nil {
		t.Fatal("overwrote existing build-controlled marker")
	}
	actual, _ := os.ReadFile(filepath.Join(root, publishmodel.MarkerPath))
	if string(actual) != string(original) {
		t.Fatal("marker changed on rejected write")
	}
}
