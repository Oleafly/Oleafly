use std::collections::BTreeSet;
use std::ffi::OsString;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::app_error::AppError;
use crate::fs_identity::FsIdentity;
use crate::known_folders::is_broad_folder;
use crate::project::ProjectMeta;

const TRUST_FILE: &str = "folders.json";
const TRUST_LOCK: &str = ".folders.lock";
const TRUST_VERSION: u8 = 1;
const MAX_GIT_CONFIG_FILES: usize = 64;
const MAX_GIT_MODULE_DIRS: usize = 64;
const MAX_NESTED_SCAN_DIRS: usize = 128;
const MAX_NESTED_SCAN_DEPTH: usize = 5;
const MAX_GIT_CONFIG_BYTES: u64 = 256 * 1024;
const RUN_COMMAND_REFUSAL: &str =
    "Commands are turned off in this folder until the user trusts it in Oleafly.";
const NETWORK_TOOLS: &[&str] = &[
    "literature_search",
    "alphaxiv_search",
    "alphaxiv_paper_content",
    "verify_citation",
    "computer_use",
];
const DOCUMENT_EXTENSIONS: &[&str] = &[
    "bbl", "bbx", "bib", "bst", "cbx", "cfg", "cls", "csv", "dat", "def", "dtx", "eps", "gif",
    "ins", "ist", "jpeg", "jpg", "json", "latex", "lbx", "ltx", "markdown", "md", "pdf", "pgf",
    "png", "ps", "qmd", "sty", "svg", "tex", "tikz", "toml", "tsv", "txt", "typ", "webp", "xml",
    "yaml", "yml",
];
const EXECUTABLE_CONFIG_NAMES: &[&str] = &[
    "arara.yaml",
    "arara.yml",
    "cargo.toml",
    "cmakelists.txt",
    "composer.json",
    "deno.json",
    "devbox.json",
    "mise.toml",
    "package.json",
    "pyproject.toml",
    "taskfile.yaml",
    "taskfile.yml",
];

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Capability {
    Git,
    TerminalAutostart,
    ExternalAgents,
    McpExposure,
    ResearchTasks,
    RunCommand,
    FullAccess,
    SystemTex,
    ShellEscape,
}

