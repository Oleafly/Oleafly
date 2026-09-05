use std::io::Read;
use std::path::{Component, Path, PathBuf};

use base64::Engine as _;
use cap_fs_ext::{DirExt, FollowSymlinks, OpenOptionsFollowExt, OpenOptionsSyncExt};
use cap_std::fs::{Dir, OpenOptions};
use sha2::{Digest, Sha256};

use super::isolation::normalized_relative;
use super::model::{TaskArtifactPreview, TaskFilePreview, TaskPreviewContent};
use super::store::TaskStore;

const MAX_TEXT_BYTES: u64 = 400_000;
const MAX_IMAGE_BYTES: u64 = 8 * 1024 * 1024;

pub(crate) fn file_preview(
    store: &TaskStore,
    task_id: &str,
    path: &str,
) -> Result<TaskFilePreview, String> {
    let task = store.require(task_id)?;
    let isolation = task
        .isolation
        .ok_or_else(|| "This task has no saved workspace to preview.".to_string())?;
    let result = task
        .result
        .ok_or_else(|| "This task has no saved result to preview.".to_string())?;
    let change = result
        .changed_files
        .into_iter()
        .find(|change| change.path == path)
        .ok_or_else(|| "That file is not part of this task result.".to_string())?;
    let relative = normalized_relative(path)?;
    let baseline = PreviewRoot::open(Path::new(&isolation.baseline_root))?;
    let execution = PreviewRoot::open(Path::new(&isolation.execution_root))?;
    let before = read_expected(&baseline, &relative, change.before_sha256.as_deref())?;
    let after = read_expected(&execution, &relative, change.after_sha256.as_deref())?;
    Ok(TaskFilePreview {
        path: path.to_string(),
        change: change.kind,
        before,
        after,
    })
}

pub(crate) fn artifact_preview(
    store: &TaskStore,
    task_id: &str,
    path: &str,
) -> Result<TaskArtifactPreview, String> {
    let task = store.require(task_id)?;
    let isolation = task
        .isolation
        .ok_or_else(|| "This task has no saved workspace to preview.".to_string())?;
    let result = task
        .result
        .ok_or_else(|| "This task has no saved result to preview.".to_string())?;
    let artifact = result
        .artifacts
        .iter()
        .find(|artifact| artifact.path == path)
        .cloned()
        .ok_or_else(|| "That artifact is not part of this task result.".to_string())?;
    let expected = result
        .changed_files
        .iter()
        .find(|change| change.path == path)
        .and_then(|change| change.after_sha256.as_deref())
        .ok_or_else(|| "That artifact has no reviewed file hash.".to_string())?;
    let relative = normalized_relative(path)?;
    let execution = PreviewRoot::open(Path::new(&isolation.execution_root))?;
    let content = read_expected(&execution, &relative, Some(expected))?;
    Ok(TaskArtifactPreview { artifact, content })
}

fn read_expected(
    root: &PreviewRoot,
    path: &Path,
    expected: Option<&str>,
) -> Result<TaskPreviewContent, String> {
    match expected {
        Some(expected) => {
            let content = read_existing(root, path)?;
            if content.sha256.as_deref() != Some(expected) {
                return Err("The saved preview changed after the task finished.".into());
            }
            Ok(content)
        }
        None if !root.exists(path)? => Ok(missing()),
        None => Err("The saved preview changed after the task finished.".into()),
    }
}

