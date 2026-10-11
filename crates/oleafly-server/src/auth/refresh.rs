use oleafly_collab_protocol::auth::SessionTokens;
use oleafly_collab_protocol::ids::{AccountId, DeviceId};
use ring::aead::{Aad, LessSafeKey, Nonce, UnboundKey, AES_256_GCM, NONCE_LEN};
use ring::digest::{digest, SHA256};
use ring::rand::{SecureRandom, SystemRandom};
use rusqlite::{params, Connection, OptionalExtension};

use crate::auth::{db_error, parse_account};
use crate::error::ServerError;
use crate::tokens::{hash_token, issue_access_token, random_token};

pub const REFRESH_TTL_MS: i64 = 60 * 24 * 60 * 60 * 1000;
pub const GRACE_MS: i64 = 60_000;

#[derive(Debug)]
pub enum RefreshOutcome {
    Rotated(SessionTokens),
    Replayed(SessionTokens),
    Reused { family_id: String },
    Invalid,
}

struct StoredRefresh {
    family_id: String,
    account_id: String,
    device_id: String,
    expires_at: i64,
    rotated_at: Option<i64>,
    replaced_by: Option<String>,
    revoked_at: Option<i64>,
    grace_reply: Option<Vec<u8>>,
}

pub fn issue_session(
    conn: &Connection,
    account: AccountId,
    device: DeviceId,
    now: i64,
) -> Result<SessionTokens, ServerError> {
    issue_in_family(conn, account, device, &random_token(), now)
}

fn issue_in_family(
    conn: &Connection,
    account: AccountId,
    device: DeviceId,
    family: &str,
    now: i64,
) -> Result<SessionTokens, ServerError> {
    conn.execute(
        "DELETE FROM refresh_tokens WHERE expires_at <= ?1",
        params![now],
    )
    .map_err(db_error)?;
    let (access_token, access_expires_at) = issue_access_token(conn, account, device, now)?;
    let refresh_token = random_token();
    conn.execute(
        "INSERT INTO refresh_tokens (token_hash, family_id, account_id, device_id, created_at, \
         expires_at, rotated_at, replaced_by, revoked_at, grace_reply) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, NULL, NULL, NULL, NULL)",
        params![
            hash_token(&refresh_token),
            family,
            account.to_string(),
            device.to_string(),
            now,
            now + REFRESH_TTL_MS
        ],
    )
    .map_err(db_error)?;
    Ok(SessionTokens {
        account_id: account,
        device_id: device,
        access_token,
        access_expires_at,
        refresh_token,
    })
}

pub fn rotate(
    conn: &Connection,
    presented: &str,
    device: DeviceId,
    now: i64,
) -> Result<RefreshOutcome, ServerError> {
    let hash = hash_token(presented);
    let stored = conn
        .query_row(
            "SELECT family_id, account_id, device_id, expires_at, rotated_at, replaced_by, \
             revoked_at, grace_reply FROM refresh_tokens WHERE token_hash = ?1",
            params![hash],
            |row| {
                Ok(StoredRefresh {
                    family_id: row.get(0)?,
                    account_id: row.get(1)?,
                    device_id: row.get(2)?,
                    expires_at: row.get(3)?,
                    rotated_at: row.get(4)?,
                    replaced_by: row.get(5)?,
                    revoked_at: row.get(6)?,
                    grace_reply: row.get(7)?,
                })
            },
        )
        .optional()
        .map_err(db_error)?;
    let Some(stored) = stored else {
        return Ok(RefreshOutcome::Invalid);
    };
    if stored.device_id != device.to_string() || stored.revoked_at.is_some() {
        return Ok(RefreshOutcome::Invalid);
    }
    let account = parse_account(&stored.account_id)?;
    match stored.rotated_at {
        None => {
            if stored.expires_at <= now {
                return Ok(RefreshOutcome::Invalid);
            }
            let tokens = issue_in_family(conn, account, device, &stored.family_id, now)?;
            let reply = seal_reply(presented, &tokens)?;
            conn.execute(
                "UPDATE refresh_tokens SET rotated_at = ?2, replaced_by = ?3, grace_reply = ?4 \
                 WHERE token_hash = ?1",
                params![hash, now, hash_token(&tokens.refresh_token), reply],
            )
            .map_err(db_error)?;
            Ok(RefreshOutcome::Rotated(tokens))
        }
        Some(rotated_at) => {
            let in_grace = now - rotated_at <= GRACE_MS;
            if in_grace && successor_unused(conn, stored.replaced_by.as_deref())? {
                let replay = stored
                    .grace_reply
                    .as_deref()
                    .and_then(|blob| open_reply(presented, blob));
                if let Some(tokens) = replay {
                    return Ok(RefreshOutcome::Replayed(tokens));
                }
            }
            Ok(RefreshOutcome::Reused {
                family_id: stored.family_id,
            })
        }
    }
}

fn successor_unused(conn: &Connection, successor: Option<&str>) -> Result<bool, ServerError> {
    let Some(successor) = successor else {
        return Ok(false);
    };
    let state = conn
        .query_row(
            "SELECT rotated_at, revoked_at FROM refresh_tokens WHERE token_hash = ?1",
            params![successor],
            |row| Ok((row.get::<_, Option<i64>>(0)?, row.get::<_, Option<i64>>(1)?)),
        )
        .optional()
        .map_err(db_error)?;
    Ok(matches!(state, Some((None, None))))
}

