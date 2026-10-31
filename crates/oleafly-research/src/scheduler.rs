use std::collections::{HashMap, HashSet};
use std::future::Future;
use std::path::{Path, PathBuf};
use std::pin::Pin;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{Duration, Instant};

use oleafly_agent::CancellationToken;
use tokio::sync::{Notify, OwnedSemaphorePermit, Semaphore};

use crate::approvals::ApprovalQueue;
use crate::budget::{BudgetClock, BudgetClocks, BudgetKind, HARD_STOP_AFTER};
use crate::handoff::{HandoffReason, HandoffRecord, TaskGrant};
use crate::host::{
    IsolationEnv, Notification, NotificationKind, OwnerKind, ResearchHost, WorkspaceTools,
};
use crate::isolation;
use crate::keep_awake::KeepAwake;
use crate::model::{
    ApprovalStatus, CommandPolicy, HandoffResume, PendingStart, ResearchTask, ResearchTaskDraft,
    ResearchTaskEdit, ResearchTaskStatus, ResumeContext, ResumeReason, RetryMode, StopReason,
    SuspendState, TaskArtifact, TaskFileChange, TaskIsolation, TaskPhase, TaskPlanText,
    TaskResultMetadata, TaskRunContext, TaskRuntimeEvent, TaskRuntimeOutcome, TaskTranscriptDelta,
    TaskTranscriptEvent, TaskTranscriptPage,
};
use crate::record;
use crate::recorder::{TranscriptRecorder, TranscriptWriter};
use crate::runs::{LocalExecutor, RunManager};
use crate::store::TaskStore;

pub type TaskRuntimeFuture<T> = Pin<Box<dyn Future<Output = Result<T, String>> + Send>>;
pub type TaskEventSink = Arc<dyn Fn(TaskRuntimeEvent) + Send + Sync>;

pub const NOT_ATTACHED: &str = "Research tasks are still starting. Try again in a moment.";
const PLAN_MISSING: &str = "The agent finished without writing plan.md. Retry the task.";
const PLAN_TOO_LONG: &str =
    "The plan is longer than 64 KiB, so the end of it isn't shown. Edit it down before you approve it.";
const WORKSPACE_GONE: &str = "The saved workspace is gone. Start over instead.";
const RESUME_FILE_BYTES: usize = 16 * 1024;
const RESUME_LEDGER_ROWS: usize = 20;
const MAX_PLAN_BYTES: usize = 64 * 1024;
const ATTENTION_DEBOUNCE: Duration = Duration::from_millis(250);
#[cfg(not(test))]
const BUDGET_WATCH_EVERY: Duration = Duration::from_secs(5);
#[cfg(test)]
const BUDGET_WATCH_EVERY: Duration = Duration::from_millis(20);

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
pub struct TaskServices {
    pub runs: Arc<RunManager>,
    pub tasks_root: PathBuf,
    pub clocks: Arc<BudgetClocks>,
    pub approvals: Arc<ApprovalQueue>,
    pub workspace: Option<Arc<dyn WorkspaceTools>>,
    pub suspends: Arc<SuspendSignals>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SuspendMode {
    Graceful,
    Prompt,
}

pub use crate::approvals::APPROVAL_WITHDRAWN;

struct SuspendEntry {
    generation: u64,
    step: CancellationToken,
    approvals: CancellationToken,
    state: Option<SuspendState>,
}

#[derive(Default)]
pub struct SuspendSignals {
    entries: Mutex<HashMap<String, SuspendEntry>>,
}

impl SuspendSignals {
    pub fn token(&self, task_id: &str) -> CancellationToken {
        lock(&self.entries)
            .get(task_id)
            .map(|entry| entry.step.clone())
            .unwrap_or_default()
    }

    pub fn approvals(&self, task_id: &str) -> CancellationToken {
        lock(&self.entries)
            .get(task_id)
            .map(|entry| entry.approvals.clone())
            .unwrap_or_default()
    }

    pub fn requested(&self, task_id: &str) -> bool {
        lock(&self.entries)
            .get(task_id)
            .is_some_and(|entry| entry.step.is_cancelled())
    }

    pub fn record(&self, task_id: &str, state: SuspendState) {
        if let Some(entry) = lock(&self.entries).get_mut(task_id) {
            entry.state = Some(state);
        }
    }

    pub(crate) fn begin(&self, task_id: &str, generation: u64) {
        lock(&self.entries).insert(
            task_id.to_owned(),
            SuspendEntry {
                generation,
                step: CancellationToken::new(),
                approvals: CancellationToken::new(),
                state: None,
            },
        );
    }

    pub(crate) fn signal(&self, task_id: &str, mode: SuspendMode) {
        if let Some(entry) = lock(&self.entries).get(task_id) {
            entry.step.cancel();
            if mode == SuspendMode::Prompt {
                entry.approvals.cancel();
            }
        }
    }

    pub(crate) fn take_state(&self, task_id: &str, generation: u64) -> Option<SuspendState> {
        lock(&self.entries)
            .get_mut(task_id)
            .filter(|entry| entry.generation == generation)
            .and_then(|entry| entry.state.take())
    }

