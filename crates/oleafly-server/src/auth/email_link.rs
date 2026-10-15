use oleafly_collab_protocol::admin::RuntimeSettings;
use oleafly_collab_protocol::capabilities::{ProviderInfo, ProviderKind};
use rusqlite::{params, Connection, OptionalExtension};

use crate::auth::split_token::{self, verifier_matches};
use crate::auth::{db_error, parse_account, pending, ExternalIdentity};
use crate::error::ServerError;
use crate::members;

pub const PROVIDER_ID: &str = "email-link";
pub const ISSUER: &str = "oleafly-email-link";
pub const LABEL: &str = "Email";
pub const LINK_TTL_MS: i64 = 15 * 60 * 1000;
pub const WINDOW_MS: i64 = 15 * 60 * 1000;
pub const MAX_EMAIL_CHARS: usize = 254;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Link {
    Valid { pending_id: String, email: String },
    Used,
    Expired,
    Invalid,
}

pub const HOUR_MS: i64 = 60 * 60 * 1000;
pub const SERVER_LIMIT_KEY: &str = "email-links-server";

pub fn mailbox(address: &str) -> String {
    let address = address.trim().to_lowercase();
    let Some((local, domain)) = address.rsplit_once('@') else {
        return address;
    };
    let local = local.split_once('+').map_or(local, |(base, _)| base);
    match domain {
        "gmail.com" | "googlemail.com" => format!("{}@gmail.com", local.replace('.', "")),
        _ => format!("{local}@{domain}"),
    }
}

pub fn available(mail_configured: bool, runtime: &RuntimeSettings) -> bool {
    mail_configured && runtime.email_link_sign_in
}

pub fn provider_info() -> ProviderInfo {
    ProviderInfo {
        id: PROVIDER_ID.to_string(),
        kind: ProviderKind::EmailLink,
        label: LABEL.to_string(),
    }
}

pub fn with_email_link(mut providers: Vec<ProviderInfo>, available: bool) -> Vec<ProviderInfo> {
    if available {
        providers.push(provider_info());
    }
    providers
}

pub fn issue(
    conn: &Connection,
    pending_id: &str,
    email: &str,
    now: i64,
) -> Result<String, ServerError> {
    conn.execute(
        "DELETE FROM email_link_tokens WHERE expires_at <= ?1 OR (pending_id = ?2 AND used_at IS NULL)",
        params![now - LINK_TTL_MS, pending_id],
    )
    .map_err(db_error)?;
    let split = split_token::generate();
    conn.execute(
        "INSERT INTO email_link_tokens (selector, verifier_hash, pending_id, email, created_at, expires_at, used_at) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, NULL)",
        params![
            split.selector,
            split.verifier_hash,
            pending_id,
            email,
            now,
            now + LINK_TTL_MS
        ],
    )
    .map_err(db_error)?;
    Ok(split.token)
}

fn lookup(conn: &Connection, token: &str, now: i64) -> Result<Link, ServerError> {
    let Some((selector, verifier)) = split_token::parse(token) else {
        return Ok(Link::Invalid);
    };
    let row = conn
        .query_row(
            "SELECT verifier_hash, pending_id, email, expires_at, used_at FROM email_link_tokens WHERE selector = ?1",
            params![selector],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, i64>(3)?,
                    row.get::<_, Option<i64>>(4)?,
                ))
            },
        )
        .optional()
        .map_err(db_error)?;
    Ok(match row {
        Some((hash, _, _, _, _)) if !verifier_matches(verifier, &hash) => Link::Invalid,
        Some((_, _, _, _, Some(_))) => Link::Used,
        Some((_, _, _, expires_at, None)) if expires_at <= now => Link::Expired,
        Some((_, pending_id, email, _, None)) => Link::Valid { pending_id, email },
        None => Link::Invalid,
    })
}

pub fn inspect(conn: &Connection, token: &str, now: i64) -> Result<Link, ServerError> {
    lookup(conn, token, now)
}

pub fn consume(conn: &Connection, token: &str, now: i64) -> Result<Link, ServerError> {
    let found = lookup(conn, token, now)?;
    if !matches!(found, Link::Valid { .. }) {
        return Ok(found);
    }
    let Some((selector, _)) = split_token::parse(token) else {
        return Ok(Link::Invalid);
    };
    let changed = conn
        .execute(
            "UPDATE email_link_tokens SET used_at = ?2 WHERE selector = ?1 AND used_at IS NULL",
            params![selector, now],
        )
        .map_err(db_error)?;
    Ok(if changed == 1 { found } else { Link::Used })
}

