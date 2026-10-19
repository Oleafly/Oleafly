use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use oleafly_research::handoff::{
    AcpGrant, AcpHandoff, AcpLaunch, HandoffReason, HandoffRecord, TaskGrant, TRUST_AGENTS,
    TRUST_MCP, TRUST_RESEARCH_TASKS,
};
use oleafly_research::host::OwnerKind;
use oleafly_research::model::{
    CommandPolicy, HandoffResume, ResearchBrief, ResearchTaskDraft, ResumeContext, ResumeReason,
    TaskRunContext, TaskRuntimeEvent, TaskRuntimeOutcome,
};
use oleafly_research::scheduler::{ResearchTaskState, TaskRuntimeAdapter};
use oleafly_research::store::TaskStore;
use serde_json::json;

use super::*;
use crate::agent::desktop_config::Prefs;
use crate::daemon::hosts::{DaemonResearchHost, DaemonTaskHost, LiveSpend};
use crate::daemon::log::HelperLog;
use crate::daemon::notify::Notifier;

fn acp_grant(refused: &[&str], refuse_unlisted: bool) -> AcpGrant {
    AcpGrant {
        agent_id: "claude".into(),
        launch: AcpLaunch {
            sandbox: oleafly_sandbox::SandboxSpec::default(),
            program: PathBuf::from("/usr/bin/agent"),
            args: Vec::new(),
        },
        refused_kinds: refused.iter().map(|kind| (*kind).to_string()).collect(),
        refuse_unlisted,
    }
}

#[test]
fn refused_kinds_from_the_grant_are_refused_without_asking() {
    assert_eq!(
        permission_decision(
            &acp_grant(&["execute"], false),
            Some("execute"),
            CommandPolicy::Ask
        ),
        PermissionPath::Refuse
    );
    assert_eq!(
        permission_decision(&acp_grant(&[], false), Some("execute"), CommandPolicy::Ask),
        PermissionPath::Ask
    );
    assert_eq!(
        permission_decision(&acp_grant(&[], false), Some("execute"), CommandPolicy::Off),
        PermissionPath::Refuse
    );
    assert_eq!(
        permission_decision(
            &acp_grant(&[], false),
            Some("execute"),
            CommandPolicy::Allow
        ),
        PermissionPath::Allow
    );
    assert_eq!(
        permission_decision(&acp_grant(&[], false), Some("edit"), CommandPolicy::Ask),
        PermissionPath::Allow
    );
    assert_eq!(
        permission_decision(
            &acp_grant(&[], true),
            Some("teleport"),
            CommandPolicy::Allow
        ),
        PermissionPath::Refuse
    );
    assert_eq!(
        permission_decision(&acp_grant(&[], true), None, CommandPolicy::Allow),
        PermissionPath::Refuse
    );
    assert_eq!(
        permission_decision(&acp_grant(&[], false), None, CommandPolicy::Allow),
        PermissionPath::Allow
    );
}

#[test]
fn copied_credentials_are_redacted() {
    let home = tempfile::tempdir().unwrap();
    std::fs::create_dir_all(home.path().join(".claude")).unwrap();
    std::fs::write(
        home.path().join(".claude/.credentials.json"),
        r#"{"token":"oauth-xyz"}"#,
    )
    .unwrap();
    let redactor = redactor_for_home(
        home.path(),
        "claude",
        &[json!({"name": "zotero", "env": [{"name": "TOKEN", "value": "mcp-env-secret"}]})],
    );
    assert_eq!(
        redactor.text("token oauth-xyz here"),
        "token [credential omitted] here"
    );
    assert!(!redactor.text("mcp-env-secret").contains("mcp-env-secret"));
    assert_eq!(
        credential_files("gemini"),
        [".gemini/oauth_creds.json", ".gemini/google_accounts.json"]
    );
    assert!(credential_files("unknown").is_empty());
}

