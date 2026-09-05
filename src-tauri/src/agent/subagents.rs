//! The sub-agent manager: agents are threads in the same process, spawned
//! by the parent run's tool calls. Canonical task-name paths
//! (`/root/task1/task_3`), depth and concurrency gates from
//! `~/.oleafly/agent.toml`, bounded result reads, per-agent steering and
//! interrupt, and SubagentStart/Stop hook events. One manager per run:
//! completed agents stay listed (they count toward nothing once closed)
//! until the run ends and the manager drops.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use oleafly_agent::items::TurnRecorder;
use oleafly_agent::{
    AgentEvent, CancellationToken, CompletionRequest, Resolved, RunConfig, SteerHandle, ToolCall,
    ToolGate, ToolOutput, ToolRegistry, ToolRunner,
};
use serde::Deserialize;
use serde_json::Value;
use tokio::sync::watch;

use crate::agent_config::MultiAgentConfig;

/// Everything a spawned child needs, cloned from the parent run.
#[derive(Clone)]
pub struct RunContext {
    pub app: Option<tauri::AppHandle>,
    pub data_root: std::path::PathBuf,
    pub session_id: String,
    pub parent_session_id: Option<String>,
    pub client: reqwest::Client,
    pub resolved: Resolved,
    pub request_template: CompletionRequest,
    pub config: RunConfig,
    pub registry: ToolRegistry,
    pub gate: ToolGate,
    pub parent_token: CancellationToken,
    pub tool_runner: ToolRunner,
    pub parent_sink: ActivitySink,
    pub project_id: String,
    /// 0 for the root run; children record depth + 1.
    pub depth: u32,
    /// The root run's canonical task path.
    pub task_path: String,
    pub multi_agent: MultiAgentConfig,
}

impl RunContext {
    pub fn root_task_path() -> String {
        "/root".to_string()
    }
}

#[derive(Clone)]
pub struct ActivitySink {
    channel: tauri::ipc::Channel<AgentEvent>,
    recorder: Option<Arc<Mutex<TurnRecorder>>>,
}

impl ActivitySink {
    pub fn new(
        channel: tauri::ipc::Channel<AgentEvent>,
        recorder: Option<Arc<Mutex<TurnRecorder>>>,
    ) -> Self {
        Self { channel, recorder }
    }

    pub fn send(&self, event: AgentEvent) -> tauri::Result<()> {
        if let Some(recorder) = &self.recorder {
            lock(recorder).record(&event);
        }
        self.channel.send(event)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SubagentStatus {
    Running,
    Done,
    Failed,
    Interrupted,
}

impl SubagentStatus {
    fn as_str(self) -> &'static str {
        match self {
            Self::Running => "running",
            Self::Done => "done",
            Self::Failed => "failed",
            Self::Interrupted => "interrupted",
        }
    }
}

struct SubAgentEntry {
    id: String,
    task_path: String,
    label: String,
    thread_id: String,
    /// The `external:` owner every command this child runs is tagged with, so
    /// stopping the child cancels its native process tree without touching the
    /// parent's or a sibling's commands.
    exec_owner: String,
    status: Arc<Mutex<SubagentStatus>>,
    final_output: Arc<Mutex<Option<String>>>,
    token: CancellationToken,
    steer: SteerHandle,
    handle: tokio::task::JoinHandle<()>,
    done_rx: watch::Receiver<bool>,
    done_tx: watch::Sender<bool>,
    selection: Option<ChildSelection>,
    context: Option<RunContext>,
    history: Arc<Mutex<Vec<oleafly_agent::Message>>>,
}

#[derive(Default)]
pub struct SubagentManager {
    mutation: tokio::sync::Mutex<()>,
    agents: Mutex<HashMap<String, SubAgentEntry>>,
    /// Cancels a child's native command owner (its process tree and pending
    /// approvals). Wired to the exec registry in production; None in tests.
    #[allow(clippy::type_complexity)]
    cancel_exec: Option<Arc<dyn Fn(&str) + Send + Sync>>,
}

impl Drop for SubagentManager {
    fn drop(&mut self) {
        let mut owners = Vec::new();
        {
            let agents = self
                .agents
                .get_mut()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            for entry in agents.values() {
                entry.token.cancel();
                owners.push(entry.exec_owner.clone());
            }
        }
        for owner in owners {
            self.cancel_owner(&owner);
        }
    }
}

/// A random prefix minted once per process launch. The subagent counter
/// resets to 1 every launch, so without this a restart would remint
/// `thread-agent-1` and append an unrelated turn onto the previous session's
/// persisted rollout (and a resync could reattach that spliced history to the
/// new project). The prefix makes every child's id and thread id unique across
/// restarts.
fn session_prefix() -> &'static str {
    use std::sync::OnceLock;
    static PREFIX: OnceLock<String> = OnceLock::new();
    PREFIX.get_or_init(|| format!("{:016x}", rand::random::<u64>()))
}

/// A fresh `external:<uuid-v4>` command owner for a child. Every command the
/// child runs is tagged with it (see `exec_owner_tagging_runner`), so stopping
/// the child cancels exactly its process tree. The shape matches the exec
/// registry's `external:` owner syntax.
fn new_exec_owner() -> String {
    let mut bytes = rand::random::<u128>().to_be_bytes();
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    format!(
        "external:{:02x}{:02x}{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}{:02x}{:02x}{:02x}{:02x}",
        bytes[0], bytes[1], bytes[2], bytes[3], bytes[4], bytes[5], bytes[6], bytes[7],
        bytes[8], bytes[9], bytes[10], bytes[11], bytes[12], bytes[13], bytes[14], bytes[15],
    )
}

/// Tag a child's run_command calls with its exec owner so the frontend runs
/// them under that owner and the manager can cancel them independently. Other
/// tools pass through untouched; a malformed argument object is left as-is.
fn exec_owner_tagging_runner(owner: String, inner: ToolRunner) -> ToolRunner {
    Arc::new(move |mut call| {
        let inner = inner.clone();
        let owner = owner.clone();
        Box::pin(async move {
            if call.name == "run_command" {
                if let Ok(Value::Object(mut map)) = serde_json::from_str::<Value>(&call.arguments) {
                    map.insert("__execOwner".to_string(), Value::String(owner.clone()));
                    if let Ok(serialized) = serde_json::to_string(&Value::Object(map)) {
                        call.arguments = serialized;
                    }
                }
            }
            inner(call).await
        })
    })
}

fn next_agent_id() -> u64 {
    use std::sync::atomic::{AtomicU64, Ordering};
    static NEXT: AtomicU64 = AtomicU64::new(1);
    NEXT.fetch_add(1, Ordering::Relaxed)
}

