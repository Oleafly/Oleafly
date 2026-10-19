//! The files a headless run works on. Every path is checked (relative, no
//! `..`, no drive letters, streams or reserved Windows names, nothing under
//! `.git`, `.oleafly` or `.private`) and every step is opened without
//! following links, so a run never reads or writes outside its folder.
//!
//! Review mode works on a copy of the project and saves what changed in a
//! review folder (`changes/`, `changes.json`, `changes.patch`); apply mode
//! writes into the project and records what it touched.
use std::collections::{BTreeMap, BTreeSet, VecDeque};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use cap_fs_ext::{DirExt, FollowSymlinks, OpenOptionsFollowExt};
use cap_std::fs::{Dir, OpenOptions};
use oleafly_agent::CancellationToken;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

use super::policy::{RunPolicy, WriteMode};
use crate::contract::{CliError, ErrorKind};

/// Errors a tool returns to the model (the text is what it reads).
#[derive(Debug)]
pub enum ToolError {
    Path(String),
    TooLarge(String),
    NotText(String),
    NotFound(String),
    Ambiguous(String),
    Io(String),
}

impl std::fmt::Display for ToolError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Path(text)
            | Self::TooLarge(text)
            | Self::NotText(text)
            | Self::NotFound(text)
            | Self::Ambiguous(text)
            | Self::Io(text) => formatter.write_str(text),
        }
    }
}

pub struct StageLimits {
    pub max_files: usize,
    pub max_bytes: u64,
    pub max_file_bytes: u64,
}

