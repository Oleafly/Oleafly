use super::*;

pub(super) fn log_discovery_cleanup_error(context: &str, error: &str) {
    let message = format!("MCP {context}: {error}");
    #[cfg(debug_assertions)]
    eprintln!("{message}");
    let _ = crate::project::append_app_log(message);
}

pub(super) fn combine_cleanup_error(
    primary: String,
    cleanup: Result<(), String>,
    cleanup_context: &str,
) -> String {
    match cleanup {
        Ok(()) => primary,
        Err(cleanup_error) => format!("{primary}. {cleanup_context}: {cleanup_error}"),
    }
}

pub(super) async fn clear_renderer_registry(state: &McpState) {
    state.registry_initialized.store(false, Ordering::Release);
    state.registry.lock().await.clear();
}

fn revoke_expired_renderer_authorization_locked(
    app: &AppHandle,
    state: &McpState,
    renderer_session: u64,
) {
    let published_epoch = state.published_epoch.load(Ordering::Acquire);
    let (revoked_epoch, next_epoch) =
        invalidate_pending(state, PendingInterruption::Revoked, |epoch| {
            let _ = app.emit(
                "mcp:requests-revoked",
                renderer_revocation_payload(epoch, "renderer-lease-expired", renderer_session),
            );
        });
    state.published_epoch.store(
        advance_published_epoch(published_epoch, revoked_epoch, next_epoch),
        Ordering::Release,
    );
}

async fn replace_renderer_supervisor_locked(
    app: &AppHandle,
    state: &McpState,
    renderer_session: u64,
) {
    if let Some(previous) = state.renderer_lease_task.lock().await.take() {
        previous.abort();
    }
    let supervisor_app = app.clone();
    let task = tauri::async_runtime::spawn(async move {
        supervise_renderer_lease(supervisor_app, renderer_session).await;
    });
    *state.renderer_lease_task.lock().await = Some(task);
}

async fn supervise_renderer_lease(app: AppHandle, renderer_session: u64) {
    loop {
        let deadline = {
            let state = app.state::<McpState>();
            if state.active_renderer_session.load(Ordering::Acquire) != renderer_session {
                return;
            }
            let lease = lock_renderer_lease(&state);
            let Some(lease) = lease
                .as_ref()
                .filter(|lease| lease.session == renderer_session)
            else {
                return;
            };
            lease.deadline
        };
        tokio::time::sleep_until(tokio::time::Instant::from_std(deadline)).await;

        let state = app.state::<McpState>();
        let _lifecycle = state.lifecycle.lock().await;
        if !renderer_lease_expired_at(&state, renderer_session, Instant::now()) {
            continue;
        }

        let _token = state.token.lock().await;
        let now = Instant::now();
        if !mark_renderer_expiration_revoked_at(&state, renderer_session, now) {
            continue;
        }
        revoke_expired_renderer_authorization_locked(&app, &state, renderer_session);
        return;
    }
}

pub(crate) async fn begin_renderer_session(app: &AppHandle) -> Result<u64, String> {
    let state = app.state::<McpState>();
    let _lifecycle = state.lifecycle.lock().await;
    let renderer_session =
        next_nonzero_sequence(&state.renderer_session_seq, "MCP renderer session")?;

    if let Some(previous) = state.renderer_lease_task.lock().await.take() {
        previous.abort();
    }
    let _token = state.token.lock().await;
    activate_renderer_lease_at(&state, renderer_session, Instant::now());
    clear_renderer_registry(&state).await;
    *state.active_project.lock().await = None;
    state.published_epoch.store(0, Ordering::Release);
    invalidate_pending(&state, PendingInterruption::Revoked, |epoch| {
        let _ = app.emit(
            "mcp:requests-revoked",
            renderer_revocation_payload(epoch, "renderer-session-changed", renderer_session),
        );
    });
    if let Err(error) = remove_discovery_file_checked() {
        log_discovery_cleanup_error("renderer session cleanup failed", &error);
    }
    drop(_token);
    replace_renderer_supervisor_locked(app, &state, renderer_session).await;
    Ok(renderer_session)
}

pub(crate) async fn renderer_heartbeat(
    app: &AppHandle,
    renderer_session: u64,
) -> Result<(), String> {
    let state = app.state::<McpState>();
    let _lifecycle = state.lifecycle.lock().await;
    let token = state.token.lock().await;
    let (was_expired, needs_revocation) =
        renew_renderer_lease_at(&state, renderer_session, Instant::now())?;
    if needs_revocation {
        revoke_expired_renderer_authorization_locked(app, &state, renderer_session);
    }
    drop(token);
    if was_expired {
        replace_renderer_supervisor_locked(app, &state, renderer_session).await;
    }
    publish_if_ready_locked(app, &state).await?;
    Ok(())
}

pub(crate) async fn end_renderer_session(
    app: &AppHandle,
    renderer_session: u64,
) -> Result<(), String> {
    let state = app.state::<McpState>();
    let _lifecycle = state.lifecycle.lock().await;
    if state.active_renderer_session.load(Ordering::Acquire) != renderer_session {
        return Ok(());
    }
    if let Some(supervisor) = state.renderer_lease_task.lock().await.take() {
        supervisor.abort();
    }
    let _token = state.token.lock().await;
    *lock_renderer_lease(&state) = None;
    state.active_renderer_session.store(0, Ordering::Release);
    let published_epoch = state.published_epoch.load(Ordering::Acquire);
    let (revoked_epoch, next_epoch) =
        invalidate_pending(&state, PendingInterruption::Revoked, |epoch| {
            let _ = app.emit(
                "mcp:requests-revoked",
                renderer_revocation_payload(epoch, "renderer-session-changed", renderer_session),
            );
        });
    state.published_epoch.store(
        advance_published_epoch(published_epoch, revoked_epoch, next_epoch),
        Ordering::Release,
    );
    Ok(())
}
