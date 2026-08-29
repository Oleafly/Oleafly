//! Agent-server protocol vocabulary: request methods, streamed notifications,
//! and server-initiated requests, mirroring the desktop agent-server contract
//! (protocol v2). Method and notification names are load-bearing — the
//! renderer dispatcher keys on them verbatim.

use serde::{Deserialize, Serialize};

pub const APP_SERVER_PROTOCOL_VERSION: u32 = 2;
pub const NATIVE_HOST_PROTOCOL_VERSION: u32 = 2;
pub const SCHEMA_VERSION: u32 = 2;

/// Error code returned when a conversation's request queue is full.
pub const QUEUE_FULL_CODE: i64 = -32001;

/// Request methods the client can call. Grouped by area; the scheduler keys
/// off these strings, so they must match the renderer's dispatcher exactly.
pub mod method {
    pub const INITIALIZE: &str = "initialize";

    pub const THREAD_START: &str = "thread/start";
    pub const THREAD_PREWARM: &str = "thread/prewarm";
    pub const THREAD_RESUME: &str = "thread/resume";
    pub const THREAD_FORK: &str = "thread/fork";
    pub const THREAD_READ: &str = "thread/read";
    pub const THREAD_LIST: &str = "thread/list";
    pub const THREAD_LOADED_LIST: &str = "thread/loaded/list";
    pub const THREAD_TURNS_LIST: &str = "thread/turns/list";
    pub const THREAD_NAME_SET: &str = "thread/name/set";
    pub const THREAD_ARCHIVE: &str = "thread/archive";
    pub const THREAD_UNARCHIVE: &str = "thread/unarchive";
    pub const THREAD_DELETE: &str = "thread/delete";
    pub const THREAD_ROLLBACK: &str = "thread/rollback";
    pub const THREAD_REVERT: &str = "thread/revert";
    pub const THREAD_SETTINGS_UPDATE: &str = "thread/settings/update";
    pub const THREAD_APPROVE_GUARDIAN_DENIED_ACTION: &str = "thread/approveGuardianDeniedAction";

    pub const TURN_START: &str = "turn/start";
    pub const TURN_STEER: &str = "turn/steer";
    pub const TURN_INTERRUPT: &str = "turn/interrupt";

    pub const THREAD_QUEUE_ADD: &str = "thread/queue/add";
    pub const THREAD_QUEUE_LIST: &str = "thread/queue/list";
    pub const THREAD_QUEUE_UPDATE: &str = "thread/queue/update";
    pub const THREAD_QUEUE_DELETE: &str = "thread/queue/delete";
    pub const THREAD_QUEUE_REORDER: &str = "thread/queue/reorder";
    pub const THREAD_QUEUE_START: &str = "thread/queue/start";

    pub const MODEL_LIST: &str = "model/list";
    pub const CONFIG_READ: &str = "config/read";
    pub const CONFIG_VALUE_WRITE: &str = "config/value/write";
}

/// Methods that must never sit behind a busy queue: they steer, stop, or
/// unblock an in-flight turn.
pub const HIGH_PRIORITY_METHODS: [&str; 6] = [
    method::TURN_START,
    method::TURN_STEER,
    method::TURN_INTERRUPT,
    method::THREAD_START,
    method::THREAD_RESUME,
    method::THREAD_APPROVE_GUARDIAN_DENIED_ACTION,
];

/// Read-only methods whose duplicate submissions coalesce onto the first
/// queued request instead of piling up.
pub const COALESCED_METHODS: [&str; 5] = [
    method::CONFIG_READ,
    method::MODEL_LIST,
    method::THREAD_READ,
    method::THREAD_LIST,
    method::THREAD_TURNS_LIST,
];

/// Server-initiated request methods: the agent asks the client (ultimately
/// the user) to resolve something before the turn can continue.
pub mod server_request_method {
    pub const COMMAND_EXECUTION_APPROVAL: &str = "item/commandExecution/requestApproval";
    pub const FILE_CHANGE_APPROVAL: &str = "item/fileChange/requestApproval";
    pub const PERMISSIONS_APPROVAL: &str = "item/permissions/requestApproval";
    pub const TOOL_USER_INPUT: &str = "item/tool/requestUserInput";
    pub const MCP_ELICITATION: &str = "mcpServer/elicitation/request";
}

