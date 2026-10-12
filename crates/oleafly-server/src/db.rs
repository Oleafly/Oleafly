use std::path::Path;
use std::str::FromStr;
use std::sync::{Arc, Mutex, PoisonError};
use std::time::Duration;

use oleafly_collab_protocol::ids::ServerId;
use rusqlite::{Connection, OptionalExtension};

use crate::error::ServerError;

pub const SCHEMA_VERSION: i64 = 10;
pub const SERVER_ID_KEY: &str = "server_id";
pub const SETUP_CODE_HASH_KEY: &str = "setup_code_hash";
const MIGRATIONS: [&str; 10] = [
    include_str!("../migrations/0001_core.sql"),
    include_str!("../migrations/0002_projects.sql"),
    include_str!("../migrations/0003_email.sql"),
    include_str!("../migrations/0004_comments.sql"),
    include_str!("../migrations/0005_snapshot_blobs.sql"),
    include_str!("../migrations/0006_access_log.sql"),
    include_str!("../migrations/0007_guests.sql"),
    include_str!("../migrations/0008_sign_in_links.sql"),
    include_str!("../migrations/0009_peer_bindings.sql"),
    include_str!("../migrations/0010_storage_cleanup.sql"),
];

#[derive(Clone)]
pub struct Db {
    connection: Arc<Mutex<Connection>>,
}

impl Db {
    pub fn open(path: &Path) -> Result<Db, ServerError> {
        if let Some(parent) = path
            .parent()
            .filter(|parent| !parent.as_os_str().is_empty())
        {
            std::fs::create_dir_all(parent).map_err(|error| {
                ServerError::Internal(format!("could not create {}: {error}", parent.display()))
            })?;
        }
        let connection = Connection::open(path)?;
        connection.busy_timeout(Duration::from_secs(5))?;
        let mode: String =
            connection.query_row("PRAGMA journal_mode = WAL", [], |row| row.get(0))?;
        if !mode.eq_ignore_ascii_case("wal") {
            return Err(ServerError::Internal(format!(
                "SQLite kept journal mode {mode} for {} instead of WAL",
                path.display()
            )));
        }
        Db::prepare(connection)
    }

    pub fn open_in_memory() -> Result<Db, ServerError> {
        Db::prepare(Connection::open_in_memory()?)
    }

    fn prepare(mut connection: Connection) -> Result<Db, ServerError> {
        connection.execute_batch("PRAGMA foreign_keys = ON;")?;
        migrate(&mut connection)?;
        Ok(Db {
            connection: Arc::new(Mutex::new(connection)),
        })
    }

    pub async fn call<T, F>(&self, f: F) -> Result<T, ServerError>
    where
        T: Send + 'static,
        F: FnOnce(&mut Connection) -> Result<T, ServerError> + Send + 'static,
    {
        let connection = Arc::clone(&self.connection);
        tokio::task::spawn_blocking(move || {
            let mut guard = connection.lock().unwrap_or_else(PoisonError::into_inner);
            f(&mut guard)
        })
        .await
        .map_err(|error| ServerError::Internal(format!("database task failed: {error}")))?
    }
}

fn migrate(connection: &mut Connection) -> Result<(), ServerError> {
    let current: i64 = connection.query_row("PRAGMA user_version", [], |row| row.get(0))?;
    let known = i64::try_from(MIGRATIONS.len()).unwrap_or(i64::MAX);
    if current > known {
        return Err(ServerError::Internal(format!(
            "the database schema version {current} is newer than this Oleafly Server understands ({known}). Install a newer Oleafly Server or restore a backup."
        )));
    }
    let applied = usize::try_from(current).unwrap_or(0);
    for (index, sql) in MIGRATIONS.iter().enumerate().skip(applied) {
        let transaction = connection.transaction()?;
        transaction.execute_batch(sql)?;
        transaction.execute_batch(&format!("PRAGMA user_version = {};", index + 1))?;
        transaction.commit()?;
    }
    Ok(())
}

pub fn server_id(conn: &Connection) -> Result<ServerId, ServerError> {
    if let Some(stored) = meta_get(conn, SERVER_ID_KEY)? {
        return parse_id(&stored);
    }
    let id = ServerId::new_v7();
    meta_set(conn, SERVER_ID_KEY, &id.to_string())?;
    Ok(id)
}

pub fn meta_get(conn: &Connection, key: &str) -> Result<Option<String>, ServerError> {
    Ok(conn
        .query_row(
            "SELECT value FROM server_meta WHERE key = ?1",
            [key],
            |row| row.get(0),
        )
        .optional()?)
}

