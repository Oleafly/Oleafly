use std::future::Future;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::Serialize;
use tauri::{ipc::Channel, Emitter, Manager, Resource, ResourceId, Runtime, State, Webview};
use tokio::sync::{oneshot, watch};

const DOWNLOAD_IDLE_TIMEOUT: Duration = Duration::from_secs(60);
const DOWNLOAD_TOTAL_TIMEOUT: Duration = Duration::from_secs(2 * 60 * 60);
const SAVE_TIMEOUT: Duration = Duration::from_secs(30);

#[derive(Default, Clone)]
pub struct UpdateState {
    downloading: Arc<AtomicBool>,
    pending: Arc<Mutex<Option<PendingInstall>>>,
    settlement: Arc<tokio::sync::Mutex<()>>,
}

struct PendingInstall {
    token: String,
    completion: Option<oneshot::Sender<Result<(), String>>>,
    cancel: watch::Sender<bool>,
    settlement_started: bool,
    quiesced: bool,
    restarting: bool,
}

impl UpdateState {
    pub fn installing(&self) -> bool {
        self.pending
            .lock()
            .map_or(true, |pending| pending.is_some())
    }

    pub fn prevents_exit(&self) -> bool {
        self.pending.lock().map_or(true, |pending| {
            pending.as_ref().is_some_and(|pending| !pending.restarting)
        })
    }

    async fn settle_work(&self, token: &str, work: impl Future<Output = ()>) -> Result<(), String> {
        let _settlement = self.settlement.lock().await;
        {
            let mut pending = self.pending.lock().map_err(|error| error.to_string())?;
            let pending = pending
                .as_mut()
                .filter(|pending| pending.token == token && !*pending.cancel.borrow())
                .ok_or("The update save request has expired.")?;
            if pending.quiesced {
                return Ok(());
            }
            pending.settlement_started = true;
        }
        work.await;
        let mut pending = self.pending.lock().map_err(|error| error.to_string())?;
        pending
            .as_mut()
            .filter(|pending| pending.token == token && !*pending.cancel.borrow())
            .ok_or("The update save request has expired.")?
            .quiesced = true;
        Ok(())
    }

    fn confirm(&self, token: &str, error: Option<String>) -> Result<(), String> {
        let mut pending = self.pending.lock().map_err(|error| error.to_string())?;
        let pending = pending
            .as_mut()
            .filter(|pending| pending.token == token && !*pending.cancel.borrow())
            .ok_or("The update save request has expired.")?;
        if error.is_none() && !pending.quiesced {
            return Err("Background work has not stopped yet.".into());
        }
        let completion = pending
            .completion
            .take()
            .ok_or("The update save request was already answered.")?;
        completion
            .send(error.map_or(Ok(()), Err))
            .map_err(|_| "The update save request has expired.".into())
    }
}

struct DownloadGuard(Arc<AtomicBool>);
impl Drop for DownloadGuard {
    fn drop(&mut self) {
        self.0.store(false, Ordering::Release);
    }
}

struct InstallGuard<R: Runtime> {
    state: UpdateState,
    app: tauri::AppHandle<R>,
    token: String,
    committed: bool,
}
impl<R: Runtime> Drop for InstallGuard<R> {
    fn drop(&mut self) {
        if self.committed {
            return;
        }
        crate::quit_gate::clear_flush_confirmed();
        if let Ok(pending) = self.state.pending.lock() {
            if let Some(pending) = pending
                .as_ref()
                .filter(|pending| pending.token == self.token)
            {
                pending.cancel.send_replace(true);
            }
        }
        let state = self.state.clone();
        let app = self.app.clone();
        let token = self.token.clone();
        tauri::async_runtime::spawn(async move {
            let _settlement = state.settlement.lock().await;
            let started = state
                .pending
                .lock()
                .ok()
                .and_then(|pending| {
                    pending
                        .as_ref()
                        .filter(|pending| pending.token == token)
                        .map(|pending| pending.settlement_started)
                })
                .unwrap_or(false);
            if started {
                if let Some(runtime) = app.try_state::<Arc<crate::acp::AcpRuntime>>() {
                    if let Err(error) = runtime.resume_after_failed_update() {
                        eprintln!("Could not resume CLI agents after the update failed: {error}");
                    }
                }
                if let Some(tasks) = app.try_state::<crate::research_tasks::ResearchTaskState>() {
                    if let Err(error) = tasks.resume_after_failed_update().await {
                        eprintln!(
                            "Could not resume research tasks after the update failed: {error}"
                        );
                    }
                }
            }
            if let Ok(mut pending) = state.pending.lock() {
                if pending
                    .as_ref()
                    .is_some_and(|pending| pending.token == token)
                {
                    *pending = None;
                }
            }
            let _ = app.emit_to("main", "update-install-finished", &token);
        });
    }
}

