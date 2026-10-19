use super::flow::FLOW_HIGH_WATERMARK;
use super::*;
#[cfg(unix)]
use crate::proc::NoConsole as _;
use crate::test_wait;
use std::path::PathBuf;

#[test]
fn reload_rejects_an_in_flight_terminal_open() {
    let directory = tempfile::tempdir().unwrap();
    let owner = SessionOwner::new("audit-stale-open", "proj");
    let ticket = terminal_open_ticket(owner.clone());
    kill_window_sessions(&owner.window_label);
    let result = open_terminal_with_ticket(
        directory.path(),
        ticket,
        80,
        24,
        Channel::new(|_| Ok(())),
        nonreading_terminal_fixture(),
    );
    assert!(result.unwrap_err().contains("reloaded"));
    let sessions = SESSIONS.lock().unwrap();
    assert!(!sessions
        .as_ref()
        .unwrap()
        .sessions
        .values()
        .any(|record| record.owner == owner));
}

#[test]
fn slow_resize_does_not_hold_the_global_session_registry() {
    let directory = tempfile::tempdir().unwrap();
    let owner = SessionOwner::new("audit-resize-lock", "proj");
    let id = open_terminal(
        directory.path(),
        owner.clone(),
        80,
        24,
        Channel::new(|_| Ok(())),
        nonreading_terminal_fixture(),
    )
    .unwrap();
    let master = {
        let sessions = SESSIONS.lock().unwrap();
        Arc::clone(&sessions.as_ref().unwrap().get(&id, &owner).unwrap().master)
    };
    let locked = master.lock().unwrap();
    let resize_owner = owner.clone();
    let resize_id = id.clone();
    let (started, ready) = std::sync::mpsc::channel();
    let resize = std::thread::spawn(move || {
        started.send(()).unwrap();
        resize_terminal(&resize_owner, &resize_id, 100, 30)
    });
    ready
        .recv_timeout(std::time::Duration::from_secs(2))
        .unwrap();
    std::thread::sleep(std::time::Duration::from_millis(100));
    let registry_available = SESSIONS.try_lock().is_ok();
    drop(locked);
    resize.join().unwrap().unwrap();
    kill_terminal(&owner, &id).unwrap();
    assert!(
        registry_available,
        "resize blocked input/close for every terminal"
    );
}

#[tokio::test]
async fn oversized_pastes_are_rejected_whole_and_leave_the_terminal_usable() {
    let writer = TerminalWriter::start(Box::new(std::io::sink()), None).unwrap();
    let error = writer
        .enqueue(&"x".repeat(MAX_PENDING_INPUT_BYTES + 1))
        .unwrap_err();
    assert!(error.contains("Paste 4 MiB or less"));
    assert_eq!(writer.pending_bytes.load(Ordering::Acquire), 0);
    writer
        .enqueue("echo ready\n")
        .unwrap()
        .await
        .unwrap()
        .unwrap();
    writer
        .enqueue(&"x".repeat(MAX_PENDING_INPUT_BYTES))
        .unwrap()
        .await
        .unwrap()
        .unwrap();
}

#[tokio::test]
async fn blocked_terminal_input_is_bounded_ordered_and_does_not_block_the_caller() {
    struct BlockedWriter {
        started: std::sync::mpsc::Sender<()>,
        resume: std::sync::mpsc::Receiver<()>,
        output: Arc<Mutex<Vec<u8>>>,
    }
    impl Write for BlockedWriter {
        fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
            self.started.send(()).unwrap();
            self.resume.recv().unwrap();
            self.output.lock().unwrap().extend_from_slice(bytes);
            Ok(bytes.len())
        }
        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }
    let (started, started_rx) = std::sync::mpsc::channel();
    let (resume, resume_rx) = std::sync::mpsc::channel();
    let output = Arc::new(Mutex::new(Vec::new()));
    let writer = TerminalWriter::start(
        Box::new(BlockedWriter {
            started,
            resume: resume_rx,
            output: Arc::clone(&output),
        }),
        None,
    )
    .unwrap();
    let first = writer.enqueue("first").unwrap();
    started_rx
        .recv_timeout(std::time::Duration::from_secs(2))
        .unwrap();
    let second = writer.enqueue("second").unwrap();
    assert!(writer
        .enqueue(&"x".repeat(MAX_PENDING_INPUT_BYTES))
        .is_err());
    assert_eq!(writer.pending_bytes.load(Ordering::Acquire), 11);
    resume.send(()).unwrap();
    first.await.unwrap().unwrap();
    started_rx
        .recv_timeout(std::time::Duration::from_secs(2))
        .unwrap();
    resume.send(()).unwrap();
    second.await.unwrap().unwrap();
    assert_eq!(*output.lock().unwrap(), b"firstsecond");
    assert_eq!(writer.pending_bytes.load(Ordering::Acquire), 0);
}

#[tokio::test]
async fn terminal_writer_reports_io_failure_and_rejects_more_input() {
    struct FailedWriter;
    impl Write for FailedWriter {
        fn write(&mut self, _: &[u8]) -> std::io::Result<usize> {
            Err(std::io::Error::from(std::io::ErrorKind::BrokenPipe))
        }
        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }
    let writer = TerminalWriter::start(Box::new(FailedWriter), None).unwrap();
    assert!(writer.enqueue("hello").unwrap().await.unwrap().is_err());
    assert!(writer.enqueue("again").is_err());
}

#[test]
fn terminal_env_advertises_truecolor_and_identity() {
    let mut cmd = super::CommandBuilder::new("sh");
    super::apply_terminal_env(&mut cmd);
    let get = |k: &str| cmd.get_env(k).map(|v| v.to_string_lossy().into_owned());
    assert_eq!(get("TERM").as_deref(), Some("xterm-256color"));
    assert_eq!(get("COLORTERM").as_deref(), Some("truecolor"));
    assert_eq!(get("TERM_PROGRAM").as_deref(), Some("Oleafly"));
    assert_eq!(
        get("TERM_PROGRAM_VERSION").as_deref(),
        Some(env!("CARGO_PKG_VERSION"))
    );
    #[cfg(not(windows))]
    {
        // Either the host already has a UTF-8-capable locale, or we supplied one.
        let host_has_locale = ["LC_ALL", "LC_CTYPE", "LANG"]
            .iter()
            .any(|k| std::env::var_os(k).is_some_and(|v| !v.is_empty()));
        if !host_has_locale {
            assert!(get("LANG").is_some_and(|v| v.ends_with("UTF-8")));
        }
    }
}

