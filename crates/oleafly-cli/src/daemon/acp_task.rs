//! CLI-agent research tasks in the background helper. The app hands over
//! the agent's sandboxed launch (spec, program, arguments) and its home
//! folder with the copied sign-in files; the helper starts the agent the
//! same way, resumes its own session (`session/resume`, else
//! `session/load`, else a new session), answers its requests under the
//! task's rules and the shared approval queue, and records the transcript
//! through the research runtime.
//!
//! When the task moves on (quit, reclaim, the helper stopping) the agent is
//! closed between turns, or its turn is cancelled, and the session id and
//! home go to the next owner.
use std::collections::HashMap;
use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use oleafly_acp::client::{
    AcpClient, ClientHost, ClientInfo, ClientOptions, IncomingRequest, TurnTiming,
};
use oleafly_acp::limits::{CANCEL_GRACE, DEFAULT_INACTIVITY};
use oleafly_acp::orphans::{OwnerTag, PidRegistry};
use oleafly_acp::redact::{clear_value, Redactor};
use oleafly_agent::CancellationToken;
use oleafly_research::approvals::{gate, APPROVAL_WITHDRAWN};
use oleafly_research::builtin::{ActiveTaskRun, ActiveToken, TaskBridge, TaskHost};
use oleafly_research::handoff::{AcpGrant, AcpHandoff, AcpLaunch, TRUST_AGENTS};
use oleafly_research::model::{
    ApprovalKind, CommandPolicy, ResumeContext, SuspendState, TaskRunContext, TaskRuntimeEvent,
    TaskRuntimeOutcome, ToolPhase,
};
use oleafly_research::prompt::{resume_message, task_prompt};
use oleafly_research::scheduler::{
    TaskEventSink, TaskRuntimeAdapter, TaskRuntimeFuture, TaskServices,
};
use oleafly_research::task_tools::extra::TaskBinding;
use oleafly_research::task_tools::{bounded, MAX_FILE_BYTES, MAX_OUTPUT_BYTES};
use serde_json::{json, Value};
use tokio::sync::{mpsc, watch};

use super::hosts::DaemonTaskHost;

/// Starts an agent from its launch. The default rebuilds the sandboxed
/// command; tests start a fixture directly.
pub type AcpLauncher =
    Arc<dyn Fn(&AcpLaunch) -> Result<tokio::process::Command, String> + Send + Sync>;

const OPEN_OLEAFLY: &str = "Open Oleafly to continue this task.";
const RESUME_FAILED: &str =
    "The agent's previous session could not be resumed, so the task starts fresh.";
const CANCELLED: &str = "The task was cancelled.";
const INTERRUPTED_PREFIX: &str = "Your previous turn was interrupted.";
/// ACP tool kinds; a kind outside the list follows the "unlisted" rule.
const KNOWN_KINDS: [&str; 10] = [
    "read",
    "edit",
    "delete",
    "move",
    "search",
    "execute",
    "think",
    "fetch",
    "switch_mode",
    "other",
];
const MAX_CREDENTIAL_BYTES: u64 = 256 * 1024;

fn lock<T>(value: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    value
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}

/// The sandboxed command, rebuilt from the launch the app granted (the
/// sandbox clears the environment, so nothing of the helper's leaks in).
pub fn default_launcher() -> AcpLauncher {
    Arc::new(|launch: &AcpLaunch| {
        let args: Vec<OsString> = launch.args.iter().map(OsString::from).collect();
        let command = oleafly_sandbox::command(&launch.sandbox, &launch.program, &args)
            .map_err(String::from)?;
        let mut command = tokio::process::Command::from(command);
        // Never the verbatim `\\?\C:\...` form a canonicalized path has on
        // Windows: `cmd.exe` and many programs reject it as a working folder
        // (`cmd.exe` falls back to the Windows folder). The sandbox set the
        // plain one; this keeps it.
        command.current_dir(dunce::simplified(&launch.sandbox.workspace));
        Ok(command)
    })
}

