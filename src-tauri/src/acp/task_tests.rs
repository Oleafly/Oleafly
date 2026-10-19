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
    tokio::fs::create_dir(&copy).await.unwrap();
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

// 0.4.8 L: CLI-agent tasks handed to and from the background helper.

#[tokio::test]
async fn a_handoff_close_moves_the_home_after_the_agent_exits() {
    let (temp, runtime, id, _copy) = research_task().await;
    let task_temp = temp.path().join("acp/task-temp");
    let home = std::fs::read_dir(&task_temp)
        .unwrap()
        .next()
        .unwrap()
        .unwrap()
        .path();
    std::fs::write(home.join("session-history.json"), "{}").unwrap();
    let destination = temp
        .path()
        .join("research-tasks/workspaces/rules-task/acp-home-1");
    let handoff = runtime
        .close_task_for_handoff(&id, &destination)
        .await
        .unwrap();
    assert_eq!(handoff.agent_session_id, "fixture-native");
    assert_eq!(handoff.home, destination);
    assert!(destination.join("session-history.json").is_file());
    assert_eq!(std::fs::read_dir(&task_temp).unwrap().count(), 0);
}

#[tokio::test]
async fn adopting_a_handoff_resumes_the_agent_session() {
    let temp = super::tests::fixture_temp();
    let copy = temp.path().join("task-copy");
    std::fs::create_dir(&copy).unwrap();
    let home = temp.path().join("agent-home");
    std::fs::create_dir(&home).unwrap();
    // The sandboxed agent writes its request log in its home.
    let definition = super::tests::fixture_definition(
        vec![
            String::new(),
            "--caps-v126".into(),
            "--record-requests".into(),
            "--requests-dir".into(),
            home.canonicalize().unwrap().to_string_lossy().into_owned(),
        ],
        temp.path(),
    );
    let runtime = AcpRuntime::new(temp.path().join("acp")).unwrap();
    runtime
        .register(&serde_json::to_string(&definition).unwrap())
        .unwrap();
    let snapshot = runtime
        .adopt_task_session(
            &oleafly_research::handoff::AcpHandoff {
                agent_session_id: "agent-session-x".into(),
                home: home.clone(),
            },
            StartSession {
                project_id: TASK_PROJECT.into(),
                project_path: copy,
                agent_id: definition.id,
                task_id: Some("adopt-task".into()),
                owner: Some("research-task:adopt".into()),
                allowed_paths: Some(vec!["paper.tex".into()]),
                ..StartSession::default()
            },
            Vec::new(),
            None,
        )
        .await
        .unwrap();
    let requests = std::fs::read_to_string(home.join("requests.jsonl")).unwrap();
    let resume = requests
        .lines()
        .filter_map(|line| serde_json::from_str::<serde_json::Value>(line).ok())
        .find(|request| request["method"] == "session/resume")
        .expect("the adopted session opens with session/resume");
    assert_eq!(resume["params"]["sessionId"], "agent-session-x");
    assert!(!requests.contains("\"session/new\""));
    runtime.close(&snapshot.session.id).await.unwrap();
}

#[tokio::test]
async fn the_task_launch_matches_the_command_the_app_runs() {
    if !matches!(
        oleafly_sandbox::availability(),
        oleafly_sandbox::Availability::Available
    ) {
        return;
    }
    let temp = super::tests::fixture_temp();
    let copy = temp.path().join("task-copy");
    std::fs::create_dir(&copy).unwrap();
    let home = temp.path().join("agent-home");
    std::fs::create_dir(&home).unwrap();
    let definition = super::tests::fixture_definition(vec![String::new()], temp.path());
    let acp_root = temp.path().join("acp");
    let runtime = AcpRuntime::new(acp_root.clone()).unwrap();
    runtime
        .register(&serde_json::to_string(&definition).unwrap())
        .unwrap();
    let allowed = vec!["paper.tex".to_string()];
    let launch = runtime
        .task_launch(
            &definition.id,
            TASK_PROJECT,
            "launch-task",
            &copy,
            &allowed,
            &home,
        )
        .await
        .unwrap();
    let args: Vec<std::ffi::OsString> = launch.args.iter().map(Into::into).collect();
    let rebuilt = oleafly_sandbox::command(&launch.sandbox, &launch.program, &args).unwrap();
    let root = copy.canonicalize().unwrap();
    let record = super::types::SessionRecord {
        project_id: TASK_PROJECT.into(),
        project_path: root.to_string_lossy().into_owned(),
        agent_id: definition.id.clone(),
        task_id: Some("launch-task".into()),
        ..super::types::SessionRecord::default()
    };
    let plan = super::catalog::plan(&acp_root, &definition, None)
        .launch
        .unwrap();
    let app = super::runtime::build_agent_command(
        &acp_root,
        &record,
        &definition,
        &plan,
        &root,
        Some(&allowed),
        Some(&home),
    )
    .unwrap();
    let app = app.as_std();
    assert_eq!(rebuilt.get_program(), app.get_program());
    assert_eq!(
        rebuilt.get_args().collect::<Vec<_>>(),
        app.get_args().collect::<Vec<_>>()
    );
    let mut rebuilt_env: Vec<_> = rebuilt.get_envs().collect();
    let mut app_env: Vec<_> = app.get_envs().collect();
    rebuilt_env.sort();
    app_env.sort();
    assert_eq!(rebuilt_env, app_env);
}
