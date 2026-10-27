package publishworker

import (
	"encoding/base64"
	"errors"
	"html"
	"io/fs"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path"
	"regexp"
	"strings"

	"github.com/xiaowork-dev/xiaowork-homepage/backend/internal/contentdata"
	"github.com/xiaowork-dev/xiaowork-homepage/backend/internal/publishfs"
	"github.com/xiaowork-dev/xiaowork-homepage/backend/internal/publishmodel"
)

var revisionFormat = regexp.MustCompile(`^ws-[0-9]+$`)

// ValidateAssignment checks both the sealed byte hash and the strict public
// projection. API-only fields cannot be smuggled into a build's public bundle.
func ValidateAssignment(job publishmodel.Assignment, source, builder string) (publishmodel.Snapshot, error) {
	var snapshot publishmodel.Snapshot
	lease, leaseErr := base64.RawURLEncoding.DecodeString(job.LeaseToken)
	if !publishfs.ValidID(job.ID, "job") || !publishfs.ValidID(job.SnapshotID, "snap") || !publishfs.ValidHash(job.SnapshotSHA256) || leaseErr != nil || len(lease) != 32 || base64.RawURLEncoding.EncodeToString(lease) != job.LeaseToken || job.SourceRevision != source || job.BuilderID != builder || !publishmodel.SourceHash.MatchString(source) || builder == "" || !revisionFormat.MatchString(job.WorkspaceRevision) {
		return snapshot, errors.New("invalid publication assignment")
	}
	if job.Kind == "preview" {
		if !publishfs.ValidID(job.ReleaseID, "pre") {
			return snapshot, errors.New("invalid preview identity")
		}
	} else if job.Kind == "publish" || job.Kind == "rollback" {
		if !publishfs.ValidID(job.ReleaseID, "rel") {
			return snapshot, errors.New("invalid release identity")
		}
	} else {
		return snapshot, errors.New("invalid job kind")
	}
	if job.ExpectedPreviousReleaseID != "" && !publishfs.ValidID(job.ExpectedPreviousReleaseID, "rel") {
		return snapshot, errors.New("invalid previous release")
	}
	if (job.Kind == "rollback" && job.TargetReleaseID != job.ReleaseID) || (job.Kind != "rollback" && job.TargetReleaseID != "") {
		return snapshot, errors.New("invalid rollback target")
	}
	if len(job.Snapshot) == 0 || len(job.Snapshot) > MaxMessage || publishfs.Hash(job.Snapshot) != job.SnapshotSHA256 {
		return snapshot, errors.New("snapshot hash mismatch")
	}
	if err := strictJSON(job.Snapshot, &snapshot); err != nil {
		return snapshot, err
	}
	if snapshot.SchemaVersion != 1 || snapshot.SnapshotID != job.SnapshotID || snapshot.WorkspaceRevision != job.WorkspaceRevision || snapshot.CreatedAt == "" || snapshot.VisibleProjects == nil || snapshot.Categories == nil || snapshot.MediaManifest == nil || snapshot.LegacyAssetAllowlist == nil {
		return snapshot, errors.New("snapshot metadata mismatch")
	}
	if err := contentdata.ValidateProfile(contentdata.Profile{Site: snapshot.SiteProfile, About: snapshot.AboutProfile}); err != nil {
		return snapshot, errors.New("invalid snapshot profile")
	}
	if err := contentdata.ValidateSettings(snapshot.SiteSettings); err != nil {
		return snapshot, errors.New("invalid snapshot settings")
	}
	ids := map[string]bool{}
	categories := map[string]bool{}
	for _, category := range snapshot.Categories {
		if !contentdata.Slug(category.Slug) || !contentdata.Text(category.Name, 1, 80, false) || categories[category.Slug] {
			return snapshot, errors.New("invalid snapshot category")
		}
		categories[category.Slug] = true
	}
	media := map[string]publishmodel.Media{}
	for _, m := range snapshot.MediaManifest {
		ext := extension(m.MediaType)
		if m.ID == "" || media[m.ID].ID != "" || !publishfs.ValidHash(m.SHA256) || ext == "" || ext == "svg" || m.Path != "media/"+m.SHA256+"."+ext || m.ByteSize < 1 || m.ByteSize > 32<<20 || m.Width < 1 || m.Width > 8192 || m.Height < 1 || m.Height > 8192 || m.Width*m.Height > 25_000_000 {
			return snapshot, errors.New("invalid snapshot media")
		}
		media[m.ID] = m
	}
	builtins := map[string]bool{}
	for _, id := range snapshot.LegacyAssetAllowlist {
		if _, ok := publishmodel.BuiltinPaths[id]; !ok || builtins[id] {
			return snapshot, errors.New("invalid builtin allowlist")
		}
		builtins[id] = true
	}
	for _, project := range snapshot.VisibleProjects {
		if project.ID == "" || ids[project.ID] || project.Visible == nil || !*project.Visible || !categories[project.Category] {
			return snapshot, errors.New("invalid public project")
		}
		if err := contentdata.ValidateProject(project.ProjectInput); err != nil {
			return snapshot, errors.New("invalid public project")
		}
		ids[project.ID] = true
		if project.Cover.Kind == "media" {
			if _, ok := media[project.Cover.ID]; !ok {
				return snapshot, errors.New("missing project media")
			}
		} else if !builtins[project.Cover.ID] {
			return snapshot, errors.New("missing builtin media")
		}
	}
	assetIDs := map[string]bool{}
	for _, asset := range job.Assets {
		if assetIDs[asset.ID] || !publishfs.ValidHash(asset.SHA256) || asset.Bytes < 1 {
			return snapshot, errors.New("invalid frozen media")
		}
		assetIDs[asset.ID] = true
		if asset.StorageKind == "upload" {
			m, ok := media[asset.ID]
			if !ok || asset.SHA256 != m.SHA256 || asset.Bytes != m.ByteSize || asset.MediaType != m.MediaType || asset.PublicPath != m.Path {
				return snapshot, errors.New("frozen media mismatch")
			}
		} else if asset.StorageKind == "builtin" {
			if !builtins[asset.ID] || asset.PublicPath != publishmodel.BuiltinPaths[asset.ID] {
				return snapshot, errors.New("frozen builtin mismatch")
			}
		} else {
			return snapshot, errors.New("invalid storage kind")
		}
	}
	for id := range media {
		if !assetIDs[id] {
			return snapshot, errors.New("missing frozen media")
		}
	}
	for _, id := range []*string{snapshot.SiteProfile.AvatarAssetID, snapshot.SiteProfile.BrandAssetID, snapshot.SiteSettings.DefaultShareAssetID, snapshot.SiteSettings.Pages.Home.ShareAssetID, snapshot.SiteSettings.Pages.Projects.ShareAssetID, snapshot.SiteSettings.Pages.About.ShareAssetID} {
		if id != nil {
			if _, ok := media[*id]; !ok {
				return snapshot, errors.New("missing document media")
			}
		}
	}
	return snapshot, nil
}

