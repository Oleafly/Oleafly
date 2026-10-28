use std::sync::Arc;

use oleafly_collab::editor::DocMessage;
use oleafly_collab::live::DocSink;
use oleafly_collab::ot::TextOperation;
use tauri::ipc::Channel;

use super::editor::{doc_change, doc_close, doc_open, presence_leave, presence_set};
use super::host::{AppLiveHost, LiveHost};
use super::lifecycle::{flush, reconnect_now, start, stop};
use super::local_events::resume;
use super::payloads::{DocOpened, LiveInfo};
use super::sync_hold::{announce, SyncDecision};
use crate::collab::commands::CollabCommandError;
use crate::collab::state::CollabState;

#[tauri::command]
pub async fn collab_live_start(
    app: tauri::AppHandle,
    state: tauri::State<'_, CollabState>,
    project_id: String,
) -> Result<LiveInfo, CollabCommandError> {
    let host: Arc<dyn LiveHost> = Arc::new(AppLiveHost::new(app.clone()));
    let info = start(state.inner(), host, &project_id)
        .await
        .map_err(CollabCommandError::from)?;
    settle_started(app, project_id).await;
    Ok(info)
}

// What follows every start of a live session: tell the window about a sync
// decision that still waits, and watch the folder.
pub(crate) async fn settle_started(app: tauri::AppHandle, project_id: String) {
    announce(&project_id, &app);
    if !crate::folder_watch::is_watching(&project_id) {
        let _ = crate::folder_watch::watch_project_folder(app, project_id).await;
    }
}

#[tauri::command]
pub async fn collab_live_stop(project_id: String) -> Result<(), CollabCommandError> {
    stop(&project_id).await;
    Ok(())
}

// `wait_for_figures` is for the compile barrier: it also waits up to five
// seconds for figures that are still downloading.
#[tauri::command]
pub async fn collab_live_flush(
    project_id: String,
    wait_for_figures: Option<bool>,
) -> Result<(), CollabCommandError> {
    flush(&project_id, wait_for_figures.unwrap_or(false)).await;
    Ok(())
}

#[tauri::command]
pub async fn collab_live_reconnect_now() -> Result<(), CollabCommandError> {
    reconnect_now();
    Ok(())
}

#[tauri::command]
pub async fn collab_doc_open(
    project_id: String,
    path: String,
    channel: Channel<DocMessage>,
) -> Result<Option<DocOpened>, CollabCommandError> {
    let sink: DocSink = Arc::new(move |message| {
        let _ = channel.send(message);
    });
    doc_open(&project_id, &path, sink).map_err(CollabCommandError::from)
}

#[tauri::command]
pub async fn collab_doc_change(
    project_id: String,
    file_id: String,
    rev: u64,
    op: TextOperation,
) -> Result<(), CollabCommandError> {
    doc_change(&project_id, &file_id, rev, op).map_err(CollabCommandError::from)
}

#[tauri::command]
pub async fn collab_doc_close(
    project_id: String,
    file_id: String,
    session: u64,
) -> Result<(), CollabCommandError> {
    doc_close(&project_id, &file_id, session);
    Ok(())
}

#[tauri::command]
pub async fn collab_sync_resume(
    project_id: String,
    decision: SyncDecision,
) -> Result<(), CollabCommandError> {
    resume(&project_id, decision)
        .await
        .map_err(CollabCommandError::from)
}

#[tauri::command]
pub async fn collab_presence_set(
    project_id: String,
    path: Option<String>,
    cursor: Option<u32>,
    anchor: Option<u32>,
) -> Result<(), CollabCommandError> {
    presence_set(&project_id, path, cursor, anchor);
    Ok(())
}

#[tauri::command]
pub async fn collab_presence_leave(project_id: String) -> Result<(), CollabCommandError> {
    presence_leave(&project_id);
    Ok(())
}
