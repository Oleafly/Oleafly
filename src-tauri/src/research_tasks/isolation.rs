use std::collections::{BTreeMap, BTreeSet};
use std::fs::{self, File};
use std::io::{Read, Seek, Write};
use std::path::{Component, Path, PathBuf};
use std::process::Stdio;
use std::time::{Duration, Instant};

use oleafly_agent::CancellationToken;
use sha2::{Digest, Sha256};

use super::model::{
    now_ms, ManifestEntry, ResearchTask, TaskFileChange, TaskFileChangeKind, TaskIsolation,
    TaskIsolationKind,
};
use super::store::TaskStore;

const MAX_FILES: usize = 20_000;
const MAX_FILE_BYTES: u64 = 64 * 1024 * 1024;
const MAX_TOTAL_BYTES: u64 = 2 * 1024 * 1024 * 1024;
const MAX_GIT_OUTPUT_BYTES: u64 = 64 * 1024;
const GIT_COMMAND_TIMEOUT: Duration = Duration::from_secs(60);

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
    "figures",
    "references",
    "research",
    "review",
    "sections",
    "supplement",
    "supplementary",
];

const ALLOWED_EXTENSIONS: &[&str] = &[
    "bib", "bst", "cls", "css", "csv", "eps", "gif", "html", "ipynb", "jpeg", "jpg", "jl", "js",
    "json", "md", "m", "pdf", "png", "py", "r", "sh", "sty", "svg", "tex", "toml", "ts", "tsv",
    "txt", "typ", "webp", "xml", "yaml", "yml",
];

pub(crate) fn prepare(
    store: &TaskStore,
    task: &ResearchTask,
    cancel: &CancellationToken,
) -> Result<TaskIsolation, String> {
    let project_root = crate::paths::project_dir(&task.project_id)?;
    let _worktree = crate::worktree_lock::ProjectWorktreeLock::shared(&task.project_id)?;
    let generation_root = store
        .root()
        .join("workspaces")
        .join(&task.id)
        .join(task.execution_generation.to_string());
    prepare_at(&project_root, &generation_root, cancel)
}

fn prepare_at(
    project_root: &Path,
    generation_root: &Path,
    cancel: &CancellationToken,
) -> Result<TaskIsolation, String> {
    validate_real_root(project_root, "project")?;
    if cancel.is_cancelled() {
        return Err("The task was cancelled before isolation was ready.".into());
    }
    let baseline = collect_manifest(project_root, cancel)?;
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
            .and_then(|name| name.to_str())
            .ok_or_else(|| "The task workspace name is invalid.".to_string())?
    ));
    reject_existing(&baseline_root)?;
    let prepared = (|| {
        fs::create_dir(&baseline_root)
            .map_err(|error| format!("could not create the task baseline: {error}"))?;
        copy_manifest(project_root, &baseline_root, &baseline, cancel)?;
        let git = exact_git_root(project_root, cancel)?;
        let (kind, revision) = if let Some(head) = git {
            create_git_worktree(project_root, generation_root, &head, cancel)?;
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
        })
    })();
    if prepared.is_err() {
        cleanup_incomplete_workspace(project_root, generation_root, &baseline_root);
    }
    prepared
}

