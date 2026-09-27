#[cfg(test)]
#[path = "tests.rs"]
mod tests;

use crate::app_error::AppError;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::io::{Read, Seek, Write};
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

const COMMAND_NAME: &str = "oleafly";
const BUNDLED_CLI: &str = "oleafly-cli";
const RECORD_FILE: &str = "shell-command.json";
const RECORD_VERSION: u32 = 1;
const MAX_RECORD_BYTES: u64 = 16 * 1024;
const MAX_PACKAGED_BYTES: u64 = 4 * 1024;
const LOCAL_BIN: &str = ".local/bin";
const SYSTEM_BIN: &str = "/usr/local/bin";
const SHELL_PATH_TIMEOUT: Duration = Duration::from_secs(3);
const PATH_MARKER: &str = "__OLEAFLY_PATH__";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Platform {
    MacOs,
    Linux,
}

#[derive(Clone, Debug)]
pub(crate) struct Environment {
    pub(crate) platform: Platform,
    pub(crate) home: PathBuf,
    pub(crate) data_root: PathBuf,
    pub(crate) bundled: Option<PathBuf>,
    pub(crate) appimage: Option<PathBuf>,
    pub(crate) system_directory: PathBuf,
    pub(crate) search_path: Vec<PathBuf>,
    pub(crate) shell: Option<PathBuf>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum ShellStart {
    Interactive,
    Login,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Reach {
    Now,
    NextSignIn,
    Missing,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum State {
    Unavailable,
    MoveApp,
    NotInstalled,
    Installed,
    Outdated,
    Occupied,
    Packaged,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum Method {
    Link,
    Copy,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum Action {
    Linked,
    Copied,
    Removed,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub(crate) struct PathHint {
    pub(crate) file: Option<String>,
    pub(crate) line: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub(crate) struct ShellCommandStatus {
    pub(crate) state: State,
    pub(crate) path: Option<String>,
    pub(crate) directory: Option<String>,
    pub(crate) method: Option<Method>,
    pub(crate) on_path: bool,
    pub(crate) after_sign_in: bool,
    pub(crate) hint: Option<PathHint>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub(crate) struct ShellCommandChange {
    pub(crate) action: Action,
    pub(crate) status: ShellCommandStatus,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct Record {
    version: u32,
    path: PathBuf,
    method: Method,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    target: Option<PathBuf>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    sha256: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    app: Option<PathBuf>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Existing {
    Missing,
    Ours { current: bool },
    Foreign,
}

impl Environment {
    pub(crate) fn current() -> Result<Self, AppError> {
        let platform = if cfg!(target_os = "macos") {
            Platform::MacOs
        } else {
            Platform::Linux
        };
        let home = crate::paths::home_dir().map_err(failed)?;
        let data_root = crate::paths::oleafly_root().map_err(failed)?;
        let executable = std::env::current_exe()
            .ok()
            .and_then(|executable| executable.canonicalize().ok());
        let bundled = executable
            .as_deref()
            .and_then(Path::parent)
            .map(|folder| folder.join(BUNDLED_CLI))
            .filter(|candidate| candidate.is_file());
        let appimage = running_appimage(
            platform,
            std::env::var_os("APPIMAGE"),
            std::env::var_os("APPDIR"),
            executable.as_deref(),
        );
        let search_path = std::env::var_os("PATH")
            .map(|value| std::env::split_paths(&value).collect())
            .unwrap_or_default();
        let shell = std::env::var_os("SHELL")
            .filter(|value| !value.is_empty())
            .map(PathBuf::from);
        Ok(Self {
            platform,
            home,
            data_root,
            bundled,
            appimage,
            system_directory: PathBuf::from(SYSTEM_BIN),
            search_path,
            shell,
        })
    }
}

pub(crate) fn running_appimage(
    platform: Platform,
    appimage: Option<std::ffi::OsString>,
    appdir: Option<std::ffi::OsString>,
    executable: Option<&Path>,
) -> Option<PathBuf> {
    if platform != Platform::Linux {
        return None;
    }
    let appimage = PathBuf::from(appimage?);
    let appdir = PathBuf::from(appdir?);
    if !appimage.is_absolute() || !appdir.is_absolute() || !appimage.is_file() {
        return None;
    }
    let appdir = appdir.canonicalize().unwrap_or(appdir);
    executable
        .is_some_and(|executable| executable.starts_with(&appdir))
        .then_some(appimage)
}

impl ShellCommandStatus {
    fn bare(state: State) -> Self {
        Self {
            state,
            path: None,
            directory: None,
            method: None,
            on_path: false,
            after_sign_in: false,
            hint: None,
        }
    }
}

pub(crate) fn status(
    environment: &Environment,
    shell_path: &dyn Fn(ShellStart) -> Vec<PathBuf>,
) -> ShellCommandStatus {
    let Some(bundled) = environment.bundled.as_deref() else {
        return ShellCommandStatus::bare(State::Unavailable);
    };
    if environment.platform == Platform::MacOs && translocated(bundled) {
        return ShellCommandStatus::bare(State::MoveApp);
    }
    let record = read_record(&environment.data_root);
    let (path, existing) = locate(environment, record.as_ref());
    if !matches!(existing, Existing::Ours { .. }) {
        if let Some(packaged) = packaged_command(environment, bundled) {
            return packaged_status(environment, &packaged, shell_path);
        }
    }
    let state = match existing {
        Existing::Missing => State::NotInstalled,
        Existing::Ours { current: true } => State::Installed,
        Existing::Ours { current: false } => State::Outdated,
        Existing::Foreign => State::Occupied,
    };
    let installed = matches!(existing, Existing::Ours { .. });
    let method = if installed {
        installed_method(&path)
    } else {
        planned_method(environment)
    };
    let directory = path.parent().map(Path::to_path_buf).unwrap_or_default();
    let reach = if installed {
        reach(environment, &directory, shell_path)
    } else {
        Reach::Missing
    };
    let hint = (installed && reach == Reach::Missing).then(|| {
        path_hint(
            environment.platform,
            environment.shell.as_deref(),
            &directory,
            &environment.home,
        )
    });
    ShellCommandStatus {
        state,
        path: Some(tilde(&path, &environment.home)),
        directory: Some(tilde(&directory, &environment.home)),
        method: Some(method),
        on_path: reach == Reach::Now,
        after_sign_in: reach == Reach::NextSignIn,
        hint,
    }
}

fn packaged_status(
    environment: &Environment,
    packaged: &Path,
    shell_path: &dyn Fn(ShellStart) -> Vec<PathBuf>,
) -> ShellCommandStatus {
    let directory = packaged.parent().map(Path::to_path_buf).unwrap_or_default();
    let reach = reach(environment, &directory, shell_path);
    ShellCommandStatus {
        state: State::Packaged,
        path: Some(tilde(packaged, &environment.home)),
        directory: Some(tilde(&directory, &environment.home)),
        method: None,
        on_path: reach == Reach::Now,
        after_sign_in: reach == Reach::NextSignIn,
        hint: None,
    }
}

fn packaged_command(environment: &Environment, bundled: &Path) -> Option<PathBuf> {
    if environment.platform != Platform::Linux || environment.appimage.is_some() {
        return None;
    }
    let command = bundled.with_file_name(COMMAND_NAME);
    let metadata = std::fs::symlink_metadata(&command).ok()?;
    if !metadata.is_file() || metadata.len() > MAX_PACKAGED_BYTES {
        return None;
    }
    let text = std::fs::read(&command).ok()?;
    let script = text.starts_with(b"#!")
        && text
            .windows(BUNDLED_CLI.len())
            .any(|window| window == BUNDLED_CLI.as_bytes());
    script.then_some(command)
}

fn reach(
    environment: &Environment,
    directory: &Path,
    shell_path: &dyn Fn(ShellStart) -> Vec<PathBuf>,
) -> Reach {
    if on_search_path(directory, &environment.search_path) {
        return Reach::Now;
    }
    let new_terminal = match environment.platform {
        Platform::MacOs => ShellStart::Login,
        Platform::Linux => ShellStart::Interactive,
    };
    if on_search_path(directory, &shell_path(new_terminal)) {
        return Reach::Now;
    }
    if new_terminal == ShellStart::Interactive
        && on_search_path(directory, &shell_path(ShellStart::Login))
    {
        return Reach::NextSignIn;
    }
    Reach::Missing
}

pub(crate) fn install(
    environment: &Environment,
    shell_path: &dyn Fn(ShellStart) -> Vec<PathBuf>,
) -> Result<ShellCommandChange, AppError> {
    let bundled = environment
        .bundled
        .as_deref()
        .ok_or_else(|| AppError::new("shell_command.unavailable"))?;
    if environment.platform == Platform::MacOs && translocated(bundled) {
        return Err(AppError::new("shell_command.move_app"));
    }
    let record = read_record(&environment.data_root);
    let (path, existing) = locate(environment, record.as_ref());
    if existing == Existing::Foreign {
        return Err(
            AppError::new("shell_command.occupied").param("path", tilde(&path, &environment.home))
        );
    }
    if let Some(directory) = path.parent() {
        std::fs::create_dir_all(directory).map_err(failed)?;
    }
    let method = planned_method(environment);
    let installed = match method {
        Method::Link => {
            link_into_place(bundled, &path)?;
            Record {
                version: RECORD_VERSION,
                path,
                method,
                target: Some(bundled.to_path_buf()),
                sha256: None,
                app: None,
            }
        }
        Method::Copy => {
            let sha256 = copy_into_place(bundled, &path)?;
            Record {
                version: RECORD_VERSION,
                path,
                method,
                target: None,
                sha256: Some(sha256),
                app: environment.appimage.clone(),
            }
        }
    };
    write_record(&environment.data_root, &installed)?;
    Ok(ShellCommandChange {
        action: match method {
            Method::Link => Action::Linked,
            Method::Copy => Action::Copied,
        },
        status: status(environment, shell_path),
    })
}

pub(crate) fn uninstall(
    environment: &Environment,
    shell_path: &dyn Fn(ShellStart) -> Vec<PathBuf>,
) -> Result<ShellCommandChange, AppError> {
    let record = read_record(&environment.data_root);
    let path = record.as_ref().map_or_else(
        || choose_directory(environment).join(COMMAND_NAME),
        |record| record.path.clone(),
    );
    match inspect(&path, record.as_ref(), environment) {
        Existing::Foreign => {
            let code = if record.is_some() {
                "shell_command.changed"
            } else {
                "shell_command.occupied"
            };
            return Err(AppError::new(code).param("path", tilde(&path, &environment.home)));
        }
        Existing::Ours { .. } => std::fs::remove_file(&path)
            .map_err(|error| AppError::new("shell_command.remove_failed").detail(error))?,
        Existing::Missing => {}
    }
    forget_record(&environment.data_root)?;
    Ok(ShellCommandChange {
        action: Action::Removed,
        status: status(environment, shell_path),
    })
}

pub(crate) fn choose_directory(environment: &Environment) -> PathBuf {
    if environment.platform == Platform::MacOs && writable_directory(&environment.system_directory)
    {
        return environment.system_directory.clone();
    }
    environment.home.join(LOCAL_BIN)
}

pub(crate) fn path_hint(
    platform: Platform,
    shell: Option<&Path>,
    directory: &Path,
    home: &Path,
) -> PathHint {
    let name = shell
        .and_then(Path::file_name)
        .and_then(|name| name.to_str())
        .unwrap_or_default();
    if name == "fish" {
        return PathHint {
            file: None,
            line: format!("fish_add_path {}", tilde(directory, home)),
        };
    }
    let entry = match directory.strip_prefix(home) {
        Ok(rest) if !rest.as_os_str().is_empty() => format!("$HOME/{}", rest.display()),
        _ => directory.display().to_string(),
    };
    let file = match name {
        "zsh" => "~/.zshrc",
        "bash" if platform == Platform::MacOs => "~/.bash_profile",
        "bash" => "~/.bashrc",
        _ => "~/.profile",
    };
    PathHint {
        file: Some(file.to_string()),
        line: format!("export PATH=\"{entry}:$PATH\""),
    }
}

pub(crate) fn tilde(path: &Path, home: &Path) -> String {
    match path.strip_prefix(home) {
        Ok(rest) if rest.as_os_str().is_empty() => "~".to_string(),
        Ok(rest) => format!("~/{}", rest.display()),
        Err(_) => path.display().to_string(),
    }
}

pub(crate) fn shell_path(shell: Option<&Path>, start: ShellStart) -> Vec<PathBuf> {
    shell_path_within(shell, start, SHELL_PATH_TIMEOUT)
}

fn shell_path_within(shell: Option<&Path>, start: ShellStart, timeout: Duration) -> Vec<PathBuf> {
    let Some(shell) = shell.filter(|shell| shell.is_absolute()) else {
        return Vec::new();
    };
    let Ok(mut output) = tempfile::tempfile() else {
        return Vec::new();
    };
    let Ok(stdout) = output.try_clone() else {
        return Vec::new();
    };
    let flags: &[&str] = match start {
        ShellStart::Interactive => &["-i"],
        ShellStart::Login => &["-i", "-l"],
    };
    let mut command = std::process::Command::new(shell);
    command
        .args(flags)
        .args(["-c", &format!("echo {PATH_MARKER}; printenv PATH")])
        .stdin(std::process::Stdio::null())
        .stdout(stdout)
        .stderr(std::process::Stdio::null());
    unsafe {
        use std::os::unix::process::CommandExt;
        command.pre_exec(|| {
            if libc::setsid() == -1 {
                Err(std::io::Error::last_os_error())
            } else {
                Ok(())
            }
        });
    }
    let Ok(mut child) = command.spawn() else {
        return Vec::new();
    };
    let deadline = Instant::now() + timeout;
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) if Instant::now() < deadline => {
                std::thread::sleep(Duration::from_millis(25));
            }
            _ => {
                if let Ok(group) = libc::pid_t::try_from(child.id()) {
                    unsafe {
                        libc::kill(-group, libc::SIGKILL);
                    }
                }
                let _ = child.kill();
                let _ = child.wait();
                return Vec::new();
            }
        }
    }
    let mut text = String::new();
    if output.rewind().is_err() || output.read_to_string(&mut text).is_err() {
        return Vec::new();
    }
    printed_path(&text)
}

fn printed_path(text: &str) -> Vec<PathBuf> {
    let lines: Vec<&str> = text.lines().map(str::trim).collect();
    let line = match lines.iter().rposition(|line| *line == PATH_MARKER) {
        Some(index) => lines[index + 1..].iter().find(|line| !line.is_empty()),
        None => lines.iter().rev().find(|line| !line.is_empty()),
    };
    line.map(|line| std::env::split_paths(line).collect())
        .unwrap_or_default()
}

fn locate(environment: &Environment, record: Option<&Record>) -> (PathBuf, Existing) {
    if let Some(record) = record {
        let existing = inspect(&record.path, Some(record), environment);
        if matches!(existing, Existing::Ours { .. }) {
            return (record.path.clone(), existing);
        }
    }
    let path = choose_directory(environment).join(COMMAND_NAME);
    let existing = inspect(&path, record, environment);
    (path, existing)
}

fn inspect(path: &Path, record: Option<&Record>, environment: &Environment) -> Existing {
    let Ok(metadata) = std::fs::symlink_metadata(path) else {
        return Existing::Missing;
    };
    let recorded = record.filter(|record| record.path == path);
    if metadata.file_type().is_symlink() {
        let Ok(target) = std::fs::read_link(path) else {
            return Existing::Foreign;
        };
        let target = match path.parent() {
            Some(folder) if target.is_relative() => folder.join(target),
            _ => target,
        };
        let resolved = target.canonicalize().unwrap_or_else(|_| target.clone());
        if environment.bundled.as_ref() == Some(&resolved) {
            return Existing::Ours { current: true };
        }
        let linked_by_us = recorded.is_some_and(|record| {
            record.method == Method::Link && record.target.as_ref() == Some(&target)
        });
        return if linked_by_us {
            Existing::Ours { current: false }
        } else {
            Existing::Foreign
        };
    }
    let Some(record) = recorded.filter(|record| record.method == Method::Copy) else {
        return Existing::Foreign;
    };
    if !metadata.is_file() {
        return Existing::Foreign;
    }
    let Ok(actual) = sha256_file(path) else {
        return Existing::Foreign;
    };
    if record.sha256.as_deref() != Some(actual.as_str()) {
        return Existing::Foreign;
    }
    let fresh = environment
        .bundled
        .as_deref()
        .and_then(|bundled| sha256_file(bundled).ok())
        .is_some_and(|bundled| bundled == actual);
    Existing::Ours {
        current: fresh && record.app == environment.appimage,
    }
}

fn installed_method(path: &Path) -> Method {
    match std::fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_symlink() => Method::Link,
        _ => Method::Copy,
    }
}

fn planned_method(environment: &Environment) -> Method {
    if environment.platform == Platform::Linux && environment.appimage.is_some() {
        Method::Copy
    } else {
        Method::Link
    }
}

fn translocated(bundled: &Path) -> bool {
    bundled
        .components()
        .any(|component| component.as_os_str() == "AppTranslocation")
}

fn writable_directory(path: &Path) -> bool {
    use std::os::unix::ffi::OsStrExt;
    if !path.is_dir() {
        return false;
    }
    let Ok(path) = std::ffi::CString::new(path.as_os_str().as_bytes()) else {
        return false;
    };
    unsafe { libc::access(path.as_ptr(), libc::W_OK) == 0 }
}

fn on_search_path(directory: &Path, entries: &[PathBuf]) -> bool {
    let wanted = normalized(directory);
    entries
        .iter()
        .filter(|entry| entry.is_absolute())
        .any(|entry| normalized(entry) == wanted)
}

fn normalized(path: &Path) -> PathBuf {
    path.canonicalize()
        .unwrap_or_else(|_| path.components().collect())
}

fn link_into_place(bundled: &Path, path: &Path) -> Result<(), AppError> {
    let staging = path.with_file_name(format!(
        ".{COMMAND_NAME}.oleafly-{}-{:016x}.tmp",
        std::process::id(),
        rand::random::<u64>()
    ));
    std::os::unix::fs::symlink(bundled, &staging).map_err(failed)?;
    std::fs::rename(&staging, path).map_err(|error| {
        let _ = std::fs::remove_file(&staging);
        failed(error)
    })
}

fn copy_into_place(bundled: &Path, path: &Path) -> Result<String, AppError> {
    let bytes = std::fs::read(bundled).map_err(failed)?;
    let mut transaction = crate::sandbox::AtomicFile::new(path).map_err(failed)?;
    let staged = transaction.staging_file_mut();
    staged.write_all(&bytes).map_err(failed)?;
    staged
        .set_permissions(std::fs::Permissions::from_mode(0o755))
        .map_err(failed)?;
    transaction.commit().map_err(failed)?;
    Ok(format!("{:x}", Sha256::digest(&bytes)))
}

fn sha256_file(path: &Path) -> std::io::Result<String> {
    Ok(format!("{:x}", Sha256::digest(std::fs::read(path)?)))
}

fn read_record(data_root: &Path) -> Option<Record> {
    let path = data_root.join(RECORD_FILE);
    let metadata = std::fs::symlink_metadata(&path).ok()?;
    if !metadata.is_file() || metadata.len() > MAX_RECORD_BYTES {
        return None;
    }
    serde_json::from_slice::<Record>(&std::fs::read(&path).ok()?)
        .ok()
        .filter(|record| record.version == RECORD_VERSION && record.path.is_absolute())
}

fn write_record(data_root: &Path, record: &Record) -> Result<(), AppError> {
    std::fs::create_dir_all(data_root).map_err(failed)?;
    let bytes = serde_json::to_vec_pretty(record).map_err(failed)?;
    crate::sandbox::atomic_write(&data_root.join(RECORD_FILE), &bytes).map_err(failed)
}

fn forget_record(data_root: &Path) -> Result<(), AppError> {
    match std::fs::remove_file(data_root.join(RECORD_FILE)) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(AppError::new("shell_command.remove_failed").detail(error)),
    }
}

fn failed(error: impl std::fmt::Display) -> AppError {
    AppError::new("shell_command.failed").detail(error)
}
