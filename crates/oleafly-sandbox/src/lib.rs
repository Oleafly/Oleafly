//! Process and filesystem boundaries for research-task commands and
//! experiment runs, shared by the Oleafly app, the CLI and the daemon.
//!
//! A [`SandboxSpec`] names the workspace (the command's folder), extra
//! read-only and read-write grants, a private home folder and whether the
//! network is allowed. [`command`] turns it into a confined
//! `std::process::Command`: `sandbox-exec` on macOS, bubblewrap on Linux and
//! an AppContainer inside a kill-on-close job object on Windows.
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

mod ledger;
#[cfg(any(target_os = "linux", test))]
mod linux;
#[cfg(any(target_os = "macos", test))]
mod macos;
pub mod process;
pub mod profile;
mod resolve;
pub mod selftest;
#[cfg(windows)]
pub mod windows;
// The pure Windows helpers (quoting, environment, launcher arguments) build
// and test on every system.
#[cfg(not(windows))]
#[path = "windows/cmdline.rs"]
#[allow(dead_code)]
mod windows_cmdline;
#[cfg(not(windows))]
#[path = "windows/env.rs"]
#[allow(dead_code)]
mod windows_env;
#[cfg(not(windows))]
#[path = "windows/launcher.rs"]
#[allow(dead_code)]
mod windows_launcher;

pub use ledger::SharedScope;
pub(crate) use resolve::{plain_path, resolve, ResolvedSpec};

#[cfg(test)]
mod tests;

/// What a confined command may touch.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SandboxSpec {
    /// The command's folder, readable as a whole. Writes need `read_write`.
    pub workspace: PathBuf,
    /// Extra read grants (runtimes, skill folders). System folders and the
    /// program are added by [`command`].
    pub read_only: Vec<PathBuf>,
    /// Write grants, inside the workspace or the home folder.
    pub read_write: Vec<PathBuf>,
    pub network: bool,
    /// GPU devices (Training run profile).
    #[serde(default)]
    pub gpu: bool,
    /// Applied after the fixed variables. The fixed ones (`RESERVED_ENV`)
    /// cannot be changed.
    #[serde(default)]
    pub env: BTreeMap<String, String>,
    /// The program starts helper processes (`posix_spawn`); Codex does.
    #[serde(default)]
    pub child_processes: bool,
    /// Private, writable HOME/TMP for the command.
    pub home: PathBuf,
    /// Who the command runs for (`task:<id>`). On Windows it names the
    /// task's AppContainer profile; empty only in self-tests.
    #[serde(default)]
    pub owner: String,
    /// The project id, the scope of `project_read_only` grants on Windows.
    #[serde(default)]
    pub project: Option<String>,
    /// The project's linked data folders (read-only).
    #[serde(default)]
    pub project_read_only: Vec<PathBuf>,
    /// Paths inside a write grant that stay read-only (a copy's `.git` and
    /// `.oleafly`).
    #[serde(default)]
    pub protected: Vec<PathBuf>,
    /// Folders placed before the platform's base `PATH`.
    #[serde(default)]
    pub path_prepend: Vec<PathBuf>,
}

impl SandboxSpec {
    pub fn new(owner: impl Into<String>, workspace: PathBuf, home: PathBuf) -> Self {
        Self {
            owner: owner.into(),
            workspace,
            home,
            ..Self::default()
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum SandboxError {
    #[error("{0}")]
    Unsupported(String),
    #[error("{0}")]
    Invalid(String),
    #[error("{0}")]
    Io(String),
}

impl From<SandboxError> for String {
    fn from(error: SandboxError) -> Self {
        error.to_string()
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "state", content = "reason", rename_all = "camelCase")]
pub enum Availability {
    Available,
    Unavailable(String),
}

pub const UNSUPPORTED_MESSAGE: &str =
    "Isolated task commands are not supported on this operating system yet.";

/// Variables a task cannot override.
pub const RESERVED_ENV: [&str; 6] = ["PATH", "HOME", "LANG", "TMPDIR", "TMP", "TEMP"];

/// Set inside every confined command: `macos`, `bubblewrap` or `appcontainer`.
pub const SANDBOX_ENV: &str = "OLEAFLY_SANDBOX";

/// `PATH` inside the sandbox on macOS and Linux.
pub const UNIX_TASK_PATH: &str =
    "/opt/homebrew/bin:/opt/local/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin";

/// Commands longer than this are refused (they belong in a script file).
pub const MAX_SHELL_TEXT: usize = 16 * 1024;

/// Where the sandbox keeps its own state, and which binary relaunches into
/// the Windows sandbox.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SandboxConfig {
    /// `<data root>/sandbox`: the Windows grant ledger and self-test folders.
    pub state_dir: PathBuf,
    /// The binary that handles `--oleafly-sandbox-launch`; the current
    /// executable when `None`.
    pub launcher: Option<PathBuf>,
}

static CONFIG: OnceLock<SandboxConfig> = OnceLock::new();

/// Sets the sandbox configuration; the first call wins.
pub fn configure(config: SandboxConfig) {
    let _ = CONFIG.set(config);
}

pub(crate) fn config() -> Option<&'static SandboxConfig> {
    CONFIG.get()
}

/// The shell a command string runs in.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ShellKind {
    /// `/bin/sh -c`.
    Posix,
    /// `cmd.exe /D /S /C`.
    Cmd,
}

