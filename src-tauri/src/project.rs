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

const DEFAULT_MAIN_TYPST: &str = "#set document(title: \"Untitled\", author: ())\n\
#set page(paper: \"us-letter\", margin: 1in)\n\
#set text(size: 11pt)\n\
\n\
= Untitled\n\
\n\
Write your document in Typst.\n";

const DEFAULT_MAIN_MARKDOWN: &str =
    "---\ntitle: Untitled\nauthor: ''\n---\n\n# Introduction\n\nWrite your document in Markdown.\n";

pub const SCRATCH_PROJECT_ID: &str = "__diagram_scratch__";

const DEFAULT_MAIN_DIAGRAM: &str = "\\documentclass[tikz,border=4pt]{standalone}\n\
\\usepackage{tikz}\n\
\\usetikzlibrary{shapes.geometric,arrows.meta,positioning,calc,backgrounds}\n\
\\begin{document}\n\
\\begin{tikzpicture}\n\
\\end{tikzpicture}\n\
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
    #[serde(default)]
    pub hidden: bool,
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
pub struct ProjectExportInfo {
    pub date: f64,
    pub filename: String,
    pub path: String,
    pub format: String,
}

#[derive(Serialize)]
pub struct ProjectInfo {
    pub id: String,
    pub name: String,
    pub main_doc: String,
    pub engine: String,
    pub kind: String,
    pub created_at: f64,
    pub updated_at: f64,
    pub color: String,
    pub has_preview: bool,
    pub exports: Vec<ProjectExportInfo>,
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
            hidden: false,
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
    write_meta_at(&p, meta)
}

