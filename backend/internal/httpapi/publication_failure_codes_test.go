package httpapi

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/xiaowork-dev/xiaowork-homepage/backend/internal/publishmodel"
)

func TestWorkerFailurePreservesOnlyKnownDiagnosticCodes(t *testing.T) {
	for _, code := range []string{
		"INVALID_ASSIGNMENT", "BUILD_FAILED", "MARKER_WRITE_FAILED",
		"ARTIFACT_VALIDATION_FAILED", "LEASE_LOST", "ARTIFACT_PREPARE_FAILED",
		"PREVIEW_RECEIPT_FAILED", "ROLLBACK_TARGET_INVALID",
		"ACTIVATION_NOT_COMPLETED", "INTERRUPTED_PREVIEW", "INTERRUPTED_BEFORE_ACTIVATION",
	} {
		actual, summary := safeWorkerFailure(code)
		if actual != code || !strings.HasSuffix(summary, "公开版本未改变。") {
			t.Fatalf("known code %q mapped to %q / %q", code, actual, summary)
		}
	}
	for _, code := range []string{"", "UNTRUSTED_CODE_secret", "invalid_assignment", "GATEWAY_VERIFICATION_FAILED"} {
		actual, summary := safeWorkerFailure(code)
		if actual != "BUILD_FAILED" || summary != "构建或验证失败，公开版本未改变。" {
			t.Fatalf("unknown code %q was not sanitized: %q / %q", code, actual, summary)
		}
	}
}

func TestWorkerResultHTTPSFailureDiagnosticSanitization(t *testing.T) {
	for _, test := range []struct {
		name, inputCode, expectedCode, expectedSummary string
	}{
		{"known", "INVALID_ASSIGNMENT", "INVALID_ASSIGNMENT", "发布任务契约校验失败，公开版本未改变。"},
		{"unknown", "UNTRUSTED_CODE_secret", "BUILD_FAILED", "构建或验证失败，公开版本未改变。"},
	} {
		t.Run(test.name, func(t *testing.T) {
			f, client, csrf := publicationFixture(t)
			id := queuePublication(t, f, client, csrf, "preview", "failure-diagnostic-"+test.name+"-1")
			job := claimJob(t, f)
			const unsafeSummary = "PRIVATE_BUILDER_VALUE /builder/private.key <script>alert(1)</script>"
			result := workerCall(t, f, "/jobs/"+id+"/result", publishmodel.ResultRequest{
				LeaseToken: job.LeaseToken, Outcome: "failed", ErrorCode: test.inputCode, ErrorSummary: unsafeSummary,
			}, 200)
			if result["status"] != "failed" || result["action"] != "none" {
				t.Fatal(result)
			}
			var code, summary string
			if err := f.db.QueryRow(`SELECT error_code,error_summary FROM publish_jobs WHERE id=?`, id).Scan(&code, &summary); err != nil {
				t.Fatal(err)
			}
			if code != test.expectedCode || summary != test.expectedSummary {
				t.Fatalf("stored diagnostics = %q / %q", code, summary)
			}
			envelope, _ := f.request(t, client, "GET", "/jobs/"+id, nil, "", 200)
			raw, err := json.Marshal(envelope)
			if err != nil {
				t.Fatal(err)
			}
			if strings.Contains(string(raw), "PRIVATE_BUILDER_VALUE") || strings.Contains(string(raw), "private.key") || strings.Contains(string(raw), "UNTRUSTED_CODE_secret") {
				t.Fatalf("untrusted worker diagnostic leaked: %s", raw)
			}
			t.Logf("trusted HTTPS GET /jobs/{id}: expected failed/%s, actual failed/%s; worker text absent", test.expectedCode, code)
		})
	}
}
