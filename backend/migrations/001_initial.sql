-- P6-A executable schema design. CRUD, authentication and publishing are P6-B work.
-- The migration runner owns the transaction and schema_migrations bookkeeping.
-- Connection PRAGMAs and runtime SQLite version checks belong to the runner/API.
-- No account, credential, business content or workspace seed is created here.

CREATE TABLE administrators (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    username TEXT NOT NULL COLLATE NOCASE UNIQUE CHECK (length(username) BETWEEN 1 AND 80),
    password_hash TEXT NOT NULL CHECK (length(password_hash) BETWEEN 20 AND 1024),
    credential_version INTEGER NOT NULL DEFAULT 1 CHECK (credential_version >= 1),
    created_at INTEGER NOT NULL CHECK (created_at >= 0),
    updated_at INTEGER NOT NULL CHECK (updated_at >= created_at)
) STRICT;

CREATE TABLE sessions (
    token_hash TEXT PRIMARY KEY CHECK (length(token_hash) = 64 AND token_hash NOT GLOB '*[^0-9a-f]*'),
    administrator_id INTEGER NOT NULL REFERENCES administrators(id) ON DELETE CASCADE,
    credential_version INTEGER NOT NULL CHECK (credential_version >= 1),
    csrf_token_hash TEXT NOT NULL CHECK (length(csrf_token_hash) = 64 AND csrf_token_hash NOT GLOB '*[^0-9a-f]*'),
    created_at INTEGER NOT NULL CHECK (created_at >= 0),
    expires_at INTEGER NOT NULL CHECK (expires_at > created_at),
    last_seen_at INTEGER NOT NULL CHECK (last_seen_at >= created_at),
    last_interactive_at INTEGER NOT NULL CHECK (last_interactive_at >= created_at),
    reauth_until INTEGER CHECK (reauth_until IS NULL OR (reauth_until >= created_at AND reauth_until <= expires_at)),
    revoked_at INTEGER CHECK (revoked_at IS NULL OR revoked_at >= created_at)
) STRICT;

CREATE INDEX sessions_expiry ON sessions(expires_at);

CREATE TABLE login_challenges (
    nonce_hash TEXT PRIMARY KEY CHECK (length(nonce_hash) = 64 AND nonce_hash NOT GLOB '*[^0-9a-f]*'),
    cookie_hash TEXT NOT NULL UNIQUE CHECK (length(cookie_hash) = 64 AND cookie_hash NOT GLOB '*[^0-9a-f]*'),
    source_bucket_hash TEXT NOT NULL CHECK (length(source_bucket_hash) = 64 AND source_bucket_hash NOT GLOB '*[^0-9a-f]*'),
    created_at INTEGER NOT NULL CHECK (created_at >= 0),
    expires_at INTEGER NOT NULL CHECK (expires_at > created_at AND expires_at <= created_at + 300),
    consumed_at INTEGER CHECK (consumed_at IS NULL OR (consumed_at >= created_at AND consumed_at <= expires_at))
) STRICT;

CREATE INDEX login_challenges_expiry ON login_challenges(expires_at);
CREATE INDEX login_challenges_source ON login_challenges(source_bucket_hash, consumed_at, expires_at);

CREATE TABLE login_rate_limits (
    bucket_hash TEXT PRIMARY KEY CHECK (length(bucket_hash) = 64 AND bucket_hash NOT GLOB '*[^0-9a-f]*'),
    window_started_at INTEGER NOT NULL CHECK (window_started_at >= 0),
    attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    blocked_until INTEGER CHECK (blocked_until IS NULL OR blocked_until >= window_started_at),
    expires_at INTEGER NOT NULL CHECK (expires_at > window_started_at)
) STRICT;

CREATE INDEX login_rate_limits_expiry ON login_rate_limits(expires_at);