var tags = regexp.MustCompile(`(?is)<(meta|link|script|img|source|a)\b([^>]*)>`)
var attributes = regexp.MustCompile(`([A-Za-z_:][-A-Za-z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)')`)
var titlePattern = regexp.MustCompile(`(?is)<title>(.*?)</title>`)
var forbiddenElement = regexp.MustCompile(`(?is)<\s*(?:iframe|object|embed|base)\b`)
var cssURL = regexp.MustCompile(`(?i)url\(\s*["']?([^\s)'";]+)`)
var chunkReference = regexp.MustCompile(`(?:["'])(\.{1,2}/[A-Za-z0-9_./-]+\.(?:js|mjs|css|woff2?|png|svg|webp|avif))(?:["'])`)

func attrs(text string) map[string]string {
	out := map[string]string{}
	for _, match := range attributes.FindAllStringSubmatch(text, -1) {
		value := match[2]
		if value == "" {
			value = match[3]
		}
		out[strings.ToLower(match[1])] = html.UnescapeString(value)
	}
	return out
}

func pagePath(root *os.Root, route string) (string, error) {
	for _, name := range []string{strings.Trim(route, "/") + "/index.html", strings.Trim(route, "/") + ".html"} {
		if route == "/" {
			name = "index.html"
		}
		info, err := root.Lstat(name)
		if err == nil && info.Mode().IsRegular() {
			return name, nil
		}
	}
	return "", errors.New("missing required page")
}

