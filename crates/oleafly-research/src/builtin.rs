//! The built-in task runtime: Oleafly's own agent loop running a research
//! task with the workspace tools, the task tools and the scoped research MCP
//! bridge. Long work goes to supervised runs; when the agent's turn ends
//! while runs are in flight, it waits for them and is woken with their
//! results.
use std::collections::{BTreeSet, HashMap};
use std::future::Future;
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
// 0.4.8 L: a conversation saved for a handoff.
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
    call_task_tool, task_tool_policy, task_tool_schemas, TaskBinding, SPAWN_AGENT,
};
use crate::task_tools::{
    bounded, file_tool_schemas, lock, text_argument, CommandContext, CommandJobs, TaskFiles,
    MAX_OUTPUT_BYTES,
};

/// Input and output tokens of a run, when the provider reports them.
type TokenCounts = (Option<u64>, Option<u64>);

/// Steps one task turn may take (the run is long by design).
#[cfg(not(test))]
const TASK_MAX_STEPS: u32 = 2_000;
/// The old cap in unit tests, so a test can reach the limit.
#[cfg(test)]
const TASK_MAX_STEPS: u32 = 50;
/// Times a generation may be woken by finished runs.
const MAX_WAKE_UPS: u32 = 200;
/// The longest an agent turn may last without a budget.
const DEFAULT_TURN_LIMIT: Duration = Duration::from_secs(2 * 60 * 60);
const CHILD_MAX_STEPS: u32 = 40;
const CHILDREN_AT_ONCE: usize = 3;
#[cfg(not(test))]
const WRAP_UP_WATCH: Duration = Duration::from_secs(2);
#[cfg(test)]
const WRAP_UP_WATCH: Duration = Duration::from_millis(20);
const PLAN_NO_RUNS: &str = "Write plan.md first. Runs start after the user approves the plan.";

/// How a wait for a task's runs between turns ended.
enum Waited {
    /// Nothing was in flight or left to report.
    Nothing,
    /// These runs finished (empty when the time budget ended).
    Finished(Vec<RunSummary>),
    /// 0.4.8 L: the task is moving to another process; its runs go on.
    Suspended,
}

/// The built-in task agent: Oleafly's own agent loop with the workspace
/// tools and the research MCP bridge.
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

/// The model a run uses, and where its usage is recorded.
pub struct TaskProvider {
    pub client: reqwest::Client,
    pub resolved: oleafly_agent::Resolved,
    pub usage: Box<dyn UsageSink>,
}

/// Records a run's token use (the app writes it to its usage table).
pub trait UsageSink: Send + Sync {
    fn observe(&self, event: &AgentEvent);
    fn finish(&self, status: &str);
}

/// A scoped research MCP bridge a run talks to.
pub trait TaskBridge: Send + Sync {
    fn mcp_server(&self) -> Value;
    fn call_tool(self: Arc<Self>, name: String, args: Value) -> TaskRuntimeFuture<Value>;
    fn shutdown(self: Arc<Self>) -> Pin<Box<dyn Future<Output = ()> + Send>>;
    // 0.4.8 I: a decorator (desktop apps) adds a server and a tool; these
    // defaults keep every other bridge as it was.
    /// Every MCP server a CLI agent run gets from this bridge.
    fn mcp_servers(&self) -> Vec<Value> {
        vec![self.mcp_server()]
    }
    /// The bridge tools a built-in run offers its model.
    fn tool_definitions(&self) -> Vec<crate::mcp::protocol::ToolMeta> {
        crate::mcp::tool_definitions()
    }
}

/// 0.4.8 I: the tool desktop apps add to a task through its bridge.
pub const DESKTOP_APPS_TOOL: &str = "desktop_apps";

/// An MCP tool result as tool output: text parts joined, images kept as
/// data URLs, an error result as `{"error": …}`.
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

/// Web reads for tasks with network permission.
#[async_trait::async_trait]
pub trait WebTools: Send + Sync {
    async fn fetch(&self, url: &str) -> Result<Value, String>;
    async fn search(&self, query: &str) -> Result<Value, String>;
}

/// One tool of a user MCP server a task may call.
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

