use super::super::hermes::{project_profile_name, HermesMode, HermesSettings};
use super::super::types::*;
use super::{fixture_definition, pending_runtime, runtime};
use crate::acp::AcpRuntime;
use crate::test_wait::{self, CHILD_PATIENCE};
use oleafly_acp::controls::{ConfigKind, ConfigValue};
use serde_json::{json, Value};
use std::{path::Path, sync::Arc, time::Duration};

const GONE: &str = "The agent no longer has this conversation. Start a new one.";

fn requests(root: &Path) -> Vec<Value> {
    std::fs::read_to_string(root.join("requests.jsonl"))
        .unwrap_or_default()
        .lines()
        .map(|line| serde_json::from_str(line).unwrap())
        .collect()
}

fn after<'a>(sent: &'a [Value], method: &str) -> &'a [Value] {
    let index = sent
        .iter()
        .rposition(|request| request["method"] == method)
        .unwrap_or_else(|| panic!("no {method} request"));
    &sent[index + 1..]
}

fn notices(runtime: &AcpRuntime, id: &str) -> Vec<Value> {
    runtime
        .events_all(id)
        .unwrap()
        .into_iter()
        .filter(|event| event.kind == "notice")
        .map(|event| event.data)
        .collect()
}

fn texts(runtime: &AcpRuntime, id: &str) -> String {
    runtime
        .events_all(id)
        .unwrap()
        .iter()
        .filter_map(|event| event.data["content"]["text"].as_str().map(str::to_owned))
        .collect::<Vec<_>>()
        .join("\n")
}

fn effort(snapshot: &SessionSnapshot) -> Option<String> {
    match &snapshot.session.controls.by_id("effort")?.kind {
        ConfigKind::Select { current_value, .. } => current_value.clone(),
        _ => None,
    }
}

