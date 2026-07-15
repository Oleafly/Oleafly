use tauri::ipc::Response;
use tauri::State;

use crate::document_engine::{CompileRequest, CompileResult, CompileTarget};
use crate::paths;
use crate::proc::NoConsole;
use crate::state::AppState;

const MAX_QUEUED_PROJECTS: usize = 128;

fn register_compile_ticket(
    latest: &mut std::collections::HashMap<String, u64>,
    project_id: &str,
    ticket: u64,
) -> Result<(), String> {
    if latest.len() >= MAX_QUEUED_PROJECTS && !latest.contains_key(project_id) {
        return Err("too many projects are already queued for compilation".into());
    }
    latest.insert(project_id.to_owned(), ticket);
    Ok(())
}

fn take_latest_compile_ticket(
    latest: &mut std::collections::HashMap<String, u64>,
    project_id: &str,
    ticket: u64,
) -> bool {
    if latest.get(project_id) != Some(&ticket) {
        return false;
    }
    latest.remove(project_id);
    true
}

/// Returns the OpenLeaf projects root (`~/.openleaf/projects`).
#[tauri::command]
pub fn library_root() -> Result<std::path::PathBuf, String> {
    paths::projects_root()
}

/// Returns the compiled-in app version (from Cargo.toml).
#[tauri::command]
pub fn app_version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}

#[tauri::command]
pub fn project_engine(
    project_id: String,
) -> Result<crate::document_engine::EngineDescriptor, String> {
    let meta = crate::project::read_meta(&project_id)?;
    crate::document_engine::descriptor_for(&meta.engine, &meta.main_doc)
}

/// Whether the running install can apply a downloaded update in place. Tauri's
/// Linux updater can only replace a running AppImage (it reads `$APPIMAGE`); a
/// `.deb`/`.rpm` install has no `APPIMAGE`, so `downloadAndInstall` would fail.
/// The update UI uses this to offer a "download from Releases" link instead of a
/// broken in-place "Update now" on those installs. macOS and Windows always
/// self-update.
#[tauri::command]
pub fn updater_self_installable() -> bool {
    if cfg!(target_os = "linux") {
        std::env::var_os("APPIMAGE").is_some()
    } else {
        true
    }
}

/// Whether `path` may be revealed in the OS file manager.
/// Allowed: anything under the OpenLeaf data root, or a path the user just
/// exported via a native save dialog (short-lived allowlist).
fn assert_revealable(
    canonical: &std::path::Path,
    allowlist: &std::collections::VecDeque<std::path::PathBuf>,
) -> Result<(), String> {
    if let Ok(root) = paths::openleaf_root() {
        if let Ok(rr) = root.canonicalize() {
            if canonical.starts_with(&rr) {
                return Ok(());
            }
        } else if canonical.starts_with(&root) {
            return Ok(());
        }
    }
    if allowlist.iter().any(|p| p == canonical) {
        return Ok(());
    }
    Err(
        "refusing to reveal a path outside OpenLeaf's data directory \
         (export destinations must come from a successful save)"
            .into(),
    )
}

