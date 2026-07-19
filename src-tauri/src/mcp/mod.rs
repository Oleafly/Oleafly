pub mod protocol;
pub mod server;

use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Manager};

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
    let port = *state.bound_port.lock().await;
    let cfg = crate::config::read_config()?;
    Ok(McpStatus {
        running: port.is_some(),
        port,
        url: port.map(|p| format!("http://127.0.0.1:{p}/mcp")),
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

pub async fn start_configured(app: AppHandle, preferred_port: u16) -> Result<u16, String> {
    let port = start_available(app, preferred_port).await?;
    let mut cfg = crate::config::read_config()?;
    cfg.mcp_port = port;
    crate::config::write_config(&cfg)?;
    Ok(port)
}

#[tauri::command]
pub async fn mcp_register_tools(app: AppHandle, tools: Vec<ToolMeta>) -> Result<(), String> {
    let state = app.state::<McpState>();
    *state.registry.lock().await = tools;
    Ok(())
}

#[tauri::command]
pub async fn mcp_tool_result(app: AppHandle, call_id: u64, result: Value) -> Result<(), String> {
    let state = app.state::<McpState>();
    if let Some(tx) = state.pending.lock().await.remove(&call_id) {
        let _ = tx.send(result); // receiver may have timed out; that's fine
    }
    Ok(())
}

#[tauri::command]
pub async fn mcp_status(app: AppHandle) -> Result<McpStatus, String> {
    status(&app).await
}

#[tauri::command]
pub async fn mcp_set_enabled(app: AppHandle, enabled: bool) -> Result<McpStatus, String> {
    let cfg = crate::config::read_config()?;
    let running_port = *app.state::<McpState>().bound_port.lock().await;
    let started_port = if enabled && running_port.is_none() {
        Some(start_available(app.clone(), cfg.mcp_port).await?)
    } else {
        None
    };
    if !enabled && running_port.is_some() {
        server::stop(&app).await?;
    }
    let mut cfg = crate::config::read_config()?;
    if let Some(port) = started_port {
        cfg.mcp_port = port;
    }
    cfg.mcp_enabled = enabled;
    crate::config::write_config(&cfg)?;
    status(&app).await
}

#[tauri::command]
pub async fn mcp_restart_server(app: AppHandle) -> Result<McpStatus, String> {
    let preferred_port = crate::config::read_config()?.mcp_port;
    if app.state::<McpState>().bound_port.lock().await.is_some() {
        server::stop(&app).await?;
    }
    let port = start_available(app.clone(), preferred_port).await?;
    let mut cfg = crate::config::read_config()?;
    cfg.mcp_port = port;
    cfg.mcp_enabled = true;
    crate::config::write_config(&cfg)?;
    status(&app).await
}

#[tauri::command]
pub async fn mcp_connection_info(app: AppHandle) -> Result<McpConnectionInfo, String> {
    let state = app.state::<McpState>();
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
    let token = crate::secrets::generate_mcp_token();
    let mut cfg = crate::config::read_config()?;
    cfg.mcp_token = token.clone();
    crate::config::write_config(&cfg)?;
    let state = app.state::<McpState>();
    let mut cached = state.token.lock().await;
    if cached.is_some() {
        *cached = Some(token.clone());
        if let Some(port) = *state.bound_port.lock().await {
            // Best effort: keep the discovery file in sync.
            let _ = server::rewrite_discovery_file(port, &token);
        }
    }
    Ok(())
}
