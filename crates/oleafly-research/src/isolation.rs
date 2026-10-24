//! Task workspaces: a detached Git worktree or a verified copy of the
//! project, plus the review diff against the baseline.
use std::collections::{BTreeMap, BTreeSet};
use std::fs::{self, File};
use std::io::{Read, Seek, Write};
use std::path::{Component, Path, PathBuf};
use std::process::Stdio;
use std::time::{Duration, Instant};

use oleafly_agent::CancellationToken;
use sha2::{Digest, Sha256};

use crate::host::{GitEnv, IsolationEnv};
use crate::model::{
    now_ms, ManifestEntry, ResearchTask, SkipReason, SkippedEntry, TaskFileChange,
    TaskFileChangeKind, TaskIsolation, TaskIsolationKind,
};
use crate::store::TaskStore;

const MAX_FILES: usize = 20_000;
const MAX_FILE_BYTES: u64 = 64 * 1024 * 1024;
const MAX_TOTAL_BYTES: u64 = 2 * 1024 * 1024 * 1024;
const MAX_GIT_OUTPUT_BYTES: u64 = 64 * 1024;
const GIT_COMMAND_TIMEOUT: Duration = Duration::from_secs(60);
pub(crate) const PREPARATION_LOCK_TIMEOUT: Duration = Duration::from_secs(60);

const EXCLUDED_DIRECTORIES: &[&str] = &[
    ".git",
    ".oleafly",
    ".private",
    ".cache",
    ".venv",
    "venv",
    "node_modules",
    "target",
    "dist",
    "build",
    "__pycache__",
];

const OUTPUT_DIRECTORIES: &[&str] = &[
    "analysis",
    "chapters",
    "checkpoints",
    "figures",
    "logs",
    "models",
    "outputs",
    "references",
    "research",
    "results",
    "review",
    "runs",
    "sections",
    "supplement",
    "supplementary",
];

pub fn prepare(
    store: &TaskStore,
    env: &dyn IsolationEnv,
    task: &ResearchTask,
    cancel: &CancellationToken,
) -> Result<TaskIsolation, String> {
    env.require_trusted(&task.project_id)?;
    let location = env.locate_project(&task.project_id)?;
    let source = if location.linked {
        IsolationSource::Snapshot
    } else {
        IsolationSource::Repository
    };
    let project_root = location.root;
    let lock_deadline = Instant::now() + env.project_lock_timeout();
    let _worktree = loop {
        if cancel.is_cancelled() {
            return Err("The task was cancelled before isolation was ready.".into());
        }
        if let Some(lock) = env.try_shared_project_lock(&task.project_id)? {
            if cancel.is_cancelled() {
                return Err("The task was cancelled before isolation was ready.".into());
            }
            break lock;
        }
        if Instant::now() >= lock_deadline {
            return Err(
                "The project stayed busy for 60 seconds. Try starting the task again.".into(),
            );
        }
        std::thread::sleep(Duration::from_millis(25));
    };
    let generation_root = store
        .root()
        .join("workspaces")
        .join(&task.id)
        .join(task.execution_generation.to_string());
    let git = env.git();
    prepare_at(
        &project_root,
        &generation_root,
        source,
        git.as_ref(),
        cancel,
    )
}

/// Where a task's copy comes from: a library project's own Git repository
/// (a detached worktree), or a plain copy for linked folders.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum IsolationSource {
    Repository,
    Snapshot,
}

pub fn prepare_at(
    project_root: &Path,
    generation_root: &Path,
    source: IsolationSource,
    git: Option<&GitEnv>,
    cancel: &CancellationToken,
) -> Result<TaskIsolation, String> {
    validate_real_root(project_root, "project")?;
    if cancel.is_cancelled() {
        return Err("The task was cancelled before isolation was ready.".into());
    }
    let (baseline, skipped) = collect_manifest_with_skips(project_root, cancel)?;
    let baseline_hash = manifest_hash(&baseline);
    let allowed_paths = allowed_paths(&baseline);
    let workspace_parent = generation_root
        .parent()
        .ok_or_else(|| "The task workspace has no parent directory.".to_string())?;
    create_real_directories(workspace_parent)?;
    reject_existing(generation_root)?;
    let baseline_root = generation_root.with_file_name(format!(
        "{}-baseline",
        generation_root
            .file_name()
            .and_then(std::ffi::OsStr::to_str)
            .ok_or_else(|| "The task workspace name is invalid.".to_string())?
    ));
    reject_existing(&baseline_root)?;
    let prepared = (|| {
        fs::create_dir(&baseline_root)
            .map_err(|error| format!("could not create the task baseline: {error}"))?;
        copy_manifest(project_root, &baseline_root, &baseline, cancel)?;
        let repository_head = match source {
            IsolationSource::Repository => exact_git_root(project_root, git, cancel)?,
            IsolationSource::Snapshot => None,
        };
        let (kind, revision) = if let Some(head) = repository_head {
            create_git_worktree(project_root, git, generation_root, &head, cancel)?;
            scrub_checkout(generation_root, &baseline, cancel)?;
            copy_manifest(project_root, generation_root, &baseline, cancel)?;
            (
                TaskIsolationKind::GitWorktree,
                format!("git:{head}:{baseline_hash}"),
            )
        } else {
            fs::create_dir(generation_root)
                .map_err(|error| format!("could not create the task snapshot: {error}"))?;
            copy_manifest(project_root, generation_root, &baseline, cancel)?;
            (
                TaskIsolationKind::StagedProject,
                format!("snapshot:{baseline_hash}"),
            )
        };
        validate_real_root(generation_root, "task workspace")?;
        Ok(TaskIsolation {
            kind,
            execution_root: generation_root.to_string_lossy().into_owned(),
            baseline_root: baseline_root.to_string_lossy().into_owned(),
            source_revision: revision,
            baseline_hash,
            baseline,
            allowed_paths,
            created_at: now_ms(),
            skipped,
        })
    })();
    if prepared.is_err() {
        let repository = (source == IsolationSource::Repository).then_some(project_root);
        cleanup_incomplete_workspace(repository, git, generation_root, &baseline_root);
    }
    prepared
}

/// What a review of a task's workspace found.
pub struct TaskReview {
    pub changes: Vec<TaskFileChange>,
    /// New files past the limits of a copy, which the review leaves out.
    pub left_out: usize,
}

pub fn collect_review_changes(
    isolation: &TaskIsolation,
    cancel: &CancellationToken,
) -> Result<Vec<TaskFileChange>, String> {
    collect_review(isolation, cancel).map(|review| review.changes)
}

