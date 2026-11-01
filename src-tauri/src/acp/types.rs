use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;
use std::sync::Arc;

pub use super::preferences::{AcpPreferences, AgentPreferences, AgentRuntimeInfo};
pub use oleafly_acp::elicitation::ElicitationView;
pub use oleafly_acp::prompt::ImagePrompt;
pub use oleafly_acp::usage::SessionUsage;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AgentDefinition {
    pub id: String,
    pub name: String,
    pub version: String,
    #[serde(default)]
    pub description: String,
    pub distribution: Distribution,
    #[serde(default)]
    pub builtin: bool,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Distribution {
    pub npx: Option<PackageDistribution>,
    pub uvx: Option<PackageDistribution>,
    #[serde(default)]
    pub binary: BTreeMap<String, BinaryDistribution>,
    pub command: Option<CommandDistribution>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PackageDistribution {
    pub package: String,
    pub cmd: Option<String>,
    #[serde(default)]
    pub args: Vec<String>,
    pub node_major: Option<u32>,
    #[serde(default)]
    pub env: BTreeMap<String, String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BinaryDistribution {
    pub archive: String,
    pub cmd: String,
    pub sha256: Option<String>,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub env: BTreeMap<String, String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CommandDistribution {
    pub executable: String,
    #[serde(default)]
    pub args: Vec<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentStatus {
    pub definition: AgentDefinition,
    pub platform: String,
    pub installed: bool,
    pub executable: Option<String>,
    pub installed_version: Option<String>,
    pub managed: bool,
    pub can_install: bool,
    pub reason: Option<String>,
    pub sign_in_hint: Option<String>,
    pub task_unavailable_reason: Option<String>,
    pub cli: Option<CliStatus>,
    pub bridge_shared_with_cli: bool,
    #[serde(default)]
    pub program_override: Option<String>,
    #[serde(default)]
    pub cli_required: bool,
    #[serde(default)]
    pub runtime: Option<AgentRuntimeInfo>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CliStatus {
    pub command: String,
    pub display_name: String,
    pub path: Option<String>,
    pub version: Option<String>,
    pub sign_in_command: String,
    #[serde(default)]
    pub source: Option<String>,
    #[serde(default)]
    pub rejected: Vec<RejectedCandidate>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RejectedCandidate {
    pub path: String,
    pub reason: String,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AgentCheck {
    pub ok: bool,
    pub code: String,
    pub detail: Option<String>,
    pub program: Option<String>,
    pub version: Option<String>,
    pub agent_name: Option<String>,
    #[serde(default)]
    pub auth_methods: Vec<AuthMethod>,
    #[serde(skip)]
    pub runtime: Option<AgentRuntimeInfo>,
}

pub use oleafly_acp::capabilities::{AgentCapabilities as Capabilities, AuthMethod};
pub use oleafly_acp::controls::SessionControls;

#[cfg(test)]
pub fn capabilities_from_initialize(value: &Value) -> Result<Capabilities, String> {
    oleafly_acp::capabilities::parse_initialize(value, oleafly_acp::ProtocolVersion::V1)
        .map(|negotiated| negotiated.capabilities)
        .map_err(String::from)
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SessionStatus {
    #[default]
    Connecting,
    AuthRequired,
    Ready,
    Running,
    Cancelling,
    Cancelled,
    Disconnected,
    Failed,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionRecord {
    pub id: String,
    pub project_id: String,
    pub project_path: String,
    pub agent_id: String,
    pub agent_version: Option<String>,
    pub native_session_id: Option<String>,
    pub parent_session_id: Option<String>,
    pub task_id: Option<String>,
    pub title: String,
    pub status: SessionStatus,
    pub created_at: u64,
    pub updated_at: u64,
    pub turn_id: Option<String>,
    pub capabilities: Capabilities,
    pub controls: SessionControls,
    pub auth_methods: Vec<AuthMethod>,
    pub error: Option<String>,
    pub last_sequence: u64,
    #[serde(default)]
    pub start_revision: Option<String>,
    #[serde(default)]
    pub start_dirty: Option<bool>,
    #[serde(default)]
    pub usage: Option<SessionUsage>,
    #[serde(default)]
    pub available_commands: Vec<AvailableCommand>,
    #[serde(default)]
    pub title_locked: bool,
    #[serde(default)]
    pub commits: Vec<TurnCommit>,
    #[serde(default)]
    pub forked_from: Option<String>,
    #[serde(default)]
    pub permission_profile: Option<String>,
    #[serde(default)]
    pub remote: Option<RemoteTarget>,
    #[serde(default)]
    pub routed_provider: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fork_sequence: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub hermes_profile: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AvailableCommand {
    pub name: String,
    pub description: String,
    pub hint: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TurnCommit {
    pub turn_id: String,
    pub commit: String,
    pub paths: Vec<String>,
    pub message: String,
    pub created_at: u64,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteTarget {
    pub host: String,
    pub folder: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionPage {
    pub sessions: Vec<SessionRecord>,
    pub has_more: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentSessionInfo {
    pub native_session_id: String,
    pub title: Option<String>,
    pub updated_at: Option<String>,
    pub cwd: String,
    pub imported: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentSessionPage {
    pub sessions: Vec<AgentSessionInfo>,
    pub next_cursor: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteOutcome {
    pub agent_deleted: bool,
    pub agent_error: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalSignIn {
    pub title: String,
    pub program: String,
    pub args: Vec<String>,
    pub env: BTreeMap<String, String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum SteerOutcome {
    Injected,
    PromptRequired,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PermissionOption {
    pub option_id: String,
    pub name: String,
    pub kind: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PermissionRequest {
    pub id: String,
    pub session_id: String,
    pub turn_id: String,
    pub title: String,
    pub tool_call_id: Option<String>,
    pub options: Vec<PermissionOption>,
    pub expires_at: u64,
    /// The ACP tool kind (for example "edit"), when reported.
    #[serde(default)]
    pub kind: Option<String>,
    #[serde(default)]
    pub locations: Vec<String>,
    #[serde(default)]
    pub diffs: Vec<PermissionDiff>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PermissionDiff {
    pub path: String,
    pub old_text: Option<String>,
    pub new_text: Option<String>,
    pub truncated: bool,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageCounters {
    pub input_tokens: Option<u64>,
    pub output_tokens: Option<u64>,
    pub cache_read_tokens: Option<u64>,
    pub cache_write_tokens: Option<u64>,
    pub total_tokens: Option<u64>,
    pub context_used: Option<u64>,
    pub context_size: Option<u64>,
    pub source: String,
    #[serde(default)]
    pub thought_tokens: Option<u64>,
    #[serde(default)]
    pub cost_amount: Option<f64>,
    #[serde(default)]
    pub cost_currency: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub session: Option<SessionUsage>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AcpEvent {
    pub session_id: String,
    pub project_id: String,
    pub agent_id: String,
    pub model_id: Option<String>,
    pub task_id: Option<String>,
    pub turn_id: Option<String>,
    pub sequence: u64,
    pub timestamp: u64,
    pub kind: String,
    pub data: Value,
    #[serde(skip)]
    pub owner: Option<Arc<str>>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EventPage {
    pub events: Vec<AcpEvent>,
    pub has_more: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionSnapshot {
    pub session: SessionRecord,
    pub permissions: Vec<PermissionRequest>,
    #[serde(default)]
    pub elicitations: Vec<ElicitationView>,
}

pub trait TaskCommandApproval: Send + Sync {
    fn ask(
        &self,
        summary: String,
        detail: String,
    ) -> futures_util::future::BoxFuture<'static, Result<(), String>>;
}

#[derive(Clone)]
pub enum TaskCommands {
    Allow,
    Ask(Arc<dyn TaskCommandApproval>),
    Off,
}

impl std::fmt::Debug for TaskCommands {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(match self {
            Self::Allow => "Allow",
            Self::Ask(_) => "Ask",
            Self::Off => "Off",
        })
    }
}

#[derive(Clone, Debug, Default)]
pub struct StartSession {
    pub project_id: String,
    pub project_path: std::path::PathBuf,
    pub agent_id: String,
    pub parent_session_id: Option<String>,
    pub task_id: Option<String>,
    pub owner: Option<String>,
    pub allowed_paths: Option<Vec<String>>,
    pub task_commands: Option<TaskCommands>,
}

pub fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

pub fn new_id() -> String {
    use rand::RngCore;
    let mut bytes = [0u8; 16];
    rand::thread_rng().fill_bytes(&mut bytes);
    bytes.iter().map(|v| format!("{v:02x}")).collect()
}
