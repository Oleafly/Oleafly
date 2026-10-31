//! Finding Cua Driver (and the `cua` command for Spaces), its version, the
//! official install lines, and readers for its status commands. Oleafly
//! never installs or updates Cua itself.

use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::Duration;

use serde::Serialize;
use serde_json::Value;

use super::Platform;
use crate::app_error::AppError;

pub(crate) const MIN_DRIVER_VERSION: (u64, u64, u64) = (0, 36, 0);
const VERSION_TIMEOUT: Duration = Duration::from_secs(3);
const PERMISSIONS_TIMEOUT: Duration = Duration::from_secs(3);
const DOCTOR_TIMEOUT: Duration = Duration::from_secs(5);
const GNOME_TIMEOUT: Duration = Duration::from_secs(2);
const MAX_PROBLEMS: usize = 5;
const MAX_PROBLEM_CHARS: usize = 300;

/// A Cua Driver install found on this computer.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct DriverInstall {
    /// The `cua-driver` program, symlinks resolved.
    pub binary: PathBuf,
    /// macOS: the CuaDriver.app bundle holding the binary.
    pub app_bundle: Option<PathBuf>,
    /// `None` when `--version` could not be read; that counts as a problem.
    pub version: Option<(u64, u64, u64)>,
}

impl DriverInstall {
    /// Why this install can't run desktop apps, if it can't.
    pub(crate) fn problem(&self, platform: Platform) -> Option<&'static str> {
        if self
            .version
            .is_some_and(|version| version < MIN_DRIVER_VERSION)
        {
            return Some("too_old");
        }
        if platform == Platform::Macos && self.app_bundle.is_none() {
            return Some("no_app_bundle");
        }
        // A driver that doesn't say its version (or took too long to, on its
        // first launch) can't be shown to be 0.36 or newer.
        if self.version.is_none() {
            return Some("unreadable_version");
        }
        None
    }
}

pub(crate) fn version_string(version: (u64, u64, u64)) -> String {
    format!("{}.{}.{}", version.0, version.1, version.2)
}

/// The `AppError` for a driver problem code.
pub(crate) fn problem_error(problem: &str, install: Option<&DriverInstall>) -> String {
    match problem {
        "too_old" => AppError::new("desktop_apps.too_old")
            .param(
                "version",
                install
                    .and_then(|install| install.version)
                    .map(version_string)
                    .unwrap_or_default(),
            )
            .param("minimum", version_string(MIN_DRIVER_VERSION))
            .into(),
        "no_app_bundle" => AppError::new("desktop_apps.no_app_bundle").into(),
        "unreadable_version" => AppError::new("desktop_apps.start_failed")
            .param(
                "detail",
                "Oleafly couldn't read the Cua Driver version. Check that it runs, then try again.",
            )
            .into(),
        _ => AppError::new("desktop_apps.not_installed").into(),
    }
}

fn join(platform: Platform, base: &str, parts: &[&str]) -> String {
    let separator = if platform == Platform::Windows {
        '\\'
    } else {
        '/'
    };
    let mut path = base.trim_end_matches(['/', '\\']).to_string();
    for part in parts {
        path.push(separator);
        path.push_str(part);
    }
    path
}

/// Where the official installers put `cua-driver`, in search order.
pub(crate) fn candidate_paths(
    platform: Platform,
    env: &dyn Fn(&str) -> Option<String>,
) -> Vec<String> {
    let value = |name: &str| env(name).filter(|value| !value.trim().is_empty());
    let mut paths = Vec::new();
    match platform {
        Platform::Macos => {
            paths.push("/Applications/CuaDriver.app/Contents/MacOS/cua-driver".to_string());
            if let Some(home) = value("HOME") {
                paths.push(join(
                    platform,
                    &home,
                    &[
                        "Applications",
                        "CuaDriver.app",
                        "Contents",
                        "MacOS",
                        "cua-driver",
                    ],
                ));
                paths.push(join(platform, &home, &[".local", "bin", "cua-driver"]));
            }
        }
        Platform::Linux => {
            if let Some(driver_home) = value("CUA_DRIVER_RS_HOME") {
                paths.push(join(
                    platform,
                    &driver_home,
                    &["packages", "current", "cua-driver"],
                ));
            }
            if let Some(home) = value("HOME") {
                paths.push(join(
                    platform,
                    &home,
                    &[".cua-driver", "packages", "current", "cua-driver"],
                ));
                paths.push(join(platform, &home, &[".local", "bin", "cua-driver"]));
            }
        }
        Platform::Windows => {
            if let Some(local) = value("LOCALAPPDATA") {
                paths.push(join(
                    platform,
                    &local,
                    &["Programs", "Cua", "cua-driver", "bin", "cua-driver.exe"],
                ));
            }
            if let Some(profile) = value("USERPROFILE") {
                paths.push(join(
                    platform,
                    &profile,
                    &[".cua-driver", "packages", "current", "cua-driver.exe"],
                ));
            }
        }
    }
    paths
}

