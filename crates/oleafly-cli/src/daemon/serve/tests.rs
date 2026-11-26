use std::path::Path;
use std::time::{Duration, Instant};

use oleafly_research::model::{ManifestEntry, ResearchTaskDraft, TaskIsolation, TaskIsolationKind};
use oleafly_sandbox::process::identity::ProcessIdentity;

use super::*;
use crate::daemon::client;
use crate::daemon::state::read_state;
use crate::support::Running;

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

const CHILD: &str = "OLEAFLY_TEST_TERMINATION_CHILD";

fn as_child(work: impl std::future::Future<Output = ()>) -> bool {
    if std::env::var_os(CHILD).is_none() {
        return false;
    }
    tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap()
        .block_on(work);
    true
}

fn start_child(test: &str, prepare: impl FnOnce(&mut std::process::Command)) -> Running {
    let mut command = std::process::Command::new(std::env::current_exe().unwrap());
    command
        .args([
            "--exact",
            &format!("daemon::serve::tests::{test}"),
            "--nocapture",
            "--test-threads=1",
        ])
        .env(CHILD, "1")
        .stderr(std::process::Stdio::null());
    prepare(&mut command);
    Running::start(&mut command)
}

fn expect(child: &Running, wanted: &str) {
    let deadline = Instant::now() + Duration::from_secs(60);
    loop {
        match child
            .lines
            .recv_timeout(deadline.saturating_duration_since(Instant::now()))
        {
            Ok(line) if line.ends_with(wanted) => return,
            Ok(_) => {}
            Err(_) => panic!("the child never printed {wanted:?}"),
        }
    }
}

#[cfg(unix)]
fn signal(child: &Running, signal: i32) {
    let pid = i32::try_from(child.process.id()).unwrap();
    // SAFETY: signalling the child process this test started.
    assert_eq!(unsafe { libc::kill(pid, signal) }, 0);
}

fn succeeds(mut child: Running, what: &str) {
    let status = crate::support::exit_within(&mut child.process, Duration::from_secs(10));
    assert!(status.success(), "{what}: {status}");
}

fn registered() -> Terminations {
    Terminations::register(|signal, error| panic!("{signal:?} was not registered: {error}"))
}

#[cfg(unix)]
#[test]
fn termination_resolves_on_sigterm_and_sighup() {
    if as_child(async {
        let waiting = termination();
        println!("ready");
        waiting.await;
    }) {
        return;
    }
    for number in [libc::SIGTERM, libc::SIGHUP] {
        let child = start_child("termination_resolves_on_sigterm_and_sighup", |command| {
            crate::support::set_hangup(command, libc::SIG_DFL);
        });
        expect(&child, "ready");
        signal(&child, number);
        succeeds(child, &format!("signal {number}"));
    }
}

#[cfg(unix)]
#[test]
fn a_second_signal_is_seen_after_the_first() {
    if as_child(async {
        let mut terminations = registered();
        println!("ready");
        println!("first {:?}", terminations.next().await);
        println!("second {:?}", terminations.next().await);
    }) {
        return;
    }
    let child = start_child("a_second_signal_is_seen_after_the_first", |command| {
        crate::support::set_hangup(command, libc::SIG_DFL);
    });
    expect(&child, "ready");
    signal(&child, libc::SIGTERM);
    expect(&child, "first Terminate");
    signal(&child, libc::SIGINT);
    expect(&child, "second Interrupt");
    succeeds(child, "the second signal");
}

#[cfg(unix)]
#[test]
fn an_inherited_ignored_sighup_stays_ignored() {
    if as_child(async {
        let mut terminations = registered();
        println!("ready, ignored {}", hangup_ignored());
        println!("first {:?}", terminations.next().await);
    }) {
        return;
    }
    let mut child = start_child("an_inherited_ignored_sighup_stays_ignored", |command| {
        crate::support::set_hangup(command, libc::SIG_IGN);
    });
    expect(&child, "ready, ignored true");
    signal(&child, libc::SIGHUP);
    std::thread::sleep(Duration::from_millis(300));
    assert!(
        child.process.try_wait().unwrap().is_none(),
        "an ignored SIGHUP ended the child"
    );
    assert!(
        child.lines.try_recv().is_err(),
        "an ignored SIGHUP ended the wait"
    );
    signal(&child, libc::SIGTERM);
    expect(&child, "first Terminate");
    succeeds(child, "SIGTERM after an ignored SIGHUP");
}

#[cfg(windows)]
#[test]
fn ctrl_break_is_a_termination() {
    use std::os::windows::process::CommandExt;
    use windows_sys::Win32::System::Console::{
        AllocConsole, GenerateConsoleCtrlEvent, CTRL_BREAK_EVENT,
    };
    use windows_sys::Win32::System::Threading::CREATE_NEW_PROCESS_GROUP;

    if as_child(async {
        let mut terminations = registered();
        println!("ready");
        println!("first {:?}", terminations.next().await);
    }) {
        return;
    }
    // SAFETY: AllocConsole takes no arguments, and it fails harmlessly when this process already has a console.
    unsafe { AllocConsole() };
    let child = start_child("ctrl_break_is_a_termination", |command| {
        command.creation_flags(CREATE_NEW_PROCESS_GROUP);
    });
    expect(&child, "ready");
    // SAFETY: sends Ctrl+Break to the process group of the child this test started.
    let sent = unsafe { GenerateConsoleCtrlEvent(CTRL_BREAK_EVENT, child.process.id()) };
    assert_ne!(
        sent,
        0,
        "Ctrl+Break was not sent: {}",
        std::io::Error::last_os_error()
    );
    expect(&child, "first Break");
    succeeds(child, "Ctrl+Break");
}

#[test]
fn the_helper_finds_the_resources_beside_its_own_binary() {
    let root = tempfile::tempdir().unwrap();
    let (bin, resources) = if cfg!(target_os = "macos") {
        (
            root.path().join("Oleafly.app/Contents/MacOS"),
            root.path().join("Oleafly.app/Contents/Resources/resources"),
        )
    } else {
        // An AppImage mount: `usr/bin/<app>` and `usr/lib/Oleafly/resources`.
        (
            root.path().join("usr/bin"),
            root.path().join("usr/lib/Oleafly/resources"),
        )
    };
    std::fs::create_dir_all(&bin).unwrap();
    std::fs::create_dir_all(resources.join("skills")).unwrap();
    let found = super::own_resources(Some(bin.join("oleafly-desktop")));
    if cfg!(windows) {
        // Windows keeps them in `resources` beside the binary.
        assert_eq!(found, None);
    } else {
        assert_eq!(found, Some(resources));
    }
    assert_eq!(super::own_resources(None), None);
}