CREATE TABLE idempotency_records (
    administrator_id INTEGER NOT NULL REFERENCES administrators(id) ON DELETE RESTRICT,
    endpoint TEXT NOT NULL CHECK (length(endpoint) BETWEEN 1 AND 160),
    idempotency_key TEXT NOT NULL CHECK (length(idempotency_key) BETWEEN 16 AND 128 AND idempotency_key NOT GLOB '*[^a-zA-Z0-9_-]*'),
    request_sha256 TEXT NOT NULL CHECK (length(request_sha256) = 64 AND request_sha256 NOT GLOB '*[^0-9a-f]*'),
    resource_type TEXT NOT NULL CHECK (resource_type IN ('project', 'publish_job')),
    resource_id TEXT NOT NULL CHECK (length(resource_id) BETWEEN 1 AND 80),
    response_status INTEGER NOT NULL CHECK (response_status IN (201, 202)),
    response_json TEXT NOT NULL CHECK (length(response_json) <= 65536 AND json_valid(response_json) AND json_type(response_json) = 'object'),
    created_at INTEGER NOT NULL CHECK (created_at >= 0),
    expires_at INTEGER NOT NULL CHECK (expires_at >= created_at + 86400),
    PRIMARY KEY (administrator_id, endpoint, idempotency_key)
) STRICT;

CREATE INDEX idempotency_records_expiry ON idempotency_records(expires_at);

CREATE TABLE workspace (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
    updated_at INTEGER NOT NULL CHECK (updated_at >= 0)
) STRICT;

CREATE TABLE workspace_documents (
    kind TEXT PRIMARY KEY CHECK (kind IN ('site', 'profile')),
    workspace_id INTEGER NOT NULL DEFAULT 1 REFERENCES workspace(id) ON DELETE RESTRICT,
    content_json TEXT NOT NULL CHECK (json_valid(content_json) AND json_type(content_json) = 'object'),
    updated_at INTEGER NOT NULL CHECK (updated_at >= 0)
) STRICT;

CREATE TABLE project_categories (
    id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 80),
    workspace_id INTEGER NOT NULL DEFAULT 1 REFERENCES workspace(id) ON DELETE RESTRICT,
    slug TEXT NOT NULL UNIQUE CHECK (length(slug) BETWEEN 1 AND 80 AND slug NOT GLOB '*[^a-z0-9-]*'),
    name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 80),
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL CHECK (created_at >= 0),
    updated_at INTEGER NOT NULL CHECK (updated_at >= created_at)
) STRICT;

CREATE TABLE project_drafts (
    id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 80),
    workspace_id INTEGER NOT NULL DEFAULT 1 REFERENCES workspace(id) ON DELETE RESTRICT,
    category_id TEXT NOT NULL REFERENCES project_categories(id) ON DELETE RESTRICT,
    slug TEXT NOT NULL UNIQUE CHECK (length(slug) BETWEEN 1 AND 80 AND slug NOT GLOB '*[^a-z0-9-]*'),
    name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 160),
    summary TEXT NOT NULL CHECK (length(summary) <= 2000),
    description TEXT NOT NULL DEFAULT '' CHECK (length(description) <= 20000),
    tech_stack_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(tech_stack_json) AND json_type(tech_stack_json) = 'array'),
    status TEXT NOT NULL DEFAULT 'unconfirmed' CHECK (status IN ('unconfirmed', 'planning', 'in-development', 'live', 'maintained')),
    featured INTEGER NOT NULL DEFAULT 0 CHECK (featured IN (0, 1)),
    visible INTEGER NOT NULL DEFAULT 1 CHECK (visible IN (0, 1)),
    is_placeholder INTEGER NOT NULL DEFAULT 1 CHECK (is_placeholder IN (0, 1)),
    cover_kind TEXT NOT NULL DEFAULT 'placeholder' CHECK (cover_kind IN ('placeholder', 'screenshot')),
    cover_alt TEXT NOT NULL DEFAULT '' CHECK (length(cover_alt) <= 500),
    demo_url TEXT CHECK (demo_url IS NULL OR length(demo_url) BETWEEN 1 AND 2048),
    repository_url TEXT CHECK (repository_url IS NULL OR length(repository_url) BETWEEN 1 AND 2048),
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL CHECK (created_at >= 0),
    updated_at INTEGER NOT NULL CHECK (updated_at >= created_at),
    archived_at INTEGER CHECK (archived_at IS NULL OR archived_at >= created_at),
    CHECK (archived_at IS NULL OR visible = 0)
) STRICT;

CREATE INDEX project_drafts_category ON project_drafts(category_id, sort_order, id);

