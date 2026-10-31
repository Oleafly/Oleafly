use super::completed_turn_output;
use crate::acp::{
    tests::{fixture_definition, fixture_temp},
    AcpRuntime, StartSession,
};
use std::sync::Arc;

async fn session() -> (tempfile::TempDir, Arc<AcpRuntime>, String) {
    let temp = fixture_temp();
    let project = temp.path().join("project");
    std::fs::create_dir(&project).unwrap();
    let runtime = AcpRuntime::new(temp.path().join("acp")).unwrap();
    runtime
        .register(&serde_json::to_string(&fixture_definition(Vec::new(), temp.path())).unwrap())
        .unwrap();
    let snapshot = runtime
        .start(StartSession {
            project_id: "delegation-fixture".into(),
            project_path: project,
            agent_id: "fixture-agent".into(),
            owner: Some("delegation-test".into()),
            ..StartSession::default()
        })
        .await
        .unwrap();
    (temp, runtime, snapshot.session.id)
}

#[tokio::test]
async fn delegated_turns_return_only_the_new_answer_after_reconnect() {
    let (_temp, runtime, id) = session().await;
    let before = runtime.snapshot(&id).await.unwrap().session.last_sequence;
    runtime
        .prompt(&id, "First question".into(), Vec::new())
        .await
        .unwrap();
    assert_eq!(
        completed_turn_output(&runtime, &id, before).unwrap(),
        "Fixture answer: First question"
    );
    runtime.close(&id).await.unwrap();
    runtime
        .reconnect(&id, Some("delegation-test".into()))
        .await
        .unwrap();
    let before = runtime.snapshot(&id).await.unwrap().session.last_sequence;
    runtime
        .prompt(&id, "Follow-up question".into(), Vec::new())
        .await
        .unwrap();
    assert_eq!(
        completed_turn_output(&runtime, &id, before).unwrap(),
        "Fixture answer: Follow-up question"
    );
    runtime.close(&id).await.unwrap();
}

#[tokio::test]
async fn delegated_output_reads_every_event_page_before_reporting_success() {
    let (_temp, runtime, id) = session().await;
    let before = runtime.snapshot(&id).await.unwrap().session.last_sequence;
    runtime
        .prompt(&id, "paged-answer".into(), Vec::new())
        .await
        .unwrap();
    let expected = (0..520)
        .map(|index| format!("{index}|"))
        .collect::<String>();
    assert_eq!(
        completed_turn_output(&runtime, &id, before).unwrap(),
        expected
    );
    runtime.close(&id).await.unwrap();
}

#[tokio::test]
async fn delegated_partial_answers_are_retained_without_reporting_completion() {
    let (_temp, runtime, id) = session().await;
    for stop in ["max_tokens", "max_turn_requests", "refusal", "cancelled"] {
        let before = runtime.snapshot(&id).await.unwrap().session.last_sequence;
        runtime
            .prompt(&id, format!("stop:{stop}"), Vec::new())
            .await
            .unwrap();
        assert!(completed_turn_output(&runtime, &id, before)
            .unwrap_err()
            .contains(stop));
        let events = runtime.events(&id, before, 500).unwrap().events;
        assert!(events
            .iter()
            .any(|event| event.kind == "agent_message_chunk"
                && event.data["content"]["text"] == "Partial saved answer"));
    }
    let before = runtime.snapshot(&id).await.unwrap().session.last_sequence;
    assert!(completed_turn_output(&runtime, &id, before)
        .unwrap_err()
        .contains("no completion event"));
    runtime.close(&id).await.unwrap();
}

#[tokio::test]
async fn missing_or_empty_completion_reason_fails_without_losing_partial_output() {
    for prompt in ["missing-stop", "stop:"] {
        let (_temp, runtime, id) = session().await;
        let before = runtime.snapshot(&id).await.unwrap().session.last_sequence;
        assert!(runtime
            .prompt(&id, prompt.into(), Vec::new())
            .await
            .is_err());
        assert_eq!(
            runtime.snapshot(&id).await.unwrap().session.status,
            crate::acp::SessionStatus::Ready
        );
        assert!(completed_turn_output(&runtime, &id, before).is_err());
        let events = runtime.events(&id, before, 500).unwrap().events;
        assert!(events
            .iter()
            .any(|event| event.kind == "agent_message_chunk"
                && super::event_text(&event.data) == Some("Partial saved answer")));
        runtime.close(&id).await.unwrap();
    }
}

