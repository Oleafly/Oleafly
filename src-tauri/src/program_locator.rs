//! Finds the command line programs Oleafly starts on the user's behalf (agent
//! CLIs, Node.js, uv, Git) and prepares the paths and search path handed to
//! those child processes.
//!
//! Three rules keep Windows working the way a fresh terminal does:
//! - the search path is rebuilt from the registry (machine, then user `Path`)
//!   and from well-known install folders, so a CLI installed after Oleafly
//!   started is still found;
//! - `.cmd` and `.bat` files count as programs (npm, pnpm and Pi install
//!   nothing else), while PowerShell scripts are reported as skipped;
//! - every path handed to a child is a plain path, never the `\\?\` verbatim
//!   form `canonicalize` produces, which Node.js cannot start a script from.

use std::collections::{HashMap, HashSet};
use std::ffi::{OsStr, OsString};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard};
use std::time::{Duration, Instant};

#[cfg(windows)]
#[path = "program_locator/windows.rs"]
mod windows;

#[path = "program_locator/cli.rs"]
mod cli;
pub(crate) use cli::{planned_cli_shim, refresh_cli_shim};

#[cfg(test)]
#[path = "program_locator/tests.rs"]
mod tests;

const CACHE_TTL: Duration = Duration::from_secs(30);
/// Windows program extensions Oleafly starts, in the default `PATHEXT` order.
const WINDOWS_EXTENSIONS: [&str; 4] = [".COM", ".EXE", ".BAT", ".CMD"];
const INTERPRETERS: &[&str] = &[
    "node",
    "python",
    "python3",
    "cmd",
    "powershell",
    "pwsh",
    "bash",
    "sh",
    "zsh",
    "wsl",
];
const SHIM_LIMIT: u64 = 64 * 1024;
const REJECTED_LIMIT: usize = 8;
/// cmd.exe cannot start a script whose path is longer than this.
const CMD_PATH_LIMIT: usize = 260;
const LOGIN_ENV_NAMES: &[&str] = &[
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "ALL_PROXY",
    "NO_PROXY",
    "http_proxy",
    "https_proxy",
    "all_proxy",
    "no_proxy",
    "NODE_EXTRA_CA_CERTS",
    "SSL_CERT_FILE",
    "SSL_CERT_DIR",
    "REQUESTS_CA_BUNDLE",
    "ANTHROPIC_*",
    "OPENAI_*",
    "CLAUDE_CODE_*",
    "CODEX_HOME",
    "GEMINI_API_KEY",
    "GOOGLE_API_KEY",
    "GOOGLE_CLOUD_PROJECT",
    "DEEPSEEK_API_KEY",
    "MOONSHOT_API_KEY",
    "KIMI_API_KEY",
    "ZHIPUAI_API_KEY",
    "ZAI_API_KEY",
    "GLM_API_KEY",
    "DASHSCOPE_API_KEY",
    "QWEN_API_KEY",
    "MINIMAX_API_KEY",
    "MINIMAX_CN_API_KEY",
    "OPENROUTER_API_KEY",
    "PI_CODING_AGENT_DIR",
    "HERMES_HOME",
];
const LOOPBACK_HOSTS: [&str; 3] = ["127.0.0.1", "localhost", "::1"];
const QUIET_DEFAULTS: [(&str, &str); 2] =
    [("NODE_NO_WARNINGS", "1"), ("PYTHONIOENCODING", "utf-8")];
