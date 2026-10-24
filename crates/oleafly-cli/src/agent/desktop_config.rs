//! The desktop app's settings, read the way the app reads them, for the
//! headless agent and the background helper: the AI providers and keys
//! (`config.json` plus the encrypted secret store), the user's MCP servers
//! with their stored values, connector keys and the research preferences.
//!
//! This is read-only. A config the app would call corrupt is an error here
//! too; nothing is migrated or written.
use std::collections::{BTreeMap, HashMap};
use std::fs::OpenOptions;
use std::path::Path;
use std::time::Duration;

use oleafly_secrets::{SecretFile, SecretStore};
use serde::Deserialize;
use serde_json::Value;
use zeroize::Zeroizing;

const CONFIG_FILE: &str = "config.json";
const LOCK_FILE: &str = ".config-store.lock";
const LOCK_BUDGET: Duration = Duration::from_secs(5);
const MAX_CONFIG_BYTES: u64 = 4 * 1024 * 1024;

/// The marker the app writes in place of a stored MCP value.
const STORED: &str = "__stored__";
const STORED_PREFIX: &str = "__stored__:";
const STORED_REFERENCE_PREFIX: &str = "__stored__:v1:";
/// Connector ids that hold a web search key, in the order runs prefer them.
const SEARCH_KEY_IDS: [&str; 3] = ["brave-search", "tavily", "serper"];

/// The app's settings that the agent and the helper use.
pub struct DesktopConfig {
    pub ai: oleafly_agent::ProviderConfig,
    /// `(provider, model)` → the metadata stored with an enabled model.
    pub stored_metadata: BTreeMap<(String, String), Value>,
    /// Enabled MCP servers, with their stored values filled in.
    pub mcp_servers: Vec<McpServer>,
    /// Names of the MCP servers research tasks may use.
    pub task_mcp_servers: Vec<String>,
    pub prefs: Prefs,
    /// Connector keys (`openalex-api-key`, `brave-search`, …).
    pub connector: BTreeMap<String, Zeroizing<String>>,
}

impl std::fmt::Debug for DesktopConfig {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("DesktopConfig")
            .field("provider", &self.ai.provider)
            .field("model", &self.ai.model)
            .field(
                "providers_with_keys",
                &self.ai.keys.keys().collect::<Vec<_>>(),
            )
            .field(
                "custom_providers",
                &self
                    .ai
                    .custom
                    .iter()
                    .map(|custom| &custom.id)
                    .collect::<Vec<_>>(),
            )
            .field(
                "mcp_servers",
                &self
                    .mcp_servers
                    .iter()
                    .map(|server| &server.name)
                    .collect::<Vec<_>>(),
            )
            .field("task_mcp_servers", &self.task_mcp_servers)
            .field("prefs", &self.prefs)
            .field("connectors", &self.connector.keys().collect::<Vec<_>>())
            .finish()
    }
}

impl DesktopConfig {
    /// No providers, no servers, the default preferences.
    pub fn empty() -> Self {
        Self {
            ai: oleafly_agent::ProviderConfig::default(),
            stored_metadata: BTreeMap::new(),
            mcp_servers: Vec::new(),
            task_mcp_servers: Vec::new(),
            prefs: Prefs::default(),
            connector: BTreeMap::new(),
        }
    }
}

#[derive(Clone)]
pub struct McpServer {
    pub name: String,
    pub transport: McpTransport,
}

impl std::fmt::Debug for McpServer {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("McpServer")
            .field("name", &self.name)
            .finish_non_exhaustive()
    }
}

#[derive(Clone)]
pub enum McpTransport {
    Stdio {
        command: String,
        args: Vec<String>,
        env: BTreeMap<String, String>,
    },
    Remote {
        url: String,
        headers: BTreeMap<String, String>,
    },
}

/// The research preferences the helper follows.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Prefs {
    /// "Keep tasks running after Oleafly closes" (Settings › Research).
    pub background_enabled: bool,
    /// Start the helper when the user signs in.
    pub background_at_login: bool,
    pub keep_awake: bool,
    pub notifications: bool,
}

impl Default for Prefs {
    fn default() -> Self {
        Self {
            background_enabled: true,
            background_at_login: false,
            keep_awake: true,
            notifications: true,
        }
    }
}

#[derive(Debug)]
pub enum ConfigError {
    /// `config.json` does not parse (the app refuses it too).
    Corrupt(String),
    Unreadable(String),
    /// The app is writing its settings right now.
    Locked,
}

