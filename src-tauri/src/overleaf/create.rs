use std::collections::{BTreeMap, BTreeSet};
use std::sync::Arc;
use std::time::Duration;

use oleafly_online::live::rest::{
    create_project, ProjectRest, RestError, SettingsUpdate, CREATE_LIMIT_BYTES,
};
use oleafly_online::realtime::project::{settings_from_project, ProjectSettings};
use oleafly_online::realtime::tree::OverleafTree;
use oleafly_online::realtime::{DocId, ProjectPage};
use oleafly_online::session::SessionHandle;
use serde::Serialize;
use serde_json::Value;

use super::client::Http;
use super::errors::{app_error, rest_error};
use super::import::{self, Listing, RemoteProject};
use super::session::{self, Session};
use super::OverleafLink;
use crate::app_error::AppError;
use crate::collab::live::overleaf::settings::{may_be_root, overleaf_compiler, Sides};

pub(crate) const CREATE_STAGING: &str = ".oleafly-online-create";
const FOLLOW_UP: Duration = Duration::from_secs(30);

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CreatedOnOverleaf {
    pub server: String,
    pub remote_id: String,
    pub name: String,
}

struct Packed {
    bytes: Vec<u8>,
    texts: BTreeMap<String, String>,
    meta: crate::project::ProjectMeta,
}

fn refuse_linked_or_shared(project_id: &str) -> Result<crate::project::ProjectMeta, String> {
    if super::overleaf_link_of(project_id)?.is_some() {
        return Err(AppError::new("overleaf.sync_already_linked").into());
    }
    let paths = oleafly_collab::CollabPaths::new(crate::paths::collab_root()?);
    let shared = oleafly_collab::load_binding(&paths, project_id)
        .map_err(|error| error.to_string())?
        .is_some();
    if shared || crate::collab::live::live_for(project_id).is_some() {
        return Err(AppError::new("overleaf.create_shared").into());
    }
    crate::project::read_meta(project_id)
}

fn pack(project_id: &str) -> Result<Packed, String> {
    let meta = refuse_linked_or_shared(project_id)?;
    let staged =
        crate::staging::StagedFile::in_dir(&crate::paths::projects_root()?, CREATE_STAGING)?;
    let texts = {
        let _worktree = crate::worktree_lock::ProjectWorktreeLock::shared(project_id)?;
        let root = crate::paths::project_dir(project_id)?;
        let files = oleafly_online::sync::online_files(&root).map_err(app_error)?;
        if oleafly_online::archive::one_top_folder(files.keys().map(String::as_str)).is_some() {
            return Err(AppError::new("overleaf.create_one_folder").into());
        }
        oleafly_online::archive::zip_files(&files, staged.path()).map_err(app_error)?
    };
    let size = std::fs::metadata(staged.path())
        .map_err(|error| format!("could not read the packed project: {error}"))?
        .len();
    if size > CREATE_LIMIT_BYTES {
        return Err(AppError::new("overleaf.create_too_large").into());
    }
    let bytes = std::fs::read(staged.path())
        .map_err(|error| format!("could not read the packed project: {error}"))?;
    drop(staged);
    Ok(Packed { bytes, texts, meta })
}

fn owned(listing: &Listing) -> BTreeSet<String> {
    listing
        .projects
        .iter()
        .filter(|project| project.owned)
        .map(|project| project.id.clone())
        .collect()
}

async fn reconcile(
    base: &str,
    account: &str,
    before: &BTreeSet<String>,
    error: &RestError,
) -> Result<String, String> {
    let _ = crate::project::append_app_log(format!(
        "The reply to the new Overleaf project was lost ({error}), so Oleafly checks the project list"
    ));
    let unconfirmed = || String::from(AppError::new("overleaf.create_unconfirmed"));
    let listing = match import::list(base, Some(account)).await {
        Ok(listing) => listing,
        Err(failure) => {
            let _ = crate::project::append_app_log(format!(
                "Could not list Overleaf projects to confirm the new one: {failure}"
            ));
            return Err(unconfirmed());
        }
    };
    let fresh: Vec<String> = owned(&listing).difference(before).cloned().collect();
    match fresh.as_slice() {
        [only] => Ok(only.clone()),
        [] if matches!(error, RestError::Unreachable(_)) => Err(rest_error(base, error, refused)),
        _ => {
            let _ = crate::project::append_app_log(format!(
                "Could not confirm the new Overleaf project: {} new projects were listed",
                fresh.len()
            ));
            Err(unconfirmed())
        }
    }
}

