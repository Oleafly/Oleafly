mod catalog;
pub mod commands;
mod protocol;
mod redact;
mod runtime;
mod store;
mod task_launch;
pub mod types;

pub use runtime::AcpRuntime;
pub use types::*;

use std::sync::Arc;
use tauri::{Emitter, Manager};

pub fn attach(app: &tauri::AppHandle) -> Result<(), String> {
    let runtime = AcpRuntime::new(crate::paths::oleafly_root()?.join("acp"))?;
    let mut events = runtime.subscribe();
    app.manage(runtime);
    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        loop {
            match events.recv().await {
                Ok(event) => {
                    let _ = handle.emit("acp:event", event);
                }
                Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => {
                    let _ = handle.emit("acp:resync", ());
                }
                Err(_) => break,
            }
        }
    });
    Ok(())
}

pub fn lifecycle_plugin() -> tauri::plugin::TauriPlugin<tauri::Wry> {
    tauri::plugin::Builder::new("acp-lifecycle")
        .on_event(|app, event| {
            if let Some(runtime) = app.try_state::<Arc<AcpRuntime>>() {
                match event {
                    tauri::RunEvent::Exit => runtime.stop_all_now(),
                    tauri::RunEvent::WindowEvent {
                        label,
                        event: tauri::WindowEvent::Destroyed,
                        ..
                    } => {
                        let runtime = runtime.inner().clone();
                        let label = label.clone();
                        tauri::async_runtime::spawn(async move {
                            runtime.close_owner(&label).await;
                        });
                    }
                    _ => {}
                }
            }
        })
        .on_page_load(|webview, payload| {
            if matches!(payload.event(), tauri::webview::PageLoadEvent::Started) {
                if let Some(runtime) = webview.try_state::<Arc<AcpRuntime>>() {
                    let runtime = runtime.inner().clone();
                    let owner = webview.window().label().to_owned();
                    tauri::async_runtime::spawn(async move {
                        runtime.close_owner(&owner).await;
                    });
                }
            }
        })
        .build()
}

#[cfg(test)]
pub(crate) mod tests;

#[cfg(all(test, target_os = "macos"))]
mod task_tests;
