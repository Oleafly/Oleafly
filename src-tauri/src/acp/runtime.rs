use super::{
    attachments::{self, PromptInput},
    buffers::BufferSource,
    catalog,
    coalesce::Coalescer,
    export,
    hermes::{self, HermesMode, HermesSettings},
    host::SessionHost,
    permission_view,
    preferences::{AcpPreferences, AgentPreferences, AgentRuntimeInfo, PREFERENCES_KEY},
    providers,
    redact::Redactor,
    remote,
    review::{self, ReviewHooks},
    skill_block::PromptSkill,
    store::Store,
    transcript,
    types::{
        new_id, now_ms, AcpEvent, AgentDefinition, AgentStatus, Capabilities, ElicitationView,
        EventPage, ImagePrompt, PermissionRequest, RemoteTarget, SessionControls, SessionRecord,
        SessionSnapshot, SessionStatus, SessionUsage, StartSession, SteerOutcome, UsageCounters,
    },
};
use oleafly_acp::{
    AcpClient, ClientInfo, ClientOptions, IncomingRequest, InitializeError, RpcError, TurnTiming,
};
use serde::Serialize;
use serde_json::{json, Value};
use std::{
    collections::{HashMap, HashSet},
    path::{Component, Path, PathBuf},
    sync::{
        atomic::{AtomicBool, AtomicU32, Ordering},
        Arc, Mutex, OnceLock, Weak,
    },
    time::{Duration, Instant},
};
use tokio::sync::{broadcast, watch, Mutex as AsyncMutex};

pub(super) const REQUEST_TIMEOUT: Duration = Duration::from_secs(60);
const PERMISSION_TIMEOUT_MS: u64 = 120_000;
const CANCEL_GRACE: Duration = Duration::from_secs(10);
/// How long a closed session stays registered while its last turn finishes
/// (the before-turn copy's own hooks are bounded at 10 s each).
const RELEASE_WAIT: Duration = Duration::from_secs(25);
const MAX_SESSION_BYTES: usize = 64 * 1024 * 1024;
const MAX_LIVE_SESSIONS: usize = 8;
const SUMMARY_INTERVAL: Duration = Duration::from_millis(250);
const QUIT_BUDGET: Duration = Duration::from_secs(8);
const MAX_TITLE: usize = 80;

pub(super) struct PendingPermission {
    pub(super) request: PermissionRequest,
    /// Answers the agent's request (the SDK keeps its JSON-RPC id).
    pub(super) responder: IncomingRequest,
    /// A research task's approval queue holds the request and keeps its own
    /// deadline, so the card's 120 s expiry does not apply to it.
    pub(super) task_queue: bool,
}

pub(super) struct PendingElicitation {
    pub(super) view: ElicitationView,
    pub(super) responder: IncomingRequest,
}

pub(super) struct LiveState {
    pub(super) record: SessionRecord,
    /// The record as last written to the store; events only rewrite the
    /// record JSON when it changed.
    pub(super) saved: Option<SessionRecord>,
    pub(super) permissions: HashMap<String, PendingPermission>,
    pub(super) elicitations: HashMap<String, PendingElicitation>,
    pub(super) replaying: bool,
    pub(super) cancelled: bool,
    pub(super) bytes: usize,
    /// Latest content of this turn's tool calls, joined to permission requests.
    pub(super) tool_calls: HashMap<String, permission_view::ToolCallView>,
    /// The folder of the skill attached to the running turn.
    pub(super) skill_folder: Option<PathBuf>,
    /// Text of a hidden plan-usage turn while one runs.
    pub(super) hidden: Option<String>,
    /// The hidden turn started a tool: the command runs the model, not the
    /// agent's own usage report, and the turn was cancelled.
    pub(super) hidden_tools: bool,
    /// Streamed text held before it is stored.
    pub(super) coalescer: Coalescer,
    pub(super) flush_timer: bool,
    /// Compaction summaries being streamed, by id.
    pub(super) compactions: HashMap<String, super::updates::Compaction>,
    /// The title is still the default one: the first message names it.
    pub(super) default_title: bool,
    /// Updates that arrived before the agent's session id was known (right
    /// after `session/new`), applied once it is.
    pub(super) early: Vec<Value>,
    /// The agent ended the running turn (the client saw its prompt reply,
    /// in order with its updates), and the turn may not be finished here
    /// yet: what the agent sends for the turn from now on is late.
    pub(super) turn_closed: bool,
}

/// A task agent's home, removed with its session unless it is kept (the
/// second field) for a handoff or the next generation.
pub(super) struct TaskTemp(pub(super) PathBuf, bool);
impl Drop for TaskTemp {
    fn drop(&mut self) {
        if !self.1 {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }
}

/// Why a message failed, as `acp_prompt` reports it: a plain string when
/// the message never reached the transcript (like every other command's
/// error), or `{"delivered": true, "message": "…"}` when it was delivered
/// and the turn then ended in an error.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(untagged)]
pub enum PromptFailure {
    NotSent(String),
    Delivered { delivered: bool, message: String },
}

impl PromptFailure {
    pub fn into_message(self) -> String {
        match self {
            Self::NotSent(message) | Self::Delivered { message, .. } => message,
        }
    }
}

impl From<String> for PromptFailure {
    fn from(message: String) -> Self {
        Self::NotSent(message)
    }
}

impl From<&str> for PromptFailure {
    fn from(message: &str) -> Self {
        Self::NotSent(message.to_owned())
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum PermissionDelegate {
    #[default]
    None,
    ParentChat,
}

pub(super) struct LiveSession {
    pub(super) state: Mutex<LiveState>,
    pub(super) client: Arc<AcpClient>,
    pub(super) operation: AsyncMutex<()>,
    pub(super) owner: Option<String>,
    pub(super) owner_tag: Option<Arc<str>>,
    pub(super) mcp_servers: Mutex<Vec<Value>>,
    pub(super) redactor: Redactor,
    pub(super) task_temp: Option<TaskTemp>,
    /// A research task's command policy (tasks only).
    pub(super) task_commands: Option<super::types::TaskCommands>,
    pub(super) delegate: Mutex<PermissionDelegate>,
    /// True while a permission card or a question is open: the turn's
    /// inactivity clock is paused.
    pub(super) pending: watch::Sender<bool>,
    /// An `authenticate` request is in flight (request-scoped questions are
    /// accepted only then).
    pub(super) authenticating: AtomicBool,
    /// Set when a question arrives during sign-in: the 180 s sign-in timer
    /// stops.
    pub(super) auth_asked: watch::Sender<bool>,
    /// Agent session ids this connection forked; their updates are ignored.
    pub(super) known_foreign: Mutex<HashSet<String>>,
    /// A fork is under way: updates for sessions this connection did not
    /// open are ignored until the new id is known.
    pub(super) forking: AtomicBool,
    /// How often the session was moved out of a blocked mode.
    pub(super) mode_switches: AtomicU32,
    /// The agent provider routed through an Oleafly key, for `providers/disable`.
    pub(super) routed: Mutex<Option<String>>,
    /// The agent's process id, while it is listed for orphan cleanup.
    pub(super) pid: Option<u32>,
    /// Set while a handoff moves the task home away: releasing the session
    /// then leaves the home alone.
    pub(super) keep_home: AtomicBool,
}

/// The command a task's agent asks to run, for the approval request (at
/// most 16 KiB, with the session's secrets removed).
fn task_command_detail(redactor: &Redactor, tool_call: &Value) -> String {
    const MAX_DETAIL: usize = 16 * 1024;
    let command = match &tool_call["rawInput"]["command"] {
        Value::String(text) => text.clone(),
        Value::Array(parts) => parts
            .iter()
            .filter_map(Value::as_str)
            .collect::<Vec<_>>()
            .join(" "),
        _ => tool_call["title"].as_str().unwrap_or_default().to_string(),
    };
    let mut detail = redactor.text(&command);
    if detail.len() > MAX_DETAIL {
        let mut end = MAX_DETAIL;
        while !detail.is_char_boundary(end) {
            end -= 1;
        }
        detail.truncate(end);
    }
    detail
}

/// A command of a research task that waits in the task's approval queue.
struct QueuedCommand {
    approval: Arc<dyn super::types::TaskCommandApproval>,
    /// The card's summary.
    summary: String,
    /// The command, redacted.
    detail: String,
}

/// How a research task's permission request is handled without a card.
struct TaskPolicy {
    /// The request is refused: a deny rule, the task's command policy or a
    /// file request that names no path.
    refuse: bool,
    queued: Option<QueuedCommand>,
}

/// The task's policy for a request. A task works on a temporary copy and
/// nobody answers its cards, so it never waits for one. The original
/// project's deny rules still hold. The runtime lives in the data folder
/// next to them.
fn task_policy(
    data_root: Option<&Path>,
    session: &LiveSession,
    project_id: &str,
    request: &PermissionRequest,
    tool_call: &Value,
    policy: &Value,
) -> TaskPolicy {
    let is_task = session.task_temp.is_some();
    let kind = request.kind.as_deref();
    let refused = is_task && crate::approvals::task_request_refused(data_root, project_id, kind);
    // The task's command policy: off refuses commands, ask first sends them
    // to the task's approval queue (the queue's own day-long expiry replaces
    // the card's; the task's cancel ends the wait).
    let command = is_task && !refused && kind == Some("execute");
    let commands_off =
        command && matches!(session.task_commands, Some(super::types::TaskCommands::Off));
    let queued = match &session.task_commands {
        Some(super::types::TaskCommands::Ask(approval)) if command => Some(QueuedCommand {
            approval: approval.clone(),
            summary: request.title.chars().take(300).collect::<String>(),
            detail: task_command_detail(&session.redactor, tool_call),
        }),
        _ => None,
    };
    // A task answers file requests itself, so a read or change that names
    // no path at all is not allowed on a guess.
    let paths_unknown = is_task
        && matches!(kind, Some("read" | "edit" | "delete" | "move"))
        && !permission_view::names_paths(policy);
    TaskPolicy {
        refuse: refused || commands_off || paths_unknown,
        queued,
    }
}

impl Drop for LiveSession {
    fn drop(&mut self) {
        if let Ok(servers) = self.mcp_servers.get_mut() {
            for server in servers {
                oleafly_acp::redact::clear_value(server);
            }
        }
        // A home kept for a handoff or a retry outlives the session.
        if *self.keep_home.get_mut() {
            if let Some(home) = self.task_temp.as_mut() {
                home.1 = true;
            }
        }
    }
}

#[derive(Default)]
struct StartupState {
    stopping: bool,
    pending: usize,
}

pub struct StartupGuard<'a> {
    runtime: &'a AcpRuntime,
}

impl Drop for StartupGuard<'_> {
    fn drop(&mut self) {
        if let Ok(mut state) = self.runtime.startup.lock() {
            state.pending -= 1;
            self.runtime.startup_count.send_replace(state.pending);
        }
    }
}

/// A place among the live sessions held for one whose agent is starting.
/// Dropping it frees the place (the session is registered by then, or the
/// start failed).
pub(super) struct SlotReservation {
    runtime: Arc<AcpRuntime>,
    id: String,
}

impl Drop for SlotReservation {
    fn drop(&mut self) {
        if let Ok(mut starting) = self.runtime.starting.lock() {
            starting.remove(&self.id);
        }
    }
}

/// Status, title and progress of a session, sent to every window so lists
/// and busy indicators stay current without transcripts.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionSummary {
    pub project_id: String,
    pub session_id: String,
    pub agent_id: String,
    pub title: String,
    pub status: SessionStatus,
    pub updated_at: u64,
    pub last_sequence: u64,
}

/// How long a closed owner is remembered: no start takes this long.
const OWNER_MEMORY: Duration = Duration::from_secs(10 * 60);

/// When owners (windows, tasks, helper agents) closed, as tickets of one
/// counter: a start made with a ticket taken before its owner closed is
/// refused. Owners closed long ago are forgotten (tasks and helper agents
/// are many over an app's life); `floor` is the newest ticket forgotten, so
/// a start older than that is refused whatever its owner.
#[derive(Default)]
struct OwnerEpochs {
    tick: u64,
    closed: HashMap<String, (u64, Instant)>,
    floor: u64,
}

impl OwnerEpochs {
    fn ticket(&self) -> u64 {
        self.tick
    }

    fn close(&mut self, owner: &str, now: Instant) {
        self.tick += 1;
        self.closed.insert(owner.to_owned(), (self.tick, now));
        let floor = &mut self.floor;
        self.closed.retain(|_, (ticket, at)| {
            let keep = now.duration_since(*at) < OWNER_MEMORY;
            if !keep {
                *floor = (*floor).max(*ticket);
            }
            keep
        });
    }

    fn is_current(&self, owner: &str, ticket: u64) -> bool {
        match self.closed.get(owner) {
            Some((closed, _)) => *closed <= ticket,
            None => ticket >= self.floor,
        }
    }
}

#[derive(Default)]
struct SummaryThrottle {
    last_sent: Option<Instant>,
    pending: Option<SessionSummary>,
    timer: bool,
}

pub struct AcpRuntime {
    pub(super) root: PathBuf,
    pub(super) store: Store,
    pub(super) live: AsyncMutex<HashMap<String, Arc<LiveSession>>>,
    /// Ids of sessions whose agent is starting: they count toward the
    /// limit without being in `live`, which stays free while they start.
    starting: Mutex<HashSet<String>>,
    /// Short-lived agent connections (history, import), stopped with the app.
    transient: Mutex<Vec<Weak<AcpClient>>>,
    /// The last short-lived connection, kept briefly for the next page or
    /// the import that follows a listing.
    pub(super) idle_transient: Mutex<Option<super::sessions::IdleTransient>>,
    events: broadcast::Sender<AcpEvent>,
    summaries: broadcast::Sender<SessionSummary>,
    summary_throttle: Mutex<HashMap<String, SummaryThrottle>>,
    installing: AsyncMutex<HashSet<String>>,
    registry: AsyncMutex<Option<(u64, Vec<catalog::RegistryEntry>)>>,
    resources: Mutex<HashMap<String, Box<dyn std::any::Any + Send + Sync>>>,
    owner_epochs: Mutex<OwnerEpochs>,
    startup: Mutex<StartupState>,
    startup_count: watch::Sender<usize>,
    review: ReviewHooks,
    pub(super) buffers: OnceLock<Arc<dyn BufferSource>>,
    /// Agents (and programs) that answered a v2 request with v1 this run.
    v1_only: Mutex<HashSet<(String, PathBuf)>>,
    pids: OnceLock<oleafly_acp::orphans::PidRegistry>,
    this: Weak<AcpRuntime>,
}

/// Why `initialize` did not finish.
enum InitFailure {
    FallBackToV1,
    Failed(String),
}

impl AcpRuntime {
    pub fn new(root: PathBuf) -> Result<Arc<Self>, String> {
        Self::with_review_hooks(root, ReviewHooks::default())
    }

    pub(crate) fn with_review_hooks(
        root: PathBuf,
        review: ReviewHooks,
    ) -> Result<Arc<Self>, String> {
        let store = Store::open(&root)?;
        let (events, _) = broadcast::channel(2048);
        let (summaries, _) = broadcast::channel(512);
        let runtime = Arc::new_cyclic(|this| Self {
            root,
            store,
            live: AsyncMutex::new(HashMap::new()),
            starting: Mutex::new(HashSet::new()),
            transient: Mutex::new(Vec::new()),
            idle_transient: Mutex::new(None),
            events,
            summaries,
            summary_throttle: Mutex::new(HashMap::new()),
            installing: AsyncMutex::new(HashSet::new()),
            registry: AsyncMutex::new(None),
            resources: Mutex::new(HashMap::new()),
            owner_epochs: Mutex::new(OwnerEpochs::default()),
            startup: Mutex::new(StartupState::default()),
            startup_count: watch::channel(0).0,
            review,
            buffers: OnceLock::new(),
            v1_only: Mutex::new(HashSet::new()),
            pids: OnceLock::new(),
            this: this.clone(),
        });
        // Task homes left by a crash hold copies of the user's sign-in files.
        // No session is live yet: they move aside now, before any start, and
        // are deleted with the rest off the startup path.
        let _ = std::fs::rename(
            runtime.root.join("task-temp"),
            runtime.root.join(format!("{STALE_TASK_TEMP}{}", new_id())),
        );
        // Old bridge versions left by earlier updates are removed once, off
        // the startup path.
        let cleanup_root = runtime.root.clone();
        let weak = Arc::downgrade(&runtime);
        std::thread::spawn(move || {
            remove_stale_task_temp(&cleanup_root);
            startup_cleanup(&cleanup_root, helper_is_running(&cleanup_root));
            if let Some(runtime) = weak.upgrade() {
                runtime.forget_old_task_homes();
            }
        });
        Ok(runtime)
    }

