pub mod client;
pub mod native;
pub mod protocol;
pub mod server;

use serde::Serialize;
use serde_json::Value;
use std::sync::atomic::Ordering;
use tauri::{AppHandle, Emitter, Manager};

use protocol::ToolMeta;
use server::McpState;

#[derive(Serialize)]
pub struct McpStatus {
    pub running: bool,
    pub port: Option<u16>,
    pub url: Option<String>,
    pub enabled: bool,
}

#[derive(Serialize)]
pub struct McpConnectionInfo {
    pub url: String,
    pub token: String,
}

async fn status(app: &AppHandle) -> Result<McpStatus, String> {
    let state = app.state::<McpState>();
    let _control = state.control.lock().await;
    let ready_port = {
        let _lifecycle = state.lifecycle.lock().await;
        let port = *state.bound_port.lock().await;
        let epoch = state.epoch.load(Ordering::Acquire);
        let published_epoch = state.published_epoch.load(Ordering::Acquire);
        let renderer_session = state.active_renderer_session.load(Ordering::Acquire);
        port.filter(|_| {
            published_epoch != 0
                && published_epoch == epoch
                && server::renderer_session_is_fresh(&state, renderer_session)
        })
    };
    let cfg = crate::config::read_config()?;
    Ok(McpStatus {
        running: ready_port.is_some(),
        port: ready_port,
        url: ready_port.map(|p| format!("http://127.0.0.1:{p}/mcp")),
        enabled: cfg.mcp_enabled,
    })
}

async fn start_available(app: AppHandle, preferred_port: u16) -> Result<u16, String> {
    match server::start(app.clone(), preferred_port).await {
        Ok(port) => Ok(port),
        Err(error) if preferred_port != 0 && error.contains("could not bind") => {
            server::start(app, 0).await
        }
        Err(error) => Err(error),
    }
}

fn configured_start_candidate(
    enabled: bool,
    configured_port: u16,
    running_port: Option<u16>,
) -> Option<u16> {
    (enabled && running_port.is_none()).then_some(configured_port)
}

pub async fn start_configured(app: AppHandle, _preferred_port: u16) -> Result<u16, String> {
    let state = app.state::<McpState>();
    let _control = state.control.lock().await;
    let latest = crate::config::read_config()?;
    let running_port = *state.bound_port.lock().await;
    let Some(preferred_port) =
        configured_start_candidate(latest.mcp_enabled, latest.mcp_port, running_port)
    else {
        return Ok(running_port.unwrap_or(latest.mcp_port));
    };
    let port = start_available(app.clone(), preferred_port).await?;
    crate::config::update_config(|cfg| {
        cfg.mcp_port = port;
        Ok(())
    })?;
    Ok(port)
}

#[tauri::command]
pub async fn mcp_set_active_project(
    app: AppHandle,
    project_id: Option<String>,
    renderer_session: u64,
) -> Result<(), String> {
    let state = app.state::<McpState>();
    let _lifecycle = state.lifecycle.lock().await;
    if !server::renderer_session_is_fresh(&state, renderer_session) {
        return Err("stale or expired MCP renderer session".into());
    }
    if let Some(project_id) = project_id.as_deref() {
        crate::paths::validate_project_id(project_id)?;
        crate::project::read_meta(project_id)?;
    }
    *state.active_project.lock().await = project_id;
    Ok(())
}

#[tauri::command]
pub async fn mcp_begin_renderer_session(app: AppHandle) -> Result<u64, String> {
    server::begin_renderer_session(&app).await
}

#[tauri::command]
pub async fn mcp_renderer_heartbeat(app: AppHandle, renderer_session: u64) -> Result<(), String> {
    server::renderer_heartbeat(&app, renderer_session).await
}

#[tauri::command]
pub async fn mcp_end_renderer_session(app: AppHandle, renderer_session: u64) -> Result<(), String> {
    server::end_renderer_session(&app, renderer_session).await
}

