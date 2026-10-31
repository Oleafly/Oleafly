#[allow(dead_code)]
mod support;

#[path = "support/mock_provider.rs"]
mod mock_provider;

use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Output, Stdio};
use std::time::{Duration, Instant};

use oleafly_cli::daemon::state::{
    read_state, write_state, HelperState, Phase, ServeMode, STATE_VERSION,
};
use oleafly_sandbox::process::identity::{probe, ProcessProbe};
use serde_json::Value;

struct Guard(Child);

impl Drop for Guard {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

fn oleafly(data: &Path, arguments: &[&str]) -> Command {
    let mut command = Command::new(env!("CARGO_BIN_EXE_oleaflyc"));
    command
        .args(arguments)
        .env("OLEAFLY_DATA_DIR", data)
        .env("OLEAFLY_APP", data.join("no-app"));
    command
}

fn json(output: &Output) -> Value {
    let stdout = String::from_utf8_lossy(&output.stdout);
    let last = stdout
        .lines()
        .rfind(|line| !line.trim().is_empty())
        .unwrap_or_default();
    serde_json::from_str(last).unwrap_or_else(|_| panic!("not JSON: {stdout}"))
}

fn wait_for(what: &str, timeout: Duration, mut check: impl FnMut() -> bool) {
    let deadline = Instant::now() + timeout;
    while !check() {
        assert!(Instant::now() < deadline, "timed out waiting for {what}");
        std::thread::sleep(Duration::from_millis(50));
    }
}

fn state_path(data: &Path) -> PathBuf {
    data.join("daemon").join("state.json")
}

fn hold_the_lock(data: &Path, bin: &Path) -> Guard {
    let holder = support::rust_fixture(bin, "lock_holder.rs", "lock-holder", None);
    let mut child = Command::new(holder)
        .arg(data.join("daemon").join("daemon.lock"))
        .stdout(Stdio::piped())
        .spawn()
        .unwrap();
    let mut line = String::new();
    BufReader::new(child.stdout.take().unwrap())
        .read_line(&mut line)
        .unwrap();
    assert_eq!(line.trim(), "locked");
    Guard(child)
}

#[test]
fn daemon_help_lists_its_commands_and_never_the_app_flag() {
    let output = Command::new(env!("CARGO_BIN_EXE_oleaflyc"))
        .args(["daemon", "--help"])
        .output()
        .unwrap();
    let help = String::from_utf8_lossy(&output.stdout);
    for command in ["run", "status", "stop"] {
        assert!(help.contains(command), "{command}");
    }
    assert!(!help.contains("--oleafly-daemon"));
}

#[test]
fn status_and_stop_round_trip_a_foreground_helper() {
    let data = tempfile::tempdir().unwrap();
    let mut helper = Guard(
        oleafly(data.path(), &["daemon", "run", "--stay"])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .unwrap(),
    );
    let pid = helper.0.id();
    wait_for("the helper to be ready", Duration::from_secs(30), || {
        read_state(&state_path(data.path()))
            .is_some_and(|state| state.phase == Phase::Ready && state.pid == pid)
    });
    let status = json(
        &oleafly(data.path(), &["--json", "daemon", "status"])
            .output()
            .unwrap(),
    );
    assert_eq!(status["daemon"]["running"], true);
    assert_eq!(status["daemon"]["pid"], pid);
    assert_eq!(status["daemon"]["mode"], "foreground");
    let stop = oleafly(data.path(), &["--json", "daemon", "stop", "--wait", "30"])
        .output()
        .unwrap();
    assert_eq!(
        stop.status.code(),
        Some(0),
        "{}",
        String::from_utf8_lossy(&stop.stdout)
    );
    assert_eq!(json(&stop)["daemon"]["stopped"], true);
    let exit = helper.0.wait().unwrap();
    assert_eq!(exit.code(), Some(0));
    assert!(!state_path(data.path()).exists());
    let after = json(
        &oleafly(data.path(), &["--json", "daemon", "status"])
            .output()
            .unwrap(),
    );
    assert_eq!(after["daemon"]["running"], false);
}

#[test]
fn stop_force_ends_a_helper_that_ignores_stop_requests() {
    let data = tempfile::tempdir().unwrap();
    let bin = tempfile::tempdir().unwrap();
    let mut holder = hold_the_lock(data.path(), bin.path());
    let pid = holder.0.id();
    let started = match probe(pid) {
        ProcessProbe::Running { started } => started,
        ProcessProbe::Gone => None,
    };
    write_state(
        &state_path(data.path()),
        &HelperState {
            version: STATE_VERSION,
            pid,
            started,
            app_version: "0.4.8".into(),
            mode: ServeMode::App,
            phase: Phase::Ready,
            started_at: 0,
            heartbeat_at: 0,
        },
    )
    .unwrap();
    let refused = oleafly(data.path(), &["--json", "daemon", "stop", "--wait", "1"])
        .output()
        .unwrap();
    assert_eq!(refused.status.code(), Some(8));
    assert_eq!(json(&refused)["error"]["code"], "daemon.still_running");
    let forced = oleafly(
        data.path(),
        &["--json", "daemon", "stop", "--wait", "1", "--force"],
    )
    .output()
    .unwrap();
    assert_eq!(
        forced.status.code(),
        Some(0),
        "{}",
        String::from_utf8_lossy(&forced.stdout)
    );
    let ended = holder.0.wait().unwrap();
    assert!(!ended.success());
}

#[test]
fn run_refuses_when_another_helper_holds_the_lock() {
    let data = tempfile::tempdir().unwrap();
    let bin = tempfile::tempdir().unwrap();
    let _holder = hold_the_lock(data.path(), bin.path());
    let output = oleafly(data.path(), &["--json", "daemon", "run"])
        .output()
        .unwrap();
    assert_eq!(output.status.code(), Some(8));
    assert_eq!(json(&output)["error"]["code"], "daemon.already_running");
}

#[cfg(unix)]
#[test]
fn a_terminate_signal_keeps_tasks_for_the_next_helper() {
    use oleafly_research::handoff::{
        HandoffReason, HandoffRecord, TaskGrant, TRUST_MCP, TRUST_RESEARCH_TASKS,
    };
    use oleafly_research::host::OwnerKind;
    use oleafly_research::model::{
        PendingStart, ResearchTaskDraft, ResearchTaskStatus, ResumeReason,
    };
    use oleafly_research::store::TaskStore;

    let mock = mock_provider::MockProvider::script(vec![mock_provider::Step::Stall]);
    let data = tempfile::tempdir().unwrap();
    let project = tempfile::tempdir().unwrap();
    std::fs::write(
        project.path().join("main.tex"),
        "\\documentclass{article}\\begin{document}x\\end{document}\n",
    )
    .unwrap();
    let config = serde_json::json!({
        "ai_custom_providers": [{"id": "mock", "baseURL": mock.base_url(), "key_optional": true}],
        "ai_provider_models": {"mock": [{"id": "mock-model", "enabled": true}]},
        "research_notifications": false,
        "research_keep_awake": false,
    });
    std::fs::write(data.path().join("config.json"), config.to_string()).unwrap();
    let app = TaskStore::new(data.path().join("research-tasks")).unwrap();
    let task = app
        .create(ResearchTaskDraft {
            project_id: "paper".into(),
            title: "Survey".into(),
            prompt: "Survey the field".into(),
            runtime_id: "builtin".into(),
            agent_id: "mock".into(),
            model_id: "mock-model".into(),
            keep_running_after_quit: true,
            ..Default::default()
        })
        .unwrap();
    app.request_start(&task.id).unwrap();
    let running = app.claim_next().unwrap().unwrap();
    let mut record = HandoffRecord::new(
        OwnerKind::App,
        OwnerKind::Daemon,
        HandoffReason::Quit,
        running.execution_generation,
    );
    record.grant = Some(TaskGrant {
        project_root: dunce::canonicalize(project.path())
            .unwrap()
            .to_string_lossy()
            .into_owned(),
        capabilities: vec![TRUST_RESEARCH_TASKS.into(), TRUST_MCP.into()],
        ..TaskGrant::default()
    });
    assert!(app
        .hand_off_with(
            &running.id,
            running.execution_generation,
            OwnerKind::Daemon,
            &record
        )
        .unwrap());

    let mut helper = Guard(
        oleafly(data.path(), &["daemon", "run", "--stay"])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .unwrap(),
    );
    wait_for(
        "the task to reach the provider",
        Duration::from_secs(60),
        || !mock.requests().is_empty(),
    );
    unsafe {
        libc::kill(helper.0.id() as i32, libc::SIGTERM);
    }
    let exit = helper.0.wait().unwrap();
    assert_eq!(exit.code(), Some(0));
    let task = app.require(&running.id).unwrap();
    assert_eq!(task.owner, OwnerKind::Daemon);
    assert_eq!(task.status, ResearchTaskStatus::Queued);
    assert!(matches!(
        task.pending_start,
        Some(PendingStart::Resume {
            reason: ResumeReason::Handoff,
            ..
        })
    ));
    assert_eq!(
        app.handoff_record(&running.id).unwrap().unwrap().reason,
        HandoffReason::Signal
    );
}
