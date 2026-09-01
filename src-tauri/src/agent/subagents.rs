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
    pub client: reqwest::Client,
    pub resolved: Resolved,
    pub request_template: CompletionRequest,
    pub config: RunConfig,
    pub registry: ToolRegistry,
    pub gate: ToolGate,
    pub parent_token: CancellationToken,
    pub tool_runner: ToolRunner,
    pub parent_sink: tauri::ipc::Channel<AgentEvent>,
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
}

#[derive(Default)]
pub struct SubagentManager {
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
                entry.handle.abort();
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

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SpawnAgentArgs {
    #[serde(alias = "task_name", alias = "taskName")]
    task_name: String,
    #[serde(alias = "prompt")]
    prompt: String,
    #[serde(default)]
    label: Option<String>,
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
            let entry = agents.get(id).ok_or_else(|| format!("no agent {id}"))?;
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
                })
            })
            .collect();
        rows.sort_by(|a, b| a["id"].as_str().cmp(&b["id"].as_str()));
        Value::Array(rows)
    }

    /// Interrupt every running agent (the "stop all subagents" affordance):
    /// the parent run keeps going. Returns how many were interrupted.
    pub fn interrupt_all(&self) -> usize {
        let mut owners = Vec::new();
        let interrupted = {
            let agents = lock(&self.agents);
            let mut count = 0;
            for entry in agents.values() {
                if *lock_status(&entry.status) == SubagentStatus::Running {
                    entry.token.cancel();
                    entry.handle.abort();
                    *lock_status(&entry.status) = SubagentStatus::Interrupted;
                    let _ = entry.done_tx.send(true);
                    owners.push(entry.exec_owner.clone());
                    count += 1;
                }
            }
            count
        };
        // Cancel each child's native commands after releasing the agents lock,
        // so the exec registry lock is never taken while holding it.
        for owner in &owners {
            self.cancel_owner(owner);
        }
        interrupted
    }

    pub fn interrupt(&self, agent: &str) -> Result<Value, String> {
        let (result, owner) = {
            let agents = lock(&self.agents);
            let entry = agents
                .get(agent)
                .ok_or_else(|| format!("no agent {agent}"))?;
            entry.token.cancel();
            *lock_status(&entry.status) = SubagentStatus::Interrupted;
            let _ = entry.done_tx.send(true);
            (
                serde_json::json!({ "id": entry.id, "status": "interrupted" }),
                entry.exec_owner.clone(),
            )
        };
        self.cancel_owner(&owner);
        Ok(result)
    }

    pub fn close(&self, agent: &str) -> Result<Value, String> {
        let (summary, owner) = {
            let mut agents = lock(&self.agents);
            let entry = agents
                .get(agent)
                .ok_or_else(|| format!("no agent {agent}"))?;
            let status = *lock_status(&entry.status);
            entry.token.cancel();
            entry.handle.abort();
            let owner = entry.exec_owner.clone();
            let summary = serde_json::json!({
                "id": entry.id,
                "status": status.as_str(),
            });
            agents.remove(agent);
            (summary, owner)
        };
        self.cancel_owner(&owner);
        Ok(summary)
    }

    pub async fn send_message(&self, agent: &str, message: &str) -> Result<Value, String> {
        if message.trim().is_empty() {
            return Err("the message must not be empty".into());
        }
        let steer = {
            let agents = lock(&self.agents);
            let entry = agents
                .get(agent)
                .ok_or_else(|| format!("no agent {agent}"))?;
            if *lock_status(&entry.status) != SubagentStatus::Running {
                return Err(format!(
                    "agent {agent} is not running (use followup_task to give it new work)"
                ));
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
    pub fn spawn(
        self: &Arc<Self>,
        ctx: &RunContext,
        task_name: &str,
        prompt: &str,
        label: Option<String>,
    ) -> Result<String, String> {
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
        if let Ok(root) = crate::paths::oleafly_root() {
            if crate::rollout::rollout_path(&root, &thread_id)
                .map(|path| path.exists())
                .unwrap_or(false)
            {
                return Err(format!(
                    "a rollout already exists for {thread_id}. Refusing to reuse it"
                ));
            }
        }

        let exec_owner = new_exec_owner();

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

        let child = spawn_child_run(
            ctx.clone(),
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
        let (running, _thread_id, task_path) = {
            let agents = lock(&self.agents);
            let entry = agents
                .get(agent)
                .ok_or_else(|| format!("no agent {agent}"))?;
            let running = *lock_status(&entry.status) == SubagentStatus::Running;
            (running, entry.thread_id.clone(), entry.task_path.clone())
        };
        if running {
            // Still working: the message lands at its next message boundary.
            self.send_message(agent, message).await?;
            return Ok(serde_json::json!({ "delivered": true, "triggeredTurn": false }));
        }
        let prior = {
            let agents = lock(&self.agents);
            agents
                .get(agent)
                .and_then(|entry| lock_output(&entry.final_output).clone())
                .unwrap_or_default()
        };
        let prompt = format!(
            "Earlier you completed {task_path}. Your final answer was:\n\n{}\n\nNew task:\n{message}",
            bounded_output(&prior, 2_000)
        );
        let child_id = self.spawn(
            ctx,
            task_path.rsplit('/').next().unwrap_or("task"),
            &prompt,
            None,
        )?;
        Ok(serde_json::json!({ "id": child_id, "triggeredTurn": true }))
    }
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
    ctx: RunContext,
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
) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        let token_for_check = token.clone();
        let parent_sink = ctx.parent_sink.clone();
        let sink_for_final = parent_sink.clone();
        let pipeline = oleafly_agent::ToolPipeline {
            registry: ctx.registry.clone(),
            gate: ctx.gate.clone(),
            token,
        };
        let event_id = id.clone();
        let event_label = label.clone();
        let initial_user_message = request
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
        let mut recorder = TurnRecorder::new(&id);
        recorder.seed_user_message(initial_user_message);
        let shared_recorder = Arc::new(Mutex::new(recorder));
        let record_sink = shared_recorder.clone();

        subagent_start_hook(&thread_id, &label, &ctx.project_id, &request);

        let _ = parent_sink.send(AgentEvent::SubagentUpdate {
            id: event_id.clone(),
            label: event_label.clone(),
            state: "started".into(),
            detail: None,
        });

        let outcome = oleafly_agent::run_agent_with_pipeline(
            &ctx.client,
            &ctx.resolved,
            request,
            &ctx.config,
            pipeline,
            Some(steer_rx),
            exec_owner_tagging_runner(exec_owner.clone(), ctx.tool_runner.clone()),
            move |event| {
                let state = match &event {
                    AgentEvent::StepStart { .. } => Some(("thinking", None)),
                    AgentEvent::ToolCallStart { name, .. } => Some(("tool", Some(name.clone()))),
                    AgentEvent::Steered { .. } => Some(("interacted", None)),
                    _ => None,
                };
                if let Some((state, detail)) = state {
                    let _ = parent_sink.send(AgentEvent::SubagentUpdate {
                        id: event_id.clone(),
                        label: event_label.clone(),
                        state: state.to_string(),
                        detail,
                    });
                }
                if let Ok(mut recorder) = record_sink.lock() {
                    recorder.record(&event);
                }
            },
        )
        .await;

        let (settled, output) = match &outcome {
            Ok(outcome) => {
                let text = if outcome.text.trim().is_empty() {
                    outcome
                        .error
                        .clone()
                        .unwrap_or_else(|| "The agent finished without a text answer.".into())
                } else {
                    outcome.text.clone()
                };
                if outcome.error.is_some() {
                    (SubagentStatus::Failed, text)
                } else {
                    (SubagentStatus::Done, text)
                }
            }
            Err(_) => (
                SubagentStatus::Failed,
                "the agent run failed before finishing".into(),
            ),
        };
        if token_for_check.is_cancelled() {
            // Interrupt wins over a clean finish raced against cancel.
            *lock_status(&status) = SubagentStatus::Interrupted;
        } else {
            *lock_status(&status) = settled;
        }
        *lock_output(&final_output) = Some(output.clone());

        let stopped_at_cap = matches!(&outcome, Ok(outcome) if outcome.stopped_at_cap);
        {
            let mut recorder = lock(&shared_recorder);
            recorder.finish(stopped_at_cap);
            let record = recorder.snapshot().clone();
            if let Ok(root) = crate::paths::oleafly_root() {
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
            }
        }

        subagent_stop_hook(&thread_id, &label, &output, settled);

        let _ = sink_for_final.send(AgentEvent::SubagentUpdate {
            id,
            label,
            state: match *lock_status(&status) {
                SubagentStatus::Done => "done".into(),
                SubagentStatus::Failed => "error".into(),
                SubagentStatus::Interrupted => "interrupted".into(),
                SubagentStatus::Running => "done".into(),
            },
            detail: Some(bounded_output(&output, 240)),
        });
        let _ = done_tx.send(true);
    })
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
            match manager.spawn(ctx, &args.task_name, &args.prompt, args.label) {
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
            for task in &tasks {
                let prompt = task
                    .get("prompt")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string();
                let label = task
                    .get("label")
                    .and_then(Value::as_str)
                    .map(str::to_string);
                match manager.spawn(ctx, "task", &prompt, label) {
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
        }
    }

    #[tokio::test]
    async fn interrupt_all_stops_only_running_children() {
        let manager = SubagentManager::default();
        let running_token = {
            let mut entry = dummy_entry("agent-1", SubagentStatus::Running);
            entry.handle = tokio::spawn(std::future::pending());
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
        running.handle = tokio::spawn(std::future::pending());
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
        manager.close("agent-2").unwrap();
        assert_eq!(
            cancelled.lock().unwrap().as_slice(),
            ["external:agent-1", "external:agent-2"]
        );
    }

    #[tokio::test]
    async fn a_missing_canceller_never_panics_on_interrupt() {
        let manager = SubagentManager::default();
        let mut entry = dummy_entry("agent-1", SubagentStatus::Running);
        entry.handle = tokio::spawn(std::future::pending());
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
    async fn dropping_a_manager_aborts_running_children() {
        let manager = SubagentManager::default();
        let mut entry = dummy_entry("agent-1", SubagentStatus::Running);
        entry.handle = tokio::spawn(std::future::pending());
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