struct DownloadedUpdate {
    update: tauri_plugin_updater::Update,
    bytes: Vec<u8>,
}
impl Resource for DownloadedUpdate {}

#[derive(Clone, Serialize)]
#[serde(tag = "event", content = "data")]
pub enum DownloadEvent {
    #[serde(rename_all = "camelCase")]
    Started {
        content_length: Option<u64>,
    },
    #[serde(rename_all = "camelCase")]
    Progress {
        chunk_length: usize,
    },
    Finished,
}

fn require_window(webview: &str, window: &str, allowed: &[&str]) -> Result<(), String> {
    if webview == window && allowed.contains(&webview) {
        Ok(())
    } else {
        Err("This update action is unavailable from this window.".into())
    }
}

async fn watched_download<T>(
    download: impl Future<Output = Result<T, String>>,
    mut progress: watch::Receiver<()>,
    idle: Duration,
    total: Duration,
) -> Result<T, String> {
    tokio::time::timeout(total, async {
        tokio::pin!(download);
        loop {
            tokio::select! {
                biased;
                result = &mut download => return result,
                changed = progress.changed() => {
                    if changed.is_err() { return download.await; }
                },
                _ = tokio::time::sleep(idle) => return Err("The update download stopped making progress. Check your connection and try again.".into()),
            }
        }
    }).await.map_err(|_| "The update download took too long. Check your connection and try again.".to_string())?
}

#[tauri::command]
pub async fn download_update<R: Runtime>(
    webview: Webview<R>,
    state: State<'_, UpdateState>,
    rid: ResourceId,
    on_event: Channel<DownloadEvent>,
) -> Result<ResourceId, String> {
    require_window(
        webview.label(),
        webview.window().label(),
        &["main", "update"],
    )?;
    if state.downloading.swap(true, Ordering::AcqRel) {
        return Err("An update is already downloading.".into());
    }
    let _guard = DownloadGuard(Arc::clone(&state.downloading));
    let update = webview
        .resources_table()
        .get::<tauri_plugin_updater::Update>(rid)
        .map_err(|error| error.to_string())?;
    let mut update = (*update).clone();
    update.timeout = Some(DOWNLOAD_TOTAL_TIMEOUT);
    let (progress, changes) = watch::channel(());
    let mut started = false;
    let download = update.download(
        |chunk_length, content_length| {
            if !started {
                started = true;
                let _ = on_event.send(DownloadEvent::Started { content_length });
            }
            if chunk_length > 0 {
                progress.send_replace(());
            }
            let _ = on_event.send(DownloadEvent::Progress { chunk_length });
        },
        || {},
    );
    let bytes = watched_download(
        async { download.await.map_err(|error| error.to_string()) },
        changes,
        DOWNLOAD_IDLE_TIMEOUT,
        DOWNLOAD_TOTAL_TIMEOUT,
    )
    .await?;
    on_event
        .send(DownloadEvent::Finished)
        .map_err(|error| error.to_string())?;
    Ok(webview
        .resources_table()
        .add(DownloadedUpdate { update, bytes }))
}

pub fn lifecycle_plugin<R: Runtime>() -> tauri::plugin::TauriPlugin<R> {
    tauri::plugin::Builder::new("update-lifecycle")
        .on_event(|app, event| {
            if let tauri::RunEvent::ExitRequested { api, .. } = event {
                if app
                    .try_state::<UpdateState>()
                    .is_some_and(|state| state.prevents_exit())
                {
                    api.prevent_exit();
                }
            }
        })
        .build()
}

