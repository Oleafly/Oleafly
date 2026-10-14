use oleafly_collab_protocol::admin::{
    AllowlistEntry, AllowlistMatcher, DomainRule, MemberStatus, MemberSummary, NewAllowlistEntry,
    NewDomainRule,
};
use oleafly_collab_protocol::auth::{AccountSummary, DeviceSummary, SessionEndReason};
use oleafly_collab_protocol::ids::{AccountId, DeviceId};
use oleafly_collab_protocol::roles::ServerRole;
use rusqlite::{params, Connection, OptionalExtension, Params, Row};
use url::Host;

use crate::db::{is_unique_violation, parse_id};
use crate::error::ServerError;

const ALLOWLIST_COLUMNS: &str =
    "id, kind, provider_id, value, server_role, created_at, bound_account";
const DOMAIN_COLUMNS: &str = "id, domain, server_role, created_at";

pub fn role_to_str(role: ServerRole) -> &'static str {
    match role {
        ServerRole::Admin => "admin",
        ServerRole::Maintainer => "maintainer",
        ServerRole::Member => "member",
        ServerRole::Guest => "guest",
        ServerRole::Unknown => "unknown",
    }
}

pub fn role_from_str(text: &str) -> Result<ServerRole, ServerError> {
    match text {
        "admin" => Ok(ServerRole::Admin),
        "maintainer" => Ok(ServerRole::Maintainer),
        "member" => Ok(ServerRole::Member),
        "guest" => Ok(ServerRole::Guest),
        other => Err(ServerError::Internal(format!(
            "unknown stored server role {other}"
        ))),
    }
}

pub fn status_to_str(status: &MemberStatus) -> &'static str {
    match status {
        MemberStatus::Active => "active",
        MemberStatus::Suspended => "suspended",
        MemberStatus::Removed => "removed",
    }
}

pub fn status_from_str(text: &str) -> Result<MemberStatus, ServerError> {
    match text {
        "active" => Ok(MemberStatus::Active),
        "suspended" => Ok(MemberStatus::Suspended),
        "removed" => Ok(MemberStatus::Removed),
        other => Err(ServerError::Internal(format!(
            "unknown stored member status {other}"
        ))),
    }
}

pub fn is_staff(role: ServerRole) -> bool {
    matches!(role, ServerRole::Admin | ServerRole::Maintainer)
}

pub fn normalize_email(input: &str) -> Option<String> {
    let email = input.trim().to_lowercase();
    let (local, domain) = email.split_once('@')?;
    if local.is_empty()
        || domain.contains('@')
        || local
            .chars()
            .any(|character| character.is_whitespace() || character.is_control())
    {
        return None;
    }
    let domain = normalize_domain(domain)?;
    Some(format!("{local}@{domain}"))
}

pub fn normalize_domain(input: &str) -> Option<String> {
    let candidate = input
        .trim()
        .trim_start_matches('@')
        .trim_end_matches('.')
        .to_lowercase();
    if candidate.is_empty() {
        return None;
    }
    let Ok(Host::Domain(domain)) = Host::parse(&candidate) else {
        return None;
    };
    let labels_ok = domain.split('.').all(|label| {
        !label.is_empty()
            && label.len() <= 63
            && !label.starts_with('-')
            && !label.ends_with('-')
            && label.chars().all(|character| {
                character.is_ascii_lowercase() || character.is_ascii_digit() || character == '-'
            })
    });
    (labels_ok && domain.contains('.') && domain.len() <= 253).then_some(domain)
}

pub fn normalize_login(input: &str) -> Option<String> {
    let login = input.trim().trim_start_matches('@').to_lowercase();
    let valid = !login.is_empty()
        && login.chars().count() <= 100
        && login
            .chars()
            .all(|character| !character.is_whitespace() && !character.is_control());
    valid.then_some(login)
}

pub fn create_account(
    conn: &Connection,
    display_name: &str,
    avatar_url: Option<&str>,
    role: ServerRole,
    now: i64,
) -> Result<AccountId, ServerError> {
    let id = AccountId::new_v7();
    conn.execute(
        "INSERT INTO accounts (id, display_name, avatar_url, server_role, status, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, 'active', ?5, ?5)",
        params![id.to_string(), display_name, avatar_url, role_to_str(role), now],
    )?;
    Ok(id)
}

pub fn account_summary(
    conn: &Connection,
    account: AccountId,
) -> Result<Option<AccountSummary>, ServerError> {
    let id = account.to_string();
    let row = conn
        .prepare_cached("SELECT display_name, avatar_url, server_role FROM accounts WHERE id = ?1")?
        .query_row([&id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, Option<String>>(1)?,
                row.get::<_, String>(2)?,
            ))
        })
        .optional()?;
    let Some((display_name, avatar_url, role)) = row else {
        return Ok(None);
    };
    Ok(Some(AccountSummary {
        account_id: account,
        display_name,
        avatar_url,
        server_role: role_from_str(&role)?,
        emails: query_strings(
            conn,
            "SELECT email FROM account_emails WHERE account_id = ?1 ORDER BY email LIKE '%@users.noreply.%', email",
            [&id],
        )?,
        logins: query_strings(
            conn,
            "SELECT login FROM identities WHERE account_id = ?1 AND login IS NOT NULL ORDER BY linked_at, login",
            [&id],
        )?,
    }))
}