const SECRET_SUFFIXES: [&str; 3] = ["_KEY", "_TOKEN", "_SECRET"];
#[cfg(unix)]
const LOGIN_PROBE_WAIT: Duration = Duration::from_secs(3);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum ProgramKind {
    Native,
    Script,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct Located {
    pub path: PathBuf,
    pub kind: ProgramKind,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum RejectReason {
    NotFound,
    Directory,
    NotExecutable,
    PowerShellScript,
    GuiProgram,
    Interpreter,
    NetworkPath,
}

impl RejectReason {
    pub(crate) fn code(self) -> &'static str {
        match self {
            Self::NotFound => "not_found",
            Self::Directory => "is_directory",
            Self::NotExecutable => "not_executable",
            Self::PowerShellScript => "unsupported_script",
            Self::GuiProgram => "gui_program",
            Self::Interpreter => "interpreter",
            Self::NetworkPath => "network_path",
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct Rejected {
    pub path: PathBuf,
    pub reason: RejectReason,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct ShimTarget {
    pub script: PathBuf,
    pub node: Option<PathBuf>,
}

pub(crate) struct ProbeDir {
    path: PathBuf,
}

impl ProbeDir {
    pub(crate) fn path(&self) -> &Path {
        &self.path
    }
}

impl Drop for ProbeDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.path);
    }
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}

struct SearchCache {
    at: Instant,
    dirs: Vec<PathBuf>,
    user_dirs: HashSet<String>,
}

static SEARCH: Mutex<Option<SearchCache>> = Mutex::new(None);
type LocateResult = (Option<Located>, Vec<Rejected>);
type LocateCache = HashMap<(String, bool), (Instant, LocateResult)>;
static LOCATED: Mutex<Option<LocateCache>> = Mutex::new(None);

#[cfg(unix)]
static LOGIN_PATH: Mutex<Option<Vec<PathBuf>>> = Mutex::new(None);
#[cfg(unix)]
static LOGIN_ENV: Mutex<Option<Vec<(String, OsString)>>> = Mutex::new(None);
#[cfg(unix)]
static PROBING: Mutex<bool> = Mutex::new(false);
#[cfg(unix)]
static PROBED: std::sync::Condvar = std::sync::Condvar::new();

pub(crate) fn search_dirs() -> Vec<PathBuf> {
    with_search(|cache| cache.dirs.clone())
}

pub(crate) fn reachable_by_name(dir: &Path) -> bool {
    let key = dir_key(&dir.to_string_lossy(), cfg!(windows));
    with_search(|cache| cache.user_dirs.contains(&key))
}

fn with_search<T>(read: impl FnOnce(&SearchCache) -> T) -> T {
    let mut cache = lock(&SEARCH);
    if cache
        .as_ref()
        .is_none_or(|cache| cache.at.elapsed() >= CACHE_TTL)
    {
        *cache = Some(compute_search());
    }
    read(cache.as_ref().expect("the search cache was just filled"))
}

fn compute_search() -> SearchCache {
    let windows = cfg!(windows);
    let mut user = Vec::new();
    #[cfg(unix)]
    user.extend(lock(&LOGIN_PATH).clone().unwrap_or_default());
    user.extend(std::env::split_paths(
        &std::env::var_os("PATH").unwrap_or_default(),
    ));
    #[cfg(windows)]
    let blocks = windows::read_environment();
    #[cfg(windows)]
    let process = |name: &str| std::env::var_os(name);
    #[cfg(windows)]
    user.extend(blocks.path_entries(&process));
    #[cfg(windows)]
    let env = |name: &str| blocks.lookup(&process, name);
    #[cfg(not(windows))]
    let env = |name: &str| std::env::var_os(name);
    let user_dirs = normalize_dirs(user.clone(), windows, |_| true)
        .iter()
        .map(|dir| dir_key(&dir.to_string_lossy(), windows))
        .collect();
    let mut entries = user;
    entries.extend(known_dirs(&env, windows));
    entries.extend(discovered_dirs(&env, windows));
    SearchCache {
        at: Instant::now(),
        dirs: normalize_dirs(entries, windows, Path::is_dir),
        user_dirs,
    }
}

pub(crate) fn start_background_probe() {
    #[cfg(unix)]
    spawn_login_probe();
}

pub(crate) fn refresh() {
    clear_caches();
    #[cfg(unix)]
    spawn_login_probe();
}

fn clear_caches() {
    *lock(&SEARCH) = None;
    *lock(&LOCATED) = None;
}

#[cfg(unix)]
fn spawn_login_probe() {
    {
        let mut probing = lock(&PROBING);
        if *probing {
            return;
        }
        *probing = true;
    }
    let spawned = std::thread::Builder::new()
        .name("oleafly-login-path".into())
        .spawn(|| {
            let shell = login_shell();
            let login =
                crate::shell_command::unix::login_shell_environment(shell.as_deref(), &|name| {
                    login_env_name(name, false)
                });
            if !login.path.is_empty() {
                *lock(&LOGIN_PATH) = Some(login.path);
                *lock(&LOGIN_ENV) = Some(login.env);
                clear_caches();
            }
            finish_probe();
        });
    if spawned.is_err() {
        finish_probe();
    }
}

#[cfg(unix)]
fn finish_probe() {
    *lock(&PROBING) = false;
    PROBED.notify_all();
}

pub(crate) fn wait_for_login_probe() {
    #[cfg(unix)]
    wait_while_probing(&PROBING, &PROBED, LOGIN_PROBE_WAIT);
}

#[cfg(unix)]
fn wait_while_probing(probing: &Mutex<bool>, probed: &std::sync::Condvar, limit: Duration) {
    let deadline = Instant::now() + limit;
    let mut running = lock(probing);
    while *running {
        let left = deadline.saturating_duration_since(Instant::now());
        if left.is_zero() {
            return;
        }
        running = match probed.wait_timeout(running, left) {
            Ok((guard, _)) => guard,
            Err(poisoned) => poisoned.into_inner().0,
        };
    }
}

#[cfg(unix)]
fn login_shell() -> Option<PathBuf> {
    env_shell().or_else(account_shell)
}

/// The shell a terminal or a command runs in: the first of `$SHELL` and the
/// account's shell that exists, else `/bin/sh`. Minimal Linux installs have
/// no zsh, and a desktop launch can leave `$SHELL` unset or naming a shell
/// that was since removed.
#[cfg(unix)]
pub(crate) fn user_shell() -> PathBuf {
    first_existing_shell([env_shell(), account_shell()], Path::is_file)
}

#[cfg(unix)]
fn first_existing_shell(
    candidates: [Option<PathBuf>; 2],
    exists: impl Fn(&Path) -> bool,
) -> PathBuf {
    candidates
        .into_iter()
        .flatten()
        .find(|shell| exists(shell))
        .unwrap_or_else(|| PathBuf::from("/bin/sh"))
}

#[cfg(unix)]
fn env_shell() -> Option<PathBuf> {
    std::env::var_os("SHELL")
        .map(PathBuf::from)
        .filter(|shell| shell.is_absolute())
}

#[cfg(unix)]
fn account_shell() -> Option<PathBuf> {
    use std::os::unix::ffi::OsStrExt;
    let mut record = std::mem::MaybeUninit::<libc::passwd>::uninit();
    let mut buffer = vec![0u8; 16 * 1024];
    let mut result: *mut libc::passwd = std::ptr::null_mut();
    // SAFETY: getpwuid_r writes into `record` and `buffer`, which outlive the
    // call, and sets `result` to `record` on success or null otherwise.
    let status = unsafe {
        libc::getpwuid_r(
            libc::getuid(),
            record.as_mut_ptr(),
            buffer.as_mut_ptr().cast(),
            buffer.len(),
            &mut result,
        )
    };
    if status != 0 || result.is_null() {
        return None;
    }
    // SAFETY: `result` points at the initialised `record`, whose `pw_shell`
    // is a NUL-terminated string inside `buffer`.
    let shell = unsafe { (*result).pw_shell };
    if shell.is_null() {
        return None;
    }
    // SAFETY: see above; the string lives in `buffer`.
    let bytes = unsafe { std::ffi::CStr::from_ptr(shell) }.to_bytes();
    let shell = PathBuf::from(std::ffi::OsStr::from_bytes(bytes));
    shell.is_absolute().then_some(shell)
}

fn dir_key(text: &str, windows: bool) -> String {
    if windows {
        let mut key = text.replace('/', "\\").to_lowercase();
        while key.len() > 3 && key.ends_with('\\') {
            key.pop();
        }
        key
    } else {
        let mut key = text.to_string();
        while key.len() > 1 && key.ends_with('/') {
            key.pop();
        }
        while key.contains("//") {
            key = key.replace("//", "/");
        }
        key
    }
}

fn looks_absolute(text: &str, windows: bool) -> bool {
    if windows {
        windows_drive_absolute(text) || text.starts_with("\\\\") || text.starts_with("//")
    } else {
        text.starts_with('/')
    }
}

fn windows_drive_absolute(text: &str) -> bool {
    let bytes = text.as_bytes();
    bytes.len() >= 3
        && bytes[0].is_ascii_alphabetic()
        && bytes[1] == b':'
        && matches!(bytes[2], b'\\' | b'/')
}

fn windows_network_or_device(text: &str) -> bool {
    text.starts_with("\\\\") || text.starts_with("//")
}

pub(crate) fn normalize_dirs(
    entries: impl IntoIterator<Item = PathBuf>,
    windows: bool,
    exists: impl Fn(&Path) -> bool,
) -> Vec<PathBuf> {
    let mut seen = HashSet::new();
    let mut dirs = Vec::new();
    for entry in entries {
        let entry = child_path(&entry);
        let text = entry.to_string_lossy();
        if text.trim().is_empty()
            || (windows && text.contains('"'))
            || (!windows && text.contains(':'))
            || !looks_absolute(&text, windows)
        {
            continue;
        }
        if !seen.insert(dir_key(&text, windows)) || !exists(&entry) {
            continue;
        }
        dirs.push(entry);
    }
    dirs
}

fn join_relative(base: &Path, relative: &str) -> PathBuf {
    relative
        .split(['/', '\\'])
        .filter(|part| !part.is_empty())
        .fold(base.to_path_buf(), |path, part| path.join(part))
}

type Lookup<'a> = &'a dyn Fn(&str) -> Option<OsString>;

fn lookup_dir(env: Lookup<'_>, name: &str) -> Option<PathBuf> {
    env(name)
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
}

fn home_dir(env: Lookup<'_>, windows: bool) -> Option<PathBuf> {
    if windows {
        lookup_dir(env, "USERPROFILE").or_else(|| lookup_dir(env, "HOME"))
    } else {
        lookup_dir(env, "HOME")
    }
}

const HOME_FOLDERS: &[&str] = &[
    ".local/bin",
    ".cargo/bin",
    ".npm-global/bin",
    ".bun/bin",
    ".pi/agent/bin",
    ".opencode/bin",
    ".volta/bin",
    "bin",
];

const UNIX_HOME_FOLDERS: &[&str] = &[
    ".local/share/mise/shims",
    ".asdf/shims",
    ".nodenv/shims",
    ".local/share/fnm/aliases/default/bin",
    "Library/Application Support/fnm/aliases/default/bin",
    ".fnm/aliases/default/bin",
    "Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin",
];

const UNIX_SYSTEM_FOLDERS: &[&str] = &[
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/opt/local/bin",
    "/usr/bin",
    "/home/linuxbrew/.linuxbrew/bin",
    "/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin",
];

const WINDOWS_FOLDERS: &[(&str, &str)] = &[
    ("ProgramFiles", "nodejs"),
    ("ProgramFiles(x86)", "nodejs"),
    ("APPDATA", "npm"),
    ("NVM_SYMLINK", ""),
    ("LOCALAPPDATA", "nvm\\current"),
    ("LOCALAPPDATA", "Programs\\nodejs"),
    ("PNPM_HOME", ""),
    ("LOCALAPPDATA", "pnpm"),
    ("LOCALAPPDATA", "Yarn\\bin"),
    ("LOCALAPPDATA", "Volta\\bin"),
    ("APPDATA", "fnm\\aliases\\default"),
    ("USERPROFILE", "scoop\\shims"),
    ("ProgramData", "chocolatey\\bin"),
    ("LOCALAPPDATA", "Microsoft\\WinGet\\Links"),
    ("LOCALAPPDATA", "hermes\\bin"),
    ("HERMES_HOME", "bin"),
    ("LOCALAPPDATA", "pi-node\\current"),
    (
        "LOCALAPPDATA",
        "Programs\\DeepSeek Harness\\resources\\runtime\\cli\\bin",
    ),
    ("USERPROFILE", ".npm-global"),
];

pub(crate) fn known_dirs(env: Lookup<'_>, windows: bool) -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    let home = home_dir(env, windows);
    if let Some(home) = &home {
        dirs.extend(
            HOME_FOLDERS
                .iter()
                .map(|folder| join_relative(home, folder)),
        );
    }
    if let Some(agent) = lookup_dir(env, "PI_CODING_AGENT_DIR") {
        dirs.push(agent.join("bin"));
    }
    if windows {
        for (variable, folder) in WINDOWS_FOLDERS {
            if let Some(root) = lookup_dir(env, variable) {
                dirs.push(join_relative(&root, folder));
            }
        }
    } else {
        if let Some(fnm) = lookup_dir(env, "FNM_DIR") {
            dirs.push(join_relative(&fnm, "aliases/default/bin"));
        }
        if let Some(home) = &home {
            dirs.extend(
                UNIX_HOME_FOLDERS
                    .iter()
                    .map(|folder| join_relative(home, folder)),
            );
        }
        dirs.extend(UNIX_SYSTEM_FOLDERS.iter().map(PathBuf::from));
    }
    if let Some(prefix) = lookup_dir(env, "npm_config_prefix") {
        dirs.push(npm_prefix_bin(prefix, windows));
    }
    dirs
}

fn npm_prefix_bin(prefix: PathBuf, windows: bool) -> PathBuf {
    if windows {
        prefix
    } else {
        prefix.join("bin")
    }
}

/// Install folders that need a file read to find: nvm's default version and
/// the npm prefix from `~/.npmrc`.
fn discovered_dirs(env: Lookup<'_>, windows: bool) -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    let home = home_dir(env, windows);
    if !windows {
        let nvm =
            lookup_dir(env, "NVM_DIR").or_else(|| home.as_ref().map(|home| home.join(".nvm")));
        if let Some(bin) = nvm.as_deref().and_then(nvm_default_bin) {
            dirs.push(bin);
        }
    }
    if let Some(prefix) = home
        .map(|home| home.join(".npmrc"))
        .and_then(|file| read_small(&file))
        .and_then(|text| npmrc_prefix(&text))
        .map(PathBuf::from)
    {
        dirs.push(npm_prefix_bin(prefix, windows));
    }
    dirs
}

fn read_small(path: &Path) -> Option<String> {
    let metadata = std::fs::metadata(path).ok()?;
    if !metadata.is_file() || metadata.len() > SHIM_LIMIT {
        return None;
    }
    std::fs::read(path)
        .ok()
        .map(|bytes| String::from_utf8_lossy(&bytes).into_owned())
}

pub(crate) fn npmrc_prefix(text: &str) -> Option<String> {
    text.lines().rev().find_map(|line| {
        let line = line.trim();
        if line.starts_with('#') || line.starts_with(';') {
            return None;
        }
        let (key, value) = line.split_once('=')?;
        if !key.trim().eq_ignore_ascii_case("prefix") {
            return None;
        }
        let value = value.trim().trim_matches(['"', '\'']).to_string();
        (looks_absolute(&value, true) || value.starts_with('/')).then_some(value)
    })
}

/// nvm's default Node.js `bin` folder: follows `alias/default` (and aliases it
/// points at) to the newest installed version that matches.
pub(crate) fn nvm_default_bin(nvm_dir: &Path) -> Option<PathBuf> {
    let mut alias = read_small(&nvm_dir.join("alias").join("default"))?
        .trim()
        .to_string();
    for _ in 0..4 {
        if alias.is_empty() || alias.contains("..") {
            break;
        }
        match read_small(&nvm_dir.join("alias").join(&alias)) {
            Some(target) => alias = target.trim().to_string(),
            None => break,
        }
    }
    if alias.is_empty() || alias == "system" || alias.contains("..") {
        return None;
    }
    let wanted = alias.trim_start_matches('v');
    let any = matches!(alias.as_str(), "node" | "stable");
    let versions = nvm_dir.join("versions").join("node");
    let newest = std::fs::read_dir(&versions)
        .ok()?
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let name = entry.file_name().to_string_lossy().into_owned();
            let version = name.strip_prefix('v')?;
            let numbers: Vec<u64> = version
                .split('.')
                .map(|part| part.parse().ok())
                .collect::<Option<_>>()?;
            let matches = any || version == wanted || version.starts_with(&format!("{wanted}."));
            matches.then_some((numbers, name))
        })
        .max()?;
    Some(versions.join(newest.1).join("bin"))
}

