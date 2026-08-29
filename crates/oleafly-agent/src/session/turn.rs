//! The turn loop: sampling with retries, tool-call batches, and the
//! context roll-over. A turn ends when the model returns no tool calls;
//! there is no fixed step cap beyond `RunConfig::max_steps`.

use std::time::Duration;

use crate::complete::{CompletionRequest, Usage};
use crate::error::Result;
use crate::event::AgentEvent;
use crate::message::{ContentPart, Message, Role};
use crate::provider::{Resolved, Wire};
use crate::run::{RunConfig, RunOutcome, ToolOutput, ToolPipeline, ToolRunner};
use crate::session::compact;
use crate::session::context_window::{is_history_limit, HistoryBudget};
use crate::stream::{stream_completion, StreamOutcome, ToolCall};

const MAX_RETRY_DELAY_MS: u64 = 60_000;
pub(crate) const MAX_AGENT_STEPS: u32 = 50;
pub(crate) const MAX_AGENT_RETRIES: u32 = 8;
pub(crate) const MAX_TOOL_EXECUTION_DURATION: Duration = Duration::from_secs(5 * 60);

#[allow(clippy::too_many_arguments)] // Turn plumbing; each arg is load-bearing.
pub(crate) async fn run_turn<F>(
    client: &reqwest::Client,
    resolved: &Resolved,
    request: CompletionRequest,
    config: &RunConfig,
    pipeline: &ToolPipeline,
    mut steer_rx: Option<tokio::sync::mpsc::UnboundedReceiver<String>>,
    run_tool: ToolRunner,
    mut on_event: F,
) -> Result<RunOutcome>
where
    F: FnMut(AgentEvent) + Send,
{
    let mut request = request;
    let mut result = RunOutcome::default();
    ensure_budget(
        client,
        resolved,
        &mut request,
        config,
        pipeline,
        &mut on_event,
    )
    .await?;
    let mut retries_remaining = config.max_retries.min(MAX_AGENT_RETRIES);

    for step in 0..config.max_steps.min(MAX_AGENT_STEPS) {
        on_event(AgentEvent::StepStart { step });
        let outcome = stream_with_retries(
            client,
            resolved,
            &request,
            config,
            &mut retries_remaining,
            &mut on_event,
        )
        .await;
        let outcome = match outcome {
            Ok(outcome) => outcome,
            Err(error) => return Ok(finish_with_stream_error(result, error, &mut on_event)),
        };
        record_stream_outcome(&mut result, &outcome, &mut on_event);
        if outcome.tool_calls.is_empty() {
            return Ok(finish_without_tools(result, &outcome));
        }
        append_tool_turns(
            resolved,
            &mut request,
            outcome,
            pipeline,
            &run_tool,
            &mut on_event,
        )
        .await?;
        // The turn must continue, so an exhausted window rolls over into a
        // compacted context instead of failing.
        ensure_budget(
            client,
            resolved,
            &mut request,
            config,
            pipeline,
            &mut on_event,
        )
        .await?;
        // Message boundary: deliver any steered input before sampling again.
        if let Some(rx) = steer_rx.as_mut() {
            for text in drain_steer(rx) {
                request
                    .messages
                    .push(crate::message::Message::user(text.clone()));
                on_event(AgentEvent::Steered { text });
            }
        }
    }

    result.stopped_at_cap = true;
    Ok(result)
}

/// Validate the request against the context window; on a limit error,
/// compact once and re-validate. Compaction failure surfaces the original
/// limit error (the hard caps still abort).
async fn ensure_budget<F>(
    client: &reqwest::Client,
    resolved: &Resolved,
    request: &mut CompletionRequest,
    config: &RunConfig,
    pipeline: &ToolPipeline,
    on_event: &mut F,
) -> Result<()>
where
    F: FnMut(AgentEvent),
{
    match HistoryBudget::new(request) {
        Ok(_) => Ok(()),
        Err(error) if config.auto_compact && is_history_limit(&error) => {
            let summary =
                compact::compact_history(client, resolved, request, &pipeline.token).await;
            match summary {
                Ok(summary) => {
                    let dropped = compact::apply_compaction(request, summary);
                    on_event(AgentEvent::Compacted {
                        dropped_messages: u32::try_from(dropped).unwrap_or(u32::MAX),
                        reason: "context_limit".to_string(),
                    });
                    HistoryBudget::new(request).map(|_| ())
                }
                Err(_) => Err(error),
            }
        }
        Err(error) => Err(error),
    }
}