    /// Removes agent homes kept for task sessions that are gone or untouched
    /// for 30 days.
    fn forget_old_task_homes(&self) {
        const KEEP: u64 = 30 * 24 * 60 * 60 * 1000;
        let Ok(entries) = std::fs::read_dir(self.root.join("task-homes")) else {
            return;
        };
        let now = now_ms();
        for entry in entries.flatten() {
            let id = entry.file_name().to_string_lossy().into_owned();
            let kept = self
                .store
                .get(&id)
                .is_ok_and(|record| now.saturating_sub(record.updated_at) < KEEP);
            if !kept {
                let _ = std::fs::remove_dir_all(entry.path());
            }
        }
    }

    /// Where open editor text comes from (the app's windows).
    pub(super) fn set_buffer_source(&self, source: Arc<dyn BufferSource>) {
        let _ = self.buffers.set(source);
    }

    /// Lists every started agent in `agents.pids` for orphan cleanup.
    pub(super) fn set_pid_registry(&self, registry: oleafly_acp::orphans::PidRegistry) {
        let _ = self.pids.set(registry);
    }

    pub fn begin_startup(&self) -> Result<StartupGuard<'_>, String> {
        let mut state = self
            .startup
            .lock()
            .map_err(|_| "The ACP runtime is unavailable.")?;
        if state.stopping {
            return Err("Oleafly is closing. The agent cannot start.".into());
        }
        state.pending += 1;
        self.startup_count.send_replace(state.pending);
        Ok(StartupGuard { runtime: self })
    }

    pub async fn retain_resource<T: Send + Sync + 'static>(
        &self,
        id: &str,
        resource: T,
    ) -> Result<(), String> {
        let sessions = self.live.lock().await;
        let session = sessions
            .get(id)
            .ok_or("This ACP session disconnected before its resources could be attached.")?;
        if session.client.is_closed() {
            return Err("This ACP session is disconnected.".into());
        }
        self.resources
            .lock()
            .map_err(|_| "The ACP session resources are unavailable.")?
            .insert(id.into(), Box::new(resource));
        Ok(())
    }

    /// A ticket for starting a session of `_owner`: the start is refused
    /// once the owner closes after the ticket was taken.
    pub fn owner_generation(&self, _owner: &str) -> u64 {
        self.owner_epochs
            .lock()
            .map(|epochs| epochs.ticket())
            .unwrap_or(0)
    }

    fn owner_is_current(&self, owner: Option<&str>, generation: Option<u64>) -> bool {
        self.startup.lock().is_ok_and(|state| !state.stopping)
            && owner.zip(generation).is_none_or(|(owner, generation)| {
                self.owner_epochs
                    .lock()
                    .is_ok_and(|epochs| epochs.is_current(owner, generation))
            })
    }

    pub fn stop_all_now(&self) {
        if let Ok(mut state) = self.startup.lock() {
            state.stopping = true;
        }
        if let Ok(sessions) = self.live.try_lock() {
            for session in sessions.values() {
                session.client.request_stop();
            }
        }
        if let Ok(transient) = self.transient.lock() {
            for client in transient.iter().filter_map(Weak::upgrade) {
                client.request_stop();
            }
        }
        if let Ok(mut idle) = self.idle_transient.lock() {
            idle.take();
        }
        if let Ok(mut resources) = self.resources.lock() {
            resources.clear();
        }
    }

    pub fn subscribe(&self) -> broadcast::Receiver<AcpEvent> {
        self.events.subscribe()
    }
    pub fn subscribe_summaries(&self) -> broadcast::Receiver<SessionSummary> {
        self.summaries.subscribe()
    }
    pub fn events(&self, id: &str, after: u64, limit: usize) -> Result<EventPage, String> {
        self.store.events(id, after, limit)
    }
    /// Every stored event of a conversation, oldest first.
    pub fn events_all(&self, id: &str) -> Result<Vec<AcpEvent>, String> {
        self.store.events_all(id)
    }
    /// Writes a saved conversation as pretty JSON to a path the user chose.
    pub fn export_session(&self, id: &str, destination: &str) -> Result<(), String> {
        export::write_export(&self.store, id, destination)
    }
    #[cfg(test)]
    pub fn list(&self, project_id: &str) -> Result<Vec<SessionRecord>, String> {
        self.store.list(Some(project_id), 200)
    }
    pub fn all_sessions(
        &self,
        after_id: Option<&str>,
        limit: usize,
    ) -> Result<Vec<SessionRecord>, String> {
        self.store.sessions_page(after_id, limit)
    }
    pub fn sessions_page(
        &self,
        after_id: Option<&str>,
        limit: usize,
    ) -> Result<Vec<SessionRecord>, String> {
        self.all_sessions(after_id, limit)
    }
    pub fn record(&self, id: &str) -> Result<SessionRecord, String> {
        self.store.get(id)
    }

    pub(super) fn definition(&self, id: &str) -> Result<AgentDefinition, String> {
        catalog::builtins()
            .into_iter()
            .chain(self.store.agents()?)
            .find(|value| value.id == id)
            .ok_or_else(|| "This ACP agent is not registered.".into())
    }

    pub async fn catalog(&self, probe: bool) -> Result<Vec<AgentStatus>, String> {
        if probe {
            crate::program_locator::refresh();
        }
        let programs = self.store.agent_programs()?;
        let statuses = catalog::builtins()
            .into_iter()
            .chain(self.store.agents()?)
            .map(|definition| {
                let program = programs.get(&definition.id).cloned();
                catalog::status_with(&self.root, definition, probe, program)
            });
        let mut statuses = futures_util::future::join_all(statuses).await;
        for status in &mut statuses {
            status.runtime = self
                .store
                .agent_runtime(&status.definition.id)
                .unwrap_or(None);
        }
        Ok(statuses)
    }

    /// The status of one agent, with the program the user chose for it.
    pub async fn agent_status(&self, id: &str, probe: bool) -> Result<AgentStatus, String> {
        let definition = self.definition(id)?;
        let program = self.store.agent_program(id)?;
        let mut status = catalog::status_with(&self.root, definition, probe, program).await;
        status.runtime = self.store.agent_runtime(id).unwrap_or(None);
        Ok(status)
    }

    /// The definition of a built-in or registered agent.
    pub fn agent_definition(&self, id: &str) -> Result<AgentDefinition, String> {
        self.definition(id)
    }

    /// Saves (or clears) the program the user chose for an agent. The path
    /// was checked by the caller.
    pub fn save_agent_program(&self, id: &str, path: Option<&Path>) -> Result<(), String> {
        self.definition(id)?;
        self.store.set_agent_program(
            id,
            path.map(|path| path.to_string_lossy().into_owned())
                .as_deref(),
        )
    }

    /// Tests an agent's programs without saving anything: `candidate`, or the
    /// program Oleafly would use today. One check per agent at a time.
    pub async fn check_agent(
        &self,
        id: &str,
        candidate: Option<PathBuf>,
    ) -> Result<super::AgentCheck, String> {
        let definition = self.definition(id)?;
        let _flight = super::setup::CheckFlight::enter(&format!("{}\n{id}", self.root.display()))?;
        let _startup = self.begin_startup()?;
        let saved = self.store.agent_program(id)?;
        let mut check = super::setup::check_agent(&self.root, &definition, candidate, saved).await;
        if let Some(runtime) = check.runtime.take() {
            let _ = self.store.set_agent_runtime(id, &runtime);
        }
        Ok(check)
    }

    pub fn register(&self, json: &str) -> Result<AgentDefinition, String> {
        if json.len() > 64 * 1024 {
            return Err("The agent definition exceeds 64 KiB.".into());
        }
        let mut definition: AgentDefinition = serde_json::from_str(json)
            .map_err(|_| "The agent definition is not valid distribution JSON.")?;
        if catalog::builtins()
            .iter()
            .any(|value| value.id == definition.id)
        {
            return Err("Built-in agent definitions cannot be replaced.".into());
        }
        if self.store.agents()?.len() >= 100
            && !self.store.agents()?.iter().any(|v| v.id == definition.id)
        {
            return Err("You can register up to 100 custom agents.".into());
        }
        definition.builtin = false;
        catalog::validate(&definition)?;
        self.store.register(&definition)?;
        Ok(definition)
    }

    async fn agent_in_use(&self, id: &str) -> bool {
        self.live.lock().await.values().any(|session| {
            session
                .state
                .lock()
                .is_ok_and(|state| state.record.agent_id == id)
        })
    }

    pub async fn remove_agent(&self, id: &str) -> Result<(), String> {
        if self.agent_in_use(id).await {
            return Err("Disconnect this agent's sessions before removing its definition.".into());
        }
        self.store.remove_agent(id)
    }

    pub async fn install(&self, id: &str) -> Result<AgentStatus, String> {
        let definition = self.definition(id)?;
        {
            let mut installing = self.installing.lock().await;
            if !installing.insert(id.into()) {
                return Err("This agent is already being installed.".into());
            }
        }
        let result = catalog::install(&self.root, &definition).await;
        self.installing.lock().await.remove(id);
        result?;
        if !self.agent_in_use(id).await {
            let root = self.root.clone();
            let keep = definition.version.clone();
            let cleaned = definition.clone();
            let _ =
                catalog::blocking(move || catalog::cleanup_old_versions(&root, &cleaned, &keep))
                    .await;
        }
        let program = self.store.agent_program(id)?;
        let mut status = catalog::status_with(&self.root, definition, true, program).await;
        status.runtime = self.store.agent_runtime(id).unwrap_or(None);
        Ok(status)
    }

    pub async fn registry_search(
        &self,
        query: &str,
    ) -> Result<Vec<catalog::RegistryEntry>, String> {
        if query.len() > 200 {
            return Err("The registry search is too long.".into());
        }
        let mut cache = self.registry.lock().await;
        if cache
            .as_ref()
            .is_none_or(|(time, _)| now_ms().saturating_sub(*time) > 300_000)
        {
            *cache = Some((now_ms(), catalog::registry_search("").await?));
        }
        let query = query.to_lowercase();
        Ok(cache
            .as_ref()
            .map(|(_, entries)| {
                entries
                    .iter()
                    .filter(|v| {
                        format!("{} {} {}", v.id, v.name, v.description)
                            .to_lowercase()
                            .contains(&query)
                    })
                    .take(100)
                    .cloned()
                    .collect()
            })
            .unwrap_or_default())
    }

    // Preferences ---------------------------------------------------------

    pub fn preferences(&self) -> AcpPreferences {
        self.store
            .preference::<AcpPreferences>(PREFERENCES_KEY)
            .unwrap_or_default()
            .normalized()
    }

    pub async fn set_preferences(
        self: &Arc<Self>,
        prefs: AcpPreferences,
    ) -> Result<AcpPreferences, String> {
        let prefs = prefs.normalized();
        let before = self.preferences();
        self.store.set_preference(PREFERENCES_KEY, &prefs)?;
        if before.experimental_providers && !prefs.experimental_providers {
            self.disable_routes(None).await;
        }
        Ok(prefs)
    }

    pub fn agent_preferences(&self, agent_id: &str) -> Result<AgentPreferences, String> {
        self.definition(agent_id)?;
        self.store.agent_preferences(agent_id)
    }

    pub async fn set_agent_preferences(
        self: &Arc<Self>,
        agent_id: &str,
        prefs: AgentPreferences,
    ) -> Result<AgentPreferences, String> {
        self.definition(agent_id)?;
        let prefs = prefs.normalized();
        let before = self.store.agent_preferences(agent_id)?;
        self.store.set_agent_preferences(agent_id, &prefs)?;
        if before.provider.is_some() && prefs.provider.is_none() {
            self.disable_routes(Some(agent_id)).await;
        }
        Ok(prefs)
    }

    /// Changes one of an agent's remembered choices (`effort`, `mode` or
    /// `provider`; `null` forgets it) and keeps the others as stored.
    pub async fn set_agent_preference(
        self: &Arc<Self>,
        agent_id: &str,
        slot: &str,
        value: Value,
    ) -> Result<AgentPreferences, String> {
        self.definition(agent_id)?;
        let choice = |value: Value| {
            serde_json::from_value::<Option<super::preferences::RememberedChoice>>(value)
                .map_err(|_| "This choice is not valid.".to_string())
        };
        let patch: Box<dyn FnOnce(&mut AgentPreferences) + Send> = match slot {
            "effort" => {
                let value = choice(value)?;
                Box::new(move |prefs| prefs.effort = value)
            }
            "mode" => {
                let value = choice(value)?;
                Box::new(move |prefs| prefs.mode = value)
            }
            "provider" => {
                let value = serde_json::from_value::<Option<String>>(value)
                    .map_err(|_| "This provider is not valid.")?;
                Box::new(move |prefs| prefs.provider = value)
            }
            _ => return Err("Choose effort, mode or provider.".into()),
        };
        let (before, after) = {
            let runtime = self.clone();
            let agent_id = agent_id.to_owned();
            tokio::task::spawn_blocking(move || {
                runtime.store.patch_agent_preferences(&agent_id, patch)
            })
            .await
            .map_err(|_| "The agent's preferences could not be saved.")??
        };
        if before.provider.is_some() && after.provider.is_none() {
            self.disable_routes(Some(agent_id)).await;
        }
        Ok(after)
    }

    /// Turns routing through Oleafly keys off on live sessions (of one agent,
    /// or all); the agents fall back to their own sign-in.
    async fn disable_routes(self: &Arc<Self>, agent_id: Option<&str>) {
        let sessions: Vec<_> = self.live.lock().await.values().cloned().collect();
        for session in sessions {
            let Ok(record) = self.copy_record(&session) else {
                continue;
            };
            if agent_id.is_some_and(|agent| agent != record.agent_id)
                || record.routed_provider.is_none()
            {
                continue;
            }
            let target = session
                .routed
                .lock()
                .ok()
                .and_then(|mut routed| routed.take());
            let result = match &target {
                Some(provider) => session
                    .client
                    .request(
                        oleafly_acp::providers::PROVIDERS_DISABLE,
                        json!({"providerId": provider}),
                        REQUEST_TIMEOUT,
                    )
                    .await
                    .map(|_| ())
                    .map_err(|error| session.redactor.text(&error.to_string())),
                None => Ok(()),
            };
            if let Ok(mut state) = session.state.lock() {
                let provider = state.record.routed_provider.take().unwrap_or_default();
                if let Err(error) = result {
                    let _ = self.emit_locked(
                        &session,
                        &mut state,
                        "notice",
                        json!({"severity": "warning",
                            "title": format!("Oleafly could not stop routing this agent through your {provider} key."),
                            "description": error}),
                    );
                }
                let controls = serde_json::to_value(&state.record.controls).unwrap_or(Value::Null);
                let _ = self.emit_locked(
                    &session,
                    &mut state,
                    "controls",
                    json!({"controls": controls}),
                );
            }
        }
    }

    /// The provider protocols an agent reported (`providers/list`).
    pub fn agent_supported_providers(&self, agent_id: &str) -> Vec<String> {
        self.store
            .agent_runtime(agent_id)
            .ok()
            .flatten()
            .map(|info| info.providers_supported)
            .unwrap_or_default()
    }

    // Sessions ------------------------------------------------------------

    #[cfg(test)]
    pub async fn start(self: &Arc<Self>, options: StartSession) -> Result<SessionSnapshot, String> {
        self.start_with_mcp(options, Vec::new()).await
    }

    pub async fn start_with_mcp(
        self: &Arc<Self>,
        options: StartSession,
        mcp_servers: Vec<Value>,
    ) -> Result<SessionSnapshot, String> {
        let generation = options
            .owner
            .as_deref()
            .map(|owner| self.owner_generation(owner));
        self.start_with_mcp_at_generation(options, mcp_servers, generation)
            .await
    }

    pub async fn start_with_mcp_at_generation(
        self: &Arc<Self>,
        options: StartSession,
        mcp_servers: Vec<Value>,
        generation: Option<u64>,
    ) -> Result<SessionSnapshot, String> {
        crate::trust::require_trusted(
            &options.project_id,
            crate::trust::Capability::ExternalAgents,
        )?;
        if options.allowed_paths.is_some() && options.task_id.is_none() {
            return Err("An isolated ACP session needs a research task ID.".into());
        }
        let root = canonical_root(&options.project_path)?;
        let definition = self.definition(&options.agent_id)?;
        let (start_revision, start_dirty) = if options.task_id.is_none() {
            review::start_revision(&self.review, &root).await
        } else {
            (None, None)
        };
        let permission_profile = if options.task_id.is_none() {
            self.root
                .parent()
                .and_then(|data| crate::approvals::mode_name(data, &options.project_id))
        } else {
            None
        };
        let time = now_ms();
        let record = SessionRecord {
            id: new_id(),
            project_id: options.project_id,
            project_path: root.to_string_lossy().into_owned(),
            agent_id: definition.id.clone(),
            parent_session_id: options.parent_session_id,
            task_id: options.task_id,
            title: default_title(&definition),
            status: SessionStatus::Connecting,
            created_at: time,
            updated_at: time,
            capabilities: Capabilities::default(),
            controls: SessionControls::default(),
            start_revision,
            start_dirty,
            permission_profile,
            ..SessionRecord::default()
        };
        self.connect(
            record,
            options.owner,
            mcp_servers,
            options.allowed_paths,
            options.task_commands,
            generation,
        )
        .await
    }

    #[cfg(test)]
    pub async fn reconnect(
        self: &Arc<Self>,
        id: &str,
        owner: Option<String>,
    ) -> Result<SessionSnapshot, String> {
        self.reconnect_with_mcp(id, owner, Vec::new()).await
    }

    pub async fn reconnect_with_mcp(
        self: &Arc<Self>,
        id: &str,
        owner: Option<String>,
        mcp_servers: Vec<Value>,
    ) -> Result<SessionSnapshot, String> {
        let generation = owner.as_deref().map(|owner| self.owner_generation(owner));
        self.reconnect_with_mcp_at_generation(id, owner, mcp_servers, generation)
            .await
    }

    pub async fn reconnect_with_mcp_at_generation(
        self: &Arc<Self>,
        id: &str,
        owner: Option<String>,
        mcp_servers: Vec<Value>,
        generation: Option<u64>,
    ) -> Result<SessionSnapshot, String> {
        if let Ok(session) = self.get_live(id).await {
            if session.owner != owner {
                return Err("This ACP session belongs to another window or task.".into());
            }
            if !session.client.is_closed() {
                return Err("This ACP session is already connected.".into());
            }
            // The agent is gone but its last turn may still be saving events.
            self.release_when_idle(&session).await;
            if self.get_live(id).await.is_ok() {
                return Err("This ACP session is already connected.".into());
            }
        }
        let mut record = self.store.get(id)?;
        // Continue after every saved event, even when the stored record lags.
        record.last_sequence = record.last_sequence.max(self.store.last_sequence(id)?);
        crate::trust::require_trusted(
            &record.project_id,
            crate::trust::Capability::ExternalAgents,
        )?;
        if record.task_id.is_some() {
            return Err("Resume isolated work through its research task.".into());
        }
        if record.remote.is_none() {
            canonical_root(Path::new(&record.project_path))?;
        }
        if record.native_session_id.is_some()
            && !record.capabilities.load_session
            && !record.capabilities.resume
        {
            return Err("This agent cannot resume saved sessions. Start a new conversation to continue working.".into());
        }
        if record.native_session_id.is_some() {
            let definition = self.definition(&record.agent_id)?;
            let settings = self.hermes_settings(&definition, &record.project_id);
            if let Some(reason) = moved_target(&record, &settings) {
                return Err(reason.into());
            }
        }
        record.status = SessionStatus::Connecting;
        record.error = None;
        self.connect(record, owner, mcp_servers, None, None, generation)
            .await
    }

    /// Reconnects a research task's earlier agent session in the same
    /// workspace, so a retried task continues the agent's conversation.
    /// `native` is the agent's own session id the task recorded; the
    /// agent's home kept from that generation is where it starts.
    pub async fn resume_task_session(
        self: &Arc<Self>,
        native: &str,
        options: StartSession,
        mcp_servers: Vec<Value>,
        generation: Option<u64>,
    ) -> Result<SessionSnapshot, String> {
        let task_id = options
            .task_id
            .as_deref()
            .ok_or("Only a research task's agent session can be resumed.")?;
        let found = {
            let runtime = self.clone();
            let (task_id, agent_id, native) = (
                task_id.to_owned(),
                options.agent_id.clone(),
                native.to_owned(),
            );
            tokio::task::spawn_blocking(move || {
                runtime
                    .store
                    .find_task_session(&task_id, &agent_id, &native)
            })
            .await
            .map_err(|_| "The task's earlier agent session could not be read.")??
        };
        let mut record = found.ok_or("The task's earlier agent session was not found.")?;
        let record_id = record.id.clone();
        if self.get_live(&record_id).await.is_ok() {
            return Err("This ACP session is already connected.".into());
        }
        let same_task = record.task_id.is_some()
            && record.task_id == options.task_id
            && record.agent_id == options.agent_id
            && record.project_id == options.project_id
            && record.remote.is_none();
        let same_workspace = canonical_root(Path::new(&record.project_path)).ok()
            == canonical_root(&options.project_path).ok();
        if !same_task || !same_workspace {
            return Err("The task's earlier agent session belongs to another workspace.".into());
        }
        if record.native_session_id.is_none()
            || (!record.capabilities.load_session && !record.capabilities.resume)
        {
            return Err("This agent cannot resume saved sessions.".into());
        }
        crate::trust::require_trusted(
            &record.project_id,
            crate::trust::Capability::ExternalAgents,
        )?;
        record.last_sequence = record
            .last_sequence
            .max(self.store.last_sequence(&record_id)?);
        record.status = SessionStatus::Connecting;
        record.error = None;
        // The agent keeps its session history in its home: the one kept when
        // that generation ended, with its sign-in files copied fresh.
        let home = self.task_home(&record_id);
        if tokio::fs::symlink_metadata(&home)
            .await
            .is_ok_and(|metadata| metadata.is_dir())
        {
            remove_sign_in_files(&home, &record.agent_id).await;
            adopt_home(&record_id, &home);
        }
        let result = self
            .connect(
                record,
                options.owner,
                mcp_servers,
                options.allowed_paths,
                options.task_commands,
                generation,
            )
            .await;
        // Unused when the start failed before the agent ran.
        let _ = take_adopted_home(&record_id);
        result
    }

    /// Where a task session's agent home is kept between generations.
    fn task_home(&self, record_id: &str) -> PathBuf {
        self.root.join("task-homes").join(record_id)
    }

    /// Ends a research task's session at the end of its generation and
    /// keeps the agent's home (its own session history, without the sign-in
    /// files) for the next generation's [`Self::resume_task_session`]. When
    /// the home cannot be kept, the session is closed as usual.
    pub(crate) async fn end_task_session(self: &Arc<Self>, record_id: &str) -> Result<(), String> {
        let agent_id = match self.get_live(record_id).await {
            Ok(session) => self.copy_record(&session)?.agent_id,
            Err(_) => return Ok(()),
        };
        let home = self.task_home(record_id);
        match self.close_task_for_handoff(record_id, &home).await {
            Ok(_) => {
                remove_sign_in_files(&home, &agent_id).await;
                Ok(())
            }
            Err(_) => self.close(record_id).await,
        }
    }

    /// The Hermes settings a session of `definition` in `project_id` uses.
    pub(super) fn hermes_settings(
        &self,
        definition: &AgentDefinition,
        project_id: &str,
    ) -> HermesSettings {
        if definition.id != hermes::HERMES_ID {
            return HermesSettings::default();
        }
        self.store
            .project_agent_settings(project_id, hermes::HERMES_ID)
            .ok()
            .and_then(|settings| settings.hermes)
            .unwrap_or_default()
    }

    /// The launch for a session: the agent's own, a Hermes project profile,
    /// or `ssh` for remote Hermes.
    async fn session_launch(
        &self,
        definition: &AgentDefinition,
        record: &SessionRecord,
        settings: &HermesSettings,
        prefs: &AcpPreferences,
    ) -> Result<catalog::Launch, String> {
        if settings.mode == HermesMode::Remote {
            let remote = settings
                .remote
                .as_ref()
                .ok_or("Set up the remote machine for Hermes in its settings first.")?;
            remote::validate(remote)?;
            let ssh = remote::locate_ssh().ok_or(
                "Oleafly couldn't find ssh on this computer. Install OpenSSH, then try again.",
            )?;
            return Ok(catalog::Launch {
                executable: ssh,
                args: remote::ssh_args(remote),
                version: None,
                managed: false,
                batch: false,
                entry: None,
                needs_local_folder: false,
                env: Vec::new(),
            });
        }
        let program = self.store.agent_program(&definition.id)?;
        let chosen_launch =
            program.is_some() && catalog::program_role(definition) == catalog::ProgramRole::Launch;
        if let Some(required) = definition
            .distribution
            .npx
            .as_ref()
            .and_then(|v| v.node_major)
            .filter(|_| !chosen_launch)
        {
            catalog::check_node(&self.root, required).await?;
        }
        let mut launch = {
            let root = self.root.clone();
            let definition = definition.clone();
            catalog::blocking(move || {
                catalog::plan(&root, &definition, program.as_deref().map(Path::new)).launch
            })
            .await??
        };
        if settings.mode == HermesMode::Project {
            let definition_args = definition
                .distribution
                .command
                .as_ref()
                .map(|command| command.args.clone())
                .unwrap_or_default();
            hermes::apply_profile(&mut launch, &definition_args, &record.project_id, settings)?;
        }
        if definition.id == "claude" && prefs.experimental_v2 {
            launch
                .env
                .push(("CLAUDE_AGENT_ACP_EXPERIMENTAL_V2".into(), "1".into()));
        }
        Ok(launch)
    }

    async fn connect(
        self: &Arc<Self>,
        mut record: SessionRecord,
        owner: Option<String>,
        mcp_servers: Vec<Value>,
        allowed_paths: Option<Vec<String>>,
        task_commands: Option<super::types::TaskCommands>,
        generation: Option<u64>,
    ) -> Result<SessionSnapshot, String> {
        let _startup = self.begin_startup()?;
        if !self.owner_is_current(owner.as_deref(), generation) {
            return Err("The window or task closed while the agent was starting.".into());
        }
        let definition = self.definition(&record.agent_id)?;
        // Every task start (new, resumed or adopted) is checked: the
        // Windows sandbox switch or the agent may have changed since.
        if allowed_paths.is_some() {
            if let Some(reason) = catalog::task_unavailable_reason(&definition) {
                return Err(reason);
            }
        }
        let prefs = self.preferences();
        let settings = self.hermes_settings(&definition, &record.project_id);
        let remote_mode = settings.mode == HermesMode::Remote;
        if remote_mode && allowed_paths.is_some() {
            return Err("Remote Hermes cannot run research tasks.".into());
        }
        let launch = self
            .session_launch(&definition, &record, &settings, &prefs)
            .await?;
        if !self.owner_is_current(owner.as_deref(), generation) {
            return Err("The window or task closed while the agent was starting.".into());
        }
        if mcp_servers.len() > 32
            || serde_json::to_vec(&mcp_servers)
                .map_err(|e| e.to_string())?
                .len()
                > 64 * 1024
        {
            return Err("The ACP MCP configuration is too large.".into());
        }
        if remote_mode {
            let remote = settings
                .remote
                .as_ref()
                .ok_or("The remote machine is not set up.")?;
            record.remote = Some(RemoteTarget {
                host: remote.host.clone(),
                folder: remote.folder.clone(),
            });
        } else {
            record.remote = None;
        }
        let launch_root = if remote_mode {
            crate::paths::home_dir()?
        } else {
            launch_root_for(Path::new(&record.project_path))
        };
        let mut prefer_v2 = prefs.experimental_v2
            && !remote_mode
            && !self.v1_only.lock().is_ok_and(|known| {
                known.contains(&(definition.id.clone(), launch.executable.clone()))
            });
        // A v2 answer of "v1 only" restarts the agent once with v1.
        loop {
            let session = self
                .spawn_session(
                    &record,
                    &definition,
                    &launch,
                    &launch_root,
                    owner.clone(),
                    mcp_servers.clone(),
                    allowed_paths.clone(),
                    task_commands.clone(),
                    generation,
                )
                .await?;
            let id = record.id.clone();
            match self.initialize(&session, prefer_v2).await {
                Ok(()) => {
                    if !self.owner_is_current(session.owner.as_deref(), generation) {
                        self.close(&id).await?;
                        return Err(
                            "The window or task closed while the agent was starting.".into()
                        );
                    }
                    return self.snapshot(&id).await;
                }
                Err(InitFailure::FallBackToV1) if prefer_v2 => {
                    if let Ok(mut known) = self.v1_only.lock() {
                        known.insert((definition.id.clone(), launch.executable.clone()));
                    }
                    // The v1 restart starts in the same home: a task agent's
                    // history (an adopted home) must not go with this attempt.
                    if let Some(home) = &session.task_temp {
                        session.keep_home.store(true, Ordering::Release);
                        adopt_home(&record.id, &home.0);
                    }
                    session.client.shutdown().await;
                    // The respawn continues the same record: its events
                    // number on from the ones this attempt saved.
                    if let Ok(current) = self.copy_record(&session) {
                        record.last_sequence = record.last_sequence.max(current.last_sequence);
                        record.updated_at = record.updated_at.max(current.updated_at);
                    }
                    self.release_live(&session).await;
                    prefer_v2 = false;
                }
                Err(InitFailure::FallBackToV1) => {
                    let error = "The agent only supports ACP version 1.".to_string();
                    let _ = self.fail(&session, &error);
                    session.client.shutdown().await;
                    self.release_live(&session).await;
                    return Err(error);
                }
                Err(InitFailure::Failed(error)) => {
                    self.emit_diagnostics(&session);
                    let _ = self.fail(&session, &error);
                    session.client.shutdown().await;
                    self.release_live(&session).await;
                    return Err(session.redactor.text(&error));
                }
            }
        }
    }

    /// Starts the agent process and registers its live session.
    #[allow(clippy::too_many_arguments)]
    async fn spawn_session(
        self: &Arc<Self>,
        record: &SessionRecord,
        definition: &AgentDefinition,
        launch: &catalog::Launch,
        launch_root: &Path,
        owner: Option<String>,
        mcp_servers: Vec<Value>,
        allowed_paths: Option<Vec<String>>,
        task_commands: Option<super::types::TaskCommands>,
        generation: Option<u64>,
    ) -> Result<Arc<LiveSession>, String> {
        // The slot is reserved under the lock, and everything slow (folders,
        // credentials, the sandbox, the process itself) happens outside it:
        // cancelling or answering any other session never waits for a start.
        let reservation = self
            .reserve_slot(&record.id, owner.as_deref(), generation)
            .await?;
        let task_temp = if allowed_paths.is_some() {
            // 0.4.8 L: a session adopted from the background helper keeps the
            // agent's home, where the agent stores its own history.
            let path = match take_adopted_home(&record.id) {
                Some(home) => home,
                None => self.root.join("task-temp").join(new_id()),
            };
            tokio::fs::create_dir_all(&path)
                .await
                .map_err(|_| "The task temporary directory could not be created.")?;
            Some(TaskTemp(path, false))
        } else {
            None
        };
        let (redactor, command, bytes) = {
            // Credential copies, the sandbox's folder grants and the size of
            // the saved transcript are all file work.
            let runtime = self.clone();
            let record = record.clone();
            let definition = definition.clone();
            let launch = launch.clone();
            let launch_root = launch_root.to_path_buf();
            let allowed_paths = allowed_paths.clone();
            let temporary = task_temp.as_ref().map(|temporary| temporary.0.clone());
            let servers = mcp_servers.clone();
            tokio::task::spawn_blocking(move || {
                let redactor = match &temporary {
                    Some(temporary) => super::task_launch::prepare_credentials(
                        &crate::paths::home_dir()?,
                        temporary,
                        &definition.id,
                        &servers,
                    )?,
                    None => Redactor::new(&servers),
                };
                let command = build_agent_command(
                    &runtime.root,
                    &record,
                    &definition,
                    &launch,
                    &launch_root,
                    allowed_paths.as_deref(),
                    temporary.as_deref(),
                )?;
                let bytes = runtime.store.byte_count(&record.id)?;
                Ok::<_, String>((redactor, command, bytes))
            })
            .await
            .map_err(|_| "The agent could not be prepared.".to_string())??
        };
        let id = record.id.clone();
        let host = SessionHost::new(self);
        let client = AcpClient::spawn(command, host.clone()).await?;
        let pid = client.pid();
        self.register_pid(pid, &launch.executable).await;
        if !self.owner_is_current(owner.as_deref(), generation) {
            client.shutdown().await;
            self.unregister_pid(pid).await;
            return Err("The window or task closed while the agent was starting.".into());
        }
        if let Err(error) = self.store.save(record) {
            client.shutdown().await;
            self.unregister_pid(pid).await;
            return Err(error);
        }
        let default_title = record.title == default_title(definition);
        let session = Arc::new(LiveSession {
            state: Mutex::new(LiveState {
                record: record.clone(),
                saved: Some(record.clone()),
                permissions: HashMap::new(),
                elicitations: HashMap::new(),
                replaying: false,
                cancelled: false,
                bytes,
                tool_calls: HashMap::new(),
                skill_folder: None,
                hidden: None,
                hidden_tools: false,
                coalescer: Coalescer::default(),
                flush_timer: false,
                compactions: HashMap::new(),
                default_title,
                early: Vec::new(),
                turn_closed: false,
            }),
            client,
            operation: AsyncMutex::new(()),
            owner_tag: owner.as_deref().map(Arc::from),
            owner,
            redactor,
            mcp_servers: Mutex::new(mcp_servers),
            task_temp,
            task_commands,
            delegate: Mutex::new(PermissionDelegate::None),
            pending: watch::channel(false).0,
            authenticating: AtomicBool::new(false),
            auth_asked: watch::channel(false).0,
            known_foreign: Mutex::new(HashSet::new()),
            forking: AtomicBool::new(false),
            mode_switches: AtomicU32::new(0),
            routed: Mutex::new(None),
            pid,
            keep_home: AtomicBool::new(false),
        });
        self.live.lock().await.insert(id, session.clone());
        // Registered: the slot is no longer a reservation.
        drop(reservation);
        host.bind(&session);
        Ok(session)
    }

    /// Reserves a place among the live sessions for one that is starting.
    pub(super) async fn reserve_slot(
        self: &Arc<Self>,
        id: &str,
        owner: Option<&str>,
        generation: Option<u64>,
    ) -> Result<SlotReservation, String> {
        let sessions = self.live.lock().await;
        let mut starting = self
            .starting
            .lock()
            .map_err(|_| "The ACP runtime is unavailable.")?;
        if sessions.len() + starting.len() >= MAX_LIVE_SESSIONS {
            return Err(
                "Eight ACP sessions are already connected. Disconnect one before starting another."
                    .into(),
            );
        }
        if sessions.contains_key(id) || starting.contains(id) {
            return Err("This ACP session is already connected.".into());
        }
        if !self.owner_is_current(owner, generation) {
            return Err("The window or task closed while the agent was starting.".into());
        }
        starting.insert(id.to_owned());
        Ok(SlotReservation {
            runtime: self.clone(),
            id: id.to_owned(),
        })
    }

    /// Lists an agent's process for orphan cleanup. The registry takes a file
    /// lock, so this runs off the async workers.
    pub(super) async fn register_pid(self: &Arc<Self>, pid: Option<u32>, program: &Path) {
        let Some(pid) = pid.filter(|_| self.pids.get().is_some()) else {
            return;
        };
        let runtime = self.clone();
        let program = program.to_path_buf();
        let _ = tokio::task::spawn_blocking(move || {
            let Some(registry) = runtime.pids.get() else {
                return;
            };
            // An agent that already exited needs no cleanup, and a line
            // without a start time could later name another process.
            if let oleafly_sandbox::process::identity::ProcessProbe::Running { started } =
                oleafly_sandbox::process::identity::probe(pid)
            {
                let _ = registry.add(pid, started, &program);
            }
        })
        .await;
    }

    pub(super) async fn unregister_pid(self: &Arc<Self>, pid: Option<u32>) {
        let Some(pid) = pid.filter(|_| self.pids.get().is_some()) else {
            return;
        };
        let runtime = self.clone();
        let _ = tokio::task::spawn_blocking(move || {
            if let Some(registry) = runtime.pids.get() {
                let _ = registry.remove(pid);
            }
        })
        .await;
    }

    /// A short-lived agent connection (history, import, deleting a session at
    /// the agent): listed for orphan cleanup like a session, and stopped with
    /// the app.
    pub(super) async fn track_transient(self: &Arc<Self>, client: &Arc<AcpClient>, program: &Path) {
        if let Ok(mut transient) = self.transient.lock() {
            transient.retain(|client| client.strong_count() > 0);
            transient.push(Arc::downgrade(client));
        }
        self.register_pid(client.pid(), program).await;
    }

    pub(super) async fn untrack_transient(self: &Arc<Self>, client: &Arc<AcpClient>) {
        if let Ok(mut transient) = self.transient.lock() {
            transient.retain(|other| {
                other
                    .upgrade()
                    .is_some_and(|other| !Arc::ptr_eq(&other, client))
            });
        }
        self.unregister_pid(client.pid()).await;
    }

    async fn initialize(
        self: &Arc<Self>,
        session: &Arc<LiveSession>,
        prefer_v2: bool,
    ) -> Result<(), InitFailure> {
        let remote = self
            .copy_record(session)
            .map_err(InitFailure::Failed)?
            .remote
            .is_some();
        // A sandboxed task agent reads files with its own tools, inside its
        // sandbox: Oleafly reads outside it, so it never offers to.
        let fs_read = !remote && session.task_temp.is_none();
        if let Ok(mut state) = session.state.lock() {
            // Set again below only when routing succeeds now: a record must
            // not keep a provider this connection does not use.
            state.record.routed_provider = None;
        }
        let negotiated = match session
            .client
            .initialize(&client_options(fs_read, prefer_v2))
            .await
        {
            Ok(negotiated) => negotiated,
            Err(InitializeError::FallBackToV1) => return Err(InitFailure::FallBackToV1),
            Err(error) => return Err(InitFailure::Failed(error.to_string())),
        };
        let response = &negotiated.raw;
        let capabilities = negotiated.capabilities.clone();
        session
            .redactor
            .validate_metadata_ids(&response["authMethods"])
            .map_err(InitFailure::Failed)?;
        {
            let mut servers = session
                .mcp_servers
                .lock()
                .map_err(|_| InitFailure::Failed("The ACP session is unavailable.".into()))?;
            if servers.iter().any(|v| v["type"] == "sse") {
                return Err(InitFailure::Failed(
                    "SSE tool connections are not supported by this ACP runtime.".into(),
                ));
            }
            if !capabilities.mcp_http {
                for server in servers.iter_mut() {
                    if server["type"] == "http" {
                        *server = crate::research_mcp::stdio_server(server)
                            .map_err(InitFailure::Failed)?;
                    }
                }
            }
        }
        let auth_methods: Vec<_> = negotiated
            .auth_methods
            .iter()
            .map(|method| redacted_auth_method(&session.redactor, method))
            .collect();
        let agent_id = {
            let mut state = session
                .state
                .lock()
                .map_err(|_| InitFailure::Failed("The ACP session is unavailable.".into()))?;
            state.record.capabilities = capabilities.clone();
            state.record.agent_version = negotiated
                .agent_version
                .as_deref()
                .map(|v| session.redactor.text(v));
            state.record.auth_methods = auth_methods.clone();
            state.record.agent_id.clone()
        };
        let mut info = AgentRuntimeInfo::from_negotiated(&negotiated, auth_methods, now_ms());
        let prefs = self.preferences();
        let agent_prefs = self.store.agent_preferences(&agent_id).unwrap_or_default();
        if prefs.experimental_providers && capabilities.providers && !remote {
            match crate::config::read_config() {
                Ok(config) => {
                    match providers::route_agent(
                        &session.client,
                        &session.redactor,
                        &agent_prefs,
                        &config,
                    )
                    .await
                    {
                        Ok(routed) => {
                            info.providers_supported = routed.supported;
                            if let Ok(mut slot) = session.routed.lock() {
                                *slot = routed.agent_provider;
                            }
                            if let Ok(mut state) = session.state.lock() {
                                state.record.routed_provider = routed.provider;
                            }
                        }
                        Err(error) => {
                            self.routing_notice(session, agent_prefs.provider.as_deref(), &error)
                        }
                    }
                }
                Err(error) => self.routing_notice(session, agent_prefs.provider.as_deref(), &error),
            }
        }
        let _ = self.store.set_agent_runtime(&agent_id, &info);
        self.establish(session).await.map_err(InitFailure::Failed)
    }

    fn routing_notice(&self, session: &LiveSession, provider: Option<&str>, error: &str) {
        let Some(provider) = provider else {
            return;
        };
        if let Ok(mut state) = session.state.lock() {
            let _ = self.emit_locked(
                session,
                &mut state,
                "notice",
                json!({"severity": "warning",
                    "title": format!("Oleafly could not route this agent through your {provider} key."),
                    "description": session.redactor.text(error)}),
            );
        }
    }

    pub(super) async fn establish(
        self: &Arc<Self>,
        session: &Arc<LiveSession>,
    ) -> Result<(), String> {
        let record = self.copy_record(session)?;
        let (cwd, mcp_servers) = match &record.remote {
            Some(remote) => (remote.folder.clone(), Vec::new()),
            None => (
                launch_root_for(Path::new(&record.project_path))
                    .to_string_lossy()
                    .into_owned(),
                session
                    .mcp_servers
                    .lock()
                    .map_err(|_| "The ACP session is unavailable.")?
                    .clone(),
            ),
        };
        let resuming = record.native_session_id.is_some();
        // `session/load` replays the conversation first; that history is
        // already stored.
        let loading = resuming && !record.capabilities.resume;
        if let Ok(mut state) = session.state.lock() {
            state.replaying = loading;
        }
        let result = if let Some(native) = &record.native_session_id {
            if record.capabilities.resume {
                session
                    .client
                    .resume_session(native, &cwd, &mcp_servers)
                    .await
            } else if record.capabilities.load_session {
                session
                    .client
                    .load_session(native, &cwd, &mcp_servers)
                    .await
            } else {
                return Err("This agent no longer supports resuming this conversation.".into());
            }
        } else {
            session.client.new_session(&cwd, &mcp_servers).await
        };
        match result {
            Ok(value) => {
                {
                    let mut state = session
                        .state
                        .lock()
                        .map_err(|_| "The ACP session is unavailable.")?;
                    if state.record.native_session_id.is_none() {
                        let id = value["sessionId"]
                            .as_str()
                            .filter(|id| !id.is_empty() && id.len() <= 512)
                            .ok_or("The agent returned no valid session ID.")?;
                        state.record.native_session_id = Some(session.redactor.opaque_id(id)?);
                    }
                    session.redactor.validate_metadata_ids(&value)?;
                    state.record.controls.merge(&session.redactor.value(&value));
                    state.record.status = SessionStatus::Ready;
                    state.record.error = None;
                    state.replaying = false;
                    self.emit_locked(session, &mut state, "status", json!({"status":"ready"}))?;
                }
                let early = session
                    .state
                    .lock()
                    .map(|mut state| std::mem::take(&mut state.early))
                    .unwrap_or_default();
                for update in early {
                    self.handle_update(session, &update)?;
                }
                if !resuming {
                    self.apply_remembered(session).await;
                }
                self.leave_blocked_mode(session).await;
                Ok(())
            }
            Err(error) if error.auth_required() => {
                let mut state = session
                    .state
                    .lock()
                    .map_err(|_| "The ACP session is unavailable.")?;
                state.record.status = SessionStatus::AuthRequired;
                state.record.error = Some("Sign in to this agent, then try again.".into());
                state.replaying = false;
                self.emit_locked(
                    session,
                    &mut state,
                    "status",
                    json!({"status":"auth_required"}),
                )?;
                Ok(())
            }
            Err(error) => Err(error.to_string()),
        }
    }

    pub async fn prompt(
        self: &Arc<Self>,
        id: &str,
        text: String,
        images: Vec<ImagePrompt>,
    ) -> Result<SessionSnapshot, String> {
        self.prompt_input(
            id,
            PromptInput {
                text,
                images,
                ..PromptInput::default()
            },
            None,
        )
        .await
    }

    /// Sends one turn: text, attachments, selections and, with `skill`, its
    /// instructions as a second text block. Interactive turns are bracketed
    /// by a before-turn copy so the changes the agent made can be reviewed.
    pub async fn prompt_input(
        self: &Arc<Self>,
        id: &str,
        input: PromptInput,
        skill: Option<PromptSkill>,
    ) -> Result<SessionSnapshot, String> {
        self.send_prompt(id, input, skill)
            .await
            .map_err(PromptFailure::into_message)
    }

    /// [`Self::prompt_input`], telling a message that never reached the
    /// transcript apart from one that did, in a turn that then failed.
    pub async fn send_prompt(
        self: &Arc<Self>,
        id: &str,
        input: PromptInput,
        skill: Option<PromptSkill>,
    ) -> Result<SessionSnapshot, PromptFailure> {
        let session = self.get_live(id).await?;
        let _operation = session
            .operation
            .try_lock()
            .map_err(|_| "This ACP agent is already working on a turn.")?;
        let record = self.copy_record(&session)?;
        crate::trust::require_trusted(&record.project_id, crate::trust::Capability::ExternalAgents)
            .map_err(String::from)?;
        if record.status != SessionStatus::Ready {
            return Err("Connect and sign in to this agent before sending a message.".into());
        }
        if record.remote.is_some() && !input.files.is_empty() {
            return Err("Hermes on another machine cannot read files from this computer. Paste the text instead.".into());
        }
        let resolved = if input.files.is_empty() && input.selections.is_empty() {
            attachments::Resolved {
                links: Vec::new(),
                texts: Vec::new(),
                notes: Vec::new(),
            }
        } else {
            let input = input.clone();
            let project_id = record.project_id.clone();
            let root = PathBuf::from(&record.project_path);
            let session_id = record.id.clone();
            let mut caps = record.capabilities.clone();
            if record.remote.is_some() {
                caps.embedded_context = false;
            }
            let data_root = crate::paths::oleafly_root()?;
            tokio::task::spawn_blocking(move || {
                attachments::resolve(&input, &project_id, &root, &data_root, &session_id, &caps)
            })
            .await
            .map_err(|_| "Oleafly couldn't prepare the attachments.")??
        };
        let native = record
            .native_session_id
            .clone()
            .ok_or("The ACP session is not ready.")?;
        let blocks = oleafly_acp::prompt::prompt_blocks(
            &native,
            &oleafly_acp::prompt::PromptParts {
                text: &input.text,
                skill_block: skill.as_ref().map(|skill| skill.block.as_str()),
                images: &input.images,
                links: &resolved.links,
                texts: &resolved.texts,
            },
            &record.capabilities,
        )
        .map_err(|error| error.message().to_string())?;
        let has_text = !input.text.trim().is_empty();
        {
            let mut state = session
                .state
                .lock()
                .map_err(|_| "The ACP session is unavailable.")?;
            state.record.turn_id = Some(new_id());
            state.record.status = SessionStatus::Running;
            state.turn_closed = false;
            state.record.error = None;
            state.cancelled = false;
            state.tool_calls.clear();
            state.skill_folder = skill.as_ref().and_then(|skill| skill.folder.clone());
            if state.default_title && !state.record.title_locked {
                let title = turn_title(&input.text, has_text, skill.as_ref());
                if !title.is_empty() {
                    state.record.title = session
                        .redactor
                        .text(title)
                        .chars()
                        .take(MAX_TITLE)
                        .collect();
                    state.default_title = false;
                }
            }
            let mut user = json!({
                "text": input.text,
                "images": input.images.iter().map(|v| json!({"mimeType": v.mime_type})).collect::<Vec<_>>(),
            });
            if !resolved.notes.is_empty() {
                user["files"] = serde_json::to_value(&resolved.notes).map_err(|e| e.to_string())?;
            }
            if !input.selections.is_empty() {
                user["selections"] = json!(input
                    .selections
                    .iter()
                    .map(|selection| json!({"path": selection.path}))
                    .collect::<Vec<_>>());
            }
            if let Some(skill) = &skill {
                user["skill"] = json!({"id":skill.id,"name":skill.name});
            }
            self.emit_locked(&session, &mut state, "user_message", user)?;
        }
        let turn_copy = if review::takes_turn_copy(
            session.task_temp.is_some(),
            record.parent_session_id.as_deref(),
            record.remote.is_some(),
        ) {
            let label = self
                .definition(&record.agent_id)
                .map(|definition| definition.name)
                .unwrap_or_else(|_| record.agent_id.clone());
            Some(review::begin_turn(&self.review, &record.project_id, &label).await)
        } else {
            None
        };
        let cancelled_during_copy = session.state.lock().is_ok_and(|state| state.cancelled);
        let result = if cancelled_during_copy {
            Err(RpcError::local("The turn was cancelled."))
        } else {
            let timing = TurnTiming {
                inactivity: Some(self.preferences().inactivity()),
                absolute: None,
                hold: Some(session.pending.subscribe()),
            };
            session.client.prompt(&native, blocks, timing).await
        };
        // The message is in the transcript: a failure from here on is the
        // turn's, and sending the message again would repeat it.
        self.finish_turn(&session, &record, result, turn_copy)
            .await
            .map_err(|message| PromptFailure::Delivered {
                delivered: true,
                message,
            })
    }

    /// Records how a turn ended: usage, turn changes, status.
    async fn finish_turn(
        self: &Arc<Self>,
        session: &Arc<LiveSession>,
        record: &SessionRecord,
        result: Result<Value, RpcError>,
        turn_copy: Option<crate::agent_turns::TurnBegin>,
    ) -> Result<SessionSnapshot, String> {
        self.expire_permissions(session).await;
        // 0.4.8 I: the agent's desktop apps session ends with its turn.
        crate::cua_driver::acp_turn_ended(&record.id);
        let changes = match &turn_copy {
            Some(begin) => review::finish_turn(&self.review, &record.project_id, begin).await,
            None => None,
        };
        let closed = session.client.is_closed();
        let live_status = if closed {
            SessionStatus::Disconnected
        } else {
            SessionStatus::Ready
        };
        let error;
        let failed;
        {
            let mut state = session
                .state
                .lock()
                .map_err(|_| "The ACP session is unavailable.")?;
            let (status, stop, message) = turn_outcome(
                &result,
                state.cancelled,
                closed,
                &live_status,
                &session.redactor,
            );
            // Something the agent sent during the turn failed the session
            // and asked it to stop; its answer to the prompt can't undo that.
            failed = state.record.status == SessionStatus::Failed;
            let (status, stop, message) = if failed {
                let error = state.record.error.clone().unwrap_or_else(|| {
                    "The agent stopped before completing this turn.".to_string()
                });
                (SessionStatus::Failed, "error".to_string(), Some(error))
            } else {
                (status, stop, message)
            };
            if let Ok(value) = &result {
                let now = now_ms();
                let usage = state.record.usage.get_or_insert_with(SessionUsage::default);
                usage.apply_prompt_response(value, now);
                usage.redact(&session.redactor);
                if let Some(mut counters) = prompt_usage(value) {
                    counters.session = state.record.usage.as_ref().map(SessionUsage::without_plan);
                    self.emit_locked(
                        session,
                        &mut state,
                        "usage",
                        serde_json::to_value(counters).map_err(|e| e.to_string())?,
                    )?;
                }
            }
            if let Some(changes) = changes.filter(review::worth_reporting) {
                let data = review::turn_changes_event(state.record.turn_id.as_deref(), &changes);
                // The card is extra information: failing to store it never
                // fails the turn.
                let _ = self.emit_locked(session, &mut state, "turn_changes", data);
            }
            let authenticating = status == SessionStatus::AuthRequired;
            state.skill_folder = None;
            state.record.status = status;
            state.record.error = message.clone();
            error = message;
            self.emit_locked(
                session,
                &mut state,
                "turn_complete",
                json!({"stopReason":stop,"error":error}),
            )?;
            if authenticating {
                self.emit_locked(
                    session,
                    &mut state,
                    "status",
                    json!({"status":"auth_required"}),
                )?;
            }
        }
        if let Some(error) = error {
            if failed || closed || session.client.is_closed() {
                session.client.shutdown().await;
                self.release_live(session).await;
            }
            return Err(error);
        }
        self.snapshot(&record.id).await
    }

    /// Adds a message to the running turn ("Send now"). The agent may answer
    /// that the turn already ended; the caller then sends it as a new turn.
    pub async fn steer(self: &Arc<Self>, id: &str, text: String) -> Result<SteerOutcome, String> {
        if text.trim().is_empty() {
            return Err("Write a message before sending.".into());
        }
        if !oleafly_acp::prompt::text_fits_transcript(&text) {
            return Err("This message is too large. Shorten it.".into());
        }
        let session = self.get_live(id).await?;
        let record = self.copy_record(&session)?;
        if !record.capabilities.steering {
            return Err(
                "This agent cannot take messages while it works. Wait for the turn to finish."
                    .into(),
            );
        }
        if record.status != SessionStatus::Running {
            return Ok(SteerOutcome::PromptRequired);
        }
        let native = record
            .native_session_id
            .ok_or("The ACP session is not ready.")?;
        let answer = session
            .client
            .steer(&native, vec![json!({"type": "text", "text": text})])
            .await
            .map_err(|error| session.redactor.text(&error.to_string()))?;
        let outcome = answer["outcome"]
            .as_str()
            .or(answer["status"].as_str())
            .or(answer["result"].as_str())
            .unwrap_or("");
        if !matches!(outcome, "injected" | "accepted" | "queued") {
            return Ok(SteerOutcome::PromptRequired);
        }
        let mut state = session
            .state
            .lock()
            .map_err(|_| "The ACP session is unavailable.")?;
        self.emit_locked(
            &session,
            &mut state,
            "user_message",
            json!({"text": text, "images": [], "steered": true}),
        )?;
        Ok(SteerOutcome::Injected)
    }

    pub async fn cancel(self: &Arc<Self>, id: &str) -> Result<(), String> {
        let session = match self.get_live(id).await {
            Ok(session) => session,
            Err(_) => return Ok(()),
        };
        let status = self.copy_record(&session).map(|record| record.status);
        // Stop pressed as the turn ended: there is nothing to stop, and the
        // agent stays connected.
        if status.as_ref().is_ok_and(|status| {
            !matches!(status, SessionStatus::Running | SessionStatus::Cancelling)
        }) {
            return Ok(());
        }
        let running = status.is_ok_and(|status| status == SessionStatus::Running);
        let cancelling = (|| {
            let mut state = session
                .state
                .lock()
                .map_err(|_| "The ACP session is unavailable.")?;
            state.cancelled = true;
            state.record.status = SessionStatus::Cancelling;
            self.emit_locked(
                &session,
                &mut state,
                "status",
                json!({"status":"cancelling"}),
            )
        })();
        self.expire_permissions(&session).await;
        if let Ok(record) = self.copy_record(&session) {
            if let Some(native) = record.native_session_id {
                let _ = session.client.cancel(&native);
            }
        }
        let settled = running
            && cancelling.is_ok()
            && tokio::time::timeout(CANCEL_GRACE, async {
                let _turn = session.operation.lock().await;
            })
            .await
            .is_ok();
        if settled && !session.client.is_closed() {
            return Ok(());
        }
        session.client.shutdown().await;
        let cancelled = (|| {
            let mut state = session
                .state
                .lock()
                .map_err(|_| "The ACP session is unavailable.")?;
            state.record.status = SessionStatus::Cancelled;
            self.emit_locked(
                &session,
                &mut state,
                "status",
                json!({"status":"cancelled"}),
            )
        })();
        if session.operation.try_lock().is_ok() {
            self.release_live(&session).await;
        } else {
            // The turn is still finishing (its before-turn copy can take
            // seconds): keep the session registered until it has saved its
            // last events, so it cannot be reconnected underneath it.
            let runtime = self.clone();
            tokio::spawn(async move { runtime.release_when_idle(&session).await });
        }
        cancelling.and(cancelled)
    }

    pub async fn close(self: &Arc<Self>, id: &str) -> Result<(), String> {
        let session = match self.get_live(id).await {
            Ok(session) => session,
            Err(_) => return Ok(()),
        };
        if self.copy_record(&session)?.status == SessionStatus::Running {
            self.cancel(id).await?;
            if self.get_live(id).await.is_err() {
                return Ok(());
            }
        }
        self.expire_permissions(&session).await;
        session.client.shutdown().await;
        {
            let mut state = session
                .state
                .lock()
                .map_err(|_| "The ACP session is unavailable.")?;
            if !matches!(
                state.record.status,
                SessionStatus::Failed | SessionStatus::Cancelled | SessionStatus::Disconnected
            ) {
                state.record.status = SessionStatus::Disconnected;
                self.emit_locked(
                    &session,
                    &mut state,
                    "status",
                    json!({"status":"disconnected"}),
                )?;
            } else {
                self.flush_held(&session, &mut state)?;
            }
        }
        self.release_when_idle(&session).await;
        Ok(())
    }

    /// Releases a closed session once no turn, sign-in or model change still
    /// holds it (bounded by [`RELEASE_WAIT`]), so a reconnect never builds a
    /// second copy of the session while the old turn still appends events.
    pub(super) async fn release_when_idle(&self, session: &Arc<LiveSession>) {
        let _idle = tokio::time::timeout(RELEASE_WAIT, session.operation.lock()).await;
        self.release_live(session).await;
    }

    pub(super) async fn release_live(&self, session: &Arc<LiveSession>) {
        if session.client.is_closed() {
            if let Some(temporary) = session
                .task_temp
                .as_ref()
                .filter(|_| !session.keep_home.load(Ordering::Acquire))
            {
                let _ = tokio::fs::remove_dir_all(&temporary.0).await;
            }
            if let (Some(registry), Some(pid)) = (self.pids.get(), session.pid) {
                let _ = registry.remove(pid);
            }
        }
        let Ok(record) = self.copy_record(session) else {
            return;
        };
        let mut sessions = self.live.lock().await;
        if sessions
            .get(&record.id)
            .is_some_and(|current| Arc::ptr_eq(current, session))
        {
            sessions.remove(&record.id);
            if let Ok(mut resources) = self.resources.lock() {
                resources.remove(&record.id);
            }
        }
    }

    pub async fn close_owner(self: &Arc<Self>, owner: &str) {
        if let Ok(mut epochs) = self.owner_epochs.lock() {
            epochs.close(owner, Instant::now());
        }
        let ids: Vec<_> = self
            .live
            .lock()
            .await
            .iter()
            .filter(|(_, session)| session.owner.as_deref() == Some(owner))
            .map(|(id, _)| id.clone())
            .collect();
        for id in ids {
            let _ = self.close(&id).await;
        }
    }

    pub async fn close_project_sessions(self: &Arc<Self>, project_id: &str) -> usize {
        let ids: Vec<_> = {
            let sessions = self.live.lock().await;
            sessions
                .iter()
                .filter(|(_, session)| {
                    self.copy_record(session).is_ok_and(|record| {
                        record.project_id == project_id && record.task_id.is_none()
                    })
                })
                .map(|(id, _)| id.clone())
                .collect()
        };
        let mut closed = 0;
        for id in ids {
            if self.close(&id).await.is_ok() {
                closed += 1;
            }
        }
        closed
    }

    pub fn rebind_project_paths(
        &self,
        project_id: &str,
        root: &Path,
        fresh_agent_sessions: bool,
    ) -> Result<usize, String> {
        let root = canonical_root(root)?;
        self.store
            .rebind_project_path(project_id, &root.to_string_lossy(), fresh_agent_sessions)
    }

    /// Quitting: every live session closes at once, within 8 s; then any
    /// agent still running is stopped.
    pub async fn shutdown_all(self: &Arc<Self>) {
        if let Ok(mut state) = self.startup.lock() {
            state.stopping = true;
        }
        let mut settled = self.startup_count.subscribe();
        let ids: Vec<_> = self.live.lock().await.keys().cloned().collect();
        let closes = ids.iter().map(|id| self.close(id));
        let _ = tokio::time::timeout(QUIT_BUDGET, futures_util::future::join_all(closes)).await;
        self.stop_all_now();
        let _ = tokio::time::timeout(
            Duration::from_secs(2),
            settled.wait_for(|count| *count == 0),
        )
        .await;
    }

    pub(crate) fn resume_after_failed_update(&self) -> Result<(), String> {
        let mut state = self
            .startup
            .lock()
            .map_err(|_| "The ACP runtime is unavailable.")?;
        if state.pending != 0 {
            return Err("Background agents are still stopping.".into());
        }
        state.stopping = false;
        Ok(())
    }

    pub async fn assert_owner(&self, id: &str, owner: &str) -> Result<(), String> {
        let session = self.get_live(id).await?;
        if session.owner.as_deref() != Some(owner) {
            return Err("This window does not own the ACP session.".into());
        }
        Ok(())
    }

    pub async fn set_permission_delegate(
        &self,
        id: &str,
        delegate: PermissionDelegate,
    ) -> Result<(), String> {
        let session = self.get_live(id).await?;
        let mut current = session
            .delegate
            .lock()
            .map_err(|_| "The ACP session is unavailable.")?;
        *current = delegate;
        Ok(())
    }

    pub async fn permission_delegate(&self, id: &str) -> PermissionDelegate {
        match self.get_live(id).await {
            Ok(session) => session
                .delegate
                .lock()
                .map(|value| *value)
                .unwrap_or_default(),
            Err(_) => PermissionDelegate::None,
        }
    }

    pub async fn resolve_delegated_permission(
        &self,
        id: &str,
        permission_id: &str,
        option_id: Option<String>,
    ) -> Result<(), String> {
        if self.permission_delegate(id).await != PermissionDelegate::ParentChat {
            return Err("This ACP session does not take answers from the assistant.".into());
        }
        self.resolve_permission(id, permission_id, option_id).await
    }

    pub(super) fn emit_diagnostics(&self, session: &LiveSession) {
        let tail = session.client.stderr_tail();
        if tail.is_empty() {
            return;
        }
        if let Ok(mut state) = session.state.lock() {
            let _ = self.emit_locked(session, &mut state, "diagnostics", json!({"stderr": tail}));
        }
    }

    pub async fn snapshot(&self, id: &str) -> Result<SessionSnapshot, String> {
        if let Some(session) = self.live.lock().await.get(id) {
            let state = session
                .state
                .lock()
                .map_err(|_| "The ACP session is unavailable.")?;
            return Ok(SessionSnapshot {
                session: state.record.clone(),
                permissions: state
                    .permissions
                    .values()
                    .map(|v| v.request.clone())
                    .collect(),
                elicitations: state
                    .elicitations
                    .values()
                    .map(|pending| pending.view.clone())
                    .collect(),
            });
        }
        Ok(SessionSnapshot {
            session: self.store.get(id)?,
            permissions: Vec::new(),
            elicitations: Vec::new(),
        })
    }

    pub(super) async fn get_live(&self, id: &str) -> Result<Arc<LiveSession>, String> {
        self.live
            .lock()
            .await
            .get(id)
            .cloned()
            .ok_or_else(|| "This ACP session is disconnected.".into())
    }

    pub(super) fn copy_record(&self, session: &LiveSession) -> Result<SessionRecord, String> {
        Ok(session
            .state
            .lock()
            .map_err(|_| "The ACP session is unavailable.")?
            .record
            .clone())
    }

    /// Stores and broadcasts one event; held text is stored first.
    pub(super) fn emit_locked(
        &self,
        session: &LiveSession,
        state: &mut LiveState,
        kind: &str,
        data: Value,
    ) -> Result<(), String> {
        self.flush_held(session, state)?;
        self.store_event(session, state, kind, data)
    }

    /// Stores the text held by the coalescer.
    pub(super) fn flush_held(
        &self,
        session: &LiveSession,
        state: &mut LiveState,
    ) -> Result<(), String> {
        if let Some(update) = state.coalescer.take() {
            let kind = update["sessionUpdate"]
                .as_str()
                .unwrap_or("agent_message_chunk")
                .to_owned();
            self.store_event(session, state, &kind, update)?;
        }
        Ok(())
    }

    /// Stores the held text that is due, keeping back only an ending that
    /// could begin a secret still streaming in, so one is never split
    /// between two stored events where neither part would match it.
    pub(super) fn flush_due(
        &self,
        session: &LiveSession,
        state: &mut LiveState,
    ) -> Result<(), String> {
        let due = state.coalescer.take_due(
            |text| session.redactor.holdback(text),
            |text| session.redactor.text(text),
            Instant::now(),
        );
        if let Some(update) = due {
            let kind = update["sessionUpdate"]
                .as_str()
                .unwrap_or("agent_message_chunk")
                .to_owned();
            self.store_event(session, state, &kind, update)?;
        }
        Ok(())
    }

    pub(super) fn store_event(
        &self,
        session: &LiveSession,
        state: &mut LiveState,
        kind: &str,
        data: Value,
    ) -> Result<(), String> {
        // `turn_changes` is built by Oleafly from project paths; redacting it
        // would mangle file names such as `sk-learn-results.csv`. A question
        // (`elicitation`) is redacted field by field when it arrives: the
        // generic pass would turn each field's `secret` flag into text and
        // could cut its link.
        let data = match kind {
            "turn_changes" => data,
            "elicitation" => transcript::bound_event(data),
            _ => transcript::bound_event(session.redactor.value(&data)),
        };
        let bytes = serde_json::to_vec(&data).map_err(|e| e.to_string())?.len();
        if state.bytes + bytes > MAX_SESSION_BYTES
            && !matches!(
                kind,
                "turn_complete" | "status" | "permission_resolved" | "turn_changes"
            )
        {
            session.client.request_stop();
            return Err(
                "This session reached its transcript size limit. Start a new conversation.".into(),
            );
        }
        state.record.updated_at = now_ms();
        state.record.last_sequence += 1;
        let event = AcpEvent {
            session_id: state.record.id.clone(),
            project_id: state.record.project_id.clone(),
            agent_id: state.record.agent_id.clone(),
            model_id: state.record.controls.model_id.clone(),
            task_id: state.record.task_id.clone(),
            turn_id: state.record.turn_id.clone(),
            sequence: state.record.last_sequence,
            timestamp: state.record.updated_at,
            kind: kind.into(),
            data,
            owner: session.owner_tag.clone(),
        };
        let changed = record_changed(state);
        if self
            .store
            .append(&event, changed.then_some(&state.record))
            .is_err()
        {
            session.client.request_stop();
            state.record.last_sequence -= 1;
            state.record.status = SessionStatus::Failed;
            state.record.error = Some("The ACP transcript could not be saved. The agent was stopped to preserve the saved history.".into());
            return Err(state.record.error.clone().unwrap_or_default());
        }
        if changed {
            state.saved = Some(state.record.clone());
        }
        state.bytes += bytes;
        let _ = self.events.send(event);
        self.note_summary(&state.record);
        Ok(())
    }

    /// Sends a session summary to every window, at most every 250 ms per
    /// session; the latest state is always sent last.
    fn note_summary(&self, record: &SessionRecord) {
        let summary = SessionSummary {
            project_id: record.project_id.clone(),
            session_id: record.id.clone(),
            agent_id: record.agent_id.clone(),
            title: record.title.clone(),
            status: record.status.clone(),
            updated_at: record.updated_at,
            last_sequence: record.last_sequence,
        };
        let Ok(mut throttle) = self.summary_throttle.lock() else {
            return;
        };
        let now = Instant::now();
        // A session that sent nothing for a while needs no entry: it is made
        // again, ready to send at once, with its next summary.
        if throttle.len() > 64 {
            throttle.retain(|_, entry| {
                entry.timer
                    || entry.pending.is_some()
                    || entry
                        .last_sent
                        .is_some_and(|last| now.duration_since(last) < SUMMARY_INTERVAL)
            });
        }
        let entry = throttle.entry(record.id.clone()).or_default();
        let ready = entry
            .last_sent
            .is_none_or(|last| now.duration_since(last) >= SUMMARY_INTERVAL);
        if ready && !entry.timer {
            entry.last_sent = Some(now);
            entry.pending = None;
            let _ = self.summaries.send(summary);
            return;
        }
        entry.pending = Some(summary);
        if entry.timer {
            return;
        }
        entry.timer = true;
        let wait = entry.last_sent.map_or(Duration::ZERO, |last| {
            SUMMARY_INTERVAL.saturating_sub(now.duration_since(last))
        });
        let this = self.this.clone();
        let id = record.id.clone();
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(wait).await;
            let Some(runtime) = this.upgrade() else {
                return;
            };
            let Ok(mut throttle) = runtime.summary_throttle.lock() else {
                return;
            };
            if let Some(entry) = throttle.get_mut(&id) {
                entry.timer = false;
                entry.last_sent = Some(Instant::now());
                if let Some(summary) = entry.pending.take() {
                    let _ = runtime.summaries.send(summary);
                }
            }
        });
    }

    pub(super) fn fail(&self, session: &LiveSession, error: &str) -> Result<(), String> {
        let mut state = session
            .state
            .lock()
            .map_err(|_| "The ACP session is unavailable.")?;
        state.record.status = SessionStatus::Failed;
        state.record.error = Some(session.redactor.text(error));
        self.emit_locked(
            session,
            &mut state,
            "status",
            json!({"status":"failed","error":error}),
        )
    }

    /// The agent's connection ended: open permission cards and questions are
    /// cancelled, the session is marked disconnected and released once its
    /// last turn has saved its events.
    pub(super) fn session_disconnected(self: &Arc<Self>, session: &Arc<LiveSession>) {
        self.expire_permissions_now(session);
        self.expire_elicitations_now(session);
        if let Ok(mut state) = session.state.lock() {
            if !matches!(
                state.record.status,
                SessionStatus::Failed | SessionStatus::Cancelled | SessionStatus::Cancelling
            ) {
                state.record.status = SessionStatus::Disconnected;
                let _ = self.emit_locked(
                    session,
                    &mut state,
                    "status",
                    json!({"status":"disconnected"}),
                );
            } else {
                let _ = self.flush_held(session, &mut state);
            }
        }
        let runtime = self.clone();
        let session = session.clone();
        tokio::spawn(async move { runtime.release_when_idle(&session).await });
    }

    /// Records that an update too large to keep was skipped, so the transcript
    /// shows why a tool call has no output.
    pub(super) fn note_dropped_update(&self, session: &LiveSession, bytes: usize) {
        if let Ok(mut state) = session.state.lock() {
            if !state.replaying
                && matches!(
                    state.record.status,
                    SessionStatus::Running | SessionStatus::Cancelling
                )
            {
                let _ = self.emit_locked(
                    session,
                    &mut state,
                    "diagnostics",
                    json!({"droppedUpdate":{"bytes":bytes}}),
                );
            }
        }
    }

    /// True while a card or question is open.
    pub(super) fn update_hold(&self, session: &LiveSession, state: &LiveState) {
        let waiting = !state.permissions.is_empty() || !state.elicitations.is_empty();
        session.pending.send_replace(waiting);
    }

    /// `fs/read_text_file`: a project file (or a file of the turn's skill),
    /// the open editor text first. Read off the consumer task.
    pub(super) fn read_text_file(
        self: &Arc<Self>,
        session: &Arc<LiveSession>,
        incoming: IncomingRequest,
    ) -> Result<(), String> {
        let params = incoming.params().clone();
        let (record, skill_folder) = {
            let state = session
                .state
                .lock()
                .map_err(|_| "The ACP session is unavailable.")?;
            (state.record.clone(), state.skill_folder.clone())
        };
        // A task agent is sandboxed: Oleafly reads outside the sandbox, so it
        // never reads for one (and never offered to).
        if record.remote.is_some() || session.task_temp.is_some() {
            return incoming
                .reject(-32601, "This client capability is not available.")
                .map_err(|e| e.to_string());
        }
        if params["sessionId"].as_str() != record.native_session_id.as_deref() {
            return incoming
                .reject(-32602, "The request names another session.")
                .map_err(|e| e.to_string());
        }
        let Some(raw) = params["path"]
            .as_str()
            .filter(|path| Path::new(path).is_absolute())
        else {
            return incoming
                .reject(-32602, super::buffers::OUTSIDE)
                .map_err(|e| e.to_string());
        };
        let root = PathBuf::from(&record.project_path);
        let spelled = launch_root_for(&root);
        let path = PathBuf::from(raw);
        let in_project = oleafly_acp::paths::path_within(&root, &spelled, &path);
        // The folder the file must still be in when it is read.
        let within = if in_project {
            Some(root.clone())
        } else {
            skill_folder.as_deref().and_then(|folder| {
                folder.canonicalize().ok().filter(|canonical| {
                    oleafly_acp::paths::path_within(
                        canonical,
                        &crate::program_locator::child_path(folder),
                        &path,
                    )
                })
            })
        };
        let Some(within) = within else {
            return incoming
                .reject(-32602, super::buffers::OUTSIDE)
                .map_err(|e| e.to_string());
        };
        let source = self.buffers.get().cloned();
        // Only a window has open editor text: a delegated helper's owner is
        // a command owner, not a window, and asking it would only wait.
        let owner = session
            .owner
            .clone()
            .filter(|_| in_project && record.parent_session_id.is_none());
        let line = params["line"].as_u64();
        let limit = params["limit"].as_u64();
        tokio::spawn(async move {
            let roots = [root.as_path(), spelled.as_path()];
            let result = super::buffers::read_for_agent(
                source.as_deref(),
                owner.as_deref(),
                &record.project_id,
                &roots,
                &within,
                &path,
                line,
                limit,
            )
            .await;
            let _ = match result {
                Ok(text) => incoming.respond(json!({"content": text})),
                Err((code, message)) => incoming.reject(code, &message),
            };
        });
        Ok(())
    }

    /// A `session/request_permission` from the agent. Answered at once
    /// (outside the project, automatic answers) or kept as a card until the
    /// user answers, the turn ends or 120 s pass.
    pub(super) fn permission_requested(
        self: &Arc<Self>,
        session: &Arc<LiveSession>,
        incoming: IncomingRequest,
    ) -> Result<(), String> {
        let params = &incoming.params().clone();
        let wire_id = incoming.wire_id();
        let record = self.copy_record(session)?;
        let (remembered, skill_folder, hidden) = {
            let state = session
                .state
                .lock()
                .map_err(|_| "The ACP session is unavailable.")?;
            (
                params["toolCall"]["toolCallId"]
                    .as_str()
                    .and_then(|id| state.tool_calls.get(id).cloned()),
                state.skill_folder.clone(),
                state.hidden.is_some(),
            )
        };
        // A plan-usage refresh only reads the agent's own report: nothing
        // it would ask for is allowed, and nobody sees a card for it.
        if hidden {
            return incoming
                .respond(json!({"outcome":{"outcome":"cancelled"}}))
                .map_err(|e| e.to_string());
        }
        let in_turn = (session.owner.is_some() || session.task_temp.is_some())
            && record.status == SessionStatus::Running
            && params["sessionId"].as_str() == record.native_session_id.as_deref();
        // The policy judges the paths of the tool call the request refers to
        // as well as the request's own: adapters often announce a call with
        // its paths and ask for permission with only its id.
        let policy = permission_view::policy_view(remembered.as_ref(), &params["toolCall"]);
        // The local path policy cannot judge paths on another machine, so a
        // remote agent's every in-turn request goes to the user.
        let in_project = in_turn
            && (record.remote.is_some()
                || permission_paths_allowed(Path::new(&record.project_path), &policy));
        // The skill block sends the agent to the skill's own folder, which is
        // never inside the project: reading there is allowed for that turn.
        let skill_read = in_turn
            && !in_project
            && skill_folder
                .as_deref()
                .is_some_and(|folder| skill_read_allowed(folder, policy["kind"].as_str(), &policy));
        if !in_project && !skill_read {
            return incoming
                .respond(json!({"outcome":{"outcome":"cancelled"}}))
                .map_err(|e| e.to_string());
        }
        session.redactor.validate_metadata_ids(&params["options"])?;
        let (kind, locations, diffs) = permission_view::permission_view(
            Path::new(&record.project_path),
            remembered.as_ref(),
            &params["toolCall"],
            &session.redactor,
        );
        let mut request = PermissionRequest {
            id: new_id(),
            session_id: record.id.clone(),
            turn_id: record.turn_id.ok_or("No ACP turn is active.")?,
            title: session.redactor.text(
                params["toolCall"]["title"]
                    .as_str()
                    .unwrap_or("Allow this agent action?"),
            ),
            tool_call_id: params["toolCall"]["toolCallId"]
                .as_str()
                .map(|id| session.redactor.opaque_id(id))
                .transpose()?,
            options: params["options"]
                .as_array()
                .map(|values| {
                    values
                        .iter()
                        .take(16)
                        .filter_map(|value| {
                            serde_json::from_value(session.redactor.value(value)).ok()
                        })
                        .collect()
                })
                .unwrap_or_default(),
            expires_at: now_ms() + PERMISSION_TIMEOUT_MS,
            kind,
            locations,
            diffs,
        };
        let delegate = session
            .delegate
            .lock()
            .map(|value| *value)
            .unwrap_or_default();
        let allow_once = request
            .options
            .iter()
            .find(|option| option.kind == "allow_once")
            .map(|option| option.option_id.clone());
        let task = task_policy(
            self.root.parent(),
            session,
            &record.project_id,
            &request,
            &params["toolCall"],
            &policy,
        );
        let task_queue = task.queued.is_some();
        if task_queue {
            request.expires_at =
                now_ms() + oleafly_research::approvals::APPROVAL_EXPIRY.as_millis() as u64;
        }
        let reject_once = request
            .options
            .iter()
            .find(|option| option.kind == "reject_once")
            .map(|option| option.option_id.clone());
        // A skill read without an "allow once" choice goes to the card.
        let automatic =
            (session.task_temp.is_some() && !task_queue) || (skill_read && allow_once.is_some());
        let auto_option = if task.refuse {
            reject_once.clone()
        } else if automatic {
            allow_once.clone()
        } else {
            None
        };
        let permission_id = request.id.clone();
        {
            let mut state = session
                .state
                .lock()
                .map_err(|_| "The ACP session is unavailable.")?;
            if state.permissions.len() >= 16
                || state
                    .permissions
                    .values()
                    .any(|entry| entry.responder.wire_id() == wire_id)
            {
                return Err("The agent sent too many or duplicate permission requests.".into());
            }
            self.emit_locked(
                session,
                &mut state,
                "permission",
                serde_json::to_value(&request).map_err(|e| e.to_string())?,
            )?;
            state.permissions.insert(
                permission_id.clone(),
                PendingPermission {
                    request,
                    responder: incoming,
                    task_queue,
                },
            );
            self.update_hold(session, &state);
        }
        if automatic {
            return self.resolve_permission_in(session, &permission_id, auto_option);
        }
        if let Some(queued) = task.queued {
            self.answer_when_approved(
                record.id.clone(),
                permission_id,
                queued,
                allow_once,
                reject_once,
            );
            return Ok(());
        }
        if delegate == PermissionDelegate::None && record.parent_session_id.is_some() {
            return self.resolve_permission_in(session, &permission_id, None);
        }
        let weak = Arc::downgrade(self);
        let session_id = record.id;
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(PERMISSION_TIMEOUT_MS)).await;
            if let Some(runtime) = weak.upgrade() {
                let _ = runtime
                    .resolve_permission(&session_id, &permission_id, None)
                    .await;
            }
        });
        Ok(())
    }

    /// Answers a task's queued command request once the task's approval
    /// does.
    fn answer_when_approved(
        self: &Arc<Self>,
        session_id: String,
        permission_id: String,
        queued: QueuedCommand,
        allow_once: Option<String>,
        reject_once: Option<String>,
    ) {
        let weak = Arc::downgrade(self);
        tokio::spawn(async move {
            let answer = queued.approval.ask(queued.summary, queued.detail).await;
            if let Some(runtime) = weak.upgrade() {
                let option = if answer.is_ok() {
                    allow_once
                } else {
                    reject_once
                };
                // An answer that cannot be applied (the turn moved on, the
                // option is gone) still answers the agent, as cancelled,
                // so it never waits for a reply that will not come.
                if runtime
                    .resolve_permission(&session_id, &permission_id, option)
                    .await
                    .is_err()
                {
                    let _ = runtime
                        .resolve_permission(&session_id, &permission_id, None)
                        .await;
                }
            }
        });
    }

    pub async fn resolve_permission(
        &self,
        id: &str,
        permission_id: &str,
        option_id: Option<String>,
    ) -> Result<(), String> {
        let session = self.get_live(id).await?;
        self.resolve_permission_in(&session, permission_id, option_id)
    }

    fn resolve_permission_in(
        &self,
        session: &LiveSession,
        permission_id: &str,
        option_id: Option<String>,
    ) -> Result<(), String> {
        let (pending, outcome) = {
            let mut state = session
                .state
                .lock()
                .map_err(|_| "The ACP session is unavailable.")?;
            let pending = state
                .permissions
                .get(permission_id)
                .ok_or("This permission request has expired.")?;
            let expired = (!pending.task_queue && pending.request.expires_at <= now_ms())
                || state.record.status != SessionStatus::Running
                || state.record.turn_id.as_deref() != Some(&pending.request.turn_id);
            if option_id.is_some() && expired {
                return Err("This permission request has expired.".into());
            }
            if let Some(option) = &option_id {
                if !pending
                    .request
                    .options
                    .iter()
                    .any(|value| &value.option_id == option)
                {
                    return Err("This permission option is not available.".into());
                }
            }
            let outcome = match &option_id {
                Some(option) => json!({"outcome":"selected","optionId":option}),
                None => json!({"outcome":"cancelled"}),
            };
            self.emit_locked(
                session,
                &mut state,
                "permission_resolved",
                json!({"id":permission_id,"optionId":option_id,"outcome":outcome["outcome"]}),
            )?;
            let pending = state
                .permissions
                .remove(permission_id)
                .ok_or("This permission request has expired.")?;
            self.update_hold(session, &state);
            (pending, outcome)
        };
        pending
            .responder
            .respond(json!({"outcome":outcome}))
            .map_err(|e| e.to_string())
    }

    pub(super) async fn expire_permissions(&self, session: &LiveSession) {
        self.expire_permissions_now(session);
    }

    /// Answers every open permission card as cancelled.
    fn expire_permissions_now(&self, session: &LiveSession) {
        let pending = if let Ok(mut state) = session.state.lock() {
            let drained = state.permissions.drain().collect::<Vec<_>>();
            self.update_hold(session, &state);
            drained
        } else {
            Vec::new()
        };
        for (id, entry) in pending {
            if let Ok(mut state) = session.state.lock() {
                let _ = self.emit_locked(
                    session,
                    &mut state,
                    "permission_resolved",
                    json!({"id":id,"outcome":"cancelled"}),
                );
            }
            let _ = entry
                .responder
                .respond(json!({"outcome":{"outcome":"cancelled"}}));
        }
    }
}