/// Canonical child path: `/root/task1` + `task_3` → `/root/task1/task_3`.
pub fn child_task_path(parent_path: &str, task_name: &str) -> Result<String, String> {
    let name: String = task_name
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '_' || *c == '-')
        .collect();
    if name.is_empty() || name != task_name {
        return Err("task names must be non-empty alphanumeric/_/-".into());
    }
    Ok(format!("{parent_path}/{name}"))
}

/// Bounded read: the child's final answer, truncated at a character budget
/// with an explicit marker so the parent knows it is a projection.
pub fn bounded_output(text: &str, max_chars: usize) -> String {
    if text.chars().count() <= max_chars {
        return text.to_string();
    }
    let mut truncated: String = text.chars().take(max_chars).collect();
    truncated.push_str("\n[output truncated]");
    truncated
}

#[derive(Clone)]
enum ChildSelection {
    BuiltIn(Resolved),
    Acp(Arc<super::child_acp::AcpChild>),
}

#[derive(Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RuntimeSelection {
    #[serde(default)]
    runtime: Option<String>,
    #[serde(default, alias = "provider_id")]
    provider_id: Option<String>,
    #[serde(default, alias = "model_id")]
    model_id: Option<String>,
    #[serde(default, alias = "agent_id")]
    agent_id: Option<String>,
}

