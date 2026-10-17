CREATE TABLE projects (
    id TEXT PRIMARY KEY NOT NULL,
    owner_account TEXT NOT NULL REFERENCES accounts (id),
    title TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('pending', 'active', 'archived')),
    created_at INTEGER NOT NULL,
    committed_at INTEGER,
    archived_at INTEGER,
    link_sharing INTEGER NOT NULL DEFAULT 0,
    link_role TEXT NOT NULL DEFAULT 'viewer' CHECK (link_role IN ('editor', 'viewer')),
    head_seq INTEGER NOT NULL DEFAULT 0
) STRICT;

CREATE INDEX projects_status ON projects (status, created_at);

CREATE TABLE project_grants (
    project_id TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
    account_id TEXT NOT NULL REFERENCES accounts (id),
    role TEXT NOT NULL CHECK (role IN ('owner', 'editor', 'viewer')),
    granted_at INTEGER NOT NULL,
    granted_by TEXT,
    PRIMARY KEY (project_id, account_id)
) STRICT;

CREATE INDEX project_grants_account ON project_grants (account_id);

CREATE TABLE project_updates (
    project_id TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
    seq INTEGER NOT NULL,
    batch_id TEXT NOT NULL,
    device_id TEXT NOT NULL,
    account_id TEXT NOT NULL,
    envelope BLOB NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (project_id, seq),
    UNIQUE (project_id, batch_id)
) STRICT;

CREATE TABLE project_snapshots (
    project_id TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
    seq INTEGER NOT NULL,
    file TEXT NOT NULL,
    size INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    created_by TEXT NOT NULL,
    PRIMARY KEY (project_id, seq)
) STRICT;

CREATE TABLE project_blobs (
    project_id TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
    hash TEXT NOT NULL,
    size INTEGER NOT NULL,
    PRIMARY KEY (project_id, hash)
) STRICT;

CREATE INDEX project_blobs_hash ON project_blobs (hash);
