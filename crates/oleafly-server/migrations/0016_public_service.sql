CREATE INDEX projects_owner ON projects (owner_account, status);

CREATE TABLE account_uploads (
    account_id TEXT PRIMARY KEY NOT NULL REFERENCES accounts (id),
    window_start INTEGER NOT NULL,
    uploads INTEGER NOT NULL
) STRICT;
