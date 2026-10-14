use super::oauth::{
    authorize_url, bind_loopback, dropbox_app_key, redirect_uri, DropboxAuthClient,
    LoopbackListener, LoopbackPages, OAuthError, PkceFlow, TokenSet,
};
use crate::app_error::AppError;
use crate::secrets::SecretBackend;
use oleafly_core::ids::DeviceId;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

const REFRESH_SECRET_ACCOUNT: &str = "cloud/dropbox/refresh";
const CONNECT_TIMEOUT: Duration = Duration::from_secs(600);

#[derive(Clone, Deserialize, Serialize)]
struct ConnectedAccount {
    account_id: String,
    email: String,
    display_name: String,
    backend: SecretBackend,
    enabled: bool,
}

#[derive(Clone, Deserialize, Serialize)]
struct ConnectionFile {
    device_id: DeviceId,
    device_name: String,
    #[serde(default)]
    last_email: Option<String>,
    #[serde(default)]
    account: Option<ConnectedAccount>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CloudSpaceView {
    used: u64,
    allocated: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CloudStateView {
    status: &'static str,
    email: Option<String>,
    display_name: Option<String>,
    device_name: String,
    enabled: bool,
    last_email: Option<String>,
    space: Option<CloudSpaceView>,
    projects: Vec<CloudProjectView>,
}

fn disconnected_view(device_name: String, last_email: Option<String>) -> CloudStateView {
    CloudStateView {
        status: "disconnected",
        email: None,
        display_name: None,
        device_name,
        enabled: false,
        last_email,
        space: None,
        projects: Vec::new(),
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectBegin {
    flow_id: String,
    auth_url: String,
    paste: bool,
}

#[derive(Serialize)]
pub struct ConnectDone {
    email: String,
}

struct Flow {
    pkce: PkceFlow,
    redirect: Option<String>,
    listener: Option<LoopbackListener>,
    shutdown: Option<std::sync::Arc<tokio::sync::Notify>>,
}

fn stop_flow(flow: Flow) {
    if let Some(listener) = flow.listener {
        listener.cancel();
    } else if let Some(shutdown) = flow.shutdown {
        shutdown.notify_one();
    }
}

struct TokenCache {
    access_token: String,
    expires_at_ms: u64,
}

fn flows() -> &'static Mutex<HashMap<String, Flow>> {
    static FLOWS: OnceLock<Mutex<HashMap<String, Flow>>> = OnceLock::new();
    FLOWS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn token_cache() -> &'static std::sync::Mutex<Option<TokenCache>> {
    static CACHE: OnceLock<std::sync::Mutex<Option<TokenCache>>> = OnceLock::new();
    CACHE.get_or_init(|| std::sync::Mutex::new(None))
}

fn refresh_gate() -> &'static tokio::sync::Mutex<()> {
    static GATE: OnceLock<tokio::sync::Mutex<()>> = OnceLock::new();
    GATE.get_or_init(|| tokio::sync::Mutex::new(()))
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| u64::try_from(elapsed.as_millis()).unwrap_or(u64::MAX))
        .unwrap_or(0)
}

fn app_error(error: &OAuthError) -> String {
    let code = match error.key() {
        "sign_in_cancelled" => "cloud.sign_in_cancelled",
        "sign_in_timeout" => "cloud.sign_in_timeout",
        "code_invalid" => "cloud.code_invalid",
        "revoked" => "cloud.revoked",
        "no_port" => "cloud.network",
        _ => "cloud.network",
    };
    AppError::new(code).into()
}

fn plain_error(message: impl Into<String>) -> String {
    AppError::new("cloud.network").detail(message.into()).into()
}

fn connection_path() -> Result<PathBuf, String> {
    Ok(crate::paths::oleafly_root()?
        .join("cloud")
        .join("connection.json"))
}

fn read_connection_at(path: &Path) -> Result<Option<ConnectionFile>, String> {
    let bytes = match std::fs::read(path) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(plain_error(error.to_string())),
    };
    if bytes.len() > 1024 * 1024 {
        return Err(plain_error("cloud connection record is too large"));
    }
    serde_json::from_slice(&bytes)
        .map(Some)
        .map_err(|error| plain_error(error.to_string()))
}

