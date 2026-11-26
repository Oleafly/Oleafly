use std::sync::Arc;

use oleafly_collab::CollabError;
use oleafly_online::live::session::{ConnectionDetails, Resolution};
use serde::Deserialize;

pub use oleafly_live::overleaf::notices::*;

use super::{off_runtime, OverleafLive};
use crate::collab::commands::CollabCommandError;
use crate::collab::live::session::{io, live_for, not_live, Live};

pub(crate) const OVERLEAF_NOTICE_EVENT: &str = "overleaf-live-notice";

#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Keep {
    Mine,
    Theirs,
}

fn live_of(project_id: &str) -> Result<Arc<OverleafLive>, CollabError> {
    match live_for(project_id) {
        Some(Live::Overleaf(live)) => Ok(live),
        Some(Live::Server(_)) | None => Err(not_live()),
    }
}

pub(crate) fn resolve(project_id: &str, path: &str, keep: Keep) -> Result<(), CollabError> {
    let choice = match keep {
        Keep::Mine => Resolution::Mine,
        Keep::Theirs => Resolution::Theirs,
    };
    live_of(project_id)?.resolve(path, choice)
}

pub(crate) fn retry(project_id: &str, path: &str) -> Result<(), CollabError> {
    live_of(project_id)?.retry(path)
}

pub(crate) fn keep_copy(project_id: &str, path: &str) -> Result<(), CollabError> {
    live_of(project_id)?.keep_copy(path)
}

#[tauri::command]
pub async fn overleaf_live_resolve(
    project_id: String,
    path: String,
    keep: Keep,
) -> Result<(), CollabCommandError> {
    resolve(&project_id, &path, keep).map_err(CollabCommandError::from)
}

#[tauri::command]
pub async fn overleaf_live_retry(
    project_id: String,
    path: String,
) -> Result<(), CollabCommandError> {
    Ok(off_runtime(move || retry(&project_id, &path))
        .await
        .map_err(io)??)
}

#[tauri::command]
pub async fn overleaf_live_keep_copy(
    project_id: String,
    path: String,
) -> Result<(), CollabCommandError> {
    Ok(off_runtime(move || keep_copy(&project_id, &path))
        .await
        .map_err(io)??)
}

#[tauri::command]
pub async fn overleaf_live_connection_details(
    project_id: String,
) -> Result<ConnectionDetails, CollabCommandError> {
    Ok(live_of(&project_id)?.session.details())
}