pub fn collect_review(
    isolation: &TaskIsolation,
    cancel: &CancellationToken,
) -> Result<TaskReview, String> {
    let root = PathBuf::from(&isolation.execution_root);
    validate_real_root(&root, "task workspace")?;
    let known: BTreeSet<String> = isolation
        .baseline
        .iter()
        .map(|entry| entry.path.clone())
        .collect();
    let (current, over_limit) = collect_review_manifest(&root, &known, cancel)?;
    let baseline: BTreeMap<_, _> = isolation
        .baseline
        .iter()
        .map(|entry| (entry.path.clone(), entry))
        .collect();
    let mut after: BTreeMap<_, _> = current
        .iter()
        .map(|entry| (entry.path.clone(), entry))
        .collect();
    let allowed: BTreeSet<_> = isolation.allowed_paths.iter().cloned().collect();
    // A new source file outside the allowed paths fails the task. Logs,
    // caches and data a script left there stay out of the review, as in
    // 0.4.7, when only source files were tracked.
    let mut left_out = Vec::new();
    for path in after.keys() {
        if !baseline.contains_key(path) && !path_is_allowed(path, &allowed) {
            if !source_file(path) {
                left_out.push(path.clone());
                continue;
            }
            return Err(format!(
                "The task created {path}, which is outside its allowed project paths. Its workspace was kept for review."
            ));
        }
    }
    for path in left_out {
        after.remove(&path);
    }
    let paths: BTreeSet<_> = baseline.keys().chain(after.keys()).cloned().collect();
    let mut changes = Vec::new();
    for path in paths {
        match (baseline.get(&path), after.get(&path)) {
            (Some(before), Some(after)) if before.sha256 != after.sha256 => {
                changes.push(TaskFileChange {
                    path,
                    kind: TaskFileChangeKind::Modified,
                    before_sha256: Some(before.sha256.clone()),
                    after_sha256: Some(after.sha256.clone()),
                    before_size: Some(before.size),
                    after_size: Some(after.size),
                });
            }
            (Some(before), None) => changes.push(TaskFileChange {
                path,
                kind: TaskFileChangeKind::Deleted,
                before_sha256: Some(before.sha256.clone()),
                after_sha256: None,
                before_size: Some(before.size),
                after_size: None,
            }),
            (None, Some(after)) => changes.push(TaskFileChange {
                path,
                kind: TaskFileChangeKind::Added,
                before_sha256: None,
                after_sha256: Some(after.sha256.clone()),
                before_size: None,
                after_size: Some(after.size),
            }),
            _ => {}
        }
    }
    Ok(TaskReview {
        changes,
        left_out: over_limit,
    })
}

pub fn hash_file(path: &Path) -> Result<(String, u64), String> {
    let metadata = fs::symlink_metadata(path)
        .map_err(|error| format!("could not inspect {}: {error}", path.display()))?;
    if !metadata.is_file() || metadata.file_type().is_symlink() {
        return Err(format!("{} is not a regular file", path.display()));
    }
    if metadata.len() > MAX_FILE_BYTES {
        return Err(format!(
            "{} is larger than the 64 MiB task limit",
            path.display()
        ));
    }
    let mut file =
        File::open(path).map_err(|error| format!("could not open {}: {error}", path.display()))?;
    let mut hasher = Sha256::new();
    let mut buffer = [0u8; 64 * 1024];
    loop {
        let read = file
            .read(&mut buffer)
            .map_err(|error| format!("could not read {}: {error}", path.display()))?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok((format!("{:x}", hasher.finalize()), metadata.len()))
}

pub fn normalized_relative(path: &str) -> Result<PathBuf, String> {
    if path.is_empty() || path.contains('\0') || path.contains('\\') {
        return Err("A task path is not normalized.".into());
    }
    let candidate = Path::new(path);
    if candidate.is_absolute() {
        return Err("A task path must be project-relative.".into());
    }
    for component in candidate.components() {
        match component {
            Component::Normal(_) => {}
            _ => return Err("A task path is not normalized.".into()),
        }
    }
    if path.split('/').any(is_sensitive_component) {
        return Err("A task path points to protected project data.".into());
    }
    Ok(candidate.to_path_buf())
}

/// Copy limits: per file, file count and total size.
#[derive(Debug, Clone, Copy)]
pub(crate) struct CopyLimits {
    pub max_file: u64,
    pub max_files: usize,
    pub max_total: u64,
}

impl Default for CopyLimits {
    fn default() -> Self {
        Self {
            max_file: MAX_FILE_BYTES,
            max_files: MAX_FILES,
            max_total: MAX_TOTAL_BYTES,
        }
    }
}

const DATA_FOLDER_HINT: &str = "Link large data as a data folder instead.";

fn collect_manifest_with_skips(
    root: &Path,
    cancel: &CancellationToken,
) -> Result<(Vec<ManifestEntry>, Vec<SkippedEntry>), String> {
    collect_manifest_limited(root, cancel, CopyLimits::default())
}

pub(crate) fn collect_manifest_limited(
    root: &Path,
    cancel: &CancellationToken,
    limits: CopyLimits,
) -> Result<(Vec<ManifestEntry>, Vec<SkippedEntry>), String> {
    let canonical_root = root
        .canonicalize()
        .map_err(|error| format!("could not read {}: {error}", root.display()))?;
    let mut walk = Walk::new(root, &canonical_root, cancel, limits, None);
    collect_directory(&mut walk, root)?;
    walk.entries
        .sort_by(|left, right| left.path.cmp(&right.path));
    walk.skipped
        .sort_by(|left, right| left.path.cmp(&right.path));
    Ok((walk.entries, walk.skipped))
}

/// The files of a finished task's workspace for its review, and how many
/// new files were left out. The files the project had (`known`) are always
/// listed. New ones count against the limits of a copy, but past them they
/// are left out instead of failing the task: a run that wrote 25,000 files
/// still has its work reviewed.
fn collect_review_manifest(
    root: &Path,
    known: &BTreeSet<String>,
    cancel: &CancellationToken,
) -> Result<(Vec<ManifestEntry>, usize), String> {
    collect_review_manifest_limited(root, known, cancel, CopyLimits::default())
}

fn collect_review_manifest_limited(
    root: &Path,
    known: &BTreeSet<String>,
    cancel: &CancellationToken,
    limits: CopyLimits,
) -> Result<(Vec<ManifestEntry>, usize), String> {
    let canonical_root = root
        .canonicalize()
        .map_err(|error| format!("could not read {}: {error}", root.display()))?;
    let mut walk = Walk::new(root, &canonical_root, cancel, limits, Some(known));
    collect_directory(&mut walk, root)?;
    walk.entries
        .sort_by(|left, right| left.path.cmp(&right.path));
    Ok((walk.entries, walk.left_out))
}

struct Walk<'a> {
    root: &'a Path,
    canonical_root: &'a Path,
    cancel: &'a CancellationToken,
    limits: CopyLimits,
    /// A review: the project's files, which no limit applies to.
    known: Option<&'a BTreeSet<String>>,
    entries: Vec<ManifestEntry>,
    skipped: Vec<SkippedEntry>,
    total_bytes: u64,
    /// A review: what the new files add up to, and those left out.
    new_files: usize,
    new_bytes: u64,
    left_out: usize,
}