/// The shell confined command strings run in on this system.
pub fn command_shell() -> ShellKind {
    if cfg!(windows) {
        ShellKind::Cmd
    } else {
        ShellKind::Posix
    }
}

/// Whether this machine can confine commands.
pub fn availability() -> Availability {
    #[cfg(target_os = "macos")]
    {
        if Path::new("/usr/bin/sandbox-exec").is_file() {
            Availability::Available
        } else {
            Availability::Unavailable(macos::MISSING_MESSAGE.into())
        }
    }
    #[cfg(target_os = "linux")]
    {
        match linux::bubblewrap() {
            Some(_) => Availability::Available,
            None => Availability::Unavailable(linux::MISSING_MESSAGE.into()),
        }
    }
    #[cfg(windows)]
    {
        windows::availability()
    }
    #[cfg(not(any(target_os = "macos", target_os = "linux", windows)))]
    {
        Availability::Unavailable(UNSUPPORTED_MESSAGE.into())
    }
}

/// The user's home directory (`HOME`, then `USERPROFILE`).
pub fn home_dir() -> Option<PathBuf> {
    std::env::var_os("HOME")
        .filter(|value| !value.is_empty())
        .or_else(|| std::env::var_os("USERPROFILE").filter(|value| !value.is_empty()))
        .map(PathBuf::from)
}

/// Check the private home folder and resolve it. Call this before creating
/// anything for the command, so a bad folder fails without side effects.
pub fn prepare_home(home: &Path) -> Result<PathBuf, SandboxError> {
    let metadata = std::fs::symlink_metadata(home).map_err(|_| {
        SandboxError::Invalid("The task command's temporary folder is unavailable.".into())
    })?;
    if !metadata.is_dir() || metadata.file_type().is_symlink() {
        return Err(SandboxError::Invalid(
            "The task command needs a real temporary folder.".into(),
        ));
    }
    home.canonicalize()
        .map_err(|error| SandboxError::Io(error.to_string()))
}

/// System folders a confined program may read (those that exist).
pub fn system_read_paths() -> Vec<PathBuf> {
    [
        "/System",
        "/usr",
        "/bin",
        "/sbin",
        "/lib",
        "/lib64",
        "/etc",
        "/private/etc",
        "/Library/Apple",
        "/Library/Developer",
        "/Library/Frameworks",
        "/private/var/db/dyld",
        "/private/var/db/timezone",
        "/opt/homebrew",
        "/opt/local",
    ]
    .into_iter()
    .map(PathBuf::from)
    .filter(|path| path.exists())
    .collect()
}

/// Resolve the extra read grants: each must exist and must not be the
/// filesystem root or the user's home folder.
pub fn resolve_read_grants(paths: &[PathBuf]) -> Result<Vec<PathBuf>, SandboxError> {
    let home = home_dir().and_then(|home| home.canonicalize().ok().or(Some(home)));
    let mut resolved = Vec::with_capacity(paths.len());
    for path in paths {
        let path = path
            .canonicalize()
            .map_err(|_| SandboxError::Invalid("A task runtime file is unavailable.".into()))?;
        if path.parent().is_none() || home.as_ref().is_some_and(|home| &path == home) {
            return Err(SandboxError::Invalid(
                "Task runtimes require specific readable files or folders.".into(),
            ));
        }
        resolved.push(path);
    }
    Ok(resolved)
}

fn check_env(spec: &SandboxSpec) -> Result<(), SandboxError> {
    for key in spec.env.keys() {
        if RESERVED_ENV
            .iter()
            .any(|reserved| reserved.eq_ignore_ascii_case(key))
        {
            return Err(SandboxError::Invalid(format!(
                "The task cannot change {key}."
            )));
        }
    }
    Ok(())
}