#[cfg_attr(not(windows), allow(dead_code))]
#[derive(Clone, Debug, Default)]
pub(crate) struct EnvironmentBlocks {
    pub machine: Vec<(String, String)>,
    pub user: Vec<(String, String)>,
}

#[cfg_attr(not(windows), allow(dead_code))]
impl EnvironmentBlocks {
    fn value<'a>(block: &'a [(String, String)], name: &str) -> Option<&'a str> {
        block
            .iter()
            .find(|(key, _)| key.eq_ignore_ascii_case(name))
            .map(|(_, value)| value.as_str())
    }

    /// A variable from the process first, then the user block, then the
    /// machine block (values stay unexpanded, as Windows reads them).
    pub(crate) fn lookup(&self, process: Lookup<'_>, name: &str) -> Option<OsString> {
        process(name)
            .filter(|value| !value.is_empty())
            .or_else(|| Self::value(&self.user, name).map(OsString::from))
            .or_else(|| Self::value(&self.machine, name).map(OsString::from))
    }

    pub(crate) fn login_env(&self, process: Lookup<'_>) -> Vec<(String, OsString)> {
        let mut env: Vec<(String, OsString)> = Vec::new();
        for (name, value) in self.user.iter().chain(self.machine.iter()) {
            if !login_env_name(name, true)
                || env
                    .iter()
                    .any(|(known, _)| same_env_name(known, name, true))
            {
                continue;
            }
            let expanded = expand_percent(value, &|name| self.lookup(process, name));
            env.push((name.clone(), OsString::from(expanded)));
        }
        env
    }

    pub(crate) fn path_entries(&self, process: Lookup<'_>) -> Vec<PathBuf> {
        [&self.machine, &self.user]
            .into_iter()
            .filter_map(|block| Self::value(block, "Path"))
            .flat_map(|value| {
                let expanded = expand_percent(value, &|name| self.lookup(process, name));
                split_windows_path_list(&expanded)
            })
            .map(PathBuf::from)
            .collect()
    }
}