fn process_env(name: &str) -> Option<String> {
    std::env::var(name).ok()
}

fn runnable(path: &Path) -> bool {
    if !path.is_file() {
        return false;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::metadata(path).is_ok_and(|meta| meta.permissions().mode() & 0o111 != 0)
    }
    #[cfg(not(unix))]
    {
        true
    }
}

/// The first official install location that holds the program, then PATH.
pub(crate) fn locate_driver(platform: Platform) -> Option<PathBuf> {
    candidate_paths(platform, &process_env)
        .into_iter()
        .map(PathBuf::from)
        .find(|path| runnable(path))
        .or_else(|| crate::program_locator::locate_native("cua-driver").map(|found| found.path))
}

/// `…/CuaDriver.app/Contents/MacOS/cua-driver` → `…/CuaDriver.app`.
pub(crate) fn app_bundle_for(binary: &Path) -> Option<PathBuf> {
    let macos = binary.parent()?;
    let contents = macos.parent()?;
    let bundle = contents.parent()?;
    let named = |path: &Path, name: &str| {
        path.file_name()
            .is_some_and(|file| file.to_string_lossy() == name)
    };
    let is_app = bundle
        .extension()
        .is_some_and(|extension| extension.eq_ignore_ascii_case("app"));
    (named(macos, "MacOS") && named(contents, "Contents") && is_app).then(|| bundle.to_path_buf())
}

/// `cua-driver 0.36.0` → `(0, 36, 0)`; pre-release tags are ignored.
pub(crate) fn parse_version(stdout: &str) -> Option<(u64, u64, u64)> {
    stdout.split_whitespace().find_map(|word| {
        let word = word.trim_start_matches(['v', 'V']);
        let mut parts = word.splitn(3, '.');
        let major = parts.next()?.parse().ok()?;
        let minor = parts.next()?.parse().ok()?;
        let patch: String = parts
            .next()?
            .chars()
            .take_while(char::is_ascii_digit)
            .collect();
        Some((major, minor, patch.parse().ok()?))
    })
}

/// The driver run for one command: the same small environment its daemon
/// and client get (an AppImage's libraries and the shell's secrets stay
/// behind), with telemetry and the update check off.
fn driver_command(
    binary: &Path,
    args: &[&str],
    lookup: &dyn Fn(&str) -> Option<String>,
) -> Command {
    let platform = Platform::current().unwrap_or(Platform::Linux);
    let mut command = Command::new(binary);
    command
        .args(args)
        .env_clear()
        .envs(super::runtime::daemon_env(platform, lookup));
    command
}

/// Runs the driver with telemetry and the update check off. Returns
/// whether it exited 0, then stdout and stderr.
pub(crate) fn run_driver(
    binary: &Path,
    args: &[&str],
    timeout: Duration,
) -> Option<(bool, String, String)> {
    let command = driver_command(binary, args, &process_env);
    let output = crate::proc::output_contained_with_timeout(command, timeout).ok()?;
    Some((
        output.status.success(),
        String::from_utf8_lossy(&output.stdout).into_owned(),
        String::from_utf8_lossy(&output.stderr).into_owned(),
    ))
}

/// Finds the driver and reads its version (blocking, up to 3 s).
pub(crate) fn detect_install(platform: Platform) -> Option<DriverInstall> {
    let found = locate_driver(platform)?;
    let binary = std::fs::canonicalize(&found)
        .map(|resolved| oleafly_core::plain_path(&resolved))
        .unwrap_or(found);
    let app_bundle = if platform == Platform::Macos {
        app_bundle_for(&binary)
    } else {
        None
    };
    let version = run_driver(&binary, &["--version"], VERSION_TIMEOUT)
        .and_then(|(_, stdout, stderr)| parse_version(&stdout).or_else(|| parse_version(&stderr)));
    Some(DriverInstall {
        binary,
        app_bundle,
        version,
    })
}