async fn stream_with_retries<F>(
    client: &reqwest::Client,
    resolved: &Resolved,
    request: &CompletionRequest,
    config: &RunConfig,
    retries_remaining: &mut u32,
    on_event: &mut F,
) -> Result<StreamOutcome>
where
    F: FnMut(AgentEvent) + Send,
{
    let mut attempt = 0;
    loop {
        let mut saw_output = false;
        let streamed = {
            let forward = &mut |event: AgentEvent| {
                if matches!(
                    event,
                    AgentEvent::TextDelta { .. } | AgentEvent::ReasoningDelta { .. }
                ) {
                    saw_output = true;
                }
                on_event(event);
            };
            stream_completion(client, resolved, request, forward).await
        };

        match streamed {
            Ok(outcome) => return Ok(outcome),
            Err(error) => {
                if !should_retry(&error, *retries_remaining, saw_output) {
                    return Err(error);
                }
                *retries_remaining = retries_remaining.saturating_sub(1);
                on_event(AgentEvent::Retry {
                    attempt: attempt + 1,
                    max: config.max_retries.min(MAX_AGENT_RETRIES),
                });
                tokio::time::sleep(retry_delay(
                    config.retry_base_ms,
                    attempt,
                    retry_jitter_basis_points(),
                ))
                .await;
                attempt = attempt.saturating_add(1);
            }
        }
    }
}

pub(crate) async fn append_tool_turns<F>(
    resolved: &Resolved,
    request: &mut CompletionRequest,
    outcome: StreamOutcome,
    pipeline: &ToolPipeline,
    run_tool: &ToolRunner,
    on_event: &mut F,
) -> Result<()>
where
    F: FnMut(AgentEvent) + Send,
{
    let mut responses_input = if matches!(resolved.wire, Wire::OpenAiResponses { .. }) {
        Some(match &request.openai_responses_input {
            Some(input) => input.clone(),
            None => crate::wire::openai_responses_input(&request.messages)?,
        })
    } else {
        None
    };
    let assistant = assistant_turn(&outcome);
    request.messages.push(assistant);
    let results = crate::tools::parallel::run_tool_calls(
        outcome.tool_calls,
        &pipeline.registry,
        &pipeline.gate,
        run_tool,
        MAX_TOOL_EXECUTION_DURATION,
        pipeline.token.clone(),
        on_event,
    )
    .await?;
    let results = results_turn(results);
    if let Some(input) = &mut responses_input {
        input.extend(outcome.response_items);
        input.extend(crate::wire::openai_responses_input(std::slice::from_ref(
            &results,
        ))?);
        request.openai_responses_input = responses_input;
    }
    request.messages.push(results);
    Ok(())
}

pub(crate) fn assistant_turn(outcome: &StreamOutcome) -> Message {
    let mut content = Vec::new();
    if !outcome.text.is_empty() {
        content.push(ContentPart::text(outcome.text.clone()));
    }
    for call in &outcome.tool_calls {
        content.push(ContentPart::ToolUse {
            id: call.id.clone(),
            name: call.name.clone(),
            arguments: call.arguments.clone(),
            thought_signature: call.thought_signature.clone(),
        });
    }
    Message {
        role: Role::Assistant,
        content,
    }
}

pub(crate) fn results_turn(results: Vec<(ToolCall, ToolOutput)>) -> Message {
    let mut content = Vec::new();
    let mut images = Vec::new();
    for (call, output) in results {
        content.push(ContentPart::ToolResult {
            id: call.id,
            name: call.name,
            output: output.output,
        });
        images.extend(output.images);
    }
    for image in images {
        content.push(ContentPart::Image { image });
    }
    Message {
        role: Role::User,
        content,
    }
}

fn empty(outcome: &StreamOutcome) -> bool {
    outcome.text.is_empty() && outcome.tool_calls.is_empty()
}

fn accumulate_usage(total: &mut Usage, addition: Usage) {
    total.input = total.input.saturating_add(addition.input);
    total.output = total.output.saturating_add(addition.output);
}

fn should_retry(
    error: &crate::error::AgentError,
    retries_remaining: u32,
    saw_output: bool,
) -> bool {
    error.retryable() && retries_remaining > 0 && !saw_output
}

