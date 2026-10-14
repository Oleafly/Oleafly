use std::sync::Arc;

use oleafly_collab::editor::DocMessage;
use oleafly_collab::live::DocSink;
use oleafly_collab::ot::TextOperation;
use tauri::ipc::Channel;

use super::editor::{doc_change, doc_close, doc_open, presence_leave, presence_set};
use super::host::{AppLiveHost, LiveHost};
use super::lifecycle::{flush, start, stop};
use super::local_events::resume;
use super::payloads::{DocOpened, LiveInfo};
use super::session::not_live;
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
    if !crate::collab::switch::enabled() {
        stop(&project_id).await;
        return Err(CollabCommandError::from(not_live()));
    }
    announce(&project_id, &app);
    if !crate::folder_watch::is_watching(&project_id) {
        let _ = crate::folder_watch::watch_project_folder(app, project_id).await;
    }
    Ok(info)
}

#[tauri::command]
pub async fn collab_live_stop(project_id: String) -> Result<(), CollabCommandError> {
    stop(&project_id).await;
    Ok(())
}

#[tauri::command]
pub async fn collab_live_flush(project_id: String) -> Result<(), CollabCommandError> {
    flush(&project_id).await;
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
) -> Result<(), CollabCommandError> {
    doc_close(&project_id, &file_id);
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
