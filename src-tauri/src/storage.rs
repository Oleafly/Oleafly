use serde::{Deserialize, Serialize};
use std::path::{Component, Path, PathBuf};

const RECYCLE_MANIFEST: &str = "recycle.json";
const RECYCLED_PROJECT_DIRECTORY: &str = "project";

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
pub struct LibraryStorageSummary {
    pub total_bytes: u64,
    pub projects_bytes: u64,
    pub source_bytes: u64,
    pub image_bytes: u64,
    pub pdf_bytes: u64,
    pub git_bytes: u64,
    pub build_bytes: u64,
    pub recycle_bin_bytes: u64,
    pub app_data_bytes: u64,
    pub project_count: u64,
    pub recycled_project_count: u64,
    pub file_count: u64,
    pub directory_count: u64,
    pub image_count: u64,
    pub pdf_count: u64,
    pub unreadable_entries: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct RecycledProjectInfo {
    pub id: String,
    pub project_id: String,
    pub name: String,
    pub deleted_at: u64,
    pub size_bytes: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
struct RecycleManifest {
    project_id: String,
    name: String,
    deleted_at: u64,
}

#[derive(Clone, Copy)]
enum FileClass {
    Source,
    Image,
    Pdf,
    Git,
    Build,
    RecycleBin,
    AppData,
}

fn has_component(path: &Path, expected: &str) -> bool {
    path.components()
        .any(|component| matches!(component, Component::Normal(value) if value == expected))
}

fn is_project_build_file(relative: &Path) -> bool {
    let components = relative
        .components()
        .filter_map(|component| match component {
            Component::Normal(value) => value.to_str(),
            _ => None,
        })
        .collect::<Vec<_>>();
    components
        .windows(2)
        .any(|pair| pair == [".oleafly", "build"])
}

fn classify_file(relative: &Path, in_projects: bool) -> FileClass {
    if relative.starts_with("recycle-bin") {
        return FileClass::RecycleBin;
    }
    if !in_projects {
        return FileClass::AppData;
    }
    if has_component(relative, ".git") {
        return FileClass::Git;
    }
    if is_project_build_file(relative) {
        return FileClass::Build;
    }
    let extension = relative
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    if matches!(
        extension.as_str(),
        "png" | "jpg" | "jpeg" | "gif" | "webp" | "svg" | "bmp" | "tif" | "tiff"
    ) {
        FileClass::Image
    } else if extension == "pdf" {
        FileClass::Pdf
    } else {
        FileClass::Source
    }
}

fn count_projects(projects_root: &Path, summary: &mut LibraryStorageSummary) {
    let Ok(entries) = std::fs::read_dir(projects_root) else {
        if projects_root.exists() {
            summary.unreadable_entries += 1;
        }
        return;
    };
    for entry in entries {
        let Ok(entry) = entry else {
            summary.unreadable_entries += 1;
            continue;
        };
        let Ok(metadata) = std::fs::symlink_metadata(entry.path()) else {
            summary.unreadable_entries += 1;
            continue;
        };
        if metadata.is_dir()
            && !metadata.file_type().is_symlink()
            && entry.path().join("project.json").is_file()
        {
            summary.project_count += 1;
        }
    }
}

fn count_recycled_projects(recycle_root: &Path) -> u64 {
    let Ok(entries) = std::fs::read_dir(recycle_root) else {
        return 0;
    };
    entries
        .flatten()
        .filter(|entry| {
            entry.file_type().map(|kind| kind.is_dir()).unwrap_or(false)
                && entry.path().join(RECYCLE_MANIFEST).is_file()
                && entry.path().join(RECYCLED_PROJECT_DIRECTORY).is_dir()
        })
        .count() as u64
}

fn scan_storage(root: &Path) -> LibraryStorageSummary {
    let mut summary = LibraryStorageSummary::default();
    if !root.is_dir() {
        return summary;
    }

    let projects_root = root.join("projects");
    count_projects(&projects_root, &mut summary);
    let mut pending = vec![PathBuf::from(root)];

    while let Some(directory) = pending.pop() {
        let entries = match std::fs::read_dir(&directory) {
            Ok(entries) => entries,
            Err(_) => {
                summary.unreadable_entries += 1;
                continue;
            }
        };
        for entry in entries {
            let entry = match entry {
                Ok(entry) => entry,
                Err(_) => {
                    summary.unreadable_entries += 1;
                    continue;
                }
            };
            let path = entry.path();
            let metadata = match std::fs::symlink_metadata(&path) {
                Ok(metadata) => metadata,
                Err(_) => {
                    summary.unreadable_entries += 1;
                    continue;
                }
            };
            if metadata.file_type().is_symlink() {
                continue;
            }
            if metadata.is_dir() {
                summary.directory_count += 1;
                pending.push(path);
                continue;
            }
            if !metadata.is_file() {
                continue;
            }

            let bytes = metadata.len();
            summary.file_count += 1;
            summary.total_bytes = summary.total_bytes.saturating_add(bytes);
            let relative = path.strip_prefix(root).unwrap_or(&path);
            let in_projects = relative.starts_with("projects");
            if in_projects {
                summary.projects_bytes = summary.projects_bytes.saturating_add(bytes);
            }
            match classify_file(relative, in_projects) {
                FileClass::Source => {
                    summary.source_bytes = summary.source_bytes.saturating_add(bytes)
                }
                FileClass::Image => {
                    summary.image_count += 1;
                    summary.image_bytes = summary.image_bytes.saturating_add(bytes);
                }
                FileClass::Pdf => {
                    summary.pdf_count += 1;
                    summary.pdf_bytes = summary.pdf_bytes.saturating_add(bytes);
                }
                FileClass::Git => summary.git_bytes = summary.git_bytes.saturating_add(bytes),
                FileClass::Build => summary.build_bytes = summary.build_bytes.saturating_add(bytes),
                FileClass::RecycleBin => {
                    summary.recycle_bin_bytes = summary.recycle_bin_bytes.saturating_add(bytes)
                }
                FileClass::AppData => {
                    summary.app_data_bytes = summary.app_data_bytes.saturating_add(bytes)
                }
            }
        }
    }
    summary.recycled_project_count = count_recycled_projects(&root.join("recycle-bin"));
    summary
}

fn timestamp_seconds() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

fn timestamp_millis() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
}

fn recycle_entry_dir(recycle_id: &str) -> Result<PathBuf, String> {
    crate::paths::validate_project_id(recycle_id)?;
    let root = crate::paths::recycle_bin_root()?;
    let entry = root.join(recycle_id);
    let metadata = std::fs::symlink_metadata(&entry).map_err(|error| {
        if error.kind() == std::io::ErrorKind::NotFound {
            format!("recycled project does not exist: {recycle_id}")
        } else {
            format!("failed to inspect recycled project: {error}")
        }
    })?;
    if !metadata.is_dir() || metadata.file_type().is_symlink() {
        return Err("recycled project path is not a real directory".into());
    }
    let entry = entry
        .canonicalize()
        .map_err(|error| format!("failed to resolve recycled project: {error}"))?;
    if entry.parent() != Some(root.as_path()) {
        return Err("recycled project path escapes the recycle bin".into());
    }
    Ok(entry)
}

fn read_recycle_manifest(entry: &Path) -> Result<RecycleManifest, String> {
    let path = entry.join(RECYCLE_MANIFEST);
    let metadata = std::fs::symlink_metadata(&path)
        .map_err(|error| format!("failed to inspect recycle metadata: {error}"))?;
    if !metadata.is_file() || metadata.file_type().is_symlink() {
        return Err("recycle metadata is not a regular file".into());
    }
    let bytes = std::fs::read(&path)
        .map_err(|error| format!("failed to read recycle metadata: {error}"))?;
    let manifest: RecycleManifest = serde_json::from_slice(&bytes)
        .map_err(|error| format!("failed to parse recycle metadata: {error}"))?;
    crate::paths::validate_project_id(&manifest.project_id)?;
    Ok(manifest)
}

fn recycled_project_dir(entry: &Path) -> Result<PathBuf, String> {
    let project = entry.join(RECYCLED_PROJECT_DIRECTORY);
    let metadata = std::fs::symlink_metadata(&project)
        .map_err(|error| format!("failed to inspect recycled project files: {error}"))?;
    if !metadata.is_dir() || metadata.file_type().is_symlink() {
        return Err("recycled project files are not a real directory".into());
    }
    let project = project
        .canonicalize()
        .map_err(|error| format!("failed to resolve recycled project files: {error}"))?;
    if project.parent() != Some(entry) {
        return Err("recycled project files escape their recycle entry".into());
    }
    Ok(project)
}

fn directory_size(root: &Path) -> u64 {
    let Ok(root) = root.canonicalize() else {
        return 0;
    };
    let mut bytes = 0_u64;
    let mut pending = vec![root.clone()];
    while let Some(directory) = pending.pop() {
        let Ok(entries) = std::fs::read_dir(directory) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            let Ok(metadata) = std::fs::symlink_metadata(&path) else {
                continue;
            };
            if metadata.file_type().is_symlink() {
                continue;
            }
            if metadata.is_file() {
                bytes = bytes.saturating_add(metadata.len());
            } else if metadata.is_dir() {
                let Ok(resolved) = path.canonicalize() else {
                    continue;
                };
                if resolved.starts_with(&root) {
                    pending.push(resolved);
                }
            }
        }
    }
    bytes
}

