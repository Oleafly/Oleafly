mod apply;
mod isolation;
mod model;
mod preview;
#[cfg(test)]
#[path = "tests/scheduler.rs"]
mod scheduler_tests;
mod store;

use std::collections::{HashMap, HashSet};
use std::future::Future;
use std::path::PathBuf;
use std::pin::Pin;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};

use oleafly_agent::CancellationToken;
use tauri::Emitter;
use tokio::sync::{Notify, OwnedSemaphorePermit, Semaphore};

pub use model::{ResearchTask, TaskRunContext, TaskRuntimeEvent, TaskRuntimeOutcome, ToolPhase};

use model::{
    now_ms, ResearchTaskDraft, ResearchTaskEdit, ResearchTaskStatus, TaskApplyRequest,
    TaskApplyResult, TaskArtifact, TaskArtifactPreview, TaskFileChange, TaskFilePreview,
    TaskResultMetadata, TaskReviewResult, TaskTranscriptEvent, TaskTranscriptPage,
};
use store::TaskStore;

pub type TaskRuntimeFuture<T> = Pin<Box<dyn Future<Output = Result<T, String>> + Send>>;
pub type TaskEventSink = Arc<dyn Fn(TaskRuntimeEvent) + Send + Sync>;

pub trait TaskRuntimeAdapter: Send + Sync {
    fn supports(&self, agent_id: &str) -> bool;
    fn run(
        &self,
        context: TaskRunContext,
        cancel: CancellationToken,
        events: TaskEventSink,
    ) -> TaskRuntimeFuture<TaskRuntimeOutcome>;
    fn cancel(&self, session_id: String) -> TaskRuntimeFuture<()>;
}

#[derive(Clone)]
pub struct ResearchTaskState {
    inner: Arc<ResearchTaskStateInner>,
}

struct ResearchTaskStateInner {
    root: Result<PathBuf, String>,
    concurrency: Arc<Semaphore>,
    scheduling: tokio::sync::Mutex<()>,
    stopping: AtomicBool,
    active: Mutex<HashMap<String, ActiveTask>>,
    runtimes: Mutex<HashMap<String, Arc<dyn TaskRuntimeAdapter>>>,
    app: Mutex<Option<tauri::AppHandle>>,
}

#[derive(Clone)]
struct ActiveTask {
    execution_generation: u64,
    session_id: String,
    cancel: CancellationToken,
    adapter: Arc<dyn TaskRuntimeAdapter>,
    runtime_started: Arc<AtomicBool>,
    settled: Arc<AtomicBool>,
    settled_notify: Arc<Notify>,
}

impl ActiveTask {
    fn mark_settled(&self) {
        self.settled.store(true, Ordering::Release);
        self.settled_notify.notify_waiters();
    }

    async fn wait_until_settled(&self) {
        loop {
            let notified = self.settled_notify.notified();
            if self.settled.load(Ordering::Acquire) {
                return;
            }
            notified.await;
        }
    }
}

impl Default for ResearchTaskState {
    fn default() -> Self {
        let root = crate::paths::oleafly_root().map(|root| root.join("research-tasks"));
        Self::with_root(root, 2)
    }
}

impl ResearchTaskState {
    fn with_root(root: Result<PathBuf, String>, max_concurrent: usize) -> Self {
        Self {
            inner: Arc::new(ResearchTaskStateInner {
                root,
                concurrency: Arc::new(Semaphore::new(max_concurrent.clamp(1, 8))),
                scheduling: tokio::sync::Mutex::new(()),
                stopping: AtomicBool::new(false),
                active: Mutex::new(HashMap::new()),
                runtimes: Mutex::new(HashMap::new()),
                app: Mutex::new(None),
            }),
        }
    }

    #[cfg(test)]
    fn for_test(root: PathBuf, max_concurrent: usize) -> Self {
        Self::with_root(Ok(root), max_concurrent)
    }

    pub fn register_runtime(
        &self,
        runtime_id: impl Into<String>,
        adapter: Arc<dyn TaskRuntimeAdapter>,
    ) -> Result<(), String> {
        let runtime_id = runtime_id.into();
        let runtime_id = runtime_id.trim();
        if runtime_id.is_empty() || runtime_id.len() > 80 || runtime_id.contains('\0') {
            return Err("The task runtime ID is invalid.".into());
        }
        lock(&self.inner.runtimes).insert(runtime_id.to_string(), adapter);
        Ok(())
    }

    pub fn attach_app(&self, app: tauri::AppHandle) {
        *lock(&self.inner.app) = Some(app);
    }

    pub async fn recover(&self, app_state: &crate::state::AppState) -> Result<(), String> {
        let store = self.store()?;
        let mut failures = Vec::new();
        let mut unresolved = 0usize;
        for pending in store.pending_applies()? {
            if let Err(error) = self
                .recover_pending(app_state, &store, pending.clone())
                .await
            {
                if project_is_missing(&pending.project_id) {
                    let _ = store.clear_apply(&pending.task_id, Some(&error));
                    if let Ok(task) = store.require(&pending.task_id) {
                        self.emit_task(&task);
                    }
                } else {
                    unresolved += 1;
                }
                failures.push(format!("{}: {error}", pending.task_id));
            }
        }
        for task in store.recover_interrupted()? {
            if task.status == ResearchTaskStatus::Failed {
                self.emit_task(&task);
            }
        }
        if unresolved == 0 {
            self.launch_ready().await?;
        }
        if failures.is_empty() {
            Ok(())
        } else {
            Err(format!(
                "Some interrupted task applies could not be recovered: {}",
                failures.join("; ")
            ))
        }
    }

