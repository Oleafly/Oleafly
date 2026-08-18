use tauri::ipc::Response;
use tauri::{Manager, State};

use crate::document_engine::{CompileRequest, CompileResult, CompileTarget};
use crate::paths;
use crate::proc::NoConsole;
use crate::state::AppState;

const MAX_QUEUED_PROJECTS: usize = 128;
const MAX_PROJECT_BINARY_READ_BYTES: u64 = 8 * 1024 * 1024;

#[tauri::command]
pub fn reload_views(app: tauri::AppHandle, window: tauri::WebviewWindow) {
    let caller = window.label();
    for (label, view) in app.webview_windows() {
        if label != caller {
            let _ = view.reload();
        }
    }
    let _ = window.eval("setTimeout(() => location.reload(), 0)");
}

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

/// Returns the Oleafly projects root (`~/.oleafly/projects`).
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
    let mut descriptor = crate::document_engine::descriptor_for(&meta.engine, &meta.main_doc)?;
    descriptor.tex_flavor = meta.tex_flavor;
    descriptor.allow_shell_escape = meta.allow_shell_escape;
    Ok(descriptor)
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
/// Allowed: anything under the Oleafly data root, or a path the user just
/// exported via a native save dialog (short-lived allowlist).
fn assert_revealable(
    canonical: &std::path::Path,
    allowlist: &std::collections::VecDeque<std::path::PathBuf>,
) -> Result<(), String> {
    if let Ok(root) = paths::oleafly_root() {
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
        "refusing to reveal a path outside Oleafly's data directory \
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
        let mut command = std::process::Command::new("open");
        command.no_console().args(["-R", &path]);
        crate::proc::spawn_contained(&mut command)
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
        let mut command = std::process::Command::new("explorer");
        command.no_console().arg(format!("/select,{display}"));
        crate::proc::spawn_contained(&mut command)
            .map_err(|e| format!("failed to open Explorer: {e}"))?;
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        let dir = canonical
            .parent()
            .map(|d| d.to_string_lossy().into_owned())
            .unwrap_or(path.clone());
        let mut command = std::process::Command::new("xdg-open");
        command.no_console().arg(&dir);
        crate::proc::spawn_contained(&mut command)
            .map_err(|e| format!("failed to open file manager: {e}"))?;
    }
    Ok(())
}

/// Ends the running main-document compile, if any. Returns whether a compiler
/// process was actually terminated.
#[tauri::command]
pub async fn cancel_compile(state: State<'_, AppState>) -> Result<bool, String> {
    match state.compile_cancel.request() {
        Some(pid) => {
            crate::proc::terminate_process_tree(pid).await;
            Ok(true)
        }
        None => Ok(false),
    }
}

/// Empties a project's build directory so the next compile cannot reuse any
/// cached auxiliary file. The directory itself is recreated.
#[tauri::command]
pub async fn clear_build_dir(project_id: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
        let build_dir = paths::build_dir(&project_id)?;
        if build_dir.exists() {
            std::fs::remove_dir_all(&build_dir)
                .map_err(|error| format!("failed to clear build directory: {error}"))?;
        }
        std::fs::create_dir_all(&build_dir)
            .map_err(|error| format!("failed to recreate build directory: {error}"))
    })
    .await
    .map_err(|error| format!("failed to clear build directory: {error}"))?
}