/// The sign-in files each agent keeps in its home (the app copies the same).
pub fn credential_files(agent_id: &str) -> &'static [&'static str] {
    match agent_id {
        "claude" => &[".claude/.credentials.json"],
        "codex" => &[".codex/auth.json"],
        "gemini" => &[".gemini/oauth_creds.json", ".gemini/google_accounts.json"],
        "pi" => &[
            ".pi/agent/auth.json",
            ".pi/agent/settings.json",
            ".pi/agent/models.json",
        ],
        _ => &[],
    }
}

/// A redactor for everything the agent sends: the sign-in values found in
/// its home and the MCP servers' values.
pub fn redactor_for_home(home: &Path, agent_id: &str, mcp_servers: &[Value]) -> Redactor {
    let mut values = Vec::new();
    for relative in credential_files(agent_id) {
        let path = home.join(relative);
        let Ok(metadata) = std::fs::symlink_metadata(&path) else {
            continue;
        };
        if !metadata.is_file()
            || metadata.file_type().is_symlink()
            || metadata.len() > MAX_CREDENTIAL_BYTES
        {
            continue;
        }
        let Ok(bytes) = std::fs::read(&path) else {
            continue;
        };
        let bytes = zeroize::Zeroizing::new(bytes);
        if let Ok(value) = serde_json::from_slice::<Value>(&bytes) {
            values.push(value);
        }
    }
    values.push(json!({ "mcp": mcp_servers }));
    let redactor = Redactor::new(&values);
    for value in &mut values {
        clear_value(value);
    }
    redactor
}

/// The first message of a generation that continues a handed-off session.
pub fn continuation_prompt(
    resume: Option<&ResumeContext>,
    record_dir: &str,
    turn_interrupted: bool,
) -> String {
    let body = match resume {
        Some(resume) => resume_message(resume, record_dir),
        None => "Continue the task where you left off.".to_string(),
    };
    if turn_interrupted {
        format!("{INTERRUPTED_PREFIX} {body}")
    } else {
        body
    }
}

fn tool_status(status: &str) -> String {
    match status {
        "completed" => "done",
        "failed" | "error" | "cancelled" | "canceled" => "error",
        _ => "running",
    }
    .into()
}

/// A session update as a transcript event; the app's mapping
/// (`acp_event`), by the update's kind and data.
pub fn map_update(
    kind: &str,
    data: &Value,
    outcome: &mut TaskRuntimeOutcome,
) -> Option<TaskRuntimeEvent> {
    match kind {
        "agent_message_chunk" => {
            let text = data["content"]["text"]
                .as_str()
                .unwrap_or_default()
                .to_string();
            if outcome.summary.len() < MAX_FILE_BYTES {
                outcome
                    .summary
                    .push_str(&bounded(&text, MAX_FILE_BYTES - outcome.summary.len()));
            }
            Some(TaskRuntimeEvent::Text { text })
        }
        "agent_thought_chunk" => Some(TaskRuntimeEvent::Reasoning {
            text: data["content"]["text"].as_str().unwrap_or_default().into(),
        }),
        "tool_call" | "tool_call_update" => {
            let detail = json!({
                "kind": data["kind"],
                "status": data["status"],
                "content": data["content"],
            });
            Some(TaskRuntimeEvent::Tool {
                call_id: data["toolCallId"].as_str().map(str::to_string),
                name: data["title"].as_str().unwrap_or("Agent tool").into(),
                phase: if kind == "tool_call" {
                    ToolPhase::Request
                } else {
                    ToolPhase::Update
                },
                detail: bounded(&detail.to_string(), MAX_OUTPUT_BYTES),
                status: data["status"].as_str().map(tool_status),
            })
        }
        "usage" if data["source"] != "acp_context" => {
            outcome.input_tokens = data["inputTokens"].as_u64().or(outcome.input_tokens);
            outcome.output_tokens = data["outputTokens"].as_u64().or(outcome.output_tokens);
            Some(TaskRuntimeEvent::Usage {
                input_tokens: outcome.input_tokens,
                output_tokens: outcome.output_tokens,
            })
        }
        _ => None,
    }
}

