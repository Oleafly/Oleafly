//! External Checkpoints lifecycle and transactional worktree restore.

use std::collections::{BTreeSet, HashMap, HashSet};
#[cfg(unix)]
use std::fs::File;
use std::fs::{self, OpenOptions};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Condvar, Mutex, OnceLock, Weak};

use oleafly_history::{
    Checkpoint, HistoryError, ManifestLayout, SnapshotRoot, Store, StoreInspection, StoreStats,
    DETACHED_MANIFEST_PATH,
};
use serde::{Deserialize, Serialize};

use crate::app_error::AppError;
use crate::project_location::{ProjectKind, ProjectLocation};
use crate::worktree_lock::RESTORE_PENDING_FILE;

const RESTORE_TRANSACTION: &str = "restore-transaction";
const INCOMING_DIRECTORY: &str = "incoming";
const BACKUP_DIRECTORY: &str = "backup";
const RESTORE_PLAN_FILE: &str = "restore-plan.json";
const RESTORE_TERMINAL_FILE: &str = "restore-terminal";
const RESTORE_TERMINAL_BYTES: &[u8] = b"oleafly-checkpoint-restore-terminal-v1\n";
const PHASE_PREPARED: &str = "phase-prepared";
const PHASE_BACKING_UP: &str = "phase-backing-up";
const PHASE_INSTALLING: &str = "phase-installing";
const PHASE_ROLLING_BACK: &str = "phase-rolling-back";
const PHASE_RESTORING_BACKUP: &str = "phase-restoring-backup";
const PHASE_INSTALLED: &str = "phase-installed";
const MANIFEST_BACKUP_FILE: &str = "backup-manifest";

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct CheckpointSummary {
    pub snapshot_root: String,
    pub completed_at_unix_ms: i64,
    pub engine: String,
    pub toolchain_identity: String,
    pub main_document: String,
    pub output_hash: String,
    pub file_count: u64,
    pub logical_bytes: u64,
    pub label: Option<String>,
}