pub fn account_status(
    conn: &Connection,
    account: AccountId,
) -> Result<Option<MemberStatus>, ServerError> {
    let status: Option<String> = conn
        .query_row(
            "SELECT status FROM accounts WHERE id = ?1",
            [account.to_string()],
            |row| row.get(0),
        )
        .optional()?;
    status.as_deref().map(status_from_str).transpose()
}

pub fn session_end_reason(
    conn: &Connection,
    account: AccountId,
) -> Result<Option<SessionEndReason>, ServerError> {
    Ok(match account_status(conn, account)? {
        Some(MemberStatus::Active) => None,
        Some(MemberStatus::Suspended) => Some(SessionEndReason::AccountSuspended),
        Some(MemberStatus::Removed) | None => Some(SessionEndReason::AccessEnded),
    })
}

pub fn account_role(
    conn: &Connection,
    account: AccountId,
) -> Result<Option<ServerRole>, ServerError> {
    let role: Option<String> = conn
        .query_row(
            "SELECT server_role FROM accounts WHERE id = ?1",
            [account.to_string()],
            |row| row.get(0),
        )
        .optional()?;
    role.as_deref().map(role_from_str).transpose()
}

pub fn member_summary(
    conn: &Connection,
    account: AccountId,
) -> Result<Option<MemberSummary>, ServerError> {
    let Some(summary) = account_summary(conn, account)? else {
        return Ok(None);
    };
    let (status, created_at) = conn.query_row(
        "SELECT status, created_at FROM accounts WHERE id = ?1",
        [account.to_string()],
        |row| Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?)),
    )?;
    Ok(Some(MemberSummary {
        account: summary,
        status: status_from_str(&status)?,
        created_at,
    }))
}

pub fn list_members(conn: &Connection) -> Result<Vec<MemberSummary>, ServerError> {
    let mut listed = Vec::new();
    for id in query_strings(
        conn,
        "SELECT id FROM accounts WHERE status != 'removed' ORDER BY created_at, id",
        [],
    )? {
        if let Some(member) = member_summary(conn, parse_id(&id)?)? {
            listed.push(member);
        }
    }
    Ok(listed)
}

pub fn set_role(
    conn: &Connection,
    account: AccountId,
    role: ServerRole,
    now: i64,
) -> Result<(), ServerError> {
    let changed = conn.execute(
        "UPDATE accounts SET server_role = ?2, updated_at = ?3 WHERE id = ?1",
        params![account.to_string(), role_to_str(role), now],
    )?;
    if changed == 0 {
        return Err(ServerError::NotFound);
    }
    Ok(())
}

pub fn set_status(
    conn: &Connection,
    account: AccountId,
    status: &MemberStatus,
    now: i64,
) -> Result<(), ServerError> {
    let changed = conn.execute(
        "UPDATE accounts SET status = ?2, updated_at = ?3 WHERE id = ?1",
        params![account.to_string(), status_to_str(status), now],
    )?;
    if changed == 0 {
        return Err(ServerError::NotFound);
    }
    Ok(())
}

pub fn reactivate_account(
    conn: &Connection,
    account: AccountId,
    role: ServerRole,
    now: i64,
) -> Result<(), ServerError> {
    let changed = conn.execute(
        "UPDATE accounts SET status = 'active', server_role = ?2, updated_at = ?3 WHERE id = ?1",
        params![account.to_string(), role_to_str(role), now],
    )?;
    if changed == 0 {
        return Err(ServerError::NotFound);
    }
    Ok(())
}

pub fn remove_account(
    conn: &Connection,
    account: AccountId,
    now: i64,
) -> Result<usize, ServerError> {
    set_status(conn, account, &MemberStatus::Removed, now)?;
    Ok(conn.execute(
        "DELETE FROM allowlist WHERE bound_account = ?1",
        [account.to_string()],
    )?)
}

pub fn account_devices(
    conn: &Connection,
    account: AccountId,
) -> Result<Vec<DeviceId>, ServerError> {
    query_strings(
        conn,
        "SELECT id FROM devices WHERE account_id = ?1 AND revoked_at IS NULL ORDER BY created_at, id",
        [account.to_string()],
    )?
    .into_iter()
    .map(|id| parse_id(&id))
    .collect()
}

pub fn device_summaries(
    conn: &Connection,
    account: AccountId,
) -> Result<Vec<DeviceSummary>, ServerError> {
    let mut statement = conn.prepare(
        "SELECT id, name, platform, created_at, last_seen_at FROM devices WHERE account_id = ?1 AND revoked_at IS NULL ORDER BY created_at, id",
    )?;
    let rows = statement
        .query_map([account.to_string()], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, i64>(3)?,
                row.get::<_, Option<i64>>(4)?,
            ))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    rows.into_iter()
        .map(|(id, name, platform, created_at, last_seen_at)| {
            Ok(DeviceSummary {
                device_id: parse_id(&id)?,
                name,
                platform,
                created_at,
                last_seen_at,
                current: false,
            })
        })
        .collect()
}

