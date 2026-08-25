//! Optional LuaLaTeX engine for tagged, accessible (PDF/UA) export.
//!
//! Tectonic (the bundled default) is XeTeX-based and cannot produce tagged
//! PDFs. Tagged output needs LuaLaTeX + TeX Live 2025 or newer. Rather than
//! bundle a heavy toolchain by default, we mirror the Pandoc model: detect an
//! engine the user already has, and otherwise offer an on-demand TinyTeX
//! install (a ~250MB TeX Live that installs to the user's home dir with no
//! admin rights and manages packages with `tlmgr`). Everything here is opt-in
//! and deletable from Settings.

use crate::paths;
use crate::proc::NoConsole;
use crate::state::AppState;
use crate::tinytex_archive::{ArchiveFormat, ArchiveMemberPolicy};
use std::path::{Path, PathBuf};

/// Pinned rstudio/tinytex-releases tag. A fixed monthly release, never the
const TINYTEX_TAG: &str = "v2026.08";

#[derive(Clone, serde::Serialize)]
pub struct EngineInfo {
    /// "system" (found on PATH / a standard TeX Live), "tinytex" (our install), or "none".
    pub kind: String,
    pub lualatex: Option<String>,
    pub tlmgr: Option<String>,
    pub version: Option<String>,
    /// A usable `latexmk` from any detected distribution. Present even when
    /// `kind` is "none" (a distro can lack lualatex yet still drive latexmk).
    pub latexmk: Option<String>,
}

impl EngineInfo {
    fn none() -> Self {
        EngineInfo {
            kind: "none".into(),
            lualatex: None,
            tlmgr: None,
            version: None,
            latexmk: find_latexmk(),
        }
    }
}

/// A `latexmk` from any detected TeX distribution (stat-only probe).
fn find_latexmk() -> Option<String> {
    crate::tex_distro::find_tex_tool("latexmk").map(|p| p.to_string_lossy().into_owned())
}

const TEX_PROBE_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(10);
const TLMGR_INFO_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(90);
const TLMGR_MUTATION_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(15 * 60);
const UTILITY_PIPE_DRAIN_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(2);
const UTILITY_CLEANUP_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(2);
const MAX_UTILITY_OUTPUT_BYTES: usize = 8 * 1024 * 1024;

#[derive(Debug)]
struct TexUtilityOutput {
    success: bool,
    stdout: String,
    stderr: String,
}

async fn read_utility_pipe<R>(reader: R) -> Result<(Vec<u8>, bool), String>
where
    R: tokio::io::AsyncRead + Unpin,
{
    use tokio::io::AsyncReadExt as _;
    let mut bytes = Vec::new();
    reader
        .take((MAX_UTILITY_OUTPUT_BYTES + 1) as u64)
        .read_to_end(&mut bytes)
        .await
        .map_err(|e| format!("failed reading TeX utility output: {e}"))?;
    let truncated = bytes.len() > MAX_UTILITY_OUTPUT_BYTES;
    bytes.truncate(MAX_UTILITY_OUTPUT_BYTES);
    Ok((bytes, truncated))
}

async fn run_tex_utility(
    program: &Path,
    args: &[String],
    timeout: std::time::Duration,
) -> Result<TexUtilityOutput, String> {
    run_tex_utility_with_pipe_timeout(program, args, timeout, UTILITY_PIPE_DRAIN_TIMEOUT).await
}

async fn run_tex_utility_with_pipe_timeout(
    program: &Path,
    args: &[String],
    timeout: std::time::Duration,
    pipe_drain_timeout: std::time::Duration,
) -> Result<TexUtilityOutput, String> {
    let mut utility = spawn_tex_utility(program, args).await?;
    let status = wait_for_utility(&mut utility.child, utility.process_id, program, timeout).await;
    let status = match status {
        Ok(status) => status,
        Err(error) => {
            abort_pipe_tasks(utility.stdout, utility.stderr).await;
            return Err(error);
        }
    };
    let (stdout_result, stderr_result) = drain_utility_pipes(
        utility.stdout,
        utility.stderr,
        utility.process_id,
        program,
        pipe_drain_timeout,
    )
    .await?;
    let (stdout, stdout_truncated) =
        stdout_result.map_err(|e| format!("failed joining TeX utility output task: {e}"))??;
    let (stderr, stderr_truncated) =
        stderr_result.map_err(|e| format!("failed joining TeX utility error task: {e}"))??;
    if stdout_truncated || stderr_truncated {
        return Err(format!(
            "{} produced more than {} MiB of output and was rejected",
            program.display(),
            MAX_UTILITY_OUTPUT_BYTES / (1024 * 1024)
        ));
    }
    Ok(TexUtilityOutput {
        success: status.success(),
        stdout: String::from_utf8_lossy(&stdout).into_owned(),
        stderr: String::from_utf8_lossy(&stderr).into_owned(),
    })
}

type UtilityPipeTask = tokio::task::JoinHandle<Result<(Vec<u8>, bool), String>>;

struct SpawnedUtility {
    child: tokio::process::Child,
    process_id: u32,
    _containment: crate::proc::ProcessTreeGuard,
    stdout: UtilityPipeTask,
    stderr: UtilityPipeTask,
}

async fn spawn_tex_utility(program: &Path, args: &[String]) -> Result<SpawnedUtility, String> {
    let mut command = tex_utility_command(program, args);
    let mut child = command
        .spawn()
        .map_err(|e| format!("failed to run {}: {e}", program.display()))?;
    let process_id = match child.id() {
        Some(pid) => pid,
        None => {
            let _ = child.start_kill();
            return Err(format!(
                "spawned TeX utility {} did not expose a process id",
                program.display()
            ));
        }
    };
    let containment = match crate::proc::contain_process_tree(process_id) {
        Ok(containment) => containment,
        Err(error) => {
            let _ = tokio::time::timeout(
                UTILITY_CLEANUP_TIMEOUT,
                crate::proc::terminate_process_tree(process_id),
            )
            .await;
            let _ = child.start_kill();
            let _ = tokio::time::timeout(UTILITY_CLEANUP_TIMEOUT, child.wait()).await;
            return Err(format!(
                "failed to contain TeX utility process tree for {}: {error}",
                program.display()
            ));
        }
    };
    let stdout = child.stdout.take().ok_or("stdout was not captured")?;
    let stderr = child.stderr.take().ok_or("stderr was not captured")?;
    Ok(SpawnedUtility {
        child,
        process_id,
        _containment: containment,
        stdout: tokio::spawn(read_utility_pipe(stdout)),
        stderr: tokio::spawn(read_utility_pipe(stderr)),
    })
}

fn tex_utility_command(program: &Path, args: &[String]) -> tokio::process::Command {
    use std::process::Stdio;

    let mut command = tokio::process::Command::new(program);
    command
        .no_console()
        .args(args)
        .env("PATH", crate::biber_toolchain::tool_path_env(program))
        .env("NoDefaultCurrentDirectoryInExePath", "1")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    crate::proc::isolate_process_tree(&mut command);
    command
}

async fn stop_utility(child: &mut tokio::process::Child, process_id: u32) {
    let _ = tokio::time::timeout(
        UTILITY_CLEANUP_TIMEOUT,
        crate::proc::terminate_process_tree(process_id),
    )
    .await;
    let _ = child.start_kill();
    let _ = tokio::time::timeout(UTILITY_CLEANUP_TIMEOUT, child.wait()).await;
}

async fn wait_for_utility(
    child: &mut tokio::process::Child,
    process_id: u32,
    program: &Path,
    timeout: std::time::Duration,
) -> Result<std::process::ExitStatus, String> {
    match tokio::time::timeout(timeout, child.wait()).await {
        Ok(Ok(status)) => Ok(status),
        Ok(Err(error)) => {
            stop_utility(child, process_id).await;
            Err(format!("failed waiting for {}: {error}", program.display()))
        }
        Err(_) => {
            stop_utility(child, process_id).await;
            Err(format!(
                "{} timed out after {} seconds and was stopped",
                program.display(),
                timeout.as_secs()
            ))
        }
    }
}

async fn abort_pipe_tasks(stdout: UtilityPipeTask, stderr: UtilityPipeTask) {
    stdout.abort();
    stderr.abort();
    let _ = stdout.await;
    let _ = stderr.await;
}

async fn drain_utility_pipes(
    mut stdout: UtilityPipeTask,
    mut stderr: UtilityPipeTask,
    process_id: u32,
    program: &Path,
    timeout: std::time::Duration,
) -> Result<
    (
        Result<Result<(Vec<u8>, bool), String>, tokio::task::JoinError>,
        Result<Result<(Vec<u8>, bool), String>, tokio::task::JoinError>,
    ),
    String,
> {
    match tokio::time::timeout(timeout, async { tokio::join!(&mut stdout, &mut stderr) }).await {
        Ok(results) => Ok(results),
        Err(_) => {
            let _ = tokio::time::timeout(
                UTILITY_CLEANUP_TIMEOUT,
                crate::proc::terminate_process_tree(process_id),
            )
            .await;
            abort_pipe_tasks(stdout, stderr).await;
            Err(format!(
                "{} exited but its output pipes did not close within {} seconds. Its process tree was stopped.",
                program.display(),
                timeout.as_secs_f64()
            ))
        }
    }
}

fn utility_error(output: &TexUtilityOutput) -> String {
    let stderr = output.stderr.trim();
    if !stderr.is_empty() {
        stderr.to_string()
    } else {
        output.stdout.trim().to_string()
    }
}

/// Search `root` for `bin/<platform>/<name>` (TeX distributions nest binaries
/// under a per-platform directory). Bounded, non-recursive beyond that shape.
fn find_in_texdir(root: &Path, name: &str) -> Option<PathBuf> {
    crate::tex_distro::texdir_bin_dirs(root)
        .into_iter()
        .find_map(|bin| crate::tex_distro::find_tool_in_dir(&bin, name))
}

/// Our own TinyTeX install root: `~/.oleafly/tinytex`.
fn tinytex_root() -> Result<PathBuf, String> {
    Ok(paths::oleafly_root()?.join("tinytex"))
}

fn tinytex_staging_root() -> Result<PathBuf, String> {
    Ok(paths::oleafly_root()?.join("tinytex.installing"))
}

fn tinytex_backup_root() -> Result<PathBuf, String> {
    Ok(paths::oleafly_root()?.join("tinytex.previous"))
}

fn tinytex_download_path() -> Result<PathBuf, String> {
    Ok(paths::oleafly_root()?.join(DOWNLOAD_TMP))
}

fn legacy_tinytex_download_path() -> Result<PathBuf, String> {
    Ok(tinytex_root()?.join(DOWNLOAD_TMP))
}

