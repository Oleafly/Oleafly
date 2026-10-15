ALTER TABLE pending_auth ADD COLUMN device_authorization TEXT;

CREATE TABLE email_link_tokens (
    selector TEXT PRIMARY KEY NOT NULL,
    verifier_hash TEXT NOT NULL,
    pending_id TEXT NOT NULL,
    email TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    used_at INTEGER
) STRICT;

CREATE INDEX email_link_tokens_pending ON email_link_tokens (pending_id);
CREATE INDEX email_link_tokens_expires ON email_link_tokens (expires_at);

CREATE TABLE device_authorizations (
    id TEXT PRIMARY KEY NOT NULL,
    device_code_hash TEXT NOT NULL,
    user_code_hash TEXT NOT NULL UNIQUE,
    device_public_key TEXT NOT NULL,
    device_name TEXT NOT NULL,
    platform TEXT NOT NULL,
    setup_code_hash TEXT,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'denied', 'refused', 'used')),
    account_id TEXT REFERENCES accounts (id) ON DELETE CASCADE,
    interval_secs INTEGER NOT NULL,
    last_polled_at INTEGER,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
) STRICT;

CREATE INDEX device_authorizations_expires ON device_authorizations (expires_at);

CREATE TABLE sign_in_throttle (
    key TEXT PRIMARY KEY NOT NULL,
    hits INTEGER NOT NULL,
    lockout_logged INTEGER NOT NULL DEFAULT 0 CHECK (lockout_logged IN (0, 1)),
    expires_at INTEGER NOT NULL
) STRICT;

CREATE INDEX sign_in_throttle_expires ON sign_in_throttle (expires_at);
