//! Encrypted, portable backup and restore for a project's complete history.

use std::fs::{self, File, OpenOptions};
use std::io::{BufReader, BufWriter};
use std::path::{Path, PathBuf};

use oleafly_history::Store;

use crate::checkpoint_archive::{ArchiveDecryptReader, ArchiveEncryptWriter};
use crate::sandbox::AtomicFile;

const SPACE_RESERVE_BYTES: u64 = 16 * 1024 * 1024;
const ESTIMATED_METADATA_BYTES_PER_CHECKPOINT: u64 = 256 * 1024;

fn require_active_project(project_id: &str) -> Result<(), String> {
    crate::paths::project_dir(project_id).map(|_| ())
}

fn archive_source(source: &str) -> Result<(File, u64), String> {
    let source = source.trim();
    if source.is_empty() {
        return Err("archive source is empty".into());
    }
    let path = Path::new(source);
    if !path.is_absolute() {
        return Err("archive source must be an absolute path".into());
    }
    let metadata = fs::symlink_metadata(path)
        .map_err(|error| format!("could not inspect the Checkpoints archive: {error}"))?;
    if !metadata.is_file() || metadata.file_type().is_symlink() || is_reparse_point(&metadata) {
        return Err("the Checkpoints archive must be a regular file".into());
    }
    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt as _;

        options.custom_flags(libc::O_NOFOLLOW | libc::O_CLOEXEC);
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt as _;
        use windows_sys::Win32::Storage::FileSystem::FILE_FLAG_OPEN_REPARSE_POINT;

        options.custom_flags(FILE_FLAG_OPEN_REPARSE_POINT);
    }
    let file = options
        .open(path)
        .map_err(|error| format!("could not open the Checkpoints archive: {error}"))?;
    let opened_metadata = file
        .metadata()
        .map_err(|error| format!("could not inspect the open Checkpoints archive: {error}"))?;
    if !opened_metadata.is_file() || is_reparse_point(&opened_metadata) {
        return Err("the Checkpoints archive must be a regular file".into());
    }
    Ok((file, opened_metadata.len()))
}

#[cfg(windows)]
fn is_reparse_point(metadata: &fs::Metadata) -> bool {
    use std::os::windows::fs::MetadataExt as _;

    metadata.file_attributes() & 0x400 != 0
}

#[cfg(not(windows))]
fn is_reparse_point(_metadata: &fs::Metadata) -> bool {
    false
}

fn require_available_space(path: &Path, required: u64, operation: &str) -> Result<(), String> {
    let available = fs4::available_space(path)
        .map_err(|error| format!("could not measure free space for {operation}: {error}"))?;
    if available < required {
        return Err(format!(
            "Not enough free space to {operation}. Free at least {} and try again.",
            format_bytes(required - available)
        ));
    }
    Ok(())
}

fn format_bytes(bytes: u64) -> String {
    const MIB: u64 = 1024 * 1024;
    const GIB: u64 = 1024 * MIB;
    if bytes >= GIB {
        format!("{:.1} GB", bytes as f64 / GIB as f64)
    } else {
        format!("{} MB", bytes.saturating_add(MIB - 1) / MIB)
    }
}

fn validated_export_destination(store: &Store, destination: &str) -> Result<PathBuf, String> {
    let destination = Path::new(destination);
    if !destination.is_absolute() {
        return Err("archive destination must be an absolute path".into());
    }
    let parent = destination
        .parent()
        .filter(|path| !path.as_os_str().is_empty())
        .ok_or_else(|| "archive destination has no parent folder".to_string())?
        .canonicalize()
        .map_err(|error| format!("could not resolve the archive destination folder: {error}"))?;
    let name = destination
        .file_name()
        .ok_or_else(|| "archive destination has no file name".to_string())?;
    let resolved_destination = parent.join(name);
    let store_root = store
        .root()
        .canonicalize()
        .map_err(|error| format!("could not resolve the live Checkpoints store: {error}"))?;
    if resolved_destination.starts_with(&store_root) {
        return Err("The archive destination cannot be inside the live Checkpoints store.".into());
    }
    if let Ok(existing_destination) = destination.canonicalize() {
        if existing_destination.starts_with(&store_root) {
            return Err(
                "The archive destination cannot resolve inside the live Checkpoints store.".into(),
            );
        }
    }
    Ok(resolved_destination)
}

