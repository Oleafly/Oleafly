use axum::body::Body;
use axum::extract::rejection::{JsonRejection, PathRejection, QueryRejection};
use axum::extract::{Path, Query, State};
use axum::http::{header, HeaderMap, HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post, put};
use axum::{Json, Router};
use oleafly_collab_protocol::admin::{RuntimeSettings, SecurityEventKind};
use oleafly_collab_protocol::auth::SessionEndReason;
use oleafly_collab_protocol::crypto::{b64url_decode, verify_ed25519};
use oleafly_collab_protocol::frames::{
    CommentSwitches, MemberChange, MemberChangeKind, ServerFrame,
};
use oleafly_collab_protocol::ids::{AccountId, SharedProjectId};
use oleafly_collab_protocol::projects::{
    project_role_allows, MemberGrant, NewProject, PersonSummary, ProjectAction, ProjectDevice,
    ProjectMember, ProjectPatch, ProjectRole, ProjectStatus, ProjectSummary,
};
use oleafly_collab_protocol::roles::{ServerAction, ServerRole};
use oleafly_collab_protocol::snapshots::{
    snapshot_signing_bytes, ProjectPeer, SNAPSHOT_DEVICE_HEADER, SNAPSHOT_SIGNATURE_HEADER,
};
use rusqlite::OptionalExtension;
use serde::Deserialize;
use serde_json::json;

use crate::access_log;
use crate::blobs::valid_hash;
use crate::error::ServerError;
use crate::guests;
use crate::mail::notify;
use crate::members;
use crate::peers;
use crate::projects::{self, ProjectRow};
use crate::removals;
use crate::routes::{json_body, path_id, Authenticated, ClientIp};
use crate::security_log::{self, NewSecurityEvent};
use crate::settings;
use crate::snapshots::{Signed, Upload};
use crate::state::AppState;

pub const SNAPSHOT_SEQ_HEADER: &str = "x-oleafly-snapshot-seq";
const MAX_TITLE_CHARS: usize = 200;
const REFUSALS_FOLDED_MS: i64 = crate::state::DAY_MS;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/v1/projects", get(list).post(create))
        .route("/api/v1/projects/{project}", get(show).patch(update))
        .route("/api/v1/projects/{project}/commit", post(commit))
        .route("/api/v1/projects/{project}/archive", post(archive))
        .route(
            "/api/v1/projects/{project}/join",
            get(preview_join).post(join_by_link),
        )
        .route(
            "/api/v1/projects/{project}/blobs/{hash}",
            put(put_blob).get(get_blob),
        )
        .route(
            "/api/v1/projects/{project}/snapshot",
            put(put_snapshot).get(get_snapshot).head(head_snapshot),
        )
        .route("/api/v1/projects/{project}/members", get(list_members))
        .route("/api/v1/projects/{project}/devices", get(list_devices))
        .route("/api/v1/projects/{project}/peers", get(list_peers))
        .route(
            "/api/v1/projects/{project}/members/{account}",
            put(grant_member).delete(remove_member),
        )
        .route("/api/v1/directory", get(directory))
}

fn two_ids<A: std::str::FromStr, B: std::str::FromStr>(
    path: Result<Path<(String, String)>, PathRejection>,
) -> Result<(A, B), ServerError> {
    let Path((first, second)) =
        path.map_err(|rejection| ServerError::BadRequest(rejection.body_text()))?;
    let first = first
        .parse::<A>()
        .map_err(|_| ServerError::BadRequest(format!("{first} is not a valid id.")))?;
    let second = second
        .parse::<B>()
        .map_err(|_| ServerError::BadRequest(format!("{second} is not a valid id.")))?;
    Ok((first, second))
}

fn project_and_hash(
    path: Result<Path<(String, String)>, PathRejection>,
) -> Result<(SharedProjectId, String), ServerError> {
    let Path((project, hash)) =
        path.map_err(|rejection| ServerError::BadRequest(rejection.body_text()))?;
    let project = project
        .parse::<SharedProjectId>()
        .map_err(|_| ServerError::BadRequest(format!("{project} is not a valid id.")))?;
    if !valid_hash(&hash) {
        return Err(ServerError::BadRequest(
            "A file hash must be 64 lowercase hex digits.".to_string(),
        ));
    }
    Ok((project, hash))
}

fn event(
    actor: AccountId,
    kind: SecurityEventKind,
    project: SharedProjectId,
    ip: Option<String>,
    detail: serde_json::Value,
) -> NewSecurityEvent {
    NewSecurityEvent {
        actor: Some(actor),
        kind,
        target: Some(project.to_string()),
        ip,
        detail,
    }
}

fn require(role: ProjectRole, action: ProjectAction) -> Result<(), ServerError> {
    if project_role_allows(role, action) {
        Ok(())
    } else {
        Err(ServerError::Forbidden)
    }
}

pub(crate) fn access(
    conn: &rusqlite::Connection,
    project: SharedProjectId,
    account: AccountId,
) -> Result<(ProjectRow, ProjectRole), ServerError> {
    let row = projects::project_row(conn, project)?.ok_or(ServerError::NotFound)?;
    let role = projects::role_of(conn, project, account)?.ok_or(ServerError::NotFound)?;
    if row.status == ProjectStatus::Pending && role != ProjectRole::Owner {
        return Err(ServerError::NotFound);
    }
    if row.status == ProjectStatus::Archived
        && role != ProjectRole::Owner
        && members::account_role(conn, account)? != Some(ServerRole::Admin)
    {
        return Err(ServerError::NotFound);
    }
    Ok((row, role))
}