async fn delegated_session(
    delegate: crate::acp::PermissionDelegate,
) -> (tempfile::TempDir, Arc<AcpRuntime>, String) {
    let temp = fixture_temp();
    let project = temp.path().join("project");
    std::fs::create_dir(&project).unwrap();
    let runtime = AcpRuntime::new(temp.path().join("acp")).unwrap();
    runtime
        .register(&serde_json::to_string(&fixture_definition(Vec::new(), temp.path())).unwrap())
        .unwrap();
    let snapshot = runtime
        .start(StartSession {
            project_id: "delegation-fixture".into(),
            project_path: project,
            agent_id: "fixture-agent".into(),
            parent_session_id: Some("parent-chat".into()),
            owner: Some("external:delegated".into()),
            ..StartSession::default()
        })
        .await
        .unwrap();
    runtime
        .set_permission_delegate(&snapshot.session.id, delegate)
        .await
        .unwrap();
    (temp, runtime, snapshot.session.id)
}

#[tokio::test]
async fn a_delegated_child_forwards_its_permission_to_the_parent_conversation() {
    let (_temp, runtime, id) = delegated_session(crate::acp::PermissionDelegate::ParentChat).await;
    let prompting = runtime.clone();
    let prompt_id = id.clone();
    let turn = tokio::spawn(async move {
        prompting
            .prompt(&prompt_id, "permission".into(), Vec::new())
            .await
    });
    let request = tokio::time::timeout(std::time::Duration::from_secs(5), async {
        loop {
            let pending = runtime.snapshot(&id).await.unwrap().permissions;
            if let Some(request) = pending.into_iter().next() {
                break request;
            }
            tokio::time::sleep(std::time::Duration::from_millis(10)).await;
        }
    })
    .await
    .unwrap();
    runtime
        .resolve_delegated_permission(&id, &request.id, Some("yes".into()))
        .await
        .unwrap();
    turn.await.unwrap().unwrap();
    let events = runtime.events(&id, 0, 500).unwrap().events;
    assert!(events
        .iter()
        .any(|event| event.kind == "agent_message_chunk"
            && super::event_text(&event.data) == Some("Permission outcome: selected")));
    runtime.close(&id).await.unwrap();
}

#[tokio::test]
async fn a_child_without_a_permission_route_is_declined_instead_of_stalling() {
    let (_temp, runtime, id) = delegated_session(crate::acp::PermissionDelegate::None).await;
    let before = runtime.snapshot(&id).await.unwrap().session.last_sequence;
    tokio::time::timeout(
        std::time::Duration::from_secs(10),
        runtime.prompt(&id, "permission".into(), Vec::new()),
    )
    .await
    .unwrap()
    .unwrap();
    let events = runtime.events(&id, before, 500).unwrap().events;
    assert!(events
        .iter()
        .any(|event| event.kind == "permission_resolved" && event.data["outcome"] == "cancelled"));
    runtime.close(&id).await.unwrap();
}

async fn helper_asks(
    temp: &tempfile::TempDir,
    runtime: &Arc<AcpRuntime>,
    id: &str,
    kind: &str,
) -> (
    tokio::task::JoinHandle<Result<(), String>>,
    crate::acp::PermissionRequest,
) {
    let path = temp
        .path()
        .join("project")
        .canonicalize()
        .unwrap()
        .join("paper.tex");
    let prompt = format!(
        "ask-permission:{}",
        serde_json::json!({"kind": kind, "path": path})
    );
    let prompting = runtime.clone();
    let prompt_id = id.to_owned();
    let turn = tokio::spawn(async move {
        prompting
            .prompt(&prompt_id, prompt, Vec::new())
            .await
            .map(|_| ())
    });
    let request = tokio::time::timeout(std::time::Duration::from_secs(5), async {
        loop {
            let pending = runtime.snapshot(id).await.unwrap().permissions;
            if let Some(request) = pending.into_iter().next() {
                break request;
            }
            tokio::time::sleep(std::time::Duration::from_millis(10)).await;
        }
    })
    .await
    .unwrap();
    (turn, request)
}

