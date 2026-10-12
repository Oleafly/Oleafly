use axum::body::Bytes;
use axum::extract::rejection::{JsonRejection, PathRejection, QueryRejection};
use axum::extract::{DefaultBodyLimit, Path, Query, State};
use axum::http::{header, HeaderMap, HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post, put};
use axum::{Json, Router};
use oleafly_collab_protocol::admin::SecurityEventKind;
use oleafly_collab_protocol::frames::ServerFrame;
use oleafly_collab_protocol::ids::{AccountId, SharedProjectId};
use oleafly_collab_protocol::projects::{
    project_role_allows, MemberGrant, NewProject, PersonSummary, ProjectAction, ProjectDevice,
    ProjectMember, ProjectPatch, ProjectRole, ProjectStatus, ProjectSummary,
};
use oleafly_collab_protocol::roles::{ServerAction, ServerRole};
use serde::Deserialize;
use serde_json::json;

use crate::blobs::{valid_hash, write_atomically};
use crate::error::ServerError;
use crate::projects::{self, ProjectRow};
use crate::routes::{json_body, path_id, Authenticated, ClientIp};
use crate::security_log::{self, NewSecurityEvent};
use crate::settings;
use crate::state::AppState;

pub const SNAPSHOT_SEQ_HEADER: &str = "x-oleafly-snapshot-seq";
const MAX_UPLOAD_BYTES: usize = 1 << 30;
const MAX_TITLE_CHARS: usize = 200;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/v1/projects", get(list).post(create))
        .route("/api/v1/projects/{project}", get(show).patch(update))
        .route("/api/v1/projects/{project}/commit", post(commit))
        .route("/api/v1/projects/{project}/archive", post(archive))
        .route("/api/v1/projects/{project}/join", post(join_by_link))
        .route(
            "/api/v1/projects/{project}/blobs/{hash}",
            put(put_blob)
                .get(get_blob)
                .route_layer(DefaultBodyLimit::max(MAX_UPLOAD_BYTES)),
        )
        .route(
            "/api/v1/projects/{project}/snapshot",
            put(put_snapshot)
                .get(get_snapshot)
                .route_layer(DefaultBodyLimit::max(MAX_UPLOAD_BYTES)),
        )
        .route("/api/v1/projects/{project}/members", get(list_members))
        .route("/api/v1/projects/{project}/devices", get(list_devices))
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