fn content_length_within(headers: &HeaderMap, limit: u64) -> Result<(), ServerError> {
    let declared = headers
        .get(header::CONTENT_LENGTH)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.parse::<u64>().ok());
    match declared {
        Some(length) if length > limit => Err(ServerError::BadRequest(format!(
            "This file is larger than the server allows ({} MB).",
            limit / (1024 * 1024)
        ))),
        _ => Ok(()),
    }
}

fn megabytes(value: u64) -> u64 {
    value.saturating_mul(1024 * 1024)
}

async fn list(
    State(state): State<AppState>,
    auth: Authenticated,
) -> Result<Json<Vec<ProjectSummary>>, ServerError> {
    let account = auth.account_id;
    let listed = state
        .db
        .call(move |conn| projects::list_for_account(conn, account))
        .await?;
    Ok(Json(listed))
}

async fn create(
    State(state): State<AppState>,
    auth: Authenticated,
    body: Result<Json<NewProject>, JsonRejection>,
) -> Result<(StatusCode, Json<ProjectSummary>), ServerError> {
    auth.require(ServerAction::ShareProjects)?;
    let new = json_body(body)?;
    let title = new.title.trim().to_string();
    if title.is_empty() || title.chars().count() > MAX_TITLE_CHARS {
        return Err(ServerError::BadRequest(
            "A project needs a title of 1 to 200 characters.".to_string(),
        ));
    }
    let owner = auth.account_id;
    let now = state.clock.now_ms();
    let created = state
        .db
        .call(move |conn| {
            let id = projects::create_pending(conn, owner, &title, now)?;
            let row = projects::project_row(conn, id)?.ok_or(ServerError::NotFound)?;
            projects::summary(conn, &row, ProjectRole::Owner)
        })
        .await?;
    Ok((StatusCode::CREATED, Json(created)))
}

async fn show(
    State(state): State<AppState>,
    auth: Authenticated,
    path: Result<Path<String>, PathRejection>,
) -> Result<Json<ProjectSummary>, ServerError> {
    let project: SharedProjectId = path_id(path)?;
    let account = auth.account_id;
    let shown = state
        .db
        .call(move |conn| {
            let (row, role) = access(conn, project, account)?;
            projects::summary(conn, &row, role)
        })
        .await?;
    Ok(Json(shown))
}

async fn update(
    State(state): State<AppState>,
    auth: Authenticated,
    ClientIp(ip): ClientIp,
    path: Result<Path<String>, PathRejection>,
    body: Result<Json<ProjectPatch>, JsonRejection>,
) -> Result<Json<ProjectSummary>, ServerError> {
    let project: SharedProjectId = path_id(path)?;
    let patch = json_body(body)?;
    if matches!(patch.link_role, Some(ProjectRole::Owner)) {
        return Err(ServerError::BadRequest(
            "A link can give Editor or Viewer access, not Owner.".to_string(),
        ));
    }
    if matches!(patch.link_role, Some(ProjectRole::Unknown)) {
        return Err(ServerError::BadRequest(
            "A link can give Editor or Viewer access.".to_string(),
        ));
    }
    if let Some(title) = &patch.title {
        let trimmed = title.trim();
        if trimmed.is_empty() || trimmed.chars().count() > MAX_TITLE_CHARS {
            return Err(ServerError::BadRequest(
                "A project needs a title of 1 to 200 characters.".to_string(),
            ));
        }
    }
    let account = auth.account_id;
    let now = state.clock.now_ms();
    let comments_switched = patch.comments_enabled.is_some();
    let updated = state
        .db
        .call(move |conn| {
            let (_, role) = access(conn, project, account)?;
            require(role, ProjectAction::ChangeLinkSharing)?;
            if patch.link_sharing == Some(true) && !settings::load(conn)?.link_sharing_allowed {
                return Err(ServerError::refused(
                    "link_sharing_off",
                    "This server does not allow link sharing.",
                ));
            }
            if patch.access_log == Some(true) && !settings::load(conn)?.access_logs_allowed {
                return Err(ServerError::refused(
                    "access_log_off",
                    "This server does not allow access logs.",
                ));
            }
            let trimmed = ProjectPatch {
                title: patch.title.as_ref().map(|title| title.trim().to_string()),
                ..patch.clone()
            };
            projects::apply_patch(conn, project, &trimmed)?;
            if patch.link_sharing.is_some() || patch.link_role.is_some() {
                security_log::record(
                    conn,
                    now,
                    event(
                        account,
                        SecurityEventKind::ProjectAccessChanged,
                        project,
                        ip.clone(),
                        json!({ "link_sharing": patch.link_sharing, "link_role": patch.link_role }),
                    ),
                )?;
            }
            if let Some(comments) = patch.comments_enabled {
                security_log::record(
                    conn,
                    now,
                    event(
                        account,
                        SecurityEventKind::ProjectSettingsChanged,
                        project,
                        ip.clone(),
                        json!({ "comments_enabled": comments }),
                    ),
                )?;
            }
            if let Some(access_log) = patch.access_log {
                security_log::record(
                    conn,
                    now,
                    event(
                        account,
                        SecurityEventKind::ProjectSettingsChanged,
                        project,
                        ip,
                        json!({ "access_log": access_log }),
                    ),
                )?;
            }
            let row = projects::project_row(conn, project)?.ok_or(ServerError::NotFound)?;
            projects::summary(conn, &row, role)
        })
        .await?;
    if comments_switched {
        tell_comment_switches(&state, project).await;
    }
    Ok(Json(updated))
}

