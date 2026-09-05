use std::collections::BTreeMap;

use serde_json::Value;

use crate::complete::{InputTokenSemantics, Usage};
use crate::error::AgentError;
use crate::event::AgentEvent;
use crate::provider::Wire;
use crate::sse::SseEvent;
use crate::stream::{ToolCall, MAX_STREAM_TOOL_CALLS};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WireKind {
    OpenAi,
    OpenAiResponses,
    Anthropic,
    Google,
}

impl From<&Wire> for WireKind {
    fn from(wire: &Wire) -> Self {
        match wire {
            Wire::OpenAiResponses { .. } => WireKind::OpenAiResponses,
            Wire::OpenAiChat { .. } => WireKind::OpenAi,
            Wire::Anthropic { .. } => WireKind::Anthropic,
            Wire::Google { .. } => WireKind::Google,
        }
    }
}

pub struct Translator {
    kind: WireKind,
    open: BTreeMap<i64, ToolCall>,
    order: Vec<i64>,
    finished: Vec<ToolCall>,
    stop_reason: Option<String>,
    usage: Usage,
    done: bool,
    synthetic: i64,
    error: Option<AgentError>,
    response_items: BTreeMap<i64, Value>,
}

impl Translator {
    pub fn new(kind: WireKind) -> Self {
        Translator {
            kind,
            open: BTreeMap::new(),
            order: Vec::new(),
            finished: Vec::new(),
            stop_reason: None,
            usage: Usage::default(),
            done: false,
            synthetic: 0,
            error: None,
            response_items: BTreeMap::new(),
        }
    }

    pub fn error(&self) -> Option<&AgentError> {
        self.error.as_ref()
    }

    pub fn take_error(&mut self) -> Option<AgentError> {
        self.error.take()
    }

    fn decode_failure(&mut self, data: &str) -> Vec<AgentEvent> {
        let snippet: String = data.chars().take(120).collect();
        self.error = Some(AgentError::Decode(format!(
            "the provider sent unparseable stream data: {snippet}"
        )));
        Vec::new()
    }

    pub fn translate(&mut self, event: &SseEvent) -> Vec<AgentEvent> {
        match self.kind {
            WireKind::OpenAi => self.openai(event),
            WireKind::OpenAiResponses => self.openai_responses(event),
            WireKind::Anthropic => self.anthropic(event),
            WireKind::Google => self.google(event),
        }
    }

    pub fn finish(&mut self) -> Vec<AgentEvent> {
        let mut out = self.close_all();
        if !self.done {
            self.done = true;
            out.push(AgentEvent::Done {
                stop_reason: self.stop_reason.clone(),
            });
        }
        out
    }

    pub fn usage(&self) -> Usage {
        self.usage
    }

    pub fn tool_calls(&self) -> Vec<ToolCall> {
        self.finished.clone()
    }

    pub fn stop_reason(&self) -> Option<String> {
        self.stop_reason.clone()
    }

    pub fn response_items(&self) -> Vec<Value> {
        self.response_items.values().cloned().collect()
    }

    fn start_call(&mut self, index: i64, id: String, name: String) -> Vec<AgentEvent> {
        if self.open.contains_key(&index) {
            return Vec::new();
        }
        if self.open.len().saturating_add(self.finished.len()) >= MAX_STREAM_TOOL_CALLS {
            self.error = Some(AgentError::Decode(format!(
                "provider stream exceeded the {MAX_STREAM_TOOL_CALLS}-tool-call safety limit"
            )));
            return Vec::new();
        }
        self.order.push(index);
        self.open.insert(
            index,
            ToolCall {
                id: id.clone(),
                name: name.clone(),
                arguments: String::new(),
                thought_signature: None,
            },
        );
        vec![AgentEvent::ToolCallStart { id, name }]
    }

    fn push_args(&mut self, index: i64, fragment: &str) -> Vec<AgentEvent> {
        let Some(call) = self.open.get_mut(&index) else {
            return Vec::new();
        };
        call.arguments.push_str(fragment);
        vec![AgentEvent::ToolCallArgsDelta {
            id: call.id.clone(),
            json: fragment.to_string(),
        }]
    }

