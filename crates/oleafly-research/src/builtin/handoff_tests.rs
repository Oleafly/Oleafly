//! 0.4.8 L: a built-in task that moves to another process continues the
//! same conversation, waits for its runs again, or falls back to the
//! research record when its conversation cannot be restored.
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde_json::{json, Value};
use tokio::sync::Notify;

use super::*;
use crate::approvals::APPROVAL_WITHDRAWN;
use crate::handoff::{HandoffReason, HandoffRecord};
use crate::host::OwnerKind;
use crate::model::{
    CommandPolicy, ResearchBrief, ResearchTask, ResearchTaskDraft, ResearchTaskStatus,
};
use crate::scheduler::{handoff_record_for, ResearchTaskState, SuspendMode, SuspendResult};
use crate::test_support::{FakeEnv, FakeHost, CHILD_PATIENCE};

#[derive(Clone)]
enum Reply {
    ReadMain,
    RunCommand,
    Text(&'static str),
}

/// An OpenAI-compatible provider that answers each request with the next
/// scripted reply. With `hold_first`, the first reply waits for `release`.
struct Provider {
    url: String,
    requests: Arc<Mutex<Vec<Value>>>,
    release: Arc<Notify>,
    server: tokio::task::JoinHandle<()>,
}

impl Provider {
    async fn start(replies: Vec<Reply>, hold_first: bool) -> Self {
        use axum::{response::IntoResponse, routing::post, Json, Router};
        let requests = Arc::new(Mutex::new(Vec::<Value>::new()));
        let release = Arc::new(Notify::new());
        let observed = requests.clone();
        let held = release.clone();
        let replies = Arc::new(replies);
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let router = Router::new().route(
            "/v1/chat/completions",
            post(move |Json(request): Json<Value>| {
                let step = {
                    let mut requests = lock(&observed);
                    requests.push(request);
                    requests.len() - 1
                };
                let (held, replies) = (held.clone(), replies.clone());
                async move {
                    if hold_first && step == 0 {
                        held.notified().await;
                    }
                    let delta = match replies.get(step).cloned().unwrap_or(Reply::Text("done")) {
                        Reply::ReadMain => json!({"tool_calls": [{"index": 0, "id": "call-1", "type": "function",
                            "function": {"name": "read_file", "arguments": "{\"path\":\"main.tex\"}"}}]}),
                        Reply::RunCommand => json!({"tool_calls": [{"index": 0, "id": "call-1", "type": "function",
                            "function": {"name": "run_command", "arguments": "{\"command\":\"echo hi\"}"}}]}),
                        Reply::Text(text) => json!({"content": text}),
                    };
                    let finish = if delta.get("tool_calls").is_some() { "tool_calls" } else { "stop" };
                    let body = format!(
                        "data: {}\n\ndata: {}\n\ndata: [DONE]\n\n",
                        json!({"choices": [{"delta": delta}]}),
                        json!({"choices": [{"delta": {}, "finish_reason": finish}],
                               "usage": {"prompt_tokens": 10, "completion_tokens": 2}}),
                    );
                    ([("content-type", "text/event-stream")], body).into_response()
                }
            }),
        );
        let server = tokio::spawn(async move {
            let _ = axum::serve(listener, router).await;
        });
        Self {
            url: format!("http://{address}/v1"),
            requests,
            release,
            server,
        }
    }

    fn count(&self) -> usize {
        lock(&self.requests).len()
    }
}

impl Drop for Provider {
    fn drop(&mut self) {
        self.server.abort();
    }
}

struct NoUsage;

impl UsageSink for NoUsage {
    fn observe(&self, _event: &AgentEvent) {}
    fn finish(&self, _status: &str) {}
}

struct NullBridge;

impl TaskBridge for NullBridge {
    fn mcp_server(&self) -> Value {
        json!({"type": "http", "name": "null", "url": "http://127.0.0.1:9/mcp", "headers": []})
    }

