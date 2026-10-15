ALTER TABLE email_preferences ADD COLUMN mentions INTEGER NOT NULL DEFAULT 1 CHECK (mentions IN (0, 1));

CREATE TABLE mention_scans (
    project_id TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
    seq INTEGER NOT NULL,
    spans TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (project_id, seq)
) STRICT;

CREATE TABLE mention_emails (
    project_id TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
    message_id TEXT NOT NULL,
    recipient_id TEXT NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
    author_id TEXT NOT NULL,
    file_id TEXT NOT NULL,
    thread_id TEXT NOT NULL,
    path TEXT,
    quote TEXT,
    body TEXT,
    noticed_at INTEGER NOT NULL,
    due_at INTEGER NOT NULL,
    sent_at INTEGER,
    PRIMARY KEY (project_id, message_id, recipient_id)
) STRICT;

CREATE INDEX mention_emails_waiting ON mention_emails (recipient_id, due_at) WHERE sent_at IS NULL;