#[test]
fn drain_window_removes_only_that_windows_sessions() {
    let mut registry = SessionRegistry::<u32>::default();
    let main_id = registry.insert(SessionOwner::new("main", "alpha"), 1);
    let other_main = registry.insert(SessionOwner::new("main", "beta"), 2);
    let preview_id = registry.insert(SessionOwner::new("preview", "alpha"), 3);
    let mut drained = registry.drain_window("main");
    drained.sort_unstable();
    assert_eq!(drained, vec![1, 2]);
    assert!(registry.remove_unchecked(&main_id).is_none());
    assert!(registry.remove_unchecked(&other_main).is_none());
    assert_eq!(registry.remove_unchecked(&preview_id), Some(3));
    assert!(registry.drain_all().is_empty());
}

#[test]
fn drain_project_removes_only_that_projects_sessions() {
    let mut registry = SessionRegistry::<u32>::default();
    let alpha_main = registry.insert(SessionOwner::new("main", "alpha"), 1);
    let alpha_preview = registry.insert(SessionOwner::new("preview", "alpha"), 2);
    let beta = registry.insert(SessionOwner::new("main", "beta"), 3);
    let mut drained = registry.drain_project("alpha");
    drained.sort_unstable();
    assert_eq!(drained, vec![1, 2]);
    assert!(registry.remove_unchecked(&alpha_main).is_none());
    assert!(registry.remove_unchecked(&alpha_preview).is_none());
    assert_eq!(registry.remove_unchecked(&beta), Some(3));
    assert!(registry.drain_project("alpha").is_empty());
}

#[test]
fn the_registry_lists_only_the_owners_sessions() {
    let mut registry = SessionRegistry::<u32>::default();
    let owner = SessionOwner::new("main", "alpha");
    let mine = registry.insert(owner.clone(), 1);
    registry.insert(SessionOwner::new("main", "beta"), 2);
    registry.insert(SessionOwner::new("preview", "alpha"), 3);
    let listed: Vec<(&str, &u32)> = registry.owned(&owner).collect();
    assert_eq!(listed, [(mine.as_str(), &1)]);
}

#[test]
fn drain_utf8_keeps_a_split_multibyte_tail() {
    let emoji = "café🦀".as_bytes();
    let (head, tail) = emoji.split_at(emoji.len() - 2);
    let mut pending = head.to_vec();
    let mut out = super::drain_utf8_lossy(&mut pending);
    pending.extend_from_slice(tail);
    out.push_str(&super::drain_utf8_lossy(&mut pending));
    assert_eq!(out, "café🦀");
    assert!(pending.is_empty());
}

#[test]
fn drain_utf8_replaces_invalid_bytes() {
    let mut pending = vec![b'o', b'k', 0xFF, b'!'];
    let out = super::drain_utf8_lossy(&mut pending);
    assert_eq!(out, "ok\u{FFFD}!");
    assert!(pending.is_empty());
}

#[test]
#[cfg_attr(
    windows,
    ignore = "WebView2 child-webview creation needs a running message loop that a unit test thread does not provide"
)]
fn terminal_write_resolves_the_parent_of_a_multi_webview_window() {
    #[cfg(not(windows))]
    use std::os::unix::fs::PermissionsExt;

    let root = std::env::temp_dir().join(format!(
        "oleafly-terminal-multi-webview-{}",
        std::process::id()
    ));
    std::fs::remove_dir_all(&root).ok();
    let project = root.join("projects/proj");
    std::fs::create_dir_all(&project).unwrap();
    #[cfg(not(windows))]
    let shell = {
        let shell = root.join("test-shell.sh");
        std::fs::write(
            &shell,
            b"#!/bin/sh\nIFS= read -r input\nprintf '%s' \"$input\" > terminal-input.txt\nsleep 10\n",
        )
        .unwrap();
        std::fs::set_permissions(&shell, std::fs::Permissions::from_mode(0o700)).unwrap();
        CommandBuilder::new(shell)
    };
    #[cfg(windows)]
    let shell = {
        let mut shell = CommandBuilder::new("powershell.exe");
        shell.arg("-NoProfile");
        shell.arg("-Command");
        shell.arg("$input = [Console]::In.ReadLine(); [IO.File]::WriteAllText('terminal-input.txt', $input); Start-Sleep -Seconds 10");
        shell
    };
    let owner = SessionOwner::new("main", "proj");
    let session_id = open_terminal(
        &project,
        owner.clone(),
        80,
        24,
        Channel::new(|_| Ok(())),
        shell,
    )
    .unwrap();
    let app = tauri::test::mock_builder()
        .invoke_handler(tauri::generate_handler![term_write])
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .unwrap();
    let main_webview = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
        .build()
        .unwrap();
    let window = main_webview.as_ref().window();
    let _browser_webview = window
        .add_child(
            tauri::webview::WebviewBuilder::new("oleafly-browser-pane-test", Default::default()),
            tauri::LogicalPosition::new(0, 0),
            tauri::LogicalSize::new(400, 600),
        )
        .unwrap();

    let response = tauri::test::get_ipc_response(
        &main_webview,
        tauri::webview::InvokeRequest {
            cmd: "term_write".into(),
            callback: tauri::ipc::CallbackFn(0),
            error: tauri::ipc::CallbackFn(1),
            url: if cfg!(windows) {
                "http://tauri.localhost"
            } else {
                "tauri://localhost"
            }
            .parse()
            .unwrap(),
            body: serde_json::json!({
                "projectId": "proj",
                "id": session_id,
                "data": "hello from the main webview\n"
            })
            .into(),
            headers: Default::default(),
            invoke_key: tauri::test::INVOKE_KEY.to_string(),
        },
    );
    let response = response.map(|body| body.deserialize::<()>().unwrap());
    let received_path = project.join("terminal-input.txt");
    let received = test_wait::read_until_blocking(
        &received_path,
        test_wait::CHILD_PATIENCE,
        test_wait::exactly("hello from the main webview"),
    );
    let written = std::fs::read_to_string(&received_path);

    kill_terminal(&owner, &session_id).unwrap();
    std::fs::remove_dir_all(&root).ok();
    assert_eq!(response, Ok(()));
    assert_eq!(
        received,
        Some(()),
        "the shell did not write the line it read: {written:?}"
    );
}