fn write_connection_at(path: &Path, file: &ConnectionFile) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| plain_error("cloud connection path has no parent"))?;
    std::fs::create_dir_all(parent).map_err(|error| plain_error(error.to_string()))?;
    let bytes = serde_json::to_vec_pretty(file).map_err(|error| plain_error(error.to_string()))?;
    crate::sandbox::atomic_write(path, &bytes)
}

fn read_connection() -> Result<Option<ConnectionFile>, String> {
    read_connection_at(&connection_path()?)
}

fn write_connection(file: &ConnectionFile) -> Result<(), String> {
    write_connection_at(&connection_path()?, file)
}

#[cfg(unix)]
fn computer_name() -> String {
    let mut buffer = vec![0_u8; 256];
    let result = unsafe { libc::gethostname(buffer.as_mut_ptr().cast(), buffer.len()) };
    if result != 0 {
        return "This computer".into();
    }
    let end = buffer
        .iter()
        .position(|byte| *byte == 0)
        .unwrap_or(buffer.len());
    let name = String::from_utf8_lossy(&buffer[..end]).trim().to_string();
    let name = name.strip_suffix(".local").unwrap_or(&name).to_string();
    if name.is_empty() {
        "This computer".into()
    } else {
        name
    }
}

#[cfg(not(unix))]
fn computer_name() -> String {
    std::env::var("COMPUTERNAME")
        .map(|name| name.trim().to_string())
        .ok()
        .filter(|name| !name.is_empty())
        .unwrap_or_else(|| "This computer".into())
}

fn validate_device_name(name: &str) -> Result<String, String> {
    let name = name.trim();
    if name.is_empty() {
        return Err(AppError::new("cloud.device_name_empty").into());
    }
    if name.chars().count() > 32
        || name
            .chars()
            .any(|c| matches!(c, '\\' | '/' | ':' | '*' | '?' | '"' | '<' | '>' | '|'))
    {
        return Err(AppError::new("cloud.device_name_invalid").into());
    }
    Ok(name.to_string())
}

fn extract_pasted_code(pasted: &str, expected_state: &str) -> Result<String, OAuthError> {
    let pasted = pasted.trim();
    if pasted.is_empty() {
        return Err(OAuthError::CodeInvalid);
    }
    let looks_like_url = pasted.starts_with("http://") || pasted.starts_with("https://");
    if !looks_like_url && !pasted.contains("code=") {
        if pasted.chars().any(char::is_whitespace) || pasted.contains('/') {
            return Err(OAuthError::CodeInvalid);
        }
        return Ok(pasted.to_string());
    }
    let parsed = reqwest::Url::parse(pasted).map_err(|_| OAuthError::CodeInvalid)?;
    let mut code = None;
    let mut state = None;
    for (key, value) in parsed.query_pairs() {
        match key.as_ref() {
            "code" => code = Some(value.into_owned()),
            "state" => state = Some(value.into_owned()),
            _ => {}
        }
    }
    if state
        .as_deref()
        .is_some_and(|value| value != expected_state)
    {
        return Err(OAuthError::CodeInvalid);
    }
    code.filter(|value| !value.is_empty())
        .ok_or(OAuthError::CodeInvalid)
}

fn auth_client() -> Result<DropboxAuthClient, String> {
    DropboxAuthClient::new().map_err(|error| app_error(&error))
}

async fn finish_connect(tokens: TokenSet) -> Result<ConnectDone, String> {
    let client = auth_client()?;
    let account = client
        .current_account(&tokens.access_token)
        .await
        .map_err(|error| app_error(&error))?;
    let refresh = tokens
        .refresh_token
        .clone()
        .ok_or_else(|| AppError::new("cloud.code_invalid").to_string())?;
    let choice = crate::secrets::set_cloud_secret(REFRESH_SECRET_ACCOUNT, &refresh)?;
    let mut file = read_connection()?.unwrap_or_else(|| ConnectionFile {
        device_id: DeviceId::new(),
        device_name: computer_name(),
        last_email: None,
        account: None,
    });
    file.last_email = Some(account.email.clone());
    file.account = Some(ConnectedAccount {
        account_id: account.account_id.clone(),
        email: account.email.clone(),
        display_name: account.display_name.clone(),
        backend: choice.backend,
        enabled: true,
    });
    write_connection(&file)?;
    *token_cache()
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner) = Some(TokenCache {
        access_token: tokens.access_token,
        expires_at_ms: now_ms().saturating_add(tokens.expires_in.saturating_mul(1_000)),
    });
    Ok(ConnectDone {
        email: account.email,
    })
}

