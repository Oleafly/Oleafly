CREATE TABLE published_notes (
    id TEXT PRIMARY KEY NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    account_id TEXT NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
    source TEXT NOT NULL,
    title TEXT NOT NULL,
    html TEXT NOT NULL,
    size INTEGER NOT NULL,
    etag TEXT NOT NULL,
    published_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    taken_down_at INTEGER,
    removed_at INTEGER,
    UNIQUE (account_id, source)
) STRICT;