#[cfg(unix)]
#[test]
fn child_exit_sends_a_terminal_exit_event() {
    let root = std::env::temp_dir().join(format!(
        "oleafly-terminal-exit-event-{}",
        std::process::id()
    ));
    std::fs::remove_dir_all(&root).ok();
    let project = root.join("projects/proj");
    std::fs::create_dir_all(&project).unwrap();
    let mut shell = CommandBuilder::new("/bin/sh");
    shell.arg("-c");
    shell.arg("sleep 0.05");
    let (events_tx, events_rx) = std::sync::mpsc::channel();
    let channel = Channel::new(move |body| {
        events_tx
            .send(body.deserialize::<serde_json::Value>().unwrap())
            .unwrap();
        Ok(())
    });

    open_terminal(
        &project,
        SessionOwner::new("main", "proj"),
        80,
        24,
        channel,
        shell,
    )
    .unwrap();
    // The contract is that the exit event arrives, not that it is the
    // first event; a pty may emit terminal noise before the shell dies.
    let deadline = std::time::Instant::now() + test_wait::CHILD_PATIENCE;
    let mut events = Vec::new();
    let exit_seen = loop {
        let remaining = deadline.saturating_duration_since(std::time::Instant::now());
        if remaining.is_zero() {
            break false;
        }
        match events_rx.recv_timeout(remaining) {
            Ok(event) => {
                let is_exit = event == serde_json::json!({ "event": "exit" });
                events.push(event);
                if is_exit {
                    break true;
                }
            }
            Err(_) => break false,
        }
    };

    std::fs::remove_dir_all(&root).ok();
    assert!(exit_seen, "no exit event; received: {events:?}");
}

#[test]
fn writes_to_unknown_sessions_are_rejected() {
    let owner = SessionOwner::new("main", "proj");
    assert!(write_terminal(&owner, "missing", "ls\n").is_err());
    assert!(resize_terminal(&owner, "missing", 80, 24).is_err());
    assert!(kill_terminal(&owner, "missing").is_ok());
    assert!(ack_terminal(&owner, "missing", 1).is_err());
}

#[test]
fn system_probe_resolves_a_runnable_default_shell() {
    let spec = shell::resolve_shell(&ShellChoice::default(), cfg!(windows), &shell::SystemProbe)
        .expect("a default shell");
    #[cfg(windows)]
    {
        assert_eq!(spec.args, ["-NoLogo"]);
        let file = Path::new(&spec.program)
            .file_name()
            .map(|name| name.to_string_lossy().to_ascii_lowercase())
            .unwrap_or_default();
        assert!(file == "pwsh.exe" || file == "powershell.exe", "{file}");
    }
    #[cfg(unix)]
    {
        assert_eq!(spec.args, ["-l"]);
        assert!(Path::new(&spec.program).is_file(), "{}", spec.program);
    }
    // 0.4.7 `shell_builder_targets_a_login_shell`: the shell gets a search
    // path, with no empty entries.
    let mut cmd = CommandBuilder::new(&spec.program);
    env::apply_session_env(&mut cmd, &spec, &env::CliEnv::from_program(None), &[]);
    let path = cmd.get_env("PATH").expect("the shell gets a search path");
    assert!(!path.is_empty());
    assert!(std::env::split_paths(path).all(|entry| !entry.as_os_str().is_empty()));
}

#[test]
fn terminal_session_ids_are_not_sequential_counters() {
    let mut registry = SessionRegistry::default();
    let id = registry.insert(SessionOwner::new("main", "proj"), ());
    let numeric_suffix = id
        .strip_prefix("term-")
        .and_then(|suffix| suffix.parse::<u64>().ok());
    let random_ids = (0..32)
        .map(|_| random_session_id())
        .collect::<std::collections::HashSet<_>>();

    assert!(id.starts_with("term-"));
    assert!(numeric_suffix.is_none());
    assert_eq!(random_ids.len(), 32);
    assert!(random_ids.iter().all(|id| id.len() >= 48));
}

#[test]
fn terminal_sessions_require_the_creating_window_and_project() {
    let owner = SessionOwner::new("main", "project-a");
    let mut registry = SessionRegistry::default();
    let id = registry.insert(owner.clone(), ());
    let wrong_window = SessionOwner::new("preview", "project-a");
    let wrong_project = SessionOwner::new("main", "project-b");

    assert!(registry.get(&id, &owner).is_ok());
    assert_eq!(
        registry.get(&id, &wrong_window).err().as_deref(),
        Some("terminal session belongs to another window or project")
    );
    assert_eq!(
        registry.remove(&id, &wrong_project).err().as_deref(),
        Some("terminal session belongs to another window or project")
    );
    assert!(registry.get(&id, &owner).is_ok());
    assert!(registry.remove(&id, &owner).unwrap().is_some());
    assert_eq!(
        command_owner("preview", "project-a").err().as_deref(),
        Some("terminal is unavailable from this window")
    );
}

#[cfg(unix)]
#[test]
fn owning_window_and_project_can_write_to_the_shell() {
    use std::os::unix::fs::PermissionsExt;

    let root = std::env::temp_dir().join(format!(
        "oleafly-terminal-owner-write-{}",
        std::process::id()
    ));
    std::fs::remove_dir_all(&root).ok();
    let project = root.join("projects/proj");
    std::fs::create_dir_all(&project).unwrap();
    let shell = root.join("test-shell.sh");
    std::fs::write(
        &shell,
        b"#!/bin/sh\nIFS= read -r input\nprintf '%s' \"$input\" > terminal-input.txt\nsleep 10\n",
    )
    .unwrap();
    std::fs::set_permissions(&shell, std::fs::Permissions::from_mode(0o700)).unwrap();
    let owner = command_owner("main", "proj").unwrap();
    let session_id = open_terminal(
        &project,
        owner.clone(),
        80,
        24,
        Channel::new(|_| Ok(())),
        CommandBuilder::new(&shell),
    )
    .unwrap();

    write_terminal(&owner, &session_id, "hello from the owner\n").unwrap();
    let received_path = project.join("terminal-input.txt");
    let received = test_wait::read_until_blocking(
        &received_path,
        test_wait::CHILD_PATIENCE,
        test_wait::exactly("hello from the owner"),
    );
    let written = std::fs::read_to_string(&received_path);

    kill_terminal(&owner, &session_id).unwrap();
    std::fs::remove_dir_all(&root).ok();
    assert_eq!(
        received,
        Some(()),
        "the shell did not write the line it read: {written:?}"
    );
}