    fn close_call(&mut self, index: i64) -> Vec<AgentEvent> {
        let Some(call) = self.open.remove(&index) else {
            return Vec::new();
        };
        self.order.retain(|i| *i != index);
        let event = AgentEvent::ToolCallEnd {
            id: call.id.clone(),
            arguments: call.arguments.clone(),
        };
        self.finished.push(call);
        vec![event]
    }

    fn close_all(&mut self) -> Vec<AgentEvent> {
        let pending: Vec<i64> = self.order.clone();
        pending
            .into_iter()
            .flat_map(|i| self.close_call(i))
            .collect()
    }

    fn openai(&mut self, event: &SseEvent) -> Vec<AgentEvent> {
        if event.data.trim() == "[DONE]" {
            return self.finish();
        }
        if event.data.trim().is_empty() {
            return Vec::new();
        }
        let Ok(value) = serde_json::from_str::<Value>(&event.data) else {
            return self.decode_failure(&event.data);
        };
        let mut out = Vec::new();

        if let Some(usage) = value.get("usage").filter(|u| u.is_object()) {
            self.usage.merge_snapshot(Usage {
                input: u32_at(usage, "prompt_tokens"),
                output: u32_at(usage, "completion_tokens"),
                input_known: Some(optional_u32_at(usage, "prompt_tokens").is_some()),
                output_known: Some(optional_u32_at(usage, "completion_tokens").is_some()),
                cache_read: optional_u32_at_path(usage, "/prompt_tokens_details/cached_tokens"),
                cache_write: (optional_u32_at(usage, "prompt_tokens").is_some()
                    || optional_u32_at(usage, "completion_tokens").is_some())
                .then_some(0),
                input_semantics: InputTokenSemantics::Inclusive,
            });
            out.push(AgentEvent::Usage { usage: self.usage });
        }

        let Some(choice) = value.pointer("/choices/0") else {
            return out;
        };
        if let Some(reason) = choice.get("finish_reason").and_then(|r| r.as_str()) {
            self.stop_reason = Some(reason.to_string());
        }

        if let Some(delta) = choice.get("delta") {
            out.extend(self.openai_delta(delta));
        }
        out
    }

    fn openai_delta(&mut self, delta: &Value) -> Vec<AgentEvent> {
        let mut out = Vec::new();
        if let Some(text) = nonempty(delta.get("reasoning_content")) {
            out.push(AgentEvent::ReasoningDelta { text });
        }
        if let Some(text) = nonempty(delta.get("reasoning")) {
            out.push(AgentEvent::ReasoningDelta { text });
        }
        if let Some(text) = nonempty(delta.get("content")) {
            out.push(AgentEvent::TextDelta { text });
        }
        if let Some(calls) = delta.get("tool_calls").and_then(|c| c.as_array()) {
            for (position, call) in calls.iter().enumerate() {
                out.extend(self.openai_tool_call(call, position));
            }
        }
        out
    }

    fn openai_tool_call(&mut self, call: &Value, position: usize) -> Vec<AgentEvent> {
        let mut out = Vec::new();
        let index = call
            .get("index")
            .and_then(|i| i.as_i64())
            .unwrap_or(position as i64);
        let name = call
            .pointer("/function/name")
            .and_then(|n| n.as_str())
            .unwrap_or_default();
        if !name.is_empty() {
            let id = call
                .get("id")
                .and_then(|i| i.as_str())
                .map(|s| s.to_string())
                .unwrap_or_else(|| format!("call_{index}"));
            out.extend(self.start_call(index, id, name.to_string()));
        }
        if let Some(fragment) = call
            .pointer("/function/arguments")
            .and_then(|a| a.as_str())
            .filter(|a| !a.is_empty())
        {
            out.extend(self.push_args(index, fragment));
        }
        out
    }