    async fn recover_pending(
        &self,
        app_state: &crate::state::AppState,
        store: &TaskStore,
        pending: store::PendingApply,
    ) -> Result<(), String> {
        let task = store.require(&pending.task_id)?;
        let recover_store = store.clone();
        let recover_task = task.clone();
        let selected_paths = pending.selected_paths.clone();
        let mutation = crate::project::mutate_project_worktree(
            app_state,
            pending.project_id.clone(),
            None,
            move |project_root| {
                let fully_applied = apply::recover_pending_apply(
                    &recover_store,
                    &recover_task,
                    project_root,
                    &selected_paths,
                )?;
                Ok((fully_applied, !fully_applied))
            },
        )
        .await?;
        match mutation.value {
            Ok(true) => {
                let review = TaskReviewResult {
                    selected_paths: pending.selected_paths,
                    applied_at: now_ms(),
                    project_mutation_generation: mutation.generation,
                };
                let task = store.complete_apply(&pending.task_id, &review)?;
                self.emit_task(&task);
                Ok(())
            }
            Ok(false) => {
                store.clear_apply(
                    &pending.task_id,
                    Some("An interrupted apply was rolled back. Review the result, then apply it again."),
                )?;
                self.emit_task(&store.require(&pending.task_id)?);
                Ok(())
            }
            Err(error) => Err(error),
        }
    }

    fn store(&self) -> Result<TaskStore, String> {
        let root = self.inner.root.clone()?;
        TaskStore::new(root)
    }

    fn runtime_for(
        &self,
        runtime_id: &str,
        agent_id: &str,
    ) -> Result<Arc<dyn TaskRuntimeAdapter>, String> {
        let adapter = lock(&self.inner.runtimes)
            .get(runtime_id)
            .cloned()
            .ok_or_else(|| format!("The {runtime_id} task runtime is not available."))?;
        if !adapter.supports(agent_id) {
            return Err(format!(
                "The selected agent is not available in the {runtime_id} runtime."
            ));
        }
        Ok(adapter)
    }

    async fn launch_ready(&self) -> Result<(), String> {
        if self.inner.stopping.load(Ordering::Acquire) {
            return Ok(());
        }
        let _scheduling = self.inner.scheduling.lock().await;
        loop {
            if self.inner.stopping.load(Ordering::Acquire) {
                return Ok(());
            }
            let permit = match self.inner.concurrency.clone().try_acquire_owned() {
                Ok(permit) => permit,
                Err(_) => return Ok(()),
            };
            let store = self.store()?;
            let Some(task) = store.claim_next()? else {
                drop(permit);
                return Ok(());
            };
            let adapter = match self.runtime_for(&task.runtime_id, &task.agent_id) {
                Ok(adapter) => adapter,
                Err(error) => {
                    store.finish_failure(&task.id, task.execution_generation, &error)?;
                    self.emit_task(&store.require(&task.id)?);
                    drop(permit);
                    continue;
                }
            };
            let cancel = CancellationToken::new();
            let active = ActiveTask {
                execution_generation: task.execution_generation,
                session_id: task.session_id.clone().unwrap_or_default(),
                cancel: cancel.clone(),
                adapter: adapter.clone(),
                runtime_started: Arc::new(AtomicBool::new(false)),
                settled: Arc::new(AtomicBool::new(false)),
                settled_notify: Arc::new(Notify::new()),
            };
            lock(&self.inner.active).insert(task.id.clone(), active.clone());
            self.emit_task(&task);
            let state = self.clone();
            tauri::async_runtime::spawn(async move {
                state.execute(task, active, permit).await;
            });
        }
    }

    pub(crate) async fn resume_after_failed_update(&self) -> Result<(), String> {
        let _scheduling = self.inner.scheduling.lock().await;
        if lock(&self.inner.active)
            .values()
            .any(|task| !task.settled.load(Ordering::Acquire))
        {
            return Err("Background work is still stopping.".into());
        }
        for task in self.store()?.recover_after_failed_update()? {
            self.emit_task(&task);
        }
        self.inner.stopping.store(false, Ordering::Release);
        self.kick();
        Ok(())
    }

    pub async fn shutdown(&self) {
        self.inner.stopping.store(true, Ordering::Release);
        let scheduling = self.inner.scheduling.lock().await;
        let active = lock(&self.inner.active)
            .values()
            .cloned()
            .collect::<Vec<_>>();
        drop(scheduling);
        for task in &active {
            task.cancel.cancel();
        }
        for task in &active {
            if task.runtime_started.load(Ordering::Acquire) {
                let _ = task.adapter.cancel(task.session_id.clone()).await;
            }
        }
        for task in &active {
            task.wait_until_settled().await;
        }
    }

