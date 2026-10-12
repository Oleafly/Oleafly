use oleafly_collab_protocol::ids::AccountId;
use rusqlite::{params, Connection, OptionalExtension};

use crate::auth::{db_error, parse_account};
use crate::error::ServerError;
use crate::tokens::{hash_token, random_token};

pub const PENDING_TTL_MS: i64 = 10 * 60 * 1000;
pub const CODE_TTL_MS: i64 = 2 * 60 * 1000;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PendingSignIn {
    pub id: String,
    pub provider_id: String,
    pub client_state: String,
    pub redirect_uri: String,
    pub code_challenge: String,
    pub device_public_key: String,
    pub device_name: String,
    pub platform: String,
    pub setup_code_hash: Option<String>,
    pub provider_verifier: String,
    pub provider_nonce: String,
    pub expires_at: i64,
    pub device_authorization: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AuthCode {
    pub account_id: AccountId,
    pub code_challenge: String,
    pub device_public_key: String,
    pub device_name: String,
    pub platform: String,
}

pub fn insert(conn: &Connection, pending: &PendingSignIn, now: i64) -> Result<(), ServerError> {
    conn.execute(
        "DELETE FROM pending_auth WHERE expires_at <= ?1",
        params![now],
    )
    .map_err(db_error)?;
    conn.execute(
        "INSERT INTO pending_auth (id, provider_id, client_state, redirect_uri, code_challenge, \
         device_public_key, device_name, platform, setup_code_hash, provider_verifier, \
         provider_nonce, created_at, expires_at, device_authorization) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
        params![
            pending.id,
            pending.provider_id,
            pending.client_state,
            pending.redirect_uri,
            pending.code_challenge,
            pending.device_public_key,
            pending.device_name,
            pending.platform,
            pending.setup_code_hash,
            pending.provider_verifier,
            pending.provider_nonce,
            now,
            pending.expires_at,
            pending.device_authorization
        ],
    )
    .map_err(db_error)?;
    Ok(())
}

fn find(conn: &Connection, id: &str) -> Result<Option<PendingSignIn>, ServerError> {
    conn.query_row(
            "SELECT id, provider_id, client_state, redirect_uri, code_challenge, device_public_key, \
             device_name, platform, setup_code_hash, provider_verifier, provider_nonce, expires_at, \
             device_authorization FROM pending_auth WHERE id = ?1",
            params![id],
            |row| {
                Ok(PendingSignIn {
                    id: row.get(0)?,
                    provider_id: row.get(1)?,
                    client_state: row.get(2)?,
                    redirect_uri: row.get(3)?,
                    code_challenge: row.get(4)?,
                    device_public_key: row.get(5)?,
                    device_name: row.get(6)?,
                    platform: row.get(7)?,
                    setup_code_hash: row.get(8)?,
                    provider_verifier: row.get(9)?,
                    provider_nonce: row.get(10)?,
                    expires_at: row.get(11)?,
                    device_authorization: row.get(12)?,
                })
            },
        )
        .optional()
        .map_err(db_error)
}

pub fn take(conn: &Connection, id: &str, now: i64) -> Result<Option<PendingSignIn>, ServerError> {
    let found = find(conn, id)?;
    conn.execute("DELETE FROM pending_auth WHERE id = ?1", params![id])
        .map_err(db_error)?;
    Ok(found.filter(|pending| pending.expires_at > now))
}

pub fn peek(conn: &Connection, id: &str, now: i64) -> Result<Option<PendingSignIn>, ServerError> {
    Ok(find(conn, id)?.filter(|pending| pending.expires_at > now))
}

pub fn extend(conn: &Connection, id: &str, until: i64) -> Result<(), ServerError> {
    conn.execute(
        "UPDATE pending_auth SET expires_at = MAX(expires_at, ?2) WHERE id = ?1",
        params![id, until],
    )
    .map_err(db_error)?;
    Ok(())
}

pub fn issue_code(
    conn: &Connection,
    pending: &PendingSignIn,
    account: AccountId,
    now: i64,
) -> Result<String, ServerError> {
    let code = random_token();
    conn.execute(
        "INSERT INTO auth_codes (code_hash, account_id, code_challenge, device_public_key, \
         device_name, platform, created_at, expires_at, used_at) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, NULL)",
        params![
            hash_token(&code),
            account.to_string(),
            pending.code_challenge,
            pending.device_public_key,
            pending.device_name,
            pending.platform,
            now,
            now + CODE_TTL_MS
        ],
    )
    .map_err(db_error)?;
    Ok(code)
}

pub fn find_code(conn: &Connection, code: &str, now: i64) -> Result<Option<AuthCode>, ServerError> {
    let row = conn
        .query_row(
            "SELECT account_id, code_challenge, device_public_key, device_name, platform \
             FROM auth_codes WHERE code_hash = ?1 AND used_at IS NULL AND expires_at > ?2",
            params![hash_token(code), now],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, String>(4)?,
                ))
            },
        )
        .optional()
        .map_err(db_error)?;
    match row {
        Some((account, code_challenge, device_public_key, device_name, platform)) => {
            Ok(Some(AuthCode {
                account_id: parse_account(&account)?,
                code_challenge,
                device_public_key,
                device_name,
                platform,
            }))
        }
        None => Ok(None),
    }
}

