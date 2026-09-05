use super::*;
use tokio::io::AsyncWriteExt;

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
    }
}

#[test]
fn workspace_requires_a_directory_and_explicit_nonempty_scope() {
    let root = tempfile::tempdir().unwrap();
    let ordinary_file = root.path().join("file");
    std::fs::write(&ordinary_file, "original").unwrap();
    assert!(TaskFiles::open(&ordinary_file, &["analysis".into()]).is_err());
    assert!(TaskFiles::open(&root.path().join("missing"), &["analysis".into()]).is_err());
    assert!(TaskFiles::open(root.path(), &[]).is_err());
    for path in [
        "",
        ".",
        "..",
        "/",
        "analysis/../outside",
        "analysis/.OLEAFLY/state",
    ] {
        assert!(
            TaskFiles::open(root.path(), &[path.into()]).is_err(),
            "{path}"
        );
    }
    assert_eq!(std::fs::read_to_string(ordinary_file).unwrap(), "original");
}

#[test]
fn listing_leaf_scopes_traverses_parents_without_exposing_siblings() {
    let root = tempfile::tempdir().unwrap();
    for (path, content) in [
        ("analysis/allowed/answer.md", "needle answer"),
        ("analysis/allowed/extra.md", "needle extra"),
        ("analysis/hidden.md", "needle hidden"),
        ("analysis-neighbor/hidden.md", "needle neighbor"),
        ("data/source.csv", "needle source"),
    ] {
        let path = root.path().join(path);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, content).unwrap();
    }
    let files = TaskFiles::open(
        root.path(),
        &[
            "analysis/allowed/answer.md".into(),
            "data/source.csv".into(),
        ],
    )
    .unwrap();
    assert_eq!(
        files.list("").unwrap(),
        (
            vec![
                "analysis/allowed/answer.md".into(),
                "data/source.csv".into()
            ],
            false
        )
    );
    assert_eq!(
        files.list("analysis").unwrap(),
        (vec!["analysis/allowed/answer.md".into()], false)
    );
    assert!(files.list("analysis-neighbor").is_err());
    assert!(files.list("analysis/hidden.md").is_err());
    assert!(files.read("analysis/allowed/extra.md").is_err());
    let matches = files.search("needle").unwrap();
    assert_eq!(matches["matches"].as_array().unwrap().len(), 2);
    assert_eq!(matches["truncated"], false);
}

#[test]
fn writes_reject_directory_destinations_and_file_parents_without_losing_data() {
    let root = tempfile::tempdir().unwrap();
    let files = TaskFiles::open(root.path(), &["analysis".into()]).unwrap();
    files.write("analysis/existing.md", "original").unwrap();
    assert!(files.write("analysis", "replacement").is_err());
    assert!(files
        .write("analysis/existing.md/child", "replacement")
        .is_err());
    assert_eq!(files.read("analysis/existing.md").unwrap(), "original");
    assert_eq!(files.list("").unwrap().0, vec!["analysis/existing.md"]);
    assert!(files.read("analysis").is_err());
}

#[cfg(unix)]
#[test]
fn fifo_and_symlink_roots_are_rejected_without_opening_external_files() {
    use std::os::unix::fs::symlink;
    let root = tempfile::tempdir().unwrap();
    let linked = root.path().join("linked");
    symlink(root.path(), &linked).unwrap();
    assert!(TaskFiles::open(&linked, &["analysis".into()]).is_err());
    std::fs::create_dir(root.path().join("analysis")).unwrap();
    let fifo = root.path().join("analysis/pipe");
    let fifo_name = std::ffi::CString::new(fifo.as_os_str().as_encoded_bytes()).unwrap();
    assert_eq!(unsafe { libc::mkfifo(fifo_name.as_ptr(), 0o600) }, 0);
    let files = TaskFiles::open(root.path(), &["analysis".into()]).unwrap();
    assert!(files.read("analysis/pipe").is_err());
    assert!(files.write("analysis/pipe", "text").is_err());
    assert!(files.list("").unwrap().0.is_empty());
}