fn sibling_tool(tool: &Path, name: &str) -> Option<PathBuf> {
    crate::tex_distro::find_tool_in_dir(tool.parent()?, name)
}

fn engine_kind_for_path(lualatex: &Path, managed_root: Option<&Path>) -> &'static str {
    if managed_root.is_some_and(|root| lualatex.starts_with(root)) {
        "tinytex"
    } else {
        "system"
    }
}

async fn engine_info_for_lualatex_unlocked(lualatex: PathBuf, kind: &str) -> Option<EngineInfo> {
    let path = lualatex.to_string_lossy().into_owned();
    let output = run_tex_utility(&lualatex, &["--version".to_string()], TEX_PROBE_TIMEOUT)
        .await
        .ok()?;
    if !output.success {
        return None;
    }
    Some(EngineInfo {
        kind: kind.to_string(),
        version: output
            .stdout
            .lines()
            .next()
            .map(|line| line.trim().to_string()),
        tlmgr: sibling_tool(&lualatex, "tlmgr").map(|p| p.to_string_lossy().into_owned()),
        latexmk: sibling_tool(&lualatex, "latexmk")
            .map(|p| p.to_string_lossy().into_owned())
            .or_else(find_latexmk),
        lualatex: Some(path),
    })
}

async fn engine_info_for_lualatex(lualatex: PathBuf, kind: &str) -> Option<EngineInfo> {
    let _runtime = acquire_tex_runtime_read().ok()?;
    engine_info_for_lualatex_unlocked(lualatex, kind).await
}

async fn find_engine() -> EngineInfo {
    if let Ok(_recovery) = TinytexMutationGuard::acquire_maintenance() {
        if let Ok(_runtime) = acquire_tex_runtime_write() {
            let _ = recover_interrupted_publish();
        }
    }
    let managed_root = tinytex_root().ok();
    for lualatex in crate::tex_distro::tex_tool_candidates("lualatex") {
        let kind = engine_kind_for_path(&lualatex, managed_root.as_deref());
        if let Some(info) = engine_info_for_lualatex(lualatex, kind).await {
            return info;
        }
    }
    EngineInfo::none()
}

// These commands run external processes (lualatex/tlmgr) which can take a second
// or more. They are `async` and use `spawn_blocking` so they run OFF the main
// thread; a synchronous Tauri command would block the whole webview UI.

#[tauri::command]
pub async fn latex_engine_info() -> EngineInfo {
    find_engine().await
}

#[tauri::command]
pub async fn has_tagging_engine() -> bool {
    find_engine().await.lualatex.is_some()
}

// --- TinyTeX install machinery -----------------------------------------------
//
// The install is long (200 MB+ download, large extraction) and must survive
// user impatience: progress is phased, the partial download resumes across
// failures and app launches, and quitting mid-install is intercepted so the
// user decides deliberately.

use std::sync::atomic::{AtomicBool, Ordering};

static TINYTEX_MUTATION_ACTIVE: AtomicBool = AtomicBool::new(false);
static INSTALL_ACTIVE: AtomicBool = AtomicBool::new(false);
static QUIT_CONFIRMED: AtomicBool = AtomicBool::new(false);

/// True while a TinyTeX download/extract is running (drives quit interception).
pub fn install_in_progress() -> bool {
    INSTALL_ACTIVE.load(Ordering::SeqCst)
}

/// True once the user explicitly confirmed quitting mid-install.
pub fn quit_confirmed() -> bool {
    QUIT_CONFIRMED.load(Ordering::SeqCst)
}

/// The user confirmed the "quit during install?" dialog: let the close
/// through — as a restart when that is what started this quit sequence.
#[tauri::command]
pub fn confirm_quit_during_install(app: tauri::AppHandle) {
    QUIT_CONFIRMED.store(true, Ordering::SeqCst);
    if crate::quit_gate::restart_pending() {
        app.request_restart();
    } else {
        app.exit(0);
    }
}

struct TinytexMutationGuard {
    installing: bool,
    process_lock: Option<TinytexProcessLock>,
}

#[derive(Debug)]
struct TinytexProcessLock {
    file: std::fs::File,
}

#[derive(Debug)]
pub(crate) struct TexRuntimeLock {
    file: std::fs::File,
}

fn lock_file(file: &std::fs::File, exclusive: bool, conflict: &str) -> Result<(), String> {
    let result = if exclusive {
        fs4::FileExt::try_lock(file)
    } else {
        fs4::FileExt::try_lock_shared(file)
    };
    result.map_err(|error| format!("{conflict}: {error}"))
}

fn unlock_file(file: &std::fs::File) {
    let _ = fs4::FileExt::unlock(file);
}

impl Drop for TinytexProcessLock {
    fn drop(&mut self) {
        unlock_file(&self.file);
    }
}

impl Drop for TexRuntimeLock {
    fn drop(&mut self) {
        unlock_file(&self.file);
    }
}

fn acquire_tex_runtime_lock(exclusive: bool) -> Result<TexRuntimeLock, String> {
    let root = paths::oleafly_root()?;
    std::fs::create_dir_all(&root)
        .map_err(|error| format!("failed to create Oleafly data directory: {error}"))?;
    let path = root.join(".tex-runtime.lock");
    let mut options = std::fs::OpenOptions::new();
    options.read(true).write(true).create(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt as _;
        options.mode(0o600);
    }
    let file = options
        .open(&path)
        .map_err(|error| format!("failed to open the TeX runtime lock: {error}"))?;
    crate::fsperm::harden_file(&path);
    lock_file(
        &file,
        exclusive,
        "a TeX compile or package operation is active in another Oleafly process",
    )?;
    Ok(TexRuntimeLock { file })
}

pub(crate) fn acquire_tex_runtime_read() -> Result<TexRuntimeLock, String> {
    acquire_tex_runtime_lock(false)
}

fn acquire_tex_runtime_write() -> Result<TexRuntimeLock, String> {
    acquire_tex_runtime_lock(true)
}

fn acquire_tinytex_process_lock() -> Result<TinytexProcessLock, String> {
    let root = paths::oleafly_root()?;
    std::fs::create_dir_all(&root)
        .map_err(|error| format!("failed to create Oleafly data directory: {error}"))?;
    let path = root.join(".tinytex.lock");
    let mut options = std::fs::OpenOptions::new();
    options.read(true).write(true).create(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt as _;
        options.mode(0o600);
    }
    let file = options
        .open(&path)
        .map_err(|error| format!("failed to open the TinyTeX transaction lock: {error}"))?;
    crate::fsperm::harden_file(&path);
    lock_file(
        &file,
        true,
        "another Oleafly process is already changing TinyTeX",
    )?;
    Ok(TinytexProcessLock { file })
}

impl TinytexMutationGuard {
    fn acquire(installing: bool) -> Result<Self, String> {
        TINYTEX_MUTATION_ACTIVE
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .map_err(|_| "A TinyTeX install or removal is already in progress.".to_string())?;
        let lock_file = match acquire_tinytex_process_lock() {
            Ok(file) => file,
            Err(error) => {
                TINYTEX_MUTATION_ACTIVE.store(false, Ordering::SeqCst);
                return Err(error);
            }
        };
        if installing {
            INSTALL_ACTIVE.store(true, Ordering::SeqCst);
        }
        Ok(TinytexMutationGuard {
            installing,
            process_lock: Some(lock_file),
        })
    }

    fn acquire_install() -> Result<Self, String> {
        Self::acquire(true)
    }

    fn acquire_maintenance() -> Result<Self, String> {
        Self::acquire(false)
    }
}

impl Drop for TinytexMutationGuard {
    fn drop(&mut self) {
        drop(self.process_lock.take());
        if self.installing {
            INSTALL_ACTIVE.store(false, Ordering::SeqCst);
        }
        TINYTEX_MUTATION_ACTIVE.store(false, Ordering::SeqCst);
    }
}

/// One progress event for the whole install. `phase` is "download",
/// "extract", or "packages"; totals are only meaningful for the download.
#[derive(Clone, serde::Serialize)]
struct EngineProgress {
    phase: &'static str,
    received: u64,
    total: Option<u64>,
}

/// Bytes of free disk space at `path`'s filesystem, when the OS can tell us.
fn free_disk_space(path: &Path) -> Option<u64> {
    #[cfg(unix)]
    {
        use std::os::unix::ffi::OsStrExt;
        let c_path = std::ffi::CString::new(path.as_os_str().as_bytes()).ok()?;
        let mut stat: libc::statvfs = unsafe { std::mem::zeroed() };
        if unsafe { libc::statvfs(c_path.as_ptr(), &mut stat) } != 0 {
            return None;
        }
        // f_bavail: blocks available to unprivileged users.
        Some(stat.f_bavail as u64 * stat.f_frsize as u64)
    }
    #[cfg(windows)]
    {
        use std::os::windows::ffi::OsStrExt;
        let mut wide: Vec<u16> = path.as_os_str().encode_wide().collect();
        wide.push(0);
        let mut available: u64 = 0;
        let ok = unsafe {
            windows_sys::Win32::Storage::FileSystem::GetDiskFreeSpaceExW(
                wide.as_ptr(),
                &mut available,
                std::ptr::null_mut(),
                std::ptr::null_mut(),
            )
        };
        (ok != 0).then_some(available)
    }
    #[cfg(not(any(unix, windows)))]
    {
        let _ = path;
        None
    }
}

/// Core download is 200-270 MB depending on platform and unpacks to well under
/// 1 GB; journal templates pull more via tlmgr afterwards. Refuse to start
/// below this floor so an install never strands the user with a full disk.
const MIN_FREE_BYTES: u64 = 2_000_000_000;

fn gigabytes(bytes: u64) -> f64 {
    bytes as f64 / 1_000_000_000.0
}

/// State the frontend needs to offer "Resume download" after a failure or a
/// force-quit: how much of the archive is already on disk.
#[derive(Clone, serde::Serialize)]
pub struct TinytexInstallState {
    pub installing: bool,
    pub partial_download_bytes: u64,
}

#[tauri::command]
pub async fn tinytex_install_state() -> TinytexInstallState {
    let partial = tauri::async_runtime::spawn_blocking(|| {
        [tinytex_download_path(), legacy_tinytex_download_path()]
            .into_iter()
            .filter_map(Result::ok)
            .filter_map(|path| std::fs::metadata(path).ok().map(|meta| meta.len()))
            .max()
            .unwrap_or(0)
    })
    .await
    .unwrap_or(0);
    TinytexInstallState {
        installing: install_in_progress(),
        partial_download_bytes: partial,
    }
}

