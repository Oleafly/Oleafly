use serde::Serialize;
use tauri::ipc::Response;
use tauri::{Emitter, State};
use tauri_plugin_shell::process::CommandEvent;
use tauri_plugin_shell::ShellExt;

use crate::paths;
use crate::state::AppState;

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

/// Reveal a file or folder in the platform's native file manager
/// (Finder on macOS, Explorer on Windows, xdg-open on Linux).
#[tauri::command]
pub fn reveal_in_dir(path: String) -> Result<(), String> {
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
    let path = canonical.to_string_lossy().to_string();
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .args(["-R", &path])
            .spawn()
            .map_err(|e| format!("failed to open Finder: {e}"))?;
    }
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(format!("/select,{path}"))
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
            .arg(&dir)
            .spawn()
            .map_err(|e| format!("failed to open file manager: {e}"))?;
    }
    Ok(())
}

#[derive(Serialize, Clone)]
pub struct CompileError {
    pub line: Option<u32>,
    pub file: Option<String>,
    pub message: String,
    pub kind: String,
}

#[derive(Serialize, Default)]
pub struct CompileResult {
    pub ok: bool,
    /// Whether a PDF was produced. The bytes are fetched separately via
    /// `read_compiled_pdf` (raw bytes over IPC, no base64 tax).
    pub has_pdf: bool,
    pub log: String,
    pub errors: Vec<CompileError>,
    pub synctex_path: Option<String>,
    pub out_dir: Option<String>,
    pub compile_time_ms: u64,
}

/// Compile a project's main document from disk via the Tectonic sidecar.
///
/// Reads `<project>/<main_doc>` so that `\input`, `\includegraphics`, and
/// `.bib` files resolve relative to the project directory.
#[tauri::command]
pub async fn compile_project(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    project_id: String,
    main_doc: String,
    offline: Option<bool>,
) -> Result<CompileResult, String> {
    // Only one compile at a time; concurrent callers wait here.
    let _guard = state.compile_lock.lock().await;

    let project_dir = paths::project_dir(&project_id)?;
    let build_dir = paths::build_dir(&project_id)?;
    // Validate `main_doc` stays inside the project (rejects absolute paths / `..`).
    let tex_path = crate::project::resolve_in_project(&project_id, &main_doc)?;

    if !tex_path.exists() {
        return Err(format!(
            "main document not found: {main_doc} (in project {project_id})"
        ));
    }

    // Write a compile wrapper that neutralizes pdfLaTeX-only primitives so
    // documents written for pdfLaTeX (e.g. `\input{glyphtounicode}`,
    // `\pdfgentounicode`) compile cleanly under Tectonic's XeTeX engine.
    // XeTeX emits selectable Unicode text natively, so those ATS hacks are
    // unnecessary here.
    let entry_path = build_dir.join(paths::ENTRY_TEX);
    let wrapper = format!(
        "\\ifdefined\\pdfglyphtounicode\\else\\def\\pdfglyphtounicode#1#2{{}}\\fi\n\
         \\ifdefined\\pdfgentounicode\\else\\newcount\\pdfgentounicode\\fi\n\
         \\input{{{main_doc}}}\n"
    );
    std::fs::write(&entry_path, wrapper)
        .map_err(|e| format!("failed to write compile entry: {e}"))?;

    run_tectonic(
        &app,
        &entry_path,
        &build_dir,
        &project_dir,
        paths::ENTRY_STEM,
        "compile:log",
        offline.unwrap_or(false),
    )
    .await
}

