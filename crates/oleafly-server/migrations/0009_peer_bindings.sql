CREATE TABLE project_peers (
    project_id TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
    peer INTEGER NOT NULL,
    device_id TEXT NOT NULL,
    account_id TEXT NOT NULL,
    counter_end INTEGER NOT NULL,
    bound_at INTEGER NOT NULL,
    PRIMARY KEY (project_id, peer)
) STRICT;

ALTER TABLE project_snapshots ADD COLUMN signed_by TEXT;
ALTER TABLE project_snapshots ADD COLUMN signature TEXT;
ALTER TABLE projects ADD COLUMN peers_known INTEGER NOT NULL DEFAULT 0;