const DOWNLOAD_TMP: &str = "tinytex-download.tmp";

#[derive(Clone, Debug)]
struct TinytexAsset {
    url: String,
    format: ArchiveFormat,
    expected_bytes: u64,
    expected_sha256: &'static str,
    expected_members: u64,
    expected_expanded_bytes: u64,
    expected_manifest_sha256: &'static str,
}

const INSTALL_MARKER: &str = ".oleafly-tinytex.json";

impl TinytexAsset {
    fn member_policy(&self) -> ArchiveMemberPolicy<'_> {
        ArchiveMemberPolicy {
            members: self.expected_members,
            expanded_bytes: self.expected_expanded_bytes,
            manifest_sha256: self.expected_manifest_sha256,
        }
    }
}

#[derive(PartialEq, serde::Serialize, serde::Deserialize)]
struct TinytexInstallMarker {
    schema_version: u32,
    release: String,
    os: String,
    arch: String,
    archive_bytes: u64,
    archive_sha256: String,
    archive_members: u64,
    expanded_bytes: u64,
    manifest_sha256: String,
}

fn install_marker(asset: &TinytexAsset) -> TinytexInstallMarker {
    TinytexInstallMarker {
        schema_version: 2,
        release: TINYTEX_TAG.to_string(),
        os: std::env::consts::OS.to_string(),
        arch: std::env::consts::ARCH.to_string(),
        archive_bytes: asset.expected_bytes,
        archive_sha256: asset.expected_sha256.to_string(),
        archive_members: asset.expected_members,
        expanded_bytes: asset.expected_expanded_bytes,
        manifest_sha256: asset.expected_manifest_sha256.to_string(),
    }
}

fn remove_install_path(path: &Path) -> Result<(), String> {
    let metadata = match std::fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => {
            return Err(format!("failed to inspect {}: {error}", path.display()));
        }
    };
    if metadata.file_type().is_symlink() || metadata.is_file() {
        std::fs::remove_file(path).map_err(|e| format!("failed to remove {}: {e}", path.display()))
    } else {
        std::fs::remove_dir_all(path)
            .map_err(|e| format!("failed to remove {}: {e}", path.display()))
    }
}

fn write_install_marker(root: &Path, asset: &TinytexAsset) -> Result<(), String> {
    use std::io::Write as _;

    let marker = install_marker(asset);
    let body = serde_json::to_vec_pretty(&marker)
        .map_err(|e| format!("failed to encode TinyTeX install marker: {e}"))?;
    let path = root.join(INSTALL_MARKER);
    let staging = root.join(format!("{INSTALL_MARKER}.tmp"));
    let mut file = std::fs::File::create(&staging)
        .map_err(|e| format!("failed to create TinyTeX install marker: {e}"))?;
    file.write_all(&body)
        .and_then(|_| file.sync_all())
        .map_err(|e| format!("failed to write TinyTeX install marker: {e}"))?;
    std::fs::rename(&staging, &path)
        .map_err(|e| format!("failed to publish TinyTeX install marker: {e}"))
}

fn validate_install_marker(root: &Path, asset: &TinytexAsset) -> Result<(), String> {
    let path = root.join(INSTALL_MARKER);
    let metadata = std::fs::symlink_metadata(&path)
        .map_err(|e| format!("TinyTeX install marker is missing or unreadable: {e}"))?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err("TinyTeX install marker is not a regular file.".into());
    }
    let marker: TinytexInstallMarker = serde_json::from_slice(
        &std::fs::read(&path).map_err(|e| format!("failed to read TinyTeX install marker: {e}"))?,
    )
    .map_err(|e| format!("TinyTeX install marker is invalid: {e}"))?;
    if marker != install_marker(asset) {
        return Err(format!(
            "TinyTeX install marker does not match {TINYTEX_TAG} for {}/{}.",
            std::env::consts::OS,
            std::env::consts::ARCH
        ));
    }
    Ok(())
}

async fn validate_tinytex_executables(root: &Path) -> Result<EngineInfo, String> {
    let lualatex = find_in_texdir(root, "lualatex")
        .ok_or_else(|| "TinyTeX has no host-compatible lualatex binary.".to_string())?;
    let mut info = engine_info_for_lualatex_unlocked(lualatex.clone(), "tinytex")
        .await
        .ok_or_else(|| "TinyTeX lualatex did not pass its version probe.".to_string())?;
    info.tlmgr = Some(validate_tinytex_tool(&lualatex, "tlmgr").await?);
    info.latexmk = Some(validate_tinytex_tool(&lualatex, "latexmk").await?);
    Ok(info)
}

async fn validate_tinytex_tool(lualatex: &Path, name: &str) -> Result<String, String> {
    let tool = sibling_tool(lualatex, name)
        .ok_or_else(|| format!("TinyTeX has no host-compatible {name} binary."))?;
    let output = run_tex_utility(&tool, &["--version".into()], TEX_PROBE_TIMEOUT).await?;
    if !output.success {
        return Err(format!(
            "TinyTeX {name} validation failed: {}",
            utility_error(&output)
        ));
    }
    Ok(tool.to_string_lossy().into_owned())
}

async fn validate_tinytex_root(root: &Path, asset: &TinytexAsset) -> Result<EngineInfo, String> {
    let _runtime = acquire_tex_runtime_read()?;
    validate_tinytex_root_unlocked(root, asset).await
}

async fn validate_tinytex_root_unlocked(
    root: &Path,
    asset: &TinytexAsset,
) -> Result<EngineInfo, String> {
    validate_install_marker(root, asset)?;
    validate_tinytex_executables(root).await
}

async fn prepare_staged_tinytex(root: &Path) -> Result<EngineInfo, String> {
    let lualatex = find_in_texdir(root, "lualatex")
        .ok_or_else(|| "Downloaded TinyTeX has no host-compatible lualatex binary.".to_string())?;
    if sibling_tool(&lualatex, "latexmk").is_none() {
        let tlmgr = sibling_tool(&lualatex, "tlmgr")
            .ok_or_else(|| "Downloaded TinyTeX has no tlmgr binary.".to_string())?;
        tlmgr_run_at(&tlmgr.to_string_lossy(), "install", vec!["latexmk".into()]).await?;
    }
    validate_tinytex_executables(root).await
}

fn publish_staged_tinytex(staging: &Path, destination: &Path) -> Result<(), String> {
    validate_publish_paths(staging, destination)?;
    let backup = tinytex_previous_sibling(destination)?;
    remove_install_path(&backup)?;
    let had_destination = std::fs::symlink_metadata(destination).is_ok();
    if had_destination {
        std::fs::rename(destination, &backup)
            .map_err(|error| format!("failed to stage the previous TinyTeX install: {error}"))?;
    }
    publish_or_restore(staging, destination, &backup, had_destination)?;
    if let Some(parent) = destination.parent() {
        if let Ok(directory) = std::fs::File::open(parent) {
            let _ = directory.sync_all();
        }
    }
    Ok(())
}

fn validate_publish_paths(staging: &Path, destination: &Path) -> Result<(), String> {
    if !staging.is_dir() {
        return Err("TinyTeX staging directory disappeared before publication.".into());
    }
    let staging_parent = staging
        .parent()
        .ok_or_else(|| "TinyTeX staging path has no parent directory.".to_string())?;
    let destination_parent = destination
        .parent()
        .ok_or_else(|| "TinyTeX destination path has no parent directory.".to_string())?;
    if staging_parent != destination_parent {
        return Err("TinyTeX staging and destination must be sibling directories.".into());
    }
    Ok(())
}

fn tinytex_previous_sibling(destination: &Path) -> Result<PathBuf, String> {
    let destination_name = destination
        .file_name()
        .ok_or_else(|| "TinyTeX destination path has no file name.".to_string())?;
    let mut backup_name = destination_name.to_os_string();
    backup_name.push(".previous");
    Ok(destination.with_file_name(backup_name))
}

fn publish_or_restore(
    staging: &Path,
    destination: &Path,
    backup: &Path,
    had_destination: bool,
) -> Result<(), String> {
    if let Err(error) = std::fs::rename(staging, destination) {
        if had_destination {
            if let Err(rollback_error) = std::fs::rename(backup, destination) {
                return Err(format!(
                    "failed to publish TinyTeX installation: {error}. Restoring the previous installation also failed: {rollback_error}"
                ));
            }
        }
        return Err(format!("failed to publish TinyTeX installation: {error}"));
    }
    Ok(())
}

fn finalize_published_tinytex(destination: &Path) -> Result<(), String> {
    let destination_name = destination
        .file_name()
        .ok_or_else(|| "TinyTeX destination path has no file name.".to_string())?;
    let mut backup_name = destination_name.to_os_string();
    backup_name.push(".previous");
    remove_install_path(&destination.with_file_name(backup_name))
}

fn rollback_published_tinytex(destination: &Path) -> Result<(), String> {
    let destination_name = destination
        .file_name()
        .ok_or_else(|| "TinyTeX destination path has no file name.".to_string())?;
    let mut backup_name = destination_name.to_os_string();
    backup_name.push(".previous");
    let backup = destination.with_file_name(backup_name);
    let had_backup = std::fs::symlink_metadata(&backup).is_ok();
    remove_install_path(destination)?;
    if had_backup {
        std::fs::rename(&backup, destination)
            .map_err(|e| format!("failed to restore the previous TinyTeX install: {e}"))?;
    }
    Ok(())
}

fn recover_interrupted_publish() -> Result<(), String> {
    let destination = tinytex_root()?;
    let backup = tinytex_backup_root()?;
    let destination_exists = std::fs::symlink_metadata(&destination).is_ok();
    let backup_exists = std::fs::symlink_metadata(&backup).is_ok();
    match (destination_exists, backup_exists) {
        (false, true) => std::fs::rename(&backup, &destination)
            .map_err(|e| format!("failed to recover the previous TinyTeX install: {e}")),
        (true, true) => {
            match tinytex_asset().and_then(|asset| validate_install_marker(&destination, &asset)) {
                Ok(()) => finalize_published_tinytex(&destination),
                Err(_) => rollback_published_tinytex(&destination),
            }
        }
        _ => Ok(()),
    }
}