// ValidateOutput independently checks the actual generated bytes. It performs
// local HTTP handler requests without opening a network listener or fetching an
// external URL. The API later verifies the real isolated gateway separately.
func ValidateOutput(directory string, job publishmodel.Assignment, snapshot publishmodel.Snapshot) error {
	r, err := safeOutputRoot(directory)
	if err != nil {
		return err
	}
	defer r.Close()
	prefix := "/_releases/" + job.ReleaseID + "/"
	base := "/"
	if job.Kind == "preview" {
		base = "/api/admin/v1/previews/" + job.ReleaseID + "/"
		prefix = base
	}
	files := map[string]bool{}
	var total int64
	err = fs.WalkDir(r.FS(), ".", func(name string, e fs.DirEntry, err error) error {
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
			return nil
		}
		info, err := e.Info()
		if err != nil {
			return err
		}
		if !info.Mode().IsRegular() {
			return publishfs.ErrUnsafe
		}
		if !allowedArtifact(name, job, snapshot) {
			return errors.New("unexpected build artifact")
		}
		total += info.Size()
		if total > publishfs.MaxArtifactBytes || len(files) > 50000 {
			return publishfs.ErrUnsafe
		}
		if strings.Contains(name, "_payload.json") || strings.Contains(name, "builds/latest.json") || strings.HasPrefix(name, "_nuxt/") && job.Kind != "preview" || strings.HasSuffix(name, ".map") || strings.HasSuffix(name, ".sqlite") || strings.HasSuffix(name, ".db") {
			return errors.New("unversioned or private build artifact")
		}
		files[name] = true
		return nil
	})
	if err != nil {
		return err
	}
	allowed := allowedURLs(snapshot)
	for i, route := range []string{"/", "/projects/", "/about/"} {
		name, err := pagePath(r, route)
		if err != nil {
			return err
		}
		data, err := r.ReadFile(name)
		if err != nil {
			return err
		}
		if len(data) > 4<<20 {
			return errors.New("page too large")
		}
		body := string(data)
		if forbiddenElement.Match(data) {
			return errors.New("unexpected active HTML element")
		}
		page := []contentdata.PageSEO{snapshot.SiteSettings.Pages.Home, snapshot.SiteSettings.Pages.Projects, snapshot.SiteSettings.Pages.About}[i]
		title := page.Title
		if title == "" {
			title = snapshot.SiteSettings.SiteTitle
		}
		description := page.Description
		if description == "" {
			description = snapshot.SiteSettings.DefaultSEODescription
		}
		match := titlePattern.FindStringSubmatch(body)
		if len(match) != 2 || html.UnescapeString(match[1]) != title {
			return errors.New("generated title mismatch")
		}
		meta := map[string]string{}
		canonical := ""
		for _, tag := range tags.FindAllStringSubmatch(body, -1) {
			a := attrs(tag[2])
			kind := strings.ToLower(tag[1])
			if kind == "meta" {
				key := a["name"]
				if key == "" {
					key = a["property"]
				}
				meta[key] = a["content"]
			}
			if kind == "link" && a["rel"] == "canonical" {
				canonical = a["href"]
				continue
			}
			if href := a["href"]; href != "" {
				resource := kind == "link"
				if err = verifyURL(href, resource, prefix, base, files, allowed); err != nil {
					return err
				}
			}
			if src := a["src"]; src != "" {
				if err = verifyURL(src, true, prefix, base, files, allowed); err != nil {
					return err
				}
			}
			if srcset := a["srcset"]; srcset != "" {
				for _, part := range strings.Split(srcset, ",") {
					fields := strings.Fields(part)
					if len(fields) == 0 {
						return errors.New("invalid srcset")
					}
					if err = verifyURL(fields[0], true, prefix, base, files, allowed); err != nil {
						return err
					}
				}
			}
		}
		if canonical != contentdata.PublicOrigin+route || meta["description"] != description || meta["og:title"] != title || meta["og:description"] != description || meta["og:url"] != canonical || meta["xiaowork-release"] != job.ReleaseID || meta["xiaowork-snapshot"] != job.SnapshotSHA256 {
			return errors.New("generated SEO or version mismatch")
		}
		image := strings.TrimPrefix(meta["og:image"], contentdata.PublicOrigin)
		if image == meta["og:image"] || verifyURL(image, true, prefix, base, files, allowed) != nil {
			return errors.New("share image mismatch")
		}
		if job.Kind != "preview" && strings.Contains(meta["robots"], "noindex") {
			return errors.New("published page has noindex")
		}
		unescaped := html.UnescapeString(body)
		if !strings.Contains(unescaped, snapshot.SiteProfile.Name) {
			return errors.New("snapshot brand absent from HTML")
		}
		if route == "/projects/" {
			for _, p := range snapshot.VisibleProjects {
				if !strings.Contains(unescaped, p.Name) || !strings.Contains(unescaped, p.Summary) {
					return errors.New("snapshot project absent from HTML")
				}
			}
		}
	}
	for _, required := range []string{"404.html", "health.json", publishmodel.MarkerPath, "robots.txt", "sitemap.xml"} {
		if !files[required] {
			return errors.New("missing mandatory static artifact")
		}
	}
	assetPrefix := strings.TrimPrefix(prefix, "/") + "assets/"
	if job.Kind == "preview" {
		assetPrefix = "assets/"
	}
	for _, media := range snapshot.MediaManifest {
		data, err := r.ReadFile(assetPrefix + media.Path)
		if err != nil || int64(len(data)) != media.ByteSize || publishfs.Hash(data) != media.SHA256 {
			return errors.New("generated media hash mismatch")
		}
	}
	markerBytes, err := r.ReadFile(publishmodel.MarkerPath)
	if err != nil {
		return err
	}
	var marker publishmodel.Marker
	if strictJSON(markerBytes, &marker) != nil || marker.SchemaVersion != 1 || marker.ReleaseID != job.ReleaseID || marker.SnapshotID != job.SnapshotID || marker.SnapshotSHA256 != job.SnapshotSHA256 || marker.WorkspaceRevision != job.WorkspaceRevision {
		return errors.New("release marker mismatch")
	}
	robots, err := r.ReadFile("robots.txt")
	if err != nil {
		return err
	}
	sitemap, err := r.ReadFile("sitemap.xml")
	if err != nil {
		return err
	}
	if !strings.Contains(string(robots), "Sitemap: "+contentdata.PublicOrigin+"/sitemap.xml") {
		return errors.New("robots origin mismatch")
	}
	for _, route := range []string{"/", "/projects/", "/about/"} {
		if !strings.Contains(string(sitemap), "<loc>"+contentdata.PublicOrigin+route+"</loc>") {
			return errors.New("sitemap page mismatch")
		}
	}
	for name := range files {
		if !(strings.HasSuffix(name, ".js") || strings.HasSuffix(name, ".mjs") || strings.HasSuffix(name, ".css")) {
			continue
		}
		data, err := r.ReadFile(name)
		if err != nil {
			return err
		}
		for _, match := range chunkReference.FindAllStringSubmatch(string(data), -1) {
			target := path.Clean(path.Join(path.Dir(name), match[1]))
			if !publishfs.SafePath(target) || !files[target] {
				return errors.New("missing generated chunk dependency")
			}
		}
		if strings.HasSuffix(name, ".css") {
			for _, match := range cssURL.FindAllStringSubmatch(string(data), -1) {
				if strings.HasPrefix(match[1], "data:") || strings.HasPrefix(match[1], "#") {
					continue
				}
				target := match[1]
				if strings.HasPrefix(target, "/") {
					if verifyURL(target, true, prefix, base, files, allowed) != nil {
						return errors.New("invalid CSS resource")
					}
				} else if !files[path.Clean(path.Join(path.Dir(name), target))] {
					return errors.New("missing CSS resource")
				}
			}
		}
	}
	// Exercise the same read-only file-serving semantics for all mandatory
	// pages and marker; no external socket or redirect is involved.
	handler := http.FileServerFS(r.FS())
	for _, route := range []string{"/", "/projects/", "/about/", "/" + publishmodel.MarkerPath} {
		recorder := httptest.NewRecorder()
		request := httptest.NewRequest(http.MethodGet, route, nil)
		handler.ServeHTTP(recorder, request)
		if recorder.Code != 200 {
			return errors.New("candidate local HTTP failed")
		}
	}
	return nil
}

