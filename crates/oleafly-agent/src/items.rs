//! The typed thread-item union: the canonical record of everything a turn
//! did, as persisted to rollouts and threaded to the shell. Tags match the
//! store union exactly (mostly camelCase, with `todo-list` kebab-case).

use serde::{Deserialize, Serialize};

use crate::complete::Usage;
use crate::event::AgentEvent;

/// One todo entry carried by todo-list items and `turn/plan/updated`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanTodo {
    pub step: String,
    pub status: String,
}

/// Execution status shared by command-execution and file-change items.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ExecutionStatus {
    InProgress,
    Completed,
    Failed,
    Declined,
}

/// The store union. Field payloads stay lean: each variant carries what the
/// shell renders plus what a rollout must replay; richer payloads (diffs,
/// MCP results) travel as JSON values until their surfaces land.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum ThreadItem {
    #[serde(rename = "hookPrompt")]
    HookPrompt { prompt: String },
    #[serde(rename = "agentMessage")]
    AgentMessage { text: String },
    #[serde(rename = "plan")]
    Plan { text: String },
    #[serde(rename = "reasoning")]
    Reasoning {
        #[serde(default)]
        summary: Vec<String>,
        #[serde(default)]
        content: Vec<String>,
    },
    #[serde(rename = "commandExecution")]
    CommandExecution {
        command: Vec<String>,
        cwd: String,
        #[serde(default, alias = "aggregated_output")]
        aggregated_output: String,
        #[serde(default, alias = "exit_code")]
        exit_code: Option<i32>,
        status: ExecutionStatus,
    },
    #[serde(rename = "fileChange")]
    FileChange {
        #[serde(default)]
        changes: serde_json::Value,
        status: ExecutionStatus,
    },
    #[serde(rename = "mcpToolCall")]
    McpToolCall {
        server: String,
        tool: String,
        #[serde(default)]
        arguments: serde_json::Value,
        #[serde(default)]
        result: Option<serde_json::Value>,
        status: ExecutionStatus,
    },
    #[serde(rename = "dynamicToolCall")]
    DynamicToolCall {
        namespace: String,
        tool: String,
        #[serde(default)]
        arguments: serde_json::Value,
        #[serde(default)]
        output: Option<String>,
        status: ExecutionStatus,
    },
    #[serde(rename = "collabAgentToolCall")]
    CollabAgentToolCall {
        tool: String,
        #[serde(default)]
        arguments: serde_json::Value,
        #[serde(default)]
        result: Option<serde_json::Value>,
    },
    #[serde(rename = "subAgentActivity")]
    SubAgentActivity {
        #[serde(alias = "agent_id")]
        agent_id: String,
        label: String,
        kind: String,
        #[serde(default)]
        detail: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        runtime: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        session_id: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        provider_id: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        model_id: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        runtime_agent_id: Option<String>,
    },
    #[serde(rename = "todo-list")]
    TodoList {
        #[serde(default)]
        explanation: Option<String>,
        todos: Vec<PlanTodo>,
    },
    #[serde(rename = "planImplementation")]
    PlanImplementation {
        #[serde(alias = "plan_content")]
        plan_content: String,
        completed: bool,
    },
    #[serde(rename = "error")]
    Error {
        message: String,
        #[serde(default, alias = "will_retry")]
        will_retry: bool,
        #[serde(default, alias = "error_info")]
        error_info: Option<String>,
    },
    #[serde(rename = "automaticApprovalReview")]
    AutomaticApprovalReview {
        #[serde(alias = "target_item_id")]
        target_item_id: String,
        action: String,
        #[serde(alias = "risk_level")]
        risk_level: String,
        #[serde(default)]
        rationale: Option<String>,
    },
    #[serde(rename = "strictReviewNotice")]
    StrictReviewNotice,
    #[serde(rename = "remoteTaskCreated")]
    RemoteTaskCreated {
        #[serde(alias = "task_id")]
        task_id: String,
    },
    #[serde(rename = "personalityChanged")]
    PersonalityChanged { personality: String },
    #[serde(rename = "forkedFromConversation")]
    ForkedFromConversation {
        #[serde(alias = "source_conversation_id")]
        source_conversation_id: String,
        #[serde(default, alias = "source_conversation_title")]
        source_conversation_title: Option<String>,
    },
    #[serde(rename = "modelChanged")]
    ModelChanged {
        #[serde(alias = "from_model")]
        from_model: String,
        #[serde(alias = "to_model")]
        to_model: String,
    },
    #[serde(rename = "modelRerouted")]
    ModelRerouted {
        #[serde(alias = "from_model")]
        from_model: String,
        #[serde(alias = "to_model")]
        to_model: String,
    },
    #[serde(rename = "autoReviewInterruptionWarning")]
    AutoReviewInterruptionWarning,
    #[serde(rename = "userInputResponse")]
    UserInputResponse {
        #[serde(alias = "request_id")]
        request_id: String,
        answers: serde_json::Value,
    },
    #[serde(rename = "mcpServerElicitation")]
    McpServerElicitation {
        #[serde(alias = "request_id")]
        request_id: String,
        #[serde(alias = "server_name")]
        server_name: String,
        elicitation: serde_json::Value,
        completed: bool,
    },
    #[serde(rename = "permissionRequest")]
    PermissionRequest {
        #[serde(alias = "request_id")]
        request_id: String,
        permissions: serde_json::Value,
        #[serde(default)]
        response: Option<String>,
    },
    #[serde(rename = "webSearch")]
    WebSearch { query: String, completed: bool },
    #[serde(rename = "contextCompaction")]
    ContextCompaction {
        #[serde(alias = "dropped_messages")]
        dropped_messages: u32,
        reason: String,
    },
    #[serde(rename = "worktreeInit")]
    WorktreeInit { outcome: String },
    #[serde(rename = "userMessage")]
    UserMessage { text: String },
    #[serde(rename = "steeringUserMessage")]
    SteeringUserMessage { text: String, status: String },
    #[serde(rename = "steered")]
    Steered,
    #[serde(rename = "imageGeneration")]
    ImageGeneration {
        status: String,
        #[serde(default)]
        path: Option<String>,
    },
    #[serde(rename = "imageView")]
    ImageView {
        #[serde(alias = "image_paths")]
        image_paths: Vec<String>,
    },
    #[serde(rename = "enteredReviewMode")]
    EnteredReviewMode,
    #[serde(rename = "exitedReviewMode")]
    ExitedReviewMode,
    #[serde(rename = "sleep")]
    Sleep {
        #[serde(alias = "duration_ms")]
        duration_ms: u64,
    },
}

