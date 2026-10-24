//! A day-long cache of literature answers, so a task that repeats a search
//! does not spend the indexes' rate limits again.
use std::path::PathBuf;

use rusqlite::{params, Connection, OptionalExtension};
use sha2::{Digest, Sha256};

const TTL_MS: i64 = 24 * 60 * 60 * 1000;
const MAX_ROWS: i64 = 2_000;
const MAX_BODY_BYTES: usize = 2 * 1024 * 1024;

pub struct LiteratureCache {
    path: PathBuf,
}

/// The cache key of one source's answer to one query.
pub fn cache_key(
    source: &str,
    query: &str,
    limit: u8,
    years: Option<(u16, u16)>,
    open_access_only: bool,
) -> String {
    let mut hasher = Sha256::new();
    hasher.update(source.as_bytes());
    hasher.update([0]);
    hasher.update(query.trim().to_lowercase().as_bytes());
    hasher.update([0]);
    hasher.update([limit]);
    if let Some((from, to)) = years {
        hasher.update(from.to_le_bytes());
        hasher.update(to.to_le_bytes());
    }
    hasher.update([u8::from(open_access_only)]);
    format!("{:x}", hasher.finalize())
}

impl LiteratureCache {
    pub fn new(path: PathBuf) -> Self {
        Self { path }
    }

    fn open(&self) -> Option<Connection> {
        let connection = Connection::open(&self.path).ok()?;
        connection
            .execute_batch(
                "CREATE TABLE IF NOT EXISTS entries (
                   key TEXT PRIMARY KEY, created_at INTEGER NOT NULL, body TEXT NOT NULL
                 );",
            )
            .ok()?;
        Some(connection)
    }

    /// A fresh answer, if one is cached.
    pub fn get(&self, key: &str, now: i64) -> Option<String> {
        self.open()?
            .query_row(
                "SELECT body FROM entries WHERE key = ?1 AND created_at > ?2",
                params![key, now - TTL_MS],
                |row| row.get(0),
            )
            .optional()
            .ok()
            .flatten()
    }

    /// Stores an answer; the oldest tenth goes when the cache is full.
    pub fn put(&self, key: &str, body: &str, now: i64) {
        if body.len() > MAX_BODY_BYTES {
            return;
        }
        let Some(connection) = self.open() else {
            return;
        };
        let _ = connection.execute(
            "INSERT OR REPLACE INTO entries (key, created_at, body) VALUES (?1, ?2, ?3)",
            params![key, now, body],
        );
        let rows: i64 = connection
            .query_row("SELECT COUNT(*) FROM entries", [], |row| row.get(0))
            .unwrap_or(0);
        if rows > MAX_ROWS {
            let _ = connection.execute(
                "DELETE FROM entries WHERE key IN (SELECT key FROM entries ORDER BY created_at ASC LIMIT ?1)",
                [rows / 10],
            );
        }
    }

    #[cfg(test)]
    pub(crate) fn age(&self, key: &str, by_ms: i64) {
        if let Some(connection) = self.open() {
            let _ = connection.execute(
                "UPDATE entries SET created_at = created_at - ?2 WHERE key = ?1",
                params![key, by_ms],
            );
        }
    }
}