fn export_store_to_path(store: &Store, destination: &str, password: &str) -> Result<(), String> {
    let stats = store
        .stats()
        .map_err(|error| format!("could not measure Checkpoints before export: {error}"))?;
    if stats.checkpoint_count == 0 {
        return Err("This project does not have any Checkpoints to export.".into());
    }
    let destination = validated_export_destination(store, destination)?;
    let parent = destination
        .parent()
        .expect("validated archive destination has a parent");
    let mut transaction = AtomicFile::new(&destination)?;
    let estimated_bytes = stats
        .visible_logical_bytes
        .saturating_add(
            stats
                .checkpoint_count
                .saturating_mul(ESTIMATED_METADATA_BYTES_PER_CHECKPOINT),
        )
        .saturating_add(SPACE_RESERVE_BYTES);
    require_available_space(parent, estimated_bytes, "export Checkpoints")?;

    {
        let staged = transaction.staging_file_mut();
        let mut encrypted = ArchiveEncryptWriter::new(BufWriter::new(staged), password)?;
        store
            .export_history(&mut encrypted)
            .map_err(|error| format!("could not export Checkpoints: {error}"))?;
        let _buffered = encrypted.finish()?;
    }
    transaction
        .staging_file_mut()
        .sync_all()
        .map_err(|error| format!("could not save the Checkpoints archive: {error}"))?;
    transaction.commit()
}

fn import_archive_into_store(store: &Store, source: File, password: &str) -> Result<(), String> {
    let mut plaintext = ArchiveDecryptReader::new(BufReader::new(source), password)?;
    store
        .import_history_validated(&mut plaintext, |engine, main_document, project_json| {
            crate::checkpoints::validate_checkpoint_project_metadata(
                project_json,
                engine,
                main_document,
            )
        })
        .map_err(|error| format!("could not import Checkpoints: {error}"))?;
    Ok(())
}

fn export_checkpoint_archive_sync(
    project_id: &str,
    destination: &str,
    password: &str,
) -> Result<PathBuf, String> {
    let _worktree = crate::worktree_lock::ProjectWorktreeLock::shared(project_id)?;
    require_active_project(project_id)?;
    let store_path = crate::paths::existing_checkpoint_store_dir(project_id)?
        .ok_or_else(|| "This project does not have any Checkpoints to export.".to_string())?;
    let store = Store::open_existing(store_path)
        .map_err(|_| "Could not open this project's Checkpoints history.".to_string())?
        .ok_or_else(|| "This project does not have any Checkpoints to export.".to_string())?;
    export_store_to_path(&store, destination, password)?;
    Ok(PathBuf::from(destination))
}

fn import_checkpoint_archive_sync(
    project_id: &str,
    source_path: &str,
    password: &str,
) -> Result<(), String> {
    let _worktree = crate::worktree_lock::ProjectWorktreeLock::shared(project_id)?;
    require_active_project(project_id)?;
    let (source, source_bytes) = archive_source(source_path)?;
    let data_root = crate::paths::oleafly_root()?;
    require_available_space(
        &data_root,
        source_bytes
            .saturating_mul(2)
            .saturating_add(SPACE_RESERVE_BYTES),
        "import Checkpoints",
    )?;

    let store_path = match crate::paths::existing_checkpoint_store_dir(project_id)? {
        Some(path) => path,
        None => crate::paths::checkpoint_store_dir(project_id)?,
    };
    let store = Store::open(&store_path)
        .map_err(|error| format!("could not open Checkpoints storage: {error}"))?;
    // A failed first import deliberately leaves the empty initialized store in
    // place. Removing it here could delete a store concurrently opened by
    // another app process after this function observed it as absent.
    import_archive_into_store(&store, source, password)
}

#[tauri::command]
pub async fn checkpoint_export(
    project_id: String,
    dest: String,
    password: String,
    state: tauri::State<'_, crate::state::AppState>,
) -> Result<(), String> {
    require_active_project(&project_id)?;
    let operation = crate::checkpoints::checkpoint_operation_lock(&project_id)?;
    let _compile = state.compile_lock.lock().await;
    let _operation = operation.lock().await;
    let password = zeroize::Zeroizing::new(password);
    let exported = tauri::async_runtime::spawn_blocking(move || {
        export_checkpoint_archive_sync(&project_id, &dest, password.as_str())
    })
    .await
    .map_err(|error| format!("Checkpoints export task failed: {error}"))??;

    if let Ok(canonical) = exported.canonicalize() {
        let mut allow = state.reveal_allowlist.lock().await;
        if allow.len() >= 1024 {
            allow.pop_front();
        }
        allow.push_back(canonical);
    }
    Ok(())
}

#[tauri::command]
pub async fn checkpoint_import(
    project_id: String,
    source: String,
    password: String,
    state: tauri::State<'_, crate::state::AppState>,
) -> Result<(), String> {
    require_active_project(&project_id)?;
    crate::checkpoint_publication::cancel_project_publications(&project_id);
    let operation = crate::checkpoints::checkpoint_operation_lock(&project_id)?;
    let _compile = state.compile_lock.lock().await;
    let _operation = operation.lock().await;
    let password = zeroize::Zeroizing::new(password);
    tauri::async_runtime::spawn_blocking(move || {
        import_checkpoint_archive_sync(&project_id, &source, password.as_str())
    })
    .await
    .map_err(|error| format!("Checkpoints import task failed: {error}"))?
}