/// One session update of the running turn: the tool kind is kept for its
/// permission requests and the update goes to the transcript.
fn apply_update(
    params: &Value,
    session_id: &str,
    redactor: &Redactor,
    kinds: &mut HashMap<String, String>,
    outcome: &mut TaskRuntimeOutcome,
    events: &TaskEventSink,
) {
    if params["sessionId"].as_str() != Some(session_id) {
        return;
    }
    let update = redactor.value(&params["update"]);
    let Some(kind) = update["sessionUpdate"].as_str().map(str::to_owned) else {
        return;
    };
    if let (Some(id), Some(tool_kind)) = (update["toolCallId"].as_str(), update["kind"].as_str()) {
        kinds.insert(id.to_owned(), tool_kind.to_owned());
    }
    if let Some(event) = map_update(&kind, &update, outcome) {
        events(event);
    }
}

#[derive(Debug, PartialEq, Eq)]
pub enum PermissionPath {
    Refuse,
    Ask,
    Allow,
}

/// How a request is answered: refused by the project's rules or the
/// task's command policy, sent to the approval queue, or allowed.
pub fn permission_decision(
    grant: &AcpGrant,
    kind: Option<&str>,
    commands: CommandPolicy,
) -> PermissionPath {
    let refused = match kind {
        Some(kind) => {
            grant.refused_kinds.iter().any(|refused| refused == kind)
                || (!KNOWN_KINDS.contains(&kind) && grant.refuse_unlisted)
        }
        None => grant.refuse_unlisted,
    };
    if refused {
        return PermissionPath::Refuse;
    }
    if kind == Some("execute") {
        return match commands {
            CommandPolicy::Off => PermissionPath::Refuse,
            CommandPolicy::Ask => PermissionPath::Ask,
            CommandPolicy::Allow => PermissionPath::Allow,
        };
    }
    PermissionPath::Allow
}

fn option_id(params: &Value, kind: &str) -> Option<String> {
    params["options"]
        .as_array()?
        .iter()
        .find(|option| option["kind"] == kind)
        .and_then(|option| option["optionId"].as_str())
        .map(str::to_owned)
}

fn answer(request: IncomingRequest, option: Option<String>) {
    let _ = match option {
        Some(option) => {
            request.respond(json!({"outcome": {"outcome": "selected", "optionId": option}}))
        }
        None => request.respond(json!({"outcome": {"outcome": "cancelled"}})),
    };
}

/// The command a request runs, for the approval (at most 16 KiB, secrets
/// removed).
fn command_detail(redactor: &Redactor, tool_call: &Value) -> String {
    let command = match &tool_call["rawInput"]["command"] {
        Value::String(text) => text.clone(),
        Value::Array(parts) => parts
            .iter()
            .filter_map(Value::as_str)
            .collect::<Vec<_>>()
            .join(" "),
        _ => tool_call["title"].as_str().unwrap_or_default().to_string(),
    };
    bounded(&redactor.text(&command), 16 * 1024)
}

enum FromAgent {
    Update(Value),
    Permission(Box<IncomingRequest>),
    Withdrawn,
    Disconnected,
}

struct TaskClientHost {
    sender: mpsc::UnboundedSender<FromAgent>,
}

impl ClientHost for TaskClientHost {
    fn on_update(&self, params: Value) {
        let _ = self.sender.send(FromAgent::Update(params));
    }

    fn on_request(&self, request: IncomingRequest) {
        if request.method() == "session/request_permission" {
            if let Err(mpsc::error::SendError(FromAgent::Permission(request))) =
                self.sender.send(FromAgent::Permission(Box::new(request)))
            {
                answer(*request, None);
            }
        } else {
            let _ = request.reject(-32601, "Oleafly does not offer this to research tasks.");
        }
    }

