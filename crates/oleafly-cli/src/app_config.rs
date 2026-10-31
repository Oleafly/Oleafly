use std::fs::OpenOptions;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use serde_json::{Map, Value};

use crate::contract::{CliError, ErrorKind};

pub const CONFIG_FILE: &str = "config.json";
const LOCK_FILE: &str = ".config-store.lock";
const MAX_CONFIG_BYTES: u64 = 4 * 1024 * 1024;
const TOO_LARGE: &str = "config.json is larger than 4 MiB";
const LOCK_BUDGET: Duration = Duration::from_secs(10);
pub const LATEXMK_ENGINE: &str = "latexmk";

pub fn config_path(data_root: &Path) -> PathBuf {
    data_root.join(CONFIG_FILE)
}

fn read_object(path: &Path) -> Result<Option<Map<String, Value>>, String> {
    let metadata = match std::fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error.to_string()),
    };
    if !metadata.is_file() {
        return Err("config.json isn't a regular file".into());
    }
    if metadata.len() > MAX_CONFIG_BYTES {
        return Err(TOO_LARGE.into());
    }
    let bytes = std::fs::read(path).map_err(|error| error.to_string())?;
    match serde_json::from_slice::<Value>(&bytes) {
        Ok(Value::Object(fields)) => Ok(Some(fields)),
        Ok(_) => Err("config.json doesn't hold a JSON object".into()),
        Err(error) => Err(error.to_string()),
    }
}

pub fn read_app_config(data_root: &Path) -> Option<Map<String, Value>> {
    read_object(&config_path(data_root)).ok().flatten()
}

fn trimmed_text(config: &Map<String, Value>, key: &str) -> Option<String> {
    config
        .get(key)?
        .as_str()
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .map(str::to_owned)
}

pub fn typst_default_choice(data_root: &Path) -> Option<String> {
    trimmed_text(&read_app_config(data_root)?, "typst_default_version")
}

pub fn latex_default_engine(data_root: &Path) -> Option<String> {
    trimmed_text(&read_app_config(data_root)?, "latex_default_engine")
        .filter(|engine| engine == LATEXMK_ENGINE)
}

pub(crate) struct ConfigLock {
    _file: std::fs::File,
}

pub(crate) fn lock_config(data_root: &Path) -> Result<ConfigLock, CliError> {
    std::fs::create_dir_all(data_root).map_err(CliError::from)?;
    let path = data_root.join(LOCK_FILE);
    if std::fs::symlink_metadata(&path).is_ok_and(|metadata| metadata.file_type().is_symlink()) {
        return Err(CliError::new(
            ErrorKind::UnsafePath,
            "config.unsafe_path",
            "Oleafly's config lock is a link, so the CLI won't use it.",
        ));
    }
    let mut options = OpenOptions::new();
    options.read(true).write(true).create(true).truncate(false);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let file = options.open(&path).map_err(CliError::from)?;
    let deadline = Instant::now() + LOCK_BUDGET;
    loop {
        match fs4::FileExt::try_lock(&file) {
            Ok(()) => return Ok(ConfigLock { _file: file }),
            Err(fs4::TryLockError::WouldBlock) if Instant::now() < deadline => {
                std::thread::sleep(Duration::from_millis(50))
            }
            Err(fs4::TryLockError::WouldBlock) => {
                return Err(CliError::new(
                    ErrorKind::Conflict,
                    "conflict.config_busy",
                    "The Oleafly app is saving its settings right now.",
                )
                .hint("Try again in a moment.")
                .retryable())
            }
            Err(fs4::TryLockError::Error(error)) => return Err(CliError::from(error)),
        }
    }
}