#[tauri::command]
pub async fn compile_project(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    project_id: String,
    main_doc: String,
    offline: Option<bool>,
    fast: Option<bool>,
    halt_on_error: Option<bool>,
) -> Result<CompileResult, String> {
    let options = crate::document_engine::CompileOptions {
        offline: offline.unwrap_or(false),
        fast: fast.unwrap_or(false),
        halt_on_error: halt_on_error.unwrap_or(false),
        // The project's pinned compiler is applied after the meta read below.
        latex_flavor: None,
        allow_shell_escape: false,
    };
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
                output_id: None,
                output_revision: None,
                log: "superseded by a newer compile request".into(),
                errors: Vec::new(),
                synctex_path: None,
                out_dir: None,
                compile_time_ms: 0,
                stopped: false,
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
    let meta = crate::project::read_compile_meta(&project_id, &main_doc)?;
    let options = crate::document_engine::CompileOptions {
        latex_flavor: meta
            .tex_flavor
            .as_deref()
            .and_then(crate::document_engine::LatexmkFlavor::parse),
        allow_shell_escape: meta.allow_shell_escape,
        ..options
    };
    let engine = crate::document_engine::engine_for(&meta.engine, &main_doc)?;
    let prepared_spec = crate::document_engine::prepare_compile_spec(
        engine.id(),
        build_dir.clone(),
        project_dir.clone(),
        CompileTarget::Main {
            main_document: &main_doc,
        },
        options,
    )
    .await?;
    crate::project::ensure_compile_meta_unchanged(&project_id, &main_doc, &meta.engine)?;

    let mut result = crate::document_engine::compile(CompileRequest {
        app: &app,
        engine,
        out_dir: &build_dir,
        project_dir: &project_dir,
        target: CompileTarget::Main {
            main_document: &main_doc,
        },
        log_event: "compile:log",
        options,
        cancel: Some(&state.compile_cancel),
        prepared_spec: Some(prepared_spec),
    })
    .await?;
    // `document_engine::compile` has now fingerprinted the output, but do not
    // publish that identity or allocate a revision until the persisted
    // project/main selection is revalidated under the same compile lock.
    if let Err(error) =
        crate::project::ensure_compile_meta_unchanged(&project_id, &main_doc, &meta.engine)
    {
        result.ok = false;
        result.has_pdf = false;
        result.output_id = None;
        result.output_revision = None;
        result
            .log
            .push_str(&format!("\nOleafly rejected the compile output: {error}"));
        return Ok(result);
    }
    if result.ok {
        result.output_revision = Some(
            state
                .compile_output_revision
                .fetch_add(1, std::sync::atomic::Ordering::SeqCst)
                + 1,
        );
        // Provenance record (engine + distribution + lockfile hash) for
        // "my coauthor's PDF looks different" debugging. Best-effort, off
        // the command path.
        let record_project = project_id.clone();
        let record_engine = meta.engine.clone();
        let record_output = result.output_id.clone();
        let record_revision = result.output_revision.unwrap_or(0);
        let record_time = result.compile_time_ms;
        tauri::async_runtime::spawn_blocking(move || {
            crate::project::write_build_metadata(
                &record_project,
                record_revision,
                &record_engine,
                record_output.as_deref(),
                record_time,
            );
        });
        // Persist the compile fingerprint so reopening the project can skip
        // an unchanged recompile. Best-effort and off the command path: a
        // missing or stale record only costs one recompile on open. Sources
        // are hashed at compile end; an edit made *during* this compile can
        // make the record claim currency for a slightly newer source set,
        // which at worst shows that same one-compile-stale preview on reopen.
        if let (Some(output_id), Some(output_revision)) =
            (result.output_id.clone(), result.output_revision)
        {
            let fp_project = project_id.clone();
            let fp_main = main_doc.clone();
            let fp_engine = meta.engine.clone();
            tauri::async_runtime::spawn_blocking(move || {
                let Ok(root) = paths::project_dir(&fp_project) else {
                    return;
                };
                let Ok(sources) = crate::compile_fingerprint::source_hashes(&root) else {
                    return;
                };
                let compiled_at_ms = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map(|elapsed| elapsed.as_millis() as u64)
                    .unwrap_or(0);
                let record = crate::compile_fingerprint::CompileFingerprint {
                    version: crate::compile_fingerprint::FINGERPRINT_VERSION,
                    main_document: fp_main,
                    engine_id: fp_engine,
                    output_id,
                    output_revision,
                    compiled_at_ms,
                    sources,
                };
                let _ = crate::compile_fingerprint::write_fingerprint(&root, &record);
            });
        }
    }
    #[cfg(debug_assertions)]
    eprintln!(
        "compile: t{ticket} {project_id} done ok={} in {}ms",
        result.ok, result.compile_time_ms
    );
    Ok(result)
}

#[derive(serde::Serialize)]
pub struct ValidatedCompileFingerprint {
    pub main_document: String,
    pub engine_id: String,
    pub output_id: String,
    pub output_revision: u64,
    pub compiled_at_ms: u64,
}

/// Check whether the persisted compile fingerprint still matches the current
/// sources, main document, and engine. `None` means "compile normally".
/// A valid record also seeds the session's output-revision counter, so new
/// compiles this session always outrank the restored one.
#[tauri::command]
pub async fn validate_compile_fingerprint(
    state: State<'_, AppState>,
    project_id: String,
    main_doc: String,
) -> Result<Option<ValidatedCompileFingerprint>, String> {
    let meta = crate::project::read_compile_meta(&project_id, &main_doc)?;
    let root = paths::project_dir(&project_id)?;
    let validated = tauri::async_runtime::spawn_blocking(move || {
        crate::compile_fingerprint::validate_fingerprint(&root, &main_doc, &meta.engine)
    })
    .await
    .map_err(|e| e.to_string())?;
    Ok(validated.map(|record| {
        state
            .compile_output_revision
            .fetch_max(record.output_revision, std::sync::atomic::Ordering::SeqCst);
        ValidatedCompileFingerprint {
            main_document: record.main_document,
            engine_id: record.engine_id,
            output_id: record.output_id,
            output_revision: record.output_revision,
            compiled_at_ms: record.compiled_at_ms,
        }
    }))
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
    let bytes = decode_b64(&data_base64)?;
    let dest_for_allow = dest.clone();
    tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
        let transaction = crate::sandbox::AtomicFile::for_export(&dest)?;
        std::fs::write(transaction.staging_path(), bytes)
            .map_err(|e| format!("failed to write staged artifact: {e}"))?;
        transaction.commit()
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
/// `.oleafly/figbuild/_figure.tex` and compiled directly (no pdfLaTeX wrapper,
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
        options: crate::document_engine::CompileOptions {
            offline: offline.unwrap_or(false),
            latex_flavor: meta
                .tex_flavor
                .as_deref()
                .and_then(crate::document_engine::LatexmkFlavor::parse),
            ..Default::default()
        },
        cancel: None,
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
fn open_regular_nofollow(target: &std::path::Path) -> std::io::Result<std::fs::File> {
    let mut options = std::fs::OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt as _;
        options.custom_flags(libc::O_NOFOLLOW);
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt as _;
        use windows_sys::Win32::Storage::FileSystem::FILE_FLAG_OPEN_REPARSE_POINT;
        options.custom_flags(FILE_FLAG_OPEN_REPARSE_POINT);
    }
    options.open(target)
}