/// Expands `%NAME%` once, leaving unknown variables literal (Windows'
/// `ExpandEnvironmentStrings` behaviour).
#[cfg_attr(not(windows), allow(dead_code))]
pub(crate) fn expand_percent(value: &str, lookup: Lookup<'_>) -> String {
    let mut out = String::new();
    let mut rest = value;
    while let Some(start) = rest.find('%') {
        out.push_str(&rest[..start]);
        let after = &rest[start + 1..];
        let Some(end) = after.find('%') else {
            out.push_str(&rest[start..]);
            return out;
        };
        let name = &after[..end];
        match (!name.is_empty()).then(|| lookup(name)).flatten() {
            Some(found) => {
                out.push_str(&found.to_string_lossy());
                rest = &after[end + 1..];
            }
            None => {
                out.push('%');
                out.push_str(name);
                rest = &after[end..];
            }
        }
    }
    out.push_str(rest);
    out
}

/// Splits a Windows `PATH` value the way `std::env::split_paths` does on
/// Windows: `;` separates, double quotes group and are removed.
#[cfg_attr(not(windows), allow(dead_code))]
pub(crate) fn split_windows_path_list(value: &str) -> Vec<String> {
    let mut entries = Vec::new();
    let mut current = String::new();
    let mut quoted = false;
    for character in value.chars() {
        match character {
            '"' => quoted = !quoted,
            ';' if !quoted => entries.push(std::mem::take(&mut current)),
            other => current.push(other),
        }
    }
    entries.push(current);
    entries.retain(|entry| !entry.trim().is_empty());
    entries
}

#[derive(Clone, Copy, Debug)]
pub(crate) struct MatchRules<'a> {
    pub windows: bool,
    pub native_only: bool,
    pub pathext: Option<&'a str>,
}

impl MatchRules<'_> {
    fn current(native_only: bool) -> MatchRules<'static> {
        MatchRules {
            windows: cfg!(windows),
            native_only,
            pathext: None,
        }
    }
}

fn windows_kind(extension: &str, native_only: bool) -> Option<ProgramKind> {
    match extension.to_ascii_uppercase().as_str() {
        ".COM" | ".EXE" => Some(ProgramKind::Native),
        ".BAT" | ".CMD" if !native_only => Some(ProgramKind::Script),
        _ => None,
    }
}