    async fn execute(&self, task: ResearchTask, active: ActiveTask, permit: OwnedSemaphorePermit) {
        let adapter = active.adapter.clone();
        let cancel = active.cancel.clone();
        let store = match self.store() {
            Ok(store) => store,
            Err(_) => {
                self.finish_active(&task.id, task.execution_generation);
                active.mark_settled();
                drop(permit);
                self.kick();
                return;
            }
        };
        let isolation_store = store.clone();
        let isolation_task = task.clone();
        let isolation_cancel = cancel.clone();
        let isolation = tauri::async_runtime::spawn_blocking(move || {
            isolation::prepare(&isolation_store, &isolation_task, &isolation_cancel)
        })
        .await
        .map_err(|error| format!("Task isolation stopped unexpectedly: {error}"))
        .and_then(|result| result);
        let isolation = match isolation {
            Ok(isolation) => isolation,
            Err(error) => {
                if !cancel.is_cancelled() {
                    let _ = store.finish_failure(&task.id, task.execution_generation, &error);
                }
                self.settle_active(&store, &task.id, task.execution_generation, &active);
                if let Ok(task) = store.require(&task.id) {
                    self.emit_task(&task);
                }
                drop(permit);
                self.kick();
                return;
            }
        };
        match store.set_isolation(&task.id, task.execution_generation, &isolation) {
            Ok(true) => {}
            _ => {
                self.settle_active(&store, &task.id, task.execution_generation, &active);
                drop(permit);
                self.kick();
                return;
            }
        }
        if let Ok(task) = store.require(&task.id) {
            self.emit_task(&task);
        }
        if cancel.is_cancelled() {
            self.settle_active(&store, &task.id, task.execution_generation, &active);
            drop(permit);
            self.kick();
            return;
        }
        let recorder = Arc::new(TranscriptRecorder::new(
            store.clone(),
            self.clone(),
            task.id.clone(),
            task.execution_generation,
        ));
        let sink_recorder = recorder.clone();
        let events: TaskEventSink = Arc::new(move |event| sink_recorder.record(event));
        let context = TaskRunContext {
            task_id: task.id.clone(),
            execution_generation: task.execution_generation,
            session_id: task.session_id.clone().unwrap_or_default(),
            project_id: task.project_id.clone(),
            execution_root: isolation.execution_root.clone(),
            title: task.title.clone(),
            prompt: task.prompt.clone(),
            runtime_id: task.runtime_id.clone(),
            agent_id: task.agent_id.clone(),
            model_id: task.model_id.clone(),
            skill_ids: task.skill_ids.clone(),
            source_revision: isolation.source_revision.clone(),
            allowed_paths: isolation.allowed_paths.clone(),
        };
        active.runtime_started.store(true, Ordering::Release);
        let outcome = adapter.run(context, cancel.clone(), events).await;
        recorder.close();
        if cancel.is_cancelled() {
            self.settle_active(&store, &task.id, task.execution_generation, &active);
            if let Ok(task) = store.require(&task.id) {
                self.emit_task(&task);
            }
            drop(permit);
            self.kick();
            return;
        }
        match outcome {
            Ok(outcome) => {
                let review_isolation = isolation.clone();
                let review_cancel = cancel.clone();
                let changes = tauri::async_runtime::spawn_blocking(move || {
                    isolation::collect_review_changes(&review_isolation, &review_cancel)
                })
                .await
                .map_err(|error| format!("Task review stopped unexpectedly: {error}"))
                .and_then(|result| result);
                if cancel.is_cancelled() {
                    self.settle_active(&store, &task.id, task.execution_generation, &active);
                    drop(permit);
                    self.kick();
                    return;
                }
                match changes {
                    Ok(changed_files) => {
                        let artifacts = match validated_artifacts(outcome.artifacts, &changed_files)
                        {
                            Ok(artifacts) => artifacts,
                            Err(error) => {
                                let _ = store.finish_failure(
                                    &task.id,
                                    task.execution_generation,
                                    &error,
                                );
                                self.settle_active(
                                    &store,
                                    &task.id,
                                    task.execution_generation,
                                    &active,
                                );
                                if let Ok(task) = store.require(&task.id) {
                                    self.emit_task(&task);
                                }
                                drop(permit);
                                self.kick();
                                return;
                            }
                        };
                        let result = TaskResultMetadata {
                            summary: outcome.summary.chars().take(8_000).collect(),
                            changed_files,
                            artifacts,
                            native_session_id: outcome.native_session_id,
                            input_tokens: outcome.input_tokens,
                            output_tokens: outcome.output_tokens,
                        };
                        let _ = store.finish_success(&task.id, task.execution_generation, &result);
                    }
                    Err(error) => {
                        let _ = store.finish_failure(&task.id, task.execution_generation, &error);
                    }
                }
            }
            Err(error) => {
                let _ = store.finish_failure(&task.id, task.execution_generation, &error);
            }
        }
        self.settle_active(&store, &task.id, task.execution_generation, &active);
        if let Ok(task) = store.require(&task.id) {
            self.emit_task(&task);
        }
        drop(permit);
        self.kick();
    }

    fn kick(&self) {
        let state = self.clone();
        let future: Pin<Box<dyn Future<Output = Result<(), String>> + Send>> =
            Box::pin(async move { state.launch_ready().await });
        tauri::async_runtime::spawn(async move {
            let _ = future.await;
        });
    }

    fn finish_active(&self, task_id: &str, generation: u64) {
        let mut active = lock(&self.inner.active);
        if active
            .get(task_id)
            .is_some_and(|run| run.execution_generation == generation)
        {
            active.remove(task_id);
        }
    }

    fn settle_active(
        &self,
        store: &TaskStore,
        task_id: &str,
        generation: u64,
        active: &ActiveTask,
    ) {
        let cancellation_pending = store
            .require(task_id)
            .is_ok_and(|task| task.cancel_requested && task.execution_generation == generation);
        if !cancellation_pending {
            self.finish_active(task_id, generation);
        }
        active.mark_settled();
    }

    fn emit_task(&self, task: &ResearchTask) {
        if let Some(app) = lock(&self.inner.app).clone() {
            let _ = app.emit("research-task-changed", task);
        }
    }

    fn emit_event(&self, event: &TaskTranscriptEvent) {
        if let Some(app) = lock(&self.inner.app).clone() {
            let _ = app.emit("research-task-event", event);
        }
    }
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}

const MAX_TEXT_SEGMENT_BYTES: usize = 32 * 1024;

#[derive(Clone, Copy, PartialEq, Eq)]
enum TextSegmentKind {
    Text,
    Reasoning,
}

struct OpenSegment {
    kind: TextSegmentKind,
    sequence: u64,
    text: String,
}

impl OpenSegment {
    fn event(&self) -> TaskRuntimeEvent {
        match self.kind {
            TextSegmentKind::Text => TaskRuntimeEvent::Text {
                text: self.text.clone(),
            },
            TextSegmentKind::Reasoning => TaskRuntimeEvent::Reasoning {
                text: self.text.clone(),
            },
        }
    }
}