/// Whether the record changed apart from its counters since it was stored.
/// The usage view's own time moves with every usage update, so it does not
/// count either: an update that changed no number rewrites nothing.
fn record_changed(state: &mut LiveState) -> bool {
    let Some(saved) = &state.saved else {
        return true;
    };
    let (updated_at, last_sequence) = (state.record.updated_at, state.record.last_sequence);
    let usage_at = state.record.usage.as_ref().map(|usage| usage.updated_at);
    state.record.updated_at = saved.updated_at;
    state.record.last_sequence = saved.last_sequence;
    if let (Some(usage), Some(saved)) = (state.record.usage.as_mut(), saved.usage.as_ref()) {
        usage.updated_at = saved.updated_at;
    }
    let same = *saved == state.record;
    state.record.updated_at = updated_at;
    state.record.last_sequence = last_sequence;
    if let (Some(usage), Some(at)) = (state.record.usage.as_mut(), usage_at) {
        usage.updated_at = at;
    }
    !same
}

/// Where the task homes of an earlier run go at startup, before they are
/// deleted (a name with a random suffix each start).
const STALE_TASK_TEMP: &str = "task-temp-stale-";

/// Deletes the task homes earlier runs left (one that could not be deleted
/// last time is tried again).
fn remove_stale_task_temp(acp_root: &Path) {
    let Ok(entries) = std::fs::read_dir(acp_root) else {
        return;
    };
    for entry in entries.flatten() {
        if entry
            .file_name()
            .to_str()
            .is_some_and(|name| name.starts_with(STALE_TASK_TEMP))
        {
            let _ = std::fs::remove_dir_all(entry.path());
        }
    }
}

