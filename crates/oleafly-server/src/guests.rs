use oleafly_collab_protocol::admin::{MemberStatus, SecurityEventKind};
use oleafly_collab_protocol::guests::{GuestInvitation, GuestInvitationStatus};
use oleafly_collab_protocol::ids::{AccountId, DeviceId, SharedProjectId};
use oleafly_collab_protocol::projects::{ProjectRole, ProjectStatus};
use oleafly_collab_protocol::roles::{grantable, ServerRole};
use rusqlite::{params, Connection, OptionalExtension, Row};
use serde_json::json;

use crate::db::parse_id;
use crate::error::ServerError;
use crate::mail::{deliverable, messages, EmailKind, OutgoingEmail};
use crate::members;
use crate::projects;
use crate::removals;
use crate::security_log::{self, NewSecurityEvent};
use crate::settings;
use crate::state::{AppState, DAY_MS};
use crate::tokens::{self, random_token};

pub const INVITATION_DAYS: i64 = 14;
pub const INVITATIONS_PER_HOUR: i64 = 20;
const HOUR_MS: i64 = 60 * 60 * 1000;
const COLUMNS: &str = "id, project_id, email, role, invited_by, status, created_at, expires_at";
pub const GUEST_ROLES: &str = "A guest can be an Editor, a Reviewer, a Commenter or a Viewer.";

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Invitation {
    pub id: String,
    pub project: SharedProjectId,
    pub email: String,
    pub role: ProjectRole,
    pub invited_by: AccountId,
    pub status: GuestInvitationStatus,
    pub created_at: i64,
    pub expires_at: i64,
}

