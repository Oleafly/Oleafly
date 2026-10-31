use oleafly_collab_protocol::admin::{AllowlistEntry, MemberStatus};
use oleafly_collab_protocol::auth::AuthErrorCode;
use oleafly_collab_protocol::ids::{AccountId, SharedProjectId};
use oleafly_collab_protocol::roles::ServerRole;
use rusqlite::Connection;

use crate::auth::{email_link, setup, ExternalIdentity};
use crate::db::parse_id;
use crate::error::ServerError;
use crate::guests;
use crate::members;
use crate::projects;

#[derive(Debug)]
pub enum Admission {
    Linked {
        account_id: AccountId,
    },
    Allowlisted {
        entry_id: String,
        role: ServerRole,
        existing: Option<AccountId>,
    },
    Domain {
        role: ServerRole,
        existing: Option<AccountId>,
    },
    Setup {
        existing: Option<AccountId>,
    },
    Guest {
        existing: Option<AccountId>,
    },
    Open,
    Suspended,
    InactiveAccountAddress,
    SetupCodeInvalid,
    NotAdmitted,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Via {
    Linked,
    Allowlist,
    Domain,
    Setup,
    Guest,
    Open,
}

impl Via {
    pub fn as_str(self) -> &'static str {
        match self {
            Via::Linked => "linked",
            Via::Allowlist => "allowlist",
            Via::Domain => "domain",
            Via::Setup => "setup",
            Via::Guest => "guest",
            Via::Open => "open_signup",
        }
    }
}

#[derive(Debug)]
pub struct Admitted {
    pub account_id: AccountId,
    pub new_account: bool,
    pub reactivated: bool,
    pub via: Via,
    pub left_out_of: Vec<SharedProjectId>,
}

#[derive(Debug)]
pub enum Applied {
    Admitted(Admitted),
    Refused {
        code: AuthErrorCode,
        reason: &'static str,
    },
}

pub fn decide(
    conn: &Connection,
    identity: &ExternalIdentity,
    setup_code_hash: Option<&str>,
    open_signup: bool,
) -> Result<Admission, ServerError> {
    let removed =
        match members::find_account_by_identity(conn, &identity.issuer, &identity.subject)? {
            Some(account_id) => match members::account_status(conn, account_id)? {
                Some(MemberStatus::Active) => return Ok(Admission::Linked { account_id }),
                Some(MemberStatus::Suspended) => return Ok(Admission::Suspended),
                Some(MemberStatus::Removed) => Some(account_id),
                None => return Ok(Admission::NotAdmitted),
            },
            None => None,
        };
    if let Some(hash) = setup_code_hash {
        if setup::matches(conn, hash)? {
            return Ok(Admission::Setup { existing: removed });
        }
    }
    let by_login = match identity.login.as_deref() {
        Some(login) => members::find_allowlist_by_login(conn, &identity.provider_id, login)?,
        None => None,
    };
    if let Some(entry) = by_login.filter(|entry| usable(entry, removed)) {
        return Ok(Admission::Allowlisted {
            entry_id: entry.id,
            role: entry.role,
            existing: removed,
        });
    }
    for email in &identity.verified_emails {
        let by_email = members::find_allowlist_by_email(conn, email)?;
        if let Some(entry) = by_email.filter(|entry| usable(entry, removed)) {
            return Ok(Admission::Allowlisted {
                entry_id: entry.id,
                role: entry.role,
                existing: removed,
            });
        }
    }
    let inactive = inactive_holders(conn, &identity.verified_emails)?;
    let domain_role = match removed {
        None => domain_rule_role(conn, &identity.verified_emails)?,
        Some(_) => None,
    };
    if let Some(role) = domain_role.filter(|_| inactive.is_empty()) {
        return Ok(Admission::Domain {
            role,
            existing: None,
        });
    }
    if open_signup && setup_code_hash.is_none() && removed.is_none() && inactive.is_empty() {
        return Ok(Admission::Open);
    }
    let invitation = guest_invitation(conn, identity, removed)?;
    if invitation.is_some() && !all_may_return_as_guest(conn, &inactive)? {
        return Ok(Admission::InactiveAccountAddress);
    }
    if let Some(admission) = invitation {
        return Ok(admission);
    }
    if domain_role.is_some() {
        return Ok(Admission::InactiveAccountAddress);
    }
    match setup_code_hash {
        Some(_) => Ok(Admission::SetupCodeInvalid),
        None => Ok(Admission::NotAdmitted),
    }
}

