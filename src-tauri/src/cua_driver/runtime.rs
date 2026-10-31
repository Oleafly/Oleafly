//! The Cua Driver daemons Oleafly runs, one per runtime kind: where they
//! listen, how they start (always bounded, with Oleafly's own manifest), the
//! persistent `cua-driver mcp --socket` session to each, the bounded
//! self-check, restarts, idle stops and cleanup after a crash.
//!
//! Calls on one runtime are serialized by its slot lock; different kinds run
//! in parallel. A call is retried only when the driver refused it (which
//! means nothing ran), never after it executed.

use std::collections::{BTreeMap, HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, RwLock};
use std::time::{Duration, Instant};

use serde_json::{json, Value};
use sha2::{Digest, Sha256};

use super::config::CuaDriverConfig;
use super::detect::{self, DriverInstall};
use super::manifest;
use super::policy::{self, RefusalKind};
use super::{lock, log, BoxFuture, Platform, RuntimeKind};
use crate::app_error::AppError;
use crate::mcp::client::{McpServerTool, McpSessionLimits, McpStdioSession};

pub(crate) const IDLE_STOP: Duration = Duration::from_secs(25 * 60);
pub(crate) const READY_TIMEOUT: Duration = Duration::from_secs(10);
/// The first launch of CuaDriver.app can take a while (Gatekeeper, Rosetta).
const MACOS_READY_TIMEOUT: Duration = Duration::from_secs(30);
pub(crate) const CALL_TIMEOUT: Duration = Duration::from_secs(45);
pub(crate) const BATCH_TIMEOUT: Duration = Duration::from_secs(75);
pub(crate) const MAX_MESSAGE_BYTES: usize = 16 * 1024 * 1024;
const READY_POLL: Duration = Duration::from_millis(200);
const SESSION_PROBE_TIMEOUT: Duration = Duration::from_secs(3);
const SESSION_OPEN_TIMEOUT: Duration = Duration::from_secs(10);
const SELF_CHECK_TIMEOUT: Duration = Duration::from_secs(10);
const END_SESSION_TIMEOUT: Duration = Duration::from_secs(5);
const STOP_COMMAND_TIMEOUT: Duration = Duration::from_secs(1);
const STATUS_TIMEOUT: Duration = Duration::from_secs(2);
const OPEN_TIMEOUT: Duration = Duration::from_secs(10);
/// `sun_path` is 104 bytes on macOS and 108 on Linux.
const MAX_UNIX_SOCKET_BYTES: usize = 100;
const LOG_TAIL_BYTES: u64 = 2048;
pub(crate) const STOP_WAIT: Duration = Duration::from_secs(3);
const SCAN_EVERY: Duration = Duration::from_secs(1);
#[cfg(unix)]
const PROCESS_LIST_TIMEOUT: Duration = Duration::from_secs(3);

pub(crate) const STOPPED_TEXT: &str = "Computer Use was changed or turned off in Settings, so Oleafly stopped this call. Check the app's state before you try again.";
pub(crate) const TIMEOUT_TEXT: &str = "Computer Use didn't answer in time, so Oleafly restarted the connection. Check the app's state before you try again.";
const NOT_CONFIGURED_TEXT: &str = "Computer Use has nothing allowed for this yet. The user can add apps and websites in Settings > Integrations > Computer Use.";
pub(crate) const TOO_LARGE_TEXT: &str = "Cua Driver's answer was larger than Oleafly can read, so it was left out. For get_window_state, pass include_screenshot: false or a smaller max_elements. If this was an action, it may have run: check the app's state before you try again.";
const TOO_LARGE_MARKER: &str = "server response exceeded the";

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct RuntimePaths {
    pub dir: PathBuf,
    pub endpoint: String,
    pub pid_file: PathBuf,
    pub owner_file: PathBuf,
    pub log_file: PathBuf,
}