#[tauri::command]
pub async fn settle_update_work<R: Runtime>(
    webview: Webview<R>,
    state: State<'_, UpdateState>,
    token: String,
) -> Result<(), String> {
    require_window(webview.label(), webview.window().label(), &["main"])?;
    let mut cancelled = {
        let pending = state.pending.lock().map_err(|error| error.to_string())?;
        pending
            .as_ref()
            .filter(|pending| pending.token == token && !*pending.cancel.borrow())
            .ok_or("The update save request has expired.")?
            .cancel
            .subscribe()
    };
    let app = webview.app_handle().clone();
    let settling = state.inner().clone();
    let work = tauri::async_runtime::spawn(async move {
        settling
            .settle_work(&token, crate::research_lifecycle::shutdown(&app))
            .await
    });
    tokio::select! {
        _ = cancelled.changed() => Err("The update was cancelled.".into()),
        result = work => result.map_err(|error| error.to_string())?,
    }
}

#[tauri::command]
pub fn confirm_update_install<R: Runtime>(
    webview: Webview<R>,
    state: State<'_, UpdateState>,
    token: String,
    error: Option<String>,
) -> Result<(), String> {
    require_window(webview.label(), webview.window().label(), &["main"])?;
    state.confirm(&token, error)
}

#[tauri::command]
pub async fn install_update<R: Runtime>(
    webview: Webview<R>,
    state: State<'_, UpdateState>,
    rid: ResourceId,
) -> Result<(), String> {
    require_window(
        webview.label(),
        webview.window().label(),
        &["main", "update"],
    )?;
    let downloaded = webview
        .resources_table()
        .take::<DownloadedUpdate>(rid)
        .map_err(|error| error.to_string())?;
    if crate::latex_engine::install_in_progress() {
        return Err("Wait for the TeX installation to finish before updating Oleafly.".into());
    }
    let token = rand::random::<u128>().to_string();
    let (completion, saved) = oneshot::channel();
    {
        let mut pending = state.pending.lock().map_err(|error| error.to_string())?;
        if pending.is_some() {
            return Err("An update is already being installed.".into());
        }
        *pending = Some(PendingInstall {
            token: token.clone(),
            completion: Some(completion),
            cancel: watch::channel(false).0,
            settlement_started: false,
            quiesced: false,
            restarting: false,
        });
    }
    let mut guard = InstallGuard {
        state: state.inner().clone(),
        app: webview.app_handle().clone(),
        token: token.clone(),
        committed: false,
    };
    webview
        .app_handle()
        .emit_to("main", "update-install-prepare", &token)
        .map_err(|error| error.to_string())?;
    tokio::time::timeout(SAVE_TIMEOUT, saved)
        .await
        .map_err(|_| "Saving did not finish in time. The update was not installed.".to_string())?
        .map_err(|_| {
            "The application could not confirm that your files were saved.".to_string()
        })??;
    tauri::async_runtime::spawn_blocking(move || downloaded.update.install(&downloaded.bytes))
        .await
        .map_err(|error| error.to_string())?
        .map_err(|error| error.to_string())?;
    {
        let mut pending = state.pending.lock().map_err(|error| error.to_string())?;
        if let Some(pending) = pending.as_mut() {
            pending.restarting = true;
        }
    }
    crate::quit_gate::mark_flush_confirmed();
    guard.committed = true;
    webview.app_handle().request_restart();
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn updates_accept_both_root_views_but_save_confirmation_requires_main() {
        for label in ["main", "update"] {
            assert!(require_window(label, label, &["main", "update"]).is_ok());
        }
        assert!(require_window("browser", "main", &["main", "update"]).is_err());
        assert!(require_window("preview", "preview", &["main", "update"]).is_err());
        assert!(require_window("main", "preview", &["main", "update"]).is_err());
        assert!(require_window("browser", "main", &["main"]).is_err());
        assert!(require_window("update", "update", &["main"]).is_err());
        assert!(require_window("main", "main", &["main"]).is_ok());
    }

    #[test]
    fn install_blocks_quit_until_replacement_has_finished() {
        let state = UpdateState::default();
        assert!(!state.prevents_exit());
        let (completion, _saved) = oneshot::channel();
        *state.pending.lock().unwrap() = Some(PendingInstall {
            token: "install".into(),
            completion: Some(completion),
            cancel: watch::channel(false).0,
            settlement_started: false,
            quiesced: false,
            restarting: false,
        });
        assert!(state.installing());
        assert!(state.prevents_exit());
        assert!(state.confirm("install", None).is_err());
        state.pending.lock().unwrap().as_mut().unwrap().quiesced = true;
        assert!(state.confirm("install", None).is_ok());
        assert!(state.prevents_exit());
        state.pending.lock().unwrap().as_mut().unwrap().restarting = true;
        assert!(!state.prevents_exit());
        assert!(state.installing());
    }

    #[test]
    fn a_timed_out_save_cannot_later_authorize_installation() {
        let state = UpdateState::default();
        let (completion, saved) = oneshot::channel();
        *state.pending.lock().unwrap() = Some(PendingInstall {
            token: "expired".into(),
            completion: Some(completion),
            cancel: watch::channel(false).0,
            settlement_started: false,
            quiesced: true,
            restarting: false,
        });
        drop(saved);
        assert!(state.confirm("expired", None).is_err());
    }

    #[tokio::test]
    async fn a_cancelled_install_waits_for_detached_settlement_before_recovery() {
        let state = UpdateState::default();
        let (completion, _saved) = oneshot::channel();
        *state.pending.lock().unwrap() = Some(PendingInstall {
            token: "cancelled".into(),
            completion: Some(completion),
            cancel: watch::channel(false).0,
            settlement_started: false,
            quiesced: false,
            restarting: false,
        });
        let (started, ready) = oneshot::channel();
        let (finish, finished) = oneshot::channel();
        let settling = state.clone();
        let settled = Arc::new(AtomicBool::new(false));
        let done = settled.clone();
        let work = tokio::spawn(async move {
            settling
                .settle_work("cancelled", async {
                    started.send(()).unwrap();
                    finished.await.unwrap();
                    done.store(true, Ordering::Release);
                })
                .await
        });
        ready.await.unwrap();
        state
            .pending
            .lock()
            .unwrap()
            .as_ref()
            .unwrap()
            .cancel
            .send_replace(true);
        drop(work);
        assert!(state.confirm("cancelled", None).is_err());
        assert!(state.settlement.try_lock().is_err());
        assert!(!settled.load(Ordering::Acquire));
        finish.send(()).unwrap();
        let _recovery = state.settlement.lock().await;
        assert!(settled.load(Ordering::Acquire));
        assert!(!state.pending.lock().unwrap().as_ref().unwrap().quiesced);
    }

    #[tokio::test]
    async fn a_stalled_download_is_cancelled_before_it_can_finish() {
        let (_progress, changes) = watch::channel(());
        let completed = Arc::new(AtomicBool::new(false));
        let done = completed.clone();
        let result = watched_download(
            async move {
                tokio::time::sleep(Duration::from_secs(10)).await;
                done.store(true, Ordering::Release);
                Ok(())
            },
            changes,
            Duration::from_millis(20),
            Duration::from_secs(1),
        )
        .await;
        assert!(result.unwrap_err().contains("stopped making progress"));
        assert!(!completed.load(Ordering::Acquire));
    }

    #[tokio::test]
    async fn download_progress_resets_the_idle_deadline() {
        let (progress, changes) = watch::channel(());
        let result = watched_download(
            async move {
                for _ in 0..5 {
                    tokio::time::sleep(Duration::from_millis(10)).await;
                    progress.send_replace(());
                }
                Ok(42)
            },
            changes,
            Duration::from_millis(40),
            Duration::from_secs(1),
        )
        .await;
        assert_eq!(result.unwrap(), 42);
    }

    #[tokio::test]
    async fn only_the_matching_live_save_request_can_authorize_installation() {
        let state = UpdateState::default();
        let (completion, saved) = oneshot::channel();
        *state.pending.lock().unwrap() = Some(PendingInstall {
            token: "current".into(),
            completion: Some(completion),
            cancel: watch::channel(false).0,
            settlement_started: false,
            quiesced: true,
            restarting: false,
        });
        assert!(state.confirm("expired", None).is_err());
        assert!(state.confirm("current", Some("disk full".into())).is_ok());
        assert_eq!(saved.await.unwrap(), Err("disk full".into()));
        assert!(state.confirm("current", None).is_err());
    }
}
