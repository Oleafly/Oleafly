use std::collections::BTreeMap;
use std::path::Path;
use std::sync::atomic::AtomicBool;
use std::time::{Duration, Instant};

use super::*;
use crate::model::{
    ResearchBrief, ResearchTask, ResearchTaskDraft, ResearchTaskStatus, RetryMode, RunRecord,
    RunState, StopReason,
};
use crate::runs::{LogQuery, RunError, RunExecutor, RunHandle, RunOutcomeKind, RunSpec, RunStatus};
use crate::scheduler::ResearchTaskState;
use crate::store::TaskStore;
use crate::test_support::{FakeEnv, FakeHost, CHILD_PATIENCE};

fn context(root: &Path) -> TaskRunContext {
    TaskRunContext {
        task_id: "task".into(),
        execution_generation: 1,
        session_id: "session".into(),
        project_id: "project".into(),
        execution_root: root.to_string_lossy().into_owned(),
        title: "Task".into(),
        prompt: "Task prompt".into(),
        runtime_id: "builtin".into(),
        agent_id: "openai".into(),
        model_id: "test".into(),
        skill_ids: Vec::new(),
        source_revision: "snapshot".into(),
        allowed_paths: vec!["analysis".into()],
        ..Default::default()
    }
}

/// What running tasks share, over the task store at `tasks_root`.
fn services(tasks_root: &Path) -> TaskServices {
    let clocks = Arc::new(crate::budget::BudgetClocks::default());
    TaskServices {
        runs: crate::runs::RunManager::new(
            tasks_root.to_path_buf(),
            tokio::runtime::Handle::current(),
        ),
        tasks_root: tasks_root.to_path_buf(),
        clocks: clocks.clone(),
        approvals: crate::approvals::ApprovalQueue::new(tasks_root.to_path_buf(), clocks),
        workspace: None,
        suspends: Arc::new(crate::scheduler::SuspendSignals::default()),
    }
}