pub(crate) fn candidate_names(
    name: &str,
    pathext: Option<&str>,
    native_only: bool,
) -> Vec<(String, ProgramKind)> {
    if let Some(kind) = name
        .rfind('.')
        .and_then(|dot| windows_kind(&name[dot..], native_only))
    {
        return vec![(name.to_string(), kind)];
    }
    let mut extensions: Vec<String> = Vec::new();
    for extension in pathext.unwrap_or_default().split(';').map(str::trim) {
        let upper = extension.to_ascii_uppercase();
        if windows_kind(&upper, native_only).is_some() && !extensions.contains(&upper) {
            extensions.push(upper);
        }
    }
    if extensions.is_empty() {
        extensions = WINDOWS_EXTENSIONS
            .iter()
            .filter(|extension| windows_kind(extension, native_only).is_some())
            .map(|extension| (*extension).to_string())
            .collect();
    }
    extensions
        .into_iter()
        .filter_map(|extension| {
            let kind = windows_kind(&extension, native_only)?;
            Some((format!("{name}{}", extension.to_ascii_lowercase()), kind))
        })
        .collect()
}

/// The Microsoft Store `python.exe` placeholders in `WindowsApps`.
fn windows_store_python(path: &Path) -> bool {
    let in_windows_apps = path
        .parent()
        .and_then(Path::file_name)
        .is_some_and(|name| name.eq_ignore_ascii_case("WindowsApps"));
    let python = path
        .file_name()
        .map(|name| name.to_string_lossy().to_ascii_lowercase())
        .is_some_and(|name| name.starts_with("python"));
    in_windows_apps && python
}

fn file_like(path: &Path, windows: bool) -> bool {
    match std::fs::metadata(path) {
        Ok(metadata) => metadata.is_file(),
        Err(_) => {
            windows
                && path
                    .parent()
                    .and_then(Path::file_name)
                    .is_some_and(|name| name.eq_ignore_ascii_case("WindowsApps"))
                && std::fs::symlink_metadata(path).is_ok_and(|metadata| !metadata.is_dir())
        }
    }
}

#[cfg(unix)]
fn executable_by_user(path: &Path) -> bool {
    use std::os::unix::ffi::OsStrExt;
    let Ok(text) = std::ffi::CString::new(path.as_os_str().as_bytes()) else {
        return false;
    };
    // SAFETY: `text` is a valid NUL-terminated string for the call.
    unsafe { libc::access(text.as_ptr(), libc::X_OK) == 0 }
}

#[cfg(not(unix))]
fn executable_by_user(_path: &Path) -> bool {
    true
}

pub(crate) fn match_in_dir(dir: &Path, name: &str, rules: MatchRules<'_>) -> LocateResult {
    if rules.windows {
        for (file, kind) in candidate_names(name, rules.pathext, rules.native_only) {
            let path = dir.join(&file);
            if windows_store_python(&path) {
                continue;
            }
            if file_like(&path, true) {
                return (Some(Located { path, kind }), Vec::new());
            }
        }
        let mut rejected = Vec::new();
        let has_extension = name
            .rfind('.')
            .is_some_and(|dot| windows_kind(&name[dot..], false).is_some());
        if !has_extension && !rules.native_only {
            let script = dir.join(format!("{name}.ps1"));
            if file_like(&script, false) {
                rejected.push(Rejected {
                    path: script,
                    reason: RejectReason::PowerShellScript,
                });
            }
            let bare = dir.join(name);
            if file_like(&bare, false) {
                rejected.push(Rejected {
                    path: bare,
                    reason: RejectReason::NotExecutable,
                });
            }
        }
        return (None, rejected);
    }
    let path = dir.join(name);
    match std::fs::metadata(&path) {
        Ok(metadata) if metadata.is_file() && executable_by_user(&path) => (
            Some(Located {
                path,
                kind: ProgramKind::Native,
            }),
            Vec::new(),
        ),
        Ok(metadata) if metadata.is_file() && !rules.native_only => (
            None,
            vec![Rejected {
                path,
                reason: RejectReason::NotExecutable,
            }],
        ),
        _ => (None, Vec::new()),
    }
}

pub(crate) fn search_in(dirs: &[PathBuf], name: &str, rules: MatchRules<'_>) -> LocateResult {
    let mut rejected = Vec::new();
    for dir in dirs {
        let (found, skipped) = match_in_dir(dir, name, rules);
        for entry in skipped {
            if rejected.len() < REJECTED_LIMIT {
                rejected.push(entry);
            }
        }
        if found.is_some() {
            return (found, rejected);
        }
    }
    (None, rejected)
}

pub(crate) fn valid_program_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 100
        && name
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"._-".contains(&byte))
        && !name.starts_with('.')
}

fn locate_cached(name: &str, native_only: bool) -> LocateResult {
    if !valid_program_name(name) {
        return (None, Vec::new());
    }
    let key = (name.to_string(), native_only);
    if let Some((at, result)) = lock(&LOCATED).as_ref().and_then(|cache| cache.get(&key)) {
        if at.elapsed() < CACHE_TTL {
            return result.clone();
        }
    }
    let mut rules = MatchRules::current(native_only);
    let pathext = std::env::var("PATHEXT").ok();
    rules.pathext = pathext.as_deref();
    let result = search_in(&search_dirs(), name, rules);
    lock(&LOCATED)
        .get_or_insert_with(HashMap::new)
        .insert(key, (Instant::now(), result.clone()));
    result
}

pub(crate) fn locate(name: &str) -> (Option<Located>, Vec<Rejected>) {
    locate_cached(name, false)
}

pub(crate) fn locate_native(name: &str) -> Option<Located> {
    locate_cached(name, true).0
}

pub(crate) fn locate_path(path: &Path) -> Result<Located, RejectReason> {
    let windows = cfg!(windows);
    let text = path.to_string_lossy();
    if !looks_absolute(&text, windows) {
        return Err(RejectReason::NotFound);
    }
    let metadata = std::fs::metadata(path).map_err(|_| RejectReason::NotFound)?;
    if metadata.is_dir() {
        return Err(RejectReason::Directory);
    }
    let path = child_path(path);
    if windows {
        let kind = path
            .extension()
            .and_then(|extension| windows_kind(&format!(".{}", extension.to_string_lossy()), false))
            .ok_or_else(|| windows_extension_reason(&path))?;
        return Ok(Located { path, kind });
    }
    if !metadata.is_file() || !executable_by_user(&path) {
        return Err(RejectReason::NotExecutable);
    }
    Ok(Located {
        path,
        kind: ProgramKind::Native,
    })
}