func verifyURL(value string, resource bool, prefix, base string, files, allowed map[string]bool) error {
	if strings.HasPrefix(value, "#") {
		return nil
	}
	u, err := url.Parse(value)
	if err != nil || u.User != nil || u.RawPath != "" {
		return errors.New("invalid generated URL")
	}
	if u.IsAbs() {
		if !resource && allowed[value] {
			return nil
		}
		return errors.New("unexpected external build resource")
	}
	if u.RawQuery != "" {
		return errors.New("unexpected local query")
	}
	if strings.HasPrefix(value, "//") || u.Host != "" {
		return errors.New("unexpected external build resource")
	}
	if !resource {
		for _, route := range []string{base, base + "projects", base + "projects/", base + "about", base + "about/"} {
			if u.Path == route {
				return nil
			}
		}
		return errors.New("unknown internal navigation")
	}
	if !strings.HasPrefix(u.Path, prefix) {
		return errors.New("unversioned generated resource")
	}
	name := strings.TrimPrefix(u.Path, "/")
	if base != "/" {
		name = strings.TrimPrefix(u.Path, base)
	}
	if !publishfs.SafePath(name) || !files[name] {
		return errors.New("generated resource missing")
	}
	return nil
}

func allowedURLs(s publishmodel.Snapshot) map[string]bool {
	out := map[string]bool{}
	add := func(v *string) {
		if v != nil {
			out[*v] = true
		}
	}
	add(s.SiteProfile.GitHubURL)
	for _, p := range s.VisibleProjects {
		add(p.DemoURL)
		add(p.RepositoryURL)
	}
	for _, c := range s.AboutProfile.Contacts {
		out[c.URL] = true
	}
	if s.AboutProfile.Resume != nil {
		out[s.AboutProfile.Resume.URL] = true
	}
	for _, c := range s.SiteSettings.SocialLinks {
		out[c.URL] = true
	}
	return out
}

