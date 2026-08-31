use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;

use tauri::{
    plugin::{Builder, TauriPlugin},
    Manager, Runtime,
};

mod commands;
mod native_capture;
mod server;

use server::PendingResults;

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    init_with_config(PluginConfig::default())
}

pub fn init_with_config<R: Runtime>(config: PluginConfig) -> TauriPlugin<R> {
    let pending: PendingResults = Arc::new(Mutex::new(HashMap::new()));
    let pending_for_setup = Arc::clone(&pending);

    Builder::new("playwright")
        .js_init_script("window.__PW_ACTIVE__ = true;".to_string())
        .invoke_handler(tauri::generate_handler![commands::pw_result])
        .setup(move |app, _api| {
            app.manage(pending_for_setup.clone());
            server::start(
                app.clone(),
                Arc::clone(&pending_for_setup),
                config.socket_path.clone(),
                config.tcp_port,
                config.window_label.clone(),
            );
            Ok(())
        })
        .build()
}

#[derive(Debug, Clone)]
pub struct PluginConfig {
    pub socket_path: Option<String>,
    pub tcp_port: Option<u16>,
    pub window_label: Option<String>,
}

impl Default for PluginConfig {
    fn default() -> Self {
        Self {
            socket_path: Some("/tmp/tauri-playwright.sock".to_string()),
            tcp_port: None,
            window_label: None,
        }
    }
}

impl PluginConfig {
    pub fn new() -> Self { Self::default() }
    pub fn socket_path(mut self, path: impl Into<String>) -> Self { self.socket_path = Some(path.into()); self }
    pub fn tcp_port(mut self, port: u16) -> Self { self.tcp_port = Some(port); self }
    pub fn window_label(mut self, label: impl Into<String>) -> Self { self.window_label = Some(label.into()); self }
}