impl std::fmt::Display for ConfigError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Corrupt(reason) => write!(formatter, "config.json is corrupt: {reason}"),
            Self::Unreadable(reason) => {
                write!(formatter, "Oleafly's settings could not be read: {reason}")
            }
            Self::Locked => formatter.write_str(
                "The Oleafly app is saving its settings right now. Try again in a moment.",
            ),
        }
    }
}

impl std::error::Error for ConfigError {}

impl From<ConfigError> for crate::contract::CliError {
    fn from(error: ConfigError) -> Self {
        use crate::contract::{CliError, ErrorKind};
        match &error {
            ConfigError::Locked => {
                CliError::new(ErrorKind::Conflict, "config.busy", error.to_string()).retryable()
            }
            ConfigError::Corrupt(_) => {
                CliError::new(ErrorKind::Io, "config.corrupt", error.to_string())
                    .hint("Open Oleafly once so it can repair its settings, then try again.")
            }
            ConfigError::Unreadable(_) => {
                CliError::new(ErrorKind::Io, "config.unreadable", error.to_string())
            }
        }
    }
}

fn yes() -> bool {
    true
}

#[derive(Deserialize)]
#[serde(default)]
struct RawConfig {
    ai_api_key: String,
    ai_provider: String,
    ai_model: String,
    ai_keys: HashMap<String, String>,
    ai_provider_models: HashMap<String, Vec<RawModel>>,
    ai_custom_providers: Vec<RawCustomProvider>,
    mcp_servers: Vec<RawMcpServer>,
    research_task_mcp_servers: Vec<String>,
    #[serde(default = "yes")]
    research_background_enabled: bool,
    research_background_at_login: bool,
    #[serde(default = "yes")]
    research_keep_awake: bool,
    #[serde(default = "yes")]
    research_notifications: bool,
}

impl Default for RawConfig {
    fn default() -> Self {
        Self {
            ai_api_key: String::new(),
            ai_provider: String::new(),
            ai_model: String::new(),
            ai_keys: HashMap::new(),
            ai_provider_models: HashMap::new(),
            ai_custom_providers: Vec::new(),
            mcp_servers: Vec::new(),
            research_task_mcp_servers: Vec::new(),
            research_background_enabled: true,
            research_background_at_login: false,
            research_keep_awake: true,
            research_notifications: true,
        }
    }
}

#[derive(Deserialize)]
struct RawModel {
    id: String,
    #[serde(default = "yes")]
    enabled: bool,
    #[serde(default)]
    metadata: Option<Value>,
}

#[derive(Deserialize)]
struct RawCustomProvider {
    id: String,
    #[serde(rename = "baseURL", default)]
    base_url: String,
    #[serde(default)]
    key_optional: bool,
}

