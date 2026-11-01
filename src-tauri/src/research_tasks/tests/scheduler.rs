use std::ffi::OsString;
use std::path::PathBuf;
use std::sync::MutexGuard;
use std::time::Duration;

use oleafly_agent::CancellationToken;
use tokio::sync::{mpsc, oneshot};

use super::*;
use crate::test_wait;
use crate::worktree_lock::ProjectWorktreeLock;
use model::{ResearchTaskDraft, TaskResultMetadata};

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
        let state = ResearchTaskState::for_test(self.directory.path().join("tasks"), concurrency);
        state.attach(
            Arc::new(host::AppResearchHost::detached()),
            tokio::runtime::Handle::current(),
        );
        state
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
    complete: oneshot::Sender<Result<TaskRuntimeOutcome, String>>,
}

struct ControlledRuntime {
    starts: mpsc::UnboundedSender<StartedRun>,
}

impl ControlledRuntime {
    fn new() -> (Arc<Self>, mpsc::UnboundedReceiver<StartedRun>) {
        let (starts, receiver) = mpsc::unbounded_channel();
        (Arc::new(Self { starts }), receiver)
    }
}

impl TaskRuntimeAdapter for ControlledRuntime {
    fn supports(&self, agent_id: &str) -> bool {
        agent_id == "fixture-agent"
    }

    fn run(
        &self,
        context: TaskRunContext,
        _cancel: CancellationToken,
        _events: TaskEventSink,
    ) -> TaskRuntimeFuture<TaskRuntimeOutcome> {
        let (complete, result) = oneshot::channel();
        let sent = self
            .starts
            .send(StartedRun { context, complete })
            .map_err(|_| "the test stopped observing adapter starts".to_string());
        Box::pin(async move {
            sent?;
            result
                .await
                .map_err(|_| "the test dropped the adapter result".to_string())?
        })
    }

    fn cancel(&self, _session_id: String) -> TaskRuntimeFuture<()> {
        Box::pin(async { Ok(()) })
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
    tokio::time::timeout(test_wait::CHILD_PATIENCE, receiver.recv())
        .await
        .expect("the scheduler did not start the expected adapter")
        .expect("the adapter start channel closed")
}

async fn finish_run(
    state: &ResearchTaskState,
    run: StartedRun,
    result: Result<TaskRuntimeOutcome, String>,
) -> ResearchTask {
    let id = run.context.task_id.clone();
    let settled = state
        .settle_waiter(&id)
        .expect("the run is active until it finishes");
    run.complete.send(result).unwrap();
    tokio::time::timeout(Duration::from_secs(5), settled)
        .await
        .expect("the scheduler did not settle the run");
    state.store().unwrap().require(&id).unwrap()
}

async fn stop(state: &ResearchTaskState) {
    tokio::time::timeout(Duration::from_secs(5), state.shutdown())
        .await
        .expect("the scheduler did not finish shutdown");
}

#[tokio::test]
async fn the_switch_refuses_new_work_while_off_and_stops_running_work_when_turned_off() {
    let data = DataRoot::new();
    data.project("paper");
    crate::config::write_config(&crate::config::AppConfig::default()).unwrap();
    let state = data.state(1);
    let (runtime, mut starts) = ControlledRuntime::new();
    state.register_runtime("fixture", runtime).unwrap();
    state.set_enabled(false);
    assert_eq!(ensure_enabled(&state).unwrap_err(), TASKS_OFF);
    let store = state.store().unwrap();
    let task = requested(&store, draft("paper", "Waits for the switch"));
    state.launch_ready().await.unwrap();
    assert!(starts.try_recv().is_err());

    set_enabled(&state, true).await.unwrap();
    assert!(crate::config::read_config().unwrap().research_tasks_enabled);
    assert!(ensure_enabled(&state).is_ok());
    let run = next_run(&mut starts).await;
    assert_eq!(run.context.task_id, task.id);

    let turning_off = {
        let state = state.clone();
        tokio::spawn(async move { set_enabled(&state, false).await })
    };
    let mut asked = false;
    for _ in 0..500 {
        if store.require(&task.id).unwrap().cancel_requested {
            asked = true;
            break;
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    assert!(
        asked,
        "turning tasks off did not ask the running task to stop"
    );
    run.complete.send(Err("stopped".into())).unwrap();
    tokio::time::timeout(Duration::from_secs(5), turning_off)
        .await
        .expect("turning tasks off did not finish")
        .unwrap()
        .unwrap();
    assert!(!crate::config::read_config().unwrap().research_tasks_enabled);
    assert_eq!(
        store.require(&task.id).unwrap().status,
        ResearchTaskStatus::Cancelled
    );
    assert_eq!(ensure_enabled(&state).unwrap_err(), TASKS_OFF);
    stop(&state).await;
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

fn skill_record(id: &str, enabled: bool, project_disabled: bool) -> crate::skills::SkillRecord {
    crate::skills::SkillRecord {
        id: id.into(),
        name: id.into(),
        description: "fixture skill".into(),
        instructions: "Do the work.".into(),
        dir: format!("/skills/{id}"),
        files: Vec::new(),
        license: None,
        compatibility: None,
        allowed_tools: Vec::new(),
        version: None,
        author: None,
        tier: crate::skills::SkillTier::User,
        phase: None,
        tools: Vec::new(),
        source: crate::skills::SkillSource::User,
        pack_version: None,
        update_available: false,
        project_enabled: false,
        project_disabled,
        enabled,
        removable: true,
        validation: crate::skills::SkillValidation::Valid,
        shadows_bundled: false,
    }
}

#[test]
fn a_task_cannot_be_created_with_a_skill_that_is_off_or_missing() {
    let records = vec![
        skill_record("literature-review", true, false),
        skill_record("peer-review", false, false),
        skill_record("scientific-writing", true, true),
    ];

    assert_eq!(
        host::unavailable_skill(&records, &["literature-review".into()]),
        None
    );
    assert_eq!(
        host::unavailable_skill(
            &records,
            &["literature-review".into(), "peer-review".into()]
        ),
        Some("The skill peer-review is turned off. Enable it in Settings, AI, Skills.".into())
    );
    assert_eq!(
        host::unavailable_skill(&records, &["scientific-writing".into()]),
        Some(
            "The skill scientific-writing is turned off. Enable it in Settings, AI, Skills.".into()
        )
    );
    assert_eq!(
        host::unavailable_skill(&records, &["statistical-analysis".into()]),
        Some("The skill statistical-analysis is not installed.".into())
    );
    assert_eq!(host::unavailable_skill(&records, &[]), None);
}
