//! Agent options: effort, mode, fast; remembered choices; legacy modes.
use super::super::preferences::RememberedChoice;
use super::super::types::*;
use super::{fixture_definition, fixture_temp, runtime};
use crate::acp::AcpRuntime;
use oleafly_acp::controls::{ConfigKind, ConfigValue};

fn current(snapshot: &SessionSnapshot, id: &str) -> Option<String> {
    match &snapshot.session.controls.by_id(id)?.kind {
        ConfigKind::Select { current_value, .. } => current_value.clone(),
        ConfigKind::Boolean { current_value } => Some(current_value.to_string()),
        ConfigKind::Unsupported { .. } => None,
    }
}

#[tokio::test]
async fn setting_effort_by_category_updates_controls_and_is_remembered() {
    let (_temp, runtime, session) = runtime(vec!["--claude-options".into()]).await;
    let id = session.session.id.clone();
    let snapshot = runtime
        .set_config_option(&id, "effort", ConfigValue::Id("high".into()))
        .await
        .unwrap();
    assert_eq!(current(&snapshot, "effort").as_deref(), Some("high"));
    let remembered = runtime
        .agent_preferences("fixture-agent")
        .unwrap()
        .effort
        .unwrap();
    assert_eq!(
        remembered,
        RememberedChoice {
            value: "high".into(),
            name: "High".into()
        }
    );
    let fast = runtime
        .set_config_option(&id, "fast", ConfigValue::boolean(true))
        .await
        .unwrap();
    assert_eq!(current(&fast, "fast").as_deref(), Some("true"));
    runtime.close(&id).await.unwrap();
}

