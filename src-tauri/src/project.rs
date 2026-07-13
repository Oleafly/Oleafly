use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

use crate::paths;
use crate::proc::NoConsole;
use crate::sandbox::{guard_export_dest, is_root_delete, resolve};

/// Public path resolver (sandbox). Re-exported so call sites keep importing
/// `crate::project::resolve_in_project`.
pub use crate::sandbox::resolve_in_project;

const DEFAULT_MAIN_TEX: &str = "\\documentclass[11pt]{article}\n\
\\usepackage[T1]{fontenc}\n\
\\usepackage{hyperref}\n\
\n\
\\title{Untitled}\n\
\\author{}\n\
\n\
\\begin{document}\n\
\\maketitle\n\
\n\
\\section{Introduction}\n\
Write your \\LaTeX{} here.\n\
\n\
\\end{document}\n";

#[derive(Serialize, Deserialize, Default, Clone)]
pub struct ProjectMeta {
    #[serde(default)]
    pub name: String,
    #[serde(default = "default_main_doc")]
    pub main_doc: String,
    #[serde(default = "default_engine")]
    pub engine: String,
    /// Book-cover color (hex). Empty means "unset" so the UI falls back to its
    /// default. Stored on disk so a project's color survives across machines.
    #[serde(default)]
    pub color: String,
    /// "" / "document" for a normal project, "image" for a single-figure project
    /// (standalone) that previews the compiled image and hides doc-only tools.
    #[serde(default)]
    pub kind: String,
    #[serde(default)]
    pub exports: Vec<ExportRecord>,
}

#[derive(Serialize, Deserialize, Default, Clone)]
pub struct ExportRecord {
    pub date: f64,
    pub filename: String,
    pub path: String,
}

fn default_main_doc() -> String {
    "main.tex".to_string()
}
fn default_engine() -> String {
    "xetex".to_string()
}

#[derive(Serialize)]
pub struct FileEntry {
    pub path: String,
    pub is_dir: bool,
}

#[derive(Serialize)]
pub struct ProjectInfo {
    pub id: String,
    pub name: String,
    pub main_doc: String,
    pub updated_at: f64,
    /// Book-cover color (hex), or empty if unset (UI falls back to its default).
    pub color: String,
}

fn meta_path(project_id: &str) -> Result<PathBuf, String> {
    Ok(paths::project_dir(project_id)?.join("project.json"))
}

pub fn read_meta(project_id: &str) -> Result<ProjectMeta, String> {
    let p = meta_path(project_id)?;
    if !p.exists() {
        return Ok(ProjectMeta {
            name: project_id.to_string(),
            main_doc: default_main_doc(),
            engine: default_engine(),
            color: String::new(),
            kind: String::new(),
            exports: Vec::new(),
        });
    }
    let s = std::fs::read_to_string(&p).map_err(|e| format!("failed to read project.json: {e}"))?;
    let mut meta: ProjectMeta =
        serde_json::from_str(&s).map_err(|e| format!("invalid project.json: {e}"))?;
    if meta.main_doc.is_empty() {
        meta.main_doc = default_main_doc();
    }
    if meta.engine.is_empty() {
        meta.engine = default_engine();
    }
    Ok(meta)
}

pub fn write_meta(project_id: &str, meta: &ProjectMeta) -> Result<(), String> {
    let p = meta_path(project_id)?;
    let s = serde_json::to_string_pretty(meta).map_err(|e| e.to_string())?;
    std::fs::write(&p, s).map_err(|e| format!("failed to write project.json: {e}"))
}

/// Relative path from `root` to `path`, always with forward-slash separators.
/// On Windows `to_string_lossy` yields backslashes; the frontend builds the file
/// tree and matches SyncTeX files by splitting on "/", so paths must be
/// normalized here or subfolders won't nest and lookups mismatch on Windows.
fn rel_slash(root: &Path, path: &Path) -> String {
    path.strip_prefix(root)
        .unwrap_or(path)
        .to_string_lossy()
        .replace('\\', "/")
}

/// Cap recursion depth on directory walks so a deep (or symlink-induced) tree
/// can't blow the stack or hang the app.
const MAX_WALK_DEPTH: usize = 64;

fn walk(root: &Path, dir: &Path, out: &mut Vec<FileEntry>, depth: usize) -> Result<(), String> {
    if depth >= MAX_WALK_DEPTH {
        return Ok(());
    }
    let entries = std::fs::read_dir(dir).map_err(|e| e.to_string())?;
    let mut items: Vec<_> = entries
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    items.sort_by_key(|e| e.file_name());
    for entry in items {
        let name = entry.file_name();
        let name_str = name.to_string_lossy();
        if name_str == ".openleaf" || name_str == ".localleaf" || name_str == ".git" {
            continue;
        }
        // Skip symlinks entirely (don't list or follow them) so a link pointing
        // outside the project can't leak paths or create a walk cycle. Use
        // `file_type()` (from the dir entry, no extra stat, doesn't follow links).
        let ft = match entry.file_type() {
            Ok(ft) => ft,
            Err(_) => continue,
        };
        if ft.is_symlink() {
            continue;
        }
        let path = entry.path();
        out.push(FileEntry {
            path: rel_slash(root, &path),
            is_dir: ft.is_dir(),
        });
        if ft.is_dir() {
            walk(root, &path, out, depth + 1)?;
        }
    }
    Ok(())
}