async fn access_token() -> Result<String, String> {
    let _gate = refresh_gate().lock().await;
    {
        let cache = token_cache()
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if let Some(cached) = cache.as_ref() {
            if cached.expires_at_ms > now_ms().saturating_add(60_000) {
                return Ok(cached.access_token.clone());
            }
        }
    }
    let file =
        read_connection()?.ok_or_else(|| AppError::new("cloud.not_connected").to_string())?;
    let account = file
        .account
        .ok_or_else(|| AppError::new("cloud.not_connected").to_string())?;
    let refresh = crate::secrets::get_cloud_secret(REFRESH_SECRET_ACCOUNT, account.backend)?
        .ok_or_else(|| AppError::new("cloud.revoked").to_string())?;
    let client = auth_client()?;
    let tokens = client
        .refresh(dropbox_app_key(), &refresh)
        .await
        .map_err(|error| app_error(&error))?;
    let access = tokens.access_token.clone();
    *token_cache()
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner) = Some(TokenCache {
        access_token: tokens.access_token,
        expires_at_ms: now_ms().saturating_add(tokens.expires_in.saturating_mul(1_000)),
    });
    Ok(access)
}

#[tauri::command]
pub async fn cloud_connect_begin(paste: bool) -> Result<ConnectBegin, String> {
    {
        let mut live = flows()
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        for (_, flow) in live.drain() {
            stop_flow(flow);
        }
    }
    let pkce = PkceFlow::generate();
    let locale = crate::i18n::current();
    let locale = (locale != "en").then(|| locale.replace('-', "_"));
    let (redirect, listener, paste) = if paste {
        (None, None, true)
    } else {
        let pages = LoopbackPages {
            success: crate::i18n::t("cloud.connectedPage"),
            failure: crate::i18n::t("cloud.failedPage"),
        };
        match bind_loopback(pkce.state.clone(), pages).await {
            Ok(listener) => (Some(redirect_uri(listener.port)), Some(listener), false),
            Err(OAuthError::NoPort) => (None, None, true),
            Err(error) => return Err(app_error(&error)),
        }
    };
    let auth_url = authorize_url(
        dropbox_app_key(),
        &pkce,
        redirect.as_deref(),
        locale.as_deref(),
    );
    let flow_id = pkce.state.clone();
    let shutdown = listener.as_ref().map(LoopbackListener::shutdown_handle);
    flows()
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .insert(
            flow_id.clone(),
            Flow {
                pkce,
                redirect,
                listener,
                shutdown,
            },
        );
    Ok(ConnectBegin {
        flow_id,
        auth_url,
        paste,
    })
}

#[tauri::command]
pub async fn cloud_connect_wait(flow_id: String) -> Result<ConnectDone, String> {
    let listener = {
        let mut live = flows()
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let flow = live
            .get_mut(&flow_id)
            .ok_or_else(|| AppError::new("cloud.code_invalid").to_string())?;
        flow.listener
            .take()
            .ok_or_else(|| AppError::new("cloud.code_invalid").to_string())?
    };
    let code = match listener.wait(CONNECT_TIMEOUT).await {
        Ok(code) => code,
        Err(error) => {
            flows()
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .remove(&flow_id);
            return Err(app_error(&error));
        }
    };
    let flow = flows()
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .remove(&flow_id)
        .ok_or_else(|| AppError::new("cloud.code_invalid").to_string())?;
    let client = auth_client()?;
    let tokens = client
        .exchange_code(
            dropbox_app_key(),
            &code,
            flow.pkce.verifier(),
            flow.redirect.as_deref(),
        )
        .await
        .map_err(|error| app_error(&error))?;
    finish_connect(tokens).await
}

