CREATE TABLE email_preferences (
    account_id TEXT PRIMARY KEY NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
    shared_with_you INTEGER NOT NULL DEFAULT 1 CHECK (shared_with_you IN (0, 1)),
    updated_at INTEGER NOT NULL
) STRICT;