#[test]
fn search_caps_matches_and_unicode_line_output_and_validates_queries() {
    let root = tempfile::tempdir().unwrap();
    let files = TaskFiles::open(root.path(), &["analysis".into()]).unwrap();
    files
        .write(
            "analysis/matches.md",
            &format!("needle {}\n", "🍃".repeat(400)).repeat(40),
        )
        .unwrap();
    let result = files.search("needle").unwrap();
    let matches = result["matches"].as_array().unwrap();
    assert_eq!(matches.len(), 32);
    assert_eq!(result["truncated"], true);
    for (index, entry) in matches.iter().enumerate() {
        assert_eq!(entry["path"], "analysis/matches.md");
        assert_eq!(entry["line"], index + 1);
        let text = entry["text"].as_str().unwrap();
        assert!(text.starts_with("needle 🍃"));
        assert!(text.ends_with("\n[output truncated]"));
        assert!(!text.contains('\u{fffd}'));
        assert!(text.len() <= 1024 + "\n[output truncated]".len());
    }
    assert!(files.search("").is_err());
    assert!(files.search(&"x".repeat(1025)).is_err());
    let missing = files.search("absent").unwrap();
    assert!(missing["matches"].as_array().unwrap().is_empty());
    assert_eq!(missing["truncated"], false);
}

#[test]
fn search_reports_when_its_total_scan_budget_leaves_files_unread() {
    let root = tempfile::tempdir().unwrap();
    let analysis = root.path().join("analysis");
    std::fs::create_dir(&analysis).unwrap();
    let data = vec![b'x'; MAX_FILE_BYTES];
    for index in 0..17 {
        std::fs::write(analysis.join(format!("{index:02}.txt")), &data).unwrap();
    }
    std::fs::write(analysis.join("99.txt"), "needle").unwrap();
    let files = TaskFiles::open(root.path(), &["analysis".into()]).unwrap();
    let result = files.search("needle").unwrap();
    assert!(result["matches"].as_array().unwrap().is_empty());
    assert_eq!(result["truncated"], true);
}

#[test]
fn listing_reports_truncation_without_exceeding_its_output_budget() {
    let root = tempfile::tempdir().unwrap();
    let analysis = root.path().join("analysis");
    std::fs::create_dir(&analysis).unwrap();
    for index in 0..150 {
        std::fs::write(
            analysis.join(format!("{index:03}-{}.txt", "a".repeat(190))),
            "",
        )
        .unwrap();
    }
    let files = TaskFiles::open(root.path(), &["analysis".into()]).unwrap();
    let (listed, truncated) = files.list("").unwrap();
    assert!(truncated);
    assert!(!listed.is_empty());
    assert!(listed.len() < 150);
    assert!(listed.iter().map(|path| path.len() + 4).sum::<usize>() <= MAX_OUTPUT_BYTES / 2);
    assert!(listed.windows(2).all(|pair| pair[0] < pair[1]));
    assert!(listed
        .iter()
        .all(|path| files.read(path).unwrap().is_empty()));
}

#[test]
fn sandbox_rejects_invalid_temporary_folders_and_overbroad_read_grants() {
    let root = tempfile::tempdir().unwrap();
    let program = std::env::current_exe().unwrap();
    let allowed = vec!["analysis".into()];
    let temp_file = root.path().join("temp-file");
    std::fs::write(&temp_file, "original").unwrap();
    for temp in [root.path().join("missing"), temp_file.clone()] {
        assert!(sandbox_task_command(&program, &[], root.path(), &allowed, &temp, false).is_err());
    }
    let temp = tempfile::tempdir().unwrap();
    let filesystem_root = program.ancestors().last().unwrap().to_path_buf();
    for read in [filesystem_root, root.path().join("missing-read")] {
        assert!(sandbox_task_command_with_reads(
            &program,
            &[],
            root.path(),
            &allowed,
            temp.path(),
            false,
            &[read]
        )
        .is_err());
    }
    assert_eq!(std::fs::read_to_string(temp_file).unwrap(), "original");
}

#[cfg(unix)]
#[test]
fn sandbox_rejects_linked_write_grants_and_linked_temporary_folders() {
    use std::os::unix::fs::symlink;
    let root = tempfile::tempdir().unwrap();
    let outside = tempfile::tempdir().unwrap();
    let temp = tempfile::tempdir().unwrap();
    symlink(outside.path(), root.path().join("analysis")).unwrap();
    let program = std::env::current_exe().unwrap();
    assert!(sandbox_task_command(
        &program,
        &[],
        root.path(),
        &["analysis".into()],
        temp.path(),
        false
    )
    .is_err());
    let linked_temp = root.path().join("linked-temp");
    symlink(temp.path(), &linked_temp).unwrap();
    assert!(sandbox_task_command(
        &program,
        &[],
        root.path(),
        &["other".into()],
        &linked_temp,
        false
    )
    .is_err());
    assert!(std::fs::read_dir(outside.path()).unwrap().next().is_none());
    assert!(!root.path().join("other").exists());
}