pub(crate) fn recycle_project_directory(
    project_id: &str,
    name: &str,
    project_directory: &Path,
) -> Result<String, String> {
    crate::paths::validate_project_id(project_id)?;
    let recycle_root = crate::paths::recycle_bin_root()?;
    let deleted_at = timestamp_seconds();
    let timestamp = timestamp_millis();
    let (recycle_id, entry) = (0_u16..1000)
        .find_map(|suffix| {
            let id = format!("{timestamp}-{suffix}-{project_id}");
            let entry = recycle_root.join(&id);
            match std::fs::create_dir(&entry) {
                Ok(()) => Some(Ok((id, entry))),
                Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => None,
                Err(error) => Some(Err(format!("failed to create recycle entry: {error}"))),
            }
        })
        .transpose()?
        .ok_or_else(|| "failed to allocate a unique recycle entry".to_string())?;

    let manifest = RecycleManifest {
        project_id: project_id.to_string(),
        name: if name.trim().is_empty() {
            project_id.to_string()
        } else {
            name.to_string()
        },
        deleted_at,
    };
    let manifest_path = entry.join(RECYCLE_MANIFEST);
    let manifest_bytes = serde_json::to_vec_pretty(&manifest)
        .map_err(|error| format!("failed to encode recycle metadata: {error}"))?;
    if let Err(error) = std::fs::write(&manifest_path, manifest_bytes) {
        let _ = std::fs::remove_dir(&entry);
        return Err(format!("failed to write recycle metadata: {error}"));
    }

    if let Err(error) = std::fs::rename(project_directory, entry.join(RECYCLED_PROJECT_DIRECTORY)) {
        let _ = std::fs::remove_file(manifest_path);
        let _ = std::fs::remove_dir(entry);
        return Err(format!(
            "failed to move project to the recycle bin: {error}"
        ));
    }
    Ok(recycle_id)
}