CREATE TABLE assets (
    id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 80),
    storage_kind TEXT NOT NULL CHECK (storage_kind IN ('builtin', 'upload')),
    storage_key TEXT NOT NULL UNIQUE CHECK (
        length(storage_key) BETWEEN 1 AND 255
        AND storage_key NOT GLOB '*[^a-zA-Z0-9_./-]*'
        AND substr(storage_key, 1, 1) <> '/'
        AND instr(storage_key, '..') = 0
        AND instr(storage_key, '//') = 0
    ),
    sha256 TEXT NOT NULL CHECK (length(sha256) = 64 AND sha256 NOT GLOB '*[^0-9a-f]*'),
    media_type TEXT NOT NULL CHECK (
        media_type IN ('image/png', 'image/jpeg', 'image/webp', 'image/avif')
        OR (storage_kind = 'builtin' AND media_type = 'image/svg+xml')
    ),
    byte_size INTEGER NOT NULL CHECK (byte_size > 0),
    width INTEGER NOT NULL CHECK (width BETWEEN 1 AND 32768),
    height INTEGER NOT NULL CHECK (height BETWEEN 1 AND 32768),
    created_at INTEGER NOT NULL CHECK (created_at >= 0)
) STRICT;

CREATE TABLE asset_metadata (
    asset_id TEXT PRIMARY KEY REFERENCES assets(id) ON DELETE CASCADE,
    display_name TEXT NOT NULL DEFAULT '' CHECK (length(display_name) <= 160),
    alt TEXT NOT NULL DEFAULT '' CHECK (length(alt) <= 500),
    public_use_confirmed INTEGER NOT NULL DEFAULT 0 CHECK (public_use_confirmed IN (0, 1)),
    public_confirmed_at INTEGER,
    public_confirmed_by INTEGER REFERENCES administrators(id) ON DELETE RESTRICT,
    public_confirmation_note TEXT NOT NULL DEFAULT '' CHECK (length(public_confirmation_note) <= 2000),
    created_at INTEGER NOT NULL CHECK (created_at >= 0),
    updated_at INTEGER NOT NULL CHECK (updated_at >= created_at),
    deleted_at INTEGER CHECK (deleted_at IS NULL OR deleted_at >= created_at),
    CHECK (
        (public_use_confirmed = 0 AND public_confirmed_at IS NULL AND public_confirmed_by IS NULL)
        OR (public_use_confirmed = 1 AND public_confirmed_at IS NOT NULL AND public_confirmed_by IS NOT NULL AND public_confirmed_at >= created_at)
    )
) STRICT;

CREATE INDEX asset_metadata_deleted ON asset_metadata(deleted_at, asset_id);

CREATE TABLE project_draft_assets (
    project_id TEXT NOT NULL REFERENCES project_drafts(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('cover', 'cover_avif', 'cover_webp')),
    asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE RESTRICT,
    PRIMARY KEY (project_id, role)
) STRICT;

CREATE INDEX project_draft_assets_asset ON project_draft_assets(asset_id);

CREATE TABLE document_draft_assets (
    document_kind TEXT NOT NULL REFERENCES workspace_documents(kind) ON DELETE CASCADE,
    field_path TEXT NOT NULL CHECK (length(field_path) BETWEEN 1 AND 300),
    asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE RESTRICT,
    PRIMARY KEY (document_kind, field_path)
) STRICT;

CREATE INDEX document_draft_assets_asset ON document_draft_assets(asset_id);

CREATE TABLE snapshots (
    id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 80),
    source_revision INTEGER NOT NULL CHECK (source_revision >= 0),
    projection_version INTEGER NOT NULL CHECK (projection_version >= 1),
    public_json TEXT NOT NULL CHECK (json_valid(public_json) AND json_type(public_json) = 'object'),
    content_sha256 TEXT NOT NULL CHECK (length(content_sha256) = 64 AND content_sha256 NOT GLOB '*[^0-9a-f]*'),
    created_at INTEGER NOT NULL CHECK (created_at >= 0),
    sealed_at INTEGER CHECK (sealed_at IS NULL OR sealed_at >= created_at)
) STRICT;

CREATE INDEX snapshots_revision ON snapshots(source_revision, created_at);