/// Spawn Tectonic on `entry_path`, streaming log lines to `log_event`, and
/// assemble a `CompileResult` from the outputs written to `out_dir` under `stem`.
/// Shared by the main-document compile and the isolated figure compile.
async fn run_tectonic(
    app: &tauri::AppHandle,
    entry_path: &std::path::Path,
    out_dir: &std::path::Path,
    search_root: &std::path::Path,
    stem: &str,
    log_event: &str,
    offline: bool,
) -> Result<CompileResult, String> {
    let entry_str = entry_path.to_string_lossy().to_string();
    let out_str = out_dir.to_string_lossy().to_string();
    let search_opt = format!("search-path={}", search_root.to_string_lossy());

    let sidecar = app
        .shell()
        .sidecar("tectonic")
        .map_err(|e| format!("sidecar lookup failed: {e}"))?;

    let compile_start = std::time::Instant::now();
    let args = tectonic_args(&out_str, &search_opt, &entry_str, offline);
    let arg_refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();

    let (mut rx, _child) = sidecar
        .args(arg_refs)
        .spawn()
        .map_err(|e| format!("failed to spawn tectonic: {e}"))?;

    let mut stdout_buf = String::new();
    let mut exit_code: Option<i32> = None;
    while let Some(event) = rx.recv().await {
        match event {
            CommandEvent::Stdout(bytes) | CommandEvent::Stderr(bytes) => {
                let s = String::from_utf8_lossy(&bytes).into_owned();
                let _ = app.emit(log_event, &s);
                stdout_buf.push_str(&s);
            }
            CommandEvent::Error(err) => {
                let _ = app.emit(log_event, &err);
            }
            CommandEvent::Terminated(payload) => exit_code = payload.code,
            _ => {}
        }
    }

    let log = std::fs::read_to_string(out_dir.join(format!("{stem}.log")))
        .unwrap_or_else(|_| stdout_buf.clone());
    let pdf_path = out_dir.join(format!("{stem}.pdf"));
    let synctex_path = out_dir.join(format!("{stem}.synctex.gz"));
    let has_pdf = pdf_path.exists();
    let errors = parse_log_errors(&log);

    Ok(CompileResult {
        ok: has_pdf && exit_code.unwrap_or(-1) == 0,
        has_pdf,
        log,
        errors,
        synctex_path: synctex_path
            .exists()
            .then(|| synctex_path.to_string_lossy().into_owned()),
        out_dir: Some(out_str),
        compile_time_ms: compile_start.elapsed().as_millis() as u64,
    })
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
    let _guard = state.compile_lock.lock().await;
    let project_dir = paths::project_dir(&project_id)?;
    let fig_dir = paths::figure_build_dir(&project_id)?;
    let entry_path = fig_dir.join("_figure.tex");
    // Remove stale outputs so a failed compile can never return a previous
    // figure's PDF (which would show the wrong image).
    let _ = std::fs::remove_file(fig_dir.join("_figure.pdf"));
    let _ = std::fs::remove_file(fig_dir.join("_figure.log"));
    std::fs::write(&entry_path, source)
        .map_err(|e| format!("failed to write figure source: {e}"))?;
    run_tectonic(
        &app,
        &entry_path,
        &fig_dir,
        &project_dir,
        "_figure",
        "figure:log",
        offline.unwrap_or(false),
    )
    .await
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

/// Build the Tectonic sidecar argument list. Pure, so the ordering (notably
/// that `--only-cached` follows the `compile` subcommand) is unit-testable.
fn tectonic_args(out_dir: &str, search_path: &str, entry: &str, offline: bool) -> Vec<String> {
    let mut args: Vec<String> = vec![
        "-X".into(),
        "compile".into(),
        "--synctex".into(),
        "--keep-logs".into(),
        "--print".into(),
        "--outdir".into(),
        out_dir.into(),
        "-Z".into(),
        search_path.into(),
        entry.into(),
    ];
    if offline {
        // `--only-cached` is a flag of the `compile` subcommand, so it must come
        // right AFTER `compile` (index 2), not between `-X` and `compile`.
        args.insert(2, "--only-cached".into());
    }
    args
}

/// Return the last-compiled PDF for a project as raw bytes (no base64 tax).
/// `tauri::ipc::Response` sends the bytes straight through IPC; the frontend
/// receives an `ArrayBuffer`.
#[tauri::command]
pub async fn read_compiled_pdf(project_id: String) -> Result<Response, String> {
    let bytes = tauri::async_runtime::spawn_blocking(move || -> Result<Vec<u8>, String> {
        let build = paths::build_dir(&project_id)?;
        let pdf = build.join(format!("{}.pdf", paths::ENTRY_STEM));
        std::fs::read(&pdf).map_err(|e| format!("no compiled PDF: {e}"))
    })
    .await
    .map_err(|e| e.to_string())??;
    Ok(Response::new(bytes))
}

/// Parse a TeX `.log` for error/warning lines and their source line numbers.
fn parse_log_errors(log: &str) -> Vec<CompileError> {
    let mut out = Vec::new();
    let lines: Vec<&str> = log.lines().collect();
    let n = lines.len();
    let mut i = 0;
    while i < n {
        let line = lines[i];
        if let Some(msg) = line.strip_prefix("! ") {
            let mut line_no = None;
            let lookahead = (4).min(n.saturating_sub(i + 1));
            for j in 1..=lookahead {
                let l = lines[i + j];
                if l.starts_with('!') {
                    break;
                }
                if let Some(rest) = l.strip_prefix("l.") {
                    let digits: String = rest.chars().take_while(|c| c.is_ascii_digit()).collect();
                    if let Ok(num) = digits.parse::<u32>() {
                        line_no = Some(num);
                        break;
                    }
                }
            }
            out.push(CompileError {
                line: line_no,
                file: None,
                message: msg.to_string(),
                kind: "error".to_string(),
            });
        }
        i += 1;
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_error_with_line_number() {
        let log = "This is the transcript.\n! Undefined control sequence.\nl.42 \\badcmd\n";
        let errs = parse_log_errors(log);
        assert_eq!(errs.len(), 1);
        assert_eq!(errs[0].line, Some(42));
        assert_eq!(errs[0].kind, "error");
        assert!(errs[0].message.contains("Undefined control sequence"));
    }

    #[test]
    fn error_without_line_number() {
        let errs = parse_log_errors("! Emergency stop.\n");
        assert_eq!(errs.len(), 1);
        assert_eq!(errs[0].line, None);
    }

    #[test]
    fn clean_log_has_no_errors() {
        assert!(parse_log_errors("Overfull \\hbox\nOutput written on doc.pdf\n").is_empty());
    }

    #[test]
    fn stops_scanning_line_number_at_next_error() {
        // The `l.N` belongs to the second error, not the first.
        let log = "! First error.\n! Second error.\nl.7 foo\n";
        let errs = parse_log_errors(log);
        assert_eq!(errs.len(), 2);
        assert_eq!(errs[0].line, None);
        assert_eq!(errs[1].line, Some(7));
    }

    #[test]
    fn offline_flag_immediately_follows_compile() {
        let args = tectonic_args("/out", "search-path=/p", "e.tex", true);
        let compile = args.iter().position(|a| a == "compile").unwrap();
        let flag = args.iter().position(|a| a == "--only-cached").unwrap();
        assert_eq!(args[0], "-X");
        assert_eq!(flag, compile + 1, "--only-cached must follow `compile`");
    }

    #[test]
    fn online_build_has_no_only_cached() {
        let args = tectonic_args("/out", "search-path=/p", "e.tex", false);
        assert!(!args.iter().any(|a| a == "--only-cached"));
        assert_eq!(args[0], "-X");
        assert_eq!(args[1], "compile");
    }

    #[test]
    fn decode_b64_roundtrip_and_rejects_garbage() {
        use base64::{engine::general_purpose::STANDARD, Engine};
        let enc = STANDARD.encode(b"PNGDATA");
        assert_eq!(decode_b64(&enc).unwrap(), b"PNGDATA");
        assert!(decode_b64("not*base64!").is_err());
    }
}
