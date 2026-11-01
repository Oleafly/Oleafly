use std::collections::{BTreeSet, HashMap};
use std::future::Future;
use std::ops::ControlFlow;
use std::path::{Path, PathBuf};
use std::pin::Pin;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;

use oleafly_agent::tools::registry::{ParallelPolicy, RegisteredTool, ToolRegistry};
use oleafly_agent::{
    AgentEvent, CancellationToken, CompletionRequest, Message, RunConfig, ToolOutput, ToolPipeline,
    ToolRunner, ToolSchema,
};
use serde_json::{json, Value};

use crate::approvals::gate;
use crate::budget::{BudgetKind, WRAP_UP_LIMIT, WRAP_UP_STEPS};
use crate::conversation::{self, ConversationSnapshot, CONVERSATION_VERSION};
use crate::host::{ConnectorSecrets, NoSecrets};
use crate::literature::paper::PdfTextExtractor;
use crate::literature::{LiteratureClient, LiteratureSource};
use crate::model::{
    ApprovalKind, SuspendState, TaskPhase, TaskRunContext, TaskRuntimeEvent, TaskRuntimeOutcome,
    ToolPhase,
};
use crate::prompt::{resume_message, task_prompt, wake_up_message, wrap_up_message};
use crate::runs::{RunSummary, WAIT_MAX};
use crate::scheduler::{TaskEventSink, TaskRuntimeAdapter, TaskRuntimeFuture, TaskServices};
use crate::task_tools::extra::{
    call_task_tool, task_tool_policy, task_tool_schemas, TaskBinding, PLAN_NO_RUNS, SPAWN_AGENT,
};
use crate::task_tools::{
    bounded, file_tool_schemas, lock, text_argument, CommandContext, CommandJobs, TaskFiles,
    MAX_OUTPUT_BYTES,
};

type TokenCounts = (Option<u64>, Option<u64>);

#[cfg(not(test))]
const TASK_MAX_STEPS: u32 = 2_000;
#[cfg(test)]
const TASK_MAX_STEPS: u32 = 50;
const MAX_WAKE_UPS: u32 = 200;
const DEFAULT_TURN_LIMIT: Duration = Duration::from_secs(2 * 60 * 60);
const CHILD_MAX_STEPS: u32 = 40;
const CHILDREN_AT_ONCE: usize = 3;
#[cfg(not(test))]
const WRAP_UP_WATCH: Duration = Duration::from_secs(2);
#[cfg(test)]
const WRAP_UP_WATCH: Duration = Duration::from_millis(20);

enum Waited {
    Nothing,
    Finished(Vec<RunSummary>),
    Suspended,
}

#[derive(Clone)]
pub struct BuiltinTaskAdapter {
    host: Arc<dyn TaskHost>,
    services: TaskServices,
    pub(crate) tokens: Arc<Mutex<HashMap<String, ActiveTaskRun>>>,
}

impl BuiltinTaskAdapter {
    pub fn new(host: Arc<dyn TaskHost>, services: TaskServices) -> Self {
        Self {
            host,
            services,
            tokens: Arc::new(Mutex::new(HashMap::new())),
        }
    }
}

pub struct TaskProvider {
    pub client: reqwest::Client,
    pub resolved: oleafly_agent::Resolved,
    pub usage: Box<dyn UsageSink>,
}

pub trait UsageSink: Send + Sync {
    fn observe(&self, event: &AgentEvent);
    fn finish(&self, status: &str);
}

pub trait TaskBridge: Send + Sync {
    fn mcp_server(&self) -> Value;
    fn call_tool(self: Arc<Self>, name: String, args: Value) -> TaskRuntimeFuture<Value>;
    fn shutdown(self: Arc<Self>) -> Pin<Box<dyn Future<Output = ()> + Send>>;
    fn mcp_servers(&self) -> Vec<Value> {
        vec![self.mcp_server()]
    }
    fn tool_definitions(&self) -> Vec<crate::mcp::protocol::ToolMeta> {
        crate::mcp::tool_definitions()
    }
}

pub const DESKTOP_APPS_TOOL: &str = "desktop_apps";

fn mcp_output(result: &Value) -> ToolOutput {
    let mut texts = Vec::new();
    let mut images = Vec::new();
    for part in result["content"].as_array().into_iter().flatten() {
        match part["type"].as_str() {
            Some("text") => texts.push(part["text"].as_str().unwrap_or_default().to_string()),
            Some("image") => {
                if let (Some(mime), Some(data)) = (part["mimeType"].as_str(), part["data"].as_str())
                {
                    images.push(format!("data:{mime};base64,{data}"));
                }
            }
            _ => {}
        }
    }
    let text = texts.join("\n");
    ToolOutput {
        output: if result["isError"].as_bool() == Some(true) {
            json!({"error": text}).to_string()
        } else {
            text
        },
        images,
    }
}