pub fn device_owner(conn: &Connection, device: DeviceId) -> Result<Option<AccountId>, ServerError> {
    let owner: Option<String> = conn
        .query_row(
            "SELECT account_id FROM devices WHERE id = ?1 AND revoked_at IS NULL",
            [device.to_string()],
            |row| row.get(0),
        )
        .optional()?;
    owner.as_deref().map(parse_id).transpose()
}

pub fn add_verified_emails(
    conn: &Connection,
    account: AccountId,
    emails: &[String],
) -> Result<(), ServerError> {
    let id = account.to_string();
    for email in emails {
        if let Some(normalized) = normalize_email(email) {
            conn.execute(
                "INSERT OR IGNORE INTO account_emails (account_id, email) VALUES (?1, ?2)",
                params![id, normalized],
            )?;
        }
    }
    Ok(())
}

pub fn link_identity(
    conn: &Connection,
    account: AccountId,
    provider_id: &str,
    issuer: &str,
    subject: &str,
    login: Option<&str>,
    now: i64,
) -> Result<(), ServerError> {
    let changed = conn.execute(
        "INSERT INTO identities (issuer, subject, provider_id, account_id, login, linked_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6) ON CONFLICT (issuer, subject) DO UPDATE SET login = excluded.login, provider_id = excluded.provider_id WHERE identities.account_id = excluded.account_id",
        params![issuer, subject, provider_id, account.to_string(), login, now],
    )?;
    if changed == 0 {
        return Err(ServerError::Conflict(
            "That sign-in already belongs to another account on this server.".to_string(),
        ));
    }
    Ok(())
}

pub fn find_account_by_identity(
    conn: &Connection,
    issuer: &str,
    subject: &str,
) -> Result<Option<AccountId>, ServerError> {
    let account: Option<String> = conn
        .query_row(
            "SELECT account_id FROM identities WHERE issuer = ?1 AND subject = ?2",
            [issuer, subject],
            |row| row.get(0),
        )
        .optional()?;
    account.as_deref().map(parse_id).transpose()
}

struct RawAllowlist {
    id: String,
    kind: String,
    provider_id: String,
    value: String,
    role: String,
    created_at: i64,
    bound_account: Option<String>,
}

impl RawAllowlist {
    fn into_entry(self) -> Result<AllowlistEntry, ServerError> {
        let matcher = match self.kind.as_str() {
            "email" => AllowlistMatcher::Email { email: self.value },
            "provider_login" => AllowlistMatcher::ProviderLogin {
                provider: self.provider_id,
                login: self.value,
            },
            other => {
                return Err(ServerError::Internal(format!(
                    "unknown allowlist kind {other}"
                )))
            }
        };
        Ok(AllowlistEntry {
            id: self.id,
            matcher,
            role: role_from_str(&self.role)?,
            created_at: self.created_at,
            bound_account: self.bound_account.as_deref().map(parse_id).transpose()?,
        })
    }
}

fn allowlist_row(row: &Row<'_>) -> rusqlite::Result<RawAllowlist> {
    Ok(RawAllowlist {
        id: row.get(0)?,
        kind: row.get(1)?,
        provider_id: row.get(2)?,
        value: row.get(3)?,
        role: row.get(4)?,
        created_at: row.get(5)?,
        bound_account: row.get(6)?,
    })
}

fn select_allowlist<P: Params>(
    conn: &Connection,
    condition: &str,
    arguments: P,
) -> Result<Vec<AllowlistEntry>, ServerError> {
    let mut statement = conn.prepare(&format!(
        "SELECT {ALLOWLIST_COLUMNS} FROM allowlist {condition}"
    ))?;
    let raw = statement
        .query_map(arguments, allowlist_row)?
        .collect::<Result<Vec<_>, _>>()?;
    raw.into_iter().map(RawAllowlist::into_entry).collect()
}

pub fn list_allowlist(conn: &Connection) -> Result<Vec<AllowlistEntry>, ServerError> {
    select_allowlist(conn, "ORDER BY created_at, id", [])
}

pub fn get_allowlist(conn: &Connection, id: &str) -> Result<Option<AllowlistEntry>, ServerError> {
    Ok(select_allowlist(conn, "WHERE id = ?1", [id])?
        .into_iter()
        .next())
}