impl<'a> Walk<'a> {
    fn new(
        root: &'a Path,
        canonical_root: &'a Path,
        cancel: &'a CancellationToken,
        limits: CopyLimits,
        known: Option<&'a BTreeSet<String>>,
    ) -> Self {
        Self {
            root,
            canonical_root,
            cancel,
            limits,
            known,
            entries: Vec::new(),
            skipped: Vec::new(),
            total_bytes: 0,
            new_files: 0,
            new_bytes: 0,
            left_out: 0,
        }
    }

    fn skip(&mut self, path: String, reason: SkipReason) {
        self.skipped.push(SkippedEntry { path, reason });
    }

    fn add(&mut self, portable: String, file: &Path, resolved_link: bool) -> Result<(), String> {
        // A review lists the project's own files whatever the limits say,
        // and counts only the new ones against them.
        let reviewing = self.known.is_some();
        let new_file = self
            .known
            .is_some_and(|known| !known.contains(portable.as_str()));
        if !reviewing && self.entries.len() >= self.limits.max_files {
            return Err(format!(
                "The project has more than {} task files. {DATA_FOLDER_HINT}",
                self.limits.max_files
            ));
        }
        if new_file && self.new_files >= self.limits.max_files {
            self.left_out += 1;
            return Ok(());
        }
        // Size first: hashing refuses a file over the limit, and a large data
        // file is skipped, not a reason to fail the whole copy.
        let size = fs::metadata(file)
            .map_err(|error| format!("could not inspect {}: {error}", file.display()))?
            .len();
        if size > self.limits.max_file {
            self.skip(portable, SkipReason::TooLarge);
            return Ok(());
        }
        if new_file {
            if self.new_bytes.saturating_add(size) > self.limits.max_total {
                self.left_out += 1;
                return Ok(());
            }
            self.new_files += 1;
            self.new_bytes += size;
        }
        let (sha256, size) = hash_file(file)?;
        if !reviewing {
            self.total_bytes = self
                .total_bytes
                .checked_add(size)
                .ok_or_else(|| "The task source is too large.".to_string())?;
            if self.total_bytes > self.limits.max_total {
                return Err(format!(
                    "The task source is larger than 2 GiB. {DATA_FOLDER_HINT}"
                ));
            }
        }
        self.entries.push(ManifestEntry {
            path: portable,
            sha256,
            size,
            resolved_link,
        });
        Ok(())
    }
}

fn collect_directory(walk: &mut Walk<'_>, directory: &Path) -> Result<(), String> {
    let (root, cancel) = (walk.root, walk.cancel);
    if cancel.is_cancelled() {
        return Err("The task was cancelled while its workspace was being prepared.".into());
    }
    let mut children = fs::read_dir(directory)
        .map_err(|error| format!("could not read {}: {error}", directory.display()))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("could not read {}: {error}", directory.display()))?;
    children.sort_by_key(std::fs::DirEntry::file_name);
    for child in children {
        let path = child.path();
        let relative = path
            .strip_prefix(root)
            .map_err(|_| "A task source path escaped the project.".to_string())?;
        let portable = match portable_path(relative) {
            Ok(portable) => portable,
            Err(_) => {
                walk.skip(
                    relative.to_string_lossy().into_owned(),
                    SkipReason::NotUnicode,
                );
                continue;
            }
        };
        if excluded_path(&portable) {
            continue;
        }
        let metadata = fs::symlink_metadata(&path)
            .map_err(|error| format!("could not inspect {}: {error}", path.display()))?;
        if metadata.file_type().is_symlink() {
            if !allowed_file(&portable) {
                continue;
            }
            // A link to a file inside the project is copied as that file;
            // links to folders are never followed, so a cycle cannot form.
            match fs::canonicalize(&path) {
                Err(_) => walk.skip(portable, SkipReason::BrokenLink),
                Ok(target) if !target.starts_with(walk.canonical_root) => {
                    walk.skip(portable, SkipReason::LinkOutside)
                }
                Ok(target) if target.is_dir() => walk.skip(portable, SkipReason::LinkToFolder),
                Ok(target) if target.is_file() => walk.add(portable, &target, true)?,
                Ok(_) => walk.skip(portable, SkipReason::BrokenLink),
            }
            continue;
        }
        if metadata.is_dir() {
            if cancel.is_cancelled() {
                return Err(
                    "The task was cancelled while its workspace was being prepared.".into(),
                );
            }
            collect_directory(walk, &path)?;
            continue;
        }
        if !metadata.is_file() || !allowed_file(&portable) {
            continue;
        }
        walk.add(portable, &path, false)?;
    }
    Ok(())
}

fn copy_manifest(
    source: &Path,
    destination: &Path,
    manifest: &[ManifestEntry],
    cancel: &CancellationToken,
) -> Result<(), String> {
    for entry in manifest {
        if cancel.is_cancelled() {
            return Err("The task was cancelled while its workspace was being prepared.".into());
        }
        let relative = normalized_relative(&entry.path)?;
        let link = source.join(&relative);
        // A resolved link is copied from its target, as a regular file.
        let from = if entry.resolved_link {
            fs::canonicalize(&link)
                .map_err(|error| format!("could not read {}: {error}", entry.path))?
        } else {
            link
        };
        let to = destination.join(&relative);
        let parent = to
            .parent()
            .ok_or_else(|| "A task file has no parent directory.".to_string())?;
        create_real_directories_beneath(destination, parent)?;
        let (source_hash, _) = hash_file(&from)?;
        if source_hash != entry.sha256 {
            return Err(format!(
                "{} changed while the task snapshot was being prepared. Start the task again.",
                entry.path
            ));
        }
        clone_or_copy(&from, &to)?;
        let (copied_hash, _) = hash_file(&to)?;
        if copied_hash != entry.sha256 {
            return Err(format!("Could not verify the task copy of {}.", entry.path));
        }
    }
    Ok(())
}