struct TerminalTestSession {
    owner: SessionOwner,
    id: String,
}

impl Drop for TerminalTestSession {
    fn drop(&mut self) {
        let _ = kill_terminal(&self.owner, &self.id);
    }
}

/// The child the terminal tests run: `1` prints READY then a dot every
/// 100 ms without reading input; `flood` writes 8 MiB at once, then waits.
#[test]
fn nonreading_terminal_child() {
    let mode = std::env::var("OLEAFLY_TERMINAL_TEST_CHILD").unwrap_or_default();
    if mode != "1" && mode != "flood" {
        return;
    }
    #[cfg(windows)]
    let mut output = std::fs::OpenOptions::new()
        .read(true)
        .write(true)
        .open("CONOUT$")
        .unwrap();
    #[cfg(unix)]
    let mut output = std::io::stdout().lock();
    if mode == "flood" {
        let chunk = [b'x'; 64 * 1024];
        for _ in 0..128 {
            if output
                .write_all(&chunk)
                .and_then(|_| output.flush())
                .is_err()
            {
                return;
            }
        }
        std::thread::sleep(std::time::Duration::from_secs(30));
        return;
    }
    output.write_all(b"READY").unwrap();
    output.flush().unwrap();
    let deadline = Instant::now() + std::time::Duration::from_secs(30);
    while Instant::now() < deadline {
        std::thread::sleep(std::time::Duration::from_millis(100));
        if output.write_all(b".").and_then(|_| output.flush()).is_err() {
            return;
        }
    }
}

fn nonreading_terminal_fixture() -> CommandBuilder {
    let mut process = CommandBuilder::new(std::env::current_exe().unwrap());
    process.args([
        "--exact",
        "terminal::tests::nonreading_terminal_child",
        "--nocapture",
    ]);
    process.env("OLEAFLY_TERMINAL_TEST_CHILD", "1");
    process
}

fn flood_terminal_fixture() -> CommandBuilder {
    let mut process = nonreading_terminal_fixture();
    process.env("OLEAFLY_TERMINAL_TEST_CHILD", "flood");
    process
}

async fn wait_for_terminal_ready(
    events: &mut tokio::sync::mpsc::UnboundedReceiver<serde_json::Value>,
) {
    let mut output = String::new();
    tokio::time::timeout(test_wait::CHILD_PATIENCE, async {
        while let Some(event) = events.recv().await {
            if let Some(data) = event["data"].as_str() {
                output.push_str(data);
                if output.contains("READY") {
                    return;
                }
            }
        }
        panic!("terminal event stream closed before the shell was ready");
    })
    .await
    .unwrap_or_else(|_| panic!("shell did not become ready; terminal output: {output:?}"));
}

/// Counts the output bytes a session sends, checks every event's byte
/// count against its text, and notes the exit event. Never acknowledges.
struct OutputCounter {
    total: Arc<AtomicUsize>,
    mismatched: Arc<AtomicBool>,
    exited: Arc<AtomicBool>,
}

impl OutputCounter {
    fn new() -> Self {
        Self {
            total: Arc::new(AtomicUsize::new(0)),
            mismatched: Arc::new(AtomicBool::new(false)),
            exited: Arc::new(AtomicBool::new(false)),
        }
    }

    fn channel(&self) -> Channel<TerminalEvent> {
        let total = Arc::clone(&self.total);
        let mismatched = Arc::clone(&self.mismatched);
        let exited = Arc::clone(&self.exited);
        Channel::new(move |body| {
            let event = body.deserialize::<serde_json::Value>().unwrap();
            match event["event"].as_str() {
                Some("output") => {
                    let data = event["data"].as_str().unwrap_or_default();
                    let bytes = event["bytes"].as_u64().unwrap_or_default() as usize;
                    if bytes != data.len() {
                        mismatched.store(true, Ordering::Release);
                    }
                    total.fetch_add(bytes, Ordering::AcqRel);
                }
                Some("exit") => exited.store(true, Ordering::Release),
                _ => {}
            }
            Ok(())
        })
    }
}

/// Waits until some output arrived and the total then stayed the same for
/// `quiet`, and returns that total.
fn wait_until_steady(total: &AtomicUsize, quiet: Duration, limit: Duration) -> usize {
    let deadline = Instant::now() + limit;
    let mut last = total.load(Ordering::Acquire);
    let mut since = Instant::now();
    while Instant::now() < deadline {
        std::thread::sleep(Duration::from_millis(20));
        let now = total.load(Ordering::Acquire);
        if now != last {
            last = now;
            since = Instant::now();
        } else if last > 0 && since.elapsed() >= quiet {
            break;
        }
    }
    last
}

#[test]
fn a_flooding_child_pauses_until_output_is_acknowledged() {
    let project = tempfile::tempdir().unwrap();
    let counter = OutputCounter::new();
    let owner = SessionOwner::new("main", "flood-pause");
    let id = open_terminal(
        project.path(),
        owner.clone(),
        80,
        24,
        counter.channel(),
        flood_terminal_fixture(),
    )
    .unwrap();
    let session = TerminalTestSession { owner, id };

    let paused_at = wait_until_steady(
        &counter.total,
        Duration::from_millis(500),
        test_wait::CHILD_PATIENCE,
    );
    assert!(
        paused_at <= FLOW_HIGH_WATERMARK + OUTPUT_BATCH_BYTES + OUTPUT_READ_BYTES,
        "the pump sent {paused_at} bytes nobody acknowledged"
    );
    // A Unix pty passes all 8 MiB through; ConPTY may render less.
    #[cfg(unix)]
    assert!(
        paused_at > FLOW_HIGH_WATERMARK,
        "the flood never reached the watermark: {paused_at}"
    );
    if paused_at > FLOW_HIGH_WATERMARK {
        ack_terminal(&session.owner, &session.id, paused_at as u64).unwrap();
        let deadline = Instant::now() + Duration::from_secs(2);
        while counter.total.load(Ordering::Acquire) == paused_at && Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(10));
        }
        assert!(
            counter.total.load(Ordering::Acquire) > paused_at,
            "output did not resume after the acknowledgement"
        );
    }
    assert!(!counter.mismatched.load(Ordering::Acquire));
}

