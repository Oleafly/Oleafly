use std::path::Path;

use oleafly_research::handoff::{HandoffReason, HandoffRecord};
use oleafly_research::model::ResearchTaskDraft;
use oleafly_research::store::TaskStore;
use serde_json::json;

use super::*;

struct Fixture {
    data: tempfile::TempDir,
    project: tempfile::TempDir,
}

impl Fixture {
    fn new() -> Self {
        Self {
            data: tempfile::tempdir().unwrap(),
            project: tempfile::tempdir().unwrap(),
        }
    }

    fn tasks_root(&self) -> PathBuf {
        self.data.path().join("research-tasks")
    }

    fn grant(&self, capabilities: &[&str]) -> TaskGrant {
        TaskGrant {
            project_root: self.project.path().to_string_lossy().into_owned(),
            linked: false,
            capabilities: capabilities
                .iter()
                .map(|code| (*code).to_string())
                .collect(),
            spent_usd: Some(1.0),
            model_metadata: Some(
                json!({"cost": {"input": 3.0, "output": 15.0}, "limit": {"context": 200000}}),
            ),
            ..TaskGrant::default()
        }
    }

    /// A task handed to the helper with `grant`; returns its id.
    fn handed_off(&self, grant: TaskGrant) -> String {
        let app = TaskStore::new(self.tasks_root()).unwrap();
        let task = app
            .create(ResearchTaskDraft {
                project_id: "paper".into(),
                title: "Survey".into(),
                prompt: "Survey the field".into(),
                runtime_id: "builtin".into(),
                agent_id: "openai".into(),
                model_id: "gpt-6.1-sol".into(),
                keep_running_after_quit: true,
                ..Default::default()
            })
            .unwrap();
        app.request_start(&task.id).unwrap();
        let running = app.claim_next().unwrap().unwrap();
        let mut record = HandoffRecord::new(
            OwnerKind::App,
            OwnerKind::Daemon,
            HandoffReason::Quit,
            running.execution_generation,
        );
        record.grant = Some(grant);
        assert!(app
            .hand_off_with(
                &running.id,
                running.execution_generation,
                OwnerKind::Daemon,
                &record
            )
            .unwrap());
        running.id
    }

    fn host(&self) -> DaemonResearchHost {
        let log = Arc::new(HelperLog::open(
            &self.data.path().join("helper.log"),
            Vec::new(),
            false,
        ));
        DaemonResearchHost::new(
            self.data.path(),
            None,
            Prefs::default(),
            Arc::new(Notifier::new(false, None, None)),
            log,
            Arc::new(LiveSpend::default()),
        )
    }

    fn task_host(&self) -> DaemonTaskHost {
        let log = Arc::new(HelperLog::open(
            &self.data.path().join("helper.log"),
            Vec::new(),
            false,
        ));
        DaemonTaskHost::new(self.data.path(), None, log, Arc::new(LiveSpend::default()))
    }
}

#[test]
fn trust_comes_only_from_the_grant() {
    let fixture = Fixture::new();
    fixture.handed_off(fixture.grant(&[TRUST_RESEARCH_TASKS]));
    let host = fixture.host();
    assert!(host.require_trusted("paper").is_ok());
    assert!(host.require_trusted("other").is_err());
    assert!(host.admit_project("paper").is_ok());

    let untrusted = Fixture::new();
    untrusted.handed_off(untrusted.grant(&[]));
    let error = untrusted.host().require_trusted("paper").unwrap_err();
    assert!(error.contains("trust.research_tasks"));
}

#[test]
fn a_project_that_moved_since_the_handoff_is_refused() {
    let fixture = Fixture::new();
    let mut grant = fixture.grant(&[TRUST_RESEARCH_TASKS]);
    grant.project_root = fixture
        .project
        .path()
        .join("moved-away")
        .to_string_lossy()
        .into_owned();
    fixture.handed_off(grant);
    let host = fixture.host();
    assert_eq!(host.locate_project("paper").unwrap_err(), PROJECT_MOVED);
    assert!(!host.project_present("paper"));
    assert!(host.admit_project("paper").is_err());
}

#[test]
fn a_linked_root_that_moved_is_refused() {
    let fixture = Fixture::new();
    let linked = tempfile::tempdir().unwrap();
    let real = dunce::canonicalize(linked.path()).unwrap();
    let mut grant = fixture.grant(&[TRUST_RESEARCH_TASKS]);
    grant.linked_roots = vec![
        GrantedRoot {
            id: "data".into(),
            label: "Data".into(),
            role: "data".into(),
            canonical_path: real.to_string_lossy().into_owned(),
        },
        GrantedRoot {
            id: "gone".into(),
            label: "Gone".into(),
            role: "data".into(),
            canonical_path: real.join("missing").to_string_lossy().into_owned(),
        },
    ];
    let roots = GrantLinkedRoots::new(&grant);
    assert_eq!(roots.resolve("paper", "data").unwrap(), real);
    assert_eq!(roots.resolve("paper", "gone").unwrap_err(), LINKED_MOVED);
    assert!(roots.resolve("paper", "other").is_err());
}