fn run_git(
    project: &Path,
    git: Option<&GitEnv>,
    arguments: &[String],
    cancel: &CancellationToken,
) -> Result<Option<std::process::Output>, String> {
    let Some(git) = git else {
        return Ok(None);
    };
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .map_err(|error| format!("could not prepare the Git process runtime: {error}"))?;
    let _runtime = runtime.enter();
    let mut stdout = tempfile::tempfile()
        .map_err(|error| format!("could not create a Git output file: {error}"))?;
    let mut stderr = tempfile::tempfile()
        .map_err(|error| format!("could not create a Git error file: {error}"))?;
    let mut command = tokio::process::Command::new(&git.program);
    for variable in git.clear {
        command.env_remove(variable);
    }
    for (name, value) in &git.env {
        match value {
            Some(value) => command.env(name, value),
            None => command.env_remove(name),
        };
    }
    command
        .arg("-c")
        .arg(format!("core.hooksPath={}", null_device()))
        .arg("-C")
        .arg(project)
        .args(arguments)
        .stdin(Stdio::null())
        .stdout(Stdio::from(stdout.try_clone().map_err(|error| {
            format!("could not capture Git output: {error}")
        })?))
        .stderr(Stdio::from(stderr.try_clone().map_err(|error| {
            format!("could not capture Git errors: {error}")
        })?))
        .kill_on_drop(true);
    oleafly_sandbox::process::isolate_process_tree(&mut command);
    let mut child = match command.spawn() {
        Ok(child) => child,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(format!("could not start Git task isolation: {error}")),
    };
    let pid = child
        .id()
        .ok_or_else(|| "The Git isolation process has no process ID.".to_string())?;
    let mut containment = Some(oleafly_sandbox::process::contain_process_tree(pid).map_err(
        |error| {
            let _ = child.start_kill();
            format!("could not contain Git task isolation: {error}")
        },
    )?);
    let started = Instant::now();
    let status = loop {
        if cancel.is_cancelled() {
            drop(containment.take());
            let _ = child.start_kill();
            reap_process(&mut child);
            return Err("The task was cancelled while Git prepared its workspace.".into());
        }
        if started.elapsed() >= GIT_COMMAND_TIMEOUT {
            drop(containment.take());
            let _ = child.start_kill();
            reap_process(&mut child);
            return Err("Git took longer than one minute to prepare the task workspace.".into());
        }
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) => std::thread::sleep(Duration::from_millis(10)),
            Err(error) => {
                drop(containment.take());
                let _ = child.start_kill();
                reap_process(&mut child);
                return Err(format!("could not wait for Git task isolation: {error}"));
            }
        }
    };
    if let Some(containment) = containment.take() {
        containment.disarm();
    }
    stdout
        .rewind()
        .map_err(|error| format!("could not read Git output: {error}"))?;
    stderr
        .rewind()
        .map_err(|error| format!("could not read Git errors: {error}"))?;
    let mut stdout_bytes = Vec::new();
    let mut stderr_bytes = Vec::new();
    stdout
        .take(MAX_GIT_OUTPUT_BYTES)
        .read_to_end(&mut stdout_bytes)
        .map_err(|error| format!("could not read Git output: {error}"))?;
    stderr
        .take(MAX_GIT_OUTPUT_BYTES)
        .read_to_end(&mut stderr_bytes)
        .map_err(|error| format!("could not read Git errors: {error}"))?;
    Ok(Some(std::process::Output {
        status,
        stdout: stdout_bytes,
        stderr: stderr_bytes,
    }))
}

fn reap_process(child: &mut tokio::process::Child) {
    let deadline = Instant::now() + Duration::from_secs(2);
    while Instant::now() < deadline {
        match child.try_wait() {
            Ok(Some(_)) | Err(_) => return,
            Ok(None) => std::thread::sleep(Duration::from_millis(10)),
        }
    }
}

pub fn task_workspace_root(store_root: &Path, task_id: &str) -> PathBuf {
    store_root.join("workspaces").join(task_id)
}

pub fn purge_task_workspaces(project: Option<&Path>, git: Option<&GitEnv>, task_root: &Path) {
    let Ok(entries) = fs::read_dir(task_root) else {
        remove_created_path(task_root);
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if let Some(project) = project {
            let arguments = [
                "worktree".to_string(),
                "remove".to_string(),
                "--force".to_string(),
                path.to_string_lossy().into_owned(),
            ];
            let _ = run_git(project, git, &arguments, &CancellationToken::new());
        }
        remove_created_path(&path);
    }
    if let Some(project) = project {
        let arguments = ["worktree".to_string(), "prune".to_string()];
        let _ = run_git(project, git, &arguments, &CancellationToken::new());
    }
    remove_created_path(task_root);
}

/// Removes a task's earlier workspaces (and their baselines), keeping the
/// workspace roots in `keep`.
pub fn purge_generations(
    task_root: &Path,
    keep: &[PathBuf],
    project: Option<&Path>,
    git: Option<&GitEnv>,
) {
    // Listed once up front, so a folder created while this runs is left alone.
    let Ok(entries) = fs::read_dir(task_root) else {
        return;
    };
    let entries: Vec<PathBuf> = entries.flatten().map(|entry| entry.path()).collect();
    let kept: Vec<PathBuf> = keep
        .iter()
        .flat_map(|root| {
            let baseline = root.with_file_name(format!(
                "{}-baseline",
                root.file_name()
                    .and_then(std::ffi::OsStr::to_str)
                    .unwrap_or_default()
            ));
            [root.clone(), baseline]
        })
        .collect();
    let mut removed_worktree = false;
    for path in entries {
        if kept.iter().any(|kept| kept == &path) {
            continue;
        }
        if let Some(project) = project.filter(|_| !path.to_string_lossy().ends_with("-baseline")) {
            let arguments = [
                "worktree".to_string(),
                "remove".to_string(),
                "--force".to_string(),
                path.to_string_lossy().into_owned(),
            ];
            removed_worktree |=
                run_git(project, git, &arguments, &CancellationToken::new()).is_ok();
        }
        remove_created_path(&path);
    }
    if let (Some(project), true) = (project, removed_worktree) {
        let arguments = ["worktree".to_string(), "prune".to_string()];
        let _ = run_git(project, git, &arguments, &CancellationToken::new());
    }
}

/// After review only the before-copies of changed files are needed from
/// the baseline; the rest is removed. Returns how many files went.
pub fn prune_baseline(
    isolation: &TaskIsolation,
    changes: &[TaskFileChange],
) -> Result<usize, String> {
    let baseline_root = PathBuf::from(&isolation.baseline_root);
    if !baseline_root.is_dir() {
        return Ok(0);
    }
    let needed: BTreeSet<&str> = changes.iter().map(|change| change.path.as_str()).collect();
    let mut removed = 0usize;
    for entry in &isolation.baseline {
        if needed.contains(entry.path.as_str()) {
            continue;
        }
        let relative = normalized_relative(&entry.path)?;
        let path = baseline_root.join(relative);
        if fs::symlink_metadata(&path).is_ok_and(|metadata| metadata.is_file())
            && fs::remove_file(&path).is_ok()
        {
            removed += 1;
        }
    }
    Ok(removed)
}