#[derive(Deserialize)]
#[serde(tag = "transport", rename_all = "snake_case")]
enum RawTransport {
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

#[derive(Deserialize)]
struct RawMcpServer {
    name: String,
    #[serde(default = "yes")]
    enabled: bool,
    #[serde(flatten)]
    transport: RawTransport,
}

/// The app's key for a stored MCP value: `{len}:{server}:{kind}:{field}`.
pub(crate) fn mcp_secret_key(server: &str, kind: &str, field: &str) -> String {
    format!("{}:{server}:{kind}:{field}", server.len())
}

fn is_reference(value: &str) -> bool {
    value
        .strip_prefix(STORED_REFERENCE_PREFIX)
        .is_some_and(|id| {
            id.len() == 64
                && id
                    .bytes()
                    .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
        })
}

/// Replaces the app's stored-value markers with the stored values. An error
/// names the server and the field, never a value.
pub(crate) fn hydrate_mcp_values(
    server: &str,
    kind: &str,
    values: &mut BTreeMap<String, String>,
    stored: &HashMap<String, String>,
) -> Result<(), String> {
    for (field, value) in values.iter_mut() {
        let reference = if value == STORED {
            Some(mcp_secret_key(server, kind, field))
        } else if value.starts_with(STORED_PREFIX) {
            if !is_reference(value) {
                return Err(format!(
                    "Stored MCP value for server '{server}' field '{field}' is invalid. Re-enter it in Oleafly and try again."
                ));
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
            .ok_or_else(|| {
                format!("Stored MCP value for server '{server}' field '{field}' is missing. Re-enter it in Oleafly and try again.")
            })?;
    }
    Ok(())
}

/// Holds the app's config lock (shared) while the settings are read.
struct ReadLock {
    _file: std::fs::File,
}

fn lock_for_reading(root: &Path) -> Result<Option<ReadLock>, ConfigError> {
    let path = root.join(LOCK_FILE);
    match std::fs::symlink_metadata(&path) {
        Ok(metadata) if metadata.file_type().is_symlink() => {
            return Err(ConfigError::Unreadable("the config lock is a link".into()))
        }
        Ok(_) => {}
        // No lock file: the app has never written its settings here.
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(ConfigError::Unreadable(error.to_string())),
    }
    let file = OpenOptions::new()
        .read(true)
        .write(true)
        .open(&path)
        .map_err(|error| ConfigError::Unreadable(error.to_string()))?;
    oleafly_core::locking::lock_file(&file, true, LOCK_BUDGET).map_err(|error| {
        if error.kind() == std::io::ErrorKind::TimedOut {
            ConfigError::Locked
        } else {
            ConfigError::Unreadable(error.to_string())
        }
    })?;
    Ok(Some(ReadLock { _file: file }))
}

fn read_raw(root: &Path) -> Result<RawConfig, ConfigError> {
    let path = root.join(CONFIG_FILE);
    let metadata = match std::fs::symlink_metadata(&path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(RawConfig::default())
        }
        Err(error) => return Err(ConfigError::Unreadable(error.to_string())),
    };
    if !metadata.is_file() {
        return Err(ConfigError::Unreadable(
            "config.json isn't a regular file".into(),
        ));
    }
    if metadata.len() > MAX_CONFIG_BYTES {
        return Err(ConfigError::Unreadable(
            "config.json is larger than 4 MiB".into(),
        ));
    }
    let text = std::fs::read_to_string(&path)
        .map_err(|error| ConfigError::Unreadable(error.to_string()))?;
    serde_json::from_str(&text).map_err(|error| ConfigError::Corrupt(error.to_string()))
}

fn read_secrets(
    store: &SecretStore,
    file: SecretFile,
) -> Result<HashMap<String, String>, ConfigError> {
    store.read(file).map_err(ConfigError::Unreadable)
}

/// Reads the app's settings under `root` (the data folder). A missing data
/// folder gives the defaults and is not created.
/// Only the helper's choices from the app's settings (no secrets are
/// read), for the helper to follow changes while it runs.
pub fn load_prefs(root: &Path) -> Result<Prefs, ConfigError> {
    if !root.exists() {
        return Ok(Prefs::default());
    }
    let raw = {
        let _lock = lock_for_reading(root)?;
        read_raw(root)?
    };
    Ok(Prefs {
        background_enabled: raw.research_background_enabled,
        background_at_login: raw.research_background_at_login,
        keep_awake: raw.research_keep_awake,
        notifications: raw.research_notifications,
    })
}

pub fn load(root: &Path) -> Result<DesktopConfig, ConfigError> {
    if !root.exists() {
        return Ok(DesktopConfig::empty());
    }
    let (raw, ai_secrets, mcp_secrets, connector) = {
        let _lock = lock_for_reading(root)?;
        let raw = read_raw(root)?;
        let store = SecretStore::at(root);
        (
            raw,
            read_secrets(&store, SecretFile::Ai)?,
            read_secrets(&store, SecretFile::McpServer)?,
            read_secrets(&store, SecretFile::Connector)?,
        )
    };
    let mut legacy_key = raw.ai_api_key.clone();
    let mut keys: BTreeMap<String, String> = raw.ai_keys.into_iter().collect();
    for (provider, value) in ai_secrets {
        if provider == "__legacy__" {
            if legacy_key.is_empty() {
                legacy_key = value;
            }
        } else {
            keys.insert(provider, value);
        }
    }
    let mut stored_metadata = BTreeMap::new();
    let enabled_models = raw
        .ai_provider_models
        .iter()
        .map(|(provider, models)| {
            for model in models {
                if let Some(metadata) = model
                    .metadata
                    .as_ref()
                    .filter(|metadata| metadata.is_object())
                {
                    stored_metadata.insert((provider.clone(), model.id.clone()), metadata.clone());
                }
            }
            (
                provider.clone(),
                models
                    .iter()
                    .filter(|model| model.enabled && !model.id.trim().is_empty())
                    .map(|model| model.id.clone())
                    .collect(),
            )
        })
        .collect();
    let ai = oleafly_agent::ProviderConfig {
        provider: raw.ai_provider,
        model: raw.ai_model,
        legacy_key,
        keys,
        enabled_models,
        custom: raw
            .ai_custom_providers
            .into_iter()
            .map(|custom| oleafly_agent::CustomProvider {
                id: custom.id,
                base_url: custom.base_url,
                key_optional: custom.key_optional,
            })
            .collect(),
    };
    let mut mcp_servers = Vec::new();
    for server in raw.mcp_servers.into_iter().filter(|server| server.enabled) {
        let transport = match server.transport {
            RawTransport::Stdio {
                command,
                args,
                mut env,
            } => {
                hydrate_mcp_values(&server.name, "env", &mut env, &mcp_secrets)
                    .map_err(ConfigError::Unreadable)?;
                McpTransport::Stdio { command, args, env }
            }
            RawTransport::Remote { url, mut headers } => {
                hydrate_mcp_values(&server.name, "header", &mut headers, &mcp_secrets)
                    .map_err(ConfigError::Unreadable)?;
                McpTransport::Remote { url, headers }
            }
        };
        mcp_servers.push(McpServer {
            name: server.name,
            transport,
        });
    }
    Ok(DesktopConfig {
        ai,
        stored_metadata,
        mcp_servers,
        task_mcp_servers: raw.research_task_mcp_servers,
        prefs: Prefs {
            background_enabled: raw.research_background_enabled,
            background_at_login: raw.research_background_at_login,
            keep_awake: raw.research_keep_awake,
            notifications: raw.research_notifications,
        },
        connector: connector
            .into_iter()
            .map(|(name, value)| (name, Zeroizing::new(value)))
            .collect(),
    })
}

/// Every credential the config holds, so output and logs can hide them:
/// provider keys, MCP env and header values, connector keys.
pub fn secret_values(config: &DesktopConfig) -> Vec<String> {
    let mut values: Vec<String> = config.ai.keys.values().cloned().collect();
    values.push(config.ai.legacy_key.clone());
    for server in &config.mcp_servers {
        match &server.transport {
            McpTransport::Stdio { env, .. } => values.extend(env.values().cloned()),
            McpTransport::Remote { headers, .. } => {
                for value in headers.values() {
                    values.push(value.clone());
                    if let Some(token) = value
                        .strip_prefix("Bearer ")
                        .or_else(|| value.strip_prefix("bearer "))
                    {
                        values.push(token.to_string());
                    }
                }
            }
        }
    }
    values.extend(config.connector.values().map(|value| value.to_string()));
    let mut values: Vec<String> = values
        .into_iter()
        .map(|value| value.trim().to_string())
        // Short values (a port, "1") would hide ordinary text.
        .filter(|value| value.len() >= 6)
        .collect();
    values.sort_by_key(|value| std::cmp::Reverse(value.len()));
    values.dedup();
    values
}

/// The first configured web search key: Brave, then Tavily, then Serper.
pub fn search_key_from(
    connector: &BTreeMap<String, Zeroizing<String>>,
) -> Option<oleafly_agent::tools::web::SearchKey> {
    use oleafly_agent::tools::web::SearchKey;
    SEARCH_KEY_IDS.iter().find_map(|id| {
        let key = connector.get(*id)?.trim().to_string();
        if key.is_empty() {
            return None;
        }
        Some(match *id {
            "brave-search" => SearchKey::Brave(key),
            "tavily" => SearchKey::Tavily(key),
            _ => SearchKey::Serper(key),
        })
    })
}

fn snapshot_entry(path: &Path, provider: &str, model: &str) -> Option<Value> {
    let metadata = std::fs::metadata(path).ok()?;
    if !metadata.is_file() || metadata.len() > 32 * 1024 * 1024 {
        return None;
    }
    let document: Value = serde_json::from_slice(&std::fs::read(path).ok()?).ok()?;
    let models = document.get("providers")?.get(provider)?;
    models
        .get(model)
        .or_else(|| {
            // Google model ids may carry a `models/` prefix.
            (provider == "google")
                .then(|| model.strip_prefix("models/"))
                .flatten()
                .and_then(|stripped| models.get(stripped))
        })
        .filter(|entry| entry.is_object())
        .cloned()
}

/// The model's metadata entry (context window, prices): the app's metadata
/// snapshot (its downloaded copy, then the installed app's bundled one),
/// else the metadata stored with the model in the settings, as the app
/// looks it up.
pub fn model_entry(
    root: &Path,
    config: &DesktopConfig,
    provider: &str,
    model: &str,
) -> Option<Value> {
    snapshot_entry(
        &root.join("catalogs").join("model-metadata.json"),
        provider,
        model,
    )
    .or_else(|| {
        crate::app_paths::installed_app()
            .and_then(|app| app.resources_dir)
            .and_then(|resources| {
                snapshot_entry(&resources.join("model-metadata.json"), provider, model)
            })
    })
    .or_else(|| {
        config
            .stored_metadata
            .get(&(provider.to_string(), model.to_string()))
            .cloned()
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::{tempdir, TempDir};

    fn data_root_with(config: &str) -> TempDir {
        let root = tempdir().unwrap();
        std::fs::write(root.path().join(CONFIG_FILE), config).unwrap();
        root
    }

    #[test]
    fn a_0_4_7_config_loads_with_the_defaults() {
        let root = data_root_with(r#"{"ai_provider":"openai","ai_model":"gpt-6.1-sol"}"#);
        let config = load(root.path()).unwrap();
        assert_eq!(
            config.prefs,
            Prefs {
                background_enabled: true,
                background_at_login: false,
                keep_awake: true,
                notifications: true
            }
        );
        assert_eq!(config.ai.provider, "openai");
        assert_eq!(config.ai.model, "gpt-6.1-sol");
    }

    #[test]
    fn a_corrupt_config_is_an_error_not_an_empty_config() {
        let root = data_root_with("{");
        assert!(matches!(load(root.path()), Err(ConfigError::Corrupt(_))));
        assert!(load(root.path())
            .unwrap_err()
            .to_string()
            .starts_with("config.json is corrupt"));
    }

    #[test]
    fn a_missing_data_folder_is_not_created() {
        let parent = tempdir().unwrap();
        let root = parent.path().join("none");
        load(&root).unwrap();
        assert!(!root.exists());
    }

    #[test]
    fn stored_keys_merge_over_plaintext_keys_and_fill_the_legacy_key() {
        let root = data_root_with(
            r#"{"ai_provider":"openai","ai_keys":{"openai":"sk-plain","groq":"gsk-plain-1"}}"#,
        );
        SecretStore::at(root.path())
            .write(
                SecretFile::Ai,
                &HashMap::from([
                    ("openai".to_string(), "sk-stored-1".to_string()),
                    ("__legacy__".to_string(), "sk-legacy-0".to_string()),
                ]),
            )
            .unwrap();
        let config = load(root.path()).unwrap();
        assert_eq!(config.ai.keys["openai"], "sk-stored-1");
        assert_eq!(config.ai.keys["groq"], "gsk-plain-1");
        assert_eq!(config.ai.legacy_key, "sk-legacy-0");
    }

    #[test]
    fn mcp_markers_hydrate_from_the_encrypted_store() {
        let reference = format!("__stored__:v1:{}", "a".repeat(64));
        let mut env = BTreeMap::from([
            ("TOKEN".to_string(), "__stored__".to_string()),
            ("OTHER".to_string(), reference.clone()),
            ("PLAIN".to_string(), "plain".to_string()),
        ]);
        let stored = HashMap::from([
            (mcp_secret_key("zotero", "env", "TOKEN"), "t1".to_string()),
            (reference, "t2".to_string()),
        ]);
        hydrate_mcp_values("zotero", "env", &mut env, &stored).unwrap();
        assert_eq!(
            (
                env["TOKEN"].as_str(),
                env["OTHER"].as_str(),
                env["PLAIN"].as_str()
            ),
            ("t1", "t2", "plain")
        );
    }

    #[test]
    fn an_invalid_marker_names_the_field_and_never_the_value() {
        let mut env = BTreeMap::from([("TOKEN".to_string(), "__stored__:v1:XYZ".to_string())]);
        let error = hydrate_mcp_values("zotero", "env", &mut env, &HashMap::new()).unwrap_err();
        assert!(
            error.contains("TOKEN") && error.contains("zotero") && !error.contains("XYZ"),
            "{error}"
        );
    }

    #[test]
    fn enabled_mcp_servers_load_with_their_stored_values() {
        let root = data_root_with(
            r#"{"mcp_servers":[
                {"name":"zotero","transport":"stdio","command":"npx","args":["zotero-mcp"],"env":{"TOKEN":"__stored__"}},
                {"name":"off","enabled":false,"transport":"remote","url":"https://example.org/mcp"},
                {"name":"search","transport":"remote","url":"https://example.org/mcp","headers":{"Authorization":"Bearer abcdef123456"}}
            ]}"#,
        );
        SecretStore::at(root.path())
            .write(
                SecretFile::McpServer,
                &HashMap::from([(
                    mcp_secret_key("zotero", "env", "TOKEN"),
                    "zotero-secret-1".to_string(),
                )]),
            )
            .unwrap();
        let config = load(root.path()).unwrap();
        let names: Vec<&str> = config
            .mcp_servers
            .iter()
            .map(|server| server.name.as_str())
            .collect();
        assert_eq!(names, ["zotero", "search"]);
        let secrets = secret_values(&config);
        assert!(secrets.contains(&"zotero-secret-1".to_string()));
        assert!(secrets.contains(&"abcdef123456".to_string()));
    }

    #[test]
    fn debug_output_never_contains_secrets() {
        let root = data_root_with(
            r#"{"ai_provider":"openai","ai_keys":{"openai":"sk-test-123"},
                "mcp_servers":[{"name":"s","transport":"stdio","command":"x","env":{"TOKEN":"mcp-env-secret"}}]}"#,
        );
        SecretStore::at(root.path())
            .write(
                SecretFile::Connector,
                &HashMap::from([("tavily".to_string(), "tvly-secret-1".to_string())]),
            )
            .unwrap();
        let config = load(root.path()).unwrap();
        let text = format!("{config:?}");
        for secret in ["sk-test-123", "mcp-env-secret", "tvly-secret-1"] {
            assert!(!text.contains(secret), "{text}");
        }
        assert!(text.contains("openai"));
    }

    #[test]
    fn a_data_root_with_spaces_and_accents_loads() {
        let parent = tempdir().unwrap();
        let root = parent.path().join("Zoë Müller data");
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(root.join(CONFIG_FILE), r#"{"ai_provider":"anthropic"}"#).unwrap();
        assert_eq!(load(&root).unwrap().ai.provider, "anthropic");
    }

    #[test]
    fn search_keys_prefer_brave_then_tavily_then_serper() {
        use oleafly_agent::tools::web::SearchKey;
        let all = BTreeMap::from([
            ("serper".to_string(), Zeroizing::new("s".to_string())),
            ("tavily".to_string(), Zeroizing::new(" t ".to_string())),
            ("brave-search".to_string(), Zeroizing::new(String::new())),
        ]);
        assert_eq!(search_key_from(&all), Some(SearchKey::Tavily("t".into())));
        assert_eq!(search_key_from(&BTreeMap::new()), None);
    }

    #[test]
    fn model_entries_come_from_the_downloaded_snapshot_then_the_stored_metadata() {
        let root = data_root_with(
            r#"{"ai_provider_models":{"ollama":[{"id":"llama3.2","name":"Llama","metadata":{"contextWindow":8192}}]}}"#,
        );
        std::fs::create_dir_all(root.path().join("catalogs")).unwrap();
        std::fs::write(
            root.path().join("catalogs/model-metadata.json"),
            r#"{"schemaVersion":1,"providers":{"anthropic":{"claude-fable-5":{"contextWindow":1000000,"cost":{"input":10,"output":50}}}}}"#,
        )
        .unwrap();
        let config = load(root.path()).unwrap();
        assert_eq!(
            model_entry(root.path(), &config, "anthropic", "claude-fable-5").unwrap()
                ["contextWindow"],
            1_000_000
        );
        assert_eq!(
            model_entry(root.path(), &config, "ollama", "llama3.2").unwrap()["contextWindow"],
            8192
        );
        assert!(model_entry(root.path(), &config, "openai", "missing").is_none());
    }

    #[test]
    fn the_background_switches_are_read() {
        let root = data_root_with(
            r#"{"research_background_enabled":false,"research_background_at_login":true}"#,
        );
        let prefs = load(root.path()).unwrap().prefs;
        assert!(!prefs.background_enabled && prefs.background_at_login);
        // The helper reads them again without the secrets.
        assert_eq!(load_prefs(root.path()).unwrap(), prefs);
        let quiet =
            data_root_with(r#"{"research_notifications":false,"research_keep_awake":false}"#);
        let prefs = load_prefs(quiet.path()).unwrap();
        assert!(!prefs.notifications && !prefs.keep_awake);
    }
}