pub fn update_app_config(
    data_root: &Path,
    update: impl FnOnce(&mut Map<String, Value>) -> Result<(), CliError>,
) -> Result<(), CliError> {
    let _lock = lock_config(data_root)?;
    let path = config_path(data_root);
    let mut config = read_object(&path)
        .map_err(|reason| {
            if reason == TOO_LARGE {
                return CliError::new(
                    ErrorKind::System,
                    "config.too_large",
                    "Oleafly's settings file is larger than 4 MiB, so the CLI left it alone.",
                )
                .hint("Change this setting in the Oleafly app instead.");
            }
            CliError::new(
                ErrorKind::Io,
                "config.corrupt",
                format!("Oleafly's settings file can't be read ({reason}), so it was left alone."),
            )
            .hint("Open Oleafly once so it can repair its settings, then try again.")
        })?
        .unwrap_or_default();
    let before = config.clone();
    update(&mut config)?;
    if config == before {
        return Ok(());
    }
    let text = serde_json::to_string_pretty(&Value::Object(config)).map_err(|error| {
        CliError::internal(format!("Oleafly couldn't write its settings: {error}"))
    })?;
    oleafly_core::atomic::write_atomic_private(&path, text.as_bytes()).map_err(CliError::from)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_are_read_trimmed_and_latexmk_only() {
        let data = tempfile::tempdir().unwrap();
        assert_eq!(typst_default_choice(data.path()), None);
        std::fs::write(
            data.path().join(CONFIG_FILE),
            r#"{"typst_default_version":" 0.13.1 ","latex_default_engine":"latexmk","future":{"x":1}}"#,
        )
        .unwrap();
        assert_eq!(typst_default_choice(data.path()).as_deref(), Some("0.13.1"));
        assert_eq!(
            latex_default_engine(data.path()).as_deref(),
            Some("latexmk")
        );
        std::fs::write(
            data.path().join(CONFIG_FILE),
            r#"{"typst_default_version":"  ","latex_default_engine":"xetex"}"#,
        )
        .unwrap();
        assert_eq!(typst_default_choice(data.path()), None);
        assert_eq!(latex_default_engine(data.path()), None);
        std::fs::write(data.path().join(CONFIG_FILE), "{not json").unwrap();
        assert_eq!(read_app_config(data.path()), None);
    }

    #[test]
    fn a_config_json_from_0_4_7_round_trips_untouched_keys() {
        let data = tempfile::tempdir().unwrap();
        let original = serde_json::json!({
            "theme": "dark",
            "mcp_servers": [{"name": "x", "env": {"TOKEN": "__stored__"}}],
            "typst_default_version": "0.12.0",
            "unknown_from_0_4_7": [1, 2, 3]
        });
        std::fs::write(
            data.path().join(CONFIG_FILE),
            serde_json::to_string(&original).unwrap(),
        )
        .unwrap();
        update_app_config(data.path(), |config| {
            config.insert(
                "typst_default_version".into(),
                Value::String("0.13.1".into()),
            );
            Ok(())
        })
        .unwrap();
        let written: Value =
            serde_json::from_slice(&std::fs::read(data.path().join(CONFIG_FILE)).unwrap()).unwrap();
        let mut expected = original.clone();
        expected["typst_default_version"] = Value::String("0.13.1".into());
        assert_eq!(written, expected);
    }

    #[cfg(unix)]
    #[test]
    fn a_config_json_the_cli_creates_is_owner_only() {
        use std::os::unix::fs::PermissionsExt as _;
        let data = tempfile::tempdir().unwrap();
        update_app_config(data.path(), |config| {
            config.insert(
                "typst_default_version".into(),
                Value::String("0.13.1".into()),
            );
            Ok(())
        })
        .unwrap();
        let mode = std::fs::metadata(data.path().join(CONFIG_FILE))
            .unwrap()
            .permissions()
            .mode();
        assert_eq!(mode & 0o077, 0, "{mode:o}");
    }

    #[test]
    fn a_large_config_is_read_and_one_too_large_is_called_that() {
        let data = tempfile::tempdir().unwrap();
        let models: Vec<Value> = (0..40_000)
            .map(|index| serde_json::json!({"id": format!("model-{index}"), "enabled": true}))
            .collect();
        let big = serde_json::json!({"typst_default_version": "0.13.1", "ai_provider_models": {"x": models}});
        std::fs::write(data.path().join(CONFIG_FILE), big.to_string()).unwrap();
        assert!(
            std::fs::metadata(data.path().join(CONFIG_FILE))
                .unwrap()
                .len()
                > 1024 * 1024
        );
        assert_eq!(typst_default_choice(data.path()).as_deref(), Some("0.13.1"));
        std::fs::write(
            data.path().join(CONFIG_FILE),
            vec![b' '; MAX_CONFIG_BYTES as usize + 1],
        )
        .unwrap();
        let error = update_app_config(data.path(), |_| Ok(())).unwrap_err();
        assert_eq!(error.code, "config.too_large");
    }

    #[test]
    fn a_corrupt_config_is_never_overwritten() {
        let data = tempfile::tempdir().unwrap();
        std::fs::write(data.path().join(CONFIG_FILE), "{broken").unwrap();
        let error = update_app_config(data.path(), |_| Ok(())).unwrap_err();
        assert_eq!(error.code, "config.corrupt");
        assert_eq!(
            std::fs::read_to_string(data.path().join(CONFIG_FILE)).unwrap(),
            "{broken"
        );
    }
}
