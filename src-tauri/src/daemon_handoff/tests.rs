//! 0.4.8 L: the app's half of the background helper.
use std::collections::{BTreeMap, HashMap, HashSet};
use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::Duration;

use oleafly_agent::CancellationToken;
use oleafly_cli::daemon::login_item::RunRegistry;
use oleafly_research::handoff::{AcpHandoff, TRUST_AGENTS, TRUST_MCP};
use oleafly_research::host::{GitEnv, IsolationEnv, ProjectLocation};
use oleafly_research::model::{
    PendingStart, ResearchTaskDraft, ResumeReason, StopReason, TaskResultMetadata, TaskRunContext,
    TaskRuntimeEvent, TaskRuntimeOutcome, TaskTranscriptEvent,
};
use oleafly_research::runs::SupervisorCommand;
use oleafly_research::scheduler::{
    SuspendSignals, TaskEventSink, TaskRuntimeAdapter, TaskRuntimeFuture,
};
use oleafly_research::test_support::FakeHost;
use oleafly_sandbox::process::identity::ProcessIdentity;
use serde_json::json;
use tokio::sync::mpsc;
use zeroize::Zeroizing;

use super::*;

const CONVERSATION: &str = "3-conversation.json";

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

fn sorted(mut ids: Vec<String>) -> Vec<String> {
    ids.sort();
    ids
}

