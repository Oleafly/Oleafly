//! The Windows "Terminal command": a copy of the CLI at
//! `%LOCALAPPDATA%\Oleafly\bin\oleafly.exe` with that folder on the user's
//! PATH (`HKCU\Environment\Path`). A copy, not a link: the installed
//! `oleafly-cli.exe` must stay replaceable while an `oleafly` runs.
//!
//! The logic is plain Rust and is tested on every OS; only
//! [`RegistryUserPath`] touches Windows.
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

/// Under `%LOCALAPPDATA%`.
pub const BIN_DIR: [&str; 2] = ["Oleafly", "bin"];
pub const COMMAND_FILE: &str = "oleafly.exe";
/// The app's record of the command it installed (shared with macOS and
/// Linux, whose records have no `platform`).
pub const RECORD_FILE: &str = "shell-command.json";
const RECORD_VERSION: u32 = 1;
const MAX_RECORD_BYTES: u64 = 16 * 1024;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct WindowsRecord {
    pub version: u32,
    pub platform: String,
    pub path: PathBuf,
    pub method: String,
    pub sha256: String,
    /// The PATH entry this install added (to remove exactly it).
    pub path_entry: String,
}

/// The user's `Path` value (`REG_SZ` or `REG_EXPAND_SZ`).
pub trait UserPath {
    /// The value and whether it is `REG_EXPAND_SZ`; `None` when unset.
    fn read(&self) -> std::io::Result<Option<(String, bool)>>;
    fn write(&self, value: &str, expand: bool) -> std::io::Result<()>;
    /// Tells running programs the environment changed.
    fn broadcast(&self);
}

pub struct InstallEnv<'a> {
    pub local_app_data: PathBuf,
    pub data_root: PathBuf,
    /// The CLI that ships with the app (`oleafly-cli.exe`).
    pub bundled: Option<PathBuf>,
    pub user_path: &'a dyn UserPath,
    /// Expands `%VARIABLES%` in a PATH entry.
    pub expand: &'a dyn Fn(&str) -> String,
}

/// The shape of the app's `ShellCommandStatus`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct WindowsStatus {
    pub state: &'static str,
    pub path: Option<String>,
    pub directory: Option<String>,
    pub method: Option<&'static str>,
    pub on_path: bool,
    pub after_sign_in: bool,
    pub after_new_terminal: bool,
    pub hint: Option<serde_json::Value>,
}

/// An error with the app's code (`errors.json` `shell_command.*`).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct InstallError {
    pub code: &'static str,
    pub params: Vec<(&'static str, String)>,
    pub detail: Option<String>,
}

impl InstallError {
    fn new(code: &'static str) -> Self {
        Self {
            code,
            params: Vec::new(),
            detail: None,
        }
    }

    fn param(mut self, key: &'static str, value: impl Into<String>) -> Self {
        self.params.push((key, value.into()));
        self
    }

    fn detail(mut self, detail: impl std::fmt::Display) -> Self {
        self.detail = Some(detail.to_string());
        self
    }
}

impl std::fmt::Display for InstallError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.code)?;
        if let Some(detail) = &self.detail {
            write!(formatter, ": {detail}")?;
        }
        Ok(())
    }
}

pub fn command_dir(env: &InstallEnv) -> PathBuf {
    BIN_DIR
        .iter()
        .fold(env.local_app_data.clone(), |path, part| path.join(part))
}

pub fn command_path(env: &InstallEnv) -> PathBuf {
    command_dir(env).join(COMMAND_FILE)
}

fn file_sha256(path: &Path) -> std::io::Result<String> {
    let mut file = std::fs::File::open(path)?;
    let mut hasher = Sha256::new();
    std::io::copy(&mut file, &mut hasher)?;
    Ok(hasher
        .finalize()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect())
}