CREATE TABLE snapshot_assets (
    snapshot_id TEXT NOT NULL REFERENCES snapshots(id) ON DELETE RESTRICT,
    asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE RESTRICT,
    public_path TEXT NOT NULL CHECK (
        length(public_path) BETWEEN 1 AND 300
        AND public_path NOT GLOB '*[^a-zA-Z0-9_./-]*'
        AND substr(public_path, 1, 1) <> '/'
        AND instr(public_path, '..') = 0
        AND instr(public_path, '//') = 0
    ),
    PRIMARY KEY (snapshot_id, public_path),
    UNIQUE (snapshot_id, asset_id, public_path)
) STRICT;

CREATE INDEX snapshot_assets_asset ON snapshot_assets(asset_id);

CREATE TABLE publish_jobs (
    id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 80),
    -- Internal account/endpoint-scoped key, not the raw HTTP Idempotency-Key.
    idempotency_key TEXT NOT NULL UNIQUE CHECK (length(idempotency_key) BETWEEN 1 AND 160),
    kind TEXT NOT NULL CHECK (kind IN ('publish', 'preview', 'rollback')),
    snapshot_id TEXT NOT NULL REFERENCES snapshots(id) ON DELETE RESTRICT,
    target_release_id TEXT,
    activation_token_hash TEXT UNIQUE CHECK (activation_token_hash IS NULL OR (length(activation_token_hash) = 64 AND activation_token_hash NOT GLOB '*[^0-9a-f]*')),
    requested_by INTEGER NOT NULL REFERENCES administrators(id) ON DELETE RESTRICT,
    status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'reconciling', 'succeeded', 'failed', 'cancelled')),
    phase TEXT CHECK (phase IS NULL OR phase IN ('building', 'validating', 'prepared', 'activating', 'recovery_required')),
    attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    worker_id TEXT CHECK (worker_id IS NULL OR length(worker_id) BETWEEN 1 AND 80),
    lease_token_hash TEXT CHECK (lease_token_hash IS NULL OR (length(lease_token_hash) = 64 AND lease_token_hash NOT GLOB '*[^0-9a-f]*')),
    lease_expires_at INTEGER,
    created_at INTEGER NOT NULL CHECK (created_at >= 0),
    started_at INTEGER CHECK (started_at IS NULL OR started_at >= created_at),
    completed_at INTEGER CHECK (completed_at IS NULL OR completed_at >= created_at),
    reconciled_release_id TEXT,
    reconciled_at INTEGER CHECK (reconciled_at IS NULL OR reconciled_at >= created_at),
    reconciliation_receipt_sha256 TEXT UNIQUE CHECK (reconciliation_receipt_sha256 IS NULL OR (length(reconciliation_receipt_sha256) = 64 AND reconciliation_receipt_sha256 NOT GLOB '*[^0-9a-f]*')),
    error_code TEXT CHECK (error_code IS NULL OR length(error_code) BETWEEN 1 AND 80),
    error_summary TEXT CHECK (error_summary IS NULL OR length(error_summary) <= 2000),
    UNIQUE (id, snapshot_id),
    FOREIGN KEY (target_release_id, snapshot_id) REFERENCES releases(id, snapshot_id) ON DELETE RESTRICT,
    FOREIGN KEY (reconciled_release_id, snapshot_id) REFERENCES releases(id, snapshot_id) ON DELETE RESTRICT,
    CHECK ((kind = 'rollback' AND target_release_id IS NOT NULL) OR (kind <> 'rollback' AND target_release_id IS NULL)),
    CHECK (
        (worker_id IS NULL AND lease_token_hash IS NULL AND lease_expires_at IS NULL)
        OR (worker_id IS NOT NULL AND lease_token_hash IS NOT NULL AND lease_expires_at IS NOT NULL)
    ),
    CHECK (lease_expires_at IS NULL OR lease_expires_at >= created_at),
    CHECK (phase IS NULL OR status IN ('running', 'reconciling')),
    CHECK (phase IS NOT 'recovery_required' OR status = 'reconciling'),
    CHECK (status NOT IN ('running', 'reconciling') OR (worker_id IS NOT NULL AND started_at IS NOT NULL)),
    CHECK (status NOT IN ('succeeded', 'failed', 'cancelled') OR completed_at IS NOT NULL),
    CHECK (status IN ('succeeded', 'failed', 'cancelled') OR completed_at IS NULL),
    CHECK (
        (reconciled_release_id IS NULL AND reconciled_at IS NULL AND reconciliation_receipt_sha256 IS NULL)
        OR (reconciled_release_id IS NOT NULL AND reconciled_at IS NOT NULL AND reconciliation_receipt_sha256 IS NOT NULL)
    ),
    CHECK (reconciled_at IS NULL OR (started_at IS NOT NULL AND reconciled_at >= started_at)),
    CHECK (kind <> 'preview' OR activation_token_hash IS NULL),
    CHECK (status <> 'succeeded' OR kind = 'preview' OR activation_token_hash IS NOT NULL),
    CHECK (status <> 'succeeded' OR reconciled_at IS NOT NULL)
) STRICT;