fn tinytex_asset_for(os: &str, arch: &str) -> Result<TinytexAsset, String> {
    let base =
        format!("https://github.com/rstudio/tinytex-releases/releases/download/{TINYTEX_TAG}");
    match (os, arch) {
        ("windows", "x86_64") => Ok(tinytex_asset_metadata(
            &base, ("TinyTeX", "zip", ArchiveFormat::Zip, 246_862_169,
            "313314cdf15ad94e78931f6eff9bfc978f233ece7e5877f26467afe0b40f377b",
            22_948, 535_736_875,
            "cdc4ee187e1445c7157ca5387414d3e9539511df654ac353ccf67592ab652f37",
        ))),
        ("windows", unsupported_arch) => Err(format!(
            "Automatic TinyTeX install is not available for Windows {unsupported_arch}. Install a compatible TeX Live toolchain manually."
        )),
        ("macos", "x86_64" | "aarch64") => Ok(tinytex_asset_metadata(
            &base, ("TinyTeX", "tgz", ArchiveFormat::TarGz, 265_813_745,
            "c1e6ee0474300c72395647aa93aca0ea4bb600192e9a22bf539d57a583acb5c5",
            19_994, 517_999_787,
            "5018a2635526cc1d3a27b4eaa2bff8239c181afc6da01a063d1ff33809a3abd1",
        ))),
        ("macos", unsupported_arch) => Err(format!(
            "Automatic TinyTeX install is not available for macOS {unsupported_arch}. Install a compatible TeX Live toolchain manually."
        )),
        ("linux", "x86_64") => Ok(tinytex_asset_metadata(
            &base, ("TinyTeX", "tar.gz", ArchiveFormat::TarGz, 200_145_836,
            "6f39005ce5c60863698793481352df75c051980b68a47726d49be9a00a377767",
            19_994, 415_152_635,
            "a69e2c1225af6911235e2a2ca40bf4a7968df6a64dc70ac5a43448683b53c938",
        ))),
        ("linux", "aarch64") => Ok(tinytex_asset_metadata(
            &base, ("TinyTeX-linux-arm64", "tar.xz", ArchiveFormat::TarXz, 155_871_496,
            "c6713bf6c44048a4902040a08763c611deac3644b844f03d7244ae49a54a2a08",
            19_992, 422_289_956,
            "87da0e4715f7d96e6aeb8a62532b036e1a47267be5f86aa4de962b2539868ce4",
        ))),
        ("linux", unsupported_arch) => Err(format!(
            "Automatic TinyTeX install is not available for Linux {unsupported_arch}. Install a LuaLaTeX / TeX Live 2025 toolchain from your package manager."
        )),
        _ => Err("Automatic TinyTeX install is not supported on this platform. Install a LuaLaTeX / TeX Live 2025 toolchain manually.".to_string()),
    }
}

type TinytexAssetMetadata = (
    &'static str,
    &'static str,
    ArchiveFormat,
    u64,
    &'static str,
    u64,
    u64,
    &'static str,
);

fn tinytex_asset_metadata(base: &str, metadata: TinytexAssetMetadata) -> TinytexAsset {
    let (
        name,
        extension,
        format,
        expected_bytes,
        expected_sha256,
        expected_members,
        expected_expanded_bytes,
        expected_manifest_sha256,
    ) = metadata;
    TinytexAsset {
        url: format!("{base}/{name}-{TINYTEX_TAG}.{extension}"),
        format,
        expected_bytes,
        expected_sha256,
        expected_members,
        expected_expanded_bytes,
        expected_manifest_sha256,
    }
}

fn tinytex_asset() -> Result<TinytexAsset, String> {
    tinytex_asset_for(std::env::consts::OS, std::env::consts::ARCH)
}

fn verify_tinytex_archive(path: &Path, asset: &TinytexAsset) -> Result<(), String> {
    use sha2::{Digest, Sha256};
    use std::io::Read as _;

    let actual_bytes = std::fs::metadata(path)
        .map_err(|e| format!("could not inspect TinyTeX download: {e}"))?
        .len();
    if actual_bytes != asset.expected_bytes {
        return Err(format!(
            "TinyTeX download has an unexpected size: expected {} bytes, received {actual_bytes}.",
            asset.expected_bytes
        ));
    }

    let mut file =
        std::fs::File::open(path).map_err(|e| format!("could not verify TinyTeX download: {e}"))?;
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 128 * 1024];
    loop {
        let read = file
            .read(&mut buffer)
            .map_err(|e| format!("could not verify TinyTeX download: {e}"))?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    let actual_sha256 = format!("{:x}", hasher.finalize());
    if actual_sha256 != asset.expected_sha256 {
        return Err("TinyTeX download failed SHA-256 verification.".to_string());
    }
    Ok(())
}

struct TinytexInstallPaths {
    root: PathBuf,
    staging: PathBuf,
    download: PathBuf,
}

fn prepare_install_paths() -> Result<TinytexInstallPaths, String> {
    let app_root = paths::oleafly_root()?;
    std::fs::create_dir_all(&app_root).map_err(|error| error.to_string())?;
    let paths = TinytexInstallPaths {
        root: tinytex_root()?,
        staging: tinytex_staging_root()?,
        download: tinytex_download_path()?,
    };
    migrate_legacy_download(&paths.download)?;
    ensure_install_space(&app_root)?;
    Ok(paths)
}

fn migrate_legacy_download(download: &Path) -> Result<(), String> {
    let legacy = legacy_tinytex_download_path()?;
    if download.exists() || !legacy.is_file() {
        return Ok(());
    }
    std::fs::rename(&legacy, download)
        .map_err(|error| format!("failed to migrate the partial TinyTeX download: {error}"))
}

fn ensure_install_space(app_root: &Path) -> Result<(), String> {
    let Some(free) = free_disk_space(app_root) else {
        return Ok(());
    };
    if free >= MIN_FREE_BYTES {
        return Ok(());
    }
    Err(format!(
        "Not enough free disk space to install TinyTeX. It needs about {:.1} GB (download plus extraction, with room for LaTeX packages). This disk has {:.1} GB free. Free up space, then try again.",
        gigabytes(MIN_FREE_BYTES),
        gigabytes(free)
    ))
}

async fn clean_redundant_install_files() -> Result<(), String> {
    let paths = [
        tinytex_staging_root()?,
        tinytex_backup_root()?,
        tinytex_download_path()?,
        legacy_tinytex_download_path()?,
    ];
    tauri::async_runtime::spawn_blocking(move || {
        for path in paths {
            let _ = remove_install_path(&path);
        }
    })
    .await
    .map_err(|error| error.to_string())
}

async fn open_tinytex_download(
    asset: &TinytexAsset,
    already: u64,
) -> Result<(reqwest::Response, bool), String> {
    let client = reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(30))
        .timeout(std::time::Duration::from_secs(2 * 60 * 60))
        .build()
        .map_err(|error| format!("could not initialize TinyTeX downloader: {error}"))?;
    let mut request = client.get(&asset.url);
    if already > 0 {
        request = request.header(reqwest::header::RANGE, format!("bytes={already}-"));
    }
    let response = request
        .send()
        .await
        .map_err(|error| format!("download failed: {error}"))?
        .error_for_status()
        .map_err(|error| format!("download failed: {error}"))?;
    let resuming = response.status() == reqwest::StatusCode::PARTIAL_CONTENT && already > 0;
    if let Some(response_bytes) = response.content_length() {
        let claimed_total = if resuming {
            already.checked_add(response_bytes)
        } else {
            Some(response_bytes)
        };
        if claimed_total != Some(asset.expected_bytes) {
            return Err(format!(
                "TinyTeX server reported an unexpected download size. Expected {} bytes.",
                asset.expected_bytes
            ));
        }
    }
    Ok((response, resuming))
}

async fn write_tinytex_download(
    app: &tauri::AppHandle,
    path: &Path,
    asset: &TinytexAsset,
    response: reqwest::Response,
    already: u64,
    resuming: bool,
) -> Result<(), String> {
    use futures_util::StreamExt as _;
    use std::io::Write as _;
    use tauri::Emitter as _;

    let mut file = open_download_file(path, resuming)?;
    let mut received = if resuming { already } else { 0 };
    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|error| {
            format!("download interrupted: {error}. Your progress is saved. Retry to resume.")
        })?;
        received = checked_received_bytes(received, chunk.len())?;
        if received > asset.expected_bytes {
            drop(file);
            let _ = std::fs::remove_file(path);
            return Err("TinyTeX download exceeded its pinned size and was discarded.".into());
        }
        file.write_all(&chunk).map_err(|error| error.to_string())?;
        let _ = app.emit(
            "tinytex-install-progress",
            EngineProgress {
                phase: "download",
                received,
                total: Some(asset.expected_bytes),
            },
        );
    }
    file.flush().map_err(|error| error.to_string())?;
    if received == asset.expected_bytes {
        Ok(())
    } else {
        Err(format!(
            "download interrupted after {received} of {} bytes. Your progress is saved. Retry to resume.",
            asset.expected_bytes
        ))
    }
}

fn open_download_file(path: &Path, resuming: bool) -> Result<std::fs::File, String> {
    if resuming {
        std::fs::OpenOptions::new()
            .append(true)
            .open(path)
            .map_err(|error| error.to_string())
    } else {
        std::fs::File::create(path).map_err(|error| error.to_string())
    }
}

fn checked_received_bytes(received: u64, chunk_bytes: usize) -> Result<u64, String> {
    received
        .checked_add(chunk_bytes as u64)
        .ok_or_else(|| "TinyTeX download size overflowed.".to_string())
}

async fn download_tinytex(
    app: &tauri::AppHandle,
    path: &Path,
    asset: &TinytexAsset,
) -> Result<(), String> {
    let mut already = std::fs::metadata(path)
        .map(|metadata| metadata.len())
        .unwrap_or(0);
    if already > asset.expected_bytes {
        let _ = std::fs::remove_file(path);
        already = 0;
    }
    if already == asset.expected_bytes {
        return Ok(());
    }
    let (response, resuming) = open_tinytex_download(asset, already).await?;
    write_tinytex_download(app, path, asset, response, already, resuming).await
}

async fn verify_download(path: &Path, asset: &TinytexAsset) -> Result<(), String> {
    let verify_path = path.to_path_buf();
    let verify_asset = asset.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        verify_tinytex_archive(&verify_path, &verify_asset)
    })
    .await
    .map_err(|error| error.to_string())?;
    if let Err(error) = result {
        let _ = std::fs::remove_file(path);
        return Err(format!(
            "{error} The download was discarded. Retry to download a clean copy."
        ));
    }
    Ok(())
}