// --- Tauri commands ---

#[tauri::command]
pub async fn list_files(project_id: String) -> Result<Vec<FileEntry>, String> {
    tauri::async_runtime::spawn_blocking(move || -> Result<Vec<FileEntry>, String> {
        let root = paths::project_dir(&project_id)?;
        let mut out = Vec::new();
        walk(&root, &root, &mut out, 0)?;
        Ok(out)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn read_file(project_id: String, path: String) -> Result<String, String> {
    let p = resolve(&project_id, &path)?;
    std::fs::read_to_string(&p).map_err(|e| format!("failed to read {path}: {e}"))
}

#[tauri::command]
pub fn write_file(project_id: String, path: String, content: String) -> Result<(), String> {
    let p = resolve(&project_id, &path)?;
    if let Some(parent) = p.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(&p, content).map_err(|e| format!("failed to write {path}: {e}"))
}

#[tauri::command]
pub fn create_file(project_id: String, path: String, is_dir: bool) -> Result<(), String> {
    let p = resolve(&project_id, &path)?;
    if is_dir {
        std::fs::create_dir_all(&p).map_err(|e| e.to_string())
    } else {
        if let Some(parent) = p.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        if p.exists() {
            return Err(format!("{path} already exists"));
        }
        std::fs::write(&p, "").map_err(|e| e.to_string())
    }
}

#[tauri::command]
pub fn delete_file(project_id: String, path: String) -> Result<(), String> {
    let root = paths::project_dir(&project_id)?;
    if is_root_delete(&root, &path) {
        return Err("refusing to delete project root".into());
    }
    let p = resolve(&project_id, &path)?;
    if p.is_dir() {
        std::fs::remove_dir_all(&p)
    } else {
        std::fs::remove_file(&p)
    }
    .map_err(|e| format!("failed to delete {path}: {e}"))
}

#[tauri::command]
pub fn rename_file(project_id: String, from: String, to: String) -> Result<(), String> {
    let src = resolve(&project_id, &from)?;
    let dst = resolve(&project_id, &to)?;
    if let Some(parent) = dst.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::rename(&src, &dst).map_err(|e| format!("rename failed: {e}"))
}

/// Copy a file or folder within a project. Files are byte-level copied (handles
/// binaries like PDFs); folders are copied recursively (symlinks skipped, depth
/// capped). Async + spawn_blocking so a large recursive copy never blocks the UI.
#[tauri::command]
pub async fn copy_file(project_id: String, from: String, to: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
        let src = resolve(&project_id, &from)?;
        let dst = resolve(&project_id, &to)?;
        if dst == src {
            return Err("source and destination are the same".into());
        }
        // Never copy a folder into itself or a descendant (would recurse forever).
        if dst.starts_with(&src) {
            return Err("cannot copy a folder into itself".into());
        }
        if let Some(parent) = dst.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let meta = std::fs::symlink_metadata(&src).map_err(|e| e.to_string())?;
        if meta.is_dir() {
            copy_dir_recursive(&src, &dst, 0)
        } else {
            std::fs::copy(&src, &dst)
                .map(|_| ())
                .map_err(|e| format!("copy failed: {e}"))
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Write base64-encoded bytes to a project file (used to save a compiled PDF
/// into the project tree).
#[tauri::command]
pub async fn save_file_base64(
    project_id: String,
    path: String,
    data: String,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
        use base64::{engine::general_purpose::STANDARD, Engine};
        let p = resolve(&project_id, &path)?;
        if let Some(parent) = p.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let bytes = STANDARD
            .decode(data.trim())
            .map_err(|e| format!("invalid base64: {e}"))?;
        std::fs::write(&p, bytes).map_err(|e| format!("failed to write {path}: {e}"))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Read a project file as base64 (for rendering binary files like PDFs).
#[tauri::command]
pub async fn read_file_base64(project_id: String, path: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || -> Result<String, String> {
        use base64::{engine::general_purpose::STANDARD, Engine};
        let p = resolve(&project_id, &path)?;
        let bytes = std::fs::read(&p).map_err(|e| format!("failed to read {path}: {e}"))?;
        Ok(STANDARD.encode(&bytes))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Append a line to the global app log at `~/.openleaf/app.log` (append-only,
/// created if missing). Used by the frontend to record caught errors so users
/// can share the file for debugging.
#[tauri::command]
pub fn append_app_log(message: String) -> Result<(), String> {
    use std::io::Write;
    let log_path = paths::openleaf_root()?.join("app.log");
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let mut file = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)
        .map_err(|e| format!("failed to open app log: {e}"))?;
    writeln!(file, "[{secs}] {message}").map_err(|e| format!("failed to write app log: {e}"))
}

/// Read the tail (up to `max_bytes`) of the app log, for crash reports. Returns
/// an empty string if the log doesn't exist yet.
#[tauri::command]
pub fn read_app_log(max_bytes: usize) -> Result<String, String> {
    let log_path = paths::openleaf_root()?.join("app.log");
    if !log_path.exists() {
        return Ok(String::new());
    }
    let data = std::fs::read(&log_path).map_err(|e| format!("failed to read app log: {e}"))?;
    let start = data.len().saturating_sub(max_bytes);
    Ok(String::from_utf8_lossy(&data[start..]).to_string())
}

#[tauri::command]
pub fn set_main_doc(project_id: String, main_doc: String) -> Result<ProjectMeta, String> {
    let main_doc = main_doc.trim().to_string();
    if main_doc.is_empty() {
        return Err("main document path cannot be empty".into());
    }
    // Reject traversal / absolute paths and require the file to exist inside
    // the project before we persist it as the compile entry point.
    let resolved = resolve(&project_id, &main_doc)?;
    if !resolved.is_file() {
        return Err(format!("main document not found: {main_doc}"));
    }
    let lower = main_doc.to_ascii_lowercase();
    if !(lower.ends_with(".tex") || lower.ends_with(".ltx") || lower.ends_with(".latex")) {
        return Err("main document must be a .tex file".into());
    }
    let mut meta = read_meta(&project_id)?;
    meta.main_doc = main_doc;
    write_meta(&project_id, &meta)?;
    Ok(meta)
}

#[tauri::command]
pub fn rename_project(project_id: String, name: String) -> Result<ProjectMeta, String> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err("Project name cannot be empty".into());
    }
    let mut meta = read_meta(&project_id)?;
    meta.name = trimmed.to_string();
    write_meta(&project_id, &meta)?;
    Ok(meta)
}

#[tauri::command]
pub fn get_project(project_id: String) -> Result<ProjectMeta, String> {
    read_meta(&project_id)
}

/// Persist a project's book-cover color to its `project.json` so it survives
/// across machines (previously kept only in the browser's localStorage).
#[tauri::command]
pub fn set_project_color(project_id: String, color: String) -> Result<ProjectMeta, String> {
    let mut meta = read_meta(&project_id)?;
    meta.color = color;
    write_meta(&project_id, &meta)?;
    Ok(meta)
}

/// Open the webview devtools. Only does anything in debug builds (`tauri dev`),
/// where devtools are compiled in; a no-op in release.
#[tauri::command]
pub fn open_devtools(window: tauri::WebviewWindow) {
    #[cfg(debug_assertions)]
    window.open_devtools();
    #[cfg(not(debug_assertions))]
    let _ = window;
}

#[tauri::command]
pub fn list_projects() -> Result<Vec<ProjectInfo>, String> {
    let root = paths::projects_root()?;
    let mut out = Vec::new();
    let entries = std::fs::read_dir(&root).map_err(|e| e.to_string())?;
    for entry in entries.flatten() {
        if !entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
            continue;
        }
        let id = entry.file_name().to_string_lossy().into_owned();
        let meta = read_meta(&id).unwrap_or_default();
        let updated_at = entry
            .metadata()
            .and_then(|m| m.modified())
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_secs_f64())
            .unwrap_or(0.0);
        out.push(ProjectInfo {
            name: if meta.name.is_empty() {
                id.clone()
            } else {
                meta.name
            },
            main_doc: meta.main_doc,
            color: meta.color,
            id,
            updated_at,
        });
    }
    out.sort_by(|a, b| {
        b.updated_at
            .partial_cmp(&a.updated_at)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    Ok(out)
}

#[tauri::command]
pub fn create_project(name: String) -> Result<String, String> {
    let root = paths::projects_root()?;
    let id = unique_random_slug(&root)?;
    let dir = root.join(&id);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    std::fs::write(dir.join("main.tex"), DEFAULT_MAIN_TEX).map_err(|e| e.to_string())?;
    write_meta(
        &id,
        &ProjectMeta {
            name,
            main_doc: default_main_doc(),
            engine: default_engine(),
            color: String::new(),
            kind: String::new(),
            exports: Vec::new(),
        },
    )?;
    Ok(id)
}

/// Create an image-kind project whose `main.tex` is a standalone document
/// (`source`). Used by "Save as project" in the diagram composer so a figure,
/// its TikZ, and its embedded editor model all persist as a reusable project.
#[tauri::command]
pub fn create_image_project(
    name: String,
    source: String,
    color: Option<String>,
) -> Result<String, String> {
    let root = paths::projects_root()?;
    let id = unique_random_slug(&root)?;
    let dir = root.join(&id);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    std::fs::write(dir.join("main.tex"), source).map_err(|e| e.to_string())?;
    write_meta(
        &id,
        &ProjectMeta {
            name,
            main_doc: default_main_doc(),
            engine: default_engine(),
            color: color.unwrap_or_default(),
            kind: "image".into(),
            exports: Vec::new(),
        },
    )?;
    Ok(id)
}

fn slugify(name: &str) -> String {
    let slug: String = name
        .to_lowercase()
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() {
                c
            } else if c == ' ' || c == '-' || c == '_' {
                '-'
            } else {
                '\0'
            }
        })
        .filter(|c| *c != '\0')
        .collect();
    let slug = slug.trim_matches('-').to_string();
    if slug.is_empty() {
        "project".to_string()
    } else {
        slug
    }
}

// Random, human-meaningful project ids like "flying-pink-pikachu".
const ADJECTIVES: &[&str] = &[
    "flying", "swift", "cosmic", "velvet", "silent", "crimson", "lucky", "hidden", "mellow",
    "quantum", "amber", "frosty", "jolly", "nimble", "rosy", "sunny", "tidy", "vivid", "witty",
    "brave",
];
const COLORS: &[&str] = &[
    "pink", "azure", "emerald", "indigo", "maroon", "olive", "teal", "violet", "cyan", "coral",
    "lavender", "ruby", "slate", "gold", "mint",
];
const ANIMALS: &[&str] = &[
    "pikachu", "falcon", "otter", "panda", "lynx", "koala", "heron", "narwhal", "panther", "raven",
    "sable", "tiger", "viper", "wallaby", "yak", "zebu", "fox", "wolf", "crane", "moth",
];

fn pick<'a>(list: &'a [&'a str], seed: &mut u64) -> &'a str {
    *seed = seed
        .wrapping_mul(6364136223846793005)
        .wrapping_add(1442695040888963407);
    list[((*seed >> 33) as usize) % list.len()]
}

/// Generate a unique random slug under `root`, retrying until it doesn't exist.
fn unique_random_slug(root: &Path) -> Result<String, String> {
    for _ in 0..32 {
        let mut seed = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos() as u64)
            .unwrap_or(0);
        // burn a couple of rounds so the time-seed doesn't bias the first pick
        pick(ADJECTIVES, &mut seed);
        pick(COLORS, &mut seed);
        let candidate = format!(
            "{}-{}-{}",
            pick(ADJECTIVES, &mut seed),
            pick(COLORS, &mut seed),
            pick(ANIMALS, &mut seed)
        );
        if !root.join(&candidate).exists() {
            return Ok(candidate);
        }
    }
    // Extremely unlikely fallback.
    Ok(slugify(&format!(
        "project-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.subsec_nanos())
            .unwrap_or(0)
    )))
}

#[tauri::command]
pub fn export_pdf(
    project_id: String,
    dest: String,
    state: tauri::State<'_, crate::state::AppState>,
) -> Result<(), String> {
    guard_export_dest(&dest)?;
    let build = paths::build_dir(&project_id)?;
    let pdf = build.join(format!("{}.pdf", paths::ENTRY_STEM));
    if !pdf.exists() {
        return Err("No compiled PDF found - recompile first.".into());
    }
    std::fs::copy(&pdf, &dest).map_err(|e| format!("failed to write PDF: {e}"))?;
    // Allow reveal_in_dir for this user-chosen export path.
    if let Ok(canon) = std::path::Path::new(&dest).canonicalize() {
        state.reveal_allowlist.blocking_lock().insert(canon);
    }

    // Record in export history (keep the most recent 50).
    let mut meta = read_meta(&project_id)?;
    let filename = Path::new(&dest)
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("export.pdf")
        .to_string();
    let date = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs_f64())
        .unwrap_or(0.0);
    meta.exports.push(ExportRecord {
        date,
        filename,
        path: dest,
    });
    if meta.exports.len() > 50 {
        meta.exports.drain(0..meta.exports.len() - 50);
    }
    write_meta(&project_id, &meta)?;
    Ok(())
}

/// Locate a usable `pandoc` binary. macOS/Linux GUI apps launch with a minimal
/// PATH that usually excludes Homebrew and conda, so if it isn't on PATH we also
/// probe common install locations before giving up.
fn find_pandoc() -> Option<String> {
    use std::path::PathBuf;
    use std::process::Command;
    let works = |cmd: &str| {
        Command::new(cmd)
            .no_console()
            .arg("--version")
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
    };
    if works("pandoc") {
        return Some("pandoc".to_string());
    }
    let mut candidates: Vec<PathBuf> = Vec::new();
    // Our own on-demand download location wins first (guaranteed compatible).
    if let Ok(root) = paths::openleaf_root() {
        candidates.push(root.join("bin").join(if cfg!(windows) {
            "pandoc.exe"
        } else {
            "pandoc"
        }));
    }
    candidates.extend([
        PathBuf::from("/opt/homebrew/bin/pandoc"),
        PathBuf::from("/usr/local/bin/pandoc"),
        PathBuf::from("/usr/bin/pandoc"),
        PathBuf::from("/opt/homebrew/anaconda3/bin/pandoc"),
    ]);
    if let Ok(home) = std::env::var("HOME") {
        for sub in [
            "anaconda3/bin/pandoc",
            "miniconda3/bin/pandoc",
            ".local/bin/pandoc",
            "homebrew/bin/pandoc",
            "bin/pandoc",
        ] {
            candidates.push(PathBuf::from(&home).join(sub));
        }
    }
    candidates
        .into_iter()
        .find(|c| c.exists() && works(&c.to_string_lossy()))
        .map(|c| c.to_string_lossy().to_string())
}

/// Convert the main document to another format via `pandoc`. Pandoc infers the
/// output format from the destination extension; `format` selects a few
/// per-format flags that make the result usable (slide splitting for PowerPoint,
/// a self-contained HTML file, a table of contents for EPUB). Errors clearly if
/// pandoc isn't installed.
#[tauri::command]
pub async fn export_document(
    project_id: String,
    main_doc: String,
    format: String,
    dest: String,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
        use std::process::Command;
        guard_export_dest(&dest)?;
        let root = paths::project_dir(&project_id)?;
        // Validate `main_doc` stays inside the project before handing it to pandoc.
        resolve(&project_id, &main_doc)?;
        let pandoc = find_pandoc().ok_or_else(|| {
            "pandoc is not installed. Install pandoc to export documents.".to_string()
        })?;
        let mut cmd = Command::new(&pandoc);
        cmd.no_console().arg("-o").arg(&dest);
        match format.as_str() {
            // Beamer frames (and level-2 headings) become individual slides.
            "pptx" => {
                cmd.args(["--slide-level", "2"]);
            }
            // A single portable file with images and CSS inlined, and math
            // rendered as MathML so it displays offline without a script.
            "html" => {
                cmd.args(["--standalone", "--embed-resources", "--mathml"]);
            }
            // A navigable e-book with a generated contents page.
            "epub" => {
                cmd.arg("--toc");
            }
            _ => {}
        }
        // `--` terminates option parsing so a `main_doc` beginning with `-` can't be
        // interpreted as a pandoc flag (defense-in-depth; it's already validated to
        // stay inside the project).
        cmd.arg("--").arg(&main_doc).current_dir(&root);
        let out = cmd
            .output()
            .map_err(|e| format!("failed to run pandoc: {e}"))?;
        if !out.status.success() {
            let err = String::from_utf8_lossy(&out.stderr);
            return Err(format!("pandoc failed: {}", err.trim()));
        }
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Whether a usable pandoc is already available (system or our cache).
#[tauri::command]
pub async fn has_pandoc() -> bool {
    tauri::async_runtime::spawn_blocking(|| find_pandoc().is_some())
        .await
        .unwrap_or(false)
}

#[derive(Clone, serde::Serialize)]
struct PandocProgress {
    received: u64,
    total: Option<u64>,
}

/// The pandoc release asset URL for this platform, and whether it's a tar.gz.
fn pandoc_asset() -> Result<(String, bool), String> {
    const V: &str = "3.5";
    let base = format!("https://github.com/jgm/pandoc/releases/download/{V}");
    let arch = std::env::consts::ARCH;
    if cfg!(target_os = "macos") {
        let a = if arch == "aarch64" { "arm64" } else { "x86_64" };
        Ok((format!("{base}/pandoc-{V}-{a}-macOS.zip"), false))
    } else if cfg!(target_os = "windows") {
        Ok((format!("{base}/pandoc-{V}-windows-x86_64.zip"), false))
    } else if cfg!(target_os = "linux") {
        let a = if arch == "aarch64" { "arm64" } else { "amd64" };
        Ok((format!("{base}/pandoc-{V}-linux-{a}.tar.gz"), true))
    } else {
        Err("Automatic pandoc download isn't supported on this platform.".to_string())
    }
}

/// Extract the `pandoc` binary from a downloaded archive to `dest`.
fn extract_pandoc(
    archive: &std::path::Path,
    is_targz: bool,
    dest: &std::path::Path,
) -> Result<(), String> {
    use std::io::{Read, Write};
    // Match the executable by FILE NAME, not a "bin/..." suffix: since pandoc 2.8
    // the Windows zip puts `pandoc.exe` at the archive ROOT (no bin/ dir), while
    // macOS/Linux still nest it under bin/. The old `ends_with("bin/pandoc.exe")`
    // never matched on Windows, so on-demand pandoc install (all non-PDF export)
    // was completely broken there.
    let want_name = if cfg!(windows) {
        "pandoc.exe"
    } else {
        "pandoc"
    };
    let file = std::fs::File::open(archive).map_err(|e| e.to_string())?;
    if is_targz {
        let gz = flate2::read::GzDecoder::new(file);
        let mut ar = tar::Archive::new(gz);
        for entry in ar.entries().map_err(|e| e.to_string())? {
            let mut entry = entry.map_err(|e| e.to_string())?;
            let path = entry.path().map_err(|e| e.to_string())?.into_owned();
            let is_match = path.file_name().and_then(|s| s.to_str()) == Some(want_name);
            if is_match {
                let mut out = std::fs::File::create(dest).map_err(|e| e.to_string())?;
                std::io::copy(&mut entry, &mut out).map_err(|e| e.to_string())?;
                return Ok(());
            }
        }
    } else {
        let mut zip = zip::ZipArchive::new(file).map_err(|e| e.to_string())?;
        for i in 0..zip.len() {
            let mut f = zip.by_index(i).map_err(|e| e.to_string())?;
            let name = f.name().to_string();
            let base = name.rsplit('/').next().unwrap_or(&name);
            if base == want_name {
                let mut buf = Vec::new();
                f.read_to_end(&mut buf).map_err(|e| e.to_string())?;
                let mut out = std::fs::File::create(dest).map_err(|e| e.to_string())?;
                out.write_all(&buf).map_err(|e| e.to_string())?;
                return Ok(());
            }
        }
    }
    Err("pandoc binary not found in the downloaded archive.".to_string())
}

/// Download pandoc on demand and cache it under `~/.openleaf/bin`. Emits
/// `pandoc-download-progress` events; returns the path to the ready binary.
#[tauri::command]
pub async fn download_pandoc(app: tauri::AppHandle) -> Result<String, String> {
    use futures_util::StreamExt;
    use std::io::Write as _;
    use tauri::Emitter;

    if let Some(p) = find_pandoc() {
        return Ok(p);
    }
    let (url, is_targz) = pandoc_asset()?;
    let bin_dir = paths::openleaf_root()?.join("bin");
    std::fs::create_dir_all(&bin_dir).map_err(|e| e.to_string())?;
    let tmp = bin_dir.join("pandoc-download.tmp");

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
            "pandoc-download-progress",
            PandocProgress { received, total },
        );
    }
    file.flush().map_err(|e| e.to_string())?;
    drop(file);

    let dest = bin_dir.join(if cfg!(windows) {
        "pandoc.exe"
    } else {
        "pandoc"
    });
    let extracted = extract_pandoc(&tmp, is_targz, &dest);
    let _ = std::fs::remove_file(&tmp);
    extracted?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&dest, std::fs::Permissions::from_mode(0o755));
    }
    if !std::process::Command::new(&dest)
        .no_console()
        .arg("--version")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
    {
        return Err("Downloaded pandoc, but it failed to run.".to_string());
    }
    Ok(dest.to_string_lossy().to_string())
}

#[tauri::command]
pub fn create_project_from_template(
    app: tauri::AppHandle,
    name: String,
    template_id: String,
    color: Option<String>,
) -> Result<String, String> {
    let root = paths::projects_root()?;
    let id = unique_random_slug(&root)?;
    let dir = root.join(&id);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    // Copy the template's source files from disk and seed project.json from its
    // manifest (main doc, engine, cover color). A user-chosen color wins over the
    // template's default.
    let manifest = crate::templates::instantiate(&app, &template_id, &dir)?;
    // Stage any font packs the template needs into <project>/fonts/ so the
    // document carries its own fonts and compiles offline.
    crate::assets::stage_template_fonts(&app, &manifest, &dir)?;
    let color = color
        .filter(|c| !c.is_empty())
        .or(manifest.default_color)
        .unwrap_or_default();
    write_meta(
        &id,
        &ProjectMeta {
            name,
            main_doc: manifest.main_doc,
            engine: manifest.engine,
            color,
            kind: manifest.kind.unwrap_or_default(),
            exports: Vec::new(),
        },
    )?;
    Ok(id)
}

// --- Global document search ---

#[derive(Serialize)]
pub struct SearchHit {
    pub project_id: String,
    pub project_name: String,
    pub path: String,
    pub line: u32,
    pub preview: String,
}

const SEARCH_LIMIT: usize = 200;

fn is_searchable(name: &str) -> bool {
    let n = name.to_lowercase();
    n.ends_with(".tex")
        || n.ends_with(".bib")
        || n.ends_with(".sty")
        || n.ends_with(".cls")
        || n.ends_with(".txt")
        || n.ends_with(".md")
}

fn search_walk(
    project_id: &str,
    project_name: &str,
    root: &Path,
    dir: &Path,
    q_lower: &str,
    hits: &mut Vec<SearchHit>,
    depth: usize,
) {
    if depth >= MAX_WALK_DEPTH {
        return;
    }
    let entries = match std::fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return,
    };
    for entry in entries.flatten() {
        if hits.len() >= SEARCH_LIMIT {
            return;
        }
        let name = entry.file_name();
        let name_str = name.to_string_lossy();
        if name_str == ".openleaf" || name_str == ".localleaf" || name_str == ".git" {
            continue;
        }
        // Skip symlinks (don't follow or read them) to avoid escaping the project
        // tree or looping through a cycle.
        let ft = match entry.file_type() {
            Ok(ft) => ft,
            Err(_) => continue,
        };
        if ft.is_symlink() {
            continue;
        }
        let path = entry.path();
        if ft.is_dir() {
            search_walk(
                project_id,
                project_name,
                root,
                &path,
                q_lower,
                hits,
                depth + 1,
            );
            continue;
        }
        if !is_searchable(&name_str) {
            continue;
        }
        let rel = rel_slash(root, &path);
        let text = match std::fs::read_to_string(&path) {
            Ok(t) => t,
            Err(_) => continue,
        };
        for (i, line) in text.lines().enumerate() {
            if line.to_lowercase().contains(q_lower) {
                let preview: String = line.trim().chars().take(160).collect();
                hits.push(SearchHit {
                    project_id: project_id.to_string(),
                    project_name: project_name.to_string(),
                    path: rel.clone(),
                    line: (i as u32) + 1,
                    preview,
                });
                if hits.len() >= SEARCH_LIMIT {
                    return;
                }
            }
        }
    }
}