/// Whether the background helper runs (it holds its lock). `acp_root` is
/// `<data>/acp`.
fn helper_is_running(acp_root: &Path) -> bool {
    acp_root.parent().is_some_and(|data| {
        let lock = oleafly_cli::daemon::paths::helper_paths(data).lock;
        // An unreadable lock counts as held: deleting a bridge the helper
        // still runs is worse than keeping one a day longer.
        oleafly_cli::daemon::lock::HelperLock::is_held_elsewhere(&lock).unwrap_or(true)
    })
}

/// The startup cleanup: bridge versions an update replaced and the npm
/// cache of an earlier build. While the background helper runs, its agents
/// may still load files from an old version, so versions stay until a
/// start without it (an install removes them too).
fn startup_cleanup(acp_root: &Path, helper_running: bool) {
    if !helper_running {
        for definition in catalog::builtins() {
            let keep = definition.version.clone();
            catalog::cleanup_old_versions(acp_root, &definition, &keep);
        }
    }
    // An earlier build kept every install's npm cache in one folder.
    let _ = std::fs::remove_dir_all(acp_root.join("npm-cache"));
}

/// Why a saved conversation can't continue where the project's agent runs
/// now: its agent session lives on the machine it was made on.
fn moved_target(record: &SessionRecord, settings: &HermesSettings) -> Option<&'static str> {
    let now = settings
        .remote
        .as_ref()
        .filter(|_| settings.mode == HermesMode::Remote);
    match (&record.remote, now) {
        (Some(_), None) => Some("This conversation ran on another machine, and Hermes now runs on this computer. Start a new conversation to continue."),
        (None, Some(_)) => Some("This conversation ran on this computer, and Hermes now runs on another machine. Start a new conversation to continue."),
        (Some(before), Some(now)) if before.host != now.host || before.folder != now.folder => {
            Some("This conversation ran on another machine than the one Hermes uses now. Start a new conversation to continue.")
        }
        _ => None,
    }
}

