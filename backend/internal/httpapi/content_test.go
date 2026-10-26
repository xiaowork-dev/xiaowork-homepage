package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/xiaowork-dev/xiaowork-homepage/backend/internal/contentdata"
)

func seededContentFixture(t *testing.T) (*authFixture, *http.Client, string) {
	t.Helper()
	f := newAuthFixture(t)
	seed, err := os.ReadFile("../../seed/v1.json")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := contentdata.Import(context.Background(), f.db, bytes.NewReader(seed)); err != nil {
		t.Fatal(err)
	}
	f.clock.Store(time.Now().UTC().Unix() + 10)
	client := f.client(t)
	csrf, _ := f.loginAs(t, client, "xiaowork", authTestPassword, 200)
	return f, client, csrf
}
func contentHTTP(t *testing.T, f *authFixture, client *http.Client, method, path string, body any, csrf, revision, key string, expected int) (map[string]any, *http.Response) {
	t.Helper()
	var reader io.Reader
	if body != nil {
		raw, err := json.Marshal(body)
		if err != nil {
			t.Fatal(err)
		}
		reader = bytes.NewReader(raw)
	}
	req, err := http.NewRequest(method, f.server.URL+apiPrefix+path, reader)
	if err != nil {
		t.Fatal(err)
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if method != "GET" && method != "HEAD" {
		req.Header.Set("Origin", f.server.URL)
	}
	if csrf != "" {
		req.Header.Set("X-CSRF-Token", csrf)
	}
	if revision != "" {
		req.Header.Set("If-Match", revision)
	}
	if key != "" {
		req.Header.Set("Idempotency-Key", key)
	}
	res, err := client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	raw, err := io.ReadAll(res.Body)
	if err != nil {
		t.Fatal(err)
	}
	if res.StatusCode != expected {
		t.Fatalf("%s %s expected=%d actual=%d body=%s", method, path, expected, res.StatusCode, raw)
	}
	if res.Header.Get("Cache-Control") != "no-store" || !strings.Contains(res.Header.Get("X-Robots-Tag"), "noindex") {
		t.Fatal("content lacks private headers")
	}
	result := map[string]any{}
	if len(raw) > 0 {
		if err := json.Unmarshal(raw, &result); err != nil {
			t.Fatal(err)
		}
	}
	t.Logf("HTTP %s %s expected=%d actual=%d", method, path, expected, res.StatusCode)
	return result, res
}
func contentObject(t *testing.T, value any) map[string]any {
	t.Helper()
	object, ok := value.(map[string]any)
	if !ok {
		t.Fatalf("missing object: %#v", value)
	}
	return object
}
func projectBody(t *testing.T, f *authFixture, id string) map[string]any {
	t.Helper()
	p, err := contentdata.ProjectByID(context.Background(), f.db, id)
	if err != nil {
		t.Fatal(err)
	}
	raw, _ := json.Marshal(p.ProjectInput)
	result := map[string]any{}
	json.Unmarshal(raw, &result)
	return result
}

func TestContentHTTPRevisionIdempotencyAndHistory(t *testing.T) {
	f, client, csrf := seededContentFixture(t)
	workspace, res := contentHTTP(t, f, client, "GET", "/workspace", nil, "", "", "", 200)
	if res.Header.Get("ETag") != `"ws-1"` {
		t.Fatal("missing workspace ETag")
	}
	data := authData(t, workspace)
	if len(data["projects"].([]any)) != 3 || data["initialized"] != true {
		t.Fatal("seed missing from workspace")
	}
	body := projectBody(t, f, "xiaowork-blog")
	body["name"] = "SQL '); DROP TABLE administrators; --"
	body["slug"] = "safe-sql-text"
	contentHTTP(t, f, client, "POST", "/projects", body, csrf, "", "project-key-00000001", 428)
	contentHTTP(t, f, client, "POST", "/projects", body, csrf, `"ws-1"`, "", 400)
	created, res := contentHTTP(t, f, client, "POST", "/projects", body, csrf, `"ws-1"`, "project-key-00000001", 201)
	createdData := authData(t, created)
	createdProject := contentObject(t, createdData["project"])
	id := createdProject["id"].(string)
	if createdData["revision"] != "ws-2" || res.Header.Get("Location") != apiPrefix+"/projects/"+id {
		t.Fatal("creation result missing revision/location")
	}
	replayed, _ := contentHTTP(t, f, client, "POST", "/projects", body, csrf, `"ws-1"`, "project-key-00000001", 201)
	if contentObject(t, authData(t, replayed)["project"])["id"] != id {
		t.Fatal("idempotent request created a new project")
	}
	body["name"] = "不同请求"
	contentHTTP(t, f, client, "POST", "/projects", body, csrf, `"ws-2"`, "project-key-00000001", 409)
	body = projectBody(t, f, id)
	body["summary"] = "已确认的新简介"
	contentHTTP(t, f, client, "PUT", "/projects/"+id, body, csrf, `"ws-1"`, "", 409)
	contentHTTP(t, f, client, "PUT", "/projects/"+id, body, csrf, `"ws-2"`, "", 200)
	var accounts, history int
	f.db.QueryRow("SELECT count(*) FROM administrators").Scan(&accounts)
	f.db.QueryRow("SELECT count(*) FROM workspace_changes").Scan(&history)
	if accounts != 1 || history != 3 {
		t.Fatalf("SQL binding/history failed: %d %d", accounts, history)
	}
	var change string
	f.db.QueryRow("SELECT change_json FROM workspace_changes WHERE revision=2").Scan(&change)
	if !strings.Contains(change, "DROP TABLE administrators") || strings.Contains(change, "password_hash") || strings.Contains(change, "csrf") {
		t.Fatal("history must retain validated content without authentication secrets")
	}
	contentHTTP(t, f, client, "GET", "/projects?unknown=1", nil, "", "", "", 400)
	contentHTTP(t, f, client, "GET", "/projects?limit=2&limit=3", nil, "", "", "", 400)
	page, _ := contentHTTP(t, f, client, "GET", "/projects?limit=2", nil, "", "", "", 200)
	cursor := authData(t, page)["nextCursor"].(string)
	next, _ := contentHTTP(t, f, client, "GET", "/projects?limit=2&cursor="+cursor, nil, "", "", "", 200)
	if len(authData(t, next)["projects"].([]any)) != 2 {
		t.Fatal("pagination lost projects")
	}
}

func TestContentHTTPAtomicConcurrentSavesAndValidation(t *testing.T) {
	f, client, csrf := seededContentFixture(t)
	body := projectBody(t, f, "xiaowork-blog")
	raw, _ := json.Marshal(body)
	statuses := make(chan int, 2)
	var wg sync.WaitGroup
	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			req, _ := http.NewRequest("PUT", f.server.URL+apiPrefix+"/projects/xiaowork-blog", bytes.NewReader(raw))
			req.Header.Set("Content-Type", "application/json")
			req.Header.Set("Origin", f.server.URL)
			req.Header.Set("X-CSRF-Token", csrf)
			req.Header.Set("If-Match", `"ws-1"`)
			res, err := client.Do(req)
			if err != nil {
				statuses <- 0
				return
			}
			io.Copy(io.Discard, res.Body)
			res.Body.Close()
			statuses <- res.StatusCode
		}()
	}
	wg.Wait()
	first, second := <-statuses, <-statuses
	if !((first == 200 && second == 409) || (first == 409 && second == 200)) {
		t.Fatalf("concurrent saves: %d %d", first, second)
	}
	t.Logf("Concurrent content saves expected=200+409 actual=%d+%d", first, second)
	for _, mutation := range []func(map[string]any){func(p map[string]any) { p["name"] = "<script>alert(1)</script>" }, func(p map[string]any) { p["demoUrl"] = "javascript:alert(1)" }, func(p map[string]any) { p["demoUrl"] = "https://127.0.0.1/" }, func(p map[string]any) { p["cover"] = map[string]any{"kind": "media", "id": "does-not-exist"} }} {
		bad := projectBody(t, f, "xiaowork-blog")
		mutation(bad)
		contentHTTP(t, f, client, "PUT", "/projects/xiaowork-blog", bad, csrf, `"ws-2"`, "", 422)
	}
	bad := projectBody(t, f, "xiaowork-blog")
	bad["unknownField"] = true
	contentHTTP(t, f, client, "PUT", "/projects/xiaowork-blog", bad, csrf, `"ws-2"`, "", 400)
	bad = projectBody(t, f, "xiaowork-blog")
	bad["Name"] = "alternate"
	contentHTTP(t, f, client, "PUT", "/projects/xiaowork-blog", bad, csrf, `"ws-2"`, "", 400)
	contentHTTP(t, f, client, "PUT", "/projects/xiaowork-blog", body, "", `"ws-2"`, "", 403)
	contentHTTP(t, f, client, "PUT", "/projects/order", map[string]any{"ids": []string{"xiaowork-blog", "xiaowork-blog", "xiaowork-erp"}}, csrf, `"ws-2"`, "", 422)
	contentHTTP(t, f, client, "PUT", "/projects/order", map[string]any{"ids": []string{"xiaowork-erp", "xiaowork-nav", "xiaowork-blog"}}, csrf, `"ws-2"`, "", 200)
}