/// Search every project's text files for `query` (case-insensitive, substring).
#[tauri::command]
pub async fn search_docs(query: String) -> Result<Vec<SearchHit>, String> {
    tauri::async_runtime::spawn_blocking(move || -> Result<Vec<SearchHit>, String> {
        let q = query.trim();
        if q.is_empty() {
            return Ok(Vec::new());
        }
        let q_lower = q.to_lowercase();
        let root = paths::projects_root()?;
        let mut hits: Vec<SearchHit> = Vec::new();
        let entries = std::fs::read_dir(&root).map_err(|e| e.to_string())?;
        for entry in entries.flatten() {
            if hits.len() >= SEARCH_LIMIT {
                break;
            }
            if !entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                continue;
            }
            let project_id = entry.file_name().to_string_lossy().into_owned();
            let meta = read_meta(&project_id).unwrap_or_default();
            let project_name = if meta.name.is_empty() {
                project_id.clone()
            } else {
                meta.name
            };
            search_walk(
                &project_id,
                &project_name,
                &entry.path(),
                &entry.path(),
                &q_lower,
                &mut hits,
                0,
            );
        }
        Ok(hits)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Search a SINGLE project's text files for `query`. Used by the AI assistant so
/// a chat scoped to one project can't surface (and forward to the model) the
/// contents of the user's other projects.
#[tauri::command]
pub async fn search_project(project_id: String, query: String) -> Result<Vec<SearchHit>, String> {
    tauri::async_runtime::spawn_blocking(move || -> Result<Vec<SearchHit>, String> {
        let q = query.trim();
        if q.is_empty() {
            return Ok(Vec::new());
        }
        let q_lower = q.to_lowercase();
        let root = paths::project_dir(&project_id)?;
        let meta = read_meta(&project_id).unwrap_or_default();
        let project_name = if meta.name.is_empty() {
            project_id.clone()
        } else {
            meta.name
        };
        let mut hits: Vec<SearchHit> = Vec::new();
        search_walk(
            &project_id,
            &project_name,
            &root,
            &root,
            &q_lower,
            &mut hits,
            0,
        );
        Ok(hits)
    })
    .await
    .map_err(|e| e.to_string())?
}

// --- Download ZIP, Duplicate, Clear cache ---

/// Zip a project's source files (excluding `.openleaf`, `.git`) to `dest`.
#[tauri::command]
pub async fn download_project_zip(project_id: String, dest: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
        guard_export_dest(&dest)?;
        let root = paths::project_dir(&project_id)?;
        let file = std::fs::File::create(&dest).map_err(|e| e.to_string())?;
        let mut writer = zip::ZipWriter::new(file);
        let opts = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated);

        fn add_dir(
            writer: &mut zip::ZipWriter<std::fs::File>,
            opts: zip::write::SimpleFileOptions,
            base: &Path,
            dir: &Path,
            depth: usize,
        ) -> Result<(), String> {
            if depth >= MAX_WALK_DEPTH {
                return Ok(());
            }
            for entry in std::fs::read_dir(dir).map_err(|e| e.to_string())? {
                let entry = entry.map_err(|e| e.to_string())?;
                let name = entry.file_name();
                let name_str = name.to_string_lossy();
                if name_str == ".openleaf" || name_str == ".localleaf" || name_str == ".git" {
                    continue;
                }
                // Skip symlinks so the archive can't include or follow a link
                // pointing outside the project (or loop through a cycle).
                let ft = match entry.file_type() {
                    Ok(ft) => ft,
                    Err(_) => continue,
                };
                if ft.is_symlink() {
                    continue;
                }
                let path = entry.path();
                let rel = path.strip_prefix(base).unwrap_or(&path);
                let zip_name = rel.to_string_lossy().replace('\\', "/");
                if ft.is_dir() {
                    writer
                        .add_directory(&zip_name, opts)
                        .map_err(|e| e.to_string())?;
                    add_dir(writer, opts, base, &path, depth + 1)?;
                } else {
                    writer
                        .start_file(&zip_name, opts)
                        .map_err(|e| e.to_string())?;
                    let mut f = std::fs::File::open(&path).map_err(|e| e.to_string())?;
                    std::io::copy(&mut f, writer).map_err(|e| e.to_string())?;
                }
            }
            Ok(())
        }

        add_dir(&mut writer, opts, &root, &root, 0)?;
        writer.finish().map_err(|e| e.to_string())?;
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Duplicate a project (copy everything including `.git` history).
#[tauri::command]
pub async fn duplicate_project(project_id: String, new_name: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || -> Result<String, String> {
        let root = paths::projects_root()?;
        let src = paths::project_dir(&project_id)?;
        let new_id = unique_random_slug(&root)?;
        let dst = root.join(&new_id);
        copy_dir_recursive(&src, &dst, 0)?;
        if let Ok(mut meta) = read_meta(&new_id) {
            meta.name = new_name;
            let _ = write_meta(&new_id, &meta);
        }
        Ok(new_id)
    })
    .await
    .map_err(|e| e.to_string())?
}

fn copy_dir_recursive(src: &Path, dst: &Path, depth: usize) -> Result<(), String> {
    if depth >= MAX_WALK_DEPTH {
        return Ok(());
    }
    std::fs::create_dir_all(dst).map_err(|e| e.to_string())?;
    for entry in std::fs::read_dir(src).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        // Skip symlinks: don't copy or follow them (avoids escaping the source
        // tree and recursion cycles).
        let ft = match entry.file_type() {
            Ok(ft) => ft,
            Err(_) => continue,
        };
        if ft.is_symlink() {
            continue;
        }
        let path = entry.path();
        let dest = dst.join(entry.file_name());
        if ft.is_dir() {
            copy_dir_recursive(&path, &dest, depth + 1)?;
        } else {
            std::fs::copy(&path, &dest).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

/// Clear the build cache (forces a clean rebuild on next compile).
#[tauri::command]
pub fn clear_build_cache(project_id: String) -> Result<(), String> {
    let build = paths::build_dir(&project_id)?;
    if let Ok(entries) = std::fs::read_dir(&build) {
        for entry in entries.flatten() {
            let _ = std::fs::remove_file(entry.path());
        }
    }
    Ok(())
}

/// Delete a project (removes its directory entirely).
#[tauri::command]
pub async fn delete_project(project_id: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
        paths::validate_project_id(&project_id)?;
        let root = paths::projects_root()?;
        let dir = root.join(&project_id);
        if !dir.exists() {
            return Ok(());
        }
        std::fs::remove_dir_all(&dir).map_err(|e| format!("failed to delete project: {e}"))
    })
    .await
    .map_err(|e| e.to_string())?
}

// Path-sandbox unit tests live in `sandbox.rs`.

#[cfg(test)]
mod tests {
    use super::rel_slash;
    use std::path::Path;

    #[test]
    fn rel_slash_strips_root_and_forces_forward_slashes() {
        let root = Path::new("/proj");
        assert_eq!(rel_slash(root, &root.join("main.tex")), "main.tex");
        assert_eq!(
            rel_slash(root, &root.join("sections").join("intro.tex")),
            "sections/intro.tex"
        );
        // A component holding a literal backslash (what Windows' path separator
        // becomes via `to_string_lossy`) must be normalized to a forward slash,
        // or the frontend file tree (which splits on "/") breaks on Windows.
        let win_like = Path::new("/proj/sections\\intro.tex");
        assert_eq!(rel_slash(root, win_like), "sections/intro.tex");
    }
}