fn root_tag(root: &Path) -> String {
    Sha256::digest(root.to_string_lossy().as_bytes())
        .iter()
        .take(4)
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

pub(crate) fn runtime_paths(root: &Path, kind: RuntimeKind, platform: Platform) -> RuntimePaths {
    let dir = root.join("cua");
    let name = kind.as_str();
    let tag = root_tag(root);
    let endpoint = match platform {
        Platform::Windows => format!(r"\\.\pipe\oleafly-cua-{name}-{tag}"),
        Platform::Macos | Platform::Linux => {
            let socket = dir
                .join(format!("{name}.sock"))
                .to_string_lossy()
                .into_owned();
            if socket.len() > MAX_UNIX_SOCKET_BYTES {
                std::env::temp_dir()
                    .join(format!("oleafly-cua-{tag}"))
                    .join(format!("{name}.sock"))
                    .to_string_lossy()
                    .into_owned()
            } else {
                socket
            }
        }
    };
    RuntimePaths {
        pid_file: dir.join(format!("{name}.pid")),
        owner_file: dir.join(format!("{name}.owner.json")),
        log_file: dir.join(format!("{name}.log")),
        dir,
        endpoint,
    }
}

#[derive(Debug, PartialEq)]
pub(crate) struct DaemonLaunch {
    pub program: String,
    pub args: Vec<String>,
    pub env: BTreeMap<String, String>,
    /// macOS: `open` hands the daemon to launchd and returns.
    pub detached: bool,
}

fn serve_args(paths: &RuntimePaths, manifest: &Path) -> Vec<String> {
    vec![
        "serve".into(),
        "--socket".into(),
        paths.endpoint.clone(),
        "--pid-file".into(),
        paths.pid_file.to_string_lossy().into_owned(),
        "--permission-mode".into(),
        "bounded".into(),
        "--capability-manifest".into(),
        manifest.to_string_lossy().into_owned(),
        "--approve-capability-manifest".into(),
    ]
}

/// The daemon's launch: on macOS through `open`, so the macOS permissions
/// stay with CuaDriver.app; elsewhere the program itself. Always bounded.
pub(crate) fn daemon_launch(
    platform: Platform,
    install: &DriverInstall,
    paths: &RuntimePaths,
    manifest: &Path,
    env: &BTreeMap<String, String>,
) -> Result<DaemonLaunch, String> {
    match platform {
        Platform::Macos => {
            let bundle = install
                .app_bundle
                .as_ref()
                .ok_or_else(|| detect::problem_error("no_app_bundle", Some(install)))?;
            let log = paths.log_file.to_string_lossy().into_owned();
            let mut args: Vec<String> = vec![
                "-n".into(),
                "-g".into(),
                "-a".into(),
                bundle.to_string_lossy().into_owned(),
                "--env".into(),
                "CUA_DRIVER_RS_TELEMETRY_ENABLED=false".into(),
                "--env".into(),
                "CUA_DRIVER_RS_UPDATE_CHECK=false".into(),
                "--stdout".into(),
                log.clone(),
                "--stderr".into(),
                log,
                "--args".into(),
            ];
            args.extend(serve_args(paths, manifest));
            Ok(DaemonLaunch {
                program: "/usr/bin/open".into(),
                args,
                env: BTreeMap::new(),
                detached: true,
            })
        }
        Platform::Windows | Platform::Linux => Ok(DaemonLaunch {
            program: install.binary.to_string_lossy().into_owned(),
            args: serve_args(paths, manifest),
            env: env.clone(),
            detached: false,
        }),
    }
}

pub(crate) fn mcp_args(paths: &RuntimePaths) -> Vec<String> {
    vec!["mcp".into(), "--socket".into(), paths.endpoint.clone()]
}

const WINDOWS_ENV: &[&str] = &[
    "SystemRoot",
    "SystemDrive",
    "windir",
    "ComSpec",
    "PATHEXT",
    "TEMP",
    "TMP",
    "USERPROFILE",
    "USERNAME",
    "USERDOMAIN",
    "LOCALAPPDATA",
    "APPDATA",
    "ProgramData",
    "ProgramFiles",
    "ProgramFiles(x86)",
    "ProgramW6432",
    "CommonProgramFiles",
    "HOMEDRIVE",
    "HOMEPATH",
    "NUMBER_OF_PROCESSORS",
    "PROCESSOR_ARCHITECTURE",
    "OS",
];

const LINUX_ENV: &[&str] = &[
    "HOME",
    "USER",
    "LOGNAME",
    "LANG",
    "LC_ALL",
    "LC_CTYPE",
    "TMPDIR",
    "XDG_RUNTIME_DIR",
    "XDG_SESSION_TYPE",
    "XDG_CURRENT_DESKTOP",
    "XDG_SESSION_DESKTOP",
    "XDG_DATA_DIRS",
    "XDG_DATA_HOME",
    "XDG_CONFIG_HOME",
    "XDG_CACHE_HOME",
    "DISPLAY",
    "WAYLAND_DISPLAY",
    "XAUTHORITY",
    "DBUS_SESSION_BUS_ADDRESS",
    "AT_SPI_BUS_ADDRESS",
    "CUA_DRIVER_RS_ENABLE_WAYLAND",
    "CUA_DRIVER_RS_HOME",
];

/// For the `mcp` client only: the macOS daemon gets its environment from
/// `open --env`.
const MACOS_ENV: &[&str] = &[
    "HOME",
    "USER",
    "LOGNAME",
    "TMPDIR",
    "LANG",
    "LC_ALL",
    "__CF_USER_TEXT_ENCODING",
];

fn daemon_path(
    platform: Platform,
    lookup: &dyn Fn(&str) -> Option<String>,
    base: &std::ffi::OsStr,
) -> String {
    let appdir = (platform == Platform::Linux)
        .then(|| lookup("APPDIR"))
        .flatten()
        .filter(|dir| dir.starts_with('/') && dir.len() > 1);
    let kept: Vec<PathBuf> = std::env::split_paths(base)
        .filter(|entry| {
            appdir
                .as_deref()
                .is_none_or(|appdir| !entry.starts_with(appdir))
        })
        .collect();
    std::env::join_paths(kept)
        .map(|joined| joined.to_string_lossy().into_owned())
        .unwrap_or_default()
}

pub(crate) fn daemon_env(
    platform: Platform,
    lookup: &dyn Fn(&str) -> Option<String>,
) -> BTreeMap<String, String> {
    let names = match platform {
        Platform::Windows => WINDOWS_ENV,
        Platform::Linux => LINUX_ENV,
        Platform::Macos => MACOS_ENV,
    };
    let mut env: BTreeMap<String, String> = names
        .iter()
        .filter_map(|name| {
            lookup(name)
                .filter(|value| !value.is_empty() && !value.contains('\0'))
                .map(|value| ((*name).to_string(), value))
        })
        .collect();
    let path = daemon_path(
        platform,
        lookup,
        &crate::program_locator::child_search_path(&[], &[]),
    );
    if !path.is_empty() {
        env.insert("PATH".into(), path);
    }
    env.insert("CUA_DRIVER_RS_TELEMETRY_ENABLED".into(), "false".into());
    env.insert("CUA_DRIVER_RS_UPDATE_CHECK".into(), "false".into());
    env
}

fn process_env(name: &str) -> Option<String> {
    std::env::var(name).ok()
}

pub(crate) enum DaemonHandle {
    Child {
        child: Box<tokio::process::Child>,
        guard: Option<crate::proc::ProcessTreeGuard>,
    },
    Detached {
        pid: u32,
        started: Option<u64>,
    },
    #[cfg_attr(not(test), allow(dead_code))]
    None,
}

impl DaemonHandle {
    fn pid(&self) -> Option<u32> {
        match self {
            Self::Child { child, .. } => child.id(),
            Self::Detached { pid, .. } => (*pid != 0).then_some(*pid),
            Self::None => None,
        }
    }

    fn started(&self) -> Option<u64> {
        match self {
            Self::Detached { started, .. } => *started,
            other => other
                .pid()
                .and_then(|pid| match crate::process_identity::probe(pid) {
                    crate::process_identity::ProcessProbe::Running { started } => started,
                    crate::process_identity::ProcessProbe::Gone => None,
                }),
        }
    }

    fn alive(&mut self) -> bool {
        match self {
            Self::Child { child, .. } => matches!(child.try_wait(), Ok(None)),
            Self::Detached { pid, started } => same_process(*pid, *started),
            Self::None => true,
        }
    }
}

fn same_process(pid: u32, started: Option<u64>) -> bool {
    pid != 0
        && matches!(
            crate::process_identity::probe(pid),
            crate::process_identity::ProcessProbe::Running { started: now } if started.is_none() || now == started
        )
}

pub(crate) trait Launcher: Send + Sync {
    fn locate(&self) -> BoxFuture<'_, Result<DriverInstall, String>>;
    fn start_daemon<'a>(
        &'a self,
        launch: &'a DaemonLaunch,
        paths: &'a RuntimePaths,
    ) -> BoxFuture<'a, Result<DaemonHandle, String>>;
    fn wait_ready<'a>(
        &'a self,
        install: &'a DriverInstall,
        paths: &'a RuntimePaths,
        handle: &'a mut DaemonHandle,
    ) -> BoxFuture<'a, Result<(), String>>;
    fn open_session<'a>(
        &'a self,
        install: &'a DriverInstall,
        paths: &'a RuntimePaths,
        env: &'a BTreeMap<String, String>,
    ) -> BoxFuture<'a, Result<McpStdioSession, String>>;
    fn stop_daemon<'a>(
        &'a self,
        install: &'a DriverInstall,
        paths: &'a RuntimePaths,
        handle: DaemonHandle,
    ) -> BoxFuture<'a, ()>;
}

pub(crate) fn start_failed(detail: &str) -> String {
    AppError::new("desktop_apps.start_failed")
        .param("detail", detail)
        .into()
}

fn log_tail(path: &Path) -> Option<String> {
    use std::io::{Read, Seek, SeekFrom};
    let mut file = std::fs::File::open(path).ok()?;
    let length = file.metadata().ok()?.len();
    file.seek(SeekFrom::Start(length.saturating_sub(LOG_TAIL_BYTES)))
        .ok()?;
    let mut bytes = Vec::new();
    file.take(LOG_TAIL_BYTES).read_to_end(&mut bytes).ok()?;
    let text = String::from_utf8_lossy(&bytes)
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    (!text.is_empty()).then_some(text)
}

/// macOS: whether the daemon's log shows it stopped at its own permissions
/// prompt (a missing Accessibility or Screen Recording grant), which makes it
/// miss the self-check or start too slowly.
fn waiting_for_permissions(log: &Path) -> bool {
    log_tail(log)
        .is_some_and(|tail| tail.contains("needs your permission before desktop tools can run"))
}

fn start_error(paths: &RuntimePaths, error: String) -> String {
    if waiting_for_permissions(&paths.log_file) {
        AppError::new("desktop_apps.needs_permissions").into()
    } else {
        error
    }
}

fn read_pid(path: &Path) -> Option<u32> {
    std::fs::read_to_string(path).ok()?.trim().parse().ok()
}

#[cfg(any(unix, test))]
pub(crate) fn parse_serving_pids(listing: &str, endpoint: &str, own_pid: u32) -> Vec<u32> {
    let needle = format!("serve --socket {endpoint}");
    listing
        .lines()
        .filter_map(|line| {
            let line = line.trim_start();
            let (pid, command) = line.split_once(char::is_whitespace)?;
            let pid: u32 = pid.parse().ok()?;
            let serving = command.match_indices(&needle).any(|(start, _)| {
                command[start + needle.len()..]
                    .chars()
                    .next()
                    .is_none_or(char::is_whitespace)
            });
            (serving && pid != own_pid).then_some(pid)
        })
        .collect()
}

#[cfg(unix)]
fn serving_pids(endpoint: &str) -> Vec<u32> {
    let mut command = std::process::Command::new("ps");
    command
        .args(["-axww", "-o", "pid=,command="])
        .stdin(std::process::Stdio::null());
    let Ok(output) = crate::proc::output_contained_with_timeout(command, PROCESS_LIST_TIMEOUT)
    else {
        return Vec::new();
    };
    parse_serving_pids(
        &String::from_utf8_lossy(&output.stdout),
        endpoint,
        std::process::id(),
    )
}