async fn extract_tinytex(
    app: &tauri::AppHandle,
    paths: &TinytexInstallPaths,
    asset: &TinytexAsset,
) -> Result<(), String> {
    use tauri::Emitter as _;

    let _ = app.emit(
        "tinytex-install-progress",
        EngineProgress {
            phase: "extract",
            received: 0,
            total: None,
        },
    );
    let download = paths.download.clone();
    let staging = paths.staging.clone();
    let extract_staging = staging.clone();
    let extract_asset = asset.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        remove_install_path(&extract_staging)?;
        std::fs::create_dir_all(&extract_staging)
            .map_err(|error| format!("failed to create TinyTeX staging directory: {error}"))?;
        crate::tinytex_archive::extract_all(
            &download,
            extract_asset.format,
            extract_asset.member_policy(),
            &extract_staging,
        )
    })
    .await
    .map_err(|error| error.to_string())?;
    if result.is_err() {
        let _ = tauri::async_runtime::spawn_blocking(move || remove_install_path(&staging)).await;
    }
    result
}

async fn validate_staged_tinytex(
    app: &tauri::AppHandle,
    staging: &Path,
    asset: &TinytexAsset,
) -> Result<(), String> {
    use tauri::Emitter as _;

    let needs_latexmk = find_in_texdir(staging, "lualatex")
        .and_then(|lualatex| sibling_tool(&lualatex, "latexmk"))
        .is_none();
    if needs_latexmk {
        let _ = app.emit(
            "tinytex-install-progress",
            EngineProgress {
                phase: "packages",
                received: 0,
                total: None,
            },
        );
    }
    if let Err(error) = prepare_staged_tinytex(staging).await {
        let failed_staging = staging.to_path_buf();
        let _ = tauri::async_runtime::spawn_blocking(move || remove_install_path(&failed_staging))
            .await;
        return Err(format!(
            "TinyTeX validation failed before installation: {error}"
        ));
    }
    write_install_marker(staging, asset)
}

async fn publish_tinytex(
    state: &AppState,
    paths: &TinytexInstallPaths,
    asset: &TinytexAsset,
) -> Result<EngineInfo, String> {
    let _compile = state.compile_lock.lock().await;
    let _figure_compile = state.figure_compile_lock.lock().await;
    let _runtime = acquire_tex_runtime_write()?;
    let staging = paths.staging.clone();
    let root = paths.root.clone();
    tauri::async_runtime::spawn_blocking(move || publish_staged_tinytex(&staging, &root))
        .await
        .map_err(|error| error.to_string())??;
    match validate_tinytex_root_unlocked(&paths.root, asset).await {
        Ok(info) => {
            let root = paths.root.clone();
            let _ = tauri::async_runtime::spawn_blocking(move || finalize_published_tinytex(&root))
                .await;
            Ok(info)
        }
        Err(error) => rollback_failed_publish(&paths.root, error).await,
    }
}

async fn rollback_failed_publish(
    root: &Path,
    validation_error: String,
) -> Result<EngineInfo, String> {
    let rollback_root = root.to_path_buf();
    let rollback =
        tauri::async_runtime::spawn_blocking(move || rollback_published_tinytex(&rollback_root))
            .await
            .map_err(|error| error.to_string())?;
    match rollback {
        Ok(()) => Err(format!(
            "TinyTeX final validation failed and the previous installation was restored: {validation_error}"
        )),
        Err(rollback_error) => Err(format!(
            "TinyTeX final validation failed: {validation_error}. Restoring the previous installation also failed: {rollback_error}"
        )),
    }
}

async fn reuse_existing_tinytex(asset: &TinytexAsset) -> Result<Option<EngineInfo>, String> {
    let root = tinytex_root()?;
    let Ok(existing) = validate_tinytex_root(&root, asset).await else {
        return Ok(None);
    };
    let _ = clean_redundant_install_files().await;
    Ok(Some(existing))
}

async fn install_prepared_tinytex(
    app: &tauri::AppHandle,
    state: &AppState,
    asset: &TinytexAsset,
) -> Result<EngineInfo, String> {
    let paths = prepare_install_paths()?;
    download_tinytex(app, &paths.download, asset).await?;
    verify_download(&paths.download, asset).await?;
    extract_tinytex(app, &paths, asset).await?;
    validate_staged_tinytex(app, &paths.staging, asset).await?;
    let installed = publish_tinytex(state, &paths, asset).await;
    if installed.is_ok() {
        let _ = std::fs::remove_file(&paths.download);
    }
    installed
}

#[tauri::command]
pub async fn install_tinytex(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<EngineInfo, String> {
    let _install = TinytexMutationGuard::acquire_install()?;
    {
        let _runtime = acquire_tex_runtime_write()?;
        recover_interrupted_publish()?;
    }
    let asset = tinytex_asset()?;
    if let Some(existing) = reuse_existing_tinytex(&asset).await? {
        return Ok(existing);
    }
    install_prepared_tinytex(&app, &state, &asset).await
}

/// Remove our TinyTeX install to free disk space.
#[tauri::command]
pub async fn delete_tinytex(state: tauri::State<'_, AppState>) -> Result<(), String> {
    delete_tinytex_synchronized(&state).await
}

async fn delete_tinytex_synchronized(state: &AppState) -> Result<(), String> {
    let _delete = TinytexMutationGuard::acquire_maintenance()?;
    let _compile = state.compile_lock.lock().await;
    let _figure_compile = state.figure_compile_lock.lock().await;
    let _runtime = acquire_tex_runtime_write()?;
    tauri::async_runtime::spawn_blocking(delete_tinytex_paths)
        .await
        .map_err(|e| e.to_string())?
}

fn delete_tinytex_paths() -> Result<(), String> {
    let paths = [
        tinytex_root()?,
        tinytex_staging_root()?,
        tinytex_backup_root()?,
        tinytex_download_path()?,
    ];
    for path in paths {
        remove_install_path(&path)?;
    }
    Ok(())
}

fn tlmgr_path() -> Result<String, String> {
    crate::tex_distro::active_latexmk_distribution()
        .and_then(|distribution| distribution.tlmgr)
        .ok_or_else(|| {
            "The active TeX distribution has no tlmgr. Package management is unavailable."
                .to_string()
        })
}

#[tauri::command]
pub async fn tlmgr_installed() -> Result<Vec<String>, String> {
    let tlmgr = tlmgr_path()?;
    tlmgr_installed_at(&tlmgr).await
}

async fn tlmgr_installed_at(tlmgr: &str) -> Result<Vec<String>, String> {
    let _runtime = acquire_tex_runtime_read()?;
    let output = run_tex_utility(
        Path::new(tlmgr),
        &[
            "info".into(),
            "--only-installed".into(),
            "--data".into(),
            "name".into(),
        ],
        TLMGR_INFO_TIMEOUT,
    )
    .await?;
    if !output.success {
        return Err(utility_error(&output));
    }
    Ok(output
        .stdout
        .lines()
        .map(|l| l.trim().to_string())
        .filter(|l| !l.is_empty())
        .collect())
}

pub async fn tlmgr_installed_versions_at(
    tlmgr: &str,
) -> Result<std::collections::BTreeMap<String, String>, String> {
    let _runtime = acquire_tex_runtime_read()?;
    let output = run_tex_utility(
        Path::new(tlmgr),
        &[
            "info".into(),
            "--only-installed".into(),
            "--data".into(),
            "name,cat-version".into(),
        ],
        TLMGR_INFO_TIMEOUT,
    )
    .await?;
    if !output.success {
        return Err(utility_error(&output));
    }
    Ok(parse_tlmgr_versions(&output.stdout))
}

/// Parse `tlmgr info --only-installed --data name,cat-version` output: one
/// `name,version` pair per line, version possibly empty (packages the CTAN
/// catalogue has no version for).
fn parse_tlmgr_versions(stdout: &str) -> std::collections::BTreeMap<String, String> {
    let mut versions = std::collections::BTreeMap::new();
    for line in stdout.lines() {
        let Some((name, version)) = line.trim().split_once(',') else {
            continue;
        };
        let name = name.trim();
        if name.is_empty() {
            continue;
        }
        let version = version.trim();
        versions.insert(
            name.to_string(),
            if version.is_empty() {
                "installed".to_string()
            } else {
                version.to_string()
            },
        );
    }
    versions
}

/// Install TeX packages by name via tlmgr. Returns the combined output log.
#[tauri::command]
pub async fn tlmgr_install(
    state: tauri::State<'_, AppState>,
    packages: Vec<String>,
) -> Result<String, String> {
    tlmgr_mutate_synchronized(&state, "install", packages).await
}

/// Remove TeX packages by name via tlmgr.
#[tauri::command]
pub async fn tlmgr_remove(
    state: tauri::State<'_, AppState>,
    packages: Vec<String>,
) -> Result<String, String> {
    tlmgr_mutate_synchronized(&state, "remove", packages).await
}

/// Names are validated to a safe charset so they cannot be flags/paths. Real
/// TeX Live package names start with a letter or digit; a leading `-` or `.`
/// would read as a flag or a relative path.
fn validate_package_names(packages: &[String]) -> Result<(), String> {
    for p in packages {
        let starts_safe = p.chars().next().is_some_and(|c| c.is_ascii_alphanumeric());
        if !starts_safe
            || !p
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '.')
        {
            return Err(format!("invalid package name: {p}"));
        }
    }
    Ok(())
}

async fn tlmgr_mutate_synchronized(
    state: &AppState,
    action: &str,
    packages: Vec<String>,
) -> Result<String, String> {
    if packages.is_empty() {
        return Ok(String::new());
    }
    validate_package_names(&packages)?;
    let _mutation = TinytexMutationGuard::acquire_maintenance()?;
    let _compile = state.compile_lock.lock().await;
    let _figure_compile = state.figure_compile_lock.lock().await;
    let _runtime = acquire_tex_runtime_write()?;
    let tlmgr = tlmgr_path()?;
    tlmgr_run_at(&tlmgr, action, packages).await
}

async fn tlmgr_run_at(tlmgr: &str, action: &str, packages: Vec<String>) -> Result<String, String> {
    if packages.is_empty() {
        return Ok(String::new());
    }
    validate_package_names(&packages)?;
    let mut args = vec![action.to_string(), "--".into()];
    args.extend(packages);
    let output = run_tex_utility(Path::new(tlmgr), &args, TLMGR_MUTATION_TIMEOUT).await?;
    let log = format!("{}{}", output.stdout, output.stderr);
    if !output.success {
        return Err(log.trim().to_string());
    }
    Ok(log)
}

#[derive(Clone, serde::Serialize)]
pub struct TaggedCompileResult {
    pub success: bool,
    pub has_pdf: bool,
    pub output_id: Option<String>,
    pub output_revision: Option<u64>,
    pub log: String,
}

fn tagged_lualatex_args(out_dir: &str, main_doc: &str) -> Vec<String> {
    vec![
        "-no-shell-escape".into(),
        "--nosocket".into(),
        "-interaction=nonstopmode".into(),
        "-file-line-error".into(),
        format!("-output-directory={out_dir}"),
        format!("-jobname={}", paths::ENTRY_STEM),
        "--".into(),
        main_doc.into(),
    ]
}

