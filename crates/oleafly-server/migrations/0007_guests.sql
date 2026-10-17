CREATE TABLE guest_invitations (
    id TEXT PRIMARY KEY NOT NULL,
    project_id TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('editor', 'viewer')),
    invited_by TEXT NOT NULL REFERENCES accounts (id),
    status TEXT NOT NULL CHECK (status IN ('awaiting_approval', 'invited', 'accepted', 'declined', 'revoked', 'expired')),
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    decided_by TEXT,
    decided_at INTEGER,
    accepted_by TEXT,
    accepted_at INTEGER
) STRICT;

CREATE INDEX guest_invitations_email ON guest_invitations (email, status);
CREATE INDEX guest_invitations_project ON guest_invitations (project_id, status);
CREATE INDEX guest_invitations_inviter ON guest_invitations (invited_by, created_at);
CREATE UNIQUE INDEX guest_invitations_open ON guest_invitations (project_id, email)
    WHERE status IN ('awaiting_approval', 'invited');

CREATE TABLE project_removals (
    project_id TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
    account_id TEXT NOT NULL REFERENCES accounts (id),
    removed_by TEXT NOT NULL,
    removed_at INTEGER NOT NULL,
    PRIMARY KEY (project_id, account_id)
) STRICT;
