use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;

use crate::paths;

/// App-wide config stored at `~/.openleaf/config.json`.
///
/// NOTE: the GitHub token is stored locally on disk (0600 on Unix). For a
/// future release this should move to the OS keychain (e.g. via
/// `tauri-plugin-keyring`).
#[derive(Serialize, Deserialize, Default, Clone)]
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
}

pub fn config_path() -> Result<PathBuf, String> {
    Ok(paths::openleaf_root()?.join("config.json"))
}

pub fn read_config() -> Result<AppConfig, String> {
    let p = config_path()?;
    if !p.exists() {
        return Ok(AppConfig::default());
    }
    let s = std::fs::read_to_string(&p).map_err(|e| e.to_string())?;
    Ok(serde_json::from_str(&s).unwrap_or_default())
}

pub fn write_config(config: &AppConfig) -> Result<(), String> {
    let p = config_path()?;
    if let Some(parent) = p.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    write_config_at(&p, config)
}

/// Serialize `config` to `path` atomically and (on Unix) with owner-only
/// permissions from the moment the file is created.
///
/// The config holds secrets (GitHub token, AI keys), so it must never be
/// world-readable - not even briefly. The previous approach wrote the file with
/// the default umask and only `chmod 0600` afterwards, leaving a window where
/// another local user could read it. Here we write to a sibling temp file
/// created directly at mode `0600`, then rename it over the target. The rename
/// is atomic, so a concurrent reader also never sees a truncated/partial config.
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

    // `rename` replaces the destination atomically on both Unix and Windows.
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
    Ok(cfg)
}

#[tauri::command]
pub fn set_config(mut config: AppConfig) -> Result<(), String> {
    // The webview never receives the real token (get_config blanks it), so an
    // empty incoming token means "unchanged", not "clear it" - preserve what's
    // on disk. Clearing/setting the token goes through gh_clear_token/gh_set_token.
    if config.github_token.is_empty() {
        config.github_token = read_config()?.github_token;
    }
    // Derived field, never meaningfully persisted.
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
        // No group/other bits at any point - the file is created at 0600.
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
        // No leftover temp file.
        assert!(!dir.join("config.json.tmp").exists());
        std::fs::remove_dir_all(&dir).ok();
    }
}
