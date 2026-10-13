ALTER TABLE projects ADD COLUMN access_log INTEGER NOT NULL DEFAULT 0 CHECK (access_log IN (0, 1));

ALTER TABLE project_grants ADD COLUMN accepted_at INTEGER;

UPDATE project_grants SET accepted_at = granted_at WHERE accepted_at IS NULL;

CREATE TABLE project_access_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
    account_id TEXT NOT NULL,
    device_id TEXT NOT NULL,
    device_name TEXT NOT NULL DEFAULT '',
    kind TEXT NOT NULL,
    via TEXT,
    at INTEGER NOT NULL,
    last_at INTEGER NOT NULL,
    times INTEGER NOT NULL DEFAULT 1
) STRICT;

CREATE INDEX project_access_log_project ON project_access_log (project_id, id);
CREATE INDEX project_access_log_device ON project_access_log (project_id, device_id, kind, id);
CREATE INDEX project_access_log_last_at ON project_access_log (last_at);
