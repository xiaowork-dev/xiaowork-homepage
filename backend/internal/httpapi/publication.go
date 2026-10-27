package httpapi

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"path"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/xiaowork-dev/xiaowork-homepage/backend/internal/contentdata"
	"github.com/xiaowork-dev/xiaowork-homepage/backend/internal/publishdata"
	"github.com/xiaowork-dev/xiaowork-homepage/backend/internal/publishfs"
	"github.com/xiaowork-dev/xiaowork-homepage/backend/internal/publishmodel"
)

var builderPattern = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9._:@+-]{0,159}$`)

func validatePublicationConfig(c Config) error {
	if !c.LocalPublish {
		return nil
	}
	u, e := url.Parse(c.Origin)
	if e != nil || (u.Hostname() != "localhost" && u.Hostname() != "127.0.0.1" && u.Hostname() != "::1") {
		return errors.New("local publication gate cannot enable production publishing")
	}
	v, e := url.Parse(c.PublicationVerifyURL)
	if e != nil || v.Scheme != "http" || v.User != nil || v.RawQuery != "" || v.Fragment != "" || v.Path != "" || (v.Hostname() != "publication-static" && v.Hostname() != "127.0.0.1" && v.Hostname() != "localhost" && v.Hostname() != "::1") {
		return errors.New("fixed isolated publication verifier required")
	}
	if c.PublicationsDir == "" || c.WorkerSocket == "" || !publishmodel.SourceHash.MatchString(c.SourceRevision) || !builderPattern.MatchString(c.BuilderID) {
		return errors.New("incomplete isolated publication configuration")
	}
	return nil
}
func (a *App) workerAvailable() bool {
	seen := a.workerSeen.Load()
	now := a.now().Unix()
	return a.config.LocalPublish && seen > 0 && now >= seen && now-seen < 45
}
func (a *App) publishingUnavailable(w http.ResponseWriter, r *http.Request) {
	writeError(w, r, problem(503, "WORKER_UNAVAILABLE", "静态发布服务尚未启用或不可用；保存草稿不会发布网站。"))
}
func (a *App) registerPublishing(mux *http.ServeMux) {
	mux.HandleFunc("GET "+apiPrefix+"/publishing-status", a.publishingStatus)
	for _, kind := range []string{"publish", "preview", "rollback"} {
		kind := kind
		mux.HandleFunc("POST "+apiPrefix+"/"+kind+"-jobs", func(w http.ResponseWriter, r *http.Request) { a.createPublicationJob(w, r, kind) })
	}
	mux.HandleFunc("GET "+apiPrefix+"/jobs", a.listPublicationJobs)
	mux.HandleFunc("GET "+apiPrefix+"/jobs/{id}", a.getPublicationJob)
	mux.HandleFunc("GET "+apiPrefix+"/releases", a.listReleases)
	mux.HandleFunc("GET "+apiPrefix+"/releases/{id}", a.getRelease)
	mux.HandleFunc("GET "+apiPrefix+"/previews/{id}/{resource...}", a.servePreview)
}

type publicationJob struct {
	ID                string  `json:"id"`
	Kind              string  `json:"kind"`
	Status            string  `json:"status"`
	Phase             *string `json:"phase"`
	SnapshotID        string  `json:"snapshotId"`
	WorkspaceRevision string  `json:"workspaceRevision"`
	ReleaseID         string  `json:"releaseId"`
	TargetReleaseID   *string `json:"targetReleaseId"`
	CreatedAt         string  `json:"createdAt"`
	StartedAt         *string `json:"startedAt"`
	CompletedAt       *string `json:"completedAt"`
	Error             any     `json:"error"`
	ActiveVerified    bool    `json:"activeVerified"`
	PreviousReleaseID string  `json:"-"`
	SourceRevision    string  `json:"-"`
	BuilderID         string  `json:"-"`
	SnapshotHash      string  `json:"-"`
	ManifestHash      string  `json:"-"`
	LeaseHash         string  `json:"-"`
	LeaseExpiry       int64   `json:"-"`
	ActivationHash    string  `json:"-"`
}

const publicationJobSelect = `SELECT j.id,j.kind,j.status,j.phase,j.snapshot_id,s.source_revision,d.release_id,j.target_release_id,j.created_at,j.started_at,j.completed_at,j.error_code,j.error_summary,coalesce(d.previous_release_id,''),d.source_revision,d.builder_id,s.content_sha256,coalesce(d.manifest_sha256,''),coalesce(j.lease_token_hash,''),coalesce(j.lease_expires_at,0),coalesce(j.activation_token_hash,'') FROM publish_jobs j JOIN snapshots s ON s.id=j.snapshot_id JOIN publication_job_details d ON d.job_id=j.id`

type scanner interface{ Scan(...any) error }

func publicationJobScan(row scanner) (publicationJob, error) {
	var j publicationJob
	var phase, target, code, summary sql.NullString
	var started, completed sql.NullInt64
	var revision, created int64
	err := row.Scan(&j.ID, &j.Kind, &j.Status, &phase, &j.SnapshotID, &revision, &j.ReleaseID, &target, &created, &started, &completed, &code, &summary, &j.PreviousReleaseID, &j.SourceRevision, &j.BuilderID, &j.SnapshotHash, &j.ManifestHash, &j.LeaseHash, &j.LeaseExpiry, &j.ActivationHash)
	j.WorkspaceRevision = revisionLabel(revision)
	j.CreatedAt = publicationTime(created)
	if phase.Valid {
		j.Phase = &phase.String
	}
	if target.Valid {
		j.TargetReleaseID = &target.String
	}
	if started.Valid {
		s := publicationTime(started.Int64)
		j.StartedAt = &s
	}
	if completed.Valid {
		s := publicationTime(completed.Int64)
		j.CompletedAt = &s
	}
	if code.Valid {
		j.Error = map[string]string{"code": code.String, "message": summary.String}
	}
	return j, err
}
func publicationTime(value int64) string { return time.Unix(value, 0).UTC().Format(time.RFC3339) }
func publicationJobByID(ctx context.Context, q contentdata.Queryer, id string) (publicationJob, error) {
	return publicationJobScan(q.QueryRowContext(ctx, publicationJobSelect+` WHERE j.id=?`, id))
}
func publicationAudit(ctx context.Context, tx *sql.Tx, actor any, job, action, outcome string, now int64) error {
	_, e := tx.ExecContext(ctx, `INSERT INTO audit_events(actor_administrator_id,action,resource_type,resource_id,outcome,created_at) VALUES(?,?,'publish_job',?,?,?)`, actor, action, job, outcome, now)
	return e
}
func (a *App) currentRelease() (string, error) {
	s, e := publishfs.OpenReadOnly(a.config.PublicationsDir)
	if e != nil {
		return "", e
	}
	defer s.Close()
	return s.Current()
}
func (a *App) publicationProofToken(job string) string {
	m := hmac.New(sha256.New, a.config.Secret)
	m.Write([]byte("publication-activation-v1\x00" + job))
	return hex.EncodeToString(m.Sum(nil))
}

func (a *App) createPublicationJob(w http.ResponseWriter, r *http.Request, kind string) {
	if !a.config.LocalPublish || !a.workerAvailable() {
		a.publishingUnavailable(w, r)
		return
	}
	if err := queryOnly(r); err != nil {
		writeError(w, r, err)
		return
	}
	var body struct {
		SnapshotID              string  `json:"snapshotId,omitempty"`
		TargetReleaseID         string  `json:"targetReleaseId,omitempty"`
		ConfirmAllChanges       bool    `json:"confirmAllChanges,omitempty"`
		ReviewedActiveReleaseID *string `json:"reviewedActiveReleaseId"`
	}
	if e := decodeJSON(r, &body, 8<<10); e != nil {
		writeError(w, r, e)
		return
	}
	if (kind == "publish" || kind == "rollback") && !body.ConfirmAllChanges {
		writeError(w, r, problem(422, "CONFIRMATION_REQUIRED", "需要确认本次更新整个公开站点，且不会覆盖草稿。"))
		return
	}
	if kind != "preview" {
		var fields map[string]json.RawMessage
		state, _ := r.Context().Value(requestStateKey{}).(*requestState)
		if state == nil || json.Unmarshal(state.Payload, &fields) != nil {
			writeError(w, r, problem(400, "INVALID_REQUEST", "发布请求上下文无效。"))
			return
		}
		if _, present := fields["reviewedActiveReleaseId"]; !present || body.ReviewedActiveReleaseID != nil && !publishmodel.ValidID(*body.ReviewedActiveReleaseID, "rel") {
			writeError(w, r, problem(422, "ACTIVE_RELEASE_REQUIRED", "请明确提供确认摘要对应的当前公开版本；首次发布使用 null。"))
			return
		}
	}
	if kind != "rollback" && body.TargetReleaseID != "" || kind == "rollback" && (!publishmodel.ValidID(body.TargetReleaseID, "rel") || body.SnapshotID != "") || body.SnapshotID != "" && !publishmodel.ValidID(body.SnapshotID, "snap") {
		writeError(w, r, problem(422, "VALIDATION_FAILED", "发布请求不符合契约。"))
		return
	}
	expected, e := expectedRevision(r)
	if e != nil {
		writeError(w, r, e)
		return
	}
	key := r.Header.Get("Idempotency-Key")
	if len(r.Header.Values("Idempotency-Key")) != 1 || !idempotencyPattern.MatchString(key) {
		writeError(w, r, problem(400, "INVALID_REQUEST", "请提供合法 Idempotency-Key。"))
		return
	}
	fingerprint, _ := contentdata.CanonicalJSON(map[string]any{"body": body, "revision": expected})
	fingerprintHash := publishfs.Hash(fingerprint)
	tx, e := a.db.BeginTx(r.Context(), nil)
	if e != nil {
		writeError(w, r, e)
		return
	}
	defer tx.Rollback()
	now := a.now().Unix()
	p := principal(r)
	if e = requireActiveSessionTx(r.Context(), tx, p, now); e != nil {
		writeError(w, r, e)
		return
	}
	if kind != "preview" {
		var until sql.NullInt64
		if e = tx.QueryRowContext(r.Context(), `SELECT reauth_until FROM sessions WHERE token_hash=?`, p.SessionHash).Scan(&until); e != nil {
			writeError(w, r, e)
			return
		}
		if !until.Valid || until.Int64 <= now {
			writeError(w, r, problem(403, "REAUTH_REQUIRED", "请先重新验证当前密码，再发布或恢复。"))
			return
		}
	}
	var oldHash, oldResponse string
	e = tx.QueryRowContext(r.Context(), `SELECT request_sha256,response_json FROM idempotency_records WHERE administrator_id=? AND endpoint=? AND idempotency_key=?`, p.ID, r.URL.Path, key).Scan(&oldHash, &oldResponse)
	if e == nil {
		if oldHash != fingerprintHash {
			writeError(w, r, problem(409, "IDEMPOTENCY_CONFLICT", "同一幂等键不能用于不同发布请求。"))
			return
		}
		var data map[string]any
		if e = json.Unmarshal([]byte(oldResponse), &data); e != nil {
			writeError(w, r, e)
			return
		}
		writeData(w, r, 202, data)
		return
	}
	if !errors.Is(e, sql.ErrNoRows) {
		writeError(w, r, e)
		return
	}
	previous, e := a.currentRelease()
	if e != nil {
		writeError(w, r, problem(503, "RECOVERY_REQUIRED", "无法核实当前公开版本，禁止新任务。"))
		return
	}
	reviewed := ""
	if body.ReviewedActiveReleaseID != nil {
		reviewed = *body.ReviewedActiveReleaseID
	}
	if kind != "preview" && reviewed != previous {
		writeError(w, r, problem(409, "ACTIVE_RELEASE_CONFLICT", "当前公开版本已改变，请重新核对摘要并再次确认。"))
		return
	}
	current, e := contentdata.CurrentRevision(r.Context(), tx)
	if e != nil {
		writeError(w, r, e)
		return
	}
	if current != expected {
		writeError(w, r, &apiError{Status: 409, Code: "REVISION_CONFLICT", Message: "草稿已改变，请重新核对后提交。", CurrentRevision: revisionLabel(current)})
		return
	}
	var unfinished int
	if e = tx.QueryRowContext(r.Context(), `SELECT count(*) FROM publish_jobs WHERE status IN ('queued','running','reconciling')`).Scan(&unfinished); e != nil {
		writeError(w, r, e)
		return
	}
	if unfinished != 0 {
		writeError(w, r, problem(409, "JOB_CONFLICT", "已有未完成任务或需要恢复核对的任务。"))
		return
	}
	if previous != "" {
		var n int
		if e = tx.QueryRowContext(r.Context(), `SELECT count(*) FROM publish_jobs WHERE reconciled_release_id=? AND status='succeeded' AND kind IN ('publish','rollback')`, previous).Scan(&n); e != nil || n == 0 {
			writeError(w, r, problem(503, "RECOVERY_REQUIRED", "当前指针不属于已核验版本。"))
			return
		}
	}
	id := newID("job")
	snapshotID := body.SnapshotID
	releaseID := newID("rel")
	if kind == "preview" {
		releaseID = newID("pre")
	}
	if kind == "rollback" {
		releaseID = body.TargetReleaseID
		e = tx.QueryRowContext(r.Context(), `SELECT r.snapshot_id FROM releases r WHERE r.id=? AND r.kind='publication' AND EXISTS(SELECT 1 FROM publish_jobs j WHERE j.reconciled_release_id=r.id AND j.status='succeeded')`, releaseID).Scan(&snapshotID)
		if e != nil {
			writeError(w, r, problem(422, "INVALID_RELEASE", "只能恢复已成功且仍保留的公开版本。"))
			return
		}
	}
	if snapshotID == "" {
		snapshotID = newID("snap")
		if _, _, _, e = publishdata.Freeze(r.Context(), tx, snapshotID, current, now); e != nil {
			writeError(w, r, problem(422, "SNAPSHOT_INVALID", "公开投影未通过检查：资料或素材缺失、未确认或超出预算。"))
			return
		}
	} else {
		s, _, _, err := publishdata.Load(r.Context(), tx, snapshotID)
		if err != nil || kind != "rollback" && s.WorkspaceRevision != revisionLabel(current) {
			writeError(w, r, problem(409, "SNAPSHOT_CONFLICT", "快照不存在、损坏或不对应当前草稿版本。"))
			return
		}
	}
	var target any
	if kind == "rollback" {
		target = body.TargetReleaseID
	}
	_, e = tx.ExecContext(r.Context(), `INSERT INTO publish_jobs(id,idempotency_key,kind,snapshot_id,target_release_id,requested_by,status,created_at) VALUES(?,?,?,?,?,?,'queued',?)`, id, hashAuth(strconv.FormatInt(p.ID, 10)+r.URL.Path+key), kind, snapshotID, target, p.ID, now)
	var prev any
	if previous != "" {
		prev = previous
	}
	if e == nil {
		_, e = tx.ExecContext(r.Context(), `INSERT INTO publication_job_details(job_id,release_id,previous_release_id,source_revision,builder_id) VALUES(?,?,?,?,?)`, id, releaseID, prev, a.config.SourceRevision, a.config.BuilderID)
	}
	data := map[string]any{"jobId": id, "snapshotId": snapshotID, "status": "queued", "statusUrl": apiPrefix + "/jobs/" + id}
	encoded, _ := json.Marshal(data)
	if e == nil {
		_, e = tx.ExecContext(r.Context(), `INSERT INTO idempotency_records(administrator_id,endpoint,idempotency_key,request_sha256,resource_type,resource_id,response_status,response_json,created_at,expires_at) VALUES(?,?,?,?,'publish_job',?,202,?,?,?)`, p.ID, r.URL.Path, key, fingerprintHash, id, string(encoded), now, now+86400)
	}
	if e == nil {
		e = publicationAudit(r.Context(), tx, p.ID, id, "publication."+kind+".queued", "success", now)
	}
	if e == nil {
		e = tx.Commit()
	}
	if e != nil {
		writeError(w, r, e)
		return
	}
	w.Header().Set("Location", apiPrefix+"/jobs/"+id)
	writeData(w, r, 202, data)
}

func (a *App) listPublicationJobs(w http.ResponseWriter, r *http.Request) {
	if !a.config.LocalPublish {
		a.publishingUnavailable(w, r)
		return
	}
	if e := queryOnly(r); e != nil {
		writeError(w, r, e)
		return
	}
	rows, e := a.db.QueryContext(r.Context(), publicationJobSelect+` ORDER BY j.created_at DESC,j.id DESC LIMIT 100`)
	if e != nil {
		writeError(w, r, e)
		return
	}
	defer rows.Close()
	items := []publicationJob{}
	for rows.Next() {
		j, e := publicationJobScan(rows)
		if e != nil {
			writeError(w, r, e)
			return
		}
		items = append(items, j)
	}
	if e = rows.Err(); e != nil {
		writeError(w, r, e)
		return
	}
	writeData(w, r, 200, map[string]any{"items": items})
}
func (a *App) getPublicationJob(w http.ResponseWriter, r *http.Request) {
	if !a.config.LocalPublish {
		a.publishingUnavailable(w, r)
		return
	}
	if e := queryOnly(r); e != nil {
		writeError(w, r, e)
		return
	}
	if !publishmodel.ValidID(r.PathValue("id"), "job") {
		writeError(w, r, problem(404, "NOT_FOUND", "任务不存在。"))
		return
	}
	j, e := publicationJobByID(r.Context(), a.db, r.PathValue("id"))
	if e != nil {
		writeError(w, r, problem(404, "NOT_FOUND", "任务不存在。"))
		return
	}
	if j.Status == "succeeded" && j.Kind != "preview" {
		j.ActiveVerified = a.verifyActive(r.Context(), j.ReleaseID) == nil
	}
	writeData(w, r, 200, map[string]any{"job": j})
}

func (a *App) publishingStatus(w http.ResponseWriter, r *http.Request) {
	if e := queryOnly(r); e != nil {
		writeError(w, r, e)
		return
	}
	data := map[string]any{"enabled": a.config.LocalPublish, "localOnly": true, "workerAvailable": a.workerAvailable(), "activeReleaseId": nil, "activeVerified": false, "blockingJob": nil, "reason": "仅允许独立本地环境，生产发布安全门槛尚未解除。"}
	if a.config.LocalPublish {
		current, currentErr := a.currentRelease()
		verified := currentErr == nil && current == ""
		if currentErr == nil && current != "" {
			data["activeReleaseId"] = current
			verified = a.verifyActive(r.Context(), current) == nil
			data["activeVerified"] = verified
		}
		review := a.publicationReview(r.Context(), current, verified)
		if currentErr != nil {
			review.Available = false
		}
		data["review"] = review
		j, e := publicationJobScan(a.db.QueryRowContext(r.Context(), publicationJobSelect+` WHERE j.status IN ('queued','running','reconciling') LIMIT 1`))
		if e == nil {
			data["blockingJob"] = j
		}
		if a.workerAvailable() {
			data["reason"] = "仅独立本地发布可用；正式服务器未连接，生产门槛保持关闭。"
		}
	}
	writeData(w, r, 200, data)
}

func previewName(value string) string {
	if value == "" {
		return "index.html"
	}
	if strings.HasSuffix(value, "/") {
		return value + "index.html"
	}
	if path.Ext(value) == "" {
		return value + "/index.html"
	}
	return value
}