#[async_trait::async_trait]
pub trait WebTools: Send + Sync {
    async fn fetch(&self, url: &str) -> Result<Value, String>;
    async fn search(&self, query: &str) -> Result<Value, String>;
}

#[derive(Clone)]
pub struct TaskMcpTool {
    pub schema: ToolSchema,
    pub call: Arc<dyn Fn(Value) -> TaskRuntimeFuture<Value> + Send + Sync>,
}

fn shared_literature() -> Arc<LiteratureClient> {
    static CLIENT: OnceLock<Arc<LiteratureClient>> = OnceLock::new();
    CLIENT
        .get_or_init(|| {
            LiteratureClient::new(std::env::temp_dir().join("oleafly-literature-cache.sqlite3"))
        })
        .clone()
}

pub trait TaskHost: Send + Sync {
    fn skills(&self, context: &TaskRunContext) -> Result<String, String>;
    fn skill_read_paths(&self, context: &TaskRunContext) -> Vec<PathBuf>;
    fn provider(&self, context: TaskRunContext) -> TaskRuntimeFuture<TaskProvider>;
    fn bridge(
        &self,
        context: TaskRunContext,
        binding: Option<TaskBinding>,
    ) -> TaskRuntimeFuture<Arc<dyn TaskBridge>>;
    fn linked_folders(
        &self,
        _context: &TaskRunContext,
    ) -> Vec<oleafly_sandbox::profile::LinkedFolder> {
        Vec::new()
    }
    fn program_search_dirs(&self) -> Vec<PathBuf> {
        std::env::var_os("PATH")
            .map(|path| std::env::split_paths(&path).collect())
            .unwrap_or_default()
    }
    fn project_root(&self, _project_id: &str) -> Option<PathBuf> {
        None
    }
    fn linked_root(&self, _project_id: &str, _root_id: &str) -> Option<PathBuf> {
        None
    }
    fn web(&self) -> Option<Arc<dyn WebTools>> {
        None
    }
    fn task_mcp_tools(&self, _context: &TaskRunContext) -> TaskRuntimeFuture<Vec<TaskMcpTool>> {
        Box::pin(async { Ok(Vec::new()) })
    }
    fn task_mcp_servers(&self, _context: &TaskRunContext) -> Vec<Value> {
        Vec::new()
    }
    fn literature(&self) -> Arc<LiteratureClient> {
        shared_literature()
    }
    fn secrets(&self) -> Arc<dyn ConnectorSecrets> {
        Arc::new(NoSecrets)
    }
    fn literature_sources(&self) -> Vec<Arc<dyn LiteratureSource>> {
        Vec::new()
    }
    fn pdf_extractor(&self) -> Option<Arc<dyn PdfTextExtractor>> {
        None
    }
}

#[derive(Clone)]
pub struct ActiveTaskRun {
    pub token: CancellationToken,
    pub done: tokio::sync::watch::Receiver<bool>,
}

pub struct ActiveToken {
    pub sessions: Arc<Mutex<HashMap<String, ActiveTaskRun>>>,
    pub session_id: String,
    pub token: CancellationToken,
    pub done: tokio::sync::watch::Sender<bool>,
}

impl Drop for ActiveToken {
    fn drop(&mut self) {
        self.token.cancel();
        lock(&self.sessions).remove(&self.session_id);
        let _ = self.done.send(true);
    }
}

fn output(result: Result<Value, String>) -> ToolOutput {
    ToolOutput::text(match result {
        Ok(value) => value.to_string(),
        Err(error) => json!({"error": error}).to_string(),
    })
}

struct ToolScope {
    files: Arc<TaskFiles>,
    jobs: Arc<CommandJobs>,
    command: CommandContext,
    bridge: Arc<dyn TaskBridge>,
    binding: TaskBinding,
    mcp: Arc<HashMap<String, TaskMcpTool>>,
    names: Arc<BTreeSet<String>>,
    plan_phase: bool,
    children: Arc<tokio::sync::Semaphore>,
    provider: Arc<(reqwest::Client, oleafly_agent::Resolved)>,
    usage: Arc<dyn Fn(&AgentEvent) + Send + Sync>,
}

