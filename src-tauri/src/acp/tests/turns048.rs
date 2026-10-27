//! 0.4.8 turn behavior against the fixture agent: usage metadata, the
//! hidden plan-usage turn, questions, file reads, steering, events outside
//! turns, coalescing and ACP v2.
use super::super::buffers::BufferSource;
use super::super::types::*;
use super::{fixture_definition, fixture_temp, runtime};
use crate::acp::AcpRuntime;
use futures_util::future::BoxFuture;
use serde_json::{json, Value};
use std::sync::Arc;
use std::time::Duration;

fn kinds(events: &[AcpEvent]) -> Vec<String> {
    events.iter().map(|event| event.kind.clone()).collect()
}

fn texts(events: &[AcpEvent]) -> String {
    events
        .iter()
        .filter(|event| event.kind == "agent_message_chunk")
        .filter_map(|event| event.data["content"]["text"].as_str())
        .collect()
}

#[tokio::test]
async fn usage_meta_reaches_the_record_but_not_the_transcript() {
    let (_temp, runtime, session) = runtime(Vec::new()).await;
    let id = session.session.id.clone();
    let snapshot = runtime
        .prompt(&id, "usage-meta".into(), Vec::new())
        .await
        .unwrap();
    let usage = snapshot.session.usage.unwrap();
    assert_eq!(usage.context_used, Some(900));
    assert_eq!(usage.cost_amount, Some(0.42));
    assert_eq!(usage.rate_limits[0].status, "allowed_warning");
    assert_eq!(usage.model.as_deref(), Some("opus"));
    assert_eq!(usage.last_turn.unwrap().thought_tokens, Some(1));
    let stored = serde_json::to_string(&runtime.events_all(&id).unwrap()).unwrap();
    assert!(!stored.contains("_claude/rateLimit"));
    runtime.close(&id).await.unwrap();
}