impl Invitation {
    pub fn status_at(&self, now: i64) -> GuestInvitationStatus {
        if self.status.is_open() && self.expires_at <= now {
            GuestInvitationStatus::Expired
        } else {
            self.status
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Accepted {
    pub project: SharedProjectId,
    pub account: AccountId,
    pub invited_by: AccountId,
    pub role: ProjectRole,
}

fn status_to_str(status: GuestInvitationStatus) -> &'static str {
    match status {
        GuestInvitationStatus::AwaitingApproval => "awaiting_approval",
        GuestInvitationStatus::Invited => "invited",
        GuestInvitationStatus::Accepted => "accepted",
        GuestInvitationStatus::Declined => "declined",
        GuestInvitationStatus::Revoked => "revoked",
        GuestInvitationStatus::Expired | GuestInvitationStatus::Unknown => "expired",
    }
}

fn status_from_str(text: &str) -> Result<GuestInvitationStatus, ServerError> {
    match text {
        "awaiting_approval" => Ok(GuestInvitationStatus::AwaitingApproval),
        "invited" => Ok(GuestInvitationStatus::Invited),
        "accepted" => Ok(GuestInvitationStatus::Accepted),
        "declined" => Ok(GuestInvitationStatus::Declined),
        "revoked" => Ok(GuestInvitationStatus::Revoked),
        "expired" => Ok(GuestInvitationStatus::Expired),
        other => Err(ServerError::Internal(format!(
            "unknown guest invitation status {other}"
        ))),
    }
}

type RawInvitation = (String, String, String, String, String, String, i64, i64);

fn raw(row: &Row<'_>) -> rusqlite::Result<RawInvitation> {
    Ok((
        row.get(0)?,
        row.get(1)?,
        row.get(2)?,
        row.get(3)?,
        row.get(4)?,
        row.get(5)?,
        row.get(6)?,
        row.get(7)?,
    ))
}

fn parse(raw: RawInvitation) -> Result<Invitation, ServerError> {
    let (id, project, email, role, invited_by, status, created_at, expires_at) = raw;
    Ok(Invitation {
        id,
        project: parse_id(&project)?,
        email,
        role: projects::role_from_str(&role)?,
        invited_by: parse_id(&invited_by)?,
        status: status_from_str(&status)?,
        created_at,
        expires_at,
    })
}

fn select<P: rusqlite::Params>(
    conn: &Connection,
    condition: &str,
    arguments: P,
) -> Result<Vec<Invitation>, ServerError> {
    let mut statement = conn.prepare(&format!(
        "SELECT {COLUMNS} FROM guest_invitations {condition}"
    ))?;
    let rows = statement
        .query_map(arguments, raw)?
        .collect::<Result<Vec<_>, _>>()?;
    rows.into_iter().map(parse).collect()
}

pub fn get(conn: &Connection, id: &str) -> Result<Option<Invitation>, ServerError> {
    Ok(select(conn, "WHERE id = ?1", [id])?.into_iter().next())
}

pub fn to_wire(
    conn: &Connection,
    invitation: &Invitation,
    now: i64,
) -> Result<GuestInvitation, ServerError> {
    let title = projects::project_row(conn, invitation.project)?
        .map(|row| row.title)
        .unwrap_or_default();
    let invited_by =
        projects::person(conn, invitation.invited_by, false)?.ok_or(ServerError::NotFound)?;
    Ok(GuestInvitation {
        id: invitation.id.clone(),
        project_id: invitation.project,
        project_title: title,
        email: invitation.email.clone(),
        role: invitation.role,
        status: invitation.status_at(now),
        invited_by,
        created_at: invitation.created_at,
        expires_at: invitation.expires_at,
    })
}

pub fn to_wire_all(
    conn: &Connection,
    invitations: &[Invitation],
    now: i64,
) -> Result<Vec<GuestInvitation>, ServerError> {
    invitations
        .iter()
        .map(|invitation| to_wire(conn, invitation, now))
        .collect()
}

fn set_status(
    conn: &Connection,
    id: &str,
    status: GuestInvitationStatus,
    by: Option<AccountId>,
    now: i64,
) -> Result<(), ServerError> {
    conn.execute(
        "UPDATE guest_invitations SET status = ?2, decided_by = ?3, decided_at = ?4 WHERE id = ?1",
        params![
            id,
            status_to_str(status),
            by.map(|account| account.to_string()),
            now
        ],
    )?;
    Ok(())
}

fn expire_stale(conn: &Connection, now: i64) -> Result<usize, ServerError> {
    Ok(conn.execute(
        "UPDATE guest_invitations SET status = 'expired' WHERE status IN ('awaiting_approval', 'invited') AND expires_at <= ?1",
        [now],
    )?)
}

pub fn prune(conn: &Connection, older_than: i64) -> Result<usize, ServerError> {
    Ok(conn.execute(
        "DELETE FROM guest_invitations WHERE \
         (status IN ('declined', 'revoked') AND COALESCE(decided_at, expires_at) < ?1) \
         OR (status = 'accepted' AND COALESCE(accepted_at, decided_at, created_at) < ?1) \
         OR (status IN ('expired', 'awaiting_approval', 'invited') AND expires_at < ?1)",
        [older_than],
    )?)
}

pub fn create(
    conn: &Connection,
    project: SharedProjectId,
    email: &str,
    role: ProjectRole,
    invited_by: AccountId,
    approval_required: bool,
    now: i64,
) -> Result<Invitation, ServerError> {
    if !grantable(role) {
        return Err(ServerError::BadRequest(GUEST_ROLES.to_string()));
    }
    let recent: i64 = conn.query_row(
        "SELECT COUNT(*) FROM guest_invitations WHERE invited_by = ?1 AND created_at > ?2",
        params![invited_by.to_string(), now - HOUR_MS],
        |row| row.get(0),
    )?;
    if recent >= INVITATIONS_PER_HOUR {
        return Err(ServerError::RateLimited);
    }
    expire_stale(conn, now)?;
    let open = conn
        .query_row(
            "SELECT 1 FROM guest_invitations WHERE project_id = ?1 AND email = ?2 AND status IN ('awaiting_approval', 'invited')",
            [project.to_string(), email.to_string()],
            |_| Ok(()),
        )
        .optional()?;
    if open.is_some() {
        return Err(ServerError::Conflict(
            "That address already has an invitation to this project.".to_string(),
        ));
    }
    let status = if approval_required {
        GuestInvitationStatus::AwaitingApproval
    } else {
        GuestInvitationStatus::Invited
    };
    let id = random_token();
    conn.execute(
        "INSERT INTO guest_invitations (id, project_id, email, role, invited_by, status, created_at, expires_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![
            id,
            project.to_string(),
            email,
            projects::role_to_str(role),
            invited_by.to_string(),
            status_to_str(status),
            now,
            now + INVITATION_DAYS * DAY_MS
        ],
    )?;
    get(conn, &id)?
        .ok_or_else(|| ServerError::Internal("the invitation was not stored".to_string()))
}

pub fn for_project(
    conn: &Connection,
    project: SharedProjectId,
    now: i64,
) -> Result<Vec<Invitation>, ServerError> {
    select(
        conn,
        "WHERE project_id = ?1 AND status IN ('awaiting_approval', 'invited', 'declined') AND expires_at > ?2 ORDER BY created_at, id",
        params![project.to_string(), now],
    )
}

pub fn open(conn: &Connection, now: i64) -> Result<Vec<Invitation>, ServerError> {
    if !settings::load(conn)?.guests_enabled {
        return Ok(Vec::new());
    }
    select(
        conn,
        "WHERE status IN ('awaiting_approval', 'invited') AND expires_at > ?1 \
         AND project_id IN (SELECT id FROM projects WHERE status = 'active') ORDER BY created_at, id",
        [now],
    )
}

fn open_one(conn: &Connection, id: &str, now: i64) -> Result<Invitation, ServerError> {
    let invitation = get(conn, id)?.ok_or(ServerError::NotFound)?;
    if !invitation.status_at(now).is_open() {
        return Err(ServerError::Conflict(
            "This invitation was already answered or has expired.".to_string(),
        ));
    }
    Ok(invitation)
}

pub fn approve(
    conn: &Connection,
    id: &str,
    by: AccountId,
    now: i64,
) -> Result<Invitation, ServerError> {
    let invitation = open_one(conn, id, now)?;
    if invitation.status != GuestInvitationStatus::AwaitingApproval {
        return Err(ServerError::Conflict(
            "This invitation was already approved.".to_string(),
        ));
    }
    if !settings::load(conn)?.guests_enabled {
        return Err(ServerError::refused(
            "guests_off",
            "This server does not allow guests.",
        ));
    }
    let shared = projects::project_row(conn, invitation.project)?
        .is_some_and(|row| row.status == ProjectStatus::Active);
    if !shared {
        return Err(ServerError::refused(
            "project_not_shared",
            "This project isn't shared any more, so the invitation can't be approved.",
        ));
    }
    if !owner_present(conn, invitation.project)? {
        return Err(ServerError::refused(
            "owner_away",
            "The project's owner is suspended or removed, so the guest can't get in yet. Approve the invitation once the owner is back.",
        ));
    }
    set_status(conn, id, GuestInvitationStatus::Invited, Some(by), now)?;
    conn.execute(
        "UPDATE guest_invitations SET expires_at = ?2 WHERE id = ?1",
        params![id, now + INVITATION_DAYS * DAY_MS],
    )?;
    get(conn, id)?.ok_or(ServerError::NotFound)
}

pub fn decline(
    conn: &Connection,
    id: &str,
    by: AccountId,
    now: i64,
) -> Result<Invitation, ServerError> {
    let invitation = open_one(conn, id, now)?;
    if invitation.status != GuestInvitationStatus::AwaitingApproval {
        return Err(ServerError::Conflict(
            "This invitation was already approved. Withdraw it instead.".to_string(),
        ));
    }
    set_status(conn, id, GuestInvitationStatus::Declined, Some(by), now)?;
    get(conn, id)?.ok_or(ServerError::NotFound)
}

pub fn revoke(
    conn: &Connection,
    id: &str,
    by: AccountId,
    now: i64,
) -> Result<Invitation, ServerError> {
    let invitation = get(conn, id)?.ok_or(ServerError::NotFound)?;
    if !invitation.status_at(now).is_open() {
        return Err(ServerError::NotFound);
    }
    set_status(conn, id, GuestInvitationStatus::Revoked, Some(by), now)?;
    get(conn, id)?.ok_or(ServerError::NotFound)
}

fn normalized(emails: &[String]) -> Vec<String> {
    let mut kept: Vec<String> = emails
        .iter()
        .filter_map(|email| members::normalize_email(email))
        .collect();
    kept.sort();
    kept.dedup();
    kept
}

fn usable(conn: &Connection, emails: &[String], now: i64) -> Result<Vec<Invitation>, ServerError> {
    let mut found = Vec::new();
    for email in normalized(emails) {
        found.extend(select(
            conn,
            "WHERE email = ?1 AND status = 'invited' AND expires_at > ?2 \
             AND project_id IN (SELECT id FROM projects WHERE status = 'active') ORDER BY created_at, id",
            params![email, now],
        )?);
    }
    Ok(found)
}

pub fn has_candidate(conn: &Connection, emails: &[String]) -> Result<bool, ServerError> {
    for email in normalized(emails) {
        let found = conn
            .query_row(
                "SELECT 1 FROM guest_invitations WHERE email = ?1 AND status = 'invited' LIMIT 1",
                [email],
                |_| Ok(()),
            )
            .optional()?;
        if found.is_some() {
            return Ok(true);
        }
    }
    Ok(false)
}

fn owner_present(conn: &Connection, project: SharedProjectId) -> Result<bool, ServerError> {
    let Some(row) = projects::project_row(conn, project)? else {
        return Ok(false);
    };
    Ok(members::account_status(conn, row.owner)? == Some(MemberStatus::Active))
}

pub fn admissible(
    conn: &Connection,
    emails: &[String],
    max_members: u32,
    now: i64,
) -> Result<bool, ServerError> {
    if !settings::load(conn)?.guests_enabled {
        return Ok(false);
    }
    for invitation in usable(conn, emails, now)? {
        if owner_present(conn, invitation.project)?
            && projects::member_count(conn, invitation.project)? < max_members
        {
            return Ok(true);
        }
    }
    Ok(false)
}

pub fn accept_for(
    conn: &Connection,
    account: AccountId,
    emails: &[String],
    max_members: u32,
    ip: Option<&str>,
    now: i64,
) -> Result<Vec<Accepted>, ServerError> {
    if !settings::load(conn)?.guests_enabled {
        return Ok(Vec::new());
    }
    let mut accepted = Vec::new();
    for invitation in usable(conn, emails, now)? {
        let by = Granter { actor: account, ip };
        accepted.extend(accept(conn, &invitation, account, max_members, by, now)?);
    }
    Ok(accepted)
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Granter<'a> {
    pub actor: AccountId,
    pub ip: Option<&'a str>,
}

fn accept(
    conn: &Connection,
    invitation: &Invitation,
    account: AccountId,
    max_members: u32,
    by: Granter<'_>,
    now: i64,
) -> Result<Option<Accepted>, ServerError> {
    if !owner_present(conn, invitation.project)? {
        return Ok(None);
    }
    let existing = projects::role_of(conn, invitation.project, account)?;
    if existing.is_none() && projects::member_count(conn, invitation.project)? >= max_members {
        return Ok(None);
    }
    if existing.is_none() {
        projects::grant(
            conn,
            invitation.project,
            account,
            invitation.role,
            invitation.invited_by,
            now,
        )?;
    }
    removals::clear(conn, invitation.project, account)?;
    conn.execute(
        "UPDATE guest_invitations SET status = 'accepted', accepted_by = ?2, accepted_at = ?3 WHERE id = ?1",
        params![invitation.id, account.to_string(), now],
    )?;
    if existing.is_none() {
        security_log::record(
            conn,
            now,
            NewSecurityEvent {
                actor: Some(by.actor),
                kind: SecurityEventKind::ProjectAccessGranted,
                target: Some(account.to_string()),
                ip: by.ip.map(str::to_string),
                detail: json!({
                    "project": invitation.project.to_string(),
                    "role": projects::role_to_str(invitation.role),
                    "via": "invitation",
                    "invitation": invitation.id,
                    "invited_by": invitation.invited_by.to_string(),
                }),
            },
        )?;
    }
    Ok(Some(Accepted {
        project: invitation.project,
        account,
        invited_by: invitation.invited_by,
        role: existing.unwrap_or(invitation.role),
    }))
}

pub fn accept_existing(
    conn: &Connection,
    invitation: &Invitation,
    max_members: u32,
    by: Granter<'_>,
    now: i64,
) -> Result<Option<Accepted>, ServerError> {
    if invitation.status_at(now) != GuestInvitationStatus::Invited
        || !settings::load(conn)?.guests_enabled
    {
        return Ok(None);
    }
    let Some(row) = projects::project_row(conn, invitation.project)? else {
        return Ok(None);
    };
    if row.status != ProjectStatus::Active {
        return Ok(None);
    }
    let mut statement = conn.prepare(
        "SELECT DISTINCT e.account_id FROM account_emails e JOIN accounts a ON a.id = e.account_id \
         WHERE e.email = ?1 AND a.status = 'active' LIMIT 2",
    )?;
    let holders = statement
        .query_map([invitation.email.as_str()], |row| row.get::<_, String>(0))?
        .collect::<Result<Vec<_>, _>>()?;
    let [holder] = holders.as_slice() else {
        return Ok(None);
    };
    let account: AccountId = parse_id(holder)?;
    accept(conn, invitation, account, max_members, by, now)
}

pub fn end_if_no_access(
    conn: &Connection,
    account: AccountId,
    actor: AccountId,
    ip: Option<String>,
    now: i64,
) -> Result<Vec<DeviceId>, ServerError> {
    let is_guest = members::account_role(conn, account)? == Some(ServerRole::Guest);
    let active = members::account_status(conn, account)? == Some(MemberStatus::Active);
    if !is_guest || !active {
        return Ok(Vec::new());
    }
    let grants: i64 = conn.query_row(
        "SELECT COUNT(*) FROM project_grants WHERE account_id = ?1",
        [account.to_string()],
        |row| row.get(0),
    )?;
    if grants > 0 {
        return Ok(Vec::new());
    }
    let devices = members::account_devices(conn, account)?;
    members::remove_account(conn, account, now)?;
    for device in &devices {
        tokens::sign_out_device(conn, *device, now)?;
    }
    security_log::record(
        conn,
        now,
        NewSecurityEvent {
            actor: Some(actor),
            kind: SecurityEventKind::GuestAdmissionEnded,
            target: Some(account.to_string()),
            ip,
            detail: json!({
                "reason": "no_projects_left",
                "devices_signed_out": devices.len(),
            }),
        },
    )?;
    Ok(devices)
}

pub fn sends_email(mail_configured: bool, conn: &Connection) -> Result<bool, ServerError> {
    Ok(mail_configured && settings::load(conn)?.email_notifications)
}

pub fn will_email(
    mail_configured: bool,
    conn: &Connection,
    email: &str,
) -> Result<bool, ServerError> {
    Ok(sends_email(mail_configured, conn)? && !deliverable(&[email.to_string()]).is_empty())
}

pub fn add_link(state: &AppState) -> String {
    messages::add_server_link(&state.config.public_url)
}

pub fn send_invitation(state: &AppState, id: String) {
    let Some(tracked) = state.mailer.track() else {
        return;
    };
    let state = state.clone();
    tokio::spawn(async move {
        let _tracked = tracked;
        match prepare_invitation(&state, id).await {
            Ok(Some(email)) => state.mailer.enqueue(email),
            Ok(None) => {}
            Err(error) => tracing::warn!(
                "Could not prepare the {} email: {error}",
                EmailKind::GuestInvitation.label()
            ),
        }
    });
}

async fn prepare_invitation(
    state: &AppState,
    id: String,
) -> Result<Option<OutgoingEmail>, ServerError> {
    let now = state.clock.now_ms();
    let found = state
        .db
        .call(move |conn| {
            let runtime = settings::load(conn)?;
            if !runtime.email_notifications || !runtime.guests_enabled {
                return Ok(None);
            }
            let Some(invitation) = get(conn, &id)? else {
                return Ok(None);
            };
            if invitation.status_at(now) != GuestInvitationStatus::Invited {
                return Ok(None);
            }
            let Some(row) = projects::project_row(conn, invitation.project)? else {
                return Ok(None);
            };
            let owner_active =
                members::account_status(conn, row.owner)? == Some(MemberStatus::Active);
            if row.status != ProjectStatus::Active || !owner_active {
                return Ok(None);
            }
            let inviter = members::account_summary(conn, invitation.invited_by)?
                .map(|summary| summary.display_name)
                .unwrap_or_else(|| "Someone".to_string());
            Ok(Some((invitation, row.title, inviter)))
        })
        .await?;
    let Some((invitation, title, inviter)) = found else {
        return Ok(None);
    };
    let to = deliverable(std::slice::from_ref(&invitation.email));
    if to.is_empty() {
        return Ok(None);
    }
    let content = messages::guest_invitation(
        &state.config.server_name,
        &state.config.public_url,
        &title,
        &inviter,
        invitation.role,
        &to[0],
    );
    Ok(Some(OutgoingEmail::new(
        EmailKind::GuestInvitation,
        to,
        content,
    )))
}

#[cfg(test)]
mod tests {
    use oleafly_collab_protocol::admin::RuntimeSettingsPatch;