fn windows_extension_reason(path: &Path) -> RejectReason {
    if path
        .extension()
        .is_some_and(|extension| extension.eq_ignore_ascii_case("ps1"))
    {
        RejectReason::PowerShellScript
    } else {
        RejectReason::NotExecutable
    }
}

pub(crate) fn expand_tilde(path: &Path, home: Option<&Path>) -> PathBuf {
    let text = path.to_string_lossy();
    let Some(home) = home else {
        return path.to_path_buf();
    };
    if text == "~" {
        return home.to_path_buf();
    }
    match text.strip_prefix("~/").or_else(|| text.strip_prefix("~\\")) {
        Some(rest) => join_relative(home, rest),
        None => path.to_path_buf(),
    }
}

pub(crate) fn pe_subsystem(bytes: &[u8]) -> Option<u16> {
    if bytes.get(..2)? != b"MZ" {
        return None;
    }
    let header = u32::from_le_bytes(bytes.get(0x3C..0x40)?.try_into().ok()?) as usize;
    if bytes.get(header..header.checked_add(4)?)? != b"PE\0\0" {
        return None;
    }
    let field = header.checked_add(4 + 20 + 68)?;
    Some(u16::from_le_bytes(
        bytes.get(field..field.checked_add(2)?)?.try_into().ok()?,
    ))
}

const PE_CONSOLE: u16 = 3;

fn read_head(path: &Path, limit: u64) -> Option<Vec<u8>> {
    use std::io::Read;
    let mut bytes = Vec::new();
    std::fs::File::open(path)
        .ok()?
        .take(limit)
        .read_to_end(&mut bytes)
        .ok()?;
    Some(bytes)
}

/// A program inside a macOS application bundle (`*.app/Contents/MacOS/`).
pub(crate) fn inside_app_bundle(path: &Path) -> bool {
    let parts: Vec<String> = path
        .components()
        .map(|part| part.as_os_str().to_string_lossy().to_ascii_lowercase())
        .collect();
    parts.windows(3).any(|window| {
        window[0].ends_with(".app") && window[1] == "contents" && window[2] == "macos"
    })
}

fn interpreter(path: &Path) -> bool {
    path.file_stem()
        .map(|stem| stem.to_string_lossy().to_ascii_lowercase())
        .is_some_and(|stem| INTERPRETERS.contains(&stem.as_str()))
}

#[derive(Clone, Copy, Debug)]
pub(crate) struct Platform {
    pub windows: bool,
    pub macos: bool,
}

impl Platform {
    pub(crate) fn current() -> Self {
        Self {
            windows: cfg!(windows),
            macos: cfg!(target_os = "macos"),
        }
    }
}

pub(crate) fn inspect(path: &Path) -> Result<Located, RejectReason> {
    let home = crate::paths::home_dir().ok();
    inspect_on(&expand_tilde(path, home.as_deref()), Platform::current())
}

pub(crate) fn inspect_on(path: &Path, platform: Platform) -> Result<Located, RejectReason> {
    let text = path.to_string_lossy();
    if platform.windows {
        if windows_network_or_device(&text) {
            return Err(RejectReason::NetworkPath);
        }
        if !windows_drive_absolute(&text) {
            return Err(RejectReason::NotFound);
        }
    } else if !text.starts_with('/') {
        return Err(RejectReason::NotFound);
    }
    let metadata = std::fs::metadata(path).map_err(|_| RejectReason::NotFound)?;
    if metadata.is_dir() {
        return Err(RejectReason::Directory);
    }
    if !metadata.is_file() {
        return Err(RejectReason::NotExecutable);
    }
    if interpreter(path) {
        return Err(RejectReason::Interpreter);
    }
    let path = child_path(path);
    if platform.windows {
        let extension = path
            .extension()
            .map(|extension| format!(".{}", extension.to_string_lossy()))
            .unwrap_or_default();
        return match windows_kind(&extension, false) {
            Some(ProgramKind::Native) => {
                match read_head(&path, 64 * 1024)
                    .as_deref()
                    .and_then(pe_subsystem)
                {
                    Some(PE_CONSOLE) => Ok(Located {
                        path,
                        kind: ProgramKind::Native,
                    }),
                    Some(_) => Err(RejectReason::GuiProgram),
                    None => Err(RejectReason::NotExecutable),
                }
            }
            Some(ProgramKind::Script) => Ok(Located {
                path,
                kind: ProgramKind::Script,
            }),
            None => Err(windows_extension_reason(&path)),
        };
    }
    if platform.macos && inside_app_bundle(&path) {
        return Err(RejectReason::GuiProgram);
    }
    if !executable_by_user(&path) {
        return Err(RejectReason::NotExecutable);
    }
    Ok(Located {
        path,
        kind: ProgramKind::Native,
    })
}

pub(crate) fn child_path(path: &Path) -> PathBuf {
    oleafly_core::plain_path(path)
}

pub(crate) fn child_search_path(prepend: &[PathBuf], append: &[PathBuf]) -> OsString {
    let dirs = normalize_dirs(
        prepend
            .iter()
            .cloned()
            .chain(search_dirs())
            .chain(append.iter().cloned()),
        cfg!(windows),
        Path::is_dir,
    );
    std::env::join_paths(&dirs).unwrap_or_else(|_| std::env::var_os("PATH").unwrap_or_default())
}

pub(crate) fn child_env(prepend: &[PathBuf], append: &[PathBuf]) -> Vec<(String, OsString)> {
    let mut env = vec![("PATH".to_string(), child_search_path(prepend, append))];
    if cfg!(windows) {
        env.push((
            "NoDefaultCurrentDirectoryInExePath".to_string(),
            OsString::from("1"),
        ));
    }
    let process = |name: &str| std::env::var_os(name);
    env.extend(agent_env(&process, &captured_env(), cfg!(windows)));
    env
}

