use super::engine::{self, RoundEnv, RoundError, RoundOptions, SyncContext, SyncOutcome};
use super::oauth::{
    authorize_url, bind_loopback, dropbox_app_key, redirect_uri, DropboxAuthClient,
    LoopbackListener, LoopbackPages, OAuthError, PkceFlow, TokenSet,
};
use super::settings::{self, SettingsOutcome, SettingsRound};
use super::state::{self, EngineState, Hold, ProjectState};
use super::store::{CloudStore, DropboxStore, StoreError, TokenRefresher, WriteMode};
use crate::app_error::AppError;
use crate::secrets::SecretBackend;
use oleafly_core::ids::{DeviceId, ProjectId};
use serde::{Deserialize, Serialize, Serializer};
use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;

const REFRESH_SECRET_ACCOUNT: &str = "cloud/dropbox/refresh";
const CONNECT_TIMEOUT: Duration = Duration::from_secs(600);
const ROUND_ATTEMPTS: usize = 3;
const MIN_FREE_BYTES: u64 = 1024 * 1024;

#[derive(Clone, Deserialize, Serialize)]
struct ConnectedAccount {
    account_id: String,
    email: String,
    display_name: String,
    backend: SecretBackend,
    enabled: bool,
    #[serde(default)]
    revoked: bool,
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

fn stamp_string<S: Serializer>(stamp: &u64, serializer: S) -> Result<S::Ok, S::Error> {
    serializer.serialize_str(&stamp.to_string())
}

fn parse_stamp(stamp: &str) -> Result<u64, String> {
    stamp.parse::<u64>().map_err(|_| {
        AppError::new("cloud.server")
            .detail("invalid settings stamp")
            .into()
    })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CloudSpaceView {
    used: u64,
    allocated: u64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CloudProjectView {
    local_id: Option<String>,
    cloud_id: String,
    name: String,
    mode: &'static str,
    last_synced_ms: u64,
    size_bytes: u64,
    error: Option<String>,
    conflicts: usize,
    skipped: usize,
    hold: Option<Hold>,
    recycled: bool,
    removed_by: Option<String>,
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
    last_synced_ms: u64,
    last_error: Option<String>,
    quota_full: bool,
    linked_count: usize,
    projects: Vec<CloudProjectView>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CloudDetailsView {
    space: Option<CloudSpaceView>,
    remote: Vec<CloudProjectView>,
    error: Option<String>,
}

fn disconnected_view(device_name: String, last_email: Option<String>) -> CloudStateView {
    CloudStateView {
        status: "disconnected",
        email: None,
        display_name: None,
        device_name,
        enabled: false,
        last_email,
        last_synced_ms: 0,
        last_error: None,
        quota_full: false,
        linked_count: 0,
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

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadDone {
    local_id: String,
    restored: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncProjectReport {
    local_id: String,
    uploaded: usize,
    downloaded: usize,
    deleted_remote: usize,
    deleted_local: usize,
    conflicts: usize,
    skipped: usize,
    held: bool,
    error: Option<String>,
}

impl SyncProjectReport {
    fn from_outcome(local_id: &str, outcome: &SyncOutcome, error: Option<String>) -> Self {
        Self {
            local_id: local_id.to_string(),
            uploaded: outcome.uploaded,
            downloaded: outcome.downloaded,
            deleted_remote: outcome.deleted_remote,
            deleted_local: outcome.deleted_local,
            conflicts: outcome.conflicts,
            skipped: outcome.skipped,
            held: outcome.held,
            error,
        }
    }

    fn failed(local_id: &str, error: String) -> Self {
        Self::from_outcome(local_id, &SyncOutcome::default(), Some(error))
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncReport {
    projects: Vec<SyncProjectReport>,
    last_synced_ms: u64,
    error: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DirtyFile {
    local_id: String,
    path: String,
}

#[derive(Serialize)]
#[serde(tag = "outcome", rename_all = "camelCase")]
pub enum SettingsSyncView {
    Current,
    Pushed,
    Apply {
        values: serde_json::Value,
        #[serde(serialize_with = "stamp_string")]
        stamp: u64,
    },
    Choose {
        values: serde_json::Value,
        #[serde(serialize_with = "stamp_string")]
        stamp: u64,
    },
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsDownloadView {
    values: Option<serde_json::Value>,
    #[serde(serialize_with = "stamp_string")]
    stamp: u64,
}

struct Flow {
    pkce: PkceFlow,
    redirect: Option<String>,
    listener: Option<LoopbackListener>,
    shutdown: Option<Arc<tokio::sync::Notify>>,
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

fn token_cache() -> &'static Mutex<Option<TokenCache>> {
    static CACHE: OnceLock<Mutex<Option<TokenCache>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(None))
}

fn clear_token_cache() {
    *token_cache()
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner) = None;
}

fn refresh_gate() -> &'static tokio::sync::Mutex<()> {
    static GATE: OnceLock<tokio::sync::Mutex<()>> = OnceLock::new();
    GATE.get_or_init(|| tokio::sync::Mutex::new(()))
}

fn sync_gate() -> &'static tokio::sync::Mutex<()> {
    static GATE: OnceLock<tokio::sync::Mutex<()>> = OnceLock::new();
    GATE.get_or_init(|| tokio::sync::Mutex::new(()))
}

fn settings_gate() -> &'static tokio::sync::Mutex<()> {
    static GATE: OnceLock<tokio::sync::Mutex<()>> = OnceLock::new();
    GATE.get_or_init(|| tokio::sync::Mutex::new(()))
}

fn now_ms() -> u64 {
    engine::now_ms()
}

fn app_error(error: &OAuthError) -> String {
    let code = match error.key() {
        "sign_in_cancelled" => "cloud.sign_in_cancelled",
        "sign_in_timeout" => "cloud.sign_in_timeout",
        "code_invalid" => "cloud.code_invalid",
        "revoked" => "cloud.revoked",
        _ => "cloud.network",
    };
    AppError::new(code).into()
}

fn plain_error(message: impl Into<String>) -> String {
    AppError::new("cloud.local_io")
        .detail(message.into())
        .into()
}

fn not_connected() -> String {
    AppError::new("cloud.not_connected").into()
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

fn connection_lock() -> &'static Mutex<()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| Mutex::new(()))
}

fn read_connection() -> Result<Option<ConnectionFile>, String> {
    let _guard = connection_lock()
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    read_connection_at(&connection_path()?)
}

fn update_connection<T>(
    change: impl FnOnce(&mut ConnectionFile) -> Result<T, String>,
) -> Result<T, String> {
    let _guard = connection_lock()
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    let path = connection_path()?;
    let mut file = read_connection_at(&path)?.unwrap_or_else(new_connection);
    let value = change(&mut file)?;
    write_connection_at(&path, &file)?;
    Ok(value)
}

fn new_connection() -> ConnectionFile {
    ConnectionFile {
        device_id: DeviceId::new(),
        device_name: computer_name(),
        last_email: None,
        account: None,
    }
}

fn mark_revoked() {
    clear_token_cache();
    let _ = update_connection(|file| {
        if let Some(account) = file.account.as_mut() {
            account.revoked = true;
        }
        Ok(())
    });
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
    let name = engine::sanitize_label(&name);
    if name.is_empty() || name == "conflict" {
        "This computer".into()
    } else {
        name
    }
}

#[cfg(not(unix))]
fn computer_name() -> String {
    std::env::var("COMPUTERNAME")
        .map(|name| engine::sanitize_label(name.trim()))
        .ok()
        .filter(|name| !name.is_empty() && name != "conflict")
        .unwrap_or_else(|| "This computer".into())
}

fn validate_device_name(name: &str) -> Result<String, String> {
    let name = name.trim();
    if name.is_empty() {
        return Err(AppError::new("cloud.device_name_empty").into());
    }
    if name.chars().count() > 32
        || name.ends_with('.')
        || name.chars().any(|c| {
            c.is_control()
                || oleafly_core::portable::is_ignorable_code_point(c)
                || matches!(c, '\\' | '/' | ':' | '*' | '?' | '"' | '<' | '>' | '|')
        })
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
        if pasted.chars().any(char::is_whitespace) || pasted.contains('/') || pasted.len() > 512 {
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

fn auth_client() -> DropboxAuthClient {
    DropboxAuthClient::new()
}

fn cache_tokens(tokens: &TokenSet) {
    *token_cache()
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner) = Some(TokenCache {
        access_token: tokens.access_token.clone(),
        expires_at_ms: now_ms().saturating_add(tokens.expires_in.saturating_mul(1_000)),
    });
}

async fn finish_connect(tokens: TokenSet) -> Result<ConnectDone, String> {
    let client = auth_client();
    let account = client
        .current_account(&tokens.access_token)
        .await
        .map_err(|error| app_error(&error))?;
    let refresh = tokens
        .refresh_token
        .clone()
        .ok_or_else(|| AppError::new("cloud.code_invalid").to_string())?;
    let previous_backend = read_connection()?
        .and_then(|file| file.account)
        .map(|account| account.backend);
    let choice = crate::secrets::set_cloud_secret(REFRESH_SECRET_ACCOUNT, &refresh)?;
    if let Some(previous) = previous_backend.filter(|previous| *previous != choice.backend) {
        let _ = crate::secrets::delete_cloud_secret(REFRESH_SECRET_ACCOUNT, previous);
    }
    update_connection(|file| {
        file.last_email = Some(account.email.clone());
        file.account = Some(ConnectedAccount {
            account_id: account.account_id.clone(),
            email: account.email.clone(),
            display_name: account.display_name.clone(),
            backend: choice.backend,
            enabled: true,
            revoked: false,
        });
        Ok(())
    })?;
    state::update(|state| state.adopt_account(&account.account_id))?;
    cache_tokens(&tokens);
    Ok(ConnectDone {
        email: account.email,
    })
}

async fn refresh_access_token() -> Result<String, String> {
    let file = read_connection()?.ok_or_else(not_connected)?;
    let account = file.account.ok_or_else(not_connected)?;
    let refresh = crate::secrets::get_cloud_secret(REFRESH_SECRET_ACCOUNT, account.backend)?
        .ok_or_else(|| AppError::new("cloud.revoked").to_string())?;
    let tokens = match auth_client().refresh(dropbox_app_key(), &refresh).await {
        Ok(tokens) => tokens,
        Err(OAuthError::Revoked) => {
            mark_revoked();
            return Err(AppError::new("cloud.revoked").into());
        }
        Err(error) => return Err(app_error(&error)),
    };
    cache_tokens(&tokens);
    Ok(tokens.access_token)
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
    refresh_access_token().await
}

async fn forced_refresh() -> Result<String, StoreError> {
    let _gate = refresh_gate().lock().await;
    clear_token_cache();
    refresh_access_token().await.map_err(|error| {
        if error.contains("cloud.revoked") {
            StoreError::Revoked
        } else {
            StoreError::Network(error)
        }
    })
}

fn refresher() -> TokenRefresher {
    Arc::new(|| Box::pin(forced_refresh()))
}

async fn dropbox_store() -> Result<DropboxStore, String> {
    let token = access_token().await?;
    Ok(DropboxStore::new(token, Some(refresher())))
}

fn connected_account() -> Result<(ConnectionFile, ConnectedAccount), String> {
    let file = read_connection()?.ok_or_else(not_connected)?;
    let account = file.account.clone().ok_or_else(not_connected)?;
    Ok((file, account))
}

fn require_usable() -> Result<(ConnectionFile, ConnectedAccount), String> {
    let (file, account) = connected_account()?;
    if account.revoked {
        return Err(AppError::new("cloud.revoked").into());
    }
    if !account.enabled {
        return Err(AppError::new("cloud.disabled").into());
    }
    Ok((file, account))
}

fn note_error(error: &RoundError) {
    if matches!(error, RoundError::Store(StoreError::Revoked)) {
        mark_revoked();
    }
}

fn cloud_dirs() -> Result<(PathBuf, PathBuf), String> {
    let root = crate::paths::oleafly_root()?.join("cloud");
    Ok((root.join("staging"), root.join("trash")))
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
            .ok_or_else(|| AppError::new("cloud.sign_in_cancelled").to_string())?;
        flow.listener
            .take()
            .ok_or_else(|| AppError::new("cloud.sign_in_cancelled").to_string())?
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
        .ok_or_else(|| AppError::new("cloud.sign_in_cancelled").to_string())?;
    let tokens = auth_client()
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
    let code = match extract_pasted_code(&code, &flow.pkce.state) {
        Ok(code) => code,
        Err(error) => {
            flows()
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .insert(flow_id, flow);
            return Err(app_error(&error));
        }
    };
    let tokens = match auth_client()
        .exchange_code(dropbox_app_key(), &code, flow.pkce.verifier(), None)
        .await
    {
        Ok(tokens) => tokens,
        Err(error) => {
            flows()
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .insert(flow_id, flow);
            return Err(app_error(&error));
        }
    };
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

async fn library_projects() -> Vec<crate::project::ProjectInfo> {
    tauri::async_runtime::spawn_blocking(|| {
        crate::project::list_projects_blocking().unwrap_or_default()
    })
    .await
    .unwrap_or_default()
}

fn split_library(
    projects: Vec<crate::project::ProjectInfo>,
) -> (Vec<crate::project::ProjectInfo>, usize) {
    let mut library = Vec::new();
    let mut linked = 0;
    for project in projects {
        match project.location {
            crate::project_availability::ProjectLocationInfo::Library
                if !project.recovery_pending =>
            {
                library.push(project);
            }
            crate::project_availability::ProjectLocationInfo::Library => {}
            crate::project_availability::ProjectLocationInfo::Linked { .. } => linked += 1,
        }
    }
    (library, linked)
}

fn project_mode(entry: Option<&ProjectState>) -> &'static str {
    match entry {
        Some(entry) if entry.removed_by.is_some() => "removed",
        Some(entry) if entry.paused => "pause",
        Some(entry) if entry.hold.is_some() => "held",
        _ => "sync",
    }
}

fn local_view(
    project: &crate::project::ProjectInfo,
    entry: Option<&ProjectState>,
    cloud: Option<ProjectId>,
) -> CloudProjectView {
    CloudProjectView {
        local_id: Some(project.id.clone()),
        cloud_id: cloud.map(|id| id.to_string()).unwrap_or_default(),
        name: project.name.clone(),
        mode: project_mode(entry),
        last_synced_ms: entry.map_or(0, |entry| entry.last_synced_ms),
        size_bytes: entry.map_or(0, |entry| entry.base.values().map(|base| base.size).sum()),
        error: entry.and_then(|entry| entry.last_error.clone()),
        conflicts: entry.map_or(0, |entry| entry.conflicts),
        skipped: entry.map_or(0, |entry| entry.skipped),
        hold: entry.and_then(|entry| entry.hold),
        recycled: false,
        removed_by: entry.and_then(|entry| entry.removed_by.clone()),
    }
}

#[tauri::command]
pub async fn cloud_state() -> Result<CloudStateView, String> {
    let Some(file) = read_connection()? else {
        return Ok(disconnected_view(computer_name(), None));
    };
    let Some(account) = file.account.clone() else {
        return Ok(disconnected_view(file.device_name, file.last_email));
    };
    let engine_state = state::snapshot().unwrap_or_default();
    let (library, linked_count) = split_library(library_projects().await);
    let bindings = crate::project_ids::all_bindings().unwrap_or_default();
    let projects = library
        .iter()
        .map(|project| {
            let entry = engine_state.projects.get(&project.id);
            let cloud = entry.and_then(|entry| entry.cloud).or_else(|| {
                bindings.get(&project.id).map(|binding| {
                    binding
                        .cloud
                        .get(&account.account_id)
                        .copied()
                        .unwrap_or(binding.project)
                })
            });
            local_view(project, entry, cloud)
        })
        .collect();
    Ok(CloudStateView {
        status: if account.revoked {
            "revoked"
        } else {
            "connected"
        },
        email: Some(account.email),
        display_name: Some(account.display_name),
        device_name: file.device_name,
        enabled: account.enabled,
        last_email: file.last_email,
        last_synced_ms: engine_state.last_synced_ms,
        last_error: engine_state.last_error,
        quota_full: engine_state.quota_full,
        linked_count,
        projects,
    })
}

fn known_cloud_ids(
    engine_state: &EngineState,
    bindings: &BTreeMap<String, crate::project_ids::ProjectBinding>,
    library: &[crate::project::ProjectInfo],
    account_id: &str,
) -> BTreeSet<ProjectId> {
    let mut known: BTreeSet<ProjectId> = BTreeSet::new();
    for project in library {
        if let Some(cloud) = engine_state
            .projects
            .get(&project.id)
            .and_then(|entry| entry.cloud)
        {
            known.insert(cloud);
        }
        if let Some(binding) = bindings.get(&project.id) {
            known.insert(
                binding
                    .cloud
                    .get(account_id)
                    .copied()
                    .unwrap_or(binding.project),
            );
        }
    }
    known
}

#[tauri::command]
pub async fn cloud_details() -> Result<CloudDetailsView, String> {
    let (_, account) = connected_account()?;
    if account.revoked {
        return Ok(CloudDetailsView {
            space: None,
            remote: Vec::new(),
            error: Some(AppError::new("cloud.revoked").into()),
        });
    }
    let mut token = match access_token().await {
        Ok(token) => token,
        Err(error) => {
            return Ok(CloudDetailsView {
                space: None,
                remote: Vec::new(),
                error: Some(error),
            })
        }
    };
    let mut usage = auth_client().space_usage(&token).await;
    if matches!(usage, Err(OAuthError::Revoked)) {
        if let Ok(fresh) = forced_refresh().await {
            usage = auth_client().space_usage(&fresh).await;
            token = fresh;
        }
    }
    let space = usage
        .ok()
        .map(|(used, allocated)| CloudSpaceView { used, allocated });
    let store = DropboxStore::new(token, Some(refresher()));
    let engine_state = state::snapshot().unwrap_or_default();
    let (library, _) = split_library(library_projects().await);
    let bindings = crate::project_ids::all_bindings().unwrap_or_default();
    let known = known_cloud_ids(&engine_state, &bindings, &library, &account.account_id);
    let recycled: BTreeSet<String> = crate::storage::list_recycled_projects()
        .await
        .unwrap_or_default()
        .into_iter()
        .map(|entry| entry.project_id)
        .collect();
    let (remote, error) = match engine::list_remote_projects(&store, &known).await {
        Ok(remote) => (remote, None),
        Err(error) => {
            note_error(&error);
            (Vec::new(), Some(error.to_app_error()))
        }
    };
    let remote = remote
        .into_iter()
        .map(|project| {
            let bound = bindings.iter().find(|(_, binding)| {
                binding.project == project.cloud
                    || binding.cloud.values().any(|cloud| *cloud == project.cloud)
            });
            CloudProjectView {
                local_id: None,
                cloud_id: project.cloud.to_string(),
                name: project.name,
                mode: "download",
                last_synced_ms: project.stamp_ms,
                size_bytes: project.size,
                error: None,
                conflicts: 0,
                skipped: 0,
                hold: None,
                recycled: bound.is_some_and(|(local_id, _)| recycled.contains(local_id)),
                removed_by: None,
            }
        })
        .collect();
    Ok(CloudDetailsView {
        space,
        remote,
        error,
    })
}

#[tauri::command]
pub async fn cloud_disconnect() -> Result<(), String> {
    let _gate = tokio::time::timeout(Duration::from_secs(30), sync_gate().lock())
        .await
        .ok();
    let Some(file) = read_connection()? else {
        return Ok(());
    };
    if let Some(account) = file.account.clone() {
        if !account.revoked {
            if let Ok(token) = access_token().await {
                let _ = auth_client().revoke(&token).await;
            }
        }
        let current = crate::secrets::cloud_secret_backend().backend;
        let _ = crate::secrets::delete_cloud_secret(REFRESH_SECRET_ACCOUNT, account.backend);
        if current != account.backend {
            let _ = crate::secrets::delete_cloud_secret(REFRESH_SECRET_ACCOUNT, current);
        }
    }
    clear_token_cache();
    update_connection(|file| {
        if let Some(account) = file.account.take() {
            file.last_email = Some(account.email);
        }
        Ok(())
    })
}

#[tauri::command]
pub fn cloud_set_enabled(on: bool) -> Result<(), String> {
    update_connection(|file| {
        let account = file.account.as_mut().ok_or_else(not_connected)?;
        account.enabled = on;
        Ok(())
    })
}

#[tauri::command]
pub fn cloud_set_device_name(name: String) -> Result<(), String> {
    let name = validate_device_name(&name)?;
    update_connection(|file| {
        file.device_name = name;
        Ok(())
    })
}

fn cloud_id_for(local_id: &str, root: &Path, account_id: &str) -> Result<ProjectId, String> {
    let binding = crate::project_ids::ensure(local_id, root)?;
    if let Some(cloud) = binding.cloud.get(account_id) {
        return Ok(*cloud);
    }
    crate::project_ids::set_cloud(local_id, account_id, Some(binding.project))?;
    Ok(binding.project)
}

struct ProjectRun {
    outcome: SyncOutcome,
    error: Option<RoundError>,
}

async fn run_project<S: CloudStore>(
    store: &S,
    context: &SyncContext,
    local_id: &str,
    root: PathBuf,
    cloud: ProjectId,
    options: &RoundOptions,
) -> Result<ProjectRun, String> {
    let (staging, trash) = cloud_dirs()?;
    let env = RoundEnv {
        root,
        staging,
        trash,
        lock_id: Some(local_id.to_string()),
    };
    for attempt in 1..=ROUND_ATTEMPTS {
        let snapshot = state::snapshot()?;
        let previous = snapshot.projects.get(local_id).cloned().unwrap_or_default();
        match engine::sync_project(
            store,
            &env,
            context,
            cloud,
            &previous,
            snapshot.hlc,
            options,
        )
        .await
        {
            Ok(result) => {
                let conflict =
                    matches!(result.error, Some(RoundError::Store(StoreError::Conflict)));
                let error_text =
                    result
                        .error
                        .as_ref()
                        .map(RoundError::to_app_error)
                        .or_else(|| {
                            result
                                .outcome
                                .quota_hit
                                .then(|| AppError::new("cloud.quota_full").into())
                        });
                state::update(|state| {
                    state.hlc = state.hlc.max(result.hlc);
                    let entry = state.projects.entry(local_id.to_string()).or_default();
                    let paused = entry.paused || result.project.paused;
                    *entry = ProjectState {
                        paused,
                        last_error: if conflict && attempt < ROUND_ATTEMPTS {
                            None
                        } else {
                            error_text.clone()
                        },
                        ..result.project.clone()
                    };
                })?;
                if conflict && attempt < ROUND_ATTEMPTS {
                    continue;
                }
                if let Some(error) = &result.error {
                    note_error(error);
                }
                return Ok(ProjectRun {
                    outcome: result.outcome,
                    error: result.error,
                });
            }
            Err(error) => {
                note_error(&error);
                let text = error.to_app_error();
                state::update(|state| {
                    let entry = state.projects.entry(local_id.to_string()).or_default();
                    entry.last_error = Some(text.clone());
                    entry.remote_dirty = true;
                })?;
                return Ok(ProjectRun {
                    outcome: SyncOutcome::default(),
                    error: Some(error),
                });
            }
        }
    }
    Ok(ProjectRun {
        outcome: SyncOutcome::default(),
        error: Some(RoundError::Store(StoreError::Conflict)),
    })
}

fn dirty_keys(dirty: Option<Vec<DirtyFile>>) -> BTreeMap<String, BTreeSet<String>> {
    let mut grouped: BTreeMap<String, BTreeSet<String>> = BTreeMap::new();
    for file in dirty.unwrap_or_default().into_iter().take(10_000) {
        let path = file.path.trim_start_matches('/').replace('\\', "/");
        grouped
            .entry(file.local_id)
            .or_default()
            .insert(oleafly_core::portable::fold(&path));
    }
    grouped
}

fn changed_clouds(paths: &[String]) -> BTreeSet<ProjectId> {
    paths
        .iter()
        .filter_map(|path| path.strip_prefix("/projects/"))
        .filter_map(|rest| rest.split('/').next())
        .filter_map(|id| ProjectId::parse(id).ok())
        .collect()
}

async fn mark_remote_changes<S: CloudStore>(
    store: &S,
    cursor: Option<String>,
) -> Result<(), RoundError> {
    let (all, changed, next) = match cursor {
        Some(cursor) => match store.changes(&cursor).await {
            Ok(changes) => (false, changed_clouds(&changes.paths), Some(changes.cursor)),
            Err(StoreError::Reset) => (
                true,
                BTreeSet::new(),
                store.latest_cursor("/projects").await?,
            ),
            Err(error) => return Err(error.into()),
        },
        None => (
            true,
            BTreeSet::new(),
            store.latest_cursor("/projects").await?,
        ),
    };
    state::update(|state| {
        if next.is_some() || all {
            state.cursor = next;
        }
        for project in state.projects.values_mut() {
            if all || project.cloud.is_some_and(|cloud| changed.contains(&cloud)) {
                project.remote_dirty = true;
            }
        }
    })
    .map_err(RoundError::Local)
}

async fn uploads_allowed(quota_full: bool) -> bool {
    if !quota_full {
        return true;
    }
    let Ok(token) = access_token().await else {
        return true;
    };
    match auth_client().space_usage(&token).await {
        Ok((used, allocated)) => allocated == 0 || allocated.saturating_sub(used) > MIN_FREE_BYTES,
        Err(_) => true,
    }
}

#[tauri::command]
pub async fn cloud_sync_now(dirty: Option<Vec<DirtyFile>>) -> Result<SyncReport, String> {
    let _gate = sync_gate().lock().await;
    let (file, account) = require_usable()?;
    state::update(|state| state.adopt_account(&account.account_id))?;
    let store = match dropbox_store().await {
        Ok(store) => store,
        Err(error) => {
            state::update(|state| state.last_error = Some(error.clone()))?;
            return Ok(SyncReport {
                projects: Vec::new(),
                last_synced_ms: 0,
                error: Some(error),
            });
        }
    };
    if let Ok((staging, _)) = cloud_dirs() {
        let _ = tauri::async_runtime::spawn_blocking(move || engine::sweep_staging(&staging)).await;
    }
    let snapshot = state::snapshot()?;
    if let Err(error) = mark_remote_changes(&store, snapshot.cursor.clone()).await {
        if error.ends_round() {
            note_error(&error);
            let text = error.to_app_error();
            state::update(|state| state.last_error = Some(text.clone()))?;
            return Ok(SyncReport {
                projects: Vec::new(),
                last_synced_ms: 0,
                error: Some(text),
            });
        }
        state::update(|state| {
            state.cursor = None;
            for project in state.projects.values_mut() {
                project.remote_dirty = true;
            }
        })?;
    }
    let mut allow_uploads = uploads_allowed(snapshot.quota_full).await;
    let dirty = dirty_keys(dirty);
    let (library, _) = split_library(library_projects().await);
    let mut reports = Vec::new();
    let mut round_error: Option<RoundError> = None;
    let mut quota_hit = !allow_uploads;
    for project in library {
        let current = state::snapshot()?;
        let entry = current
            .projects
            .get(&project.id)
            .cloned()
            .unwrap_or_default();
        if entry.paused || entry.removed_by.is_some() {
            continue;
        }
        let root = match crate::paths::project_dir(&project.id) {
            Ok(root) => root,
            Err(error) => {
                reports.push(SyncProjectReport::failed(&project.id, plain_error(error)));
                continue;
            }
        };
        let cloud = match cloud_id_for(&project.id, &root, &account.account_id) {
            Ok(cloud) => cloud,
            Err(error) => {
                reports.push(SyncProjectReport::failed(&project.id, plain_error(error)));
                continue;
            }
        };
        let context = SyncContext {
            device: file.device_id,
            device_name: file.device_name.clone(),
            fallback_name: project.name.clone(),
        };
        let options = RoundOptions {
            allow_uploads,
            dirty: dirty.get(&project.id).cloned().unwrap_or_default(),
            ..RoundOptions::default()
        };
        let run = run_project(&store, &context, &project.id, root, cloud, &options).await?;
        if run.outcome.quota_hit {
            quota_hit = true;
            allow_uploads = false;
        }
        if run.outcome.unchanged && run.error.is_none() {
            continue;
        }
        let ends = run.error.as_ref().is_some_and(RoundError::ends_round);
        reports.push(SyncProjectReport::from_outcome(
            &project.id,
            &run.outcome,
            run.error.as_ref().map(RoundError::to_app_error),
        ));
        if ends {
            round_error = run.error;
            break;
        }
    }
    let bound = crate::project_ids::all_bindings().ok();
    let finished = now_ms();
    let round_text = round_error
        .as_ref()
        .map(RoundError::to_app_error)
        .or_else(|| quota_hit.then(|| AppError::new("cloud.quota_full").into()));
    state::update(|state| {
        state.quota_full = quota_hit;
        state.last_error = round_text.clone();
        if round_error.is_none() {
            state.last_synced_ms = finished;
        }
        if let Some(bound) = &bound {
            state
                .projects
                .retain(|local_id, _| bound.contains_key(local_id));
        }
    })?;
    Ok(SyncReport {
        projects: reports,
        last_synced_ms: if round_error.is_none() { finished } else { 0 },
        error: round_text,
    })
}

#[tauri::command]
pub async fn cloud_project_set_mode(local_id: String, mode: String) -> Result<(), String> {
    let paused = match mode.as_str() {
        "sync" => false,
        "pause" => true,
        _ => {
            return Err(AppError::new("cloud.server")
                .detail("unknown sync mode")
                .into())
        }
    };
    let removed = state::snapshot()?
        .projects
        .get(&local_id)
        .is_some_and(|entry| entry.removed_by.is_some());
    if !paused && removed {
        let _gate = sync_gate().lock().await;
        let (_, account) = require_usable()?;
        let root = crate::paths::project_dir(&local_id)?;
        let cloud = cloud_id_for(&local_id, &root, &account.account_id)?;
        let store = dropbox_store().await?;
        store
            .delete(&engine::tombstone_remote(cloud))
            .await
            .map_err(|error| error.to_app_error())?;
    }
    state::update(|state| {
        let entry = state.projects.entry(local_id).or_default();
        entry.paused = paused;
        if !paused {
            entry.removed_by = None;
            entry.remote_dirty = true;
            entry.last_error = None;
        }
    })
}

#[tauri::command]
pub async fn cloud_project_resolve_hold(
    local_id: String,
    choice: String,
) -> Result<SyncProjectReport, String> {
    let (allow_mass_delete, restore_deleted) = match choice.as_str() {
        "restore" => (false, true),
        "delete" => (true, false),
        _ => {
            return Err(AppError::new("cloud.server")
                .detail("unknown choice")
                .into())
        }
    };
    let _gate = sync_gate().lock().await;
    let (file, account) = require_usable()?;
    let root = crate::paths::project_dir(&local_id)?;
    let cloud = cloud_id_for(&local_id, &root, &account.account_id)?;
    let store = dropbox_store().await?;
    let context = SyncContext {
        device: file.device_id,
        device_name: file.device_name.clone(),
        fallback_name: local_id.clone(),
    };
    let options = RoundOptions {
        allow_mass_delete,
        restore_deleted,
        allow_uploads: true,
        ..RoundOptions::default()
    };
    let run = run_project(&store, &context, &local_id, root, cloud, &options).await?;
    Ok(SyncProjectReport::from_outcome(
        &local_id,
        &run.outcome,
        run.error.as_ref().map(RoundError::to_app_error),
    ))
}

#[tauri::command]
pub async fn cloud_project_remove(local_id: String) -> Result<(), String> {
    let _gate = sync_gate().lock().await;
    let (file, account) = require_usable()?;
    let root = crate::paths::project_dir(&local_id)?;
    let cloud = cloud_id_for(&local_id, &root, &account.account_id)?;
    let store = dropbox_store().await?;
    let tombstone = engine::Tombstone {
        device: file.device_name.clone(),
        at_ms: now_ms(),
    };
    let bytes = serde_json::to_vec(&tombstone).map_err(|error| plain_error(error.to_string()))?;
    store
        .put(
            &engine::tombstone_remote(cloud),
            bytes,
            WriteMode::Overwrite,
        )
        .await
        .map_err(|error| error.to_app_error())?;
    store
        .delete(&engine::project_remote(cloud))
        .await
        .map_err(|error| error.to_app_error())?;
    state::update(|state| {
        let entry = state.projects.entry(local_id).or_default();
        *entry = ProjectState {
            cloud: Some(cloud),
            paused: true,
            removed_by: Some(file.device_name.clone()),
            remote_dirty: false,
            ..ProjectState::default()
        };
    })
}

fn library_has(local_id: &str) -> bool {
    crate::paths::projects_root()
        .map(|root| root.join(local_id).join("project.json").is_file())
        .unwrap_or(false)
        && crate::project_location::locate(local_id)
            .is_ok_and(|location| location.kind == crate::project_location::ProjectKind::Library)
}

#[tauri::command]
pub async fn cloud_download_project(
    cloud_id: String,
    app_state: tauri::State<'_, crate::state::AppState>,
) -> Result<DownloadDone, String> {
    let _gate = sync_gate().lock().await;
    let (_, account) = require_usable()?;
    let cloud =
        ProjectId::parse(&cloud_id).map_err(|_| AppError::new("cloud.not_found").to_string())?;
    if let Some(local_id) = crate::project_ids::bound_local_id(cloud)? {
        if library_has(&local_id) {
            return Ok(DownloadDone {
                local_id,
                restored: false,
            });
        }
        let recycled = crate::storage::list_recycled_projects()
            .await
            .unwrap_or_default()
            .into_iter()
            .filter(|entry| entry.project_id == local_id)
            .max_by_key(|entry| entry.deleted_at);
        if let Some(entry) = recycled {
            let restored = crate::storage::restore_recycled_project(entry.id, app_state).await?;
            state::update(|state| {
                let project = state.projects.entry(restored.clone()).or_default();
                project.remote_dirty = true;
                project.paused = false;
                project.removed_by = None;
            })?;
            return Ok(DownloadDone {
                local_id: restored,
                restored: true,
            });
        }
        let linked = crate::project_location::locate(&local_id)
            .is_ok_and(|location| location.kind != crate::project_location::ProjectKind::Library);
        if !linked {
            crate::project_ids::forget(&local_id)?;
            state::update(|state| {
                state.projects.remove(&local_id);
            })?;
        }
    }
    let store = dropbox_store().await?;
    let (staging, _) = cloud_dirs()?;
    let projects_root = crate::paths::projects_root()?;
    let reservation =
        crate::project::reserve_unique_project_directory_adopting(&projects_root, cloud)?;
    let downloaded = match engine::download_into(&store, cloud, reservation.path(), &staging).await
    {
        Ok(Some(downloaded)) => downloaded,
        Ok(None) => {
            drop(reservation);
            return Err(AppError::new("cloud.not_found").into());
        }
        Err(error) => {
            drop(reservation);
            note_error(&error);
            let _ = crate::project::append_app_log(format!(
                "cloud download of {cloud} stopped: {error}"
            ));
            return Err(match error {
                RoundError::Store(StoreError::Verify(detail)) => {
                    AppError::new("cloud.download_missing")
                        .detail(detail)
                        .into()
                }
                other => other.to_app_error(),
            });
        }
    };
    let local_id = reservation.commit()?;
    crate::project_ids::set_cloud(&local_id, &account.account_id, Some(cloud))?;
    if let Err(error) = crate::trust::mark_library_restricted(&local_id) {
        let _ = crate::project::append_app_log(format!(
            "could not mark downloaded project {local_id} as restricted: {error}"
        ));
    }
    let meta_base = engine::read_meta_value(&projects_root.join(&local_id))
        .map(|value| super::merge::portable_meta(&value));
    state::update(|state| {
        state.hlc = state.hlc.max(downloaded.version.stamp.hlc.raw());
        let entry = state.projects.entry(local_id.clone()).or_default();
        *entry = ProjectState {
            cloud: Some(cloud),
            base: downloaded.base.clone(),
            meta_base: meta_base.clone(),
            remote_rev: (!downloaded.stale).then(|| downloaded.rev.clone()),
            remote_dirty: downloaded.stale,
            last_synced_ms: now_ms(),
            skipped: downloaded.skipped,
            ..ProjectState::default()
        };
    })?;
    Ok(DownloadDone {
        local_id,
        restored: false,
    })
}

struct SettingsContext {
    store: DropboxStore,
    file: ConnectionFile,
    hlc: u64,
    settings: state::SettingsState,
}

async fn settings_context() -> Result<SettingsContext, String> {
    let (file, account) = require_usable()?;
    state::update(|state| state.adopt_account(&account.account_id))?;
    let store = dropbox_store().await?;
    let snapshot = state::snapshot()?;
    Ok(SettingsContext {
        store,
        file,
        hlc: snapshot.hlc,
        settings: snapshot.settings,
    })
}

fn settings_finish<T>(
    context: &SettingsContext,
    result: Result<T, RoundError>,
) -> Result<T, String> {
    if let Err(error) = &result {
        note_error(error);
    }
    state::update(|state| {
        state.hlc = state.hlc.max(context.hlc);
        state.settings = context.settings.clone();
    })?;
    result.map_err(|error| error.to_app_error())
}

#[tauri::command]
pub async fn cloud_settings_sync(values: serde_json::Value) -> Result<SettingsSyncView, String> {
    let _gate = settings_gate().lock().await;
    let mut context = settings_context().await?;
    let result = settings::sync_settings(
        &context.store,
        SettingsRound {
            device: context.file.device_id,
            device_name: &context.file.device_name,
            hlc: &mut context.hlc,
            state: &mut context.settings,
        },
        values,
    )
    .await;
    Ok(match settings_finish(&context, result)? {
        SettingsOutcome::Current => SettingsSyncView::Current,
        SettingsOutcome::Pushed => SettingsSyncView::Pushed,
        SettingsOutcome::Apply { values, stamp } => SettingsSyncView::Apply { values, stamp },
        SettingsOutcome::Choose { values, stamp } => SettingsSyncView::Choose { values, stamp },
    })
}

#[tauri::command]
pub async fn cloud_settings_download() -> Result<SettingsDownloadView, String> {
    let _gate = settings_gate().lock().await;
    let mut context = settings_context().await?;
    let result = settings::download(&context.store, &mut context.settings).await;
    Ok(match settings_finish(&context, result)? {
        Some((values, stamp)) => SettingsDownloadView {
            values: Some(values),
            stamp,
        },
        None => SettingsDownloadView {
            values: None,
            stamp: 0,
        },
    })
}

#[tauri::command]
pub fn cloud_settings_applied(stamp: String, values: serde_json::Value) -> Result<(), String> {
    let stamp = parse_stamp(&stamp)?;
    state::update(|state| {
        settings::applied(&mut state.settings, stamp, values);
        state.hlc = state.hlc.max(state.settings.stamp);
    })
}

#[tauri::command]
pub async fn cloud_settings_keep_local(values: serde_json::Value) -> Result<(), String> {
    let _gate = settings_gate().lock().await;
    let mut context = settings_context().await?;
    let result = settings::keep_local(
        &context.store,
        SettingsRound {
            device: context.file.device_id,
            device_name: &context.file.device_name,
            hlc: &mut context.hlc,
            state: &mut context.settings,
        },
        values,
    )
    .await;
    settings_finish(&context, result)
}

#[cfg(test)]
mod tests {
    use super::{
        changed_clouds, dirty_keys, extract_pasted_code, read_connection_at, validate_device_name,
        write_connection_at, ConnectionFile, DirtyFile, SettingsSyncView,
    };
    use oleafly_core::ids::{DeviceId, ProjectId};

    #[test]
    fn state_views_always_serialize_projects() {
        let view = super::disconnected_view("Desk".into(), None);
        let value = serde_json::to_value(view).unwrap();
        assert_eq!(value["projects"], serde_json::json!([]));
        assert_eq!(value["deviceName"], "Desk");
        assert_eq!(value["status"], "disconnected");
    }

    #[test]
    fn settings_stamps_travel_as_strings_so_javascript_keeps_every_bit() {
        let stamp = (1_790_000_000_123_u64 << 16) | 7;
        let value = serde_json::to_value(SettingsSyncView::Apply {
            values: serde_json::json!({}),
            stamp,
        })
        .unwrap();
        assert_eq!(value["outcome"], "apply");
        assert_eq!(value["stamp"], stamp.to_string());
        assert_eq!(super::parse_stamp(&stamp.to_string()).unwrap(), stamp);
        assert!(super::parse_stamp("1.5e17").is_err());
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
        assert!(extract_pasted_code(&"x".repeat(600), "s1").is_err());
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
        assert!(validate_device_name("bad\u{0}name").is_err());
        assert!(validate_device_name("tab\tname").is_err());
        assert!(validate_device_name("ends with dot.").is_err());
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

    #[test]
    fn dirty_files_group_by_project_with_folded_paths() {
        let grouped = dirty_keys(Some(vec![
            DirtyFile {
                local_id: "thesis".into(),
                path: "/Chapters/Intro.tex".into(),
            },
            DirtyFile {
                local_id: "thesis".into(),
                path: "main.tex".into(),
            },
        ]));
        assert!(grouped["thesis"].contains("chapters/intro.tex"));
        assert!(grouped["thesis"].contains("main.tex"));
        assert!(dirty_keys(None).is_empty());
    }

    #[test]
    fn change_paths_name_only_valid_project_folders() {
        let cloud = ProjectId::new();
        let changed = changed_clouds(&[
            format!("/projects/{cloud}/version.json"),
            format!("/projects/{cloud}/files/main.tex"),
            "/projects/not-an-id/version.json".into(),
            "/settings/settings.json".into(),
        ]);
        assert_eq!(changed.len(), 1);
        assert!(changed.contains(&cloud));
    }
}