func TestContentHTTPCategoriesLifecycleProfileAndSettings(t *testing.T) {
	f, client, csrf := seededContentFixture(t)
	revision := int64(1)
	mutate := func(method, path string, body any, expected int) map[string]any {
		envelope, _ := contentHTTP(t, f, client, method, path, body, csrf, strconv.Quote(contentdata.Revision(revision)), "", expected)
		if expected >= 200 && expected < 300 {
			revision++
		}
		return envelope
	}
	created := mutate("POST", "/categories", map[string]string{"slug": "custom", "name": "自定义分类"}, 201)
	category := contentObject(t, authData(t, created)["category"])
	id := category["id"].(string)
	mutate("PUT", "/categories/"+id, map[string]string{"name": "更新分类"}, 200)
	mutate("PUT", "/categories/"+id, map[string]string{"name": "更新分类", "slug": "changed"}, 400)
	mutate("DELETE", "/categories/cat-website", nil, 409)
	mutate("DELETE", "/categories/"+id, nil, 200)
	mutate("POST", "/projects/xiaowork-blog/archive", map[string]any{}, 200)
	archived, _ := contentHTTP(t, f, client, "GET", "/projects?archived=true", nil, "", "", "", 200)
	if len(authData(t, archived)["projects"].([]any)) != 1 {
		t.Fatal("archive filter broken")
	}
	restored := mutate("POST", "/projects/xiaowork-blog/restore", map[string]any{}, 200)
	if contentObject(t, authData(t, restored)["project"])["visible"] != false {
		t.Fatal("restored project became public implicitly")
	}
	profile, _, _ := contentdata.ProfileView(context.Background(), f.db)
	profile.Site.Introduction = []string{"来自个人资料的新简介"}
	mutate("PUT", "/profile", profile, 200)
	settingsEnvelope, _ := contentHTTP(t, f, client, "GET", "/settings", nil, "", "", "", 200)
	settingsMap := contentObject(t, authData(t, settingsEnvelope)["settings"])
	if settingsMap["homeIntroduction"].([]any)[0] != "来自个人资料的新简介" {
		t.Fatal("settings is stale introduction copy")
	}
	settings, _, _ := contentdata.SettingsView(context.Background(), f.db)
	settings.HomeIntroduction = []string{"来自设置的新简介"}
	settings.FooterText = "已确认页脚"
	mutate("PUT", "/settings", settings, 200)
	profileEnvelope, _ := contentHTTP(t, f, client, "GET", "/profile", nil, "", "", "", 200)
	profileMap := contentObject(t, authData(t, profileEnvelope)["profile"])
	site := contentObject(t, profileMap["site"])
	if site["introduction"].([]any)[0] != "来自设置的新简介" || site["name"] != "XiaoWork" {
		t.Fatal("profile/settings field ownership broken")
	}
	settingsMap["origin"] = "https://attacker.invalid"
	mutate("PUT", "/settings", settingsMap, 400)
	dashboard, _ := contentHTTP(t, f, client, "GET", "/dashboard", nil, "", "", "", 200)
	stats := authData(t, dashboard)
	if stats["activeVerified"] != false || contentObject(t, stats["counts"])["publishedProjects"] != nil {
		t.Fatal("dashboard invented an active filesystem release")
	}
	var count int
	f.db.QueryRow("SELECT count(*) FROM workspace_changes").Scan(&count)
	if int64(count) != revision {
		t.Fatalf("history differs from revision %d %d", count, revision)
	}
}
