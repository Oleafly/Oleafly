use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use tauri::Manager;

pub fn lifecycle_plugin() -> tauri::plugin::TauriPlugin<tauri::Wry> {
    let started = Arc::new(AtomicBool::new(false));
    let settled = Arc::new(AtomicBool::new(false));
    tauri::plugin::Builder::new("research-lifecycle")
        .on_event(move |app, event| {
            let tauri::RunEvent::ExitRequested { api, code, .. } = event else {
                return;
            };
            if settled.load(Ordering::Acquire) || !crate::quit_gate::flush_confirmed() {
                return;
            }
            api.prevent_exit();
            if started.swap(true, Ordering::AcqRel) {
                return;
            }
            let app = app.clone();
            let settled = settled.clone();
            let code = code.unwrap_or(0);
            tauri::async_runtime::spawn(async move {
                shutdown(&app).await;
                settled.store(true, Ordering::Release);
                app.exit(code);
            });
        })
        .build()
}

pub(crate) async fn shutdown<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
    shutdown_work(app, false).await;
}

pub(crate) async fn prepare_update<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
    if let Some(agent) = app.try_state::<crate::agent::AgentState>() {
        crate::agent::pause_for_update(agent.inner());
    }
    shutdown_work(app, true).await;
}

async fn shutdown_work<R: tauri::Runtime>(app: &tauri::AppHandle<R>, updating: bool) {
    if let Some(tasks) = app.try_state::<crate::research_tasks::ResearchTaskState>() {
        tasks.shutdown().await;
    }
    if let (Some(agent), Some(exec)) = (
        app.try_state::<crate::agent::AgentState>(),
        app.try_state::<crate::agent_exec::AgentExecState>(),
    ) {
        if updating {
            crate::agent::cancel_for_update(agent.inner(), exec.inner()).await;
        } else {
            let _ = crate::agent::agent_cancel_all(agent, exec, "app-shutdown".into()).await;
        }
    }
    if let Some(runtime) = app.try_state::<Arc<crate::acp::AcpRuntime>>() {
        runtime.inner().shutdown_all().await;
    }
}
