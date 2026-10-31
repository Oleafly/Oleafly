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
pub const REPLAY_MS: i64 = 7 * 24 * 60 * 60 * 1000;
const FAMILY_SEPARATOR: char = '.';

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
    let refresh_token = format!("{family}{FAMILY_SEPARATOR}{}", random_token());
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
        return reuse_of_forgotten(conn, presented, device, now);
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
            conn.execute(
                "DELETE FROM refresh_tokens WHERE family_id = ?1 AND rotated_at IS NOT NULL \
                 AND token_hash != ?2",
                params![stored.family_id, hash],
            )
            .map_err(db_error)?;
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
            let recent = now.saturating_sub(rotated_at) <= REPLAY_MS;
            if recent && successor_unused(conn, stored.replaced_by.as_deref(), now)? {
                let replay = stored
                    .grace_reply
                    .as_deref()
                    .and_then(|blob| open_reply(presented, blob));
                if let Some(mut tokens) = replay {
                    if tokens.access_expires_at <= now {
                        let (access_token, access_expires_at) =
                            issue_access_token(conn, account, device, now)?;
                        tokens.access_token = access_token;
                        tokens.access_expires_at = access_expires_at;
                    }
                    return Ok(RefreshOutcome::Replayed(tokens));
                }
            }
            Ok(RefreshOutcome::Reused {
                family_id: stored.family_id,
            })
        }
    }
}

fn reuse_of_forgotten(
    conn: &Connection,
    presented: &str,
    device: DeviceId,
    now: i64,
) -> Result<RefreshOutcome, ServerError> {
    let Some((family, _)) = presented
        .split_once(FAMILY_SEPARATOR)
        .filter(|(family, secret)| !family.is_empty() && !secret.is_empty())
    else {
        return Ok(RefreshOutcome::Invalid);
    };
    let alive: bool = conn
        .query_row(
            "SELECT EXISTS (SELECT 1 FROM refresh_tokens WHERE family_id = ?1 AND device_id = ?2 \
             AND revoked_at IS NULL AND expires_at > ?3)",
            params![family, device.to_string(), now],
            |row| row.get(0),
        )
        .map_err(db_error)?;
    Ok(if alive {
        RefreshOutcome::Reused {
            family_id: family.to_owned(),
        }
    } else {
        RefreshOutcome::Invalid
    })
}

