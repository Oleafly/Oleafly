use axum::extract::rejection::{PathRejection, QueryRejection};
use axum::extract::{Path, Query, State};
use axum::routing::get;
use axum::{Json, Router};
use oleafly_collab_protocol::access_log::AccessEntry;
use oleafly_collab_protocol::admin::Page;
use oleafly_collab_protocol::ids::SharedProjectId;
use oleafly_collab_protocol::projects::ProjectRole;
use serde::Deserialize;

use crate::access_log;
use crate::error::ServerError;
use crate::routes::projects::{access, sees_emails};
use crate::routes::{path_id, Authenticated};
use crate::settings;
use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new().route("/api/v1/projects/{project}/access-log", get(page))
}

#[derive(Deserialize)]
struct PageQuery {
    cursor: Option<String>,
    limit: Option<u32>,
}

async fn page(
    State(state): State<AppState>,
    auth: Authenticated,
    path: Result<Path<String>, PathRejection>,
    query: Result<Query<PageQuery>, QueryRejection>,
) -> Result<Json<Page<AccessEntry>>, ServerError> {
    let project: SharedProjectId = path_id(path)?;
    let Query(query) = query.map_err(|rejection| ServerError::BadRequest(rejection.body_text()))?;
    let cursor = query.cursor.filter(|value| !value.is_empty());
    let limit = query.limit.unwrap_or(access_log::DEFAULT_PAGE_SIZE);
    let account = auth.account_id;
    let server_role = auth.role;
    let listed = state
        .db
        .call(move |conn| {
            let (_, role) = access(conn, project, account)?;
            if role != ProjectRole::Owner {
                return Err(ServerError::Forbidden);
            }
            let runtime = settings::load(conn)?;
            if !runtime.access_logs_allowed {
                return Ok(Page {
                    items: Vec::new(),
                    next_cursor: None,
                });
            }
            let emails = sees_emails(server_role, &runtime);
            access_log::page(conn, project, cursor.as_deref(), limit, emails)
        })
        .await?;
    Ok(Json(listed))
}