fn retry_delay(base_ms: u64, attempt: u32, jitter_basis_points: u16) -> Duration {
    let multiplier = 1u64.checked_shl(attempt.min(16)).unwrap_or(u64::MAX);
    let delay = base_ms.saturating_mul(multiplier).min(MAX_RETRY_DELAY_MS);
    let jitter = u64::from(jitter_basis_points.clamp(750, 1_250));
    Duration::from_millis(
        delay
            .saturating_mul(jitter)
            .saturating_div(1_000)
            .min(MAX_RETRY_DELAY_MS),
    )
}

fn retry_jitter_basis_points() -> u16 {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |duration| duration.subsec_nanos());
    750 + (nanos % 501) as u16
}

fn finish_with_stream_error<F>(
    mut result: RunOutcome,
    error: crate::error::AgentError,
    on_event: &mut F,
) -> RunOutcome
where
    F: FnMut(AgentEvent),
{
    result.error = Some(error.to_string());
    on_event(AgentEvent::Error {
        message: error.to_string(),
        retryable: error.retryable(),
    });
    result
}

fn record_stream_outcome<F>(result: &mut RunOutcome, outcome: &StreamOutcome, on_event: &mut F)
where
    F: FnMut(AgentEvent),
{
    accumulate_usage(&mut result.usage, outcome.usage);
    result.steps = result.steps.saturating_add(1);
    on_event(AgentEvent::Usage {
        usage: result.usage,
    });
    if !outcome.text.is_empty() {
        result.text.clone_from(&outcome.text);
    }
}

fn finish_without_tools(mut result: RunOutcome, outcome: &StreamOutcome) -> RunOutcome {
    if empty(outcome) {
        result.error = Some("The model returned nothing.".into());
    }
    result
}