/// Windows daemons live in a job object that ends them with Oleafly, and a
/// process listing there is slow: records only.
#[cfg(not(unix))]
fn serving_pids(_endpoint: &str) -> Vec<u32> {
    Vec::new()
}

fn kill_identified(pid: u32, started: Option<u64>) {
    if !same_process(pid, started) {
        return;
    }
    #[cfg(unix)]
    {
        let Ok(raw) = libc::pid_t::try_from(pid) else {
            return;
        };
        unsafe {
            libc::kill(raw, libc::SIGTERM);
        }
        let deadline = Instant::now() + Duration::from_millis(800);
        while Instant::now() < deadline {
            if !same_process(pid, started) {
                return;
            }
            std::thread::sleep(Duration::from_millis(50));
        }
        if same_process(pid, started) {
            unsafe {
                libc::kill(raw, libc::SIGKILL);
            }
        }
    }
    #[cfg(windows)]
    unsafe {
        use windows_sys::Win32::Foundation::CloseHandle;
        use windows_sys::Win32::System::Threading::{
            OpenProcess, TerminateProcess, PROCESS_TERMINATE,
        };
        let handle = OpenProcess(PROCESS_TERMINATE, 0, pid);
        if !handle.is_null() {
            TerminateProcess(handle, 1);
            CloseHandle(handle);
        }
    }
}

fn remove_runtime_files(paths: &RuntimePaths, platform: Platform) {
    if platform != Platform::Windows {
        let _ = std::fs::remove_file(&paths.endpoint);
    }
    let _ = std::fs::remove_file(&paths.pid_file);
    let _ = std::fs::remove_file(&paths.owner_file);
}

#[derive(serde::Serialize, serde::Deserialize)]
struct OwnerRecord {
    pid: u32,
    started: Option<u64>,
    endpoint: String,
}

fn write_owner_file(paths: &RuntimePaths, handle: &DaemonHandle) {
    let Some(pid) = handle.pid() else {
        return;
    };
    let record = OwnerRecord {
        pid,
        started: handle.started(),
        endpoint: paths.endpoint.clone(),
    };
    if let Ok(text) = serde_json::to_string(&record) {
        if std::fs::write(&paths.owner_file, text).is_ok() {
            crate::fsperm::harden_file(&paths.owner_file);
        }
    }
}

pub(crate) fn stop_stale_daemon(paths: &RuntimePaths) {
    let Some(platform) = Platform::current() else {
        return;
    };
    let record = std::fs::read_to_string(&paths.owner_file)
        .ok()
        .and_then(|text| serde_json::from_str::<OwnerRecord>(&text).ok());
    if let Some(record) = record {
        if record.endpoint == paths.endpoint && record.started.is_some() {
            kill_identified(record.pid, record.started);
        }
    }
    for pid in serving_pids(&paths.endpoint) {
        kill_identified(pid, None);
    }
    remove_runtime_files(paths, platform);
}

pub(crate) struct ProcessLauncher {
    platform: Platform,
}

impl ProcessLauncher {
    pub(crate) fn new(platform: Platform) -> Self {
        Self { platform }
    }
}

fn stopped_early(paths: &RuntimePaths, status: std::process::ExitStatus) -> String {
    start_failed(&log_tail(&paths.log_file).unwrap_or_else(|| format!("it stopped ({status}).")))
}

fn ready_timeout(platform: Platform) -> Duration {
    if platform == Platform::Macos {
        MACOS_READY_TIMEOUT
    } else {
        READY_TIMEOUT
    }
}

impl Launcher for ProcessLauncher {
    fn locate(&self) -> BoxFuture<'_, Result<DriverInstall, String>> {
        let platform = self.platform;
        Box::pin(async move {
            tokio::task::spawn_blocking(move || detect::detect_install(platform))
                .await
                .ok()
                .flatten()
                .ok_or_else(|| detect::problem_error("not_installed", None))
        })
    }

    fn start_daemon<'a>(
        &'a self,
        launch: &'a DaemonLaunch,
        paths: &'a RuntimePaths,
    ) -> BoxFuture<'a, Result<DaemonHandle, String>> {
        Box::pin(async move {
            use crate::proc::NoConsole;
            use std::process::Stdio;
            if launch.detached {
                let mut command = tokio::process::Command::new(&launch.program);
                command
                    .args(&launch.args)
                    .stdin(Stdio::null())
                    .stdout(Stdio::null())
                    .stderr(Stdio::null())
                    .kill_on_drop(true);
                let status = tokio::time::timeout(OPEN_TIMEOUT, command.status())
                    .await
                    .map_err(|_| start_failed("the launch did not finish."))?
                    .map_err(|error| start_failed(&error.to_string()))?;
                if !status.success() {
                    return Err(stopped_early(paths, status));
                }
                return Ok(DaemonHandle::Detached {
                    pid: 0,
                    started: None,
                });
            }
            let log = tokio::fs::File::create(&paths.log_file)
                .await
                .map_err(|error| start_failed(&error.to_string()))?
                .into_std()
                .await;
            crate::fsperm::harden_file(&paths.log_file);
            let log_err = log
                .try_clone()
                .map_err(|error| start_failed(&error.to_string()))?;
            let mut command = tokio::process::Command::new(&launch.program);
            command
                .no_console()
                .args(&launch.args)
                .env_clear()
                .envs(&launch.env)
                .stdin(Stdio::null())
                .stdout(Stdio::from(log))
                .stderr(Stdio::from(log_err))
                .kill_on_drop(true);
            crate::proc::isolate_process_tree(&mut command);
            let mut child = command
                .spawn()
                .map_err(|error| start_failed(&error.to_string()))?;
            let Some(pid) = child.id() else {
                let _ = child.start_kill();
                return Err(start_failed("it did not report a process id."));
            };
            match crate::proc::contain_process_tree(pid) {
                Ok(guard) => Ok(DaemonHandle::Child {
                    child: Box::new(child),
                    guard: Some(guard),
                }),
                Err(error) => {
                    let _ = child.start_kill();
                    Err(start_failed(&error.to_string()))
                }
            }
        })
    }

    fn wait_ready<'a>(
        &'a self,
        install: &'a DriverInstall,
        paths: &'a RuntimePaths,
        handle: &'a mut DaemonHandle,
    ) -> BoxFuture<'a, Result<(), String>> {
        let platform = self.platform;
        Box::pin(async move {
            let timeout = ready_timeout(platform);
            let deadline = Instant::now() + timeout;
            let mut last_scan: Option<Instant> = None;
            loop {
                if let DaemonHandle::Child { child, .. } = handle {
                    if let Ok(Some(status)) = child.try_wait() {
                        return Err(stopped_early(paths, status));
                    }
                }
                let ready = match platform {
                    Platform::Windows => windows_ready(install, paths).await,
                    Platform::Macos => {
                        record_daemon_pid(paths, handle, &mut last_scan).await;
                        macos_ready(paths, handle)?
                    }
                    Platform::Linux => Path::new(&paths.endpoint).exists(),
                };
                if ready {
                    return Ok(());
                }
                if Instant::now() >= deadline {
                    let detail = log_tail(&paths.log_file).unwrap_or_else(|| {
                        format!("it was not ready after {} seconds.", timeout.as_secs())
                    });
                    return Err(start_failed(&detail));
                }
                tokio::time::sleep(READY_POLL).await;
            }
        })
    }

    fn open_session<'a>(
        &'a self,
        install: &'a DriverInstall,
        paths: &'a RuntimePaths,
        env: &'a BTreeMap<String, String>,
    ) -> BoxFuture<'a, Result<McpStdioSession, String>> {
        Box::pin(async move {
            McpStdioSession::open(
                &install.binary.to_string_lossy(),
                &mcp_args(paths),
                env,
                McpSessionLimits {
                    max_message_bytes: MAX_MESSAGE_BYTES,
                    probe_timeout: SESSION_PROBE_TIMEOUT,
                    open_timeout: SESSION_OPEN_TIMEOUT,
                },
            )
            .await
            .map_err(|error| start_failed(&error))
        })
    }

    fn stop_daemon<'a>(
        &'a self,
        install: &'a DriverInstall,
        paths: &'a RuntimePaths,
        handle: DaemonHandle,
    ) -> BoxFuture<'a, ()> {
        let platform = self.platform;
        Box::pin(async move {
            let binary = install.binary.clone();
            let endpoint = paths.endpoint.clone();
            let _ = tokio::task::spawn_blocking(move || {
                detect::run_driver(
                    &binary,
                    &["stop", "--socket", endpoint.as_str()],
                    STOP_COMMAND_TIMEOUT,
                )
            })
            .await;
            match handle {
                DaemonHandle::Child { mut child, guard } => {
                    let _ = child.start_kill();
                    let _ = tokio::time::timeout(Duration::from_millis(500), child.wait()).await;
                    drop(guard);
                }
                DaemonHandle::Detached { pid, started } => {
                    let pid_file = paths.pid_file.clone();
                    let endpoint = paths.endpoint.clone();
                    let _ = tokio::task::spawn_blocking(move || {
                        let mut targets: Vec<(u32, Option<u64>)> = Vec::new();
                        if pid != 0 {
                            targets.push((pid, started));
                        } else if let Some(pid) = read_pid(&pid_file) {
                            targets.push((pid, None));
                        }
                        for found in serving_pids(&endpoint) {
                            if !targets.iter().any(|(known, _)| *known == found) {
                                targets.push((found, None));
                            }
                        }
                        for (pid, started) in targets {
                            kill_identified(pid, started);
                        }
                    })
                    .await;
                }
                DaemonHandle::None => {}
            }
            remove_runtime_files(paths, platform);
        })
    }
}