/// Reveal a file or folder in the platform's native file manager
/// (Finder on macOS, Explorer on Windows, xdg-open on Linux).
#[tauri::command]
pub fn reveal_in_dir(path: String, state: State<'_, AppState>) -> Result<(), String> {
    let raw = std::path::Path::new(&path);
    if !raw.exists() {
        return Err(format!("path does not exist: {path}"));
    }
    // Normalize (resolve `.`/`..`/symlinks) before handing the path to the OS
    // opener, so a crafted relative or dotted path can't point somewhere
    // unexpected.
    let canonical = raw
        .canonicalize()
        .map_err(|e| format!("cannot resolve path: {e}"))?;
    {
        let allow = state.reveal_allowlist.blocking_lock();
        assert_revealable(&canonical, &allow)?;
    }
    let path = canonical.to_string_lossy().to_string();
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .no_console()
            .args(["-R", &path])
            .spawn()
            .map_err(|e| format!("failed to open Finder: {e}"))?;
    }
    #[cfg(target_os = "windows")]
    {
        // `canonicalize` returns an extended-length `\\?\C:\...` (or
        // `\\?\UNC\server\share`) path. explorer.exe cannot parse the `\\?\`
        // verbatim prefix for `/select`, so strip it back to a normal path or
        // the reveal silently fails / opens the wrong place.
        let display = path
            .strip_prefix(r"\\?\UNC\")
            .map(|rest| format!(r"\\{rest}"))
            .or_else(|| path.strip_prefix(r"\\?\").map(str::to_string))
            .unwrap_or_else(|| path.clone());
        std::process::Command::new("explorer")
            .no_console()
            .arg(format!("/select,{display}"))
            .spawn()
            .map_err(|e| format!("failed to open Explorer: {e}"))?;
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        let dir = canonical
            .parent()
            .map(|d| d.to_string_lossy().into_owned())
            .unwrap_or(path.clone());
        std::process::Command::new("xdg-open")
            .no_console()
            .arg(&dir)
            .spawn()
            .map_err(|e| format!("failed to open file manager: {e}"))?;
    }
    Ok(())
}

#[tauri::command]
pub async fn compile_project(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    project_id: String,
    main_doc: String,
    offline: Option<bool>,
) -> Result<CompileResult, String> {
    let ticket = state
        .compile_ticket
        .fetch_add(1, std::sync::atomic::Ordering::SeqCst);
    {
        let mut latest = state.latest_compile.lock().await;
        register_compile_ticket(&mut latest, &project_id, ticket)?;
    }

    #[cfg(debug_assertions)]
    eprintln!("compile: t{ticket} {project_id} requested");
    #[cfg(debug_assertions)]
    let req_at = std::time::Instant::now();

    let _guard = state.compile_lock.lock().await;

    #[cfg(debug_assertions)]
    eprintln!(
        "compile: t{ticket} {project_id} lock after {}ms",
        req_at.elapsed().as_millis()
    );

    {
        let mut latest = state.latest_compile.lock().await;
        if !take_latest_compile_ticket(&mut latest, &project_id, ticket) {
            #[cfg(debug_assertions)]
            eprintln!("compile: t{ticket} {project_id} superseded, skipping");
            return Ok(CompileResult {
                ok: false,
                has_pdf: false,
                log: "superseded by a newer compile request".into(),
                errors: Vec::new(),
                synctex_path: None,
                out_dir: None,
                compile_time_ms: 0,
            });
        }
    }

    let project_dir = paths::project_dir(&project_id)?;
    let build_dir = paths::build_dir(&project_id)?;
    let source_path = crate::project::resolve_in_project(&project_id, &main_doc)?;
    if !source_path.exists() {
        return Err(format!(
            "main document not found: {main_doc} (in project {project_id})"
        ));
    }
    let meta = crate::project::read_meta(&project_id)?;
    if meta.main_doc != main_doc {
        return Err("main document changed; refresh the project and compile again".into());
    }
    let engine = crate::document_engine::engine_for(&meta.engine, &main_doc)?;
    let prepared_spec = crate::document_engine::prepare_compile_spec(
        engine.id(),
        build_dir.clone(),
        project_dir.clone(),
        CompileTarget::Main {
            main_document: &main_doc,
        },
        offline.unwrap_or(false),
    )
    .await?;
    let current_meta = crate::project::read_meta(&project_id)?;
    if current_meta.main_doc != meta.main_doc || current_meta.engine != meta.engine {
        return Err("main document changed; refresh the project and compile again".into());
    }

    let result = crate::document_engine::compile(CompileRequest {
        app: &app,
        engine,
        out_dir: &build_dir,
        project_dir: &project_dir,
        target: CompileTarget::Main {
            main_document: &main_doc,
        },
        log_event: "compile:log",
        offline: offline.unwrap_or(false),
        prepared_spec: Some(prepared_spec),
    })
    .await;
    #[cfg(debug_assertions)]
    if let Ok(r) = &result {
        eprintln!(
            "compile: t{ticket} {project_id} done ok={} in {}ms",
            r.ok, r.compile_time_ms
        );
    }
    result
}

/// Write base64-decoded bytes to an absolute path chosen by the user (e.g. a
/// native "Save as" dialog). Used to export a rendered figure PNG. Mirrors the
/// trust model of `export_pdf` (the destination comes from a user dialog).
/// Hardened with `guard_export_dest` so a crafted IPC call cannot write to a
/// relative path or a missing parent (same checks as PDF export).
#[tauri::command]
pub async fn write_bytes_file(
    dest: String,
    data_base64: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    crate::sandbox::guard_export_dest(&dest)?;
    let bytes = decode_b64(&data_base64)?;
    let dest_for_allow = dest.clone();
    tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
        std::fs::write(&dest, bytes).map_err(|e| format!("failed to write {dest}: {e}"))
    })
    .await
    .map_err(|e| e.to_string())??;
    // Permit a subsequent "Reveal in Finder/Explorer" for this export path.
    if let Ok(canon) = std::path::Path::new(&dest_for_allow).canonicalize() {
        let mut allow = state.reveal_allowlist.lock().await;
        if allow.len() >= 1024 {
            allow.pop_front();
        }
        allow.push_back(canon);
    } else {
        let mut allow = state.reveal_allowlist.lock().await;
        if allow.len() >= 1024 {
            allow.pop_front();
        }
        allow.push_back(std::path::PathBuf::from(dest_for_allow));
    }
    Ok(())
}

