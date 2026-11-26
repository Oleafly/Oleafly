use std::collections::HashMap;
use std::path::Path;

use oleafly_secrets::SecretStore;
use serde::Serialize;
use serde_json::{json, Value};

use crate::client::{self, Http, ProjectInvite};
use crate::error::{OnlineError, OnlineErrorKind};
use crate::realtime::project::ProjectSettings;
use crate::service::SERVICE_ID;
use crate::session::{self, Session};
use crate::sync::SyncLink;

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

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ImportedFrom {
    pub server: String,
    pub project_id: String,
    pub user_id: Option<String>,
    pub email: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct OverleafLink {
    pub server: String,
    pub project_id: String,
    pub user_id: Option<String>,
}

pub fn live_link(current: Option<SyncLink>, origin: Option<ImportedFrom>) -> Option<OverleafLink> {
    let Some(link) = current else {
        return origin.map(|origin| OverleafLink {
            server: origin.server,
            project_id: origin.project_id,
            user_id: origin.user_id,
        });
    };
    let user_id = origin
        .filter(|origin| origin.project_id == link.remote_id)
        .and_then(|origin| origin.user_id);
    Some(OverleafLink {
        server: link.server,
        project_id: link.remote_id,
        user_id,
    })
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

pub fn remote_project(value: &Value, user_id: &str) -> Option<RemoteProject> {
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

pub struct Listing {
    pub session: Session,
    pub csrf: Option<String>,
    pub projects: Vec<RemoteProject>,
    pub invites: Vec<ProjectInvite>,
}

pub async fn list_projects(
    http: &Http,
    store: &SecretStore,
    account: Option<&str>,
) -> Result<(Session, Vec<RemoteProject>), OnlineError> {
    list_account(http, store, account)
        .await
        .map(|listing| (listing.session, listing.projects))
}

pub async fn list_account(
    http: &Http,
    store: &SecretStore,
    account: Option<&str>,
) -> Result<Listing, OnlineError> {
    let base = http.base.clone();
    let stored = match account {
        Some(user_id) => session::load_account(store, &base, user_id)?,
        None => session::load(store, &base)?,
    }
    .ok_or_else(|| OnlineError::new(OnlineErrorKind::SignedOut))?;
    let dashboard = match http.dashboard(&stored.cookie).await {
        Ok(dashboard) => dashboard,
        Err(error) => {
            if error.kind == OnlineErrorKind::SessionExpired {
                let _ = session::forget_account(store, &base, &stored.user_id);
            }
            return Err(error);
        }
    };
    let cookie = session::merge_set_cookies(
        &stored.cookie,
        dashboard.set_cookies.iter().map(String::as_str),
    );
    let _ = session::refresh_cookie(store, &base, &stored, &cookie);
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
    let raw = raw.ok_or_else(|| OnlineError::new(OnlineErrorKind::Unrecognized))?;
    let mut projects: Vec<RemoteProject> = raw
        .iter()
        .filter_map(|value| remote_project(value, &dashboard.user_id))
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
        saved_by: stored.saved_by,
    };
    let invites = dashboard
        .invites
        .into_iter()
        .filter(|invite| {
            !projects
                .iter()
                .any(|project| project.id == invite.project_id)
        })
        .collect();
    Ok(Listing {
        session,
        csrf: dashboard.csrf,
        projects,
        invites,
    })
}

pub fn imported_projects(projects_root: &Path, base: &str) -> HashMap<String, String> {
    let Ok(entries) = std::fs::read_dir(projects_root) else {
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
        let Some(origin) = meta.get("importedFrom").and_then(imported_from) else {
            continue;
        };
        if origin.server == base {
            if let Some(local) = entry.file_name().to_str() {
                found.insert(origin.project_id, local.to_string());
            }
        }
    }
    found
}

pub fn imported_from(record: &Value) -> Option<ImportedFrom> {
    let text = |key: &str| record.get(key).and_then(Value::as_str);
    if text("service") != Some(SERVICE_ID) {
        return None;
    }
    let optional = |key: &str| {
        text(key)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
    };
    Some(ImportedFrom {
        server: text("server")?.to_string(),
        project_id: text("projectId")?.to_string(),
        user_id: optional("userId"),
        email: optional("email"),
    })
}

pub fn origin_record(
    base: &str,
    remote: &RemoteProject,
    settings: &ProjectSettings,
    account: &Session,
    now_seconds: u64,
) -> Value {
    let mut record = json!({
        "service": SERVICE_ID,
        "server": base,
        "projectId": remote.id,
        "name": remote.name,
        "importedAt": now_seconds,
        "compiler": settings.compiler,
        "texLive": settings.tex_live,
    });
    record_account(&mut record, &account.user_id, &account.email);
    record
}

pub fn record_account(record: &mut Value, user_id: &str, email: &str) -> bool {
    let Some(fields) = record.as_object_mut() else {
        return false;
    };
    let mut changed = false;
    for (key, value) in [("userId", user_id), ("email", email)] {
        if value.is_empty() || fields.get(key).and_then(Value::as_str) == Some(value) {
            continue;
        }
        fields.insert(key.to_string(), Value::String(value.to_string()));
        changed = true;
    }
    changed
}