CREATE INDEX publish_jobs_queue ON publish_jobs(status, created_at, id);
CREATE UNIQUE INDEX publish_jobs_one_unfinished ON publish_jobs((1)) WHERE status IN ('queued', 'running', 'reconciling');

CREATE TABLE releases (
    id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 80),
    publish_job_id TEXT NOT NULL UNIQUE,
    snapshot_id TEXT NOT NULL REFERENCES snapshots(id) ON DELETE RESTRICT,
    kind TEXT NOT NULL CHECK (kind IN ('publication', 'preview')),
    directory_key TEXT NOT NULL UNIQUE CHECK (length(directory_key) BETWEEN 1 AND 100 AND directory_key NOT GLOB '*[^a-zA-Z0-9_-]*'),
    template_revision TEXT NOT NULL CHECK (length(template_revision) = 40 AND template_revision NOT GLOB '*[^0-9a-f]*'),
    manifest_sha256 TEXT NOT NULL CHECK (length(manifest_sha256) = 64 AND manifest_sha256 NOT GLOB '*[^0-9a-f]*'),
    created_at INTEGER NOT NULL CHECK (created_at >= 0),
    expires_at INTEGER CHECK (expires_at IS NULL OR expires_at > created_at),
    UNIQUE (id, snapshot_id),
    CHECK ((kind = 'preview' AND expires_at IS NOT NULL) OR (kind = 'publication' AND expires_at IS NULL)),
    FOREIGN KEY (publish_job_id, snapshot_id) REFERENCES publish_jobs(id, snapshot_id) ON DELETE RESTRICT
) STRICT;

CREATE TABLE audit_events (
    id INTEGER PRIMARY KEY,
    actor_administrator_id INTEGER REFERENCES administrators(id) ON DELETE RESTRICT,
    request_id TEXT CHECK (request_id IS NULL OR length(request_id) BETWEEN 1 AND 100),
    action TEXT NOT NULL CHECK (length(action) BETWEEN 1 AND 100),
    resource_type TEXT NOT NULL CHECK (length(resource_type) BETWEEN 1 AND 80),
    resource_id TEXT CHECK (resource_id IS NULL OR length(resource_id) <= 160),
    outcome TEXT NOT NULL CHECK (outcome IN ('success', 'failure', 'denied')),
    metadata_json TEXT NOT NULL DEFAULT '{}' CHECK (length(metadata_json) <= 16384 AND json_valid(metadata_json) AND json_type(metadata_json) = 'object'),
    created_at INTEGER NOT NULL CHECK (created_at >= 0)
) STRICT;

CREATE INDEX audit_events_time ON audit_events(created_at, id);

CREATE TRIGGER login_challenges_consume_once
BEFORE UPDATE ON login_challenges
WHEN OLD.consumed_at IS NOT NULL
    OR NEW.consumed_at IS NULL
    OR NEW.nonce_hash IS NOT OLD.nonce_hash
    OR NEW.cookie_hash IS NOT OLD.cookie_hash
    OR NEW.source_bucket_hash IS NOT OLD.source_bucket_hash
    OR NEW.created_at IS NOT OLD.created_at
    OR NEW.expires_at IS NOT OLD.expires_at
BEGIN
    SELECT RAISE(ABORT, 'login challenges may only be consumed once');
END;

CREATE TRIGGER idempotency_records_immutable
BEFORE UPDATE ON idempotency_records
BEGIN
    SELECT RAISE(ABORT, 'completed idempotency records are immutable');
END;

