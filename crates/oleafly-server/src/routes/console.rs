use axum::extract::rejection::{PathRejection, QueryRejection};
use axum::extract::{Path, Query, State};
use axum::routing::{get, post};
use axum::{Json, Router};
use oleafly_collab_protocol::admin::SecurityEventKind;
use oleafly_collab_protocol::capabilities::{ProtocolRange, PROTOCOL_VERSION};
use oleafly_collab_protocol::console::{
    AdminOverview, AdminProject, AdminProjectSort, AdminProjectsPage, FilesLocation, HealthIssue,
    HealthStatus, ServerHealth, SortOrder, ADMIN_PROJECTS_MAX_OFFSET, ADMIN_PROJECTS_MAX_PAGE_SIZE,
    ADMIN_PROJECTS_MAX_QUERY_CHARS, ADMIN_PROJECTS_PAGE_SIZE,
};
use oleafly_collab_protocol::frames::ServerFrame;
use oleafly_collab_protocol::ids::{AccountId, SharedProjectId};
use oleafly_collab_protocol::projects::ProjectStatus;
use oleafly_collab_protocol::roles::ServerAction;
use serde::Deserialize;
use serde_json::json;

use crate::auth::email_link;
use crate::config::BlobStoreConfig;
use crate::console::{self, ProjectFilter};
use crate::error::ServerError;
use crate::projects;
use crate::routes::{path_id, Authenticated, ClientIp};
use crate::security_log::{self, NewSecurityEvent};
use crate::settings;
use crate::state::AppState;

const NEVER_UPLOADED: &str = "This project never finished uploading, so it cannot be shared again.";
const NEVER_SHARED: &str = "This project was never shared, so there is nothing to restore.";

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/v1/admin/overview", get(overview))
        .route("/api/v1/admin/projects", get(list_projects))
        .route("/api/v1/admin/projects/{project}/archive", post(archive))
        .route(
            "/api/v1/admin/projects/{project}/unarchive",
            post(unarchive),
        )
}

fn sees_storage(auth: &Authenticated) -> bool {
    auth.require(ServerAction::ViewStorage).is_ok()
}

async fn overview(
    State(state): State<AppState>,
    auth: Authenticated,
) -> Result<Json<AdminOverview>, ServerError> {
    auth.require(ServerAction::ManageMembers)?;
    let storage_visible = sees_storage(&auth);
    let location = match state.config.blob_store {
        BlobStoreConfig::Filesystem => FilesLocation::Disk,
        BlobStoreConfig::S3(_) => FilesLocation::S3,
    };
    let now = state.clock.now_ms();
    let (mut counts, storage, runtime) = state
        .db
        .call(move |conn| {
            let counts = console::counts(conn, now)?;
            let storage = if storage_visible {
                Some(console::storage(conn, location)?)
            } else {
                None
            };
            Ok((counts, storage, settings::load(conn)?))
        })
        .await?;
    let (open_rooms, people_online) = state.rooms.occupancy();
    counts.open_rooms = u32::try_from(open_rooms).unwrap_or(u32::MAX);
    counts.people_online = u32::try_from(people_online).unwrap_or(u32::MAX);
    let providers = email_link::with_email_link(
        state.providers.infos(),
        email_link::available(state.mailer.is_configured(), &runtime),
    );
    let mut issues = Vec::new();
    if providers.is_empty() {
        issues.push(HealthIssue::NoSignInProvider);
    }
    if !console::data_dir_writable(state.config.data_dir.clone()).await {
        issues.push(HealthIssue::StorageNotWritable);
    }
    let sign_in_problems = state.providers.problems();
    if !sign_in_problems.is_empty() {
        issues.push(HealthIssue::SignInFailing);
    }
    let config = &state.config;
    Ok(Json(AdminOverview {
        server_name: config.server_name.clone(),
        version: env!("CARGO_PKG_VERSION").to_string(),
        protocol: ProtocolRange {
            min: PROTOCOL_VERSION,
            max: PROTOCOL_VERSION,
        },
        started_at: state.started_at,
        now: state.clock.now_ms(),
        health: ServerHealth {
            status: if issues.is_empty() {
                HealthStatus::Ok
            } else {
                HealthStatus::Warning
            },
            issues,
        },
        counts,
        storage,
        email_configured: config.smtp_url.is_some() && config.mail_from.is_some(),
        providers,
        settings: runtime,
        limits: config.limits,
        archive_days: config.archive_days,
        sign_in_problems,
    }))
}

#[derive(Deserialize)]
struct ProjectsQuery {
    q: Option<String>,
    status: Option<String>,
    sort: Option<String>,
    order: Option<String>,
    cursor: Option<String>,
    limit: Option<String>,
}

struct ProjectsRequest {
    filter: ProjectFilter,
    offset: u32,
    limit: u32,
}

fn bad(message: &str) -> ServerError {
    ServerError::BadRequest(message.to_string())
}

fn present(value: Option<String>) -> Option<String> {
    value.filter(|text| !text.is_empty())
}