async fn windows_ready(install: &DriverInstall, paths: &RuntimePaths) -> bool {
    let binary = install.binary.clone();
    let endpoint = paths.endpoint.clone();
    tokio::task::spawn_blocking(move || {
        detect::run_driver(
            &binary,
            &["status", "--socket", endpoint.as_str()],
            STATUS_TIMEOUT,
        )
    })
    .await
    .ok()
    .flatten()
    .is_some_and(|(ok, _, _)| ok)
}

async fn record_daemon_pid(
    paths: &RuntimePaths,
    handle: &mut DaemonHandle,
    last_scan: &mut Option<Instant>,
) {
    if matches!(handle, DaemonHandle::Detached { pid, .. } if *pid != 0) {
        return;
    }
    let mut pid = read_pid(&paths.pid_file).filter(|pid| same_process(*pid, None));
    if pid.is_none() && last_scan.is_none_or(|at| at.elapsed() >= SCAN_EVERY) {
        *last_scan = Some(Instant::now());
        let endpoint = paths.endpoint.clone();
        pid = tokio::task::spawn_blocking(move || serving_pids(&endpoint))
            .await
            .ok()
            .and_then(|pids| pids.into_iter().next());
    }
    if let Some(pid) = pid {
        let started = match crate::process_identity::probe(pid) {
            crate::process_identity::ProcessProbe::Running { started } => started,
            crate::process_identity::ProcessProbe::Gone => None,
        };
        *handle = DaemonHandle::Detached { pid, started };
        write_owner_file(paths, handle);
    }
}

fn macos_ready(paths: &RuntimePaths, handle: &DaemonHandle) -> Result<bool, String> {
    match handle {
        DaemonHandle::Detached { pid, started } if *pid != 0 => {
            if !same_process(*pid, *started) {
                return Err(start_failed(
                    &log_tail(&paths.log_file).unwrap_or_else(|| "it stopped.".to_string()),
                ));
            }
            Ok(Path::new(&paths.endpoint).exists())
        }
        _ => Ok(false),
    }
}

struct Live {
    install: DriverInstall,
    paths: RuntimePaths,
    daemon: Option<DaemonHandle>,
    session: Option<McpStdioSession>,
    manifest_hash: String,
    started_labels: HashSet<String>,
    tools: Vec<McpServerTool>,
    reconnect: bool,
}

#[derive(Default)]
struct Slot {
    live: Option<Live>,
    last_used: Option<Instant>,
}

enum LabelState {
    Ready,
    Restart,
    Refused(Value),
}

fn is_error(result: &Value) -> bool {
    result.get("isError").and_then(Value::as_bool) == Some(true)
}

fn text_result(text: &str, error: bool) -> Value {
    json!({"content": [{"type": "text", "text": text}], "isError": error})
}

struct Active {
    hash: String,
    started: bool,
}

pub(crate) struct Runtimes {
    config: Arc<RwLock<CuaDriverConfig>>,
    launcher: Arc<dyn Launcher>,
    root: PathBuf,
    platform: Platform,
    slots: HashMap<RuntimeKind, Arc<tokio::sync::Mutex<Slot>>>,
    active: Mutex<HashMap<RuntimeKind, Active>>,
    cancel: HashMap<RuntimeKind, tokio::sync::watch::Sender<u64>>,
    known_tools: Mutex<HashMap<RuntimeKind, Vec<McpServerTool>>>,
}

struct Starting<'a> {
    runtimes: &'a Runtimes,
    kind: RuntimeKind,
    finished: bool,
}

impl<'a> Starting<'a> {
    fn new(runtimes: &'a Runtimes, kind: RuntimeKind, hash: &str) -> Self {
        lock(&runtimes.active).insert(
            kind,
            Active {
                hash: hash.to_string(),
                started: false,
            },
        );
        Self {
            runtimes,
            kind,
            finished: false,
        }
    }

    fn finish(&mut self) {
        if let Some(active) = lock(&self.runtimes.active).get_mut(&self.kind) {
            active.started = true;
        }
        self.finished = true;
    }
}

impl Drop for Starting<'_> {
    fn drop(&mut self) {
        if !self.finished {
            lock(&self.runtimes.active).remove(&self.kind);
        }
    }
}

impl Runtimes {
    pub(crate) fn new(
        config: Arc<RwLock<CuaDriverConfig>>,
        launcher: Arc<dyn Launcher>,
        root: PathBuf,
        platform: Platform,
    ) -> Self {
        Self {
            config,
            launcher,
            root,
            platform,
            slots: RuntimeKind::ALL
                .iter()
                .map(|kind| (*kind, Arc::new(tokio::sync::Mutex::new(Slot::default()))))
                .collect(),
            active: Mutex::new(HashMap::new()),
            cancel: RuntimeKind::ALL
                .iter()
                .map(|kind| (*kind, tokio::sync::watch::channel(0).0))
                .collect(),
            known_tools: Mutex::new(HashMap::new()),
        }
    }

    pub(crate) fn known_tools(&self, kind: RuntimeKind) -> Vec<McpServerTool> {
        lock(&self.known_tools)
            .get(&kind)
            .cloned()
            .unwrap_or_default()
    }

    fn slot(&self, kind: RuntimeKind) -> Arc<tokio::sync::Mutex<Slot>> {
        self.slots[&kind].clone()
    }

    fn settings(&self) -> CuaDriverConfig {
        self.config
            .read()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .clone()
    }

    pub(crate) fn rendered_manifest(&self, kind: RuntimeKind) -> Option<(String, String)> {
        let manifest = manifest::build_manifest(&self.settings(), kind)?;
        let rendered = manifest::render_manifest(&manifest);
        let hash: String = Sha256::digest(rendered.as_bytes())
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect();
        Some((rendered, hash))
    }

    pub(crate) fn running(&self) -> Vec<RuntimeKind> {
        let active = lock(&self.active);
        RuntimeKind::ALL
            .into_iter()
            .filter(|kind| active.get(kind).is_some_and(|active| active.started))
            .collect()
    }

    pub(crate) fn has_daemons(&self) -> bool {
        !lock(&self.active).is_empty()
    }