/// An item with its identity and lifecycle stamp.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordedItem {
    pub id: String,
    pub item: ThreadItem,
    #[serde(default)]
    pub completed: bool,
}

/// How a turn ended.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TurnRecordStatus {
    InProgress,
    Completed,
    Failed,
    Interrupted,
}

/// One turn as persisted: the items it produced plus bookkeeping.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TurnRecord {
    pub turn_id: String,
    #[serde(default)]
    pub client_turn_id: Option<String>,
    pub status: TurnRecordStatus,
    pub items: Vec<RecordedItem>,
    #[serde(default)]
    pub usage: Usage,
    #[serde(default)]
    pub error: Option<String>,
    #[serde(default)]
    pub stopped_at_cap: bool,
}

/// Classify a tool name into its item type. Shell tools map to command
/// executions; the file-mutation set maps to file changes; known MCP servers
/// map to MCP calls; everything else (native read/set tools, dynamic tools)
/// is a dynamic tool call.
pub fn classify_tool(name: &str) -> ThreadItem {
    if name == "run_command" || name == "exec_command" || name == "shell_command" {
        return ThreadItem::CommandExecution {
            command: Vec::new(),
            cwd: String::new(),
            aggregated_output: String::new(),
            exit_code: None,
            status: ExecutionStatus::InProgress,
        };
    }
    const FILE_TOOLS: [&str; 5] = [
        "write_file",
        "replace_in_file",
        "create_file",
        "rename_file",
        "delete_file",
    ];
    if FILE_TOOLS.contains(&name) {
        return ThreadItem::FileChange {
            changes: serde_json::Value::Null,
            status: ExecutionStatus::InProgress,
        };
    }
    ThreadItem::DynamicToolCall {
        namespace: "oleafly".to_string(),
        tool: name.to_string(),
        arguments: serde_json::Value::Null,
        output: None,
        status: ExecutionStatus::InProgress,
    }
}

/// Finalize a tool item's arguments from the call's JSON argument string.
fn apply_arguments(item: &mut ThreadItem, arguments: &str) {
    let parsed = serde_json::from_str::<serde_json::Value>(arguments)
        .unwrap_or(serde_json::Value::String(arguments.to_string()));
    match item {
        ThreadItem::CommandExecution { command, cwd, .. } => {
            if let Some(text) = parsed.get("command").and_then(|value| value.as_str()) {
                command.clear();
                command.push(text.to_string());
            }
            if let Some(text) = parsed.get("cwd").and_then(|value| value.as_str()) {
                *cwd = text.to_string();
            }
        }
        ThreadItem::FileChange { changes, .. } => {
            *changes = parsed;
        }
        ThreadItem::DynamicToolCall { arguments, .. }
        | ThreadItem::McpToolCall { arguments, .. } => {
            *arguments = parsed;
        }
        _ => {}
    }
}

fn tool_outcome(output: &str) -> (ExecutionStatus, Option<i32>) {
    let Ok(serde_json::Value::Object(object)) = serde_json::from_str(output) else {
        return (ExecutionStatus::Completed, None);
    };
    let exit_code = object
        .get("exit_code")
        .and_then(serde_json::Value::as_i64)
        .and_then(|value| i32::try_from(value).ok());
    if object
        .get("declined")
        .and_then(serde_json::Value::as_bool)
        .unwrap_or(false)
        || object
            .get("status")
            .and_then(serde_json::Value::as_str)
            .is_some_and(|status| status == "declined")
    {
        return (ExecutionStatus::Declined, exit_code);
    }
    if object.contains_key("error") {
        return (ExecutionStatus::Failed, exit_code);
    }
    let timed_out = object
        .get("timed_out")
        .and_then(serde_json::Value::as_bool)
        .unwrap_or(false)
        || object
            .get("status")
            .and_then(serde_json::Value::as_str)
            .is_some_and(|status| status.to_ascii_lowercase().contains("timed out"));
    let failed = timed_out
        || exit_code.is_some_and(|code| code != 0)
        || (object
            .get("exec")
            .and_then(serde_json::Value::as_bool)
            .unwrap_or(false)
            && exit_code.is_none());
    (
        if failed {
            ExecutionStatus::Failed
        } else {
            ExecutionStatus::Completed
        },
        exit_code,
    )
}

