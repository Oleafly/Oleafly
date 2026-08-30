use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap};
use std::path::PathBuf;
use std::sync::{Mutex, MutexGuard, OnceLock};

use crate::paths;
use crate::secrets;

static CONFIG_WRITE_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

struct ConfigTransactionLock {
    _file: std::fs::File,
    _guard: MutexGuard<'static, ()>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct StoredModel {
    pub id: String,
    pub name: String,
    #[serde(default = "default_true")]
    pub enabled: bool,
    /// "builtin" | "fetched" | "custom"
    #[serde(default)]
    pub source: String,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct CustomProvider {
    pub id: String,
    pub name: String,
    #[serde(rename = "baseURL", default)]
    pub base_url: String,
    #[serde(default)]
    pub key_optional: bool,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct Persona {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub color: String,
    #[serde(default)]
    pub prompt: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
#[serde(tag = "transport", rename_all = "snake_case")]
pub enum McpServerTransport {
    Stdio {
        command: String,
        #[serde(default)]
        args: Vec<String>,
        #[serde(default)]
        env: BTreeMap<String, String>,
    },
    Remote {
        url: String,
        #[serde(default)]
        headers: BTreeMap<String, String>,
    },
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
pub struct McpServerConfig {
    pub name: String,
    #[serde(default = "default_true")]
    pub enabled: bool,
    #[serde(flatten)]
    pub transport: McpServerTransport,
}

fn default_true() -> bool {
    true
}

#[derive(Serialize, Deserialize, Clone)]
pub struct AppConfig {
    #[serde(default)]
    pub github_token: String,
    #[serde(default)]
    pub github_user: String,
    /// Derived, never trusted from disk: whether a token is stored. `get_config`
    /// sets this and blanks `github_token` so the webview learns "connected"
    /// without ever receiving the secret.
    #[serde(default)]
    pub github_connected: bool,
    /// Legacy single AI key (kept for backward compat; `ai_keys` is preferred).
    #[serde(default)]
    pub ai_api_key: String,
    /// Active AI provider id (e.g. "openai", "anthropic", "ollama").
    #[serde(default)]
    pub ai_provider: String,
    /// Active AI model id.
    #[serde(default)]
    pub ai_model: String,
    /// Per-provider credentials: provider id -> API key (or host URL for Ollama).
    #[serde(default)]
    pub ai_keys: HashMap<String, String>,
    /// User-authored extra instructions, sandboxed into the AI system prompt.
    #[serde(default)]
    pub ai_system_prompt: String,
    /// When true, the agent may rasterize compiled PDF pages for vision checks
    /// (`verify_pdf_pages`). Defaults to true; users can disable for privacy.
    #[serde(default = "default_ai_pdf_capture")]
    pub ai_pdf_capture: bool,
    /// Provider id -> per-model enable/source state (seeded from the static catalog).
    #[serde(default)]
    pub ai_provider_models: std::collections::HashMap<String, Vec<StoredModel>>,
    #[serde(default)]
    pub ai_custom_providers: Vec<CustomProvider>,
    #[serde(default)]
    pub ai_personas: Vec<Persona>,
    /// MCP server: expose the in-app agent tools to external MCP clients
    /// (Claude Desktop, Claude Code, Cursor, ...). Off by default.
    #[serde(default)]
    pub mcp_enabled: bool,
    /// Loopback port for the MCP endpoint.
    #[serde(default = "default_mcp_port")]
    pub mcp_port: u16,
    /// When true, mutating tools are removed from the advertised tool list.
    #[serde(default)]
    pub mcp_read_only: bool,
    /// "ask" (confirm every write in-app) or "auto_writes" (writes proceed,
    /// deletes still ask). Deletes always require a click.
    #[serde(default = "default_mcp_approval_policy")]
    pub mcp_approval_policy: String,
    #[serde(default)]
    pub mcp_token: String,
    #[serde(default)]
    pub mcp_servers: Vec<McpServerConfig>,
}

fn default_mcp_port() -> u16 {
    5323
}

fn default_mcp_approval_policy() -> String {
    "ask".into()
}

fn default_ai_pdf_capture() -> bool {
    true
}

impl Default for AppConfig {
    fn default() -> Self {
        // Match serde defaults so `AppConfig::default()` agrees with
        // deserializing `{}` from disk (old configs without mcp_* keys).
        Self {
            github_token: String::new(),
            github_user: String::new(),
            github_connected: false,
            ai_api_key: String::new(),
            ai_provider: String::new(),
            ai_model: String::new(),
            ai_keys: HashMap::new(),
            ai_system_prompt: String::new(),
            ai_pdf_capture: true,
            ai_provider_models: std::collections::HashMap::new(),
            ai_custom_providers: Vec::new(),
            ai_personas: Vec::new(),
            mcp_enabled: false,
            mcp_port: default_mcp_port(),
            mcp_read_only: false,
            mcp_approval_policy: default_mcp_approval_policy(),
            mcp_token: String::new(),
            mcp_servers: Vec::new(),
        }
    }
}

pub fn config_path() -> Result<PathBuf, String> {
    Ok(paths::oleafly_root()?.join("config.json"))
}

pub fn read_config() -> Result<AppConfig, String> {
    let _guard = lock_config_writes()?;
    read_config_unlocked()
}

fn lock_config_writes() -> Result<ConfigTransactionLock, String> {
    let guard = CONFIG_WRITE_LOCK
        .get_or_init(|| Mutex::new(()))
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let root = paths::oleafly_root()?;
    std::fs::create_dir_all(&root)
        .map_err(|error| format!("failed to create config directory: {error}"))?;
    let path = root.join(".config-store.lock");
    if std::fs::symlink_metadata(&path)
        .map(|metadata| metadata.file_type().is_symlink())
        .unwrap_or(false)
    {
        return Err("config transaction lock cannot be a symbolic link".to_string());
    }
    let mut options = std::fs::OpenOptions::new();
    options.read(true).write(true).create(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let file = options
        .open(&path)
        .map_err(|error| format!("failed to open config transaction lock: {error}"))?;
    crate::fsperm::harden_file(&path);
    fs4::FileExt::lock(&file)
        .map_err(|error| format!("failed to lock config transaction: {error}"))?;
    Ok(ConfigTransactionLock {
        _file: file,
        _guard: guard,
    })
}

fn read_config_unlocked() -> Result<AppConfig, String> {
    let p = config_path()?;
    if !p.exists() {
        return hydrate_secrets(AppConfig::default());
    }
    let s = std::fs::read_to_string(&p).map_err(|e| e.to_string())?;
    // A malformed config must NOT silently degrade to an empty AppConfig: a later
    // set_config would then persist the blank over a good GitHub token. Surface
    // the corruption so callers refuse to overwrite.
    let cfg: AppConfig =
        serde_json::from_str(&s).map_err(|e| format!("config.json is corrupt: {e}"))?;
    let needs_migrate = !cfg.github_token.is_empty()
        || !cfg.ai_api_key.is_empty()
        || cfg.ai_keys.values().any(|v| !v.is_empty())
        || !cfg.mcp_token.is_empty()
        || has_plaintext_mcp_server_secrets(&cfg);
    let hydrated = hydrate_secrets(cfg)?;
    if needs_migrate {
        let _ = persist_without_plaintext_secrets_unlocked(&hydrated);
    }
    Ok(hydrated)
}

fn hydrate_secrets(mut cfg: AppConfig) -> Result<AppConfig, String> {
    cfg.github_token = secrets::resolve_secret(secrets::github_token_account(), &cfg.github_token)?;
    cfg.mcp_token = secrets::resolve_secret(secrets::mcp_token_account(), &cfg.mcp_token)?;
    for (provider, value) in secrets::read_ai_secrets()? {
        if provider == "__legacy__" {
            if cfg.ai_api_key.is_empty() {
                cfg.ai_api_key = value;
            }
        } else {
            cfg.ai_keys.insert(provider, value);
        }
    }
    let mcp_secrets = secrets::read_mcp_server_secrets()?;
    for server in &mut cfg.mcp_servers {
        match &mut server.transport {
            McpServerTransport::Stdio { env, .. } => {
                hydrate_mcp_values(&server.name, "env", env, &mcp_secrets)?;
            }
            McpServerTransport::Remote { headers, .. } => {
                hydrate_mcp_values(&server.name, "header", headers, &mcp_secrets)?;
            }
        }
    }
    Ok(cfg)
}

fn mcp_secret_key(server: &str, kind: &str, field: &str) -> String {
    format!("{}:{server}:{kind}:{field}", server.len())
}

fn hydrate_mcp_values(
    server: &str,
    kind: &str,
    values: &mut BTreeMap<String, String>,
    stored: &HashMap<String, String>,
) -> Result<(), String> {
    for (field, value) in values {
        let reference = if value == REDACTED {
            Some(mcp_secret_key(server, kind, field))
        } else if value.starts_with(MCP_SECRET_MARKER_PREFIX) {
            if !is_mcp_secret_reference(value) {
                return Err(mcp_secret_reference_error(server, field, "is invalid"));
            }
            Some(value.clone())
        } else {
            None
        };
        let Some(reference) = reference else {
            continue;
        };
        *value = stored
            .get(&reference)
            .filter(|secret| !secret.is_empty())
            .cloned()
            .ok_or_else(|| mcp_secret_reference_error(server, field, "is missing"))?;
    }
    Ok(())
}

fn mcp_secret_reference_error(server: &str, field: &str, detail: &str) -> String {
    format!(
        "Stored MCP value for server '{server}' field '{field}' {detail}. Re-enter it and try again."
    )
}

fn has_plaintext_mcp_server_secrets(config: &AppConfig) -> bool {
    config.mcp_servers.iter().any(|server| {
        let values = match &server.transport {
            McpServerTransport::Stdio { env, .. } => env,
            McpServerTransport::Remote { headers, .. } => headers,
        };
        values
            .values()
            .any(|value| !value.is_empty() && !is_mcp_secret_marker(value))
    })
}

#[cfg(test)]
pub fn write_config(config: &AppConfig) -> Result<(), String> {
    let _guard = lock_config_writes()?;
    write_config_unlocked(config)
}

fn write_config_unlocked(config: &AppConfig) -> Result<(), String> {
    let p = config_path()?;
    if let Some(parent) = p.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    persist_without_plaintext_secrets_unlocked(config)
}

fn persist_without_plaintext_secrets_unlocked(config: &AppConfig) -> Result<(), String> {
    let existing_mcp_secrets = secrets::read_mcp_server_secrets()?;
    let previous_disk = read_disk_config_unlocked()?;
    let (mut disk, mcp_secrets) =
        prepare_mcp_secret_commit(config, &existing_mcp_secrets, previous_disk.as_ref())?;
    let mut ai_secrets = config.ai_keys.clone();
    if !config.ai_api_key.is_empty() {
        ai_secrets.insert("__legacy__".to_string(), config.ai_api_key.clone());
    }
    secrets::write_ai_secrets(&ai_secrets)?;
    secrets::set_secrets(&[
        (secrets::github_token_account(), &config.github_token),
        (secrets::mcp_token_account(), &config.mcp_token),
    ])?;
    let mut staged_mcp_secrets = mcp_secrets.clone();
    for (reference, secret) in existing_mcp_secrets {
        staged_mcp_secrets.entry(reference).or_insert(secret);
    }
    disk.github_token = String::new();
    disk.mcp_token = String::new();
    disk.ai_keys = HashMap::new();
    disk.ai_api_key = String::new();
    disk.github_connected = false;
    let path = config_path()?;
    commit_mcp_secret_plan(
        &staged_mcp_secrets,
        &mcp_secrets,
        &disk,
        secrets::write_mcp_server_secrets,
        |candidate| write_config_at(&path, candidate),
    )
}

pub fn update_config<F>(update: F) -> Result<(), String>
where
    F: FnOnce(&mut AppConfig) -> Result<(), String>,
{
    let _guard = lock_config_writes()?;
    let mut config = read_config_unlocked()?;
    update(&mut config)?;
    write_config_unlocked(&config)
}

fn read_disk_config_unlocked() -> Result<Option<AppConfig>, String> {
    let path = config_path()?;
    match std::fs::read_to_string(path) {
        Ok(contents) => serde_json::from_str(&contents)
            .map(Some)
            .map_err(|error| format!("config.json is corrupt: {error}")),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error.to_string()),
    }
}

fn prepare_mcp_secret_commit(
    config: &AppConfig,
    existing: &HashMap<String, String>,
    previous_disk: Option<&AppConfig>,
) -> Result<(AppConfig, HashMap<String, String>), String> {
    let mut disk = config.clone();
    let mut collected = HashMap::new();
    for server in &mut disk.mcp_servers {
        let endpoint_unchanged = previous_disk
            .and_then(|previous| {
                previous
                    .mcp_servers
                    .iter()
                    .find(|candidate| candidate.name == server.name)
            })
            .is_some_and(|previous| mcp_server_endpoint_unchanged(server, previous));
        let (kind, values) = match &mut server.transport {
            McpServerTransport::Stdio { env, .. } => ("env", env),
            McpServerTransport::Remote { headers, .. } => ("header", headers),
        };
        for (field, value) in values {
            if value.is_empty() {
                continue;
            }
            let secret = if is_mcp_secret_marker(value) {
                resolve_mcp_secret_marker(
                    &server.name,
                    kind,
                    field,
                    value,
                    existing,
                    previous_disk,
                    endpoint_unchanged,
                )?
            } else {
                value.clone()
            };
            let reference = fresh_mcp_secret_reference(existing, &collected);
            collected.insert(reference.clone(), secret);
            *value = reference;
        }
    }
    Ok((disk, collected))
}

fn resolve_mcp_secret_marker(
    server: &str,
    kind: &str,
    field: &str,
    marker: &str,
    existing: &HashMap<String, String>,
    previous_disk: Option<&AppConfig>,
    endpoint_unchanged: bool,
) -> Result<String, String> {
    if !endpoint_unchanged {
        return Err(
            "Stored values cannot be reused after changing the server endpoint. Re-enter them and try again."
                .to_string(),
        );
    }
    let previous_reference = previous_mcp_secret_marker(previous_disk, server, kind, field);
    let reference = if marker == REDACTED {
        previous_reference.unwrap_or_else(|| REDACTED.to_string())
    } else {
        if previous_reference.as_deref() != Some(marker) {
            return Err(mcp_secret_reference_error(
                server,
                field,
                "is not available for this field",
            ));
        }
        marker.to_string()
    };
    let key = if reference == REDACTED {
        mcp_secret_key(server, kind, field)
    } else if is_mcp_secret_reference(&reference) {
        reference
    } else {
        return Err(mcp_secret_reference_error(server, field, "is invalid"));
    };
    existing
        .get(&key)
        .filter(|secret| !secret.is_empty())
        .cloned()
        .ok_or_else(|| mcp_secret_reference_error(server, field, "is missing"))
}

fn previous_mcp_secret_marker(
    config: Option<&AppConfig>,
    server: &str,
    kind: &str,
    field: &str,
) -> Option<String> {
    let server = config?
        .mcp_servers
        .iter()
        .find(|candidate| candidate.name == server)?;
    let values = match (&server.transport, kind) {
        (McpServerTransport::Stdio { env, .. }, "env") => env,
        (McpServerTransport::Remote { headers, .. }, "header") => headers,
        _ => return None,
    };
    values
        .get(field)
        .filter(|value| is_mcp_secret_marker(value))
        .cloned()
}

fn fresh_mcp_secret_reference(
    existing: &HashMap<String, String>,
    collected: &HashMap<String, String>,
) -> String {
    loop {
        let reference = format!(
            "{MCP_SECRET_REFERENCE_PREFIX}{}",
            secrets::generate_mcp_token()
        );
        if !existing.contains_key(&reference) && !collected.contains_key(&reference) {
            return reference;
        }
    }
}

fn commit_mcp_secret_plan<WriteSecrets, WriteConfig>(
    staged: &HashMap<String, String>,
    active: &HashMap<String, String>,
    disk: &AppConfig,
    mut write_secrets: WriteSecrets,
    write_config: WriteConfig,
) -> Result<(), String>
where
    WriteSecrets: FnMut(&HashMap<String, String>) -> Result<(), String>,
    WriteConfig: FnOnce(&AppConfig) -> Result<(), String>,
{
    write_secrets(staged)?;
    write_config(disk)?;
    let _ = write_secrets(active);
    Ok(())
}

/// Serialize `config` to `path` atomically and (on Unix) with owner-only
/// permissions from the moment the file is created.
fn write_config_at(path: &std::path::Path, config: &AppConfig) -> Result<(), String> {
    let s = serde_json::to_string_pretty(config).map_err(|e| e.to_string())?;
    let dir = path
        .parent()
        .ok_or_else(|| "config path has no parent directory".to_string())?;
    let tmp = dir.join("config.json.tmp");

    let mut opts = std::fs::OpenOptions::new();
    opts.write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        opts.mode(0o600);
    }
    {
        use std::io::Write;
        let mut f = opts
            .open(&tmp)
            .map_err(|e| format!("failed to open config temp file: {e}"))?;
        f.write_all(s.as_bytes())
            .map_err(|e| format!("failed to write config: {e}"))?;
        let _ = f.sync_all();
    }
    crate::fsperm::harden_file(&tmp);

    std::fs::rename(&tmp, path).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        format!("failed to replace config: {e}")
    })
}

pub const REDACTED: &str = "__stored__";
const MCP_SECRET_MARKER_PREFIX: &str = "__stored__:";
const MCP_SECRET_REFERENCE_PREFIX: &str = "__stored__:v1:";

pub fn is_mcp_secret_marker(value: &str) -> bool {
    value == REDACTED || value.starts_with(MCP_SECRET_MARKER_PREFIX)
}

fn is_mcp_secret_reference(value: &str) -> bool {
    value
        .strip_prefix(MCP_SECRET_REFERENCE_PREFIX)
        .is_some_and(|id| {
            id.len() == 64
                && id
                    .bytes()
                    .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
        })
}

#[tauri::command]
pub fn redacted_secret_marker() -> &'static str {
    REDACTED
}

