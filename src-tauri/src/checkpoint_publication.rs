//! Durable Checkpoint publication outcome shared by compile IPC and the UI.

use oleafly_history::{Candidate, ContentHash};
use serde::Serialize;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use tauri::Emitter as _;

const OPERATION_LOCK_RETRY: std::time::Duration = std::time::Duration::from_millis(50);
const PUBLICATION_DRAIN_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(30);
const PUBLICATION_DRAIN_POLL: std::time::Duration = std::time::Duration::from_millis(50);
const PUBLICATION_START_DELAY: std::time::Duration = std::time::Duration::from_millis(1500);

/// The one publication failure a writer can act on.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum CheckpointSkipReason {
    StorageUnavailable,
}

/// Publication is supplementary to compilation. A skipped outcome never
/// changes an otherwise successful compile into a failure.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum CheckpointPublicationOutcome {
    Unchanged,
    Published {
        snapshot_root: String,
        created: bool,
    },
    PublishedDurabilityUncertain {
        snapshot_root: String,
        created: bool,
    },
    Failed,
    Skipped {
        reason: CheckpointSkipReason,
        message: String,
        suggestion: String,
    },
}

impl CheckpointPublicationOutcome {
    fn skipped(
        reason: CheckpointSkipReason,
        message: impl Into<String>,
        suggestion: impl Into<String>,
    ) -> Self {
        Self::Skipped {
            reason,
            message: message.into(),
            suggestion: suggestion.into(),
        }
    }
}

#[derive(Debug, Eq, PartialEq)]
struct AdapterFailure {
    reason: Option<CheckpointSkipReason>,
    detail: String,
}

impl AdapterFailure {
    fn silent(detail: impl Into<String>) -> Self {
        Self {
            reason: None,
            detail: detail.into(),
        }
    }
}

fn ensure_checkpoint_not_cancelled(
    cancel: Option<&crate::state::CompileCancel>,
) -> Result<(), AdapterFailure> {
    if cancel.is_some_and(crate::state::CompileCancel::is_requested) {
        return Err(AdapterFailure::silent(
            "checkpoint publication was cancelled",
        ));
    }
    Ok(())
}

struct CheckpointCancelScope<'a> {
    cancel: Option<&'a crate::state::CompileCancel>,
}

impl<'a> CheckpointCancelScope<'a> {
    fn new(cancel: Option<&'a crate::state::CompileCancel>) -> Self {
        if let Some(cancel) = cancel {
            cancel.begin();
        }
        Self { cancel }
    }
}

impl Drop for CheckpointCancelScope<'_> {
    fn drop(&mut self) {
        if let Some(cancel) = self.cancel {
            let _ = cancel.detach();
        }
    }
}

fn outcome_from_failure(failure: AdapterFailure) -> CheckpointPublicationOutcome {
    match failure.reason {
        None => CheckpointPublicationOutcome::Failed,
        Some(reason) => CheckpointPublicationOutcome::skipped(
            reason,
            "Checkpoint not saved. Checkpoint storage is full or not writable.",
            "Free some disk space or check folder permissions, then compile again.",
        ),
    }
}

fn newest_checkpoint_matches(
    project_id: &str,
    walk: &crate::checkpoint_capture::ProjectWalk,
) -> bool {
    let Ok(Some(store_path)) = crate::paths::existing_checkpoint_store_dir(project_id) else {
        return false;
    };
    let Ok(Some(store)) = oleafly_history::Store::open_existing(store_path) else {
        return false;
    };
    let Ok(Some(checkpoint)) = store.latest_checkpoint() else {
        return false;
    };
    let Ok(Some(files)) = store.checkpoint_files(&checkpoint.snapshot_root) else {
        return false;
    };
    walk.matches_checkpoint(&files)
}

fn history_failure(context: &str, error: oleafly_history::HistoryError) -> AdapterFailure {
    AdapterFailure {
        reason: storage_reason(&error),
        detail: format!("{context}: {error}"),
    }
}

fn storage_reason(error: &oleafly_history::HistoryError) -> Option<CheckpointSkipReason> {
    if let oleafly_history::HistoryError::Io(io) = error {
        if io.kind() == std::io::ErrorKind::PermissionDenied {
            return Some(CheckpointSkipReason::StorageUnavailable);
        }
    }
    let text = error.to_string().to_ascii_lowercase();
    let full_or_locked = text.contains("no space left")
        || text.contains("disk is full")
        || text.contains("not enough space")
        || text.contains("read-only file system")
        || text.contains("permission denied");
    full_or_locked.then_some(CheckpointSkipReason::StorageUnavailable)
}

#[derive(Clone)]
pub(crate) struct PublicationRequest {
    pub project_id: String,
    pub project_root: PathBuf,
    pub engine_name: String,
    pub main_document: String,
}

pub(crate) const PUBLICATION_EVENT: &str = "checkpoint:publication";

#[derive(Clone, Serialize)]
#[serde(tag = "phase", rename_all = "snake_case")]
enum PublicationPhase<'a> {
    Started,
    Finished {
        outcome: &'a CheckpointPublicationOutcome,
    },
}

#[derive(Clone, Serialize)]
struct PublicationEvent<'a> {
    project_id: &'a str,
    main_document: &'a str,
    #[serde(flatten)]
    phase: PublicationPhase<'a>,
}

#[derive(Default)]
struct PublicationLane {
    in_flight: Option<crate::state::CompileCancel>,
    successor: Option<PublicationRequest>,
}

struct PublicationRegistry {
    lanes: Mutex<HashMap<String, PublicationLane>>,
    idle: std::sync::Condvar,
}

fn publication_registry() -> &'static PublicationRegistry {
    static REGISTRY: OnceLock<PublicationRegistry> = OnceLock::new();
    REGISTRY.get_or_init(|| PublicationRegistry {
        lanes: Mutex::new(HashMap::new()),
        idle: std::sync::Condvar::new(),
    })
}

fn lock_publication_lanes() -> std::sync::MutexGuard<'static, HashMap<String, PublicationLane>> {
    publication_registry()
        .lanes
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn stop_in_flight_publication(lane: &mut PublicationLane) {
    if let Some(pid) = lane
        .in_flight
        .as_ref()
        .and_then(crate::state::CompileCancel::request)
    {
        tauri::async_runtime::spawn(crate::proc::terminate_process_tree(pid));
    }
}

