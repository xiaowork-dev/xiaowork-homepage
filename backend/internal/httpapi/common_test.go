package httpapi

import (
	"strings"
	"testing"
)

func TestHTTPMethodContractAndOversizeMutationRollback(t *testing.T) {
	f, client, csrf := seededContentFixture(t)
	_, res := contentHTTP(t, f, client, "PATCH", "/projects", map[string]any{}, csrf, `"ws-1"`, "", 405)
	if !strings.Contains(res.Header.Get("Allow"), "POST") {
		t.Fatal("missing method contract")
	}
	body := projectBody(t, f, "xiaowork-blog")
	body["slug"] = "large-escaped-project"
	body["description"] = strings.Repeat("<", 20000)
	contentHTTP(t, f, client, "POST", "/projects", body, csrf, `"ws-1"`, "large-project-key-001", 422)
	workspace, _ := contentHTTP(t, f, client, "GET", "/workspace", nil, "", "", "", 200)
	if authData(t, workspace)["revision"] != "ws-1" {
		t.Fatal("rejected mutation changed workspace")
	}
	var count int
	if err := f.db.QueryRow("SELECT count(*) FROM project_drafts").Scan(&count); err != nil || count != 3 {
		t.Fatal("rejected mutation left partial project", err)
	}
}

func TestHTTPIdempotencyExpiresAfterRetention(t *testing.T) {
	f, client, csrf := seededContentFixture(t)
	body := projectBody(t, f, "xiaowork-blog")
	body["slug"] = "retention-one"
	contentHTTP(t, f, client, "POST", "/projects", body, csrf, `"ws-1"`, "retention-test-key-01", 201)
	_, res := contentHTTP(t, f, client, "POST", "/projects", body, csrf, `"ws-1"`, "retention-test-key-01", 201)
	if !strings.HasPrefix(res.Header.Get("Location"), apiPrefix+"/projects/prj_") {
		t.Fatal("replay lost Location")
	}
	f.clock.Add(86401)
	csrf, _ = f.loginAs(t, client, "xiaowork", authTestPassword, 200)
	body["slug"] = "retention-two"
	contentHTTP(t, f, client, "POST", "/projects", body, csrf, `"ws-2"`, "retention-test-key-01", 201)
}
