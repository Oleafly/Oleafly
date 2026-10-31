use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::time::Duration;

use tokio::sync::{mpsc, oneshot};

use super::*;
use crate::host::IsolationEnv;
use crate::model::{TaskArtifact, ToolPhase};
use crate::test_support::{FakeEnv, FakeHost, CHILD_PATIENCE};

struct DataRoot {
    directory: tempfile::TempDir,
    host: FakeHost,
}

impl DataRoot {
    fn new() -> Self {
        Self {
            directory: tempfile::tempdir().unwrap(),
            host: FakeHost::new(FakeEnv::new()),
        }
    }

    fn project(&self, id: &str) -> PathBuf {
        let project = self.directory.path().join("projects").join(id);
        std::fs::create_dir_all(&project).unwrap();
        std::fs::write(project.join("main.tex"), "original manuscript").unwrap();
        self.host.add_project(id, &project);
        project
    }

    fn state(&self, concurrency: usize) -> ResearchTaskState {
        let state = ResearchTaskState::for_test(self.directory.path().join("tasks"), concurrency);
        state.attach(
            Arc::new(self.host.clone()),
            tokio::runtime::Handle::current(),
        );
        state
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
        ..Default::default()
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
    tokio::time::timeout(CHILD_PATIENCE, receiver.recv())
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
    let cancellation = tokio::spawn(async move { cancel_state.cancel(first_id).await });
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
    data.host.set_writer_locked("locked-paper", true);
    state.launch_ready().await.unwrap();
    let active = active_run(&state, &task.id);
    assert!(!active.runtime_started.load(Ordering::Acquire));

    let cancelled = tokio::time::timeout(Duration::from_secs(2), state.cancel(task.id.clone()))
        .await
        .expect("cancellation waited for the external project writer")
        .unwrap();
    assert_eq!(cancelled.status, ResearchTaskStatus::Cancelled);
    assert!(cancelled.isolation.is_none());
    assert!(active.settled.load(Ordering::Acquire));
    assert!(lock(&state.inner.active).is_empty());
    assert!(lock(&runtime.cancellations).is_empty());
    assert!(starts.try_recv().is_err());
    assert!(data
        .host
        .try_shared_project_lock("locked-paper")
        .unwrap()
        .is_none());
    data.host.set_writer_locked("locked-paper", false);
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
    data.host.set_writer_locked("locked-paper", true);
    state.launch_ready().await.unwrap();
    let active = active_run(&state, &admitted.id);
    let queued = requested(&store, draft("locked-paper", "Stay queued"));

    stop(&state).await;
    assert!(active.cancel.is_cancelled());
    assert!(active.settled.load(Ordering::Acquire));
    assert!(lock(&state.inner.active).is_empty());
    assert!(lock(&runtime.cancellations).is_empty());
    assert!(starts.try_recv().is_err());
    assert!(data
        .host
        .try_shared_project_lock("locked-paper")
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
    data.host.set_writer_locked("locked-paper", false);

    let restarted = data.state(1);
    restarted.register_runtime("fixture", runtime).unwrap();
    restarted.recover_runs(true).await.unwrap();
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
    let cancellation = tokio::spawn(async move { cancel_state.cancel(task_id).await });
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
    let cancelled = state.cancel(task.id.clone()).await.unwrap();
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
    store
        .retry_with(&task.id, crate::model::RetryMode::Fresh)
        .unwrap();
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
    store
        .retry_with(&missing.id, crate::model::RetryMode::Fresh)
        .unwrap();
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
    let preparation_host = data.host.clone();
    let isolation = tokio::task::spawn_blocking(move || {
        isolation::prepare(
            &preparation_store,
            &preparation_host,
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

    state.recover_runs(true).await.unwrap();
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
async fn the_startup_sweep_only_clears_settled_tasks() {
    let data = DataRoot::new();
    data.project("paper");
    let state = data.state(1);
    let store = state.store().unwrap();
    let failed = requested(&store, draft("paper", "Failed earlier"));
    let claimed = store.claim_next().unwrap().unwrap();
    assert!(store
        .finish_failure(&failed.id, claimed.execution_generation, "stopped")
        .unwrap());
    let running = requested(&store, draft("paper", "Preparing its workspace"));
    assert_eq!(store.claim_next().unwrap().unwrap().id, running.id);
    let queued = requested(&store, draft("paper", "About to be claimed"));
    let stray = |id: &str| {
        let folder = isolation::task_workspace_root(store.root(), id).join("next-generation");
        std::fs::create_dir_all(&folder).unwrap();
        std::fs::write(folder.join("main.tex"), "copy").unwrap();
        folder
    };
    let (failed_folder, running_folder, queued_folder) =
        (stray(&failed.id), stray(&running.id), stray(&queued.id));

    state.sweep_old_generations(&store).unwrap().await.unwrap();
    assert!(!failed_folder.exists());
    assert!(running_folder.join("main.tex").is_file());
    assert!(queued_folder.join("main.tex").is_file());
    stop(&state).await;
}

#[tokio::test]
async fn an_orphaned_running_task_requires_recovery_before_it_can_be_retried() {
    let directory = tempfile::tempdir().unwrap();
    let state = ResearchTaskState::for_test(directory.path().join("tasks"), 1);
    let store = state.store().unwrap();
    let task = requested(&store, draft("paper", "Orphaned run"));
    store.claim_next().unwrap().unwrap();
    let error = tokio::time::timeout(CHILD_PATIENCE, state.cancel(task.id.clone()))
        .await
        .expect("orphaned cancellation never returned recovery guidance")
        .unwrap_err();
    assert!(error.contains("runtime is no longer attached"));
    let stopping = store.require(&task.id).unwrap();
    assert_eq!(stopping.status, ResearchTaskStatus::Running);
    assert!(stopping.cancel_requested);
    assert!(store
        .retry_with(&task.id, crate::model::RetryMode::Fresh)
        .is_err());

    state.recover_runs(true).await.unwrap();
    let recovered = store.require(&task.id).unwrap();
    assert_eq!(recovered.status, ResearchTaskStatus::Failed);
    assert!(!recovered.cancel_requested);
    let retry = store
        .retry_with(&task.id, crate::model::RetryMode::Fresh)
        .unwrap();
    assert_eq!(retry.status, ResearchTaskStatus::Queued);
    assert!(!retry.start_requested);
    assert!(lock(&state.inner.active).is_empty());
    stop(&state).await;
}

#[tokio::test]
async fn streamed_deltas_collapse_into_one_row_per_segment_and_only_text_rows_are_capped() {
    let data = DataRoot::new();
    data.project("paper");
    let state = data.state(1);
    let (runtime, mut starts) = ControlledRuntime::new();
    state.register_runtime("fixture", runtime).unwrap();
    let store = state.store().unwrap();
    let task = requested(&store, draft("paper", "Streamed answer"));
    state.launch_ready().await.unwrap();
    let run = next_run(&mut starts).await;
    let generation = run.context.execution_generation;

    for delta in ["Chec", "king ", "the sources."] {
        (run.events)(TaskRuntimeEvent::Reasoning { text: delta.into() });
    }
    (run.events)(TaskRuntimeEvent::Tool {
        call_id: Some("call_1".into()),
        name: "read_file".into(),
        phase: ToolPhase::Request,
        detail: "main.tex".into(),
        status: Some("running".into()),
    });
    for delta in ["The ", "sample ", "sizes match."] {
        (run.events)(TaskRuntimeEvent::Text { text: delta.into() });
    }

    let stored = state
        .events(&task.id, generation, None, 100)
        .unwrap()
        .events;
    assert_eq!(
        stored
            .iter()
            .map(|entry| entry.event.clone())
            .collect::<Vec<_>>(),
        vec![
            TaskRuntimeEvent::Reasoning {
                text: "Checking the sources.".into()
            },
            TaskRuntimeEvent::Tool {
                call_id: Some("call_1".into()),
                name: "read_file".into(),
                phase: ToolPhase::Request,
                detail: "main.tex".into(),
                status: Some("running".into()),
            },
            TaskRuntimeEvent::Text {
                text: "The sample sizes match.".into()
            },
        ]
    );
    assert_eq!(
        stored
            .iter()
            .map(|entry| entry.sequence)
            .collect::<Vec<_>>(),
        vec![1, 2, 3]
    );

    for index in 0..(crate::store::MAX_EVENTS_PER_RUN + 8) {
        store
            .append_event(
                &task.id,
                generation,
                &TaskRuntimeEvent::Text {
                    text: format!("filler {index}"),
                },
            )
            .unwrap();
    }
    let kept = store
        .events(&task.id, generation, None, 200)
        .unwrap()
        .events;
    let tool_rows = kept
        .iter()
        .filter(|entry| matches!(entry.event, TaskRuntimeEvent::Tool { .. }))
        .count();
    assert_eq!(tool_rows, 1, "the cap must never drop a tool row");
    let text_rows = store.text_event_count(&task.id, generation).unwrap();
    assert_eq!(text_rows, crate::store::MAX_EVENTS_PER_RUN as i64);
    assert!(kept.iter().all(|entry| entry.event
        != TaskRuntimeEvent::Reasoning {
            text: "Checking the sources.".into()
        }));
    finish_run(&state, run, Ok(outcome("streamed result"))).await;
    stop(&state).await;
}

#[tokio::test]
async fn a_hundred_thousand_deltas_commit_in_batches() {
    let data = DataRoot::new();
    data.project("paper");
    let state = data.state(1);
    let (runtime, mut starts) = ControlledRuntime::new();
    state.register_runtime("fixture", runtime).unwrap();
    let store = state.store().unwrap();
    let task = requested(&store, draft("paper", "A long answer"));
    state.launch_ready().await.unwrap();
    let run = next_run(&mut starts).await;
    let generation = run.context.execution_generation;
    state.writer().flush();
    let before = state.writer().commits.load(Ordering::Relaxed);
    let started = std::time::Instant::now();

    for _ in 0..100_000 {
        (run.events)(TaskRuntimeEvent::Text { text: "x".into() });
    }
    let stored = state
        .events(&task.id, generation, None, 100)
        .unwrap()
        .events;
    let elapsed = started.elapsed();

    let commits = state.writer().commits.load(Ordering::Relaxed) - before;
    let allowed =
        (elapsed.as_millis() / crate::recorder::WRITER_COMMIT_EVERY.as_millis()) as usize + 2;
    assert!(commits <= allowed, "{commits} commits in {elapsed:?}");
    let lengths: Vec<usize> = stored
        .iter()
        .filter_map(|entry| match &entry.event {
            TaskRuntimeEvent::Text { text } => Some(text.len()),
            _ => None,
        })
        .collect();
    assert_eq!(lengths.len(), 100_000usize.div_ceil(32 * 1024));
    assert!(
        lengths.iter().all(|length| *length <= 32 * 1024),
        "{lengths:?}"
    );
    assert_eq!(lengths.iter().sum::<usize>(), 100_000, "no text is lost");
    finish_run(&state, run, Ok(outcome("long result"))).await;
    stop(&state).await;
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
    let mut unavailable = draft("paper", "Revise");
    unavailable.runtime_id = "unavailable-runtime".into();
    unavailable.agent_id = "unavailable-agent".into();
    let task = store.create(unavailable).unwrap();
    store.request_start(&task.id).unwrap();
    let claimed = store.claim_next().unwrap().unwrap();
    let result = TaskResultMetadata {
        summary: "Saved changes for review".into(),
        changed_files: vec![crate::model::TaskFileChange {
            path: "main.tex".into(),
            kind: crate::model::TaskFileChangeKind::Modified,
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
    let cancelled = state.cancel(task.id).await.unwrap();
    assert_eq!(cancelled.status, ResearchTaskStatus::Cancelled);
    assert_eq!(cancelled.result, Some(result));
    assert!(lock(&state.inner.active).is_empty());
    assert!(lock(&state.inner.runtimes).is_empty());
}

#[tokio::test]
async fn queue_runs_registered_adapters_and_persists_review_state() {
    let data = DataRoot::new();
    let project = data.project("paper");
    std::fs::write(project.join("main.tex"), "base").unwrap();
    let state = data.state(1);
    let runtime = Arc::new(FixtureRuntime {
        runs: AtomicUsize::new(0),
    });
    state.register_runtime("fixture", runtime.clone()).unwrap();
    let store = state.store().unwrap();
    let task = store.create(draft("paper", "Revise")).unwrap();
    let second = store.create(draft("paper", "Review")).unwrap();
    store.request_start(&task.id).unwrap();
    store.request_start(&second.id).unwrap();

    state.launch_ready().await.unwrap();
    let active = |id: &str| {
        matches!(
            store.require(id).unwrap().status,
            ResearchTaskStatus::Queued | ResearchTaskStatus::Running
        )
    };
    tokio::time::timeout(CHILD_PATIENCE, async {
        while active(&task.id) || active(&second.id) {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("both tasks finish running");

    let finished = store.require(&task.id).unwrap();
    let second_finished = store.require(&second.id).unwrap();
    assert_eq!(runtime.runs.load(Ordering::SeqCst), 2);
    assert_eq!(finished.status, ResearchTaskStatus::AwaitingReview);
    assert_eq!(second_finished.status, ResearchTaskStatus::AwaitingReview);
    let changed: Vec<String> = finished
        .result
        .unwrap()
        .changed_files
        .into_iter()
        .map(|change| change.path)
        .collect();
    assert!(changed.iter().any(|path| path == "main.tex"), "{changed:?}");
    assert!(
        changed
            .iter()
            .all(|path| path == "main.tex" || path.starts_with("research/")),
        "{changed:?}"
    );
    assert_eq!(
        std::fs::read_to_string(project.join("main.tex")).unwrap(),
        "base"
    );
}

#[tokio::test]
async fn shutdown_stops_admitted_work_and_waits_for_runtime_settlement() {
    verify_shutdown_recovery(false).await;
}

#[tokio::test]
async fn failed_update_recovers_settled_tasks_and_resumes_queued_work() {
    verify_shutdown_recovery(true).await;
}

async fn verify_shutdown_recovery(resume: bool) {
    let data = DataRoot::new();
    data.project("shutdown-paper");
    let state = data.state(1);
    let settled = Arc::new(AtomicBool::new(false));
    let runtime = Arc::new(BlockingRuntime {
        runs: AtomicUsize::new(0),
        settled: settled.clone(),
    });
    state.register_runtime("fixture", runtime.clone()).unwrap();
    let store = state.store().unwrap();
    let task = store
        .create(draft("shutdown-paper", "Keep working"))
        .unwrap();
    store.request_start(&task.id).unwrap();
    state.launch_ready().await.unwrap();
    tokio::time::timeout(CHILD_PATIENCE, async {
        while runtime.runs.load(Ordering::SeqCst) < 1 {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("the admitted task reaches its runtime");

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
        .create(draft("shutdown-paper", "Do not start"))
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
        store
            .retry_with(&task.id, crate::model::RetryMode::Fresh)
            .unwrap();
        tokio::time::timeout(CHILD_PATIENCE, async {
            while runtime.runs.load(Ordering::SeqCst) < 2 {
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .expect("queued work resumes after the failed update");
        state.shutdown().await;
    }
}

#[tokio::test]
async fn a_state_without_a_host_refuses_work_with_a_clear_message() {
    let temp = tempfile::tempdir().unwrap();
    let state = ResearchTaskState::for_test(temp.path().join("tasks"), 1);
    assert_eq!(state.create(draft("paper", "T")).unwrap_err(), NOT_ATTACHED);
    let task = state.store().unwrap().create(draft("paper", "T")).unwrap();
    assert_eq!(state.request_start(&task.id).unwrap_err(), NOT_ATTACHED);
    assert_eq!(state.delete(&task.id).unwrap_err(), NOT_ATTACHED);
    state.store().unwrap().request_start(&task.id).unwrap();
    state.launch_ready().await.unwrap();
    assert_eq!(
        state.store().unwrap().require(&task.id).unwrap().status,
        ResearchTaskStatus::Queued
    );
}

#[tokio::test]
async fn events_are_reported_through_the_host_not_tauri() {
    let data = DataRoot::new();
    data.project("paper");
    let state = data.state(1);
    let runtime = Arc::new(FixtureRuntime {
        runs: AtomicUsize::new(0),
    });
    state.register_runtime("fixture", runtime).unwrap();
    let task = state.create(draft("paper", "Revise")).unwrap();
    state.request_start(&task.id).unwrap();
    state.launch_ready().await.unwrap();
    let store = state.store().unwrap();
    tokio::time::timeout(CHILD_PATIENCE, async {
        while store.require(&task.id).unwrap().status != ResearchTaskStatus::AwaitingReview {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("the task reaches review");
    let statuses = data.host.changed_statuses(&task.id);
    assert_eq!(statuses.first(), Some(&ResearchTaskStatus::Queued));
    assert!(statuses.contains(&ResearchTaskStatus::Running));
    assert_eq!(statuses.last(), Some(&ResearchTaskStatus::AwaitingReview));
    let appended = data.host.appended.lock().unwrap().clone();
    assert!(appended.iter().any(|row| row.task_id == task.id
        && row.event
            == TaskRuntimeEvent::Status {
                message: "Working".into()
            }));
}

#[tokio::test]
async fn an_untrusted_project_cannot_be_created_started_or_retried() {
    let data = DataRoot::new();
    data.project("paper");
    let state = data.state(1);
    let (runtime, _starts) = ControlledRuntime::new();
    state.register_runtime("fixture", runtime).unwrap();
    let queued = state.create(draft("paper", "Queued")).unwrap();
    let waiting = state.create(draft("paper", "Waiting")).unwrap();
    data.host.set_trusted("paper", false);
    let start = state.request_start(&waiting.id).unwrap_err();
    assert!(start.contains("trust.research_tasks"), "{start}");
    let refused = state.create(draft("paper", "Refused")).unwrap_err();
    assert!(refused.contains("trust.research_tasks"), "{refused}");
    let store = state.store().unwrap();
    store.request_cancel(&queued.id).unwrap();
    let retry = state
        .retry(&queued.id, crate::model::RetryMode::Fresh)
        .unwrap_err();
    assert!(retry.contains("trust.research_tasks"), "{retry}");
}

#[tokio::test]
async fn a_skill_that_is_off_blocks_creation_with_the_host_message() {
    let data = DataRoot::new();
    data.project("paper");
    let state = data.state(1);
    data.host.missing_skills.lock().unwrap().insert(
        "peer-review".into(),
        "The skill peer-review is turned off. Enable it in Settings, AI, Skills.".into(),
    );
    let mut with_skill = draft("paper", "Review");
    with_skill.skill_ids = vec!["peer-review".into()];
    assert_eq!(
        state.create(with_skill).unwrap_err(),
        "The skill peer-review is turned off. Enable it in Settings, AI, Skills."
    );
    assert!(state.create(draft("paper", "Plain")).is_ok());
}

mod handoff {
    use super::*;
    use crate::approvals::GateContext;
    use crate::handoff::{HandoffReason, HandoffRecord};
    use crate::model::{ApprovalKind, CommandPolicy, RunRecord, RunState, SuspendState};

    fn keep_running(project: &str, title: &str) -> ResearchTaskDraft {
        ResearchTaskDraft {
            keep_running_after_quit: true,
            ..draft(project, title)
        }
    }

    fn state_as(data: &DataRoot, owner: OwnerKind, concurrency: usize) -> ResearchTaskState {
        let mut host = data.host.clone();
        host.owner = owner;
        let state = ResearchTaskState::for_test(data.directory.path().join("tasks"), concurrency);
        state.attach(Arc::new(host), tokio::runtime::Handle::current());
        state
    }

    async fn started(
        state: &ResearchTaskState,
        runtime: &Arc<ControlledRuntime>,
        receiver: &mut mpsc::UnboundedReceiver<StartedRun>,
        task: &ResearchTask,
    ) -> StartedRun {
        let _ = runtime;
        state.launch_ready().await.unwrap();
        let run = next_run(receiver).await;
        assert_eq!(run.context.task_id, task.id);
        run
    }

    async fn wait_until(mut ready: impl FnMut() -> bool) {
        tokio::time::timeout(Duration::from_secs(5), async {
            while !ready() {
                tokio::time::sleep(Duration::from_millis(5)).await;
            }
        })
        .await
        .expect("the condition did not hold in time");
    }

    fn snapshot_state(generation: u64) -> SuspendState {
        SuspendState {
            conversation: Some(format!("{generation}-conversation.json")),
            turn_interrupted: false,
            acp: None,
        }
    }

    async fn suspend_when_asked(state: &ResearchTaskState, run: StartedRun) {
        let services = state.services().unwrap();
        let task_id = run.context.task_id.clone();
        wait_until(|| services.suspends.requested(&task_id)).await;
        services
            .suspends
            .record(&task_id, snapshot_state(run.context.execution_generation));
        run.complete.send(Ok(outcome(""))).unwrap();
    }

    #[tokio::test]
    async fn suspending_records_the_conversation_and_leaves_the_task_for_a_handoff() {
        let data = DataRoot::new();
        data.project("paper");
        let state = data.state(2);
        let (runtime, mut starts) = ControlledRuntime::new();
        state.register_runtime("fixture", runtime.clone()).unwrap();
        let store = state.store().unwrap();
        let task = requested(&store, keep_running("paper", "Overnight"));
        let run = started(&state, &runtime, &mut starts, &task).await;
        let generation = run.context.execution_generation;
        let suspending = {
            let state = state.clone();
            let id = task.id.clone();
            tokio::spawn(async move {
                state
                    .suspend(&[id], SuspendMode::Prompt, Some(Duration::from_secs(5)))
                    .await
            })
        };
        suspend_when_asked(&state, run).await;
        let results = suspending.await.unwrap();
        let SuspendResult::Suspended {
            state: saved,
            generation: suspended,
        } = &results[0].1
        else {
            panic!("expected a suspended task: {results:?}");
        };
        assert_eq!(*suspended, generation);
        assert!(saved.conversation.is_some());
        assert_eq!(
            store.require(&task.id).unwrap().status,
            ResearchTaskStatus::Running
        );
        assert!(lock(&runtime.cancellations).is_empty());

        let (generation, record) = handoff_record_for(
            &results[0].1,
            OwnerKind::App,
            OwnerKind::Daemon,
            HandoffReason::Quit,
        )
        .unwrap();
        assert!(state
            .hand_off_suspended(&task.id, generation, OwnerKind::Daemon, record)
            .await
            .unwrap());
        let moved = store.require(&task.id).unwrap();
        assert_eq!(
            (moved.status, moved.owner),
            (ResearchTaskStatus::Queued, OwnerKind::Daemon)
        );
        assert_eq!(
            store
                .handoff_record(&task.id)
                .unwrap()
                .unwrap()
                .conversation,
            Some(format!("{generation}-conversation.json"))
        );
        stop(&state).await;
    }

    #[tokio::test]
    async fn two_suspends_of_one_task_both_get_its_saved_conversation() {
        let data = DataRoot::new();
        data.project("paper");
        let state = data.state(2);
        let (runtime, mut starts) = ControlledRuntime::new();
        state.register_runtime("fixture", runtime.clone()).unwrap();
        let store = state.store().unwrap();
        let task = requested(&store, keep_running("paper", "Overnight"));
        let run = started(&state, &runtime, &mut starts, &task).await;
        let generation = run.context.execution_generation;
        let suspend = |mode, deadline| {
            let state = state.clone();
            let id = task.id.clone();
            tokio::spawn(async move { state.suspend(&[id], mode, deadline).await })
        };
        let reclaim = suspend(SuspendMode::Graceful, None);
        let release = suspend(SuspendMode::Prompt, Some(Duration::from_secs(5)));
        suspend_when_asked(&state, run).await;
        for results in [reclaim.await.unwrap(), release.await.unwrap()] {
            assert_eq!(
                results[0].1,
                SuspendResult::Suspended {
                    generation,
                    state: snapshot_state(generation),
                },
                "{results:?}"
            );
        }
        stop(&state).await;
    }

    #[tokio::test]
    async fn a_suspend_that_misses_its_deadline_stops_the_runtime_and_keeps_its_task() {
        let data = DataRoot::new();
        data.project("paper");
        let state = data.state(2);
        let (runtime, mut starts) = ControlledRuntime::new();
        state.register_runtime("fixture", runtime.clone()).unwrap();
        let store = state.store().unwrap();
        let task = requested(&store, keep_running("paper", "Stubborn"));
        let run = started(&state, &runtime, &mut starts, &task).await;
        let suspending = {
            let state = state.clone();
            let id = task.id.clone();
            tokio::spawn(async move {
                state
                    .suspend(&[id], SuspendMode::Prompt, Some(Duration::from_millis(100)))
                    .await
            })
        };
        runtime.wait_for_cancel().await;
        assert!(run.cancel.is_cancelled());
        run.complete.send(Err("stopped".into())).unwrap();
        let results = suspending.await.unwrap();
        assert!(
            matches!(results[0].1, SuspendResult::Stopped { .. }),
            "{results:?}"
        );
        let current = store.require(&task.id).unwrap();
        assert_eq!(current.status, ResearchTaskStatus::Running);
        assert!(current.error.is_none());
        stop(&state).await;
    }

    #[tokio::test]
    async fn a_task_still_preparing_its_workspace_is_reported_unstarted() {
        let data = DataRoot::new();
        data.project("paper");
        data.host.set_writer_locked("paper", true);
        let state = data.state(2);
        let (runtime, _starts) = ControlledRuntime::new();
        state.register_runtime("fixture", runtime.clone()).unwrap();
        let store = state.store().unwrap();
        let task = requested(&store, keep_running("paper", "Waiting for the lock"));
        state.launch_ready().await.unwrap();
        wait_until(|| store.require(&task.id).unwrap().status == ResearchTaskStatus::Running).await;
        let results = state
            .suspend(
                std::slice::from_ref(&task.id),
                SuspendMode::Prompt,
                Some(Duration::from_millis(100)),
            )
            .await;
        assert!(
            matches!(results[0].1, SuspendResult::Unstarted { .. }),
            "{results:?}"
        );
        let (generation, record) = handoff_record_for(
            &results[0].1,
            OwnerKind::App,
            OwnerKind::Daemon,
            HandoffReason::Quit,
        )
        .unwrap();
        assert!(state
            .hand_off_suspended(&task.id, generation, OwnerKind::Daemon, record)
            .await
            .unwrap());
        let queued = store.require(&task.id).unwrap();
        assert_eq!(queued.status, ResearchTaskStatus::Queued);
        assert!(
            queued.pending_start.is_none(),
            "an unstarted task starts fresh"
        );
        data.host.set_writer_locked("paper", false);
        stop(&state).await;
    }

    #[tokio::test]
    async fn a_task_that_finishes_while_suspending_finishes_normally() {
        let data = DataRoot::new();
        data.project("paper");
        let state = data.state(2);
        let (runtime, mut starts) = ControlledRuntime::new();
        state.register_runtime("fixture", runtime.clone()).unwrap();
        let store = state.store().unwrap();
        let task = requested(&store, keep_running("paper", "Almost done"));
        let run = started(&state, &runtime, &mut starts, &task).await;
        let suspending = {
            let state = state.clone();
            let id = task.id.clone();
            tokio::spawn(async move {
                state
                    .suspend(&[id], SuspendMode::Prompt, Some(Duration::from_secs(5)))
                    .await
            })
        };
        let services = state.services().unwrap();
        wait_until(|| services.suspends.requested(&task.id)).await;
        run.complete.send(Ok(outcome("finished"))).unwrap();
        let results = suspending.await.unwrap();
        assert_eq!(results[0].1, SuspendResult::NotRunning);
        assert_eq!(
            wait_status(&store, &task.id, ResearchTaskStatus::AwaitingReview)
                .await
                .status,
            ResearchTaskStatus::AwaitingReview
        );
        stop(&state).await;
    }

    #[tokio::test]
    async fn no_queued_task_starts_while_a_handoff_is_suspending_work() {
        let data = DataRoot::new();
        data.project("paper");
        let state = data.state(2);
        let (runtime, mut starts) = ControlledRuntime::new();
        state.register_runtime("fixture", runtime.clone()).unwrap();
        let store = state.store().unwrap();
        let first = requested(&store, keep_running("paper", "Running"));
        let run = started(&state, &runtime, &mut starts, &first).await;
        state.stop_admitting();
        let waiting = requested(&store, draft("paper", "Waiting"));
        let suspending = {
            let state = state.clone();
            let id = first.id.clone();
            tokio::spawn(async move {
                state
                    .suspend(&[id], SuspendMode::Prompt, Some(Duration::from_secs(5)))
                    .await
            })
        };
        suspend_when_asked(&state, run).await;
        suspending.await.unwrap();
        state.launch_ready().await.unwrap();
        tokio::time::sleep(Duration::from_millis(100)).await;
        assert!(starts.try_recv().is_err());
        assert_eq!(
            store.require(&waiting.id).unwrap().status,
            ResearchTaskStatus::Queued
        );
        stop(&state).await;
    }

    #[tokio::test]
    async fn resumed_tasks_take_free_slots_before_queued_tasks() {
        let data = DataRoot::new();
        data.project("paper");
        let state = data.state(1);
        let (runtime, mut starts) = ControlledRuntime::new();
        state.register_runtime("fixture", runtime.clone()).unwrap();
        let store = state.store().unwrap();
        let earlier = store.create(draft("paper", "Created first")).unwrap();
        let resumed = requested(&store, keep_running("paper", "Resumed"));
        let run = started(&state, &runtime, &mut starts, &resumed).await;
        let suspending = {
            let state = state.clone();
            let id = resumed.id.clone();
            tokio::spawn(async move {
                state
                    .suspend(&[id], SuspendMode::Prompt, Some(Duration::from_secs(5)))
                    .await
            })
        };
        suspend_when_asked(&state, run).await;
        let results = suspending.await.unwrap();
        state.stop_admitting();
        store.request_start(&earlier.id).unwrap();
        let (generation, record) = handoff_record_for(
            &results[0].1,
            OwnerKind::App,
            OwnerKind::App,
            HandoffReason::Restart,
        )
        .unwrap();
        assert!(state
            .hand_off_suspended(&resumed.id, generation, OwnerKind::App, record)
            .await
            .unwrap());
        let claimed = store.claim_next().unwrap().unwrap();
        assert_eq!(claimed.id, resumed.id);
        assert_eq!(
            store.require(&earlier.id).unwrap().status,
            ResearchTaskStatus::Queued
        );
        stop(&state).await;
    }

    #[tokio::test]
    async fn the_helper_finishes_a_cancel_the_app_wrote() {
        let data = DataRoot::new();
        data.project("paper");
        let app = data.state(2);
        let helper = state_as(&data, OwnerKind::Daemon, 2);
        let (runtime, mut starts) = ControlledRuntime::new();
        helper.register_runtime("fixture", runtime.clone()).unwrap();
        let app_store = app.store().unwrap();
        let task = requested(&app_store, keep_running("paper", "Cancel me"));
        assert!(app_store
            .hand_off_queued(
                &task.id,
                OwnerKind::Daemon,
                &HandoffRecord::new(OwnerKind::App, OwnerKind::Daemon, HandoffReason::Quit, 0)
            )
            .unwrap());
        let run = started(&helper, &runtime, &mut starts, &task).await;
        app_store.request_cancel(&task.id).unwrap();
        let handled = helper.apply_foreign_requests(&|_| None).await.unwrap();
        assert_eq!(handled, vec![task.id.clone()]);
        runtime.wait_for_cancel().await;
        run.complete.send(Err("cancelled".into())).unwrap();
        let cancelled = wait_status(&app_store, &task.id, ResearchTaskStatus::Cancelled).await;
        assert_eq!(cancelled.owner, OwnerKind::App);
        stop(&helper).await;
        stop(&app).await;
    }

    #[tokio::test]
    async fn a_reclaim_returns_the_task_to_the_app_at_its_next_step() {
        let data = DataRoot::new();
        data.project("paper");
        let app = data.state(2);
        let helper = state_as(&data, OwnerKind::Daemon, 2);
        let (runtime, mut starts) = ControlledRuntime::new();
        helper.register_runtime("fixture", runtime.clone()).unwrap();
        let app_store = app.store().unwrap();
        let task = requested(&app_store, keep_running("paper", "Come back"));
        app_store
            .hand_off_queued(
                &task.id,
                OwnerKind::Daemon,
                &HandoffRecord::new(OwnerKind::App, OwnerKind::Daemon, HandoffReason::Quit, 0),
            )
            .unwrap();
        let run = started(&helper, &runtime, &mut starts, &task).await;
        let generation = run.context.execution_generation;
        assert_eq!(app_store.request_reclaim().unwrap(), 1);
        assert!(app_store.require(&task.id).unwrap().reclaim_requested);
        assert_eq!(
            helper.apply_foreign_requests(&|_| None).await.unwrap(),
            vec![task.id.clone()]
        );
        suspend_when_asked(&helper, run).await;
        let back = wait_status(&app_store, &task.id, ResearchTaskStatus::Queued).await;
        assert_eq!(back.owner, OwnerKind::App);
        assert!(!back.reclaim_requested);
        let record = app_store.handoff_record(&task.id).unwrap().unwrap();
        assert_eq!(
            (record.reason, record.to),
            (HandoffReason::Reclaim, OwnerKind::App)
        );
        assert_eq!(
            record.conversation,
            Some(format!("{generation}-conversation.json"))
        );
        stop(&helper).await;
        stop(&app).await;
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn the_app_returns_at_once_when_cancelling_a_task_the_helper_runs() {
        let data = DataRoot::new();
        data.project("paper");
        let app = data.state(2);
        let store = app.store().unwrap();
        let task = requested(&store, keep_running("paper", "Elsewhere"));
        let running = store.claim_next().unwrap().unwrap();
        let mut helper = std::process::Command::new("sleep")
            .arg("30")
            .spawn()
            .unwrap();
        let started = match oleafly_sandbox::process::identity::probe(helper.id()) {
            oleafly_sandbox::process::identity::ProcessProbe::Running { started } => started,
            oleafly_sandbox::process::identity::ProcessProbe::Gone => None,
        };
        store
            .set_owner(
                &running.id,
                Some(oleafly_sandbox::process::identity::ProcessIdentity {
                    pid: helper.id(),
                    started,
                }),
            )
            .unwrap();
        let row = tokio::time::timeout(Duration::from_secs(5), app.cancel(task.id.clone()))
            .await
            .expect("the app does not wait for the helper")
            .unwrap();
        assert!(row.cancel_requested && row.status == ResearchTaskStatus::Running);
        let _ = helper.kill();
        let _ = tokio::task::spawn_blocking(move || helper.wait()).await;
        stop(&app).await;
    }

    fn gate_context(task: &ResearchTask, generation: u64) -> GateContext {
        GateContext {
            task_id: task.id.clone(),
            project_id: task.project_id.clone(),
            task_title: task.title.clone(),
            generation,
            policy: CommandPolicy::Ask,
            events: None,
        }
    }

    #[tokio::test]
    async fn a_prompt_suspend_withdraws_a_pending_approval() {
        let data = DataRoot::new();
        data.project("paper");
        let state = data.state(2);
        let (runtime, mut starts) = ControlledRuntime::new();
        state.register_runtime("fixture", runtime.clone()).unwrap();
        let store = state.store().unwrap();
        let task = requested(&store, keep_running("paper", "Asks first"));
        let run = started(&state, &runtime, &mut starts, &task).await;
        let generation = run.context.execution_generation;
        let services = state.services().unwrap();
        let asking = {
            let services = services.clone();
            let context = gate_context(&task, generation);
            let cancel = run.cancel.clone();
            tokio::spawn(async move {
                crate::approvals::gate(
                    &services,
                    &context,
                    ApprovalKind::Command,
                    "Run tests",
                    "pytest",
                    &cancel,
                )
                .await
            })
        };
        wait_until(|| store.require(&task.id).unwrap().pending_approvals == 1).await;
        let suspending = {
            let state = state.clone();
            let id = task.id.clone();
            tokio::spawn(async move {
                state
                    .suspend(&[id], SuspendMode::Prompt, Some(Duration::from_secs(5)))
                    .await
            })
        };
        let answer = asking.await.unwrap();
        assert_eq!(answer, Err(APPROVAL_WITHDRAWN.to_string()));
        assert_eq!(store.require(&task.id).unwrap().pending_approvals, 0);
        services
            .suspends
            .record(&task.id, snapshot_state(generation));
        run.complete.send(Ok(outcome(""))).unwrap();
        assert!(matches!(
            suspending.await.unwrap()[0].1,
            SuspendResult::Suspended { .. }
        ));
        stop(&state).await;
    }

    #[tokio::test]
    async fn a_graceful_suspend_waits_for_the_pending_approval() {
        let data = DataRoot::new();
        data.project("paper");
        let state = data.state(2);
        let (runtime, mut starts) = ControlledRuntime::new();
        state.register_runtime("fixture", runtime.clone()).unwrap();
        let store = state.store().unwrap();
        let task = requested(&store, keep_running("paper", "Asks first"));
        let run = started(&state, &runtime, &mut starts, &task).await;
        let generation = run.context.execution_generation;
        let services = state.services().unwrap();
        let asking = {
            let services = services.clone();
            let context = gate_context(&task, generation);
            let cancel = run.cancel.clone();
            tokio::spawn(async move {
                crate::approvals::gate(
                    &services,
                    &context,
                    ApprovalKind::Command,
                    "Run tests",
                    "pytest",
                    &cancel,
                )
                .await
            })
        };
        wait_until(|| store.require(&task.id).unwrap().pending_approvals == 1).await;
        let suspending = {
            let state = state.clone();
            let id = task.id.clone();
            tokio::spawn(async move { state.suspend(&[id], SuspendMode::Graceful, None).await })
        };
        tokio::time::sleep(Duration::from_millis(300)).await;
        assert!(!suspending.is_finished());
        assert!(!asking.is_finished());
        let pending = services.approvals.pending("paper").unwrap();
        services.approvals.decide(&pending[0].id, true).unwrap();
        assert_eq!(asking.await.unwrap(), Ok(()));
        services
            .suspends
            .record(&task.id, snapshot_state(generation));
        run.complete.send(Ok(outcome(""))).unwrap();
        assert!(matches!(
            suspending.await.unwrap()[0].1,
            SuspendResult::Suspended { .. }
        ));
        stop(&state).await;
    }

    #[tokio::test]
    async fn a_suspend_ends_a_wait_runs_call_without_cancelling_the_run() {
        let data = DataRoot::new();
        data.project("paper");
        let state = data.state(2);
        let (runtime, mut starts) = ControlledRuntime::new();
        state.register_runtime("fixture", runtime.clone()).unwrap();
        let store = state.store().unwrap();
        let task = requested(&store, keep_running("paper", "Waits for a run"));
        let run = started(&state, &runtime, &mut starts, &task).await;
        let generation = run.context.execution_generation;
        store
            .insert_run(&RunRecord {
                task_id: task.id.clone(),
                run_id: "r001".into(),
                execution_generation: generation,
                name: "train".into(),
                executor: "local".into(),
                command: "python train.py".into(),
                cwd_rel: String::new(),
                state: RunState::Running,
                exit_code: None,
                started_at: crate::model::now_ms(),
                finished_at: None,
                run_dir: data
                    .directory
                    .path()
                    .join("run")
                    .to_string_lossy()
                    .into_owned(),
                metrics: Default::default(),
                reported: false,
            })
            .unwrap();
        let services = state.services().unwrap();
        let binding = crate::task_tools::extra::TaskBinding {
            task_id: task.id.clone(),
            project_id: "paper".into(),
            task_title: task.title.clone(),
            generation,
            brief: Default::default(),
            record_dir: run.context.record_dir.clone(),
            execution_root: PathBuf::from(&run.context.execution_root),
            allowed_paths: run.context.allowed_paths.clone(),
            read_paths: Vec::new(),
            linked_roots: Vec::new(),
            search_dirs: Vec::new(),
            project_root: None,
            services: services.clone(),
            host: Arc::new(NullTaskHost),
            events: None,
            cancel: run.cancel.clone(),
        };
        let waiting = tokio::spawn(async move {
            crate::task_tools::extra::call_task_tool(
                "wait_runs",
                serde_json::json!({"timeout": 120}),
                &binding,
            )
            .await
            .unwrap()
        });
        tokio::time::sleep(Duration::from_millis(100)).await;
        services.suspends.signal(&task.id, SuspendMode::Graceful);
        let result = tokio::time::timeout(Duration::from_secs(5), waiting)
            .await
            .expect("the wait ends at once")
            .unwrap()
            .unwrap();
        assert_eq!(result["timedOut"], true);
        assert_eq!(result["stillRunning"][0], "r001");
        assert_eq!(
            services.runs.list(&task.id).unwrap()[0].state,
            RunState::Running
        );
        services
            .suspends
            .record(&task.id, snapshot_state(generation));
        run.complete.send(Ok(outcome(""))).unwrap();
        stop(&state).await;
    }

    #[tokio::test]
    async fn a_finished_task_leaves_no_snapshots_or_agent_homes() {
        let data = DataRoot::new();
        data.project("paper");
        let state = data.state(2);
        let (runtime, mut starts) = ControlledRuntime::new();
        state.register_runtime("fixture", runtime.clone()).unwrap();
        let store = state.store().unwrap();
        let task = requested(&store, keep_running("paper", "Tidy"));
        let run = started(&state, &runtime, &mut starts, &task).await;
        let folder = isolation::task_workspace_root(store.root(), &task.id);
        std::fs::write(folder.join("1-conversation.json"), "{}").unwrap();
        std::fs::create_dir_all(folder.join("acp-home-1/.claude")).unwrap();
        finish_run(&state, run, Ok(outcome("done"))).await;
        wait_status(&store, &task.id, ResearchTaskStatus::AwaitingReview).await;
        wait_until(|| !folder.join("1-conversation.json").exists()).await;
        assert!(!folder.join("acp-home-1").exists());
        stop(&state).await;
    }

    struct NullTaskHost;

    impl crate::builtin::TaskHost for NullTaskHost {
        fn skills(&self, _context: &TaskRunContext) -> Result<String, String> {
            Ok(String::new())
        }

        fn skill_read_paths(&self, _context: &TaskRunContext) -> Vec<PathBuf> {
            Vec::new()
        }

        fn provider(
            &self,
            _context: TaskRunContext,
        ) -> TaskRuntimeFuture<crate::builtin::TaskProvider> {
            Box::pin(async { Err("no provider in this test".to_string()) })
        }

        fn bridge(
            &self,
            _context: TaskRunContext,
            _binding: Option<crate::task_tools::extra::TaskBinding>,
        ) -> TaskRuntimeFuture<Arc<dyn crate::builtin::TaskBridge>> {
            Box::pin(async { Err("no bridge in this test".to_string()) })
        }
    }
}

fn plan_first(project_id: &str, title: &str) -> ResearchTaskDraft {
    ResearchTaskDraft {
        brief: Some(crate::model::ResearchBrief {
            review_plan_first: true,
            ..Default::default()
        }),
        ..draft(project_id, title)
    }
}

fn write_record(run: &StartedRun, name: &str, content: &str) -> PathBuf {
    let path = PathBuf::from(&run.context.execution_root)
        .join(&run.context.record_dir)
        .join(name);
    std::fs::write(&path, content).unwrap();
    path
}

async fn poll_until(mut ready: impl FnMut() -> bool) {
    tokio::time::timeout(CHILD_PATIENCE, async {
        while !ready() {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("the expected state was not reached in time");
}

async fn reach_status(
    store: &TaskStore,
    task_id: &str,
    status: ResearchTaskStatus,
) -> ResearchTask {
    poll_until(|| {
        store
            .require(task_id)
            .is_ok_and(|task| task.status == status)
    })
    .await;
    store.require(task_id).unwrap()
}

fn notifications_of(host: &FakeHost) -> Vec<(NotificationKind, String)> {
    host.notifications()
        .into_iter()
        .map(|notification| (notification.kind, notification.task_id))
        .collect()
}

fn attention_count(host: &FakeHost, project_id: &str) -> Option<u32> {
    host.latest_attention()
        .map(|summary| summary.by_project.get(project_id).copied().unwrap_or(0))
}

#[tokio::test]
async fn a_plan_first_task_stops_at_plan_ready_with_its_workspace() {
    let data = DataRoot::new();
    data.project("paper");
    let state = data.state(1);
    let (runtime, mut starts) = ControlledRuntime::new();
    state.register_runtime("fixture", runtime).unwrap();
    let store = state.store().unwrap();
    let task = requested(&store, plan_first("paper", "Plan the ablation"));
    state.launch_ready().await.unwrap();
    let run = next_run(&mut starts).await;
    assert!(run.context.plan_phase);
    assert!(run.context.resume.is_none());
    assert_eq!(run.context.record_dir, task.record_dir());
    assert_eq!(
        store.require(&task.id).unwrap().phase,
        Some(TaskPhase::Planning)
    );
    let workspace = PathBuf::from(&run.context.execution_root);
    write_record(&run, "plan.md", "- [ ] baseline\n- [ ] dropout sweep\n");

    let ready = finish_run(&state, run, Ok(outcome("Wrote the plan"))).await;
    assert_eq!(ready.status, ResearchTaskStatus::PlanReady);
    assert!(!ready.plan_approved);
    assert_eq!(ready.phase, None);
    assert!(ready.error.is_none());
    assert_eq!(
        ready
            .isolation
            .as_ref()
            .map(|isolation| PathBuf::from(&isolation.execution_root)),
        Some(workspace.clone())
    );
    assert!(workspace.is_dir());
    assert_eq!(
        state.plan(&task.id).unwrap().text,
        "- [ ] baseline\n- [ ] dropout sweep\n"
    );

    let next = requested(&store, draft("paper", "Next in line"));
    state.launch_ready().await.unwrap();
    let following = next_run(&mut starts).await;
    assert_eq!(following.context.task_id, next.id);
    assert_eq!(
        store.require(&task.id).unwrap().status,
        ResearchTaskStatus::PlanReady
    );
    finish_run(&state, following, Ok(outcome("done"))).await;
    stop(&state).await;
}

#[tokio::test]
async fn a_plan_first_task_without_a_plan_fails_with_a_reason() {
    let data = DataRoot::new();
    data.project("paper");
    let state = data.state(1);
    let (runtime, mut starts) = ControlledRuntime::new();
    state.register_runtime("fixture", runtime).unwrap();
    let store = state.store().unwrap();
    let task = requested(&store, plan_first("paper", "Forgets its plan"));
    state.launch_ready().await.unwrap();
    let run = next_run(&mut starts).await;
    assert!(run.context.plan_phase);
    write_record(&run, "plan.md", " \n\n");

    let failed = finish_run(&state, run, Ok(outcome("All done"))).await;
    assert_eq!(failed.status, ResearchTaskStatus::Failed);
    assert_eq!(
        failed.error.as_deref(),
        Some("The agent finished without writing plan.md. Retry the task.")
    );
    assert!(
        failed.isolation.is_some(),
        "the workspace is kept for a retry"
    );
    assert_eq!(
        state.plan(&task.id).unwrap_err(),
        "The plan file is missing. Retry the task."
    );
    stop(&state).await;
}

#[tokio::test]
async fn approving_an_edited_plan_resumes_in_the_same_workspace() {
    let data = DataRoot::new();
    data.project("paper");
    let state = data.state(1);
    let (runtime, mut starts) = ControlledRuntime::new();
    state.register_runtime("fixture", runtime).unwrap();
    let store = state.store().unwrap();
    let task = requested(&store, plan_first("paper", "Plan, then run"));
    state.launch_ready().await.unwrap();
    let planning = next_run(&mut starts).await;
    let root = planning.context.execution_root.clone();
    let planned_generation = planning.context.execution_generation;
    let plan_path = write_record(&planning, "plan.md", "- [ ] original\n");
    finish_run(&state, planning, Ok(outcome("planned"))).await;

    let queued = state
        .approve_plan(task.id.clone(), Some("- [ ] edited".into()))
        .await
        .unwrap();
    assert_eq!(queued.status, ResearchTaskStatus::Queued);
    assert!(queued.start_requested);
    assert_eq!(std::fs::read_to_string(plan_path).unwrap(), "- [ ] edited");

    let working = next_run(&mut starts).await;
    assert_eq!(working.context.task_id, task.id);
    assert_eq!(working.context.execution_root, root);
    assert_eq!(working.context.execution_generation, planned_generation + 1);
    assert!(!working.context.plan_phase);
    let resume = working
        .context
        .resume
        .clone()
        .expect("an approved plan resumes the task");
    assert_eq!(resume.reason, ResumeReason::PlanApproved);
    assert_eq!(resume.plan, "- [ ] edited");
    let running = store.require(&task.id).unwrap();
    assert!(running.plan_approved);
    assert_eq!(running.pending_start, None, "the run read its start mode");
    assert_eq!(running.phase, Some(TaskPhase::Working));

    let finished = finish_run(&state, working, Ok(outcome("carried out"))).await;
    assert_eq!(finished.status, ResearchTaskStatus::AwaitingReview);
    stop(&state).await;
}

#[tokio::test]
async fn approving_a_plan_as_written_keeps_it_and_needs_a_task_that_waits_for_approval() {
    let data = DataRoot::new();
    data.project("paper");
    let state = data.state(1);
    let (runtime, mut starts) = ControlledRuntime::new();
    state.register_runtime("fixture", runtime).unwrap();
    let store = state.store().unwrap();
    let task = requested(&store, plan_first("paper", "Plan as written"));
    let unplanned = store.create(draft("paper", "Never planned")).unwrap();
    state.launch_ready().await.unwrap();
    let planning = next_run(&mut starts).await;
    write_record(&planning, "plan.md", "- [ ] as written\n");
    finish_run(&state, planning, Ok(outcome("planned"))).await;

    assert_eq!(
        state
            .approve_plan(unplanned.id.clone(), None)
            .await
            .unwrap_err(),
        "This task is not waiting for plan approval."
    );
    assert_eq!(
        state.plan(&unplanned.id).unwrap_err(),
        "The plan file is missing. Retry the task."
    );
    assert_eq!(
        state
            .approve_plan(task.id.clone(), Some("x".repeat(64 * 1024 + 1)))
            .await
            .unwrap_err(),
        "A plan can be up to 64 KiB."
    );
    assert_eq!(
        store.require(&task.id).unwrap().status,
        ResearchTaskStatus::PlanReady
    );
    assert_eq!(state.plan(&task.id).unwrap().text, "- [ ] as written\n");

    state
        .approve_plan(task.id.clone(), Some("  \n".into()))
        .await
        .unwrap();
    let working = next_run(&mut starts).await;
    assert_eq!(working.context.task_id, task.id);
    let resume = working
        .context
        .resume
        .clone()
        .expect("an approved plan resumes the task");
    assert_eq!(resume.reason, ResumeReason::PlanApproved);
    assert_eq!(resume.plan, "- [ ] as written\n");
    finish_run(&state, working, Ok(outcome("carried out"))).await;
    stop(&state).await;
}

#[tokio::test]
async fn a_plan_longer_than_the_review_shows_is_flagged_and_needs_an_edit() {
    let data = DataRoot::new();
    data.project("paper");
    let state = data.state(1);
    let (runtime, mut starts) = ControlledRuntime::new();
    state.register_runtime("fixture", runtime).unwrap();
    let store = state.store().unwrap();
    let task = requested(&store, plan_first("paper", "A long plan"));
    state.launch_ready().await.unwrap();
    let planning = next_run(&mut starts).await;
    let long = format!(
        "{}- [ ] the step past the cut\n",
        "- [ ] step\n".repeat(7_000)
    );
    write_record(&planning, "plan.md", &long);
    finish_run(&state, planning, Ok(outcome("planned"))).await;

    let plan = state.plan(&task.id).unwrap();
    assert!(plan.truncated);
    assert_eq!(plan.text.len(), 64 * 1024);
    assert!(!plan.text.contains("past the cut"));
    assert_eq!(
        state.approve_plan(task.id.clone(), None).await.unwrap_err(),
        PLAN_TOO_LONG
    );
    assert_eq!(
        store.require(&task.id).unwrap().status,
        ResearchTaskStatus::PlanReady
    );
    state
        .approve_plan(task.id.clone(), Some("- [ ] shorter\n".into()))
        .await
        .unwrap();
    let working = next_run(&mut starts).await;
    assert_eq!(
        working.context.resume.clone().unwrap().plan,
        "- [ ] shorter\n"
    );
    finish_run(&state, working, Ok(outcome("carried out"))).await;
    stop(&state).await;
}

#[tokio::test]
async fn commands_ask_first_while_a_plan_first_task_plans() {
    let data = DataRoot::new();
    data.project("paper");
    let state = data.state(1);
    let (runtime, mut starts) = ControlledRuntime::new();
    state.register_runtime("fixture", runtime).unwrap();
    let store = state.store().unwrap();
    let task = requested(&store, plan_first("paper", "Plan before running"));
    assert_eq!(task.brief.permissions.commands, CommandPolicy::Allow);
    state.launch_ready().await.unwrap();
    let planning = next_run(&mut starts).await;
    assert!(planning.context.plan_phase);
    assert_eq!(
        planning.context.brief.permissions.commands,
        CommandPolicy::Ask
    );
    write_record(&planning, "plan.md", "- [ ] baseline\n");
    finish_run(&state, planning, Ok(outcome("planned"))).await;

    state.approve_plan(task.id.clone(), None).await.unwrap();
    let working = next_run(&mut starts).await;
    assert!(!working.context.plan_phase);
    assert_eq!(
        working.context.brief.permissions.commands,
        CommandPolicy::Allow
    );
    finish_run(&state, working, Ok(outcome("carried out"))).await;
    stop(&state).await;
}

#[tokio::test]
async fn resume_retry_seeds_the_new_conversation_from_the_handoff() {
    let data = DataRoot::new();
    data.project("paper");
    let state = data.state(1);
    let (runtime, mut starts) = ControlledRuntime::new();
    state.register_runtime("fixture", runtime).unwrap();
    let store = state.store().unwrap();
    let task = requested(&store, draft("paper", "Long study"));
    state.launch_ready().await.unwrap();
    let first = next_run(&mut starts).await;
    (first.events)(TaskRuntimeEvent::SessionBound {
        native_session_id: "native-first".into(),
    });
    write_record(&first, "handoff.md", "next: r003");
    write_record(
        &first,
        "ledger.tsv",
        &format!(
            "{}\nr002\t2026-10-18T10:00:00Z\th\tc\tpython train.py\tloss=0.4\tkeep\t\n",
            record::LEDGER_HEADER
        ),
    );
    let root = first.context.execution_root.clone();
    let failed = finish_run(&state, first, Err("provider disconnected".into())).await;
    assert_eq!(failed.status, ResearchTaskStatus::Failed);

    let queued = state.retry(&task.id, RetryMode::Resume).unwrap();
    assert!(matches!(
        queued.pending_start,
        Some(PendingStart::Resume {
            reason: ResumeReason::Retry,
            ..
        })
    ));
    state.request_start(&task.id).unwrap();
    state.launch_ready().await.unwrap();
    let resumed = next_run(&mut starts).await;
    assert_eq!(resumed.context.execution_root, root);
    assert!(resumed.context.carry_from.is_none());
    let resume = resumed
        .context
        .resume
        .clone()
        .expect("a resumed run starts from the record");
    assert_eq!(resume.reason, ResumeReason::Retry);
    assert!(resume.handoff.contains("next: r003"), "{}", resume.handoff);
    assert!(resume.ledger_tail.starts_with(record::LEDGER_HEADER));
    assert!(
        resume.ledger_tail.contains("r002"),
        "{}",
        resume.ledger_tail
    );
    assert_eq!(
        resume.previous_native_session_id.as_deref(),
        Some("native-first")
    );
    finish_run(&state, resumed, Ok(outcome("continued"))).await;
    stop(&state).await;
}

#[tokio::test]
async fn fresh_retry_carries_the_research_record_over() {
    let data = DataRoot::new();
    data.project("paper");
    let state = data.state(1);
    let (runtime, mut starts) = ControlledRuntime::new();
    state.register_runtime("fixture", runtime).unwrap();
    let store = state.store().unwrap();
    let task = requested(&store, draft("paper", "Sweep"));
    state.launch_ready().await.unwrap();
    let first = next_run(&mut starts).await;
    let ledger = format!(
        "{}\nr001\t2026-10-18T10:00:00Z\th\tc\tpython train.py\tacc=0.9\tkeep\t\n",
        record::LEDGER_HEADER
    );
    write_record(&first, "ledger.tsv", &ledger);
    let old_root = first.context.execution_root.clone();
    finish_run(&state, first, Err("stopped".into())).await;

    let queued = state.retry(&task.id, RetryMode::Fresh).unwrap();
    assert_eq!(
        queued.pending_start,
        Some(PendingStart::Fresh {
            carry_from: Some(old_root.clone())
        })
    );
    state.request_start(&task.id).unwrap();
    state.launch_ready().await.unwrap();
    let fresh = next_run(&mut starts).await;
    assert_ne!(fresh.context.execution_root, old_root);
    assert_eq!(fresh.context.carry_from.as_deref(), Some(old_root.as_str()));
    assert!(fresh.context.resume.is_none());
    let carried = PathBuf::from(&fresh.context.execution_root)
        .join(&fresh.context.record_dir)
        .join("ledger.tsv");
    assert_eq!(std::fs::read_to_string(carried).unwrap(), ledger);

    let reviewed = finish_run(&state, fresh, Ok(outcome("started over"))).await;
    assert_eq!(reviewed.status, ResearchTaskStatus::AwaitingReview);
    let ledger_path = format!("{}/ledger.tsv", task.record_dir());
    let change = reviewed
        .result
        .unwrap()
        .changed_files
        .into_iter()
        .find(|change| change.path == ledger_path)
        .expect("the carried ledger comes back through review");
    assert_eq!(change.kind, crate::model::TaskFileChangeKind::Added);
    stop(&state).await;
}

#[tokio::test]
async fn dependents_receive_the_dependency_summary_and_record() {
    let data = DataRoot::new();
    data.project("paper");
    let state = data.state(1);
    let (runtime, mut starts) = ControlledRuntime::new();
    state.register_runtime("fixture", runtime).unwrap();
    let store = state.store().unwrap();
    let first = requested(&store, draft("paper", "Collect papers"));
    let second = requested(
        &store,
        ResearchTaskDraft {
            dependency_ids: vec![first.id.clone()],
            ..draft("paper", "Write related work")
        },
    );
    state.launch_ready().await.unwrap();
    let collecting = next_run(&mut starts).await;
    assert_eq!(collecting.context.task_id, first.id);
    assert!(collecting.context.dependencies.is_empty());
    let reviewed = finish_run(&state, collecting, Ok(outcome("Found 12 papers"))).await;
    assert_eq!(reviewed.status, ResearchTaskStatus::AwaitingReview);

    state.launch_ready().await.unwrap();
    assert!(starts.try_recv().is_err());
    store
        .begin_apply(&first.id, reviewed.execution_generation, 0, &[])
        .unwrap();
    store
        .complete_apply(
            &first.id,
            &crate::model::TaskReviewResult {
                selected_paths: Vec::new(),
                applied_at: crate::model::now_ms(),
                project_mutation_generation: 0,
            },
        )
        .unwrap();
    state.launch_ready().await.unwrap();
    let writing = next_run(&mut starts).await;
    assert_eq!(writing.context.task_id, second.id);
    assert_eq!(
        writing.context.dependencies,
        vec![crate::model::DependencyResult {
            task_id: first.id.clone(),
            title: "Collect papers".into(),
            summary: "Found 12 papers".into(),
            record_dir: first.record_dir(),
        }]
    );
    finish_run(&state, writing, Ok(outcome("Wrote the section"))).await;
    stop(&state).await;
}

#[tokio::test]
async fn a_resume_without_its_workspace_fails_clearly() {
    let data = DataRoot::new();
    data.project("paper");
    let state = data.state(1);
    let (runtime, mut starts) = ControlledRuntime::new();
    state.register_runtime("fixture", runtime).unwrap();
    let store = state.store().unwrap();
    let task = requested(&store, draft("paper", "Lost its workspace"));
    state.launch_ready().await.unwrap();
    let first = next_run(&mut starts).await;
    let root = PathBuf::from(&first.context.execution_root);
    let generation = first.context.execution_generation;
    finish_run(&state, first, Err("provider disconnected".into())).await;
    std::fs::remove_dir_all(root).unwrap();

    state.retry(&task.id, RetryMode::Resume).unwrap();
    state.request_start(&task.id).unwrap();
    state.launch_ready().await.unwrap();
    poll_until(|| {
        store.require(&task.id).is_ok_and(|current| {
            current.execution_generation == generation + 1
                && current.status == ResearchTaskStatus::Failed
        })
    })
    .await;
    let failed = store.require(&task.id).unwrap();
    assert_eq!(
        failed.error.as_deref(),
        Some("The saved workspace is gone. Start over instead.")
    );
    assert!(
        starts.try_recv().is_err(),
        "the agent never starts without its workspace"
    );
    stop(&state).await;
}

#[tokio::test]
async fn a_cost_stop_cancels_without_a_wrap_up() {
    let data = DataRoot::new();
    data.project("paper");
    data.host.set_spend(Some(2.5));
    let state = data.state(1);
    let (runtime, mut starts) = ControlledRuntime::new();
    state.register_runtime("fixture", runtime.clone()).unwrap();
    let store = state.store().unwrap();
    let mut brief = crate::model::ResearchBrief::default();
    brief.budget.usd_cap = Some(2.0);
    let task = requested(
        &store,
        ResearchTaskDraft {
            brief: Some(brief),
            ..draft("paper", "Expensive")
        },
    );
    state.launch_ready().await.unwrap();
    let run = next_run(&mut starts).await;

    tokio::time::timeout(Duration::from_secs(5), run.cancel.cancelled())
        .await
        .expect("the cost cap did not stop the run");
    assert!(
        !active_run(&state, &task.id).cancel.is_cancelled(),
        "a budget stop is not a user cancel"
    );
    let stopped = finish_run(&state, run, Err("The task was cancelled.".into())).await;
    assert_eq!(stopped.status, ResearchTaskStatus::AwaitingReview);
    assert_eq!(stopped.stop_reason, Some(StopReason::BudgetCost));
    assert!(stopped.error.is_none());
    assert_eq!(
        stopped.result.map(|result| result.summary),
        Some(String::new())
    );
    assert!(starts.try_recv().is_err(), "the agent got no wrap-up turn");
    assert!(lock(&runtime.cancellations).is_empty());
    poll_until(|| {
        notifications_of(&data.host).contains(&(NotificationKind::BudgetReached, task.id.clone()))
    })
    .await;
    stop(&state).await;
}

#[tokio::test]
async fn a_spent_time_budget_leaves_the_agent_its_grace_period_to_wrap_up() {
    let data = DataRoot::new();
    data.project("paper");
    let state = data.state(1);
    let (runtime, mut starts) = ControlledRuntime::new();
    state.register_runtime("fixture", runtime).unwrap();
    let store = state.store().unwrap();
    let task = requested(&store, draft("paper", "Out of time"));
    let earlier = store.claim_next().unwrap().unwrap();
    let (preparation_store, preparation_host, preparation_task) =
        (store.clone(), data.host.clone(), earlier.clone());
    let isolation = tokio::task::spawn_blocking(move || {
        isolation::prepare(
            &preparation_store,
            &preparation_host,
            &preparation_task,
            &CancellationToken::new(),
        )
    })
    .await
    .unwrap()
    .unwrap();
    assert!(store
        .set_isolation(&task.id, earlier.execution_generation, &isolation)
        .unwrap());
    let budget_ms = u64::from(crate::model::DEFAULT_TIME_BUDGET_MINUTES) * 60_000;
    assert!(store
        .set_active_ms(&task.id, earlier.execution_generation, budget_ms)
        .unwrap());
    assert!(store
        .finish_failure(&task.id, earlier.execution_generation, "stopped")
        .unwrap());
    state.retry(&task.id, RetryMode::Resume).unwrap();
    state.request_start(&task.id).unwrap();
    state.launch_ready().await.unwrap();
    let run = next_run(&mut starts).await;
    assert_eq!(run.context.execution_root, isolation.execution_root);

    // The budget watcher checks every 20 ms in tests, and each check writes
    // the active time before it looks at the budget. A second write means the
    // first check has noticed the spent budget (a fixed 300 ms wait was too
    // short for a loaded Windows runner). The agent keeps its turn.
    let mut written = budget_ms;
    for _ in 0..2 {
        let before = written;
        poll_until(|| {
            written = store.require(&task.id).unwrap().active_ms;
            written > before
        })
        .await;
    }
    assert!(!run.cancel.is_cancelled());
    let wrapped = finish_run(&state, run, Ok(outcome("Wrote the handoff and the report"))).await;
    assert_eq!(wrapped.status, ResearchTaskStatus::AwaitingReview);
    assert_eq!(wrapped.stop_reason, Some(StopReason::BudgetTime));
    assert!(wrapped.active_ms >= budget_ms);
    assert_eq!(
        wrapped.result.unwrap().summary,
        "Wrote the handoff and the report"
    );
    poll_until(|| {
        notifications_of(&data.host).contains(&(NotificationKind::BudgetReached, task.id.clone()))
    })
    .await;
    stop(&state).await;
}

#[tokio::test]
async fn scheduled_tasks_start_on_time() {
    let data = DataRoot::new();
    data.project("paper");
    let state = data.state(1);
    let (runtime, mut starts) = ControlledRuntime::new();
    state.register_runtime("fixture", runtime).unwrap();
    let store = state.store().unwrap();
    // Far enough ahead that a loaded CI runner checks the queue before the
    // task is due (Windows took over half a second for launch_ready).
    let at = crate::model::now_ms() + 3_000;
    let task = requested(
        &store,
        ResearchTaskDraft {
            run_after: Some(at),
            ..draft("paper", "Tonight")
        },
    );
    state.launch_ready().await.unwrap();
    assert!(starts.try_recv().is_err());
    assert_eq!(
        store.require(&task.id).unwrap().status,
        ResearchTaskStatus::Queued
    );

    let run = next_run(&mut starts).await;
    assert_eq!(run.context.task_id, task.id);
    let started = store.require(&task.id).unwrap().started_at.unwrap();
    assert!(started >= at, "started at {started}, scheduled for {at}");
    finish_run(&state, run, Ok(outcome("ran on time"))).await;
    stop(&state).await;
}

#[tokio::test]
async fn with_research_tasks_off_queued_and_scheduled_work_waits_until_they_are_on() {
    let data = DataRoot::new();
    data.project("paper");
    let state = data.state(1);
    let (runtime, mut starts) = ControlledRuntime::new();
    state.register_runtime("fixture", runtime).unwrap();
    let store = state.store().unwrap();
    state.set_enabled(false);
    assert!(!state.enabled());
    let queued = requested(&store, draft("paper", "Now"));
    let due = requested(
        &store,
        ResearchTaskDraft {
            run_after: Some(crate::model::now_ms() + 50),
            ..draft("paper", "Soon")
        },
    );
    state.launch_ready().await.unwrap();
    tokio::time::sleep(Duration::from_millis(300)).await;
    assert!(
        starts.try_recv().is_err(),
        "nothing starts while tasks are off"
    );
    for id in [&queued.id, &due.id] {
        assert_eq!(
            store.require(id).unwrap().status,
            ResearchTaskStatus::Queued
        );
    }
    assert!(state.active_task_ids().is_empty());

    state.set_enabled(true);
    state.launch_ready().await.unwrap();
    let run = next_run(&mut starts).await;
    assert_eq!(state.active_task_ids(), vec![run.context.task_id.clone()]);
    finish_run(&state, run, Ok(outcome("ran once allowed"))).await;
    let run = next_run(&mut starts).await;
    finish_run(&state, run, Ok(outcome("ran once allowed"))).await;
    stop(&state).await;
}

#[tokio::test]
async fn a_brief_whose_compute_target_was_removed_is_refused() {
    let data = DataRoot::new();
    data.project("paper");
    let state = data.state(1);
    let mut brief = crate::model::ResearchBrief::default();
    brief.compute.executor = "slurm".into();
    let on = |target: Option<&str>| {
        let mut brief = brief.clone();
        brief.compute.target = target.map(str::to_owned);
        ResearchTaskDraft {
            brief: Some(brief),
            ..draft("paper", "On the cluster")
        }
    };
    assert_eq!(
        state.create(on(Some("cluster"))).unwrap_err(),
        "The compute target in this brief was removed. Choose another one."
    );
    assert_eq!(
        state.create(on(None)).unwrap_err(),
        "Choose a compute target for this task's runs."
    );
    let settings = data.directory.path().join("research/compute.json");
    std::fs::create_dir_all(settings.parent().unwrap()).unwrap();
    std::fs::write(
        &settings,
        r#"{"version":1,"targets":[{"kind":"slurm","id":"cluster","label":"Cluster","host":"login"}]}"#,
    )
    .unwrap();
    let task = state.create(on(Some("cluster"))).unwrap();
    std::fs::write(&settings, r#"{"version":1,"targets":[]}"#).unwrap();
    let edit = ResearchTaskEdit {
        title: task.title.clone(),
        prompt: task.prompt.clone(),
        runtime_id: task.runtime_id.clone(),
        agent_id: task.agent_id.clone(),
        model_id: task.model_id.clone(),
        brief: Some(task.brief.clone()),
        ..Default::default()
    };
    assert_eq!(
        state.edit(&task.id, edit).unwrap_err(),
        "The compute target in this brief was removed. Choose another one."
    );
    stop(&state).await;
}

#[tokio::test]
async fn cancelling_or_retrying_a_queued_task_removes_copied_sign_in_files() {
    let data = DataRoot::new();
    data.project("paper");
    let state = data.state(1);
    let store = state.store().unwrap();
    let task = store.create(draft("paper", "Handed over at quit")).unwrap();
    let copied = |generation| {
        let home = crate::handoff::acp_home_path(store.root(), &task.id, generation);
        std::fs::create_dir_all(home.join(".claude")).unwrap();
        std::fs::write(home.join(".claude/.credentials.json"), "token").unwrap();
        home
    };
    let home = copied(1);
    let cancelled = state.cancel(task.id.clone()).await.unwrap();
    assert_eq!(cancelled.status, ResearchTaskStatus::Cancelled);
    assert!(!home.exists());

    let home = copied(2);
    state.retry(&task.id, RetryMode::Fresh).unwrap();
    assert!(!home.exists());
    stop(&state).await;
}

#[tokio::test]
async fn held_launches_start_nothing_until_released() {
    let data = DataRoot::new();
    data.project("paper");
    let state = data.state(1);
    let (runtime, mut starts) = ControlledRuntime::new();
    state.register_runtime("fixture", runtime).unwrap();
    let store = state.store().unwrap();
    state.hold_launches();
    let task = requested(&store, draft("paper", "Waits for recovery"));
    state.launch_ready().await.unwrap();
    assert!(starts.try_recv().is_err());
    assert_eq!(
        store.require(&task.id).unwrap().status,
        ResearchTaskStatus::Queued
    );
    state.release_launches();
    state.launch_ready().await.unwrap();
    let run = next_run(&mut starts).await;
    assert_eq!(run.context.task_id, task.id);
    finish_run(&state, run, Ok(outcome("done"))).await;
    stop(&state).await;
}

#[test]
fn the_wake_timer_reads_the_wall_clock_again_at_least_every_minute() {
    let now = 1_000_000_000;
    assert_eq!(
        wake_step(now + 15 * 60 * 60 * 1000, now),
        (WAKE_CHECK_EVERY, false)
    );
    assert_eq!(
        wake_step(now + 10_000, now),
        (Duration::from_millis(10_050), true)
    );
    assert_eq!(
        wake_step(now - 5_000, now),
        (Duration::from_millis(50), true)
    );
}

#[tokio::test]
async fn a_new_wake_timer_stops_the_one_it_replaces() {
    let data = DataRoot::new();
    data.project("paper");
    let state = data.state(1);
    let (runtime, _starts) = ControlledRuntime::new();
    state.register_runtime("fixture", runtime).unwrap();
    let store = state.store().unwrap();
    requested(
        &store,
        ResearchTaskDraft {
            run_after: Some(crate::model::now_ms() + 2 * 24 * 60 * 60 * 1000),
            ..draft("paper", "In two days")
        },
    );
    state.launch_ready().await.unwrap();
    let first = lock(&state.inner.wake_timer)
        .as_ref()
        .expect("a timer waits for the scheduled start")
        .abort_handle();
    state.launch_ready().await.unwrap();
    poll_until(|| first.is_finished()).await;
    assert!(!lock(&state.inner.wake_timer)
        .as_ref()
        .unwrap()
        .is_finished());
    stop(&state).await;
}

#[tokio::test]
async fn review_plan_and_failure_raise_notifications_and_attention() {
    let data = DataRoot::new();
    data.project("paper");
    let state = data.state(1);
    let (runtime, mut starts) = ControlledRuntime::new();
    state.register_runtime("fixture", runtime).unwrap();
    let store = state.store().unwrap();

    let review = requested(&store, draft("paper", "Ready for review"));
    state.launch_ready().await.unwrap();
    let run = next_run(&mut starts).await;
    finish_run(&state, run, Ok(outcome("reviewable"))).await;
    poll_until(|| attention_count(&data.host, "paper") == Some(1)).await;

    let plan = requested(&store, plan_first("paper", "Plan for approval"));
    state.launch_ready().await.unwrap();
    let run = next_run(&mut starts).await;
    write_record(&run, "plan.md", "- [ ] one step\n");
    finish_run(&state, run, Ok(outcome("planned"))).await;
    poll_until(|| attention_count(&data.host, "paper") == Some(2)).await;

    let failing = requested(&store, draft("paper", "Breaks"));
    state.launch_ready().await.unwrap();
    let run = next_run(&mut starts).await;
    finish_run(&state, run, Err("provider disconnected".into())).await;

    poll_until(|| data.host.notifications().len() == 3).await;
    assert_eq!(
        notifications_of(&data.host),
        vec![
            (NotificationKind::ReviewReady, review.id.clone()),
            (NotificationKind::PlanReady, plan.id.clone()),
            (NotificationKind::Failed, failing.id.clone()),
        ]
    );
    let notifications = data.host.notifications();
    assert_eq!(notifications[0].project_id, "paper");
    assert_eq!(notifications[0].task_title, "Ready for review");
    assert_eq!(store.attention().unwrap().by_project.get("paper"), Some(&2));
    poll_until(|| attention_count(&data.host, "paper") == Some(2)).await;
    stop(&state).await;
}

struct WarningWorkspace;

impl WorkspaceTools for WarningWorkspace {
    fn compile(
        &self,
        _root: PathBuf,
        _source: Option<PathBuf>,
    ) -> TaskRuntimeFuture<crate::host::CompileSummary> {
        Box::pin(async {
            Ok(crate::host::CompileSummary {
                ok: false,
                errors: 2,
                warnings: 1,
                log_tail: "! Undefined control sequence.".into(),
                skipped: None,
            })
        })
    }

    fn project_map(&self, root: PathBuf) -> TaskRuntimeFuture<serde_json::Value> {
        let baseline = root.to_string_lossy().ends_with("-baseline");
        Box::pin(async move {
            Ok(if baseline {
                serde_json::json!({"unresolvedRefs": []})
            } else {
                serde_json::json!({"unresolvedRefs": ["fig:missing"]})
            })
        })
    }
}

fn evidence_check(
    report: &crate::model::EvidenceReport,
    id: crate::model::EvidenceCheckId,
) -> &crate::model::EvidenceCheck {
    report
        .checks
        .iter()
        .find(|check| check.id == id)
        .unwrap_or_else(|| panic!("the report has no {id:?} check"))
}

#[tokio::test]
async fn evidence_never_blocks_review() {
    use crate::model::{EvidenceCheckId, EvidenceStatus};

    let mut data = DataRoot::new();
    data.host.workspace = Some(Arc::new(WarningWorkspace));
    data.project("paper");
    let state = data.state(1);
    let (runtime, mut starts) = ControlledRuntime::new();
    state.register_runtime("fixture", runtime).unwrap();
    let store = state.store().unwrap();
    let task = requested(&store, draft("paper", "Write the results"));
    state.launch_ready().await.unwrap();
    let run = next_run(&mut starts).await;
    let root = PathBuf::from(&run.context.execution_root);
    std::fs::write(
        root.join("main.tex"),
        "original manuscript\nAccuracy 0.91 % run: r009\n",
    )
    .unwrap();
    std::fs::create_dir_all(root.join("figures")).unwrap();
    std::fs::write(
        root.join("figures").join("new.png"),
        [0x89, b'P', b'N', b'G'],
    )
    .unwrap();
    let reviewed = finish_run(&state, run, Ok(outcome("Wrote the results"))).await;
    assert_eq!(reviewed.status, ResearchTaskStatus::AwaitingReview);

    poll_until(|| {
        store
            .require(&task.id)
            .is_ok_and(|current| current.evidence.is_some() && current.phase.is_none())
    })
    .await;
    let checked = store.require(&task.id).unwrap();
    assert_eq!(checked.status, ResearchTaskStatus::AwaitingReview);
    assert!(checked.error.is_none());
    let report = checked.evidence.unwrap();
    assert_eq!(
        report
            .checks
            .iter()
            .map(|check| (check.id, check.status))
            .collect::<Vec<_>>(),
        vec![
            (EvidenceCheckId::Build, EvidenceStatus::Warn),
            (EvidenceCheckId::References, EvidenceStatus::Warn),
            (EvidenceCheckId::Bibliography, EvidenceStatus::Pass),
            (EvidenceCheckId::Numbers, EvidenceStatus::Warn),
            (EvidenceCheckId::Figures, EvidenceStatus::Warn),
        ]
    );
    let build = &evidence_check(&report, EvidenceCheckId::Build).items[0];
    assert_eq!(build.code, "build.failed");
    assert_eq!(build.params["errors"], "2");
    let reference = &evidence_check(&report, EvidenceCheckId::References).items[0];
    assert_eq!(reference.code, "references.unresolved");
    assert_eq!(reference.params["key"], "fig:missing");
    let number = &evidence_check(&report, EvidenceCheckId::Numbers).items[0];
    assert_eq!(number.code, "numbers.unknownRun");
    assert_eq!(number.params["run"], "r009");
    assert_eq!(number.file.as_deref(), Some("main.tex"));
    assert_eq!(number.line, Some(2));
    let figure = &evidence_check(&report, EvidenceCheckId::Figures).items[0];
    assert_eq!(figure.code, "figures.unused");
    assert_eq!(figure.params["path"], "figures/new.png");
    poll_until(|| {
        notifications_of(&data.host).contains(&(NotificationKind::ReviewReady, task.id.clone()))
    })
    .await;
    stop(&state).await;
}

#[tokio::test]
async fn a_new_fresh_generation_purges_old_workspaces_without_live_runs() {
    let data = DataRoot::new();
    data.project("paper");
    let state = data.state(1);
    let (runtime, mut starts) = ControlledRuntime::new();
    state.register_runtime("fixture", runtime).unwrap();
    let store = state.store().unwrap();
    let task = requested(&store, draft("paper", "Three attempts"));
    state.launch_ready().await.unwrap();
    let first = next_run(&mut starts).await;
    let first_root = PathBuf::from(&first.context.execution_root);
    let first_baseline = PathBuf::from(
        store
            .require(&task.id)
            .unwrap()
            .isolation
            .unwrap()
            .baseline_root,
    );
    let first_generation = first.context.execution_generation;
    finish_run(&state, first, Err("stopped".into())).await;
    store
        .insert_run(&crate::model::RunRecord {
            task_id: task.id.clone(),
            run_id: "r001".into(),
            execution_generation: first_generation,
            name: "train".into(),
            executor: "local".into(),
            command: "python train.py".into(),
            cwd_rel: String::new(),
            state: crate::model::RunState::Running,
            exit_code: None,
            started_at: crate::model::now_ms(),
            finished_at: None,
            run_dir: data
                .directory
                .path()
                .join("run-r001")
                .to_string_lossy()
                .into_owned(),
            metrics: Default::default(),
            reported: false,
        })
        .unwrap();

    state.retry(&task.id, RetryMode::Fresh).unwrap();
    state.request_start(&task.id).unwrap();
    state.launch_ready().await.unwrap();
    let second = next_run(&mut starts).await;
    let second_root = PathBuf::from(&second.context.execution_root);
    assert_ne!(second_root, first_root);
    tokio::time::sleep(Duration::from_millis(300)).await;
    assert!(
        first_root.is_dir(),
        "a workspace a live run may use is kept"
    );
    assert!(first_baseline.is_dir());

    assert!(store
        .finish_run(
            &task.id,
            "r001",
            crate::model::RunState::Succeeded,
            Some(0),
            crate::model::now_ms(),
            &Default::default(),
        )
        .unwrap());
    write_record(&second, "notes.md", "from the second attempt");
    finish_run(&state, second, Err("stopped again".into())).await;
    state.retry(&task.id, RetryMode::Fresh).unwrap();
    state.request_start(&task.id).unwrap();
    state.launch_ready().await.unwrap();
    let third = next_run(&mut starts).await;
    let third_root = PathBuf::from(&third.context.execution_root);
    poll_until(|| !first_root.exists() && !first_baseline.exists() && !second_root.exists()).await;
    assert!(third_root.is_dir());
    assert_eq!(
        std::fs::read_to_string(third_root.join(&third.context.record_dir).join("notes.md"))
            .unwrap(),
        "from the second attempt",
        "the record came along before the old copy went"
    );
    finish_run(&state, third, Ok(outcome("third time"))).await;
    stop(&state).await;
}

#[tokio::test]
async fn reading_events_flushes_pending_text_first() {
    let data = DataRoot::new();
    data.project("paper");
    let state = data.state(1);
    let (runtime, mut starts) = ControlledRuntime::new();
    state.register_runtime("fixture", runtime).unwrap();
    let store = state.store().unwrap();
    let task = requested(&store, draft("paper", "Streams"));
    state.launch_ready().await.unwrap();
    let run = next_run(&mut starts).await;
    let parts: Vec<String> = (0..10).map(|index| format!("part {index}. ")).collect();
    for part in &parts {
        (run.events)(TaskRuntimeEvent::Text { text: part.clone() });
    }
    let page = state
        .events(&task.id, run.context.execution_generation, None, 100)
        .unwrap();
    assert_eq!(
        page.events
            .iter()
            .map(|row| row.event.clone())
            .collect::<Vec<_>>(),
        vec![TaskRuntimeEvent::Text {
            text: parts.concat()
        }]
    );
    finish_run(&state, run, Ok(outcome("streamed"))).await;
    stop(&state).await;
}

#[tokio::test]
async fn streamed_text_reaches_the_host_as_a_row_and_then_appends() {
    let data = DataRoot::new();
    data.project("paper");
    let state = data.state(1);
    let (runtime, mut starts) = ControlledRuntime::new();
    state.register_runtime("fixture", runtime).unwrap();
    let store = state.store().unwrap();
    let task = requested(&store, draft("paper", "Streams to a window"));
    state.launch_ready().await.unwrap();
    let run = next_run(&mut starts).await;
    let generation = run.context.execution_generation;
    for part in ["Reading ", "the ", "sources."] {
        (run.events)(TaskRuntimeEvent::Text { text: part.into() });
    }
    (run.events)(TaskRuntimeEvent::Status {
        message: "Checked".into(),
    });

    let rows: Vec<(u64, TaskRuntimeEvent)> = lock(&data.host.appended)
        .iter()
        .filter(|row| row.task_id == task.id)
        .map(|row| (row.sequence, row.event.clone()))
        .collect();
    assert_eq!(
        rows,
        vec![
            (
                1,
                TaskRuntimeEvent::Text {
                    text: "Reading ".into()
                }
            ),
            (
                2,
                TaskRuntimeEvent::Status {
                    message: "Checked".into()
                }
            ),
        ]
    );
    let deltas = lock(&data.host.deltas).clone();
    assert_eq!(deltas.len(), 1, "{deltas:?}");
    assert_eq!(
        (
            deltas[0].task_id.as_str(),
            deltas[0].execution_generation,
            deltas[0].sequence,
            deltas[0].kind.as_str(),
            deltas[0].append.as_str()
        ),
        (task.id.as_str(), generation, 1, "text", "the sources.")
    );
    let stored = state
        .events(&task.id, generation, None, 100)
        .unwrap()
        .events;
    assert_eq!(
        stored.into_iter().map(|row| row.event).collect::<Vec<_>>(),
        vec![
            TaskRuntimeEvent::Text {
                text: "Reading the sources.".into()
            },
            TaskRuntimeEvent::Status {
                message: "Checked".into()
            },
        ]
    );
    tokio::time::sleep(Duration::from_millis(100)).await;
    assert_eq!(lock(&data.host.deltas).len(), 1);
    finish_run(&state, run, Ok(outcome("streamed"))).await;
    stop(&state).await;
}

#[derive(Default)]
struct HeldExecutor {
    cancelled: Mutex<Vec<(String, String)>>,
}

impl HeldExecutor {
    fn cancelled(&self) -> Vec<(String, String)> {
        lock(&self.cancelled).clone()
    }
}

#[async_trait::async_trait]
impl crate::runs::RunExecutor for HeldExecutor {
    fn id(&self) -> &'static str {
        "held"
    }

    async fn start(
        &self,
        _spec: &crate::runs::RunSpec,
    ) -> Result<crate::runs::RunHandle, crate::runs::RunError> {
        Err(crate::runs::RunError::Unavailable(
            "These runs are recorded by the test.".into(),
        ))
    }

    async fn poll(
        &self,
        handle: &crate::runs::RunHandle,
    ) -> Result<crate::runs::RunStatus, crate::runs::RunError> {
        let key = (handle.task_id.clone(), handle.run_id.clone());
        let cancelled = lock(&self.cancelled).contains(&key);
        Ok(if cancelled {
            crate::runs::RunStatus::Finished {
                exit_code: None,
                finished_at: crate::model::now_ms(),
                outcome: crate::runs::RunOutcomeKind::Cancelled,
                note: None,
            }
        } else {
            crate::runs::RunStatus::Running {
                started_at: handle.started_at,
                note: None,
            }
        })
    }

    async fn read_log(
        &self,
        _handle: &crate::runs::RunHandle,
        _query: crate::runs::LogQuery,
    ) -> Result<String, crate::runs::RunError> {
        Ok(String::new())
    }

    async fn cancel(&self, handle: &crate::runs::RunHandle) -> Result<(), crate::runs::RunError> {
        lock(&self.cancelled).push((handle.task_id.clone(), handle.run_id.clone()));
        Ok(())
    }
}

fn held_run(store: &TaskStore, task_id: &str, generation: u64, run_dir: &Path) {
    store
        .insert_run(&crate::model::RunRecord {
            task_id: task_id.into(),
            run_id: "r001".into(),
            execution_generation: generation,
            name: "train".into(),
            executor: "held".into(),
            command: "python train.py".into(),
            cwd_rel: String::new(),
            state: crate::model::RunState::Running,
            exit_code: None,
            started_at: crate::model::now_ms(),
            finished_at: None,
            run_dir: run_dir.to_string_lossy().into_owned(),
            metrics: Default::default(),
            reported: false,
        })
        .unwrap();
    let handle = crate::runs::RunHandle {
        version: crate::runs::HANDLE_VERSION,
        executor: "held".into(),
        task_id: task_id.into(),
        run_id: "r001".into(),
        run_dir: run_dir.to_path_buf(),
        started_at: crate::model::now_ms(),
        data: serde_json::Value::Null,
    };
    store
        .set_run_handle(task_id, "r001", &serde_json::to_string(&handle).unwrap())
        .unwrap();
}

#[tokio::test]
async fn a_finished_generation_stops_its_runs_and_a_quit_leaves_them_going() {
    let data = DataRoot::new();
    data.project("paper");
    let state = data.state(2);
    let executor = Arc::new(HeldExecutor::default());
    state
        .services()
        .unwrap()
        .runs
        .register_executor(executor.clone());
    let (runtime, mut starts) = ControlledRuntime::new();
    state.register_runtime("fixture", runtime.clone()).unwrap();
    let store = state.store().unwrap();

    let finishing = requested(&store, draft("paper", "Finishes"));
    state.launch_ready().await.unwrap();
    let run = next_run(&mut starts).await;
    held_run(
        &store,
        &finishing.id,
        run.context.execution_generation,
        &data.directory.path().join("finishing-run"),
    );
    finish_run(&state, run, Ok(outcome("done"))).await;
    poll_until(|| {
        store
            .run(&finishing.id, "r001")
            .is_ok_and(|run| run.state == crate::model::RunState::Cancelled)
    })
    .await;
    assert_eq!(
        executor.cancelled(),
        vec![(finishing.id.clone(), "r001".to_owned())]
    );

    let quitting = requested(&store, draft("paper", "Interrupted by a quit"));
    state.launch_ready().await.unwrap();
    let run = next_run(&mut starts).await;
    held_run(
        &store,
        &quitting.id,
        run.context.execution_generation,
        &data.directory.path().join("quitting-run"),
    );
    let quit = {
        let state = state.clone();
        tokio::spawn(async move { state.shutdown().await })
    };
    runtime.wait_for_cancel().await;
    run.complete
        .send(Err("stopped for the quit".into()))
        .unwrap();
    tokio::time::timeout(Duration::from_secs(5), quit)
        .await
        .expect("the quit did not finish")
        .unwrap();
    assert_eq!(
        store.run(&quitting.id, "r001").unwrap().state,
        crate::model::RunState::Running
    );
    assert_eq!(executor.cancelled().len(), 1, "a quit leaves runs going");
}

#[tokio::test]
async fn a_late_generation_end_leaves_the_new_generation_its_clock_and_runs() {
    let data = DataRoot::new();
    data.project("paper");
    let state = data.state(2);
    let executor = Arc::new(HeldExecutor::default());
    let services = state.services().unwrap();
    services.runs.register_executor(executor.clone());
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
    store.retry_with(&task.id, RetryMode::Fresh).unwrap();
    store.request_start(&task.id).unwrap();
    state.launch_ready().await.unwrap();
    let current = next_run(&mut starts).await;
    held_run(
        &store,
        &task.id,
        current.context.execution_generation,
        &data.directory.path().join("current-run"),
    );

    old.complete.send(Ok(outcome("stale result"))).unwrap();
    wait_settled(&old_active).await;
    poll_until(|| state.inner.concurrency.available_permits() == 1).await;

    assert!(
        services.clocks.get(&task.id).is_some(),
        "the running generation keeps its budget clock"
    );
    assert!(
        executor.cancelled().is_empty(),
        "the running generation's runs go on"
    );
    assert_eq!(
        store.run(&task.id, "r001").unwrap().state,
        crate::model::RunState::Running
    );
    finish_run(&state, current, Ok(outcome("current result"))).await;
    stop(&state).await;
}

mod approvals {
    use serde_json::{json, Value};

    use super::*;
    use crate::approvals::{gate, GateContext};
    use crate::builtin::{BuiltinTaskAdapter, TaskBridge, TaskHost, TaskProvider, UsageSink};
    use crate::model::{ApprovalKind, CommandPolicy};
    use crate::store::approvals::NO_LONGER_WAITING;
    use crate::task_tools::extra::TaskBinding;

    struct ScriptedProvider {
        url: String,
        requests: Arc<Mutex<Vec<Value>>>,
        server: tokio::task::JoinHandle<()>,
    }

    impl ScriptedProvider {
        async fn start(command: &'static str) -> Self {
            use axum::{response::IntoResponse, routing::post, Json, Router};
            let requests = Arc::new(Mutex::new(Vec::<Value>::new()));
            let observed = requests.clone();
            let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
            let address = listener.local_addr().unwrap();
            let router = Router::new().route(
                "/v1/chat/completions",
                post(move |Json(request): Json<Value>| {
                    let step = {
                        let mut requests = lock(&observed);
                        requests.push(request);
                        requests.len() - 1
                    };
                    async move {
                        let (delta, finish) = if step == 0 {
                            (
                                json!({"tool_calls": [{"index": 0, "id": "call-1", "type": "function",
                                    "function": {"name": "run_command",
                                                 "arguments": json!({"command": command}).to_string()}}]}),
                                "tool_calls",
                            )
                        } else {
                            (json!({"content": "done"}), "stop")
                        };
                        let body = format!(
                            "data: {}\n\ndata: {}\n\ndata: [DONE]\n\n",
                            json!({"choices": [{"delta": delta}]}),
                            json!({"choices": [{"delta": {}, "finish_reason": finish}],
                                   "usage": {"prompt_tokens": 10, "completion_tokens": 2}}),
                        );
                        ([("content-type", "text/event-stream")], body).into_response()
                    }
                }),
            );
            let server = tokio::spawn(async move {
                let _ = axum::serve(listener, router).await;
            });
            Self {
                url: format!("http://{address}/v1"),
                requests,
                server,
            }
        }

        fn count(&self) -> usize {
            lock(&self.requests).len()
        }

        fn request(&self, index: usize) -> Value {
            lock(&self.requests)[index].clone()
        }
    }

    impl Drop for ScriptedProvider {
        fn drop(&mut self) {
            self.server.abort();
        }
    }

    struct NoUsage;

    impl UsageSink for NoUsage {
        fn observe(&self, _event: &oleafly_agent::AgentEvent) {}
        fn finish(&self, _status: &str) {}
    }

    struct NoBridge;

    impl TaskBridge for NoBridge {
        fn mcp_server(&self) -> Value {
            json!({"type": "http", "name": "none", "url": "http://127.0.0.1:9/mcp", "headers": []})
        }

        fn call_tool(self: Arc<Self>, _name: String, _args: Value) -> TaskRuntimeFuture<Value> {
            Box::pin(async { Err("This test has no bridge tools.".to_string()) })
        }

        fn shutdown(self: Arc<Self>) -> Pin<Box<dyn Future<Output = ()> + Send>> {
            Box::pin(async {})
        }

        fn tool_definitions(&self) -> Vec<crate::mcp::protocol::ToolMeta> {
            Vec::new()
        }
    }

    struct ScriptedHost {
        provider_url: String,
    }

    impl TaskHost for ScriptedHost {
        fn skills(&self, _context: &TaskRunContext) -> Result<String, String> {
            Ok(String::new())
        }

        fn skill_read_paths(&self, _context: &TaskRunContext) -> Vec<PathBuf> {
            Vec::new()
        }

        fn provider(&self, context: TaskRunContext) -> TaskRuntimeFuture<TaskProvider> {
            let base_url = self.provider_url.clone();
            Box::pin(async move {
                Ok(TaskProvider {
                    client: reqwest::Client::builder()
                        .no_proxy()
                        .build()
                        .map_err(|error| error.to_string())?,
                    resolved: oleafly_agent::Resolved {
                        provider_id: context.agent_id,
                        model_id: context.model_id,
                        credential: String::new(),
                        auth: None,
                        wire: oleafly_agent::Wire::OpenAiChat {
                            base_url,
                            reasoning_content: false,
                        },
                        caps: oleafly_agent::ModelCaps::default(),
                    },
                    usage: Box::new(NoUsage),
                })
            })
        }

        fn bridge(
            &self,
            _context: TaskRunContext,
            _binding: Option<TaskBinding>,
        ) -> TaskRuntimeFuture<Arc<dyn TaskBridge>> {
            Box::pin(async { Ok(Arc::new(NoBridge) as Arc<dyn TaskBridge>) })
        }
    }

    fn builtin_queue(data: &DataRoot, provider: &ScriptedProvider) -> ResearchTaskState {
        let state = data.state(1);
        let adapter = BuiltinTaskAdapter::new(
            Arc::new(ScriptedHost {
                provider_url: provider.url.clone(),
            }),
            state.services().unwrap(),
        );
        state
            .register_runtime("builtin", Arc::new(adapter))
            .unwrap();
        state
    }

    fn asking(title: &str) -> ResearchTaskDraft {
        let mut brief = crate::model::ResearchBrief::default();
        brief.permissions.commands = CommandPolicy::Ask;
        ResearchTaskDraft {
            runtime_id: "builtin".into(),
            agent_id: "fixture".into(),
            brief: Some(brief),
            ..draft("paper", title)
        }
    }

    fn ask(
        state: &ResearchTaskState,
        task: &ResearchTask,
        run: &StartedRun,
    ) -> tokio::task::JoinHandle<Result<(), String>> {
        let services = state.services().unwrap();
        let context = GateContext {
            task_id: task.id.clone(),
            project_id: task.project_id.clone(),
            task_title: task.title.clone(),
            generation: run.context.execution_generation,
            policy: CommandPolicy::Ask,
            events: Some(run.events.clone()),
        };
        let cancel = run.cancel.clone();
        tokio::spawn(async move {
            gate(
                &services,
                &context,
                ApprovalKind::Command,
                "Run the tests",
                "pytest -q",
                &cancel,
            )
            .await
        })
    }

    async fn waiting_request(state: &ResearchTaskState) -> String {
        let services = state.services().unwrap();
        poll_until(|| !services.approvals.pending("paper").unwrap().is_empty()).await;
        services.approvals.pending("paper").unwrap().remove(0).id
    }

    fn transcript(
        state: &ResearchTaskState,
        task_id: &str,
        generation: u64,
    ) -> Vec<TaskTranscriptEvent> {
        state.events(task_id, generation, None, 200).unwrap().events
    }

    fn approval_statuses(events: &[TaskTranscriptEvent]) -> Vec<ApprovalStatus> {
        events
            .iter()
            .filter_map(|row| match &row.event {
                TaskRuntimeEvent::Approval { status, .. } => Some(*status),
                _ => None,
            })
            .collect()
    }

    fn tool_result(events: &[TaskTranscriptEvent]) -> Value {
        let detail = events
            .iter()
            .find_map(|row| match &row.event {
                TaskRuntimeEvent::Tool {
                    phase: ToolPhase::Result,
                    detail,
                    ..
                } => Some(detail.clone()),
                _ => None,
            })
            .expect("the transcript has the tool result");
        serde_json::from_str(&detail)
            .unwrap_or_else(|_| panic!("the tool result is JSON: {detail}"))
    }

    #[tokio::test]
    async fn ask_first_commands_wait_for_approval_and_then_run() {
        let data = DataRoot::new();
        data.project("paper");
        let provider = ScriptedProvider::start("echo hi").await;
        let state = builtin_queue(&data, &provider);
        let store = state.store().unwrap();
        let task = requested(&store, asking("Ask before running"));
        state.launch_ready().await.unwrap();
        poll_until(|| store.require(&task.id).unwrap().pending_approvals == 1).await;

        assert_eq!(provider.count(), 1);
        let waiting = store.require(&task.id).unwrap();
        assert_eq!(waiting.status, ResearchTaskStatus::Running);
        assert_eq!(waiting.phase, Some(TaskPhase::WaitingApproval));
        let services = state.services().unwrap();
        let pending = services.approvals.pending("paper").unwrap();
        assert_eq!(pending.len(), 1);
        assert_eq!(
            (pending[0].kind, pending[0].detail.as_str()),
            (ApprovalKind::Command, "echo hi")
        );
        services.approvals.decide(&pending[0].id, true).unwrap();

        let finished = reach_status(&store, &task.id, ResearchTaskStatus::AwaitingReview).await;
        assert_eq!(provider.count(), 2);
        let events = transcript(&state, &task.id, finished.execution_generation);
        assert_eq!(
            approval_statuses(&events),
            vec![ApprovalStatus::Pending, ApprovalStatus::Approved]
        );
        let result = tool_result(&events);
        match crate::runs::remote::settings::local_commands_unavailable_reason(
            data.directory.path(),
        ) {
            Some(reason) => assert_eq!(result["error"], reason.as_str(), "{result}"),
            None => {
                assert!(
                    result.get("exitCode").is_some(),
                    "the approved command ran: {result}"
                );
                if cfg!(target_os = "macos") {
                    assert_eq!(result["exitCode"], 0, "{result}");
                    assert!(
                        result["output"].as_str().unwrap_or_default().contains("hi"),
                        "{result}"
                    );
                }
            }
        }
        stop(&state).await;
    }

    #[tokio::test]
    async fn a_denied_command_returns_an_error_to_the_agent() {
        let data = DataRoot::new();
        data.project("paper");
        let provider = ScriptedProvider::start("echo hi").await;
        let state = builtin_queue(&data, &provider);
        let store = state.store().unwrap();
        let task = requested(&store, asking("Ask, then refuse"));
        state.launch_ready().await.unwrap();
        poll_until(|| store.require(&task.id).unwrap().pending_approvals == 1).await;
        let services = state.services().unwrap();
        let pending = services.approvals.pending("paper").unwrap();
        services.approvals.decide(&pending[0].id, false).unwrap();

        let finished = reach_status(&store, &task.id, ResearchTaskStatus::AwaitingReview).await;
        let events = transcript(&state, &task.id, finished.execution_generation);
        assert_eq!(
            approval_statuses(&events),
            vec![ApprovalStatus::Pending, ApprovalStatus::Denied]
        );
        assert_eq!(
            tool_result(&events),
            json!({"error": "The user didn't approve this command."})
        );
        assert_eq!(provider.count(), 2);
        assert!(provider
            .request(1)
            .to_string()
            .contains("The user didn't approve this command."));
        assert_eq!(finished.result.unwrap().summary, "done");
        assert_eq!(finished.pending_approvals, 0);
        stop(&state).await;
    }

    #[tokio::test]
    async fn a_decision_after_cancel_or_a_new_generation_is_refused() {
        let data = DataRoot::new();
        data.project("paper");
        let state = data.state(1);
        let (runtime, mut starts) = ControlledRuntime::new();
        state.register_runtime("fixture", runtime.clone()).unwrap();
        let store = state.store().unwrap();
        let task = requested(&store, draft("paper", "Asks, then stops"));
        state.launch_ready().await.unwrap();
        let run = next_run(&mut starts).await;
        let generation = run.context.execution_generation;
        let asking = ask(&state, &task, &run);
        let approval = waiting_request(&state).await;

        let cancelling = {
            let state = state.clone();
            let id = task.id.clone();
            tokio::spawn(async move { state.cancel(id).await })
        };
        runtime.wait_for_cancel().await;
        run.complete.send(Err("cancelled".into())).unwrap();
        let cancelled = tokio::time::timeout(Duration::from_secs(5), cancelling)
            .await
            .expect("the cancel did not finish")
            .unwrap()
            .unwrap();
        assert_eq!(cancelled.status, ResearchTaskStatus::Cancelled);
        assert_eq!(
            asking.await.unwrap(),
            Err("The task was cancelled.".to_string())
        );
        assert_eq!(
            store.approval(&approval).unwrap().status,
            ApprovalStatus::Withdrawn
        );
        let services = state.services().unwrap();
        assert_eq!(
            services.approvals.decide(&approval, true).unwrap_err(),
            NO_LONGER_WAITING
        );

        state.retry(&task.id, RetryMode::Fresh).unwrap();
        state.request_start(&task.id).unwrap();
        state.launch_ready().await.unwrap();
        let again = next_run(&mut starts).await;
        assert_eq!(again.context.execution_generation, generation + 1);
        assert_eq!(
            services.approvals.decide(&approval, true).unwrap_err(),
            NO_LONGER_WAITING
        );
        assert_eq!(
            store.approval(&approval).unwrap().status,
            ApprovalStatus::Withdrawn
        );
        assert!(services.approvals.pending("paper").unwrap().is_empty());
        finish_run(&state, again, Ok(outcome("done"))).await;
        stop(&state).await;
    }

    #[tokio::test]
    async fn waiting_for_approval_does_not_use_the_time_budget() {
        let data = DataRoot::new();
        data.project("paper");
        let state = data.state(1);
        let (runtime, mut starts) = ControlledRuntime::new();
        state.register_runtime("fixture", runtime).unwrap();
        let store = state.store().unwrap();
        let task = requested(&store, draft("paper", "Waits for the user"));
        state.launch_ready().await.unwrap();
        let run = next_run(&mut starts).await;
        let clock = state
            .services()
            .unwrap()
            .clocks
            .get(&task.id)
            .expect("a running task has a budget clock");
        let asking = ask(&state, &task, &run);
        let approval = waiting_request(&state).await;

        let paused = clock.active_ms();
        tokio::time::sleep(Duration::from_millis(300)).await;
        assert_eq!(
            clock.active_ms(),
            paused,
            "waiting for the user is not counted"
        );
        state
            .services()
            .unwrap()
            .approvals
            .decide(&approval, true)
            .unwrap();
        assert_eq!(asking.await.unwrap(), Ok(()));
        tokio::time::sleep(Duration::from_millis(50)).await;
        assert!(
            clock.active_ms() > paused,
            "the clock runs again after the answer"
        );
        finish_run(&state, run, Ok(outcome("done"))).await;
        stop(&state).await;
    }

    #[tokio::test]
    async fn an_approval_request_asks_for_attention_until_it_is_answered() {
        let data = DataRoot::new();
        data.project("paper");
        let state = data.state(1);
        let (runtime, mut starts) = ControlledRuntime::new();
        state.register_runtime("fixture", runtime).unwrap();
        let store = state.store().unwrap();
        let task = requested(&store, draft("paper", "Needs an answer"));
        state.launch_ready().await.unwrap();
        let run = next_run(&mut starts).await;
        let generation = run.context.execution_generation;
        let asking = ask(&state, &task, &run);
        let approval = waiting_request(&state).await;

        assert_eq!(
            store.require(&task.id).unwrap().phase,
            Some(TaskPhase::WaitingApproval)
        );
        assert!(notifications_of(&data.host)
            .contains(&(NotificationKind::ApprovalNeeded, task.id.clone())));
        poll_until(|| attention_count(&data.host, "paper") == Some(1)).await;

        state
            .services()
            .unwrap()
            .approvals
            .decide(&approval, true)
            .unwrap();
        assert_eq!(asking.await.unwrap(), Ok(()));
        assert_eq!(
            store.require(&task.id).unwrap().phase,
            Some(TaskPhase::Working)
        );
        poll_until(|| attention_count(&data.host, "paper") == Some(0)).await;
        assert_eq!(
            approval_statuses(&transcript(&state, &task.id, generation)),
            vec![ApprovalStatus::Pending, ApprovalStatus::Approved]
        );
        finish_run(&state, run, Ok(outcome("done"))).await;
        stop(&state).await;
    }

    #[tokio::test]
    async fn a_request_left_open_by_a_quit_is_not_pending_after_a_retry() {
        let data = DataRoot::new();
        data.project("paper");
        let state = data.state(1);
        let (runtime, mut starts) = ControlledRuntime::new();
        state.register_runtime("fixture", runtime.clone()).unwrap();
        let store = state.store().unwrap();
        let task = requested(&store, draft("paper", "Asked before a quit"));
        state.launch_ready().await.unwrap();
        let run = next_run(&mut starts).await;
        let asking = ask(&state, &task, &run);
        waiting_request(&state).await;

        let quitting = {
            let state = state.clone();
            tokio::spawn(async move { state.shutdown().await })
        };
        runtime.wait_for_cancel().await;
        run.complete
            .send(Err("stopped for the quit".into()))
            .unwrap();
        tokio::time::timeout(Duration::from_secs(5), quitting)
            .await
            .expect("the quit did not finish")
            .unwrap();
        assert!(asking.await.unwrap().is_err());

        let restarted = data.state(1);
        restarted.register_runtime("fixture", runtime).unwrap();
        restarted.recover_runs(false).await.unwrap();
        assert_eq!(
            store.require(&task.id).unwrap().status,
            ResearchTaskStatus::Failed
        );
        restarted.retry(&task.id, RetryMode::Fresh).unwrap();
        restarted.request_start(&task.id).unwrap();
        restarted.launch_ready().await.unwrap();
        let retried = next_run(&mut starts).await;
        assert_eq!(retried.context.task_id, task.id);
        assert_eq!(store.require(&task.id).unwrap().pending_approvals, 0);
        assert!(restarted
            .services()
            .unwrap()
            .approvals
            .pending("paper")
            .unwrap()
            .is_empty());
        finish_run(&restarted, retried, Ok(outcome("done"))).await;
        stop(&restarted).await;
    }
}

struct CleanupProbe {
    cleaned: Arc<Mutex<Vec<String>>>,
}

#[async_trait::async_trait]
impl crate::runs::RunExecutor for CleanupProbe {
    fn id(&self) -> &'static str {
        "cleanup-probe"
    }

    async fn start(
        &self,
        _spec: &crate::runs::RunSpec,
    ) -> Result<crate::runs::RunHandle, crate::runs::RunError> {
        Err(crate::runs::RunError::Unavailable("not used".into()))
    }

    async fn poll(
        &self,
        _handle: &crate::runs::RunHandle,
    ) -> Result<crate::runs::RunStatus, crate::runs::RunError> {
        Err(crate::runs::RunError::Unavailable("not used".into()))
    }

    async fn read_log(
        &self,
        _handle: &crate::runs::RunHandle,
        _query: crate::runs::LogQuery,
    ) -> Result<String, crate::runs::RunError> {
        Ok(String::new())
    }

    async fn cancel(&self, _handle: &crate::runs::RunHandle) -> Result<(), crate::runs::RunError> {
        Ok(())
    }

    async fn cleanup(&self, handle: &crate::runs::RunHandle) -> Result<(), crate::runs::RunError> {
        lock(&self.cleaned).push(handle.run_id.clone());
        Ok(())
    }
}

#[tokio::test]
async fn deleting_a_task_cleans_what_its_runs_left_on_other_computers() {
    let data = DataRoot::new();
    data.project("paper");
    let state = data.state(1);
    let (runtime, mut starts) = ControlledRuntime::new();
    state.register_runtime("fixture", runtime).unwrap();
    let store = state.store().unwrap();
    let task = requested(&store, draft("paper", "Ran on a cluster"));
    state.launch_ready().await.unwrap();
    let run = next_run(&mut starts).await;
    let finished = finish_run(&state, run, Ok(outcome("done"))).await;
    assert_eq!(finished.status, ResearchTaskStatus::AwaitingReview);

    let cleaned = Arc::new(Mutex::new(Vec::new()));
    let services = state.services().unwrap();
    services.runs.register_executor(Arc::new(CleanupProbe {
        cleaned: cleaned.clone(),
    }));
    for run_id in ["r001", "r002"] {
        store
            .insert_run(&crate::model::RunRecord {
                task_id: task.id.clone(),
                run_id: run_id.into(),
                execution_generation: task.execution_generation,
                name: "baseline".into(),
                executor: "cleanup-probe".into(),
                command: "python train.py".into(),
                cwd_rel: String::new(),
                state: crate::model::RunState::Succeeded,
                exit_code: Some(0),
                started_at: crate::model::now_ms(),
                finished_at: None,
                run_dir: String::new(),
                metrics: Default::default(),
                reported: true,
            })
            .unwrap();
        let handle = crate::runs::RunHandle {
            version: crate::runs::HANDLE_VERSION,
            executor: "cleanup-probe".into(),
            task_id: task.id.clone(),
            run_id: run_id.into(),
            run_dir: PathBuf::new(),
            started_at: 1,
            data: serde_json::json!({}),
        };
        store
            .set_run_handle(&task.id, run_id, &serde_json::to_string(&handle).unwrap())
            .unwrap();
    }

    let id = task.id.clone();
    state
        .blocking(move |state| state.delete(&id))
        .await
        .unwrap();
    assert!(store.require(&task.id).is_err());
    tokio::time::timeout(CHILD_PATIENCE, async {
        while lock(&cleaned).len() < 2 {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("the runs' remote folders were never cleaned");
    assert_eq!(*lock(&cleaned), vec!["r001".to_owned(), "r002".to_owned()]);
    stop(&state).await;
}

fn phase(run: &StartedRun, phase: TaskPhase) {
    (run.events)(TaskRuntimeEvent::Phase { phase });
}

#[tokio::test]
async fn a_task_that_waits_lets_another_start_in_its_place() {
    let data = DataRoot::new();
    data.project("paper");
    let state = data.state(1);
    let (runtime, mut starts) = ControlledRuntime::new();
    state.register_runtime("fixture", runtime).unwrap();
    let store = state.store().unwrap();
    let waiting = requested(&store, draft("paper", "Waits for a cluster job"));
    state.launch_ready().await.unwrap();
    let first = next_run(&mut starts).await;
    let second_task = requested(&store, draft("paper", "Next in line"));
    let third_task = requested(&store, draft("paper", "Behind both"));
    state.launch_ready().await.unwrap();
    assert!(
        tokio::time::timeout(Duration::from_millis(200), starts.recv())
            .await
            .is_err()
    );

    phase(&first, TaskPhase::WaitingRuns);
    let second = next_run(&mut starts).await;
    assert_eq!(second.context.task_id, second_task.id);

    phase(&second, TaskPhase::WaitingApproval);
    assert!(
        tokio::time::timeout(Duration::from_millis(300), starts.recv())
            .await
            .is_err()
    );
    assert_eq!(
        store.require(&third_task.id).unwrap().status,
        ResearchTaskStatus::Queued
    );

    phase(&first, TaskPhase::Working);
    assert_eq!(
        finish_run(&state, first, Ok(outcome("done"))).await.id,
        waiting.id
    );
    phase(&second, TaskPhase::Working);
    finish_run(&state, second, Ok(outcome("done"))).await;
    let third = next_run(&mut starts).await;
    assert_eq!(third.context.task_id, third_task.id);
    finish_run(&state, third, Ok(outcome("done"))).await;
    stop(&state).await;
}