#[tauri::command]
pub async fn cloud_connect_paste(flow_id: String, code: String) -> Result<ConnectDone, String> {
    let flow = flows()
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .remove(&flow_id)
        .ok_or_else(|| AppError::new("cloud.code_invalid").to_string())?;
    if flow.listener.is_some() || flow.redirect.is_some() {
        stop_flow(flow);
        return Err(AppError::new("cloud.code_invalid").into());
    }
    let code = extract_pasted_code(&code, &flow.pkce.state).map_err(|error| app_error(&error))?;
    let client = auth_client()?;
    let tokens = client
        .exchange_code(dropbox_app_key(), &code, flow.pkce.verifier(), None)
        .await
        .map_err(|error| app_error(&error))?;
    finish_connect(tokens).await
}

#[tauri::command]
pub fn cloud_connect_cancel(flow_id: String) {
    let flow = flows()
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .remove(&flow_id);
    if let Some(flow) = flow {
        stop_flow(flow);
    }
}

#[tauri::command]
pub async fn cloud_state() -> Result<CloudStateView, String> {
    let file = read_connection()?;
    let Some(file) = file else {
        return Ok(disconnected_view(computer_name(), None));
    };
    let Some(account) = file.account.clone() else {
        return Ok(disconnected_view(file.device_name, file.last_email));
    };
    let space = match access_token().await {
        Ok(token) => match auth_client() {
            Ok(client) => client
                .space_usage(&token)
                .await
                .ok()
                .map(|(used, allocated)| CloudSpaceView { used, allocated }),
            Err(_) => None,
        },
        Err(_) => None,
    };
    let projects = project_views(&account.account_id).await;
    Ok(CloudStateView {
        status: "connected",
        email: Some(account.email),
        display_name: Some(account.display_name),
        device_name: file.device_name,
        enabled: account.enabled,
        last_email: file.last_email,
        space,
        projects,
    })
}

#[tauri::command]
pub async fn cloud_disconnect() -> Result<(), String> {
    let Some(mut file) = read_connection()? else {
        return Ok(());
    };
    if let Some(account) = file.account.take() {
        if let Ok(token) = access_token().await {
            if let Ok(client) = auth_client() {
                let _ = client.revoke(&token).await;
            }
        }
        let _ = crate::secrets::delete_cloud_secret(REFRESH_SECRET_ACCOUNT, account.backend);
        *token_cache()
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner) = None;
        file.last_email = Some(account.email);
    }
    write_connection(&file)
}

#[tauri::command]
pub fn cloud_set_enabled(on: bool) -> Result<(), String> {
    let mut file =
        read_connection()?.ok_or_else(|| AppError::new("cloud.not_connected").to_string())?;
    let account = file
        .account
        .as_mut()
        .ok_or_else(|| AppError::new("cloud.not_connected").to_string())?;
    account.enabled = on;
    write_connection(&file)
}