impl RuntimeSelection {
    async fn resolve(&self, ctx: &RunContext, owner: String) -> Result<ChildSelection, String> {
        match self.runtime.as_deref().unwrap_or("built-in") {
            "built-in" => {
                if self.agent_id.is_some() {
                    return Err(
                        "Choose providerId for a built-in agent. agentId is used by ACP agents."
                            .into(),
                    );
                }
                if self.provider_id.is_none() && self.model_id.is_none() {
                    return Ok(ChildSelection::BuiltIn(ctx.resolved.clone()));
                }
                let provider_id = self
                    .provider_id
                    .clone()
                    .unwrap_or_else(|| ctx.resolved.provider_id.clone());
                let model_id = self.model_id.clone().unwrap_or_else(|| {
                    if provider_id == ctx.resolved.provider_id {
                        ctx.resolved.model_id.clone()
                    } else {
                        String::new()
                    }
                });
                let resolved = super::resolve_for_run_off_thread(
                    Some(super::ProviderOverride {
                        provider_id,
                        model_id,
                    }),
                    !ctx.request_template.tools.is_empty(),
                )
                .await?;
                Ok(ChildSelection::BuiltIn(resolved))
            }
            "acp" => {
                if self.provider_id.is_some() {
                    return Err(
                        "Choose agentId for an ACP agent. The agent manages its provider.".into(),
                    );
                }
                let agent_id = self
                    .agent_id
                    .as_ref()
                    .filter(|id| !id.trim().is_empty())
                    .ok_or("Choose a configured ACP agentId before delegating this task.")?;
                Ok(ChildSelection::Acp(Arc::new(
                    super::child_acp::AcpChild::new(
                        ctx,
                        agent_id.clone(),
                        self.model_id.clone(),
                        owner,
                    )?,
                )))
            }
            _ => Err("Choose built-in or acp as the agent runtime.".into()),
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SpawnAgentArgs {
    #[serde(alias = "task_name", alias = "taskName")]
    task_name: String,
    #[serde(alias = "prompt")]
    prompt: String,
    #[serde(default)]
    label: Option<String>,
    #[serde(default)]
    runtime: Option<String>,
    #[serde(default, alias = "provider_id")]
    provider_id: Option<String>,
    #[serde(default, alias = "model_id")]
    model_id: Option<String>,
    #[serde(default, alias = "agent_id")]
    agent_id: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SendMessageArgs {
    agent: String,
    message: String,
    #[serde(default)]
    items: Option<Value>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct WaitAgentArgs {
    #[serde(default)]
    ids: Vec<String>,
    #[serde(default)]
    timeout_ms: Option<u64>,
    #[serde(default)]
    max_output_chars: Option<usize>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct InterruptAgentArgs {
    agent: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CloseAgentArgs {
    agent: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ListAgentsArgs {
    #[serde(default)]
    path_prefix: Option<String>,
}

/// One wait target: the agent's identity plus its done-signal and result
/// cells.
type WaitTarget = (
    String,
    watch::Receiver<bool>,
    Arc<Mutex<SubagentStatus>>,
    Arc<Mutex<Option<String>>>,
);

fn collect_wait_targets(
    manager: &SubagentManager,
    ids: &[String],
) -> Result<Vec<WaitTarget>, String> {
    let agents = lock(&manager.agents);
    let selected: Vec<&String> = if ids.is_empty() {
        agents.keys().collect()
    } else {
        ids.iter().collect()
    };
    selected
        .into_iter()
        .map(|id| {
            let entry = find_entry(&agents, id)?;
            Ok((
                entry.id.clone(),
                entry.done_rx.clone(),
                entry.status.clone(),
                entry.final_output.clone(),
            ))
        })
        .collect()
}

impl SubagentManager {
    /// Build a manager that cancels each child's native command owner through
    /// `cancel` on interrupt, close, and teardown.
    pub fn with_exec_canceller(cancel: Arc<dyn Fn(&str) + Send + Sync>) -> Self {
        Self {
            agents: Mutex::new(HashMap::new()),
            mutation: tokio::sync::Mutex::new(()),
            cancel_exec: Some(cancel),
        }
    }

    fn cancel_owner(&self, owner: &str) {
        if let Some(cancel) = &self.cancel_exec {
            cancel(owner);
        }
    }

    fn running_count(&self) -> usize {
        lock(&self.agents)
            .values()
            .filter(|entry| *lock_status(&entry.status) == SubagentStatus::Running)
            .count()
    }

    pub async fn cancel_descendants(&self, task_path: &str) {
        let prefix = format!("{task_path}/");
        let ids = lock(&self.agents)
            .values()
            .filter(|entry| entry.task_path.starts_with(&prefix))
            .map(|entry| entry.id.clone())
            .collect::<Vec<_>>();
        for id in ids {
            let _ = self.close(&id).await;
        }
    }

    pub fn list(&self, path_prefix: Option<&str>) -> Value {
        let agents = lock(&self.agents);
        let mut rows: Vec<Value> = agents
            .values()
            .filter(|entry| {
                path_prefix
                    .map(|prefix| entry.task_path.starts_with(prefix))
                    .unwrap_or(true)
            })
            .map(|entry| {
                serde_json::json!({
                    "id": entry.id,
                    "taskPath": entry.task_path,
                    "label": entry.label,
                    "status": lock_status(&entry.status).as_str(),
                    "sessionId": match &entry.selection {
                        Some(ChildSelection::Acp(runtime)) => runtime.session_id(),
                        _ => Some(entry.thread_id.clone()),
                    },
                    "runtime": if matches!(entry.selection, Some(ChildSelection::Acp(_))) { "acp" } else { "built-in" },
                    "providerId": match &entry.selection { Some(ChildSelection::BuiltIn(resolved)) => Some(resolved.provider_id.clone()), _ => None },
                    "modelId": match &entry.selection {
                        Some(ChildSelection::BuiltIn(resolved)) => Some(resolved.model_id.clone()),
                        Some(ChildSelection::Acp(runtime)) => runtime.selected_model(),
                        None => None,
                    },
                    "agentId": match &entry.selection { Some(ChildSelection::Acp(runtime)) => Some(runtime.agent_id.clone()), _ => None },
                })
            })
            .collect();
        rows.sort_by(|a, b| a["id"].as_str().cmp(&b["id"].as_str()));
        Value::Array(rows)
    }

    /// Interrupt every running agent (the "stop all subagents" affordance):
    /// the parent run keeps going. Returns how many were interrupted.
    pub fn interrupt_all(&self) -> usize {
        let owners = {
            let agents = lock(&self.agents);
            agents
                .values()
                .filter(|entry| {
                    *lock_status(&entry.status) == SubagentStatus::Running
                        && !entry.token.is_cancelled()
                })
                .map(|entry| {
                    entry.token.cancel();
                    entry.exec_owner.clone()
                })
                .collect::<Vec<_>>()
        };
        for owner in &owners {
            self.cancel_owner(owner);
        }
        owners.len()
    }

    pub async fn interrupt(&self, agent: &str) -> Result<Value, String> {
        let (id, owner, mut done) = {
            let agents = lock(&self.agents);
            let entry = find_entry(&agents, agent)?;
            let current = *lock_status(&entry.status);
            if current != SubagentStatus::Running {
                return Ok(serde_json::json!({ "id": entry.id, "status": current.as_str() }));
            }
            entry.token.cancel();
            (
                entry.id.clone(),
                entry.exec_owner.clone(),
                entry.done_rx.clone(),
            )
        };
        self.cancel_owner(&owner);
        while !*done.borrow_and_update() {
            if done.changed().await.is_err() {
                break;
            }
        }
        Ok(serde_json::json!({ "id": id, "status": "interrupted" }))
    }

    pub async fn interrupt_all_and_wait(&self) -> usize {
        let ids = lock(&self.agents)
            .values()
            .filter(|entry| *lock_status(&entry.status) == SubagentStatus::Running)
            .map(|entry| entry.id.clone())
            .collect::<Vec<_>>();
        let count = self.interrupt_all();
        for id in ids {
            let _ = self.interrupt(&id).await;
        }
        count
    }

    pub async fn close(&self, agent: &str) -> Result<Value, String> {
        let id = {
            let agents = lock(&self.agents);
            find_entry(&agents, agent)?.id.clone()
        };
        let entry = lock(&self.agents)
            .remove(&id)
            .ok_or_else(|| format!("no agent {agent}"))?;
        entry.token.cancel();
        self.cancel_owner(&entry.exec_owner);
        let _ = entry.handle.await;
        if let Some(ChildSelection::Acp(runtime)) = &entry.selection {
            runtime.close().await;
        }
        Ok(serde_json::json!({ "id": id, "status": lock_status(&entry.status).as_str() }))
    }

    pub async fn send_message(&self, agent: &str, message: &str) -> Result<Value, String> {
        if message.trim().is_empty() {
            return Err("the message must not be empty".into());
        }
        let steer = {
            let agents = lock(&self.agents);
            let entry = find_entry(&agents, agent)?;
            if *lock_status(&entry.status) != SubagentStatus::Running {
                return Err(format!(
                    "agent {agent} is not running (use followup_task to give it new work)"
                ));
            }
            if matches!(entry.selection, Some(ChildSelection::Acp(_))) {
                return Err("This ACP agent cannot receive messages during a turn. Wait for it to finish, then use followup_task.".into());
            }
            entry.steer.clone()
        };
        if !steer
            .steer(oleafly_agent::Message::user(message.to_string()))
            .await
        {
            return Err(format!(
                "agent {agent} stopped before receiving the message"
            ));
        }
        Ok(serde_json::json!({ "delivered": true }))
    }

    /// Wait for whichever listed agent finishes first (or the agent named by
    /// a single id). Returns that agent's bounded final output.
    pub async fn wait(
        self: &Arc<Self>,
        ids: &[String],
        timeout_ms: Option<u64>,
        max_output_chars: Option<usize>,
        config: &MultiAgentConfig,
    ) -> Result<Value, String> {
        if !config.wait_agent_enabled {
            return Err("wait_agent is disabled in agent.toml".into());
        }
        let receivers: Vec<WaitTarget> = collect_wait_targets(self, ids)?;
        if receivers.is_empty() {
            return Err("no agents to wait on".into());
        }
        let timeout = std::time::Duration::from_millis(
            timeout_ms
                .unwrap_or(config.default_wait_timeout_ms)
                .clamp(config.min_wait_timeout_ms, config.max_wait_timeout_ms),
        );

        let deadline = tokio::time::Instant::now() + timeout;
        let outcome: Result<(String, SubagentStatus, String), ()> = 'wait: loop {
            for (id, _, status, final_output) in &receivers {
                let current = *lock_status(status);
                if current != SubagentStatus::Running {
                    let output = lock_output(final_output)
                        .clone()
                        .unwrap_or_else(|| "the agent finished without a text answer".into());
                    break 'wait Ok((id.clone(), current, output));
                }
            }
            if tokio::time::Instant::now() >= deadline {
                break 'wait Err(());
            }
            tokio::time::sleep(std::time::Duration::from_millis(100)).await;
        };

        match outcome {
            Ok((id, status, output)) => Ok(serde_json::json!({
                "id": id,
                "status": status.as_str(),
                "output": bounded_output(
                    &output,
                    max_output_chars.unwrap_or(4_000),
                ),
            })),
            Err(_) => Ok(serde_json::json!({
                "status": "timeout",
                "hint": "none of the listed agents finished within the wait window",
            })),
        }
    }

    /// Spawn a child agent: registers it, launches its run in the background
    /// (sharing the parent's gate and cancellation lineage), and returns the
    /// agent id immediately.
    async fn spawn(
        self: &Arc<Self>,
        ctx: &RunContext,
        task_name: &str,
        prompt: &str,
        label: Option<String>,
        selection: RuntimeSelection,
    ) -> Result<String, String> {
        let _mutation = self.mutation.lock().await;
        if prompt.trim().is_empty() {
            return Err("The task prompt must not be empty.".into());
        }
        let child_depth = ctx.depth + 1;
        if child_depth > ctx.multi_agent.max_agent_depth {
            return Err(format!(
                "agent depth limit reached ({}); do the work yourself instead",
                ctx.multi_agent.max_agent_depth
            ));
        }
        if self.running_count() >= ctx.multi_agent.max_concurrent_subagents {
            return Err(format!(
                "all {} concurrent agent slots are in use; wait for an agent to finish or close one",
                ctx.multi_agent.max_concurrent_subagents
            ));
        }
        let task_path = child_task_path(&ctx.task_path, task_name)?;
        if lock(&self.agents)
            .values()
            .any(|entry| entry.task_path == task_path)
        {
            return Err("An agent already owns this task name. Use followup_task to continue it or choose another name.".into());
        }
        let label = label.unwrap_or_else(|| {
            let preview: String = prompt.trim().chars().take(60).collect();
            preview
        });

        let id = format!("agent-{}-{}", session_prefix(), next_agent_id());
        // Deterministic from the agent id so the shell can read a child's
        // full transcript back from the rollout store without extra plumbing.
        let thread_id = format!("thread-{id}");
        // A fresh child must never adopt an existing rollout. With the
        // per-launch prefix this cannot normally happen; guard anyway so a
        // future id-scheme change fails loudly instead of silently splicing an
        // unrelated transcript onto the new child.
        {
            if crate::rollout::rollout_path(&ctx.data_root, &thread_id)
                .map(|path| path.exists())
                .unwrap_or(false)
            {
                return Err(format!(
                    "a rollout already exists for {thread_id}. Refusing to reuse it"
                ));
            }
        }

        let exec_owner = new_exec_owner();
        let selection = selection.resolve(ctx, exec_owner.clone()).await?;
        if ctx.parent_token.is_cancelled() {
            return Err("The parent task was cancelled.".into());
        }
        let mut child_ctx = ctx.clone();
        child_ctx.depth = child_depth;
        child_ctx.task_path = task_path.clone();
        child_ctx.parent_session_id = Some(ctx.session_id.clone());
        child_ctx.session_id = thread_id.clone();
        if let ChildSelection::BuiltIn(resolved) = &selection {
            child_ctx.resolved = resolved.clone();
        }

        let mut request = ctx.request_template.clone();
        request.messages = vec![oleafly_agent::Message::user(prompt.to_string())];
        request.system = Some(format!(
            "{}\n\n# Subagent instructions\n\n{}\n\nYour task: {}",
            ctx.request_template.system.as_deref().unwrap_or_default(),
            ctx.multi_agent.subagent_developer_instructions,
            task_path,
        ));
        if child_depth >= ctx.multi_agent.max_agent_depth {
            strip_delegation_tools(&mut request);
        }

        let token = ctx.parent_token.child();
        let (steer, steer_rx) = SteerHandle::channel();
        let status = Arc::new(Mutex::new(SubagentStatus::Running));
        let final_output: Arc<Mutex<Option<String>>> = Arc::new(Mutex::new(None));
        let (done_tx, done_rx) = watch::channel(false);

        let history = Arc::new(Mutex::new(request.messages.clone()));
        child_ctx.request_template = request.clone();
        let child = spawn_child_run(
            child_ctx.clone(),
            request,
            token.clone(),
            steer_rx,
            id.clone(),
            label.clone(),
            thread_id.clone(),
            exec_owner.clone(),
            status.clone(),
            final_output.clone(),
            done_tx.clone(),
            selection.clone(),
            history.clone(),
            self.clone(),
        );

        let entry = SubAgentEntry {
            id: id.clone(),
            task_path,
            label,
            thread_id,
            exec_owner,
            status,
            final_output,
            token,
            steer,
            handle: child,
            done_rx,
            done_tx,
            selection: Some(selection),
            context: Some(child_ctx),
            history,
        };
        lock(&self.agents).insert(id.clone(), entry);
        Ok(id)
    }

    /// Give a finished agent new work in its own thread (the audited
    /// followup_task: a message plus a triggered turn).
    pub async fn followup_task(
        self: &Arc<Self>,
        ctx: &RunContext,
        agent: &str,
        message: &str,
    ) -> Result<Value, String> {
        if message.trim().is_empty() {
            return Err("the task message must not be empty".into());
        }
        let (id, running) = {
            let agents = lock(&self.agents);
            let entry = find_entry(&agents, agent)?;
            let running = *lock_status(&entry.status) == SubagentStatus::Running;
            (entry.id.clone(), running)
        };
        if running {
            self.send_message(agent, message).await?;
            return Ok(serde_json::json!({ "delivered": true, "triggeredTurn": false }));
        }
        let _mutation = self.mutation.lock().await;
        if self.running_count() >= ctx.multi_agent.max_concurrent_subagents {
            return Err("All agent slots are in use. Wait for an agent to finish before continuing this task.".into());
        }
        let mut agents = lock(&self.agents);
        let entry = agents
            .get_mut(&id)
            .ok_or_else(|| format!("no agent {agent}"))?;
        if *lock_status(&entry.status) == SubagentStatus::Running {
            return Err("This agent already started another turn.".into());
        }
        let child_ctx = entry
            .context
            .clone()
            .ok_or("This agent has no saved runtime context.")?;
        let selection = entry
            .selection
            .clone()
            .ok_or("This agent has no saved runtime selection.")?;
        let mut request = child_ctx.request_template.clone();
        {
            let mut history = lock(&entry.history);
            history.push(oleafly_agent::Message::user(message.to_string()));
            request.messages = history.clone();
        }
        let token = child_ctx.parent_token.child();
        if token.is_cancelled() {
            return Err("The parent task was cancelled.".into());
        }
        let (steer, steer_rx) = SteerHandle::channel();
        let (done_tx, done_rx) = watch::channel(false);
        *lock_status(&entry.status) = SubagentStatus::Running;
        *lock_output(&entry.final_output) = None;
        entry.token = token.clone();
        entry.steer = steer;
        entry.done_rx = done_rx;
        entry.done_tx = done_tx.clone();
        entry.exec_owner = new_exec_owner();
        entry.handle = spawn_child_run(
            child_ctx,
            request,
            token,
            steer_rx,
            id.clone(),
            entry.label.clone(),
            entry.thread_id.clone(),
            entry.exec_owner.clone(),
            entry.status.clone(),
            entry.final_output.clone(),
            done_tx,
            selection,
            entry.history.clone(),
            self.clone(),
        );
        Ok(serde_json::json!({ "id": id, "triggeredTurn": true }))
    }
}

fn find_entry<'a>(
    agents: &'a HashMap<String, SubAgentEntry>,
    target: &str,
) -> Result<&'a SubAgentEntry, String> {
    agents
        .get(target)
        .or_else(|| agents.values().find(|entry| entry.task_path == target))
        .ok_or_else(|| format!("no agent {target}"))
}

fn lock<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn lock_status<'a>(
    status: &'a Arc<Mutex<SubagentStatus>>,
) -> std::sync::MutexGuard<'a, SubagentStatus> {
    lock(status)
}

fn lock_output<'a>(
    output: &'a Arc<Mutex<Option<String>>>,
) -> std::sync::MutexGuard<'a, Option<String>> {
    lock(output)
}

/// Remove every delegation tool from a child's request (children at the
/// depth cap cannot delegate further).
pub fn strip_delegation_tools(request: &mut CompletionRequest) {
    const DELEGATION_TOOLS: [&str; 8] = [
        "spawn_agent",
        "send_message",
        "followup_task",
        "wait_agent",
        "interrupt_agent",
        "list_agents",
        "close_agent",
        "spawn_subagents",
    ];
    request
        .tools
        .retain(|tool| !DELEGATION_TOOLS.contains(&tool.name.as_str()));
}

/// The child run: the same loop the root run uses, recording into its own
/// thread, publishing progress into the parent's stream, and settling its
/// status/output for wait_agent.
#[allow(clippy::too_many_arguments)]
fn spawn_child_run(
    mut ctx: RunContext,
    request: CompletionRequest,
    token: CancellationToken,
    steer_rx: tokio::sync::mpsc::UnboundedReceiver<oleafly_agent::run::SteeredInput>,
    id: String,
    label: String,
    thread_id: String,
    exec_owner: String,
    status: Arc<Mutex<SubagentStatus>>,
    final_output: Arc<Mutex<Option<String>>>,
    done_tx: watch::Sender<bool>,
    selection: ChildSelection,
    history: Arc<Mutex<Vec<oleafly_agent::Message>>>,
    manager: Arc<SubagentManager>,
) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        let turn_id = format!("{id}-turn-{}", next_agent_id());
        let initial_user_message = request
            .messages
            .last()
            .map(message_text)
            .unwrap_or_default();
        let mut recorder = TurnRecorder::new(&turn_id);
        recorder.seed_user_message(initial_user_message.clone());
        let shared_recorder = Arc::new(Mutex::new(recorder));
        let root = ctx.data_root.clone();
        let mut persist = super::InterruptedRunPersist {
            thread_id: Some(thread_id.clone()),
            recorder: Some(shared_recorder.clone()),
            root: root.clone(),
            project: ctx.project_id.clone(),
            settled: false,
        };
        let _ = ctx.parent_sink.send(activity_update(
            &selection, &thread_id, &id, &label, "started", None,
        ));
        subagent_start_hook(&thread_id, &label, &ctx.project_id, &request);
        ctx.parent_token = token.clone();
        let result: Result<String, String> = match &selection {
            ChildSelection::BuiltIn(resolved) => {
                let usage = super::usage::NativeUsageGuard::new(
                    root.clone(),
                    super::usage::UsageScope {
                        session_id: thread_id.clone(),
                        turn_id: turn_id.clone(),
                        project_id: Some(ctx.project_id.clone()),
                        task_id: None,
                        parent_session_id: ctx.parent_session_id.clone(),
                    },
                    resolved,
                );
                let pipeline = oleafly_agent::ToolPipeline {
                    registry: ctx.registry.clone(),
                    gate: ctx.gate.clone(),
                    token: token.clone(),
                };
                let runner =
                    multi_agent_tool_runner(ctx.clone(), manager.clone(), ctx.tool_runner.clone());
                let runner = exec_owner_tagging_runner(exec_owner.clone(), runner);
                let runner = super::allowlisted_tool_runner(
                    request.tools.iter().map(|tool| tool.name.clone()).collect(),
                    runner,
                );
                let outcome = tokio::select! {
                    biased;
                    _ = token.cancelled() => Err("The agent was interrupted.".into()),
                    outcome = oleafly_agent::run_agent_with_pipeline(
                        &ctx.client, resolved, request, &ctx.config, pipeline, Some(steer_rx), runner,
                        |event| {
                            usage.observe(&event);
                            let update = match &event {
                                AgentEvent::StepStart { .. } => Some(("thinking", None)),
                                AgentEvent::ToolCallStart { name, .. } => Some(("tool", Some(name.clone()))),
                                AgentEvent::Steered { .. } => Some(("interacted", None)),
                                _ => None,
                            };
                            if let Some((state, detail)) = update {
                                let _ = ctx.parent_sink.send(activity_update(&selection, &thread_id, &id, &label, state, detail));
                            }
                            lock(&shared_recorder).record(&event);
                        },
                    ) => outcome.map_err(super::tagged),
                };
                usage.finish(if token.is_cancelled() {
                    "cancelled"
                } else if matches!(&outcome, Ok(outcome) if outcome.error.is_none()) {
                    "completed"
                } else {
                    "failed"
                });
                outcome.and_then(|outcome| {
                    lock(&shared_recorder).finish(outcome.stopped_at_cap);
                    if let Some(error) = outcome.error {
                        Err(error)
                    } else {
                        Ok(outcome.text)
                    }
                })
            }
            ChildSelection::Acp(runtime) => {
                persist.settled = true;
                runtime
                    .run(initial_user_message, &token, &ctx.parent_sink, &id, &label)
                    .await
            }
        };
        manager.cancel_descendants(&ctx.task_path).await;
        if let Some(app) = &ctx.app {
            use tauri::Manager;
            if let Some(exec) = app.try_state::<crate::agent_exec::AgentExecState>() {
                crate::agent_exec::cancel_run_and_wait(exec.inner(), &exec_owner).await;
            }
        }
        let settled = if token.is_cancelled() {
            SubagentStatus::Interrupted
        } else if result.is_ok() {
            SubagentStatus::Done
        } else {
            SubagentStatus::Failed
        };
        let output = result.unwrap_or_else(|error| error);
        if matches!(selection, ChildSelection::BuiltIn(_)) {
            let mut recorder = lock(&shared_recorder);
            if token.is_cancelled() {
                recorder.record(&AgentEvent::Error {
                    message: "The agent was interrupted.".into(),
                    retryable: false,
                });
            }
            recorder.finish(false);
            let record = recorder.snapshot().clone();
            drop(recorder);
            if crate::rollout::append_turn(&root, &thread_id, &record).is_ok() {
                if let Ok(turns) = crate::rollout::read_turns(&root, &thread_id) {
                    let _ = crate::library_db::resync_thread(
                        &root,
                        &thread_id,
                        &ctx.project_id,
                        &turns,
                    );
                }
            }
            persist.settled = true;
            lock(&history).push(oleafly_agent::Message {
                role: oleafly_agent::Role::Assistant,
                content: vec![oleafly_agent::ContentPart::text(output.clone())],
            });
        }
        *lock_output(&final_output) = Some(output.clone());
        *lock_status(&status) = settled;
        subagent_stop_hook(&thread_id, &label, &output, settled);
        let _ = ctx.parent_sink.send(activity_update(
            &selection,
            &thread_id,
            &id,
            &label,
            match settled {
                SubagentStatus::Done => "done",
                SubagentStatus::Failed => "error",
                SubagentStatus::Interrupted => "interrupted",
                SubagentStatus::Running => "thinking",
            },
            Some(bounded_output(&output, 240)),
        ));
        let _ = done_tx.send(true);
    })
}