fn refused(message: &str) -> AppError {
    AppError::new("overleaf.create_refused").param("message", message)
}

async fn upload(
    http: &Http,
    signed: &Listing,
    csrf: &str,
    name: &str,
    bytes: Vec<u8>,
) -> Result<String, String> {
    let before = owned(signed);
    let account = &signed.session;
    match create_project(http.online(), &account.cookie, csrf, name, bytes).await {
        Ok(id) => Ok(id),
        Err(error @ (RestError::Lost(_) | RestError::Unreachable(_))) => {
            reconcile(&http.base, &account.user_id, &before, &error).await
        }
        Err(error) => {
            let failure = rest_error(&http.base, &error, refused);
            session::forget_if_expired(&http.base, &account.user_id, &failure).await;
            if !matches!(error, RestError::Refused { .. } | RestError::TooLarge) {
                let _ = crate::project::append_app_log(format!(
                    "Overleaf did not create the project: {error}"
                ));
            }
            Err(failure)
        }
    }
}

struct Fetched {
    name: Option<String>,
    settings: ProjectSettings,
    tree: Option<OverleafTree>,
    compiler: Option<String>,
    root_doc: Option<String>,
}

async fn fetched(http: &Http, cookie: &str, remote_id: &str) -> Fetched {
    let project = import::fetched_project(http, cookie, remote_id)
        .await
        .unwrap_or(Value::Null);
    let text = |key: &str| {
        project
            .get(key)
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_owned)
    };
    Fetched {
        name: text("name"),
        settings: settings_from_project(&project),
        tree: project
            .get("rootFolder")
            .and_then(OverleafTree::from_root_folder),
        compiler: text("compiler").map(|compiler| compiler.to_ascii_lowercase()),
        root_doc: text("rootDoc_id"),
    }
}

fn suffixed(created: &str, wanted: &str) -> bool {
    created
        .strip_prefix(wanted)
        .and_then(|rest| rest.strip_prefix(" ("))
        .and_then(|rest| rest.strip_suffix(')'))
        .is_some_and(|number| !number.is_empty() && number.bytes().all(|b| b.is_ascii_digit()))
}

fn settings_update(meta: &crate::project::ProjectMeta, found: &Fetched) -> SettingsUpdate {
    let mut update = SettingsUpdate::default();
    let local = Sides::local(meta);
    if let (Some(tree), Some(main)) = (&found.tree, local.main_doc.as_deref()) {
        if may_be_root(main) {
            if let Some(doc) = tree.id_at(main) {
                if found.root_doc.as_deref() != Some(doc.0.as_str()) {
                    update.root_doc = Some(DocId(doc.0.clone()));
                }
            }
        }
    }
    if let Some(compiler) = local.compiler.as_deref().and_then(overleaf_compiler) {
        if found.compiler.as_deref() != Some(compiler.as_str()) {
            update.compiler = Some(compiler);
        }
    }
    update
}

async fn follow_up(
    http: &Http,
    account: &Session,
    remote_id: &str,
    rename: Option<&str>,
    update: &SettingsUpdate,
) {
    if rename.is_none() && update.is_empty() {
        return;
    }
    let page = match ProjectPage::unloaded(remote_id) {
        Ok(page) => Arc::new(page),
        Err(error) => {
            let _ = crate::project::append_app_log(format!(
                "Could not set up the new Overleaf project {remote_id}: {error}"
            ));
            return;
        }
    };
    let rest = ProjectRest::new(http.online().clone(), page, remote_id);
    let handle = SessionHandle::new(&http.base, account.clone(), None);
    let work = async {
        if let Some(name) = rename {
            if let Err(error) = rest.rename_project(&handle, name).await {
                let _ = crate::project::append_app_log(format!(
                    "Could not give the new Overleaf project {remote_id} its name: {error}"
                ));
            }
        }
        if let Err(error) = rest.update_settings(&handle, update).await {
            let _ = crate::project::append_app_log(format!(
                "Could not set the main file and compiler of the new Overleaf project {remote_id}: {error}"
            ));
        }
    };
    if tokio::time::timeout(FOLLOW_UP, work).await.is_err() {
        let _ = crate::project::append_app_log(format!(
            "Setting up the new Overleaf project {remote_id} took longer than {} s",
            FOLLOW_UP.as_secs()
        ));
    }
}

