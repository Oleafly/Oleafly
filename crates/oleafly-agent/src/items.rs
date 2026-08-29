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
#[serde(tag = "type", rename_all = "camelCase")]
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
        #[serde(default)]
        aggregated_output: String,
        #[serde(skip_serializing_if = "Option::is_none")]
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
        #[serde(default, skip_serializing_if = "Option::is_none")]
        result: Option<serde_json::Value>,
        status: ExecutionStatus,
    },
    #[serde(rename = "dynamicToolCall")]
    DynamicToolCall {
        namespace: String,
        tool: String,
        #[serde(default)]
        arguments: serde_json::Value,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        output: Option<String>,
        status: ExecutionStatus,
    },
    #[serde(rename = "collabAgentToolCall")]
    CollabAgentToolCall {
        tool: String,
        #[serde(default)]
        arguments: serde_json::Value,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        result: Option<serde_json::Value>,
    },
    #[serde(rename = "subAgentActivity")]
    SubAgentActivity {
        agent_id: String,
        label: String,
        kind: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        detail: Option<String>,
    },
    #[serde(rename = "todo-list")]
    TodoList {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        explanation: Option<String>,
        todos: Vec<PlanTodo>,
    },
    #[serde(rename = "planImplementation")]
    PlanImplementation {
        plan_content: String,
        completed: bool,
    },
    #[serde(rename = "error")]
    Error {
        message: String,
        #[serde(default, skip_serializing_if = "std::ops::Not::not")]
        will_retry: bool,
        #[serde(skip_serializing_if = "Option::is_none")]
        error_info: Option<String>,
    },
    #[serde(rename = "automaticApprovalReview")]
    AutomaticApprovalReview {
        target_item_id: String,
        action: String,
        risk_level: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        rationale: Option<String>,
    },
    #[serde(rename = "strictReviewNotice")]
    StrictReviewNotice,
    #[serde(rename = "remoteTaskCreated")]
    RemoteTaskCreated { task_id: String },
    #[serde(rename = "personalityChanged")]
    PersonalityChanged { personality: String },
    #[serde(rename = "forkedFromConversation")]
    ForkedFromConversation {
        source_conversation_id: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        source_conversation_title: Option<String>,
    },
    #[serde(rename = "modelChanged")]
    ModelChanged {
        from_model: String,
        to_model: String,
    },
    #[serde(rename = "modelRerouted")]
    ModelRerouted {
        from_model: String,
        to_model: String,
    },
    #[serde(rename = "autoReviewInterruptionWarning")]
    AutoReviewInterruptionWarning,
    #[serde(rename = "userInputResponse")]
    UserInputResponse {
        request_id: String,
        answers: serde_json::Value,
    },
    #[serde(rename = "mcpServerElicitation")]
    McpServerElicitation {
        request_id: String,
        server_name: String,
        elicitation: serde_json::Value,
        completed: bool,
    },
    #[serde(rename = "permissionRequest")]
    PermissionRequest {
        request_id: String,
        permissions: serde_json::Value,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        response: Option<String>,
    },
    #[serde(rename = "webSearch")]
    WebSearch { query: String, completed: bool },
    #[serde(rename = "contextCompaction")]
    ContextCompaction {
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
        #[serde(default, skip_serializing_if = "Option::is_none")]
        path: Option<String>,
    },
    #[serde(rename = "imageView")]
    ImageView { image_paths: Vec<String> },
    #[serde(rename = "enteredReviewMode")]
    EnteredReviewMode,
    #[serde(rename = "exitedReviewMode")]
    ExitedReviewMode,
    #[serde(rename = "sleep")]
    Sleep { duration_ms: u64 },
}

/// An item with its identity and lifecycle stamp.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordedItem {
    pub id: String,
    pub item: ThreadItem,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub client_turn_id: Option<String>,
    pub status: TurnRecordStatus,
    pub items: Vec<RecordedItem>,
    #[serde(default)]
    pub usage: Usage,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
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