    pub(crate) fn stale_kinds(&self) -> Vec<RuntimeKind> {
        let hashes: Vec<(RuntimeKind, String)> = {
            let active = lock(&self.active);
            RuntimeKind::ALL
                .into_iter()
                .filter_map(|kind| Some((kind, active.get(&kind)?.hash.clone())))
                .collect()
        };
        hashes
            .into_iter()
            .filter(|(kind, hash)| {
                self.rendered_manifest(*kind)
                    .map(|(_, wanted)| wanted)
                    .as_ref()
                    != Some(hash)
            })
            .map(|(kind, _)| kind)
            .collect()
    }

    pub(crate) fn cancel(&self, kinds: &[RuntimeKind]) {
        for kind in kinds {
            self.cancel[kind].send_modify(|count| *count = count.wrapping_add(1));
        }
    }

    fn paths(&self, kind: RuntimeKind) -> RuntimePaths {
        runtime_paths(&self.root, kind, self.platform)
    }

    pub(crate) fn has_owner_records(&self) -> bool {
        RuntimeKind::ALL
            .into_iter()
            .any(|kind| self.paths(kind).owner_file.exists())
    }

    pub(crate) async fn kill_by_records(&self) {
        let kills: Vec<_> = RuntimeKind::ALL
            .into_iter()
            .map(|kind| {
                let paths = self.paths(kind);
                tokio::task::spawn_blocking(move || stop_stale_daemon(&paths))
            })
            .collect();
        for kill in kills {
            let _ = kill.await;
        }
    }

    pub(crate) async fn call(
        &self,
        kind: RuntimeKind,
        label: &str,
        tool: &str,
        args: Value,
        timeout: Duration,
    ) -> Result<Value, String> {
        let slot = self.slot(kind);
        let mut slot = slot.lock().await;
        let mut retried = false;
        loop {
            self.ensure_started(kind, &mut slot).await?;
            match self.ensure_label(kind, &mut slot, label).await? {
                LabelState::Ready => {}
                LabelState::Restart if !retried => {
                    retried = true;
                    self.stop_slot(kind, &mut slot).await;
                    continue;
                }
                LabelState::Restart => return Ok(text_result(policy::RESTART_TEXT, true)),
                LabelState::Refused(result) => return Ok(result),
            }
            let result = self
                .call_once(kind, &mut slot, tool, args.clone(), timeout)
                .await?;
            match policy::refusal(&result).map(|(refusal, _)| refusal) {
                Some(RefusalKind::Expired) if !retried => {
                    retried = true;
                    self.stop_slot(kind, &mut slot).await;
                }
                Some(RefusalKind::SessionEnded) if !retried => {
                    retried = true;
                    if let Some(live) = slot.live.as_mut() {
                        live.started_labels.remove(label);
                    }
                }
                _ => return Ok(result),
            }
        }
    }

    pub(crate) async fn ensure_session(
        &self,
        kind: RuntimeKind,
        label: &str,
    ) -> Result<Value, String> {
        let slot = self.slot(kind);
        let mut slot = slot.lock().await;
        let mut retried = false;
        loop {
            self.ensure_started(kind, &mut slot).await?;
            match self.ensure_label(kind, &mut slot, label).await? {
                LabelState::Ready => return Ok(text_result("Session started.", false)),
                LabelState::Restart if !retried => {
                    retried = true;
                    self.stop_slot(kind, &mut slot).await;
                }
                LabelState::Restart => return Ok(text_result(policy::RESTART_TEXT, true)),
                LabelState::Refused(result) => return Ok(result),
            }
        }
    }

    pub(crate) async fn tools(&self, kind: RuntimeKind) -> Result<Vec<McpServerTool>, String> {
        let slot = self.slot(kind);
        let mut slot = slot.lock().await;
        self.ensure_started(kind, &mut slot).await?;
        Ok(slot
            .live
            .as_ref()
            .map(|live| live.tools.clone())
            .unwrap_or_default())
    }

    pub(crate) async fn end_session(&self, label: &str) {
        for kind in RuntimeKind::ALL {
            let slot = self.slot(kind);
            let mut slot = slot.lock().await;
            let started = slot
                .live
                .as_ref()
                .is_some_and(|live| live.started_labels.contains(label));
            if !started {
                continue;
            }
            let _ = self
                .call_once(
                    kind,
                    &mut slot,
                    "end_session",
                    json!({"session": label}),
                    END_SESSION_TIMEOUT,
                )
                .await;
            if let Some(live) = slot.live.as_mut() {
                live.started_labels.remove(label);
            }
        }
    }

    pub(crate) async fn stop(&self, kind: RuntimeKind) {
        let slot = self.slot(kind);
        let mut slot = slot.lock().await;
        self.stop_slot(kind, &mut slot).await;
    }

    pub(crate) async fn stop_within(&self, kinds: &[RuntimeKind], wait: Duration) {
        futures_util::future::join_all(kinds.iter().map(|kind| self.stop_or_kill(*kind, wait)))
            .await;
    }

    async fn stop_or_kill(&self, kind: RuntimeKind, wait: Duration) {
        if tokio::time::timeout(wait, self.stop(kind)).await.is_ok() {
            return;
        }
        let paths = self.paths(kind);
        let _ = tokio::task::spawn_blocking(move || stop_stale_daemon(&paths)).await;
    }

    pub(crate) async fn stop_all(&self) {
        self.stop_within(&RuntimeKind::ALL, STOP_WAIT).await;
    }

    pub(crate) async fn stop_changed(&self) {
        self.stop_within(&self.stale_kinds(), STOP_WAIT).await;
    }

    pub(crate) async fn stop_idle(&self, now: Instant) {
        for kind in RuntimeKind::ALL {
            let slot = self.slot(kind);
            let Ok(mut slot) = slot.try_lock() else {
                continue;
            };
            let idle = slot.live.is_some()
                && slot
                    .last_used
                    .is_none_or(|used| now.saturating_duration_since(used) >= IDLE_STOP);
            if idle {
                self.stop_slot(kind, &mut slot).await;
                log(format!(
                    "desktop apps: {} runtime stopped after idling",
                    kind.as_str()
                ));
            }
        }
    }

    async fn ensure_started(&self, kind: RuntimeKind, slot: &mut Slot) -> Result<(), String> {
        let Some((rendered, hash)) = self.rendered_manifest(kind) else {
            self.stop_slot(kind, slot).await;
            return Err(NOT_CONFIGURED_TEXT.into());
        };
        if let Some(live) = slot.live.as_mut() {
            let daemon_ok =
                live.manifest_hash == hash && live.daemon.as_mut().is_some_and(DaemonHandle::alive);
            if daemon_ok && live.session.is_some() {
                return Ok(());
            }
            if daemon_ok && self.reopen_session(slot).await {
                return Ok(());
            }
            self.stop_slot(kind, slot).await;
        }
        self.start_slot(kind, slot, rendered, hash).await
    }

    async fn reopen_session(&self, slot: &mut Slot) -> bool {
        let Some(live) = slot
            .live
            .as_mut()
            .filter(|live| live.session.is_none() && live.reconnect)
        else {
            return false;
        };
        live.reconnect = false;
        let env = daemon_env(self.platform, &process_env);
        match self
            .launcher
            .open_session(&live.install, &live.paths, &env)
            .await
        {
            Ok(session) => {
                live.session = Some(session);
                true
            }
            Err(_) => false,
        }
    }