pub fn apply(
    conn: &Connection,
    identity: &ExternalIdentity,
    admission: Admission,
    max_members: u32,
    ip: Option<&str>,
    now: i64,
) -> Result<Applied, ServerError> {
    let (role, entry_id, existing, via) = match admission {
        Admission::Linked { account_id } => {
            members::link_identity(
                conn,
                account_id,
                &identity.provider_id,
                &identity.issuer,
                &identity.subject,
                identity.login.as_deref(),
                now,
            )?;
            if identity.provider_id != email_link::PROVIDER_ID {
                members::refresh_profile(
                    conn,
                    account_id,
                    &identity.display_name,
                    identity.avatar_url.as_deref(),
                    now,
                )?;
            }
            members::add_verified_emails(conn, account_id, &identity.verified_emails)?;
            guests::accept_for(
                conn,
                account_id,
                &identity.verified_emails,
                max_members,
                ip,
                now,
            )?;
            return Ok(Applied::Admitted(Admitted {
                account_id,
                new_account: false,
                reactivated: false,
                via: Via::Linked,
                left_out_of: Vec::new(),
            }));
        }
        Admission::Allowlisted {
            entry_id,
            role,
            existing,
        } => (role, Some(entry_id), existing, Via::Allowlist),
        Admission::Domain { role, existing } => (role, None, existing, Via::Domain),
        Admission::Setup { existing } => (ServerRole::Admin, None, existing, Via::Setup),
        Admission::Guest { existing } => {
            if !guests::admissible(conn, &identity.verified_emails, max_members, now)? {
                return Ok(refused(
                    AuthErrorCode::NotAdmitted,
                    "guest_invitation_unusable",
                ));
            }
            (ServerRole::Guest, None, existing, Via::Guest)
        }
        Admission::Open => (ServerRole::Member, None, None, Via::Open),
        Admission::Suspended => return Ok(refused(AuthErrorCode::NotAdmitted, "suspended")),
        Admission::InactiveAccountAddress => {
            return Ok(refused(
                AuthErrorCode::NotAdmitted,
                "address_of_inactive_account",
            ))
        }
        Admission::SetupCodeInvalid => {
            return Ok(refused(
                AuthErrorCode::SetupCodeInvalid,
                "setup_code_invalid",
            ))
        }
        Admission::NotAdmitted => return Ok(refused(AuthErrorCode::NotAdmitted, "not_admitted")),
    };
    let mut left_out_of = Vec::new();
    let (account_id, new_account) = match existing {
        Some(account_id) => {
            let full = members::projects_now_full(conn, account_id, max_members)?;
            members::reactivate_account(conn, account_id, role, now)?;
            for (project, _) in full {
                projects::revoke(conn, project, account_id)?;
                left_out_of.push(project);
            }
            (account_id, false)
        }
        None => {
            let account_id = members::create_account(
                conn,
                &identity.display_name,
                identity.avatar_url.as_deref(),
                role,
                now,
            )?;
            members::link_identity(
                conn,
                account_id,
                &identity.provider_id,
                &identity.issuer,
                &identity.subject,
                identity.login.as_deref(),
                now,
            )?;
            (account_id, true)
        }
    };
    members::add_verified_emails(conn, account_id, &identity.verified_emails)?;
    guests::accept_for(
        conn,
        account_id,
        &identity.verified_emails,
        max_members,
        ip,
        now,
    )?;
    if let Some(entry_id) = entry_id {
        members::bind_allowlist(conn, &entry_id, account_id)?;
    }
    if via == Via::Setup {
        setup::consume(conn)?;
    }
    Ok(Applied::Admitted(Admitted {
        account_id,
        new_account,
        reactivated: !new_account,
        via,
        left_out_of,
    }))
}