fn admit_publication(
    request: PublicationRequest,
) -> Option<(PublicationRequest, crate::state::CompileCancel)> {
    let mut lanes = lock_publication_lanes();
    let lane = lanes.entry(request.project_id.clone()).or_default();
    if lane.in_flight.is_some() {
        stop_in_flight_publication(lane);
        lane.successor = Some(request);
        return None;
    }
    let cancel = crate::state::CompileCancel::default();
    cancel.begin();
    lane.in_flight = Some(cancel.clone());
    Some((request, cancel))
}

fn finish_publication(
    project_id: &str,
    finished: &crate::state::CompileCancel,
) -> Option<(PublicationRequest, crate::state::CompileCancel)> {
    let registry = publication_registry();
    let mut lanes = registry
        .lanes
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let _ = finished.detach();
    let next = lanes.get_mut(project_id).and_then(|lane| {
        lane.successor.take().map(|request| {
            let cancel = crate::state::CompileCancel::default();
            cancel.begin();
            lane.in_flight = Some(cancel.clone());
            (request, cancel)
        })
    });
    if next.is_none() {
        lanes.remove(project_id);
        registry.idle.notify_all();
    }
    next
}

#[cfg(test)]
fn lane_successor_document(project_id: &str) -> Option<String> {
    lock_publication_lanes()
        .get(project_id)
        .and_then(|lane| lane.successor.as_ref())
        .map(|request| request.main_document.clone())
}

fn request_publication_cancel(
    lanes: &mut HashMap<String, PublicationLane>,
    project_id: &str,
) -> bool {
    let Some(lane) = lanes.get_mut(project_id) else {
        return false;
    };
    lane.successor = None;
    stop_in_flight_publication(lane);
    true
}

/// Stops the in-flight background publication for a project and drops its
/// successor. Worktree mutations and store deletions call this first so they
/// never wait behind supplementary work.
pub(crate) fn cancel_project_publications(project_id: &str) {
    let mut lanes = lock_publication_lanes();
    request_publication_cancel(&mut lanes, project_id);
}

/// Cancels like [`cancel_project_publications`] and then waits, bounded, for
/// the lane to drain so a store deletion cannot race a late publication.
pub(crate) fn cancel_project_publications_and_wait(project_id: &str) {
    let registry = publication_registry();
    let deadline = std::time::Instant::now() + PUBLICATION_DRAIN_TIMEOUT;
    let mut lanes = registry
        .lanes
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    while request_publication_cancel(&mut lanes, project_id) {
        let now = std::time::Instant::now();
        if now >= deadline {
            return;
        }
        lanes = registry
            .idle
            .wait_timeout(lanes, (deadline - now).min(PUBLICATION_DRAIN_POLL))
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .0;
    }
}

fn emit_publication_phase<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    request: &PublicationRequest,
    phase: PublicationPhase<'_>,
) {
    let _ = app.emit(
        PUBLICATION_EVENT,
        PublicationEvent {
            project_id: &request.project_id,
            main_document: &request.main_document,
            phase,
        },
    );
}

#[cfg(debug_assertions)]
fn trace_lane(project_id: &str, phase: &str) {
    eprintln!("checkpoint: {project_id} {phase}");
}

#[cfg(not(debug_assertions))]
fn trace_lane(_project_id: &str, _phase: &str) {}

async fn run_publication_lane<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    mut request: PublicationRequest,
    mut cancel: crate::state::CompileCancel,
) {
    loop {
        if checkpoints_are_enabled().await {
            publish_once(&app, &request, &cancel).await;
        }
        match finish_publication(&request.project_id, &cancel) {
            Some((next_request, next_cancel)) => {
                request = next_request;
                cancel = next_cancel;
            }
            None => return,
        }
    }
}

async fn publish_once<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    request: &PublicationRequest,
    cancel: &crate::state::CompileCancel,
) {
    emit_publication_phase(app, request, PublicationPhase::Started);
    trace_lane(&request.project_id, "lane started");
    let started = std::time::Instant::now();
    let result = if wait_for_lane_start(cancel, PUBLICATION_START_DELAY).await {
        attempt_publication(request, Some(cancel)).await
    } else {
        Err(AdapterFailure::silent(
            "checkpoint publication was cancelled",
        ))
    };
    let elapsed_ms = started.elapsed().as_millis();
    let summary = match &result {
        Err(failure) => format!("failed after {elapsed_ms} ms: {}", failure.detail),
        Ok(CheckpointPublicationOutcome::Published { snapshot_root, .. }) => {
            format!("published {snapshot_root} after {elapsed_ms} ms")
        }
        Ok(CheckpointPublicationOutcome::PublishedDurabilityUncertain {
            snapshot_root, ..
        }) => {
            format!("published {snapshot_root} after {elapsed_ms} ms with uncertain durability")
        }
        Ok(_) => format!("unchanged after {elapsed_ms} ms"),
    };
    let outcome = result.unwrap_or_else(outcome_from_failure);
    let _ = crate::project::append_app_log(format!(
        "Checkpoint publication for project {} {summary}",
        request.project_id
    ));

    emit_publication_phase(
        app,
        request,
        PublicationPhase::Finished { outcome: &outcome },
    );
}

async fn wait_for_lane_start(
    cancel: &crate::state::CompileCancel,
    delay: std::time::Duration,
) -> bool {
    let deadline = tokio::time::Instant::now() + delay;
    while tokio::time::Instant::now() < deadline {
        if cancel.is_requested() {
            return false;
        }
        tokio::time::sleep(PUBLICATION_DRAIN_POLL).await;
    }
    !cancel.is_requested()
}

fn read_checkpoints_enabled() -> bool {
    crate::config::read_config()
        .map(|config| config.checkpoints_enabled)
        .unwrap_or(true)
}

async fn checkpoints_are_enabled() -> bool {
    tokio::task::spawn_blocking(read_checkpoints_enabled)
        .await
        .unwrap_or(true)
}

fn publication_request(
    project_id: &str,
    project_root: &Path,
    engine_name: &str,
    main_document: &str,
) -> PublicationRequest {
    PublicationRequest {
        project_id: project_id.to_owned(),
        project_root: project_root.to_path_buf(),
        engine_name: engine_name.to_owned(),
        main_document: main_document.to_owned(),
    }
}

