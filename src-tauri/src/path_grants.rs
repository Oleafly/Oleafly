//! Paths the user chose in a native open or save dialog.
//!
//! Commands that read or write outside a project accept only paths recorded
//! here (or, on Linux, paths the user just dropped on the window), so a script
//! in the webview can't name an arbitrary path itself. The dialogs run in Rust
//! and record their result before handing it to the webview.

use std::collections::VecDeque;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, PoisonError};

use serde::Deserialize;
use tauri::{Runtime, Webview};

const GRANT_LIMIT: usize = 256;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Access {
    /// Chosen in an open dialog: the path may be read.
    Open,
    /// Chosen in a save dialog: the path may be written.
    Save,
}

static GRANTS: Mutex<VecDeque<(Access, PathBuf)>> = Mutex::new(VecDeque::new());

/// The form a path is compared in. A file that doesn't exist yet (a save
/// destination) is its canonical parent plus its name.
fn grant_key(path: &Path) -> Option<PathBuf> {
    if let Ok(canonical) = path.canonicalize() {
        return Some(canonical);
    }
    let name = path.file_name()?;
    let parent = path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())?;
    Some(parent.canonicalize().ok()?.join(name))
}

pub fn grant(access: Access, path: &Path) {
    let Some(key) = grant_key(path) else {
        return;
    };
    let mut grants = GRANTS.lock().unwrap_or_else(PoisonError::into_inner);
    if grants
        .iter()
        .any(|(kind, granted)| *kind == access && *granted == key)
    {
        return;
    }
    if grants.len() >= GRANT_LIMIT {
        grants.pop_front();
    }
    grants.push_back((access, key));
}

pub fn granted(access: Access, path: &Path) -> bool {
    let Some(key) = grant_key(path) else {
        return false;
    };
    GRANTS
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .iter()
        .any(|(kind, granted)| *kind == access && *granted == key)
}

/// Refuses a path the user didn't choose in Oleafly's own dialog.
pub fn require(access: Access, path: &Path) -> Result<(), String> {
    if granted(access, path) {
        return Ok(());
    }
    Err(match access {
        Access::Open => format!(
            "Oleafly can only open {} if you pick it in Oleafly's file picker. Pick it again.",
            path.display()
        ),
        Access::Save => format!(
            "Oleafly can only save to {} if you choose it in Oleafly's save dialog. Try the export again.",
            path.display()
        ),
    })
}

/// Refuses a write the user didn't choose in Oleafly's save dialog.
pub fn require_save(dest: &str) -> Result<(), String> {
    require(Access::Save, Path::new(dest))
}

