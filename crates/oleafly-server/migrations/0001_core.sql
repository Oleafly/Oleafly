CREATE TABLE server_meta (
    key TEXT PRIMARY KEY NOT NULL,
    value TEXT NOT NULL
) STRICT;

CREATE TABLE accounts (
    id TEXT PRIMARY KEY NOT NULL,
    display_name TEXT NOT NULL,
    avatar_url TEXT,
    server_role TEXT NOT NULL CHECK (server_role IN ('admin', 'maintainer', 'member', 'guest')),
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'removed')),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
) STRICT;

CREATE INDEX accounts_role_status ON accounts (server_role, status);

CREATE TABLE identities (
    issuer TEXT NOT NULL,
    subject TEXT NOT NULL,
    provider_id TEXT NOT NULL,
    account_id TEXT NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
    login TEXT,
    linked_at INTEGER NOT NULL,
    PRIMARY KEY (issuer, subject)
) STRICT;

CREATE INDEX identities_account ON identities (account_id);

CREATE TABLE account_emails (
    account_id TEXT NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    PRIMARY KEY (account_id, email)
) STRICT;

CREATE INDEX account_emails_email ON account_emails (email);

CREATE TABLE allowlist (
    id TEXT PRIMARY KEY NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('email', 'provider_login')),
    provider_id TEXT NOT NULL DEFAULT '',
    value TEXT NOT NULL,
    match_key TEXT NOT NULL,
    server_role TEXT NOT NULL CHECK (server_role IN ('admin', 'maintainer', 'member', 'guest')),
    created_at INTEGER NOT NULL,
    created_by TEXT,
    bound_account TEXT REFERENCES accounts (id) ON DELETE CASCADE,
    UNIQUE (kind, provider_id, match_key)
) STRICT;

CREATE INDEX allowlist_bound_account ON allowlist (bound_account);

CREATE TABLE domain_rules (
    id TEXT PRIMARY KEY NOT NULL,
    domain TEXT NOT NULL UNIQUE,
    server_role TEXT NOT NULL CHECK (server_role IN ('member', 'guest')),
    created_at INTEGER NOT NULL,
    created_by TEXT
) STRICT;

CREATE TABLE devices (
    id TEXT PRIMARY KEY NOT NULL,
    account_id TEXT NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
    public_key TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    platform TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    last_seen_at INTEGER,
    revoked_at INTEGER
) STRICT;

CREATE INDEX devices_account ON devices (account_id);

CREATE TABLE pending_auth (
    id TEXT PRIMARY KEY NOT NULL,
    provider_id TEXT NOT NULL,
    client_state TEXT NOT NULL,
    redirect_uri TEXT NOT NULL,
    code_challenge TEXT NOT NULL,
    device_public_key TEXT NOT NULL,
    device_name TEXT NOT NULL,
    platform TEXT NOT NULL,
    setup_code_hash TEXT,
    provider_verifier TEXT NOT NULL,
    provider_nonce TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
) STRICT;

CREATE INDEX pending_auth_expires ON pending_auth (expires_at);

CREATE TABLE auth_codes (
    code_hash TEXT PRIMARY KEY NOT NULL,
    account_id TEXT NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
    code_challenge TEXT NOT NULL,
    device_public_key TEXT NOT NULL,
    device_name TEXT NOT NULL,
    platform TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    used_at INTEGER
) STRICT;

CREATE INDEX auth_codes_expires ON auth_codes (expires_at);

CREATE TABLE nonces (
    nonce TEXT PRIMARY KEY NOT NULL,
    expires_at INTEGER NOT NULL
) STRICT;

CREATE INDEX nonces_expires ON nonces (expires_at);

CREATE TABLE access_tokens (
    token_hash TEXT PRIMARY KEY NOT NULL,
    account_id TEXT NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
    device_id TEXT NOT NULL REFERENCES devices (id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
) STRICT;

CREATE INDEX access_tokens_device ON access_tokens (device_id);
CREATE INDEX access_tokens_expires ON access_tokens (expires_at);

CREATE TABLE refresh_tokens (
    token_hash TEXT PRIMARY KEY NOT NULL,
    family_id TEXT NOT NULL,
    account_id TEXT NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
    device_id TEXT NOT NULL REFERENCES devices (id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    rotated_at INTEGER,
    replaced_by TEXT,
    revoked_at INTEGER,
    grace_reply BLOB
) STRICT;

CREATE INDEX refresh_tokens_device ON refresh_tokens (device_id);
CREATE INDEX refresh_tokens_family ON refresh_tokens (family_id);
CREATE INDEX refresh_tokens_expires ON refresh_tokens (expires_at);

CREATE TABLE settings (
    key TEXT PRIMARY KEY NOT NULL,
    value INTEGER NOT NULL CHECK (value IN (0, 1))
) STRICT;

CREATE TABLE security_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    at INTEGER NOT NULL,
    actor TEXT,
    kind TEXT NOT NULL,
    target TEXT,
    ip TEXT,
    detail TEXT NOT NULL DEFAULT '{}'
) STRICT;

CREATE INDEX security_log_at ON security_log (at);
