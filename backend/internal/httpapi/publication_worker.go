package httpapi

import (
	"context"
	"crypto/subtle"
	"database/sql"
	"encoding/json"
	"errors"
	"net"
	"net/http"
	"strings"
	"time"

	"github.com/xiaowork-dev/xiaowork-homepage/backend/internal/publishdata"
	"github.com/xiaowork-dev/xiaowork-homepage/backend/internal/publishfs"
	"github.com/xiaowork-dev/xiaowork-homepage/backend/internal/publishmodel"
)

const workerLeaseSeconds = 120

// WorkerListener is a separate, same-UID Unix socket. The public HTTP handler
// never routes this protocol, even when a caller supplies internal paths.
func (a *App) WorkerListener() (net.Listener, error) {
	if !a.config.LocalPublish {
		return nil, errors.New("offline worker is disabled")
	}
	return listenPrivateWorker(a.config.WorkerSocket)
}
func (a *App) WorkerHandler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("POST "+publishmodel.InternalPrefix+"/claim", a.workerClaim)
	mux.HandleFunc("POST "+publishmodel.InternalPrefix+"/jobs/{id}/heartbeat", a.workerHeartbeat)
	mux.HandleFunc("POST "+publishmodel.InternalPrefix+"/jobs/{id}/prepared", a.workerPrepared)
	mux.HandleFunc("POST "+publishmodel.InternalPrefix+"/jobs/{id}/result", a.workerResult)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		if !a.config.LocalPublish {
			writeError(w, r, problem(503, "WORKER_UNAVAILABLE", "发布服务关闭。"))
			return
		}
		if r.URL.RawQuery != "" || r.Header.Get("Cookie") != "" || r.Header.Get("Origin") != "" {
			writeError(w, r, problem(400, "INVALID_REQUEST", "私有协议请求不合法。"))
			return
		}
		mux.ServeHTTP(w, r)
	})
}
func (a *App) workerClaim(w http.ResponseWriter, r *http.Request) {
	var body publishmodel.ClaimRequest
	if e := decodeJSON(r, &body, 4096); e != nil {
		writeError(w, r, e)
		return
	}
	if body.ProtocolVersion != publishmodel.ProtocolVersion || body.WorkerID != publishmodel.WorkerID {
		writeError(w, r, problem(422, "INVALID_WORKER", "发布器协议不匹配。"))
		return
	}
	now := a.now().Unix()
	a.workerSeen.Store(now)
	tx, e := a.db.BeginTx(r.Context(), nil)
	if e != nil {
		writeError(w, r, e)
		return
	}
	defer tx.Rollback()
	j, e := publicationJobScan(tx.QueryRowContext(r.Context(), publicationJobSelect+` WHERE j.status IN ('queued','running','reconciling') LIMIT 1`))
	if errors.Is(e, sql.ErrNoRows) {
		writeData(w, r, 200, publishmodel.ClaimResponse{})
		return
	}
	if e != nil {
		writeError(w, r, e)
		return
	}
	if j.Status != "queued" && j.LeaseExpiry > now {
		writeData(w, r, 200, publishmodel.ClaimResponse{})
		return
	}
	token, e := authToken()
	if e != nil {
		writeError(w, r, e)
		return
	}
	recovery := j.Status != "queued"
	status, phase := "running", "building"
	if recovery {
		status = "reconciling"
		phase = "recovery_required"
	}
	_, e = tx.ExecContext(r.Context(), `UPDATE publish_jobs SET status=?,phase=?,worker_id=?,lease_token_hash=?,lease_expires_at=?,attempts=attempts+1,started_at=coalesce(started_at,?) WHERE id=?`, status, phase, publishmodel.WorkerID, hashAuth(token), now+workerLeaseSeconds, now, j.ID)
	if e != nil {
		writeError(w, r, e)
		return
	}
	_, raw, hash, e := publishdata.Load(r.Context(), tx, j.SnapshotID)
	if e != nil {
		writeError(w, r, e)
		return
	}
	assets, e := publishdata.Assets(r.Context(), tx, j.SnapshotID)
	if e != nil {
		writeError(w, r, e)
		return
	}
	assignment := publishmodel.Assignment{ID: j.ID, Kind: j.Kind, SnapshotID: j.SnapshotID, SnapshotSHA256: hash, Snapshot: raw, WorkspaceRevision: j.WorkspaceRevision, ReleaseID: j.ReleaseID, ExpectedPreviousReleaseID: j.PreviousReleaseID, LeaseToken: token, LeaseExpiresAt: publicationTime(now + workerLeaseSeconds), SourceRevision: j.SourceRevision, BuilderID: j.BuilderID, Assets: assets, RecoveryRequired: recovery}
	if j.TargetReleaseID != nil {
		assignment.TargetReleaseID = *j.TargetReleaseID
	}
	if e = publicationAudit(r.Context(), tx, nil, j.ID, "publication.worker.claim", "success", now); e == nil {
		e = tx.Commit()
	}
	if e != nil {
		writeError(w, r, e)
		return
	}
	// Snapshot is already canonical, sealed JSON. The public API encoder's
	// HTML escaping would rewrite RawMessage bytes (for example '&') without
	// changing their JSON meaning, invalidating the immutable snapshot hash.
	// Preserve those bytes only on the private same-UID worker transport.
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(http.StatusOK)
	encoder := json.NewEncoder(w)
	encoder.SetEscapeHTML(false)
	_ = encoder.Encode(map[string]any{"data": publishmodel.ClaimResponse{Job: &assignment}, "requestId": requestID(r)})
}
func (a *App) workerLeased(ctx context.Context, q interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}, id, token string) (publicationJob, error) {
	if !publishmodel.ValidID(id, "job") || !validAuthToken(token) {
		return publicationJob{}, problem(409, "LEASE_REJECTED", "任务租约无效。")
	}
	j, e := publicationJobScan(q.QueryRowContext(ctx, publicationJobSelect+` WHERE j.id=?`, id))
	if e != nil {
		return j, problem(409, "LEASE_REJECTED", "任务租约无效。")
	}
	if (j.Status != "running" && j.Status != "reconciling") || j.LeaseExpiry <= a.now().Unix() || subtle.ConstantTimeCompare([]byte(j.LeaseHash), []byte(hashAuth(token))) != 1 {
		return j, problem(409, "LEASE_REJECTED", "任务租约无效或已过期。")
	}
	return j, nil
}
func (a *App) workerHeartbeat(w http.ResponseWriter, r *http.Request) {
	var body publishmodel.HeartbeatRequest
	if e := decodeJSON(r, &body, 4096); e != nil {
		writeError(w, r, e)
		return
	}
	tx, e := a.db.BeginTx(r.Context(), nil)
	if e != nil {
		writeError(w, r, e)
		return
	}
	defer tx.Rollback()
	j, e := a.workerLeased(r.Context(), tx, r.PathValue("id"), body.LeaseToken)
	if e != nil {
		writeError(w, r, e)
		return
	}
	allowed := map[string]int{"building": 1, "validating": 2, "prepared": 3, "activating": 4, "recovery_required": 5}
	old := ""
	if j.Phase != nil {
		old = *j.Phase
	}
	if allowed[body.Phase] == 0 || allowed[body.Phase] < allowed[old] || body.Phase == "prepared" && old != "prepared" || body.Phase == "activating" && old != "prepared" && old != "activating" {
		writeError(w, r, problem(409, "PHASE_REJECTED", "任务阶段不能回退或跳过准备。"))
		return
	}
	status := j.Status
	if body.Phase == "recovery_required" || body.Phase == "activating" {
		status = "reconciling"
	}
	expiry := a.now().Unix() + workerLeaseSeconds
	_, e = tx.ExecContext(r.Context(), `UPDATE publish_jobs SET status=?,phase=?,lease_expires_at=? WHERE id=?`, status, body.Phase, expiry, j.ID)
	if e == nil {
		e = tx.Commit()
	}
	if e != nil {
		writeError(w, r, e)
		return
	}
	a.workerSeen.Store(a.now().Unix())
	writeData(w, r, 200, map[string]string{"leaseExpiresAt": publicationTime(expiry)})
}
func (a *App) workerPrepared(w http.ResponseWriter, r *http.Request) {
	var body publishmodel.PreparedRequest
	if e := decodeJSON(r, &body, 4096); e != nil {
		writeError(w, r, e)
		return
	}
	if !publishmodel.HexHash.MatchString(body.ManifestSHA256) {
		writeError(w, r, problem(422, "ARTIFACT_REJECTED", "产物摘要不合法。"))
		return
	}
	j, e := a.workerLeased(r.Context(), a.db, r.PathValue("id"), body.LeaseToken)
	if e != nil {
		writeError(w, r, e)
		return
	}
	if j.Phase == nil || (*j.Phase != "validating" && *j.Phase != "prepared") {
		writeError(w, r, problem(409, "PHASE_REJECTED", "产物还未进入验证阶段。"))
		return
	}
	_, hash, e := a.verifyManifest(j)
	if e != nil || hash != body.ManifestSHA256 || a.verifySnapshotMedia(r.Context(), j.SnapshotID) != nil {
		writeError(w, r, problem(422, "ARTIFACT_REJECTED", "API 独立校验产物失败。"))
		return
	}
	current, e := a.currentRelease()
	if e != nil || current != j.PreviousReleaseID {
		writeError(w, r, problem(409, "RECOVERY_REQUIRED", "公开指针与任务期望不符。"))
		return
	}
	tx, e := a.db.BeginTx(r.Context(), nil)
	if e != nil {
		writeError(w, r, e)
		return
	}
	defer tx.Rollback()
	j, e = a.workerLeased(r.Context(), tx, j.ID, body.LeaseToken)
	if e != nil {
		writeError(w, r, e)
		return
	}
	if j.ManifestHash != "" && j.ManifestHash != hash {
		writeError(w, r, problem(409, "ARTIFACT_REJECTED", "已准备的产物不能改变。"))
		return
	}
	now := a.now().Unix()
	if j.ManifestHash == "" && j.Kind != "rollback" {
		kind := "publication"
		var expiry any
		if j.Kind == "preview" {
			kind = "preview"
			expiry = now + 86400
		}
		_, e = tx.ExecContext(r.Context(), `INSERT INTO releases(id,publish_job_id,snapshot_id,kind,directory_key,template_revision,manifest_sha256,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?,?)`, j.ReleaseID, j.ID, j.SnapshotID, kind, j.ReleaseID, j.SourceRevision, hash, now, expiry)
		if e != nil {
			writeError(w, r, e)
			return
		}
	}
	var activation any
	token := ""
	if j.Kind != "preview" {
		token = a.publicationProofToken(j.ID)
		activation = hashAuth(token)
	}
	_, e = tx.ExecContext(r.Context(), `UPDATE publication_job_details SET manifest_sha256=? WHERE job_id=?`, hash, j.ID)
	if e == nil {
		_, e = tx.ExecContext(r.Context(), `UPDATE publish_jobs SET phase='prepared',activation_token_hash=?,lease_expires_at=? WHERE id=?`, activation, now+workerLeaseSeconds, j.ID)
	}
	if e == nil {
		e = tx.Commit()
	}
	if e != nil {
		writeError(w, r, e)
		return
	}
	a.workerSeen.Store(now)
	writeData(w, r, 200, publishmodel.PreparedResponse{ActivationToken: token, ExpectedPreviousReleaseID: j.PreviousReleaseID})
}
func (a *App) verifyReceipt(j publicationJob, receipt publishmodel.Receipt, mhash string) error {
	if receipt.SchemaVersion != 1 || receipt.JobID != j.ID || receipt.ReleaseID != j.ReleaseID || receipt.SnapshotID != j.SnapshotID || receipt.SnapshotSHA256 != j.SnapshotHash || receipt.ManifestSHA256 != mhash {
		return errors.New("receipt assignment mismatch")
	}
	if j.Kind == "preview" {
		if receipt.Outcome != "preview-ready" || receipt.ActivationToken != "" || receipt.PreviousReleaseID != "" {
			return errors.New("preview receipt invalid")
		}
	} else if receipt.Outcome != "activated" || receipt.PreviousReleaseID != j.PreviousReleaseID || receipt.ActivationToken != a.publicationProofToken(j.ID) || hashAuth(receipt.ActivationToken) != j.ActivationHash {
		return errors.New("activation receipt invalid")
	}
	if _, e := time.Parse(time.RFC3339, receipt.ActivatedAt); e != nil {
		return e
	}
	return nil
}
func (a *App) reconcilePublication(ctx context.Context, j publicationJob) (string, error) {
	if j.ManifestHash == "" {
		return "", errors.New("artifact never prepared")
	}
	m, hash, e := a.verifyManifest(j)
	if e != nil || hash != j.ManifestHash {
		return "", errors.New("artifact integrity differs")
	}
	if e = a.verifySnapshotMedia(ctx, j.SnapshotID); e != nil {
		return "", e
	}
	s, e := publishfs.OpenReadOnly(a.config.PublicationsDir)
	if e != nil {
		return "", e
	}
	defer s.Close()
	receipt, proof, e := s.ReadReceipt(j.ID)
	if e != nil {
		return "", e
	}
	if e = a.verifyReceipt(j, receipt, hash); e != nil {
		return "", e
	}
	current, e := s.Current()
	if e != nil {
		return "", e
	}
	if j.Kind == "preview" {
		if current != j.PreviousReleaseID {
			return "", errors.New("preview changed active site")
		}
		return proof, nil
	}
	intent, e := s.ReadIntent(j.ID)
	if e != nil || intent.Phase != "prepared" || intent.JobID != receipt.JobID || intent.ReleaseID != receipt.ReleaseID || intent.PreviousReleaseID != receipt.PreviousReleaseID || intent.ActivationToken != receipt.ActivationToken || intent.ManifestSHA256 != receipt.ManifestSHA256 || intent.SnapshotID != receipt.SnapshotID || intent.SnapshotSHA256 != receipt.SnapshotSHA256 {
		return "", errors.New("activation intent mismatch")
	}
	if current != j.ReleaseID {
		return "", errors.New("activation pointer mismatch")
	}
	if e = a.verifyHTTP(ctx, m); e != nil {
		return "", e
	}
	current, e = s.Current()
	if e != nil || current != j.ReleaseID {
		return "", errors.New("pointer changed while reconciling")
	}
	return proof, nil
}
func (a *App) workerResult(w http.ResponseWriter, r *http.Request) {
	var body publishmodel.ResultRequest
	if e := decodeJSON(r, &body, 8192); e != nil {
		writeError(w, r, e)
		return
	}
	if body.Outcome != "activated" && body.Outcome != "preview-ready" && body.Outcome != "failed" && body.Outcome != "restored" {
		writeError(w, r, problem(422, "INVALID_RESULT", "发布结果不合法。"))
		return
	}
	if len(body.ErrorCode) > 80 || len(body.ErrorSummary) > 2000 || strings.ContainsAny(body.ErrorSummary, "\r\x00") {
		writeError(w, r, problem(422, "INVALID_RESULT", "发布错误信息不合法。"))
		return
	}
	j, e := a.workerLeased(r.Context(), a.db, r.PathValue("id"), body.LeaseToken)
	if e != nil {
		writeError(w, r, e)
		return
	}
	// Persist reconciling before inspecting worker claims. Only the subsequent
	// independent proof transaction can mark this task succeeded.
	_, e = a.db.ExecContext(r.Context(), `UPDATE publish_jobs SET status='reconciling',phase='activating' WHERE id=? AND status IN ('running','reconciling')`, j.ID)
	if e != nil {
		writeError(w, r, e)
		return
	}
	status, action, code, summary := "reconciling", "restore", "RECONCILIATION_FAILED", "API 独立核对失败，需要恢复并重新核验。"
	proof := ""
	if body.Outcome == "activated" || body.Outcome == "preview-ready" {
		if (j.Kind == "preview") == (body.Outcome == "preview-ready") {
			proof, e = a.reconcilePublication(r.Context(), j)
			if e == nil {
				status = "succeeded"
				action = "none"
			}
		}
	} else if body.Outcome == "restored" {
		e = a.verifyRestored(r.Context(), j)
		if e == nil {
			status = "failed"
			action = "none"
			code = "ACTIVATION_RESTORED"
			summary = "新版本未通过核验；已恢复上一公开版本。"
		}
	} else {
		current, err := a.currentRelease()
		if err == nil && current == j.PreviousReleaseID {
			status = "failed"
			action = "none"
			code, summary = safeWorkerFailure(body.ErrorCode)
		}
	}
	now := a.now().Unix()
	tx, e := a.db.BeginTx(r.Context(), nil)
	if e != nil {
		writeError(w, r, e)
		return
	}
	defer tx.Rollback()
	if _, e = a.workerLeased(r.Context(), tx, j.ID, body.LeaseToken); e != nil {
		writeError(w, r, e)
		return
	}
	switch status {
	case "succeeded":
		// These fields describe the current unresolved result, not its audit
		// history. Clear them atomically with verified success after recovery;
		// prior failure audit events remain immutable in the same transaction.
		_, e = tx.ExecContext(r.Context(), `UPDATE publish_jobs SET status='succeeded',phase=NULL,error_code=NULL,error_summary=NULL,completed_at=?,reconciled_release_id=?,reconciled_at=?,reconciliation_receipt_sha256=? WHERE id=? AND status='reconciling'`, now, j.ReleaseID, now, proof, j.ID)
	case "failed":
		_, e = tx.ExecContext(r.Context(), `UPDATE publish_jobs SET status='failed',phase=NULL,completed_at=?,error_code=?,error_summary=? WHERE id=? AND status='reconciling'`, now, code, summary, j.ID)
	default:
		_, e = tx.ExecContext(r.Context(), `UPDATE publish_jobs SET phase='recovery_required',error_code=?,error_summary=?,lease_expires_at=? WHERE id=?`, code, summary, now+workerLeaseSeconds, j.ID)
	}
	outcome := "failure"
	if status == "succeeded" {
		outcome = "success"
	}
	if e == nil {
		e = publicationAudit(r.Context(), tx, nil, j.ID, "publication.worker."+status, outcome, now)
	}
	if e == nil {
		e = tx.Commit()
	}
	if e != nil {
		writeError(w, r, e)
		return
	}
	a.workerSeen.Store(now)
	writeData(w, r, 200, publishmodel.ResultResponse{Status: status, Action: action, ExpectedPreviousReleaseID: j.PreviousReleaseID})
}

