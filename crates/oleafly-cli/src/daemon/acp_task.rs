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

use oleafly_acp::capabilities::AgentCapabilities;
use oleafly_acp::client::{
    AcpClient, ClientHost, ClientInfo, ClientOptions, IncomingRequest, TurnTiming,
};
use oleafly_acp::controls::{ConfigKind, ConfigValue, ModeSwitch, SessionControls};
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
/// Permission requests that may wait for an approval at once (the app's
/// cap); more are cancelled.
const MAX_PENDING_REQUESTS: usize = 16;
/// Paths kept per tool call; a call naming more is judged as outside.
const MAX_TRACKED_PATHS: usize = 256;
/// Tool calls remembered per session; past it the list starts again.
const MAX_TRACKED_CALLS: usize = 64;
/// A path no project contains, standing for the paths past the limit.
const UNTRACKED_PATH: &str = "../untracked";
/// Switches out of a mode with permission checks off before Oleafly says it
/// couldn't (the app's limit).
const MAX_MODE_SWITCHES: u32 = 3;
/// The project's tool rules, which the app writes and the helper re-reads
/// for each request.
const APPROVALS_FILE: &str = "approvals.toml";
const MAX_APPROVALS_BYTES: u64 = 4 * 1024 * 1024;

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

fn private_folder(path: &Path) -> Result<(), String> {
    std::fs::create_dir_all(path).map_err(|_| "The agent's home could not be made.".to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o700))
            .map_err(|_| "The agent's home could not be protected.".to_string())?;
    }
    Ok(())
}

fn write_private(path: &Path, bytes: &[u8]) -> Result<(), String> {
    use std::io::Write;
    if let Some(parent) = path.parent() {
        private_folder(parent)?;
    }
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options
        .open(path)
        .map_err(|_| "The agent's sign-in file could not be created.".to_string())?;
    file.write_all(bytes)
        .map_err(|_| "The agent's sign-in file could not be written.".to_string())
}

/// Copies the agent's sign-in files from the user's own home into the
/// task's home, as the app's `prepare_credentials` does: the app no longer
/// copies them at quit for a task that is only queued, so the helper does
/// when it starts the agent. A file already in the task's home (an older
/// handoff, or the agent's own refreshed token) is kept. A source that is a
/// link, leaves the home, is over 256 KiB or isn't JSON is refused.
pub fn copy_credentials(user_home: &Path, task_home: &Path, agent_id: &str) -> Result<(), String> {
    private_folder(task_home)?;
    let Ok(user_home) = user_home.canonicalize() else {
        // No home to sign in from: the agent says it needs a sign-in.
        return Ok(());
    };
    for relative in credential_files(agent_id) {
        let destination = task_home.join(relative);
        if std::fs::symlink_metadata(&destination).is_ok() {
            continue;
        }
        let source = user_home.join(relative);
        let metadata = match source.symlink_metadata() {
            Ok(metadata) => metadata,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
            Err(_) => return Err("A CLI credential file could not be inspected.".into()),
        };
        if !metadata.is_file()
            || metadata.file_type().is_symlink()
            || metadata.len() > MAX_CREDENTIAL_BYTES
            || !source
                .canonicalize()
                .is_ok_and(|path| path.starts_with(&user_home))
        {
            return Err(
                "A CLI credential file is outside its account directory or too large.".into(),
            );
        }
        let bytes = zeroize::Zeroizing::new(
            std::fs::read(&source).map_err(|_| "A CLI credential file could not be read.")?,
        );
        if serde_json::from_slice::<serde::de::IgnoredAny>(&bytes).is_err() {
            return Err(
                "The CLI credential file is invalid. Sign in through the official CLI again."
                    .into(),
            );
        }
        write_private(&destination, &bytes)?;
    }
    let gemini_settings = task_home.join(".gemini/settings.json");
    if agent_id == "gemini"
        && task_home.join(".gemini/oauth_creds.json").is_file()
        && std::fs::symlink_metadata(&gemini_settings).is_err()
    {
        write_private(
            &gemini_settings,
            br#"{"security":{"auth":{"selectedType":"oauth-personal"}}}"#,
        )?;
    }
    Ok(())
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

/// What the agent announced about a tool call, for its later permission
/// requests: adapters announce a call with its kind and paths and then ask
/// with only its id (the app's `ToolCallView`, without the diff text).
#[derive(Clone, Debug, Default)]
struct CallView {
    kind: Option<String>,
    locations: Vec<String>,
    input_paths: Vec<String>,
    diff_paths: Vec<String>,
    /// More paths came than are kept.
    overflowed: bool,
}

fn kept_paths<'a>(paths: impl Iterator<Item = &'a str>, overflowed: &mut bool) -> Vec<String> {
    let mut kept: Vec<String> = paths
        .take(MAX_TRACKED_PATHS + 1)
        .map(str::to_owned)
        .collect();
    if kept.len() > MAX_TRACKED_PATHS {
        kept.truncate(MAX_TRACKED_PATHS);
        *overflowed = true;
    }
    kept
}

