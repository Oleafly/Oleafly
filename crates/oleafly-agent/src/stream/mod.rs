use std::time::Duration;

use futures_util::StreamExt;
use serde_json::Value;

use crate::complete::{
    anthropic_body, google_body, openai_body, read_provider_error, request_error,
    CompletionRequest, Usage,
};
use crate::error::{AgentError, Result};
use crate::event::AgentEvent;
use crate::provider::{catalog_entry, Resolved, Wire};
use crate::sse::{SseDecoder, SseEvent};

const DEFAULT_STREAM_IDLE_TIMEOUT: Duration = Duration::from_secs(120);
/// A stream may run for a long agent turn, but never indefinitely.
const MAX_STREAM_DURATION: Duration = Duration::from_secs(10 * 60);
/// Raw provider bytes and combined visible/reasoning output remain bounded.
const MAX_STREAM_BYTES: usize = 32 * 1024 * 1024;
/// Tool JSON can be substantial for document edits without needing the full stream budget.
const MAX_TOOL_ARGUMENT_BYTES: usize = 8 * 1024 * 1024;
/// Bound provider-controlled tool-call bookkeeping before the agent loop sees it.
pub(crate) const MAX_STREAM_TOOL_CALLS: usize = 32;

mod translate;

pub use translate::{Translator, WireKind};

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

#[derive(Debug, Default)]
struct IncrementalUtf8Decoder {
    pending: Vec<u8>,
}

impl IncrementalUtf8Decoder {
    fn push(&mut self, bytes: &[u8]) -> Result<String> {
        self.pending.extend_from_slice(bytes);
        match std::str::from_utf8(&self.pending) {
            Ok(_) => Ok(String::from_utf8(std::mem::take(&mut self.pending))
                .expect("bytes validated as UTF-8")),
            Err(error) if error.error_len().is_none() => {
                let incomplete = self.pending.split_off(error.valid_up_to());
                let valid = std::mem::replace(&mut self.pending, incomplete);
                Ok(String::from_utf8(valid).expect("UTF-8 error valid prefix is valid"))
            }
            Err(_) => Err(AgentError::Decode(
                "provider stream contained invalid UTF-8".into(),
            )),
        }
    }

    fn finish(self) -> Result<()> {
        if self.pending.is_empty() {
            Ok(())
        } else {
            Err(AgentError::Decode(
                "provider stream ended in the middle of a UTF-8 code point".into(),
            ))
        }
    }
}

struct StreamBudget {
    raw_bytes: usize,
    output_bytes: usize,
    tool_argument_bytes: usize,
    max_raw_bytes: usize,
    max_output_bytes: usize,
    max_tool_argument_bytes: usize,
}

impl Default for StreamBudget {
    fn default() -> Self {
        Self {
            raw_bytes: 0,
            output_bytes: 0,
            tool_argument_bytes: 0,
            max_raw_bytes: MAX_STREAM_BYTES,
            max_output_bytes: MAX_STREAM_BYTES,
            max_tool_argument_bytes: MAX_TOOL_ARGUMENT_BYTES,
        }
    }
}

impl StreamBudget {
    #[cfg(test)]
    fn with_limits(
        max_raw_bytes: usize,
        max_output_bytes: usize,
        max_tool_argument_bytes: usize,
    ) -> Self {
        Self {
            max_raw_bytes,
            max_output_bytes,
            max_tool_argument_bytes,
            ..Self::default()
        }
    }

    fn add_raw(&mut self, bytes: usize) -> Result<()> {
        Self::add(
            &mut self.raw_bytes,
            bytes,
            self.max_raw_bytes,
            "provider stream",
        )
    }

    fn observe(&mut self, event: &AgentEvent) -> Result<()> {
        match event {
            AgentEvent::TextDelta { text } | AgentEvent::ReasoningDelta { text } => Self::add(
                &mut self.output_bytes,
                text.len(),
                self.max_output_bytes,
                "stream output",
            ),
            AgentEvent::ToolCallArgsDelta { json, .. } => Self::add(
                &mut self.tool_argument_bytes,
                json.len(),
                self.max_tool_argument_bytes,
                "streamed tool arguments",
            ),
            _ => Ok(()),
        }
    }

    fn add(total: &mut usize, bytes: usize, limit: usize, description: &str) -> Result<()> {
        let next = total.checked_add(bytes).ok_or_else(|| {
            AgentError::Decode(format!(
                "{description} exceeded the {limit}-byte safety limit"
            ))
        })?;
        if next > limit {
            return Err(AgentError::Decode(format!(
                "{description} exceeded the {limit}-byte safety limit"
            )));
        }
        *total = next;
        Ok(())
    }
}

fn stream_deadline(req: &CompletionRequest) -> Duration {
    req.timeout_ms
        .map(Duration::from_millis)
        .unwrap_or(MAX_STREAM_DURATION)
        .min(MAX_STREAM_DURATION)
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
    on_event: F,
) -> Result<StreamOutcome>
where
    F: FnMut(AgentEvent),
{
    crate::run::validate_completion_request(req)?;
    tokio::time::timeout(
        stream_deadline(req),
        stream_completion_inner(client, resolved, req, on_event),
    )
    .await
    .map_err(|_| AgentError::Timeout)?
}

async fn stream_completion_inner<F>(
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
    let mut utf8 = IncrementalUtf8Decoder::default();
    let mut decoder = SseDecoder::new();
    let mut outcome = StreamOutcome::default();
    let mut budget = StreamBudget::default();
    let mut stream = response.bytes_stream();

    while let Some(chunk) = tokio::time::timeout(idle, stream.next())
        .await
        .map_err(|_| AgentError::Timeout)?
    {
        let bytes = chunk.map_err(request_error)?;
        budget.add_raw(bytes.len())?;
        let text = utf8.push(&bytes)?;
        translate_batch(
            &mut translator,
            decoder.push(&text)?,
            &mut outcome,
            &mut budget,
            &mut on_event,
        )?;
        if translator.error().is_some() {
            break;
        }
    }
    if translator.error().is_none() {
        utf8.finish()?;
        let tail: Vec<SseEvent> = decoder.finish()?.into_iter().collect();
        translate_batch(
            &mut translator,
            tail,
            &mut outcome,
            &mut budget,
            &mut on_event,
        )?;
    }
    finalize(translator, outcome, &mut budget, &mut on_event)
}

fn finalize<F: FnMut(AgentEvent)>(
    mut translator: Translator,
    mut outcome: StreamOutcome,
    budget: &mut StreamBudget,
    on_event: &mut F,
) -> Result<StreamOutcome> {
    if let Some(error) = translator.take_error() {
        return Err(error);
    }
    for agent_event in translator.finish() {
        budget.observe(&agent_event)?;
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
        return Err(read_provider_error(response, status, "stream error response body").await);
    }
    Ok(response)
}

fn translate_batch<F: FnMut(AgentEvent)>(
    translator: &mut Translator,
    events: Vec<SseEvent>,
    outcome: &mut StreamOutcome,
    budget: &mut StreamBudget,
    on_event: &mut F,
) -> Result<()> {
    for event in events {
        for agent_event in translator.translate(&event) {
            budget.observe(&agent_event)?;
            accumulate(outcome, &agent_event);
            on_event(agent_event);
        }
    }
    Ok(())
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