pub(crate) async fn tell_comment_switches(state: &AppState, project: SharedProjectId) {
    let accounts = state.rooms.accounts(project);
    if accounts.is_empty() {
        return;
    }
    let found = state
        .db
        .call(move |conn| {
            let switches = CommentSwitches {
                server: settings::load(conn)?.comments_allowed,
                project: projects::project_row(conn, project)?
                    .is_some_and(|row| row.comments_enabled),
            };
            let roles = accounts
                .into_iter()
                .map(|account| Ok((account, projects::role_of(conn, project, account)?)))
                .collect::<Result<Vec<_>, ServerError>>()?;
            Ok((switches, roles))
        })
        .await;
    let (switches, roles) = match found {
        Ok(found) => found,
        Err(error) => {
            tracing::warn!(
                "could not tell a project's members that comments were switched: {error}"
            );
            return;
        }
    };
    for (account, role) in roles {
        if let Some(role) = role {
            state.rooms.notify_account(
                project,
                account,
                &ServerFrame::AccessChanged {
                    project_id: project,
                    role: Some(role),
                    change: None,
                    comments: Some(switches),
                },
            );
        }
    }
}

async fn commit(
    State(state): State<AppState>,
    auth: Authenticated,
    ClientIp(ip): ClientIp,
    path: Result<Path<String>, PathRejection>,
) -> Result<Json<ProjectSummary>, ServerError> {
    let project: SharedProjectId = path_id(path)?;
    let account = auth.account_id;
    let now = state.clock.now_ms();
    let committed = state
        .db
        .call(move |conn| {
            let (row, role) = access(conn, project, account)?;
            if role != ProjectRole::Owner {
                return Err(ServerError::Forbidden);
            }
            if row.status == ProjectStatus::Pending {
                if projects::latest_snapshot(conn, project)?.is_none() {
                    return Err(ServerError::BadRequest(
                        "Upload the project's first snapshot before sharing it.".to_string(),
                    ));
                }
                projects::set_status(conn, project, ProjectStatus::Active, now)?;
                security_log::record(
                    conn,
                    now,
                    event(
                        account,
                        SecurityEventKind::ProjectShared,
                        project,
                        ip,
                        json!({ "title": row.title }),
                    ),
                )?;
            } else if row.status != ProjectStatus::Active {
                return Err(ServerError::Conflict(
                    "This project is no longer shared.".to_string(),
                ));
            }
            let row = projects::project_row(conn, project)?.ok_or(ServerError::NotFound)?;
            projects::summary(conn, &row, role)
        })
        .await?;
    Ok(Json(committed))
}

async fn archive(
    State(state): State<AppState>,
    auth: Authenticated,
    ClientIp(ip): ClientIp,
    path: Result<Path<String>, PathRejection>,
) -> Result<StatusCode, ServerError> {
    let project: SharedProjectId = path_id(path)?;
    let account = auth.account_id;
    let now = state.clock.now_ms();
    state
        .db
        .call(move |conn| {
            let (row, role) = access(conn, project, account)?;
            require(role, ProjectAction::StopSharing)?;
            if row.status == ProjectStatus::Archived {
                return Ok(());
            }
            projects::set_status(conn, project, ProjectStatus::Archived, now)?;
            security_log::record(
                conn,
                now,
                event(
                    account,
                    SecurityEventKind::ProjectArchived,
                    project,
                    ip,
                    json!({ "title": row.title }),
                ),
            )?;
            Ok(())
        })
        .await?;
    let frame = ServerFrame::ProjectArchived {
        project_id: project,
    };
    for member in state.rooms.close_room(project) {
        crate::rooms::deliver(&member, frame.clone());
    }
    Ok(StatusCode::NO_CONTENT)
}

fn by_link(
    conn: &rusqlite::Connection,
    project: SharedProjectId,
    account: AccountId,
    ip: Option<String>,
    now: i64,
    limit: u32,
) -> Result<(ProjectRow, Option<ProjectRole>), ServerError> {
    let row = projects::project_row(conn, project)?.ok_or(ServerError::NotFound)?;
    if row.status != ProjectStatus::Active {
        return Err(ServerError::NotFound);
    }
    if let Some(role) = projects::role_of(conn, project, account)? {
        return Ok((row, Some(role)));
    }
    if !row.link_sharing
        || !settings::load(conn)?.link_sharing_allowed
        || !projects::account_can_join(conn, account)?
    {
        return Err(ServerError::NotFound);
    }
    if removals::is_removed(conn, project, account)? {
        note_rejoin_refused(conn, project, account, ip, now)?;
        return Err(ServerError::NotFound);
    }
    if projects::member_count(conn, project)? >= limit {
        return Err(project_full(limit));
    }
    Ok((row, None))
}

