use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

use crate::paths;
use crate::proc::NoConsole;
use crate::sandbox::{atomic_write, guard_export_dest, is_root_delete, resolve, AtomicFile};

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

/// Reproducibility pin for latexmk projects: which TeX distribution and which
/// package versions produced this project's output. Lives in project.json so
/// it travels with git and every coauthor sees the same spec (the app-internal
/// `.oleafly/` directory is deliberately gitignored, so it cannot live there).
#[derive(Serialize, Deserialize, Default, Clone)]
pub struct TexSpec {
    /// Distribution kind ("oleafly-tinytex", "mactex", "texlive", "miktex", ...).
    #[serde(default)]
    pub distribution: String,
    /// Human label, e.g. "TeX Live 2025".
    #[serde(default)]
    pub distribution_label: String,
    /// tlmgr package -> version (CTAN version or TeX Live revision). The
    /// npm-lockfile role: coauthors are prompted to install what is missing.
    #[serde(default)]
    pub packages: std::collections::BTreeMap<String, String>,
    /// Unix epoch seconds when the spec was captured.
    #[serde(default)]
    pub recorded_at: f64,
}

#[derive(Serialize, Deserialize, Default, Clone)]
pub struct ProjectMeta {
    #[serde(default)]
    pub name: String,
    #[serde(default = "default_main_doc")]
    pub main_doc: String,
    #[serde(default = "default_engine")]
    pub engine: String,
    /// Present on latexmk projects once an engine spec has been recorded.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tex: Option<TexSpec>,
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
    #[serde(default)]
    pub forked_from: Option<String>,
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

#[derive(Clone, Copy, Debug, Default, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum FileConflictStrategy {
    #[default]
    Error,
    KeepBoth,
    Replace,
}

#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum RenameFileResult {
    Renamed {
        path: String,
    },
    Conflict {
        destination: String,
        suggested_destination: String,
    },
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
    pub forked_from: Option<String>,
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
            forked_from: None,
            tex: None,
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

pub(crate) fn read_compile_meta(project_id: &str, main_doc: &str) -> Result<ProjectMeta, String> {
    let meta = read_meta(project_id)?;
    if meta.main_doc != main_doc {
        return Err("The main document changed. Refresh the project and compile again.".into());
    }
    Ok(meta)
}

pub(crate) fn ensure_compile_meta_unchanged(
    project_id: &str,
    main_doc: &str,
    expected_engine: &str,
) -> Result<(), String> {
    let current = read_compile_meta(project_id, main_doc)?;
    if current.engine != expected_engine {
        return Err("The main document changed. Refresh the project and compile again.".into());
    }
    Ok(())
}

fn write_meta_at(path: &Path, meta: &ProjectMeta) -> Result<(), String> {
    let s = serde_json::to_string_pretty(meta).map_err(|e| e.to_string())?;
    atomic_write(path, s.as_bytes()).map_err(|e| format!("failed to write project.json: {e}"))
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
pub async fn write_file(project_id: String, path: String, content: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
        let p = resolve(&project_id, &path)?;
        if let Some(parent) = p.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        atomic_write(&p, content.as_bytes()).map_err(|e| format!("failed to write {path}: {e}"))
    })
    .await
    .map_err(|e| format!("file write task failed: {e}"))?
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
        atomic_write(&p, &[]).map_err(|e| e.to_string())
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
pub fn rename_file(
    project_id: String,
    from: String,
    to: String,
    conflict_strategy: Option<FileConflictStrategy>,
) -> Result<RenameFileResult, String> {
    static FILE_MOVE_LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    let _guard = FILE_MOVE_LOCK
        .get_or_init(|| Mutex::new(()))
        .lock()
        .map_err(|_| "file move lock is unavailable".to_string())?;
    let root = paths::project_dir(&project_id)?;
    let src = resolve(&project_id, &from)?;
    let dst = resolve(&project_id, &to)?;
    rename_path_in_project(
        &root,
        &src,
        &dst,
        &to,
        conflict_strategy.unwrap_or_default(),
    )
}

fn rename_path_in_project(
    root: &Path,
    src: &Path,
    requested_dst: &Path,
    requested_rel: &str,
    strategy: FileConflictStrategy,
) -> Result<RenameFileResult, String> {
    if src == root || requested_dst == root {
        return Err("refusing to move the project root".into());
    }
    let source_meta = std::fs::symlink_metadata(src)
        .map_err(|e| format!("could not read the move source: {e}"))?;
    if source_meta.file_type().is_symlink() {
        return Err("refusing to move a symbolic link".into());
    }
    if source_meta.is_dir() && requested_dst.starts_with(src) {
        return Err("cannot move a folder into itself".into());
    }
    if src == requested_dst {
        return Ok(RenameFileResult::Renamed {
            path: requested_rel.to_string(),
        });
    }

    if let Some(parent) = requested_dst.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    let collision = portable_collision(requested_dst)?;
    if let Some(existing) = collision.as_ref() {
        if same_entry(src, existing) {
            rename_case_only(src, requested_dst)?;
            return Ok(RenameFileResult::Renamed {
                path: requested_rel.to_string(),
            });
        }
    }

    let destination = match (collision, strategy) {
        (Some(_), FileConflictStrategy::Error) => {
            let suggested = unique_destination(requested_dst, source_meta.is_dir())?;
            return Ok(RenameFileResult::Conflict {
                destination: requested_rel.to_string(),
                suggested_destination: rel_slash(root, &suggested),
            });
        }
        (Some(_), FileConflictStrategy::KeepBoth) => {
            unique_destination(requested_dst, source_meta.is_dir())?
        }
        (Some(existing), FileConflictStrategy::Replace) => {
            replace_path(root, src, &existing, requested_dst)?;
            return Ok(RenameFileResult::Renamed {
                path: requested_rel.to_string(),
            });
        }
        (None, _) => requested_dst.to_path_buf(),
    };

    match rename_exclusive(src, &destination) {
        Ok(()) => Ok(RenameFileResult::Renamed {
            path: rel_slash(root, &destination),
        }),
        Err(_error) if portable_collision(&destination)?.is_some() => {
            if strategy == FileConflictStrategy::KeepBoth {
                let retry = unique_destination(&destination, source_meta.is_dir())?;
                rename_exclusive(src, &retry)
                    .map_err(|e| format!("move failed after choosing a unique name: {e}"))?;
                Ok(RenameFileResult::Renamed {
                    path: rel_slash(root, &retry),
                })
            } else {
                let suggested = unique_destination(&destination, source_meta.is_dir())?;
                Ok(RenameFileResult::Conflict {
                    destination: rel_slash(root, &destination),
                    suggested_destination: rel_slash(root, &suggested),
                })
            }
        }
        Err(error) => Err(format!("move failed: {error}")),
    }
}

/// Find an existing sibling using case-insensitive comparison. This makes a
/// project created on Linux obey the same collision rules it will encounter on
/// the default macOS and Windows filesystems.
fn portable_collision(path: &Path) -> Result<Option<PathBuf>, String> {
    let Some(parent) = path.parent() else {
        return Ok(None);
    };
    let Some(file_name) = path.file_name() else {
        return Ok(None);
    };
    if !parent.is_dir() {
        return Ok(None);
    }
    let target = file_name.to_string_lossy().to_lowercase();
    for entry in std::fs::read_dir(parent).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        if entry.file_name().to_string_lossy().to_lowercase() == target {
            return Ok(Some(entry.path()));
        }
    }
    Ok(None)
}

fn same_entry(left: &Path, right: &Path) -> bool {
    if left == right {
        return true;
    }
    match (left.canonicalize(), right.canonicalize()) {
        (Ok(left), Ok(right)) => left == right,
        _ => false,
    }
}

fn unique_destination(path: &Path, is_dir: bool) -> Result<PathBuf, String> {
    let parent = path
        .parent()
        .ok_or_else(|| "destination has no parent folder".to_string())?;
    let name = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| "destination name is not valid Unicode".to_string())?;
    let (base, extension) = if is_dir {
        (name.to_string(), String::new())
    } else {
        let stem = path
            .file_stem()
            .and_then(|stem| stem.to_str())
            .unwrap_or(name);
        let extension = path
            .extension()
            .and_then(|extension| extension.to_str())
            .map(|extension| format!(".{extension}"))
            .unwrap_or_default();
        (stem.to_string(), extension)
    };

    for suffix in 2..=10_000 {
        let candidate = parent.join(format!("{base} ({suffix}){extension}"));
        if portable_collision(&candidate)?.is_none() {
            return Ok(candidate);
        }
    }
    Err("could not find an available destination name".into())
}