/// Folds the event stream of one run into a persisted turn record — the
/// Rust counterpart of the shell's `applyAgentEvent`.
#[derive(Debug)]
pub struct TurnRecorder {
    record: TurnRecord,
    next_item: u32,
    /// Open tool-call items by provider call id.
    open_calls: std::collections::HashMap<String, usize>,
}

impl TurnRecorder {
    pub fn new(turn_id: impl Into<String>) -> Self {
        Self {
            record: TurnRecord {
                turn_id: turn_id.into(),
                client_turn_id: None,
                status: TurnRecordStatus::InProgress,
                items: Vec::new(),
                usage: Usage::default(),
                error: None,
                stopped_at_cap: false,
            },
            next_item: 0,
            open_calls: std::collections::HashMap::new(),
        }
    }

    pub fn bind_client_turn_id(&mut self, client_turn_id: impl Into<String>) {
        self.record.client_turn_id = Some(client_turn_id.into());
    }

    pub fn seed_user_message(&mut self, text: impl Into<String>) {
        self.push(ThreadItem::UserMessage { text: text.into() }, true);
    }

    fn push(&mut self, item: ThreadItem, completed: bool) -> usize {
        self.record.items.push(RecordedItem {
            id: format!("{}:{}", self.record.turn_id, self.next_item),
            item,
            completed,
        });
        self.next_item += 1;
        self.record.items.len() - 1
    }

    /// Fold one streamed event into the record.
    pub fn record(&mut self, event: &AgentEvent) {
        match event {
            AgentEvent::TextDelta { text } => {
                match self
                    .record
                    .items
                    .last_mut()
                    .map(|recorded| (&mut recorded.item, recorded.completed))
                {
                    Some((ThreadItem::AgentMessage { text: existing }, false)) => {
                        existing.push_str(text);
                    }
                    _ => {
                        self.push(ThreadItem::AgentMessage { text: text.clone() }, false);
                    }
                }
            }
            AgentEvent::ReasoningDelta { text } => {
                match self
                    .record
                    .items
                    .last_mut()
                    .map(|recorded| (&mut recorded.item, recorded.completed))
                {
                    Some((ThreadItem::Reasoning { content, .. }, false)) if !content.is_empty() => {
                        let last = content.last_mut().expect("checked non-empty");
                        last.push_str(text);
                    }
                    Some((ThreadItem::Reasoning { content, .. }, false)) => {
                        content.push(text.clone());
                    }
                    _ => {
                        self.push(
                            ThreadItem::Reasoning {
                                summary: Vec::new(),
                                content: vec![text.clone()],
                            },
                            false,
                        );
                    }
                }
            }
            AgentEvent::ToolCallStart { id, name } => {
                let item = classify_tool(name);
                let index = self.push(item, false);
                self.open_calls.insert(id.clone(), index);
            }
            AgentEvent::ToolCallArgsDelta { id, json } => {
                if let Some(&index) = self.open_calls.get(id) {
                    if let ThreadItem::CommandExecution { command, .. } =
                        &mut self.record.items[index].item
                    {
                        // Shell arguments stream as JSON fragments; keep the
                        // raw accumulation until End finalizes it.
                        command.push(json.clone());
                    }
                }
            }
            AgentEvent::ToolCallEnd { id, arguments } => {
                if let Some(&index) = self.open_calls.get(id) {
                    apply_arguments(&mut self.record.items[index].item, arguments);
                }
            }
            AgentEvent::ToolRequest {
                id,
                name,
                arguments,
            } => {
                // A request for a call we never saw Start for (native path).
                if !self.open_calls.contains_key(id) {
                    let item = classify_tool(name);
                    let index = self.push(item, false);
                    self.open_calls.insert(id.clone(), index);
                    apply_arguments(&mut self.record.items[index].item, arguments);
                }
            }
            AgentEvent::ToolOutcome { id, output } => {
                if let Some(index) = self.open_calls.remove(id) {
                    let recorded = &mut self.record.items[index];
                    recorded.completed = true;
                    let (outcome, command_exit_code) = tool_outcome(output);
                    match &mut recorded.item {
                        ThreadItem::CommandExecution {
                            aggregated_output,
                            status,
                            exit_code,
                            ..
                        } => {
                            aggregated_output.push_str(output);
                            *exit_code = command_exit_code;
                            *status = outcome;
                        }
                        ThreadItem::FileChange { status, .. } => {
                            *status = outcome;
                        }
                        ThreadItem::DynamicToolCall {
                            output: out,
                            status,
                            ..
                        } => {
                            *out = Some(output.clone());
                            *status = outcome;
                        }
                        ThreadItem::McpToolCall { status, .. } => {
                            *status = outcome;
                        }
                        _ => {}
                    }
                }
            }
            AgentEvent::SubagentUpdate {
                id,
                label,
                state,
                detail,
                runtime,
                session_id,
                provider_id,
                model_id,
                agent_id,
            } => {
                self.push(
                    ThreadItem::SubAgentActivity {
                        agent_id: id.clone(),
                        label: label.clone(),
                        kind: state.clone(),
                        detail: detail.clone(),
                        runtime: runtime.clone(),
                        session_id: session_id.clone(),
                        provider_id: provider_id.clone(),
                        model_id: model_id.clone(),
                        runtime_agent_id: agent_id.clone(),
                    },
                    state == "done" || state == "error" || state == "interrupted",
                );
            }
            AgentEvent::Compacted {
                dropped_messages,
                reason,
            } => {
                self.push(
                    ThreadItem::ContextCompaction {
                        dropped_messages: *dropped_messages,
                        reason: reason.clone(),
                    },
                    true,
                );
            }
            AgentEvent::Usage { usage } => {
                self.record.usage = *usage;
            }
            AgentEvent::Retry { attempt, max } => {
                self.push(
                    ThreadItem::Error {
                        message: format!("Reconnecting {attempt}/{max}"),
                        will_retry: true,
                        error_info: None,
                    },
                    false,
                );
            }
            AgentEvent::Error { message, retryable } => {
                self.record.status = TurnRecordStatus::Failed;
                self.record.error = Some(message.clone());
                self.push(
                    ThreadItem::Error {
                        message: message.clone(),
                        will_retry: *retryable,
                        error_info: None,
                    },
                    true,
                );
            }
            AgentEvent::Done { .. } => {
                for recorded in &mut self.record.items {
                    recorded.completed = true;
                }
            }
            AgentEvent::Steered { text } => {
                self.push(ThreadItem::Steered, true);
                self.push(ThreadItem::UserMessage { text: text.clone() }, true);
            }
            AgentEvent::StepStart { .. } => {}
        }
    }

