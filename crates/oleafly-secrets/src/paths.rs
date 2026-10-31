use std::path::PathBuf;

pub const DATA_DIR_VARIABLE: &str = "OLEAFLY_DATA_DIR";

pub fn home_dir() -> Result<PathBuf, String> {
    std::env::var_os("HOME")
        .filter(|value| !value.is_empty())
        .or_else(|| std::env::var_os("USERPROFILE").filter(|value| !value.is_empty()))
        .map(PathBuf::from)
        .ok_or_else(|| "could not determine user home directory".to_string())
}

pub fn data_root() -> Result<PathBuf, String> {
    if let Some(dir) = configured_root() {
        return Ok(dir);
    }
    default_root()
}

fn configured_root() -> Option<PathBuf> {
    std::env::var_os(DATA_DIR_VARIABLE)
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
}

#[cfg_attr(not(test), allow(dead_code))]
pub(crate) fn resolved_root() -> Result<PathBuf, String> {
    match configured_root() {
        Some(dir) => Ok(dir),
        None => Ok(home_dir()?.join(".oleafly")),
    }
}

#[cfg(not(test))]
fn default_root() -> Result<PathBuf, String> {
    Ok(home_dir()?.join(".oleafly"))
}

#[cfg(test)]
fn default_root() -> Result<PathBuf, String> {
    static DIR: std::sync::OnceLock<Result<PathBuf, String>> = std::sync::OnceLock::new();
    DIR.get_or_init(|| {
        tempfile::Builder::new()
            .prefix("oleafly-secrets-test-data-")
            .tempdir()
            .map(tempfile::TempDir::keep)
            .map_err(|e| format!("failed to create the test data folder: {e}"))
    })
    .clone()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    static ENV: Mutex<()> = Mutex::new(());

    struct Restore(Vec<(&'static str, Option<std::ffi::OsString>)>);
    impl Drop for Restore {
        fn drop(&mut self) {
            for (name, value) in self.0.drain(..) {
                match value {
                    Some(value) => std::env::set_var(name, value),
                    None => std::env::remove_var(name),
                }
            }
        }
    }
    fn save(names: &[&'static str]) -> Restore {
        Restore(names.iter().map(|n| (*n, std::env::var_os(n))).collect())
    }

    #[test]
    fn data_root_prefers_the_data_dir_variable() {
        let _lock = ENV.lock().unwrap_or_else(|e| e.into_inner());
        let _restore = save(&[DATA_DIR_VARIABLE]);
        let dir = tempfile::tempdir().unwrap();
        std::env::set_var(DATA_DIR_VARIABLE, dir.path());
        assert_eq!(data_root().unwrap(), dir.path());
        std::env::set_var(DATA_DIR_VARIABLE, "");
        let fallback = data_root().unwrap();
        assert_ne!(fallback, dir.path());
        assert!(fallback
            .to_string_lossy()
            .contains("oleafly-secrets-test-data-"));
    }

    #[test]
    fn data_root_falls_back_to_userprofile_when_home_is_unset() {
        let _lock = ENV.lock().unwrap_or_else(|e| e.into_inner());
        let _restore = save(&["HOME", "USERPROFILE", DATA_DIR_VARIABLE]);
        let dir = tempfile::tempdir().unwrap();
        let profile = dir.path().join("Ana López");
        std::env::remove_var("HOME");
        std::env::remove_var(DATA_DIR_VARIABLE);
        std::env::set_var("USERPROFILE", &profile);
        assert_eq!(resolved_root(), Ok(profile.join(".oleafly")));
        std::env::remove_var("USERPROFILE");
        assert_eq!(
            resolved_root(),
            Err("could not determine user home directory".to_string())
        );
    }
}