impl ToolScope {
    async fn call(
        self: Arc<Self>,
        name: String,
        arguments: String,
        token: CancellationToken,
    ) -> ToolOutput {
        if name == DESKTOP_APPS_TOOL && self.names.contains(&name) && !token.is_cancelled() {
            let Ok(args) = serde_json::from_str::<Value>(&arguments) else {
                return output(Err("Tool arguments must be valid JSON.".into()));
            };
            let call = self.bridge.clone().call_tool(name, args);
            return tokio::select! {
                _ = token.cancelled() => output(Err("The task was cancelled.".into())),
                result = call => match result {
                    Ok(result) => mcp_output(&result),
                    Err(error) => output(Err(error)),
                },
            };
        }
        let result = async {
            if token.is_cancelled() {
                return Err("The task was cancelled.".to_string());
            }
            if !self.names.contains(&name) {
                return Err("This tool is unavailable in research tasks.".into());
            }
            let args: Value = serde_json::from_str(&arguments)
                .map_err(|_| "Tool arguments must be valid JSON.".to_string())?;
            match name.as_str() {
                "read_file" => self.files.read_window(
                    text_argument(&args, "path")?,
                    args["offset"].as_u64().unwrap_or(0) as usize,
                    args["limit"].as_u64().unwrap_or(MAX_OUTPUT_BYTES as u64) as usize,
                ),
                "write_file" => self.files.write(
                    text_argument(&args, "path")?,
                    text_argument(&args, "content")?,
                ),
                "list_files" => self
                    .files
                    .list(args["path"].as_str().unwrap_or(""))
                    .map(|(files, truncated)| json!({"files": files, "truncated": truncated})),
                "search_project" => self.files.search(text_argument(&args, "query")?),
                "run_command" => {
                    let command = text_argument(&args, "command")?.to_owned();
                    gate(
                        &self.binding.services,
                        &self.binding.gate_context(),
                        ApprovalKind::Command,
                        "Run a command",
                        &command,
                        &token,
                    )
                    .await?;
                    self.jobs.run(self.command.clone(), command, token).await
                }
                "start_run" | "wait_runs" if self.plan_phase => Err(PLAN_NO_RUNS.into()),
                SPAWN_AGENT => spawn_child(self.clone(), &args, &token).await,
                name if self.mcp.contains_key(name) => {
                    let tool = &self.mcp[name];
                    gate(
                        &self.binding.services,
                        &self.binding.gate_context(),
                        ApprovalKind::Mcp,
                        &format!("Use {name}"),
                        &args.to_string(),
                        &token,
                    )
                    .await?;
                    (tool.call)(args).await
                }
                name => match call_task_tool(name, args.clone(), &self.binding).await {
                    Some(result) => result,
                    None => self.bridge.clone().call_tool(name.into(), args).await,
                },
            }
        }
        .await;
        output(result)
    }
}

fn tool_runner(scope: &Arc<ToolScope>, token: &CancellationToken) -> ToolRunner {
    let (scope, token) = (scope.clone(), token.clone());
    Arc::new(move |call| {
        let (scope, token) = (scope.clone(), token.clone());
        Box::pin(async move { scope.call(call.name, call.arguments, token).await })
    })
}