#[test]
fn continuation_prompts_say_the_turn_was_interrupted_and_name_the_handoff() {
    let resume = ResumeContext {
        reason: ResumeReason::Handoff,
        handoff: "Read three papers.".into(),
        plan: String::new(),
        ledger_tail: String::new(),
        previous_native_session_id: None,
    };
    let text = continuation_prompt(Some(&resume), "research/survey", true);
    assert!(text.starts_with("Your previous turn was interrupted."));
    assert!(text.contains("research/survey/handoff.md"));
    assert!(
        !continuation_prompt(Some(&resume), "research/survey", false).starts_with("Your previous")
    );
}

#[test]
fn updates_map_like_the_app() {
    let mut outcome = TaskRuntimeOutcome {
        summary: String::new(),
        artifacts: Vec::new(),
        native_session_id: None,
        input_tokens: None,
        output_tokens: None,
    };
    let text = map_update(
        "agent_message_chunk",
        &json!({"sessionUpdate": "agent_message_chunk", "content": {"type": "text", "text": "A result"}}),
        &mut outcome,
    );
    assert!(matches!(text, Some(TaskRuntimeEvent::Text { text }) if text == "A result"));
    assert_eq!(outcome.summary, "A result");
    assert!(map_update(
        "usage",
        &json!({"contextUsed": 1, "source": "acp_context"}),
        &mut outcome
    )
    .is_none());
    map_update(
        "usage",
        &json!({"inputTokens": 7, "outputTokens": 2, "source": "acp_prompt"}),
        &mut outcome,
    );
    assert_eq!(
        (outcome.input_tokens, outcome.output_tokens),
        (Some(7), Some(2))
    );
    let call = map_update(
        "tool_call",
        &json!({"toolCallId": "tool-9", "title": "Read file", "kind": "read", "status": "pending", "rawInput": {"path": "x"}}),
        &mut outcome,
    );
    let Some(TaskRuntimeEvent::Tool {
        call_id,
        phase,
        status,
        detail,
        ..
    }) = call
    else {
        panic!("a tool call must map to a tool event");
    };
    assert_eq!(
        (call_id.as_deref(), phase, status.as_deref()),
        (Some("tool-9"), ToolPhase::Request, Some("running"))
    );
    assert!(!detail.contains("rawInput"));
}

/// A data root with a project, a handed-off CLI-agent task and its grant.
struct Setup {
    data: tempfile::TempDir,
    workspace: PathBuf,
    home: PathBuf,
    log_file: PathBuf,
    task_id: String,
    generation: u64,
    commands: CommandPolicy,
    fixture: PathBuf,
}