fn is_credential(provider: &str) -> bool {
    provider != "ollama"
}

pub fn redact_ai_secrets(cfg: &mut AppConfig) {
    for (provider, value) in cfg.ai_keys.iter_mut() {
        if !value.is_empty() && is_credential(provider) {
            *value = REDACTED.to_string();
        }
    }
    if !cfg.ai_api_key.is_empty() {
        cfg.ai_api_key = REDACTED.to_string();
    }
}

pub fn redact_mcp_server_secrets(cfg: &mut AppConfig) {
    for server in &mut cfg.mcp_servers {
        let values = match &mut server.transport {
            McpServerTransport::Stdio { env, .. } => env,
            McpServerTransport::Remote { headers, .. } => headers,
        };
        for value in values.values_mut() {
            if !value.is_empty() {
                *value = REDACTED.to_string();
            }
        }
    }
}

pub fn restore_mcp_server_secret_markers(
    config: &mut McpServerConfig,
    stored: &McpServerConfig,
) -> Result<(), String> {
    let endpoint_unchanged = mcp_server_endpoint_unchanged(config, stored);
    let has_marker = match &config.transport {
        McpServerTransport::Stdio { env, .. } => env.values().any(|value| value == REDACTED),
        McpServerTransport::Remote { headers, .. } => {
            headers.values().any(|value| value == REDACTED)
        }
    };
    if has_marker && !endpoint_unchanged {
        return Err(
            "Stored values cannot be reused after changing the server endpoint. Re-enter them and try again."
                .to_string(),
        );
    }
    match (&mut config.transport, &stored.transport) {
        (
            McpServerTransport::Stdio { env, .. },
            McpServerTransport::Stdio {
                env: previous_env, ..
            },
        ) => restore_mcp_values(env, previous_env),
        (
            McpServerTransport::Remote { headers, .. },
            McpServerTransport::Remote {
                headers: previous_headers,
                ..
            },
        ) => restore_mcp_values(headers, previous_headers),
        _ => Ok(()),
    }
}

