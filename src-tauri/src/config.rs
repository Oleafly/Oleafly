use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap};
use std::path::PathBuf;
use std::sync::{Mutex, MutexGuard, OnceLock};

use crate::paths;
use crate::secrets;
use oleafly_core::locking::{lock_file, lock_mutex, STORAGE_LOCK_TIMEOUT};

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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub trust: Option<String>,
    #[serde(
        default,
        rename = "blockedReason",
        skip_serializing_if = "Option::is_none"
    )]
    pub blocked_reason: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub metadata: Option<serde_json::Value>,
}

#[derive(Debug, Serialize, Deserialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ProbeVerdict {
    Verified,
    Blocked,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ModelProbe {
    pub verdict: ProbeVerdict,
    pub reason: String,
    pub probed_at: u64,
}

pub fn model_probe_key(provider_id: &str, model_id: &str) -> String {
    format!("{provider_id}/{model_id}")
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(from = "RawCustomProvider")]
pub struct CustomProvider {
    pub id: String,
    pub name: String,
    #[serde(rename = "baseURL", default)]
    pub base_url: String,
    #[serde(rename = "keyOptional")]
    pub key_optional: bool,
}

/// A custom provider as it arrives. The webview and the saved file say
/// `keyOptional`. Earlier builds wrote `key_optional`, and an object the
/// webview spread from one of those can carry both spellings, which one serde
/// field would reject as a duplicate. They are read apart and joined.
#[derive(Deserialize)]
struct RawCustomProvider {
    id: String,
    name: String,
    #[serde(rename = "baseURL", default)]
    base_url: String,
    #[serde(rename = "keyOptional", default)]
    key_optional: bool,
    #[serde(rename = "key_optional", default)]
    legacy_key_optional: bool,
}

impl From<RawCustomProvider> for CustomProvider {
    fn from(raw: RawCustomProvider) -> Self {
        Self {
            id: raw.id,
            name: raw.name,
            base_url: raw.base_url,
            key_optional: raw.key_optional || raw.legacy_key_optional,
        }
    }
}

// 0.4.8 H: Tools model
/// The provider and model the Tools converters and the editor's
/// Image to LaTeX/Typst send images to.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct ToolsModelChoice {
    pub provider: String,
    pub model: String,
}

const MAX_TOOLS_PROVIDER_CHARS: usize = 128;
const MAX_TOOLS_MODEL_CHARS: usize = 512;

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
    /// Ask thinking models for readable summaries of their reasoning.
    #[serde(default)]
    pub ai_reasoning_summaries: bool,
    /// Provider id -> per-model enable/source state (seeded from the static catalog).
    #[serde(default)]
    pub ai_provider_models: std::collections::HashMap<String, Vec<StoredModel>>,
    #[serde(default)]
    pub ai_custom_providers: Vec<CustomProvider>,
    // 0.4.8 H: Tools model
    /// The model the Tools converters and the editor's Image to LaTeX use.
    /// `None` = automatic local (Ollama). Written only by `set_ai_tools_model`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ai_tools_model: Option<ToolsModelChoice>,
    #[serde(default)]
    pub ai_model_probes: BTreeMap<String, ModelProbe>,
    #[serde(default)]
    pub ai_model_lists_refreshed_at: BTreeMap<String, u64>,
    #[serde(default)]
    pub ai_personas: Vec<Persona>,
    #[serde(default)]
    pub ai_starter_personas_seeded: bool,
    #[serde(default = "default_true")]
    pub checkpoints_enabled: bool,
    #[serde(default = "default_true")]
    pub checkpoint_notifications: bool,
    #[serde(default = "default_true")]
    pub git_auto_init: bool,
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
    #[serde(default = "default_true")]
    pub skills_share_with_agents: bool,
    #[serde(default = "default_ui_locale")]
    pub ui_locale: String,
    /// Bumped by `oleafly config set --global` each time it changes one of
    /// the settings the app also saves. A save from a copy read before that
    /// keeps those settings as the CLI left them.
    #[serde(default)]
    pub cli_settings_revision: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub typst_default_version: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub latex_default_engine: Option<String>,
    // 0.4.8 E: research task defaults
    /// Keep the computer awake while a research task or run is active.
    #[serde(default = "default_true")]
    pub research_keep_awake: bool,
    /// Notify when a task needs the user and no Oleafly window is focused.
    #[serde(default = "default_true")]
    pub research_notifications: bool,
    /// New tasks start with network access for their commands.
    #[serde(default)]
    pub research_command_network: bool,
    /// The time budget new tasks start with, in minutes.
    #[serde(default = "default_research_minutes")]
    pub research_time_budget_minutes: u32,
    /// Names of MCP servers research tasks may use (each call is approved).
    #[serde(default)]
    pub research_task_mcp_servers: Vec<String>,
    // 0.4.8: research tasks are experimental and off until the user turns
    // them on in Settings, Research. Changed only by
    // `research_tasks_set_enabled`, which also tells the queue.
    #[serde(default)]
    pub research_tasks_enabled: bool,
    // 0.4.8 L: background tasks. Changed only through their own commands
    // (`background_tasks_set_enabled`, `background_helper_set_login_item`).
    /// Tasks marked to keep running move to the background helper when
    /// Oleafly quits.
    #[serde(default = "default_true")]
    pub research_background_enabled: bool,
    /// Start the background helper when the user signs in.
    #[serde(default)]
    pub research_background_at_login: bool,
    // 0.4.8 I: Desktop apps. Device-local, written only by
    // `cua_driver_settings_set`, which asks before widening control.
    #[serde(default)]
    pub cua_driver: crate::cua_driver::CuaDriverConfig,
}

fn default_research_minutes() -> u32 {
    120
}

fn default_ui_locale() -> String {
    "system".into()
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
            ai_reasoning_summaries: false,
            ai_provider_models: std::collections::HashMap::new(),
            ai_custom_providers: Vec::new(),
            ai_tools_model: None,
            ai_model_probes: BTreeMap::new(),
            ai_model_lists_refreshed_at: BTreeMap::new(),
            ai_personas: Vec::new(),
            ai_starter_personas_seeded: false,
            checkpoints_enabled: true,
            checkpoint_notifications: true,
            git_auto_init: true,
            mcp_enabled: false,
            mcp_port: default_mcp_port(),
            mcp_read_only: false,
            mcp_approval_policy: default_mcp_approval_policy(),
            mcp_token: String::new(),
            mcp_servers: Vec::new(),
            skills_share_with_agents: true,
            ui_locale: default_ui_locale(),
            cli_settings_revision: 0,
            typst_default_version: None,
            latex_default_engine: None,
            research_keep_awake: true,
            research_notifications: true,
            research_command_network: false,
            research_time_budget_minutes: default_research_minutes(),
            research_task_mcp_servers: Vec::new(),
            research_tasks_enabled: false,
            // 0.4.8 L:
            research_background_enabled: true,
            research_background_at_login: false,
            cua_driver: crate::cua_driver::CuaDriverConfig::default(),
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
    let guard = lock_mutex(
        CONFIG_WRITE_LOCK.get_or_init(|| Mutex::new(())),
        STORAGE_LOCK_TIMEOUT,
    )
    .map_err(|error| format!("failed to lock config transaction: {error}"))?;
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
    lock_file(&file, true, STORAGE_LOCK_TIMEOUT)
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
    let unflagged = custom_providers_without_key_flag(&s);
    let mut hydrated = hydrate_secrets(cfg)?;
    mark_keyless_custom_providers_optional(&mut hydrated, &unflagged);
    drop_transient_probe_verdicts(&mut hydrated);
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

pub(crate) fn typst_default_choice() -> Option<String> {
    let text = std::fs::read_to_string(config_path().ok()?).ok()?;
    serde_json::from_str::<serde_json::Value>(&text)
        .ok()?
        .get("typst_default_version")?
        .as_str()
        .map(str::trim)
        .filter(|version| !version.is_empty())
        .map(str::to_owned)
}

pub(crate) fn set_typst_default_choice(version: Option<String>) -> Result<(), String> {
    update_config(|config| {
        config.typst_default_version = version
            .map(|version| version.trim().to_owned())
            .filter(|version| !version.is_empty());
        Ok(())
    })
}

// 0.4.8 H: Tools model
/// Trims and checks a Tools model choice. An Ollama choice without a model is
/// the automatic local choice, stored as `None`.
pub(crate) fn normalize_tools_choice(
    choice: Option<ToolsModelChoice>,
) -> Result<Option<ToolsModelChoice>, String> {
    let Some(choice) = choice else {
        return Ok(None);
    };
    // Checked before trimming: trim() would quietly drop a trailing newline.
    if choice.provider.chars().any(char::is_control) {
        return Err("Pick a provider for Tools.".into());
    }
    if choice.model.chars().any(char::is_control) {
        return Err("Pick a model for Tools.".into());
    }
    let provider = choice.provider.trim();
    let model = choice.model.trim();
    if provider.is_empty() || provider.chars().count() > MAX_TOOLS_PROVIDER_CHARS {
        return Err("Pick a provider for Tools.".into());
    }
    if model.chars().count() > MAX_TOOLS_MODEL_CHARS {
        return Err("Pick a model for Tools.".into());
    }
    if model.is_empty() {
        return if provider == "ollama" {
            Ok(None)
        } else {
            Err("Pick a model for Tools.".into())
        };
    }
    Ok(Some(ToolsModelChoice {
        provider: provider.to_owned(),
        model: model.to_owned(),
    }))
}

pub(crate) fn set_ai_tools_model_blocking(choice: Option<ToolsModelChoice>) -> Result<(), String> {
    let choice = normalize_tools_choice(choice)?;
    update_config(|config| {
        config.ai_tools_model = choice;
        Ok(())
    })
}

/// Sets the model the Tools converters use. Whole-config writes from the
/// webview keep the stored choice (`set_config_blocking`), so only this
/// command changes where Tools send images.
#[tauri::command]
pub async fn set_ai_tools_model(choice: Option<ToolsModelChoice>) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || set_ai_tools_model_blocking(choice))
        .await
        .map_err(|error| format!("failed to save the Tools model: {error}"))?
}