fn unique_copy_destination(path: &Path, is_dir: bool) -> Result<PathBuf, String> {
    if portable_collision(path)?.is_none() {
        return Ok(path.to_path_buf());
    }
    let parent = path
        .parent()
        .ok_or_else(|| "copy destination has no parent folder".to_string())?;
    let name = path
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| "copy destination name is not valid Unicode".to_string())?;
    let (base, extension) = if is_dir {
        (name.to_string(), String::new())
    } else {
        let stem = path
            .file_stem()
            .and_then(|value| value.to_str())
            .unwrap_or(name);
        let extension = path
            .extension()
            .and_then(|value| value.to_str())
            .map(|value| format!(".{value}"))
            .unwrap_or_default();
        (stem.to_string(), extension)
    };
    for suffix in 2..=10_000 {
        let candidate = parent.join(format!("{base} {suffix}{extension}"));
        if portable_collision(&candidate)?.is_none() {
            return Ok(candidate);
        }
    }
    Err("could not find an available copy name".into())
}

fn rename_case_only(src: &Path, dst: &Path) -> Result<(), String> {
    let parent = src
        .parent()
        .ok_or_else(|| "move source has no parent folder".to_string())?;
    let temporary = unique_temporary_path(parent, ".oleafly-case-rename")?;
    rename_exclusive(src, &temporary).map_err(|e| format!("case-only move failed: {e}"))?;
    if let Err(error) = rename_exclusive(&temporary, dst) {
        let rollback = rename_exclusive(&temporary, src);
        return Err(match rollback {
            Ok(()) => format!("case-only move failed and was rolled back: {error}"),
            Err(rollback_error) => {
                format!("Case-only move failed: {error}. Rollback also failed: {rollback_error}")
            }
        });
    }
    Ok(())
}

fn replace_path(root: &Path, src: &Path, existing: &Path, dst: &Path) -> Result<(), String> {
    let backup_root = root.join(".oleafly").join("move-backups");
    ensure_private_directory(root, &backup_root)?;
    let backup = unique_temporary_path(&backup_root, "replaced")?;
    rename_exclusive(existing, &backup)
        .map_err(|e| format!("could not stage the existing destination: {e}"))?;

    if let Err(error) = rename_exclusive(src, dst) {
        let rollback = rename_exclusive(&backup, existing);
        return Err(match rollback {
            Ok(()) => format!("replace failed and was rolled back: {error}"),
            Err(rollback_error) => {
                format!("Replace failed: {error}. Rollback also failed: {rollback_error}")
            }
        });
    }

    // The requested move already succeeded. A cleanup failure must not report
    // the operation as failed and tempt the caller to repeat it; the backup is
    // kept under the app-private directory and can be removed later.
    let _ = remove_path(&backup);
    Ok(())
}

fn ensure_private_directory(root: &Path, directory: &Path) -> Result<(), String> {
    let internal = root.join(".oleafly");
    match std::fs::symlink_metadata(&internal) {
        Ok(metadata) if metadata.is_dir() && !metadata.file_type().is_symlink() => {}
        Ok(_) => return Err("project data path is not a real directory".into()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            std::fs::create_dir(&internal).map_err(|e| e.to_string())?;
        }
        Err(error) => return Err(error.to_string()),
    }
    match std::fs::symlink_metadata(directory) {
        Ok(metadata) if metadata.is_dir() && !metadata.file_type().is_symlink() => {}
        Ok(_) => return Err("move backup path is not a real directory".into()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            std::fs::create_dir(directory).map_err(|e| e.to_string())?;
        }
        Err(error) => return Err(error.to_string()),
    }
    let resolved = directory.canonicalize().map_err(|e| e.to_string())?;
    let resolved_root = root.canonicalize().map_err(|e| e.to_string())?;
    if !resolved.starts_with(&resolved_root)
        || resolved.parent().and_then(Path::parent) != Some(resolved_root.as_path())
    {
        return Err("move backup directory escapes the project".into());
    }
    Ok(())
}

fn unique_temporary_path(parent: &Path, prefix: &str) -> Result<PathBuf, String> {
    for suffix in 0..10_000_u32 {
        let candidate = parent.join(format!("{prefix}-{}-{suffix}", std::process::id()));
        if portable_collision(&candidate)?.is_none() {
            return Ok(candidate);
        }
    }
    Err("could not create a temporary move path".into())
}

fn create_unique_temporary_directory(parent: &Path, prefix: &str) -> Result<PathBuf, String> {
    for suffix in 0..10_000_u32 {
        let candidate = parent.join(format!("{prefix}-{}-{suffix}", std::process::id()));
        match std::fs::create_dir(&candidate) {
            Ok(()) => return Ok(candidate),
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(format!("could not create a staging directory: {error}")),
        }
    }
    Err("could not reserve a staging directory".into())
}

fn remove_path(path: &Path) -> std::io::Result<()> {
    let metadata = std::fs::symlink_metadata(path)?;
    if metadata.is_dir() {
        std::fs::remove_dir_all(path)
    } else {
        std::fs::remove_file(path)
    }
}

#[cfg(any(target_os = "macos", target_os = "ios"))]
fn rename_exclusive(src: &Path, dst: &Path) -> std::io::Result<()> {
    use std::ffi::CString;
    use std::os::unix::ffi::OsStrExt;

    let src = CString::new(src.as_os_str().as_bytes())
        .map_err(|_| std::io::Error::new(std::io::ErrorKind::InvalidInput, "NUL in source path"))?;
    let dst = CString::new(dst.as_os_str().as_bytes()).map_err(|_| {
        std::io::Error::new(std::io::ErrorKind::InvalidInput, "NUL in destination path")
    })?;
    let result = unsafe { libc::renamex_np(src.as_ptr(), dst.as_ptr(), libc::RENAME_EXCL) };
    if result == 0 {
        Ok(())
    } else {
        Err(std::io::Error::last_os_error())
    }
}

#[cfg(any(target_os = "linux", target_os = "android"))]
fn rename_exclusive(src: &Path, dst: &Path) -> std::io::Result<()> {
    use std::ffi::CString;
    use std::os::unix::ffi::OsStrExt;

    let src = CString::new(src.as_os_str().as_bytes())
        .map_err(|_| std::io::Error::new(std::io::ErrorKind::InvalidInput, "NUL in source path"))?;
    let dst = CString::new(dst.as_os_str().as_bytes()).map_err(|_| {
        std::io::Error::new(std::io::ErrorKind::InvalidInput, "NUL in destination path")
    })?;
    let result = unsafe {
        libc::renameat2(
            libc::AT_FDCWD,
            src.as_ptr(),
            libc::AT_FDCWD,
            dst.as_ptr(),
            libc::RENAME_NOREPLACE,
        )
    };
    if result == 0 {
        Ok(())
    } else {
        Err(std::io::Error::last_os_error())
    }
}

#[cfg(windows)]
fn rename_exclusive(src: &Path, dst: &Path) -> std::io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::MoveFileExW;

    let src: Vec<u16> = src.as_os_str().encode_wide().chain(Some(0)).collect();
    let dst: Vec<u16> = dst.as_os_str().encode_wide().chain(Some(0)).collect();
    let result = unsafe { MoveFileExW(src.as_ptr(), dst.as_ptr(), 0) };
    if result != 0 {
        Ok(())
    } else {
        Err(std::io::Error::last_os_error())
    }
}

#[cfg(not(any(
    target_os = "macos",
    target_os = "ios",
    target_os = "linux",
    target_os = "android",
    windows
)))]
fn rename_exclusive(src: &Path, dst: &Path) -> std::io::Result<()> {
    if dst.exists() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::AlreadyExists,
            "destination already exists",
        ));
    }
    std::fs::rename(src, dst)
}

/// Copy a file or folder within a project. Files are byte-level copied (handles
/// binaries like PDFs); folders are copied recursively (symlinks skipped, with
/// an explicit depth error). Async + spawn_blocking keeps large copies off UI.
#[tauri::command]
pub async fn copy_file(project_id: String, from: String, to: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || -> Result<String, String> {
        let root = paths::project_dir(&project_id)?;
        let src = resolve(&project_id, &from)?;
        let requested_dst = resolve(&project_id, &to)?;
        copy_path_in_project(&root, &src, &requested_dst)
    })
    .await
    .map_err(|e| e.to_string())?
}

