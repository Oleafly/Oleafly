use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use oleafly_core::content::ContentHash;
use oleafly_core::pdf_sync::{free_name, numbered_name, title_stem, PdfSync};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::Emitter as _;

use crate::project::ProjectMeta;
use crate::project_location::{ProjectKind, ProjectLocation};

const STATE_FILE: &str = "pdf-sync.json";
const WRITTEN_EVENT: &str = "pdf-sync:written";

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct CompiledPdf {
    pub(crate) output_id: String,
    pub(crate) sources: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct CompilePlan {
    sources: Option<String>,
}

impl CompilePlan {
    pub(crate) fn compiled(self, has_pdf: bool, output_id: Option<&str>) -> Option<CompiledPdf> {
        Some(CompiledPdf {
            output_id: output_id.filter(|_| has_pdf)?.to_owned(),
            sources: self.sources,
        })
    }
}

#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
struct SavedPdf {
    path: String,
    hash: String,
}

#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
struct DeviceState {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    sources: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    failed: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    saved: Option<SavedPdf>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PdfSyncStatus {
    enabled: bool,
    path: Option<String>,
    failed: Option<String>,
    local_only: bool,
}

fn wants_sync(meta: &ProjectMeta, main_document: &str) -> bool {
    meta.main_doc == main_document && meta.pdf_sync.as_ref().is_some_and(|sync| sync.enabled)
}

fn settings_key(meta: &ProjectMeta) -> String {
    serde_json::json!([
        meta.engine,
        meta.main_doc,
        meta.tex_flavor,
        meta.tex,
        meta.typst,
        meta.allow_shell_escape,
    ])
    .to_string()
}

fn stamp_folder(
    folder: &Path,
    relative: &str,
    target: Option<&str>,
    entries: &mut Vec<String>,
) -> std::io::Result<()> {
    for entry in std::fs::read_dir(folder)? {
        let entry = entry?;
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if oleafly_core::exclude::is_capture_excluded_component(&name) {
            continue;
        }
        let child = if relative.is_empty() {
            name.into_owned()
        } else {
            format!("{relative}/{name}")
        };
        if target == Some(child.as_str()) {
            continue;
        }
        if entry.file_type()?.is_dir() {
            stamp_folder(&entry.path(), &child, target, entries)?;
            continue;
        }
        let metadata = entry.metadata()?;
        let modified = metadata
            .modified()
            .ok()
            .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
            .map_or(0, |elapsed| elapsed.as_nanos());
        entries.push(format!("{child}\0{}\0{modified}", metadata.len()));
    }
    Ok(())
}

fn source_stamp(root: &Path, target: Option<&str>, settings: &str) -> Option<String> {
    let mut entries = Vec::new();
    stamp_folder(root, "", target, &mut entries).ok()?;
    entries.sort();
    let mut hasher = Sha256::new();
    hasher.update(settings.as_bytes());
    for entry in &entries {
        hasher.update([0]);
        hasher.update(entry.as_bytes());
    }
    Some(format!("{:x}", hasher.finalize()))
}

fn stamp_for(meta: &ProjectMeta, root: &Path) -> Option<String> {
    let target = meta.pdf_sync.as_ref().and_then(PdfSync::target);
    source_stamp(root, target, &settings_key(meta))
}

pub(crate) async fn plan_compile(
    meta: &ProjectMeta,
    main_document: &str,
    fast: bool,
    project_dir: &Path,
) -> Option<CompilePlan> {
    if fast || !wants_sync(meta, main_document) {
        return None;
    }
    let meta = meta.clone();
    let root = project_dir.to_path_buf();
    let sources = tauri::async_runtime::spawn_blocking(move || stamp_for(&meta, &root))
        .await
        .ok()
        .flatten();
    Some(CompilePlan { sources })
}

pub(crate) async fn plan_live_compile(
    project_id: &str,
    main_document: &str,
) -> Option<CompilePlan> {
    let project_id = project_id.to_owned();
    let main_document = main_document.to_owned();
    let wanted = tauri::async_runtime::spawn_blocking(move || {
        crate::project::read_meta(&project_id).is_ok_and(|meta| wants_sync(&meta, &main_document))
    })
    .await
    .unwrap_or(false);
    wanted.then_some(CompilePlan { sources: None })
}

fn state_path(location: &ProjectLocation) -> Result<PathBuf, String> {
    let directory = location.private_state_dir();
    let directory = match location.kind {
        ProjectKind::Linked => location.ensure_linked_state(&directory)?,
        ProjectKind::Library => {
            std::fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
            directory
        }
    };
    Ok(directory.join(STATE_FILE))
}

fn read_state(location: &ProjectLocation) -> DeviceState {
    std::fs::read(location.private_state_dir().join(STATE_FILE))
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default()
}

fn write_state(location: &ProjectLocation, state: &DeviceState) -> Result<(), String> {
    let bytes = serde_json::to_vec_pretty(state).map_err(|error| error.to_string())?;
    crate::sandbox::atomic_write(&state_path(location)?, &bytes)
}

fn names_in(root: &Path) -> HashSet<String> {
    std::fs::read_dir(root)
        .into_iter()
        .flatten()
        .flatten()
        .map(|entry| oleafly_core::portable::fold(&entry.file_name().to_string_lossy()))
        .collect()
}

fn saved_copy_is_unchanged(device: &DeviceState, root: &Path, name: &str) -> bool {
    device.saved.as_ref().is_some_and(|saved| {
        saved.path == name
            && ContentHash::digest_file(root.join(name))
                .is_ok_and(|hash| hash.to_string() == saved.hash)
    })
}

fn current_target<'a>(sync: &'a PdfSync, title: &str) -> Option<&'a str> {
    sync.target().filter(|_| sync.stem == title_stem(title))
}