impl From<Checkpoint> for CheckpointSummary {
    fn from(checkpoint: Checkpoint) -> Self {
        Self {
            snapshot_root: checkpoint.snapshot_root.to_string(),
            completed_at_unix_ms: checkpoint.completed_at_unix_ms,
            engine: checkpoint.engine,
            toolchain_identity: checkpoint.toolchain_identity,
            main_document: checkpoint.main_document,
            output_hash: checkpoint.output_hash.to_string(),
            file_count: checkpoint.file_count,
            logical_bytes: checkpoint.logical_bytes,
            label: checkpoint.label,
        }
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
pub struct CheckpointStats {
    pub checkpoint_count: u64,
    pub stored_pack_bytes: u64,
    pub logical_bytes: u64,
    pub reclaimable_bytes: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub capture: Option<crate::checkpoint_capture::CaptureNotice>,
}

impl From<StoreStats> for CheckpointStats {
    fn from(stats: StoreStats) -> Self {
        Self {
            checkpoint_count: stats.checkpoint_count,
            stored_pack_bytes: stats.stored_pack_bytes,
            logical_bytes: stats.visible_logical_bytes,
            reclaimable_bytes: stats.reclaimable_pack_bytes,
            capture: None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct CheckpointFileSummary {
    pub path: String,
    pub bytes: u64,
    pub content_hash: String,
    pub stored: bool,
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub folder_settings: bool,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
pub struct CheckpointStoreTableCounts {
    pub checkpoints: u64,
    pub manifests: u64,
    pub packs: u64,
    pub chunks: u64,
    pub manifest_chunks: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct CheckpointPackSummary {
    pub file_name: String,
    pub bytes: u64,
    pub chunk_count: u64,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
pub struct CheckpointStoreInspection {
    pub store_path: Option<String>,
    pub catalog_path: Option<String>,
    pub catalog_bytes: u64,
    pub format_version: u32,
    pub lineage: Option<String>,
    pub table_counts: CheckpointStoreTableCounts,
    pub packs: Vec<CheckpointPackSummary>,
}

impl From<StoreInspection> for CheckpointStoreInspection {
    fn from(inspection: StoreInspection) -> Self {
        Self {
            store_path: Some(inspection.root.to_string_lossy().into_owned()),
            catalog_path: Some(inspection.catalog_path.to_string_lossy().into_owned()),
            catalog_bytes: inspection.catalog_bytes,
            format_version: inspection.format_version,
            lineage: Some(inspection.lineage),
            table_counts: CheckpointStoreTableCounts {
                checkpoints: inspection.checkpoint_count,
                manifests: inspection.manifest_count,
                packs: inspection.pack_count,
                chunks: inspection.chunk_count,
                manifest_chunks: inspection.manifest_chunk_count,
            },
            packs: inspection
                .packs
                .into_iter()
                .map(|pack| CheckpointPackSummary {
                    file_name: pack.file_name,
                    bytes: pack.encoded_bytes,
                    chunk_count: pack.chunk_count,
                })
                .collect(),
        }
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
pub struct CheckpointIntegrity {
    pub checked_checkpoints: u64,
    pub checked_files: u64,
    pub checked_chunk_references: u64,
    pub checked_packs: u64,
}

struct RestoreCoordination {
    active: Mutex<HashSet<String>>,
    changed: Condvar,
}

fn restore_coordination() -> &'static RestoreCoordination {
    static COORDINATION: OnceLock<RestoreCoordination> = OnceLock::new();
    COORDINATION.get_or_init(|| RestoreCoordination {
        active: Mutex::new(HashSet::new()),
        changed: Condvar::new(),
    })
}

/// Returns the shared per-project operation lock used by publication,
/// retention, garbage collection, and archive import. Callers that also need
/// `compile_lock` must acquire `compile_lock` first.
pub(crate) fn checkpoint_operation_lock(
    project_id: &str,
) -> Result<Arc<tokio::sync::Mutex<()>>, String> {
    crate::paths::validate_project_id(project_id)?;
    static OPERATIONS: OnceLock<Mutex<HashMap<String, Weak<tokio::sync::Mutex<()>>>>> =
        OnceLock::new();
    let mut operations = OPERATIONS
        .get_or_init(|| Mutex::new(HashMap::new()))
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    operations.retain(|_, operation| operation.strong_count() > 0);
    if let Some(operation) = operations.get(project_id).and_then(Weak::upgrade) {
        return Ok(operation);
    }
    let operation = Arc::new(tokio::sync::Mutex::new(()));
    operations.insert(project_id.to_string(), Arc::downgrade(&operation));
    Ok(operation)
}

struct ActiveRestore {
    project_id: String,
}

impl ActiveRestore {
    fn acquire(project_id: &str) -> Self {
        let coordination = restore_coordination();
        let mut active = coordination
            .active
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        while active.contains(project_id) {
            active = coordination
                .changed
                .wait(active)
                .unwrap_or_else(std::sync::PoisonError::into_inner);
        }
        active.insert(project_id.to_string());
        Self {
            project_id: project_id.to_string(),
        }
    }
}

impl Drop for ActiveRestore {
    fn drop(&mut self) {
        let coordination = restore_coordination();
        coordination
            .active
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .remove(&self.project_id);
        coordination.changed.notify_all();
    }
}

fn open_existing_store(project_id: &str) -> Result<Option<Store>, String> {
    let Some(path) = crate::paths::existing_checkpoint_store_dir(project_id)? else {
        return Ok(None);
    };
    Store::open_existing(path)
        .map_err(|_| "Could not open this project's Checkpoints history.".to_string())
}

fn require_existing_store(project_id: &str) -> Result<Store, String> {
    open_existing_store(project_id)?
        .ok_or_else(|| "This project does not have any Checkpoints yet.".to_string())
}

fn require_active_project(project_id: &str) -> Result<(), String> {
    crate::paths::project_dir(project_id).map(|_| ())
}

fn checkpoint_list_sync(project_id: &str) -> Result<Vec<CheckpointSummary>, String> {
    let _worktree = crate::worktree_lock::ProjectWorktreeLock::shared(project_id)?;
    require_active_project(project_id)?;
    let Some(store) = open_existing_store(project_id)? else {
        return Ok(Vec::new());
    };
    store
        .list()
        .map(|checkpoints| checkpoints.into_iter().map(Into::into).collect())
        .map_err(|_| "Could not read this project's Checkpoints history.".to_string())
}

fn checkpoint_set_label_sync(
    project_id: &str,
    snapshot_root: &str,
    label: &str,
) -> Result<CheckpointSummary, String> {
    let _worktree = crate::worktree_lock::ProjectWorktreeLock::shared(project_id)?;
    require_active_project(project_id)?;
    let root = parse_snapshot_root(snapshot_root)?;
    let store = require_existing_store(project_id)?;
    store
        .set_checkpoint_label(&root, label)
        .map(Into::into)
        .map_err(|error| match error {
            HistoryError::InvalidInput(_) => {
                "A Checkpoint label can be up to 80 characters on one line.".to_string()
            }
            HistoryError::CheckpointNotFound(_) => {
                "The selected Checkpoint no longer exists.".to_string()
            }
            _ => "Could not save the Checkpoint label.".to_string(),
        })
}

fn checkpoint_stats_sync(project_id: &str) -> Result<CheckpointStats, String> {
    let _worktree = crate::worktree_lock::ProjectWorktreeLock::shared(project_id)?;
    require_active_project(project_id)?;
    let capture = crate::checkpoint_capture::read_capture_notice(project_id);
    let Some(store) = open_existing_store(project_id)? else {
        return Ok(CheckpointStats {
            capture,
            ..CheckpointStats::default()
        });
    };
    store
        .stats()
        .map(|stats| CheckpointStats {
            capture,
            ..CheckpointStats::from(stats)
        })
        .map_err(|_| "Could not measure this project's Checkpoints history.".to_string())
}

fn checkpoint_files_sync(
    project_id: &str,
    snapshot_root: &str,
) -> Result<Vec<CheckpointFileSummary>, String> {
    let _worktree = crate::worktree_lock::ProjectWorktreeLock::shared(project_id)?;
    require_active_project(project_id)?;
    let root = parse_snapshot_root(snapshot_root)?;
    let store = require_existing_store(project_id)?;
    let files = store
        .checkpoint_files(&root)
        .map_err(|_| "Could not read the selected Checkpoint's files.".to_string())?
        .ok_or_else(|| "The selected Checkpoint no longer exists.".to_string())?;
    let detached = crate::project_location::kind_of(project_id)? == ProjectKind::Linked
        && store
            .checkpoint_layout(&root)
            .map_err(|_| "Could not read the selected Checkpoint's files.".to_string())?
            == Some(ManifestLayout::Detached);
    Ok(files
        .into_iter()
        .map(|file| CheckpointFileSummary {
            folder_settings: detached && file.relative_path == DETACHED_MANIFEST_PATH,
            path: file.relative_path,
            bytes: file.logical_bytes,
            content_hash: file.content_hash.to_string(),
            stored: file.stored,
        })
        .collect())
}

fn checkpoint_inspect_sync(project_id: &str) -> Result<CheckpointStoreInspection, String> {
    let _worktree = crate::worktree_lock::ProjectWorktreeLock::shared(project_id)?;
    require_active_project(project_id)?;
    let Some(store) = open_existing_store(project_id)? else {
        return Ok(CheckpointStoreInspection::default());
    };
    store
        .inspect()
        .map(Into::into)
        .map_err(|_| "Could not inspect this project's Checkpoints storage.".to_string())
}

#[tauri::command]
pub async fn checkpoint_files(
    project_id: String,
    snapshot_root: String,
) -> Result<Vec<CheckpointFileSummary>, String> {
    tauri::async_runtime::spawn_blocking(move || checkpoint_files_sync(&project_id, &snapshot_root))
        .await
        .map_err(|error| format!("Checkpoint files task failed: {error}"))?
}

#[tauri::command]
pub async fn checkpoint_inspect(project_id: String) -> Result<CheckpointStoreInspection, String> {
    tauri::async_runtime::spawn_blocking(move || checkpoint_inspect_sync(&project_id))
        .await
        .map_err(|error| format!("Checkpoints storage inspection task failed: {error}"))?
}

fn parse_snapshot_root(value: &str) -> Result<SnapshotRoot, String> {
    SnapshotRoot::parse(value).map_err(|_| "The selected Checkpoint id is invalid.".to_string())
}

fn checkpoint_delete_sync(project_id: &str, snapshot_root: &str) -> Result<(), String> {
    let _worktree = crate::worktree_lock::ProjectWorktreeLock::shared(project_id)?;
    require_active_project(project_id)?;
    let store = require_existing_store(project_id)?;
    let root = parse_snapshot_root(snapshot_root)?;
    let deleted = store
        .delete_checkpoint(&root)
        .map_err(|_| "Could not delete the selected Checkpoint.".to_string())?;
    if !deleted {
        return Err("The selected Checkpoint no longer exists.".into());
    }
    // The visible root is already gone. Reclamation is best-effort and can be
    // retried later without misreporting the deletion as failed.
    let _ = store.garbage_collect();
    Ok(())
}

fn checkpoint_keep_latest_sync(project_id: &str) -> Result<(), String> {
    let _worktree = crate::worktree_lock::ProjectWorktreeLock::shared(project_id)?;
    require_active_project(project_id)?;
    let Some(store) = open_existing_store(project_id)? else {
        return Ok(());
    };
    store
        .keep_latest()
        .map_err(|_| "Could not keep only the latest Checkpoint.".to_string())?;
    let _ = store.garbage_collect();
    Ok(())
}

fn checkpoint_reset_sync(project_id: &str) -> Result<(), String> {
    let _worktree = crate::worktree_lock::ProjectWorktreeLock::shared(project_id)?;
    require_active_project(project_id)?;
    remove_project_checkpoint_data(project_id)
}

/// Removes the exact external store for one validated project identity.
/// Store::destroy serializes the directory lifecycle across app processes.
pub(crate) fn remove_project_checkpoint_data(project_id: &str) -> Result<(), String> {
    crate::paths::validate_project_id(project_id)?;
    crate::checkpoint_publication::cancel_project_publications_and_wait(project_id);
    let _activity = ActiveRestore::acquire(project_id);
    // Resolve the exact validated namespace path even when the visible store

    // has already been detached. Store::destroy also reaps its durable
    // `.deleting.*` record, so retry must not stop at a missing original root.
    let store = crate::paths::checkpoint_store_dir(project_id)?;
    Store::destroy(&store)
        .map_err(|error| format!("could not remove project Checkpoints data: {error}"))?;
    Ok(())
}

#[tauri::command]
pub async fn checkpoint_list(project_id: String) -> Result<Vec<CheckpointSummary>, String> {
    tauri::async_runtime::spawn_blocking(move || checkpoint_list_sync(&project_id))
        .await
        .map_err(|error| format!("Checkpoints listing task failed: {error}"))?
}

#[tauri::command]
pub async fn checkpoint_set_label(
    project_id: String,
    snapshot_root: String,
    label: String,
) -> Result<CheckpointSummary, String> {
    require_active_project(&project_id)?;
    let operation = checkpoint_operation_lock(&project_id)?;
    let _operation = operation.lock().await;
    tauri::async_runtime::spawn_blocking(move || {
        checkpoint_set_label_sync(&project_id, &snapshot_root, &label)
    })
    .await
    .map_err(|error| format!("Checkpoint label task failed: {error}"))?
}

#[tauri::command]
pub async fn checkpoint_stats(project_id: String) -> Result<CheckpointStats, String> {
    tauri::async_runtime::spawn_blocking(move || checkpoint_stats_sync(&project_id))
        .await
        .map_err(|error| format!("Checkpoints storage task failed: {error}"))?
}

#[tauri::command]
pub async fn checkpoint_delete(
    project_id: String,
    snapshot_root: String,
    state: tauri::State<'_, crate::state::AppState>,
) -> Result<(), String> {
    require_active_project(&project_id)?;
    crate::checkpoint_publication::cancel_project_publications(&project_id);
    let operation = checkpoint_operation_lock(&project_id)?;
    let _compile = state.compile_lock.lock().await;
    let _operation = operation.lock().await;
    tauri::async_runtime::spawn_blocking(move || {
        checkpoint_delete_sync(&project_id, &snapshot_root)
    })
    .await
    .map_err(|error| format!("Checkpoint deletion task failed: {error}"))?
}

#[tauri::command]
pub async fn checkpoint_keep_latest(
    project_id: String,
    state: tauri::State<'_, crate::state::AppState>,
) -> Result<(), String> {
    require_active_project(&project_id)?;
    crate::checkpoint_publication::cancel_project_publications(&project_id);
    let operation = checkpoint_operation_lock(&project_id)?;
    let _compile = state.compile_lock.lock().await;
    let _operation = operation.lock().await;
    tauri::async_runtime::spawn_blocking(move || checkpoint_keep_latest_sync(&project_id))
        .await
        .map_err(|error| format!("Checkpoint cleanup task failed: {error}"))?
}

#[tauri::command]
pub async fn checkpoint_reset(
    project_id: String,
    state: tauri::State<'_, crate::state::AppState>,
) -> Result<(), String> {
    require_active_project(&project_id)?;
    crate::checkpoint_publication::cancel_project_publications(&project_id);
    let operation = checkpoint_operation_lock(&project_id)?;
    let _compile = state.compile_lock.lock().await;
    let _operation = operation.lock().await;
    tauri::async_runtime::spawn_blocking(move || checkpoint_reset_sync(&project_id))
        .await
        .map_err(|error| format!("Checkpoint reset task failed: {error}"))?
}

fn existing_store_to_reveal(project_id: &str) -> Result<PathBuf, String> {
    require_active_project(project_id)?;
    let store = crate::paths::existing_checkpoint_store_dir(project_id)?
        .ok_or_else(|| "This project does not have any Checkpoints yet.".to_string())?;
    store
        .canonicalize()
        .map_err(|error| format!("Could not resolve this project's Checkpoints store: {error}"))
}

#[tauri::command]
pub async fn checkpoint_reveal_store(
    project_id: String,
    state: tauri::State<'_, crate::state::AppState>,
) -> Result<(), String> {
    let store = tauri::async_runtime::spawn_blocking(move || existing_store_to_reveal(&project_id))
        .await
        .map_err(|error| format!("Checkpoints store task failed: {error}"))??;
    {
        let mut allow = state.reveal_allowlist.lock().await;
        if allow.len() >= 1024 {
            allow.pop_front();
        }
        allow.push_back(store.clone());
    }
    crate::commands::reveal_canonical_path(&store)
}

#[tauri::command]
pub async fn checkpoint_verify(
    project_id: String,
    state: tauri::State<'_, crate::state::AppState>,
) -> Result<CheckpointIntegrity, String> {
    require_active_project(&project_id)?;
    let operation = checkpoint_operation_lock(&project_id)?;
    let _compile = state.compile_lock.lock().await;
    let _operation = operation.lock().await;
    tauri::async_runtime::spawn_blocking(move || {
        let _worktree = crate::worktree_lock::ProjectWorktreeLock::shared(&project_id)?;
        require_active_project(&project_id)?;
        let store = require_existing_store(&project_id)?;
        let verification = store
            .verify()
            .map_err(|_| "Checkpoint integrity verification failed.".to_string())?;
        Ok(CheckpointIntegrity {
            checked_checkpoints: verification.checked_checkpoints,
            checked_files: verification.checked_files,
            checked_chunk_references: verification.checked_chunk_references,
            checked_packs: verification.checked_packs,
        })
    })
    .await
    .map_err(|error| format!("Checkpoint verification task failed: {error}"))?
}

#[tauri::command]
pub async fn checkpoint_restore(
    project_id: String,
    snapshot_root: String,
    expected_generation: u64,
    app: tauri::AppHandle,
    state: tauri::State<'_, crate::state::AppState>,
) -> Result<crate::project::ProjectStateChanged, String> {
    let root = parse_snapshot_root(&snapshot_root)?;
    let restore_project_id = project_id.clone();
    let mutation = crate::project::mutate_project_worktree_recovering(
        &state,
        project_id.clone(),
        Some(expected_generation),
        move |project_root| {
            let _active = ActiveRestore::acquire(&restore_project_id);
            // The mutation admission owns the exclusive cross-process
            // worktree lock here. Resolve the external store only after that
            // identity is pinned so deletion and project-id reuse cannot swap
            // the store between validation and restore.
            let store = require_existing_store(&restore_project_id)?;
            let location = crate::project_location::locate(&restore_project_id)?;
            match location.kind {
                ProjectKind::Library => restore_checkpoint_into(
                    &store,
                    &root,
                    project_root,
                    &location.private_state_dir(),
                    RestoreFault::None,
                )?,
                ProjectKind::Linked => {
                    restore_linked_checkpoint_into(&store, &root, &location, RestoreFault::None)?
                }
            }
            Ok(((), true))
        },
    )
    .await?;
    mutation.value?;
    crate::project::publish_project_state_changed(
        &app,
        &state,
        &project_id,
        mutation.project,
        "checkpoint-restore",
        true,
        Some(mutation.generation),
    )
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum RestoreFault {
    None,
    #[cfg(test)]
    CrashAfterTransactionCreation,
    #[cfg(test)]
    CrashDuringMaterialization,
    #[cfg(test)]
    CrashDuringPlanWrite,
    #[cfg(test)]
    CrashAfterSuccessfulTransactionCleanup,
    #[cfg(test)]
    CrashAfterRollbackTransactionCleanup,
    #[cfg(test)]
    CrashAfterPendingMarkerCleanup,
    #[cfg(test)]
    DuringNestedBackupDirectorySync,
    #[cfg(test)]
    AfterFirstBackup,
    #[cfg(test)]
    AfterFirstInstall,
    #[cfg(test)]
    CrashDuringInstall,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum RestoreTerminalOutcome {
    Installed,
    RolledBack,
}

#[cfg(test)]
impl RestoreFault {
    fn leaves_pre_marker_crash_state(self) -> bool {
        matches!(
            self,
            Self::CrashAfterTransactionCreation
                | Self::CrashDuringMaterialization
                | Self::CrashDuringPlanWrite
        )
    }

    fn fails_after_first_install(self) -> bool {
        matches!(
            self,
            Self::AfterFirstInstall | Self::CrashAfterRollbackTransactionCleanup
        )
    }

    fn crashes_during_successful_terminal_cleanup(self) -> bool {
        matches!(
            self,
            Self::CrashAfterSuccessfulTransactionCleanup | Self::CrashAfterPendingMarkerCleanup
        )
    }

    fn crashes_after_transaction_cleanup(self, outcome: RestoreTerminalOutcome) -> bool {
        matches!(
            (self, outcome),
            (
                Self::CrashAfterSuccessfulTransactionCleanup,
                RestoreTerminalOutcome::Installed
            ) | (
                Self::CrashAfterRollbackTransactionCleanup,
                RestoreTerminalOutcome::RolledBack
            )
        )
    }
}

#[cfg(test)]
fn restore_checkpoint_sync(
    store: &Store,
    snapshot_root: &SnapshotRoot,
    project_root: &Path,
    fault: RestoreFault,
) -> Result<(), String> {
    restore_checkpoint_into(
        store,
        snapshot_root,
        project_root,
        &project_root.join(crate::project_location::LIBRARY_STATE_DIR),
        fault,
    )
}

fn restore_checkpoint_into(
    store: &Store,
    snapshot_root: &SnapshotRoot,
    project_root: &Path,
    marker_dir: &Path,
    fault: RestoreFault,
) -> Result<(), String> {
    let locked_store = store
        .lock_exclusive()
        .map_err(|_| "Could not lock this project's Checkpoints history.".to_string())?;
    let checkpoint = locked_store
        .checkpoint(snapshot_root)
        .map_err(|_| "The selected Checkpoint could not be read.".to_string())?
        .ok_or_else(|| "The selected Checkpoint no longer exists.".to_string())?;
    let transaction = locked_store.root().join(RESTORE_TRANSACTION);
    recover_or_discard_restore_transaction(project_root, marker_dir, &transaction)?;
    create_private_directory(&transaction)?;
    let incoming = transaction.join(INCOMING_DIRECTORY);
    let backup = transaction.join(BACKUP_DIRECTORY);

    let prepared = (|| -> Result<(), String> {
        #[cfg(test)]
        if fault == RestoreFault::CrashAfterTransactionCreation {
            return Err("injected restore crash after transaction creation".into());
        }
        #[cfg(test)]
        if fault == RestoreFault::CrashDuringMaterialization {
            create_private_directory(&incoming)?;
            write_injected_partial_file(&incoming.join("partial-materialization"), b"partial")?;
            return Err("injected restore crash during materialization".into());
        }
        let materialized = locked_store
            .materialize(snapshot_root, &incoming)
            .map_err(|_| "The selected Checkpoint could not be verified.".to_string())?;
        if materialized.layout != ManifestLayout::InProject {
            return Err(AppError::new("checkpoint.folder_history_for_library").into());
        }
        validate_materialized_checkpoint_identity(&incoming, &checkpoint)?;
        create_private_directory(&backup)?;
        let plan = prepare_restore_plan(&incoming, project_root)?;
        #[cfg(test)]
        if fault == RestoreFault::CrashDuringPlanWrite {
            write_injected_partial_file(
                &transaction.join(RESTORE_PLAN_FILE),
                br#"{"files":["project.json""#,
            )?;
            return Err("injected restore crash during plan write".into());
        }
        write_restore_plan(&transaction, &plan)?;
        mark_phase(&transaction, PHASE_PREPARED)?;
        write_restore_pending_marker(marker_dir)?;

        mark_phase(&transaction, PHASE_BACKING_UP)?;
        backup_restore_paths(project_root, &backup, &plan, fault)?;
        mark_phase(&transaction, PHASE_INSTALLING)?;
        install_restore_paths(&incoming, project_root, &plan, fault)?;
        mark_phase(&transaction, PHASE_INSTALLED)?;
        Ok(())
    })();

    #[cfg(test)]
    if fault.leaves_pre_marker_crash_state() {
        return prepared.and_then(|_| Err("injected restore crash did not trigger".into()));
    }

    conclude_restore(prepared, marker_dir, &transaction, fault, || {
        recover_restore_transaction(project_root, marker_dir, &transaction, fault)
    })
}

fn conclude_restore(
    prepared: Result<(), String>,
    marker_dir: &Path,
    transaction: &Path,
    fault: RestoreFault,
    recover: impl FnOnce() -> Result<(), String>,
) -> Result<(), String> {
    match prepared {
        Ok(()) => {
            let cleanup = complete_terminal_restore_cleanup(
                marker_dir,
                transaction,
                RestoreTerminalOutcome::Installed,
                fault,
            );
            #[cfg(test)]
            if fault.crashes_during_successful_terminal_cleanup() {
                return cleanup;
            }
            let _ = cleanup;
            Ok(())
        }
        Err(operation_error) => match restore_pending_marker_exists(marker_dir) {
            Ok(false) => {
                let _ = discard_unstarted_restore_transaction(transaction);
                Err(operation_error)
            }
            Ok(true) => match recover() {
                Ok(()) => Err(operation_error),
                Err(rollback_error) => Err(format!(
                    "{operation_error} Recovery is still pending: {rollback_error}"
                )),
            },
            Err(marker_error) => Err(format!(
                "{operation_error} Recovery is still pending: {marker_error}"
            )),
        },
    }
}

fn validate_materialized_checkpoint_identity(
    incoming: &Path,
    checkpoint: &Checkpoint,
) -> Result<(), String> {
    let manifest = incoming.join("project.json");
    let bytes = fs::read(&manifest)
        .map_err(|_| "The selected Checkpoint contains unreadable project metadata.".to_string())?;
    validate_checkpoint_project_metadata(&bytes, &checkpoint.engine, &checkpoint.main_document)
}

pub(crate) fn validate_checkpoint_project_metadata(
    bytes: &[u8],
    recorded_engine: &str,
    recorded_main_document: &str,
) -> Result<(), String> {
    let project = crate::project::parse_project_meta(bytes)
        .map_err(|error| format!("The Checkpoint contains invalid project metadata: {error}"))?;
    if project.main_doc != recorded_main_document {
        return Err("The Checkpoint metadata does not match its recorded main document.".into());
    }
    let engine = crate::document_engine::engine_for(&project.engine, &project.main_doc)
        .map_err(|error| format!("The Checkpoint has an unusable document engine: {error}"))?;
    if project.engine != recorded_engine && engine.id().as_str() != recorded_engine {
        return Err("The Checkpoint metadata does not match its recorded engine.".into());
    }
    Ok(())
}

#[cfg(test)]
mod metadata_identity_tests {
    use super::validate_checkpoint_project_metadata;

    #[test]
    fn recorded_engine_ids_match_the_project_engine_name_they_were_compiled_from() {
        let tectonic = br#"{"name":"Paper","main_doc":"main.tex","engine":"tectonic"}"#;
        assert!(validate_checkpoint_project_metadata(tectonic, "latex", "main.tex").is_ok());
        assert!(validate_checkpoint_project_metadata(tectonic, "tectonic", "main.tex").is_ok());
        assert!(validate_checkpoint_project_metadata(tectonic, "typst", "main.tex").is_err());
        assert!(validate_checkpoint_project_metadata(tectonic, "latex", "other.tex").is_err());
        let typst = br#"{"name":"Paper","main_doc":"main.typ","engine":"typst"}"#;
        assert!(validate_checkpoint_project_metadata(typst, "typst", "main.typ").is_ok());
        assert!(validate_checkpoint_project_metadata(typst, "latex", "main.typ").is_err());
    }
}

fn restore_pending_marker(marker_dir: &Path) -> PathBuf {
    marker_dir.join(RESTORE_PENDING_FILE)
}

fn write_restore_pending_marker(marker_dir: &Path) -> Result<(), String> {
    let internal = marker_dir.to_path_buf();
    match fs::symlink_metadata(&internal) {
        Ok(metadata)
            if metadata.is_dir()
                && !metadata.file_type().is_symlink()
                && !is_reparse_point(&metadata) => {}
        Ok(_) => return Err("project data path is not a real directory".into()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            fs::create_dir(&internal)
                .map_err(|error| format!("could not create project data directory: {error}"))?;
            set_private_directory_permissions(&internal)?;
            sync_parent(&internal)?;
        }
        Err(error) => return Err(format!("could not inspect project data directory: {error}")),
    }
    let marker = restore_pending_marker(marker_dir);
    let file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&marker)
        .map_err(|error| format!("could not mark Checkpoint restore as pending: {error}"))?;
    if let Err(error) = set_private_file_permissions(&marker)
        .and_then(|_| {
            file.sync_all()
                .map_err(|error| format!("could not save restore marker: {error}"))
        })
        .and_then(|_| sync_parent(&marker))
    {
        let _ = fs::remove_file(marker);
        return Err(error);
    }
    Ok(())
}

fn remove_restore_pending_marker(marker_dir: &Path) -> Result<(), String> {
    let marker = restore_pending_marker(marker_dir);
    match fs::remove_file(&marker) {
        Ok(()) => sync_parent(&marker),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!("could not clear restore marker: {error}")),
    }
}

fn restore_pending_marker_exists(marker_dir: &Path) -> Result<bool, String> {
    let internal = marker_dir.to_path_buf();
    let metadata = match fs::symlink_metadata(&internal) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(false),
        Err(error) => {
            return Err(format!(
                "could not inspect Checkpoint restore marker directory: {error}"
            ));
        }
    };
    if !metadata.is_dir() || metadata.file_type().is_symlink() || is_reparse_point(&metadata) {
        return Err("Checkpoint restore marker directory is not a real directory".into());
    }
    match fs::symlink_metadata(restore_pending_marker(marker_dir)) {
        Ok(metadata)
            if metadata.is_file()
                && !metadata.file_type().is_symlink()
                && !is_reparse_point(&metadata) =>
        {
            Ok(true)
        }
        Ok(_) => Err("Checkpoint restore marker is not a real file".into()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(format!(
            "could not inspect Checkpoint restore marker: {error}"
        )),
    }
}

fn restore_terminal_marker(store: &Path) -> PathBuf {
    store.join(RESTORE_TERMINAL_FILE)
}

fn restore_terminal_marker_exists(store: &Path) -> Result<bool, String> {
    use std::io::Read as _;

    let marker = restore_terminal_marker(store);
    let path_metadata = match fs::symlink_metadata(&marker) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(false),
        Err(error) => {
            return Err(format!(
                "could not inspect Checkpoint restore terminal marker: {error}"
            ));
        }
    };
    if !path_metadata.is_file()
        || path_metadata.file_type().is_symlink()
        || is_reparse_point(&path_metadata)
    {
        return Err("Checkpoint restore terminal marker is not a real file".into());
    }

    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt as _;
        options.custom_flags(libc::O_NOFOLLOW);
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt as _;
        use windows_sys::Win32::Storage::FileSystem::FILE_FLAG_OPEN_REPARSE_POINT;
        options.custom_flags(FILE_FLAG_OPEN_REPARSE_POINT);
    }
    let mut file = options
        .open(&marker)
        .map_err(|error| format!("could not open Checkpoint restore terminal marker: {error}"))?;
    let metadata = file.metadata().map_err(|error| {
        format!("could not inspect Checkpoint restore terminal marker: {error}")
    })?;
    if !metadata.is_file()
        || is_reparse_point(&metadata)
        || metadata.len() != RESTORE_TERMINAL_BYTES.len() as u64
    {
        return Err("Checkpoint restore terminal marker is invalid".into());
    }
    let bound = same_file::Handle::from_file(
        file.try_clone()
            .map_err(|error| format!("could not clone restore terminal marker: {error}"))?,
    )
    .map_err(|error| format!("could not bind Checkpoint restore terminal marker: {error}"))?;
    if bound
        != same_file::Handle::from_path(&marker).map_err(|error| {
            format!("could not verify Checkpoint restore terminal marker: {error}")
        })?
    {
        return Err("Checkpoint restore terminal marker changed while it was opened".into());
    }
    let mut bytes = Vec::with_capacity(RESTORE_TERMINAL_BYTES.len());
    file.read_to_end(&mut bytes)
        .map_err(|error| format!("could not read Checkpoint restore terminal marker: {error}"))?;
    if bytes != RESTORE_TERMINAL_BYTES
        || bound
            != same_file::Handle::from_path(&marker).map_err(|error| {
                format!("could not verify Checkpoint restore terminal marker: {error}")
            })?
    {
        return Err("Checkpoint restore terminal marker is invalid".into());
    }
    Ok(true)
}

fn write_restore_terminal_marker(store: &Path) -> Result<(), String> {
    use std::io::Write as _;

    if restore_terminal_marker_exists(store)? {
        return Ok(());
    }
    let marker = restore_terminal_marker(store);
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt as _;
        options.custom_flags(libc::O_NOFOLLOW);
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt as _;
        use windows_sys::Win32::Storage::FileSystem::FILE_FLAG_OPEN_REPARSE_POINT;
        options.custom_flags(FILE_FLAG_OPEN_REPARSE_POINT);
    }
    let mut file = match options.open(&marker) {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
            return restore_terminal_marker_exists(store).and_then(|exists| {
                exists
                    .then_some(())
                    .ok_or_else(|| "Checkpoint restore terminal marker disappeared".to_string())
            });
        }
        Err(error) => {
            return Err(format!(
                "could not create Checkpoint restore terminal marker: {error}"
            ));
        }
    };
    set_private_file_permissions(&marker)?;
    file.write_all(RESTORE_TERMINAL_BYTES)
        .map_err(|error| format!("could not write Checkpoint restore terminal marker: {error}"))?;
    file.sync_all()
        .map_err(|error| format!("could not save Checkpoint restore terminal marker: {error}"))?;
    let bound = same_file::Handle::from_file(
        file.try_clone()
            .map_err(|error| format!("could not clone restore terminal marker: {error}"))?,
    )
    .map_err(|error| format!("could not bind Checkpoint restore terminal marker: {error}"))?;
    if bound
        != same_file::Handle::from_path(&marker).map_err(|error| {
            format!("could not verify Checkpoint restore terminal marker: {error}")
        })?
    {
        return Err("Checkpoint restore terminal marker changed while it was saved".into());
    }
    sync_directory(store)
}

fn remove_restore_terminal_marker(store: &Path) -> Result<(), String> {
    if !restore_terminal_marker_exists(store)? {
        return Ok(());
    }
    let marker = restore_terminal_marker(store);
    fs::remove_file(&marker)
        .map_err(|error| format!("could not clear Checkpoint restore terminal marker: {error}"))?;
    sync_directory(store)
}

#[cfg(test)]
fn has_restore_pending_marker(project: &Path) -> bool {
    restore_pending_marker_exists(&project.join(crate::project_location::LIBRARY_STATE_DIR))
        .unwrap_or(false)
}

#[derive(Debug, Deserialize, Serialize)]
struct RestorePlan {
    files: Vec<String>,
    created_project_directories: Vec<String>,
}

fn prepare_restore_plan(incoming: &Path, project_root: &Path) -> Result<RestorePlan, String> {
    let files = validate_restore_payload(incoming)?;
    let created_project_directories = missing_project_directories(project_root, &files)?;
    Ok(RestorePlan {
        files,
        created_project_directories,
    })
}

fn validate_restore_payload(incoming: &Path) -> Result<Vec<String>, String> {
    let manifest = incoming.join("project.json");
    let metadata = fs::symlink_metadata(&manifest)
        .map_err(|_| "The selected Checkpoint does not contain project.json.".to_string())?;
    if !metadata.is_file() || metadata.file_type().is_symlink() || is_reparse_point(&metadata) {
        return Err("The selected Checkpoint contains invalid project metadata.".into());
    }
    let mut files = Vec::new();
    collect_restore_files(incoming, incoming, &mut files)?;
    files.sort();
    if !files.iter().any(|path| path == "project.json") {
        return Err("The selected Checkpoint does not contain project.json.".into());
    }
    let project_bytes = fs::read(&manifest)
        .map_err(|_| "The selected Checkpoint contains unreadable project metadata.".to_string())?;
    let project: crate::project::ProjectMeta = serde_json::from_slice(&project_bytes)
        .map_err(|_| "The selected Checkpoint contains invalid project metadata.".to_string())?;
    if !files.iter().any(|path| path == &project.main_doc) {
        return Err(format!(
            "The selected Checkpoint does not contain its main document, {}.",
            project.main_doc
        ));
    }
    crate::document_engine::engine_for(&project.engine, &project.main_doc)
        .map_err(|_| "The selected Checkpoint uses an unsupported document engine.".to_string())?;
    Ok(files)
}

fn collect_restore_files(
    root: &Path,
    directory: &Path,
    files: &mut Vec<String>,
) -> Result<(), String> {
    for entry in read_entries(directory)? {
        let metadata = fs::symlink_metadata(entry.path())
            .map_err(|error| format!("could not inspect a restore payload path: {error}"))?;
        if metadata.file_type().is_symlink() || is_reparse_point(&metadata) {
            return Err("The selected Checkpoint contains a linked path.".into());
        }
        let relative = entry
            .path()
            .strip_prefix(root)
            .map_err(|_| "A restore payload path escapes its root.".to_string())?
            .to_path_buf();
        let portable = path_to_portable(&relative)?;
        let first = portable.split('/').next().unwrap_or_default();
        if is_protected_name(std::ffi::OsStr::new(first)) {
            return Err("The selected Checkpoint contains a protected project path.".into());
        }
        if metadata.is_dir() {
            collect_restore_files(root, &entry.path(), files)?;
        } else if metadata.is_file() {
            files.push(portable);
        } else {
            return Err("The selected Checkpoint contains a non-file path.".into());
        }
    }
    Ok(())
}

fn path_to_portable(path: &Path) -> Result<String, String> {
    let mut components = Vec::new();
    for component in path.components() {
        let std::path::Component::Normal(component) = component else {
            return Err("A restore path is not project-relative.".into());
        };
        let component = component
            .to_str()
            .ok_or_else(|| "A restore path is not valid Unicode.".to_string())?;
        if component.is_empty() || component == "." || component == ".." {
            return Err("A restore path is not normalized.".into());
        }
        components.push(component);
    }
    if components.is_empty() {
        return Err("A restore path is empty.".into());
    }
    Ok(components.join("/"))
}

fn restore_path(root: &Path, portable: &str) -> Result<PathBuf, String> {
    if portable.is_empty()
        || portable.starts_with('/')
        || portable.starts_with('\\')
        || portable.contains('\\')
        || portable.contains(':')
        || portable.chars().any(char::is_control)
        || portable
            .split('/')
            .any(|part| part.is_empty() || part == "." || part == "..")
    {
        return Err("A restore journal contains an invalid project path.".into());
    }
    let first = portable.split('/').next().unwrap_or_default();
    if is_protected_name(std::ffi::OsStr::new(first)) {
        return Err("A restore journal contains a protected project path.".into());
    }
    Ok(portable
        .split('/')
        .fold(root.to_path_buf(), |path, part| path.join(part)))
}

fn missing_project_directories(
    project_root: &Path,
    files: &[String],
) -> Result<Vec<String>, String> {
    let mut missing = HashSet::new();
    for file in files {
        let parts = file.split('/').collect::<Vec<_>>();
        let mut current = project_root.to_path_buf();
        let mut portable = Vec::new();
        for component in &parts[..parts.len().saturating_sub(1)] {
            current.push(component);
            portable.push(*component);
            match fs::symlink_metadata(&current) {
                Ok(metadata)
                    if metadata.is_dir()
                        && !metadata.file_type().is_symlink()
                        && !is_reparse_point(&metadata) => {}
                Ok(_) => {
                    return Err(format!(
                        "Cannot restore {file} because one of its parent paths is not a real directory."
                    ));
                }
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                    missing.insert(portable.join("/"));
                }
                Err(error) => {
                    return Err(format!(
                        "could not inspect a project path before restore: {error}"
                    ));
                }
            }
        }
    }
    let mut missing = missing.into_iter().collect::<Vec<_>>();
    missing.sort_by(|left, right| {
        left.matches('/')
            .count()
            .cmp(&right.matches('/').count())
            .then_with(|| left.cmp(right))
    });
    Ok(missing)
}

fn write_restore_plan<T: Serialize>(transaction: &Path, plan: &T) -> Result<(), String> {
    let path = transaction.join(RESTORE_PLAN_FILE);
    let bytes = serde_json::to_vec(plan)
        .map_err(|error| format!("could not encode restore plan: {error}"))?;
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&path)
        .map_err(|error| format!("could not create restore plan: {error}"))?;
    if let Err(error) = set_private_file_permissions(&path)
        .and_then(|_| {
            use std::io::Write as _;
            file.write_all(&bytes)
                .map_err(|error| format!("could not write restore plan: {error}"))
        })
        .and_then(|_| {
            file.sync_all()
                .map_err(|error| format!("could not save restore plan: {error}"))
        })
        .and_then(|_| sync_directory(transaction))
    {
        let _ = fs::remove_file(path);
        return Err(error);
    }
    Ok(())
}

#[cfg(test)]
fn write_injected_partial_file(path: &Path, bytes: &[u8]) -> Result<(), String> {
    use std::io::Write as _;

    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .map_err(|error| format!("could not create injected restore state: {error}"))?;
    set_private_file_permissions(path)?;
    file.write_all(bytes)
        .map_err(|error| format!("could not write injected restore state: {error}"))?;
    file.sync_all()
        .map_err(|error| format!("could not save injected restore state: {error}"))?;
    sync_parent(path)
}

fn read_restore_plan(transaction: &Path) -> Result<RestorePlan, String> {
    let path = transaction.join(RESTORE_PLAN_FILE);
    let metadata = fs::symlink_metadata(&path)
        .map_err(|_| "restore staging is missing its path plan".to_string())?;
    if !metadata.is_file() || metadata.file_type().is_symlink() || is_reparse_point(&metadata) {
        return Err("restore staging contains an invalid path plan".into());
    }
    let bytes = fs::read(path).map_err(|error| format!("could not read restore plan: {error}"))?;
    let plan: RestorePlan = serde_json::from_slice(&bytes)
        .map_err(|error| format!("could not decode restore plan: {error}"))?;
    let mut seen_files = HashSet::new();
    for file in &plan.files {
        restore_path(Path::new("."), file)?;
        if !seen_files.insert(file) {
            return Err("restore staging repeats a project path".into());
        }
    }
    let mut seen_directories = HashSet::new();
    for directory in &plan.created_project_directories {
        restore_path(Path::new("."), directory)?;
        if !seen_directories.insert(directory) {
            return Err("restore staging repeats a project directory".into());
        }
    }
    Ok(plan)
}

fn backup_restore_paths(
    project: &Path,
    backup: &Path,
    plan: &RestorePlan,
    fault: RestoreFault,
) -> Result<(), String> {
    let mut moved = 0_u64;
    let mut touched = BTreeSet::new();
    for relative in &plan.files {
        let source = restore_path(project, relative)?;
        let metadata = match fs::symlink_metadata(&source) {
            Ok(metadata) => metadata,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
            Err(error) => return Err(format!("could not inspect a project path: {error}")),
        };
        if metadata.is_dir() {
            return Err(format!(
                "Cannot restore {relative} because it is currently a directory."
            ));
        }
        let destination = restore_path(backup, relative)?;
        if let Some(parent) = destination.parent() {
            create_restore_directories_durable(backup, parent, fault)?;
        }
        rename_path(&source, &destination)
            .map_err(|error| format!("could not back up a project path during restore: {error}"))?;
        record_touched_parent(&mut touched, &source)?;
        record_touched_parent(&mut touched, &destination)?;
        moved += 1;

        #[cfg(test)]
        if moved == 1 && fault == RestoreFault::AfterFirstBackup {
            sync_touched_parents(touched)?;
            return Err("injected restore failure".into());
        }
    }
    let _ = (fault, moved);
    sync_touched_parents(touched)
}

fn install_restore_paths(
    incoming: &Path,
    project: &Path,
    plan: &RestorePlan,
    fault: RestoreFault,
) -> Result<(), String> {
    create_planned_directories(project, plan, Durability::Strict)?;

    let mut moved = 0_u64;
    let mut touched = BTreeSet::new();
    for relative in &plan.files {
        let source = restore_path(incoming, relative)?;
        let destination = restore_path(project, relative)?;
        if fs::symlink_metadata(&destination).is_ok() {
            return Err(format!(
                "A restore transaction found a conflict at {relative}."
            ));
        }
        rename_path(&source, &destination)
            .map_err(|error| format!("could not install a project path during restore: {error}"))?;
        record_touched_parent(&mut touched, &source)?;
        record_touched_parent(&mut touched, &destination)?;
        moved += 1;
        #[cfg(test)]
        if moved == 1 && fault.fails_after_first_install() {
            sync_touched_parents(touched)?;
            return Err("injected restore failure".into());
        }
    }
    let _ = (fault, moved);
    sync_touched_parents(touched)
}

fn read_entries(directory: &Path) -> Result<Vec<fs::DirEntry>, String> {
    fs::read_dir(directory)
        .map_err(|error| format!("could not read a restore directory: {error}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("could not inspect a restore directory: {error}"))
}

fn create_restore_directories_durable(
    root: &Path,
    directory: &Path,
    fault: RestoreFault,
) -> Result<(), String> {
    if directory.strip_prefix(root).is_err() {
        return Err("restore directory path escapes its staging root".into());
    }
    fs::create_dir_all(directory)
        .map_err(|error| format!("could not prepare restore directory: {error}"))?;
    let mut current = directory;
    loop {
        let metadata = fs::symlink_metadata(current)
            .map_err(|error| format!("could not inspect restore directory: {error}"))?;
        if !metadata.is_dir() || metadata.file_type().is_symlink() || is_reparse_point(&metadata) {
            return Err("restore directory path is not a real directory".into());
        }

        #[cfg(test)]
        if fault == RestoreFault::DuringNestedBackupDirectorySync && current != root {
            return Err("injected restore directory durability failure".into());
        }

        sync_directory(current)?;
        if current == root {
            break;
        }
        current = current
            .parent()
            .ok_or_else(|| "restore directory path has no staging root".to_string())?;
        if current.strip_prefix(root).is_err() {
            return Err("restore directory path escapes its staging root".into());
        }
    }
    let _ = fault;
    Ok(())
}

fn is_protected_name(name: &std::ffi::OsStr) -> bool {
    name.to_str().is_some_and(|name| {
        name.eq_ignore_ascii_case(".git") || name.eq_ignore_ascii_case(".oleafly")
    })
}

fn create_private_directory(path: &Path) -> Result<(), String> {
    fs::create_dir(path).map_err(|error| format!("could not create restore staging: {error}"))?;
    let metadata = fs::symlink_metadata(path)
        .map_err(|error| format!("could not inspect restore staging: {error}"))?;
    if !metadata.is_dir() || metadata.file_type().is_symlink() || is_reparse_point(&metadata) {
        return Err("restore staging is not a real directory".into());
    }
    set_private_directory_permissions(path)?;
    sync_parent(path)
}

fn existing_real_directory(path: &Path, parent: &Path) -> Result<Option<PathBuf>, String> {
    let metadata = match fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(format!("could not inspect restore staging: {error}")),
    };
    if !metadata.is_dir() || metadata.file_type().is_symlink() || is_reparse_point(&metadata) {
        return Err("restore staging is not a real directory".into());
    }
    let resolved = path
        .canonicalize()
        .map_err(|error| format!("could not resolve restore staging: {error}"))?;
    if resolved.parent() != Some(parent) {
        return Err("restore staging escapes its Checkpoints store".into());
    }
    Ok(Some(resolved))
}

fn mark_phase(transaction: &Path, phase: &str) -> Result<(), String> {
    let marker = transaction.join(phase);
    let created = match OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&marker)
    {
        Ok(file) => {
            let durable = set_private_file_permissions(&marker).and_then(|_| {
                file.sync_all()
                    .map_err(|error| format!("could not save restore progress: {error}"))
            });
            if let Err(error) = durable {
                let _ = fs::remove_file(&marker);
                return Err(error);
            }
            true
        }
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => false,
        Err(error) => return Err(format!("could not save restore progress: {error}")),
    };
    if let Err(error) = sync_directory(transaction) {
        if created {
            let _ = fs::remove_file(&marker);
            let _ = sync_directory(transaction);
        }
        return Err(error);
    }
    Ok(())
}

fn has_phase(transaction: &Path, phase: &str) -> Result<bool, String> {
    match fs::symlink_metadata(transaction.join(phase)) {
        Ok(metadata) => Ok(metadata.is_file()
            && !metadata.file_type().is_symlink()
            && !is_reparse_point(&metadata)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(format!("could not inspect restore progress: {error}")),
    }
}

/// Rolls back or finalizes a restore journal while the caller owns the same
/// compile, figure, mutation-admission, and cross-process worktree coordination
/// as an ordinary restore. Ordinary metadata reads never call this function.
pub(crate) fn recover_interrupted_restore_lock_held(project_id: &str) -> Result<bool, String> {
    crate::paths::validate_project_id(project_id)?;
    let _activity = ActiveRestore::acquire(project_id);
    let location = crate::project_location::locate(project_id)?;
    let marker_dir = location.private_state_dir();
    // Ordinary project reads remain independent from Checkpoints storage.
    // Only a durable in-project marker proves that worktree mutation began.
    let pending = restore_pending_marker_exists(&marker_dir)?;
    let Some(store_path) = crate::paths::existing_checkpoint_store_dir(project_id)? else {
        return if pending {
            Err("A Checkpoint restore is pending, but its recovery data is unavailable.".into())
        } else {
            Ok(false)
        };
    };
    let store = Store::open_existing(&store_path)
        .map_err(|_| "Could not open Checkpoints recovery data.".to_string())?
        .ok_or_else(|| {
            "Checkpoint recovery data disappeared before it could be opened.".to_string()
        })?;
    let locked_store = store
        .lock_exclusive()
        .map_err(|_| "Could not lock Checkpoints recovery data.".to_string())?;
    let transaction = locked_store.root().join(RESTORE_TRANSACTION);
    if pending {
        match location.kind {
            ProjectKind::Library => recover_restore_transaction(
                &location.root,
                &marker_dir,
                &transaction,
                RestoreFault::None,
            )?,
            ProjectKind::Linked => recover_linked_restore_transaction(
                &location.root,
                &marker_dir,
                &linked_sidecar(&location)?,
                &transaction,
                RestoreFault::None,
            )?,
        }
        Ok(true)
    } else {
        clear_stale_restore_terminal_marker(&transaction)?;
        Ok(false)
    }
}

fn recover_or_discard_restore_transaction(
    project: &Path,
    marker_dir: &Path,
    transaction: &Path,
) -> Result<(), String> {
    recover_or_discard_with(marker_dir, transaction, || {
        recover_restore_transaction(project, marker_dir, transaction, RestoreFault::None)
    })
}

fn recover_or_discard_with(
    marker_dir: &Path,
    transaction: &Path,
    recover: impl FnOnce() -> Result<(), String>,
) -> Result<(), String> {
    if restore_pending_marker_exists(marker_dir)? {
        recover()
    } else {
        clear_stale_restore_terminal_marker(transaction)?;
        discard_unstarted_restore_transaction(transaction)
    }
}

fn clear_stale_restore_terminal_marker(transaction: &Path) -> Result<(), String> {
    let store = transaction
        .parent()
        .ok_or_else(|| "restore staging has no Checkpoints store".to_string())?;
    if !restore_terminal_marker_exists(store)? {
        return Ok(());
    }
    if existing_real_directory(transaction, store)?.is_some() {
        return Err(
            "Checkpoint restore cleanup found an unmarked transaction beside its terminal marker."
                .into(),
        );
    }
    remove_restore_terminal_marker(store)
}

fn discard_unstarted_restore_transaction(transaction: &Path) -> Result<(), String> {
    let store = transaction
        .parent()
        .ok_or_else(|| "restore staging has no Checkpoints store".to_string())?;
    let Some(transaction) = existing_real_directory(transaction, store)? else {
        return Ok(());
    };
    remove_transaction_directory(&transaction)
}

fn complete_terminal_restore_cleanup(
    marker_dir: &Path,
    transaction: &Path,
    outcome: RestoreTerminalOutcome,
    fault: RestoreFault,
) -> Result<(), String> {
    let _ = (outcome, fault);
    let store = transaction
        .parent()
        .ok_or_else(|| "restore staging has no Checkpoints store".to_string())?;
    write_restore_terminal_marker(store)?;
    if let Some(transaction) = existing_real_directory(transaction, store)? {
        remove_transaction_directory(&transaction)?;
    }

    #[cfg(test)]
    if fault.crashes_after_transaction_cleanup(outcome) {
        return Err("injected restore crash after transaction cleanup".into());
    }

    remove_restore_pending_marker(marker_dir)?;

    #[cfg(test)]
    if fault == RestoreFault::CrashAfterPendingMarkerCleanup
        && outcome == RestoreTerminalOutcome::Installed
    {
        return Err("injected restore crash after pending marker cleanup".into());
    }

    remove_restore_terminal_marker(store)
}

fn recover_restore_transaction(
    project: &Path,
    marker_dir: &Path,
    transaction: &Path,
    fault: RestoreFault,
) -> Result<(), String> {
    let store = transaction
        .parent()
        .ok_or_else(|| "restore staging has no Checkpoints store".to_string())?;
    if restore_terminal_marker_exists(store)? {
        return complete_terminal_restore_cleanup(
            marker_dir,
            transaction,
            RestoreTerminalOutcome::RolledBack,
            fault,
        );
    }
    let transaction = existing_real_directory(transaction, store)?.ok_or_else(|| {
        "A Checkpoint restore is pending, but its recovery data is unavailable.".to_string()
    })?;

    if has_phase(&transaction, PHASE_INSTALLED)? {
        return complete_terminal_restore_cleanup(
            marker_dir,
            &transaction,
            RestoreTerminalOutcome::Installed,
            fault,
        );
    }

    let incoming = transaction.join(INCOMING_DIRECTORY);
    let backup = transaction.join(BACKUP_DIRECTORY);
    let plan = read_restore_plan(&transaction)?;
    let installing =
        has_phase(&transaction, PHASE_INSTALLING)? || has_phase(&transaction, PHASE_ROLLING_BACK)?;
    let restoring_backup = has_phase(&transaction, PHASE_RESTORING_BACKUP)?;
    let backing_up = has_phase(&transaction, PHASE_BACKING_UP)?;

    if installing && !restoring_backup {
        let incoming = existing_real_directory(&incoming, &transaction)?
            .ok_or_else(|| "restore staging is missing its verified payload".to_string())?;
        mark_phase(&transaction, PHASE_ROLLING_BACK)?;
        move_installed_paths_back(project, &incoming, &plan)?;
        mark_phase(&transaction, PHASE_RESTORING_BACKUP)?;
    } else if backing_up && !restoring_backup {
        mark_phase(&transaction, PHASE_RESTORING_BACKUP)?;
    }

    if has_phase(&transaction, PHASE_RESTORING_BACKUP)? {
        let backup = existing_real_directory(&backup, &transaction)?
            .ok_or_else(|| "restore staging is missing its rollback data".to_string())?;
        restore_backup_paths(&backup, project, &plan)?;
        remove_created_project_directories(project, &plan, Durability::Strict)?;
    }

    complete_terminal_restore_cleanup(
        marker_dir,
        &transaction,
        RestoreTerminalOutcome::RolledBack,
        fault,
    )
}

fn move_installed_paths_back(
    project: &Path,
    incoming: &Path,
    plan: &RestorePlan,
) -> Result<(), String> {
    let mut touched = BTreeSet::new();
    for relative in &plan.files {
        let staged = restore_path(incoming, relative)?;
        match fs::symlink_metadata(&staged) {
            Ok(_) => continue,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(format!("could not inspect restore staging: {error}")),
        }
        let installed = restore_path(project, relative)?;
        let metadata = fs::symlink_metadata(&installed)
            .map_err(|_| format!("restore recovery cannot find installed path {relative}"))?;
        if !metadata.is_file() || metadata.file_type().is_symlink() || is_reparse_point(&metadata) {
            return Err(format!(
                "restore recovery found an invalid installed path at {relative}"
            ));
        }
        if let Some(parent) = staged.parent() {
            create_restore_directories_durable(incoming, parent, RestoreFault::None)?;
        }
        rename_path(&installed, &staged)
            .map_err(|error| format!("could not roll back installed path {relative}: {error}"))?;
        record_touched_parent(&mut touched, &installed)?;
        record_touched_parent(&mut touched, &staged)?;
    }
    sync_touched_parents(touched)
}

fn restore_backup_paths(backup: &Path, project: &Path, plan: &RestorePlan) -> Result<(), String> {
    let mut touched = BTreeSet::new();
    for relative in &plan.files {
        let saved = restore_path(backup, relative)?;
        match fs::symlink_metadata(&saved) {
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
            Err(error) => return Err(format!("could not inspect restore backup: {error}")),
        }
        let destination = restore_path(project, relative)?;
        if fs::symlink_metadata(&destination).is_ok() {
            return Err(format!(
                "restore recovery found a conflict at project path {relative}"
            ));
        }
        if let Some(parent) = destination.parent() {
            create_restore_directories_durable(project, parent, RestoreFault::None)?;
        }
        rename_path(&saved, &destination)
            .map_err(|error| format!("could not restore project path {relative}: {error}"))?;
        record_touched_parent(&mut touched, &saved)?;
        record_touched_parent(&mut touched, &destination)?;
    }
    sync_touched_parents(touched)
}

fn remove_created_project_directories(
    project: &Path,
    plan: &RestorePlan,
    durability: Durability,
) -> Result<(), String> {
    for relative in plan.created_project_directories.iter().rev() {
        let directory = restore_path(project, relative)?;
        match fs::remove_dir(&directory) {
            Ok(()) => sync_parent_with(&directory, durability)?,
            Err(error)
                if matches!(
                    error.kind(),
                    std::io::ErrorKind::NotFound | std::io::ErrorKind::DirectoryNotEmpty
                ) => {}
            Err(error) => {
                return Err(format!(
                    "could not clean a directory created during restore: {error}"
                ));
            }
        }
    }
    Ok(())
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum Durability {
    Strict,
    BestEffort,
}

fn sync_parent_with(path: &Path, durability: Durability) -> Result<(), String> {
    match durability {
        Durability::Strict => sync_parent(path),
        Durability::BestEffort => {
            let _ = sync_parent(path);
            Ok(())
        }
    }
}

#[cfg(test)]
thread_local! {
    static RENAME_BOUNDARIES: std::cell::RefCell<Vec<PathBuf>> =
        const { std::cell::RefCell::new(Vec::new()) };
}

#[cfg(test)]
struct RenameBoundary(PathBuf);

#[cfg(test)]
fn forbid_renames_across(root: &Path) -> RenameBoundary {
    let root = root.canonicalize().unwrap();
    RENAME_BOUNDARIES.with(|boundaries| boundaries.borrow_mut().push(root.clone()));
    RenameBoundary(root)
}

#[cfg(test)]
impl Drop for RenameBoundary {
    fn drop(&mut self) {
        RENAME_BOUNDARIES.with(|boundaries| boundaries.borrow_mut().retain(|root| root != &self.0));
    }
}

fn rename_path(source: &Path, destination: &Path) -> std::io::Result<()> {
    #[cfg(test)]
    if RENAME_BOUNDARIES.with(|boundaries| {
        boundaries
            .borrow()
            .iter()
            .any(|root| source.starts_with(root) != destination.starts_with(root))
    }) {
        return Err(std::io::Error::from(std::io::ErrorKind::CrossesDevices));
    }
    fs::rename(source, destination)
}

fn create_planned_directories(
    project: &Path,
    plan: &RestorePlan,
    durability: Durability,
) -> Result<(), String> {
    for relative in &plan.created_project_directories {
        let directory = restore_path(project, relative)?;
        match fs::create_dir(&directory) {
            Ok(()) => sync_parent_with(&directory, durability)?,
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
                let metadata = fs::symlink_metadata(&directory)
                    .map_err(|error| format!("could not inspect a project directory: {error}"))?;
                if !metadata.is_dir()
                    || metadata.file_type().is_symlink()
                    || is_reparse_point(&metadata)
                {
                    return Err("A restore parent path is not a real directory.".into());
                }
            }
            Err(error) => return Err(format!("could not create a project directory: {error}")),
        }
    }
    Ok(())
}

#[derive(Debug, Deserialize, Serialize)]
struct LinkedRestorePlan {
    #[serde(flatten)]
    paths: RestorePlan,
    detached_manifest: bool,
}

fn linked_sidecar(location: &ProjectLocation) -> Result<PathBuf, String> {
    location
        .sidecar_manifest_path()
        .ok_or_else(|| "This project is not a folder opened in place.".to_string())
}

fn restore_linked_checkpoint_into(
    store: &Store,
    snapshot_root: &SnapshotRoot,
    location: &ProjectLocation,
    fault: RestoreFault,
) -> Result<(), String> {
    let sidecar = linked_sidecar(location)?;
    let marker_dir = location.private_state_dir();
    let locked_store = store
        .lock_exclusive()
        .map_err(|_| "Could not lock this project's Checkpoints history.".to_string())?;
    let checkpoint = locked_store
        .checkpoint(snapshot_root)
        .map_err(|_| "The selected Checkpoint could not be read.".to_string())?
        .ok_or_else(|| "The selected Checkpoint no longer exists.".to_string())?;
    let transaction = locked_store.root().join(RESTORE_TRANSACTION);
    recover_or_discard_with(&marker_dir, &transaction, || {
        recover_linked_restore_transaction(
            &location.root,
            &marker_dir,
            &sidecar,
            &transaction,
            RestoreFault::None,
        )
    })?;
    create_private_directory(&transaction)?;
    let incoming = transaction.join(INCOMING_DIRECTORY);
    let prepared = (|| -> Result<(), String> {
        let materialized = locked_store
            .materialize(snapshot_root, &incoming)
            .map_err(|_| "The selected Checkpoint could not be verified.".to_string())?;
        if materialized.layout != ManifestLayout::Detached {
            return Err(AppError::new("checkpoint.library_history_for_folder").into());
        }
        let plan = prepare_linked_restore_plan(&incoming, &location.root, &checkpoint)?;
        create_private_directory(&transaction.join(BACKUP_DIRECTORY))?;
        write_restore_plan(&transaction, &plan)?;
        mark_phase(&transaction, PHASE_PREPARED)?;
        write_restore_pending_marker(&marker_dir)?;
        mark_phase(&transaction, PHASE_BACKING_UP)?;
        copy_restore_backups(&location.root, &sidecar, &transaction, &plan, fault)?;
        mark_phase(&transaction, PHASE_INSTALLING)?;
        install_restore_copies(&incoming, &location.root, &sidecar, &plan, fault)?;
        mark_phase(&transaction, PHASE_INSTALLED)?;
        Ok(())
    })();
    #[cfg(test)]
    if fault == RestoreFault::CrashDuringInstall {
        return prepared.and_then(|_| Err("injected restore crash did not trigger".into()));
    }
    conclude_restore(prepared, &marker_dir, &transaction, fault, || {
        recover_linked_restore_transaction(
            &location.root,
            &marker_dir,
            &sidecar,
            &transaction,
            fault,
        )
    })
}

fn prepare_linked_restore_plan(
    incoming: &Path,
    project_root: &Path,
    checkpoint: &Checkpoint,
) -> Result<LinkedRestorePlan, String> {
    let mut files = Vec::new();
    collect_restore_files(incoming, incoming, &mut files)?;
    files.sort();
    let detached_manifest = match files.iter().position(|path| path == DETACHED_MANIFEST_PATH) {
        Some(index) => {
            files.remove(index);
            true
        }
        None => false,
    };
    if detached_manifest {
        let bytes = fs::read(incoming.join(DETACHED_MANIFEST_PATH)).map_err(|_| {
            "The selected Checkpoint contains unreadable project metadata.".to_string()
        })?;
        crate::project::parse_project_meta(&bytes).map_err(|error| {
            format!("The Checkpoint contains invalid project metadata: {error}")
        })?;
    }
    if !files.iter().any(|path| path == &checkpoint.main_document) {
        return Err(format!(
            "The selected Checkpoint does not contain its main document, {}.",
            checkpoint.main_document
        ));
    }
    for relative in &files {
        refuse_blocked_destination(&restore_path(project_root, relative)?, relative)?;
    }
    let created_project_directories = missing_project_directories(project_root, &files)?;
    Ok(LinkedRestorePlan {
        paths: RestorePlan {
            files,
            created_project_directories,
        },
        detached_manifest,
    })
}

fn refuse_blocked_destination(destination: &Path, relative: &str) -> Result<(), String> {
    match fs::symlink_metadata(destination) {
        Ok(metadata) if metadata.is_dir() && !metadata.file_type().is_symlink() => Err(format!(
            "Cannot restore {relative} because it is currently a directory."
        )),
        Ok(metadata)
            if !metadata.is_file()
                || metadata.file_type().is_symlink()
                || is_reparse_point(&metadata) =>
        {
            Err(AppError::new("checkpoint.restore_path_blocked")
                .param("path", relative)
                .into())
        }
        Ok(_) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!("could not inspect a project path: {error}")),
    }
}

fn ensure_real_parents(root: &Path, relative: &str) -> Result<(), String> {
    let parts = relative.split('/').collect::<Vec<_>>();
    let mut current = root.to_path_buf();
    for part in &parts[..parts.len().saturating_sub(1)] {
        current.push(part);
        let metadata = fs::symlink_metadata(&current)
            .map_err(|error| format!("could not inspect a project directory: {error}"))?;
        if !metadata.is_dir() || metadata.file_type().is_symlink() || is_reparse_point(&metadata) {
            return Err(format!(
                "Cannot restore {relative} because one of its parent paths is not a real directory."
            ));
        }
    }
    Ok(())
}

fn open_regular_no_follow(path: &Path) -> Result<fs::File, String> {
    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt as _;
        options.custom_flags(libc::O_NOFOLLOW);
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt as _;
        use windows_sys::Win32::Storage::FileSystem::FILE_FLAG_OPEN_REPARSE_POINT;
        options.custom_flags(FILE_FLAG_OPEN_REPARSE_POINT);
    }
    let file = options
        .open(path)
        .map_err(|error| format!("could not read a restore path: {error}"))?;
    let metadata = file
        .metadata()
        .map_err(|error| format!("could not read a restore path: {error}"))?;
    if !metadata.is_file() || is_reparse_point(&metadata) {
        return Err("A restore path is not a regular file.".into());
    }
    Ok(file)
}

fn copy_file_durable(source: &Path, destination: &Path) -> Result<(), String> {
    let mut reader = open_regular_no_follow(source)?;
    let mut writer = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(destination)
        .map_err(|error| format!("could not stage a restore copy: {error}"))?;
    set_private_file_permissions(destination)?;
    std::io::copy(&mut reader, &mut writer)
        .map_err(|error| format!("could not stage a restore copy: {error}"))?;
    writer
        .sync_all()
        .map_err(|error| format!("could not save a restore copy: {error}"))
}

fn install_copy(source: &Path, destination: &Path) -> Result<(), String> {
    let mut reader = open_regular_no_follow(source)?;
    let mut staged = crate::sandbox::AtomicFile::new(destination)?;
    std::io::copy(&mut reader, staged.staging_file_mut())
        .map_err(|error| format!("could not install a project path during restore: {error}"))?;
    staged.commit()
}

fn file_digest(path: &Path) -> Result<oleafly_history::ContentHash, String> {
    oleafly_history::ContentHash::digest_file(path)
        .map_err(|error| format!("could not read a restore path: {error}"))
}

fn regular_file_exists(path: &Path) -> bool {
    fs::symlink_metadata(path).is_ok_and(|metadata| {
        metadata.is_file() && !metadata.file_type().is_symlink() && !is_reparse_point(&metadata)
    })
}

fn copy_restore_backups(
    project: &Path,
    sidecar: &Path,
    transaction: &Path,
    plan: &LinkedRestorePlan,
    fault: RestoreFault,
) -> Result<(), String> {
    let backup = transaction.join(BACKUP_DIRECTORY);
    let mut copied = 0_u64;
    let mut touched = BTreeSet::new();
    for relative in &plan.paths.files {
        let source = restore_path(project, relative)?;
        match fs::symlink_metadata(&source) {
            Ok(_) => refuse_blocked_destination(&source, relative)?,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
            Err(error) => return Err(format!("could not inspect a project path: {error}")),
        }
        let destination = restore_path(&backup, relative)?;
        if let Some(parent) = destination.parent() {
            create_restore_directories_durable(&backup, parent, fault)?;
        }
        copy_file_durable(&source, &destination)?;
        record_touched_parent(&mut touched, &destination)?;
        copied += 1;
        #[cfg(test)]
        if copied == 1 && fault == RestoreFault::AfterFirstBackup {
            sync_touched_parents(touched)?;
            return Err("injected restore failure".into());
        }
    }
    if plan.detached_manifest && regular_file_exists(sidecar) {
        let destination = transaction.join(MANIFEST_BACKUP_FILE);
        copy_file_durable(sidecar, &destination)?;
        record_touched_parent(&mut touched, &destination)?;
    }
    let _ = (fault, copied);
    sync_touched_parents(touched)
}

fn install_restore_copies(
    incoming: &Path,
    project: &Path,
    sidecar: &Path,
    plan: &LinkedRestorePlan,
    fault: RestoreFault,
) -> Result<(), String> {
    create_planned_directories(project, &plan.paths, Durability::BestEffort)?;
    let mut installed = 0_u64;
    for relative in &plan.paths.files {
        ensure_real_parents(project, relative)?;
        let destination = restore_path(project, relative)?;
        refuse_blocked_destination(&destination, relative)?;
        install_copy(&restore_path(incoming, relative)?, &destination)?;
        installed += 1;
        #[cfg(test)]
        if installed == 1 && fault.fails_after_first_install() {
            return Err("injected restore failure".into());
        }
        #[cfg(test)]
        if installed == 1 && fault == RestoreFault::CrashDuringInstall {
            return Err("injected restore crash during install".into());
        }
    }
    if plan.detached_manifest {
        install_copy(&incoming.join(DETACHED_MANIFEST_PATH), sidecar)?;
    }
    let _ = (fault, installed);
    Ok(())
}

fn remove_installed(destination: &Path) -> Result<(), String> {
    match fs::remove_file(destination) {
        Ok(()) => {
            let _ = sync_parent(destination);
            Ok(())
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!(
            "could not remove a restored path during rollback: {error}"
        )),
    }
}

fn digest_if_regular(
    path: &Path,
    context: &str,
) -> Result<Option<oleafly_history::ContentHash>, String> {
    match fs::symlink_metadata(path) {
        Ok(metadata)
            if metadata.is_file()
                && !metadata.file_type().is_symlink()
                && !is_reparse_point(&metadata) =>
        {
            file_digest(path).map(Some)
        }
        Ok(_) => Err(format!("{context} is not a regular file")),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(format!("could not inspect {context}: {error}")),
    }
}

fn undo_copy(staged: &Path, saved: &Path, destination: &Path) -> Result<(), String> {
    let current = match digest_if_regular(destination, "a project path during rollback") {
        Ok(current) => current,
        Err(_) if fs::symlink_metadata(destination).is_ok() => return Ok(()),
        Err(error) => return Err(error),
    };
    let saved_digest = digest_if_regular(saved, "restore rollback data")?;
    let installed = match current {
        Some(current) => current == file_digest(staged)?,
        None => false,
    };
    match (saved_digest, current) {
        (Some(saved_digest), Some(current)) if current == saved_digest => Ok(()),
        (Some(_), None) => install_copy(saved, destination),
        (Some(_), Some(_)) if installed => install_copy(saved, destination),
        (None, Some(_)) if installed => remove_installed(destination),
        _ => Ok(()),
    }
}

fn roll_back_restore_copies(
    transaction: &Path,
    project: &Path,
    sidecar: &Path,
    plan: &LinkedRestorePlan,
) -> Result<(), String> {
    let incoming = existing_real_directory(&transaction.join(INCOMING_DIRECTORY), transaction)?
        .ok_or_else(|| "restore staging is missing its verified payload".to_string())?;
    let backup = existing_real_directory(&transaction.join(BACKUP_DIRECTORY), transaction)?
        .ok_or_else(|| "restore staging is missing its rollback data".to_string())?;
    for relative in &plan.paths.files {
        undo_copy(
            &restore_path(&incoming, relative)?,
            &restore_path(&backup, relative)?,
            &restore_path(project, relative)?,
        )?;
    }
    if plan.detached_manifest {
        undo_copy(
            &incoming.join(DETACHED_MANIFEST_PATH),
            &transaction.join(MANIFEST_BACKUP_FILE),
            sidecar,
        )?;
    }
    remove_created_project_directories(project, &plan.paths, Durability::BestEffort)
}

fn read_linked_restore_plan(transaction: &Path) -> Result<LinkedRestorePlan, String> {
    let paths = read_restore_plan(transaction)?;
    let bytes = fs::read(transaction.join(RESTORE_PLAN_FILE))
        .map_err(|error| format!("could not read restore plan: {error}"))?;
    let plan: LinkedRestorePlan = serde_json::from_slice(&bytes)
        .map_err(|_| "restore staging does not belong to a folder opened in place".to_string())?;
    Ok(LinkedRestorePlan {
        paths,
        detached_manifest: plan.detached_manifest,
    })
}

fn recover_linked_restore_transaction(
    root: &Path,
    marker_dir: &Path,
    sidecar: &Path,
    transaction: &Path,
    fault: RestoreFault,
) -> Result<(), String> {
    let store = transaction
        .parent()
        .ok_or_else(|| "restore staging has no Checkpoints store".to_string())?;
    if restore_terminal_marker_exists(store)? {
        return complete_terminal_restore_cleanup(
            marker_dir,
            transaction,
            RestoreTerminalOutcome::RolledBack,
            fault,
        );
    }
    let transaction = existing_real_directory(transaction, store)?.ok_or_else(|| {
        "A Checkpoint restore is pending, but its recovery data is unavailable.".to_string()
    })?;
    if has_phase(&transaction, PHASE_INSTALLED)? {
        return complete_terminal_restore_cleanup(
            marker_dir,
            &transaction,
            RestoreTerminalOutcome::Installed,
            fault,
        );
    }
    let plan = read_linked_restore_plan(&transaction)?;
    if has_phase(&transaction, PHASE_INSTALLING)? || has_phase(&transaction, PHASE_ROLLING_BACK)? {
        mark_phase(&transaction, PHASE_ROLLING_BACK)?;
        roll_back_restore_copies(&transaction, root, sidecar, &plan)?;
    }
    complete_terminal_restore_cleanup(
        marker_dir,
        &transaction,
        RestoreTerminalOutcome::RolledBack,
        fault,
    )
}

fn remove_transaction_directory(transaction: &Path) -> Result<(), String> {
    let parent = transaction
        .parent()
        .ok_or_else(|| "restore staging has no parent".to_string())?;
    fs::remove_dir_all(transaction)
        .map_err(|error| format!("could not clean up restore staging: {error}"))?;
    sync_directory(parent)
}

fn sync_parent(path: &Path) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "restore staging has no parent".to_string())?;
    sync_directory(parent)
}

