-- Append-only content provenance/history. Existing 001 bytes are unchanged.
CREATE TABLE content_imports (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    workspace_id INTEGER NOT NULL UNIQUE REFERENCES workspace(id) ON DELETE RESTRICT,
    source_revision TEXT NOT NULL CHECK (length(source_revision) = 40 AND source_revision NOT GLOB '*[^0-9a-f]*'),
    manifest_sha256 TEXT NOT NULL CHECK (length(manifest_sha256) = 64 AND manifest_sha256 NOT GLOB '*[^0-9a-f]*'),
    payload_sha256 TEXT NOT NULL CHECK (length(payload_sha256) = 64 AND payload_sha256 NOT GLOB '*[^0-9a-f]*'),
    imported_at INTEGER NOT NULL CHECK (imported_at >= 0),
    project_count INTEGER NOT NULL CHECK (project_count >= 0),
    category_count INTEGER NOT NULL CHECK (category_count >= 0)
) STRICT;

CREATE TABLE workspace_changes (
    revision INTEGER PRIMARY KEY CHECK (revision > 0),
    actor_administrator_id INTEGER NOT NULL REFERENCES administrators(id) ON DELETE RESTRICT,
    action TEXT NOT NULL CHECK (length(action) BETWEEN 1 AND 100),
    changed_at INTEGER NOT NULL CHECK (changed_at >= 0),
    change_json TEXT NOT NULL CHECK (length(change_json) <= 1048576 AND json_valid(change_json) AND json_type(change_json) = 'object')
) STRICT;

CREATE TRIGGER content_imports_no_update
BEFORE UPDATE ON content_imports
BEGIN
    SELECT RAISE(ABORT, 'content import provenance is immutable');
END;

CREATE TRIGGER content_imports_no_delete
BEFORE DELETE ON content_imports
BEGIN
    SELECT RAISE(ABORT, 'content import provenance is immutable');
END;

CREATE TRIGGER workspace_changes_no_update
BEFORE UPDATE ON workspace_changes
BEGIN
    SELECT RAISE(ABORT, 'workspace change history is append-only');
END;

CREATE TRIGGER workspace_changes_no_delete
BEFORE DELETE ON workspace_changes
BEGIN
    SELECT RAISE(ABORT, 'workspace change history is append-only');
END;

-- This is structural initialization, not business/sample data. Existing content remains untouched.
INSERT INTO workspace(id, revision, updated_at) VALUES(1, 0, 0)
ON CONFLICT(id) DO NOTHING;
