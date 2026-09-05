use super::{
    catalog, protocol,
    redact::Redactor,
    runtime::{permission_paths_allowed, prompt_usage, AcpRuntime},
    store::Store,
    types::*,
};
use serde_json::json;
use std::{path::Path, sync::Arc, time::Duration};

pub(crate) fn fixture_temp() -> tempfile::TempDir {
    tempfile::Builder::new()
        .prefix("oleafly-acp-fixture-")
        .tempdir()
        .unwrap()
}

pub(crate) fn fixture_definition(extra: Vec<String>, root: &Path) -> AgentDefinition {
    let python =
        catalog::discover("python3").expect("Python 3 is required for ACP protocol fixtures");
    #[cfg(target_os = "macos")]
    let python = python
        .parent()
        .and_then(Path::parent)
        .map(|prefix| prefix.join("Resources/Python.app/Contents/MacOS/Python"))
        .filter(|path| path.is_file())
        .unwrap_or(python);
    let script = Path::new(file!())
        .parent()
        .unwrap()
        .join("tests/fixtures/agent.py");
    let script = if script.is_absolute() {
        script
    } else {
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .join(script.strip_prefix("src-tauri").unwrap_or(&script))
    };
    let mut args = vec!["-u".into(), script.to_string_lossy().into_owned()];
    args.extend(extra);
    args.extend(["--fixture-root".into(), root.to_string_lossy().into_owned()]);
    AgentDefinition {
        id: "fixture-agent".into(),
        name: "Fixture agent".into(),
        version: "1.0.0".into(),
        description: String::new(),
        builtin: false,
        distribution: Distribution {
            command: Some(CommandDistribution {
                executable: python.to_string_lossy().into_owned(),
                args,
            }),
            ..Distribution::default()
        },
    }
}

async fn runtime(extra: Vec<String>) -> (tempfile::TempDir, Arc<AcpRuntime>, SessionSnapshot) {
    let temp = fixture_temp();
    let project = temp.path().join("project");
    std::fs::create_dir(&project).unwrap();
    let runtime = AcpRuntime::new(temp.path().join("acp")).unwrap();
    runtime
        .register(&serde_json::to_string(&fixture_definition(extra, temp.path())).unwrap())
        .unwrap();
    let session = runtime
        .start(StartSession {
            project_id: "test-project".into(),
            project_path: project,
            agent_id: "fixture-agent".into(),
            owner: Some("fixture-window".into()),
            ..StartSession::default()
        })
        .await
        .unwrap();
    (temp, runtime, session)
}

#[test]
fn unknown_capabilities_are_disabled_and_versions_are_checked() {
    let caps = Capabilities::from_initialize(&json!({"protocolVersion":1})).unwrap();
    assert!(!caps.image && !caps.load_session && !caps.resume);
    assert!(Capabilities::from_initialize(&json!({"protocolVersion":2})).is_err());
    let caps = Capabilities::from_initialize(&json!({"protocolVersion":1,"agentCapabilities":{"loadSession":true,"sessionCapabilities":{"resume":{}}}})).unwrap();
    assert!(caps.load_session && caps.resume);
}

#[test]
fn distribution_registration_rejects_ranges_credentials_and_path_traversal() {
    assert!(catalog::package_parts("@example/agent@1.2.3", true).is_ok());
    for package in [
        "agent@latest",
        "agent@^1.0.0",
        "https://example.org/a@1.0.0",
        "../agent@1.0.0",
        "agent@1.0.0;echo",
    ] {
        assert!(catalog::package_parts(package, true).is_err(), "{package}");
    }
    let mut definition = catalog::builtins().remove(0);
    definition
        .distribution
        .npx
        .as_mut()
        .unwrap()
        .args
        .push("--api-key=hidden".into());
    assert!(catalog::validate(&definition).is_err());
    assert!(!catalog::safe_relative(Path::new("../escape")));
    assert!(!catalog::safe_relative(Path::new("C:\\escape")));
    assert!(catalog::safe_relative(Path::new("./bin/agent")));
}

#[tokio::test]
async fn malformed_oversized_and_truncated_frames_fail() {
    use tokio::io::BufReader;
    let value = b"{\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{}}\n";
    assert!(protocol::read_frame(&mut BufReader::new(&value[..]))
        .await
        .unwrap()
        .is_some());
    assert!(
        protocol::read_frame(&mut BufReader::new(&b"not json\n"[..]))
            .await
            .is_err()
    );
    assert!(
        protocol::read_frame(&mut BufReader::new(&b"{\"jsonrpc\":\"2.0\"}"[..]))
            .await
            .is_err()
    );
    let oversized = vec![b'x'; protocol::MAX_FRAME + 1];
    assert!(protocol::read_frame(&mut BufReader::new(&oversized[..]))
        .await
        .is_err());
}

