use std::collections::BTreeSet;
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, LazyLock, Mutex};
use std::time::{Duration, Instant};

use oleafly_collab::live::LiveProject;
use oleafly_collab::sync::{spawn_live, EndReason, LiveLink, LiveStatus, SharedLive};
use oleafly_collab::{load_binding, remove_binding, CollabError, ServerClient, ServerUrl};
use oleafly_collab_protocol::auth::SessionEndReason;
use tokio::sync::mpsc;
use tokio::sync::oneshot;

use super::downloads::FigureHost;
use super::host::LiveHost;
use super::live_disk::writer_loop;
use super::payloads::{LiveInfo, RolePayload, StatusPayload};
use super::pump::pump;
use super::session::{
    active_for, app_log, app_runtime, cancel_start, forget_live, guard, io, live_for, lock,
    not_live, Active, Live, LiveDisk, WriterSignal, ACTIVE, FRESH_JOINS, LIFECYCLE,
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
    let lifecycle = LIFECYCLE.lock().await;
    start_locked(lifecycle, state, host, project_id).await
}

async fn start_locked(
    _lifecycle: tokio::sync::MutexGuard<'static, ()>,
    state: &CollabState,
    host: Arc<dyn LiveHost>,
    project_id: &str,
) -> Result<LiveInfo, CollabError> {
    if let Some(active) = active_for(project_id) {
        let role = lock(&active.live).role();
        let status = guard(&active.last_status).clone();
        active.emit_status(status);
        active.local.host.role(RolePayload {
            project_id: project_id.to_owned(),
            role,
            tracking: false,
            restricted: false,
            deleted_externally: false,
        });
        return Ok(LiveInfo {
            role,
            account_id: active.account_id.to_string(),
            device_id: active.link.device_id.to_string(),
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
    let log = app_log()?;
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
    live.set_edit_mode(crate::collab::suggesting::load_mode(&paths, project_id));
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
        local: LiveDisk {
            project_id: project_id.to_owned(),
            root,
            disk_file,
            disk: Mutex::new(disk),
            bases: Mutex::new(bases),
            host: Arc::clone(&host) as _,
            writer: writer_tx,
            upkeep: Default::default(),
            runtime: app_runtime(),
            log,
        },
        host,
        document_dir,
        live: Arc::clone(&shared),
        handle,
        link,
        account_id: tokens.account_id,
        quiet_merge: AtomicBool::new(fresh),
        waiting: AtomicBool::new(false),
        last_status: Mutex::new(LiveStatus::Connecting),
    });
    lock(&shared).mark_all_dirty()?;
    tauri::async_runtime::spawn(writer_loop(Arc::downgrade(&active), writer_rx));
    tauri::async_runtime::spawn(pump(Arc::downgrade(&active), events_rx, paths));
    active.kick();
    *guard(&ACTIVE) = Some(Live::Server(Arc::clone(&active)));
    active
        .local
        .host
        .unwritten(super::unwritten::UnwrittenPayload {
            project_id: project_id.to_owned(),
            files: Vec::new(),
        });
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
        account_id: tokens.account_id.to_string(),
        device_id: tokens.device_id.to_string(),
    })
}

async fn finish(live: Live) {
    let active = match live {
        Live::Server(active) => active,
        Live::Overleaf(live) => return live.finish().await,
    };
    let (done, wait) = oneshot::channel();
    let _ = active.local.writer.send(WriterSignal::Flush(done));
    let _ = tokio::time::timeout(Duration::from_secs(5), wait).await;
    active.close_figures();
    active.save_now();
    active.local.announce_written();
    active.handle.stop();
    forget_live(&active.local);
    crate::folder_watch::release_live(&active.local.project_id);
}

pub(super) async fn stop_any() {
    cancel_start(None);
    let previous = guard(&ACTIVE).take();
    if let Some(live) = previous {
        finish(live).await;
    }
}

pub const QUIT_WAIT: Duration = Duration::from_secs(2);

pub fn finish_for_quit(wait: Duration) {
    tauri::async_runtime::block_on(async move {
        let started = Instant::now();
        let _lifecycle = tokio::time::timeout(wait, LIFECYCLE.lock()).await.ok();
        cancel_start(None);
        let Some(live) = guard(&ACTIVE).take() else {
            return;
        };
        let active = match live {
            Live::Server(active) => active,
            Live::Overleaf(live) => {
                let left = wait.saturating_sub(started.elapsed());
                let _ = tokio::time::timeout(left, live.quit(left)).await;
                return;
            }
        };
        let (done, flushed) = oneshot::channel();
        let _ = active.local.writer.send(WriterSignal::Flush(done));
        let _ = tokio::time::timeout(wait.saturating_sub(started.elapsed()), flushed).await;
        active.close_figures();
        active.save_now();
        active.handle.stop();
    });
}

