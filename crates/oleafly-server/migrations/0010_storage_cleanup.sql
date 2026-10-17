ALTER TABLE project_blobs ADD COLUMN used_at INTEGER NOT NULL DEFAULT 0;
UPDATE project_blobs SET used_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000 WHERE used_at = 0;
CREATE INDEX project_blobs_used ON project_blobs (used_at);

CREATE TABLE pending_removals (
    kind TEXT NOT NULL CHECK (kind IN ('file', 'snapshot')),
    project_id TEXT NOT NULL,
    hash TEXT NOT NULL,
    queued_at INTEGER NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (kind, project_id, hash)
) STRICT;