fn copy_path_in_project(root: &Path, src: &Path, requested_dst: &Path) -> Result<String, String> {
    static FILE_COPY_LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    let _guard = FILE_COPY_LOCK
        .get_or_init(|| Mutex::new(()))
        .lock()
        .map_err(|_| "file copy lock is unavailable".to_string())?;
    if requested_dst == src {
        return Err("source and destination are the same".into());
    }
    let meta = std::fs::symlink_metadata(src).map_err(|e| e.to_string())?;
    if meta.file_type().is_symlink() {
        return Err("refusing to copy a symbolic link".into());
    }
    if meta.is_dir() && requested_dst.starts_with(src) {
        return Err("cannot copy a folder into itself".into());
    }
    let dst = unique_copy_destination(requested_dst, meta.is_dir())?;
    let parent = dst
        .parent()
        .ok_or_else(|| "copy destination has no parent folder".to_string())?;
    if !parent.exists() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let staged = unique_temporary_path(parent, ".oleafly-copy")?;
    let copied = if meta.is_dir() {
        copy_dir_recursive(src, &staged, 0)
    } else {
        std::fs::copy(src, &staged)
            .map(|_| ())
            .map_err(|e| format!("copy failed: {e}"))
    };
    if let Err(error) = copied {
        if staged.exists() {
            let _ = remove_path(&staged);
        }
        return Err(error);
    }
    if let Err(error) = rename_exclusive(&staged, &dst) {
        let _ = remove_path(&staged);
        return Err(format!("could not publish the copy: {error}"));
    }
    Ok(rel_slash(root, &dst))
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
        atomic_write(&p, &bytes).map_err(|e| format!("failed to write {path}: {e}"))
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

async fn set_main_doc_synchronized(
    state: &crate::state::AppState,
    project_id: String,
    main_doc: String,
) -> Result<ProjectMeta, String> {
    // Metadata selection and main-output publication share one lock. A main
    // switch therefore happens wholly before or wholly after a compile, never
    // between its final identity check and revision allocation.
    let _guard = state.compile_lock.lock().await;
    set_main_doc_unlocked(project_id, main_doc)
}

#[tauri::command]
pub async fn set_main_doc(
    state: tauri::State<'_, crate::state::AppState>,
    project_id: String,
    main_doc: String,
) -> Result<ProjectMeta, String> {
    set_main_doc_synchronized(&state, project_id, main_doc).await
}

fn set_main_doc_unlocked(project_id: String, main_doc: String) -> Result<ProjectMeta, String> {
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

/// Pin a project's compile engine in `project.json` (e.g. "xetex" for the
/// bundled Tectonic, "latexmk" for a system TeX toolchain). Shares the compile
/// lock with `set_main_doc` so an engine switch never lands between a compile's
/// final identity check and its revision allocation.
#[tauri::command]
pub async fn set_project_engine(
    state: tauri::State<'_, crate::state::AppState>,
    project_id: String,
    engine: String,
) -> Result<ProjectMeta, String> {
    let _guard = state.compile_lock.lock().await;
    let engine = engine.trim().to_string();
    if engine.is_empty() {
        return Err("engine name cannot be empty".into());
    }
    let mut meta = read_meta(&project_id)?;
    // Reject engines that cannot compile the current main document before
    // persisting anything.
    crate::document_engine::engine_for(&engine, &meta.main_doc)?;
    meta.engine = engine;
    write_meta(&project_id, &meta)?;
    Ok(meta)
}

fn epoch_seconds() -> f64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs_f64())
        .unwrap_or(0.0)
}

fn collect_tex_spec() -> Option<TexSpec> {
    let active = crate::tex_distro::list_distributions()
        .into_iter()
        .find(|d| d.latexmk.is_some())?;
    // No tlmgr (e.g. MiKTeX, which installs packages on the fly) still yields
    // a distribution pin; the package map just stays empty.
    let packages = crate::latex_engine::tlmgr_installed_versions().unwrap_or_default();
    Some(TexSpec {
        distribution: active.kind,
        distribution_label: active.label,
        packages,
        recorded_at: epoch_seconds(),
    })
}

/// Capture the local TeX distribution + tlmgr package versions into the
/// project's reproducibility pin. Called after a project switches to latexmk.
/// The slow part (tlmgr info, seconds) runs before the lock is taken.
#[tauri::command]
pub async fn record_project_tex_spec(
    state: tauri::State<'_, crate::state::AppState>,
    project_id: String,
) -> Result<Option<TexSpec>, String> {
    let spec = tauri::async_runtime::spawn_blocking(collect_tex_spec)
        .await
        .map_err(|e| e.to_string())?;
    let Some(spec) = spec else { return Ok(None) };
    let _guard = state.compile_lock.lock().await;
    let mut meta = read_meta(&project_id)?;
    if meta.engine != "latexmk" {
        return Ok(None);
    }
    meta.tex = Some(spec.clone());
    write_meta(&project_id, &meta)?;
    Ok(Some(spec))
}

/// How this machine compares against the project's reproducibility pin.
#[derive(Serialize)]
pub struct TexStatus {
    pub pinned_label: String,
    pub local_label: Option<String>,
    pub distribution_differs: bool,
    pub missing_packages: Vec<String>,
    /// Whether "install the missing packages" is actionable here (tlmgr found).
    pub can_install_missing: bool,
}

/// Compare the local TeX setup against the project pin (latexmk projects with
/// a recorded spec only). Coauthors get prompted from this on project open.
#[tauri::command]
pub async fn project_tex_status(project_id: String) -> Result<Option<TexStatus>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let meta = read_meta(&project_id)?;
        if meta.engine != "latexmk" {
            return Ok(None);
        }
        let Some(spec) = meta.tex else {
            return Ok(None);
        };
        let active = crate::tex_distro::list_distributions()
            .into_iter()
            .find(|d| d.latexmk.is_some());
        let local_label = active.as_ref().map(|d| d.label.clone());
        let can_install = active.as_ref().is_some_and(|d| d.tlmgr.is_some());
        let missing_packages = if can_install && !spec.packages.is_empty() {
            let installed = crate::latex_engine::tlmgr_installed_versions()
                .map(|versions| {
                    versions
                        .into_keys()
                        .collect::<std::collections::BTreeSet<_>>()
                })
                .unwrap_or_default();
            spec.packages
                .keys()
                .filter(|name| !installed.contains(*name))
                .cloned()
                .collect()
        } else {
            Vec::new()
        };
        let distribution_differs = local_label.as_deref() != Some(spec.distribution_label.as_str());
        Ok(Some(TexStatus {
            pinned_label: spec.distribution_label,
            local_label,
            distribution_differs,
            missing_packages,
            can_install_missing: can_install,
        }))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Record a successful compile's provenance under `.oleafly/builds/`.
/// Best-effort: failures here must never fail the compile itself.
pub(crate) fn write_build_metadata(
    project_id: &str,
    revision: u64,
    engine: &str,
    output_id: Option<&str>,
    compile_time_ms: u64,
) {
    use sha2::Digest;
    let Ok(dir) = paths::builds_metadata_dir(project_id) else {
        return;
    };
    let tex = read_meta(project_id).ok().and_then(|meta| meta.tex);
    let lockfile_hash = tex.as_ref().map(|spec| {
        let serialized = serde_json::to_vec(&spec.packages).unwrap_or_default();
        format!("sha256:{:x}", sha2::Sha256::digest(&serialized))
    });
    let record = serde_json::json!({
        "revision": revision,
        "engine": engine,
        "distribution": tex.as_ref().map(|spec| spec.distribution_label.clone()),
        "lockfile_hash": lockfile_hash,
        "output_id": output_id,
        "compile_time_ms": compile_time_ms,
        "completed_at": epoch_seconds(),
    });
    let path = dir.join(format!("build-{revision:010}.json"));
    if let Ok(bytes) = serde_json::to_vec_pretty(&record) {
        let _ = std::fs::write(path, bytes);
    }
    prune_build_metadata(&dir, 20);
}

/// Keep only the newest `keep` build records (names sort chronologically
/// because the revision is zero-padded).
fn prune_build_metadata(dir: &Path, keep: usize) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    let mut names: Vec<String> = entries
        .flatten()
        .filter_map(|entry| entry.file_name().into_string().ok())
        .filter(|name| name.starts_with("build-") && name.ends_with(".json"))
        .collect();
    if names.len() <= keep {
        return;
    }
    names.sort();
    let excess = names.len() - keep;
    for name in names.into_iter().take(excess) {
        let _ = std::fs::remove_file(dir.join(name));
    }
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
                forked_from: None,
                tex: None,
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

fn project_meta_for_enumeration(project_id: &str, directory: &Path) -> Result<ProjectMeta, String> {
    paths::validate_project_id(project_id)?;
    let metadata_path = directory.join("project.json");
    let metadata = std::fs::symlink_metadata(&metadata_path)
        .map_err(|error| format!("project metadata is unavailable: {error}"))?;
    if !metadata.is_file() || metadata.file_type().is_symlink() {
        return Err("project metadata is not a regular file".into());
    }
    read_meta(project_id)
}