fn setup(commands: CommandPolicy) -> Setup {
    let data = tempfile::tempdir().unwrap();
    let workspace = data.path().join("workspace");
    std::fs::create_dir_all(&workspace).unwrap();
    let workspace = dunce::canonicalize(&workspace).unwrap();
    let home = data
        .path()
        .join("research-tasks")
        .join("workspaces")
        .join("t")
        .join("acp-home-1");
    std::fs::create_dir_all(&home).unwrap();
    let fixtures = data.path().join("bin");
    std::fs::create_dir_all(&fixtures).unwrap();
    let fixture =
        crate::support::rust_fixture(&fixtures, "acp_agent.rs", "acp-agent-fixture", None);
    let tasks_root = data.path().join("research-tasks");
    let app = TaskStore::new(tasks_root).unwrap();
    let mut brief = ResearchBrief::default();
    brief.permissions.commands = commands;
    let draft = ResearchTaskDraft {
        project_id: "paper".into(),
        title: "Survey".into(),
        prompt: "Survey the field".into(),
        runtime_id: "acp".into(),
        agent_id: "claude".into(),
        model_id: "default".into(),
        keep_running_after_quit: true,
        brief: Some(brief),
        ..Default::default()
    };
    let task = app.create(draft).unwrap();
    app.request_start(&task.id).unwrap();
    let running = app.claim_next().unwrap().unwrap();
    let mut record = HandoffRecord::new(
        OwnerKind::App,
        OwnerKind::Daemon,
        HandoffReason::Quit,
        running.execution_generation,
    );
    record.grant = Some(TaskGrant {
        project_root: workspace.to_string_lossy().into_owned(),
        capabilities: vec![
            TRUST_RESEARCH_TASKS.into(),
            TRUST_AGENTS.into(),
            TRUST_MCP.into(),
        ],
        acp: Some(AcpGrant {
            agent_id: "claude".into(),
            launch: AcpLaunch {
                sandbox: oleafly_sandbox::SandboxSpec {
                    workspace: workspace.clone(),
                    home: home.clone(),
                    ..oleafly_sandbox::SandboxSpec::default()
                },
                program: fixture.clone(),
                args: Vec::new(),
            },
            refused_kinds: Vec::new(),
            refuse_unlisted: false,
        }),
        ..TaskGrant::default()
    });
    assert!(app
        .hand_off_with(
            &running.id,
            running.execution_generation,
            OwnerKind::Daemon,
            &record
        )
        .unwrap());
    // The helper claims it: the next generation runs.
    let helper =
        TaskStore::with_owner_kind(data.path().join("research-tasks"), OwnerKind::Daemon).unwrap();
    let claimed = helper.claim_next().unwrap().unwrap();
    assert_eq!(claimed.id, running.id);
    Setup {
        log_file: data.path().join("agent.log"),
        workspace,
        home,
        task_id: running.id,
        generation: claimed.execution_generation,
        commands,
        fixture,
        data,
    }
}