/// A user decision on a server-initiated request. Legacy wire spellings are
/// accepted as aliases so older shells keep working.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum RequestDecision {
    #[serde(alias = "approved")]
    Accept,
    #[serde(alias = "approved_for_session")]
    AcceptForSession,
    #[serde(alias = "approved_execpolicy_amendment")]
    AcceptWithExecpolicyAmendment,
    #[serde(alias = "denied")]
    Decline,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientInfo {
    pub name: String,
    pub version: String,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientCapabilities {
    #[serde(default)]
    pub opt_out_notification_methods: Vec<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentServerInfo {
    pub app_server_protocol_version: u32,
    pub native_host_protocol_version: u32,
    pub schema_version: u32,
    pub server_version: String,
}

impl AgentServerInfo {
    pub fn current() -> Self {
        Self {
            app_server_protocol_version: APP_SERVER_PROTOCOL_VERSION,
            native_host_protocol_version: NATIVE_HOST_PROTOCOL_VERSION,
            schema_version: SCHEMA_VERSION,
            server_version: env!("CARGO_PKG_VERSION").to_string(),
        }
    }
}

/// Token usage snapshot streamed on `thread/tokenUsage/updated`.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TokenUsage {
    #[serde(default)]
    pub input_tokens: u64,
    #[serde(default)]
    pub cached_input_tokens: u64,
    #[serde(default)]
    pub output_tokens: u64,
}

/// One todo entry carried by `turn/plan/updated`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanTodo {
    pub step: String,
    pub status: String,
}

/// How a turn ended, on `turn/completed`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TurnStatus {
    Completed,
    Failed,
    Interrupted,
}

/// Structured error taxonomy surfaced on the `error` notification.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ErrorInfo {
    ContextWindowExceeded,
    UsageLimitReached,
    ServerOverloaded,
    StreamDisconnected,
    TooManyFailedAttempts,
    ConnectionFailed,
    TurnNotSteerable,
}

/// Notifications streamed from the agent server to the shell. Serialized as
/// `{ "method": "turn/started", "params": { … } }` — the shell's three-tier
/// dispatcher routes on `method`.
///
/// Item payloads stay `serde_json::Value` in this layer: the session model
/// owns the typed item union and stamps final shapes before these leave the
/// process boundary.
#[derive(Clone, Debug, Serialize)]
#[serde(tag = "method", content = "params", rename_all = "camelCase")]
#[allow(dead_code)] // Emitters arrive with the session model; the wire shape is fixed first.
pub enum Notification {
    #[serde(rename = "turn/started")]
    TurnStarted(TurnStartedParams),
    #[serde(rename = "turn/completed")]
    TurnCompleted(TurnCompletedParams),
    #[serde(rename = "turn/diff/updated")]
    TurnDiffUpdated(TurnDiffUpdatedParams),
    #[serde(rename = "turn/plan/updated")]
    TurnPlanUpdated(TurnPlanUpdatedParams),
    #[serde(rename = "turn/moderationMetadata")]
    TurnModerationMetadata(TurnScopedParams),

