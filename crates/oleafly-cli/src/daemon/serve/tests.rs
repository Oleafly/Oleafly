use std::path::Path;
use std::time::{Duration, Instant};

use oleafly_research::model::{ManifestEntry, ResearchTaskDraft, TaskIsolation, TaskIsolationKind};
use oleafly_sandbox::process::identity::ProcessIdentity;

use super::*;
use crate::daemon::client;
use crate::daemon::state::read_state;

fn options(data_root: &Path, stay: bool, idle_grace: Duration) -> ServeOptions {
    ServeOptions {
        mode: ServeMode::Foreground,
        data_root: data_root.to_path_buf(),
        exe: std::env::current_exe().unwrap(),
        resources_dir: None,
        app_launch: None,
        localize: None,
        stay,
        log_to_stderr: false,
        idle_grace,
    }
}

fn draft(title: &str, run_after: Option<i64>) -> ResearchTaskDraft {
    ResearchTaskDraft {
        project_id: "paper".into(),
        title: title.into(),
        prompt: format!("Do {title}"),
        runtime_id: "fixture".into(),
        agent_id: "fixture-agent".into(),
        model_id: "fixture-model".into(),
        keep_running_after_quit: true,
        run_after,
        ..Default::default()
    }
}

/// A queued task the app handed to the helper.
fn handed_to_helper(data_root: &Path, title: &str, run_after: Option<i64>) -> String {
    let app = TaskStore::new(data_root.join("research-tasks")).unwrap();
    let task = app.create(draft(title, run_after)).unwrap();
    app.request_start(&task.id).unwrap();
    let record = HandoffRecord::new(OwnerKind::App, OwnerKind::Daemon, HandoffReason::Quit, 0);
    assert!(app
        .hand_off_queued(&task.id, OwnerKind::Daemon, &record)
        .unwrap());
    task.id
}

fn serve_in_thread(options: ServeOptions) -> std::thread::JoinHandle<i32> {
    std::thread::spawn(move || serve(options))
}

fn wait_for(what: &str, timeout: Duration, mut check: impl FnMut() -> bool) {
    let deadline = Instant::now() + timeout;
    while !check() {
        assert!(Instant::now() < deadline, "timed out waiting for {what}");
        std::thread::sleep(Duration::from_millis(50));
    }
}

#[test]
fn an_idle_helper_exits_after_its_grace() {
    let data = tempfile::tempdir().unwrap();
    let started = Instant::now();
    let helper = serve_in_thread(options(data.path(), false, Duration::from_millis(200)));
    let code = helper.join().unwrap();
    assert_eq!(code, 0);
    assert!(started.elapsed() < Duration::from_secs(10));
    let paths = helper_paths(data.path());
    assert!(!paths.state.exists());
    // The lock goes with the helper's last handle on it, which can trail the
    // exit code on a busy machine.
    let deadline = Instant::now() + Duration::from_secs(5);
    while HelperLock::is_held_elsewhere(&paths.lock).unwrap() {
        assert!(
            Instant::now() < deadline,
            "the helper never released its lock"
        );
        std::thread::sleep(Duration::from_millis(20));
    }
}

#[test]
fn work_handed_over_while_the_helper_decides_to_exit_is_not_stranded() {
    let data = tempfile::tempdir().unwrap();
    let handed = std::sync::Arc::new(std::sync::Mutex::new(None::<String>));
    {
        let root = data.path().to_path_buf();
        let handed = handed.clone();
        *BEFORE_FINAL_CHECK.lock().unwrap() = Some((
            data.path().to_path_buf(),
            Box::new(move || {
                *handed.lock().unwrap() = Some(handed_to_helper(&root, "late", None));
            }),
        ));
    }
    let code = serve_in_thread(options(data.path(), false, Duration::from_millis(200)))
        .join()
        .unwrap();
    assert_eq!(code, 0);
    let id = handed.lock().unwrap().clone().expect("the hook ran");
    let task = TaskStore::new(data.path().join("research-tasks"))
        .unwrap()
        .require(&id)
        .unwrap();
    // The helper took it (its runtime is missing here, so it failed) instead
    // of leaving it queued for a helper that was gone.
    assert_ne!(task.status, ResearchTaskStatus::Queued);
}

#[test]
fn a_stop_request_hands_tasks_back_to_the_app_and_exits() {
    let data = tempfile::tempdir().unwrap();
    let later = now_ms() + 3_600_000;
    let id = handed_to_helper(data.path(), "scheduled", Some(later));
    let helper = serve_in_thread(options(data.path(), true, Duration::from_secs(30)));
    let paths = helper_paths(data.path());
    wait_for("the helper to be ready", Duration::from_secs(20), || {
        read_state(&paths.state).is_some_and(|state| state.phase == Phase::Ready)
    });
    client::request_stop(data.path(), "test").unwrap();
    assert_eq!(helper.join().unwrap(), 0);
    let store = TaskStore::new(data.path().join("research-tasks")).unwrap();
    let task = store.require(&id).unwrap();
    assert_eq!(task.owner, OwnerKind::App);
    assert_eq!(
        store.handoff_record(&id).unwrap().unwrap().reason,
        HandoffReason::Stop
    );
    assert!(!client::status(data.path()).unwrap().running);
}