fn log_project_enumeration_skip(project_id: &str, error: &str) {
    let message = format!("Skipping project directory {project_id:?}: {error}");
    #[cfg(debug_assertions)]
    eprintln!("{message}");
    let _ = append_app_log(message);
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
        if let Err(error) = paths::validate_project_id(&id) {
            // Same-filesystem project transactions intentionally use
            // dot-prefixed sibling directories. They are internal state, not
            // malformed user projects, and are expected to exist briefly.
            if !id.starts_with(".oleafly-") {
                log_project_enumeration_skip(&id, &error);
            }
            continue;
        }
        let meta = match project_meta_for_enumeration(&id, &entry.path()) {
            Ok(meta) => meta,
            Err(error) => {
                log_project_enumeration_skip(&id, &error);
                continue;
            }
        };
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
            forked_from: meta.forked_from,
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
                forked_from: None,
                tex: None,
            },
        )
    })?;
    Ok(id)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PdfConversionFigure {
    pub name: String,
    pub data_base64: String,
}

/// Publish a converted PDF as one complete project. The library never observes
/// a project containing only `main.tex` (or only some figures): every payload
/// is validated and staged in a sibling directory before the final rename.
#[tauri::command]
pub fn create_project_from_pdf_conversion(
    name: String,
    tex: String,
    figures: Vec<PdfConversionFigure>,
) -> Result<String, String> {
    use base64::{engine::general_purpose::STANDARD, Engine};

    static PDF_IMPORT_PROJECT_LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    let _guard = PDF_IMPORT_PROJECT_LOCK
        .get_or_init(|| Mutex::new(()))
        .lock()
        .map_err(|_| "PDF import project lock is unavailable".to_string())?;
    let root = paths::projects_root()?;
    let id = unique_random_slug(&root)?;
    let destination = root.join(&id);
    let staging = create_unique_temporary_directory(&root, ".oleafly-pdf-import")?;

    let initialize = || -> Result<(), String> {
        let mut figure_names = HashSet::new();
        let mut decoded = Vec::with_capacity(figures.len());
        for figure in figures {
            let figure_path = Path::new(&figure.name);
            let portable_name = !figure.name.is_empty()
                && !figure.name.contains('/')
                && !figure.name.contains('\\')
                && figure.name != "."
                && figure.name != ".."
                && figure_path.file_name().and_then(|value| value.to_str())
                    == Some(figure.name.as_str());
            if !portable_name {
                return Err(format!("invalid imported figure name: {}", figure.name));
            }
            if !figure_names.insert(figure.name.to_lowercase()) {
                return Err(format!("duplicate imported figure name: {}", figure.name));
            }
            let bytes = STANDARD
                .decode(figure.data_base64.trim())
                .map_err(|e| format!("invalid figure data for {}: {e}", figure.name))?;
            decoded.push((figure.name, bytes));
        }

        atomic_write(&staging.join("main.tex"), tex.as_bytes())
            .map_err(|e| format!("could not write converted LaTeX: {e}"))?;
        if !decoded.is_empty() {
            let assets = staging.join("assets");
            std::fs::create_dir(&assets).map_err(|e| format!("could not create assets: {e}"))?;
            for (figure_name, bytes) in decoded {
                atomic_write(&assets.join(figure_name), &bytes)
                    .map_err(|e| format!("could not write imported figure: {e}"))?;
            }
        }
        write_meta_at(
            &staging.join("project.json"),
            &ProjectMeta {
                name,
                main_doc: default_main_doc(),
                engine: default_engine(),
                color: String::new(),
                kind: String::new(),
                exports: Vec::new(),
                hidden: false,
                forked_from: None,
                tex: None,
            },
        )?;
        rename_exclusive(&staging, &destination)
            .map_err(|e| format!("could not publish the imported project: {e}"))
    };

    if let Err(error) = initialize() {
        if staging.exists() {
            let _ = std::fs::remove_dir_all(&staging);
        }
        return Err(error);
    }
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
                forked_from: None,
                tex: None,
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
                forked_from: None,
                tex: None,
            },
        )
    })?;
    Ok(id)
}

/// Guarantees `source` is a compilable standalone document. The Diagram
/// Composer's "save as project" flow wraps its output before calling this
/// command, but this is the single place every diagram project's initial
/// file passes through, so it doubles as a safety net against ever writing
/// a project with a bare TikZ body and no preamble/`\begin{document}`.
fn ensure_diagram_document(source: String) -> String {
    if source.contains("\\begin{document}") {
        return source;
    }
    format!(
        "\\documentclass[tikz,border=4pt]{{standalone}}\n\
         \\usepackage{{tikz}}\n\
         \\usetikzlibrary{{shapes.geometric,arrows.meta,positioning,calc,backgrounds}}\n\
         \\begin{{document}}\n\
         {}\n\
         \\end{{document}}\n",
        source.trim()
    )
}

#[tauri::command]
pub fn create_diagram_project(name: String, source: String) -> Result<String, String> {
    let root = paths::projects_root()?;
    let id = unique_random_slug(&root)?;
    let dir = root.join(&id);
    let source = ensure_diagram_document(source);
    create_project_transaction(&dir, || {
        std::fs::write(dir.join("main.tex"), &source).map_err(|e| e.to_string())?;
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
                forked_from: None,
                tex: None,
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
                forked_from: None,
                tex: None,
            },
        )?;
    }
    Ok(SCRATCH_PROJECT_ID.to_string())
}

#[derive(Serialize)]
pub struct FigureCacheResult {
    pub hash: String,
    pub already_cached: bool,
}

#[tauri::command]
pub fn save_figure_to_cache(
    name: String,
    png_base64: String,
    tikz: String,
) -> Result<FigureCacheResult, String> {
    use base64::{engine::general_purpose::STANDARD, Engine};
    use sha2::{Digest, Sha256};

    let png_bytes = STANDARD
        .decode(png_base64.as_bytes())
        .map_err(|e| format!("invalid PNG data: {e}"))?;
    let mut hasher = Sha256::new();
    hasher.update(&png_bytes);
    let hash = format!("{:x}", hasher.finalize());

    let entry_dir = paths::figures_cache_root()?.join(&hash);
    if entry_dir.exists() {
        return Ok(FigureCacheResult {
            hash,
            already_cached: true,
        });
    }
    std::fs::create_dir_all(&entry_dir).map_err(|e| e.to_string())?;
    std::fs::write(entry_dir.join("figure.png"), &png_bytes).map_err(|e| e.to_string())?;
    std::fs::write(entry_dir.join("figure.tikz"), &tikz).map_err(|e| e.to_string())?;
    let meta = serde_json::json!({ "name": name, "hash": hash });
    std::fs::write(
        entry_dir.join("meta.json"),
        serde_json::to_string_pretty(&meta).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    Ok(FigureCacheResult {
        hash,
        already_cached: false,
    })
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
    let transaction = AtomicFile::for_export(&dest)?;
    let meta = read_meta(&project_id)?;
    let pdf = crate::document_engine::compiled_pdf_path(&project_id, &meta.engine, &meta.main_doc)?;
    if !pdf.exists() {
        return Err("No compiled PDF found - recompile first.".into());
    }
    std::fs::copy(&pdf, transaction.staging_path())
        .map_err(|e| format!("failed to stage PDF: {e}"))?;
    transaction.commit()?;
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
    // The artifact is already durably published. Export-history bookkeeping is
    // best-effort so a metadata failure never reports a false export failure.
    let _ = write_meta(&project_id, &meta);
    Ok(())
}

// `--embed-resources` requires pandoc 2.19+.
fn pandoc_version_supported(version_stdout: &[u8]) -> bool {
    let Some(first_line) = String::from_utf8_lossy(version_stdout)
        .lines()
        .next()
        .map(str::to_string)
    else {
        return false;
    };
    let Some(version) = first_line.split_whitespace().nth(1) else {
        return false;
    };
    let mut parts = version.split('.').filter_map(|p| p.parse::<u32>().ok());
    let major = parts.next().unwrap_or(0);
    let minor = parts.next().unwrap_or(0);
    major > 2 || (major == 2 && minor >= 19)
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
            .map(|o| o.status.success() && pandoc_version_supported(&o.stdout))
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
    app: tauri::AppHandle,
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
        return Err("The main document changed. Reopen the export menu and try again.".into());
    }
    let writer = validate_conversion_export(&meta, &format, &dest)?;
    let root = paths::project_dir(&project_id)?;
    resolve(&project_id, &main_doc)?;
    let found = tauri::async_runtime::spawn_blocking(find_pandoc)
        .await
        .map_err(|e| e.to_string())?;
    let pandoc = match found {
        Some(p) => p,
        None => download_pandoc_impl(app, &state.pandoc_install_lock).await?,
    };
    let transaction = AtomicFile::for_export(&dest)?;
    let staged_dest = transaction.staging_path().to_string_lossy().into_owned();
    let mut args = vec![format!("--to={writer}"), "-o".into(), staged_dest];
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
    transaction.commit()?;
    if let Ok(canon) = Path::new(&reveal_dest).canonicalize() {
        let mut allow = state.reveal_allowlist.lock().await;
        if allow.len() >= 1024 {
            allow.pop_front();
        }
        allow.push_back(canon);
    }

    let mut meta = read_meta(&project_id)?;
    let filename = Path::new(&dest)
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or(dest.as_str())
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
    let _ = write_meta(&project_id, &meta);
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
    let destination = root.join(&id);
    let staging = create_unique_temporary_directory(&root, ".oleafly-docx-import")?;
    let result: Result<(), String> = async {
        atomic_write(&staging.join("source.docx"), &bytes)
            .map_err(|e| format!("failed to write source.docx: {e}"))?;
        let (log, code) = crate::document_engine::run_supervised_external(
            Path::new(&pandoc),
            &docx_pandoc_args(),
            &staging,
        )
        .await?;
        if code != Some(0) {
            return Err(format!("pandoc failed: {}", log.trim()));
        }
        let _ = std::fs::remove_file(staging.join("source.docx"));
        write_meta_at(
            &staging.join("project.json"),
            &ProjectMeta {
                name,
                main_doc: default_main_doc(),
                engine: default_engine(),
                color: String::new(),
                kind: String::new(),
                exports: Vec::new(),
                hidden: false,
                forked_from: None,
                tex: None,
            },
        )?;
        rename_exclusive(&staging, &destination)
            .map_err(|e| format!("could not publish the imported project: {e}"))
    }
    .await;
    if let Err(e) = result {
        if staging.exists() {
            let _ = std::fs::remove_dir_all(&staging);
        }
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
    // The real pandoc binary is ~150-230MB uncompressed depending on platform
    // (Windows is the largest); this just bounds a corrupted/substituted
    // release asset from filling the disk, with headroom for pandoc growth.
    const MAX_EXECUTABLE_BYTES: u64 = 300 * 1024 * 1024;
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
    download_pandoc_impl(app, &state.pandoc_install_lock).await
}

async fn download_pandoc_impl(
    app: tauri::AppHandle,
    install_lock: &tauri::async_runtime::Mutex<()>,
) -> Result<String, String> {
    use futures_util::StreamExt;
    use std::io::Write as _;
    use tauri::Emitter;

    let _install = install_lock.lock().await;
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
    // Windows' FlushFileBuffers rejects read-only handles with "Access is
    // denied", so the durability sync needs a writable handle, and that handle
    // must be closed before the binary can be executed or renamed below.
    let staging_file = std::fs::OpenOptions::new()
        .read(true)
        .write(true)
        .open(&staging)
        .map_err(|e| e.to_string())?;
    staging_file.sync_all().map_err(|e| e.to_string())?;
    drop(staging_file);
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
                forked_from: None,
                tex: None,
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
            if paths::validate_project_id(&project_id).is_err() {
                continue;
            }
            let meta = match project_meta_for_enumeration(&project_id, &entry.path()) {
                Ok(meta) if !meta.hidden => meta,
                Ok(_) => continue,
                Err(error) => {
                    log_project_enumeration_skip(&project_id, &error);
                    continue;
                }
            };
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
        let transaction = AtomicFile::for_export(&dest)?;
        let root = paths::project_dir(&project_id)?;
        let file = std::fs::File::create(transaction.staging_path()).map_err(|e| e.to_string())?;
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
                return Err(format!(
                    "project archive exceeds the maximum folder depth of {MAX_WALK_DEPTH}"
                ));
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
        transaction.commit()
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
            let source_name = if meta.name.is_empty() {
                project_id.clone()
            } else {
                meta.name.clone()
            };
            meta.name = new_name;
            meta.forked_from = Some(source_name);
            let _ = write_meta(&new_id, &meta);
        }
        Ok(new_id)
    })
    .await
    .map_err(|e| e.to_string())?
}