    #[serde(rename = "item/started")]
    ItemStarted(ItemParams),
    #[serde(rename = "item/completed")]
    ItemCompleted(ItemParams),
    #[serde(rename = "item/agentMessage/delta")]
    ItemAgentMessageDelta(ItemDeltaParams),
    #[serde(rename = "item/plan/delta")]
    ItemPlanDelta(ItemDeltaParams),
    #[serde(rename = "item/reasoning/summaryTextDelta")]
    ItemReasoningSummaryTextDelta(ItemDeltaParams),
    #[serde(rename = "item/reasoning/summaryPartAdded")]
    ItemReasoningSummaryPartAdded(ItemPartParams),
    #[serde(rename = "item/reasoning/textDelta")]
    ItemReasoningTextDelta(ItemIndexedDeltaParams),
    #[serde(rename = "item/commandExecution/outputDelta")]
    ItemCommandExecutionOutputDelta(ItemDeltaParams),
    #[serde(rename = "item/commandExecution/terminalInteraction")]
    ItemCommandExecutionTerminalInteraction(ItemTerminalInteractionParams),
    #[serde(rename = "item/fileChange/outputDelta")]
    ItemFileChangeOutputDelta(ItemDeltaParams),
    #[serde(rename = "item/fileChange/patchUpdated")]
    ItemFileChangePatchUpdated(ItemPayloadParams),
    #[serde(rename = "item/mcpToolCall/progress")]
    ItemMcpToolCallProgress(ItemPayloadParams),
    #[serde(rename = "item/autoApprovalReview/started")]
    ItemAutoApprovalReviewStarted(ItemPayloadParams),
    #[serde(rename = "item/autoApprovalReview/completed")]
    ItemAutoApprovalReviewCompleted(ItemPayloadParams),
    #[serde(rename = "autoApprovalReview/strictReviewRequired")]
    AutoApprovalReviewStrictReviewRequired(TurnScopedParams),
    #[serde(rename = "serverRequest/resolved")]
    ServerRequestResolved(ServerRequestResolvedParams),
    #[serde(rename = "hook/started")]
    HookStarted(HookParams),
    #[serde(rename = "hook/completed")]
    HookCompleted(HookParams),

    #[serde(rename = "thread/started")]
    ThreadStarted(ThreadIdParams),
    #[serde(rename = "thread/name/updated")]
    ThreadNameUpdated(ThreadNameParams),
    #[serde(rename = "thread/settings/updated")]
    ThreadSettingsUpdated(ThreadPayloadParams),
    #[serde(rename = "thread/status/changed")]
    ThreadStatusChanged(ThreadPayloadParams),
    #[serde(rename = "thread/tokenUsage/updated")]
    ThreadTokenUsageUpdated(ThreadTokenUsageParams),
    #[serde(rename = "thread/compacted")]
    ThreadCompacted(ThreadIdParams),
    #[serde(rename = "thread/archived")]
    ThreadArchived(ThreadIdParams),
    #[serde(rename = "thread/unarchived")]
    ThreadUnarchived(ThreadIdParams),
    #[serde(rename = "thread/deleted")]
    ThreadDeleted(ThreadIdParams),
    #[serde(rename = "thread/reverted")]
    ThreadReverted(ThreadIdParams),
    #[serde(rename = "thread/goal/updated")]
    ThreadGoalUpdated(ThreadGoalParams),
    #[serde(rename = "thread/goal/cleared")]
    ThreadGoalCleared(ThreadIdParams),
    #[serde(rename = "thread/queue/changed")]
    ThreadQueueChanged(ThreadIdParams),
    #[serde(rename = "thread/environment/connected")]
    ThreadEnvironmentConnected(ThreadEnvironmentParams),
    #[serde(rename = "thread/environment/disconnected")]
    ThreadEnvironmentDisconnected(ThreadEnvironmentParams),