#[test]
fn the_worktree_lock_is_the_one_the_app_uses() {
    let data = tempfile::tempdir().unwrap();
    let first = shared_worktree_lock(data.path(), "paper").unwrap();
    assert!(first.is_some());
    assert!(data
        .path()
        .join("project-worktree-locks")
        .join("paper.lock")
        .is_file());
    let second = shared_worktree_lock(data.path(), "paper").unwrap();
    assert!(second.is_some(), "a second shared hold must succeed");
    let file = std::fs::OpenOptions::new()
        .read(true)
        .write(true)
        .open(
            data.path()
                .join("project-worktree-locks")
                .join("paper.lock"),
        )
        .unwrap();
    assert!(matches!(
        fs4::FileExt::try_lock(&file),
        Err(fs4::TryLockError::WouldBlock)
    ));
    drop((first, second));
    assert!(fs4::FileExt::try_lock(&file).is_ok());
    assert!(shared_worktree_lock(data.path(), "paper")
        .unwrap()
        .is_none());
}

fn spool_event(task: &str, cost: f64, at: i64) -> UsageSpoolEvent {
    UsageSpoolEvent {
        id: usage_spool::event_id("daemon"),
        source: "daemon".into(),
        task_id: Some(task.into()),
        project_id: Some("paper".into()),
        project_path: None,
        provider: "openai".into(),
        model: "gpt-6.1-sol".into(),
        input_tokens: Some(1),
        output_tokens: Some(1),
        cache_read_tokens: None,
        cache_write_tokens: None,
        cost_usd: Some(cost),
        status: "completed".into(),
        at,
    }
}

#[test]
fn spend_adds_the_spool_to_the_granted_amount() {
    let fixture = Fixture::new();
    let task = fixture.handed_off(fixture.grant(&[TRUST_RESEARCH_TASKS]));
    let store = daemon_store(&fixture.tasks_root()).unwrap();
    let handoff_at = store.handoff_record(&task).unwrap().unwrap().created_at;
    usage_spool::append(
        fixture.data.path(),
        &spool_event(&task, 0.25, handoff_at + 1),
    )
    .unwrap();
    usage_spool::append(
        fixture.data.path(),
        &spool_event(&task, 9.0, handoff_at - 1),
    )
    .unwrap();
    usage_spool::append(
        fixture.data.path(),
        &spool_event("other", 5.0, handoff_at + 1),
    )
    .unwrap();
    assert_eq!(fixture.host().task_spend_usd(&task), Some(1.25));
}

#[test]
fn spooled_usage_carries_cost_from_the_model_entry() {
    let data = tempfile::tempdir().unwrap();
    let log = Arc::new(HelperLog::open(
        &data.path().join("helper.log"),
        Vec::new(),
        false,
    ));
    let live = Arc::new(LiveSpend::default());
    let price = Price::from_entry(&json!({"cost": {"input": 3.0, "output": 15.0}}));
    let sink = SpoolUsage::new(
        data.path(),
        "t1",
        "paper",
        "anthropic",
        "claude-fable-5",
        price,
        live.clone(),
        log,
    );
    let usage = |input, output| {
        AgentEvent::usage(Usage {
            input,
            output,
            ..Usage::default()
        })
    };
    sink.observe(&usage(1_000_000, 0));
    assert!((live.get("t1") - 3.0).abs() < 1e-9);
    // A second turn starts its totals again.
    sink.observe(&usage(0, 100_000));
    sink.finish("completed");
    sink.finish("completed");
    let events = usage_spool::read_since(data.path(), "t1", 0).unwrap();
    assert_eq!(events.len(), 1);
    assert_eq!(
        (events[0].input_tokens, events[0].output_tokens),
        (Some(1_000_000), Some(100_000))
    );
    assert!((events[0].cost_usd.unwrap() - 4.5).abs() < 1e-9);
    assert_eq!(events[0].source, "daemon");
    assert_eq!(live.get("t1"), 0.0);
}

#[tokio::test]
async fn the_provider_ignores_environment_keys() {
    let fixture = Fixture::new();
    let task = fixture.handed_off(fixture.grant(&[TRUST_RESEARCH_TASKS]));
    std::fs::write(
        fixture.data.path().join("config.json"),
        r#"{"ai_provider":"openai","ai_model":"gpt-6.1-sol"}"#,
    )
    .unwrap();
    let _environment = crate::agent::tools::test_support::Environment::set(&[(
        "OPENAI_API_KEY",
        Some(std::ffi::OsStr::new("sk-from-the-environment")),
    )])
    .await;
    let context = TaskRunContext {
        task_id: task,
        project_id: "paper".into(),
        agent_id: "openai".into(),
        model_id: "gpt-6.1-sol".into(),
        ..TaskRunContext::default()
    };
    let error = match fixture.task_host().provider(context).await {
        Ok(_) => panic!("a key in the environment must not be used"),
        Err(error) => error,
    };
    assert!(error.contains("no API key"), "{error}");
    assert!(!error.contains("sk-from-the-environment"));
}