fn read_existing(root: &PreviewRoot, path: &Path) -> Result<TaskPreviewContent, String> {
    let mut file = root
        .open_file(path)?
        .ok_or_else(|| "The saved task file is missing.".to_string())?;
    let size = file
        .metadata()
        .map_err(|error| format!("could not inspect the saved task file: {error}"))?
        .len();
    if size > 64 * 1024 * 1024 {
        return Err("The saved task file is larger than the 64 MiB limit.".into());
    }
    let media_type = media_type(path);
    let mut hasher = Sha256::new();
    let bytes = if size <= MAX_IMAGE_BYTES {
        let mut bytes = Vec::with_capacity(size as usize);
        file.by_ref()
            .take(MAX_IMAGE_BYTES + 1)
            .read_to_end(&mut bytes)
            .map_err(|error| format!("could not read the saved task file: {error}"))?;
        if bytes.len() as u64 > MAX_IMAGE_BYTES {
            return Err("The saved task file changed while it was being previewed.".into());
        }
        hasher.update(&bytes);
        Some(bytes)
    } else {
        let mut buffer = [0u8; 64 * 1024];
        loop {
            let read = file
                .read(&mut buffer)
                .map_err(|error| format!("could not read the saved task file: {error}"))?;
            if read == 0 {
                break;
            }
            hasher.update(&buffer[..read]);
        }
        None
    };
    let sha256 = format!("{:x}", hasher.finalize());
    if let Some(bytes) = bytes
        .as_ref()
        .filter(|bytes| bytes.len() as u64 <= MAX_TEXT_BYTES)
    {
        if !bytes.contains(&0) {
            if let Ok(text) = String::from_utf8(bytes.clone()) {
                return Ok(TaskPreviewContent {
                    exists: true,
                    text: Some(text),
                    base64: None,
                    media_type,
                    binary: false,
                    truncated: false,
                    size: Some(size),
                    sha256: Some(sha256),
                });
            }
        }
    }
    let base64 = if size <= MAX_IMAGE_BYTES
        && media_type
            .as_deref()
            .is_some_and(|value| value.starts_with("image/"))
    {
        bytes.map(|bytes| base64::engine::general_purpose::STANDARD.encode(bytes))
    } else {
        None
    };
    let truncated = size > MAX_TEXT_BYTES && base64.is_none();
    Ok(TaskPreviewContent {
        exists: true,
        text: None,
        base64,
        media_type,
        binary: true,
        truncated,
        size: Some(size),
        sha256: Some(sha256),
    })
}

struct PreviewRoot {
    directory: Dir,
}

impl PreviewRoot {
    fn open(root: &Path) -> Result<Self, String> {
        let metadata = std::fs::symlink_metadata(root)
            .map_err(|error| format!("could not inspect the saved task root: {error}"))?;
        if !metadata.is_dir() || metadata.file_type().is_symlink() {
            return Err("The saved task root is not a real directory.".into());
        }
        let root = root
            .canonicalize()
            .map_err(|error| format!("could not resolve the saved task root: {error}"))?;
        let directory = Dir::open_ambient_dir(root, cap_std::ambient_authority())
            .map_err(|error| format!("could not open the saved task root: {error}"))?;
        Ok(Self { directory })
    }

    fn parent(&self, path: &Path) -> Result<Option<(Dir, PathBuf)>, String> {
        let components = path.components().collect::<Vec<_>>();
        let (name, parents) = components
            .split_last()
            .ok_or_else(|| "A saved task path is empty.".to_string())?;
        let mut directory = self
            .directory
            .try_clone()
            .map_err(|error| format!("could not clone the saved task root: {error}"))?;
        for component in parents {
            let Component::Normal(_) = component else {
                return Err("A saved task path is not normalized.".into());
            };
            directory = match directory.open_dir_nofollow(Path::new(component.as_os_str())) {
                Ok(directory) => directory,
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
                Err(_) => return Err("A saved task parent is a symbolic link or changed.".into()),
            };
        }
        let Component::Normal(_) = name else {
            return Err("A saved task path is not normalized.".into());
        };
        Ok(Some((directory, PathBuf::from(name.as_os_str()))))
    }

    fn open_file(&self, path: &Path) -> Result<Option<cap_std::fs::File>, String> {
        let Some((directory, name)) = self.parent(path)? else {
            return Ok(None);
        };
        let mut options = OpenOptions::new();
        options.read(true).follow(FollowSymlinks::No).nonblock(true);
        let file = match directory.open_with(name, &options) {
            Ok(file) => file,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(_) => return Err("The saved task file is a symbolic link or changed.".into()),
        };
        let metadata = file
            .metadata()
            .map_err(|error| format!("could not inspect the saved task file: {error}"))?;
        if !metadata.is_file() {
            return Err("The saved task file is not a regular file.".into());
        }
        Ok(Some(file))
    }

    fn exists(&self, path: &Path) -> Result<bool, String> {
        let Some((directory, name)) = self.parent(path)? else {
            return Ok(false);
        };
        match directory.symlink_metadata(name) {
            Ok(_) => Ok(true),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
            Err(error) => Err(format!("could not inspect the saved task file: {error}")),
        }
    }
}

fn missing() -> TaskPreviewContent {
    TaskPreviewContent {
        exists: false,
        text: None,
        base64: None,
        media_type: None,
        binary: false,
        truncated: false,
        size: None,
        sha256: None,
    }
}

