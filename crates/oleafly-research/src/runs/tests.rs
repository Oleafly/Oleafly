use std::collections::BTreeMap;
#[cfg(any(target_os = "macos", target_os = "linux"))]
use std::path::Path;
use std::path::PathBuf;
use std::sync::Arc;
#[cfg(any(target_os = "macos", target_os = "linux"))]
use std::time::Duration;

use super::*;
use crate::model::ResearchTask;
#[cfg(any(target_os = "macos", target_os = "linux"))]
use crate::model::RunState;
use crate::store::TaskStore;

#[test]
fn run_cwd_must_be_a_portable_relative_path() {
    for bad in [
        r"C:\data",
        r"..\x",
        r"\\?\C:\x",
        r"\\server\share",
        "a/../b",
        "/abs",
        "a\\b",
    ] {
        assert!(validate_cwd_rel(bad).is_err(), "{bad}");
    }
    assert_eq!(validate_cwd_rel("analysis/sub").unwrap(), "analysis/sub");
    assert_eq!(validate_cwd_rel("analysis/").unwrap(), "analysis");
    assert_eq!(validate_cwd_rel("").unwrap(), "");
}

#[test]
fn run_env_rejects_reserved_and_loader_variables() {
    for name in [
        "PATH",
        "HOME",
        "LD_PRELOAD",
        "DYLD_INSERT_LIBRARIES",
        "1BAD",
    ] {
        let env = BTreeMap::from([(name.to_owned(), "x".to_owned())]);
        assert!(validate_run_env(&env).is_err(), "{name}");
    }
    let many: BTreeMap<String, String> = (0..33)
        .map(|index| (format!("V{index}"), "1".to_owned()))
        .collect();
    assert!(validate_run_env(&many).is_err());
    let fine = BTreeMap::from([("WANDB_MODE".to_owned(), "offline".to_owned())]);
    assert!(validate_run_env(&fine).is_ok());
}

#[test]
fn metrics_parse_json_key_value_and_colon_lines() {
    assert_eq!(
        parse_metrics_line(r#"{"loss": 0.5, "acc": 0.9, "tag": "x", "nested": {"a": 1}}"#),
        vec![("acc".into(), 0.9), ("loss".into(), 0.5)]
    );
    assert_eq!(
        parse_metrics_line("step=10 loss=0.25,lr=3e-4"),
        vec![
            ("step".into(), 10.0),
            ("loss".into(), 0.25),
            ("lr".into(), 3e-4)
        ]
    );
    assert_eq!(
        parse_metrics_line("val_loss: 1.25\r"),
        vec![("val_loss".into(), 1.25)]
    );
    assert!(parse_metrics_line("Epoch 3: training…").is_empty());
    assert!(parse_metrics_line("loss=nan").is_empty());
}

#[test]
fn run_ids_count_up_per_task() {
    assert_eq!(next_run_id(0), "r001");
    assert_eq!(next_run_id(999), "r1000");
}

#[test]
fn log_tail_reads_from_the_end_of_a_large_file_with_crlf() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("stdout.log");
    let text: String = (0..400_000)
        .map(|index| format!("line {index}\r\n"))
        .collect();
    std::fs::write(&path, text).unwrap();
    assert_eq!(
        log::tail(&path, 3).unwrap(),
        "line 399997\nline 399998\nline 399999\n"
    );
    assert_eq!(log::tail(&dir.path().join("missing.log"), 3).unwrap(), "");
}

#[test]
fn log_grep_is_bounded() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("stdout.log");
    let text: String = (0..10_000)
        .map(|index| format!("match {index} {}\n", "x".repeat(900)))
        .collect();
    std::fs::write(&path, text).unwrap();
    let found = log::grep(&path, "match", 200).unwrap();
    let lines: Vec<&str> = found.lines().collect();
    assert!(lines.len() <= 200 && !lines.is_empty());
    assert!(lines[0].starts_with("1: match 0 "));
    assert!(lines.iter().all(|line| line.chars().count() <= 510));
    assert!(log::grep(&path, "", 5).is_err());
}