fn text_delta(event: &TaskRuntimeEvent) -> Option<(TextSegmentKind, &str)> {
    match event {
        TaskRuntimeEvent::Text { text } => Some((TextSegmentKind::Text, text)),
        TaskRuntimeEvent::Reasoning { text } => Some((TextSegmentKind::Reasoning, text)),
        _ => None,
    }
}

pub(crate) struct TranscriptRecorder {
    store: TaskStore,
    state: ResearchTaskState,
    task_id: String,
    generation: u64,
    open: Mutex<Option<OpenSegment>>,
}

impl TranscriptRecorder {
    fn new(store: TaskStore, state: ResearchTaskState, task_id: String, generation: u64) -> Self {
        Self {
            store,
            state,
            task_id,
            generation,
            open: Mutex::new(None),
        }
    }

    fn record(&self, event: TaskRuntimeEvent) {
        let Some((kind, delta)) = text_delta(&event) else {
            *lock(&self.open) = None;
            self.append(event);
            return;
        };
        let extended = {
            let mut open = lock(&self.open);
            match open.as_mut() {
                Some(segment)
                    if segment.kind == kind
                        && segment.text.len() + delta.len() <= MAX_TEXT_SEGMENT_BYTES =>
                {
                    segment.text.push_str(delta);
                    Some((segment.sequence, segment.event()))
                }
                _ => {
                    *open = None;
                    None
                }
            }
        };
        let Some((sequence, merged)) = extended else {
            self.open_segment(kind, event);
            return;
        };
        match self
            .store
            .replace_event(&self.task_id, self.generation, sequence, &merged)
        {
            Ok(Some(saved)) => self.state.emit_event(&saved),
            Ok(None) => {
                *lock(&self.open) = None;
                self.open_segment(kind, event);
            }
            Err(_) => *lock(&self.open) = None,
        }
    }

    fn open_segment(&self, kind: TextSegmentKind, event: TaskRuntimeEvent) {
        let Some(saved) = self.append(event) else {
            return;
        };
        let Some((_, text)) = text_delta(&saved.event) else {
            return;
        };
        *lock(&self.open) = Some(OpenSegment {
            kind,
            sequence: saved.sequence,
            text: text.to_string(),
        });
    }

    fn append(&self, event: TaskRuntimeEvent) -> Option<TaskTranscriptEvent> {
        if let TaskRuntimeEvent::SessionBound { native_session_id } = &event {
            let _ =
                self.store
                    .set_native_session(&self.task_id, self.generation, native_session_id);
        }
        match self
            .store
            .append_event(&self.task_id, self.generation, &event)
        {
            Ok(Some(saved)) => {
                self.state.emit_event(&saved);
                Some(saved)
            }
            _ => None,
        }
    }

    fn close(&self) {
        *lock(&self.open) = None;
    }
}

fn unavailable_skill(
    records: &[crate::skills::SkillRecord],
    skill_ids: &[String],
) -> Option<String> {
    skill_ids
        .iter()
        .find_map(|id| match records.iter().find(|record| record.id == *id) {
            Some(record) if record.is_available() => None,
            Some(_) => Some(format!(
                "The skill {id} is turned off. Enable it in Settings, AI, Skills."
            )),
            None => Some(format!("The skill {id} is not installed.")),
        })
}

fn ensure_skills_available(project_id: &str, skill_ids: &[String]) -> Result<(), String> {
    if skill_ids.is_empty() {
        return Ok(());
    }
    let root = crate::paths::oleafly_root()?;
    let pack = crate::skills_pack::cached_pack_root();
    let records = crate::skills::list_with(&root, pack.as_deref(), Some(project_id))?;
    match unavailable_skill(&records, skill_ids) {
        Some(error) => Err(error),
        None => Ok(()),
    }
}

fn project_is_missing(project_id: &str) -> bool {
    !crate::paths::project_dir(project_id)
        .map(|directory| directory.is_dir())
        .unwrap_or(false)
}

fn validated_artifacts(
    artifacts: Vec<TaskArtifact>,
    changes: &[TaskFileChange],
) -> Result<Vec<TaskArtifact>, String> {
    if artifacts.len() > 256 {
        return Err("The task returned more than 256 artifacts.".into());
    }
    let changed_paths = changes
        .iter()
        .filter(|change| change.after_sha256.is_some())
        .map(|change| change.path.as_str())
        .collect::<HashSet<_>>();
    let mut seen = HashSet::new();
    for artifact in &artifacts {
        isolation::normalized_relative(&artifact.path)?;
        if !changed_paths.contains(artifact.path.as_str()) {
            return Err(format!(
                "The task artifact {} has no reviewed output file.",
                artifact.path
            ));
        }
        if !seen.insert(artifact.path.as_str()) {
            return Err("The task returned the same artifact more than once.".into());
        }
        if artifact.label.trim().is_empty() || artifact.label.chars().count() > 200 {
            return Err("A task artifact label is missing or too long.".into());
        }
        if artifact
            .media_type
            .as_ref()
            .is_some_and(|media_type| media_type.len() > 120 || media_type.contains('\0'))
        {
            return Err("A task artifact media type is invalid.".into());
        }
    }
    Ok(artifacts)
}

// Store initialization, SQLite queries, and preview file reads can block on
// disk or another connection. Keep them off the main WebView event loop.
async fn blocking_task_command<T: Send + 'static>(
    state: &ResearchTaskState,
    operation: impl FnOnce(&ResearchTaskState) -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    let state = state.clone();
    tauri::async_runtime::spawn_blocking(move || operation(&state))
        .await
        .map_err(|error| format!("task storage worker failed: {error}"))?
}