    fn openai_responses(&mut self, event: &SseEvent) -> Vec<AgentEvent> {
        if event.data.trim() == "[DONE]" {
            return self.finish();
        }
        if event.data.trim().is_empty() {
            return Vec::new();
        }
        let Ok(value) = serde_json::from_str::<Value>(&event.data) else {
            return self.decode_failure(&event.data);
        };
        let kind = event
            .event
            .as_deref()
            .or_else(|| value.get("type").and_then(|kind| kind.as_str()))
            .unwrap_or_default();
        let index = value
            .get("output_index")
            .and_then(|index| index.as_i64())
            .unwrap_or(0);
        let mut out = Vec::new();

        match kind {
            "response.output_text.delta" | "response.refusal.delta" => {
                if let Some(text) = nonempty(value.get("delta")) {
                    out.push(AgentEvent::TextDelta { text });
                }
            }
            "response.reasoning_summary_text.delta" | "response.reasoning_text.delta" => {
                if let Some(text) = nonempty(value.get("delta")) {
                    out.push(AgentEvent::ReasoningDelta { text });
                }
            }
            "response.output_item.added" => {
                if value.pointer("/item/type").and_then(|kind| kind.as_str())
                    == Some("function_call")
                {
                    let id = value
                        .pointer("/item/call_id")
                        .and_then(|id| id.as_str())
                        .or_else(|| value.pointer("/item/id").and_then(|id| id.as_str()))
                        .unwrap_or_default()
                        .to_string();
                    let name = value
                        .pointer("/item/name")
                        .and_then(|name| name.as_str())
                        .unwrap_or_default()
                        .to_string();
                    if !name.is_empty() {
                        out.extend(self.start_call(index, id, name));
                    }
                }
            }
            "response.function_call_arguments.delta" => {
                if let Some(delta) = value
                    .get("delta")
                    .and_then(|delta| delta.as_str())
                    .filter(|delta| !delta.is_empty())
                {
                    out.extend(self.push_args(index, delta));
                }
            }
            "response.function_call_arguments.done" => {
                if let Some(arguments) = value.get("arguments").and_then(|args| args.as_str()) {
                    let existing = self
                        .open
                        .get(&index)
                        .map(|call| call.arguments.as_str())
                        .unwrap_or_default();
                    if let Some(remainder) = arguments.strip_prefix(existing) {
                        if !remainder.is_empty() {
                            out.extend(self.push_args(index, remainder));
                        }
                    }
                }
                out.extend(self.close_call(index));
            }
            "response.output_item.done" => {
                if let Some(item) = value.get("item") {
                    self.response_items.insert(index, item.clone());
                }
                out.extend(self.close_call(index));
            }
            "response.completed" | "response.incomplete" => {
                if self.response_items.is_empty() {
                    if let Some(items) = value
                        .pointer("/response/output")
                        .and_then(|output| output.as_array())
                    {
                        self.response_items.extend(
                            items
                                .iter()
                                .enumerate()
                                .map(|(index, item)| (index as i64, item.clone())),
                        );
                    }
                }
                if let Some(usage) = value
                    .pointer("/response/usage")
                    .filter(|value| value.is_object())
                {
                    self.usage.merge_snapshot(Usage {
                        input: u32_at(usage, "input_tokens"),
                        output: u32_at(usage, "output_tokens"),
                        input_known: Some(optional_u32_at(usage, "input_tokens").is_some()),
                        output_known: Some(optional_u32_at(usage, "output_tokens").is_some()),
                        cache_read: optional_u32_at_path(
                            usage,
                            "/input_tokens_details/cached_tokens",
                        ),
                        cache_write: (optional_u32_at(usage, "input_tokens").is_some()
                            || optional_u32_at(usage, "output_tokens").is_some())
                        .then_some(0),
                        input_semantics: InputTokenSemantics::Inclusive,
                    });
                    out.push(AgentEvent::Usage { usage: self.usage });
                }
                self.stop_reason = Some(if kind == "response.completed" {
                    "completed".into()
                } else {
                    value
                        .pointer("/response/incomplete_details/reason")
                        .and_then(|reason| reason.as_str())
                        .unwrap_or("incomplete")
                        .to_string()
                });
                out.extend(self.finish());
            }
            "response.failed" | "error" => {
                let message = value
                    .pointer("/response/error/message")
                    .or_else(|| value.pointer("/error/message"))
                    .and_then(|message| message.as_str())
                    .unwrap_or("OpenAI response stream failed")
                    .to_string();
                self.done = true;
                self.error = Some(AgentError::Provider {
                    status: 400,
                    message,
                });
            }
            _ => {}
        }
        out
    }