/// Puts back the baseline files [`prune_baseline`] removed, from project
/// files that still hold what the task started from, so the review after a
/// resume can show each file's earlier text. Files changed since stay out.
/// Returns how many came back.
pub fn restore_baseline(isolation: &TaskIsolation, project_root: &Path) -> usize {
    let baseline_root = PathBuf::from(&isolation.baseline_root);
    if !baseline_root.is_dir() {
        return 0;
    }
    let mut restored = 0usize;
    for entry in &isolation.baseline {
        let Ok(relative) = normalized_relative(&entry.path) else {
            continue;
        };
        let kept = baseline_root.join(&relative);
        if fs::symlink_metadata(&kept).is_ok() {
            continue;
        }
        let source = project_root.join(&relative);
        if !fs::symlink_metadata(&source)
            .is_ok_and(|metadata| metadata.is_file() && metadata.len() == entry.size)
        {
            continue;
        }
        if kept
            .parent()
            .is_some_and(|parent| fs::create_dir_all(parent).is_err())
        {
            continue;
        }
        // The copy is checked, not the source, so a file that changes while
        // it is copied never becomes the baseline.
        if clone_or_copy(&source, &kept).is_err() {
            let _ = fs::remove_file(&kept);
            continue;
        }
        if hash_file(&kept).is_ok_and(|(sha256, _)| sha256 == entry.sha256) {
            restored += 1;
        } else {
            let _ = fs::remove_file(&kept);
        }
    }
    restored
}

/// How a file reached a task copy.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CloneResult {
    /// A copy-on-write clone (APFS, Btrfs, XFS): no data copied.
    Cloned,
    Copied,
}

/// Clones `source` to `destination` where the filesystem can, else copies.
pub fn clone_or_copy(source: &Path, destination: &Path) -> Result<CloneResult, String> {
    if try_clone(source, destination) {
        return Ok(CloneResult::Cloned);
    }
    copy_file(source, destination)?;
    Ok(CloneResult::Copied)
}

#[cfg(target_os = "macos")]
fn try_clone(source: &Path, destination: &Path) -> bool {
    use std::os::unix::ffi::OsStrExt;
    let Some(parent) = destination.parent() else {
        return false;
    };
    let staging = parent.join(format!(
        ".oleafly-clone-{}-{:016x}.tmp",
        std::process::id(),
        rand::random::<u64>()
    ));
    let (Ok(from), Ok(to)) = (
        std::ffi::CString::new(source.as_os_str().as_bytes()),
        std::ffi::CString::new(staging.as_os_str().as_bytes()),
    ) else {
        return false;
    };
    // SAFETY: both paths are valid NUL-terminated strings for this call.
    /// `CLONE_NOFOLLOW` from `<sys/clonefile.h>`.
    const CLONE_NOFOLLOW: u32 = 0x0001;
    if unsafe { libc::clonefile(from.as_ptr(), to.as_ptr(), CLONE_NOFOLLOW) } != 0 {
        return false;
    }
    let finished = fs::File::open(&staging)
        .and_then(|file| file.sync_all())
        .and_then(|_| fs::rename(&staging, destination));
    if finished.is_err() {
        let _ = fs::remove_file(&staging);
        return false;
    }
    true
}

#[cfg(target_os = "linux")]
fn try_clone(source: &Path, destination: &Path) -> bool {
    use std::os::unix::io::AsRawFd;
    /// `_IOW(0x94, 9, int)`.
    const FICLONE: libc::c_ulong = 0x4004_9409;
    let Ok(input) = fs::File::open(source) else {
        return false;
    };
    let Ok(permissions) = input.metadata().map(|metadata| metadata.permissions()) else {
        return false;
    };
    let Ok((staging, output)) = create_staging_file(destination) else {
        return false;
    };
    // SAFETY: both descriptors are open for the duration of the call.
    let cloned = unsafe { libc::ioctl(output.as_raw_fd(), FICLONE as _, input.as_raw_fd()) } == 0;
    let finished =
        cloned && output.set_permissions(permissions).is_ok() && output.sync_all().is_ok() && {
            drop(output);
            fs::rename(&staging, destination).is_ok()
        };
    if !finished {
        let _ = fs::remove_file(&staging);
    }
    finished
}

#[cfg(not(any(target_os = "macos", target_os = "linux")))]
fn try_clone(_source: &Path, _destination: &Path) -> bool {
    false
}

fn cleanup_incomplete_workspace(
    project: Option<&Path>,
    git: Option<&GitEnv>,
    workspace: &Path,
    baseline: &Path,
) {
    if let Some(project) = project.filter(|_| workspace.exists()) {
        let arguments = [
            "worktree".to_string(),
            "remove".to_string(),
            "--force".to_string(),
            workspace.to_string_lossy().into_owned(),
        ];
        let _ = run_git(project, git, &arguments, &CancellationToken::new());
    }
    remove_created_path(workspace);
    remove_created_path(baseline);
}

fn remove_created_path(path: &Path) {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.is_dir() && !metadata.file_type().is_symlink() => {
            let _ = fs::remove_dir_all(path);
        }
        Ok(_) => {
            let _ = fs::remove_file(path);
        }
        Err(_) => {}
    }
}

fn create_git_worktree(
    project: &Path,
    git: Option<&GitEnv>,
    destination: &Path,
    head: &str,
    cancel: &CancellationToken,
) -> Result<(), String> {
    let arguments = vec![
        "worktree".to_string(),
        "add".to_string(),
        "--detach".to_string(),
        "--no-checkout".to_string(),
        destination.to_string_lossy().into_owned(),
        head.to_string(),
    ];
    let output = run_git(project, git, &arguments, cancel)?
        .ok_or_else(|| "Git is no longer available for task isolation.".to_string())?;
    if !output.status.success() {
        let detail = String::from_utf8_lossy(&output.stderr);
        return Err(format!(
            "Git could not create the isolated task worktree: {}",
            detail.trim().chars().take(500).collect::<String>()
        ));
    }
    Ok(())
}