/// Decode a base64 payload for `write_project_bytes`. Pure, so it is unit-testable.
fn decode_b64(data_base64: &str) -> Result<Vec<u8>, String> {
    use base64::{engine::general_purpose::STANDARD, Engine};
    STANDARD
        .decode(data_base64.as_bytes())
        .map_err(|e| format!("invalid base64: {e}"))
}

/// Compile a standalone figure document in isolation, so figure iteration is
/// fast and never touches the main preview PDF. The `source` is a full
/// `\documentclass{standalone}` document; it is written to
/// `.openleaf/figbuild/_figure.tex` and compiled directly (no pdfLaTeX wrapper,
/// which would collide with the standalone document class).
#[tauri::command]
pub async fn compile_isolated(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    project_id: String,
    source: String,
    offline: Option<bool>,
) -> Result<CompileResult, String> {
    #[cfg(debug_assertions)]
    eprintln!("figure: {project_id} requested");
    #[cfg(debug_assertions)]
    let req_at = std::time::Instant::now();
    // Figure builds use a separate dir and lock so they never block main-document
    // compiles (or get blocked by them).
    let _guard = state.figure_compile_lock.lock().await;
    #[cfg(debug_assertions)]
    eprintln!(
        "figure: {project_id} lock after {}ms",
        req_at.elapsed().as_millis()
    );
    let project_dir = paths::project_dir(&project_id)?;
    let meta = crate::project::read_meta(&project_id)?;
    let engine = crate::document_engine::engine_for(&meta.engine, &meta.main_doc)?;
    if !engine.capabilities().supports_isolated_compile {
        return Err(format!(
            "engine `{}` does not support isolated compilation",
            engine.id().as_str()
        ));
    }
    let fig_dir = paths::figure_build_dir(&project_id)?;
    let entry_path = fig_dir.join("_figure.tex");
    std::fs::write(&entry_path, source)
        .map_err(|e| format!("failed to write figure source: {e}"))?;
    let result = crate::document_engine::compile(CompileRequest {
        app: &app,
        engine,
        out_dir: &fig_dir,
        project_dir: &project_dir,
        target: CompileTarget::Isolated {
            source_path: &entry_path,
            output_stem: "_figure",
        },
        log_event: "figure:log",
        offline: offline.unwrap_or(false),
        prepared_spec: None,
    })
    .await;
    #[cfg(debug_assertions)]
    if let Ok(r) = &result {
        eprintln!(
            "figure: {project_id} done ok={} in {}ms",
            r.ok, r.compile_time_ms
        );
    }
    result
}

/// Return the last isolated figure PDF for a project as raw bytes.
#[tauri::command]
pub async fn read_isolated_pdf(project_id: String) -> Result<Response, String> {
    let bytes = tauri::async_runtime::spawn_blocking(move || -> Result<Vec<u8>, String> {
        let dir = paths::figure_build_dir(&project_id)?;
        std::fs::read(dir.join("_figure.pdf")).map_err(|e| format!("no figure PDF: {e}"))
    })
    .await
    .map_err(|e| e.to_string())??;
    Ok(Response::new(bytes))
}