    fn anthropic(&mut self, event: &SseEvent) -> Vec<AgentEvent> {
        if event.data.trim().is_empty() {
            return Vec::new();
        }
        let Ok(value) = serde_json::from_str::<Value>(&event.data) else {
            return self.decode_failure(&event.data);
        };
        let kind = event
            .event
            .as_deref()
            .or_else(|| value.get("type").and_then(|t| t.as_str()))
            .unwrap_or_default();
        let index = value.get("index").and_then(|i| i.as_i64()).unwrap_or(0);
        let mut out = Vec::new();

        match kind {
            "message_start" => {
                if let Some(usage) = value
                    .pointer("/message/usage")
                    .filter(|value| value.is_object())
                {
                    self.usage.merge_snapshot(Usage {
                        input: u32_at(usage, "input_tokens"),
                        output: u32_at(usage, "output_tokens"),
                        input_known: Some(optional_u32_at(usage, "input_tokens").is_some()),
                        output_known: Some(optional_u32_at(usage, "output_tokens").is_some()),
                        cache_read: optional_u32_at(usage, "cache_read_input_tokens"),
                        cache_write: optional_u32_at(usage, "cache_creation_input_tokens"),
                        input_semantics: InputTokenSemantics::Exclusive,
                    });
                    out.push(AgentEvent::Usage { usage: self.usage });
                }
            }
            "content_block_start" => out.extend(self.anthropic_block_start(&value, index)),
            "content_block_delta" => out.extend(self.anthropic_block_delta(&value, index)),
            "content_block_stop" => {
                out.extend(self.close_call(index));
            }
            "message_delta" => out.extend(self.anthropic_message_delta(&value)),
            "message_stop" => {
                out.extend(self.finish());
            }
            "error" => self.anthropic_terminal_error(&value),
            _ => {}
        }
        out
    }

    fn anthropic_block_start(&mut self, value: &Value, index: i64) -> Vec<AgentEvent> {
        if value
            .pointer("/content_block/type")
            .and_then(|t| t.as_str())
            != Some("tool_use")
        {
            return Vec::new();
        }
        let id = value
            .pointer("/content_block/id")
            .and_then(|i| i.as_str())
            .unwrap_or_default()
            .to_string();
        let name = value
            .pointer("/content_block/name")
            .and_then(|n| n.as_str())
            .unwrap_or_default()
            .to_string();
        self.start_call(index, id, name)
    }

    fn anthropic_block_delta(&mut self, value: &Value, index: i64) -> Vec<AgentEvent> {
        let mut out = Vec::new();
        match value.pointer("/delta/type").and_then(|t| t.as_str()) {
            Some("text_delta") => {
                if let Some(text) = nonempty(value.pointer("/delta/text")) {
                    out.push(AgentEvent::TextDelta { text });
                }
            }
            Some("thinking_delta") => {
                if let Some(text) = nonempty(value.pointer("/delta/thinking")) {
                    out.push(AgentEvent::ReasoningDelta { text });
                }
            }
            Some("input_json_delta") => {
                if let Some(fragment) = value
                    .pointer("/delta/partial_json")
                    .and_then(|p| p.as_str())
                    .filter(|p| !p.is_empty())
                {
                    out.extend(self.push_args(index, fragment));
                }
            }
            _ => {}
        }
        out
    }

    fn anthropic_message_delta(&mut self, value: &Value) -> Vec<AgentEvent> {
        let mut out = Vec::new();
        if let Some(reason) = value.pointer("/delta/stop_reason").and_then(|r| r.as_str()) {
            self.stop_reason = Some(reason.to_string());
        }
        if let Some(output) = optional_u32_at_path(value, "/usage/output_tokens") {
            self.usage.output = output;
            self.usage.output_known = Some(true);
            out.push(AgentEvent::Usage { usage: self.usage });
        }
        out
    }

    fn anthropic_terminal_error(&mut self, value: &Value) {
        let message = value
            .pointer("/error/message")
            .and_then(|m| m.as_str())
            .unwrap_or("stream error")
            .to_string();
        let kind = value
            .pointer("/error/type")
            .and_then(|t| t.as_str())
            .unwrap_or_default();
        self.done = true;
        self.error = Some(anthropic_stream_error(kind, message));
    }