fn write_meta_at(path: &Path, meta: &ProjectMeta) -> Result<(), String> {
    let s = serde_json::to_string_pretty(meta).map_err(|e| e.to_string())?;
    std::fs::write(path, s).map_err(|e| format!("failed to write project.json: {e}"))
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
        if name_str == ".oleafly" || name_str == ".git" {
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

/// Append a line to the global app log at `~/.oleafly/app.log` (append-only,
/// created if missing). Used by the frontend to record caught errors so users
/// can share the file for debugging.
#[tauri::command]
pub fn append_app_log(message: String) -> Result<(), String> {
    use std::io::Write;
    let log_path = paths::oleafly_root()?.join("app.log");
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
    let log_path = paths::oleafly_root()?.join("app.log");
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
    let mut meta = read_meta(&project_id)?;
    let selected_engine = engine_for_main_document(&meta.engine, &main_doc)?;
    meta.main_doc = main_doc;
    meta.engine = selected_engine;
    write_meta(&project_id, &meta)?;
    Ok(meta)
}

fn engine_for_main_document(current_engine: &str, main_doc: &str) -> Result<String, String> {
    let current_is_typst = matches!(
        current_engine.trim().to_ascii_lowercase().as_str(),
        "typst" | "typ"
    );
    let current_is_markdown = matches!(
        current_engine.trim().to_ascii_lowercase().as_str(),
        "markdown" | "md" | "pandoc"
    );
    let lower = main_doc.to_ascii_lowercase();
    let selected = if lower.ends_with(".typ") {
        "typst".to_owned()
    } else if lower.ends_with(".md") || lower.ends_with(".markdown") {
        "markdown".to_owned()
    } else if current_is_typst || current_is_markdown {
        default_engine()
    } else {
        current_engine.to_owned()
    };
    crate::document_engine::engine_for(&selected, main_doc)?;
    Ok(selected)
}

#[tauri::command]
pub fn create_markdown_project(name: String) -> Result<String, String> {
    let root = paths::projects_root()?;
    create_markdown_project_in(&root, name)
}

fn create_markdown_project_in(root: &Path, name: String) -> Result<String, String> {
    let id = unique_random_slug(root)?;
    let dir = root.join(&id);
    create_project_transaction(&dir, || {
        std::fs::write(dir.join("main.md"), DEFAULT_MAIN_MARKDOWN).map_err(|e| e.to_string())?;
        write_meta_at(
            &dir.join("project.json"),
            &ProjectMeta {
                name,
                main_doc: "main.md".into(),
                engine: "markdown".into(),
                color: String::new(),
                kind: String::new(),
                exports: Vec::new(),
                hidden: false,
            },
        )
    })?;
    Ok(id)
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
        if meta.hidden {
            continue;
        }
        let fs_meta = entry.metadata().ok();
        let updated_at = fs_meta
            .as_ref()
            .and_then(|m| m.modified().ok())
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_secs_f64())
            .unwrap_or(0.0);
        let created_at = fs_meta
            .as_ref()
            .and_then(|m| m.created().ok())
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_secs_f64())
            .unwrap_or(updated_at);
        let has_preview =
            crate::document_engine::compiled_pdf_path(&id, &meta.engine, &meta.main_doc)
                .map(|path| path.is_file())
                .unwrap_or(false);
        let exports = meta
            .exports
            .iter()
            .map(|export| ProjectExportInfo {
                date: export.date,
                filename: export.filename.clone(),
                path: export.path.clone(),
                format: Path::new(&export.filename)
                    .extension()
                    .and_then(|extension| extension.to_str())
                    .unwrap_or_default()
                    .to_ascii_lowercase(),
            })
            .collect();
        out.push(ProjectInfo {
            name: if meta.name.is_empty() {
                id.clone()
            } else {
                meta.name
            },
            main_doc: meta.main_doc,
            engine: if meta.engine.is_empty() {
                default_engine()
            } else {
                meta.engine
            },
            kind: if meta.kind.is_empty() {
                "document".to_string()
            } else {
                meta.kind
            },
            created_at,
            color: meta.color,
            has_preview,
            exports,
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
    create_project_transaction(&dir, || {
        std::fs::write(dir.join("main.tex"), DEFAULT_MAIN_TEX).map_err(|e| e.to_string())?;
        write_meta_at(
            &dir.join("project.json"),
            &ProjectMeta {
                name,
                main_doc: default_main_doc(),
                engine: default_engine(),
                color: String::new(),
                kind: String::new(),
                exports: Vec::new(),
                hidden: false,
            },
        )
    })?;
    Ok(id)
}

#[tauri::command]
pub fn create_typst_project(name: String) -> Result<String, String> {
    let root = paths::projects_root()?;
    create_typst_project_in(&root, name)
}

fn create_typst_project_in(root: &Path, name: String) -> Result<String, String> {
    let id = unique_random_slug(root)?;
    let dir = root.join(&id);
    create_project_transaction(&dir, || {
        std::fs::write(dir.join("main.typ"), DEFAULT_MAIN_TYPST).map_err(|e| e.to_string())?;
        write_meta_at(
            &dir.join("project.json"),
            &ProjectMeta {
                name,
                main_doc: "main.typ".into(),
                engine: "typst".into(),
                color: String::new(),
                kind: String::new(),
                exports: Vec::new(),
                hidden: false,
            },
        )
    })?;
    Ok(id)
}

fn create_project_transaction<F>(dir: &Path, initialize: F) -> Result<(), String>
where
    F: FnOnce() -> Result<(), String>,
{
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let result = initialize();
    if let Err(error) = result {
        let _ = std::fs::remove_dir_all(dir);
        return Err(error);
    }
    Ok(())
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
    create_image_project_in(&root, name, source, color)
}

fn create_image_project_in(
    root: &Path,
    name: String,
    source: String,
    color: Option<String>,
) -> Result<String, String> {
    let id = unique_random_slug(root)?;
    let dir = root.join(&id);
    create_project_transaction(&dir, || {
        std::fs::write(dir.join("main.tex"), source).map_err(|e| e.to_string())?;
        write_meta_at(
            &dir.join("project.json"),
            &ProjectMeta {
                name,
                main_doc: default_main_doc(),
                engine: default_engine(),
                color: color.unwrap_or_default(),
                kind: "image".into(),
                exports: Vec::new(),
                hidden: false,
            },
        )
    })?;
    Ok(id)
}

#[tauri::command]
pub fn create_diagram_project(name: String, source: String) -> Result<String, String> {
    let root = paths::projects_root()?;
    let id = unique_random_slug(&root)?;
    let dir = root.join(&id);
    create_project_transaction(&dir, || {
        std::fs::write(dir.join("main.tex"), source).map_err(|e| e.to_string())?;
        write_meta_at(
            &dir.join("project.json"),
            &ProjectMeta {
                name,
                main_doc: default_main_doc(),
                engine: default_engine(),
                color: String::new(),
                kind: "diagram".into(),
                exports: Vec::new(),
                hidden: false,
            },
        )
    })?;
    Ok(id)
}

#[tauri::command]
pub fn get_or_create_scratch_project() -> Result<String, String> {
    let dir = paths::project_dir(SCRATCH_PROJECT_ID)?;
    let meta_file = dir.join("project.json");
    if !meta_file.exists() {
        std::fs::write(dir.join("main.tex"), DEFAULT_MAIN_DIAGRAM).map_err(|e| e.to_string())?;
        write_meta_at(
            &meta_file,
            &ProjectMeta {
                name: "Diagram Composer Scratch".to_string(),
                main_doc: default_main_doc(),
                engine: default_engine(),
                color: String::new(),
                kind: "diagram".into(),
                exports: Vec::new(),
                hidden: true,
            },
        )?;
    }
    Ok(SCRATCH_PROJECT_ID.to_string())
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
    let meta = read_meta(&project_id)?;
    let pdf = crate::document_engine::compiled_pdf_path(&project_id, &meta.engine, &meta.main_doc)?;
    if !pdf.exists() {
        return Err("No compiled PDF found - recompile first.".into());
    }
    std::fs::copy(&pdf, &dest).map_err(|e| format!("failed to write PDF: {e}"))?;
    // Allow reveal_in_dir for this user-chosen export path.
    if let Ok(canon) = std::path::Path::new(&dest).canonicalize() {
        let mut allow = state.reveal_allowlist.blocking_lock();
        if allow.len() >= 1024 {
            allow.pop_front();
        }
        allow.push_back(canon);
    }

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
pub(crate) fn find_pandoc() -> Option<String> {
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
    let mut candidates: Vec<PathBuf> = Vec::new();
    // Our own on-demand download location wins first (guaranteed compatible).
    if let Ok(root) = paths::oleafly_root() {
        candidates.push(root.join("bin").join(if cfg!(windows) {
            "pandoc.exe"
        } else {
            "pandoc"
        }));
    }
    if let Some(cached) = candidates.pop() {
        if cached.is_file() && works(&cached.to_string_lossy()) {
            return Some(cached.to_string_lossy().into_owned());
        }
    }
    if works("pandoc") {
        return Some("pandoc".to_string());
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
    state: tauri::State<'_, crate::state::AppState>,
) -> Result<(), String> {
    let reveal_dest = dest.clone();
    guard_export_dest(&dest)?;
    let meta = read_meta(&project_id)?;
    if meta.main_doc != main_doc {
        return Err("main document changed; reopen the export menu and try again".into());
    }
    let writer = validate_conversion_export(&meta, &format, &dest)?;
    let root = paths::project_dir(&project_id)?;
    resolve(&project_id, &main_doc)?;
    let pandoc = tauri::async_runtime::spawn_blocking(find_pandoc)
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| {
            "pandoc is not installed. Install pandoc to export documents.".to_string()
        })?;
    let mut args = vec![format!("--to={writer}"), "-o".into(), dest.clone()];
    match format.as_str() {
        "pptx" => {
            args.extend(["--slide-level".into(), "2".into()]);
        }
        "html" => {
            args.extend([
                "--standalone".into(),
                "--embed-resources".into(),
                "--mathml".into(),
            ]);
        }
        "epub" => {
            args.push("--toc".into());
        }
        _ => {}
    }
    args.extend(["--".into(), main_doc]);
    let (log, code) =
        crate::document_engine::run_supervised_external(Path::new(&pandoc), &args, &root).await?;
    if code != Some(0) {
        return Err(format!("pandoc failed: {}", log.trim()));
    }
    if let Ok(canon) = Path::new(&reveal_dest).canonicalize() {
        let mut allow = state.reveal_allowlist.lock().await;
        if allow.len() >= 1024 {
            allow.pop_front();
        }
        allow.push_back(canon);
    }
    Ok(())
}

fn validate_conversion_export(
    meta: &ProjectMeta,
    format: &str,
    dest: &str,
) -> Result<&'static str, String> {
    let (writer, extension) = match format {
        "docx" => ("docx", "docx"),
        "html" => ("html5", "html"),
        "md" => ("markdown", "md"),
        "txt" => ("plain", "txt"),
        "pptx" => ("pptx", "pptx"),
        "epub" => ("epub", "epub"),
        _ => return Err(format!("unsupported export format: {format}")),
    };
    if !Path::new(dest)
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.eq_ignore_ascii_case(extension))
        .unwrap_or(false)
    {
        return Err(format!("export destination must end in .{extension}"));
    }
    let descriptor = crate::document_engine::descriptor_for(&meta.engine, &meta.main_doc)?;
    if !descriptor
        .capabilities
        .conversion_exports
        .iter()
        .any(|candidate| candidate.as_str() == format)
    {
        return Err(format!("{} cannot export {format}", descriptor.label));
    }
    Ok(writer)
}

fn docx_pandoc_args() -> Vec<String> {
    vec![
        "--from=docx".into(),
        "--to=latex".into(),
        "--standalone".into(),
        "--extract-media=assets".into(),
        "-o".into(),
        "main.tex".into(),
        "--".into(),
        "source.docx".into(),
    ]
}

fn decode_docx_base64(data: &str) -> Result<Vec<u8>, String> {
    use base64::{engine::general_purpose::STANDARD, Engine};
    let bytes = STANDARD
        .decode(data.trim())
        .map_err(|e| format!("invalid base64: {e}"))?;
    if bytes.len() < 4 || &bytes[0..2] != b"PK" {
        return Err("not a .docx file (missing zip container signature)".into());
    }
    Ok(bytes)
}

/// Create a LaTeX project from an uploaded .docx. The bytes are written inside
/// the new project dir and pandoc runs there, so no external path is read.
#[tauri::command]
pub async fn create_project_from_docx(name: String, data_base64: String) -> Result<String, String> {
    let bytes = decode_docx_base64(&data_base64)?;
    let pandoc = tauri::async_runtime::spawn_blocking(find_pandoc)
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| {
            "pandoc is not installed. Install pandoc to import Word documents.".to_string()
        })?;
    let root = paths::projects_root()?;
    let id = unique_random_slug(&root)?;
    let dir = root.join(&id);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let result: Result<(), String> = async {
        std::fs::write(dir.join("source.docx"), &bytes)
            .map_err(|e| format!("failed to write source.docx: {e}"))?;
        let (log, code) = crate::document_engine::run_supervised_external(
            Path::new(&pandoc),
            &docx_pandoc_args(),
            &dir,
        )
        .await?;
        if code != Some(0) {
            return Err(format!("pandoc failed: {}", log.trim()));
        }
        let _ = std::fs::remove_file(dir.join("source.docx"));
        write_meta_at(
            &dir.join("project.json"),
            &ProjectMeta {
                name,
                main_doc: default_main_doc(),
                engine: default_engine(),
                color: String::new(),
                kind: String::new(),
                exports: Vec::new(),
                hidden: false,
            },
        )
    }
    .await;
    if let Err(e) = result {
        let _ = std::fs::remove_dir_all(&dir);
        return Err(e);
    }
    Ok(id)
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
fn pandoc_asset() -> Result<(String, bool, &'static str, PathBuf), String> {
    pandoc_asset_for(std::env::consts::OS, std::env::consts::ARCH)
}

fn pandoc_asset_for(os: &str, arch: &str) -> Result<(String, bool, &'static str, PathBuf), String> {
    const V: &str = "3.9.0.2";
    let base = format!("https://github.com/jgm/pandoc/releases/download/{V}");
    match (os, arch) {
        // macOS archives extract to an arch-suffixed directory
        // (pandoc-<V>-arm64/, pandoc-<V>-x86_64/), unlike the Linux/Windows ones.
        ("macos", "aarch64") => Ok((
            format!("{base}/pandoc-{V}-arm64-macOS.zip"),
            false,
            "6e9eca844076bcbb599bbeebbba78a70f93b5307782b85c2c272872812c88875",
            PathBuf::from(format!("pandoc-{V}-arm64/bin/pandoc")),
        )),
        ("linux", "x86_64") => Ok((
            format!("{base}/pandoc-{V}-linux-amd64.tar.gz"),
            true,
            "a69abfababda8a56969a254b09f9553a7be89ddec00d4e0fe9fd585d71a67508",
            PathBuf::from(format!("pandoc-{V}/bin/pandoc")),
        )),
        ("linux", "aarch64") => Ok((
            format!("{base}/pandoc-{V}-linux-arm64.tar.gz"),
            true,
            "b6d21e8f9c3b15744f5a7ab40248019157ed7793875dbe0383d4c82ff572b528",
            PathBuf::from(format!("pandoc-{V}/bin/pandoc")),
        )),
        ("windows", "x86_64") => Ok((
            format!("{base}/pandoc-{V}-windows-x86_64.zip"),
            false,
            "c97542f2800f446e788d9f74237856d995421ad1bb3cc8324286840c5f272d3a",
            PathBuf::from(format!("pandoc-{V}/pandoc.exe")),
        )),
        _ => Err(format!(
            "Automatic Pandoc download is not supported on {}/{}. Install Pandoc manually.",
            os, arch
        )),
    }
}

/// Extract the `pandoc` binary from a downloaded archive to `dest`.
fn extract_pandoc(
    archive: &std::path::Path,
    is_targz: bool,
    dest: &std::path::Path,
    expected: &Path,
) -> Result<(), String> {
    use std::io::Read;
    const MAX_EXECUTABLE_BYTES: u64 = 100 * 1024 * 1024;
    let file = std::fs::File::open(archive).map_err(|e| e.to_string())?;
    if is_targz {
        let gz = flate2::read::GzDecoder::new(file);
        let mut ar = tar::Archive::new(gz);
        for entry in ar.entries().map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            let path = entry.path().map_err(|e| e.to_string())?.into_owned();
            if path == expected {
                if !entry.header().entry_type().is_file() || entry.size() > MAX_EXECUTABLE_BYTES {
                    return Err("invalid pandoc executable member".to_string());
                }
                let mut out = std::fs::File::create(dest).map_err(|e| e.to_string())?;
                let copied = std::io::copy(&mut entry.take(MAX_EXECUTABLE_BYTES + 1), &mut out)
                    .map_err(|e| e.to_string())?;
                if copied > MAX_EXECUTABLE_BYTES {
                    return Err("pandoc executable exceeds size limit".to_string());
                }
                return Ok(());
            }
        }
    } else {
        let mut zip = zip::ZipArchive::new(file).map_err(|e| e.to_string())?;
        for i in 0..zip.len() {
            let f = zip.by_index(i).map_err(|e| e.to_string())?;
            let Some(path) = f.enclosed_name() else {
                continue;
            };
            if path == expected {
                if !f.is_file() || f.size() > MAX_EXECUTABLE_BYTES {
                    return Err("invalid pandoc executable member".to_string());
                }
                let mut out = std::fs::File::create(dest).map_err(|e| e.to_string())?;
                let copied = std::io::copy(&mut f.take(MAX_EXECUTABLE_BYTES + 1), &mut out)
                    .map_err(|e| e.to_string())?;
                if copied > MAX_EXECUTABLE_BYTES {
                    return Err("pandoc executable exceeds size limit".to_string());
                }
                return Ok(());
            }
        }
    }
    Err("pandoc binary not found in the downloaded archive.".to_string())
}