#[tauri::command]
pub async fn research_task_list(
    state: tauri::State<'_, ResearchTaskState>,
    project_id: String,
) -> Result<Vec<ResearchTask>, String> {
    blocking_task_command(&state, move |state| {
        crate::paths::validate_project_id(&project_id)?;
        state.store()?.list(&project_id)
    })
    .await
}

#[tauri::command]
pub async fn research_task_create(
    state: tauri::State<'_, ResearchTaskState>,
    draft: ResearchTaskDraft,
) -> Result<ResearchTask, String> {
    blocking_task_command(&state, move |state| {
        crate::paths::validate_project_id(&draft.project_id)?;
        crate::paths::project_dir(&draft.project_id)?;
        ensure_skills_available(&draft.project_id, &draft.skill_ids)?;
        let task = state.store()?.create(draft)?;
        state.emit_task(&task);
        Ok(task)
    })
    .await
}

#[tauri::command]
pub async fn research_task_edit(
    state: tauri::State<'_, ResearchTaskState>,
    task_id: String,
    edit: ResearchTaskEdit,
) -> Result<ResearchTask, String> {
    blocking_task_command(&state, move |state| {
        let task = state.store()?.edit(&task_id, edit)?;
        state.emit_task(&task);
        Ok(task)
    })
    .await
}

#[tauri::command]
pub async fn research_task_start(
    app: tauri::AppHandle,
    state: tauri::State<'_, ResearchTaskState>,
    task_id: String,
) -> Result<ResearchTask, String> {
    state.attach_app(app);
    let requested_id = task_id.clone();
    blocking_task_command(&state, move |state| {
        let store = state.store()?;
        let current = store.require(&requested_id)?;
        state.runtime_for(&current.runtime_id, &current.agent_id)?;
        state.emit_task(&store.request_start(&requested_id)?);
        Ok(())
    })
    .await?;
    state.launch_ready().await?;
    blocking_task_command(&state, move |state| state.store()?.require(&task_id)).await
}

#[tauri::command]
pub async fn research_task_cancel(
    app: tauri::AppHandle,
    state: tauri::State<'_, ResearchTaskState>,
    task_id: String,
) -> Result<ResearchTask, String> {
    state.attach_app(app);
    cancel_task(&state, task_id).await
}

async fn cancel_task(state: &ResearchTaskState, task_id: String) -> Result<ResearchTask, String> {
    let requested_id = task_id.clone();
    let (cancellation, mut active) = blocking_task_command(state, move |state| {
        let store = state.store()?;
        let current = store.require(&requested_id)?;
        let active = if current.status == ResearchTaskStatus::Running {
            lock(&state.inner.active).get(&requested_id).cloned()
        } else {
            None
        };
        Ok((store.request_cancel(&requested_id)?, active))
    })
    .await?;
    if cancellation.status == ResearchTaskStatus::Cancelled {
        state.emit_task(&cancellation);
        state.launch_ready().await?;
        return Ok(cancellation);
    }
    for _ in 0..50 {
        if active.is_some() {
            break;
        }
        active = lock(&state.inner.active).get(&task_id).cloned();
        if active.is_none() {
            tokio::time::sleep(std::time::Duration::from_millis(10)).await;
        }
    }
    let active = active.ok_or_else(|| {
        "The task is stopping, but its runtime is no longer attached. Restart Oleafly to recover it safely."
            .to_string()
    })?;
    active.cancel.cancel();
    let runtime_cancel = if active.runtime_started.load(Ordering::Acquire) {
        active.adapter.cancel(active.session_id.clone()).await
    } else {
        Ok(())
    };
    active.wait_until_settled().await;
    runtime_cancel?;
    let generation = active.execution_generation;
    let settle_id = task_id.clone();
    blocking_task_command(state, move |state| {
        if !state.store()?.finalize_cancel(&settle_id, generation)? {
            return Err("The task changed before cancellation finished.".into());
        }
        state.finish_active(&settle_id, generation);
        state.emit_task(&state.store()?.require(&settle_id)?);
        Ok(())
    })
    .await?;
    state.launch_ready().await?;
    blocking_task_command(state, move |state| state.store()?.require(&task_id)).await
}

#[tauri::command]
pub async fn research_task_retry(
    state: tauri::State<'_, ResearchTaskState>,
    task_id: String,
) -> Result<ResearchTask, String> {
    blocking_task_command(&state, move |state| {
        let task = state.store()?.retry(&task_id)?;
        state.emit_task(&task);
        Ok(task)
    })
    .await
}

#[tauri::command]
pub async fn research_task_events(
    state: tauri::State<'_, ResearchTaskState>,
    task_id: String,
    execution_generation: u64,
    after_sequence: Option<u64>,
    limit: Option<usize>,
) -> Result<TaskTranscriptPage, String> {
    blocking_task_command(&state, move |state| {
        state.store()?.events(
            &task_id,
            execution_generation,
            after_sequence,
            limit.unwrap_or(100),
        )
    })
    .await
}

#[tauri::command]
pub async fn research_task_file_preview(
    state: tauri::State<'_, ResearchTaskState>,
    task_id: String,
    path: String,
) -> Result<TaskFilePreview, String> {
    blocking_task_command(&state, move |state| {
        preview::file_preview(&state.store()?, &task_id, &path)
    })
    .await
}

#[tauri::command]
pub async fn research_task_artifact_preview(
    state: tauri::State<'_, ResearchTaskState>,
    task_id: String,
    path: String,
) -> Result<TaskArtifactPreview, String> {
    blocking_task_command(&state, move |state| {
        preview::artifact_preview(&state.store()?, &task_id, &path)
    })
    .await
}

