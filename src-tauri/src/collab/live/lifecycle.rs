use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use oleafly_collab::live::LiveProject;
use oleafly_collab::sync::{spawn_live, EndReason, LiveLink, LiveStatus, SharedLive};
use oleafly_collab::{load_binding, remove_binding, CollabError, ServerClient, ServerUrl};
use oleafly_collab_protocol::auth::SessionEndReason;
use tokio::sync::mpsc;
use tokio::sync::oneshot;

use super::host::LiveHost;
use super::payloads::{LiveInfo, RolePayload, StatusPayload};
use super::pump::pump;
use super::session::{
    active_for, guard, io, lock, not_live, writer_loop, Active, WriterSignal, ACTIVE, FRESH_JOINS,
    LIFECYCLE,
};
use super::{local_copy, settings, sync_hold, uploads};
use crate::collab::commands::signed_out;
use crate::collab::disk::DiskState;
use crate::collab::state::CollabState;

fn server_removed() -> CollabError {
    CollabError::Api {
        status: 404,
        code: "server_removed".to_owned(),
        message: "this project's server is no longer in the list".to_owned(),
    }
}

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
        let registry = state.registry()?;
        let ended = registry.ended(binding.server_id);
        if ended == Some(SessionEndReason::AccessEnded) {
            let (kept, id) = (paths.clone(), project_id.to_owned());
            let _ = tauri::async_runtime::spawn_blocking(move || {
                local_copy::keep_stored_origin(&kept, &id);
                let _ = remove_binding(&kept, &id);
            })
            .await;
            crate::collab::registry::invalidate(project_id);
            local_copy::name_local_copy(project_id);
        }
        host.status(StatusPayload {
            project_id: project_id.to_owned(),
            status: LiveStatus::Ended {
                reason: EndReason::of_session(ended),
            },
            pending: 0,
        });
        return Err(if registry.get(binding.server_id).is_some() {
            signed_out()
        } else {
            server_removed()
        });
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
    let (mut live, disk) = loaded;
    if live.repaired_on_load() {
        let _ = crate::project::append_app_log(format!(
            "Live collaboration repaired the saved shared document of project {project_id} when it opened"
        ));
    }
    crate::collab::tree::sign(&mut live, state, binding.server_id, tokens.account_id);
    let hold_dir = paths.project_dir(project_id)?;
    let sync_hold::CaughtUp {
        live,
        disk,
        bases,
        to_upload,
        renamed,
    } = sync_hold::catch_up(root.clone(), hold_dir, live, disk).await?;
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
        upkeep: Default::default(),
    });
    lock(&shared).mark_all_dirty()?;
    tauri::async_runtime::spawn(writer_loop(Arc::downgrade(&active), writer_rx));
    tauri::async_runtime::spawn(pump(Arc::downgrade(&active), events_rx, paths));
    active.kick();
    *guard(&ACTIVE) = Some(Arc::clone(&active));
    active.announce_new_names(renamed);
    settings::schedule(&active);
    uploads::attach(&active);
    active.announce_uploads();
    if !to_upload.is_empty() {
        let uploading = Arc::clone(&active);
        tauri::async_runtime::spawn(async move {
            let _ = uploading.import_paths(Some(to_upload)).await;
        });
    }
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
    active.close_figures();
    active.save_now();
    active.handle.stop();
}

async fn stop_any() {
    let previous = guard(&ACTIVE).take();
    if let Some(active) = previous {
        finish(active).await;
    }
}

pub const QUIT_WAIT: Duration = Duration::from_secs(2);

pub fn finish_for_quit(wait: Duration) {
    tauri::async_runtime::block_on(async move {
        let started = Instant::now();
        let _lifecycle = tokio::time::timeout(wait, LIFECYCLE.lock()).await.ok();
        let Some(active) = guard(&ACTIVE).take() else {
            return;
        };
        let (done, flushed) = oneshot::channel();
        let _ = active.writer.send(WriterSignal::Flush(done));
        let _ = tokio::time::timeout(wait.saturating_sub(started.elapsed()), flushed).await;
        active.close_figures();
        active.save_now();
        active.handle.stop();
    });
}

pub fn stop_running_session() {
    let held = LIFECYCLE.try_lock().ok();
    let taken = held.as_ref().and_then(|_| guard(&ACTIVE).take());
    tauri::async_runtime::spawn(async move {
        let _lifecycle = match held {
            Some(held) => held,
            None => LIFECYCLE.lock().await,
        };
        if let Some(active) = taken.or_else(|| guard(&ACTIVE).take()) {
            finish(active).await;
        }
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

pub async fn resumed_if_failed<T, E>(
    state: &CollabState,
    host: Arc<dyn LiveHost>,
    project_id: &str,
    work: impl std::future::Future<Output = Result<T, E>>,
) -> Result<T, E> {
    let was_live = active_for(project_id).is_some();
    let done = work.await;
    if done.is_err() && was_live && active_for(project_id).is_none() {
        if let Err(error) = start(state, host, project_id).await {
            let _ = crate::project::append_app_log(format!(
                "Live collaboration could not start project {project_id} again after it stayed: {error}"
            ));
        }
    }
    done
}

pub fn reconnect_now() -> bool {
    let running = guard(&ACTIVE).clone();
    running.is_some_and(|active| {
        active.handle.reconnect_now();
        true
    })
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