pub(super) fn default_title(definition: &AgentDefinition) -> String {
    format!("{} conversation", definition.name)
}

/// The client options for every interactive and task connection.
pub(super) fn client_options(fs_read: bool, prefer_v2: bool) -> ClientOptions {
    ClientOptions {
        info: ClientInfo {
            name: "oleafly".into(),
            title: "Oleafly".into(),
            version: env!("CARGO_PKG_VERSION").into(),
        },
        prefer_v2,
        fs_read,
    }
}

/// An auth method with every agent-written text passed through the
/// session's redactor.
pub(super) fn redacted_auth_method(
    redactor: &Redactor,
    method: &super::AuthMethod,
) -> super::AuthMethod {
    let mut method = method.clone();
    method.name = redactor.text(&method.name);
    method.description = method
        .description
        .as_deref()
        .map(|text| redactor.text(text));
    method.args = method.args.iter().map(|arg| redactor.text(arg)).collect();
    for value in method.env.values_mut() {
        *value = redactor.text(value);
    }
    if let Some(command) = &mut method.terminal_command {
        command.args = command.args.iter().map(|arg| redactor.text(arg)).collect();
        command.label = command.label.as_deref().map(|text| redactor.text(text));
    }
    method
}

/// The text a new session's title is made from.
fn turn_title<'a>(text: &'a str, has_text: bool, skill: Option<&'a PromptSkill>) -> &'a str {
    if has_text {
        text.trim()
    } else {
        skill.map_or("", |skill| skill.name.as_str())
    }
}

