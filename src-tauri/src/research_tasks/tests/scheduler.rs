use std::ffi::OsString;
use std::time::Duration;

use tokio::sync::{mpsc, oneshot};

use super::*;
use crate::worktree_lock::ProjectWorktreeLock;

#[path = "recovery.rs"]
mod recovery;

struct DataRoot {
    directory: tempfile::TempDir,
    previous: Option<OsString>,
    _guard: MutexGuard<'static, ()>,
}

impl DataRoot {
    fn new() -> Self {
        let guard = crate::paths::data_dir_env_lock();
        let directory = tempfile::tempdir().unwrap();
        let previous = std::env::var_os("OLEAFLY_DATA_DIR");
        std::env::set_var("OLEAFLY_DATA_DIR", directory.path());
        Self {
            directory,
            previous,
            _guard: guard,
        }
    }

    fn project(&self, id: &str) -> PathBuf {
        let project = crate::paths::create_project_dir(id).unwrap();
        std::fs::write(project.join("main.tex"), "original manuscript").unwrap();
        project
    }

    fn state(&self, concurrency: usize) -> ResearchTaskState {
        ResearchTaskState::for_test(self.directory.path().join("tasks"), concurrency)
    }
}

impl Drop for DataRoot {
    fn drop(&mut self) {
        match &self.previous {
            Some(previous) => std::env::set_var("OLEAFLY_DATA_DIR", previous),
            None => std::env::remove_var("OLEAFLY_DATA_DIR"),
        }
    }
}

struct StartedRun {
    context: TaskRunContext,
    cancel: CancellationToken,
    events: TaskEventSink,
    complete: oneshot::Sender<Result<TaskRuntimeOutcome, String>>,
}

struct ControlledRuntime {
    starts: mpsc::UnboundedSender<StartedRun>,
    cancellations: Mutex<Vec<String>>,
    cancel_seen: Semaphore,
    fail_cancel: AtomicBool,
}

impl ControlledRuntime {
    fn new() -> (Arc<Self>, mpsc::UnboundedReceiver<StartedRun>) {
        let (starts, receiver) = mpsc::unbounded_channel();
        (
            Arc::new(Self {
                starts,
                cancellations: Mutex::new(Vec::new()),
                cancel_seen: Semaphore::new(0),
                fail_cancel: AtomicBool::new(false),
            }),
            receiver,
        )
    }

    async fn wait_for_cancel(&self) {
        tokio::time::timeout(Duration::from_secs(5), self.cancel_seen.acquire())
            .await
            .expect("the adapter did not receive cancellation")
            .unwrap()
            .forget();
    }
}

impl TaskRuntimeAdapter for ControlledRuntime {
    fn supports(&self, agent_id: &str) -> bool {
        agent_id == "fixture-agent"
    }

    fn run(
        &self,
        context: TaskRunContext,
        cancel: CancellationToken,
        events: TaskEventSink,
    ) -> TaskRuntimeFuture<TaskRuntimeOutcome> {
        let (complete, result) = oneshot::channel();
        let sent = self
            .starts
            .send(StartedRun {
                context,
                cancel,
                events,
                complete,
            })
            .map_err(|_| "the test stopped observing adapter starts".to_string());
        Box::pin(async move {
            sent?;
            result
                .await
                .map_err(|_| "the test dropped the adapter result".to_string())?
        })
    }

    fn cancel(&self, session_id: String) -> TaskRuntimeFuture<()> {
        lock(&self.cancellations).push(session_id);
        self.cancel_seen.add_permits(1);
        let failed = self.fail_cancel.load(Ordering::Acquire);
        Box::pin(async move {
            if failed {
                Err("adapter cleanup failed".into())
            } else {
                Ok(())
            }
        })
    }
}

fn draft(project_id: &str, title: &str) -> ResearchTaskDraft {
    ResearchTaskDraft {
        project_id: project_id.into(),
        title: title.into(),
        prompt: "Review the manuscript".into(),
        runtime_id: "fixture".into(),
        agent_id: "fixture-agent".into(),
        model_id: "fixture-model".into(),
        skill_ids: Vec::new(),
        dependency_ids: Vec::new(),
    }
}

fn requested(store: &TaskStore, draft: ResearchTaskDraft) -> ResearchTask {
    let task = store.create(draft).unwrap();
    store.request_start(&task.id).unwrap()
}

