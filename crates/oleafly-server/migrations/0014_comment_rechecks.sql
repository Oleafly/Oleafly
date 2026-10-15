-- Changes stored while comments were off for their project without being
-- checked for comment changes, because reading the project did not fit the
-- snapshot memory budget then. Each is checked once it does.
CREATE TABLE comment_rechecks (
    project_id TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
    seq INTEGER NOT NULL,
    spans TEXT NOT NULL,
    account_id TEXT NOT NULL,
    device_id TEXT NOT NULL,
    queued_at INTEGER NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (project_id, seq)
) STRICT;