    fn call_tool(self: Arc<Self>, _name: String, _args: Value) -> TaskRuntimeFuture<Value> {
        Box::pin(async { Err("This test has no bridge tools.".to_string()) })
    }

    fn shutdown(self: Arc<Self>) -> Pin<Box<dyn Future<Output = ()> + Send>> {
        Box::pin(async {})
    }

    fn tool_definitions(&self) -> Vec<crate::mcp::protocol::ToolMeta> {
        Vec::new()
    }
}

struct Host {
    provider_url: String,
}

impl TaskHost for Host {
    fn skills(&self, _context: &TaskRunContext) -> Result<String, String> {
        Ok(String::new())
    }

    fn skill_read_paths(&self, _context: &TaskRunContext) -> Vec<PathBuf> {
        Vec::new()
    }

    fn provider(&self, context: TaskRunContext) -> TaskRuntimeFuture<TaskProvider> {
        let base_url = self.provider_url.clone();
        Box::pin(async move {
            Ok(TaskProvider {
                client: reqwest::Client::builder()
                    .no_proxy()
                    .build()
                    .map_err(|error| error.to_string())?,
                resolved: oleafly_agent::Resolved {
                    provider_id: context.agent_id,
                    model_id: context.model_id,
                    credential: String::new(),
                    auth: None,
                    wire: oleafly_agent::Wire::OpenAiChat {
                        base_url,
                        reasoning_content: false,
                    },
                    caps: oleafly_agent::ModelCaps::default(),
                },
                usage: Box::new(NoUsage),
            })
        })
    }