#[cfg(windows)]
fn metadata_is_reparse_point(metadata: &std::fs::Metadata) -> bool {
    use std::os::windows::fs::MetadataExt as _;
    metadata.file_attributes() & 0x400 != 0
}

#[cfg(not(windows))]
fn metadata_is_reparse_point(_metadata: &std::fs::Metadata) -> bool {
    false
}

fn read_regular_file_limited(
    target: &std::path::Path,
    display_path: &str,
    max_bytes: u64,
) -> Result<Vec<u8>, String> {
    use std::io::Read as _;

    let metadata = std::fs::symlink_metadata(target)
        .map_err(|e| format!("cannot inspect {display_path}: {e}"))?;
    if metadata.file_type().is_symlink()
        || metadata_is_reparse_point(&metadata)
        || !metadata.is_file()
    {
        return Err(format!(
            "cannot read {display_path}: not a regular project file"
        ));
    }
    if metadata.len() > max_bytes {
        return Err(format!(
            "cannot read {display_path}: file exceeds the {max_bytes}-byte limit"
        ));
    }
    let file =
        open_regular_nofollow(target).map_err(|e| format!("cannot read {display_path}: {e}"))?;
    let opened_metadata = file
        .metadata()
        .map_err(|e| format!("cannot inspect opened {display_path}: {e}"))?;
    if !opened_metadata.is_file()
        || metadata_is_reparse_point(&opened_metadata)
        || opened_metadata.len() > max_bytes
    {
        return Err(format!(
            "cannot read {display_path}: opened file exceeds the {max_bytes}-byte limit or is not regular"
        ));
    }
    let mut bytes = Vec::with_capacity(opened_metadata.len() as usize);
    file.take(max_bytes.saturating_add(1))
        .read_to_end(&mut bytes)
        .map_err(|e| format!("cannot read {display_path}: {e}"))?;
    if bytes.len() as u64 > max_bytes {
        return Err(format!(
            "cannot read {display_path}: file exceeds the {max_bytes}-byte limit"
        ));
    }
    Ok(bytes)
}

#[tauri::command]
pub async fn read_project_bytes(project_id: String, rel_path: String) -> Result<Response, String> {
    let target = crate::project::resolve_in_project(&project_id, &rel_path)?;
    let bytes = tauri::async_runtime::spawn_blocking(move || {
        read_regular_file_limited(&target, &rel_path, MAX_PROJECT_BINARY_READ_BYTES)
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
    expected_generation: Option<u64>,
) -> Result<crate::project::FileMutationResult, String> {
    let admission =
        crate::project::admit_project_file_write(project_id, rel_path, expected_generation)?;
    tauri::async_runtime::spawn_blocking(move || {
        let bytes = decode_b64(&data_base64)?;
        admission.write(&bytes)
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
    fn project_binary_reads_reject_non_files_and_oversized_payloads_before_allocation() {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path();
        let small = root.join("small.png");
        let large = root.join("large.png");
        std::fs::write(&small, b"png").unwrap();
        std::fs::write(&large, b"12345").unwrap();

        assert_eq!(
            read_regular_file_limited(&small, "small.png", 3).unwrap(),
            b"png"
        );
        assert!(read_regular_file_limited(&large, "large.png", 4)
            .unwrap_err()
            .contains("4-byte limit"));
        assert!(read_regular_file_limited(root, "folder", 100)
            .unwrap_err()
            .contains("regular project file"));
        std::fs::remove_dir_all(root).unwrap();
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
        let exported = std::path::PathBuf::from("/outside/oleafly/export.pdf");
        let allow = std::collections::VecDeque::from([exported.clone()]);
        assert!(assert_revealable(&exported, &allow).is_ok());
        assert!(assert_revealable(exported.parent().unwrap(), &allow).is_err());
        assert!(assert_revealable(&exported.join("child"), &allow).is_err());
    }
}