fn project_full(limit: u32) -> ServerError {
    ServerError::refused(
        "project_full",
        format!("A project on this server can have at most {limit} people."),
    )
}

fn note_rejoin_refused(
    conn: &rusqlite::Connection,
    project: SharedProjectId,
    account: AccountId,
    ip: Option<String>,
    now: i64,
) -> Result<(), ServerError> {
    let kind = security_log::kind_to_str(&SecurityEventKind::ProjectRejoinRefused);
    let earlier: Option<i64> = conn
        .query_row(
            "SELECT id FROM security_log WHERE kind = ?1 AND actor = ?2 AND target = ?3 AND at > ?4 ORDER BY id DESC LIMIT 1",
            rusqlite::params![
                kind,
                account.to_string(),
                project.to_string(),
                now - REFUSALS_FOLDED_MS
            ],
            |row| row.get(0),
        )
        .optional()?;
    if let Some(id) = earlier {
        conn.execute(
            "UPDATE security_log SET detail = json_set(detail, '$.count', COALESCE(json_extract(detail, '$.count'), 1) + 1, '$.last_at', ?2) WHERE id = ?1",
            rusqlite::params![id, now],
        )?;
        return Ok(());
    }
    security_log::record(
        conn,
        now,
        event(
            account,
            SecurityEventKind::ProjectRejoinRefused,
            project,
            ip,
            json!({ "via": "link", "count": 1 }),
        ),
    )?;
    Ok(())
}

fn join_allowed(state: &AppState, account: AccountId) -> Result<(), ServerError> {
    if state
        .join_limiter
        .allow(&account.to_string(), state.clock.now_ms())
    {
        Ok(())
    } else {
        Err(ServerError::RateLimited)
    }
}

async fn preview_join(
    State(state): State<AppState>,
    auth: Authenticated,
    ClientIp(ip): ClientIp,
    path: Result<Path<String>, PathRejection>,
) -> Result<Json<ProjectSummary>, ServerError> {
    let project: SharedProjectId = path_id(path)?;
    let account = auth.account_id;
    join_allowed(&state, account)?;
    let now = state.clock.now_ms();
    let limit = state.config.limits.max_members_per_project;
    let shown = state
        .db
        .call(move |conn| {
            let (row, member) = by_link(conn, project, account, ip, now, limit)?;
            projects::summary(conn, &row, member.unwrap_or(row.link_role))
        })
        .await?;
    Ok(Json(shown))
}

async fn join_by_link(
    State(state): State<AppState>,
    auth: Authenticated,
    ClientIp(ip): ClientIp,
    path: Result<Path<String>, PathRejection>,
) -> Result<Json<ProjectSummary>, ServerError> {
    let project: SharedProjectId = path_id(path)?;
    let account = auth.account_id;
    join_allowed(&state, account)?;
    let device = auth.device_id;
    let now = state.clock.now_ms();
    let limit = state.config.limits.max_members_per_project;
    let (joined, newly) = state
        .db
        .call(move |conn| {
            let (row, member) = by_link(conn, project, account, ip.clone(), now, limit)?;
            if let Some(role) = member {
                return Ok((projects::summary(conn, &row, role)?, false));
            }
            projects::grant(conn, project, account, row.link_role, row.owner, now)?;
            access_log::quietly(access_log::joined_by_link(
                conn, now, project, account, device,
            ));
            security_log::record(
                conn,
                now,
                event(
                    account,
                    SecurityEventKind::ProjectAccessGranted,
                    project,
                    ip,
                    json!({ "role": projects::role_to_str(row.link_role), "via": "link" }),
                ),
            )?;
            Ok((projects::summary(conn, &row, row.link_role)?, true))
        })
        .await?;
    if newly {
        let change = MemberChange {
            account_id: account,
            by: account,
            kind: MemberChangeKind::Added,
        };
        tell_members(&state, project, change).await;
    }
    Ok(Json(joined))
}