pub fn mark_code_used(conn: &Connection, code: &str, now: i64) -> Result<bool, ServerError> {
    let changed = conn
        .execute(
            "UPDATE auth_codes SET used_at = ?2 WHERE code_hash = ?1 AND used_at IS NULL",
            params![hash_token(code), now],
        )
        .map_err(db_error)?;
    Ok(changed == 1)
}

#[cfg(test)]
mod tests {
    use oleafly_collab_protocol::roles::ServerRole;

    use super::*;
    use crate::members;
    use crate::test_support::test_app;

    fn sample(now: i64) -> PendingSignIn {
        PendingSignIn {
            id: "pending-1".to_owned(),
            provider_id: "github".to_owned(),
            client_state: "state-1".to_owned(),
            redirect_uri: "http://127.0.0.1:5000/callback".to_owned(),
            code_challenge: "challenge".to_owned(),
            device_public_key: "key".to_owned(),
            device_name: "Laptop".to_owned(),
            platform: "macos".to_owned(),
            setup_code_hash: None,
            provider_verifier: "verifier".to_owned(),
            provider_nonce: "nonce".to_owned(),
            expires_at: now + PENDING_TTL_MS,
            device_authorization: None,
        }
    }

    #[tokio::test]
    async fn a_pending_sign_in_for_a_device_code_remembers_it() {
        let app = test_app().await;
        let mut pending = sample(1_000);
        pending.device_authorization = Some("device-auth-1".to_owned());
        let stored = pending.clone();
        let taken = app
            .state
            .db
            .call(move |conn| {
                insert(conn, &stored, 1_000)?;
                take(conn, "pending-1", 2_000)
            })
            .await
            .expect("db");
        assert_eq!(taken, Some(pending));
    }

    #[tokio::test]
    async fn peeking_leaves_a_pending_sign_in_in_place_until_it_expires() {
        let app = test_app().await;
        let (seen, still_there, late) = app
            .state
            .db
            .call(|conn| {
                insert(conn, &sample(1_000), 1_000)?;
                let seen = peek(conn, "pending-1", 2_000)?;
                let late = peek(conn, "pending-1", 1_000 + PENDING_TTL_MS)?;
                Ok((seen, take(conn, "pending-1", 2_000)?, late))
            })
            .await
            .expect("db");
        assert_eq!(seen, Some(sample(1_000)));
        assert_eq!(still_there, Some(sample(1_000)));
        assert_eq!(late, None);
    }

    #[tokio::test]
    async fn extending_a_pending_sign_in_keeps_it_alive_and_never_shortens_it() {
        let app = test_app().await;
        let later = 1_000 + PENDING_TTL_MS + 5 * 60 * 1000;
        let (kept, shortened) = app
            .state
            .db
            .call(move |conn| {
                insert(conn, &sample(1_000), 1_000)?;
                extend(conn, "pending-1", later)?;
                extend(conn, "pending-1", 2_000)?;
                Ok((
                    peek(conn, "pending-1", later - 1)?.map(|pending| pending.expires_at),
                    take(conn, "pending-1", later)?,
                ))
            })
            .await
            .expect("db");
        assert_eq!(kept, Some(later));
        assert_eq!(shortened, None);
    }

    #[tokio::test]
    async fn a_pending_sign_in_is_taken_once() {
        let app = test_app().await;
        let (first, second) = app
            .state
            .db
            .call(|conn| {
                insert(conn, &sample(1_000), 1_000)?;
                Ok((
                    take(conn, "pending-1", 2_000)?,
                    take(conn, "pending-1", 2_000)?,
                ))
            })
            .await
            .expect("db");
        assert_eq!(first, Some(sample(1_000)));
        assert_eq!(second, None);
    }

    #[tokio::test]
    async fn an_expired_pending_sign_in_is_gone() {
        let app = test_app().await;
        let taken = app
            .state
            .db
            .call(|conn| {
                insert(conn, &sample(1_000), 1_000)?;
                take(conn, "pending-1", 1_000 + PENDING_TTL_MS)
            })
            .await
            .expect("db");
        assert_eq!(taken, None);
    }

    #[tokio::test]
    async fn codes_are_single_use_and_expire() {
        let app = test_app().await;
        let (found, used_again, late) = app
            .state
            .db
            .call(|conn| {
                let account =
                    members::create_account(conn, "Carol", None, ServerRole::Member, 1_000)?;
                let code = issue_code(conn, &sample(1_000), account, 1_000)?;
                let found =
                    find_code(conn, &code, 1_500)?.map(|stored| stored.account_id == account);
                let marked = mark_code_used(conn, &code, 1_500)?;
                let used_again =
                    mark_code_used(conn, &code, 1_600)? || find_code(conn, &code, 1_600)?.is_some();
                let other = issue_code(conn, &sample(1_000), account, 1_000)?;
                let late = find_code(conn, &other, 1_000 + CODE_TTL_MS)?.is_some();
                Ok((found.filter(|_| marked), used_again, late))
            })
            .await
            .expect("db");
        assert_eq!(found, Some(true));
        assert!(!used_again);
        assert!(!late);
    }
}