fn list_recycled_projects_sync() -> Result<Vec<RecycledProjectInfo>, String> {
    let root = crate::paths::recycle_bin_root()?;
    let entries =
        std::fs::read_dir(&root).map_err(|error| format!("failed to read recycle bin: {error}"))?;
    let mut projects = Vec::new();
    for entry in entries.flatten() {
        let id = entry.file_name().to_string_lossy().into_owned();
        let Ok(entry) = recycle_entry_dir(&id) else {
            continue;
        };
        let Ok(manifest) = read_recycle_manifest(&entry) else {
            continue;
        };
        let Ok(project) = recycled_project_dir(&entry) else {
            continue;
        };
        projects.push(RecycledProjectInfo {
            id,
            project_id: manifest.project_id,
            name: manifest.name,
            deleted_at: manifest.deleted_at,
            size_bytes: directory_size(&project),
        });
    }
    projects.sort_by_key(|project| std::cmp::Reverse(project.deleted_at));
    Ok(projects)
}

fn restore_recycled_project_sync(recycle_id: &str) -> Result<String, String> {
    let entry = recycle_entry_dir(recycle_id)?;
    let manifest = read_recycle_manifest(&entry)?;
    let project = recycled_project_dir(&entry)?;
    let projects_root = crate::paths::projects_root()?
        .canonicalize()
        .map_err(|error| format!("failed to resolve projects root: {error}"))?;
    let destination = projects_root.join(&manifest.project_id);
    if destination.exists() {
        return Err(format!(
            "a project with id {} already exists; rename or remove it before restoring",
            manifest.project_id
        ));
    }
    std::fs::rename(&project, &destination)
        .map_err(|error| format!("failed to restore project: {error}"))?;
    let _ = std::fs::remove_file(entry.join(RECYCLE_MANIFEST));
    let _ = std::fs::remove_dir(entry);
    Ok(manifest.project_id)
}

fn permanently_delete_recycled_project_sync(recycle_id: &str) -> Result<(), String> {
    let entry = recycle_entry_dir(recycle_id)?;
    std::fs::remove_dir_all(entry)
        .map_err(|error| format!("failed to permanently delete recycled project: {error}"))
}

#[tauri::command]
pub async fn library_storage_summary() -> Result<LibraryStorageSummary, String> {
    let root = crate::paths::oleafly_root()?;
    tauri::async_runtime::spawn_blocking(move || scan_storage(&root))
        .await
        .map_err(|error| format!("failed to inspect Oleafly storage: {error}"))
}