async fn spawn_child(
    scope: Arc<ToolScope>,
    args: &Value,
    token: &CancellationToken,
) -> Result<Value, String> {
    let brief = text_argument(args, "brief")?.trim().to_owned();
    if brief.is_empty() || brief.chars().count() > 4_000 {
        return Err("Give the helper a brief of up to 4,000 characters.".into());
    }
    let paths: Vec<String> = args["paths"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .take(50)
        .map(str::to_owned)
        .collect();
    let minutes = args["max_minutes"].as_u64().unwrap_or(10).clamp(1, 20);
    let _slot =
        scope.children.clone().try_acquire_owned().map_err(|_| {
            "Three helpers are already working. Wait for one to finish.".to_string()
        })?;
    let record = scope.binding.record_dir.clone();
    let writable = Arc::new(TaskFiles::open(
        &scope.binding.execution_root,
        std::slice::from_ref(&record),
    )?);
    let wrote = Arc::new(Mutex::new(BTreeSet::new()));
    let child_token = token.child();
    let mut tools: Vec<ToolSchema> = file_tool_schemas(false)
        .into_iter()
        .filter(|tool| tool.name != "run_command")
        .collect();
    tools.extend(
        task_tool_schemas(&scope.binding.brief, false)
            .into_iter()
            .filter(|tool| tool.name == "literature_search" || tool.name == "read_paper"),
    );
    let names: BTreeSet<String> = tools.iter().map(|tool| tool.name.clone()).collect();
    let mut request = CompletionRequest::prompt(
        format!(
            "You help a research task with one job. Work only with the tools you have. You may read the project; write only inside {record}/. Finish with a short summary of what you found and which files you wrote."
        ),
        if paths.is_empty() {
            brief
        } else {
            format!("{brief}\n\nStart with: {}", paths.join(", "))
        },
    );
    request.tools = tools;
    let runner_scope = scope.clone();
    let runner_writable = writable.clone();
    let runner_wrote = wrote.clone();
    let runner_token = child_token.clone();
    let runner: ToolRunner = Arc::new(move |call| {
        let scope = runner_scope.clone();
        let writable = runner_writable.clone();
        let wrote = runner_wrote.clone();
        let token = runner_token.clone();
        let allowed = names.contains(&call.name);
        Box::pin(async move {
            let result = async {
                if token.is_cancelled() {
                    return Err("The helper was stopped.".to_string());
                }
                if !allowed {
                    return Err("This tool is unavailable to helpers.".into());
                }
                let args: Value = serde_json::from_str(&call.arguments)
                    .map_err(|_| "Tool arguments must be valid JSON.".to_string())?;
                match call.name.as_str() {
                    "read_file" => scope.files.read_window(
                        text_argument(&args, "path")?,
                        args["offset"].as_u64().unwrap_or(0) as usize,
                        args["limit"].as_u64().unwrap_or(MAX_OUTPUT_BYTES as u64) as usize,
                    ),
                    "write_file" => {
                        let path = text_argument(&args, "path")?;
                        let saved = writable.write(path, text_argument(&args, "content")?)?;
                        lock(&wrote).insert(path.to_owned());
                        Ok(saved)
                    }
                    "list_files" => scope
                        .files
                        .list(args["path"].as_str().unwrap_or(""))
                        .map(|(files, truncated)| json!({"files": files, "truncated": truncated})),
                    "search_project" => scope.files.search(text_argument(&args, "query")?),
                    name => call_task_tool(name, args, &scope.binding)
                        .await
                        .unwrap_or_else(|| Err("This tool is unavailable to helpers.".into())),
                }
            }
            .await;
            output(result)
        })
    });
    let (client, resolved) = (&scope.provider.0, &scope.provider.1);
    let usage = scope.usage.clone();
    let outcome = oleafly_agent::run_agent_with_pipeline(
        client,
        resolved,
        request,
        &RunConfig {
            max_steps: CHILD_MAX_STEPS,
            max_duration_ms: Some(minutes * 60 * 1000),
            ..RunConfig::default()
        },
        ToolPipeline {
            token: child_token.clone(),
            ..ToolPipeline::default()
        },
        None,
        runner,
        move |event| usage(&event),
    )
    .await
    .map_err(|error| format!("The helper stopped: {error}"))?;
    child_token.cancel();
    let wrote: Vec<String> = lock(&wrote).iter().cloned().collect();
    Ok(json!({"summary": outcome.text, "wrote": wrote}))
}

fn registry(names: &BTreeSet<String>, mcp: &HashMap<String, TaskMcpTool>) -> ToolRegistry {
    let mut registry = ToolRegistry::new(false);
    for name in names {
        let tool = match name.as_str() {
            "read_file" | "list_files" | "search_project" => RegisteredTool::parallel(),
            "write_file" | "run_command" => RegisteredTool::exclusive(),
            DESKTOP_APPS_TOOL => RegisteredTool::exclusive(),
            name if mcp.contains_key(name) => RegisteredTool::exclusive(),
            name => match task_tool_policy(name) {
                ParallelPolicy::Parallel => RegisteredTool::parallel(),
                ParallelPolicy::Exclusive => RegisteredTool::exclusive(),
                ParallelPolicy::Unguarded => RegisteredTool::unguarded(),
            },
        };
        registry.register_trusted(name, tool);
    }
    registry
}

fn watch_time(
    services: &TaskServices,
    task_id: &str,
    turn: CancellationToken,
) -> tokio::task::JoinHandle<()> {
    let clock = services.clocks.get(task_id);
    tokio::spawn(async move {
        let Some(clock) = clock else {
            return;
        };
        loop {
            tokio::time::sleep(WRAP_UP_WATCH).await;
            if turn.is_cancelled() {
                return;
            }
            if clock.exhausted() == Some(BudgetKind::Time) {
                turn.cancel();
                return;
            }
        }
    })
}

impl BuiltinTaskAdapter {
    fn turn_limit(&self, task_id: &str) -> Duration {
        self.services
            .clocks
            .get(task_id)
            .map(|clock| clock.remaining() + Duration::from_secs(60))
            .unwrap_or(DEFAULT_TURN_LIMIT)
    }

    fn time_ran_out(&self, task_id: &str) -> bool {
        self.services
            .clocks
            .get(task_id)
            .is_some_and(|clock| clock.exhausted() == Some(BudgetKind::Time))
    }

    async fn wait_for_runs(
        &self,
        context: &TaskRunContext,
        events: &TaskEventSink,
        cancel: &CancellationToken,
        suspend: &CancellationToken,
    ) -> Result<Waited, String> {
        let runs = &self.services.runs;
        if runs.in_flight(&context.task_id)?.is_empty()
            && runs.unreported(&context.task_id)?.is_empty()
        {
            return Ok(Waited::Nothing);
        }
        if suspend.is_cancelled() {
            return Ok(Waited::Suspended);
        }
        events(TaskRuntimeEvent::Phase {
            phase: TaskPhase::WaitingRuns,
        });
        let stop = cancel.child();
        let relay = {
            let (suspend, stop) = (suspend.clone(), stop.clone());
            tokio::spawn(async move {
                suspend.cancelled().await;
                stop.cancel();
            })
        };
        let watcher = watch_time(&self.services, &context.task_id, stop.clone());
        let waited = loop {
            if self.time_ran_out(&context.task_id) {
                break Ok(Waited::Finished(Vec::new()));
            }
            match runs.wait(&context.task_id, None, WAIT_MAX, &stop).await {
                Ok(outcome) if !outcome.finished.is_empty() => {
                    break Ok(Waited::Finished(outcome.finished))
                }
                Ok(outcome) if outcome.still_running.is_empty() => {
                    break Ok(Waited::Finished(Vec::new()))
                }
                Ok(_) => {}
                Err(_) if suspend.is_cancelled() && !cancel.is_cancelled() => {
                    break Ok(Waited::Suspended)
                }
                Err(_) if self.time_ran_out(&context.task_id) && !cancel.is_cancelled() => {
                    break Ok(Waited::Finished(Vec::new()))
                }
                Err(error) => break Err(error),
            }
        };
        relay.abort();
        watcher.abort();
        events(TaskRuntimeEvent::Phase {
            phase: TaskPhase::Working,
        });
        waited
    }

    async fn save_conversation(
        &self,
        context: &TaskRunContext,
        resolved: &oleafly_agent::Resolved,
        messages: Vec<Message>,
        waiting_for_runs: bool,
    ) -> Result<String, String> {
        let root = self.services.tasks_root.clone();
        let snapshot = ConversationSnapshot {
            version: CONVERSATION_VERSION,
            task_id: context.task_id.clone(),
            generation: context.execution_generation,
            provider_id: resolved.provider_id.clone(),
            model_id: resolved.model_id.clone(),
            messages,
            waiting_for_runs,
            saved_at: crate::model::now_ms(),
        };
        tokio::task::spawn_blocking(move || conversation::save(&root, &snapshot))
            .await
            .map_err(|error| format!("The conversation could not be saved: {error}"))?
    }

    fn restored_conversation(
        &self,
        context: &TaskRunContext,
        resolved: &oleafly_agent::Resolved,
        events: &TaskEventSink,
    ) -> Option<ConversationSnapshot> {
        let handoff = context.handoff.as_ref()?;
        let file = handoff.conversation.as_deref()?;
        match conversation::load(
            &self.services.tasks_root,
            &context.task_id,
            file,
            handoff.from_generation,
            &resolved.provider_id,
            &resolved.model_id,
        ) {
            Ok(snapshot) => Some(snapshot),
            Err(_) => {
                events(TaskRuntimeEvent::Status {
                    message: "Continued from the saved notes because the conversation could not be restored.".into(),
                });
                None
            }
        }
    }

    async fn run_task(
        &self,
        context: TaskRunContext,
        cancel: CancellationToken,
        events: TaskEventSink,
    ) -> Result<TaskRuntimeOutcome, String> {
        let root = PathBuf::from(&context.execution_root);
        let files = Arc::new(TaskFiles::open(
            Path::new(&context.execution_root),
            &context.allowed_paths,
        )?);
        let skills = self.host.skills(&context)?;
        let read_paths = self.host.skill_read_paths(&context);
        let linked_roots = self.host.linked_folders(&context);
        let search_dirs = self.host.program_search_dirs();
        let project_root = self.host.project_root(&context.project_id);
        let home = oleafly_sandbox::profile::task_home(&self.services.tasks_root, &context.task_id);
        let brief = context.brief.clone();
        let network = brief.permissions.network;
        let TaskProvider {
            client,
            resolved,
            usage,
        } = self.host.provider(context.clone()).await?;
        let usage: Arc<dyn UsageSink> = Arc::from(usage);
        let binding = TaskBinding {
            task_id: context.task_id.clone(),
            project_id: context.project_id.clone(),
            task_title: context.title.clone(),
            generation: context.execution_generation,
            brief: brief.clone(),
            record_dir: context.record_dir.clone(),
            execution_root: root.clone(),
            allowed_paths: context.allowed_paths.clone(),
            read_paths: read_paths.clone(),
            linked_roots: linked_roots.clone(),
            search_dirs: search_dirs.clone(),
            project_root: project_root.clone(),
            services: self.services.clone(),
            host: self.host.clone(),
            events: Some(events.clone()),
            cancel: cancel.clone(),
        };
        let bridge = self
            .host
            .bridge(context.clone(), Some(binding.clone()))
            .await?;
        let mcp_tools = self.host.task_mcp_tools(&context).await.unwrap_or_default();
        let mut tools = file_tool_schemas(network);
        tools.extend(task_tool_schemas(&brief, self.host.web().is_some()));
        let reserved: BTreeSet<String> = tools.iter().map(|tool| tool.name.clone()).collect();
        tools.extend(
            bridge
                .tool_definitions()
                .into_iter()
                .filter(|tool| !reserved.contains(&tool.name))
                .map(|tool| ToolSchema {
                    name: tool.name,
                    description: tool.description,
                    input_schema: tool.input_schema,
                }),
        );
        let mut mcp = HashMap::new();
        for tool in mcp_tools {
            if !tools
                .iter()
                .any(|existing| existing.name == tool.schema.name)
            {
                tools.push(tool.schema.clone());
                mcp.insert(tool.schema.name.clone(), tool);
            }
        }
        let names: BTreeSet<String> = tools.iter().map(|tool| tool.name.clone()).collect();
        let tool_registry = registry(&names, &mcp);
        let jobs = Arc::new(CommandJobs::default());
        let usage_sink = usage.clone();
        let scope = Arc::new(ToolScope {
            files,
            jobs: jobs.clone(),
            command: CommandContext {
                execution_root: context.execution_root.clone(),
                allowed_paths: context.allowed_paths.clone(),
                read_paths,
                network,
                owner: format!("task:{}", context.task_id),
                project: Some(context.project_id.clone()),
                home: Some(home),
                linked: linked_roots,
                search_dirs,
                project_root,
                data_root: self
                    .services
                    .tasks_root
                    .parent()
                    .map(std::path::Path::to_path_buf),
            },
            bridge: bridge.clone(),
            binding,
            mcp: Arc::new(mcp),
            names: Arc::new(names),
            plan_phase: context.plan_phase,
            children: Arc::new(tokio::sync::Semaphore::new(CHILDREN_AT_ONCE)),
            provider: Arc::new((client.clone(), resolved.clone())),
            usage: Arc::new(move |event| usage_sink.observe(event)),
        });
        let mut template = CompletionRequest::prompt(task_prompt(&context, &skills), String::new());
        template.tools = tools;
        let suspend = self.services.suspends.token(&context.task_id);
        let restored = self.restored_conversation(&context, &resolved, &events);
        let summary = restored
            .as_ref()
            .map(|snapshot| conversation::last_assistant_text(&snapshot.messages))
            .unwrap_or_default();
        let (messages, mut wait_first) = match restored {
            Some(snapshot) => (snapshot.messages, snapshot.waiting_for_runs),
            None => (vec![Message::user(first_message(&context))], false),
        };
        events(TaskRuntimeEvent::SessionBound {
            native_session_id: context.session_id.clone(),
        });
        let observed_usage = Arc::new(Mutex::new(None));
        let mut turns = TurnLoop {
            adapter: self,
            context: &context,
            cancel: &cancel,
            suspend: &suspend,
            events: &events,
            client: &client,
            resolved: &resolved,
            template: &template,
            registry: &tool_registry,
            scope: &scope,
            usage: &usage,
            observed: &observed_usage,
            messages,
            summary,
            wake_ups: 0,
            wrap_up: false,
        };
        let result: Result<Option<String>, String> = loop {
            if !wait_first {
                if let ControlFlow::Break(result) = turns.working_turn().await {
                    break result;
                }
            }
            wait_first = false;
            if let ControlFlow::Break(result) = turns.wait_and_wake().await {
                break result;
            }
        };
        if turns.wrap_up && matches!(result, Ok(None)) && !cancel.is_cancelled() {
            turns.wrap_up_turn().await;
        }
        let summary = turns.summary;
        let was_cancelled = cancel.is_cancelled();
        cancel.cancel();
        jobs.finish().await;
        bridge.shutdown().await;
        let observed = *lock(&observed_usage);
        let outcome = |summary: String| TaskRuntimeOutcome {
            summary,
            artifacts: Vec::new(),
            native_session_id: Some(context.session_id.clone()),
            input_tokens: observed.and_then(|usage: TokenCounts| usage.0),
            output_tokens: observed.and_then(|usage: TokenCounts| usage.1),
        };
        match result {
            Ok(Some(file)) => {
                usage.finish("interrupted");
                self.services.suspends.record(
                    &context.task_id,
                    SuspendState {
                        conversation: Some(file),
                        turn_interrupted: false,
                        acp: None,
                    },
                );
                Ok(outcome(String::new()))
            }
            Ok(None) => {
                usage.finish("completed");
                Ok(outcome(summary))
            }
            Err(error) => {
                usage.finish(if was_cancelled { "cancelled" } else { "failed" });
                Err(error)
            }
        }
    }

    #[allow(clippy::too_many_arguments)]
    async fn agent_turn(
        &self,
        client: &reqwest::Client,
        resolved: &oleafly_agent::Resolved,
        request: CompletionRequest,
        config: RunConfig,
        registry: &ToolRegistry,
        token: &CancellationToken,
        suspend: Option<&CancellationToken>,
        runner: ToolRunner,
        events: &TaskEventSink,
        usage: &Arc<dyn UsageSink>,
        observed: &Arc<Mutex<Option<TokenCounts>>>,
    ) -> Result<oleafly_agent::RunOutcome, String> {
        oleafly_agent::run_agent_with_pipeline(
            client,
            resolved,
            request,
            &config,
            ToolPipeline {
                token: token.clone(),
                suspend: suspend.cloned(),
                ..ToolPipeline::from_registry(registry.clone())
            },
            None,
            runner,
            |event| {
                if let AgentEvent::Usage { usage, .. } = &event {
                    *lock(observed) = Some((
                        usage.reported_input().map(u64::from),
                        usage.reported_output().map(u64::from),
                    ));
                }
                usage.observe(&event);
                if let Some(event) = builtin_event(event) {
                    events(event);
                }
            },
        )
        .await
        .map_err(|error| error.to_string())
    }
}

fn first_message(context: &TaskRunContext) -> String {
    match &context.resume {
        Some(resume) => {
            let message = resume_message(resume, &context.record_dir);
            if context
                .handoff
                .as_ref()
                .is_some_and(|handoff| handoff.turn_interrupted)
            {
                format!("Your previous turn was interrupted. {message}")
            } else {
                message
            }
        }
        None => context.prompt.clone(),
    }
}

type LoopStep = ControlFlow<Result<Option<String>, String>>;

struct TurnLoop<'a> {
    adapter: &'a BuiltinTaskAdapter,
    context: &'a TaskRunContext,
    cancel: &'a CancellationToken,
    suspend: &'a CancellationToken,
    events: &'a TaskEventSink,
    client: &'a reqwest::Client,
    resolved: &'a oleafly_agent::Resolved,
    template: &'a CompletionRequest,
    registry: &'a ToolRegistry,
    scope: &'a Arc<ToolScope>,
    usage: &'a Arc<dyn UsageSink>,
    observed: &'a Arc<Mutex<Option<TokenCounts>>>,
    messages: Vec<Message>,
    summary: String,
    wake_ups: u32,
    wrap_up: bool,
}