fn outcome(summary: &str) -> TaskRuntimeOutcome {
    TaskRuntimeOutcome {
        summary: summary.into(),
        artifacts: Vec::new(),
        native_session_id: None,
        input_tokens: None,
        output_tokens: None,
    }
}

async fn next_run(receiver: &mut mpsc::UnboundedReceiver<StartedRun>) -> StartedRun {
    tokio::time::timeout(Duration::from_secs(5), receiver.recv())
        .await
        .expect("the scheduler did not start the expected adapter")
        .expect("the adapter start channel closed")
}

fn active_run(state: &ResearchTaskState, task_id: &str) -> ActiveTask {
    lock(&state.inner.active).get(task_id).unwrap().clone()
}

async fn wait_settled(active: &ActiveTask) {
    tokio::time::timeout(Duration::from_secs(5), active.wait_until_settled())
        .await
        .expect("the scheduler did not settle the run");
}

async fn finish_run(
    state: &ResearchTaskState,
    run: StartedRun,
    result: Result<TaskRuntimeOutcome, String>,
) -> ResearchTask {
    let id = run.context.task_id.clone();
    let active = active_run(state, &id);
    run.complete.send(result).unwrap();
    wait_settled(&active).await;
    state.store().unwrap().require(&id).unwrap()
}

async fn stop(state: &ResearchTaskState) {
    tokio::time::timeout(Duration::from_secs(5), state.shutdown())
        .await
        .expect("the scheduler did not finish shutdown");
}