/// The official install line, shown for copying.
pub(crate) fn install_line(platform: Platform) -> &'static str {
    match platform {
        Platform::Windows => {
            r#"powershell.exe -NoProfile -Command "irm https://cua.ai/driver/install.ps1 | iex""#
        }
        Platform::Macos | Platform::Linux => {
            r#"/bin/bash -c "$(curl -fsSL https://cua.ai/driver/install.sh)""#
        }
    }
}

/// The official `cua` install line (Spaces), shown for copying.
pub(crate) fn spaces_install_line(platform: Platform) -> &'static str {
    match platform {
        Platform::Windows => {
            r#"powershell.exe -NoProfile -Command "irm https://cua.ai/install.ps1 | iex""#
        }
        Platform::Macos | Platform::Linux => "curl -fsSL https://cua.ai/install.sh | sh",
    }
}

/// A program and its arguments for the terminal launcher, which quotes
/// every word: an install line can't be passed as one word.
#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TerminalCommand {
    pub program: String,
    pub args: Vec<String>,
}

/// Windows PowerShell by its full path. The line is typed into the tab's
/// shell in the project folder, and cmd.exe looks there before the search
/// path, so a bare `powershell.exe` could start a program the project holds.
fn windows_powershell(env: &dyn Fn(&str) -> Option<String>) -> String {
    let root = env("SystemRoot")
        .map(|root| root.trim().trim_end_matches(['\\', '/']).to_string())
        .filter(|root| {
            let bytes = root.as_bytes();
            bytes.len() >= 3
                && bytes[0].is_ascii_alphabetic()
                && bytes[1] == b':'
                && matches!(bytes[2], b'\\' | b'/')
                && !root.contains(['"', '\'', '`', '\0'])
        })
        .unwrap_or_else(|| r"C:\Windows".to_string());
    format!(r"{root}\System32\WindowsPowerShell\v1.0\powershell.exe")
}

fn terminal_command(platform: Platform, line: &str, windows_script: &str) -> TerminalCommand {
    terminal_command_with(platform, line, windows_script, &process_env)
}

fn terminal_command_with(
    platform: Platform,
    line: &str,
    windows_script: &str,
    env: &dyn Fn(&str) -> Option<String>,
) -> TerminalCommand {
    match platform {
        Platform::Windows => TerminalCommand {
            program: windows_powershell(env),
            args: vec![
                "-NoProfile".into(),
                "-Command".into(),
                windows_script.into(),
            ],
        },
        // `sh -c` runs the official line exactly as written, whatever shell
        // the terminal tab started.
        Platform::Macos | Platform::Linux => TerminalCommand {
            program: "/bin/sh".into(),
            args: vec!["-c".into(), line.into()],
        },
    }
}

pub(crate) fn install_command(platform: Platform) -> TerminalCommand {
    terminal_command(
        platform,
        install_line(platform),
        "irm https://cua.ai/driver/install.ps1 | iex",
    )
}

pub(crate) fn spaces_install_command(platform: Platform) -> TerminalCommand {
    terminal_command(
        platform,
        spaces_install_line(platform),
        "irm https://cua.ai/install.ps1 | iex",
    )
}

/// The `cua` command (Cua Spaces), when installed.
pub(crate) fn locate_spaces_cli(platform: Platform) -> Option<PathBuf> {
    let name = if platform == Platform::Windows {
        "cua.exe"
    } else {
        "cua"
    };
    let home = if platform == Platform::Windows {
        process_env("USERPROFILE")
    } else {
        process_env("HOME")
    };
    crate::program_locator::locate_native("cua")
        .map(|found| found.path)
        .or_else(|| {
            let path = PathBuf::from(join(platform, &home?, &[".local", "bin", name]));
            runnable(&path).then_some(path)
        })
}

/// The driver's own folder (`CUA_DRIVER_RS_HOME`, else `~/.cua-driver`).
pub(crate) fn driver_home(
    platform: Platform,
    env: &dyn Fn(&str) -> Option<String>,
) -> Option<String> {
    if let Some(home) = env("CUA_DRIVER_RS_HOME").filter(|value| !value.trim().is_empty()) {
        return Some(home);
    }
    let home = if platform == Platform::Windows {
        env("USERPROFILE")
    } else {
        env("HOME")
    }?;
    Some(join(platform, &home, &[".cua-driver"]))
}

