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

    let entry_str = entry_path.to_string_lossy().to_string();
    let out_str = build_dir.to_string_lossy().to_string();
    let project_str = project_dir.to_string_lossy().to_string();
    let search_opt = format!("search-path={project_str}");

    let sidecar = app
        .shell()
        .sidecar("tectonic")
        .map_err(|e| format!("sidecar lookup failed: {e}"))?;

    let compile_start = std::time::Instant::now();

    let args = tectonic_args(&out_str, &search_opt, &entry_str, offline.unwrap_or(false));
    let arg_refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();

    let (mut rx, _child) = sidecar
        .args(arg_refs)
        .spawn()
        .map_err(|e| format!("failed to spawn tectonic: {e}"))?;

    let mut stdout_buf = String::new();
    let mut exit_code: Option<i32> = None;

    while let Some(event) = rx.recv().await {
        match event {
            CommandEvent::Stdout(bytes) => {
                let s = String::from_utf8_lossy(&bytes).into_owned();
                let _ = app.emit("compile:log", &s);
                stdout_buf.push_str(&s);
            }
            CommandEvent::Stderr(bytes) => {
                let s = String::from_utf8_lossy(&bytes).into_owned();
                let _ = app.emit("compile:log", &s);
                stdout_buf.push_str(&s);
            }
            CommandEvent::Error(err) => {
                let _ = app.emit("compile:log", &err);
            }
            CommandEvent::Terminated(payload) => {
                exit_code = payload.code;
            }
            _ => {}
        }
    }

    // Outputs are named after the wrapper stem (`_openleaf_entry`).
    let stem = paths::ENTRY_STEM;
    let log = std::fs::read_to_string(build_dir.join(format!("{stem}.log")))
        .unwrap_or_else(|_| stdout_buf.clone());

    let pdf_path = build_dir.join(format!("{stem}.pdf"));
    let synctex_path = build_dir.join(format!("{stem}.synctex.gz"));

    // The PDF bytes are fetched separately (read_compiled_pdf) as raw bytes; here
    // we only report whether one was produced.
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
pub fn read_compiled_pdf(project_id: String) -> Result<Response, String> {
    let build = paths::build_dir(&project_id)?;
    let pdf = build.join(format!("{}.pdf", paths::ENTRY_STEM));
    let bytes = std::fs::read(&pdf).map_err(|e| format!("no compiled PDF: {e}"))?;
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
}
