use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;

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
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Capabilities {
    pub load_session: bool,
    pub resume: bool,
    pub image: bool,
    pub audio: bool,
    pub embedded_context: bool,
    pub additional_directories: bool,
    pub mcp_http: bool,
}

impl Capabilities {
    pub fn from_initialize(value: &Value) -> Result<Self, String> {
        if value.get("protocolVersion").and_then(Value::as_u64) != Some(1) {
            return Err("This agent does not support ACP version 1.".into());
        }
        let caps = &value["agentCapabilities"];
        Ok(Self {
            load_session: caps["loadSession"].as_bool() == Some(true),
            resume: caps["sessionCapabilities"]["resume"].is_object(),
            image: caps["promptCapabilities"]["image"].as_bool() == Some(true),
            audio: caps["promptCapabilities"]["audio"].as_bool() == Some(true),
            embedded_context: caps["promptCapabilities"]["embeddedContext"].as_bool() == Some(true),
            additional_directories: caps["sessionCapabilities"]["additionalDirectories"]
                .is_object(),
            mcp_http: caps["mcpCapabilities"]["http"].as_bool() == Some(true),
        })
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthMethod {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelOption {
    pub model_id: String,
    pub name: String,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionControls {
    pub models: Vec<ModelOption>,
    pub model_id: Option<String>,
    pub model_config_id: Option<String>,
}

impl SessionControls {
    pub fn merge(&mut self, value: &Value) {
        if let Some(options) = value["configOptions"].as_array() {
            if let Some(model) = options
                .iter()
                .find(|v| v["category"] == "model" && v["type"] == "select")
            {
                self.model_config_id = model["id"].as_str().map(str::to_owned);
                self.model_id = model["currentValue"].as_str().map(str::to_owned);
                self.models.clear();
                if let Some(values) = model["options"].as_array() {
                    for option in values {
                        let values = option["options"]
                            .as_array()
                            .map(Vec::as_slice)
                            .unwrap_or_else(|| std::slice::from_ref(option));
                        for value in values {
                            if let (Some(id), Some(name)) =
                                (value["value"].as_str(), value["name"].as_str())
                            {
                                self.models.push(ModelOption {
                                    model_id: id.into(),
                                    name: name.into(),
                                });
                            }
                        }
                    }
                }
                return;
            }
        }
        if value["models"].is_object() {
            self.model_config_id = None;
            self.model_id = value["models"]["currentModelId"]
                .as_str()
                .map(str::to_owned);
            self.models = value["models"]["availableModels"]
                .as_array()
                .map(|v| {
                    v.iter()
                        .filter_map(|v| serde_json::from_value(v.clone()).ok())
                        .collect()
                })
                .unwrap_or_default();
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SessionStatus {
    Connecting,
    AuthRequired,
    Ready,
    Running,
    Cancelling,
    Cancelled,
    Disconnected,
    Failed,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
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
}

#[derive(Clone, Debug, Serialize, Deserialize)]
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
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ImagePrompt {
    pub mime_type: String,
    pub data: String,
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
