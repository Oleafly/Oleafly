use super::*;

pub(super) fn serve_exit_is_current(
    active_id: Option<u64>,
    exited_id: u64,
    shutdown_present: bool,
) -> bool {
    active_id == Some(exited_id) && shutdown_present
}

pub(super) async fn signal_completion_before_cleanup<Cleanup, CleanupFuture>(
    completed: oneshot::Sender<()>,
    cleanup: Cleanup,
) where
    Cleanup: FnOnce() -> CleanupFuture,
    CleanupFuture: std::future::Future<Output = ()>,
{
    let _ = completed.send(());
    cleanup().await;
}

pub(super) async fn claim_unexpected_serve_exit(state: &McpState, serve_id: u64) -> bool {
    let active_id = state
        .serve_instance
        .lock()
        .await
        .as_ref()
        .map(|instance| instance.id);
    let shutdown_present = state.shutdown.lock().await.is_some();
    if !serve_exit_is_current(active_id, serve_id, shutdown_present) {
        return false;
    }
    state.serve_instance.lock().await.take();
    state.shutdown.lock().await.take();
    true
}

pub(super) async fn handle_serve_exit(app: AppHandle, serve_id: u64, outcome: Result<(), String>) {
    let state = app.state::<McpState>();
    let _lifecycle = state.lifecycle.lock().await;
    if !claim_unexpected_serve_exit(&state, serve_id).await {
        return;
    }

    let mut token = state.token.lock().await;
    *token = None;
    clear_renderer_registry(&state).await;
    let published_epoch = state.published_epoch.swap(0, Ordering::AcqRel);
    invalidate_pending(&state, PendingInterruption::ServerStopped, |epoch| {
        if published_epoch == epoch {
            let _ = app.emit("mcp:server-stopped", json!({ "epoch": epoch }));
        }
    });
    drop(token);
    *state.bound_port.lock().await = None;
    if let Err(error) = remove_discovery_file_checked() {
        log_discovery_cleanup_error("unexpected listener cleanup failed", &error);
    }
    let detail = outcome
        .err()
        .unwrap_or_else(|| "listener exited without a shutdown request".into());
    let message = format!("MCP listener terminated unexpectedly: {detail}");
    #[cfg(debug_assertions)]
    eprintln!("{message}");
    let _ = crate::project::append_app_log(message);
}

pub async fn start(app: AppHandle, port: u16) -> Result<u16, String> {
    let state = app.state::<McpState>();
    let _lifecycle = state.lifecycle.lock().await;
    if state.shutdown.lock().await.is_some() {
        return Err("MCP server already running".into());
    }
    let token = ensure_token()?;
    remove_discovery_file_checked()?;

    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .map_err(|error| format!("could not bind {addr}: {error}"))?;
    let bound = listener
        .local_addr()
        .map(|address| address.port())
        .unwrap_or(port);
    let serve_id = next_nonzero_sequence(&state.serve_seq, "MCP listener")?;
    let (tx, rx) = watch::channel(false);
    state.epoch.fetch_add(1, Ordering::AcqRel);
    state.published_epoch.store(0, Ordering::Release);

    let router = Router::new()
        .route("/mcp", post(mcp_post))
        .with_state(app.clone());
    *state.token.lock().await = Some(token);
    *state.shutdown.lock().await = Some(tx);
    *state.bound_port.lock().await = Some(bound);
    spawn_listener(app.clone(), listener, router, rx, serve_id, &state).await;
    if let Err(error) = publish_if_ready_locked(&app, &state).await {
        rollback_failed_start(&state).await;
        return Err(combine_cleanup_error(
            error,
            remove_discovery_file_checked(),
            "Startup rollback also failed to remove the MCP discovery file",
        ));
    }
    Ok(bound)
}

async fn spawn_listener(
    app: AppHandle,
    listener: tokio::net::TcpListener,
    router: Router,
    mut shutdown: watch::Receiver<bool>,
    serve_id: u64,
    state: &McpState,
) {
    let runner = tauri::async_runtime::spawn(async move {
        axum::serve(listener, router)
            .with_graceful_shutdown(async move {
                let _ = shutdown.changed().await;
            })
            .await
    });
    let (completed_tx, completed_rx) = oneshot::channel();
    tauri::async_runtime::spawn(async move {
        let outcome = runner
            .await
            .map_err(|error| format!("listener task failed: {error}"))
            .and_then(|result| result.map_err(|error| error.to_string()));
        signal_completion_before_cleanup(completed_tx, || async move {
            handle_serve_exit(app, serve_id, outcome).await;
        })
        .await;
    });
    *state.serve_instance.lock().await = Some(ServeInstance {
        id: serve_id,
        completed: completed_rx,
    });
}

async fn rollback_failed_start(state: &McpState) {
    state.published_epoch.store(0, Ordering::Release);
    *state.token.lock().await = None;
    if let Some(shutdown) = state.shutdown.lock().await.take() {
        let _ = shutdown.send(true);
    }
    invalidate_pending(state, PendingInterruption::ServerStopped, |_| {});
    if let Some(instance) = state.serve_instance.lock().await.take() {
        let _ = tokio::time::timeout(Duration::from_secs(3), instance.completed).await;
    }
    *state.bound_port.lock().await = None;
}

pub async fn stop(app: &AppHandle) -> Result<(), String> {
    let state = app.state::<McpState>();
    let _lifecycle = state.lifecycle.lock().await;
    if let Some(shutdown) = state.shutdown.lock().await.take() {
        revoke_running_server(app, &state).await;
        let _ = shutdown.send(true);
    }
    clear_renderer_registry(&state).await;
    if let Some(instance) = state.serve_instance.lock().await.take() {
        let _ = tokio::time::timeout(Duration::from_secs(3), instance.completed).await;
    }
    *state.bound_port.lock().await = None;
    *state.token.lock().await = None;
    remove_discovery_file_checked()
}

async fn revoke_running_server(app: &AppHandle, state: &McpState) {
    let mut token = state.token.lock().await;
    *token = None;
    let published_epoch = state.published_epoch.swap(0, Ordering::AcqRel);
    invalidate_pending(state, PendingInterruption::ServerStopped, |epoch| {
        if published_epoch == epoch {
            let _ = app.emit("mcp:server-stopped", json!({ "epoch": epoch }));
        }
    });
}