/// Ours: a version 1 record for Windows.
pub fn read_record(data_root: &Path) -> Option<WindowsRecord> {
    let path = data_root.join(RECORD_FILE);
    let metadata = std::fs::symlink_metadata(&path).ok()?;
    if !metadata.is_file() || metadata.len() > MAX_RECORD_BYTES {
        return None;
    }
    serde_json::from_slice::<WindowsRecord>(&std::fs::read(&path).ok()?)
        .ok()
        .filter(|record| record.version == RECORD_VERSION && record.platform == "windows")
}

fn write_record(data_root: &Path, record: &WindowsRecord) -> Result<(), InstallError> {
    let bytes = serde_json::to_vec_pretty(record)
        .map_err(|error| InstallError::new("shell_command.failed").detail(error))?;
    std::fs::create_dir_all(data_root)
        .map_err(|error| InstallError::new("shell_command.failed").detail(error))?;
    oleafly_core::atomic::write_atomic(&data_root.join(RECORD_FILE), &bytes)
        .map_err(|error| InstallError::new("shell_command.failed").detail(error))
}

/// A PATH entry compared as Windows does: quotes, case, separators and a
/// trailing backslash don't matter.
pub fn normalize_entry(entry: &str) -> String {
    let mut text = entry.trim().trim_matches('"').trim().replace('/', "\\");
    while text.len() > 3 && text.ends_with('\\') {
        text.pop();
    }
    text.to_lowercase()
}

pub fn path_contains(value: &str, dir: &str, expand: &dyn Fn(&str) -> String) -> bool {
    let wanted = normalize_entry(dir);
    value
        .split(';')
        .any(|entry| !entry.trim().is_empty() && normalize_entry(&expand(entry)) == wanted)
}

/// `value` with `dir` appended, keeping every other entry and its order.
pub fn add_path_entry(value: &str, dir: &str) -> String {
    let trimmed = value.trim_end_matches(';');
    if trimmed.trim().is_empty() {
        dir.to_string()
    } else {
        format!("{trimmed};{dir}")
    }
}

/// `value` without `dir`; `None` when it isn't there.
pub fn remove_path_entry(
    value: &str,
    dir: &str,
    expand: &dyn Fn(&str) -> String,
) -> Option<String> {
    let wanted = normalize_entry(dir);
    let entries: Vec<&str> = value.split(';').collect();
    let kept: Vec<&str> = entries
        .iter()
        .copied()
        .filter(|entry| entry.trim().is_empty() || normalize_entry(&expand(entry)) != wanted)
        .collect();
    (kept.len() != entries.len()).then(|| kept.join(";").trim_matches(';').to_string())
}

fn on_path(env: &InstallEnv, dir: &Path) -> bool {
    env.user_path
        .read()
        .ok()
        .flatten()
        .is_some_and(|(value, _)| path_contains(&value, &dir.to_string_lossy(), env.expand))
}

/// Whether `path` is the copy `record` describes.
fn is_ours(path: &Path, record: Option<&WindowsRecord>) -> bool {
    record.is_some_and(|record| {
        normalize_entry(&record.path.to_string_lossy()) == normalize_entry(&path.to_string_lossy())
            && file_sha256(path).is_ok_and(|sha| sha == record.sha256)
    })
}

pub fn status(env: &InstallEnv) -> WindowsStatus {
    let dir = command_dir(env);
    let path = command_path(env);
    let on_path = on_path(env, &dir);
    let mut status = WindowsStatus {
        state: "not_installed",
        path: Some(path.display().to_string()),
        directory: Some(dir.display().to_string()),
        method: Some("copy"),
        on_path,
        after_sign_in: false,
        after_new_terminal: false,
        hint: None,
    };
    let Some(bundled) = env.bundled.as_deref().filter(|bundled| bundled.is_file()) else {
        status.state = "unavailable";
        return status;
    };
    if !path.exists() {
        return status;
    }
    let record = read_record(&env.data_root);
    if !is_ours(&path, record.as_ref()) {
        status.state = "occupied";
        return status;
    }
    let current =
        record.is_some_and(|record| file_sha256(bundled).is_ok_and(|sha| sha == record.sha256));
    status.state = if current { "installed" } else { "outdated" };
    status.after_new_terminal = true;
    status
}