fn usable(entry: &AllowlistEntry, removed: Option<AccountId>) -> bool {
    entry.bound_account.is_none() || entry.bound_account == removed
}

fn refused(code: AuthErrorCode, reason: &'static str) -> Applied {
    Applied::Refused { code, reason }
}

fn guest_invitation(
    conn: &Connection,
    identity: &ExternalIdentity,
    removed: Option<AccountId>,
) -> Result<Option<Admission>, ServerError> {
    if let Some(account) = removed {
        if !may_return_as_guest(conn, account)? {
            return Ok(None);
        }
    }
    Ok(guests::has_candidate(conn, &identity.verified_emails)?
        .then_some(Admission::Guest { existing: removed }))
}

fn domain_rule_role(
    conn: &Connection,
    emails: &[String],
) -> Result<Option<ServerRole>, ServerError> {
    for email in emails {
        let Some(domain) = email_domain(email) else {
            continue;
        };
        if let Some(rule) = members::find_domain_rule(conn, &domain)? {
            return Ok(Some(rule.role));
        }
    }
    Ok(None)
}

fn inactive_holders(conn: &Connection, emails: &[String]) -> Result<Vec<AccountId>, ServerError> {
    let mut statement = conn.prepare(
        "SELECT a.id, a.status FROM account_emails e JOIN accounts a ON a.id = e.account_id \
         WHERE e.email = ?1 ORDER BY a.id",
    )?;
    let mut inactive = Vec::new();
    for email in emails
        .iter()
        .filter_map(|email| members::normalize_email(email))
    {
        let holders = statement
            .query_map([email.as_str()], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })?
            .collect::<Result<Vec<_>, _>>()?;
        if holders.iter().any(|(_, status)| status == "active") {
            continue;
        }
        for (id, _) in holders {
            let account = parse_id(&id)?;
            if !inactive.contains(&account) {
                inactive.push(account);
            }
        }
    }
    Ok(inactive)
}

fn all_may_return_as_guest(conn: &Connection, accounts: &[AccountId]) -> Result<bool, ServerError> {
    for account in accounts {
        let removed = members::account_status(conn, *account)? == Some(MemberStatus::Removed);
        if !removed || !may_return_as_guest(conn, *account)? {
            return Ok(false);
        }
    }
    Ok(true)
}

fn may_return_as_guest(conn: &Connection, account: AccountId) -> Result<bool, ServerError> {
    if members::account_role(conn, account)? != Some(ServerRole::Guest) {
        return Ok(false);
    }
    let grants: i64 = conn.query_row(
        "SELECT COUNT(*) FROM project_grants WHERE account_id = ?1",
        [account.to_string()],
        |row| row.get(0),
    )?;
    Ok(grants == 0)
}

fn email_domain(email: &str) -> Option<String> {
    let (_, domain) = email.rsplit_once('@')?;
    let domain = domain.trim().to_lowercase();
    (!domain.is_empty()).then_some(domain)
}

#[cfg(test)]
mod tests {
    use super::email_domain;

    #[test]
    fn the_domain_is_the_lowercased_part_after_the_last_at() {
        assert_eq!(
            email_domain("Dana@CS.Uni.EDU").as_deref(),
            Some("cs.uni.edu")
        );
        assert_eq!(
            email_domain("odd\"@\"name@uni.edu").as_deref(),
            Some("uni.edu")
        );
        assert_eq!(email_domain("no-at-sign"), None);
        assert_eq!(email_domain("trailing@"), None);
    }
}