func allowedArtifact(name string, job publishmodel.Assignment, snapshot publishmodel.Snapshot) bool {
	switch name {
	case "index.html", "200.html", "404.html", "projects/index.html", "about/index.html", "projects.html", "about.html", "health.json", publishmodel.MarkerPath, "robots.txt", "sitemap.xml":
		return true
	}
	base := "_releases/" + job.ReleaseID + "/"
	if job.Kind == "preview" {
		base = ""
	}
	if !strings.HasPrefix(name, base) {
		return false
	}
	name = strings.TrimPrefix(name, base)
	if strings.HasPrefix(name, "_nuxt/") {
		for _, ext := range []string{".js", ".mjs", ".css", ".woff2", ".woff", ".ttf", ".otf", ".svg", ".png", ".jpg", ".jpeg", ".webp", ".avif"} {
			if strings.HasSuffix(name, ext) {
				return true
			}
		}
		return false
	}
	if !strings.HasPrefix(name, "assets/") {
		return false
	}
	asset := strings.TrimPrefix(name, "assets/")
	if asset == "theme-init.js" || asset == "health.json" || asset == "images/projects/placeholder.svg" {
		return true
	}
	for _, p := range publishmodel.BuiltinPaths {
		if asset == p {
			return true
		}
	}
	for _, m := range snapshot.MediaManifest {
		if asset == m.Path {
			return true
		}
	}
	return false
}