pub(crate) fn collect_review_changes(
    isolation: &TaskIsolation,
    cancel: &CancellationToken,
) -> Result<Vec<TaskFileChange>, String> {
    let root = PathBuf::from(&isolation.execution_root);
    validate_real_root(&root, "task workspace")?;
    let current = collect_manifest(&root, cancel)?;
    let baseline: BTreeMap<_, _> = isolation
        .baseline
        .iter()
        .map(|entry| (entry.path.clone(), entry))
        .collect();
    let after: BTreeMap<_, _> = current
        .iter()
        .map(|entry| (entry.path.clone(), entry))
        .collect();
    let allowed: BTreeSet<_> = isolation.allowed_paths.iter().cloned().collect();
    for path in after.keys() {
        if !baseline.contains_key(path) && !path_is_allowed(path, &allowed) {
            return Err(format!(
                "The task created {path}, which is outside its allowed project paths. Its workspace was kept for review."
            ));
        }
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
    Ok(changes)
}

pub(crate) fn hash_file(path: &Path) -> Result<(String, u64), String> {
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

pub(crate) fn normalized_relative(path: &str) -> Result<PathBuf, String> {
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

fn collect_manifest(root: &Path, cancel: &CancellationToken) -> Result<Vec<ManifestEntry>, String> {
    let mut entries = Vec::new();
    let mut total_bytes = 0u64;
    collect_directory(root, root, cancel, &mut entries, &mut total_bytes)?;
    entries.sort_by(|left, right| left.path.cmp(&right.path));
    Ok(entries)
}

fn collect_directory(
    root: &Path,
    directory: &Path,
    cancel: &CancellationToken,
    entries: &mut Vec<ManifestEntry>,
    total_bytes: &mut u64,
) -> Result<(), String> {
    if cancel.is_cancelled() {
        return Err("The task was cancelled while its workspace was being prepared.".into());
    }
    let mut children = fs::read_dir(directory)
        .map_err(|error| format!("could not read {}: {error}", directory.display()))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("could not read {}: {error}", directory.display()))?;
    children.sort_by_key(|entry| entry.file_name());
    for child in children {
        let path = child.path();
        let relative = path
            .strip_prefix(root)
            .map_err(|_| "A task source path escaped the project.".to_string())?;
        let portable = portable_path(relative)?;
        if excluded_path(&portable) {
            continue;
        }
        let metadata = fs::symlink_metadata(&path)
            .map_err(|error| format!("could not inspect {}: {error}", path.display()))?;
        if metadata.file_type().is_symlink() {
            return Err(format!(
                "The task cannot use symbolic link {portable}. Remove it or keep that content outside the task."
            ));
        }
        if metadata.is_dir() {
            collect_directory(root, &path, cancel, entries, total_bytes)?;
            continue;
        }
        if !metadata.is_file() || !allowed_file(&portable) {
            continue;
        }
        if entries.len() >= MAX_FILES {
            return Err("The project has more than 20,000 task files.".into());
        }
        let (sha256, size) = hash_file(&path)?;
        *total_bytes = total_bytes
            .checked_add(size)
            .ok_or_else(|| "The task source is too large.".to_string())?;
        if *total_bytes > MAX_TOTAL_BYTES {
            return Err("The task source is larger than 2 GiB.".into());
        }
        entries.push(ManifestEntry {
            path: portable,
            sha256,
            size,
        });
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
        let from = source.join(&relative);
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
        copy_file(&from, &to)?;
        let (copied_hash, _) = hash_file(&to)?;
        if copied_hash != entry.sha256 {
            return Err(format!("Could not verify the task copy of {}.", entry.path));
        }
    }
    Ok(())
}

fn run_git(
    project: &Path,
    arguments: &[String],
    cancel: &CancellationToken,
) -> Result<Option<std::process::Output>, String> {
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .map_err(|error| format!("could not prepare the Git process runtime: {error}"))?;
    let _runtime = runtime.enter();
    let mut stdout = tempfile::tempfile()
        .map_err(|error| format!("could not create a Git output file: {error}"))?;
    let mut stderr = tempfile::tempfile()
        .map_err(|error| format!("could not create a Git error file: {error}"))?;
    let mut command = tokio::process::Command::new("git");
    command
        .arg("-c")
        .arg(format!("core.hooksPath={}", git_null_device()))
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
    crate::proc::isolate_process_tree(&mut command);
    let mut child = match command.spawn() {
        Ok(child) => child,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(format!("could not start Git task isolation: {error}")),
    };
    let pid = child
        .id()
        .ok_or_else(|| "The Git isolation process has no process ID.".to_string())?;
    let mut containment = Some(crate::proc::contain_process_tree(pid).map_err(|error| {
        let _ = child.start_kill();
        format!("could not contain Git task isolation: {error}")
    })?);
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

fn cleanup_incomplete_workspace(project: &Path, workspace: &Path, baseline: &Path) {
    if workspace.exists() {
        let arguments = [
            "worktree".to_string(),
            "remove".to_string(),
            "--force".to_string(),
            workspace.to_string_lossy().into_owned(),
        ];
        let _ = run_git(project, &arguments, &CancellationToken::new());
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

fn git_null_device() -> &'static str {
    if cfg!(windows) {
        "NUL"
    } else {
        "/dev/null"
    }
}

fn create_git_worktree(
    project: &Path,
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
    let output = run_git(project, &arguments, cancel)?
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

fn exact_git_root(project: &Path, cancel: &CancellationToken) -> Result<Option<String>, String> {
    let arguments = [
        "rev-parse".to_string(),
        "--show-toplevel".to_string(),
        "HEAD".to_string(),
    ];
    let Some(output) = run_git(project, &arguments, cancel)? else {
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
    paths.extend(OUTPUT_DIRECTORIES.iter().map(|path| path.to_string()));
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

fn allowed_file(path: &str) -> bool {
    let file_name = Path::new(path)
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or_default();
    let lower = file_name.to_ascii_lowercase();
    if is_sensitive_component(&lower) {
        return false;
    }
    if matches!(lower.as_str(), "project.json" | "makefile" | "latexmkrc") {
        return true;
    }
    Path::new(&lower)
        .extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| ALLOWED_EXTENSIONS.contains(&extension))
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
                .and_then(|value| value.to_str()),
            Some("key" | "pem" | "p12" | "pfx")
        )
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
    let mut output = crate::sandbox::AtomicFile::new(destination)?;
    std::io::copy(&mut input, output.staging_file_mut())
        .map_err(|error| format!("could not copy {}: {error}", source.display()))?;
    output
        .staging_file_mut()
        .set_permissions(permissions)
        .map_err(|error| {
            format!(
                "could not preserve {} permissions: {error}",
                source.display()
            )
        })?;
    output
        .staging_file_mut()
        .flush()
        .and_then(|_| output.staging_file_mut().sync_all())
        .map_err(|error| format!("could not save {}: {error}", destination.display()))?;
    output.commit()
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

#[cfg(test)]
mod tests {
    use std::process::Command;

    use super::*;

    #[test]
    fn staged_isolation_copies_dirty_files_without_touching_the_source() {
        let temp = tempfile::tempdir().unwrap();
        let project = temp.path().join("project");
        fs::create_dir(&project).unwrap();
        fs::write(project.join("main.tex"), "dirty manuscript").unwrap();
        fs::write(project.join(".env"), "SECRET=hidden").unwrap();
        fs::create_dir(project.join(".Private")).unwrap();
        fs::write(project.join(".Private/notes.md"), "private research").unwrap();
        let destination = temp.path().join("managed").join("task").join("1");

        let isolation = prepare_at(&project, &destination, &CancellationToken::new()).unwrap();

        assert_eq!(isolation.kind, TaskIsolationKind::StagedProject);
        assert_eq!(
            fs::read_to_string(project.join("main.tex")).unwrap(),
            "dirty manuscript"
        );
        assert_eq!(
            fs::read_to_string(destination.join("main.tex")).unwrap(),
            "dirty manuscript"
        );
        assert!(!destination.join(".env").exists());
        assert!(!destination.join(".Private").exists());
    }

    #[cfg(unix)]
    #[test]
    fn staged_isolation_preserves_executable_permissions() {
        use std::os::unix::fs::PermissionsExt;

        let temp = tempfile::tempdir().unwrap();
        let project = temp.path().join("project");
        fs::create_dir(&project).unwrap();
        let script = project.join("analysis.sh");
        fs::write(&script, "#!/bin/sh\n").unwrap();
        fs::set_permissions(&script, fs::Permissions::from_mode(0o755)).unwrap();
        let destination = temp.path().join("managed/task/1");

        prepare_at(&project, &destination, &CancellationToken::new()).unwrap();

        assert_ne!(
            fs::metadata(destination.join("analysis.sh"))
                .unwrap()
                .permissions()
                .mode()
                & 0o111,
            0
        );
    }

    #[test]
    fn source_symlinks_are_rejected() {
        let temp = tempfile::tempdir().unwrap();
        let project = temp.path().join("project");
        fs::create_dir(&project).unwrap();
        fs::write(project.join("outside.tex"), "outside").unwrap();
        let link = project.join("main.tex");
        #[cfg(unix)]
        std::os::unix::fs::symlink(project.join("outside.tex"), &link).unwrap();
        #[cfg(windows)]
        std::os::windows::fs::symlink_file(project.join("outside.tex"), &link).unwrap();

        let error = prepare_at(
            &project,
            &temp.path().join("managed/task/1"),
            &CancellationToken::new(),
        )
        .unwrap_err();

        assert!(error.contains("symbolic link"));
    }

    #[test]
    fn cancellation_stops_snapshot_creation_before_files_are_copied() {
        let temp = tempfile::tempdir().unwrap();
        let project = temp.path().join("project");
        fs::create_dir(&project).unwrap();
        fs::write(project.join("main.tex"), "manuscript").unwrap();
        let cancel = CancellationToken::new();
        cancel.cancel();

        let error = prepare_at(&project, &temp.path().join("managed/task/1"), &cancel).unwrap_err();

        assert!(error.contains("cancelled"));
        assert!(!temp.path().join("managed/task/1").exists());
    }

    #[test]
    fn review_rejects_output_outside_the_path_allowlist() {
        let temp = tempfile::tempdir().unwrap();
        let project = temp.path().join("project");
        fs::create_dir(&project).unwrap();
        fs::write(project.join("main.tex"), "manuscript").unwrap();
        let destination = temp.path().join("managed/task/1");
        let isolation = prepare_at(&project, &destination, &CancellationToken::new()).unwrap();
        fs::write(destination.join("surprise.tex"), "unexpected").unwrap();

        let error = collect_review_changes(&isolation, &CancellationToken::new()).unwrap_err();

        assert!(error.contains("outside its allowed"));
    }

    #[cfg(unix)]
    #[test]
    fn a_tracked_symlink_cannot_redirect_the_dirty_overlay() {
        let temp = tempfile::tempdir().unwrap();
        let project = temp.path().join("project");
        let victim = temp.path().join("victim.tex");
        fs::create_dir(&project).unwrap();
        fs::write(&victim, "do not touch").unwrap();
        let run = |arguments: &[&str]| {
            let output = Command::new("git")
                .arg("-C")
                .arg(&project)
                .args(arguments)
                .output()
                .unwrap();
            assert!(
                output.status.success(),
                "{}",
                String::from_utf8_lossy(&output.stderr)
            );
        };
        run(&["init"]);
        run(&["config", "user.name", "Fixture"]);
        run(&["config", "user.email", "fixture@example.invalid"]);
        let hook = project.join(".git/hooks/post-checkout");
        fs::write(&hook, "#!/bin/sh\nexit 91\n").unwrap();
        use std::os::unix::fs::PermissionsExt;
        let mut permissions = fs::metadata(&hook).unwrap().permissions();
        permissions.set_mode(0o755);
        fs::set_permissions(&hook, permissions).unwrap();
        std::os::unix::fs::symlink(&victim, project.join("main.tex")).unwrap();
        run(&["add", "main.tex"]);
        run(&["commit", "-m", "fixture"]);
        fs::remove_file(project.join("main.tex")).unwrap();
        fs::write(project.join("main.tex"), "dirty manuscript").unwrap();

        let destination = temp.path().join("managed/task/1");
        let isolation = prepare_at(&project, &destination, &CancellationToken::new()).unwrap();

        assert_eq!(isolation.kind, TaskIsolationKind::GitWorktree);
        assert_eq!(fs::read_to_string(&victim).unwrap(), "do not touch");
        assert_eq!(
            fs::read_to_string(destination.join("main.tex")).unwrap(),
            "dirty manuscript"
        );
        let metadata = fs::symlink_metadata(destination.join("main.tex")).unwrap();
        assert!(metadata.is_file());
        assert!(!metadata.file_type().is_symlink());
    }
}