#[test]
fn timed_out_commands_report_an_error_status() {
    assert_eq!(
        tool_result_status(r#"{"output":"","exitCode":null,"timedOut":true}"#),
        "error"
    );
    assert_eq!(
        tool_result_status(r#"{"output":"ok","exitCode":0,"timedOut":false}"#),
        "done"
    );
    assert_eq!(tool_result_status(r#"{"timed_out":true}"#), "error");
}

#[test]
fn builtin_tool_events_pair_a_request_with_its_result() {
    let request = builtin_event(AgentEvent::ToolRequest {
        id: "call_17".into(),
        name: "read_file".into(),
        arguments: r#"{"path":"main.tex"}"#.into(),
    });
    assert_eq!(
        request,
        Some(TaskRuntimeEvent::Tool {
            call_id: Some("call_17".into()),
            name: "read_file".into(),
            phase: ToolPhase::Request,
            detail: r#"{"path":"main.tex"}"#.into(),
            status: Some("running".into()),
        })
    );
    assert_eq!(
        builtin_event(AgentEvent::ToolOutcome {
            id: "call_17".into(),
            output: r#"{"content":"body"}"#.into(),
        }),
        Some(TaskRuntimeEvent::Tool {
            call_id: Some("call_17".into()),
            name: String::new(),
            phase: ToolPhase::Result,
            detail: r#"{"content":"body"}"#.into(),
            status: Some("done".into()),
        })
    );
    assert!(matches!(
        builtin_event(AgentEvent::ToolOutcome {
            id: "call_18".into(),
            output: r#"{"error":"missing file"}"#.into(),
        }),
        Some(TaskRuntimeEvent::Tool { status: Some(status), .. }) if status == "error"
    ));
}

#[test]
fn streamed_tool_calls_record_the_name_first_and_the_arguments_when_they_finish() {
    assert_eq!(
        builtin_event(AgentEvent::ToolCallStart {
            id: "call_21".into(),
            name: "write_file".into(),
        }),
        Some(TaskRuntimeEvent::Tool {
            call_id: Some("call_21".into()),
            name: "write_file".into(),
            phase: ToolPhase::Request,
            detail: String::new(),
            status: Some("running".into()),
        })
    );
    assert_eq!(
        builtin_event(AgentEvent::ToolCallEnd {
            id: "call_21".into(),
            arguments: r#"{"path":"main.tex","content":"x"}"#.into(),
        }),
        Some(TaskRuntimeEvent::Tool {
            call_id: Some("call_21".into()),
            name: String::new(),
            phase: ToolPhase::Update,
            detail: r#"{"path":"main.tex","content":"x"}"#.into(),
            status: Some("running".into()),
        })
    );
    assert_eq!(
        builtin_event(AgentEvent::ToolCallArgsDelta {
            id: "call_21".into(),
            json: "{".into(),
        }),
        None
    );
}

#[test]
fn steps_are_counted_from_one_as_a_reader_counts_them() {
    assert_eq!(
        builtin_event(AgentEvent::StepStart { step: 0 }),
        Some(TaskRuntimeEvent::Status {
            message: "Working on step 1.".into(),
        })
    );
    assert_eq!(
        builtin_event(AgentEvent::StepStart { step: 4 }),
        Some(TaskRuntimeEvent::Status {
            message: "Working on step 5.".into(),
        })
    );
}

#[test]
fn legacy_tool_rows_still_parse_without_the_pairing_fields() {
    let legacy: TaskRuntimeEvent =
        serde_json::from_str(r#"{"kind":"tool","name":"read_file","detail":"main.tex"}"#).unwrap();
    assert_eq!(
        legacy,
        TaskRuntimeEvent::Tool {
            call_id: None,
            name: "read_file".into(),
            phase: ToolPhase::Request,
            detail: "main.tex".into(),
            status: None,
        }
    );
}

#[test]
fn synthetic_default_usage_is_unknown_but_reported_zero_is_retained() {
    assert!(matches!(
        builtin_event(AgentEvent::usage(oleafly_agent::Usage::default())),
        Some(TaskRuntimeEvent::Usage {
            input_tokens: None,
            output_tokens: None
        })
    ));
    assert!(matches!(
        builtin_event(AgentEvent::usage(oleafly_agent::Usage {
            input_semantics: oleafly_agent::InputTokenSemantics::Inclusive,
            ..Default::default()
        })),
        Some(TaskRuntimeEvent::Usage {
            input_tokens: Some(0),
            output_tokens: Some(0)
        })
    ));
}

#[tokio::test]
async fn active_task_cleanup_cancels_its_children_and_notifies_completion() {
    let parent = CancellationToken::new();
    let token = parent.child();
    let child = token.child();
    let sessions = Arc::new(Mutex::new(HashMap::new()));
    let (done, mut completion) = tokio::sync::watch::channel(false);
    lock(&sessions).insert(
        "session".into(),
        ActiveTaskRun {
            token: token.clone(),
            done: completion.clone(),
        },
    );
    let (_other_done, other_completion) = tokio::sync::watch::channel(false);
    let other_token = CancellationToken::new();
    lock(&sessions).insert(
        "other".into(),
        ActiveTaskRun {
            token: other_token.clone(),
            done: other_completion,
        },
    );
    let active = ActiveToken {
        sessions: sessions.clone(),
        session_id: "session".into(),
        token,
        done,
    };
    assert!(!*completion.borrow_and_update());
    drop(active);
    completion.changed().await.unwrap();
    assert!(*completion.borrow());
    assert!(child.is_cancelled());
    assert!(!parent.is_cancelled());
    assert!(!other_token.is_cancelled());
    assert!(!lock(&sessions).contains_key("session"));
    assert!(lock(&sessions).contains_key("other"));
}

struct LoopbackBridge {
    url: String,
    calls: Arc<Mutex<Vec<Value>>>,
    cancel: CancellationToken,
    server: Mutex<Option<tokio::task::JoinHandle<()>>>,
}

impl LoopbackBridge {
    async fn start() -> Arc<Self> {
        use axum::{routing::post, Json, Router};
        let calls = Arc::new(Mutex::new(Vec::new()));
        let observed = calls.clone();
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let router = Router::new().route("/mcp", post(move |Json(request): Json<Value>| {
            lock(&observed).push(request);
            async { Json(json!({"content":[{"type":"text","text":"scoped research evidence"}],"isError":false})) }
        }));
        let cancel = CancellationToken::new();
        let stopped = cancel.clone();
        let server = tokio::spawn(async move {
            axum::serve(listener, router)
                .with_graceful_shutdown(async move { stopped.cancelled().await })
                .await
                .unwrap();
        });
        Arc::new(Self {
            url: format!("http://{address}/mcp"),
            calls,
            cancel,
            server: Mutex::new(Some(server)),
        })
    }

    async fn assert_closed(&self) {
        assert!(self.cancel.is_cancelled());
        assert!(lock(&self.server).is_none());
        assert!(reqwest::Client::builder()
            .no_proxy()
            .build()
            .unwrap()
            .post(&self.url)
            .json(&json!({}))
            .send()
            .await
            .is_err());
    }
}

impl TaskBridge for LoopbackBridge {
    fn mcp_server(&self) -> Value {
        json!({"type":"http","name":"fixture-research","url":self.url,"headers":[]})
    }

    fn call_tool(self: Arc<Self>, name: String, args: Value) -> TaskRuntimeFuture<Value> {
        Box::pin(async move {
            reqwest::Client::builder()
                .no_proxy()
                .build()
                .unwrap()
                .post(&self.url)
                .json(&json!({"name":name,"arguments":args}))
                .send()
                .await
                .map_err(|error| error.to_string())?
                .json()
                .await
                .map_err(|error| error.to_string())
        })
    }

    fn shutdown(
        self: Arc<Self>,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = ()> + Send>> {
        Box::pin(async move {
            self.cancel.cancel();
            let server = lock(&self.server).take();
            if let Some(server) = server {
                tokio::time::timeout(Duration::from_secs(3), server)
                    .await
                    .unwrap()
                    .unwrap();
            }
        })
    }
}

impl Drop for LoopbackBridge {
    fn drop(&mut self) {
        self.cancel.cancel();
        if let Some(server) = self.server.get_mut().unwrap().take() {
            server.abort();
        }
    }
}

/// What the run reported to its usage sink.
#[derive(Debug, Default, Clone, PartialEq, Eq)]
struct UsageRecord {
    status: Option<String>,
    input_tokens: Option<u64>,
    output_tokens: Option<u64>,
}

struct RecordingUsage(Arc<Mutex<UsageRecord>>);

impl UsageSink for RecordingUsage {
    fn observe(&self, event: &AgentEvent) {
        if let AgentEvent::Usage { usage, .. } = event {
            let mut record = lock(&self.0);
            record.input_tokens = usage.reported_input().map(u64::from);
            record.output_tokens = usage.reported_output().map(u64::from);
        }
    }

    fn finish(&self, status: &str) {
        lock(&self.0).status = Some(status.into());
    }
}

struct FixtureHost {
    usage: Arc<Mutex<UsageRecord>>,
    provider_url: String,
    bridge: Arc<LoopbackBridge>,
    preparations: Mutex<Vec<TaskRunContext>>,
    bridge_gate: Option<Arc<tokio::sync::Semaphore>>,
    bridge_started: tokio::sync::Notify,
}

impl TaskHost for FixtureHost {
    fn skills(&self, context: &TaskRunContext) -> Result<String, String> {
        assert!(context.skill_ids.is_empty());
        Ok(String::new())
    }

    fn skill_read_paths(&self, _context: &TaskRunContext) -> Vec<PathBuf> {
        Vec::new()
    }

    fn provider(&self, context: TaskRunContext) -> TaskRuntimeFuture<TaskProvider> {
        let usage = self.usage.clone();
        let base_url = self.provider_url.clone();
        Box::pin(async move {
            Ok(TaskProvider {
                client: reqwest::Client::builder().no_proxy().build().unwrap(),
                resolved: oleafly_agent::Resolved {
                    provider_id: context.agent_id,
                    model_id: context.model_id,
                    credential: String::new(),
                    auth: None,
                    wire: oleafly_agent::Wire::OpenAiChat {
                        base_url,
                        reasoning_content: true,
                    },
                    caps: oleafly_agent::ModelCaps::default(),
                },
                usage: Box::new(RecordingUsage(usage)),
            })
        })
    }

    fn bridge(
        &self,
        context: TaskRunContext,
        _binding: Option<TaskBinding>,
    ) -> TaskRuntimeFuture<Arc<dyn TaskBridge>> {
        lock(&self.preparations).push(context);
        self.bridge_started.notify_one();
        let gate = self.bridge_gate.clone();
        let bridge = self.bridge.clone();
        Box::pin(async move {
            if let Some(gate) = gate {
                gate.acquire().await.unwrap().forget();
            }
            Ok(bridge as Arc<dyn TaskBridge>)
        })
    }
}

#[derive(Clone, Copy)]
enum ProviderBehavior {
    Edit,
    Reject,
    Wait,
    /// Asks for the same tool on every step, so the run reaches its limit.
    RepeatTool,
}

struct ProviderFixture {
    url: String,
    requests: Arc<Mutex<Vec<Value>>>,
    server: tokio::task::JoinHandle<()>,
}

fn tool_delta(calls: Vec<(&str, Value)>) -> Value {
    json!({"tool_calls": calls.into_iter().enumerate().map(|(index,(name,args))| {
        json!({"index":index,"id":format!("call-{index}"),"type":"function","function":{"name":name,"arguments":args.to_string()}})
    }).collect::<Vec<_>>()})
}

impl ProviderFixture {
    async fn start(behavior: ProviderBehavior) -> Self {
        use axum::{
            body::Body,
            http::StatusCode,
            response::{IntoResponse, Response},
            routing::post,
            Json, Router,
        };
        let requests = Arc::new(Mutex::new(Vec::new()));
        let observed = requests.clone();
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let router = Router::new().route("/v1/chat/completions", post(move |Json(request): Json<Value>| {
            let step = { let mut requests = lock(&observed); let step = requests.len(); requests.push(request); step };
            async move {
                if matches!(behavior, ProviderBehavior::Reject) {
                    return (StatusCode::BAD_REQUEST, Json(json!({"error":{"message":"fixture rejected this task"}}))).into_response();
                }
                if matches!(behavior, ProviderBehavior::Wait) {
                    let stream = futures_util::stream::pending::<Result<String,std::io::Error>>();
                    return Response::builder().header("content-type","text/event-stream").body(Body::from_stream(stream)).unwrap();
                }
                let delta = match (behavior, step) {
                    (ProviderBehavior::RepeatTool, _) => tool_delta(vec![("list_files", json!({}))]),
                    (_, 0) => tool_delta(vec![
                        ("write_file",json!({"path":"analysis/result.md","content":"Isolated manuscript revision"})),
                        ("write_file",json!({"path":"../original/main.tex","content":"Forbidden revision"})),
                    ]),
                    (_, 1) => tool_delta(vec![
                        ("read_file",json!({"path":"analysis/result.md"})),
                        ("list_files",json!({})),
                        ("search_project",json!({"query":"revision"})),
                        ("research_context",json!({})),
                    ]),
                    _ => json!({"content":"The isolated revision is ready.","reasoning_content":"Checked the scoped evidence."}),
                };
                let finish = if delta.get("tool_calls").is_some() { "tool_calls" } else { "stop" };
                let content = format!("data: {}\n\ndata: {}\n\ndata: [DONE]\n\n",
                    json!({"choices":[{"delta":delta}]}),
                    json!({"choices":[{"delta":{},"finish_reason":finish}],"usage":{"prompt_tokens":10,"completion_tokens":2}}));
                ([("content-type","text/event-stream")],content).into_response()
            }
        }));
        let server = tokio::spawn(async move {
            axum::serve(listener, router).await.unwrap();
        });
        Self {
            url: format!("http://{address}/v1"),
            requests,
            server,
        }
    }
}

impl Drop for ProviderFixture {
    fn drop(&mut self) {
        self.server.abort();
    }
}

async fn fixture_host(_root: &Path, url: String) -> Arc<FixtureHost> {
    Arc::new(FixtureHost {
        usage: Arc::new(Mutex::new(UsageRecord::default())),
        provider_url: url,
        bridge: LoopbackBridge::start().await,
        preparations: Mutex::new(Vec::new()),
        bridge_gate: None,
        bridge_started: tokio::sync::Notify::new(),
    })
}

fn event_log() -> (Arc<Mutex<Vec<TaskRuntimeEvent>>>, TaskEventSink) {
    let events = Arc::new(Mutex::new(Vec::new()));
    let sink = events.clone();
    (events, Arc::new(move |event| lock(&sink).push(event)))
}

async fn bounded_wait(mut ready: impl FnMut() -> bool) {
    tokio::time::timeout(crate::test_support::CHILD_PATIENCE, async {
        while !ready() {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("the fixture did not reach its controlled boundary");
}

fn usage_row(host: &FixtureHost) -> (String, Option<i64>, Option<i64>) {
    let record = lock(&host.usage).clone();
    (
        record.status.unwrap_or_default(),
        record.input_tokens.map(|value| value as i64),
        record.output_tokens.map(|value| value as i64),
    )
}

#[tokio::test]
async fn builtin_adapter_edits_isolated_files_and_records_native_usage() {
    let root = tempfile::tempdir().unwrap();
    let original = root.path().join("original");
    let workspace = root.path().join("workspace");
    std::fs::create_dir(&original).unwrap();
    std::fs::create_dir(&workspace).unwrap();
    std::fs::write(original.join("main.tex"), "Original manuscript").unwrap();
    let provider = ProviderFixture::start(ProviderBehavior::Edit).await;
    let host = fixture_host(root.path(), provider.url.clone()).await;
    let adapter = BuiltinTaskAdapter::new(host.clone(), services(&root.path().join("tasks")));
    let (events, sink) = event_log();
    let result = tokio::time::timeout(
        Duration::from_secs(15),
        adapter.run(context(&workspace), CancellationToken::new(), sink),
    )
    .await
    .unwrap()
    .unwrap();
    assert_eq!(result.summary, "The isolated revision is ready.");
    assert_eq!(
        (result.input_tokens, result.output_tokens),
        (Some(30), Some(6))
    );
    assert_eq!(
        std::fs::read_to_string(workspace.join("analysis/result.md")).unwrap(),
        "Isolated manuscript revision"
    );
    assert_eq!(
        std::fs::read_to_string(original.join("main.tex")).unwrap(),
        "Original manuscript"
    );
    assert!(lock(&adapter.tokens).is_empty());
    host.bridge.assert_closed().await;
    assert_eq!(lock(&host.bridge.calls)[0]["name"], "research_context");
    {
        let requests = lock(&provider.requests);
        assert_eq!(requests.len(), 3);
        assert!(requests.iter().all(|request| request["model"] == "test"));
        let tool_results = requests[2]["messages"].to_string();
        assert!(tool_results.contains("Isolated manuscript revision"));
        assert!(tool_results.contains("Use a relative path"));
        assert!(tool_results.contains("scoped research evidence"));
    }
    assert!(lock(&events).iter().any(|event| matches!(event,TaskRuntimeEvent::Reasoning{text} if text=="Checked the scoped evidence.")));
    assert_eq!(usage_row(&host), ("completed".into(), Some(30), Some(6)));
}

#[tokio::test]
async fn builtin_adapter_failure_closes_resources_without_success() {
    let root = tempfile::tempdir().unwrap();
    let provider = ProviderFixture::start(ProviderBehavior::Reject).await;
    let host = fixture_host(root.path(), provider.url.clone()).await;
    let adapter = BuiltinTaskAdapter::new(host.clone(), services(&root.path().join("tasks")));
    let error = tokio::time::timeout(
        Duration::from_secs(20),
        adapter.run(
            context(root.path()),
            CancellationToken::new(),
            event_log().1,
        ),
    )
    .await
    .unwrap()
    .unwrap_err();
    assert!(error.contains("fixture rejected"), "{error}");
    assert!(lock(&adapter.tokens).is_empty());
    host.bridge.assert_closed().await;
    let row = usage_row(&host);
    assert_eq!(row.0, "failed");
    assert_eq!((row.1, row.2), (None, None));
}

// Task turns may take 2,000 steps; unit tests use the old cap of 50.
#[tokio::test]
async fn builtin_adapter_step_limit_closes_resources_without_success() {
    let root = tempfile::tempdir().unwrap();
    let provider = ProviderFixture::start(ProviderBehavior::RepeatTool).await;
    let host = fixture_host(root.path(), provider.url.clone()).await;
    let adapter = BuiltinTaskAdapter::new(host.clone(), services(&root.path().join("tasks")));
    let error = tokio::time::timeout(
        Duration::from_secs(20),
        adapter.run(
            context(root.path()),
            CancellationToken::new(),
            event_log().1,
        ),
    )
    .await
    .unwrap()
    .unwrap_err();
    assert!(error.contains("step limit"), "{error}");
    assert!(lock(&adapter.tokens).is_empty());
    host.bridge.assert_closed().await;
    assert_eq!(lock(&provider.requests).len(), TASK_MAX_STEPS as usize);
    assert_eq!(usage_row(&host), ("failed".into(), Some(500), Some(100)));
}

#[tokio::test]
async fn builtin_adapter_cancellation_waits_for_the_stream_and_bridge() {
    let root = tempfile::tempdir().unwrap();
    let provider = ProviderFixture::start(ProviderBehavior::Wait).await;
    let host = fixture_host(root.path(), provider.url.clone()).await;
    let adapter = BuiltinTaskAdapter::new(host.clone(), services(&root.path().join("tasks")));
    let run = tokio::spawn(adapter.run(
        context(root.path()),
        CancellationToken::new(),
        event_log().1,
    ));
    bounded_wait(|| !lock(&provider.requests).is_empty()).await;
    tokio::time::timeout(Duration::from_secs(5), adapter.cancel("session".into()))
        .await
        .unwrap()
        .unwrap();
    let error = run.await.unwrap().unwrap_err();
    assert!(error.contains("cancelled"), "{error}");
    assert!(lock(&adapter.tokens).is_empty());
    host.bridge.assert_closed().await;
    let row = usage_row(&host);
    assert_eq!((row.0, row.1, row.2), ("cancelled".into(), None, None));
}

/// A host that counts how often skill folders are resolved.
struct CountingHost {
    inner: Arc<FixtureHost>,
    resolved: std::sync::atomic::AtomicUsize,
}

impl TaskHost for CountingHost {
    fn skills(&self, context: &TaskRunContext) -> Result<String, String> {
        self.inner.skills(context)
    }

    fn skill_read_paths(&self, _context: &TaskRunContext) -> Vec<PathBuf> {
        self.resolved
            .fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        Vec::new()
    }

    fn provider(&self, context: TaskRunContext) -> TaskRuntimeFuture<TaskProvider> {
        self.inner.provider(context)
    }

    fn bridge(
        &self,
        context: TaskRunContext,
        binding: Option<TaskBinding>,
    ) -> TaskRuntimeFuture<Arc<dyn TaskBridge>> {
        self.inner.bridge(context, binding)
    }
}

#[tokio::test]
async fn skill_read_paths_are_resolved_once_per_run_not_per_command() {
    let root = tempfile::tempdir().unwrap();
    let workspace = root.path().join("workspace");
    std::fs::create_dir(&workspace).unwrap();
    let provider = ProviderFixture::start(ProviderBehavior::Edit).await;
    let host = Arc::new(CountingHost {
        inner: fixture_host(root.path(), provider.url.clone()).await,
        resolved: std::sync::atomic::AtomicUsize::new(0),
    });
    let adapter = BuiltinTaskAdapter::new(host.clone(), services(&root.path().join("tasks")));
    tokio::time::timeout(
        Duration::from_secs(15),
        adapter.run(context(&workspace), CancellationToken::new(), event_log().1),
    )
    .await
    .unwrap()
    .unwrap();
    assert_eq!(host.resolved.load(std::sync::atomic::Ordering::SeqCst), 1);
}

// 0.4.8: supervised runs and wake-ups, budgets, helpers and network.

/// A reply a scripted provider sends for a request.
type Script =
    Arc<dyn Fn(Value, usize) -> Pin<Box<dyn Future<Output = Value> + Send>> + Send + Sync>;

/// A script that answers at once.
fn script(reply: impl Fn(&Value, usize) -> Value + Send + Sync + 'static) -> Script {
    Arc::new(
        move |request: Value, index: usize| -> Pin<Box<dyn Future<Output = Value> + Send>> {
            let delta = reply(&request, index);
            Box::pin(async move { delta })
        },
    )
}

/// A script that may wait before it answers.
fn script_async<F, Answer>(reply: F) -> Script
where
    F: Fn(Value, usize) -> Answer + Send + Sync + 'static,
    Answer: Future<Output = Value> + Send + 'static,
{
    Arc::new(
        move |request: Value, index: usize| -> Pin<Box<dyn Future<Output = Value> + Send>> {
            Box::pin(reply(request, index))
        },
    )
}

fn text_reply(text: &str) -> Value {
    json!({"content": text})
}

/// An OpenAI-compatible provider whose script picks each reply from the
/// request (and its index). Every request is recorded.
struct Scripted {
    url: String,
    requests: Arc<Mutex<Vec<Value>>>,
    server: tokio::task::JoinHandle<()>,
}

impl Scripted {
    async fn start(script: Script) -> Self {
        use axum::{response::IntoResponse, routing::post, Json, Router};
        let requests = Arc::new(Mutex::new(Vec::new()));
        let observed = requests.clone();
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let router = Router::new().route(
            "/v1/chat/completions",
            post(move |Json(request): Json<Value>| {
                let index = {
                    let mut requests = lock(&observed);
                    requests.push(request.clone());
                    requests.len() - 1
                };
                let streaming = request["stream"] == json!(true);
                let answer = script(request, index);
                async move {
                    let delta = answer.await;
                    // A call that is not streamed (history compaction) gets one JSON answer.
                    if !streaming {
                        let content = delta.get("content").cloned().unwrap_or_else(|| json!(""));
                        return Json(json!({
                            "choices": [{"index": 0, "finish_reason": "stop",
                                         "message": {"role": "assistant", "content": content}}],
                            "usage": {"prompt_tokens": 10, "completion_tokens": 2},
                        }))
                        .into_response();
                    }
                    let finish = if delta.get("tool_calls").is_some() {
                        "tool_calls"
                    } else {
                        "stop"
                    };
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
            server,
        }
    }

    fn requests(&self) -> Vec<Value> {
        lock(&self.requests).clone()
    }
}

impl Drop for Scripted {
    fn drop(&mut self) {
        self.server.abort();
    }
}

async fn within<T>(work: impl Future<Output = T>) -> T {
    tokio::time::timeout(CHILD_PATIENCE, work)
        .await
        .expect("the task did not finish in time")
}

/// The text of a request's last message.
fn last_message(request: &Value) -> String {
    request["messages"]
        .as_array()
        .and_then(|messages| messages.last())
        .and_then(|message| message["content"].as_str())
        .unwrap_or_default()
        .to_owned()
}

/// What the tool calls so far returned, in call order.
fn tool_outputs(request: &Value) -> Vec<String> {
    request["messages"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|message| message["role"] == "tool")
        .filter_map(|message| message["content"].as_str().map(str::to_owned))
        .collect()
}

fn tool_names(request: &Value) -> Vec<String> {
    request["tools"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|tool| tool["function"]["name"].as_str().map(str::to_owned))
        .collect()
}

fn tool_description(request: &Value, name: &str) -> String {
    request["tools"]
        .as_array()
        .into_iter()
        .flatten()
        .find(|tool| tool["function"]["name"] == name)
        .and_then(|tool| tool["function"]["description"].as_str())
        .unwrap_or_default()
        .to_owned()
}

/// A task the store at `tasks_root` is running, whose runs go to the
/// `executor` compute target.
fn running_task(tasks_root: &Path, executor: &str) -> ResearchTask {
    let store = TaskStore::new(tasks_root.to_path_buf()).unwrap();
    let mut brief = ResearchBrief::default();
    brief.compute.executor = executor.into();
    let mut draft = crate::test_support::draft("project", "Dropout sweep");
    draft.brief = Some(brief);
    let task = store.create(draft).unwrap();
    store.request_start(&task.id).unwrap();
    store.claim_next().unwrap().unwrap()
}

fn task_context(task: &ResearchTask, workspace: &Path) -> TaskRunContext {
    TaskRunContext {
        task_id: task.id.clone(),
        execution_generation: task.execution_generation,
        brief: task.brief.clone(),
        record_dir: task.record_dir(),
        ..context(workspace)
    }
}

/// Runs that keep going until the test releases them, with a log that
/// prints one metric.
struct HeldRuns {
    release: Arc<AtomicBool>,
}

#[async_trait::async_trait]
impl RunExecutor for HeldRuns {
    fn id(&self) -> &'static str {
        "held"
    }

    async fn start(&self, spec: &RunSpec) -> Result<RunHandle, RunError> {
        std::fs::write(spec.run_dir.join("stdout.log"), "loss=0.25\ndone\n")
            .map_err(|error| RunError::Io(error.to_string()))?;
        Ok(RunHandle {
            version: crate::runs::HANDLE_VERSION,
            executor: self.id().into(),
            task_id: spec.task_id.clone(),
            run_id: spec.run_id.clone(),
            run_dir: spec.run_dir.clone(),
            started_at: crate::model::now_ms(),
            data: json!({}),
        })
    }

    async fn poll(&self, _handle: &RunHandle) -> Result<RunStatus, RunError> {
        Ok(if self.release.load(std::sync::atomic::Ordering::SeqCst) {
            RunStatus::Finished {
                exit_code: Some(0),
                finished_at: crate::model::now_ms(),
                outcome: RunOutcomeKind::Succeeded,
                note: None,
            }
        } else {
            RunStatus::Running {
                started_at: crate::model::now_ms(),
                note: None,
            }
        })
    }

    async fn read_log(&self, handle: &RunHandle, query: LogQuery) -> Result<String, RunError> {
        crate::runs::log::answer(&handle.run_dir.join("stdout.log"), &query).map_err(RunError::Io)
    }

    async fn cancel(&self, _handle: &RunHandle) -> Result<(), RunError> {
        Ok(())
    }
}

#[tokio::test]
async fn the_agent_is_woken_when_a_run_finishes_after_its_turn() {
    let root = tempfile::tempdir().unwrap();
    let workspace = root.path().join("workspace");
    std::fs::create_dir_all(workspace.join("analysis")).unwrap();
    let tasks = root.path().join("tasks");
    let task = running_task(&tasks, "held");
    let provider = Scripted::start(script(|_request, index| match index {
        0 => tool_delta(vec![(
            "start_run",
            json!({"name": "baseline", "command": "python train.py"}),
        )]),
        1 => text_reply("The baseline is running."),
        _ => text_reply("Recorded r001 in the ledger."),
    }))
    .await;
    let host = fixture_host(root.path(), provider.url.clone()).await;
    let services = services(&tasks);
    let release = Arc::new(AtomicBool::new(false));
    services.runs.register_executor(Arc::new(HeldRuns {
        release: release.clone(),
    }));
    let adapter = BuiltinTaskAdapter::new(host.clone(), services.clone());
    let (events, sink) = event_log();
    let run = tokio::spawn(adapter.run(
        task_context(&task, &workspace),
        CancellationToken::new(),
        sink,
    ));

    // The turn ended while the run still went on: the agent waits for it.
    bounded_wait(|| {
        lock(&events).contains(&TaskRuntimeEvent::Phase {
            phase: TaskPhase::WaitingRuns,
        })
    })
    .await;
    assert_eq!(provider.requests().len(), 2);
    release.store(true, std::sync::atomic::Ordering::SeqCst);
    let result = within(run).await.unwrap().unwrap();

    assert_eq!(result.summary, "Recorded r001 in the ledger.");
    let requests = provider.requests();
    assert_eq!(requests.len(), 3);
    assert!(!requests[1]["messages"].to_string().contains("finished:"));
    let woken = last_message(&requests[2]);
    assert!(
        woken.starts_with(
            "Run r001 (baseline) finished: succeeded, exit code 0. Last metrics: loss=0.25. Log tail:\nloss=0.25\ndone\n"
        ),
        "{woken}"
    );
    assert!(
        woken.ends_with("Record the result in ledger.tsv with ledger_append and update handoff.md before the next step."),
        "{woken}"
    );
    let runs = services.runs.list(&task.id).unwrap();
    assert_eq!(runs.len(), 1);
    assert_eq!(
        (runs[0].state, runs[0].reported),
        (RunState::Succeeded, true)
    );
    let phases: Vec<TaskPhase> = lock(&events)
        .iter()
        .filter_map(|event| match event {
            TaskRuntimeEvent::Phase { phase } => Some(*phase),
            _ => None,
        })
        .collect();
    assert_eq!(phases, vec![TaskPhase::WaitingRuns, TaskPhase::Working]);
    host.bridge.assert_closed().await;
}

#[tokio::test]
async fn a_task_woken_two_hundred_times_stops_with_a_retry_message() {
    let root = tempfile::tempdir().unwrap();
    let workspace = root.path().join("workspace");
    std::fs::create_dir_all(workspace.join("analysis")).unwrap();
    let tasks = root.path().join("tasks");
    let task = running_task(&tasks, "local");
    let store = TaskStore::new(tasks.clone()).unwrap();
    for index in 0..201 {
        store
            .insert_run(&RunRecord {
                task_id: task.id.clone(),
                run_id: crate::runs::next_run_id(index),
                execution_generation: task.execution_generation,
                name: format!("seed {index}"),
                executor: "local".into(),
                command: "python sweep.py".into(),
                cwd_rel: String::new(),
                state: RunState::Running,
                exit_code: None,
                started_at: crate::model::now_ms(),
                finished_at: None,
                run_dir: root
                    .path()
                    .join("runs")
                    .join(index.to_string())
                    .to_string_lossy()
                    .into_owned(),
                metrics: BTreeMap::new(),
                reported: false,
            })
            .unwrap();
    }
    // Every turn ends with one more run finished, so every wait wakes the
    // agent. The long history is compacted on the way (calls not streamed),
    // which finish nothing.
    let finishing = store.clone();
    let task_id = task.id.clone();
    let turns = Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let provider = Scripted::start(script(move |request, _index| {
        if request["stream"] != json!(true) {
            return text_reply("Summary: a sweep of 201 runs is under way.");
        }
        let turn = turns.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        finishing
            .finish_run(
                &task_id,
                &crate::runs::next_run_id(turn),
                RunState::Succeeded,
                Some(0),
                crate::model::now_ms(),
                &BTreeMap::new(),
            )
            .unwrap();
        text_reply("Waiting for the sweep.")
    }))
    .await;
    let host = fixture_host(root.path(), provider.url.clone()).await;
    let adapter = BuiltinTaskAdapter::new(host.clone(), services(&tasks));
    // 201 full turns write the task store each time, which Windows runners do
    // several times slower than macOS and Linux, so this test gets 4x the
    // usual patience. A timeout says how far it got: slow or stuck.
    let run = adapter.run(
        task_context(&task, &workspace),
        CancellationToken::new(),
        event_log().1,
    );
    let error = match tokio::time::timeout(CHILD_PATIENCE * 4, run).await {
        Ok(result) => result.unwrap_err(),
        Err(_) => panic!(
            "the task did not finish in time: {} of 201 turns",
            provider
                .requests()
                .iter()
                .filter(|request| request["stream"] == json!(true))
                .count()
        ),
    };
    assert_eq!(error, "The task woke up 200 times. Retry it to continue.");
    let requests = provider.requests();
    let turns = requests
        .iter()
        .filter(|request| request["stream"] == json!(true))
        .count();
    assert_eq!(turns, 201);
    assert!(
        requests.len() > turns,
        "the long history was never compacted"
    );
    assert_eq!(usage_row(&host).0, "failed");
    host.bridge.assert_closed().await;
}

#[tokio::test]
async fn runs_wait_until_the_plan_is_approved() {
    let root = tempfile::tempdir().unwrap();
    let workspace = root.path().join("workspace");
    std::fs::create_dir_all(workspace.join("analysis")).unwrap();
    let provider = Scripted::start(script(|_request, index| match index {
        0 => tool_delta(vec![
            (
                "start_run",
                json!({"name": "baseline", "command": "python train.py"}),
            ),
            ("wait_runs", json!({})),
        ]),
        _ => text_reply("Wrote the plan."),
    }))
    .await;
    let host = fixture_host(root.path(), provider.url.clone()).await;
    let tasks = root.path().join("tasks");
    let services = services(&tasks);
    let adapter = BuiltinTaskAdapter::new(host.clone(), services.clone());
    let mut planning = context(&workspace);
    planning.plan_phase = true;
    planning.record_dir = "research/plan-0000".into();
    let result = within(adapter.run(planning, CancellationToken::new(), event_log().1))
        .await
        .unwrap();
    assert_eq!(result.summary, "Wrote the plan.");
    let requests = provider.requests();
    assert_eq!(requests.len(), 2);
    let refused = json!({"error": PLAN_NO_RUNS}).to_string();
    assert_eq!(tool_outputs(&requests[1]), vec![refused.clone(), refused]);
    assert!(services.runs.list("task").unwrap().is_empty());
}

#[tokio::test]
async fn network_for_commands_follows_the_brief() {
    for network in [false, true] {
        let root = tempfile::tempdir().unwrap();
        let workspace = root.path().join("workspace");
        std::fs::create_dir_all(workspace.join("analysis")).unwrap();
        let provider =
            Scripted::start(script(|_request, _index| text_reply("No commands needed."))).await;
        let host = fixture_host(root.path(), provider.url.clone()).await;
        let adapter = BuiltinTaskAdapter::new(host.clone(), services(&root.path().join("tasks")));
        let mut task = context(&workspace);
        task.brief.permissions.network = network;
        within(adapter.run(task, CancellationToken::new(), event_log().1))
            .await
            .unwrap();
        // The agent is told what its commands may reach...
        let described = tool_description(&provider.requests()[0], "run_command");
        assert_eq!(
            described.contains("Network access is allowed."),
            network,
            "{described}"
        );
        assert_eq!(
            described.contains("Network access is disabled."),
            !network,
            "{described}"
        );
        // ...and a command's sandbox gets the same permission.
        let home = root.path().join("home");
        std::fs::create_dir_all(&home).unwrap();
        let spec = crate::task_tools::command_spec(
            &CommandContext {
                execution_root: workspace.to_string_lossy().into_owned(),
                allowed_paths: vec!["analysis".into()],
                network,
                owner: "task:task".into(),
                ..CommandContext::default()
            },
            &home,
        )
        .unwrap();
        assert_eq!(spec.network, network);
    }
}

const HELPER_PROMPT: &str = "You help a research task with one job.";
const HELPER_RECORD: &str = "research/reader-0000";

fn is_helper(request: &Value) -> bool {
    request["messages"][0]["content"]
        .as_str()
        .is_some_and(|system| system.starts_with(HELPER_PROMPT))
}

/// The task's agent hands a job to a helper. The helper tries to change the
/// manuscript, writes its notes, then tries to start a run and a helper of
/// its own.
fn helper_script() -> Script {
    script(
        |request, _index| match (is_helper(request), tool_outputs(request).is_empty()) {
            (false, true) => tool_delta(vec![(
                SPAWN_AGENT,
                json!({"brief": "Summarize main.tex into the record's notes."}),
            )]),
            (true, true) => tool_delta(vec![
                (
                    "write_file",
                    json!({"path": "main.tex", "content": "Helper revision"}),
                ),
                (
                    "write_file",
                    json!({"path": format!("{HELPER_RECORD}/notes/x.md"), "content": "Helper notes"}),
                ),
                (
                    "start_run",
                    json!({"name": "train", "command": "python train.py"}),
                ),
                (SPAWN_AGENT, json!({"brief": "Go deeper."})),
            ]),
            (true, false) => text_reply("Read main.tex and wrote notes."),
            (false, false) => text_reply("The helper finished."),
        },
    )
}

async fn run_with_helper(root: &Path) -> Vec<Value> {
    let workspace = root.join("workspace");
    std::fs::create_dir_all(&workspace).unwrap();
    std::fs::write(workspace.join("main.tex"), "Original manuscript").unwrap();
    let provider = Scripted::start(helper_script()).await;
    let host = fixture_host(root, provider.url.clone()).await;
    let adapter = BuiltinTaskAdapter::new(host.clone(), services(&root.join("tasks")));
    let mut task = context(&workspace);
    task.allowed_paths = vec!["main.tex".into(), "research".into()];
    task.record_dir = HELPER_RECORD.into();
    let result = within(adapter.run(task, CancellationToken::new(), event_log().1))
        .await
        .unwrap();
    assert_eq!(result.summary, "The helper finished.");
    provider.requests()
}

#[tokio::test]
async fn spawned_readers_can_only_write_inside_the_record() {
    let root = tempfile::tempdir().unwrap();
    let requests = run_with_helper(root.path()).await;
    let workspace = root.path().join("workspace");
    assert_eq!(
        std::fs::read_to_string(workspace.join("main.tex")).unwrap(),
        "Original manuscript"
    );
    assert_eq!(
        std::fs::read_to_string(workspace.join(HELPER_RECORD).join("notes/x.md")).unwrap(),
        "Helper notes"
    );
    let helper = requests
        .iter()
        .find(|request| is_helper(request) && !tool_outputs(request).is_empty())
        .unwrap();
    let outputs = tool_outputs(helper);
    assert!(
        outputs[0].contains("outside this task's allowed project files"),
        "{outputs:?}"
    );
    assert!(!outputs[1].contains("error"), "{outputs:?}");
    // The task's agent learns what the helper wrote.
    let parent = requests
        .iter()
        .find(|request| !is_helper(request) && !tool_outputs(request).is_empty())
        .unwrap();
    let spawned: Value = serde_json::from_str(&tool_outputs(parent)[0]).unwrap();
    assert_eq!(spawned["summary"], "Read main.tex and wrote notes.");
    assert_eq!(
        spawned["wrote"],
        json!([format!("{HELPER_RECORD}/notes/x.md")])
    );
}

#[tokio::test]
async fn spawned_readers_cannot_spawn_or_run() {
    let root = tempfile::tempdir().unwrap();
    let requests = run_with_helper(root.path()).await;
    let first = requests
        .iter()
        .find(|request| is_helper(request) && tool_outputs(request).is_empty())
        .unwrap();
    let mut offered = tool_names(first);
    offered.sort();
    assert_eq!(
        offered,
        [
            "list_files",
            "literature_search",
            "read_file",
            "read_paper",
            "search_project",
            "write_file"
        ]
    );
    let answered = requests
        .iter()
        .find(|request| is_helper(request) && !tool_outputs(request).is_empty())
        .unwrap();
    let refused = json!({"error": "This tool is unavailable to helpers."}).to_string();
    assert_eq!(&tool_outputs(answered)[2..], [refused.clone(), refused]);
    // The task's own agent has them.
    let parent = tool_names(requests.iter().find(|request| !is_helper(request)).unwrap());
    for name in [SPAWN_AGENT, "run_command", "start_run"] {
        assert!(
            parent.contains(&name.to_owned()),
            "{name} missing from {parent:?}"
        );
    }
}

/// Every transcript row of a generation, page by page.
fn all_events(state: &ResearchTaskState, task_id: &str, generation: u64) -> Vec<TaskRuntimeEvent> {
    let mut events = Vec::new();
    let mut after = None;
    loop {
        let page = state.events(task_id, generation, after, 200).unwrap();
        events.extend(page.events.into_iter().map(|row| row.event));
        match page.next_sequence {
            Some(next) => after = Some(next),
            None => return events,
        }
    }
}

/// A queued, resumed task whose earlier attempt used all but 1.5 seconds of
/// its five minute budget, with the queue it runs on.
struct BudgetedTask {
    state: ResearchTaskState,
    store: TaskStore,
    task: ResearchTask,
    tasks: PathBuf,
    limit_ms: u64,
}

fn budgeted_task(data: &Path, executor: &str) -> BudgetedTask {
    let project = data.join("projects").join("paper");
    std::fs::create_dir_all(&project).unwrap();
    std::fs::write(project.join("main.tex"), "original manuscript").unwrap();
    let tasks = data.join("tasks");
    let state = ResearchTaskState::for_test(tasks.clone(), 2);
    state.attach(
        Arc::new(FakeHost::new(
            FakeEnv::new().with_project("paper", &project).without_git(),
        )),
        tokio::runtime::Handle::current(),
    );
    let store = state.store().unwrap();
    let limit_ms: u64 = 5 * 60 * 1000;
    let mut brief = ResearchBrief::default();
    brief.budget.wall_clock_minutes = 5;
    brief.compute.executor = executor.into();
    let task = store
        .create(ResearchTaskDraft {
            project_id: "paper".into(),
            title: "Budgeted sweep".into(),
            prompt: "Keep improving the analysis.".into(),
            runtime_id: "builtin".into(),
            agent_id: "fixture".into(),
            model_id: "fixture-model".into(),
            brief: Some(brief),
            ..Default::default()
        })
        .unwrap();
    // An earlier attempt used all but 1.5 seconds of the five minutes; a
    // resume keeps that time and the workspace (minutes are not scaled in
    // tests).
    store.request_start(&task.id).unwrap();
    let earlier = store.claim_next().unwrap().unwrap();
    let isolation = crate::isolation::prepare_at(
        &project,
        &crate::isolation::task_workspace_root(store.root(), &task.id)
            .join(earlier.execution_generation.to_string()),
        crate::isolation::IsolationSource::Snapshot,
        None,
        &CancellationToken::new(),
    )
    .unwrap();
    assert!(store
        .set_isolation(&task.id, earlier.execution_generation, &isolation)
        .unwrap());
    assert!(store
        .set_active_ms(&task.id, earlier.execution_generation, limit_ms - 1_500)
        .unwrap());
    assert!(store
        .finish_failure(&task.id, earlier.execution_generation, "Stopped early.")
        .unwrap());
    store.retry_with(&task.id, RetryMode::Resume).unwrap();

    BudgetedTask {
        state,
        store,
        task,
        tasks,
        limit_ms,
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn a_time_budget_stop_wraps_up_and_goes_to_review() {
    const WRAP_UP: &str = "The time budget ended";
    let data = tempfile::tempdir().unwrap();
    let BudgetedTask {
        state,
        store,
        task,
        tasks,
        limit_ms,
    } = budgeted_task(data.path(), "local");

    // The agent keeps calling tools. The wrap-up is answered once the queue
    // has counted the whole budget (it saves the active time it counts), so
    // the stop is the budget's.
    let (watched_root, watched_task) = (tasks.clone(), task.id.clone());
    let provider = Scripted::start(script_async(move |request, _index| {
        let (root, id) = (watched_root.clone(), watched_task.clone());
        async move {
            if !request["messages"].to_string().contains(WRAP_UP) {
                tokio::time::sleep(Duration::from_millis(25)).await;
                return tool_delta(vec![("list_files", json!({}))]);
            }
            let store = TaskStore::new(root).unwrap();
            let deadline = Instant::now() + CHILD_PATIENCE;
            while store.require(&id).map_or(0, |task| task.active_ms) < limit_ms
                && Instant::now() < deadline
            {
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
            text_reply("Updated the handoff and wrote the report.")
        }
    }))
    .await;
    let host = fixture_host(data.path(), provider.url.clone()).await;
    state
        .register_runtime(
            "builtin",
            Arc::new(BuiltinTaskAdapter::new(host, state.services().unwrap())),
        )
        .unwrap();
    state.request_start(&task.id).unwrap();
    state.launch_ready().await.unwrap();

    let finished = within(async {
        loop {
            let current = store.require(&task.id).unwrap();
            if !matches!(
                current.status,
                ResearchTaskStatus::Queued | ResearchTaskStatus::Running
            ) {
                return current;
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    })
    .await;
    assert_eq!(
        finished.status,
        ResearchTaskStatus::AwaitingReview,
        "{:?}",
        finished.error
    );
    assert_eq!(finished.stop_reason, Some(StopReason::BudgetTime));
    assert_eq!(
        finished.result.as_ref().unwrap().summary,
        "Updated the handoff and wrote the report."
    );
    let requests = provider.requests();
    let (wrap_ups, working): (Vec<&Value>, Vec<&Value>) = requests
        .iter()
        .partition(|request| request["messages"].to_string().contains(WRAP_UP));
    assert!(
        !working.is_empty(),
        "the agent never worked before the budget ended"
    );
    assert_eq!(wrap_ups.len(), 1);
    assert_eq!(
        last_message(wrap_ups[0]),
        crate::prompt::wrap_up_message(&finished.record_dir())
    );
    let events = all_events(&state, &task.id, finished.execution_generation);
    assert!(events.contains(&TaskRuntimeEvent::Phase {
        phase: TaskPhase::WrappingUp
    }));
    state.shutdown().await;
}

/// Queues `budgeted` on the built-in runtime against the scripted provider and
/// waits until it leaves the queue.
async fn finish_budgeted(
    data: &Path,
    budgeted: &BudgetedTask,
    provider_url: String,
) -> ResearchTask {
    let host = fixture_host(data, provider_url).await;
    budgeted
        .state
        .register_runtime(
            "builtin",
            Arc::new(BuiltinTaskAdapter::new(
                host,
                budgeted.state.services().unwrap(),
            )),
        )
        .unwrap();
    budgeted.state.request_start(&budgeted.task.id).unwrap();
    budgeted.state.launch_ready().await.unwrap();
    within(async {
        loop {
            let current = budgeted.store.require(&budgeted.task.id).unwrap();
            if !matches!(
                current.status,
                ResearchTaskStatus::Queued | ResearchTaskStatus::Running
            ) {
                return current;
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    })
    .await
}

/// A wrap-up script: the agent writes `handoff.md` with a tool call, then
/// answers once the queue has counted the whole budget.
fn wrap_up_script(budgeted: &BudgetedTask, marker: &'static str) -> Script {
    let (root, id, limit_ms) = (
        budgeted.tasks.clone(),
        budgeted.task.id.clone(),
        budgeted.limit_ms,
    );
    script_async(move |request, _index| {
        let (root, id) = (root.clone(), id.clone());
        async move {
            let messages = request["messages"].to_string();
            let store = TaskStore::new(root).unwrap();
            if !messages.contains(marker) {
                tokio::time::sleep(Duration::from_millis(25)).await;
                return tool_delta(vec![("list_files", json!({}))]);
            }
            if !messages.contains("write_file") {
                let record = store.require(&id).unwrap().record_dir();
                return tool_delta(vec![(
                    "write_file",
                    json!({"path": format!("{record}/handoff.md"), "content": "Stopped at the budget."}),
                )]);
            }
            let deadline = Instant::now() + CHILD_PATIENCE;
            while store.require(&id).map_or(0, |task| task.active_ms) < limit_ms
                && Instant::now() < deadline
            {
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
            text_reply("Wrote the handoff.")
        }
    })
}

/// What the wrap-up's `write_file` call answered and left in the workspace.
fn assert_handoff_written(finished: &ResearchTask, requests: &[Value]) {
    let answered = requests
        .iter()
        .filter(|request| request["messages"].to_string().contains("write_file"))
        .flat_map(tool_outputs)
        .last()
        .expect("the wrap-up never called write_file");
    assert!(answered.contains("\"bytes\""), "{answered}");
    assert!(!answered.contains("cancelled"), "{answered}");
    let workspace = &finished.isolation.as_ref().unwrap().execution_root;
    let handoff = Path::new(workspace)
        .join(finished.record_dir())
        .join("handoff.md");
    assert_eq!(
        std::fs::read_to_string(handoff).unwrap(),
        "Stopped at the budget."
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn the_wrap_up_turn_can_use_its_tools() {
    const WRAP_UP: &str = "The time budget ended";
    let data = tempfile::tempdir().unwrap();
    let budgeted = budgeted_task(data.path(), "local");
    let provider = Scripted::start(wrap_up_script(&budgeted, WRAP_UP)).await;
    let finished = finish_budgeted(data.path(), &budgeted, provider.url.clone()).await;

    assert_eq!(
        finished.status,
        ResearchTaskStatus::AwaitingReview,
        "{:?}",
        finished.error
    );
    assert_eq!(finished.stop_reason, Some(StopReason::BudgetTime));
    assert_eq!(
        finished.result.as_ref().unwrap().summary,
        "Wrote the handoff."
    );
    assert_handoff_written(&finished, &provider.requests());
    budgeted.state.shutdown().await;
}

#[tokio::test(flavor = "multi_thread")]
async fn a_task_that_waits_for_runs_when_its_time_ends_still_wraps_up() {
    const WRAP_UP: &str = "The time budget ended";
    let data = tempfile::tempdir().unwrap();
    let budgeted = budgeted_task(data.path(), "held");
    // The run never finishes: only the budget ends the wait.
    budgeted
        .state
        .services()
        .unwrap()
        .runs
        .register_executor(Arc::new(HeldRuns {
            release: Arc::new(AtomicBool::new(false)),
        }));
    let wrap_up = wrap_up_script(&budgeted, WRAP_UP);
    let provider = Scripted::start(script_async(move |request, index| {
        let messages = request["messages"].to_string();
        let answer = (!messages.contains(WRAP_UP)).then(|| match index {
            0 => tool_delta(vec![(
                "start_run",
                json!({"name": "baseline", "command": "python train.py"}),
            )]),
            _ => text_reply("The baseline is running."),
        });
        let wrap_up = wrap_up.clone();
        async move {
            match answer {
                Some(answer) => answer,
                None => wrap_up(request, index).await,
            }
        }
    }))
    .await;
    let finished = finish_budgeted(data.path(), &budgeted, provider.url.clone()).await;

    assert_eq!(
        finished.status,
        ResearchTaskStatus::AwaitingReview,
        "{:?}",
        finished.error
    );
    assert_eq!(finished.stop_reason, Some(StopReason::BudgetTime));
    assert_eq!(
        finished.result.as_ref().unwrap().summary,
        "Wrote the handoff."
    );
    assert_handoff_written(&finished, &provider.requests());
    let events = all_events(&budgeted.state, &finished.id, finished.execution_generation);
    assert!(events.contains(&TaskRuntimeEvent::Phase {
        phase: TaskPhase::WrappingUp
    }));
    budgeted.state.shutdown().await;
}