pub fn meta_set(conn: &Connection, key: &str, value: &str) -> Result<(), ServerError> {
    conn.execute(
        "INSERT INTO server_meta (key, value) VALUES (?1, ?2) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
        [key, value],
    )?;
    Ok(())
}

pub fn meta_delete(conn: &Connection, key: &str) -> Result<(), ServerError> {
    conn.execute("DELETE FROM server_meta WHERE key = ?1", [key])?;
    Ok(())
}

pub fn parse_id<T: FromStr>(text: &str) -> Result<T, ServerError> {
    text.parse::<T>()
        .map_err(|_| ServerError::Internal(format!("stored id {text} is not canonical")))
}

pub fn is_unique_violation(error: &rusqlite::Error) -> bool {
    matches!(
        error,
        rusqlite::Error::SqliteFailure(failure, _)
            if failure.extended_code == rusqlite::ffi::SQLITE_CONSTRAINT_UNIQUE
                || failure.extended_code == rusqlite::ffi::SQLITE_CONSTRAINT_PRIMARYKEY
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::params;

    const TABLES: [&str; 28] = [
        "access_tokens",
        "account_emails",
        "accounts",
        "allowlist",
        "auth_codes",
        "device_authorizations",
        "devices",
        "domain_rules",
        "email_link_tokens",
        "email_preferences",
        "guest_invitations",
        "identities",
        "nonces",
        "pending_auth",
        "pending_removals",
        "project_access_log",
        "project_blobs",
        "project_grants",
        "project_peers",
        "project_removals",
        "project_snapshots",
        "project_updates",
        "projects",
        "refresh_tokens",
        "security_log",
        "server_meta",
        "settings",
        "sign_in_throttle",
    ];

    const INDEXES: [&str; 29] = [
        "access_tokens_device",
        "access_tokens_expires",
        "account_emails_email",
        "accounts_role_status",
        "allowlist_bound_account",
        "auth_codes_expires",
        "device_authorizations_expires",
        "devices_account",
        "email_link_tokens_expires",
        "email_link_tokens_pending",
        "guest_invitations_email",
        "guest_invitations_inviter",
        "guest_invitations_open",
        "guest_invitations_project",
        "identities_account",
        "nonces_expires",
        "pending_auth_expires",
        "project_access_log_device",
        "project_access_log_last_at",
        "project_access_log_project",
        "project_blobs_hash",
        "project_blobs_used",
        "project_grants_account",
        "projects_status",
        "refresh_tokens_device",
        "refresh_tokens_expires",
        "refresh_tokens_family",
        "security_log_at",
        "sign_in_throttle_expires",
    ];

    fn names(conn: &Connection, kind: &str) -> Vec<String> {
        let mut statement = conn
            .prepare("SELECT name FROM sqlite_master WHERE type = ?1 AND name NOT LIKE 'sqlite_%' ORDER BY name")
            .unwrap();
        statement
            .query_map([kind], |row| row.get(0))
            .unwrap()
            .collect::<Result<Vec<String>, _>>()
            .unwrap()
    }

    fn version(conn: &Connection) -> i64 {
        conn.query_row("PRAGMA user_version", [], |row| row.get(0))
            .unwrap()
    }

    fn count(conn: &Connection, table: &str) -> i64 {
        conn.query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| {
            row.get(0)
        })
        .unwrap()
    }

    #[test]
    fn schema_version_matches_the_migration_list() {
        assert_eq!(SCHEMA_VERSION, i64::try_from(MIGRATIONS.len()).unwrap());
    }

    #[tokio::test]
    async fn a_new_database_has_every_table_and_index() {
        let db = Db::open_in_memory().unwrap();
        db.call(|conn| {
            assert_eq!(version(conn), SCHEMA_VERSION);
            assert_eq!(names(conn, "table"), TABLES);
            assert_eq!(names(conn, "index"), INDEXES);
            Ok(())
        })
        .await
        .unwrap();
    }

    #[tokio::test]
    async fn reopening_a_file_database_keeps_the_schema_wal_mode_and_server_id() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory
            .path()
            .join("nested")
            .join("oleafly-server.sqlite3");
        let first = Db::open(&path).unwrap();
        let id = first.call(|conn| server_id(conn)).await.unwrap();
        drop(first);
        let second = Db::open(&path).unwrap();
        let (again, mode, schema) = second
            .call(|conn| {
                let mode: String = conn.query_row("PRAGMA journal_mode", [], |row| row.get(0))?;
                Ok((server_id(conn)?, mode, version(conn)))
            })
            .await
            .unwrap();
        assert_eq!(again, id);
        assert_eq!(mode, "wal");
        assert_eq!(schema, SCHEMA_VERSION);
    }

    #[tokio::test]
    async fn a_database_from_a_newer_server_is_refused() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("oleafly-server.sqlite3");
        let db = Db::open(&path).unwrap();
        db.call(|conn| {
            conn.execute_batch("PRAGMA user_version = 99;")?;
            Ok(())
        })
        .await
        .unwrap();
        drop(db);
        match Db::open(&path) {
            Err(ServerError::Internal(message)) => assert!(message.contains("newer"), "{message}"),
            Err(other) => panic!("unexpected error {other}"),
            Ok(_) => panic!("a newer schema must be refused"),
        }
    }

    #[tokio::test]
    async fn foreign_keys_checks_and_unique_constraints_hold() {
        let db = Db::open_in_memory().unwrap();
        db.call(|conn| {
            let orphan = conn.execute(
                "INSERT INTO devices (id, account_id, public_key, name, platform, created_at) VALUES ('d0', 'missing', 'k0', 'Laptop', 'macos', 1)",
                [],
            );
            assert!(!is_unique_violation(orphan.as_ref().unwrap_err()));
            conn.execute(
                "INSERT INTO accounts (id, display_name, server_role, created_at, updated_at) VALUES ('a1', 'Ada', 'member', 1, 1)",
                [],
            )?;
            conn.execute(
                "INSERT INTO devices (id, account_id, public_key, name, platform, created_at) VALUES ('d1', 'a1', 'k1', 'Laptop', 'macos', 1)",
                [],
            )?;
            let same_key = conn
                .execute(
                    "INSERT INTO devices (id, account_id, public_key, name, platform, created_at) VALUES ('d2', 'a1', 'k1', 'Desktop', 'linux', 1)",
                    [],
                )
                .unwrap_err();
            assert!(is_unique_violation(&same_key));
            conn.execute(
                "INSERT INTO identities (issuer, subject, provider_id, account_id, login, linked_at) VALUES ('https://github.com', '42', 'github', 'a1', 'ada', 1)",
                [],
            )?;
            let same_identity = conn
                .execute(
                    "INSERT INTO identities (issuer, subject, provider_id, account_id, login, linked_at) VALUES ('https://github.com', '42', 'github', 'a1', 'ada-2', 2)",
                    [],
                )
                .unwrap_err();
            assert!(is_unique_violation(&same_identity));
            conn.execute(
                "INSERT INTO allowlist (id, kind, provider_id, value, match_key, server_role, created_at) VALUES ('l1', 'email', '', 'Ada@Uni.edu', 'ada@uni.edu', 'member', 1)",
                [],
            )?;
            let same_entry = conn
                .execute(
                    "INSERT INTO allowlist (id, kind, provider_id, value, match_key, server_role, created_at) VALUES ('l2', 'email', '', 'ada@uni.edu', 'ada@uni.edu', 'admin', 2)",
                    [],
                )
                .unwrap_err();
            assert!(is_unique_violation(&same_entry));
            let staff_rule = conn.execute(
                "INSERT INTO domain_rules (id, domain, server_role, created_at) VALUES ('r1', 'uni.edu', 'admin', 1)",
                [],
            );
            assert!(staff_rule.is_err());
            conn.execute("UPDATE accounts SET status = 'removed' WHERE id = 'a1'", [])?;
            let unknown_status = conn.execute("UPDATE accounts SET status = 'deleted' WHERE id = 'a1'", []);
            assert!(unknown_status.is_err());
            conn.execute("UPDATE devices SET revoked_at = 5 WHERE id = 'd1'", [])?;
            let revoked: Option<i64> = conn.query_row("SELECT revoked_at FROM devices WHERE id = 'd1'", [], |row| row.get(0))?;
            assert_eq!(revoked, Some(5));
            let wrong_type = conn.execute("UPDATE devices SET revoked_at = 'soon' WHERE id = 'd1'", []);
            assert!(wrong_type.is_err());
            Ok(())
        })
        .await
        .unwrap();
    }

    #[tokio::test]
    async fn sign_in_tables_have_the_columns_phase_one_sign_in_uses() {
        let db = Db::open_in_memory().unwrap();
        db.call(|conn| {
            conn.execute(
                "INSERT INTO accounts (id, display_name, server_role, created_at, updated_at) VALUES ('a1', 'Ada', 'member', 1, 1)",
                [],
            )?;
            conn.execute(
                "INSERT INTO devices (id, account_id, public_key, name, platform, created_at, last_seen_at, revoked_at) VALUES ('d1', 'a1', 'k1', 'Laptop', 'macos', 1, NULL, NULL)",
                [],
            )?;
            conn.execute(
                "INSERT INTO pending_auth (id, provider_id, client_state, redirect_uri, code_challenge, device_public_key, device_name, platform, setup_code_hash, provider_verifier, provider_nonce, created_at, expires_at) VALUES ('s', 'github', 'client', 'http://127.0.0.1:5000/callback', 'challenge', 'k1', 'Laptop', 'macos', NULL, 'verifier', 'nonce', 1, 600001)",
                [],
            )?;
            conn.execute(
                "INSERT INTO auth_codes (code_hash, account_id, code_challenge, device_public_key, device_name, platform, created_at, expires_at, used_at) VALUES ('c', 'a1', 'challenge', 'k1', 'Laptop', 'macos', 1, 120001, NULL)",
                [],
            )?;
            conn.execute("INSERT INTO nonces (nonce, expires_at) VALUES ('n', 120001)", [])?;
            conn.execute(
                "INSERT INTO refresh_tokens (token_hash, family_id, account_id, device_id, created_at, expires_at) VALUES ('old', 'f1', 'a1', 'd1', 1, 5184000001)",
                [],
            )?;
            conn.execute(
                "INSERT INTO refresh_tokens (token_hash, family_id, account_id, device_id, created_at, expires_at) VALUES ('new', 'f1', 'a1', 'd1', 2, 5184000002)",
                [],
            )?;
            conn.execute(
                "UPDATE refresh_tokens SET rotated_at = 2, replaced_by = 'new', grace_reply = ?1 WHERE token_hash = 'old'",
                params![vec![1u8, 2, 3]],
            )?;
            conn.execute(
                "UPDATE refresh_tokens SET revoked_at = 3 WHERE family_id = 'f1' AND token_hash = 'new'",
                [],
            )?;
            let (family, replaced, reply): (String, String, Vec<u8>) = conn.query_row(
                "SELECT family_id, replaced_by, grace_reply FROM refresh_tokens WHERE token_hash = 'old'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )?;
            assert_eq!(family, "f1");
            assert_eq!(replaced, "new");
            assert_eq!(reply, vec![1, 2, 3]);
            let revoked: Option<i64> = conn.query_row(
                "SELECT revoked_at FROM refresh_tokens WHERE token_hash = 'new'",
                [],
                |row| row.get(0),
            )?;
            assert_eq!(revoked, Some(3));
            let (verifier, nonce): (String, String) = conn.query_row(
                "SELECT provider_verifier, provider_nonce FROM pending_auth WHERE id = 's'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )?;
            assert_eq!((verifier.as_str(), nonce.as_str()), ("verifier", "nonce"));
            assert_eq!(count(conn, "auth_codes"), 1);
            assert_eq!(count(conn, "nonces"), 1);
            Ok(())
        })
        .await
        .unwrap();
    }

    #[tokio::test]
    async fn meta_values_round_trip() {
        let db = Db::open_in_memory().unwrap();
        db.call(|conn| {
            assert_eq!(meta_get(conn, SETUP_CODE_HASH_KEY)?, None);
            meta_set(conn, SETUP_CODE_HASH_KEY, "first")?;
            meta_set(conn, SETUP_CODE_HASH_KEY, "second")?;
            assert_eq!(
                meta_get(conn, SETUP_CODE_HASH_KEY)?.as_deref(),
                Some("second")
            );
            meta_delete(conn, SETUP_CODE_HASH_KEY)?;
            assert_eq!(meta_get(conn, SETUP_CODE_HASH_KEY)?, None);
            Ok(())
        })
        .await
        .unwrap();
    }

    #[test]
    fn parse_id_rejects_non_canonical_ids() {
        let id = ServerId::new_v7();
        assert_eq!(parse_id::<ServerId>(&id.to_string()).unwrap(), id);
        assert!(matches!(
            parse_id::<ServerId>(&id.to_string().to_uppercase()),
            Err(ServerError::Internal(_))
        ));
    }
}
