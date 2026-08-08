use std::collections::BTreeMap;
use std::time::Duration;

use futures_util::StreamExt;
use serde_json::Value;

use crate::complete::{
    anthropic_body, google_body, openai_body, request_error, CompletionRequest, Usage,
};
use crate::error::{AgentError, Result};
use crate::event::AgentEvent;
use crate::provider::{catalog_entry, Resolved, Wire};
use crate::sse::{SseDecoder, SseEvent};

const DEFAULT_STREAM_IDLE_TIMEOUT: Duration = Duration::from_secs(120);

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct ToolCall {
    pub id: String,
    pub name: String,
    pub arguments: String,
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct StreamOutcome {
    pub text: String,
    pub reasoning: String,
    pub usage: Usage,
    pub tool_calls: Vec<ToolCall>,
    pub stop_reason: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WireKind {
    OpenAi,
    Anthropic,
    Google,
}

impl From<&Wire> for WireKind {
    fn from(wire: &Wire) -> Self {
        match wire {
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

    fn start_call(&mut self, index: i64, id: String, name: String) -> Vec<AgentEvent> {
        if self.open.contains_key(&index) {
            return Vec::new();
        }
        self.order.push(index);
        self.open.insert(
            index,
            ToolCall {
                id: id.clone(),
                name: name.clone(),
                arguments: String::new(),
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

        if let Some(usage) = value.get("usage").filter(|u| !u.is_null()) {
            self.usage = Usage {
                input: u32_at(usage, "prompt_tokens"),
                output: u32_at(usage, "completion_tokens"),
            };
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
                self.usage.input = u32_at_path(&value, "/message/usage/input_tokens");
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
        if value.pointer("/content_block/type").and_then(|t| t.as_str()) != Some("tool_use") {
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
        let output = u32_at_path(value, "/usage/output_tokens");
        if output > 0 {
            self.usage.output = output;
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

        if let Some(meta) = value.get("usageMetadata") {
            self.usage = Usage {
                input: u32_at(meta, "promptTokenCount"),
                output: u32_at(meta, "candidatesTokenCount"),
            };
            out.push(AgentEvent::Usage { usage: self.usage });
        }

        if let Some(parts) = value
            .pointer("/candidates/0/content/parts")
            .and_then(|p| p.as_array())
        {
            for part in parts {
                if let Some(text) = nonempty(part.get("text")) {
                    out.push(AgentEvent::TextDelta { text });
                }
                if let Some(call) = part.get("functionCall") {
                    out.extend(self.google_function_call(call));
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

    fn google_function_call(&mut self, call: &Value) -> Vec<AgentEvent> {
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
    value.get(key).and_then(|v| v.as_u64()).unwrap_or(0) as u32
}

fn u32_at_path(value: &Value, path: &str) -> u32 {
    value.pointer(path).and_then(|v| v.as_u64()).unwrap_or(0) as u32
}

fn stream_body(resolved: &Resolved, req: &CompletionRequest) -> Result<Value> {
    match &resolved.wire {
        Wire::OpenAiChat { .. } => {
            let mut body = openai_body(resolved, req)?;
            body["stream"] = Value::Bool(true);
            if catalog_entry(&resolved.provider_id).is_some() {
                body["stream_options"] = serde_json::json!({ "include_usage": true });
            }
            Ok(body)
        }
        Wire::Anthropic { .. } => {
            let mut body = anthropic_body(resolved, req)?;
            body["stream"] = Value::Bool(true);
            Ok(body)
        }
        Wire::Google { .. } => google_body(req),
    }
}

pub async fn stream_completion<F>(
    client: &reqwest::Client,
    resolved: &Resolved,
    req: &CompletionRequest,
    mut on_event: F,
) -> Result<StreamOutcome>
where
    F: FnMut(AgentEvent),
{
    let idle = req
        .idle_timeout_ms
        .map(Duration::from_millis)
        .unwrap_or(DEFAULT_STREAM_IDLE_TIMEOUT);
    let response = open_stream(client, resolved, req).await?;
    let kind = WireKind::from(&resolved.wire);
    let mut translator = Translator::new(kind);
    let mut decoder = SseDecoder::new();
    let mut outcome = StreamOutcome::default();
    let mut stream = response.bytes_stream();

    while let Some(chunk) = tokio::time::timeout(idle, stream.next())
        .await
        .map_err(|_| AgentError::Timeout)?
    {
        let bytes = chunk.map_err(request_error)?;
        let text = String::from_utf8_lossy(&bytes).to_string();
        translate_batch(
            &mut translator,
            decoder.push(&text),
            &mut outcome,
            &mut on_event,
        );
        if translator.error().is_some() {
            break;
        }
    }
    if translator.error().is_none() {
        let tail: Vec<SseEvent> = decoder.finish().into_iter().collect();
        translate_batch(&mut translator, tail, &mut outcome, &mut on_event);
    }
    finalize(translator, outcome, &mut on_event)
}

fn finalize<F: FnMut(AgentEvent)>(
    mut translator: Translator,
    mut outcome: StreamOutcome,
    on_event: &mut F,
) -> Result<StreamOutcome> {
    if let Some(error) = translator.take_error() {
        return Err(error);
    }
    for agent_event in translator.finish() {
        accumulate(&mut outcome, &agent_event);
        on_event(agent_event);
    }
    outcome.usage = translator.usage();
    outcome.tool_calls = translator.tool_calls();
    outcome.stop_reason = translator.stop_reason();
    Ok(outcome)
}

async fn open_stream(
    client: &reqwest::Client,
    resolved: &Resolved,
    req: &CompletionRequest,
) -> Result<reqwest::Response> {
    let body = stream_body(resolved, req)?;
    let response = crate::complete::request_builder(client, resolved, true)
        .json(&body)
        .header("accept", "text/event-stream")
        .send()
        .await
        .map_err(request_error)?;

    let status = response.status().as_u16();
    if !(200..300).contains(&status) {
        let raw = response.text().await.unwrap_or_default();
        return Err(crate::complete::error_message(status, &raw));
    }
    Ok(response)
}

fn translate_batch<F: FnMut(AgentEvent)>(
    translator: &mut Translator,
    events: Vec<SseEvent>,
    outcome: &mut StreamOutcome,
    on_event: &mut F,
) {
    for event in events {
        for agent_event in translator.translate(&event) {
            accumulate(outcome, &agent_event);
            on_event(agent_event);
        }
    }
}

fn accumulate(outcome: &mut StreamOutcome, event: &AgentEvent) {
    match event {
        AgentEvent::TextDelta { text } => outcome.text.push_str(text),
        AgentEvent::ReasoningDelta { text } => outcome.reasoning.push_str(text),
        _ => {}
    }
}

pub fn abort_error() -> AgentError {
    AgentError::Cancelled
}

#[cfg(test)]
mod tests;
