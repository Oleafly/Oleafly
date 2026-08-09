use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};

use crate::paths;
use crate::proc::NoConsole;
use crate::sandbox::{atomic_write, guard_export_dest, resolve, AtomicFile};

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
    /// Explicit latexmk compiler ("pdflatex" | "xelatex" | "lualatex"), the
    /// Overleaf-style per-project choice. Absent means auto-detect from the
    /// source, which stays the default.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tex_flavor: Option<String>,
    #[serde(default)]
    pub allow_shell_escape: bool,
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

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ProjectStateChanged {
    pub project_id: String,
    pub revision: u64,
    pub reason: String,
    pub files_changed: bool,
    pub mutation_generation: Option<u64>,
    pub project: ProjectMeta,
    pub engine: crate::document_engine::EngineDescriptor,
}

pub(crate) fn publish_project_state_changed(
    app: &tauri::AppHandle,
    state: &crate::state::AppState,
    project_id: &str,
    project: ProjectMeta,
    reason: &str,
    files_changed: bool,
    mutation_generation: Option<u64>,
) -> Result<ProjectStateChanged, String> {
    use tauri::Emitter as _;

    let mut engine = crate::document_engine::descriptor_for(&project.engine, &project.main_doc)?;
    engine.tex_flavor = project.tex_flavor.clone();
    engine.allow_shell_escape = project.allow_shell_escape;
    let revision = state
        .project_state_revision
        .fetch_add(1, Ordering::SeqCst)
        .wrapping_add(1);
    let payload = ProjectStateChanged {
        project_id: project_id.to_string(),
        revision,
        reason: reason.to_string(),
        files_changed,
        mutation_generation,
        project,
        engine,
    };
    let _ = app.emit("project-state-changed", &payload);
    Ok(payload)
}

const SHELL_ESCAPE_TRUST_VERSION: u8 = 1;

#[derive(Serialize, Deserialize)]
struct ShellEscapeTrustRecord {
    version: u8,
    project_id: String,
    project_identity: String,
}

fn shell_escape_trust_path(project_id: &str) -> Result<PathBuf, String> {
    paths::validate_project_id(project_id)?;
    Ok(paths::shell_escape_trust_root()?.join(format!("{project_id}.json")))
}

fn shell_escape_project_identity(project_id: &str) -> Result<String, String> {
    use sha2::{Digest, Sha256};

    let directory = paths::project_dir(project_id)?;
    let metadata = std::fs::symlink_metadata(&directory)
        .map_err(|e| format!("failed to inspect project identity: {e}"))?;
    let mut digest = Sha256::new();
    digest.update(b"oleafly-latex-shell-trust-v1\0");
    digest.update(project_id.as_bytes());
    digest.update([0]);

    #[cfg(unix)]
    {
        use std::os::unix::ffi::OsStrExt as _;
        use std::os::unix::fs::MetadataExt as _;
        digest.update(directory.as_os_str().as_bytes());
        digest.update(metadata.dev().to_le_bytes());
        digest.update(metadata.ino().to_le_bytes());
    }
    #[cfg(windows)]
    {
        use std::os::windows::ffi::OsStrExt as _;
        use std::os::windows::fs::MetadataExt as _;
        for unit in directory.as_os_str().encode_wide() {
            digest.update(unit.to_le_bytes());
        }
        digest.update(
            metadata
                .volume_serial_number()
                .unwrap_or_default()
                .to_le_bytes(),
        );
        digest.update(metadata.file_index().unwrap_or_default().to_le_bytes());
        digest.update(metadata.creation_time().to_le_bytes());
    }
    #[cfg(not(any(unix, windows)))]
    {
        digest.update(directory.to_string_lossy().as_bytes());
        let created = metadata
            .created()
            .ok()
            .and_then(|value| value.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|value| value.as_nanos())
            .unwrap_or_default();
        digest.update(created.to_le_bytes());
    }

    Ok(format!("{:x}", digest.finalize()))
}

#[cfg(windows)]
fn trust_record_is_reparse_point(metadata: &std::fs::Metadata) -> bool {
    use std::os::windows::fs::MetadataExt as _;
    metadata.file_attributes() & 0x400 != 0
}

#[cfg(not(windows))]
fn trust_record_is_reparse_point(_metadata: &std::fs::Metadata) -> bool {
    false
}

fn shell_escape_trusted(project_id: &str) -> Result<bool, String> {
    let expected_identity = shell_escape_project_identity(project_id)?;
    let path = shell_escape_trust_path(project_id)?;
    let metadata = match std::fs::symlink_metadata(&path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(false),
        Err(error) => return Err(format!("failed to inspect local shell trust: {error}")),
    };
    if !metadata.is_file()
        || metadata.file_type().is_symlink()
        || trust_record_is_reparse_point(&metadata)
    {
        return Ok(false);
    }
    let raw = std::fs::read_to_string(&path)
        .map_err(|e| format!("failed to read local shell trust: {e}"))?;
    let record: ShellEscapeTrustRecord = match serde_json::from_str(&raw) {
        Ok(record) => record,
        Err(_) => return Ok(false),
    };
    Ok(record.version == SHELL_ESCAPE_TRUST_VERSION
        && record.project_id == project_id
        && record.project_identity == expected_identity)
}

fn write_shell_escape_trust(project_id: &str) -> Result<(), String> {
    let record = ShellEscapeTrustRecord {
        version: SHELL_ESCAPE_TRUST_VERSION,
        project_id: project_id.to_string(),
        project_identity: shell_escape_project_identity(project_id)?,
    };
    let path = shell_escape_trust_path(project_id)?;
    if let Ok(metadata) = std::fs::symlink_metadata(&path) {
        if !metadata.is_file()
            || metadata.file_type().is_symlink()
            || trust_record_is_reparse_point(&metadata)
        {
            return Err("local shell trust path is not a regular file".into());
        }
    }
    let bytes = serde_json::to_vec_pretty(&record).map_err(|e| e.to_string())?;
    let transaction = AtomicFile::new(&path)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt as _;
        std::fs::set_permissions(
            transaction.staging_path(),
            std::fs::Permissions::from_mode(0o600),
        )
        .map_err(|e| format!("failed to protect local shell trust: {e}"))?;
    }
    #[cfg(windows)]
    crate::fsperm::harden_file(transaction.staging_path());
    std::fs::write(transaction.staging_path(), bytes)
        .map_err(|e| format!("failed to write local shell trust: {e}"))?;
    transaction.commit()?;
    crate::fsperm::harden_file(&path);
    Ok(())
}

fn revoke_shell_escape_trust(project_id: &str) -> Result<(), String> {
    let path = shell_escape_trust_path(project_id)?;
    match std::fs::symlink_metadata(&path) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!("failed to inspect local shell trust: {error}")),
        Ok(metadata) if metadata.is_dir() && !metadata.file_type().is_symlink() => {
            Err("local shell trust path is unexpectedly a directory".into())
        }
        Ok(_) => std::fs::remove_file(&path)
            .map_err(|e| format!("failed to revoke local shell trust: {e}")),
    }
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
        generation: u64,
    },
    Conflict {
        destination: String,
        suggested_destination: String,
        generation: u64,
    },
}