fn record_touched_parent(touched: &mut BTreeSet<PathBuf>, path: &Path) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "restore staging has no parent".to_string())?;
    touched.insert(parent.to_path_buf());
    Ok(())
}

fn sync_touched_parents(touched: BTreeSet<PathBuf>) -> Result<(), String> {
    for parent in touched {
        sync_directory(&parent)?;
    }
    Ok(())
}

#[cfg(unix)]
fn sync_directory(path: &Path) -> Result<(), String> {
    File::open(path)
        .and_then(|directory| directory.sync_all())
        .map_err(|error| format!("could not make restore progress durable: {error}"))
}

#[cfg(windows)]
fn sync_directory(path: &Path) -> Result<(), String> {
    use std::os::windows::fs::OpenOptionsExt as _;

    const FILE_FLAG_BACKUP_SEMANTICS: u32 = 0x0200_0000;
    OpenOptions::new()
        .read(true)
        .write(true)
        .custom_flags(FILE_FLAG_BACKUP_SEMANTICS)
        .open(path)
        .and_then(|directory| directory.sync_all())
        .map_err(|error| format!("could not make restore progress durable: {error}"))
}

#[cfg(not(any(unix, windows)))]
fn sync_directory(_path: &Path) -> Result<(), String> {
    Ok(())
}