/// Download pandoc on demand and cache it under `~/.oleafly/bin`. Emits
/// `pandoc-download-progress` events; returns the path to the ready binary.
#[tauri::command]
pub async fn download_pandoc(
    app: tauri::AppHandle,
    state: tauri::State<'_, crate::state::AppState>,
) -> Result<String, String> {
    use futures_util::StreamExt;
    use std::io::Write as _;
    use tauri::Emitter;

    let _install = state.pandoc_install_lock.lock().await;
    if let Some(p) = find_pandoc() {
        return Ok(p);
    }
    let (url, is_targz, expected_sha256, expected_member) = pandoc_asset()?;
    let bin_dir = paths::oleafly_root()?.join("bin");
    std::fs::create_dir_all(&bin_dir).map_err(|e| e.to_string())?;
    let nonce = format!(
        "{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_err(|e| e.to_string())?
            .as_nanos()
    );
    let tmp = bin_dir.join(format!("pandoc-{nonce}.archive"));
    let staging = bin_dir.join(format!("pandoc-{nonce}.staging"));

    struct Cleanup(Vec<PathBuf>);
    impl Drop for Cleanup {
        fn drop(&mut self) {
            for path in &self.0 {
                let _ = std::fs::remove_file(path);
            }
        }
    }
    let mut cleanup = Cleanup(vec![tmp.clone(), staging.clone()]);

    let client = reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(15))
        .timeout(std::time::Duration::from_secs(180))
        .build()
        .map_err(|e| format!("failed to configure download: {e}"))?;
    let resp = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("download failed: {e}"))?
        .error_for_status()
        .map_err(|e| format!("download failed: {e}"))?;
    const MAX_ARCHIVE_BYTES: u64 = 150 * 1024 * 1024;
    let total = resp.content_length();
    if total.is_some_and(|size| size > MAX_ARCHIVE_BYTES) {
        return Err("pandoc download exceeds the 150 MB safety limit".to_string());
    }
    let mut file = std::fs::File::create(&tmp).map_err(|e| e.to_string())?;
    let mut stream = resp.bytes_stream();
    let mut received: u64 = 0;
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("download interrupted: {e}"))?;
        received += chunk.len() as u64;
        if received > MAX_ARCHIVE_BYTES {
            drop(file);
            let _ = std::fs::remove_file(&tmp);
            return Err("pandoc download exceeded the 150 MB safety limit".to_string());
        }
        file.write_all(&chunk).map_err(|e| e.to_string())?;
        let _ = app.emit(
            "pandoc-download-progress",
            PandocProgress { received, total },
        );
    }
    file.flush().map_err(|e| e.to_string())?;
    file.sync_all().map_err(|e| e.to_string())?;
    drop(file);

    use sha2::{Digest, Sha256};
    let mut archive = std::fs::File::open(&tmp).map_err(|e| e.to_string())?;
    let mut hasher = Sha256::new();
    std::io::copy(&mut archive, &mut hasher).map_err(|e| e.to_string())?;
    let actual = format!("{:x}", hasher.finalize());
    if actual != expected_sha256 {
        return Err(format!(
            "Pandoc archive integrity check failed (expected {expected_sha256}, got {actual})"
        ));
    }

    let dest = bin_dir.join(if cfg!(windows) {
        "pandoc.exe"
    } else {
        "pandoc"
    });
    extract_pandoc(&tmp, is_targz, &staging, &expected_member)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&staging, std::fs::Permissions::from_mode(0o755))
            .map_err(|e| e.to_string())?;
    }
    let staging_file = std::fs::OpenOptions::new()
        .read(true)
        .open(&staging)
        .map_err(|e| e.to_string())?;
    staging_file.sync_all().map_err(|e| e.to_string())?;
    let version = std::process::Command::new(&staging)
        .no_console()
        .arg("--version")
        .output()
        .map_err(|e| format!("Downloaded Pandoc failed to run: {e}"))?;
    if !version.status.success()
        || !String::from_utf8_lossy(&version.stdout).starts_with("pandoc 3.9.0.2")
    {
        return Err("Downloaded executable did not identify as Pandoc 3.9.0.2".to_string());
    }
    let backup = bin_dir.join(format!("pandoc-{nonce}.previous"));
    if dest.exists() {
        std::fs::rename(&dest, &backup)
            .map_err(|e| format!("failed to stage prior Pandoc cache: {e}"))?;
        cleanup.0.push(backup.clone());
    }
    if let Err(error) = std::fs::rename(&staging, &dest) {
        if backup.exists() {
            let _ = std::fs::rename(&backup, &dest);
        }
        return Err(format!("failed to publish Pandoc atomically: {error}"));
    }
    drop(cleanup);
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
    create_project_transaction(&dir, || {
        let manifest = crate::templates::instantiate(&app, &template_id, &dir)?;
        crate::document_engine::engine_for(&manifest.engine, &manifest.main_doc)?;
        crate::assets::stage_template_fonts(&app, &manifest, &dir)?;
        let color = color
            .filter(|c| !c.is_empty())
            .or(manifest.default_color)
            .unwrap_or_default();
        write_meta_at(
            &dir.join("project.json"),
            &ProjectMeta {
                name,
                main_doc: manifest.main_doc,
                engine: manifest.engine,
                color,
                kind: manifest.kind.unwrap_or_default(),
                exports: Vec::new(),
                hidden: false,
            },
        )
    })?;
    Ok(id)
}

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
        || n.ends_with(".typ")
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
        if name_str == ".oleafly" || name_str == ".git" {
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

/// Zip a project's source files (excluding `.oleafly`, `.git`) to `dest`.
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
                if name_str == ".oleafly" || name_str == ".git" {
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
    use super::{
        create_diagram_project, create_image_project_in, create_markdown_project_in,
        create_project_transaction, create_typst_project_in, engine_for_main_document,
        extract_pandoc, get_or_create_scratch_project, list_projects, pandoc_asset_for, read_meta,
        rel_slash, validate_conversion_export, ProjectMeta, SCRATCH_PROJECT_ID,
    };
    use std::io::Write;
    use std::path::Path;

    fn test_dir(label: &str) -> std::path::PathBuf {
        let path = std::env::temp_dir().join(format!(
            "oleafly-{label}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&path).unwrap();
        path
    }

    fn zip_with_member(path: &Path, member: &str, contents: &[u8]) {
        let file = std::fs::File::create(path).unwrap();
        let mut zip = zip::ZipWriter::new(file);
        zip.start_file(member, zip::write::SimpleFileOptions::default())
            .unwrap();
        zip.write_all(contents).unwrap();
        zip.finish().unwrap();
    }

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

    #[test]
    fn main_document_selection_switches_engine_safely() {
        assert_eq!(
            engine_for_main_document("xetex", "main.typ").unwrap(),
            "typst"
        );
        assert_eq!(
            engine_for_main_document("typst", "main.tex").unwrap(),
            "xetex"
        );
        assert_eq!(
            engine_for_main_document("luatex", "main.ltx").unwrap(),
            "luatex"
        );
        assert_eq!(
            engine_for_main_document("typst", "main.md").unwrap(),
            "markdown"
        );
        assert_eq!(
            engine_for_main_document("markdown", "main.tex").unwrap(),
            "xetex"
        );
    }

    #[test]
    fn typst_project_metadata_round_trips() {
        let meta = ProjectMeta {
            name: "Typst paper".into(),
            main_doc: "chapters/main.typ".into(),
            engine: "typst".into(),
            color: String::new(),
            kind: String::new(),
            exports: Vec::new(),
            hidden: false,
        };
        let json = serde_json::to_string(&meta).unwrap();
        let decoded: ProjectMeta = serde_json::from_str(&json).unwrap();
        assert_eq!(decoded.main_doc, "chapters/main.typ");
        assert_eq!(decoded.engine, "typst");
    }

    #[test]
    fn create_markdown_project_writes_source_and_metadata() {
        let root = test_dir("markdown-create");
        let id = create_markdown_project_in(&root, "Markdown paper".into()).unwrap();
        let dir = root.join(id);
        let source = std::fs::read_to_string(dir.join("main.md")).unwrap();
        let meta: ProjectMeta =
            serde_json::from_str(&std::fs::read_to_string(dir.join("project.json")).unwrap())
                .unwrap();
        assert!(source.contains("# Introduction"));
        assert_eq!(meta.main_doc, "main.md");
        assert_eq!(meta.engine, "markdown");
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn managed_pandoc_manifest_is_exact_and_fail_closed() {
        let (url, _, hash, member) = pandoc_asset_for("macos", "aarch64").unwrap();
        assert!(url.ends_with("pandoc-3.9.0.2-arm64-macOS.zip"));
        assert_eq!(
            hash,
            "6e9eca844076bcbb599bbeebbba78a70f93b5307782b85c2c272872812c88875"
        );
        assert_eq!(member, Path::new("pandoc-3.9.0.2-arm64/bin/pandoc"));
        let (url, tar, hash, _) = pandoc_asset_for("linux", "x86_64").unwrap();
        assert!(tar && url.ends_with("pandoc-3.9.0.2-linux-amd64.tar.gz"));
        assert_eq!(
            hash,
            "a69abfababda8a56969a254b09f9553a7be89ddec00d4e0fe9fd585d71a67508"
        );
        let (url, _, hash, member) = pandoc_asset_for("windows", "x86_64").unwrap();
        assert!(url.ends_with("pandoc-3.9.0.2-windows-x86_64.zip"));
        assert_eq!(
            hash,
            "c97542f2800f446e788d9f74237856d995421ad1bb3cc8324286840c5f272d3a"
        );
        assert_eq!(member, Path::new("pandoc-3.9.0.2/pandoc.exe"));
        let (url, tar, hash, member) = pandoc_asset_for("linux", "aarch64").unwrap();
        assert!(tar && url.ends_with("pandoc-3.9.0.2-linux-arm64.tar.gz"));
        assert_eq!(
            hash,
            "b6d21e8f9c3b15744f5a7ab40248019157ed7793875dbe0383d4c82ff572b528"
        );
        assert_eq!(member, Path::new("pandoc-3.9.0.2/bin/pandoc"));
    }

    #[test]
    fn windows_pandoc_zip_extracts_only_the_exact_nested_member() {
        let root = test_dir("pandoc-windows-zip");
        let expected = Path::new("pandoc-3.9.0.2/pandoc.exe");
        let valid_archive = root.join("valid.zip");
        let valid_dest = root.join("valid-pandoc.exe");
        zip_with_member(&valid_archive, "pandoc-3.9.0.2/pandoc.exe", b"valid");
        extract_pandoc(&valid_archive, false, &valid_dest, expected).unwrap();
        assert_eq!(std::fs::read(valid_dest).unwrap(), b"valid");

        for (name, member) in [
            ("basename", "pandoc.exe"),
            ("wrong-version", "pandoc-3.8/pandoc.exe"),
            ("unsafe", "../pandoc-3.9.0.2/pandoc.exe"),
        ] {
            let archive = root.join(format!("{name}.zip"));
            let dest = root.join(format!("{name}-pandoc.exe"));
            zip_with_member(&archive, member, b"invalid");
            assert!(extract_pandoc(&archive, false, &dest, expected).is_err());
            assert!(!dest.exists());
        }

        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn create_typst_project_writes_source_and_metadata() {
        let root = test_dir("typst-create");
        let id = create_typst_project_in(&root, "Typst paper".into()).unwrap();
        let dir = root.join(id);
        assert!(dir.join("main.typ").is_file());
        let meta: ProjectMeta =
            serde_json::from_str(&std::fs::read_to_string(dir.join("project.json")).unwrap())
                .unwrap();
        assert_eq!(meta.name, "Typst paper");
        assert_eq!(meta.main_doc, "main.typ");
        assert_eq!(meta.engine, "typst");
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn failed_project_initialization_removes_partial_directory() {
        let root = test_dir("typst-rollback");
        let dir = root.join("partial-project");
        let result = create_project_transaction(&dir, || {
            std::fs::write(dir.join("main.typ"), "partial").unwrap();
            Err("simulated metadata failure".into())
        });
        assert!(result.is_err());
        assert!(!dir.exists());
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn image_project_uses_transactional_initializer() {
        let root = test_dir("image-create");
        let id = create_image_project_in(
            &root,
            "Diagram".into(),
            "\\documentclass{standalone}".into(),
            Some("#123456".into()),
        )
        .unwrap();
        let dir = root.join(id);
        let meta: ProjectMeta =
            serde_json::from_str(&std::fs::read_to_string(dir.join("project.json")).unwrap())
                .unwrap();
        assert_eq!(meta.kind, "image");
        assert!(dir.join("main.tex").is_file());
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn conversion_exports_are_allowlisted_by_persisted_engine() {
        let latex = ProjectMeta {
            main_doc: "main.tex".into(),
            engine: "xetex".into(),
            ..ProjectMeta::default()
        };
        assert_eq!(
            validate_conversion_export(&latex, "docx", "/tmp/out.docx").unwrap(),
            "docx"
        );
        assert!(validate_conversion_export(&latex, "exe", "/tmp/out.exe").is_err());
        assert!(validate_conversion_export(&latex, "docx", "/tmp/crafted.html").is_err());
        let typst = ProjectMeta {
            main_doc: "main.typ".into(),
            engine: "typst".into(),
            ..ProjectMeta::default()
        };
        assert!(validate_conversion_export(&typst, "docx", "/tmp/out.docx").is_err());
        let markdown = ProjectMeta {
            main_doc: "main.md".into(),
            engine: "markdown".into(),
            ..ProjectMeta::default()
        };
        assert!(validate_conversion_export(&markdown, "md", "/tmp/out.md").is_err());
        assert_eq!(
            validate_conversion_export(&markdown, "html", "/tmp/out.html").unwrap(),
            "html5"
        );
        assert_eq!(
            validate_conversion_export(&markdown, "txt", "/tmp/out.txt").unwrap(),
            "plain"
        );
    }

    #[test]
    fn docx_pandoc_args_extract_media_into_assets() {
        let args = super::docx_pandoc_args();
        assert!(args.contains(&"--from=docx".to_string()));
        assert!(args.contains(&"--to=latex".to_string()));
        assert!(args.contains(&"--standalone".to_string()));
        assert!(args.contains(&"--extract-media=assets".to_string()));
        let o = args.iter().position(|a| a == "-o").unwrap();
        assert_eq!(args[o + 1], "main.tex");
        assert_eq!(args.last().unwrap(), "source.docx");
    }

    #[test]
    fn docx_base64_must_decode_and_look_like_zip() {
        use base64::{engine::general_purpose::STANDARD, Engine};
        assert!(super::decode_docx_base64("not base64 ???").is_err());
        let bogus = STANDARD.encode(b"plain text");
        assert!(super::decode_docx_base64(&bogus).is_err());
        let zipish = STANDARD.encode(b"PK\x03\x04rest-of-file");
        assert!(super::decode_docx_base64(&zipish).is_ok());
    }

    #[test]
    fn scratch_project_is_hidden_and_idempotent() {
        let _env_guard = crate::paths::data_dir_env_lock();
        let root = test_dir("scratch-project");
        std::env::set_var("OLEAFLY_DATA_DIR", &root);
        let id1 = get_or_create_scratch_project().unwrap();
        let id2 = get_or_create_scratch_project().unwrap();
        assert_eq!(id1, id2);
        assert_eq!(id1, SCRATCH_PROJECT_ID);
        let meta = read_meta(&id1).unwrap();
        assert!(meta.hidden);
        assert_eq!(meta.kind, "diagram");
        let listed = list_projects().unwrap();
        assert!(listed.iter().all(|p| p.id != SCRATCH_PROJECT_ID));
        std::env::remove_var("OLEAFLY_DATA_DIR");
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn diagram_project_has_diagram_kind() {
        let _env_guard = crate::paths::data_dir_env_lock();
        let root = test_dir("diagram-project");
        std::env::set_var("OLEAFLY_DATA_DIR", &root);
        let id = create_diagram_project(
            "My Diagram".to_string(),
            "\\documentclass{standalone}".to_string(),
        )
        .unwrap();
        let meta = read_meta(&id).unwrap();
        assert_eq!(meta.kind, "diagram");
        assert_eq!(meta.name, "My Diagram");
        assert!(!meta.hidden);
        std::env::remove_var("OLEAFLY_DATA_DIR");
        std::fs::remove_dir_all(root).unwrap();
    }
}