fn chosen_option(runtime: &AcpRuntime, id: &str) -> serde_json::Value {
    runtime
        .events(id, 0, 500)
        .unwrap()
        .events
        .into_iter()
        .rev()
        .find(|event| event.kind == "permission_resolved")
        .map(|event| event.data["optionId"].clone())
        .unwrap()
}

const PROJECT: &str = "delegation-fixture";

#[tokio::test]
async fn a_deny_rule_added_after_the_helper_started_refuses_its_command_without_a_card() {
    use crate::approvals::{set_decision, set_mode, ApprovalMode, ToolDecision};
    let rules = tempfile::tempdir().unwrap();
    set_mode(rules.path(), PROJECT, ApprovalMode::FullAccess).unwrap();
    let (temp, runtime, id) = delegated_session(crate::acp::PermissionDelegate::ParentChat).await;
    set_decision(
        rules.path(),
        PROJECT,
        "run_command",
        Some(ToolDecision::Deny),
    )
    .unwrap();

    let (turn, _) = helper_asks(&temp, &runtime, &id, "execute").await;
    let refused = super::answer_pending_by_rules(&runtime, &id, Some(rules.path()), PROJECT).await;

    assert_eq!(refused, vec!["run_command"]);
    turn.await.unwrap().unwrap();
    assert_eq!(chosen_option(&runtime, &id), "no");
    assert!(runtime.snapshot(&id).await.unwrap().permissions.is_empty());
    runtime.close(&id).await.unwrap();
}

#[tokio::test]
async fn deny_rules_for_file_tools_refuse_a_helpers_edits_under_full_access() {
    use crate::approvals::{set_decision, set_mode, ApprovalMode, ToolDecision};
    let rules = tempfile::tempdir().unwrap();
    set_mode(rules.path(), PROJECT, ApprovalMode::FullAccess).unwrap();
    set_decision(
        rules.path(),
        PROJECT,
        "write_file",
        Some(ToolDecision::Deny),
    )
    .unwrap();
    let (temp, runtime, id) = delegated_session(crate::acp::PermissionDelegate::ParentChat).await;

    let (turn, _) = helper_asks(&temp, &runtime, &id, "edit").await;
    let refused = super::answer_pending_by_rules(&runtime, &id, Some(rules.path()), PROJECT).await;

    assert_eq!(refused, vec!["write_file"]);
    turn.await.unwrap().unwrap();
    assert_eq!(chosen_option(&runtime, &id), "no");
    runtime.close(&id).await.unwrap();
}

#[tokio::test]
async fn full_access_approves_a_helpers_request_that_no_rule_denies() {
    use crate::approvals::{set_decision, set_mode, ApprovalMode, ToolDecision};
    let rules = tempfile::tempdir().unwrap();
    set_mode(rules.path(), PROJECT, ApprovalMode::FullAccess).unwrap();
    set_decision(
        rules.path(),
        PROJECT,
        "run_command",
        Some(ToolDecision::Deny),
    )
    .unwrap();
    let (temp, runtime, id) = delegated_session(crate::acp::PermissionDelegate::ParentChat).await;

    let (turn, _) = helper_asks(&temp, &runtime, &id, "edit").await;
    let refused = super::answer_pending_by_rules(&runtime, &id, Some(rules.path()), PROJECT).await;

    assert!(refused.is_empty());
    turn.await.unwrap().unwrap();
    assert_eq!(chosen_option(&runtime, &id), "yes");
    runtime.close(&id).await.unwrap();
}