async fn put_blob(
    State(state): State<AppState>,
    auth: Authenticated,
    path: Result<Path<(String, String)>, PathRejection>,
    headers: HeaderMap,
    body: Body,
) -> Result<StatusCode, ServerError> {
    let (project, hash) = project_and_hash(path)?;
    let limit = megabytes(state.config.limits.max_file_mb);
    content_length_within(&headers, limit)?;
    let account = auth.account_id;
    state
        .db
        .call(move |conn| {
            let (row, role) = access(conn, project, account)?;
            require(role, ProjectAction::Edit)?;
            if row.status == ProjectStatus::Archived {
                return Err(ServerError::Conflict(
                    "This project is no longer shared.".to_string(),
                ));
            }
            Ok(())
        })
        .await?;
    let Some(body) = state.transfers.read_body(body, &headers, limit).await? else {
        return Err(ServerError::BadRequest(format!(
            "This file is larger than the server allows ({} MB).",
            state.config.limits.max_file_mb
        )));
    };
    let now = state.clock.now_ms();
    crate::blobs::cleanup::upload(&state.db, &state.blobs, project, &hash, body, now).await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn get_blob(
    State(state): State<AppState>,
    auth: Authenticated,
    path: Result<Path<(String, String)>, PathRejection>,
) -> Result<Response, ServerError> {
    let (project, hash) = project_and_hash(path)?;
    let account = auth.account_id;
    let lookup = hash.clone();
    state
        .db
        .call(move |conn| {
            access(conn, project, account)?;
            if projects::has_blob(conn, project, &lookup)? {
                Ok(())
            } else {
                Err(ServerError::NotFound)
            }
        })
        .await?;
    let bytes = state.blobs.get(&hash).await?.ok_or(ServerError::NotFound)?;
    Ok((
        [(
            header::CONTENT_TYPE,
            HeaderValue::from_static("application/octet-stream"),
        )],
        bytes,
    )
        .into_response())
}

#[derive(Deserialize)]
struct SnapshotQuery {
    seq: u64,
}

fn snapshot_signature(
    headers: &HeaderMap,
    project: SharedProjectId,
    bytes: &[u8],
    public_key: &str,
) -> Result<Option<String>, ServerError> {
    let Some(value) = headers.get(SNAPSHOT_SIGNATURE_HEADER) else {
        return Ok(None);
    };
    let refused =
        || ServerError::BadRequest("This snapshot is not signed by this device.".to_string());
    let signature = value.to_str().map_err(|_| refused())?.to_string();
    let decoded = b64url_decode(&signature).map_err(|_| refused())?;
    let key = b64url_decode(public_key).map_err(|_| refused())?;
    let digest = ring::digest::digest(&ring::digest::SHA256, bytes);
    let signed = snapshot_signing_bytes(project, 0, digest.as_ref());
    if verify_ed25519(&key, &signed, &decoded) {
        Ok(Some(signature))
    } else {
        Err(refused())
    }
}

async fn put_snapshot(
    State(state): State<AppState>,
    auth: Authenticated,
    path: Result<Path<String>, PathRejection>,
    query: Result<Query<SnapshotQuery>, QueryRejection>,
    headers: HeaderMap,
    body: Body,
) -> Result<Response, ServerError> {
    let project: SharedProjectId = path_id(path)?;
    let Query(SnapshotQuery { seq }) =
        query.map_err(|rejection| ServerError::BadRequest(rejection.body_text()))?;
    let limit = megabytes(state.config.limits.max_project_mb);
    let too_large = || {
        ServerError::BadRequest(format!(
            "A snapshot must hold between 1 byte and {} MB.",
            state.config.limits.max_project_mb
        ))
    };
    content_length_within(&headers, limit)?;
    let (account, device) = (auth.account_id, auth.device_id);
    let (first, public_key) = state
        .db
        .call(move |conn| {
            let (row, role) = access(conn, project, account)?;
            require(role, ProjectAction::UploadSnapshot)?;
            if row.status == ProjectStatus::Archived {
                return Err(ServerError::Conflict(
                    "This project is no longer shared.".to_string(),
                ));
            }
            if seq > row.head_seq {
                return Err(ServerError::BadRequest(
                    "A snapshot cannot cover updates the server has not stored.".to_string(),
                ));
            }
            let first = projects::latest_snapshot(conn, project)?.is_none();
            let public_key = crate::auth::devices::find(conn, device)?
                .map(|found| found.public_key)
                .ok_or(ServerError::Unauthorized)?;
            Ok((first, public_key))
        })
        .await?;
    let bytes = state
        .transfers
        .read_body(body, &headers, limit)
        .await?
        .ok_or_else(too_large)?;
    let now = state.clock.now_ms();
    let held = if first {
        if bytes.is_empty() {
            return Err(too_large());
        }
        let checked = bytes.clone();
        let reach = tokio::task::spawn_blocking(move || peers::snapshot_reach(&checked))
            .await
            .map_err(|error| ServerError::Internal(format!("a snapshot task failed: {error}")))?
            .ok_or_else(|| {
                ServerError::BadRequest("This is not an Oleafly project snapshot.".to_string())
            })?;
        let signed = snapshot_signature(&headers, project, &bytes, &public_key)?
            .map(|signature| Signed { device, signature });
        let uploaded = state
            .snapshots
            .upload_first(&state.db, project, bytes, account, signed, now)
            .await?;
        if uploaded == Upload::Stored {
            state
                .db
                .call(move |conn| {
                    peers::bind_first_snapshot(conn, project, device, account, &reach, now)
                })
                .await?;
        }
        match uploaded {
            Upload::Stored => 0,
            Upload::Held(held) => held,
        }
    } else {
        match state
            .snapshots
            .derive(&state.db, project, seq, account, now)
            .await?
        {
            Upload::Stored => seq,
            Upload::Held(held) => held,
        }
    };
    Ok((
        StatusCode::NO_CONTENT,
        [(SNAPSHOT_SEQ_HEADER, seq_value(held)?)],
    )
        .into_response())
}

fn seq_value(seq: u64) -> Result<HeaderValue, ServerError> {
    HeaderValue::from_str(&seq.to_string())
        .map_err(|error| ServerError::Internal(error.to_string()))
}

async fn head_snapshot(
    State(state): State<AppState>,
    auth: Authenticated,
    path: Result<Path<String>, PathRejection>,
) -> Result<Response, ServerError> {
    let project: SharedProjectId = path_id(path)?;
    let account = auth.account_id;
    let newest = state
        .db
        .call(move |conn| {
            access(conn, project, account)?;
            projects::latest_snapshot(conn, project)?.ok_or(ServerError::NotFound)
        })
        .await?;
    Ok((
        [(SNAPSHOT_SEQ_HEADER, seq_value(newest.seq)?)],
        StatusCode::OK,
    )
        .into_response())
}

#[derive(Deserialize)]
struct DownloadQuery {
    before: Option<u64>,
}

async fn get_snapshot(
    State(state): State<AppState>,
    auth: Authenticated,
    path: Result<Path<String>, PathRejection>,
    query: Result<Query<DownloadQuery>, QueryRejection>,
) -> Result<Response, ServerError> {
    let project: SharedProjectId = path_id(path)?;
    let Query(DownloadQuery { before }) =
        query.map_err(|rejection| ServerError::BadRequest(rejection.body_text()))?;
    let account = auth.account_id;
    state
        .db
        .call(move |conn| access(conn, project, account).map(|_| ()))
        .await?;
    let loaded = match before {
        Some(before) => {
            state
                .snapshots
                .load_before(&state.db, project, before)
                .await?
        }
        None => state.snapshots.load(&state.db, project).await?,
    }
    .ok_or(ServerError::NotFound)?;
    access_log::note_download(&state, project, account, auth.device_id).await;
    let mut headers = HeaderMap::new();
    headers.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("application/octet-stream"),
    );
    headers.insert(
        header::HeaderName::from_static(SNAPSHOT_SEQ_HEADER),
        seq_value(loaded.seq)?,
    );
    if let Some(signed) = &loaded.signed {
        if let (Ok(device), Ok(signature)) = (
            HeaderValue::from_str(&signed.device.to_string()),
            HeaderValue::from_str(&signed.signature),
        ) {
            headers.insert(
                header::HeaderName::from_static(SNAPSHOT_DEVICE_HEADER),
                device,
            );
            headers.insert(
                header::HeaderName::from_static(SNAPSHOT_SIGNATURE_HEADER),
                signature,
            );
        }
    }
    Ok((headers, loaded.bytes).into_response())
}