#[tokio::test]
async fn refreshing_plan_usage_runs_a_hidden_turn() {
    let (_temp, runtime, session) = runtime(vec!["--commands-on-start".into()]).await;
    let id = session.session.id.clone();
    // The agent lists its commands in an update just after the session
    // starts, which can arrive after the start returns.
    tokio::time::timeout(Duration::from_secs(5), async {
        while runtime
            .snapshot(&id)
            .await
            .unwrap()
            .session
            .available_commands
            .is_empty()
        {
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    })
    .await
    .expect("the agent never listed its commands");
    let before = runtime.snapshot(&id).await.unwrap().session.last_sequence;
    let snapshot = runtime.refresh_plan_usage(&id).await.unwrap();
    assert!(snapshot
        .session
        .usage
        .unwrap()
        .plan_markdown
        .unwrap()
        .starts_with("## Usage"));
    let after = runtime.events(&id, before, 500).unwrap().events;
    assert!(!kinds(&after).iter().any(|kind| [
        "user_message",
        "agent_message_chunk",
        "turn_complete"
    ]
    .contains(&kind.as_str())));
    runtime.close(&id).await.unwrap();
}

#[tokio::test]
async fn plan_usage_is_refused_for_agents_without_usage_or_status() {
    let (_temp, runtime, session) = runtime(Vec::new()).await;
    let id = session.session.id.clone();
    assert_eq!(
        runtime.refresh_plan_usage(&id).await.unwrap_err(),
        "This agent does not report plan usage."
    );
    runtime.close(&id).await.unwrap();
}

#[tokio::test]
async fn available_commands_arrive_before_the_first_turn() {
    let (_temp, runtime, session) = runtime(vec!["--commands-on-start".into()]).await;
    let id = session.session.id.clone();
    let mut commands = Vec::new();
    for _ in 0..100 {
        commands = runtime
            .snapshot(&id)
            .await
            .unwrap()
            .session
            .available_commands;
        if !commands.is_empty() {
            break;
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    assert_eq!(commands.len(), 2);
    assert_eq!(commands[1].hint.as_deref(), Some("file"));
    runtime.close(&id).await.unwrap();
}

#[tokio::test]
async fn updates_outside_turns_keep_titles_notices_and_compactions() {
    let (_temp, runtime, session) = runtime(Vec::new()).await;
    let id = session.session.id.clone();
    runtime
        .prompt(&id, "outside-events".into(), Vec::new())
        .await
        .unwrap();
    let mut events = Vec::new();
    for _ in 0..200 {
        events = runtime.events_all(&id).unwrap();
        if events
            .iter()
            .any(|event| event.kind == "compaction" && event.data["status"] == "completed")
        {
            break;
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    let snapshot = runtime.snapshot(&id).await.unwrap();
    assert_eq!(snapshot.session.title, "Agent title");
    assert_eq!(snapshot.session.status, SessionStatus::Ready);
    let notice = events.iter().find(|event| event.kind == "notice").unwrap();
    assert_eq!(notice.data["description"].as_str().unwrap().len(), 2000);
    let completed = events
        .iter()
        .find(|event| event.kind == "compaction" && event.data["status"] == "completed")
        .unwrap();
    assert_eq!(completed.data["summary"], "abc");
    assert!(!texts(&events).contains("Not kept outside a turn"));
    // A renamed conversation keeps its name.
    runtime.rename_session(&id, "My title").await.unwrap();
    runtime
        .prompt(&id, "outside-events".into(), Vec::new())
        .await
        .unwrap();
    tokio::time::sleep(Duration::from_millis(200)).await;
    assert_eq!(
        runtime.snapshot(&id).await.unwrap().session.title,
        "My title"
    );
    runtime.close(&id).await.unwrap();
}

#[tokio::test]
async fn a_form_question_waits_and_its_answer_is_never_stored() {
    let (temp, runtime, session) = runtime(Vec::new()).await;
    let id = session.session.id.clone();
    let prompting = runtime.clone();
    let prompt_id = id.clone();
    let turn = tokio::spawn(async move {
        prompting
            .prompt(&prompt_id, "ask-form".into(), Vec::new())
            .await
    });
    let mut question = None;
    for _ in 0..200 {
        question = runtime.snapshot(&id).await.unwrap().elicitations.pop();
        if question.is_some() {
            break;
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    let question = question.expect("the question reaches the snapshot");
    assert!(question
        .fields
        .iter()
        .any(|field| field.name == "token" && field.secret));
    let marker = "answer-marker-48151623";
    let mut content = serde_json::Map::new();
    content.insert("region".into(), json!("eu"));
    content.insert("token".into(), json!(marker));
    runtime
        .respond_elicitation(&id, &question.id, "accept", Some(content))
        .await
        .unwrap();
    let snapshot = turn.await.unwrap().unwrap();
    assert!(snapshot.elicitations.is_empty());
    let events = runtime.events_all(&id).unwrap();
    assert!(texts(&events).contains("Answer: accept"));
    assert!(!serde_json::to_string(&events).unwrap().contains(marker));
    let export = temp.path().join("export.json");
    runtime
        .export_session(&id, export.to_str().unwrap())
        .unwrap();
    assert!(!std::fs::read_to_string(export).unwrap().contains(marker));
    runtime.close(&id).await.unwrap();
}

#[tokio::test]
async fn a_url_question_completes_from_the_agent_notification() {
    let (_temp, runtime, session) = runtime(Vec::new()).await;
    let id = session.session.id.clone();
    let snapshot = runtime
        .prompt(&id, "ask-url".into(), Vec::new())
        .await
        .unwrap();
    assert!(snapshot.elicitations.is_empty());
    let events = runtime.events_all(&id).unwrap();
    assert!(events
        .iter()
        .any(|event| event.kind == "elicitation_resolved" && event.data["action"] == "completed"));
    runtime.close(&id).await.unwrap();
}

struct OpenBuffer;

impl BufferSource for OpenBuffer {
    fn open_buffer(
        &self,
        _owner: &str,
        _project: &str,
        relative: &str,
    ) -> BoxFuture<'static, Option<String>> {
        let open = (relative == "paper.tex").then(|| "unsaved text".to_string());
        Box::pin(async move { open })
    }
}

#[tokio::test]
async fn fs_read_serves_an_open_buffer_inside_the_project() {
    let (temp, runtime, session) = runtime(vec!["--caps-v126".into()]).await;
    std::fs::write(temp.path().join("project/paper.tex"), "saved text").unwrap();
    runtime.set_buffer_source(Arc::new(OpenBuffer));
    let id = session.session.id.clone();
    runtime
        .prompt(&id, "read-file:paper.tex".into(), Vec::new())
        .await
        .unwrap();
    assert!(texts(&runtime.events_all(&id).unwrap()).contains("Read: unsaved text"));
    runtime.close(&id).await.unwrap();
}

#[tokio::test]
async fn fs_read_falls_back_to_disk_and_slices_lines() {
    let (temp, runtime, session) = runtime(Vec::new()).await;
    std::fs::write(temp.path().join("project/notes.tex"), "1\n2\n3\n4\n5\n").unwrap();
    let id = session.session.id.clone();
    runtime
        .prompt(&id, "read-file:notes.tex".into(), Vec::new())
        .await
        .unwrap();
    runtime
        .prompt(&id, "read-lines:notes.tex".into(), Vec::new())
        .await
        .unwrap();
    let text = texts(&runtime.events_all(&id).unwrap());
    assert!(text.contains("Read: 1\n2\n3\n4\n5\n"));
    assert!(text.contains("Read: 3\n4\n"));
    runtime.close(&id).await.unwrap();
}

#[tokio::test]
async fn fs_read_refuses_paths_outside_the_project_and_huge_files() {
    let (temp, runtime, session) = runtime(Vec::new()).await;
    let id = session.session.id.clone();
    let outside = if cfg!(windows) {
        "C:\\Windows\\win.ini"
    } else {
        "/etc/hosts"
    };
    runtime
        .prompt(&id, format!("read-abs:{outside}"), Vec::new())
        .await
        .unwrap();
    std::fs::write(temp.path().join("project/big.txt"), "x".repeat(1024 * 1024)).unwrap();
    runtime
        .prompt(&id, "read-file:big.txt".into(), Vec::new())
        .await
        .unwrap();
    let text = texts(&runtime.events_all(&id).unwrap());
    assert!(text.contains("Read failed -32602"));
    assert!(text.contains("Read failed -32603"));
    runtime.close(&id).await.unwrap();
}

#[tokio::test]
async fn steering_injects_into_a_running_turn_and_records_a_steered_message() {
    let (_temp, runtime, session) = runtime(vec!["--caps-v126".into()]).await;
    let id = session.session.id.clone();
    let prompting = runtime.clone();
    let prompt_id = id.clone();
    let turn = tokio::spawn(async move {
        prompting
            .prompt(&prompt_id, "slow-silent".into(), Vec::new())
            .await
    });
    for _ in 0..200 {
        if runtime.snapshot(&id).await.unwrap().session.status == SessionStatus::Running {
            break;
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    let outcome = runtime
        .steer(&id, "Also fix the abstract".into())
        .await
        .unwrap();
    assert_eq!(outcome, SteerOutcome::Injected);
    turn.await.unwrap().unwrap();
    let events = runtime.events_all(&id).unwrap();
    assert!(events
        .iter()
        .any(|event| event.kind == "user_message" && event.data["steered"] == true));
    assert!(texts(&events).contains("Steered: Also fix the abstract"));
    runtime.close(&id).await.unwrap();
}

#[tokio::test]
async fn steering_is_refused_when_the_agent_does_not_advertise_it() {
    let (_temp, runtime, session) = runtime(Vec::new()).await;
    let id = session.session.id.clone();
    assert!(runtime.steer(&id, "hello".into()).await.is_err());
    runtime.close(&id).await.unwrap();
}

#[tokio::test]
async fn ten_thousand_chunks_store_as_a_few_events() {
    let (_temp, runtime, session) = runtime(Vec::new()).await;
    let id = session.session.id.clone();
    runtime
        .prompt(&id, "burst:10000".into(), Vec::new())
        .await
        .unwrap();
    let events = runtime.events_all(&id).unwrap();
    let chunks = events
        .iter()
        .filter(|event| event.kind == "agent_message_chunk")
        .count();
    assert!(chunks <= 50, "{chunks} chunk events");
    assert_eq!(texts(&events).matches('x').count(), 10_000);
    runtime.close(&id).await.unwrap();
}

#[tokio::test]
async fn chunks_flush_before_a_tool_call_and_at_turn_end() {
    let (_temp, runtime, session) = runtime(Vec::new()).await;
    let id = session.session.id.clone();
    runtime
        .prompt(&id, "chunks-then-tool".into(), Vec::new())
        .await
        .unwrap();
    let events = runtime.events_all(&id).unwrap();
    let order: Vec<String> = events
        .iter()
        .filter(|event| {
            matches!(
                event.kind.as_str(),
                "agent_message_chunk" | "tool_call" | "turn_complete"
            )
        })
        .map(|event| match event.kind.as_str() {
            "agent_message_chunk" => event.data["content"]["text"]
                .as_str()
                .unwrap_or("")
                .to_owned(),
            other => other.to_owned(),
        })
        .collect();
    let start = order
        .iter()
        .position(|item| item == "Before tool.")
        .unwrap();
    assert_eq!(
        order[start..],
        ["Before tool.", "tool_call", "After.", "turn_complete"]
    );
    runtime.close(&id).await.unwrap();
}

#[tokio::test]
async fn experimental_v2_negotiates_and_runs_a_turn() {
    let temp = fixture_temp();
    let project = temp.path().join("project");
    std::fs::create_dir(&project).unwrap();
    let runtime = AcpRuntime::new(temp.path().join("acp")).unwrap();
    runtime
        .register(
            &serde_json::to_string(&fixture_definition(vec!["--v2".into()], temp.path())).unwrap(),
        )
        .unwrap();
    runtime
        .set_preferences(AcpPreferences {
            experimental_v2: true,
            ..Default::default()
        })
        .await
        .unwrap();
    let snapshot = runtime
        .start(StartSession {
            project_id: "test-project".into(),
            project_path: project,
            agent_id: "fixture-agent".into(),
            owner: Some("fixture-window".into()),
            ..StartSession::default()
        })
        .await
        .unwrap();
    assert_eq!(snapshot.session.capabilities.protocol, 2);
    let id = snapshot.session.id.clone();
    runtime
        .prompt(&id, "hello".into(), Vec::new())
        .await
        .unwrap();
    let events = runtime.events_all(&id).unwrap();
    assert_eq!(texts(&events), "Fixture v2: hello");
    let complete = events
        .iter()
        .find(|event| event.kind == "turn_complete")
        .unwrap();
    assert_eq!(complete.data["stopReason"], "end_turn");
    // A message after the agent went idle belongs to no turn, even when it
    // arrives before the turn has finished here.
    runtime
        .prompt(&id, "late-after-idle".into(), Vec::new())
        .await
        .unwrap();
    tokio::time::sleep(Duration::from_millis(200)).await;
    let events = runtime.events_all(&id).unwrap();
    assert!(
        !texts(&events).contains("Late after idle"),
        "{}",
        texts(&events)
    );
    runtime.close(&id).await.unwrap();
}

#[tokio::test]
async fn a_v1_only_agent_is_respawned_once_then_remembered() {
    let temp = fixture_temp();
    let project = temp.path().join("project");
    std::fs::create_dir(&project).unwrap();
    let runtime = AcpRuntime::new(temp.path().join("acp")).unwrap();
    runtime
        .register(
            &serde_json::to_string(&fixture_definition(
                vec!["--record-launch-count".into()],
                temp.path(),
            ))
            .unwrap(),
        )
        .unwrap();
    runtime
        .set_preferences(AcpPreferences {
            experimental_v2: true,
            ..Default::default()
        })
        .await
        .unwrap();
    let start = || StartSession {
        project_id: "test-project".into(),
        project_path: project.clone(),
        agent_id: "fixture-agent".into(),
        owner: Some("fixture-window".into()),
        ..StartSession::default()
    };
    let first = runtime.start(start()).await.unwrap();
    assert_eq!(first.session.capabilities.protocol, 1);
    let launches = || {
        std::fs::read_to_string(temp.path().join("launches.log"))
            .unwrap()
            .lines()
            .count()
    };
    assert_eq!(launches(), 2);
    runtime.close(&first.session.id).await.unwrap();
    let second = runtime.start(start()).await.unwrap();
    assert_eq!(launches(), 3);
    runtime.close(&second.session.id).await.unwrap();
}

#[tokio::test]
async fn api_key_sign_in_never_reaches_the_transcript_or_errors() {
    let temp = fixture_temp();
    let project = temp.path().join("project");
    std::fs::create_dir(&project).unwrap();
    let runtime = AcpRuntime::new(temp.path().join("acp")).unwrap();
    runtime
        .register(
            &serde_json::to_string(&fixture_definition(
                vec![
                    "--require-login".into(),
                    "--api-key-method".into(),
                    "--echo-key-error".into(),
                ],
                temp.path(),
            ))
            .unwrap(),
        )
        .unwrap();
    let snapshot = runtime
        .start(StartSession {
            project_id: "test-project".into(),
            project_path: project,
            agent_id: "fixture-agent".into(),
            owner: Some("fixture-window".into()),
            ..StartSession::default()
        })
        .await
        .unwrap();
    assert_eq!(snapshot.session.status, SessionStatus::AuthRequired);
    let id = snapshot.session.id.clone();
    let key = "sk-test-key-0123456789abcdef";
    let error = runtime
        .authenticate(
            &id,
            "api-key",
            Some(zeroize::Zeroizing::new(key.to_string())),
        )
        .await
        .unwrap_err();
    assert!(!error.contains(key));
    assert!(error.contains("[credential omitted]"));
    let record = runtime.snapshot(&id).await.unwrap().session;
    assert!(record.error.unwrap().contains("[credential omitted]"));
    assert!(!serde_json::to_string(&runtime.events_all(&id).unwrap())
        .unwrap()
        .contains(key));
    runtime.close(&id).await.unwrap();
}

#[tokio::test]
async fn terminal_sign_in_never_passes_path() {
    let temp = fixture_temp();
    let project = temp.path().join("project");
    std::fs::create_dir(&project).unwrap();
    let runtime = AcpRuntime::new(temp.path().join("acp")).unwrap();
    runtime
        .register(
            &serde_json::to_string(&fixture_definition(
                vec!["--require-login".into(), "--api-key-method".into()],
                temp.path(),
            ))
            .unwrap(),
        )
        .unwrap();
    let snapshot = runtime
        .start(StartSession {
            project_id: "test-project".into(),
            project_path: project,
            agent_id: "fixture-agent".into(),
            owner: Some("fixture-window".into()),
            ..StartSession::default()
        })
        .await
        .unwrap();
    let id = snapshot.session.id.clone();
    let sign_in = runtime
        .sign_in_command("fixture-agent", Some(&id), "terminal-login")
        .await
        .unwrap();
    assert!(!sign_in
        .env
        .keys()
        .any(|name| name.eq_ignore_ascii_case("PATH")));
    assert_eq!(
        sign_in
            .env
            .get("CLAUDE_CODE_ENTRYPOINT")
            .map(String::as_str),
        Some("acp")
    );
    assert_eq!(sign_in.args.last().map(String::as_str), Some("--login"));
    assert_eq!(sign_in.title, "Sign in to Fixture agent");
    runtime.close(&id).await.unwrap();
}

#[tokio::test]
async fn logout_moves_the_session_to_sign_in() {
    let (_temp, runtime, session) = runtime(vec!["--caps-v126".into()]).await;
    let id = session.session.id.clone();
    let snapshot = runtime.logout(&id).await.unwrap();
    assert_eq!(snapshot.session.status, SessionStatus::AuthRequired);
    runtime.close(&id).await.unwrap();
}

#[tokio::test]
async fn routing_sends_providers_set_before_session_new_and_never_stores_the_key() {
    let temp = fixture_temp();
    let project = temp.path().join("project");
    std::fs::create_dir(&project).unwrap();
    let runtime = AcpRuntime::new(temp.path().join("acp")).unwrap();
    runtime
        .register(
            &serde_json::to_string(&fixture_definition(
                vec!["--caps-v126".into(), "--record-requests".into()],
                temp.path(),
            ))
            .unwrap(),
        )
        .unwrap();
    // Without a saved key, routing is skipped and the session still starts.
    runtime
        .set_preferences(AcpPreferences {
            experimental_providers: true,
            ..Default::default()
        })
        .await
        .unwrap();
    runtime
        .set_agent_preferences(
            "fixture-agent",
            AgentPreferences {
                provider: Some("anthropic".into()),
                ..Default::default()
            },
        )
        .await
        .unwrap();
    let snapshot = runtime
        .start(StartSession {
            project_id: "test-project".into(),
            project_path: project,
            agent_id: "fixture-agent".into(),
            owner: Some("fixture-window".into()),
            ..StartSession::default()
        })
        .await
        .unwrap();
    let requests = std::fs::read_to_string(temp.path().join("requests.jsonl")).unwrap();
    let methods: Vec<Value> = requests
        .lines()
        .filter_map(|line| serde_json::from_str::<Value>(line).ok())
        .map(|line| line["method"].clone())
        .collect();
    let list = methods
        .iter()
        .position(|method| method == "providers/list")
        .unwrap();
    let new = methods
        .iter()
        .position(|method| method == "session/new")
        .unwrap();
    assert!(list < new);
    runtime.close(&snapshot.session.id).await.unwrap();
}

/// Counts the windows asked for open text; none has the file open.
struct CountingBuffers(Arc<std::sync::atomic::AtomicUsize>);

impl BufferSource for CountingBuffers {
    fn open_buffer(
        &self,
        _owner: &str,
        _project: &str,
        _relative: &str,
    ) -> BoxFuture<'static, Option<String>> {
        self.0.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        Box::pin(async { None })
    }
}

#[tokio::test]
async fn a_delegated_agent_reads_from_disk_without_asking_a_window() {
    let temp = fixture_temp();
    let project = temp.path().join("project");
    std::fs::create_dir(&project).unwrap();
    std::fs::write(project.join("notes.tex"), "saved text").unwrap();
    let runtime = AcpRuntime::new(temp.path().join("acp")).unwrap();
    runtime
        .register(&serde_json::to_string(&fixture_definition(Vec::new(), temp.path())).unwrap())
        .unwrap();
    let asked = Arc::new(std::sync::atomic::AtomicUsize::new(0));
    runtime.set_buffer_source(Arc::new(CountingBuffers(asked.clone())));
    let session = runtime
        .start(StartSession {
            project_id: "test-project".into(),
            project_path: project,
            agent_id: "fixture-agent".into(),
            parent_session_id: Some("parent-chat".into()),
            owner: Some("external:helper".into()),
            ..StartSession::default()
        })
        .await
        .unwrap();
    let id = session.session.id.clone();
    runtime
        .prompt(&id, "read-file:notes.tex".into(), Vec::new())
        .await
        .unwrap();
    assert!(texts(&runtime.events_all(&id).unwrap()).contains("Read: saved text"));
    assert_eq!(asked.load(std::sync::atomic::Ordering::SeqCst), 0);
    runtime.close(&id).await.unwrap();
}

#[tokio::test]
async fn a_stored_question_keeps_its_secret_flags_and_an_echoed_answer_is_redacted() {
    let (_temp, runtime, session) = runtime(vec!["--echo-answer".into()]).await;
    let id = session.session.id.clone();
    let prompting = runtime.clone();
    let prompt_id = id.clone();
    let turn = tokio::spawn(async move {
        prompting
            .prompt(&prompt_id, "ask-form".into(), Vec::new())
            .await
    });
    let mut question = None;
    for _ in 0..200 {
        question = runtime.snapshot(&id).await.unwrap().elicitations.pop();
        if question.is_some() {
            break;
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    let question = question.expect("the question reaches the snapshot");
    let stored = runtime
        .events_all(&id)
        .unwrap()
        .into_iter()
        .find(|event| event.kind == "elicitation")
        .unwrap();
    let secret = |name: &str| {
        stored.data["fields"]
            .as_array()
            .unwrap()
            .iter()
            .find(|field| field["name"] == name)
            .unwrap()["secret"]
            .clone()
    };
    assert_eq!(secret("token"), Value::Bool(true));
    assert_eq!(secret("region"), Value::Bool(false));
    let marker = "typed-token-48151623";
    let mut content = serde_json::Map::new();
    content.insert("region".into(), json!("eu"));
    content.insert("token".into(), json!(marker));
    runtime
        .respond_elicitation(&id, &question.id, "accept", Some(content))
        .await
        .unwrap();
    turn.await.unwrap().unwrap();
    let events = runtime.events_all(&id).unwrap();
    // The agent echoed the token back; the transcript has it removed.
    assert!(texts(&events).contains("Answer: accept"));
    assert!(texts(&events).contains("\"eu\""));
    assert!(!serde_json::to_string(&events).unwrap().contains(marker));
    runtime.close(&id).await.unwrap();
}

/// Waits until the agent has listed its commands.
async fn wait_for_commands(runtime: &Arc<AcpRuntime>, id: &str) {
    tokio::time::timeout(Duration::from_secs(5), async {
        while runtime
            .snapshot(id)
            .await
            .unwrap()
            .session
            .available_commands
            .is_empty()
        {
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    })
    .await
    .expect("the agent never listed its commands");
}

#[tokio::test]
async fn a_plan_usage_refresh_shows_as_working_and_notes_its_cost_outside_any_turn() {
    let (_temp, runtime, session) =
        runtime(vec!["--commands-on-start".into(), "--usage-cost".into()]).await;
    let id = session.session.id.clone();
    wait_for_commands(&runtime, &id).await;
    runtime
        .prompt(&id, "Hello".into(), Vec::new())
        .await
        .unwrap();
    let turn = runtime.snapshot(&id).await.unwrap().session.turn_id;
    let before = runtime.snapshot(&id).await.unwrap().session.last_sequence;
    runtime.refresh_plan_usage(&id).await.unwrap();
    let after = runtime.events(&id, before, 500).unwrap().events;
    let statuses: Vec<_> = after
        .iter()
        .filter(|event| event.kind == "status")
        .map(|event| event.data["status"].clone())
        .collect();
    assert_eq!(statuses, [json!("running"), json!("ready")]);
    let cost = after
        .iter()
        .find(|event| event.kind == "usage" && event.data["source"] == "acp_context")
        .expect("the agent's total after the refresh is noted");
    assert_eq!(cost.data["costAmount"], json!(0.05));
    // It belongs to no turn, so the usage ledger charges no turn for it.
    assert!(after.iter().all(|event| event.turn_id.is_none()));
    assert_eq!(runtime.snapshot(&id).await.unwrap().session.turn_id, turn);
    runtime.close(&id).await.unwrap();
}

#[tokio::test]
async fn a_status_command_that_starts_a_tool_is_stopped_and_the_agent_stays_connected() {
    let (_temp, runtime, session) = runtime(vec![
        "--commands-on-start".into(),
        "--status-runs-tools".into(),
    ])
    .await;
    let id = session.session.id.clone();
    wait_for_commands(&runtime, &id).await;
    let before = runtime.snapshot(&id).await.unwrap().session.last_sequence;
    let error = runtime.refresh_plan_usage(&id).await.unwrap_err();
    assert!(error.contains("not a usage report"), "{error}");
    let snapshot = runtime.snapshot(&id).await.unwrap();
    assert_eq!(snapshot.session.status, SessionStatus::Ready);
    assert!(snapshot
        .session
        .usage
        .and_then(|usage| usage.plan_markdown)
        .is_none());
    let after = runtime.events(&id, before, 500).unwrap().events;
    assert!(!kinds(&after)
        .iter()
        .any(|kind| kind.starts_with("tool_call")));
    // The agent still answers.
    runtime
        .prompt(&id, "Hello".into(), Vec::new())
        .await
        .unwrap();
    runtime.close(&id).await.unwrap();
}

#[tokio::test]
async fn stop_pressed_after_the_turn_ended_keeps_the_agent_connected() {
    let (_temp, runtime, session) = runtime(Vec::new()).await;
    let id = session.session.id.clone();
    runtime
        .prompt(&id, "Hello".into(), Vec::new())
        .await
        .unwrap();
    runtime.cancel(&id).await.unwrap();
    let snapshot = runtime.snapshot(&id).await.unwrap();
    assert_eq!(snapshot.session.status, SessionStatus::Ready);
    runtime
        .prompt(&id, "Again".into(), Vec::new())
        .await
        .unwrap();
    runtime.close(&id).await.unwrap();
}

#[tokio::test]
async fn a_message_delivered_in_a_turn_that_fails_is_reported_as_delivered() {
    use super::super::attachments::PromptInput;
    use crate::acp::PromptFailure;
    let (_temp, runtime, session) = runtime(Vec::new()).await;
    let id = session.session.id.clone();
    let failure = runtime
        .send_prompt(
            &id,
            PromptInput {
                text: "leak-error".into(),
                ..PromptInput::default()
            },
            None,
        )
        .await
        .unwrap_err();
    assert!(matches!(
        failure,
        PromptFailure::Delivered {
            delivered: true,
            ..
        }
    ));
    let wire = serde_json::to_value(&failure).unwrap();
    assert_eq!(wire["delivered"], true);
    assert!(wire["message"].as_str().unwrap().contains("Agent failure"));
    // A message refused before it is sent stays a plain string.
    let refused = runtime
        .send_prompt(&id, PromptInput::default(), None)
        .await
        .unwrap_err();
    assert_eq!(
        serde_json::to_value(&refused).unwrap(),
        json!("Write a message before sending.")
    );
    runtime.close(&id).await.unwrap();
}

#[tokio::test]
async fn a_turn_the_agent_marks_as_a_system_error_ends_as_an_error_not_a_reply() {
    let (_temp, runtime, session) = runtime(Vec::new()).await;
    let id = session.session.id.clone();
    let body = r#"{"error": {"message": "The 'gpt-x' model is not supported with this provider.", "type": "invalid_request_error"}}"#;
    let error = runtime
        .prompt(&id, format!("system-error:{body}"), Vec::new())
        .await
        .unwrap_err();
    assert_eq!(
        error,
        "The 'gpt-x' model is not supported with this provider."
    );
    let events = runtime.events_all(&id).unwrap();
    assert_eq!(texts(&events), "");
    let complete = events
        .iter()
        .rev()
        .find(|event| event.kind == "turn_complete")
        .unwrap();
    assert_eq!(complete.data["stopReason"], "error");
    assert_eq!(complete.data["error"], json!(error));
    let snapshot = runtime.snapshot(&id).await.unwrap();
    assert_eq!(snapshot.session.status, SessionStatus::Ready);
    runtime
        .prompt(&id, "after the error".into(), Vec::new())
        .await
        .unwrap();
    assert!(texts(&runtime.events_all(&id).unwrap()).contains("Fixture answer: after the error"));
    runtime.close(&id).await.unwrap();
}

#[tokio::test]
async fn a_system_error_that_reads_as_a_rejected_key_asks_for_sign_in() {
    let (_temp, runtime, session) = runtime(Vec::new()).await;
    let id = session.session.id.clone();
    let error = runtime
        .prompt(
            &id,
            "system-error:unexpected status 401 Unauthorized: Incorrect API key provided".into(),
            Vec::new(),
        )
        .await
        .unwrap_err();
    assert_eq!(
        error,
        "unexpected status 401 Unauthorized: Incorrect API key provided"
    );
    assert_eq!(
        runtime.snapshot(&id).await.unwrap().session.status,
        SessionStatus::AuthRequired
    );
    runtime.close(&id).await.unwrap();
}
