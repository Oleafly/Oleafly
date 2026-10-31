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

async fn research_task() -> (
    tempfile::TempDir,
    std::sync::Arc<AcpRuntime>,
    String,
    std::path::PathBuf,
) {
    research_task_with(None).await
}

async fn research_task_with(
    task_commands: Option<super::TaskCommands>,
) -> (
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
            task_commands,
            ..StartSession::default()
        })
        .await
        .unwrap();
    let copy = copy.canonicalize().unwrap();
    (temp, runtime, session.session.id, copy)
}

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

async fn announced_answer(
    runtime: &std::sync::Arc<AcpRuntime>,
    id: &str,
    spec: serde_json::Value,
) -> (String, serde_json::Value) {
    let before = runtime.snapshot(id).await.unwrap().session.last_sequence;
    runtime
        .prompt(id, format!("announced-permission:{spec}"), Vec::new())
        .await
        .unwrap();
    let events = runtime.events(id, before, 500).unwrap().events;
    let outcome = events
        .iter()
        .filter_map(|event| event.data["content"]["text"].as_str())
        .find_map(|text| text.strip_prefix("Permission outcome: "))
        .unwrap_or_default()
        .to_string();
    let option = events
        .iter()
        .rev()
        .find(|event| event.kind == "permission_resolved")
        .map(|event| event.data["optionId"].clone())
        .unwrap_or(serde_json::Value::Null);
    (outcome, option)
}

#[tokio::test]
async fn a_task_request_is_judged_by_the_paths_of_the_call_it_refers_to() {
    let (_temp, runtime, id, copy) = research_task().await;
    let inside = copy.join("paper.tex");
    let outside = copy.parent().unwrap().join("elsewhere.tex");
    let cancelled = ("cancelled".to_string(), serde_json::Value::Null);

    let (outcome, option) = announced_answer(
        &runtime,
        &id,
        serde_json::json!({"kind": "edit", "path": inside}),
    )
    .await;
    assert_eq!((outcome.as_str(), option), ("selected", "yes".into()));
    assert_eq!(
        announced_answer(
            &runtime,
            &id,
            serde_json::json!({"kind": "edit", "path": outside})
        )
        .await,
        cancelled
    );
    assert_eq!(
        announced_answer(
            &runtime,
            &id,
            serde_json::json!({"kind": "edit", "raw": {"notebook_path": outside}})
        )
        .await,
        cancelled
    );
    assert_eq!(
        announced_answer(
            &runtime,
            &id,
            serde_json::json!({"kind": "read", "raw": {"paths": [inside, outside]}})
        )
        .await,
        cancelled
    );
    runtime.close(&id).await.unwrap();
}

#[tokio::test]
async fn a_task_never_allows_a_file_request_that_names_no_path() {
    let (_temp, runtime, id, _copy) = research_task().await;
    for kind in ["read", "edit", "delete", "move"] {
        let (outcome, option) =
            announced_answer(&runtime, &id, serde_json::json!({"kind": kind})).await;
        assert_eq!(
            (outcome.as_str(), option),
            ("selected", "no".into()),
            "{kind}"
        );
    }
    let (_, option) = announced_answer(&runtime, &id, serde_json::json!({"kind": "fetch"})).await;
    assert_eq!(option, "yes");
    runtime.close(&id).await.unwrap();
}

#[tokio::test]
async fn a_deny_rule_refuses_a_research_tasks_request_without_a_card() {
    use crate::approvals::{set_decision, ToolDecision};
    let (temp, runtime, id, copy) = research_task().await;
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

struct GatedApproval {
    gate: std::sync::Arc<tokio::sync::Notify>,
    answer: Result<(), String>,
}

impl super::TaskCommandApproval for GatedApproval {
    fn ask(
        &self,
        _summary: String,
        _detail: String,
    ) -> futures_util::future::BoxFuture<'static, Result<(), String>> {
        let gate = self.gate.clone();
        let answer = self.answer.clone();
        Box::pin(async move {
            gate.notified().await;
            answer
        })
    }
}