// Preserve only fixed protocol diagnostics. Worker output and underlying build
// errors must never become administrator-visible text or persisted secrets.
func safeWorkerFailure(code string) (string, string) {
	switch code {
	case "INVALID_ASSIGNMENT":
		return code, "发布任务契约校验失败，公开版本未改变。"
	case "MARKER_WRITE_FAILED":
		return code, "版本标记写入失败，公开版本未改变。"
	case "ARTIFACT_VALIDATION_FAILED":
		return code, "静态产物校验失败，公开版本未改变。"
	case "LEASE_LOST":
		return code, "发布任务租约失效，公开版本未改变。"
	case "ARTIFACT_PREPARE_FAILED":
		return code, "静态产物准备失败，公开版本未改变。"
	case "PREVIEW_RECEIPT_FAILED":
		return code, "预览核验凭据写入失败，公开版本未改变。"
	case "ROLLBACK_TARGET_INVALID":
		return code, "恢复目标版本校验失败，公开版本未改变。"
	case "ACTIVATION_NOT_COMPLETED":
		return code, "版本切换未完成，公开版本未改变。"
	case "INTERRUPTED_PREVIEW":
		return code, "预览任务被中断，公开版本未改变。"
	case "INTERRUPTED_BEFORE_ACTIVATION":
		return code, "发布任务在切换前中断，公开版本未改变。"
	default:
		return "BUILD_FAILED", "构建或验证失败，公开版本未改变。"
	}
}