pub(crate) const LATEXMK_ENGINE: &str = "latexmk";

pub(crate) fn latex_default_engine_choice() -> Option<String> {
    let text = std::fs::read_to_string(config_path().ok()?).ok()?;
    serde_json::from_str::<serde_json::Value>(&text)
        .ok()?
        .get("latex_default_engine")?
        .as_str()
        .filter(|engine| *engine == LATEXMK_ENGINE)
        .map(str::to_owned)
}

pub(crate) fn set_latex_default_engine_choice(engine: &str) -> Result<(), String> {
    let choice = match engine.trim() {
        LATEXMK_ENGINE => Some(LATEXMK_ENGINE.to_owned()),
        "tectonic" | "xetex" => None,
        other => return Err(format!("unknown default LaTeX engine \"{other}\"")),
    };
    if latex_default_engine_choice() == choice {
        return Ok(());
    }
    update_config(|config| {
        config.latex_default_engine = choice;
        Ok(())
    })
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

    crate::sandbox::replace_file(&tmp, path).map_err(|e| {
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

fn restore_ai_secrets(config: &mut AppConfig, stored: &AppConfig) -> Vec<String> {
    let legacy_provider = if stored.ai_provider.is_empty() {
        "openai"
    } else {
        stored.ai_provider.as_str()
    };
    let mut restored = Vec::new();
    for (provider, value) in config.ai_keys.iter_mut() {
        if value == REDACTED {
            restored.push(provider.clone());
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
    restored
}

#[tauri::command]
pub async fn get_config() -> Result<AppConfig, String> {
    tauri::async_runtime::spawn_blocking(get_config_blocking)
        .await
        .map_err(|error| format!("failed to read settings: {error}"))?
}

pub fn get_config_blocking() -> Result<AppConfig, String> {
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

fn apply_starter_persona_seed(config: &mut AppConfig, starters: &[Persona]) -> bool {
    if config.ai_starter_personas_seeded {
        return false;
    }

    for starter in starters {
        let starter_name = starter.name.trim().to_lowercase();
        let installed = config.ai_personas.iter().any(|persona| {
            persona.id == starter.id || persona.name.trim().to_lowercase() == starter_name
        });
        if !installed {
            config.ai_personas.push(starter.clone());
        }
    }
    config.ai_starter_personas_seeded = true;
    true
}

#[tauri::command]
pub async fn seed_starter_personas(starters: Vec<Persona>) -> Result<AppConfig, String> {
    tauri::async_runtime::spawn_blocking(move || seed_starter_personas_blocking(starters))
        .await
        .map_err(|error| format!("failed to seed the starter personas: {error}"))?
}

fn seed_starter_personas_blocking(starters: Vec<Persona>) -> Result<AppConfig, String> {
    update_config(|config| {
        apply_starter_persona_seed(config, &starters);
        Ok(())
    })?;
    get_config_blocking()
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

fn drop_keys_for_moved_endpoints(config: &mut AppConfig, stored: &AppConfig, restored: &[String]) {
    let doomed: Vec<String> = moved_endpoint_ids(config, stored)
        .into_iter()
        .filter(|id| restored.iter().any(|restored_id| restored_id == id))
        .chain(recreated_provider_ids(config, stored))
        .chain(orphaned_provider_ids(config, stored))
        .collect();
    for id in doomed {
        config.ai_keys.remove(&id);
    }
}

fn changed_endpoint_ids(config: &AppConfig, stored: &AppConfig) -> Vec<String> {
    stored
        .ai_custom_providers
        .iter()
        .filter(|previous| {
            config
                .ai_custom_providers
                .iter()
                .find(|c| c.id == previous.id)
                .is_some_and(|current| current.base_url.trim() != previous.base_url.trim())
        })
        .map(|previous| previous.id.clone())
        .collect()
}

fn drop_probes_for_moved_endpoints(config: &mut AppConfig, stored: &AppConfig) {
    let doomed: Vec<String> = changed_endpoint_ids(config, stored)
        .into_iter()
        .chain(orphaned_provider_ids(config, stored))
        .map(|id| format!("{id}/"))
        .collect();
    if doomed.is_empty() {
        return;
    }
    config
        .ai_model_probes
        .retain(|key, _| !doomed.iter().any(|prefix| key.starts_with(prefix)));
}

/// Ids of the custom providers whose saved entry has no `keyOptional` field.
/// Builds before it read and wrote the flag as `key_optional`, which the
/// settings view never set, so those entries say nothing about the key.
fn custom_providers_without_key_flag(source: &str) -> Vec<String> {
    let Ok(value) = serde_json::from_str::<serde_json::Value>(source) else {
        return Vec::new();
    };
    value
        .get("ai_custom_providers")
        .and_then(serde_json::Value::as_array)
        .map(|entries| {
            entries
                .iter()
                .filter(|entry| entry.get("keyOptional").is_none())
                .filter_map(|entry| entry.get("id")?.as_str().map(str::to_string))
                .collect()
        })
        .unwrap_or_default()
}

/// An entry from an older build with no stored key could only ever work
/// without one, so it becomes key-optional. An entry that states the flag
/// keeps it: a key-needing provider whose key is missing (settings copied to
/// another machine, say) should ask for the key, not send requests without it.
fn mark_keyless_custom_providers_optional(config: &mut AppConfig, unflagged: &[String]) {
    for provider in &mut config.ai_custom_providers {
        if !unflagged.contains(&provider.id) {
            continue;
        }
        let has_key = config
            .ai_keys
            .get(&provider.id)
            .is_some_and(|key| !key.trim().is_empty());
        if !has_key {
            provider.key_optional = true;
        }
    }
}

/// Drops `Blocked` verdicts that only recorded a failed attempt (a timeout, an
/// unreachable or busy provider). Older builds saved those as verdicts, which
/// left a model that was merely slow to load blocked for good.
fn drop_transient_probe_verdicts(config: &mut AppConfig) {
    config.ai_model_probes.retain(|_, probe| {
        probe.verdict != ProbeVerdict::Blocked
            || !crate::agent::is_transient_probe_reason(&probe.reason)
    });
}

fn is_known_provider(custom: &[CustomProvider], id: &str) -> bool {
    oleafly_agent::provider::catalog_entry(id).is_some() || custom.iter().any(|c| c.id == id)
}

/// A deleted custom provider leaves its list-refresh stamp behind; only the
/// catalog providers and the current custom ones keep theirs.
fn drop_stamps_for_removed_providers(config: &mut AppConfig) {
    let custom = &config.ai_custom_providers;
    config
        .ai_model_lists_refreshed_at
        .retain(|id, _| is_known_provider(custom, id));
}

#[tauri::command]
pub async fn set_config(config: AppConfig) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || set_config_blocking(config))
        .await
        .map_err(|error| format!("configuration worker failed: {error}"))?
}

fn set_config_blocking(mut config: AppConfig) -> Result<(), String> {
    let _guard = lock_config_writes()?;
    let stored = read_config_unlocked()?;
    if config.github_token.is_empty() {
        config.github_token = stored.github_token.clone();
    }
    if config.mcp_token.is_empty() {
        config.mcp_token = stored.mcp_token.clone();
    }
    let restored = restore_ai_secrets(&mut config, &stored);
    drop_keys_for_moved_endpoints(&mut config, &stored, &restored);
    keep_newer_model_trust_records(&mut config, &stored);
    drop_probes_for_moved_endpoints(&mut config, &stored);
    drop_stamps_for_removed_providers(&mut config);
    keep_cli_settings(&mut config, &stored);
    config.mcp_servers = stored.mcp_servers;
    config.typst_default_version = stored.typst_default_version;
    // 0.4.8 H: only set_ai_tools_model changes where Tools send images.
    config.ai_tools_model = stored.ai_tools_model;
    config.latex_default_engine = stored.latex_default_engine;
    // 0.4.8 I: only cua_driver_settings_set changes what agents may control.
    config.cua_driver = stored.cua_driver;
    // 0.4.8: only research_tasks_set_enabled turns research tasks on or off.
    config.research_tasks_enabled = stored.research_tasks_enabled;
    // 0.4.8 L: only the background commands change these.
    config.research_background_enabled = stored.research_background_enabled;
    config.research_background_at_login = stored.research_background_at_login;
    config.github_connected = false;
    write_config_unlocked(&config)
}

/// The settings `oleafly config set --global` writes, as the CLI left them
/// when `config` was read before the CLI's last change (the settings views
/// load once and save their whole copy later).
fn keep_cli_settings(config: &mut AppConfig, stored: &AppConfig) {
    if config.cli_settings_revision != stored.cli_settings_revision {
        config.checkpoints_enabled = stored.checkpoints_enabled;
        config.checkpoint_notifications = stored.checkpoint_notifications;
        config.git_auto_init = stored.git_auto_init;
        config.skills_share_with_agents = stored.skills_share_with_agents;
        config.ui_locale = stored.ui_locale.clone();
    }
    config.cli_settings_revision = stored.cli_settings_revision;
}

fn keep_newer_model_trust_records(config: &mut AppConfig, stored: &AppConfig) {
    for (key, probe) in &stored.ai_model_probes {
        let incoming_is_newer = config
            .ai_model_probes
            .get(key)
            .is_some_and(|incoming| incoming.probed_at >= probe.probed_at);
        if !incoming_is_newer {
            config.ai_model_probes.insert(key.clone(), probe.clone());
        }
    }
    for (provider, refreshed_at) in &stored.ai_model_lists_refreshed_at {
        if !is_known_provider(&config.ai_custom_providers, provider) {
            continue;
        }
        let incoming_is_newer = config
            .ai_model_lists_refreshed_at
            .get(provider)
            .is_some_and(|incoming| incoming >= refreshed_at);
        if !incoming_is_newer {
            config
                .ai_model_lists_refreshed_at
                .insert(provider.clone(), *refreshed_at);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::proc::NoConsole as _;

    #[test]
    fn a_0_4_7_config_gets_the_research_defaults() {
        let config: AppConfig = serde_json::from_str("{}").unwrap();

        assert!(config.research_keep_awake);
        assert!(config.research_notifications);
        assert!(!config.research_command_network);
        assert_eq!(config.research_time_budget_minutes, 120);
        assert!(config.research_task_mcp_servers.is_empty());
        let defaults = AppConfig::default();
        assert_eq!(
            (
                defaults.research_keep_awake,
                defaults.research_time_budget_minutes
            ),
            (true, 120)
        );
    }

    // 0.4.8: research tasks are experimental and start off for everyone.
    #[test]
    fn research_tasks_start_off_and_only_their_own_command_turns_them_on() {
        let config: AppConfig = serde_json::from_str("{}").unwrap();
        assert!(!config.research_tasks_enabled);
        assert!(!AppConfig::default().research_tasks_enabled);

        let _env_guard = crate::paths::data_dir_env_lock();
        let dir = temp_dir();
        std::env::set_var("OLEAFLY_DATA_DIR", &dir);
        let _guard = DataDirGuard;
        write_config(&AppConfig::default()).unwrap();
        // A whole-config save from a settings view that loaded before the
        // switch was flipped must not flip it back.
        let mut incoming = get_config_blocking().unwrap();
        incoming.research_tasks_enabled = true;
        tauri::async_runtime::block_on(set_config(incoming)).unwrap();
        assert!(!read_config().unwrap().research_tasks_enabled);
        update_config(|config| {
            config.research_tasks_enabled = true;
            Ok(())
        })
        .unwrap();
        let mut incoming = get_config_blocking().unwrap();
        incoming.research_tasks_enabled = false;
        tauri::async_runtime::block_on(set_config(incoming)).unwrap();
        assert!(read_config().unwrap().research_tasks_enabled);
        std::fs::remove_dir_all(dir).ok();
    }

    // 0.4.8 L:
    #[test]
    fn background_settings_default_on_and_off_for_0_4_7_configs() {
        let config: AppConfig = serde_json::from_str("{}").unwrap();
        assert!(config.research_background_enabled && !config.research_background_at_login);
        let defaults = AppConfig::default();
        assert!(defaults.research_background_enabled && !defaults.research_background_at_login);
    }

    // 0.4.8 L:
    #[test]
    fn a_full_config_write_keeps_the_background_settings() {
        let _env_guard = crate::paths::data_dir_env_lock();
        let dir = temp_dir();
        std::env::set_var("OLEAFLY_DATA_DIR", &dir);
        let _guard = DataDirGuard;
        write_config(&AppConfig::default()).unwrap();
        update_config(|config| {
            config.research_background_enabled = false;
            config.research_background_at_login = true;
            Ok(())
        })
        .unwrap();
        let mut incoming = get_config_blocking().unwrap();
        incoming.research_background_enabled = true;
        incoming.research_background_at_login = false;
        tauri::async_runtime::block_on(set_config(incoming)).unwrap();
        let stored = read_config().unwrap();
        assert!(!stored.research_background_enabled && stored.research_background_at_login);
        std::fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn old_configs_keep_checkpoints_and_their_notifications_on() {
        let config: AppConfig = serde_json::from_str("{}").unwrap();

        assert!(config.checkpoints_enabled);
        assert!(config.checkpoint_notifications);
    }

    #[test]
    fn old_configs_start_with_no_model_probes_or_list_stamps() {
        let config: AppConfig = serde_json::from_str("{}").unwrap();

        assert!(config.ai_model_probes.is_empty());
        assert!(config.ai_model_lists_refreshed_at.is_empty());
        assert!(AppConfig::default().ai_model_probes.is_empty());
        assert!(AppConfig::default().ai_model_lists_refreshed_at.is_empty());
    }

    #[test]
    fn model_probes_and_list_stamps_survive_a_config_round_trip() {
        let stored = AppConfig {
            ai_model_probes: BTreeMap::from([(
                model_probe_key("openai", "gpt-4o"),
                ModelProbe {
                    verdict: ProbeVerdict::Blocked,
                    reason: "The model answered without calling the tool.".into(),
                    probed_at: 1_700_000_000_000,
                },
            )]),
            ai_model_lists_refreshed_at: BTreeMap::from([(
                "openai".to_string(),
                1_700_000_000_500,
            )]),
            ..AppConfig::default()
        };

        let json = serde_json::to_string(&stored).unwrap();
        assert!(json.contains("\"openai/gpt-4o\":{\"verdict\":\"blocked\""));
        assert!(json.contains("\"probedAt\":1700000000000"));
        let loaded: AppConfig = serde_json::from_str(&json).unwrap();

        assert_eq!(loaded.ai_model_probes, stored.ai_model_probes);
        assert_eq!(
            loaded.ai_model_lists_refreshed_at,
            stored.ai_model_lists_refreshed_at
        );
    }

    fn probe(verdict: ProbeVerdict, probed_at: u64) -> ModelProbe {
        ModelProbe {
            verdict,
            reason: "probe".into(),
            probed_at,
        }
    }

    #[test]
    fn a_stale_settings_snapshot_cannot_drop_a_newer_probe_verdict() {
        let stored = AppConfig {
            ai_model_probes: BTreeMap::from([
                ("openai/new".to_string(), probe(ProbeVerdict::Verified, 20)),
                ("openai/old".to_string(), probe(ProbeVerdict::Blocked, 5)),
            ]),
            ai_model_lists_refreshed_at: BTreeMap::from([
                ("openai".to_string(), 20),
                ("groq".to_string(), 5),
            ]),
            ..AppConfig::default()
        };
        let mut incoming = AppConfig {
            ai_model_probes: BTreeMap::from([(
                "openai/old".to_string(),
                probe(ProbeVerdict::Verified, 10),
            )]),
            ai_model_lists_refreshed_at: BTreeMap::from([("groq".to_string(), 10)]),
            ..AppConfig::default()
        };

        keep_newer_model_trust_records(&mut incoming, &stored);

        assert_eq!(
            incoming.ai_model_probes["openai/new"],
            probe(ProbeVerdict::Verified, 20)
        );
        assert_eq!(
            incoming.ai_model_probes["openai/old"],
            probe(ProbeVerdict::Verified, 10)
        );
        assert_eq!(incoming.ai_model_lists_refreshed_at["openai"], 20);
        assert_eq!(incoming.ai_model_lists_refreshed_at["groq"], 10);
    }

    fn probes_for(ids: &[&str]) -> BTreeMap<String, ModelProbe> {
        ids.iter()
            .map(|id| (id.to_string(), probe(ProbeVerdict::Blocked, 7)))
            .collect()
    }

    #[test]
    fn moving_a_custom_endpoint_drops_the_verdicts_probed_against_the_old_one() {
        let stored = AppConfig {
            ai_custom_providers: vec![custom("local-lab", "http://lab.test/v1")],
            ai_model_probes: probes_for(&[
                "local-lab/m",
                "local-lab/vendor/m",
                "local-labs/m",
                "openai/gpt-4o",
            ]),
            ..AppConfig::default()
        };
        let mut incoming = AppConfig {
            ai_custom_providers: vec![custom("local-lab", "http://other.test/v1")],
            ai_model_probes: stored.ai_model_probes.clone(),
            ..AppConfig::default()
        };

        keep_newer_model_trust_records(&mut incoming, &stored);
        drop_probes_for_moved_endpoints(&mut incoming, &stored);

        assert_eq!(
            incoming.ai_model_probes.keys().collect::<Vec<_>>(),
            vec!["local-labs/m", "openai/gpt-4o"]
        );

        let mut unchanged = AppConfig {
            ai_custom_providers: vec![custom("local-lab", " http://lab.test/v1 ")],
            ai_model_probes: BTreeMap::new(),
            ..AppConfig::default()
        };
        keep_newer_model_trust_records(&mut unchanged, &stored);
        drop_probes_for_moved_endpoints(&mut unchanged, &stored);
        assert_eq!(unchanged.ai_model_probes.len(), 4);
    }

    #[test]
    fn removing_a_custom_provider_drops_its_verdicts_too() {
        let stored = AppConfig {
            ai_custom_providers: vec![custom("local-lab", "http://lab.test/v1")],
            ai_model_probes: probes_for(&["local-lab/m", "openai/gpt-4o"]),
            ..AppConfig::default()
        };
        let mut incoming = AppConfig {
            ai_model_probes: BTreeMap::new(),
            ..AppConfig::default()
        };

        keep_newer_model_trust_records(&mut incoming, &stored);
        drop_probes_for_moved_endpoints(&mut incoming, &stored);

        assert_eq!(
            incoming.ai_model_probes.keys().collect::<Vec<_>>(),
            vec!["openai/gpt-4o"]
        );
    }

    #[test]
    fn a_custom_entry_shadowing_a_catalog_id_keeps_the_catalog_verdicts() {
        let stored = AppConfig {
            ai_model_probes: probes_for(&["openai/gpt-4o"]),
            ..AppConfig::default()
        };
        let mut incoming = AppConfig {
            ai_custom_providers: vec![custom("openai", "http://attacker.example")],
            ai_model_probes: BTreeMap::new(),
            ..AppConfig::default()
        };

        keep_newer_model_trust_records(&mut incoming, &stored);
        drop_probes_for_moved_endpoints(&mut incoming, &stored);

        assert_eq!(incoming.ai_model_probes.len(), 1);
    }

    #[test]
    fn old_configs_initialise_git_for_every_project() {
        let config: AppConfig = serde_json::from_str("{}").unwrap();

        assert!(config.git_auto_init);
        assert!(AppConfig::default().git_auto_init);
    }

    #[test]
    fn a_save_from_a_copy_older_than_the_clis_change_keeps_the_clis_settings() {
        let stored = AppConfig {
            git_auto_init: false,
            checkpoints_enabled: false,
            ui_locale: "de".into(),
            cli_settings_revision: 2,
            ..AppConfig::default()
        };
        // Read before the CLI's change: its copy still says true.
        let mut stale = AppConfig {
            cli_settings_revision: 1,
            ai_model: "picked-in-the-app".into(),
            ..AppConfig::default()
        };
        keep_cli_settings(&mut stale, &stored);
        assert!(!stale.git_auto_init && !stale.checkpoints_enabled);
        assert_eq!(stale.ui_locale, "de");
        assert_eq!(stale.ai_model, "picked-in-the-app");
        assert_eq!(stale.cli_settings_revision, 2);
        // Read after it: the app's own change goes through.
        let mut fresh = AppConfig {
            cli_settings_revision: 2,
            git_auto_init: true,
            ..AppConfig::default()
        };
        keep_cli_settings(&mut fresh, &stored);
        assert!(fresh.git_auto_init);
    }

    #[test]
    fn git_auto_init_survives_a_config_round_trip() {
        let stored = AppConfig {
            git_auto_init: false,
            ..AppConfig::default()
        };

        let json = serde_json::to_string(&stored).unwrap();
        let loaded: AppConfig = serde_json::from_str(&json).unwrap();

        assert!(json.contains("\"git_auto_init\":false"));
        assert!(!loaded.git_auto_init);
    }

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
        drop_keys_for_moved_endpoints(&mut incoming, &stored, &["mycorp".to_string()]);
        assert!(
            !incoming.ai_keys.contains_key("mycorp"),
            "a moved endpoint kept the credential it must not reach"
        );
    }

    #[test]
    fn repointing_while_supplying_a_new_key_keeps_that_key() {
        let stored = with_custom("https://api.mycorp.test/v1", "sk-real");
        let mut incoming = with_custom("https://api.mycorp.test/v2", "sk-freshly-typed");
        drop_keys_for_moved_endpoints(&mut incoming, &stored, &[]);
        assert_eq!(
            incoming.ai_keys.get("mycorp").map(String::as_str),
            Some("sk-freshly-typed")
        );
    }

    #[test]
    fn leaving_the_endpoint_alone_keeps_the_key() {
        let stored = with_custom("https://api.mycorp.test/v1", "sk-real");
        let mut incoming = with_custom("https://api.mycorp.test/v1", "sk-real");
        drop_keys_for_moved_endpoints(&mut incoming, &stored, &[]);
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
        drop_keys_for_moved_endpoints(&mut incoming, &stored, &[]);
        assert!(!incoming.ai_keys.contains_key("mycorp"));
    }

    #[test]
    fn repointing_while_re_entering_the_same_key_keeps_it() {
        let stored = with_custom("https://api.mycorp.test/v1", "sk-real");
        let mut incoming = with_custom("https://api.mycorp.test/v2", "sk-real");
        let restored = restore_ai_secrets(&mut incoming, &stored);
        assert!(restored.is_empty());
        drop_keys_for_moved_endpoints(&mut incoming, &stored, &restored);
        assert_eq!(
            incoming.ai_keys.get("mycorp").map(String::as_str),
            Some("sk-real")
        );
    }

    #[test]
    fn repointing_with_a_redacted_key_drops_the_restored_secret() {
        let stored = with_custom("https://api.mycorp.test/v1", "sk-real");
        let mut incoming = with_custom("https://api.mycorp.test/v2", REDACTED);
        let restored = restore_ai_secrets(&mut incoming, &stored);
        assert_eq!(restored, vec!["mycorp".to_string()]);
        drop_keys_for_moved_endpoints(&mut incoming, &stored, &restored);
        assert!(!incoming.ai_keys.contains_key("mycorp"));
    }

    #[test]
    fn delete_then_recreate_cannot_reattach_a_stored_key_to_a_new_endpoint() {
        let stored = with_custom("https://api.mycorp.test/v1", "sk-real");
        let mut step_one = AppConfig {
            ai_keys: HashMap::from([("mycorp".to_string(), REDACTED.to_string())]),
            ..AppConfig::default()
        };
        let restored = restore_ai_secrets(&mut step_one, &stored);
        drop_keys_for_moved_endpoints(&mut step_one, &stored, &restored);
        assert!(!step_one.ai_keys.contains_key("mycorp"));

        let stale_stored = with_custom("https://api.mycorp.test/v1", "sk-real");
        let mut step_two = AppConfig {
            ai_custom_providers: vec![custom("mycorp", "http://attacker.example")],
            ai_keys: HashMap::from([("mycorp".to_string(), "sk-real".to_string())]),
            ..AppConfig::default()
        };
        let mut no_provider_stored = stale_stored.clone();
        no_provider_stored.ai_custom_providers.clear();
        drop_keys_for_moved_endpoints(&mut step_two, &no_provider_stored, &[]);
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
        drop_keys_for_moved_endpoints(&mut incoming, &stored, &[]);
        assert_eq!(
            incoming.ai_keys.get("openai").map(String::as_str),
            Some("sk-real")
        );
    }

    #[test]
    fn a_marker_round_trip_through_set_config_cannot_move_the_endpoint() {
        let stored = with_custom("https://api.mycorp.test/v1", "sk-real");
        let mut incoming = with_custom("http://attacker.example", REDACTED);
        let restored = restore_ai_secrets(&mut incoming, &stored);
        drop_keys_for_moved_endpoints(&mut incoming, &stored, &restored);
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
            .no_console()
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
            .no_console()
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
            ai_starter_personas_seeded: true,
            ..Default::default()
        };
        write_config_at(&path, &cfg).unwrap();

        let read: AppConfig =
            serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
        assert_eq!(read.github_token, "secret-token");
        assert_eq!(read.ai_provider, "anthropic");
        assert!(read.ai_starter_personas_seeded);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn legacy_config_defaults_starter_persona_seed_flag_to_false() {
        let config: AppConfig = serde_json::from_str("{}").unwrap();
        assert!(!config.ai_starter_personas_seeded);
    }

    #[test]
    fn starter_persona_seed_is_idempotent_and_preserves_concurrent_fields() {
        let mut config = AppConfig {
            ai_personas: vec![Persona {
                id: "custom".into(),
                name: "RESEARCH WRITER".into(),
                color: "slate".into(),
                prompt: "Keep my instructions.".into(),
            }],
            mcp_port: 65001,
            ..AppConfig::default()
        };
        let starters = vec![
            Persona {
                id: "starter-research-writer".into(),
                name: "Research Writer".into(),
                color: "ocean".into(),
                prompt: "Research carefully.".into(),
            },
            Persona {
                id: "starter-figure".into(),
                name: "Draw a Figure".into(),
                color: "sunset".into(),
                prompt: "Draw carefully.".into(),
            },
        ];

        assert!(apply_starter_persona_seed(&mut config, &starters));
        assert_eq!(config.mcp_port, 65001);
        assert_eq!(config.ai_personas.len(), 2);
        assert_eq!(config.ai_personas[1].id, "starter-figure");
        assert!(config.ai_starter_personas_seeded);

        config.ai_personas.clear();
        assert!(!apply_starter_persona_seed(&mut config, &starters));
        assert!(config.ai_personas.is_empty());
        assert_eq!(config.mcp_port, 65001);
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

    #[test]
    fn starter_persona_command_preserves_current_config_and_redacts_its_response() {
        let _env_guard = crate::paths::data_dir_env_lock();
        let dir = temp_dir();
        std::env::set_var("OLEAFLY_DATA_DIR", &dir);
        let _guard = DataDirGuard;
        let config = AppConfig {
            github_token: "github-secret".into(),
            github_user: "octocat".into(),
            ai_api_key: "legacy-ai-secret".into(),
            ai_keys: HashMap::from([("openai".into(), "provider-secret".into())]),
            mcp_token: "mcp-secret".into(),
            mcp_servers: vec![stdio_server("local-search", "server-secret")],
            mcp_port: 65001,
            ..AppConfig::default()
        };
        write_config(&config).unwrap();
        let starters = vec![Persona {
            id: "starter-figure".into(),
            name: "Draw a Figure".into(),
            color: "sunset".into(),
            prompt: "Draw carefully.".into(),
        }];

        let visible = seed_starter_personas_blocking(starters.clone()).unwrap();

        assert_eq!(visible.mcp_port, 65001);
        assert_eq!(visible.github_user, "octocat");
        assert!(visible.ai_starter_personas_seeded);
        assert_eq!(visible.ai_personas.len(), 1);
        assert!(visible.github_connected);
        assert!(visible.github_token.is_empty());
        assert_eq!(visible.ai_api_key, REDACTED);
        assert_eq!(
            visible.ai_keys.get("openai").map(String::as_str),
            Some(REDACTED)
        );
        assert!(visible.mcp_token.is_empty());
        assert_eq!(
            visible.mcp_servers,
            vec![stdio_server("local-search", REDACTED)]
        );

        let mut persisted = read_config().unwrap();
        assert_eq!(persisted.mcp_port, 65001);
        assert_eq!(persisted.github_token, "github-secret");
        assert_eq!(persisted.ai_api_key, "legacy-ai-secret");
        assert_eq!(
            persisted.ai_keys.get("openai").map(String::as_str),
            Some("provider-secret")
        );
        assert_eq!(persisted.mcp_token, "mcp-secret");
        assert_eq!(
            persisted.mcp_servers,
            vec![stdio_server("local-search", "server-secret")]
        );

        persisted.ai_personas.clear();
        write_config(&persisted).unwrap();
        let after_delete = seed_starter_personas_blocking(starters).unwrap();
        assert!(after_delete.ai_personas.is_empty());
        assert!(after_delete.ai_starter_personas_seeded);
        assert!(read_config().unwrap().ai_personas.is_empty());
        std::fs::remove_dir_all(dir).ok();
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

        let visible = get_config_blocking().unwrap();
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
        let mut incoming = get_config_blocking().unwrap();
        incoming.github_user = "octocat".to_string();
        incoming.mcp_servers.clear();

        tauri::async_runtime::block_on(set_config(incoming)).unwrap();

        let persisted = read_config().unwrap();
        assert_eq!(persisted.github_user, "octocat");
        assert_eq!(persisted.mcp_servers, stored.mcp_servers);
        std::fs::remove_dir_all(dir).ok();
    }

    // 0.4.8 I: Desktop apps settings survive a generic settings save.
    #[test]
    fn generic_settings_updates_preserve_the_desktop_apps_settings() {
        let _env_guard = crate::paths::data_dir_env_lock();
        let dir = temp_dir();
        std::env::set_var("OLEAFLY_DATA_DIR", &dir);
        let _guard = DataDirGuard;
        let stored = AppConfig {
            cua_driver: crate::cua_driver::CuaDriverConfig {
                enabled: true,
                apps: vec![crate::cua_driver::config::AllowedApp {
                    name: "Zotero".into(),
                    bundle_id: Some("org.zotero.zotero".into()),
                    executable: None,
                }],
                ..Default::default()
            },
            ..AppConfig::default()
        };
        write_config(&stored).unwrap();
        let mut incoming = get_config_blocking().unwrap();
        incoming.github_user = "octocat".to_string();
        incoming.cua_driver = crate::cua_driver::CuaDriverConfig::default();

        tauri::async_runtime::block_on(set_config(incoming)).unwrap();

        let persisted = read_config().unwrap();
        assert_eq!(persisted.github_user, "octocat");
        assert_eq!(persisted.cua_driver, stored.cua_driver);
        std::fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn configs_from_0_4_7_load_with_desktop_apps_off() {
        let config: AppConfig =
            serde_json::from_str(r#"{"github_user":"octocat","live_collaboration":true}"#).unwrap();
        assert!(!config.cua_driver.enabled);
        assert!(config.cua_driver.apps.is_empty());
        assert!(config.cua_driver.sites.is_empty());
        assert!(!config.cua_driver.scripted_control);
        assert_eq!(AppConfig::default().cua_driver, config.cua_driver);
    }

    #[test]
    fn generic_settings_updates_carry_the_checkpoint_switches() {
        let _env_guard = crate::paths::data_dir_env_lock();
        let dir = temp_dir();
        std::env::set_var("OLEAFLY_DATA_DIR", &dir);
        let _guard = DataDirGuard;
        write_config(&AppConfig::default()).unwrap();
        let mut incoming = get_config_blocking().unwrap();
        assert!(incoming.checkpoints_enabled);
        assert!(incoming.checkpoint_notifications);
        incoming.github_user = "octocat".to_string();
        incoming.checkpoints_enabled = false;
        incoming.checkpoint_notifications = false;

        tauri::async_runtime::block_on(set_config(incoming)).unwrap();

        let persisted = read_config().unwrap();
        assert_eq!(persisted.github_user, "octocat");
        assert!(!persisted.checkpoints_enabled);
        assert!(!persisted.checkpoint_notifications);
        std::fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn generic_settings_updates_carry_the_model_trust_records() {
        let _env_guard = crate::paths::data_dir_env_lock();
        let dir = temp_dir();
        std::env::set_var("OLEAFLY_DATA_DIR", &dir);
        let _guard = DataDirGuard;
        write_config(&AppConfig::default()).unwrap();
        update_config(|config| {
            config.ai_model_probes.insert(
                model_probe_key("groq", "llama-3.3-70b-versatile"),
                probe(ProbeVerdict::Verified, 40),
            );
            Ok(())
        })
        .unwrap();
        let mut incoming = get_config_blocking().unwrap();
        assert_eq!(incoming.ai_model_probes.len(), 1);
        incoming
            .ai_model_lists_refreshed_at
            .insert("groq".to_string(), 41);
        incoming.ai_model_probes.clear();

        tauri::async_runtime::block_on(set_config(incoming)).unwrap();

        let persisted = read_config().unwrap();
        assert_eq!(
            persisted.ai_model_probes[&model_probe_key("groq", "llama-3.3-70b-versatile")],
            probe(ProbeVerdict::Verified, 40)
        );
        assert_eq!(persisted.ai_model_lists_refreshed_at["groq"], 41);
        std::fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn the_typst_default_persists_and_settings_writes_from_the_webview_keep_it() {
        let _env_guard = crate::paths::data_dir_env_lock();
        let dir = temp_dir();
        std::env::set_var("OLEAFLY_DATA_DIR", &dir);
        let _guard = DataDirGuard;
        assert_eq!(typst_default_choice(), None);
        write_config(&AppConfig::default()).unwrap();
        assert_eq!(typst_default_choice(), None);
        assert!(!std::fs::read_to_string(config_path().unwrap())
            .unwrap()
            .contains("typst_default_version"));

        set_typst_default_choice(Some(" 0.13.1 ".into())).unwrap();
        assert_eq!(typst_default_choice().as_deref(), Some("0.13.1"));

        let mut incoming = get_config_blocking().unwrap();
        incoming.typst_default_version = None;
        tauri::async_runtime::block_on(set_config(incoming)).unwrap();
        assert_eq!(typst_default_choice().as_deref(), Some("0.13.1"));

        set_typst_default_choice(Some("  ".into())).unwrap();
        assert_eq!(typst_default_choice(), None);
        assert_eq!(read_config().unwrap().typst_default_version, None);
        std::fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn the_latex_default_engine_persists_and_settings_writes_from_the_webview_keep_it() {
        let _env_guard = crate::paths::data_dir_env_lock();
        let dir = temp_dir();
        std::env::set_var("OLEAFLY_DATA_DIR", &dir);
        let _guard = DataDirGuard;
        assert_eq!(latex_default_engine_choice(), None);
        write_config(&AppConfig::default()).unwrap();
        assert!(!std::fs::read_to_string(config_path().unwrap())
            .unwrap()
            .contains("latex_default_engine"));

        set_latex_default_engine_choice(" latexmk ").unwrap();
        assert_eq!(latex_default_engine_choice().as_deref(), Some("latexmk"));
        set_latex_default_engine_choice("latexmk").unwrap();
        assert_eq!(latex_default_engine_choice().as_deref(), Some("latexmk"));

        let mut incoming = get_config_blocking().unwrap();
        incoming.latex_default_engine = None;
        tauri::async_runtime::block_on(set_config(incoming)).unwrap();
        assert_eq!(latex_default_engine_choice().as_deref(), Some("latexmk"));

        assert!(set_latex_default_engine_choice("pdflatex").is_err());
        assert_eq!(latex_default_engine_choice().as_deref(), Some("latexmk"));

        set_latex_default_engine_choice("tectonic").unwrap();
        assert_eq!(latex_default_engine_choice(), None);
        assert_eq!(read_config().unwrap().latex_default_engine, None);
        std::fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn repointing_a_custom_endpoint_through_set_config_forgets_its_probes() {
        let _env_guard = crate::paths::data_dir_env_lock();
        let dir = temp_dir();
        std::env::set_var("OLEAFLY_DATA_DIR", &dir);
        let _guard = DataDirGuard;
        write_config(&AppConfig {
            ai_custom_providers: vec![custom("local-lab", "http://lab.test/v1")],
            ai_keys: HashMap::from([("local-lab".to_string(), "sk-lab".to_string())]),
            ..AppConfig::default()
        })
        .unwrap();
        update_config(|config| {
            config.ai_model_probes.insert(
                model_probe_key("local-lab", "m"),
                probe(ProbeVerdict::Blocked, 40),
            );
            config.ai_model_probes.insert(
                model_probe_key("openai", "gpt-4o"),
                probe(ProbeVerdict::Verified, 40),
            );
            Ok(())
        })
        .unwrap();
        let mut incoming = get_config_blocking().unwrap();
        assert_eq!(incoming.ai_model_probes.len(), 2);
        incoming.ai_custom_providers[0].base_url = "http://other.test/v1".into();

        tauri::async_runtime::block_on(set_config(incoming)).unwrap();

        let persisted = read_config().unwrap();
        assert!(!persisted
            .ai_model_probes
            .keys()
            .any(|key| key.starts_with("local-lab/")));
        assert_eq!(
            persisted.ai_model_probes[&model_probe_key("openai", "gpt-4o")],
            probe(ProbeVerdict::Verified, 40)
        );
        std::fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn a_custom_provider_keeps_the_names_the_webview_uses() {
        let source = serde_json::json!({
            "id": "lemonade",
            "name": "Lemonade",
            "baseURL": "http://localhost:13305/v1",
            "keyOptional": true
        });
        let provider: CustomProvider = serde_json::from_value(source.clone()).unwrap();
        assert!(provider.key_optional);
        assert_eq!(serde_json::to_value(&provider).unwrap(), source);

        // Files written by earlier builds say `key_optional`.
        let older: CustomProvider = serde_json::from_value(serde_json::json!({
            "id": "lab",
            "name": "Lab",
            "baseURL": "http://lab.test/v1",
            "key_optional": true
        }))
        .unwrap();
        assert!(older.key_optional);
        let json = serde_json::to_string(&older).unwrap();
        assert!(json.contains("\"keyOptional\":true"));
        assert!(!json.contains("key_optional"));
    }

    #[test]
    fn a_custom_provider_carrying_both_spellings_still_loads() {
        // The webview spreads the object an older build wrote, so a save can
        // hand over `key_optional` and `keyOptional` together.
        let provider = |legacy: Option<bool>, current: Option<bool>| -> CustomProvider {
            let mut object = serde_json::json!({
                "id": "lab",
                "name": "Lab",
                "baseURL": "http://lab.test/v1"
            });
            if let Some(value) = legacy {
                object["key_optional"] = value.into();
            }
            if let Some(value) = current {
                object["keyOptional"] = value.into();
            }
            serde_json::from_value(object).unwrap()
        };

        assert!(provider(Some(false), Some(true)).key_optional);
        assert!(provider(Some(true), Some(false)).key_optional);
        assert!(provider(Some(true), None).key_optional);
        assert!(provider(None, Some(true)).key_optional);
        assert!(!provider(Some(false), Some(false)).key_optional);
        assert!(!provider(None, None).key_optional);

        let config: AppConfig = serde_json::from_value(serde_json::json!({
            "ai_custom_providers": [{
                "id": "lab",
                "name": "Lab",
                "baseURL": "http://lab.test/v1",
                "key_optional": false,
                "keyOptional": true
            }]
        }))
        .unwrap();
        assert_eq!(custom_provider_names(&config), vec![("lab", true)]);
    }

    fn custom_provider_names(config: &AppConfig) -> Vec<(&str, bool)> {
        config
            .ai_custom_providers
            .iter()
            .map(|provider| (provider.id.as_str(), provider.key_optional))
            .collect()
    }

    #[test]
    fn a_saved_key_less_provider_stays_key_optional_through_the_webview_round_trip() {
        let _env_guard = crate::paths::data_dir_env_lock();
        let dir = temp_dir();
        std::env::set_var("OLEAFLY_DATA_DIR", &dir);
        let _guard = DataDirGuard;
        write_config(&AppConfig::default()).unwrap();
        // Exactly what the settings view sends for a server added without a key.
        let incoming: AppConfig = serde_json::from_value(serde_json::json!({
            "ai_custom_providers": [{
                "id": "lemonade",
                "name": "Lemonade",
                "baseURL": "http://localhost:13305/v1",
                "keyOptional": true
            }]
        }))
        .unwrap();

        tauri::async_runtime::block_on(set_config(incoming)).unwrap();

        let on_disk: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(config_path().unwrap()).unwrap())
                .unwrap();
        assert_eq!(on_disk["ai_custom_providers"][0]["keyOptional"], true);
        assert_eq!(
            custom_provider_names(&read_config().unwrap()),
            vec![("lemonade", true)]
        );
        let visible = serde_json::to_value(get_config_blocking().unwrap()).unwrap();
        assert_eq!(visible["ai_custom_providers"][0]["keyOptional"], true);
        std::fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn a_provider_with_no_stored_key_loads_as_key_optional_and_one_with_a_key_does_not() {
        let _env_guard = crate::paths::data_dir_env_lock();
        let dir = temp_dir();
        std::env::set_var("OLEAFLY_DATA_DIR", &dir);
        let _guard = DataDirGuard;
        secrets::write_ai_secrets(&HashMap::from([(
            "keyed".to_string(),
            "sk-real".to_string(),
        )]))
        .unwrap();
        // A file the way earlier builds left it: every flag saved as false.
        std::fs::write(
            config_path().unwrap(),
            serde_json::json!({
                "ai_custom_providers": [
                    {"id": "lemonade", "name": "Lemonade", "baseURL": "http://localhost:13305/v1", "key_optional": false},
                    {"id": "keyed", "name": "Keyed", "baseURL": "https://api.keyed.test/v1", "key_optional": false}
                ]
            })
            .to_string(),
        )
        .unwrap();

        let loaded = read_config().unwrap();
        assert_eq!(
            custom_provider_names(&loaded),
            vec![("lemonade", true), ("keyed", false)]
        );
        let visible = serde_json::to_value(get_config_blocking().unwrap()).unwrap();
        assert_eq!(visible["ai_custom_providers"][0]["keyOptional"], true);
        assert_eq!(visible["ai_custom_providers"][1]["keyOptional"], false);
        std::fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn a_stated_key_flag_survives_a_missing_key() {
        let _env_guard = crate::paths::data_dir_env_lock();
        let dir = temp_dir();
        std::env::set_var("OLEAFLY_DATA_DIR", &dir);
        let _guard = DataDirGuard;
        // Settings restored on another machine without their secrets.
        std::fs::write(
            config_path().unwrap(),
            serde_json::json!({
                "ai_custom_providers": [
                    {"id": "corp", "name": "Corp", "baseURL": "https://gw.corp.test/v1", "keyOptional": false},
                    {"id": "lemonade", "name": "Lemonade", "baseURL": "http://localhost:13305/v1", "keyOptional": true}
                ]
            })
            .to_string(),
        )
        .unwrap();

        assert_eq!(
            custom_provider_names(&read_config().unwrap()),
            vec![("corp", false), ("lemonade", true)]
        );
        std::fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn a_save_keeps_the_key_flag_the_settings_view_states() {
        let _env_guard = crate::paths::data_dir_env_lock();
        let dir = temp_dir();
        std::env::set_var("OLEAFLY_DATA_DIR", &dir);
        let _guard = DataDirGuard;
        write_config(&AppConfig::default()).unwrap();
        let mut keyed = custom("keyed", "https://api.keyed.test/v1");
        keyed.key_optional = false;
        tauri::async_runtime::block_on(set_config(AppConfig {
            ai_custom_providers: vec![custom("lemonade", "http://localhost:13305/v1"), keyed],
            ai_keys: HashMap::from([("keyed".to_string(), "sk-real".to_string())]),
            ..AppConfig::default()
        }))
        .unwrap();

        // The file now states both flags, so loading it guesses nothing: a
        // provider that needs a key and has none asks for one.
        let stored = read_config().unwrap();
        assert_eq!(
            custom_provider_names(&stored),
            vec![("lemonade", false), ("keyed", false)]
        );
        // The key stays out of the config file and the keyed provider still has it.
        assert_eq!(
            stored.ai_keys.get("keyed").map(String::as_str),
            Some("sk-real")
        );
        let on_disk = std::fs::read_to_string(config_path().unwrap()).unwrap();
        assert!(!on_disk.contains("sk-real"));
        std::fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn deleting_a_custom_provider_forgets_its_list_refresh_stamp() {
        let stored = AppConfig {
            ai_custom_providers: vec![custom("local-lab", "http://lab.test/v1")],
            ai_model_lists_refreshed_at: BTreeMap::from([
                ("local-lab".to_string(), 30),
                ("openai".to_string(), 20),
            ]),
            ..AppConfig::default()
        };
        // The settings copy no longer lists the provider and does not carry
        // its stamp either.
        let mut incoming = AppConfig {
            ai_model_lists_refreshed_at: BTreeMap::from([("openai".to_string(), 25)]),
            ..AppConfig::default()
        };

        keep_newer_model_trust_records(&mut incoming, &stored);
        drop_stamps_for_removed_providers(&mut incoming);

        assert_eq!(
            incoming.ai_model_lists_refreshed_at,
            BTreeMap::from([("openai".to_string(), 25)])
        );

        // A stale copy that still carries the stamp loses it too, while a
        // provider that is still there keeps its own.
        let mut stale = AppConfig {
            ai_custom_providers: vec![custom("kept", "http://kept.test/v1")],
            ai_model_lists_refreshed_at: BTreeMap::from([
                ("local-lab".to_string(), 30),
                ("kept".to_string(), 7),
                ("openai".to_string(), 25),
            ]),
            ..AppConfig::default()
        };
        keep_newer_model_trust_records(&mut stale, &stored);
        drop_stamps_for_removed_providers(&mut stale);
        assert_eq!(
            stale.ai_model_lists_refreshed_at,
            BTreeMap::from([("kept".to_string(), 7), ("openai".to_string(), 25)])
        );
    }

    #[test]
    fn deleting_a_custom_provider_through_set_config_removes_its_stamp_from_the_file() {
        let _env_guard = crate::paths::data_dir_env_lock();
        let dir = temp_dir();
        std::env::set_var("OLEAFLY_DATA_DIR", &dir);
        let _guard = DataDirGuard;
        write_config(&AppConfig {
            ai_custom_providers: vec![custom("local-lab", "http://lab.test/v1")],
            ai_model_lists_refreshed_at: BTreeMap::from([
                ("local-lab".to_string(), 30),
                ("openai".to_string(), 20),
            ]),
            ..AppConfig::default()
        })
        .unwrap();
        let mut incoming = get_config_blocking().unwrap();
        incoming.ai_custom_providers.clear();

        tauri::async_runtime::block_on(set_config(incoming)).unwrap();

        assert_eq!(
            read_config().unwrap().ai_model_lists_refreshed_at,
            BTreeMap::from([("openai".to_string(), 20)])
        );
        std::fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn loading_forgets_blocked_verdicts_that_were_only_a_failed_attempt() {
        let _env_guard = crate::paths::data_dir_env_lock();
        let dir = temp_dir();
        std::env::set_var("OLEAFLY_DATA_DIR", &dir);
        let _guard = DataDirGuard;
        let with_reason = |verdict, reason: &str| ModelProbe {
            verdict,
            reason: reason.into(),
            probed_at: 5,
        };
        write_config(&AppConfig {
            ai_model_probes: BTreeMap::from([
                (
                    "lab/timed-out".to_string(),
                    with_reason(
                        ProbeVerdict::Blocked,
                        "The model did not answer before the probe timed out.",
                    ),
                ),
                (
                    "lab/refused".to_string(),
                    with_reason(ProbeVerdict::Blocked, "The provider could not be reached."),
                ),
                (
                    "lab/loading".to_string(),
                    with_reason(
                        ProbeVerdict::Blocked,
                        "The provider answered the probe with HTTP 503.",
                    ),
                ),
                (
                    "lab/key".to_string(),
                    with_reason(
                        ProbeVerdict::Blocked,
                        "The provider rejected the credential with HTTP 401.",
                    ),
                ),
                (
                    "lab/no-tools".to_string(),
                    with_reason(
                        ProbeVerdict::Blocked,
                        "The model answered without calling the tool.",
                    ),
                ),
                (
                    "lab/bad-request".to_string(),
                    with_reason(
                        ProbeVerdict::Blocked,
                        "The provider answered the probe with HTTP 400.",
                    ),
                ),
                (
                    "lab/fine".to_string(),
                    with_reason(ProbeVerdict::Verified, "The model called the ping tool."),
                ),
            ]),
            ..AppConfig::default()
        })
        .unwrap();

        let kept: Vec<String> = read_config().unwrap().ai_model_probes.into_keys().collect();

        assert_eq!(kept, vec!["lab/bad-request", "lab/fine", "lab/no-tools"]);
        std::fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn generic_settings_updates_carry_the_git_auto_init_switch() {
        let _env_guard = crate::paths::data_dir_env_lock();
        let dir = temp_dir();
        std::env::set_var("OLEAFLY_DATA_DIR", &dir);
        let _guard = DataDirGuard;
        write_config(&AppConfig::default()).unwrap();
        let mut incoming = get_config_blocking().unwrap();
        assert!(incoming.git_auto_init);
        incoming.github_user = "octocat".to_string();
        incoming.git_auto_init = false;

        tauri::async_runtime::block_on(set_config(incoming)).unwrap();

        let persisted = read_config().unwrap();
        assert_eq!(persisted.github_user, "octocat");
        assert!(!persisted.git_auto_init);
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
        let mut replacement = get_config_blocking().unwrap();
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
        let mut visible = get_config_blocking().unwrap();
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

    // 0.4.8 H: Tools model
    #[test]
    fn old_configs_start_with_the_automatic_local_tools_model() {
        let config: AppConfig = serde_json::from_str("{}").unwrap();
        assert!(config.ai_tools_model.is_none());
        assert!(AppConfig::default().ai_tools_model.is_none());
        assert!(!serde_json::to_string(&AppConfig::default())
            .unwrap()
            .contains("ai_tools_model"));
    }

    #[test]
    fn tools_choices_are_trimmed_and_an_empty_ollama_model_means_automatic() {
        let choice = |provider: &str, model: &str| {
            Some(ToolsModelChoice {
                provider: provider.into(),
                model: model.into(),
            })
        };
        assert_eq!(normalize_tools_choice(None).unwrap(), None);
        assert_eq!(
            normalize_tools_choice(choice("ollama", "  ")).unwrap(),
            None
        );
        assert_eq!(
            normalize_tools_choice(choice(" ollama ", "")).unwrap(),
            None
        );
        assert_eq!(
            normalize_tools_choice(choice(" anthropic ", " claude-opus-5-5 ")).unwrap(),
            choice("anthropic", "claude-opus-5-5")
        );
        assert_eq!(
            normalize_tools_choice(choice("ollama", " glm-ocr:latest ")).unwrap(),
            choice("ollama", "glm-ocr:latest")
        );
        assert!(normalize_tools_choice(choice("", "x")).is_err());
        assert!(normalize_tools_choice(choice("   ", "x")).is_err());
        assert!(normalize_tools_choice(choice("openai\n", "x")).is_err());
        assert!(normalize_tools_choice(choice("openai", "gpt\u{0}")).is_err());
        assert!(normalize_tools_choice(choice("anthropic", " ")).is_err());
        assert!(normalize_tools_choice(choice(&"p".repeat(129), "x")).is_err());
        assert!(normalize_tools_choice(choice(&"p".repeat(128), "x")).is_ok());
        assert!(normalize_tools_choice(choice("openai", &"m".repeat(513))).is_err());
        assert!(normalize_tools_choice(choice("openai", &"m".repeat(512))).is_ok());
    }

    #[test]
    fn the_tools_model_persists_and_settings_writes_from_the_webview_keep_it() {
        let _env_guard = crate::paths::data_dir_env_lock();
        let dir = temp_dir();
        std::env::set_var("OLEAFLY_DATA_DIR", &dir);
        let _guard = DataDirGuard;
        write_config(&AppConfig::default()).unwrap();
        assert!(read_config().unwrap().ai_tools_model.is_none());

        set_ai_tools_model_blocking(Some(ToolsModelChoice {
            provider: " anthropic ".into(),
            model: "claude-opus-5-5".into(),
        }))
        .unwrap();
        let mut incoming = get_config_blocking().unwrap();
        assert_eq!(
            incoming.ai_tools_model.as_ref().unwrap(),
            &ToolsModelChoice {
                provider: "anthropic".into(),
                model: "claude-opus-5-5".into(),
            }
        );

        // A stale whole-config write from the webview cannot drop or change it.
        incoming.ai_tools_model = None;
        tauri::async_runtime::block_on(set_config(incoming.clone())).unwrap();
        assert_eq!(
            read_config().unwrap().ai_tools_model.unwrap().provider,
            "anthropic"
        );
        incoming.ai_tools_model = Some(ToolsModelChoice {
            provider: "openai".into(),
            model: "gpt-6-luna".into(),
        });
        tauri::async_runtime::block_on(set_config(incoming)).unwrap();
        assert_eq!(
            read_config().unwrap().ai_tools_model.unwrap().provider,
            "anthropic"
        );

        assert!(set_ai_tools_model_blocking(Some(ToolsModelChoice {
            provider: "openai\r\n".into(),
            model: "x".into(),
        }))
        .is_err());
        assert_eq!(
            read_config().unwrap().ai_tools_model.unwrap().model,
            "claude-opus-5-5"
        );

        set_ai_tools_model_blocking(None).unwrap();
        assert!(read_config().unwrap().ai_tools_model.is_none());
        assert!(!std::fs::read_to_string(config_path().unwrap())
            .unwrap()
            .contains("ai_tools_model"));
        std::fs::remove_dir_all(dir).ok();
    }
}
