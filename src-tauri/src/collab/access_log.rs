use oleafly_collab::{load_binding, CollabError};
use oleafly_collab_protocol::access_log::AccessEntry;
use oleafly_collab_protocol::admin::Page;
use oleafly_collab_protocol::ids::{ServerId, SharedProjectId};
use oleafly_collab_protocol::projects::{ProjectPatch, ProjectSummary};
use serde::Serialize;

use super::commands::{authed, AppHost, CollabCommandError, CollabHost};
use super::state::CollabState;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccessLogStatus {
    pub server_allowed: bool,
    pub enabled: bool,
}

fn bound(
    state: &CollabState,
    project_id: &str,
) -> Result<(ServerId, SharedProjectId), CollabError> {
    let binding = load_binding(state.paths()?, project_id)?.ok_or_else(|| CollabError::Api {
        status: 404,
        code: "not_found".to_owned(),
        message: "this project is not shared".to_owned(),
    })?;
    Ok((binding.server_id, binding.shared_project_id))
}

pub async fn access_log_status(
    state: &CollabState,
    host: &dyn CollabHost,
    project_id: &str,
) -> Result<AccessLogStatus, CollabError> {
    let (server, shared) = bound(state, project_id)?;
    let summary = authed(state, host, server, |client, access| {
        Box::pin(async move { client.project(access, shared).await })
    })
    .await?;
    let manifest = match state.verified_manifest(server) {
        Some(manifest) => manifest,
        None => {
            let entry = super::commands::known(state, server)?;
            state.client(&entry)?.capabilities().await?
        }
    };
    Ok(AccessLogStatus {
        server_allowed: manifest.features.access_logs,
        enabled: summary.access_log,
    })
}

pub async fn set_access_log(
    state: &CollabState,
    host: &dyn CollabHost,
    project_id: &str,
    enabled: bool,
) -> Result<ProjectSummary, CollabError> {
    let (server, shared) = bound(state, project_id)?;
    let patch = ProjectPatch {
        access_log: Some(enabled),
        ..ProjectPatch::default()
    };
    authed(state, host, server, |client, access| {
        let patch = patch.clone();
        Box::pin(async move { client.patch_project(access, shared, &patch).await })
    })
    .await
}

pub async fn access_log_page(
    state: &CollabState,
    host: &dyn CollabHost,
    project_id: &str,
    cursor: Option<String>,
) -> Result<Page<AccessEntry>, CollabError> {
    let (server, shared) = bound(state, project_id)?;
    authed(state, host, server, |client, access| {
        let cursor = cursor.clone();
        Box::pin(async move { client.access_log(access, shared, cursor.as_deref()).await })
    })
    .await
}

#[tauri::command]
pub async fn collab_access_log_status(
    app: tauri::AppHandle,
    state: tauri::State<'_, CollabState>,
    project_id: String,
) -> Result<AccessLogStatus, CollabCommandError> {
    let host = AppHost::new(app);
    access_log_status(state.inner(), &host, &project_id)
        .await
        .map_err(CollabCommandError::from)
}

#[tauri::command]
pub async fn collab_access_log_set_enabled(
    app: tauri::AppHandle,
    state: tauri::State<'_, CollabState>,
    project_id: String,
    enabled: bool,
) -> Result<ProjectSummary, CollabCommandError> {
    let host = AppHost::new(app);
    set_access_log(state.inner(), &host, &project_id, enabled)
        .await
        .map_err(CollabCommandError::from)
}

#[tauri::command]
pub async fn collab_access_log_page(
    app: tauri::AppHandle,
    state: tauri::State<'_, CollabState>,
    project_id: String,
    cursor: Option<String>,
) -> Result<Page<AccessEntry>, CollabCommandError> {
    let host = AppHost::new(app);
    access_log_page(state.inner(), &host, &project_id, cursor)
        .await
        .map_err(CollabCommandError::from)
}