#[tauri::command]
pub async fn research_task_apply(
    app: tauri::AppHandle,
    app_state: tauri::State<'_, crate::state::AppState>,
    state: tauri::State<'_, ResearchTaskState>,
    request: TaskApplyRequest,
) -> Result<TaskApplyResult, String> {
    state.attach_app(app.clone());
    let admitted = request.clone();
    let task = blocking_task_command(&state, move |state| {
        let store = state.store()?;
        let task = store.require(&admitted.task_id)?;
        if task.status != ResearchTaskStatus::AwaitingReview {
            return Err("This task is not waiting for review.".into());
        }
        store.begin_apply(
            &task.id,
            task.execution_generation,
            admitted.expected_project_generation,
            &admitted.selected_paths,
        )?;
        Ok(task)
    })
    .await?;
    let store = state.store()?;
    let apply_store = store.clone();
    let apply_task = task.clone();
    let selected_paths = request.selected_paths.clone();
    let mutation = crate::project::mutate_project_worktree(
        &app_state,
        task.project_id.clone(),
        Some(request.expected_project_generation),
        move |project_root| {
            apply::apply_review(&apply_store, &apply_task, project_root, &selected_paths)
                .map(|changed| ((), changed))
        },
    )
    .await;
    let failed = match &mutation {
        Err(error) => Some(error.clone()),
        Ok(mutation) => mutation.value.as_ref().err().cloned(),
    };
    if let Some(error) = failed {
        let failed_task = task.clone();
        let reported = error.clone();
        blocking_task_command(&state, move |state| {
            let store = state.store()?;
            if !apply::has_recovery_journal(&store, &failed_task)? {
                store.clear_apply(&failed_task.id, Some(&reported))?;
            }
            Ok(())
        })
        .await?;
        return Err(error);
    }
    let mutation = mutation?;
    let review = TaskReviewResult {
        selected_paths: request.selected_paths,
        applied_at: now_ms(),
        project_mutation_generation: mutation.generation,
    };
    let completed_id = task.id.clone();
    let task = blocking_task_command(&state, move |state| {
        let task = state.store()?.complete_apply(&completed_id, &review)?;
        state.emit_task(&task);
        Ok(task)
    })
    .await?;
    let project_state = crate::project::publish_project_state_changed(
        &app,
        &app_state,
        &task.project_id,
        mutation.project,
        "research-task-apply",
        true,
        Some(mutation.generation),
    )?;
    state.launch_ready().await?;
    Ok(TaskApplyResult {
        task,
        project_state,
    })
}