/// How a turn ended: the session's status, the stop reason and the error
/// shown for it.
fn turn_outcome(
    result: &Result<Value, RpcError>,
    cancelled: bool,
    closed: bool,
    live_status: &SessionStatus,
    redactor: &Redactor,
) -> (SessionStatus, String, Option<String>) {
    match result {
        Ok(value) if !cancelled => match value["stopReason"]
            .as_str()
            .filter(|reason| !reason.trim().is_empty())
        {
            Some(reason) => (live_status.clone(), reason.to_owned(), None),
            None => (
                live_status.clone(),
                "error".into(),
                Some("The agent did not report how this turn ended.".into()),
            ),
        },
        _ if cancelled => (
            if closed {
                SessionStatus::Cancelled
            } else {
                live_status.clone()
            },
            "cancelled".into(),
            None,
        ),
        Err(error) if !closed && error.auth_required() => (
            SessionStatus::AuthRequired,
            "error".into(),
            Some(redactor.text(&error.to_string())),
        ),
        Err(error) => (
            live_status.clone(),
            "error".into(),
            Some(redactor.text(&error.to_string())),
        ),
        _ => (
            live_status.clone(),
            "error".into(),
            Some("The agent stopped before completing this turn.".into()),
        ),
    }
}

pub(super) fn canonical_root(path: &Path) -> Result<PathBuf, String> {
    if !path.is_absolute() || path.components().any(|c| matches!(c, Component::ParentDir)) {
        return Err(
            "The ACP project root must be an absolute directory without parent traversal.".into(),
        );
    }
    let root = path
        .canonicalize()
        .map_err(|_| "The ACP project directory could not be resolved.")?;
    if !root.is_dir() {
        return Err("The ACP project root is not a directory.".into());
    }
    Ok(root)
}

