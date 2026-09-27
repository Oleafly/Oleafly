use serde::{Deserialize, Serialize};
use std::path::{Component, Path, PathBuf};

use crate::app_error::AppError;

const MAX_COPY_FILES: usize = 5_000;
const MAX_COPY_BYTES: usize = 256 * 1024 * 1024;
const MAX_NAME_ATTEMPTS: usize = 100;
const MAX_NAME_CHARS: usize = 80;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BufferCopyFile {
    pub path: String,
    pub content: String,
}

#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedBufferCopy {
    pub folder: String,
    pub written: usize,
}

pub(crate) fn copy_folder_name(project_name: &str, suffix: &str) -> String {
    let cleaned: String = project_name
        .chars()
        .map(|character| {
            if character.is_control()
                || matches!(
                    character,
                    '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|'
                )
            {
                '-'
            } else {
                character
            }
        })
        .take(MAX_NAME_CHARS)
        .collect();
    let trimmed = cleaned.trim().trim_matches('.').trim();
    let base = if trimmed.is_empty() {
        "Oleafly project"
    } else {
        trimmed
    };
    format!("{base} {suffix}")
}

fn portable_relative(path: &str) -> bool {
    !path.is_empty()
        && !path.contains('\\')
        && Path::new(path)
            .components()
            .all(|component| matches!(component, Component::Normal(_)))
}

fn copy_failed(detail: impl ToString) -> String {
    AppError::new("project.copy_failed").detail(detail).into()
}

fn managed(path: &str) -> bool {
    path.split('/').next().is_some_and(|head| {
        head.eq_ignore_ascii_case(".git") || head.eq_ignore_ascii_case(".oleafly")
    })
}

fn create_unique_folder(parent: &Path, name: &str) -> Result<PathBuf, String> {
    for attempt in 1..=MAX_NAME_ATTEMPTS {
        let candidate = if attempt == 1 {
            parent.join(name)
        } else {
            parent.join(format!("{name} {attempt}"))
        };
        match std::fs::create_dir(&candidate) {
            Ok(()) => return candidate.canonicalize().map_err(copy_failed),
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(copy_failed(error)),
        }
    }
    Err(copy_failed(name))
}

fn free_destination(folder: &Path, relative: &str) -> Result<PathBuf, String> {
    let first = crate::sandbox::resolve_within(folder, relative).map_err(copy_failed)?;
    if std::fs::symlink_metadata(&first).is_err() {
        return Ok(first);
    }
    let (directory, name) = relative
        .rsplit_once('/')
        .map_or(("", relative), |(directory, name)| (directory, name));
    let (stem, extension) = match name.rsplit_once('.') {
        Some((stem, extension)) if !stem.is_empty() => (stem, format!(".{extension}")),
        _ => (name, String::new()),
    };
    for attempt in 2..=MAX_NAME_ATTEMPTS {
        let renamed = format!("{stem} {attempt}{extension}");
        let candidate = if directory.is_empty() {
            renamed
        } else {
            format!("{directory}/{renamed}")
        };
        let destination =
            crate::sandbox::resolve_within(folder, &candidate).map_err(copy_failed)?;
        if std::fs::symlink_metadata(&destination).is_err() {
            return Ok(destination);
        }
    }
    Err(copy_failed(relative))
}

pub(crate) fn write_buffer_copy(
    parent: &Path,
    folder_name: &str,
    files: &[BufferCopyFile],
    forbidden: &[PathBuf],
) -> Result<SavedBufferCopy, String> {
    let files: Vec<&BufferCopyFile> = files.iter().filter(|file| !managed(&file.path)).collect();
    if files.is_empty() {
        return Err(AppError::new("project.copy_nothing_open").into());
    }
    if files.len() > MAX_COPY_FILES
        || files.iter().map(|file| file.content.len()).sum::<usize>() > MAX_COPY_BYTES
    {
        return Err(AppError::new("project.copy_too_large").into());
    }
    if let Some(bad) = files.iter().find(|file| !portable_relative(&file.path)) {
        return Err(copy_failed(&bad.path));
    }
    let parent = parent.canonicalize().map_err(copy_failed)?;
    if !parent.is_dir() {
        return Err(crate::project_rebind::not_a_folder());
    }
    if forbidden.iter().any(|root| parent.starts_with(root)) {
        return Err(AppError::new("project.copy_destination_refused").into());
    }
    let folder = create_unique_folder(&parent, folder_name)?;
    for file in &files {
        let destination = free_destination(&folder, &file.path)?;
        if let Some(directory) = destination.parent() {
            std::fs::create_dir_all(directory).map_err(copy_failed)?;
        }
        crate::sandbox::atomic_write(&destination, file.content.as_bytes()).map_err(copy_failed)?;
    }
    Ok(SavedBufferCopy {
        folder: folder.to_string_lossy().into_owned(),
        written: files.len(),
    })
}

