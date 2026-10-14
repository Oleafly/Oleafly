use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use oleafly_collab::live::LiveProject;
use oleafly_collab::sync::{spawn_live, EndReason, LiveLink, LiveStatus, SharedLive};
use oleafly_collab::{load_binding, remove_binding, CollabError, ServerClient, ServerUrl};
use oleafly_collab_protocol::auth::SessionEndReason;
use tokio::sync::mpsc;
use tokio::sync::oneshot;

use super::bases::initial_bases;
use super::host::LiveHost;
use super::payloads::{LiveInfo, RolePayload, StatusPayload};
use super::pump::pump;
use super::session::{
    active_for, guard, io, lock, not_live, writer_loop, Active, WriterSignal, ACTIVE, FRESH_JOINS,
    LIFECYCLE,
};
use super::{local_copy, settings, sync_hold, uploads};
use crate::collab::disk::DiskState;
use crate::collab::state::CollabState;

pub async fn start(
    state: &CollabState,
    host: Arc<dyn LiveHost>,
    project_id: &str,
) -> Result<LiveInfo, CollabError> {
    let _lifecycle = LIFECYCLE.lock().await;
    if let Some(active) = active_for(project_id) {
        let role = lock(&active.live).role();
        let status = guard(&active.last_status).clone();
        active.emit_status(status);
        active.host.role(RolePayload {
            project_id: project_id.to_owned(),
            role,
        });
        return Ok(LiveInfo {
            role,
            account_id: active.account_id,
            device_id: active.link.device_id,
        });
    }
    stop_any().await;
    let paths = state.paths()?.clone();
    let binding = load_binding(&paths, project_id)?.ok_or_else(not_live)?;
    let keys = state.keys().await?;
    let Some(tokens) = keys.sessions.tokens(binding.server_id)? else {
        if let Some(reason) = state.registry()?.ended(binding.server_id) {
            if reason == SessionEndReason::AccessEnded {
                let _ = remove_binding(&paths, project_id);
                crate::collab::registry::invalidate(project_id);
                local_copy::name_local_copy(project_id);
            }
            host.status(StatusPayload {
                project_id: project_id.to_owned(),
                status: LiveStatus::Ended {
                    reason: EndReason::of_session(Some(reason)),
                },
                pending: 0,
            });
        }
        return Err(CollabError::Unauthorized);
    };
    let root = crate::paths::project_dir(project_id).map_err(CollabError::Io)?;
    let client = Arc::new(ServerClient::new(ServerUrl::parse(&binding.server_url)?)?);
    let link = LiveLink {
        client,
        server_id: binding.server_id,
        project: binding.shared_project_id,
        device_id: tokens.device_id,
        key: Arc::clone(&keys.key),
        sessions: Arc::clone(&keys.sessions),
    };
    let document_dir = paths.document_dir(project_id)?;
    let disk_file = paths.materializer_index_file(project_id)?;
    let role = binding.role;
    let loaded = {
        let document_dir = document_dir.clone();
        let disk_file = disk_file.clone();
        tauri::async_runtime::spawn_blocking(move || {
            LiveProject::load(&document_dir, role).map(|live| (live, DiskState::load(&disk_file)))
        })
        .await
        .map_err(io)??
    };
    let (mut live, mut disk) = loaded;
    crate::collab::tree::sign(&mut live, state, binding.server_id, tokens.account_id);
    let mut bases = initial_bases(&root, &disk, &live);
    let hold_dir = paths.project_dir(project_id)?;
    sync_hold::catch_up(&root, &hold_dir, &link, &mut live, &mut disk, &mut bases).await?;
    let shared: SharedLive = Arc::new(Mutex::new(live));
    let (events_tx, events_rx) = mpsc::unbounded_channel();
    let (writer_tx, writer_rx) = mpsc::unbounded_channel();
    let handle = spawn_live(link.clone(), Arc::clone(&shared), events_tx);
    let fresh = guard(&FRESH_JOINS).remove(project_id);
    let active = Arc::new(Active {
        project_id: project_id.to_owned(),
        root,
        document_dir,
        disk_file,
        live: Arc::clone(&shared),
        handle,
        link,
        disk: Mutex::new(disk),
        host,
        writer: writer_tx,
        account_id: tokens.account_id,
        quiet_merge: AtomicBool::new(fresh),
        waiting: AtomicBool::new(false),
        last_status: Mutex::new(LiveStatus::Connecting),
        bases: Mutex::new(bases),
    });
    lock(&shared).mark_all_dirty()?;
    tauri::async_runtime::spawn(writer_loop(Arc::downgrade(&active), writer_rx));
    tauri::async_runtime::spawn(pump(Arc::downgrade(&active), events_rx, paths));
    active.kick();
    *guard(&ACTIVE) = Some(Arc::clone(&active));
    settings::schedule(&active);
    uploads::attach(&active);
    active.announce_uploads();
    Ok(LiveInfo {
        role,
        account_id: tokens.account_id,
        device_id: tokens.device_id,
    })
}

async fn finish(active: Arc<Active>) {
    let (done, wait) = oneshot::channel();
    let _ = active.writer.send(WriterSignal::Flush(done));
    let _ = tokio::time::timeout(Duration::from_secs(5), wait).await;
    active.save_now();
    active.handle.stop();
}

async fn stop_any() {
    let previous = guard(&ACTIVE).take();
    if let Some(active) = previous {
        finish(active).await;
    }
}

pub fn stop_running_session() {
    let Some(active) = guard(&ACTIVE).take() else {
        return;
    };
    tauri::async_runtime::spawn(async move {
        let _lifecycle = LIFECYCLE.lock().await;
        finish(active).await;
    });
}

pub async fn stop(project_id: &str) {
    let _lifecycle = LIFECYCLE.lock().await;
    let previous = {
        let mut slot = guard(&ACTIVE);
        if slot
            .as_ref()
            .is_some_and(|active| active.project_id == project_id)
        {
            slot.take()
        } else {
            None
        }
    };
    if let Some(active) = previous {
        finish(active).await;
    }
}

pub async fn flush(project_id: &str) {
    let Some(active) = active_for(project_id) else {
        return;
    };
    let (done, wait) = oneshot::channel();
    let _ = active.writer.send(WriterSignal::Flush(done));
    let _ = tokio::time::timeout(Duration::from_secs(10), wait).await;
}

pub async fn forget(project_id: &str, paths: &oleafly_collab::CollabPaths) {
    stop(project_id).await;
    let _ = remove_binding(paths, project_id);
    if let Ok(dir) = paths.project_dir(project_id) {
        let _ = tokio::fs::remove_dir_all(dir).await;
    }
    crate::collab::registry::invalidate(project_id);
}