    pub fn finish(&mut self, stopped_at_cap: bool) {
        if self.record.status == TurnRecordStatus::InProgress {
            self.record.status = TurnRecordStatus::Completed;
        }
        self.record.stopped_at_cap = stopped_at_cap;
        for recorded in &mut self.record.items {
            recorded.completed = true;
        }
    }

    pub fn mark_interrupted(&mut self) {
        self.record.status = TurnRecordStatus::Interrupted;
        for recorded in &mut self.record.items {
            if !recorded.completed {
                recorded.completed = true;
            }
        }
    }

    pub fn snapshot(&self) -> &TurnRecord {
        &self.record
    }

    pub fn into_record(self) -> TurnRecord {
        self.record
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn round_trips(record: &TurnRecord) -> TurnRecord {
        serde_json::from_str(&serde_json::to_string(record).unwrap()).unwrap()
    }

    #[test]
    fn the_store_union_serializes_with_its_exact_tags() {
        let cases = vec![
            (
                ThreadItem::HookPrompt { prompt: "p".into() },
                serde_json::json!({ "type": "hookPrompt", "prompt": "p" }),
            ),
            (
                ThreadItem::AgentMessage { text: "a".into() },
                serde_json::json!({ "type": "agentMessage", "text": "a" }),
            ),
            (
                ThreadItem::Plan { text: "p".into() },
                serde_json::json!({ "type": "plan", "text": "p" }),
            ),
            (
                ThreadItem::Reasoning {
                    summary: vec!["s".into()],
                    content: vec!["c".into()],
                },
                serde_json::json!({
                    "type": "reasoning",
                    "summary": ["s"],
                    "content": ["c"]
                }),
            ),
            (
                ThreadItem::CommandExecution {
                    command: vec!["cargo test".into()],
                    cwd: "/tmp".into(),
                    aggregated_output: String::new(),
                    exit_code: None,
                    status: ExecutionStatus::InProgress,
                },
                serde_json::json!({
                    "type": "commandExecution",
                    "command": ["cargo test"],
                    "cwd": "/tmp",
                    "aggregatedOutput": "",
                    "exitCode": null,
                    "status": "inProgress"
                }),
            ),
            (
                ThreadItem::FileChange {
                    changes: serde_json::Value::Null,
                    status: ExecutionStatus::Declined,
                },
                serde_json::json!({
                    "type": "fileChange",
                    "changes": null,
                    "status": "declined"
                }),
            ),
            (
                ThreadItem::McpToolCall {
                    server: "s".into(),
                    tool: "t".into(),
                    arguments: serde_json::Value::Null,
                    result: None,
                    status: ExecutionStatus::InProgress,
                },
                serde_json::json!({
                    "type": "mcpToolCall",
                    "server": "s",
                    "tool": "t",
                    "arguments": null,
                    "result": null,
                    "status": "inProgress"
                }),
            ),
            (
                ThreadItem::DynamicToolCall {
                    namespace: "n".into(),
                    tool: "t".into(),
                    arguments: serde_json::Value::Null,
                    output: None,
                    status: ExecutionStatus::InProgress,
                },
                serde_json::json!({
                    "type": "dynamicToolCall",
                    "namespace": "n",
                    "tool": "t",
                    "arguments": null,
                    "output": null,
                    "status": "inProgress"
                }),
            ),
            (
                ThreadItem::CollabAgentToolCall {
                    tool: "t".into(),
                    arguments: serde_json::Value::Null,
                    result: None,
                },
                serde_json::json!({
                    "type": "collabAgentToolCall",
                    "tool": "t",
                    "arguments": null,
                    "result": null
                }),
            ),
            (
                ThreadItem::SubAgentActivity {
                    agent_id: "sub-1".into(),
                    label: "research".into(),
                    kind: "started".into(),
                    detail: None,
                    runtime: None,
                    session_id: None,
                    provider_id: None,
                    model_id: None,
                    runtime_agent_id: None,
                },
                serde_json::json!({
                    "type": "subAgentActivity",
                    "agentId": "sub-1",
                    "label": "research",
                    "kind": "started",
                    "detail": null
                }),
            ),
            (
                ThreadItem::TodoList {
                    explanation: None,
                    todos: vec![PlanTodo {
                        step: "run tests".into(),
                        status: "in_progress".into(),
                    }],
                },
                serde_json::json!({
                    "type": "todo-list",
                    "explanation": null,
                    "todos": [{ "step": "run tests", "status": "in_progress" }]
                }),
            ),
            (
                ThreadItem::PlanImplementation {
                    plan_content: "p".into(),
                    completed: false,
                },
                serde_json::json!({
                    "type": "planImplementation",
                    "planContent": "p",
                    "completed": false
                }),
            ),
            (
                ThreadItem::Error {
                    message: "m".into(),
                    will_retry: false,
                    error_info: None,
                },
                serde_json::json!({
                    "type": "error",
                    "message": "m",
                    "willRetry": false,
                    "errorInfo": null
                }),
            ),
            (
                ThreadItem::AutomaticApprovalReview {
                    target_item_id: "i".into(),
                    action: "a".into(),
                    risk_level: "r".into(),
                    rationale: None,
                },
                serde_json::json!({
                    "type": "automaticApprovalReview",
                    "targetItemId": "i",
                    "action": "a",
                    "riskLevel": "r",
                    "rationale": null
                }),
            ),
            (
                ThreadItem::StrictReviewNotice,
                serde_json::json!({ "type": "strictReviewNotice" }),
            ),
            (
                ThreadItem::RemoteTaskCreated {
                    task_id: "t".into(),
                },
                serde_json::json!({ "type": "remoteTaskCreated", "taskId": "t" }),
            ),
            (
                ThreadItem::PersonalityChanged {
                    personality: "p".into(),
                },
                serde_json::json!({ "type": "personalityChanged", "personality": "p" }),
            ),
            (
                ThreadItem::ForkedFromConversation {
                    source_conversation_id: "c".into(),
                    source_conversation_title: None,
                },
                serde_json::json!({
                    "type": "forkedFromConversation",
                    "sourceConversationId": "c",
                    "sourceConversationTitle": null
                }),
            ),
            (
                ThreadItem::ModelChanged {
                    from_model: "a".into(),
                    to_model: "b".into(),
                },
                serde_json::json!({
                    "type": "modelChanged",
                    "fromModel": "a",
                    "toModel": "b"
                }),
            ),
            (
                ThreadItem::ModelRerouted {
                    from_model: "a".into(),
                    to_model: "b".into(),
                },
                serde_json::json!({
                    "type": "modelRerouted",
                    "fromModel": "a",
                    "toModel": "b"
                }),
            ),
            (
                ThreadItem::AutoReviewInterruptionWarning,
                serde_json::json!({ "type": "autoReviewInterruptionWarning" }),
            ),
            (
                ThreadItem::UserInputResponse {
                    request_id: "r".into(),
                    answers: serde_json::Value::Null,
                },
                serde_json::json!({
                    "type": "userInputResponse",
                    "requestId": "r",
                    "answers": null
                }),
            ),
            (
                ThreadItem::McpServerElicitation {
                    request_id: "r".into(),
                    server_name: "s".into(),
                    elicitation: serde_json::Value::Null,
                    completed: false,
                },
                serde_json::json!({
                    "type": "mcpServerElicitation",
                    "requestId": "r",
                    "serverName": "s",
                    "elicitation": null,
                    "completed": false
                }),
            ),
            (
                ThreadItem::PermissionRequest {
                    request_id: "r".into(),
                    permissions: serde_json::Value::Null,
                    response: None,
                },
                serde_json::json!({
                    "type": "permissionRequest",
                    "requestId": "r",
                    "permissions": null,
                    "response": null
                }),
            ),
            (
                ThreadItem::WebSearch {
                    query: "q".into(),
                    completed: false,
                },
                serde_json::json!({
                    "type": "webSearch",
                    "query": "q",
                    "completed": false
                }),
            ),
            (
                ThreadItem::ContextCompaction {
                    dropped_messages: 2,
                    reason: "r".into(),
                },
                serde_json::json!({
                    "type": "contextCompaction",
                    "droppedMessages": 2,
                    "reason": "r"
                }),
            ),
            (
                ThreadItem::WorktreeInit {
                    outcome: "o".into(),
                },
                serde_json::json!({ "type": "worktreeInit", "outcome": "o" }),
            ),
            (
                ThreadItem::UserMessage { text: "u".into() },
                serde_json::json!({ "type": "userMessage", "text": "u" }),
            ),
            (
                ThreadItem::SteeringUserMessage {
                    text: "u".into(),
                    status: "pending".into(),
                },
                serde_json::json!({
                    "type": "steeringUserMessage",
                    "text": "u",
                    "status": "pending"
                }),
            ),
            (
                ThreadItem::Steered,
                serde_json::json!({ "type": "steered" }),
            ),
            (
                ThreadItem::ImageGeneration {
                    status: "pending".into(),
                    path: None,
                },
                serde_json::json!({
                    "type": "imageGeneration",
                    "status": "pending",
                    "path": null
                }),
            ),
            (
                ThreadItem::ImageView {
                    image_paths: vec!["a.png".into()],
                },
                serde_json::json!({ "type": "imageView", "imagePaths": ["a.png"] }),
            ),
            (
                ThreadItem::EnteredReviewMode,
                serde_json::json!({ "type": "enteredReviewMode" }),
            ),
            (
                ThreadItem::ExitedReviewMode,
                serde_json::json!({ "type": "exitedReviewMode" }),
            ),
            (
                ThreadItem::Sleep { duration_ms: 5 },
                serde_json::json!({ "type": "sleep", "durationMs": 5 }),
            ),
        ];

        for (item, expected) in cases {
            assert_eq!(serde_json::to_value(item).unwrap(), expected);
        }
    }

    #[test]
    fn record_envelopes_serialize_required_null_and_false_fields() {
        let record = TurnRecord {
            turn_id: "turn-1".into(),
            client_turn_id: None,
            status: TurnRecordStatus::InProgress,
            items: vec![RecordedItem {
                id: "turn-1:0".into(),
                item: ThreadItem::UserMessage { text: "u".into() },
                completed: false,
            }],
            usage: Usage::default(),
            error: None,
            stopped_at_cap: false,
        };

        assert_eq!(
            serde_json::to_value(record).unwrap(),
            serde_json::json!({
                "turnId": "turn-1",
                "clientTurnId": null,
                "status": "inProgress",
                "items": [{
                    "id": "turn-1:0",
                    "item": { "type": "userMessage", "text": "u" },
                    "completed": false
                }],
                "usage": { "input": 0, "output": 0 },
                "error": null,
                "stoppedAtCap": false
            })
        );
    }

    #[test]
    fn legacy_snake_case_thread_items_remain_readable() {
        let cases = vec![
            (
                serde_json::json!({
                    "type": "commandExecution",
                    "command": ["cargo test"],
                    "cwd": "/tmp",
                    "aggregated_output": "failed",
                    "exit_code": 127,
                    "status": "failed"
                }),
                ThreadItem::CommandExecution {
                    command: vec!["cargo test".into()],
                    cwd: "/tmp".into(),
                    aggregated_output: "failed".into(),
                    exit_code: Some(127),
                    status: ExecutionStatus::Failed,
                },
            ),
            (
                serde_json::json!({
                    "type": "subAgentActivity",
                    "agent_id": "sub-1",
                    "label": "research",
                    "kind": "started",
                    "detail": null
                }),
                ThreadItem::SubAgentActivity {
                    agent_id: "sub-1".into(),
                    label: "research".into(),
                    kind: "started".into(),
                    detail: None,
                    runtime: None,
                    session_id: None,
                    provider_id: None,
                    model_id: None,
                    runtime_agent_id: None,
                },
            ),
            (
                serde_json::json!({
                    "type": "planImplementation",
                    "plan_content": "p",
                    "completed": false
                }),
                ThreadItem::PlanImplementation {
                    plan_content: "p".into(),
                    completed: false,
                },
            ),
            (
                serde_json::json!({
                    "type": "error",
                    "message": "m",
                    "will_retry": false,
                    "error_info": null
                }),
                ThreadItem::Error {
                    message: "m".into(),
                    will_retry: false,
                    error_info: None,
                },
            ),
            (
                serde_json::json!({
                    "type": "automaticApprovalReview",
                    "target_item_id": "i",
                    "action": "a",
                    "risk_level": "r",
                    "rationale": null
                }),
                ThreadItem::AutomaticApprovalReview {
                    target_item_id: "i".into(),
                    action: "a".into(),
                    risk_level: "r".into(),
                    rationale: None,
                },
            ),
            (
                serde_json::json!({ "type": "remoteTaskCreated", "task_id": "t" }),
                ThreadItem::RemoteTaskCreated {
                    task_id: "t".into(),
                },
            ),
            (
                serde_json::json!({
                    "type": "forkedFromConversation",
                    "source_conversation_id": "c",
                    "source_conversation_title": null
                }),
                ThreadItem::ForkedFromConversation {
                    source_conversation_id: "c".into(),
                    source_conversation_title: None,
                },
            ),
            (
                serde_json::json!({
                    "type": "modelChanged",
                    "from_model": "a",
                    "to_model": "b"
                }),
                ThreadItem::ModelChanged {
                    from_model: "a".into(),
                    to_model: "b".into(),
                },
            ),
            (
                serde_json::json!({
                    "type": "modelRerouted",
                    "from_model": "a",
                    "to_model": "b"
                }),
                ThreadItem::ModelRerouted {
                    from_model: "a".into(),
                    to_model: "b".into(),
                },
            ),
            (
                serde_json::json!({
                    "type": "userInputResponse",
                    "request_id": "r",
                    "answers": null
                }),
                ThreadItem::UserInputResponse {
                    request_id: "r".into(),
                    answers: serde_json::Value::Null,
                },
            ),
            (
                serde_json::json!({
                    "type": "mcpServerElicitation",
                    "request_id": "r",
                    "server_name": "s",
                    "elicitation": null,
                    "completed": false
                }),
                ThreadItem::McpServerElicitation {
                    request_id: "r".into(),
                    server_name: "s".into(),
                    elicitation: serde_json::Value::Null,
                    completed: false,
                },
            ),
            (
                serde_json::json!({
                    "type": "permissionRequest",
                    "request_id": "r",
                    "permissions": null,
                    "response": null
                }),
                ThreadItem::PermissionRequest {
                    request_id: "r".into(),
                    permissions: serde_json::Value::Null,
                    response: None,
                },
            ),
            (
                serde_json::json!({
                    "type": "contextCompaction",
                    "dropped_messages": 2,
                    "reason": "r"
                }),
                ThreadItem::ContextCompaction {
                    dropped_messages: 2,
                    reason: "r".into(),
                },
            ),
            (
                serde_json::json!({ "type": "imageView", "image_paths": ["a.png"] }),
                ThreadItem::ImageView {
                    image_paths: vec!["a.png".into()],
                },
            ),
            (
                serde_json::json!({ "type": "sleep", "duration_ms": 5 }),
                ThreadItem::Sleep { duration_ms: 5 },
            ),
        ];

        for (value, expected) in cases {
            assert_eq!(
                serde_json::from_value::<ThreadItem>(value).unwrap(),
                expected
            );
        }
    }

    #[test]
    fn initiating_user_message_is_seeded_before_agent_events() {
        let mut recorder = TurnRecorder::new("turn-1");
        recorder.seed_user_message("fix my bibfile");
        recorder.record(&AgentEvent::TextDelta {
            text: "Working".into(),
        });

        assert!(matches!(
            &recorder.snapshot().items[0],
            RecordedItem {
                item: ThreadItem::UserMessage { text },
                completed: true,
                ..
            } if text == "fix my bibfile"
        ));
    }

    #[test]
    fn a_turn_record_round_trips_through_json() {
        let mut recorder = TurnRecorder::new("turn-9");
        recorder.bind_client_turn_id("client-7");
        recorder.record(&AgentEvent::TextDelta {
            text: "Working".into(),
        });
        recorder.record(&AgentEvent::TextDelta {
            text: " on it".into(),
        });
        recorder.record(&AgentEvent::Usage {
            usage: Usage {
                input: 10,
                output: 5,
                ..Usage::default()
            },
        });
        recorder.finish(false);

        let record = recorder.into_record();
        let restored = round_trips(&record);
        assert_eq!(restored, record);
        assert_eq!(restored.client_turn_id.as_deref(), Some("client-7"));
    }

    #[test]
    fn the_fold_accumulates_deltas_and_completes_tool_items() {
        let mut recorder = TurnRecorder::new("turn-1");
        recorder.record(&AgentEvent::ReasoningDelta {
            text: "thinking".into(),
        });
        recorder.record(&AgentEvent::TextDelta {
            text: "Reading".into(),
        });
        recorder.record(&AgentEvent::ToolCallStart {
            id: "call-1".into(),
            name: "read_file".into(),
        });
        recorder.record(&AgentEvent::ToolCallEnd {
            id: "call-1".into(),
            arguments: r#"{"path":"main.tex"}"#.into(),
        });
        recorder.record(&AgentEvent::ToolOutcome {
            id: "call-1".into(),
            output: "contents".into(),
        });
        recorder.record(&AgentEvent::Done { stop_reason: None });
        recorder.finish(false);

        let record = recorder.into_record();
        let items: Vec<&ThreadItem> = record.items.iter().map(|r| &r.item).collect();
        assert!(matches!(items[0], ThreadItem::Reasoning { .. }));
        assert!(matches!(&items[1], ThreadItem::AgentMessage { text } if text == "Reading"));
        match &items[2] {
            ThreadItem::DynamicToolCall {
                tool,
                output,
                status,
                ..
            } => {
                assert_eq!(tool, "read_file");
                assert_eq!(output.as_deref(), Some("contents"));
                assert_eq!(*status, ExecutionStatus::Completed);
            }
            other => panic!("expected a dynamic tool call, got {other:?}"),
        }
        assert!(
            record.items[1].completed,
            "Done completes the assistant message"
        );
    }

    #[test]
    fn tool_outcomes_use_top_level_json_error_and_exit_code_fields() {
        let cases = [
            (r#"{"error":"aborted"}"#, ExecutionStatus::Failed, None),
            (
                r#"{"message":"declined","declined":true,"status":"declined"}"#,
                ExecutionStatus::Declined,
                None,
            ),
            (
                r#"{"exec":true,"exit_code":127,"stdout":"failed"}"#,
                ExecutionStatus::Failed,
                Some(127),
            ),
            (
                r#"{"exec":true,"exit_code":0,"stdout":"done"}"#,
                ExecutionStatus::Completed,
                Some(0),
            ),
            (
                r#"{"exec":true,"exit_code":null,"timed_out":true,"status":"Stopped: timed out"}"#,
                ExecutionStatus::Failed,
                None,
            ),
            (
                "plain text containing the word error",
                ExecutionStatus::Completed,
                None,
            ),
            (
                r#"plain text mentioning "error": inside prose"#,
                ExecutionStatus::Completed,
                None,
            ),
        ];

        for (index, (output, expected_status, expected_exit_code)) in cases.into_iter().enumerate()
        {
            let mut recorder = TurnRecorder::new(format!("turn-{index}"));
            recorder.record(&AgentEvent::ToolRequest {
                id: "call-1".into(),
                name: "run_command".into(),
                arguments: r#"{"command":"cargo build","cwd":"/tmp"}"#.into(),
            });
            recorder.record(&AgentEvent::ToolOutcome {
                id: "call-1".into(),
                output: output.into(),
            });
            recorder.finish(false);

            match &recorder.into_record().items[0].item {
                ThreadItem::CommandExecution {
                    command,
                    status,
                    exit_code,
                    ..
                } => {
                    assert_eq!(command, &["cargo build".to_string()]);
                    assert_eq!(*status, expected_status, "output: {output}");
                    assert_eq!(*exit_code, expected_exit_code, "output: {output}");
                }
                other => panic!("expected a command execution, got {other:?}"),
            }
        }
    }

    #[test]
    fn finishing_a_turn_seals_every_open_item() {
        let mut recorder = TurnRecorder::new("turn-2");
        recorder.record(&AgentEvent::ReasoningDelta {
            text: "thinking".into(),
        });
        recorder.record(&AgentEvent::Retry { attempt: 1, max: 4 });
        recorder.record(&AgentEvent::TextDelta {
            text: "done".into(),
        });
        recorder.record(&AgentEvent::Done { stop_reason: None });

        assert!(recorder.snapshot().items.iter().all(|item| item.completed));
        recorder.finish(false);
        assert!(recorder.snapshot().items.iter().all(|item| item.completed));
    }

    #[test]
    fn terminal_errors_fail_the_turn_and_retries_stream_as_reconnecting() {
        let mut recorder = TurnRecorder::new("turn-3");
        recorder.record(&AgentEvent::Retry { attempt: 1, max: 4 });
        recorder.record(&AgentEvent::Error {
            message: "connection reset".into(),
            retryable: false,
        });
        recorder.finish(false);

        let record = recorder.into_record();
        assert_eq!(record.status, TurnRecordStatus::Failed);
        assert_eq!(record.error.as_deref(), Some("connection reset"));
        assert!(matches!(
            &record.items[0].item,
            ThreadItem::Error { will_retry: true, message, .. }
                if message == "Reconnecting 1/4"
        ));
        assert!(matches!(
            &record.items[1].item,
            ThreadItem::Error {
                will_retry: false,
                ..
            }
        ));
    }

    #[test]
    fn compaction_and_subagent_activity_become_items() {
        let mut recorder = TurnRecorder::new("turn-4");
        recorder.record(&AgentEvent::SubagentUpdate {
            id: "sub-1".into(),
            label: "research".into(),
            state: "done".into(),
            detail: Some("found 3 papers".into()),
            runtime: Some("acp".into()),
            session_id: Some("acp-session".into()),
            provider_id: None,
            model_id: Some("selected".into()),
            agent_id: Some("codex".into()),
        });
        recorder.record(&AgentEvent::Compacted {
            dropped_messages: 12,
            reason: "context_limit".into(),
        });
        recorder.finish(false);

        let record = recorder.into_record();
        assert!(matches!(
            &record.items[0].item,
            ThreadItem::SubAgentActivity { kind, detail, runtime, session_id, runtime_agent_id, .. }
                if kind == "done" && detail.as_deref() == Some("found 3 papers")
                    && runtime.as_deref() == Some("acp") && session_id.as_deref() == Some("acp-session")
                    && runtime_agent_id.as_deref() == Some("codex")
        ));
        assert!(matches!(
            &record.items[1].item,
            ThreadItem::ContextCompaction {
                dropped_messages: 12,
                ..
            }
        ));
    }
}