    fn on_notification(&self, _method: &str, _params: Value) {}

    fn on_dropped_update(&self, _bytes: usize) {}

    fn on_disconnected(&self) {
        let _ = self.sender.send(FromAgent::Disconnected);
    }
}

/// The helper's CLI-agent runtime.
#[derive(Clone)]
pub struct DaemonAcpAdapter {
    host: Arc<DaemonTaskHost>,
    services: TaskServices,
    registry: Option<Arc<PidRegistry>>,
    launcher: AcpLauncher,
    tokens: Arc<Mutex<HashMap<String, ActiveTaskRun>>>,
}

impl DaemonAcpAdapter {
    /// `acp_root` holds the agents' process list (`agents.pids`), shared
    /// with the app.
    pub fn new(
        acp_root: PathBuf,
        host: Arc<DaemonTaskHost>,
        services: TaskServices,
        launcher: AcpLauncher,
    ) -> std::io::Result<Self> {
        let registry = PidRegistry::open(
            &acp_root,
            OwnerTag {
                kind: "daemon".into(),
                identity: oleafly_sandbox::process::identity::current(),
            },
        )?;
        Ok(Self {
            host,
            services,
            registry: Some(Arc::new(registry)),
            launcher,
            tokens: Arc::new(Mutex::new(HashMap::new())),
        })
    }
}