#[tokio::test]
async fn output_reader_drains_backpressure_after_reaching_its_retention_limit() {
    let (mut writer, reader) = tokio::io::duplex(1024);
    let output = tokio::spawn(read_output(reader));
    tokio::time::timeout(Duration::from_secs(5), async {
        writer
            .write_all(&vec![b'x'; MAX_OUTPUT_BYTES * 4])
            .await
            .unwrap();
        writer.shutdown().await.unwrap();
        let output = output.await.unwrap();
        assert_eq!(output.len(), MAX_OUTPUT_BYTES + 1);
        assert!(output.iter().all(|byte| *byte == b'x'));
    })
    .await
    .unwrap();
}

#[tokio::test]
async fn cancelled_and_invalid_commands_do_not_create_task_files() {
    let root = tempfile::tempdir().unwrap();
    let context = context(root.path());
    let jobs = CommandJobs::default();
    let cancelled = CancellationToken::new();
    cancelled.cancel();
    assert!(jobs
        .run(
            context.clone(),
            "printf changed > analysis/result".into(),
            cancelled
        )
        .await
        .is_err());
    for command in [" \n\t".to_string(), "x".repeat(16 * 1024 + 1)] {
        assert!(jobs
            .run(context.clone(), command, CancellationToken::new())
            .await
            .is_err());
    }
    jobs.finish().await;
    assert!(lock(&jobs.tasks).is_empty());
    assert!(std::fs::read_dir(root.path()).unwrap().next().is_none());
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

struct FixtureHost {
    usage_root: PathBuf,
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

    fn provider(&self, context: TaskRunContext) -> TaskRuntimeFuture<TaskProvider> {
        let usage_root = self.usage_root.clone();
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
                },
                usage_root,
            })
        })
    }

    fn bridge(&self, context: TaskRunContext) -> TaskRuntimeFuture<Arc<dyn TaskBridge>> {
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
                let delta = match (behavior,step) {
                    (ProviderBehavior::RepeatTool,_) => tool_delta(vec![("list_files",json!({}))]),
                    (_,0) => tool_delta(vec![
                        ("write_file",json!({"path":"analysis/result.md","content":"Isolated manuscript revision"})),
                        ("write_file",json!({"path":"../original/main.tex","content":"Forbidden revision"})),
                    ]),
                    (_,1) => tool_delta(vec![
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

async fn fixture_host(root: &Path, url: String) -> Arc<FixtureHost> {
    Arc::new(FixtureHost {
        usage_root: root.join("usage"),
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
    tokio::time::timeout(Duration::from_secs(10), async {
        while !ready() {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("the fixture did not reach its controlled boundary");
}

fn usage_row(root: &Path) -> (String, Option<i64>, Option<i64>, String, String, String) {
    let database = crate::library_db::open(root).unwrap();
    assert_eq!(
        database
            .query_row("SELECT COUNT(*) FROM usage_records", [], |row| row
                .get::<_, i64>(0))
            .unwrap(),
        1
    );
    database.query_row("SELECT status,input_tokens,output_tokens,task_id,session_id,model_id FROM usage_records", [], |row| {
        Ok((row.get(0)?,row.get(1)?,row.get(2)?,row.get(3)?,row.get(4)?,row.get(5)?))
    }).unwrap()
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
    let adapter = BuiltinTaskAdapter {
        host: host.clone(),
        tokens: Arc::new(Mutex::new(HashMap::new())),
    };
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
    assert_eq!(
        usage_row(&host.usage_root),
        (
            "completed".into(),
            Some(30),
            Some(6),
            "task".into(),
            "session".into(),
            "test".into()
        )
    );
}

#[tokio::test]
async fn builtin_adapter_failure_and_step_limit_close_resources_without_success() {
    for (behavior, expected) in [
        (ProviderBehavior::Reject, "fixture rejected"),
        (ProviderBehavior::RepeatTool, "step limit"),
    ] {
        let root = tempfile::tempdir().unwrap();
        let provider = ProviderFixture::start(behavior).await;
        let host = fixture_host(root.path(), provider.url.clone()).await;
        let adapter = BuiltinTaskAdapter {
            host: host.clone(),
            tokens: Arc::new(Mutex::new(HashMap::new())),
        };
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
        assert!(error.contains(expected), "{error}");
        assert!(lock(&adapter.tokens).is_empty());
        host.bridge.assert_closed().await;
        let row = usage_row(&host.usage_root);
        assert_eq!(row.0, "failed");
        if matches!(behavior, ProviderBehavior::Reject) {
            assert_eq!((row.1, row.2), (None, None));
        } else {
            assert_eq!(lock(&provider.requests).len(), 50);
            assert_eq!((row.1, row.2), (Some(500), Some(100)));
        }
    }
}

#[tokio::test]
async fn builtin_adapter_cancellation_waits_for_the_stream_and_bridge() {
    let root = tempfile::tempdir().unwrap();
    let provider = ProviderFixture::start(ProviderBehavior::Wait).await;
    let host = fixture_host(root.path(), provider.url.clone()).await;
    let adapter = BuiltinTaskAdapter {
        host: host.clone(),
        tokens: Arc::new(Mutex::new(HashMap::new())),
    };
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
    let row = usage_row(&host.usage_root);
    assert_eq!((row.0, row.1, row.2), ("cancelled".into(), None, None));
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
const ACP_TASK_FIXTURE: &str = r#"
import json
import os
from pathlib import Path
import sys
import time
import urllib.request

scenario = sys.argv[1]
original = Path(sys.argv[2])
native = "fixture-native"
pending = None
servers = []
model = "default-model"

def send(value):
    print(json.dumps({"jsonrpc":"2.0", **value}), flush=True)

def result(request, value):
    send({"id":request["id"], "result":value})

def update(kind, **data):
    send({"method":"session/update", "params":{"sessionId":native, "update":{"sessionUpdate":kind, **data}}})

for line in sys.stdin:
    request = json.loads(line)
    method = request.get("method")
    params = request.get("params", {})
    if method == "initialize":
        Path("analysis/agent.pid").write_text(str(os.getpid()))
        result(request, {"protocolVersion":1, "agentCapabilities":{"mcpCapabilities":{"http":True}}})
    elif method == "session/new":
        servers = params["mcpServers"]
        assert Path(params["cwd"]).samefile(Path.cwd())
        result(request, {"sessionId":native,"models":{"currentModelId":model,"availableModels":[{"modelId":"default-model","name":"Default"},{"modelId":"test","name":"Selected"}]}})
    elif method == "session/set_model":
        model = params["modelId"]
        result(request, {})
    elif method == "session/prompt":
        Path("analysis/selected-model").write_text(model)
        update("agent_thought_chunk", content={"type":"text","text":"Checking isolated evidence."})
        update("tool_call", toolCallId="write-1", title="Write isolated result", status="in_progress")
        if scenario == "hang":
            child = os.fork()
            if child == 0:
                for count in range(1000):
                    with open("analysis/heartbeat", "a") as handle:
                        handle.write(str(count) + "\n")
                    time.sleep(0.02)
                os._exit(0)
            Path("analysis/child.pid").write_text(str(child))
            pending = request
            continue
        if scenario == "error":
            update("agent_message_chunk", content={"type":"text","text":"Partial fixture answer"})
            send({"id":request["id"],"error":{"code":-32000,"message":"fixture task failed"}})
            continue
        if scenario == "length":
            update("usage_update", used=900,size=32000)
            update("agent_message_chunk", content={"type":"text","text":"Incomplete fixture answer"})
            result(request, {"stopReason":"max_tokens"})
            continue
        try:
            original.read_text()
            raise AssertionError("An unlinked original was readable")
        except (PermissionError, FileNotFoundError):
            pass
        Path("analysis/result.md").write_text("Native ACP isolated revision")
        payload = json.dumps({"name":"research_context","arguments":{}}).encode()
        call = urllib.request.Request(servers[0]["url"], data=payload,headers={"Content-Type":"application/json"})
        with urllib.request.build_opener(urllib.request.ProxyHandler({})).open(call,timeout=5) as response:
            assert json.load(response)["content"][0]["text"] == "scoped research evidence"
        update("tool_call_update", toolCallId="write-1", title="Write isolated result",status="completed")
        update("usage_update", used=900,size=32000)
        for index in range(300):
            update("agent_message_chunk", content={"type":"text","text":str(index) + ","})
        result(request, {"stopReason":"end_turn","usage":{"inputTokens":11,"outputTokens":7}})
    elif method == "session/cancel" and pending:
        result(pending,{"stopReason":"cancelled"})
        pending = None
"#;

#[cfg(any(target_os = "macos", target_os = "linux"))]
struct AcpFixture {
    directory: tempfile::TempDir,
    workspace: PathBuf,
    original: PathBuf,
    host: Arc<FixtureHost>,
    adapter: AcpTaskAdapter,
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
impl Drop for AcpFixture {
    fn drop(&mut self) {
        self.adapter.runtime.stop_all_now();
    }
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
impl AcpFixture {
    async fn new(scenario: &str) -> Self {
        let directory = tempfile::tempdir().unwrap();
        let original = directory.path().join("original.tex");
        let workspace = directory.path().join("workspace");
        std::fs::create_dir(&workspace).unwrap();
        std::fs::create_dir(workspace.join("analysis")).unwrap();
        std::fs::write(&original, "Original manuscript").unwrap();
        let script = directory.path().join("fixture.py");
        std::fs::write(&script, ACP_TASK_FIXTURE).unwrap();
        let output = std::process::Command::new("python3")
            .args(["-c", "import sys; print(sys.executable)"])
            .output()
            .unwrap();
        assert!(output.status.success());
        let python = PathBuf::from(String::from_utf8(output.stdout).unwrap().trim())
            .canonicalize()
            .unwrap();
        #[cfg(target_os = "macos")]
        let python = python
            .parent()
            .and_then(Path::parent)
            .map(|prefix| prefix.join("Resources/Python.app/Contents/MacOS/Python"))
            .filter(|path| path.is_file())
            .unwrap_or(python);
        let runtime = crate::acp::AcpRuntime::new(directory.path().join("acp")).unwrap();
        let definition = crate::acp::AgentDefinition {
            id: "fixture-task-agent".into(),
            name: "Task fixture".into(),
            version: "1.0.0".into(),
            description: String::new(),
            builtin: false,
            distribution: crate::acp::Distribution {
                command: Some(crate::acp::CommandDistribution {
                    executable: python.to_string_lossy().into_owned(),
                    args: vec![
                        "-u".into(),
                        "-B".into(),
                        script.to_string_lossy().into_owned(),
                        scenario.into(),
                        original.to_string_lossy().into_owned(),
                    ],
                }),
                ..Default::default()
            },
        };
        runtime
            .register(&serde_json::to_string(&definition).unwrap())
            .unwrap();
        let host = fixture_host(directory.path(), "http://127.0.0.1:9".into()).await;
        let adapter = AcpTaskAdapter {
            host: host.clone(),
            runtime,
            tokens: Arc::new(Mutex::new(HashMap::new())),
        };
        Self {
            directory,
            workspace,
            original,
            host,
            adapter,
        }
    }

    fn context(&self) -> TaskRunContext {
        let mut context = context(&self.workspace);
        context.runtime_id = "acp".into();
        context.agent_id = "fixture-task-agent".into();
        context
    }

    fn saved_events(&self, session_id: &str) -> Vec<crate::acp::AcpEvent> {
        let mut after = 0;
        let mut events = Vec::new();
        loop {
            let page = self.adapter.runtime.events(session_id, after, 256).unwrap();
            if let Some(last) = page.events.last() {
                after = last.sequence;
            }
            events.extend(page.events);
            if !page.has_more {
                return events;
            }
        }
    }

    async fn assert_cleaned(&self) {
        assert!(lock(&self.adapter.tokens).is_empty());
        self.host.bridge.assert_closed().await;
        let temporary = self.directory.path().join("acp/task-temp");
        bounded_wait(|| {
            !temporary.exists() || std::fs::read_dir(&temporary).unwrap().next().is_none()
        })
        .await;
        #[cfg(target_os = "macos")]
        {
            let pid = std::fs::read_to_string(self.workspace.join("analysis/agent.pid"))
                .unwrap()
                .parse::<i32>()
                .unwrap();
            bounded_wait(|| unsafe { libc::kill(pid, 0) } != 0).await;
        }
        assert_eq!(
            std::fs::read_to_string(&self.original).unwrap(),
            "Original manuscript"
        );
    }
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
#[tokio::test]
async fn acp_adapter_runs_confined_tools_and_replays_the_durable_transcript() {
    let fixture = AcpFixture::new("complete").await;
    let (events, sink) = event_log();
    let outcome = tokio::time::timeout(
        Duration::from_secs(20),
        fixture
            .adapter
            .run(fixture.context(), CancellationToken::new(), sink),
    )
    .await
    .unwrap()
    .unwrap();
    assert_eq!(
        outcome.summary,
        (0..300)
            .map(|index| format!("{index},"))
            .collect::<String>()
    );
    assert_eq!(
        (outcome.input_tokens, outcome.output_tokens),
        (Some(11), Some(7))
    );
    assert_eq!(
        std::fs::read_to_string(fixture.workspace.join("analysis/result.md")).unwrap(),
        "Native ACP isolated revision"
    );
    assert_eq!(
        std::fs::read_to_string(fixture.workspace.join("analysis/selected-model")).unwrap(),
        "test"
    );
    assert_eq!(lock(&fixture.host.bridge.calls).len(), 1);
    fixture.assert_cleaned().await;
    let id = outcome.native_session_id.unwrap();
    let saved = fixture.saved_events(&id);
    assert_eq!(
        saved
            .iter()
            .filter(|event| event.kind == "agent_message_chunk")
            .count(),
        300
    );
    assert!(saved
        .iter()
        .any(|event| event.kind == "usage" && event.data["inputTokens"] == 11));
    {
        let transcript = lock(&events);
        assert_eq!(
            transcript
                .iter()
                .filter(|event| matches!(event, TaskRuntimeEvent::Text { .. }))
                .count(),
            300
        );
        assert!(transcript.iter().any(|event|matches!(event,TaskRuntimeEvent::Reasoning{text} if text=="Checking isolated evidence.")));
        assert!(transcript.iter().any(
            |event| matches!(event,TaskRuntimeEvent::Tool{name,..} if name=="Write isolated result")
        ));
    }
    let mut replay = TaskRuntimeOutcome {
        summary: String::new(),
        artifacts: Vec::new(),
        native_session_id: Some(id.clone()),
        input_tokens: None,
        output_tokens: None,
    };
    let mut cursor = 0;
    let mut stop = None;
    let (replayed, sink) = event_log();
    fixture
        .adapter
        .catch_up(&id, &mut cursor, &mut replay, &mut stop, &sink)
        .unwrap();
    assert_eq!(replay.summary, outcome.summary);
    assert_eq!(
        (replay.input_tokens, replay.output_tokens),
        (Some(11), Some(7))
    );
    assert_eq!(stop.as_deref(), Some("end_turn"));
    assert_eq!(cursor, saved.last().unwrap().sequence);
    let event_count = lock(&replayed).len();
    fixture
        .adapter
        .catch_up(&id, &mut cursor, &mut replay, &mut stop, &sink)
        .unwrap();
    assert_eq!(lock(&replayed).len(), event_count);
    let reopened = crate::acp::AcpRuntime::new(fixture.directory.path().join("acp")).unwrap();
    let record = reopened.record(&id).unwrap();
    assert_eq!(record.task_id.as_deref(), Some("task"));
    assert_eq!(record.controls.model_id.as_deref(), Some("test"));
    assert_eq!(
        record.project_path,
        fixture.workspace.canonicalize().unwrap().to_string_lossy()
    );
    assert_eq!(reopened.events(&id, 0, 256).unwrap().events.len(), 256);
    assert_eq!(record.status, crate::acp::SessionStatus::Disconnected);
    reopened.shutdown_all().await;
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
#[tokio::test]
async fn acp_adapter_rejects_incomplete_and_failed_turns_but_keeps_the_transcript() {
    for (scenario, expected, stop) in [
        ("length", "max_tokens", "max_tokens"),
        (
            "error",
            "The agent could not complete this request.",
            "error",
        ),
    ] {
        let fixture = AcpFixture::new(scenario).await;
        let error = tokio::time::timeout(
            Duration::from_secs(15),
            fixture
                .adapter
                .run(fixture.context(), CancellationToken::new(), event_log().1),
        )
        .await
        .unwrap()
        .unwrap_err();
        assert!(error.contains(expected), "{error}");
        assert!(!error.contains("fixture task failed"));
        fixture.assert_cleaned().await;
        let sessions = fixture.adapter.runtime.list("project").unwrap();
        assert_eq!(sessions.len(), 1);
        let saved = fixture.saved_events(&sessions[0].id);
        assert!(saved
            .iter()
            .any(|event| event.kind == "turn_complete" && event.data["stopReason"] == stop));
        assert!(saved
            .iter()
            .any(|event| event.kind == "agent_message_chunk"));
        assert!(!saved
            .iter()
            .any(|event| event.kind == "usage" && event.data["source"] == "acp_prompt"));
    }
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
#[tokio::test]
async fn acp_adapter_cancellation_stops_child_writes_before_returning() {
    let fixture = AcpFixture::new("hang").await;
    let run = tokio::spawn(fixture.adapter.run(
        fixture.context(),
        CancellationToken::new(),
        event_log().1,
    ));
    let heartbeat = fixture.workspace.join("analysis/heartbeat");
    bounded_wait(|| {
        std::fs::read_to_string(&heartbeat).is_ok_and(|text| text.lines().count() >= 3)
    })
    .await;
    tokio::time::timeout(
        Duration::from_secs(5),
        fixture.adapter.cancel("session".into()),
    )
    .await
    .unwrap()
    .unwrap();
    let error = run.await.unwrap().unwrap_err();
    assert!(
        error.contains("cancelled") || error.contains("disconnected"),
        "{error}"
    );
    fixture.assert_cleaned().await;
    let settled = std::fs::read(&heartbeat).unwrap();
    tokio::time::sleep(Duration::from_millis(150)).await;
    assert_eq!(std::fs::read(&heartbeat).unwrap(), settled);
    #[cfg(target_os = "macos")]
    {
        let child = std::fs::read_to_string(fixture.workspace.join("analysis/child.pid"))
            .unwrap()
            .parse::<i32>()
            .unwrap();
        bounded_wait(|| unsafe { libc::kill(child, 0) } != 0).await;
    }
    let sessions = fixture.adapter.runtime.list("project").unwrap();
    assert_eq!(sessions[0].status, crate::acp::SessionStatus::Cancelled);
}

#[tokio::test]
async fn acp_adapter_cancel_during_bridge_preparation_prevents_native_start() {
    let root = tempfile::tempdir().unwrap();
    let gate = Arc::new(tokio::sync::Semaphore::new(0));
    let host = Arc::new(FixtureHost {
        usage_root: root.path().join("usage"),
        provider_url: String::new(),
        bridge: LoopbackBridge::start().await,
        preparations: Mutex::new(Vec::new()),
        bridge_gate: Some(gate.clone()),
        bridge_started: tokio::sync::Notify::new(),
    });
    let runtime = crate::acp::AcpRuntime::new(root.path().join("acp")).unwrap();
    let adapter = AcpTaskAdapter {
        host: host.clone(),
        runtime: runtime.clone(),
        tokens: Arc::new(Mutex::new(HashMap::new())),
    };
    let run = tokio::spawn(adapter.run(
        context(root.path()),
        CancellationToken::new(),
        event_log().1,
    ));
    tokio::time::timeout(Duration::from_secs(5), host.bridge_started.notified())
        .await
        .unwrap();
    let cancellation = tokio::spawn(adapter.cancel("session".into()));
    bounded_wait(|| {
        lock(&adapter.tokens)
            .get("session")
            .is_some_and(|active| active.token.is_cancelled())
    })
    .await;
    assert!(!cancellation.is_finished());
    gate.add_permits(1);
    tokio::time::timeout(Duration::from_secs(5), cancellation)
        .await
        .unwrap()
        .unwrap()
        .unwrap();
    assert!(run.await.unwrap().unwrap_err().contains("cancelled"));
    assert!(runtime.list("project").unwrap().is_empty());
    assert!(!root.path().join("acp/task-temp").exists());
    assert!(lock(&adapter.tokens).is_empty());
    host.bridge.assert_closed().await;
}