/// What a run needs from its host: skills, the provider and the bridge.
pub trait TaskHost: Send + Sync {
    fn skills(&self, context: &TaskRunContext) -> Result<String, String>;
    /// The selected skills' folders, readable from task commands. Resolved
    /// once per run.
    fn skill_read_paths(&self, context: &TaskRunContext) -> Vec<PathBuf>;
    fn provider(&self, context: TaskRunContext) -> TaskRuntimeFuture<TaskProvider>;
    /// The research bridge; with a binding it also serves the task tools.
    fn bridge(
        &self,
        context: TaskRunContext,
        binding: Option<TaskBinding>,
    ) -> TaskRuntimeFuture<Arc<dyn TaskBridge>>;
    /// The project's linked data folders (canonical paths).
    fn linked_folders(
        &self,
        _context: &TaskRunContext,
    ) -> Vec<oleafly_sandbox::profile::LinkedFolder> {
        Vec::new()
    }
    /// Folders interpreters are looked for in (the user's search path).
    fn program_search_dirs(&self) -> Vec<PathBuf> {
        std::env::var_os("PATH")
            .map(|path| std::env::split_paths(&path).collect())
            .unwrap_or_default()
    }
    /// The real project folder; its virtual environments stay out of the
    /// task's copy.
    fn project_root(&self, _project_id: &str) -> Option<PathBuf> {
        None
    }
    /// One linked data folder by id.
    fn linked_root(&self, _project_id: &str, _root_id: &str) -> Option<PathBuf> {
        None
    }
    fn web(&self) -> Option<Arc<dyn WebTools>> {
        None
    }
    /// Tools of the user's MCP servers allowed for tasks.
    fn task_mcp_tools(&self, _context: &TaskRunContext) -> TaskRuntimeFuture<Vec<TaskMcpTool>> {
        Box::pin(async { Ok(Vec::new()) })
    }
    /// The same servers, for a CLI agent's `session/new`.
    fn task_mcp_servers(&self, _context: &TaskRunContext) -> Vec<Value> {
        Vec::new()
    }
    fn literature(&self) -> Arc<LiteratureClient> {
        shared_literature()
    }
    fn secrets(&self) -> Arc<dyn ConnectorSecrets> {
        Arc::new(NoSecrets)
    }
    /// Indexes beyond the built-in ones (a connected alphaXiv server).
    fn literature_sources(&self) -> Vec<Arc<dyn LiteratureSource>> {
        Vec::new()
    }
    fn pdf_extractor(&self) -> Option<Arc<dyn PdfTextExtractor>> {
        None
    }
}

/// A run in progress, by session id, so it can be cancelled and awaited.
#[derive(Clone)]
pub struct ActiveTaskRun {
    pub token: CancellationToken,
    pub done: tokio::sync::watch::Receiver<bool>,
}

/// Removes a run from its adapter's table when the run ends, however it ends.
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

/// Everything a tool call of one run uses.
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
        // 0.4.8 I: desktop apps answer with MCP content; screenshots reach
        // the model as images, and a cancelled task stops waiting.
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
                        &bounded(&args.to_string(), 4096),
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

/// A helper agent with read tools and writes confined to the record.
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
            // 0.4.8 I: desktop actions never run beside anything else.
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

