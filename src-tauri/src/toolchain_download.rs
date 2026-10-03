use sha2::Digest as _;
use std::collections::{BTreeMap, HashSet};
use std::fs::File;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::time::Duration;

const MAX_ARCHIVE_BYTES: u64 = 512 * 1024 * 1024;
const MAX_BINARY_BYTES: u64 = 1024 * 1024 * 1024;
const MAX_ARCHIVE_MEMBERS: usize = 10_000;
const MAX_REDIRECTS: usize = 10;
const MAX_ERROR_BYTES: usize = 1024;
const PROGRESS_STEP_BYTES: u64 = 256 * 1024;
const PROGRESS_INTERVAL: Duration = Duration::from_millis(100);
const COPY_BUFFER_BYTES: usize = 64 * 1024;
#[cfg(not(windows))]
const XZ_MEMORY_LIMIT_BYTES: u64 = 64 * 1024 * 1024;
const STAGING_DIRECTORY: &str = ".staging";
const USER_AGENT: &str = concat!("Oleafly-toolchain-installer/", env!("CARGO_PKG_VERSION"));

static ACTIVE_INSTALLS: Mutex<BTreeMap<PathBuf, ActiveEntry>> = Mutex::new(BTreeMap::new());

struct ActiveEntry {
    owner: std::thread::ThreadId,
    background: Option<CancelToken>,
}