#[tokio::test]
async fn controlled_process_negotiates_streams_persists_and_resumes_without_duplicates() {
    let raw_input_marker = new_id();
    let (temp, runtime, snapshot) = runtime(vec![
        String::new(),
        "--raw-input-marker".into(),
        raw_input_marker.clone(),
    ])
    .await;
    let id = snapshot.session.id;
    assert_eq!(snapshot.session.agent_version.as_deref(), Some("1.2.3"));
    assert!(snapshot.session.capabilities.image);
    assert!(runtime.set_model(&id, "stale-model").await.is_err());
    let model = runtime.set_model(&id, "fixture-second").await.unwrap();
    assert_eq!(
        model.session.controls.model_id.as_deref(),
        Some("fixture-second")
    );
    let finished = runtime
        .prompt(&id, "Hello".into(), Vec::new())
        .await
        .unwrap();
    assert_eq!(finished.session.status, SessionStatus::Ready);
    let events = runtime.events(&id, 0, 500).unwrap().events;
    let kinds: Vec<_> = events.iter().map(|event| event.kind.as_str()).collect();
    assert!(kinds
        .windows(3)
        .any(|kinds| kinds == ["agent_thought_chunk", "tool_call", "tool_call_update"]));
    assert!(events.iter().any(|event| event.kind == "usage"
        && event.data["source"] == "acp_prompt"
        && event.data["inputTokens"] == 11));
    assert!(events.iter().any(|event| event.kind == "usage"
        && event.data["source"] == "acp_context"
        && event.data["inputTokens"].is_null()));
    assert!(!serde_json::to_string(&events)
        .unwrap()
        .contains(&raw_input_marker));
    assert!(events
        .iter()
        .all(|event| event.data.get("rawInput").is_none()));
    runtime.close(&id).await.unwrap();
    let before = runtime.events(&id, 0, 500).unwrap().events.len();
    let reopened = runtime
        .reconnect(&id, Some("fixture-window".into()))
        .await
        .unwrap();
    assert_eq!(reopened.session.status, SessionStatus::Ready);
    assert_eq!(
        runtime.events(&id, 0, 500).unwrap().events.len(),
        before + 1
    );
    runtime.close(&id).await.unwrap();
    drop(runtime);
    let restarted = AcpRuntime::new(temp.path().join("acp")).unwrap();
    assert_eq!(restarted.list("test-project").unwrap().len(), 1);
    assert!(restarted
        .events(&id, 0, 500)
        .unwrap()
        .events
        .iter()
        .any(|event| event.kind == "user_message"));
}