impl CallView {
    /// Applies the fields a `tool_call`, `tool_call_update` or permission
    /// `toolCall` carries; fields it leaves out keep their earlier values.
    fn apply(&mut self, update: &Value) {
        if let Some(kind) = update["kind"].as_str() {
            self.kind = Some(kind.chars().take(32).collect());
        }
        if let Some(locations) = update["locations"].as_array() {
            let paths = locations
                .iter()
                .filter_map(|location| location["path"].as_str());
            self.locations = kept_paths(paths, &mut self.overflowed);
        }
        if update["rawInput"].is_object() {
            let paths = oleafly_acp::paths::raw_input_paths(update);
            self.input_paths = kept_paths(paths, &mut self.overflowed);
        }
        if let Some(content) = update["content"].as_array() {
            let paths = content
                .iter()
                .filter(|item| item["type"] == "diff")
                .filter_map(|item| item["path"].as_str());
            self.diff_paths = kept_paths(paths, &mut self.overflowed);
        }
    }

    /// Every path the call names, for the path policy.
    fn paths(&self) -> impl Iterator<Item = &str> {
        self.locations
            .iter()
            .chain(&self.input_paths)
            .chain(&self.diff_paths)
            .map(String::as_str)
            .chain(self.overflowed.then_some(UNTRACKED_PATH))
    }
}

/// Remembers what a `tool_call` or `tool_call_update` says.
fn track_call(calls: &mut HashMap<String, CallView>, update: &Value) {
    let Some(id) = update["toolCallId"]
        .as_str()
        .filter(|id| !id.is_empty() && id.len() <= 512)
    else {
        return;
    };
    if !calls.contains_key(id) && calls.len() >= MAX_TRACKED_CALLS {
        calls.clear();
    }
    calls.entry(id.to_owned()).or_default().apply(update);
}

/// A permission request as the helper judges it: its kind (or the
/// announced call's) and every path the request and the call it refers to
/// name, as the app's `policy_view` does.
fn judged_request(
    calls: &HashMap<String, CallView>,
    tool: &Value,
) -> (Option<String>, Vec<String>) {
    let mut request = CallView::default();
    request.apply(tool);
    let remembered = tool["toolCallId"].as_str().and_then(|id| calls.get(id));
    let kind = request
        .kind
        .clone()
        .or_else(|| remembered.and_then(|call| call.kind.clone()));
    let paths = remembered
        .into_iter()
        .flat_map(CallView::paths)
        .chain(request.paths())
        .map(str::to_owned)
        .collect();
    (kind, paths)
}

/// The task's folder as requests may name it: canonical (what a path must
/// really be inside), and the spellings the agent may use (the plain form
/// it was started in, and the stored one).
struct TaskRoots {
    canonical: PathBuf,
    spellings: [PathBuf; 2],
}