#[derive(Serialize, Clone, Debug, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PermissionsStatus {
    pub accessibility: Option<bool>,
    pub screen_recording: Option<bool>,
    /// The driver answered that it hasn't checked yet: from 0.38 it reports
    /// `"status": "unknown"` until `permissions grant` has run under its own
    /// identity, so the grant step is the way to find out.
    pub unchecked: bool,
}

fn normalized(text: &str) -> String {
    text.chars()
        .filter(char::is_ascii_alphanumeric)
        .collect::<String>()
        .to_ascii_lowercase()
}

fn permission_state(value: &Value) -> Option<bool> {
    match value {
        Value::Bool(granted) => Some(*granted),
        Value::String(text) => match normalized(text).as_str() {
            "granted" | "authorized" | "allowed" | "true" | "yes" | "ok" | "enabled" => Some(true),
            "denied" | "notgranted" | "missing" | "false" | "no" | "notdetermined" | "required"
            | "needed" | "disabled" | "restricted" => Some(false),
            _ => None,
        },
        Value::Object(map) => ["granted", "status", "state", "authorized", "value"]
            .iter()
            .find_map(|key| map.get(*key).and_then(permission_state)),
        _ => None,
    }
}

fn assign_permission(status: &mut PermissionsStatus, name: &str, state: Option<bool>) {
    let Some(state) = state else {
        return;
    };
    let slot = match normalized(name).as_str() {
        "accessibility" => &mut status.accessibility,
        "screenrecording" | "screencapture" => &mut status.screen_recording,
        _ => return,
    };
    if slot.is_none() {
        *slot = Some(state);
    }
}

fn scan_permissions(value: &Value, status: &mut PermissionsStatus, depth: usize) {
    if depth > 4 {
        return;
    }
    match value {
        Value::Object(map) => {
            if let Some(name) = ["name", "id", "permission", "kind"]
                .iter()
                .find_map(|key| map.get(*key).and_then(Value::as_str))
            {
                assign_permission(status, name, permission_state(value));
            }
            for (key, child) in map {
                assign_permission(status, key, permission_state(child));
                scan_permissions(child, status, depth + 1);
            }
        }
        Value::Array(items) => {
            for item in items.iter().take(32) {
                scan_permissions(item, status, depth + 1);
            }
        }
        _ => {}
    }
}

/// `cua-driver permissions status --json`, in the shapes seen so far.
/// Anything unreadable is "unknown".
pub(crate) fn parse_permissions_status(json: &str) -> PermissionsStatus {
    let mut status = PermissionsStatus::default();
    if let Ok(value) = serde_json::from_str::<Value>(json) {
        scan_permissions(&value, &mut status, 0);
        status.unchecked = status.accessibility.is_none()
            && status.screen_recording.is_none()
            && value
                .get("status")
                .and_then(Value::as_str)
                .is_some_and(|text| normalized(text) == "unknown");
    }
    status
}

fn one_line(text: &str) -> String {
    let line = text.split_whitespace().collect::<Vec<_>>().join(" ");
    line.chars().take(MAX_PROBLEM_CHARS).collect()
}

fn failed_check(map: &serde_json::Map<String, Value>) -> Option<bool> {
    if let Some(ok) = ["ok", "passed", "success"]
        .iter()
        .find_map(|key| map.get(*key).and_then(Value::as_bool))
    {
        return Some(!ok);
    }
    ["status", "state", "result"]
        .iter()
        .find_map(|key| map.get(*key).and_then(Value::as_str))
        .map(|status| {
            matches!(
                normalized(status).as_str(),
                "fail" | "failed" | "failure" | "error" | "missing" | "notok"
            )
        })
}

