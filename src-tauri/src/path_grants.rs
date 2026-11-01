use std::collections::VecDeque;
use std::future::Future;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard, PoisonError};

use serde::Deserialize;
use tauri::{Runtime, Webview};

const GRANT_LIMIT: usize = 256;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Access {
    Open,
    Save,
}

struct Grants {
    entries: VecDeque<(Access, PathBuf)>,
    limit: usize,
}

impl Grants {
    const fn new(limit: usize) -> Self {
        Self {
            entries: VecDeque::new(),
            limit,
        }
    }

    fn insert(&mut self, access: Access, key: PathBuf) {
        if self.contains(access, &key) {
            return;
        }
        if self.entries.len() >= self.limit {
            self.entries.pop_front();
        }
        self.entries.push_back((access, key));
    }

    fn contains(&self, access: Access, key: &Path) -> bool {
        self.entries
            .iter()
            .any(|(kind, granted)| *kind == access && granted == key)
    }
}

static GRANTS: Mutex<Grants> = Mutex::new(Grants::new(GRANT_LIMIT));

fn grants() -> MutexGuard<'static, Grants> {
    GRANTS.lock().unwrap_or_else(PoisonError::into_inner)
}

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
    if let Some(key) = grant_key(path) {
        grants().insert(access, key);
    }
}

pub fn granted(access: Access, path: &Path) -> bool {
    grant_key(path).is_some_and(|key| grants().contains(access, &key))
}

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

pub fn require_save(dest: &str) -> Result<(), String> {
    require(Access::Save, Path::new(dest))
}

pub fn require_open(source: &str) -> Result<(), String> {
    require(Access::Open, Path::new(source))
}

#[derive(Debug, Default, PartialEq, Deserialize)]
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

#[derive(Debug, Default, PartialEq)]
struct DialogSpec {
    title: Option<String>,
    filters: Vec<DialogFilter>,
    directory: Option<PathBuf>,
    file_name: Option<String>,
    can_create_directories: Option<bool>,
}