#[tokio::test]
async fn a_new_session_gets_the_remembered_effort_and_mode() {
    let temp = fixture_temp();
    let project = temp.path().join("project");
    std::fs::create_dir(&project).unwrap();
    let runtime = AcpRuntime::new(temp.path().join("acp")).unwrap();
    runtime
        .register(
            &serde_json::to_string(&fixture_definition(
                vec!["--claude-options".into(), "--record-requests".into()],
                temp.path(),
            ))
            .unwrap(),
        )
        .unwrap();
    runtime
        .set_agent_preferences(
            "fixture-agent",
            AgentPreferences {
                effort: Some(RememberedChoice {
                    value: "high".into(),
                    name: "High".into(),
                }),
                mode: Some(RememberedChoice {
                    value: "plan".into(),
                    name: "Plan".into(),
                }),
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
    assert_eq!(current(&snapshot, "effort").as_deref(), Some("high"));
    assert_eq!(current(&snapshot, "mode").as_deref(), Some("plan"));
    let requests = std::fs::read_to_string(temp.path().join("requests.jsonl")).unwrap();
    let sets = requests
        .lines()
        .filter(|line| line.contains("session/set_config_option"))
        .count();
    assert_eq!(sets, 2);
    runtime.close(&snapshot.session.id).await.unwrap();
}

fn choice(value: &str, name: &str) -> Option<RememberedChoice> {
    Some(RememberedChoice {
        value: value.into(),
        name: name.into(),
    })
}

fn config_sets(root: &std::path::Path) -> Vec<(String, String)> {
    std::fs::read_to_string(root.join("requests.jsonl"))
        .unwrap()
        .lines()
        .map(|line| serde_json::from_str::<serde_json::Value>(line).unwrap())
        .filter(|request| request["method"] == "session/set_config_option")
        .map(|request| {
            (
                request["params"]["configId"].as_str().unwrap().to_owned(),
                request["params"]["value"].as_str().unwrap().to_owned(),
            )
        })
        .collect()
}

async fn codex_like(
    prefs: AgentPreferences,
) -> (
    tempfile::TempDir,
    std::sync::Arc<AcpRuntime>,
    SessionSnapshot,
) {
    let temp = fixture_temp();
    let project = temp.path().join("project");
    std::fs::create_dir(&project).unwrap();
    let runtime = AcpRuntime::new(temp.path().join("acp")).unwrap();
    runtime
        .register(
            &serde_json::to_string(&fixture_definition(
                vec!["--codex-options".into(), "--record-requests".into()],
                temp.path(),
            ))
            .unwrap(),
        )
        .unwrap();
    runtime
        .set_agent_preferences("fixture-agent", prefs)
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
    (temp, runtime, snapshot)
}

#[tokio::test]
async fn a_new_session_gets_the_remembered_model_before_the_effort_it_offers() {
    let (temp, runtime, snapshot) = codex_like(AgentPreferences {
        model: choice("gpt-other", "GPT other"),
        effort: choice("high", "High"),
        mode: choice("read-only", "Read-only"),
        ..Default::default()
    })
    .await;
    assert_eq!(current(&snapshot, "model").as_deref(), Some("gpt-other"));
    assert_eq!(
        current(&snapshot, "reasoning_effort").as_deref(),
        Some("high")
    );
    assert_eq!(current(&snapshot, "mode").as_deref(), Some("read-only"));
    assert_eq!(
        config_sets(temp.path()),
        [
            ("model".to_owned(), "gpt-other".to_owned()),
            ("reasoning_effort".to_owned(), "high".to_owned()),
            ("mode".to_owned(), "read-only".to_owned()),
        ]
    );
    runtime.close(&snapshot.session.id).await.unwrap();
}

#[tokio::test]
async fn a_model_change_is_remembered_and_brings_back_the_remembered_effort() {
    let (_temp, runtime, snapshot) = codex_like(AgentPreferences {
        effort: choice("high", "High"),
        ..Default::default()
    })
    .await;
    let id = snapshot.session.id.clone();
    assert_eq!(current(&snapshot, "reasoning_effort"), None);
    let changed = runtime
        .set_config_option(&id, "model", ConfigValue::Id("gpt-other".into()))
        .await
        .unwrap();
    assert_eq!(current(&changed, "model").as_deref(), Some("gpt-other"));
    assert_eq!(
        current(&changed, "reasoning_effort").as_deref(),
        Some("high")
    );
    assert_eq!(
        runtime.agent_preferences("fixture-agent").unwrap().model,
        choice("gpt-other", "GPT other")
    );
    runtime.close(&id).await.unwrap();
}

#[tokio::test]
async fn a_legacy_model_change_is_remembered() {
    let (_temp, runtime, session) = runtime(vec!["--legacy-modes".into()]).await;
    let id = session.session.id.clone();
    runtime.set_model(&id, "fixture-second").await.unwrap();
    assert_eq!(
        runtime.agent_preferences("fixture-agent").unwrap().model,
        choice("fixture-second", "Second model")
    );
    runtime.close(&id).await.unwrap();
}

#[tokio::test]
async fn a_blocked_mode_is_refused_without_a_request() {
    let (temp, runtime, session) =
        runtime(vec!["--claude-options".into(), "--record-requests".into()]).await;
    let id = session.session.id.clone();
    let error = runtime
        .set_config_option(&id, "mode", ConfigValue::Id("bypassPermissions".into()))
        .await
        .unwrap_err();
    assert_eq!(
        error,
        "Oleafly keeps permission checks on, so this mode is not available."
    );
    let requests = std::fs::read_to_string(temp.path().join("requests.jsonl")).unwrap();
    assert!(!requests.contains("bypassPermissions"));
    runtime.close(&id).await.unwrap();
}

#[tokio::test]
async fn legacy_set_mode_is_used_when_the_agent_has_only_modes() {
    let (temp, runtime, session) =
        runtime(vec!["--legacy-modes".into(), "--record-requests".into()]).await;
    let id = session.session.id.clone();
    assert!(runtime.set_mode(&id, "yolo").await.is_err());
    let snapshot = runtime.set_mode(&id, "plan").await.unwrap();
    assert_eq!(snapshot.session.controls.mode_id.as_deref(), Some("plan"));
    let requests = std::fs::read_to_string(temp.path().join("requests.jsonl")).unwrap();
    assert!(requests.contains("session/set_mode"));
    let remembered = runtime
        .agent_preferences("fixture-agent")
        .unwrap()
        .mode
        .unwrap();
    assert_eq!(remembered.value, "plan");
    runtime.close(&id).await.unwrap();
}

fn notices(runtime: &AcpRuntime, id: &str) -> Vec<serde_json::Value> {
    runtime
        .events(id, 0, 500)
        .unwrap()
        .events
        .into_iter()
        .filter(|event| event.kind == "notice")
        .map(|event| event.data)
        .collect()
}

#[tokio::test]
async fn a_session_that_starts_with_permission_checks_off_is_moved_to_the_safe_mode() {
    let (temp, runtime, session) = runtime(vec![
        "--claude-options".into(),
        "--start-mode".into(),
        "bypassPermissions".into(),
        "--record-requests".into(),
    ])
    .await;
    let id = session.session.id.clone();
    let snapshot = runtime.snapshot(&id).await.unwrap();
    assert_eq!(current(&snapshot, "mode").as_deref(), Some("default"));
    let requests = std::fs::read_to_string(temp.path().join("requests.jsonl")).unwrap();
    assert!(requests
        .lines()
        .any(|line| line.contains("session/set_config_option") && line.contains("\"default\"")));
    assert!(notices(&runtime, &id).is_empty());
    runtime.close(&id).await.unwrap();
}

#[tokio::test]
async fn a_legacy_session_in_yolo_mode_is_moved_to_the_default_mode() {
    let (temp, runtime, session) = runtime(vec![
        "--legacy-modes".into(),
        "--start-mode".into(),
        "yolo".into(),
        "--record-requests".into(),
    ])
    .await;
    let id = session.session.id.clone();
    let snapshot = runtime.snapshot(&id).await.unwrap();
    assert_eq!(
        snapshot.session.controls.mode_id.as_deref(),
        Some("default")
    );
    let requests = std::fs::read_to_string(temp.path().join("requests.jsonl")).unwrap();
    assert!(requests.contains("session/set_mode"));
    runtime.close(&id).await.unwrap();
}

#[tokio::test]
async fn an_agent_that_stays_in_a_blocked_mode_is_reported_to_the_user() {
    let (_temp, runtime, session) = runtime(vec![
        "--claude-options".into(),
        "--start-mode".into(),
        "bypassPermissions".into(),
        "--refuse-mode".into(),
    ])
    .await;
    let id = session.session.id.clone();
    let snapshot = runtime.snapshot(&id).await.unwrap();
    assert_eq!(
        current(&snapshot, "mode").as_deref(),
        Some("bypassPermissions")
    );
    let notices = notices(&runtime, &id);
    assert_eq!(notices.len(), 1);
    assert_eq!(notices[0]["severity"], "warning");
    assert!(notices[0]["title"]
        .as_str()
        .unwrap()
        .contains("Bypass permissions"));
    runtime.close(&id).await.unwrap();
}

#[tokio::test]
async fn an_agent_that_goes_into_a_blocked_mode_later_is_moved_out_of_it() {
    let (_temp, runtime, session) = runtime(vec!["--claude-options".into()]).await;
    let id = session.session.id.clone();
    runtime
        .prompt(&id, "go-bypass".into(), Vec::new())
        .await
        .unwrap();
    // The switch runs behind the update that announced the mode.
    let mut mode = None;
    for _ in 0..200 {
        let snapshot = runtime.snapshot(&id).await.unwrap();
        mode = current(&snapshot, "mode");
        if mode.as_deref() == Some("default") {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(25)).await;
    }
    assert_eq!(mode.as_deref(), Some("default"));
    runtime.close(&id).await.unwrap();
}

#[tokio::test]
async fn a_task_model_the_agent_lacks_is_reported_not_fatal() {
    let (_temp, runtime, session) = runtime(Vec::new()).await;
    let id = session.session.id.clone();
    assert_eq!(
        runtime.select_model_if_offered(&id, "").await.unwrap(),
        crate::acp::ModelChoice::Kept
    );
    assert_eq!(
        runtime
            .select_model_if_offered(&id, "ghost-model")
            .await
            .unwrap(),
        crate::acp::ModelChoice::NotOffered
    );
    assert_eq!(
        runtime
            .select_model_if_offered(&id, "fixture-second")
            .await
            .unwrap(),
        crate::acp::ModelChoice::Selected
    );
    runtime.close(&id).await.unwrap();
}

#[test]
fn permission_delegate_has_no_auto_allow() {
    // Compile-level: every delegate is handled here.
    for delegate in [
        PermissionDelegateCheck::None,
        PermissionDelegateCheck::ParentChat,
    ] {
        match delegate {
            PermissionDelegateCheck::None | PermissionDelegateCheck::ParentChat => {}
        }
    }
}

use crate::acp::PermissionDelegate as PermissionDelegateCheck;