    use super::*;
    use crate::clock::Clock;
    use crate::db::Db;
    use crate::test_support::{seed_member, test_app};

    #[tokio::test]
    async fn no_invitation_email_is_prepared_while_the_project_owner_is_away() {
        let app = test_app().await;
        let owner = seed_member(&app, ServerRole::Member).await.account_id;
        let now = app.clock.now_ms();
        let id = app
            .state
            .db
            .call(move |conn| {
                settings::patch(
                    conn,
                    &RuntimeSettingsPatch {
                        guests_enabled: Some(true),
                        ..RuntimeSettingsPatch::default()
                    },
                )?;
                let project = projects::create_pending(conn, owner, "Reef survey", now)?;
                projects::set_status(conn, project, ProjectStatus::Active, now)?;
                let invitation = create(
                    conn,
                    project,
                    "dana@field.org",
                    ProjectRole::Viewer,
                    owner,
                    false,
                    now,
                )?;
                Ok(invitation.id)
            })
            .await
            .unwrap();
        assert!(prepare_invitation(&app.state, id.clone())
            .await
            .unwrap()
            .is_some());
        app.state
            .db
            .call(move |conn| members::set_status(conn, owner, &MemberStatus::Suspended, now))
            .await
            .unwrap();
        assert!(prepare_invitation(&app.state, id).await.unwrap().is_none());
    }