#[test]
fn task_mcp_servers_are_listed_in_acp_shape() {
    let fixture = Fixture::new();
    let task = fixture.handed_off(fixture.grant(&[TRUST_RESEARCH_TASKS, TRUST_MCP]));
    std::fs::write(
        fixture.data.path().join("config.json"),
        r#"{"mcp_servers":[{"name":"zotero","transport":"stdio","command":"zotero-mcp","args":["--read"],"env":{"TOKEN":"abc123456"}},{"name":"web","transport":"remote","url":"https://example.com/mcp","headers":{}}],"research_task_mcp_servers":["zotero"]}"#,
    )
    .unwrap();
    let context = TaskRunContext {
        task_id: task,
        project_id: "paper".into(),
        ..TaskRunContext::default()
    };
    let servers = fixture.task_host().task_mcp_servers(&context);
    assert_eq!(servers.len(), 1);
    assert_eq!(servers[0]["name"], "zotero");
    assert_eq!(servers[0]["args"][0], "--read");
    assert_eq!(
        servers[0]["env"][0],
        json!({"name": "TOKEN", "value": "abc123456"})
    );
}

#[tokio::test]
async fn web_search_without_a_key_says_how_to_add_one() {
    let data = tempfile::tempdir().unwrap();
    let web = CliWebTools::new(data.path()).unwrap();
    assert_eq!(
        web.search("graph neural networks").await.unwrap_err(),
        NO_SEARCH_KEY
    );
}

#[test]
fn run_supervisors_start_from_the_appimage_itself() {
    let image = tempfile::NamedTempFile::new().unwrap();
    let command = supervisor_command_for(
        Some(image.path().to_path_buf()),
        Some(PathBuf::from("/tmp/.mount_x/usr/bin/oleafly")),
    )
    .unwrap();
    assert_eq!(command.program, image.path());
    assert_eq!(
        command.args,
        vec![std::ffi::OsString::from(SUPERVISOR_FLAG)]
    );
    let plain = supervisor_command_for(None, Some(PathBuf::from("/usr/bin/oleafly"))).unwrap();
    assert_eq!(plain.program, Path::new("/usr/bin/oleafly"));
    let missing = supervisor_command_for(
        Some(PathBuf::from("/no/such.AppImage")),
        Some(PathBuf::from("/usr/bin/oleafly")),
    )
    .unwrap();
    assert_eq!(missing.program, Path::new("/usr/bin/oleafly"));
}

#[test]
fn a_recovered_record_keeps_the_grant() {
    let fixture = Fixture::new();
    let task = fixture.handed_off(fixture.grant(&[TRUST_RESEARCH_TASKS]));
    // The helper claims it, then dies without handing it back.
    let crashed = TaskStore::with_owner_kind(fixture.tasks_root(), OwnerKind::Daemon).unwrap();
    let claimed = crashed.claim_next().unwrap().unwrap();
    assert_eq!(claimed.id, task);
    crashed
        .set_owner(
            &task,
            Some(oleafly_sandbox::process::identity::ProcessIdentity {
                pid: u32::MAX - 9,
                started: Some(3),
            }),
        )
        .unwrap();
    let next = daemon_store(&fixture.tasks_root()).unwrap();
    assert_eq!(
        next.requeue_interrupted_keep_running().unwrap(),
        std::slice::from_ref(&task)
    );
    let grant = grant_for(&next, &task).unwrap();
    assert!(grant.allows(TRUST_RESEARCH_TASKS));
    assert_eq!(
        next.handoff_record(&task).unwrap().unwrap().reason,
        HandoffReason::Recovered
    );
}

#[test]
fn skills_turned_off_in_the_grant_are_reported() {
    let fixture = Fixture::new();
    let skill = fixture.data.path().join("skills").join("lit-review");
    std::fs::create_dir_all(&skill).unwrap();
    std::fs::write(
        skill.join("SKILL.md"),
        "---\nname: Lit review\n---\nSteps.\n",
    )
    .unwrap();
    let mut grant = fixture.grant(&[TRUST_RESEARCH_TASKS]);
    grant.disabled_skills = vec!["lit-review".into()];
    fixture.handed_off(grant);
    let message = fixture
        .host()
        .unavailable_skill("paper", &["lit-review".into()])
        .unwrap()
        .unwrap();
    assert!(message.contains("turned off"));
    assert!(fixture
        .host()
        .unavailable_skill("paper", &[])
        .unwrap()
        .is_none());
}
