use oleafly_collab_protocol::auth::{challenge_message, ChallengePurpose, DeviceSummary};
use oleafly_collab_protocol::crypto::{b64url_decode, verify_ed25519};
use oleafly_collab_protocol::ids::{AccountId, DeviceId, ServerId};
use rusqlite::{params, Connection, OptionalExtension};

use crate::auth::{db_error, parse_account, parse_device};
use crate::error::ServerError;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Registered {
    pub device_id: DeviceId,
    pub added: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DeviceRecord {
    pub device_id: DeviceId,
    pub account_id: AccountId,
    pub public_key: String,
    pub revoked: bool,
}

pub fn register(
    conn: &Connection,
    account: AccountId,
    public_key: &str,
    name: &str,
    platform: &str,
    now: i64,
) -> Result<Registered, ServerError> {
    let existing = conn
        .query_row(
            "SELECT id, account_id, revoked_at FROM devices WHERE public_key = ?1",
            params![public_key],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, Option<i64>>(2)?,
                ))
            },
        )
        .optional()
        .map_err(db_error)?;
    match existing {
        Some((id, owner, revoked_at)) => {
            if parse_account(&owner)? != account {
                return Err(ServerError::DeviceInUse);
            }
            conn.execute(
                "UPDATE devices SET name = ?2, platform = ?3, last_seen_at = ?4, revoked_at = NULL \
                 WHERE id = ?1",
                params![id, name, platform, now],
            )
            .map_err(db_error)?;
            Ok(Registered {
                device_id: parse_device(&id)?,
                added: revoked_at.is_some(),
            })
        }
        None => {
            let device_id = DeviceId::new_v7();
            conn.execute(
                "INSERT INTO devices (id, account_id, public_key, name, platform, created_at, \
                 last_seen_at, revoked_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6, NULL)",
                params![
                    device_id.to_string(),
                    account.to_string(),
                    public_key,
                    name,
                    platform,
                    now
                ],
            )
            .map_err(db_error)?;
            Ok(Registered {
                device_id,
                added: true,
            })
        }
    }
}

pub fn find(conn: &Connection, device: DeviceId) -> Result<Option<DeviceRecord>, ServerError> {
    let row = conn
        .query_row(
            "SELECT account_id, public_key, revoked_at FROM devices WHERE id = ?1",
            params![device.to_string()],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, Option<i64>>(2)?,
                ))
            },
        )
        .optional()
        .map_err(db_error)?;
    match row {
        Some((account, public_key, revoked_at)) => Ok(Some(DeviceRecord {
            device_id: device,
            account_id: parse_account(&account)?,
            public_key,
            revoked: revoked_at.is_some(),
        })),
        None => Ok(None),
    }
}

pub fn touch(conn: &Connection, device: DeviceId, now: i64) -> Result<(), ServerError> {
    conn.execute(
        "UPDATE devices SET last_seen_at = ?2 WHERE id = ?1",
        params![device.to_string(), now],
    )
    .map_err(db_error)?;
    Ok(())
}

pub fn signature_valid(
    public_key: &str,
    purpose: ChallengePurpose,
    server_id: ServerId,
    nonce: &str,
    signature: &str,
) -> bool {
    let message = challenge_message(purpose, server_id, nonce);
    match (b64url_decode(public_key), b64url_decode(signature)) {
        (Ok(key), Ok(signature)) => verify_ed25519(&key, &message, &signature),
        _ => false,
    }
}

pub fn list_for_account(
    conn: &Connection,
    account: AccountId,
    current: DeviceId,
) -> Result<Vec<DeviceSummary>, ServerError> {
    let mut statement = conn
        .prepare(
            "SELECT id, name, platform, created_at, last_seen_at FROM devices \
             WHERE account_id = ?1 AND revoked_at IS NULL ORDER BY created_at, id",
        )
        .map_err(db_error)?;
    let rows = statement
        .query_map(params![account.to_string()], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, i64>(3)?,
                row.get::<_, Option<i64>>(4)?,
            ))
        })
        .map_err(db_error)?;
    let mut summaries = Vec::new();
    for row in rows {
        let (id, name, platform, created_at, last_seen_at) = row.map_err(db_error)?;
        let device_id = parse_device(&id)?;
        summaries.push(DeviceSummary {
            device_id,
            name,
            platform,
            created_at,
            last_seen_at,
            current: device_id == current,
        });
    }
    Ok(summaries)
}

#[cfg(test)]
mod tests {
    use oleafly_collab_protocol::roles::ServerRole;

    use super::*;
    use crate::members;
    use crate::test_support::{test_app, TestDevice};

    #[tokio::test]
    async fn a_revoked_key_reactivates_its_row_and_another_account_is_refused() {
        let app = test_app().await;
        let (first, live, reactivated, row, other) = app
            .state
            .db
            .call(|conn| {
                let carol =
                    members::create_account(conn, "Carol", None, ServerRole::Member, 1_000)?;
                let bob = members::create_account(conn, "Bob", None, ServerRole::Member, 1_000)?;
                let first = register(conn, carol, "key-1", "Laptop", "macos", 1_000)?;
                let live = register(conn, carol, "key-1", "Laptop", "macos", 1_500)?;
                conn.execute(
                    "UPDATE devices SET revoked_at = 2000 WHERE id = ?1",
                    params![first.device_id.to_string()],
                )
                .map_err(db_error)?;
                let reactivated = register(conn, carol, "key-1", "Laptop 2", "linux", 3_000)?;
                let row = conn
                    .query_row(
                        "SELECT name, platform, revoked_at FROM devices WHERE id = ?1",
                        params![first.device_id.to_string()],
                        |row| {
                            Ok((
                                row.get::<_, String>(0)?,
                                row.get::<_, String>(1)?,
                                row.get::<_, Option<i64>>(2)?,
                            ))
                        },
                    )
                    .map_err(db_error)?;
                let other = register(conn, bob, "key-1", "Laptop", "macos", 4_000);
                Ok((
                    first,
                    live,
                    reactivated,
                    row,
                    matches!(other, Err(ServerError::DeviceInUse)),
                ))
            })
            .await
            .expect("db");
        assert!(first.added);
        assert!(!live.added);
        assert_eq!(live.device_id, first.device_id);
        assert!(reactivated.added);
        assert_eq!(reactivated.device_id, first.device_id);
        assert_eq!(row, ("Laptop 2".to_owned(), "linux".to_owned(), None));
        assert!(other);
    }

    #[test]
    fn a_signature_is_bound_to_its_purpose_server_and_nonce() {
        let device = TestDevice::generate();
        let server = ServerId::new_v7();
        let signature = device.sign_b64(&challenge_message(
            ChallengePurpose::Token,
            server,
            "nonce-1",
        ));
        let key = device.public_key_b64();
        assert!(signature_valid(
            key,
            ChallengePurpose::Token,
            server,
            "nonce-1",
            &signature
        ));
        assert!(!signature_valid(
            key,
            ChallengePurpose::Refresh,
            server,
            "nonce-1",
            &signature
        ));
        assert!(!signature_valid(
            key,
            ChallengePurpose::Token,
            ServerId::new_v7(),
            "nonce-1",
            &signature
        ));
        assert!(!signature_valid(
            key,
            ChallengePurpose::Token,
            server,
            "nonce-2",
            &signature
        ));
        assert!(!signature_valid(
            "not base64!",
            ChallengePurpose::Token,
            server,
            "nonce-1",
            &signature
        ));
    }
}