    #[serde(rename = "error")]
    Error(ErrorParams),
    #[serde(rename = "model/rerouted")]
    ModelRerouted(ModelReroutedParams),
    #[serde(rename = "model/verification")]
    ModelVerification(TurnPayloadParams),
    #[serde(rename = "model/safetyBuffering/updated")]
    ModelSafetyBufferingUpdated(ModelSafetyBufferingParams),
    #[serde(rename = "guardianWarning")]
    GuardianWarning(GuardianWarningParams),
    #[serde(rename = "warning")]
    Warning(WarningParams),
    #[serde(rename = "deprecationNotice")]
    DeprecationNotice(WarningParams),
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TurnStartedParams {
    pub thread_id: String,
    pub turn_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub client_turn_id: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TurnCompletedParams {
    pub thread_id: String,
    pub turn_id: String,
    pub status: TurnStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub stopped_at_cap: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TurnDiffUpdatedParams {
    pub thread_id: String,
    pub turn_id: String,
    pub diff: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TurnPlanUpdatedParams {
    pub thread_id: String,
    pub turn_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub explanation: Option<String>,
    pub todos: Vec<PlanTodo>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TurnScopedParams {
    pub thread_id: String,
    pub turn_id: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemParams {
    pub thread_id: String,
    pub turn_id: String,
    pub item: serde_json::Value,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemDeltaParams {
    pub thread_id: String,
    pub turn_id: String,
    pub item_id: String,
    pub delta: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemPartParams {
    pub thread_id: String,
    pub turn_id: String,
    pub item_id: String,
    pub summary_index: u32,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemIndexedDeltaParams {
    pub thread_id: String,
    pub turn_id: String,
    pub item_id: String,
    pub content_index: u32,
    pub delta: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemTerminalInteractionParams {
    pub thread_id: String,
    pub turn_id: String,
    pub item_id: String,
    pub terminal_input: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemPayloadParams {
    pub thread_id: String,
    pub turn_id: String,
    pub item_id: String,
    pub payload: serde_json::Value,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerRequestResolvedParams {
    pub request_id: String,
    pub outcome: serde_json::Value,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HookParams {
    pub thread_id: String,
    pub turn_id: String,
    pub hook_run_id: String,
    pub name: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ThreadIdParams {
    pub thread_id: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ThreadNameParams {
    pub thread_id: String,
    pub name: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ThreadPayloadParams {
    pub thread_id: String,
    pub payload: serde_json::Value,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ThreadTokenUsageParams {
    pub thread_id: String,
    pub usage: TokenUsage,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ThreadGoalParams {
    pub thread_id: String,
    pub goal: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ThreadEnvironmentParams {
    pub thread_id: String,
    pub environment_id: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ErrorParams {
    pub message: String,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub will_retry: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_info: Option<ErrorInfo>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub additional_details: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelReroutedParams {
    pub thread_id: String,
    pub from_model: String,
    pub to_model: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TurnPayloadParams {
    pub thread_id: String,
    pub turn_id: String,
    pub payload: serde_json::Value,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelSafetyBufferingParams {
    pub thread_id: String,
    pub buffering: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GuardianWarningParams {
    pub thread_id: String,
    pub message: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WarningParams {
    pub message: String,
}

/// A server-initiated request routed to the shell for resolution, serialized
/// onto the notification channel with the same `{method, params}` envelope.
#[derive(Clone, Debug, Serialize)]
#[serde(tag = "method", content = "params", rename_all = "camelCase")]
pub enum ServerRequest {
    #[serde(rename = "item/commandExecution/requestApproval")]
    CommandExecutionApproval(CommandExecutionApprovalParams),
    #[serde(rename = "item/fileChange/requestApproval")]
    FileChangeApproval(FileChangeApprovalParams),
    #[serde(rename = "item/permissions/requestApproval")]
    PermissionsApproval(PermissionsApprovalParams),
    #[serde(rename = "item/tool/requestUserInput")]
    ToolUserInput(ToolUserInputParams),
    #[serde(rename = "mcpServer/elicitation/request")]
    McpElicitation(McpElicitationParams),
}

impl ServerRequest {
    pub fn method(&self) -> &'static str {
        match self {
            Self::CommandExecutionApproval(_) => server_request_method::COMMAND_EXECUTION_APPROVAL,
            Self::FileChangeApproval(_) => server_request_method::FILE_CHANGE_APPROVAL,
            Self::PermissionsApproval(_) => server_request_method::PERMISSIONS_APPROVAL,
            Self::ToolUserInput(_) => server_request_method::TOOL_USER_INPUT,
            Self::McpElicitation(_) => server_request_method::MCP_ELICITATION,
        }
    }

    /// Elicitations auto-decline after sustained foreground inactivity; the
    /// other request kinds wait for the user indefinitely.
    pub fn auto_resolves_to_decline(&self) -> bool {
        matches!(self, Self::McpElicitation(_))
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandExecutionApprovalParams {
    pub request_id: String,
    pub thread_id: String,
    pub turn_id: String,
    pub item_id: String,
    pub command: Vec<String>,
    pub cwd: String,
    pub reason: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileChangeApprovalParams {
    pub request_id: String,
    pub thread_id: String,
    pub turn_id: String,
    pub item_id: String,
    pub changes: serde_json::Value,
    pub reason: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PermissionsApprovalParams {
    pub request_id: String,
    pub thread_id: String,
    pub turn_id: String,
    pub permissions: serde_json::Value,
    pub reason: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolUserInputParams {
    pub request_id: String,
    pub thread_id: String,
    pub turn_id: String,
    pub questions: serde_json::Value,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpElicitationParams {
    pub request_id: String,
    pub thread_id: String,
    pub server_name: String,
    pub elicitation: serde_json::Value,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn notifications_serialize_as_method_params_envelopes() {
        let notification = Notification::ItemAgentMessageDelta(ItemDeltaParams {
            thread_id: "t1".into(),
            turn_id: "turn-1".into(),
            item_id: "i1".into(),
            delta: "hello".into(),
        });
        let value = serde_json::to_value(&notification).unwrap();
        assert_eq!(value["method"], "item/agentMessage/delta");
        assert_eq!(value["params"]["threadId"], "t1");
        assert_eq!(value["params"]["delta"], "hello");
    }

    #[test]
    fn turn_completion_serializes_status_and_optional_error() {
        let ok = Notification::TurnCompleted(TurnCompletedParams {
            thread_id: "t1".into(),
            turn_id: "turn-1".into(),
            status: TurnStatus::Completed,
            error: None,
            stopped_at_cap: false,
        });
        let value = serde_json::to_value(&ok).unwrap();
        assert_eq!(value["method"], "turn/completed");
        assert_eq!(value["params"]["status"], "completed");
        assert!(value["params"].get("error").is_none());

        let failed = Notification::TurnCompleted(TurnCompletedParams {
            thread_id: "t1".into(),
            turn_id: "turn-1".into(),
            status: TurnStatus::Failed,
            error: Some("provider 500".into()),
            stopped_at_cap: true,
        });
        let value = serde_json::to_value(&failed).unwrap();
        assert_eq!(value["params"]["status"], "failed");
        assert_eq!(value["params"]["error"], "provider 500");
        assert_eq!(value["params"]["stoppedAtCap"], true);
    }

    #[test]
    fn decisions_accept_legacy_spellings() {
        for (wire, expected) in [
            ("\"accept\"", RequestDecision::Accept),
            ("\"approved\"", RequestDecision::Accept),
            ("\"acceptForSession\"", RequestDecision::AcceptForSession),
            (
                "\"approved_for_session\"",
                RequestDecision::AcceptForSession,
            ),
            (
                "\"acceptWithExecpolicyAmendment\"",
                RequestDecision::AcceptWithExecpolicyAmendment,
            ),
            (
                "\"approved_execpolicy_amendment\"",
                RequestDecision::AcceptWithExecpolicyAmendment,
            ),
            ("\"decline\"", RequestDecision::Decline),
            ("\"denied\"", RequestDecision::Decline),
        ] {
            assert_eq!(
                serde_json::from_str::<RequestDecision>(wire).unwrap(),
                expected
            );
        }
    }

    #[test]
    fn server_requests_report_their_method_names() {
        let request = ServerRequest::McpElicitation(McpElicitationParams {
            request_id: "r1".into(),
            thread_id: "t1".into(),
            server_name: "docs".into(),
            elicitation: serde_json::Value::Null,
        });
        assert_eq!(request.method(), "mcpServer/elicitation/request");
        assert!(request.auto_resolves_to_decline());
        let value = serde_json::to_value(&request).unwrap();
        assert_eq!(value["method"], "mcpServer/elicitation/request");
        assert_eq!(value["params"]["serverName"], "docs");
    }

    #[test]
    fn server_info_reports_negotiated_versions() {
        let info = AgentServerInfo::current();
        assert_eq!(
            info.app_server_protocol_version,
            APP_SERVER_PROTOCOL_VERSION
        );
        assert_eq!(info.schema_version, SCHEMA_VERSION);
        assert!(!info.server_version.is_empty());
    }

    #[test]
    fn high_priority_and_coalesced_sets_are_disjoint() {
        for method in HIGH_PRIORITY_METHODS {
            assert!(
                !COALESCED_METHODS.contains(&method),
                "{method} cannot be both high-priority and coalesced"
            );
        }
    }
}