pub(crate) fn login_env_name(name: &str, windows: bool) -> bool {
    LOGIN_ENV_NAMES
        .iter()
        .any(|pattern| match pattern.strip_suffix('*') {
            Some(prefix) => {
                name.len() > prefix.len()
                    && name
                        .get(..prefix.len())
                        .is_some_and(|start| same_env_name(start, prefix, windows))
            }
            None => same_env_name(name, pattern, windows),
        })
}

pub(crate) fn shell_supplied_env_name(name: &str) -> bool {
    let windows = cfg!(windows);
    login_env_name(name, windows)
        || QUIET_DEFAULTS
            .iter()
            .any(|(quiet, _)| same_env_name(name, quiet, windows))
}

fn same_env_name(left: &str, right: &str, windows: bool) -> bool {
    if windows {
        left.eq_ignore_ascii_case(right)
    } else {
        left == right
    }
}

#[cfg(unix)]
fn captured_env() -> Vec<(String, OsString)> {
    lock(&LOGIN_ENV).clone().unwrap_or_default()
}

#[cfg(windows)]
fn captured_env() -> Vec<(String, OsString)> {
    windows::read_environment().login_env(&|name| std::env::var_os(name))
}

pub(crate) fn agent_env(
    process: Lookup<'_>,
    captured: &[(String, OsString)],
    windows: bool,
) -> Vec<(String, OsString)> {
    let mut env: Vec<(String, OsString)> = Vec::new();
    for (name, value) in captured {
        if !login_env_name(name, windows)
            || process(name).is_some()
            || env
                .iter()
                .any(|(known, _)| same_env_name(known, name, windows))
        {
            continue;
        }
        env.push((name.clone(), value.clone()));
    }
    let spellings: &[&str] = if windows {
        &["NO_PROXY"]
    } else {
        &["NO_PROXY", "no_proxy"]
    };
    let mut existing = Vec::new();
    for name in spellings {
        let added = env
            .iter()
            .position(|(known, _)| same_env_name(known, name, windows));
        existing.push(match added {
            Some(index) => Some(env.remove(index).1),
            None => process(name),
        });
    }
    let existing: Vec<Option<&OsStr>> = existing.iter().map(Option::as_deref).collect();
    let merged = merged_no_proxy(&existing);
    for name in spellings {
        env.push(((*name).to_string(), merged.clone()));
    }
    for (name, value) in QUIET_DEFAULTS {
        if process(name).is_none() {
            env.push((name.to_string(), OsString::from(value)));
        }
    }
    env
}

pub(crate) fn with_loopback_no_proxy(existing: Option<&OsStr>) -> OsString {
    merged_no_proxy(&[existing])
}

pub(crate) fn merged_no_proxy(values: &[Option<&OsStr>]) -> OsString {
    let texts: Vec<String> = values
        .iter()
        .flatten()
        .map(|value| value.to_string_lossy().into_owned())
        .collect();
    let mut entries: Vec<&str> = Vec::new();
    let listed = texts.iter().flat_map(|text| text.split(',')).map(str::trim);
    for entry in listed.chain(LOOPBACK_HOSTS) {
        if !entry.is_empty()
            && !entries
                .iter()
                .any(|known| known.eq_ignore_ascii_case(entry))
        {
            entries.push(entry);
        }
    }
    OsString::from(entries.join(","))
}

pub(crate) fn host_env() -> impl Fn(&str) -> Option<OsString> {
    let captured = captured_env();
    let windows = cfg!(windows);
    move |name: &str| {
        std::env::var_os(name).or_else(|| {
            captured
                .iter()
                .find(|(known, _)| same_env_name(known, name, windows))
                .map(|(_, value)| value.clone())
        })
    }
}

pub(crate) fn login_env_secrets() -> Vec<String> {
    secret_values(&captured_env())
}

pub(crate) fn secret_values(env: &[(String, OsString)]) -> Vec<String> {
    env.iter()
        .filter_map(|(name, value)| {
            let upper = name.to_ascii_uppercase();
            let value = value.to_str()?;
            if SECRET_SUFFIXES.iter().any(|suffix| upper.ends_with(suffix)) {
                return Some(value.to_owned());
            }
            if !upper.ends_with("_PROXY") {
                return None;
            }
            reqwest::Url::parse(value)
                .ok()
                .and_then(|url| url.password().map(str::to_owned))
                .filter(|password| !password.is_empty())
        })
        .collect()
}

/// Whether a working folder is a network (UNC) path, where cmd.exe cannot run.
pub(crate) fn network_folder(path: &Path) -> bool {
    cfg!(windows) && windows_network_or_device(&child_path(path).to_string_lossy())
}

/// Refuses a cmd.exe launch that cannot work: from a network folder cmd.exe
/// silently switches to `C:\Windows`, it cannot start a script whose path is
/// longer than 260 characters, and it expands `%` inside the script's own path
/// (Rust escapes arguments, not the script name).
pub(crate) fn script_launch_check(program: &Path, cwd: &Path) -> Result<(), String> {
    if program.to_string_lossy().contains('%') {
        return Err(format!(
            "Windows can't start {} from a folder whose name contains %. Move it to another folder.",
            program_label(program)
        ));
    }
    if network_folder(cwd) {
        return Err(format!(
            "{} can't start from a network folder. Open the project from a drive letter, such as Z:, and try again.",
            program_label(program)
        ));
    }
    if program.as_os_str().len() > CMD_PATH_LIMIT {
        return Err(format!(
            "The path to {} is too long for Windows to start it. Move it to a shorter folder.",
            program_label(program)
        ));
    }
    Ok(())
}

fn program_label(program: &Path) -> String {
    program
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| program.to_string_lossy().into_owned())
}

#[derive(Debug, PartialEq, Eq)]
pub(crate) struct ParsedShim {
    pub relative: String,
    /// An absolute Node.js named in the shim (pnpm's `nodeExecPath`).
    pub node: Option<String>,
}

#[derive(Debug, PartialEq, Eq)]
enum Token {
    Quoted(String),
    Bare(String),
}