fn tool_output_succeeded(output: &str) -> bool {
    let Ok(serde_json::Value::Object(object)) = serde_json::from_str(output) else {
        return true;
    };
    if object.contains_key("error") {
        return false;
    }
    !object
        .get("exit_code")
        .and_then(serde_json::Value::as_f64)
        .is_some_and(|exit_code| exit_code != 0.0)
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
                    let ok = tool_output_succeeded(output);
                    match &mut recorded.item {
                        ThreadItem::CommandExecution {
                            aggregated_output,
                            status,
                            exit_code,
                            ..
                        } => {
                            aggregated_output.push_str(output);
                            *exit_code = if ok { Some(0) } else { Some(1) };
                            *status = if ok {
                                ExecutionStatus::Completed
                            } else {
                                ExecutionStatus::Failed
                            };
                        }
                        ThreadItem::FileChange { status, .. } => {
                            *status = if ok {
                                ExecutionStatus::Completed
                            } else {
                                ExecutionStatus::Failed
                            };
                        }
                        ThreadItem::DynamicToolCall {
                            output: out,
                            status,
                            ..
                        } => {
                            *out = Some(output.clone());
                            *status = if ok {
                                ExecutionStatus::Completed
                            } else {
                                ExecutionStatus::Failed
                            };
                        }
                        ThreadItem::McpToolCall { status, .. } => {
                            *status = if ok {
                                ExecutionStatus::Completed
                            } else {
                                ExecutionStatus::Failed
                            };
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
            } => {
                self.push(
                    ThreadItem::SubAgentActivity {
                        agent_id: id.clone(),
                        label: label.clone(),
                        kind: state.clone(),
                        detail: detail.clone(),
                    },
                    state == "done" || state == "error",
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
                // The model stream ended: complete the most recent message
                // still open, wherever it sits in the item list (text can
                // precede tool calls).
                for recorded in self.record.items.iter_mut().rev() {
                    if matches!(recorded.item, ThreadItem::AgentMessage { .. }) {
                        if !recorded.completed {
                            recorded.completed = true;
                        }
                        break;
                    }
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
        let item = ThreadItem::TodoList {
            explanation: Some("fix the build".into()),
            todos: vec![PlanTodo {
                step: "run tests".into(),
                status: "in_progress".into(),
            }],
        };
        let value = serde_json::to_value(&item).unwrap();
        assert_eq!(value["type"], "todo-list");
        assert_eq!(value["todos"][0]["step"], "run tests");

        let item = ThreadItem::CommandExecution {
            command: vec!["cargo test".into()],
            cwd: "/tmp".into(),
            aggregated_output: String::new(),
            exit_code: None,
            status: ExecutionStatus::InProgress,
        };
        assert_eq!(
            serde_json::to_value(&item).unwrap()["type"],
            "commandExecution"
        );

        let item = ThreadItem::SubAgentActivity {
            agent_id: "sub-1".into(),
            label: "research".into(),
            kind: "started".into(),
            detail: None,
        };
        assert_eq!(
            serde_json::to_value(&item).unwrap()["type"],
            "subAgentActivity"
        );
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
            (r#"{"error":"aborted"}"#, ExecutionStatus::Failed, Some(1)),
            (
                r#"{"exit_code":1,"stdout":"failed"}"#,
                ExecutionStatus::Failed,
                Some(1),
            ),
            (
                r#"{"exit_code":0,"stdout":"done"}"#,
                ExecutionStatus::Completed,
                Some(0),
            ),
            (
                "plain text containing the word error",
                ExecutionStatus::Completed,
                Some(0),
            ),
            (
                r#"plain text mentioning "error": inside prose"#,
                ExecutionStatus::Completed,
                Some(0),
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
        });
        recorder.record(&AgentEvent::Compacted {
            dropped_messages: 12,
            reason: "context_limit".into(),
        });
        recorder.finish(false);

        let record = recorder.into_record();
        assert!(matches!(
            &record.items[0].item,
            ThreadItem::SubAgentActivity { kind, detail, .. }
                if kind == "done" && detail.as_deref() == Some("found 3 papers")
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