    fn bridge(
        &self,
        _context: TaskRunContext,
        _binding: Option<TaskBinding>,
    ) -> TaskRuntimeFuture<Arc<dyn TaskBridge>> {
        Box::pin(async { Ok(Arc::new(NullBridge) as Arc<dyn TaskBridge>) })
    }
}

struct Setup {
    data: tempfile::TempDir,
    host: FakeHost,
    project: PathBuf,
}

fn setup() -> Setup {
    let data = tempfile::tempdir().unwrap();
    let project = data.path().join("projects").join("paper");
    std::fs::create_dir_all(&project).unwrap();
    std::fs::write(project.join("main.tex"), "original manuscript").unwrap();
    let host = FakeHost::new(FakeEnv::new().with_project("paper", &project).without_git());
    Setup {
        data,
        host,
        project,
    }
}

/// A queue running as `owner` over the shared task store.
fn queue(setup: &Setup, owner: OwnerKind, provider: &Provider) -> ResearchTaskState {
    let mut host = setup.host.clone();
    host.owner = owner;
    let state = ResearchTaskState::for_test(setup.data.path().join("tasks"), 2);
    state.attach(Arc::new(host), tokio::runtime::Handle::current());
    let services = state.services().unwrap();
    let adapter = BuiltinTaskAdapter::new(
        Arc::new(Host {
            provider_url: provider.url.clone(),
        }),
        services,
    );
    state
        .register_runtime("builtin", Arc::new(adapter))
        .unwrap();
    state
}

fn task_draft(brief: Option<ResearchBrief>) -> ResearchTaskDraft {
    ResearchTaskDraft {
        project_id: "paper".into(),
        title: "Overnight".into(),
        prompt: "Read main.tex and report.".into(),
        runtime_id: "builtin".into(),
        agent_id: "fixture".into(),
        model_id: "fixture-model".into(),
        keep_running_after_quit: true,
        brief,
        ..Default::default()
    }
}

async fn wait_for(mut ready: impl FnMut() -> bool) {
    tokio::time::timeout(CHILD_PATIENCE, async {
        while !ready() {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("the task did not reach the expected point");
}

async fn wait_for_status(
    state: &ResearchTaskState,
    id: &str,
    status: ResearchTaskStatus,
) -> ResearchTask {
    let store = state.store().unwrap();
    wait_for(|| store.require(id).is_ok_and(|task| task.status == status)).await;
    store.require(id).unwrap()
}

/// Starts the task in `app` and suspends it after its first tool call.
async fn run_until_suspended(
    app: &ResearchTaskState,
    provider: &Provider,
    task: &ResearchTask,
) -> (u64, HandoffRecord) {
    app.launch_ready().await.unwrap();
    wait_for(|| provider.count() == 1).await;
    let suspending = {
        let app = app.clone();
        let id = task.id.clone();
        tokio::spawn(async move {
            app.suspend(&[id], SuspendMode::Prompt, Some(Duration::from_secs(20)))
                .await
        })
    };
    let services = app.services().unwrap();
    wait_for(|| services.suspends.requested(&task.id)).await;
    provider.release.notify_one();
    let results = suspending.await.unwrap();
    assert!(
        matches!(results[0].1, SuspendResult::Suspended { .. }),
        "{results:?}"
    );
    handoff_record_for(
        &results[0].1,
        OwnerKind::App,
        OwnerKind::Daemon,
        HandoffReason::Quit,
    )
    .unwrap()
}

#[tokio::test]
async fn a_handed_off_builtin_task_continues_the_same_conversation() {
    let setup = setup();
    let provider = Provider::start(vec![Reply::ReadMain, Reply::Text("done")], true).await;
    let app = queue(&setup, OwnerKind::App, &provider);
    let store = app.store().unwrap();
    let task = store.create(task_draft(None)).unwrap();
    store.request_start(&task.id).unwrap();
    let (generation, record) = run_until_suspended(&app, &provider, &task).await;
    assert!(record.conversation.is_some());
    assert!(app
        .hand_off_suspended(&task.id, generation, OwnerKind::Daemon, record)
        .await
        .unwrap());

    let helper = queue(&setup, OwnerKind::Daemon, &provider);
    helper.launch_ready().await.unwrap();
    let finished = wait_for_status(&helper, &task.id, ResearchTaskStatus::AwaitingReview).await;
    assert_eq!(finished.result.unwrap().summary, "done");
    assert_eq!(finished.resumed_from, Some(generation));
    let requests = lock(&provider.requests).clone();
    assert_eq!(requests.len(), 2);
    let continued = requests[1]["messages"].to_string();
    assert!(continued.contains("original manuscript"), "{continued}");
    assert!(!continued.contains("You are resuming"), "{continued}");
    // A finished task keeps no snapshot.
    assert!(!crate::conversation::conversation_path(store.root(), &task.id, generation).exists());
    app.shutdown().await;
    helper.shutdown().await;
}

#[tokio::test]
async fn a_resume_whose_snapshot_cannot_load_uses_the_record_based_message() {
    let setup = setup();
    let provider = Provider::start(vec![Reply::ReadMain, Reply::Text("done")], true).await;
    let app = queue(&setup, OwnerKind::App, &provider);
    let store = app.store().unwrap();
    let task = store.create(task_draft(None)).unwrap();
    store.request_start(&task.id).unwrap();
    let (generation, record) = run_until_suspended(&app, &provider, &task).await;
    assert!(app
        .hand_off_suspended(&task.id, generation, OwnerKind::Daemon, record)
        .await
        .unwrap());
    std::fs::remove_file(crate::conversation::conversation_path(
        store.root(),
        &task.id,
        generation,
    ))
    .unwrap();

    let helper = queue(&setup, OwnerKind::Daemon, &provider);
    helper.launch_ready().await.unwrap();
    let finished = wait_for_status(&helper, &task.id, ResearchTaskStatus::AwaitingReview).await;
    let resumed = lock(&provider.requests)[1]["messages"].to_string();
    assert!(resumed.contains("You are resuming this task"), "{resumed}");
    let events = helper
        .events(&task.id, finished.execution_generation, None, 200)
        .unwrap()
        .events;
    assert!(events.iter().any(|event| matches!(
        &event.event,
        TaskRuntimeEvent::Status { message } if message.contains("could not be restored")
    )));
    app.shutdown().await;
    helper.shutdown().await;
}

fn workspace_for(
    store: &crate::store::TaskStore,
    task: &ResearchTask,
    project: &Path,
) -> crate::model::TaskIsolation {
    let root = crate::isolation::task_workspace_root(store.root(), &task.id)
        .join(task.execution_generation.to_string());
    crate::isolation::prepare_at(
        project,
        &root,
        crate::isolation::IsolationSource::Snapshot,
        None,
        &CancellationToken::new(),
    )
    .unwrap()
}

#[tokio::test]
async fn a_task_waiting_for_runs_resumes_by_waiting_not_by_calling_the_model() {
    let setup = setup();
    let provider = Provider::start(Vec::new(), false).await;
    let app_store = crate::store::TaskStore::new(setup.data.path().join("tasks")).unwrap();
    let task = app_store.create(task_draft(None)).unwrap();
    app_store.request_start(&task.id).unwrap();
    let running = app_store.claim_next().unwrap().unwrap();
    let isolation = workspace_for(&app_store, &running, &setup.project);
    assert!(app_store
        .set_isolation(&running.id, running.execution_generation, &isolation)
        .unwrap());
    let file = crate::conversation::save(
        app_store.root(),
        &ConversationSnapshot {
            version: CONVERSATION_VERSION,
            task_id: task.id.clone(),
            generation: running.execution_generation,
            provider_id: "fixture".into(),
            model_id: "fixture-model".into(),
            messages: vec![
                Message::user("Train the baseline."),
                Message {
                    role: oleafly_agent::Role::Assistant,
                    content: vec![oleafly_agent::ContentPart::text("Started r001.")],
                },
            ],
            waiting_for_runs: true,
            saved_at: 1,
        },
    )
    .unwrap();
    let mut record = HandoffRecord::new(OwnerKind::App, OwnerKind::Daemon, HandoffReason::Quit, 0);
    record.conversation = Some(file);
    assert!(app_store
        .hand_off_with(
            &running.id,
            running.execution_generation,
            OwnerKind::Daemon,
            &record
        )
        .unwrap());

    let helper = queue(&setup, OwnerKind::Daemon, &provider);
    helper.launch_ready().await.unwrap();
    let finished = wait_for_status(&helper, &task.id, ResearchTaskStatus::AwaitingReview).await;
    // Nothing was left in flight, so the task ended without another turn.
    assert_eq!(provider.count(), 0);
    assert_eq!(finished.result.unwrap().summary, "Started r001.");
    helper.shutdown().await;
}

#[tokio::test]
async fn a_prompt_suspend_withdraws_a_pending_approval_and_keeps_the_conversation() {
    let setup = setup();
    let provider = Provider::start(vec![Reply::RunCommand, Reply::Text("done")], false).await;
    let app = queue(&setup, OwnerKind::App, &provider);
    let store = app.store().unwrap();
    let mut brief = ResearchBrief::default();
    brief.permissions.commands = CommandPolicy::Ask;
    let task = store.create(task_draft(Some(brief))).unwrap();
    store.request_start(&task.id).unwrap();
    app.launch_ready().await.unwrap();
    wait_for(|| {
        store
            .require(&task.id)
            .is_ok_and(|task| task.pending_approvals == 1)
    })
    .await;
    let results = app
        .suspend(
            std::slice::from_ref(&task.id),
            SuspendMode::Prompt,
            Some(Duration::from_secs(20)),
        )
        .await;
    let SuspendResult::Suspended { generation, state } = &results[0].1 else {
        panic!("{results:?}");
    };
    assert_eq!(store.require(&task.id).unwrap().pending_approvals, 0);
    let snapshot = crate::conversation::load(
        store.root(),
        &task.id,
        state.conversation.as_deref().unwrap(),
        *generation,
        "fixture",
        "fixture-model",
    )
    .unwrap();
    let last = snapshot.messages.last().unwrap();
    assert!(matches!(
        &last.content[0],
        oleafly_agent::ContentPart::ToolResult { output, .. } if output.contains(APPROVAL_WITHDRAWN)
    ));
    assert_eq!(provider.count(), 1);
    app.shutdown().await;
}
