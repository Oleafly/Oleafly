use oleafly_collab_protocol::admin::{AllowlistEntry, MemberStatus};
use oleafly_collab_protocol::auth::AuthErrorCode;
use oleafly_collab_protocol::ids::AccountId;
use oleafly_collab_protocol::roles::ServerRole;
use rusqlite::Connection;

use crate::auth::{setup, ExternalIdentity};
use crate::error::ServerError;
use crate::members;

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
    Suspended,
    SetupCodeInvalid,
    NotAdmitted,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Via {
    Linked,
    Allowlist,
    Domain,
    Setup,
}

impl Via {
    pub fn as_str(self) -> &'static str {
        match self {
            Via::Linked => "linked",
            Via::Allowlist => "allowlist",
            Via::Domain => "domain",
            Via::Setup => "setup",
        }
    }
}

#[derive(Debug)]
pub struct Admitted {
    pub account_id: AccountId,
    pub new_account: bool,
    pub reactivated: bool,
    pub via: Via,
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
    if removed.is_none() {
        for email in &identity.verified_emails {
            let Some(domain) = email_domain(email) else {
                continue;
            };
            if let Some(rule) = members::find_domain_rule(conn, &domain)? {
                return Ok(Admission::Domain {
                    role: rule.role,
                    existing: None,
                });
            }
        }
    }
    if let Some(admission) = guest_invitation(conn, identity)? {
        return Ok(admission);
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
    now: i64,
) -> Result<Applied, ServerError> {
    let (role, entry_id, existing, via) = match admission {
        Admission::Linked { account_id } => {
            members::add_verified_emails(conn, account_id, &identity.verified_emails)?;
            return Ok(Applied::Admitted(Admitted {
                account_id,
                new_account: false,
                reactivated: false,
                via: Via::Linked,
            }));
        }
        Admission::Allowlisted {
            entry_id,
            role,
            existing,
        } => (role, Some(entry_id), existing, Via::Allowlist),
        Admission::Domain { role, existing } => (role, None, existing, Via::Domain),
        Admission::Setup { existing } => (ServerRole::Admin, None, existing, Via::Setup),
        Admission::Suspended => return Ok(refused(AuthErrorCode::NotAdmitted, "suspended")),
        Admission::SetupCodeInvalid => {
            return Ok(refused(
                AuthErrorCode::SetupCodeInvalid,
                "setup_code_invalid",
            ))
        }
        Admission::NotAdmitted => return Ok(refused(AuthErrorCode::NotAdmitted, "not_admitted")),
    };
    let (account_id, new_account) = match existing {
        Some(account_id) => {
            members::reactivate_account(conn, account_id, role, now)?;
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
    }))
}

fn usable(entry: &AllowlistEntry, removed: Option<AccountId>) -> bool {
    entry.bound_account.is_none() || entry.bound_account == removed
}

fn refused(code: AuthErrorCode, reason: &'static str) -> Applied {
    Applied::Refused { code, reason }
}

fn guest_invitation(
    _conn: &Connection,
    _identity: &ExternalIdentity,
) -> Result<Option<Admission>, ServerError> {
    Ok(None)
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