    #[tokio::test]
    async fn a_guest_left_without_projects_has_no_live_device_or_token_once_the_change_is_made() {
        let app = test_app().await;
        let owner = seed_member(&app, ServerRole::Member).await;
        let guest = seed_member(&app, ServerRole::Guest).await;
        let (target, device, by, now) = (
            guest.account_id,
            guest.device_id,
            owner.account_id,
            app.clock.now_ms(),
        );
        let left = app
            .state
            .db
            .call(move |conn| {
                crate::auth::refresh::issue_session(conn, target, device, now)?;
                let signed_out = end_if_no_access(conn, target, by, None, now)?;
                assert_eq!(signed_out, [device]);
                let id = target.to_string();
                let count = |sql: &str| -> Result<i64, ServerError> {
                    Ok(conn.query_row(sql, [&id], |row| row.get(0))?)
                };
                Ok((
                    count(
                        "SELECT COUNT(*) FROM devices WHERE account_id = ?1 AND revoked_at IS NULL",
                    )?,
                    count("SELECT COUNT(*) FROM access_tokens WHERE account_id = ?1")?,
                    count(
                        "SELECT COUNT(*) FROM refresh_tokens WHERE account_id = ?1 AND revoked_at IS NULL",
                    )?,
                ))
            })
            .await
            .unwrap();
        assert_eq!(left, (0, 0, 0));
    }

    #[tokio::test]
    async fn an_invitation_with_a_role_a_guest_cannot_have_stores_nothing() {
        Db::open_in_memory()
            .unwrap()
            .call(|conn| {
                let owner = members::create_account(conn, "Ada", None, ServerRole::Member, 1)?;
                let project = projects::create_pending(conn, owner, "Thesis", 1)?;
                projects::set_status(conn, project, ProjectStatus::Active, 1)?;
                for role in [ProjectRole::Owner, ProjectRole::Unknown] {
                    let refused = create(conn, project, "carol@uni.edu", role, owner, false, 2);
                    assert!(
                        matches!(&refused, Err(ServerError::BadRequest(message)) if message == GUEST_ROLES),
                        "{role:?}: {refused:?}"
                    );
                }
                let stored: i64 =
                    conn.query_row("SELECT COUNT(*) FROM guest_invitations", [], |row| {
                        row.get(0)
                    })?;
                assert_eq!(stored, 0);
                let made = create(
                    conn,
                    project,
                    "carol@uni.edu",
                    ProjectRole::Viewer,
                    owner,
                    false,
                    2,
                )?;
                assert_eq!(made.role, ProjectRole::Viewer);
                Ok(())
            })
            .await
            .unwrap();
    }
}