/// A temporary data folder for code that reads the app's own (config,
/// secrets, trust, projects).
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

    fn path(&self) -> &Path {
        self.directory.path()
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

/// The app's host for the queue, recording what it was told to show.
#[derive(Clone, Default)]
struct RecordingHost {
    inner: FakeHost,
    notified: Arc<Mutex<Vec<(NotificationKind, String)>>>,
}

impl RecordingHost {
    fn notified(&self) -> Vec<(NotificationKind, String)> {
        lock(&self.notified).clone()
    }

    fn appended(&self, task_id: &str) -> Vec<u64> {
        lock(&self.inner.appended)
            .iter()
            .filter(|event| event.task_id == task_id)
            .map(|event| event.sequence)
            .collect()
    }
}

impl IsolationEnv for RecordingHost {
    fn require_trusted(&self, project_id: &str) -> Result<(), String> {
        self.inner.require_trusted(project_id)
    }

    fn locate_project(&self, project_id: &str) -> Result<ProjectLocation, String> {
        self.inner.locate_project(project_id)
    }

    fn try_shared_project_lock(
        &self,
        project_id: &str,
    ) -> Result<Option<Box<dyn std::any::Any + Send>>, String> {
        self.inner.try_shared_project_lock(project_id)
    }

    fn git(&self) -> Option<GitEnv> {
        self.inner.git()
    }
}

impl ResearchHost for RecordingHost {
    fn admit_project(&self, project_id: &str) -> Result<(), String> {
        self.inner.admit_project(project_id)
    }

    fn project_present(&self, project_id: &str) -> bool {
        self.inner.project_present(project_id)
    }

    fn unavailable_skill(
        &self,
        project_id: &str,
        skill_ids: &[String],
    ) -> Result<Option<String>, String> {
        self.inner.unavailable_skill(project_id, skill_ids)
    }

    fn task_changed(&self, task: &ResearchTask) {
        self.inner.task_changed(task);
    }

    fn transcript_appended(&self, event: &TaskTranscriptEvent) {
        self.inner.transcript_appended(event);
    }

    fn supervisor_command(&self) -> Option<SupervisorCommand> {
        None
    }

    fn notify(&self, notification: Notification) {
        lock(&self.notified).push((notification.kind, notification.task_id));
    }
}

/// A runtime whose runs wait for a suspend, then save a conversation.
struct ParkedRuntime {
    suspends: Arc<SuspendSignals>,
    started: mpsc::UnboundedSender<String>,
}

fn outcome() -> TaskRuntimeOutcome {
    TaskRuntimeOutcome {
        summary: String::new(),
        artifacts: Vec::new(),
        native_session_id: None,
        input_tokens: None,
        output_tokens: None,
    }
}

impl TaskRuntimeAdapter for ParkedRuntime {
    fn supports(&self, _agent_id: &str) -> bool {
        true
    }

    fn run(
        &self,
        context: TaskRunContext,
        cancel: CancellationToken,
        _events: TaskEventSink,
    ) -> TaskRuntimeFuture<TaskRuntimeOutcome> {
        let step = self.suspends.token(&context.task_id);
        let suspends = self.suspends.clone();
        let _ = self.started.send(context.task_id.clone());
        Box::pin(async move {
            tokio::select! {
                () = step.cancelled() => {
                    suspends.record(
                        &context.task_id,
                        SuspendState {
                            conversation: Some(CONVERSATION.into()),
                            turn_interrupted: false,
                            acp: None,
                        },
                    );
                    Ok(outcome())
                }
                () = cancel.cancelled() => Err("cancelled".to_string()),
            }
        })
    }

    fn cancel(&self, _session_id: String) -> TaskRuntimeFuture<()> {
        Box::pin(async { Ok(()) })
    }
}

async fn next_start(started: &mut mpsc::UnboundedReceiver<String>) -> String {
    tokio::time::timeout(Duration::from_secs(60), started.recv())
        .await
        .expect("the task did not start")
        .expect("the runtime is gone")
}

/// A task queue over a temporary folder with one project, `paper`.
struct Fixture {
    _temp: tempfile::TempDir,
    host: RecordingHost,
    state: ResearchTaskState,
}

fn draft(title: &str, keep: bool) -> ResearchTaskDraft {
    ResearchTaskDraft {
        project_id: "paper".into(),
        title: title.into(),
        prompt: "Survey the field".into(),
        runtime_id: "fixture".into(),
        agent_id: "fixture-agent".into(),
        model_id: "fixture-model".into(),
        keep_running_after_quit: keep,
        ..Default::default()
    }
}

impl Fixture {
    fn new() -> Self {
        let temp = tempfile::tempdir().unwrap();
        let project = temp.path().join("paper");
        std::fs::create_dir_all(&project).unwrap();
        std::fs::write(project.join("main.tex"), "\\documentclass{article}\n").unwrap();
        let host = RecordingHost::default();
        host.inner.add_project("paper", &project);
        let state = ResearchTaskState::for_test(temp.path().join("research-tasks"), 2);
        state.attach(Arc::new(host.clone()), tokio::runtime::Handle::current());
        Self {
            _temp: temp,
            host,
            state,
        }
    }

    /// Runs started tasks in [`ParkedRuntime`]; returns their starts.
    fn park_tasks(&self) -> mpsc::UnboundedReceiver<String> {
        let (started, receiver) = mpsc::unbounded_channel();
        let runtime = ParkedRuntime {
            suspends: self.state.services().unwrap().suspends,
            started,
        };
        self.state
            .register_runtime("fixture", Arc::new(runtime))
            .unwrap();
        receiver
    }

    fn app_store(&self) -> TaskStore {
        self.state.store().unwrap()
    }

    fn helper_store(&self) -> TaskStore {
        TaskStore::with_owner_kind(self.state.root().unwrap(), OwnerKind::Daemon).unwrap()
    }

    /// A task waiting to start in the app.
    fn queued(&self, title: &str, keep: bool) -> ResearchTask {
        let store = self.app_store();
        let task = store.create(draft(title, keep)).unwrap();
        store.request_start(&task.id).unwrap()
    }

    /// A task the helper was handed and has not started.
    fn helper_queued(&self, title: &str) -> ResearchTask {
        let task = self.queued(title, true);
        let record = HandoffRecord::new(
            OwnerKind::App,
            OwnerKind::Daemon,
            HandoffReason::Quit,
            task.execution_generation,
        );
        assert!(self
            .app_store()
            .hand_off_queued(&task.id, OwnerKind::Daemon, &record)
            .unwrap());
        self.app_store().require(&task.id).unwrap()
    }

    /// A task the helper runs. This test process stands in for the helper,
    /// so call it while no other helper task waits.
    fn helper_running(&self, title: &str) -> ResearchTask {
        let task = self.helper_queued(title);
        let claimed = self
            .helper_store()
            .claim_next()
            .unwrap()
            .expect("the helper claims its task");
        assert_eq!(claimed.id, task.id);
        claimed
    }
}

/// A process that is no longer running: this pid with another start time.
fn gone_owner() -> ProcessIdentity {
    ProcessIdentity {
        pid: std::process::id(),
        started: Some(1),
    }
}

#[derive(Default)]
struct FakeHelper {
    running: AtomicBool,
    hung: AtomicBool,
    fail_start: AtomicBool,
    stops_on_request: AtomicBool,
    ensure_calls: AtomicUsize,
    starts: AtomicUsize,
    stop_requests: AtomicUsize,
    terminations: AtomicUsize,
}

impl FakeHelper {
    fn running() -> Self {
        let helper = Self::default();
        helper.running.store(true, Ordering::SeqCst);
        helper
    }

    fn count(counter: &AtomicUsize) -> usize {
        counter.load(Ordering::SeqCst)
    }
}

impl HelperControl for FakeHelper {
    fn status(&self) -> HelperStatus {
        let running = self.running.load(Ordering::SeqCst);
        HelperStatus {
            running,
            pid: None,
            app_version: None,
            phase: running.then_some(Phase::Ready),
            mode: None,
            started_at: None,
            heartbeat_at: None,
            log_path: PathBuf::new(),
            tasks: Vec::new(),
        }
    }

    fn ensure_running(&self) -> Result<bool, String> {
        self.ensure_calls.fetch_add(1, Ordering::SeqCst);
        if self.fail_start.load(Ordering::SeqCst) {
            return Err("The background helper could not start: fixture".into());
        }
        if self.running.swap(true, Ordering::SeqCst) {
            return Ok(false);
        }
        self.starts.fetch_add(1, Ordering::SeqCst);
        Ok(true)
    }

    fn request_stop(&self) -> Result<(), String> {
        self.stop_requests.fetch_add(1, Ordering::SeqCst);
        if self.stops_on_request.load(Ordering::SeqCst) {
            self.running.store(false, Ordering::SeqCst);
        }
        Ok(())
    }

    fn wait_stopped(&self, _timeout: Duration) -> bool {
        !self.running.load(Ordering::SeqCst)
    }

    fn terminate_if_hung(&self, _observe: Duration) -> bool {
        self.running.load(Ordering::SeqCst) && self.hung.load(Ordering::SeqCst) && self.terminate()
    }

    fn terminate(&self) -> bool {
        self.terminations.fetch_add(1, Ordering::SeqCst);
        self.running.store(false, Ordering::SeqCst);
        true
    }
}

#[derive(Default)]
struct FakeGrants {
    refuse: Vec<String>,
    calls: Mutex<Vec<(String, Option<SuspendState>)>>,
}

impl FakeGrants {
    fn refusing(id: &str) -> Self {
        Self {
            refuse: vec![id.to_owned()],
            ..Self::default()
        }
    }

    fn calls(&self) -> Vec<(String, Option<SuspendState>)> {
        lock(&self.calls).clone()
    }
}

#[async_trait::async_trait]
impl GrantSource for FakeGrants {
    async fn grant(
        &self,
        task: &ResearchTask,
        suspended: Option<&SuspendState>,
    ) -> Result<TaskGrant, String> {
        lock(&self.calls).push((task.id.clone(), suspended.cloned()));
        if self.refuse.contains(&task.id) {
            return Err("The project folder is no longer where it was when Oleafly closed.".into());
        }
        Ok(TaskGrant {
            project_root: "/projects/paper".into(),
            capabilities: vec![
                TRUST_RESEARCH_TASKS.into(),
                TRUST_AGENTS.into(),
                TRUST_MCP.into(),
            ],
            ..TaskGrant::default()
        })
    }
}

// Exit.

#[test]
fn the_restart_after_an_install_is_an_update_not_a_quit() {
    assert_eq!(exit_mode(false, true, false), ExitMode::Update);
    assert_eq!(exit_mode(false, true, true), ExitMode::Update);
    assert_eq!(exit_mode(true, false, false), ExitMode::Update);
    assert_eq!(exit_mode(false, false, true), ExitMode::Restart);
    assert_eq!(exit_mode(false, false, false), ExitMode::Quit);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn quitting_hands_keep_running_tasks_to_the_helper_and_leaves_the_rest() {
    let fixture = Fixture::new();
    let mut started = fixture.park_tasks();
    let working = fixture.queued("Working", true);
    fixture.state.launch_ready().await.unwrap();
    assert_eq!(next_start(&mut started).await, working.id);
    let waiting = fixture.queued("Waiting", true);
    let plain = fixture.queued("Plain", false);
    let grants = FakeGrants::default();
    let helper = FakeHelper::default();

    let summary = hand_off(&fixture.state, ExitMode::Quit, true, &grants, &helper).await;

    assert_eq!(
        sorted(summary.to_helper.clone()),
        sorted(vec![working.id.clone(), waiting.id.clone()])
    );
    assert!(summary.spawned && summary.failed.is_empty() && summary.to_next_launch.is_empty());
    assert_eq!(FakeHelper::count(&helper.starts), 1);
    let store = fixture.app_store();
    for id in [&working.id, &waiting.id] {
        let task = store.require(id).unwrap();
        assert_eq!(
            (task.owner, task.status),
            (OwnerKind::Daemon, ResearchTaskStatus::Queued),
            "{id}"
        );
        let record = store.handoff_record(id).unwrap().unwrap();
        assert_eq!(
            (record.reason, record.to),
            (HandoffReason::Quit, OwnerKind::Daemon)
        );
        assert!(record
            .grant
            .is_some_and(|grant| grant.allows(TRUST_RESEARCH_TASKS)));
    }
    // The running task stopped at a step and its conversation went along.
    let record = store.handoff_record(&working.id).unwrap().unwrap();
    assert_eq!(record.conversation.as_deref(), Some(CONVERSATION));
    let saw_saved = grants.calls().into_iter().any(|(id, state)| {
        id == working.id
            && state.is_some_and(|state| state.conversation.as_deref() == Some(CONVERSATION))
    });
    assert!(saw_saved, "the grant saw what the task saved");
    let plain = store.require(&plain.id).unwrap();
    assert_eq!(
        (plain.owner, plain.status),
        (OwnerKind::App, ResearchTaskStatus::Queued)
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn restart_and_update_keep_tasks_for_the_next_launch_without_a_helper() {
    let fixture = Fixture::new();
    let mut started = fixture.park_tasks();
    let working = fixture.queued("Working", true);
    fixture.state.launch_ready().await.unwrap();
    assert_eq!(next_start(&mut started).await, working.id);
    let waiting = fixture.queued("Waiting", true);
    let grants = FakeGrants::default();
    let helper = FakeHelper::default();

    let summary = hand_off(&fixture.state, ExitMode::Restart, true, &grants, &helper).await;

    assert_eq!(summary.to_next_launch, std::slice::from_ref(&working.id));
    assert!(summary.to_helper.is_empty() && !summary.spawned);
    assert_eq!(FakeHelper::count(&helper.ensure_calls), 0);
    assert!(grants.calls().is_empty(), "no grant without a helper");
    let store = fixture.app_store();
    let task = store.require(&working.id).unwrap();
    assert_eq!(
        (task.owner, task.status),
        (OwnerKind::App, ResearchTaskStatus::Queued)
    );
    assert!(matches!(
        task.pending_start,
        Some(PendingStart::Resume {
            reason: ResumeReason::Handoff,
            ..
        })
    ));
    let record = store.handoff_record(&working.id).unwrap().unwrap();
    assert_eq!(
        (record.reason, record.to),
        (HandoffReason::Restart, OwnerKind::App)
    );
    assert_eq!(record.conversation.as_deref(), Some(CONVERSATION));
    assert!(record.grant.is_none());
    assert_eq!(store.require(&waiting.id).unwrap().owner, OwnerKind::App);

    // An update starts no helper either.
    let summary = hand_off(&fixture.state, ExitMode::Update, true, &grants, &helper).await;
    assert!(summary.to_helper.is_empty() && !summary.spawned);
    assert_eq!(FakeHelper::count(&helper.ensure_calls), 0);
}

#[tokio::test]
async fn with_background_tasks_off_nothing_starts_and_tasks_wait_for_the_app() {
    let fixture = Fixture::new();
    let waiting = fixture.queued("Waiting", true);
    let grants = FakeGrants::default();
    let helper = FakeHelper::default();

    let summary = hand_off(&fixture.state, ExitMode::Quit, false, &grants, &helper).await;

    assert_eq!(summary, HandoffSummary::default());
    assert_eq!(FakeHelper::count(&helper.ensure_calls), 0);
    assert!(grants.calls().is_empty());
    let task = fixture.app_store().require(&waiting.id).unwrap();
    assert_eq!(
        (task.owner, task.status),
        (OwnerKind::App, ResearchTaskStatus::Queued)
    );
}

#[tokio::test]
async fn a_second_shutdown_pass_starts_no_helper() {
    let fixture = Fixture::new();
    let waiting = fixture.queued("Waiting", true);
    let helper = FakeHelper::default();

    let first = hand_off(
        &fixture.state,
        ExitMode::Quit,
        true,
        &FakeGrants::default(),
        &helper,
    )
    .await;
    let second = hand_off(
        &fixture.state,
        ExitMode::Quit,
        true,
        &FakeGrants::default(),
        &helper,
    )
    .await;

    assert_eq!(first.to_helper, std::slice::from_ref(&waiting.id));
    assert_eq!(second, HandoffSummary::default());
    assert_eq!(FakeHelper::count(&helper.ensure_calls), 1);
    assert_eq!(FakeHelper::count(&helper.starts), 1);
}

#[tokio::test]
async fn a_helper_that_fails_to_start_leaves_its_tasks_for_the_next_launch() {
    let fixture = Fixture::new();
    let waiting = fixture.queued("Waiting", true);
    let helper = FakeHelper::default();
    helper.fail_start.store(true, Ordering::SeqCst);

    let summary = hand_off(
        &fixture.state,
        ExitMode::Quit,
        true,
        &FakeGrants::default(),
        &helper,
    )
    .await;

    assert_eq!(summary.to_helper, std::slice::from_ref(&waiting.id));
    assert!(!summary.spawned);
    assert_eq!(
        fixture.app_store().require(&waiting.id).unwrap().owner,
        OwnerKind::Daemon
    );
    // The next launch finds no helper and takes the task back.
    let reclaimed = reclaim(&fixture.state, &FakeHelper::default());
    assert_eq!(reclaimed.adopted, std::slice::from_ref(&waiting.id));
    assert_eq!(
        fixture.app_store().require(&waiting.id).unwrap().owner,
        OwnerKind::App
    );
}

#[tokio::test]
async fn a_task_whose_grant_fails_waits_for_the_next_launch() {
    let fixture = Fixture::new();
    let moved = fixture.queued("Moved", true);
    let refused = fixture.queued("Refused", true);
    let helper = FakeHelper::default();

    let summary = hand_off(
        &fixture.state,
        ExitMode::Quit,
        true,
        &FakeGrants::refusing(&refused.id),
        &helper,
    )
    .await;

    assert_eq!(summary.to_helper, std::slice::from_ref(&moved.id));
    assert_eq!(summary.failed, std::slice::from_ref(&refused.id));
    let task = fixture.app_store().require(&refused.id).unwrap();
    assert_eq!(
        (task.owner, task.status),
        (OwnerKind::App, ResearchTaskStatus::Queued)
    );
}

// Launch.

#[tokio::test]
async fn launch_adopts_a_dead_helpers_tasks_and_asks_a_live_one_for_its_own() {
    let fixture = Fixture::new();
    // The helper ran one task and had another waiting when it died.
    let running = fixture.helper_running("Running");
    fixture
        .helper_store()
        .set_owner(&running.id, Some(gone_owner()))
        .unwrap();
    let waiting = fixture.helper_queued("Waiting");

    let summary = reclaim(&fixture.state, &FakeHelper::default());

    assert_eq!(
        sorted(summary.adopted.clone()),
        sorted(vec![running.id.clone(), waiting.id.clone()])
    );
    assert!(!summary.helper_hung && summary.requested == 0);
    let store = fixture.app_store();
    for id in [&running.id, &waiting.id] {
        let task = store.require(id).unwrap();
        assert_eq!(
            (task.owner, task.status),
            (OwnerKind::App, ResearchTaskStatus::Queued),
            "{id}"
        );
    }
    let record = store.handoff_record(&running.id).unwrap().unwrap();
    assert_eq!(record.reason, HandoffReason::Recovered);
    assert!(record.turn_interrupted);

    // A live helper gives its task back at the next step.
    let live = fixture.helper_running("Live");
    let helper = FakeHelper::running();
    let summary = reclaim(&fixture.state, &helper);
    assert_eq!(summary.requested, 1);
    assert!(summary.adopted.is_empty() && !summary.helper_hung);
    let task = store.require(&live.id).unwrap();
    assert!(task.reclaim_requested);
    assert_eq!(task.owner, OwnerKind::Daemon);
    assert_eq!(FakeHelper::count(&helper.terminations), 0);
}

#[tokio::test]
async fn a_hung_helper_is_stopped_and_its_tasks_adopted() {
    let fixture = Fixture::new();
    let running = fixture.helper_running("Running");
    // Once ended, the rows name a process that is gone.
    fixture
        .helper_store()
        .set_owner(&running.id, Some(gone_owner()))
        .unwrap();
    let helper = FakeHelper::running();
    helper.hung.store(true, Ordering::SeqCst);

    let summary = reclaim(&fixture.state, &helper);

    assert!(summary.helper_hung);
    assert_eq!(summary.adopted, std::slice::from_ref(&running.id));
    assert_eq!(FakeHelper::count(&helper.terminations), 1);
    assert_eq!(
        fixture.app_store().require(&running.id).unwrap().owner,
        OwnerKind::App
    );
}

// Watcher.

fn status_event(message: &str) -> TaskRuntimeEvent {
    TaskRuntimeEvent::Status {
        message: message.into(),
    }
}

fn result() -> TaskResultMetadata {
    TaskResultMetadata {
        summary: "Three papers found.".into(),
        changed_files: Vec::new(),
        artifacts: Vec::new(),
        native_session_id: None,
        input_tokens: None,
        output_tokens: None,
    }
}

/// The store's change times have millisecond steps.
fn next_millisecond() {
    std::thread::sleep(Duration::from_millis(5));
}

#[tokio::test]
async fn the_watcher_forwards_helper_progress_and_stops_when_none_remain() {
    let fixture = Fixture::new();
    let running = fixture.helper_running("Survey");
    let helper = fixture.helper_store();
    let generation = running.execution_generation;
    helper
        .append_event(&running.id, generation, &status_event("Reading sources"))
        .unwrap();
    let mut watch = WatchState::seeded(&fixture.app_store(), now_ms() - 1_000);

    let report = watch_tick(&mut watch, &fixture.state, &fixture.host).unwrap();
    assert!(report.has_work && !report.came_back);
    assert_eq!(fixture.host.appended(&running.id), [1]);

    next_millisecond();
    helper
        .append_event(
            &running.id,
            generation,
            &status_event("Writing the summary"),
        )
        .unwrap();
    assert!(helper
        .finish_success(&running.id, generation, &result())
        .unwrap());
    let report = watch_tick(&mut watch, &fixture.state, &fixture.host).unwrap();

    assert!(!report.has_work, "nothing is left with the helper");
    assert!(fixture.host.appended(&running.id).contains(&2));
    assert!(fixture
        .host
        .inner
        .changed_statuses(&running.id)
        .contains(&ResearchTaskStatus::AwaitingReview));
}

#[tokio::test]
async fn the_watcher_pages_a_long_transcript_200_events_per_tick() {
    let fixture = Fixture::new();
    let running = fixture.helper_running("Long");
    let helper = fixture.helper_store();
    for index in 0..450 {
        helper
            .append_event(
                &running.id,
                running.execution_generation,
                &status_event(&format!("Step {index}")),
            )
            .unwrap();
    }
    let mut watch = WatchState::seeded(&fixture.app_store(), now_ms() - 1_000);
    let mut forwarded = Vec::new();
    for expected in [200, 400, 452] {
        watch_tick(&mut watch, &fixture.state, &fixture.host).unwrap();
        forwarded = fixture.host.appended(&running.id);
        // Each page repeats the last row of the one before (it may grow).
        assert_eq!(forwarded.len(), expected);
    }
    assert_eq!(forwarded.iter().max(), Some(&450));
    assert_eq!(forwarded.iter().collect::<HashSet<_>>().len(), 450);
}

#[tokio::test]
async fn the_app_notifies_for_helper_transitions_while_it_is_open() {
    let fixture = Fixture::new();
    let running = fixture.helper_running("Survey");
    assert_eq!(fixture.app_store().request_reclaim().unwrap(), 1);
    let mut watch = WatchState::seeded(&fixture.app_store(), now_ms() - 1_000);
    watch_tick(&mut watch, &fixture.state, &fixture.host).unwrap();
    assert!(fixture.host.notified().is_empty());

    next_millisecond();
    assert!(fixture
        .helper_store()
        .finish_success(&running.id, running.execution_generation, &result())
        .unwrap());
    watch_tick(&mut watch, &fixture.state, &fixture.host).unwrap();
    watch_tick(&mut watch, &fixture.state, &fixture.host).unwrap();

    assert_eq!(
        fixture.host.notified(),
        [(NotificationKind::ReviewReady, running.id.clone())]
    );
}

#[tokio::test]
async fn transitions_notify_like_the_apps_own_tasks() {
    let fixture = Fixture::new();
    let before = fixture.helper_running("Survey");
    let with = |status: ResearchTaskStatus| {
        let mut task = before.clone();
        task.status = status;
        task
    };
    assert_eq!(
        transition_notice(&before, &with(ResearchTaskStatus::AwaitingReview)),
        Some(NotificationKind::ReviewReady)
    );
    let mut budget = with(ResearchTaskStatus::AwaitingReview);
    budget.stop_reason = Some(StopReason::BudgetCost);
    assert_eq!(
        transition_notice(&before, &budget),
        Some(NotificationKind::BudgetReached)
    );
    assert_eq!(
        transition_notice(&before, &with(ResearchTaskStatus::PlanReady)),
        Some(NotificationKind::PlanReady)
    );
    assert_eq!(
        transition_notice(&before, &with(ResearchTaskStatus::Failed)),
        Some(NotificationKind::Failed)
    );
    assert_eq!(
        transition_notice(&before, &with(ResearchTaskStatus::Queued)),
        None
    );
    let mut asking = before.clone();
    asking.pending_approvals += 1;
    assert_eq!(
        transition_notice(&before, &asking),
        Some(NotificationKind::ApprovalNeeded)
    );
    assert_eq!(transition_notice(&asking, &before), None);
}

// Grants.

#[tokio::test]
async fn grants_hold_trust_location_roots_and_launch_but_no_credentials() {
    let data = DataRoot::new();
    // Its own project id: the forced trust below is process-wide.
    let project = crate::paths::create_project_dir("grant-paper").unwrap();
    crate::secrets::write_ai_secrets(&HashMap::from([(
        "anthropic".to_string(),
        "sk-test-0123456789".to_string(),
    )]))
    .unwrap();
    crate::secrets::write_mcp_server_secrets(&HashMap::from([(
        "5:files:env:TOKEN".to_string(),
        "mcp-env-secret".to_string(),
    )]))
    .unwrap();
    crate::secrets::write_connector_secrets(&HashMap::from([(
        "brave-search".to_string(),
        "oauth-token-0123".to_string(),
    )]))
    .unwrap();
    std::fs::write(
        data.path().join("config.json"),
        json!({
            "mcp_servers": [{"name": "files", "transport": "stdio", "command": "files-mcp", "env": {"TOKEN": "__stored__"}}],
            "research_task_mcp_servers": ["files"],
        })
        .to_string(),
    )
    .unwrap();
    let task = TaskStore::new(data.path().join("research-tasks"))
        .unwrap()
        .create(ResearchTaskDraft {
            project_id: "grant-paper".into(),
            title: "Survey".into(),
            prompt: "Survey the field".into(),
            runtime_id: "builtin".into(),
            agent_id: "anthropic".into(),
            model_id: "claude-fixture".into(),
            keep_running_after_quit: true,
            ..Default::default()
        })
        .unwrap();
    let app = tauri::test::mock_app();
    let grants = AppGrants {
        app: app.handle().clone(),
    };

    let grant = grants.grant(&task, None).await.unwrap();

    assert!(
        grant.allows(TRUST_RESEARCH_TASKS) && grant.allows(TRUST_AGENTS) && grant.allows(TRUST_MCP)
    );
    assert_eq!(
        std::fs::canonicalize(&grant.project_root).unwrap(),
        std::fs::canonicalize(&project).unwrap()
    );
    assert!(!grant.linked && grant.acp.is_none());
    let text = serde_json::to_string(&grant).unwrap();
    for secret in ["sk-test-0123456789", "mcp-env-secret", "oauth-token-0123"] {
        assert!(!text.contains(secret), "the grant holds {secret}");
    }

    // A project that is not trusted gets no grant.
    let _restricted = crate::trust::testing::restrict("grant-paper");
    let error = grants.grant(&task, None).await.unwrap_err();
    assert!(error.contains("trust.research_tasks"), "{error}");
}

#[tokio::test]
async fn an_acp_grant_reuses_the_handed_off_home_or_prepares_a_new_one() {
    let fixture = Fixture::new();
    let task = fixture.queued("Agent task", true);
    let tasks_root = Path::new(r"C:\Users\Zoë Müller\.oleafly\research-tasks");

    assert_eq!(
        grant_home(tasks_root, &task, None),
        acp_home_path(tasks_root, &task.id, task.execution_generation)
    );
    let no_session = SuspendState {
        conversation: Some(CONVERSATION.into()),
        turn_interrupted: true,
        acp: None,
    };
    assert_eq!(
        grant_home(tasks_root, &task, Some(&no_session)),
        acp_home_path(tasks_root, &task.id, task.execution_generation)
    );
    let handed =
        PathBuf::from(r"C:\Users\Zoë Müller\.oleafly\research-tasks\workspaces\task\acp-home-3");
    let suspended = SuspendState {
        conversation: None,
        turn_interrupted: false,
        acp: Some(AcpHandoff {
            agent_session_id: "agent-session".into(),
            home: handed.clone(),
        }),
    };
    assert_eq!(grant_home(tasks_root, &task, Some(&suspended)), handed);
}

// Settings.

#[derive(Clone, Default)]
struct MapRegistry(Arc<Mutex<HashMap<String, String>>>);

impl RunRegistry for MapRegistry {
    fn get(&self, name: &str) -> Option<String> {
        lock(&self.0).get(name).cloned()
    }

    fn set(&self, name: &str, value: &str) -> std::io::Result<()> {
        lock(&self.0).insert(name.into(), value.into());
        Ok(())
    }

    fn delete(&self, name: &str) -> std::io::Result<()> {
        lock(&self.0).remove(name);
        Ok(())
    }
}

#[test]
fn turning_background_tasks_off_removes_the_sign_in_entry_and_stops_the_helper() {
    let _data = DataRoot::new();
    let registry = MapRegistry::default();
    let env = LoginEnv {
        platform: oleafly_cli::app_paths::Platform::Windows,
        home: PathBuf::from(r"C:\Users\Zoë Müller"),
        xdg_config_home: None,
        registry: Some(Box::new(registry.clone())),
    };
    let exec = login_item::login_exec(
        Path::new(r"C:\Users\Zoë Müller\AppData\Local\Oleafly\Oleafly.exe"),
        None,
    );
    assert_eq!(
        login_item::set(&env, &exec, true).unwrap(),
        LoginItemState::Enabled
    );
    crate::config::update_config(|config| {
        config.research_background_at_login = true;
        Ok(())
    })
    .unwrap();
    let helper = FakeHelper::running();

    set_background_enabled(false, Some(&env), &exec, &helper).unwrap();

    assert_eq!(registry.get(login_item::RUN_VALUE_NAME), None);
    assert_eq!(FakeHelper::count(&helper.stop_requests), 1);
    let config = crate::config::read_config().unwrap();
    assert!(!config.research_background_enabled && !config.research_background_at_login);

    // On again: nothing starts and no sign-in entry comes back by itself.
    set_background_enabled(true, Some(&env), &exec, &helper).unwrap();
    assert!(
        crate::config::read_config()
            .unwrap()
            .research_background_enabled
    );
    assert_eq!(registry.get(login_item::RUN_VALUE_NAME), None);
    assert_eq!(FakeHelper::count(&helper.stop_requests), 1);
}

#[test]
fn stopping_the_helper_waits_for_it_and_ends_one_that_stays() {
    let polite = FakeHelper::running();
    polite.stops_on_request.store(true, Ordering::SeqCst);
    assert!(stop_helper(&polite, Duration::from_secs(30)));
    assert_eq!(
        (
            FakeHelper::count(&polite.stop_requests),
            FakeHelper::count(&polite.terminations)
        ),
        (1, 0)
    );

    let stuck = FakeHelper::running();
    assert!(stop_helper(&stuck, Duration::ZERO));
    assert_eq!(
        (
            FakeHelper::count(&stuck.stop_requests),
            FakeHelper::count(&stuck.terminations)
        ),
        (1, 1)
    );

    let idle = FakeHelper::default();
    assert!(stop_helper(&idle, Duration::ZERO));
    assert_eq!(FakeHelper::count(&idle.stop_requests), 0);
}

#[test]
fn update_preparation_stops_the_helper_before_settling_work() {
    let source = include_str!("../research_lifecycle.rs");
    let prepare = &source[source.find("async fn prepare_update").unwrap()..];
    assert!(
        prepare.find("stop_for_update").unwrap()
            < prepare.find("shutdown_work(app, true)").unwrap()
    );
    // The exit path moves tasks before the queue shuts down.
    let work = &source[source.find("async fn shutdown_work").unwrap()..];
    assert!(work.find("hand_off_on_exit").unwrap() < work.find("tasks.shutdown()").unwrap());
}

#[test]
fn a_late_heartbeat_marks_the_helper_as_not_responding() {
    let now = 1_000_000;
    let status = |beat: Option<i64>| HelperStatus {
        heartbeat_at: beat,
        ..FakeHelper::running().status()
    };
    assert!(heartbeat_is_fresh(&status(Some(now - 5_000)), now));
    assert!(!heartbeat_is_fresh(&status(Some(now - 20_000)), now));
    assert!(!heartbeat_is_fresh(&status(None), now));
}

// Usage.

fn spool_event(id: &str, task: Option<&str>, cost: Option<f64>) -> UsageSpoolEvent {
    UsageSpoolEvent {
        id: id.into(),
        source: if task.is_some() {
            "daemon"
        } else {
            "cli-agent"
        }
        .into(),
        task_id: task.map(str::to_owned),
        project_id: Some("paper".into()),
        project_path: None,
        provider: "anthropic".into(),
        model: "claude-fixture".into(),
        input_tokens: Some(1_200),
        output_tokens: Some(300),
        cache_read_tokens: None,
        cache_write_tokens: None,
        cost_usd: cost,
        status: "completed".into(),
        at: now_ms(),
    }
}

#[test]
fn importing_the_usage_spool_twice_records_each_event_once() {
    let data = tempfile::tempdir().unwrap();
    usage_spool::append(
        data.path(),
        &spool_event("daemon-1", Some("task-1"), Some(0.25)),
    )
    .unwrap();
    usage_spool::append(
        data.path(),
        &spool_event("daemon-2", Some("task-1"), Some(0.5)),
    )
    .unwrap();
    let mut ledger = HashSet::new();
    let mut insert =
        |event: &UsageSpoolEvent| -> Result<bool, String> { Ok(ledger.insert(event.id.clone())) };

    assert_eq!(import_usage_spool(data.path(), &mut insert).unwrap(), 2);
    assert_eq!(import_usage_spool(data.path(), &mut insert).unwrap(), 0);

    // An event the ledger could not take is tried again next time.
    usage_spool::append(data.path(), &spool_event("cli-agent-1", None, None)).unwrap();
    let mut locked =
        |_: &UsageSpoolEvent| -> Result<bool, String> { Err("database is locked".into()) };
    assert_eq!(import_usage_spool(data.path(), &mut locked).unwrap(), 0);
    assert_eq!(import_usage_spool(data.path(), &mut insert).unwrap(), 1);
}

#[test]
fn spool_events_become_valid_ledger_rows() {
    let unusual = UsageSpoolEvent {
        provider: String::new(),
        project_id: None,
        status: "unknown".into(),
        input_tokens: None,
        output_tokens: None,
        cost_usd: Some(f64::NAN),
        ..spool_event("cli-agent-2", None, None)
    };
    for event in [
        spool_event("daemon-1", Some("task-1"), Some(0.25)),
        spool_event("cli-agent-1", None, None),
        unusual,
    ] {
        crate::usage_report::validate_usage_event(&ledger_event(&event)).unwrap();
    }
    let row = ledger_event(&spool_event("daemon-1", Some("task-1"), Some(0.25)));
    assert_eq!(row.counter_semantics, "delta");
    assert_eq!(
        (row.estimated_cost_usd, row.price_version.as_deref()),
        (Some(0.25), Some("spool"))
    );
    assert_eq!(
        (row.task_id.as_deref(), row.project_id.as_str()),
        (Some("task-1"), "paper")
    );
}

#[test]
fn the_spool_reaches_the_usage_ledger_once() {
    let data = tempfile::tempdir().unwrap();
    usage_spool::append(
        data.path(),
        &spool_event("daemon-1", Some("task-1"), Some(0.25)),
    )
    .unwrap();
    usage_spool::append(
        data.path(),
        &spool_event("daemon-2", Some("task-1"), Some(0.5)),
    )
    .unwrap();

    assert_eq!(import_spool_into_ledger(data.path()).unwrap(), 2);
    // Read again from scratch, the same events add nothing.
    *lock(&SPOOL_CURSOR) = None;
    assert_eq!(import_spool_into_ledger(data.path()).unwrap(), 0);

    assert_eq!(
        crate::library_db::task_usage_cost(data.path(), "task-1").unwrap(),
        Some(0.75)
    );
}

// Dispatch and installer.

#[test]
fn the_daemon_flag_is_recognised_only_as_its_own_argument() {
    let args = |list: &[&str]| list.iter().map(OsString::from).collect::<Vec<_>>();
    assert!(daemon_requested(args(&["Oleafly", "--oleafly-daemon"])));
    assert!(daemon_requested(args(&[
        r"C:\Users\Zoë Müller\AppData\Local\Oleafly\Oleafly.exe",
        "--oleafly-daemon",
        "--at-login",
    ])));
    assert!(!daemon_requested(args(&["Oleafly"])));
    assert!(!daemon_requested(args(&["--oleafly-daemon"])));
    assert!(!daemon_requested(args(&["Oleafly", "--oleafly-daemon=1"])));
    assert!(!daemon_requested(args(&[
        "Oleafly",
        r"C:\papers\--oleafly-daemon"
    ])));
    assert!(!daemon_requested(args(&[
        "Oleafly",
        "--open-folder",
        "--oleafly-daemon"
    ])));
    assert!(at_login_requested(args(&[
        "Oleafly",
        "--oleafly-daemon",
        "--at-login"
    ])));
    assert!(!at_login_requested(args(&["Oleafly", "--at-login"])));
    // The helper, the sign-in entry and the app agree on the flags.
    assert_eq!(DAEMON_FLAG, oleafly_cli::daemon::client::DAEMON_FLAG);
    assert_eq!(login_item::DAEMON_ARGS, [DAEMON_FLAG, AT_LOGIN_FLAG]);
}

#[test]
fn the_windows_installer_stops_the_helper_and_removes_its_sign_in_entry() {
    let hooks = include_str!("../../windows/hooks.nsh");
    assert!(hooks.contains("!macro NSIS_HOOK_PREINSTALL"));
    assert!(hooks.contains(r"$PROFILE\.oleafly\daemon\stop-request"));
    assert!(hooks.contains(r"$PROFILE\.oleafly\daemon\state.json"));
    assert!(hooks.contains(login_item::RUN_VALUE_NAME));
    assert!(
        hooks.contains("DeleteRegValue HKCU \"Software\\Microsoft\\Windows\\CurrentVersion\\Run\"")
    );
    let uninstall = &hooks[hooks.find("!macro NSIS_HOOK_PREUNINSTALL").unwrap()..];
    assert!(uninstall.contains("!insertmacro OLEAFLY_STOP_BACKGROUND_HELPER"));
}

#[test]
fn helper_texts_match_the_english_catalog() {
    let native: serde_json::Value =
        serde_json::from_str(include_str!("../../../src/i18n/locales/en/native.json")).unwrap();
    for (key, english) in oleafly_cli::daemon::notify::ENGLISH {
        let pointer = format!("/{}", key.replace('.', "/"));
        assert_eq!(
            native.pointer(&pointer).and_then(serde_json::Value::as_str),
            Some(*english),
            "{key}"
        );
    }
}

// Parity: the helper and the headless agent read and name things the way
// the app does.

#[test]
fn cli_provider_config_matches_the_app() {
    let data = DataRoot::new();
    crate::secrets::write_ai_secrets(&HashMap::from([
        ("anthropic".to_string(), "sk-ant-fixture-123456".to_string()),
        ("lab".to_string(), "lab-fixture-key-123456".to_string()),
        (
            "__legacy__".to_string(),
            "legacy-fixture-key-123456".to_string(),
        ),
    ]))
    .unwrap();
    std::fs::write(
        data.path().join("config.json"),
        json!({
            "ai_provider": "lab",
            "ai_model": "lab-large",
            "ai_provider_models": {
                "anthropic": [
                    {"id": "claude-fixture", "name": "Claude fixture", "enabled": true},
                    {"id": "claude-off", "name": "Off", "enabled": false},
                    {"id": " ", "name": "Blank", "enabled": true}
                ],
                "lab": [{"id": "lab-large", "name": "Lab large"}]
            },
            "ai_custom_providers": [
                {"id": "lab", "name": "Lab", "baseURL": "http://127.0.0.1:9/v1", "key_optional": true}
            ]
        })
        .to_string(),
    )
    .unwrap();

    let app = crate::agent::provider_config(&crate::config::read_config().unwrap());
    let cli = oleafly_cli::agent::desktop_config::load(data.path())
        .unwrap()
        .ai;

    assert_eq!((&cli.provider, &cli.model), (&app.provider, &app.model));
    assert_eq!(cli.legacy_key, app.legacy_key);
    assert_eq!(cli.keys, app.keys);
    assert_eq!(cli.enabled_models, app.enabled_models);
    let custom = |config: &oleafly_agent::ProviderConfig| {
        config
            .custom
            .iter()
            .map(|custom| {
                (
                    custom.id.clone(),
                    custom.base_url.clone(),
                    custom.key_optional,
                )
            })
            .collect::<Vec<_>>()
    };
    assert_eq!(custom(&cli), custom(&app));
}

#[test]
fn cli_mcp_hydration_matches_the_app() {
    let data = DataRoot::new();
    let reference = format!("__stored__:v1:{}", "a".repeat(64));
    crate::secrets::write_mcp_server_secrets(&HashMap::from([
        (
            "5:files:env:TOKEN".to_string(),
            "files-token-123456".to_string(),
        ),
        (reference.clone(), "Bearer remote-token-123456".to_string()),
    ]))
    .unwrap();
    std::fs::write(
        data.path().join("config.json"),
        json!({
            "mcp_servers": [
                {"name": "files", "transport": "stdio", "command": "files-mcp", "args": ["--root", "."], "env": {"TOKEN": "__stored__"}},
                {"name": "remote", "transport": "remote", "url": "https://mcp.example.test/mcp", "headers": {"Authorization": reference}},
                {"name": "off", "enabled": false, "transport": "stdio", "command": "off-mcp"}
            ]
        })
        .to_string(),
    )
    .unwrap();

    let app = crate::config::read_config().unwrap();
    let cli = oleafly_cli::agent::desktop_config::load(data.path()).unwrap();

    let app_servers: Vec<(String, BTreeMap<String, String>)> = app
        .mcp_servers
        .iter()
        .filter(|server| server.enabled)
        .map(|server| match &server.transport {
            crate::config::McpServerTransport::Stdio { env, .. } => {
                (server.name.clone(), env.clone())
            }
            crate::config::McpServerTransport::Remote { headers, .. } => {
                (server.name.clone(), headers.clone())
            }
        })
        .collect();
    let cli_servers: Vec<(String, BTreeMap<String, String>)> = cli
        .mcp_servers
        .iter()
        .map(|server| match &server.transport {
            oleafly_cli::agent::desktop_config::McpTransport::Stdio { env, .. } => {
                (server.name.clone(), env.clone())
            }
            oleafly_cli::agent::desktop_config::McpTransport::Remote { headers, .. } => {
                (server.name.clone(), headers.clone())
            }
        })
        .collect();
    assert_eq!(cli_servers, app_servers);
    assert_eq!(cli_servers[0].1["TOKEN"], "files-token-123456");
    assert_eq!(
        cli_servers[1].1["Authorization"],
        "Bearer remote-token-123456"
    );
}

#[test]
fn mcp_tool_names_match() {
    let long_server = "server".repeat(20);
    let long_tool = "tool".repeat(30);
    for (server, tool) in [
        ("files", "read_file"),
        ("Zotero Library", "search-items"),
        ("ünïcödé", "tööl"),
        (long_server.as_str(), long_tool.as_str()),
    ] {
        assert_eq!(
            crate::mcp::client::agent_tool_name(server, tool),
            oleafly_cli::agent::mcp::agent_tool_name(server, tool),
            "{server} {tool}"
        );
    }
}

#[test]
fn acp_event_mapping_matches() {
    let updates = [
        (
            "agent_message_chunk",
            json!({"content": {"type": "text", "text": "Found three papers."}}),
        ),
        (
            "agent_thought_chunk",
            json!({"content": {"type": "text", "text": "Check the dates."}}),
        ),
        (
            "tool_call",
            json!({"toolCallId": "call-1", "title": "Read paper.tex", "kind": "read", "status": "pending", "content": []}),
        ),
        (
            "tool_call_update",
            json!({"toolCallId": "call-1", "status": "completed", "content": [{"type": "content", "content": {"type": "text", "text": "ok"}}]}),
        ),
        (
            "tool_call_update",
            json!({"toolCallId": "call-2", "status": "failed"}),
        ),
        (
            "usage",
            json!({"inputTokens": 1200, "outputTokens": 300, "source": "acp_prompt"}),
        ),
        ("usage", json!({"inputTokens": 99, "source": "acp_context"})),
        ("plan", json!({"entries": []})),
    ];
    let mut app_outcome = outcome();
    let mut cli_outcome = outcome();
    for (sequence, (kind, data)) in updates.into_iter().enumerate() {
        let event: crate::acp::AcpEvent = serde_json::from_value(json!({
            "sessionId": "session",
            "projectId": "paper",
            "agentId": "claude",
            "sequence": sequence,
            "timestamp": 1,
            "kind": kind,
            "data": data,
        }))
        .unwrap();
        let app = crate::agent::task_runtime::acp_event(&event, &mut app_outcome);
        let cli = oleafly_cli::daemon::acp_task::map_update(kind, &data, &mut cli_outcome);
        assert_eq!(app, cli, "{kind}");
    }
    assert_eq!(app_outcome, cli_outcome);
}

#[test]
fn search_key_order_matches() {
    let cases: [&[(&str, &str)]; 5] = [
        &[],
        &[("serper", "serper-key"), ("tavily", "tavily-key")],
        &[("brave-search", "   "), ("serper", "serper-key")],
        &[("brave-search", " brave-key "), ("tavily", "tavily-key")],
        &[("openalex-api-key", "other-key")],
    ];
    for case in cases {
        let app: HashMap<String, String> = case
            .iter()
            .map(|(name, value)| (name.to_string(), value.to_string()))
            .collect();
        let cli: BTreeMap<String, Zeroizing<String>> = case
            .iter()
            .map(|(name, value)| (name.to_string(), Zeroizing::new(value.to_string())))
            .collect();
        assert_eq!(
            crate::agent::web::search_key_from(&app),
            oleafly_cli::agent::desktop_config::search_key_from(&cli),
            "{case:?}"
        );
    }
}