/// Hands the project snapshot to the background lane behind the compile
/// result. At most one publication runs per project. A newer request cancels
/// the running one and becomes its single successor, so there is never a
/// queue. Nothing here reads a file, opens a store, or takes a lock: every
/// decision, the checkpoints switch included, is made inside the lane.
pub(crate) fn schedule_after_successful_compile<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    project_id: &str,
    project_root: &Path,
    engine_name: &str,
    main_document: &str,
) {
    let request = publication_request(project_id, project_root, engine_name, main_document);
    if let Some((request, cancel)) = admit_publication(request) {
        tauri::async_runtime::spawn(run_publication_lane(app.clone(), request, cancel));
    }
}

async fn acquire_operation_lock_cancellable(
    operation: std::sync::Arc<tokio::sync::Mutex<()>>,
    cancel: Option<&crate::state::CompileCancel>,
) -> Result<tokio::sync::OwnedMutexGuard<()>, AdapterFailure> {
    loop {
        ensure_checkpoint_not_cancelled(cancel)?;
        match std::sync::Arc::clone(&operation).try_lock_owned() {
            Ok(guard) => return Ok(guard),
            Err(_) => tokio::time::sleep(OPERATION_LOCK_RETRY).await,
        }
    }
}

fn stage_inputs(
    store: &oleafly_history::Store,
    project_root: &Path,
    inputs: &[oleafly_history::CaptureInput],
    cancel: Option<&crate::state::CompileCancel>,
) -> Result<Candidate, oleafly_history::HistoryError> {
    match cancel {
        Some(cancel) => store.stage_candidate_controlled(project_root, inputs, cancel),
        None => store.stage_candidate(project_root, inputs),
    }
}

fn is_missing_file(error: &oleafly_history::HistoryError) -> bool {
    matches!(error, oleafly_history::HistoryError::Io(io) if io.kind() == std::io::ErrorKind::NotFound)
}

/// A writer can delete a file between the walk and the seal. That must cost
/// the vanished file, never the whole checkpoint, so walk once more and seal
/// what is still on disk. Every other sealing failure stands: a file that is
/// present still has to pass the store's validation.
fn stage_with_one_rewalk(
    store: &oleafly_history::Store,
    project_root: &Path,
    inputs: &[oleafly_history::CaptureInput],
    cancel: Option<&crate::state::CompileCancel>,
) -> Result<Candidate, AdapterFailure> {
    match stage_inputs(store, project_root, inputs, cancel) {
        Ok(candidate) => Ok(candidate),
        Err(error) if is_missing_file(&error) => {
            ensure_checkpoint_not_cancelled(cancel)?;
            let remaining = crate::checkpoint_capture::walk_project(project_root).capture_inputs();
            stage_inputs(store, project_root, &remaining, cancel)
                .map_err(|error| history_failure("inputs could not be sealed", error))
        }
        Err(error) => Err(history_failure("inputs could not be sealed", error)),
    }
}

fn snapshot_evidence(
    request: &PublicationRequest,
    completed_at_unix_ms: i64,
) -> Result<oleafly_history::CompileEvidence, AdapterFailure> {
    oleafly_history::CompileEvidence::new(
        request.engine_name.as_str(),
        request.engine_name.as_str(),
        request.main_document.as_str(),
        ContentHash::digest(&[]),
        completed_at_unix_ms,
    )
    .map_err(|error| AdapterFailure::silent(format!("compile evidence is invalid: {error}")))
}

/// Snapshots the project tree behind one successful compile. Every failure
/// remains supplementary: a compile that succeeded stays successful.
async fn walk_if_changed(
    project_id: &str,
    project_root: &Path,
) -> Result<Option<crate::checkpoint_capture::ProjectWalk>, AdapterFailure> {
    let walk_project_id = project_id.to_owned();
    let walk_project_root = project_root.to_path_buf();
    tokio::task::spawn_blocking(move || {
        let _worktree = crate::worktree_lock::ProjectWorktreeLock::shared(&walk_project_id)
            .map_err(AdapterFailure::silent)?;
        let walk = crate::checkpoint_capture::walk_project(&walk_project_root);
        if newest_checkpoint_matches(&walk_project_id, &walk) {
            return Ok(None);
        }
        Ok(Some(walk))
    })
    .await
    .unwrap_or_else(|error| {
        Err(AdapterFailure::silent(format!(
            "the project files could not be inspected: {error}"
        )))
    })
}

async fn open_publication_store(
    project_id: &str,
) -> Result<oleafly_history::PublicationStore, AdapterFailure> {
    let store_path =
        crate::paths::checkpoint_store_dir(project_id).map_err(AdapterFailure::silent)?;
    match tokio::task::spawn_blocking(move || {
        oleafly_history::Store::try_open_for_publication(store_path)
    })
    .await
    {
        Ok(Ok(Some(publication))) => Ok(publication),
        Ok(Ok(None)) => Err(AdapterFailure::silent(
            "another process is already publishing this project's checkpoint",
        )),
        Ok(Err(error)) => Err(history_failure(
            "checkpoint storage could not be opened",
            error,
        )),
        Err(error) => Err(AdapterFailure::silent(format!(
            "checkpoint storage task failed: {error}"
        ))),
    }
}

fn publish_outcome(
    published: oleafly_history::PublishOutcome,
    committed: oleafly_history::PublicationCommitOutcome,
    snapshot_root: String,
) -> CheckpointPublicationOutcome {
    if matches!(published, oleafly_history::PublishOutcome::Existing(_)) {
        return CheckpointPublicationOutcome::Unchanged;
    }
    match committed {
        oleafly_history::PublicationCommitOutcome::Durable(_store) => {
            CheckpointPublicationOutcome::Published {
                snapshot_root,
                created: true,
            }
        }
        oleafly_history::PublicationCommitOutcome::InstalledDurabilityUncertain(_store) => {
            CheckpointPublicationOutcome::PublishedDurabilityUncertain {
                snapshot_root,
                created: true,
            }
        }
    }
}