pub(crate) fn sees_emails(role: ServerRole, settings: &RuntimeSettings) -> bool {
    match role {
        ServerRole::Guest | ServerRole::Unknown => false,
        ServerRole::Admin | ServerRole::Maintainer => true,
        ServerRole::Member => settings.directory_shows_email,
    }
}

async fn list_members(
    State(state): State<AppState>,
    auth: Authenticated,
    path: Result<Path<String>, PathRejection>,
) -> Result<Json<Vec<ProjectMember>>, ServerError> {
    let project: SharedProjectId = path_id(path)?;
    let account = auth.account_id;
    let server_role = auth.role;
    let listed = state
        .db
        .call(move |conn| {
            access(conn, project, account)?;
            let emails = sees_emails(server_role, &settings::load(conn)?);
            projects::members(conn, project, emails)
        })
        .await?;
    Ok(Json(listed))
}

async fn list_devices(
    State(state): State<AppState>,
    auth: Authenticated,
    path: Result<Path<String>, PathRejection>,
) -> Result<Json<Vec<ProjectDevice>>, ServerError> {
    let project: SharedProjectId = path_id(path)?;
    let account = auth.account_id;
    let listed = state
        .db
        .call(move |conn| {
            access(conn, project, account)?;
            projects::devices(conn, project)
        })
        .await?;
    Ok(Json(listed))
}

async fn list_peers(
    State(state): State<AppState>,
    auth: Authenticated,
    path: Result<Path<String>, PathRejection>,
) -> Result<Json<Vec<ProjectPeer>>, ServerError> {
    let project: SharedProjectId = path_id(path)?;
    let account = auth.account_id;
    let listed = state
        .db
        .call(move |conn| {
            access(conn, project, account)?;
            peers::table(conn, project)
        })
        .await?;
    Ok(Json(listed))
}