/// A confined command for `program args` under `spec`.
pub fn command(
    spec: &SandboxSpec,
    program: &Path,
    args: &[OsString],
) -> Result<std::process::Command, SandboxError> {
    check_env(spec)?;
    let resolved = resolve(spec)?;
    let program = program
        .canonicalize()
        .map(|path| plain_path(&path))
        .map_err(|_| SandboxError::Invalid("The task executable is unavailable.".into()))?;
    #[cfg(windows)]
    {
        windows::command(&resolved, &program, args)
    }
    #[cfg(not(windows))]
    {
        unix_command(spec, &resolved, &program, args)
    }
}

#[cfg(not(windows))]
fn unix_command(
    spec: &SandboxSpec,
    resolved: &ResolvedSpec,
    program: &Path,
    args: &[OsString],
) -> Result<std::process::Command, SandboxError> {
    create_home_folders(&resolved.home);
    let mut readable = system_read_paths();
    readable.push(program.to_path_buf());
    readable.extend(resolved.read_only.iter().cloned());
    readable.extend(resolved.project_read_only.iter().cloned());
    readable.sort();
    readable.dedup();
    let platform = PlatformRequest {
        program,
        args,
        root: &resolved.workspace,
        writable: &resolved.read_write,
        temp: &resolved.home,
        network: resolved.network,
        gpu: resolved.gpu,
        child_processes: resolved.child_processes,
        readable: &readable,
        protected: &resolved.protected,
    };
    let mut command = platform_command(&platform)?;
    command.env_clear();
    command.current_dir(&resolved.workspace);
    for (name, value) in unix_environment(&resolved.home, &resolved.path_prepend) {
        command.env(name, value);
    }
    for (name, value) in &spec.env {
        if name != SANDBOX_ENV {
            command.env(name, value);
        }
    }
    Ok(command)
}

/// The folders the base environment points at, created when missing.
#[cfg(not(windows))]
fn create_home_folders(home: &Path) {
    for folder in ["tmp", ".config", ".cache", ".local/state", ".local/share"] {
        let _ = std::fs::create_dir_all(home.join(folder));
    }
}

/// A confined command for the shell line `text` (`/bin/sh -c` on macOS and
/// Linux, `cmd.exe /D /S /C` on Windows).
pub fn shell_command(
    spec: &SandboxSpec,
    text: &str,
) -> Result<std::process::Command, SandboxError> {
    if text.trim().is_empty() || text.len() > MAX_SHELL_TEXT || text.contains('\0') {
        return Err(SandboxError::Invalid(
            "A command must be 1 to 16,384 bytes without NUL characters.".into(),
        ));
    }
    #[cfg(windows)]
    {
        check_env(spec)?;
        let resolved = resolve(spec)?;
        let wide: Vec<u16> = text.encode_utf16().collect();
        let line = windows::cmdline::cmd_line(&wide)?;
        windows::command_raw(&resolved, &windows::cmd_exe(), line)
    }
    #[cfg(not(windows))]
    {
        command(
            spec,
            Path::new("/bin/sh"),
            &[OsString::from("-c"), OsString::from(text)],
        )
    }
}

/// The variables every confined command starts with on macOS and Linux.
pub fn unix_environment(home: &Path, path_prepend: &[PathBuf]) -> Vec<(String, OsString)> {
    let mut path = String::new();
    for folder in path_prepend {
        path.push_str(&folder.to_string_lossy());
        path.push(':');
    }
    path.push_str(UNIX_TASK_PATH);
    let tmp = home.join("tmp").into_os_string();
    let sandbox = if cfg!(target_os = "macos") {
        "macos"
    } else {
        "bubblewrap"
    };
    vec![
        ("PATH".to_string(), OsString::from(path)),
        ("LANG".to_string(), OsString::from("en_US.UTF-8")),
        ("HOME".to_string(), home.as_os_str().to_os_string()),
        (
            "XDG_CONFIG_HOME".to_string(),
            home.join(".config").into_os_string(),
        ),
        (
            "XDG_CACHE_HOME".to_string(),
            home.join(".cache").into_os_string(),
        ),
        (
            "XDG_STATE_HOME".to_string(),
            home.join(".local/state").into_os_string(),
        ),
        (
            "XDG_DATA_HOME".to_string(),
            home.join(".local/share").into_os_string(),
        ),
        ("TMPDIR".to_string(), tmp.clone()),
        ("TMP".to_string(), tmp.clone()),
        ("TEMP".to_string(), tmp),
        (SANDBOX_ENV.to_string(), OsString::from(sandbox)),
    ]
}

