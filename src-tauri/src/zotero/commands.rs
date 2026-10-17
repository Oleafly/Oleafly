use std::collections::BTreeMap;
use std::sync::Arc;

use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

use super::export::{export, ExportedEntry, ItemRef, Style};
use super::http::{Endpoints, SyncError};
use super::links::{links_path, read_links, update_links, ProjectLink};
use super::search::SearchHit;
use super::sync::{Credentials, LocalProbe, Status, SyncOptions, WebState, ZoteroLibrary};
use super::{
    stored_credentials, verify_at, ZoteroAccount, API_KEY_SECRET, USERNAME_SECRET, USER_ID_SECRET,
};

pub const CHANGED_EVENT: &str = "zotero-library-changed";

pub struct ZoteroState(pub Arc<ZoteroLibrary>);

impl Default for ZoteroState {
    fn default() -> Self {
        let cache = crate::paths::oleafly_root()
            .ok()
            .map(|root| root.join("zotero").join("library.json"));
        Self(Arc::new(ZoteroLibrary::new(Endpoints::from_env(), cache)))
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchReply {
    pub generation: u64,
    pub total: usize,
    pub hits: Vec<SearchHit>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KeysReply {
    pub generation: u64,
    pub keys: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryReport {
    pub id: String,
    pub name: String,
    pub kind: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub item_count: Option<usize>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionReport {
    pub local: LocalProbe,
    pub web: WebState,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source: Option<&'static str>,
    pub libraries: Vec<LibraryReport>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

fn credentials() -> Option<Credentials> {
    let secrets = crate::secrets::read_connector_secrets().ok()?;
    let (user_id, api_key) = stored_credentials(&secrets).ok()?;
    Some(Credentials {
        user_id: user_id.0,
        api_key,
    })
}

fn options(offline: bool, force: bool) -> SyncOptions {
    SyncOptions {
        offline,
        force,
        credentials: credentials(),
    }
}

fn library(state: &State<'_, ZoteroState>) -> Arc<ZoteroLibrary> {
    Arc::clone(&state.0)
}

#[tauri::command]
pub async fn zotero_library_status(state: State<'_, ZoteroState>) -> Result<Status, String> {
    Ok(library(&state).load().await)
}

#[tauri::command]
pub async fn zotero_library_sync(
    app: AppHandle,
    state: State<'_, ZoteroState>,
    offline: bool,
    force: bool,
) -> Result<Status, String> {
    let library = library(&state);
    let emitter = app.clone();
    let before = library.generation();
    let status = library
        .sync(options(offline, force), &mut |status: Status| {
            let _ = emitter.emit(CHANGED_EVENT, &status);
        })
        .await;
    if status.generation != before || !status.syncing {
        let _ = app.emit(CHANGED_EVENT, &status);
    }
    Ok(status)
}

pub(super) async fn connection_report(
    library: &ZoteroLibrary,
    options: SyncOptions,
) -> ConnectionReport {
    library.load().await;
    let result = library.libraries_with_counts(&options).await;
    let status = library.status();
    match result {
        Ok((side, libraries)) => ConnectionReport {
            local: status.local,
            web: status.web,
            source: Some(match side {
                super::http::Side::Local => "local",
                super::http::Side::Web => "web",
            }),
            libraries: libraries
                .into_iter()
                .map(|(id, name, item_count)| LibraryReport {
                    kind: if id == super::item::USER_LIBRARY {
                        "user"
                    } else {
                        "group"
                    },
                    id,
                    name,
                    item_count,
                })
                .collect(),
            error: None,
        },
        Err(error) => ConnectionReport {
            local: status.local,
            web: match error {
                SyncError::KeyRejected => WebState::KeyRejected,
                SyncError::RateLimited { .. } => WebState::RateLimited,
                SyncError::Offline => WebState::Offline,
                _ => status.web,
            },
            source: None,
            libraries: Vec::new(),
            error: Some(error.app_error().into()),
        },
    }
}

#[tauri::command]
pub async fn zotero_library_test(
    state: State<'_, ZoteroState>,
    offline: bool,
) -> Result<ConnectionReport, String> {
    let library = library(&state);
    Ok(connection_report(&library, options(offline, true)).await)
}

#[tauri::command]
pub async fn zotero_library_search(
    state: State<'_, ZoteroState>,
    query: String,
    limit: usize,
) -> Result<SearchReply, String> {
    let library = library(&state);
    let (generation, result) = library.search(&query, limit);
    Ok(SearchReply {
        generation,
        total: result.total,
        hits: result.hits,
    })
}

#[tauri::command]
pub async fn zotero_library_lookup(
    state: State<'_, ZoteroState>,
    keys: Vec<String>,
) -> Result<Vec<Option<SearchHit>>, String> {
    Ok(library(&state).lookup(&keys))
}

#[tauri::command]
pub async fn zotero_library_keys(state: State<'_, ZoteroState>) -> Result<KeysReply, String> {
    let (generation, keys) = library(&state).keys();
    Ok(KeysReply { generation, keys })
}

#[tauri::command]
pub async fn zotero_library_items(
    state: State<'_, ZoteroState>,
    refs: Vec<ItemRef>,
) -> Result<Vec<Option<SearchHit>>, String> {
    let refs: Vec<(String, String)> = refs
        .into_iter()
        .map(|reference| (reference.library, reference.item_key))
        .collect();
    Ok(library(&state).items(&refs))
}

#[tauri::command]
pub async fn zotero_library_export(
    state: State<'_, ZoteroState>,
    refs: Vec<ItemRef>,
    style: Style,
    offline: bool,
) -> Result<Vec<ExportedEntry>, String> {
    let library = library(&state);
    Ok(export(&library, &refs, style, &options(offline, false)).await)
}

#[tauri::command]
pub async fn zotero_library_set_enabled(
    app: AppHandle,
    state: State<'_, ZoteroState>,
    library_id: String,
    enabled: bool,
) -> Result<Status, String> {
    let status = library(&state).set_enabled(&library_id, enabled).await;
    let _ = app.emit(CHANGED_EVENT, &status);
    Ok(status)
}

#[tauri::command]
pub async fn zotero_web_account() -> Result<Option<ZoteroAccount>, String> {
    let secrets = crate::secrets::read_connector_secrets()?;
    Ok(stored_credentials(&secrets)
        .ok()
        .map(|(user_id, _)| ZoteroAccount {
            user_id: user_id.0,
            username: secrets
                .get(USERNAME_SECRET)
                .map(|name| name.trim().to_string())
                .unwrap_or_default(),
        }))
}

#[tauri::command]
pub async fn zotero_web_connect(
    app: AppHandle,
    state: State<'_, ZoteroState>,
    user_id: String,
    api_key: String,
) -> Result<ZoteroAccount, String> {
    let library = library(&state);
    let account = verify_at(&library.endpoints().web, user_id.trim(), api_key.trim()).await?;
    let mut secrets = crate::secrets::read_connector_secrets()?;
    secrets.insert(USER_ID_SECRET.to_string(), account.user_id.clone());
    secrets.insert(USERNAME_SECRET.to_string(), account.username.clone());
    secrets.insert(API_KEY_SECRET.to_string(), api_key.trim().to_string());
    crate::secrets::write_connector_secrets(&secrets)?;
    let _ = app.emit(CHANGED_EVENT, &library.status());
    Ok(account)
}

#[tauri::command]
pub async fn zotero_web_disconnect(
    app: AppHandle,
    state: State<'_, ZoteroState>,
) -> Result<(), String> {
    let mut secrets = crate::secrets::read_connector_secrets()?;
    for name in [USER_ID_SECRET, USERNAME_SECRET, API_KEY_SECRET] {
        secrets.remove(name);
    }
    crate::secrets::write_connector_secrets(&secrets)?;
    let _ = app.emit(CHANGED_EVENT, &library(&state).status());
    Ok(())
}

fn project_links_path(project_id: &str) -> Result<std::path::PathBuf, String> {
    if project_id.trim().is_empty() {
        return Err("missing project".to_string());
    }
    Ok(links_path(&crate::paths::oleafly_root()?, project_id))
}

#[tauri::command]
pub async fn zotero_project_links(
    project_id: String,
) -> Result<BTreeMap<String, ProjectLink>, String> {
    let path = project_links_path(&project_id)?;
    tauri::async_runtime::spawn_blocking(move || read_links(&path))
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn zotero_update_project_links(
    project_id: String,
    changes: BTreeMap<String, Option<ProjectLink>>,
) -> Result<BTreeMap<String, ProjectLink>, String> {
    let path = project_links_path(&project_id)?;
    tauri::async_runtime::spawn_blocking(move || update_links(&path, changes))
        .await
        .map_err(|error| error.to_string())?
}