fn access(
    conn: &rusqlite::Connection,
    project: SharedProjectId,
    account: AccountId,
) -> Result<(ProjectRow, ProjectRole), ServerError> {
    let row = projects::project_row(conn, project)?.ok_or(ServerError::NotFound)?;
    let role = projects::role_of(conn, project, account)?.ok_or(ServerError::NotFound)?;
    if row.status == ProjectStatus::Pending && role != ProjectRole::Owner {
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
    let updated = state
        .db
        .call(move |conn| {
            let (_, role) = access(conn, project, account)?;
            require(role, ProjectAction::ChangeLinkSharing)?;
            if patch.link_sharing == Some(true) && !settings::load(conn)?.link_sharing_allowed {
                return Err(ServerError::BadRequest(
                    "This server does not allow link sharing.".to_string(),
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
                        ip,
                        json!({ "link_sharing": patch.link_sharing, "link_role": patch.link_role }),
                    ),
                )?;
            }
            let row = projects::project_row(conn, project)?.ok_or(ServerError::NotFound)?;
            projects::summary(conn, &row, role)
        })
        .await?;
    Ok(Json(updated))
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

async fn join_by_link(
    State(state): State<AppState>,
    auth: Authenticated,
    ClientIp(ip): ClientIp,
    path: Result<Path<String>, PathRejection>,
) -> Result<Json<ProjectSummary>, ServerError> {
    let project: SharedProjectId = path_id(path)?;
    let account = auth.account_id;
    let now = state.clock.now_ms();
    let limit = state.config.limits.max_members_per_project;
    let joined = state
        .db
        .call(move |conn| {
            let row = projects::project_row(conn, project)?.ok_or(ServerError::NotFound)?;
            if row.status != ProjectStatus::Active {
                return Err(ServerError::NotFound);
            }
            if let Some(role) = projects::role_of(conn, project, account)? {
                return projects::summary(conn, &row, role);
            }
            if !row.link_sharing
                || !settings::load(conn)?.link_sharing_allowed
                || !projects::account_can_join(conn, account)?
            {
                return Err(ServerError::NotFound);
            }
            if projects::member_count(conn, project)? >= limit {
                return Err(ServerError::Conflict(format!(
                    "A project on this server can have at most {limit} people."
                )));
            }
            projects::grant(conn, project, account, row.link_role, row.owner, now)?;
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
            projects::summary(conn, &row, row.link_role)
        })
        .await?;
    Ok(Json(joined))
}

async fn put_blob(
    State(state): State<AppState>,
    auth: Authenticated,
    path: Result<Path<(String, String)>, PathRejection>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<StatusCode, ServerError> {
    let (project, hash) = project_and_hash(path)?;
    let limit = megabytes(state.config.limits.max_file_mb);
    content_length_within(&headers, limit)?;
    if body.len() as u64 > limit {
        return Err(ServerError::BadRequest(format!(
            "This file is larger than the server allows ({} MB).",
            state.config.limits.max_file_mb
        )));
    }
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
    let size = body.len() as u64;
    state.blobs.put(&hash, body).await?;
    state
        .db
        .call(move |conn| projects::add_blob(conn, project, &hash, size))
        .await?;
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

async fn put_snapshot(
    State(state): State<AppState>,
    auth: Authenticated,
    path: Result<Path<String>, PathRejection>,
    query: Result<Query<SnapshotQuery>, QueryRejection>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<StatusCode, ServerError> {
    let project: SharedProjectId = path_id(path)?;
    let Query(SnapshotQuery { seq }) =
        query.map_err(|rejection| ServerError::BadRequest(rejection.body_text()))?;
    let limit = megabytes(state.config.limits.max_project_mb);
    content_length_within(&headers, limit)?;
    if body.is_empty() || body.len() as u64 > limit {
        return Err(ServerError::BadRequest(format!(
            "A snapshot must hold between 1 byte and {} MB.",
            state.config.limits.max_project_mb
        )));
    }
    let account = auth.account_id;
    state
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
            Ok(())
        })
        .await?;
    let relative = format!(
        "snapshots/{project}/{seq}-{}.bin",
        crate::tokens::random_token()
    );
    let target = state.config.data_dir.join(&relative);
    let size = body.len() as u64;
    tokio::task::spawn_blocking(move || write_atomically(&target, &body))
        .await
        .map_err(|error| ServerError::Internal(format!("the upload task failed: {error}")))??;
    let now = state.clock.now_ms();
    let file = relative.clone();
    let dropped = state
        .db
        .call(move |conn| projects::record_snapshot(conn, project, seq, &file, size, account, now))
        .await?;
    for old in dropped {
        let _ = std::fs::remove_file(state.config.data_dir.join(old));
    }
    Ok(StatusCode::NO_CONTENT)
}

async fn get_snapshot(
    State(state): State<AppState>,
    auth: Authenticated,
    path: Result<Path<String>, PathRejection>,
) -> Result<Response, ServerError> {
    let project: SharedProjectId = path_id(path)?;
    let account = auth.account_id;
    let snapshot = state
        .db
        .call(move |conn| {
            access(conn, project, account)?;
            projects::latest_snapshot(conn, project)?.ok_or(ServerError::NotFound)
        })
        .await?;
    let path = state.config.data_dir.join(&snapshot.file);
    let bytes = tokio::task::spawn_blocking(move || std::fs::read(path))
        .await
        .map_err(|error| ServerError::Internal(format!("the download task failed: {error}")))?
        .map_err(|error| ServerError::Internal(format!("could not read a snapshot: {error}")))?;
    let seq = HeaderValue::from_str(&snapshot.seq.to_string())
        .map_err(|error| ServerError::Internal(error.to_string()))?;
    Ok((
        [
            (
                header::CONTENT_TYPE,
                HeaderValue::from_static("application/octet-stream"),
            ),
            (header::HeaderName::from_static(SNAPSHOT_SEQ_HEADER), seq),
        ],
        bytes,
    )
        .into_response())
}

fn sees_emails(conn: &rusqlite::Connection, role: ServerRole) -> Result<bool, ServerError> {
    Ok(matches!(role, ServerRole::Admin | ServerRole::Maintainer)
        || settings::load(conn)?.directory_shows_email)
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
            let (_, role) = access(conn, project, account)?;
            let emails = role == ProjectRole::Owner || sees_emails(conn, server_role)?;
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
    let account = auth.account_id;
    let limit = state.config.limits.max_members_per_project;
    let now = state.clock.now_ms();
    let granted = state
        .db
        .call(move |conn| {
            let (row, actor_role) = access(conn, project, account)?;
            require(actor_role, ProjectAction::ManageMembers)?;
            if row.status != ProjectStatus::Active {
                return Err(ServerError::Conflict(
                    "Share the project before adding people.".to_string(),
                ));
            }
            if target == row.owner {
                return Err(ServerError::BadRequest(
                    "The owner's role cannot change.".to_string(),
                ));
            }
            if !projects::account_can_join(conn, target)? {
                return Err(ServerError::NotFound);
            }
            let existing = projects::role_of(conn, project, target)?;
            if existing.is_none() && projects::member_count(conn, project)? >= limit {
                return Err(ServerError::Conflict(format!(
                    "A project on this server can have at most {limit} people."
                )));
            }
            projects::grant(conn, project, target, role, account, now)?;
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
            let person = projects::person(conn, target, true)?.ok_or(ServerError::NotFound)?;
            Ok(ProjectMember {
                person,
                role,
                granted_at: now,
            })
        })
        .await?;
    state.rooms.notify_account(
        project,
        target,
        &ServerFrame::AccessChanged {
            project_id: project,
            role: Some(role),
        },
    );
    Ok(Json(granted))
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
    state
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
            if !projects::revoke(conn, project, target)? {
                return Err(ServerError::NotFound);
            }
            security_log::record(
                conn,
                now,
                NewSecurityEvent {
                    actor: Some(account),
                    kind: SecurityEventKind::ProjectAccessRemoved,
                    target: Some(target.to_string()),
                    ip,
                    detail: json!({ "project": project.to_string(), "left": target == account }),
                },
            )?;
            Ok(())
        })
        .await?;
    let frame = ServerFrame::AccessChanged {
        project_id: project,
        role: None,
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
            let emails = staff || settings.directory_shows_email;
            projects::directory(conn, &q, emails, account)
        })
        .await?;
    Ok(Json(found))
}