#[cfg(test)]
mod tests {
    use std::fs::{self, File};
    use std::path::Path;

    use oleafly_history::{CaptureInput, CompileEvidence, ContentHash, PublishOutcome, Store};
    use tempfile::tempdir;

    use super::{export_store_to_path, import_archive_into_store, import_checkpoint_archive_sync};

    fn populated_store_with_identity(
        root: &Path,
        project: &Path,
        project_engine: &str,
        evidence_engine: &str,
    ) -> Store {
        populated_store_with_metadata(
            root,
            project,
            serde_json::json!({
                "name": "Paper",
                "main_doc": "main.tex",
                "engine": project_engine,
            }),
            evidence_engine,
        )
    }

    fn populated_store_with_metadata(
        root: &Path,
        project: &Path,
        project_metadata: serde_json::Value,
        evidence_engine: &str,
    ) -> Store {
        fs::create_dir_all(project).unwrap();
        fs::write(
            project.join("project.json"),
            serde_json::to_vec(&project_metadata).unwrap(),
        )
        .unwrap();
        fs::write(project.join("main.tex"), b"Hello Checkpoints").unwrap();
        let store = Store::open(root).unwrap();
        let candidate = store
            .stage_candidate(
                project,
                &[
                    CaptureInput::explicit("project.json").unwrap(),
                    CaptureInput::explicit("main.tex").unwrap(),
                ],
            )
            .unwrap();
        let evidence = CompileEvidence::new(
            evidence_engine,
            format!("{evidence_engine}-test@1"),
            "main.tex",
            ContentHash::digest(b"compiled pdf"),
            1,
        )
        .unwrap();
        assert!(matches!(
            store.publish(candidate, evidence).unwrap(),
            PublishOutcome::Created(_)
        ));
        store
    }

    fn populated_store(root: &Path, project: &Path) -> Store {
        populated_store_with_identity(root, project, "xetex", "xetex")
    }

    #[test]
    fn encrypted_full_history_round_trips_without_plaintext_staging() {
        let directory = tempdir().unwrap();
        let source = populated_store(
            &directory.path().join("source-history"),
            &directory.path().join("project"),
        );
        let archive = directory.path().join("paper.oleafly-checkpoints");
        export_store_to_path(
            &source,
            archive.to_str().unwrap(),
            "correct horse battery staple",
        )
        .unwrap();

        let destination = Store::open(directory.path().join("destination-history")).unwrap();
        let encrypted = File::open(&archive).unwrap();
        import_archive_into_store(&destination, encrypted, "correct horse battery staple").unwrap();

        assert_eq!(destination.list().unwrap(), source.list().unwrap());
    }

    #[test]
    fn import_rejects_project_metadata_that_disagrees_with_compile_identity() {
        let directory = tempdir().unwrap();
        let source = populated_store_with_identity(
            &directory.path().join("source-history"),
            &directory.path().join("project"),
            "xetex",
            "tectonic",
        );
        let archive = directory.path().join("mismatched.oleafly-checkpoints");
        export_store_to_path(
            &source,
            archive.to_str().unwrap(),
            "correct horse battery staple",
        )
        .unwrap();

        let destination = Store::open(directory.path().join("destination-history")).unwrap();
        let error = import_archive_into_store(
            &destination,
            File::open(&archive).unwrap(),
            "correct horse battery staple",
        )
        .unwrap_err();

        assert!(error.contains("recorded engine"), "{error}");
        assert!(destination.list().unwrap().is_empty());
    }

    #[test]
    fn import_rejects_self_consistent_but_unusable_project_metadata() {
        for (name, project_metadata, evidence_engine) in [
            (
                "unsupported-engine",
                serde_json::json!({
                    "name": "Paper",
                    "main_doc": "main.tex",
                    "engine": "unsupported",
                }),
                "unsupported",
            ),
            (
                "invalid-tex-flavor",
                serde_json::json!({
                    "name": "Paper",
                    "main_doc": "main.tex",
                    "engine": "latexmk",
                    "tex_flavor": "pdftex",
                }),
                "latexmk",
            ),
        ] {
            let directory = tempdir().unwrap();
            let source = populated_store_with_metadata(
                &directory.path().join("source-history"),
                &directory.path().join("project"),
                project_metadata,
                evidence_engine,
            );
            let archive = directory.path().join(format!("{name}.oleafly-checkpoints"));
            export_store_to_path(
                &source,
                archive.to_str().unwrap(),
                "correct horse battery staple",
            )
            .unwrap();
            let destination = Store::open(directory.path().join("destination-history")).unwrap();

            let error = import_archive_into_store(
                &destination,
                File::open(&archive).unwrap(),
                "correct horse battery staple",
            )
            .unwrap_err();

            assert!(
                error.contains("unusable project metadata"),
                "{name}: {error}"
            );
            assert!(destination.list().unwrap().is_empty(), "{name}");
        }
    }