/// Refuses a read the user didn't choose in Oleafly's open dialog.
pub fn require_open(source: &str) -> Result<(), String> {
    require(Access::Open, Path::new(source))
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DialogFilter {
    name: String,
    extensions: Vec<String>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenDialogOptions {
    title: Option<String>,
    #[serde(default)]
    filters: Vec<DialogFilter>,
    #[serde(default)]
    multiple: bool,
    #[serde(default)]
    directory: bool,
    default_path: Option<PathBuf>,
    can_create_directories: Option<bool>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveDialogOptions {
    title: Option<String>,
    #[serde(default)]
    filters: Vec<DialogFilter>,
    default_path: Option<PathBuf>,
    can_create_directories: Option<bool>,
}

/// The dialog plugin's own handling of a default path: an existing folder
/// opens there, anything else opens in its parent with its name filled in.
fn with_default_path<R: Runtime>(
    dialog: tauri_plugin_dialog::FileDialogBuilder<R>,
    default_path: PathBuf,
) -> tauri_plugin_dialog::FileDialogBuilder<R> {
    let default_path: PathBuf = default_path.components().collect();
    if default_path.is_dir() {
        return dialog.set_directory(default_path);
    }
    match (default_path.parent(), default_path.file_name()) {
        (Some(parent), Some(name)) => {
            let dialog = if parent.components().count() > 0 {
                dialog.set_directory(parent)
            } else {
                dialog
            };
            dialog.set_file_name(name.to_string_lossy())
        }
        _ => dialog.set_directory(default_path),
    }
}

fn file_dialog<R: Runtime>(
    webview: &Webview<R>,
    title: Option<String>,
    filters: Vec<DialogFilter>,
    default_path: Option<PathBuf>,
    can_create_directories: Option<bool>,
) -> tauri_plugin_dialog::FileDialogBuilder<R> {
    use tauri_plugin_dialog::DialogExt;
    let mut dialog = webview.dialog().file();
    if let Some(title) = title {
        dialog = dialog.set_title(title);
    }
    if let Some(default_path) = default_path {
        dialog = with_default_path(dialog, default_path);
    }
    if let Some(can) = can_create_directories {
        dialog = dialog.set_can_create_directories(can);
    }
    for filter in filters {
        let extensions: Vec<&str> = filter.extensions.iter().map(String::as_str).collect();
        dialog = dialog.add_filter(filter.name, &extensions);
    }
    dialog
}

fn picked_paths(selection: Option<Vec<tauri_plugin_dialog::FilePath>>) -> Option<Vec<PathBuf>> {
    selection.map(|paths| {
        paths
            .into_iter()
            .filter_map(|path| path.into_path().ok())
            .collect()
    })
}

fn display(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

/// Shows a native open dialog and records what the user picked as readable.
#[tauri::command]
pub async fn pick_open_paths<R: Runtime>(
    webview: Webview<R>,
    options: Option<OpenDialogOptions>,
) -> Result<Option<Vec<String>>, String> {
    let options = options.unwrap_or_default();
    #[cfg_attr(target_os = "linux", allow(unused_mut))]
    let mut dialog = file_dialog(
        &webview,
        options.title,
        options.filters,
        options.default_path,
        options.can_create_directories,
    );
    #[cfg(any(windows, target_os = "macos"))]
    {
        dialog = dialog.set_parent(&webview.window());
    }
    let (sender, receiver) = tokio::sync::oneshot::channel();
    match (options.directory, options.multiple) {
        (true, true) => dialog.pick_folders(move |picked| {
            let _ = sender.send(picked_paths(picked));
        }),
        (true, false) => dialog.pick_folder(move |picked| {
            let _ = sender.send(picked_paths(picked.map(|path| vec![path])));
        }),
        (false, true) => dialog.pick_files(move |picked| {
            let _ = sender.send(picked_paths(picked));
        }),
        (false, false) => dialog.pick_file(move |picked| {
            let _ = sender.send(picked_paths(picked.map(|path| vec![path])));
        }),
    }
    let Some(paths) = receiver
        .await
        .map_err(|_| "The file picker closed unexpectedly.".to_string())?
    else {
        return Ok(None);
    };
    for path in &paths {
        grant(Access::Open, path);
    }
    Ok(Some(paths.iter().map(|path| display(path)).collect()))
}

/// Shows a native save dialog and records the chosen path as writable.
#[tauri::command]
pub async fn pick_save_path<R: Runtime>(
    webview: Webview<R>,
    options: Option<SaveDialogOptions>,
) -> Result<Option<String>, String> {
    let options = options.unwrap_or_default();
    let dialog = file_dialog(
        &webview,
        options.title,
        options.filters,
        options.default_path,
        options.can_create_directories,
    )
    .set_parent(&webview.window());
    let (sender, receiver) = tokio::sync::oneshot::channel();
    dialog.save_file(move |picked| {
        let _ = sender.send(picked.and_then(|path| path.into_path().ok()));
    });
    let Some(path) = receiver
        .await
        .map_err(|_| "The save dialog closed unexpectedly.".to_string())?
    else {
        return Ok(None);
    };
    grant(Access::Save, &path);
    Ok(Some(display(&path)))
}

/// E2E and dev builds can stand in for the operating-system picker (the
/// webview's `E2E_HOOKS`); release builds refuse.
fn require_test_build() -> Result<(), String> {
    if cfg!(any(feature = "e2e-testing", debug_assertions)) {
        return Ok(());
    }
    Err("Picked-path registration is available only in e2e and development builds.".into())
}

/// Records paths a test chose the way `pick_open_paths` records a pick.
#[tauri::command]
pub fn grant_test_open_paths(paths: Vec<String>) -> Result<Vec<String>, String> {
    require_test_build()?;
    for path in &paths {
        grant(Access::Open, Path::new(path));
    }
    Ok(paths)
}

/// Records a path a test chose the way `pick_save_path` records a pick.
#[tauri::command]
pub fn grant_test_save_path(path: String) -> Result<String, String> {
    require_test_build()?;
    grant(Access::Save, Path::new(&path));
    Ok(path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_a_granted_path_passes_and_only_for_its_access() {
        let dir = tempfile::tempdir().unwrap();
        let picked = dir.path().join("picked.pdf");
        let other = dir.path().join("other.pdf");
        assert!(require(Access::Save, &picked).is_err());
        grant(Access::Save, &picked);
        assert!(require(Access::Save, &picked).is_ok());
        assert!(require(Access::Open, &picked).is_err());
        assert!(require(Access::Save, &other).is_err());
    }

    #[test]
    fn a_save_grant_still_matches_once_the_file_exists() {
        let dir = tempfile::tempdir().unwrap();
        let picked = dir.path().join("report.zip");
        grant(Access::Save, &picked);
        std::fs::write(&picked, b"zip").unwrap();
        assert!(granted(Access::Save, &picked));
    }

    #[test]
    fn another_spelling_of_the_same_path_matches() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir(dir.path().join("sub")).unwrap();
        let picked = dir.path().join("sub").join("figure.png");
        std::fs::write(&picked, b"png").unwrap();
        grant(Access::Open, &picked);
        let roundabout = dir
            .path()
            .join("sub")
            .join("..")
            .join("sub")
            .join("figure.png");
        assert!(granted(Access::Open, &roundabout));
    }

    #[test]
    fn a_relative_or_parentless_path_is_never_granted() {
        grant(Access::Save, Path::new("relative-grant-test.pdf"));
        assert!(!granted(Access::Save, Path::new("relative-grant-test.pdf")));
        assert!(!granted(Access::Save, Path::new("")));
    }

    #[test]
    fn a_path_in_a_missing_folder_is_never_granted() {
        let dir = tempfile::tempdir().unwrap();
        let picked = dir.path().join("missing").join("out.pdf");
        grant(Access::Save, &picked);
        assert!(!granted(Access::Save, &picked));
    }

    #[cfg(unix)]
    #[test]
    fn a_symlink_planted_after_the_grant_does_not_redirect_it() {
        let dir = tempfile::tempdir().unwrap();
        let picked = dir.path().join("out.txt");
        grant(Access::Save, &picked);
        let secret = dir.path().join("secret");
        std::fs::write(&secret, b"keep").unwrap();
        std::os::unix::fs::symlink(&secret, &picked).unwrap();
        assert!(!granted(Access::Save, &picked));
    }
}
