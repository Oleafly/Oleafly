//! Optional LuaLaTeX engine for tagged, accessible (PDF/UA) export.
//!
//! Tectonic (the bundled default) is XeTeX-based and cannot produce tagged
//! PDFs. Tagged output needs LuaLaTeX + TeX Live 2025 or newer. Rather than
//! bundle a heavy toolchain by default, we mirror the Pandoc model: detect an
//! engine the user already has, and otherwise offer an on-demand TinyTeX
//! install (a ~100MB TeX Live that installs to the user's home dir with no
//! admin rights and manages packages with `tlmgr`). Everything here is opt-in
//! and deletable from Settings.

use std::path::{Path, PathBuf};
use std::process::Command;

use crate::paths;
use crate::proc::NoConsole;
use crate::state::AppState;

/// rstudio/tinytex-releases scheme "1" (the default set, ~100MB). The exact tag
/// should be validated on a real machine; the manual-install fallback covers
/// platforms/versions we cannot fetch automatically.
const TINYTEX_TAG: &str = "daily";

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

fn exe(name: &str) -> String {
    if cfg!(windows) {
        format!("{name}.exe")
    } else {
        name.to_string()
    }
}

fn runs(cmd: &str) -> bool {
    Command::new(cmd)
        .no_console()
        .arg("--version")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

/// Search `root` for `bin/<platform>/<name>` (TeX distributions nest binaries
/// under a per-platform directory). Bounded, non-recursive beyond that shape.
fn find_in_texdir(root: &Path, name: &str) -> Option<PathBuf> {
    let bin = root.join("bin");
    let entries = std::fs::read_dir(&bin).ok()?;
    for e in entries.flatten() {
        let cand = e.path().join(exe(name));
        if cand.exists() {
            return Some(cand);
        }
    }
    None
}

/// Our own TinyTeX install root: `~/.oleafly/tinytex`.
fn tinytex_root() -> Result<PathBuf, String> {
    Ok(paths::oleafly_root()?.join("tinytex"))
}

/// The directory TinyTeX was extracted into may nest one level (e.g. `TinyTeX/`
/// or `.TinyTeX/`); return whichever directory actually holds `bin/*/lualatex`.
fn tinytex_texdir() -> Option<PathBuf> {
    let root = tinytex_root().ok()?;
    let mut candidates = vec![root.clone()];
    if let Ok(entries) = std::fs::read_dir(&root) {
        for e in entries.flatten() {
            if e.path().is_dir() {
                candidates.push(e.path());
            }
        }
    }
    candidates
        .into_iter()
        .find(|c| find_in_texdir(c, "lualatex").is_some())
}

/// Locate a usable LuaLaTeX (and its sibling `tlmgr`), preferring our own
/// TinyTeX, then a system TeX Live. GUI apps launch with a minimal PATH, so we
/// probe common install locations too.
fn find_engine() -> EngineInfo {
    // 1. Our TinyTeX install (guaranteed writable for tlmgr).
    if let Some(dir) = tinytex_texdir() {
        let lua = find_in_texdir(&dir, "lualatex");
        let tlmgr = find_in_texdir(&dir, "tlmgr");
        if let Some(lua) = lua {
            return EngineInfo {
                kind: "tinytex".into(),
                version: engine_version(&lua.to_string_lossy()),
                lualatex: Some(lua.to_string_lossy().to_string()),
                tlmgr: tlmgr.map(|t| t.to_string_lossy().to_string()),
                latexmk: find_in_texdir(&dir, "latexmk")
                    .map(|p| p.to_string_lossy().into_owned())
                    .or_else(find_latexmk),
            };
        }
    }

    // 2. A LuaLaTeX on PATH.
    if runs("lualatex") {
        let tlmgr = if runs("tlmgr") {
            Some("tlmgr".to_string())
        } else {
            None
        };
        return EngineInfo {
            kind: "system".into(),
            version: engine_version("lualatex"),
            lualatex: Some("lualatex".to_string()),
            tlmgr,
            latexmk: find_latexmk(),
        };
    }

    // 3. Shared discovery: MacTeX, TeX Live (by year), MiKTeX, TinyTeX-in-home.
    // These dirs hold binaries directly (bin/<platform> nesting already resolved).
    for dir in crate::tex_distro::tex_bin_dirs() {
        let direct = dir.join(exe("lualatex"));
        if direct.exists() && runs(&direct.to_string_lossy()) {
            let tlmgr = dir.join(exe("tlmgr"));
            return EngineInfo {
                kind: "system".into(),
                version: engine_version(&direct.to_string_lossy()),
                lualatex: Some(direct.to_string_lossy().to_string()),
                tlmgr: tlmgr.exists().then(|| tlmgr.to_string_lossy().to_string()),
                latexmk: find_latexmk(),
            };
        }
    }

    EngineInfo::none()
}

fn engine_version(lualatex: &str) -> Option<String> {
    let out = Command::new(lualatex)
        .no_console()
        .arg("--version")
        .output()
        .ok()?;
    let text = String::from_utf8_lossy(&out.stdout);
    text.lines().next().map(|l| l.trim().to_string())
}

// These commands run external processes (lualatex/tlmgr) which can take a second
// or more. They are `async` and use `spawn_blocking` so they run OFF the main
// thread; a synchronous Tauri command would block the whole webview UI.

#[tauri::command]
pub async fn latex_engine_info() -> EngineInfo {
    tauri::async_runtime::spawn_blocking(find_engine)
        .await
        .unwrap_or_else(|_| EngineInfo::none())
}

#[tauri::command]
pub async fn has_tagging_engine() -> bool {
    tauri::async_runtime::spawn_blocking(|| find_engine().lualatex.is_some())
        .await
        .unwrap_or(false)
}

// --- TinyTeX install machinery -----------------------------------------------
//
// The install is long (100 MB+ download, large extraction) and must survive
// user impatience: progress is phased, the partial download resumes across
// failures and app launches, and quitting mid-install is intercepted so the
// user decides deliberately.

use std::sync::atomic::{AtomicBool, Ordering};

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

/// The user confirmed the "quit during install?" dialog: let the close through.
#[tauri::command]
pub fn confirm_quit_during_install(app: tauri::AppHandle) {
    QUIT_CONFIRMED.store(true, Ordering::SeqCst);
    app.exit(0);
}

/// Releases the install flag on every exit path, including errors and panics.
struct InstallGuard;

impl InstallGuard {
    fn acquire() -> Result<Self, String> {
        INSTALL_ACTIVE
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .map_err(|_| "A TinyTeX install is already in progress.".to_string())?;
        Ok(InstallGuard)
    }
}

impl Drop for InstallGuard {
    fn drop(&mut self) {
        INSTALL_ACTIVE.store(false, Ordering::SeqCst);
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

/// Core download is ~100 MB and unpacks to roughly 500 MB; journal templates
/// pull more via tlmgr afterwards. Refuse to start below this floor so an
/// install never strands the user with a full disk.
const MIN_FREE_BYTES: u64 = 1_500_000_000;

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
        tinytex_root()
            .ok()
            .map(|root| root.join(DOWNLOAD_TMP))
            .and_then(|tmp| std::fs::metadata(tmp).ok())
            .map(|meta| meta.len())
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

fn tinytex_asset() -> Result<(String, bool), String> {
    let base =
        format!("https://github.com/rstudio/tinytex-releases/releases/download/{TINYTEX_TAG}");
    if cfg!(target_os = "windows") {
        Ok((format!("{base}/TinyTeX-1.zip"), false))
    } else if cfg!(target_os = "macos") {
        // macOS bundle is universal (bin/universal-darwin), so arm64 is fine.
        Ok((format!("{base}/TinyTeX-1.tar.gz"), true))
    } else if cfg!(target_os = "linux") {
        // The Linux TinyTeX bundle ships only bin/x86_64-linux binaries; there is
        // no upstream aarch64-linux build. Fail early rather than download ~100MB
        // of binaries that can't run.
        if std::env::consts::ARCH == "x86_64" {
            Ok((format!("{base}/TinyTeX-1.tar.gz"), true))
        } else {
            Err(format!(
                "Automatic TinyTeX install is not available for Linux {}. Install a LuaLaTeX / TeX Live 2025 toolchain from your package manager.",
                std::env::consts::ARCH
            ))
        }
    } else {
        Err("Automatic TinyTeX install is not supported on this platform. Install a LuaLaTeX / TeX Live 2025 toolchain manually.".to_string())
    }
}

/// Extract an entire archive into `dest_dir` (TinyTeX is a directory tree, not a
/// single binary). Sanitizes paths so entries stay inside `dest_dir`.
fn extract_all(archive: &Path, is_targz: bool, dest_dir: &Path) -> Result<(), String> {
    std::fs::create_dir_all(dest_dir).map_err(|e| e.to_string())?;
    let file = std::fs::File::open(archive).map_err(|e| e.to_string())?;
    if is_targz {
        let gz = flate2::read::GzDecoder::new(file);
        let mut ar = tar::Archive::new(gz);
        // TinyTeX ships bin/<platform>/{lualatex,tlmgr,xelatex,...} as SYMLINKS
        // into its script/binary tree, and its real binaries carry the 0755 exec
        // bit. The previous hand-rolled copy skipped every symlink and dropped
        // the mode, so after a "successful" extract there was no runnable engine
        // on Linux/macOS. `unpack_in` recreates symlinks and preserves unix
        // permissions, and STILL refuses any entry whose path would escape
        // `dest_dir` (it returns Ok(false) and skips it), so the traversal
        // protection the manual loop provided is retained.
        ar.set_preserve_permissions(true);
        ar.set_overwrite(true);
        for entry in ar.entries().map_err(|e| e.to_string())? {
            let mut entry = entry.map_err(|e| e.to_string())?;
            entry.unpack_in(dest_dir).map_err(|e| e.to_string())?;
        }
    } else {
        let mut zip = zip::ZipArchive::new(file).map_err(|e| e.to_string())?;
        for i in 0..zip.len() {
            let mut f = zip.by_index(i).map_err(|e| e.to_string())?;
            let rel = match f.enclosed_name() {
                Some(p) => p.to_path_buf(),
                None => continue, // skip entries with unsafe paths
            };
            let out = dest_dir.join(rel);
            if f.is_dir() {
                std::fs::create_dir_all(&out).map_err(|e| e.to_string())?;
            } else {
                if let Some(parent) = out.parent() {
                    std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
                }
                let mut o = std::fs::File::create(&out).map_err(|e| e.to_string())?;
                std::io::copy(&mut f, &mut o).map_err(|e| e.to_string())?;
            }
        }
    }
    Ok(())
}

/// Download and install TinyTeX on demand under `~/.oleafly/tinytex`.
///
/// Emits phased `tinytex-install-progress` events (download / extract /
/// packages). The download resumes from a previous partial file (HTTP Range),
/// including across app launches after a force-quit. On failure the partial
/// file is kept so Retry continues instead of starting over.
#[tauri::command]
pub async fn install_tinytex(app: tauri::AppHandle) -> Result<EngineInfo, String> {
    use futures_util::StreamExt;
    use std::io::Write as _;
    use tauri::Emitter;

    let existing = find_engine();
    if existing.lualatex.is_some() {
        return Ok(existing);
    }

    let _install = InstallGuard::acquire()?;

    let (url, is_targz) = tinytex_asset()?;
    let root = tinytex_root()?;
    std::fs::create_dir_all(&root).map_err(|e| e.to_string())?;
    let tmp = root.join(DOWNLOAD_TMP);

    // Fail before downloading a byte if the disk cannot hold the install.
    if let Some(free) = free_disk_space(&root) {
        if free < MIN_FREE_BYTES {
            return Err(format!(
                "Not enough free disk space to install TinyTeX. It needs about {:.1} GB \
                 (download plus extraction, with room for LaTeX packages); this disk has \
                 {:.1} GB free. Free up space, then try again.",
                gigabytes(MIN_FREE_BYTES),
                gigabytes(free)
            ));
        }
    }

    // Resume from a previous partial download when the server honors Range;
    // a 200 (full body) response restarts cleanly from zero.
    let already = std::fs::metadata(&tmp).map(|m| m.len()).unwrap_or(0);
    let client = reqwest::Client::new();
    let mut request = client.get(&url);
    if already > 0 {
        request = request.header(reqwest::header::RANGE, format!("bytes={already}-"));
    }
    let resp = request
        .send()
        .await
        .map_err(|e| format!("download failed: {e}"))?
        .error_for_status()
        .map_err(|e| format!("download failed: {e}"))?;
    let resuming = resp.status() == reqwest::StatusCode::PARTIAL_CONTENT && already > 0;
    let total = if resuming {
        resp.content_length().map(|remaining| remaining + already)
    } else {
        resp.content_length()
    };
    let mut file = if resuming {
        std::fs::OpenOptions::new()
            .append(true)
            .open(&tmp)
            .map_err(|e| e.to_string())?
    } else {
        std::fs::File::create(&tmp).map_err(|e| e.to_string())?
    };
    let mut received: u64 = if resuming { already } else { 0 };
    let mut stream = resp.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| {
            format!("download interrupted: {e}. Your progress is saved; retry to resume.")
        })?;
        received += chunk.len() as u64;
        file.write_all(&chunk).map_err(|e| e.to_string())?;
        let _ = app.emit(
            "tinytex-install-progress",
            EngineProgress {
                phase: "download",
                received,
                total,
            },
        );
    }
    file.flush().map_err(|e| e.to_string())?;
    drop(file);

    // The archive is ~100MB; extract off the async runtime so it doesn't block
    // the webview UI while unpacking.
    let _ = app.emit(
        "tinytex-install-progress",
        EngineProgress {
            phase: "extract",
            received: 0,
            total: None,
        },
    );
    let tmp_extract = tmp.clone();
    let root_extract = root.clone();
    let extracted = tauri::async_runtime::spawn_blocking(move || {
        extract_all(&tmp_extract, is_targz, &root_extract)
    })
    .await
    .map_err(|e| e.to_string())?;
    if extracted.is_err() {
        // A truncated or corrupt archive cannot be resumed into a good one:
        // clear it so the next attempt downloads fresh.
        let _ = std::fs::remove_file(&tmp);
    }
    extracted?;
    let _ = std::fs::remove_file(&tmp);

    let info = find_engine();
    if info.lualatex.is_none() {
        return Err(
            "TinyTeX installed but no lualatex was found in it. Install a toolchain manually."
                .to_string(),
        );
    }

    // TinyTeX's default bundle ships latexmk, but be defensive: if it is
    // missing, pull it via tlmgr so the latexmk engine works out of the box.
    if info.latexmk.is_none() {
        let _ = app.emit(
            "tinytex-install-progress",
            EngineProgress {
                phase: "packages",
                received: 0,
                total: None,
            },
        );
        let installed =
            tauri::async_runtime::spawn_blocking(|| tlmgr_run("install", vec!["latexmk".into()]))
                .await;
        if let Ok(Err(error)) = installed {
            // Not fatal for the tagged-export flow; surface in the log only.
            eprintln!("tlmgr install latexmk failed: {error}");
        }
        return Ok(find_engine());
    }
    Ok(info)
}

/// Remove our TinyTeX install to free disk space.
#[tauri::command]
pub async fn delete_tinytex() -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(|| -> Result<(), String> {
        let root = tinytex_root()?;
        if root.exists() {
            std::fs::remove_dir_all(&root).map_err(|e| format!("failed to remove TinyTeX: {e}"))?;
        }
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

fn tlmgr_path() -> Result<String, String> {
    find_engine()
        .tlmgr
        .ok_or_else(|| "No tlmgr found. Install TinyTeX to manage LaTeX packages.".to_string())
}

/// Names of installed TeX packages (via `tlmgr info --only-installed`). Runs on a
/// blocking thread: `tlmgr info` can take a second or more.
#[tauri::command]
pub async fn tlmgr_installed() -> Result<Vec<String>, String> {
    match tauri::async_runtime::spawn_blocking(tlmgr_installed_blocking).await {
        Ok(r) => r,
        Err(e) => Err(e.to_string()),
    }
}

fn tlmgr_installed_blocking() -> Result<Vec<String>, String> {
    let tlmgr = tlmgr_path()?;
    let out = Command::new(&tlmgr)
        .no_console()
        .args(["info", "--only-installed", "--data", "name"])
        .output()
        .map_err(|e| format!("failed to run tlmgr: {e}"))?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
    }
    Ok(String::from_utf8_lossy(&out.stdout)
        .lines()
        .map(|l| l.trim().to_string())
        .filter(|l| !l.is_empty())
        .collect())
}

/// Installed package -> revision, for the reproducibility pin in project.json.
/// `cat-version` is the CTAN version where known; the TeX Live revision fills
/// in when it is not. Empty map when no tlmgr exists (e.g. MiKTeX).
pub fn tlmgr_installed_versions() -> Result<std::collections::BTreeMap<String, String>, String> {
    let tlmgr = tlmgr_path()?;
    let out = Command::new(&tlmgr)
        .no_console()
        .args([
            "info",
            "--only-installed",
            "--data",
            "name,revision,cat-version",
        ])
        .output()
        .map_err(|e| format!("failed to run tlmgr: {e}"))?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
    }
    let mut versions = std::collections::BTreeMap::new();
    for line in String::from_utf8_lossy(&out.stdout).lines() {
        let mut fields = line.trim().splitn(3, ',');
        let Some(name) = fields.next().map(str::trim).filter(|n| !n.is_empty()) else {
            continue;
        };
        let revision = fields.next().map(str::trim).unwrap_or("");
        let cat_version = fields.next().map(str::trim).unwrap_or("");
        let version = if cat_version.is_empty() {
            format!("r{revision}")
        } else {
            cat_version.to_string()
        };
        versions.insert(name.to_string(), version);
    }
    Ok(versions)
}

/// Install TeX packages by name via tlmgr. Returns the combined output log.
#[tauri::command]
pub async fn tlmgr_install(packages: Vec<String>) -> Result<String, String> {
    match tauri::async_runtime::spawn_blocking(move || tlmgr_run("install", packages)).await {
        Ok(r) => r,
        Err(e) => Err(e.to_string()),
    }
}

/// Remove TeX packages by name via tlmgr.
#[tauri::command]
pub async fn tlmgr_remove(packages: Vec<String>) -> Result<String, String> {
    match tauri::async_runtime::spawn_blocking(move || tlmgr_run("remove", packages)).await {
        Ok(r) => r,
        Err(e) => Err(e.to_string()),
    }
}

fn tlmgr_run(action: &str, packages: Vec<String>) -> Result<String, String> {
    if packages.is_empty() {
        return Ok(String::new());
    }
    // Names are validated to a safe charset so they cannot be flags/paths.
    for p in &packages {
        if !p
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '.')
        {
            return Err(format!("invalid package name: {p}"));
        }
    }
    let tlmgr = tlmgr_path()?;
    let mut cmd = Command::new(&tlmgr);
    cmd.no_console().arg(action).arg("--");
    for p in &packages {
        cmd.arg(p);
    }
    let out = cmd
        .output()
        .map_err(|e| format!("failed to run tlmgr: {e}"))?;
    let log = format!(
        "{}{}",
        String::from_utf8_lossy(&out.stdout),
        String::from_utf8_lossy(&out.stderr)
    );
    if !out.status.success() {
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

/// Compile the (prepared) main document with LuaLaTeX to produce a tagged PDF.
/// Unlike the Tectonic path, this runs LuaLaTeX directly on the main file so
/// `\DocumentMetadata` remains the first line. Writes the PDF to the same build
/// location Tectonic uses, so the existing `read_compiled_pdf` and the Preflight
/// verifier pick it up unchanged. Runs twice to resolve references.
#[tauri::command]
pub async fn compile_tagged(
    state: tauri::State<'_, AppState>,
    project_id: String,
    main_doc: String,
) -> Result<TaggedCompileResult, String> {
    // This writes the same build outputs (`_oleafly_entry.pdf`, etc.) as
    // `compile_project`, which serializes on `compile_lock`. Hold that same lock
    // for the whole run so a Tectonic and a LuaLaTeX compile can't clobber each
    // other's outputs. The guard is held until the end of this function (across
    // the spawn_blocking await below).
    let _guard = state.compile_lock.lock().await;

    let meta = crate::project::read_compile_meta(&project_id, &main_doc)?;
    let engine = find_engine();
    let lualatex = engine
        .lualatex
        .ok_or_else(|| "No LuaLaTeX engine available. Install TinyTeX first.".to_string())?;

    let project_dir = paths::project_dir(&project_id)?;
    let build_dir = paths::build_dir(&project_id)?;
    // Validate main_doc stays inside the project (rejects absolute paths / `..`).
    let tex_path = crate::project::resolve_in_project(&project_id, &main_doc)?;
    if !tex_path.exists() {
        return Err(format!("main document not found: {main_doc}"));
    }
    std::fs::create_dir_all(&build_dir).map_err(|e| e.to_string())?;

    let out_dir = build_dir.to_string_lossy().to_string();

    // Both LuaLaTeX passes spawn a process and block; run them off the async
    // runtime. Move the small owned values the closure needs.
    let lualatex = PathBuf::from(&lualatex);
    let main_doc_c = main_doc.clone();
    let project_dir_c = project_dir.clone();
    let build_dir_c = build_dir.clone();

    let mut result =
        tauri::async_runtime::spawn_blocking(move || -> Result<TaggedCompileResult, String> {
            let pdf = build_dir_c.join(format!("{}.pdf", paths::ENTRY_STEM));
            match std::fs::remove_file(&pdf) {
                Ok(()) => {}
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                Err(error) => {
                    return Err(format!(
                        "failed to clear stale tagged PDF {}: {error}",
                        pdf.display()
                    ));
                }
            }
            let mut log = String::new();
            let mut success = false;
            for pass in 0..2 {
                let out = Command::new(&lualatex)
                    .no_console()
                    .arg("-interaction=nonstopmode")
                    .arg("-file-line-error")
                    .arg(format!("-output-directory={out_dir}"))
                    .arg(format!("-jobname={}", paths::ENTRY_STEM))
                    .arg("--")
                    .arg(&main_doc_c)
                    .current_dir(&project_dir_c)
                    .output()
                    .map_err(|e| format!("failed to run lualatex: {e}"))?;
                log = format!(
                    "{}{}",
                    String::from_utf8_lossy(&out.stdout),
                    String::from_utf8_lossy(&out.stderr)
                );
                success = out.status.success();
                if !success && pass == 0 {
                    break; // a hard failure on the first pass won't be fixed by a second
                }
            }

            let output_id = std::fs::read(&pdf)
                .ok()
                .map(|bytes| crate::document_engine::fingerprint_compile_output(&bytes));
            let has_pdf = output_id.is_some();
            Ok(TaggedCompileResult {
                success: success && has_pdf,
                has_pdf,
                output_id,
                output_revision: None,
                log,
            })
        })
        .await
        .map_err(|e| e.to_string())??;
    // The fingerprint above is still only a candidate. Revalidate the
    // persisted project/main selection under the shared compile lock before
    // publishing either the identity or a success revision.
    if let Err(error) =
        crate::project::ensure_compile_meta_unchanged(&project_id, &main_doc, &meta.engine)
    {
        result.success = false;
        result.has_pdf = false;
        result.output_id = None;
        result.output_revision = None;
        result
            .log
            .push_str(&format!("\nOleafly rejected the tagged output: {error}"));
        return Ok(result);
    }
    if result.success {
        result.output_revision = Some(
            state
                .compile_output_revision
                .fetch_add(1, std::sync::atomic::Ordering::SeqCst)
                + 1,
        );
    }
    Ok(result)
}
