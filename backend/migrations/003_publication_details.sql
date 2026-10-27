-- Additive metadata only; existing immutable snapshots, jobs and releases stay
-- protected by the reviewed P6-A constraints and triggers.
CREATE TABLE publication_job_details (
    job_id TEXT PRIMARY KEY REFERENCES publish_jobs(id) ON DELETE RESTRICT,
    release_id TEXT NOT NULL CHECK (length(release_id) BETWEEN 1 AND 80),
    previous_release_id TEXT REFERENCES releases(id) ON DELETE RESTRICT,
    source_revision TEXT NOT NULL CHECK (length(source_revision)=40 AND source_revision NOT GLOB '*[^0-9a-f]*'),
    builder_id TEXT NOT NULL CHECK (length(builder_id) BETWEEN 1 AND 160),
    manifest_sha256 TEXT CHECK (manifest_sha256 IS NULL OR (length(manifest_sha256)=64 AND manifest_sha256 NOT GLOB '*[^0-9a-f]*'))
) STRICT;

CREATE TRIGGER publication_details_fixed
BEFORE UPDATE ON publication_job_details
WHEN NEW.job_id IS NOT OLD.job_id OR NEW.release_id IS NOT OLD.release_id
    OR NEW.previous_release_id IS NOT OLD.previous_release_id
    OR NEW.source_revision IS NOT OLD.source_revision OR NEW.builder_id IS NOT OLD.builder_id
    OR (OLD.manifest_sha256 IS NOT NULL AND NEW.manifest_sha256 IS NOT OLD.manifest_sha256)
BEGIN
    SELECT RAISE(ABORT, 'publication assignment and prepared artifact are immutable');
END;
