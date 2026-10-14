use axum::extract::rejection::{JsonRejection, PathRejection};
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::routing::{delete, get, post};
use axum::{Json, Router};
use oleafly_collab_protocol::admin::SecurityEventKind;
use oleafly_collab_protocol::guests::{
    GuestInvitation, GuestInvitationStatus, GuestInviteResult, NewGuestInvitation,
    ProjectGuestInvitations,
};
use oleafly_collab_protocol::ids::{AccountId, SharedProjectId};
use oleafly_collab_protocol::projects::{ProjectRole, ProjectStatus};
use oleafly_collab_protocol::roles::ServerAction;
use rusqlite::Connection;
use serde_json::json;

use crate::error::ServerError;
use crate::guests::{self, Accepted, Invitation};
use crate::mail::notify;
use crate::members;
use crate::projects::{self, ProjectRow};
use crate::routes::{json_body, path_id, Authenticated, ClientIp};
use crate::security_log::{self, NewSecurityEvent};
use crate::settings;
use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .route(
            "/api/v1/projects/{project}/invitations",
            get(project_invitations).post(invite),
        )
        .route(
            "/api/v1/projects/{project}/invitations/{invitation}",
            delete(owner_revoke),
        )
        .route("/api/v1/admin/guest-invitations", get(pending))
        .route(
            "/api/v1/admin/guest-invitations/{invitation}",
            delete(staff_revoke),
        )
        .route(
            "/api/v1/admin/guest-invitations/{invitation}/approve",
            post(approve),
        )
        .route(
            "/api/v1/admin/guest-invitations/{invitation}/decline",
            post(decline),
        )
}

fn owner_of(
    conn: &Connection,
    project: SharedProjectId,
    account: AccountId,
) -> Result<ProjectRow, ServerError> {
    let row = projects::project_row(conn, project)?.ok_or(ServerError::NotFound)?;
    let role = projects::role_of(conn, project, account)?.ok_or(ServerError::NotFound)?;
    if row.status == ProjectStatus::Pending && role != ProjectRole::Owner {
        return Err(ServerError::NotFound);
    }
    if role != ProjectRole::Owner {
        return Err(ServerError::Forbidden);
    }
    Ok(row)
}

fn log(
    conn: &Connection,
    now: i64,
    actor: AccountId,
    kind: SecurityEventKind,
    invitation: &Invitation,
    ip: Option<String>,
) -> Result<(), ServerError> {
    security_log::record(
        conn,
        now,
        NewSecurityEvent {
            actor: Some(actor),
            kind,
            target: Some(invitation.id.clone()),
            ip,
            detail: json!({
                "project": invitation.project.to_string(),
                "email": invitation.email,
                "role": projects::role_to_str(invitation.role),
            }),
        },
    )?;
    Ok(())
}

fn invitation_path(
    path: Result<Path<(String, String)>, PathRejection>,
) -> Result<(SharedProjectId, String), ServerError> {
    let Path((project, invitation)) =
        path.map_err(|rejection| ServerError::BadRequest(rejection.body_text()))?;
    let project = project
        .parse::<SharedProjectId>()
        .map_err(|_| ServerError::BadRequest(format!("{project} is not a valid id.")))?;
    Ok((project, invitation))
}

fn after_acceptance(state: &AppState, accepted: Option<Accepted>, invitation: &Invitation) {
    match accepted {
        Some(accepted) => notify::shared_with_you(
            state,
            accepted.project,
            accepted.account,
            accepted.invited_by,
            accepted.role,
        ),
        None if invitation.status == GuestInvitationStatus::Invited => {
            guests::send_invitation(state, invitation.id.clone())
        }
        None => {}
    }
}

async fn project_invitations(
    State(state): State<AppState>,
    auth: Authenticated,
    path: Result<Path<String>, PathRejection>,
) -> Result<Json<ProjectGuestInvitations>, ServerError> {
    let project: SharedProjectId = path_id(path)?;
    let account = auth.account_id;
    let now = state.clock.now_ms();
    let link = guests::add_link(&state);
    let mail = state.mailer.is_configured();
    let listed = state
        .db
        .call(move |conn| {
            owner_of(conn, project, account)?;
            let runtime = settings::load(conn)?;
            let invitations = guests::for_project(conn, project, now)?;
            Ok(ProjectGuestInvitations {
                guests_enabled: runtime.guests_enabled,
                approval_required: runtime.guest_approval_required,
                sends_email: guests::sends_email(mail, conn)?,
                add_link: link,
                invitations: guests::to_wire_all(conn, &invitations, now)?,
            })
        })
        .await?;
    Ok(Json(listed))
}