fn exact_git_root(
    project: &Path,
    git: Option<&GitEnv>,
    cancel: &CancellationToken,
) -> Result<Option<String>, String> {
    let arguments = [
        "rev-parse".to_string(),
        "--show-toplevel".to_string(),
        "HEAD".to_string(),
    ];
    let Some(output) = run_git(project, git, &arguments, cancel)? else {
        return Ok(None);
    };
    if !output.status.success() {
        return Ok(None);
    }
    let stdout = String::from_utf8(output.stdout)
        .map_err(|_| "Git returned an invalid project path.".to_string())?;
    let mut lines = stdout.lines();
    let top = lines
        .next()
        .ok_or_else(|| "Git did not return a repository root.".to_string())?;
    let head = lines
        .next()
        .ok_or_else(|| "Git did not return a source revision.".to_string())?;
    let top = PathBuf::from(top)
        .canonicalize()
        .map_err(|error| format!("could not resolve the Git repository root: {error}"))?;
    let project = project
        .canonicalize()
        .map_err(|error| format!("could not resolve the project root: {error}"))?;
    if top != project {
        return Ok(None);
    }
    if head.len() != 40 && head.len() != 64 {
        return Err("Git returned an invalid source revision.".into());
    }
    Ok(Some(head.to_string()))
}

fn scrub_checkout(
    destination: &Path,
    manifest: &[ManifestEntry],
    cancel: &CancellationToken,
) -> Result<(), String> {
    let files: BTreeSet<_> = manifest.iter().map(|entry| entry.path.as_str()).collect();
    scrub_directory(destination, destination, &files, cancel)
}

fn scrub_directory(
    root: &Path,
    directory: &Path,
    files: &BTreeSet<&str>,
    cancel: &CancellationToken,
) -> Result<(), String> {
    if cancel.is_cancelled() {
        return Err("The task was cancelled while its workspace was being prepared.".into());
    }
    for child in fs::read_dir(directory)
        .map_err(|error| format!("could not inspect the task worktree: {error}"))?
    {
        let child =
            child.map_err(|error| format!("could not inspect the task worktree: {error}"))?;
        let path = child.path();
        let relative = portable_path(
            path.strip_prefix(root)
                .map_err(|_| "A task worktree path escaped its root.".to_string())?,
        )?;
        if relative == ".git" {
            continue;
        }
        let metadata = fs::symlink_metadata(&path)
            .map_err(|error| format!("could not inspect the task worktree: {error}"))?;
        if metadata.file_type().is_symlink() {
            fs::remove_file(&path)
                .map_err(|error| format!("could not clean the task worktree: {error}"))?;
        } else if metadata.is_dir() {
            let prefix = format!("{relative}/");
            if files.iter().any(|file| file.starts_with(&prefix)) {
                scrub_directory(root, &path, files, cancel)?;
            } else {
                fs::remove_dir_all(&path)
                    .map_err(|error| format!("could not clean the task worktree: {error}"))?;
            }
        } else if !files.contains(relative.as_str()) {
            fs::remove_file(&path)
                .map_err(|error| format!("could not clean the task worktree: {error}"))?;
        }
    }
    Ok(())
}

/// Whether `path` is one of the folders every task may write in.
pub(crate) fn is_output_directory(path: &Path) -> bool {
    path.to_str()
        .is_some_and(|path| OUTPUT_DIRECTORIES.contains(&path))
}

fn allowed_paths(manifest: &[ManifestEntry]) -> Vec<String> {
    let mut paths = BTreeSet::new();
    for entry in manifest {
        paths.insert(entry.path.clone());
        let path = Path::new(&entry.path);
        if let Some(parent) = path.parent() {
            let parent = parent.to_string_lossy().replace('\\', "/");
            if !parent.is_empty() {
                paths.insert(parent);
            }
        }
    }
    paths.extend(OUTPUT_DIRECTORIES.iter().map(ToString::to_string));
    paths.into_iter().collect()
}

fn path_is_allowed(path: &str, allowed: &BTreeSet<String>) -> bool {
    allowed.contains(path)
        || allowed.iter().any(|candidate| {
            OUTPUT_DIRECTORIES.contains(&candidate.as_str())
                && path.starts_with(&format!("{candidate}/"))
        })
        || Path::new(path)
            .parent()
            .map(|parent| parent.to_string_lossy().replace('\\', "/"))
            .is_some_and(|parent| !parent.is_empty() && allowed.contains(&parent))
}

fn manifest_hash(entries: &[ManifestEntry]) -> String {
    let mut hasher = Sha256::new();
    for entry in entries {
        hasher.update(entry.path.as_bytes());
        hasher.update([0]);
        hasher.update(entry.sha256.as_bytes());
        hasher.update([0]);
        hasher.update(entry.size.to_le_bytes());
    }
    format!("{:x}", hasher.finalize())
}

/// The source file types 0.4.7 tracked, which a task may not add outside
/// its allowed paths.
const SOURCE_EXTENSIONS: &[&str] = &[
    "bib", "bst", "cls", "css", "csv", "eps", "gif", "html", "ipynb", "jpeg", "jpg", "jl", "js",
    "json", "md", "m", "pdf", "png", "py", "r", "sh", "sty", "svg", "tex", "toml", "ts", "tsv",
    "txt", "typ", "webp", "xml", "yaml", "yml",
];

fn source_file(path: &str) -> bool {
    let lower = Path::new(path)
        .file_name()
        .and_then(std::ffi::OsStr::to_str)
        .unwrap_or_default()
        .to_ascii_lowercase();
    matches!(lower.as_str(), "project.json" | "makefile" | "latexmkrc")
        || Path::new(&lower)
            .extension()
            .and_then(std::ffi::OsStr::to_str)
            .is_some_and(|extension| SOURCE_EXTENSIONS.contains(&extension))
}

fn allowed_file(path: &str) -> bool {
    let file_name = Path::new(path)
        .file_name()
        .and_then(std::ffi::OsStr::to_str)
        .unwrap_or_default();
    let lower = file_name.to_ascii_lowercase();
    if is_sensitive_component(&lower) {
        return false;
    }
    // Every other file type is copied: data, models and build inputs.
    true
}

fn excluded_path(path: &str) -> bool {
    path.split('/').any(|component| {
        EXCLUDED_DIRECTORIES
            .iter()
            .any(|excluded| component.eq_ignore_ascii_case(excluded))
            || is_sensitive_component(component)
    })
}

fn is_sensitive_component(component: &str) -> bool {
    let lower = component.to_ascii_lowercase();
    lower == ".private"
        || lower == ".env"
        || lower.starts_with(".env.")
        || matches!(
            lower.as_str(),
            "credentials"
                | "credentials.json"
                | "secrets"
                | "secrets.json"
                | ".git-credentials"
                | ".npmrc"
                | ".pypirc"
        )
        || matches!(
            Path::new(&lower)
                .extension()
                .and_then(std::ffi::OsStr::to_str),
            Some("key" | "pem" | "p12" | "pfx")
        )
}

/// Files of one research record a fresh retry copies at most.
const MAX_RECORD_FILES: usize = 2_000;
const MAX_RECORD_BYTES: u64 = 256 * 1024 * 1024;

