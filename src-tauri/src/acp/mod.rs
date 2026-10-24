mod attachments;
mod buffers;
mod catalog;
mod coalesce;
pub mod commands;
mod export;
pub(crate) mod hermes;
mod host;
mod options;
mod permission_view;
pub(crate) mod preferences;
mod protocol;
mod providers;
mod redact;
pub(crate) mod remote;
mod review;
mod runtime;
mod sessions;
mod setup;
mod signin;
mod skill_block;
mod store;
mod task_launch;
mod transcript;
pub mod types;
mod updates;
mod usage_probe;

pub use options::ModelChoice;
pub use runtime::{AcpRuntime, PermissionDelegate};
pub use types::*;

use std::path::PathBuf;
use std::sync::{Arc, OnceLock};
use tauri::{Emitter, Manager};

pub(crate) async fn admit_agent_bridge<T>(
    project_id: &str,
    bridge: impl std::future::Future<Output = Result<T, String>>,
) -> Result<T, String> {
    crate::trust::require_trusted(project_id, crate::trust::Capability::ExternalAgents)?;
    bridge.await
}

static CLI_PROGRAM: OnceLock<PathBuf> = OnceLock::new();

/// The `oleafly` CLI agents may run (set once at startup by the CLI
/// install); its folder joins the agents' search path.
pub fn set_cli_program(path: PathBuf) {
    let _ = CLI_PROGRAM.set(path);
}

pub(crate) fn cli_program() -> Option<PathBuf> {
    CLI_PROGRAM.get().cloned()
}

/// Where an event goes: the window that owns the session, or every window
/// (tasks and child agents are watched from different places).
#[derive(Debug, PartialEq, Eq)]
pub(super) enum Route {
    Window(String),
    AllWindows,
}

pub(super) fn route_target(owner: Option<&str>, windows: &[String]) -> Route {
    match owner {
        Some(owner) if windows.iter().any(|window| window == owner) => Route::Window(owner.into()),
        _ => Route::AllWindows,
    }
}

pub fn attach(app: &tauri::AppHandle) -> Result<(), String> {
    let root = crate::paths::oleafly_root()?.join("acp");
    let runtime = AcpRuntime::new(root.clone())?;
    let buffers = buffers::WindowBuffers::new(app.clone());
    runtime.set_buffer_source(Arc::new(buffers.clone()));
    app.manage(buffers);
    // Agents left by an Oleafly that was killed are stopped before new ones
    // start; agents of a live background helper are kept.
    let registry_root = root.clone();
    let identity = oleafly_sandbox::process::identity::current();
    // Nothing waits for the reap; it runs in the background.
    drop(tauri::async_runtime::spawn_blocking(move || {
        use oleafly_sandbox::process::identity;
        let _ = oleafly_acp::orphans::PidRegistry::reap(
            &registry_root,
            |owner| {
                identity::owner_is_live(Some(owner.identity), identity::current(), identity::probe)
            },
            |pid, started| {
                matches!(identity::probe(pid), identity::ProcessProbe::Running { started: now }
                    if started.is_none() || now == started)
            },
        );
    }));
    if let Ok(registry) = oleafly_acp::orphans::PidRegistry::open(
        &root,
        oleafly_acp::orphans::OwnerTag {
            kind: "app".into(),
            identity,
        },
    ) {
        runtime.set_pid_registry(registry);
    }
    let mut events = runtime.subscribe();
    let mut summaries = runtime.subscribe_summaries();
    app.manage(runtime);
    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        loop {
            match events.recv().await {
                Ok(event) => {
                    let windows: Vec<String> = handle.webview_windows().keys().cloned().collect();
                    match route_target(event.owner.as_deref(), &windows) {
                        Route::Window(label) => {
                            let _ = handle.emit_to(
                                tauri::EventTarget::webview_window(label.as_str()),
                                "acp:event",
                                event,
                            );
                        }
                        Route::AllWindows => {
                            let _ = handle.emit("acp:event", event);
                        }
                    }
                }
                Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => {
                    let _ = handle.emit("acp:resync", ());
                }
                Err(_) => break,
            }
        }
    });
    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        loop {
            match summaries.recv().await {
                Ok(summary) => {
                    let _ = handle.emit("acp:session", summary);
                }
                Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
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
                if let (Some(runtime), Some(owner)) = (
                    webview.try_state::<Arc<AcpRuntime>>(),
                    crate::caller::own_window_label(webview),
                ) {
                    let runtime = runtime.inner().clone();
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
