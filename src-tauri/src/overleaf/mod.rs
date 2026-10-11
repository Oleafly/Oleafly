mod client;
mod html;
mod import;
mod session;
mod signin;
mod socket;

#[cfg(test)]
mod tests;

use serde::Serialize;
use tauri::ipc::Channel;
use tauri::{AppHandle, Runtime};

pub use import::{ImportEvent, ImportOutcome, RemoteProject};

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct OverleafStatus {
    pub server: String,
    pub signed_in: bool,
    pub email: Option<String>,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct OverleafProjects {
    pub status: OverleafStatus,
    pub projects: Vec<RemoteProject>,
}

fn status_for(base: &str, stored: Option<&session::Session>) -> OverleafStatus {
    OverleafStatus {
        server: base.to_string(),
        signed_in: stored.is_some(),
        email: stored
            .map(|session| session.email.clone())
            .filter(|email| !email.is_empty()),
    }
}

async fn blocking<T: Send + 'static>(
    work: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn overleaf_status(server: Option<String>) -> Result<OverleafStatus, String> {
    let base = session::normalize_server(server.as_deref())?;
    blocking(move || {
        let stored = session::load(&base)?;
        Ok(status_for(&base, stored.as_ref()))
    })
    .await
}

#[tauri::command]
pub async fn overleaf_sign_in<R: Runtime>(
    app: AppHandle<R>,
    server: Option<String>,
    title: String,
) -> Result<OverleafStatus, String> {
    let base = session::normalize_server(server.as_deref())?;
    let signed_in = signin::sign_in_with_window(&app, &base, &title).await?;
    let saved = signed_in.clone();
    let save_base = base.clone();
    blocking(move || session::save(&save_base, &saved)).await?;
    Ok(status_for(&base, Some(&signed_in)))
}

#[tauri::command]
pub async fn overleaf_sign_out(server: Option<String>) -> Result<OverleafStatus, String> {
    let base = session::normalize_server(server.as_deref())?;
    let forget_base = base.clone();
    blocking(move || session::forget(&forget_base)).await?;
    Ok(status_for(&base, None))
}

#[tauri::command]
pub async fn overleaf_list_projects(server: Option<String>) -> Result<OverleafProjects, String> {
    let base = session::normalize_server(server.as_deref())?;
    let (signed_in, projects) = import::list(&base).await?;
    Ok(OverleafProjects {
        status: status_for(&base, Some(&signed_in)),
        projects,
    })
}

#[tauri::command]
pub async fn overleaf_import_projects<R: Runtime>(
    app: AppHandle<R>,
    server: Option<String>,
    ids: Vec<String>,
    on_event: Channel<ImportEvent>,
) -> Result<Vec<ImportOutcome>, String> {
    let base = session::normalize_server(server.as_deref())?;
    let emit = move |event: ImportEvent| {
        let _ = on_event.send(event);
    };
    let outcomes = import::import(&base, &ids, &emit).await?;
    for project_id in outcomes
        .iter()
        .filter_map(|outcome| outcome.project_id.as_deref())
    {
        crate::project::record_tex_spec_for_new_project(&app, project_id);
    }
    Ok(outcomes)
}