fn link_local(
    project_id: &str,
    base: &str,
    remote: &RemoteProject,
    settings: &ProjectSettings,
    account: &Session,
    texts: BTreeMap<String, String>,
) -> Result<(), String> {
    let origin = import::origin_record(base, remote, settings, account);
    crate::project::record_online_origin(project_id, origin)?;
    let link = OverleafLink {
        server: base.to_owned(),
        project_id: remote.id.clone(),
        user_id: Some(account.user_id.clone()),
    };
    let bases: BTreeMap<String, String> = texts
        .into_iter()
        .filter_map(|(path, text)| Some((path, crate::collab::disk::as_text(text.as_bytes())?)))
        .collect();
    let written = crate::paths::oleafly_root()
        .and_then(|data| {
            crate::collab::live::overleaf::mirror_dir(&data, &link, project_id)
                .map_err(|error| error.to_string())
        })
        .and_then(|mirror| {
            crate::collab::live::overleaf::write_import_bases(&mirror, &bases)
                .map_err(|error| error.to_string())
        });
    if let Err(error) = written {
        let _ = crate::project::append_app_log(format!(
            "Could not record the text sent to Overleaf for project {project_id}, so its first live start compares every file: {error}"
        ));
    }
    Ok(())
}

pub(crate) async fn create_from_local(
    project_id: &str,
    base: &str,
    account: Option<&str>,
    name: Option<&str>,
) -> Result<CreatedOnOverleaf, String> {
    let id = project_id.to_owned();
    let Packed { bytes, texts, meta } = super::blocking(move || pack(&id)).await?;
    let wanted = name
        .map(str::trim)
        .filter(|name| !name.is_empty())
        .map_or_else(|| meta.name.trim().to_owned(), str::to_owned);
    let wanted = if wanted.is_empty() {
        String::from("Untitled project")
    } else {
        wanted
    };
    let signed = import::list(base, account).await?;
    let csrf = signed
        .csrf
        .clone()
        .ok_or_else(|| String::from(AppError::new("overleaf.unrecognized")))?;
    let http = Http::new(base)?;
    let remote_id = upload(&http, &signed, &csrf, &wanted, bytes).await?;
    let account = signed.session;
    let found = fetched(&http, &account.cookie, &remote_id).await;
    let created_name = found.name.clone().unwrap_or_else(|| wanted.clone());
    let remote = RemoteProject {
        id: remote_id.clone(),
        name: created_name.clone(),
        owner_name: None,
        owned: true,
        access: "owner".to_owned(),
        last_updated: None,
        last_updated_by: None,
        archived: false,
        imported_as: Some(project_id.to_owned()),
    };
    {
        let (id, base, remote, settings, account) = (
            project_id.to_owned(),
            base.to_owned(),
            remote.clone(),
            found.settings.clone(),
            account.clone(),
        );
        super::blocking(move || link_local(&id, &base, &remote, &settings, &account, texts))
            .await?;
    }
    let rename = (created_name != wanted && !suffixed(&created_name, &wanted)).then_some(wanted);
    let update = settings_update(&meta, &found);
    follow_up(&http, &account, &remote_id, rename.as_deref(), &update).await;
    Ok(CreatedOnOverleaf {
        server: base.to_owned(),
        remote_id,
        name: rename.unwrap_or(created_name),
    })
}

#[tauri::command]
pub async fn overleaf_create_from_local(
    project_id: String,
    server: Option<String>,
    account: Option<String>,
    name: Option<String>,
) -> Result<CreatedOnOverleaf, String> {
    let base = session::normalize_server(server.as_deref())?;
    create_from_local(&project_id, &base, account.as_deref(), name.as_deref()).await
}