async fn first_permission(runtime: &AcpRuntime, id: &str) -> PermissionRequest {
    tokio::time::timeout(Duration::from_secs(10), async {
        loop {
            if let Some(request) = runtime.snapshot(id).await.unwrap().permissions.first() {
                break request.clone();
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("the agent asked for permission")
}

#[tokio::test]
async fn a_resume_that_opens_another_session_is_refused_before_any_prompt() {
    let (temp, runtime, snapshot) = runtime(vec![
        String::new(),
        "--caps-v126".into(),
        "--resume-other-id".into(),
        "--record-requests".into(),
    ])
    .await;
    let id = snapshot.session.id;
    runtime
        .prompt(&id, "Hello".into(), Vec::new())
        .await
        .unwrap();
    runtime.close(&id).await.unwrap();
    let error = runtime
        .reconnect(&id, Some("fixture-window".into()))
        .await
        .unwrap_err();
    assert_eq!(error, GONE);
    let sent = requests(temp.path());
    let resumed = after(&sent, "session/resume");
    assert!(resumed
        .iter()
        .all(|request| request["method"] != "session/prompt"));
    assert!(resumed
        .iter()
        .any(|request| request["method"] == "session/close"
            && request["params"]["sessionId"] == "fixture-other"));
    let record = runtime.record(&id).unwrap();
    assert_eq!(record.error.as_deref(), Some(GONE));
    assert_eq!(record.native_session_id.as_deref(), Some("fixture-native"));
    assert!(!serde_json::to_string(&runtime.events_all(&id).unwrap())
        .unwrap()
        .contains("another session"));
}

#[test]
fn a_conversation_made_in_another_hermes_profile_is_not_resumed() {
    use super::super::runtime::moved_target;
    let project = HermesSettings {
        mode: HermesMode::Project,
        ..HermesSettings::default()
    };
    let default = HermesSettings::default();
    let in_default = SessionRecord {
        project_id: "thesis".into(),
        agent_id: "hermes".into(),
        native_session_id: Some("native".into()),
        hermes_profile: Some("default".into()),
        ..SessionRecord::default()
    };
    assert!(moved_target(&in_default, &project)
        .unwrap()
        .contains("Hermes profile"));
    assert_eq!(moved_target(&in_default, &default), None);
    let in_project = SessionRecord {
        hermes_profile: Some(project_profile_name("thesis")),
        ..in_default.clone()
    };
    assert_eq!(moved_target(&in_project, &project), None);
    assert!(moved_target(&in_project, &default).is_some());
    let older = SessionRecord {
        hermes_profile: None,
        ..in_default
    };
    assert_eq!(moved_target(&older, &project), None);
}

#[tokio::test]
async fn a_conversation_that_never_ran_a_turn_starts_again_when_the_agent_lost_it() {
    let (temp, runtime, snapshot) = runtime(vec![
        String::new(),
        "--resume-not-found".into(),
        "--record-requests".into(),
    ])
    .await;
    let id = snapshot.session.id;
    runtime.close(&id).await.unwrap();
    let reopened = runtime
        .reconnect(&id, Some("fixture-window".into()))
        .await
        .unwrap();
    assert_eq!(reopened.session.status, SessionStatus::Ready);
    assert!(reopened.session.native_session_id.is_some());
    assert!(after(&requests(temp.path()), "session/load")
        .iter()
        .any(|request| request["method"] == "session/new"));
    runtime
        .prompt(&id, "Hello".into(), Vec::new())
        .await
        .unwrap();
    runtime.close(&id).await.unwrap();
}

#[tokio::test]
async fn a_conversation_with_turns_the_agent_lost_is_reported_plainly() {
    let (temp, runtime, snapshot) = runtime(vec![
        String::new(),
        "--resume-not-found".into(),
        "--record-requests".into(),
    ])
    .await;
    let id = snapshot.session.id;
    runtime
        .prompt(&id, "Hello".into(), Vec::new())
        .await
        .unwrap();
    runtime.close(&id).await.unwrap();
    let error = runtime
        .reconnect(&id, Some("fixture-window".into()))
        .await
        .unwrap_err();
    assert_eq!(error, GONE);
    assert!(after(&requests(temp.path()), "session/load")
        .iter()
        .all(|request| request["method"] != "session/new"));
    assert_eq!(
        runtime.record(&id).unwrap().native_session_id.as_deref(),
        Some("fixture-native")
    );
}

#[tokio::test]
async fn a_resumed_conversation_keeps_the_effort_it_was_set_to() {
    let (temp, runtime, snapshot) = runtime(vec![
        String::new(),
        "--caps-v126".into(),
        "--claude-options".into(),
        "--record-requests".into(),
    ])
    .await;
    let id = snapshot.session.id;
    let low = runtime
        .set_config_option(&id, "effort", ConfigValue::Id("low".into()))
        .await
        .unwrap();
    assert_eq!(effort(&low).as_deref(), Some("low"));
    runtime.close(&id).await.unwrap();
    let reopened = runtime
        .reconnect(&id, Some("fixture-window".into()))
        .await
        .unwrap();
    let sent = requests(temp.path());
    let sets: Vec<_> = after(&sent, "session/resume")
        .iter()
        .filter(|request| request["method"] == "session/set_config_option")
        .collect();
    assert_eq!(sets.len(), 1, "{sets:?}");
    assert_eq!(sets[0]["params"]["configId"], "effort");
    assert_eq!(sets[0]["params"]["value"], "low");
    assert_eq!(effort(&reopened).as_deref(), Some("low"));
    runtime.close(&id).await.unwrap();
}

fn selected(snapshot: &SessionSnapshot, id: &str) -> Option<String> {
    match &snapshot.session.controls.by_id(id)?.kind {
        ConfigKind::Select { current_value, .. } => current_value.clone(),
        _ => None,
    }
}

fn sets_after_resume(root: &Path) -> Vec<(String, String)> {
    after(&requests(root), "session/resume")
        .iter()
        .filter(|request| request["method"] == "session/set_config_option")
        .map(|request| {
            (
                request["params"]["configId"].as_str().unwrap().to_owned(),
                request["params"]["value"].as_str().unwrap().to_owned(),
            )
        })
        .collect()
}

#[tokio::test]
async fn a_resumed_conversation_gets_its_model_then_mode_then_effort_back() {
    let (temp, runtime, snapshot) = runtime(vec![
        String::new(),
        "--caps-v126".into(),
        "--codex-options".into(),
        "--record-requests".into(),
    ])
    .await;
    let id = snapshot.session.id;
    assert!(snapshot
        .session
        .controls
        .by_id("reasoning_effort")
        .is_none());
    for (option, value) in [
        ("model", "gpt-other"),
        ("reasoning_effort", "high"),
        ("mode", "read-only"),
    ] {
        runtime
            .set_config_option(&id, option, ConfigValue::Id(value.into()))
            .await
            .unwrap();
    }
    runtime.close(&id).await.unwrap();
    let reopened = runtime
        .reconnect(&id, Some("fixture-window".into()))
        .await
        .unwrap();
    assert_eq!(
        sets_after_resume(temp.path()),
        [
            ("model".to_owned(), "gpt-other".to_owned()),
            ("mode".to_owned(), "read-only".to_owned()),
            ("reasoning_effort".to_owned(), "high".to_owned()),
        ]
    );
    assert_eq!(selected(&reopened, "model").as_deref(), Some("gpt-other"));
    assert_eq!(selected(&reopened, "mode").as_deref(), Some("read-only"));
    assert_eq!(
        selected(&reopened, "reasoning_effort").as_deref(),
        Some("high")
    );
    runtime.close(&id).await.unwrap();
}

#[tokio::test]
async fn a_resumed_conversation_never_goes_back_into_a_blocked_mode() {
    let (temp, runtime, snapshot) = runtime(vec![
        String::new(),
        "--caps-v126".into(),
        "--codex-options".into(),
        "--record-requests".into(),
    ])
    .await;
    let id = snapshot.session.id;
    runtime.close(&id).await.unwrap();
    let mut record = runtime.record(&id).unwrap();
    for option in &mut record.controls.options {
        if let ConfigKind::Select { current_value, .. } = &mut option.kind {
            if option.id == "mode" {
                *current_value = Some("agent-full-access".into());
            }
        }
    }
    runtime.store.save(&record).unwrap();
    let reopened = runtime
        .reconnect(&id, Some("fixture-window".into()))
        .await
        .unwrap();
    assert!(sets_after_resume(temp.path()).is_empty());
    assert_eq!(selected(&reopened, "mode").as_deref(), Some("agent"));
    runtime.close(&id).await.unwrap();
}

#[cfg(unix)]
#[tokio::test]
async fn hermes_gets_the_project_tools_back_after_a_model_change() {
    use std::os::unix::fs::PermissionsExt;
    let temp = super::fixture_temp();
    let project = temp.path().join("project");
    std::fs::create_dir(&project).unwrap();
    let runtime = AcpRuntime::new(temp.path().join("acp")).unwrap();
    let command = fixture_definition(
        vec![
            String::new(),
            "--caps-v126".into(),
            "--legacy-modes".into(),
            "--record-requests".into(),
        ],
        temp.path(),
    )
    .distribution
    .command
    .unwrap();
    let quoted: Vec<String> = std::iter::once(command.executable)
        .chain(command.args)
        .map(|part| format!("'{}'", part.replace('\'', "'\\''")))
        .collect();
    let wrapper = temp.path().join("hermes-fixture");
    std::fs::write(&wrapper, format!("#!/bin/sh\nexec {}\n", quoted.join(" "))).unwrap();
    std::fs::set_permissions(&wrapper, std::fs::Permissions::from_mode(0o755)).unwrap();
    runtime
        .save_agent_program("hermes", Some(&wrapper))
        .unwrap();
    let server = json!({
        "type": "http", "name": "oleafly-research", "url": "http://127.0.0.1:1/mcp",
        "headers": [{"name": "Authorization", "value": "Bearer hermes-fixture-token-1234"}]
    });
    let started = runtime
        .start_with_mcp(
            StartSession {
                project_id: "test-project".into(),
                project_path: project,
                agent_id: "hermes".into(),
                owner: Some("fixture-window".into()),
                ..StartSession::default()
            },
            vec![server.clone()],
        )
        .await
        .unwrap();
    let id = started.session.id;
    assert_eq!(started.session.hermes_profile.as_deref(), Some("default"));
    let changed = runtime.set_model(&id, "fixture-second").await.unwrap();
    assert_eq!(
        changed.session.controls.model_id.as_deref(),
        Some("fixture-second")
    );
    let sent = requests(temp.path());
    let next = after(&sent, "session/set_model");
    assert_eq!(next[0]["method"], "session/resume");
    assert_eq!(next[0]["params"]["mcpServers"], json!([server]));
    runtime.close(&id).await.unwrap();
}

#[tokio::test]
async fn an_open_permission_card_waits_for_the_user() {
    let (_temp, runtime, snapshot) = runtime(vec![String::new(), "--echo-option".into()]).await;
    let id = snapshot.session.id;
    let turn = {
        let runtime = runtime.clone();
        let id = id.clone();
        tokio::spawn(async move { runtime.prompt(&id, "permission".into(), Vec::new()).await })
    };
    let request = first_permission(&runtime, &id).await;
    assert!(request.expires_at > now_ms() + 60 * 60 * 1000);
    let live = runtime.get_live(&id).await.unwrap();
    live.state
        .lock()
        .unwrap()
        .permissions
        .values_mut()
        .for_each(|pending| pending.request.expires_at = 1);
    runtime
        .resolve_permission(&id, &request.id, Some("yes".into()))
        .await
        .unwrap();
    tokio::time::timeout(Duration::from_secs(10), turn)
        .await
        .unwrap()
        .unwrap()
        .unwrap();
    assert!(texts(&runtime, &id).contains("Permission outcome: selected yes"));
    runtime.close(&id).await.unwrap();
}

#[tokio::test]
async fn a_request_outside_the_project_is_rejected_with_one_notice() {
    let (_temp, runtime, snapshot) = runtime(vec![String::new(), "--echo-option".into()]).await;
    let id = snapshot.session.id;
    runtime
        .prompt(&id, "outside-permission".into(), Vec::new())
        .await
        .unwrap();
    assert!(texts(&runtime, &id).contains("Permission outcome: selected no"));
    let notices = notices(&runtime, &id);
    assert_eq!(notices.len(), 1, "{notices:?}");
    assert_eq!(notices[0]["severity"], "warning");
    assert!(notices[0].to_string().contains("/etc/passwd"));
    assert!(runtime.snapshot(&id).await.unwrap().permissions.is_empty());
    runtime.close(&id).await.unwrap();
}

#[tokio::test]
async fn a_failed_reconnect_keeps_the_conversation() {
    let (temp, runtime, snapshot) = runtime(Vec::new()).await;
    let id = snapshot.session.id;
    runtime
        .prompt(&id, "Hello".into(), Vec::new())
        .await
        .unwrap();
    runtime.close(&id).await.unwrap();
    runtime
        .register(
            &serde_json::to_string(&fixture_definition(
                vec![String::new(), "--stderr-crash".into()],
                temp.path(),
            ))
            .unwrap(),
        )
        .unwrap();
    assert!(runtime
        .reconnect(&id, Some("fixture-window".into()))
        .await
        .is_err());
    let record = runtime.record(&id).unwrap();
    assert_eq!(record.status, SessionStatus::Failed);
    assert!(runtime
        .events_all(&id)
        .unwrap()
        .iter()
        .any(|event| event.kind == "user_message"));
}

#[tokio::test]
async fn a_turn_that_ends_without_a_reply_says_so() {
    let (_temp, runtime, snapshot) = runtime(Vec::new()).await;
    let id = snapshot.session.id;
    runtime
        .prompt(&id, "empty-turn".into(), Vec::new())
        .await
        .unwrap();
    let after_empty = notices(&runtime, &id);
    assert_eq!(after_empty.len(), 1, "{after_empty:?}");
    assert_eq!(after_empty[0]["severity"], "warning");
    assert_eq!(
        after_empty[0]["title"],
        "The agent ended its turn without replying."
    );
    runtime
        .prompt(&id, "Hello".into(), Vec::new())
        .await
        .unwrap();
    assert_eq!(notices(&runtime, &id).len(), 1);
    runtime.close(&id).await.unwrap();
}

fn pi_home(native: &str, lines: &[Value]) -> tempfile::TempDir {
    let home = tempfile::tempdir().unwrap();
    let sessions = home.path().join(".pi/agent/sessions/--project--");
    std::fs::create_dir_all(&sessions).unwrap();
    let file = sessions.join(format!("2026-10-26T16-19-29-155Z_{native}.jsonl"));
    let body: String = lines.iter().map(|line| format!("{line}\n")).collect();
    std::fs::write(&file, body).unwrap();
    std::fs::create_dir_all(home.path().join(".pi/pi-acp")).unwrap();
    std::fs::write(
        home.path().join(".pi/pi-acp/session-map.json"),
        json!({"version": 1, "sessions": {native: {"sessionId": native, "cwd": "/project", "sessionFile": file}}})
            .to_string(),
    )
    .unwrap();
    home
}

fn pi_message(role: &str, stop: &str, error: Option<&str>, timestamp: u64) -> Value {
    let mut message =
        json!({"role": role, "content": [], "stopReason": stop, "timestamp": timestamp});
    if let Some(error) = error {
        message["errorMessage"] = json!(error);
    }
    json!({"type": "message", "id": "m", "parentId": null, "message": message})
}

#[test]
fn a_pi_turn_that_failed_reports_the_providers_error() {
    use super::super::pi_turn::last_turn_error;
    let native = "01a17902-7f03-78be-8256-17d49e71fb7e";
    let since = 1_793_031_570_000;
    let failed = pi_home(
        native,
        &[
            json!({"type": "session", "version": 3, "id": native}),
            pi_message("user", "", None, since + 10),
            pi_message(
                "assistant",
                "error",
                Some("Codex error: The 'gpt-5.5' model is not supported when using Codex with a ChatGPT account."),
                since + 20,
            ),
        ],
    );
    assert_eq!(
        last_turn_error(failed.path(), native, since).as_deref(),
        Some("Codex error: The 'gpt-5.5' model is not supported when using Codex with a ChatGPT account.")
    );
    assert_eq!(
        last_turn_error(failed.path(), "another-session", since),
        None
    );
    assert_eq!(
        last_turn_error(failed.path(), native, since + 60_000),
        None,
        "an error from an earlier turn"
    );
    let answered = pi_home(
        native,
        &[
            pi_message("assistant", "error", Some("Old failure"), since - 90_000),
            pi_message("user", "", None, since + 10),
            pi_message("assistant", "stop", None, since + 20),
        ],
    );
    assert_eq!(last_turn_error(answered.path(), native, since), None);
    let long = pi_home(
        native,
        &[pi_message(
            "assistant",
            "error",
            Some(&format!("bad\u{7} key {}", "x".repeat(5000))),
            since + 20,
        )],
    );
    let error = last_turn_error(long.path(), native, since).unwrap();
    assert!(error.starts_with("bad key"), "{error}");
    assert!(error.chars().count() <= 500);
    let empty = tempfile::tempdir().unwrap();
    assert_eq!(last_turn_error(empty.path(), native, since), None);
}

#[test]
fn a_pi_session_file_outside_the_pi_folder_is_never_read() {
    use super::super::pi_turn::last_turn_error;
    let native = "outside-session";
    let since = 1_793_031_570_000;
    let home = tempfile::tempdir().unwrap();
    let elsewhere = home.path().join("notes.jsonl");
    std::fs::write(
        &elsewhere,
        format!(
            "{}\n",
            pi_message("assistant", "error", Some("secret notes"), since + 20)
        ),
    )
    .unwrap();
    std::fs::create_dir_all(home.path().join(".pi/pi-acp")).unwrap();
    std::fs::write(
        home.path().join(".pi/pi-acp/session-map.json"),
        json!({"version": 1, "sessions": {native: {"sessionFile": elsewhere}}}).to_string(),
    )
    .unwrap();
    assert_eq!(last_turn_error(home.path(), native, since), None);
}

#[test]
fn pi_sessions_get_no_project_tool_bridges() {
    use super::super::commands::takes_project_tools;
    assert!(!takes_project_tools("pi"));
    assert!(takes_project_tools("claude"));
    assert!(takes_project_tools("hermes"));
}

#[tokio::test]
async fn a_not_logged_in_status_is_never_shown_as_a_sign_in() {
    let (_temp, runtime, snapshot) = runtime(Vec::new()).await;
    let id = snapshot.session.id;
    let quiet = runtime
        .prompt(&id, "auth-status:none".into(), Vec::new())
        .await
        .unwrap();
    assert!(quiet.session.usage.and_then(|usage| usage.auth).is_none());
    let signed_in = runtime
        .prompt(&id, "auth-status:subscription".into(), Vec::new())
        .await
        .unwrap();
    assert_eq!(
        signed_in.session.usage.unwrap().auth.unwrap().label,
        "Claude Max"
    );
    let still = runtime
        .prompt(&id, "auth-status:none".into(), Vec::new())
        .await
        .unwrap();
    assert_eq!(
        still.session.usage.unwrap().auth.unwrap().label,
        "Claude Max"
    );
    runtime.close(&id).await.unwrap();
}

#[tokio::test]
async fn a_start_stuck_before_the_agent_answers_can_be_cancelled() {
    let (temp, runtime, options) =
        pending_runtime(vec!["agent.pid".into(), "--initialize-barrier".into()]);
    let starting: Arc<AcpRuntime> = runtime.clone();
    let start = tokio::spawn(async move { starting.start(options).await });
    let pid = test_wait::read_until(
        &temp.path().join("agent.pid"),
        CHILD_PATIENCE,
        test_wait::pid,
    )
    .await
    .expect("the fixture agent never wrote its PID");
    assert!(!runtime.cancel_start("other-window", "test-project").await);
    assert!(runtime.cancel_start("fixture-window", "test-project").await);
    let error = tokio::time::timeout(Duration::from_secs(10), start)
        .await
        .expect("the start ends soon after it is cancelled")
        .unwrap()
        .unwrap_err();
    assert_eq!(error, "The start was cancelled.");
    #[cfg(unix)]
    tokio::time::timeout(Duration::from_secs(5), async {
        while unsafe { libc::kill(pid, 0) } == 0 {
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    })
    .await
    .expect("the agent outlived the cancelled start");
    #[cfg(not(unix))]
    let _ = pid;
    assert!(runtime.list("test-project").unwrap().is_empty());
    assert!(!runtime.cancel_start("fixture-window", "test-project").await);
}