fn collect_problems(value: &Value, problems: &mut Vec<String>, depth: usize) {
    if depth > 4 || problems.len() >= MAX_PROBLEMS {
        return;
    }
    match value {
        Value::Array(items) => {
            for item in items.iter().take(64) {
                collect_problems(item, problems, depth + 1);
            }
        }
        Value::Object(map) => {
            if failed_check(map) == Some(true) {
                if let Some(message) = ["message", "detail", "error", "hint", "name"]
                    .iter()
                    .find_map(|key| map.get(*key).and_then(Value::as_str))
                    .map(one_line)
                    .filter(|message| !message.is_empty())
                {
                    if problems.len() < MAX_PROBLEMS && !problems.contains(&message) {
                        problems.push(message);
                    }
                }
            }
            // A summary object can hold the checks themselves.
            for child in map
                .values()
                .filter(|child| child.is_array() || child.is_object())
            {
                collect_problems(child, problems, depth + 1);
            }
        }
        _ => {}
    }
}

/// The failed checks of `cua-driver doctor --json`, at most five. When the
/// output isn't JSON and the doctor failed, its first line stands in.
pub(crate) fn parse_doctor(json: &str, exit_ok: bool) -> Vec<String> {
    let mut problems = Vec::new();
    match serde_json::from_str::<Value>(json) {
        Ok(value) => collect_problems(&value, &mut problems, 0),
        Err(_) if !exit_ok => {
            if let Some(line) = json.lines().map(str::trim).find(|line| !line.is_empty()) {
                problems.push(one_line(line));
            }
        }
        Err(_) => {}
    }
    problems
}

/// `gnome-extensions info winrects@cua`: `State: ACTIVE` → on.
pub(crate) fn parse_gnome_extension_state(text: &str) -> Option<bool> {
    text.lines().find_map(|line| {
        let (key, value) = line.trim().split_once(':')?;
        key.trim().eq_ignore_ascii_case("state").then(|| {
            matches!(
                value.trim().to_ascii_uppercase().as_str(),
                "ACTIVE" | "ENABLED"
            )
        })
    })
}

/// macOS: Accessibility and Screen Recording for CuaDriver.app (blocking).
pub(crate) fn permissions_status(binary: &Path) -> Option<PermissionsStatus> {
    let (_, stdout, _) = run_driver(
        binary,
        &["permissions", "status", "--json"],
        PERMISSIONS_TIMEOUT,
    )?;
    Some(parse_permissions_status(&stdout))
}

/// `cua-driver doctor --json` (blocking, up to 5 s).
pub(crate) fn doctor(binary: &Path) -> Vec<String> {
    let Some((ok, stdout, stderr)) = run_driver(binary, &["doctor", "--json"], DOCTOR_TIMEOUT)
    else {
        return Vec::new();
    };
    let mut problems = parse_doctor(&stdout, ok);
    if problems.is_empty() && !ok {
        if let Some(line) = stderr.lines().map(str::trim).find(|line| !line.is_empty()) {
            problems.push(one_line(line));
        }
    }
    problems
}