    fn assert_golden_archive_imports(name: &str, bytes: &[u8], password: &str) {
        let directory = tempdir().unwrap();
        let archive = directory.path().join(name);
        fs::write(&archive, bytes).unwrap();
        let destination = Store::open(directory.path().join("destination-history")).unwrap();

        import_archive_into_store(&destination, File::open(archive).unwrap(), password).unwrap();

        let checkpoints = destination.list().unwrap();
        assert_eq!(checkpoints.len(), 1, "{name}");
        assert_eq!(checkpoints[0].engine, "xetex", "{name}");
        assert_eq!(checkpoints[0].main_document, "main.tex", "{name}");
    }

    #[test]
    fn encrypted_v1_golden_archive_remains_importable() {
        assert_golden_archive_imports(
            "checkpoint-v1.oleafly-checkpoints",
            include_bytes!("fixtures/checkpoint_archive_v1.oleafly-checkpoints"),
            "checkpoint-fixture-v1",
        );
    }

    #[test]
    fn encrypted_v2_golden_archive_remains_importable() {
        assert_golden_archive_imports(
            "checkpoint-v2.oleafly-checkpoints",
            include_bytes!("fixtures/checkpoint_archive_v2.oleafly-checkpoints"),
            "checkpoint-fixture-v2",
        );
    }

    #[test]
    fn new_archives_are_written_as_argon2id_envelope_version_two() {
        let directory = tempdir().unwrap();
        let source = populated_store(
            &directory.path().join("source-history"),
            &directory.path().join("project"),
        );
        let archive = directory.path().join("written.oleafly-checkpoints");
        export_store_to_path(
            &source,
            archive.to_str().unwrap(),
            "correct horse battery staple",
        )
        .unwrap();

        let header = fs::read(&archive).unwrap();
        assert_eq!(&header[..16], b"OLEAFLYCPARCHIVE");
        assert_eq!(u16::from_le_bytes([header[16], header[17]]), 2);
        assert_eq!(header[18], 2);
        assert_eq!(header[19], 1);
        assert_eq!(
            u32::from_le_bytes(header[20..24].try_into().unwrap()),
            65_536
        );
        assert_eq!(u32::from_le_bytes(header[24..28].try_into().unwrap()), 3);
        assert_eq!(u32::from_le_bytes(header[28..32].try_into().unwrap()), 1);
    }

    #[test]
    fn failed_export_preserves_an_existing_destination() {
        let directory = tempdir().unwrap();
        let source = populated_store(
            &directory.path().join("source-history"),
            &directory.path().join("project"),
        );
        let archive = directory.path().join("paper.oleafly-checkpoints");
        fs::write(&archive, b"existing archive").unwrap();

        assert!(export_store_to_path(&source, archive.to_str().unwrap(), "short").is_err());
        assert_eq!(fs::read(archive).unwrap(), b"existing archive");
    }

    #[test]
    fn export_rejects_every_destination_inside_the_live_store() {
        let directory = tempdir().unwrap();
        let source = populated_store(
            &directory.path().join("source-history"),
            &directory.path().join("project"),
        );
        let catalog = source.root().join("catalog.sqlite3");
        let before = fs::read(&catalog).unwrap();

        let error = export_store_to_path(
            &source,
            catalog.to_str().unwrap(),
            "correct horse battery staple",
        )
        .unwrap_err();

        assert!(error.contains("live Checkpoints store"), "{error}");
        assert_eq!(fs::read(catalog).unwrap(), before);
        assert_eq!(source.list().unwrap().len(), 1);
    }

    #[test]
    fn failed_first_import_leaves_an_empty_store_instead_of_deleting_a_shared_path() {
        let _env_guard = crate::paths::data_dir_env_lock();
        let directory = tempdir().unwrap();
        std::env::set_var("OLEAFLY_DATA_DIR", directory.path());
        crate::paths::create_project_dir("paper").unwrap();
        let archive = directory.path().join("invalid.oleafly-checkpoints");
        fs::write(&archive, b"not an encrypted archive").unwrap();

        assert!(import_checkpoint_archive_sync(
            "paper",
            archive.to_str().unwrap(),
            "correct horse battery staple",
        )
        .is_err());
        let store_path = crate::paths::existing_checkpoint_store_dir("paper")
            .unwrap()
            .expect("failed import leaves the initialized store");
        let store = Store::open_existing(store_path).unwrap().unwrap();
        assert!(store.list().unwrap().is_empty());

        std::env::remove_var("OLEAFLY_DATA_DIR");
    }
}