impl TurnLoop<'_> {
    async fn working_turn(&mut self) -> LoopStep {
        let adapter = self.adapter;
        let context = self.context;
        let turn = self.cancel.child();
        let watcher = watch_time(&adapter.services, &context.task_id, turn.clone());
        let runner = tool_runner(self.scope, &turn);
        let mut request = self.template.clone();
        request.messages = self.messages.clone();
        let outcome = adapter
            .agent_turn(
                self.client,
                self.resolved,
                request,
                RunConfig {
                    max_steps: TASK_MAX_STEPS,
                    allow_long_runs: true,
                    max_duration_ms: Some(adapter.turn_limit(&context.task_id).as_millis() as u64),
                    ..RunConfig::default()
                },
                self.registry,
                &turn,
                Some(self.suspend),
                runner,
                self.events,
                self.usage,
                self.observed,
            )
            .await;
        watcher.abort();
        if self.cancel.is_cancelled() {
            return ControlFlow::Break(Err("The task was cancelled.".into()));
        }
        if let Ok(outcome) = &outcome {
            if outcome.suspended {
                return ControlFlow::Break(
                    adapter
                        .save_conversation(context, self.resolved, outcome.history.clone(), false)
                        .await
                        .map(Some),
                );
            }
        }
        if adapter.time_ran_out(&context.task_id) {
            if let Ok(outcome) = &outcome {
                self.messages = outcome.history.clone();
            }
            self.wrap_up = true;
            return ControlFlow::Break(Ok(None));
        }
        let outcome = match outcome {
            Ok(outcome) if outcome.error.is_none() && !outcome.stopped_at_cap => outcome,
            Ok(outcome) => {
                return ControlFlow::Break(Err(outcome.error.unwrap_or_else(|| {
                    "The task reached its step limit before finishing.".into()
                })))
            }
            Err(error) => return ControlFlow::Break(Err(error)),
        };
        self.summary = outcome.text;
        self.messages = outcome.history;
        if context.plan_phase {
            return ControlFlow::Break(Ok(None));
        }
        ControlFlow::Continue(())
    }

    async fn wait_and_wake(&mut self) -> LoopStep {
        let adapter = self.adapter;
        let context = self.context;
        match adapter
            .wait_for_runs(context, self.events, self.cancel, self.suspend)
            .await
        {
            Ok(Waited::Nothing) => ControlFlow::Break(Ok(None)),
            Ok(Waited::Suspended) => ControlFlow::Break(
                adapter
                    .save_conversation(context, self.resolved, self.messages.clone(), true)
                    .await
                    .map(Some),
            ),
            Ok(Waited::Finished(finished)) if finished.is_empty() => {
                self.wrap_up = adapter.time_ran_out(&context.task_id);
                ControlFlow::Break(Ok(None))
            }
            Ok(Waited::Finished(finished)) => {
                if self.wake_ups >= MAX_WAKE_UPS {
                    return ControlFlow::Break(Err(
                        "The task woke up 200 times. Retry it to continue.".into(),
                    ));
                }
                self.wake_ups += 1;
                self.messages
                    .push(Message::user(wake_up_message(&finished)));
                ControlFlow::Continue(())
            }
            Err(error) => ControlFlow::Break(Err(error)),
        }
    }

    async fn wrap_up_turn(&mut self) {
        (self.events)(TaskRuntimeEvent::Phase {
            phase: TaskPhase::WrappingUp,
        });
        self.messages
            .push(Message::user(wrap_up_message(&self.context.record_dir)));
        let mut request = self.template.clone();
        request.messages = self.messages.clone();
        let wrap_token = self.cancel.child();
        let wrapped = self
            .adapter
            .agent_turn(
                self.client,
                self.resolved,
                request,
                RunConfig {
                    max_steps: WRAP_UP_STEPS,
                    allow_long_runs: true,
                    max_duration_ms: Some(WRAP_UP_LIMIT.as_millis() as u64),
                    ..RunConfig::default()
                },
                self.registry,
                &wrap_token,
                None,
                tool_runner(self.scope, &wrap_token),
                self.events,
                self.usage,
                self.observed,
            )
            .await;
        if let Ok(outcome) = wrapped {
            self.summary = outcome.text;
        }
    }
}