#[tauri::command]
pub fn cloud_set_device_name(name: String) -> Result<(), String> {
    let name = validate_device_name(&name)?;
    let mut file = read_connection()?.unwrap_or_else(|| ConnectionFile {
        device_id: DeviceId::new(),
        device_name: computer_name(),
        last_email: None,
        account: None,
    });
    file.device_name = name;
    write_connection(&file)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CloudProjectView {
    local_id: Option<String>,
    cloud_id: String,
    name: String,
    mode: &'static str,
    last_synced_ms: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadDone {
    local_id: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncProjectReport {
    local_id: String,
    uploaded: usize,
    downloaded: usize,
    deleted_remote: usize,
    deleted_local: usize,
    conflicts: usize,
    error: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncReport {
    projects: Vec<SyncProjectReport>,
    last_synced_ms: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsSyncResult {
    applied: Option<serde_json::Value>,
}

fn sync_gate() -> &'static tokio::sync::Mutex<()> {
    static GATE: OnceLock<tokio::sync::Mutex<()>> = OnceLock::new();
    GATE.get_or_init(|| tokio::sync::Mutex::new(()))
}

fn sync_context(file: &ConnectionFile) -> Result<(super::engine::SyncContext, String), String> {
    let account = file
        .account
        .clone()
        .ok_or_else(|| AppError::new("cloud.not_connected").to_string())?;
    Ok((
        super::engine::SyncContext {
            device: file.device_id,
            device_name: file.device_name.clone(),
            account_id: account.account_id.clone(),
        },
        account.account_id,
    ))
}

async fn dropbox_store() -> Result<super::store::DropboxStore, String> {
    let token = access_token().await?;
    super::store::DropboxStore::new(token).map_err(|error| plain_error(error.to_string()))
}

fn library_projects() -> Vec<crate::project::ProjectInfo> {
    crate::project::list_projects_blocking()
        .unwrap_or_default()
        .into_iter()
        .filter(|project| {
            matches!(
                project.location,
                crate::project_availability::ProjectLocationInfo::Library
            ) && !project.recovery_pending
        })
        .collect()
}

fn cloud_id_for(
    local_id: &str,
    root: &Path,
    account_id: &str,
) -> Result<oleafly_core::ids::ProjectId, String> {
    let binding = crate::project_ids::ensure(local_id, root)?;
    if let Some(cloud) = binding.cloud.get(account_id) {
        return Ok(*cloud);
    }
    crate::project_ids::set_cloud(local_id, account_id, Some(binding.project))?;
    Ok(binding.project)
}

async fn project_views(account_id: &str) -> Vec<CloudProjectView> {
    let state = super::engine::read_state().unwrap_or_default();
    let locals = library_projects();
    let mut views = Vec::new();
    let mut known_cloud: std::collections::BTreeSet<String> = std::collections::BTreeSet::new();
    for project in &locals {
        let binding = crate::project_ids::binding(&project.id).ok().flatten();
        let cloud = binding.as_ref().and_then(|binding| {
            binding
                .cloud
                .get(account_id)
                .copied()
                .or(Some(binding.project))
        });
        let cloud_id = cloud.map(|id| id.to_string()).unwrap_or_default();
        known_cloud.insert(cloud_id.clone());
        let entry = state.projects.get(&project.id);
        views.push(CloudProjectView {
            local_id: Some(project.id.clone()),
            cloud_id,
            name: project.name.clone(),
            mode: if entry.is_some_and(|entry| entry.paused) {
                "pause"
            } else {
                "sync"
            },
            last_synced_ms: entry.map(|entry| entry.last_synced_ms).unwrap_or(0),
        });
    }
    if let Ok(store) = dropbox_store().await {
        if let Ok(remotes) = super::engine::list_remote_projects(&store).await {
            for remote in remotes {
                let cloud_id = remote.cloud.to_string();
                if known_cloud.contains(&cloud_id) {
                    continue;
                }
                views.push(CloudProjectView {
                    local_id: None,
                    cloud_id,
                    name: remote.name,
                    mode: "download",
                    last_synced_ms: remote.stamp_ms,
                });
            }
        }
    }
    views
}

#[tauri::command]
pub async fn cloud_sync_now() -> Result<SyncReport, String> {
    let _gate = sync_gate().lock().await;
    let file =
        read_connection()?.ok_or_else(|| AppError::new("cloud.not_connected").to_string())?;
    let account = file
        .account
        .clone()
        .ok_or_else(|| AppError::new("cloud.not_connected").to_string())?;
    if !account.enabled {
        return Ok(SyncReport {
            projects: Vec::new(),
            last_synced_ms: 0,
        });
    }
    let (context, account_id) = sync_context(&file)?;
    let store = dropbox_store().await?;
    let mut state = super::engine::read_state()?;
    let mut reports = Vec::new();
    for project in library_projects() {
        if state
            .projects
            .get(&project.id)
            .is_some_and(|entry| entry.paused)
        {
            continue;
        }
        let root = match crate::paths::project_dir(&project.id) {
            Ok(root) => root,
            Err(error) => {
                reports.push(SyncProjectReport {
                    local_id: project.id,
                    uploaded: 0,
                    downloaded: 0,
                    deleted_remote: 0,
                    deleted_local: 0,
                    conflicts: 0,
                    error: Some(error),
                });
                continue;
            }
        };
        let report = async {
            let cloud = cloud_id_for(&project.id, &root, &account_id)?;
            super::engine::sync_project_at(&store, &mut state, &context, &project.id, &root, cloud)
                .await
                .map_err(|error| error.to_string())
        }
        .await;
        match report {
            Ok(outcome) => {
                reports.push(SyncProjectReport {
                    local_id: project.id,
                    uploaded: outcome.uploaded,
                    downloaded: outcome.downloaded,
                    deleted_remote: outcome.deleted_remote,
                    deleted_local: outcome.deleted_local,
                    conflicts: outcome.conflicts,
                    error: None,
                });
            }
            Err(error) => reports.push(SyncProjectReport {
                local_id: project.id,
                uploaded: 0,
                downloaded: 0,
                deleted_remote: 0,
                deleted_local: 0,
                conflicts: 0,
                error: Some(error),
            }),
        }
        super::engine::write_state(&state)?;
    }
    Ok(SyncReport {
        projects: reports,
        last_synced_ms: super::engine::now_ms(),
    })
}

#[tauri::command]
pub fn cloud_project_set_mode(local_id: String, mode: String) -> Result<(), String> {
    let mut state = super::engine::read_state()?;
    let entry = state.projects.entry(local_id).or_default();
    entry.paused = match mode.as_str() {
        "sync" => false,
        "pause" => true,
        _ => {
            return Err(AppError::new("cloud.network")
                .detail("unknown sync mode")
                .into())
        }
    };
    super::engine::write_state(&state)
}

#[tauri::command]
pub async fn cloud_download_project(
    cloud_id: String,
    state: tauri::State<'_, crate::state::AppState>,
) -> Result<DownloadDone, String> {
    let _gate = sync_gate().lock().await;
    let cloud = oleafly_core::ids::ProjectId::parse(&cloud_id)
        .map_err(|_| AppError::new("cloud.code_invalid").to_string())?;
    if let Some(local_id) = crate::project_ids::bound_local_id(cloud)? {
        let root = crate::paths::projects_root()?.join(&local_id);
        if root.join("project.json").is_file() {
            return Ok(DownloadDone { local_id });
        }
        let recycled = crate::storage::list_recycled_projects()
            .await
            .unwrap_or_default()
            .into_iter()
            .find(|entry| entry.project_id == local_id);
        if let Some(entry) = recycled {
            let restored = crate::storage::restore_recycled_project(entry.id, state).await?;
            return Ok(DownloadDone { local_id: restored });
        }
        crate::project_ids::forget(&local_id)?;
        let mut engine_state = super::engine::read_state()?;
        engine_state.projects.remove(&local_id);
        super::engine::write_state(&engine_state)?;
    }
    let file =
        read_connection()?.ok_or_else(|| AppError::new("cloud.not_connected").to_string())?;
    let (context, account_id) = sync_context(&file)?;
    let store = dropbox_store().await?;
    let root = crate::paths::projects_root()?;
    let reservation = crate::project::reserve_unique_project_directory_adopting(&root, cloud)?;
    let version = super::engine::download_into(&store, cloud, reservation.path())
        .await
        .map_err(|error| plain_error(error.to_string()))?;
    let Some(version) = version else {
        drop(reservation);
        return Err(AppError::new("cloud.code_invalid").into());
    };
    let local_id = reservation.commit()?;
    crate::project_ids::set_cloud(&local_id, &account_id, Some(cloud))?;
    let mut state = super::engine::read_state()?;
    state.hlc = state.hlc.max(version.stamp.hlc.raw());
    let entry = state.projects.entry(local_id.clone()).or_default();
    entry.cloud = Some(cloud);
    entry.base = version
        .files
        .iter()
        .map(|file| (file.path.clone(), file.hash.clone()))
        .collect();
    entry.base_stamp = version.stamp.hlc.raw();
    entry.last_synced_ms = super::engine::now_ms();
    super::engine::write_state(&state)?;
    let _ = context;
    Ok(DownloadDone { local_id })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsDownloadResult {
    values: Option<serde_json::Value>,
    stamp: u64,
}

#[tauri::command]
pub async fn cloud_settings_download() -> Result<SettingsDownloadResult, String> {
    let store = dropbox_store().await?;
    match super::engine::download_settings(&store)
        .await
        .map_err(|error| plain_error(error.to_string()))?
    {
        Some((values, stamp)) => Ok(SettingsDownloadResult {
            values: Some(values),
            stamp,
        }),
        None => Ok(SettingsDownloadResult {
            values: None,
            stamp: 0,
        }),
    }
}

#[tauri::command]
pub fn cloud_settings_applied(stamp: u64) -> Result<(), String> {
    let mut state = super::engine::read_state()?;
    state.settings_stamp = state.settings_stamp.max(stamp);
    state.hlc = state.hlc.max(stamp);
    super::engine::write_state(&state)
}

#[tauri::command]
pub async fn cloud_settings_sync(values: serde_json::Value) -> Result<SettingsSyncResult, String> {
    let file =
        read_connection()?.ok_or_else(|| AppError::new("cloud.not_connected").to_string())?;
    let (context, _account) = sync_context(&file)?;
    let store = dropbox_store().await?;
    let mut state = super::engine::read_state()?;
    let result = super::engine::sync_settings(&store, &mut state, &context, values)
        .await
        .map_err(|error| plain_error(error.to_string()))?;
    super::engine::write_state(&state)?;
    Ok(SettingsSyncResult {
        applied: match result {
            super::engine::SettingsSync::Applied(values, _) => Some(values),
            _ => None,
        },
    })
}

#[cfg(test)]
mod tests {
    use super::{
        extract_pasted_code, read_connection_at, validate_device_name, write_connection_at,
        ConnectionFile,
    };
    use oleafly_core::ids::DeviceId;

    #[test]
    fn state_views_always_serialize_projects() {
        let view = super::disconnected_view("Desk".into(), None);
        let value = serde_json::to_value(view).unwrap();
        assert_eq!(value["projects"], serde_json::json!([]));
        assert_eq!(value["deviceName"], "Desk");
    }

    #[test]
    fn pasted_codes_accept_bare_codes_and_full_redirect_urls() {
        assert_eq!(extract_pasted_code(" abc123 ", "s1").unwrap(), "abc123");
        assert_eq!(
            extract_pasted_code(
                "http://127.0.0.1:53171/oauth/dropbox?state=s1&code=xyz",
                "s1"
            )
            .unwrap(),
            "xyz"
        );
        assert!(extract_pasted_code(
            "http://127.0.0.1:53171/oauth/dropbox?state=other&code=xyz",
            "s1"
        )
        .is_err());
        assert!(extract_pasted_code("", "s1").is_err());
        assert!(extract_pasted_code("two words", "s1").is_err());
        assert!(extract_pasted_code("https://example.com/?error=access_denied", "s1").is_err());
    }

    #[test]
    fn device_names_follow_the_rules() {
        assert_eq!(
            validate_device_name("  Ada's MacBook Air  ").unwrap(),
            "Ada's MacBook Air"
        );
        assert!(validate_device_name("").is_err());
        assert!(validate_device_name("bad/name").is_err());
        assert!(validate_device_name("bad:name").is_err());
        assert!(validate_device_name(&"x".repeat(33)).is_err());
        assert!(validate_device_name(&"x".repeat(32)).is_ok());
    }

    #[test]
    fn connection_records_round_trip_without_tokens() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("cloud/connection.json");
        let file = ConnectionFile {
            device_id: DeviceId::new(),
            device_name: "Desk".into(),
            last_email: Some("ada@example.org".into()),
            account: None,
        };
        write_connection_at(&path, &file).unwrap();
        let read = read_connection_at(&path).unwrap().unwrap();
        assert_eq!(read.device_id, file.device_id);
        assert_eq!(read.device_name, "Desk");
        assert_eq!(read.last_email.as_deref(), Some("ada@example.org"));
        let text = std::fs::read_to_string(&path).unwrap();
        assert!(!text.contains("refresh"));
        assert!(!text.contains("token"));
    }
}