pub fn revoke_family(conn: &Connection, family_id: &str, now: i64) -> Result<(), ServerError> {
    conn.execute(
        "UPDATE refresh_tokens SET revoked_at = ?2, grace_reply = NULL \
         WHERE family_id = ?1 AND revoked_at IS NULL",
        params![family_id, now],
    )
    .map_err(db_error)?;
    Ok(())
}

fn reply_key(presented: &str) -> Result<LessSafeKey, ServerError> {
    let mut material = b"oleafly-refresh-grace\0".to_vec();
    material.extend_from_slice(presented.as_bytes());
    let key = digest(&SHA256, &material);
    UnboundKey::new(&AES_256_GCM, key.as_ref())
        .map(LessSafeKey::new)
        .map_err(|_| ServerError::Internal("could not derive the grace key".to_owned()))
}

pub fn seal_reply(presented: &str, tokens: &SessionTokens) -> Result<Vec<u8>, ServerError> {
    let key = reply_key(presented)?;
    let mut nonce = [0u8; NONCE_LEN];
    SystemRandom::new()
        .fill(&mut nonce)
        .map_err(|_| ServerError::Internal("the system random source failed".to_owned()))?;
    let mut sealed =
        serde_json::to_vec(tokens).map_err(|error| ServerError::Internal(error.to_string()))?;
    key.seal_in_place_append_tag(
        Nonce::assume_unique_for_key(nonce),
        Aad::empty(),
        &mut sealed,
    )
    .map_err(|_| ServerError::Internal("could not seal the grace reply".to_owned()))?;
    let mut blob = nonce.to_vec();
    blob.extend_from_slice(&sealed);
    Ok(blob)
}

pub fn open_reply(presented: &str, blob: &[u8]) -> Option<SessionTokens> {
    if blob.len() <= NONCE_LEN {
        return None;
    }
    let key = reply_key(presented).ok()?;
    let (nonce, sealed) = blob.split_at(NONCE_LEN);
    let nonce = Nonce::try_assume_unique_for_key(nonce).ok()?;
    let mut sealed = sealed.to_vec();
    let opened = key.open_in_place(nonce, Aad::empty(), &mut sealed).ok()?;
    serde_json::from_slice(opened).ok()
}

#[cfg(test)]
mod tests {
    use oleafly_collab_protocol::roles::ServerRole;

    use super::*;
    use crate::auth::devices;
    use crate::members;
    use crate::test_support::test_app;

    fn sample() -> SessionTokens {
        SessionTokens {
            account_id: AccountId::new_v7(),
            device_id: DeviceId::new_v7(),
            access_token: "access".to_owned(),
            access_expires_at: 42,
            refresh_token: "refresh".to_owned(),
        }
    }

    #[test]
    fn the_grace_reply_opens_only_with_the_previous_token() {
        let tokens = sample();
        let sealed = seal_reply("previous-token", &tokens).expect("seal");
        assert_eq!(open_reply("previous-token", &sealed), Some(tokens));
        assert_eq!(open_reply("another-token", &sealed), None);
        assert!(!String::from_utf8_lossy(&sealed).contains("refresh"));
    }

    #[tokio::test]
    async fn rotation_replays_inside_the_grace_window_and_flags_reuse_after_it() {
        let app = test_app().await;
        let (rotated, replayed, reused) = app
            .state
            .db
            .call(|conn| {
                let account =
                    members::create_account(conn, "Carol", None, ServerRole::Member, 1_000)?;
                let device =
                    devices::register(conn, account, "key-1", "Laptop", "macos", 1_000)?.device_id;
                let first = issue_session(conn, account, device, 1_000)?;
                let rotated = rotate(conn, &first.refresh_token, device, 2_000)?;
                let replayed = rotate(conn, &first.refresh_token, device, 2_000 + GRACE_MS)?;
                let reused = rotate(conn, &first.refresh_token, device, 2_001 + GRACE_MS)?;
                Ok((rotated, replayed, reused))
            })
            .await
            .expect("db");
        let new_pair = match rotated {
            RefreshOutcome::Rotated(pair) => pair,
            other => panic!("expected a rotation, got {other:?}"),
        };
        assert!(matches!(replayed, RefreshOutcome::Replayed(ref pair) if *pair == new_pair));
        assert!(matches!(reused, RefreshOutcome::Reused { .. }));
    }

    #[tokio::test]
    async fn unknown_and_foreign_tokens_are_invalid() {
        let app = test_app().await;
        let (unknown, foreign) = app
            .state
            .db
            .call(|conn| {
                let account =
                    members::create_account(conn, "Carol", None, ServerRole::Member, 1_000)?;
                let laptop =
                    devices::register(conn, account, "key-1", "Laptop", "macos", 1_000)?.device_id;
                let desktop =
                    devices::register(conn, account, "key-2", "Desktop", "linux", 1_000)?.device_id;
                let tokens = issue_session(conn, account, laptop, 1_000)?;
                Ok((
                    rotate(conn, "nope", laptop, 2_000)?,
                    rotate(conn, &tokens.refresh_token, desktop, 2_000)?,
                ))
            })
            .await
            .expect("db");
        assert!(matches!(unknown, RefreshOutcome::Invalid));
        assert!(matches!(foreign, RefreshOutcome::Invalid));
    }
}