/// Take every pending steer message without waiting (delivery happens at
/// the next message boundary, never mid-sampling).
pub(crate) fn drain_steer(rx: &mut tokio::sync::mpsc::UnboundedReceiver<String>) -> Vec<String> {
    let mut drained = Vec::new();
    while let Ok(text) = rx.try_recv() {
        drained.push(text);
    }
    drained
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::provider::OPENAI_BASE;
    use crate::stream::ToolCall;
    use serde_json::json;
    use std::sync::Arc;

    fn default_pipeline() -> ToolPipeline {
        ToolPipeline::default()
    }

    #[test]
    fn an_assistant_turn_carries_text_then_every_call() {
        let outcome = StreamOutcome {
            text: "Reading".into(),
            tool_calls: vec![
                ToolCall {
                    id: "a".into(),
                    name: "read_file".into(),
                    arguments: "{}".into(),
                    thought_signature: Some("sig-a".into()),
                },
                ToolCall {
                    id: "b".into(),
                    name: "list_files".into(),
                    arguments: "{}".into(),
                    ..Default::default()
                },
            ],
            ..Default::default()
        };
        let message = assistant_turn(&outcome);
        assert_eq!(message.role, Role::Assistant);
        assert!(matches!(message.content[0], ContentPart::Text { .. }));
        assert!(matches!(
            message.content[1],
            ContentPart::ToolUse { ref id, ref thought_signature, .. }
                if id == "a" && thought_signature.as_deref() == Some("sig-a")
        ));
        assert!(matches!(
            message.content[2],
            ContentPart::ToolUse { ref id, ref thought_signature, .. }
                if id == "b" && thought_signature.is_none()
        ));
    }

    #[tokio::test]
    async fn responses_tool_turns_replay_provider_items_and_local_outputs_statelessly() {
        let resolved = Resolved {
            provider_id: "openai".into(),
            model_id: "arbitrary-compatible-model".into(),
            credential: "key".into(),
            auth: Some("key".into()),
            wire: Wire::OpenAiResponses {
                base_url: OPENAI_BASE.into(),
            },
        };
        let mut request = CompletionRequest::prompt("system", "read the file");
        let outcome = StreamOutcome {
            tool_calls: vec![ToolCall {
                id: "call_1".into(),
                name: "read_file".into(),
                arguments: "{}".into(),
                ..Default::default()
            }],
            response_items: vec![
                json!({
                    "type": "reasoning",
                    "id": "rs_1",
                    "encrypted_content": "opaque",
                }),
                json!({
                    "type": "function_call",
                    "id": "fc_1",
                    "call_id": "call_1",
                    "name": "read_file",
                    "arguments": "{}",
                }),
            ],
            ..Default::default()
        };
        let runner: ToolRunner = Arc::new(|_| Box::pin(async { ToolOutput::text("contents") }));
        let mut events = Vec::new();

        append_tool_turns(
            &resolved,
            &mut request,
            outcome,
            &default_pipeline(),
            &runner,
            &mut |event| events.push(event),
        )
        .await
        .unwrap();

        let input = request.openai_responses_input.unwrap();
        assert_eq!(input[0]["type"], "message");
        assert_eq!(input[1]["type"], "reasoning");
        assert_eq!(input[1]["encrypted_content"], "opaque");
        assert_eq!(input[2]["type"], "function_call");
        assert_eq!(input[3]["type"], "function_call_output");
        assert_eq!(input[3]["call_id"], "call_1");
        assert_eq!(input[3]["output"], "contents");
        assert!(events
            .iter()
            .any(|event| matches!(event, AgentEvent::ToolOutcome { id, .. } if id == "call_1")));
    }

    #[test]
    fn a_tool_only_turn_carries_no_empty_text_part() {
        let outcome = StreamOutcome {
            tool_calls: vec![ToolCall {
                id: "a".into(),
                name: "n".into(),
                arguments: "{}".into(),
                ..Default::default()
            }],
            ..Default::default()
        };
        let message = assistant_turn(&outcome);
        assert_eq!(message.content.len(), 1);
        assert!(matches!(message.content[0], ContentPart::ToolUse { .. }));
    }

    #[test]
    fn tool_images_follow_every_result_in_the_same_turn() {
        let message = results_turn(vec![
            (
                ToolCall {
                    id: "a".into(),
                    name: "verify_pdf_pages".into(),
                    arguments: "{}".into(),
                    ..Default::default()
                },
                ToolOutput {
                    output: "checked".into(),
                    images: vec!["data:image/png;base64,AA".into()],
                },
            ),
            (
                ToolCall {
                    id: "b".into(),
                    name: "read_file".into(),
                    arguments: "{}".into(),
                    ..Default::default()
                },
                ToolOutput::text("body"),
            ),
        ]);
        assert_eq!(message.role, Role::User);
        assert!(matches!(message.content[0], ContentPart::ToolResult { .. }));
        assert!(matches!(message.content[1], ContentPart::ToolResult { .. }));
        assert!(matches!(message.content[2], ContentPart::Image { .. }));
    }

    #[test]
    fn a_turn_with_text_and_no_calls_is_not_empty() {
        let outcome = StreamOutcome {
            text: "done".into(),
            ..Default::default()
        };
        assert!(!empty(&outcome));

        let outcome = StreamOutcome {
            tool_calls: vec![ToolCall::default()],
            ..Default::default()
        };
        assert!(!empty(&outcome));

        assert!(empty(&StreamOutcome::default()));
    }

    #[test]
    fn the_default_budget_matches_the_typescript_loop_it_replaced() {
        let config = RunConfig::default();
        assert_eq!(config.max_steps, 50);
        assert_eq!(config.max_retries, 4);
        assert_eq!(config.retry_base_ms, 800);
        assert!(config.auto_compact);
    }

    #[test]
    fn a_retryable_error_is_retried_only_before_any_output_streamed() {
        let error = crate::error::AgentError::Transport("connection reset".into());
        assert!(should_retry(&error, 4, false));
        assert!(!should_retry(&error, 4, true));
        assert!(!should_retry(&error, 0, false));

        let fatal = crate::error::AgentError::Provider {
            status: 401,
            message: "bad key".into(),
        };
        assert!(!should_retry(&fatal, 4, false));
    }

    #[test]
    fn retry_delay_uses_exponential_backoff_and_bounded_jitter() {
        assert_eq!(retry_delay(800, 3, 1_000), Duration::from_millis(6_400));
        assert_eq!(retry_delay(800, 0, 750), Duration::from_millis(600));
        assert_eq!(retry_delay(800, 0, 1_250), Duration::from_millis(1_000));
    }

    #[test]
    fn retry_delay_saturates_without_overflowing() {
        assert_eq!(
            retry_delay(u64::MAX, u32::MAX, 1_250),
            Duration::from_millis(MAX_RETRY_DELAY_MS)
        );
    }

    #[test]
    fn cumulative_usage_saturates_instead_of_wrapping() {
        let mut usage = Usage {
            input: u32::MAX - 1,
            output: u32::MAX,
        };
        accumulate_usage(
            &mut usage,
            Usage {
                input: 10,
                output: 1,
            },
        );

        assert_eq!(usage.input, u32::MAX);
        assert_eq!(usage.output, u32::MAX);
    }
}