async fn answer_aged_command_request(
    answer: Result<(), String>,
    before_answer: impl FnOnce(&super::runtime::LiveSession),
) -> (String, serde_json::Value) {
    let gate = std::sync::Arc::new(tokio::sync::Notify::new());
    let (_temp, runtime, id, copy) = research_task_with(Some(super::TaskCommands::Ask(
        std::sync::Arc::new(GatedApproval {
            gate: gate.clone(),
            answer,
        }),
    )))
    .await;
    let prompt = format!(
        "ask-permission:{}",
        serde_json::json!({"kind": "execute", "path": copy.join("paper.tex")})
    );
    let turn = {
        let runtime = runtime.clone();
        let id = id.clone();
        tokio::spawn(async move { runtime.prompt(&id, prompt, Vec::new()).await })
    };
    let request = tokio::time::timeout(std::time::Duration::from_secs(10), async {
        loop {
            if let Some(request) = runtime.snapshot(&id).await.unwrap().permissions.first() {
                break request.clone();
            }
            tokio::time::sleep(std::time::Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("the command request reaches the approval queue");
    assert!(request.expires_at > super::types::now_ms() + 60 * 60 * 1000);
    let live = runtime.get_live(&id).await.unwrap();
    live.state
        .lock()
        .unwrap()
        .permissions
        .values_mut()
        .for_each(|pending| pending.request.expires_at = 1);
    before_answer(&live);
    gate.notify_one();
    tokio::time::timeout(std::time::Duration::from_secs(10), turn)
        .await
        .expect("the agent is answered and its turn ends")
        .unwrap()
        .unwrap();
    let events = runtime.events(&id, 0, 500).unwrap().events;
    let message = events
        .iter()
        .filter_map(|event| event.data["content"]["text"].as_str())
        .find(|text| text.starts_with("Permission outcome"))
        .unwrap_or_default()
        .to_string();
    let resolved = events
        .iter()
        .rev()
        .find(|event| event.kind == "permission_resolved")
        .map(|event| event.data.clone())
        .unwrap();
    runtime.close(&id).await.unwrap();
    (message, resolved)
}

#[tokio::test]
async fn a_late_task_approval_still_answers_the_agent() {
    let (message, resolved) = answer_aged_command_request(Ok(()), |_| {}).await;
    assert_eq!(message, "Permission outcome: selected");
    assert_eq!(resolved["optionId"], "yes");
}

#[tokio::test]
async fn a_late_task_denial_still_answers_the_agent() {
    let (message, resolved) =
        answer_aged_command_request(Err("The user didn't approve this command.".into()), |_| {})
            .await;
    assert_eq!(message, "Permission outcome: selected");
    assert_eq!(resolved["optionId"], "no");
}

#[tokio::test]
async fn a_task_approval_that_cannot_be_applied_cancels_the_request() {
    let (message, resolved) = answer_aged_command_request(Ok(()), |live| {
        live.state
            .lock()
            .unwrap()
            .permissions
            .values_mut()
            .for_each(|pending| pending.request.options.clear());
    })
    .await;
    assert_eq!(message, "Permission outcome: cancelled");
    assert_eq!(resolved["outcome"], "cancelled");
}

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
    let home = temp.path().join("acp-home-1");
    std::fs::create_dir(&home).unwrap();
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

fn requests_in(home: &std::path::Path) -> Vec<serde_json::Value> {
    std::fs::read_to_string(home.join("requests.jsonl"))
        .unwrap_or_default()
        .lines()
        .filter_map(|line| serde_json::from_str(line).ok())
        .collect()
}

fn logging_definition(
    temp: &tempfile::TempDir,
    home: &std::path::Path,
    extra: &[&str],
) -> super::AgentDefinition {
    let mut args = vec![
        String::new(),
        "--record-requests".into(),
        "--requests-dir".into(),
        home.canonicalize().unwrap().to_string_lossy().into_owned(),
    ];
    args.extend(extra.iter().map(|arg| (*arg).to_string()));
    super::tests::fixture_definition(args, temp.path())
}

#[tokio::test]
async fn a_sandboxed_task_agent_is_never_offered_or_served_file_reads() {
    let temp = super::tests::fixture_temp();
    let copy = temp.path().join("task-copy");
    std::fs::create_dir(&copy).unwrap();
    std::fs::write(copy.join("paper.tex"), "task text").unwrap();
    let home = temp.path().join("acp-home-1");
    std::fs::create_dir(&home).unwrap();
    let definition = logging_definition(&temp, &home, &["--caps-v126"]);
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
                task_id: Some("read-task".into()),
                owner: Some("research-task:read".into()),
                allowed_paths: Some(vec!["paper.tex".into()]),
                ..StartSession::default()
            },
            Vec::new(),
            None,
        )
        .await
        .unwrap();
    let id = snapshot.session.id;
    let initialize = requests_in(&home)
        .into_iter()
        .find(|request| request["method"] == "initialize")
        .unwrap();
    assert_eq!(
        initialize["params"]["clientCapabilities"]["fs"]["readTextFile"],
        false
    );
    runtime
        .prompt(&id, "read-file:paper.tex".into(), Vec::new())
        .await
        .unwrap();
    let text: String = runtime
        .events_all(&id)
        .unwrap()
        .iter()
        .filter_map(|event| event.data["content"]["text"].as_str().map(str::to_owned))
        .collect();
    assert!(text.contains("Read failed -32601"), "{text}");
    assert!(!text.contains("task text"));
    runtime.close(&id).await.unwrap();
}

#[tokio::test]
async fn the_v1_restart_keeps_a_handed_back_agent_home() {
    let temp = super::tests::fixture_temp();
    let copy = temp.path().join("task-copy");
    std::fs::create_dir(&copy).unwrap();
    let home = temp.path().join("acp-home-1");
    std::fs::create_dir(&home).unwrap();
    std::fs::write(home.join("session-history.json"), "{}").unwrap();
    let definition = logging_definition(&temp, &home, &["--caps-v126"]);
    let runtime = AcpRuntime::new(temp.path().join("acp")).unwrap();
    runtime
        .register(&serde_json::to_string(&definition).unwrap())
        .unwrap();
    runtime
        .set_preferences(super::AcpPreferences {
            experimental_v2: true,
            ..Default::default()
        })
        .await
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
                task_id: Some("v1-task".into()),
                owner: Some("research-task:v1".into()),
                allowed_paths: Some(vec!["paper.tex".into()]),
                ..StartSession::default()
            },
            Vec::new(),
            None,
        )
        .await
        .unwrap();
    assert!(home.join("session-history.json").is_file());
    let requests = requests_in(&home);
    let starts = requests
        .iter()
        .filter(|request| request["method"] == "initialize")
        .count();
    assert_eq!(starts, 2, "the v2 attempt, then the v1 restart");
    assert!(requests
        .iter()
        .any(|request| request["method"] == "session/resume"
            && request["params"]["sessionId"] == "agent-session-x"));
    runtime.close(&snapshot.session.id).await.unwrap();
}

