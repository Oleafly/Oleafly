use std::collections::{BTreeMap, BTreeSet};
use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Component, Path, PathBuf};

use cap_fs_ext::{DirExt, FollowSymlinks, OpenOptionsFollowExt, OpenOptionsSyncExt};
use cap_std::fs::{Dir, OpenOptions};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

#[cfg(test)]
use super::isolation::hash_file;
use super::isolation::normalized_relative;
use super::model::{ResearchTask, TaskFileChange, TaskFileChangeKind};
use super::store::TaskStore;

const MAX_APPLY_PLAN_BYTES: usize = 1024 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ApplyPlan {
    task_id: String,
    project_id: String,
    execution_generation: u64,
    phase: ApplyPhase,
    applied_count: usize,
    changes: Vec<TaskFileChange>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
enum ApplyPhase {
    Preparing,
    Applying,
    Applied,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum ApplyFault {
    None,
    #[cfg(test)]
    InterruptAfterFirst,
}

pub(crate) fn apply_review(
    store: &TaskStore,
    task: &ResearchTask,
    project_root: &Path,
    selected_paths: &[String],
) -> Result<bool, String> {
    apply_review_with_fault(store, task, project_root, selected_paths, ApplyFault::None)
}

fn apply_review_with_fault(
    store: &TaskStore,
    task: &ResearchTask,
    project_root: &Path,
    selected_paths: &[String],
    fault: ApplyFault,
) -> Result<bool, String> {
    #[cfg(not(test))]
    let _ = fault;
    let isolation = task
        .isolation
        .as_ref()
        .ok_or_else(|| "This task has no saved workspace to apply.".to_string())?;
    let result = task
        .result
        .as_ref()
        .ok_or_else(|| "This task has no reviewed result to apply.".to_string())?;
    let selected = selected_changes(&result.changed_files, selected_paths)?;
    if selected.is_empty() {
        return Err("Select at least one changed file to apply.".into());
    }
    validate_real_directory(project_root, "project")?;
    let execution_root = PathBuf::from(&isolation.execution_root);
    validate_real_directory(&execution_root, "task workspace")?;
    let project_files = RootFiles::open(project_root)?;
    let execution_files = RootFiles::open(&execution_root)?;
    validate_base(&project_files, &selected)?;
    validate_outputs(&execution_files, &selected)?;
    let mut plan = ApplyPlan {
        task_id: task.id.clone(),
        project_id: task.project_id.clone(),
        execution_generation: task.execution_generation,
        phase: ApplyPhase::Preparing,
        applied_count: 0,
        changes: selected,
    };
    let mut largest_plan = plan.clone();
    largest_plan.phase = ApplyPhase::Applied;
    largest_plan.applied_count = largest_plan.changes.len();
    encode_plan(&largest_plan)?;
    let journal = journal_dir(store, task);
    reject_existing_journal(&journal)?;
    create_real_directories(&journal)?;
    if let Err(error) = write_plan(&journal, &plan) {
        let _ = retire_journal(&journal, "unused");
        return Err(error);
    }
    let backups = journal.join("backups");
    if let Err(error) = prepare_backups(&project_files, &backups, &plan.changes) {
        let cleanup = retire_journal(&journal, "unused");
        return Err(match cleanup {
            Ok(()) => error,
            Err(cleanup_error) => {
                format!("{error} The apply journal also could not be cleared: {cleanup_error}")
            }
        });
    }
    plan.phase = ApplyPhase::Applying;
    write_plan(&journal, &plan)?;
    for index in 0..plan.changes.len() {
        plan.applied_count = index + 1;
        write_plan(&journal, &plan)?;
        if let Err(error) = apply_one(
            &project_files,
            &execution_files,
            &journal,
            &plan.changes[index],
        ) {
            let rollback = rollback(project_root, &journal, &plan);
            return Err(match rollback {
                Ok(()) => error,
                Err(rollback_error) => {
                    format!("{error} The apply rollback also stopped: {rollback_error}")
                }
            });
        }
        #[cfg(test)]
        if fault == ApplyFault::InterruptAfterFirst && index == 0 {
            return Err("injected interrupted task apply".into());
        }
    }
    plan.phase = ApplyPhase::Applied;
    write_plan(&journal, &plan)?;
    retire_journal(&journal, "completed")?;
    Ok(true)
}

pub(crate) fn has_recovery_journal(store: &TaskStore, task: &ResearchTask) -> Result<bool, String> {
    let journal = journal_dir(store, task);
    match fs::symlink_metadata(journal) {
        Ok(metadata) if metadata.is_dir() && !metadata.file_type().is_symlink() => Ok(true),
        Ok(_) => Err("The task apply journal is not a real directory.".into()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(format!("could not inspect the task apply journal: {error}")),
    }
}

fn prepare_backups(
    project_files: &RootFiles,
    backups: &Path,
    changes: &[TaskFileChange],
) -> Result<(), String> {
    create_real_directories(backups)?;
    let backup_files = RootFiles::open(backups)?;
    for change in changes {
        if change.before_sha256.is_some() {
            let relative = normalized_relative(&change.path)?;
            project_files.copy_to(
                &relative,
                &backup_files,
                &relative,
                change.before_sha256.as_deref(),
            )?;
        }
    }
    Ok(())
}

pub(crate) fn recover_pending_apply(
    store: &TaskStore,
    task: &ResearchTask,
    project_root: &Path,
    selected_paths: &[String],
) -> Result<bool, String> {
    let journal = journal_dir(store, task);
    match fs::symlink_metadata(&journal) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return selection_is_fully_applied(task, project_root, selected_paths)
        }
        Err(error) => return Err(format!("could not inspect the task apply journal: {error}")),
        Ok(metadata) if metadata.is_dir() && !metadata.file_type().is_symlink() => {}
        Ok(_) => return Err("The task apply journal is not a real directory.".into()),
    }
    let plan = read_plan(&journal)?;
    if plan.task_id != task.id
        || plan.project_id != task.project_id
        || plan.execution_generation != task.execution_generation
    {
        return Err("The task apply journal does not match this task.".into());
    }
    if plan.phase == ApplyPhase::Applied {
        if !selection_is_fully_applied(task, project_root, selected_paths)? {
            return Err("A completed task apply changed before recovery could record it.".into());
        }
        retire_journal(&journal, "completed")?;
        return Ok(true);
    }
    if plan.phase == ApplyPhase::Preparing && plan.applied_count == 0 {
        retire_journal(&journal, "unused")?;
        return Ok(false);
    }
    rollback(project_root, &journal, &plan)?;
    Ok(false)
}

fn selection_is_fully_applied(
    task: &ResearchTask,
    project_root: &Path,
    selected_paths: &[String],
) -> Result<bool, String> {
    let project_files = RootFiles::open(project_root)?;
    let result = task
        .result
        .as_ref()
        .ok_or_else(|| "The interrupted task apply has no result metadata.".to_string())?;
    let changes: BTreeMap<_, _> = result
        .changed_files
        .iter()
        .map(|change| (change.path.as_str(), change))
        .collect();
    if selected_paths.is_empty() {
        return Ok(false);
    }
    for path in selected_paths {
        let Some(change) = changes.get(path.as_str()) else {
            return Ok(false);
        };
        if project_files.hash(&normalized_relative(path)?)? != change.after_sha256 {
            return Ok(false);
        }
    }
    Ok(true)
}

fn selected_changes(
    changes: &[TaskFileChange],
    selected_paths: &[String],
) -> Result<Vec<TaskFileChange>, String> {
    let selected: BTreeSet<_> = selected_paths
        .iter()
        .map(|path| {
            normalized_relative(path)?;
            Ok(path.clone())
        })
        .collect::<Result<_, String>>()?;
    if selected.len() != selected_paths.len() {
        return Err("A reviewed path was selected more than once.".into());
    }
    let by_path: BTreeMap<_, _> = changes
        .iter()
        .map(|change| (change.path.as_str(), change))
        .collect();
    selected
        .into_iter()
        .map(|path| {
            by_path
                .get(path.as_str())
                .cloned()
                .cloned()
                .ok_or_else(|| format!("{path} is not part of the reviewed task result."))
        })
        .collect()
}

fn validate_base(project_files: &RootFiles, changes: &[TaskFileChange]) -> Result<(), String> {
    for change in changes {
        let current = project_files.hash(&normalized_relative(&change.path)?)?;
        if current != change.before_sha256 {
            return Err(format!(
                "{} changed after this task started. The task result is still available; review it against the current file before applying again.",
                change.path
            ));
        }
    }
    Ok(())
}

fn validate_outputs(execution_files: &RootFiles, changes: &[TaskFileChange]) -> Result<(), String> {
    for change in changes {
        let current = execution_files.hash(&normalized_relative(&change.path)?)?;
        if current != change.after_sha256 {
            return Err(format!(
                "The saved task output for {} changed after review. Run the task again before applying it.",
                change.path
            ));
        }
    }
    Ok(())
}

fn apply_one(
    project_files: &RootFiles,
    execution_files: &RootFiles,
    journal: &Path,
    change: &TaskFileChange,
) -> Result<(), String> {
    let relative = normalized_relative(&change.path)?;
    match change.kind {
        TaskFileChangeKind::Deleted => {
            project_files.remove(&relative)?;
        }
        TaskFileChangeKind::Added | TaskFileChangeKind::Modified => {
            let incoming_root = journal.join("incoming");
            create_real_directories(&incoming_root)?;
            let incoming_files = RootFiles::open(&incoming_root)?;
            execution_files.copy_to(
                &relative,
                &incoming_files,
                &relative,
                change.after_sha256.as_deref(),
            )?;
            incoming_files.copy_to(
                &relative,
                project_files,
                &relative,
                change.after_sha256.as_deref(),
            )?;
        }
    }
    Ok(())
}

fn rollback(project_root: &Path, journal: &Path, plan: &ApplyPlan) -> Result<(), String> {
    let project_files = RootFiles::open(project_root)?;
    let mut backup_files = None;
    for change in plan.changes.iter().take(plan.applied_count).rev() {
        let relative = normalized_relative(&change.path)?;
        let current = project_files.hash(&relative)?;
        if current == change.before_sha256 {
            continue;
        }
        if current != change.after_sha256 {
            return Err(format!(
                "{} changed while an interrupted task apply was being recovered.",
                change.path
            ));
        }
        match &change.before_sha256 {
            Some(expected) => {
                if backup_files.is_none() {
                    backup_files = Some(RootFiles::open(&journal.join("backups"))?);
                }
                let backup_files = backup_files
                    .as_ref()
                    .ok_or_else(|| "The task apply backup is unavailable.".to_string())?;
                backup_files.copy_to(&relative, &project_files, &relative, Some(expected))?;
            }
            None => {
                if project_files.hash(&relative)?.is_some() {
                    project_files.remove(&relative)?;
                }
            }
        }
    }
    retire_journal(journal, "recovered")
}

struct RootFiles {
    directory: Dir,
}

impl RootFiles {
    fn open(root: &Path) -> Result<Self, String> {
        validate_real_directory(root, "file root")?;
        let root = root
            .canonicalize()
            .map_err(|error| format!("could not resolve a task file root: {error}"))?;
        let directory = Dir::open_ambient_dir(root, cap_std::ambient_authority())
            .map_err(|error| format!("could not open a task file root: {error}"))?;
        Ok(Self { directory })
    }

    fn parent(&self, path: &Path, create: bool) -> Result<Option<(Dir, PathBuf)>, String> {
        let components = path.components().collect::<Vec<_>>();
        let (name, parents) = components
            .split_last()
            .ok_or_else(|| "A task file path is empty.".to_string())?;
        let mut directory = self
            .directory
            .try_clone()
            .map_err(|error| format!("could not clone a task directory handle: {error}"))?;
        for component in parents {
            let Component::Normal(_) = component else {
                return Err("A task file path is not normalized.".into());
            };
            let name = Path::new(component.as_os_str());
            if create {
                match directory.create_dir(name) {
                    Ok(()) => {}
                    Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {}
                    Err(error) => {
                        return Err(format!("could not create a task file directory: {error}"))
                    }
                }
            }
            directory = match directory.open_dir_nofollow(name) {
                Ok(directory) => directory,
                Err(error) if !create && error.kind() == std::io::ErrorKind::NotFound => {
                    return Ok(None)
                }
                Err(_) => return Err("A task file parent changed or is a symbolic link.".into()),
            };
        }
        let Component::Normal(_) = name else {
            return Err("A task file path is not normalized.".into());
        };
        Ok(Some((directory, PathBuf::from(name.as_os_str()))))
    }

    fn hash(&self, path: &Path) -> Result<Option<String>, String> {
        let Some((directory, name)) = self.parent(path, false)? else {
            return Ok(None);
        };
        let mut options = OpenOptions::new();
        options.read(true).follow(FollowSymlinks::No).nonblock(true);
        let mut file = match directory.open_with(&name, &options) {
            Ok(file) => file,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(error) => return Err(format!("could not open a task file safely: {error}")),
        };
        let metadata = file
            .metadata()
            .map_err(|error| format!("could not inspect a task file: {error}"))?;
        if !metadata.is_file() || metadata.len() > 64 * 1024 * 1024 {
            return Err("A task file is not a regular file within the 64 MiB limit.".into());
        }
        let mut hasher = Sha256::new();
        let mut buffer = [0u8; 64 * 1024];
        loop {
            let read = file
                .read(&mut buffer)
                .map_err(|error| format!("could not read a task file: {error}"))?;
            if read == 0 {
                break;
            }
            hasher.update(&buffer[..read]);
        }
        Ok(Some(format!("{:x}", hasher.finalize())))
    }

    fn copy_to(
        &self,
        source: &Path,
        destination_root: &RootFiles,
        destination: &Path,
        expected: Option<&str>,
    ) -> Result<(), String> {
        let (source_directory, source_name) = self
            .parent(source, false)?
            .ok_or_else(|| "A reviewed task source file is missing.".to_string())?;
        let mut read_options = OpenOptions::new();
        read_options
            .read(true)
            .follow(FollowSymlinks::No)
            .nonblock(true);
        let mut input = source_directory
            .open_with(source_name, &read_options)
            .map_err(|error| format!("could not open a task source file safely: {error}"))?;
        let source_metadata = input
            .metadata()
            .map_err(|error| format!("could not inspect a task source file: {error}"))?;
        if !source_metadata.is_file() || source_metadata.len() > 64 * 1024 * 1024 {
            return Err("A task source is not a regular file within the 64 MiB limit.".into());
        }
        let (destination_directory, destination_name) = destination_root
            .parent(destination, true)?
            .ok_or_else(|| "A task destination parent is missing.".to_string())?;
        match destination_directory.symlink_metadata(&destination_name) {
            Ok(metadata) if !metadata.is_file() || metadata.is_symlink() => {
                return Err("A task destination is not a regular file.".into())
            }
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(format!("could not inspect a task destination: {error}")),
        }
        let staging = format!(".task-apply-{:032x}", rand::random::<u128>());
        let mut write_options = OpenOptions::new();
        write_options
            .write(true)
            .create_new(true)
            .follow(FollowSymlinks::No);
        let result: Result<(), String> = (|| {
            let mut output = destination_directory
                .open_with(&staging, &write_options)
                .map_err(|error| format!("could not create a task staging file: {error}"))?;
            std::io::copy(&mut input, &mut output)
                .map_err(|error| format!("could not copy a task file: {error}"))?;
            output
                .set_permissions(source_metadata.permissions())
                .map_err(|error| format!("could not preserve task file permissions: {error}"))?;
            output
                .flush()
                .and_then(|_| output.sync_all())
                .map_err(|error| format!("could not save a task staging file: {error}"))?;
            drop(output);
            if let Some(expected) = expected {
                let staging_path = Path::new(&staging);
                if Self::hash_in(&destination_directory, staging_path)?
                    != Some(expected.to_string())
                {
                    return Err("A staged task file did not match its reviewed hash.".into());
                }
            }
            destination_directory
                .rename(&staging, &destination_directory, &destination_name)
                .map_err(|error| format!("could not install a task file: {error}"))?;
            Ok(())
        })();
        if result.is_err() {
            let _ = destination_directory.remove_file(&staging);
        }
        result?;
        if let Some(expected) = expected {
            if destination_root.hash(destination)? != Some(expected.to_string()) {
                return Err("An installed task file did not match its reviewed hash.".into());
            }
        }
        Ok(())
    }

    fn hash_in(directory: &Dir, name: &Path) -> Result<Option<String>, String> {
        let mut options = OpenOptions::new();
        options.read(true).follow(FollowSymlinks::No).nonblock(true);
        let mut file = directory
            .open_with(name, &options)
            .map_err(|error| format!("could not verify a staged task file: {error}"))?;
        let mut hasher = Sha256::new();
        let mut buffer = [0u8; 64 * 1024];
        loop {
            let read = file
                .read(&mut buffer)
                .map_err(|error| format!("could not verify a staged task file: {error}"))?;
            if read == 0 {
                break;
            }
            hasher.update(&buffer[..read]);
        }
        Ok(Some(format!("{:x}", hasher.finalize())))
    }

    fn remove(&self, path: &Path) -> Result<(), String> {
        let (directory, name) = self
            .parent(path, false)?
            .ok_or_else(|| "A reviewed task deletion is already missing.".to_string())?;
        let metadata = directory
            .symlink_metadata(&name)
            .map_err(|error| format!("could not inspect a task deletion: {error}"))?;
        if !metadata.is_file() || metadata.is_symlink() {
            return Err("A task deletion no longer points to a regular file.".into());
        }
        directory
            .remove_file(name)
            .map_err(|error| format!("could not delete a reviewed task file: {error}"))
    }
}

fn write_plan(journal: &Path, plan: &ApplyPlan) -> Result<(), String> {
    let encoded = encode_plan(plan)?;
    crate::sandbox::atomic_write(&journal.join("plan.json"), &encoded)
}

fn encode_plan(plan: &ApplyPlan) -> Result<Vec<u8>, String> {
    let encoded = serde_json::to_vec(plan)
        .map_err(|error| format!("could not encode the task apply journal: {error}"))?;
    if encoded.len() > MAX_APPLY_PLAN_BYTES {
        return Err("The reviewed selection is too large to apply safely.".into());
    }
    Ok(encoded)
}

fn read_plan(journal: &Path) -> Result<ApplyPlan, String> {
    let path = journal.join("plan.json");
    let metadata = fs::symlink_metadata(&path)
        .map_err(|error| format!("could not inspect the task apply journal: {error}"))?;
    if !metadata.is_file()
        || metadata.file_type().is_symlink()
        || metadata.len() > MAX_APPLY_PLAN_BYTES as u64
    {
        return Err("The task apply journal is invalid.".into());
    }
    let mut bytes = Vec::with_capacity(metadata.len() as usize);
    File::open(&path)
        .and_then(|mut file| file.read_to_end(&mut bytes))
        .map_err(|error| format!("could not read the task apply journal: {error}"))?;
    serde_json::from_slice(&bytes)
        .map_err(|error| format!("could not decode the task apply journal: {error}"))
}

fn journal_dir(store: &TaskStore, task: &ResearchTask) -> PathBuf {
    store
        .root()
        .join("apply")
        .join(&task.id)
        .join(task.execution_generation.to_string())
}

fn create_real_directories(path: &Path) -> Result<(), String> {
    fs::create_dir_all(path)
        .map_err(|error| format!("could not create the task apply directory: {error}"))?;
    validate_real_directory(path, "task apply directory")
}
fn validate_real_directory(path: &Path, label: &str) -> Result<(), String> {
    let metadata = fs::symlink_metadata(path)
        .map_err(|error| format!("could not inspect the {label}: {error}"))?;
    if !metadata.is_dir() || metadata.file_type().is_symlink() {
        return Err(format!("The {label} is not a real directory."));
    }
    Ok(())
}

fn reject_existing_journal(path: &Path) -> Result<(), String> {
    match fs::symlink_metadata(path) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!("could not inspect the task apply journal: {error}")),
        Ok(_) => Err("An unfinished apply already exists for this task.".into()),
    }
}