fn mcp_server_endpoint_unchanged(config: &McpServerConfig, stored: &McpServerConfig) -> bool {
    match (&config.transport, &stored.transport) {
        (
            McpServerTransport::Stdio { command, args, .. },
            McpServerTransport::Stdio {
                command: previous_command,
                args: previous_args,
                ..
            },
        ) => command == previous_command && args == previous_args,
        (
            McpServerTransport::Remote { url, .. },
            McpServerTransport::Remote {
                url: previous_url, ..
            },
        ) => url == previous_url,
        _ => false,
    }
}

fn restore_mcp_values(
    values: &mut BTreeMap<String, String>,
    stored: &BTreeMap<String, String>,
) -> Result<(), String> {
    for (field, value) in values {
        if value != REDACTED {
            continue;
        }
        *value = stored.get(field).cloned().ok_or_else(|| {
            "A stored value is no longer available. Re-enter it and try again.".to_string()
        })?;
    }
    Ok(())
}

fn restore_ai_secrets(config: &mut AppConfig, stored: &AppConfig) {
    let legacy_provider = if stored.ai_provider.is_empty() {
        "openai"
    } else {
        stored.ai_provider.as_str()
    };
    for (provider, value) in config.ai_keys.iter_mut() {
        if value == REDACTED {
            if let Some(previous) = stored.ai_keys.get(provider) {
                *value = previous.clone();
            } else if provider == legacy_provider && !stored.ai_api_key.is_empty() {
                *value = stored.ai_api_key.clone();
            } else {
                value.clear();
            }
        }
    }
    config.ai_keys.retain(|_, value| !value.is_empty());
    if config.ai_api_key == REDACTED {
        config.ai_api_key = stored.ai_api_key.clone();
    }
}

#[tauri::command]
pub fn get_config() -> Result<AppConfig, String> {
    let mut cfg = read_config()?;
    // Never expose the GitHub push token to the webview; report only presence.
    cfg.github_connected = !cfg.github_token.is_empty();
    cfg.github_token = String::new();
    // Same for the MCP bearer token: only `mcp_connection_info` may hand it
    // to the webview (for Settings copy buttons while the server is running).
    cfg.mcp_token = String::new();
    redact_ai_secrets(&mut cfg);
    redact_mcp_server_secrets(&mut cfg);
    Ok(cfg)
}

fn key_unchanged(config: &AppConfig, stored: &AppConfig, id: &str) -> bool {
    config
        .ai_keys
        .get(id)
        .map(|v| stored.ai_keys.get(id).is_some_and(|s| s == v))
        .unwrap_or(false)
}

fn moved_endpoint_ids(config: &AppConfig, stored: &AppConfig) -> Vec<String> {
    stored
        .ai_custom_providers
        .iter()
        .filter(|previous| !previous.base_url.trim().is_empty())
        .filter(|previous| {
            config
                .ai_custom_providers
                .iter()
                .find(|c| c.id == previous.id)
                .is_some_and(|current| current.base_url.trim() != previous.base_url.trim())
        })
        .filter(|previous| key_unchanged(config, stored, &previous.id))
        .map(|previous| previous.id.clone())
        .collect()
}

fn recreated_provider_ids(config: &AppConfig, stored: &AppConfig) -> Vec<String> {
    config
        .ai_custom_providers
        .iter()
        .filter(|current| {
            !stored
                .ai_custom_providers
                .iter()
                .any(|p| p.id == current.id)
                && oleafly_agent::provider::catalog_entry(&current.id).is_none()
                && key_unchanged(config, stored, &current.id)
        })
        .map(|current| current.id.clone())
        .collect()
}

fn orphaned_provider_ids(config: &AppConfig, stored: &AppConfig) -> Vec<String> {
    stored
        .ai_custom_providers
        .iter()
        .filter(|previous| {
            !config
                .ai_custom_providers
                .iter()
                .any(|c| c.id == previous.id)
                && oleafly_agent::provider::catalog_entry(&previous.id).is_none()
        })
        .map(|previous| previous.id.clone())
        .collect()
}

fn drop_keys_for_moved_endpoints(config: &mut AppConfig, stored: &AppConfig) {
    let doomed: Vec<String> = moved_endpoint_ids(config, stored)
        .into_iter()
        .chain(recreated_provider_ids(config, stored))
        .chain(orphaned_provider_ids(config, stored))
        .collect();
    for id in doomed {
        config.ai_keys.remove(&id);
    }
}

