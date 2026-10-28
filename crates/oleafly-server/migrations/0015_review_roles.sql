DROP TRIGGER project_updates_counted;
DROP TRIGGER project_updates_uncounted;
DROP TRIGGER project_blobs_counted;
DROP TRIGGER project_blobs_uncounted;
DROP TRIGGER project_blobs_resized;

CREATE TABLE projects_with_review_roles (
    id TEXT PRIMARY KEY NOT NULL,
    owner_account TEXT NOT NULL REFERENCES accounts (id),
    title TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('pending', 'active', 'archived')),
    created_at INTEGER NOT NULL,
    committed_at INTEGER,
    archived_at INTEGER,
    link_sharing INTEGER NOT NULL DEFAULT 0,
    link_role TEXT NOT NULL DEFAULT 'viewer' CHECK (link_role IN ('editor', 'reviewer', 'commenter', 'viewer')),
    head_seq INTEGER NOT NULL DEFAULT 0,
    comments_enabled INTEGER NOT NULL DEFAULT 1 CHECK (comments_enabled IN (0, 1)),
    access_log INTEGER NOT NULL DEFAULT 0 CHECK (access_log IN (0, 1)),
    peers_known INTEGER NOT NULL DEFAULT 0,
    log_bytes INTEGER NOT NULL DEFAULT 0,
    file_bytes INTEGER NOT NULL DEFAULT 0
) STRICT;

INSERT INTO projects_with_review_roles (
    id, owner_account, title, status, created_at, committed_at, archived_at, link_sharing,
    link_role, head_seq, comments_enabled, access_log, peers_known, log_bytes, file_bytes
)
SELECT
    id, owner_account, title, status, created_at, committed_at, archived_at, link_sharing,
    link_role, head_seq, comments_enabled, access_log, peers_known, log_bytes, file_bytes
FROM projects;

DROP TABLE projects;
ALTER TABLE projects_with_review_roles RENAME TO projects;
CREATE INDEX projects_status ON projects (status, created_at);

CREATE TABLE project_grants_with_review_roles (
    project_id TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
    account_id TEXT NOT NULL REFERENCES accounts (id),
    role TEXT NOT NULL CHECK (role IN ('owner', 'editor', 'reviewer', 'commenter', 'viewer')),
    granted_at INTEGER NOT NULL,
    granted_by TEXT,
    accepted_at INTEGER,
    PRIMARY KEY (project_id, account_id)
) STRICT;

INSERT INTO project_grants_with_review_roles (
    project_id, account_id, role, granted_at, granted_by, accepted_at
)
SELECT project_id, account_id, role, granted_at, granted_by, accepted_at
FROM project_grants;

DROP TABLE project_grants;
ALTER TABLE project_grants_with_review_roles RENAME TO project_grants;
CREATE INDEX project_grants_account ON project_grants (account_id);

CREATE TABLE guest_invitations_with_review_roles (
    id TEXT PRIMARY KEY NOT NULL,
    project_id TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('editor', 'reviewer', 'commenter', 'viewer')),
    invited_by TEXT NOT NULL REFERENCES accounts (id),
    status TEXT NOT NULL CHECK (status IN ('awaiting_approval', 'invited', 'accepted', 'declined', 'revoked', 'expired')),
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    decided_by TEXT,
    decided_at INTEGER,
    accepted_by TEXT,
    accepted_at INTEGER
) STRICT;

INSERT INTO guest_invitations_with_review_roles (
    id, project_id, email, role, invited_by, status, created_at, expires_at, decided_by,
    decided_at, accepted_by, accepted_at
)
SELECT
    id, project_id, email, role, invited_by, status, created_at, expires_at, decided_by,
    decided_at, accepted_by, accepted_at
FROM guest_invitations;

DROP TABLE guest_invitations;
ALTER TABLE guest_invitations_with_review_roles RENAME TO guest_invitations;
CREATE INDEX guest_invitations_email ON guest_invitations (email, status);
CREATE INDEX guest_invitations_project ON guest_invitations (project_id, status);
CREATE INDEX guest_invitations_inviter ON guest_invitations (invited_by, created_at);
CREATE UNIQUE INDEX guest_invitations_open ON guest_invitations (project_id, email)
    WHERE status IN ('awaiting_approval', 'invited');

CREATE TRIGGER project_updates_counted AFTER INSERT ON project_updates
BEGIN
    UPDATE projects SET log_bytes = log_bytes + length(NEW.envelope)
    WHERE id = NEW.project_id;
END;

CREATE TRIGGER project_updates_uncounted AFTER DELETE ON project_updates
BEGIN
    UPDATE projects SET log_bytes = MAX(log_bytes - length(OLD.envelope), 0)
    WHERE id = OLD.project_id;
END;

CREATE TRIGGER project_blobs_counted AFTER INSERT ON project_blobs
BEGIN
    UPDATE projects SET file_bytes = file_bytes + NEW.size
    WHERE id = NEW.project_id;
END;

CREATE TRIGGER project_blobs_uncounted AFTER DELETE ON project_blobs
BEGIN
    UPDATE projects SET file_bytes = MAX(file_bytes - OLD.size, 0)
    WHERE id = OLD.project_id;
END;

CREATE TRIGGER project_blobs_resized AFTER UPDATE OF size ON project_blobs
BEGIN
    UPDATE projects SET file_bytes = MAX(file_bytes - OLD.size + NEW.size, 0)
    WHERE id = NEW.project_id;
END;
