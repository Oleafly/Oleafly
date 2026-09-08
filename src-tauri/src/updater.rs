use std::future::Future;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::Serialize;
use tauri::{ipc::Channel, Emitter, Manager, Resource, ResourceId, Runtime, State, Webview};
use tokio::sync::{oneshot, watch};

const DOWNLOAD_IDLE_TIMEOUT: Duration = Duration::from_secs(60);
const DOWNLOAD_TOTAL_TIMEOUT: Duration = Duration::from_secs(2 * 60 * 60);
const SETTLEMENT_TIMEOUT: Duration = Duration::from_secs(3 * 60);
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
    ready_to_save: watch::Sender<bool>,
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
        let pending = pending
            .as_mut()
            .filter(|pending| pending.token == token && !*pending.cancel.borrow())
            .ok_or("The update save request has expired.")?;
        pending.quiesced = true;
        pending.ready_to_save.send_replace(true);
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
        tauri::async_runtime::spawn(recover_install(state, app, token));
    }
}

async fn recover_install<R: Runtime>(state: UpdateState, app: tauri::AppHandle<R>, token: String) {
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
                eprintln!("Could not resume research tasks after the update failed: {error}");
            }
        }
    }
    finish_install_recovery(&state, &app, &token);
}

fn finish_install_recovery<R: Runtime>(
    state: &UpdateState,
    app: &tauri::AppHandle<R>,
    token: &str,
) {
    if let Ok(mut pending) = state.pending.lock() {
        if pending
            .as_ref()
            .is_some_and(|pending| pending.token == token)
        {
            if let Some(agent) = app.try_state::<crate::agent::AgentState>() {
                crate::agent::resume_after_failed_update(agent.inner());
            }
            *pending = None;
        }
    }
    let _ = app.emit_to("main", "update-install-finished", token);
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
            .settle_work(&token, crate::research_lifecycle::prepare_update(&app))
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

async fn wait_for_saved(
    mut saved: oneshot::Receiver<Result<(), String>>,
    mut ready: watch::Receiver<bool>,
    settlement_timeout: Duration,
    save_timeout: Duration,
) -> Result<(), String> {
    let result = tokio::select! {
        result = &mut saved => result,
        settled = tokio::time::timeout(settlement_timeout, async { ready.wait_for(|ready| *ready).await.map(|_| ()) }) => {
            settled.map_err(|_| "Background work is still stopping. The update was not installed. Wait for it to finish before trying again.")?
                .map_err(|_| "The update save request has expired.")?;
            tokio::time::timeout(save_timeout, saved).await
                .map_err(|_| "Saving did not finish in time. The update was not installed.")?
        },
    };
    result
        .map_err(|_| "The application could not confirm that your files were saved.".to_string())?
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
    let (ready_to_save, ready) = watch::channel(false);
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
            ready_to_save,
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
    wait_for_saved(saved, ready, SETTLEMENT_TIMEOUT, SAVE_TIMEOUT).await?;
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

    struct UpdateFixture {
        app: tauri::App<tauri::test::MockRuntime>,
        webview: Webview<tauri::test::MockRuntime>,
        update: tauri_plugin_updater::Update,
        server: tokio::task::JoinHandle<()>,
        _directory: tempfile::TempDir,
    }

    impl Drop for UpdateFixture {
        fn drop(&mut self) {
            self.server.abort();
        }
    }

    impl UpdateFixture {
        async fn new() -> Self {
            use axum::{routing::get, Json, Router};
            use tauri_plugin_updater::UpdaterExt;
            let directory = tempfile::tempdir().unwrap();
            let executable = directory.path().join("Oleafly.app/Contents/MacOS/oleafly");
            std::fs::create_dir_all(executable.parent().unwrap()).unwrap();
            std::fs::write(&executable, b"original fixture executable").unwrap();
            let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
            let address = listener.local_addr().unwrap();
            let release = serde_json::json!({
                "version": "9.0.0",
                "url": format!("http://{address}/download"),
                "signature": "invalid fixture signature",
            });
            let router = Router::new()
                .route("/latest", get(move || async move { Json(release) }))
                .route("/download", get(|| async { "unsigned fixture archive" }));
            let server = tokio::spawn(async move {
                axum::serve(listener, router).await.unwrap();
            });
            let mut context = tauri::test::mock_context(tauri::test::noop_assets());
            context.config_mut().plugins.0.insert(
                "updater".into(),
                serde_json::json!({"pubkey":"invalid fixture public key", "dangerousInsecureTransportProtocol":true}),
            );
            let app = tauri::test::mock_builder()
                .plugin(tauri_plugin_updater::Builder::new().build())
                .manage(UpdateState::default())
                .manage(crate::agent::AgentState::default())
                .manage(crate::agent_exec::AgentExecState::default())
                .build(context)
                .unwrap();
            let window = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
                .build()
                .unwrap();
            let webview: Webview<tauri::test::MockRuntime> = window.as_ref().clone();
            let update = app
                .updater_builder()
                .endpoints(vec![format!("http://{address}/latest").parse().unwrap()])
                .unwrap()
                .executable_path(&executable)
                .no_proxy()
                .build()
                .unwrap()
                .check()
                .await
                .unwrap()
                .unwrap();
            Self {
                app,
                webview,
                update,
                server,
                _directory: directory,
            }
        }

        fn archive(&self) -> ResourceId {
            self.webview.resources_table().add(DownloadedUpdate {
                update: self.update.clone(),
                bytes: Vec::new(),
            })
        }
    }

    async fn wait_for_recovery(state: &UpdateState) {
        tokio::time::timeout(Duration::from_secs(2), async {
            while state.installing() {
                tokio::time::sleep(Duration::from_millis(5)).await;
            }
        })
        .await
        .expect("failed update did not release its install guard");
    }

    #[tokio::test]
    async fn native_download_rejects_unsigned_bytes_and_releases_the_download_slot() {
        let fixture = UpdateFixture::new().await;
        let rid = fixture
            .webview
            .resources_table()
            .add(fixture.update.clone());
        let events = Arc::new(Mutex::new(Vec::new()));
        let received = events.clone();
        let channel = Channel::new(move |body| {
            received
                .lock()
                .unwrap()
                .push(body.deserialize::<serde_json::Value>().unwrap());
            Ok(())
        });
        let result =
            download_update(fixture.webview.clone(), fixture.app.state(), rid, channel).await;
        assert!(result.is_err());
        assert!(!fixture
            .app
            .state::<UpdateState>()
            .downloading
            .load(Ordering::Acquire));
        let events = events.lock().unwrap();
        assert!(events.iter().any(|event| event["event"] == "Started"));
        assert!(events.iter().any(|event| event["event"] == "Progress"));
        assert!(!events.iter().any(|event| event["event"] == "Finished"));
    }

    #[tokio::test]
    async fn native_download_rejects_concurrent_checks_and_missing_resources() {
        let fixture = UpdateFixture::new().await;
        let state = fixture.app.state::<UpdateState>();
        state.downloading.store(true, Ordering::Release);
        let result = download_update(
            fixture.webview.clone(),
            state.clone(),
            12345,
            Channel::new(|_| Ok(())),
        )
        .await;
        assert!(result.unwrap_err().contains("already downloading"));
        state.downloading.store(false, Ordering::Release);
        assert!(download_update(
            fixture.webview.clone(),
            state.clone(),
            12345,
            Channel::new(|_| Ok(()))
        )
        .await
        .is_err());
        assert!(!state.downloading.load(Ordering::Acquire));
    }

    #[tokio::test]
    async fn rejected_save_releases_the_archive_and_restores_the_main_window() {
        use tauri::Listener;
        let _quit = crate::quit_gate::test_lock().lock().await;
        let fixture = UpdateFixture::new().await;
        let state = fixture.app.state::<UpdateState>().inner().clone();
        let responder = state.clone();
        fixture
            .webview
            .listen("update-install-prepare", move |event| {
                let token: String = serde_json::from_str(event.payload()).unwrap();
                responder.confirm(&token, Some("disk full".into())).unwrap();
            });
        let rid = fixture.archive();
        let result = install_update(fixture.webview.clone(), fixture.app.state(), rid).await;
        assert_eq!(result.unwrap_err(), "disk full");
        wait_for_recovery(&state).await;
        assert!(fixture
            .webview
            .resources_table()
            .get::<DownloadedUpdate>(rid)
            .is_err());
        assert!(!state.prevents_exit());
        assert!(!crate::quit_gate::flush_confirmed());
    }

    #[tokio::test]
    async fn competing_install_discards_its_archive_without_replacing_the_live_request() {
        let fixture = UpdateFixture::new().await;
        let state = fixture.app.state::<UpdateState>();
        let (completion, _saved) = oneshot::channel();
        *state.pending.lock().unwrap() = Some(PendingInstall {
            token: "existing".into(),
            completion: Some(completion),
            cancel: watch::channel(false).0,
            settlement_started: false,
            quiesced: false,
            ready_to_save: watch::channel(false).0,
            restarting: false,
        });
        let rid = fixture.archive();
        let error = install_update(fixture.webview.clone(), state.clone(), rid)
            .await
            .unwrap_err();
        assert!(error.contains("already being installed"));
        assert_eq!(
            state.pending.lock().unwrap().as_ref().unwrap().token,
            "existing"
        );
        assert!(fixture
            .webview
            .resources_table()
            .get::<DownloadedUpdate>(rid)
            .is_err());
    }

    #[tokio::test]
    async fn cancelling_native_install_waits_for_running_settlement_before_unlocking() {
        use tauri::Listener;
        let _quit = crate::quit_gate::test_lock().lock().await;
        let fixture = UpdateFixture::new().await;
        let state = fixture.app.state::<UpdateState>().inner().clone();
        let (announced, mut tokens) = tokio::sync::mpsc::unbounded_channel();
        fixture
            .webview
            .listen("update-install-prepare", move |event| {
                let _ = announced.send(serde_json::from_str::<String>(event.payload()).unwrap());
            });
        let rid = fixture.archive();
        let webview = fixture.webview.clone();
        let app = fixture.app.handle().clone();
        let install = tokio::spawn(async move { install_update(webview, app.state(), rid).await });
        let token = tokio::time::timeout(Duration::from_secs(2), tokens.recv())
            .await
            .unwrap()
            .unwrap();
        let (entered, entering) = oneshot::channel();
        let (finish, finished) = oneshot::channel();
        let settling = state.clone();
        let settle_token = token.clone();
        let settlement = tokio::spawn(async move {
            settling
                .settle_work(&settle_token, async {
                    entered.send(()).unwrap();
                    finished.await.unwrap();
                })
                .await
        });
        entering.await.unwrap();
        install.abort();
        assert!(install.await.unwrap_err().is_cancelled());
        assert!(state.installing());
        assert!(state.prevents_exit());
        assert!(state.confirm(&token, None).is_err());
        finish.send(()).unwrap();
        assert!(settlement.await.unwrap().is_err());
        wait_for_recovery(&state).await;
        assert!(!state.prevents_exit());
    }

    #[tokio::test]
    async fn native_settlement_requires_the_live_main_window_request() {
        let fixture = UpdateFixture::new().await;
        let state = fixture.app.state::<UpdateState>();
        assert!(
            settle_update_work(fixture.webview.clone(), state.clone(), "missing".into())
                .await
                .is_err()
        );
        let (completion, saved) = oneshot::channel();
        *state.pending.lock().unwrap() = Some(PendingInstall {
            token: "current".into(),
            completion: Some(completion),
            cancel: watch::channel(false).0,
            settlement_started: false,
            quiesced: false,
            ready_to_save: watch::channel(false).0,
            restarting: false,
        });
        assert!(confirm_update_install(
            fixture.webview.clone(),
            state.clone(),
            "current".into(),
            None
        )
        .is_err());
        settle_update_work(fixture.webview.clone(), state.clone(), "current".into())
            .await
            .unwrap();
        confirm_update_install(
            fixture.webview.clone(),
            state.clone(),
            "current".into(),
            None,
        )
        .unwrap();
        assert_eq!(saved.await.unwrap(), Ok(()));
        assert!(state.pending.lock().unwrap().as_ref().unwrap().quiesced);
    }

    #[tokio::test]
    async fn background_settlement_has_its_own_budget_before_saving() {
        let (complete, saved) = oneshot::channel();
        let (ready, changes) = watch::channel(false);
        let work = tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(60)).await;
            ready.send_replace(true);
            complete.send(Ok(())).unwrap();
        });
        wait_for_saved(
            saved,
            changes,
            Duration::from_secs(2),
            Duration::from_millis(20),
        )
        .await
        .unwrap();
        work.await.unwrap();
    }

    #[tokio::test]
    async fn settlement_and_save_timeouts_cannot_authorize_installation() {
        let (_complete, saved) = oneshot::channel();
        let (_ready, changes) = watch::channel(false);
        let result = wait_for_saved(
            saved,
            changes,
            Duration::from_millis(5),
            Duration::from_secs(1),
        )
        .await;
        assert!(result
            .unwrap_err()
            .contains("Background work is still stopping"));
        let (_complete, saved) = oneshot::channel();
        let (_ready, changes) = watch::channel(true);
        let result = wait_for_saved(
            saved,
            changes,
            Duration::from_secs(1),
            Duration::from_millis(5),
        )
        .await;
        assert!(result
            .unwrap_err()
            .contains("Saving did not finish in time"));
    }

    #[tokio::test]
    async fn failed_install_reopens_assistant_admission_after_native_settlement() {
        let fixture = UpdateFixture::new().await;
        let state = fixture.app.state::<UpdateState>();
        let (completion, _saved) = oneshot::channel();
        *state.pending.lock().unwrap() = Some(PendingInstall {
            token: "recover".into(),
            completion: Some(completion),
            cancel: watch::channel(false).0,
            settlement_started: false,
            quiesced: false,
            ready_to_save: watch::channel(false).0,
            restarting: false,
        });
        settle_update_work(fixture.webview.clone(), state.clone(), "recover".into())
            .await
            .unwrap();
        let agent = fixture.app.state::<crate::agent::AgentState>();
        assert!(crate::agent::paused_for_update(agent.inner()));
        recover_install(
            state.inner().clone(),
            fixture.app.handle().clone(),
            "recover".into(),
        )
        .await;
        assert!(!crate::agent::paused_for_update(agent.inner()));
        assert!(!state.installing());
    }

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
            ready_to_save: watch::channel(false).0,
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
            ready_to_save: watch::channel(true).0,
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
            ready_to_save: watch::channel(false).0,
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
            ready_to_save: watch::channel(true).0,
            restarting: false,
        });
        assert!(state.confirm("expired", None).is_err());
        assert!(state.confirm("current", Some("disk full".into())).is_ok());
        assert_eq!(saved.await.unwrap(), Err("disk full".into()));
        assert!(state.confirm("current", None).is_err());
    }
}