#[test]
fn output_events_carry_their_utf8_byte_count() {
    let project = tempfile::tempdir().unwrap();
    let (events_tx, events_rx) = std::sync::mpsc::channel();
    let channel = Channel::new(move |body| {
        let _ = events_tx.send(body.deserialize::<serde_json::Value>().unwrap());
        Ok(())
    });
    #[cfg(unix)]
    let shell = {
        let mut shell = CommandBuilder::new("/bin/sh");
        shell.args(["-c", "printf 'café'"]);
        shell
    };
    #[cfg(windows)]
    let shell = {
        let mut shell = CommandBuilder::new("cmd.exe");
        shell.args(["/D", "/C", "echo cafe"]);
        shell
    };
    let owner = SessionOwner::new("main", "byte-count");
    let id = open_terminal(project.path(), owner.clone(), 80, 24, channel, shell).unwrap();
    let _session = TerminalTestSession { owner, id };

    let mut output = String::new();
    let deadline = Instant::now() + test_wait::CHILD_PATIENCE;
    loop {
        let remaining = deadline.saturating_duration_since(Instant::now());
        let Ok(event) = events_rx.recv_timeout(remaining) else {
            break;
        };
        if event["event"] == "exit" {
            break;
        }
        if let Some(data) = event["data"].as_str() {
            assert_eq!(event["bytes"].as_u64(), Some(data.len() as u64), "{event}");
            output.push_str(data);
        }
    }
    #[cfg(unix)]
    assert!(output.contains("café"), "{output:?}");
    #[cfg(windows)]
    assert!(output.contains("cafe"), "{output:?}");
}

#[test]
fn closing_a_paused_session_releases_the_pump() {
    let project = tempfile::tempdir().unwrap();
    let counter = OutputCounter::new();
    let owner = SessionOwner::new("main", "flood-close");
    let id = open_terminal(
        project.path(),
        owner.clone(),
        80,
        24,
        counter.channel(),
        flood_terminal_fixture(),
    )
    .unwrap();
    let child = {
        let sessions = SESSIONS.lock().unwrap();
        Arc::clone(&sessions.as_ref().unwrap().get(&id, &owner).unwrap().child)
    };
    wait_until_steady(
        &counter.total,
        Duration::from_millis(500),
        test_wait::CHILD_PATIENCE,
    );

    kill_terminal(&owner, &id).unwrap();
    let deadline = Instant::now() + Duration::from_secs(5);
    while !counter.exited.load(Ordering::Acquire) && Instant::now() < deadline {
        std::thread::sleep(Duration::from_millis(10));
    }
    let mut reaped = false;
    while !reaped && Instant::now() < deadline {
        reaped = child
            .try_lock()
            .ok()
            .and_then(|mut child| child.try_wait().ok().flatten())
            .is_some();
        if !reaped {
            std::thread::sleep(Duration::from_millis(10));
        }
    }
    assert!(
        counter.exited.load(Ordering::Acquire),
        "no exit event after closing a paused session"
    );
    assert!(reaped, "the paused session's shell was not reaped");
}

#[test]
fn term_ack_rejects_another_projects_session() {
    let project = tempfile::tempdir().unwrap();
    let owner = SessionOwner::new("main", "ack-owner");
    let id = open_terminal(
        project.path(),
        owner.clone(),
        80,
        24,
        Channel::new(|_| Ok(())),
        nonreading_terminal_fixture(),
    )
    .unwrap();
    let session = TerminalTestSession { owner, id };
    assert_eq!(
        ack_terminal(&SessionOwner::new("main", "ack-other"), &session.id, 10)
            .err()
            .as_deref(),
        Some("terminal session belongs to another window or project")
    );
    assert!(ack_terminal(&session.owner, "missing", 10).is_err());
    assert!(ack_terminal(&session.owner, &session.id, u64::MAX).is_ok());
}

#[tokio::test]
async fn hidden_terminal_starts_and_closes_without_a_cursor_response() {
    let project = tempfile::tempdir().unwrap();
    let (events, mut received) = tokio::sync::mpsc::unbounded_channel();
    let channel = Channel::new(move |body| {
        let _ = events.send(body.deserialize::<serde_json::Value>().unwrap());
        Ok(())
    });
    let owner = SessionOwner::new("main", "hidden-terminal");
    let id = open_terminal(
        project.path(),
        owner.clone(),
        80,
        24,
        channel,
        nonreading_terminal_fixture(),
    )
    .unwrap();
    let session = TerminalTestSession { owner, id };
    wait_for_terminal_ready(&mut received).await;
    kill_terminal(&session.owner, &session.id).unwrap();
    tokio::time::timeout(std::time::Duration::from_secs(5), async {
        while let Some(event) = received.recv().await {
            if event["event"] == "exit" {
                return;
            }
        }
        panic!("terminal event stream closed without an exit event");
    })
    .await
    .expect("hidden terminal did not finish native teardown");
}