fn copy_dir_recursive(src: &Path, dst: &Path, depth: usize) -> Result<(), String> {
    if depth >= MAX_WALK_DEPTH {
        return Err(format!(
            "copy exceeds the maximum folder depth of {MAX_WALK_DEPTH}"
        ));
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

#[tauri::command]
pub async fn import_paths_into_project(
    project_id: String,
    dest_dir: String,
    source_paths: Vec<String>,
) -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(move || -> Result<Vec<String>, String> {
        static FILE_IMPORT_LOCK: OnceLock<Mutex<()>> = OnceLock::new();
        let _guard = FILE_IMPORT_LOCK
            .get_or_init(|| Mutex::new(()))
            .lock()
            .map_err(|_| "file import lock is unavailable".to_string())?;
        let dest_parent = resolve(&project_id, &dest_dir)?;
        let project_root = paths::project_dir(&project_id)?;
        let sources: Vec<PathBuf> = source_paths.iter().map(PathBuf::from).collect();
        import_paths_transactional(&project_root, &dest_parent, &sources)
    })
    .await
    .map_err(|e| e.to_string())?
}

fn validate_import_source(path: &Path, depth: usize) -> Result<(), String> {
    if depth >= MAX_WALK_DEPTH {
        return Err(format!(
            "import exceeds the maximum folder depth of {MAX_WALK_DEPTH}"
        ));
    }
    let metadata = std::fs::symlink_metadata(path)
        .map_err(|e| format!("cannot read {}: {e}", path.display()))?;
    if metadata.file_type().is_symlink() {
        return Err(format!("refusing to import a symlink: {}", path.display()));
    }
    if metadata.is_file() {
        return Ok(());
    }
    if !metadata.is_dir() {
        return Err(format!(
            "only regular files and folders can be imported: {}",
            path.display()
        ));
    }
    for entry in std::fs::read_dir(path).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        validate_import_source(&entry.path(), depth + 1)?;
    }
    Ok(())
}

fn unique_import_dest(
    dir: &Path,
    name: &str,
    reserved: &mut HashSet<String>,
) -> Result<PathBuf, String> {
    let available = |candidate: &Path, reserved: &HashSet<String>| -> Result<bool, String> {
        let key = candidate
            .file_name()
            .and_then(|value| value.to_str())
            .ok_or_else(|| "import destination name is not valid Unicode".to_string())?
            .to_lowercase();
        Ok(!reserved.contains(&key) && portable_collision(candidate)?.is_none())
    };
    let candidate = dir.join(name);
    if available(&candidate, reserved)? {
        reserved.insert(name.to_lowercase());
        return Ok(candidate);
    }
    let (stem, ext) = match name.rfind('.') {
        Some(i) if i > 0 => (&name[..i], &name[i..]),
        _ => (name, ""),
    };
    for n in 2..=10_000 {
        let candidate = dir.join(format!("{stem} ({n}){ext}"));
        if available(&candidate, reserved)? {
            let key = candidate
                .file_name()
                .and_then(|value| value.to_str())
                .ok_or_else(|| "import destination name is not valid Unicode".to_string())?
                .to_lowercase();
            reserved.insert(key);
            return Ok(candidate);
        }
    }
    Err("could not find an available import destination".into())
}

fn import_paths_transactional(
    project_root: &Path,
    dest_parent: &Path,
    sources: &[PathBuf],
) -> Result<Vec<String>, String> {
    import_paths_transactional_with(project_root, dest_parent, sources, &mut |from, to| {
        rename_exclusive(from, to)
    })
}

