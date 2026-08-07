use std::collections::BTreeMap;

use futures_util::StreamExt;
use serde_json::Value;

use crate::complete::{
    anthropic_body, auth_headers, google_body, openai_body, request_error, CompletionRequest, Usage,
};
use crate::error::{AgentError, Result};
use crate::event::AgentEvent;
use crate::provider::{catalog_entry, Resolved, Wire};
use crate::sse::{SseDecoder, SseEvent};

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
        }
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
        let Ok(value) = serde_json::from_str::<Value>(&event.data) else {
            return Vec::new();
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
                }
            }
        }
        out
    }

    fn anthropic(&mut self, event: &SseEvent) -> Vec<AgentEvent> {
        let Ok(value) = serde_json::from_str::<Value>(&event.data) else {
            return Vec::new();
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
            "content_block_start" => {
                if value
                    .pointer("/content_block/type")
                    .and_then(|t| t.as_str())
                    == Some("tool_use")
                {
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
                    out.extend(self.start_call(index, id, name));
                }
            }
            "content_block_delta" => {
                let delta_type = value.pointer("/delta/type").and_then(|t| t.as_str());
                match delta_type {
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
            }
            "content_block_stop" => {
                out.extend(self.close_call(index));
            }
            "message_delta" => {
                if let Some(reason) = value.pointer("/delta/stop_reason").and_then(|r| r.as_str()) {
                    self.stop_reason = Some(reason.to_string());
                }
                let output = u32_at_path(&value, "/usage/output_tokens");
                if output > 0 {
                    self.usage.output = output;
                    out.push(AgentEvent::Usage { usage: self.usage });
                }
            }
            "message_stop" => {
                out.extend(self.finish());
            }
            "error" => {
                let message = value
                    .pointer("/error/message")
                    .and_then(|m| m.as_str())
                    .unwrap_or("stream error")
                    .to_string();
                self.done = true;
                out.push(AgentEvent::Error {
                    message,
                    retryable: true,
                });
            }
            _ => {}
        }
        out
    }

    fn google(&mut self, event: &SseEvent) -> Vec<AgentEvent> {
        let Ok(value) = serde_json::from_str::<Value>(&event.data) else {
            return Vec::new();
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
                    let name = call
                        .get("name")
                        .and_then(|n| n.as_str())
                        .unwrap_or_default()
                        .to_string();
                    if name.is_empty() {
                        continue;
                    }
                    self.synthetic += 1;
                    let index = -self.synthetic;
                    let id = format!("call_{}_{}", name, self.synthetic);
                    let arguments = call
                        .get("args")
                        .map(|a| a.to_string())
                        .unwrap_or_else(|| "{}".to_string());
                    out.extend(self.start_call(index, id, name));
                    out.extend(self.push_args(index, &arguments));
                    out.extend(self.close_call(index));
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
    let body = stream_body(resolved, req)?;
    let builder = match &resolved.wire {
        Wire::OpenAiChat { base_url, .. } => client
            .post(format!(
                "{}/chat/completions",
                base_url.trim_end_matches('/')
            ))
            .headers(auth_headers(resolved))
            .json(&body),
        Wire::Anthropic { base_url } => client
            .post(format!("{}/messages", base_url.trim_end_matches('/')))
            .headers(auth_headers(resolved))
            .header("anthropic-version", "2023-06-01")
            .json(&body),
        Wire::Google { base_url } => client
            .post(format!(
                "{}/models/{}:streamGenerateContent?alt=sse",
                base_url.trim_end_matches('/'),
                resolved.model_id
            ))
            .headers(auth_headers(resolved))
            .json(&body),
    };

    let response = builder
        .header("accept", "text/event-stream")
        .send()
        .await
        .map_err(request_error)?;

    let status = response.status().as_u16();
    if !(200..300).contains(&status) {
        let raw = response.text().await.unwrap_or_default();
        return Err(crate::complete::error_message(status, &raw));
    }

    let kind = WireKind::from(&resolved.wire);
    let mut translator = Translator::new(kind);
    let mut decoder = SseDecoder::new();
    let mut outcome = StreamOutcome::default();
    let mut stream = response.bytes_stream();

    while let Some(chunk) = stream.next().await {
        let bytes = chunk.map_err(request_error)?;
        let text = String::from_utf8_lossy(&bytes).to_string();
        for event in decoder.push(&text) {
            for agent_event in translator.translate(&event) {
                accumulate(&mut outcome, &agent_event);
                on_event(agent_event);
            }
        }
    }
    if let Some(event) = decoder.finish() {
        for agent_event in translator.translate(&event) {
            accumulate(&mut outcome, &agent_event);
            on_event(agent_event);
        }
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
mod tests {
    use super::*;

    fn run(kind: WireKind, raw: &str) -> (Vec<AgentEvent>, Translator) {
        let mut translator = Translator::new(kind);
        let mut decoder = SseDecoder::new();
        let mut events = Vec::new();
        for event in decoder.push(raw) {
            events.extend(translator.translate(&event));
        }
        if let Some(event) = decoder.finish() {
            events.extend(translator.translate(&event));
        }
        events.extend(translator.finish());
        (events, translator)
    }

    fn text_of(events: &[AgentEvent]) -> String {
        events
            .iter()
            .filter_map(|e| match e {
                AgentEvent::TextDelta { text } => Some(text.as_str()),
                _ => None,
            })
            .collect()
    }

    fn reasoning_of(events: &[AgentEvent]) -> String {
        events
            .iter()
            .filter_map(|e| match e {
                AgentEvent::ReasoningDelta { text } => Some(text.as_str()),
                _ => None,
            })
            .collect()
    }

    #[test]
    fn openai_text_deltas_join_into_the_reply() {
        let raw = concat!(
            "data: {\"choices\":[{\"delta\":{\"content\":\"Hel\"}}]}\n\n",
            "data: {\"choices\":[{\"delta\":{\"content\":\"lo\"}}]}\n\n",
            "data: [DONE]\n\n"
        );
        let (events, _) = run(WireKind::OpenAi, raw);
        assert_eq!(text_of(&events), "Hello");
        assert!(matches!(events.last(), Some(AgentEvent::Done { .. })));
    }

    #[test]
    fn openai_emits_done_exactly_once() {
        let raw = "data: {\"choices\":[{\"delta\":{\"content\":\"x\"},\"finish_reason\":\"stop\"}]}\n\ndata: [DONE]\n\n";
        let (events, _) = run(WireKind::OpenAi, raw);
        let dones = events
            .iter()
            .filter(|e| matches!(e, AgentEvent::Done { .. }))
            .count();
        assert_eq!(dones, 1);
        assert_eq!(
            events.last(),
            Some(&AgentEvent::Done {
                stop_reason: Some("stop".into())
            })
        );
    }

    #[test]
    fn reasoning_content_is_kept_apart_from_the_answer() {
        let raw = concat!(
            "data: {\"choices\":[{\"delta\":{\"reasoning_content\":\"think\"}}]}\n\n",
            "data: {\"choices\":[{\"delta\":{\"content\":\"answer\"}}]}\n\n",
            "data: [DONE]\n\n"
        );
        let (events, _) = run(WireKind::OpenAi, raw);
        assert_eq!(reasoning_of(&events), "think");
        assert_eq!(text_of(&events), "answer");
    }

    #[test]
    fn openai_usage_is_reported_when_the_provider_sends_it() {
        let raw = "data: {\"choices\":[],\"usage\":{\"prompt_tokens\":11,\"completion_tokens\":4}}\n\ndata: [DONE]\n\n";
        let (_, translator) = run(WireKind::OpenAi, raw);
        assert_eq!(
            translator.usage(),
            Usage {
                input: 11,
                output: 4
            }
        );
    }

    #[test]
    fn openai_tool_call_fragments_reassemble_into_one_document() {
        let raw = concat!(
            "data: {\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":0,\"id\":\"call_a\",\"function\":{\"name\":\"read_file\",\"arguments\":\"\"}}]}}]}\n\n",
            "data: {\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":0,\"function\":{\"arguments\":\"{\\\"pa\"}}]}}]}\n\n",
            "data: {\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":0,\"function\":{\"arguments\":\"th\\\":\\\"main.tex\\\"}\"}}]}}]}\n\n",
            "data: [DONE]\n\n"
        );
        let (events, translator) = run(WireKind::OpenAi, raw);
        assert_eq!(
            translator.tool_calls(),
            vec![ToolCall {
                id: "call_a".into(),
                name: "read_file".into(),
                arguments: "{\"path\":\"main.tex\"}".into(),
            }]
        );
        assert!(events.iter().any(|e| matches!(
            e,
            AgentEvent::ToolCallEnd { arguments, .. } if arguments == "{\"path\":\"main.tex\"}"
        )));
    }

    #[test]
    fn two_parallel_openai_tool_calls_stay_separate() {
        let raw = concat!(
            "data: {\"choices\":[{\"delta\":{\"tool_calls\":[",
            "{\"index\":0,\"id\":\"a\",\"function\":{\"name\":\"read_file\",\"arguments\":\"{\\\"x\"}},",
            "{\"index\":1,\"id\":\"b\",\"function\":{\"name\":\"list_files\",\"arguments\":\"{\\\"y\"}}",
            "]}}]}\n\n",
            "data: {\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":1,\"function\":{\"arguments\":\"\\\":2}\"}}]}}]}\n\n",
            "data: {\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":0,\"function\":{\"arguments\":\"\\\":1}\"}}]}}]}\n\n",
            "data: [DONE]\n\n"
        );
        let (_, translator) = run(WireKind::OpenAi, raw);
        let calls = translator.tool_calls();
        assert_eq!(calls.len(), 2);
        let by_name = |n: &str| {
            calls
                .iter()
                .find(|c| c.name == n)
                .unwrap()
                .arguments
                .clone()
        };
        assert_eq!(by_name("read_file"), "{\"x\":1}");
        assert_eq!(by_name("list_files"), "{\"y\":2}");
    }

    #[test]
    fn anthropic_text_and_thinking_split_by_delta_type() {
        let raw = concat!(
            "event: message_start\ndata: {\"type\":\"message_start\",\"message\":{\"usage\":{\"input_tokens\":9}}}\n\n",
            "event: content_block_delta\ndata: {\"index\":0,\"delta\":{\"type\":\"thinking_delta\",\"thinking\":\"hmm\"}}\n\n",
            "event: content_block_delta\ndata: {\"index\":0,\"delta\":{\"type\":\"text_delta\",\"text\":\"Hi \"}}\n\n",
            "event: content_block_delta\ndata: {\"index\":0,\"delta\":{\"type\":\"text_delta\",\"text\":\"there\"}}\n\n",
            "event: message_delta\ndata: {\"delta\":{\"stop_reason\":\"end_turn\"},\"usage\":{\"output_tokens\":6}}\n\n",
            "event: message_stop\ndata: {\"type\":\"message_stop\"}\n\n"
        );
        let (events, translator) = run(WireKind::Anthropic, raw);
        assert_eq!(text_of(&events), "Hi there");
        assert_eq!(reasoning_of(&events), "hmm");
        assert_eq!(
            translator.usage(),
            Usage {
                input: 9,
                output: 6
            }
        );
        assert_eq!(translator.stop_reason().as_deref(), Some("end_turn"));
    }

    #[test]
    fn anthropic_tool_use_blocks_reassemble() {
        let raw = concat!(
            "event: content_block_start\ndata: {\"index\":1,\"content_block\":{\"type\":\"tool_use\",\"id\":\"toolu_1\",\"name\":\"write_file\"}}\n\n",
            "event: content_block_delta\ndata: {\"index\":1,\"delta\":{\"type\":\"input_json_delta\",\"partial_json\":\"{\\\"path\\\"\"}}\n\n",
            "event: content_block_delta\ndata: {\"index\":1,\"delta\":{\"type\":\"input_json_delta\",\"partial_json\":\":\\\"a.tex\\\"}\"}}\n\n",
            "event: content_block_stop\ndata: {\"index\":1}\n\n",
            "event: message_stop\ndata: {\"type\":\"message_stop\"}\n\n"
        );
        let (_, translator) = run(WireKind::Anthropic, raw);
        assert_eq!(
            translator.tool_calls(),
            vec![ToolCall {
                id: "toolu_1".into(),
                name: "write_file".into(),
                arguments: "{\"path\":\"a.tex\"}".into(),
            }]
        );
    }

    #[test]
    fn a_text_content_block_stop_does_not_invent_a_tool_call() {
        let raw = concat!(
            "event: content_block_start\ndata: {\"index\":0,\"content_block\":{\"type\":\"text\",\"text\":\"\"}}\n\n",
            "event: content_block_delta\ndata: {\"index\":0,\"delta\":{\"type\":\"text_delta\",\"text\":\"hi\"}}\n\n",
            "event: content_block_stop\ndata: {\"index\":0}\n\n",
            "event: message_stop\ndata: {\"type\":\"message_stop\"}\n\n"
        );
        let (events, translator) = run(WireKind::Anthropic, raw);
        assert!(translator.tool_calls().is_empty());
        assert!(!events
            .iter()
            .any(|e| matches!(e, AgentEvent::ToolCallEnd { .. })));
    }

    #[test]
    fn anthropic_stream_errors_stop_the_turn() {
        let raw =
            "event: error\ndata: {\"type\":\"error\",\"error\":{\"message\":\"overloaded\"}}\n\n";
        let (events, _) = run(WireKind::Anthropic, raw);
        assert!(events.iter().any(|e| matches!(
            e,
            AgentEvent::Error { message, .. } if message == "overloaded"
        )));
        assert!(!events.iter().any(|e| matches!(e, AgentEvent::Done { .. })));
    }

    #[test]
    fn google_parts_stream_as_text() {
        let raw = concat!(
            "data: {\"candidates\":[{\"content\":{\"parts\":[{\"text\":\"Hel\"}]}}]}\n\n",
            "data: {\"candidates\":[{\"content\":{\"parts\":[{\"text\":\"lo\"}]},\"finishReason\":\"STOP\"}],\"usageMetadata\":{\"promptTokenCount\":3,\"candidatesTokenCount\":2}}\n\n"
        );
        let (events, translator) = run(WireKind::Google, raw);
        assert_eq!(text_of(&events), "Hello");
        assert_eq!(translator.stop_reason().as_deref(), Some("STOP"));
        assert_eq!(
            translator.usage(),
            Usage {
                input: 3,
                output: 2
            }
        );
    }

    #[test]
    fn google_function_calls_arrive_whole() {
        let raw = "data: {\"candidates\":[{\"content\":{\"parts\":[{\"functionCall\":{\"name\":\"read_file\",\"args\":{\"path\":\"main.tex\"}}}]}}]}\n\n";
        let (_, translator) = run(WireKind::Google, raw);
        let calls = translator.tool_calls();
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].name, "read_file");
        assert_eq!(
            serde_json::from_str::<Value>(&calls[0].arguments).unwrap()["path"],
            "main.tex"
        );
    }

    #[test]
    fn two_google_function_calls_get_distinct_ids() {
        let raw = "data: {\"candidates\":[{\"content\":{\"parts\":[{\"functionCall\":{\"name\":\"f\",\"args\":{}}},{\"functionCall\":{\"name\":\"f\",\"args\":{}}}]}}]}\n\n";
        let (_, translator) = run(WireKind::Google, raw);
        let calls = translator.tool_calls();
        assert_eq!(calls.len(), 2);
        assert_ne!(calls[0].id, calls[1].id);
    }

    #[test]
    fn a_truncated_stream_still_closes_its_open_tool_call() {
        let raw = "data: {\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":0,\"id\":\"a\",\"function\":{\"name\":\"read_file\",\"arguments\":\"{\\\"path\\\":\\\"x\\\"}\"}}]}}]}\n\n";
        let (events, translator) = run(WireKind::OpenAi, raw);
        assert_eq!(translator.tool_calls().len(), 1);
        assert!(events
            .iter()
            .any(|e| matches!(e, AgentEvent::ToolCallEnd { .. })));
        assert!(matches!(events.last(), Some(AgentEvent::Done { .. })));
    }

    #[test]
    fn unparsable_payloads_are_skipped_rather_than_failing_the_turn() {
        let raw = concat!(
            "data: not json\n\n",
            "data: {\"choices\":[{\"delta\":{\"content\":\"ok\"}}]}\n\n",
            "data: [DONE]\n\n"
        );
        let (events, _) = run(WireKind::OpenAi, raw);
        assert_eq!(text_of(&events), "ok");
    }

    #[test]
    fn stream_bodies_ask_for_streaming_and_usage_only_where_supported() {
        let req = CompletionRequest::prompt("s", "u");

        let catalog = Resolved {
            provider_id: "groq".into(),
            model_id: "m".into(),
            credential: "k".into(),
            auth: Some("k".into()),
            wire: Wire::OpenAiChat {
                base_url: "https://api.groq.com/openai/v1".into(),
                reasoning_content: false,
            },
        };
        let body = stream_body(&catalog, &req).unwrap();
        assert_eq!(body["stream"], true);
        assert_eq!(body["stream_options"]["include_usage"], true);

        let custom = Resolved {
            provider_id: "my-server".into(),
            ..catalog.clone()
        };
        let body = stream_body(&custom, &req).unwrap();
        assert_eq!(body["stream"], true);
        assert!(body.get("stream_options").is_none());
    }

    #[test]
    fn google_stream_body_carries_no_stream_flag() {
        let req = CompletionRequest::prompt("s", "u");
        let resolved = Resolved {
            provider_id: "google".into(),
            model_id: "gemini-2.5-pro".into(),
            credential: "k".into(),
            auth: Some("k".into()),
            wire: Wire::Google {
                base_url: crate::provider::GOOGLE_BASE.into(),
            },
        };
        let body = stream_body(&resolved, &req).unwrap();
        assert!(body.get("stream").is_none());
        assert!(body.get("contents").is_some());
    }
}