#[tokio::test]
async fn leaving_full_access_mid_session_sends_the_next_request_to_the_parent_conversation() {
    use crate::approvals::{set_mode, ApprovalMode};
    let rules = tempfile::tempdir().unwrap();
    set_mode(rules.path(), PROJECT, ApprovalMode::FullAccess).unwrap();
    let (temp, runtime, id) = delegated_session(crate::acp::PermissionDelegate::ParentChat).await;
    set_mode(rules.path(), PROJECT, ApprovalMode::AskForApproval).unwrap();

    let (turn, request) = helper_asks(&temp, &runtime, &id, "execute").await;
    let refused = super::answer_pending_by_rules(&runtime, &id, Some(rules.path()), PROJECT).await;

    assert!(refused.is_empty());
    assert_eq!(runtime.snapshot(&id).await.unwrap().permissions.len(), 1);
    runtime
        .resolve_delegated_permission(&id, &request.id, Some("yes".into()))
        .await
        .unwrap();
    turn.await.unwrap().unwrap();
    runtime.close(&id).await.unwrap();
}

#[tokio::test]
async fn an_unreadable_approvals_file_refuses_a_helpers_command() {
    let rules = tempfile::tempdir().unwrap();
    std::fs::write(
        rules.path().join("approvals.toml"),
        "[\"$approval_modes\"]\ndelegation-fixture = \"full-access\"\n[delegation-fixture\n",
    )
    .unwrap();
    let (temp, runtime, id) = delegated_session(crate::acp::PermissionDelegate::ParentChat).await;

    let (turn, _) = helper_asks(&temp, &runtime, &id, "execute").await;
    let refused = super::answer_pending_by_rules(&runtime, &id, Some(rules.path()), PROJECT).await;

    assert_eq!(refused, vec!["run_command"]);
    turn.await.unwrap().unwrap();
    assert_eq!(chosen_option(&runtime, &id), "no");
    runtime.close(&id).await.unwrap();
}

#[tokio::test]
async fn full_access_sends_a_request_no_rule_covers_to_the_card_while_a_deny_rule_exists() {
    use crate::approvals::{set_decision, set_mode, ApprovalMode, ToolDecision};
    let rules = tempfile::tempdir().unwrap();
    set_mode(rules.path(), PROJECT, ApprovalMode::FullAccess).unwrap();
    set_decision(
        rules.path(),
        PROJECT,
        "run_command",
        Some(ToolDecision::Deny),
    )
    .unwrap();
    let (temp, runtime, id) = delegated_session(crate::acp::PermissionDelegate::ParentChat).await;

    let (turn, request) = helper_asks(&temp, &runtime, &id, "fetch").await;
    let refused = super::answer_pending_by_rules(&runtime, &id, Some(rules.path()), PROJECT).await;

    assert!(refused.is_empty());
    assert_eq!(request.kind.as_deref(), Some("fetch"));
    assert_eq!(runtime.snapshot(&id).await.unwrap().permissions.len(), 1);
    runtime
        .resolve_delegated_permission(&id, &request.id, Some("no".into()))
        .await
        .unwrap();
    turn.await.unwrap().unwrap();
    runtime.close(&id).await.unwrap();
}

#[test]
fn a_refused_request_is_described_in_the_apps_language() {
    assert_eq!(
        crate::i18n::t_with_in("en", "approvals.helperRefused", &[("tool", "run_command")]),
        "Refused by the run_command rule in approvals.toml"
    );
    let detail = super::refused_by_rule_detail("run_command");
    assert!(detail.contains("run_command"), "{detail}");
    assert!(
        !detail.contains("helperRefused") && !detail.contains("{{"),
        "{detail}"
    );
}

#[test]
fn a_helper_asked_for_a_model_its_agent_does_not_offer_fails() {
    use crate::acp::ModelChoice;
    let error = super::asked_model_offered(ModelChoice::NotOffered, "codex", "gpt-x").unwrap_err();
    assert!(error.contains("gpt-x"), "{error}");
    assert!(super::asked_model_offered(ModelChoice::Selected, "codex", "gpt-x").is_ok());
    assert!(super::asked_model_offered(ModelChoice::Kept, "codex", "gpt-x").is_ok());
}