impl TaskRoots {
    /// Canonicalizes `stored` (file work: call it off the async threads).
    fn resolve(stored: &Path) -> Result<Self, String> {
        let canonical = std::fs::canonicalize(stored)
            .map_err(|_| "The task's folder could not be found.".to_string())?;
        let plain = dunce::simplified(&canonical).to_path_buf();
        Ok(Self {
            canonical,
            spellings: [plain, stored.to_path_buf()],
        })
    }

    /// Whether every path leads inside the folder.
    fn contains_all<'a>(&self, mut paths: impl Iterator<Item = &'a str>) -> bool {
        paths.all(|path| {
            self.spellings.iter().any(|spelled| {
                oleafly_acp::paths::path_within(&self.canonical, spelled, Path::new(path))
            })
        })
    }
}

/// The Oleafly tools whose rules cover an ACP request of this kind (the
/// app's `tools_for_acp_kind`).
fn tools_for_kind(kind: Option<&str>) -> &'static [&'static str] {
    match kind {
        Some("execute") => &["run_command"],
        Some("edit") => &["write_file", "replace_in_file", "create_file"],
        Some("delete") => &["delete_file"],
        Some("move") => &["rename_file"],
        Some("read") => &["read_file"],
        Some("search") => &["search_project"],
        _ => &[],
    }
}

/// The tools the project's rules deny, read from the app's approvals file
/// now. `None` when the file can't be read or isn't what the app writes,
/// which refuses everything, as in the app.
fn denied_tools(data_root: &Path, project_id: &str) -> Option<Vec<String>> {
    let path = data_root.join(APPROVALS_FILE);
    let text = match std::fs::symlink_metadata(&path) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Some(Vec::new()),
        Err(_) => return None,
        Ok(metadata) if !metadata.is_file() || metadata.len() > MAX_APPROVALS_BYTES => return None,
        Ok(_) => std::fs::read_to_string(&path).ok()?,
    };
    let document = text.parse::<toml_edit::DocumentMut>().ok()?;
    let mut denied = Vec::new();
    for (project, item) in document.iter() {
        if project == "$approval_modes" {
            continue;
        }
        let tools = item.as_table_like()?;
        for (tool, decision) in tools.iter() {
            match decision.as_str()? {
                "deny" if project == project_id => denied.push(tool.to_owned()),
                "allow" | "deny" => {}
                _ => return None,
            }
        }
    }
    Some(denied)
}

/// Whether the project's rules refuse a request of `kind` now (the app's
/// `task_request_refused`): a deny rule for its tool refuses it, and while
/// the project has any deny rule a kind no tool's rules cover is refused
/// too. An unreadable rules file refuses.
fn rules_refuse(data_root: &Path, project_id: &str, kind: Option<&str>) -> bool {
    let Some(denied) = denied_tools(data_root, project_id) else {
        return true;
    };
    let tools = tools_for_kind(kind);
    tools
        .iter()
        .any(|tool| denied.iter().any(|denied| denied == tool))
        || (tools.is_empty() && !denied.is_empty())
}

/// A request judged against the task's folder and the project's rules.
struct Judged {
    kind: Option<String>,
    /// Every path it names is inside the task's folder.
    in_root: bool,
    /// It (or the call it refers to) names a path at all.
    names_paths: bool,
    /// The project's rules, read now, refuse it.
    refused_now: bool,
}

/// How a judged request is answered: a read or change that names no path
/// is refused rather than allowed on a guess, as are kinds the project's
/// rules refuse now; then the grant's rules and the command policy.
fn request_decision(grant: &AcpGrant, judged: &Judged, commands: CommandPolicy) -> PermissionPath {
    let file_request = matches!(
        judged.kind.as_deref(),
        Some("read" | "edit" | "delete" | "move")
    );
    if (file_request && !judged.names_paths) || judged.refused_now {
        return PermissionPath::Refuse;
    }
    permission_decision(grant, judged.kind.as_deref(), commands)
}