/// Puts `bundled` at `destination` through a temporary file; a copy that
/// is running is renamed out of the way first.
fn place_copy(bundled: &Path, destination: &Path) -> Result<(), InstallError> {
    let dir = destination.parent().unwrap_or_else(|| Path::new("."));
    std::fs::create_dir_all(dir)
        .map_err(|error| InstallError::new("shell_command.failed").detail(error))?;
    let temporary = dir.join(format!(".{COMMAND_FILE}.{}.tmp", std::process::id()));
    if let Err(error) = std::fs::copy(bundled, &temporary) {
        // A copy that stopped halfway (disk full, a scanner) leaves a file
        // the size of the CLI.
        let _ = std::fs::remove_file(&temporary);
        return Err(InstallError::new("shell_command.failed").detail(error));
    }
    if std::fs::rename(&temporary, destination).is_ok() {
        sweep_old_copies(dir);
        return Ok(());
    }
    let old = dir.join(format!("{COMMAND_FILE}.old-{}", std::process::id()));
    let moved = std::fs::rename(destination, &old).and_then(|()| {
        std::fs::rename(&temporary, destination).inspect_err(|_| {
            // The running copy goes back where it was.
            let _ = std::fs::rename(&old, destination);
        })
    });
    if let Err(error) = moved {
        let _ = std::fs::remove_file(&temporary);
        return Err(InstallError::new("shell_command.in_use")
            .param("path", destination.display().to_string())
            .detail(error));
    }
    sweep_old_copies(dir);
    Ok(())
}

/// How old a temporary copy must be before a sweep treats it as left over:
/// an install running right now may still be writing its own.
const STALE_TEMPORARY: std::time::Duration = std::time::Duration::from_secs(60);

/// Removes the copies moved aside by an earlier install or uninstall, and
/// temporary copies a crash left behind.
fn sweep_old_copies(dir: &Path) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    let old = format!("{COMMAND_FILE}.old-");
    let temporary = format!(".{COMMAND_FILE}.");
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        let stale_temporary = name.starts_with(&temporary)
            && name.ends_with(".tmp")
            && entry
                .metadata()
                .and_then(|metadata| metadata.modified())
                .ok()
                .and_then(|modified| modified.elapsed().ok())
                .is_some_and(|age| age > STALE_TEMPORARY);
        if name.starts_with(&old) || stale_temporary {
            let _ = std::fs::remove_file(entry.path());
        }
    }
}

pub fn install(env: &InstallEnv) -> Result<WindowsStatus, InstallError> {
    let bundled = env
        .bundled
        .as_deref()
        .filter(|bundled| bundled.is_file())
        .ok_or_else(|| InstallError::new("shell_command.unavailable"))?;
    let dir = command_dir(env);
    let path = command_path(env);
    let record = read_record(&env.data_root);
    if path.exists() && !is_ours(&path, record.as_ref()) {
        return Err(
            InstallError::new("shell_command.occupied").param("path", path.display().to_string())
        );
    }
    let existed = path.exists();
    place_copy(bundled, &path)?;
    let entry = dir.display().to_string();
    // The record comes before the PATH edit: with the copy in place and no
    // record, a retry (and an uninstall) would call the copy someone else's.
    // A copy that can't be recorded is taken back if it is new.
    let recorded = file_sha256(&path)
        .map_err(|error| InstallError::new("shell_command.failed").detail(error))
        .and_then(|sha256| {
            write_record(
                &env.data_root,
                &WindowsRecord {
                    version: RECORD_VERSION,
                    platform: "windows".into(),
                    path: path.clone(),
                    method: "copy".into(),
                    sha256,
                    path_entry: entry.clone(),
                },
            )
        });
    if let Err(error) = recorded {
        if !existed {
            let _ = std::fs::remove_file(&path);
        }
        return Err(error);
    }
    let path_failed = |error: std::io::Error| {
        InstallError::new("shell_command.path_failed")
            .param("directory", entry.clone())
            .detail(error)
    };
    let current = env.user_path.read().map_err(path_failed)?;
    // A user without a Path value gets the kind Windows itself uses.
    let (value, expand) = current.unwrap_or_else(|| (String::new(), true));
    if !path_contains(&value, &entry, env.expand) {
        env.user_path
            .write(&add_path_entry(&value, &entry), expand)
            .map_err(path_failed)?;
    }
    env.user_path.broadcast();
    Ok(status(env))
}