func (a *App) verifyRestored(ctx context.Context, j publicationJob) error {
	s, e := publishfs.OpenReadOnly(a.config.PublicationsDir)
	if e != nil {
		return e
	}
	defer s.Close()
	current, e := s.Current()
	if e != nil || current != j.PreviousReleaseID {
		return errors.New("previous pointer not restored")
	}
	intent, e := s.ReadIntent(j.ID)
	if e != nil || intent.Phase != "prepared" || intent.ReleaseID != j.ReleaseID || intent.PreviousReleaseID != j.PreviousReleaseID || intent.ActivationToken != a.publicationProofToken(j.ID) || hashAuth(intent.ActivationToken) != j.ActivationHash || intent.SnapshotID != j.SnapshotID || intent.SnapshotSHA256 != j.SnapshotHash || intent.ManifestSHA256 != j.ManifestHash {
		return errors.New("recovery intent invalid")
	}
	receipt, _, e := s.ReadRecoveryReceipt(j.ID)
	if e != nil || receipt.Outcome != "restored" || receipt.ReleaseID != j.PreviousReleaseID || receipt.PreviousReleaseID != j.ReleaseID || receipt.ActivationToken != intent.ActivationToken {
		return errors.New("recovery receipt invalid")
	}
	if _, e = time.Parse(time.RFC3339, receipt.ActivatedAt); e != nil {
		return errors.New("recovery timestamp invalid")
	}
	if current != "" {
		manifest, hash, err := s.ReadManifest(current)
		if err != nil || receipt.ManifestSHA256 != hash || receipt.SnapshotID != manifest.SnapshotID || receipt.SnapshotSHA256 != manifest.SnapshotSHA256 {
			return errors.New("recovery artifact proof mismatch")
		}
		return a.verifyActive(ctx, current)
	}
	if receipt.SnapshotID != "" || receipt.SnapshotSHA256 != "" || receipt.ManifestSHA256 != "" {
		return errors.New("first publication recovery must restore absent state")
	}
	return nil
}
