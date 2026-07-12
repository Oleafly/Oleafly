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
pub async fn mcp_set_enabled(
    app: AppHandle,
    enabled: bool,
    port: u16,
) -> Result<McpStatus, String> {
    let mut cfg = crate::config::read_config()?;
    cfg.mcp_enabled = enabled;
    cfg.mcp_port = port;
    crate::config::write_config(&cfg)?;
    if enabled {
        // Restart to pick up a port change.
        server::stop(&app).await?;
        server::start(app.clone(), port).await?;
    } else {
        server::stop(&app).await?;
    }
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