impl ActiveEntry {
    fn visible(&self) -> bool {
        !cfg!(test) || self.owner == std::thread::current().id()
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum ArchiveKind {
    TarXz,
    TarGz,
    Zip,
    Binary,
}

impl ArchiveKind {
    pub(crate) fn parse(value: &str) -> Option<Self> {
        match value {
            "tar.xz" => Some(Self::TarXz),
            "tar.gz" => Some(Self::TarGz),
            "zip" => Some(Self::Zip),
            "binary" => Some(Self::Binary),
            _ => None,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct DownloadTimeouts {
    pub(crate) connect: Duration,
    pub(crate) stall: Duration,
    pub(crate) total: Duration,
}

impl Default for DownloadTimeouts {
    fn default() -> Self {
        Self {
            connect: Duration::from_secs(20),
            stall: Duration::from_secs(30),
            total: Duration::from_secs(30 * 60),
        }
    }
}

#[derive(Clone, Debug)]
pub(crate) struct ToolchainInstallRequest {
    pub(crate) urls: Vec<String>,
    pub(crate) allowed_hosts: Vec<String>,
    pub(crate) archive_kind: ArchiveKind,
    pub(crate) archive_size: u64,
    pub(crate) archive_sha256: String,
    pub(crate) archive_member: Option<String>,
    pub(crate) binary_size: u64,
    pub(crate) binary_sha256: String,
    pub(crate) install_dir: PathBuf,
    pub(crate) binary_name: String,
    pub(crate) timeouts: DownloadTimeouts,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum InstallPhase {
    Downloading,
    Verifying,
    Extracting,
    Done,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct InstallProgress {
    pub(crate) phase: InstallPhase,
    pub(crate) received_bytes: u64,
    pub(crate) total_bytes: u64,
}

impl InstallProgress {
    fn at(phase: InstallPhase, received_bytes: u64, total_bytes: u64) -> Self {
        Self {
            phase,
            received_bytes,
            total_bytes,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum ToolchainInstallOutcome {
    Installed(PathBuf),
    AlreadyInstalled(PathBuf),
}

impl ToolchainInstallOutcome {
    pub(crate) fn binary_path(&self) -> &Path {
        match self {
            Self::Installed(path) | Self::AlreadyInstalled(path) => path,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum ToolchainInstallErrorKind {
    InvalidRequest,
    AlreadyInstalling,
    Cancelled,
    DownloadFailed,
    IntegrityFailure,
    InstallFailed,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct ToolchainInstallError {
    kind: ToolchainInstallErrorKind,
    message: String,
}

impl ToolchainInstallError {
    fn new(kind: ToolchainInstallErrorKind, message: impl Into<String>) -> Self {
        Self {
            kind,
            message: message.into(),
        }
    }

    pub(crate) fn kind(&self) -> ToolchainInstallErrorKind {
        self.kind
    }

    pub(crate) fn message(&self) -> &str {
        &self.message
    }
}

impl std::fmt::Display for ToolchainInstallError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.message)
    }
}

impl std::error::Error for ToolchainInstallError {}

fn invalid(message: impl Into<String>) -> ToolchainInstallError {
    ToolchainInstallError::new(ToolchainInstallErrorKind::InvalidRequest, message)
}

fn integrity(message: impl Into<String>) -> ToolchainInstallError {
    ToolchainInstallError::new(ToolchainInstallErrorKind::IntegrityFailure, message)
}

fn install_failed(message: impl Into<String>) -> ToolchainInstallError {
    ToolchainInstallError::new(ToolchainInstallErrorKind::InstallFailed, message)
}

fn cancelled() -> ToolchainInstallError {
    ToolchainInstallError::new(
        ToolchainInstallErrorKind::Cancelled,
        "The install was cancelled.",
    )
}

fn filesystem_error(action: &str, path: &Path, error: std::io::Error) -> ToolchainInstallError {
    install_failed(format!("Could not {action} {}: {error}", path.display()))
}

fn archive_error(error: impl std::fmt::Display) -> ToolchainInstallError {
    integrity(bounded(format!("The archive could not be read: {error}")))
}

#[derive(Clone, Debug)]
pub(crate) struct CancelToken(Arc<tokio::sync::watch::Sender<bool>>);

impl Default for CancelToken {
    fn default() -> Self {
        Self::new()
    }
}

impl CancelToken {
    pub(crate) fn new() -> Self {
        Self(Arc::new(tokio::sync::watch::channel(false).0))
    }

    pub(crate) fn cancel(&self) {
        self.0.send_replace(true);
    }

    pub(crate) fn is_cancelled(&self) -> bool {
        *self.0.borrow()
    }

    async fn cancelled(&self) {
        let mut receiver = self.0.subscribe();
        let _ = receiver.wait_for(|cancelled| *cancelled).await;
    }
}

#[derive(Clone)]
struct StopSignal {
    cancel: CancelToken,
    abandoned: Arc<AtomicBool>,
}

impl StopSignal {
    fn stopped(&self) -> bool {
        self.cancel.is_cancelled() || self.abandoned.load(Ordering::SeqCst)
    }
}

fn active_installs() -> MutexGuard<'static, BTreeMap<PathBuf, ActiveEntry>> {
    ACTIVE_INSTALLS
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
}

pub(crate) fn install_in_progress() -> bool {
    active_installs()
        .values()
        .any(|entry| entry.background.is_none() && entry.visible())
}

pub(crate) fn background_install_in_progress() -> bool {
    active_installs()
        .values()
        .any(|entry| entry.background.is_some() && entry.visible())
}

pub(crate) fn cancel_background_installs() -> Vec<PathBuf> {
    active_installs()
        .iter()
        .filter(|(_, entry)| entry.visible())
        .filter_map(|(key, entry)| {
            entry.background.as_ref().map(|cancel| {
                cancel.cancel();
                key.clone()
            })
        })
        .collect()
}

pub(crate) fn abandon_background_installs(wait: Duration) {
    let keys = cancel_background_installs();
    if keys.is_empty() {
        return;
    }
    let deadline = std::time::Instant::now() + wait;
    while background_install_in_progress() && std::time::Instant::now() < deadline {
        std::thread::sleep(Duration::from_millis(20));
    }
    let remaining: Vec<PathBuf> = {
        let active = active_installs();
        keys.into_iter()
            .filter(|key| active.contains_key(key))
            .collect()
    };
    for key in remaining {
        if let Some(layout) = Layout::registered(&key) {
            layout.sweep_stale_staging();
        }
    }
}

pub(crate) fn is_installing(install_dir: &Path) -> bool {
    let (Some(parent), Some(name)) = (install_dir.parent(), install_dir.file_name()) else {
        return false;
    };
    let Ok(parent) = std::fs::canonicalize(parent) else {
        return false;
    };
    active_installs().contains_key(&parent.join(name))
}

struct ActiveInstall {
    key: PathBuf,
    abandoned: Arc<AtomicBool>,
}

impl ActiveInstall {
    fn register(
        key: PathBuf,
        background: Option<CancelToken>,
    ) -> Result<Self, ToolchainInstallError> {
        let mut active = active_installs();
        if active.contains_key(&key) {
            return Err(ToolchainInstallError::new(
                ToolchainInstallErrorKind::AlreadyInstalling,
                "This version is already being installed.",
            ));
        }
        active.insert(
            key.clone(),
            ActiveEntry {
                owner: std::thread::current().id(),
                background,
            },
        );
        Ok(Self {
            key,
            abandoned: Arc::new(AtomicBool::new(false)),
        })
    }
}

impl Drop for ActiveInstall {
    fn drop(&mut self) {
        self.abandoned.store(true, Ordering::SeqCst);
        active_installs().remove(&self.key);
    }
}

pub(crate) fn installed_binary_matches(
    binary: &Path,
    binary_size: u64,
    binary_sha256: &str,
) -> bool {
    let Ok(metadata) = std::fs::symlink_metadata(binary) else {
        return false;
    };
    if !metadata.is_file() || metadata.len() != binary_size {
        return false;
    }
    let Ok(file) = File::open(binary) else {
        return false;
    };
    let mut reader = file.take(binary_size.saturating_add(1));
    let mut hasher = sha2::Sha256::new();
    let mut buffer = vec![0_u8; COPY_BUFFER_BYTES];
    let mut total = 0_u64;
    loop {
        match reader.read(&mut buffer) {
            Ok(0) => break,
            Ok(read) => {
                total += read as u64;
                hasher.update(&buffer[..read]);
            }
            Err(_) => return false,
        }
    }
    total == binary_size && format!("{:x}", hasher.finalize()) == binary_sha256.to_ascii_lowercase()
}

struct InstallPlan {
    urls: Vec<String>,
    allowed_hosts: Arc<HashSet<String>>,
    kind: ArchiveKind,
    archive_size: u64,
    archive_sha256: String,
    member: Option<Vec<String>>,
    binary_size: u64,
    binary_sha256: String,
    parent: PathBuf,
    name: String,
    binary_name: String,
    timeouts: DownloadTimeouts,
}

impl InstallPlan {
    fn new(request: ToolchainInstallRequest) -> Result<Self, ToolchainInstallError> {
        if request.urls.is_empty() {
            return Err(invalid("No download address was given."));
        }
        let allowed_hosts: HashSet<String> = request
            .allowed_hosts
            .iter()
            .map(|host| host.trim().to_ascii_lowercase())
            .filter(|host| !host.is_empty())
            .collect();
        if allowed_hosts.is_empty() {
            return Err(invalid("No download host is allowed."));
        }
        if !(1..=MAX_ARCHIVE_BYTES).contains(&request.archive_size) {
            return Err(invalid("The pinned archive size is out of range."));
        }
        if !(1..=MAX_BINARY_BYTES).contains(&request.binary_size) {
            return Err(invalid("The pinned binary size is out of range."));
        }
        let archive_sha256 = normalized_sha256(&request.archive_sha256)
            .ok_or_else(|| invalid("The pinned archive SHA-256 is not a valid digest."))?;
        let binary_sha256 = normalized_sha256(&request.binary_sha256)
            .ok_or_else(|| invalid("The pinned binary SHA-256 is not a valid digest."))?;
        let member = plan_member(request.archive_kind, request.archive_member.as_deref())?;
        if request.archive_kind == ArchiveKind::Binary
            && (request.archive_size != request.binary_size || archive_sha256 != binary_sha256)
        {
            return Err(invalid(
                "A bare binary download must match the pinned binary size and SHA-256.",
            ));
        }
        if cfg!(windows) && request.archive_kind == ArchiveKind::TarXz {
            return Err(invalid("XZ archives are not supported on Windows."));
        }
        if !request.install_dir.is_absolute() {
            return Err(invalid("The install directory must be an absolute path."));
        }
        let name = request
            .install_dir
            .file_name()
            .and_then(|name| name.to_str())
            .filter(|name| valid_segment(name) && !name.starts_with('.'))
            .ok_or_else(|| invalid("The install directory name is not a safe version name."))?
            .to_string();
        let parent = request
            .install_dir
            .parent()
            .ok_or_else(|| invalid("The install directory has no parent directory."))?
            .to_path_buf();
        if !valid_segment(&request.binary_name) {
            return Err(invalid("The binary file name is not a safe file name."));
        }
        Ok(Self {
            urls: request.urls,
            allowed_hosts: Arc::new(allowed_hosts),
            kind: request.archive_kind,
            archive_size: request.archive_size,
            archive_sha256,
            member,
            binary_size: request.binary_size,
            binary_sha256,
            parent,
            name,
            binary_name: request.binary_name,
            timeouts: request.timeouts,
        })
    }
}

fn plan_member(
    kind: ArchiveKind,
    member: Option<&str>,
) -> Result<Option<Vec<String>>, ToolchainInstallError> {
    match (kind, member) {
        (ArchiveKind::Binary, None) => Ok(None),
        (ArchiveKind::Binary, Some(_)) => Err(invalid(
            "A bare binary download cannot name an archive member.",
        )),
        (_, None) => Err(invalid("The archive member to extract is missing.")),
        (_, Some(member)) => member_components(member.as_bytes())
            .ok()
            .filter(|parts| !parts.is_empty())
            .map(Some)
            .ok_or_else(|| invalid("The archive member is not a safe relative path.")),
    }
}

fn normalized_sha256(value: &str) -> Option<String> {
    let value = value.trim().to_ascii_lowercase();
    (value.len() == 64 && value.bytes().all(|byte| byte.is_ascii_hexdigit())).then_some(value)
}

fn valid_segment(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value != "."
        && value != ".."
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b'+'))
}

fn member_components(raw: &[u8]) -> Result<Vec<String>, ()> {
    let text = std::str::from_utf8(raw).map_err(|_| ())?;
    if text.is_empty() || text.contains('\0') || text.starts_with(['/', '\\']) {
        return Err(());
    }
    let mut parts = Vec::new();
    for part in text.split(['/', '\\']) {
        match part {
            "" | "." => {}
            ".." => return Err(()),
            part if part.contains(':') => return Err(()),
            part => parts.push(part.to_string()),
        }
    }
    Ok(parts)
}

#[derive(Clone)]
struct Layout {
    parent: PathBuf,
    name: String,
    destination: PathBuf,
    staging_root: PathBuf,
}

impl Layout {
    fn prepare(plan: &InstallPlan) -> Result<Self, ToolchainInstallError> {
        std::fs::create_dir_all(&plan.parent)
            .map_err(|error| filesystem_error("create", &plan.parent, error))?;
        let parent = std::fs::canonicalize(&plan.parent)
            .map_err(|error| filesystem_error("resolve", &plan.parent, error))?;
        let staging_root = parent.join(STAGING_DIRECTORY);
        if let Err(error) = std::fs::create_dir(&staging_root) {
            if error.kind() != std::io::ErrorKind::AlreadyExists {
                return Err(filesystem_error("create", &staging_root, error));
            }
        }
        let metadata = std::fs::symlink_metadata(&staging_root)
            .map_err(|error| filesystem_error("inspect", &staging_root, error))?;
        if !metadata.is_dir() {
            return Err(install_failed(format!(
                "{} is not a real directory.",
                staging_root.display()
            )));
        }
        Ok(Self {
            destination: parent.join(&plan.name),
            parent,
            name: plan.name.clone(),
            staging_root,
        })
    }

    fn registered(destination: &Path) -> Option<Self> {
        let parent = destination.parent()?.to_path_buf();
        let name = destination.file_name()?.to_str()?.to_owned();
        Some(Self {
            staging_root: parent.join(STAGING_DIRECTORY),
            destination: destination.to_path_buf(),
            parent,
            name,
        })
    }

    fn installed_binary(&self, plan: &InstallPlan) -> Option<PathBuf> {
        let is_directory =
            std::fs::symlink_metadata(&self.destination).is_ok_and(|metadata| metadata.is_dir());
        let binary = self.destination.join(&plan.binary_name);
        (is_directory && installed_binary_matches(&binary, plan.binary_size, &plan.binary_sha256))
            .then_some(binary)
    }

    fn sweep_stale_staging(&self) {
        let Ok(entries) = std::fs::read_dir(&self.staging_root) else {
            return;
        };
        let prefix = format!("{}-", self.name);
        for entry in entries.flatten() {
            let file_name = entry.file_name();
            let Some(suffix) = file_name
                .to_str()
                .and_then(|name| name.strip_prefix(prefix.as_str()))
            else {
                continue;
            };
            let random_suffix = suffix.len() == 32
                && suffix
                    .bytes()
                    .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte));
            if !random_suffix {
                continue;
            }
            let path = entry.path();
            match std::fs::symlink_metadata(&path) {
                Ok(metadata) if metadata.is_dir() => {
                    let _ = std::fs::remove_dir_all(&path);
                }
                Ok(_) => {
                    let _ = std::fs::remove_file(&path);
                }
                Err(_) => {}
            }
        }
    }
}

struct VersionLock {
    file: File,
}

impl VersionLock {
    fn acquire(layout: &Layout) -> Result<Self, ToolchainInstallError> {
        let path = layout.staging_root.join(format!("{}.lock", layout.name));
        let mut options = std::fs::OpenOptions::new();
        options.read(true).write(true).create(true).truncate(false);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt as _;
            options.mode(0o600);
        }
        let file = options
            .open(&path)
            .map_err(|error| filesystem_error("open", &path, error))?;
        fs4::FileExt::try_lock(&file).map_err(|_| {
            ToolchainInstallError::new(
                ToolchainInstallErrorKind::AlreadyInstalling,
                "Another Oleafly window is already installing this version.",
            )
        })?;
        Ok(Self { file })
    }
}

impl Drop for VersionLock {
    fn drop(&mut self) {
        let _ = fs4::FileExt::unlock(&self.file);
    }
}

struct Staging {
    root: PathBuf,
}

impl Staging {
    fn create(layout: &Layout) -> Result<Self, ToolchainInstallError> {
        for _ in 0..8 {
            let root = layout.staging_root.join(format!(
                "{}-{:032x}",
                layout.name,
                rand::random::<u128>()
            ));
            match std::fs::create_dir(&root) {
                Ok(()) => return Ok(Self { root }),
                Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
                Err(error) => return Err(filesystem_error("create", &root, error)),
            }
        }
        Err(install_failed("Could not allocate a staging directory."))
    }

    fn archive(&self) -> PathBuf {
        self.root.join("archive")
    }

    fn payload(&self) -> PathBuf {
        self.root.join("payload")
    }

    fn previous(&self) -> PathBuf {
        self.root.join("previous")
    }
}

impl Drop for Staging {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.root);
    }
}

type ProgressSink = Arc<dyn Fn(InstallProgress) + Send + Sync>;

async fn run_blocking<T, F>(work: F) -> Result<T, ToolchainInstallError>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, ToolchainInstallError> + Send + 'static,
{
    tokio::task::spawn_blocking(work)
        .await
        .map_err(|error| install_failed(format!("The install worker stopped: {error}")))?
}

pub(crate) async fn install_toolchain<F>(
    request: ToolchainInstallRequest,
    cancel: CancelToken,
    progress: F,
) -> Result<ToolchainInstallOutcome, ToolchainInstallError>
where
    F: Fn(InstallProgress) + Send + Sync + 'static,
{
    install_with(request, cancel, progress, false).await
}

pub(crate) async fn install_toolchain_in_background<F>(
    request: ToolchainInstallRequest,
    progress: F,
) -> Result<ToolchainInstallOutcome, ToolchainInstallError>
where
    F: Fn(InstallProgress) + Send + Sync + 'static,
{
    install_with(request, CancelToken::new(), progress, true).await
}

async fn install_with<F>(
    request: ToolchainInstallRequest,
    cancel: CancelToken,
    progress: F,
    background: bool,
) -> Result<ToolchainInstallOutcome, ToolchainInstallError>
where
    F: Fn(InstallProgress) + Send + Sync + 'static,
{
    let plan = Arc::new(InstallPlan::new(request)?);
    let progress: ProgressSink = Arc::new(progress);
    if cancel.is_cancelled() {
        return Err(cancelled());
    }
    let layout = run_blocking({
        let plan = plan.clone();
        move || Layout::prepare(&plan)
    })
    .await?;
    let active = ActiveInstall::register(
        layout.destination.clone(),
        background.then(|| cancel.clone()),
    )?;
    let stop = StopSignal {
        cancel: cancel.clone(),
        abandoned: active.abandoned.clone(),
    };
    let (lock, installed) = run_blocking({
        let layout = layout.clone();
        let plan = plan.clone();
        move || {
            let lock = VersionLock::acquire(&layout)?;
            layout.sweep_stale_staging();
            Ok((lock, layout.installed_binary(&plan)))
        }
    })
    .await?;
    let size = plan.archive_size;
    if let Some(binary) = installed {
        drop(lock);
        drop(active);
        progress(InstallProgress::at(InstallPhase::Done, size, size));
        return Ok(ToolchainInstallOutcome::AlreadyInstalled(binary));
    }
    let staging = run_blocking({
        let layout = layout.clone();
        move || Staging::create(&layout)
    })
    .await?;
    download_archive(&plan, &staging.archive(), &cancel, &progress).await?;
    if stop.stopped() {
        return Err(cancelled());
    }
    progress(InstallProgress::at(InstallPhase::Extracting, size, size));
    run_blocking({
        let plan = plan.clone();
        let archive = staging.archive();
        let payload = staging.payload();
        let stop = stop.clone();
        move || extract_binary(&plan, &archive, &payload, &stop)
    })
    .await?;
    if stop.stopped() {
        return Err(cancelled());
    }
    publish(&staging, &layout)?;
    drop(staging);
    drop(lock);
    drop(active);
    progress(InstallProgress::at(InstallPhase::Done, size, size));
    Ok(ToolchainInstallOutcome::Installed(
        layout.destination.join(&plan.binary_name),
    ))
}

enum SourceFailure {
    Cancelled,
    Failed(String),
    Local(ToolchainInstallError),
}

struct UrlProblem {
    host: String,
    problem: &'static str,
}

fn check_url(url: &reqwest::Url, allowed: &HashSet<String>) -> Result<(), UrlProblem> {
    let host = url.host_str().unwrap_or_default().to_ascii_lowercase();
    let problem = |problem| {
        Err(UrlProblem {
            host: host.clone(),
            problem,
        })
    };
    if host.is_empty() {
        return problem("has no host");
    }
    let https = url.scheme() == "https" && matches!(url.port(), None | Some(443));
    let test_loopback = cfg!(test)
        && url.scheme() == "http"
        && matches!(host.as_str(), "127.0.0.1" | "localhost" | "[::1]");
    if !https && !test_loopback {
        return problem("is not served over HTTPS");
    }
    if !url.username().is_empty() || url.password().is_some() {
        return problem("carries credentials in its address");
    }
    if !allowed.contains(&host) {
        return problem("is not an allowed download host");
    }
    Ok(())
}

fn redirect_refusal(problem: UrlProblem) -> String {
    format!("redirected to {}, which {}", problem.host, problem.problem)
}

fn http_client(plan: &InstallPlan) -> Result<reqwest::Client, ToolchainInstallError> {
    let allowed = plan.allowed_hosts.clone();
    let policy = reqwest::redirect::Policy::custom(move |attempt| {
        if attempt.previous().len() >= MAX_REDIRECTS {
            return attempt.error("too many redirects");
        }
        match check_url(attempt.url(), &allowed) {
            Ok(()) => attempt.follow(),
            Err(problem) => attempt.error(redirect_refusal(problem)),
        }
    });
    let builder = reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .connect_timeout(plan.timeouts.connect)
        .timeout(plan.timeouts.total)
        .redirect(policy);
    let builder = if cfg!(test) {
        builder.no_proxy()
    } else {
        builder
    };
    builder.build().map_err(|error| {
        install_failed(format!(
            "Could not start the downloader: {}",
            describe_http_error(error)
        ))
    })
}

fn describe_http_error(error: reqwest::Error) -> String {
    let error = error.without_url();
    let mut message = error.to_string();
    let mut source = std::error::Error::source(&error);
    while let Some(cause) = source {
        let cause_text = cause.to_string();
        if !message.contains(&cause_text) {
            message.push_str(": ");
            message.push_str(&cause_text);
        }
        source = cause.source();
    }
    bounded(message)
}

fn bounded(mut message: String) -> String {
    if message.len() > MAX_ERROR_BYTES {
        let mut end = MAX_ERROR_BYTES;
        while !message.is_char_boundary(end) {
            end -= 1;
        }
        message.truncate(end);
    }
    message
}

fn source_label(url: &str) -> String {
    reqwest::Url::parse(url)
        .ok()
        .and_then(|url| url.host_str().map(str::to_string))
        .unwrap_or_else(|| "A download source".to_string())
}

async fn download_archive(
    plan: &InstallPlan,
    archive: &Path,
    cancel: &CancelToken,
    progress: &ProgressSink,
) -> Result<(), ToolchainInstallError> {
    let client = http_client(plan)?;
    let mut failures = Vec::new();
    for url in &plan.urls {
        if cancel.is_cancelled() {
            return Err(cancelled());
        }
        let result = download_source(&client, plan, url, archive, cancel, progress).await;
        if result.is_err() {
            let _ = tokio::fs::remove_file(archive).await;
        }
        match result {
            Ok(()) => return Ok(()),
            Err(SourceFailure::Cancelled) => return Err(cancelled()),
            Err(SourceFailure::Local(error)) => return Err(error),
            Err(SourceFailure::Failed(reason)) => {
                failures.push(format!("{} {reason}.", source_label(url)));
            }
        }
    }
    Err(ToolchainInstallError::new(
        ToolchainInstallErrorKind::DownloadFailed,
        format!("Every download source failed. {}", failures.join(" ")),
    ))
}

fn stalled(plan: &InstallPlan) -> SourceFailure {
    SourceFailure::Failed(format!(
        "stopped sending data for {} seconds",
        plan.timeouts.stall.as_secs_f32()
    ))
}

async fn download_source(
    client: &reqwest::Client,
    plan: &InstallPlan,
    url: &str,
    archive: &Path,
    cancel: &CancelToken,
    progress: &ProgressSink,
) -> Result<(), SourceFailure> {
    use futures_util::StreamExt as _;
    use tokio::io::AsyncWriteExt as _;

    let parsed = reqwest::Url::parse(url)
        .map_err(|_| SourceFailure::Failed("is not a valid download address".into()))?;
    check_url(&parsed, &plan.allowed_hosts)
        .map_err(|problem| SourceFailure::Failed(problem.problem.to_string()))?;
    let request = client.get(parsed).send();
    let response = tokio::select! {
        biased;
        _ = cancel.cancelled() => return Err(SourceFailure::Cancelled),
        response = tokio::time::timeout(plan.timeouts.stall, request) => response
            .map_err(|_| stalled(plan))?
            .map_err(|error| SourceFailure::Failed(format!("failed: {}", describe_http_error(error))))?,
    };
    let status = response.status();
    if !status.is_success() {
        return Err(SourceFailure::Failed(format!("returned HTTP {status}")));
    }
    check_url(response.url(), &plan.allowed_hosts)
        .map_err(|problem| SourceFailure::Failed(redirect_refusal(problem)))?;
    if let Some(length) = response.content_length() {
        if length != plan.archive_size {
            return Err(SourceFailure::Failed(format!(
                "reported a size of {length} bytes instead of the pinned {} bytes",
                plan.archive_size
            )));
        }
    }
    let local = |error: std::io::Error| {
        SourceFailure::Local(filesystem_error("write the download to", archive, error))
    };
    let mut file = tokio::fs::File::create(archive).await.map_err(local)?;
    let mut hasher = sha2::Sha256::new();
    let mut received = 0_u64;
    let mut reported = 0_u64;
    let mut reported_at = std::time::Instant::now();
    progress(InstallProgress::at(
        InstallPhase::Downloading,
        0,
        plan.archive_size,
    ));
    let mut stream = response.bytes_stream();
    loop {
        let next = tokio::select! {
            biased;
            _ = cancel.cancelled() => return Err(SourceFailure::Cancelled),
            next = tokio::time::timeout(plan.timeouts.stall, stream.next()) => next.map_err(|_| stalled(plan))?,
        };
        let Some(chunk) = next else {
            break;
        };
        let chunk = chunk.map_err(|error| {
            SourceFailure::Failed(format!(
                "failed mid-download: {}",
                describe_http_error(error)
            ))
        })?;
        received = received
            .checked_add(chunk.len() as u64)
            .filter(|received| *received <= plan.archive_size)
            .ok_or_else(|| {
                SourceFailure::Failed(format!(
                    "sent more than the pinned size of {} bytes",
                    plan.archive_size
                ))
            })?;
        hasher.update(&chunk);
        file.write_all(&chunk).await.map_err(local)?;
        let due = reported == 0
            || received - reported >= PROGRESS_STEP_BYTES
            || reported_at.elapsed() >= PROGRESS_INTERVAL
            || received == plan.archive_size;
        if due {
            reported = received;
            reported_at = std::time::Instant::now();
            progress(InstallProgress::at(
                InstallPhase::Downloading,
                received,
                plan.archive_size,
            ));
        }
    }
    file.flush().await.map_err(local)?;
    file.sync_all().await.map_err(local)?;
    drop(file);
    if received != plan.archive_size {
        return Err(SourceFailure::Failed(format!(
            "ended after {received} of {} bytes",
            plan.archive_size
        )));
    }
    progress(InstallProgress::at(
        InstallPhase::Verifying,
        received,
        plan.archive_size,
    ));
    if format!("{:x}", hasher.finalize()) != plan.archive_sha256 {
        return Err(SourceFailure::Failed(
            "sent an archive whose SHA-256 does not match the pinned digest".into(),
        ));
    }
    Ok(())
}

fn extract_binary(
    plan: &InstallPlan,
    archive: &Path,
    payload: &Path,
    stop: &StopSignal,
) -> Result<(), ToolchainInstallError> {
    std::fs::create_dir(payload).map_err(|error| filesystem_error("create", payload, error))?;
    let target = payload.join(&plan.binary_name);
    let open = || File::open(archive).map_err(|error| filesystem_error("open", archive, error));
    match (plan.kind, plan.member.as_deref()) {
        (ArchiveKind::Binary, None) => std::fs::rename(archive, &target)
            .map_err(|error| filesystem_error("stage", &target, error))?,
        (ArchiveKind::TarGz, Some(member)) => extract_from_tar(
            flate2::read::GzDecoder::new(open()?),
            member,
            &target,
            plan,
            stop,
        )?,
        (ArchiveKind::TarXz, Some(member)) => {
            extract_from_tar(xz_reader(open()?)?, member, &target, plan, stop)?
        }
        (ArchiveKind::Zip, Some(member)) => extract_from_zip(open()?, member, &target, plan, stop)?,
        _ => return Err(invalid("The archive type and member do not agree.")),
    }
    make_executable(&target)
}

#[cfg(not(windows))]
fn xz_reader(file: File) -> Result<impl Read, ToolchainInstallError> {
    let stream = liblzma::stream::Stream::new_stream_decoder(XZ_MEMORY_LIMIT_BYTES, 0)
        .map_err(|error| install_failed(format!("Could not start the XZ decoder: {error}")))?;
    Ok(liblzma::read::XzDecoder::new_stream(file, stream))
}

#[cfg(windows)]
fn xz_reader(_file: File) -> Result<std::io::Empty, ToolchainInstallError> {
    Err(invalid("XZ archives are not supported on Windows."))
}

fn unsafe_member() -> ToolchainInstallError {
    integrity("The archive contains an unsafe member path.")
}

fn link_member() -> ToolchainInstallError {
    integrity("The archive contains a link or another special member.")
}

fn extract_from_tar<R: Read>(
    reader: R,
    member: &[String],
    target: &Path,
    plan: &InstallPlan,
    stop: &StopSignal,
) -> Result<(), ToolchainInstallError> {
    let mut archive = tar::Archive::new(reader);
    let entries = archive.entries().map_err(archive_error)?;
    let mut found = false;
    for (index, entry) in entries.enumerate() {
        if stop.stopped() {
            return Err(cancelled());
        }
        if index >= MAX_ARCHIVE_MEMBERS {
            return Err(integrity("The archive has too many members."));
        }
        let mut entry = entry.map_err(archive_error)?;
        let kind = entry.header().entry_type();
        if kind.is_pax_global_extensions() {
            continue;
        }
        let parts = member_components(&entry.path_bytes()).map_err(|()| unsafe_member())?;
        if !kind.is_file() && !kind.is_dir() {
            return Err(link_member());
        }
        if parts.as_slice() != member {
            continue;
        }
        if found || !kind.is_file() {
            return Err(integrity(
                "The archive holds the pinned member more than once or not as a file.",
            ));
        }
        if entry.size() != plan.binary_size {
            return Err(integrity(
                "The archive member size does not match the pinned binary size.",
            ));
        }
        copy_verified(&mut entry, target, plan, stop)?;
        found = true;
    }
    if found {
        Ok(())
    } else {
        Err(integrity("The archive does not contain the pinned member."))
    }
}

fn extract_from_zip(
    file: File,
    member: &[String],
    target: &Path,
    plan: &InstallPlan,
    stop: &StopSignal,
) -> Result<(), ToolchainInstallError> {
    let mut zip = zip::ZipArchive::new(file).map_err(archive_error)?;
    if zip.len() > MAX_ARCHIVE_MEMBERS {
        return Err(integrity("The archive has too many members."));
    }
    let mut found = false;
    for index in 0..zip.len() {
        if stop.stopped() {
            return Err(cancelled());
        }
        let mut entry = zip.by_index(index).map_err(archive_error)?;
        let parts = member_components(entry.name_raw()).map_err(|()| unsafe_member())?;
        let file_type = entry.unix_mode().map_or(0, |mode| mode & 0o170000);
        if !matches!(file_type, 0 | 0o100000 | 0o040000) {
            return Err(link_member());
        }
        if entry.encrypted() {
            return Err(integrity("The archive contains an encrypted member."));
        }
        if parts.as_slice() != member {
            continue;
        }
        if found || entry.is_dir() || file_type == 0o040000 {
            return Err(integrity(
                "The archive holds the pinned member more than once or not as a file.",
            ));
        }
        if entry.size() != plan.binary_size {
            return Err(integrity(
                "The archive member size does not match the pinned binary size.",
            ));
        }
        copy_verified(&mut entry, target, plan, stop)?;
        found = true;
    }
    if found {
        Ok(())
    } else {
        Err(integrity("The archive does not contain the pinned member."))
    }
}

fn copy_verified(
    reader: &mut dyn Read,
    target: &Path,
    plan: &InstallPlan,
    stop: &StopSignal,
) -> Result<(), ToolchainInstallError> {
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt as _;
        options.mode(0o700);
    }
    let mut output = options
        .open(target)
        .map_err(|error| filesystem_error("create", target, error))?;
    let mut limited = reader.take(plan.binary_size + 1);
    let mut hasher = sha2::Sha256::new();
    let mut buffer = vec![0_u8; COPY_BUFFER_BYTES];
    let mut written = 0_u64;
    loop {
        if stop.stopped() {
            return Err(cancelled());
        }
        let read = limited.read(&mut buffer).map_err(archive_error)?;
        if read == 0 {
            break;
        }
        written += read as u64;
        if written > plan.binary_size {
            return Err(integrity(
                "The extracted binary is larger than its pinned size.",
            ));
        }
        hasher.update(&buffer[..read]);
        output
            .write_all(&buffer[..read])
            .map_err(|error| filesystem_error("write", target, error))?;
    }
    if written != plan.binary_size {
        return Err(integrity(
            "The extracted binary is smaller than its pinned size.",
        ));
    }
    if format!("{:x}", hasher.finalize()) != plan.binary_sha256 {
        return Err(integrity(
            "The extracted binary's SHA-256 does not match the pinned digest.",
        ));
    }
    output
        .sync_all()
        .map_err(|error| filesystem_error("write", target, error))
}

#[cfg(unix)]
fn make_executable(path: &Path) -> Result<(), ToolchainInstallError> {
    use std::os::unix::fs::PermissionsExt as _;
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o755))
        .map_err(|error| filesystem_error("mark as executable", path, error))
}