struct TaggedCancelGuard<'a> {
    cancel: &'a crate::state::CompileCancel,
    active: bool,
}

impl<'a> TaggedCancelGuard<'a> {
    fn new(cancel: &'a crate::state::CompileCancel) -> Self {
        cancel.begin();
        Self {
            cancel,
            active: true,
        }
    }

    fn finish(mut self) -> bool {
        self.active = false;
        self.cancel.detach()
    }
}

impl Drop for TaggedCancelGuard<'_> {
    fn drop(&mut self) {
        if self.active {
            let _ = self.cancel.detach();
        }
    }
}

struct TaggedCompilePlan {
    project_id: String,
    main_doc: String,
    engine_id: String,
    lualatex: PathBuf,
    project_dir: PathBuf,
    pdf: PathBuf,
    args: Vec<String>,
}

struct TaggedCompileExecution {
    success: bool,
    output_id: Option<String>,
    log: String,
}

async fn prepare_tagged_compile(
    project_id: String,
    main_doc: String,
) -> Result<TaggedCompilePlan, String> {
    let meta = crate::project::read_compile_meta(&project_id, &main_doc)?;
    let lualatex = find_engine()
        .await
        .lualatex
        .ok_or_else(|| "No LuaLaTeX engine available. Install TinyTeX first.".to_string())?;
    let project_dir = paths::project_dir(&project_id)?;
    let build_dir = paths::build_dir(&project_id)?;
    let tex_path = crate::project::resolve_in_project(&project_id, &main_doc)?;
    if !tex_path.exists() {
        return Err(format!("main document not found: {main_doc}"));
    }
    std::fs::create_dir_all(&build_dir).map_err(|error| error.to_string())?;
    let pdf = build_dir.join(format!("{}.pdf", paths::ENTRY_STEM));
    remove_stale_tagged_pdf(&pdf)?;
    let args = tagged_lualatex_args(&build_dir.to_string_lossy(), &main_doc);
    Ok(TaggedCompilePlan {
        project_id,
        main_doc,
        engine_id: meta.engine,
        lualatex: PathBuf::from(lualatex),
        project_dir,
        pdf,
        args,
    })
}

fn remove_stale_tagged_pdf(pdf: &Path) -> Result<(), String> {
    match std::fs::remove_file(pdf) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!(
            "failed to clear stale tagged PDF {}: {error}",
            pdf.display()
        )),
    }
}

async fn run_tagged_compile(
    plan: &TaggedCompilePlan,
    cancel: &crate::state::CompileCancel,
    cancel_guard: TaggedCancelGuard<'_>,
) -> Result<TaggedCompileExecution, String> {
    let mut log = String::new();
    let mut success = false;
    for pass in 0..2 {
        let (pass_log, exit_code) = crate::document_engine::run_supervised_external_cancellable(
            &plan.lualatex,
            &plan.args,
            &plan.project_dir,
            cancel,
        )
        .await
        .map_err(|error| format!("failed to run lualatex: {error}"))?;
        log = pass_log;
        success = exit_code == Some(0);
        if !success && pass == 0 {
            break;
        }
    }
    if cancel_guard.finish() {
        success = false;
        log.push_str("\nOleafly stopped the tagged compile on request.\n");
    }
    let pdf = plan.pdf.clone();
    let output_id = tauri::async_runtime::spawn_blocking(move || {
        std::fs::read(pdf)
            .ok()
            .map(|bytes| crate::document_engine::fingerprint_compile_output(&bytes))
    })
    .await
    .map_err(|error| format!("failed to verify tagged compiler output: {error}"))?;
    Ok(TaggedCompileExecution {
        success,
        output_id,
        log,
    })
}

fn publish_tagged_compile(
    state: &AppState,
    plan: &TaggedCompilePlan,
    execution: TaggedCompileExecution,
) -> TaggedCompileResult {
    let has_pdf = execution.output_id.is_some();
    let mut result = TaggedCompileResult {
        success: execution.success && has_pdf,
        has_pdf,
        output_id: execution.output_id,
        output_revision: None,
        log: execution.log,
    };
    if let Err(error) = crate::project::ensure_compile_meta_unchanged(
        &plan.project_id,
        &plan.main_doc,
        &plan.engine_id,
    ) {
        result.success = false;
        result.has_pdf = false;
        result.output_id = None;
        result
            .log
            .push_str(&format!("\nOleafly rejected the tagged output: {error}"));
        return result;
    }
    if result.success {
        result.output_revision = Some(
            state
                .compile_output_revision
                .fetch_add(1, std::sync::atomic::Ordering::SeqCst)
                + 1,
        );
    }
    result
}

