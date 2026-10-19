use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

use futures_util::{stream, StreamExt};
use serde::Serialize;
use serde_json::Value;

pub use oleafly_online::projects::RemoteProject;

use super::client::{self, Http};
use super::errors::app_error;
use super::session::{self, Session};
use super::socket;
use crate::app_error::AppError;

const CONCURRENT_IMPORTS: usize = 2;

static STAGING: AtomicU64 = AtomicU64::new(0);

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(tag = "phase", rename_all = "camelCase")]
pub enum ImportEvent {
    #[serde(rename_all = "camelCase")]
    Downloading {
        remote_id: String,
        received: u64,
        total: Option<u64>,
    },
    #[serde(rename_all = "camelCase")]
    Importing { remote_id: String },
    #[serde(rename_all = "camelCase")]
    Done {
        remote_id: String,
        project_id: String,
        main_doc: Option<String>,
        compiler: Option<String>,
    },
    #[serde(rename_all = "camelCase")]
    Failed { remote_id: String, error: String },
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ImportOutcome {
    pub remote_id: String,
    pub project_id: Option<String>,
    pub error: Option<String>,
}

/// Remote project id -> library project id, for projects imported from
/// `base`.
pub(crate) fn imported_projects(base: &str) -> HashMap<String, String> {
    let Ok(root) = crate::paths::projects_root() else {
        return HashMap::new();
    };
    oleafly_online::projects::imported_projects(&root, base)
}

/// The account's projects, newest first, each marked with the library
/// project it was imported as. An expired session is forgotten.
pub(crate) async fn list(base: &str) -> Result<(Session, Vec<RemoteProject>), String> {
    let http = Http::new(base)?;
    let store = crate::secrets::store()?;
    let (session, mut projects) = oleafly_online::projects::list_projects(http.online(), &store)
        .await
        .map_err(app_error)?;
    let imported = tauri::async_runtime::spawn_blocking({
        let base = base.to_string();
        move || imported_projects(&base)
    })
    .await
    .unwrap_or_default();
    for project in &mut projects {
        project.imported_as = imported.get(&project.id).cloned();
    }
    Ok((session, projects))
}

fn staging_path() -> Result<PathBuf, String> {
    let root = crate::paths::projects_root()?;
    std::fs::create_dir_all(&root).map_err(|error| error.to_string())?;
    Ok(root.join(format!(
        ".oleafly-online-import-{}-{}.zip",
        std::process::id(),
        STAGING.fetch_add(1, Ordering::SeqCst)
    )))
}

struct Staged(PathBuf);

impl Drop for Staged {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.0);
    }
}

pub(crate) fn origin_record(
    base: &str,
    remote: &RemoteProject,
    settings: &socket::ProjectSettings,
) -> Value {
    oleafly_online::projects::origin_record(
        base,
        remote,
        settings,
        oleafly_online::sync::now_seconds(),
    )
}

pub(crate) fn import_archive(
    archive: &Path,
    base: &str,
    remote: &RemoteProject,
    settings: &socket::ProjectSettings,
) -> Result<String, String> {
    let origin = origin_record(base, remote, settings);
    let flavor = settings
        .compiler
        .as_deref()
        .and_then(socket::flavor_for_compiler)
        .map(str::to_string);
    let main_doc = settings.main_doc.clone();
    crate::project::import_online_project_archive_with(
        remote.name.clone(),
        archive,
        move |project_id| {
            crate::project::apply_imported_settings(
                project_id,
                main_doc.as_deref(),
                flavor.as_deref(),
                origin,
            )
        },
    )
}

async fn import_one(
    http: &Http,
    cookie: &str,
    remote: &RemoteProject,
    emit: &(dyn Fn(ImportEvent) + Send + Sync),
) -> Result<(String, socket::ProjectSettings), String> {
    let settings = socket::fetch_project(http, cookie, &remote.id)
        .await
        .map(|project| socket::settings_from_project(&project))
        .unwrap_or_default();
    let staged = Staged(staging_path()?);
    let remote_id = remote.id.clone();
    http.download_zip(cookie, &remote.id, &staged.0, |received, total| {
        emit(ImportEvent::Downloading {
            remote_id: remote_id.clone(),
            received,
            total,
        });
    })
    .await?;
    emit(ImportEvent::Importing {
        remote_id: remote.id.clone(),
    });
    let archive = staged.0.clone();
    let base = http.base.clone();
    let task_remote = remote.clone();
    let task_settings = settings.clone();
    let project_id = tauri::async_runtime::spawn_blocking(move || {
        import_archive(&archive, &base, &task_remote, &task_settings)
    })
    .await
    .map_err(|error| error.to_string())??;
    drop(staged);
    Ok((project_id, settings))
}

pub(crate) async fn import(
    base: &str,
    ids: &[String],
    emit: &(dyn Fn(ImportEvent) + Send + Sync),
) -> Result<Vec<ImportOutcome>, String> {
    let (session, projects) = list(base).await?;
    let http = Http::new(base)?;
    let by_id: HashMap<String, RemoteProject> = projects
        .into_iter()
        .map(|project| (project.id.clone(), project))
        .collect();
    let mut seen = std::collections::HashSet::new();
    let wanted: Vec<(String, Option<RemoteProject>)> = ids
        .iter()
        .filter(|id| seen.insert(id.as_str()))
        .map(|id| (id.clone(), by_id.get(id).cloned()))
        .collect();
    let cookie = session.cookie;
    let outcomes = stream::iter(wanted)
        .map(|(id, remote)| {
            let http = http.clone();
            let cookie = cookie.clone();
            async move {
                let result = match remote {
                    Some(remote) => import_one(&http, &cookie, &remote, emit).await,
                    None => Err(AppError::new("overleaf.project_unavailable").into()),
                };
                match result {
                    Ok((project_id, settings)) => {
                        emit(ImportEvent::Done {
                            remote_id: id.clone(),
                            project_id: project_id.clone(),
                            main_doc: settings.main_doc,
                            compiler: settings.compiler,
                        });
                        ImportOutcome {
                            remote_id: id.clone(),
                            project_id: Some(project_id),
                            error: None,
                        }
                    }
                    Err(error) => {
                        if client::is_expired(&error) {
                            let _ = session::forget(&http.base);
                        }
                        emit(ImportEvent::Failed {
                            remote_id: id.clone(),
                            error: error.clone(),
                        });
                        ImportOutcome {
                            remote_id: id.clone(),
                            project_id: None,
                            error: Some(error),
                        }
                    }
                }
            }
        })
        .buffer_unordered(CONCURRENT_IMPORTS)
        .collect::<Vec<_>>()
        .await;
    Ok(outcomes)
}