fn new_target(title: &str, root: &Path, device: &DeviceState, shared: bool) -> (String, String) {
    let stem = title_stem(title);
    let first = numbered_name(&stem, 1);
    let path = if !shared && saved_copy_is_unchanged(device, root, &first) {
        first
    } else {
        let taken = names_in(root);
        free_name(&stem, |name| {
            taken.contains(&oleafly_core::portable::fold(name))
        })
    };
    (stem, path)
}

fn claim_target(
    project_id: &str,
    meta: &ProjectMeta,
    root: &Path,
    device: &DeviceState,
    shared: bool,
) -> Result<String, String> {
    let sync = meta.pdf_sync.clone().unwrap_or_default();
    if let Some(path) = current_target(&sync, &meta.name) {
        return Ok(path.to_owned());
    }
    let (stem, path) = new_target(&meta.name, root, device, shared);
    let claimed = path.clone();
    crate::project::update_pdf_sync(project_id, move |sync| {
        sync.stem = stem;
        sync.path = claimed;
    })?;
    Ok(path)
}

fn compiled_bytes(
    project_id: &str,
    meta: &ProjectMeta,
    main_document: &str,
    output_id: &str,
) -> Result<Option<Vec<u8>>, String> {
    let Some(pdf) = crate::document_engine::existing_compiled_pdf_path(
        project_id,
        &meta.engine,
        main_document,
    )?
    else {
        return Ok(None);
    };
    match std::fs::read(&pdf) {
        Ok(bytes) => Ok(
            (crate::document_engine::fingerprint_compile_output(&bytes) == output_id)
                .then_some(bytes),
        ),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(format!("could not read the compiled PDF: {error}")),
    }
}

fn nothing_changed(
    meta: &ProjectMeta,
    root: &Path,
    device: &DeviceState,
    compiled: &CompiledPdf,
) -> bool {
    compiled.sources.is_some()
        && compiled.sources == device.sources
        && device.failed.is_none()
        && meta
            .pdf_sync
            .as_ref()
            .and_then(|sync| current_target(sync, &meta.name))
            .is_some_and(|path| root.join(path).is_file())
}