/// The agent's modes and options, kept to move it out of a mode with
/// permission checks off (the app's `leave_blocked_mode`).
#[derive(Default)]
struct ModeGuard {
    controls: SessionControls,
    switches: u32,
    /// A switch is on its way.
    switching: bool,
    warned: bool,
}

impl ModeGuard {
    /// The switch to try now: the agent is in a blocked mode, it offers
    /// another one, and attempts remain.
    fn next_switch(&mut self) -> Option<ModeSwitch> {
        if self.switching || self.switches >= MAX_MODE_SWITCHES {
            return None;
        }
        let switch = self.controls.blocked_mode(None)?.switch?;
        self.switches += 1;
        Some(switch)
    }

    /// What to tell the user, once, when the agent stays in a blocked mode.
    fn notice(&mut self, redactor: &Redactor) -> Option<String> {
        if self.warned || self.switching {
            return None;
        }
        let blocked = self.controls.blocked_mode(None)?;
        self.warned = true;
        Some(format!(
            "Permission checks are off ({}). The agent can edit files and run commands without asking. Oleafly could not switch it to another mode. Change the mode in the agent's own settings.",
            redactor.text(&blocked.name)
        ))
    }

    /// Applies the agent's answer to a switch.
    fn switched(&mut self, switch: &ModeSwitch, answer: &Value) {
        self.switching = false;
        if answer["configOptions"].is_array() {
            self.controls.merge(answer);
            return;
        }
        match &switch.config_id {
            Some(config_id) => {
                if let Some(ConfigKind::Select { current_value, .. }) = self
                    .controls
                    .options
                    .iter_mut()
                    .find(|option| &option.id == config_id)
                    .map(|option| &mut option.kind)
                {
                    *current_value = Some(switch.to.clone());
                }
            }
            None => {
                self.controls.mode_id = Some(switch.to.clone());
                self.controls.merge(answer);
            }
        }
    }
}

async fn send_switch(
    client: &AcpClient,
    session_id: &str,
    switch: &ModeSwitch,
) -> Result<Value, String> {
    match &switch.config_id {
        Some(config_id) => {
            client
                .set_config_option(session_id, config_id, &ConfigValue::Id(switch.to.clone()))
                .await
        }
        None => client.set_mode(session_id, &switch.to).await,
    }
    .map_err(|error| error.to_string())
}

/// During a turn: starts a switch out of a blocked mode in the background
/// (its answer comes back as [`FromAgent::Switched`]), or says once that
/// the agent stays in it.
fn guard_mode(
    guard: &mut ModeGuard,
    client: &Arc<AcpClient>,
    session_id: &str,
    sender: &mpsc::UnboundedSender<FromAgent>,
    redactor: &Redactor,
    events: &TaskEventSink,
) {
    if let Some(switch) = guard.next_switch() {
        guard.switching = true;
        let client = client.clone();
        let session_id = session_id.to_owned();
        let sender = sender.clone();
        tokio::spawn(async move {
            let answer = send_switch(&client, &session_id, &switch).await.ok();
            let _ = sender.send(FromAgent::Switched(switch, answer));
        });
    } else if let Some(message) = guard.notice(redactor) {
        events(TaskRuntimeEvent::Status { message });
    }
}

/// `work`, unless `cancel` fires first (the start-up requests each wait up
/// to a minute for the agent).
async fn until_cancelled<T>(
    cancel: &CancellationToken,
    work: impl std::future::Future<Output = T>,
) -> Result<T, String> {
    tokio::select! {
        biased;
        _ = cancel.cancelled() => Err(CANCELLED.into()),
        value = work => Ok(value),
    }
}

/// What the helper keeps about the running session: the announced tool
/// calls and the agent's modes.
#[derive(Default)]
struct SessionView {
    calls: HashMap<String, CallView>,
    mode: ModeGuard,
}