    async fn start_slot(
        &self,
        kind: RuntimeKind,
        slot: &mut Slot,
        rendered: String,
        hash: String,
    ) -> Result<(), String> {
        let cancel = self.cancel[&kind].subscribe();
        let mut starting = Starting::new(self, kind, &hash);
        let install = self.launcher.locate().await?;
        if let Some(problem) = install.problem(self.platform) {
            return Err(detect::problem_error(problem, Some(&install)));
        }
        let paths = runtime_paths(&self.root, kind, self.platform);
        let platform = self.platform;
        let prepared_paths = paths.clone();
        let manifest_path = tokio::task::spawn_blocking(move || {
            let paths = prepared_paths;
            manifest::ensure_private_dir(&paths.dir)?;
            if platform != Platform::Windows {
                if let Some(parent) = Path::new(&paths.endpoint).parent() {
                    manifest::ensure_private_dir(parent)?;
                }
            }
            stop_stale_daemon(&paths);
            remove_runtime_files(&paths, platform);
            manifest::write_manifest(&paths.dir, kind, &rendered)
        })
        .await
        .map_err(|error| start_failed(&error.to_string()))?
        .map_err(|error| start_failed(&error))?;
        let env = daemon_env(self.platform, &process_env);
        let launch = daemon_launch(self.platform, &install, &paths, &manifest_path, &env)?;
        let mut handle = self.launcher.start_daemon(&launch, &paths).await?;
        write_owner_file(&paths, &handle);
        if let Err(error) = self
            .launcher
            .wait_ready(&install, &paths, &mut handle)
            .await
        {
            self.launcher.stop_daemon(&install, &paths, handle).await;
            return Err(start_error(&paths, error));
        }
        write_owner_file(&paths, &handle);
        if cancel.has_changed().unwrap_or(true) {
            self.launcher.stop_daemon(&install, &paths, handle).await;
            return Err(STOPPED_TEXT.into());
        }
        let mut session = match self.launcher.open_session(&install, &paths, &env).await {
            Ok(session) => session,
            Err(error) => {
                self.launcher.stop_daemon(&install, &paths, handle).await;
                return Err(error);
            }
        };
        let check = tokio::time::timeout(
            SELF_CHECK_TIMEOUT,
            session.call_checked(policy::SELF_CHECK_TOOL, json!({})),
        )
        .await;
        let verdict = match check {
            Ok(Ok(Ok(result))) if refused_as_outside_manifest(&result) => Ok(()),
            Ok(Ok(_)) => Err(AppError::new("desktop_apps.not_bounded").into()),
            Ok(Err(error)) => Err(start_failed(&error)),
            Err(_) => Err(start_failed("its first answer took too long.")),
        };
        if let Err(error) = verdict {
            let error = start_error(&paths, error);
            drop(session);
            self.launcher.stop_daemon(&install, &paths, handle).await;
            log(format!(
                "desktop apps: {} runtime refused: {}",
                kind.as_str(),
                if error.contains("not_bounded") {
                    "not_bounded"
                } else if error.contains("needs_permissions") {
                    "needs_permissions"
                } else {
                    "start_failed"
                }
            ));
            return Err(error);
        }
        if cancel.has_changed().unwrap_or(true) {
            drop(session);
            self.launcher.stop_daemon(&install, &paths, handle).await;
            return Err(STOPPED_TEXT.into());
        }
        let tools = session.tools().to_vec();
        lock(&self.known_tools).insert(kind, tools.clone());
        slot.live = Some(Live {
            install,
            paths,
            daemon: Some(handle),
            session: Some(session),
            manifest_hash: hash,
            started_labels: HashSet::new(),
            tools,
            reconnect: false,
        });
        slot.last_used = Some(Instant::now());
        starting.finish();
        log(format!("desktop apps: {} runtime started", kind.as_str()));
        Ok(())
    }

    async fn stop_slot(&self, kind: RuntimeKind, slot: &mut Slot) {
        let Some(mut live) = slot.live.take() else {
            return;
        };
        lock(&self.active).remove(&kind);
        drop(live.session.take());
        if let Some(handle) = live.daemon.take() {
            self.launcher
                .stop_daemon(&live.install, &live.paths, handle)
                .await;
        }
        log(format!("desktop apps: {} runtime stopped", kind.as_str()));
    }

    async fn ensure_label(
        &self,
        kind: RuntimeKind,
        slot: &mut Slot,
        label: &str,
    ) -> Result<LabelState, String> {
        if label.is_empty()
            || slot
                .live
                .as_ref()
                .is_some_and(|live| live.started_labels.contains(label))
        {
            return Ok(LabelState::Ready);
        }
        let result = self
            .call_once(
                kind,
                slot,
                "start_session",
                json!({"session": label}),
                CALL_TIMEOUT,
            )
            .await?;
        if !is_error(&result) {
            if let Some(live) = slot.live.as_mut() {
                live.started_labels.insert(label.to_string());
            }
            return Ok(LabelState::Ready);
        }
        Ok(match policy::refusal(&result).map(|(refusal, _)| refusal) {
            Some(RefusalKind::Expired) => LabelState::Restart,
            _ => LabelState::Refused(result),
        })
    }

    async fn call_once(
        &self,
        kind: RuntimeKind,
        slot: &mut Slot,
        tool: &str,
        args: Value,
        timeout: Duration,
    ) -> Result<Value, String> {
        self.reopen_session(slot).await;
        let Some(mut session) = slot.live.as_mut().and_then(|live| live.session.take()) else {
            self.stop_slot(kind, slot).await;
            return Err(TIMEOUT_TEXT.into());
        };
        let mut cancelled = self.cancel[&kind].subscribe();
        let outcome = tokio::select! {
            biased;
            _ = cancelled.changed() => {
                drop(session);
                self.stop_slot(kind, slot).await;
                return Err(STOPPED_TEXT.into());
            }
            outcome = tokio::time::timeout(timeout, session.call_checked(tool, args)) => outcome,
        };
        match outcome {
            Ok(Ok(answer)) => {
                if let Some(live) = slot.live.as_mut() {
                    live.session = Some(session);
                }
                slot.last_used = Some(Instant::now());
                Ok(answer.unwrap_or_else(|error| {
                    text_result(
                        &format!(
                            "Cua Driver couldn't run {tool}: {}",
                            policy::bounded(&error, 300)
                        ),
                        true,
                    )
                }))
            }
            Ok(Err(error)) if error.contains(TOO_LARGE_MARKER) => {
                drop(session);
                if let Some(live) = slot.live.as_mut() {
                    live.reconnect = true;
                }
                slot.last_used = Some(Instant::now());
                Ok(text_result(TOO_LARGE_TEXT, true))
            }
            Ok(Err(_)) | Err(_) => {
                drop(session);
                self.stop_slot(kind, slot).await;
                Err(TIMEOUT_TEXT.into())
            }
        }
    }
}

fn refused_as_outside_manifest(result: &Value) -> bool {
    if !is_error(result) {
        return false;
    }
    if let Some((code, message)) = policy::refusal_from_result(result) {
        let message = message.to_ascii_lowercase();
        return code == "bounded_resource_outside_manifest"
            || (code == "permission_denied"
                && (message.contains("manifest") || message.contains("allow")));
    }
    // From 0.38 a tool the manifest leaves out comes back as plain text over
    // MCP: "Permission denied: tool 'get_screen_size' is outside the
    // capability manifest", with only `tool_invocation_failed` as its code.
    let tool = format!("tool '{}'", policy::SELF_CHECK_TOOL);
    result
        .get("content")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|part| part.get("text").and_then(Value::as_str))
        .map(str::to_ascii_lowercase)
        .any(|text| text.contains(&tool) && text.contains("outside the capability manifest"))
}

#[cfg(test)]
pub(crate) mod testing {
    use super::*;

    pub(crate) struct NoDriver;

    impl Launcher for NoDriver {
        fn locate(&self) -> BoxFuture<'_, Result<DriverInstall, String>> {
            Box::pin(async { Err(detect::problem_error("not_installed", None)) })
        }