#[tauri::command]
pub async fn list_recycled_projects() -> Result<Vec<RecycledProjectInfo>, String> {
    tauri::async_runtime::spawn_blocking(list_recycled_projects_sync)
        .await
        .map_err(|error| format!("failed to inspect recycle bin: {error}"))?
}

#[tauri::command]
pub async fn restore_recycled_project(
    recycle_id: String,
    state: tauri::State<'_, crate::state::AppState>,
) -> Result<String, String> {
    let _compile = state.compile_lock.lock().await;
    let _figure_compile = state.figure_compile_lock.lock().await;
    tauri::async_runtime::spawn_blocking(move || restore_recycled_project_sync(&recycle_id))
        .await
        .map_err(|error| format!("failed to restore recycled project: {error}"))?
}

#[tauri::command]
pub async fn permanently_delete_recycled_project(
    recycle_id: String,
    state: tauri::State<'_, crate::state::AppState>,
) -> Result<(), String> {
    let _compile = state.compile_lock.lock().await;
    let _figure_compile = state.figure_compile_lock.lock().await;
    tauri::async_runtime::spawn_blocking(move || {
        permanently_delete_recycled_project_sync(&recycle_id)
    })
    .await
    .map_err(|error| format!("failed to permanently delete recycled project: {error}"))?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn storage_scan_reports_disjoint_categories_without_following_symlinks() {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path();
        let project = root.join("projects/paper");
        std::fs::create_dir_all(project.join("figures")).unwrap();
        std::fs::create_dir_all(project.join(".git/objects")).unwrap();
        std::fs::create_dir_all(project.join(".oleafly/build")).unwrap();
        std::fs::create_dir_all(root.join("assets")).unwrap();
        std::fs::create_dir_all(root.join("recycle-bin/deleted/project")).unwrap();
        std::fs::write(project.join("project.json"), b"{}").unwrap();
        std::fs::write(project.join("main.tex"), b"source").unwrap();
        std::fs::write(project.join("figures/chart.png"), b"image").unwrap();
        std::fs::write(project.join("paper.pdf"), b"pdf").unwrap();
        std::fs::write(project.join(".git/objects/a"), b"git!").unwrap();
        std::fs::write(project.join(".oleafly/build/main.aux"), b"build").unwrap();
        std::fs::write(root.join("assets/font.bin"), b"asset").unwrap();
        std::fs::write(root.join("recycle-bin/deleted/project/main.tex"), b"old").unwrap();

        let summary = scan_storage(root);
        assert_eq!(summary.project_count, 1);
        assert_eq!(summary.file_count, 8);
        assert_eq!(summary.image_count, 1);
        assert_eq!(summary.pdf_count, 1);
        assert_eq!(summary.image_bytes, 5);
        assert_eq!(summary.pdf_bytes, 3);
        assert_eq!(summary.git_bytes, 4);
        assert_eq!(summary.build_bytes, 5);
        assert_eq!(summary.app_data_bytes, 5);
        assert_eq!(summary.recycle_bin_bytes, 3);
        assert_eq!(
            summary.source_bytes
                + summary.image_bytes
                + summary.pdf_bytes
                + summary.git_bytes
                + summary.build_bytes
                + summary.recycle_bin_bytes
                + summary.app_data_bytes,
            summary.total_bytes
        );
    }

    #[test]
    fn recycled_project_can_be_listed_restored_and_permanently_deleted() {
        let _env_guard = crate::paths::data_dir_env_lock();
        let directory = tempfile::tempdir().unwrap();
        std::env::set_var("OLEAFLY_DATA_DIR", directory.path());
        let project_id = "paper";
        let project = crate::paths::projects_root().unwrap().join(project_id);
        std::fs::create_dir(&project).unwrap();
        std::fs::write(project.join("project.json"), br#"{"name":"Paper"}"#).unwrap();
        std::fs::write(project.join("main.tex"), b"source").unwrap();

        let recycle_id = recycle_project_directory(project_id, "Paper", &project).unwrap();
        assert!(!project.exists());
        let listed = list_recycled_projects_sync().unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].id, recycle_id);
        assert_eq!(listed[0].project_id, project_id);
        assert_eq!(listed[0].name, "Paper");
        assert!(listed[0].size_bytes > 0);

        assert_eq!(
            restore_recycled_project_sync(&recycle_id).unwrap(),
            project_id
        );
        assert!(project.join("main.tex").is_file());
        assert!(list_recycled_projects_sync().unwrap().is_empty());

        let recycle_id = recycle_project_directory(project_id, "Paper", &project).unwrap();
        permanently_delete_recycled_project_sync(&recycle_id).unwrap();
        assert!(list_recycled_projects_sync().unwrap().is_empty());

        std::env::remove_var("OLEAFLY_DATA_DIR");
    }
}