async fn grant_member(
    State(state): State<AppState>,
    auth: Authenticated,
    ClientIp(ip): ClientIp,
    path: Result<Path<(String, String)>, PathRejection>,
    body: Result<Json<MemberGrant>, JsonRejection>,
) -> Result<Json<ProjectMember>, ServerError> {
    let (project, target): (SharedProjectId, AccountId) = two_ids(path)?;
    let MemberGrant { role } = json_body(body)?;
    if role == ProjectRole::Owner {
        return Err(ServerError::BadRequest(
            "Ownership cannot be given away yet. Choose Editor or Viewer.".to_string(),
        ));
    }
    if role == ProjectRole::Unknown {
        return Err(ServerError::BadRequest(
            "This server doesn't know that role. Choose Editor or Viewer.".to_string(),
        ));
    }
    auth.require(ServerAction::ShareProjects)?;
    let account = auth.account_id;
    let server_role = auth.role;
    let limit = state.config.limits.max_members_per_project;
    let now = state.clock.now_ms();
    let (granted, existing) = state
        .db
        .call(move |conn| {
            let (row, actor_role) = access(conn, project, account)?;
            require(actor_role, ProjectAction::ManageMembers)?;
            if row.status != ProjectStatus::Active {
                return Err(ServerError::refused(
                    "project_not_shared",
                    "Share the project before adding people.",
                ));
            }
            if target == row.owner {
                return Err(ServerError::BadRequest(
                    "The owner's role cannot change.".to_string(),
                ));
            }
            let existing = projects::role_of(conn, project, target)?;
            let joinable = match existing {
                Some(_) => projects::account_is_active(conn, target)?,
                None => projects::account_can_join(conn, target)?,
            };
            if !joinable {
                return Err(ServerError::NotFound);
            }
            if existing.is_none() && projects::member_count(conn, project)? >= limit {
                return Err(project_full(limit));
            }
            projects::grant(conn, project, target, role, account, now)?;
            removals::clear(conn, project, target)?;
            security_log::record(
                conn,
                now,
                NewSecurityEvent {
                    actor: Some(account),
                    kind: if existing.is_some() {
                        SecurityEventKind::ProjectAccessChanged
                    } else {
                        SecurityEventKind::ProjectAccessGranted
                    },
                    target: Some(target.to_string()),
                    ip,
                    detail: json!({ "project": project.to_string(), "role": projects::role_to_str(role) }),
                },
            )?;
            let emails = sees_emails(server_role, &settings::load(conn)?);
            let person = projects::person(conn, target, emails)?.ok_or(ServerError::NotFound)?;
            Ok((
                ProjectMember {
                    person,
                    role,
                    granted_at: now,
                },
                existing,
            ))
        })
        .await?;
    let change = (existing != Some(role)).then_some(MemberChange {
        account_id: target,
        by: account,
        kind: if existing.is_none() {
            MemberChangeKind::Added
        } else {
            MemberChangeKind::RoleChanged
        },
    });
    state.rooms.notify_account(
        project,
        target,
        &ServerFrame::AccessChanged {
            project_id: project,
            role: Some(role),
            change,
            comments: None,
        },
    );
    if let Some(change) = change {
        tell_members(&state, project, change).await;
    }
    if existing.is_none() {
        notify::shared_with_you(&state, project, target, account, role);
    }
    Ok(Json(granted))
}

async fn tell_members(state: &AppState, project: SharedProjectId, change: MemberChange) {
    let accounts: Vec<AccountId> = state
        .rooms
        .accounts(project)
        .into_iter()
        .filter(|account| *account != change.account_id)
        .collect();
    if accounts.is_empty() {
        return;
    }
    let roles = state
        .db
        .call(move |conn| {
            accounts
                .into_iter()
                .map(|account| Ok((account, projects::role_of(conn, project, account)?)))
                .collect::<Result<Vec<_>, ServerError>>()
        })
        .await;
    let roles = match roles {
        Ok(roles) => roles,
        Err(error) => {
            tracing::warn!("could not tell a project's members that its people changed: {error}");
            return;
        }
    };
    for (account, role) in roles {
        if let Some(role) = role {
            state.rooms.notify_account(
                project,
                account,
                &ServerFrame::AccessChanged {
                    project_id: project,
                    role: Some(role),
                    change: Some(change),
                    comments: None,
                },
            );
        }
    }
}

async fn remove_member(
    State(state): State<AppState>,
    auth: Authenticated,
    ClientIp(ip): ClientIp,
    path: Result<Path<(String, String)>, PathRejection>,
) -> Result<StatusCode, ServerError> {
    let (project, target): (SharedProjectId, AccountId) = two_ids(path)?;
    let account = auth.account_id;
    let now = state.clock.now_ms();
    let signed_out = state
        .db
        .call(move |conn| {
            let (row, actor_role) = access(conn, project, account)?;
            if target == row.owner {
                return Err(ServerError::BadRequest(
                    "The owner cannot leave. Stop sharing the project instead.".to_string(),
                ));
            }
            if target != account {
                require(actor_role, ProjectAction::ManageMembers)?;
            }
            let transaction = conn.transaction()?;
            if !projects::revoke(&transaction, project, target)? {
                return Err(ServerError::NotFound);
            }
            if target != account {
                removals::record(&transaction, project, target, account, now)?;
            }
            security_log::record(
                &transaction,
                now,
                NewSecurityEvent {
                    actor: Some(account),
                    kind: SecurityEventKind::ProjectAccessRemoved,
                    target: Some(target.to_string()),
                    ip: ip.clone(),
                    detail: json!({ "project": project.to_string(), "left": target == account }),
                },
            )?;
            let signed_out = guests::end_if_no_access(&transaction, target, account, ip, now)?;
            transaction.commit()?;
            Ok(signed_out)
        })
        .await?;
    for device in signed_out {
        state
            .end_device_session(device, SessionEndReason::AccessEnded)
            .await?;
    }
    let change = MemberChange {
        account_id: target,
        by: account,
        kind: MemberChangeKind::Removed,
    };
    let frame = ServerFrame::AccessChanged {
        project_id: project,
        role: None,
        change: Some(change),
        comments: None,
    };
    for member in state.rooms.remove_account(project, target) {
        crate::rooms::deliver(&member, frame.clone());
        state.rooms.broadcast(
            project,
            None,
            &ServerFrame::PresenceLeft {
                project_id: project,
                device_id: member.device,
            },
        );
    }
    tell_members(&state, project, change).await;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Deserialize)]
struct DirectoryQuery {
    #[serde(default)]
    q: String,
}