/// Cancels the current turn when the time budget runs out, so the agent
/// can wrap up in a turn of its own.
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

    /// Waits for in-flight runs until one finishes (or the budget ends).
    /// 0.4.8 L: a suspend ends the wait (the runs keep going): the task then
    /// moves to another process, which waits again.
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
        // The wait sees the suspend only while it waits, so finished runs it
        // already took are never lost.
        let stop = cancel.child();
        let relay = {
            let (suspend, stop) = (suspend.clone(), stop.clone());
            tokio::spawn(async move {
                suspend.cancelled().await;
                stop.cancel();
            })
        };
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
                Err(error) => break Err(error),
            }
        };
        relay.abort();
        events(TaskRuntimeEvent::Phase {
            phase: TaskPhase::Working,
        });
        waited
    }

    /// 0.4.8 L: saves the conversation for the next owner of the task.
    fn save_conversation(
        &self,
        context: &TaskRunContext,
        resolved: &oleafly_agent::Resolved,
        messages: Vec<Message>,
        waiting_for_runs: bool,
    ) -> Result<String, String> {
        conversation::save(
            &self.services.tasks_root,
            &ConversationSnapshot {
                version: CONVERSATION_VERSION,
                task_id: context.task_id.clone(),
                generation: context.execution_generation,
                provider_id: resolved.provider_id.clone(),
                model_id: resolved.model_id.clone(),
                messages,
                waiting_for_runs,
                saved_at: crate::model::now_ms(),
            },
        )
    }

    /// 0.4.8 L: the conversation an earlier owner saved, when this
    /// generation continues a handoff and the snapshot still fits.
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
            // 0.4.8 I: the bridge's own tools (desktop apps when the task has them).
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
        // 0.4.8 L: a handoff continues the saved conversation (or waits for
        // runs again); without one the task starts from the record.
        let suspend = self.services.suspends.token(&context.task_id);
        let restored = self.restored_conversation(&context, &resolved, &events);
        let mut summary = restored
            .as_ref()
            .map(|snapshot| conversation::last_assistant_text(&snapshot.messages))
            .unwrap_or_default();
        let (mut messages, mut wait_first) = match restored {
            Some(snapshot) => (snapshot.messages, snapshot.waiting_for_runs),
            None => {
                let first = match &context.resume {
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
                };
                (vec![Message::user(first)], false)
            }
        };
        events(TaskRuntimeEvent::SessionBound {
            native_session_id: context.session_id.clone(),
        });
        let observed_usage = Arc::new(Mutex::new(None));
        let mut wake_ups = 0u32;
        // `Ok(Some(file))`: suspended, with the conversation saved in `file`.
        let result: Result<Option<String>, String> = loop {
            if !wait_first {
                let turn = cancel.child();
                let watcher = watch_time(&self.services, &context.task_id, turn.clone());
                let runner_scope = scope.clone();
                let runner_turn = turn.clone();
                let runner: ToolRunner = Arc::new(move |call| {
                    let scope = runner_scope.clone();
                    let token = runner_turn.clone();
                    Box::pin(async move { scope.call(call.name, call.arguments, token).await })
                });
                let mut request = template.clone();
                request.messages = messages.clone();
                let outcome = self
                    .agent_turn(
                        &client,
                        &resolved,
                        request,
                        RunConfig {
                            max_steps: TASK_MAX_STEPS,
                            allow_long_runs: true,
                            max_duration_ms: Some(
                                self.turn_limit(&context.task_id).as_millis() as u64
                            ),
                            ..RunConfig::default()
                        },
                        &tool_registry,
                        &turn,
                        Some(&suspend),
                        runner.clone(),
                        &events,
                        &usage,
                        &observed_usage,
                    )
                    .await;
                watcher.abort();
                if cancel.is_cancelled() {
                    break Err("The task was cancelled.".into());
                }
                // 0.4.8 L: suspended at a step boundary: the next owner
                // continues this conversation.
                if let Ok(outcome) = &outcome {
                    if outcome.suspended {
                        break self
                            .save_conversation(&context, &resolved, outcome.history.clone(), false)
                            .map(Some);
                    }
                }
                if self.time_ran_out(&context.task_id) {
                    // The time budget ended: one short turn to leave a handoff.
                    events(TaskRuntimeEvent::Phase {
                        phase: TaskPhase::WrappingUp,
                    });
                    if let Ok(outcome) = &outcome {
                        messages = outcome.history.clone();
                    }
                    messages.push(Message::user(wrap_up_message(&context.record_dir)));
                    let mut request = template.clone();
                    request.messages = messages.clone();
                    let wrap_token = cancel.child();
                    let wrapped = self
                        .agent_turn(
                            &client,
                            &resolved,
                            request,
                            RunConfig {
                                max_steps: WRAP_UP_STEPS,
                                allow_long_runs: true,
                                max_duration_ms: Some(WRAP_UP_LIMIT.as_millis() as u64),
                                ..RunConfig::default()
                            },
                            &tool_registry,
                            &wrap_token,
                            None,
                            runner,
                            &events,
                            &usage,
                            &observed_usage,
                        )
                        .await;
                    if let Ok(outcome) = wrapped {
                        summary = outcome.text;
                    }
                    break Ok(None);
                }
                let outcome = match outcome {
                    Ok(outcome) if outcome.error.is_none() && !outcome.stopped_at_cap => outcome,
                    Ok(outcome) => {
                        break Err(outcome.error.unwrap_or_else(|| {
                            "The task reached its step limit before finishing.".into()
                        }))
                    }
                    Err(error) => break Err(error),
                };
                summary = outcome.text;
                messages = outcome.history;
                if context.plan_phase {
                    break Ok(None);
                }
            }
            wait_first = false;
            match self
                .wait_for_runs(&context, &events, &cancel, &suspend)
                .await
            {
                Ok(Waited::Nothing) => break Ok(None),
                Ok(Waited::Suspended) => {
                    break self
                        .save_conversation(&context, &resolved, messages.clone(), true)
                        .map(Some)
                }
                Ok(Waited::Finished(finished)) if finished.is_empty() => break Ok(None),
                Ok(Waited::Finished(finished)) => {
                    if wake_ups >= MAX_WAKE_UPS {
                        break Err("The task woke up 200 times. Retry it to continue.".into());
                    }
                    wake_ups += 1;
                    messages.push(Message::user(wake_up_message(&finished)));
                }
                Err(error) => break Err(error),
            }
        };
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

    /// One agent turn with the task's tools.
    #[allow(clippy::too_many_arguments)] // Turn plumbing; each argument is load-bearing.
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
                // 0.4.8 L: a handoff ends the turn at its next step boundary.
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
    // Task commands report `timedOut`; older tools used `timed_out`.
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
            message: format!("Working on step {step}."),
        }),
        _ => None,
    }
}

#[cfg(test)]
mod tests;

// 0.4.8 L: suspending and continuing a built-in task across a handoff.
#[cfg(test)]
mod handoff_tests;