pub fn add_allowlist(
    conn: &Connection,
    entry: &NewAllowlistEntry,
    actor: Option<AccountId>,
    now: i64,
) -> Result<AllowlistEntry, ServerError> {
    let (kind, provider, value, key) = match &entry.matcher {
        AllowlistMatcher::Email { email } => {
            let key = normalize_email(email).ok_or_else(|| {
                ServerError::BadRequest("That email address doesn't look right.".to_string())
            })?;
            ("email", String::new(), email.trim().to_string(), key)
        }
        AllowlistMatcher::ProviderLogin { provider, login } => {
            let provider = provider.trim().to_string();
            if provider.is_empty() {
                return Err(ServerError::BadRequest(
                    "Choose a sign-in provider for that name.".to_string(),
                ));
            }
            let key = normalize_login(login).ok_or_else(|| {
                ServerError::BadRequest("That sign-in name doesn't look right.".to_string())
            })?;
            (
                "provider_login",
                provider,
                login.trim().trim_start_matches('@').to_string(),
                key,
            )
        }
    };
    let id = uuid::Uuid::now_v7().to_string();
    let inserted = conn.execute(
        "INSERT INTO allowlist (id, kind, provider_id, value, match_key, server_role, created_at, created_by) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![
            id,
            kind,
            provider,
            value,
            key,
            role_to_str(entry.role),
            now,
            actor.map(|account| account.to_string())
        ],
    );
    match inserted {
        Ok(_) => {}
        Err(error) if is_unique_violation(&error) => {
            return Err(ServerError::Conflict(
                "That person is already on the allowlist.".to_string(),
            ))
        }
        Err(error) => return Err(error.into()),
    }
    get_allowlist(conn, &id)?
        .ok_or_else(|| ServerError::Internal("the new allowlist entry was not stored".to_string()))
}

pub fn remove_allowlist(conn: &Connection, id: &str) -> Result<bool, ServerError> {
    Ok(conn.execute("DELETE FROM allowlist WHERE id = ?1", [id])? > 0)
}

pub fn find_allowlist_by_email(
    conn: &Connection,
    email: &str,
) -> Result<Option<AllowlistEntry>, ServerError> {
    let Some(key) = normalize_email(email) else {
        return Ok(None);
    };
    Ok(
        select_allowlist(conn, "WHERE kind = 'email' AND match_key = ?1", [key])?
            .into_iter()
            .next(),
    )
}

pub fn find_allowlist_by_login(
    conn: &Connection,
    provider: &str,
    login: &str,
) -> Result<Option<AllowlistEntry>, ServerError> {
    let Some(key) = normalize_login(login) else {
        return Ok(None);
    };
    Ok(select_allowlist(
        conn,
        "WHERE kind = 'provider_login' AND provider_id = ?1 AND match_key = ?2",
        [provider.trim(), key.as_str()],
    )?
    .into_iter()
    .next())
}

pub fn bind_allowlist(
    conn: &Connection,
    entry_id: &str,
    account: AccountId,
) -> Result<(), ServerError> {
    let changed = conn.execute(
        "UPDATE allowlist SET bound_account = ?2 WHERE id = ?1 AND (bound_account IS NULL OR bound_account = ?2)",
        params![entry_id, account.to_string()],
    )?;
    if changed > 0 {
        return Ok(());
    }
    if get_allowlist(conn, entry_id)?.is_some() {
        Err(ServerError::Conflict(
            "That allowlist entry already belongs to another account.".to_string(),
        ))
    } else {
        Err(ServerError::NotFound)
    }
}

fn domain_row(row: &Row<'_>) -> rusqlite::Result<(String, String, String, i64)> {
    Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?))
}

fn select_domain_rules<P: Params>(
    conn: &Connection,
    condition: &str,
    arguments: P,
) -> Result<Vec<DomainRule>, ServerError> {
    let mut statement = conn.prepare(&format!(
        "SELECT {DOMAIN_COLUMNS} FROM domain_rules {condition}"
    ))?;
    let raw = statement
        .query_map(arguments, domain_row)?
        .collect::<Result<Vec<_>, _>>()?;
    raw.into_iter()
        .map(|(id, domain, role, created_at)| {
            Ok(DomainRule {
                id,
                domain,
                role: role_from_str(&role)?,
                created_at,
            })
        })
        .collect()
}

pub fn list_domain_rules(conn: &Connection) -> Result<Vec<DomainRule>, ServerError> {
    select_domain_rules(conn, "ORDER BY created_at, id", [])
}

pub fn get_domain_rule(conn: &Connection, id: &str) -> Result<Option<DomainRule>, ServerError> {
    Ok(select_domain_rules(conn, "WHERE id = ?1", [id])?
        .into_iter()
        .next())
}

pub fn add_domain_rule(
    conn: &Connection,
    rule: &NewDomainRule,
    actor: Option<AccountId>,
    now: i64,
) -> Result<DomainRule, ServerError> {
    let domain = normalize_domain(&rule.domain).ok_or_else(|| {
        ServerError::BadRequest(
            "That isn't a domain name. Use a form like cs.example.edu.".to_string(),
        )
    })?;
    if !matches!(rule.role, ServerRole::Member | ServerRole::Guest) {
        return Err(ServerError::BadRequest(
            "A domain rule can only add members or guests.".to_string(),
        ));
    }
    let id = uuid::Uuid::now_v7().to_string();
    let inserted = conn.execute(
        "INSERT INTO domain_rules (id, domain, server_role, created_at, created_by) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![
            id,
            domain,
            role_to_str(rule.role),
            now,
            actor.map(|account| account.to_string())
        ],
    );
    match inserted {
        Ok(_) => {}
        Err(error) if is_unique_violation(&error) => {
            return Err(ServerError::Conflict(
                "There is already a rule for that domain.".to_string(),
            ))
        }
        Err(error) => return Err(error.into()),
    }
    get_domain_rule(conn, &id)?
        .ok_or_else(|| ServerError::Internal("the new domain rule was not stored".to_string()))
}