pub const STAGE_LIMITS: StageLimits = StageLimits {
    max_files: 20_000,
    max_bytes: 2 << 30,
    max_file_bytes: 256 << 20,
};
/// The largest text file a run reads or writes.
pub const MAX_TEXT_BYTES: u64 = 4 << 20;
/// The most one read returns.
pub const READ_WINDOW_BYTES: usize = 48 * 1024;
const MAX_PATH_BYTES: usize = 1024;
const MAX_MATCHES: usize = 200;
const MAX_LIST_ENTRIES: usize = 2_000;
const MAX_SEARCH_SCAN_BYTES: u64 = 256 << 20;
const MAX_PATCH_FILE_BYTES: usize = 1 << 20;
const MAX_CHANGES_JSON_BYTES: u64 = 64 << 20;
const REVIEW_VERSION: u32 = 1;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ChangeKind {
    Added,
    Modified,
    Deleted,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileChange {
    pub path: String,
    pub kind: ChangeKind,
    pub before_sha256: Option<String>,
    pub after_sha256: Option<String>,
    /// The new size (none for a deleted file).
    pub bytes: Option<u64>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChangeSet {
    /// `read`, `review` or `apply`.
    pub mode: &'static str,
    pub review_dir: Option<PathBuf>,
    pub changes: Vec<FileChange>,
    pub warnings: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
struct Baseline {
    sha256: String,
    size: u64,
}

/// `changes.json` in a review folder.
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReviewManifest {
    version: u32,
    run_id: String,
    project: PathBuf,
    baseline: BTreeMap<String, Baseline>,
    changes: Vec<FileChange>,
}

pub struct AgentWorkspace {
    project: PathBuf,
    work_root: PathBuf,
    directory: Dir,
    mode: WriteMode,
    run_id: String,
    baseline: BTreeMap<String, Baseline>,
    /// Apply mode: each touched path's content before the run (`None`: it
    /// did not exist).
    journal: Mutex<BTreeMap<String, Option<String>>>,
    warnings: Vec<String>,
}

fn lock<T>(value: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    value
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}

#[cfg(windows)]
fn is_reparse_point(metadata: &std::fs::Metadata) -> bool {
    use std::os::windows::fs::MetadataExt as _;
    metadata.file_attributes() & 0x400 != 0
}

#[cfg(not(windows))]
fn is_reparse_point(_metadata: &std::fs::Metadata) -> bool {
    false
}

fn sha256_hex(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    digest.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn sha256_file(path: &Path) -> std::io::Result<String> {
    let mut file = std::fs::File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0u8; 64 * 1024];
    loop {
        let read = file.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(hasher
        .finalize()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect())
}

/// Whether a path a tool names is acceptable, as the model wrote it.
fn path_problem(value: &str) -> Option<&'static str> {
    if value.len() > MAX_PATH_BYTES {
        return Some("That path is too long.");
    }
    if oleafly_core::portable::relative_problem(value).is_some() {
        return Some("Use a path relative to the project folder, with forward slashes, without .., drive letters or the .git and .oleafly folders.");
    }
    let components: Vec<&str> = value.split('/').collect();
    if components.iter().any(|component| {
        component.eq_ignore_ascii_case(".private") || component.eq_ignore_ascii_case(".git")
    }) {
        return Some("That folder is off limits.");
    }
    // Folders a review copy leaves out (dependencies, build output, hidden
    // folders) are out of reach in every mode, so a review never misses a
    // change made there.
    if components[..components.len().saturating_sub(1)]
        .iter()
        .any(|folder| skipped_folder(folder))
    {
        return Some(
            "Agent runs leave that folder out (build output, dependencies and hidden folders).",
        );
    }
    None
}

fn path_error(value: &str) -> ToolError {
    ToolError::Path(format!(
        "{value}: {}",
        path_problem(value).unwrap_or("That path can't be used.")
    ))
}

/// A walked file: its project-relative path (with `/`), absolute path and size.
struct WalkedFile {
    relative: String,
    absolute: PathBuf,
    size: u64,
}

#[derive(Default)]
struct WalkCounts {
    links: usize,
    cloud: usize,
    large: usize,
    unnamed: usize,
}

fn skipped_folder(name: &str) -> bool {
    oleafly_core::is_generated_directory(std::ffi::OsStr::new(name))
        || oleafly_core::exclude::is_scan_skipped_directory(name)
        || name.eq_ignore_ascii_case(".private")
}

/// Breadth-first walk of `root`'s files, skipping links, cloud-only files,
/// generated and hidden folders and files over `max_file_bytes`. `visit`
/// returns `false` to stop.
fn walk(
    root: &Path,
    max_file_bytes: u64,
    cancel: &CancellationToken,
    counts: &mut WalkCounts,
    mut visit: impl FnMut(WalkedFile) -> Result<bool, CliError>,
) -> Result<(), CliError> {
    let mut queue = VecDeque::from([String::new()]);
    while let Some(relative) = queue.pop_front() {
        if cancel.is_cancelled() {
            return Err(CliError::new(
                ErrorKind::Interrupted,
                "interrupted",
                "Stopped.",
            ));
        }
        let folder = if relative.is_empty() {
            root.to_path_buf()
        } else {
            root.join(&relative)
        };
        let Ok(entries) = std::fs::read_dir(&folder) else {
            continue;
        };
        let mut entries: Vec<_> = entries.flatten().collect();
        entries.sort_by_key(|entry| entry.file_name());
        for entry in entries {
            let Some(name) = entry.file_name().to_str().map(str::to_owned) else {
                counts.unnamed += 1;
                continue;
            };
            let Ok(metadata) = std::fs::symlink_metadata(entry.path()) else {
                continue;
            };
            if metadata.file_type().is_symlink() || is_reparse_point(&metadata) {
                counts.links += 1;
                continue;
            }
            let child = if relative.is_empty() {
                name.clone()
            } else {
                format!("{relative}/{name}")
            };
            if metadata.is_dir() {
                if !skipped_folder(&name) && path_problem(&child).is_none() {
                    queue.push_back(child);
                }
            } else if metadata.is_file() {
                if oleafly_core::is_cloud_placeholder(&metadata) {
                    counts.cloud += 1;
                    continue;
                }
                if metadata.len() > max_file_bytes {
                    counts.large += 1;
                    continue;
                }
                if path_problem(&child).is_some() {
                    counts.unnamed += 1;
                    continue;
                }
                if !visit(WalkedFile {
                    relative: child,
                    absolute: entry.path(),
                    size: metadata.len(),
                })? {
                    return Ok(());
                }
            }
        }
    }
    Ok(())
}

fn too_large(files: usize) -> CliError {
    CliError::new(
        ErrorKind::InvalidInput,
        "agent.project_too_large",
        format!("This project is too large to copy for review (more than {files} files)."),
    )
    .hint("Run again with --apply, or point -C at a smaller folder.")
}

fn io_error(error: impl std::fmt::Display) -> CliError {
    CliError::new(ErrorKind::Io, "io.failed", error.to_string())
}

/// Copies the project into `work` and returns the copy's baseline.
fn stage(
    project: &Path,
    work: &Path,
    limits: &StageLimits,
    cancel: &CancellationToken,
) -> Result<(BTreeMap<String, Baseline>, Vec<String>), CliError> {
    let mut counts = WalkCounts::default();
    let mut planned = Vec::new();
    let mut total = 0u64;
    walk(
        project,
        limits.max_file_bytes,
        cancel,
        &mut counts,
        |file| {
            total += file.size;
            planned.push(file);
            if planned.len() > limits.max_files || total > limits.max_bytes {
                return Err(too_large(limits.max_files.min(planned.len())));
            }
            Ok(true)
        },
    )?;
    let mut baseline = BTreeMap::new();
    for file in planned {
        if cancel.is_cancelled() {
            return Err(CliError::new(
                ErrorKind::Interrupted,
                "interrupted",
                "Stopped.",
            ));
        }
        let destination = work.join(&file.relative);
        if let Some(parent) = destination.parent() {
            std::fs::create_dir_all(parent).map_err(io_error)?;
        }
        std::fs::copy(&file.absolute, &destination).map_err(io_error)?;
        let sha256 = sha256_file(&destination).map_err(io_error)?;
        let size = std::fs::metadata(&destination).map_err(io_error)?.len();
        baseline.insert(file.relative, Baseline { sha256, size });
    }
    let mut warnings = Vec::new();
    if counts.links > 0 {
        warnings.push(format!("Skipped {} links.", counts.links));
    }
    if counts.cloud > 0 {
        warnings.push(format!(
            "Skipped {} files that are only in the cloud.",
            counts.cloud
        ));
    }
    if counts.large > 0 {
        warnings.push(format!(
            "Skipped {} files larger than 256 MiB.",
            counts.large
        ));
    }
    Ok((baseline, warnings))
}

fn open_dir(path: &Path) -> Result<Dir, CliError> {
    Dir::open_ambient_dir(path, cap_std::ambient_authority()).map_err(io_error)
}

fn real_folder(path: &Path) -> Result<PathBuf, CliError> {
    let metadata = std::fs::symlink_metadata(path).map_err(|_| {
        CliError::new(
            ErrorKind::InvalidInput,
            "project.invalid_input",
            format!("{} can't be opened.", path.display()),
        )
    })?;
    if !metadata.is_dir() {
        return Err(CliError::new(
            ErrorKind::InvalidInput,
            "project.invalid_input",
            format!("{} isn't a folder.", path.display()),
        ));
    }
    dunce::canonicalize(path).map_err(io_error)
}

impl AgentWorkspace {
    /// Opens the run's folder: the project itself, or (review mode) a copy
    /// of it inside the review folder.
    pub fn open(
        project: &Path,
        policy: &RunPolicy,
        limits: &StageLimits,
        cancel: &CancellationToken,
    ) -> Result<Self, CliError> {
        let project = real_folder(project)?;
        let run_id = match &policy.mode {
            WriteMode::Review { dir } => dir
                .file_name()
                .map(|name| name.to_string_lossy().into_owned())
                .unwrap_or_default(),
            _ => String::new(),
        };
        let (work_root, baseline, warnings) = match &policy.mode {
            WriteMode::ReadOnly | WriteMode::Apply => {
                (project.clone(), BTreeMap::new(), Vec::new())
            }
            WriteMode::Review { dir } => {
                std::fs::create_dir_all(dir).map_err(io_error)?;
                let work = dir.join("workspace");
                std::fs::create_dir(&work).map_err(io_error)?;
                let staged = stage(&project, &work, limits, cancel);
                let (baseline, warnings) = match staged {
                    Ok(staged) => staged,
                    Err(error) => {
                        let _ = std::fs::remove_dir_all(dir);
                        return Err(error);
                    }
                };
                (
                    dunce::canonicalize(&work).map_err(io_error)?,
                    baseline,
                    warnings,
                )
            }
        };
        let directory = open_dir(&work_root)?;
        Ok(Self {
            project,
            work_root,
            directory,
            mode: policy.mode.clone(),
            run_id,
            baseline,
            journal: Mutex::new(BTreeMap::new()),
            warnings,
        })
    }

    pub fn work_root(&self) -> &Path {
        &self.work_root
    }

    pub fn project(&self) -> &Path {
        &self.project
    }

    /// Warnings from staging (links and cloud-only files left out).
    pub fn warnings(&self) -> &[String] {
        &self.warnings
    }

    /// The path, if a tool may use it.
    pub fn checked(&self, value: &str) -> Result<PathBuf, ToolError> {
        if path_problem(value).is_some() {
            return Err(path_error(value));
        }
        Ok(PathBuf::from(value))
    }

    fn writable(&self) -> Result<(), ToolError> {
        match self.mode {
            WriteMode::ReadOnly => Err(ToolError::Path("This run can't change files.".into())),
            _ => Ok(()),
        }
    }

    /// The folder holding `path` (opened step by step without following
    /// links) and the file name.
    fn parent(&self, path: &Path, create: bool) -> Result<(Dir, PathBuf), ToolError> {
        let mut directory = self
            .directory
            .try_clone()
            .map_err(|error| ToolError::Io(error.to_string()))?;
        let components: Vec<_> = path.components().collect();
        let (name, parents) = components
            .split_last()
            .ok_or_else(|| ToolError::Path("Name a file.".into()))?;
        for component in parents {
            let step = Path::new(component.as_os_str());
            if create {
                match directory.create_dir(step) {
                    Ok(()) => {}
                    Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {}
                    Err(error) => {
                        return Err(ToolError::Io(format!(
                            "The folder could not be created: {error}"
                        )))
                    }
                }
            }
            directory = directory.open_dir_nofollow(step).map_err(|error| {
                if error.kind() == std::io::ErrorKind::NotFound {
                    ToolError::NotFound(format!("{} doesn't exist.", path.display()))
                } else {
                    ToolError::Path(format!(
                        "{}: the path goes through a link or a folder that can't be opened.",
                        path.display()
                    ))
                }
            })?;
        }
        Ok((directory, PathBuf::from(name.as_os_str())))
    }

    fn read_bytes(&self, value: &str, max: u64) -> Result<Vec<u8>, ToolError> {
        let path = self.checked(value)?;
        let (directory, name) = self.parent(&path, false)?;
        let mut options = OpenOptions::new();
        options.read(true).follow(FollowSymlinks::No);
        let file = directory.open_with(&name, &options).map_err(|error| {
            if error.kind() == std::io::ErrorKind::NotFound {
                ToolError::NotFound(format!("{value} doesn't exist."))
            } else {
                ToolError::Path(format!("{value} can't be opened (it may be a link)."))
            }
        })?;
        let metadata = file
            .metadata()
            .map_err(|error| ToolError::Io(error.to_string()))?;
        if !metadata.is_file() {
            return Err(ToolError::Path(format!("{value} isn't a file.")));
        }
        if metadata.len() > max {
            return Err(ToolError::TooLarge(format!(
                "{value} is larger than {} MiB, so it can't be read here.",
                max >> 20
            )));
        }
        let mut bytes = Vec::new();
        file.take(max + 1)
            .read_to_end(&mut bytes)
            .map_err(|error| ToolError::Io(error.to_string()))?;
        if bytes.len() as u64 > max {
            return Err(ToolError::TooLarge(format!(
                "{value} is too large to read."
            )));
        }
        Ok(bytes)
    }

    fn read_string(&self, value: &str) -> Result<String, ToolError> {
        let bytes = self.read_bytes(value, MAX_TEXT_BYTES)?;
        String::from_utf8(bytes)
            .map_err(|_| ToolError::NotText(format!("{value} isn't UTF-8 text.")))
    }

    /// Up to `limit` bytes of a text file from `offset`, with `nextOffset`
    /// when there is more.
    pub fn read_text(&self, path: &str, offset: usize, limit: usize) -> Result<Value, ToolError> {
        let content = self.read_string(path)?;
        if offset > content.len() || !content.is_char_boundary(offset) {
            return Err(ToolError::Path(
                "Use an offset from an earlier read of this file.".into(),
            ));
        }
        let mut end = offset
            .saturating_add(limit.clamp(1, READ_WINDOW_BYTES))
            .min(content.len());
        while !content.is_char_boundary(end) {
            end -= 1;
        }
        Ok(json!({
            "path": path,
            "content": &content[offset..end],
            "offset": offset,
            "nextOffset": (end < content.len()).then_some(end),
            "totalBytes": content.len(),
            "truncated": end < content.len(),
        }))
    }

    /// Files and folders under `path`, up to `max_depth` (1–5) levels.
    pub fn list(&self, path: &str, max_depth: usize) -> Result<Value, ToolError> {
        let start = if path.is_empty() || path == "." {
            None
        } else {
            Some(self.checked(path.trim_end_matches('/'))?)
        };
        let max_depth = max_depth.clamp(1, 5);
        let mut directory = self
            .directory
            .try_clone()
            .map_err(|error| ToolError::Io(error.to_string()))?;
        if let Some(start) = &start {
            for component in start.components() {
                directory = directory
                    .open_dir_nofollow(Path::new(component.as_os_str()))
                    .map_err(|_| {
                        ToolError::NotFound(format!("{path} isn't a folder in this project."))
                    })?;
            }
        }
        let prefix = start
            .as_ref()
            .map(|start| format!("{}/", start.to_string_lossy().replace('\\', "/")))
            .unwrap_or_default();
        let mut entries = Vec::new();
        let mut truncated = false;
        let mut queue = VecDeque::from([(directory, String::new(), 1usize)]);
        'outer: while let Some((directory, relative, depth)) = queue.pop_front() {
            let mut children: Vec<(String, bool)> = Vec::new();
            for entry in directory
                .entries()
                .map_err(|error| ToolError::Io(error.to_string()))?
                .flatten()
            {
                let Some(name) = entry.file_name().to_str().map(str::to_owned) else {
                    continue;
                };
                let Ok(kind) = entry.file_type() else {
                    continue;
                };
                if kind.is_symlink() {
                    continue;
                }
                if kind.is_dir() && skipped_folder(&name) {
                    continue;
                }
                children.push((name, kind.is_dir()));
            }
            children.sort();
            for (name, is_dir) in children {
                if entries.len() >= MAX_LIST_ENTRIES {
                    truncated = true;
                    break 'outer;
                }
                let child = format!("{relative}{name}");
                if is_dir {
                    entries.push(format!("{prefix}{child}/"));
                    if depth < max_depth {
                        if let Ok(next) = directory.open_dir_nofollow(Path::new(&name)) {
                            queue.push_back((next, format!("{child}/"), depth + 1));
                        }
                    }
                } else {
                    entries.push(format!("{prefix}{child}"));
                }
            }
        }
        Ok(json!({"path": path, "entries": entries, "truncated": truncated}))
    }

    /// Lines that contain `query` (or match it as a regular expression),
    /// in the text files under `path`; at most 200.
    pub fn search(&self, query: &str, regex: bool, path: &str) -> Result<Value, ToolError> {
        if query.is_empty() || query.len() > 1024 {
            return Err(ToolError::Path(
                "Search for 1 to 1024 bytes of text.".into(),
            ));
        }
        let pattern = if regex {
            Some(
                regex::RegexBuilder::new(query)
                    .size_limit(1 << 20)
                    .build()
                    .map_err(|error| {
                        ToolError::Path(format!("That regular expression doesn't parse: {error}"))
                    })?,
            )
        } else {
            None
        };
        let base = if path.is_empty() || path == "." {
            self.work_root.clone()
        } else {
            self.work_root
                .join(self.checked(path.trim_end_matches('/'))?)
        };
        let prefix = base
            .strip_prefix(&self.work_root)
            .map(|rest| rest.to_string_lossy().replace('\\', "/"))
            .unwrap_or_default();
        let mut matches = Vec::new();
        let mut skipped = 0usize;
        let mut scanned = 0u64;
        let mut truncated = false;
        let mut counts = WalkCounts::default();
        let token = CancellationToken::new();
        let walked = walk(&base, MAX_TEXT_BYTES, &token, &mut counts, |file| {
            scanned += file.size;
            if scanned > MAX_SEARCH_SCAN_BYTES {
                truncated = true;
                return Ok(false);
            }
            let relative = if prefix.is_empty() {
                file.relative
            } else {
                format!("{prefix}/{}", file.relative)
            };
            let Ok(content) = self.read_string(&relative) else {
                skipped += 1;
                return Ok(true);
            };
            for (index, line) in content.lines().enumerate() {
                let hit = match &pattern {
                    Some(pattern) => pattern.is_match(line),
                    None => line.contains(query),
                };
                if hit {
                    let text: String = line.chars().take(400).collect();
                    matches.push(json!({"path": relative, "line": index + 1, "text": text}));
                    if matches.len() >= MAX_MATCHES {
                        truncated = true;
                        return Ok(false);
                    }
                }
            }
            Ok(true)
        });
        walked.map_err(|error| ToolError::Io(error.message))?;
        Ok(json!({
            "matches": matches,
            "truncated": truncated,
            "skippedFiles": skipped + counts.large,
        }))
    }

    /// Records a path's content before its first change (apply mode).
    fn journal(&self, value: &str, path: &Path) {
        if self.mode != WriteMode::Apply {
            return;
        }
        let mut journal = lock(&self.journal);
        if journal.contains_key(value) {
            return;
        }
        let before = sha256_file(&self.work_root.join(path)).ok();
        journal.insert(value.to_owned(), before);
    }

    /// Writes a text file in one step (a staging file renamed over it).
    pub fn write_text(&self, path: &str, content: &str) -> Result<Value, ToolError> {
        self.writable()?;
        if content.len() as u64 > MAX_TEXT_BYTES {
            return Err(ToolError::TooLarge(
                "Write at most 4 MiB in one file.".into(),
            ));
        }
        let checked = self.checked(path)?;
        let (directory, name) = self.parent(&checked, true)?;
        let existed = match directory.symlink_metadata(&name) {
            Ok(metadata) if metadata.is_symlink() || !metadata.is_file() => {
                return Err(ToolError::Path(format!(
                    "{path} isn't a regular file (it may be a link or a folder)."
                )));
            }
            Ok(_) => true,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => false,
            Err(error) => return Err(ToolError::Io(error.to_string())),
        };
        self.journal(path, &checked);
        let staging = format!(".agent-write-{:032x}", rand::random::<u128>());
        let mut options = OpenOptions::new();
        options
            .write(true)
            .create_new(true)
            .follow(FollowSymlinks::No);
        let result = (|| {
            let mut file = directory
                .open_with(&staging, &options)
                .map_err(|error| ToolError::Io(format!("{path} could not be written: {error}")))?;
            file.write_all(content.as_bytes())
                .map_err(|error| ToolError::Io(error.to_string()))?;
            file.sync_all()
                .map_err(|error| ToolError::Io(error.to_string()))?;
            drop(file);
            directory
                .rename(&staging, &directory, &name)
                .map_err(|error| ToolError::Io(format!("{path} could not be saved: {error}")))
        })();
        if result.is_err() {
            let _ = directory.remove_file(&staging);
        }
        result?;
        Ok(json!({"path": path, "bytes": content.len(), "created": !existed}))
    }

    /// Replaces `old` with `new` in a text file: exactly once, or every time
    /// with `replace_all`.
    pub fn edit_text(
        &self,
        path: &str,
        old: &str,
        new: &str,
        replace_all: bool,
    ) -> Result<Value, ToolError> {
        self.writable()?;
        if old.is_empty() {
            return Err(ToolError::Path("Give the text to replace.".into()));
        }
        let content = self.read_string(path)?;
        let count = content.matches(old).count();
        if count == 0 {
            return Err(ToolError::NotFound(format!(
                "The text to replace isn't in {path}."
            )));
        }
        if count > 1 && !replace_all {
            return Err(ToolError::Ambiguous(format!(
                "The text appears {count} times in {path}. Include more of the surrounding text, or set replace_all."
            )));
        }
        let updated = if replace_all {
            content.replace(old, new)
        } else {
            content.replacen(old, new, 1)
        };
        self.write_text(path, &updated)?;
        Ok(json!({"path": path, "replacements": if replace_all { count } else { 1 }}))
    }

    pub fn delete(&self, path: &str) -> Result<Value, ToolError> {
        self.writable()?;
        let checked = self.checked(path)?;
        let (directory, name) = self.parent(&checked, false)?;
        match directory.symlink_metadata(&name) {
            Ok(metadata) if metadata.is_file() && !metadata.is_symlink() => {}
            Ok(_) => return Err(ToolError::Path(format!("{path} isn't a regular file."))),
            Err(_) => return Err(ToolError::NotFound(format!("{path} doesn't exist."))),
        }
        self.journal(path, &checked);
        directory
            .remove_file(&name)
            .map_err(|error| ToolError::Io(format!("{path} could not be deleted: {error}")))?;
        Ok(json!({"path": path, "deleted": true}))
    }

    /// Ends the run: what changed, and (review mode) the saved review. The
    /// working copy is deleted unless `keep_workspace`.
    pub fn finish(self, keep_workspace: bool) -> Result<ChangeSet, CliError> {
        let set = self.collect()?;
        let review = matches!(self.mode, WriteMode::Review { .. });
        if review && !keep_workspace {
            let work_root = self.work_root.clone();
            // The folder handle closes first (Windows can't delete an open folder).
            drop(self);
            std::fs::remove_dir_all(&work_root).map_err(io_error)?;
        }
        Ok(set)
    }

    /// [`Self::finish`] for a workspace the run's tools share: waits up to
    /// `wait` for the last tool to let go. A tool still running then (a long
    /// search, say) keeps the working copy in the review folder.
    pub fn finish_shared(
        workspace: Arc<Self>,
        keep_workspace: bool,
        wait: Duration,
    ) -> Result<ChangeSet, CliError> {
        let deadline = Instant::now() + wait;
        let mut shared = workspace;
        loop {
            match Arc::try_unwrap(shared) {
                Ok(owned) => return owned.finish(keep_workspace),
                Err(still) if Instant::now() < deadline => {
                    shared = still;
                    std::thread::sleep(Duration::from_millis(50));
                }
                Err(still) => {
                    let mut set = still.collect()?;
                    if matches!(still.mode, WriteMode::Review { .. }) && !keep_workspace {
                        set.warnings
                            .push("A tool was still running, so the working copy stays in the review folder.".into());
                    }
                    return Ok(set);
                }
            }
        }
    }

    /// What changed, with the review saved (review mode).
    fn collect(&self) -> Result<ChangeSet, CliError> {
        match &self.mode {
            WriteMode::ReadOnly => Ok(ChangeSet {
                mode: "read",
                review_dir: None,
                changes: Vec::new(),
                warnings: self.warnings.clone(),
            }),
            WriteMode::Apply => {
                let journal = std::mem::take(&mut *lock(&self.journal));
                let mut changes = Vec::new();
                for (path, before) in journal {
                    let after_path = self.work_root.join(&path);
                    let after = sha256_file(&after_path).ok();
                    let kind = match (&before, &after) {
                        (None, None) => continue,
                        (None, Some(_)) => ChangeKind::Added,
                        (Some(_), None) => ChangeKind::Deleted,
                        (Some(before), Some(after)) if before == after => continue,
                        (Some(_), Some(_)) => ChangeKind::Modified,
                    };
                    let bytes = after
                        .as_ref()
                        .and_then(|_| std::fs::metadata(&after_path).ok())
                        .map(|metadata| metadata.len());
                    changes.push(FileChange {
                        path,
                        kind,
                        before_sha256: before,
                        after_sha256: after,
                        bytes,
                    });
                }
                Ok(ChangeSet {
                    mode: "apply",
                    review_dir: None,
                    changes,
                    warnings: self.warnings.clone(),
                })
            }
            WriteMode::Review { dir } => self.save_review(dir),
        }
    }

    fn save_review(&self, dir: &Path) -> Result<ChangeSet, CliError> {
        let mut current: BTreeMap<String, Baseline> = BTreeMap::new();
        let mut counts = WalkCounts::default();
        let token = CancellationToken::new();
        walk(&self.work_root, u64::MAX, &token, &mut counts, |file| {
            let sha256 = sha256_file(&file.absolute).map_err(io_error)?;
            current.insert(
                file.relative,
                Baseline {
                    sha256,
                    size: file.size,
                },
            );
            Ok(true)
        })?;
        let mut changes = Vec::new();
        for (path, now) in &current {
            match self.baseline.get(path) {
                Some(before) if before.sha256 == now.sha256 => {}
                Some(before) => changes.push(FileChange {
                    path: path.clone(),
                    kind: ChangeKind::Modified,
                    before_sha256: Some(before.sha256.clone()),
                    after_sha256: Some(now.sha256.clone()),
                    bytes: Some(now.size),
                }),
                None => changes.push(FileChange {
                    path: path.clone(),
                    kind: ChangeKind::Added,
                    before_sha256: None,
                    after_sha256: Some(now.sha256.clone()),
                    bytes: Some(now.size),
                }),
            }
        }
        for (path, before) in &self.baseline {
            if !current.contains_key(path) {
                changes.push(FileChange {
                    path: path.clone(),
                    kind: ChangeKind::Deleted,
                    before_sha256: Some(before.sha256.clone()),
                    after_sha256: None,
                    bytes: None,
                });
            }
        }
        changes.sort_by(|left, right| left.path.cmp(&right.path));
        let changed_root = dir.join("changes");
        let mut patch = String::new();
        for change in &changes {
            if change.kind != ChangeKind::Deleted {
                let destination = changed_root.join(&change.path);
                if let Some(parent) = destination.parent() {
                    std::fs::create_dir_all(parent).map_err(io_error)?;
                }
                std::fs::copy(self.work_root.join(&change.path), &destination).map_err(io_error)?;
            }
            patch.push_str(&self.patch_for(change));
        }
        let manifest = ReviewManifest {
            version: REVIEW_VERSION,
            run_id: self.run_id.clone(),
            project: self.project.clone(),
            baseline: self.baseline.clone(),
            changes: changes.clone(),
        };
        let text = serde_json::to_vec_pretty(&manifest).map_err(io_error)?;
        oleafly_core::atomic::write_atomic(&dir.join("changes.json"), &text).map_err(io_error)?;
        oleafly_core::atomic::write_atomic(&dir.join("changes.patch"), patch.as_bytes())
            .map_err(io_error)?;
        Ok(ChangeSet {
            mode: "review",
            review_dir: Some(dir.to_path_buf()),
            changes,
            warnings: self.warnings.clone(),
        })
    }

    /// One file's part of `changes.patch`: a unified diff, or a note for
    /// binary and large files.
    fn patch_for(&self, change: &FileChange) -> String {
        let text = |path: &Path| -> Option<String> {
            let metadata = std::fs::metadata(path).ok()?;
            if metadata.len() as usize > MAX_PATCH_FILE_BYTES {
                return None;
            }
            String::from_utf8(std::fs::read(path).ok()?).ok()
        };
        let before = match change.kind {
            ChangeKind::Added => Some(String::new()),
            _ => {
                let original = self.project.join(&change.path);
                let unchanged = sha256_file(&original).ok() == change.before_sha256;
                if unchanged {
                    text(&original)
                } else {
                    return format!(
                        "# {}: the project copy changed during the run, so no diff is shown.\n",
                        change.path
                    );
                }
            }
        };
        let after = match change.kind {
            ChangeKind::Deleted => Some(String::new()),
            _ => text(&self.work_root.join(&change.path)),
        };
        let (Some(before), Some(after)) = (before, after) else {
            return format!("Binary files a/{0} and b/{0} differ\n", change.path);
        };
        let old_header = match change.kind {
            ChangeKind::Added => "/dev/null".to_string(),
            _ => format!("a/{}", change.path),
        };
        let new_header = match change.kind {
            ChangeKind::Deleted => "/dev/null".to_string(),
            _ => format!("b/{}", change.path),
        };
        similar::TextDiff::from_lines(&before, &after)
            .unified_diff()
            .context_radius(3)
            .header(&old_header, &new_header)
            .to_string()
    }
}

fn not_a_review() -> CliError {
    CliError::new(
        ErrorKind::InvalidInput,
        "agent.not_a_review",
        "This folder isn't a review saved for this project.",
    )
}

fn conflict(paths: &[String]) -> CliError {
    let listed: Vec<&str> = paths.iter().take(20).map(String::as_str).collect();
    let more = paths.len().saturating_sub(listed.len());
    let mut message = format!(
        "These files changed since the review: {}",
        listed.join(", ")
    );
    if more > 0 {
        message.push_str(&format!(", and {more} more"));
    }
    message.push('.');
    CliError::new(ErrorKind::Conflict, "agent.apply_conflict", message)
        .hint("Run the agent again on the current files.")
        .details(json!({"paths": paths}))
}

/// The project-side sha256 of `path`, `None` when it doesn't exist. A link
/// or a folder in the way is an error.
fn project_sha(project: &Path, path: &str) -> Result<Option<String>, CliError> {
    let target = project.join(path);
    match std::fs::symlink_metadata(&target) {
        Ok(metadata) if metadata.is_file() && !metadata.file_type().is_symlink() => {
            sha256_file(&target).map(Some).map_err(io_error)
        }
        Ok(_) => Err(CliError::new(
            ErrorKind::UnsafePath,
            "project.unsafe_path",
            format!("{path} in the project isn't a regular file."),
        )),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(io_error(error)),
    }
}

/// Applies a saved review to the project, with the app's conflict rule: a
/// file that changed since the review stops the whole apply before
/// anything is written. `dry_run` checks only.
pub fn apply_review(
    review_dir: &Path,
    project: &Path,
    dry_run: bool,
) -> Result<Vec<FileChange>, CliError> {
    let manifest_path = review_dir.join("changes.json");
    let metadata = std::fs::symlink_metadata(&manifest_path).map_err(|_| not_a_review())?;
    if !metadata.is_file() || metadata.len() > MAX_CHANGES_JSON_BYTES {
        return Err(not_a_review());
    }
    let manifest: ReviewManifest =
        serde_json::from_slice(&std::fs::read(&manifest_path).map_err(io_error)?)
            .map_err(|_| not_a_review())?;
    let project = real_folder(project)?;
    if manifest.version != REVIEW_VERSION
        || dunce::canonicalize(&manifest.project).ok().as_deref() != Some(project.as_path())
    {
        return Err(not_a_review());
    }
    let mut seen = BTreeSet::new();
    for change in &manifest.changes {
        if path_problem(&change.path).is_some() || !seen.insert(change.path.clone()) {
            return Err(not_a_review());
        }
    }
    let mut conflicts = Vec::new();
    let mut pending = Vec::new();
    for change in &manifest.changes {
        let now = project_sha(&project, &change.path)?;
        let ok = match change.kind {
            ChangeKind::Added => now.is_none() || now == change.after_sha256,
            ChangeKind::Modified | ChangeKind::Deleted => {
                now == change.before_sha256 || now == change.after_sha256
            }
        };
        if !ok {
            conflicts.push(change.path.clone());
        } else if now != change.after_sha256 {
            pending.push(change.clone());
        }
    }
    if !conflicts.is_empty() {
        return Err(conflict(&conflicts));
    }
    // Every new file must be the one the review saved.
    for change in &pending {
        if change.kind == ChangeKind::Deleted {
            continue;
        }
        let saved = review_dir.join("changes").join(&change.path);
        if sha256_file(&saved).ok() != change.after_sha256 {
            return Err(CliError::new(
                ErrorKind::InvalidInput,
                "agent.not_a_review",
                format!(
                    "The saved copy of {} doesn't match the review.",
                    change.path
                ),
            ));
        }
    }
    if dry_run {
        return Ok(manifest.changes);
    }
    let directory = open_dir(&project)?;
    for change in &pending {
        let path = Path::new(&change.path);
        let components: Vec<_> = path.components().collect();
        let (name, parents) = components.split_last().ok_or_else(not_a_review)?;
        let mut folder = directory.try_clone().map_err(io_error)?;
        for component in parents {
            let step = Path::new(component.as_os_str());
            if change.kind != ChangeKind::Deleted {
                match folder.create_dir(step) {
                    Ok(()) => {}
                    Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {}
                    Err(error) => return Err(io_error(error)),
                }
            }
            folder = folder.open_dir_nofollow(step).map_err(|_| {
                CliError::new(
                    ErrorKind::UnsafePath,
                    "project.unsafe_path",
                    format!("{} goes through a link.", change.path),
                )
            })?;
        }
        let name = Path::new(name.as_os_str());
        if change.kind == ChangeKind::Deleted {
            folder.remove_file(name).map_err(io_error)?;
            continue;
        }
        let bytes =
            std::fs::read(review_dir.join("changes").join(&change.path)).map_err(io_error)?;
        if sha256_hex(&bytes).as_str() != change.after_sha256.as_deref().unwrap_or_default() {
            return Err(not_a_review());
        }
        let staging = format!(".agent-write-{:032x}", rand::random::<u128>());
        let mut options = OpenOptions::new();
        options
            .write(true)
            .create_new(true)
            .follow(FollowSymlinks::No);
        let written = (|| -> std::io::Result<()> {
            let mut file = folder.open_with(&staging, &options)?;
            file.write_all(&bytes)?;
            file.sync_all()?;
            drop(file);
            folder.rename(&staging, &folder, name)
        })();
        if let Err(error) = written {
            let _ = folder.remove_file(&staging);
            return Err(io_error(error));
        }
    }
    Ok(manifest.changes)
}

#[cfg(test)]
mod tests {
    use super::super::policy::AllowSet;
    use super::*;
    use crate::contract::Exit;

    fn token() -> CancellationToken {
        CancellationToken::new()
    }

    fn policy_for(mode: WriteMode) -> RunPolicy {
        RunPolicy {
            allow: AllowSet {
                write: true,
                ..AllowSet::default()
            },
            mode,
            question: false,
        }
    }

    fn project_with(files: &[(&str, &str)]) -> tempfile::TempDir {
        let project = tempfile::tempdir().unwrap();
        for (path, content) in files {
            let target = project.path().join(path);
            std::fs::create_dir_all(target.parent().unwrap()).unwrap();
            std::fs::write(target, content).unwrap();
        }
        project
    }

    fn review_workspace_with(
        files: &[(&str, &str)],
    ) -> (tempfile::TempDir, tempfile::TempDir, AgentWorkspace) {
        let project = project_with(files);
        let reviews = tempfile::tempdir().unwrap();
        let workspace = AgentWorkspace::open(
            project.path(),
            &policy_for(WriteMode::Review {
                dir: reviews.path().join("run-1"),
            }),
            &STAGE_LIMITS,
            &token(),
        )
        .unwrap();
        (project, reviews, workspace)
    }

    #[test]
    fn paths_that_escape_or_hit_windows_hazards_are_refused() {
        let (_project, _reviews, ws) = review_workspace_with(&[("main.tex", "a")]);
        for bad in [
            "C:/x",
            "D:",
            r"\\?\C:\x",
            r"..\a",
            "a/../b",
            "/etc/passwd",
            "notes.md:stream",
            "CON",
            "nul.txt",
            "trailing.",
            "space ",
            ".git/config",
            ".oleafly/x",
            "sub/.private/key",
            "sub/.git/hooks/post-commit",
            "a\0b",
            "",
        ] {
            assert!(
                matches!(ws.checked(bad), Err(ToolError::Path(_))),
                "{bad:?}"
            );
        }
        for good in ["chapters/intro.tex", "figures/plot 1.png", "Thèse/ch1.tex"] {
            assert!(ws.checked(good).is_ok(), "{good}");
        }
        assert!(ws.checked(&"a/".repeat(600)).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn a_symlink_out_of_the_project_is_neither_read_nor_written() {
        let outside = tempfile::tempdir().unwrap();
        std::fs::write(outside.path().join("secret.txt"), "private").unwrap();
        let project = project_with(&[("main.tex", "a")]);
        std::os::unix::fs::symlink(
            outside.path().join("secret.txt"),
            project.path().join("link.txt"),
        )
        .unwrap();
        std::os::unix::fs::symlink(outside.path(), project.path().join("folder")).unwrap();
        let ws = AgentWorkspace::open(
            project.path(),
            &policy_for(WriteMode::Apply),
            &STAGE_LIMITS,
            &token(),
        )
        .unwrap();
        assert!(ws.read_text("link.txt", 0, 100).is_err());
        assert!(ws.read_text("folder/secret.txt", 0, 100).is_err());
        assert!(ws.write_text("link.txt", "x").is_err());
        assert!(ws.write_text("folder/new.txt", "x").is_err());
        assert_eq!(
            std::fs::read_to_string(outside.path().join("secret.txt")).unwrap(),
            "private"
        );
        assert!(!outside.path().join("new.txt").exists());
        // Review mode leaves links out of the copy.
        let reviews = tempfile::tempdir().unwrap();
        let review = AgentWorkspace::open(
            project.path(),
            &policy_for(WriteMode::Review {
                dir: reviews.path().join("r"),
            }),
            &STAGE_LIMITS,
            &token(),
        )
        .unwrap();
        assert!(review
            .warnings()
            .iter()
            .any(|warning| warning.contains("links")));
        assert!(matches!(
            review.read_text("link.txt", 0, 10),
            Err(ToolError::NotFound(_))
        ));
    }

    #[test]
    fn review_mode_stages_a_copy_and_leaves_the_project_alone() {
        let (project, _reviews, ws) =
            review_workspace_with(&[("main.tex", "a\n"), (".git/HEAD", "ref")]);
        ws.write_text("main.tex", "b\n").unwrap();
        assert!(!ws.work_root().join(".git").exists());
        let set = ws.finish(false).unwrap();
        assert_eq!(
            std::fs::read_to_string(project.path().join("main.tex")).unwrap(),
            "a\n"
        );
        let review = set.review_dir.unwrap();
        let patch = std::fs::read_to_string(review.join("changes.patch")).unwrap();
        assert!(patch.contains("--- a/main.tex"), "{patch}");
        assert!(patch.contains("+b"));
        assert!(review.join("changes/main.tex").exists() && !review.join("workspace").exists());
        assert_eq!(set.changes[0].kind, ChangeKind::Modified);
    }

    #[test]
    fn apply_mode_writes_atomically_into_the_project() {
        let project = project_with(&[("main.tex", "a")]);
        let ws = AgentWorkspace::open(
            project.path(),
            &policy_for(WriteMode::Apply),
            &STAGE_LIMITS,
            &token(),
        )
        .unwrap();
        ws.write_text("main.tex", "b").unwrap();
        ws.write_text("chapters/new.tex", "new").unwrap();
        ws.delete("main.tex").unwrap();
        ws.write_text("main.tex", "c").unwrap();
        let set = ws.finish(false).unwrap();
        assert_eq!(
            std::fs::read_to_string(project.path().join("main.tex")).unwrap(),
            "c"
        );
        let kinds: Vec<(String, ChangeKind)> = set
            .changes
            .iter()
            .map(|change| (change.path.clone(), change.kind))
            .collect();
        assert_eq!(
            kinds,
            [
                ("chapters/new.tex".to_string(), ChangeKind::Added),
                ("main.tex".to_string(), ChangeKind::Modified)
            ]
        );
        let leftovers: Vec<_> = std::fs::read_dir(project.path())
            .unwrap()
            .flatten()
            .filter(|entry| {
                entry
                    .file_name()
                    .to_string_lossy()
                    .starts_with(".agent-write-")
            })
            .collect();
        assert!(leftovers.is_empty());
    }

    #[test]
    fn an_oversized_project_is_refused_with_the_apply_hint() {
        let project = tempfile::tempdir().unwrap();
        for index in 0..6 {
            std::fs::write(project.path().join(format!("{index}.tex")), "x").unwrap();
        }
        let reviews = tempfile::tempdir().unwrap();
        let error = AgentWorkspace::open(
            project.path(),
            &policy_for(WriteMode::Review {
                dir: reviews.path().join("r"),
            }),
            &StageLimits {
                max_files: 5,
                ..STAGE_LIMITS
            },
            &token(),
        )
        .err()
        .unwrap();
        assert!(error.hint.as_deref().unwrap().contains("--apply"));
        assert_eq!(error.code, "agent.project_too_large");
        assert_eq!(error.exit(), Exit::Project);
        assert!(!reviews.path().join("r").exists());
    }

    #[test]
    fn reading_a_file_over_4_mib_is_refused_and_search_skips_it() {
        let big = "needle\n".repeat((5 << 20) / 7);
        let project = project_with(&[("big.txt", &big), ("small.txt", "a needle here\n")]);
        let ws = AgentWorkspace::open(
            project.path(),
            &policy_for(WriteMode::ReadOnly),
            &STAGE_LIMITS,
            &token(),
        )
        .unwrap();
        assert!(matches!(
            ws.read_text("big.txt", 0, 100),
            Err(ToolError::TooLarge(_))
        ));
        let found = ws.search("needle", false, "").unwrap();
        let paths: Vec<&str> = found["matches"]
            .as_array()
            .unwrap()
            .iter()
            .map(|hit| hit["path"].as_str().unwrap())
            .collect();
        assert_eq!(paths, ["small.txt"]);
        let windowed = ws.read_text("small.txt", 0, 2).unwrap();
        assert_eq!(windowed["content"], "a ");
        assert_eq!(windowed["nextOffset"], 2);
    }

    #[test]
    fn regex_search_and_listing_work() {
        let project = project_with(&[
            ("chapters/intro.tex", "\\section{Intro}\n"),
            ("main.tex", "\\input{chapters/intro}\n"),
        ]);
        let ws = AgentWorkspace::open(
            project.path(),
            &policy_for(WriteMode::ReadOnly),
            &STAGE_LIMITS,
            &token(),
        )
        .unwrap();
        let found = ws.search(r"\\section\{\w+\}", true, "chapters").unwrap();
        assert_eq!(found["matches"][0]["path"], "chapters/intro.tex");
        let listed = ws.list("", 2).unwrap();
        let entries: Vec<&str> = listed["entries"]
            .as_array()
            .unwrap()
            .iter()
            .map(|entry| entry.as_str().unwrap())
            .collect();
        assert!(
            entries.contains(&"chapters/")
                && entries.contains(&"chapters/intro.tex")
                && entries.contains(&"main.tex")
        );
        assert!(ws.search("(", true, "").is_err());
    }

    #[test]
    fn edit_requires_exactly_one_match_unless_replace_all() {
        let project = project_with(&[("main.tex", "x y x")]);
        let ws = AgentWorkspace::open(
            project.path(),
            &policy_for(WriteMode::Apply),
            &STAGE_LIMITS,
            &token(),
        )
        .unwrap();
        assert!(matches!(
            ws.edit_text("main.tex", "x", "z", false),
            Err(ToolError::Ambiguous(_))
        ));
        assert!(matches!(
            ws.edit_text("main.tex", "q", "z", false),
            Err(ToolError::NotFound(_))
        ));
        ws.edit_text("main.tex", "y", "w", false).unwrap();
        ws.edit_text("main.tex", "x", "z", true).unwrap();
        assert_eq!(
            std::fs::read_to_string(project.path().join("main.tex")).unwrap(),
            "z w z"
        );
    }

    #[test]
    fn a_read_only_run_changes_nothing() {
        let project = project_with(&[("main.tex", "a")]);
        let ws = AgentWorkspace::open(
            project.path(),
            &policy_for(WriteMode::ReadOnly),
            &STAGE_LIMITS,
            &token(),
        )
        .unwrap();
        assert!(ws.write_text("main.tex", "b").is_err());
        assert!(ws.delete("main.tex").is_err());
        assert_eq!(ws.finish(false).unwrap().mode, "read");
    }

    fn saved_review() -> (tempfile::TempDir, tempfile::TempDir, PathBuf) {
        let (project, reviews, ws) =
            review_workspace_with(&[("main.tex", "a\n"), ("old.tex", "old\n")]);
        ws.write_text("main.tex", "b\n").unwrap();
        ws.write_text("added.tex", "new\n").unwrap();
        ws.delete("old.tex").unwrap();
        let dir = ws.finish(false).unwrap().review_dir.unwrap();
        (project, reviews, dir)
    }

    #[test]
    fn apply_review_applies_added_modified_and_deleted_files() {
        let (project, _reviews, dir) = saved_review();
        let changes = apply_review(&dir, project.path(), false).unwrap();
        assert_eq!(changes.len(), 3);
        assert_eq!(
            std::fs::read_to_string(project.path().join("main.tex")).unwrap(),
            "b\n"
        );
        assert_eq!(
            std::fs::read_to_string(project.path().join("added.tex")).unwrap(),
            "new\n"
        );
        assert!(!project.path().join("old.tex").exists());
        // Applying twice is harmless.
        assert!(apply_review(&dir, project.path(), false).is_ok());
    }

    #[test]
    fn apply_review_changes_nothing_when_one_file_moved_on() {
        let (project, _reviews, dir) = saved_review();
        std::fs::write(project.path().join("main.tex"), "someone else\n").unwrap();
        let error = apply_review(&dir, project.path(), false).unwrap_err();
        assert_eq!(error.exit(), Exit::Conflict);
        assert_eq!(error.code, "agent.apply_conflict");
        assert!(error.message.contains("main.tex"));
        assert!(!project.path().join("added.tex").exists());
        assert!(project.path().join("old.tex").exists());
    }

    #[test]
    fn apply_review_dry_run_writes_nothing() {
        let (project, _reviews, dir) = saved_review();
        assert_eq!(apply_review(&dir, project.path(), true).unwrap().len(), 3);
        assert_eq!(
            std::fs::read_to_string(project.path().join("main.tex")).unwrap(),
            "a\n"
        );
        assert!(!project.path().join("added.tex").exists());
    }

    #[test]
    fn a_review_of_another_project_is_refused() {
        let (_project, _reviews, dir) = saved_review();
        let other = project_with(&[("main.tex", "a\n")]);
        assert_eq!(
            apply_review(&dir, other.path(), false).unwrap_err().code,
            "agent.not_a_review"
        );
        let empty = tempfile::tempdir().unwrap();
        assert_eq!(
            apply_review(empty.path(), other.path(), false)
                .unwrap_err()
                .code,
            "agent.not_a_review"
        );
    }

    #[test]
    fn conflicts_name_the_first_twenty_paths() {
        let paths: Vec<String> = (0..25).map(|index| format!("f{index}.tex")).collect();
        let error = conflict(&paths);
        assert!(error.message.contains("f19.tex") && !error.message.contains("f20.tex"));
        assert!(error.message.contains("and 5 more"));
    }
}
