use std::collections::HashMap;
use std::path::Path;

use futures_util::{stream, StreamExt};
use serde::Serialize;
use serde_json::Value;

pub use oleafly_online::projects::{Listing, RemoteProject};
use oleafly_online::realtime::project::{
    fetch_project, flavor_for_compiler, settings_from_project, ProjectSettings,
};

use super::client::Http;
use super::errors::app_error;
use super::session::{self, Session};
use crate::app_error::AppError;

const CONCURRENT_IMPORTS: usize = 2;
pub(crate) const IMPORT_STAGING: &str = ".oleafly-online-import";
const STALE_IMPORT: std::time::Duration = std::time::Duration::from_secs(60 * 60);
const SETTINGS_DEADLINE: std::time::Duration = std::time::Duration::from_secs(30);

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

pub(crate) fn imported_projects(base: &str) -> HashMap<String, String> {
    let Ok(root) = crate::paths::projects_root() else {
        return HashMap::new();
    };
    oleafly_online::projects::imported_projects(&root, base)
}

pub(crate) async fn list(base: &str, account: Option<&str>) -> Result<Listing, String> {
    let http = Http::new(base)?;
    let store = crate::secrets::store()?;
    let mut listing = oleafly_online::projects::list_account(http.online(), &store, account)
        .await
        .map_err(app_error)?;
    let imported = {
        let base = base.to_string();
        super::blocking(move || Ok(imported_projects(&base)))
            .await
            .unwrap_or_default()
    };
    for project in &mut listing.projects {
        project.imported_as = imported.get(&project.id).cloned();
    }
    Ok(listing)
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct OpenedLive {
    pub project_id: String,
    pub reused: bool,
}

pub(crate) async fn open_live(
    base: &str,
    account: Option<&str>,
    remote_id: &str,
) -> Result<OpenedLive, String> {
    let Listing {
        session, projects, ..
    } = list(base, account).await?;
    let remote = projects
        .into_iter()
        .find(|project| project.id == remote_id)
        .ok_or_else(|| String::from(AppError::new("overleaf.project_unavailable")))?;
    if let Some(project_id) = remote.imported_as.clone() {
        return Ok(OpenedLive {
            project_id,
            reused: true,
        });
    }
    let http = Http::new(base)?;
    let settings = project_settings(&http, &session.cookie, &remote.id).await;
    let base = base.to_owned();
    let project_id =
        super::blocking(move || open_shell(&base, &remote, &settings, &session)).await?;
    Ok(OpenedLive {
        project_id,
        reused: false,
    })
}

fn open_shell(
    base: &str,
    remote: &RemoteProject,
    settings: &ProjectSettings,
    account: &Session,
) -> Result<String, String> {
    let origin = origin_record(base, remote, settings, account);
    let flavor = settings.compiler.as_deref().and_then(flavor_for_compiler);
    let link = crate::overleaf::OverleafLink {
        server: base.to_owned(),
        project_id: remote.id.clone(),
        user_id: Some(account.user_id.clone()),
    };
    let data = crate::paths::oleafly_root()?;
    let mut marked = None;
    let created = crate::project::create_online_shell(
        remote.name.clone(),
        settings.main_doc.as_deref(),
        flavor,
        origin,
        |project_id| {
            let mirror = crate::collab::live::overleaf::mirror_dir(&data, &link, project_id)
                .map_err(|error| error.to_string())?;
            crate::collab::live::overleaf::opening::mark(&mirror).map_err(|error| {
                format!("could not prepare live editing for the new project: {error}")
            })?;
            marked = Some(mirror);
            Ok(())
        },
    );
    if created.is_err() {
        if let Some(mirror) = marked {
            if let Err(error) = std::fs::remove_dir_all(&mirror) {
                let _ = crate::project::append_app_log(format!(
                    "Could not remove {} after a failed open from Overleaf: {error}",
                    mirror.display()
                ));
            }
        }
    }
    created
}

pub(crate) fn sweep_import_staging() {
    if let Ok(root) = crate::paths::projects_root() {
        crate::staging::sweep_stale(
            &root,
            &[IMPORT_STAGING, super::create::CREATE_STAGING],
            STALE_IMPORT,
        );
    }
}

pub(crate) fn origin_record(
    base: &str,
    remote: &RemoteProject,
    settings: &ProjectSettings,
    account: &Session,
) -> Value {
    oleafly_online::projects::origin_record(
        base,
        remote,
        settings,
        account,
        oleafly_online::sync::now_seconds(),
    )
}

pub(crate) fn import_archive(
    archive: &Path,
    base: &str,
    remote: &RemoteProject,
    settings: &ProjectSettings,
    account: &Session,
) -> Result<String, String> {
    let origin = origin_record(base, remote, settings, account);
    let flavor = settings
        .compiler
        .as_deref()
        .and_then(flavor_for_compiler)
        .map(str::to_string);
    let main_doc = settings.main_doc.clone();
    let project_id = crate::project::import_online_project_archive_with(
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
    )?;
    remember_import(base, &remote.id, &project_id, &account.user_id);
    Ok(project_id)
}

fn remember_import(base: &str, remote_id: &str, project_id: &str, user_id: &str) {
    let link = crate::overleaf::OverleafLink {
        server: base.to_owned(),
        project_id: remote_id.to_owned(),
        user_id: Some(user_id.to_owned()),
    };
    let recorded = crate::paths::oleafly_root()
        .map_err(|error| error.to_string())
        .and_then(|data| {
            crate::collab::live::overleaf::mirror_dir(&data, &link, project_id)
                .map_err(|error| error.to_string())
        })
        .and_then(|mirror| {
            let root = crate::paths::project_dir(project_id)?;
            crate::collab::live::overleaf::record_import_bases(&mirror, &root)
                .map_err(|error| error.to_string())
        });
    if let Err(error) = recorded {
        let _ = crate::project::append_app_log(format!(
            "Could not record the imported text of project {project_id} for live editing: {error}"
        ));
    }
}

pub(super) fn names_a_main_file(project: &Value) -> bool {
    project
        .get("rootDoc_id")
        .and_then(Value::as_str)
        .is_some_and(|id| !id.trim().is_empty())
}

pub(super) async fn fetched_project(http: &Http, cookie: &str, remote_id: &str) -> Option<Value> {
    let fetched = tokio::time::timeout(
        SETTINGS_DEADLINE,
        fetch_project(http.online(), cookie, remote_id),
    )
    .await;
    match fetched {
        Ok(Ok(project)) => Some(project),
        Ok(Err(error)) => {
            let _ = crate::project::append_app_log(format!(
                "Could not read the settings of Overleaf project {remote_id}, so its main file and compiler are guessed: {error}"
            ));
            None
        }
        Err(_) => {
            let _ = crate::project::append_app_log(format!(
                "Reading the settings of Overleaf project {remote_id} took longer than {} s, so its main file and compiler are guessed",
                SETTINGS_DEADLINE.as_secs()
            ));
            None
        }
    }
}

async fn project_settings(http: &Http, cookie: &str, remote_id: &str) -> ProjectSettings {
    let Some(project) = fetched_project(http, cookie, remote_id).await else {
        return ProjectSettings::default();
    };
    let settings = settings_from_project(&project);
    if settings.main_doc.is_none() && names_a_main_file(&project) {
        let _ = crate::project::append_app_log(format!(
            "The main file the service names for project {remote_id} is not in its file list, so the main file is guessed"
        ));
    }
    settings
}

async fn import_one(
    http: &Http,
    account: &Session,
    remote: &RemoteProject,
    emit: &(dyn Fn(ImportEvent) + Send + Sync),
) -> Result<(String, ProjectSettings), String> {
    let cookie = account.cookie.as_str();
    let settings = project_settings(http, cookie, &remote.id).await;
    let staged = super::blocking(|| {
        crate::staging::StagedFile::in_dir(&crate::paths::projects_root()?, IMPORT_STAGING)
    })
    .await?;
    let remote_id = remote.id.clone();
    http.download_zip(cookie, &remote.id, staged.path(), |received, total| {
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
    let base = http.base.clone();
    let task_remote = remote.clone();
    let task_settings = settings.clone();
    let task_account = account.clone();
    let project_id = super::blocking(move || {
        let imported = import_archive(
            staged.path(),
            &base,
            &task_remote,
            &task_settings,
            &task_account,
        );
        drop(staged);
        imported
    })
    .await?;
    Ok((project_id, settings))
}

pub(crate) async fn import(
    base: &str,
    account: Option<&str>,
    ids: &[String],
    emit: &(dyn Fn(ImportEvent) + Send + Sync),
) -> Result<Vec<ImportOutcome>, String> {
    let Listing {
        session, projects, ..
    } = list(base, account).await?;
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
    let account = &session;
    let outcomes = stream::iter(wanted)
        .map(|(id, remote)| {
            let http = http.clone();
            async move {
                let result = match remote {
                    Some(remote) => import_one(&http, account, &remote, emit).await,
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
                        session::forget_if_expired(&http.base, &account.user_id, &error).await;
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