#[test]
fn the_helper_resumes_its_own_interrupted_tasks_at_start() {
    let data = tempfile::tempdir().unwrap();
    let workspace = data.path().join("workspace");
    std::fs::create_dir_all(&workspace).unwrap();
    let root = data.path().join("research-tasks");
    let helper_store = TaskStore::with_owner_kind(root.clone(), OwnerKind::Daemon).unwrap();
    let id = handed_to_helper(data.path(), "interrupted", None);
    let running = helper_store.claim_next().unwrap().unwrap();
    assert_eq!(running.id, id);
    let isolation = TaskIsolation {
        kind: TaskIsolationKind::StagedProject,
        execution_root: workspace.to_string_lossy().into_owned(),
        baseline_root: workspace.join("baseline").to_string_lossy().into_owned(),
        source_revision: "snapshot:base".into(),
        baseline_hash: "base".into(),
        baseline: vec![ManifestEntry {
            path: "main.tex".into(),
            sha256: "0".repeat(64),
            size: 1,
            resolved_link: false,
        }],
        allowed_paths: Vec::new(),
        created_at: now_ms(),
        skipped: Vec::new(),
    };
    assert!(helper_store
        .set_isolation(&id, running.execution_generation, &isolation)
        .unwrap());
    // The helper that ran it is gone.
    helper_store
        .set_owner(
            &id,
            Some(ProcessIdentity {
                pid: u32::MAX - 11,
                started: Some(5),
            }),
        )
        .unwrap();
    let code = serve_in_thread(options(data.path(), false, Duration::from_millis(300)))
        .join()
        .unwrap();
    assert_eq!(code, 0);
    let task = TaskStore::new(root).unwrap().require(&id).unwrap();
    assert_eq!(task.resumed_from, Some(running.execution_generation));
    assert_eq!(task.execution_generation, running.execution_generation + 1);
}

#[test]
fn a_second_helper_on_the_same_data_folder_steps_aside() {
    let data = tempfile::tempdir().unwrap();
    let paths = helper_paths(data.path());
    ensure_dir(&paths).unwrap();
    let held = HelperLock::acquire(&paths.lock, Duration::ZERO)
        .unwrap()
        .unwrap();
    let foreground = serve(options(data.path(), true, Duration::from_secs(1)));
    assert_eq!(foreground, ALREADY_RUNNING);
    let app = serve(ServeOptions {
        mode: ServeMode::App,
        ..options(data.path(), true, Duration::from_secs(1))
    });
    assert_eq!(app, 0);
    drop(held);
}

#[test]
fn background_tasks_off_stops_a_helper_started_at_sign_in() {
    let data = tempfile::tempdir().unwrap();
    std::fs::write(
        data.path().join("config.json"),
        r#"{"research_background_enabled":false}"#,
    )
    .unwrap();
    let code = serve(ServeOptions {
        mode: ServeMode::AtLogin,
        ..options(data.path(), true, Duration::from_secs(1))
    });
    assert_eq!(code, 0);
    assert!(!helper_paths(data.path()).state.exists());
}

/// A signal reaches the whole test process, so the check runs in a child
/// copy of this test binary (the parent's other tests stay out of it).
#[cfg(unix)]
#[test]
fn termination_resolves_on_sigterm_and_sighup() {
    use std::io::{BufRead, BufReader};
    use std::process::{Command, Stdio};

    const CHILD: &str = "OLEAFLY_TEST_TERMINATION_CHILD";
    if std::env::var_os(CHILD).is_some() {
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        runtime.block_on(async {
            let mut waiting = Box::pin(termination());
            // Polled once so the handlers exist before the parent signals.
            let _ = tokio::time::timeout(Duration::from_millis(50), &mut waiting).await;
            println!("ready");
            waiting.await;
        });
        return;
    }
    for signal in [libc::SIGTERM, libc::SIGHUP] {
        let mut child = Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "daemon::serve::tests::termination_resolves_on_sigterm_and_sighup",
                "--nocapture",
                "--test-threads=1",
            ])
            .env(CHILD, "1")
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .unwrap();
        // The harness starts the line with the test's name, so "ready" ends
        // it. The reader keeps draining the pipe until the child is gone.
        let stdout = child.stdout.take().unwrap();
        let (ready_sender, ready) = std::sync::mpsc::channel();
        let reader = std::thread::spawn(move || {
            for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                if line.ends_with("ready") {
                    let _ = ready_sender.send(());
                }
            }
        });
        if ready.recv_timeout(Duration::from_secs(60)).is_err() {
            let _ = child.kill();
            panic!("the child never became ready");
        }
        let pid = i32::try_from(child.id()).unwrap();
        // SAFETY: signalling the child process this test started.
        assert_eq!(unsafe { libc::kill(pid, signal) }, 0);
        let deadline = Instant::now() + Duration::from_secs(10);
        let status = loop {
            if let Some(status) = child.try_wait().unwrap() {
                break status;
            }
            if Instant::now() > deadline {
                let _ = child.kill();
                panic!("signal {signal} did not end the wait");
            }
            std::thread::sleep(Duration::from_millis(20));
        };
        reader.join().unwrap();
        assert!(status.success(), "signal {signal}: {status}");
    }
}