#[tauri::command]
pub async fn research_task_delete(
    state: tauri::State<'_, ResearchTaskState>,
    task_id: String,
) -> Result<(), String> {
    blocking_task_command(&state, move |state| {
        let store = state.store()?;
        let task = store.require(&task_id)?;
        if task.status == ResearchTaskStatus::Running {
            return Err("Stop this task before deleting it.".into());
        }
        store.delete(&task_id)?;
        let workspace_root = isolation::task_workspace_root(store.root(), &task_id);
        let project_root = crate::paths::project_dir(&task.project_id).ok();
        isolation::purge_task_workspaces(project_root.as_deref(), &workspace_root);
        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn research_task_accept_result(
    state: tauri::State<'_, ResearchTaskState>,
    task_id: String,
) -> Result<ResearchTask, String> {
    let task = blocking_task_command(&state, move |state| {
        let task = state.store()?.complete_without_apply(&task_id)?;
        state.emit_task(&task);
        Ok(task)
    })
    .await?;
    state.launch_ready().await?;
    Ok(task)
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
    use std::time::Duration;

    use super::*;

    #[tokio::test(flavor = "current_thread")]
    async fn task_storage_queries_leave_the_calling_thread_and_preserve_errors() {
        let temp = tempfile::tempdir().unwrap();
        let state = ResearchTaskState::for_test(temp.path().join("tasks"), 1);
        let caller = std::thread::current().id();
        let (worker, tasks) = blocking_task_command(&state, |state| {
            Ok((std::thread::current().id(), state.store()?.list("paper")?))
        })
        .await
        .unwrap();
        assert_ne!(worker, caller);
        assert!(tasks.is_empty());
        let error = blocking_task_command::<()>(&state, |_| Err("storage failed".into()))
            .await
            .unwrap_err();
        assert_eq!(error, "storage failed");
    }

    #[test]
    fn async_storage_commands_preserve_task_lifecycle_and_preview_errors() {
        use tauri::Manager as _;

        let _env = crate::paths::data_dir_env_lock();
        let temp = tempfile::tempdir().unwrap();
        std::env::set_var("OLEAFLY_DATA_DIR", temp.path());
        let project = crate::paths::create_project_dir("command-paper").unwrap();
        std::fs::write(project.join("main.tex"), "original source").unwrap();
        let app = tauri::test::mock_builder()
            .manage(ResearchTaskState::for_test(temp.path().join("tasks"), 1))
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .unwrap();
        tauri::async_runtime::block_on(async {
            let state = || app.state::<ResearchTaskState>();
            assert!(research_task_list(state(), "../outside".into())
                .await
                .is_err());
            let draft = ResearchTaskDraft {
                project_id: "command-paper".into(),
                title: "Review source".into(),
                prompt: "Check the manuscript".into(),
                runtime_id: "fixture".into(),
                agent_id: "fixture-agent".into(),
                model_id: "fixture-model".into(),
                skill_ids: Vec::new(),
                dependency_ids: Vec::new(),
            };
            let task = research_task_create(state(), draft.clone()).await.unwrap();
            assert_eq!(task.status, ResearchTaskStatus::Queued);
            assert_eq!(
                research_task_list(state(), draft.project_id.clone())
                    .await
                    .unwrap(),
                vec![task.clone()]
            );
            let edited = research_task_edit(
                state(),
                task.id.clone(),
                ResearchTaskEdit {
                    title: "Revised review".into(),
                    prompt: draft.prompt,
                    runtime_id: draft.runtime_id,
                    agent_id: draft.agent_id,
                    model_id: draft.model_id,
                    skill_ids: Vec::new(),
                    dependency_ids: Vec::new(),
                },
            )
            .await
            .unwrap();
            assert_eq!(edited.title, "Revised review");
            assert!(research_task_retry(state(), task.id.clone())
                .await
                .unwrap_err()
                .contains("failed or cancelled"));
            state().store().unwrap().request_cancel(&task.id).unwrap();
            let retried = research_task_retry(state(), task.id.clone()).await.unwrap();
            assert_eq!(retried.status, ResearchTaskStatus::Queued);
            assert_eq!(retried.title, edited.title);
            let transcript = research_task_events(state(), task.id.clone(), 0, None, None)
                .await
                .unwrap();
            assert!(transcript.events.is_empty());
            assert_eq!(transcript.next_sequence, None);
            for path in ["main.tex", "../outside"] {
                let expected_file =
                    preview::file_preview(&state().store().unwrap(), &task.id, path).unwrap_err();
                assert_eq!(
                    research_task_file_preview(state(), task.id.clone(), path.into())
                        .await
                        .unwrap_err(),
                    expected_file
                );
                let expected_artifact =
                    preview::artifact_preview(&state().store().unwrap(), &task.id, path)
                        .unwrap_err();
                assert_eq!(
                    research_task_artifact_preview(state(), task.id.clone(), path.into())
                        .await
                        .unwrap_err(),
                    expected_artifact
                );
            }
            assert_eq!(
                std::fs::read_to_string(project.join("main.tex")).unwrap(),
                "original source"
            );
        });
        std::env::remove_var("OLEAFLY_DATA_DIR");
    }

    struct FixtureRuntime {
        runs: AtomicUsize,
    }

    struct BlockingRuntime {
        runs: AtomicUsize,
        settled: Arc<AtomicBool>,
    }

    impl TaskRuntimeAdapter for FixtureRuntime {
        fn supports(&self, agent_id: &str) -> bool {
            agent_id == "fixture-agent"
        }

        fn run(
            &self,
            context: TaskRunContext,
            _cancel: CancellationToken,
            events: TaskEventSink,
        ) -> TaskRuntimeFuture<TaskRuntimeOutcome> {
            self.runs.fetch_add(1, Ordering::SeqCst);
            Box::pin(async move {
                events(TaskRuntimeEvent::Status {
                    message: "Working".into(),
                });
                std::fs::write(
                    PathBuf::from(context.execution_root).join("main.tex"),
                    "revised",
                )
                .map_err(|error| error.to_string())?;
                Ok(TaskRuntimeOutcome {
                    summary: "Revised the manuscript".into(),
                    artifacts: Vec::new(),
                    native_session_id: Some("fixture-native".into()),
                    input_tokens: Some(10),
                    output_tokens: Some(5),
                })
            })
        }

        fn cancel(&self, _session_id: String) -> TaskRuntimeFuture<()> {
            Box::pin(async { Ok(()) })
        }
    }

    impl TaskRuntimeAdapter for BlockingRuntime {
        fn supports(&self, agent_id: &str) -> bool {
            agent_id == "fixture-agent"
        }

        fn run(
            &self,
            _context: TaskRunContext,
            cancel: CancellationToken,
            _events: TaskEventSink,
        ) -> TaskRuntimeFuture<TaskRuntimeOutcome> {
            self.runs.fetch_add(1, Ordering::SeqCst);
            let settled = self.settled.clone();
            Box::pin(async move {
                cancel.cancelled().await;
                settled.store(true, Ordering::SeqCst);
                Err("cancelled".into())
            })
        }

        fn cancel(&self, _session_id: String) -> TaskRuntimeFuture<()> {
            Box::pin(async { Ok(()) })
        }
    }

    #[tokio::test]
    async fn review_cancellation_does_not_need_an_attached_runtime() {
        let temp = tempfile::tempdir().unwrap();
        let state = ResearchTaskState::for_test(temp.path().join("tasks"), 1);
        let store = state.store().unwrap();
        let task = store
            .create(ResearchTaskDraft {
                project_id: "paper".into(),
                title: "Revise".into(),
                prompt: "Revise the manuscript".into(),
                runtime_id: "unavailable-runtime".into(),
                agent_id: "unavailable-agent".into(),
                model_id: "model".into(),
                skill_ids: Vec::new(),
                dependency_ids: Vec::new(),
            })
            .unwrap();
        store.request_start(&task.id).unwrap();
        let claimed = store.claim_next().unwrap().unwrap();
        let result = TaskResultMetadata {
            summary: "Saved changes for review".into(),
            changed_files: vec![model::TaskFileChange {
                path: "main.tex".into(),
                kind: model::TaskFileChangeKind::Modified,
                before_sha256: Some("before".into()),
                after_sha256: Some("after".into()),
                before_size: Some(4),
                after_size: Some(8),
            }],
            artifacts: Vec::new(),
            native_session_id: None,
            input_tokens: None,
            output_tokens: None,
        };
        assert!(store
            .finish_success(&task.id, claimed.execution_generation, &result)
            .unwrap());
        let cancelled = cancel_task(&state, task.id).await.unwrap();
        assert_eq!(cancelled.status, ResearchTaskStatus::Cancelled);
        assert_eq!(cancelled.result, Some(result));
        assert!(lock(&state.inner.active).is_empty());
        assert!(lock(&state.inner.runtimes).is_empty());
    }

    #[tokio::test]
    #[allow(clippy::await_holding_lock)]
    async fn queue_runs_registered_adapters_and_persists_review_state() {
        let _env = crate::paths::data_dir_env_lock();
        let temp = tempfile::tempdir().unwrap();
        std::env::set_var("OLEAFLY_DATA_DIR", temp.path());
        let project = crate::paths::create_project_dir("paper").unwrap();
        std::fs::write(project.join("main.tex"), "base").unwrap();
        let state = ResearchTaskState::for_test(temp.path().join("tasks"), 1);
        let runtime = Arc::new(FixtureRuntime {
            runs: AtomicUsize::new(0),
        });
        state.register_runtime("fixture", runtime.clone()).unwrap();
        let store = state.store().unwrap();
        let task = store
            .create(ResearchTaskDraft {
                project_id: "paper".into(),
                title: "Revise".into(),
                prompt: "Revise the manuscript".into(),
                runtime_id: "fixture".into(),
                agent_id: "fixture-agent".into(),
                model_id: "fixture-model".into(),
                skill_ids: Vec::new(),
                dependency_ids: Vec::new(),
            })
            .unwrap();
        let second = store
            .create(ResearchTaskDraft {
                project_id: "paper".into(),
                title: "Review".into(),
                prompt: "Review the manuscript".into(),
                runtime_id: "fixture".into(),
                agent_id: "fixture-agent".into(),
                model_id: "fixture-model".into(),
                skill_ids: Vec::new(),
                dependency_ids: Vec::new(),
            })
            .unwrap();
        store.request_start(&task.id).unwrap();
        store.request_start(&second.id).unwrap();

        state.launch_ready().await.unwrap();
        for _ in 0..100 {
            if store.require(&task.id).unwrap().status == ResearchTaskStatus::AwaitingReview
                && store.require(&second.id).unwrap().status == ResearchTaskStatus::AwaitingReview
            {
                break;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }

        let finished = store.require(&task.id).unwrap();
        let second_finished = store.require(&second.id).unwrap();
        assert_eq!(runtime.runs.load(Ordering::SeqCst), 2);
        assert_eq!(finished.status, ResearchTaskStatus::AwaitingReview);
        assert_eq!(second_finished.status, ResearchTaskStatus::AwaitingReview);
        assert_eq!(finished.result.unwrap().changed_files.len(), 1);
        assert_eq!(
            std::fs::read_to_string(project.join("main.tex")).unwrap(),
            "base"
        );
        std::env::remove_var("OLEAFLY_DATA_DIR");
    }

    #[tokio::test]
    async fn shutdown_stops_admitted_work_and_waits_for_runtime_settlement() {
        verify_shutdown_recovery(false).await;
    }

    #[tokio::test]
    async fn failed_update_recovers_settled_tasks_and_resumes_queued_work() {
        verify_shutdown_recovery(true).await;
    }

    #[allow(clippy::await_holding_lock)]
    async fn verify_shutdown_recovery(resume: bool) {
        let _env = crate::paths::data_dir_env_lock();
        let temp = tempfile::tempdir().unwrap();
        std::env::set_var("OLEAFLY_DATA_DIR", temp.path());
        let project = crate::paths::create_project_dir("shutdown-paper").unwrap();
        std::fs::write(project.join("main.tex"), "base").unwrap();
        let state = ResearchTaskState::for_test(temp.path().join("tasks"), 1);
        let settled = Arc::new(AtomicBool::new(false));
        let runtime = Arc::new(BlockingRuntime {
            runs: AtomicUsize::new(0),
            settled: settled.clone(),
        });
        state.register_runtime("fixture", runtime.clone()).unwrap();
        let store = state.store().unwrap();
        let task = store
            .create(ResearchTaskDraft {
                project_id: "shutdown-paper".into(),
                title: "Keep working".into(),
                prompt: "Wait until shutdown".into(),
                runtime_id: "fixture".into(),
                agent_id: "fixture-agent".into(),
                model_id: "fixture-model".into(),
                skill_ids: Vec::new(),
                dependency_ids: Vec::new(),
            })
            .unwrap();
        store.request_start(&task.id).unwrap();
        state.launch_ready().await.unwrap();
        for _ in 0..200 {
            if runtime.runs.load(Ordering::SeqCst) == 1 {
                break;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }

        tokio::time::timeout(Duration::from_secs(2), state.shutdown())
            .await
            .unwrap();

        assert!(settled.load(Ordering::SeqCst));
        assert!(lock(&state.inner.active).is_empty());
        assert_eq!(
            store.require(&task.id).unwrap().status,
            ResearchTaskStatus::Running
        );
        let later = store
            .create(ResearchTaskDraft {
                project_id: "shutdown-paper".into(),
                title: "Do not start".into(),
                prompt: "Stay queued".into(),
                runtime_id: "fixture".into(),
                agent_id: "fixture-agent".into(),
                model_id: "fixture-model".into(),
                skill_ids: Vec::new(),
                dependency_ids: Vec::new(),
            })
            .unwrap();
        store.request_start(&later.id).unwrap();
        state.launch_ready().await.unwrap();
        assert_eq!(runtime.runs.load(Ordering::SeqCst), 1);
        assert_eq!(
            store.require(&later.id).unwrap().status,
            ResearchTaskStatus::Queued
        );
        if resume {
            state.resume_after_failed_update().await.unwrap();
            let recovered = store.require(&task.id).unwrap();
            assert_eq!(recovered.status, ResearchTaskStatus::Failed);
            assert!(recovered.error.unwrap().contains("update"));
            store.retry(&task.id).unwrap();
            tokio::time::timeout(Duration::from_secs(2), async {
                while runtime.runs.load(Ordering::SeqCst) < 2 {
                    tokio::task::yield_now().await;
                }
            })
            .await
            .unwrap();
            state.shutdown().await;
        }
        std::env::remove_var("OLEAFLY_DATA_DIR");
    }
}
