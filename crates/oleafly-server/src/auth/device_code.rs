use oleafly_collab_protocol::ids::AccountId;
use ring::rand::{SecureRandom, SystemRandom};
use rusqlite::{params, Connection, OptionalExtension};

use crate::auth::split_token::{self, constant_time_eq, verifier_matches};
use crate::auth::{db_error, parse_account};
use crate::error::ServerError;
use crate::tokens::hash_token;

pub const CODE_TTL_MS: i64 = 10 * 60 * 1000;
pub const INTERVAL_SECS: u64 = 5;
pub const SLOW_DOWN_SECS: u64 = 5;
pub const APPROVED_GRACE_MS: i64 = 2 * 60 * 1000;
pub const KEEP_EXPIRED_MS: i64 = 60 * 60 * 1000;
pub const WRONG_CODES_PER_IP: u32 = 10;
pub const WINDOW_MS: i64 = 10 * 60 * 1000;
pub const USER_CODE_ALPHABET: &[u8; 20] = b"BCDFGHJKLMNPQRSTVWXZ";
pub const USER_CODE_LENGTH: usize = 8;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Status {
    Pending,
    Approved,
    Denied,
    Refused,
    Used,
}

impl Status {
    fn from_str(text: &str) -> Result<Status, ServerError> {
        match text {
            "pending" => Ok(Status::Pending),
            "approved" => Ok(Status::Approved),
            "denied" => Ok(Status::Denied),
            "refused" => Ok(Status::Refused),
            "used" => Ok(Status::Used),
            other => Err(ServerError::Internal(format!(
                "stored device sign-in status {other} is unknown"
            ))),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NewAuthorization {
    pub device_public_key: String,
    pub device_name: String,
    pub platform: String,
    pub setup_code_hash: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IssuedCodes {
    pub id: String,
    pub device_code: String,
    pub user_code: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Authorization {
    pub id: String,
    pub device_public_key: String,
    pub device_name: String,
    pub platform: String,
    pub setup_code_hash: Option<String>,
    pub status: Status,
    pub account_id: Option<AccountId>,
    pub interval_secs: u64,
    pub expires_at: i64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Pace {
    Steady { interval: u64 },
    TooFast { interval: u64 },
}

const SELECT: &str =
    "SELECT id, device_public_key, device_name, platform, setup_code_hash, status, \
     account_id, interval_secs, expires_at, device_code_hash FROM device_authorizations";

pub fn generate_user_code() -> String {
    let random = SystemRandom::new();
    let mut letters = Vec::with_capacity(USER_CODE_LENGTH);
    let limit = 256 - 256 % USER_CODE_ALPHABET.len();
    while letters.len() < USER_CODE_LENGTH {
        let mut byte = [0u8; 1];
        random
            .fill(&mut byte)
            .expect("the operating system random number generator is available");
        let value = usize::from(byte[0]);
        if value < limit {
            letters.push(char::from(
                USER_CODE_ALPHABET[value % USER_CODE_ALPHABET.len()],
            ));
        }
    }
    format_user_code(&letters)
}

fn format_user_code(letters: &[char]) -> String {
    let (first, second) = letters.split_at(USER_CODE_LENGTH / 2);
    format!(
        "{}-{}",
        first.iter().collect::<String>(),
        second.iter().collect::<String>()
    )
}

pub fn normalize_user_code(input: &str) -> Option<String> {
    if input.chars().count() > 32 {
        return None;
    }
    let mut letters = Vec::with_capacity(USER_CODE_LENGTH);
    for character in input.chars() {
        if character == '-' || character == ' ' {
            continue;
        }
        let upper = character.to_ascii_uppercase();
        if !upper.is_ascii() || !USER_CODE_ALPHABET.contains(&(upper as u8)) {
            return None;
        }
        letters.push(upper);
    }
    (letters.len() == USER_CODE_LENGTH).then(|| format_user_code(&letters))
}

struct Row {
    authorization: Authorization,
    device_code_hash: String,
}

fn row(
    row: &rusqlite::Row<'_>,
) -> rusqlite::Result<(Authorization, Option<String>, String, String)> {
    Ok((
        Authorization {
            id: row.get(0)?,
            device_public_key: row.get(1)?,
            device_name: row.get(2)?,
            platform: row.get(3)?,
            setup_code_hash: row.get(4)?,
            status: Status::Pending,
            account_id: None,
            interval_secs: u64::try_from(row.get::<_, i64>(7)?).unwrap_or(INTERVAL_SECS),
            expires_at: row.get(8)?,
        },
        row.get::<_, Option<String>>(6)?,
        row.get::<_, String>(5)?,
        row.get::<_, String>(9)?,
    ))
}

fn query(conn: &Connection, filter: &str, value: &str) -> Result<Option<Row>, ServerError> {
    let found = conn
        .query_row(
            &format!("{SELECT} WHERE {filter} = ?1"),
            params![value],
            row,
        )
        .optional()
        .map_err(db_error)?;
    let Some((mut authorization, account, status, device_code_hash)) = found else {
        return Ok(None);
    };
    authorization.status = Status::from_str(&status)?;
    authorization.account_id = account.as_deref().map(parse_account).transpose()?;
    Ok(Some(Row {
        authorization,
        device_code_hash,
    }))
}

pub fn create(
    conn: &Connection,
    new: &NewAuthorization,
    now: i64,
) -> Result<IssuedCodes, ServerError> {
    conn.execute(
        "DELETE FROM device_authorizations WHERE expires_at <= ?1",
        params![now - KEEP_EXPIRED_MS],
    )
    .map_err(db_error)?;
    for _ in 0..8 {
        let split = split_token::generate();
        let user_code = generate_user_code();
        let inserted = conn.execute(
            "INSERT OR IGNORE INTO device_authorizations (id, device_code_hash, user_code_hash, device_public_key, \
             device_name, platform, setup_code_hash, status, account_id, interval_secs, last_polled_at, created_at, expires_at) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'pending', NULL, ?8, NULL, ?9, ?10)",
            params![
                split.selector,
                split.verifier_hash,
                hash_token(&user_code),
                new.device_public_key,
                new.device_name,
                new.platform,
                new.setup_code_hash,
                i64::try_from(INTERVAL_SECS).unwrap_or(5),
                now,
                now + CODE_TTL_MS
            ],
        )
        .map_err(db_error)?;
        if inserted == 1 {
            return Ok(IssuedCodes {
                id: split.selector,
                device_code: split.token,
                user_code,
            });
        }
    }
    Err(ServerError::Internal(
        "could not find a free sign-in code".to_string(),
    ))
}

fn pending_only(found: Option<Row>, now: i64) -> Option<Authorization> {
    found.map(|row| row.authorization).filter(|authorization| {
        authorization.status == Status::Pending && authorization.expires_at > now
    })
}

pub fn find_pending_by_user_code(
    conn: &Connection,
    user_code: &str,
    now: i64,
) -> Result<Option<Authorization>, ServerError> {
    let Some(normalized) = normalize_user_code(user_code) else {
        return Ok(None);
    };
    Ok(pending_only(
        query(conn, "user_code_hash", &hash_token(&normalized))?,
        now,
    ))
}

pub fn find_pending(
    conn: &Connection,
    id: &str,
    now: i64,
) -> Result<Option<Authorization>, ServerError> {
    Ok(pending_only(query(conn, "id", id)?, now))
}

pub fn user_code_matches(
    conn: &Connection,
    id: &str,
    typed: &str,
    now: i64,
) -> Result<bool, ServerError> {
    let Some(normalized) = normalize_user_code(typed) else {
        return Ok(false);
    };
    let stored: Option<String> = conn
        .query_row(
            "SELECT user_code_hash FROM device_authorizations \
             WHERE id = ?1 AND status = 'pending' AND expires_at > ?2",
            params![id, now],
            |row| row.get(0),
        )
        .optional()
        .map_err(db_error)?;
    Ok(stored
        .is_some_and(|hash| constant_time_eq(hash.as_bytes(), hash_token(&normalized).as_bytes())))
}

pub fn find_by_device_code(
    conn: &Connection,
    device_code: &str,
) -> Result<Option<Authorization>, ServerError> {
    let Some((selector, verifier)) = split_token::parse(device_code) else {
        return Ok(None);
    };
    Ok(query(conn, "id", selector)?
        .filter(|row| verifier_matches(verifier, &row.device_code_hash))
        .map(|row| row.authorization))
}

pub fn approve(
    conn: &Connection,
    id: &str,
    account: AccountId,
    now: i64,
) -> Result<bool, ServerError> {
    let changed = conn
        .execute(
            "UPDATE device_authorizations SET status = 'approved', account_id = ?2, expires_at = MAX(expires_at, ?4) \
             WHERE id = ?1 AND status = 'pending' AND expires_at > ?3",
            params![id, account.to_string(), now, now + APPROVED_GRACE_MS],
        )
        .map_err(db_error)?;
    Ok(changed == 1)
}

pub fn deny(conn: &Connection, id: &str, now: i64) -> Result<bool, ServerError> {
    let changed = conn
        .execute(
            "UPDATE device_authorizations SET status = 'denied' WHERE id = ?1 AND status = 'pending' AND expires_at > ?2",
            params![id, now],
        )
        .map_err(db_error)?;
    Ok(changed == 1)
}

pub fn refuse(conn: &Connection, id: &str) -> Result<(), ServerError> {
    conn.execute(
        "UPDATE device_authorizations SET status = 'refused' WHERE id = ?1 AND status = 'pending'",
        params![id],
    )
    .map_err(db_error)?;
    Ok(())
}

pub fn record_poll(conn: &Connection, id: &str, now: i64) -> Result<Pace, ServerError> {
    let (interval, last): (i64, Option<i64>) = conn
        .query_row(
            "SELECT interval_secs, last_polled_at FROM device_authorizations WHERE id = ?1",
            params![id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map_err(db_error)?;
    let too_fast = last.is_some_and(|last| now - last < interval * 1000);
    let interval = if too_fast {
        interval + i64::try_from(SLOW_DOWN_SECS).unwrap_or(5)
    } else {
        interval
    };
    conn.execute(
        "UPDATE device_authorizations SET interval_secs = ?2, last_polled_at = ?3 WHERE id = ?1",
        params![id, interval, now],
    )
    .map_err(db_error)?;
    let interval = u64::try_from(interval).unwrap_or(INTERVAL_SECS);
    Ok(if too_fast {
        Pace::TooFast { interval }
    } else {
        Pace::Steady { interval }
    })
}

pub fn mark_used(conn: &Connection, id: &str) -> Result<bool, ServerError> {
    let changed = conn
        .execute(
            "UPDATE device_authorizations SET status = 'used' WHERE id = ?1 AND status = 'approved'",
            params![id],
        )
        .map_err(db_error)?;
    Ok(changed == 1)
}

#[cfg(test)]
mod tests {
    use oleafly_collab_protocol::roles::ServerRole;

    use super::*;
    use crate::db::Db;
    use crate::members;

    fn request() -> NewAuthorization {
        NewAuthorization {
            device_public_key: "key-1".to_string(),
            device_name: "Lab PC".to_string(),
            platform: "linux".to_string(),
            setup_code_hash: None,
        }
    }

    #[test]
    fn user_codes_are_two_groups_of_four_unambiguous_letters() {
        for _ in 0..50 {
            let code = generate_user_code();
            assert_eq!(code.len(), 9, "{code}");
            assert_eq!(&code[4..5], "-");
            assert!(code
                .bytes()
                .filter(|byte| *byte != b'-')
                .all(|byte| USER_CODE_ALPHABET.contains(&byte)));
        }
        assert_ne!(generate_user_code(), generate_user_code());
    }

    #[test]
    fn typed_codes_are_forgiving_about_case_spaces_and_dashes() {
        assert_eq!(
            normalize_user_code("bcdf-ghjk").as_deref(),
            Some("BCDF-GHJK")
        );
        assert_eq!(
            normalize_user_code(" BCDF GHJK ").as_deref(),
            Some("BCDF-GHJK")
        );
        assert_eq!(
            normalize_user_code("bcdfghjk").as_deref(),
            Some("BCDF-GHJK")
        );
        for bad in [
            "",
            "BCDF-GHJ",
            "BCDF-GHJKL",
            "ABCD-EFGH",
            "BCDF-GHJ1",
            "BCDF–GHJK",
        ] {
            assert_eq!(normalize_user_code(bad), None, "{bad}");
        }
    }

    #[tokio::test]
    async fn codes_are_found_while_pending_and_stored_only_as_hashes() {
        Db::open_in_memory()
            .unwrap()
            .call(|conn| {
                let issued = create(conn, &request(), 1_000)?;
                let typed = issued.user_code.to_lowercase().replace('-', " ");
                let found = find_pending_by_user_code(conn, &typed, 2_000)?.expect("found");
                assert_eq!(found.id, issued.id);
                assert_eq!(found.device_name, "Lab PC");
                assert_eq!(found.status, Status::Pending);
                assert_eq!(found.interval_secs, INTERVAL_SECS);
                assert_eq!(
                    find_by_device_code(conn, &issued.device_code)?.map(|found| found.id),
                    Some(issued.id.clone())
                );
                let forged = format!("{}.{}", issued.id, crate::tokens::random_token());
                assert_eq!(find_by_device_code(conn, &forged)?, None);
                assert_eq!(
                    find_pending_by_user_code(conn, &issued.user_code, 1_000 + CODE_TTL_MS)?,
                    None
                );
                let (device_hash, user_hash): (String, String) = conn.query_row(
                    "SELECT device_code_hash, user_code_hash FROM device_authorizations",
                    [],
                    |row| Ok((row.get(0)?, row.get(1)?)),
                )?;
                assert!(!issued.device_code.contains(&device_hash));
                assert_ne!(user_hash, issued.user_code);
                assert_eq!(user_hash, hash_token(&issued.user_code));
                Ok(())
            })
            .await
            .unwrap();
    }

    #[tokio::test]
    async fn only_a_pending_unexpired_code_can_be_approved_or_denied() {
        Db::open_in_memory()
            .unwrap()
            .call(|conn| {
                let account = members::create_account(conn, "Ada", None, ServerRole::Member, 1)?;
                let first = create(conn, &request(), 1_000)?;
                assert!(approve(conn, &first.id, account, 2_000)?);
                assert!(!approve(conn, &first.id, account, 2_000)?);
                assert!(!deny(conn, &first.id, 2_000)?);
                let approved = find_by_device_code(conn, &first.device_code)?.expect("row");
                assert_eq!(approved.status, Status::Approved);
                assert_eq!(approved.account_id, Some(account));
                assert!(approved.expires_at >= 2_000 + APPROVED_GRACE_MS);
                assert_eq!(
                    find_pending_by_user_code(conn, &first.user_code, 2_000)?,
                    None
                );
                assert!(mark_used(conn, &first.id)?);
                assert!(!mark_used(conn, &first.id)?);
                let late = create(conn, &request(), 1_000)?;
                assert!(!approve(conn, &late.id, account, 1_000 + CODE_TTL_MS)?);
                let denied = create(conn, &request(), 1_000)?;
                assert!(deny(conn, &denied.id, 2_000)?);
                assert_eq!(
                    find_by_device_code(conn, &denied.device_code)?.map(|row| row.status),
                    Some(Status::Denied)
                );
                let refused = create(conn, &request(), 1_000)?;
                refuse(conn, &refused.id)?;
                assert_eq!(find_pending(conn, &refused.id, 2_000)?, None);
                Ok(())
            })
            .await
            .unwrap();
    }

    #[tokio::test]
    async fn a_typed_code_matches_only_its_own_pending_sign_in() {
        Db::open_in_memory()
            .unwrap()
            .call(|conn| {
                let mine = create(conn, &request(), 1_000)?;
                let other = create(conn, &request(), 1_000)?;
                let typed = mine.user_code.to_lowercase().replace('-', " ");
                assert!(user_code_matches(conn, &mine.id, &typed, 2_000)?);
                assert!(!user_code_matches(conn, &mine.id, &other.user_code, 2_000)?);
                assert!(!user_code_matches(conn, &other.id, &mine.user_code, 2_000)?);
                assert!(!user_code_matches(conn, &mine.id, "", 2_000)?);
                assert!(!user_code_matches(conn, "missing", &mine.user_code, 2_000)?);
                assert!(!user_code_matches(
                    conn,
                    &mine.id,
                    &mine.user_code,
                    1_000 + CODE_TTL_MS
                )?);
                assert!(deny(conn, &mine.id, 2_000)?);
                assert!(!user_code_matches(conn, &mine.id, &mine.user_code, 2_000)?);
                Ok(())
            })
            .await
            .unwrap();
    }

    #[tokio::test]
    async fn polling_faster_than_the_interval_slows_the_device_down() {
        Db::open_in_memory()
            .unwrap()
            .call(|conn| {
                let issued = create(conn, &request(), 0)?;
                let paces = vec![
                    record_poll(conn, &issued.id, 1_000)?,
                    record_poll(conn, &issued.id, 2_000)?,
                    record_poll(conn, &issued.id, 12_000)?,
                    record_poll(conn, &issued.id, 13_000)?,
                    record_poll(conn, &issued.id, 28_000)?,
                ];
                assert_eq!(
                    paces,
                    [
                        Pace::Steady { interval: 5 },
                        Pace::TooFast { interval: 10 },
                        Pace::Steady { interval: 10 },
                        Pace::TooFast { interval: 15 },
                        Pace::Steady { interval: 15 },
                    ]
                );
                Ok(())
            })
            .await
            .unwrap();
    }
}