CREATE TRIGGER assets_immutable
BEFORE UPDATE ON assets
BEGIN
    SELECT RAISE(ABORT, 'asset records are immutable; create a new asset');
END;

CREATE TRIGGER asset_metadata_protect_referenced_soft_delete
BEFORE UPDATE OF deleted_at ON asset_metadata
WHEN NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL AND (
    EXISTS (SELECT 1 FROM project_draft_assets WHERE asset_id = NEW.asset_id)
    OR EXISTS (SELECT 1 FROM document_draft_assets WHERE asset_id = NEW.asset_id)
    OR EXISTS (SELECT 1 FROM snapshot_assets WHERE asset_id = NEW.asset_id)
)
BEGIN
    SELECT RAISE(ABORT, 'referenced media cannot be soft-deleted');
END;

CREATE TRIGGER snapshots_insert_unsealed
BEFORE INSERT ON snapshots
WHEN NEW.sealed_at IS NOT NULL
BEGIN
    SELECT RAISE(ABORT, 'insert an unsealed snapshot before its references');
END;

CREATE TRIGGER snapshots_seal_only
BEFORE UPDATE ON snapshots
WHEN OLD.sealed_at IS NOT NULL
    OR NEW.sealed_at IS NULL
    OR NEW.id IS NOT OLD.id
    OR NEW.source_revision IS NOT OLD.source_revision
    OR NEW.projection_version IS NOT OLD.projection_version
    OR NEW.public_json IS NOT OLD.public_json
    OR NEW.content_sha256 IS NOT OLD.content_sha256
    OR NEW.created_at IS NOT OLD.created_at
BEGIN
    SELECT RAISE(ABORT, 'snapshot content is immutable; only initial sealing is allowed');
END;

CREATE TRIGGER snapshots_no_delete
BEFORE DELETE ON snapshots
BEGIN
    SELECT RAISE(ABORT, 'snapshot deletion requires a reviewed retention migration');
END;

CREATE TRIGGER snapshot_assets_insert_before_seal
BEFORE INSERT ON snapshot_assets
WHEN EXISTS (SELECT 1 FROM snapshots WHERE id = NEW.snapshot_id AND sealed_at IS NOT NULL)
BEGIN
    SELECT RAISE(ABORT, 'sealed snapshot references are immutable');
END;

CREATE TRIGGER snapshot_assets_no_update
BEFORE UPDATE ON snapshot_assets
BEGIN
    SELECT RAISE(ABORT, 'snapshot references cannot be updated');
END;

CREATE TRIGGER snapshot_assets_delete_before_seal
BEFORE DELETE ON snapshot_assets
WHEN EXISTS (SELECT 1 FROM snapshots WHERE id = OLD.snapshot_id AND sealed_at IS NOT NULL)
BEGIN
    SELECT RAISE(ABORT, 'sealed snapshot references cannot be deleted');
END;

CREATE TRIGGER publish_jobs_require_sealed_snapshot
BEFORE INSERT ON publish_jobs
WHEN NOT EXISTS (SELECT 1 FROM snapshots WHERE id = NEW.snapshot_id AND sealed_at IS NOT NULL)
BEGIN
    SELECT RAISE(ABORT, 'publish jobs require a sealed snapshot');
END;

CREATE TRIGGER publish_jobs_fixed_request
BEFORE UPDATE ON publish_jobs
WHEN NEW.id IS NOT OLD.id
    OR NEW.idempotency_key IS NOT OLD.idempotency_key
    OR NEW.kind IS NOT OLD.kind
    OR NEW.snapshot_id IS NOT OLD.snapshot_id
    OR NEW.target_release_id IS NOT OLD.target_release_id
    OR NEW.requested_by IS NOT OLD.requested_by
    OR NEW.created_at IS NOT OLD.created_at
    OR (OLD.activation_token_hash IS NOT NULL AND NEW.activation_token_hash IS NOT OLD.activation_token_hash)
    OR (OLD.reconciled_at IS NOT NULL AND (
        NEW.reconciled_at IS NOT OLD.reconciled_at
        OR NEW.reconciled_release_id IS NOT OLD.reconciled_release_id
        OR NEW.reconciliation_receipt_sha256 IS NOT OLD.reconciliation_receipt_sha256
    ))
BEGIN
    SELECT RAISE(ABORT, 'job identity, request and completed reconciliation are immutable');