async fn invite(
    State(state): State<AppState>,
    auth: Authenticated,
    ClientIp(ip): ClientIp,
    path: Result<Path<String>, PathRejection>,
    body: Result<Json<NewGuestInvitation>, JsonRejection>,
) -> Result<(StatusCode, Json<GuestInviteResult>), ServerError> {
    let project: SharedProjectId = path_id(path)?;
    let request = json_body(body)?;
    if matches!(request.role, ProjectRole::Owner | ProjectRole::Unknown) {
        return Err(ServerError::BadRequest(guests::GUEST_ROLES.to_string()));
    }
    let email = members::normalize_email(&request.email).ok_or_else(|| {
        ServerError::BadRequest("That email address doesn't look right.".to_string())
    })?;
    let account = auth.account_id;
    let now = state.clock.now_ms();
    let role = request.role;
    let mail = state.mailer.is_configured();
    let max_members = state.config.limits.max_members_per_project;
    let (invitation, accepted, wire, emailed) = state
        .db
        .call(move |conn| {
            let row = owner_of(conn, project, account)?;
            auth.require(ServerAction::ShareProjects)?;
            if row.status != ProjectStatus::Active {
                return Err(ServerError::Conflict(
                    "Share the project before inviting people.".to_string(),
                ));
            }
            let runtime = settings::load(conn)?;
            if !runtime.guests_enabled {
                return Err(ServerError::BadRequest(
                    "This server does not allow guests.".to_string(),
                ));
            }
            let transaction = conn.transaction()?;
            let created = guests::create(
                &transaction,
                project,
                &email,
                role,
                account,
                runtime.guest_approval_required,
                now,
            )?;
            log(
                &transaction,
                now,
                account,
                SecurityEventKind::GuestInvited,
                &created,
                ip.clone(),
            )?;
            let created = if created.status == GuestInvitationStatus::AwaitingApproval
                && auth.require(ServerAction::ApproveGuests).is_ok()
            {
                let approved = guests::approve(&transaction, &created.id, account, now)?;
                log(
                    &transaction,
                    now,
                    account,
                    SecurityEventKind::GuestInvitationApproved,
                    &approved,
                    ip,
                )?;
                approved
            } else {
                created
            };
            let accepted = guests::accept_existing(&transaction, &created, max_members, now)?;
            let current = guests::get(&transaction, &created.id)?.ok_or(ServerError::NotFound)?;
            let wire = guests::to_wire(&transaction, &current, now)?;
            let emailed = accepted.is_none() && guests::will_email(mail, &transaction, &email)?;
            transaction.commit()?;
            Ok((current, accepted, wire, emailed))
        })
        .await?;
    after_acceptance(&state, accepted, &invitation);
    Ok((
        StatusCode::CREATED,
        Json(GuestInviteResult {
            invitation: wire,
            emailed,
            add_link: guests::add_link(&state),
        }),
    ))
}

async fn owner_revoke(
    State(state): State<AppState>,
    auth: Authenticated,
    ClientIp(ip): ClientIp,
    path: Result<Path<(String, String)>, PathRejection>,
) -> Result<StatusCode, ServerError> {
    let (project, id) = invitation_path(path)?;
    let account = auth.account_id;
    let now = state.clock.now_ms();
    state
        .db
        .call(move |conn| {
            owner_of(conn, project, account)?;
            let found = guests::get(conn, &id)?.ok_or(ServerError::NotFound)?;
            if found.project != project {
                return Err(ServerError::NotFound);
            }
            let revoked = guests::revoke(conn, &id, account, now)?;
            log(
                conn,
                now,
                account,
                SecurityEventKind::GuestInvitationRevoked,
                &revoked,
                ip,
            )
        })
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn pending(
    State(state): State<AppState>,
    auth: Authenticated,
) -> Result<Json<Vec<GuestInvitation>>, ServerError> {
    auth.require(ServerAction::ApproveGuests)?;
    let now = state.clock.now_ms();
    let listed = state
        .db
        .call(move |conn| {
            let open = guests::open(conn, now)?;
            guests::to_wire_all(conn, &open, now)
        })
        .await?;
    Ok(Json(listed))
}

async fn approve(
    State(state): State<AppState>,
    auth: Authenticated,
    ClientIp(ip): ClientIp,
    path: Result<Path<String>, PathRejection>,
) -> Result<Json<GuestInvitation>, ServerError> {
    auth.require(ServerAction::ApproveGuests)?;
    let id: String = path_id(path)?;
    let actor = auth.account_id;
    let now = state.clock.now_ms();
    let max_members = state.config.limits.max_members_per_project;
    let (invitation, accepted, wire) = state
        .db
        .call(move |conn| {
            let transaction = conn.transaction()?;
            let approved = guests::approve(&transaction, &id, actor, now)?;
            log(
                &transaction,
                now,
                actor,
                SecurityEventKind::GuestInvitationApproved,
                &approved,
                ip,
            )?;
            let accepted = guests::accept_existing(&transaction, &approved, max_members, now)?;
            let current = guests::get(&transaction, &id)?.ok_or(ServerError::NotFound)?;
            let wire = guests::to_wire(&transaction, &current, now)?;
            transaction.commit()?;
            Ok((current, accepted, wire))
        })
        .await?;
    after_acceptance(&state, accepted, &invitation);
    Ok(Json(wire))
}

async fn decline(
    State(state): State<AppState>,
    auth: Authenticated,
    ClientIp(ip): ClientIp,
    path: Result<Path<String>, PathRejection>,
) -> Result<Json<GuestInvitation>, ServerError> {
    auth.require(ServerAction::ApproveGuests)?;
    let id: String = path_id(path)?;
    let actor = auth.account_id;
    let now = state.clock.now_ms();
    let wire = state
        .db
        .call(move |conn| {
            let declined = guests::decline(conn, &id, actor, now)?;
            log(
                conn,
                now,
                actor,
                SecurityEventKind::GuestInvitationDeclined,
                &declined,
                ip,
            )?;
            guests::to_wire(conn, &declined, now)
        })
        .await?;
    Ok(Json(wire))
}

async fn staff_revoke(
    State(state): State<AppState>,
    auth: Authenticated,
    ClientIp(ip): ClientIp,
    path: Result<Path<String>, PathRejection>,
) -> Result<StatusCode, ServerError> {
    auth.require(ServerAction::ApproveGuests)?;
    let id: String = path_id(path)?;
    let actor = auth.account_id;
    let now = state.clock.now_ms();
    state
        .db
        .call(move |conn| {
            let revoked = guests::revoke(conn, &id, actor, now)?;
            log(
                conn,
                now,
                actor,
                SecurityEventKind::GuestInvitationRevoked,
                &revoked,
                ip,
            )
        })
        .await?;
    Ok(StatusCode::NO_CONTENT)
}