fn successor_unused(
    conn: &Connection,
    successor: Option<&str>,
    now: i64,
) -> Result<bool, ServerError> {
    let Some(successor) = successor else {
        return Ok(false);
    };
    let state = conn
        .query_row(
            "SELECT rotated_at, revoked_at, expires_at FROM refresh_tokens WHERE token_hash = ?1",
            params![successor],
            |row| {
                Ok((
                    row.get::<_, Option<i64>>(0)?,
                    row.get::<_, Option<i64>>(1)?,
                    row.get::<_, i64>(2)?,
                ))
            },
        )
        .optional()
        .map_err(db_error)?;
    Ok(matches!(state, Some((None, None, expires_at)) if expires_at > now))
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

const REFRESH_GRACE: &[u8] = b"oleafly-refresh-grace";

fn reply_key(purpose: &[u8], presented: &str) -> Result<LessSafeKey, ServerError> {
    let mut material = purpose.to_vec();
    material.push(0);
    material.extend_from_slice(presented.as_bytes());
    let key = digest(&SHA256, &material);
    UnboundKey::new(&AES_256_GCM, key.as_ref())
        .map(LessSafeKey::new)
        .map_err(|_| ServerError::Internal("could not derive the grace key".to_owned()))
}

pub fn seal_reply(presented: &str, tokens: &SessionTokens) -> Result<Vec<u8>, ServerError> {
    seal_reply_for(REFRESH_GRACE, presented, tokens)
}

pub fn open_reply(presented: &str, blob: &[u8]) -> Option<SessionTokens> {
    open_reply_for(REFRESH_GRACE, presented, blob)
}

pub fn seal_reply_for(
    purpose: &[u8],
    presented: &str,
    tokens: &SessionTokens,
) -> Result<Vec<u8>, ServerError> {
    let key = reply_key(purpose, presented)?;
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

pub fn open_reply_for(purpose: &[u8], presented: &str, blob: &[u8]) -> Option<SessionTokens> {
    if blob.len() <= NONCE_LEN {
        return None;
    }
    let key = reply_key(purpose, presented).ok()?;
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
    async fn rotation_replays_while_the_successor_is_unused_and_flags_reuse_after_it() {
        let app = test_app().await;
        let later = 2_000 + REPLAY_MS;
        let (rotated, replayed, reused) = app
            .state
            .db
            .call(move |conn| {
                let account =
                    members::create_account(conn, "Carol", None, ServerRole::Member, 1_000)?;
                let device =
                    devices::register(conn, account, "key-1", "Laptop", "macos", 1_000)?.device_id;
                let first = issue_session(conn, account, device, 1_000)?;
                let rotated = rotate(conn, &first.refresh_token, device, 2_000)?;
                let replayed = rotate(conn, &first.refresh_token, device, later)?;
                let RefreshOutcome::Rotated(ref pair) = rotated else {
                    panic!("expected a rotation, got {rotated:?}");
                };
                rotate(conn, &pair.refresh_token, device, later + 1)?;
                let reused = rotate(conn, &first.refresh_token, device, later + 2)?;
                Ok((rotated, replayed, reused))
            })
            .await
            .expect("db");
        let RefreshOutcome::Rotated(new_pair) = rotated else {
            panic!("expected a rotation");
        };
        match replayed {
            RefreshOutcome::Replayed(pair) => {
                assert_eq!(pair.refresh_token, new_pair.refresh_token);
                assert!(pair.access_expires_at > later);
            }
            other => panic!("expected a replay, got {other:?}"),
        }
        assert!(matches!(reused, RefreshOutcome::Reused { .. }));
    }

    #[tokio::test]
    async fn the_previous_token_is_replayed_for_a_week_after_its_rotation() {
        let app = test_app().await;
        let (inside, outside) = app
            .state
            .db
            .call(|conn| {
                let account =
                    members::create_account(conn, "Carol", None, ServerRole::Member, 1_000)?;
                let device =
                    devices::register(conn, account, "key-1", "Laptop", "macos", 1_000)?.device_id;
                let first = issue_session(conn, account, device, 1_000)?;
                rotate(conn, &first.refresh_token, device, 2_000)?;
                let inside = rotate(conn, &first.refresh_token, device, 2_000 + REPLAY_MS - 1)?;
                let outside = rotate(conn, &first.refresh_token, device, 2_000 + REPLAY_MS + 1)?;
                Ok((inside, outside))
            })
            .await
            .expect("db");
        assert!(matches!(inside, RefreshOutcome::Replayed(_)), "{inside:?}");
        assert!(
            matches!(outside, RefreshOutcome::Reused { .. }),
            "{outside:?}"
        );
    }

    #[tokio::test]
    async fn an_expired_successor_is_not_replayed() {
        let app = test_app().await;
        let replayed = app
            .state
            .db
            .call(|conn| {
                let account =
                    members::create_account(conn, "Carol", None, ServerRole::Member, 1_000)?;
                let device =
                    devices::register(conn, account, "key-1", "Laptop", "macos", 1_000)?.device_id;
                let first = issue_session(conn, account, device, 1_000)?;
                rotate(conn, &first.refresh_token, device, 2_000)?;
                rotate(conn, &first.refresh_token, device, 2_000 + REFRESH_TTL_MS)
            })
            .await
            .expect("db");
        assert!(matches!(replayed, RefreshOutcome::Reused { .. }));
    }

    fn family_rows(conn: &Connection, device: DeviceId) -> Result<i64, ServerError> {
        conn.query_row(
            "SELECT COUNT(*) FROM refresh_tokens WHERE device_id = ?1",
            params![device.to_string()],
            |row| row.get(0),
        )
        .map_err(db_error)
    }

    fn chain(
        conn: &Connection,
        device: DeviceId,
        first: &SessionTokens,
        rotations: i64,
    ) -> Result<String, ServerError> {
        let mut current = first.refresh_token.clone();
        for step in 0..rotations {
            match rotate(conn, &current, device, 2_000 + step * 540_000)? {
                RefreshOutcome::Rotated(tokens) => current = tokens.refresh_token,
                other => panic!("expected a rotation, got {other:?}"),
            }
        }
        Ok(current)
    }

    #[tokio::test]
    async fn a_device_that_refreshes_all_day_keeps_only_its_last_two_tokens() {
        let app = test_app().await;
        let (rows, replayed) = app
            .state
            .db
            .call(|conn| {
                let account =
                    members::create_account(conn, "Carol", None, ServerRole::Member, 1_000)?;
                let device =
                    devices::register(conn, account, "key-1", "Laptop", "macos", 1_000)?.device_id;
                let first = issue_session(conn, account, device, 1_000)?;
                let mut previous = first.refresh_token.clone();
                let mut current = first.refresh_token.clone();
                for step in 0..160 {
                    match rotate(conn, &current, device, 2_000 + step * 540_000)? {
                        RefreshOutcome::Rotated(tokens) => {
                            previous = current;
                            current = tokens.refresh_token;
                        }
                        other => panic!("expected a rotation, got {other:?}"),
                    }
                }
                let rows = family_rows(conn, device)?;
                let replayed = rotate(conn, &previous, device, 2_000 + 159 * 540_000 + 1_000)?;
                Ok((rows, replayed))
            })
            .await
            .expect("db");
        assert_eq!(rows, 2);
        assert!(
            matches!(replayed, RefreshOutcome::Replayed(_)),
            "{replayed:?}"
        );
    }

    #[tokio::test]
    async fn a_token_rotated_long_ago_is_still_caught_as_reuse() {
        let app = test_app().await;
        let (reused, family_alive) = app
            .state
            .db
            .call(|conn| {
                let account =
                    members::create_account(conn, "Carol", None, ServerRole::Member, 1_000)?;
                let device =
                    devices::register(conn, account, "key-1", "Laptop", "macos", 1_000)?.device_id;
                let first = issue_session(conn, account, device, 1_000)?;
                let current = chain(conn, device, &first, 40)?;
                let reused = rotate(conn, &first.refresh_token, device, 30_000_000)?;
                if let RefreshOutcome::Reused { family_id } = &reused {
                    revoke_family(conn, family_id, 30_000_000)?;
                }
                let after = rotate(conn, &current, device, 30_000_001)?;
                Ok((reused, matches!(after, RefreshOutcome::Rotated(_))))
            })
            .await
            .expect("db");
        assert!(
            matches!(reused, RefreshOutcome::Reused { .. }),
            "{reused:?}"
        );
        assert!(!family_alive);
    }

    #[tokio::test]
    async fn a_made_up_token_is_invalid_unless_it_names_a_live_family_of_the_same_device() {
        let app = test_app().await;
        let (other_device, unknown_family, same_device) = app
            .state
            .db
            .call(|conn| {
                let account =
                    members::create_account(conn, "Carol", None, ServerRole::Member, 1_000)?;
                let laptop =
                    devices::register(conn, account, "key-1", "Laptop", "macos", 1_000)?.device_id;
                let desktop =
                    devices::register(conn, account, "key-2", "Desktop", "linux", 1_000)?.device_id;
                let first = issue_session(conn, account, laptop, 1_000)?;
                chain(conn, laptop, &first, 3)?;
                let (family, _) = first
                    .refresh_token
                    .split_once('.')
                    .expect("the token names its family");
                let forged = format!("{family}.not-the-secret");
                Ok((
                    rotate(conn, &forged, desktop, 5_000_000)?,
                    rotate(conn, "unknown-family.not-the-secret", laptop, 5_000_000)?,
                    rotate(conn, &forged, laptop, 5_000_000)?,
                ))
            })
            .await
            .expect("db");
        assert!(matches!(other_device, RefreshOutcome::Invalid));
        assert!(matches!(unknown_family, RefreshOutcome::Invalid));
        assert!(matches!(same_device, RefreshOutcome::Reused { .. }));
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