pub fn uninstall(env: &InstallEnv) -> Result<WindowsStatus, InstallError> {
    let path = command_path(env);
    let Some(record) = read_record(&env.data_root) else {
        if path.exists() {
            return Err(InstallError::new("shell_command.occupied")
                .param("path", path.display().to_string()));
        }
        return Ok(status(env));
    };
    if record.path.exists() {
        if !is_ours(&record.path, Some(&record)) {
            return Err(InstallError::new("shell_command.changed")
                .param("path", record.path.display().to_string()));
        }
        if std::fs::remove_file(&record.path).is_err() {
            // A running copy can't be deleted, but it can be moved aside and
            // swept on the next install.
            let old = record
                .path
                .with_file_name(format!("{COMMAND_FILE}.old-{}", std::process::id()));
            std::fs::rename(&record.path, &old).map_err(|error| {
                InstallError::new("shell_command.in_use")
                    .param("path", record.path.display().to_string())
                    .detail(error)
            })?;
        }
    }
    let directory = record.path_entry.clone();
    let path_failed = |error: std::io::Error| {
        InstallError::new("shell_command.path_failed")
            .param("directory", directory.clone())
            .detail(error)
    };
    if let Some((value, expand)) = env.user_path.read().map_err(path_failed)? {
        if let Some(updated) = remove_path_entry(&value, &record.path_entry, env.expand) {
            env.user_path.write(&updated, expand).map_err(path_failed)?;
        }
    }
    env.user_path.broadcast();
    let _ = std::fs::remove_file(env.data_root.join(RECORD_FILE));
    // A copy moved aside because it was running goes now if it has stopped.
    if let Some(dir) = record.path.parent() {
        sweep_old_copies(dir);
    }
    Ok(status(env))
}

/// After an app update: replaces an installed copy that is ours and
/// unchanged with the new CLI. `true` when it did.
pub fn refresh_if_outdated(env: &InstallEnv) -> Result<bool, InstallError> {
    let Some(bundled) = env.bundled.as_deref().filter(|bundled| bundled.is_file()) else {
        return Ok(false);
    };
    let Some(mut record) = read_record(&env.data_root) else {
        return Ok(false);
    };
    if !is_ours(&record.path, Some(&record)) {
        return Ok(false);
    }
    let fresh = file_sha256(bundled)
        .map_err(|error| InstallError::new("shell_command.failed").detail(error))?;
    if fresh == record.sha256 {
        return Ok(false);
    }
    place_copy(bundled, &record.path)?;
    record.sha256 = file_sha256(&record.path)
        .map_err(|error| InstallError::new("shell_command.failed").detail(error))?;
    write_record(&env.data_root, &record)?;
    Ok(true)
}

/// The user's PATH in the registry (`HKCU\Environment\Path`).
#[cfg(windows)]
pub struct RegistryUserPath;

#[cfg(windows)]
fn wide(text: &str) -> Vec<u16> {
    use std::os::windows::ffi::OsStrExt;
    std::ffi::OsStr::new(text)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect()
}