    fn google(&mut self, event: &SseEvent) -> Vec<AgentEvent> {
        if event.data.trim().is_empty() {
            return Vec::new();
        }
        let Ok(value) = serde_json::from_str::<Value>(&event.data) else {
            return self.decode_failure(&event.data);
        };
        let mut out = Vec::new();

        if let Some(meta) = value.get("usageMetadata").filter(|value| value.is_object()) {
            self.usage.merge_snapshot(Usage {
                input: u32_at(meta, "promptTokenCount"),
                output: u32_at(meta, "candidatesTokenCount"),
                input_known: Some(optional_u32_at(meta, "promptTokenCount").is_some()),
                output_known: Some(optional_u32_at(meta, "candidatesTokenCount").is_some()),
                cache_read: optional_u32_at(meta, "cachedContentTokenCount"),
                cache_write: (optional_u32_at(meta, "promptTokenCount").is_some()
                    || optional_u32_at(meta, "candidatesTokenCount").is_some())
                .then_some(0),
                input_semantics: InputTokenSemantics::Inclusive,
            });
            out.push(AgentEvent::Usage { usage: self.usage });
        }

        if let Some(parts) = value
            .pointer("/candidates/0/content/parts")
            .and_then(|p| p.as_array())
        {
            for part in parts {
                let thought = part
                    .get("thought")
                    .and_then(|t| t.as_bool())
                    .unwrap_or(false);
                if let Some(text) = nonempty(part.get("text")) {
                    if thought {
                        out.push(AgentEvent::ReasoningDelta { text });
                    } else {
                        out.push(AgentEvent::TextDelta { text });
                    }
                }
                let signature = part
                    .get("thoughtSignature")
                    .and_then(|s| s.as_str())
                    .filter(|s| !s.is_empty())
                    .map(|s| s.to_string());
                if let Some(call) = part.get("functionCall") {
                    out.extend(self.google_function_call(call, signature));
                }
            }
        }

        if let Some(reason) = value
            .pointer("/candidates/0/finishReason")
            .and_then(|r| r.as_str())
        {
            self.stop_reason = Some(reason.to_string());
        }
        out
    }

    fn google_function_call(
        &mut self,
        call: &Value,
        thought_signature: Option<String>,
    ) -> Vec<AgentEvent> {
        let name = call
            .get("name")
            .and_then(|n| n.as_str())
            .unwrap_or_default()
            .to_string();
        if name.is_empty() {
            return Vec::new();
        }
        self.synthetic += 1;
        let index = -self.synthetic;
        let id = format!("call_{}_{}", name, self.synthetic);
        let arguments = call
            .get("args")
            .map(|a| a.to_string())
            .unwrap_or_else(|| "{}".to_string());
        let mut out = self.start_call(index, id, name);
        if let Some(open) = self.open.get_mut(&index) {
            open.thought_signature = thought_signature;
        }
        out.extend(self.push_args(index, &arguments));
        out.extend(self.close_call(index));
        out
    }
}

fn anthropic_stream_error(kind: &str, message: String) -> AgentError {
    match kind {
        "rate_limit_error" => AgentError::Provider {
            status: 429,
            message,
        },
        "overloaded_error" | "api_error" | "" => AgentError::Provider {
            status: 529,
            message,
        },
        "timeout_error" => AgentError::Timeout,
        "authentication_error" | "permission_error" => AgentError::Provider {
            status: 401,
            message,
        },
        _ => AgentError::Provider {
            status: 400,
            message,
        },
    }
}

fn nonempty(value: Option<&Value>) -> Option<String> {
    value
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
}

fn u32_at(value: &Value, key: &str) -> u32 {
    saturating_u32(value.get(key))
}

fn optional_u32_at(value: &Value, key: &str) -> Option<u32> {
    optional_saturating_u32(value.get(key))
}

fn optional_u32_at_path(value: &Value, path: &str) -> Option<u32> {
    optional_saturating_u32(value.pointer(path))
}

fn saturating_u32(value: Option<&Value>) -> u32 {
    value
        .and_then(|value| value.as_u64())
        .map(|number| u32::try_from(number).unwrap_or(u32::MAX))
        .unwrap_or(0)
}

fn optional_saturating_u32(value: Option<&Value>) -> Option<u32> {
    value
        .and_then(|value| value.as_u64())
        .map(|number| u32::try_from(number).unwrap_or(u32::MAX))
}