impl TaskRuntimeAdapter for DaemonAcpAdapter {
    /// The grant decides which agent runs.
    fn supports(&self, _agent_id: &str) -> bool {
        true
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
            let (done, receiver) = watch::channel(false);
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

/// How the agent's turn ended.
enum TurnEnd {
    Finished(Value),
    Suspended { turn_interrupted: bool },
    Cancelled,
    Failed(String),
}

impl DaemonAcpAdapter {
    /// The launch for this generation: the granted program, arguments and
    /// variables, with the sandbox's folders made for this generation's
    /// workspace (a task handed over before it started has none yet).
    fn launch_for(
        grant: &AcpGrant,
        context: &TaskRunContext,
    ) -> Result<(AcpLaunch, Option<AcpHandoff>), String> {
        let handoff = context
            .handoff
            .as_ref()
            .and_then(|handoff| handoff.acp.clone());
        let mut launch = grant.launch.clone();
        if let Some(handoff) = &handoff {
            launch.sandbox.home = handoff.home.clone();
        }
        if !launch.sandbox.home.is_dir() {
            return Err(OPEN_OLEAFLY.into());
        }
        let rebuilt = oleafly_research::task_tools::task_sandbox_spec_for(
            &format!("task:{}", context.task_id),
            Some(&context.project_id),
            Path::new(&context.execution_root),
            &context.allowed_paths,
            &launch.sandbox.home,
            true,
            &launch.sandbox.read_only,
        )?;
        launch.sandbox = oleafly_sandbox::SandboxSpec {
            env: std::mem::take(&mut launch.sandbox.env),
            child_processes: launch.sandbox.child_processes,
            path_prepend: std::mem::take(&mut launch.sandbox.path_prepend),
            ..rebuilt
        };
        Ok((launch, handoff))
    }

    async fn run_task(
        &self,
        context: TaskRunContext,
        cancel: CancellationToken,
        events: TaskEventSink,
    ) -> Result<TaskRuntimeOutcome, String> {
        if cancel.is_cancelled() {
            return Err(CANCELLED.into());
        }
        let grant = self.host.grant(&context.task_id)?;
        if !grant.allows(TRUST_AGENTS) {
            return Err(format!(
                "@oleafly/error:{}",
                json!({"code": TRUST_AGENTS, "params": {}, "detail": null})
            ));
        }
        let acp = grant.acp.clone().ok_or_else(|| OPEN_OLEAFLY.to_string())?;
        // Looking up the folders and runtimes is file work (on Windows an
        // ACL walk), so it stays off the async threads.
        let (launch, handoff) = {
            let acp = acp.clone();
            let context = context.clone();
            tokio::task::spawn_blocking(move || Self::launch_for(&acp, &context))
                .await
                .map_err(|_| "The agent's sandbox could not be prepared.".to_string())??
        };
        let skills = self.host.skills(&context)?;
        let root = PathBuf::from(&context.execution_root);
        let binding = TaskBinding {
            task_id: context.task_id.clone(),
            project_id: context.project_id.clone(),
            task_title: context.title.clone(),
            generation: context.execution_generation,
            brief: context.brief.clone(),
            record_dir: context.record_dir.clone(),
            execution_root: root.clone(),
            allowed_paths: context.allowed_paths.clone(),
            read_paths: self.host.skill_read_paths(&context),
            linked_roots: self.host.linked_folders(&context),
            search_dirs: self.host.program_search_dirs(),
            project_root: self.host.project_root(&context.project_id),
            services: self.services.clone(),
            host: self.host.clone(),
            events: Some(events.clone()),
            cancel: cancel.clone(),
        };
        let gate_context = binding.gate_context();
        let bridge = self.host.bridge(context.clone(), Some(binding)).await?;
        let result = self
            .with_bridge(
                &context,
                &acp,
                launch,
                handoff,
                &skills,
                &bridge,
                gate_context,
                &cancel,
                &events,
            )
            .await;
        bridge.shutdown().await;
        result
    }

    #[allow(clippy::too_many_arguments)]
    async fn with_bridge(
        &self,
        context: &TaskRunContext,
        acp: &AcpGrant,
        launch: AcpLaunch,
        handoff: Option<AcpHandoff>,
        skills: &str,
        bridge: &Arc<dyn TaskBridge>,
        gate_context: oleafly_research::approvals::GateContext,
        cancel: &CancellationToken,
        events: &TaskEventSink,
    ) -> Result<TaskRuntimeOutcome, String> {
        let mut servers = bridge.mcp_servers();
        servers.extend(self.host.task_mcp_servers(context));
        let redactor = Arc::new(redactor_for_home(
            &launch.sandbox.home,
            &acp.agent_id,
            &servers,
        ));
        // Building the sandboxed command can grant folder access on Windows
        // (it walks permissions), so it stays off the async threads.
        let command = {
            let launcher = self.launcher.clone();
            let prepared = launch.clone();
            tokio::task::spawn_blocking(move || launcher(&prepared))
                .await
                .map_err(|_| "The agent could not be prepared.".to_string())??
        };
        let (sender, mut receiver) = mpsc::unbounded_channel();
        let client = AcpClient::spawn(
            command,
            Arc::new(TaskClientHost {
                sender: sender.clone(),
            }),
        )
        .await?;
        let pid = client.pid();
        if let (Some(registry), Some(pid)) = (&self.registry, pid) {
            let started = match oleafly_sandbox::process::identity::probe(pid) {
                oleafly_sandbox::process::identity::ProcessProbe::Running { started } => started,
                oleafly_sandbox::process::identity::ProcessProbe::Gone => None,
            };
            let _ = registry.add(pid, started, &launch.program);
        }
        let result = self
            .with_client(
                context,
                acp,
                &launch,
                handoff,
                skills,
                servers,
                &client,
                &redactor,
                sender,
                &mut receiver,
                gate_context,
                cancel,
                events,
            )
            .await;
        client.shutdown().await;
        if let (Some(registry), Some(pid)) = (&self.registry, pid) {
            let _ = registry.remove(pid);
        }
        result
    }

    #[allow(clippy::too_many_arguments)]
    async fn with_client(
        &self,
        context: &TaskRunContext,
        acp: &AcpGrant,
        launch: &AcpLaunch,
        handoff: Option<AcpHandoff>,
        skills: &str,
        mut servers: Vec<Value>,
        client: &Arc<AcpClient>,
        redactor: &Arc<Redactor>,
        sender: mpsc::UnboundedSender<FromAgent>,
        receiver: &mut mpsc::UnboundedReceiver<FromAgent>,
        gate_context: oleafly_research::approvals::GateContext,
        cancel: &CancellationToken,
        events: &TaskEventSink,
    ) -> Result<TaskRuntimeOutcome, String> {
        let options = ClientOptions {
            info: ClientInfo {
                name: "oleafly".into(),
                title: "Oleafly".into(),
                version: crate::version::APP_VERSION.into(),
            },
            prefer_v2: false,
            fs_read: false,
        };
        let negotiated = client
            .initialize(&options)
            .await
            .map_err(|error| redactor.text(&error.to_string()))?;
        let capabilities = negotiated.capabilities.clone();
        if !capabilities.mcp_http {
            for server in &mut servers {
                if server["type"] == "http" {
                    *server = oleafly_research::mcp::stdio_server(server)?;
                }
            }
        }
        let cwd = context.execution_root.clone();
        // Resume the agent's own session when it can; a loaded session
        // replays its history first, which is already in the transcript.
        let mut resumed = None;
        if let Some(handoff) = &handoff {
            if capabilities.resume {
                if client
                    .resume_session(&handoff.agent_session_id, &cwd, &servers)
                    .await
                    .is_ok()
                {
                    resumed = Some(handoff.agent_session_id.clone());
                }
            } else if capabilities.load_session
                && client
                    .load_session(&handoff.agent_session_id, &cwd, &servers)
                    .await
                    .is_ok()
            {
                while receiver.try_recv().is_ok() {}
                resumed = Some(handoff.agent_session_id.clone());
            }
            if resumed.is_none() {
                events(TaskRuntimeEvent::Status {
                    message: RESUME_FAILED.into(),
                });
            }
        }
        let session_id = match resumed.clone() {
            Some(id) => id,
            None => {
                let value = client
                    .new_session(&cwd, &servers)
                    .await
                    .map_err(|error| redactor.text(&error.to_string()))?;
                let id = value["sessionId"]
                    .as_str()
                    .filter(|id| !id.is_empty() && id.len() <= 512)
                    .ok_or("The agent returned no valid session ID.")?;
                redactor.opaque_id(id)?
            }
        };
        events(TaskRuntimeEvent::SessionBound {
            native_session_id: session_id.clone(),
        });
        let interrupted_before = context
            .handoff
            .as_ref()
            .is_some_and(|handoff| handoff.turn_interrupted);
        let text = match (&resumed, &context.resume) {
            (Some(_), resume) => {
                continuation_prompt(resume.as_ref(), &context.record_dir, interrupted_before)
            }
            (None, Some(resume)) => resume_message(resume, &context.record_dir),
            (None, None) => task_prompt(context, skills),
        };
        let step = self.services.suspends.token(&context.task_id);
        let withdraw = self.services.suspends.approvals(&context.task_id);
        let (hold_sender, hold) = watch::channel(false);
        let timing = TurnTiming {
            inactivity: Some(DEFAULT_INACTIVITY),
            absolute: None,
            hold: Some(hold),
        };
        let mut outcome = TaskRuntimeOutcome {
            summary: String::new(),
            artifacts: Vec::new(),
            native_session_id: Some(session_id.clone()),
            input_tokens: None,
            output_tokens: None,
        };
        let mut kinds: HashMap<String, String> = HashMap::new();
        let pending_asks = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let hold_sender = Arc::new(hold_sender);
        // Cancelled while the agent started: the turn never begins.
        if cancel.is_cancelled() {
            return Err(CANCELLED.into());
        }
        let prompt = client.prompt(
            &session_id,
            vec![json!({"type": "text", "text": text})],
            timing,
        );
        tokio::pin!(prompt);
        let mut suspending = false;
        let mut turn_interrupted = false;
        let mut cancelling = false;
        // Set when a cancel goes out; past it the agent is stopped.
        let mut stop_at: Option<tokio::time::Instant> = None;
        let end = loop {
            tokio::select! {
                biased;
                _ = cancel.cancelled(), if !cancelling => {
                    cancelling = true;
                    stop_at.get_or_insert_with(|| tokio::time::Instant::now() + CANCEL_GRACE);
                    let _ = client.cancel(&session_id);
                }
                _ = step.cancelled(), if !suspending && !cancelling => {
                    suspending = true;
                    // A quit, an update or the helper stopping: the turn ends
                    // now and the next owner continues it. A reclaim waits
                    // for the turn to end.
                    if withdraw.is_cancelled() {
                        turn_interrupted = true;
                        stop_at.get_or_insert_with(|| tokio::time::Instant::now() + CANCEL_GRACE);
                        let _ = client.cancel(&session_id);
                    }
                }
                result = &mut prompt => {
                    // The client queues every update the agent sent before
                    // its reply, then resolves the reply. This task can still
                    // see the reply first (it may be polling on another thread
                    // while those updates arrive), so the turn's last updates
                    // are read here, or its final text would be lost.
                    while let Ok(message) = receiver.try_recv() {
                        match message {
                            FromAgent::Update(params) => {
                                apply_update(&params, &session_id, redactor, &mut kinds, &mut outcome, events);
                            }
                            FromAgent::Permission(request) => answer(*request, None),
                            FromAgent::Withdrawn | FromAgent::Disconnected => {}
                        }
                    }
                    break match result {
                        Ok(_) if cancelling => TurnEnd::Cancelled,
                        Ok(response) if turn_interrupted => {
                            record_usage(&response, &mut outcome, events);
                            TurnEnd::Suspended { turn_interrupted: true }
                        }
                        Ok(response) => TurnEnd::Finished(response),
                        Err(_) if cancelling => TurnEnd::Cancelled,
                        Err(_) if suspending => TurnEnd::Suspended { turn_interrupted: true },
                        Err(error) => TurnEnd::Failed(redactor.text(&error.to_string())),
                    };
                }
                message = receiver.recv() => match message {
                    Some(FromAgent::Update(params)) => {
                        apply_update(&params, &session_id, redactor, &mut kinds, &mut outcome, events);
                    }
                    Some(FromAgent::Permission(request)) => {
                        let request = *request;
                        let params = request.params().clone();
                        let tool = &params["toolCall"];
                        let in_root = oleafly_acp::paths::permission_paths_allowed(Path::new(&context.execution_root), Path::new(&context.execution_root), tool);
                        if params["sessionId"].as_str() != Some(session_id.as_str()) || !in_root || cancelling {
                            answer(request, None);
                            continue;
                        }
                        let kind = tool["kind"]
                            .as_str()
                            .map(str::to_owned)
                            .or_else(|| tool["toolCallId"].as_str().and_then(|id| kinds.get(id).cloned()));
                        match permission_decision(acp, kind.as_deref(), context.brief.permissions.commands) {
                            PermissionPath::Refuse => answer(request, option_id(&params, "reject_once")),
                            PermissionPath::Allow => answer(request, option_id(&params, "allow_once")),
                            PermissionPath::Ask => {
                                let services = self.services.clone();
                                let gate_context = gate_context.clone();
                                let cancel = cancel.clone();
                                let sender = sender.clone();
                                let pending = pending_asks.clone();
                                let hold = hold_sender.clone();
                                let summary: String = redactor
                                    .text(tool["title"].as_str().unwrap_or("Run a command"))
                                    .chars()
                                    .take(300)
                                    .collect();
                                let detail = command_detail(redactor, tool);
                                pending.fetch_add(1, std::sync::atomic::Ordering::AcqRel);
                                let _ = hold.send(true);
                                tokio::spawn(async move {
                                    let decision = gate(&services, &gate_context, ApprovalKind::Command, &summary, &detail, &cancel).await;
                                    match decision {
                                        Ok(()) => answer(request, option_id(&params, "allow_once")),
                                        Err(error) if error == APPROVAL_WITHDRAWN => {
                                            answer(request, None);
                                            let _ = sender.send(FromAgent::Withdrawn);
                                        }
                                        Err(_) => answer(request, option_id(&params, "reject_once")),
                                    }
                                    if pending.fetch_sub(1, std::sync::atomic::Ordering::AcqRel) == 1 {
                                        let _ = hold.send(false);
                                    }
                                });
                            }
                        }
                    }
                    Some(FromAgent::Withdrawn) => {
                        suspending = true;
                        turn_interrupted = true;
                        stop_at.get_or_insert_with(|| tokio::time::Instant::now() + CANCEL_GRACE);
                        let _ = client.cancel(&session_id);
                    }
                    Some(FromAgent::Disconnected) | None => {
                        // The prompt returns the disconnect as its error.
                    }
                },
                // A turn that doesn't settle after a cancel is stopped, which
                // ends the prompt. That also covers a cancel that went out
                // before the prompt did, which no agent can act on.
                _ = tokio::time::sleep_until(stop_at.unwrap_or_else(tokio::time::Instant::now)), if stop_at.is_some() => {
                    stop_at = None;
                    client.request_stop();
                }
            }
        };
        match end {
            TurnEnd::Finished(response) => {
                record_usage(&response, &mut outcome, events);
                let stop = response["stopReason"]
                    .as_str()
                    .unwrap_or_default()
                    .to_string();
                if stop != "end_turn" {
                    if suspending {
                        return self
                            .suspend(
                                client,
                                &session_id,
                                launch,
                                context,
                                true,
                                capabilities.close,
                                outcome,
                            )
                            .await;
                    }
                    let reason = if stop.is_empty() {
                        "no completion event".to_string()
                    } else {
                        stop
                    };
                    return Err(format!("The agent did not finish the task: {reason}."));
                }
                if capabilities.close {
                    let _ = client.close_session(&session_id).await;
                }
                if outcome.summary.trim().is_empty() {
                    outcome.summary =
                        "The agent finished. Review its workspace changes and transcript.".into();
                }
                Ok(outcome)
            }
            TurnEnd::Suspended { turn_interrupted } => {
                self.suspend(
                    client,
                    &session_id,
                    launch,
                    context,
                    turn_interrupted,
                    capabilities.close,
                    outcome,
                )
                .await
            }
            TurnEnd::Cancelled => Err(CANCELLED.into()),
            TurnEnd::Failed(error) => Err(error),
        }
    }

    /// Ends the agent between turns and leaves its session and home to the
    /// next owner.
    #[allow(clippy::too_many_arguments)]
    async fn suspend(
        &self,
        client: &Arc<AcpClient>,
        session_id: &str,
        launch: &AcpLaunch,
        context: &TaskRunContext,
        turn_interrupted: bool,
        can_close: bool,
        outcome: TaskRuntimeOutcome,
    ) -> Result<TaskRuntimeOutcome, String> {
        if can_close {
            let _ = tokio::time::timeout(CANCEL_GRACE, client.close_session(session_id)).await;
        }
        client.shutdown().await;
        self.services.suspends.record(
            &context.task_id,
            SuspendState {
                conversation: None,
                turn_interrupted,
                acp: Some(AcpHandoff {
                    agent_session_id: session_id.to_owned(),
                    home: launch.sandbox.home.clone(),
                }),
            },
        );
        Ok(outcome)
    }
}

/// The turn's token counts from the prompt answer.
fn record_usage(response: &Value, outcome: &mut TaskRuntimeOutcome, events: &TaskEventSink) {
    let Some(usage) = response.get("usage") else {
        return;
    };
    let data = json!({
        "inputTokens": usage["inputTokens"],
        "outputTokens": usage["outputTokens"],
        "source": "acp_prompt",
    });
    if let Some(event) = map_update("usage", &data, outcome) {
        events(event);
    }
}

#[cfg(test)]
mod tests;