pub fn identity(email: &str) -> ExternalIdentity {
    let name = email
        .split_once('@')
        .map_or(email, |(local, _)| local)
        .to_string();
    ExternalIdentity {
        provider_id: PROVIDER_ID.to_string(),
        issuer: ISSUER.to_string(),
        subject: email.to_string(),
        login: None,
        display_name: name,
        avatar_url: None,
        verified_emails: vec![email.to_string()],
    }
}

pub fn link_existing_account(conn: &Connection, email: &str, now: i64) -> Result<(), ServerError> {
    if members::find_account_by_identity(conn, ISSUER, email)?.is_some() {
        return Ok(());
    }
    let mut statement = conn
        .prepare(
            "SELECT DISTINCT e.account_id, a.status FROM account_emails e \
             JOIN accounts a ON a.id = e.account_id WHERE e.email = ?1",
        )
        .map_err(db_error)?;
    let owners = statement
        .query_map(params![email], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(db_error)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(db_error)?;
    let active: Vec<&str> = owners
        .iter()
        .filter(|(_, status)| status == "active")
        .map(|(id, _)| id.as_str())
        .collect();
    let owner = match (active.as_slice(), owners.as_slice()) {
        ([only], _) => *only,
        ([], [(only, _)]) => only.as_str(),
        _ => return Ok(()),
    };
    let account = parse_account(owner)?;
    members::link_identity(conn, account, PROVIDER_ID, ISSUER, email, None, now)
}

pub fn keep_pending_for_link(
    conn: &Connection,
    pending_id: &str,
    now: i64,
) -> Result<(), ServerError> {
    pending::extend(conn, pending_id, now + LINK_TTL_MS)
}

#[cfg(test)]
mod tests {
    use oleafly_collab_protocol::roles::ServerRole;

    use super::*;
    use crate::db::Db;
    use crate::tokens::hash_token;

    fn stored(conn: &Connection) -> Vec<(String, String)> {
        let mut statement = conn
            .prepare("SELECT selector, verifier_hash FROM email_link_tokens")
            .unwrap();
        statement
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap()
    }

    #[tokio::test]
    async fn only_a_hash_of_the_link_secret_is_stored() {
        Db::open_in_memory()
            .unwrap()
            .call(|conn| {
                let token = issue(conn, "pending-1", "ada@uni.edu", 1_000)?;
                let (selector, verifier) = split_token::parse(&token).expect("token");
                let rows = stored(conn);
                assert_eq!(rows.len(), 1);
                assert_eq!(rows[0].0, selector);
                assert_eq!(rows[0].1, hash_token(verifier));
                assert!(!rows[0].1.contains(verifier));
                Ok(())
            })
            .await
            .unwrap();
    }

    #[tokio::test]
    async fn a_link_is_valid_once_and_then_used() {
        Db::open_in_memory()
            .unwrap()
            .call(|conn| {
                let token = issue(conn, "pending-1", "ada@uni.edu", 1_000)?;
                let valid = Link::Valid {
                    pending_id: "pending-1".to_string(),
                    email: "ada@uni.edu".to_string(),
                };
                assert_eq!(inspect(conn, &token, 2_000)?, valid);
                assert_eq!(inspect(conn, &token, 2_000)?, valid);
                assert_eq!(consume(conn, &token, 2_000)?, valid);
                assert_eq!(consume(conn, &token, 2_000)?, Link::Used);
                assert_eq!(inspect(conn, &token, 2_000)?, Link::Used);
                Ok(())
            })
            .await
            .unwrap();
    }

    #[tokio::test]
    async fn a_link_expires_and_a_forged_one_is_invalid() {
        Db::open_in_memory()
            .unwrap()
            .call(|conn| {
                let token = issue(conn, "pending-1", "ada@uni.edu", 1_000)?;
                assert_eq!(consume(conn, &token, 1_000 + LINK_TTL_MS)?, Link::Expired);
                let (selector, _) = split_token::parse(&token).expect("token");
                let forged = format!("{selector}.{}", crate::tokens::random_token());
                assert_eq!(consume(conn, &forged, 2_000)?, Link::Invalid);
                assert_eq!(consume(conn, "nonsense", 2_000)?, Link::Invalid);
                Ok(())
            })
            .await
            .unwrap();
    }

    #[tokio::test]
    async fn a_new_link_for_the_same_sign_in_replaces_the_old_one() {
        Db::open_in_memory()
            .unwrap()
            .call(|conn| {
                let old = issue(conn, "pending-1", "ada@uni.edu", 1_000)?;
                let other = issue(conn, "pending-2", "bob@uni.edu", 1_000)?;
                let new = issue(conn, "pending-1", "ada@uni.edu", 2_000)?;
                assert_eq!(inspect(conn, &old, 3_000)?, Link::Invalid);
                assert!(matches!(inspect(conn, &new, 3_000)?, Link::Valid { .. }));
                assert!(matches!(inspect(conn, &other, 3_000)?, Link::Valid { .. }));
                Ok(())
            })
            .await
            .unwrap();
    }

    #[tokio::test]
    async fn an_address_is_linked_to_its_one_owner_so_a_suspension_or_removal_still_applies() {
        Db::open_in_memory()
            .unwrap()
            .call(|conn| {
                let account = |conn: &Connection, name: &str, email: &str, status: &str| {
                    let id = members::create_account(conn, name, None, ServerRole::Member, 1)?;
                    members::add_verified_emails(conn, id, &[email.to_string()])?;
                    conn.execute(
                        "UPDATE accounts SET status = ?2 WHERE id = ?1",
                        params![id.to_string(), status],
                    )?;
                    Ok::<_, ServerError>(id)
                };
                let ada = account(conn, "Ada", "ada@uni.edu", "active")?;
                account(conn, "Twin", "shared@uni.edu", "active")?;
                account(conn, "Other", "shared@uni.edu", "active")?;
                let paused = account(conn, "Paused", "paused@uni.edu", "suspended")?;
                let gone = account(conn, "Gone", "gone@uni.edu", "removed")?;
                let current = account(conn, "Current", "moved@uni.edu", "active")?;
                account(conn, "Former", "moved@uni.edu", "removed")?;
                account(conn, "Left", "left@uni.edu", "removed")?;
                account(conn, "Also left", "left@uni.edu", "suspended")?;
                for email in [
                    "ada@uni.edu",
                    "shared@uni.edu",
                    "paused@uni.edu",
                    "gone@uni.edu",
                    "moved@uni.edu",
                    "left@uni.edu",
                    "new@uni.edu",
                ] {
                    link_existing_account(conn, email, 5)?;
                }
                let linked = |email: &str| members::find_account_by_identity(conn, ISSUER, email);
                assert_eq!(linked("ada@uni.edu")?, Some(ada));
                assert_eq!(linked("paused@uni.edu")?, Some(paused));
                assert_eq!(linked("gone@uni.edu")?, Some(gone));
                assert_eq!(linked("moved@uni.edu")?, Some(current));
                for email in ["shared@uni.edu", "left@uni.edu", "new@uni.edu"] {
                    assert_eq!(linked(email)?, None, "{email}");
                }
                Ok(())
            })
            .await
            .unwrap();
    }

    #[test]
    fn the_identity_names_the_person_by_the_part_before_the_at() {
        let identity = identity("ada.lovelace@uni.edu");
        assert_eq!(identity.display_name, "ada.lovelace");
        assert_eq!(identity.subject, "ada.lovelace@uni.edu");
        assert_eq!(identity.verified_emails, ["ada.lovelace@uni.edu"]);
        assert_eq!(identity.provider_id, PROVIDER_ID);
        assert_eq!(identity.login, None);
    }

    #[test]
    fn one_mailbox_counts_once_however_its_address_is_written() {
        assert_eq!(mailbox("ada+1@uni.edu"), "ada@uni.edu");
        assert_eq!(mailbox("Ada+lab+2@Uni.EDU"), "ada@uni.edu");
        assert_eq!(
            mailbox("ada.l.ovelace+x@gmail.com"),
            "adalovelace@gmail.com"
        );
        assert_eq!(
            mailbox("ada.lovelace@googlemail.com"),
            "adalovelace@gmail.com"
        );
        assert_eq!(mailbox("ada.lovelace@uni.edu"), "ada.lovelace@uni.edu");
        assert_eq!(mailbox("not an address"), "not an address");
    }

    #[test]
    fn the_option_is_offered_only_with_mail_and_the_switch() {
        let mut runtime = RuntimeSettings::default();
        assert!(!available(true, &runtime));
        runtime.email_link_sign_in = true;
        assert!(available(true, &runtime));
        assert!(!available(false, &runtime));
        let listed = with_email_link(Vec::new(), true);
        assert_eq!(listed, [provider_info()]);
        assert!(with_email_link(Vec::new(), false).is_empty());
    }
}
