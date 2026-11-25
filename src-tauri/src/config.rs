use serde::{Deserialize, Serialize};
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

fn default_true() -> bool {
    true
}

#[derive(Serialize, Deserialize, Clone)]
pub struct AppConfig {
    #[serde(default)]
    pub github_token: String,
    #[serde(default)]
    pub github_user: String,
    #[serde(default)]
    pub github_connected: bool,

    #[serde(default)]
    pub notes_starter_note_created: bool,
    #[serde(default = "default_true")]
    pub checkpoints_enabled: bool,
    #[serde(default = "default_true")]
    pub checkpoint_notifications: bool,
    #[serde(default = "default_true")]
    pub git_auto_init: bool,

    #[serde(default = "default_ui_locale")]
    pub ui_locale: String,
    #[serde(default)]
    pub cli_settings_revision: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub typst_default_version: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub latex_default_engine: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tex_distribution: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub download_source: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub download_mirror_url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tex_package_repository: Option<String>,

    #[serde(default)]
    pub phitex_enabled: bool,
}

fn default_ui_locale() -> String {
    "system".into()
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            github_token: String::new(),
            github_user: String::new(),
            github_connected: false,

            notes_starter_note_created: false,
            checkpoints_enabled: true,
            checkpoint_notifications: true,
            git_auto_init: true,

            ui_locale: default_ui_locale(),
            cli_settings_revision: 0,
            typst_default_version: None,
            latex_default_engine: None,
            tex_distribution: None,
            download_source: None,
            download_mirror_url: None,
            tex_package_repository: None,

            phitex_enabled: false,
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
    let path = config_path()?;
    if !path.exists() {
        return hydrate_secrets(AppConfig::default());
    }
    let text = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    // Serde ignores retired AI settings when opening an existing installation.
    let config: AppConfig =
        serde_json::from_str(&text).map_err(|e| format!("config.json is corrupt: {e}"))?;
    let migrate = !config.github_token.is_empty();
    let config = hydrate_secrets(config)?;
    if migrate {
        persist_without_plaintext_secrets_unlocked(&config)?;
    }
    Ok(config)
}

fn hydrate_secrets(mut cfg: AppConfig) -> Result<AppConfig, String> {
    cfg.github_token = secrets::resolve_secret(secrets::github_token_account(), &cfg.github_token)?;
    Ok(cfg)
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
    secrets::set_secrets(&[(secrets::github_token_account(), &config.github_token)])?;
    let mut disk = config.clone();
    disk.github_token.clear();
    disk.github_connected = false;
    write_config_at(&config_path()?, &disk)
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

fn stored_value(key: &str) -> Option<serde_json::Value> {
    let text = std::fs::read_to_string(config_path().ok()?).ok()?;
    serde_json::from_str::<serde_json::Value>(&text)
        .ok()?
        .get(key)
        .cloned()
}

fn stored_text(key: &str) -> Option<String> {
    stored_value(key)?
        .as_str()
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .map(str::to_owned)
}

pub(crate) fn typst_default_choice() -> Option<String> {
    stored_text("typst_default_version")
}

pub(crate) fn set_typst_default_choice(version: Option<String>) -> Result<(), String> {
    update_config(|config| {
        config.typst_default_version = version
            .map(|version| version.trim().to_owned())
            .filter(|version| !version.is_empty());
        Ok(())
    })
}

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

pub(crate) fn tex_distribution_choice() -> Option<String> {
    stored_text("tex_distribution")
}

pub(crate) fn phitex_enabled() -> bool {
    stored_value("phitex_enabled").and_then(|value| value.as_bool()) == Some(true)
}

pub(crate) fn set_phitex_enabled(enabled: bool) -> Result<(), String> {
    update_config(|config| {
        config.phitex_enabled = enabled;
        Ok(())
    })
}

pub(crate) fn set_tex_distribution_choice(bin_dir: Option<String>) -> Result<(), String> {
    if tex_distribution_choice() == bin_dir {
        return Ok(());
    }
    update_config(|config| {
        config.tex_distribution = bin_dir;
        Ok(())
    })
}

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

    let replaced = crate::sandbox::replace_file(&tmp, path).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        format!("failed to replace config: {e}")
    });
    replaced
}

#[tauri::command]
pub async fn get_config() -> Result<AppConfig, String> {
    tauri::async_runtime::spawn_blocking(get_config_blocking)
        .await
        .map_err(|error| format!("failed to read settings: {error}"))?
}

pub fn get_config_blocking() -> Result<AppConfig, String> {
    let mut config = read_config()?;
    config.github_connected = !config.github_token.is_empty();
    config.github_token.clear();
    Ok(config)
}

#[tauri::command]
pub async fn claim_starter_note() -> Result<bool, String> {
    if cfg!(feature = "e2e-testing") {
        return Ok(false);
    }
    tauri::async_runtime::spawn_blocking(claim_starter_note_blocking)
        .await
        .map_err(|error| format!("failed to claim the starter note: {error}"))?
}

fn claim_starter_note_blocking() -> Result<bool, String> {
    if matches!(read_disk_config_unlocked(), Ok(Some(config)) if config.notes_starter_note_created)
    {
        return Ok(false);
    }
    let mut claimed = false;
    update_config(|config| {
        claimed = !config.notes_starter_note_created;
        config.notes_starter_note_created = true;
        Ok(())
    })?;
    Ok(claimed)
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

    keep_cli_settings(&mut config, &stored);

    config.typst_default_version = stored.typst_default_version;

    config.latex_default_engine = stored.latex_default_engine;
    config.tex_distribution = stored.tex_distribution;
    config.download_source = stored.download_source;
    config.download_mirror_url = stored.download_mirror_url;
    config.tex_package_repository = stored.tex_package_repository;

    config.phitex_enabled = stored.phitex_enabled;
    config.notes_starter_note_created = stored.notes_starter_note_created;
    config.github_connected = false;
    write_config_unlocked(&config)
}

fn keep_cli_settings(config: &mut AppConfig, stored: &AppConfig) {
    config.cli_settings_revision = stored.cli_settings_revision;
}

pub(crate) const LATEXMK_ENGINE: &str = "latexmk";
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn legacy_ai_settings_are_ignored_and_not_serialized_again() {
        let legacy = serde_json::json!({
            "ui_locale": "ru",
            "checkpoints_enabled": false,
            "git_auto_init": false,
            "typst_default_version": "0.14.2",
            "providers": [{"id": "retired", "key": "test-only"}],
            "ai_provider": "retired",
            "personas": [{"name": "old assistant"}],
            "mcp_servers": [{"command": "must-not-run"}],
            "tools_model": {"provider": "retired", "model": "old"}
        });
        let config: AppConfig = serde_json::from_value(legacy).unwrap();
        assert_eq!(config.ui_locale, "ru");
        assert!(!config.checkpoints_enabled);
        assert!(!config.git_auto_init);
        assert_eq!(config.typst_default_version.as_deref(), Some("0.14.2"));
        let saved = serde_json::to_value(config).unwrap();
        for key in [
            "providers",
            "ai_provider",
            "personas",
            "mcp_servers",
            "tools_model",
        ] {
            assert!(saved.get(key).is_none(), "retired setting returned: {key}");
        }
    }
}