#[tokio::test]
async fn a_retried_task_resumes_its_agent_session_in_the_home_it_kept() {
    let temp = super::tests::fixture_temp();
    let copy = temp.path().join("task-copy");
    std::fs::create_dir(&copy).unwrap();
    let definition =
        super::tests::fixture_definition(vec![String::new(), "--caps-v126".into()], temp.path());
    let runtime = AcpRuntime::new(temp.path().join("acp")).unwrap();
    runtime
        .register(&serde_json::to_string(&definition).unwrap())
        .unwrap();
    let start = || StartSession {
        project_id: TASK_PROJECT.into(),
        project_path: copy.clone(),
        agent_id: definition.id.clone(),
        task_id: Some("retry-task".into()),
        owner: Some("research-task:retry".into()),
        allowed_paths: Some(vec!["paper.tex".into()]),
        ..StartSession::default()
    };
    let first = runtime.start(start()).await.unwrap();
    let id = first.session.id.clone();
    let native = first.session.native_session_id.clone().unwrap();
    let task_temp = temp.path().join("acp/task-temp");
    let home = std::fs::read_dir(&task_temp)
        .unwrap()
        .next()
        .unwrap()
        .unwrap()
        .path();
    std::fs::write(home.join("history.jsonl"), "turn 1").unwrap();
    runtime.end_task_session(&id).await.unwrap();
    let kept = temp.path().join("acp/task-homes").join(&id);
    assert!(kept.join("history.jsonl").is_file());
    assert_eq!(std::fs::read_dir(&task_temp).unwrap().count(), 0);
    let resumed = runtime
        .resume_task_session(&native, start(), Vec::new(), None)
        .await
        .unwrap();
    assert_eq!(resumed.session.id, id);
    assert!(kept.join("history.jsonl").is_file());
    assert_eq!(std::fs::read_dir(&task_temp).unwrap().count(), 0);
    runtime.end_task_session(&id).await.unwrap();
    assert!(kept.join("history.jsonl").is_file(), "kept in place again");
}

#[tokio::test]
async fn a_queued_handoff_launch_leaves_no_sign_in_copy_in_the_home() {
    let temp = super::tests::fixture_temp();
    let copy = temp.path().join("task-copy");
    std::fs::create_dir(&copy).unwrap();
    let home = temp.path().join("acp-home-1");
    std::fs::create_dir_all(home.join(".gemini")).unwrap();
    std::fs::write(home.join(".gemini/settings.json"), "{}").unwrap();
    std::fs::write(home.join("history.jsonl"), "kept").unwrap();
    let definition = super::tests::fixture_definition(vec![String::new()], temp.path());
    let runtime = AcpRuntime::new(temp.path().join("acp")).unwrap();
    runtime
        .register(&serde_json::to_string(&definition).unwrap())
        .unwrap();
    let allowed = vec!["paper.tex".to_string()];
    let queued = runtime
        .task_launch_without_sign_in(
            &definition.id,
            TASK_PROJECT,
            "queued-task",
            &copy,
            &allowed,
            &home,
        )
        .await
        .unwrap();
    assert!(!home.join(".gemini/settings.json").exists());
    assert!(home.join("history.jsonl").is_file());
    let started = runtime
        .task_launch(
            &definition.id,
            TASK_PROJECT,
            "queued-task",
            &copy,
            &allowed,
            &home,
        )
        .await
        .unwrap();
    assert_eq!(queued.program, started.program);
    assert_eq!(queued.args, started.args);
}