pub async fn stop(project_id: &str) {
    let _lifecycle = LIFECYCLE.lock().await;
    cancel_start(Some(project_id));
    let previous = {
        let mut slot = guard(&ACTIVE);
        if slot
            .as_ref()
            .is_some_and(|live| live.project_id() == project_id)
        {
            slot.take()
        } else {
            None
        }
    };
    if let Some(live) = previous {
        finish(live).await;
    }
}

pub async fn resumed_if_failed<T, E>(
    state: &CollabState,
    host: Arc<dyn LiveHost>,
    project_id: &str,
    work: impl std::future::Future<Output = Result<T, E>>,
) -> (Result<T, E>, bool) {
    let was_live = live_for(project_id).is_some();
    let done = work.await;
    let restarted = done.is_err() && was_live && start_if_idle(state, host, project_id).await;
    (done, restarted)
}

async fn start_if_idle(state: &CollabState, host: Arc<dyn LiveHost>, project_id: &str) -> bool {
    let lifecycle = LIFECYCLE.lock().await;
    if guard(&ACTIVE).is_some() {
        return false;
    }
    match start_locked(lifecycle, state, host, project_id).await {
        Ok(_) => true,
        Err(error) => {
            let _ = crate::project::append_app_log(format!(
                "Live collaboration could not start project {project_id} again after it stayed: {error}"
            ));
            false
        }
    }
}

pub fn reconnect_now() -> bool {
    let running = guard(&ACTIVE).clone();
    running.is_some_and(|live| match live {
        Live::Server(active) => {
            active.handle.reconnect_now();
            true
        }
        Live::Overleaf(live) => {
            live.reconnect_now();
            true
        }
    })
}

static FOCUSED: LazyLock<Mutex<BTreeSet<String>>> = LazyLock::new(|| Mutex::new(BTreeSet::new()));

fn focused_anywhere(label: &str, focused: bool) -> bool {
    let mut windows = guard(&FOCUSED);
    if focused {
        windows.insert(label.to_owned());
    } else {
        windows.remove(label);
    }
    !windows.is_empty()
}

pub fn window_focused(label: &str, focused: bool) {
    let anywhere = focused_anywhere(label, focused);
    if let Some(Live::Overleaf(live)) = guard(&ACTIVE).clone() {
        live.set_focused(anywhere);
    }
}

const FIGURE_WAIT: Duration = Duration::from_secs(5);

pub async fn flush(project_id: &str, figures: bool) {
    let Some(live) = live_for(project_id) else {
        return;
    };
    let active = match live {
        Live::Server(active) => active,
        Live::Overleaf(live) => {
            live.flush().await;
            if figures {
                live.wait_for_figures(FIGURE_WAIT).await;
            }
            return;
        }
    };
    let (done, wait) = oneshot::channel();
    let _ = active.local.writer.send(WriterSignal::Flush(done));
    let _ = tokio::time::timeout(Duration::from_secs(10), wait).await;
    if figures {
        active.wait_for_figures(FIGURE_WAIT).await;
    }
}

pub async fn forget(project_id: &str, paths: &oleafly_collab::CollabPaths) {
    stop(project_id).await;
    let _ = remove_binding(paths, project_id);
    if let Ok(dir) = paths.project_dir(project_id) {
        let _ = tokio::fs::remove_dir_all(dir).await;
    }
    crate::collab::registry::invalidate(project_id);
}

#[cfg(test)]
mod tests {
    use super::focused_anywhere;

    #[test]
    fn focus_moving_between_windows_stays_focused_in_either_event_order() {
        assert!(focused_anywhere("focus-main", true));
        assert!(focused_anywhere("focus-pdf", true));
        assert!(focused_anywhere("focus-main", false));
        assert!(!focused_anywhere("focus-pdf", false));
        assert!(!focused_anywhere("focus-pdf", false));
        assert!(focused_anywhere("focus-main", true));
        assert!(!focused_anywhere("focus-main", false));
    }
}