async fn wait_status(
    store: &TaskStore,
    task_id: &str,
    expected: ResearchTaskStatus,
) -> ResearchTask {
    tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            let task = store.require(task_id).unwrap();
            if task.status == expected {
                return task;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("the scheduler did not reach the expected task state")
}

#[test]
fn nonblocking_read_admission_preserves_shared_access_and_restore_recovery() {
    let data = DataRoot::new();
    let project = data.project("paper");
    let first = ProjectWorktreeLock::try_shared("paper").unwrap().unwrap();
    let second = ProjectWorktreeLock::try_shared("paper").unwrap().unwrap();
    assert!(ProjectWorktreeLock::try_exclusive("paper")
        .unwrap()
        .is_none());
    drop(first);
    drop(second);

    let internal = project.join(".oleafly");
    std::fs::create_dir(&internal).unwrap();
    let marker = internal.join(crate::worktree_lock::RESTORE_PENDING_FILE);
    std::fs::write(&marker, b"").unwrap();
    assert!(ProjectWorktreeLock::try_shared("paper")
        .unwrap_err()
        .contains("recovery is pending"));
    let recovery = ProjectWorktreeLock::exclusive_for_restore_recovery("paper").unwrap();
    std::fs::remove_file(marker).unwrap();
    drop(recovery);
    assert!(ProjectWorktreeLock::try_shared("paper").unwrap().is_some());
}

#[tokio::test]
async fn runtime_replacement_preserves_the_adapter_of_an_admitted_run() {
    let data = DataRoot::new();
    data.project("paper");
    let state = data.state(2);
    let (first_runtime, mut first_starts) = ControlledRuntime::new();
    for invalid in [String::new(), " ".into(), "bad\0id".into(), "x".repeat(81)] {
        assert!(state
            .register_runtime(invalid, first_runtime.clone())
            .is_err());
    }
    assert!(lock(&state.inner.runtimes).is_empty());
    state
        .register_runtime(" fixture ", first_runtime.clone())
        .unwrap();
    let store = state.store().unwrap();
    let first = requested(&store, draft("paper", "First adapter"));
    state.launch_ready().await.unwrap();
    let first_run = next_run(&mut first_starts).await;

    let (replacement, mut replacement_starts) = ControlledRuntime::new();
    state
        .register_runtime("fixture", replacement.clone())
        .unwrap();
    let second = requested(&store, draft("paper", "Replacement adapter"));
    state.launch_ready().await.unwrap();
    let second_run = next_run(&mut replacement_starts).await;
    assert_eq!(first_run.context.task_id, first.id);
    assert_eq!(second_run.context.task_id, second.id);
    assert!(first_starts.try_recv().is_err());

    let cancel_state = state.clone();
    let first_id = first.id.clone();
    let cancellation = tokio::spawn(async move { cancel_task(&cancel_state, first_id).await });
    first_runtime.wait_for_cancel().await;
    assert!(first_run.cancel.is_cancelled());
    assert!(lock(&replacement.cancellations).is_empty());
    first_run.complete.send(Err("cancelled".into())).unwrap();
    assert_eq!(
        tokio::time::timeout(Duration::from_secs(5), cancellation)
            .await
            .unwrap()
            .unwrap()
            .unwrap()
            .status,
        ResearchTaskStatus::Cancelled
    );
    assert_eq!(
        finish_run(&state, second_run, Ok(outcome("replacement finished")))
            .await
            .status,
        ResearchTaskStatus::AwaitingReview
    );
    stop(&state).await;
}

#[tokio::test]
async fn unavailable_runtime_and_agent_fail_without_blocking_healthy_admissions() {
    let data = DataRoot::new();
    data.project("paper");
    let state = data.state(1);
    let (runtime, mut starts) = ControlledRuntime::new();
    state.register_runtime("fixture", runtime).unwrap();
    let store = state.store().unwrap();
    let mut missing_runtime = draft("paper", "Unavailable runtime");
    missing_runtime.runtime_id = "missing".into();
    let unavailable = requested(&store, missing_runtime);
    let mut missing_agent = draft("paper", "Unsupported agent");
    missing_agent.agent_id = "unsupported".into();
    let unsupported = requested(&store, missing_agent);
    let healthy = requested(&store, draft("paper", "Healthy task"));

    state.launch_ready().await.unwrap();
    let run = next_run(&mut starts).await;
    assert_eq!(run.context.task_id, healthy.id);
    finish_run(&state, run, Ok(outcome("healthy result"))).await;
    state.launch_ready().await.unwrap();
    for (id, expected) in [
        (&unavailable.id, "missing task runtime is not available"),
        (&unsupported.id, "selected agent is not available"),
    ] {
        let failed = wait_status(&store, id, ResearchTaskStatus::Failed).await;
        assert_eq!(failed.status, ResearchTaskStatus::Failed);
        assert!(failed.error.unwrap().contains(expected));
        assert!(failed.isolation.is_none());
        assert!(failed.result.is_none());
    }
    assert!(starts.try_recv().is_err());
    stop(&state).await;
}

#[tokio::test]
async fn cancelling_preparation_settles_while_the_project_writer_remains_locked() {
    let data = DataRoot::new();
    data.project("locked-paper");
    let state = data.state(1);
    let (runtime, mut starts) = ControlledRuntime::new();
    state.register_runtime("fixture", runtime.clone()).unwrap();
    let store = state.store().unwrap();
    let task = requested(&store, draft("locked-paper", "Cancel preparation"));
    let writer = ProjectWorktreeLock::exclusive("locked-paper").unwrap();
    state.launch_ready().await.unwrap();
    let active = active_run(&state, &task.id);
    assert!(!active.runtime_started.load(Ordering::Acquire));

    let cancelled =
        tokio::time::timeout(Duration::from_secs(2), cancel_task(&state, task.id.clone()))
            .await
            .expect("cancellation waited for the external project writer")
            .unwrap();
    assert_eq!(cancelled.status, ResearchTaskStatus::Cancelled);
    assert!(cancelled.isolation.is_none());
    assert!(active.settled.load(Ordering::Acquire));
    assert!(lock(&state.inner.active).is_empty());
    assert!(lock(&runtime.cancellations).is_empty());
    assert!(starts.try_recv().is_err());
    assert!(ProjectWorktreeLock::try_shared("locked-paper")
        .unwrap()
        .is_none());
    drop(writer);
    stop(&state).await;
}

#[tokio::test]
async fn shutdown_settles_preparation_without_admitting_queued_work() {
    let data = DataRoot::new();
    data.project("locked-paper");
    let state = data.state(1);
    let (runtime, mut starts) = ControlledRuntime::new();
    state.register_runtime("fixture", runtime.clone()).unwrap();
    let store = state.store().unwrap();
    let admitted = requested(&store, draft("locked-paper", "Preparing"));
    let writer = ProjectWorktreeLock::exclusive("locked-paper").unwrap();
    state.launch_ready().await.unwrap();
    let active = active_run(&state, &admitted.id);
    let queued = requested(&store, draft("locked-paper", "Stay queued"));

    stop(&state).await;
    assert!(active.cancel.is_cancelled());
    assert!(active.settled.load(Ordering::Acquire));
    assert!(lock(&state.inner.active).is_empty());
    assert!(lock(&runtime.cancellations).is_empty());
    assert!(starts.try_recv().is_err());
    assert!(ProjectWorktreeLock::try_shared("locked-paper")
        .unwrap()
        .is_none());
    state.launch_ready().await.unwrap();
    let waiting = store.require(&queued.id).unwrap();
    assert_eq!(waiting.status, ResearchTaskStatus::Queued);
    assert!(waiting.start_requested);
    assert_eq!(
        store.require(&admitted.id).unwrap().status,
        ResearchTaskStatus::Running
    );
    drop(writer);

    let restarted = data.state(1);
    restarted.register_runtime("fixture", runtime).unwrap();
    restarted
        .recover(&crate::state::AppState::default())
        .await
        .unwrap();
    let resumed = next_run(&mut starts).await;
    assert_eq!(resumed.context.task_id, queued.id);
    assert_eq!(
        store.require(&admitted.id).unwrap().status,
        ResearchTaskStatus::Failed
    );
    finish_run(&restarted, resumed, Ok(outcome("restarted queue"))).await;
    stop(&restarted).await;
}

#[tokio::test]
async fn adapter_cleanup_failure_keeps_cancellation_retryable_until_settlement() {
    let data = DataRoot::new();
    data.project("paper");
    let state = data.state(1);
    let (runtime, mut starts) = ControlledRuntime::new();
    runtime.fail_cancel.store(true, Ordering::Release);
    state.register_runtime("fixture", runtime.clone()).unwrap();
    let store = state.store().unwrap();
    let task = requested(&store, draft("paper", "Retry cleanup"));
    state.launch_ready().await.unwrap();
    let run = next_run(&mut starts).await;
    let session_id = run.context.session_id.clone();
    let active = active_run(&state, &task.id);
    let cancel_state = state.clone();
    let task_id = task.id.clone();
    let cancellation = tokio::spawn(async move { cancel_task(&cancel_state, task_id).await });
    runtime.wait_for_cancel().await;
    assert!(run.cancel.is_cancelled());
    assert!(!cancellation.is_finished());
    assert_eq!(
        store.require(&task.id).unwrap().status,
        ResearchTaskStatus::Running
    );
    assert!(store.require(&task.id).unwrap().cancel_requested);
    run.complete
        .send(Ok(outcome("discarded after cancellation")))
        .unwrap();

    assert_eq!(
        tokio::time::timeout(Duration::from_secs(5), cancellation)
            .await
            .unwrap()
            .unwrap()
            .unwrap_err(),
        "adapter cleanup failed"
    );
    assert!(active.settled.load(Ordering::Acquire));
    assert!(lock(&state.inner.active).contains_key(&task.id));
    assert!(store.require(&task.id).unwrap().result.is_none());
    runtime.fail_cancel.store(false, Ordering::Release);
    let cancelled = cancel_task(&state, task.id.clone()).await.unwrap();
    assert_eq!(cancelled.status, ResearchTaskStatus::Cancelled);
    assert_eq!(
        *lock(&runtime.cancellations),
        vec![session_id.clone(), session_id]
    );
    assert!(lock(&state.inner.active).is_empty());
    stop(&state).await;
}

#[tokio::test]
async fn late_events_and_completion_cannot_replace_a_new_active_generation() {
    let data = DataRoot::new();
    data.project("paper");
    let state = data.state(2);
    let (runtime, mut starts) = ControlledRuntime::new();
    state.register_runtime("fixture", runtime).unwrap();
    let store = state.store().unwrap();
    let task = requested(&store, draft("paper", "Generation fencing"));
    state.launch_ready().await.unwrap();
    let old = next_run(&mut starts).await;
    let old_active = active_run(&state, &task.id);
    assert!(store
        .finish_failure(&task.id, old.context.execution_generation, "interrupted")
        .unwrap());
    store.retry(&task.id).unwrap();
    store.request_start(&task.id).unwrap();
    state.launch_ready().await.unwrap();
    let current = next_run(&mut starts).await;
    assert_eq!(
        current.context.execution_generation,
        old.context.execution_generation + 1
    );
    assert_ne!(current.context.session_id, old.context.session_id);
    (current.events)(TaskRuntimeEvent::SessionBound {
        native_session_id: "current-native".into(),
    });
    (current.events)(TaskRuntimeEvent::Text {
        text: "current text".into(),
    });
    (old.events)(TaskRuntimeEvent::SessionBound {
        native_session_id: "stale-native".into(),
    });
    (old.events)(TaskRuntimeEvent::Text {
        text: "stale text".into(),
    });
    old.complete.send(Ok(outcome("stale result"))).unwrap();
    wait_settled(&old_active).await;

    let running = store.require(&task.id).unwrap();
    assert_eq!(running.status, ResearchTaskStatus::Running);
    assert_eq!(running.native_session_id.as_deref(), Some("current-native"));
    assert_eq!(
        active_run(&state, &task.id).execution_generation,
        current.context.execution_generation
    );
    assert!(!current.cancel.is_cancelled());
    let events = store
        .events(&task.id, current.context.execution_generation, None, 100)
        .unwrap();
    assert_eq!(
        events
            .events
            .into_iter()
            .map(|event| event.event)
            .collect::<Vec<_>>(),
        vec![
            TaskRuntimeEvent::SessionBound {
                native_session_id: "current-native".into()
            },
            TaskRuntimeEvent::Text {
                text: "current text".into()
            },
        ]
    );
    assert!(store
        .events(&task.id, old_active.execution_generation, None, 100)
        .unwrap()
        .events
        .is_empty());
    let finished = finish_run(&state, current, Ok(outcome("current result"))).await;
    assert_eq!(finished.result.unwrap().summary, "current result");
    stop(&state).await;
}

#[tokio::test]
async fn runtime_and_review_failures_release_the_queue_and_retain_isolated_files() {
    let data = DataRoot::new();
    let project = data.project("paper");
    let state = data.state(1);
    let (runtime, mut starts) = ControlledRuntime::new();
    state.register_runtime("fixture", runtime).unwrap();
    let store = state.store().unwrap();
    let failed_runtime = requested(&store, draft("paper", "Runtime failure"));
    state.launch_ready().await.unwrap();
    let first = next_run(&mut starts).await;
    let failed_review = requested(&store, draft("paper", "Invalid artifact"));
    let failed = finish_run(&state, first, Err("provider disconnected".into())).await;
    assert_eq!(failed.id, failed_runtime.id);
    assert_eq!(failed.status, ResearchTaskStatus::Failed);
    assert_eq!(failed.error.as_deref(), Some("provider disconnected"));

    let second = next_run(&mut starts).await;
    assert_eq!(second.context.task_id, failed_review.id);
    let workspace = PathBuf::from(&second.context.execution_root);
    std::fs::write(workspace.join("main.tex"), "isolated revision").unwrap();
    let healthy = requested(&store, draft("paper", "Continue after review failure"));
    let mut invalid = outcome("has an invalid artifact");
    invalid.artifacts.push(TaskArtifact {
        path: "missing.txt".into(),
        label: "Missing output".into(),
        media_type: None,
    });
    let failed = finish_run(&state, second, Ok(invalid)).await;
    assert_eq!(failed.status, ResearchTaskStatus::Failed);
    assert!(failed
        .error
        .unwrap()
        .contains("has no reviewed output file"));
    assert!(failed.result.is_none());
    assert_eq!(
        std::fs::read_to_string(workspace.join("main.tex")).unwrap(),
        "isolated revision"
    );
    assert_eq!(
        std::fs::read_to_string(project.join("main.tex")).unwrap(),
        "original manuscript"
    );
    let third = next_run(&mut starts).await;
    assert_eq!(third.context.task_id, healthy.id);
    assert_eq!(
        finish_run(&state, third, Ok(outcome("healthy")))
            .await
            .status,
        ResearchTaskStatus::AwaitingReview
    );
    stop(&state).await;
}

#[tokio::test]
async fn isolation_failure_releases_admission_and_can_be_retried_after_repair() {
    let data = DataRoot::new();
    data.project("paper");
    let state = data.state(1);
    let (runtime, mut starts) = ControlledRuntime::new();
    state.register_runtime("fixture", runtime).unwrap();
    let store = state.store().unwrap();
    let missing = requested(&store, draft("missing-paper", "Missing project"));
    let healthy = requested(&store, draft("paper", "Healthy project"));
    state.launch_ready().await.unwrap();
    let run = next_run(&mut starts).await;
    assert_eq!(run.context.task_id, healthy.id);
    finish_run(&state, run, Ok(outcome("healthy result"))).await;
    let permit = tokio::time::timeout(
        Duration::from_secs(5),
        state.inner.concurrency.clone().acquire_owned(),
    )
    .await
    .unwrap()
    .unwrap();
    drop(permit);
    state.launch_ready().await.unwrap();
    let failed = wait_status(&store, &missing.id, ResearchTaskStatus::Failed).await;
    assert_eq!(failed.status, ResearchTaskStatus::Failed);
    assert!(failed.error.unwrap().contains("project does not exist"));
    assert!(failed.isolation.is_none());

    data.project("missing-paper");
    store.retry(&missing.id).unwrap();
    state.launch_ready().await.unwrap();
    assert!(starts.try_recv().is_err());
    store.request_start(&missing.id).unwrap();
    state.launch_ready().await.unwrap();
    let retry = next_run(&mut starts).await;
    assert_eq!(retry.context.task_id, missing.id);
    assert_eq!(retry.context.execution_generation, 2);
    assert_eq!(
        finish_run(&state, retry, Ok(outcome("repaired")))
            .await
            .status,
        ResearchTaskStatus::AwaitingReview
    );
    stop(&state).await;
}

#[tokio::test]
async fn restart_recovers_interrupted_runs_without_losing_their_workspace_or_transcript() {
    let data = DataRoot::new();
    data.project("paper");
    let state = data.state(1);
    let store = state.store().unwrap();
    let task = requested(&store, draft("paper", "Interrupted run"));
    let claimed = store.claim_next().unwrap().unwrap();
    let preparation_store = store.clone();
    let preparation_task = claimed.clone();
    let isolation = tokio::task::spawn_blocking(move || {
        isolation::prepare(
            &preparation_store,
            &preparation_task,
            &CancellationToken::new(),
        )
    })
    .await
    .unwrap()
    .unwrap();
    assert!(store
        .set_isolation(&task.id, claimed.execution_generation, &isolation)
        .unwrap());
    assert!(store
        .set_native_session(&task.id, claimed.execution_generation, "interrupted-native")
        .unwrap());
    store
        .append_event(
            &task.id,
            claimed.execution_generation,
            &TaskRuntimeEvent::Text {
                text: "saved progress".into(),
            },
        )
        .unwrap();
    std::fs::write(
        PathBuf::from(&isolation.execution_root).join("main.tex"),
        "recoverable edit",
    )
    .unwrap();
    let queued = requested(&store, draft("paper", "Requested before restart"));
    let (runtime, mut starts) = ControlledRuntime::new();
    state.register_runtime("fixture", runtime).unwrap();

    state
        .recover(&crate::state::AppState::default())
        .await
        .unwrap();
    let recovered = store.require(&task.id).unwrap();
    assert_eq!(recovered.status, ResearchTaskStatus::Failed);
    assert_eq!(recovered.isolation, Some(isolation.clone()));
    assert_eq!(
        recovered.native_session_id.as_deref(),
        Some("interrupted-native")
    );
    assert!(recovered
        .error
        .unwrap()
        .contains("closed before this run finished"));
    assert_eq!(
        store
            .events(&task.id, claimed.execution_generation, None, 100)
            .unwrap()
            .events
            .len(),
        1
    );
    assert_eq!(
        std::fs::read_to_string(PathBuf::from(&isolation.execution_root).join("main.tex")).unwrap(),
        "recoverable edit"
    );
    let next = next_run(&mut starts).await;
    assert_eq!(next.context.task_id, queued.id);
    finish_run(&state, next, Ok(outcome("queue resumed"))).await;
    assert!(starts.try_recv().is_err());
    stop(&state).await;
}

#[tokio::test]
async fn an_orphaned_running_task_requires_recovery_before_it_can_be_retried() {
    let directory = tempfile::tempdir().unwrap();
    let state = ResearchTaskState::for_test(directory.path().join("tasks"), 1);
    let store = state.store().unwrap();
    let task = requested(&store, draft("paper", "Orphaned run"));
    store.claim_next().unwrap().unwrap();
    let error = tokio::time::timeout(Duration::from_secs(2), cancel_task(&state, task.id.clone()))
        .await
        .expect("orphaned cancellation never returned recovery guidance")
        .unwrap_err();
    assert!(error.contains("runtime is no longer attached"));
    let stopping = store.require(&task.id).unwrap();
    assert_eq!(stopping.status, ResearchTaskStatus::Running);
    assert!(stopping.cancel_requested);
    assert!(store.retry(&task.id).is_err());

    state
        .recover(&crate::state::AppState::default())
        .await
        .unwrap();
    let recovered = store.require(&task.id).unwrap();
    assert_eq!(recovered.status, ResearchTaskStatus::Failed);
    assert!(!recovered.cancel_requested);
    let retry = store.retry(&task.id).unwrap();
    assert_eq!(retry.status, ResearchTaskStatus::Queued);
    assert!(!retry.start_requested);
    assert!(lock(&state.inner.active).is_empty());
    stop(&state).await;
}