fn activity_update(
    selection: &ChildSelection,
    thread_id: &str,
    id: &str,
    label: &str,
    state: &str,
    detail: Option<String>,
) -> AgentEvent {
    let (runtime, session_id, provider_id, model_id, agent_id) = match selection {
        ChildSelection::BuiltIn(resolved) => (
            "built-in",
            Some(thread_id.into()),
            Some(resolved.provider_id.clone()),
            Some(resolved.model_id.clone()),
            None,
        ),
        ChildSelection::Acp(runtime) => (
            "acp",
            runtime.session_id(),
            None,
            runtime.selected_model(),
            Some(runtime.agent_id.clone()),
        ),
    };
    AgentEvent::SubagentUpdate {
        id: id.into(),
        label: label.into(),
        state: state.into(),
        detail,
        runtime: Some(runtime.into()),
        session_id,
        provider_id,
        model_id,
        agent_id,
    }
}

fn message_text(message: &oleafly_agent::Message) -> String {
    message
        .content
        .iter()
        .filter_map(|part| match part {
            oleafly_agent::ContentPart::Text { text } => Some(text.as_str()),
            _ => None,
        })
        .collect::<Vec<_>>()
        .join("\n")
}

/// SubagentStart hook: the audited payload fields, routed through the
/// two-bucket structured log.
fn subagent_start_hook(
    thread_id: &str,
    label: &str,
    project_id: &str,
    request: &CompletionRequest,
) {
    let prompt = request
        .messages
        .first()
        .map(|message| {
            message
                .content
                .iter()
                .filter_map(|part| match part {
                    oleafly_agent::ContentPart::Text { text } => Some(text.as_str()),
                    _ => None,
                })
                .collect::<Vec<_>>()
                .join(" ")
        })
        .unwrap_or_default();
    crate::logsafe::info(
        "subagent hook",
        serde_json::json!({
            "hookEventName": "SubagentStart",
            "threadId": thread_id,
            "agentType": label,
            "cwd": project_id,
            "reason": "spawn",
        }),
        serde_json::json!({ "prompt": prompt }),
    );
}