impl Capability {
    pub const fn error_code(self) -> &'static str {
        match self {
            Self::Git => "trust.git",
            Self::TerminalAutostart => "trust.terminal",
            Self::ExternalAgents => "trust.agents",
            Self::McpExposure => "trust.mcp",
            Self::ResearchTasks => "trust.research_tasks",
            Self::RunCommand => "trust.run_command",
            Self::FullAccess => "trust.full_access",
            Self::SystemTex => "trust.system_tex",
            Self::ShellEscape => "trust.shell_escape",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum TrustSource {
    Library,
    Folder,
    ParentFolder,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TrustState {
    Trusted(TrustSource),
    Restricted,
}

impl TrustState {
    pub const fn is_trusted(self) -> bool {
        matches!(self, Self::Trusted(_))
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum McpExposure {
    Closed,
    ReadOnly,
    Full,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TrustScope {
    #[default]
    Folder,
    Parent,
    Repository,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepositoryTrust {
    pub name: String,
    pub trusted: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectTrust {
    pub trusted: bool,
    pub source: Option<TrustSource>,
    pub parent: Option<String>,
    pub repository: Option<RepositoryTrust>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AiConfirm {
    Write(String),
    Network(String),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AiToolGate {
    Allow,
    Confirm(AiConfirm),
    Forbid(&'static str),
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
struct TrustFile {
    #[serde(default)]
    version: u8,
    #[serde(default)]
    folders: Vec<FolderGrant>,
    #[serde(default)]
    restricted_library: BTreeSet<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
struct FolderGrant {
    id: Option<String>,
    #[serde(default)]
    scope: TrustScope,
    canonical_path: String,
    identity: String,
    granted_at: u64,
}

enum Subject {
    Library,
    Linked { root: PathBuf },
}

enum GrantTarget {
    Library {
        name: String,
    },
    Project {
        root: PathBuf,
        binding: String,
    },
    Folder {
        path: PathBuf,
        binding: String,
        scope: TrustScope,
    },
}

fn unavailable(detail: impl ToString) -> AppError {
    AppError::new("trust.unavailable").detail(detail)
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|elapsed| u64::try_from(elapsed.as_millis()).unwrap_or(u64::MAX))
        .unwrap_or(0)
}

fn folder_name(path: &Path) -> String {
    path.file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| path.to_string_lossy().into_owned())
}

fn subject(project_id: &str) -> Result<Subject, AppError> {
    if crate::project_location::linked_state_dir(project_id)
        .map_err(unavailable)?
        .is_none()
    {
        return Ok(Subject::Library);
    }
    let location = crate::project_location::locate(project_id)
        .map_err(|error| unavailable(String::from(error)))?;
    Ok(match location.kind {
        crate::project_location::ProjectKind::Library => Subject::Library,
        crate::project_location::ProjectKind::Linked => Subject::Linked {
            root: location.root,
        },
    })
}

fn path_bytes(path: &Path) -> Vec<u8> {
    #[cfg(unix)]
    {
        use std::os::unix::ffi::OsStrExt as _;
        path.as_os_str().as_bytes().to_vec()
    }
    #[cfg(windows)]
    {
        use std::os::windows::ffi::OsStrExt as _;
        path.as_os_str()
            .encode_wide()
            .flat_map(u16::to_le_bytes)
            .collect()
    }
    #[cfg(not(any(unix, windows)))]
    {
        path.to_string_lossy().as_bytes().to_vec()
    }
}

fn binding_of(path: &Path, identity: &FsIdentity, mount: &[u8]) -> String {
    use sha2::{Digest, Sha256};
    let mut digest = Sha256::new();
    digest.update(b"oleafly-folder-trust-v1\0");
    if identity.weak {
        digest.update(b"weak\0");
        digest.update(path_bytes(path));
        digest.update([0]);
        digest.update(mount);
        digest.update([0]);
    }
    digest.update(identity.volume.as_deref().unwrap_or_default().as_bytes());
    digest.update([0]);
    digest.update(identity.file.as_bytes());
    digest.update([0]);
    digest.update(identity.birth_ns.unwrap_or_default().to_le_bytes());
    format!("{:x}", digest.finalize())
}

#[cfg(unix)]
fn mount_token(path: &Path) -> Option<Vec<u8>> {
    use std::os::unix::fs::MetadataExt as _;
    std::fs::symlink_metadata(path)
        .ok()
        .map(|metadata| metadata.dev().to_le_bytes().to_vec())
}

#[cfg(not(unix))]
fn mount_token(_path: &Path) -> Option<Vec<u8>> {
    Some(Vec::new())
}

fn current_binding(path: &Path) -> Option<String> {
    let observed = crate::fs_identity::identify_directory(path).ok()?;
    let mount = if observed.identity.weak {
        mount_token(path)?
    } else {
        Vec::new()
    };
    Some(binding_of(path, &observed.identity, &mount))
}

fn covered_by_parent_grant(
    file: &TrustFile,
    path: &Path,
    bind: &dyn Fn(&Path) -> Option<String>,
) -> bool {
    file.folders
        .iter()
        .filter(|grant| grant.id.is_none() && grant.scope == TrustScope::Parent)
        .any(|grant| {
            let folder = Path::new(&grant.canonical_path);
            path.starts_with(folder)
                && bind(folder).is_some_and(|current| current == grant.identity)
        })
}

fn repository_trusted(
    file: &TrustFile,
    toplevel: &Path,
    bind: &dyn Fn(&Path) -> Option<String>,
) -> bool {
    covered_by_parent_grant(file, toplevel, bind)
        || file.folders.iter().any(|grant| {
            grant.id.is_none()
                && grant.scope == TrustScope::Repository
                && Path::new(&grant.canonical_path) == toplevel
                && bind(toplevel).is_some_and(|current| current == grant.identity)
        })
}

fn evaluate(
    file: &TrustFile,
    project_id: &str,
    subject: &Subject,
    bind: &dyn Fn(&Path) -> Option<String>,
) -> TrustState {
    let root = match subject {
        Subject::Library if file.restricted_library.contains(project_id) => {
            return TrustState::Restricted
        }
        Subject::Library => return TrustState::Trusted(TrustSource::Library),
        Subject::Linked { root } => root,
    };
    let Some(current) = bind(root) else {
        return TrustState::Restricted;
    };
    if file
        .folders
        .iter()
        .any(|grant| grant.id.as_deref() == Some(project_id) && grant.identity == current)
    {
        return TrustState::Trusted(TrustSource::Folder);
    }
    if covered_by_parent_grant(file, root, bind) {
        return TrustState::Trusted(TrustSource::ParentFolder);
    }
    TrustState::Restricted
}

fn trust_file_for_read() -> Result<PathBuf, String> {
    let directory = crate::paths::oleafly_root()?.join("device-trust");
    if let Ok(metadata) = std::fs::symlink_metadata(&directory) {
        if !metadata.is_dir()
            || metadata.file_type().is_symlink()
            || crate::paths::is_reparse_point(&metadata)
        {
            return Err("device trust is not a real directory".into());
        }
    }
    Ok(directory.join(TRUST_FILE))
}

fn read_trust_file() -> Result<TrustFile, String> {
    let path = trust_file_for_read()?;
    let metadata = match std::fs::symlink_metadata(&path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(TrustFile::default())
        }
        Err(error) => return Err(format!("failed to inspect folder trust: {error}")),
    };
    if !metadata.is_file()
        || metadata.file_type().is_symlink()
        || crate::paths::is_reparse_point(&metadata)
    {
        return Err("folder trust is not a regular file".into());
    }
    let bytes = std::fs::read(&path).map_err(|e| format!("failed to read folder trust: {e}"))?;
    let file: TrustFile =
        serde_json::from_slice(&bytes).map_err(|e| format!("folder trust is unreadable: {e}"))?;
    if file.version != TRUST_VERSION {
        return Err("folder trust has an unknown version".into());
    }
    Ok(file)
}

struct TrustWriteLock {
    _file: std::fs::File,
    _guard: std::sync::MutexGuard<'static, ()>,
}

fn lock_trust_writes() -> Result<TrustWriteLock, String> {
    use oleafly_core::locking::{lock_file, lock_mutex, STORAGE_LOCK_TIMEOUT};
    static LOCK: std::sync::OnceLock<std::sync::Mutex<()>> = std::sync::OnceLock::new();
    let guard = lock_mutex(
        LOCK.get_or_init(|| std::sync::Mutex::new(())),
        STORAGE_LOCK_TIMEOUT,
    )
    .map_err(|error| format!("failed to lock folder trust: {error}"))?;
    let path = crate::paths::device_trust_root()?.join(TRUST_LOCK);
    if std::fs::symlink_metadata(&path).is_ok_and(|metadata| metadata.file_type().is_symlink()) {
        return Err("folder trust lock cannot be a symbolic link".into());
    }
    let mut options = std::fs::OpenOptions::new();
    options.read(true).write(true).create(true).truncate(false);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt as _;
        options.mode(0o600);
    }
    let file = options
        .open(&path)
        .map_err(|error| format!("failed to open folder trust lock: {error}"))?;
    crate::fsperm::harden_file(&path);
    lock_file(&file, true, STORAGE_LOCK_TIMEOUT)
        .map_err(|error| format!("failed to lock folder trust: {error}"))?;
    Ok(TrustWriteLock {
        _file: file,
        _guard: guard,
    })
}

fn write_trust_file(file: &TrustFile) -> Result<(), String> {
    let path = crate::paths::device_trust_root()?.join(TRUST_FILE);
    if let Ok(metadata) = std::fs::symlink_metadata(&path) {
        if !metadata.is_file()
            || metadata.file_type().is_symlink()
            || crate::paths::is_reparse_point(&metadata)
        {
            return Err("folder trust path is not a regular file".into());
        }
    }
    let bytes = serde_json::to_vec_pretty(file).map_err(|e| e.to_string())?;
    let transaction = crate::sandbox::AtomicFile::new(&path)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt as _;
        std::fs::set_permissions(
            transaction.staging_path(),
            std::fs::Permissions::from_mode(0o600),
        )
        .map_err(|e| format!("failed to protect folder trust: {e}"))?;
    }
    #[cfg(windows)]
    crate::fsperm::harden_file(transaction.staging_path());
    std::fs::write(transaction.staging_path(), bytes)
        .map_err(|e| format!("failed to write folder trust: {e}"))?;
    transaction.commit()?;
    crate::fsperm::harden_file(&path);
    Ok(())
}

fn update(change: impl FnOnce(&mut TrustFile) -> Result<(), AppError>) -> Result<(), AppError> {
    let _lock = lock_trust_writes().map_err(unavailable)?;
    let mut file = read_trust_file().map_err(unavailable)?;
    let before = file.clone();
    change(&mut file)?;
    if file == before {
        return Ok(());
    }
    file.version = TRUST_VERSION;
    write_trust_file(&file).map_err(unavailable)
}

pub fn project_trust(project_id: &str) -> Result<TrustState, AppError> {
    #[cfg(test)]
    if let Some(forced) = testing::forced(project_id) {
        return Ok(forced);
    }
    static REPORTED: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
    let subject = subject(project_id)?;
    let file = read_trust_file().unwrap_or_else(|error| {
        if !REPORTED.swap(true, std::sync::atomic::Ordering::Relaxed) {
            let _ = crate::project::append_app_log(format!(
                "Folder trust could not be read, so opened folders stay limited: {error}"
            ));
        }
        TrustFile::default()
    });
    Ok(evaluate(&file, project_id, &subject, &current_binding))
}

pub fn is_trusted(project_id: &str) -> bool {
    project_trust(project_id).is_ok_and(TrustState::is_trusted)
}

pub fn require_trusted(project_id: &str, capability: Capability) -> Result<(), AppError> {
    if project_trust(project_id)?.is_trusted() {
        Ok(())
    } else {
        Err(AppError::new(capability.error_code()))
    }
}

fn git_decision(
    state: TrustState,
    toplevel: Option<&Path>,
    toplevel_trusted: bool,
) -> Result<(), AppError> {
    if !state.is_trusted() {
        return Err(AppError::new(Capability::Git.error_code()));
    }
    match toplevel {
        Some(toplevel) if !toplevel_trusted => {
            Err(AppError::new("trust.repository").param("name", folder_name(toplevel)))
        }
        _ => Ok(()),
    }
}

pub fn require_git(project_id: &str, root: &Path) -> Result<(), AppError> {
    let state = project_trust(project_id)?;
    let toplevel = match state {
        TrustState::Trusted(TrustSource::Folder | TrustSource::ParentFolder)
            if !root.join(".git").exists() =>
        {
            crate::git::enclosing_repository(root)
        }
        _ => None,
    };
    let toplevel_trusted = toplevel.as_deref().is_some_and(|toplevel| {
        repository_trusted(
            &read_trust_file().unwrap_or_default(),
            toplevel,
            &current_binding,
        )
    });
    git_decision(state, toplevel.as_deref(), toplevel_trusted)
}

pub fn git_restriction(
    project_id: &str,
    root: &Path,
) -> Result<Option<Vec<(String, OsString)>>, AppError> {
    match require_git(project_id, root) {
        Ok(()) => Ok(None),
        Err(error)
            if error.code == Capability::Git.error_code() || error.code == "trust.repository" =>
        {
            Ok(Some(restricted_git_env(root, &|name| {
                std::env::var_os(name)
            })))
        }
        Err(error) => Err(error),
    }
}

pub fn restrict_compile_meta(
    project_id: &str,
    mut meta: ProjectMeta,
) -> Result<ProjectMeta, String> {
    if project_trust(project_id)?.is_trusted() {
        return Ok(meta);
    }
    meta.engine = crate::project::engine_for_untrusted_project(&meta.main_doc)?;
    meta.tex_flavor = None;
    meta.allow_shell_escape = false;
    Ok(meta)
}

pub fn mcp_exposure(project_id: &str) -> McpExposure {
    match project_trust(project_id) {
        Ok(TrustState::Trusted(TrustSource::Library)) => McpExposure::Full,
        Ok(TrustState::Trusted(_)) => McpExposure::ReadOnly,
        _ => McpExposure::Closed,
    }
}

pub fn write_needs_approval(relative_path: &str) -> bool {
    let normalized = relative_path.replace('\\', "/");
    let segments: Vec<&str> = normalized
        .split('/')
        .filter(|segment| !segment.is_empty() && *segment != ".")
        .collect();
    let Some(name) = segments.last() else {
        return true;
    };
    if segments.iter().any(|segment| segment.starts_with('.')) {
        return true;
    }
    let name = name.to_ascii_lowercase();
    if EXECUTABLE_CONFIG_NAMES.contains(&name.as_str()) {
        return true;
    }
    match name.rsplit_once('.') {
        Some((stem, extension)) if !stem.is_empty() => !DOCUMENT_EXTENSIONS.contains(&extension),
        _ => true,
    }
}

pub fn ai_tool_gate(tool: &str, arguments: &serde_json::Value) -> AiToolGate {
    let argument = |key: &str| {
        arguments
            .get(key)
            .and_then(serde_json::Value::as_str)
            .unwrap_or_default()
            .to_string()
    };
    match tool {
        "run_command" => AiToolGate::Forbid(RUN_COMMAND_REFUSAL),
        "write_file" | "replace_in_file" | "create_file" | "delete_file" => {
            let path = argument("path");
            if write_needs_approval(&path) {
                AiToolGate::Confirm(AiConfirm::Write(path))
            } else {
                AiToolGate::Allow
            }
        }
        "rename_file" => {
            let from = argument("from");
            let to = argument("to");
            if write_needs_approval(&to) {
                AiToolGate::Confirm(AiConfirm::Write(to))
            } else if write_needs_approval(&from) {
                AiToolGate::Confirm(AiConfirm::Write(from))
            } else {
                AiToolGate::Allow
            }
        }
        name if NETWORK_TOOLS.contains(&name) => {
            AiToolGate::Confirm(AiConfirm::Network(name.to_string()))
        }
        _ => AiToolGate::Allow,
    }
}

fn read_bounded(path: &Path) -> Option<String> {
    use std::io::Read as _;
    let mut reader = std::fs::File::open(path).ok()?.take(MAX_GIT_CONFIG_BYTES);
    let mut text = String::new();
    reader.read_to_string(&mut text).ok()?;
    Some(text)
}

fn git_dir_of(worktree: &Path) -> Option<PathBuf> {
    let marker = worktree.join(".git");
    if std::fs::metadata(&marker).ok()?.is_dir() {
        return Some(marker);
    }
    let text = read_bounded(&marker)?;
    let target = text.lines().next()?.strip_prefix("gitdir:")?.trim();
    Some(worktree.join(target))
}

fn repository_git_dir(root: &Path) -> Option<PathBuf> {
    if root.join(".git").exists() {
        git_dir_of(root)
    } else {
        git_dir_of(&crate::git::enclosing_repository(root)?)
    }
}

fn nested_git_dirs(root: &Path, found: &mut Vec<PathBuf>) {
    let mut pending = std::collections::VecDeque::from([(root.to_path_buf(), 0)]);
    let mut visited = 0;
    while let Some((directory, depth)) = pending.pop_front() {
        if visited >= MAX_NESTED_SCAN_DIRS {
            break;
        }
        visited += 1;
        let Ok(entries) = std::fs::read_dir(&directory) else {
            continue;
        };
        for entry in entries.flatten() {
            if entry.file_name() == ".git" {
                if depth > 0 {
                    found.extend(git_dir_of(&directory));
                }
            } else if depth < MAX_NESTED_SCAN_DEPTH
                && entry.file_type().is_ok_and(|kind| kind.is_dir())
            {
                pending.push_back((entry.path(), depth + 1));
            }
        }
    }
}

fn module_git_dirs(modules: PathBuf, budget: &mut usize, found: &mut Vec<PathBuf>) {
    let mut pending = std::collections::VecDeque::from([modules]);
    while let Some(directory) = pending.pop_front() {
        if *budget == 0 {
            break;
        }
        *budget -= 1;
        if directory.join("config").is_file() {
            pending.push_back(directory.join("modules"));
            found.push(directory);
            continue;
        }
        let Ok(entries) = std::fs::read_dir(&directory) else {
            continue;
        };
        pending.extend(
            entries
                .flatten()
                .filter(|entry| entry.file_type().is_ok_and(|kind| kind.is_dir()))
                .map(|entry| entry.path()),
        );
    }
}

fn common_git_dir(git_dir: &Path) -> Option<PathBuf> {
    read_bounded(&git_dir.join("commondir")).map(|common| git_dir.join(common.trim()))
}

fn repository_git_dirs(root: &Path) -> Vec<PathBuf> {
    let mut git_dirs: Vec<PathBuf> = repository_git_dir(root).into_iter().collect();
    nested_git_dirs(root, &mut git_dirs);
    let mut budget = MAX_GIT_MODULE_DIRS;
    let mut modules = Vec::new();
    for git_dir in &git_dirs {
        module_git_dirs(git_dir.join("modules"), &mut budget, &mut modules);
        if let Some(common) = common_git_dir(git_dir) {
            module_git_dirs(common.join("modules"), &mut budget, &mut modules);
        }
    }
    git_dirs.extend(modules);
    git_dirs
}

fn split_header(rest: &str) -> Option<(&str, &str)> {
    let mut quoted = false;
    let mut escaped = false;
    for (index, character) in rest.char_indices() {
        match character {
            _ if escaped => escaped = false,
            '\\' if quoted => escaped = true,
            '"' => quoted = !quoted,
            ']' if !quoted => return Some((&rest[..index], &rest[index + 1..])),
            _ => {}
        }
    }
    None
}

fn unquote(value: &str) -> Option<String> {
    let inner = value.strip_prefix('"')?.strip_suffix('"')?;
    let mut unescaped = String::with_capacity(inner.len());
    let mut characters = inner.chars();
    while let Some(character) = characters.next() {
        if character == '\\' {
            unescaped.push(characters.next()?);
        } else {
            unescaped.push(character);
        }
    }
    Some(unescaped)
}

fn filter_driver_name(header: &str) -> Option<String> {
    let (section, subsection) = match header.split_once(char::is_whitespace) {
        Some((section, rest)) => (section, unquote(rest.trim())?),
        None => {
            let (section, name) = header.split_once('.')?;
            (section, name.to_ascii_lowercase())
        }
    };
    (section.eq_ignore_ascii_case("filter") && !subsection.is_empty()).then_some(subsection)
}

fn is_include_section(section: &str) -> bool {
    let name = section
        .split(|c: char| c.is_whitespace() || c == '.')
        .next()
        .unwrap_or_default();
    name.eq_ignore_ascii_case("include") || name.eq_ignore_ascii_case("includeif")
}

fn scan_git_config(
    text: &str,
    base: &Path,
    drivers: &mut BTreeSet<String>,
    includes: &mut Vec<PathBuf>,
) {
    let mut section = String::new();
    for raw in text.lines() {
        let mut line = raw.trim();
        if let Some(rest) = line.strip_prefix('[') {
            let Some((header, tail)) = split_header(rest) else {
                continue;
            };
            section = header.trim().to_string();
            if let Some(driver) = filter_driver_name(&section) {
                drivers.insert(driver);
            }
            line = tail.trim();
        }
        if !is_include_section(&section) {
            continue;
        }
        let Some((key, value)) = line.split_once('=') else {
            continue;
        };
        if !key.trim().eq_ignore_ascii_case("path") {
            continue;
        }
        let value = value
            .split(['#', ';'])
            .next()
            .unwrap_or_default()
            .trim()
            .trim_matches('"');
        if value.is_empty() {
            continue;
        }
        let target = match value.strip_prefix("~/") {
            Some(rest) => match crate::paths::home_dir() {
                Ok(home) => home.join(rest),
                Err(_) => continue,
            },
            None => base.join(value),
        };
        includes.push(target);
    }
}

fn repository_filter_drivers(root: &Path) -> BTreeSet<String> {
    let mut drivers = BTreeSet::new();
    let mut pending = Vec::new();
    for git_dir in repository_git_dirs(root).iter().rev() {
        pending.extend(common_git_dir(git_dir).map(|common| common.join("config")));
        pending.push(git_dir.join("config.worktree"));
        pending.push(git_dir.join("config"));
    }
    let mut visited = BTreeSet::new();
    while let Some(path) = pending.pop() {
        if visited.len() >= MAX_GIT_CONFIG_FILES || !visited.insert(path.clone()) {
            continue;
        }
        let Some(text) = read_bounded(&path) else {
            continue;
        };
        let base = path.parent().map(Path::to_path_buf).unwrap_or_default();
        scan_git_config(&text, &base, &mut drivers, &mut pending);
    }
    drivers
}

pub fn restricted_git_env(
    root: &Path,
    inherited: &dyn Fn(&str) -> Option<OsString>,
) -> Vec<(String, OsString)> {
    let start = inherited("GIT_CONFIG_COUNT")
        .and_then(|count| {
            count
                .to_str()
                .and_then(|count| count.trim().parse::<usize>().ok())
        })
        .unwrap_or(0);
    let mut settings: Vec<(String, OsString)> = vec![
        ("core.fsmonitor".into(), "false".into()),
        ("core.hooksPath".into(), crate::git::null_device().into()),
        ("log.showSignature".into(), "false".into()),
        ("diff.ignoreSubmodules".into(), "all".into()),
    ];
    for driver in repository_filter_drivers(root) {
        for key in ["clean", "smudge", "process"] {
            settings.push((format!("filter.{driver}.{key}"), OsString::new()));
        }
    }
    let mut env = Vec::with_capacity(settings.len() * 2 + 1);
    for (offset, (key, value)) in settings.iter().enumerate() {
        env.push((
            format!("GIT_CONFIG_KEY_{}", start + offset),
            OsString::from(key),
        ));
        env.push((
            format!("GIT_CONFIG_VALUE_{}", start + offset),
            value.clone(),
        ));
    }
    env.push((
        "GIT_CONFIG_COUNT".into(),
        (start + settings.len()).to_string().into(),
    ));
    env
}

#[cfg(test)]
pub fn mark_library_restricted(project_id: &str) -> Result<(), AppError> {
    crate::paths::validate_project_id(project_id).map_err(unavailable)?;
    update(|file| {
        file.restricted_library.insert(project_id.to_string());
        Ok(())
    })
}

pub fn revoke_project(project_id: &str) -> Result<(), AppError> {
    update(|file| {
        file.folders
            .retain(|grant| grant.id.as_deref() != Some(project_id));
        Ok(())
    })
}

#[cfg(test)]
pub fn forget_project(project_id: &str) -> Result<(), AppError> {
    update(|file| {
        file.folders
            .retain(|grant| grant.id.as_deref() != Some(project_id));
        file.restricted_library.remove(project_id);
        Ok(())
    })
}

fn grant_target(project_id: &str, scope: TrustScope) -> Result<GrantTarget, AppError> {
    let root = match (subject(project_id)?, scope) {
        (Subject::Library, TrustScope::Folder) => {
            let name = crate::project::read_meta(project_id)
                .map(|meta| meta.name)
                .unwrap_or_else(|_| project_id.to_string());
            return Ok(GrantTarget::Library { name });
        }
        (Subject::Library, _) => return Err(unavailable("library projects have no parent grant")),
        (Subject::Linked { root }, _) => root,
    };
    let path = match scope {
        TrustScope::Folder => {
            let binding = current_binding(&root).ok_or_else(|| unavailable("folder identity"))?;
            return Ok(GrantTarget::Project { root, binding });
        }
        TrustScope::Parent => root
            .parent()
            .map(Path::to_path_buf)
            .ok_or_else(|| unavailable("no parent folder"))?,
        TrustScope::Repository => {
            if !project_trust(project_id)?.is_trusted() {
                return Err(AppError::new(Capability::Git.error_code()));
            }
            crate::git::enclosing_repository(&root)
                .ok_or_else(|| unavailable("no enclosing repository"))?
        }
    };
    if is_broad_folder(&path) {
        return Err(AppError::new("trust.broad_folder").param("name", folder_name(&path)));
    }
    if path.to_str().is_none() {
        return Err(unavailable("folder path is not valid Unicode"));
    }
    let binding = current_binding(&path).ok_or_else(|| unavailable("folder identity"))?;
    Ok(GrantTarget::Folder {
        path,
        binding,
        scope,
    })
}

fn apply_grant(project_id: &str, target: &GrantTarget) -> Result<(), AppError> {
    match target {
        GrantTarget::Library { .. } => update(|file| {
            file.restricted_library.remove(project_id);
            Ok(())
        }),
        GrantTarget::Project { root, binding } => {
            if current_binding(root).as_ref() != Some(binding) {
                return Err(unavailable("the folder changed while trust was confirmed"));
            }
            update(|file| {
                file.folders
                    .retain(|grant| grant.id.as_deref() != Some(project_id));
                file.folders.push(FolderGrant {
                    id: Some(project_id.to_string()),
                    scope: TrustScope::Folder,
                    canonical_path: root.to_string_lossy().into_owned(),
                    identity: binding.clone(),
                    granted_at: now_ms(),
                });
                Ok(())
            })
        }
        GrantTarget::Folder {
            path,
            binding,
            scope,
        } => {
            if current_binding(path).as_ref() != Some(binding) {
                return Err(unavailable("the folder changed while trust was confirmed"));
            }
            let text = path.to_string_lossy().into_owned();
            update(|file| {
                file.folders.retain(|grant| {
                    !(grant.id.is_none() && grant.scope == *scope && grant.canonical_path == text)
                });
                file.folders.push(FolderGrant {
                    id: None,
                    scope: *scope,
                    canonical_path: text.clone(),
                    identity: binding.clone(),
                    granted_at: now_ms(),
                });
                Ok(())
            })
        }
    }
}

fn describe(project_id: &str) -> Result<ProjectTrust, AppError> {
    let state = project_trust(project_id)?;
    let (parent, repository) = match subject(project_id)? {
        Subject::Library => (None, None),
        Subject::Linked { root } => {
            let parent = root
                .parent()
                .filter(|parent| !is_broad_folder(parent))
                .map(folder_name);
            let repository = (!root.join(".git").exists())
                .then(|| crate::git::enclosing_repository(&root))
                .flatten()
                .map(|toplevel| RepositoryTrust {
                    name: folder_name(&toplevel),
                    trusted: repository_trusted(
                        &read_trust_file().unwrap_or_default(),
                        &toplevel,
                        &current_binding,
                    ),
                });
            (parent, repository)
        }
    };
    Ok(ProjectTrust {
        trusted: state.is_trusted(),
        source: match state {
            TrustState::Trusted(source) => Some(source),
            TrustState::Restricted => None,
        },
        parent,
        repository,
    })
}

async fn native_confirm<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    title: &str,
    message: String,
    confirm: &str,
) -> Result<bool, String> {
    use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
    let (sender, receiver) = tokio::sync::oneshot::channel();
    app.dialog()
        .message(message)
        .title(crate::i18n::t(title))
        .kind(MessageDialogKind::Warning)
        .buttons(MessageDialogButtons::OkCancelCustom(
            crate::i18n::t(confirm),
            crate::i18n::t("dialog.cancel"),
        ))
        .show(move |approved| {
            let _ = sender.send(approved);
        });
    receiver
        .await
        .map_err(|_| crate::i18n::t("errors.approvalDialogClosed"))
}

fn grant_message(target: &GrantTarget) -> String {
    let (key, name) = match target {
        GrantTarget::Library { name } => ("dialog.trustFolder.message", name.clone()),
        GrantTarget::Project { root, .. } => ("dialog.trustFolder.message", folder_name(root)),
        GrantTarget::Folder {
            path,
            scope: TrustScope::Repository,
            ..
        } => ("dialog.trustFolder.messageRepository", folder_name(path)),
        GrantTarget::Folder { path, .. } => ("dialog.trustFolder.messageParent", folder_name(path)),
    };
    crate::i18n::t_with(key, &[("name", &name)])
}

pub async fn confirm_ai_tool<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    request: AiConfirm,
) -> Result<bool, String> {
    let (title, message, confirm) = match &request {
        AiConfirm::Write(path) => (
            "dialog.restrictedWrite.title",
            crate::i18n::t_with("dialog.restrictedWrite.message", &[("path", path)]),
            "dialog.restrictedWrite.confirm",
        ),
        AiConfirm::Network(tool) => (
            "dialog.restrictedNetwork.title",
            crate::i18n::t_with("dialog.restrictedNetwork.message", &[("tool", tool)]),
            "dialog.restrictedNetwork.confirm",
        ),
    };
    native_confirm(&app, title, message, confirm).await
}

#[tauri::command]
pub async fn project_trust_state(project_id: String) -> Result<ProjectTrust, String> {
    tauri::async_runtime::spawn_blocking(move || describe(&project_id).map_err(String::from))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn trust_folder<R: tauri::Runtime>(
    webview: tauri::Webview<R>,
    app: tauri::AppHandle<R>,
    project_id: String,
    scope: TrustScope,
) -> Result<ProjectTrust, String> {
    use tauri::Emitter as _;
    if webview.label() != "main" || webview.window().label() != "main" {
        return Err(unavailable("folder trust is only granted from the main window").into());
    }
    let lookup_id = project_id.clone();
    let target = tauri::async_runtime::spawn_blocking(move || grant_target(&lookup_id, scope))
        .await
        .map_err(|error| error.to_string())??;
    if !native_confirm(
        &app,
        "dialog.trustFolder.title",
        grant_message(&target),
        "dialog.trustFolder.confirm",
    )
    .await?
    {
        return Err(AppError::new("trust.declined").into());
    }
    let grant_id = project_id.clone();
    let trust = tauri::async_runtime::spawn_blocking(move || {
        apply_grant(&grant_id, &target)?;
        describe(&grant_id)
    })
    .await
    .map_err(|error| error.to_string())??;
    let _ = app.emit("project-trust-changed", &project_id);
    Ok(trust)
}

#[tauri::command]
pub async fn revoke_folder_trust<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    project_id: String,
) -> Result<ProjectTrust, String> {
    use tauri::Emitter as _;
    let revoke_id = project_id.clone();
    let trust = tauri::async_runtime::spawn_blocking(move || {
        crate::paths::validate_project_id(&revoke_id).map_err(unavailable)?;
        revoke_project(&revoke_id)?;
        describe(&revoke_id)
    })
    .await
    .map_err(|error| error.to_string())??;
    let _ = app.emit("project-trust-changed", &project_id);
    Ok(trust)
}

#[cfg(test)]
pub(crate) mod testing {
    use super::TrustState;
    use std::collections::HashMap;
    use std::sync::{Mutex, OnceLock};

    fn forced_states() -> &'static Mutex<HashMap<String, TrustState>> {
        static STATES: OnceLock<Mutex<HashMap<String, TrustState>>> = OnceLock::new();
        STATES.get_or_init(|| Mutex::new(HashMap::new()))
    }

    pub(crate) struct ForcedTrust(String);

    impl Drop for ForcedTrust {
        fn drop(&mut self) {
            forced_states()
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner())
                .remove(&self.0);
        }
    }

    pub(crate) fn restrict(project_id: &str) -> ForcedTrust {
        forced_states()
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .insert(project_id.to_string(), TrustState::Restricted);
        ForcedTrust(project_id.to_string())
    }

    pub(super) fn forced(project_id: &str) -> Option<TrustState> {
        forced_states()
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .get(project_id)
            .copied()
    }

    pub(crate) struct LinkedFixture {
        pub(crate) folders: tempfile::TempDir,
        _data: tempfile::TempDir,
        _env: std::sync::MutexGuard<'static, ()>,
    }

    impl LinkedFixture {
        pub(crate) fn new() -> Self {
            let env = crate::paths::data_dir_env_lock();
            let data = tempfile::tempdir().unwrap();
            std::env::set_var("OLEAFLY_DATA_DIR", data.path());
            Self {
                folders: tempfile::tempdir().unwrap(),
                _data: data,
                _env: env,
            }
        }

        pub(crate) fn link(&self, relative: &str) -> (String, std::path::PathBuf) {
            let folder = self.folders.path().join(relative);
            std::fs::create_dir_all(&folder).unwrap();
            let record = crate::linked_registry::register_folder_for_test(&folder);
            (record.id, folder.canonicalize().unwrap())
        }

        pub(crate) fn trust(&self, project_id: &str, scope: super::TrustScope) {
            super::apply_grant(project_id, &super::grant_target(project_id, scope).unwrap())
                .unwrap();
        }
    }

    impl Drop for LinkedFixture {
        fn drop(&mut self) {
            std::env::remove_var("OLEAFLY_DATA_DIR");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::known_folders::broad_folder_among;

    fn grant(id: Option<&str>, scope: TrustScope, path: &str, identity: &str) -> FolderGrant {
        FolderGrant {
            id: id.map(str::to_string),
            scope,
            canonical_path: path.into(),
            identity: identity.into(),
            granted_at: 0,
        }
    }

    fn bindings(pairs: &[(&str, &str)]) -> impl Fn(&Path) -> Option<String> {
        let pairs: Vec<(PathBuf, String)> = pairs
            .iter()
            .map(|(path, binding)| (PathBuf::from(path), binding.to_string()))
            .collect();
        move |path| {
            pairs
                .iter()
                .find(|(candidate, _)| candidate == path)
                .map(|(_, binding)| binding.clone())
        }
    }

    fn identity(weak: bool) -> crate::fs_identity::FsIdentity {
        crate::fs_identity::FsIdentity {
            volume: Some("uuid:volume".into()),
            file: "2a".into(),
            birth_ns: Some(7),
            weak,
        }
    }

    #[test]
    fn library_projects_are_trusted_unless_copied_from_a_restricted_folder() {
        let mut file = TrustFile::default();
        let none = bindings(&[]);
        assert_eq!(
            evaluate(&file, "thesis", &Subject::Library, &none),
            TrustState::Trusted(TrustSource::Library)
        );
        file.restricted_library.insert("thesis-copy".into());
        assert_eq!(
            evaluate(&file, "thesis-copy", &Subject::Library, &none),
            TrustState::Restricted
        );
    }

    #[test]
    fn linked_trust_follows_folder_identity_and_id() {
        let root = Subject::Linked {
            root: PathBuf::from("/work/thesis"),
        };
        let file = TrustFile {
            folders: vec![grant(
                Some("linked-a"),
                TrustScope::Folder,
                "/work/thesis",
                "id-1",
            )],
            ..TrustFile::default()
        };
        assert_eq!(
            evaluate(
                &file,
                "linked-a",
                &root,
                &bindings(&[("/work/thesis", "id-1")])
            ),
            TrustState::Trusted(TrustSource::Folder)
        );
        assert_eq!(
            evaluate(
                &file,
                "linked-a",
                &root,
                &bindings(&[("/work/thesis", "id-2")])
            ),
            TrustState::Restricted
        );
        assert_eq!(
            evaluate(
                &file,
                "linked-b",
                &root,
                &bindings(&[("/work/thesis", "id-1")])
            ),
            TrustState::Restricted
        );
        assert_eq!(
            evaluate(&file, "linked-a", &root, &bindings(&[])),
            TrustState::Restricted
        );
    }

    #[test]
    fn parent_trust_covers_descendants_while_the_parent_keeps_its_identity() {
        let file = TrustFile {
            folders: vec![grant(None, TrustScope::Parent, "/work/papers", "parent-1")],
            ..TrustFile::default()
        };
        let child = Subject::Linked {
            root: PathBuf::from("/work/papers/thesis"),
        };
        let sibling = Subject::Linked {
            root: PathBuf::from("/work/papers-old/thesis"),
        };
        let bind = bindings(&[
            ("/work/papers", "parent-1"),
            ("/work/papers/thesis", "child"),
            ("/work/papers-old/thesis", "other"),
        ]);
        assert_eq!(
            evaluate(&file, "linked-c", &child, &bind),
            TrustState::Trusted(TrustSource::ParentFolder)
        );
        assert_eq!(
            evaluate(&file, "linked-d", &sibling, &bind),
            TrustState::Restricted
        );
        let replaced = bindings(&[
            ("/work/papers", "parent-2"),
            ("/work/papers/thesis", "child"),
        ]);
        assert_eq!(
            evaluate(&file, "linked-c", &child, &replaced),
            TrustState::Restricted
        );
    }

    #[test]
    fn a_repository_grant_only_lets_git_run_and_never_trusts_the_folders_inside_it() {
        let bind = bindings(&[("/work/repo", "repo-1"), ("/work/repo/paper", "paper-1")]);
        let paper = Subject::Linked {
            root: PathBuf::from("/work/repo/paper"),
        };
        let repository = TrustFile {
            folders: vec![grant(None, TrustScope::Repository, "/work/repo", "repo-1")],
            ..TrustFile::default()
        };
        assert_eq!(
            evaluate(&repository, "linked-paper", &paper, &bind),
            TrustState::Restricted
        );
        assert!(repository_trusted(
            &repository,
            Path::new("/work/repo"),
            &bind
        ));
        assert!(!repository_trusted(
            &repository,
            Path::new("/work/repo/paper"),
            &bind
        ));
        let legacy: TrustFile = serde_json::from_str(
            r#"{"version":1,"folders":[{"id":null,"canonical_path":"/work/repo","identity":"repo-1","granted_at":0}]}"#,
        )
        .unwrap();
        assert_eq!(
            evaluate(&legacy, "linked-paper", &paper, &bind),
            TrustState::Restricted
        );
        assert!(!repository_trusted(&legacy, Path::new("/work/repo"), &bind));
        let parent = TrustFile {
            folders: vec![grant(None, TrustScope::Parent, "/work/repo", "repo-1")],
            ..TrustFile::default()
        };
        assert_eq!(
            evaluate(&parent, "linked-paper", &paper, &bind),
            TrustState::Trusted(TrustSource::ParentFolder)
        );
        assert!(repository_trusted(&parent, Path::new("/work/repo"), &bind));
    }

    #[test]
    fn strong_bindings_survive_a_move_and_weak_ones_stay_on_their_path_and_mount() {
        let strong = identity(false);
        assert_eq!(
            binding_of(Path::new("/work/a"), &strong, b""),
            binding_of(Path::new("/work/b"), &strong, b"")
        );
        let other = crate::fs_identity::FsIdentity {
            birth_ns: Some(8),
            ..identity(false)
        };
        assert_ne!(
            binding_of(Path::new("/work/a"), &strong, b""),
            binding_of(Path::new("/work/a"), &other, b"")
        );
        let weak = identity(true);
        assert_ne!(
            binding_of(Path::new("/work/a"), &weak, b"mount-1"),
            binding_of(Path::new("/work/b"), &weak, b"mount-1")
        );
        assert_ne!(
            binding_of(Path::new("/work/a"), &weak, b"mount-1"),
            binding_of(Path::new("/work/a"), &weak, b"mount-2")
        );
    }

    #[test]
    fn broad_folders_can_never_be_trusted_as_a_whole() {
        let home = PathBuf::from("/Users/ada");
        let data = PathBuf::from("/Users/ada/.oleafly");
        let temp = PathBuf::from("/private/var/folders/xy/T");
        let protected = [home.as_path(), data.as_path(), temp.as_path()];
        for broad in [
            "/",
            "/Users",
            "/Users/ada",
            "/Users/ada/Desktop",
            "/Users/ada/documents",
            "/Users/ada/Downloads",
            "/Users/ada/OneDrive - Contoso",
            "/Users/ada/Library/Mobile Documents/com~apple~CloudDocs",
            "/Users/ada/Library/Mobile Documents",
            "/Users/ada/Library/CloudStorage",
            "/Users/ada/Library/CloudStorage/Dropbox",
            "/Users/ada/Library/CloudStorage/GoogleDrive-ada@example.com",
            "/Users/ada/Library/CloudStorage/OneDrive-Personal",
            "/Users/ada/.oleafly",
            "/private/tmp",
            "/private/var/tmp",
            "/private",
            "/var/tmp",
            "/Users/Shared",
            "/dev/shm",
            "/private/var/folders/xy",
            "/Volumes/USB",
            "/media/ada/USB",
            "/run/media/ada/USB",
            "/mnt/data",
            "/usr",
        ] {
            assert!(
                broad_folder_among(Path::new(broad), Some(&home), &protected),
                "{broad}"
            );
        }
        for narrow in [
            "/Users/ada/Desktop/thesis",
            "/Users/ada/papers",
            "/Users/ada/work/papers",
            "/Volumes/USB/papers",
            "/mnt/data/papers",
            "/Users/ada/Library/CloudStorage/Dropbox/papers",
            "/private/tmp/papers",
            "/Users/Shared/papers",
        ] {
            assert!(
                !broad_folder_among(Path::new(narrow), Some(&home), &protected),
                "{narrow}"
            );
        }
    }

    #[test]
    fn git_needs_trust_for_the_folder_and_its_enclosing_repository() {
        let code = |result: Result<(), AppError>| result.err().map(|error| error.code);
        let folder = TrustState::Trusted(TrustSource::Folder);
        let repo = Some(Path::new("/work/repo"));
        assert_eq!(
            code(git_decision(TrustState::Restricted, None, false)),
            Some("trust.git")
        );
        assert_eq!(code(git_decision(folder, None, false)), None);
        assert_eq!(
            code(git_decision(folder, repo, false)),
            Some("trust.repository")
        );
        assert_eq!(code(git_decision(folder, repo, true)), None);
        assert_eq!(
            code(git_decision(
                TrustState::Trusted(TrustSource::Library),
                None,
                false
            )),
            None
        );
    }

    #[test]
    fn restricted_writes_need_approval_outside_documents_and_assets() {
        for free in [
            "main.tex",
            "chapters/intro.tex",
            "refs.bib",
            "figures/plot.png",
            "paper.typ",
            "notes/README.md",
            "data/results.csv",
            "styles/thesis.cls",
        ] {
            assert!(!write_needs_approval(free), "{free}");
        }
        for guarded in [
            ".envrc",
            ".husky/pre-commit",
            ".vscode/tasks.json",
            ".claude/settings.json",
            ".github/workflows/ci.yml",
            "Makefile",
            "latexmkrc",
            ".latexmkrc",
            "scripts/build.sh",
            "analysis/run.py",
            "package.json",
            "pyproject.toml",
            "tools\\hook.ps1",
            "chapters/../.envrc",
            "main.tex:stream",
            "",
            "LICENSE",
        ] {
            assert!(write_needs_approval(guarded), "{guarded}");
        }
    }

    #[test]
    fn restricted_ai_tools_are_refused_confirmed_or_allowed() {
        use serde_json::json;
        assert_eq!(
            ai_tool_gate("run_command", &json!({"command": "ls"})),
            AiToolGate::Forbid(RUN_COMMAND_REFUSAL)
        );
        assert_eq!(
            ai_tool_gate("write_file", &json!({"path": "main.tex"})),
            AiToolGate::Allow
        );
        assert_eq!(
            ai_tool_gate("replace_in_file", &json!({"path": ".envrc"})),
            AiToolGate::Confirm(AiConfirm::Write(".envrc".into()))
        );
        assert_eq!(
            ai_tool_gate(
                "rename_file",
                &json!({"from": "notes.txt", "to": "Makefile"})
            ),
            AiToolGate::Confirm(AiConfirm::Write("Makefile".into()))
        );
        assert_eq!(
            ai_tool_gate("literature_search", &json!({"query": "x"})),
            AiToolGate::Confirm(AiConfirm::Network("literature_search".into()))
        );
        assert_eq!(
            ai_tool_gate("computer_use", &json!({})),
            AiToolGate::Confirm(AiConfirm::Network("computer_use".into()))
        );
        assert_eq!(
            ai_tool_gate("read_file", &json!({"path": ".envrc"})),
            AiToolGate::Allow
        );
    }

    #[test]
    fn trust_file_is_private_and_never_overwritten_when_unreadable() {
        let _env_guard = crate::paths::data_dir_env_lock();
        let data = tempfile::tempdir().unwrap();
        std::env::set_var("OLEAFLY_DATA_DIR", data.path());
        mark_library_restricted("copied").unwrap();
        let path = data.path().join("device-trust").join(TRUST_FILE);
        assert!(read_trust_file()
            .unwrap()
            .restricted_library
            .contains("copied"));
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt as _;
            assert_eq!(
                std::fs::metadata(&path).unwrap().permissions().mode() & 0o777,
                0o600
            );
        }
        std::fs::write(&path, b"{not json").unwrap();
        assert!(read_trust_file().is_err());
        assert!(forget_project("copied").is_err());
        assert_eq!(std::fs::read(&path).unwrap(), b"{not json");
        std::env::remove_var("OLEAFLY_DATA_DIR");
    }

    #[cfg(unix)]
    #[test]
    fn a_symlinked_trust_file_is_never_read_or_replaced() {
        let _env_guard = crate::paths::data_dir_env_lock();
        let data = tempfile::tempdir().unwrap();
        std::env::set_var("OLEAFLY_DATA_DIR", data.path());
        let elsewhere = data.path().join("elsewhere.json");
        std::fs::write(
            &elsewhere,
            br#"{"version":1,"folders":[],"restricted_library":[]}"#,
        )
        .unwrap();
        std::fs::create_dir_all(data.path().join("device-trust")).unwrap();
        std::os::unix::fs::symlink(
            &elsewhere,
            data.path().join("device-trust").join(TRUST_FILE),
        )
        .unwrap();
        assert!(read_trust_file().is_err());
        assert!(mark_library_restricted("copied").is_err());
        assert!(!std::fs::read_to_string(&elsewhere)
            .unwrap()
            .contains("copied"));
        std::env::remove_var("OLEAFLY_DATA_DIR");
    }

    #[test]
    fn restricted_git_env_appends_after_inherited_settings() {
        let temp = tempfile::tempdir().unwrap();
        let env = restricted_git_env(temp.path(), &|name| {
            (name == "GIT_CONFIG_COUNT").then(|| OsString::from("2"))
        });
        let value = |key: &str| {
            env.iter()
                .find(|(candidate, _)| candidate == key)
                .map(|(_, value)| value.to_string_lossy().into_owned())
        };
        assert_eq!(value("GIT_CONFIG_KEY_2").as_deref(), Some("core.fsmonitor"));
        assert_eq!(value("GIT_CONFIG_VALUE_2").as_deref(), Some("false"));
        assert_eq!(value("GIT_CONFIG_KEY_3").as_deref(), Some("core.hooksPath"));
        assert_eq!(
            value("GIT_CONFIG_VALUE_3").as_deref(),
            Some(crate::git::null_device())
        );
        assert_eq!(
            value("GIT_CONFIG_KEY_4").as_deref(),
            Some("log.showSignature")
        );
        assert_eq!(
            value("GIT_CONFIG_KEY_5").as_deref(),
            Some("diff.ignoreSubmodules")
        );
        assert_eq!(value("GIT_CONFIG_VALUE_5").as_deref(), Some("all"));
        assert_eq!(value("GIT_CONFIG_COUNT").as_deref(), Some("6"));
        assert!(value("GIT_CONFIG_KEY_0").is_none());
    }

    #[test]
    fn filter_drivers_are_found_through_includes_and_worktree_gitdirs() {
        let temp = tempfile::tempdir().unwrap();
        let main = temp.path().join("main");
        std::fs::create_dir_all(main.join(".git")).unwrap();
        std::fs::write(
            main.join(".git/config"),
            "[core]\n\tbare = false\n[Filter \"lfs\"]\n\tclean = x\n[filter.Legacy]\n\tsmudge = y\n[include]\n\tpath = ../shared.cfg\n",
        )
        .unwrap();
        std::fs::write(
            main.join("shared.cfg"),
            "[filter \"from \\\"include\\\"\"] process = z\n[includeIf \"gitdir:~/\"]\n\tpath = more.cfg\n",
        )
        .unwrap();
        std::fs::write(main.join("more.cfg"), "[filter \"deep\"]\n\tclean = w\n").unwrap();
        assert_eq!(
            repository_filter_drivers(&main),
            BTreeSet::from([
                "deep".to_string(),
                "from \"include\"".into(),
                "legacy".into(),
                "lfs".into(),
            ])
        );
        let worktree = temp.path().join("worktree");
        std::fs::create_dir_all(&worktree).unwrap();
        let admin = main.join(".git/worktrees/wt");
        std::fs::create_dir_all(&admin).unwrap();
        std::fs::write(admin.join("commondir"), "../..\n").unwrap();
        std::fs::write(
            worktree.join(".git"),
            format!("gitdir: {}\n", admin.display()),
        )
        .unwrap();
        assert!(repository_filter_drivers(&worktree).contains("lfs"));
    }

    #[test]
    fn filter_drivers_are_found_in_submodules_and_nested_repositories() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("paper");
        let write = |relative: &str, text: &str| {
            let path = root.join(relative);
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(path, text).unwrap();
        };
        write(".git/config", "[core]\n\tbare = false\n");
        write(".git/HEAD", "ref: refs/heads/main\n");
        write(
            ".git/modules/sub/config",
            "[filter \"absorbed\"]\n\tclean = x\n",
        );
        write(
            ".git/modules/sub/modules/inner/config",
            "[filter \"inner\"]\n\tclean = x\n",
        );
        write(
            ".git/modules/group/name/config",
            "[filter \"slashed\"]\n\tsmudge = x\n",
        );
        write(
            "vendor/tool/.git/config",
            "[filter \"vendored\"]\n\tprocess = x\n",
        );
        write("vendor/tool/.git/HEAD", "ref: refs/heads/main\n");
        write(
            "notes/.git",
            &format!("gitdir: {}\n", temp.path().join("elsewhere").display()),
        );
        write("../elsewhere/config", "[filter \"linked\"]\n\tclean = x\n");
        assert_eq!(
            repository_filter_drivers(&root),
            BTreeSet::from([
                "absorbed".to_string(),
                "inner".into(),
                "linked".into(),
                "slashed".into(),
                "vendored".into(),
            ])
        );
    }

    #[cfg(unix)]
    #[test]
    fn restricted_git_env_keeps_a_prompt_status_from_running_repository_programs() {
        let temp = tempfile::tempdir().unwrap();
        let repo = temp.path().join("paper");
        std::fs::create_dir(&repo).unwrap();
        let git = |args: &[&str], env: &[(String, OsString)]| {
            let mut command = std::process::Command::new("git");
            crate::git::clear_inherited_git_env(&mut command);
            command.current_dir(&repo).args(args).envs(
                env.iter()
                    .map(|(key, value)| (key.as_str(), value.as_os_str())),
            );
            command.output().unwrap()
        };
        for args in [
            vec!["init", "--quiet"],
            vec!["config", "user.email", "t@t"],
            vec!["config", "user.name", "t"],
        ] {
            assert!(git(&args, &[]).status.success());
        }
        std::fs::write(repo.join(".gitattributes"), "*.tex filter=hostile\n").unwrap();
        std::fs::write(repo.join("main.tex"), "a\n").unwrap();
        assert!(git(&["add", "-A"], &[]).status.success());
        assert!(git(&["commit", "--quiet", "-m", "base"], &[])
            .status
            .success());
        let monitor = temp.path().join("fsmonitor-ran");
        let filter = temp.path().join("filter-ran");
        std::fs::write(
            repo.join("hostile.cfg"),
            format!(
                "[filter \"hostile\"]\n\tclean = touch '{}'; cat\n",
                filter.display()
            ),
        )
        .unwrap();
        assert!(git(&["config", "include.path", "../hostile.cfg"], &[])
            .status
            .success());
        let hook = format!("touch '{}'; false", monitor.display());
        assert!(git(&["config", "core.fsmonitor", &hook], &[])
            .status
            .success());
        std::fs::write(repo.join("main.tex"), "b\n").unwrap();
        git(
            &["status", "--porcelain"],
            &restricted_git_env(&repo, &|_| None),
        );
        assert!(!monitor.exists());
        assert!(!filter.exists());
        std::fs::write(repo.join("main.tex"), "c\n").unwrap();
        git(&["status", "--porcelain"], &[]);
        assert!(
            monitor.exists(),
            "positive control: git runs the repository fsmonitor"
        );
        assert!(
            filter.exists(),
            "positive control: git runs the repository clean filter"
        );
    }

    #[cfg(unix)]
    fn hostile_submodule_fixture(temp: &Path) -> (PathBuf, PathBuf, PathBuf) {
        let git = |directory: &Path, args: &[&str]| {
            let mut command = std::process::Command::new("git");
            crate::git::clear_inherited_git_env(&mut command);
            let output = command
                .current_dir(directory)
                .args(["-c", "protocol.file.allow=always"])
                .args(["-c", "user.email=t@t", "-c", "user.name=t"])
                .args(args)
                .output()
                .unwrap();
            assert!(
                output.status.success(),
                "{}",
                String::from_utf8_lossy(&output.stderr)
            );
        };
        let source = temp.join("source");
        let paper = temp.join("paper");
        std::fs::create_dir_all(&source).unwrap();
        std::fs::create_dir_all(&paper).unwrap();
        std::fs::write(source.join(".gitattributes"), "*.tex filter=hostile\n").unwrap();
        std::fs::write(source.join("figure.tex"), "a\n").unwrap();
        git(&source, &["init", "--quiet"]);
        git(&source, &["add", "-A"]);
        git(&source, &["commit", "--quiet", "-m", "base"]);
        git(&paper, &["init", "--quiet"]);
        git(
            &paper,
            &[
                "submodule",
                "--quiet",
                "add",
                source.to_str().unwrap(),
                "sub",
            ],
        );
        git(&paper, &["commit", "--quiet", "-m", "base"]);
        let sentinel = temp.join("filter-ran");
        let config = paper.join(".git/modules/sub/config");
        let mut text = std::fs::read_to_string(&config).unwrap();
        text.push_str(&format!(
            "[filter \"hostile\"]\n\tclean = touch '{}'; cat\n",
            sentinel.display()
        ));
        std::fs::write(&config, text).unwrap();
        (paper.clone(), paper.join("sub/figure.tex"), sentinel)
    }

    #[cfg(unix)]
    fn status_after_edit(directory: &Path, file: &Path, edit: &str, env: &[(String, OsString)]) {
        std::fs::write(file, edit).unwrap();
        let mut command = std::process::Command::new("git");
        crate::git::clear_inherited_git_env(&mut command);
        command
            .current_dir(directory)
            .args(["status", "--porcelain"])
            .envs(
                env.iter()
                    .map(|(key, value)| (key.as_str(), value.as_os_str())),
            )
            .output()
            .unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn restricted_git_env_keeps_a_submodule_filter_from_running() {
        let temp = tempfile::tempdir().unwrap();
        let (paper, figure, sentinel) = hostile_submodule_fixture(temp.path());
        std::fs::write(
            paper.join(".gitmodules"),
            format!(
                "{}\tignore = none\n",
                std::fs::read_to_string(paper.join(".gitmodules")).unwrap()
            ),
        )
        .unwrap();
        status_after_edit(
            &paper,
            &figure,
            "b\n",
            &restricted_git_env(&paper, &|_| None),
        );
        assert!(!sentinel.exists());
        status_after_edit(&paper, &figure, "c\n", &[]);
        assert!(
            sentinel.exists(),
            "positive control: git status runs the submodule clean filter"
        );
    }

    #[cfg(unix)]
    #[test]
    fn restricted_git_env_keeps_a_nested_repository_filter_from_running() {
        let temp = tempfile::tempdir().unwrap();
        let (paper, _, sentinel) = hostile_submodule_fixture(temp.path());
        let nested = paper.join("vendor/tool");
        std::fs::create_dir_all(nested.parent().unwrap()).unwrap();
        std::fs::rename(paper.join("sub"), &nested).unwrap();
        std::fs::remove_file(nested.join(".git")).unwrap();
        std::fs::rename(paper.join(".git/modules/sub"), nested.join(".git")).unwrap();
        let config = nested.join(".git/config");
        let text = std::fs::read_to_string(&config).unwrap();
        let kept: Vec<&str> = text
            .lines()
            .filter(|line| !line.trim_start().starts_with("worktree"))
            .collect();
        std::fs::write(&config, kept.join("\n") + "\n").unwrap();
        let figure = nested.join("figure.tex");
        status_after_edit(
            &nested,
            &figure,
            "b\n",
            &restricted_git_env(&paper, &|_| None),
        );
        assert!(!sentinel.exists());
        status_after_edit(&nested, &figure, "c\n", &[]);
        assert!(
            sentinel.exists(),
            "positive control: git status runs the nested repository clean filter"
        );
    }

    #[test]
    fn restricted_compile_meta_ignores_engine_flavor_and_shell_escape() {
        let _restricted = testing::restrict("restricted-meta");
        let meta = restrict_compile_meta(
            "restricted-meta",
            ProjectMeta {
                main_doc: "main.tex".into(),
                engine: "latexmk".into(),
                tex_flavor: Some("lualatex".into()),
                allow_shell_escape: true,
                ..ProjectMeta::default()
            },
        )
        .unwrap();
        assert_eq!(
            (
                meta.engine.as_str(),
                meta.tex_flavor,
                meta.allow_shell_escape
            ),
            ("xetex", None, false)
        );
        let typst = restrict_compile_meta(
            "restricted-meta",
            ProjectMeta {
                main_doc: "slides.typ".into(),
                engine: "typst".into(),
                ..ProjectMeta::default()
            },
        )
        .unwrap();
        assert_eq!(typst.engine, "typst");
        assert_eq!(mcp_exposure("restricted-meta"), McpExposure::Closed);
    }

    #[test]
    fn a_restricted_library_copy_becomes_trusted_only_through_an_explicit_grant() {
        let _env_guard = crate::paths::data_dir_env_lock();
        let data = tempfile::tempdir().unwrap();
        std::env::set_var("OLEAFLY_DATA_DIR", data.path());
        crate::paths::create_project_dir("copied-thesis").unwrap();
        assert_eq!(
            project_trust("copied-thesis").unwrap(),
            TrustState::Trusted(TrustSource::Library)
        );
        mark_library_restricted("copied-thesis").unwrap();
        assert_eq!(
            project_trust("copied-thesis").unwrap(),
            TrustState::Restricted
        );
        assert_eq!(
            require_trusted("copied-thesis", Capability::Git)
                .unwrap_err()
                .code,
            "trust.git"
        );
        let target = grant_target("copied-thesis", TrustScope::Folder).unwrap();
        apply_grant("copied-thesis", &target).unwrap();
        assert_eq!(
            describe("copied-thesis").unwrap(),
            ProjectTrust {
                trusted: true,
                source: Some(TrustSource::Library),
                parent: None,
                repository: None,
            }
        );
        forget_project("copied-thesis").unwrap();
        std::env::remove_var("OLEAFLY_DATA_DIR");
    }

    #[test]
    fn every_trust_dialog_is_translated_with_its_placeholder() {
        let keys: &[(&str, Option<&str>)] = &[
            ("dialog.trustFolder.title", None),
            ("dialog.trustFolder.message", Some("name")),
            ("dialog.trustFolder.messageParent", Some("name")),
            ("dialog.trustFolder.messageRepository", Some("name")),
            ("dialog.trustFolder.confirm", None),
            ("dialog.restrictedWrite.title", None),
            ("dialog.restrictedWrite.message", Some("path")),
            ("dialog.restrictedWrite.confirm", None),
            ("dialog.restrictedNetwork.title", None),
            ("dialog.restrictedNetwork.message", Some("tool")),
            ("dialog.restrictedNetwork.confirm", None),
        ];
        for locale in crate::i18n::SUPPORTED {
            for (key, placeholder) in keys {
                let text = crate::i18n::t_in(locale, key);
                assert_ne!(&text, key, "{locale} {key}");
                if let Some(name) = placeholder {
                    let filled = crate::i18n::t_with_in(locale, key, &[(name, "VALUE")]);
                    assert!(filled.contains("VALUE"), "{locale} {key}");
                    assert!(!filled.contains("{{"), "{locale} {key}");
                }
            }
        }
    }

    use testing::LinkedFixture;

    #[test]
    fn a_linked_folder_starts_restricted_and_a_folder_grant_trusts_it() {
        let fixture = LinkedFixture::new();
        let (id, _) = fixture.link("papers/thesis");
        assert_eq!(project_trust(&id).unwrap(), TrustState::Restricted);
        assert_eq!(
            require_trusted(&id, Capability::ExternalAgents)
                .unwrap_err()
                .code,
            "trust.agents"
        );
        assert_eq!(mcp_exposure(&id), McpExposure::Closed);
        let target = grant_target(&id, TrustScope::Folder).unwrap();
        apply_grant(&id, &target).unwrap();
        assert_eq!(
            project_trust(&id).unwrap(),
            TrustState::Trusted(TrustSource::Folder)
        );
        assert_eq!(mcp_exposure(&id), McpExposure::ReadOnly);
        assert_eq!(
            describe(&id).unwrap(),
            ProjectTrust {
                trusted: true,
                source: Some(TrustSource::Folder),
                parent: Some("papers".into()),
                repository: None,
            }
        );
        revoke_project(&id).unwrap();
        assert_eq!(project_trust(&id).unwrap(), TrustState::Restricted);
    }

    #[test]
    fn a_folder_replaced_at_the_same_path_loses_its_trust() {
        let fixture = LinkedFixture::new();
        let (id, folder) = fixture.link("thesis");
        apply_grant(&id, &grant_target(&id, TrustScope::Folder).unwrap()).unwrap();
        assert!(is_trusted(&id));
        std::fs::remove_dir(&folder).unwrap();
        std::fs::create_dir(&folder).unwrap();
        assert!(!is_trusted(&id));
        assert!(require_trusted(&id, Capability::Git).is_err());
    }

    #[test]
    fn a_parent_grant_trusts_every_linked_folder_inside_it() {
        let fixture = LinkedFixture::new();
        let (thesis, _) = fixture.link("papers/thesis");
        let (notes, _) = fixture.link("papers/notes");
        let (outside, _) = fixture.link("elsewhere/draft");
        apply_grant(&thesis, &grant_target(&thesis, TrustScope::Parent).unwrap()).unwrap();
        for id in [&thesis, &notes] {
            assert_eq!(
                project_trust(id).unwrap(),
                TrustState::Trusted(TrustSource::ParentFolder)
            );
        }
        assert_eq!(project_trust(&outside).unwrap(), TrustState::Restricted);
    }

    #[test]
    fn broad_parents_and_library_parents_are_never_granted() {
        let fixture = LinkedFixture::new();
        crate::paths::create_project_dir("library-paper").unwrap();
        assert_eq!(
            grant_target("library-paper", TrustScope::Parent)
                .err()
                .unwrap()
                .code,
            "trust.unavailable"
        );
        let home = crate::paths::home_dir().unwrap();
        assert!(is_broad_folder(&home));
        assert!(is_broad_folder(&home.join("Downloads")));
        assert!(is_broad_folder(
            &crate::paths::oleafly_root()
                .unwrap()
                .canonicalize()
                .unwrap()
        ));
        assert!(!is_broad_folder(&fixture.folders.path().join("papers")));
    }

    #[test]
    fn git_in_an_enclosing_repository_needs_that_repository_trusted() {
        let fixture = LinkedFixture::new();
        let repo = fixture.folders.path().join("repo");
        std::fs::create_dir_all(repo.join(".git")).unwrap();
        std::fs::write(repo.join(".git").join("HEAD"), "ref: refs/heads/main\n").unwrap();
        let (id, paper) = fixture.link("repo/paper");
        assert_eq!(require_git(&id, &paper).unwrap_err().code, "trust.git");
        apply_grant(&id, &grant_target(&id, TrustScope::Folder).unwrap()).unwrap();
        let refused = require_git(&id, &paper).unwrap_err();
        assert_eq!(refused.code, "trust.repository");
        assert_eq!(refused.params.get("name").map(String::as_str), Some("repo"));
        assert_eq!(
            describe(&id).unwrap().repository,
            Some(RepositoryTrust {
                name: "repo".into(),
                trusted: false,
            })
        );
        assert!(git_restriction(&id, &paper).unwrap().is_some());
        apply_grant(&id, &grant_target(&id, TrustScope::Repository).unwrap()).unwrap();
        require_git(&id, &paper).unwrap();
        assert!(git_restriction(&id, &paper).unwrap().is_none());
        assert!(describe(&id).unwrap().repository.unwrap().trusted);
    }

    #[test]
    fn trusting_a_repository_needs_a_trusted_folder_and_trusts_no_other_folder() {
        let fixture = LinkedFixture::new();
        let repo = fixture.folders.path().join("repo");
        std::fs::create_dir_all(repo.join(".git")).unwrap();
        std::fs::write(repo.join(".git").join("HEAD"), "ref: refs/heads/main\n").unwrap();
        let (paper, _) = fixture.link("repo/paper");
        let (notes, notes_root) = fixture.link("repo/notes");
        assert_eq!(
            grant_target(&paper, TrustScope::Repository)
                .err()
                .unwrap()
                .code,
            "trust.git"
        );
        fixture.trust(&paper, TrustScope::Folder);
        fixture.trust(&paper, TrustScope::Repository);
        assert_eq!(project_trust(&notes).unwrap(), TrustState::Restricted);
        assert_eq!(
            require_git(&notes, &notes_root).unwrap_err().code,
            "trust.git"
        );
        assert!(git_restriction(&notes, &notes_root).unwrap().is_some());
        assert_eq!(mcp_exposure(&notes), McpExposure::Closed);
        fixture.trust(&paper, TrustScope::Parent);
        fixture.trust(&paper, TrustScope::Repository);
        assert_eq!(
            project_trust(&notes).unwrap(),
            TrustState::Trusted(TrustSource::ParentFolder)
        );
    }
}