impl RenameFileResult {
    fn with_generation(self, generation: u64) -> Self {
        match self {
            Self::Renamed { path, .. } => Self::Renamed { path, generation },
            Self::Conflict {
                destination,
                suggested_destination,
                ..
            } => Self::Conflict {
                destination,
                suggested_destination,
                generation,
            },
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct FileMutationResult {
    pub generation: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct CopyFileResult {
    pub path: String,
    pub generation: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ImportPathsResult {
    pub paths: Vec<String>,
    pub generation: u64,
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
            tex_flavor: None,
            allow_shell_escape: false,
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
    normalize_loaded_tex_flavor(&mut meta)?;
    meta.allow_shell_escape =
        meta.engine == "latexmk" && shell_escape_trusted(project_id).unwrap_or(false);
    Ok(meta)
}

fn normalize_loaded_tex_flavor(meta: &mut ProjectMeta) -> Result<(), String> {
    if meta.engine != "latexmk" {
        meta.tex_flavor = None;
        meta.allow_shell_escape = false;
        return Ok(());
    }
    meta.tex_flavor = validate_tex_flavor(&meta.engine, meta.tex_flavor.as_deref())
        .map_err(|error| format!("invalid project.json: {error}"))?;
    Ok(())
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
    let mut disk_meta = serde_json::to_value(meta).map_err(|e| e.to_string())?;
    disk_meta
        .as_object_mut()
        .ok_or("project metadata did not serialize as an object")?
        .remove("allow_shell_escape");
    let s = serde_json::to_string_pretty(&disk_meta).map_err(|e| e.to_string())?;
    atomic_write(path, s.as_bytes()).map_err(|e| format!("failed to write project.json: {e}"))
}

/// Relative path from `root` to `path`, always with forward-slash separators.
/// On Windows `to_string_lossy` yields backslashes; the frontend builds the file
/// tree and matches SyncTeX files by splitting on "/", so paths must be
/// normalized here or subfolders won't nest and lookups mismatch on Windows.
fn rel_slash(root: &Path, path: &Path) -> String {
    let relative = path.strip_prefix(root).unwrap_or(path);
    normalize_relative(relative)
        .unwrap_or_else(|| relative.to_string_lossy().into_owned())
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

const MCP_LIST_RESULT_LIMIT: usize = 2_000;
const MCP_LIST_ENTRY_SCAN_LIMIT: usize = 10_000;
const MCP_SCAN_DEADLINE: std::time::Duration = std::time::Duration::from_secs(2);

pub(crate) struct BoundedFileList {
    pub entries: Vec<FileEntry>,
    pub scanned_entries: usize,
    pub truncated: bool,
}

#[derive(Clone, Copy)]
struct FileListLimits {
    max_results: usize,
    max_entries: usize,
    deadline: std::time::Instant,
}

struct ScanCancellation {
    cancelled: Arc<AtomicBool>,
    armed: bool,
}

impl ScanCancellation {
    fn new() -> (Self, Arc<AtomicBool>) {
        let cancelled = Arc::new(AtomicBool::new(false));
        (
            Self {
                cancelled: Arc::clone(&cancelled),
                armed: true,
            },
            cancelled,
        )
    }

    fn disarm(&mut self) {
        self.armed = false;
    }
}

impl Drop for ScanCancellation {
    fn drop(&mut self) {
        if self.armed {
            self.cancelled.store(true, Ordering::Release);
        }
    }
}

fn scan_should_stop(cancelled: &AtomicBool, deadline: std::time::Instant) -> bool {
    cancelled.load(Ordering::Acquire) || std::time::Instant::now() >= deadline
}

fn bounded_list_walk(
    root: &Path,
    dir: &Path,
    out: &mut BoundedFileList,
    limits: FileListLimits,
    cancelled: &AtomicBool,
    depth: usize,
) -> Result<(), String> {
    if scan_should_stop(cancelled, limits.deadline)
        || out.entries.len() >= limits.max_results
        || out.scanned_entries >= limits.max_entries
    {
        out.truncated = true;
        return Ok(());
    }
    if depth >= MAX_WALK_DEPTH {
        out.truncated = true;
        return Ok(());
    }

    let mut items = Vec::new();
    for entry in std::fs::read_dir(dir).map_err(|e| e.to_string())? {
        if scan_should_stop(cancelled, limits.deadline) || out.scanned_entries >= limits.max_entries
        {
            out.truncated = true;
            break;
        }
        out.scanned_entries += 1;
        if let Ok(entry) = entry {
            items.push(entry);
        }
    }
    items.sort_by_key(|entry| entry.file_name());
    for entry in items {
        if scan_should_stop(cancelled, limits.deadline) || out.entries.len() >= limits.max_results {
            out.truncated = true;
            break;
        }
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if name == ".oleafly" || name == ".git" {
            continue;
        }
        let file_type = match entry.file_type() {
            Ok(file_type) if !file_type.is_symlink() => file_type,
            _ => continue,
        };
        let path = entry.path();
        out.entries.push(FileEntry {
            path: rel_slash(root, &path),
            is_dir: file_type.is_dir(),
        });
        if file_type.is_dir() {
            bounded_list_walk(root, &path, out, limits, cancelled, depth + 1)?;
            if out.truncated {
                break;
            }
        }
    }
    Ok(())
}

pub(crate) async fn list_files_bounded(project_id: String) -> Result<BoundedFileList, String> {
    let (mut cancellation, cancelled) = ScanCancellation::new();
    let limits = FileListLimits {
        max_results: MCP_LIST_RESULT_LIMIT,
        max_entries: MCP_LIST_ENTRY_SCAN_LIMIT,
        deadline: std::time::Instant::now() + MCP_SCAN_DEADLINE,
    };
    let result =
        tauri::async_runtime::spawn_blocking(move || -> Result<BoundedFileList, String> {
            let root = paths::project_dir(&project_id)?;
            let mut out = BoundedFileList {
                entries: Vec::new(),
                scanned_entries: 0,
                truncated: false,
            };
            bounded_list_walk(&root, &root, &mut out, limits, &cancelled, 0)?;
            Ok(out)
        })
        .await
        .map_err(|e| e.to_string())?;
    cancellation.disarm();
    result
}

#[tauri::command]
pub fn read_file(project_id: String, path: String) -> Result<String, String> {
    let p = resolve(&project_id, &path)?;
    std::fs::read_to_string(&p).map_err(|e| format!("failed to read {path}: {e}"))
}

pub(crate) fn read_file_limited(
    project_id: &str,
    path: &str,
    max_bytes: usize,
) -> Result<String, String> {
    let resolved = resolve(project_id, path)?;
    read_utf8_limited(&resolved, max_bytes)
        .map_err(|error| format!("failed to read {path}: {error}"))
}

fn read_utf8_limited(path: &Path, max_bytes: usize) -> Result<String, String> {
    use std::io::Read;

    let file = std::fs::File::open(path).map_err(|error| error.to_string())?;
    let mut bytes = Vec::with_capacity(max_bytes.min(64 * 1024));
    file.take(max_bytes.saturating_add(1) as u64)
        .read_to_end(&mut bytes)
        .map_err(|error| error.to_string())?;
    if bytes.len() > max_bytes {
        return Err(format!("file exceeds the {max_bytes}-byte read limit"));
    }
    String::from_utf8(bytes).map_err(|_| "file is not valid UTF-8 text".to_string())
}

#[cfg(test)]
mod bounded_read_tests {
    use super::read_utf8_limited;

    #[test]
    fn limited_reads_reject_oversized_files_before_returning_content() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("bounded-read.txt");
        std::fs::write(&path, b"12345").unwrap();

        assert_eq!(read_utf8_limited(&path, 5).unwrap(), "12345");
        assert!(read_utf8_limited(&path, 4)
            .unwrap_err()
            .contains("read limit"));
        let _ = std::fs::remove_file(path);
    }
}

const MAX_COORDINATED_PROJECTS: usize = 128;
const MAX_PENDING_MUTATIONS_PER_PROJECT: usize = 256;
const MAX_TRACKED_MUTATION_SCOPES: usize = 16_384;
static NEXT_MUTATION_GENERATION: AtomicU64 = AtomicU64::new(1);

fn current_mutation_watermark() -> u64 {
    NEXT_MUTATION_GENERATION
        .load(Ordering::Acquire)
        .saturating_sub(1)
}

fn portable_scope_path(path: String) -> String {
    path.split('/')
        .map(|component| component.to_lowercase())
        .collect::<Vec<_>>()
        .join("/")
}

#[derive(Clone, Debug, Hash, PartialEq, Eq)]
struct MutationScope {
    path: String,
    descendants: bool,
}

impl MutationScope {
    fn file(path: String) -> Self {
        Self {
            path: portable_scope_path(path),
            descendants: false,
        }
    }

    fn subtree(path: String) -> Self {
        Self {
            path: portable_scope_path(path),
            descendants: true,
        }
    }

    fn intersects(&self, other: &Self) -> bool {
        self.path == other.path
            || (self.descendants && path_is_within(&other.path, &self.path))
            || (other.descendants && path_is_within(&self.path, &other.path))
    }
}

fn path_is_within(path: &str, root: &str) -> bool {
    root.is_empty()
        || path
            .strip_prefix(root)
            .is_some_and(|suffix| suffix.starts_with('/'))
}

fn mutation_relative_path(path: &str, allow_root: bool) -> Result<String, String> {
    let path_value = Path::new(path);
    if path.contains('\\')
        || path_value.is_absolute()
        || path_value.components().any(|component| {
            matches!(
                component,
                std::path::Component::ParentDir
                    | std::path::Component::RootDir
                    | std::path::Component::Prefix(_)
            )
        })
    {
        return Err(format!("illegal path: {path}"));
    }
    let normalized = normalize_relative(path_value)
        .ok_or_else(|| format!("illegal path: {path}"))?
        .replace('\\', "/");
    if !allow_root && normalized.is_empty() {
        return Err("a project file path must not be empty".into());
    }
    if reserved_project_metadata_path(&normalized) {
        return Err(
            "project.json is managed by Oleafly and cannot be changed as a project file".into(),
        );
    }
    if reserved_project_internal_path(&normalized) {
        return Err(
            ".git and .oleafly are managed internally and cannot be changed as project files"
                .into(),
        );
    }
    Ok(normalized)
}

fn reserved_project_metadata_path(path: &str) -> bool {
    path.eq_ignore_ascii_case("project.json")
}

fn reserved_project_internal_path(path: &str) -> bool {
    path.split('/').next().is_some_and(|component| {
        component.eq_ignore_ascii_case(".git") || component.eq_ignore_ascii_case(".oleafly")
    })
}

fn mutation_parent_path(path: &str) -> String {
    path.rsplit_once('/')
        .map_or_else(String::new, |(parent, _)| parent.to_string())
}

#[derive(Default)]
struct ProjectMutationState {
    committed_generation: u64,
    compacted_through: u64,
    pending: HashMap<u64, Vec<MutationScope>>,
    committed_scopes: HashMap<MutationScope, u64>,
}

struct ProjectMutationCoordinator {
    operation: Mutex<()>,
    metadata: Mutex<()>,
    state: Mutex<ProjectMutationState>,
}

impl ProjectMutationCoordinator {
    fn new(compacted_floor: u64) -> Self {
        Self {
            operation: Mutex::new(()),
            metadata: Mutex::new(()),
            state: Mutex::new(ProjectMutationState {
                committed_generation: compacted_floor,
                compacted_through: compacted_floor,
                ..ProjectMutationState::default()
            }),
        }
    }
}

struct MutationRegistryEntry {
    coordinator: Arc<ProjectMutationCoordinator>,
    last_used: u64,
}

#[derive(Default)]
struct MutationRegistry {
    clock: u64,
    projects: HashMap<String, MutationRegistryEntry>,
}

fn mutation_registry() -> &'static Mutex<MutationRegistry> {
    static REGISTRY: OnceLock<Mutex<MutationRegistry>> = OnceLock::new();
    REGISTRY.get_or_init(|| Mutex::new(MutationRegistry::default()))
}

fn lock_unpoisoned<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn project_mutation_coordinator(
    project_id: &str,
) -> Result<Arc<ProjectMutationCoordinator>, String> {
    paths::validate_project_id(project_id)?;
    let registry_key = project_id.to_ascii_lowercase();
    let mut registry = lock_unpoisoned(mutation_registry());
    registry.clock = registry.clock.saturating_add(1);
    let now = registry.clock;
    if let Some(entry) = registry.projects.get_mut(&registry_key) {
        entry.last_used = now;
        return Ok(Arc::clone(&entry.coordinator));
    }
    if registry.projects.len() >= MAX_COORDINATED_PROJECTS {
        let eviction = registry
            .projects
            .iter()
            .filter(|(_, entry)| Arc::strong_count(&entry.coordinator) == 1)
            .min_by_key(|(_, entry)| entry.last_used)
            .map(|(project_id, _)| project_id.clone());
        let Some(eviction) = eviction else {
            return Err(format!(
                "too many projects have active file mutations (limit {MAX_COORDINATED_PROJECTS})"
            ));
        };
        registry.projects.remove(&eviction);
    }
    let coordinator = Arc::new(ProjectMutationCoordinator::new(current_mutation_watermark()));
    registry.projects.insert(
        registry_key,
        MutationRegistryEntry {
            coordinator: Arc::clone(&coordinator),
            last_used: now,
        },
    );
    Ok(coordinator)
}

fn with_project_metadata<T>(
    project_id: &str,
    operation: impl FnOnce() -> Result<T, String>,
) -> Result<T, String> {
    let coordinator = project_mutation_coordinator(project_id)?;
    let _metadata = lock_unpoisoned(&coordinator.metadata);
    operation()
}

struct MutationAdmission {
    coordinator: Arc<ProjectMutationCoordinator>,
    generation: u64,
    scopes: Vec<MutationScope>,
    commit_scopes: Vec<MutationScope>,
    expected_generation: Option<u64>,
    finished: bool,
}

fn admit_mutation(
    project_id: &str,
    scopes: Vec<MutationScope>,
    expected_generation: Option<u64>,
) -> Result<MutationAdmission, String> {
    admit_mutation_with_commit(project_id, scopes.clone(), scopes, expected_generation)
}

fn admit_mutation_with_commit(
    project_id: &str,
    scopes: Vec<MutationScope>,
    commit_scopes: Vec<MutationScope>,
    expected_generation: Option<u64>,
) -> Result<MutationAdmission, String> {
    let coordinator = project_mutation_coordinator(project_id)?;
    let generation = NEXT_MUTATION_GENERATION
        .fetch_update(Ordering::AcqRel, Ordering::Acquire, |current| {
            current.checked_add(1)
        })
        .map_err(|_| "project mutation generation is exhausted".to_string())?;
    {
        let mut state = lock_unpoisoned(&coordinator.state);
        if state.pending.len() >= MAX_PENDING_MUTATIONS_PER_PROJECT {
            return Err(format!(
                "too many file mutations are pending for this project (limit {MAX_PENDING_MUTATIONS_PER_PROJECT})"
            ));
        }
        state.pending.insert(generation, scopes.clone());
    }
    Ok(MutationAdmission {
        coordinator,
        generation,
        scopes,
        commit_scopes,
        expected_generation,
        finished: false,
    })
}

fn latest_overlapping_generation(
    scopes: &HashMap<MutationScope, u64>,
    requested: &[MutationScope],
    after: u64,
) -> Option<u64> {
    scopes
        .iter()
        .filter(|(scope, generation)| {
            **generation > after
                && requested
                    .iter()
                    .any(|requested| requested.intersects(scope))
        })
        .map(|(_, generation)| *generation)
        .max()
}

fn latest_pending_overlap(
    state: &ProjectMutationState,
    requested: &[MutationScope],
    after: u64,
) -> Option<u64> {
    state
        .pending
        .iter()
        .filter(|(generation, scopes)| {
            **generation > after
                && scopes.iter().any(|scope| {
                    requested
                        .iter()
                        .any(|requested| requested.intersects(scope))
                })
        })
        .map(|(generation, _)| *generation)
        .max()
}

fn mutation_conflict(current: u64, detail: &str) -> String {
    format!("mutation conflict at generation {current}: {detail}")
}

impl MutationAdmission {
    fn preflight(&self, state: &ProjectMutationState) -> Result<(), String> {
        if self.generation <= state.compacted_through {
            return Err(mutation_conflict(
                state.committed_generation,
                "the operation was admitted before compacted mutation history",
            ));
        }
        if let Some(expected) = self.expected_generation {
            if expected > state.committed_generation {
                return Err(mutation_conflict(
                    state.committed_generation,
                    "expectedGeneration is newer than the authoritative project generation",
                ));
            }
            if expected < state.compacted_through {
                return Err(mutation_conflict(
                    state.committed_generation,
                    "the expected generation predates retained mutation history",
                ));
            }
            if latest_overlapping_generation(&state.committed_scopes, &self.scopes, expected)
                .is_some()
            {
                return Err(mutation_conflict(
                    state.committed_generation,
                    "the target changed after expectedGeneration",
                ));
            }
        }
        if latest_overlapping_generation(&state.committed_scopes, &self.scopes, self.generation)
            .is_some()
        {
            return Err(mutation_conflict(
                state.committed_generation,
                "a newer delete, rename, or write already committed",
            ));
        }
        if latest_pending_overlap(state, &self.scopes, self.generation).is_some() {
            return Err(mutation_conflict(
                state.committed_generation,
                "a newer overlapping operation is already admitted",
            ));
        }
        Ok(())
    }

    fn remove_pending(&mut self, state: &mut ProjectMutationState) {
        state.pending.remove(&self.generation);
        self.finished = true;
    }

    fn record_commit(&mut self, state: &mut ProjectMutationState) {
        state.committed_generation = state.committed_generation.max(self.generation);
        let new_scopes = self
            .commit_scopes
            .iter()
            .filter(|scope| !state.committed_scopes.contains_key(*scope))
            .count();
        if state.committed_scopes.len().saturating_add(new_scopes) > MAX_TRACKED_MUTATION_SCOPES {
            state.committed_scopes.clear();
            state.compacted_through = state.committed_generation;
        }
        for scope in &self.commit_scopes {
            state
                .committed_scopes
                .insert(scope.clone(), self.generation);
        }
        self.remove_pending(state);
    }

    fn run<T>(self, operation: impl FnOnce() -> Result<T, String>) -> Result<(T, u64), String> {
        self.run_with_change_status(|| operation().map(|value| (value, true)))
    }

    fn run_with_change_status<T>(
        mut self,
        operation: impl FnOnce() -> Result<(T, bool), String>,
    ) -> Result<(T, u64), String> {
        let coordinator = Arc::clone(&self.coordinator);
        let _operation = lock_unpoisoned(&coordinator.operation);
        {
            let state = lock_unpoisoned(&coordinator.state);
            self.preflight(&state)?;
        }

        let (value, changed) = operation()?;
        if !changed {
            let generation = {
                let mut state = lock_unpoisoned(&coordinator.state);
                self.remove_pending(&mut state);
                state.committed_generation
            };
            return Ok((value, generation));
        }
        let mut state = lock_unpoisoned(&coordinator.state);
        self.record_commit(&mut state);
        Ok((value, self.generation))
    }
}

impl Drop for MutationAdmission {
    fn drop(&mut self) {
        if !self.finished {
            let mut state = lock_unpoisoned(&self.coordinator.state);
            state.pending.remove(&self.generation);
            self.finished = true;
        }
    }
}

#[tauri::command]
pub fn project_mutation_generation(project_id: String) -> Result<u64, String> {
    let coordinator = project_mutation_coordinator(&project_id)?;
    let generation = lock_unpoisoned(&coordinator.state).committed_generation;
    Ok(generation)
}

pub(crate) struct ProjectWorktreeMutation<T> {
    pub value: Result<T, String>,
    pub project: ProjectMeta,
    pub generation: u64,
}

pub(crate) async fn mutate_project_worktree<T, F>(
    state: &crate::state::AppState,
    project_id: String,
    expected_generation: Option<u64>,
    operation: F,
) -> Result<ProjectWorktreeMutation<T>, String>
where
    T: Send + 'static,
    F: FnOnce(&Path) -> Result<(T, bool), String> + Send + 'static,
{
    paths::validate_project_id(&project_id)?;
    let admission = admit_mutation(
        &project_id,
        vec![MutationScope::subtree(String::new())],
        expected_generation,
    )?;
    let _compile = state.compile_lock.lock().await;
    let _figure_compile = state.figure_compile_lock.lock().await;
    tauri::async_runtime::spawn_blocking(move || {
        let ((value, project), generation) = admission.run_with_change_status(|| {
            with_project_metadata(&project_id, || {
                let root = paths::project_dir(&project_id)?;
                let pre_state = read_meta(&project_id)?;
                revoke_shell_escape_trust(&project_id)?;
                let (mut value, changed) = match operation(&root) {
                    Ok((value, changed)) => (Ok(value), changed || pre_state.allow_shell_escape),
                    Err(error) => (Err(error), true),
                };
                let project = match reconcile_external_worktree_meta(&project_id, &pre_state) {
                    Ok(project) => project,
                    Err(reconcile_error) => {
                        value = Err(match value {
                            Ok(_) => format!(
                                "worktree mutation completed, but project metadata reconciliation failed: {reconcile_error}"
                            ),
                            Err(operation_error) => format!(
                                "{operation_error}. Project metadata reconciliation also failed: {reconcile_error}"
                            ),
                        });
                        let mut fallback = pre_state;
                        fallback.allow_shell_escape = false;
                        fallback
                    }
                };
                Ok(((value, project), changed))
            })
        })?;
        Ok(ProjectWorktreeMutation {
            value,
            project,
            generation,
        })
    })
    .await
    .map_err(|error| format!("worktree mutation task failed: {error}"))?
}

#[tauri::command]
pub async fn write_file(
    project_id: String,
    path: String,
    content: String,
    expected_generation: Option<u64>,
) -> Result<FileMutationResult, String> {
    let relative = mutation_relative_path(&path, false)?;
    let admission = admit_mutation(
        &project_id,
        vec![MutationScope::file(relative)],
        expected_generation,
    )?;
    tauri::async_runtime::spawn_blocking(move || -> Result<FileMutationResult, String> {
        let (_, generation) = admission.run(|| {
            let p = resolve(&project_id, &path)?;
            if let Some(parent) = p.parent() {
                std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }
            atomic_write(&p, content.as_bytes()).map_err(|e| format!("failed to write {path}: {e}"))
        })?;
        Ok(FileMutationResult { generation })
    })
    .await
    .map_err(|e| format!("file write task failed: {e}"))?
}

pub(crate) struct ProjectFileWrite {
    project_id: String,
    path: String,
    admission: MutationAdmission,
}

pub(crate) fn admit_project_file_write(
    project_id: String,
    path: String,
    expected_generation: Option<u64>,
) -> Result<ProjectFileWrite, String> {
    let relative = mutation_relative_path(&path, false)?;
    let admission = admit_mutation(
        &project_id,
        vec![MutationScope::file(relative)],
        expected_generation,
    )?;
    Ok(ProjectFileWrite {
        project_id,
        path,
        admission,
    })
}

impl ProjectFileWrite {
    pub(crate) fn write(self, bytes: &[u8]) -> Result<FileMutationResult, String> {
        let project_id = self.project_id;
        let path = self.path;
        let (_, generation) = self.admission.run(|| {
            let target = resolve(&project_id, &path)?;
            if let Some(parent) = target.parent() {
                std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }
            atomic_write(&target, bytes).map_err(|e| format!("failed to write {path}: {e}"))
        })?;
        Ok(FileMutationResult { generation })
    }
}

#[tauri::command]
pub fn create_file(
    project_id: String,
    path: String,
    is_dir: bool,
    expected_generation: Option<u64>,
) -> Result<FileMutationResult, String> {
    let relative = mutation_relative_path(&path, false)?;
    let scope = if is_dir {
        MutationScope::subtree(relative)
    } else {
        MutationScope::file(relative)
    };
    let admission = admit_mutation(&project_id, vec![scope], expected_generation)?;
    let (_, generation) = admission.run(|| {
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
    })?;
    Ok(FileMutationResult { generation })
}

#[tauri::command]
pub fn delete_file(
    project_id: String,
    path: String,
    expected_generation: Option<u64>,
) -> Result<FileMutationResult, String> {
    let deleted_rel = mutation_relative_path(&path, true)?;
    if deleted_rel.is_empty() {
        return Err("refusing to delete project root".into());
    }
    let admission = admit_mutation(
        &project_id,
        vec![MutationScope::subtree(deleted_rel.clone())],
        expected_generation,
    )?;
    let (_, generation) = admission.run(|| {
        with_project_metadata(&project_id, || {
            let p = resolve(&project_id, &path)?;
            let meta = read_meta(&project_id)?;
            if deletion_removes_main_document(&meta.main_doc, &deleted_rel) {
                return Err(
                    "cannot delete the configured main document. Select another main document first"
                        .into(),
                );
            }
            if p.is_dir() {
                std::fs::remove_dir_all(&p)
            } else {
                std::fs::remove_file(&p)
            }
            .map_err(|e| format!("failed to delete {path}: {e}"))
        })
    })?;
    Ok(FileMutationResult { generation })
}

fn deletion_removes_main_document(main_doc: &str, deleted_rel: &str) -> bool {
    main_doc == deleted_rel
        || main_doc
            .strip_prefix(deleted_rel)
            .is_some_and(|suffix| suffix.starts_with('/'))
}

#[tauri::command]
pub async fn rename_file(
    app: tauri::AppHandle,
    project_id: String,
    from: String,
    to: String,
    conflict_strategy: Option<FileConflictStrategy>,
    expected_generation: Option<u64>,
    state: tauri::State<'_, crate::state::AppState>,
) -> Result<RenameFileResult, String> {
    let result = rename_file_synchronized(
        &state,
        project_id.clone(),
        from,
        to,
        conflict_strategy,
        expected_generation,
    )
    .await?;
    if matches!(result, RenameFileResult::Renamed { .. }) {
        if let Ok(meta) = read_meta(&project_id) {
            let _ = publish_project_state_changed(
                &app,
                &state,
                &project_id,
                meta,
                "file-renamed",
                true,
                project_mutation_generation(project_id.clone()).ok(),
            );
        }
    }
    Ok(result)
}

async fn rename_file_synchronized(
    state: &crate::state::AppState,
    project_id: String,
    from: String,
    to: String,
    conflict_strategy: Option<FileConflictStrategy>,
    expected_generation: Option<u64>,
) -> Result<RenameFileResult, String> {
    let _compile = state.compile_lock.lock().await;
    tauri::async_runtime::spawn_blocking(move || {
        rename_file_blocking(project_id, from, to, conflict_strategy, expected_generation)
    })
    .await
    .map_err(|error| format!("file rename task failed: {error}"))?
}

pub(crate) fn rename_file_blocking(
    project_id: String,
    from: String,
    to: String,
    conflict_strategy: Option<FileConflictStrategy>,
    expected_generation: Option<u64>,
) -> Result<RenameFileResult, String> {
    let source_rel = mutation_relative_path(&from, false)?;
    let destination_rel = mutation_relative_path(&to, false)?;
    let destination_scope = MutationScope::subtree(mutation_parent_path(&destination_rel));
    let admission = admit_mutation(
        &project_id,
        vec![MutationScope::subtree(source_rel), destination_scope],
        expected_generation,
    )?;
    let strategy = conflict_strategy.unwrap_or_default();
    let (result, generation) = admission.run_with_change_status(|| {
        with_project_metadata(&project_id, || {
            let root = paths::project_dir(&project_id)?;
            let meta = read_meta(&project_id)?;
            let src = resolve(&project_id, &from)?;
            let dst = resolve(&project_id, &to)?;
            let result = rename_path_and_update_meta(
                Some(&project_id),
                &root,
                &src,
                &dst,
                &destination_rel,
                strategy,
                meta,
            )?;
            let changed = matches!(result, RenameFileResult::Renamed { .. });
            Ok((result, changed))
        })
    })?;
    Ok(result.with_generation(generation))
}

enum MoveRollback {
    Simple {
        current: PathBuf,
        original: PathBuf,
        case_only: bool,
    },
    Replaced {
        current: PathBuf,
        original: PathBuf,
        backup: PathBuf,
        replaced_original: PathBuf,
    },
}

struct MoveTransaction {
    result: RenameFileResult,
    rollback: Option<MoveRollback>,
}

impl MoveTransaction {
    fn commit(self) -> RenameFileResult {
        if let Some(MoveRollback::Replaced { backup, .. }) = &self.rollback {
            let _ = remove_path(backup);
        }
        self.result
    }

    fn rollback(self) -> Result<(), String> {
        let Some(rollback) = self.rollback else {
            return Ok(());
        };
        match rollback {
            MoveRollback::Simple {
                current,
                original,
                case_only,
            } => {
                if case_only {
                    rename_case_only(&current, &original)
                } else {
                    rename_exclusive(&current, &original)
                        .map_err(|e| format!("failed to roll back move: {e}"))
                }
            }
            MoveRollback::Replaced {
                current,
                original,
                backup,
                replaced_original,
            } => {
                rename_exclusive(&current, &original)
                    .map_err(|e| format!("failed to restore the moved source: {e}"))?;
                rename_exclusive(&backup, &replaced_original)
                    .map_err(|e| format!("failed to restore the replaced destination: {e}"))
            }
        }
    }
}

fn remap_main_document(main_doc: &str, from: &str, to: &str) -> Option<String> {
    if main_doc == from {
        return Some(to.to_string());
    }
    let suffix = main_doc.strip_prefix(from)?.strip_prefix('/')?;
    Some(format!("{to}/{suffix}"))
}

fn rename_path_and_update_meta(
    project_id: Option<&str>,
    root: &Path,
    src: &Path,
    requested_dst: &Path,
    requested_rel: &str,
    strategy: FileConflictStrategy,
    mut meta: ProjectMeta,
) -> Result<RenameFileResult, String> {
    let source_rel = rel_slash(root, src);
    let transaction = stage_rename_path(root, src, requested_dst, requested_rel, strategy)?;
    let actual_destination = match &transaction.result {
        RenameFileResult::Renamed { path, .. } => path.clone(),
        RenameFileResult::Conflict { .. } => return Ok(transaction.commit()),
    };
    let Some(main_doc) = remap_main_document(&meta.main_doc, &source_rel, &actual_destination)
    else {
        return Ok(transaction.commit());
    };
    if main_doc == meta.main_doc {
        return Ok(transaction.commit());
    }

    let selected_engine = match engine_for_main_document(&meta.engine, &main_doc) {
        Ok(engine) => engine,
        Err(error) => {
            let rollback = transaction.rollback();
            return Err(match rollback {
                Ok(()) => format!("move would make the main document invalid and was rolled back: {error}"),
                Err(rollback_error) => format!(
                    "move would make the main document invalid: {error}. Rollback also failed: {rollback_error}"
                ),
            });
        }
    };
    let leaves_latexmk = meta.engine == "latexmk" && selected_engine != "latexmk";
    if leaves_latexmk {
        if let Some(project_id) = project_id {
            if let Err(error) = revoke_shell_escape_trust(project_id) {
                let rollback = transaction.rollback();
                return Err(match rollback {
                    Ok(()) => format!(
                        "failed to revoke shell-command consent. The move was rolled back: {error}"
                    ),
                    Err(rollback_error) => format!(
                        "failed to revoke shell-command consent: {error}. Rollback also failed: {rollback_error}"
                    ),
                });
            }
        }
        meta.allow_shell_escape = false;
    }
    if selected_engine != meta.engine && selected_engine != "latexmk" {
        meta.tex_flavor = None;
    }
    meta.engine = selected_engine;
    meta.main_doc = main_doc;
    if let Err(error) = write_meta_at(&root.join("project.json"), &meta) {
        let rollback = transaction.rollback();
        return Err(match rollback {
            Ok(()) => format!("failed to update the main document after the move. The move was rolled back: {error}"),
            Err(rollback_error) => format!(
                "failed to update the main document after the move: {error}. Rollback also failed: {rollback_error}"
            ),
        });
    }
    Ok(transaction.commit())
}

#[cfg(test)]
fn rename_path_in_project(
    root: &Path,
    src: &Path,
    requested_dst: &Path,
    requested_rel: &str,
    strategy: FileConflictStrategy,
) -> Result<RenameFileResult, String> {
    Ok(stage_rename_path(root, src, requested_dst, requested_rel, strategy)?.commit())
}

fn stage_rename_path(
    root: &Path,
    src: &Path,
    requested_dst: &Path,
    requested_rel: &str,
    strategy: FileConflictStrategy,
) -> Result<MoveTransaction, String> {
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
        return Ok(MoveTransaction {
            result: RenameFileResult::Renamed {
                path: requested_rel.to_string(),
                generation: 0,
            },
            rollback: None,
        });
    }

    if let Some(parent) = requested_dst.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    let collision = portable_collision(requested_dst)?;
    if let Some(existing) = collision.as_ref() {
        if same_entry(src, existing) {
            rename_case_only(src, requested_dst)?;
            return Ok(MoveTransaction {
                result: RenameFileResult::Renamed {
                    path: requested_rel.to_string(),
                    generation: 0,
                },
                rollback: Some(MoveRollback::Simple {
                    current: requested_dst.to_path_buf(),
                    original: src.to_path_buf(),
                    case_only: true,
                }),
            });
        }
    }

    let destination = match (collision, strategy) {
        (Some(_), FileConflictStrategy::Error) => {
            let suggested = unique_destination(requested_dst, source_meta.is_dir())?;
            return Ok(MoveTransaction {
                result: RenameFileResult::Conflict {
                    destination: requested_rel.to_string(),
                    suggested_destination: rel_slash(root, &suggested),
                    generation: 0,
                },
                rollback: None,
            });
        }
        (Some(_), FileConflictStrategy::KeepBoth) => {
            unique_destination(requested_dst, source_meta.is_dir())?
        }
        (Some(existing), FileConflictStrategy::Replace) => {
            let rollback = stage_replace_path(root, src, &existing, requested_dst)?;
            return Ok(MoveTransaction {
                result: RenameFileResult::Renamed {
                    path: requested_rel.to_string(),
                    generation: 0,
                },
                rollback: Some(rollback),
            });
        }
        (None, _) => requested_dst.to_path_buf(),
    };

    match rename_exclusive(src, &destination) {
        Ok(()) => Ok(MoveTransaction {
            result: RenameFileResult::Renamed {
                path: rel_slash(root, &destination),
                generation: 0,
            },
            rollback: Some(MoveRollback::Simple {
                current: destination,
                original: src.to_path_buf(),
                case_only: false,
            }),
        }),
        Err(_error) if portable_collision(&destination)?.is_some() => {
            if strategy == FileConflictStrategy::KeepBoth {
                let retry = unique_destination(&destination, source_meta.is_dir())?;
                rename_exclusive(src, &retry)
                    .map_err(|e| format!("move failed after choosing a unique name: {e}"))?;
                Ok(MoveTransaction {
                    result: RenameFileResult::Renamed {
                        path: rel_slash(root, &retry),
                        generation: 0,
                    },
                    rollback: Some(MoveRollback::Simple {
                        current: retry,
                        original: src.to_path_buf(),
                        case_only: false,
                    }),
                })
            } else {
                let suggested = unique_destination(&destination, source_meta.is_dir())?;
                Ok(MoveTransaction {
                    result: RenameFileResult::Conflict {
                        destination: rel_slash(root, &destination),
                        suggested_destination: rel_slash(root, &suggested),
                        generation: 0,
                    },
                    rollback: None,
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

fn stage_replace_path(
    root: &Path,
    src: &Path,
    existing: &Path,
    dst: &Path,
) -> Result<MoveRollback, String> {
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

    Ok(MoveRollback::Replaced {
        current: dst.to_path_buf(),
        original: src.to_path_buf(),
        backup,
        replaced_original: existing.to_path_buf(),
    })
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
pub async fn copy_file(
    project_id: String,
    from: String,
    to: String,
    expected_generation: Option<u64>,
) -> Result<CopyFileResult, String> {
    let source_rel = mutation_relative_path(&from, false)?;
    let destination_rel = mutation_relative_path(&to, false)?;
    let source_scope = MutationScope::subtree(source_rel);
    let destination_scope = MutationScope::subtree(mutation_parent_path(&destination_rel));
    let admission = admit_mutation_with_commit(
        &project_id,
        vec![source_scope, destination_scope.clone()],
        vec![destination_scope],
        expected_generation,
    )?;
    tauri::async_runtime::spawn_blocking(move || -> Result<CopyFileResult, String> {
        let (path, generation) = admission.run(|| {
            let root = paths::project_dir(&project_id)?;
            let src = resolve(&project_id, &from)?;
            let requested_dst = resolve(&project_id, &to)?;
            copy_path_in_project(&root, &src, &requested_dst)
        })?;
        Ok(CopyFileResult { path, generation })
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
    expected_generation: Option<u64>,
) -> Result<FileMutationResult, String> {
    let relative = mutation_relative_path(&path, false)?;
    let admission = admit_mutation(
        &project_id,
        vec![MutationScope::file(relative)],
        expected_generation,
    )?;
    tauri::async_runtime::spawn_blocking(move || -> Result<FileMutationResult, String> {
        use base64::{engine::general_purpose::STANDARD, Engine};
        let bytes = STANDARD
            .decode(data.trim())
            .map_err(|e| format!("invalid base64: {e}"))?;
        let (_, generation) = admission.run(|| {
            let p = resolve(&project_id, &path)?;
            if let Some(parent) = p.parent() {
                std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }
            atomic_write(&p, &bytes).map_err(|e| format!("failed to write {path}: {e}"))
        })?;
        Ok(FileMutationResult { generation })
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
    tauri::async_runtime::spawn_blocking(move || {
        let coordinator = project_mutation_coordinator(&project_id)?;
        let _operation = lock_unpoisoned(&coordinator.operation);
        set_main_doc_unlocked(project_id, main_doc)
    })
    .await
    .map_err(|error| format!("main-document update task failed: {error}"))?
}

#[tauri::command]
pub async fn set_main_doc(
    app: tauri::AppHandle,
    state: tauri::State<'_, crate::state::AppState>,
    project_id: String,
    main_doc: String,
) -> Result<ProjectMeta, String> {
    let meta = set_main_doc_synchronized(&state, project_id.clone(), main_doc).await?;
    let _ = publish_project_state_changed(
        &app,
        &state,
        &project_id,
        meta.clone(),
        "main-document-changed",
        false,
        project_mutation_generation(project_id.clone()).ok(),
    );
    Ok(meta)
}

fn set_main_doc_unlocked(project_id: String, main_doc: String) -> Result<ProjectMeta, String> {
    with_project_metadata(&project_id, || {
        let main_doc = main_doc.trim().to_string();
        if main_doc.is_empty() {
            return Err("main document path cannot be empty".into());
        }
        let resolved = resolve(&project_id, &main_doc)?;
        if !resolved.is_file() {
            return Err(format!("main document not found: {main_doc}"));
        }
        let mut meta = read_meta(&project_id)?;
        let selected_engine = engine_for_main_document(&meta.engine, &main_doc)?;
        meta.main_doc = main_doc;
        if selected_engine != "latexmk" {
            revoke_shell_escape_trust(&project_id)?;
            meta.tex_flavor = None;
            meta.allow_shell_escape = false;
        }
        meta.engine = selected_engine;
        write_meta(&project_id, &meta)?;
        Ok(meta)
    })
}

/// Pin a project's compile engine in `project.json` (e.g. "xetex" for the
/// bundled Tectonic, "latexmk" for a system TeX toolchain). Shares the compile
/// lock with `set_main_doc` so an engine switch never lands between a compile's
/// final identity check and its revision allocation.
#[tauri::command]
pub async fn set_project_engine(
    app: tauri::AppHandle,
    state: tauri::State<'_, crate::state::AppState>,
    project_id: String,
    engine: String,
    flavor: Option<String>,
) -> Result<ProjectMeta, String> {
    let _guard = state.compile_lock.lock().await;
    let meta = set_project_engine_unlocked(&project_id, &engine, flavor.as_deref())?;
    let _ = publish_project_state_changed(
        &app,
        &state,
        &project_id,
        meta.clone(),
        "engine-changed",
        false,
        project_mutation_generation(project_id.clone()).ok(),
    );
    Ok(meta)
}

fn set_project_engine_unlocked(
    project_id: &str,
    engine: &str,
    flavor: Option<&str>,
) -> Result<ProjectMeta, String> {
    let engine = engine.trim().to_string();
    if engine.is_empty() {
        return Err("engine name cannot be empty".into());
    }
    let flavor = validate_tex_flavor(&engine, flavor)?;
    with_project_metadata(project_id, || {
        let mut meta = read_meta(project_id)?;
        crate::document_engine::engine_for(&engine, &meta.main_doc)?;
        meta.engine = engine;
        meta.tex_flavor = flavor;
        if meta.engine != "latexmk" {
            revoke_shell_escape_trust(project_id)?;
            meta.allow_shell_escape = false;
        }
        write_meta(project_id, &meta)?;
        Ok(meta)
    })
}

#[tauri::command]
pub async fn set_project_shell_escape(
    app: tauri::AppHandle,
    state: tauri::State<'_, crate::state::AppState>,
    project_id: String,
    allow_shell_escape: bool,
) -> Result<ProjectMeta, String> {
    let _guard = state.compile_lock.lock().await;
    let meta = set_project_shell_escape_unlocked(&project_id, allow_shell_escape)?;
    let _ = publish_project_state_changed(
        &app,
        &state,
        &project_id,
        meta.clone(),
        "shell-trust-changed",
        false,
        project_mutation_generation(project_id.clone()).ok(),
    );
    Ok(meta)
}

fn set_project_shell_escape_unlocked(
    project_id: &str,
    allow_shell_escape: bool,
) -> Result<ProjectMeta, String> {
    with_project_metadata(project_id, || {
        let mut meta = read_meta(project_id)?;
        if allow_shell_escape && meta.engine != "latexmk" {
            return Err(
                "shell escape can only be enabled for the system TeX (latexmk) engine".into(),
            );
        }
        if allow_shell_escape {
            write_shell_escape_trust(project_id)?;
        } else {
            revoke_shell_escape_trust(project_id)?;
        }
        meta.allow_shell_escape = allow_shell_escape;
        Ok(meta)
    })
}

/// Normalize the per-project compiler choice. "auto" and empty mean
/// auto-detect; an explicit compiler is only meaningful on latexmk, and
/// switching to any other engine always clears it.
fn validate_tex_flavor(engine: &str, flavor: Option<&str>) -> Result<Option<String>, String> {
    match flavor.map(str::trim) {
        None | Some("") | Some("auto") => Ok(None),
        Some(value @ ("pdflatex" | "xelatex" | "lualatex")) => {
            if engine == "latexmk" {
                Ok(Some(value.to_string()))
            } else {
                Err("an explicit compiler needs the latexmk engine".into())
            }
        }
        Some(other) => Err(format!("unknown compiler: {other}")),
    }
}

fn epoch_seconds() -> f64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs_f64())
        .unwrap_or(0.0)
}

async fn collect_tex_spec() -> Result<Option<TexSpec>, String> {
    let Some(active) = crate::tex_distro::active_latexmk_distribution() else {
        return Ok(None::<TexSpec>);
    };
    // No tlmgr (e.g. MiKTeX, which installs packages on the fly) still yields
    // a distribution pin; the package map just stays empty.
    let packages = match active.tlmgr.as_deref() {
        Some(tlmgr) => crate::latex_engine::tlmgr_installed_versions_at(tlmgr).await?,
        None => std::collections::BTreeMap::new(),
    };
    Ok(Some(TexSpec {
        distribution: active.kind,
        distribution_label: active.label,
        packages,
        recorded_at: epoch_seconds(),
    }))
}

/// Capture the local TeX distribution + tlmgr package versions into the
/// project's reproducibility pin. Called after a project switches to latexmk.
/// The slow part (tlmgr info, seconds) runs before the lock is taken.
#[tauri::command]
pub async fn record_project_tex_spec(
    state: tauri::State<'_, crate::state::AppState>,
    project_id: String,
) -> Result<Option<TexSpec>, String> {
    let spec = collect_tex_spec().await?;
    let Some(spec) = spec else { return Ok(None) };
    let _guard = state.compile_lock.lock().await;
    with_project_metadata(&project_id, || {
        let mut meta = read_meta(&project_id)?;
        if meta.engine != "latexmk" {
            return Ok(None);
        }
        meta.tex = Some(spec.clone());
        write_meta(&project_id, &meta)?;
        Ok(Some(spec))
    })
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
    let prepared = tauri::async_runtime::spawn_blocking(
        move || -> Result<Option<(TexSpec, Option<crate::tex_distro::TexDistribution>)>, String> {
            let meta = read_meta(&project_id)?;
            if meta.engine != "latexmk" {
                return Ok(None);
            }
            let Some(spec) = meta.tex else {
                return Ok(None);
            };
            let active = crate::tex_distro::active_latexmk_distribution();
            Ok(Some((spec, active)))
        },
    )
    .await
    .map_err(|e| e.to_string())??;
    let Some((spec, active)) = prepared else {
        return Ok(None);
    };
    let local_label = active.as_ref().map(|d| d.label.clone());
    let active_tlmgr = active.as_ref().and_then(|d| d.tlmgr.as_deref());
    let can_install = active_tlmgr.is_some();
    let missing_packages = match active_tlmgr {
        Some(tlmgr) if !spec.packages.is_empty() => {
            let installed = crate::latex_engine::tlmgr_installed_versions_at(tlmgr)
                .await?
                .into_keys()
                .collect::<std::collections::BTreeSet<_>>();
            spec.packages
                .keys()
                .filter(|name| !installed.contains(*name))
                .cloned()
                .collect()
        }
        _ => Vec::new(),
    };
    let distribution_differs = local_label.as_deref() != Some(spec.distribution_label.as_str());
    Ok(Some(TexStatus {
        pinned_label: spec.distribution_label,
        local_label,
        distribution_differs,
        missing_packages,
        can_install_missing: can_install,
    }))
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

fn engine_for_untrusted_project(main_doc: &str) -> Result<String, String> {
    engine_for_main_document(&default_engine(), main_doc)
}

fn project_main_file_is_usable(project_id: &str, main_doc: &str) -> bool {
    resolve(project_id, main_doc).is_ok_and(|path| path.is_file())
        && engine_for_untrusted_project(main_doc).is_ok()
}

fn main_document_family(path: &str) -> u8 {
    match Path::new(path)
        .extension()
        .and_then(|extension| extension.to_str())
        .map(str::to_ascii_lowercase)
        .as_deref()
    {
        Some("tex" | "ltx" | "latex") => 0,
        Some("typ") => 1,
        Some("md" | "markdown") => 2,
        _ => 3,
    }
}

fn infer_external_main_document(root: &Path, preferred: &str) -> Result<String, String> {
    let preferred_family = main_document_family(preferred);
    let cancelled = AtomicBool::new(false);
    let limits = FileListLimits {
        max_results: MCP_LIST_RESULT_LIMIT,
        max_entries: MCP_LIST_ENTRY_SCAN_LIMIT,
        deadline: std::time::Instant::now() + MCP_SCAN_DEADLINE,
    };
    let mut listing = BoundedFileList {
        entries: Vec::new(),
        scanned_entries: 0,
        truncated: false,
    };
    bounded_list_walk(root, root, &mut listing, limits, &cancelled, 0)?;
    let mut candidates: Vec<String> = listing
        .entries
        .into_iter()
        .filter(|entry| !entry.is_dir && engine_for_untrusted_project(&entry.path).is_ok())
        .map(|entry| entry.path)
        .collect();
    candidates.sort_by_key(|candidate| {
        let family = main_document_family(candidate);
        let filename = candidate
            .rsplit('/')
            .next()
            .unwrap_or(candidate)
            .to_ascii_lowercase();
        let has_document_class =
            family == 0 && read_head_for_import(&root.join(candidate)).contains("\\documentclass");
        (
            family != preferred_family,
            !has_document_class,
            !matches!(
                filename.as_str(),
                "main.tex" | "main.ltx" | "main.latex" | "main.typ" | "main.md" | "main.markdown"
            ),
            candidate.matches('/').count(),
            candidate.to_ascii_lowercase(),
        )
    });
    candidates.into_iter().next().ok_or_else(|| {
        if listing.truncated {
            "project metadata is invalid and no supported main document was found within the bounded worktree scan".into()
        } else {
            "project metadata is invalid and the worktree has no supported main document".into()
        }
    })
}

fn reconcile_external_worktree_meta(
    project_id: &str,
    previous: &ProjectMeta,
) -> Result<ProjectMeta, String> {
    let root = paths::project_dir(project_id)?;
    let mut meta = read_meta(project_id).unwrap_or_else(|_| previous.clone());
    meta.allow_shell_escape = false;
    if meta.name.trim().is_empty() {
        meta.name = previous.name.clone();
    }
    if !project_main_file_is_usable(project_id, &meta.main_doc) {
        meta.main_doc = if project_main_file_is_usable(project_id, &previous.main_doc) {
            previous.main_doc.clone()
        } else {
            infer_external_main_document(&root, &previous.main_doc)?
        };
    }

    let requested_engine = if meta.engine == "latexmk" && previous.engine != "latexmk" {
        engine_for_untrusted_project(&meta.main_doc)?
    } else {
        engine_for_main_document(&meta.engine, &meta.main_doc)
            .and_then(|engine| {
                crate::document_engine::engine_for(&engine, &meta.main_doc).map(|_| engine)
            })
            .unwrap_or(engine_for_untrusted_project(&meta.main_doc)?)
    };
    meta.engine = requested_engine;
    if meta.engine != "latexmk" {
        meta.tex_flavor = None;
    }
    write_meta(project_id, &meta)?;
    read_meta(project_id)
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
                tex_flavor: None,
                allow_shell_escape: false,
            },
        )
    })?;
    Ok(id)
}

#[tauri::command]
pub fn rename_project(project_id: String, name: String) -> Result<ProjectMeta, String> {
    with_project_metadata(&project_id, || {
        let trimmed = name.trim();
        if trimmed.is_empty() {
            return Err("Project name cannot be empty".into());
        }
        let mut meta = read_meta(&project_id)?;
        meta.name = trimmed.to_string();
        write_meta(&project_id, &meta)?;
        Ok(meta)
    })
}

#[tauri::command]
pub fn get_project(project_id: String) -> Result<ProjectMeta, String> {
    read_meta(&project_id)
}

/// Persist a project's book-cover color to its `project.json` so it survives
/// across machines (previously kept only in the browser's localStorage).
#[tauri::command]
pub fn set_project_color(project_id: String, color: String) -> Result<ProjectMeta, String> {
    with_project_metadata(&project_id, || {
        let mut meta = read_meta(&project_id)?;
        meta.color = color;
        write_meta(&project_id, &meta)?;
        Ok(meta)
    })
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
                tex_flavor: None,
                allow_shell_escape: false,
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
                tex_flavor: None,
                allow_shell_escape: false,
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
                tex_flavor: None,
                allow_shell_escape: false,
            },
        )
    })?;
    Ok(id)
}

// --- Overleaf / external project import --------------------------------------

const IMPORT_MAX_ENTRIES: usize = 5000;
const IMPORT_MAX_TOTAL_BYTES: u64 = 2 * 1024 * 1024 * 1024; // 2 GiB
const IMPORT_MAX_DEPTH: usize = 16;

/// Junk and app-internal entries that never belong in an imported project.
fn import_skip(rel: &str) -> bool {
    rel.split('/').any(|segment| {
        matches!(
            segment,
            "__MACOSX" | ".DS_Store" | ".git" | ".oleafly" | "Thumbs.db"
        )
    })
}

/// Import an Overleaf export (ZIP) or a plain folder as a new project.
/// The main document is inferred when the archive has no project.json:
/// a `% !TeX root` magic comment wins, then `\documentclass` +
/// `\begin{document}` + a root-level `main.tex`-style name score best, and a
/// lone `.tex` file is simply it.
#[tauri::command]
pub async fn import_overleaf_project(name: Option<String>, path: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || import_overleaf_project_blocking(name, &path))
        .await
        .map_err(|e| e.to_string())?
}

fn import_overleaf_project_blocking(name: Option<String>, path: &str) -> Result<String, String> {
    let source = PathBuf::from(path);
    if !source.exists() {
        return Err(format!("import source not found: {path}"));
    }
    let root = paths::projects_root()?;
    let id = unique_random_slug(&root)?;
    let dir = root.join(&id);
    let fallback_name = source
        .file_stem()
        .map(|stem| stem.to_string_lossy().into_owned())
        .filter(|stem| !stem.trim().is_empty())
        .unwrap_or_else(|| "Imported project".to_string());
    let project_name = name
        .filter(|candidate| !candidate.trim().is_empty())
        .unwrap_or(fallback_name);
    create_project_transaction(&dir, || {
        if source.is_dir() {
            copy_tree_for_import(&source, &dir, 0, &mut 0, &mut 0)?;
        } else {
            extract_zip_for_import(&source, &dir)?;
        }
        flatten_single_root_folder(&dir)?;
        let existing = read_import_meta(&dir);
        let mut meta = match existing {
            Some(mut meta) if dir.join(&meta.main_doc).is_file() => {
                meta.name = project_name.clone();
                meta
            }
            _ => {
                let main_doc = infer_main_document(&dir)?;
                let engine =
                    engine_for_untrusted_project(&main_doc).unwrap_or_else(|_| default_engine());
                ProjectMeta {
                    name: project_name.clone(),
                    main_doc,
                    engine,
                    ..Default::default()
                }
            }
        };
        meta.engine =
            engine_for_untrusted_project(&meta.main_doc).unwrap_or_else(|_| default_engine());
        meta.tex_flavor = None;
        meta.allow_shell_escape = false;
        write_meta_at(&dir.join("project.json"), &meta)
    })?;
    Ok(id)
}

fn read_import_meta(dir: &Path) -> Option<ProjectMeta> {
    let raw = std::fs::read_to_string(dir.join("project.json")).ok()?;
    serde_json::from_str::<ProjectMeta>(&raw).ok()
}

fn extract_zip_for_import(archive: &Path, dest: &Path) -> Result<(), String> {
    let file = std::fs::File::open(archive).map_err(|e| format!("failed to open archive: {e}"))?;
    let mut zip = zip::ZipArchive::new(file).map_err(|e| format!("not a readable ZIP: {e}"))?;
    if zip.len() > IMPORT_MAX_ENTRIES {
        return Err(format!(
            "archive has too many entries ({} > {IMPORT_MAX_ENTRIES})",
            zip.len()
        ));
    }
    let mut total: u64 = 0;
    for index in 0..zip.len() {
        let mut entry = zip.by_index(index).map_err(|e| e.to_string())?;
        let Some(rel) = entry.enclosed_name() else {
            continue; // unsafe path (absolute / traversal): skip
        };
        let rel_text = rel.to_string_lossy().replace('\\', "/");
        if import_skip(&rel_text) || rel.components().count() > IMPORT_MAX_DEPTH {
            continue;
        }
        let out = dest.join(&rel);
        if entry.is_dir() {
            std::fs::create_dir_all(&out).map_err(|e| e.to_string())?;
            continue;
        }
        total = total.saturating_add(entry.size());
        if total > IMPORT_MAX_TOTAL_BYTES {
            return Err("archive is larger than the 2 GB import limit".to_string());
        }
        if let Some(parent) = out.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let mut output = std::fs::File::create(&out).map_err(|e| e.to_string())?;
        std::io::copy(&mut entry, &mut output).map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn copy_tree_for_import(
    source: &Path,
    dest: &Path,
    depth: usize,
    entries: &mut usize,
    total: &mut u64,
) -> Result<(), String> {
    if depth > IMPORT_MAX_DEPTH {
        return Ok(());
    }
    std::fs::create_dir_all(dest).map_err(|e| e.to_string())?;
    for entry in std::fs::read_dir(source).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let file_type = entry.file_type().map_err(|e| e.to_string())?;
        if file_type.is_symlink() {
            continue;
        }
        let file_name = entry.file_name();
        let name_text = file_name.to_string_lossy();
        if import_skip(&name_text) {
            continue;
        }
        *entries += 1;
        if *entries > IMPORT_MAX_ENTRIES {
            return Err(format!(
                "folder has too many files (> {IMPORT_MAX_ENTRIES})"
            ));
        }
        let target = dest.join(&file_name);
        if file_type.is_dir() {
            copy_tree_for_import(&entry.path(), &target, depth + 1, entries, total)?;
        } else if file_type.is_file() {
            let size = entry.metadata().map(|m| m.len()).unwrap_or(0);
            *total = total.saturating_add(size);
            if *total > IMPORT_MAX_TOTAL_BYTES {
                return Err("folder is larger than the 2 GB import limit".to_string());
            }
            std::fs::copy(entry.path(), &target).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

/// Zipping a folder usually wraps everything in one top-level directory.
/// Unwrap it so the project root holds the actual files.
fn flatten_single_root_folder(dir: &Path) -> Result<(), String> {
    let entries: Vec<_> = std::fs::read_dir(dir)
        .map_err(|e| e.to_string())?
        .flatten()
        .collect();
    if entries.len() != 1 {
        return Ok(());
    }
    let only = &entries[0];
    if !only.file_type().map(|t| t.is_dir()).unwrap_or(false) {
        return Ok(());
    }
    let wrapper = only.path();
    for child in std::fs::read_dir(&wrapper)
        .map_err(|e| e.to_string())?
        .flatten()
    {
        let target = dir.join(child.file_name());
        std::fs::rename(child.path(), target).map_err(|e| e.to_string())?;
    }
    std::fs::remove_dir(&wrapper).map_err(|e| e.to_string())?;
    Ok(())
}

/// Pick the compile entry point for an imported project. See
/// `import_overleaf_project` for the strategy.
fn infer_main_document(dir: &Path) -> Result<String, String> {
    let mut tex_files: Vec<String> = Vec::new();
    collect_tex_files(dir, dir, 0, &mut tex_files);
    if tex_files.is_empty() {
        return Err(
            "No .tex file was found in the import, so there is nothing to compile. \
             Pick an Overleaf ZIP export or a folder containing a LaTeX project."
                .to_string(),
        );
    }
    tex_files.sort();
    if tex_files.len() == 1 {
        return Ok(tex_files.remove(0));
    }
    let mut heads: Vec<(String, String)> = tex_files
        .iter()
        .map(|rel| (rel.clone(), read_head_for_import(&dir.join(rel))))
        .collect();
    // A `% !TeX root = ...` magic comment anywhere wins when its target exists.
    for (rel, head) in &heads {
        if let Some(target) = tex_root_magic_target(head) {
            let base = Path::new(rel).parent().unwrap_or(Path::new(""));
            let joined = normalize_relative(&base.join(&target));
            if let Some(joined) = joined {
                if tex_files.iter().any(|candidate| candidate == &joined) {
                    return Ok(joined);
                }
            }
        }
    }
    heads.sort_by_key(|(rel, head)| {
        let mut score: i32 = 0;
        if head.contains("\\documentclass") {
            score += 4;
        }
        if head.contains("\\begin{document}") {
            score += 2;
        }
        if !rel.contains('/') {
            score += 2;
        }
        let filename = rel.rsplit('/').next().unwrap_or(rel).to_ascii_lowercase();
        if filename == "main.tex" {
            score += 3;
        } else if filename.starts_with("main") || filename == "root.tex" {
            score += 1;
        }
        // Sort ascending: best score first via negation, then shallow, then name.
        (-score, rel.matches('/').count(), rel.clone())
    });
    Ok(heads.remove(0).0)
}

fn collect_tex_files(root: &Path, dir: &Path, depth: usize, output: &mut Vec<String>) {
    if depth > IMPORT_MAX_DEPTH {
        return;
    }
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        if file_type.is_symlink() {
            continue;
        }
        let path = entry.path();
        if file_type.is_dir() {
            if entry.file_name() != ".oleafly" {
                collect_tex_files(root, &path, depth + 1, output);
            }
        } else if path
            .extension()
            .is_some_and(|ext| ext.eq_ignore_ascii_case("tex"))
        {
            if let Ok(rel) = path.strip_prefix(root) {
                output.push(
                    rel.components()
                        .map(|c| c.as_os_str().to_string_lossy())
                        .collect::<Vec<_>>()
                        .join("/"),
                );
            }
        }
    }
}

fn read_head_for_import(path: &Path) -> String {
    use std::io::Read;
    const MAX_HEAD: u64 = 64 * 1024;
    let Ok(file) = std::fs::File::open(path) else {
        return String::new();
    };
    let mut bytes = Vec::new();
    let _ = file.take(MAX_HEAD).read_to_end(&mut bytes);
    String::from_utf8_lossy(&bytes).into_owned()
}

/// `% !TeX root = ../main.tex` (TeXShop/latexmk convention, case-insensitive).
fn tex_root_magic_target(head: &str) -> Option<String> {
    for line in head.lines().take(50) {
        let trimmed = line.trim();
        let Some(rest) = trimmed.strip_prefix('%') else {
            continue;
        };
        let lower = rest.trim().trim_start_matches('!').to_ascii_lowercase();
        if !lower.starts_with("tex root") {
            continue;
        }
        let original = rest.trim().trim_start_matches('!');
        let value = original
            .split_once('=')
            .map(|(_, rest)| rest.trim())
            .filter(|v| !v.is_empty())?;
        return Some(value.to_string());
    }
    None
}

/// Resolve `.`/`..` inside a joined relative path; None when it escapes root.
fn normalize_relative(path: &Path) -> Option<String> {
    let mut parts: Vec<String> = Vec::new();
    for component in path.components() {
        match component {
            std::path::Component::Normal(part) => {
                parts.push(part.to_string_lossy().into_owned());
            }
            std::path::Component::CurDir => {}
            std::path::Component::ParentDir => {
                parts.pop()?;
            }
            _ => return None,
        }
    }
    Some(parts.join("/"))
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
                tex_flavor: None,
                allow_shell_escape: false,
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
                tex_flavor: None,
                allow_shell_escape: false,
            },
        )
    })?;
    Ok(id)
}

#[tauri::command]
pub fn get_or_create_scratch_project() -> Result<String, String> {
    let dir = paths::create_project_dir(SCRATCH_PROJECT_ID)?;
    with_project_metadata(SCRATCH_PROJECT_ID, || {
        let meta_file = dir.join("project.json");
        if !meta_file.exists() {
            atomic_write(&dir.join("main.tex"), DEFAULT_MAIN_DIAGRAM.as_bytes())
                .map_err(|e| e.to_string())?;
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
                    tex_flavor: None,
                    allow_shell_escape: false,
                },
            )?;
        }
        Ok(())
    })?;
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

    // The artifact is already durably published. Export-history bookkeeping is
    // best-effort so a metadata failure never reports a false export failure.
    let _ = with_project_metadata(&project_id, || {
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
        write_meta(&project_id, &meta)
    });
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

    let _ = with_project_metadata(&project_id, || {
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
        write_meta(&project_id, &meta)
    });
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
                tex_flavor: None,
                allow_shell_escape: false,
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
        let engine = engine_for_untrusted_project(&manifest.main_doc)?;
        crate::document_engine::engine_for(&engine, &manifest.main_doc)?;
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
                engine,
                color,
                kind: manifest.kind.unwrap_or_default(),
                exports: Vec::new(),
                hidden: false,
                forked_from: None,
                tex: None,
                tex_flavor: None,
                allow_shell_escape: false,
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
const MCP_SEARCH_RESULT_LIMIT: usize = 20;
const MCP_SEARCH_ENTRY_SCAN_LIMIT: usize = 5_000;
const MCP_SEARCH_FILE_SCAN_LIMIT: usize = 2_000;
const MCP_SEARCH_FILE_BYTE_LIMIT: usize = 2 * 1024 * 1024;
const MCP_SEARCH_TOTAL_BYTE_LIMIT: usize = 32 * 1024 * 1024;

pub(crate) struct BoundedSearch {
    pub hits: Vec<SearchHit>,
    pub scanned_entries: usize,
    pub scanned_files: usize,
    pub scanned_bytes: usize,
    pub truncated: bool,
}

#[derive(Clone, Copy)]
struct SearchLimits {
    max_results: usize,
    max_entries: usize,
    max_files: usize,
    max_file_bytes: usize,
    max_total_bytes: usize,
    deadline: std::time::Instant,
}

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

#[allow(clippy::too_many_arguments)]
fn bounded_search_walk(
    project_id: &str,
    project_name: &str,
    root: &Path,
    dir: &Path,
    query_lower: &str,
    out: &mut BoundedSearch,
    limits: SearchLimits,
    cancelled: &AtomicBool,
    depth: usize,
) {
    if scan_should_stop(cancelled, limits.deadline)
        || out.hits.len() >= limits.max_results
        || out.scanned_entries >= limits.max_entries
        || out.scanned_files >= limits.max_files
        || out.scanned_bytes >= limits.max_total_bytes
    {
        out.truncated = true;
        return;
    }
    if depth >= MAX_WALK_DEPTH {
        out.truncated = true;
        return;
    }
    let entries = match std::fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(_) => return,
    };
    let mut items = Vec::new();
    for entry in entries {
        if scan_should_stop(cancelled, limits.deadline) || out.scanned_entries >= limits.max_entries
        {
            out.truncated = true;
            break;
        }
        out.scanned_entries += 1;
        if let Ok(entry) = entry {
            items.push(entry);
        }
    }
    items.sort_by_key(|entry| entry.file_name());

    for entry in items {
        if scan_should_stop(cancelled, limits.deadline) || out.hits.len() >= limits.max_results {
            out.truncated = true;
            break;
        }
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if name == ".oleafly" || name == ".git" {
            continue;
        }
        let file_type = match entry.file_type() {
            Ok(file_type) if !file_type.is_symlink() => file_type,
            _ => continue,
        };
        let path = entry.path();
        if file_type.is_dir() {
            bounded_search_walk(
                project_id,
                project_name,
                root,
                &path,
                query_lower,
                out,
                limits,
                cancelled,
                depth + 1,
            );
            if out.truncated {
                break;
            }
            continue;
        }
        if !is_searchable(&name) {
            continue;
        }
        if out.scanned_files >= limits.max_files || out.scanned_bytes >= limits.max_total_bytes {
            out.truncated = true;
            break;
        }
        out.scanned_files += 1;
        let metadata = match std::fs::symlink_metadata(&path) {
            Ok(metadata) if metadata.is_file() && !metadata.file_type().is_symlink() => metadata,
            _ => continue,
        };
        if metadata.len() > limits.max_file_bytes as u64 {
            out.truncated = true;
            continue;
        }
        let remaining = limits.max_total_bytes.saturating_sub(out.scanned_bytes);
        let read_limit = limits.max_file_bytes.min(remaining);
        if read_limit == 0 {
            out.truncated = true;
            break;
        }
        let mut bytes = Vec::with_capacity((metadata.len() as usize).min(read_limit));
        let read = std::fs::File::open(&path).and_then(|file| {
            use std::io::Read as _;
            file.take(read_limit.saturating_add(1) as u64)
                .read_to_end(&mut bytes)
        });
        if read.is_err() {
            continue;
        }
        out.scanned_bytes = out
            .scanned_bytes
            .saturating_add(bytes.len().min(read_limit));
        if bytes.len() > read_limit {
            out.truncated = true;
            continue;
        }
        let text = match String::from_utf8(bytes) {
            Ok(text) => text,
            Err(_) => continue,
        };
        let relative = rel_slash(root, &path);
        for (index, line) in text.lines().enumerate() {
            if scan_should_stop(cancelled, limits.deadline) {
                out.truncated = true;
                break;
            }
            if line.to_lowercase().contains(query_lower) {
                out.hits.push(SearchHit {
                    project_id: project_id.to_string(),
                    project_name: project_name.to_string(),
                    path: relative.clone(),
                    line: u32::try_from(index.saturating_add(1)).unwrap_or(u32::MAX),
                    preview: line.trim().chars().take(160).collect(),
                });
                if out.hits.len() >= limits.max_results {
                    out.truncated = true;
                    break;
                }
            }
        }
        if out.truncated {
            break;
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

pub(crate) async fn search_project_bounded(
    project_id: String,
    query: String,
) -> Result<BoundedSearch, String> {
    let (mut cancellation, cancelled) = ScanCancellation::new();
    let limits = SearchLimits {
        max_results: MCP_SEARCH_RESULT_LIMIT,
        max_entries: MCP_SEARCH_ENTRY_SCAN_LIMIT,
        max_files: MCP_SEARCH_FILE_SCAN_LIMIT,
        max_file_bytes: MCP_SEARCH_FILE_BYTE_LIMIT,
        max_total_bytes: MCP_SEARCH_TOTAL_BYTE_LIMIT,
        deadline: std::time::Instant::now() + MCP_SCAN_DEADLINE,
    };
    let result = tauri::async_runtime::spawn_blocking(move || -> Result<BoundedSearch, String> {
        let query = query.trim();
        if query.is_empty() {
            return Ok(BoundedSearch {
                hits: Vec::new(),
                scanned_entries: 0,
                scanned_files: 0,
                scanned_bytes: 0,
                truncated: false,
            });
        }
        let root = paths::project_dir(&project_id)?;
        let meta = read_meta(&project_id).unwrap_or_default();
        let project_name = if meta.name.is_empty() {
            project_id.clone()
        } else {
            meta.name
        };
        let mut out = BoundedSearch {
            hits: Vec::new(),
            scanned_entries: 0,
            scanned_files: 0,
            scanned_bytes: 0,
            truncated: false,
        };
        bounded_search_walk(
            &project_id,
            &project_name,
            &root,
            &root,
            &query.to_lowercase(),
            &mut out,
            limits,
            &cancelled,
            0,
        );
        Ok(out)
    })
    .await
    .map_err(|e| e.to_string())?;
    cancellation.disarm();
    result
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
        let duplicated = (|| -> Result<(), String> {
            copy_dir_recursive(&src, &dst, 0)?;
            let mut meta = read_meta(&new_id)?;
            let source_name = if meta.name.is_empty() {
                project_id.clone()
            } else {
                meta.name.clone()
            };
            meta.name = new_name;
            meta.forked_from = Some(source_name);
            meta.allow_shell_escape = false;
            write_meta(&new_id, &meta)
        })();
        if let Err(error) = duplicated {
            let cleanup = std::fs::remove_dir_all(&dst);
            return Err(match cleanup {
                Ok(()) => error,
                Err(cleanup_error) => {
                    format!("{error}. Failed to remove incomplete duplicate: {cleanup_error}")
                }
            });
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
    expected_generation: Option<u64>,
) -> Result<ImportPathsResult, String> {
    if source_paths.is_empty() {
        let generation = project_mutation_generation(project_id)?;
        return Ok(ImportPathsResult {
            paths: Vec::new(),
            generation,
        });
    }
    let destination_rel = mutation_relative_path(&dest_dir, true)?;
    let destination_scope = MutationScope::subtree(destination_rel);
    let conflict_scopes = vec![MutationScope::subtree(String::new())];
    let admission = admit_mutation_with_commit(
        &project_id,
        conflict_scopes,
        vec![destination_scope],
        expected_generation,
    )?;
    tauri::async_runtime::spawn_blocking(move || -> Result<ImportPathsResult, String> {
        let (paths, generation) = admission.run(|| {
            let dest_parent = resolve(&project_id, &dest_dir)?;
            let project_root = paths::project_dir(&project_id)?;
            let sources: Vec<PathBuf> = source_paths.iter().map(PathBuf::from).collect();
            import_paths_transactional(&project_root, &dest_parent, &sources)
        })?;
        Ok(ImportPathsResult { paths, generation })
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
        let destination_rel = rel_slash(project_root, &destination);
        if reserved_project_metadata_path(&destination_rel) {
            return Err(
                "project.json is managed by Oleafly and cannot be imported as a project file"
                    .into(),
            );
        }
        if reserved_project_internal_path(&destination_rel) {
            return Err(
                ".git and .oleafly are managed internally and cannot be imported as project files"
                    .into(),
            );
        }
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

#[tauri::command]
pub async fn delete_project(
    project_id: String,
    state: tauri::State<'_, crate::state::AppState>,
) -> Result<(), String> {
    delete_project_synchronized(&state, project_id).await
}

async fn delete_project_synchronized(
    state: &crate::state::AppState,
    project_id: String,
) -> Result<(), String> {
    paths::validate_project_id(&project_id)?;
    let admission = admit_mutation(
        &project_id,
        vec![MutationScope::subtree(String::new())],
        None,
    )?;
    let _compile = state.compile_lock.lock().await;
    let _figure_compile = state.figure_compile_lock.lock().await;
    tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
        let ((), _) = admission.run_with_change_status(|| {
            with_project_metadata(&project_id, || {
                let root = paths::projects_root()?
                    .canonicalize()
                    .map_err(|error| format!("failed to resolve projects root: {error}"))?;
                let dir = root.join(&project_id);
                match std::fs::symlink_metadata(&dir) {
                    Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                        revoke_shell_escape_trust(&project_id)?;
                        return Ok(((), false));
                    }
                    Err(error) => {
                        return Err(format!(
                            "failed to inspect project before deletion: {error}"
                        ));
                    }
                    Ok(metadata) if !metadata.is_dir() || metadata.file_type().is_symlink() => {
                        return Err(
                            "refusing to delete a project path that is not a real directory"
                                .to_string(),
                        );
                    }
                    Ok(_) => {}
                }
                let verified = paths::project_dir(&project_id)?;
                revoke_shell_escape_trust(&project_id)?;
                std::fs::remove_dir_all(&verified)
                    .map_err(|e| format!("failed to delete project: {e}"))?;
                Ok(((), true))
            })
        })?;
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::{
        copy_path_in_project, create_diagram_project, create_image_project_in,
        create_markdown_project_in, create_project_from_pdf_conversion, create_project_transaction,
        create_typst_project_in, download_project_zip, duplicate_project, engine_for_main_document,
        extract_pandoc, flatten_single_root_folder, get_or_create_scratch_project,
        import_paths_transactional, import_paths_transactional_with, import_skip,
        infer_main_document, list_projects, normalize_loaded_tex_flavor, normalize_relative,
        pandoc_asset_for, pandoc_version_supported, read_meta, rel_slash, rename_exclusive,
        rename_path_in_project, search_docs, set_main_doc_synchronized, set_main_doc_unlocked,
        tex_root_magic_target, validate_conversion_export, validate_tex_flavor, write_meta_at,
        FileConflictStrategy, MutationScope, PdfConversionFigure, ProjectMeta, RenameFileResult,
        TexSpec, SCRATCH_PROJECT_ID,
    };
    use std::io::Write;
    use std::path::Path;
    use std::sync::Arc;

    fn test_dir(label: &str) -> std::path::PathBuf {
        tempfile::Builder::new()
            .prefix(&format!("oleafly-{label}-"))
            .tempdir()
            .unwrap()
            .keep()
    }

    fn mutation_project_id(label: &str) -> String {
        use std::sync::atomic::{AtomicU64, Ordering};
        static NEXT: AtomicU64 = AtomicU64::new(0);
        format!(
            "mutation-{label}-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        )
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
        let win_like = Path::new("/proj/sections\\intro.tex");
        assert_eq!(rel_slash(root, win_like), "sections/intro.tex");
    }

    #[test]
    fn mutation_paths_use_one_portable_normalized_wire_format() {
        assert_eq!(
            super::mutation_relative_path("chapters/./one.tex", false).unwrap(),
            "chapters/one.tex"
        );
        assert!(super::mutation_relative_path("../outside.tex", false).is_err());
        assert!(super::mutation_relative_path("..\\outside.tex", false).is_err());
        assert!(super::mutation_relative_path("chapters\\one.tex", false).is_err());
        assert!(super::mutation_relative_path("", false).is_err());
        assert_eq!(super::mutation_relative_path("./", true).unwrap(), "");
        assert!(super::mutation_relative_path("project.json", false).is_err());
        assert!(super::mutation_relative_path("PROJECT.JSON", false).is_err());
        assert_eq!(
            super::mutation_relative_path("notes/project.json", false).unwrap(),
            "notes/project.json"
        );
    }

    #[test]
    fn mutation_scopes_and_project_ids_alias_case_portably() {
        let upper_file = MutationScope::file("Chapters/Main.TEX".into());
        let lower_file = MutationScope::file("chapters/main.tex".into());
        let lower_parent = MutationScope::subtree("chapters".into());
        assert!(upper_file.intersects(&lower_file));
        assert!(upper_file.intersects(&lower_parent));

        let upper = super::project_mutation_coordinator("Portable-Project").unwrap();
        let lower = super::project_mutation_coordinator("portable-project").unwrap();
        assert!(Arc::ptr_eq(&upper, &lower));
    }

    #[test]
    fn coordinator_eviction_retains_a_fail_closed_generation_floor() {
        let project_id = mutation_project_id("eviction-target");
        let stale_generation = super::project_mutation_generation(project_id.clone()).unwrap();
        let admission = super::admit_mutation(
            &project_id,
            vec![MutationScope::file("main.tex".into())],
            Some(stale_generation),
        )
        .unwrap();
        let (_, committed_generation) = admission.run(|| Ok::<(), String>(())).unwrap();
        let before = Arc::downgrade(&super::project_mutation_coordinator(&project_id).unwrap());

        for index in 0..=super::MAX_COORDINATED_PROJECTS {
            let id = mutation_project_id(&format!("eviction-{index}"));
            super::project_mutation_generation(id).unwrap();
        }

        assert!(
            before.upgrade().is_none(),
            "the target coordinator was not evicted"
        );
        let after = super::project_mutation_coordinator(&project_id).unwrap();
        assert!(super::lock_unpoisoned(&after.state).committed_generation >= committed_generation);
        let stale = super::admit_mutation(
            &project_id,
            vec![MutationScope::file("MAIN.TEX".into())],
            Some(stale_generation),
        )
        .unwrap();
        assert!(stale
            .run(|| Ok::<(), String>(()))
            .unwrap_err()
            .contains("mutation conflict"));
    }

    #[test]
    fn bounded_file_listing_enforces_result_entry_and_cancellation_limits() {
        let root = test_dir("bounded-list");
        for index in 0..8 {
            std::fs::write(root.join(format!("file-{index}.tex")), "body").unwrap();
        }
        let cancelled = std::sync::atomic::AtomicBool::new(false);
        let mut listing = super::BoundedFileList {
            entries: Vec::new(),
            scanned_entries: 0,
            truncated: false,
        };
        super::bounded_list_walk(
            &root,
            &root,
            &mut listing,
            super::FileListLimits {
                max_results: 3,
                max_entries: 5,
                deadline: std::time::Instant::now() + std::time::Duration::from_secs(1),
            },
            &cancelled,
            0,
        )
        .unwrap();
        assert_eq!(listing.entries.len(), 3);
        assert!(listing.scanned_entries <= 5);
        assert!(listing.truncated);

        cancelled.store(true, std::sync::atomic::Ordering::Release);
        let mut cancelled_listing = super::BoundedFileList {
            entries: Vec::new(),
            scanned_entries: 0,
            truncated: false,
        };
        super::bounded_list_walk(
            &root,
            &root,
            &mut cancelled_listing,
            super::FileListLimits {
                max_results: 100,
                max_entries: 100,
                deadline: std::time::Instant::now() + std::time::Duration::from_secs(1),
            },
            &cancelled,
            0,
        )
        .unwrap();
        assert!(cancelled_listing.entries.is_empty());
        assert!(cancelled_listing.truncated);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn bounded_search_enforces_aggregate_result_and_byte_limits() {
        let root = test_dir("bounded-search");
        for index in 0..6 {
            std::fs::write(root.join(format!("file-{index}.tex")), "needle\n").unwrap();
        }
        let cancelled = std::sync::atomic::AtomicBool::new(false);
        let mut search = super::BoundedSearch {
            hits: Vec::new(),
            scanned_entries: 0,
            scanned_files: 0,
            scanned_bytes: 0,
            truncated: false,
        };
        super::bounded_search_walk(
            "project",
            "Project",
            &root,
            &root,
            "needle",
            &mut search,
            super::SearchLimits {
                max_results: 2,
                max_entries: 20,
                max_files: 20,
                max_file_bytes: 64,
                max_total_bytes: 64,
                deadline: std::time::Instant::now() + std::time::Duration::from_secs(1),
            },
            &cancelled,
            0,
        );
        assert_eq!(search.hits.len(), 2);
        assert!(search.scanned_files <= 2);
        assert!(search.scanned_bytes <= 64);
        assert!(search.truncated);

        let large = test_dir("bounded-search-bytes");
        std::fs::write(large.join("large.tex"), "needle".repeat(100)).unwrap();
        let mut byte_limited = super::BoundedSearch {
            hits: Vec::new(),
            scanned_entries: 0,
            scanned_files: 0,
            scanned_bytes: 0,
            truncated: false,
        };
        super::bounded_search_walk(
            "project",
            "Project",
            &large,
            &large,
            "needle",
            &mut byte_limited,
            super::SearchLimits {
                max_results: 20,
                max_entries: 20,
                max_files: 20,
                max_file_bytes: 1_024,
                max_total_bytes: 16,
                deadline: std::time::Instant::now() + std::time::Duration::from_secs(1),
            },
            &cancelled,
            0,
        );
        assert!(byte_limited.hits.is_empty());
        assert!(byte_limited.scanned_bytes <= 16);
        assert!(byte_limited.truncated);
        std::fs::remove_dir_all(root).unwrap();
        std::fs::remove_dir_all(large).unwrap();
    }

    #[test]
    fn paused_write_cannot_recreate_a_renamed_path_but_a_new_write_can() {
        let root = test_dir("mutation-rename-tombstone");
        let old = root.join("draft.tex");
        let new = root.join("final.tex");
        std::fs::write(&old, "original").unwrap();
        let project_id = mutation_project_id("rename");

        let stale_write = super::admit_mutation(
            &project_id,
            vec![MutationScope::file("draft.tex".into())],
            None,
        )
        .unwrap();
        let rename = super::admit_mutation(
            &project_id,
            vec![
                MutationScope::subtree("draft.tex".into()),
                MutationScope::subtree("final.tex".into()),
            ],
            None,
        )
        .unwrap();
        rename
            .run(|| std::fs::rename(&old, &new).map_err(|error| error.to_string()))
            .unwrap();

        let error = stale_write
            .run(|| std::fs::write(&old, "stale").map_err(|error| error.to_string()))
            .unwrap_err();
        assert!(error.contains("mutation conflict"));
        assert!(
            !old.exists(),
            "the stale autosave must not recreate the source"
        );
        assert_eq!(std::fs::read_to_string(&new).unwrap(), "original");

        let corrective = super::admit_mutation(
            &project_id,
            vec![MutationScope::file("draft.tex".into())],
            None,
        )
        .unwrap();
        corrective
            .run(|| std::fs::write(&old, "restored").map_err(|error| error.to_string()))
            .unwrap();
        assert_eq!(std::fs::read_to_string(&old).unwrap(), "restored");
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn paused_write_cannot_recreate_a_deleted_subtree() {
        let root = test_dir("mutation-delete-tombstone");
        let folder = root.join("chapters");
        let file = folder.join("one.tex");
        std::fs::create_dir(&folder).unwrap();
        std::fs::write(&file, "original").unwrap();
        let project_id = mutation_project_id("delete");

        let stale_write = super::admit_mutation(
            &project_id,
            vec![MutationScope::file("chapters/one.tex".into())],
            None,
        )
        .unwrap();
        let delete = super::admit_mutation(
            &project_id,
            vec![MutationScope::subtree("chapters".into())],
            None,
        )
        .unwrap();
        delete
            .run(|| std::fs::remove_dir_all(&folder).map_err(|error| error.to_string()))
            .unwrap();

        let error = stale_write
            .run(|| {
                std::fs::create_dir_all(&folder).map_err(|error| error.to_string())?;
                std::fs::write(&file, "stale").map_err(|error| error.to_string())
            })
            .unwrap_err();
        assert!(error.contains("mutation conflict"));
        assert!(!folder.exists());
        std::fs::remove_dir_all(root).unwrap();
    }

    #[allow(clippy::await_holding_lock)]
    #[tokio::test]
    async fn project_deletion_rejects_queued_and_late_writes_without_resurrection() {
        let _env_guard = crate::paths::data_dir_env_lock();
        let data = test_dir("project-delete-coordinator");
        std::env::set_var("OLEAFLY_DATA_DIR", &data);
        let project_id = mutation_project_id("delete-project");
        let project_dir = data.join("projects").join(&project_id);
        std::fs::create_dir_all(&project_dir).unwrap();
        std::fs::write(project_dir.join("main.tex"), "original").unwrap();
        write_meta_at(
            &project_dir.join("project.json"),
            &ProjectMeta {
                name: "Delete race".into(),
                ..ProjectMeta::default()
            },
        )
        .unwrap();
        super::set_project_engine_unlocked(&project_id, "latexmk", None).unwrap();
        super::set_project_shell_escape_unlocked(&project_id, true).unwrap();
        let trust_path = super::shell_escape_trust_path(&project_id).unwrap();
        assert!(trust_path.is_file());

        let queued = super::admit_mutation(
            &project_id,
            vec![MutationScope::file("main.tex".into())],
            None,
        )
        .unwrap();
        let state = crate::state::AppState::default();
        super::delete_project_synchronized(&state, project_id.clone())
            .await
            .unwrap();
        assert!(!project_dir.exists());
        assert!(!trust_path.exists());

        let queued_error = queued
            .run(|| {
                let path = crate::sandbox::resolve(&project_id, "main.tex")?;
                std::fs::write(path, "stale").map_err(|error| error.to_string())
            })
            .unwrap_err();
        assert!(queued_error.contains("mutation conflict"));

        let late_error =
            super::write_file(project_id.clone(), "main.tex".into(), "late".into(), None)
                .await
                .unwrap_err();
        assert!(late_error.contains("does not exist"));
        assert!(!project_dir.exists());

        std::env::remove_var("OLEAFLY_DATA_DIR");
        std::fs::remove_dir_all(data).unwrap();
    }

    #[test]
    fn edit_admitted_during_external_write_runs_after_the_committed_external_write() {
        let root = test_dir("mutation-overlap");
        let file = root.join("main.tex");
        std::fs::write(&file, "initial").unwrap();
        let project_id = mutation_project_id("overlap");
        let external = super::admit_mutation(
            &project_id,
            vec![MutationScope::file("main.tex".into())],
            None,
        )
        .unwrap();
        let (started_tx, started_rx) = std::sync::mpsc::channel();
        let (release_tx, release_rx) = std::sync::mpsc::channel();
        let external_file = file.clone();
        let worker = std::thread::spawn(move || {
            external.run(|| {
                started_tx.send(()).unwrap();
                release_rx.recv().unwrap();
                std::fs::write(&external_file, "external").map_err(|error| error.to_string())
            })
        });
        started_rx.recv().unwrap();

        let local = super::admit_mutation(
            &project_id,
            vec![MutationScope::file("main.tex".into())],
            None,
        )
        .unwrap();
        release_tx.send(()).unwrap();
        let (_, external_generation) = worker.join().unwrap().unwrap();
        local
            .run(|| std::fs::write(&file, "local").map_err(|error| error.to_string()))
            .unwrap();
        assert!(external_generation > 0);
        assert_eq!(std::fs::read_to_string(&file).unwrap(), "local");
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn expected_generation_rejects_stale_overlap_and_allows_corrective_write() {
        let root = test_dir("mutation-precondition");
        let file = root.join("main.tex");
        let project_id = mutation_project_id("precondition");
        let baseline = super::project_mutation_generation(project_id.clone()).unwrap();

        let external = super::admit_mutation(
            &project_id,
            vec![MutationScope::file("main.tex".into())],
            Some(baseline),
        )
        .unwrap();
        let (_, external_generation) = external
            .run(|| std::fs::write(&file, "external").map_err(|error| error.to_string()))
            .unwrap();

        let stale = super::admit_mutation(
            &project_id,
            vec![MutationScope::file("main.tex".into())],
            Some(baseline),
        )
        .unwrap();
        assert!(stale
            .run(|| std::fs::write(&file, "stale").map_err(|error| error.to_string()))
            .unwrap_err()
            .contains("target changed"));

        let corrective = super::admit_mutation(
            &project_id,
            vec![MutationScope::file("main.tex".into())],
            Some(external_generation),
        )
        .unwrap();
        corrective
            .run(|| std::fs::write(&file, "local").map_err(|error| error.to_string()))
            .unwrap();
        assert_eq!(std::fs::read_to_string(&file).unwrap(), "local");
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn concurrent_main_document_change_and_parent_rename_do_not_lose_metadata() {
        let _env_guard = crate::paths::data_dir_env_lock();
        let data = test_dir("metadata-rename-race");
        std::env::set_var("OLEAFLY_DATA_DIR", &data);
        let project_id = mutation_project_id("metadata");
        let root = data.join("projects").join(&project_id);
        std::fs::create_dir_all(root.join("chapters")).unwrap();
        std::fs::write(root.join("chapters/main.tex"), "main").unwrap();
        std::fs::write(root.join("alternate.tex"), "alternate").unwrap();
        write_meta_at(
            &root.join("project.json"),
            &ProjectMeta {
                name: "Race".into(),
                main_doc: "chapters/main.tex".into(),
                engine: "xetex".into(),
                ..ProjectMeta::default()
            },
        )
        .unwrap();

        let coordinator = super::project_mutation_coordinator(&project_id).unwrap();
        let held = super::lock_unpoisoned(&coordinator.metadata);
        let (ready_tx, ready_rx) = std::sync::mpsc::channel();
        let rename_id = project_id.clone();
        let rename_ready = ready_tx.clone();
        let rename = std::thread::spawn(move || {
            rename_ready.send(()).unwrap();
            super::rename_file_blocking(rename_id, "chapters".into(), "moved".into(), None, None)
        });
        let main_id = project_id.clone();
        let main = std::thread::spawn(move || {
            ready_tx.send(()).unwrap();
            set_main_doc_unlocked(main_id, "alternate.tex".into())
        });
        ready_rx.recv().unwrap();
        ready_rx.recv().unwrap();
        drop(held);

        rename.join().unwrap().unwrap();
        main.join().unwrap().unwrap();
        let meta = super::read_meta(&project_id).unwrap();
        assert_eq!(meta.main_doc, "alternate.tex");
        assert!(root.join("moved/main.tex").is_file());
        assert!(!root.join("chapters").exists());

        std::env::remove_var("OLEAFLY_DATA_DIR");
        std::fs::remove_dir_all(data).unwrap();
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

    #[allow(clippy::await_holding_lock)]
    #[tokio::test]
    async fn copy_and_import_commands_share_authoritative_destination_generation() {
        let _env_guard = crate::paths::data_dir_env_lock();
        let data = test_dir("coordinated-copy-import");
        std::env::set_var("OLEAFLY_DATA_DIR", &data);
        let project_id = mutation_project_id("copy-import");
        let project = data.join("projects").join(&project_id);
        std::fs::create_dir_all(&project).unwrap();
        std::fs::write(project.join("draft.tex"), "draft").unwrap();
        let external = data.join("external.tex");
        std::fs::write(&external, "external").unwrap();
        let baseline = super::project_mutation_generation(project_id.clone()).unwrap();

        let copied = super::copy_file(
            project_id.clone(),
            "draft.tex".into(),
            "draft copy.tex".into(),
            Some(baseline),
        )
        .await
        .unwrap();
        assert_eq!(copied.path, "draft copy.tex");
        assert!(copied.generation > baseline);

        let imported = super::import_paths_into_project(
            project_id.clone(),
            String::new(),
            vec![external.to_string_lossy().into_owned()],
            Some(copied.generation),
        )
        .await
        .unwrap();
        assert_eq!(imported.paths, ["external.tex"]);
        assert!(imported.generation > copied.generation);
        assert_eq!(
            std::fs::read_to_string(project.join("external.tex")).unwrap(),
            "external"
        );

        let stale = super::copy_file(
            project_id,
            "draft.tex".into(),
            "another.tex".into(),
            Some(baseline),
        )
        .await
        .unwrap_err();
        assert!(stale.contains("mutation conflict"));
        assert!(!project.join("another.tex").exists());

        std::env::remove_var("OLEAFLY_DATA_DIR");
        std::fs::remove_dir_all(data).unwrap();
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
                generation: 0,
            }
        );
        assert_eq!(std::fs::read_to_string(src).unwrap(), "new draft");
        assert_eq!(std::fs::read_to_string(dst).unwrap(), "published");
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn main_document_file_rename_is_persisted_for_restart() {
        let root = test_dir("rename-main-file");
        let src = root.join("draft.tex");
        let dst = root.join("final.tex");
        std::fs::write(&src, "document").unwrap();
        let meta = ProjectMeta {
            main_doc: "draft.tex".into(),
            engine: "xetex".into(),
            ..ProjectMeta::default()
        };
        write_meta_at(&root.join("project.json"), &meta).unwrap();

        let result = super::rename_path_and_update_meta(
            None,
            &root,
            &src,
            &dst,
            "final.tex",
            FileConflictStrategy::Error,
            meta,
        )
        .unwrap();

        assert!(matches!(
            result,
            RenameFileResult::Renamed { ref path, .. } if path == "final.tex"
        ));
        let restarted: ProjectMeta =
            serde_json::from_str(&std::fs::read_to_string(root.join("project.json")).unwrap())
                .unwrap();
        assert_eq!(restarted.main_doc, "final.tex");
        assert!(dst.is_file());
        assert!(!src.exists());
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn parent_rename_persists_collision_resolved_main_document_path() {
        let root = test_dir("rename-main-parent");
        let src = root.join("chapters");
        let requested = root.join("renamed");
        std::fs::create_dir(&src).unwrap();
        std::fs::write(src.join("main.tex"), "document").unwrap();
        std::fs::create_dir(&requested).unwrap();
        let meta = ProjectMeta {
            main_doc: "chapters/main.tex".into(),
            engine: "xetex".into(),
            ..ProjectMeta::default()
        };
        write_meta_at(&root.join("project.json"), &meta).unwrap();

        let result = super::rename_path_and_update_meta(
            None,
            &root,
            &src,
            &requested,
            "renamed",
            FileConflictStrategy::KeepBoth,
            meta,
        )
        .unwrap();

        assert!(matches!(
            result,
            RenameFileResult::Renamed { ref path, .. } if path == "renamed (2)"
        ));
        let restarted: ProjectMeta =
            serde_json::from_str(&std::fs::read_to_string(root.join("project.json")).unwrap())
                .unwrap();
        assert_eq!(restarted.main_doc, "renamed (2)/main.tex");
        assert!(root.join("renamed (2)/main.tex").is_file());
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn case_only_main_document_rename_is_persisted() {
        let root = test_dir("rename-main-case");
        let src = root.join("Paper.tex");
        let dst = root.join("paper.tex");
        std::fs::write(&src, "document").unwrap();
        let meta = ProjectMeta {
            main_doc: "Paper.tex".into(),
            engine: "xetex".into(),
            ..ProjectMeta::default()
        };
        write_meta_at(&root.join("project.json"), &meta).unwrap();

        super::rename_path_and_update_meta(
            None,
            &root,
            &src,
            &dst,
            "paper.tex",
            FileConflictStrategy::Error,
            meta,
        )
        .unwrap();

        let restarted: ProjectMeta =
            serde_json::from_str(&std::fs::read_to_string(root.join("project.json")).unwrap())
                .unwrap();
        assert_eq!(restarted.main_doc, "paper.tex");
        assert!(dst.is_file());
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn failed_main_document_metadata_commit_rolls_back_the_move() {
        let root = test_dir("rename-main-rollback");
        let src = root.join("draft.tex");
        let dst = root.join("final.tex");
        std::fs::write(&src, "document").unwrap();
        std::fs::create_dir(root.join("project.json")).unwrap();
        let meta = ProjectMeta {
            main_doc: "draft.tex".into(),
            engine: "xetex".into(),
            ..ProjectMeta::default()
        };

        let error = super::rename_path_and_update_meta(
            None,
            &root,
            &src,
            &dst,
            "final.tex",
            FileConflictStrategy::Error,
            meta,
        )
        .unwrap_err();

        assert!(error.contains("rolled back"));
        assert!(src.is_file());
        assert!(!dst.exists());
        assert_eq!(std::fs::read_to_string(src).unwrap(), "document");
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn main_document_delete_guard_is_segment_aware() {
        assert!(super::deletion_removes_main_document(
            "chapters/main.tex",
            "chapters/main.tex"
        ));
        assert!(super::deletion_removes_main_document(
            "chapters/main.tex",
            "chapters"
        ));
        assert!(!super::deletion_removes_main_document(
            "chapters-old/main.tex",
            "chapters"
        ));
        assert!(!super::deletion_removes_main_document(
            "chapters/main.tex",
            "chapter"
        ));
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
                generation: 0,
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
                generation: 0,
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
                generation: 0,
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

    #[allow(clippy::await_holding_lock)]
    #[tokio::test]
    async fn main_document_rename_waits_for_an_active_compile() {
        let _env_guard = crate::paths::data_dir_env_lock();
        let root = test_dir("main-doc-rename-compile-race");
        std::env::set_var("OLEAFLY_DATA_DIR", &root);
        let project_id = "rename-compile-race";
        let project_dir = root.join("projects").join(project_id);
        std::fs::create_dir_all(project_dir.join("chapters")).unwrap();
        std::fs::write(project_dir.join("chapters/main.tex"), "main").unwrap();
        write_meta_at(
            &project_dir.join("project.json"),
            &ProjectMeta {
                name: "Rename compile race".into(),
                main_doc: "chapters/main.tex".into(),
                engine: "xetex".into(),
                ..ProjectMeta::default()
            },
        )
        .unwrap();

        let state = Arc::new(crate::state::AppState::default());
        let compile_guard = state.compile_lock.lock().await;
        let rename_state = Arc::clone(&state);
        let (started_tx, started_rx) = tokio::sync::oneshot::channel();
        let rename = tokio::spawn(async move {
            let _ = started_tx.send(());
            super::rename_file_synchronized(
                rename_state.as_ref(),
                project_id.into(),
                "chapters".into(),
                "moved".into(),
                None,
                None,
            )
            .await
        });
        started_rx.await.unwrap();
        tokio::task::yield_now().await;

        assert!(!rename.is_finished());
        assert!(project_dir.join("chapters/main.tex").is_file());
        assert_eq!(read_meta(project_id).unwrap().main_doc, "chapters/main.tex");

        drop(compile_guard);
        let result = rename.await.unwrap().unwrap();
        assert!(matches!(result, RenameFileResult::Renamed { .. }));
        assert!(project_dir.join("moved/main.tex").is_file());
        assert_eq!(read_meta(project_id).unwrap().main_doc, "moved/main.tex");

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
            tex_flavor: None,
            allow_shell_escape: false,
        };
        let json = serde_json::to_string(&meta).unwrap();
        assert!(json.contains("\"allow_shell_escape\":false"));
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
            tex_flavor: None,
            allow_shell_escape: false,
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
                        tex_flavor: None,
                        allow_shell_escape: false,
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
        let source_id = super::create_project("Original Paper".to_string()).unwrap();
        super::set_project_engine_unlocked(&source_id, "latexmk", None).unwrap();
        super::set_project_shell_escape_unlocked(&source_id, true).unwrap();
        assert!(read_meta(&source_id).unwrap().allow_shell_escape);
        let fork_id = duplicate_project(source_id, "Original Paper (copy)".to_string())
            .await
            .unwrap();
        let meta = read_meta(&fork_id).unwrap();
        assert_eq!(meta.name, "Original Paper (copy)");
        assert_eq!(meta.forked_from.as_deref(), Some("Original Paper"));
        assert!(!meta.allow_shell_escape);
        assert!(!std::fs::read_to_string(
            crate::paths::project_dir(&fork_id)
                .unwrap()
                .join("project.json")
        )
        .unwrap()
        .contains("allow_shell_escape"));
        std::env::remove_var("OLEAFLY_DATA_DIR");
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn shell_escape_consent_is_device_local_and_project_json_cannot_grant_it() {
        let _env_guard = crate::paths::data_dir_env_lock();
        let root = test_dir("shell-trust-local");
        std::env::set_var("OLEAFLY_DATA_DIR", &root);
        let project_id = super::create_project("Untrusted Paper".into()).unwrap();
        let project = crate::paths::project_dir(&project_id).unwrap();

        std::fs::write(
            project.join("project.json"),
            r#"{
  "name": "Untrusted Paper",
  "main_doc": "main.tex",
  "engine": "latexmk",
  "allow_shell_escape": true
}"#,
        )
        .unwrap();
        assert!(!read_meta(&project_id).unwrap().allow_shell_escape);

        let trusted = super::set_project_shell_escape_unlocked(&project_id, true).unwrap();
        assert!(trusted.allow_shell_escape);
        assert!(read_meta(&project_id).unwrap().allow_shell_escape);

        let renamed = super::rename_project(project_id.clone(), "Trusted Paper".into()).unwrap();
        assert!(renamed.allow_shell_escape);
        assert!(!std::fs::read_to_string(project.join("project.json"))
            .unwrap()
            .contains("allow_shell_escape"));
        assert!(read_meta(&project_id).unwrap().allow_shell_escape);

        super::set_project_engine_unlocked(&project_id, "xetex", None).unwrap();
        assert!(!read_meta(&project_id).unwrap().allow_shell_escape);
        super::set_project_engine_unlocked(&project_id, "latexmk", None).unwrap();
        assert!(!read_meta(&project_id).unwrap().allow_shell_escape);
        assert!(super::set_project_shell_escape_unlocked(&project_id, true).is_ok());
        assert!(super::set_project_shell_escape_unlocked(&project_id, false).is_ok());
        assert!(!read_meta(&project_id).unwrap().allow_shell_escape);

        std::env::remove_var("OLEAFLY_DATA_DIR");
        std::fs::remove_dir_all(root).unwrap();
    }

    #[allow(clippy::await_holding_lock)]
    #[tokio::test]
    async fn generic_and_agent_file_mutations_cannot_change_project_metadata_or_internals() {
        let _env_guard = crate::paths::data_dir_env_lock();
        let root = test_dir("reserved-project-metadata");
        std::env::set_var("OLEAFLY_DATA_DIR", &root);
        let project_id = super::create_project("Reserved Metadata".into()).unwrap();

        let write_error =
            super::write_file(project_id.clone(), "project.json".into(), "{}".into(), None)
                .await
                .unwrap_err();
        assert!(write_error.contains("managed by Oleafly"));
        assert!(
            super::admit_project_file_write(project_id.clone(), "PROJECT.JSON".into(), None,)
                .err()
                .unwrap()
                .contains("managed by Oleafly")
        );
        assert!(
            super::create_file(project_id.clone(), "project.json".into(), false, None,)
                .unwrap_err()
                .contains("managed by Oleafly")
        );
        assert!(
            super::delete_file(project_id.clone(), "project.json".into(), None)
                .unwrap_err()
                .contains("managed by Oleafly")
        );
        assert!(super::rename_file_blocking(
            project_id.clone(),
            "main.tex".into(),
            "project.json".into(),
            None,
            None,
        )
        .unwrap_err()
        .contains("managed by Oleafly"));
        assert!(super::copy_file(
            project_id.clone(),
            "main.tex".into(),
            "project.json".into(),
            None,
        )
        .await
        .unwrap_err()
        .contains("managed by Oleafly"));

        for internal in [".oleafly/build/marker", ".GIT/config"] {
            assert!(super::write_file(
                project_id.clone(),
                internal.into(),
                "untrusted".into(),
                None,
            )
            .await
            .unwrap_err()
            .contains("managed internally"));
            assert!(
                super::admit_project_file_write(project_id.clone(), internal.into(), None)
                    .err()
                    .unwrap()
                    .contains("managed internally")
            );
        }

        assert!(crate::paths::project_dir(&project_id)
            .unwrap()
            .join("project.json")
            .is_file());
        std::env::remove_var("OLEAFLY_DATA_DIR");
        std::fs::remove_dir_all(root).unwrap();
    }

    #[allow(clippy::await_holding_lock)]
    #[tokio::test]
    async fn external_worktree_mutation_is_compile_serialized_and_revokes_trust() {
        let _env_guard = crate::paths::data_dir_env_lock();
        let root = test_dir("external-worktree-trust");
        std::env::set_var("OLEAFLY_DATA_DIR", &root);
        let project_id = super::create_project("Git Trust".into()).unwrap();
        super::set_project_engine_unlocked(&project_id, "latexmk", None).unwrap();
        super::set_project_shell_escape_unlocked(&project_id, true).unwrap();
        let state = Arc::new(crate::state::AppState::default());

        let compile_guard = state.compile_lock.lock().await;
        let worker_state = Arc::clone(&state);
        let worker_id = project_id.clone();
        let (started_tx, started_rx) = tokio::sync::oneshot::channel();
        let worker = tokio::spawn(async move {
            super::mutate_project_worktree(&worker_state, worker_id, None, move |project| {
                let _ = started_tx.send(());
                std::fs::write(
                    project.join("project.json"),
                    r#"{"name":"Git Trust","main_doc":"main.tex","engine":"xetex"}"#,
                )
                .map_err(|error| error.to_string())?;
                Ok(((), true))
            })
            .await
        });
        assert!(
            tokio::time::timeout(std::time::Duration::from_millis(50), started_rx)
                .await
                .is_err()
        );
        drop(compile_guard);
        let changed = worker.await.unwrap().unwrap();
        changed.value.unwrap();
        assert_eq!(changed.project.engine, "xetex");
        assert!(!changed.project.allow_shell_escape);
        assert!(!super::shell_escape_trust_path(&project_id)
            .unwrap()
            .exists());

        let changed_back =
            super::mutate_project_worktree(&state, project_id.clone(), None, move |project| {
                std::fs::write(
                    project.join("project.json"),
                    r#"{"name":"Git Trust","main_doc":"main.tex","engine":"latexmk"}"#,
                )
                .map_err(|error| error.to_string())?;
                Ok(((), true))
            })
            .await
            .unwrap();
        changed_back.value.unwrap();
        assert_eq!(changed_back.project.engine, "xetex");
        assert!(!changed_back.project.allow_shell_escape);

        super::set_project_engine_unlocked(&project_id, "latexmk", None).unwrap();
        super::set_project_shell_escape_unlocked(&project_id, true).unwrap();
        let before_failure = super::project_mutation_generation(project_id.clone()).unwrap();
        let failed = super::mutate_project_worktree(
            &state,
            project_id.clone(),
            None,
            move |_project| -> Result<((), bool), String> {
                Err("simulated conflicting pull".into())
            },
        )
        .await
        .unwrap();
        assert_eq!(
            failed.value.unwrap_err(),
            "simulated conflicting pull".to_string()
        );
        assert!(failed.generation > before_failure);
        assert!(!failed.project.allow_shell_escape);
        assert!(!super::shell_escape_trust_path(&project_id)
            .unwrap()
            .exists());

        let repaired = super::mutate_project_worktree(
            &state,
            project_id.clone(),
            None,
            move |project| -> Result<((), bool), String> {
                std::fs::write(project.join("project.json"), "{malformed")
                    .map_err(|error| error.to_string())?;
                Ok(((), true))
            },
        )
        .await
        .unwrap();
        repaired.value.unwrap();
        assert_eq!(repaired.project.main_doc, "main.tex");
        assert_eq!(repaired.project.engine, "latexmk");
        assert!(!repaired.project.allow_shell_escape);
        assert!(serde_json::from_str::<serde_json::Value>(
            &std::fs::read_to_string(
                crate::paths::project_dir(&project_id)
                    .unwrap()
                    .join("project.json")
            )
            .unwrap()
        )
        .is_ok());

        std::env::remove_var("OLEAFLY_DATA_DIR");
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn main_document_rename_away_from_latexmk_revokes_shell_trust() {
        let _env_guard = crate::paths::data_dir_env_lock();
        let root = test_dir("shell-trust-main-rename");
        std::env::set_var("OLEAFLY_DATA_DIR", &root);
        let project_id = super::create_project("Rename Trust".into()).unwrap();
        super::set_project_engine_unlocked(&project_id, "latexmk", None).unwrap();
        super::set_project_shell_escape_unlocked(&project_id, true).unwrap();
        assert!(read_meta(&project_id).unwrap().allow_shell_escape);

        super::rename_file_blocking(
            project_id.clone(),
            "main.tex".into(),
            "main.md".into(),
            None,
            None,
        )
        .unwrap();
        let markdown = read_meta(&project_id).unwrap();
        assert_eq!(markdown.engine, "markdown");
        assert!(!markdown.allow_shell_escape);
        assert!(!super::shell_escape_trust_path(&project_id)
            .unwrap()
            .exists());

        super::rename_file_blocking(
            project_id.clone(),
            "main.md".into(),
            "main.tex".into(),
            None,
            None,
        )
        .unwrap();
        super::set_project_engine_unlocked(&project_id, "latexmk", None).unwrap();
        assert!(!read_meta(&project_id).unwrap().allow_shell_escape);

        std::env::remove_var("OLEAFLY_DATA_DIR");
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn imported_project_metadata_cannot_import_shell_escape_consent() {
        let _env_guard = crate::paths::data_dir_env_lock();
        let root = test_dir("shell-trust-import-data");
        let source = test_dir("shell-trust-import-source");
        std::fs::write(
            source.join("main.tex"),
            "\\documentclass{article}\\begin{document}x\\end{document}",
        )
        .unwrap();
        std::fs::write(
            source.join("project.json"),
            r#"{
  "name": "Crafted",
  "main_doc": "main.tex",
  "engine": "latexmk",
  "allow_shell_escape": true
}"#,
        )
        .unwrap();
        std::env::set_var("OLEAFLY_DATA_DIR", &root);

        let imported =
            super::import_overleaf_project_blocking(None, &source.to_string_lossy()).unwrap();
        let meta = read_meta(&imported).unwrap();
        assert_eq!(meta.engine, super::default_engine());
        assert!(!meta.allow_shell_escape);
        let raw = std::fs::read_to_string(
            crate::paths::project_dir(&imported)
                .unwrap()
                .join("project.json"),
        )
        .unwrap();
        assert!(!raw.contains("allow_shell_escape"));

        std::env::remove_var("OLEAFLY_DATA_DIR");
        std::fs::remove_dir_all(root).unwrap();
        std::fs::remove_dir_all(source).unwrap();
    }

    #[test]
    fn recreated_project_slug_does_not_inherit_shell_escape_trust() {
        let _env_guard = crate::paths::data_dir_env_lock();
        let root = test_dir("shell-trust-identity");
        std::env::set_var("OLEAFLY_DATA_DIR", &root);
        let project_id = super::create_project("Original".into()).unwrap();
        super::set_project_engine_unlocked(&project_id, "latexmk", None).unwrap();
        super::set_project_shell_escape_unlocked(&project_id, true).unwrap();
        assert!(read_meta(&project_id).unwrap().allow_shell_escape);

        let projects = crate::paths::projects_root().unwrap();
        let original = projects.join(&project_id);
        let displaced = projects.join(format!("{project_id}-old-identity"));
        std::fs::rename(&original, &displaced).unwrap();
        std::fs::create_dir(&original).unwrap();
        std::fs::write(original.join("main.tex"), "\\documentclass{article}").unwrap();
        write_meta_at(
            &original.join("project.json"),
            &ProjectMeta {
                name: "Replacement".into(),
                engine: "latexmk".into(),
                ..ProjectMeta::default()
            },
        )
        .unwrap();
        assert!(!read_meta(&project_id).unwrap().allow_shell_escape);

        std::env::remove_var("OLEAFLY_DATA_DIR");
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn import_skip_filters_junk_and_internal_directories() {
        assert!(import_skip("__MACOSX/main.tex"));
        assert!(import_skip("figures/.DS_Store"));
        assert!(import_skip(".git/config"));
        assert!(import_skip(".oleafly/build/x.pdf"));
        assert!(!import_skip("chapters/intro.tex"));
        assert!(!import_skip("main.tex"));
    }

    #[test]
    fn tex_root_magic_comment_parses_case_and_spacing_variants() {
        assert_eq!(
            tex_root_magic_target("% !TeX root = ../thesis.tex\n").as_deref(),
            Some("../thesis.tex")
        );
        assert_eq!(
            tex_root_magic_target("%!TEX root=main.tex\n").as_deref(),
            Some("main.tex")
        );
        assert_eq!(tex_root_magic_target("% just a comment\n"), None);
    }

    #[test]
    fn normalize_relative_resolves_dots_and_rejects_escapes() {
        assert_eq!(
            normalize_relative(Path::new("chapters/../thesis.tex")).as_deref(),
            Some("thesis.tex")
        );
        assert_eq!(
            normalize_relative(Path::new("a/./b.tex")).as_deref(),
            Some("a/b.tex")
        );
        assert_eq!(normalize_relative(Path::new("../outside.tex")), None);
    }

    #[test]
    fn infer_main_document_prefers_documentclass_and_root_level_main() {
        let dir = test_dir("infer-main-scoring");
        std::fs::create_dir_all(dir.join("chapters")).unwrap();
        std::fs::write(
            dir.join("main.tex"),
            "\\documentclass{article}\n\\begin{document}Hi\\end{document}\n",
        )
        .unwrap();
        std::fs::write(dir.join("chapters/ch1.tex"), "\\section{One}\n").unwrap();
        std::fs::write(dir.join("notes.tex"), "no preamble here\n").unwrap();
        assert_eq!(infer_main_document(&dir).unwrap(), "main.tex");
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn infer_main_document_follows_a_magic_root_comment() {
        let dir = test_dir("infer-main-magic-root");
        std::fs::create_dir_all(dir.join("chapters")).unwrap();
        std::fs::write(
            dir.join("thesis.tex"),
            "\\documentclass{report}\n\\begin{document}\\end{document}\n",
        )
        .unwrap();
        std::fs::write(
            dir.join("chapters/ch1.tex"),
            "% !TeX root = ../thesis.tex\n\\chapter{One}\n",
        )
        .unwrap();
        std::fs::write(dir.join("preamble.tex"), "\\usepackage{amsmath}\n").unwrap();
        assert_eq!(infer_main_document(&dir).unwrap(), "thesis.tex");
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn infer_main_document_uses_a_lone_tex_file_as_is() {
        let dir = test_dir("infer-main-lone");
        std::fs::write(dir.join("paper.tex"), "\\documentclass{article}\n").unwrap();
        std::fs::write(dir.join("refs.bib"), "@book{k, title={T}}\n").unwrap();
        assert_eq!(infer_main_document(&dir).unwrap(), "paper.tex");
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn infer_main_document_errors_without_any_tex_file() {
        let dir = test_dir("infer-main-none");
        std::fs::write(dir.join("readme.md"), "hello\n").unwrap();
        assert!(infer_main_document(&dir).is_err());
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn flatten_single_root_folder_unwraps_a_zip_wrapper() {
        let dir = test_dir("flatten-wrapper");
        std::fs::create_dir_all(dir.join("wrapped/chapters")).unwrap();
        std::fs::write(dir.join("wrapped/main.tex"), "x").unwrap();
        std::fs::write(dir.join("wrapped/chapters/ch1.tex"), "y").unwrap();
        flatten_single_root_folder(&dir).unwrap();
        assert!(dir.join("main.tex").is_file());
        assert!(dir.join("chapters/ch1.tex").is_file());
        assert!(!dir.join("wrapped").exists());
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn flatten_single_root_folder_leaves_flat_projects_alone() {
        let dir = test_dir("flatten-flat");
        std::fs::write(dir.join("main.tex"), "x").unwrap();
        std::fs::write(dir.join("refs.bib"), "y").unwrap();
        flatten_single_root_folder(&dir).unwrap();
        assert!(dir.join("main.tex").is_file());
        assert!(dir.join("refs.bib").is_file());
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn tex_spec_round_trips_through_project_json() {
        let dir = test_dir("tex-spec-roundtrip");
        let path = dir.join("project.json");
        let mut packages = std::collections::BTreeMap::new();
        packages.insert("siunitx".to_string(), "3.3.20".to_string());
        write_meta_at(
            &path,
            &ProjectMeta {
                name: "Pinned".into(),
                main_doc: "main.tex".into(),
                engine: "latexmk".into(),
                tex: Some(TexSpec {
                    distribution: "texlive".into(),
                    distribution_label: "TeX Live 2025".into(),
                    packages,
                    recorded_at: 1.0,
                }),
                ..Default::default()
            },
        )
        .unwrap();
        let raw = std::fs::read_to_string(&path).unwrap();
        let parsed: ProjectMeta = serde_json::from_str(&raw).unwrap();
        let spec = parsed.tex.unwrap();
        assert_eq!(spec.distribution_label, "TeX Live 2025");
        assert_eq!(
            spec.packages.get("siunitx").map(String::as_str),
            Some("3.3.20")
        );
        // Projects without a pin keep project.json free of the field entirely.
        write_meta_at(
            &path,
            &ProjectMeta {
                name: "Plain".into(),
                main_doc: "main.tex".into(),
                engine: "xetex".into(),
                ..Default::default()
            },
        )
        .unwrap();
        assert!(!std::fs::read_to_string(&path).unwrap().contains("\"tex\""));
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn tex_flavor_validation_accepts_compilers_only_on_latexmk() {
        assert_eq!(
            validate_tex_flavor("latexmk", Some("pdflatex")).unwrap(),
            Some("pdflatex".to_string())
        );
        assert_eq!(
            validate_tex_flavor("latexmk", Some("xelatex")).unwrap(),
            Some("xelatex".to_string())
        );
        assert_eq!(
            validate_tex_flavor("latexmk", Some("lualatex")).unwrap(),
            Some("lualatex".to_string())
        );
        // Auto and empty clear the pin on any engine.
        assert_eq!(validate_tex_flavor("latexmk", Some("auto")).unwrap(), None);
        assert_eq!(validate_tex_flavor("latexmk", None).unwrap(), None);
        assert_eq!(validate_tex_flavor("xetex", Some("")).unwrap(), None);
        // An explicit compiler is meaningless off latexmk, and typos fail.
        assert!(validate_tex_flavor("xetex", Some("pdflatex")).is_err());
        assert!(validate_tex_flavor("latexmk", Some("pdftex")).is_err());
    }

    #[test]
    fn loaded_latexmk_metadata_normalizes_or_rejects_compiler_pins() {
        let mut normalized: ProjectMeta = serde_json::from_str(
            r#"{"name":"Paper","engine":"latexmk","tex_flavor":" lualatex "}"#,
        )
        .unwrap();
        normalize_loaded_tex_flavor(&mut normalized).unwrap();
        assert_eq!(normalized.tex_flavor.as_deref(), Some("lualatex"));

        let mut auto: ProjectMeta =
            serde_json::from_str(r#"{"name":"Paper","engine":"latexmk","tex_flavor":" auto "}"#)
                .unwrap();
        normalize_loaded_tex_flavor(&mut auto).unwrap();
        assert_eq!(auto.tex_flavor, None);

        let mut malformed: ProjectMeta =
            serde_json::from_str(r#"{"name":"Paper","engine":"latexmk","tex_flavor":"pdftex"}"#)
                .unwrap();
        let error = normalize_loaded_tex_flavor(&mut malformed).unwrap_err();
        assert!(error.contains("invalid project.json"));
        assert!(error.contains("unknown compiler: pdftex"));
    }

    #[test]
    fn loaded_non_latexmk_metadata_clears_legacy_stale_compiler_pin() {
        let mut legacy: ProjectMeta =
            serde_json::from_str(r#"{"name":"Paper","engine":"xetex","tex_flavor":"lualatex"}"#)
                .unwrap();

        normalize_loaded_tex_flavor(&mut legacy).unwrap();

        assert_eq!(legacy.tex_flavor, None);
    }
}