fn forbidden_roots(project_id: &str) -> Result<Vec<PathBuf>, String> {
    let data = crate::paths::oleafly_root()?;
    let mut roots = vec![data.canonicalize().unwrap_or(data)];
    if let Ok(projects) = crate::paths::projects_root().and_then(|projects| {
        projects
            .canonicalize()
            .map_err(|error| format!("could not resolve the library folder: {error}"))
    }) {
        roots.push(projects);
    }
    if let crate::linked_registry::Membership::Active(member) =
        crate::linked_registry::refreshed_membership(project_id)?
    {
        roots.push(PathBuf::from(member.record.canonical_path));
    }
    Ok(roots)
}

#[tauri::command]
pub async fn save_open_buffers_copy(
    app: tauri::AppHandle,
    state: tauri::State<'_, crate::state::AppState>,
    project_id: String,
    name: String,
    files: Vec<BufferCopyFile>,
) -> Result<Option<SavedBufferCopy>, String> {
    use tauri_plugin_dialog::DialogExt;
    crate::paths::validate_project_id(&project_id)?;
    let (sender, receiver) = tokio::sync::oneshot::channel();
    app.dialog()
        .file()
        .set_title(crate::i18n::t("dialog.saveCopy.title"))
        .pick_folder(move |selection| {
            let _ = sender.send(selection);
        });
    let Some(selection) = receiver
        .await
        .map_err(|_| crate::project_rebind::folder_picker_failed())?
    else {
        return Ok(None);
    };
    let parent = selection
        .into_path()
        .map_err(|_| crate::project_rebind::not_a_folder())?;
    let folder_name = copy_folder_name(&name, &crate::i18n::t("dialog.saveCopy.folderSuffix"));
    let saved = tauri::async_runtime::spawn_blocking(move || {
        let forbidden = forbidden_roots(&project_id).map_err(copy_failed)?;
        write_buffer_copy(&parent, &folder_name, &files, &forbidden)
    })
    .await
    .map_err(copy_failed)??;
    crate::commands::allow_reveal_export(&saved.folder, &state).await;
    Ok(Some(saved))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn file(path: &str, content: &str) -> BufferCopyFile {
        BufferCopyFile {
            path: path.into(),
            content: content.into(),
        }
    }

    #[test]
    fn copies_open_buffers_into_a_new_folder_and_never_reuses_one() {
        let parent = tempfile::tempdir().unwrap();
        let files = [
            file("main.tex", "\\documentclass{article}\r\n"),
            file("sections/intro.tex", "Intro\n"),
            file(".git/config", "[core]\n"),
            file(".oleafly/build/x.aux", "aux\n"),
        ];
        let first = write_buffer_copy(parent.path(), "Thesis copy", &files, &[]).unwrap();
        let second = write_buffer_copy(parent.path(), "Thesis copy", &files, &[]).unwrap();
        let first_folder = PathBuf::from(&first.folder);
        assert_eq!(first_folder.file_name().unwrap(), "Thesis copy");
        assert_eq!(
            PathBuf::from(&second.folder).file_name().unwrap(),
            "Thesis copy 2"
        );
        assert_eq!(first.written, 2);
        assert_eq!(
            std::fs::read_to_string(first_folder.join("main.tex")).unwrap(),
            "\\documentclass{article}\r\n"
        );
        assert_eq!(
            std::fs::read_to_string(first_folder.join("sections/intro.tex")).unwrap(),
            "Intro\n"
        );
        assert!(!first_folder.join(".git").exists());
        assert!(!first_folder.join(".oleafly").exists());
    }

    #[test]
    fn refuses_traversal_and_empty_copies_before_creating_anything() {
        let parent = tempfile::tempdir().unwrap();
        for bad in ["../escape.tex", "/abs.tex", "a\\b.tex", "./main.tex", ""] {
            let error =
                write_buffer_copy(parent.path(), "Copy", &[file(bad, "x")], &[]).unwrap_err();
            assert!(error.contains("project.copy_failed"), "{bad}: {error}");
        }
        let empty =
            write_buffer_copy(parent.path(), "Copy", &[file(".git/HEAD", "x")], &[]).unwrap_err();
        assert!(empty.contains("project.copy_nothing_open"), "{empty}");
        assert_eq!(std::fs::read_dir(parent.path()).unwrap().count(), 0);
    }

    #[test]
    fn refuses_a_destination_inside_a_forbidden_root() {
        let data = tempfile::tempdir().unwrap();
        let inside = data.path().join("nested");
        std::fs::create_dir(&inside).unwrap();
        let forbidden = [data.path().canonicalize().unwrap()];
        let error =
            write_buffer_copy(&inside, "Copy", &[file("main.tex", "x")], &forbidden).unwrap_err();
        assert!(
            error.contains("project.copy_destination_refused"),
            "{error}"
        );
        assert_eq!(std::fs::read_dir(&inside).unwrap().count(), 0);
        let outside = tempfile::tempdir().unwrap();
        assert!(
            write_buffer_copy(outside.path(), "Copy", &[file("main.tex", "x")], &forbidden).is_ok()
        );
    }

    #[test]
    fn a_destination_that_is_not_a_folder_is_reported_in_the_user_language() {
        let parent = tempfile::tempdir().unwrap();
        let not_a_folder = parent.path().join("notes.txt");
        std::fs::write(&not_a_folder, "x").unwrap();
        let error =
            write_buffer_copy(&not_a_folder, "Copy", &[file("main.tex", "x")], &[]).unwrap_err();
        assert!(error.contains("project.folder_not_a_folder"), "{error}");
        let gone = parent.path().join("gone");
        let error = write_buffer_copy(&gone, "Copy", &[file("main.tex", "x")], &[]).unwrap_err();
        assert!(error.contains("project.copy_failed"), "{error}");
    }

    #[cfg(unix)]
    #[test]
    fn a_folder_that_cannot_be_written_is_reported_in_the_user_language() {
        use std::os::unix::fs::PermissionsExt;
        let parent = tempfile::tempdir().unwrap();
        let locked = parent.path().join("locked");
        std::fs::create_dir(&locked).unwrap();
        std::fs::set_permissions(&locked, std::fs::Permissions::from_mode(0o555)).unwrap();
        let result = write_buffer_copy(&locked, "Copy", &[file("main.tex", "x")], &[]);
        std::fs::set_permissions(&locked, std::fs::Permissions::from_mode(0o755)).unwrap();
        let error = result.unwrap_err();
        assert!(error.contains("project.copy_failed"), "{error}");
        assert_eq!(std::fs::read_dir(&locked).unwrap().count(), 0);
    }

    #[test]
    fn two_buffers_that_differ_only_in_case_both_survive() {
        let parent = tempfile::tempdir().unwrap();
        let saved = write_buffer_copy(
            parent.path(),
            "Copy",
            &[file("Notes.tex", "upper\n"), file("notes.tex", "lower\n")],
            &[],
        )
        .unwrap();
        let folder = PathBuf::from(&saved.folder);
        let mut contents: Vec<String> = std::fs::read_dir(&folder)
            .unwrap()
            .map(|entry| std::fs::read_to_string(entry.unwrap().path()).unwrap())
            .collect();
        contents.sort();
        assert_eq!(contents, vec!["lower\n".to_string(), "upper\n".to_string()]);
        assert_eq!(saved.written, 2);
    }

    #[test]
    fn every_failure_code_has_an_english_message() {
        let catalog: serde_json::Value =
            serde_json::from_str(include_str!("../../src/i18n/locales/en/errors.json")).unwrap();
        for error in [
            copy_failed("x"),
            crate::project_rebind::folder_picker_failed(),
            crate::project_rebind::not_a_folder(),
        ] {
            let encoded: serde_json::Value =
                serde_json::from_str(&error[crate::app_error::PREFIX.len()..]).unwrap();
            let code = encoded["code"].as_str().unwrap();
            let (namespace, key) = code.split_once('.').unwrap();
            assert!(catalog[namespace][key].is_string(), "{code}");
        }
    }

    #[test]
    fn copy_folder_names_are_safe_on_every_platform() {
        assert_eq!(
            copy_folder_name("My: Thesis/2026", "copy"),
            "My- Thesis-2026 copy"
        );
        assert_eq!(copy_folder_name("  ..  ", "copy"), "Oleafly project copy");
        assert_eq!(
            copy_folder_name(&"x".repeat(200), "copy").chars().count(),
            85
        );
    }
}