fn parse_request(query: ProjectsQuery) -> Result<ProjectsRequest, ServerError> {
    let limit = match present(query.limit) {
        None => ADMIN_PROJECTS_PAGE_SIZE,
        Some(text) => text
            .parse::<u32>()
            .ok()
            .filter(|limit| (1..=ADMIN_PROJECTS_MAX_PAGE_SIZE).contains(limit))
            .ok_or_else(|| bad("Ask for between 1 and 100 projects at a time."))?,
    };
    let offset = match present(query.cursor) {
        None => 0,
        Some(text) => text
            .parse::<u32>()
            .ok()
            .filter(|offset| *offset <= ADMIN_PROJECTS_MAX_OFFSET)
            .ok_or_else(|| bad("That page cursor is not valid."))?,
    };
    let search = query.q.unwrap_or_default().trim().to_string();
    if search.chars().count() > ADMIN_PROJECTS_MAX_QUERY_CHARS {
        return Err(bad("Search for 200 characters or fewer."));
    }
    let sort = match present(query.sort) {
        None => AdminProjectSort::Activity,
        Some(text) => AdminProjectSort::parse(&text)
            .ok_or_else(|| bad("Sort by title, owner, members, size, activity or created."))?,
    };
    let order = match present(query.order) {
        None if matches!(sort, AdminProjectSort::Title | AdminProjectSort::Owner) => SortOrder::Asc,
        None => SortOrder::Desc,
        Some(text) => SortOrder::parse(&text).ok_or_else(|| bad("Order must be asc or desc."))?,
    };
    let status = match present(query.status).as_deref() {
        None => None,
        Some("active") => Some(ProjectStatus::Active),
        Some("archived") => Some(ProjectStatus::Archived),
        Some("pending") => Some(ProjectStatus::Pending),
        Some(_) => return Err(bad("Status must be active, archived or pending.")),
    };
    Ok(ProjectsRequest {
        filter: ProjectFilter {
            search,
            status,
            sort,
            order,
        },
        offset,
        limit,
    })
}

async fn list_projects(
    State(state): State<AppState>,
    auth: Authenticated,
    query: Result<Query<ProjectsQuery>, QueryRejection>,
) -> Result<Json<AdminProjectsPage>, ServerError> {
    auth.require(ServerAction::ManageMembers)?;
    let Query(query) = query.map_err(|rejection| ServerError::BadRequest(rejection.body_text()))?;
    let request = parse_request(query)?;
    let storage_visible = sees_storage(&auth);
    if request.filter.sort == AdminProjectSort::Size && !storage_visible {
        return Err(ServerError::Forbidden);
    }
    let filter = request.filter;
    let listed = state
        .db
        .call(move |conn| console::list_projects(conn, &filter, storage_visible))
        .await?;
    let total = listed.len();
    let start = usize::try_from(request.offset).unwrap_or(usize::MAX);
    let take = usize::try_from(request.limit).unwrap_or(usize::MAX);
    let items: Vec<AdminProject> = listed.into_iter().skip(start).take(take).collect();
    let end = start.saturating_add(items.len());
    let next_cursor = (!items.is_empty() && end < total).then(|| end.to_string());
    Ok(Json(AdminProjectsPage {
        items,
        next_cursor,
        total: u32::try_from(total).unwrap_or(u32::MAX),
    }))
}

fn admin_event(
    actor: AccountId,
    kind: SecurityEventKind,
    project: SharedProjectId,
    ip: Option<String>,
    title: &str,
) -> NewSecurityEvent {
    NewSecurityEvent {
        actor: Some(actor),
        kind,
        target: Some(project.to_string()),
        ip,
        detail: json!({ "title": title, "by_admin": true }),
    }
}

async fn archive(
    State(state): State<AppState>,
    auth: Authenticated,
    ClientIp(ip): ClientIp,
    path: Result<Path<String>, PathRejection>,
) -> Result<Json<AdminProject>, ServerError> {
    auth.require(ServerAction::DeleteProjectForStorage)?;
    let project: SharedProjectId = path_id(path)?;
    let actor = auth.account_id;
    let now = state.clock.now_ms();
    let (changed, archived) = state
        .db
        .call(move |conn| {
            let transaction = conn.transaction()?;
            let row = projects::project_row(&transaction, project)?.ok_or(ServerError::NotFound)?;
            let changed = row.status != ProjectStatus::Archived;
            if changed {
                projects::set_status(&transaction, project, ProjectStatus::Archived, now)?;
                security_log::record(
                    &transaction,
                    now,
                    admin_event(
                        actor,
                        SecurityEventKind::ProjectArchived,
                        project,
                        ip,
                        &row.title,
                    ),
                )?;
            }
            let archived = console::project(&transaction, project, true)?;
            transaction.commit()?;
            Ok((changed, archived))
        })
        .await?;
    if changed {
        let frame = ServerFrame::ProjectArchived {
            project_id: project,
        };
        for member in state.rooms.close_room(project) {
            crate::rooms::deliver(&member, frame.clone());
        }
    }
    Ok(Json(archived))
}

async fn unarchive(
    State(state): State<AppState>,
    auth: Authenticated,
    ClientIp(ip): ClientIp,
    path: Result<Path<String>, PathRejection>,
) -> Result<Json<AdminProject>, ServerError> {
    auth.require(ServerAction::DeleteProjectForStorage)?;
    let project: SharedProjectId = path_id(path)?;
    let actor = auth.account_id;
    let now = state.clock.now_ms();
    let restored = state
        .db
        .call(move |conn| {
            let transaction = conn.transaction()?;
            let row = projects::project_row(&transaction, project)?.ok_or(ServerError::NotFound)?;
            match row.status {
                ProjectStatus::Active => {}
                ProjectStatus::Archived => {
                    if projects::latest_snapshot(&transaction, project)?.is_none() {
                        return Err(ServerError::Conflict(NEVER_UPLOADED.to_string()));
                    }
                    console::restore_archived(&transaction, project)?;
                    security_log::record(
                        &transaction,
                        now,
                        admin_event(
                            actor,
                            SecurityEventKind::ProjectUnarchived,
                            project,
                            ip,
                            &row.title,
                        ),
                    )?;
                }
                ProjectStatus::Pending | ProjectStatus::Unknown => {
                    return Err(ServerError::Conflict(NEVER_SHARED.to_string()));
                }
            }
            let restored = console::project(&transaction, project, true)?;
            transaction.commit()?;
            Ok(restored)
        })
        .await?;
    Ok(Json(restored))
}