#[test]
fn log_grep_does_not_hold_a_huge_line_in_memory() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("stdout.log");
    // The middle line is a progress bar of 300 KiB that never ends its line.
    let text = format!("match one\n{}\nmatch two\n", "x".repeat(300 * 1024));
    std::fs::write(&path, text).unwrap();
    assert_eq!(
        log::grep(&path, "match", 10).unwrap(),
        "1: match one\n3: match two\n"
    );
}

#[test]
fn supervisor_flags_request_breakaway_only_when_asked() {
    #[cfg(windows)]
    {
        assert_eq!(supervisor_creation_flags(true) & 0x0100_0000, 0x0100_0000);
        assert_eq!(supervisor_creation_flags(false) & 0x0100_0000, 0);
    }
    #[cfg(not(windows))]
    assert_eq!(supervisor_creation_flags(true), 0);
}

#[test]
fn a_newer_handle_is_refused() {
    let json = r#"{"version":9,"executor":"ssh","taskId":"t","runId":"r001","runDir":"/x","startedAt":1,"data":{}}"#;
    assert!(RunHandle::parse(json)
        .unwrap_err()
        .contains("newer version"));
}

struct Fixture {
    _temp: tempfile::TempDir,
    root: PathBuf,
    workspace: PathBuf,
    task: ResearchTask,
}

fn fixture() -> Fixture {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("tasks");
    let workspace = temp.path().join("workspace");
    std::fs::create_dir_all(workspace.join("analysis")).unwrap();
    let store = TaskStore::new(root.clone()).unwrap();
    let task = store
        .create(crate::test_support::draft("paper", "Runs"))
        .unwrap();
    store.request_start(&task.id).unwrap();
    let task = store.claim_next().unwrap().unwrap();
    Fixture {
        _temp: temp,
        root,
        workspace,
        task,
    }
}

fn manager(fixture: &Fixture) -> Arc<RunManager> {
    let manager = RunManager::new(fixture.root.clone(), tokio::runtime::Handle::current());
    manager.register_executor(Arc::new(LocalExecutor::in_process()));
    manager
}