END;

CREATE TRIGGER publish_jobs_terminal_immutable
BEFORE UPDATE ON publish_jobs
WHEN OLD.status IN ('succeeded', 'failed', 'cancelled')
BEGIN
    SELECT RAISE(ABORT, 'terminal jobs are immutable; create a new reviewed request');
END;

CREATE TRIGGER publish_jobs_proof_on_success_only
BEFORE UPDATE ON publish_jobs
WHEN (
    NEW.reconciled_at IS NOT OLD.reconciled_at
    OR NEW.reconciled_release_id IS NOT OLD.reconciled_release_id
    OR NEW.reconciliation_receipt_sha256 IS NOT OLD.reconciliation_receipt_sha256
) AND (OLD.status <> 'reconciling' OR NEW.status <> 'succeeded')
BEGIN
    SELECT RAISE(ABORT, 'record this job proof only in the reconciled success transition');
END;

CREATE TRIGGER publish_jobs_reconcile_before_success
BEFORE UPDATE OF status ON publish_jobs
WHEN NEW.status = 'succeeded' AND (
    OLD.status <> 'reconciling'
    OR NEW.reconciled_at IS NULL
    OR NEW.reconciled_release_id IS NULL
    OR NEW.reconciliation_receipt_sha256 IS NULL
    OR NOT EXISTS (
        SELECT 1 FROM releases
        WHERE id = NEW.reconciled_release_id
            AND snapshot_id = NEW.snapshot_id
            AND (
                (NEW.kind = 'rollback' AND id = NEW.target_release_id AND kind = 'publication')
                OR (NEW.kind = 'publish' AND publish_job_id = NEW.id AND kind = 'publication')
                OR (NEW.kind = 'preview' AND publish_job_id = NEW.id AND kind = 'preview')
            )
    )
)
BEGIN
    SELECT RAISE(ABORT, 'this job must reconcile its own filesystem result before success');
END;

CREATE TRIGGER publish_jobs_insert_queued
BEFORE INSERT ON publish_jobs
WHEN NEW.status <> 'queued'
    OR NEW.reconciled_at IS NOT NULL
    OR NEW.reconciled_release_id IS NOT NULL
    OR NEW.reconciliation_receipt_sha256 IS NOT NULL
BEGIN
    SELECT RAISE(ABORT, 'new publish jobs must be queued');
END;

CREATE TRIGGER publish_jobs_rollback_publication_only
BEFORE INSERT ON publish_jobs
WHEN NEW.kind = 'rollback' AND NOT EXISTS (
    SELECT 1 FROM releases
    WHERE id = NEW.target_release_id AND snapshot_id = NEW.snapshot_id AND kind = 'publication'
        AND EXISTS (
            SELECT 1 FROM publish_jobs
            WHERE reconciled_release_id = releases.id AND status = 'succeeded' AND kind IN ('publish', 'rollback')
        )
)
BEGIN
    SELECT RAISE(ABORT, 'rollback must target a previously successful publication release');
END;

CREATE TRIGGER releases_match_build_job
BEFORE INSERT ON releases
WHEN NOT EXISTS (
    SELECT 1 FROM publish_jobs
    WHERE id = NEW.publish_job_id AND snapshot_id = NEW.snapshot_id
        AND ((kind = 'publish' AND NEW.kind = 'publication') OR (kind = 'preview' AND NEW.kind = 'preview'))
)
BEGIN
    SELECT RAISE(ABORT, 'only publish or preview jobs may create matching release artifacts');
END;

CREATE TRIGGER releases_no_update
BEFORE UPDATE ON releases
BEGIN
    SELECT RAISE(ABORT, 'release artifacts are immutable');
END;

CREATE TRIGGER releases_no_delete
BEFORE DELETE ON releases
BEGIN
    SELECT RAISE(ABORT, 'release deletion requires a reviewed retention migration');
END;

CREATE TRIGGER audit_events_no_update
BEFORE UPDATE ON audit_events
BEGIN
    SELECT RAISE(ABORT, 'audit events are append-only');
END;

CREATE TRIGGER audit_events_no_delete
BEFORE DELETE ON audit_events
BEGIN
    SELECT RAISE(ABORT, 'audit deletion requires a reviewed retention policy');
END;