#[tokio::test]
async fn disconnecting_output_during_a_large_paste_reaps_the_shell() {
    let project = tempfile::tempdir().unwrap();
    let disconnect = Arc::new(AtomicBool::new(false));
    let close_channel = Arc::clone(&disconnect);
    let rejected = Arc::new(AtomicBool::new(false));
    let observed_rejection = Arc::clone(&rejected);
    let (events, mut received) = tokio::sync::mpsc::unbounded_channel();
    let channel = Channel::new(move |body| {
        if close_channel.load(Ordering::Acquire) {
            observed_rejection.store(true, Ordering::Release);
            return Err(tauri::Error::AssetNotFound("closed".into()));
        }
        let _ = events.send(body.deserialize::<serde_json::Value>().unwrap());
        Ok(())
    });
    let owner = SessionOwner::new("main", "paste-disconnect");
    let id = open_terminal(
        project.path(),
        owner.clone(),
        80,
        24,
        channel,
        nonreading_terminal_fixture(),
    )
    .unwrap();
    let session = TerminalTestSession { owner, id };
    wait_for_terminal_ready(&mut received).await;
    let child = {
        let sessions = SESSIONS.lock().unwrap();
        Arc::clone(
            &sessions
                .as_ref()
                .unwrap()
                .get(&session.id, &session.owner)
                .unwrap()
                .child,
        )
    };
    let receipt = write_terminal(&session.owner, &session.id, &"paste\n".repeat(80_000)).unwrap();
    disconnect.store(true, Ordering::Release);
    let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(5);
    tokio::time::timeout_at(deadline, async {
        while !rejected.load(Ordering::Acquire) {
            tokio::time::sleep(std::time::Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("terminal never observed the disconnected output channel");
    let _ = tokio::time::timeout_at(deadline, receipt)
        .await
        .expect("terminal input did not settle after disconnect");
    tokio::time::timeout_at(deadline, async {
        loop {
            let exited = child
                .try_lock()
                .ok()
                .and_then(|mut child| child.try_wait().ok().flatten())
                .is_some();
            if exited {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("terminal shell did not exit after disconnect");
    assert!(write_terminal(&session.owner, &session.id, "more").is_err());
}

#[cfg(unix)]
#[test]
fn closed_output_channel_kills_the_login_shell() {
    use std::os::unix::fs::PermissionsExt;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::{Arc, Barrier};

    let root = std::env::temp_dir().join(format!(
        "oleafly-terminal-channel-close-{}",
        std::process::id()
    ));
    std::fs::remove_dir_all(&root).ok();
    let project = root.join("projects/proj");
    std::fs::create_dir_all(&project).unwrap();
    let shell = root.join("test-shell.sh");
    std::fs::write(
        &shell,
        b"#!/bin/sh\ntrap '' HUP\nprintf '%s\\n' \"$$\" > terminal.pid\nprintf ready\nread ignored\n",
    )
    .unwrap();
    std::fs::set_permissions(&shell, std::fs::Permissions::from_mode(0o700)).unwrap();
    let channel_entered = Arc::new(Barrier::new(2));
    let close_channel = Arc::new(Barrier::new(2));
    let send_attempts = Arc::new(AtomicUsize::new(0));
    let callback_entered = Arc::clone(&channel_entered);
    let callback_close = Arc::clone(&close_channel);
    let callback_attempts = Arc::clone(&send_attempts);
    let channel = Channel::new(move |_| {
        if callback_attempts.fetch_add(1, Ordering::SeqCst) == 0 {
            callback_entered.wait();
            callback_close.wait();
        }
        Err(tauri::Error::AssetNotFound("closed".into()))
    });

    let owner = SessionOwner::new("main", "proj");
    let session_id = open_terminal(
        &project,
        owner.clone(),
        80,
        24,
        channel,
        CommandBuilder::new(&shell),
    )
    .unwrap();
    channel_entered.wait();
    let pid_path = project.join("terminal.pid");
    let pid = std::fs::read_to_string(&pid_path)
        .unwrap()
        .trim()
        .to_string();
    close_channel.wait();

    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(3);
    let mut stopped = false;
    while std::time::Instant::now() < deadline {
        if !std::process::Command::new("kill")
            .no_console()
            .args(["-0", &pid])
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status()
            .is_ok_and(|status| status.success())
        {
            stopped = true;
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(20));
    }
    if !stopped {
        let _ = std::process::Command::new("kill")
            .no_console()
            .args(["-KILL", &pid])
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status();
    }
    let _ = kill_terminal(&owner, &session_id);
    std::thread::sleep(std::time::Duration::from_millis(100));
    std::fs::remove_dir_all(&root).ok();
    assert!(stopped);
    assert_eq!(send_attempts.load(Ordering::SeqCst), 1);
}

#[cfg(unix)]
#[test]
fn term_kill_terminates_background_descendants() {
    use std::os::unix::fs::PermissionsExt;

    let root = std::env::temp_dir().join(format!(
        "oleafly-terminal-process-group-{}",
        std::process::id()
    ));
    std::fs::remove_dir_all(&root).ok();
    let project = root.join("projects/proj");
    std::fs::create_dir_all(&project).unwrap();
    let shell = root.join("test-shell.sh");
    std::fs::write(
        &shell,
        b"#!/bin/sh\ntrap '' HUP TERM\n( trap '' HUP TERM; i=0; until [ -e release ] || [ \"$i\" -ge 1200 ]; do i=$((i + 1)); sleep 0.05; done; touch descendant-marker ) &\nprintf '%s\\n' \"$!\" > descendant.pid\nsleep 10\n",
    )
    .unwrap();
    std::fs::set_permissions(&shell, std::fs::Permissions::from_mode(0o700)).unwrap();
    let channel = Channel::new(|_| Ok(()));
    let owner = SessionOwner::new("main", "proj");
    let session_id = open_terminal(
        &project,
        owner.clone(),
        80,
        24,
        channel,
        CommandBuilder::new(&shell),
    )
    .unwrap();
    let pid_path = project.join("descendant.pid");
    // The shell's `>` creates descendant.pid before printf writes to it, so
    // wait for the pid itself, not for the file.
    let descendant_pid =
        test_wait::read_until_blocking(&pid_path, test_wait::CHILD_PATIENCE, test_wait::pid)
            .expect("the shell never wrote its descendant's pid");

    kill_terminal(&owner, &session_id).unwrap();
    // kill_terminal leaves the kill to a cleanup thread. Release the
    // descendant only once it is gone, or once it has outlived term_kill.
    let deadline = std::time::Instant::now() + test_wait::CHILD_PATIENCE;
    let mut descendant_gone = false;
    while std::time::Instant::now() < deadline {
        if unsafe { libc::kill(descendant_pid, 0) } != 0 {
            descendant_gone = true;
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(20));
    }
    std::fs::write(project.join("release"), b"").unwrap();
    if !descendant_gone {
        // A descendant that outlived term_kill writes its marker once released.
        std::thread::sleep(std::time::Duration::from_millis(500));
    }
    let marker_exists = project.join("descendant-marker").exists();
    if !descendant_gone {
        let _ = std::process::Command::new("kill")
            .no_console()
            .args(["-KILL", &descendant_pid.to_string()])
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status();
    }

    std::fs::remove_dir_all(&root).ok();
    assert!(
        descendant_gone,
        "term_kill left the background descendant running"
    );
    assert!(!marker_exists);
}

#[cfg(unix)]
#[test]
fn term_kill_hangs_up_before_killing() {
    use std::os::unix::fs::PermissionsExt;

    let project = tempfile::tempdir().unwrap();
    let shell = project.path().join("hup-shell.sh");
    std::fs::write(
        &shell,
        b"#!/bin/sh\ntrap 'echo hup > hup.txt; exit 0' HUP\nprintf ready\nwhile :; do sleep 0.05; done\n",
    )
    .unwrap();
    std::fs::set_permissions(&shell, std::fs::Permissions::from_mode(0o700)).unwrap();
    let (events, received) = std::sync::mpsc::channel();
    let channel = Channel::new(move |body| {
        let _ = events.send(body.deserialize::<serde_json::Value>().unwrap());
        Ok(())
    });
    let owner = SessionOwner::new("main", "hangup");
    let id = open_terminal(
        project.path(),
        owner.clone(),
        80,
        24,
        channel,
        CommandBuilder::new(&shell),
    )
    .unwrap();
    let mut output = String::new();
    let deadline = Instant::now() + test_wait::CHILD_PATIENCE;
    while !output.contains("ready") {
        let remaining = deadline.saturating_duration_since(Instant::now());
        match received.recv_timeout(remaining) {
            Ok(event) => {
                if let Some(data) = event["data"].as_str() {
                    output.push_str(data);
                }
            }
            Err(_) => break,
        }
    }
    assert!(output.contains("ready"), "{output:?}");

    kill_terminal(&owner, &id).unwrap();
    let hung_up = test_wait::read_until_blocking(
        &project.path().join("hup.txt"),
        test_wait::CHILD_PATIENCE,
        |text| text.contains("hup").then_some(()),
    );
    assert_eq!(hung_up, Some(()), "the shell was killed without a hang-up");
}

#[cfg(unix)]
#[test]
fn an_idle_shell_is_not_busy() {
    let project = tempfile::tempdir().unwrap();
    let mut shell = CommandBuilder::new("/bin/sh");
    shell.args(["-c", "sleep 30"]);
    let owner = SessionOwner::new("main", "idle-shell");
    let id = open_terminal(
        project.path(),
        owner.clone(),
        80,
        24,
        Channel::new(|_| Ok(())),
        shell,
    )
    .unwrap();
    let session = TerminalTestSession { owner, id };
    std::thread::sleep(Duration::from_millis(200));
    let jobs: Vec<TerminalJob> =
        foreground_probes(&session.owner, Some(std::slice::from_ref(&session.id)))
            .into_iter()
            .filter_map(ForegroundProbe::job)
            .collect();
    assert_eq!(jobs, Vec::new());
}

#[cfg(windows)]
#[test]
fn a_running_command_makes_the_terminal_busy() {
    let project = tempfile::tempdir().unwrap();
    let mut shell = CommandBuilder::new("cmd.exe");
    shell.args(["/D", "/K", "ping", "-n", "30", "127.0.0.1"]);
    let owner = SessionOwner::new("main", "busy-shell");
    let id = open_terminal(
        project.path(),
        owner.clone(),
        80,
        24,
        Channel::new(|_| Ok(())),
        shell,
    )
    .unwrap();
    let session = TerminalTestSession { owner, id };
    let deadline = Instant::now() + Duration::from_secs(10);
    let mut jobs: Vec<TerminalJob> = Vec::new();
    while Instant::now() < deadline {
        jobs = foreground_probes(&session.owner, None)
            .into_iter()
            .filter_map(ForegroundProbe::job)
            .collect();
        if !jobs.is_empty() {
            break;
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    assert_eq!(jobs.len(), 1, "{jobs:?}");
    assert_eq!(jobs[0].id, session.id);
    assert_eq!(
        jobs[0]
            .process
            .as_deref()
            .map(str::to_ascii_lowercase)
            .as_deref(),
        Some("ping")
    );
}

#[cfg(unix)]
#[test]
fn closing_a_window_stops_only_that_windows_shells() {
    let root = std::env::temp_dir().join(format!(
        "oleafly-terminal-window-drain-{}",
        std::process::id()
    ));
    std::fs::remove_dir_all(&root).ok();
    let project = root.join("projects/proj");
    std::fs::create_dir_all(&project).unwrap();
    let idle = || {
        let mut shell = CommandBuilder::new("/bin/sh");
        shell.arg("-c");
        shell.arg("sleep 30");
        shell
    };
    let closing = SessionOwner::new("terminal-drain-window", "proj");
    let staying = SessionOwner::new("terminal-keep-window", "proj");
    let closing_id = open_terminal(
        &project,
        closing.clone(),
        80,
        24,
        Channel::new(|_| Ok(())),
        idle(),
    )
    .unwrap();
    let staying_id = open_terminal(
        &project,
        staying.clone(),
        80,
        24,
        Channel::new(|_| Ok(())),
        idle(),
    )
    .unwrap();

    kill_window_sessions("terminal-window-with-no-shells");
    assert!(write_terminal(&closing, &closing_id, "\n").is_ok());

    kill_window_sessions("terminal-drain-window");
    assert_eq!(
        write_terminal(&closing, &closing_id, "\n").err().as_deref(),
        Some("terminal session is not open")
    );
    assert!(write_terminal(&staying, &staying_id, "\n").is_ok());

    kill_terminal(&staying, &staying_id).unwrap();
    std::fs::remove_dir_all(&root).ok();
}

#[test]
fn the_lifecycle_plugin_carries_a_stable_name() {
    use tauri::plugin::Plugin as _;

    let plugin = lifecycle_plugin::<tauri::test::MockRuntime>();
    assert_eq!(plugin.name(), "terminal-lifecycle");
}

#[test]
fn restricted_projects_refuse_background_shells_and_harden_user_shells() {
    let temp = tempfile::tempdir().unwrap();
    let _restricted = crate::trust::testing::restrict("restricted-terminal-project");
    let refused = super::project_shell(
        "restricted-terminal-project",
        temp.path(),
        true,
        CommandBuilder::new("sh"),
    )
    .err()
    .unwrap();
    assert!(refused.contains("\"code\":\"trust.terminal\""), "{refused}");
    let shell = super::project_shell(
        "restricted-terminal-project",
        temp.path(),
        false,
        CommandBuilder::new("sh"),
    )
    .unwrap();
    let start = std::env::var("GIT_CONFIG_COUNT")
        .ok()
        .and_then(|count| count.parse::<usize>().ok())
        .unwrap_or(0);
    assert_eq!(
        shell
            .get_env(format!("GIT_CONFIG_KEY_{start}"))
            .and_then(|value| value.to_str()),
        Some("core.fsmonitor")
    );
}

#[test]
fn a_trusted_folder_in_an_untrusted_repository_gets_the_restricted_shell() {
    let fixture = crate::trust::testing::LinkedFixture::new();
    let repo = fixture.folders.path().join("repo");
    std::fs::create_dir_all(repo.join(".git")).unwrap();
    std::fs::write(repo.join(".git/HEAD"), "ref: refs/heads/main\n").unwrap();
    let (id, paper) = fixture.link("repo/paper");
    fixture.trust(&id, crate::trust::TrustScope::Folder);
    let refused = super::project_shell(&id, &paper, true, CommandBuilder::new("sh"))
        .err()
        .unwrap();
    assert!(refused.contains("\"code\":\"trust.terminal\""), "{refused}");
    let start = std::env::var("GIT_CONFIG_COUNT")
        .ok()
        .and_then(|count| count.parse::<usize>().ok())
        .unwrap_or(0);
    let hardened = super::project_shell(&id, &paper, false, CommandBuilder::new("sh")).unwrap();
    assert_eq!(
        hardened
            .get_env(format!("GIT_CONFIG_KEY_{start}"))
            .and_then(|value| value.to_str()),
        Some("core.fsmonitor")
    );
    fixture.trust(&id, crate::trust::TrustScope::Repository);
    let plain = super::project_shell(&id, &paper, true, CommandBuilder::new("sh")).unwrap();
    assert!(plain.get_env(format!("GIT_CONFIG_KEY_{start}")).is_none());
}

#[test]
fn term_open_refuses_a_background_shell_for_a_restricted_project() {
    let _env = crate::paths::data_dir_env_lock();
    let data = tempfile::tempdir().unwrap();
    std::env::set_var("OLEAFLY_DATA_DIR", data.path());
    crate::paths::create_project_dir("restricted-term-open").unwrap();
    let _restricted = crate::trust::testing::restrict("restricted-term-open");
    let app = tauri::test::mock_builder()
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .unwrap();
    let main = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
        .build()
        .unwrap();
    let refused = tauri::async_runtime::block_on(term_open(
        main.as_ref().clone(),
        "restricted-term-open".into(),
        80,
        24,
        Some(true),
        None,
        Channel::new(|_| Ok(())),
    ))
    .unwrap_err();
    std::env::remove_var("OLEAFLY_DATA_DIR");
    assert!(refused.contains("\"code\":\"trust.terminal\""), "{refused}");
}

#[test]
fn term_open_rejects_a_folder_outside_the_project() {
    let _env = crate::paths::data_dir_env_lock();
    let data = tempfile::tempdir().unwrap();
    std::env::set_var("OLEAFLY_DATA_DIR", data.path());
    crate::paths::create_project_dir("term-open-outside").unwrap();
    let app = tauri::test::mock_builder()
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .unwrap();
    let main = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
        .build()
        .unwrap();
    let options = TerminalOpenOptions {
        cwd: Some("../outside".into()),
        ..TerminalOpenOptions::default()
    };
    let refused = tauri::async_runtime::block_on(term_open(
        main.as_ref().clone(),
        "term-open-outside".into(),
        80,
        24,
        Some(false),
        Some(options),
        Channel::new(|_| Ok(())),
    ))
    .unwrap_err();
    std::env::remove_var("OLEAFLY_DATA_DIR");
    assert!(refused.contains("not in this project"), "{refused}");
}

#[cfg(unix)]
#[test]
fn term_open_starts_in_a_project_folder_with_the_launch_env() {
    use std::os::unix::fs::PermissionsExt;

    let _env = crate::paths::data_dir_env_lock();
    let data = tempfile::tempdir().unwrap();
    std::env::set_var("OLEAFLY_DATA_DIR", data.path());
    let root = crate::paths::create_project_dir("term-open-folder").unwrap();
    let chapters = root.join("chapters");
    std::fs::create_dir_all(&chapters).unwrap();
    let shell = data.path().join("record-shell");
    std::fs::write(
        &shell,
        b"#!/bin/sh\npwd -P > where.txt\nprintf '%s' \"$LAUNCH_NOTE\" > note.txt\nsleep 10\n",
    )
    .unwrap();
    std::fs::set_permissions(&shell, std::fs::Permissions::from_mode(0o700)).unwrap();
    let app = tauri::test::mock_builder()
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .unwrap();
    let main = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
        .build()
        .unwrap();
    let options = TerminalOpenOptions {
        cwd: Some("chapters".into()),
        env: Some(BTreeMap::from([(
            "LAUNCH_NOTE".to_string(),
            "from the launcher".to_string(),
        )])),
        shell: Some(ShellChoice {
            id: ShellId::Custom,
            path: Some(shell.display().to_string()),
        }),
    };
    let opened = tauri::async_runtime::block_on(term_open(
        main.as_ref().clone(),
        "term-open-folder".into(),
        80,
        24,
        Some(false),
        Some(options),
        Channel::new(|_| Ok(())),
    ));
    std::env::remove_var("OLEAFLY_DATA_DIR");
    let opened = opened.unwrap();
    let _session = TerminalTestSession {
        owner: SessionOwner::new("main", "term-open-folder"),
        id: opened.id.clone(),
    };
    assert_eq!(opened.shell, ShellKind::Posix);
    assert_eq!(opened.shell_id, ShellId::Custom);
    let note = test_wait::read_until_blocking(
        &chapters.join("note.txt"),
        test_wait::CHILD_PATIENCE,
        test_wait::exactly("from the launcher"),
    );
    let place = test_wait::read_until_blocking(
        &chapters.join("where.txt"),
        test_wait::CHILD_PATIENCE,
        |text| text.ends_with('\n').then(|| PathBuf::from(text.trim())),
    );
    assert_eq!(note, Some(()));
    assert_eq!(place, Some(chapters.canonicalize().unwrap()));
}

#[test]
fn trusted_projects_keep_the_plain_shell() {
    let temp = tempfile::tempdir().unwrap();
    let shell = super::project_shell(
        "trusted-terminal-project",
        temp.path(),
        true,
        CommandBuilder::new("sh"),
    )
    .unwrap();
    let start = std::env::var("GIT_CONFIG_COUNT")
        .ok()
        .and_then(|count| count.parse::<usize>().ok())
        .unwrap_or(0);
    assert!(shell.get_env(format!("GIT_CONFIG_KEY_{start}")).is_none());
}
