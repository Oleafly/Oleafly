CREATE TABLE web_sessions (
    token_hash TEXT PRIMARY KEY NOT NULL,
    device_id TEXT NOT NULL UNIQUE REFERENCES devices (id) ON DELETE CASCADE,
    account_id TEXT NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
    mode TEXT NOT NULL DEFAULT 'editing' CHECK (mode IN ('editing', 'suggesting')),
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
) STRICT;

CREATE INDEX web_sessions_account ON web_sessions (account_id);
CREATE INDEX web_sessions_expires ON web_sessions (expires_at);