pub(crate) fn sync_compiled(
    project_id: &str,
    main_document: &str,
    compiled: &CompiledPdf,
) -> Result<Option<String>, String> {
    let meta = crate::project::read_meta(project_id)?;
    if !wants_sync(&meta, main_document) {
        return Ok(None);
    }
    let location = crate::project_location::locate(project_id).map_err(String::from)?;
    let mut device = read_state(&location);
    if nothing_changed(&meta, &location.root, &device, compiled) {
        return Ok(None);
    }
    let Some(bytes) = compiled_bytes(project_id, &meta, main_document, &compiled.output_id)? else {
        return Ok(None);
    };
    let shared = crate::collab::registry::is_shared(project_id);
    let target = claim_target(project_id, &meta, &location.root, &device, shared)?;
    if shared && !crate::collab::disk::ShareRules::load(&location.root).leaves_out(&target, false) {
        return Ok(None);
    }
    match crate::project::write_synced_pdf(project_id, &target, &bytes) {
        Ok(written) => {
            device.sources = compiled.sources.clone();
            device.failed = None;
            write_state(&location, &device)?;
            Ok(written.then_some(target))
        }
        Err(error) => {
            device.failed = Some(target);
            write_state(&location, &device)?;
            Err(error)
        }
    }
}

fn notify_written<R: tauri::Runtime>(app: &tauri::AppHandle<R>, project_id: &str, path: &str) {
    let _ = app.emit(
        WRITTEN_EVENT,
        serde_json::json!({ "projectId": project_id, "path": path }),
    );
}

fn report<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    project_id: &str,
    outcome: Result<Option<String>, String>,
) {
    match outcome {
        Ok(Some(path)) => notify_written(app, project_id, &path),
        Ok(None) => {}
        Err(error) => {
            let _ = crate::project::append_app_log(format!(
                "Could not update the synced PDF for project {project_id}: {error}"
            ));
        }
    }
}

pub(crate) async fn sync_in_background<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    project_id: &str,
    main_document: &str,
    compiled: CompiledPdf,
) {
    let id = project_id.to_owned();
    let main_document = main_document.to_owned();
    let outcome =
        tauri::async_runtime::spawn_blocking(move || sync_compiled(&id, &main_document, &compiled))
            .await
            .unwrap_or_else(|error| Err(error.to_string()));
    report(app, project_id, outcome);
}

fn status(project_id: &str) -> Result<PdfSyncStatus, String> {
    let meta = crate::project::read_meta(project_id)?;
    let location = crate::project_location::locate(project_id).map_err(String::from)?;
    let sync = meta.pdf_sync.unwrap_or_default();
    Ok(PdfSyncStatus {
        path: sync.target().map(str::to_owned),
        failed: read_state(&location).failed.filter(|_| sync.enabled),
        enabled: sync.enabled,
        local_only: crate::collab::registry::is_shared(project_id),
    })
}

fn set_enabled(
    project_id: &str,
    enabled: bool,
    output_id: Option<String>,
) -> Result<Result<Option<String>, String>, String> {
    let meta = crate::project::update_pdf_sync(project_id, |sync| sync.enabled = enabled)?;
    let Some(output_id) = output_id.filter(|_| enabled) else {
        return Ok(Ok(None));
    };
    let location = crate::project_location::locate(project_id).map_err(String::from)?;
    let compiled = CompiledPdf {
        output_id,
        sources: stamp_for(&meta, &location.root),
    };
    Ok(sync_compiled(project_id, &meta.main_doc, &compiled))
}

fn note_saved(project_id: &str, path: &str) -> Result<(), String> {
    let location = crate::project_location::locate(project_id).map_err(String::from)?;
    let hash = ContentHash::digest_file(crate::sandbox::resolve(project_id, path)?)
        .map_err(|error| format!("could not read {path}: {error}"))?;
    let mut device = read_state(&location);
    device.saved = Some(SavedPdf {
        path: path.to_owned(),
        hash: hash.to_string(),
    });
    write_state(&location, &device)
}

#[tauri::command]
pub async fn pdf_sync_status(project_id: String) -> Result<PdfSyncStatus, String> {
    tauri::async_runtime::spawn_blocking(move || status(&project_id))
        .await
        .map_err(|error| format!("PDF sync status task failed: {error}"))?
}