impl DialogSpec {
    fn new(
        title: Option<String>,
        filters: Vec<DialogFilter>,
        default_path: Option<PathBuf>,
        can_create_directories: Option<bool>,
    ) -> Self {
        let (directory, file_name) = default_path
            .as_deref()
            .map(dialog_start)
            .unwrap_or_default();
        Self {
            title,
            filters,
            directory,
            file_name,
            can_create_directories,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum PickKind {
    File,
    Files,
    Folder,
    Folders,
    Save,
}

fn dialog_start(default_path: &Path) -> (Option<PathBuf>, Option<String>) {
    let default_path: PathBuf = default_path.components().collect();
    if default_path.is_dir() {
        return (Some(default_path), None);
    }
    match (default_path.parent(), default_path.file_name()) {
        (Some(parent), Some(name)) => (
            (parent.components().count() > 0).then(|| parent.to_path_buf()),
            Some(name.to_string_lossy().into_owned()),
        ),
        _ => (Some(default_path), None),
    }
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

async fn native_pick<R: Runtime>(
    webview: &Webview<R>,
    spec: DialogSpec,
    kind: PickKind,
) -> Result<Option<Vec<PathBuf>>, String> {
    use tauri_plugin_dialog::DialogExt;
    let mut dialog = webview.dialog().file();
    if let Some(title) = spec.title {
        dialog = dialog.set_title(title);
    }
    if let Some(directory) = spec.directory {
        dialog = dialog.set_directory(directory);
    }
    if let Some(name) = spec.file_name {
        dialog = dialog.set_file_name(name);
    }
    if let Some(can) = spec.can_create_directories {
        dialog = dialog.set_can_create_directories(can);
    }
    for filter in spec.filters {
        let extensions: Vec<&str> = filter.extensions.iter().map(String::as_str).collect();
        dialog = dialog.add_filter(filter.name, &extensions);
    }
    // Like the dialog plugin: an open dialog gets a parent window on Windows
    // and macOS, a save dialog on every desktop.
    if kind == PickKind::Save || cfg!(any(windows, target_os = "macos")) {
        dialog = dialog.set_parent(&webview.window());
    }
    let (sender, receiver) = tokio::sync::oneshot::channel();
    match kind {
        PickKind::Folders => dialog.pick_folders(move |picked| {
            let _ = sender.send(picked_paths(picked));
        }),
        PickKind::Folder => dialog.pick_folder(move |picked| {
            let _ = sender.send(picked_paths(picked.map(|path| vec![path])));
        }),
        PickKind::Files => dialog.pick_files(move |picked| {
            let _ = sender.send(picked_paths(picked));
        }),
        PickKind::File => dialog.pick_file(move |picked| {
            let _ = sender.send(picked_paths(picked.map(|path| vec![path])));
        }),
        PickKind::Save => dialog.save_file(move |picked| {
            let _ = sender.send(picked_paths(picked.map(|path| vec![path])));
        }),
    }
    receiver.await.map_err(|_| match kind {
        PickKind::Save => "The save dialog closed unexpectedly.".to_string(),
        _ => "The file picker closed unexpectedly.".to_string(),
    })
}

async fn open_with<P, Fut>(
    options: OpenDialogOptions,
    pick: P,
) -> Result<Option<Vec<String>>, String>
where
    P: FnOnce(DialogSpec, PickKind) -> Fut,
    Fut: Future<Output = Result<Option<Vec<PathBuf>>, String>>,
{
    let kind = match (options.directory, options.multiple) {
        (true, true) => PickKind::Folders,
        (true, false) => PickKind::Folder,
        (false, true) => PickKind::Files,
        (false, false) => PickKind::File,
    };
    let spec = DialogSpec::new(
        options.title,
        options.filters,
        options.default_path,
        options.can_create_directories,
    );
    let Some(paths) = pick(spec, kind).await? else {
        return Ok(None);
    };
    for path in &paths {
        grant(Access::Open, path);
    }
    Ok(Some(paths.iter().map(|path| display(path)).collect()))
}

async fn save_with<P, Fut>(options: SaveDialogOptions, pick: P) -> Result<Option<String>, String>
where
    P: FnOnce(DialogSpec, PickKind) -> Fut,
    Fut: Future<Output = Result<Option<Vec<PathBuf>>, String>>,
{
    let spec = DialogSpec::new(
        options.title,
        options.filters,
        options.default_path,
        options.can_create_directories,
    );
    let Some(path) = pick(spec, PickKind::Save)
        .await?
        .and_then(|paths| paths.into_iter().next())
    else {
        return Ok(None);
    };
    grant(Access::Save, &path);
    Ok(Some(display(&path)))
}

#[tauri::command]
pub async fn pick_open_paths<R: Runtime>(
    webview: Webview<R>,
    options: Option<OpenDialogOptions>,
) -> Result<Option<Vec<String>>, String> {
    open_with(options.unwrap_or_default(), |spec, kind| {
        native_pick(&webview, spec, kind)
    })
    .await
}

#[tauri::command]
pub async fn pick_save_path<R: Runtime>(
    webview: Webview<R>,
    options: Option<SaveDialogOptions>,
) -> Result<Option<String>, String> {
    save_with(options.unwrap_or_default(), |spec, kind| {
        native_pick(&webview, spec, kind)
    })
    .await
}

fn require_test_build() -> Result<(), String> {
    if cfg!(any(feature = "e2e-testing", debug_assertions)) {
        return Ok(());
    }
    Err("Picked-path registration is available only in e2e and development builds.".into())
}

#[tauri::command]
pub fn grant_test_open_paths(paths: Vec<String>) -> Result<Vec<String>, String> {
    require_test_build()?;
    for path in &paths {
        grant(Access::Open, Path::new(path));
    }
    Ok(paths)
}

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

    #[test]
    fn the_oldest_grant_goes_once_the_list_is_full() {
        let mut grants = Grants::new(2);
        grants.insert(Access::Open, PathBuf::from("/a"));
        grants.insert(Access::Open, PathBuf::from("/b"));
        grants.insert(Access::Open, PathBuf::from("/a"));
        grants.insert(Access::Save, PathBuf::from("/c"));
        assert!(!grants.contains(Access::Open, Path::new("/a")));
        assert!(grants.contains(Access::Open, Path::new("/b")));
        assert!(grants.contains(Access::Save, Path::new("/c")));
    }

    #[test]
    fn a_default_path_opens_where_the_dialog_plugin_would() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(dialog_start(dir.path()), (Some(dir.path().into()), None));
        assert_eq!(
            dialog_start(&dir.path().join("out.pdf")),
            (Some(dir.path().into()), Some("out.pdf".into()))
        );
        assert_eq!(
            dialog_start(Path::new("out.pdf")),
            (None, Some("out.pdf".into()))
        );
        let up = dir.path().join("missing").join("..");
        assert_eq!(dialog_start(&up), (Some(up.clone()), None));
    }

    #[test]
    fn only_local_paths_come_back_from_a_pick() {
        use tauri_plugin_dialog::FilePath;
        let local = std::env::temp_dir().join("picked.tex");
        let remote = FilePath::Url("https://example.com/paper.tex".parse().unwrap());
        assert_eq!(
            picked_paths(Some(vec![FilePath::Path(local.clone()), remote])),
            Some(vec![local])
        );
        assert_eq!(picked_paths(None), None);
    }

    #[test]
    fn an_open_pick_is_recorded_as_readable_and_handed_back() {
        let dir = tempfile::tempdir().unwrap();
        let first = dir.path().join("a.bib");
        let second = dir.path().join("b.bib");
        std::fs::write(&first, b"@a").unwrap();
        std::fs::write(&second, b"@b").unwrap();
        let options: OpenDialogOptions = serde_json::from_value(serde_json::json!({
            "title": "Import bibliography",
            "filters": [{ "name": "BibTeX", "extensions": ["bib"] }],
            "multiple": true,
            "defaultPath": dir.path(),
            "canCreateDirectories": false,
        }))
        .unwrap();
        let mut asked = None;
        let picked = vec![first.clone(), second.clone()];
        let result = tauri::async_runtime::block_on(open_with(options, |spec, kind| {
            asked = Some((spec, kind));
            async { Ok(Some(picked)) }
        }))
        .unwrap();
        assert_eq!(
            asked,
            Some((
                DialogSpec {
                    title: Some("Import bibliography".into()),
                    filters: vec![DialogFilter {
                        name: "BibTeX".into(),
                        extensions: vec!["bib".into()],
                    }],
                    directory: Some(dir.path().into()),
                    file_name: None,
                    can_create_directories: Some(false),
                },
                PickKind::Files,
            ))
        );
        assert_eq!(result, Some(vec![display(&first), display(&second)]));
        assert!(granted(Access::Open, &first) && granted(Access::Open, &second));
        assert!(!granted(Access::Save, &first));
    }

    #[test]
    fn each_open_mode_asks_for_its_own_dialog_and_a_cancel_grants_nothing() {
        for (directory, multiple, expected) in [
            (false, false, PickKind::File),
            (false, true, PickKind::Files),
            (true, false, PickKind::Folder),
            (true, true, PickKind::Folders),
        ] {
            let options = OpenDialogOptions {
                directory,
                multiple,
                ..Default::default()
            };
            let mut asked = None;
            let result = tauri::async_runtime::block_on(open_with(options, |spec, kind| {
                asked = Some((spec, kind));
                async { Ok(None) }
            }));
            assert_eq!(result, Ok(None));
            assert_eq!(asked, Some((DialogSpec::default(), expected)));
        }
    }

    #[test]
    fn a_save_pick_opens_in_the_parent_and_is_recorded_as_writable() {
        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join("report.pdf");
        let options: SaveDialogOptions = serde_json::from_value(serde_json::json!({
            "title": "Export PDF",
            "defaultPath": target,
        }))
        .unwrap();
        let mut asked = None;
        let chosen = target.clone();
        let result = tauri::async_runtime::block_on(save_with(options, |spec, kind| {
            asked = Some((spec, kind));
            async { Ok(Some(vec![chosen])) }
        }))
        .unwrap();
        assert_eq!(
            asked,
            Some((
                DialogSpec {
                    title: Some("Export PDF".into()),
                    directory: Some(dir.path().into()),
                    file_name: Some("report.pdf".into()),
                    ..Default::default()
                },
                PickKind::Save,
            ))
        );
        assert_eq!(result, Some(display(&target)));
        assert!(granted(Access::Save, &target));
        assert!(!granted(Access::Open, &target));
    }

    #[test]
    fn a_cancelled_or_failed_dialog_hands_back_nothing() {
        let save = |answer: Result<Option<Vec<PathBuf>>, String>| {
            tauri::async_runtime::block_on(save_with(Default::default(), |_, _| async { answer }))
        };
        assert_eq!(save(Ok(None)), Ok(None));
        assert_eq!(save(Ok(Some(Vec::new()))), Ok(None));
        let closed = "The save dialog closed unexpectedly.".to_string();
        assert_eq!(save(Err(closed.clone())), Err(closed));
        let failed = tauri::async_runtime::block_on(open_with(Default::default(), |_, _| async {
            Err("The file picker closed unexpectedly.".to_string())
        }));
        assert_eq!(
            failed,
            Err("The file picker closed unexpectedly.".to_string())
        );
    }

    #[test]
    fn test_builds_can_record_a_pick_for_their_dialog_stand_ins() {
        let dir = tempfile::tempdir().unwrap();
        let source = dir.path().join("fixture.docx");
        std::fs::write(&source, b"docx").unwrap();
        let dest = dir.path().join("out.pdf");
        assert_eq!(
            grant_test_open_paths(vec![display(&source)]),
            Ok(vec![display(&source)])
        );
        assert_eq!(grant_test_save_path(display(&dest)), Ok(display(&dest)));
        assert!(granted(Access::Open, &source));
        assert!(granted(Access::Save, &dest));
        assert!(!granted(Access::Save, &source));
    }

    fn refused<T: std::fmt::Debug>(result: Result<T, String>, access: Access) {
        let error = result.unwrap_err();
        let expected = match access {
            Access::Open => "if you pick it in Oleafly's file picker",
            Access::Save => "if you choose it in Oleafly's save dialog",
        };
        assert!(error.contains(expected), "{error}");
    }

    #[test]
    fn every_guarded_command_refuses_a_path_nobody_picked() {
        use tauri::async_runtime::block_on;
        use tauri::Manager;
        let app = tauri::test::mock_app();
        app.manage(crate::state::AppState::default());
        let state = || app.state::<crate::state::AppState>();
        let dir = tempfile::tempdir().unwrap();
        let dest = display(&dir.path().join("unpicked.out"));
        let source_path = dir.path().join("unpicked.in");
        std::fs::write(&source_path, b"in").unwrap();
        let source = display(&source_path);
        let project = "guarded-command-test".to_string();

        refused(
            block_on(crate::commands::write_bytes_file(
                dest.clone(),
                String::new(),
                state(),
            )),
            Access::Save,
        );
        refused(
            block_on(crate::commands::export_project_image(
                project.clone(),
                dest.clone(),
                String::new(),
                state(),
            )),
            Access::Save,
        );
        refused(
            block_on(crate::project::export_pdf(
                project.clone(),
                dest.clone(),
                state(),
            )),
            Access::Save,
        );
        refused(
            block_on(crate::typst_export::export_typst_document(
                project.clone(),
                "main.typ".into(),
                serde_json::from_value(serde_json::json!({ "format": "pdf" })).unwrap(),
                dest.clone(),
                state(),
            )),
            Access::Save,
        );
        refused(
            block_on(crate::checkpoint_backup::checkpoint_export(
                project.clone(),
                dest.clone(),
                "password".into(),
                state(),
            )),
            Access::Save,
        );
        refused(
            crate::logsafe::export_log_archive(dest.clone(), None),
            Access::Save,
        );
        refused(
            block_on(crate::checkpoint_backup::checkpoint_import(
                project.clone(),
                source.clone(),
                "password".into(),
                state(),
            )),
            Access::Open,
        );
        refused(
            block_on(crate::project::import_document(
                app.handle().clone(),
                source.clone(),
                None,
            )),
            Access::Open,
        );
        refused(
            block_on(crate::project::import_paths_into_project(
                app.handle().clone(),
                state(),
                project.clone(),
                String::new(),
                vec![source.clone()],
                None,
            )),
            Access::Open,
        );
        refused(
            crate::research_workspace::add_research_root(
                serde_json::from_value(serde_json::json!({
                    "projectId": project,
                    "path": source,
                    "label": "Data",
                    "role": "data",
                }))
                .unwrap(),
            ),
            Access::Open,
        );
        assert!(!dir.path().join("unpicked.out").exists());
    }
}