fn import_paths_transactional_with<F>(
    project_root: &Path,
    dest_parent: &Path,
    sources: &[PathBuf],
    publish: &mut F,
) -> Result<Vec<String>, String>
where
    F: FnMut(&Path, &Path) -> std::io::Result<()>,
{
    let destination_meta = std::fs::symlink_metadata(dest_parent)
        .map_err(|e| format!("cannot read the import destination: {e}"))?;
    if !destination_meta.is_dir() || destination_meta.file_type().is_symlink() {
        return Err("import destination is not a real directory".into());
    }
    let canonical_destination = dest_parent
        .canonicalize()
        .map_err(|e| format!("cannot resolve the import destination: {e}"))?;
    let canonical_root = project_root
        .canonicalize()
        .map_err(|e| format!("cannot resolve the project: {e}"))?;
    if !canonical_destination.starts_with(&canonical_root) {
        return Err("import destination escapes the project".into());
    }

    let mut reserved = HashSet::new();
    let mut plans = Vec::with_capacity(sources.len());
    for source in sources {
        validate_import_source(source, 0)?;
        let metadata = std::fs::symlink_metadata(source)
            .map_err(|e| format!("cannot read {}: {e}", source.display()))?;
        let canonical_source = source
            .canonicalize()
            .map_err(|e| format!("cannot resolve {}: {e}", source.display()))?;
        if metadata.is_dir() && canonical_destination.starts_with(&canonical_source) {
            return Err(format!(
                "cannot import a folder into itself: {}",
                source.display()
            ));
        }
        let name = source
            .file_name()
            .and_then(|value| value.to_str())
            .ok_or_else(|| format!("invalid source path: {}", source.display()))?;
        let destination = unique_import_dest(dest_parent, name, &mut reserved)?;
        plans.push((source.clone(), metadata.is_dir(), destination));
    }
    if plans.is_empty() {
        return Ok(Vec::new());
    }

    let staging_root = project_root.join(".oleafly").join("import-staging");
    ensure_private_directory(project_root, &staging_root)?;
    let staging = unique_temporary_path(&staging_root, "batch")?;
    std::fs::create_dir(&staging).map_err(|e| format!("cannot stage the import: {e}"))?;

    let mut staged = Vec::with_capacity(plans.len());
    for (index, (source, is_dir, destination)) in plans.iter().enumerate() {
        let staged_path = staging.join(format!("item-{index}"));
        let result = if *is_dir {
            copy_dir_recursive(source, &staged_path, 0)
        } else {
            std::fs::copy(source, &staged_path)
                .map(|_| ())
                .map_err(|e| format!("import failed: {e}"))
        };
        if let Err(error) = result {
            let _ = std::fs::remove_dir_all(&staging);
            return Err(error);
        }
        staged.push((staged_path, destination.clone()));
    }

    let mut committed: Vec<(PathBuf, PathBuf)> = Vec::new();
    for (staged_path, destination) in &staged {
        if let Err(error) = publish(staged_path, destination) {
            let mut rollback_errors = Vec::new();
            for (published, original_stage) in committed.iter().rev() {
                if let Err(rollback_error) = rename_exclusive(published, original_stage) {
                    rollback_errors.push(rollback_error.to_string());
                }
            }
            let _ = std::fs::remove_dir_all(&staging);
            return if rollback_errors.is_empty() {
                Err(format!(
                    "Could not publish the import. Changes were rolled back: {error}"
                ))
            } else {
                Err(format!(
                    "Could not publish the import: {error}. Rollback also failed: {}",
                    rollback_errors.join(". ")
                ))
            };
        }
        committed.push((destination.clone(), staged_path.clone()));
    }

    let _ = std::fs::remove_dir(&staging);
    Ok(plans
        .iter()
        .map(|(_, _, destination)| rel_slash(project_root, destination))
        .collect())
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
        copy_path_in_project, create_diagram_project, create_image_project_in,
        create_markdown_project_in, create_project_from_pdf_conversion, create_project_transaction,
        create_typst_project, create_typst_project_in, download_project_zip, duplicate_project,
        engine_for_main_document, extract_pandoc, get_or_create_scratch_project,
        import_paths_transactional, import_paths_transactional_with, list_projects,
        pandoc_asset_for, pandoc_version_supported, read_meta, rel_slash, rename_exclusive,
        rename_path_in_project, search_docs, set_main_doc_synchronized, validate_conversion_export,
        write_meta_at, FileConflictStrategy, PdfConversionFigure, ProjectMeta, RenameFileResult,
        SCRATCH_PROJECT_ID,
    };
    use std::io::Write;
    use std::path::Path;
    use std::sync::Arc;

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
    fn repeated_copy_uses_portable_names_without_overwriting() {
        let root = test_dir("copy-repeat");
        let source = root.join("draft.tex");
        let requested = root.join("draft copy.tex");
        std::fs::write(&source, "original").unwrap();
        std::fs::write(&requested, "existing copy").unwrap();

        let first = copy_path_in_project(&root, &source, &requested).unwrap();
        let second = copy_path_in_project(&root, &source, &requested).unwrap();

        assert_eq!(first, "draft copy 2.tex");
        assert_eq!(second, "draft copy 3.tex");
        assert_eq!(
            std::fs::read_to_string(&requested).unwrap(),
            "existing copy"
        );
        assert_eq!(
            std::fs::read_to_string(root.join(&first)).unwrap(),
            "original"
        );
        assert_eq!(
            std::fs::read_to_string(root.join(&second)).unwrap(),
            "original"
        );
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn concurrent_copy_requests_publish_distinct_complete_files() {
        let root = Arc::new(test_dir("copy-concurrent"));
        let source = root.join("draft.tex");
        let requested = root.join("draft copy.tex");
        let payload = "complete payload".repeat(8_192);
        std::fs::write(&source, &payload).unwrap();
        let mut workers = Vec::new();
        for _ in 0..6 {
            let root = Arc::clone(&root);
            let source = source.clone();
            let requested = requested.clone();
            workers.push(std::thread::spawn(move || {
                copy_path_in_project(&root, &source, &requested).unwrap()
            }));
        }
        let mut destinations: Vec<String> = workers
            .into_iter()
            .map(|worker| worker.join().unwrap())
            .collect();
        destinations.sort();
        destinations.dedup();
        assert_eq!(destinations.len(), 6);
        for destination in destinations {
            assert_eq!(
                std::fs::read_to_string(root.join(destination)).unwrap(),
                payload
            );
        }
        std::fs::remove_dir_all(root.as_path()).unwrap();
    }

    #[test]
    fn deep_copy_fails_explicitly_and_removes_its_partial_stage() {
        let root = test_dir("copy-depth");
        let source = root.join("deep");
        let mut cursor = source.clone();
        std::fs::create_dir(&cursor).unwrap();
        for index in 0..64 {
            cursor = cursor.join(format!("d{index}"));
            std::fs::create_dir(&cursor).unwrap();
        }
        std::fs::write(cursor.join("leaf.txt"), "leaf").unwrap();
        let requested = root.join("deep copy");

        let error = copy_path_in_project(&root, &source, &requested).unwrap_err();

        assert!(error.contains("maximum folder depth"));
        assert!(!requested.exists());
        assert!(std::fs::read_dir(&root)
            .unwrap()
            .flatten()
            .all(|entry| !entry
                .file_name()
                .to_string_lossy()
                .starts_with(".oleafly-copy")));
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn multi_source_import_preflights_every_source_before_mutating() {
        let project = test_dir("import-preflight-project");
        let destination = project.join("imports");
        std::fs::create_dir(&destination).unwrap();
        let sources = test_dir("import-preflight-sources");
        let valid = sources.join("valid.txt");
        std::fs::write(&valid, "valid").unwrap();
        let missing = sources.join("missing.txt");

        let error =
            import_paths_transactional(&project, &destination, &[valid, missing]).unwrap_err();

        assert!(error.contains("cannot read"));
        assert_eq!(std::fs::read_dir(&destination).unwrap().count(), 0);
        assert!(!project.join(".oleafly").exists());
        std::fs::remove_dir_all(project).unwrap();
        std::fs::remove_dir_all(sources).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn import_rejects_nested_symlinks_before_staging_any_source() {
        let project = test_dir("import-symlink-project");
        let destination = project.join("imports");
        std::fs::create_dir(&destination).unwrap();
        let sources = test_dir("import-symlink-sources");
        let safe = sources.join("safe.txt");
        let folder = sources.join("folder");
        std::fs::write(&safe, "safe").unwrap();
        std::fs::create_dir(&folder).unwrap();
        std::os::unix::fs::symlink(&safe, folder.join("link.txt")).unwrap();

        let error =
            import_paths_transactional(&project, &destination, &[safe, folder]).unwrap_err();

        assert!(error.contains("symlink"));
        assert_eq!(std::fs::read_dir(&destination).unwrap().count(), 0);
        assert!(!project.join(".oleafly").exists());
        std::fs::remove_dir_all(project).unwrap();
        std::fs::remove_dir_all(sources).unwrap();
    }

    #[test]
    fn multi_source_import_rolls_back_an_injected_publish_failure() {
        let project = test_dir("import-rollback-project");
        let destination = project.join("imports");
        std::fs::create_dir(&destination).unwrap();
        let sources = test_dir("import-rollback-sources");
        let first = sources.join("first.txt");
        let second = sources.join("second.txt");
        std::fs::write(&first, "first").unwrap();
        std::fs::write(&second, "second").unwrap();
        let mut publishes = 0;

        let error = import_paths_transactional_with(
            &project,
            &destination,
            &[first, second],
            &mut |from, to| {
                publishes += 1;
                if publishes == 2 {
                    Err(std::io::Error::other("injected publish failure"))
                } else {
                    rename_exclusive(from, to)
                }
            },
        )
        .unwrap_err();

        assert!(error.contains("rolled back"));
        assert_eq!(std::fs::read_dir(&destination).unwrap().count(), 0);
        std::fs::remove_dir_all(project).unwrap();
        std::fs::remove_dir_all(sources).unwrap();
    }

    #[test]
    fn import_names_are_reserved_case_insensitively_across_the_batch() {
        let project = test_dir("import-portable-project");
        let destination = project.join("imports");
        std::fs::create_dir(&destination).unwrap();
        let sources = test_dir("import-portable-sources");
        let left = sources.join("left");
        let right = sources.join("right");
        std::fs::create_dir(&left).unwrap();
        std::fs::create_dir(&right).unwrap();
        let first = left.join("Paper.tex");
        let second = right.join("paper.tex");
        std::fs::write(&first, "first").unwrap();
        std::fs::write(&second, "second").unwrap();

        let imported =
            import_paths_transactional(&project, &destination, &[first, second]).unwrap();

        assert_eq!(imported, ["imports/Paper.tex", "imports/paper (2).tex"]);
        assert_eq!(
            std::fs::read_to_string(destination.join("Paper.tex")).unwrap(),
            "first"
        );
        assert_eq!(
            std::fs::read_to_string(destination.join("paper (2).tex")).unwrap(),
            "second"
        );
        std::fs::remove_dir_all(project).unwrap();
        std::fs::remove_dir_all(sources).unwrap();
    }

    #[test]
    fn converted_pdf_figure_deserializes_the_frontend_ipc_contract() {
        let figure: PdfConversionFigure = serde_json::from_value(serde_json::json!({
            "name": "figure.png",
            "dataBase64": "AQID"
        }))
        .unwrap();

        assert_eq!(figure.name, "figure.png");
        assert_eq!(figure.data_base64, "AQID");
    }

    #[test]
    fn converted_pdf_project_is_published_only_after_every_payload_is_valid() {
        let _env_guard = crate::paths::data_dir_env_lock();
        let data = test_dir("converted-project");
        std::env::set_var("OLEAFLY_DATA_DIR", &data);

        let id = create_project_from_pdf_conversion(
            "Imported".into(),
            "\\documentclass{article}\\begin{document}Ready\\end{document}".into(),
            vec![PdfConversionFigure {
                name: "figure.png".into(),
                data_base64: "AQID".into(),
            }],
        )
        .unwrap();
        let project = data.join("projects").join(&id);
        assert!(project.join("project.json").is_file());
        assert!(project.join("main.tex").is_file());
        assert_eq!(
            std::fs::read(project.join("assets").join("figure.png")).unwrap(),
            [1, 2, 3]
        );

        let visible_before = std::fs::read_dir(data.join("projects")).unwrap().count();
        let error = create_project_from_pdf_conversion(
            "Broken".into(),
            "partial".into(),
            vec![PdfConversionFigure {
                name: "bad.png".into(),
                data_base64: "not base64".into(),
            }],
        )
        .unwrap_err();
        assert!(error.contains("invalid figure data"));
        assert_eq!(
            std::fs::read_dir(data.join("projects")).unwrap().count(),
            visible_before
        );

        std::env::remove_var("OLEAFLY_DATA_DIR");
        std::fs::remove_dir_all(data).unwrap();
    }

    #[allow(clippy::await_holding_lock)]
    #[tokio::test]
    async fn failed_deep_zip_export_preserves_the_existing_artifact() {
        let _env_guard = crate::paths::data_dir_env_lock();
        let data = test_dir("zip-depth");
        std::env::set_var("OLEAFLY_DATA_DIR", &data);
        let project_id = "deep-project";
        let project = data.join("projects").join(project_id);
        let mut cursor = project.clone();
        std::fs::create_dir_all(&cursor).unwrap();
        for index in 0..64 {
            cursor = cursor.join(format!("d{index}"));
            std::fs::create_dir(&cursor).unwrap();
        }
        std::fs::write(cursor.join("leaf.txt"), "leaf").unwrap();
        let destination = data.join("existing.zip");
        std::fs::write(&destination, b"previous archive").unwrap();

        let error = download_project_zip(
            project_id.into(),
            destination.to_string_lossy().into_owned(),
        )
        .await
        .unwrap_err();

        assert!(error.contains("maximum folder depth"));
        assert_eq!(std::fs::read(&destination).unwrap(), b"previous archive");
        assert_eq!(
            std::fs::read_dir(&data)
                .unwrap()
                .flatten()
                .filter(|entry| { entry.file_name().to_string_lossy().contains(".oleafly-") })
                .count(),
            0
        );
        std::env::remove_var("OLEAFLY_DATA_DIR");
        std::fs::remove_dir_all(data).unwrap();
    }

    #[test]
    fn rename_conflict_is_non_destructive_and_suggests_a_portable_name() {
        let root = test_dir("rename-conflict");
        let src = root.join("draft.tex");
        let dst = root.join("paper.tex");
        std::fs::write(&src, "new draft").unwrap();
        std::fs::write(&dst, "published").unwrap();

        let result =
            rename_path_in_project(&root, &src, &dst, "paper.tex", FileConflictStrategy::Error)
                .unwrap();

        assert_eq!(
            result,
            RenameFileResult::Conflict {
                destination: "paper.tex".into(),
                suggested_destination: "paper (2).tex".into(),
            }
        );
        assert_eq!(std::fs::read_to_string(src).unwrap(), "new draft");
        assert_eq!(std::fs::read_to_string(dst).unwrap(), "published");
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn keep_both_never_merges_or_overwrites_the_destination() {
        let root = test_dir("rename-keep-both");
        let src = root.join("draft.tex");
        let dst = root.join("paper.tex");
        std::fs::write(&src, "new draft").unwrap();
        std::fs::write(&dst, "published").unwrap();

        let result = rename_path_in_project(
            &root,
            &src,
            &dst,
            "paper.tex",
            FileConflictStrategy::KeepBoth,
        )
        .unwrap();

        assert_eq!(
            result,
            RenameFileResult::Renamed {
                path: "paper (2).tex".into(),
            }
        );
        assert!(!src.exists());
        assert_eq!(std::fs::read_to_string(dst).unwrap(), "published");
        assert_eq!(
            std::fs::read_to_string(root.join("paper (2).tex")).unwrap(),
            "new draft"
        );
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn replace_stages_the_old_destination_before_moving_the_source() {
        let root = test_dir("rename-replace");
        let src = root.join("draft.tex");
        let dst = root.join("paper.tex");
        std::fs::write(&src, "new draft").unwrap();
        std::fs::write(&dst, "published").unwrap();

        let result = rename_path_in_project(
            &root,
            &src,
            &dst,
            "paper.tex",
            FileConflictStrategy::Replace,
        )
        .unwrap();

        assert_eq!(
            result,
            RenameFileResult::Renamed {
                path: "paper.tex".into(),
            }
        );
        assert!(!src.exists());
        assert_eq!(std::fs::read_to_string(dst).unwrap(), "new draft");
        let backups = root.join(".oleafly").join("move-backups");
        assert_eq!(std::fs::read_dir(backups).unwrap().count(), 0);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn collisions_are_case_insensitive_even_on_case_sensitive_filesystems() {
        let root = test_dir("rename-portable-case");
        let target_dir = root.join("target");
        std::fs::create_dir(&target_dir).unwrap();
        let src = root.join("draft.tex");
        let existing = target_dir.join("Paper.tex");
        let requested = target_dir.join("paper.tex");
        std::fs::write(&src, "new draft").unwrap();
        std::fs::write(&existing, "published").unwrap();

        let result = rename_path_in_project(
            &root,
            &src,
            &requested,
            "target/paper.tex",
            FileConflictStrategy::Error,
        )
        .unwrap();

        assert!(matches!(result, RenameFileResult::Conflict { .. }));
        assert_eq!(std::fs::read_to_string(src).unwrap(), "new draft");
        assert_eq!(std::fs::read_to_string(existing).unwrap(), "published");
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn a_case_only_rename_uses_a_two_step_move() {
        let root = test_dir("rename-case-only");
        let src = root.join("Paper.tex");
        let dst = root.join("paper.tex");
        std::fs::write(&src, "paper").unwrap();

        let result =
            rename_path_in_project(&root, &src, &dst, "paper.tex", FileConflictStrategy::Error)
                .unwrap();

        assert_eq!(
            result,
            RenameFileResult::Renamed {
                path: "paper.tex".into(),
            }
        );
        assert_eq!(std::fs::read_to_string(dst).unwrap(), "paper");
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn a_folder_cannot_be_moved_into_its_descendant() {
        let root = test_dir("rename-descendant");
        let src = root.join("chapters");
        std::fs::create_dir(&src).unwrap();
        std::fs::write(src.join("intro.tex"), "intro").unwrap();
        let dst = src.join("archive");

        let error = rename_path_in_project(
            &root,
            &src,
            &dst,
            "chapters/archive",
            FileConflictStrategy::Error,
        )
        .unwrap_err();

        assert!(error.contains("into itself"));
        assert!(src.join("intro.tex").is_file());
        std::fs::remove_dir_all(root).unwrap();
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

    // Held across awaits deliberately: it serializes the shared test data-dir
    // environment variable while proving the async compile lock ordering.
    #[allow(clippy::await_holding_lock)]
    #[tokio::test]
    async fn main_document_selection_waits_for_an_active_compile() {
        let _env_guard = crate::paths::data_dir_env_lock();
        let root = test_dir("main-doc-compile-race");
        std::env::set_var("OLEAFLY_DATA_DIR", &root);
        let project_id = "compile-race";
        let project_dir = root.join("projects").join(project_id);
        std::fs::create_dir_all(&project_dir).unwrap();
        std::fs::write(project_dir.join("main.tex"), "old main").unwrap();
        std::fs::write(project_dir.join("replacement.typ"), "new main").unwrap();
        write_meta_at(
            &project_dir.join("project.json"),
            &ProjectMeta {
                name: "Compile race".into(),
                main_doc: "main.tex".into(),
                engine: "xetex".into(),
                ..ProjectMeta::default()
            },
        )
        .unwrap();

        let state = Arc::new(crate::state::AppState::default());
        let compile_guard = state.compile_lock.lock().await;
        let setter_state = Arc::clone(&state);
        let (started_tx, started_rx) = tokio::sync::oneshot::channel();
        let update = tokio::spawn(async move {
            let _ = started_tx.send(());
            set_main_doc_synchronized(
                setter_state.as_ref(),
                project_id.into(),
                "replacement.typ".into(),
            )
            .await
        });
        started_rx.await.unwrap();
        tokio::task::yield_now().await;

        assert!(!update.is_finished());
        assert_eq!(read_meta(project_id).unwrap().main_doc, "main.tex");

        drop(compile_guard);
        let selected = update.await.unwrap().unwrap();
        assert_eq!(selected.main_doc, "replacement.typ");
        assert_eq!(selected.engine, "typst");
        assert_eq!(read_meta(project_id).unwrap().main_doc, "replacement.typ");
        assert!(super::ensure_compile_meta_unchanged(project_id, "main.tex", "xetex").is_err());
        assert!(
            super::ensure_compile_meta_unchanged(project_id, "replacement.typ", "typst").is_ok()
        );

        std::env::remove_var("OLEAFLY_DATA_DIR");
        std::fs::remove_dir_all(root).unwrap();
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
            forked_from: None,
            tex: None,
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

    #[allow(clippy::await_holding_lock)]
    #[tokio::test]
    async fn project_enumeration_excludes_internal_invalid_and_unreadable_directories() {
        let _env_guard = crate::paths::data_dir_env_lock();
        let data = test_dir("project-enumeration");
        std::env::set_var("OLEAFLY_DATA_DIR", &data);
        let projects = crate::paths::projects_root().unwrap();

        let project_meta = |name: &str| ProjectMeta {
            name: name.into(),
            main_doc: "main.tex".into(),
            engine: "xetex".into(),
            color: String::new(),
            kind: String::new(),
            exports: Vec::new(),
            hidden: false,
            forked_from: None,
            tex: None,
        };

        let valid = projects.join("valid-project");
        std::fs::create_dir(&valid).unwrap();
        std::fs::write(valid.join("main.tex"), "valid").unwrap();
        write_meta_at(&valid.join("project.json"), &project_meta("Valid")).unwrap();

        let missing = projects.join("missing-metadata");
        std::fs::create_dir(&missing).unwrap();
        let corrupt = projects.join("corrupt-metadata");
        std::fs::create_dir(&corrupt).unwrap();
        std::fs::write(corrupt.join("project.json"), "{not json").unwrap();
        let invalid = projects.join("invalid.project");
        std::fs::create_dir(&invalid).unwrap();
        write_meta_at(
            &invalid.join("project.json"),
            &project_meta("Invalid identifier"),
        )
        .unwrap();

        // Model the interval in which a conversion has finished staging every
        // file but has not yet atomically renamed the directory to its valid
        // project id.
        let staging = projects.join(".oleafly-pdf-import-test");
        let published = projects.join("published-project");
        let ready = Arc::new(std::sync::Barrier::new(2));
        let publish = Arc::new(std::sync::Barrier::new(2));
        let worker = {
            let ready = Arc::clone(&ready);
            let publish = Arc::clone(&publish);
            let staging = staging.clone();
            let published = published.clone();
            std::thread::spawn(move || {
                std::fs::create_dir(&staging).unwrap();
                std::fs::write(staging.join("main.tex"), "staged").unwrap();
                write_meta_at(
                    &staging.join("project.json"),
                    &ProjectMeta {
                        name: "Published".into(),
                        main_doc: "main.tex".into(),
                        engine: "xetex".into(),
                        color: String::new(),
                        kind: String::new(),
                        exports: Vec::new(),
                        hidden: false,
                        forked_from: None,
                        tex: None,
                    },
                )
                .unwrap();
                ready.wait();
                publish.wait();
                std::fs::rename(&staging, &published).unwrap();
            })
        };

        ready.wait();
        let staged_listing = list_projects().unwrap();
        assert_eq!(
            staged_listing
                .iter()
                .map(|project| project.id.as_str())
                .collect::<Vec<_>>(),
            ["valid-project"]
        );
        assert!(search_docs("staged".into()).await.unwrap().is_empty());
        assert_eq!(
            search_docs("valid".into()).await.unwrap()[0].project_id,
            "valid-project"
        );
        publish.wait();
        worker.join().unwrap();

        let published_listing = list_projects().unwrap();
        let mut ids: Vec<_> = published_listing
            .iter()
            .map(|project| project.id.as_str())
            .collect();
        ids.sort_unstable();
        assert_eq!(ids, ["published-project", "valid-project"]);

        let log = std::fs::read_to_string(data.join("app.log")).unwrap();
        assert!(log.contains("missing-metadata"));
        assert!(log.contains("corrupt-metadata"));
        assert!(log.contains("invalid.project"));
        assert!(!log.contains(".oleafly-pdf-import-test"));

        std::env::remove_var("OLEAFLY_DATA_DIR");
        std::fs::remove_dir_all(data).unwrap();
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

    #[test]
    fn diagram_project_wraps_a_bare_tikz_body_into_a_compilable_document() {
        let _env_guard = crate::paths::data_dir_env_lock();
        let root = test_dir("diagram-project-bare-body");
        std::env::set_var("OLEAFLY_DATA_DIR", &root);
        let id = create_diagram_project(
            "Bare Body".to_string(),
            "\\definecolor{c000000}{HTML}{000000}\n\\begin{tikzpicture}\n\\end{tikzpicture}"
                .to_string(),
        )
        .unwrap();
        let dir = crate::paths::project_dir(&id).unwrap();
        let main_tex = std::fs::read_to_string(dir.join("main.tex")).unwrap();
        assert!(main_tex.contains("\\documentclass"));
        assert!(main_tex.contains("\\usepackage{tikz}"));
        assert!(main_tex.contains("\\begin{document}"));
        assert!(main_tex.contains("\\end{document}"));
        std::env::remove_var("OLEAFLY_DATA_DIR");
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn diagram_project_leaves_an_already_wrapped_document_untouched() {
        let _env_guard = crate::paths::data_dir_env_lock();
        let root = test_dir("diagram-project-already-wrapped");
        std::env::set_var("OLEAFLY_DATA_DIR", &root);
        let source = "\\documentclass[tikz,border=4pt]{standalone}\n\\usepackage{tikz}\n\\begin{document}\n\\begin{tikzpicture}\n\\end{tikzpicture}\n\\end{document}\n";
        let id = create_diagram_project("Already Wrapped".to_string(), source.to_string()).unwrap();
        let dir = crate::paths::project_dir(&id).unwrap();
        let main_tex = std::fs::read_to_string(dir.join("main.tex")).unwrap();
        assert_eq!(main_tex, source);
        std::env::remove_var("OLEAFLY_DATA_DIR");
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn pandoc_version_gate_accepts_2_19_plus_rejects_older() {
        assert!(pandoc_version_supported(b"pandoc 2.19\nfeatures: ..."));
        assert!(pandoc_version_supported(b"pandoc 3.9.0.2\nfeatures: ..."));
        assert!(!pandoc_version_supported(b"pandoc 2.12\nfeatures: ..."));
        assert!(!pandoc_version_supported(b"pandoc 1.19.2.1\nfeatures: ..."));
        assert!(!pandoc_version_supported(b""));
        assert!(!pandoc_version_supported(b"not pandoc output"));
    }

    // Held across the await deliberately: it serializes access to the shared
    // OLEAFLY_DATA_DIR env var against other tests, single-threaded runtime.
    #[allow(clippy::await_holding_lock)]
    #[tokio::test]
    async fn duplicate_project_records_the_fork_source() {
        let _env_guard = crate::paths::data_dir_env_lock();
        let root = test_dir("duplicate-project-fork");
        std::env::set_var("OLEAFLY_DATA_DIR", &root);
        let source_id = create_typst_project("Original Paper".to_string()).unwrap();
        let fork_id = duplicate_project(source_id, "Original Paper (copy)".to_string())
            .await
            .unwrap();
        let meta = read_meta(&fork_id).unwrap();
        assert_eq!(meta.name, "Original Paper (copy)");
        assert_eq!(meta.forked_from.as_deref(), Some("Original Paper"));
        std::env::remove_var("OLEAFLY_DATA_DIR");
        std::fs::remove_dir_all(root).unwrap();
    }
}
