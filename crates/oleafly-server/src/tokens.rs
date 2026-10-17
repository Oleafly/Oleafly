use oleafly_collab_protocol::crypto::{b64url_encode, sha256_b64url};
use oleafly_collab_protocol::ids::{AccountId, DeviceId};
use ring::rand::{SecureRandom, SystemRandom};
use rusqlite::{params, Connection, OptionalExtension};

use crate::db::parse_id;
use crate::error::ServerError;

pub const ACCESS_TOKEN_TTL_MS: i64 = 10 * 60 * 1000;
pub const REFRESH_TOKEN_TTL_MS: i64 = 60 * 24 * 60 * 60 * 1000;
pub const AUTH_CODE_TTL_MS: i64 = 120 * 1000;
pub const NONCE_TTL_MS: i64 = 120 * 1000;
pub const PENDING_AUTH_TTL_MS: i64 = 10 * 60 * 1000;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct AccessContext {
    pub account_id: AccountId,
    pub device_id: DeviceId,
}

pub fn random_token() -> String {
    let mut bytes = [0u8; 32];
    SystemRandom::new()
        .fill(&mut bytes)
        .expect("the operating system random number generator is available");
    b64url_encode(&bytes)
}

pub fn hash_token(token: &str) -> String {
    sha256_b64url(token.as_bytes())
}

pub fn issue_access_token(
    conn: &Connection,
    account: AccountId,
    device: DeviceId,
    now: i64,
) -> Result<(String, i64), ServerError> {
    let token = random_token();
    let expires_at = now + ACCESS_TOKEN_TTL_MS;
    conn.execute(
        "INSERT INTO access_tokens (token_hash, account_id, device_id, created_at, expires_at) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![hash_token(&token), account.to_string(), device.to_string(), now, expires_at],
    )?;
    Ok((token, expires_at))
}

pub fn resolve_access_token(
    conn: &Connection,
    token: &str,
    now: i64,
) -> Result<Option<AccessContext>, ServerError> {
    let row = conn
        .query_row(
            "SELECT t.account_id, t.device_id FROM access_tokens t JOIN devices d ON d.id = t.device_id AND d.account_id = t.account_id WHERE t.token_hash = ?1 AND t.expires_at > ?2 AND d.revoked_at IS NULL",
            params![hash_token(token), now],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
        )
        .optional()?;
    match row {
        Some((account, device)) => Ok(Some(AccessContext {
            account_id: parse_id(&account)?,
            device_id: parse_id(&device)?,
        })),
        None => Ok(None),
    }
}

pub fn revoke_device_tokens(conn: &Connection, device: DeviceId) -> Result<(), ServerError> {
    conn.execute(
        "DELETE FROM access_tokens WHERE device_id = ?1",
        [device.to_string()],
    )?;
    Ok(())
}

pub fn sign_out_device(conn: &Connection, device: DeviceId, now: i64) -> Result<(), ServerError> {
    conn.execute(
        "UPDATE devices SET revoked_at = ?2 WHERE id = ?1 AND revoked_at IS NULL",
        rusqlite::params![device.to_string(), now],
    )?;
    revoke_device_tokens(conn, device)?;
    conn.execute(
        "UPDATE refresh_tokens SET revoked_at = ?2, grace_reply = NULL WHERE device_id = ?1 AND revoked_at IS NULL",
        rusqlite::params![device.to_string(), now],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::Db;
    use crate::members;
    use oleafly_collab_protocol::roles::ServerRole;

    fn seed(conn: &Connection) -> (AccountId, DeviceId) {
        let account = members::create_account(conn, "Ada", None, ServerRole::Member, 1).unwrap();
        let device = DeviceId::new_v7();
        conn.execute(
            "INSERT INTO devices (id, account_id, public_key, name, platform, created_at) VALUES (?1, ?2, ?3, 'Laptop', 'macos', 1)",
            params![device.to_string(), account.to_string(), random_token()],
        )
        .unwrap();
        (account, device)
    }

    #[test]
    fn random_tokens_are_32_bytes_of_base64url() {
        let token = random_token();
        assert_eq!(token.len(), 43);
        assert!(token
            .chars()
            .all(|character| character.is_ascii_alphanumeric()
                || character == '-'
                || character == '_'));
        assert_ne!(random_token(), token);
    }

    #[test]
    fn token_hashes_are_sha256_base64url() {
        assert_eq!(
            hash_token("abc"),
            "ungWv48Bz-pBQUDeXa4iI7ADYaOWF3qctBD_YfIAFa0"
        );
    }

    #[tokio::test]
    async fn access_tokens_resolve_until_they_expire_and_only_the_hash_is_stored() {
        Db::open_in_memory()
            .unwrap()
            .call(|conn| {
                let (account, device) = seed(conn);
                let (token, expires_at) = issue_access_token(conn, account, device, 1_000)?;
                assert_eq!(expires_at, 1_000 + ACCESS_TOKEN_TTL_MS);
                let stored: String =
                    conn.query_row("SELECT token_hash FROM access_tokens", [], |row| row.get(0))?;
                assert_eq!(stored, hash_token(&token));
                assert_ne!(stored, token);
                let expected = AccessContext {
                    account_id: account,
                    device_id: device,
                };
                assert_eq!(
                    resolve_access_token(conn, &token, expires_at - 1)?,
                    Some(expected)
                );
                assert_eq!(resolve_access_token(conn, &token, expires_at)?, None);
                assert_eq!(resolve_access_token(conn, "not-a-token", 2_000)?, None);
                Ok(())
            })
            .await
            .unwrap();
    }

    #[tokio::test]
    async fn revoking_device_tokens_drops_only_that_devices_access_tokens() {
        Db::open_in_memory()
            .unwrap()
            .call(|conn| {
                let (account, device) = seed(conn);
                let (other_account, other_device) = seed(conn);
                let (token, _) = issue_access_token(conn, account, device, 0)?;
                let (other, _) = issue_access_token(conn, other_account, other_device, 0)?;
                conn.execute(
                    "INSERT INTO refresh_tokens (token_hash, family_id, account_id, device_id, created_at, expires_at) VALUES ('r', 'f', ?1, ?2, 0, 10)",
                    params![account.to_string(), device.to_string()],
                )?;
                revoke_device_tokens(conn, device)?;
                assert_eq!(resolve_access_token(conn, &token, 1)?, None);
                assert!(resolve_access_token(conn, &other, 1)?.is_some());
                let refresh: i64 = conn.query_row("SELECT COUNT(*) FROM refresh_tokens", [], |row| row.get(0))?;
                assert_eq!(refresh, 1);
                Ok(())
            })
            .await
            .unwrap();
    }

    #[tokio::test]
    async fn a_token_for_a_revoked_device_does_not_resolve() {
        Db::open_in_memory()
            .unwrap()
            .call(|conn| {
                let (account, device) = seed(conn);
                let (token, _) = issue_access_token(conn, account, device, 0)?;
                assert!(resolve_access_token(conn, &token, 1)?.is_some());
                conn.execute(
                    "UPDATE devices SET revoked_at = 1 WHERE id = ?1",
                    [device.to_string()],
                )?;
                assert_eq!(resolve_access_token(conn, &token, 1)?, None);
                Ok(())
            })
            .await
            .unwrap();
    }
}