/// Linux on GNOME Wayland: whether the Cua window helper extension is on.
/// `None` everywhere else.
pub(crate) fn gnome_helper_state(env: &dyn Fn(&str) -> Option<String>) -> Option<bool> {
    let gnome = env("XDG_CURRENT_DESKTOP")
        .is_some_and(|desktop| desktop.to_ascii_uppercase().contains("GNOME"));
    let wayland = env("XDG_SESSION_TYPE").is_some_and(|kind| kind.eq_ignore_ascii_case("wayland"));
    if !gnome || !wayland {
        return None;
    }
    let program = crate::program_locator::locate_native("gnome-extensions")?.path;
    let mut command = Command::new(program);
    command.args(["info", "winrects@cua"]);
    let output = crate::proc::output_contained_with_timeout(command, GNOME_TIMEOUT).ok();
    Some(
        output
            .and_then(|output| {
                parse_gnome_extension_state(&String::from_utf8_lossy(&output.stdout))
            })
            .unwrap_or(false),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn windows_candidates_use_local_app_data_with_spaces_and_non_ascii() {
        let env = |name: &str| match name {
            "LOCALAPPDATA" => Some(r"C:\Users\Zoë Ab\AppData\Local".to_string()),
            "USERPROFILE" => Some(r"C:\Users\Zoë Ab".to_string()),
            _ => None,
        };
        assert_eq!(
            candidate_paths(Platform::Windows, &env),
            vec![
                r"C:\Users\Zoë Ab\AppData\Local\Programs\Cua\cua-driver\bin\cua-driver.exe"
                    .to_string(),
                r"C:\Users\Zoë Ab\.cua-driver\packages\current\cua-driver.exe".to_string(),
            ]
        );
    }

    #[test]
    fn linux_candidates_honor_cua_driver_rs_home_first() {
        let env = |name: &str| match name {
            "CUA_DRIVER_RS_HOME" => Some("/opt/cua".to_string()),
            "HOME" => Some("/home/zoë".to_string()),
            _ => None,
        };
        assert_eq!(
            candidate_paths(Platform::Linux, &env),
            vec![
                "/opt/cua/packages/current/cua-driver".to_string(),
                "/home/zoë/.cua-driver/packages/current/cua-driver".to_string(),
                "/home/zoë/.local/bin/cua-driver".to_string(),
            ]
        );
        let without = |name: &str| (name == "HOME").then(|| "/home/a/".to_string());
        assert_eq!(
            candidate_paths(Platform::Linux, &without)[0],
            "/home/a/.cua-driver/packages/current/cua-driver"
        );
    }

    #[test]
    fn macos_candidates_start_with_the_app_bundle() {
        let env = |name: &str| (name == "HOME").then(|| "/Users/zoë".to_string());
        assert_eq!(
            candidate_paths(Platform::Macos, &env),
            vec![
                "/Applications/CuaDriver.app/Contents/MacOS/cua-driver".to_string(),
                "/Users/zoë/Applications/CuaDriver.app/Contents/MacOS/cua-driver".to_string(),
                "/Users/zoë/.local/bin/cua-driver".to_string(),
            ]
        );
    }

    #[test]
    fn version_line_parses_and_compares() {
        assert_eq!(parse_version("cua-driver 0.36.0\n"), Some((0, 36, 0)));
        assert_eq!(parse_version("cua-driver 1.2.3-beta.1"), Some((1, 2, 3)));
        assert_eq!(parse_version("cua-driver v0.40.2"), Some((0, 40, 2)));
        assert_eq!(parse_version("nope"), None);
        assert!((0, 35, 9) < MIN_DRIVER_VERSION);
        assert!((0, 36, 0) >= MIN_DRIVER_VERSION);
    }

    #[test]
    fn app_bundle_is_found_through_the_symlink_target() {
        assert_eq!(
            app_bundle_for(Path::new(
                "/Applications/CuaDriver.app/Contents/MacOS/cua-driver"
            )),
            Some(PathBuf::from("/Applications/CuaDriver.app"))
        );
        assert_eq!(
            app_bundle_for(Path::new("/home/a/.local/bin/cua-driver")),
            None
        );
    }

    #[test]
    fn problems_name_old_drivers_and_missing_bundles() {
        let install = DriverInstall {
            binary: PathBuf::from("/Applications/CuaDriver.app/Contents/MacOS/cua-driver"),
            app_bundle: Some(PathBuf::from("/Applications/CuaDriver.app")),
            version: Some((0, 35, 0)),
        };
        assert_eq!(install.problem(Platform::Macos), Some("too_old"));
        let error = problem_error("too_old", Some(&install));
        assert!(error.contains("desktop_apps.too_old"), "{error}");
        assert!(error.contains("\"version\":\"0.35.0\""), "{error}");
        assert!(error.contains("\"minimum\":\"0.36.0\""), "{error}");

        let unbundled = DriverInstall {
            binary: PathBuf::from("/usr/local/bin/cua-driver"),
            app_bundle: None,
            version: Some((0, 36, 1)),
        };
        assert_eq!(unbundled.problem(Platform::Macos), Some("no_app_bundle"));
        assert_eq!(unbundled.problem(Platform::Linux), None);
        let unknown = DriverInstall {
            version: None,
            ..unbundled
        };
        // A version that can't be read is not a pass.
        assert_eq!(unknown.problem(Platform::Linux), Some("unreadable_version"));
        let error = problem_error("unreadable_version", Some(&unknown));
        assert!(error.contains("desktop_apps.start_failed"), "{error}");
        assert!(
            error.contains("couldn't read the Cua Driver version"),
            "{error}"
        );
        assert!(problem_error("not_installed", None).contains("desktop_apps.not_installed"));
    }

    #[test]
    fn install_lines_are_the_official_ones() {
        assert_eq!(
            install_line(Platform::Macos),
            r#"/bin/bash -c "$(curl -fsSL https://cua.ai/driver/install.sh)""#
        );
        assert_eq!(
            install_line(Platform::Windows),
            r#"powershell.exe -NoProfile -Command "irm https://cua.ai/driver/install.ps1 | iex""#
        );
        assert_eq!(
            spaces_install_line(Platform::Linux),
            "curl -fsSL https://cua.ai/install.sh | sh"
        );
    }

    #[test]
    fn terminal_commands_run_the_official_line_without_requoting() {
        assert_eq!(
            install_command(Platform::Linux),
            TerminalCommand {
                program: "/bin/sh".into(),
                args: vec![
                    "-c".into(),
                    r#"/bin/bash -c "$(curl -fsSL https://cua.ai/driver/install.sh)""#.into()
                ],
            }
        );
        // The same words work typed into PowerShell, cmd and Git Bash.
        let windows = |name: &str| (name == "SystemRoot").then(|| r"D:\WINDOWS".to_string());
        assert_eq!(
            terminal_command_with(
                Platform::Windows,
                install_line(Platform::Windows),
                "irm https://cua.ai/driver/install.ps1 | iex",
                &windows
            ),
            TerminalCommand {
                program: r"D:\WINDOWS\System32\WindowsPowerShell\v1.0\powershell.exe".into(),
                args: vec![
                    "-NoProfile".into(),
                    "-Command".into(),
                    "irm https://cua.ai/driver/install.ps1 | iex".into()
                ],
            }
        );
        assert_eq!(
            spaces_install_command(Platform::Windows).args[2],
            "irm https://cua.ai/install.ps1 | iex"
        );
        let json = serde_json::to_value(install_command(Platform::Macos)).unwrap();
        assert_eq!(json["program"], "/bin/sh");
    }

    #[test]
    fn windows_install_commands_never_start_a_bare_powershell() {
        // A project folder's own powershell.exe must never win: cmd.exe
        // looks in the current folder first.
        for command in [
            install_command(Platform::Windows),
            spaces_install_command(Platform::Windows),
        ] {
            assert!(
                command
                    .program
                    .ends_with(r"\System32\WindowsPowerShell\v1.0\powershell.exe"),
                "{}",
                command.program
            );
            assert!(command.program.as_bytes()[1] == b':', "{}", command.program);
        }
        // A SystemRoot that isn't a drive path falls back to the usual one.
        for root in ["", ".", r"Windows", "\"C:\\x\" & calc", r"\\server\share"] {
            let env = |name: &str| (name == "SystemRoot").then(|| root.to_string());
            assert_eq!(
                windows_powershell(&env),
                r"C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe",
                "{root}"
            );
        }
    }

    #[cfg(unix)]
    #[test]
    fn driver_commands_get_the_small_environment_and_nothing_else() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        let fake = dir.path().join("cua-driver");
        std::fs::write(&fake, "#!/bin/sh\nexec /usr/bin/env\n").unwrap();
        std::fs::set_permissions(&fake, std::fs::Permissions::from_mode(0o755)).unwrap();
        let parent = |name: &str| match name {
            "HOME" => Some("/home/a".to_string()),
            "LD_LIBRARY_PATH" => Some("/tmp/.mount_x/usr/lib".to_string()),
            "OPENAI_API_KEY" => Some("sk-test".to_string()),
            _ => None,
        };
        let output = crate::proc::output_contained_with_timeout(
            driver_command(&fake, &["--version"], &parent),
            Duration::from_secs(10),
        )
        .unwrap();
        let printed = String::from_utf8_lossy(&output.stdout);
        let names: Vec<&str> = printed
            .lines()
            .filter_map(|line| line.split_once('=').map(|(name, _)| name))
            .collect();
        assert!(names.contains(&"HOME"), "{printed}");
        assert!(printed.contains("CUA_DRIVER_RS_TELEMETRY_ENABLED=false"));
        assert!(printed.contains("CUA_DRIVER_RS_UPDATE_CHECK=false"));
        let expected = super::super::runtime::daemon_env(
            Platform::current().unwrap_or(Platform::Linux),
            &parent,
        );
        // Only the allowlist, plus what the shell itself sets.
        for name in names {
            assert!(
                expected.contains_key(name) || matches!(name, "PWD" | "SHLVL" | "_" | "OLDPWD"),
                "{name} leaked: {printed}"
            );
        }
    }

    #[test]
    fn driver_home_prefers_the_override() {
        let env = |name: &str| match name {
            "CUA_DRIVER_RS_HOME" => Some("/opt/cua".to_string()),
            "HOME" => Some("/home/a".to_string()),
            _ => None,
        };
        assert_eq!(
            driver_home(Platform::Linux, &env).as_deref(),
            Some("/opt/cua")
        );
        let env = |name: &str| (name == "HOME").then(|| "/home/a".to_string());
        assert_eq!(
            driver_home(Platform::Linux, &env).as_deref(),
            Some("/home/a/.cua-driver")
        );
    }

    #[test]
    fn permissions_status_parses_known_and_unknown_shapes() {
        assert_eq!(
            parse_permissions_status(r#"{"accessibility":"granted","screen_recording":false}"#),
            PermissionsStatus {
                accessibility: Some(true),
                screen_recording: Some(false),
                unchecked: false
            }
        );
        assert_eq!(
            parse_permissions_status(
                r#"{"permissions":[{"name":"Accessibility","granted":true}]}"#
            ),
            PermissionsStatus {
                accessibility: Some(true),
                screen_recording: None,
                unchecked: false
            }
        );
        assert_eq!(
            parse_permissions_status(r#"{"screenRecording":{"status":"denied"}}"#).screen_recording,
            Some(false)
        );
        assert_eq!(
            parse_permissions_status("garbage"),
            PermissionsStatus::default()
        );
    }

    #[test]
    fn a_driver_that_has_not_checked_yet_says_so() {
        // cua-driver 0.38.0, before `permissions grant` has run.
        let fresh = parse_permissions_status(
            r#"{"daemon_running":false,"reason":"No CuaDriver daemon is running.","status":"unknown"}"#,
        );
        assert!(fresh.unchecked);
        assert_eq!((fresh.accessibility, fresh.screen_recording), (None, None));
        let listening = parse_permissions_status(
            r#"{"daemon_running":true,"reason":"Not yet available.","status":"unknown"}"#,
        );
        assert!(listening.unchecked);
        // 0.38.0 once granted.
        let granted = parse_permissions_status(r#"{"accessibility":true,"screen_recording":true}"#);
        assert!(!granted.unchecked);
        assert_eq!(granted.accessibility, Some(true));
        assert!(!parse_permissions_status("garbage").unchecked);
    }

    #[test]
    fn doctor_collects_failed_checks() {
        assert_eq!(
            parse_doctor(
                r#"{"checks":[{"name":"atspi","ok":false,"message":"AT-SPI bus missing"},{"name":"x11","ok":true,"message":"fine"}]}"#,
                false
            ),
            vec!["AT-SPI bus missing".to_string()]
        );
        assert_eq!(
            parse_doctor(
                r#"[{"name":"portal","status":"error","detail":"No portal\nfound"}]"#,
                true
            ),
            vec!["No portal found".to_string()]
        );
        let many = (0..9)
            .map(|index| format!(r#"{{"ok":false,"message":"problem {index}"}}"#))
            .collect::<Vec<_>>()
            .join(",");
        assert_eq!(parse_doctor(&format!("[{many}]"), false).len(), 5);
        assert_eq!(
            parse_doctor("error: unknown flag --json\n", false),
            vec!["error: unknown flag --json".to_string()]
        );
        assert!(parse_doctor("not json", true).is_empty());
    }

    #[test]
    fn gnome_extension_state_line() {
        assert_eq!(
            parse_gnome_extension_state("winrects@cua\n  State: ACTIVE\n"),
            Some(true)
        );
        assert_eq!(parse_gnome_extension_state("State: INACTIVE"), Some(false));
        assert_eq!(parse_gnome_extension_state(""), None);
    }

    #[test]
    fn the_gnome_helper_only_matters_on_gnome_wayland() {
        let x11 = |name: &str| match name {
            "XDG_CURRENT_DESKTOP" => Some("ubuntu:GNOME".to_string()),
            "XDG_SESSION_TYPE" => Some("x11".to_string()),
            _ => None,
        };
        assert_eq!(gnome_helper_state(&x11), None);
        let kde = |name: &str| match name {
            "XDG_CURRENT_DESKTOP" => Some("KDE".to_string()),
            "XDG_SESSION_TYPE" => Some("wayland".to_string()),
            _ => None,
        };
        assert_eq!(gnome_helper_state(&kde), None);
    }
}