/// The fixture without a sandbox, with `env` and `HOME` set to the home.
fn fixture_launcher(setup: &Setup, env: Vec<(&'static str, String)>) -> AcpLauncher {
    let program = setup.fixture.clone();
    let log = setup.log_file.clone();
    Arc::new(move |launch: &AcpLaunch| {
        let mut command = tokio::process::Command::new(&program);
        command
            .env("HOME", &launch.sandbox.home)
            .env("FIXTURE_LOG", &log);
        for (name, value) in &env {
            command.env(name, value);
        }
        command.current_dir(&launch.sandbox.workspace);
        Ok(command)
    })
}

fn adapter(setup: &Setup, launcher: AcpLauncher) -> (ResearchTaskState, DaemonAcpAdapter) {
    let log = Arc::new(HelperLog::open(
        &setup.data.path().join("helper.log"),
        Vec::new(),
        false,
    ));
    let live = Arc::new(LiveSpend::default());
    let state = ResearchTaskState::new(Ok(setup.data.path().join("research-tasks")), 1);
    state.attach(
        Arc::new(DaemonResearchHost::new(
            setup.data.path(),
            None,
            Prefs::default(),
            Arc::new(Notifier::new(false, None, None)),
            log.clone(),
            live.clone(),
        )),
        tokio::runtime::Handle::current(),
    );
    let host = Arc::new(DaemonTaskHost::new(setup.data.path(), None, log, live));
    let adapter = DaemonAcpAdapter::new(
        setup.data.path().join("acp"),
        host,
        state.services().unwrap(),
        launcher,
    )
    .unwrap();
    (state, adapter)
}

fn context(
    setup: &Setup,
    handoff: Option<HandoffResume>,
    resume: Option<ResumeContext>,
) -> TaskRunContext {
    let mut brief = ResearchBrief::default();
    brief.permissions.commands = setup.commands;
    TaskRunContext {
        task_id: setup.task_id.clone(),
        execution_generation: setup.generation,
        brief,
        session_id: format!("session-{}", setup.task_id),
        project_id: "paper".into(),
        execution_root: setup.workspace.to_string_lossy().into_owned(),
        title: "Survey".into(),
        prompt: "Survey the field".into(),
        runtime_id: "acp".into(),
        agent_id: "claude".into(),
        model_id: "default".into(),
        record_dir: "research/survey".into(),
        // A real task always has paths it may write (at least its output
        // folders); the sandbox spec refuses a task without any.
        allowed_paths: vec!["research".into()],
        handoff,
        resume,
        ..TaskRunContext::default()
    }
}

fn handoff(setup: &Setup, turn_interrupted: bool) -> HandoffResume {
    HandoffResume {
        from_generation: 1,
        conversation: None,
        turn_interrupted,
        acp: Some(AcpHandoff {
            agent_session_id: "agent-session-old".into(),
            home: setup.home.clone(),
        }),
    }
}

fn logged(setup: &Setup) -> Vec<String> {
    std::fs::read_to_string(&setup.log_file)
        .unwrap_or_default()
        .lines()
        .map(str::to_owned)
        .collect()
}

fn sink() -> (TaskEventSink, Arc<Mutex<Vec<TaskRuntimeEvent>>>) {
    let events = Arc::new(Mutex::new(Vec::new()));
    let recorded = events.clone();
    (
        Arc::new(move |event| recorded.lock().unwrap().push(event)),
        events,
    )
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn resume_prefers_session_resume_then_load_then_a_new_session() {
    for (caps, expected) in [
        ("resume,load", "session/resume"),
        ("load", "session/load"),
        ("", "session/new"),
    ] {
        let setup = setup(CommandPolicy::Allow);
        let launcher = fixture_launcher(&setup, vec![("FIXTURE_CAPS", caps.to_string())]);
        let (_state, adapter) = adapter(&setup, launcher);
        let (events, recorded) = sink();
        let outcome = adapter
            .run(
                context(&setup, Some(handoff(&setup, false)), None),
                CancellationToken::new(),
                events,
            )
            .await
            .unwrap();
        let methods: Vec<String> = logged(&setup)
            .into_iter()
            .filter(|line| line.starts_with("method session/"))
            .collect();
        assert_eq!(
            methods.first().map(String::as_str),
            Some(format!("method {expected}").as_str()),
            "{caps}: {methods:?}"
        );
        assert!(
            outcome.summary.contains("done"),
            "{caps}: {}",
            outcome.summary
        );
        let recorded = recorded.lock().unwrap();
        assert!(!recorded.iter().any(
            |event| matches!(event, TaskRuntimeEvent::Text { text } if text.contains("replayed"))
        ));
        if expected == "session/new" {
            assert!(recorded.iter().any(|event| matches!(event, TaskRuntimeEvent::Status { message } if message == RESUME_FAILED)));
        } else {
            assert!(recorded.iter().any(|event| matches!(event, TaskRuntimeEvent::SessionBound { native_session_id } if native_session_id == "agent-session-old")));
        }
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn an_interrupted_turn_resumes_with_a_continuation_prompt() {
    let setup = setup(CommandPolicy::Allow);
    let launcher = fixture_launcher(&setup, vec![("FIXTURE_CAPS", "resume".into())]);
    let (_state, adapter) = adapter(&setup, launcher);
    let resume = ResumeContext {
        reason: ResumeReason::Handoff,
        handoff: "Halfway through the reading list.".into(),
        plan: String::new(),
        ledger_tail: String::new(),
        previous_native_session_id: None,
    };
    let (events, _) = sink();
    adapter
        .run(
            context(&setup, Some(handoff(&setup, true)), Some(resume)),
            CancellationToken::new(),
            events,
        )
        .await
        .unwrap();
    let prompt = logged(&setup)
        .into_iter()
        .find(|line| line.starts_with("prompt "))
        .unwrap();
    assert!(
        prompt.starts_with("prompt Your previous turn was interrupted."),
        "{prompt}"
    );
    assert!(prompt.contains("handoff.md"));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn ask_first_permissions_wait_for_the_shared_approval_queue() {
    let setup = setup(CommandPolicy::Ask);
    let launcher = fixture_launcher(&setup, vec![("FIXTURE_ASK", "1".into())]);
    let (state, adapter) = adapter(&setup, launcher);
    let (events, _) = sink();
    let run = tokio::spawn({
        let adapter = adapter.clone();
        let context = context(&setup, None, None);
        async move { adapter.run(context, CancellationToken::new(), events).await }
    });
    let services = state.services().unwrap();
    let approval = tokio::time::timeout(Duration::from_secs(20), async {
        loop {
            if let Some(pending) = services
                .approvals
                .pending("paper")
                .unwrap()
                .into_iter()
                .next()
            {
                return pending;
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
    })
    .await
    .expect("the command must wait for an approval");
    services.approvals.decide(&approval.id, true).unwrap();
    let outcome = tokio::time::timeout(Duration::from_secs(20), run)
        .await
        .unwrap()
        .unwrap()
        .unwrap();
    assert!(outcome.summary.contains("done"), "{}", outcome.summary);
    let answer = logged(&setup)
        .into_iter()
        .find(|line| line.starts_with("permission "))
        .unwrap();
    assert!(answer.contains("\"optionId\":\"allow\""), "{answer}");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn agent_children_are_registered_with_the_helper_identity() {
    let setup = setup(CommandPolicy::Allow);
    let launcher = fixture_launcher(&setup, vec![("FIXTURE_SLOW", "1".into())]);
    let (_state, adapter) = adapter(&setup, launcher);
    let (events, _) = sink();
    let cancel = CancellationToken::new();
    let run = tokio::spawn({
        let adapter = adapter.clone();
        let context = context(&setup, None, None);
        let cancel = cancel.clone();
        async move { adapter.run(context, cancel, events).await }
    });
    let pids = setup.data.path().join("acp").join("agents.pids");
    let line = tokio::time::timeout(Duration::from_secs(20), async {
        loop {
            if let Some(line) = std::fs::read_to_string(&pids)
                .ok()
                .and_then(|text| text.lines().next().map(str::to_owned))
            {
                return line;
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
    })
    .await
    .expect("the agent must be listed while it runs");
    let entry: serde_json::Value = serde_json::from_str(&line).unwrap();
    assert_eq!(entry["owner"]["kind"], "daemon");
    assert_eq!(entry["owner"]["identity"]["pid"], std::process::id());
    cancel.cancel();
    let result = tokio::time::timeout(Duration::from_secs(20), run)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(result.unwrap_err(), CANCELLED);
    assert!(std::fs::read_to_string(&pids)
        .unwrap_or_default()
        .trim()
        .is_empty());
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
#[test]
fn the_default_launcher_rebuilds_the_sandboxed_command() {
    if !matches!(
        oleafly_sandbox::availability(),
        oleafly_sandbox::Availability::Available
    ) {
        return;
    }
    let root = tempfile::tempdir().unwrap();
    let workspace = root.path().join("workspace");
    let home = root.path().join("home");
    std::fs::create_dir_all(&workspace).unwrap();
    std::fs::create_dir_all(&home).unwrap();
    let launch = AcpLaunch {
        sandbox: oleafly_sandbox::SandboxSpec {
            workspace: dunce::canonicalize(&workspace).unwrap(),
            home: dunce::canonicalize(&home).unwrap(),
            ..oleafly_sandbox::SandboxSpec::default()
        },
        program: PathBuf::from("/bin/sh"),
        args: vec!["-c".into(), "true".into()],
    };
    let command = default_launcher()(&launch).unwrap();
    let env: Vec<(String, Option<String>)> = command
        .as_std()
        .get_envs()
        .map(|(name, value)| {
            (
                name.to_string_lossy().into_owned(),
                value.map(|value| value.to_string_lossy().into_owned()),
            )
        })
        .collect();
    let value = |name: &str| {
        env.iter()
            .find(|(key, _)| key == name)
            .and_then(|(_, value)| value.clone())
    };
    assert_eq!(
        value("HOME").map(PathBuf::from),
        Some(launch.sandbox.home.clone())
    );
    assert!(value("OPENAI_API_KEY").is_none());
    assert!(Path::new(&launch.sandbox.workspace).is_dir());
}