        fn start_daemon<'a>(
            &'a self,
            _: &'a DaemonLaunch,
            _: &'a RuntimePaths,
        ) -> BoxFuture<'a, Result<DaemonHandle, String>> {
            Box::pin(async { Err(start_failed("no driver in this test")) })
        }

        fn wait_ready<'a>(
            &'a self,
            _: &'a DriverInstall,
            _: &'a RuntimePaths,
            _: &'a mut DaemonHandle,
        ) -> BoxFuture<'a, Result<(), String>> {
            Box::pin(async { Err(start_failed("no driver in this test")) })
        }

        fn open_session<'a>(
            &'a self,
            _: &'a DriverInstall,
            _: &'a RuntimePaths,
            _: &'a BTreeMap<String, String>,
        ) -> BoxFuture<'a, Result<McpStdioSession, String>> {
            Box::pin(async { Err(start_failed("no driver in this test")) })
        }

        fn stop_daemon<'a>(
            &'a self,
            _: &'a DriverInstall,
            _: &'a RuntimePaths,
            _: DaemonHandle,
        ) -> BoxFuture<'a, ()> {
            Box::pin(async {})
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mac_install() -> DriverInstall {
        DriverInstall {
            binary: PathBuf::from("/Applications/CuaDriver.app/Contents/MacOS/cua-driver"),
            app_bundle: Some(PathBuf::from("/Applications/CuaDriver.app")),
            version: Some((0, 36, 0)),
        }
    }

    fn paths() -> RuntimePaths {
        runtime_paths(
            Path::new("/u/.oleafly"),
            RuntimeKind::Desktop,
            Platform::Macos,
        )
    }

    #[test]
    fn the_self_check_reads_each_way_a_driver_refuses_it() {
        // cua-driver 0.38.0 over MCP, word for word.
        let plain = json!({
            "content": [{"type": "text", "text": "Permission denied: tool 'get_screen_size' is outside the capability manifest"}],
            "isError": true,
            "structuredContent": {"code": "tool_invocation_failed", "exit_code": 1}
        });
        assert!(refused_as_outside_manifest(&plain));
        let structured = json!({
            "isError": true,
            "structuredContent": {"status": "refused", "refusal": {"code": "bounded_resource_outside_manifest", "message": "outside"}}
        });
        assert!(refused_as_outside_manifest(&structured));
        let ran = json!({"content": [{"type": "text", "text": "1800x1125"}]});
        assert!(!refused_as_outside_manifest(&ran));
        let failed = json!({
            "content": [{"type": "text", "text": "no display"}],
            "isError": true,
            "structuredContent": {"code": "tool_invocation_failed"}
        });
        assert!(!refused_as_outside_manifest(&failed));
        let other_tool = json!({
            "content": [{"type": "text", "text": "Permission denied: tool 'click' is outside the capability manifest"}],
            "isError": true
        });
        assert!(!refused_as_outside_manifest(&other_tool));
    }

    #[test]
    fn windows_endpoint_is_a_per_user_pipe() {
        let paths = runtime_paths(
            Path::new(r"C:\Users\Zoë\.oleafly"),
            RuntimeKind::Desktop,
            Platform::Windows,
        );
        assert!(paths.endpoint.starts_with(r"\\.\pipe\oleafly-cua-desktop-"));
        assert_eq!(
            paths.endpoint.len(),
            r"\\.\pipe\oleafly-cua-desktop-".len() + 8
        );
        let other = runtime_paths(
            Path::new(r"C:\Users\Ada\.oleafly"),
            RuntimeKind::Desktop,
            Platform::Windows,
        );
        assert_ne!(paths.endpoint, other.endpoint);
    }

    #[cfg(unix)]
    #[test]
    fn long_unix_socket_paths_fall_back_to_the_temp_dir() {
        let long = format!("/home/{}/.oleafly", "a".repeat(120));
        let paths = runtime_paths(
            Path::new(&long),
            RuntimeKind::SignedInBrowser,
            Platform::Linux,
        );
        let temp = std::env::temp_dir().to_string_lossy().into_owned();
        assert!(paths.endpoint.starts_with(&temp), "{}", paths.endpoint);
        assert!(paths.endpoint.contains("oleafly-cua-"));
        assert!(paths.endpoint.ends_with("signed-in-browser.sock"));
        assert!(paths.pid_file.starts_with(&long));
        let short = runtime_paths(
            Path::new("/home/a/.oleafly"),
            RuntimeKind::Browser,
            Platform::Linux,
        );
        assert_eq!(short.endpoint, "/home/a/.oleafly/cua/browser.sock");
    }

    #[test]
    fn macos_launch_goes_through_open_with_bounded_flags_and_no_unsafe_flags() {
        let launch = daemon_launch(
            Platform::Macos,
            &mac_install(),
            &paths(),
            Path::new("/u/.oleafly/cua/desktop.manifest.yaml"),
            &BTreeMap::new(),
        )
        .unwrap();
        assert_eq!(launch.program, "/usr/bin/open");
        assert!(launch.detached);
        assert!(launch.env.is_empty());
        let args = launch.args.join(" ");
        assert!(args.contains("-a /Applications/CuaDriver.app"), "{args}");
        assert!(args.contains("--args serve"));
        assert!(args.contains("--permission-mode bounded"));
        assert!(args.contains("--capability-manifest /u/.oleafly/cua/desktop.manifest.yaml"));
        assert!(args.contains("--approve-capability-manifest"));
        for banned in [
            "unrestricted",
            "--dangerously-bypass-approvals",
            "--grant",
            "--no-permissions-gate",
            "--direct",
            "--embedded",
            "--no-overlay",
            "standard",
        ] {
            assert!(!args.contains(banned), "{banned}");
        }
        assert!(args.contains("--env CUA_DRIVER_RS_TELEMETRY_ENABLED=false"));
        assert!(args.contains("--env CUA_DRIVER_RS_UPDATE_CHECK=false"));
    }

    #[test]
    fn windows_launch_spawns_the_exe_directly_with_the_pipe() {
        let install = DriverInstall {
            binary: PathBuf::from(
                r"C:\Users\Zoë Ab\AppData\Local\Programs\Cua\cua-driver\bin\cua-driver.exe",
            ),
            app_bundle: None,
            version: Some((0, 36, 0)),
        };
        let paths = runtime_paths(
            Path::new(r"C:\Users\Zoë Ab\.oleafly"),
            RuntimeKind::Browser,
            Platform::Windows,
        );
        let env = BTreeMap::from([("SystemRoot".to_string(), r"C:\Windows".to_string())]);
        let launch = daemon_launch(
            Platform::Windows,
            &install,
            &paths,
            Path::new(r"C:\Users\Zoë Ab\.oleafly\cua\browser.manifest.yaml"),
            &env,
        )
        .unwrap();
        assert_eq!(
            launch.program,
            r"C:\Users\Zoë Ab\AppData\Local\Programs\Cua\cua-driver\bin\cua-driver.exe"
        );
        assert!(!launch.detached);
        assert_eq!(launch.args[0], "serve");
        assert_eq!(
            launch.args[1..3],
            ["--socket".to_string(), paths.endpoint.clone()]
        );
        assert!(launch.args.contains(&"bounded".to_string()));
        assert_eq!(launch.env, env);
        assert_eq!(
            mcp_args(&paths),
            vec!["mcp".to_string(), "--socket".into(), paths.endpoint]
        );
    }

    #[test]
    fn mac_without_an_app_bundle_is_refused() {
        let install = DriverInstall {
            app_bundle: None,
            ..mac_install()
        };
        let error = daemon_launch(
            Platform::Macos,
            &install,
            &paths(),
            Path::new("/u/.oleafly/cua/desktop.manifest.yaml"),
            &BTreeMap::new(),
        )
        .unwrap_err();
        assert!(error.contains("desktop_apps.no_app_bundle"), "{error}");
    }

    #[test]
    fn linux_env_keeps_the_session_bus_and_display_and_drops_appimage_variables() {
        let parent = |name: &str| match name {
            "DISPLAY" => Some(":0".to_string()),
            "DBUS_SESSION_BUS_ADDRESS" => Some("unix:path=/run/user/1000/bus".to_string()),
            "LD_LIBRARY_PATH" => Some("/tmp/.mount_x/usr/lib".to_string()),
            "APPDIR" => Some("/tmp/.mount_x".to_string()),
            "APPIMAGE" => Some("/home/a/Oleafly.AppImage".to_string()),
            "GTK_PATH" => Some("/tmp/.mount_x/gtk".to_string()),
            _ => None,
        };
        let env = daemon_env(Platform::Linux, &parent);
        assert_eq!(env.get("DISPLAY").map(String::as_str), Some(":0"));
        assert_eq!(
            env.get("DBUS_SESSION_BUS_ADDRESS").map(String::as_str),
            Some("unix:path=/run/user/1000/bus")
        );
        for gone in ["LD_LIBRARY_PATH", "APPDIR", "APPIMAGE", "GTK_PATH"] {
            assert!(!env.contains_key(gone), "{gone}");
        }
        assert_eq!(env["CUA_DRIVER_RS_TELEMETRY_ENABLED"], "false");
        assert_eq!(env["CUA_DRIVER_RS_UPDATE_CHECK"], "false");
        assert!(!env
            .get("PATH")
            .is_some_and(|path| path.contains("/tmp/.mount_x")));
    }

    #[cfg(unix)]
    #[test]
    fn the_appimage_mount_leaves_the_search_path() {
        let lookup = |name: &str| (name == "APPDIR").then(|| "/tmp/.mount_x".to_string());
        let path = daemon_path(
            Platform::Linux,
            &lookup,
            std::ffi::OsStr::new("/tmp/.mount_x/usr/bin:/usr/bin:/bin"),
        );
        assert_eq!(path, "/usr/bin:/bin");
        let untouched = daemon_path(
            Platform::Macos,
            &lookup,
            std::ffi::OsStr::new("/tmp/.mount_x/usr/bin:/usr/bin"),
        );
        assert_eq!(untouched, "/tmp/.mount_x/usr/bin:/usr/bin");
    }

    #[test]
    fn windows_env_carries_the_system_variables() {
        let parent = |name: &str| match name {
            "SystemRoot" => Some(r"C:\Windows".to_string()),
            "LOCALAPPDATA" => Some(r"C:\Users\Zoë\AppData\Local".to_string()),
            "PATHEXT" => Some(".COM;.EXE;.BAT;.CMD".to_string()),
            "HOME" => Some("/home/a".to_string()),
            "DISPLAY" => Some(":0".to_string()),
            "OLEAFLY_SECRET" => Some("x".to_string()),
            _ => None,
        };
        let env = daemon_env(Platform::Windows, &parent);
        assert_eq!(env["SystemRoot"], r"C:\Windows");
        assert_eq!(env["LOCALAPPDATA"], r"C:\Users\Zoë\AppData\Local");
        assert_eq!(env["PATHEXT"], ".COM;.EXE;.BAT;.CMD");
        for gone in ["HOME", "DISPLAY", "OLEAFLY_SECRET"] {
            assert!(!env.contains_key(gone), "{gone}");
        }
    }

    #[test]
    fn macos_client_env_is_small() {
        let parent = |name: &str| match name {
            "HOME" => Some("/Users/a".to_string()),
            "OPENAI_API_KEY" => Some("sk".to_string()),
            _ => None,
        };
        let env = daemon_env(Platform::Macos, &parent);
        assert_eq!(env["HOME"], "/Users/a");
        assert!(!env.contains_key("OPENAI_API_KEY"));
    }

    #[test]
    fn stale_owner_files_without_a_live_process_are_cleaned_up() {
        let dir = tempfile::tempdir().unwrap();
        let platform = Platform::current().unwrap_or(Platform::Linux);
        let paths = runtime_paths(dir.path(), RuntimeKind::Desktop, platform);
        std::fs::create_dir_all(&paths.dir).unwrap();
        std::fs::write(
            &paths.owner_file,
            serde_json::to_string(&OwnerRecord {
                pid: u32::MAX - 1,
                started: Some(1),
                endpoint: paths.endpoint.clone(),
            })
            .unwrap(),
        )
        .unwrap();
        std::fs::write(&paths.pid_file, "123").unwrap();
        stop_stale_daemon(&paths);
        assert!(!paths.owner_file.exists());
        assert!(!paths.pid_file.exists());
    }

    #[cfg(unix)]
    fn stand_in_daemon(endpoint: &str) -> std::process::Child {
        std::process::Command::new("sh")
            .args(["-c", "sleep 20; true", "serve", "--socket", endpoint])
            .spawn()
            .unwrap()
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn a_macos_daemon_is_on_record_once_its_process_is_found_even_before_it_is_ready() {
        let dir = tempfile::tempdir().unwrap();
        let paths = runtime_paths(dir.path(), RuntimeKind::Desktop, Platform::Macos);
        std::fs::create_dir_all(&paths.dir).unwrap();
        let mut daemon = stand_in_daemon(&paths.endpoint);
        let install = DriverInstall {
            binary: PathBuf::from("cua-driver"),
            app_bundle: None,
            version: Some((0, 36, 0)),
        };
        let mut handle = DaemonHandle::Detached {
            pid: 0,
            started: None,
        };
        let endpoint = paths.endpoint.clone();
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(1500)).await;
            let _ = std::fs::write(&endpoint, "");
        });
        ProcessLauncher::new(Platform::Macos)
            .wait_ready(&install, &paths, &mut handle)
            .await
            .unwrap();
        assert!(
            matches!(handle, DaemonHandle::Detached { pid, .. } if pid == daemon.id()),
            "the handle learned the process id"
        );
        let record: OwnerRecord =
            serde_json::from_str(&std::fs::read_to_string(&paths.owner_file).unwrap()).unwrap();
        assert_eq!(record.pid, daemon.id());
        assert!(record.started.is_some());
        stop_stale_daemon(&paths);
        daemon.wait().unwrap();
        assert!(!paths.owner_file.exists());
    }

    #[cfg(unix)]
    #[test]
    fn a_daemon_nobody_recorded_is_found_by_its_command_line_and_ended() {
        let dir = tempfile::tempdir().unwrap();
        let paths = runtime_paths(dir.path(), RuntimeKind::Browser, Platform::Macos);
        std::fs::create_dir_all(&paths.dir).unwrap();
        let mut daemon = stand_in_daemon(&paths.endpoint);
        let other = runtime_paths(dir.path(), RuntimeKind::Desktop, Platform::Macos);
        let mut bystander = stand_in_daemon(&other.endpoint);
        let deadline = Instant::now() + Duration::from_secs(5);
        while serving_pids(&paths.endpoint).is_empty() && Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(50));
        }
        assert_eq!(serving_pids(&paths.endpoint), vec![daemon.id()]);
        stop_stale_daemon(&paths);
        daemon.wait().unwrap();
        assert!(bystander.try_wait().unwrap().is_none());
        bystander.kill().unwrap();
        bystander.wait().unwrap();
    }

    #[test]
    fn log_tails_are_one_bounded_line() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("desktop.log");
        std::fs::write(
            &path,
            format!("{}\nerror:  bind failed\n", "x".repeat(5000)),
        )
        .unwrap();
        let tail = log_tail(&path).unwrap();
        assert!(tail.ends_with("error: bind failed"), "{tail}");
        assert!(tail.len() <= 2048);
        assert!(!tail.contains('\n'));
        assert_eq!(log_tail(&dir.path().join("missing.log")), None);
    }

    #[test]
    fn a_start_stopped_at_the_permissions_prompt_says_so() {
        let dir = tempfile::tempdir().unwrap();
        let paths = runtime_paths(dir.path(), RuntimeKind::Desktop, Platform::Macos);
        std::fs::create_dir_all(paths.log_file.parent().unwrap()).unwrap();
        // cua-driver 0.38.0 without Screen Recording, trimmed.
        std::fs::write(
            &paths.log_file,
            "Cua Driver daemon listening on /x/desktop.sock\n\n\
             ──────\n cua-driver needs your permission before desktop tools can run\n──────\n\n \
             Missing TCC grant(s) for the Cua Driver app identity:\n   • Screen Recording\n",
        )
        .unwrap();
        let error = start_error(&paths, AppError::new("desktop_apps.not_bounded").into());
        assert!(error.contains("desktop_apps.needs_permissions"), "{error}");
        std::fs::write(
            &paths.log_file,
            "Cua Driver daemon listening on /x/desktop.sock\n",
        )
        .unwrap();
        let error = start_error(&paths, AppError::new("desktop_apps.not_bounded").into());
        assert!(error.contains("desktop_apps.not_bounded"), "{error}");
    }
}
