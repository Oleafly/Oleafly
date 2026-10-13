use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use futures_util::{stream, StreamExt};
use serde::Serialize;
use serde_json::{json, Value};

use super::client::{self, Http};
use super::session::{self, Session};
use super::socket;
use crate::app_error::AppError;

const CONCURRENT_IMPORTS: usize = 2;
const SERVICE: &str = "overleaf";

static STAGING: AtomicU64 = AtomicU64::new(0);

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RemoteProject {
    pub id: String,
    pub name: String,
    pub owner_name: Option<String>,
    pub owned: bool,
    pub access: String,
    pub last_updated: Option<String>,
    pub last_updated_by: Option<String>,
    pub archived: bool,
    pub imported_as: Option<String>,
}

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

fn person_name(value: &Value) -> Option<String> {
    let text = |key: &str| {
        value
            .get(key)
            .and_then(Value::as_str)
            .map(str::trim)
            .unwrap_or_default()
    };
    let full = format!("{} {}", text("firstName"), text("lastName"))
        .trim()
        .to_string();
    if !full.is_empty() {
        return Some(full);
    }
    Some(text("email").to_string()).filter(|email| !email.is_empty())
}

pub(crate) fn remote_project(value: &Value, user_id: &str) -> Option<RemoteProject> {
    let id = value
        .get("id")
        .or_else(|| value.get("_id"))
        .and_then(Value::as_str)?
        .to_string();
    if !client::valid_project_id(&id) || value.get("trashed").and_then(Value::as_bool) == Some(true)
    {
        return None;
    }
    let name = value
        .get("name")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|name| !name.is_empty())
        .unwrap_or("Untitled project")
        .to_string();
    let owner = value.get("owner");
    let owner_id = owner
        .and_then(|owner| owner.get("id").or_else(|| owner.get("_id")))
        .and_then(Value::as_str);
    let access = value
        .get("accessLevel")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    Some(RemoteProject {
        owned: access == "owner" || owner_id == Some(user_id),
        owner_name: owner.and_then(person_name),
        access,
        last_updated: value
            .get("lastUpdated")
            .and_then(Value::as_str)
            .map(str::to_string),
        last_updated_by: value.get("lastUpdatedBy").and_then(person_name),
        archived: value
            .get("archived")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        imported_as: None,
        name,
        id,
    })
}

pub(crate) fn imported_projects(base: &str) -> HashMap<String, String> {
    let Ok(root) = crate::paths::projects_root() else {
        return HashMap::new();
    };
    let Ok(entries) = std::fs::read_dir(&root) else {
        return HashMap::new();
    };
    let mut found = HashMap::new();
    for entry in entries.flatten() {
        let Ok(raw) = std::fs::read_to_string(entry.path().join("project.json")) else {
            continue;
        };
        let Ok(meta) = serde_json::from_str::<Value>(&raw) else {
            continue;
        };
        let Some(origin) = meta.get("importedFrom") else {
            continue;
        };
        let text = |key: &str| origin.get(key).and_then(Value::as_str);
        if text("service") == Some(SERVICE) && text("server") == Some(base) {
            if let (Some(remote), Some(local)) = (text("projectId"), entry.file_name().to_str()) {
                found.insert(remote.to_string(), local.to_string());
            }
        }
    }
    found
}

pub(crate) async fn list(base: &str) -> Result<(Session, Vec<RemoteProject>), String> {
    let stored =
        session::load(base)?.ok_or_else(|| String::from(AppError::new("overleaf.signed_out")))?;
    let http = Http::new(base)?;
    let dashboard = match http.dashboard(&stored.cookie).await {
        Ok(dashboard) => dashboard,
        Err(error) => {
            if client::is_expired(&error) {
                let _ = session::forget(base);
            }
            return Err(error);
        }
    };
    let cookie = session::merge_set_cookies(
        &stored.cookie,
        dashboard.set_cookies.iter().map(String::as_str),
    );
    let _ = session::refresh_cookie(base, &stored, &cookie);
    let mut raw = dashboard.projects.clone();
    if client::needs_api(&dashboard) {
        if let Some(csrf) = dashboard.csrf.as_deref() {
            if let Ok(list) = http
                .api_projects(&cookie, csrf, client::api_size(&dashboard))
                .await
            {
                if raw.as_ref().is_none_or(|known| list.len() >= known.len()) {
                    raw = Some(list);
                }
            }
        }
    }
    let raw = raw.ok_or_else(|| String::from(AppError::new("overleaf.unrecognized")))?;
    let imported = tauri::async_runtime::spawn_blocking({
        let base = base.to_string();
        move || imported_projects(&base)
    })
    .await
    .unwrap_or_default();
    let mut projects: Vec<RemoteProject> = raw
        .iter()
        .filter_map(|value| remote_project(value, &dashboard.user_id))
        .map(|mut project| {
            project.imported_as = imported.get(&project.id).cloned();
            project
        })
        .collect();
    projects.sort_by(|left, right| right.last_updated.cmp(&left.last_updated));
    let session = Session {
        cookie,
        user_id: dashboard.user_id,
        email: if dashboard.email.is_empty() {
            stored.email
        } else {
            dashboard.email
        },
    };
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

fn epoch_seconds() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_secs())
        .unwrap_or_default()
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
    json!({
        "service": SERVICE,
        "server": base,
        "projectId": remote.id,
        "name": remote.name,
        "importedAt": epoch_seconds(),
        "compiler": settings.compiler,
        "texLive": settings.tex_live,
    })
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
    crate::project::import_project_archive_with(remote.name.clone(), archive, move |project_id| {
        crate::project::apply_imported_settings(
            project_id,
            main_doc.as_deref(),
            flavor.as_deref(),
            origin,
        )
    })
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