#[tauri::command]
pub async fn mcp_register_tools(
    app: AppHandle,
    tools: Vec<ToolMeta>,
    renderer_session: u64,
) -> Result<(), String> {
    if tools.is_empty() {
        return Err("MCP tool registration must contain at least one tool".into());
    }
    let state = app.state::<McpState>();
    let _lifecycle = state.lifecycle.lock().await;
    if !server::renderer_session_is_fresh(&state, renderer_session) {
        return Err("stale or expired MCP renderer session".into());
    }
    let token = state.token.lock().await;
    let published_epoch = state.published_epoch.load(Ordering::Acquire);
    let running = state.shutdown.lock().await.is_some();

    if running && published_epoch != 0 {
        let mut registry = state.registry.lock().await;
        let changed = *registry != tools;
        if changed {
            *registry = tools;
        }
        state.registry_initialized.store(true, Ordering::Release);
        drop(registry);
        if changed {
            let (_, next_epoch) =
                server::invalidate_pending(&state, server::PendingInterruption::Revoked, |epoch| {
                    let _ = app.emit(
                        "mcp:requests-revoked",
                        serde_json::json!({
                            "epoch": epoch,
                            "reason": "tool-registry-changed",
                            "rendererSession": renderer_session,
                        }),
                    );
                });
            state.published_epoch.store(next_epoch, Ordering::Release);
        }
        return Ok(());
    }

    *state.registry.lock().await = tools;
    state.registry_initialized.store(true, Ordering::Release);
    drop(token);
    server::publish_if_ready_locked(&app, &state).await?;
    Ok(())
}

#[tauri::command]
pub async fn mcp_tool_result(
    app: AppHandle,
    call_id: u64,
    result: Value,
    renderer_session: u64,
) -> Result<(), String> {
    let state = app.state::<McpState>();
    if let Some(call) = server::take_pending_result(&state, call_id, renderer_session) {
        let _ = call.sender.send(server::PendingReply::Result(result));
    }
    Ok(())
}

#[tauri::command]
pub async fn mcp_status(app: AppHandle) -> Result<McpStatus, String> {
    status(&app).await
}

#[tauri::command]
pub async fn mcp_set_enabled(app: AppHandle, enabled: bool) -> Result<McpStatus, String> {
    let state = app.state::<McpState>();
    let control = state.control.lock().await;
    if !enabled {
        let stop_result = server::stop(&app).await;
        finish_disable(stop_result, || {
            crate::config::update_config(|cfg| {
                cfg.mcp_enabled = false;
                Ok(())
            })
        })?;
        drop(control);
        return status(&app).await;
    }

    let cfg = crate::config::read_config()?;
    let running_port = *app.state::<McpState>().bound_port.lock().await;
    let started_port = if running_port.is_none() {
        Some(start_available(app.clone(), cfg.mcp_port).await?)
    } else {
        None
    };
    crate::config::update_config(|cfg| {
        if let Some(port) = started_port {
            cfg.mcp_port = port;
        }
        cfg.mcp_enabled = true;
        Ok(())
    })?;
    drop(control);
    status(&app).await
}

fn finish_disable(
    stop_result: Result<(), String>,
    persist_disabled: impl FnOnce() -> Result<(), String>,
) -> Result<(), String> {
    let persist_result = persist_disabled();
    match (stop_result, persist_result) {
        (Ok(()), Ok(())) => Ok(()),
        (Err(stop_error), Ok(())) => Err(stop_error),
        (Ok(()), Err(persist_error)) => Err(format!(
            "MCP server stopped, but the disabled setting could not be persisted: {persist_error}"
        )),
        (Err(stop_error), Err(persist_error)) => Err(format!(
            "{stop_error}. The disabled setting also could not be saved: {persist_error}"
        )),
    }
}

#[tauri::command]
pub async fn mcp_restart_server(app: AppHandle) -> Result<McpStatus, String> {
    let state = app.state::<McpState>();
    let control = state.control.lock().await;
    let preferred_port = crate::config::read_config()?.mcp_port;
    if state.bound_port.lock().await.is_some() {
        server::stop(&app).await?;
    }
    let port = start_available(app.clone(), preferred_port).await?;
    crate::config::update_config(|cfg| {
        cfg.mcp_port = port;
        cfg.mcp_enabled = true;
        Ok(())
    })?;
    drop(control);
    status(&app).await
}