fn retire_journal(journal: &Path, reason: &str) -> Result<(), String> {
    let parent = journal
        .parent()
        .ok_or_else(|| "The task apply journal has no parent directory.".to_string())?;
    let retired = parent.join(format!(
        ".{}-{reason}-{:032x}",
        journal
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("apply"),
        rand::random::<u128>()
    ));
    fs::rename(journal, &retired)
        .map_err(|error| format!("could not retire the task apply journal: {error}"))?;
    let _ = fs::remove_dir_all(&retired);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::research_tasks::model::{
        now_ms, ManifestEntry, ResearchTaskStatus, TaskIsolation, TaskIsolationKind,
        TaskResultMetadata,
    };

    fn task(project: &Path, execution: &Path, before: &str, after: &str) -> ResearchTask {
        let (before_hash, before_size) = hash_file(&project.join("main.tex")).unwrap();
        let (after_hash, after_size) = hash_file(&execution.join("main.tex")).unwrap();
        assert_eq!(
            fs::read_to_string(project.join("main.tex")).unwrap(),
            before
        );
        assert_eq!(
            fs::read_to_string(execution.join("main.tex")).unwrap(),
            after
        );
        ResearchTask {
            id: "task-one".into(),
            project_id: "paper".into(),
            title: "Revise".into(),
            prompt: "Revise the manuscript".into(),
            runtime_id: "fixture".into(),
            agent_id: "fixture".into(),
            model_id: "fixture".into(),
            skill_ids: Vec::new(),
            dependency_ids: Vec::new(),
            status: ResearchTaskStatus::AwaitingReview,
            execution_generation: 1,
            session_id: Some("session".into()),
            native_session_id: None,
            source_revision: Some("snapshot:before".into()),
            isolation: Some(TaskIsolation {
                kind: TaskIsolationKind::StagedProject,
                execution_root: execution.to_string_lossy().into_owned(),
                baseline_root: project.to_string_lossy().into_owned(),
                source_revision: "snapshot:before".into(),
                baseline_hash: before_hash.clone(),
                baseline: vec![ManifestEntry {
                    path: "main.tex".into(),
                    sha256: before_hash.clone(),
                    size: before_size,
                }],
                allowed_paths: vec!["main.tex".into()],
                created_at: now_ms(),
            }),
            error: None,
            result: Some(TaskResultMetadata {
                summary: "Revised".into(),
                changed_files: vec![TaskFileChange {
                    path: "main.tex".into(),
                    kind: TaskFileChangeKind::Modified,
                    before_sha256: Some(before_hash),
                    after_sha256: Some(after_hash),
                    before_size: Some(before_size),
                    after_size: Some(after_size),
                }],
                artifacts: Vec::new(),
                native_session_id: None,
                input_tokens: None,
                output_tokens: None,
            }),
            review: None,
            start_requested: false,
            cancel_requested: false,
            created_at: now_ms(),
            updated_at: now_ms(),
            started_at: Some(now_ms()),
            finished_at: Some(now_ms()),
        }
    }

    #[test]
    fn changed_base_is_rejected_without_overwriting_it() {
        let temp = tempfile::tempdir().unwrap();
        let project = temp.path().join("project");
        let execution = temp.path().join("execution");
        fs::create_dir(&project).unwrap();
        fs::create_dir(&execution).unwrap();
        fs::write(project.join("main.tex"), "base").unwrap();
        fs::write(execution.join("main.tex"), "task result").unwrap();
        let task = task(&project, &execution, "base", "task result");
        fs::write(project.join("main.tex"), "new user edit").unwrap();
        let store = TaskStore::new(temp.path().join("store")).unwrap();

        let error = apply_review(&store, &task, &project, &["main.tex".into()]).unwrap_err();

        assert!(error.contains("changed after this task started"));
        assert_eq!(
            fs::read_to_string(project.join("main.tex")).unwrap(),
            "new user edit"
        );
    }

    #[test]
    fn interrupted_apply_rolls_back_during_recovery() {
        #[cfg(unix)]
        use std::os::unix::fs::PermissionsExt;

        let temp = tempfile::tempdir().unwrap();
        let project = temp.path().join("project");
        let execution = temp.path().join("execution");
        fs::create_dir(&project).unwrap();
        fs::create_dir(&execution).unwrap();
        fs::write(project.join("main.tex"), "base").unwrap();
        fs::write(execution.join("main.tex"), "task result").unwrap();
        #[cfg(unix)]
        {
            fs::set_permissions(project.join("main.tex"), fs::Permissions::from_mode(0o755))
                .unwrap();
            fs::set_permissions(
                execution.join("main.tex"),
                fs::Permissions::from_mode(0o755),
            )
            .unwrap();
        }
        let task = task(&project, &execution, "base", "task result");
        let store = TaskStore::new(temp.path().join("store")).unwrap();

        let error = apply_review_with_fault(
            &store,
            &task,
            &project,
            &["main.tex".into()],
            ApplyFault::InterruptAfterFirst,
        )
        .unwrap_err();
        assert!(error.contains("interrupted"));
        assert_eq!(
            fs::read_to_string(project.join("main.tex")).unwrap(),
            "task result"
        );
        #[cfg(unix)]
        assert_ne!(
            fs::metadata(project.join("main.tex"))
                .unwrap()
                .permissions()
                .mode()
                & 0o111,
            0
        );

        assert!(!recover_pending_apply(&store, &task, &project, &["main.tex".into()]).unwrap());
        assert_eq!(
            fs::read_to_string(project.join("main.tex")).unwrap(),
            "base"
        );
        #[cfg(unix)]
        assert_ne!(
            fs::metadata(project.join("main.tex"))
                .unwrap()
                .permissions()
                .mode()
                & 0o111,
            0
        );
    }

    #[cfg(unix)]
    #[test]
    fn a_parent_symlink_cannot_redirect_a_reviewed_deletion() {
        let temp = tempfile::tempdir().unwrap();
        let project = temp.path().join("project");
        let execution = temp.path().join("execution");
        let outside = temp.path().join("outside");
        fs::create_dir(&project).unwrap();
        fs::create_dir(&execution).unwrap();
        fs::create_dir(&outside).unwrap();
        fs::write(project.join("main.tex"), "base").unwrap();
        fs::write(execution.join("main.tex"), "task result").unwrap();
        fs::create_dir(project.join("chapters")).unwrap();
        fs::write(project.join("chapters/paper.tex"), "protected").unwrap();
        fs::write(outside.join("paper.tex"), "do not delete").unwrap();
        let (before_hash, before_size) = hash_file(&project.join("chapters/paper.tex")).unwrap();
        let mut task = task(&project, &execution, "base", "task result");
        task.result.as_mut().unwrap().changed_files = vec![TaskFileChange {
            path: "chapters/paper.tex".into(),
            kind: TaskFileChangeKind::Deleted,
            before_sha256: Some(before_hash),
            after_sha256: None,
            before_size: Some(before_size),
            after_size: None,
        }];
        fs::remove_dir_all(project.join("chapters")).unwrap();
        std::os::unix::fs::symlink(&outside, project.join("chapters")).unwrap();
        let store = TaskStore::new(temp.path().join("store")).unwrap();

        let error =
            apply_review(&store, &task, &project, &["chapters/paper.tex".into()]).unwrap_err();

        assert!(error.contains("symbolic link") || error.contains("parent changed"));
        assert_eq!(
            fs::read_to_string(outside.join("paper.tex")).unwrap(),
            "do not delete"
        );
    }

    #[test]
    fn an_oversized_apply_plan_is_rejected_before_it_is_written() {
        let temp = tempfile::tempdir().unwrap();
        let plan = ApplyPlan {
            task_id: "task-one".into(),
            project_id: "paper".into(),
            execution_generation: 1,
            phase: ApplyPhase::Preparing,
            applied_count: 0,
            changes: vec![TaskFileChange {
                path: "x".repeat(MAX_APPLY_PLAN_BYTES),
                kind: TaskFileChangeKind::Added,
                before_sha256: None,
                after_sha256: Some("hash".into()),
                before_size: None,
                after_size: Some(1),
            }],
        };

        let error = write_plan(temp.path(), &plan).unwrap_err();

        assert!(error.contains("too large"));
        assert!(!temp.path().join("plan.json").exists());
    }
}