fn tokens(line: &str) -> Option<Vec<Token>> {
    let mut tokens = Vec::new();
    let mut chars = line.chars().peekable();
    while let Some(&next) = chars.peek() {
        if next.is_whitespace() {
            chars.next();
            continue;
        }
        if next == '"' {
            chars.next();
            let mut value = String::new();
            loop {
                match chars.next() {
                    Some('"') => break,
                    Some(character) => value.push(character),
                    None => return None,
                }
            }
            tokens.push(Token::Quoted(value));
        } else {
            let mut value = String::new();
            while let Some(&character) = chars.peek() {
                if character.is_whitespace() || character == '"' {
                    break;
                }
                value.push(character);
                chars.next();
            }
            tokens.push(Token::Bare(value));
        }
    }
    Some(tokens)
}

const SHIM_LINES: &[&str] = &[
    "echo off",
    "goto start",
    ":find_dp0",
    "set dp0=%~dp0",
    "exit /b",
    "exit /b %errorlevel%",
    ":start",
    "setlocal",
    "endlocal",
    "call :find_dp0",
    "if exist \"%dp0%\\node.exe\" (",
    "if exist \"%~dp0\\node.exe\" (",
    ") else (",
    ")",
    "set \"_prog=%dp0%\\node.exe\"",
    "set \"_prog=node\"",
    "set pathext=%pathext:;.js;=;%",
];

/// Commands npm's cmd-shim chains before `"%_prog%"` on its last line.
const SHIM_PREFIX: &[&str] = &[
    "endlocal",
    "goto #_undefined_# 2>nul || title %comspec%",
    "set pathext=%pathext:;.js;=;%",
];

fn shim_target_token(token: &Token, npm_style: bool) -> Option<String> {
    let Token::Quoted(value) = token else {
        return None;
    };
    let lower = value.to_ascii_lowercase();
    let rest = if npm_style {
        lower.strip_prefix("%dp0%\\").map(|_| &value[6..])?
    } else if lower.starts_with("%~dp0\\") {
        &value[6..]
    } else if lower.starts_with("%~dp0") {
        &value[5..]
    } else {
        return None;
    };
    (!rest.is_empty()).then(|| rest.to_string())
}

fn shim_invocation(line: &str) -> Option<ParsedShim> {
    let lower = line.to_ascii_lowercase();
    if let Some(index) = lower.find("\"%_prog%\"") {
        let prefix = lower[..index].trim();
        if !prefix.is_empty() {
            let prefix = prefix.strip_suffix('&')?;
            if !prefix
                .split('&')
                .map(str::trim)
                .all(|segment| SHIM_PREFIX.contains(&segment))
            {
                return None;
            }
        }
        let rest = tokens(&line[index + "\"%_prog%\"".len()..])?;
        return match rest.as_slice() {
            [target, Token::Bare(all)] if all == "%*" => Some(ParsedShim {
                relative: shim_target_token(target, true)?,
                node: None,
            }),
            _ => None,
        };
    }
    let parts = tokens(line)?;
    let [program, target, Token::Bare(all)] = parts.as_slice() else {
        return None;
    };
    if all != "%*" {
        return None;
    }
    let node = match program {
        Token::Bare(name) if name.eq_ignore_ascii_case("node") => None,
        Token::Quoted(path) if path.eq_ignore_ascii_case("%~dp0\\node.exe") => None,
        Token::Quoted(path)
            if windows_drive_absolute(path)
                && path.to_ascii_lowercase().ends_with("\\node.exe") =>
        {
            Some(path.clone())
        }
        _ => return None,
    };
    Some(ParsedShim {
        relative: shim_target_token(target, false)?,
        node,
    })
}

pub(crate) fn parse_shim(text: &str) -> Option<ParsedShim> {
    let mut parsed: Option<ParsedShim> = None;
    for line in text.lines() {
        let line = line.trim();
        let line = line.strip_prefix('@').unwrap_or(line).trim();
        if line.is_empty() || SHIM_LINES.contains(&line.to_ascii_lowercase().as_str()) {
            continue;
        }
        let invocation = shim_invocation(line)?;
        let Some(previous) = &mut parsed else {
            parsed = Some(invocation);
            continue;
        };
        if previous.relative != invocation.relative {
            return None;
        }
        if let Some(node) = invocation.node {
            if previous.node.as_ref().is_some_and(|known| known != &node) {
                return None;
            }
            previous.node = Some(node);
        }
    }
    parsed
}

fn shim_relative_path(relative: &str) -> Option<PathBuf> {
    if relative.starts_with(['\\', '/']) || relative.contains(':') {
        return None;
    }
    let mut path = PathBuf::new();
    for part in relative.split(['\\', '/']) {
        match part {
            "" | "." => {}
            ".." => return None,
            part => path.push(part),
        }
    }
    (!path.as_os_str().is_empty()).then_some(path)
}

pub(crate) fn npm_shim_target(cmd: &Path) -> Option<ShimTarget> {
    let text = read_small(cmd)?;
    let parsed = parse_shim(&text)?;
    let relative = shim_relative_path(&parsed.relative)?;
    let name = relative.file_name()?.to_string_lossy().to_ascii_lowercase();
    if name == "node.exe" {
        return None;
    }
    let script_like = match relative.extension() {
        None => true,
        Some(extension) => ["js", "cjs", "mjs"]
            .iter()
            .any(|allowed| extension.eq_ignore_ascii_case(allowed)),
    };
    if !script_like {
        return None;
    }
    let folder = cmd.parent()?;
    let script = folder.join(&relative);
    let canonical_folder = folder.canonicalize().ok()?;
    let canonical_script = script.canonicalize().ok()?;
    if !canonical_script.starts_with(&canonical_folder) || !canonical_script.is_file() {
        return None;
    }
    let beside = folder.join("node.exe");
    let node = if beside.is_file() {
        Some(beside)
    } else {
        parsed.node.map(PathBuf::from).filter(|node| node.is_file())
    };
    Some(ShimTarget {
        script: child_path(&script),
        node: node.map(|node| child_path(&node)),
    })
}

pub(crate) fn probe_dir() -> std::io::Result<ProbeDir> {
    let parent = crate::paths::oleafly_root()
        .map_err(std::io::Error::other)?
        .join("acp")
        .join("probe");
    probe_dir_in(&parent)
}

pub(crate) fn probe_dir_in(parent: &Path) -> std::io::Result<ProbeDir> {
    let path = child_path(parent).join(crate::acp::new_id());
    std::fs::create_dir_all(&path)?;
    Ok(ProbeDir { path })
}