#[tauri::command]
pub async fn mcp_connection_info(app: AppHandle) -> Result<McpConnectionInfo, String> {
    let state = app.state::<McpState>();
    let _lifecycle = state.lifecycle.lock().await;
    let epoch = state.epoch.load(Ordering::Acquire);
    let published_epoch = state.published_epoch.load(Ordering::Acquire);
    let renderer_session = state.active_renderer_session.load(Ordering::Acquire);
    if published_epoch == 0
        || published_epoch != epoch
        || !server::renderer_session_is_fresh(&state, renderer_session)
    {
        return Err("MCP server is not ready. Retry shortly.".into());
    }
    let port = state
        .bound_port
        .lock()
        .await
        .ok_or("MCP server is not running")?;
    let token = state
        .token
        .lock()
        .await
        .clone()
        .ok_or("MCP server is not running")?;
    Ok(McpConnectionInfo {
        url: format!("http://127.0.0.1:{port}/mcp"),
        token,
    })
}

#[tauri::command]
pub async fn mcp_regenerate_token(app: AppHandle) -> Result<(), String> {
    let state = app.state::<McpState>();
    let _control = state.control.lock().await;
    let _lifecycle = state.lifecycle.lock().await;
    let token = crate::secrets::generate_mcp_token();
    let running = state.shutdown.lock().await.is_some();
    if !running {
        crate::config::update_config(|config| {
            config.mcp_token = token.clone();
            Ok(())
        })?;
        return Ok(());
    }

    let port = state
        .bound_port
        .lock()
        .await
        .ok_or_else(|| "MCP server is running without a bound port".to_string())?;
    let published_epoch = state.published_epoch.load(Ordering::Acquire);
    let mut cached = state.token.lock().await;
    if !cached.as_deref().is_some_and(|token| !token.is_empty()) {
        return Err("MCP server is running without an active credential".into());
    }

    let mut previous_token = String::new();
    crate::config::update_config(|config| {
        previous_token = std::mem::replace(&mut config.mcp_token, token.clone());
        Ok(())
    })?;
    if published_epoch != 0 {
        if let Err(error) = server::rewrite_discovery_file(port, &token) {
            let rollback = crate::config::update_config(|config| {
                config.mcp_token = previous_token;
                Ok(())
            });
            return Err(match rollback {
                Ok(()) => format!("failed to publish regenerated MCP credential: {error}"),
                Err(rollback_error) => format!(
                    "failed to publish regenerated MCP credential: {error}. Restoring the previous config also failed: {rollback_error}"
                ),
            });
        }
    }
    *cached = Some(token);
    let (revoked_epoch, next_epoch) =
        server::invalidate_pending(&state, server::PendingInterruption::Revoked, |epoch| {
            let _ = app.emit(
                "mcp:requests-revoked",
                serde_json::json!({
                    "epoch": epoch,
                    "reason": "credential-regenerated",
                    "rendererSession": state.active_renderer_session.load(Ordering::Acquire),
                }),
            );
        });
    state.published_epoch.store(
        server::advance_published_epoch(published_epoch, revoked_epoch, next_epoch),
        Ordering::Release,
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{configured_start_candidate, finish_disable};
    use std::sync::atomic::{AtomicBool, Ordering};

    #[test]
    fn disabled_intent_is_persisted_even_when_stop_cleanup_fails() {
        let persisted = AtomicBool::new(false);
        let result = finish_disable(Err("discovery cleanup failed".into()), || {
            persisted.store(true, Ordering::Release);
            Ok(())
        });

        assert!(persisted.load(Ordering::Acquire));
        assert_eq!(result.unwrap_err(), "discovery cleanup failed");
    }

    #[test]
    fn disable_reports_both_stop_and_persistence_failures() {
        let error = finish_disable(Err("stop failed".into()), || Err("config failed".into()))
            .expect_err("both failures must be surfaced");
        assert!(error.contains("stop failed"));
        assert!(error.contains("config failed"));
    }

    #[test]
    fn stale_autostart_intent_rechecks_the_committed_enabled_state() {
        assert_eq!(configured_start_candidate(false, 5323, None), None);
        assert_eq!(configured_start_candidate(true, 5323, Some(6000)), None);
        assert_eq!(configured_start_candidate(true, 5323, None), Some(5323));
    }
}