#[tauri::command]
pub async fn compile_tagged(
    state: tauri::State<'_, AppState>,
    project_id: String,
    main_doc: String,
) -> Result<TaggedCompileResult, String> {
    let _guard = state.compile_lock.lock().await;
    let cancel_guard = TaggedCancelGuard::new(&state.compile_cancel);
    let plan = prepare_tagged_compile(project_id, main_doc).await?;
    let _runtime = acquire_tex_runtime_read()?;
    let execution = run_tagged_compile(&plan, &state.compile_cancel, cancel_guard).await?;
    Ok(publish_tagged_compile(&state, &plan, execution))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_manifest_digest(entries: &[(&str, &str, u64, Option<&str>)]) -> &'static str {
        use sha2::Digest as _;

        let mut hasher = sha2::Sha256::new();
        for (kind, path, size, link_target) in entries {
            hasher.update(kind.as_bytes());
            hasher.update([0]);
            hasher.update(path.as_bytes());
            hasher.update([0]);
            hasher.update(size.to_le_bytes());
            if let Some(target) = link_target {
                hasher.update(target.as_bytes());
            }
            hasher.update([0]);
        }
        Box::leak(format!("{:x}", hasher.finalize()).into_boxed_str())
    }

    fn test_extraction_asset(
        format: ArchiveFormat,
        members: u64,
        expanded_bytes: u64,
        manifest_sha256: &'static str,
    ) -> TinytexAsset {
        TinytexAsset {
            url: "https://example.invalid/TinyTeX".into(),
            format,
            expected_bytes: 0,
            expected_sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
            expected_members: members,
            expected_expanded_bytes: expanded_bytes,
            expected_manifest_sha256: manifest_sha256,
        }
    }

    fn test_dir(label: &str) -> PathBuf {
        tempfile::Builder::new()
            .prefix(&format!("oleafly-tinytex-{label}-"))
            .tempdir()
            .unwrap()
            .keep()
    }

    #[test]
    fn tinytex_asset_uses_the_pinned_release() {
        // Every supported platform must build a URL under the pinned tag with
        // the versioned asset name; the moving "daily" tag must never appear.
        let asset = tinytex_asset();
        if let Ok(asset) = asset {
            assert!(asset.url.contains(&format!("/download/{TINYTEX_TAG}/")));
            assert!(asset.url.contains("TinyTeX"));
            assert!(asset.url.contains(TINYTEX_TAG));
            assert!(!asset.url.contains("daily"));
            assert!(asset.expected_bytes > 0);
            assert_eq!(asset.expected_sha256.len(), 64);
            assert!(asset
                .expected_sha256
                .chars()
                .all(|character| character.is_ascii_hexdigit()));
            match asset.format {
                ArchiveFormat::Zip => assert!(asset.url.ends_with(".zip")),
                ArchiveFormat::TarGz => {
                    assert!(asset.url.ends_with(".tgz") || asset.url.ends_with(".tar.gz"));
                }
                ArchiveFormat::TarXz => assert!(asset.url.ends_with(".tar.xz")),
            }
        }
    }

    type AssetCase = (
        &'static str,
        &'static str,
        &'static str,
        ArchiveFormat,
        u64,
        &'static str,
        u64,
        u64,
        &'static str,
    );

    const ASSET_CASES: &[AssetCase] = &[
        (
            "windows",
            "x86_64",
            ".zip",
            ArchiveFormat::Zip,
            246_862_169,
            "313314cdf15ad94e78931f6eff9bfc978f233ece7e5877f26467afe0b40f377b",
            22_948,
            535_736_875,
            "cdc4ee187e1445c7157ca5387414d3e9539511df654ac353ccf67592ab652f37",
        ),
        (
            "macos",
            "aarch64",
            ".tgz",
            ArchiveFormat::TarGz,
            265_813_745,
            "c1e6ee0474300c72395647aa93aca0ea4bb600192e9a22bf539d57a583acb5c5",
            19_994,
            517_999_787,
            "5018a2635526cc1d3a27b4eaa2bff8239c181afc6da01a063d1ff33809a3abd1",
        ),
        (
            "linux",
            "x86_64",
            ".tar.gz",
            ArchiveFormat::TarGz,
            200_145_836,
            "6f39005ce5c60863698793481352df75c051980b68a47726d49be9a00a377767",
            19_994,
            415_152_635,
            "a69e2c1225af6911235e2a2ca40bf4a7968df6a64dc70ac5a43448683b53c938",
        ),
        (
            "linux",
            "aarch64",
            ".tar.xz",
            ArchiveFormat::TarXz,
            155_871_496,
            "c6713bf6c44048a4902040a08763c611deac3644b844f03d7244ae49a54a2a08",
            19_992,
            422_289_956,
            "87da0e4715f7d96e6aeb8a62532b036e1a47267be5f86aa4de962b2539868ce4",
        ),
    ];

    #[test]
    fn tinytex_assets_pin_reviewed_archive_and_member_manifests() {
        for (
            os,
            arch,
            suffix,
            format,
            expected_bytes,
            expected_sha256,
            expected_members,
            expected_expanded_bytes,
            expected_manifest_sha256,
        ) in ASSET_CASES.iter().copied()
        {
            let asset = tinytex_asset_for(os, arch).unwrap();
            assert!(asset.url.ends_with(suffix));
            assert_eq!(asset.format, format);
            assert_eq!(asset.expected_bytes, expected_bytes);
            assert_eq!(asset.expected_sha256, expected_sha256);
            assert_eq!(asset.expected_members, expected_members);
            assert_eq!(asset.expected_expanded_bytes, expected_expanded_bytes);
            assert_eq!(asset.expected_manifest_sha256, expected_manifest_sha256);
        }
        assert_eq!(
            tinytex_asset_for("macos", "x86_64").unwrap().format,
            ArchiveFormat::TarGz
        );
        for (os, arch) in [
            ("windows", "aarch64"),
            ("macos", "arm"),
            ("linux", "x86"),
            ("freebsd", "x86_64"),
        ] {
            assert!(
                tinytex_asset_for(os, arch).is_err(),
                "unexpectedly supported {os}/{arch}"
            );
        }
    }

    #[test]
    fn archive_verification_rejects_wrong_size_and_digest() {
        let root = test_dir("verify");
        std::fs::create_dir_all(&root).unwrap();
        let archive = root.join("archive");
        std::fs::write(&archive, b"abc").unwrap();
        let mut asset = TinytexAsset {
            url: "https://example.invalid/archive".into(),
            format: ArchiveFormat::TarGz,
            expected_bytes: 3,
            expected_sha256: "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
            expected_members: 0,
            expected_expanded_bytes: 0,
            expected_manifest_sha256:
                "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        };
        assert!(verify_tinytex_archive(&archive, &asset).is_ok());

        asset.expected_bytes = 4;
        assert!(verify_tinytex_archive(&archive, &asset).is_err());
        asset.expected_bytes = 3;
        asset.expected_sha256 = "0000000000000000000000000000000000000000000000000000000000000000";
        assert!(verify_tinytex_archive(&archive, &asset).is_err());

        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn extraction_rejects_an_unreviewed_member_before_creating_staging() {
        use std::io::Write as _;

        let root = test_dir("unexpected-member");
        std::fs::create_dir_all(&root).unwrap();
        let archive_path = root.join("tinytex.tar.gz");
        let destination = root.join("out");
        let mut tar = tar::Builder::new(Vec::new());
        for (path, payload) in [
            ("TinyTeX/reviewed.txt", b"reviewed".as_slice()),
            ("TinyTeX/unexpected.exe", b"unexpected".as_slice()),
        ] {
            let mut header = tar::Header::new_gnu();
            header.set_size(payload.len() as u64);
            header.set_mode(0o644);
            header.set_entry_type(tar::EntryType::Regular);
            header.set_cksum();
            tar.append_data(&mut header, path, payload).unwrap();
        }
        let tar_bytes = tar.into_inner().unwrap();
        let archive = std::fs::File::create(&archive_path).unwrap();
        let mut encoder = flate2::write::GzEncoder::new(archive, flate2::Compression::default());
        encoder.write_all(&tar_bytes).unwrap();
        encoder.finish().unwrap();

        let digest = test_manifest_digest(&[(
            "file",
            "TinyTeX/reviewed.txt",
            b"reviewed".len() as u64,
            None,
        )]);
        let asset =
            test_extraction_asset(ArchiveFormat::TarGz, 1, b"reviewed".len() as u64, digest);
        assert!(crate::tinytex_archive::extract_all(
            &archive_path,
            asset.format,
            asset.member_policy(),
            &destination,
        )
        .is_err());
        assert!(!destination.exists());
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn reviewed_manifests_match_downloaded_release_archives_when_available() {
        let Ok(root) = std::env::var("OLEAFLY_TINYTEX_ARCHIVE_TEST_DIR") else {
            return;
        };
        let root = Path::new(&root);
        for (file, os, arch) in [
            ("windows.zip", "windows", "x86_64"),
            ("macos.tgz", "macos", "aarch64"),
            ("linux-x64.tar.gz", "linux", "x86_64"),
        ] {
            let asset = tinytex_asset_for(os, arch).unwrap();
            crate::tinytex_archive::inspect_archive(
                &root.join(file),
                asset.format,
                asset.member_policy(),
            )
            .unwrap_or_else(|error| panic!("{file}: {error}"));
        }
        #[cfg(target_os = "linux")]
        {
            let asset = tinytex_asset_for("linux", "aarch64").unwrap();
            crate::tinytex_archive::inspect_archive(
                &root.join("linux-arm64.tar.xz"),
                asset.format,
                asset.member_policy(),
            )
            .unwrap();
        }
        #[cfg(not(target_os = "linux"))]
        if let Ok(file) = std::fs::File::open(root.join("linux-arm64.tar")) {
            let asset = tinytex_asset_for("linux", "aarch64").unwrap();
            crate::tinytex_archive::inspect_tar(file, asset.member_policy()).unwrap();
        }
    }

    #[test]
    fn install_marker_records_the_exact_reviewed_asset() {
        let root = test_dir("marker");
        std::fs::create_dir_all(&root).unwrap();
        let asset = tinytex_asset_for("linux", "aarch64").unwrap();

        write_install_marker(&root, &asset).unwrap();

        let marker: TinytexInstallMarker =
            serde_json::from_slice(&std::fs::read(root.join(INSTALL_MARKER)).unwrap()).unwrap();
        assert_eq!(marker.schema_version, 2);
        assert_eq!(marker.release, TINYTEX_TAG);
        assert_eq!(marker.os, std::env::consts::OS);
        assert_eq!(marker.arch, std::env::consts::ARCH);
        assert_eq!(marker.archive_bytes, asset.expected_bytes);
        assert_eq!(marker.archive_sha256, asset.expected_sha256);
        assert_eq!(marker.archive_members, asset.expected_members);
        assert_eq!(marker.expanded_bytes, asset.expected_expanded_bytes);
        assert_eq!(marker.manifest_sha256, asset.expected_manifest_sha256);
        validate_install_marker(&root, &asset).unwrap();
        assert!(!root.join(format!("{INSTALL_MARKER}.tmp")).exists());

        let mut invalid_marker = marker;
        invalid_marker.release = "v0.0".into();
        std::fs::write(
            root.join(INSTALL_MARKER),
            serde_json::to_vec(&invalid_marker).unwrap(),
        )
        .unwrap();
        assert!(validate_install_marker(&root, &asset).is_err());
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn tagged_lualatex_arguments_disable_shell_escape_and_terminate_options() {
        let args = tagged_lualatex_args("build", "-draft.tex");
        assert!(args.contains(&"-no-shell-escape".to_string()));
        assert!(!args.contains(&"-shell-escape".to_string()));
        assert!(args.contains(&"--nosocket".to_string()));
        let separator = args.iter().position(|arg| arg == "--").unwrap();
        assert_eq!(&args[separator + 1..], &["-draft.tex".to_string()]);
    }

    #[test]
    fn staged_install_replaces_the_destination_as_one_sibling_transaction() {
        let root = test_dir("publish");
        let staging = root.join("tinytex.installing");
        let destination = root.join("tinytex");
        std::fs::create_dir_all(&staging).unwrap();
        std::fs::create_dir_all(&destination).unwrap();
        std::fs::write(staging.join("release"), "new").unwrap();
        std::fs::write(destination.join("release"), "old").unwrap();

        publish_staged_tinytex(&staging, &destination).unwrap();

        assert_eq!(
            std::fs::read_to_string(destination.join("release")).unwrap(),
            "new"
        );
        assert!(!staging.exists());
        assert_eq!(
            std::fs::read_to_string(root.join("tinytex.previous/release")).unwrap(),
            "old"
        );
        finalize_published_tinytex(&destination).unwrap();
        assert!(!root.join("tinytex.previous").exists());
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn failed_final_validation_can_restore_the_previous_install() {
        let root = test_dir("publish-rollback");
        let staging = root.join("tinytex.installing");
        let destination = root.join("tinytex");
        std::fs::create_dir_all(&staging).unwrap();
        std::fs::create_dir_all(&destination).unwrap();
        std::fs::write(staging.join("release"), "invalid-new").unwrap();
        std::fs::write(destination.join("release"), "known-old").unwrap();

        publish_staged_tinytex(&staging, &destination).unwrap();
        rollback_published_tinytex(&destination).unwrap();

        assert_eq!(
            std::fs::read_to_string(destination.join("release")).unwrap(),
            "known-old"
        );
        assert!(!root.join("tinytex.previous").exists());
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn staged_install_rejects_a_non_sibling_destination() {
        let root = test_dir("publish-parent");
        let staging = root.join("one/tinytex.installing");
        let destination = root.join("two/tinytex");
        std::fs::create_dir_all(&staging).unwrap();
        std::fs::create_dir_all(destination.parent().unwrap()).unwrap();

        let error = publish_staged_tinytex(&staging, &destination).unwrap_err();

        assert!(error.contains("sibling"));
        assert!(staging.exists());
        assert!(!destination.exists());
        std::fs::remove_dir_all(root).unwrap();
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn tex_utility_probe_times_out_and_stops_a_hung_process() {
        let error = run_tex_utility(
            Path::new("/bin/sh"),
            &["-c".into(), "sleep 30".into()],
            std::time::Duration::from_millis(50),
        )
        .await
        .unwrap_err();
        assert!(error.contains("timed out"), "{error}");
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn tex_utility_rejects_a_descendant_that_keeps_output_pipes_open() {
        let root = test_dir("inherited-pipes");
        std::fs::create_dir_all(&root).unwrap();
        let leaked = root.join("descendant-survived");
        let args = vec![
            "-c".into(),
            "(sleep 0.35; printf leaked > \"$1\") & exit 0".into(),
            "oleafly-pipe-test".into(),
            leaked.to_string_lossy().into_owned(),
        ];
        let started = std::time::Instant::now();

        let error = run_tex_utility_with_pipe_timeout(
            Path::new("/bin/sh"),
            &args,
            std::time::Duration::from_secs(2),
            std::time::Duration::from_millis(75),
        )
        .await
        .unwrap_err();

        assert!(error.contains("output pipes did not close"), "{error}");
        assert!(started.elapsed() < std::time::Duration::from_secs(2));
        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
        assert!(!leaked.exists(), "the inherited-pipe descendant survived");
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn tinytex_filesystem_lock_excludes_another_process_handle() {
        let _env_guard = crate::paths::data_dir_env_lock();
        let previous_data_dir = std::env::var_os("OLEAFLY_DATA_DIR");
        let data = test_dir("filesystem-lock");
        std::env::set_var("OLEAFLY_DATA_DIR", &data);

        let first = acquire_tinytex_process_lock().unwrap();
        let error = acquire_tinytex_process_lock().unwrap_err();
        assert!(error.contains("another Oleafly process"), "{error}");
        drop(first);
        acquire_tinytex_process_lock().unwrap();

        if let Some(previous) = previous_data_dir {
            std::env::set_var("OLEAFLY_DATA_DIR", previous);
        } else {
            std::env::remove_var("OLEAFLY_DATA_DIR");
        }
        std::fs::remove_dir_all(data).unwrap();
    }

    #[cfg(any(unix, windows))]
    #[test]
    fn tex_runtime_lock_allows_readers_and_excludes_tree_mutation() {
        let _env_guard = crate::paths::data_dir_env_lock();
        let previous_data_dir = std::env::var_os("OLEAFLY_DATA_DIR");
        let data = test_dir("runtime-lock");
        std::env::set_var("OLEAFLY_DATA_DIR", &data);

        let first_reader = acquire_tex_runtime_lock(false).unwrap();
        let second_reader = acquire_tex_runtime_lock(false).unwrap();
        assert!(acquire_tex_runtime_lock(true).is_err());
        drop(second_reader);
        drop(first_reader);

        let writer = acquire_tex_runtime_lock(true).unwrap();
        assert!(acquire_tex_runtime_lock(false).is_err());
        drop(writer);
        acquire_tex_runtime_lock(false).unwrap();

        if let Some(previous) = previous_data_dir {
            std::env::set_var("OLEAFLY_DATA_DIR", previous);
        } else {
            std::env::remove_var("OLEAFLY_DATA_DIR");
        }
        std::fs::remove_dir_all(data).unwrap();
    }

    #[allow(clippy::await_holding_lock)]
    #[tokio::test]
    async fn tinytex_delete_cannot_race_an_active_install() {
        let _env_guard = crate::paths::data_dir_env_lock();
        let previous_data_dir = std::env::var_os("OLEAFLY_DATA_DIR");
        let data = test_dir("delete-install-guard");
        std::env::set_var("OLEAFLY_DATA_DIR", &data);
        let root = tinytex_root().unwrap();
        let staging = tinytex_staging_root().unwrap();
        let backup = tinytex_backup_root().unwrap();
        let download = tinytex_download_path().unwrap();
        for directory in [&root, &staging, &backup] {
            std::fs::create_dir_all(directory).unwrap();
        }
        std::fs::write(&download, b"partial").unwrap();

        let state = AppState::default();
        let install = TinytexMutationGuard::acquire_install().unwrap();
        let error = delete_tinytex_synchronized(&state).await.unwrap_err();
        assert!(error.contains("install or removal is already in progress"));
        for path in [&root, &staging, &backup, &download] {
            assert!(path.exists(), "delete raced the active install: {path:?}");
        }
        drop(install);

        delete_tinytex_synchronized(&state).await.unwrap();
        for path in [&root, &staging, &backup, &download] {
            assert!(!path.exists(), "managed install path survived: {path:?}");
        }

        if let Some(previous) = previous_data_dir {
            std::env::set_var("OLEAFLY_DATA_DIR", previous);
        } else {
            std::env::remove_var("OLEAFLY_DATA_DIR");
        }
        std::fs::remove_dir_all(data).unwrap();
    }

    #[allow(clippy::await_holding_lock)]
    #[tokio::test]
    async fn tinytex_delete_waits_for_active_compile_lanes() {
        let _env_guard = crate::paths::data_dir_env_lock();
        let previous_data_dir = std::env::var_os("OLEAFLY_DATA_DIR");
        let data = test_dir("delete-compile-lock");
        std::env::set_var("OLEAFLY_DATA_DIR", &data);
        let root = tinytex_root().unwrap();
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(root.join("in-use"), b"toolchain").unwrap();

        let state = std::sync::Arc::new(AppState::default());
        let compile = state.compile_lock.lock().await;
        let delete_state = std::sync::Arc::clone(&state);
        let deletion =
            tokio::spawn(async move { delete_tinytex_synchronized(delete_state.as_ref()).await });
        tokio::task::yield_now().await;
        assert!(!deletion.is_finished());
        assert!(root.exists());

        drop(compile);
        deletion.await.unwrap().unwrap();
        assert!(!root.exists());

        if let Some(previous) = previous_data_dir {
            std::env::set_var("OLEAFLY_DATA_DIR", previous);
        } else {
            std::env::remove_var("OLEAFLY_DATA_DIR");
        }
        std::fs::remove_dir_all(data).unwrap();
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn tar_xz_extraction_streams_the_linux_arm_archive_shape() {
        use std::io::Write as _;

        let root = test_dir("xz");
        std::fs::create_dir_all(&root).unwrap();
        let archive_path = root.join("tinytex.tar.xz");
        let destination = root.join("out");
        let payload = b"test lualatex";
        let mut tar = tar::Builder::new(Vec::new());
        let mut header = tar::Header::new_gnu();
        header.set_size(payload.len() as u64);
        header.set_mode(0o755);
        header.set_entry_type(tar::EntryType::Regular);
        header.set_cksum();
        tar.append_data(
            &mut header,
            ".TinyTeX/bin/aarch64-linux/lualatex",
            &payload[..],
        )
        .unwrap();
        let tar_bytes = tar.into_inner().unwrap();
        let archive = std::fs::File::create(&archive_path).unwrap();
        let mut encoder = liblzma::write::XzEncoder::new(archive, 6);
        encoder.write_all(&tar_bytes).unwrap();
        encoder.finish().unwrap();

        let member_path = ".TinyTeX/bin/aarch64-linux/lualatex";
        let digest = test_manifest_digest(&[("file", member_path, payload.len() as u64, None)]);
        let asset = test_extraction_asset(ArchiveFormat::TarXz, 1, payload.len() as u64, digest);
        crate::tinytex_archive::extract_all(
            &archive_path,
            asset.format,
            asset.member_policy(),
            &destination,
        )
        .unwrap();

        let extracted = destination.join(".TinyTeX/bin/aarch64-linux/lualatex");
        assert_eq!(std::fs::read(&extracted).unwrap(), payload);
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt as _;
            assert_ne!(
                std::fs::metadata(extracted).unwrap().permissions().mode() & 0o111,
                0
            );
        }
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn engine_kind_only_marks_tools_inside_managed_root_as_tinytex() {
        let managed = Path::new("managed/tinytex");
        assert_eq!(
            engine_kind_for_path(
                Path::new("managed/tinytex/bin/platform/lualatex"),
                Some(managed)
            ),
            "tinytex"
        );
        assert_eq!(
            engine_kind_for_path(
                Path::new("system/texlive/bin/platform/lualatex"),
                Some(managed)
            ),
            "system"
        );
    }

    #[test]
    fn tinytex_tag_is_a_fixed_release() {
        assert_ne!(TINYTEX_TAG, "daily");
        assert!(TINYTEX_TAG.starts_with('v'));
    }

    #[test]
    #[ignore = "downloads are large; run manually against local archives when bumping TINYTEX_TAG"]
    fn pinned_release_archives_pass_reviewed_policies() {
        use sha2::Digest as _;
        use std::io::Read as _;

        let dir = std::env::var("TINYTEX_ARCHIVE_DIR").expect(
            "set TINYTEX_ARCHIVE_DIR to a directory holding the release archives for every platform",
        );
        let mut verified = Vec::new();
        for (os, arch) in [
            ("macos", "aarch64"),
            ("windows", "x86_64"),
            ("linux", "x86_64"),
            ("linux", "aarch64"),
        ] {
            let asset = tinytex_asset_for(os, arch).unwrap();
            let name = asset.url.rsplit('/').next().unwrap();
            let path = std::path::Path::new(&dir).join(name);
            assert!(path.is_file(), "missing archive {name} in {dir}");
            assert_eq!(
                std::fs::metadata(&path).unwrap().len(),
                asset.expected_bytes,
                "{name}: size does not match the pinned release"
            );
            let mut hasher = sha2::Sha256::new();
            let mut file = std::fs::File::open(&path).unwrap();
            let mut buffer = vec![0u8; 1 << 20];
            loop {
                let read = file.read(&mut buffer).unwrap();
                if read == 0 {
                    break;
                }
                hasher.update(&buffer[..read]);
            }
            assert_eq!(
                format!("{:x}", hasher.finalize()),
                asset.expected_sha256,
                "{name}: sha256 does not match the pinned release"
            );
            let result = if asset.format == ArchiveFormat::TarXz && !cfg!(target_os = "linux") {
                let tar = path.with_extension("").with_extension("tar");
                assert!(
                    tar.is_file(),
                    "this host cannot decode xz; place the decompressed {} next to the archive",
                    tar.file_name().unwrap().to_string_lossy()
                );
                crate::tinytex_archive::inspect_tar(
                    std::fs::File::open(tar).unwrap(),
                    asset.member_policy(),
                )
            } else {
                crate::tinytex_archive::inspect_archive(&path, asset.format, asset.member_policy())
            };
            result.unwrap_or_else(|error| panic!("{name}: {error}"));
            verified.push(name.to_string());
        }
        assert_eq!(verified.len(), 4, "expected all four platform archives");
    }

    #[test]
    fn parse_tlmgr_versions_reads_name_and_cat_version() {
        let out = "amsmath,2.17o\nbiblatex,3.20\nlatexmk,4.86a\n";
        let map = parse_tlmgr_versions(out);
        assert_eq!(map.len(), 3);
        assert_eq!(map["amsmath"], "2.17o");
        assert_eq!(map["biblatex"], "3.20");
        assert_eq!(map["latexmk"], "4.86a");
    }

    #[test]
    fn parse_tlmgr_versions_defaults_missing_versions_to_installed() {
        // Packages without a CTAN catalogue version print an empty field.
        let out = "scheme-infraonly,\nhyphen-base,\n";
        let map = parse_tlmgr_versions(out);
        assert_eq!(map["scheme-infraonly"], "installed");
        assert_eq!(map["hyphen-base"], "installed");
    }

    #[test]
    fn parse_tlmgr_versions_skips_malformed_lines() {
        // Lines without a comma (warnings, blank lines) and empty names are
        // dropped instead of poisoning the pin.
        let out = "tlmgr: package repository ...\n\namsmath,2.17o\n,orphan\n";
        let map = parse_tlmgr_versions(out);
        assert_eq!(map.len(), 1);
        assert!(map.contains_key("amsmath"));
    }

    #[test]
    fn parse_tlmgr_versions_trims_whitespace() {
        let out = "  amsmath , 2.17o \n";
        let map = parse_tlmgr_versions(out);
        assert_eq!(map["amsmath"], "2.17o");
    }

    #[test]
    fn validate_package_names_accepts_safe_charset() {
        let ok = vec!["amsmath".into(), "l3kernel".into(), "pdf-tools.x".into()];
        assert!(validate_package_names(&ok).is_ok());
    }

    #[test]
    fn validate_package_names_rejects_flags_and_paths() {
        for bad in ["--gui", "../etc", "a b", "pkg;rm", ""] {
            let list = vec![bad.to_string()];
            assert!(validate_package_names(&list).is_err(), "accepted {bad:?}");
        }
    }

    #[test]
    fn gigabytes_converts_decimal_gb() {
        assert!((gigabytes(2_000_000_000) - 2.0).abs() < f64::EPSILON);
        assert!((gigabytes(0) - 0.0).abs() < f64::EPSILON);
    }
}
