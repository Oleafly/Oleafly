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