#[cfg(unix)]
fn set_private_directory_permissions(path: &Path) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt as _;
    fs::set_permissions(path, fs::Permissions::from_mode(0o700))
        .map_err(|error| format!("could not protect restore staging: {error}"))
}

#[cfg(not(unix))]
fn set_private_directory_permissions(_path: &Path) -> Result<(), String> {
    Ok(())
}

#[cfg(unix)]
fn set_private_file_permissions(path: &Path) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt as _;
    fs::set_permissions(path, fs::Permissions::from_mode(0o600))
        .map_err(|error| format!("could not protect restore progress: {error}"))
}

#[cfg(not(unix))]
fn set_private_file_permissions(_path: &Path) -> Result<(), String> {
    Ok(())
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

#[cfg(test)]
mod tests {
    use oleafly_history::{
        CaptureInput, CompileEvidence, ContentHash, PublishOutcome, SnapshotRoot, Store,
    };
    use std::fs;

    use super::{
        checkpoint_keep_latest_sync, checkpoint_list_sync, checkpoint_reset_sync,
        checkpoint_set_label_sync, checkpoint_stats_sync, restore_checkpoint_sync, CheckpointStats,
        CheckpointStoreInspection, RestoreFault,
    };

    fn isolated_project_dir(data_dir: &std::path::Path, project_id: &str) -> std::path::PathBuf {
        let project = crate::paths::create_project_dir(project_id).unwrap();
        assert!(
            project.starts_with(data_dir.canonicalize().unwrap()),
            "the project directory resolved outside the test data directory, \
             which means an unsynchronized environment mutation raced this test"
        );
        project
    }

    fn publish(store: &Store, project: &std::path::Path, source: &[u8], time: i64) -> SnapshotRoot {
        fs::write(project.join("main.tex"), source).unwrap();
        let inputs = [
            CaptureInput::explicit("project.json").unwrap(),
            CaptureInput::explicit("main.tex").unwrap(),
        ];
        let candidate = store.stage_candidate(project, &inputs).unwrap();
        let root = *candidate.snapshot_root();
        let evidence = CompileEvidence::new(
            "xetex",
            "tectonic-test@1",
            "main.tex",
            ContentHash::digest(b"validated output"),
            time,
        )
        .unwrap();
        assert!(matches!(
            store.publish(candidate, evidence).unwrap(),
            PublishOutcome::Created(_)
        ));
        root
    }

    #[test]
    fn checkpoint_labels_are_saved_cleared_and_bounded() {
        let _env_guard = crate::paths::data_dir_env_lock();
        let directory = tempfile::tempdir().unwrap();
        std::env::set_var("OLEAFLY_DATA_DIR", directory.path());
        let project = isolated_project_dir(directory.path(), "paper");
        fs::write(
            project.join("project.json"),
            br#"{"name":"Paper","main_doc":"main.tex","engine":"xetex"}"#,
        )
        .unwrap();
        let store = Store::open(crate::paths::checkpoint_store_dir("paper").unwrap()).unwrap();
        let root = publish(&store, &project, b"checkpoint source", 10).to_string();
        drop(store);

        assert!(checkpoint_list_sync("paper").unwrap()[0].label.is_none());

        let saved = checkpoint_set_label_sync("paper", &root, "  Submission draft  ").unwrap();
        assert_eq!(saved.label.as_deref(), Some("Submission draft"));
        assert_eq!(
            checkpoint_list_sync("paper").unwrap()[0].label.as_deref(),
            Some("Submission draft")
        );

        assert_eq!(
            checkpoint_set_label_sync("paper", &root, &"e".repeat(81)).unwrap_err(),
            "A Checkpoint label can be up to 80 characters on one line."
        );
        assert!(checkpoint_set_label_sync("paper", &root, "")
            .unwrap()
            .label
            .is_none());

        let absent = ContentHash::digest(b"absent").to_string();
        assert_eq!(
            checkpoint_set_label_sync("paper", &absent, "Anything").unwrap_err(),
            "The selected Checkpoint no longer exists."
        );

        std::env::remove_var("OLEAFLY_DATA_DIR");
    }

    #[test]
    fn missing_store_listing_and_stats_are_lazy() {
        let _env_guard = crate::paths::data_dir_env_lock();
        let directory = tempfile::tempdir().unwrap();
        std::env::set_var("OLEAFLY_DATA_DIR", directory.path());
        let project = crate::paths::create_project_dir("paper").unwrap();
        fs::write(project.join("project.json"), br#"{"name":"Paper"}"#).unwrap();

        assert!(checkpoint_list_sync("paper").unwrap().is_empty());
        assert_eq!(
            checkpoint_stats_sync("paper").unwrap(),
            CheckpointStats::default()
        );
        assert!(!directory.path().join("checkpoints").exists());

        std::env::remove_var("OLEAFLY_DATA_DIR");
    }

    #[cfg(unix)]
    #[test]
    fn unrelated_checkpoint_storage_fault_does_not_block_project_metadata() {
        use std::os::unix::fs::symlink;

        let _env_guard = crate::paths::data_dir_env_lock();
        let directory = tempfile::tempdir().unwrap();
        std::env::set_var("OLEAFLY_DATA_DIR", directory.path());
        let project = crate::paths::create_project_dir("paper").unwrap();
        fs::write(project.join("project.json"), br#"{"name":"Paper"}"#).unwrap();
        let outside = directory.path().join("outside");
        fs::create_dir(&outside).unwrap();
        symlink(&outside, directory.path().join("checkpoints")).unwrap();

        assert_eq!(crate::project::read_meta("paper").unwrap().name, "Paper");
        assert!(crate::paths::existing_checkpoint_store_dir("paper").is_err());

        std::env::remove_var("OLEAFLY_DATA_DIR");
    }

    #[test]
    fn restore_replaces_sources_preserves_internal_roots_and_keeps_history_unchanged() {
        let _env_guard = crate::paths::data_dir_env_lock();
        let directory = tempfile::tempdir().unwrap();
        std::env::set_var("OLEAFLY_DATA_DIR", directory.path());
        let project = isolated_project_dir(directory.path(), "paper");
        fs::write(
            project.join("project.json"),
            br#"{"name":"Paper","main_doc":"main.tex","engine":"xetex"}"#,
        )
        .unwrap();
        let store = Store::open(crate::paths::checkpoint_store_dir("paper").unwrap()).unwrap();
        let root = publish(&store, &project, b"checkpoint source", 10);
        fs::write(project.join("main.tex"), b"new source").unwrap();
        fs::write(project.join("untracked.txt"), b"preserve me").unwrap();
        fs::create_dir(project.join(".git")).unwrap();
        fs::write(project.join(".git/config"), b"git bytes").unwrap();
        fs::create_dir(project.join(".oleafly")).unwrap();
        fs::write(project.join(".oleafly/state"), b"internal bytes").unwrap();
        let before = store.list().unwrap();

        restore_checkpoint_sync(&store, &root, &project, RestoreFault::None).unwrap();

        assert_eq!(
            fs::read(project.join("main.tex")).unwrap(),
            b"checkpoint source"
        );
        assert_eq!(
            fs::read(project.join("untracked.txt")).unwrap(),
            b"preserve me"
        );
        assert_eq!(fs::read(project.join(".git/config")).unwrap(), b"git bytes");
        assert_eq!(
            fs::read(project.join(".oleafly/state")).unwrap(),
            b"internal bytes"
        );
        assert_eq!(store.list().unwrap(), before);
        assert!(!store.root().join(super::RESTORE_TRANSACTION).exists());

        std::env::remove_var("OLEAFLY_DATA_DIR");
    }

    #[test]
    fn restore_rejects_checkpoint_row_and_materialized_metadata_mismatches_before_mutation() {
        let _env_guard = crate::paths::data_dir_env_lock();
        let directory = tempfile::tempdir().unwrap();
        std::env::set_var("OLEAFLY_DATA_DIR", directory.path());
        let project = crate::paths::create_project_dir("paper").unwrap();
        fs::write(
            project.join("project.json"),
            br#"{"name":"Paper","main_doc":"main.tex","engine":"xetex"}"#,
        )
        .unwrap();
        let store = Store::open(crate::paths::checkpoint_store_dir("paper").unwrap()).unwrap();
        let root = publish(&store, &project, b"checkpoint source", 10);
        fs::write(project.join("main.tex"), b"current source").unwrap();
        let current_meta = br#"{"name":"Current","main_doc":"main.tex","engine":"xetex"}"#;
        fs::write(project.join("project.json"), current_meta).unwrap();

        let catalog = rusqlite::Connection::open(store.root().join("catalog.sqlite3")).unwrap();
        catalog
            .execute(
                "UPDATE checkpoints SET engine = 'typst' WHERE snapshot_root = ?1",
                [root.to_string()],
            )
            .unwrap();
        let engine_error =
            restore_checkpoint_sync(&store, &root, &project, RestoreFault::None).unwrap_err();
        assert!(engine_error.contains("recorded engine"));
        assert_eq!(
            fs::read(project.join("project.json")).unwrap(),
            current_meta
        );
        assert_eq!(
            fs::read(project.join("main.tex")).unwrap(),
            b"current source"
        );
        assert!(!super::has_restore_pending_marker(&project));

        catalog
            .execute(
                "UPDATE checkpoints SET engine = 'xetex', main_document = 'other.tex' WHERE snapshot_root = ?1",
                [root.to_string()],
            )
            .unwrap();
        let main_error =
            restore_checkpoint_sync(&store, &root, &project, RestoreFault::None).unwrap_err();
        assert!(main_error.contains("recorded main document"));
        assert_eq!(
            fs::read(project.join("project.json")).unwrap(),
            current_meta
        );
        assert_eq!(
            fs::read(project.join("main.tex")).unwrap(),
            b"current source"
        );
        assert!(!store.root().join(super::RESTORE_TRANSACTION).exists());
        assert!(!super::has_restore_pending_marker(&project));

        std::env::remove_var("OLEAFLY_DATA_DIR");
    }

    #[test]
    fn restore_payload_requires_valid_supported_metadata_and_its_main_document() {
        let directory = tempfile::tempdir().unwrap();
        let incoming = directory.path().join("incoming");
        fs::create_dir(&incoming).unwrap();
        fs::write(incoming.join("main.tex"), b"source").unwrap();

        fs::write(incoming.join("project.json"), b"not json").unwrap();
        assert!(super::validate_restore_payload(&incoming)
            .unwrap_err()
            .contains("invalid project metadata"));

        fs::write(
            incoming.join("project.json"),
            br#"{"main_doc":"missing.tex","engine":"latex"}"#,
        )
        .unwrap();
        assert!(super::validate_restore_payload(&incoming)
            .unwrap_err()
            .contains("does not contain its main document"));

        fs::write(
            incoming.join("project.json"),
            br#"{"main_doc":"main.tex","engine":"typst"}"#,
        )
        .unwrap();
        assert!(super::validate_restore_payload(&incoming)
            .unwrap_err()
            .contains("unsupported document engine"));

        fs::write(
            incoming.join("project.json"),
            br#"{"main_doc":"main.tex","engine":"latex"}"#,
        )
        .unwrap();
        assert_eq!(
            super::validate_restore_payload(&incoming).unwrap(),
            vec!["main.tex", "project.json"]
        );
    }

    #[test]
    fn restore_rolls_back_an_install_failure() {
        let _env_guard = crate::paths::data_dir_env_lock();
        let directory = tempfile::tempdir().unwrap();
        std::env::set_var("OLEAFLY_DATA_DIR", directory.path());
        let project = crate::paths::create_project_dir("paper").unwrap();
        fs::write(project.join("project.json"), br#"{"name":"Original"}"#).unwrap();
        let store = Store::open(crate::paths::checkpoint_store_dir("paper").unwrap()).unwrap();
        let root = publish(&store, &project, b"checkpoint source", 10);
        fs::write(project.join("project.json"), br#"{"name":"Current"}"#).unwrap();
        fs::write(project.join("main.tex"), b"current source").unwrap();
        fs::write(project.join("notes.txt"), b"current notes").unwrap();

        let error =
            restore_checkpoint_sync(&store, &root, &project, RestoreFault::AfterFirstInstall)
                .unwrap_err();

        assert!(error.contains("injected restore failure"));
        assert_eq!(
            fs::read(project.join("project.json")).unwrap(),
            br#"{"name":"Current"}"#
        );
        assert_eq!(
            fs::read(project.join("main.tex")).unwrap(),
            b"current source"
        );
        assert_eq!(
            fs::read(project.join("notes.txt")).unwrap(),
            b"current notes"
        );
        assert!(!store.root().join(super::RESTORE_TRANSACTION).exists());

        std::env::remove_var("OLEAFLY_DATA_DIR");
    }

    #[test]
    fn nested_backup_directory_must_be_durable_before_source_removal() {
        let _env_guard = crate::paths::data_dir_env_lock();
        let directory = tempfile::tempdir().unwrap();
        std::env::set_var("OLEAFLY_DATA_DIR", directory.path());
        let project = crate::paths::create_project_dir("paper").unwrap();
        fs::create_dir(project.join("chapters")).unwrap();
        fs::write(
            project.join("project.json"),
            br#"{"name":"Paper","main_doc":"main.tex","engine":"xetex"}"#,
        )
        .unwrap();
        fs::write(project.join("main.tex"), b"checkpoint main").unwrap();
        fs::write(project.join("chapters/one.tex"), b"checkpoint chapter").unwrap();
        let store = Store::open(crate::paths::checkpoint_store_dir("paper").unwrap()).unwrap();
        let inputs = [
            CaptureInput::explicit("project.json").unwrap(),
            CaptureInput::explicit("main.tex").unwrap(),
            CaptureInput::explicit("chapters/one.tex").unwrap(),
        ];
        let candidate = store.stage_candidate(&project, &inputs).unwrap();
        let root = *candidate.snapshot_root();
        let evidence = CompileEvidence::new(
            "xetex",
            "tectonic-test@1",
            "main.tex",
            ContentHash::digest(b"validated output"),
            10,
        )
        .unwrap();
        assert!(matches!(
            store.publish(candidate, evidence).unwrap(),
            PublishOutcome::Created(_)
        ));
        fs::write(project.join("main.tex"), b"current main").unwrap();
        fs::write(project.join("chapters/one.tex"), b"current chapter").unwrap();

        let error = restore_checkpoint_sync(
            &store,
            &root,
            &project,
            RestoreFault::DuringNestedBackupDirectorySync,
        )
        .unwrap_err();

        assert!(error.contains("injected restore directory durability failure"));
        assert_eq!(fs::read(project.join("main.tex")).unwrap(), b"current main");
        assert_eq!(
            fs::read(project.join("chapters/one.tex")).unwrap(),
            b"current chapter"
        );
        assert!(!store.root().join(super::RESTORE_TRANSACTION).exists());
        assert!(!super::has_restore_pending_marker(&project));

        std::env::remove_var("OLEAFLY_DATA_DIR");
    }

    fn assert_pre_marker_restore_crash_is_retried(fault: RestoreFault) {
        let _env_guard = crate::paths::data_dir_env_lock();
        let directory = tempfile::tempdir().unwrap();
        std::env::set_var("OLEAFLY_DATA_DIR", directory.path());
        let project = isolated_project_dir(directory.path(), "paper");
        let checkpoint_metadata = br#"{"name":"Paper","main_doc":"main.tex","engine":"xetex"}"#;
        fs::write(project.join("project.json"), checkpoint_metadata).unwrap();
        let store = Store::open(crate::paths::checkpoint_store_dir("paper").unwrap()).unwrap();
        let root = publish(&store, &project, b"checkpoint source", 10);
        let current_metadata = br#"{"name":"Current","main_doc":"main.tex","engine":"xetex"}"#;
        fs::write(project.join("project.json"), current_metadata).unwrap();
        fs::write(project.join("main.tex"), b"current source").unwrap();
        fs::write(project.join("untracked.txt"), b"preserve me").unwrap();
        fs::create_dir(project.join(".git")).unwrap();
        fs::write(project.join(".git/config"), b"git bytes").unwrap();
        fs::create_dir(project.join(".oleafly")).unwrap();
        fs::write(project.join(".oleafly/state"), b"internal bytes").unwrap();
        let before_history = store.list().unwrap();

        let error = restore_checkpoint_sync(&store, &root, &project, fault).unwrap_err();

        assert!(error.contains("injected restore crash"));
        assert_eq!(
            fs::read(project.join("project.json")).unwrap(),
            current_metadata
        );
        assert_eq!(
            fs::read(project.join("main.tex")).unwrap(),
            b"current source"
        );
        assert_eq!(
            fs::read(project.join("untracked.txt")).unwrap(),
            b"preserve me"
        );
        assert_eq!(fs::read(project.join(".git/config")).unwrap(), b"git bytes");
        assert_eq!(
            fs::read(project.join(".oleafly/state")).unwrap(),
            b"internal bytes"
        );
        assert_eq!(store.list().unwrap(), before_history);
        assert!(store.root().join(super::RESTORE_TRANSACTION).exists());
        assert!(!super::has_restore_pending_marker(&project));

        restore_checkpoint_sync(&store, &root, &project, RestoreFault::None).unwrap();

        assert_eq!(
            fs::read(project.join("project.json")).unwrap(),
            checkpoint_metadata
        );
        assert_eq!(
            fs::read(project.join("main.tex")).unwrap(),
            b"checkpoint source"
        );
        assert_eq!(
            fs::read(project.join("untracked.txt")).unwrap(),
            b"preserve me"
        );
        assert_eq!(fs::read(project.join(".git/config")).unwrap(), b"git bytes");
        assert_eq!(
            fs::read(project.join(".oleafly/state")).unwrap(),
            b"internal bytes"
        );
        assert_eq!(store.list().unwrap(), before_history);
        assert!(!store.root().join(super::RESTORE_TRANSACTION).exists());
        assert!(!super::has_restore_pending_marker(&project));

        std::env::remove_var("OLEAFLY_DATA_DIR");
    }

    #[test]
    fn restore_retries_after_a_crash_immediately_after_transaction_creation() {
        assert_pre_marker_restore_crash_is_retried(RestoreFault::CrashAfterTransactionCreation);
    }

    #[test]
    fn restore_retries_after_a_crash_during_materialization() {
        assert_pre_marker_restore_crash_is_retried(RestoreFault::CrashDuringMaterialization);
    }

    #[test]
    fn restore_retries_after_a_crash_during_plan_write() {
        assert_pre_marker_restore_crash_is_retried(RestoreFault::CrashDuringPlanWrite);
    }

    #[test]
    fn pending_restore_without_a_transaction_stays_fail_closed() {
        let _env_guard = crate::paths::data_dir_env_lock();
        let directory = tempfile::tempdir().unwrap();
        std::env::set_var("OLEAFLY_DATA_DIR", directory.path());
        let project = crate::paths::create_project_dir("paper").unwrap();
        fs::write(
            project.join("project.json"),
            br#"{"name":"Paper","main_doc":"main.tex","engine":"xetex"}"#,
        )
        .unwrap();
        fs::write(project.join("main.tex"), b"current source").unwrap();
        let store = Store::open(crate::paths::checkpoint_store_dir("paper").unwrap()).unwrap();
        drop(store);
        super::write_restore_pending_marker(&project.join(".oleafly")).unwrap();

        let error = super::recover_interrupted_restore_lock_held("paper").unwrap_err();

        assert!(error.contains("recovery data"));
        assert_eq!(
            fs::read(project.join("main.tex")).unwrap(),
            b"current source"
        );
        assert!(super::has_restore_pending_marker(&project));

        std::env::remove_var("OLEAFLY_DATA_DIR");
    }

    #[test]
    fn restore_markers_are_written_where_the_project_location_keeps_them() {
        let _env_guard = crate::paths::data_dir_env_lock();
        let data = tempfile::tempdir().unwrap();
        let folders = tempfile::tempdir().unwrap();
        std::env::set_var("OLEAFLY_DATA_DIR", data.path());
        let folder = folders.path().join("thesis");
        fs::create_dir(&folder).unwrap();
        let record = crate::linked_registry::register_folder_for_test(&folder);
        let linked = crate::project_location::locate(&record.id).unwrap();
        super::write_restore_pending_marker(&linked.private_state_dir()).unwrap();
        assert!(linked.restore_marker().is_file());
        assert!(crate::worktree_lock::pending_restore_marker_exists(&record.id).unwrap());
        assert!(!folder.join(".oleafly").exists());
        super::remove_restore_pending_marker(&linked.private_state_dir()).unwrap();
        assert!(!crate::worktree_lock::pending_restore_marker_exists(&record.id).unwrap());

        let project = crate::paths::create_project_dir("paper").unwrap();
        let library = crate::project_location::locate("paper").unwrap();
        super::write_restore_pending_marker(&library.private_state_dir()).unwrap();
        assert!(project
            .join(".oleafly")
            .join(crate::worktree_lock::RESTORE_PENDING_FILE)
            .is_file());
        assert!(super::has_restore_pending_marker(&project));
        std::env::remove_var("OLEAFLY_DATA_DIR");
    }

    #[test]
    fn a_linked_pending_restore_without_recovery_data_stays_fail_closed() {
        let _env_guard = crate::paths::data_dir_env_lock();
        let data = tempfile::tempdir().unwrap();
        let folders = tempfile::tempdir().unwrap();
        std::env::set_var("OLEAFLY_DATA_DIR", data.path());
        let folder = folders.path().join("thesis");
        fs::create_dir(&folder).unwrap();
        fs::write(folder.join("main.tex"), b"current source").unwrap();
        let record = crate::linked_registry::register_folder_for_test(&folder);
        let location = crate::project_location::locate(&record.id).unwrap();
        super::write_restore_pending_marker(&location.private_state_dir()).unwrap();

        let error = super::recover_interrupted_restore_lock_held(&record.id).unwrap_err();

        assert!(error.contains("recovery data"), "{error}");
        assert!(location.restore_marker().is_file());
        assert_eq!(
            fs::read(folder.join("main.tex")).unwrap(),
            b"current source"
        );
        assert!(!folder.join(".oleafly").exists());
        std::env::remove_var("OLEAFLY_DATA_DIR");
    }

    fn linked_project(
        folders: &std::path::Path,
    ) -> (crate::project_location::ProjectLocation, std::path::PathBuf) {
        let folder = folders.join("thesis");
        fs::create_dir(&folder).unwrap();
        let record = crate::linked_registry::register_folder_for_test(&folder);
        (
            crate::project_location::locate(&record.id).unwrap(),
            folder.canonicalize().unwrap(),
        )
    }

    fn write_linked_meta(project_id: &str, color: &str) {
        let mut meta = crate::project::read_meta(project_id).unwrap();
        meta.main_doc = "main.tex".into();
        meta.engine = "xetex".into();
        meta.color = color.into();
        crate::project::write_meta(project_id, &meta).unwrap();
    }

    fn publish_linked(
        store: &Store,
        location: &crate::project_location::ProjectLocation,
        source: &[u8],
        time: i64,
    ) -> SnapshotRoot {
        fs::write(location.root.join("main.tex"), source).unwrap();
        let capture = crate::checkpoint_capture::walk_linked_folder(
            &location.root,
            location.sidecar_manifest_path().as_deref(),
            &crate::checkpoint_capture::LinkedCapturePolicy::new(Default::default()),
        )
        .unwrap();
        let candidate = store
            .stage_detached_candidate(&location.root, &capture.capture_inputs().unwrap())
            .unwrap();
        let root = *candidate.snapshot_root();
        let evidence = CompileEvidence::new(
            "xetex",
            "tectonic-test@1",
            "main.tex",
            ContentHash::digest(b"validated output"),
            time,
        )
        .unwrap();
        store.publish(candidate, evidence).unwrap();
        root
    }

    fn linked_setup(
        folders: &std::path::Path,
    ) -> (
        crate::project_location::ProjectLocation,
        std::path::PathBuf,
        Store,
        SnapshotRoot,
    ) {
        let (location, folder) = linked_project(folders);
        fs::write(folder.join("project.json"), br#"{"name":"nx-app"}"#).unwrap();
        fs::create_dir(folder.join("chapters")).unwrap();
        fs::write(folder.join("chapters/one.tex"), b"chapter one").unwrap();
        write_linked_meta(&location.id, "#112233");
        let store = Store::open(crate::paths::checkpoint_store_dir(&location.id).unwrap()).unwrap();
        let root = publish_linked(&store, &location, b"checkpoint source", 10);
        (location, folder, store, root)
    }

    fn no_staging_files(folder: &std::path::Path) -> bool {
        fs::read_dir(folder).unwrap().all(|entry| {
            !entry
                .unwrap()
                .file_name()
                .to_string_lossy()
                .ends_with(".tmp")
        })
    }

    #[test]
    fn a_linked_restore_copies_files_back_and_writes_the_manifest_only_to_the_sidecar() {
        let _env_guard = crate::paths::data_dir_env_lock();
        let data = tempfile::tempdir().unwrap();
        let folders = tempfile::tempdir().unwrap();
        std::env::set_var("OLEAFLY_DATA_DIR", data.path());
        let (location, folder, store, root) = linked_setup(folders.path());
        let sidecar = location.sidecar_manifest_path().unwrap();
        let saved_sidecar = fs::read(&sidecar).unwrap();
        fs::write(folder.join("main.tex"), b"current source").unwrap();
        fs::write(folder.join("project.json"), br#"{"name":"nx-app","v":2}"#).unwrap();
        fs::remove_dir_all(folder.join("chapters")).unwrap();
        fs::write(folder.join("untracked.txt"), b"preserve me").unwrap();
        write_linked_meta(&location.id, "#445566");

        super::restore_linked_checkpoint_into(&store, &root, &location, RestoreFault::None)
            .unwrap();

        assert_eq!(
            fs::read(folder.join("main.tex")).unwrap(),
            b"checkpoint source"
        );
        assert_eq!(
            fs::read(folder.join("project.json")).unwrap(),
            br#"{"name":"nx-app"}"#
        );
        assert_eq!(
            fs::read(folder.join("chapters/one.tex")).unwrap(),
            b"chapter one"
        );
        assert_eq!(
            fs::read(folder.join("untracked.txt")).unwrap(),
            b"preserve me"
        );
        assert_eq!(fs::read(&sidecar).unwrap(), saved_sidecar);
        assert_eq!(
            crate::project::read_meta(&location.id).unwrap().color,
            "#112233"
        );
        assert!(!folder.join(".oleafly").exists());
        assert!(!folder
            .join(oleafly_history::DETACHED_MANIFEST_PATH)
            .exists());
        assert!(no_staging_files(&folder));
        assert!(!store.root().join(super::RESTORE_TRANSACTION).exists());
        assert!(!location.restore_marker().exists());
        std::env::remove_var("OLEAFLY_DATA_DIR");
    }

    #[test]
    fn a_linked_restore_never_renames_between_the_store_and_the_folder() {
        let _env_guard = crate::paths::data_dir_env_lock();
        let data = tempfile::tempdir().unwrap();
        let folders = tempfile::tempdir().unwrap();
        std::env::set_var("OLEAFLY_DATA_DIR", data.path());
        let (location, folder, store, root) = linked_setup(folders.path());
        fs::write(folder.join("main.tex"), b"current source").unwrap();
        {
            let _boundary = super::forbid_renames_across(&folder);
            super::restore_linked_checkpoint_into(&store, &root, &location, RestoreFault::None)
                .unwrap();
        }
        assert_eq!(
            fs::read(folder.join("main.tex")).unwrap(),
            b"checkpoint source"
        );

        let project = crate::paths::create_project_dir("paper").unwrap();
        fs::write(
            project.join("project.json"),
            br#"{"name":"Paper","main_doc":"main.tex","engine":"xetex"}"#,
        )
        .unwrap();
        let library_store =
            Store::open(crate::paths::checkpoint_store_dir("paper").unwrap()).unwrap();
        let library_root = publish(&library_store, &project, b"library source", 10);
        fs::write(project.join("main.tex"), b"library edit").unwrap();
        let _boundary = super::forbid_renames_across(&project);
        let error =
            restore_checkpoint_sync(&library_store, &library_root, &project, RestoreFault::None)
                .unwrap_err();
        assert!(error.contains("cross-device"), "{error}");
        assert_eq!(fs::read(project.join("main.tex")).unwrap(), b"library edit");
        std::env::remove_var("OLEAFLY_DATA_DIR");
    }

    #[test]
    fn a_linked_restore_rolls_back_a_failed_install_by_copy() {
        let _env_guard = crate::paths::data_dir_env_lock();
        let data = tempfile::tempdir().unwrap();
        let folders = tempfile::tempdir().unwrap();
        std::env::set_var("OLEAFLY_DATA_DIR", data.path());
        let (location, folder, store, root) = linked_setup(folders.path());
        fs::write(folder.join("main.tex"), b"current source").unwrap();
        fs::remove_dir_all(folder.join("chapters")).unwrap();
        write_linked_meta(&location.id, "#445566");
        let sidecar = location.sidecar_manifest_path().unwrap();
        let current_sidecar = fs::read(&sidecar).unwrap();

        let error = super::restore_linked_checkpoint_into(
            &store,
            &root,
            &location,
            RestoreFault::AfterFirstInstall,
        )
        .unwrap_err();

        assert!(error.contains("injected restore failure"), "{error}");
        assert!(!folder.join("chapters").exists());
        assert_eq!(
            fs::read(folder.join("main.tex")).unwrap(),
            b"current source"
        );
        assert_eq!(fs::read(&sidecar).unwrap(), current_sidecar);
        assert!(no_staging_files(&folder));
        assert!(!location.restore_marker().exists());
        assert!(!store.root().join(super::RESTORE_TRANSACTION).exists());
        std::env::remove_var("OLEAFLY_DATA_DIR");
    }

    #[test]
    fn a_linked_restore_interrupted_mid_install_rolls_back_on_recovery() {
        let _env_guard = crate::paths::data_dir_env_lock();
        let data = tempfile::tempdir().unwrap();
        let folders = tempfile::tempdir().unwrap();
        std::env::set_var("OLEAFLY_DATA_DIR", data.path());
        let (location, folder, store, root) = linked_setup(folders.path());
        fs::write(folder.join("main.tex"), b"current source").unwrap();
        fs::remove_dir_all(folder.join("chapters")).unwrap();

        let error = super::restore_linked_checkpoint_into(
            &store,
            &root,
            &location,
            RestoreFault::CrashDuringInstall,
        )
        .unwrap_err();

        assert!(error.contains("injected restore crash"), "{error}");
        assert!(location.restore_marker().is_file());
        assert!(folder.join("chapters/one.tex").is_file());
        assert!(crate::worktree_lock::ProjectWorktreeLock::shared(&location.id).is_err());
        assert!(super::recover_interrupted_restore_lock_held(&location.id).unwrap());
        assert!(!folder.join("chapters").exists());
        assert_eq!(
            fs::read(folder.join("main.tex")).unwrap(),
            b"current source"
        );
        assert!(!location.restore_marker().exists());
        assert!(!folder.join(".oleafly").exists());
        crate::worktree_lock::ProjectWorktreeLock::shared(&location.id).unwrap();
        std::env::remove_var("OLEAFLY_DATA_DIR");
    }

    #[test]
    fn a_library_checkpoint_is_refused_for_a_folder_opened_in_place() {
        let _env_guard = crate::paths::data_dir_env_lock();
        let data = tempfile::tempdir().unwrap();
        let folders = tempfile::tempdir().unwrap();
        std::env::set_var("OLEAFLY_DATA_DIR", data.path());
        let (location, folder) = linked_project(folders.path());
        fs::write(
            folder.join("project.json"),
            br#"{"name":"Thesis","main_doc":"main.tex","engine":"xetex"}"#,
        )
        .unwrap();
        let store = Store::open(crate::paths::checkpoint_store_dir(&location.id).unwrap()).unwrap();
        let root = publish(&store, &location.root, b"checkpoint source", 10);
        fs::write(folder.join("main.tex"), b"current").unwrap();
        let before = crate::linked_registry::folder_snapshot_for_test(&folder);

        let error =
            super::restore_linked_checkpoint_into(&store, &root, &location, RestoreFault::None)
                .unwrap_err();

        assert!(
            error.contains("checkpoint.library_history_for_folder"),
            "{error}"
        );
        assert_eq!(
            crate::linked_registry::folder_snapshot_for_test(&folder),
            before
        );
        assert!(!location.restore_marker().exists());
        assert!(!store.root().join(super::RESTORE_TRANSACTION).exists());
        std::env::remove_var("OLEAFLY_DATA_DIR");
    }

    #[test]
    fn a_folder_checkpoint_is_refused_for_a_library_project() {
        let _env_guard = crate::paths::data_dir_env_lock();
        let data = tempfile::tempdir().unwrap();
        std::env::set_var("OLEAFLY_DATA_DIR", data.path());
        let project = crate::paths::create_project_dir("paper").unwrap();
        fs::write(
            project.join("project.json"),
            br#"{"name":"Paper","main_doc":"main.tex","engine":"xetex"}"#,
        )
        .unwrap();
        fs::write(project.join("main.tex"), b"checkpoint source").unwrap();
        let store = Store::open(crate::paths::checkpoint_store_dir("paper").unwrap()).unwrap();
        let inputs = [
            CaptureInput::explicit("project.json").unwrap(),
            CaptureInput::explicit("main.tex").unwrap(),
        ];
        let candidate = store.stage_detached_candidate(&project, &inputs).unwrap();
        let root = *candidate.snapshot_root();
        let evidence = CompileEvidence::new(
            "xetex",
            "tectonic-test@1",
            "main.tex",
            ContentHash::digest(b"validated output"),
            10,
        )
        .unwrap();
        store.publish(candidate, evidence).unwrap();
        fs::write(project.join("main.tex"), b"current").unwrap();

        let error =
            restore_checkpoint_sync(&store, &root, &project, RestoreFault::None).unwrap_err();

        assert!(
            error.contains("checkpoint.folder_history_for_library"),
            "{error}"
        );
        assert_eq!(fs::read(project.join("main.tex")).unwrap(), b"current");
        assert!(!super::has_restore_pending_marker(&project));
        std::env::remove_var("OLEAFLY_DATA_DIR");
    }

    #[test]
    fn linked_folder_settings_only_need_to_parse_to_be_restored() {
        let _env_guard = crate::paths::data_dir_env_lock();
        let data = tempfile::tempdir().unwrap();
        let folders = tempfile::tempdir().unwrap();
        std::env::set_var("OLEAFLY_DATA_DIR", data.path());
        let (location, folder) = linked_project(folders.path());
        let sidecar = location.sidecar_manifest_path().unwrap();
        fs::write(
            &sidecar,
            br#"{"name":"Thesis","main_doc":"paper.tex","engine":"latexmk"}"#,
        )
        .unwrap();
        let store = Store::open(crate::paths::checkpoint_store_dir(&location.id).unwrap()).unwrap();
        let root = publish_linked(&store, &location, b"checkpoint source", 10);
        fs::write(folder.join("main.tex"), b"current").unwrap();
        super::restore_linked_checkpoint_into(&store, &root, &location, RestoreFault::None)
            .unwrap();
        assert_eq!(
            fs::read(folder.join("main.tex")).unwrap(),
            b"checkpoint source"
        );

        fs::write(&sidecar, b"not json").unwrap();
        let broken = publish_linked(&store, &location, b"broken settings", 20);
        fs::write(&sidecar, br#"{"name":"Thesis","main_doc":"main.tex"}"#).unwrap();
        fs::write(folder.join("main.tex"), b"current").unwrap();
        let error =
            super::restore_linked_checkpoint_into(&store, &broken, &location, RestoreFault::None)
                .unwrap_err();
        assert!(error.contains("invalid project metadata"), "{error}");
        assert_eq!(fs::read(folder.join("main.tex")).unwrap(), b"current");
        assert!(!location.restore_marker().exists());
        std::env::remove_var("OLEAFLY_DATA_DIR");
    }

    #[cfg(unix)]
    #[test]
    fn a_link_in_the_way_stops_a_linked_restore_before_anything_changes() {
        let _env_guard = crate::paths::data_dir_env_lock();
        let data = tempfile::tempdir().unwrap();
        let folders = tempfile::tempdir().unwrap();
        std::env::set_var("OLEAFLY_DATA_DIR", data.path());
        let (location, folder, store, root) = linked_setup(folders.path());
        let outside = folders.path().join("outside.tex");
        fs::write(&outside, b"outside").unwrap();
        fs::remove_file(folder.join("main.tex")).unwrap();
        std::os::unix::fs::symlink(&outside, folder.join("main.tex")).unwrap();

        let error =
            super::restore_linked_checkpoint_into(&store, &root, &location, RestoreFault::None)
                .unwrap_err();

        assert!(error.contains("checkpoint.restore_path_blocked"), "{error}");
        assert!(fs::symlink_metadata(folder.join("main.tex"))
            .unwrap()
            .file_type()
            .is_symlink());
        assert_eq!(fs::read(&outside).unwrap(), b"outside");
        assert!(!location.restore_marker().exists());
        std::env::remove_var("OLEAFLY_DATA_DIR");
    }

    #[test]
    fn linked_checkpoint_files_mark_the_folder_settings_entry() {
        let _env_guard = crate::paths::data_dir_env_lock();
        let data = tempfile::tempdir().unwrap();
        let folders = tempfile::tempdir().unwrap();
        std::env::set_var("OLEAFLY_DATA_DIR", data.path());
        let (location, _folder, store, root) = linked_setup(folders.path());
        drop(store);
        let files = super::checkpoint_files_sync(&location.id, &root.to_string()).unwrap();
        assert_eq!(
            files
                .iter()
                .filter(|file| file.folder_settings)
                .map(|file| file.path.as_str())
                .collect::<Vec<_>>(),
            vec![oleafly_history::DETACHED_MANIFEST_PATH]
        );
        let main = files.iter().find(|file| file.path == "main.tex").unwrap();
        assert_eq!(
            serde_json::to_value(main).unwrap().get("folder_settings"),
            None
        );
        let settings = files.iter().find(|file| file.folder_settings).unwrap();
        assert_eq!(
            serde_json::to_value(settings).unwrap()["folder_settings"],
            serde_json::json!(true)
        );
        std::env::remove_var("OLEAFLY_DATA_DIR");
    }

    #[test]
    fn only_linked_stats_carry_the_capture_notice() {
        let _env_guard = crate::paths::data_dir_env_lock();
        let data = tempfile::tempdir().unwrap();
        let folders = tempfile::tempdir().unwrap();
        std::env::set_var("OLEAFLY_DATA_DIR", data.path());
        let (location, _folder) = linked_project(folders.path());
        let notice = crate::checkpoint_capture::CaptureNotice {
            paused: None,
            skipped: crate::checkpoint_capture::SkippedFiles {
                links: 2,
                ..Default::default()
            },
        };
        crate::checkpoint_capture::record_capture_notice(&location, &notice);
        assert_eq!(
            checkpoint_stats_sync(&location.id).unwrap().capture,
            Some(notice.clone())
        );
        crate::checkpoint_capture::record_capture_notice(&location, &Default::default());
        assert_eq!(checkpoint_stats_sync(&location.id).unwrap().capture, None);

        let project = crate::paths::create_project_dir("paper").unwrap();
        fs::write(project.join("project.json"), br#"{"name":"Paper"}"#).unwrap();
        let library = crate::project_location::locate("paper").unwrap();
        crate::checkpoint_capture::record_capture_notice(&library, &notice);
        assert!(!project.join(".oleafly").exists());
        let stats = checkpoint_stats_sync("paper").unwrap();
        assert_eq!(stats, CheckpointStats::default());
        assert!(serde_json::to_value(stats)
            .unwrap()
            .get("capture")
            .is_none());
        std::env::remove_var("OLEAFLY_DATA_DIR");
    }

    #[test]
    fn checkpoint_error_codes_exist_in_the_english_catalog() {
        let catalog: serde_json::Value =
            serde_json::from_str(include_str!("../../src/i18n/locales/en/errors.json")).unwrap();
        for code in [
            "checkpoint.library_history_for_folder",
            "checkpoint.folder_history_for_library",
            "checkpoint.restore_path_blocked",
        ] {
            let (namespace, key) = code.split_once('.').unwrap();
            assert!(catalog[namespace][key].is_string(), "{code}");
        }
    }

    #[test]
    fn a_linked_restore_rolls_back_and_recovers_with_its_marker_outside_the_folder() {
        let _env_guard = crate::paths::data_dir_env_lock();
        let data = tempfile::tempdir().unwrap();
        let folders = tempfile::tempdir().unwrap();
        std::env::set_var("OLEAFLY_DATA_DIR", data.path());
        let (location, folder) = linked_project(folders.path());
        write_linked_meta(&location.id, "#112233");
        let store = Store::open(crate::paths::checkpoint_store_dir(&location.id).unwrap()).unwrap();
        let root = publish_linked(&store, &location, b"checkpoint source", 10);
        fs::write(folder.join("main.tex"), b"current source").unwrap();

        let error = super::restore_linked_checkpoint_into(
            &store,
            &root,
            &location,
            RestoreFault::CrashAfterRollbackTransactionCleanup,
        )
        .unwrap_err();

        assert!(error.contains("injected restore crash"), "{error}");
        assert!(location.restore_marker().is_file());
        assert!(!folder.join(".oleafly").exists());
        assert!(crate::worktree_lock::ProjectWorktreeLock::shared(&location.id).is_err());

        assert!(super::recover_interrupted_restore_lock_held(&location.id).unwrap());
        assert_eq!(
            fs::read(folder.join("main.tex")).unwrap(),
            b"current source"
        );
        assert!(!location.restore_marker().exists());
        assert!(!folder.join(".oleafly").exists());
        crate::worktree_lock::ProjectWorktreeLock::shared(&location.id).unwrap();
        std::env::remove_var("OLEAFLY_DATA_DIR");
    }

    #[test]
    fn terminal_sidecar_recovers_a_successful_restore_after_transaction_cleanup() {
        let _env_guard = crate::paths::data_dir_env_lock();
        let directory = tempfile::tempdir().unwrap();
        std::env::set_var("OLEAFLY_DATA_DIR", directory.path());
        let project = crate::paths::create_project_dir("paper").unwrap();
        fs::write(
            project.join("project.json"),
            br#"{"name":"Paper","main_doc":"main.tex","engine":"xetex"}"#,
        )
        .unwrap();
        let store = Store::open(crate::paths::checkpoint_store_dir("paper").unwrap()).unwrap();
        let root = publish(&store, &project, b"checkpoint source", 10);
        fs::write(project.join("main.tex"), b"current source").unwrap();

        let error = restore_checkpoint_sync(
            &store,
            &root,
            &project,
            RestoreFault::CrashAfterSuccessfulTransactionCleanup,
        )
        .unwrap_err();

        assert!(error.contains("injected restore crash"));
        assert_eq!(
            fs::read(project.join("main.tex")).unwrap(),
            b"checkpoint source"
        );
        assert!(!store.root().join(super::RESTORE_TRANSACTION).exists());
        assert!(store.root().join(super::RESTORE_TERMINAL_FILE).exists());
        assert!(super::has_restore_pending_marker(&project));

        assert!(super::recover_interrupted_restore_lock_held("paper").unwrap());
        assert_eq!(
            fs::read(project.join("main.tex")).unwrap(),
            b"checkpoint source"
        );
        assert!(!store.root().join(super::RESTORE_TERMINAL_FILE).exists());
        assert!(!super::has_restore_pending_marker(&project));

        std::env::remove_var("OLEAFLY_DATA_DIR");
    }

    #[test]
    fn terminal_sidecar_recovers_a_rollback_after_transaction_cleanup() {
        let _env_guard = crate::paths::data_dir_env_lock();
        let directory = tempfile::tempdir().unwrap();
        std::env::set_var("OLEAFLY_DATA_DIR", directory.path());
        let project = crate::paths::create_project_dir("paper").unwrap();
        fs::write(
            project.join("project.json"),
            br#"{"name":"Paper","main_doc":"main.tex","engine":"xetex"}"#,
        )
        .unwrap();
        let store = Store::open(crate::paths::checkpoint_store_dir("paper").unwrap()).unwrap();
        let root = publish(&store, &project, b"checkpoint source", 10);
        let current_metadata = br#"{"name":"Current","main_doc":"main.tex","engine":"xetex"}"#;
        fs::write(project.join("project.json"), current_metadata).unwrap();
        fs::write(project.join("main.tex"), b"current source").unwrap();

        let error = restore_checkpoint_sync(
            &store,
            &root,
            &project,
            RestoreFault::CrashAfterRollbackTransactionCleanup,
        )
        .unwrap_err();

        assert!(error.contains("injected restore crash"));
        assert_eq!(
            fs::read(project.join("project.json")).unwrap(),
            current_metadata
        );
        assert_eq!(
            fs::read(project.join("main.tex")).unwrap(),
            b"current source"
        );
        assert!(!store.root().join(super::RESTORE_TRANSACTION).exists());
        assert!(store.root().join(super::RESTORE_TERMINAL_FILE).exists());
        assert!(super::has_restore_pending_marker(&project));

        assert!(super::recover_interrupted_restore_lock_held("paper").unwrap());
        assert_eq!(
            fs::read(project.join("project.json")).unwrap(),
            current_metadata
        );
        assert_eq!(
            fs::read(project.join("main.tex")).unwrap(),
            b"current source"
        );
        assert!(!store.root().join(super::RESTORE_TERMINAL_FILE).exists());
        assert!(!super::has_restore_pending_marker(&project));

        std::env::remove_var("OLEAFLY_DATA_DIR");
    }

    #[test]
    fn next_restore_clears_a_terminal_sidecar_before_starting() {
        let _env_guard = crate::paths::data_dir_env_lock();
        let directory = tempfile::tempdir().unwrap();
        std::env::set_var("OLEAFLY_DATA_DIR", directory.path());
        let project = crate::paths::create_project_dir("paper").unwrap();
        fs::write(
            project.join("project.json"),
            br#"{"name":"Paper","main_doc":"main.tex","engine":"xetex"}"#,
        )
        .unwrap();
        let store = Store::open(crate::paths::checkpoint_store_dir("paper").unwrap()).unwrap();
        let root = publish(&store, &project, b"checkpoint source", 10);
        fs::write(project.join("main.tex"), b"current source").unwrap();

        let error = restore_checkpoint_sync(
            &store,
            &root,
            &project,
            RestoreFault::CrashAfterPendingMarkerCleanup,
        )
        .unwrap_err();

        assert!(error.contains("injected restore crash"));
        assert!(!super::has_restore_pending_marker(&project));
        assert!(!store.root().join(super::RESTORE_TRANSACTION).exists());
        assert!(store.root().join(super::RESTORE_TERMINAL_FILE).exists());

        fs::write(project.join("main.tex"), b"another current source").unwrap();
        restore_checkpoint_sync(&store, &root, &project, RestoreFault::None).unwrap();

        assert!(!store.root().join(super::RESTORE_TERMINAL_FILE).exists());
        assert!(!store.root().join(super::RESTORE_TRANSACTION).exists());
        assert!(!super::has_restore_pending_marker(&project));
        assert_eq!(
            fs::read(project.join("main.tex")).unwrap(),
            b"checkpoint source"
        );

        std::env::remove_var("OLEAFLY_DATA_DIR");
    }

    #[test]
    fn checkpoint_reset_preserves_a_pending_restore_journal() {
        let _env_guard = crate::paths::data_dir_env_lock();
        let directory = tempfile::tempdir().unwrap();
        std::env::set_var("OLEAFLY_DATA_DIR", directory.path());
        let project = crate::paths::create_project_dir("paper").unwrap();
        fs::write(
            project.join("project.json"),
            br#"{"name":"Paper","main_doc":"main.tex","engine":"xetex"}"#,
        )
        .unwrap();
        let store_path = crate::paths::checkpoint_store_dir("paper").unwrap();
        let store = Store::open(&store_path).unwrap();
        publish(&store, &project, b"checkpoint source", 10);
        let transaction = store.root().join(super::RESTORE_TRANSACTION);
        super::create_private_directory(&transaction).unwrap();
        fs::write(transaction.join("recovery-evidence"), b"keep me").unwrap();
        super::write_restore_pending_marker(&project.join(".oleafly")).unwrap();
        drop(store);

        let error = checkpoint_reset_sync("paper").unwrap_err();

        assert!(error.contains("recovery is pending"));
        assert!(store_path.exists());
        assert_eq!(
            fs::read(transaction.join("recovery-evidence")).unwrap(),
            b"keep me"
        );
        assert!(super::has_restore_pending_marker(&project));

        std::env::remove_var("OLEAFLY_DATA_DIR");
    }

    #[test]
    fn checkpoint_payloads_serialize_their_documented_field_names() {
        assert_eq!(
            serde_json::to_value(CheckpointStats::default()).unwrap(),
            serde_json::json!({
                "checkpoint_count": 0,
                "stored_pack_bytes": 0,
                "logical_bytes": 0,
                "reclaimable_bytes": 0
            })
        );
        assert_eq!(
            serde_json::to_value(CheckpointStoreInspection::default()).unwrap(),
            serde_json::json!({
                "store_path": null,
                "catalog_path": null,
                "catalog_bytes": 0,
                "format_version": 0,
                "lineage": null,
                "table_counts": {
                    "checkpoints": 0,
                    "manifests": 0,
                    "packs": 0,
                    "chunks": 0,
                    "manifest_chunks": 0
                },
                "packs": []
            })
        );
        assert_eq!(
            serde_json::to_value(super::CheckpointFileSummary {
                path: "main.tex".into(),
                bytes: 7,
                content_hash: "abc".into(),
                stored: true,
                folder_settings: false,
            })
            .unwrap(),
            serde_json::json!({
                "path": "main.tex",
                "bytes": 7,
                "content_hash": "abc",
                "stored": true
            })
        );
    }

    #[test]
    fn file_and_store_inspection_are_lazy_and_describe_the_recorded_manifest() {
        let _env_guard = crate::paths::data_dir_env_lock();
        let directory = tempfile::tempdir().unwrap();
        std::env::set_var("OLEAFLY_DATA_DIR", directory.path());
        let project = isolated_project_dir(directory.path(), "paper");
        fs::write(
            project.join("project.json"),
            br#"{"name":"Paper","main_doc":"main.tex","engine":"xetex"}"#,
        )
        .unwrap();

        assert_eq!(
            super::checkpoint_inspect_sync("paper").unwrap(),
            CheckpointStoreInspection::default()
        );
        assert!(super::checkpoint_inspect_sync("paper")
            .unwrap()
            .store_path
            .is_none());
        assert!(crate::paths::existing_checkpoint_store_dir("paper")
            .unwrap()
            .is_none());

        let store_path = crate::paths::checkpoint_store_dir("paper").unwrap();
        let store = Store::open(&store_path).unwrap();
        let root = publish(&store, &project, b"checkpoint source", 10);
        drop(store);

        let files = super::checkpoint_files_sync("paper", &root.to_string()).unwrap();
        assert_eq!(
            files
                .iter()
                .map(|file| (file.path.as_str(), file.stored))
                .collect::<Vec<_>>(),
            [("main.tex", true), ("project.json", true)]
        );
        assert_eq!(
            files[0].content_hash,
            ContentHash::digest(b"checkpoint source").to_string()
        );
        assert_eq!(files[0].bytes, b"checkpoint source".len() as u64);

        let inspection = super::checkpoint_inspect_sync("paper").unwrap();
        assert_eq!(
            inspection.store_path.as_deref(),
            Some(
                store_path
                    .canonicalize()
                    .unwrap()
                    .to_string_lossy()
                    .as_ref()
            )
        );
        assert!(inspection.catalog_path.is_some());
        assert!(inspection.catalog_bytes > 0);
        assert!(inspection.format_version > 0);
        assert!(inspection.lineage.is_some());
        assert_eq!(inspection.table_counts.checkpoints, 1);
        assert_eq!(inspection.table_counts.manifests, 1);
        assert_eq!(inspection.packs.len() as u64, inspection.table_counts.packs);
        assert!(inspection.packs.iter().all(|pack| pack.bytes > 0));

        assert!(super::checkpoint_files_sync("paper", "not-a-root").is_err());
        let missing = "0".repeat(64);
        assert!(super::checkpoint_files_sync("paper", &missing).is_err());

        std::env::remove_var("OLEAFLY_DATA_DIR");
    }

    #[test]
    fn revealing_the_store_requires_one_and_resolves_inside_the_data_root() {
        let _env_guard = crate::paths::data_dir_env_lock();
        let directory = tempfile::tempdir().unwrap();
        std::env::set_var("OLEAFLY_DATA_DIR", directory.path());
        let project = isolated_project_dir(directory.path(), "paper");
        fs::write(project.join("project.json"), br#"{"name":"Paper"}"#).unwrap();

        let error = super::existing_store_to_reveal("paper").unwrap_err();
        assert_eq!(error, "This project does not have any Checkpoints yet.");

        let store_path = crate::paths::checkpoint_store_dir("paper").unwrap();
        Store::open(&store_path).unwrap();
        let revealed = super::existing_store_to_reveal("paper").unwrap();
        assert_eq!(revealed, store_path.canonicalize().unwrap());
        assert!(revealed.starts_with(directory.path().canonicalize().unwrap()));

        assert!(super::existing_store_to_reveal("missing-project").is_err());

        std::env::remove_var("OLEAFLY_DATA_DIR");
    }

    #[test]
    fn retention_and_reset_reclaim_external_store_without_touching_sources() {
        let _env_guard = crate::paths::data_dir_env_lock();
        let directory = tempfile::tempdir().unwrap();
        std::env::set_var("OLEAFLY_DATA_DIR", directory.path());
        let project = crate::paths::create_project_dir("paper").unwrap();
        fs::write(project.join("project.json"), br#"{"name":"Paper"}"#).unwrap();
        let store_path = crate::paths::checkpoint_store_dir("paper").unwrap();
        let store = Store::open(&store_path).unwrap();
        publish(&store, &project, b"one", 10);
        publish(&store, &project, b"two", 20);
        drop(store);

        checkpoint_keep_latest_sync("paper").unwrap();
        assert_eq!(checkpoint_list_sync("paper").unwrap().len(), 1);
        assert_eq!(fs::read(project.join("main.tex")).unwrap(), b"two");
        checkpoint_reset_sync("paper").unwrap();
        assert!(!store_path.exists());
        assert_eq!(fs::read(project.join("main.tex")).unwrap(), b"two");

        std::env::remove_var("OLEAFLY_DATA_DIR");
    }

    #[test]
    fn metadata_reads_do_not_recover_and_project_open_uses_mutation_coordination() {
        let _env_guard = crate::paths::data_dir_env_lock();
        let directory = tempfile::tempdir().unwrap();
        std::env::set_var("OLEAFLY_DATA_DIR", directory.path());
        let project = crate::paths::create_project_dir("paper").unwrap();
        fs::write(project.join("project.json"), br#"{"name":"Paper"}"#).unwrap();
        fs::write(project.join("main.tex"), b"source").unwrap();
        let store = Store::open(crate::paths::checkpoint_store_dir("paper").unwrap()).unwrap();
        let transaction = store.root().join(super::RESTORE_TRANSACTION);
        super::create_private_directory(&transaction).unwrap();
        super::create_private_directory(&transaction.join(super::INCOMING_DIRECTORY)).unwrap();
        super::create_private_directory(&transaction.join(super::BACKUP_DIRECTORY)).unwrap();
        super::write_restore_plan(
            &transaction,
            &super::RestorePlan {
                files: vec!["project.json".into()],
                created_project_directories: Vec::new(),
            },
        )
        .unwrap();
        super::write_restore_pending_marker(&project.join(".oleafly")).unwrap();
        fs::rename(
            project.join("project.json"),
            transaction
                .join(super::BACKUP_DIRECTORY)
                .join("project.json"),
        )
        .unwrap();
        super::mark_phase(&transaction, super::PHASE_BACKING_UP).unwrap();

        assert_eq!(crate::project::read_meta("paper").unwrap().name, "paper");
        assert!(!project.join("project.json").exists());
        assert!(transaction.exists());
        assert!(super::has_restore_pending_marker(&project));
        let listed = crate::project::list_projects_blocking().unwrap();
        let pending = listed
            .iter()
            .find(|project| project.id == "paper")
            .expect("pending project remains discoverable");
        assert!(pending.recovery_pending);

        let (meta, recovered) = crate::project::recover_project_on_open_for_test("paper").unwrap();
        assert!(recovered);
        assert_eq!(meta.name, "Paper");
        assert_eq!(
            fs::read(project.join("project.json")).unwrap(),
            br#"{"name":"Paper"}"#
        );
        assert!(!transaction.exists());
        assert!(!super::has_restore_pending_marker(&project));

        let (_, recovered_again) =
            crate::project::recover_project_on_open_for_test("paper").unwrap();
        assert!(!recovered_again);

        std::env::remove_var("OLEAFLY_DATA_DIR");
    }
}