impl TaskRuntimeAdapter for BuiltinTaskAdapter {
    fn supports(&self, agent_id: &str) -> bool {
        !agent_id.trim().is_empty()
    }

    fn run(
        &self,
        context: TaskRunContext,
        cancel: CancellationToken,
        events: TaskEventSink,
    ) -> TaskRuntimeFuture<TaskRuntimeOutcome> {
        let adapter = self.clone();
        Box::pin(async move {
            let cancel = cancel.child();
            let (done, receiver) = tokio::sync::watch::channel(false);
            lock(&adapter.tokens).insert(
                context.session_id.clone(),
                ActiveTaskRun {
                    token: cancel.clone(),
                    done: receiver,
                },
            );
            let _active = ActiveToken {
                sessions: adapter.tokens.clone(),
                session_id: context.session_id.clone(),
                token: cancel.clone(),
                done,
            };
            if cancel.is_cancelled() {
                return Err("The task was cancelled.".into());
            }
            adapter.run_task(context, cancel, events).await
        })
    }

    fn cancel(&self, session_id: String) -> TaskRuntimeFuture<()> {
        let tokens = self.tokens.clone();
        Box::pin(async move {
            let active = lock(&tokens).get(&session_id).cloned();
            if let Some(mut active) = active {
                active.token.cancel();
                while !*active.done.borrow_and_update() {
                    if active.done.changed().await.is_err() {
                        break;
                    }
                }
            }
            Ok(())
        })
    }
}

