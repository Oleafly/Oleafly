//! The turn loop: sampling with retries, tool-call batches, and the
//! context roll-over. A turn ends when the model returns no tool calls;
//! there is no fixed step cap beyond `RunConfig::max_steps`.

use std::time::Duration;

use crate::complete::{CompletionRequest, InputTokenSemantics, Usage};
use crate::error::Result;
use crate::event::AgentEvent;
use crate::message::{ContentPart, Message, Role};
use crate::provider::{Resolved, Wire};
use crate::run::{RunConfig, RunOutcome, SteeredInput, ToolOutput, ToolPipeline, ToolRunner};
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
    mut steer_rx: Option<tokio::sync::mpsc::UnboundedReceiver<SteeredInput>>,
    run_tool: ToolRunner,
    mut on_event: F,
) -> Result<RunOutcome>
where
    F: FnMut(AgentEvent) + Send,
{
    let mut request = request;
    let mut result = RunOutcome::default();
    let mut usage = TurnUsage::default();
    ensure_budget(
        client,
        resolved,
        &mut request,
        config,
        pipeline,
        &mut usage,
        &mut on_event,
    )
    .await?;
    let mut retries_remaining = config.max_retries.min(MAX_AGENT_RETRIES);

    let step_limit = config.max_steps.min(MAX_AGENT_STEPS);
    for step in 0..step_limit {
        on_event(AgentEvent::StepStart { step });
        let outcome = stream_step_with_compaction(
            client,
            resolved,
            &mut request,
            config,
            pipeline,
            &mut retries_remaining,
            &mut usage,
            &mut on_event,
        )
        .await;
        result.usage = usage.total;
        let outcome = match outcome {
            Ok(outcome) => outcome,
            Err(error) => {
                return Ok(finish_with_stream_error(result, error, &mut on_event));
            }
        };
        record_stream_outcome(&mut result, &outcome);
        let has_next_step = step.saturating_add(1) < step_limit;
        if outcome.tool_calls.is_empty() {
            if has_next_step {
                if let Some(rx) = steer_rx.as_mut() {
                    let steers = drain_steer(rx);
                    if !steers.is_empty() {
                        append_final_response(resolved, &mut request, &outcome)?;
                        let acknowledgements = append_steered_messages(&mut request, steers)?;
                        ensure_budget(
                            client,
                            resolved,
                            &mut request,
                            config,
                            pipeline,
                            &mut usage,
                            &mut on_event,
                        )
                        .await?;
                        acknowledge_steers(acknowledgements, &mut on_event);
                        continue;
                    }
                }
            }
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
        if !has_next_step {
            continue;
        }
        let steers = steer_rx.as_mut().map(drain_steer).unwrap_or_default();
        let acknowledgements = append_steered_messages(&mut request, steers)?;
        // The turn must continue, so an exhausted window rolls over into a
        // compacted context instead of failing.
        ensure_budget(
            client,
            resolved,
            &mut request,
            config,
            pipeline,
            &mut usage,
            &mut on_event,
        )
        .await?;
        acknowledge_steers(acknowledgements, &mut on_event);
    }

    result.usage = usage.total;
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
    usage: &mut TurnUsage,
    on_event: &mut F,
) -> Result<()>
where
    F: FnMut(AgentEvent),
{
    match HistoryBudget::new(request) {
        Ok(_) => Ok(()),
        Err(error) if config.auto_compact && is_history_limit(&error) => {
            let summary =
                compact_with_usage(client, resolved, request, &pipeline.token, usage, on_event)
                    .await;
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

/// Stream one step, and if the provider rejects the prompt for exceeding its
/// real context window, compact once and retry. This makes compaction fire on
/// the model's actual limit, not only the local safety caps, and turns a
/// provider context error into a recovery instead of a terminal failure.
#[allow(clippy::too_many_arguments)]
async fn stream_step_with_compaction<F>(
    client: &reqwest::Client,
    resolved: &Resolved,
    request: &mut CompletionRequest,
    config: &RunConfig,
    pipeline: &ToolPipeline,
    retries_remaining: &mut u32,
    usage: &mut TurnUsage,
    on_event: &mut F,
) -> Result<StreamOutcome>
where
    F: FnMut(AgentEvent) + Send,
{
    let first = stream_with_retries(
        client,
        resolved,
        request,
        config,
        retries_remaining,
        &pipeline.token,
        usage,
        on_event,
    )
    .await;
    match first {
        Err(error) if config.auto_compact && error.is_context_overflow() => {
            let summary = match compact_with_usage(
                client,
                resolved,
                request,
                &pipeline.token,
                usage,
                on_event,
            )
            .await
            {
                Ok(summary) => summary,
                Err(_) => return Err(error),
            };
            let dropped = compact::apply_compaction(request, summary);
            on_event(AgentEvent::Compacted {
                dropped_messages: u32::try_from(dropped).unwrap_or(u32::MAX),
                reason: "provider_context_overflow".to_string(),
            });
            stream_with_retries(
                client,
                resolved,
                request,
                config,
                retries_remaining,
                &pipeline.token,
                usage,
                on_event,
            )
            .await
        }
        other => other,
    }
}

#[allow(clippy::too_many_arguments)]
async fn stream_with_retries<F>(
    client: &reqwest::Client,
    resolved: &Resolved,
    request: &CompletionRequest,
    config: &RunConfig,
    retries_remaining: &mut u32,
    token: &crate::tasks::CancellationToken,
    usage: &mut TurnUsage,
    on_event: &mut F,
) -> Result<StreamOutcome>
where
    F: FnMut(AgentEvent) + Send,
{
    let mut attempt = 0;
    loop {
        let mut saw_output = false;
        let mut latest_usage = Usage::default();
        usage.preview(latest_usage, on_event);
        let streamed = {
            let forward = &mut |event: AgentEvent| {
                if matches!(
                    event,
                    AgentEvent::TextDelta { .. } | AgentEvent::ReasoningDelta { .. }
                ) {
                    saw_output = true;
                }
                if let AgentEvent::Usage { usage: observed } = event {
                    latest_usage = observed;
                    usage.preview(observed, on_event);
                } else {
                    on_event(event);
                }
            };
            tokio::select! {
                response = stream_completion(client, resolved, request, forward) => response,
                _ = token.cancelled() => Err(crate::error::AgentError::Cancelled),
            }
        };

        match streamed {
            Ok(outcome) => {
                usage.record(outcome.usage, on_event);
                return Ok(outcome);
            }
            Err(error) => {
                usage.record(latest_usage, on_event);
                if !should_retry(&error, *retries_remaining, saw_output) {
                    return Err(error);
                }
                *retries_remaining = retries_remaining.saturating_sub(1);
                on_event(AgentEvent::Retry {
                    attempt: attempt + 1,
                    max: config.max_retries.min(MAX_AGENT_RETRIES),
                });
                let delay = retry_delay(config.retry_base_ms, attempt, retry_jitter_basis_points());
                tokio::select! {
                    _ = tokio::time::sleep(delay) => {}
                    _ = token.cancelled() => return Err(crate::error::AgentError::Cancelled),
                }
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

#[derive(Default)]
struct TurnUsage {
    total: Usage,
    has_calls: bool,
}

impl TurnUsage {
    fn snapshot(&self, addition: Usage) -> Usage {
        let mut total = self.total;
        accumulate_usage(&mut total, addition, self.has_calls);
        total
    }

    fn preview(&self, addition: Usage, on_event: &mut impl FnMut(AgentEvent)) {
        on_event(AgentEvent::Usage {
            usage: self.snapshot(addition),
        });
    }

    fn record(&mut self, addition: Usage, on_event: &mut impl FnMut(AgentEvent)) {
        self.total = self.snapshot(addition);
        self.has_calls = true;
        on_event(AgentEvent::Usage { usage: self.total });
    }
}

async fn compact_with_usage<F>(
    client: &reqwest::Client,
    resolved: &Resolved,
    request: &CompletionRequest,
    token: &crate::tasks::CancellationToken,
    usage: &mut TurnUsage,
    on_event: &mut F,
) -> Result<String>
where
    F: FnMut(AgentEvent),
{
    usage.preview(Usage::default(), on_event);
    let response = compact::compact_history(client, resolved, request, token).await;
    usage.record(
        response
            .as_ref()
            .map(|(_, usage)| *usage)
            .unwrap_or_default(),
        on_event,
    );
    response.map(|(summary, _)| summary)
}

fn accumulate_usage(total: &mut Usage, addition: Usage, has_previous: bool) {
    if !has_previous {
        *total = addition;
        return;
    }
    total.input_known =
        Some(total.reported_input().is_some() && addition.reported_input().is_some());
    total.output_known =
        Some(total.reported_output().is_some() && addition.reported_output().is_some());
    total.input = total.input.saturating_add(addition.input);
    total.output = total.output.saturating_add(addition.output);
    total.cache_read = match (total.cache_read, addition.cache_read) {
        (Some(total), Some(addition)) => Some(total.saturating_add(addition)),
        _ => None,
    };
    total.cache_write = match (total.cache_write, addition.cache_write) {
        (Some(total), Some(addition)) => Some(total.saturating_add(addition)),
        _ => None,
    };
    if total.input_semantics != addition.input_semantics {
        total.input_semantics = InputTokenSemantics::Unknown;
    }
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

fn record_stream_outcome(result: &mut RunOutcome, outcome: &StreamOutcome) {
    result.steps = result.steps.saturating_add(1);
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
pub(crate) fn drain_steer(
    rx: &mut tokio::sync::mpsc::UnboundedReceiver<SteeredInput>,
) -> Vec<SteeredInput> {
    let mut drained = Vec::new();
    while let Ok(input) = rx.try_recv() {
        drained.push(input);
    }
    drained
}

fn append_final_response(
    resolved: &Resolved,
    request: &mut CompletionRequest,
    outcome: &StreamOutcome,
) -> Result<()> {
    let responses_input = if matches!(resolved.wire, Wire::OpenAiResponses { .. }) {
        Some(match &request.openai_responses_input {
            Some(input) => input.clone(),
            None => crate::wire::openai_responses_input(&request.messages)?,
        })
    } else {
        None
    };
    request.messages.push(assistant_turn(outcome));
    if let Some(mut input) = responses_input {
        if outcome.response_items.is_empty() {
            request.openai_responses_input = None;
        } else {
            input.extend(outcome.response_items.clone());
            request.openai_responses_input = Some(input);
        }
    }
    Ok(())
}

fn message_text(message: &Message) -> String {
    message
        .content
        .iter()
        .filter_map(|part| match part {
            ContentPart::Text { text } => Some(text.as_str()),
            _ => None,
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn append_steered_messages(
    request: &mut CompletionRequest,
    steers: Vec<SteeredInput>,
) -> Result<Vec<(String, tokio::sync::oneshot::Sender<()>)>> {
    let mut acknowledgements = Vec::with_capacity(steers.len());
    for steer in steers {
        if !steer.try_claim() {
            continue;
        }
        let text = message_text(&steer.message);
        append_steered_message(request, steer.message)?;
        acknowledgements.push((text, steer.delivered));
    }
    Ok(acknowledgements)
}

fn acknowledge_steers<F>(
    acknowledgements: Vec<(String, tokio::sync::oneshot::Sender<()>)>,
    on_event: &mut F,
) where
    F: FnMut(AgentEvent),
{
    for (text, delivered) in acknowledgements {
        on_event(AgentEvent::Steered { text });
        let _ = delivered.send(());
    }
}

fn append_steered_message(request: &mut CompletionRequest, message: Message) -> Result<()> {
    if let Some(responses_input) = request.openai_responses_input.as_mut() {
        let input = crate::wire::openai_responses_input(std::slice::from_ref(&message))?;
        responses_input.extend(input);
    }
    request.messages.push(message);
    Ok(())
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
    fn cumulative_presence_requires_every_step_to_report_each_counter() {
        let known = Usage {
            input: 10,
            output: 5,
            input_known: Some(true),
            output_known: Some(true),
            ..Usage::default()
        };
        for steps in [vec![Usage::default(), known], vec![known, Usage::default()]] {
            let mut total = TurnUsage::default();
            let mut events = Vec::new();
            for usage in steps {
                total.record(usage, &mut |event| events.push(event));
            }
            assert_eq!(total.total.reported_input(), None);
            assert_eq!(total.total.reported_output(), None);
            assert!(
                matches!(events.last(), Some(AgentEvent::Usage { usage }) if usage.reported_input().is_none() && usage.reported_output().is_none())
            );
        }
        for (input_known, output_known) in [(true, false), (false, true)] {
            let mut total = known;
            accumulate_usage(
                &mut total,
                Usage {
                    input_known: Some(input_known),
                    output_known: Some(output_known),
                    ..Usage::default()
                },
                true,
            );
            assert_eq!(total.reported_input(), input_known.then_some(10));
            assert_eq!(total.reported_output(), output_known.then_some(5));
        }
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
    fn steering_extends_an_existing_responses_input() {
        let mut request = CompletionRequest::prompt("system", "start");
        request.openai_responses_input =
            Some(crate::wire::openai_responses_input(&request.messages).unwrap());

        append_steered_message(
            &mut request,
            Message {
                role: Role::User,
                content: vec![
                    ContentPart::text("change direction"),
                    ContentPart::Image {
                        image: "data:image/png;base64,AA".into(),
                    },
                ],
            },
        )
        .unwrap();

        assert!(matches!(
            request.messages.last().unwrap().content.as_slice(),
            [ContentPart::Text { text }, ContentPart::Image { image }]
                if text == "change direction" && image == "data:image/png;base64,AA"
        ));
        let input = request.openai_responses_input.as_ref().unwrap();
        assert_eq!(input.len(), 2);
        assert_eq!(input[1]["type"], "message");
        assert_eq!(input[1]["role"], "user");
        assert_eq!(input[1]["content"][0]["type"], "input_text");
        assert_eq!(input[1]["content"][0]["text"], "change direction");
        assert_eq!(input[1]["content"][1]["type"], "input_image");
        assert_eq!(
            input[1]["content"][1]["image_url"],
            "data:image/png;base64,AA"
        );
    }

    #[tokio::test]
    async fn cancelled_steering_is_retracted_before_it_reaches_history() {
        let (handle, mut receiver) = crate::run::SteerHandle::channel();
        let steering =
            tokio::spawn(async move { handle.steer(Message::user("do not deliver")).await });
        let pending = receiver.recv().await.unwrap();
        steering.abort();
        let _ = steering.await;
        let mut request = CompletionRequest::prompt("system", "start");
        let message_count = request.messages.len();

        let acknowledgements = append_steered_messages(&mut request, vec![pending]).unwrap();

        assert!(acknowledgements.is_empty());
        assert_eq!(request.messages.len(), message_count);
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
            input_known: Some(true),
            output_known: Some(true),
            cache_read: Some(u32::MAX - 1),
            cache_write: Some(2),
            input_semantics: InputTokenSemantics::Inclusive,
        };
        accumulate_usage(
            &mut usage,
            Usage {
                input: 10,
                output: 1,
                input_known: Some(true),
                output_known: Some(true),
                cache_read: Some(10),
                cache_write: Some(3),
                input_semantics: InputTokenSemantics::Inclusive,
            },
            true,
        );

        assert_eq!(usage.input, u32::MAX);
        assert_eq!(usage.output, u32::MAX);
        assert_eq!(usage.cache_read, Some(u32::MAX));
        assert_eq!(usage.cache_write, Some(5));
    }
}