/// Copies `research/<slug>/` from an earlier workspace into a new one, so a
/// task that starts over keeps its research record. Links and files a task
/// may not hold are skipped. Returns how many files were copied.
pub fn carry_over_record(from_root: &Path, to_root: &Path, slug: &str) -> Result<usize, String> {
    let relative = normalized_relative(&crate::record::record_dir(slug))?;
    let source = from_root.join(&relative);
    match fs::symlink_metadata(&source) {
        Ok(metadata) if metadata.is_dir() && !metadata.file_type().is_symlink() => {}
        _ => return Ok(0),
    }
    validate_real_root(to_root, "task workspace")?;
    let mut pending = vec![source.clone()];
    let mut copied = 0usize;
    let mut total = 0u64;
    while let Some(directory) = pending.pop() {
        let mut children = fs::read_dir(&directory)
            .map_err(|error| format!("could not read {}: {error}", directory.display()))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| format!("could not read {}: {error}", directory.display()))?;
        children.sort_by_key(std::fs::DirEntry::file_name);
        for child in children {
            let path = child.path();
            let metadata = fs::symlink_metadata(&path)
                .map_err(|error| format!("could not inspect {}: {error}", path.display()))?;
            if metadata.file_type().is_symlink() {
                continue;
            }
            if metadata.is_dir() {
                pending.push(path);
                continue;
            }
            let inside = path
                .strip_prefix(from_root)
                .map_err(|_| "A record path escaped its workspace.".to_string())?;
            let portable = portable_path(inside)?;
            if !metadata.is_file() || !allowed_file(&portable) || excluded_path(&portable) {
                continue;
            }
            if metadata.len() > MAX_FILE_BYTES {
                continue;
            }
            total = total.saturating_add(metadata.len());
            if copied >= MAX_RECORD_FILES || total > MAX_RECORD_BYTES {
                return Err(
                    "The research record is too large to carry over. Start over without it.".into(),
                );
            }
            let destination = to_root.join(inside);
            let parent = destination
                .parent()
                .ok_or_else(|| "A record file has no parent directory.".to_string())?;
            create_real_directories_beneath(to_root, parent)?;
            copy_file(&path, &destination)?;
            copied += 1;
        }
    }
    Ok(copied)
}

fn portable_path(path: &Path) -> Result<String, String> {
    let mut parts = Vec::new();
    for component in path.components() {
        match component {
            Component::Normal(value) => parts.push(
                value
                    .to_str()
                    .ok_or_else(|| "A task path is not valid Unicode.".to_string())?,
            ),
            _ => return Err("A task path is not normalized.".into()),
        }
    }
    if parts.is_empty() {
        return Err("A task path is empty.".into());
    }
    Ok(parts.join("/"))
}

fn copy_file(source: &Path, destination: &Path) -> Result<(), String> {
    let mut input = File::open(source)
        .map_err(|error| format!("could not open {}: {error}", source.display()))?;
    let permissions = input
        .metadata()
        .map_err(|error| format!("could not inspect {}: {error}", source.display()))?
        .permissions();
    let (staging, mut output) = create_staging_file(destination)?;
    let copied = (|| {
        std::io::copy(&mut input, &mut output)
            .map_err(|error| format!("could not copy {}: {error}", source.display()))?;
        output.set_permissions(permissions).map_err(|error| {
            format!(
                "could not preserve {} permissions: {error}",
                source.display()
            )
        })?;
        output
            .flush()
            .and_then(|_| output.sync_all())
            .map_err(|error| format!("could not save {}: {error}", destination.display()))?;
        drop(output);
        // Retried on Windows while a scanner or indexer holds the file.
        oleafly_core::atomic::persist_with_retry(|| fs::rename(&staging, destination))
            .map_err(|error| format!("could not save {}: {error}", destination.display()))
    })();
    if copied.is_err() {
        let _ = fs::remove_file(&staging);
    }
    copied
}

/// A new, empty file beside `destination` that a finished copy is renamed
/// over, so a destination never holds half a file.
fn create_staging_file(destination: &Path) -> Result<(PathBuf, File), String> {
    static SEQUENCE: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let parent = destination
        .parent()
        .filter(|path| !path.as_os_str().is_empty())
        .ok_or_else(|| "file destination has no parent folder".to_string())?;
    let name = destination
        .file_name()
        .and_then(std::ffi::OsStr::to_str)
        .ok_or_else(|| "file destination name is not valid Unicode".to_string())?;
    for _ in 0..10_000 {
        let sequence = SEQUENCE.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        let staging = parent.join(format!(
            ".{name}.oleafly-{}-{sequence}-{:016x}.tmp",
            std::process::id(),
            rand::random::<u64>()
        ));
        match fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&staging)
        {
            Ok(file) => return Ok((staging, file)),
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(format!("failed to create staging file: {error}")),
        }
    }
    Err("could not reserve a staging file".into())
}

fn null_device() -> &'static str {
    if cfg!(windows) {
        "NUL"
    } else {
        "/dev/null"
    }
}

fn create_real_directories(path: &Path) -> Result<(), String> {
    fs::create_dir_all(path)
        .map_err(|error| format!("could not create the task workspace directory: {error}"))?;
    validate_real_root(path, "task workspace directory")
}

fn create_real_directories_beneath(root: &Path, path: &Path) -> Result<(), String> {
    if !path.starts_with(root) {
        return Err("A task directory escaped its workspace.".into());
    }
    let relative = path
        .strip_prefix(root)
        .map_err(|_| "A task directory escaped its workspace.".to_string())?;
    let mut current = root.to_path_buf();
    for component in relative.components() {
        let Component::Normal(component) = component else {
            return Err("A task directory is not normalized.".into());
        };
        current.push(component);
        match fs::symlink_metadata(&current) {
            Ok(metadata) if metadata.is_dir() && !metadata.file_type().is_symlink() => {}
            Ok(_) => return Err("A task parent path is not a real directory.".into()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                fs::create_dir(&current).map_err(|error| {
                    format!("could not create a task workspace directory: {error}")
                })?;
            }
            Err(error) => {
                return Err(format!("could not inspect a task workspace path: {error}"));
            }
        }
    }
    Ok(())
}

fn validate_real_root(path: &Path, label: &str) -> Result<(), String> {
    let metadata = fs::symlink_metadata(path)
        .map_err(|error| format!("could not inspect the {label}: {error}"))?;
    if !metadata.is_dir() || metadata.file_type().is_symlink() {
        return Err(format!("The {label} is not a real directory."));
    }
    Ok(())
}

fn reject_existing(path: &Path) -> Result<(), String> {
    match fs::symlink_metadata(path) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!("could not inspect the task workspace: {error}")),
        Ok(_) => Err("A task workspace already exists for this run.".into()),
    }
}

// What a copy takes, skips and lists (data files, links, size limits).
#[cfg(test)]
mod copy_tests {
    use super::*;