fn media_type(path: &Path) -> Option<String> {
    let extension = path.extension()?.to_str()?.to_ascii_lowercase();
    let value = match extension.as_str() {
        "gif" => "image/gif",
        "jpeg" | "jpg" => "image/jpeg",
        "png" => "image/png",
        "svg" => "image/svg+xml",
        "webp" => "image/webp",
        "pdf" => "application/pdf",
        "json" => "application/json",
        "csv" => "text/csv",
        "html" => "text/html",
        "md" => "text/markdown",
        "tex" => "application/x-tex",
        "txt" => "text/plain",
        _ => return None,
    };
    Some(value.to_string())
}

#[cfg(test)]
mod tests {
    use std::fs;

    use super::*;
    use crate::research_tasks::isolation::hash_file;
    use crate::research_tasks::model::{
        now_ms, ManifestEntry, ResearchTaskDraft, TaskArtifact, TaskFileChange, TaskFileChangeKind,
        TaskIsolation, TaskIsolationKind, TaskResultMetadata,
    };

    #[test]
    fn preview_uses_the_pinned_baseline_and_rejects_changed_output() {
        let temp = tempfile::tempdir().unwrap();
        let baseline = temp.path().join("baseline");
        let execution = temp.path().join("execution");
        fs::create_dir(&baseline).unwrap();
        fs::create_dir(&execution).unwrap();
        fs::write(baseline.join("main.tex"), "before").unwrap();
        fs::write(execution.join("main.tex"), "after").unwrap();
        let (before_hash, before_size) = hash_file(&baseline.join("main.tex")).unwrap();
        let (after_hash, after_size) = hash_file(&execution.join("main.tex")).unwrap();
        let store = TaskStore::new(temp.path().join("store")).unwrap();
        let task = store
            .create(ResearchTaskDraft {
                project_id: "paper".into(),
                title: "Revise".into(),
                prompt: "Revise".into(),
                runtime_id: "fixture".into(),
                agent_id: "fixture".into(),
                model_id: "fixture".into(),
                skill_ids: Vec::new(),
                dependency_ids: Vec::new(),
            })
            .unwrap();
        store.request_start(&task.id).unwrap();
        let running = store.claim_next().unwrap().unwrap();
        let isolation = TaskIsolation {
            kind: TaskIsolationKind::StagedProject,
            execution_root: execution.to_string_lossy().into_owned(),
            baseline_root: baseline.to_string_lossy().into_owned(),
            source_revision: "snapshot:base".into(),
            baseline_hash: before_hash.clone(),
            baseline: vec![ManifestEntry {
                path: "main.tex".into(),
                sha256: before_hash.clone(),
                size: before_size,
            }],
            allowed_paths: vec!["main.tex".into()],
            created_at: now_ms(),
        };
        store
            .set_isolation(&task.id, running.execution_generation, &isolation)
            .unwrap();
        store
            .finish_success(
                &task.id,
                running.execution_generation,
                &TaskResultMetadata {
                    summary: "done".into(),
                    changed_files: vec![TaskFileChange {
                        path: "main.tex".into(),
                        kind: TaskFileChangeKind::Modified,
                        before_sha256: Some(before_hash),
                        after_sha256: Some(after_hash),
                        before_size: Some(before_size),
                        after_size: Some(after_size),
                    }],
                    artifacts: vec![TaskArtifact {
                        path: "main.tex".into(),
                        label: "Revised manuscript".into(),
                        media_type: Some("application/x-tex".into()),
                    }],
                    native_session_id: None,
                    input_tokens: None,
                    output_tokens: None,
                },
            )
            .unwrap();

        let preview = file_preview(&store, &task.id, "main.tex").unwrap();
        assert_eq!(preview.before.text.as_deref(), Some("before"));
        assert_eq!(preview.after.text.as_deref(), Some("after"));
        assert_eq!(
            artifact_preview(&store, &task.id, "main.tex")
                .unwrap()
                .content
                .text
                .as_deref(),
            Some("after")
        );

        fs::write(execution.join("main.tex"), "changed later").unwrap();
        assert!(file_preview(&store, &task.id, "main.tex")
            .unwrap_err()
            .contains("changed after"));
    }

    #[cfg(unix)]
    #[test]
    fn preview_rejects_a_symbolic_link_in_a_parent_path() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("root");
        let outside = temp.path().join("outside");
        fs::create_dir(&root).unwrap();
        fs::create_dir(&outside).unwrap();
        fs::write(outside.join("paper.tex"), "private").unwrap();
        std::os::unix::fs::symlink(&outside, root.join("chapters")).unwrap();
        let root = PreviewRoot::open(&root).unwrap();

        let error = read_existing(&root, Path::new("chapters/paper.tex")).unwrap_err();

        assert!(error.contains("symbolic link"));
    }
}