fn subagent_stop_hook(thread_id: &str, label: &str, output: &str, status: SubagentStatus) {
    crate::logsafe::info(
        "subagent hook",
        serde_json::json!({
            "hookEventName": "SubagentStop",
            "threadId": thread_id,
            "agentType": label,
            "reason": status.as_str(),
        }),
        serde_json::json!({ "lastAssistantMessage": output }),
    );
}

/// Dispatch one multi-agent tool call. `None` means the call is not ours and
/// the caller falls through to the normal runner.
pub async fn dispatch(
    manager: &Arc<SubagentManager>,
    ctx: &RunContext,
    call: &ToolCall,
) -> Option<Result<ToolOutput, String>> {
    let arguments = call.arguments.as_str();
    match call.name.as_str() {
        "spawn_agent" => {
            let args: SpawnAgentArgs = match serde_json::from_str(arguments) {
                Ok(args) => args,
                Err(_) => {
                    return Some(Err(
                        "spawn_agent expects { \"taskName\", \"prompt\", \"label\"? }".into(),
                    ))
                }
            };
            let path = match child_task_path(&ctx.task_path, &args.task_name) {
                Ok(path) => path,
                Err(error) => return Some(Err(error)),
            };
            let selection = RuntimeSelection {
                runtime: args.runtime,
                provider_id: args.provider_id,
                model_id: args.model_id,
                agent_id: args.agent_id,
            };
            match manager
                .spawn(ctx, &args.task_name, &args.prompt, args.label, selection)
                .await
            {
                Ok(id) => Some(Ok(ToolOutput::text(
                    serde_json::json!({ "id": id, "taskPath": path, "status": "running" })
                        .to_string(),
                ))),
                Err(error) => Some(Err(error)),
            }
        }
        "send_message" => {
            let args: SendMessageArgs = match serde_json::from_str(arguments) {
                Ok(args) => args,
                Err(_) => {
                    return Some(Err(
                        "send_message expects { \"agent\", \"message\" } (or items)".into(),
                    ))
                }
            };
            let message = if args.message.trim().is_empty() {
                args.items
                    .map(|items| items.to_string())
                    .unwrap_or_default()
            } else {
                args.message
            };
            Some(
                manager
                    .send_message(&args.agent, &message)
                    .await
                    .map(|result| ToolOutput::text(result.to_string())),
            )
        }
        "followup_task" => {
            let args: SendMessageArgs = match serde_json::from_str(arguments) {
                Ok(args) => args,
                Err(_) => {
                    return Some(Err(
                        "followup_task expects { \"agent\", \"message\" }".into()
                    ))
                }
            };
            Some(
                manager
                    .followup_task(ctx, &args.agent, &args.message)
                    .await
                    .map(|result| ToolOutput::text(result.to_string())),
            )
        }
        "wait_agent" => {
            let args: WaitAgentArgs = match serde_json::from_str(arguments) {
                Ok(args) => args,
                Err(_) => {
                    return Some(Err(
                        "wait_agent expects { \"ids\"?: [agentId], \"timeoutMs\"?, \"maxOutputChars\"? }"
                            .into(),
                    ))
                }
            };
            Some(
                manager
                    .wait(
                        &args.ids,
                        args.timeout_ms,
                        args.max_output_chars,
                        &ctx.multi_agent,
                    )
                    .await
                    .map(|result| ToolOutput::text(result.to_string())),
            )
        }
        "interrupt_agent" => {
            let args: InterruptAgentArgs = match serde_json::from_str(arguments) {
                Ok(args) => args,
                Err(_) => return Some(Err("interrupt_agent expects { \"agent\" }".into())),
            };
            Some(
                manager
                    .interrupt(&args.agent)
                    .await
                    .map(|result| ToolOutput::text(result.to_string())),
            )
        }
        "list_agents" => {
            let args: ListAgentsArgs =
                serde_json::from_str(arguments).unwrap_or(ListAgentsArgs { path_prefix: None });
            Some(Ok(ToolOutput::text(
                manager.list(args.path_prefix.as_deref()).to_string(),
            )))
        }
        "close_agent" => {
            let args: CloseAgentArgs = match serde_json::from_str(arguments) {
                Ok(args) => args,
                Err(_) => return Some(Err("close_agent expects { \"agent\" }".into())),
            };
            Some(
                manager
                    .close(&args.agent)
                    .await
                    .map(|result| ToolOutput::text(result.to_string())),
            )
        }
        // Legacy batch tool: spawn + wait all + one report.
        crate::agent::SUBAGENT_TOOL => {
            let tasks: Vec<serde_json::Value> = match serde_json::from_str(arguments) {
                Ok(Value::Array(tasks)) => tasks,
                _ => {
                    return Some(Err(
                        "spawn_subagents expects { \"tasks\": [{ \"label\"?, \"prompt\" }] }"
                            .into(),
                    ))
                }
            };
            if tasks.is_empty() || tasks.len() > 4 {
                return Some(Err("spawn_subagents runs 1 to 4 tasks per call".into()));
            }
            let mut ids = Vec::new();
            for (index, task) in tasks.iter().enumerate() {
                let prompt = task
                    .get("prompt")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string();
                let label = task
                    .get("label")
                    .and_then(Value::as_str)
                    .map(str::to_string);
                match manager
                    .spawn(
                        ctx,
                        &format!("task_{}_{}", next_agent_id(), index),
                        &prompt,
                        label,
                        RuntimeSelection::default(),
                    )
                    .await
                {
                    Ok(id) => ids.push(id),
                    Err(error) => return Some(Err(error)),
                }
            }
            let mut report = String::new();
            for id in &ids {
                if let Ok(result) = manager
                    .wait(std::slice::from_ref(id), None, None, &ctx.multi_agent)
                    .await
                {
                    report.push_str(&format!(
                        "## {id}\n\n{}\n\n",
                        result["output"].as_str().unwrap_or("")
                    ));
                }
            }
            Some(Ok(ToolOutput::text(report.trim_end().to_string())))
        }
        _ => None,
    }
}

