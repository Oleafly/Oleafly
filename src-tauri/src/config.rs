use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;

use crate::paths;
use crate::secrets;

/// App-wide config stored at `~/.openleaf/config.json`.
///
/// Secrets (GitHub token, AI API keys, MCP token) prefer the OS keychain via
/// `secrets`. Plaintext values in this file are migrated into the keychain on
/// the next read/write and then blanked on disk. If the keychain is unavailable
/// (headless CI, locked secret service), values remain in the file at mode
/// `0600` as a fallback.
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
    /// Bearer token for the MCP endpoint. Secret: keychain-backed, blanked
    /// before the webview, exactly like `github_token`.
    #[serde(default)]
    pub mcp_token: String,
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
            mcp_enabled: false,
            mcp_port: default_mcp_port(),
            mcp_read_only: false,
            mcp_approval_policy: default_mcp_approval_policy(),
            mcp_token: String::new(),
        }
    }
}

pub fn config_path() -> Result<PathBuf, String> {
    Ok(paths::openleaf_root()?.join("config.json"))
}

/// Read config from disk, hydrate secrets from the keychain, and migrate any
/// plaintext secrets still sitting in the file into the keychain.
pub fn read_config() -> Result<AppConfig, String> {
    let p = config_path()?;
    if !p.exists() {
        return Ok(hydrate_secrets(AppConfig::default()));
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
        || !cfg.mcp_token.is_empty();
    let hydrated = hydrate_secrets(cfg);
    // Best-effort one-shot migrate: only rewrite when the file still held
    // plaintext secrets (avoids keychain I/O on every get_config).
    if needs_migrate {
        let _ = persist_without_plaintext_secrets(&hydrated);
    }
    Ok(hydrated)
}

/// Merge keychain secrets into a config loaded from disk (or defaults).
fn hydrate_secrets(mut cfg: AppConfig) -> AppConfig {
    cfg.github_token = secrets::resolve_secret(secrets::github_token_account(), &cfg.github_token);
    cfg.mcp_token = secrets::resolve_secret(secrets::mcp_token_account(), &cfg.mcp_token);
    let providers: Vec<String> = cfg
        .ai_keys
        .keys()
        .cloned()
        .chain(
            [
                "openai",
                "anthropic",
                "groq",
                "openrouter",
                "deepseek",
                "mistral",
                "xai",
                "zai",
                "ollama",
            ]
            .into_iter()
            .map(String::from),
        )
        .collect::<std::collections::HashSet<_>>()
        .into_iter()
        .collect();
    for provider in providers {
        let acct = secrets::ai_key_account(&provider);
        let from_file = cfg.ai_keys.get(&provider).cloned().unwrap_or_default();
        let resolved = secrets::resolve_secret(&acct, &from_file);
        if !resolved.is_empty() {
            cfg.ai_keys.insert(provider, resolved);
        }
    }
    if !cfg.ai_api_key.is_empty() || secrets::get_secret("ai_api_key").is_some() {
        cfg.ai_api_key = secrets::resolve_secret("ai_api_key", &cfg.ai_api_key);
    }
    cfg
}

/// Write secrets to the keychain and persist a redacted config to disk.
pub fn write_config(config: &AppConfig) -> Result<(), String> {
    let p = config_path()?;
    if let Some(parent) = p.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let _ = secrets::set_secret(secrets::github_token_account(), &config.github_token);
    let _ = secrets::set_secret(secrets::mcp_token_account(), &config.mcp_token);
    for (provider, key) in &config.ai_keys {
        let _ = secrets::set_secret(&secrets::ai_key_account(provider), key);
    }
    if !config.ai_api_key.is_empty() {
        let _ = secrets::set_secret("ai_api_key", &config.ai_api_key);
    }
    persist_without_plaintext_secrets(config)
}

/// Serialize config with secrets blanked (when keychain accepted them) or
/// retained (keychain fallback). Always mode `0600`.
fn persist_without_plaintext_secrets(config: &AppConfig) -> Result<(), String> {
    let mut disk = config.clone();
    disk.github_token =
        secrets::migrate_to_keyring(secrets::github_token_account(), &config.github_token);
    // If migrate returned empty, keychain has it; keep empty. If non-empty,
    // keyring failed and we must keep plaintext on disk.
    if disk.github_token.is_empty() && !config.github_token.is_empty() {
        // Confirm the keychain actually has it; if not, keep the plaintext fallback.
        if secrets::get_secret(secrets::github_token_account()).is_none() {
            disk.github_token = config.github_token.clone();
        }
    }
    disk.mcp_token = secrets::migrate_to_keyring(secrets::mcp_token_account(), &config.mcp_token);
    if disk.mcp_token.is_empty()
        && !config.mcp_token.is_empty()
        && secrets::get_secret(secrets::mcp_token_account()).is_none()
    {
        disk.mcp_token = config.mcp_token.clone();
    }
    let mut redacted_keys = HashMap::new();
    for (provider, key) in &config.ai_keys {
        let acct = secrets::ai_key_account(provider);
        let kept = secrets::migrate_to_keyring(&acct, key);
        if !kept.is_empty() {
            redacted_keys.insert(provider.clone(), kept);
        } else if !key.is_empty() && secrets::get_secret(&acct).is_none() {
            redacted_keys.insert(provider.clone(), key.clone());
        }
    }
    disk.ai_keys = redacted_keys;
    disk.ai_api_key = {
        let kept = secrets::migrate_to_keyring("ai_api_key", &config.ai_api_key);
        if !kept.is_empty() {
            kept
        } else if !config.ai_api_key.is_empty() && secrets::get_secret("ai_api_key").is_none() {
            config.ai_api_key.clone()
        } else {
            String::new()
        }
    };
    disk.github_connected = false;
    write_config_at(&config_path()?, &disk)
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
    // Owner-only (unix created it 0600; this also covers Windows, where the file
    // may hold keychain-fallback secrets). The rename preserves the ACL/mode.
    crate::fsperm::harden_file(&tmp);

    std::fs::rename(&tmp, path).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        format!("failed to replace config: {e}")
    })
}

#[tauri::command]
pub fn get_config() -> Result<AppConfig, String> {
    let mut cfg = read_config()?;
    // Never expose the GitHub push token to the webview; report only presence.
    // (The AI keys stay, since the frontend calls those providers directly.)
    cfg.github_connected = !cfg.github_token.is_empty();
    cfg.github_token = String::new();
    // Same for the MCP bearer token: only `mcp_connection_info` may hand it
    // to the webview (for Settings copy buttons while the server is running).
    cfg.mcp_token = String::new();
    Ok(cfg)
}

#[tauri::command]
pub fn set_config(mut config: AppConfig) -> Result<(), String> {
    // The webview never receives the real token (get_config blanks it), so an
    // empty incoming token means "unchanged", not "clear it" - preserve what's
    // stored (keychain or disk). Clearing goes through gh_clear_token.
    if config.github_token.is_empty() {
        config.github_token = read_config()?.github_token;
    }
    if config.mcp_token.is_empty() {
        config.mcp_token = read_config()?.mcp_token;
    }
    config.github_connected = false;
    write_config(&config)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir() -> std::path::PathBuf {
        use std::sync::atomic::{AtomicU64, Ordering};
        static COUNTER: AtomicU64 = AtomicU64::new(0);
        let n = COUNTER.fetch_add(1, Ordering::Relaxed);
        let d = std::env::temp_dir().join(format!("openleaf-cfg-{}-{n}", std::process::id()));
        std::fs::create_dir_all(&d).unwrap();
        d
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
}