/// The agent's process: sandboxed task launches keep the sandbox's own fixed
/// environment; every other launch gets plain paths, the launch root as its
/// working folder and the agent environment (search path, CLI hand-off).
pub(super) fn build_agent_command(
    acp_root: &Path,
    record: &SessionRecord,
    definition: &AgentDefinition,
    launch: &catalog::Launch,
    launch_root: &Path,
    allowed_paths: Option<&[String]>,
    task_temp: Option<&Path>,
) -> Result<tokio::process::Command, String> {
    let mut command = if let Some(paths) = allowed_paths {
        let launch = launch.resolved_for_sandbox();
        // The task names its sandbox profile on Windows.
        let owner = record
            .task_id
            .as_deref()
            .map(|task_id| format!("task:{task_id}"))
            .unwrap_or_default();
        let mut spec = crate::agent::task_runtime::task_sandbox_spec_for(
            &owner,
            Some(&record.project_id),
            Path::new(&record.project_path),
            paths,
            task_temp.ok_or("The task temporary directory is missing.")?,
            true,
            &super::task_launch::runtime_reads(acp_root, definition, &launch),
        )?;
        spec.env = super::task_launch::task_env(
            &launch,
            &record.project_id,
            Path::new(&record.project_path),
        )?;
        spec.child_processes = catalog::is_codex(definition);
        if cfg!(windows) {
            // The folder of the agent's program (the Node.js that runs a
            // bridge script) comes first on the task's PATH.
            spec.path_prepend = launch
                .executable
                .parent()
                .filter(|folder| !folder.as_os_str().is_empty())
                .map(|folder| vec![folder.to_path_buf()])
                .unwrap_or_default();
        }
        let args: Vec<std::ffi::OsString> = launch.args.iter().map(Into::into).collect();
        let std_command = oleafly_sandbox::command(&spec, &launch.executable, &args)
            .map_err(|error| error.to_string())?;
        let mut command = tokio::process::Command::from(std_command);
        // The project path is stored canonical (`\\?\` on Windows), which
        // cmd.exe rejects as a working folder.
        command.current_dir(crate::program_locator::child_path(Path::new(
            &record.project_path,
        )));
        command
    } else {
        if launch.batch {
            crate::program_locator::script_launch_check(&launch.executable, launch_root)?;
        } else if launch.needs_local_folder && crate::program_locator::network_folder(launch_root) {
            return Err("This agent can't start from a network folder. Open the project from a drive letter, such as Z:, and try again.".into());
        }
        let mut command = tokio::process::Command::new(&launch.executable);
        command
            .args(&launch.args)
            .current_dir(launch_root)
            .envs(launch.env.iter().map(|(name, value)| (name, value)));
        command
    };
    if record.remote.is_none() {
        if let Some(hardening) =
            crate::trust::git_restriction(&record.project_id, Path::new(&record.project_path))?
        {
            command.envs(hardening);
        }
    }
    Ok(command)
}

/// Canonical project roots mapped to the folder the agent is started in.
static LAUNCH_ROOTS: Mutex<Option<HashMap<PathBuf, PathBuf>>> = Mutex::new(None);

/// The folder an agent starts in for `canonical`: the user's own
/// drive-letter path when it leads to the same folder (a mapped network
/// drive stays `Z:\thesis` instead of `\\server\share\thesis`, which cmd.exe
/// cannot use), otherwise [`default_launch_root`].
pub(super) fn launch_root_from(original: Option<&Path>, canonical: &Path) -> PathBuf {
    original
        .filter(|original| original.is_absolute())
        .filter(|original| original.canonicalize().is_ok_and(|real| real == canonical))
        .map(crate::program_locator::child_path)
        .filter(|root| !crate::program_locator::network_folder(root))
        .unwrap_or_else(|| default_launch_root(canonical))
}

/// The canonical root as a plain path. Project paths are stored canonical,
/// so a project opened from a mapped drive arrives as `\\server\share\...`;
/// it is spelled through the mapped drive that leads to it when there is one.
fn default_launch_root(canonical: &Path) -> PathBuf {
    let plain = crate::program_locator::child_path(canonical);
    if !crate::program_locator::network_folder(&plain) {
        return plain;
    }
    path_through_alias(canonical, &mapped_network_drives()).unwrap_or(plain)
}

/// `canonical` spelled through the first alias whose canonical target is
/// closest above it. Each alias is `(alias, canonical target)`.
pub(crate) fn path_through_alias(
    canonical: &Path,
    aliases: &[(PathBuf, PathBuf)],
) -> Option<PathBuf> {
    aliases
        .iter()
        .rev()
        .filter_map(|(alias, target)| {
            let rest = canonical.strip_prefix(target).ok()?;
            let path = if rest.as_os_str().is_empty() {
                alias.clone()
            } else {
                alias.join(rest)
            };
            Some((target.components().count(), path))
        })
        .max_by_key(|(depth, _)| *depth)
        .map(|(_, path)| path)
}

/// Mapped network drives as `(X:\, canonical target)`.
#[cfg(windows)]
fn mapped_network_drives() -> Vec<(PathBuf, PathBuf)> {
    use std::os::windows::ffi::OsStrExt as _;
    use windows_sys::Win32::Storage::FileSystem::{GetDriveTypeW, GetLogicalDrives};
    const DRIVE_REMOTE: u32 = 4;
    let present = unsafe { GetLogicalDrives() };
    (0..26u8)
        .filter(|index| present & (1 << index) != 0)
        .filter_map(|index| {
            let drive = PathBuf::from(format!("{}:\\", char::from(b'A' + index)));
            let wide: Vec<u16> = drive
                .as_os_str()
                .encode_wide()
                .chain(std::iter::once(0))
                .collect();
            if unsafe { GetDriveTypeW(wide.as_ptr()) } != DRIVE_REMOTE {
                return None;
            }
            let target = drive.canonicalize().ok()?;
            Some((drive, target))
        })
        .collect()
}

#[cfg(not(windows))]
fn mapped_network_drives() -> Vec<(PathBuf, PathBuf)> {
    Vec::new()
}

/// Records the project folder as the user opened it, so agents start there
/// (called where the project's own path is known: starting and resuming from
/// a window).
pub(super) fn note_launch_root(original: &Path) {
    if let Ok(canonical) = original.canonicalize() {
        register_launch_root(&canonical, &launch_root_from(Some(original), &canonical));
    }
}

pub(super) fn register_launch_root(canonical: &Path, root: &Path) {
    if let Ok(mut roots) = LAUNCH_ROOTS.lock() {
        roots
            .get_or_insert_with(HashMap::new)
            .insert(canonical.to_path_buf(), root.to_path_buf());
    }
}

/// The launch root recorded for a canonical project root, or
/// [`default_launch_root`] when none was recorded (delegated and task
/// sessions). A network root's lookup is remembered, since permission checks
/// ask for it on every request.
pub(super) fn launch_root_for(canonical: &Path) -> PathBuf {
    if let Some(root) = LAUNCH_ROOTS
        .lock()
        .ok()
        .and_then(|roots| roots.as_ref()?.get(canonical).cloned())
    {
        return root;
    }
    let root = default_launch_root(canonical);
    if crate::program_locator::network_folder(&crate::program_locator::child_path(canonical)) {
        register_launch_root(canonical, &root);
    }
    root
}

// The permission path policy lives in the ACP crate; the app supplies how
// the agent spells its roots (mapped drive letters, the launch folder).
#[cfg(test)]
pub(super) use oleafly_acp::paths::equivalent_path_prefixes;

pub fn permission_paths_allowed(root: &Path, tool: &Value) -> bool {
    let spelled = launch_root_for(root);
    oleafly_acp::paths::permission_paths_allowed(root, &spelled, tool)
}

/// Whether a request only reads inside the skill folder attached to the
/// turn (`folder` as the skill block names it).
pub(super) fn skill_read_allowed(folder: &Path, kind: Option<&str>, tool: &Value) -> bool {
    let spelled = crate::program_locator::child_path(folder);
    oleafly_acp::paths::skill_read_allowed(folder, &spelled, kind, tool)
}

/// The turn's token counters for the usage ledger, read as the session's
/// usage view reads them (`usage` or `_meta.quota.token_count`, camel or
/// snake case).
pub fn prompt_usage(value: &Value) -> Option<UsageCounters> {
    let usage = oleafly_acp::usage::TurnTokens::from_prompt_response(value)?;
    Some(UsageCounters {
        input_tokens: usage.input_tokens,
        output_tokens: usage.output_tokens,
        cache_read_tokens: usage.cached_read_tokens,
        cache_write_tokens: usage.cached_write_tokens,
        total_tokens: usage.total_tokens,
        thought_tokens: usage.thought_tokens,
        source: "acp_prompt".into(),
        ..UsageCounters::default()
    })
}

// 0.4.8 L: CLI-agent research tasks handed to and from the background helper.

/// Homes of sessions adopted from the background helper, by session record
/// id, for [`AcpRuntime::spawn_session`] to start the agent in.
static ADOPTED_HOMES: Mutex<Option<HashMap<String, PathBuf>>> = Mutex::new(None);

fn adopt_home(record_id: &str, home: &Path) {
    if let Ok(mut homes) = ADOPTED_HOMES.lock() {
        homes
            .get_or_insert_with(HashMap::new)
            .insert(record_id.to_owned(), home.to_path_buf());
    }
}