fn request(fixture: &Fixture, command: &str) -> StartRun {
    StartRun {
        task: fixture.task.clone(),
        execution_root: fixture.workspace.clone(),
        allowed_paths: vec!["analysis".into()],
        read_paths: Vec::new(),
        linked: Vec::new(),
        search_dirs: Vec::new(),
        project_root: None,
        name: "baseline".into(),
        command: command.into(),
        cwd_rel: None,
        env: BTreeMap::new(),
        timeout_minutes: None,
    }
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
fn sandbox_ready() -> bool {
    matches!(
        oleafly_sandbox::availability(),
        oleafly_sandbox::Availability::Available
    )
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
async fn finished(manager: &RunManager, task: &str, run: &str) -> crate::model::RunRecord {
    for _ in 0..200 {
        let record = manager
            .list(task)
            .unwrap()
            .into_iter()
            .find(|record| record.run_id == run)
            .unwrap();
        if record.state.is_terminal() {
            return record;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    panic!("run {run} did not finish");
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
#[tokio::test(flavor = "multi_thread")]
async fn a_local_run_records_logs_metrics_and_exit_code() {
    if !sandbox_ready() {
        return;
    }
    let fixture = fixture();
    let manager = manager(&fixture);
    let record = manager
        .start(request(&fixture, "printf 'loss=0.5\\n'; echo done; exit 3"))
        .await
        .unwrap();
    assert_eq!(record.state, RunState::Starting);
    let done = finished(&manager, &fixture.task.id, &record.run_id).await;
    assert_eq!(done.state, RunState::Failed);
    assert_eq!(done.exit_code, Some(3));
    assert_eq!(done.metrics, BTreeMap::from([("loss".to_owned(), 0.5)]));
    let log = std::fs::read_to_string(Path::new(&done.run_dir).join("stdout.log")).unwrap();
    assert!(log.contains("done"));
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
#[tokio::test(flavor = "multi_thread")]
async fn cancelling_a_run_stops_its_process_group() {
    if !sandbox_ready() {
        return;
    }
    let fixture = fixture();
    let manager = manager(&fixture);
    let record = manager
        .start(request(&fixture, "sleep 60 & wait"))
        .await
        .unwrap();
    for _ in 0..100 {
        if manager
            .cancel(&fixture.task.id, &record.run_id)
            .await
            .is_ok()
        {
            break;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    let started = std::time::Instant::now();
    let done = finished(&manager, &fixture.task.id, &record.run_id).await;
    assert_eq!(done.state, RunState::Cancelled);
    assert!(started.elapsed() < Duration::from_secs(7));
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
#[test]
fn a_timeout_stops_the_run() {
    if !sandbox_ready() {
        return;
    }
    let fixture = fixture();
    let run_dir = fixture
        .root
        .join("runs")
        .join(&fixture.task.id)
        .join("r001");
    std::fs::create_dir_all(run_dir.join("home")).unwrap();
    let sandbox = crate::task_tools::task_sandbox_spec(
        &fixture.workspace,
        &["analysis".to_owned()],
        &run_dir.join("home"),
        false,
        &[],
    )
    .unwrap();
    let spec = RunSpec {
        task_id: fixture.task.id.clone(),
        run_id: "r001".into(),
        command: "sleep 30".into(),
        cwd_rel: String::new(),
        env: BTreeMap::new(),
        timeout: Duration::from_secs(1),
        profile: crate::RunProfile::Analysis,
        workspace: fixture.workspace.clone(),
        resources: None,
        target: None,
        run_dir: run_dir.clone(),
        network: false,
        sandbox: Some(sandbox),
    };
    std::fs::write(
        run_dir.join("spec.json"),
        serde_json::to_vec(&spec).unwrap(),
    )
    .unwrap();
    assert_eq!(supervisor::run_supervisor(&run_dir), 0);
    let status = supervisor::read_status(&run_dir).unwrap();
    assert_eq!(status.outcome, Some(RunOutcomeKind::TimedOut));
}

#[tokio::test]
async fn a_dead_supervisor_without_an_exit_code_is_lost() {
    let dir = tempfile::tempdir().unwrap();
    let handle = RunHandle {
        version: HANDLE_VERSION,
        executor: "local".into(),
        task_id: "t".into(),
        run_id: "r001".into(),
        run_dir: dir.path().to_path_buf(),
        started_at: 1,
        data: serde_json::json!({"supervisorPid": u32::MAX - 3, "supervisorStarted": 1}),
    };
    let status = LocalExecutor::in_process().poll(&handle).await.unwrap();
    assert_eq!(
        status,
        RunStatus::Lost {
            reason: "The run stopped without recording an exit code.".into()
        }
    );
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
#[tokio::test(flavor = "multi_thread")]
async fn runs_outlive_the_manager_and_reattach() {
    if !sandbox_ready() {
        return;
    }
    let fixture = fixture();
    let first = manager(&fixture);
    let record = first
        .start(request(&fixture, "sleep 1; echo late"))
        .await
        .unwrap();
    tokio::time::sleep(Duration::from_millis(200)).await;
    drop(first);
    let second = manager(&fixture);
    let mut completions = second.subscribe();
    second.reattach();
    let completion = tokio::time::timeout(Duration::from_secs(10), completions.recv())
        .await
        .unwrap()
        .unwrap();
    assert_eq!(completion.run_id, record.run_id);
    assert_eq!(
        finished(&second, &fixture.task.id, &record.run_id)
            .await
            .state,
        RunState::Succeeded
    );
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
#[tokio::test(flavor = "multi_thread")]
async fn wait_returns_at_the_first_completion_and_reports_each_run_once() {
    if !sandbox_ready() {
        return;
    }
    let fixture = fixture();
    let manager = manager(&fixture);
    let quick = manager
        .start(request(&fixture, "echo quick"))
        .await
        .unwrap();
    let mut slow_request = request(&fixture, "sleep 1; echo slow");
    slow_request.name = "slow".into();
    let slow = manager.start(slow_request).await.unwrap();
    let cancel = oleafly_agent::CancellationToken::new();
    let first = manager
        .wait(&fixture.task.id, None, WAIT_DEFAULT, &cancel)
        .await
        .unwrap();
    assert_eq!(first.finished.len(), 1);
    assert_eq!(first.finished[0].run_id, quick.run_id);
    assert!(first.finished[0].log_tail.contains("quick"));
    let second = manager
        .wait(&fixture.task.id, None, WAIT_DEFAULT, &cancel)
        .await
        .unwrap();
    assert_eq!(second.finished[0].run_id, slow.run_id);
    let third = manager
        .wait(&fixture.task.id, None, WAIT_DEFAULT, &cancel)
        .await
        .unwrap();
    assert!(third.finished.is_empty());
    assert_eq!(third.note.as_deref(), Some("No runs are in flight."));
}

// A local run has to start, which needs the macOS or Linux sandbox.
#[cfg(any(target_os = "macos", target_os = "linux"))]
#[tokio::test]
async fn start_run_never_records_env_values() {
    let fixture = fixture();
    let manager = manager(&fixture);
    let seen = Arc::new(std::sync::Mutex::new(Vec::new()));
    let sink_seen = seen.clone();
    manager.attach_sink(
        &fixture.task.id,
        fixture.task.execution_generation,
        Arc::new(move |event| {
            sink_seen
                .lock()
                .unwrap()
                .push(serde_json::to_string(&event).unwrap())
        }),
    );
    let mut with_secret = request(&fixture, "python train.py");
    with_secret.env = BTreeMap::from([("API_TOKEN".to_owned(), "s3cret".to_owned())]);
    let record = manager.start(with_secret).await.unwrap();
    assert!(!serde_json::to_string(&record).unwrap().contains("s3cret"));
    let stored = TaskStore::new(fixture.root.clone())
        .unwrap()
        .runs(&fixture.task.id)
        .unwrap();
    assert!(!serde_json::to_string(&stored).unwrap().contains("s3cret"));
    assert!(seen
        .lock()
        .unwrap()
        .iter()
        .all(|event| !event.contains("s3cret")));
    assert!(!seen.lock().unwrap().is_empty());
}

#[tokio::test]
async fn run_limits_and_policies_are_enforced_before_starting() {
    let fixture = fixture();
    let manager = manager(&fixture);
    let mut off = request(&fixture, "echo");
    off.task.brief.permissions.commands = crate::model::CommandPolicy::Off;
    assert_eq!(
        manager.start(off).await.unwrap_err(),
        "Commands are turned off for this task."
    );
    let mut remote = request(&fixture, "echo");
    remote.task.brief.compute.executor = "slurm".into();
    assert_eq!(
        manager.start(remote).await.unwrap_err(),
        "The slurm compute target isn't available."
    );
    let mut long = request(&fixture, "echo");
    long.timeout_minutes = Some(61);
    assert_eq!(
        manager.start(long).await.unwrap_err(),
        "Runs in this task can last up to 60 minutes."
    );
}

// The Windows sandbox is a beta that starts off, so a local run is refused
// before it starts, with the setting that turns it on.
#[cfg(windows)]
#[tokio::test]
async fn local_runs_say_the_windows_sandbox_is_missing() {
    let fixture = fixture();
    let manager = manager(&fixture);
    let error = manager
        .start(request(&fixture, "echo hi"))
        .await
        .unwrap_err();
    assert_eq!(error, super::remote::settings::WINDOWS_SWITCH_MESSAGE);
}

/// An executor the test controls: its start waits for a permit, and it
/// remembers what it was asked to stop, clear or poll.
#[derive(Clone)]
struct Controlled {
    entered: Arc<tokio::sync::Notify>,
    release: Arc<tokio::sync::Semaphore>,
    fail_start: bool,
    /// Run ids whose poll never answers.
    stuck: Arc<Vec<&'static str>>,
    calls: Arc<std::sync::Mutex<Vec<String>>>,
}

impl Controlled {
    fn new(fail_start: bool, stuck: Vec<&'static str>) -> Self {
        Self {
            entered: Arc::new(tokio::sync::Notify::new()),
            release: Arc::new(tokio::sync::Semaphore::new(0)),
            fail_start,
            stuck: Arc::new(stuck),
            calls: Arc::new(std::sync::Mutex::new(Vec::new())),
        }
    }

    fn calls(&self) -> Vec<String> {
        self.calls.lock().unwrap().clone()
    }

    fn note(&self, call: &str) {
        self.calls.lock().unwrap().push(call.to_owned());
    }

    async fn calls_become(&self, expected: &[&str]) {
        tokio::time::timeout(Duration::from_secs(10), async {
            while self.calls() != expected {
                tokio::time::sleep(Duration::from_millis(20)).await;
            }
        })
        .await
        .unwrap_or_else(|_| {
            panic!(
                "the executor was asked {:?}, not {expected:?}",
                self.calls()
            )
        });
    }
}

#[async_trait::async_trait]
impl RunExecutor for Controlled {
    fn id(&self) -> &'static str {
        "controlled"
    }

    async fn start(&self, spec: &RunSpec) -> Result<RunHandle, RunError> {
        let handle = RunHandle {
            version: HANDLE_VERSION,
            executor: self.id().into(),
            task_id: spec.task_id.clone(),
            run_id: spec.run_id.clone(),
            run_dir: spec.run_dir.clone(),
            started_at: crate::model::now_ms(),
            data: serde_json::json!({}),
        };
        // Like the remote executors: written before anything changes remotely.
        std::fs::write(
            spec.run_dir.join("handle.json"),
            serde_json::to_vec(&handle).unwrap(),
        )
        .unwrap();
        self.entered.notify_one();
        self.release.acquire().await.unwrap().forget();
        if self.fail_start {
            return Err(RunError::Network("The connection dropped.".into()));
        }
        Ok(handle)
    }

    async fn poll(&self, handle: &RunHandle) -> Result<RunStatus, RunError> {
        if self.stuck.contains(&handle.run_id.as_str()) {
            std::future::pending::<()>().await;
        }
        Ok(RunStatus::Finished {
            exit_code: Some(0),
            finished_at: crate::model::now_ms(),
            outcome: RunOutcomeKind::Succeeded,
            note: None,
        })
    }

    async fn read_log(&self, _handle: &RunHandle, _query: LogQuery) -> Result<String, RunError> {
        Ok(String::new())
    }

    async fn cancel(&self, _handle: &RunHandle) -> Result<(), RunError> {
        self.note("cancel");
        Ok(())
    }

    async fn cleanup(&self, _handle: &RunHandle) -> Result<(), RunError> {
        self.note("cleanup");
        Ok(())
    }

    async fn discard(&self, _handle: &RunHandle) -> Result<(), RunError> {
        self.note("discard");
        Ok(())
    }
}

fn controlled_request(fixture: &Fixture, name: &str) -> StartRun {
    let mut start = request(fixture, "python train.py");
    start.name = name.into();
    start.task.brief.compute.executor = "controlled".into();
    start
}

fn run_state(manager: &RunManager, task: &str, run: &str) -> crate::model::RunState {
    manager
        .list(task)
        .unwrap()
        .into_iter()
        .find(|record| record.run_id == run)
        .unwrap()
        .state
}

async fn run_becomes(manager: &RunManager, task: &str, run: &str, state: crate::model::RunState) {
    tokio::time::timeout(Duration::from_secs(10), async {
        while run_state(manager, task, run) != state {
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    })
    .await
    .unwrap_or_else(|_| {
        panic!(
            "run {run} is {:?}, not {state:?}",
            run_state(manager, task, run)
        )
    });
}

#[tokio::test(flavor = "multi_thread")]
async fn cancelling_a_run_that_is_still_starting_stops_it_once_it_has_a_handle() {
    let fixture = fixture();
    let manager = RunManager::new(fixture.root.clone(), tokio::runtime::Handle::current());
    let executor = Controlled::new(false, Vec::new());
    manager.register_executor(Arc::new(executor.clone()));
    let record = manager
        .start(controlled_request(&fixture, "baseline"))
        .await
        .unwrap();
    executor.entered.notified().await;

    // The upload is under way, so there is no handle to stop yet: the cancel
    // is recorded at once instead of failing.
    manager
        .cancel(&fixture.task.id, &record.run_id)
        .await
        .unwrap();
    assert_eq!(
        run_state(&manager, &fixture.task.id, &record.run_id),
        crate::model::RunState::Cancelled
    );
    assert!(executor.calls().is_empty());

    // The start ends with a handle, and the run is stopped there and then.
    executor.release.add_permits(1);
    executor.calls_become(&["cancel"]).await;
    assert_eq!(
        run_state(&manager, &fixture.task.id, &record.run_id),
        crate::model::RunState::Cancelled
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn ending_a_task_cancels_its_runs_that_are_still_starting() {
    let fixture = fixture();
    let manager = RunManager::new(fixture.root.clone(), tokio::runtime::Handle::current());
    let executor = Controlled::new(false, Vec::new());
    manager.register_executor(Arc::new(executor.clone()));
    let record = manager
        .start(controlled_request(&fixture, "baseline"))
        .await
        .unwrap();
    executor.entered.notified().await;

    manager.cancel_all(&fixture.task.id).await;
    assert!(manager.in_flight(&fixture.task.id).unwrap().is_empty());
    executor.release.add_permits(1);
    executor.calls_become(&["cancel"]).await;
    assert_eq!(
        run_state(&manager, &fixture.task.id, &record.run_id),
        crate::model::RunState::Cancelled
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn a_failed_start_stops_and_clears_what_it_left_remotely() {
    let fixture = fixture();
    let manager = RunManager::new(fixture.root.clone(), tokio::runtime::Handle::current());
    let executor = Controlled::new(true, Vec::new());
    manager.register_executor(Arc::new(executor.clone()));
    let record = manager
        .start(controlled_request(&fixture, "baseline"))
        .await
        .unwrap();
    executor.entered.notified().await;
    executor.release.add_permits(1);

    run_becomes(
        &manager,
        &fixture.task.id,
        &record.run_id,
        crate::model::RunState::Failed,
    )
    .await;
    // The job may be running although its answer was lost: it is stopped and
    // its folder removed (never the per-task Space the other runs share).
    executor.calls_become(&["cancel", "discard"]).await;
}

#[tokio::test(flavor = "multi_thread")]
async fn a_run_that_never_answers_holds_up_only_itself() {
    let fixture = fixture();
    let manager = RunManager::new(fixture.root.clone(), tokio::runtime::Handle::current());
    let executor = Controlled::new(false, vec!["r001"]);
    executor.release.add_permits(2);
    manager.register_executor(Arc::new(executor.clone()));
    let stuck = manager
        .start(controlled_request(&fixture, "stuck"))
        .await
        .unwrap();
    let quick = manager
        .start(controlled_request(&fixture, "quick"))
        .await
        .unwrap();
    assert_eq!(
        (stuck.run_id.as_str(), quick.run_id.as_str()),
        ("r001", "r002")
    );

    // The first run's poll never returns; the second still gets recorded.
    run_becomes(
        &manager,
        &fixture.task.id,
        &quick.run_id,
        crate::model::RunState::Succeeded,
    )
    .await;
    assert_eq!(
        run_state(&manager, &fixture.task.id, &stuck.run_id),
        crate::model::RunState::Running
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn deleting_a_task_cleans_what_its_runs_left_elsewhere() {
    let fixture = fixture();
    let manager = RunManager::new(fixture.root.clone(), tokio::runtime::Handle::current());
    let executor = Controlled::new(false, vec!["r001"]);
    executor.release.add_permits(1);
    manager.register_executor(Arc::new(executor.clone()));
    manager
        .start(controlled_request(&fixture, "baseline"))
        .await
        .unwrap();
    run_becomes(
        &manager,
        &fixture.task.id,
        "r001",
        crate::model::RunState::Running,
    )
    .await;

    // The rows go with the task, so the leftovers are read first.
    let leftovers = manager.cleanup_handles(&fixture.task.id);
    assert_eq!(leftovers.len(), 1);
    let store = TaskStore::new(fixture.root.clone()).unwrap();
    store
        .finish_failure(
            &fixture.task.id,
            fixture.task.execution_generation,
            "Stopped.",
        )
        .unwrap();
    store.delete(&fixture.task.id).unwrap();
    assert!(manager.cleanup_handles(&fixture.task.id).is_empty());
    manager.cleanup_task(&fixture.task.id, leftovers).await;
    // A run that was still going is stopped before its folder is removed.
    assert_eq!(executor.calls(), vec!["cancel", "cleanup"]);
}