/// Read raw bytes from a project-relative path (path-guarded). Used to hand an
/// existing project image (e.g. a hand-drawn sketch) to a vision model.
#[tauri::command]
pub async fn read_project_bytes(project_id: String, rel_path: String) -> Result<Response, String> {
    let target = crate::project::resolve_in_project(&project_id, &rel_path)?;
    let bytes = tauri::async_runtime::spawn_blocking(move || -> Result<Vec<u8>, String> {
        std::fs::read(&target).map_err(|e| format!("cannot read {rel_path}: {e}"))
    })
    .await
    .map_err(|e| e.to_string())??;
    Ok(Response::new(bytes))
}

/// Write raw bytes (base64-encoded over IPC) to a project-relative path. Used to
/// persist an accepted figure's PNG into the visible `figures/` folder.
#[tauri::command]
pub async fn write_project_bytes(
    project_id: String,
    rel_path: String,
    data_base64: String,
) -> Result<(), String> {
    let bytes = decode_b64(&data_base64)?;
    let target = crate::project::resolve_in_project(&project_id, &rel_path)?;
    tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
        if let Some(parent) = target.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        std::fs::write(&target, bytes).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Return the last-compiled PDF for a project as raw bytes (no base64 tax).
/// `tauri::ipc::Response` sends the bytes straight through IPC; the frontend
/// receives an `ArrayBuffer`.
#[tauri::command]
pub async fn read_compiled_pdf(project_id: String) -> Result<Response, String> {
    let bytes = tauri::async_runtime::spawn_blocking(move || -> Result<Vec<u8>, String> {
        let meta = crate::project::read_meta(&project_id)?;
        let pdf =
            crate::document_engine::compiled_pdf_path(&project_id, &meta.engine, &meta.main_doc)?;
        std::fs::read(&pdf).map_err(|e| format!("no compiled PDF: {e}"))
    })
    .await
    .map_err(|e| e.to_string())??;
    Ok(Response::new(bytes))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decode_b64_roundtrip_and_rejects_garbage() {
        use base64::{engine::general_purpose::STANDARD, Engine};
        let enc = STANDARD.encode(b"PNGDATA");
        assert_eq!(decode_b64(&enc).unwrap(), b"PNGDATA");
        assert!(decode_b64("not*base64!").is_err());
    }

    #[test]
    fn compile_ticket_queue_is_bounded_without_eviction() {
        let mut latest = std::collections::HashMap::new();
        for i in 0..MAX_QUEUED_PROJECTS {
            register_compile_ticket(&mut latest, &format!("project-{i}"), i as u64).unwrap();
        }
        assert!(register_compile_ticket(&mut latest, "overflow", 999).is_err());
        assert_eq!(latest.len(), MAX_QUEUED_PROJECTS);
        assert_eq!(latest.get("project-0"), Some(&0));

        register_compile_ticket(&mut latest, "project-0", 1000).unwrap();
        assert_eq!(latest.get("project-0"), Some(&1000));
    }

    #[test]
    fn compile_ticket_is_removed_only_by_its_latest_request() {
        let mut latest = std::collections::HashMap::from([("project".to_string(), 2)]);
        assert!(!take_latest_compile_ticket(&mut latest, "project", 1));
        assert_eq!(latest.get("project"), Some(&2));
        assert!(take_latest_compile_ticket(&mut latest, "project", 2));
        assert!(latest.is_empty());
    }

    #[test]
    fn reveal_capability_matches_only_the_exact_export() {
        let exported = std::path::PathBuf::from("/outside/openleaf/export.pdf");
        let allow = std::collections::VecDeque::from([exported.clone()]);
        assert!(assert_revealable(&exported, &allow).is_ok());
        assert!(assert_revealable(exported.parent().unwrap(), &allow).is_err());
        assert!(assert_revealable(&exported.join("child"), &allow).is_err());
    }
}