pub fn tool_result_status(output: &str) -> &'static str {
    let Ok(value) = serde_json::from_str::<Value>(output) else {
        return "done";
    };
    let failed = value.get("error").is_some_and(|entry| !entry.is_null())
        || value.get("success") == Some(&Value::Bool(false))
        || value.get("timedOut") == Some(&Value::Bool(true))
        || value.get("timed_out") == Some(&Value::Bool(true));
    if failed {
        "error"
    } else {
        "done"
    }
}

pub fn builtin_event(event: AgentEvent) -> Option<TaskRuntimeEvent> {
    match event {
        AgentEvent::TextDelta { text } => Some(TaskRuntimeEvent::Text { text }),
        AgentEvent::ReasoningDelta { text } => Some(TaskRuntimeEvent::Reasoning { text }),
        AgentEvent::ToolRequest {
            id,
            name,
            arguments,
        } => Some(TaskRuntimeEvent::Tool {
            call_id: Some(id),
            name,
            phase: ToolPhase::Request,
            detail: arguments,
            status: Some("running".into()),
        }),
        AgentEvent::ToolCallStart { id, name } => Some(TaskRuntimeEvent::Tool {
            call_id: Some(id),
            name,
            phase: ToolPhase::Request,
            detail: String::new(),
            status: Some("running".into()),
        }),
        AgentEvent::ToolCallEnd { id, arguments } => Some(TaskRuntimeEvent::Tool {
            call_id: Some(id),
            name: String::new(),
            phase: ToolPhase::Update,
            detail: bounded(&arguments, MAX_OUTPUT_BYTES),
            status: Some("running".into()),
        }),
        AgentEvent::ToolOutcome { id, output } => Some(TaskRuntimeEvent::Tool {
            call_id: Some(id),
            name: String::new(),
            phase: ToolPhase::Result,
            detail: bounded(&output, MAX_OUTPUT_BYTES),
            status: Some(tool_result_status(&output).into()),
        }),
        AgentEvent::Usage { usage, .. } => Some(TaskRuntimeEvent::Usage {
            input_tokens: usage.reported_input().map(u64::from),
            output_tokens: usage.reported_output().map(u64::from),
        }),
        AgentEvent::Error { message, .. } => Some(TaskRuntimeEvent::Status { message }),
        AgentEvent::StepStart { step } => Some(TaskRuntimeEvent::Status {
            message: format!("Working on step {}.", step.saturating_add(1)),
        }),
        _ => None,
    }
}

#[cfg(test)]
mod tests;

#[cfg(test)]
mod handoff_tests;