async fn attempt_publication(
    request: &PublicationRequest,
    cancel: Option<&crate::state::CompileCancel>,
) -> Result<CheckpointPublicationOutcome, AdapterFailure> {
    let _cancel_scope = CheckpointCancelScope::new(cancel);
    let project_id = request.project_id.as_str();
    let project_root = request.project_root.as_path();
    let operation = crate::checkpoints::checkpoint_operation_lock(project_id)
        .map_err(AdapterFailure::silent)?;
    let _operation = acquire_operation_lock_cancellable(operation, cancel).await?;
    trace_lane(project_id, "operation lock acquired");
    let Some(walk) = walk_if_changed(project_id, project_root).await? else {
        return Ok(CheckpointPublicationOutcome::Unchanged);
    };
    trace_lane(project_id, "sources differ from the newest checkpoint");
    let inputs = walk.capture_inputs();
    let completed_at_unix_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis().min(i64::MAX as u128) as i64)
        .unwrap_or(0);
    ensure_checkpoint_not_cancelled(cancel)?;
    let publication = open_publication_store(project_id).await?;
    trace_lane(project_id, "store opened");
    let seal_store = publication.store().clone();
    let seal_project_id = project_id.to_owned();
    let seal_project_root = project_root.to_path_buf();
    let seal_cancel = cancel.cloned();
    let candidate = match tokio::task::spawn_blocking(move || {
        let _worktree = crate::worktree_lock::ProjectWorktreeLock::shared(&seal_project_id)
            .map_err(AdapterFailure::silent)?;
        ensure_checkpoint_not_cancelled(seal_cancel.as_ref())?;
        let candidate = stage_with_one_rewalk(
            &seal_store,
            &seal_project_root,
            &inputs,
            seal_cancel.as_ref(),
        )?;
        if let Err(error) = ensure_checkpoint_not_cancelled(seal_cancel.as_ref()) {
            drop(candidate);
            return Err(error);
        }
        Ok(candidate)
    })
    .await
    {
        Ok(Ok(candidate)) => candidate,
        Ok(Err(error)) => {
            let _ = tokio::task::spawn_blocking(move || drop(publication)).await;
            return Err(error);
        }
        Err(error) => {
            let _ = tokio::task::spawn_blocking(move || drop(publication)).await;
            return Err(AdapterFailure::silent(format!(
                "checkpoint input sealing task failed: {error}"
            )));
        }
    };
    trace_lane(project_id, "publishing");
    let snapshot_root = candidate.snapshot_root().to_string();
    let evidence = match snapshot_evidence(request, completed_at_unix_ms) {
        Ok(evidence) => evidence,
        Err(error) => {
            let _ = tokio::task::spawn_blocking(move || {
                drop(candidate);
                drop(publication);
            })
            .await;
            return Err(error);
        }
    };
    let publish_cancel = cancel.cloned();
    match tokio::task::spawn_blocking(move || {
        ensure_checkpoint_not_cancelled(publish_cancel.as_ref())?;
        let result = if let Some(cancel) = publish_cancel.as_ref() {
            publication.publish_controlled(candidate, evidence, cancel)
        } else {
            publication.publish(candidate, evidence)
        };
        result.map_err(|error| history_failure("the checkpoint could not be published", error))
    })
    .await
    {
        Ok(Ok((published, committed))) => Ok(publish_outcome(published, committed, snapshot_root)),
        Ok(Err(error)) => Err(error),
        Err(error) => Err(AdapterFailure::silent(format!(
            "checkpoint storage task failed: {error}"
        ))),
    }
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::sync::{Arc, Barrier};

    use oleafly_history::{
        Candidate, CaptureInput, CompileEvidence, ContentHash, HistoryError, Store,
    };
    use tempfile::tempdir;

    use super::{
        admit_publication, cancel_project_publications_and_wait, finish_publication,
        lane_successor_document, newest_checkpoint_matches, outcome_from_failure,
        publication_request, read_checkpoints_enabled, schedule_after_successful_compile,
        AdapterFailure, CheckpointPublicationOutcome, CheckpointSkipReason, PublicationRequest,
    };

    fn publication_candidate(
        store: &Store,
        project: &std::path::Path,
        source: &[u8],
    ) -> (Candidate, CompileEvidence) {
        fs::write(project.join("main.typ"), source).unwrap();
        let inputs = vec![
            CaptureInput::explicit("project.json").unwrap(),
            CaptureInput::explicit("main.typ").unwrap(),
        ];
        let candidate = store.stage_candidate(project, &inputs).unwrap();
        let evidence = CompileEvidence::new(
            "typst",
            "typst-test@1",
            "main.typ",
            ContentHash::digest(b"validated-pdf"),
            1,
        )
        .unwrap();
        (candidate, evidence)
    }

    #[test]
    fn cancellation_and_root_publication_share_one_linearizable_cutoff() {
        for iteration in 0..24_u8 {
            let temp = tempdir().unwrap();
            let project = temp.path().join("project");
            fs::create_dir(&project).unwrap();
            fs::write(project.join("project.json"), br#"{"main":"main.typ"}"#).unwrap();
            let store = Store::open(temp.path().join("history")).unwrap();
            let (candidate, evidence) = publication_candidate(&store, &project, &[iteration]);
            let cancel = crate::state::CompileCancel::default();
            cancel.begin();
            let barrier = Arc::new(Barrier::new(2));

            let (publication, request_result) = std::thread::scope(|scope| {
                let publish_barrier = barrier.clone();
                let publish_cancel = cancel.clone();
                let publish_store = store.clone();
                let publication = scope.spawn(move || {
                    publish_barrier.wait();
                    publish_store.publish_controlled(candidate, evidence, &publish_cancel)
                });
                let cancel_barrier = barrier.clone();
                let request_cancel = cancel.clone();
                let request = scope.spawn(move || {
                    cancel_barrier.wait();
                    request_cancel.request()
                });
                (publication.join().unwrap(), request.join().unwrap())
            });
            let stopped = cancel.detach();

            match publication {
                Ok(_) => {
                    assert_eq!(request_result, None);
                    assert!(!stopped, "a stop after the cutoff must not be reported");
                    assert_eq!(store.list().unwrap().len(), 1);
                }
                Err(HistoryError::PublicationCancelled) => {
                    assert_eq!(request_result, None);
                    assert!(stopped, "the stop that won the cutoff must be reported");
                    assert!(store.list().unwrap().is_empty());
                }
                Err(error) => panic!("unexpected publication failure: {error}"),
            }
        }
    }

    #[test]
    fn first_store_install_and_stop_share_one_linearizable_cutoff() {
        for iteration in 0..24_u8 {
            let temp = tempdir().unwrap();
            let project = temp.path().join("project");
            fs::create_dir(&project).unwrap();
            fs::write(project.join("project.json"), br#"{"main":"main.typ"}"#).unwrap();
            let history = temp.path().join("history");
            let publication = Store::open_for_publication(&history).unwrap();
            let (candidate, evidence) =
                publication_candidate(publication.store(), &project, &[iteration]);
            let cancel = crate::state::CompileCancel::default();
            cancel.begin();
            let barrier = Arc::new(Barrier::new(2));

            let (published, request_result) = std::thread::scope(|scope| {
                let publish_barrier = barrier.clone();
                let publish_cancel = cancel.clone();
                let published = scope.spawn(move || {
                    publish_barrier.wait();
                    publication.publish_controlled(candidate, evidence, &publish_cancel)
                });
                let cancel_barrier = barrier.clone();
                let request_cancel = cancel.clone();
                let request = scope.spawn(move || {
                    cancel_barrier.wait();
                    request_cancel.request()
                });
                (published.join().unwrap(), request.join().unwrap())
            });
            let stopped = cancel.detach();

            match published {
                Ok(_) => {
                    assert_eq!(request_result, None);
                    assert!(!stopped, "a stop after install must not be reported");
                    assert_eq!(
                        Store::open_existing(&history)
                            .unwrap()
                            .unwrap()
                            .list()
                            .unwrap()
                            .len(),
                        1
                    );
                }
                Err(HistoryError::PublicationCancelled) => {
                    assert_eq!(request_result, None);
                    assert!(stopped, "the stop that won install must be reported");
                    assert!(!history.exists());
                    assert!(Store::open_existing(&history).unwrap().is_none());
                }
                Err(error) => panic!("unexpected first-store publication failure: {error}"),
            }
        }
    }

    #[test]
    fn the_checkpoints_switch_gates_publication_and_defaults_to_on() {
        let _env_guard = crate::paths::data_dir_env_lock();
        let directory = tempdir().unwrap();
        std::env::set_var("OLEAFLY_DATA_DIR", directory.path());

        assert!(read_checkpoints_enabled());

        let mut config = crate::config::AppConfig {
            checkpoints_enabled: false,
            ..Default::default()
        };
        crate::config::write_config(&config).unwrap();
        assert!(!read_checkpoints_enabled());

        config.checkpoints_enabled = true;
        crate::config::write_config(&config).unwrap();
        assert!(read_checkpoints_enabled());

        std::env::remove_var("OLEAFLY_DATA_DIR");
    }

    #[test]
    fn publication_outcomes_serialize_their_documented_status_shapes() {
        assert_eq!(
            serde_json::to_value(CheckpointPublicationOutcome::Unchanged).unwrap(),
            serde_json::json!({"status": "unchanged"})
        );
        assert_eq!(
            serde_json::to_value(CheckpointPublicationOutcome::Failed).unwrap(),
            serde_json::json!({"status": "failed"})
        );
        assert_eq!(
            serde_json::to_value(CheckpointPublicationOutcome::skipped(
                CheckpointSkipReason::StorageUnavailable,
                "message",
                "suggestion",
            ))
            .unwrap(),
            serde_json::json!({
                "status": "skipped",
                "reason": "storage_unavailable",
                "message": "message",
                "suggestion": "suggestion"
            })
        );
        assert_eq!(
            serde_json::to_value(CheckpointPublicationOutcome::Published {
                snapshot_root: "abc".into(),
                created: true,
            })
            .unwrap(),
            serde_json::json!({"status": "published", "snapshot_root": "abc", "created": true})
        );
    }

    #[test]
    fn only_a_storage_failure_tells_the_writer_what_to_do() {
        let full = super::history_failure(
            "the checkpoint could not be published",
            HistoryError::Io(std::io::Error::other("No space left on device")),
        );
        assert_eq!(
            full.reason,
            Some(CheckpointSkipReason::StorageUnavailable),
            "{}",
            full.detail
        );
        let CheckpointPublicationOutcome::Skipped {
            reason,
            message,
            suggestion,
        } = outcome_from_failure(full)
        else {
            panic!("a full disk must tell the writer what to do");
        };
        assert_eq!(reason, CheckpointSkipReason::StorageUnavailable);
        assert_eq!(
            message,
            "Checkpoint not saved. Checkpoint storage is full or not writable."
        );
        assert_eq!(
            suggestion,
            "Free some disk space or check folder permissions, then compile again."
        );

        let unwritable = super::history_failure(
            "checkpoint storage could not be opened",
            HistoryError::Io(std::io::Error::from(std::io::ErrorKind::PermissionDenied)),
        );
        assert_eq!(
            unwritable.reason,
            Some(CheckpointSkipReason::StorageUnavailable)
        );

        let corrupt = super::history_failure(
            "inputs could not be sealed",
            HistoryError::Corrupt("the manifest row is missing".into()),
        );
        assert_eq!(corrupt.reason, None);
        assert_eq!(
            outcome_from_failure(corrupt),
            CheckpointPublicationOutcome::Failed
        );
        assert_eq!(
            outcome_from_failure(AdapterFailure::silent("the project files moved")),
            CheckpointPublicationOutcome::Failed
        );
    }

    #[test]
    fn a_cancel_scope_reports_one_stop_and_detaches_on_the_way_out() {
        super::ensure_checkpoint_not_cancelled(None).unwrap();
        let cancel = crate::state::CompileCancel::default();
        {
            let _scope = super::CheckpointCancelScope::new(Some(&cancel));
            assert_eq!(cancel.request(), None);
            let error = super::ensure_checkpoint_not_cancelled(Some(&cancel)).unwrap_err();
            assert!(error.detail.contains("cancelled"));
        }
        assert!(!cancel.is_requested());
        let _scope = super::CheckpointCancelScope::new(None);
    }

    fn lane_request(project_id: &str, generation: u64) -> PublicationRequest {
        PublicationRequest {
            project_id: project_id.to_owned(),
            project_root: std::path::PathBuf::from("/project"),
            engine_name: "typst".into(),
            main_document: format!("main-{generation}.typ"),
        }
    }

    #[test]
    fn a_publication_request_reads_nothing_and_records_only_where_to_look() {
        let temp = tempdir().unwrap();
        let project = temp.path().join("project");
        fs::create_dir(&project).unwrap();
        let build = temp.path().join("build");
        fs::create_dir(&build).unwrap();

        let request = publication_request("lane-request", &project, "latex", "main.tex");

        assert!(fs::read_dir(&build).unwrap().next().is_none());
        assert!(fs::read_dir(&project).unwrap().next().is_none());
        assert_eq!(request.project_id, "lane-request");
        assert_eq!(request.project_root, project);
        assert_eq!(request.engine_name, "latex");
        assert_eq!(request.main_document, "main.tex");
    }

    #[test]
    fn scheduling_a_publication_reaches_no_file_before_the_lane_is_spawned() {
        let _env_guard = crate::paths::data_dir_env_lock();
        let temp = tempdir().unwrap();
        let data = temp.path().join("data");
        std::env::set_var("OLEAFLY_DATA_DIR", &data);
        let project = temp.path().join("project");
        let build = project.join(".oleafly").join("build");
        fs::create_dir_all(&build).unwrap();
        let app = tauri::test::mock_builder()
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .unwrap();
        let handle = app.handle().clone();
        let project_id = "lane-compile-path";
        let (_running, holder) = admit_publication(lane_request(project_id, 1)).unwrap();

        schedule_after_successful_compile(&handle, project_id, &project, "latex", "main.tex");

        assert_eq!(
            lane_successor_document(project_id).as_deref(),
            Some("main.tex"),
            "the request must reach the lane"
        );
        assert!(
            !data.exists(),
            "reading the checkpoints switch on the compile path creates the data directory"
        );
        assert!(
            fs::read_dir(&build).unwrap().next().is_none(),
            "the compile path must not read or write the build directory"
        );
        assert!(
            fs::read_dir(&project)
                .unwrap()
                .filter_map(Result::ok)
                .all(|entry| entry.file_name() == ".oleafly"),
            "the compile path must not touch the project tree"
        );

        super::cancel_project_publications(project_id);
        assert!(finish_publication(project_id, &holder).is_none());
        std::env::remove_var("OLEAFLY_DATA_DIR");
    }

    #[test]
    fn a_newer_request_cancels_the_running_publication_and_becomes_its_successor() {
        let project = "lane-successor";
        let (first, cancel) = admit_publication(lane_request(project, 1)).unwrap();
        assert_eq!(first.main_document, "main-1.typ");
        assert!(!cancel.is_requested());

        assert!(admit_publication(lane_request(project, 2)).is_none());

        assert!(cancel.is_requested());
        let (next, next_cancel) = finish_publication(project, &cancel).unwrap();
        assert_eq!(next.main_document, "main-2.typ");
        assert!(!next_cancel.is_requested());
        assert!(finish_publication(project, &next_cancel).is_none());
        let (_, reopened) = admit_publication(lane_request(project, 3)).unwrap();
        assert!(finish_publication(project, &reopened).is_none());
    }

    #[test]
    fn a_third_request_replaces_the_successor_and_leaves_the_first_cancelled() {
        let project = "lane-replace-successor";
        let (_, cancel) = admit_publication(lane_request(project, 1)).unwrap();
        assert!(admit_publication(lane_request(project, 2)).is_none());
        assert!(admit_publication(lane_request(project, 3)).is_none());

        assert!(cancel.is_requested());
        let (next, next_cancel) = finish_publication(project, &cancel).unwrap();
        assert_eq!(next.main_document, "main-3.typ");
        assert!(!next_cancel.is_requested());
        assert!(finish_publication(project, &next_cancel).is_none());
    }

    #[test]
    fn cancel_and_wait_drains_the_running_publication_and_its_successor() {
        let project = "lane-drain";
        cancel_project_publications_and_wait(project);
        let (_, cancel) = admit_publication(lane_request(project, 1)).unwrap();
        assert!(admit_publication(lane_request(project, 2)).is_none());
        assert_eq!(
            lane_successor_document(project).as_deref(),
            Some("main-2.typ")
        );
        let finisher_cancel = cancel.clone();
        let finisher = std::thread::spawn(move || {
            while lane_successor_document("lane-drain").is_some() {
                std::thread::sleep(std::time::Duration::from_millis(5));
            }
            std::thread::sleep(std::time::Duration::from_millis(40));
            assert!(finish_publication("lane-drain", &finisher_cancel).is_none());
        });

        let started = std::time::Instant::now();
        cancel_project_publications_and_wait(project);

        assert!(started.elapsed() < std::time::Duration::from_secs(5));
        finisher.join().unwrap();
        assert_eq!(lane_successor_document(project), None);
        let (_, reopened) = admit_publication(lane_request(project, 3)).unwrap();
        assert!(finish_publication(project, &reopened).is_none());
    }

    #[test]
    fn only_an_identical_project_tree_matches_the_newest_checkpoint() {
        let _env_guard = crate::paths::data_dir_env_lock();
        let directory = tempdir().unwrap();
        std::env::set_var("OLEAFLY_DATA_DIR", directory.path());

        let project = directory.path().join("worktree");
        fs::create_dir_all(project.join("chapters")).unwrap();
        fs::write(project.join("project.json"), b"{}").unwrap();
        fs::write(project.join("main.typ"), b"main").unwrap();
        fs::write(project.join("chapters/one.typ"), b"chapter").unwrap();
        let walk_now = || crate::checkpoint_capture::walk_project(&project);

        assert!(
            !newest_checkpoint_matches("snapshot", &walk_now()),
            "a project with no store yet has nothing to match"
        );

        let store = Store::open(crate::paths::checkpoint_store_dir("snapshot").unwrap()).unwrap();
        let candidate = store
            .stage_candidate(&project, &walk_now().capture_inputs())
            .unwrap();
        let request = publication_request("snapshot", &project, "typst", "main.typ");
        let evidence = super::snapshot_evidence(&request, 1).unwrap();
        store.publish(candidate, evidence).unwrap();
        drop(store);

        assert!(newest_checkpoint_matches("snapshot", &walk_now()));

        fs::write(project.join("chapters/one.typ"), b"edited").unwrap();
        assert!(
            !newest_checkpoint_matches("snapshot", &walk_now()),
            "an edited file must not read as unchanged"
        );
        fs::write(project.join("chapters/one.typ"), b"chapter").unwrap();

        fs::write(project.join("notes.md"), b"added later").unwrap();
        assert!(
            !newest_checkpoint_matches("snapshot", &walk_now()),
            "a new file alone must not read as unchanged"
        );
        fs::remove_file(project.join("notes.md")).unwrap();

        fs::remove_file(project.join("chapters/one.typ")).unwrap();
        assert!(
            !newest_checkpoint_matches("snapshot", &walk_now()),
            "a removed file must not read as unchanged"
        );

        std::env::remove_var("OLEAFLY_DATA_DIR");
    }

    fn seed_project(data_dir: &std::path::Path, project_id: &str) -> std::path::PathBuf {
        let project = data_dir.join("projects").join(project_id);
        let build = project.join(".oleafly").join("build");
        fs::create_dir_all(&build).unwrap();
        fs::write(project.join("project.json"), br#"{"main":"main.tex"}"#).unwrap();
        fs::write(
            build.join(format!("{}.pdf", crate::paths::ENTRY_STEM)),
            b"%PDF-1.7",
        )
        .unwrap();
        project
    }

    fn publication_runtime() -> tokio::runtime::Runtime {
        tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap()
    }

    fn publish_checkpoint(
        runtime: &tokio::runtime::Runtime,
        project_id: &str,
        project: &std::path::Path,
        engine_name: &str,
        main_document: &str,
    ) -> CheckpointPublicationOutcome {
        runtime
            .block_on(super::attempt_publication(
                &publication_request(project_id, project, engine_name, main_document),
                None,
            ))
            .unwrap_or_else(|failure| panic!("publication failed: {}", failure.detail))
    }

    fn open_checkpoint_store(project_id: &str) -> Store {
        let store_path = crate::paths::existing_checkpoint_store_dir(project_id)
            .unwrap()
            .expect("a published project must have a checkpoint store");
        Store::open_existing(store_path)
            .unwrap()
            .expect("the checkpoint store must open")
    }

    fn newest_checkpoint_paths(project_id: &str) -> Vec<String> {
        let store = open_checkpoint_store(project_id);
        let checkpoint = store
            .latest_checkpoint()
            .unwrap()
            .expect("a checkpoint must exist");
        let mut paths = store
            .checkpoint_files(&checkpoint.snapshot_root)
            .unwrap()
            .expect("the checkpoint must list its files")
            .into_iter()
            .map(|file| file.relative_path)
            .collect::<Vec<_>>();
        paths.sort();
        paths
    }

    fn checkpoint_count(project_id: &str) -> usize {
        open_checkpoint_store(project_id).list().unwrap().len()
    }

    #[test]
    fn a_successful_compile_captures_files_the_compiler_never_read() {
        let _env_guard = crate::paths::data_dir_env_lock();
        let directory = tempdir().unwrap();
        std::env::set_var("OLEAFLY_DATA_DIR", directory.path());
        let runtime = publication_runtime();

        let project = seed_project(directory.path(), "capture-unread");
        fs::write(project.join("main.tex"), b"\\documentclass{article}").unwrap();
        fs::write(project.join("refs.bib"), b"@book{a,title={A}}").unwrap();
        fs::write(project.join("README.md"), b"no compiler ever reads this").unwrap();
        fs::create_dir_all(project.join("figures")).unwrap();
        fs::write(project.join("figures/unused.svg"), b"<svg/>").unwrap();

        let outcome = publish_checkpoint(&runtime, "capture-unread", &project, "latex", "main.tex");

        let CheckpointPublicationOutcome::Published { created, .. } = outcome else {
            panic!("a successful compile must publish a checkpoint: {outcome:?}");
        };
        assert!(created);
        assert_eq!(
            newest_checkpoint_paths("capture-unread"),
            vec![
                "README.md",
                "figures/unused.svg",
                "main.tex",
                "project.json",
                "refs.bib"
            ]
        );

        std::env::remove_var("OLEAFLY_DATA_DIR");
    }

    #[test]
    fn a_second_identical_compile_publishes_nothing() {
        let _env_guard = crate::paths::data_dir_env_lock();
        let directory = tempdir().unwrap();
        std::env::set_var("OLEAFLY_DATA_DIR", directory.path());
        let runtime = publication_runtime();

        let project = seed_project(directory.path(), "unchanged-second");
        fs::write(project.join("main.tex"), b"\\documentclass{article}").unwrap();

        let first = publish_checkpoint(&runtime, "unchanged-second", &project, "latex", "main.tex");
        assert!(
            matches!(first, CheckpointPublicationOutcome::Published { .. }),
            "the first compile must publish: {first:?}"
        );

        let second =
            publish_checkpoint(&runtime, "unchanged-second", &project, "latex", "main.tex");

        assert_eq!(second, CheckpointPublicationOutcome::Unchanged);
        assert_eq!(checkpoint_count("unchanged-second"), 1);

        std::env::remove_var("OLEAFLY_DATA_DIR");
    }

    #[test]
    fn editing_a_file_the_compiler_never_reads_makes_a_new_checkpoint() {
        let _env_guard = crate::paths::data_dir_env_lock();
        let directory = tempdir().unwrap();
        std::env::set_var("OLEAFLY_DATA_DIR", directory.path());
        let runtime = publication_runtime();

        let project = seed_project(directory.path(), "unread-edit");
        fs::write(project.join("main.tex"), b"\\documentclass{article}").unwrap();
        fs::write(project.join("notes.md"), b"first draft of the notes").unwrap();

        let first = publish_checkpoint(&runtime, "unread-edit", &project, "latex", "main.tex");
        let CheckpointPublicationOutcome::Published {
            snapshot_root: first_root,
            ..
        } = first
        else {
            panic!("the first compile must publish: {first:?}");
        };

        fs::write(project.join("notes.md"), b"second draft of the notes").unwrap();
        let second = publish_checkpoint(&runtime, "unread-edit", &project, "latex", "main.tex");

        let CheckpointPublicationOutcome::Published {
            snapshot_root: second_root,
            created,
        } = second
        else {
            panic!("editing an unread file must publish a checkpoint: {second:?}");
        };
        assert!(created);
        assert_ne!(first_root, second_root);
        assert_eq!(checkpoint_count("unread-edit"), 2);

        std::env::remove_var("OLEAFLY_DATA_DIR");
    }

    #[test]
    fn no_engine_or_compile_flag_prevents_a_checkpoint() {
        let _env_guard = crate::paths::data_dir_env_lock();
        let directory = tempdir().unwrap();
        std::env::set_var("OLEAFLY_DATA_DIR", directory.path());
        let runtime = publication_runtime();

        for (project_id, engine_name, main_document) in [
            ("gate-latex", "latex", "main.tex"),
            ("gate-latexmk", "latexmk", "main.tex"),
            ("gate-typst", "typst", "main.typ"),
            ("gate-markdown", "markdown", "main.md"),
        ] {
            let project = seed_project(directory.path(), project_id);
            fs::write(
                project.join(main_document),
                b"\\documentclass[draft]{article}\\usepackage{minted}\\write18{echo hi}\
                  \\addbibresource{refs.bib}",
            )
            .unwrap();
            fs::write(project.join("refs.bib"), b"@book{a,title={A}}").unwrap();
            fs::write(
                project
                    .join(".oleafly")
                    .join("build")
                    .join(format!("{}.bcf", crate::paths::ENTRY_STEM)),
                b"<bcf/>",
            )
            .unwrap();
            fs::create_dir_all(project.join("_minted-main")).unwrap();
            fs::write(project.join("_minted-main/one.pygtex"), b"generated").unwrap();

            let outcome =
                publish_checkpoint(&runtime, project_id, &project, engine_name, main_document);

            assert!(
                matches!(
                    outcome,
                    CheckpointPublicationOutcome::Published { created: true, .. }
                ),
                "{engine_name} must still publish a checkpoint: {outcome:?}"
            );
            assert_eq!(
                newest_checkpoint_paths(project_id),
                vec![main_document, "project.json", "refs.bib"],
                "{engine_name} must capture the sources and skip the shell-escape cache"
            );
        }

        std::env::remove_var("OLEAFLY_DATA_DIR");
    }

    #[test]
    fn a_file_deleted_between_the_walk_and_the_seal_still_publishes_a_checkpoint() {
        let _env_guard = crate::paths::data_dir_env_lock();
        let directory = tempdir().unwrap();
        std::env::set_var("OLEAFLY_DATA_DIR", directory.path());

        let project = seed_project(directory.path(), "vanishing-input");
        fs::write(project.join("main.tex"), b"\\documentclass{article}").unwrap();
        fs::write(
            project.join("notes.md"),
            b"deleted while the checkpoint is sealed",
        )
        .unwrap();
        let inputs = crate::checkpoint_capture::walk_project(&project).capture_inputs();
        assert_eq!(inputs.len(), 3, "the walk must see the file it will lose");

        fs::remove_file(project.join("notes.md")).unwrap();
        let store =
            Store::open(crate::paths::checkpoint_store_dir("vanishing-input").unwrap()).unwrap();
        let candidate = super::stage_with_one_rewalk(&store, &project, &inputs, None)
            .unwrap_or_else(|failure| {
                panic!(
                    "a vanished file must not cost the checkpoint: {}",
                    failure.detail
                )
            });
        let request = publication_request("vanishing-input", &project, "latex", "main.tex");
        let evidence = super::snapshot_evidence(&request, 1).unwrap();
        store.publish(candidate, evidence).unwrap();
        drop(store);

        assert_eq!(
            newest_checkpoint_paths("vanishing-input"),
            vec!["main.tex", "project.json"]
        );
        assert_eq!(checkpoint_count("vanishing-input"), 1);

        std::env::remove_var("OLEAFLY_DATA_DIR");
    }

    #[test]
    fn a_file_that_is_present_still_has_to_pass_the_stores_validation() {
        if !crate::paths::symlink_creation_is_permitted() {
            return;
        }
        let _env_guard = crate::paths::data_dir_env_lock();
        let directory = tempdir().unwrap();
        std::env::set_var("OLEAFLY_DATA_DIR", directory.path());

        let project = seed_project(directory.path(), "symlinked-input");
        fs::write(project.join("main.tex"), b"\\documentclass{article}").unwrap();
        let inputs = vec![
            CaptureInput::explicit("project.json").unwrap(),
            CaptureInput::explicit("linked.tex").unwrap(),
        ];
        #[cfg(unix)]
        std::os::unix::fs::symlink(project.join("main.tex"), project.join("linked.tex")).unwrap();
        #[cfg(windows)]
        std::os::windows::fs::symlink_file(project.join("main.tex"), project.join("linked.tex"))
            .unwrap();
        let store =
            Store::open(crate::paths::checkpoint_store_dir("symlinked-input").unwrap()).unwrap();

        let failure = super::stage_with_one_rewalk(&store, &project, &inputs, None).unwrap_err();

        assert!(
            failure.detail.contains("symbolic link"),
            "a present file must not be excused by the re-walk: {}",
            failure.detail
        );

        drop(store);
        std::env::remove_var("OLEAFLY_DATA_DIR");
    }

    #[test]
    fn reverting_an_edit_reuses_the_checkpoint_it_matches() {
        let _env_guard = crate::paths::data_dir_env_lock();
        let directory = tempdir().unwrap();
        std::env::set_var("OLEAFLY_DATA_DIR", directory.path());
        let runtime = publication_runtime();

        let project = seed_project(directory.path(), "revert-dedupe");
        fs::write(project.join("main.tex"), b"first").unwrap();
        let first = publish_checkpoint(&runtime, "revert-dedupe", &project, "latex", "main.tex");
        let CheckpointPublicationOutcome::Published {
            snapshot_root: first_root,
            ..
        } = first
        else {
            panic!("the first compile must publish: {first:?}");
        };

        fs::write(project.join("main.tex"), b"second").unwrap();
        let second = publish_checkpoint(&runtime, "revert-dedupe", &project, "latex", "main.tex");
        let CheckpointPublicationOutcome::Published {
            snapshot_root: second_root,
            ..
        } = second
        else {
            panic!("an edit must publish: {second:?}");
        };
        assert_ne!(first_root, second_root);

        fs::write(project.join("main.tex"), b"first").unwrap();
        let reverted = publish_checkpoint(&runtime, "revert-dedupe", &project, "latex", "main.tex");

        assert_eq!(
            reverted,
            CheckpointPublicationOutcome::Unchanged,
            "content already stored must not become a third checkpoint"
        );
        assert_eq!(checkpoint_count("revert-dedupe"), 2);

        std::env::remove_var("OLEAFLY_DATA_DIR");
    }
}