/// The variables every confined command starts with (kept for callers of
/// 0.4.7's API; new code uses [`unix_environment`]).
pub fn fixed_environment(temp: &Path) -> Vec<(String, OsString)> {
    unix_environment(temp, &[])
}

/// Releases what the sandbox holds for `owner` (the Windows profile).
/// Nothing to do on macOS and Linux.
pub fn release(owner: &str) -> Result<(), SandboxError> {
    #[cfg(windows)]
    {
        windows::release(owner)
    }
    #[cfg(not(windows))]
    {
        let _ = owner;
        Ok(())
    }
}

/// Releases every owner not in `active_owners` (startup sweep). Returns how
/// many were released.
pub fn release_stale(active_owners: &[String]) -> Result<usize, SandboxError> {
    #[cfg(windows)]
    {
        windows::release_stale(active_owners)
    }
    #[cfg(not(windows))]
    {
        let _ = active_owners;
        Ok(0)
    }
}

/// A folder that stays readable to sandboxed commands across tasks
/// (Windows only).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SharedGrantView {
    pub path: PathBuf,
    /// `runtimes` or `project`.
    pub scope: String,
    pub project: Option<String>,
}

/// The shared read grants (interpreters, linked data folders) the Windows
/// sandbox holds; empty elsewhere.
pub fn shared_grants() -> Vec<SharedGrantView> {
    #[cfg(windows)]
    {
        windows::shared_grants()
    }
    #[cfg(not(windows))]
    {
        Vec::new()
    }
}

/// Removes shared read grants; returns how many were removed.
pub fn remove_shared_access(scope: SharedScope) -> Result<usize, SandboxError> {
    #[cfg(windows)]
    {
        windows::remove_shared_access(scope)
    }
    #[cfg(not(windows))]
    {
        let _ = scope;
        Ok(0)
    }
}

/// Handles the sandbox's own command-line entries before the app or CLI
/// starts: the Windows launcher, the self-test and a sandboxed run. Returns
/// the exit code when the arguments were one of them.
pub fn entry(config: impl FnOnce() -> Option<SandboxConfig>) -> Option<i32> {
    let argv: Vec<OsString> = std::env::args_os().skip(1).collect();
    let first = argv.first()?.to_str()?.to_owned();
    match first.as_str() {
        selftest::LAUNCH_FLAG => {
            #[cfg(windows)]
            {
                Some(match windows::launcher::decode(&argv[1..]) {
                    Ok(args) => windows::launcher::run(&args),
                    Err(error) => {
                        eprintln!("oleafly-sandbox: {error}");
                        2
                    }
                })
            }
            #[cfg(not(windows))]
            {
                eprintln!("oleafly-sandbox: the launcher runs on Windows only");
                Some(2)
            }
        }
        selftest::SELFTEST_FLAG | selftest::RUN_FLAG => {
            match config() {
                Some(config) => configure(config),
                None => {
                    if CONFIG.get().is_none() {
                        configure(SandboxConfig {
                            state_dir: std::env::temp_dir().join("oleafly-sandbox"),
                            launcher: None,
                        });
                    }
                }
            }
            Some(selftest::main(&first, &argv[1..]))
        }
        _ => None,
    }
}

// Only the macOS and Linux backends read the request.
#[cfg_attr(windows, allow(dead_code))]
pub(crate) struct PlatformRequest<'a> {
    pub program: &'a Path,
    pub args: &'a [OsString],
    pub root: &'a Path,
    pub writable: &'a [PathBuf],
    pub temp: &'a Path,
    pub network: bool,
    pub gpu: bool,
    pub child_processes: bool,
    pub readable: &'a [PathBuf],
    pub protected: &'a [PathBuf],
}

#[cfg(target_os = "macos")]
fn platform_command(request: &PlatformRequest<'_>) -> Result<std::process::Command, SandboxError> {
    macos::command(request)
}

#[cfg(target_os = "linux")]
fn platform_command(request: &PlatformRequest<'_>) -> Result<std::process::Command, SandboxError> {
    linux::command(request)
}

#[cfg(not(any(target_os = "macos", target_os = "linux", windows)))]
fn platform_command(_request: &PlatformRequest<'_>) -> Result<std::process::Command, SandboxError> {
    Err(SandboxError::Unsupported(UNSUPPORTED_MESSAGE.into()))
}