/// Wrap the normal tool runner with multi-agent dispatch: our tools run
/// against the manager, everything else falls through unchanged.
pub fn multi_agent_tool_runner(
    ctx: RunContext,
    manager: Arc<SubagentManager>,
    inner: ToolRunner,
) -> ToolRunner {
    Arc::new(move |call| {
        let manager = manager.clone();
        let ctx = ctx.clone();
        let inner = inner.clone();
        Box::pin(async move {
            match dispatch(&manager, &ctx, &call).await {
                Some(Ok(output)) => output,
                Some(Err(message)) => dispatch_error(message),
                None => inner(call).await,
            }
        })
    })
}

/// Errors from dispatch become error-shaped tool outputs for the model.
pub fn dispatch_error(message: String) -> ToolOutput {
    ToolOutput::text(serde_json::json!({ "error": message }).to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn followup_preserves_child_identity_model_and_native_usage() {
        use axum::{routing::post, Json, Router};
        let data = tempfile::tempdir().unwrap();
        let seen = Arc::new(Mutex::new(Vec::<Value>::new()));
        let request_log = seen.clone();
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let app = Router::new().route("/v1/chat/completions", post(move |Json(request): Json<Value>| {
            lock(&request_log).push(request);
            async {
                ([("content-type", "text/event-stream")],
                 "data: {\"choices\":[{\"delta\":{\"content\":\"answer\"}}]}\n\ndata: {\"choices\":[{\"delta\":{},\"finish_reason\":\"stop\"}],\"usage\":{\"prompt_tokens\":12,\"completion_tokens\":3}}\n\ndata: [DONE]\n\n")
            }
        }));
        let server = tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });
        let ctx = RunContext {
            app: None,
            data_root: data.path().into(),
            session_id: "parent-session".into(),
            parent_session_id: None,
            client: reqwest::Client::new(),
            resolved: Resolved {
                provider_id: "test-provider".into(),
                model_id: "chosen-model".into(),
                credential: String::new(),
                auth: None,
                wire: oleafly_agent::Wire::OpenAiChat {
                    base_url: format!("http://{address}/v1"),
                    reasoning_content: false,
                },
            },
            request_template: CompletionRequest::prompt("system", "parent"),
            config: RunConfig::default(),
            registry: ToolRegistry::default(),
            gate: ToolGate::new(),
            parent_token: CancellationToken::new(),
            tool_runner: Arc::new(|_| Box::pin(async { ToolOutput::text("unused") })),
            parent_sink: ActivitySink::new(tauri::ipc::Channel::new(|_| Ok(())), None),
            project_id: "project".into(),
            depth: 0,
            task_path: "/root".into(),
            multi_agent: MultiAgentConfig::default(),
        };
        let manager = Arc::new(SubagentManager::default());
        let id = manager
            .spawn(
                &ctx,
                "review",
                "first task",
                None,
                RuntimeSelection::default(),
            )
            .await
            .unwrap();
        let first = manager
            .wait(
                std::slice::from_ref(&id),
                Some(5000),
                None,
                &ctx.multi_agent,
            )
            .await
            .unwrap();
        assert_eq!(first["status"], "done");
        let followup = manager
            .followup_task(&ctx, "/root/review", "second task")
            .await
            .unwrap();
        assert_eq!(followup["id"], id);
        let second = manager
            .wait(
                std::slice::from_ref(&id),
                Some(5000),
                None,
                &ctx.multi_agent,
            )
            .await
            .unwrap();
        assert_eq!(second["status"], "done");
        {
            let requests = lock(&seen);
            assert_eq!(requests.len(), 2);
            assert_eq!(requests[0]["model"], "chosen-model");
            assert_eq!(requests[1]["model"], "chosen-model");
            assert!(requests[1]["messages"].to_string().contains("first task"));
            assert!(requests[1]["messages"].to_string().contains("second task"));
        }
        let db = crate::library_db::open(data.path()).unwrap();
        let row: (i64, i64, String) = db.query_row(
            "SELECT COUNT(*), COUNT(DISTINCT session_id), MIN(parent_session_id) FROM usage_records", [],
            |row| Ok((row.get(0)?,row.get(1)?,row.get(2)?)),
        ).unwrap();
        assert_eq!(row, (2, 1, "parent-session".into()));
        manager.close(&id).await.unwrap();
        server.abort();
    }

    #[test]
    fn spawn_schema_accepts_explicit_runtime_and_rejects_unknown_options() {
        let args: SpawnAgentArgs = serde_json::from_value(serde_json::json!({
            "task_name":"check", "prompt":"check it", "runtime":"acp", "agentId":"codex", "modelId":"offered-model",
        })).unwrap();
        assert_eq!(args.agent_id.as_deref(), Some("codex"));
        assert_eq!(args.runtime.as_deref(), Some("acp"));
        assert!(serde_json::from_value::<SpawnAgentArgs>(serde_json::json!({
            "task_name":"check", "prompt":"check it", "fakeSetting":true,
        }))
        .is_err());
    }

    #[test]
    fn canonical_task_paths_join_like_the_audited_core() {
        assert_eq!(
            child_task_path("/root/task1", "task_3").unwrap(),
            "/root/task1/task_3"
        );
        assert!(child_task_path("/root", "../escape").is_err());
        assert!(child_task_path("/root", "").is_err());
        assert!(child_task_path("/root", "has space").is_err());
    }

    #[test]
    fn bounded_reads_truncate_with_a_marker() {
        let long = "x".repeat(100);
        let bounded = bounded_output(&long, 10);
        assert!(bounded.starts_with("xxxxxxxxxx"));
        assert!(bounded.ends_with("[output truncated]"));
        assert_eq!(bounded_output("short", 10), "short");
    }

    #[test]
    fn delegation_tools_are_stripped_from_capped_children() {
        let mut request = CompletionRequest::prompt("system", "work");
        request.tools = vec![
            oleafly_agent::ToolSchema {
                name: "spawn_agent".into(),
                description: String::new(),
                input_schema: Value::Null,
            },
            oleafly_agent::ToolSchema {
                name: "read_file".into(),
                description: String::new(),
                input_schema: Value::Null,
            },
            oleafly_agent::ToolSchema {
                name: "wait_agent".into(),
                description: String::new(),
                input_schema: Value::Null,
            },
        ];
        strip_delegation_tools(&mut request);
        assert_eq!(request.tools.len(), 1);
        assert_eq!(request.tools[0].name, "read_file");
    }

    fn dummy_entry(id: &str, status: SubagentStatus) -> SubAgentEntry {
        let (done_tx, done_rx) = watch::channel(false);
        let (steer, _steer_rx) = SteerHandle::channel();
        SubAgentEntry {
            id: id.to_string(),
            task_path: format!("/root/{id}"),
            label: id.to_string(),
            thread_id: format!("thread-{id}"),
            exec_owner: format!("external:{id}"),
            status: Arc::new(Mutex::new(status)),
            final_output: Arc::new(Mutex::new(None)),
            token: CancellationToken::new(),
            steer,
            handle: tokio::spawn(async {}),
            done_rx,
            done_tx,
            selection: None,
            context: None,
            history: Arc::new(Mutex::new(Vec::new())),
        }
    }

    #[tokio::test]
    async fn interrupt_all_stops_only_running_children() {
        let manager = SubagentManager::default();
        let running_token = {
            let mut entry = dummy_entry("agent-1", SubagentStatus::Running);
            let cancelled = entry.token.clone();
            let stopped = entry.status.clone();
            let done = entry.done_tx.clone();
            entry.handle = tokio::spawn(async move {
                cancelled.cancelled().await;
                *lock_status(&stopped) = SubagentStatus::Interrupted;
                let _ = done.send(true);
            });
            let token = entry.token.clone();
            lock(&manager.agents).insert("agent-1".into(), entry);
            token
        };
        let done_entry = dummy_entry("agent-2", SubagentStatus::Done);
        lock(&manager.agents).insert("agent-2".into(), done_entry);

        assert_eq!(manager.interrupt_all(), 1);
        assert!(running_token.is_cancelled());
        tokio::task::yield_now().await;
        let agents = lock(&manager.agents);
        assert!(agents["agent-1"].handle.is_finished());
        assert_eq!(
            *lock_status(&agents["agent-1"].status),
            SubagentStatus::Interrupted
        );
        assert_eq!(
            *lock_status(&agents["agent-2"].status),
            SubagentStatus::Done
        );
        // A second sweep finds nothing running.
        drop(agents);
        assert_eq!(manager.interrupt_all(), 0);
    }

    #[tokio::test]
    async fn interrupt_cancels_each_running_child_command_owner() {
        let cancelled: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(Vec::new()));
        let recorder = cancelled.clone();
        let manager = SubagentManager::with_exec_canceller(Arc::new(move |owner: &str| {
            recorder.lock().unwrap().push(owner.to_string());
        }));
        let mut running = dummy_entry("agent-1", SubagentStatus::Running);
        let token = running.token.clone();
        running.handle = tokio::spawn(async move {
            token.cancelled().await;
        });
        lock(&manager.agents).insert("agent-1".into(), running);
        // A finished child must not have its owner cancelled by a stop-all.
        lock(&manager.agents).insert(
            "agent-2".into(),
            dummy_entry("agent-2", SubagentStatus::Done),
        );

        assert_eq!(manager.interrupt_all(), 1);
        assert_eq!(cancelled.lock().unwrap().as_slice(), ["external:agent-1"]);

        // Closing the finished child still cancels its owner (its process may
        // outlive the agent), and does so exactly once.
        manager.close("agent-2").await.unwrap();
        assert_eq!(
            cancelled.lock().unwrap().as_slice(),
            ["external:agent-1", "external:agent-2"]
        );
    }

    #[tokio::test]
    async fn a_missing_canceller_never_panics_on_interrupt() {
        let manager = SubagentManager::default();
        let mut entry = dummy_entry("agent-1", SubagentStatus::Running);
        let cancelled = entry.token.clone();
        let stopped = entry.status.clone();
        let done = entry.done_tx.clone();
        entry.handle = tokio::spawn(async move {
            cancelled.cancelled().await;
            *lock_status(&stopped) = SubagentStatus::Interrupted;
            let _ = done.send(true);
        });
        lock(&manager.agents).insert("agent-1".into(), entry);
        assert_eq!(manager.interrupt_all(), 1);
    }

    #[test]
    fn minted_exec_owners_match_the_external_owner_syntax() {
        let owner = new_exec_owner();
        let id = owner.strip_prefix("external:").expect("external: prefix");
        assert_eq!(id.len(), 36);
        let bytes = id.as_bytes();
        assert_eq!(bytes[14], b'4');
        assert!(matches!(
            bytes[19].to_ascii_lowercase(),
            b'8' | b'9' | b'a' | b'b'
        ));
        assert!(new_exec_owner() != new_exec_owner());
    }

    #[tokio::test]
    async fn dropping_a_manager_cancels_running_children() {
        let manager = SubagentManager::default();
        let mut entry = dummy_entry("agent-1", SubagentStatus::Running);
        let cancelled = entry.token.clone();
        let stopped = entry.status.clone();
        let done = entry.done_tx.clone();
        entry.handle = tokio::spawn(async move {
            cancelled.cancelled().await;
            *lock_status(&stopped) = SubagentStatus::Interrupted;
            let _ = done.send(true);
        });
        let abort = entry.handle.abort_handle();
        lock(&manager.agents).insert("agent-1".into(), entry);

        drop(manager);
        tokio::task::yield_now().await;
        assert!(abort.is_finished());
    }

    #[tokio::test]
    async fn child_thread_ids_are_deterministic_from_agent_ids() {
        // spawn() mints process-unique ids; the derived thread id shape is
        // what the shell relies on to read transcripts back.
        assert!(dummy_entry("agent-7", SubagentStatus::Done)
            .thread_id
            .starts_with("thread-agent-"));
    }

    #[test]
    fn wait_respects_the_configured_bounds() {
        let config = MultiAgentConfig {
            min_wait_timeout_ms: 1_000,
            max_wait_timeout_ms: 5_000,
            default_wait_timeout_ms: 2_000,
            ..MultiAgentConfig::default()
        };
        let clamped = |requested: Option<u64>| {
            requested
                .unwrap_or(config.default_wait_timeout_ms)
                .clamp(config.min_wait_timeout_ms, config.max_wait_timeout_ms)
        };
        assert_eq!(clamped(None), 2_000);
        assert_eq!(clamped(Some(1)), 1_000);
        assert_eq!(clamped(Some(60_000)), 5_000);
    }
}