#[cfg(windows)]
impl UserPath for RegistryUserPath {
    fn read(&self) -> std::io::Result<Option<(String, bool)>> {
        use std::os::windows::ffi::OsStringExt;
        use windows_sys::Win32::Foundation::{ERROR_FILE_NOT_FOUND, ERROR_SUCCESS};
        use windows_sys::Win32::System::Registry::{
            RegGetValueW, HKEY_CURRENT_USER, REG_EXPAND_SZ, RRF_NOEXPAND, RRF_RT_REG_EXPAND_SZ,
            RRF_RT_REG_SZ,
        };
        let key = wide("Environment");
        let name = wide("Path");
        let flags = RRF_RT_REG_SZ | RRF_RT_REG_EXPAND_SZ | RRF_NOEXPAND;
        let mut kind = 0u32;
        let mut size = 0u32;
        let status = unsafe {
            RegGetValueW(
                HKEY_CURRENT_USER,
                key.as_ptr(),
                name.as_ptr(),
                flags,
                &mut kind,
                std::ptr::null_mut(),
                &mut size,
            )
        };
        if status == ERROR_FILE_NOT_FOUND {
            return Ok(None);
        }
        if status != ERROR_SUCCESS {
            return Err(std::io::Error::from_raw_os_error(status as i32));
        }
        let mut buffer = vec![0u16; (size as usize).div_ceil(2).max(1)];
        let status = unsafe {
            RegGetValueW(
                HKEY_CURRENT_USER,
                key.as_ptr(),
                name.as_ptr(),
                flags,
                &mut kind,
                buffer.as_mut_ptr().cast(),
                &mut size,
            )
        };
        if status != ERROR_SUCCESS {
            return Err(std::io::Error::from_raw_os_error(status as i32));
        }
        let length = buffer
            .iter()
            .position(|unit| *unit == 0)
            .unwrap_or(buffer.len());
        let value = std::ffi::OsString::from_wide(&buffer[..length])
            .to_string_lossy()
            .into_owned();
        Ok(Some((value, kind == REG_EXPAND_SZ)))
    }

    fn write(&self, value: &str, expand: bool) -> std::io::Result<()> {
        use windows_sys::Win32::Foundation::ERROR_SUCCESS;
        use windows_sys::Win32::System::Registry::{
            RegCloseKey, RegOpenKeyExW, RegSetValueExW, HKEY, HKEY_CURRENT_USER, KEY_SET_VALUE,
            REG_EXPAND_SZ, REG_SZ,
        };
        let key = wide("Environment");
        let name = wide("Path");
        let data = wide(value);
        let mut handle: HKEY = std::ptr::null_mut();
        let status = unsafe {
            RegOpenKeyExW(
                HKEY_CURRENT_USER,
                key.as_ptr(),
                0,
                KEY_SET_VALUE,
                &mut handle,
            )
        };
        if status != ERROR_SUCCESS {
            return Err(std::io::Error::from_raw_os_error(status as i32));
        }
        let kind = if expand { REG_EXPAND_SZ } else { REG_SZ };
        let bytes = u32::try_from(data.len() * 2)
            .map_err(|_| std::io::Error::other("the PATH is too long"))?;
        let status =
            unsafe { RegSetValueExW(handle, name.as_ptr(), 0, kind, data.as_ptr().cast(), bytes) };
        unsafe {
            RegCloseKey(handle);
        }
        if status != ERROR_SUCCESS {
            return Err(std::io::Error::from_raw_os_error(status as i32));
        }
        Ok(())
    }

    fn broadcast(&self) {
        use windows_sys::Win32::UI::WindowsAndMessaging::{
            SendMessageTimeoutW, HWND_BROADCAST, SMTO_ABORTIFHUNG, WM_SETTINGCHANGE,
        };
        let area = wide("Environment");
        let mut result = 0usize;
        unsafe {
            SendMessageTimeoutW(
                HWND_BROADCAST,
                WM_SETTINGCHANGE,
                0,
                area.as_ptr() as isize,
                SMTO_ABORTIFHUNG,
                5000,
                &mut result,
            );
        }
    }
}