    #[test]
    fn copies_every_file_type_except_protected_names() {
        let project = tempfile::tempdir().unwrap();
        for name in [
            "data.parquet",
            "model.pt",
            "Makefile.am",
            ".env",
            "id_rsa.pem",
        ] {
            std::fs::write(project.path().join(name), name).unwrap();
        }
        std::fs::create_dir(project.path().join(".private")).unwrap();
        std::fs::write(project.path().join(".private/x"), "x").unwrap();
        let (entries, _) = collect_manifest_limited(
            project.path(),
            &CancellationToken::new(),
            CopyLimits::default(),
        )
        .unwrap();
        let paths: Vec<&str> = entries.iter().map(|entry| entry.path.as_str()).collect();
        for kept in ["data.parquet", "model.pt", "Makefile.am"] {
            assert!(paths.contains(&kept), "{kept} missing from {paths:?}");
        }
        for dropped in [".env", "id_rsa.pem", ".private/x"] {
            assert!(!paths.contains(&dropped), "{dropped} copied");
        }
    }

    #[test]
    fn oversize_files_are_skipped_and_listed() {
        let project = tempfile::tempdir().unwrap();
        std::fs::write(project.path().join("big.bin"), vec![0u8; 2048]).unwrap();
        std::fs::write(project.path().join("small.txt"), "ok").unwrap();
        let limits = CopyLimits {
            max_file: 1024,
            ..CopyLimits::default()
        };
        let (entries, skipped) =
            collect_manifest_limited(project.path(), &CancellationToken::new(), limits).unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(
            skipped,
            vec![SkippedEntry {
                path: "big.bin".into(),
                reason: SkipReason::TooLarge
            }]
        );
    }

    #[test]
    fn files_over_the_default_limit_are_skipped_not_fatal() {
        let project = tempfile::tempdir().unwrap();
        std::fs::write(project.path().join("main.tex"), "manuscript").unwrap();
        // Sparse, so the test writes almost nothing.
        let weights = std::fs::File::create(project.path().join("model.safetensors")).unwrap();
        weights.set_len(MAX_FILE_BYTES + 1).unwrap();
        let (entries, skipped) = collect_manifest_limited(
            project.path(),
            &CancellationToken::new(),
            CopyLimits::default(),
        )
        .unwrap();
        assert_eq!(
            entries
                .iter()
                .map(|entry| entry.path.as_str())
                .collect::<Vec<_>>(),
            ["main.tex"]
        );
        assert_eq!(
            skipped,
            vec![SkippedEntry {
                path: "model.safetensors".into(),
                reason: SkipReason::TooLarge
            }]
        );
    }

    #[test]
    fn a_review_lists_the_projects_files_and_leaves_out_new_ones_past_the_limits() {
        let workspace = tempfile::tempdir().unwrap();
        for name in ["a.tex", "b.tex", "c.tex"] {
            std::fs::write(workspace.path().join(name), name).unwrap();
        }
        std::fs::create_dir(workspace.path().join("runs")).unwrap();
        for index in 0..5 {
            std::fs::write(
                workspace.path().join(format!("runs/out{index}.csv")),
                "12345",
            )
            .unwrap();
        }
        let known: BTreeSet<String> = ["a.tex", "b.tex", "c.tex"].map(String::from).into();
        let limits = CopyLimits {
            max_files: 2,
            ..CopyLimits::default()
        };
        let (entries, left_out) = collect_review_manifest_limited(
            workspace.path(),
            &known,
            &CancellationToken::new(),
            limits,
        )
        .unwrap();
        let paths: Vec<&str> = entries.iter().map(|entry| entry.path.as_str()).collect();
        // The three project files are over the limit of two and still listed
        // (they would otherwise look deleted); two new files fit.
        assert_eq!(
            paths,
            ["a.tex", "b.tex", "c.tex", "runs/out0.csv", "runs/out1.csv"]
        );
        assert_eq!(left_out, 3);

        // The new files also count by size, not only by number.
        let limits = CopyLimits {
            max_total: 12,
            ..CopyLimits::default()
        };
        let (entries, left_out) = collect_review_manifest_limited(
            workspace.path(),
            &known,
            &CancellationToken::new(),
            limits,
        )
        .unwrap();
        assert_eq!(entries.len(), 3 + 2);
        assert_eq!(left_out, 3);
    }

    #[test]
    fn totals_still_fail_with_a_data_folder_hint() {
        let project = tempfile::tempdir().unwrap();
        std::fs::write(project.path().join("a.bin"), vec![0u8; 600]).unwrap();
        std::fs::write(project.path().join("b.bin"), vec![0u8; 600]).unwrap();
        let limits = CopyLimits {
            max_total: 1000,
            ..CopyLimits::default()
        };
        let error = collect_manifest_limited(project.path(), &CancellationToken::new(), limits)
            .unwrap_err();
        assert!(error.contains("data folder"), "{error}");
    }

    #[cfg(unix)]
    #[test]
    fn links_inside_are_resolved_and_others_skipped() {
        let project = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        let root = project.path();
        std::fs::write(root.join("real.txt"), "real").unwrap();
        std::fs::create_dir(root.join("folder")).unwrap();
        std::fs::write(outside.path().join("secret.txt"), "secret").unwrap();
        std::os::unix::fs::symlink(root.join("real.txt"), root.join("inside.txt")).unwrap();
        std::os::unix::fs::symlink(outside.path().join("secret.txt"), root.join("outside.txt"))
            .unwrap();
        std::os::unix::fs::symlink(root.join("folder"), root.join("folder-link")).unwrap();
        std::os::unix::fs::symlink(root.join("missing.txt"), root.join("broken.txt")).unwrap();
        let (entries, skipped) =
            collect_manifest_limited(root, &CancellationToken::new(), CopyLimits::default())
                .unwrap();
        let inside = entries
            .iter()
            .find(|entry| entry.path == "inside.txt")
            .unwrap();
        assert!(inside.resolved_link);
        let reasons: BTreeMap<&str, SkipReason> = skipped
            .iter()
            .map(|entry| (entry.path.as_str(), entry.reason))
            .collect();
        assert_eq!(reasons["outside.txt"], SkipReason::LinkOutside);
        assert_eq!(reasons["folder-link"], SkipReason::LinkToFolder);
        assert_eq!(reasons["broken.txt"], SkipReason::BrokenLink);
    }

    #[test]
    fn old_manifest_entries_deserialize() {
        let entry: ManifestEntry =
            serde_json::from_str(r#"{"path":"a.tex","sha256":"x","size":1}"#).unwrap();
        assert!(!entry.resolved_link);
    }
}

#[cfg(test)]
mod tests;