#[tokio::test]
async fn permission_replies_are_scoped_validated_and_expire_on_cancellation() {
    let (_temp, runtime, snapshot) = runtime(Vec::new()).await;
    let id = snapshot.session.id;
    let task_runtime = runtime.clone();
    let task_id = id.clone();
    let task = tokio::spawn(async move {
        task_runtime
            .prompt(&task_id, "permission".into(), Vec::new())
            .await
    });
    let permission = tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            let snapshot = runtime.snapshot(&id).await.unwrap();
            if let Some(permission) = snapshot.permissions.first() {
                break permission.clone();
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .unwrap();
    assert!(runtime
        .resolve_permission(&id, &permission.id, Some("invented".into()))
        .await
        .is_err());
    assert!(runtime
        .resolve_permission("another-session", &permission.id, Some("yes".into()))
        .await
        .is_err());
    runtime
        .resolve_permission(&id, &permission.id, Some("no".into()))
        .await
        .unwrap();
    assert!(task.await.unwrap().is_ok());
    assert!(runtime
        .resolve_permission(&id, &permission.id, Some("yes".into()))
        .await
        .is_err());
    let task_runtime = runtime.clone();
    let task_id = id.clone();
    let task = tokio::spawn(async move {
        task_runtime
            .prompt(&task_id, "permission".into(), Vec::new())
            .await
    });
    let second = tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            let snapshot = runtime.snapshot(&id).await.unwrap();
            if let Some(permission) = snapshot.permissions.first() {
                break permission.id.clone();
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .unwrap();
    runtime.cancel(&id).await.unwrap();
    let _ = task.await.unwrap();
    assert!(runtime
        .resolve_permission(&id, &second, Some("yes".into()))
        .await
        .is_err());
    assert!(runtime.snapshot(&id).await.unwrap().permissions.is_empty());
}

#[tokio::test]
async fn authentication_is_owned_by_the_agent_and_recovers() {
    let (_temp, runtime, snapshot) = runtime(vec!["".into(), "--require-login".into()]).await;
    assert_eq!(snapshot.session.status, SessionStatus::AuthRequired);
    assert!(runtime
        .authenticate(&snapshot.session.id, "unknown")
        .await
        .is_err());
    let ready = runtime
        .authenticate(&snapshot.session.id, "fixture-login")
        .await
        .unwrap();
    assert_eq!(ready.session.status, SessionStatus::Ready);
    runtime.close(&snapshot.session.id).await.unwrap();
}

#[tokio::test]
async fn crash_retains_partial_transcript_and_no_pending_requests() {
    let (_temp, runtime, snapshot) = runtime(Vec::new()).await;
    assert!(runtime
        .prompt(&snapshot.session.id, "crash".into(), Vec::new())
        .await
        .is_err());
    let events = runtime.events(&snapshot.session.id, 0, 500).unwrap().events;
    assert!(events
        .iter()
        .any(|event| event.data["content"]["text"] == "Partial saved answer"));
    assert!(events
        .iter()
        .any(|event| event.kind == "turn_complete" && event.data["stopReason"] == "error"));
}

#[cfg(unix)]
#[tokio::test]
async fn cancellation_reaps_a_real_descendant_process() {
    let (temp, runtime, snapshot) = runtime(vec!["child.pid".into()]).await;
    let pid_path = temp.path().join("child.pid");
    let id = snapshot.session.id;
    let task_runtime = runtime.clone();
    let task_id = id.clone();
    let task = tokio::spawn(async move {
        task_runtime
            .prompt(&task_id, "hang".into(), Vec::new())
            .await
    });
    let pid = tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            if let Ok(pid) = std::fs::read_to_string(&pid_path) {
                if let Ok(pid) = pid.parse::<i32>() {
                    break pid;
                }
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .unwrap();
    assert_eq!(unsafe { libc::kill(pid, 0) }, 0);
    runtime.cancel(&id).await.unwrap();
    let _ = task.await.unwrap();
    tokio::time::timeout(Duration::from_secs(5), async {
        while unsafe { libc::kill(pid, 0) } == 0 {
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    })
    .await
    .unwrap();
}

#[test]
fn path_policy_denies_symlink_escapes_and_parent_components() {
    let temp = tempfile::tempdir().unwrap();
    let project = temp.path().join("project");
    std::fs::create_dir(&project).unwrap();
    let root = project.canonicalize().unwrap();
    assert!(permission_paths_allowed(
        &root,
        &json!({"locations":[{"path":"paper.tex"}]})
    ));
    assert!(!permission_paths_allowed(
        &root,
        &json!({"locations":[{"path":"../outside"}]})
    ));
    assert!(!permission_paths_allowed(
        &root,
        &json!({"rawInput":{"path":"/etc/passwd"}})
    ));
    #[cfg(unix)]
    {
        std::os::unix::fs::symlink(temp.path(), root.join("linked")).unwrap();
        assert!(!permission_paths_allowed(
            &root,
            &json!({"locations":[{"path":root.join("linked/new.txt")}]})
        ));
    }
}

#[test]
fn missing_usage_is_not_zero_or_context_input() {
    let counters = prompt_usage(&json!({"usage":{"outputTokens":4}})).unwrap();
    assert!(counters.input_tokens.is_none() && counters.cache_read_tokens.is_none());
    assert_eq!(counters.output_tokens, Some(4));
    assert!(prompt_usage(&json!({"stopReason":"end_turn"})).is_none());
}

#[test]
fn secrets_are_removed_from_text_tools_and_permission_payloads() {
    let redactor = Redactor::new(&[
        json!({"headers":[{"name":"Authorization","value":"Bearer bare-secret-123456"}]}),
    ]);
    for value in [
        json!("Bearer bare-secret-123456"),
        json!("echo bare-secret-123456"),
        json!({"title":"Allow bare-secret-123456?","password":"hidden"}),
        json!({"content":[{"text":"key: bare-secret-123456"}],"rawInput":{"token":"hidden"}}),
    ] {
        let redacted = redactor.value(&value).to_string();
        assert!(!redacted.contains("bare-secret-123456"));
        assert!(!redacted.contains("hidden"));
    }
}

#[test]
fn archive_escape_and_symlinks_are_rejected() {
    use std::io::Write;
    let temp = tempfile::tempdir().unwrap();
    let mut zip = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
    let options: zip::write::FileOptions<'_, ()> = zip::write::FileOptions::default();
    zip.start_file("../escape", options).unwrap();
    zip.write_all(b"x").unwrap();
    let bytes = zip.finish().unwrap().into_inner();
    assert!(catalog::extract(&bytes, true, temp.path()).is_err());
    assert!(!temp.path().parent().unwrap().join("escape").exists());
    let mut archive = tar::Builder::new(Vec::new());
    let mut header = tar::Header::new_gnu();
    header.set_entry_type(tar::EntryType::Symlink);
    header.set_size(0);
    header.set_mode(0o600);
    header.set_link_name("/etc/passwd").unwrap();
    header.set_cksum();
    archive.append_data(&mut header, "link", &b""[..]).unwrap();
    let mut gzip = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::default());
    gzip.write_all(&archive.into_inner().unwrap()).unwrap();
    assert!(catalog::extract(&gzip.finish().unwrap(), false, temp.path()).is_err());
}

#[test]
fn reopening_storage_recovers_running_status_without_erasing_events() {
    let temp = tempfile::tempdir().unwrap();
    let store = Store::open(temp.path()).unwrap();
    let session = SessionRecord {
        id: new_id(),
        project_id: "p".into(),
        project_path: temp.path().to_string_lossy().into_owned(),
        agent_id: "a".into(),
        agent_version: None,
        native_session_id: Some("native".into()),
        parent_session_id: None,
        task_id: None,
        title: "Test".into(),
        status: SessionStatus::Running,
        created_at: 1,
        updated_at: 1,
        turn_id: Some("turn".into()),
        capabilities: Capabilities::default(),
        controls: SessionControls::default(),
        auth_methods: Vec::new(),
        error: None,
        last_sequence: 1,
    };
    store.save(&session).unwrap();
    let event = AcpEvent {
        session_id: session.id.clone(),
        project_id: "p".into(),
        agent_id: "a".into(),
        model_id: None,
        task_id: None,
        turn_id: Some("turn".into()),
        sequence: 1,
        timestamp: 1,
        kind: "agent_message_chunk".into(),
        data: json!({"content":{"type":"text","text":"partial"}}),
    };
    store.append(&session, &event).unwrap();
    drop(store);
    let reopened = Store::open(temp.path()).unwrap();
    assert_eq!(
        reopened.get(&session.id).unwrap().status,
        SessionStatus::Disconnected
    );
    assert_eq!(
        reopened.events(&session.id, 0, 100).unwrap().events.len(),
        1
    );
}

#[test]
fn task_credentials_are_copied_narrowly_and_redacted() {
    let home = tempfile::tempdir().unwrap();
    let temporary = tempfile::tempdir().unwrap();
    std::fs::create_dir(home.path().join(".codex")).unwrap();
    std::fs::write(home.path().join(".codex/auth.json"), br#"{"tokens":{"accessToken":"scoped-access-token-123","refresh_token":"scoped-refresh-token-123"}}"#).unwrap();
    std::fs::write(
        home.path().join(".codex/config.toml"),
        "hook = 'must not copy'",
    )
    .unwrap();
    std::fs::create_dir(home.path().join(".codex/sessions")).unwrap();
    let redactor =
        super::task_launch::prepare_credentials(home.path(), temporary.path(), "codex", &[])
            .unwrap();
    assert!(temporary.path().join(".codex/auth.json").is_file());
    assert!(!temporary.path().join(".codex/config.toml").exists());
    assert!(!temporary.path().join(".codex/sessions").exists());
    assert!(!redactor
        .text("echo scoped-access-token-123 scoped-refresh-token-123")
        .contains("scoped-"));
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        assert_eq!(
            std::fs::metadata(temporary.path().join(".codex/auth.json"))
                .unwrap()
                .permissions()
                .mode()
                & 0o777,
            0o600
        );
    }
}

#[cfg(unix)]
#[test]
fn task_credentials_reject_a_symlink_source() {
    let home = tempfile::tempdir().unwrap();
    let temporary = tempfile::tempdir().unwrap();
    std::fs::create_dir(home.path().join(".codex")).unwrap();
    std::fs::write(home.path().join("unrelated.json"), "{}").unwrap();
    std::os::unix::fs::symlink(
        home.path().join("unrelated.json"),
        home.path().join(".codex/auth.json"),
    )
    .unwrap();
    assert!(
        super::task_launch::prepare_credentials(home.path(), temporary.path(), "codex", &[])
            .is_err()
    );
}

#[test]
fn task_availability_distinguishes_platform_and_agent_family() {
    let definitions = catalog::builtins();
    let codex = definitions
        .iter()
        .find(|definition| definition.id == "codex")
        .unwrap();
    assert!(catalog::task_unavailable_reason_for(codex, "macos")
        .unwrap()
        .contains("child processes"));
    assert!(catalog::task_unavailable_reason_for(codex, "linux").is_none());
    let mut renamed = codex.clone();
    renamed.id = "my-custom-agent".into();
    assert!(catalog::task_unavailable_reason_for(&renamed, "macos").is_some());
    for definition in definitions {
        assert!(catalog::task_unavailable_reason_for(&definition, "windows").is_some());
        if definition.id != "codex" {
            assert!(catalog::task_unavailable_reason_for(&definition, "macos").is_none());
        }
    }
}

fn pending_runtime(extra: Vec<String>) -> (tempfile::TempDir, Arc<AcpRuntime>, StartSession) {
    let temp = fixture_temp();
    let project = temp.path().join("project");
    std::fs::create_dir(&project).unwrap();
    let runtime = AcpRuntime::new(temp.path().join("acp")).unwrap();
    runtime
        .register(&serde_json::to_string(&fixture_definition(extra, temp.path())).unwrap())
        .unwrap();
    let options = StartSession {
        project_id: "test-project".into(),
        project_path: project,
        agent_id: "fixture-agent".into(),
        owner: Some("fixture-window".into()),
        ..StartSession::default()
    };
    (temp, runtime, options)
}

#[tokio::test]
async fn credentials_in_protocol_metadata_never_reach_snapshots_events_or_storage() {
    let token = "bare-mcp-fixture-token-123456";
    for scenario in [
        "--leak-session-id",
        "--leak-config-id",
        "--leak-config-value",
        "--leak-model-response",
        "leak-model",
        "leak-config",
        "leak-permission-tool",
        "leak-permission-option",
        "leak-error",
    ] {
        let (temp, runtime, options) = pending_runtime(vec!["".into(), scenario.into()]);
        let result = runtime
            .start_with_mcp(
                options,
                vec![json!({
                    "type": "http", "name": "fixture-tools", "url": "http://127.0.0.1:1/mcp",
                    "headers": [{"name": "Authorization", "value": format!("Bearer {token}")}]
                })],
            )
            .await;
        if matches!(
            scenario,
            "--leak-session-id" | "--leak-config-id" | "--leak-config-value"
        ) {
            assert!(result.is_err(), "{scenario}");
        } else {
            let id = result.unwrap().session.id;
            let result = if scenario == "--leak-model-response" {
                runtime.set_model(&id, "fixture-second").await
            } else {
                tokio::time::timeout(
                    Duration::from_secs(5),
                    runtime.prompt(&id, scenario.into(), Vec::new()),
                )
                .await
                .unwrap()
            };
            assert!(result.is_err(), "{scenario}");
            let snapshot = runtime.snapshot(&id).await.unwrap();
            assert!(snapshot.permissions.is_empty(), "{scenario}");
            assert!(
                !serde_json::to_string(&snapshot).unwrap().contains(token),
                "{scenario}"
            );
            assert!(
                runtime.assert_owner(&id, "fixture-window").await.is_err(),
                "{scenario}"
            );
        }
        for record in runtime.list("test-project").unwrap() {
            assert!(
                !serde_json::to_string(&record).unwrap().contains(token),
                "{scenario}"
            );
            let events = runtime.events(&record.id, 0, 500).unwrap();
            assert!(
                !serde_json::to_string(&events).unwrap().contains(token),
                "{scenario}"
            );
        }
        runtime.shutdown_all().await;
        for entry in std::fs::read_dir(temp.path().join("acp")).unwrap() {
            let path = entry.unwrap().path();
            if path.is_file() {
                let bytes = std::fs::read(path).unwrap();
                assert!(
                    !bytes
                        .windows(token.len())
                        .any(|window| window == token.as_bytes()),
                    "{scenario}"
                );
            }
        }
    }
}

struct DropCounter(Arc<std::sync::atomic::AtomicUsize>);

impl Drop for DropCounter {
    fn drop(&mut self) {
        self.0.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
    }
}

#[tokio::test]
async fn closing_finished_sessions_releases_capacity_and_bridge_resources() {
    let (_temp, runtime, options) = pending_runtime(Vec::new());
    let dropped = Arc::new(std::sync::atomic::AtomicUsize::new(0));
    for completed in 1..=12 {
        let snapshot = runtime.start(options.clone()).await.unwrap();
        let id = snapshot.session.id;
        runtime
            .retain_resource(&id, DropCounter(dropped.clone()))
            .await
            .unwrap();
        runtime
            .prompt(&id, "Hello".into(), Vec::new())
            .await
            .unwrap();
        runtime.close(&id).await.unwrap();
        assert_eq!(dropped.load(std::sync::atomic::Ordering::SeqCst), completed);
        let events = runtime.events(&id, 0, 500).unwrap().events;
        assert_eq!(
            events
                .iter()
                .filter(|event| event.kind == "turn_complete")
                .count(),
            1
        );
        assert!(!events
            .iter()
            .any(|event| event.data["status"] == "cancelled"));
    }
}

#[tokio::test]
async fn disconnected_sessions_reject_late_bridge_retention() {
    let (_temp, runtime, snapshot) = runtime(Vec::new()).await;
    let id = snapshot.session.id;
    runtime.close(&id).await.unwrap();
    let dropped = Arc::new(std::sync::atomic::AtomicUsize::new(0));
    assert!(runtime
        .retain_resource(&id, DropCounter(dropped.clone()))
        .await
        .is_err());
    assert_eq!(dropped.load(std::sync::atomic::Ordering::SeqCst), 1);
}

#[tokio::test]
async fn window_close_invalidates_a_start_waiting_for_its_tool_bridge() {
    let (_temp, runtime, options) = pending_runtime(Vec::new());
    let generation = runtime.owner_generation("fixture-window");
    let (ready_tx, ready_rx) = tokio::sync::oneshot::channel();
    let (resume_tx, resume_rx) = tokio::sync::oneshot::channel();
    let pending = runtime.clone();
    let start = tokio::spawn(async move {
        let _startup = pending.begin_startup().unwrap();
        ready_tx.send(()).unwrap();
        resume_rx.await.unwrap();
        pending
            .start_with_mcp_at_generation(options, Vec::new(), Some(generation))
            .await
    });
    ready_rx.await.unwrap();
    runtime.close_owner("fixture-window").await;
    resume_tx.send(()).unwrap();
    assert!(start.await.unwrap().is_err());
    assert!(runtime.list("test-project").unwrap().is_empty());
}

#[tokio::test]
async fn shutdown_waits_for_pending_starts_and_rejects_later_starts() {
    let (_temp, runtime, options) = pending_runtime(Vec::new());
    let generation = runtime.owner_generation("fixture-window");
    let (ready_tx, ready_rx) = tokio::sync::oneshot::channel();
    let (resume_tx, resume_rx) = tokio::sync::oneshot::channel();
    let pending = runtime.clone();
    let late_options = options.clone();
    let start = tokio::spawn(async move {
        let _startup = pending.begin_startup().unwrap();
        ready_tx.send(()).unwrap();
        resume_rx.await.unwrap();
        pending
            .start_with_mcp_at_generation(late_options, Vec::new(), Some(generation))
            .await
    });
    ready_rx.await.unwrap();
    let closing = runtime.clone();
    let shutdown = tokio::spawn(async move {
        closing.shutdown_all().await;
    });
    tokio::time::timeout(Duration::from_secs(5), async {
        while runtime.begin_startup().is_ok() {
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    assert!(!shutdown.is_finished());
    resume_tx.send(()).unwrap();
    assert!(start.await.unwrap().is_err());
    tokio::time::timeout(Duration::from_secs(5), shutdown)
        .await
        .unwrap()
        .unwrap();
    assert!(runtime.start(options).await.is_err());
    assert!(runtime.list("test-project").unwrap().is_empty());
}

#[tokio::test]
async fn shutdown_reaps_an_agent_waiting_for_initialization() {
    let (temp, runtime, options) =
        pending_runtime(vec!["agent.pid".into(), "--initialize-barrier".into()]);
    let pid_path = temp.path().join("agent.pid");
    let pending = runtime.clone();
    let start = tokio::spawn(async move { pending.start(options).await });
    let pid = tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            if let Ok(contents) = std::fs::read_to_string(&pid_path) {
                if let Ok(pid) = contents.parse::<u32>() {
                    break pid;
                }
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        assert_eq!(
            std::fs::metadata(&pid_path).unwrap().permissions().mode() & 0o777,
            0o600
        );
    }
    tokio::time::timeout(Duration::from_secs(5), runtime.shutdown_all())
        .await
        .unwrap();
    assert!(start.await.unwrap().is_err());
    #[cfg(unix)]
    assert_ne!(unsafe { libc::kill(pid as i32, 0) }, 0);
    #[cfg(not(unix))]
    let _ = pid;
    for record in runtime.list("test-project").unwrap() {
        assert!(runtime
            .assert_owner(&record.id, "fixture-window")
            .await
            .is_err());
    }
}

#[cfg(unix)]
#[tokio::test]
async fn cancellation_reaps_processes_and_releases_resources_when_persistence_fails() {
    let (temp, runtime, snapshot) = runtime(vec!["child.pid".into()]).await;
    let pid_path = temp.path().join("child.pid");
    let id = snapshot.session.id;
    let dropped = Arc::new(std::sync::atomic::AtomicUsize::new(0));
    runtime
        .retain_resource(&id, DropCounter(dropped.clone()))
        .await
        .unwrap();
    let prompting = runtime.clone();
    let prompt_id = id.clone();
    let prompt = tokio::spawn(async move {
        prompting
            .prompt(&prompt_id, "hang".into(), Vec::new())
            .await
    });
    let pid = tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            if let Ok(contents) = std::fs::read_to_string(&pid_path) {
                if let Ok(pid) = contents.parse::<i32>() {
                    break pid;
                }
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .unwrap();
    let database = rusqlite::Connection::open(temp.path().join("acp/sessions.sqlite")).unwrap();
    database.execute_batch("CREATE TRIGGER reject_event BEFORE INSERT ON events BEGIN SELECT RAISE(FAIL, 'fixture journal unavailable'); END;").unwrap();
    let error = runtime.cancel(&id).await.unwrap_err();
    assert!(error.contains("could not be saved"));
    assert_eq!(dropped.load(std::sync::atomic::Ordering::SeqCst), 1);
    assert_ne!(unsafe { libc::kill(pid, 0) }, 0);
    assert!(runtime.assert_owner(&id, "fixture-window").await.is_err());
    let _ = prompt.await.unwrap();
}

#[test]
fn permission_prefix_aliases_preserve_drive_and_share_boundaries() {
    use super::runtime::equivalent_path_prefixes;
    use std::{ffi::OsStr, path::Prefix};
    assert!(equivalent_path_prefixes(
        Prefix::Disk(b'C'),
        Prefix::VerbatimDisk(b'C')
    ));
    assert!(equivalent_path_prefixes(
        Prefix::VerbatimDisk(b'C'),
        Prefix::Disk(b'c')
    ));
    assert!(!equivalent_path_prefixes(
        Prefix::Disk(b'D'),
        Prefix::VerbatimDisk(b'C')
    ));
    let server = OsStr::new("server");
    let share = OsStr::new("project-share");
    assert!(equivalent_path_prefixes(
        Prefix::UNC(server, share),
        Prefix::VerbatimUNC(server, share)
    ));
    assert!(!equivalent_path_prefixes(
        Prefix::UNC(OsStr::new("other-server"), share),
        Prefix::VerbatimUNC(server, share)
    ));
    assert!(!equivalent_path_prefixes(
        Prefix::UNC(server, OsStr::new("other-share")),
        Prefix::VerbatimUNC(server, share)
    ));
    assert!(!equivalent_path_prefixes(
        Prefix::DeviceNS(OsStr::new("C:")),
        Prefix::VerbatimDisk(b'C')
    ));
}

#[cfg(windows)]
#[test]
fn permission_paths_accept_plain_and_verbatim_windows_paths() {
    use std::os::windows::ffi::{OsStrExt, OsStringExt};
    use windows_sys::Win32::Storage::FileSystem::GetShortPathNameW;

    fn short_path(path: &Path) -> std::path::PathBuf {
        let input: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
        let mut output = vec![0u16; 32_768];
        let written =
            unsafe { GetShortPathNameW(input.as_ptr(), output.as_mut_ptr(), output.len() as u32) }
                as usize;
        assert!(written > 0 && written < output.len());
        std::ffi::OsString::from_wide(&output[..written]).into()
    }

    let temp = tempfile::tempdir().unwrap();
    let project = temp.path().join("project with a long directory name");
    std::fs::create_dir(&project).unwrap();
    std::fs::write(project.join("existing.tex"), "fixture").unwrap();
    let root = project.canonicalize().unwrap();
    let short = short_path(&project);
    for path in [
        project.join("existing.tex"),
        project.join("new.tex"),
        root.join("existing.tex"),
        root.join("new.tex"),
        short.join("existing.tex"),
        short.join("new.tex"),
        short.join("new-directory/nested/new.tex"),
        short_path(&project.join("existing.tex")),
    ] {
        assert!(
            permission_paths_allowed(&root, &json!({"locations":[{"path":path}]})),
            "{}",
            path.display()
        );
    }
    let sibling = temp.path().join("project-other");
    std::fs::create_dir(&sibling).unwrap();
    for path in [
        sibling.join("new.tex"),
        short_path(&sibling).join("new.tex"),
        project.join("../outside.tex"),
        root.join("../outside.tex"),
        short.join("../outside.tex"),
    ] {
        assert!(
            !permission_paths_allowed(&root, &json!({"locations":[{"path":path}]})),
            "{}",
            path.display()
        );
    }
}

#[cfg(windows)]
#[test]
fn permission_alias_expansion_preserves_junction_boundaries() {
    fn junction(target: &Path, link: &Path) {
        let output = std::process::Command::new("cmd.exe")
            .args(["/D", "/C", "mklink", "/J"])
            .arg(link)
            .arg(target)
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "{}\n{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
    }

    let temp = tempfile::tempdir().unwrap();
    let project = temp.path().join("project");
    let outside = temp.path().join("outside");
    std::fs::create_dir(&project).unwrap();
    std::fs::create_dir(&outside).unwrap();
    let root = project.canonicalize().unwrap();
    let outward = project.join("linked-outside");
    let inward = outside.join("linked-project");
    junction(&outside, &outward);
    junction(&project, &inward);
    for path in [outward.join("new.tex"), inward.join("new.tex")] {
        assert!(
            !permission_paths_allowed(&root, &json!({"locations":[{"path":path}]})),
            "{}",
            path.display()
        );
    }
    std::fs::remove_dir(outward).unwrap();
    std::fs::remove_dir(inward).unwrap();
}

#[tokio::test]
async fn fixture_pid_paths_stay_in_the_harness_and_do_not_overwrite_files() {
    for outside in [true, false] {
        let (temp, runtime, options) = pending_runtime(Vec::new());
        let external = tempfile::tempdir().unwrap();
        let outside_pid = external.path().join("agent.pid");
        let existing_pid = temp.path().join("agent.pid");
        std::fs::write(&existing_pid, "keep fixture contents").unwrap();
        let requested = if outside {
            outside_pid.to_string_lossy().into_owned()
        } else {
            "agent.pid".into()
        };
        runtime
            .register(
                &serde_json::to_string(&fixture_definition(
                    vec![requested, "--initialize-barrier".into()],
                    temp.path(),
                ))
                .unwrap(),
            )
            .unwrap();
        let started = tokio::time::timeout(Duration::from_secs(3), runtime.start(options)).await;
        runtime.shutdown_all().await;
        assert!(started
            .expect("The fixture did not reject the PID path")
            .is_err());
        assert!(!outside_pid.exists());
        assert_eq!(
            std::fs::read_to_string(existing_pid).unwrap(),
            "keep fixture contents"
        );
    }
}

#[cfg(unix)]
#[tokio::test]
async fn fixture_pid_paths_reject_symlink_escapes() {
    let (temp, runtime, options) =
        pending_runtime(vec!["agent.pid".into(), "--initialize-barrier".into()]);
    let external = tempfile::tempdir().unwrap();
    let outside_pid = external.path().join("agent.pid");
    std::os::unix::fs::symlink(&outside_pid, temp.path().join("agent.pid")).unwrap();
    let started = tokio::time::timeout(Duration::from_secs(3), runtime.start(options)).await;
    runtime.shutdown_all().await;
    assert!(started
        .expect("The fixture followed the PID symlink")
        .is_err());
    assert!(!outside_pid.exists());
}