/// `%NAME%` references expanded from this process's environment.
pub fn expand_variables(entry: &str) -> String {
    let mut out = String::new();
    let mut rest = entry;
    while let Some(start) = rest.find('%') {
        out.push_str(&rest[..start]);
        let after = &rest[start + 1..];
        match after.find('%') {
            Some(end) => {
                let name = &after[..end];
                match std::env::var(name).ok().filter(|_| !name.is_empty()) {
                    Some(value) => out.push_str(&value),
                    None => {
                        out.push('%');
                        out.push_str(name);
                        out.push('%');
                    }
                }
                rest = &after[end + 1..];
            }
            None => {
                out.push_str(&rest[start..]);
                rest = "";
            }
        }
    }
    out.push_str(rest);
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::{Cell, RefCell};

    struct MemoryPath {
        value: RefCell<Option<(String, bool)>>,
        broadcasts: Cell<u32>,
    }

    impl MemoryPath {
        fn new(value: Option<&str>) -> Self {
            Self {
                value: RefCell::new(value.map(|value| (value.to_string(), true))),
                broadcasts: Cell::new(0),
            }
        }
    }

    impl UserPath for MemoryPath {
        fn read(&self) -> std::io::Result<Option<(String, bool)>> {
            Ok(self.value.borrow().clone())
        }

        fn write(&self, value: &str, expand: bool) -> std::io::Result<()> {
            *self.value.borrow_mut() = Some((value.to_string(), expand));
            Ok(())
        }

        fn broadcast(&self) {
            self.broadcasts.set(self.broadcasts.get() + 1);
        }
    }

    fn no_expand(entry: &str) -> String {
        entry.to_string()
    }

    #[test]
    fn path_entries_compare_case_insensitively_and_ignore_trailing_backslashes() {
        let dir = r"C:\Users\Ada Lovelace\AppData\Local\Oleafly\bin\";
        assert_eq!(
            normalize_entry(dir),
            normalize_entry(r"c:\users\ada lovelace\appdata\local\oleafly\bin")
        );
        assert!(path_contains(
            r#"C:\a;"c:\users\ada lovelace\appdata\local\oleafly\bin";D:\b"#,
            dir,
            &no_expand
        ));
        assert!(!path_contains(r"C:\a;D:\b", dir, &no_expand));
        assert_eq!(normalize_entry(r"C:\"), r"c:\");
    }

    #[test]
    fn expanded_variables_match_our_folder() {
        let expand = |entry: &str| entry.replace("%LOCALAPPDATA%", r"C:\Users\Ada\AppData\Local");
        assert!(path_contains(
            r"%LOCALAPPDATA%\Oleafly\bin;C:\x",
            r"C:\Users\Ada\AppData\Local\Oleafly\bin",
            &expand
        ));
    }

    #[test]
    fn adding_keeps_existing_entries_and_order() {
        assert_eq!(add_path_entry(r"C:\a;D:\b", r"E:\o"), r"C:\a;D:\b;E:\o");
        assert_eq!(add_path_entry(r"C:\a;", r"E:\o"), r"C:\a;E:\o");
        assert_eq!(add_path_entry("", r"E:\o"), r"E:\o");
    }

    #[test]
    fn removing_only_drops_our_entry() {
        assert_eq!(
            remove_path_entry(r#"C:\a;E:\o;"D:\b c""#, r"E:\o\", &no_expand).as_deref(),
            Some(r#"C:\a;"D:\b c""#)
        );
        assert_eq!(remove_path_entry(r"C:\a;D:\b", r"E:\o", &no_expand), None);
        assert_eq!(
            remove_path_entry(r"E:\o", r"E:\o", &no_expand).as_deref(),
            Some("")
        );
    }

    fn env<'a>(
        local: &Path,
        data: &Path,
        bundled: Option<PathBuf>,
        user_path: &'a dyn UserPath,
    ) -> InstallEnv<'a> {
        InstallEnv {
            local_app_data: local.to_path_buf(),
            data_root: data.to_path_buf(),
            bundled,
            user_path,
            expand: &no_expand,
        }
    }

    #[test]
    fn install_then_uninstall_round_trips_the_user_path() {
        let local = tempfile::tempdir().unwrap();
        let local_root = local.path().join("Ada Lovelace").join("Local");
        let data = tempfile::tempdir().unwrap();
        let bundle = tempfile::tempdir().unwrap();
        let cli = bundle.path().join("oleafly-cli.exe");
        std::fs::write(&cli, b"cli v1").unwrap();
        let original = r"C:\Windows;%USERPROFILE%\bin";
        let user_path = MemoryPath::new(Some(original));
        let env = env(&local_root, data.path(), Some(cli), &user_path);
        assert_eq!(status(&env).state, "not_installed");
        let installed = install(&env).unwrap();
        assert_eq!(
            (
                installed.state,
                installed.on_path,
                installed.after_new_terminal
            ),
            ("installed", true, true)
        );
        assert_eq!(std::fs::read(command_path(&env)).unwrap(), b"cli v1");
        assert!(read_record(data.path()).is_some());
        let removed = uninstall(&env).unwrap();
        assert_eq!(removed.state, "not_installed");
        assert_eq!(
            user_path
                .value
                .borrow()
                .as_ref()
                .map(|(value, expand)| (value.as_str(), *expand)),
            Some((original, true))
        );
        assert!(!command_path(&env).exists() && read_record(data.path()).is_none());
        assert_eq!(user_path.broadcasts.get(), 2);
    }

    /// A user path whose writes fail, as a registry policy can make them.
    struct LockedPath(MemoryPath);

    impl UserPath for LockedPath {
        fn read(&self) -> std::io::Result<Option<(String, bool)>> {
            self.0.read()
        }

        fn write(&self, _: &str, _: bool) -> std::io::Result<()> {
            Err(std::io::Error::new(
                std::io::ErrorKind::PermissionDenied,
                "blocked by policy",
            ))
        }

        fn broadcast(&self) {
            self.0.broadcast();
        }
    }

    #[test]
    fn an_install_that_fails_at_the_path_edit_can_be_retried_and_uninstalled() {
        let local = tempfile::tempdir().unwrap();
        let data = tempfile::tempdir().unwrap();
        let bundle = tempfile::tempdir().unwrap();
        let cli = bundle.path().join("oleafly-cli.exe");
        std::fs::write(&cli, b"cli v1").unwrap();
        let locked = LockedPath(MemoryPath::new(Some(r"C:\Windows")));
        let blocked = env(local.path(), data.path(), Some(cli.clone()), &locked);
        let error = install(&blocked).unwrap_err();
        assert_eq!(error.code, "shell_command.path_failed");
        // The copy is on disk and recorded, so it is still ours.
        assert!(command_path(&blocked).exists());
        assert!(read_record(data.path()).is_some());
        assert_eq!(status(&blocked).state, "installed");

        let user_path = MemoryPath::new(Some(r"C:\Windows"));
        let retry = env(local.path(), data.path(), Some(cli.clone()), &user_path);
        let installed = install(&retry).unwrap();
        assert_eq!((installed.state, installed.on_path), ("installed", true));

        // And an install that failed the same way can be uninstalled.
        let other_local = tempfile::tempdir().unwrap();
        let other_data = tempfile::tempdir().unwrap();
        let blocked = env(other_local.path(), other_data.path(), Some(cli), &locked);
        install(&blocked).unwrap_err();
        let removed = uninstall(&blocked).unwrap();
        assert_eq!(removed.state, "not_installed");
        assert!(!command_path(&blocked).exists());
    }

    #[test]
    fn a_copy_that_cannot_be_recorded_is_taken_back_when_it_is_new() {
        let local = tempfile::tempdir().unwrap();
        let data = tempfile::tempdir().unwrap();
        let bundle = tempfile::tempdir().unwrap();
        let cli = bundle.path().join("oleafly-cli.exe");
        std::fs::write(&cli, b"cli v1").unwrap();
        // A file where the data folder should be: the record can't be written.
        let blocked_data = data.path().join("not-a-folder");
        std::fs::write(&blocked_data, b"x").unwrap();
        let user_path = MemoryPath::new(None);
        let env = env(local.path(), &blocked_data, Some(cli), &user_path);
        assert_eq!(install(&env).unwrap_err().code, "shell_command.failed");
        assert!(!command_path(&env).exists());
        assert_eq!(user_path.broadcasts.get(), 0);
    }

    #[test]
    fn leftover_temporary_and_moved_aside_copies_are_swept() {
        let dir = tempfile::tempdir().unwrap();
        let stale = dir.path().join(".oleafly.exe.4242.tmp");
        let fresh = dir.path().join(".oleafly.exe.4343.tmp");
        let moved = dir.path().join("oleafly.exe.old-4141");
        let unrelated = dir.path().join(".other.tmp");
        for file in [&stale, &fresh, &moved, &unrelated] {
            std::fs::write(file, b"x").unwrap();
        }
        let long_ago = std::time::SystemTime::now() - std::time::Duration::from_secs(3600);
        std::fs::File::options()
            .write(true)
            .open(&stale)
            .unwrap()
            .set_modified(long_ago)
            .unwrap();
        sweep_old_copies(dir.path());
        assert!(!stale.exists() && !moved.exists());
        // An install running right now may still be writing its own copy.
        assert!(fresh.exists() && unrelated.exists());
    }

    #[test]
    fn an_outdated_copy_is_refreshed_and_a_changed_copy_is_left_alone() {
        let local = tempfile::tempdir().unwrap();
        let data = tempfile::tempdir().unwrap();
        let bundle = tempfile::tempdir().unwrap();
        let cli = bundle.path().join("oleafly-cli.exe");
        std::fs::write(&cli, b"cli v1").unwrap();
        let user_path = MemoryPath::new(None);
        let env = env(local.path(), data.path(), Some(cli.clone()), &user_path);
        install(&env).unwrap();
        std::fs::write(&cli, b"cli v2").unwrap();
        assert_eq!(status(&env).state, "outdated");
        assert!(refresh_if_outdated(&env).unwrap());
        assert_eq!(std::fs::read(command_path(&env)).unwrap(), b"cli v2");
        assert_eq!(status(&env).state, "installed");
        std::fs::write(command_path(&env), b"edited by hand").unwrap();
        std::fs::write(&cli, b"cli v3").unwrap();
        assert!(!refresh_if_outdated(&env).unwrap());
        assert_eq!(status(&env).state, "occupied");
        assert_eq!(uninstall(&env).unwrap_err().code, "shell_command.changed");
    }

    #[test]
    fn a_file_we_did_not_make_is_never_removed() {
        let local = tempfile::tempdir().unwrap();
        let data = tempfile::tempdir().unwrap();
        let user_path = MemoryPath::new(None);
        let env = env(local.path(), data.path(), None, &user_path);
        let path = command_path(&env);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, b"someone else's").unwrap();
        assert_eq!(uninstall(&env).unwrap_err().code, "shell_command.occupied");
        assert!(path.exists());
    }

    #[test]
    fn a_unix_shell_command_record_is_ignored_on_windows() {
        let data = tempfile::tempdir().unwrap();
        std::fs::write(
            data.path().join(RECORD_FILE),
            r#"{"version":1,"path":"/home/me/.local/bin/oleafly","method":"link"}"#,
        )
        .unwrap();
        assert!(read_record(data.path()).is_none());
    }

    #[test]
    fn variables_expand_from_the_environment() {
        assert_eq!(expand_variables("no variables"), "no variables");
        assert_eq!(
            expand_variables("%OLEAFLY_SURELY_UNSET_VARIABLE%\\bin"),
            "%OLEAFLY_SURELY_UNSET_VARIABLE%\\bin"
        );
        assert_eq!(expand_variables("50%"), "50%");
    }

    #[cfg(windows)]
    #[test]
    fn the_registry_user_path_reads_without_expanding() {
        let read = RegistryUserPath.read().unwrap();
        if let Some((value, _)) = read {
            assert!(!value.contains('\0'));
        }
    }
}
