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
}

impl EngineInfo {
    fn none() -> Self {
        EngineInfo {
            kind: "none".into(),
            lualatex: None,
            tlmgr: None,
            version: None,
        }
    }
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

/// Our own TinyTeX install root: `~/.openleaf/tinytex`.
fn tinytex_root() -> Result<PathBuf, String> {
    Ok(paths::openleaf_root()?.join("tinytex"))
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
        };
    }

    // 3. Common system TeX Live / MacTeX / TinyTeX-in-home locations.
    let mut roots: Vec<PathBuf> = vec![
        PathBuf::from("/Library/TeX/texbin"), // macOS MacTeX symlink dir (holds binaries directly)
        PathBuf::from("/usr/local/bin"),
        PathBuf::from("/opt/homebrew/bin"),
    ];
    if let Ok(home) = std::env::var("HOME") {
        roots.push(PathBuf::from(&home).join(".TinyTeX"));
    }
    // texbin-style dirs hold the binaries directly (no bin/<platform> nesting).
    for dir in &roots {
        let direct = dir.join(exe("lualatex"));
        if direct.exists() && runs(&direct.to_string_lossy()) {
            let tlmgr = dir.join(exe("tlmgr"));
            return EngineInfo {
                kind: "system".into(),
                version: engine_version(&direct.to_string_lossy()),
                lualatex: Some(direct.to_string_lossy().to_string()),
                tlmgr: tlmgr.exists().then(|| tlmgr.to_string_lossy().to_string()),
            };
        }
        if let Some(lua) = find_in_texdir(dir, "lualatex") {
            let tlmgr = find_in_texdir(dir, "tlmgr");
            return EngineInfo {
                kind: "system".into(),
                version: engine_version(&lua.to_string_lossy()),
                lualatex: Some(lua.to_string_lossy().to_string()),
                tlmgr: tlmgr.map(|t| t.to_string_lossy().to_string()),
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

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

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

#[derive(Clone, serde::Serialize)]
struct EngineProgress {
    received: u64,
    total: Option<u64>,
}

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

/// Download and install TinyTeX on demand under `~/.openleaf/tinytex`. Emits
/// `tinytex-download-progress` events; returns the resulting engine info.
#[tauri::command]
pub async fn install_tinytex(app: tauri::AppHandle) -> Result<EngineInfo, String> {
    use futures_util::StreamExt;
    use std::io::Write as _;
    use tauri::Emitter;

    let existing = find_engine();
    if existing.lualatex.is_some() {
        return Ok(existing);
    }

    let (url, is_targz) = tinytex_asset()?;
    let root = tinytex_root()?;
    std::fs::create_dir_all(&root).map_err(|e| e.to_string())?;
    let tmp = root.join("tinytex-download.tmp");

    let resp = reqwest::get(&url)
        .await
        .map_err(|e| format!("download failed: {e}"))?
        .error_for_status()
        .map_err(|e| format!("download failed: {e}"))?;
    let total = resp.content_length();
    let mut file = std::fs::File::create(&tmp).map_err(|e| e.to_string())?;
    let mut stream = resp.bytes_stream();
    let mut received: u64 = 0;
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("download interrupted: {e}"))?;
        received += chunk.len() as u64;
        file.write_all(&chunk).map_err(|e| e.to_string())?;
        let _ = app.emit(
            "tinytex-download-progress",
            EngineProgress { received, total },
        );
    }
    file.flush().map_err(|e| e.to_string())?;
    drop(file);

    // The archive is ~100MB; extract off the async runtime so it doesn't block
    // the webview UI while unpacking.
    let tmp_extract = tmp.clone();
    let root_extract = root.clone();
    let extracted = tauri::async_runtime::spawn_blocking(move || {
        extract_all(&tmp_extract, is_targz, &root_extract)
    })
    .await
    .map_err(|e| e.to_string())?;
    let _ = std::fs::remove_file(&tmp);
    extracted?;

    let info = find_engine();
    if info.lualatex.is_none() {
        return Err(
            "TinyTeX installed but no lualatex was found in it. Install a toolchain manually."
                .to_string(),
        );
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
    // This writes the same build outputs (`_openleaf_entry.pdf`, etc.) as
    // `compile_project`, which serializes on `compile_lock`. Hold that same lock
    // for the whole run so a Tectonic and a LuaLaTeX compile can't clobber each
    // other's outputs. The guard is held until the end of this function (across
    // the spawn_blocking await below).
    let _guard = state.compile_lock.lock().await;

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

    tauri::async_runtime::spawn_blocking(move || -> Result<TaggedCompileResult, String> {
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

        let pdf = build_dir_c.join(format!("{}.pdf", paths::ENTRY_STEM));
        let has_pdf = pdf.exists();
        Ok(TaggedCompileResult {
            success: success && has_pdf,
            has_pdf,
            log,
        })
    })
    .await
    .map_err(|e| e.to_string())?
}