#[tauri::command]
pub fn set_config(mut config: AppConfig) -> Result<(), String> {
    let _guard = lock_config_writes()?;
    let stored = read_config_unlocked()?;
    if config.github_token.is_empty() {
        config.github_token = stored.github_token.clone();
    }
    if config.mcp_token.is_empty() {
        config.mcp_token = stored.mcp_token.clone();
    }
    restore_ai_secrets(&mut config, &stored);
    drop_keys_for_moved_endpoints(&mut config, &stored);
    config.mcp_servers = stored.mcp_servers;
    config.github_connected = false;
    write_config_unlocked(&config)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn custom(id: &str, base: &str) -> CustomProvider {
        CustomProvider {
            id: id.into(),
            name: id.into(),
            base_url: base.into(),
            key_optional: false,
        }
    }

    fn with_custom(base: &str, key: &str) -> AppConfig {
        AppConfig {
            ai_custom_providers: vec![custom("mycorp", base)],
            ai_keys: HashMap::from([("mycorp".to_string(), key.to_string())]),
            ..AppConfig::default()
        }
    }

    #[test]
    fn repointing_a_custom_endpoint_drops_the_stored_key() {
        let stored = with_custom("https://api.mycorp.test/v1", "sk-real");
        let mut incoming = with_custom("http://attacker.example", "sk-real");
        drop_keys_for_moved_endpoints(&mut incoming, &stored);
        assert!(
            !incoming.ai_keys.contains_key("mycorp"),
            "a moved endpoint kept the credential it must not reach"
        );
    }

    #[test]
    fn repointing_while_supplying_a_new_key_keeps_that_key() {
        let stored = with_custom("https://api.mycorp.test/v1", "sk-real");
        let mut incoming = with_custom("https://api.mycorp.test/v2", "sk-freshly-typed");
        drop_keys_for_moved_endpoints(&mut incoming, &stored);
        assert_eq!(
            incoming.ai_keys.get("mycorp").map(String::as_str),
            Some("sk-freshly-typed")
        );
    }

    #[test]
    fn leaving_the_endpoint_alone_keeps_the_key() {
        let stored = with_custom("https://api.mycorp.test/v1", "sk-real");
        let mut incoming = with_custom("https://api.mycorp.test/v1", "sk-real");
        drop_keys_for_moved_endpoints(&mut incoming, &stored);
        assert_eq!(
            incoming.ai_keys.get("mycorp").map(String::as_str),
            Some("sk-real")
        );
    }

    #[test]
    fn deleting_a_custom_provider_drops_its_key_too() {
        let stored = with_custom("https://api.mycorp.test/v1", "sk-real");
        let mut incoming = AppConfig {
            ai_keys: HashMap::from([("mycorp".to_string(), "sk-real".to_string())]),
            ..AppConfig::default()
        };
        drop_keys_for_moved_endpoints(&mut incoming, &stored);
        assert!(!incoming.ai_keys.contains_key("mycorp"));
    }

    #[test]
    fn delete_then_recreate_cannot_reattach_a_stored_key_to_a_new_endpoint() {
        let stored = with_custom("https://api.mycorp.test/v1", "sk-real");
        let mut step_one = AppConfig {
            ai_keys: HashMap::from([("mycorp".to_string(), REDACTED.to_string())]),
            ..AppConfig::default()
        };
        restore_ai_secrets(&mut step_one, &stored);
        drop_keys_for_moved_endpoints(&mut step_one, &stored);
        assert!(!step_one.ai_keys.contains_key("mycorp"));

        let stale_stored = with_custom("https://api.mycorp.test/v1", "sk-real");
        let mut step_two = AppConfig {
            ai_custom_providers: vec![custom("mycorp", "http://attacker.example")],
            ai_keys: HashMap::from([("mycorp".to_string(), "sk-real".to_string())]),
            ..AppConfig::default()
        };
        let mut no_provider_stored = stale_stored.clone();
        no_provider_stored.ai_custom_providers.clear();
        drop_keys_for_moved_endpoints(&mut step_two, &no_provider_stored);
        assert!(!step_two.ai_keys.contains_key("mycorp"));
    }

    #[test]
    fn a_custom_entry_shadowing_a_catalog_id_never_drops_the_catalog_key() {
        let stored = AppConfig {
            ai_keys: HashMap::from([("openai".to_string(), "sk-real".to_string())]),
            ..AppConfig::default()
        };
        let mut incoming = AppConfig {
            ai_custom_providers: vec![custom("openai", "http://attacker.example")],
            ai_keys: HashMap::from([("openai".to_string(), "sk-real".to_string())]),
            ..AppConfig::default()
        };
        drop_keys_for_moved_endpoints(&mut incoming, &stored);
        assert_eq!(
            incoming.ai_keys.get("openai").map(String::as_str),
            Some("sk-real")
        );
    }

    #[test]
    fn a_marker_round_trip_through_set_config_cannot_move_the_endpoint() {
        let stored = with_custom("https://api.mycorp.test/v1", "sk-real");
        let mut incoming = with_custom("http://attacker.example", REDACTED);
        restore_ai_secrets(&mut incoming, &stored);
        drop_keys_for_moved_endpoints(&mut incoming, &stored);
        assert!(!incoming.ai_keys.contains_key("mycorp"));
    }

    fn cfg_with_keys() -> AppConfig {
        let mut cfg = AppConfig::default();
        cfg.ai_keys.insert("openai".into(), "sk-real".into());
        cfg.ai_keys.insert("groq".into(), "gsk-real".into());
        cfg.ai_api_key = "sk-legacy".into();
        cfg
    }

    #[test]
    fn a_legacy_marker_migrates_the_single_key_into_the_key_map() {
        let stored = AppConfig {
            ai_provider: "anthropic".into(),
            ai_api_key: "sk-legacy".into(),
            ..AppConfig::default()
        };
        let mut incoming = AppConfig {
            ai_provider: "anthropic".into(),
            ai_api_key: REDACTED.into(),
            ai_keys: HashMap::from([("anthropic".to_string(), REDACTED.to_string())]),
            ..AppConfig::default()
        };
        restore_ai_secrets(&mut incoming, &stored);
        assert_eq!(
            incoming.ai_keys.get("anthropic").map(String::as_str),
            Some("sk-legacy")
        );
    }

    #[test]
    fn a_legacy_marker_defaults_to_openai_when_no_provider_was_saved() {
        let stored = AppConfig {
            ai_api_key: "sk-legacy".into(),
            ..AppConfig::default()
        };
        let mut incoming = AppConfig {
            ai_keys: HashMap::from([("openai".to_string(), REDACTED.to_string())]),
            ..AppConfig::default()
        };
        restore_ai_secrets(&mut incoming, &stored);
        assert_eq!(
            incoming.ai_keys.get("openai").map(String::as_str),
            Some("sk-legacy")
        );
    }

    #[test]
    fn an_unresolvable_marker_is_dropped_not_persisted_as_a_key() {
        let stored = AppConfig::default();
        let mut incoming = AppConfig {
            ai_keys: HashMap::from([("groq".to_string(), REDACTED.to_string())]),
            ..AppConfig::default()
        };
        restore_ai_secrets(&mut incoming, &stored);
        assert!(!incoming.ai_keys.contains_key("groq"));
    }

    struct DataDirGuard;

    impl Drop for DataDirGuard {
        fn drop(&mut self) {
            std::env::remove_var("OLEAFLY_DATA_DIR");
        }
    }

    #[test]
    fn an_existing_install_keeps_working_without_re_entering_a_key() {
        let _env_guard = crate::paths::data_dir_env_lock();
        let dir = temp_dir();
        std::env::set_var("OLEAFLY_DATA_DIR", &dir);
        let _guard = DataDirGuard;

        let before = AppConfig {
            ai_provider: "openai".into(),
            ai_model: "gpt-4o".into(),
            ai_keys: HashMap::from([("openai".into(), "sk-from-an-older-build".into())]),
            ..AppConfig::default()
        };
        write_config(&before).unwrap();

        let hydrated = read_config().unwrap();
        assert_eq!(
            hydrated.ai_keys.get("openai").unwrap(),
            "sk-from-an-older-build"
        );
        assert_eq!(hydrated.ai_provider, "openai");

        let mut visible = hydrated.clone();
        redact_ai_secrets(&mut visible);
        assert_eq!(visible.ai_keys.get("openai").unwrap(), REDACTED);
        assert!(!serde_json::to_string(&visible)
            .unwrap()
            .contains("sk-from-an-older-build"));

        let mut round_trip = visible.clone();
        round_trip.ai_model = "gpt-4o-mini".into();
        restore_ai_secrets(&mut round_trip, &hydrated);
        assert_eq!(
            round_trip.ai_keys.get("openai").unwrap(),
            "sk-from-an-older-build"
        );
    }

    #[test]
    fn redaction_reports_presence_without_the_value() {
        let mut cfg = cfg_with_keys();
        cfg.ai_keys.insert("mistral".into(), String::new());
        redact_ai_secrets(&mut cfg);

        assert_eq!(cfg.ai_keys.get("openai").unwrap(), REDACTED);
        assert_eq!(cfg.ai_keys.get("groq").unwrap(), REDACTED);
        assert_eq!(cfg.ai_api_key, REDACTED);
        assert_eq!(cfg.ai_keys.get("mistral").unwrap(), "");
        assert!(!serde_json::to_string(&cfg).unwrap().contains("sk-real"));
    }

    #[test]
    fn the_ollama_host_is_not_a_secret_and_stays_visible() {
        let mut cfg = AppConfig::default();
        cfg.ai_keys
            .insert("ollama".into(), "http://localhost:11434".into());
        cfg.ai_keys.insert("openai".into(), "sk-real".into());
        redact_ai_secrets(&mut cfg);
        assert_eq!(cfg.ai_keys.get("ollama").unwrap(), "http://localhost:11434");
        assert_eq!(cfg.ai_keys.get("openai").unwrap(), REDACTED);
    }

    #[test]
    fn a_redacted_round_trip_never_overwrites_a_stored_key() {
        let stored = cfg_with_keys();
        let mut incoming = stored.clone();
        redact_ai_secrets(&mut incoming);
        incoming.ai_model = "gpt-4o-mini".into();

        restore_ai_secrets(&mut incoming, &stored);
        assert_eq!(incoming.ai_keys.get("openai").unwrap(), "sk-real");
        assert_eq!(incoming.ai_keys.get("groq").unwrap(), "gsk-real");
        assert_eq!(incoming.ai_api_key, "sk-legacy");
        assert_eq!(incoming.ai_model, "gpt-4o-mini");
    }

    #[test]
    fn a_new_value_replaces_the_stored_one() {
        let stored = cfg_with_keys();
        let mut incoming = stored.clone();
        redact_ai_secrets(&mut incoming);
        incoming.ai_keys.insert("openai".into(), "sk-new".into());

        restore_ai_secrets(&mut incoming, &stored);
        assert_eq!(incoming.ai_keys.get("openai").unwrap(), "sk-new");
    }

    #[test]
    fn a_blank_value_clears_a_stored_credential() {
        let stored = cfg_with_keys();
        let mut incoming = stored.clone();
        redact_ai_secrets(&mut incoming);
        incoming.ai_keys.insert("openai".into(), String::new());

        restore_ai_secrets(&mut incoming, &stored);
        assert!(!incoming.ai_keys.contains_key("openai"));
        assert_eq!(incoming.ai_keys.get("groq").unwrap(), "gsk-real");
    }

    #[test]
    fn dropping_the_entry_is_how_a_credential_is_deleted() {
        let stored = cfg_with_keys();
        let mut incoming = stored.clone();
        redact_ai_secrets(&mut incoming);
        incoming.ai_keys.remove("groq");

        restore_ai_secrets(&mut incoming, &stored);
        assert!(!incoming.ai_keys.contains_key("groq"));
        assert_eq!(incoming.ai_keys.get("openai").unwrap(), "sk-real");
    }

    fn temp_dir() -> std::path::PathBuf {
        use std::sync::atomic::{AtomicU64, Ordering};
        static COUNTER: AtomicU64 = AtomicU64::new(0);
        let n = COUNTER.fetch_add(1, Ordering::Relaxed);
        let d = std::env::temp_dir().join(format!("oleafly-cfg-{}-{n}", std::process::id()));
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    fn wait_for_test_path(path: &std::path::Path, timeout: std::time::Duration) -> bool {
        let deadline = std::time::Instant::now() + timeout;
        while std::time::Instant::now() < deadline {
            if path.exists() {
                return true;
            }
            std::thread::sleep(std::time::Duration::from_millis(10));
        }
        path.exists()
    }

    #[test]
    fn config_transaction_process_worker() {
        let Ok(role) = std::env::var("OLEAFLY_CONFIG_TRANSACTION_ROLE") else {
            return;
        };
        let control = std::path::PathBuf::from(
            std::env::var_os("OLEAFLY_CONFIG_TRANSACTION_CONTROL").unwrap(),
        );
        match role.as_str() {
            "first" => update_config(|config| {
                std::fs::write(control.join("first-entered"), b"")
                    .map_err(|error| error.to_string())?;
                if !wait_for_test_path(
                    &control.join("release-first"),
                    std::time::Duration::from_secs(15),
                ) {
                    return Err("timed out waiting to release the first config writer".to_string());
                }
                config
                    .mcp_servers
                    .push(stdio_server("first-server", "first-secret"));
                Ok(())
            })
            .unwrap(),
            "second" => {
                std::fs::write(control.join("second-started"), b"").unwrap();
                update_config(|config| {
                    std::fs::write(control.join("second-entered"), b"")
                        .map_err(|error| error.to_string())?;
                    config
                        .mcp_servers
                        .push(stdio_server("second-server", "second-secret"));
                    Ok(())
                })
                .unwrap();
            }
            _ => panic!("unknown config transaction worker role"),
        }
    }

    #[test]
    fn config_transaction_lock_serializes_processes_and_secret_commits() {
        let _env_guard = crate::paths::data_dir_env_lock();
        let dir = temp_dir();
        std::env::set_var("OLEAFLY_DATA_DIR", &dir);
        let _guard = DataDirGuard;
        write_config(&AppConfig::default()).unwrap();
        let executable = std::env::current_exe().unwrap();
        let mut first = std::process::Command::new(&executable)
            .arg("--exact")
            .arg("config::tests::config_transaction_process_worker")
            .env("OLEAFLY_CONFIG_TRANSACTION_ROLE", "first")
            .env("OLEAFLY_CONFIG_TRANSACTION_CONTROL", &dir)
            .spawn()
            .unwrap();
        assert!(wait_for_test_path(
            &dir.join("first-entered"),
            std::time::Duration::from_secs(10)
        ));

        let lock_file = std::fs::OpenOptions::new()
            .read(true)
            .write(true)
            .open(dir.join(".config-store.lock"))
            .unwrap();
        assert!(matches!(
            fs4::FileExt::try_lock(&lock_file),
            Err(fs4::TryLockError::WouldBlock)
        ));

        let mut second = std::process::Command::new(&executable)
            .arg("--exact")
            .arg("config::tests::config_transaction_process_worker")
            .env("OLEAFLY_CONFIG_TRANSACTION_ROLE", "second")
            .env("OLEAFLY_CONFIG_TRANSACTION_CONTROL", &dir)
            .spawn()
            .unwrap();
        assert!(wait_for_test_path(
            &dir.join("second-started"),
            std::time::Duration::from_secs(10)
        ));
        let second_entered_early = wait_for_test_path(
            &dir.join("second-entered"),
            std::time::Duration::from_millis(500),
        );

        std::fs::write(dir.join("release-first"), b"").unwrap();
        assert!(first.wait().unwrap().success());
        assert!(second.wait().unwrap().success());

        assert!(!second_entered_early);
        let persisted = read_config().unwrap();
        assert_eq!(
            persisted.mcp_servers,
            vec![
                stdio_server("first-server", "first-secret"),
                stdio_server("second-server", "second-secret"),
            ]
        );
        let stored = secrets::read_mcp_server_secrets().unwrap();
        assert_eq!(stored.len(), 2);
        assert!(stored.values().any(|value| value == "first-secret"));
        assert!(stored.values().any(|value| value == "second-secret"));
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = std::fs::metadata(dir.join(".config-store.lock"))
                .unwrap()
                .permissions()
                .mode()
                & 0o777;
            assert_eq!(mode, 0o600);
        }
        drop(lock_file);
        std::fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn config_transaction_lock_open_failures_are_precise() {
        let _env_guard = crate::paths::data_dir_env_lock();
        let dir = temp_dir();
        std::env::set_var("OLEAFLY_DATA_DIR", &dir);
        let _guard = DataDirGuard;
        std::fs::create_dir(dir.join(".config-store.lock")).unwrap();

        let error = read_config().err().unwrap();

        assert!(error.contains("failed to open config transaction lock"));
        std::fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn write_config_round_trips() {
        let dir = temp_dir();
        let path = dir.join("config.json");
        let cfg = AppConfig {
            github_token: "secret-token".to_string(),
            ai_provider: "anthropic".to_string(),
            ..Default::default()
        };
        write_config_at(&path, &cfg).unwrap();

        let read: AppConfig =
            serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
        assert_eq!(read.github_token, "secret-token");
        assert_eq!(read.ai_provider, "anthropic");
        std::fs::remove_dir_all(&dir).ok();
    }

    #[cfg(unix)]
    #[test]
    fn write_config_is_owner_only() {
        use std::os::unix::fs::PermissionsExt;
        let dir = temp_dir();
        let path = dir.join("config.json");
        write_config_at(&path, &AppConfig::default()).unwrap();
        let mode = std::fs::metadata(&path).unwrap().permissions().mode() & 0o777;
        assert_eq!(
            mode, 0o600,
            "config must be owner-read/write only, got {mode:o}"
        );
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn write_config_overwrites_atomically() {
        let dir = temp_dir();
        let path = dir.join("config.json");
        write_config_at(&path, &AppConfig::default()).unwrap();
        let cfg = AppConfig {
            github_user: "octocat".to_string(),
            ..Default::default()
        };
        write_config_at(&path, &cfg).unwrap();
        let read: AppConfig =
            serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
        assert_eq!(read.github_user, "octocat");
        assert!(!dir.join("config.json.tmp").exists());
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn mcp_defaults_are_safe() {
        let cfg = AppConfig::default();
        assert!(!cfg.mcp_enabled);
        assert_eq!(cfg.mcp_port, 5323);
        assert!(!cfg.mcp_read_only);
        assert_eq!(cfg.mcp_approval_policy, "ask");
        assert!(cfg.mcp_token.is_empty());
    }

    #[test]
    fn mcp_port_default_survives_missing_field() {
        // Old config files on disk have no mcp_* keys; deserialization must
        // produce the safe defaults, not zero.
        let cfg: AppConfig = serde_json::from_str("{}").unwrap();
        assert_eq!(cfg.mcp_port, 5323);
        assert_eq!(cfg.mcp_approval_policy, "ask");
    }

    #[test]
    fn mcp_server_configs_round_trip_stdio_and_remote() {
        let source = serde_json::json!({
            "mcp_servers": [
                {
                    "name": "local-search",
                    "enabled": true,
                    "transport": "stdio",
                    "command": "npx",
                    "args": ["-y", "@example/search"],
                    "env": {"SEARCH_TOKEN": "secret"}
                },
                {
                    "name": "hosted-search",
                    "enabled": false,
                    "transport": "remote",
                    "url": "https://mcp.example.test/mcp",
                    "headers": {"Authorization": "Bearer secret"}
                }
            ]
        });

        let config: AppConfig = serde_json::from_value(source.clone()).unwrap();
        let serialized = serde_json::to_value(config).unwrap();

        assert_eq!(serialized["mcp_servers"], source["mcp_servers"]);
    }

    fn stdio_server(name: &str, secret: &str) -> McpServerConfig {
        McpServerConfig {
            name: name.to_string(),
            enabled: true,
            transport: McpServerTransport::Stdio {
                command: "node".to_string(),
                args: vec!["server.js".to_string()],
                env: BTreeMap::from([("SEARCH_TOKEN".to_string(), secret.to_string())]),
            },
        }
    }

    fn remote_server(name: &str, secret: &str) -> McpServerConfig {
        McpServerConfig {
            name: name.to_string(),
            enabled: true,
            transport: McpServerTransport::Remote {
                url: "https://mcp.example.test/mcp".to_string(),
                headers: BTreeMap::from([("Authorization".to_string(), secret.to_string())]),
            },
        }
    }

    #[test]
    fn mcp_server_credentials_are_encrypted_hydrated_and_redacted() {
        let _env_guard = crate::paths::data_dir_env_lock();
        let dir = temp_dir();
        std::env::set_var("OLEAFLY_DATA_DIR", &dir);
        let _guard = DataDirGuard;
        let config = AppConfig {
            mcp_servers: vec![
                stdio_server("local-search", "stdio-secret"),
                remote_server("hosted-search", "Bearer remote-secret"),
            ],
            ..AppConfig::default()
        };

        write_config(&config).unwrap();

        let config_json = std::fs::read_to_string(dir.join("config.json")).unwrap();
        let secret_json = std::fs::read_to_string(dir.join("mcp-server-secrets.json")).unwrap();
        assert!(!config_json.contains("stdio-secret"));
        assert!(!config_json.contains("remote-secret"));
        let disk: AppConfig = serde_json::from_str(&config_json).unwrap();
        let stdio_reference = match &disk.mcp_servers[0].transport {
            McpServerTransport::Stdio { env, .. } => env.get("SEARCH_TOKEN").unwrap(),
            McpServerTransport::Remote { .. } => unreachable!(),
        };
        let remote_reference = match &disk.mcp_servers[1].transport {
            McpServerTransport::Remote { headers, .. } => headers.get("Authorization").unwrap(),
            McpServerTransport::Stdio { .. } => unreachable!(),
        };
        assert!(is_mcp_secret_reference(stdio_reference));
        assert!(is_mcp_secret_reference(remote_reference));
        assert_ne!(stdio_reference, remote_reference);
        assert!(!secret_json.contains("stdio-secret"));
        assert!(!secret_json.contains("remote-secret"));

        let hydrated = read_config().unwrap();
        let serialized = serde_json::to_string(&hydrated).unwrap();
        assert!(serialized.contains("stdio-secret"));
        assert!(serialized.contains("Bearer remote-secret"));

        let visible = get_config().unwrap();
        let serialized = serde_json::to_string(&visible).unwrap();
        assert!(!serialized.contains("stdio-secret"));
        assert!(!serialized.contains("remote-secret"));
        assert_eq!(
            match &visible.mcp_servers[0].transport {
                McpServerTransport::Stdio { env, .. } => env.get("SEARCH_TOKEN"),
                McpServerTransport::Remote { .. } => None,
            }
            .map(String::as_str),
            Some(REDACTED)
        );
        assert_eq!(
            match &visible.mcp_servers[1].transport {
                McpServerTransport::Remote { headers, .. } => headers.get("Authorization"),
                McpServerTransport::Stdio { .. } => None,
            }
            .map(String::as_str),
            Some(REDACTED)
        );
        std::fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn mcp_secret_markers_cover_legacy_and_versioned_references() {
        let reference = format!("{MCP_SECRET_REFERENCE_PREFIX}{}", "a".repeat(64));

        assert!(is_mcp_secret_marker(REDACTED));
        assert!(is_mcp_secret_marker(&reference));
        assert!(is_mcp_secret_reference(&reference));
        assert!(is_mcp_secret_marker("__stored__:future:value"));
        assert!(!is_mcp_secret_reference("__stored__:future:value"));
        assert!(!is_mcp_secret_marker("plain-secret"));
    }

    #[test]
    fn missing_mcp_secret_reference_fails_with_recovery_guidance() {
        let _env_guard = crate::paths::data_dir_env_lock();
        let dir = temp_dir();
        std::env::set_var("OLEAFLY_DATA_DIR", &dir);
        let _guard = DataDirGuard;
        let reference = format!("{MCP_SECRET_REFERENCE_PREFIX}{}", "a".repeat(64));
        let config = AppConfig {
            mcp_servers: vec![stdio_server("local-search", &reference)],
            ..AppConfig::default()
        };
        write_config_at(&dir.join("config.json"), &config).unwrap();

        let error = read_config().err().unwrap();

        assert!(error.contains("server 'local-search'"));
        assert!(error.contains("field 'SEARCH_TOKEN'"));
        assert!(error.contains("is missing"));
        assert!(error.contains("Re-enter it"));
        std::fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn invalid_mcp_secret_reference_fails_with_recovery_guidance() {
        let _env_guard = crate::paths::data_dir_env_lock();
        let dir = temp_dir();
        std::env::set_var("OLEAFLY_DATA_DIR", &dir);
        let _guard = DataDirGuard;
        let config = AppConfig {
            mcp_servers: vec![stdio_server(
                "local-search",
                "__stored__:future:unknown-reference",
            )],
            ..AppConfig::default()
        };
        write_config_at(&dir.join("config.json"), &config).unwrap();

        let error = read_config().err().unwrap();

        assert!(error.contains("server 'local-search'"));
        assert!(error.contains("field 'SEARCH_TOKEN'"));
        assert!(error.contains("is invalid"));
        assert!(error.contains("Re-enter it"));
        std::fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn legacy_exact_mcp_secret_markers_still_hydrate() {
        let _env_guard = crate::paths::data_dir_env_lock();
        let dir = temp_dir();
        std::env::set_var("OLEAFLY_DATA_DIR", &dir);
        let _guard = DataDirGuard;
        let config = AppConfig {
            mcp_servers: vec![stdio_server("local-search", REDACTED)],
            ..AppConfig::default()
        };
        write_config_at(&dir.join("config.json"), &config).unwrap();
        secrets::write_mcp_server_secrets(&HashMap::from([(
            mcp_secret_key("local-search", "env", "SEARCH_TOKEN"),
            "legacy-secret".to_string(),
        )]))
        .unwrap();

        let hydrated = read_config().unwrap();

        assert_eq!(
            hydrated.mcp_servers,
            vec![stdio_server("local-search", "legacy-secret")]
        );

        write_config(&hydrated).unwrap();

        let migrated: AppConfig =
            serde_json::from_str(&std::fs::read_to_string(dir.join("config.json")).unwrap())
                .unwrap();
        let reference = match &migrated.mcp_servers[0].transport {
            McpServerTransport::Stdio { env, .. } => env.get("SEARCH_TOKEN").unwrap(),
            McpServerTransport::Remote { .. } => unreachable!(),
        };
        assert!(is_mcp_secret_reference(reference));
        assert!(!secrets::read_mcp_server_secrets()
            .unwrap()
            .contains_key(&mcp_secret_key("local-search", "env", "SEARCH_TOKEN")));
        std::fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn generic_settings_updates_preserve_dedicated_mcp_servers() {
        let _env_guard = crate::paths::data_dir_env_lock();
        let dir = temp_dir();
        std::env::set_var("OLEAFLY_DATA_DIR", &dir);
        let _guard = DataDirGuard;
        let stored = AppConfig {
            mcp_servers: vec![stdio_server("local-search", "stdio-secret")],
            ..AppConfig::default()
        };
        write_config(&stored).unwrap();
        let mut incoming = get_config().unwrap();
        incoming.github_user = "octocat".to_string();
        incoming.mcp_servers.clear();

        set_config(incoming).unwrap();

        let persisted = read_config().unwrap();
        assert_eq!(persisted.github_user, "octocat");
        assert_eq!(persisted.mcp_servers, stored.mcp_servers);
        std::fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn mcp_server_updates_preserve_settings_newer_than_their_snapshot() {
        let _env_guard = crate::paths::data_dir_env_lock();
        let dir = temp_dir();
        std::env::set_var("OLEAFLY_DATA_DIR", &dir);
        let _guard = DataDirGuard;
        let initial = AppConfig {
            github_user: "before".to_string(),
            mcp_servers: vec![stdio_server("local-search", "stdio-secret")],
            ..AppConfig::default()
        };
        write_config(&initial).unwrap();
        let mut stale = read_config().unwrap();
        let mut current = initial;
        current.github_user = "current".to_string();
        write_config(&current).unwrap();
        stale.mcp_servers = vec![remote_server("hosted-search", "Bearer remote-secret")];

        update_config(|config| {
            config.mcp_servers = stale.mcp_servers.clone();
            Ok(())
        })
        .unwrap();

        let persisted = read_config().unwrap();
        assert_eq!(persisted.github_user, "current");
        assert_eq!(persisted.mcp_servers, stale.mcp_servers);
        std::fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn config_updates_preserve_unrelated_mcp_servers() {
        let _env_guard = crate::paths::data_dir_env_lock();
        let dir = temp_dir();
        std::env::set_var("OLEAFLY_DATA_DIR", &dir);
        let _guard = DataDirGuard;
        let initial = AppConfig {
            github_user: "before".to_string(),
            mcp_servers: vec![stdio_server("local-search", "stdio-secret")],
            ..AppConfig::default()
        };
        write_config(&initial).unwrap();

        update_config(|config| {
            config.github_user = "after".to_string();
            Ok(())
        })
        .unwrap();

        let persisted = read_config().unwrap();
        assert_eq!(persisted.github_user, "after");
        assert_eq!(persisted.mcp_servers, initial.mcp_servers);
        std::fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn removing_a_server_removes_its_encrypted_values() {
        let _env_guard = crate::paths::data_dir_env_lock();
        let dir = temp_dir();
        std::env::set_var("OLEAFLY_DATA_DIR", &dir);
        let _guard = DataDirGuard;
        let with_server = AppConfig {
            mcp_servers: vec![stdio_server("local-search", "stdio-secret")],
            ..AppConfig::default()
        };
        write_config(&with_server).unwrap();

        write_config(&AppConfig::default()).unwrap();

        assert!(secrets::read_mcp_server_secrets().unwrap().is_empty());
        assert!(read_config().unwrap().mcp_servers.is_empty());
        std::fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn failed_config_replace_keeps_the_previous_mcp_secret_hydratable() {
        let _env_guard = crate::paths::data_dir_env_lock();
        let dir = temp_dir();
        std::env::set_var("OLEAFLY_DATA_DIR", &dir);
        let _guard = DataDirGuard;
        let previous = AppConfig {
            mcp_servers: vec![stdio_server("local-search", "old-secret")],
            ..AppConfig::default()
        };
        write_config(&previous).unwrap();
        std::fs::create_dir(dir.join("config.json.tmp")).unwrap();
        let replacement = AppConfig {
            mcp_servers: vec![stdio_server("local-search", "new-secret")],
            ..AppConfig::default()
        };

        let result = write_config(&replacement);

        assert!(result.is_err());
        let staged = secrets::read_mcp_server_secrets().unwrap();
        assert!(staged.values().any(|value| value == "old-secret"));
        assert!(staged.values().any(|value| value == "new-secret"));
        std::fs::remove_dir(dir.join("config.json.tmp")).unwrap();
        assert_eq!(read_config().unwrap().mcp_servers, previous.mcp_servers);
        std::fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn changing_an_mcp_endpoint_never_reattaches_its_old_credential() {
        let _env_guard = crate::paths::data_dir_env_lock();
        let dir = temp_dir();
        std::env::set_var("OLEAFLY_DATA_DIR", &dir);
        let _guard = DataDirGuard;
        let previous = AppConfig {
            mcp_servers: vec![remote_server("hosted-search", "Bearer old-secret")],
            ..AppConfig::default()
        };
        write_config(&previous).unwrap();
        let mut replacement = AppConfig {
            mcp_servers: vec![remote_server("hosted-search", "Bearer new-secret")],
            ..AppConfig::default()
        };
        let McpServerTransport::Remote { url, .. } = &mut replacement.mcp_servers[0].transport
        else {
            unreachable!();
        };
        *url = "https://new.example.test/mcp".to_string();

        write_config(&replacement).unwrap();

        assert_eq!(read_config().unwrap().mcp_servers, replacement.mcp_servers);
        let stored = secrets::read_mcp_server_secrets().unwrap();
        assert!(stored.values().any(|value| value == "Bearer new-secret"));
        assert!(!stored.values().any(|value| value == "Bearer old-secret"));
        std::fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn changing_an_mcp_endpoint_cannot_reuse_a_visible_marker() {
        let _env_guard = crate::paths::data_dir_env_lock();
        let dir = temp_dir();
        std::env::set_var("OLEAFLY_DATA_DIR", &dir);
        let _guard = DataDirGuard;
        let previous = AppConfig {
            mcp_servers: vec![remote_server("hosted-search", "Bearer old-secret")],
            ..AppConfig::default()
        };
        write_config(&previous).unwrap();
        let mut replacement = get_config().unwrap();
        let McpServerTransport::Remote { url, .. } = &mut replacement.mcp_servers[0].transport
        else {
            unreachable!();
        };
        *url = "https://new.example.test/mcp".to_string();

        let error = write_config(&replacement).unwrap_err();

        assert!(error.contains("cannot be reused"));
        assert!(error.contains("Re-enter them"));
        assert_eq!(read_config().unwrap().mcp_servers, previous.mcp_servers);
        std::fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn an_mcp_secret_reference_cannot_be_rebound_to_another_field() {
        let _env_guard = crate::paths::data_dir_env_lock();
        let dir = temp_dir();
        std::env::set_var("OLEAFLY_DATA_DIR", &dir);
        let _guard = DataDirGuard;
        let previous = AppConfig {
            mcp_servers: vec![stdio_server("local-search", "old-secret")],
            ..AppConfig::default()
        };
        write_config(&previous).unwrap();
        let disk: AppConfig =
            serde_json::from_str(&std::fs::read_to_string(dir.join("config.json")).unwrap())
                .unwrap();
        let reference = match &disk.mcp_servers[0].transport {
            McpServerTransport::Stdio { env, .. } => env.get("SEARCH_TOKEN").unwrap().clone(),
            McpServerTransport::Remote { .. } => unreachable!(),
        };
        let mut attack = read_config().unwrap();
        let McpServerTransport::Stdio { env, .. } = &mut attack.mcp_servers[0].transport else {
            unreachable!();
        };
        env.insert("OTHER_TOKEN".to_string(), reference);

        let error = write_config(&attack).unwrap_err();

        assert!(error.contains("field 'OTHER_TOKEN'"));
        assert!(error.contains("not available for this field"));
        assert_eq!(read_config().unwrap().mcp_servers, previous.mcp_servers);
        std::fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn failed_post_commit_prune_keeps_the_new_config_hydratable() {
        let _env_guard = crate::paths::data_dir_env_lock();
        let dir = temp_dir();
        std::env::set_var("OLEAFLY_DATA_DIR", &dir);
        let _guard = DataDirGuard;
        let previous = AppConfig {
            mcp_servers: vec![remote_server("hosted-search", "Bearer old-secret")],
            ..AppConfig::default()
        };
        write_config(&previous).unwrap();
        let mut replacement = AppConfig {
            mcp_servers: vec![remote_server("hosted-search", "Bearer new-secret")],
            ..AppConfig::default()
        };
        let McpServerTransport::Remote { url, .. } = &mut replacement.mcp_servers[0].transport
        else {
            unreachable!();
        };
        *url = "https://new.example.test/mcp".to_string();
        let existing = secrets::read_mcp_server_secrets().unwrap();
        let previous_disk = read_disk_config_unlocked().unwrap();
        let (disk, active) =
            prepare_mcp_secret_commit(&replacement, &existing, previous_disk.as_ref()).unwrap();
        let mut staged = active.clone();
        for (reference, secret) in existing {
            staged.entry(reference).or_insert(secret);
        }
        let mut writes = 0;
        let path = dir.join("config.json");

        let result = commit_mcp_secret_plan(
            &staged,
            &active,
            &disk,
            |values| {
                writes += 1;
                if writes == 2 {
                    Err("injected prune failure".to_string())
                } else {
                    secrets::write_mcp_server_secrets(values)
                }
            },
            |candidate| write_config_at(&path, candidate),
        );

        assert!(result.is_ok());
        assert_eq!(writes, 2);
        assert_eq!(read_config().unwrap().mcp_servers, replacement.mcp_servers);
        let staged = secrets::read_mcp_server_secrets().unwrap();
        assert!(staged.values().any(|value| value == "Bearer old-secret"));
        assert!(staged.values().any(|value| value == "Bearer new-secret"));

        write_config(&replacement).unwrap();

        let pruned = secrets::read_mcp_server_secrets().unwrap();
        assert_eq!(pruned.len(), 1);
        assert!(pruned.values().any(|value| value == "Bearer new-secret"));
        std::fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn legacy_plaintext_mcp_values_are_migrated_on_read() {
        let _env_guard = crate::paths::data_dir_env_lock();
        let dir = temp_dir();
        std::env::set_var("OLEAFLY_DATA_DIR", &dir);
        let _guard = DataDirGuard;
        let legacy = AppConfig {
            mcp_servers: vec![remote_server("hosted-search", "Bearer legacy-secret")],
            ..AppConfig::default()
        };
        write_config_at(&dir.join("config.json"), &legacy).unwrap();

        let hydrated = read_config().unwrap();

        assert_eq!(hydrated.mcp_servers, legacy.mcp_servers);
        let migrated = std::fs::read_to_string(dir.join("config.json")).unwrap();
        assert!(!migrated.contains("legacy-secret"));
        assert!(migrated.contains(REDACTED));
        assert_eq!(read_config().unwrap().mcp_servers, legacy.mcp_servers);
        std::fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn legacy_plaintext_mcp_value_replaces_an_older_encrypted_value() {
        let _env_guard = crate::paths::data_dir_env_lock();
        let dir = temp_dir();
        std::env::set_var("OLEAFLY_DATA_DIR", &dir);
        let _guard = DataDirGuard;
        let previous = AppConfig {
            mcp_servers: vec![stdio_server("local-search", "old-secret")],
            ..AppConfig::default()
        };
        write_config(&previous).unwrap();
        let replacement = AppConfig {
            mcp_servers: vec![stdio_server("local-search", "new-secret")],
            ..AppConfig::default()
        };
        write_config_at(&dir.join("config.json"), &replacement).unwrap();

        let hydrated = read_config().unwrap();

        assert_eq!(hydrated.mcp_servers, replacement.mcp_servers);
        assert_eq!(read_config().unwrap().mcp_servers, replacement.mcp_servers);
        std::fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn writing_redacted_values_retains_their_encrypted_values() {
        let _env_guard = crate::paths::data_dir_env_lock();
        let dir = temp_dir();
        std::env::set_var("OLEAFLY_DATA_DIR", &dir);
        let _guard = DataDirGuard;
        let stored = AppConfig {
            mcp_servers: vec![stdio_server("local-search", "stdio-secret")],
            ..AppConfig::default()
        };
        write_config(&stored).unwrap();
        let mut visible = get_config().unwrap();
        visible.mcp_servers[0].enabled = false;

        write_config(&visible).unwrap();

        let persisted = read_config().unwrap();
        assert!(!persisted.mcp_servers[0].enabled);
        assert_eq!(
            match &persisted.mcp_servers[0].transport {
                McpServerTransport::Stdio { env, .. } => env.get("SEARCH_TOKEN"),
                McpServerTransport::Remote { .. } => None,
            }
            .map(String::as_str),
            Some("stdio-secret")
        );
        std::fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn unchanged_mcp_endpoint_can_restore_redacted_values() {
        let stored = stdio_server("local-search", "stdio-secret");
        let mut incoming = stdio_server("local-search", REDACTED);

        restore_mcp_server_secret_markers(&mut incoming, &stored).unwrap();

        assert_eq!(incoming, stored);
    }

    #[test]
    fn changed_mcp_endpoint_cannot_reuse_redacted_values() {
        let stored = remote_server("hosted-search", "Bearer remote-secret");
        let mut incoming = remote_server("hosted-search", REDACTED);
        let McpServerTransport::Remote { url, .. } = &mut incoming.transport else {
            unreachable!();
        };
        *url = "https://other.example.test/mcp".to_string();

        let error = restore_mcp_server_secret_markers(&mut incoming, &stored).unwrap_err();

        assert!(error.to_ascii_lowercase().contains("re-enter"));
    }
}