pub fn remove_domain_rule(conn: &Connection, id: &str) -> Result<bool, ServerError> {
    Ok(conn.execute("DELETE FROM domain_rules WHERE id = ?1", [id])? > 0)
}

pub fn find_domain_rule(
    conn: &Connection,
    domain: &str,
) -> Result<Option<DomainRule>, ServerError> {
    let Some(normalized) = normalize_domain(domain) else {
        return Ok(None);
    };
    Ok(
        select_domain_rules(conn, "WHERE domain = ?1", [normalized])?
            .into_iter()
            .next(),
    )
}

pub fn count_admins(conn: &Connection) -> Result<u32, ServerError> {
    let count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM accounts WHERE server_role = 'admin' AND status = 'active'",
        [],
        |row| row.get(0),
    )?;
    u32::try_from(count)
        .map_err(|_| ServerError::Internal(format!("admin count {count} is out of range")))
}

fn query_strings<P: Params>(
    conn: &Connection,
    sql: &str,
    arguments: P,
) -> Result<Vec<String>, ServerError> {
    let mut statement = conn.prepare_cached(sql)?;
    let values = statement
        .query_map(arguments, |row| row.get::<_, String>(0))?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(values)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::Db;

    async fn with_db<T: Send + 'static>(
        f: impl FnOnce(&mut Connection) -> Result<T, ServerError> + Send + 'static,
    ) -> T {
        Db::open_in_memory().unwrap().call(f).await.unwrap()
    }

    fn email(address: &str, role: ServerRole) -> NewAllowlistEntry {
        NewAllowlistEntry {
            matcher: AllowlistMatcher::Email {
                email: address.to_string(),
            },
            role,
        }
    }

    fn login(provider: &str, name: &str, role: ServerRole) -> NewAllowlistEntry {
        NewAllowlistEntry {
            matcher: AllowlistMatcher::ProviderLogin {
                provider: provider.to_string(),
                login: name.to_string(),
            },
            role,
        }
    }

    fn rule(domain: &str, role: ServerRole) -> NewDomainRule {
        NewDomainRule {
            domain: domain.to_string(),
            role,
        }
    }

    #[test]
    fn roles_and_statuses_round_trip_through_their_stored_names() {
        for role in [
            ServerRole::Admin,
            ServerRole::Maintainer,
            ServerRole::Member,
            ServerRole::Guest,
        ] {
            assert_eq!(role_from_str(role_to_str(role)).unwrap(), role);
        }
        assert!(role_from_str("owner").is_err());
        for status in [
            MemberStatus::Active,
            MemberStatus::Suspended,
            MemberStatus::Removed,
        ] {
            assert_eq!(status_from_str(status_to_str(&status)).unwrap(), status);
        }
        assert!(is_staff(ServerRole::Admin) && is_staff(ServerRole::Maintainer));
        assert!(!is_staff(ServerRole::Member) && !is_staff(ServerRole::Guest));
    }

    #[test]
    fn normalizers_fold_case_and_reject_junk() {
        assert_eq!(
            normalize_email(" Alice@Uni.EDU ").as_deref(),
            Some("alice@uni.edu")
        );
        for junk in [
            "",
            "alice",
            "@uni.edu",
            "alice@",
            "a@b@uni.edu",
            "alice@localhost",
            "al ice@uni.edu",
        ] {
            assert_eq!(normalize_email(junk), None, "{junk}");
        }
        assert_eq!(normalize_domain("uni.edu.").as_deref(), Some("uni.edu"));
        assert_eq!(
            normalize_domain("@CS.Stanford.EDU").as_deref(),
            Some("cs.stanford.edu")
        );
        assert_eq!(
            normalize_domain("Bücher.de").as_deref(),
            Some("xn--bcher-kva.de")
        );
        for junk in [
            "",
            "uni",
            "-uni.edu",
            "uni..edu",
            "10.0.0.1",
            "uni_lab.edu",
            "not a domain",
        ] {
            assert_eq!(normalize_domain(junk), None, "{junk}");
        }
        assert_eq!(
            normalize_login(" @Alice-Chen ").as_deref(),
            Some("alice-chen")
        );
        assert_eq!(normalize_login("   "), None);
        assert_eq!(normalize_login("two words"), None);
    }

    #[tokio::test]
    async fn a_person_is_shown_with_a_real_address_before_a_github_no_reply_one() {
        with_db(|conn| {
            let account = create_account(conn, "Prajwal", None, ServerRole::Admin, 10)?;
            add_verified_emails(
                conn,
                account,
                &[
                    "53730619+prajwal-svm@users.noreply.github.com".to_string(),
                    "prajwal@uni.edu".to_string(),
                ],
            )?;
            let summary = account_summary(conn, account)?.expect("the account exists");
            assert_eq!(
                summary.emails,
                [
                    "prajwal@uni.edu",
                    "53730619+prajwal-svm@users.noreply.github.com"
                ]
            );
            let person = crate::projects::person(conn, account, true)?.expect("a person");
            assert_eq!(person.email.as_deref(), Some("prajwal@uni.edu"));
            let only_no_reply = create_account(conn, "Bo", None, ServerRole::Member, 11)?;
            add_verified_emails(
                conn,
                only_no_reply,
                &["9+bo@users.noreply.github.com".to_string()],
            )?;
            let person = crate::projects::person(conn, only_no_reply, true)?.expect("a person");
            assert_eq!(
                person.email.as_deref(),
                Some("9+bo@users.noreply.github.com")
            );
            Ok(())
        })
        .await;
    }

    #[tokio::test]
    async fn accounts_report_emails_logins_role_and_status() {
        with_db(|conn| {
            let account = create_account(
                conn,
                "Ada Lovelace",
                Some("https://avatars.example/ada.png"),
                ServerRole::Member,
                10,
            )?;
            add_verified_emails(
                conn,
                account,
                &[
                    "Ada@Uni.EDU".to_string(),
                    "ada@uni.edu".to_string(),
                    "not-an-email".to_string(),
                ],
            )?;
            link_identity(
                conn,
                account,
                "github",
                "https://github.com",
                "583231",
                Some("ada-l"),
                11,
            )?;
            let summary = account_summary(conn, account)?.expect("the account exists");
            assert_eq!(summary.account_id, account);
            assert_eq!(summary.display_name, "Ada Lovelace");
            assert_eq!(
                summary.avatar_url.as_deref(),
                Some("https://avatars.example/ada.png")
            );
            assert_eq!(summary.server_role, ServerRole::Member);
            assert_eq!(summary.emails, ["ada@uni.edu"]);
            assert_eq!(summary.logins, ["ada-l"]);
            assert_eq!(account_status(conn, account)?, Some(MemberStatus::Active));
            assert!(account_summary(conn, AccountId::new_v7())?.is_none());
            assert_eq!(account_status(conn, AccountId::new_v7())?, None);
            Ok(())
        })
        .await;
    }

    #[tokio::test]
    async fn identities_link_to_one_account_and_follow_login_renames() {
        with_db(|conn| {
            let ada = create_account(conn, "Ada", None, ServerRole::Member, 1)?;
            let bob = create_account(conn, "Bob", None, ServerRole::Member, 1)?;
            link_identity(
                conn,
                ada,
                "github",
                "https://github.com",
                "42",
                Some("ada-old"),
                2,
            )?;
            link_identity(
                conn,
                ada,
                "github",
                "https://github.com",
                "42",
                Some("ada-new"),
                3,
            )?;
            assert_eq!(
                find_account_by_identity(conn, "https://github.com", "42")?,
                Some(ada)
            );
            assert_eq!(
                account_summary(conn, ada)?.map(|summary| summary.logins),
                Some(vec!["ada-new".to_string()])
            );
            let taken = link_identity(
                conn,
                bob,
                "github",
                "https://github.com",
                "42",
                Some("bob"),
                4,
            );
            assert!(matches!(taken, Err(ServerError::Conflict(_))));
            assert_eq!(
                find_account_by_identity(conn, "https://gitlab.com", "42")?,
                None
            );
            Ok(())
        })
        .await;
    }

    #[tokio::test]
    async fn allowlist_email_entries_match_without_regard_to_case() {
        with_db(|conn| {
            let entry = add_allowlist(conn, &email("Alice@Uni.EDU", ServerRole::Member), None, 5)?;
            assert!(matches!(&entry.matcher, AllowlistMatcher::Email { email } if email == "Alice@Uni.EDU"));
            for probe in ["alice@uni.edu", "ALICE@UNI.EDU", " Alice@uni.edu "] {
                assert_eq!(
                    find_allowlist_by_email(conn, probe)?.map(|found| found.id),
                    Some(entry.id.clone()),
                    "{probe}"
                );
            }
            assert!(find_allowlist_by_email(conn, "bob@uni.edu")?.is_none());
            assert!(find_allowlist_by_email(conn, "not an email")?.is_none());
            let duplicate = add_allowlist(conn, &email("alice@uni.edu", ServerRole::Admin), None, 6);
            assert!(matches!(duplicate, Err(ServerError::Conflict(_))));
            let invalid = add_allowlist(conn, &email("alice", ServerRole::Member), None, 7);
            assert!(matches!(invalid, Err(ServerError::BadRequest(_))));
            Ok(())
        })
        .await;
    }

    #[tokio::test]
    async fn allowlist_logins_match_without_regard_to_case_within_one_provider() {
        with_db(|conn| {
            let entry = add_allowlist(conn, &login("github", "@Alice-Chen", ServerRole::Member), None, 5)?;
            assert!(matches!(
                &entry.matcher,
                AllowlistMatcher::ProviderLogin { provider, login } if provider == "github" && login == "Alice-Chen"
            ));
            for probe in ["alice-chen", "ALICE-CHEN", "@alice-chen"] {
                assert_eq!(
                    find_allowlist_by_login(conn, "github", probe)?.map(|found| found.id),
                    Some(entry.id.clone()),
                    "{probe}"
                );
            }
            assert!(find_allowlist_by_login(conn, "gitlab", "alice-chen")?.is_none());
            assert!(find_allowlist_by_email(conn, "alice-chen")?.is_none());
            Ok(())
        })
        .await;
    }

    #[tokio::test]
    async fn an_allowlist_entry_binds_to_one_account() {
        with_db(|conn| {
            let ada = create_account(conn, "Ada", None, ServerRole::Member, 1)?;
            let bob = create_account(conn, "Bob", None, ServerRole::Member, 1)?;
            let entry = add_allowlist(conn, &login("github", "ada", ServerRole::Member), None, 1)?;
            bind_allowlist(conn, &entry.id, ada)?;
            bind_allowlist(conn, &entry.id, ada)?;
            assert!(matches!(
                bind_allowlist(conn, &entry.id, bob),
                Err(ServerError::Conflict(_))
            ));
            assert!(matches!(
                bind_allowlist(conn, "missing", bob),
                Err(ServerError::NotFound)
            ));
            assert_eq!(
                get_allowlist(conn, &entry.id)?.and_then(|found| found.bound_account),
                Some(ada)
            );
            Ok(())
        })
        .await;
    }

    #[tokio::test]
    async fn domain_rules_match_without_regard_to_case_and_never_add_staff() {
        with_db(|conn| {
            let created =
                add_domain_rule(conn, &rule("@CS.Stanford.EDU", ServerRole::Member), None, 1)?;
            assert_eq!(created.domain, "cs.stanford.edu");
            assert_eq!(
                find_domain_rule(conn, "cs.STANFORD.edu")?.map(|found| found.id),
                Some(created.id.clone())
            );
            assert!(find_domain_rule(conn, "stanford.edu")?.is_none());
            for role in [ServerRole::Admin, ServerRole::Maintainer] {
                assert!(matches!(
                    add_domain_rule(conn, &rule("uni.edu", role), None, 2),
                    Err(ServerError::BadRequest(_))
                ));
            }
            assert!(matches!(
                add_domain_rule(conn, &rule("not a domain", ServerRole::Member), None, 3),
                Err(ServerError::BadRequest(_))
            ));
            let unicode = add_domain_rule(conn, &rule("Bücher.de", ServerRole::Guest), None, 4)?;
            assert_eq!(unicode.domain, "xn--bcher-kva.de");
            assert!(matches!(
                add_domain_rule(conn, &rule("cs.stanford.edu", ServerRole::Guest), None, 5),
                Err(ServerError::Conflict(_))
            ));
            assert_eq!(list_domain_rules(conn)?.len(), 2);
            assert!(remove_domain_rule(conn, &created.id)?);
            assert!(!remove_domain_rule(conn, &created.id)?);
            Ok(())
        })
        .await;
    }

    #[tokio::test]
    async fn count_admins_counts_active_admins_only() {
        with_db(|conn| {
            assert_eq!(count_admins(conn)?, 0);
            let first = create_account(conn, "Ada", None, ServerRole::Admin, 1)?;
            create_account(conn, "Bob", None, ServerRole::Admin, 1)?;
            create_account(conn, "Cy", None, ServerRole::Maintainer, 1)?;
            assert_eq!(count_admins(conn)?, 2);
            set_status(conn, first, &MemberStatus::Suspended, 2)?;
            assert_eq!(count_admins(conn)?, 1);
            assert_eq!(account_status(conn, first)?, Some(MemberStatus::Suspended));
            Ok(())
        })
        .await;
    }

    #[tokio::test]
    async fn removing_an_account_keeps_it_and_drops_only_its_bound_allowlist_entries() {
        with_db(|conn| {
            let ada = create_account(conn, "Ada", None, ServerRole::Member, 1)?;
            add_verified_emails(conn, ada, &["ada@uni.edu".to_string()])?;
            link_identity(
                conn,
                ada,
                "github",
                "https://github.com",
                "42",
                Some("ada"),
                1,
            )?;
            let bound = add_allowlist(conn, &email("ada@uni.edu", ServerRole::Member), None, 1)?;
            let unbound = add_allowlist(conn, &email("bob@uni.edu", ServerRole::Member), None, 1)?;
            bind_allowlist(conn, &bound.id, ada)?;
            assert_eq!(remove_account(conn, ada, 5)?, 1);
            assert_eq!(account_status(conn, ada)?, Some(MemberStatus::Removed));
            assert_eq!(
                find_account_by_identity(conn, "https://github.com", "42")?,
                Some(ada)
            );
            assert!(get_allowlist(conn, &bound.id)?.is_none());
            assert!(get_allowlist(conn, &unbound.id)?.is_some());
            assert_eq!(
                account_summary(conn, ada)?.map(|summary| summary.emails),
                Some(vec!["ada@uni.edu".to_string()])
            );
            assert!(list_members(conn)?.is_empty());
            assert!(matches!(
                remove_account(conn, AccountId::new_v7(), 6),
                Err(ServerError::NotFound)
            ));
            Ok(())
        })
        .await;
    }

    #[tokio::test]
    async fn an_inactive_account_has_a_reason_its_sessions_ended() {
        with_db(|conn| {
            let ada = create_account(conn, "Ada", None, ServerRole::Member, 1)?;
            assert_eq!(session_end_reason(conn, ada)?, None);
            set_status(conn, ada, &MemberStatus::Suspended, 2)?;
            assert_eq!(
                session_end_reason(conn, ada)?,
                Some(SessionEndReason::AccountSuspended)
            );
            remove_account(conn, ada, 3)?;
            assert_eq!(
                session_end_reason(conn, ada)?,
                Some(SessionEndReason::AccessEnded)
            );
            assert_eq!(
                session_end_reason(conn, AccountId::new_v7())?,
                Some(SessionEndReason::AccessEnded)
            );
            Ok(())
        })
        .await;
    }

    #[tokio::test]
    async fn reactivating_restores_the_same_account_with_a_new_role() {
        with_db(|conn| {
            let ada = create_account(conn, "Ada", None, ServerRole::Member, 1)?;
            remove_account(conn, ada, 2)?;
            reactivate_account(conn, ada, ServerRole::Maintainer, 3)?;
            assert_eq!(account_status(conn, ada)?, Some(MemberStatus::Active));
            assert_eq!(account_role(conn, ada)?, Some(ServerRole::Maintainer));
            let updated_at: i64 = conn.query_row(
                "SELECT updated_at FROM accounts WHERE id = ?1",
                [ada.to_string()],
                |row| row.get(0),
            )?;
            assert_eq!(updated_at, 3);
            assert_eq!(list_members(conn)?.len(), 1);
            assert!(matches!(
                reactivate_account(conn, AccountId::new_v7(), ServerRole::Member, 4),
                Err(ServerError::NotFound)
            ));
            Ok(())
        })
        .await;
    }

    #[tokio::test]
    async fn device_helpers_see_live_devices_only() {
        with_db(|conn| {
            let ada = create_account(conn, "Ada", None, ServerRole::Member, 1)?;
            let (live, revoked) = (DeviceId::new_v7(), DeviceId::new_v7());
            conn.execute(
                "INSERT INTO devices (id, account_id, public_key, name, platform, created_at, last_seen_at) VALUES (?1, ?2, 'k1', 'Laptop', 'macos', 1, 7)",
                params![live.to_string(), ada.to_string()],
            )?;
            conn.execute(
                "INSERT INTO devices (id, account_id, public_key, name, platform, created_at, revoked_at) VALUES (?1, ?2, 'k2', 'Old phone', 'ios', 2, 3)",
                params![revoked.to_string(), ada.to_string()],
            )?;
            assert_eq!(account_devices(conn, ada)?, [live]);
            assert_eq!(device_owner(conn, live)?, Some(ada));
            assert_eq!(device_owner(conn, revoked)?, None);
            let summaries = device_summaries(conn, ada)?;
            assert_eq!(summaries.len(), 1);
            assert_eq!(summaries[0].device_id, live);
            assert_eq!(summaries[0].name, "Laptop");
            assert_eq!(summaries[0].platform, "macos");
            assert_eq!(summaries[0].created_at, 1);
            assert_eq!(summaries[0].last_seen_at, Some(7));
            assert!(!summaries[0].current);
            Ok(())
        })
        .await;
    }

    #[tokio::test]
    async fn members_list_in_creation_order_with_roles_and_status() {
        with_db(|conn| {
            let first = create_account(conn, "First", None, ServerRole::Admin, 1)?;
            let second = create_account(conn, "Second", None, ServerRole::Member, 2)?;
            let gone = create_account(conn, "Gone", None, ServerRole::Member, 3)?;
            remove_account(conn, gone, 4)?;
            set_role(conn, second, ServerRole::Maintainer, 3)?;
            let listed = list_members(conn)?;
            let ids: Vec<AccountId> = listed
                .iter()
                .map(|member| member.account.account_id)
                .collect();
            assert_eq!(ids, [first, second]);
            assert_eq!(listed[1].account.server_role, ServerRole::Maintainer);
            assert_eq!(listed[1].created_at, 2);
            assert!(matches!(listed[1].status, MemberStatus::Active));
            assert_eq!(account_role(conn, second)?, Some(ServerRole::Maintainer));
            assert_eq!(device_owner(conn, DeviceId::new_v7())?, None);
            assert!(matches!(
                set_role(conn, AccountId::new_v7(), ServerRole::Member, 4),
                Err(ServerError::NotFound)
            ));
            Ok(())
        })
        .await;
    }
}