#[cfg(not(unix))]
fn make_executable(_path: &Path) -> Result<(), ToolchainInstallError> {
    Ok(())
}

fn publish(staging: &Staging, layout: &Layout) -> Result<(), ToolchainInstallError> {
    let payload = staging.payload();
    let destination = &layout.destination;
    let failed = |error| filesystem_error("move the new version into", destination, error);
    match std::fs::symlink_metadata(destination) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            std::fs::rename(&payload, destination).map_err(failed)?;
        }
        Err(error) => return Err(failed(error)),
        Ok(_) => {
            let previous = staging.previous();
            std::fs::rename(destination, &previous).map_err(failed)?;
            if let Err(error) = std::fs::rename(&payload, destination) {
                let _ = std::fs::rename(&previous, destination);
                return Err(failed(error));
            }
        }
    }
    sync_directory(&layout.parent);
    Ok(())
}

#[cfg(unix)]
fn sync_directory(path: &Path) {
    if let Ok(directory) = File::open(path) {
        let _ = directory.sync_all();
    }
}

#[cfg(not(unix))]
fn sync_directory(_path: &Path) {}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::{Body, Bytes};
    use axum::extract::State;
    use axum::http::{header, StatusCode, Uri};
    use axum::response::Response;
    use std::collections::HashMap;
    use std::sync::Mutex;

    const BINARY_NAME: &str = "tool";
    const MEMBER: &str = "tool-fixture/tool";

    #[derive(Clone)]
    enum Route {
        Bytes(Vec<u8>),
        Chunked(Vec<u8>),
        Status(u16),
        Redirect(String),
        Stall { head: Vec<u8>, declared: u64 },
        Gated(Vec<u8>),
    }

    struct FixtureServer {
        routes: Mutex<HashMap<String, Route>>,
        hits: Mutex<HashMap<String, usize>>,
        gate: tokio::sync::watch::Sender<bool>,
    }

    struct TestServer {
        state: Arc<FixtureServer>,
        address: std::net::SocketAddr,
        task: tokio::task::JoinHandle<()>,
    }

    impl Drop for TestServer {
        fn drop(&mut self) {
            self.task.abort();
        }
    }

    impl TestServer {
        async fn start() -> Self {
            let state = Arc::new(FixtureServer {
                routes: Mutex::new(HashMap::new()),
                hits: Mutex::new(HashMap::new()),
                gate: tokio::sync::watch::channel(false).0,
            });
            let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
            let address = listener.local_addr().unwrap();
            let router = axum::Router::new()
                .fallback(serve_fixture)
                .with_state(state.clone());
            let task = tokio::spawn(async move {
                axum::serve(listener, router).await.unwrap();
            });
            Self {
                state,
                address,
                task,
            }
        }

        fn route(&self, path: &str, route: Route) -> String {
            self.state
                .routes
                .lock()
                .unwrap()
                .insert(path.to_string(), route);
            self.url(path)
        }

        fn url(&self, path: &str) -> String {
            format!("http://{}{path}", self.address)
        }

        fn hits(&self, path: &str) -> usize {
            self.state
                .hits
                .lock()
                .unwrap()
                .get(path)
                .copied()
                .unwrap_or(0)
        }

        fn open_gate(&self) {
            self.state.gate.send_replace(true);
        }
    }

    async fn serve_fixture(State(server): State<Arc<FixtureServer>>, uri: Uri) -> Response {
        let path = uri.path().to_string();
        *server.hits.lock().unwrap().entry(path.clone()).or_default() += 1;
        let route = server.routes.lock().unwrap().get(&path).cloned();
        let builder = Response::builder();
        match route {
            None => builder
                .status(StatusCode::NOT_FOUND)
                .body(Body::empty())
                .unwrap(),
            Some(Route::Bytes(bytes)) => builder.body(Body::from(bytes)).unwrap(),
            Some(Route::Chunked(bytes)) => {
                let chunks: Vec<Result<Bytes, std::io::Error>> = bytes
                    .chunks(4096)
                    .map(|chunk| Ok(Bytes::copy_from_slice(chunk)))
                    .collect();
                builder
                    .body(Body::from_stream(futures_util::stream::iter(chunks)))
                    .unwrap()
            }
            Some(Route::Status(code)) => builder
                .status(StatusCode::from_u16(code).unwrap())
                .body(Body::from("fixture failure"))
                .unwrap(),
            Some(Route::Redirect(location)) => builder
                .status(StatusCode::FOUND)
                .header(header::LOCATION, location)
                .body(Body::empty())
                .unwrap(),
            Some(Route::Stall { head, declared }) => {
                use futures_util::StreamExt as _;
                let first =
                    futures_util::stream::iter([Ok::<Bytes, std::io::Error>(Bytes::from(head))]);
                let body = first.chain(futures_util::stream::pending());
                builder
                    .header(header::CONTENT_LENGTH, declared)
                    .body(Body::from_stream(body))
                    .unwrap()
            }
            Some(Route::Gated(bytes)) => {
                let mut gate = server.gate.subscribe();
                let _ = gate.wait_for(|open| *open).await;
                builder.body(Body::from(bytes)).unwrap()
            }
        }
    }

    #[derive(Clone)]
    struct Fixture {
        kind: ArchiveKind,
        archive: Vec<u8>,
        member: Option<String>,
        binary: Vec<u8>,
    }

    fn binary_bytes() -> Vec<u8> {
        let mut bytes = b"#!/bin/sh\necho fixture\n".to_vec();
        let mut state: u32 = 0x1234_5678;
        bytes.extend((0..300_000).map(|_| {
            state ^= state << 13;
            state ^= state >> 17;
            state ^= state << 5;
            (state & 0xff) as u8
        }));
        bytes
    }

    fn sha256_hex(bytes: &[u8]) -> String {
        format!("{:x}", sha2::Sha256::digest(bytes))
    }

    fn tar_with(entries: &[(&str, &[u8])]) -> Vec<u8> {
        let mut builder = tar::Builder::new(Vec::new());
        let mut directory = tar::Header::new_gnu();
        directory.set_entry_type(tar::EntryType::Directory);
        directory.set_size(0);
        directory.set_mode(0o755);
        builder
            .append_data(&mut directory, "tool-fixture/", std::io::empty())
            .unwrap();
        for (path, data) in entries {
            let mut header = tar::Header::new_gnu();
            header.set_size(data.len() as u64);
            header.set_mode(0o755);
            header.set_entry_type(tar::EntryType::Regular);
            builder.append_data(&mut header, path, *data).unwrap();
        }
        builder.into_inner().unwrap()
    }

    fn gzip(bytes: &[u8]) -> Vec<u8> {
        let mut encoder = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::default());
        encoder.write_all(bytes).unwrap();
        encoder.finish().unwrap()
    }

    fn tar_gz_fixture() -> Fixture {
        let binary = binary_bytes();
        let tar = tar_with(&[
            (MEMBER, &binary),
            ("tool-fixture/LICENSE", b"fixture license"),
        ]);
        Fixture {
            kind: ArchiveKind::TarGz,
            archive: gzip(&tar),
            member: Some(MEMBER.into()),
            binary,
        }
    }

    #[cfg(not(windows))]
    fn tar_xz_fixture() -> Fixture {
        let binary = binary_bytes();
        let tar = tar_with(&[
            ("tool-fixture/README.md", b"fixture readme"),
            (MEMBER, &binary),
        ]);
        let mut encoder = liblzma::write::XzEncoder::new(Vec::new(), 6);
        encoder.write_all(&tar).unwrap();
        Fixture {
            kind: ArchiveKind::TarXz,
            archive: encoder.finish().unwrap(),
            member: Some(MEMBER.into()),
            binary,
        }
    }

    fn zip_with(entries: &[(&str, &[u8])]) -> Vec<u8> {
        let mut writer = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
        let options = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated)
            .unix_permissions(0o755);
        writer.add_directory("tool-fixture/", options).unwrap();
        for (path, data) in entries {
            writer.start_file(*path, options).unwrap();
            writer.write_all(data).unwrap();
        }
        writer.finish().unwrap().into_inner()
    }

    fn zip_fixture() -> Fixture {
        let binary = binary_bytes();
        Fixture {
            kind: ArchiveKind::Zip,
            archive: zip_with(&[(MEMBER, &binary), ("tool-fixture/NOTICE", b"notice")]),
            member: Some(MEMBER.into()),
            binary,
        }
    }

    fn binary_fixture() -> Fixture {
        let binary = binary_bytes();
        Fixture {
            kind: ArchiveKind::Binary,
            archive: binary.clone(),
            member: None,
            binary,
        }
    }

    fn quick_timeouts() -> DownloadTimeouts {
        DownloadTimeouts {
            connect: Duration::from_secs(5),
            stall: Duration::from_secs(10),
            total: Duration::from_secs(60),
        }
    }

    fn request_for(root: &Path, fixture: &Fixture, urls: Vec<String>) -> ToolchainInstallRequest {
        ToolchainInstallRequest {
            urls,
            allowed_hosts: vec!["127.0.0.1".into()],
            archive_kind: fixture.kind,
            archive_size: fixture.archive.len() as u64,
            archive_sha256: sha256_hex(&fixture.archive),
            archive_member: fixture.member.clone(),
            binary_size: fixture.binary.len() as u64,
            binary_sha256: sha256_hex(&fixture.binary),
            install_dir: root.join("toolchains").join("tool").join("1.2.3"),
            binary_name: BINARY_NAME.into(),
            timeouts: quick_timeouts(),
        }
    }

    type Recorder = Arc<Mutex<Vec<InstallProgress>>>;

    fn recorder() -> (Recorder, impl Fn(InstallProgress) + Send + Sync + 'static) {
        let events: Recorder = Arc::new(Mutex::new(Vec::new()));
        let sink = events.clone();
        (events, move |event| sink.lock().unwrap().push(event))
    }

    async fn install(
        request: ToolchainInstallRequest,
    ) -> (
        Result<ToolchainInstallOutcome, ToolchainInstallError>,
        Vec<InstallProgress>,
    ) {
        let (events, sink) = recorder();
        let result = install_toolchain(request, CancelToken::new(), sink).await;
        let events = events.lock().unwrap().clone();
        (result, events)
    }

    fn staging_leftovers(request: &ToolchainInstallRequest) -> Vec<String> {
        let staging = request.install_dir.parent().unwrap().join(".staging");
        let Ok(entries) = std::fs::read_dir(staging) else {
            return Vec::new();
        };
        entries
            .filter_map(Result::ok)
            .filter(|entry| entry.file_type().is_ok_and(|kind| kind.is_dir()))
            .map(|entry| entry.file_name().to_string_lossy().into_owned())
            .collect()
    }

    fn assert_nothing_installed(request: &ToolchainInstallRequest) {
        assert!(
            !request.install_dir.exists(),
            "a failed install left {}",
            request.install_dir.display()
        );
        assert_eq!(staging_leftovers(request), Vec::<String>::new());
        assert!(!is_installing(&request.install_dir));
    }

    fn assert_installed(
        request: &ToolchainInstallRequest,
        fixture: &Fixture,
        outcome: &ToolchainInstallOutcome,
    ) {
        let binary = request.install_dir.join(BINARY_NAME);
        assert_eq!(
            std::fs::canonicalize(outcome.binary_path()).unwrap(),
            std::fs::canonicalize(&binary).unwrap()
        );
        assert_eq!(std::fs::read(&binary).unwrap(), fixture.binary);
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt as _;
            let mode = std::fs::metadata(&binary).unwrap().permissions().mode();
            assert_eq!(mode & 0o111, 0o111, "binary is not executable: {mode:o}");
        }
        let entries: Vec<_> = std::fs::read_dir(&request.install_dir)
            .unwrap()
            .map(|entry| entry.unwrap().file_name())
            .collect();
        assert_eq!(entries, vec![std::ffi::OsString::from(BINARY_NAME)]);
        assert_eq!(staging_leftovers(request), Vec::<String>::new());
        assert!(!is_installing(&request.install_dir));
    }

    fn phases(events: &[InstallProgress]) -> Vec<InstallPhase> {
        let mut phases: Vec<InstallPhase> = Vec::new();
        for event in events {
            if phases.last() != Some(&event.phase) {
                phases.push(event.phase);
            }
        }
        phases
    }

    async fn installs_fixture(fixture: Fixture) {
        let server = TestServer::start().await;
        let url = server.route("/asset", Route::Bytes(fixture.archive.clone()));
        let root = tempfile::tempdir().unwrap();
        let request = request_for(root.path(), &fixture, vec![url]);

        let (result, events) = install(request.clone()).await;

        let outcome = result.unwrap();
        assert!(matches!(outcome, ToolchainInstallOutcome::Installed(_)));
        assert_installed(&request, &fixture, &outcome);
        assert_eq!(
            phases(&events),
            vec![
                InstallPhase::Downloading,
                InstallPhase::Verifying,
                InstallPhase::Extracting,
                InstallPhase::Done
            ]
        );
        let size = fixture.archive.len() as u64;
        assert!(events.iter().all(|event| event.total_bytes == size));
        assert!(events
            .windows(2)
            .filter(|pair| pair[0].phase == InstallPhase::Downloading
                && pair[1].phase == InstallPhase::Downloading)
            .all(|pair| pair[0].received_bytes <= pair[1].received_bytes));
        assert_eq!(
            events.last().copied(),
            Some(InstallProgress {
                phase: InstallPhase::Done,
                received_bytes: size,
                total_bytes: size
            })
        );
    }

    #[tokio::test]
    async fn installs_the_member_of_a_tar_gz_archive() {
        installs_fixture(tar_gz_fixture()).await;
    }

    #[cfg(not(windows))]
    #[tokio::test]
    async fn installs_the_member_of_a_tar_xz_archive() {
        installs_fixture(tar_xz_fixture()).await;
    }

    #[tokio::test]
    async fn installs_the_member_of_a_zip_archive() {
        installs_fixture(zip_fixture()).await;
    }

    #[tokio::test]
    async fn installs_a_bare_binary() {
        installs_fixture(binary_fixture()).await;
    }

    #[tokio::test]
    async fn a_failing_mirror_falls_back_to_the_next_url() {
        let fixture = tar_gz_fixture();
        let server = TestServer::start().await;
        let mirror = server.route("/mirror", Route::Status(503));
        let missing = server.url("/missing");
        let github = server.route("/github", Route::Bytes(fixture.archive.clone()));
        let root = tempfile::tempdir().unwrap();
        let request = request_for(root.path(), &fixture, vec![mirror, missing, github]);

        let (result, _) = install(request.clone()).await;

        assert_installed(&request, &fixture, &result.unwrap());
        assert_eq!(server.hits("/mirror"), 1);
        assert_eq!(server.hits("/missing"), 1);
        assert_eq!(server.hits("/github"), 1);
    }

    #[tokio::test]
    async fn a_mirror_serving_the_wrong_bytes_falls_back_to_the_next_url() {
        let fixture = tar_gz_fixture();
        let mut tampered = fixture.archive.clone();
        let last = tampered.len() - 1;
        tampered[last] ^= 0xff;
        let server = TestServer::start().await;
        let mirror = server.route("/mirror", Route::Bytes(tampered));
        let github = server.route("/github", Route::Bytes(fixture.archive.clone()));
        let root = tempfile::tempdir().unwrap();
        let request = request_for(root.path(), &fixture, vec![mirror, github]);

        let (result, events) = install(request.clone()).await;

        assert_installed(&request, &fixture, &result.unwrap());
        assert_eq!(server.hits("/github"), 1);
        assert_eq!(
            events
                .iter()
                .filter(|event| event.phase == InstallPhase::Verifying)
                .count(),
            2
        );
    }

    #[tokio::test]
    async fn a_stalled_mirror_falls_back_to_the_next_url() {
        let fixture = tar_gz_fixture();
        let server = TestServer::start().await;
        let mirror = server.route(
            "/mirror",
            Route::Stall {
                head: fixture.archive[..1024].to_vec(),
                declared: fixture.archive.len() as u64,
            },
        );
        let github = server.route("/github", Route::Bytes(fixture.archive.clone()));
        let root = tempfile::tempdir().unwrap();
        let mut request = request_for(root.path(), &fixture, vec![mirror, github]);
        request.timeouts.stall = Duration::from_millis(500);

        let started = std::time::Instant::now();
        let (result, _) = install(request.clone()).await;

        assert_installed(&request, &fixture, &result.unwrap());
        assert!(started.elapsed() < Duration::from_secs(20));
        assert_eq!(server.hits("/github"), 1);
    }

    #[tokio::test]
    async fn a_wrong_declared_size_is_rejected() {
        let fixture = tar_gz_fixture();
        let server = TestServer::start().await;
        let url = server.route("/asset", Route::Bytes(fixture.archive.clone()));
        let root = tempfile::tempdir().unwrap();
        let mut request = request_for(root.path(), &fixture, vec![url]);
        request.archive_size += 1;

        let (result, _) = install(request.clone()).await;

        let error = result.unwrap_err();
        assert_eq!(error.kind(), ToolchainInstallErrorKind::DownloadFailed);
        assert!(error.message().contains("size"), "{error}");
        assert_nothing_installed(&request);
    }

    #[tokio::test]
    async fn a_body_longer_than_the_pinned_size_is_rejected() {
        let fixture = tar_gz_fixture();
        let server = TestServer::start().await;
        let url = server.route("/asset", Route::Chunked(fixture.archive.clone()));
        let root = tempfile::tempdir().unwrap();
        let mut request = request_for(root.path(), &fixture, vec![url]);
        request.archive_size -= 1;

        let (result, _) = install(request.clone()).await;

        let error = result.unwrap_err();
        assert_eq!(error.kind(), ToolchainInstallErrorKind::DownloadFailed);
        assert!(error.message().contains("size"), "{error}");
        assert_nothing_installed(&request);
    }

    #[tokio::test]
    async fn a_wrong_archive_hash_is_rejected() {
        let fixture = tar_gz_fixture();
        let server = TestServer::start().await;
        let url = server.route("/asset", Route::Bytes(fixture.archive.clone()));
        let root = tempfile::tempdir().unwrap();
        let mut request = request_for(root.path(), &fixture, vec![url]);
        request.archive_sha256 = sha256_hex(b"something else");

        let (result, _) = install(request.clone()).await;

        let error = result.unwrap_err();
        assert_eq!(error.kind(), ToolchainInstallErrorKind::DownloadFailed);
        assert!(error.message().contains("SHA-256"), "{error}");
        assert_nothing_installed(&request);
    }

    #[tokio::test]
    async fn a_wrong_binary_hash_is_rejected_without_trying_other_urls() {
        let fixture = tar_gz_fixture();
        let server = TestServer::start().await;
        let mirror = server.route("/mirror", Route::Bytes(fixture.archive.clone()));
        let github = server.route("/github", Route::Bytes(fixture.archive.clone()));
        let root = tempfile::tempdir().unwrap();
        let mut request = request_for(root.path(), &fixture, vec![mirror, github]);
        request.binary_sha256 = sha256_hex(b"another binary");

        let (result, _) = install(request.clone()).await;

        let error = result.unwrap_err();
        assert_eq!(error.kind(), ToolchainInstallErrorKind::IntegrityFailure);
        assert!(error.message().contains("SHA-256"), "{error}");
        assert_eq!(server.hits("/github"), 0);
        assert_nothing_installed(&request);
    }

    #[tokio::test]
    async fn a_redirect_to_an_unlisted_host_is_refused() {
        let fixture = tar_gz_fixture();
        let server = TestServer::start().await;
        server.route("/asset", Route::Bytes(fixture.archive.clone()));
        let elsewhere = format!("http://localhost:{}/asset", server.address.port());
        let url = server.route("/redirect", Route::Redirect(elsewhere));
        let root = tempfile::tempdir().unwrap();
        let request = request_for(root.path(), &fixture, vec![url]);

        let (result, _) = install(request.clone()).await;

        let error = result.unwrap_err();
        assert_eq!(error.kind(), ToolchainInstallErrorKind::DownloadFailed);
        assert!(error.message().contains("localhost"), "{error}");
        assert_eq!(server.hits("/redirect"), 1);
        assert_eq!(server.hits("/asset"), 0);
        assert_nothing_installed(&request);
    }

    #[tokio::test]
    async fn a_redirect_to_a_listed_host_is_followed() {
        let fixture = tar_gz_fixture();
        let server = TestServer::start().await;
        let asset = server.route("/asset", Route::Bytes(fixture.archive.clone()));
        let url = server.route("/redirect", Route::Redirect(asset));
        let root = tempfile::tempdir().unwrap();
        let request = request_for(root.path(), &fixture, vec![url]);

        let (result, _) = install(request.clone()).await;

        assert_installed(&request, &fixture, &result.unwrap());
        assert_eq!(server.hits("/asset"), 1);
    }

    #[tokio::test]
    async fn a_url_on_an_unlisted_host_is_skipped() {
        let fixture = tar_gz_fixture();
        let server = TestServer::start().await;
        server.route("/asset", Route::Bytes(fixture.archive.clone()));
        let unlisted = format!("http://localhost:{}/asset", server.address.port());
        let listed = server.url("/asset");
        let root = tempfile::tempdir().unwrap();
        let request = request_for(root.path(), &fixture, vec![unlisted, listed]);

        let (result, _) = install(request.clone()).await;

        assert_installed(&request, &fixture, &result.unwrap());
        assert_eq!(server.hits("/asset"), 1);
    }

    fn tar_with_raw_member(name: &[u8], data: &[u8], kind: tar::EntryType) -> Vec<u8> {
        let binary = binary_bytes();
        let mut builder = tar::Builder::new(Vec::new());
        let mut header = tar::Header::new_gnu();
        header.set_size(binary.len() as u64);
        header.set_mode(0o755);
        header.set_entry_type(tar::EntryType::Regular);
        builder
            .append_data(&mut header, MEMBER, &binary[..])
            .unwrap();
        let mut raw = tar::Header::new_gnu();
        raw.set_size(data.len() as u64);
        raw.set_mode(0o644);
        raw.set_entry_type(kind);
        raw.as_gnu_mut().unwrap().name[..name.len()].copy_from_slice(name);
        raw.set_cksum();
        builder.append(&raw, data).unwrap();
        builder.into_inner().unwrap()
    }

    async fn refuses_archive(fixture: Fixture, expected: &str) -> tempfile::TempDir {
        let server = TestServer::start().await;
        let url = server.route("/asset", Route::Bytes(fixture.archive.clone()));
        let root = tempfile::tempdir().unwrap();
        let request = request_for(root.path(), &fixture, vec![url]);

        let (result, _) = install(request.clone()).await;

        let error = result.unwrap_err();
        assert_eq!(error.kind(), ToolchainInstallErrorKind::IntegrityFailure);
        assert!(error.message().contains(expected), "{error}");
        assert_nothing_installed(&request);
        root
    }

    #[tokio::test]
    async fn a_tar_member_that_escapes_the_archive_is_refused() {
        let binary = binary_bytes();
        let archive = gzip(&tar_with_raw_member(
            b"../escape",
            b"payload",
            tar::EntryType::Regular,
        ));
        let fixture = Fixture {
            kind: ArchiveKind::TarGz,
            archive,
            member: Some(MEMBER.into()),
            binary,
        };

        let root = refuses_archive(fixture, "unsafe").await;

        let toolchains = root.path().join("toolchains");
        assert!(!toolchains.join("tool").join("escape").exists());
        assert!(!toolchains.join("escape").exists());
        assert!(!root.path().join("escape").exists());
    }

    #[tokio::test]
    async fn an_absolute_tar_member_is_refused() {
        let binary = binary_bytes();
        let archive = gzip(&tar_with_raw_member(
            b"/tmp/oleafly-escape",
            b"payload",
            tar::EntryType::Regular,
        ));
        let fixture = Fixture {
            kind: ArchiveKind::TarGz,
            archive,
            member: Some(MEMBER.into()),
            binary,
        };

        refuses_archive(fixture, "unsafe").await;
    }

    #[tokio::test]
    async fn a_zip_member_that_escapes_the_archive_is_refused() {
        let binary = binary_bytes();
        let fixture = Fixture {
            kind: ArchiveKind::Zip,
            archive: zip_with(&[(MEMBER, &binary), ("../escape", b"payload")]),
            member: Some(MEMBER.into()),
            binary,
        };

        let root = refuses_archive(fixture, "unsafe").await;

        assert!(!root
            .path()
            .join("toolchains")
            .join("tool")
            .join("escape")
            .exists());
    }

    #[tokio::test]
    async fn a_symlinked_member_is_refused() {
        let binary = binary_bytes();
        let mut builder = tar::Builder::new(Vec::new());
        let mut header = tar::Header::new_gnu();
        header.set_size(0);
        header.set_mode(0o777);
        header.set_entry_type(tar::EntryType::Symlink);
        builder.append_link(&mut header, MEMBER, "LICENSE").unwrap();
        let fixture = Fixture {
            kind: ArchiveKind::TarGz,
            archive: gzip(&builder.into_inner().unwrap()),
            member: Some(MEMBER.into()),
            binary,
        };

        refuses_archive(fixture, "link").await;
    }

    #[tokio::test]
    async fn a_zip_symlink_member_is_refused() {
        let binary = binary_bytes();
        let mut writer = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
        let options = zip::write::SimpleFileOptions::default();
        writer.add_symlink(MEMBER, "LICENSE", options).unwrap();
        let fixture = Fixture {
            kind: ArchiveKind::Zip,
            archive: writer.finish().unwrap().into_inner(),
            member: Some(MEMBER.into()),
            binary,
        };

        refuses_archive(fixture, "link").await;
    }

    #[tokio::test]
    async fn an_archive_without_the_member_is_refused() {
        let binary = binary_bytes();
        let fixture = Fixture {
            kind: ArchiveKind::TarGz,
            archive: gzip(&tar_with(&[("tool-fixture/other", &binary)])),
            member: Some(MEMBER.into()),
            binary,
        };

        refuses_archive(fixture, "does not contain").await;
    }

    #[tokio::test]
    async fn cancelling_mid_download_leaves_nothing_behind() {
        let fixture = tar_gz_fixture();
        let server = TestServer::start().await;
        let url = server.route(
            "/asset",
            Route::Stall {
                head: fixture.archive[..2048].to_vec(),
                declared: fixture.archive.len() as u64,
            },
        );
        let root = tempfile::tempdir().unwrap();
        let request = request_for(root.path(), &fixture, vec![url]);
        let cancel = CancelToken::new();
        let trigger = cancel.clone();
        let saw_bytes = Arc::new(std::sync::atomic::AtomicBool::new(false));
        let saw = saw_bytes.clone();

        let result = tokio::time::timeout(
            Duration::from_secs(10),
            install_toolchain(request.clone(), cancel.clone(), move |event| {
                if event.phase == InstallPhase::Downloading && event.received_bytes > 0 {
                    saw.store(true, std::sync::atomic::Ordering::SeqCst);
                    trigger.cancel();
                }
            }),
        )
        .await
        .expect("cancellation did not stop the download");

        assert!(saw_bytes.load(std::sync::atomic::Ordering::SeqCst));
        assert!(cancel.is_cancelled());
        assert_eq!(
            result.unwrap_err().kind(),
            ToolchainInstallErrorKind::Cancelled
        );
        assert_nothing_installed(&request);
    }

    #[tokio::test]
    async fn an_already_cancelled_token_never_downloads() {
        let fixture = tar_gz_fixture();
        let server = TestServer::start().await;
        let url = server.route("/asset", Route::Bytes(fixture.archive.clone()));
        let root = tempfile::tempdir().unwrap();
        let request = request_for(root.path(), &fixture, vec![url]);
        let cancel = CancelToken::new();
        cancel.cancel();

        let result = install_toolchain(request.clone(), cancel, |_| {}).await;

        assert_eq!(
            result.unwrap_err().kind(),
            ToolchainInstallErrorKind::Cancelled
        );
        assert_eq!(server.hits("/asset"), 0);
        assert_nothing_installed(&request);
    }

    async fn wait_for_hits(server: &TestServer, path: &str) {
        tokio::time::timeout(Duration::from_secs(10), async {
            while server.hits(path) == 0 {
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .unwrap();
    }

    #[tokio::test]
    async fn a_background_install_does_not_hold_up_quitting_or_updating() {
        let fixture = tar_gz_fixture();
        let server = TestServer::start().await;
        let url = server.route("/asset", Route::Gated(fixture.archive.clone()));
        let root = tempfile::tempdir().unwrap();
        let request = request_for(root.path(), &fixture, vec![url]);

        let running = tokio::spawn(install_toolchain_in_background(request.clone(), |_| {}));
        wait_for_hits(&server, "/asset").await;

        assert!(is_installing(&request.install_dir));
        assert!(background_install_in_progress());
        assert!(!install_in_progress());
        assert!(!crate::latex_engine::install_in_progress());

        assert_eq!(cancel_background_installs().len(), 1);
        let result = running.await.unwrap();
        assert_eq!(
            result.unwrap_err().kind(),
            ToolchainInstallErrorKind::Cancelled
        );
        assert!(!background_install_in_progress());
        assert_nothing_installed(&request);
    }

    #[tokio::test]
    async fn quitting_abandons_background_installs_and_keeps_user_installs() {
        let fixture = tar_gz_fixture();
        let server = TestServer::start().await;
        let url = server.route("/asset", Route::Gated(fixture.archive.clone()));
        let root = tempfile::tempdir().unwrap();
        let user = request_for(root.path(), &fixture, vec![url.clone()]);
        let mut background = user.clone();
        background.install_dir = user.install_dir.with_file_name("1.2.4");

        let user_install =
            tokio::spawn(install_toolchain(user.clone(), CancelToken::new(), |_| {}));
        let background_install =
            tokio::spawn(install_toolchain_in_background(background.clone(), |_| {}));
        tokio::time::timeout(Duration::from_secs(10), async {
            while server.hits("/asset") < 2 {
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .unwrap();
        assert!(staging_leftovers(&background)
            .iter()
            .any(|name| name.starts_with("1.2.4-")));

        abandon_background_installs(Duration::ZERO);

        assert!(staging_leftovers(&background)
            .iter()
            .all(|name| !name.starts_with("1.2.4-")));
        server.open_gate();
        let outcome = user_install.await.unwrap().unwrap();
        assert_installed(&user, &fixture, &outcome);
        assert_eq!(
            background_install.await.unwrap().unwrap_err().kind(),
            ToolchainInstallErrorKind::Cancelled
        );
        assert_nothing_installed(&background);
    }

    #[tokio::test]
    async fn concurrent_installs_of_one_version_are_serialized() {
        let fixture = tar_gz_fixture();
        let server = TestServer::start().await;
        let url = server.route("/asset", Route::Gated(fixture.archive.clone()));
        let root = tempfile::tempdir().unwrap();
        let request = request_for(root.path(), &fixture, vec![url]);

        let first = tokio::spawn(install_toolchain(
            request.clone(),
            CancelToken::new(),
            |_| {},
        ));
        tokio::time::timeout(Duration::from_secs(10), async {
            while server.hits("/asset") == 0 {
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .unwrap();
        assert!(is_installing(&request.install_dir));
        assert!(install_in_progress());
        assert!(crate::latex_engine::install_in_progress());

        let (second, _) = install(request.clone()).await;
        let error = second.unwrap_err();
        assert_eq!(error.kind(), ToolchainInstallErrorKind::AlreadyInstalling);
        assert!(
            error.message().contains("already being installed"),
            "{error}"
        );

        server.open_gate();
        let outcome = first.await.unwrap().unwrap();
        assert!(matches!(outcome, ToolchainInstallOutcome::Installed(_)));
        assert_installed(&request, &fixture, &outcome);

        let (third, events) = install(request.clone()).await;
        let third = third.unwrap();
        assert!(matches!(
            third,
            ToolchainInstallOutcome::AlreadyInstalled(_)
        ));
        assert_eq!(third.binary_path(), outcome.binary_path());
        assert_eq!(server.hits("/asset"), 1);
        assert_eq!(phases(&events), vec![InstallPhase::Done]);
    }

    #[tokio::test]
    async fn different_versions_install_side_by_side() {
        let fixture = tar_gz_fixture();
        let server = TestServer::start().await;
        let url = server.route("/asset", Route::Bytes(fixture.archive.clone()));
        let root = tempfile::tempdir().unwrap();
        let first = request_for(root.path(), &fixture, vec![url.clone()]);
        let mut second = first.clone();
        second.install_dir = first.install_dir.with_file_name("1.2.3-rc1");

        let (a, b) = tokio::join!(install(first.clone()), install(second.clone()));

        assert_installed(&first, &fixture, &a.0.unwrap());
        assert_installed(&second, &fixture, &b.0.unwrap());
    }

    #[tokio::test]
    async fn leftovers_of_an_interrupted_install_are_swept() {
        let fixture = tar_gz_fixture();
        let server = TestServer::start().await;
        let url = server.route("/asset", Route::Bytes(fixture.archive.clone()));
        let root = tempfile::tempdir().unwrap();
        let request = request_for(root.path(), &fixture, vec![url]);
        let staging = request.install_dir.parent().unwrap().join(".staging");
        let stale = staging.join(format!("1.2.3-{}", "a".repeat(32)));
        std::fs::create_dir_all(stale.join("payload")).unwrap();
        std::fs::write(stale.join("archive"), b"partial").unwrap();
        let unrelated = staging.join(format!("1.2.3-rc1-{}", "b".repeat(32)));
        std::fs::create_dir_all(&unrelated).unwrap();

        let (result, _) = install(request.clone()).await;

        result.unwrap();
        assert!(!stale.exists());
        assert!(unrelated.exists());
    }

    #[tokio::test]
    async fn a_corrupt_install_is_replaced() {
        let fixture = tar_gz_fixture();
        let server = TestServer::start().await;
        let url = server.route("/asset", Route::Bytes(fixture.archive.clone()));
        let root = tempfile::tempdir().unwrap();
        let request = request_for(root.path(), &fixture, vec![url]);
        std::fs::create_dir_all(&request.install_dir).unwrap();
        std::fs::write(request.install_dir.join(BINARY_NAME), b"truncated").unwrap();
        std::fs::write(request.install_dir.join("stray"), b"stray").unwrap();

        let (result, _) = install(request.clone()).await;

        let outcome = result.unwrap();
        assert!(matches!(outcome, ToolchainInstallOutcome::Installed(_)));
        assert_installed(&request, &fixture, &outcome);
    }

    type RequestEdit = Box<dyn Fn(&mut ToolchainInstallRequest)>;

    #[tokio::test]
    async fn invalid_requests_are_refused_before_any_download() {
        let fixture = tar_gz_fixture();
        let server = TestServer::start().await;
        let url = server.route("/asset", Route::Bytes(fixture.archive.clone()));
        let root = tempfile::tempdir().unwrap();
        let valid = request_for(root.path(), &fixture, vec![url]);
        let cases: Vec<(&str, RequestEdit)> = vec![
            ("no urls", Box::new(|r| r.urls.clear())),
            ("no hosts", Box::new(|r| r.allowed_hosts.clear())),
            ("zero size", Box::new(|r| r.archive_size = 0)),
            ("bad digest", Box::new(|r| r.archive_sha256 = "abc".into())),
            (
                "bad binary digest",
                Box::new(|r| r.binary_sha256 = "z".repeat(64)),
            ),
            ("missing member", Box::new(|r| r.archive_member = None)),
            (
                "escaping member",
                Box::new(|r| r.archive_member = Some("../tool".into())),
            ),
            (
                "binary with member",
                Box::new(|r| {
                    r.archive_kind = ArchiveKind::Binary;
                    r.archive_member = Some(MEMBER.into());
                }),
            ),
            (
                "relative dir",
                Box::new(|r| r.install_dir = PathBuf::from("rel/1.0")),
            ),
            (
                "hidden dir",
                Box::new(|r| r.install_dir = r.install_dir.with_file_name(".staging")),
            ),
            (
                "nested binary",
                Box::new(|r| r.binary_name = "bin/tool".into()),
            ),
            ("dot binary", Box::new(|r| r.binary_name = "..".into())),
        ];
        for (label, mutate) in cases {
            let mut request = valid.clone();
            mutate(&mut request);
            let (result, _) = install(request.clone()).await;
            let error = result.expect_err(label);
            assert_eq!(
                error.kind(),
                ToolchainInstallErrorKind::InvalidRequest,
                "{label}: {error}"
            );
        }
        assert_eq!(server.hits("/asset"), 0);
        assert!(!valid.install_dir.exists());
    }

    #[test]
    fn archive_kinds_parse_from_the_catalog_names() {
        assert_eq!(ArchiveKind::parse("tar.xz"), Some(ArchiveKind::TarXz));
        assert_eq!(ArchiveKind::parse("tar.gz"), Some(ArchiveKind::TarGz));
        assert_eq!(ArchiveKind::parse("zip"), Some(ArchiveKind::Zip));
        assert_eq!(ArchiveKind::parse("binary"), Some(ArchiveKind::Binary));
        assert_eq!(ArchiveKind::parse("tar.bz2"), None);
    }

    #[test]
    fn progress_serializes_in_the_contract_shape() {
        let value = serde_json::to_value(InstallProgress {
            phase: InstallPhase::Extracting,
            received_bytes: 3,
            total_bytes: 9,
        })
        .unwrap();
        assert_eq!(
            value,
            serde_json::json!({"phase": "extracting", "receivedBytes": 3, "totalBytes": 9})
        );
    }

    fn running_target() -> &'static str {
        if cfg!(all(target_arch = "aarch64", target_os = "macos")) {
            "aarch64-apple-darwin"
        } else if cfg!(all(target_arch = "aarch64", target_os = "linux")) {
            "aarch64-unknown-linux-gnu"
        } else if cfg!(all(target_arch = "x86_64", target_os = "linux")) {
            "x86_64-unknown-linux-gnu"
        } else if cfg!(all(target_arch = "x86_64", target_os = "windows")) {
            "x86_64-pc-windows-msvc"
        } else {
            panic!("no catalog target for this platform")
        }
    }

    async fn installs_real_typst(url_keys: &[&str]) {
        let catalog: serde_json::Value =
            serde_json::from_str(include_str!("../resources/typst-toolchain.json")).unwrap();
        let version = catalog["typst"]["versions"]
            .as_array()
            .unwrap()
            .iter()
            .find(|entry| entry["version"] == "0.13.1")
            .unwrap();
        let target = &version["targets"][running_target()];
        let text = |key: &str| target[key].as_str().unwrap().to_string();
        let binary_name = if cfg!(windows) { "typst.exe" } else { "typst" };
        let root = tempfile::tempdir().unwrap();
        let request = ToolchainInstallRequest {
            urls: url_keys.iter().map(|key| text(key)).collect(),
            allowed_hosts: catalog["allowedDownloadHosts"]
                .as_array()
                .unwrap()
                .iter()
                .map(|host| host.as_str().unwrap().to_string())
                .collect(),
            archive_kind: ArchiveKind::parse(&text("archiveType")).unwrap(),
            archive_size: target["archiveSize"].as_u64().unwrap(),
            archive_sha256: text("archiveSha256"),
            archive_member: target["archiveMember"].as_str().map(str::to_string),
            binary_size: target["binarySize"].as_u64().unwrap(),
            binary_sha256: text("binarySha256"),
            install_dir: root.path().join("toolchains").join("typst").join("0.13.1"),
            binary_name: binary_name.into(),
            timeouts: DownloadTimeouts::default(),
        };

        let (result, events) = install(request.clone()).await;

        let outcome = result.unwrap();
        assert!(matches!(outcome, ToolchainInstallOutcome::Installed(_)));
        assert_eq!(events.last().unwrap().phase, InstallPhase::Done);
        let output = std::process::Command::new(outcome.binary_path())
            .arg("--version")
            .output()
            .unwrap();
        let stdout = String::from_utf8_lossy(&output.stdout);
        assert!(output.status.success(), "{stdout}");
        assert!(stdout.contains("0.13.1"), "{stdout}");
        assert_eq!(staging_leftovers(&request), Vec::<String>::new());
    }

    #[tokio::test]
    #[ignore = "downloads Typst 0.13.1 from the network"]
    async fn installs_typst_from_the_real_catalog() {
        installs_real_typst(&["mirrorUrl", "githubUrl"]).await;
    }

    #[tokio::test]
    #[ignore = "downloads Typst 0.13.1 from the network"]
    async fn installs_typst_through_the_real_github_redirect() {
        installs_real_typst(&["githubUrl"]).await;
    }
}