#[tauri::command]
pub async fn pdf_sync_set(
    app: tauri::AppHandle,
    project_id: String,
    enabled: bool,
    output_id: Option<String>,
) -> Result<PdfSyncStatus, String> {
    let id = project_id.clone();
    let outcome =
        tauri::async_runtime::spawn_blocking(move || set_enabled(&id, enabled, output_id))
            .await
            .map_err(|error| format!("PDF sync task failed: {error}"))??;
    report(&app, &project_id, outcome);
    tauri::async_runtime::spawn_blocking(move || status(&project_id))
        .await
        .map_err(|error| format!("PDF sync status task failed: {error}"))?
}

#[tauri::command]
pub async fn pdf_sync_note_saved(project_id: String, path: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || note_saved(&project_id, &path))
        .await
        .map_err(|error| format!("PDF sync task failed: {error}"))?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn meta(name: &str, sync: Option<PdfSync>) -> ProjectMeta {
        ProjectMeta {
            name: name.to_owned(),
            main_doc: "main.tex".to_owned(),
            engine: "tectonic".to_owned(),
            pdf_sync: sync,
            ..ProjectMeta::default()
        }
    }

    fn synced(stem: &str, path: &str) -> PdfSync {
        PdfSync {
            enabled: true,
            stem: stem.to_owned(),
            path: path.to_owned(),
        }
    }

    fn compiled(sources: Option<&str>) -> CompiledPdf {
        CompiledPdf {
            output_id: "pdf-v1:1:aa".to_owned(),
            sources: sources.map(str::to_owned),
        }
    }

    fn device(sources: Option<&str>) -> DeviceState {
        DeviceState {
            sources: sources.map(str::to_owned),
            ..DeviceState::default()
        }
    }

    #[test]
    fn only_the_project_main_document_syncs_and_only_when_on() {
        let on = meta("Thesis", Some(synced("Thesis", "Thesis.pdf")));
        assert!(wants_sync(&on, "main.tex"));
        assert!(!wants_sync(&on, "supplement.tex"));
        assert!(!wants_sync(&meta("Thesis", None), "main.tex"));
        let off = meta(
            "Thesis",
            Some(PdfSync {
                enabled: false,
                ..synced("Thesis", "Thesis.pdf")
            }),
        );
        assert!(!wants_sync(&off, "main.tex"));
    }

    #[test]
    fn the_stamp_follows_sources_and_ignores_the_synced_pdf() {
        let folder = tempfile::tempdir().unwrap();
        let root = folder.path();
        std::fs::write(root.join("main.tex"), "one").unwrap();
        std::fs::write(root.join("Thesis.pdf"), "pdf").unwrap();
        std::fs::create_dir(root.join(".oleafly")).unwrap();
        std::fs::write(root.join(".oleafly/state"), "a").unwrap();
        let first = source_stamp(root, Some("Thesis.pdf"), "settings").unwrap();

        std::fs::write(root.join("Thesis.pdf"), "a longer pdf").unwrap();
        std::fs::write(root.join(".oleafly/state"), "changed").unwrap();
        assert_eq!(
            source_stamp(root, Some("Thesis.pdf"), "settings").unwrap(),
            first
        );
        assert_ne!(
            source_stamp(root, Some("Thesis.pdf"), "other").unwrap(),
            first
        );

        std::fs::write(root.join("main.tex"), "one more").unwrap();
        assert_ne!(
            source_stamp(root, Some("Thesis.pdf"), "settings").unwrap(),
            first
        );
    }

    #[test]
    fn a_title_change_retires_the_current_target() {
        let sync = synced("Thesis", "Thesis.pdf");
        assert_eq!(current_target(&sync, "Thesis"), Some("Thesis.pdf"));
        assert_eq!(current_target(&sync, "Dissertation"), None);
        let numbered = synced("Thesis", "Thesis_2.pdf");
        assert_eq!(current_target(&numbered, "Thesis"), Some("Thesis_2.pdf"));
    }

    #[test]
    fn a_new_target_never_lands_on_a_file_that_is_already_there() {
        let folder = tempfile::tempdir().unwrap();
        let root = folder.path();
        let (stem, path) = new_target("Thesis: Final", root, &DeviceState::default(), false);
        assert_eq!(
            (stem.as_str(), path.as_str()),
            ("Thesis_Final", "Thesis_Final.pdf")
        );

        std::fs::write(root.join("THESIS_FINAL.PDF"), "someone else's").unwrap();
        let (_, path) = new_target("Thesis: Final", root, &DeviceState::default(), false);
        assert_eq!(path, "Thesis_Final_2.pdf");
    }

    #[test]
    fn a_pdf_saved_from_the_preview_is_adopted_until_it_is_edited() {
        let folder = tempfile::tempdir().unwrap();
        let root = folder.path();
        std::fs::write(root.join("Thesis.pdf"), "saved").unwrap();
        let saved = DeviceState {
            saved: Some(SavedPdf {
                path: "Thesis.pdf".to_owned(),
                hash: ContentHash::digest_file(root.join("Thesis.pdf"))
                    .unwrap()
                    .to_string(),
            }),
            ..DeviceState::default()
        };
        assert_eq!(new_target("Thesis", root, &saved, false).1, "Thesis.pdf");
        assert_eq!(new_target("Thesis", root, &saved, true).1, "Thesis_2.pdf");

        std::fs::write(root.join("Thesis.pdf"), "edited by hand").unwrap();
        assert_eq!(new_target("Thesis", root, &saved, false).1, "Thesis_2.pdf");
    }

    #[test]
    fn a_recompile_of_the_same_sources_writes_nothing() {
        let folder = tempfile::tempdir().unwrap();
        let root = folder.path();
        std::fs::write(root.join("Thesis.pdf"), "pdf").unwrap();
        let on = meta("Thesis", Some(synced("Thesis", "Thesis.pdf")));
        assert!(nothing_changed(
            &on,
            root,
            &device(Some("s1")),
            &compiled(Some("s1"))
        ));
        assert!(!nothing_changed(
            &on,
            root,
            &device(Some("s1")),
            &compiled(Some("s2"))
        ));
        assert!(!nothing_changed(
            &on,
            root,
            &device(Some("s1")),
            &compiled(None)
        ));
    }

    #[test]
    fn a_missing_file_a_failed_write_or_a_new_title_still_write() {
        let folder = tempfile::tempdir().unwrap();
        let root = folder.path();
        let on = meta("Thesis", Some(synced("Thesis", "Thesis.pdf")));
        let same = compiled(Some("s1"));
        assert!(!nothing_changed(&on, root, &device(Some("s1")), &same));

        std::fs::write(root.join("Thesis.pdf"), "pdf").unwrap();
        let failed = DeviceState {
            failed: Some("Thesis.pdf".to_owned()),
            ..device(Some("s1"))
        };
        assert!(!nothing_changed(&on, root, &failed, &same));

        let renamed = meta("Dissertation", Some(synced("Thesis", "Thesis.pdf")));
        assert!(!nothing_changed(&renamed, root, &device(Some("s1")), &same));
    }

    struct Fixture {
        id: &'static str,
        root: PathBuf,
        build: PathBuf,
        _data: tempfile::TempDir,
    }

    impl Fixture {
        fn new(id: &'static str, name: &str, sync: &str) -> Self {
            let data = tempfile::tempdir().unwrap();
            std::env::set_var("OLEAFLY_DATA_DIR", data.path());
            let root = crate::paths::create_project_dir(id).unwrap();
            std::fs::write(
                root.join("project.json"),
                format!(r#"{{"name":"{name}","main_doc":"main.tex","engine":"latexmk"{sync}}}"#),
            )
            .unwrap();
            std::fs::write(root.join("main.tex"), "\\documentclass{article}").unwrap();
            let build = root.join(".oleafly").join("build");
            std::fs::create_dir_all(&build).unwrap();
            Self {
                id,
                root,
                build,
                _data: data,
            }
        }

        fn built(&self, bytes: &[u8], sources: &str) -> CompiledPdf {
            std::fs::write(
                self.build.join(format!("{}.pdf", crate::paths::ENTRY_STEM)),
                bytes,
            )
            .unwrap();
            CompiledPdf {
                output_id: crate::document_engine::fingerprint_compile_output(bytes),
                sources: Some(sources.to_owned()),
            }
        }

        fn sync(&self, compiled: &CompiledPdf) -> Result<Option<String>, String> {
            sync_compiled(self.id, "main.tex", compiled)
        }

        fn read(&self, name: &str) -> Vec<u8> {
            std::fs::read(self.root.join(name)).unwrap()
        }
    }

    const SYNC_ON: &str = r#","pdf_sync":{"enabled":true}"#;

    #[test]
    fn compiles_keep_the_title_pdf_current_and_a_rename_leaves_the_old_copy_alone() {
        let _env_guard = crate::paths::data_dir_env_lock();
        let project = Fixture::new("pdf-sync-cycle", "Thesis: One", SYNC_ON);

        let first = project.built(b"%PDF one", "s1");
        assert_eq!(
            project.sync(&first).unwrap().as_deref(),
            Some("Thesis_One.pdf")
        );
        assert_eq!(project.read("Thesis_One.pdf"), b"%PDF one");
        let sync = crate::project::read_meta(project.id)
            .unwrap()
            .pdf_sync
            .unwrap();
        assert_eq!(
            (sync.stem.as_str(), sync.path.as_str()),
            ("Thesis_One", "Thesis_One.pdf")
        );

        let unchanged = project.built(b"%PDF one, stamped again", "s1");
        assert_eq!(project.sync(&unchanged).unwrap(), None);
        assert_eq!(project.read("Thesis_One.pdf"), b"%PDF one");

        let second = project.built(b"%PDF two", "s2");
        assert_eq!(
            project.sync(&second).unwrap().as_deref(),
            Some("Thesis_One.pdf")
        );
        assert_eq!(project.read("Thesis_One.pdf"), b"%PDF two");

        crate::project::rename_project_blocking(project.id.to_owned(), "Dissertation".to_owned())
            .unwrap();
        let renamed = project.built(b"%PDF three", "s2");
        assert_eq!(
            project.sync(&renamed).unwrap().as_deref(),
            Some("Dissertation.pdf")
        );
        assert_eq!(project.read("Dissertation.pdf"), b"%PDF three");
        assert_eq!(project.read("Thesis_One.pdf"), b"%PDF two");

        let next = project.built(b"%PDF four", "s3");
        project.sync(&next).unwrap();
        assert_eq!(project.read("Thesis_One.pdf"), b"%PDF two");
        assert_eq!(project.read("Dissertation.pdf"), b"%PDF four");
    }

    #[test]
    fn a_pdf_that_no_longer_matches_the_compile_is_never_copied() {
        let _env_guard = crate::paths::data_dir_env_lock();
        let project = Fixture::new("pdf-sync-identity", "Thesis", SYNC_ON);
        let compiled = project.built(b"%PDF done", "s1");
        std::fs::write(
            project
                .build
                .join(format!("{}.pdf", crate::paths::ENTRY_STEM)),
            b"%PDF half writ",
        )
        .unwrap();
        assert_eq!(project.sync(&compiled).unwrap(), None);
        assert!(!project.root.join("Thesis.pdf").exists());
    }

    #[test]
    fn a_compile_of_another_document_or_with_sync_off_writes_nothing() {
        let _env_guard = crate::paths::data_dir_env_lock();
        let project = Fixture::new("pdf-sync-other", "Thesis", SYNC_ON);
        let compiled = project.built(b"%PDF", "s1");
        assert_eq!(
            sync_compiled(project.id, "supplement.tex", &compiled).unwrap(),
            None
        );
        crate::project::update_pdf_sync(project.id, |sync| sync.enabled = false).unwrap();
        assert_eq!(project.sync(&compiled).unwrap(), None);
        assert!(!project.root.join("Thesis.pdf").exists());
    }

    #[test]
    fn a_file_someone_else_made_keeps_its_name_and_its_bytes() {
        let _env_guard = crate::paths::data_dir_env_lock();
        let project = Fixture::new("pdf-sync-foreign", "Thesis", SYNC_ON);
        std::fs::write(project.root.join("Thesis.pdf"), "from the journal").unwrap();
        let compiled = project.built(b"%PDF", "s1");
        assert_eq!(
            project.sync(&compiled).unwrap().as_deref(),
            Some("Thesis_2.pdf")
        );
        assert_eq!(project.read("Thesis.pdf"), b"from the journal");

        let next = project.built(b"%PDF again", "s2");
        assert_eq!(
            project.sync(&next).unwrap().as_deref(),
            Some("Thesis_2.pdf")
        );
    }

    #[test]
    fn turning_sync_on_uses_the_pdf_saved_from_the_preview_and_the_current_preview() {
        let _env_guard = crate::paths::data_dir_env_lock();
        let project = Fixture::new("pdf-sync-enable", "Thesis", "");
        std::fs::write(project.root.join("Thesis.pdf"), "saved earlier").unwrap();
        note_saved(project.id, "Thesis.pdf").unwrap();
        let shown = project.built(b"%PDF shown", "ignored");

        let outcome = set_enabled(project.id, true, Some(shown.output_id.clone())).unwrap();
        assert_eq!(outcome.unwrap().as_deref(), Some("Thesis.pdf"));
        assert_eq!(project.read("Thesis.pdf"), b"%PDF shown");
        let current = status(project.id).unwrap();
        assert!(current.enabled);
        assert_eq!(current.path.as_deref(), Some("Thesis.pdf"));

        assert_eq!(set_enabled(project.id, false, None).unwrap().unwrap(), None);
        assert!(!status(project.id).unwrap().enabled);
        assert_eq!(project.read("Thesis.pdf"), b"%PDF shown");
    }

    #[test]
    fn a_failed_write_is_reported_and_retried_by_the_next_compile() {
        let _env_guard = crate::paths::data_dir_env_lock();
        let project = Fixture::new("pdf-sync-retry", "Thesis", SYNC_ON);
        let first = project.built(b"%PDF one", "s1");
        project.sync(&first).unwrap();

        std::fs::remove_file(project.root.join("Thesis.pdf")).unwrap();
        std::fs::create_dir(project.root.join("Thesis.pdf")).unwrap();
        let second = project.built(b"%PDF two", "s2");
        assert!(project.sync(&second).is_err());
        assert_eq!(
            status(project.id).unwrap().failed.as_deref(),
            Some("Thesis.pdf")
        );

        std::fs::remove_dir(project.root.join("Thesis.pdf")).unwrap();
        assert_eq!(
            project.sync(&second).unwrap().as_deref(),
            Some("Thesis.pdf")
        );
        assert_eq!(status(project.id).unwrap().failed, None);
        assert_eq!(project.read("Thesis.pdf"), b"%PDF two");
    }

    #[test]
    fn device_notes_stay_out_of_the_project_files() {
        let _env_guard = crate::paths::data_dir_env_lock();
        let project = Fixture::new("pdf-sync-state", "Thesis", SYNC_ON);
        let compiled = project.built(b"%PDF", "s1");
        project.sync(&compiled).unwrap();
        assert!(project.root.join(".oleafly").join(STATE_FILE).is_file());
        assert!(!project.root.join(STATE_FILE).exists());
    }

    #[test]
    fn a_plan_needs_a_pdf_from_the_compile() {
        let plan = CompilePlan {
            sources: Some("s1".to_owned()),
        };
        assert_eq!(
            plan.clone().compiled(true, Some("pdf-v1:1:aa")),
            Some(compiled(Some("s1")))
        );
        assert_eq!(plan.clone().compiled(false, Some("pdf-v1:1:aa")), None);
        assert_eq!(plan.compiled(true, None), None);
    }
}