    pub(crate) fn end(&self, task_id: &str, generation: u64) {
        let mut entries = lock(&self.entries);
        if entries
            .get(task_id)
            .is_some_and(|entry| entry.generation == generation)
        {
            entries.remove(task_id);
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum SuspendResult {
    Suspended {
        generation: u64,
        state: SuspendState,
    },
    Stopped {
        generation: u64,
    },
    Unstarted {
        generation: u64,
    },
    NotRunning,
}

pub fn handoff_record_for(
    result: &SuspendResult,
    from: OwnerKind,
    to: OwnerKind,
    reason: HandoffReason,
) -> Option<(u64, HandoffRecord)> {
    match result {
        SuspendResult::Suspended { generation, state } => {
            let mut record = HandoffRecord::new(from, to, reason, *generation);
            record.conversation = state.conversation.clone();
            record.turn_interrupted = state.turn_interrupted;
            record.acp = state.acp.clone();
            Some((*generation, record))
        }
        SuspendResult::Stopped { generation } => {
            let mut record = HandoffRecord::new(from, to, reason, *generation);
            record.turn_interrupted = true;
            Some((*generation, record))
        }
        SuspendResult::Unstarted { generation } => Some((
            *generation,
            HandoffRecord::new(from, to, reason, *generation),
        )),
        SuspendResult::NotRunning => None,
    }
}

#[derive(Clone)]
pub struct ResearchTaskState {
    pub(crate) inner: Arc<ResearchTaskStateInner>,
}

pub(crate) struct ResearchTaskStateInner {
    root: Result<PathBuf, String>,
    pub(crate) concurrency: Arc<Semaphore>,
    parked: Arc<Semaphore>,
    scheduling: tokio::sync::Mutex<()>,
    stopping: AtomicBool,
    launch_hold: AtomicBool,
    enabled: AtomicBool,
    pub(crate) active: Mutex<HashMap<String, ActiveTask>>,
    pub(crate) runtimes: Mutex<HashMap<String, Arc<dyn TaskRuntimeAdapter>>>,
    host: Mutex<Option<Arc<dyn ResearchHost>>>,
    runtime: Mutex<Option<tokio::runtime::Handle>>,
    services: Mutex<Option<TaskServices>>,
    writer: TranscriptWriter,
    keep_awake: KeepAwake,
    attention_pending: AtomicBool,
    wake_generation: AtomicU64,
    wake_timer: Mutex<Option<tokio::task::JoinHandle<()>>>,
    suspends: Arc<SuspendSignals>,
    foreign_inflight: Mutex<HashSet<String>>,
}

#[derive(Clone)]
pub(crate) struct ActiveTask {
    pub(crate) execution_generation: u64,
    pub(crate) session_id: String,
    pub(crate) cancel: CancellationToken,
    pub(crate) adapter: Arc<dyn TaskRuntimeAdapter>,
    pub(crate) runtime_started: Arc<AtomicBool>,
    pub(crate) settled: Arc<AtomicBool>,
    settled_notify: Arc<Notify>,
    pub(crate) handing_off: Arc<AtomicBool>,
    pub(crate) suspended: Arc<Mutex<Option<SuspendState>>>,
    slot: Arc<Mutex<Option<OwnedSemaphorePermit>>>,
    lent: Arc<Mutex<Option<OwnedSemaphorePermit>>>,
}

impl ActiveTask {
    fn lend_slot(&self, parked: &Arc<Semaphore>) -> bool {
        let Ok(lent) = parked.clone().try_acquire_owned() else {
            return false;
        };
        if lock(&self.slot).take().is_none() {
            return false;
        }
        *lock(&self.lent) = Some(lent);
        true
    }

    fn retake_slot(&self, concurrency: &Arc<Semaphore>) {
        if lock(&self.lent).take().is_none() {
            return;
        }
        if let Ok(permit) = concurrency.clone().try_acquire_owned() {
            *lock(&self.slot) = Some(permit);
        }
    }

    fn release_slots(&self) {
        drop(lock(&self.slot).take());
        drop(lock(&self.lent).take());
    }

    fn mark_settled(&self) {
        self.settled.store(true, Ordering::Release);
        self.settled_notify.notify_waiters();
    }

    pub(crate) async fn wait_until_settled(&self) {
        loop {
            let notified = self.settled_notify.notified();
            if self.settled.load(Ordering::Acquire) {
                return;
            }
            notified.await;
        }
    }
}

enum RunEnd {
    Cancelled,
    Finished(Result<TaskRuntimeOutcome, String>),
}

impl ResearchTaskState {
    pub fn new(root: Result<PathBuf, String>, max_concurrent: usize) -> Self {
        Self {
            inner: Arc::new(ResearchTaskStateInner {
                writer: TranscriptWriter::new(root.clone()),
                root,
                concurrency: Arc::new(Semaphore::new(max_concurrent.clamp(1, 8))),
                parked: Arc::new(Semaphore::new(max_concurrent.clamp(1, 8))),
                scheduling: tokio::sync::Mutex::new(()),
                stopping: AtomicBool::new(false),
                launch_hold: AtomicBool::new(false),
                enabled: AtomicBool::new(true),
                active: Mutex::new(HashMap::new()),
                runtimes: Mutex::new(HashMap::new()),
                host: Mutex::new(None),
                runtime: Mutex::new(None),
                services: Mutex::new(None),
                keep_awake: KeepAwake::new(),
                attention_pending: AtomicBool::new(false),
                wake_generation: AtomicU64::new(0),
                wake_timer: Mutex::new(None),
                suspends: Arc::new(SuspendSignals::default()),
                foreign_inflight: Mutex::new(HashSet::new()),
            }),
        }
    }

    #[cfg(any(test, feature = "test-support"))]
    pub fn for_test(root: PathBuf, max_concurrent: usize) -> Self {
        Self::new(Ok(root), max_concurrent)
    }

    #[cfg(any(test, feature = "test-support"))]
    pub fn active_count(&self) -> usize {
        lock(&self.inner.active).len()
    }

    #[cfg(any(test, feature = "test-support"))]
    pub fn runtime_count(&self) -> usize {
        lock(&self.inner.runtimes).len()
    }

    #[cfg(any(test, feature = "test-support"))]
    pub fn settle_waiter(
        &self,
        task_id: &str,
    ) -> Option<impl Future<Output = ()> + Send + 'static> {
        let active = lock(&self.inner.active).get(task_id).cloned()?;
        Some(async move { active.wait_until_settled().await })
    }

    pub fn attach(&self, host: Arc<dyn ResearchHost>, runtime: tokio::runtime::Handle) {
        if let Ok(root) = self.inner.root.clone() {
            let runs = RunManager::new(root.clone(), runtime.clone());
            let local = host.supervisor_command().map(LocalExecutor::new);
            #[cfg(test)]
            let local = local.or_else(|| Some(LocalExecutor::in_process()));
            if let Some(local) = local {
                runs.register_executor(Arc::new(local));
            }
            let data_root = root
                .parent()
                .map(Path::to_path_buf)
                .unwrap_or_else(|| root.clone());
            let compute = host
                .compute_host()
                .unwrap_or_else(|| Arc::new(crate::runs::remote::PathComputeHost::new(data_root)));
            crate::runs::remote::register(&runs, compute);
            let clocks = Arc::new(BudgetClocks::default());
            let approvals = ApprovalQueue::new(root.clone(), clocks.clone());
            *lock(&self.inner.services) = Some(TaskServices {
                runs,
                tasks_root: root,
                clocks,
                approvals,
                workspace: host.workspace_tools(),
                suspends: self.inner.suspends.clone(),
            });
        }
        *lock(&self.inner.host) = Some(host);
        *lock(&self.inner.runtime) = Some(runtime);
    }

    fn host(&self) -> Result<Arc<dyn ResearchHost>, String> {
        lock(&self.inner.host)
            .clone()
            .ok_or_else(|| NOT_ATTACHED.to_string())
    }

    pub fn services(&self) -> Result<TaskServices, String> {
        lock(&self.inner.services)
            .clone()
            .ok_or_else(|| NOT_ATTACHED.to_string())
    }

    fn runtime(&self) -> tokio::runtime::Handle {
        lock(&self.inner.runtime)
            .clone()
            .unwrap_or_else(tokio::runtime::Handle::current)
    }

    pub(crate) fn runtime_handle(&self) -> tokio::runtime::Handle {
        self.runtime()
    }

    pub(crate) fn writer(&self) -> &TranscriptWriter {
        &self.inner.writer
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

    pub fn disown_on_exit(&self) {
        if let Ok(store) = self.store() {
            let _ = store.disown_current();
        }
    }

    pub fn root(&self) -> Result<PathBuf, String> {
        self.inner.root.clone()
    }

    pub fn store(&self) -> Result<TaskStore, String> {
        let root = self.inner.root.clone()?;
        let owner = lock(&self.inner.host)
            .as_ref()
            .map(|host| host.owner())
            .unwrap_or_default();
        TaskStore::with_owner_kind(root, owner)
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

    pub fn list(&self, project_id: &str) -> Result<Vec<ResearchTask>, String> {
        self.store()?.list(project_id)
    }

    pub fn create(&self, draft: ResearchTaskDraft) -> Result<ResearchTask, String> {
        let host = self.host()?;
        host.admit_project(&draft.project_id)?;
        if !draft.skill_ids.is_empty() {
            if let Some(error) = host.unavailable_skill(&draft.project_id, &draft.skill_ids)? {
                return Err(error);
            }
        }
        if let Some(brief) = &draft.brief {
            self.check_compute(&brief.compute)?;
        }
        let task = self.store()?.create(draft)?;
        self.emit_task(&task);
        Ok(task)
    }

    pub fn edit(&self, task_id: &str, edit: ResearchTaskEdit) -> Result<ResearchTask, String> {
        if let Some(brief) = &edit.brief {
            self.check_compute(&brief.compute)?;
        }
        let task = self.store()?.edit(task_id, edit)?;
        self.emit_task(&task);
        Ok(task)
    }

    fn check_compute(&self, compute: &crate::model::ComputeTarget) -> Result<(), String> {
        let Ok(services) = self.services() else {
            return Ok(());
        };
        let executor = compute.executor.trim();
        if !services.runs.executor_ids().contains(&executor) {
            return Err(format!("The {executor} compute target isn't available."));
        }
        if !matches!(executor, "ssh" | "slurm" | "cua-space") {
            return Ok(());
        }
        let Some(target) = compute.target.as_deref() else {
            return Err("Choose a compute target for this task's runs.".into());
        };
        let data_root = services.tasks_root.parent().unwrap_or(&services.tasks_root);
        let saved = crate::runs::remote::settings::load(data_root);
        if crate::runs::remote::settings::find(&saved, target).is_none() {
            return Err("The compute target in this brief was removed. Choose another one.".into());
        }
        Ok(())
    }

    pub fn request_start(&self, task_id: &str) -> Result<(), String> {
        let host = self.host()?;
        let store = self.store()?;
        let current = store.require(task_id)?;
        host.require_trusted(&current.project_id)?;
        self.runtime_for(&current.runtime_id, &current.agent_id)?;
        self.emit_task(&store.request_start(task_id)?);
        Ok(())
    }

    pub fn retry(&self, task_id: &str, mode: RetryMode) -> Result<ResearchTask, String> {
        let host = self.host()?;
        let store = self.store()?;
        host.require_trusted(&store.require(task_id)?.project_id)?;
        let task = store.retry_with(task_id, mode)?;
        crate::handoff::purge_files(store.root(), task_id);
        self.emit_task(&task);
        Ok(task)
    }

    pub fn plan(&self, task_id: &str) -> Result<TaskPlanText, String> {
        let task = self.store()?.require(task_id)?;
        let isolation = task
            .isolation
            .as_ref()
            .ok_or_else(|| "The plan file is missing. Retry the task.".to_string())?;
        record::read_record_file_cut(
            Path::new(&isolation.execution_root),
            &task.record_slug,
            "plan.md",
            MAX_PLAN_BYTES,
        )
        .filter(|(plan, _)| !plan.trim().is_empty())
        .map(|(text, truncated)| TaskPlanText { text, truncated })
        .ok_or_else(|| "The plan file is missing. Retry the task.".to_string())
    }

    pub fn progress(&self, task_id: &str) -> Result<crate::progress::TaskProgress, String> {
        let store = self.store()?;
        let task = store.require(task_id)?;
        let (plan, full_ledger) = crate::progress::record_contents(&task);
        let services = self.services().ok();
        let runs = match &services {
            Some(services) => services.runs.list(task_id)?,
            None => store.runs(task_id)?,
        };
        let best = crate::progress::best_metric(&task.brief, &runs, &full_ledger);
        let ledger = crate::progress::recent_ledger(&full_ledger);
        let runs_started =
            runs.len()
                .saturating_sub(store.runs_baseline(task_id).unwrap_or(0)) as u32;
        let (runs_in_flight, recent_runs) = crate::progress::split_runs(runs);
        let active_ms = services
            .as_ref()
            .and_then(|services| services.clocks.get(task_id))
            .map(|clock| clock.active_ms())
            .unwrap_or(task.active_ms);
        let spent_usd = self
            .host()
            .ok()
            .and_then(|host| host.task_spend_usd(task_id));
        Ok(crate::progress::TaskProgress {
            phase: task.phase,
            plan,
            todos: task.todos.clone(),
            ledger,
            best,
            runs_in_flight,
            recent_runs,
            budget: crate::progress::BudgetUsage {
                active_minutes: active_minutes(active_ms),
                limit_minutes: task.brief.budget.wall_clock_minutes,
                spent_usd,
                usd_cap: task.brief.budget.usd_cap,
                runs_started,
                max_runs: task.brief.budget.max_runs,
            },
            evidence: task.evidence.clone(),
            record_dir: task.record_dir(),
        })
    }

    pub async fn approve_plan(
        &self,
        task_id: String,
        edited: Option<String>,
    ) -> Result<ResearchTask, String> {
        let task = self
            .blocking(move |state| {
                let store = state.store()?;
                let task = store.require(&task_id)?;
                state.host()?.require_trusted(&task.project_id)?;
                if task.status != ResearchTaskStatus::PlanReady {
                    return Err("This task is not waiting for plan approval.".into());
                }
                if let Some(plan) = edited.filter(|plan| !plan.trim().is_empty()) {
                    if plan.len() > MAX_PLAN_BYTES {
                        return Err("A plan can be up to 64 KiB.".into());
                    }
                    let isolation = task
                        .isolation
                        .as_ref()
                        .ok_or_else(|| WORKSPACE_GONE.to_string())?;
                    let dir = record::record_dir(&task.record_slug);
                    crate::task_tools::TaskFiles::open(
                        Path::new(&isolation.execution_root),
                        std::slice::from_ref(&dir),
                    )?
                    .write(&format!("{dir}/plan.md"), &plan)?;
                } else if state.plan(&task.id).is_ok_and(|plan| plan.truncated) {
                    return Err(PLAN_TOO_LONG.into());
                }
                let approved = store.approve_plan(&task.id)?;
                state.emit_task(&approved);
                state.refresh_attention();
                Ok(approved)
            })
            .await?;
        self.launch_ready().await?;
        Ok(task)
    }

    pub fn events(
        &self,
        task_id: &str,
        generation: u64,
        after: Option<u64>,
        limit: usize,
    ) -> Result<TaskTranscriptPage, String> {
        self.events_page(task_id, generation, after, None, limit)
    }

    pub fn events_page(
        &self,
        task_id: &str,
        generation: u64,
        after: Option<u64>,
        before: Option<u64>,
        limit: usize,
    ) -> Result<TaskTranscriptPage, String> {
        self.inner.writer.flush();
        self.store()?
            .events_page(task_id, generation, after, before, limit)
    }

    pub fn delete(&self, task_id: &str) -> Result<(), String> {
        let host = self.host()?;
        let store = self.store()?;
        let task = store.require(task_id)?;
        if task.status == ResearchTaskStatus::Running {
            return Err("Stop this task before deleting it.".into());
        }
        let leftovers = self
            .services()
            .map(|services| services.runs.cleanup_handles(task_id));
        store.delete(task_id)?;
        let workspace_root = isolation::task_workspace_root(store.root(), task_id);
        let project_root = host
            .locate_project(&task.project_id)
            .ok()
            .filter(|location| !location.linked)
            .map(|location| location.root);
        let git = host.git();
        isolation::purge_task_workspaces(project_root.as_deref(), git.as_ref(), &workspace_root);
        if let (Ok(services), Ok(leftovers)) = (self.services(), leftovers) {
            let id = task_id.to_owned();
            self.runtime()
                .spawn(async move { services.runs.cleanup_task(&id, leftovers).await });
        }
        self.refresh_attention();
        Ok(())
    }

    pub fn accept_result(&self, task_id: &str) -> Result<ResearchTask, String> {
        let task = self.store()?.complete_without_apply(task_id)?;
        self.emit_task(&task);
        self.refresh_attention();
        Ok(task)
    }

    async fn blocking<T: Send + 'static>(
        &self,
        operation: impl FnOnce(&ResearchTaskState) -> Result<T, String> + Send + 'static,
    ) -> Result<T, String> {
        let state = self.clone();
        self.runtime()
            .spawn_blocking(move || operation(&state))
            .await
            .map_err(|error| format!("task storage worker failed: {error}"))?
    }

    pub async fn recover_runs(&self, launch: bool) -> Result<(), String> {
        let store = self.store()?;
        for task in store.recover_interrupted()? {
            if task.status == ResearchTaskStatus::Failed {
                self.emit_task(&task);
            }
        }
        if let Ok(services) = self.services() {
            services.runs.reattach();
        }
        drop(self.sweep_old_generations(&store));
        self.refresh_attention();
        if launch {
            self.launch_ready().await?;
        }
        Ok(())
    }

    fn sweep_old_generations(&self, store: &TaskStore) -> Option<tokio::task::JoinHandle<()>> {
        let (Ok(host), Ok(services)) = (self.host(), self.services()) else {
            return None;
        };
        let state = self.clone();
        let root = store.root().to_path_buf();
        Some(self.runtime().spawn_blocking(move || {
            let Ok(store) = TaskStore::new(root) else {
                return;
            };
            for task in store.all_tasks().unwrap_or_default() {
                let Ok(task) = store.require(&task.id) else {
                    continue;
                };
                if matches!(
                    task.status,
                    ResearchTaskStatus::Queued | ResearchTaskStatus::Running
                ) {
                    continue;
                }
                state.purge_unneeded(&host, &services, &store, &task);
            }
        }))
    }

    fn purge_unneeded(
        &self,
        host: &Arc<dyn ResearchHost>,
        services: &TaskServices,
        store: &TaskStore,
        task: &ResearchTask,
    ) {
        if !services
            .runs
            .in_flight(&task.id)
            .unwrap_or_default()
            .is_empty()
        {
            return;
        }
        let mut keep: Vec<PathBuf> = task
            .isolation
            .iter()
            .map(|isolation| PathBuf::from(&isolation.execution_root))
            .collect();
        if let Some(PendingStart::Fresh {
            carry_from: Some(from),
        }) = &task.pending_start
        {
            keep.push(PathBuf::from(from));
        }
        let task_root = isolation::task_workspace_root(store.root(), &task.id);
        if let Ok(entries) = std::fs::read_dir(&task_root) {
            keep.extend(
                entries
                    .flatten()
                    .filter(|entry| {
                        entry
                            .file_name()
                            .to_str()
                            .is_some_and(crate::handoff::is_handoff_file_name)
                    })
                    .map(|entry| entry.path()),
            );
        }
        let project = host
            .locate_project(&task.project_id)
            .ok()
            .filter(|location| !location.linked)
            .map(|location| location.root);
        isolation::purge_generations(
            &isolation::task_workspace_root(store.root(), &task.id),
            &keep,
            project.as_deref(),
            host.git().as_ref(),
        );
    }

    pub async fn launch_ready(&self) -> Result<(), String> {
        if self.inner.stopping.load(Ordering::Acquire)
            || self.inner.launch_hold.load(Ordering::Acquire)
            || !self.inner.enabled.load(Ordering::Acquire)
        {
            return Ok(());
        }
        if lock(&self.inner.host).is_none() {
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
                self.wake_at_next_start(&store);
                return Ok(());
            };
            let adapter = match self.runtime_for(&task.runtime_id, &task.agent_id) {
                Ok(adapter) => adapter,
                Err(error) => {
                    store.finish_failure(&task.id, task.execution_generation, &error)?;
                    self.emit_with_dependents(&store, &task.id);
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
                handing_off: Arc::new(AtomicBool::new(false)),
                suspended: Arc::new(Mutex::new(None)),
                slot: Arc::new(Mutex::new(None)),
                lent: Arc::new(Mutex::new(None)),
            };
            self.inner
                .suspends
                .begin(&task.id, task.execution_generation);
            lock(&self.inner.active).insert(task.id.clone(), active.clone());
            self.emit_task(&task);
            let state = self.clone();
            self.runtime().spawn(async move {
                state.execute(task, active, permit).await;
            });
        }
    }

    fn wake_at_next_start(&self, store: &TaskStore) {
        let Ok(Some(at)) = store.next_run_after() else {
            return;
        };
        let generation = self.inner.wake_generation.fetch_add(1, Ordering::AcqRel) + 1;
        let state = self.clone();
        let timer = self.runtime().spawn(async move {
            loop {
                let (sleep, due) = wake_step(at, crate::model::now_ms());
                tokio::time::sleep(sleep).await;
                if due {
                    break;
                }
            }
            if state.inner.wake_generation.load(Ordering::Acquire) == generation {
                state.kick();
            }
        });
        if let Some(previous) = lock(&self.inner.wake_timer).replace(timer) {
            previous.abort();
        }
    }

    pub async fn resume_after_failed_update(&self) -> Result<(), String> {
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
        self.inner.writer.flush();
    }

    pub fn stop_admitting(&self) {
        self.inner.stopping.store(true, Ordering::Release);
    }

    pub fn admitting(&self) -> bool {
        !self.inner.stopping.load(Ordering::Acquire)
    }

    pub fn hold_launches(&self) {
        self.inner.launch_hold.store(true, Ordering::Release);
    }

    pub fn release_launches(&self) {
        self.inner.launch_hold.store(false, Ordering::Release);
    }

    pub fn enabled(&self) -> bool {
        self.inner.enabled.load(Ordering::Acquire)
    }

    pub fn set_enabled(&self, enabled: bool) {
        self.inner.enabled.store(enabled, Ordering::Release);
    }

    pub fn active_task_ids(&self) -> Vec<String> {
        lock(&self.inner.active).keys().cloned().collect()
    }

    pub async fn suspend(
        &self,
        ids: &[String],
        mode: SuspendMode,
        deadline: Option<Duration>,
    ) -> Vec<(String, SuspendResult)> {
        let mut results = Vec::with_capacity(ids.len());
        let mut waiting: Vec<(String, ActiveTask)> = Vec::new();
        for id in ids {
            let active = lock(&self.inner.active).get(id).cloned();
            let Some(active) = active else {
                results.push((id.clone(), SuspendResult::NotRunning));
                continue;
            };
            active.handing_off.store(true, Ordering::Release);
            self.inner.suspends.signal(id, mode);
            waiting.push((id.clone(), active));
        }
        let all_settled = futures_util::future::join_all(
            waiting
                .iter()
                .map(|(_, active)| active.wait_until_settled()),
        );
        let in_time = match deadline {
            Some(limit) => tokio::time::timeout(limit, all_settled).await.is_ok(),
            None => {
                all_settled.await;
                true
            }
        };
        if !in_time {
            for (_, active) in &waiting {
                if active.settled.load(Ordering::Acquire) {
                    continue;
                }
                active.cancel.cancel();
                if active.runtime_started.load(Ordering::Acquire) {
                    let _ = active.adapter.cancel(active.session_id.clone()).await;
                }
            }
            for (_, active) in &waiting {
                active.wait_until_settled().await;
            }
        }
        let store = self.store().ok();
        for (id, active) in waiting {
            let generation = active.execution_generation;
            let state = lock(&active.suspended).clone();
            let current = store.as_ref().and_then(|store| store.require(&id).ok());
            let running_here = current.as_ref().is_some_and(|task| {
                task.status == ResearchTaskStatus::Running
                    && task.execution_generation == generation
            });
            let result = match state {
                _ if !running_here => SuspendResult::NotRunning,
                Some(state) => SuspendResult::Suspended { generation, state },
                None if current
                    .as_ref()
                    .is_some_and(|task| task.isolation.is_none()) =>
                {
                    SuspendResult::Unstarted { generation }
                }
                None => SuspendResult::Stopped { generation },
            };
            results.push((id, result));
        }
        self.inner.writer.flush();
        results
    }

    pub async fn apply_foreign_requests(
        &self,
        grant_for: &(dyn Fn(&ResearchTask) -> Option<TaskGrant> + Sync),
    ) -> Result<Vec<String>, String> {
        let requests = self
            .blocking(|state| state.store()?.foreign_requests())
            .await?;
        let mut started = Vec::new();
        for id in requests.cancel {
            if !lock(&self.inner.foreign_inflight).insert(id.clone()) {
                continue;
            }
            let state = self.clone();
            let task_id = id.clone();
            self.runtime().spawn(async move {
                let _ = state.cancel(task_id.clone()).await;
                lock(&state.inner.foreign_inflight).remove(&task_id);
            });
            started.push(id);
        }
        for (id, _generation) in requests.reclaim {
            if !lock(&self.inner.foreign_inflight).insert(id.clone()) {
                continue;
            }
            let grant = self
                .store()
                .ok()
                .and_then(|store| store.require(&id).ok())
                .and_then(|task| grant_for(&task));
            let state = self.clone();
            let task_id = id.clone();
            self.runtime().spawn(async move {
                state.release_for_reclaim(&task_id, grant).await;
                lock(&state.inner.foreign_inflight).remove(&task_id);
            });
            started.push(id);
        }
        Ok(started)
    }

    async fn release_for_reclaim(&self, task_id: &str, grant: Option<TaskGrant>) {
        let results = self
            .suspend(&[task_id.to_owned()], SuspendMode::Graceful, None)
            .await;
        let Some((_, result)) = results.into_iter().next() else {
            return;
        };
        let owner = lock(&self.inner.host)
            .as_ref()
            .map(|host| host.owner())
            .unwrap_or_default();
        let wanted = self
            .store()
            .ok()
            .and_then(|store| store.require(task_id).ok())
            .is_some_and(|task| task.reclaim_requested);
        let to = if wanted { OwnerKind::App } else { owner };
        let Some((generation, record)) =
            handoff_record_for(&result, owner, to, HandoffReason::Reclaim)
        else {
            return;
        };
        let record = HandoffRecord {
            grant: if wanted { None } else { grant },
            ..record
        };
        let _ = self
            .hand_off_suspended(task_id, generation, to, record)
            .await;
        self.kick();
    }

    pub async fn hand_off_suspended(
        &self,
        task_id: &str,
        generation: u64,
        to: OwnerKind,
        record: HandoffRecord,
    ) -> Result<bool, String> {
        let id = task_id.to_owned();
        let (moved, cancelled) = self
            .blocking(move |state| {
                let store = state.store()?;
                if store.hand_off_with(&id, generation, to, &record)? {
                    if let Ok(task) = store.require(&id) {
                        state.emit_task(&task);
                    }
                    return Ok((true, false));
                }
                let current = store.require(&id)?;
                let cancelled = current.cancel_requested
                    && current.status == ResearchTaskStatus::Running
                    && current.execution_generation == generation
                    && store.finalize_cancel(&id, generation)?;
                if cancelled {
                    crate::handoff::purge_files(store.root(), &id);
                    state.emit_with_dependents(&store, &id);
                }
                Ok((false, cancelled))
            })
            .await?;
        if cancelled {
            if let Ok(services) = self.services() {
                services.runs.cancel_all(task_id).await;
            }
        }
        Ok(moved)
    }

    pub async fn cancel(&self, task_id: String) -> Result<ResearchTask, String> {
        let requested_id = task_id.clone();
        let (cancellation, mut active, foreign) = self
            .blocking(move |state| {
                let store = state.store()?;
                let current = store.require(&requested_id)?;
                if current.status == ResearchTaskStatus::Running
                    && !lock(&state.inner.active).contains_key(&requested_id)
                    && store.owned_by_other_live_process(&requested_id)?
                {
                    return Ok((store.request_cancel(&requested_id)?, None, true));
                }
                let active = if current.status == ResearchTaskStatus::Running {
                    lock(&state.inner.active).get(&requested_id).cloned()
                } else {
                    None
                };
                Ok((store.request_cancel(&requested_id)?, active, false))
            })
            .await?;
        if foreign {
            self.emit_task(&cancellation);
            return Ok(cancellation);
        }
        if cancellation.status == ResearchTaskStatus::Cancelled {
            let cancelled_id = cancellation.id.clone();
            self.blocking(move |state| {
                let store = state.store()?;
                crate::handoff::purge_files(store.root(), &cancelled_id);
                state.emit_with_dependents(&store, &cancelled_id);
                Ok(())
            })
            .await?;
            self.launch_ready().await?;
            return Ok(cancellation);
        }
        for _ in 0..50 {
            if active.is_some() {
                break;
            }
            active = lock(&self.inner.active).get(&task_id).cloned();
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
        self.blocking(move |state| {
            let store = state.store()?;
            if !store.finalize_cancel(&settle_id, generation)? {
                return Err("The task changed before cancellation finished.".into());
            }
            state.finish_active(&settle_id, generation);
            crate::handoff::purge_files(store.root(), &settle_id);
            state.emit_with_dependents(&store, &settle_id);
            Ok(())
        })
        .await?;
        self.end_generation_services(&task_id, generation, true)
            .await;
        self.launch_ready().await?;
        self.blocking(move |state| state.store()?.require(&task_id))
            .await
    }

    async fn end_generation_services(&self, task_id: &str, generation: u64, cancel_runs: bool) {
        let Ok(services) = self.services() else {
            return;
        };
        let superseded = self
            .store()
            .and_then(|store| store.require(task_id))
            .is_ok_and(|task| task.execution_generation != generation);
        if !superseded {
            services.clocks.remove(task_id);
        }
        services.runs.detach_sink(task_id, generation);
        if cancel_runs && !superseded {
            services.runs.cancel_all(task_id).await;
        }
        if let Ok(store) = self.store() {
            let _ = store.withdraw_approvals(task_id, generation);
            let _ = store.clear_phase(task_id, generation);
        }
        self.refresh_attention();
    }

    async fn execute(&self, task: ResearchTask, active: ActiveTask, permit: OwnedSemaphorePermit) {
        let generation = task.execution_generation;
        *lock(&active.slot) = Some(permit);
        let store = match self.store() {
            Ok(store) => store,
            Err(_) => {
                self.finish_active(&task.id, generation);
                active.mark_settled();
                active.release_slots();
                self.kick();
                return;
            }
        };
        let _awake = self
            .host()
            .ok()
            .filter(|host| host.keep_awake_enabled())
            .map(|_| self.inner.keep_awake.acquire("Research task running"));
        let end = self.run_generation(&store, &task, &active).await;
        let suspended = self.inner.suspends.take_state(&task.id, generation);
        let handing_off = active.handing_off.load(Ordering::Acquire);
        let parked = match &end {
            RunEnd::Finished(Ok(_)) => suspended.is_some(),
            RunEnd::Finished(Err(_)) | RunEnd::Cancelled => handing_off || suspended.is_some(),
        };
        if parked {
            *lock(&active.suspended) = suspended;
            self.settle_active(&store, &task.id, generation, &active);
            self.end_generation_services(&task.id, generation, false)
                .await;
            self.inner.suspends.end(&task.id, generation);
            self.emit_with_dependents(&store, &task.id);
            active.release_slots();
            if !self.inner.stopping.load(Ordering::Acquire) {
                self.kick();
            }
            return;
        }
        let cancelled = matches!(end, RunEnd::Cancelled);
        if !cancelled {
            self.review_generation(&store, &task, &active, end).await;
        }
        self.settle_active(&store, &task.id, generation, &active);
        if !cancelled {
            let handed_off = store
                .require(&task.id)
                .is_ok_and(|current| current.owner != task.owner);
            self.end_generation_services(&task.id, generation, !handed_off)
                .await;
            self.notify_outcome(&store, &task.id);
        }
        self.inner.suspends.end(&task.id, generation);
        if store.require(&task.id).is_ok_and(|current| {
            !matches!(
                current.status,
                ResearchTaskStatus::Running | ResearchTaskStatus::Queued
            )
        }) {
            crate::handoff::purge_files(store.root(), &task.id);
        }
        self.emit_with_dependents(&store, &task.id);
        active.release_slots();
        self.kick();
    }

    async fn run_generation(
        &self,
        store: &TaskStore,
        task: &ResearchTask,
        active: &ActiveTask,
    ) -> RunEnd {
        let generation = task.execution_generation;
        let cancel = active.cancel.clone();
        self.set_phase(store, &task.id, generation, TaskPhase::Preparing);
        let (isolation, slug) = match self.prepare_workspace(store, task, &cancel).await {
            Ok(prepared) => prepared,
            Err(_) if cancel.is_cancelled() => return RunEnd::Cancelled,
            Err(error) => return RunEnd::Finished(Err(error)),
        };
        if cancel.is_cancelled() {
            return RunEnd::Cancelled;
        }
        let services = match self.services() {
            Ok(services) => services,
            Err(error) => return RunEnd::Finished(Err(error)),
        };
        let root = PathBuf::from(&isolation.execution_root);
        let record_dir = record::record_dir(&slug);
        let resume = match &task.pending_start {
            Some(PendingStart::Resume {
                reason,
                previous_native_session_id,
                ..
            }) => Some(ResumeContext {
                reason: *reason,
                handoff: record::read_record_file(&root, &slug, "handoff.md", RESUME_FILE_BYTES)
                    .unwrap_or_default(),
                plan: record::read_record_file(&root, &slug, "plan.md", RESUME_FILE_BYTES)
                    .unwrap_or_default(),
                ledger_tail: record::ledger_tail(&root, &slug, RESUME_LEDGER_ROWS),
                previous_native_session_id: previous_native_session_id.clone(),
            }),
            _ => None,
        };
        let carry_from = match &task.pending_start {
            Some(PendingStart::Fresh { carry_from }) => carry_from.clone(),
            _ => None,
        };
        let handoff = match &task.pending_start {
            Some(PendingStart::Resume {
                reason: ResumeReason::Handoff,
                ..
            }) => store
                .handoff_record(&task.id)
                .ok()
                .flatten()
                .map(|record| HandoffResume {
                    from_generation: record.from_generation,
                    conversation: record.conversation,
                    turn_interrupted: record.turn_interrupted,
                    acp: record.acp,
                }),
            _ => None,
        };
        let plan_phase = task.brief.review_plan_first && !task.plan_approved;
        let mut brief = task.brief.clone();
        if plan_phase && brief.permissions.commands == CommandPolicy::Allow {
            brief.permissions.commands = CommandPolicy::Ask;
        }
        let context = TaskRunContext {
            task_id: task.id.clone(),
            execution_generation: generation,
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
            brief,
            record_dir,
            dependencies: store.dependency_results(&task.id).unwrap_or_default(),
            resume,
            plan_phase,
            carry_from,
            desktop_apps: task.brief.permissions.desktop_apps
                && crate::model::task_desktop_apps_conflict(
                    true,
                    task.keep_running_after_quit,
                    task.run_after.is_some(),
                )
                .is_none(),
            handoff,
        };
        let _ = store.clear_pending_start(&task.id, generation);
        self.set_phase(
            store,
            &task.id,
            generation,
            if plan_phase {
                TaskPhase::Planning
            } else {
                TaskPhase::Working
            },
        );
        let recorder =
            TranscriptRecorder::new(store.clone(), self.clone(), task.id.clone(), generation);
        let sink_recorder = recorder.clone();
        let sink_state = self.clone();
        let sink_task = task.clone();
        let events: TaskEventSink = Arc::new(move |event| {
            sink_state.observe_event(&sink_task, &event);
            sink_recorder.record(event);
        });
        services
            .runs
            .attach_sink(&task.id, generation, events.clone());
        let run_token = cancel.child();
        let budget_stop: Arc<Mutex<Option<BudgetKind>>> = Arc::new(Mutex::new(None));
        let spend_host = self.host().ok();
        let spend_task = task.id.clone();
        let clock = Arc::new(BudgetClock::new(
            task.brief.budget.clone(),
            task.active_ms,
            Arc::new(move || {
                spend_host
                    .as_ref()
                    .and_then(|host| host.task_spend_usd(&spend_task))
            }),
        ));
        services.clocks.insert(&task.id, clock.clone());
        let watcher = self.watch_budget(
            store.clone(),
            task,
            clock.clone(),
            run_token.clone(),
            budget_stop.clone(),
        );
        active.runtime_started.store(true, Ordering::Release);
        let outcome = active.adapter.run(context, run_token.clone(), events).await;
        watcher.abort();
        let _ = store.set_active_ms(&task.id, generation, clock.active_ms());
        let closing = recorder.clone();
        let _ = self.runtime().spawn_blocking(move || closing.close()).await;
        if cancel.is_cancelled() {
            return RunEnd::Cancelled;
        }
        let stop = *lock(&budget_stop);
        match stop {
            Some(kind) => {
                let reason = match kind {
                    BudgetKind::Time => StopReason::BudgetTime,
                    BudgetKind::Cost => StopReason::BudgetCost,
                    BudgetKind::Runs => StopReason::BudgetRuns,
                };
                let _ = store.set_stop_reason(&task.id, generation, reason);
                if outcome.is_err() {
                    return RunEnd::Finished(Ok(TaskRuntimeOutcome {
                        summary: String::new(),
                        artifacts: Vec::new(),
                        native_session_id: None,
                        input_tokens: None,
                        output_tokens: None,
                    }));
                }
            }
            None if outcome.is_ok() => {
                if let Some(max) = task.brief.budget.max_runs {
                    let baseline = store.runs_baseline(&task.id).unwrap_or(0);
                    if services
                        .runs
                        .list(&task.id)
                        .map(|runs| runs.len().saturating_sub(baseline))
                        .unwrap_or(0)
                        >= max as usize
                    {
                        let _ = store.set_stop_reason(&task.id, generation, StopReason::BudgetRuns);
                    }
                }
            }
            None => {}
        }
        RunEnd::Finished(outcome)
    }

    async fn prepare_workspace(
        &self,
        store: &TaskStore,
        task: &ResearchTask,
        cancel: &CancellationToken,
    ) -> Result<(TaskIsolation, String), String> {
        let generation = task.execution_generation;
        let slug = store.ensure_record_slug(&task.id)?;
        let isolation = match &task.isolation {
            Some(saved) => {
                let real = tokio::fs::symlink_metadata(Path::new(&saved.execution_root))
                    .await
                    .is_ok_and(|metadata| metadata.is_dir() && !metadata.file_type().is_symlink());
                if !real {
                    return Err(WORKSPACE_GONE.into());
                }
                if let Ok(project) = self
                    .host()
                    .and_then(|host| host.locate_project(&task.project_id))
                {
                    let saved = saved.clone();
                    let _ = self
                        .runtime()
                        .spawn_blocking(move || isolation::restore_baseline(&saved, &project.root))
                        .await;
                }
                saved.clone()
            }
            None => {
                let isolation_store = store.clone();
                let isolation_task = task.clone();
                let isolation_cancel = cancel.clone();
                let isolation_host = self.host();
                let isolation = self
                    .runtime()
                    .spawn_blocking(move || {
                        let host = isolation_host?;
                        let env: &dyn IsolationEnv = host.as_ref();
                        isolation::prepare(
                            &isolation_store,
                            env,
                            &isolation_task,
                            &isolation_cancel,
                        )
                    })
                    .await
                    .map_err(|error| format!("Task isolation stopped unexpectedly: {error}"))
                    .and_then(|result| result)?;
                if !store.set_isolation(&task.id, generation, &isolation)? {
                    return Err("The task changed before its workspace was ready.".into());
                }
                if let Some(PendingStart::Fresh {
                    carry_from: Some(from),
                }) = &task.pending_start
                {
                    let (from, to, carried_slug) = (
                        PathBuf::from(from),
                        PathBuf::from(&isolation.execution_root),
                        slug.clone(),
                    );
                    let _ = self
                        .runtime()
                        .spawn_blocking(move || {
                            isolation::carry_over_record(&from, &to, &carried_slug)
                        })
                        .await;
                }
                if let (Ok(host), Ok(services)) = (self.host(), self.services()) {
                    let state = self.clone();
                    let purge_store = store.clone();
                    let mut purge_task = store.require(&task.id).unwrap_or_else(|_| task.clone());
                    purge_task.pending_start = None;
                    self.runtime().spawn_blocking(move || {
                        state.purge_unneeded(&host, &services, &purge_store, &purge_task);
                    });
                }
                isolation
            }
        };
        if let Ok(current) = store.require(&task.id) {
            self.emit_task(&current);
        }
        let root = PathBuf::from(&isolation.execution_root);
        let brief_md = record::render_brief_markdown(&task.title, &task.prompt, &task.brief);
        let record_slug = slug.clone();
        self.runtime()
            .spawn_blocking(move || record::init_record(&root, &record_slug, &brief_md))
            .await
            .map_err(|error| format!("The research record could not be created: {error}"))??;
        Ok((isolation, slug))
    }

    fn watch_budget(
        &self,
        store: TaskStore,
        task: &ResearchTask,
        clock: Arc<BudgetClock>,
        run_token: CancellationToken,
        stop: Arc<Mutex<Option<BudgetKind>>>,
    ) -> tokio::task::JoinHandle<()> {
        let task_id = task.id.clone();
        let generation = task.execution_generation;
        self.runtime().spawn(async move {
            let mut hard_stop: Option<Instant> = None;
            loop {
                tokio::time::sleep(BUDGET_WATCH_EVERY).await;
                if run_token.is_cancelled() {
                    return;
                }
                let (checked_store, checked_task, checked_clock) =
                    (store.clone(), task_id.clone(), clock.clone());
                let exhausted = tokio::task::spawn_blocking(move || {
                    let _ = checked_store.set_active_ms(
                        &checked_task,
                        generation,
                        checked_clock.active_ms(),
                    );
                    checked_clock.exhausted()
                })
                .await
                .unwrap_or(None);
                match exhausted {
                    Some(BudgetKind::Cost) => {
                        *lock(&stop) = Some(BudgetKind::Cost);
                        run_token.cancel();
                        return;
                    }
                    Some(BudgetKind::Time) => {
                        lock(&stop).get_or_insert(BudgetKind::Time);
                        let at = *hard_stop.get_or_insert_with(|| Instant::now() + HARD_STOP_AFTER);
                        if Instant::now() >= at {
                            run_token.cancel();
                            return;
                        }
                    }
                    _ => {}
                }
            }
        })
    }

    async fn review_generation(
        &self,
        store: &TaskStore,
        task: &ResearchTask,
        active: &ActiveTask,
        end: RunEnd,
    ) {
        let generation = task.execution_generation;
        let RunEnd::Finished(outcome) = end else {
            return;
        };
        let outcome = match outcome {
            Ok(outcome) => outcome,
            Err(error) => {
                let _ = store.finish_failure(&task.id, generation, &error);
                return;
            }
        };
        let Ok(current) = store.require(&task.id) else {
            return;
        };
        let Some(isolation) = current.isolation.clone() else {
            let _ =
                store.finish_failure(&task.id, generation, "The task workspace is unavailable.");
            return;
        };
        if task.brief.review_plan_first && !task.plan_approved {
            let plan = record::read_record_file(
                Path::new(&isolation.execution_root),
                &current.record_slug,
                "plan.md",
                MAX_PLAN_BYTES,
            );
            if plan.is_some_and(|plan| !plan.trim().is_empty()) {
                let _ = store.finish_plan_ready(&task.id, generation);
            } else {
                let _ = store.finish_failure(&task.id, generation, PLAN_MISSING);
            }
            return;
        }
        let review_isolation = isolation.clone();
        let review_cancel = active.cancel.clone();
        let review = self
            .runtime()
            .spawn_blocking(move || isolation::collect_review(&review_isolation, &review_cancel))
            .await
            .map_err(|error| format!("Task review stopped unexpectedly: {error}"))
            .and_then(|result| result);
        if active.cancel.is_cancelled() {
            return;
        }
        let (changed_files, left_out) = match review {
            Ok(review) => (review.changes, review.left_out),
            Err(error) => {
                let _ = store.finish_failure(&task.id, generation, &error);
                return;
            }
        };
        let artifacts = match validated_artifacts(outcome.artifacts, &changed_files) {
            Ok(artifacts) => artifacts,
            Err(error) => {
                let _ = store.finish_failure(&task.id, generation, &error);
                return;
            }
        };
        let mut summary: String = outcome.summary.chars().take(8_000).collect();
        if left_out > 0 {
            summary.push_str(&format!(
                "\n\n{left_out} new files were left out of this review: the task made more than the review limit of 20,000 files or 2 GiB."
            ));
        }
        let result = TaskResultMetadata {
            summary,
            changed_files: changed_files.clone(),
            artifacts,
            native_session_id: outcome.native_session_id,
            input_tokens: outcome.input_tokens,
            output_tokens: outcome.output_tokens,
        };
        if store
            .finish_success(&task.id, generation, &result)
            .unwrap_or(false)
        {
            self.check_evidence_later(store.clone(), current, isolation, changed_files);
        }
    }

    fn check_evidence_later(
        &self,
        store: TaskStore,
        task: ResearchTask,
        isolation: TaskIsolation,
        changes: Vec<TaskFileChange>,
    ) {
        self.set_phase(
            &store,
            &task.id,
            task.execution_generation,
            TaskPhase::CheckingEvidence,
        );
        let state = self.clone();
        self.runtime().spawn(async move {
            let report = state.evidence_report(&task, &isolation, &changes).await;
            let _ = store.set_evidence(&task.id, task.execution_generation, &report);
            let _ = store.clear_phase(&task.id, task.execution_generation);
            let current = store.require(&task.id).ok();
            if let Some(current) = &current {
                state.emit_task(current);
            }
            let reviewed = current.is_some_and(|current| {
                current.execution_generation == task.execution_generation
                    && matches!(
                        current.status,
                        ResearchTaskStatus::AwaitingReview | ResearchTaskStatus::Completed
                    )
            });
            if reviewed {
                let _ = state
                    .runtime()
                    .spawn_blocking(move || isolation::prune_baseline(&isolation, &changes))
                    .await;
            }
        });
    }

    pub async fn refresh_evidence(&self, task_id: String) -> Result<ResearchTask, String> {
        let store = self.store()?;
        let task = store.require(&task_id)?;
        let isolation = task
            .isolation
            .clone()
            .ok_or_else(|| "The task workspace is unavailable.".to_string())?;
        let changes = task
            .result
            .as_ref()
            .map(|result| result.changed_files.clone())
            .unwrap_or_default();
        let report = self.evidence_report(&task, &isolation, &changes).await;
        store.set_evidence(&task.id, task.execution_generation, &report)?;
        store.clear_phase(&task.id, task.execution_generation)?;
        let current = store.require(&task.id)?;
        self.emit_task(&current);
        Ok(current)
    }

    async fn evidence_report(
        &self,
        task: &ResearchTask,
        isolation: &TaskIsolation,
        changes: &[TaskFileChange],
    ) -> crate::model::EvidenceReport {
        let services = self.services().ok();
        let runs = services
            .as_ref()
            .and_then(|services| services.runs.list(&task.id).ok())
            .unwrap_or_default();
        let ledger = record::read_record_file(
            Path::new(&isolation.execution_root),
            &task.record_slug,
            "ledger.tsv",
            4 * 1024 * 1024,
        )
        .map(|text| record::parse_ledger(&text))
        .unwrap_or_default();
        let project_root = self
            .host()
            .and_then(|host| host.locate_project(&task.project_id))
            .ok()
            .map(|location| location.root);
        let inputs = crate::evidence::EvidenceInputs {
            isolation,
            changes,
            runs,
            ledger,
            workspace: services.and_then(|services| services.workspace),
            project_root,
        };
        crate::evidence::check_evidence(inputs, &CancellationToken::new()).await
    }

    fn notify_outcome(&self, store: &TaskStore, task_id: &str) {
        let Ok(task) = store.require(task_id) else {
            return;
        };
        let kind = match task.status {
            ResearchTaskStatus::AwaitingReview if task.stop_reason.is_some() => {
                NotificationKind::BudgetReached
            }
            ResearchTaskStatus::AwaitingReview => NotificationKind::ReviewReady,
            ResearchTaskStatus::PlanReady => NotificationKind::PlanReady,
            ResearchTaskStatus::Failed => NotificationKind::Failed,
            _ => return,
        };
        self.notify(kind, &task);
    }

    fn notify(&self, kind: NotificationKind, task: &ResearchTask) {
        if let Ok(host) = self.host() {
            host.notify(Notification {
                kind,
                task_id: task.id.clone(),
                project_id: task.project_id.clone(),
                task_title: task.title.clone(),
            });
        }
    }

    fn observe_event(&self, task: &ResearchTask, event: &TaskRuntimeEvent) {
        match event {
            TaskRuntimeEvent::Phase { phase } => {
                if let Ok(store) = self.store() {
                    self.set_phase(&store, &task.id, task.execution_generation, *phase);
                }
                self.lend_or_retake_slot(&task.id, task.execution_generation, *phase);
            }
            TaskRuntimeEvent::Approval { status, .. } => {
                if *status == ApprovalStatus::Pending {
                    self.notify(NotificationKind::ApprovalNeeded, task);
                }
                if let Ok(current) = self.store().and_then(|store| store.require(&task.id)) {
                    self.emit_task(&current);
                }
                self.refresh_attention();
            }
            _ => {}
        }
    }

    fn lend_or_retake_slot(&self, task_id: &str, generation: u64, phase: TaskPhase) {
        let Some(active) = lock(&self.inner.active)
            .get(task_id)
            .filter(|active| active.execution_generation == generation)
            .cloned()
        else {
            return;
        };
        if matches!(phase, TaskPhase::WaitingApproval | TaskPhase::WaitingRuns) {
            if active.lend_slot(&self.inner.parked) {
                self.kick();
            }
        } else {
            active.retake_slot(&self.inner.concurrency);
        }
    }

    fn set_phase(&self, store: &TaskStore, task_id: &str, generation: u64, phase: TaskPhase) {
        if store.set_phase(task_id, generation, phase).unwrap_or(false) {
            if let Ok(task) = store.require(task_id) {
                self.emit_task(&task);
            }
        }
    }

    pub fn refresh_attention(&self) {
        let Some(runtime) = tokio::runtime::Handle::try_current()
            .ok()
            .or_else(|| lock(&self.inner.runtime).clone())
        else {
            return;
        };
        if self.inner.attention_pending.swap(true, Ordering::AcqRel) {
            return;
        }
        let state = self.clone();
        runtime.spawn(async move {
            tokio::time::sleep(ATTENTION_DEBOUNCE).await;
            state
                .inner
                .attention_pending
                .store(false, Ordering::Release);
            let summary = state.blocking(|state| state.store()?.attention()).await;
            if let (Ok(summary), Ok(host)) = (summary, state.host()) {
                host.attention_changed(&summary);
            }
        });
    }

    fn kick(&self) {
        let state = self.clone();
        let future: Pin<Box<dyn Future<Output = Result<(), String>> + Send>> =
            Box::pin(async move { state.launch_ready().await });
        self.runtime().spawn(async move {
            let _ = future.await;
        });
    }

    pub(crate) fn finish_active(&self, task_id: &str, generation: u64) {
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

    fn emit_with_dependents(&self, store: &TaskStore, task_id: &str) {
        if let Ok(task) = store.require(task_id) {
            self.emit_task(&task);
        }
        for id in store.dependent_ids(task_id).unwrap_or_default() {
            if let Ok(task) = store.require(&id) {
                self.emit_task(&task);
            }
        }
        self.refresh_attention();
    }

    pub fn emit_task(&self, task: &ResearchTask) {
        if let Some(host) = lock(&self.inner.host).clone() {
            host.task_changed(task);
        }
    }

    pub(crate) fn emit_event(&self, event: &TaskTranscriptEvent) {
        if let Some(host) = lock(&self.inner.host).clone() {
            host.transcript_appended(event);
        }
    }

    pub(crate) fn emit_delta(&self, delta: &TaskTranscriptDelta) {
        if let Some(host) = lock(&self.inner.host).clone() {
            host.transcript_delta(delta);
        }
    }
}

/// The longest the wake timer sleeps before it reads the wall clock again.
/// Tokio's timers run on the monotonic clock, which stops while the computer
/// sleeps, so one long sleep would start a scheduled task late by however
/// long the computer slept.
const WAKE_CHECK_EVERY: Duration = Duration::from_secs(60);

fn active_minutes(active_ms: u64) -> f64 {
    active_ms as f64 / 60_000.0
}

fn wake_step(at: i64, now: i64) -> (Duration, bool) {
    let until = Duration::from_millis(u64::try_from(at.saturating_sub(now)).unwrap_or(0) + 50);
    if until > WAKE_CHECK_EVERY {
        (WAKE_CHECK_EVERY, false)
    } else {
        (until, true)
    }
}

pub(crate) fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
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

#[cfg(test)]
mod tests;