fn take_adopted_home(record_id: &str) -> Option<PathBuf> {
    ADOPTED_HOMES
        .lock()
        .ok()
        .and_then(|mut homes| homes.as_mut().and_then(|homes| homes.remove(record_id)))
}

/// Whether a handed-back agent home is one the helper made for this task:
/// an `acp-home-<generation>` folder (not a link) next to the task's
/// workspace `root`, in the task's own folder. Anything else (a damaged
/// record) is never made the agent's home, which is later deleted.
fn handoff_home_allowed(is_folder: bool, home: &Path, root: &Path) -> bool {
    let named = home
        .file_name()
        .and_then(|name| name.to_str())
        .is_some_and(|name| name.starts_with("acp-home-"));
    named && is_folder && home.parent().is_some() && home.parent() == root.parent()
}

/// Removes the sign-in files copied into a task agent's home; a start
/// copies them fresh.
async fn remove_sign_in_files(home: &Path, agent_id: &str) {
    let mut stale: Vec<&str> = oleafly_cli::daemon::acp_task::credential_files(agent_id).to_vec();
    stale.push(".gemini/settings.json");
    for relative in stale {
        let _ = tokio::fs::remove_file(home.join(relative)).await;
    }
}

/// How long [`rename_with_retry`] keeps trying, and how often.
const RENAME_TRIES: usize = 5;
const RENAME_PAUSE: Duration = Duration::from_millis(200);

/// Renames `from` to `to`, trying again while Windows still has a handle
/// open in the folder (a sharing violation, raw OS error 32, or access
/// denied right after the agent exited).
pub(crate) fn rename_with_retry(
    from: &Path,
    to: &Path,
    rename: &dyn Fn(&Path, &Path) -> std::io::Result<()>,
) -> std::io::Result<()> {
    let mut tries = 0;
    loop {
        tries += 1;
        match rename(from, to) {
            Ok(()) => return Ok(()),
            Err(error)
                if tries < RENAME_TRIES
                    && (error.raw_os_error() == Some(32)
                        || error.kind() == std::io::ErrorKind::PermissionDenied) =>
            {
                std::thread::sleep(RENAME_PAUSE);
            }
            Err(error) => return Err(error),
        }
    }
}

impl AcpRuntime {
    /// The sandboxed launch of `agent_id` for a research task, as data: the
    /// background helper rebuilds the agent's command from it (the sandbox
    /// clears the environment, so nothing of the helper's leaks in). `home`
    /// is the agent's home for the task; the agent's sign-in files are
    /// copied into it.
    pub(crate) async fn task_launch(
        &self,
        agent_id: &str,
        project_id: &str,
        task_id: &str,
        execution_root: &Path,
        allowed_paths: &[String],
        home: &Path,
    ) -> Result<oleafly_research::handoff::AcpLaunch, String> {
        let launch = self
            .task_launch_without_sign_in(
                agent_id,
                project_id,
                task_id,
                execution_root,
                allowed_paths,
                home,
            )
            .await?;
        drop(super::task_launch::prepare_credentials(
            &crate::paths::home_dir()?,
            home,
            agent_id,
            &[],
        )?);
        Ok(launch)
    }

    /// [`Self::task_launch`] for a task the helper starts later (a queued
    /// one): its home gets no copy of the sign-in files, which would sit
    /// there until then. The helper copies them when it starts the task, to
    /// the paths [`super::task_launch::prepare_credentials`] uses. Copies an
    /// earlier generation left are removed.
    pub(crate) async fn task_launch_without_sign_in(
        &self,
        agent_id: &str,
        project_id: &str,
        task_id: &str,
        execution_root: &Path,
        allowed_paths: &[String],
        home: &Path,
    ) -> Result<oleafly_research::handoff::AcpLaunch, String> {
        let definition = self.definition(agent_id)?;
        if let Some(reason) = catalog::task_unavailable_reason(&definition) {
            return Err(reason);
        }
        let settings = self.hermes_settings(&definition, project_id);
        if settings.mode == HermesMode::Remote {
            return Err("Remote Hermes cannot run research tasks.".into());
        }
        let root = canonical_root(execution_root)?;
        // The agent's home: its own session history there stays, sign-in
        // copies are removed (a start copies them fresh).
        tokio::fs::create_dir_all(home)
            .await
            .map_err(|_| "The agent's home could not be made.")?;
        remove_sign_in_files(home, &definition.id).await;
        let record = SessionRecord {
            project_id: project_id.into(),
            project_path: root.to_string_lossy().into_owned(),
            agent_id: definition.id.clone(),
            task_id: Some(task_id.into()),
            ..SessionRecord::default()
        };
        let prefs = self.preferences();
        let launch = self
            .session_launch(&definition, &record, &settings, &prefs)
            .await?
            .resolved_for_sandbox();
        let mut spec = crate::agent::task_runtime::task_sandbox_spec_for(
            &format!("task:{task_id}"),
            Some(project_id),
            &root,
            allowed_paths,
            home,
            true,
            &super::task_launch::runtime_reads(&self.root, &definition, &launch),
        )?;
        spec.env = super::task_launch::task_env(&launch, project_id, &root)?;
        spec.child_processes = catalog::is_codex(&definition);
        if cfg!(windows) {
            spec.path_prepend = launch
                .executable
                .parent()
                .filter(|folder| !folder.as_os_str().is_empty())
                .map(|folder| vec![folder.to_path_buf()])
                .unwrap_or_default();
        }
        Ok(oleafly_research::handoff::AcpLaunch {
            sandbox: spec,
            program: launch.executable.clone(),
            args: launch.args.clone(),
        })
    }

    /// Ends a research task's agent between turns for a handoff: closes its
    /// session, stops it, waits for the process to exit and moves its home
    /// (with the agent's own history) to `destination`. The session is
    /// released; nothing is deleted.
    pub(crate) async fn close_task_for_handoff(
        self: &Arc<Self>,
        record_id: &str,
        destination: &Path,
    ) -> Result<oleafly_research::handoff::AcpHandoff, String> {
        let session = self.get_live(record_id).await?;
        let record = self.copy_record(&session)?;
        let native = record
            .native_session_id
            .clone()
            .ok_or("The agent session has no id to resume.")?;
        let home = session
            .task_temp
            .as_ref()
            .map(|temporary| temporary.0.clone())
            .ok_or("The agent session has no task home.")?;
        // A turn still running holds the operation lock; it ends first.
        if record.status == SessionStatus::Running {
            let _ = session.client.cancel(&native);
        }
        let idle = tokio::time::timeout(CANCEL_GRACE, session.operation.lock()).await;
        if idle.is_err() {
            return Err("The agent did not finish its turn in time.".into());
        }
        drop(idle);
        if record.capabilities.close {
            let _ = tokio::time::timeout(CANCEL_GRACE, session.client.close_session(&native)).await;
        }
        self.expire_permissions(&session).await;
        // The disconnect releases the session in the background; the home
        // it would delete is about to move.
        session.keep_home.store(true, Ordering::Release);
        session.client.shutdown().await;
        if let Some(pid) = session.pid {
            let deadline = Instant::now() + CANCEL_GRACE;
            while Instant::now() < deadline
                && oleafly_sandbox::process::identity::probe(pid)
                    != oleafly_sandbox::process::identity::ProcessProbe::Gone
            {
                tokio::time::sleep(Duration::from_millis(50)).await;
            }
        }
        // A home kept from the last generation is already where it goes.
        if home != destination {
            if let Some(parent) = destination.parent() {
                tokio::fs::create_dir_all(parent)
                    .await
                    .map_err(|_| "The task's folder for the agent home could not be made.")?;
            }
            let _ = tokio::fs::remove_dir_all(destination).await;
            let (from, to) = (home.clone(), destination.to_path_buf());
            tokio::task::spawn_blocking(move || {
                rename_with_retry(&from, &to, &|from, to| std::fs::rename(from, to))
            })
            .await
            .map_err(|_| "The agent home could not be moved.")?
            .map_err(|error| format!("The agent home could not be moved: {error}"))?;
        }
        if let Ok(mut state) = session.state.lock() {
            state.record.status = SessionStatus::Disconnected;
            let _ = self.emit_locked(
                &session,
                &mut state,
                "status",
                json!({"status": "disconnected"}),
            );
        }
        self.release_live(&session).await;
        Ok(oleafly_research::handoff::AcpHandoff {
            agent_session_id: native,
            home: destination.to_path_buf(),
        })
    }

    /// Continues a research task's agent session the background helper
    /// handed back: the agent starts with its retained home (its sign-in
    /// files copied fresh) and the session opens with `session/resume`,
    /// else `session/load`. Fails when the agent can do neither; the caller
    /// then starts a new session.
    pub(crate) async fn adopt_task_session(
        self: &Arc<Self>,
        handoff: &oleafly_research::handoff::AcpHandoff,
        options: StartSession,
        mcp_servers: Vec<Value>,
        generation: Option<u64>,
    ) -> Result<SessionSnapshot, String> {
        crate::trust::require_trusted(
            &options.project_id,
            crate::trust::Capability::ExternalAgents,
        )?;
        if options.allowed_paths.is_none() || options.task_id.is_none() {
            return Err("Only a research task's agent session can be adopted.".into());
        }
        let home = canonical_root(&handoff.home)?;
        let root = canonical_root(&options.project_path)?;
        // The folder itself, not a link to one.
        let is_folder = tokio::fs::symlink_metadata(&handoff.home)
            .await
            .is_ok_and(|metadata| metadata.is_dir());
        if !handoff_home_allowed(is_folder, &home, &root) {
            return Err(
                "The agent's home from the background helper is not in this task's folder.".into(),
            );
        }
        let definition = self.definition(&options.agent_id)?;
        // The sign-in files are copied again: the user may have signed in
        // anew since the handoff.
        remove_sign_in_files(&home, &definition.id).await;
        let time = now_ms();
        let record = SessionRecord {
            id: new_id(),
            project_id: options.project_id,
            project_path: root.to_string_lossy().into_owned(),
            agent_id: definition.id.clone(),
            native_session_id: Some(handoff.agent_session_id.clone()),
            task_id: options.task_id,
            title: default_title(&definition),
            status: SessionStatus::Connecting,
            created_at: time,
            updated_at: time,
            ..SessionRecord::default()
        };
        let id = record.id.clone();
        adopt_home(&id, &home);
        let result = self
            .connect(
                record,
                options.owner,
                mcp_servers,
                options.allowed_paths,
                options.task_commands,
                generation,
            )
            .await;
        // Unused when the start failed before the agent ran.
        let _ = take_adopted_home(&id);
        result
    }
}

/// Tests of the handoff pieces that need no agent (they run on every OS;
/// the agent fixtures in `task_tests` are macOS-only).
#[cfg(test)]
mod handoff_tests {
    use std::cell::Cell;
    use std::path::Path;

    use super::rename_with_retry;

    #[test]
    fn renaming_an_agent_home_retries_sharing_violations() {
        let attempts = Cell::new(0);
        rename_with_retry(Path::new("a"), Path::new("b"), &|_, _| {
            attempts.set(attempts.get() + 1);
            if attempts.get() < 3 {
                // ERROR_SHARING_VIOLATION: Windows still has a handle open.
                Err(std::io::Error::from_raw_os_error(32))
            } else {
                Ok(())
            }
        })
        .unwrap();
        assert_eq!(attempts.get(), 3);
        let tries = Cell::new(0);
        let error = rename_with_retry(Path::new("a"), Path::new("b"), &|_, _| {
            tries.set(tries.get() + 1);
            Err(std::io::Error::from(std::io::ErrorKind::NotFound))
        })
        .unwrap_err();
        assert_eq!(
            (tries.get(), error.kind()),
            (1, std::io::ErrorKind::NotFound)
        );
        let stuck = Cell::new(0);
        assert!(rename_with_retry(Path::new("a"), Path::new("b"), &|_, _| {
            stuck.set(stuck.get() + 1);
            Err(std::io::Error::from(std::io::ErrorKind::PermissionDenied))
        })
        .is_err());
        assert_eq!(stuck.get(), 5);
    }

    #[test]
    fn a_start_is_refused_only_when_its_owner_closed_after_it_began() {
        use super::OwnerEpochs;
        use std::time::{Duration, Instant};
        let now = Instant::now();
        let mut epochs = OwnerEpochs::default();
        let ticket = epochs.ticket();
        epochs.close("research-task:a", now);
        assert!(!epochs.is_current("research-task:a", ticket));
        assert!(epochs.is_current("window", ticket));
        assert!(epochs.is_current("research-task:a", epochs.ticket()));
        // Owners closed long ago are forgotten; a start that old is refused
        // whatever its owner, a newer one is not.
        let later = now + Duration::from_secs(11 * 60);
        let recent = epochs.ticket();
        for index in 0..1000 {
            epochs.close(&format!("external:{index}"), now);
        }
        epochs.close("research-task:b", later);
        assert_eq!(epochs.closed.len(), 1);
        assert!(!epochs.is_current("research-task:a", ticket));
        assert!(!epochs.is_current("external:5", recent));
        assert!(epochs.is_current("external:5", epochs.ticket()));
        assert!(epochs.is_current("window", epochs.ticket()));
    }

    #[test]
    fn old_bridge_versions_stay_while_the_background_helper_runs() {
        let data = tempfile::tempdir().unwrap();
        let acp = data.path().join("acp");
        let definition = super::catalog::builtins().remove(0);
        let old = acp.join("agents").join(&definition.id).join("0.0.1");
        std::fs::create_dir_all(&old).unwrap();
        std::fs::write(old.join("receipt.json"), "{}").unwrap();
        let lock = oleafly_cli::daemon::lock::HelperLock::acquire(
            &oleafly_cli::daemon::paths::helper_paths(data.path()).lock,
            std::time::Duration::ZERO,
        )
        .unwrap()
        .expect("the test holds the helper lock");
        assert!(super::helper_is_running(&acp));
        super::startup_cleanup(&acp, super::helper_is_running(&acp));
        assert!(old.is_dir(), "kept while the helper runs");
        drop(lock);
        assert!(!super::helper_is_running(&acp));
        super::startup_cleanup(&acp, super::helper_is_running(&acp));
        assert!(!old.exists(), "removed at a start without the helper");
    }

    #[test]
    fn a_usage_update_that_changed_no_number_rewrites_no_record() {
        use super::{record_changed, LiveState};
        use crate::acp::{SessionRecord, SessionUsage};
        let record = SessionRecord {
            usage: Some(SessionUsage {
                context_used: Some(10),
                updated_at: 1,
                ..SessionUsage::default()
            }),
            ..SessionRecord::default()
        };
        let mut state = LiveState {
            record: record.clone(),
            saved: Some(record),
            permissions: Default::default(),
            elicitations: Default::default(),
            replaying: false,
            cancelled: false,
            bytes: 0,
            tool_calls: Default::default(),
            skill_folder: None,
            hidden: None,
            hidden_tools: false,
            coalescer: Default::default(),
            flush_timer: false,
            compactions: Default::default(),
            default_title: false,
            early: Vec::new(),
            turn_closed: false,
        };
        state.record.usage.as_mut().unwrap().updated_at = 2;
        assert!(!record_changed(&mut state));
        assert_eq!(state.record.usage.as_ref().unwrap().updated_at, 2);
        state.record.usage.as_mut().unwrap().context_used = Some(11);
        assert!(record_changed(&mut state));
    }

    /// The helper refreshes an agent's sign-in files by the same list the
    /// app copies them by.
    #[test]
    fn the_helper_and_the_app_copy_the_same_sign_in_files() {
        let every_file = [
            ".claude/.credentials.json",
            ".claude/settings.json",
            ".codex/auth.json",
            ".codex/config.json",
            ".gemini/oauth_creds.json",
            ".gemini/google_accounts.json",
            ".pi/agent/auth.json",
            ".pi/agent/settings.json",
            ".pi/agent/models.json",
            ".hermes/auth.json",
        ];
        let home = tempfile::tempdir().unwrap();
        for relative in every_file {
            let path = home.path().join(relative);
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(&path, r#"{"token":"fixture-sign-in-value"}"#).unwrap();
        }
        for agent in ["claude", "codex", "gemini", "pi", "hermes", "custom-agent"] {
            let copy = tempfile::tempdir().unwrap();
            crate::acp::task_launch::prepare_credentials(home.path(), copy.path(), agent, &[])
                .unwrap();
            let copied: Vec<&str> = every_file
                .into_iter()
                .filter(|relative| copy.path().join(relative).is_file())
                .collect();
            assert_eq!(
                copied,
                oleafly_cli::daemon::acp_task::credential_files(agent),
                "{agent}"
            );
        }
    }
}
