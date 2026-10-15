use super::{AcpRuntime, StartSession};

#[tokio::test]
async fn confined_acp_fixture_cannot_read_unlinked_files() {
    let temp = super::tests::fixture_temp();
    let project = temp.path().join("project");
    std::fs::create_dir(&project).unwrap();
    let outside = temp.path().join("unlinked.txt");
    std::fs::write(&outside, "private fixture data").unwrap();
    let definition = super::tests::fixture_definition(
        vec![String::new(), outside.to_string_lossy().into_owned()],
        temp.path(),
    );
    let runtime = AcpRuntime::new(temp.path().join("acp")).unwrap();
    runtime
        .register(&serde_json::to_string(&definition).unwrap())
        .unwrap();
    let session = runtime
        .start(StartSession {
            project_id: "fixture-project".into(),
            project_path: project,
            agent_id: definition.id,
            task_id: Some("fixture-task".into()),
            owner: Some("research-task:fixture".into()),
            allowed_paths: Some(vec!["paper.tex".into()]),
            ..StartSession::default()
        })
        .await
        .unwrap();
    let task_temp = temp.path().join("acp/task-temp");
    assert_eq!(std::fs::read_dir(&task_temp).unwrap().count(), 1);
    let id = session.session.id;
    runtime
        .prompt(&id, "scope-probe".into(), Vec::new())
        .await
        .unwrap();
    let events = runtime.events(&id, 0, 100).unwrap().events;
    assert!(events
        .iter()
        .any(|event| event.data["content"]["text"] == "outside read denied"));
    runtime.close(&id).await.unwrap();
    assert_eq!(std::fs::read_dir(&task_temp).unwrap().count(), 0);
    assert!(runtime
        .reconnect(&id, Some("research-task:fixture".into()))
        .await
        .is_err());
}

const TASK_PROJECT: &str = "task-rules-project";

/// A research task's session. Its folder stands in for the temporary copy of
/// the project, and the approval rules sit in the data folder, keyed by the
/// original project's id.
async fn research_task() -> (
    tempfile::TempDir,
    std::sync::Arc<AcpRuntime>,
    String,
    std::path::PathBuf,
) {
    let temp = super::tests::fixture_temp();
    let copy = temp.path().join("task-copy");
    std::fs::create_dir(&copy).unwrap();
    let definition = super::tests::fixture_definition(Vec::new(), temp.path());
    let runtime = AcpRuntime::new(temp.path().join("acp")).unwrap();
    runtime
        .register(&serde_json::to_string(&definition).unwrap())
        .unwrap();
    let session = runtime
        .start(StartSession {
            project_id: TASK_PROJECT.into(),
            project_path: copy.clone(),
            agent_id: definition.id,
            task_id: Some("rules-task".into()),
            owner: Some("research-task:rules".into()),
            allowed_paths: Some(vec!["paper.tex".into()]),
            ..StartSession::default()
        })
        .await
        .unwrap();
    let copy = copy.canonicalize().unwrap();
    (temp, runtime, session.session.id, copy)
}

/// The option the runtime chose for a request of this kind. A task's request
/// is answered at once, so it is never left pending.
async fn task_answer(
    runtime: &std::sync::Arc<AcpRuntime>,
    id: &str,
    copy: &std::path::Path,
    kind: &str,
) -> serde_json::Value {
    let before = runtime.snapshot(id).await.unwrap().session.last_sequence;
    let prompt = format!(
        "ask-permission:{}",
        serde_json::json!({"kind": kind, "path": copy.join("paper.tex")})
    );
    runtime.prompt(id, prompt, Vec::new()).await.unwrap();
    runtime
        .events(id, before, 500)
        .unwrap()
        .events
        .into_iter()
        .rev()
        .find(|event| event.kind == "permission_resolved")
        .map(|event| event.data["optionId"].clone())
        .unwrap()
}

#[tokio::test]
async fn a_deny_rule_refuses_a_research_tasks_request_without_a_card() {
    use crate::approvals::{set_decision, ToolDecision};
    let (temp, runtime, id, copy) = research_task().await;
    // The rule is written after the task started, for the original project.
    set_decision(
        temp.path(),
        TASK_PROJECT,
        "run_command",
        Some(ToolDecision::Deny),
    )
    .unwrap();

    assert_eq!(task_answer(&runtime, &id, &copy, "execute").await, "no");
    assert_eq!(task_answer(&runtime, &id, &copy, "edit").await, "yes");
    runtime.close(&id).await.unwrap();
}

#[tokio::test]
async fn a_research_task_refuses_a_kind_no_rule_covers_while_a_deny_rule_exists() {
    use crate::approvals::{set_decision, ToolDecision};
    let (temp, runtime, id, copy) = research_task().await;
    assert_eq!(task_answer(&runtime, &id, &copy, "fetch").await, "yes");
    set_decision(
        temp.path(),
        TASK_PROJECT,
        "write_file",
        Some(ToolDecision::Deny),
    )
    .unwrap();

    assert_eq!(task_answer(&runtime, &id, &copy, "fetch").await, "no");
    assert_eq!(task_answer(&runtime, &id, &copy, "").await, "no");
    assert_eq!(task_answer(&runtime, &id, &copy, "read").await, "yes");
    runtime.close(&id).await.unwrap();
}

#[tokio::test]
async fn an_unreadable_rules_file_refuses_a_research_tasks_request() {
    let (temp, runtime, id, copy) = research_task().await;
    std::fs::write(
        temp.path().join("approvals.toml"),
        "[task-rules-project\nrun_command = deny",
    )
    .unwrap();

    assert_eq!(task_answer(&runtime, &id, &copy, "edit").await, "no");
    runtime.close(&id).await.unwrap();
}