async fn directory(
    State(state): State<AppState>,
    auth: Authenticated,
    query: Result<Query<DirectoryQuery>, QueryRejection>,
) -> Result<Json<Vec<PersonSummary>>, ServerError> {
    if auth.role == ServerRole::Guest {
        return Ok(Json(Vec::new()));
    }
    auth.require(ServerAction::SeeDirectory)?;
    let Query(DirectoryQuery { q }) =
        query.map_err(|rejection| ServerError::BadRequest(rejection.body_text()))?;
    let account = auth.account_id;
    let role = auth.role;
    let found = state
        .db
        .call(move |conn| {
            let settings = settings::load(conn)?;
            let staff = matches!(role, ServerRole::Admin | ServerRole::Maintainer);
            if !settings.directory_visible && !staff {
                return projects::exact_email(conn, &q, account);
            }
            projects::directory(conn, &q, sees_emails(role, &settings), account)
        })
        .await?;
    Ok(Json(found))
}

#[cfg(test)]
mod tests {
    use axum::body::Body;
    use axum::http::{Method, Request, StatusCode};
    use oleafly_collab_protocol::admin::RuntimeSettingsPatch;
    use oleafly_collab_protocol::ids::SharedProjectId;
    use oleafly_collab_protocol::projects::{ProjectPatch, ProjectStatus};
    use oleafly_collab_protocol::roles::ServerRole;
    use serde_json::{json, Value};
    use tower::ServiceExt;

    use crate::clock::Clock;
    use crate::projects;
    use crate::settings;
    use crate::test_support::{seed_member, test_app_with, test_config, SeededMember, TestApp};

    async fn refusal(
        app: &TestApp,
        method: Method,
        path: &str,
        token: &str,
        body: Value,
    ) -> (StatusCode, String) {
        let request = Request::builder()
            .method(method)
            .uri(path)
            .header("authorization", format!("Bearer {token}"))
            .header("content-type", "application/json")
            .body(Body::from(body.to_string()))
            .expect("request");
        let response = app.router.clone().oneshot(request).await.expect("response");
        let status = response.status();
        let bytes = axum::body::to_bytes(response.into_body(), 64 * 1024)
            .await
            .expect("body");
        let body: Value = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
        (status, body["code"].as_str().unwrap_or_default().to_owned())
    }

    async fn project(app: &TestApp, owner: &SeededMember, active: bool) -> SharedProjectId {
        let (owner, now) = (owner.account_id, app.clock.now_ms());
        app.state
            .db
            .call(move |conn| {
                let project = projects::create_pending(conn, owner, "Thesis", now)?;
                if active {
                    projects::set_status(conn, project, ProjectStatus::Active, now)?;
                }
                Ok(project)
            })
            .await
            .expect("a project")
    }

    async fn allow(app: &TestApp, allowed: bool) {
        app.state
            .db
            .call(move |conn| {
                let patch = RuntimeSettingsPatch {
                    link_sharing_allowed: Some(allowed),
                    access_logs_allowed: Some(allowed),
                    ..RuntimeSettingsPatch::default()
                };
                settings::patch(conn, &patch).map(|_| ())
            })
            .await
            .expect("settings");
    }

    #[tokio::test]
    async fn refusals_a_person_can_cause_carry_their_own_codes() {
        let mut config = test_config();
        config.limits.max_members_per_project = 1;
        let app = test_app_with(config).await;
        let owner = seed_member(&app, ServerRole::Member).await;
        let other = seed_member(&app, ServerRole::Member).await;
        let pending = project(&app, &owner, false).await;
        let active = project(&app, &owner, true).await;
        let conflict = |code: &str| (StatusCode::CONFLICT, code.to_owned());
        allow(&app, false).await;
        let patch = format!("/api/v1/projects/{active}");
        assert_eq!(
            refusal(
                &app,
                Method::PATCH,
                &patch,
                &owner.access_token,
                json!({ "link_sharing": true })
            )
            .await,
            conflict("link_sharing_off")
        );
        assert_eq!(
            refusal(
                &app,
                Method::PATCH,
                &patch,
                &owner.access_token,
                json!({ "access_log": true })
            )
            .await,
            conflict("access_log_off")
        );
        let add = |project: SharedProjectId| {
            format!("/api/v1/projects/{project}/members/{}", other.account_id)
        };
        assert_eq!(
            refusal(
                &app,
                Method::PUT,
                &add(pending),
                &owner.access_token,
                json!({ "role": "editor" })
            )
            .await,
            conflict("project_not_shared")
        );
        assert_eq!(
            refusal(
                &app,
                Method::PUT,
                &add(active),
                &owner.access_token,
                json!({ "role": "editor" })
            )
            .await,
            conflict("project_full")
        );
        allow(&app, true).await;
        app.state
            .db
            .call(move |conn| {
                let patch = ProjectPatch {
                    link_sharing: Some(true),
                    ..ProjectPatch::default()
                };
                projects::apply_patch(conn, active, &patch)
            })
            .await
            .expect("link sharing on");
        let join = format!("/api/v1/projects/{active}/join");
        assert_eq!(
            refusal(&app, Method::POST, &join, &other.access_token, json!({})).await,
            conflict("project_full")
        );
    }
}