/// One session update of the running turn: tool calls are kept for their
/// permission requests, mode and option changes for the mode guard, and the
/// update goes to the transcript. Whether the agent's modes or options
/// changed.
fn apply_update(
    params: &Value,
    session_id: &str,
    redactor: &Redactor,
    view: &mut SessionView,
    outcome: &mut TaskRuntimeOutcome,
    events: &TaskEventSink,
) -> bool {
    if params["sessionId"].as_str() != Some(session_id) {
        return false;
    }
    let update = redactor.value(&params["update"]);
    let Some(kind) = update["sessionUpdate"].as_str().map(str::to_owned) else {
        return false;
    };
    let controls = matches!(
        kind.as_str(),
        "config_option_update" | "config_options_update" | "current_mode_update"
    );
    if controls {
        view.mode.controls.apply_update(&update);
    }
    if matches!(kind.as_str(), "tool_call" | "tool_call_update") {
        track_call(&mut view.calls, &update);
    }
    if let Some(event) = map_update(&kind, &update, outcome) {
        events(event);
    }
    controls
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
    /// A switch out of a blocked mode finished (`None`: it failed).
    Switched(ModeSwitch, Option<Value>),
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
    /// The step and approval-withdraw tokens of every run, instead of the
    /// scheduler's (tests).
    suspend_tokens: Option<(CancellationToken, CancellationToken)>,
    /// The home the agents' sign-in files are copied from (the user's;
    /// tests pass their own).
    user_home: Option<PathBuf>,
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
            suspend_tokens: None,
            user_home: crate::app_paths::home_dir(),
        })
    }

    #[cfg(test)]
    fn with_suspend_tokens(mut self, step: CancellationToken, withdraw: CancellationToken) -> Self {
        self.suspend_tokens = Some((step, withdraw));
        self
    }

    #[cfg(test)]
    fn with_user_home(mut self, home: PathBuf) -> Self {
        self.user_home = Some(home);
        self
    }

    /// The token that ends the task's generation at its next step and the
    /// one that withdraws its approval waits.
    fn suspend_tokens(&self, task_id: &str) -> (CancellationToken, CancellationToken) {
        match &self.suspend_tokens {
            Some(tokens) => tokens.clone(),
            None => (
                self.services.suspends.token(task_id),
                self.services.suspends.approvals(task_id),
            ),
        }
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
        // The grant is a database read.
        let grant = {
            let host = self.host.clone();
            let task_id = context.task_id.clone();
            tokio::task::spawn_blocking(move || host.grant(&task_id))
                .await
                .map_err(|_| OPEN_OLEAFLY.to_string())??
        };
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
        // The grant, skill and program-folder lookups read files and the
        // task database: off the helper's two async threads.
        let (skills, read_paths, linked_roots, search_dirs, project_root) = {
            let host = self.host.clone();
            let context = context.clone();
            tokio::task::spawn_blocking(move || {
                (
                    host.skills(&context),
                    host.skill_read_paths(&context),
                    host.linked_folders(&context),
                    host.program_search_dirs(),
                    host.project_root(&context.project_id),
                )
            })
            .await
            .map_err(|_| OPEN_OLEAFLY.to_string())?
        };
        let skills = skills?;
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
            read_paths,
            linked_roots,
            search_dirs,
            project_root,
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
        let task_servers = {
            let host = self.host.clone();
            let context = context.clone();
            tokio::task::spawn_blocking(move || host.task_mcp_servers(&context))
                .await
                .unwrap_or_default()
        };
        servers.extend(task_servers);
        // A task queued at quit comes with a home but without the agent's
        // sign-in files; they are copied now, when the agent starts.
        if let Some(user_home) = self.user_home.clone() {
            let home = launch.sandbox.home.clone();
            let agent = acp.agent_id.clone();
            tokio::task::spawn_blocking(move || copy_credentials(&user_home, &home, &agent))
                .await
                .map_err(|_| "The agent's sign-in could not be prepared.".to_string())??;
        }
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
        // Requests name paths as the agent sees them; they are judged
        // against the canonical folder (on Windows `\\?\C:\...`, which the
        // stored path never equals) and its plain spellings.
        let roots = {
            let stored = PathBuf::from(&context.execution_root);
            Arc::new(
                tokio::task::spawn_blocking(move || TaskRoots::resolve(&stored))
                    .await
                    .map_err(|_| "The task's folder could not be found.".to_string())??,
            )
        };
        // Each start-up request may wait a minute for the agent, so a stop
        // or cancel ends the wait.
        let negotiated = until_cancelled(cancel, client.initialize(&options))
            .await?
            .map_err(|error| redactor.text(&error.to_string()))?;
        let capabilities = negotiated.capabilities.clone();
        if !capabilities.mcp_http {
            bridge_http_servers(&mut servers)?;
        }
        let cwd = context.execution_root.clone();
        let mut resumed = None;
        if let Some(handoff) = &handoff {
            resumed = until_cancelled(
                cancel,
                restore_session(client, handoff, &capabilities, &cwd, &servers, receiver),
            )
            .await?;
            if resumed.is_none() {
                events(TaskRuntimeEvent::Status {
                    message: RESUME_FAILED.into(),
                });
            }
        }
        let was_resumed = resumed.is_some();
        let (session_id, started) = match resumed {
            Some(restored) => restored,
            None => {
                until_cancelled(cancel, start_session(client, &cwd, &servers, redactor)).await??
            }
        };
        // The agent's own session id, the same one the handoff carries.
        events(TaskRuntimeEvent::SessionBound {
            native_session_id: session_id.clone(),
        });
        let mut view = SessionView::default();
        view.mode.controls.merge(&redactor.value(&started));
        // An agent may start in a mode with permission checks off (its own
        // settings); move it out before the turn.
        while let Some(switch) = view.mode.next_switch() {
            match until_cancelled(cancel, send_switch(client, &session_id, &switch)).await? {
                Ok(answer) => view.mode.switched(&switch, &redactor.value(&answer)),
                Err(_) => break,
            }
        }
        if let Some(message) = view.mode.notice(redactor) {
            events(TaskRuntimeEvent::Status { message });
        }
        let interrupted_before = context
            .handoff
            .as_ref()
            .is_some_and(|handoff| handoff.turn_interrupted);
        let text = match (was_resumed, &context.resume) {
            (true, resume) => {
                continuation_prompt(resume.as_ref(), &context.record_dir, interrupted_before)
            }
            (false, Some(resume)) => resume_message(resume, &context.record_dir),
            (false, None) => task_prompt(context, skills),
        };
        let (step, withdraw) = self.suspend_tokens(&context.task_id);
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
                // A reclaim waits for the turn; a quit, update or stop that
                // comes while it does still ends the turn now.
                _ = withdraw.cancelled(), if suspending && !turn_interrupted && !cancelling => {
                    turn_interrupted = true;
                    stop_at.get_or_insert_with(|| tokio::time::Instant::now() + CANCEL_GRACE);
                    let _ = client.cancel(&session_id);
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
                                apply_update(&params, &session_id, redactor, &mut view, &mut outcome, events);
                            }
                            FromAgent::Permission(request) => answer(*request, None),
                            FromAgent::Withdrawn
                            | FromAgent::Disconnected
                            | FromAgent::Switched(..) => {}
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
                        if apply_update(&params, &session_id, redactor, &mut view, &mut outcome, events) {
                            guard_mode(&mut view.mode, client, &session_id, &sender, redactor, events);
                        }
                    }
                    Some(FromAgent::Switched(switch, result)) => {
                        match result {
                            Some(answer) => view.mode.switched(&switch, &redactor.value(&answer)),
                            None => view.mode.switching = false,
                        }
                        guard_mode(&mut view.mode, client, &session_id, &sender, redactor, events);
                    }
                    Some(FromAgent::Permission(request)) => {
                        let request = *request;
                        let params = request.params().clone();
                        if params["sessionId"].as_str() != Some(session_id.as_str()) || cancelling {
                            answer(request, None);
                            continue;
                        }
                        // The request's paths with those the call it refers
                        // to announced, and the project's rules as they are
                        // now (the files are read off the async threads).
                        let (kind, paths) = judged_request(&view.calls, &params["toolCall"]);
                        let judged = {
                            let roots = roots.clone();
                            let data_root = self.host.data_root().to_path_buf();
                            let project_id = context.project_id.clone();
                            tokio::task::spawn_blocking(move || Judged {
                                in_root: roots.contains_all(paths.iter().map(String::as_str)),
                                names_paths: !paths.is_empty(),
                                refused_now: rules_refuse(&data_root, &project_id, kind.as_deref()),
                                kind,
                            })
                            .await
                        };
                        let Ok(judged) = judged else {
                            answer(request, None);
                            continue;
                        };
                        if !judged.in_root {
                            answer(request, None);
                            continue;
                        }
                        let tool = &params["toolCall"];
                        match request_decision(acp, &judged, context.brief.permissions.commands) {
                            PermissionPath::Refuse => answer(request, option_id(&params, "reject_once")),
                            PermissionPath::Allow => answer(request, option_id(&params, "allow_once")),
                            PermissionPath::Ask if pending_asks.load(std::sync::atomic::Ordering::Acquire) >= MAX_PENDING_REQUESTS => {
                                answer(request, None);
                            }
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
                if let Some(reason) = unfinished_reason(&response) {
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

/// Turns an HTTP MCP server into a stdio one, for an agent that only
/// speaks stdio.
fn bridge_http_servers(servers: &mut [Value]) -> Result<(), String> {
    for server in servers {
        if server["type"] == "http" {
            *server = oleafly_research::mcp::stdio_server(server)?;
        }
    }
    Ok(())
}

/// Resumes the agent's own session when it can; a loaded session replays its
/// history first, which is already in the transcript. The session's id and
/// the agent's answer (its modes and options) when it came back.
async fn restore_session(
    client: &Arc<AcpClient>,
    handoff: &AcpHandoff,
    capabilities: &AgentCapabilities,
    cwd: &str,
    servers: &[Value],
    receiver: &mut mpsc::UnboundedReceiver<FromAgent>,
) -> Option<(String, Value)> {
    let session = &handoff.agent_session_id;
    let restored = if capabilities.resume {
        client.resume_session(session, cwd, servers).await.ok()
    } else if capabilities.load_session {
        let loaded = client.load_session(session, cwd, servers).await.ok();
        if loaded.is_some() {
            while receiver.try_recv().is_ok() {}
        }
        loaded
    } else {
        None
    };
    restored.map(|answer| (session.clone(), answer))
}

/// Starts a new session; its id, once the agent gave a usable one, and the
/// agent's answer.
async fn start_session(
    client: &Arc<AcpClient>,
    cwd: &str,
    servers: &[Value],
    redactor: &Redactor,
) -> Result<(String, Value), String> {
    let value = client
        .new_session(cwd, servers)
        .await
        .map_err(|error| redactor.text(&error.to_string()))?;
    let id = value["sessionId"]
        .as_str()
        .filter(|id| !id.is_empty() && id.len() <= 512)
        .ok_or("The agent returned no valid session ID.")?;
    let id = redactor.opaque_id(id)?;
    Ok((id, value))
}

/// Why a finished turn is not a finished task: its stop reason, unless it
/// ended normally.
fn unfinished_reason(response: &Value) -> Option<String> {
    let stop = response["stopReason"].as_str().unwrap_or_default();
    if stop == "end_turn" {
        return None;
    }
    Some(if stop.is_empty() {
        "no completion event".to_string()
    } else {
        stop.to_string()
    })
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
