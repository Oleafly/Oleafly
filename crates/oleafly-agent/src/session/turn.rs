//! The turn loop: sampling with retries, tool-call batches, and the
//! context roll-over. A turn ends when the model returns no tool calls;
//! there is no fixed step cap beyond `RunConfig::max_steps`.

use std::sync::Arc;
use std::time::Duration;

use crate::complete::{CompletionRequest, InputTokenSemantics, Usage};
use crate::error::{AgentError, Result};
use crate::event::AgentEvent;
use crate::message::{ContentPart, Message, ProviderWire, Role};
use crate::provider::{Resolved, Wire};
use crate::run::{RunConfig, RunOutcome, SteeredInput, ToolOutput, ToolPipeline, ToolRunner};
use crate::session::compact;
use crate::session::context_window::{is_history_limit, HistoryBudget};
use crate::stream::{
    is_output_limit_stop, is_refusal_stop, stream_completion, AssistantBlock, StreamOutcome,
    ToolCall, MAX_TOOL_CALLS_PER_TURN,
};

const MAX_RETRY_DELAY_MS: u64 = 60_000;
/// The longest a provider's `Retry-After` is honoured for, so a rate limit
/// that names a long wait does not hold a run for minutes it did not budget.
const MAX_RETRY_AFTER: Duration = Duration::from_secs(120);
/// The same for a long run (a research task), which can afford to wait.
const MAX_LONG_RUN_RETRY_AFTER: Duration = Duration::from_secs(10 * 60);
/// Retries a whole run may spend, however many requests it makes. A request
/// has its own, smaller allowance (`RunConfig::max_retries`); this bounds a
/// provider that keeps failing once a request has used its own.
const MAX_RUN_RETRIES: u32 = 32;
const MAX_LONG_RUN_RETRIES: u32 = 500;
pub(crate) const MAX_AGENT_STEPS: u32 = 50;
pub(crate) const MAX_AGENT_RETRIES: u32 = 8;
pub(crate) const MAX_TOOL_EXECUTION_DURATION: Duration = Duration::from_secs(5 * 60);
/// Consecutive `pause_turn` replies a run continues before it stops.
pub(crate) const MAX_PAUSE_CONTINUATIONS: u32 = 5;

const OUTPUT_LIMITED_CALL: &str = "This tool call was cut off because the reply reached the output limit, so it did not run. Send it again with shorter arguments, or split the work into smaller steps.";
const TOO_MANY_CALLS: &str = "This reply sent more tool calls than one turn runs, so this call did not run. Send it again in your next reply.";
const INVALID_ARGUMENTS: &str = "The tool arguments were not valid JSON, so the tool did not run. Send the call again with valid JSON arguments.";

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
    let mut ledger = TurnLedger {
        usage: TurnUsage {
            context_window: resolved.caps.context_window,
            ..TurnUsage::default()
        },
        retries: RetryBudget::new(config),
    };
    let mut pauses = 0u32;
    let mut continuing = false;
    ensure_budget(
        client,
        resolved,
        &mut request,
        config,
        pipeline,
        &mut ledger,
        &mut on_event,
    )
    .await?;

    let step_limit = if config.allow_long_runs {
        config.max_steps
    } else {
        config.max_steps.min(MAX_AGENT_STEPS)
    };
    for step in 0..step_limit {
        // 0.4.8 L: a suspend request ends the run between steps and hands
        // back the whole conversation, so another process can continue it.
        if pipeline
            .suspend
            .as_ref()
            .is_some_and(crate::tasks::CancellationToken::is_cancelled)
        {
            result.usage = ledger.usage.total;
            result.suspended = true;
            result.history = request.messages;
            return Ok(result);
        }
        on_event(AgentEvent::StepStart { step });
        let outcome = stream_step_with_compaction(
            client,
            resolved,
            &mut request,
            config,
            pipeline,
            &mut ledger,
            &mut on_event,
        )
        .await;
        result.usage = ledger.usage.total;
        let outcome = match outcome {
            Ok(outcome) => outcome,
            Err(error) => {
                let mut result = finish_with_stream_error(result, error, &mut on_event);
                result.history = request.messages;
                return Ok(result);
            }
        };
        record_stream_outcome(&mut result, &outcome, continuing);
        continuing = false;
        if let Some(container) = &outcome.container {
            request.anthropic_container = Some(container.clone());
        }
        let has_next_step = step.saturating_add(1) < step_limit;
        if outcome.tool_calls.is_empty()
            && outcome.stop_reason.as_deref() == Some("pause_turn")
            && has_next_step
            && pauses < MAX_PAUSE_CONTINUATIONS
        {
            // The provider paused a long server-tool turn; send it back as
            // is and let the model carry on, with no new user message.
            pauses += 1;
            continuing = true;
            append_final_response(resolved, &mut request, &outcome)?;
            continue;
        }
        pauses = 0;
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
                            &mut ledger,
                            &mut on_event,
                        )
                        .await?;
                        acknowledge_steers(acknowledgements, &mut on_event);
                        continue;
                    }
                }
            }
            let mut result = finish_without_tools(result, &outcome);
            result.history = request.messages;
            result.history.push(assistant_message(&outcome));
            return Ok(result);
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
            &mut ledger,
            &mut on_event,
        )
        .await?;
        acknowledge_steers(acknowledgements, &mut on_event);
    }

    result.usage = ledger.usage.total;
    result.stopped_at_cap = true;
    result.history = request.messages;
    Ok(result)
}

/// Validate the request against the context window; on a limit error,
/// compact once and re-validate. When compaction fails, the original limit
/// error surfaces (the hard caps still abort) with the reason it failed.
async fn ensure_budget<F>(
    client: &reqwest::Client,
    resolved: &Resolved,
    request: &mut CompletionRequest,
    config: &RunConfig,
    pipeline: &ToolPipeline,
    ledger: &mut TurnLedger,
    on_event: &mut F,
) -> Result<()>
where
    F: FnMut(AgentEvent),
{
    match HistoryBudget::new(request) {
        Ok(_) => Ok(()),
        Err(error) if config.auto_compact && is_history_limit(&error) => {
            let summary =
                compact_with_usage(client, resolved, request, &pipeline.token, ledger, on_event)
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
                Err(failure) => Err(compaction_failure(error, failure)),
            }
        }
        Err(error) => Err(error),
    }
}

/// What a failed compaction reports: an interrupt stays an interrupt, and
/// anything else is the limit that made compaction necessary, followed by
/// why the summary could not be made, so the run does not end on a limit
/// message alone.
fn compaction_failure(limit: AgentError, failure: AgentError) -> AgentError {
    match (&limit, failure) {
        (_, AgentError::Cancelled) => AgentError::Cancelled,
        (AgentError::Decode(message), failure) => AgentError::Decode(format!(
            "{message}. Summarizing the conversation to make room failed: {failure}"
        )),
        (_, _) => limit,
    }
}

/// Stream one step, and if the provider rejects the prompt for exceeding its
/// real context window, compact once and retry. This makes compaction fire on
/// the model's actual limit, not only the local safety caps, and turns a
/// provider context error into a recovery instead of a terminal failure.
async fn stream_step_with_compaction<F>(
    client: &reqwest::Client,
    resolved: &Resolved,
    request: &mut CompletionRequest,
    config: &RunConfig,
    pipeline: &ToolPipeline,
    ledger: &mut TurnLedger,
    on_event: &mut F,
) -> Result<StreamOutcome>
where
    F: FnMut(AgentEvent) + Send,
{
    let first =
        stream_with_retries(client, resolved, request, &pipeline.token, ledger, on_event).await;
    match first {
        Err(error) if config.auto_compact && error.is_context_overflow() => {
            let summary = match compact_with_usage(
                client,
                resolved,
                request,
                &pipeline.token,
                ledger,
                on_event,
            )
            .await
            {
                Ok(summary) => summary,
                Err(AgentError::Cancelled) => return Err(AgentError::Cancelled),
                Err(_) => return Err(error),
            };
            let dropped = compact::apply_compaction(request, summary);
            on_event(AgentEvent::Compacted {
                dropped_messages: u32::try_from(dropped).unwrap_or(u32::MAX),
                reason: "provider_context_overflow".to_string(),
            });
            stream_with_retries(client, resolved, request, &pipeline.token, ledger, on_event).await
        }
        other => other,
    }
}

/// The retries a run may spend. Every request starts with the same small
/// allowance (a transient error does not eat into the next step's), and the
/// run as a whole has a larger total, so a provider that keeps failing still
/// ends the run.
struct RetryBudget {
    per_request: u32,
    total: u32,
    base_ms: u64,
    long_run: bool,
}

impl RetryBudget {
    fn new(config: &RunConfig) -> Self {
        let asked = config.max_retries;
        let long_run = config.allow_long_runs;
        RetryBudget {
            per_request: if long_run && asked > 0 {
                MAX_AGENT_RETRIES
            } else {
                asked.min(MAX_AGENT_RETRIES)
            },
            total: match (asked, long_run) {
                (0, _) => 0,
                (_, true) => MAX_LONG_RUN_RETRIES,
                (_, false) => MAX_RUN_RETRIES,
            },
            base_ms: config.retry_base_ms,
            long_run,
        }
    }

    /// The retries one request may use now.
    fn request_allowance(&self) -> u32 {
        self.per_request.min(self.total)
    }

    fn spend(&mut self) {
        self.total = self.total.saturating_sub(1);
    }

    /// How long to wait before attempt `attempt + 1` after `error`: the
    /// backoff, or what the provider asked for when that is longer.
    fn wait(&self, error: &AgentError, attempt: u32) -> Duration {
        let backoff = retry_delay(self.base_ms, attempt, retry_jitter_basis_points());
        retry_wait(error, backoff, self.long_run)
    }
}

/// The run's accounting: what it has used and what it may still retry.
struct TurnLedger {
    usage: TurnUsage,
    retries: RetryBudget,
}

/// Sleep out a retry delay; an interrupt ends the wait.
async fn wait_to_retry(delay: Duration, token: &crate::tasks::CancellationToken) -> Result<()> {
    tokio::select! {
        _ = tokio::time::sleep(delay) => Ok(()),
        _ = token.cancelled() => Err(AgentError::Cancelled),
    }
}

async fn stream_with_retries<F>(
    client: &reqwest::Client,
    resolved: &Resolved,
    request: &CompletionRequest,
    token: &crate::tasks::CancellationToken,
    ledger: &mut TurnLedger,
    on_event: &mut F,
) -> Result<StreamOutcome>
where
    F: FnMut(AgentEvent) + Send,
{
    let mut attempt = 0;
    let mut allowance = ledger.retries.request_allowance();
    loop {
        let mut saw_output = false;
        let mut latest_usage = Usage::default();
        ledger.usage.preview(latest_usage, on_event);
        let streamed = {
            let usage = &ledger.usage;
            let forward = &mut |event: AgentEvent| {
                if matches!(
                    event,
                    AgentEvent::TextDelta { .. } | AgentEvent::ReasoningDelta { .. }
                ) {
                    saw_output = true;
                }
                if let AgentEvent::Usage {
                    usage: observed, ..
                } = event
                {
                    latest_usage = observed;
                    usage.preview(observed, on_event);
                } else {
                    on_event(event);
                }
            };
            tokio::select! {
                response = stream_completion(client, resolved, request, forward) => response,
                _ = token.cancelled() => Err(AgentError::Cancelled),
            }
        };

        match streamed {
            Ok(outcome) => {
                ledger.usage.record_step(outcome.usage, on_event);
                return Ok(outcome);
            }
            Err(error) => {
                if latest_usage.is_observed() {
                    ledger.usage.record_step(latest_usage, on_event);
                }
                // Text already shown to the user cannot be taken back, so a
                // step that streamed some is not started over.
                if !should_retry(&error, allowance, saw_output) {
                    return Err(error);
                }
                allowance = allowance.saturating_sub(1);
                ledger.retries.spend();
                on_event(AgentEvent::Retry {
                    attempt: attempt + 1,
                    max: ledger.retries.per_request,
                });
                wait_to_retry(ledger.retries.wait(&error, attempt), token).await?;
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
    let assistant = assistant_message(&outcome);
    request.messages.push(assistant);
    let guarded = guard_tool_arguments(
        run_tool.clone(),
        is_output_limit_stop(outcome.stop_reason.as_deref()),
    );
    // A reply with more calls than a turn runs gets the first ones run and
    // the rest answered, so every call in the history has a result.
    let mut calls = outcome.tool_calls;
    let skipped = calls.split_off(calls.len().min(MAX_TOOL_CALLS_PER_TURN));
    let mut results = crate::tools::parallel::run_tool_calls(
        calls,
        &pipeline.registry,
        &pipeline.gate,
        &guarded,
        MAX_TOOL_EXECUTION_DURATION,
        pipeline.token.clone(),
        &mut *on_event,
    )
    .await?;
    for call in skipped {
        let output = ToolOutput::text(serde_json::json!({ "error": TOO_MANY_CALLS }).to_string());
        on_event(AgentEvent::ToolOutcome {
            id: call.id.clone(),
            output: output.output.clone(),
        });
        results.push((call, output));
    }
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

/// The assistant message a step adds to history. Anthropic replies keep
/// every block in stream order (thinking, cited text, server tool blocks) so
/// the next request replays them exactly; other wires keep the text and the
/// tool calls.
pub fn assistant_message(outcome: &StreamOutcome) -> Message {
    if !outcome.blocks.is_empty() {
        let content = outcome
            .blocks
            .iter()
            .map(|block| match block {
                AssistantBlock::Text(text) => ContentPart::text(text.clone()),
                AssistantBlock::Cited(block) | AssistantBlock::Native(block) => {
                    ContentPart::ProviderBlock {
                        wire: ProviderWire::Anthropic,
                        block: block.clone(),
                    }
                }
                AssistantBlock::Thinking {
                    thinking,
                    signature,
                } => ContentPart::Thinking {
                    thinking: thinking.clone(),
                    signature: signature.clone(),
                },
                AssistantBlock::RedactedThinking(data) => {
                    ContentPart::RedactedThinking { data: data.clone() }
                }
                AssistantBlock::ToolUse {
                    id,
                    name,
                    arguments,
                } => ContentPart::ToolUse {
                    id: id.clone(),
                    name: name.clone(),
                    arguments: arguments.clone(),
                    thought_signature: None,
                },
            })
            .collect();
        return Message {
            role: Role::Assistant,
            content,
        };
    }
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
    let content = results
        .into_iter()
        .map(|(call, output)| ContentPart::ToolResult {
            id: call.id,
            name: call.name,
            output: output.output,
            images: output.images,
        })
        .collect();
    Message {
        role: Role::User,
        content,
    }
}

/// Runs a call only when its arguments are empty or a JSON object. A call
/// cut off by the output limit, or with broken JSON, gets an explanation
/// back instead of running with guessed arguments.
pub(crate) fn guard_tool_arguments(runner: ToolRunner, output_limited: bool) -> ToolRunner {
    Arc::new(move |call: ToolCall| {
        let arguments = call.arguments.trim();
        let valid = arguments.is_empty()
            || serde_json::from_str::<serde_json::Value>(arguments)
                .is_ok_and(|value| value.is_object());
        if valid {
            return runner(call);
        }
        let reason = if output_limited {
            OUTPUT_LIMITED_CALL
        } else {
            INVALID_ARGUMENTS
        };
        Box::pin(
            async move { ToolOutput::text(serde_json::json!({ "error": reason }).to_string()) },
        )
    })
}

fn empty(outcome: &StreamOutcome) -> bool {
    outcome.text.is_empty() && outcome.tool_calls.is_empty()
}

#[derive(Default)]
struct TurnUsage {
    total: Usage,
    has_calls: bool,
    /// The latest sampling step alone: what the model just saw.
    last_step: Option<Usage>,
    context_window: Option<u32>,
}

impl TurnUsage {
    fn snapshot(&self, addition: Usage) -> Usage {
        let mut total = self.total;
        accumulate_usage(&mut total, addition, self.has_calls);
        total
    }

    fn event(&self, usage: Usage, last_step: Option<Usage>) -> AgentEvent {
        AgentEvent::Usage {
            usage,
            last_step,
            context_window: self.context_window,
        }
    }

    fn preview(&self, addition: Usage, on_event: &mut impl FnMut(AgentEvent)) {
        let (usage, last_step) = if addition.is_observed() {
            (self.snapshot(addition), Some(addition))
        } else {
            (self.total, self.last_step)
        };
        on_event(self.event(usage, last_step));
    }

    /// A sampling step finished (or failed after reporting usage).
    fn record_step(&mut self, addition: Usage, on_event: &mut impl FnMut(AgentEvent)) {
        if addition.is_observed() {
            self.last_step = Some(addition);
        }
        self.record(addition, on_event);
    }

    /// Usage outside sampling (compaction) adds to the total only.
    fn record(&mut self, addition: Usage, on_event: &mut impl FnMut(AgentEvent)) {
        self.total = self.snapshot(addition);
        self.has_calls = true;
        on_event(self.event(self.total, self.last_step));
    }
}

/// Summarize the history, retrying a transient failure of the call the way a
/// sampling step is retried, and count what the call used. A reply that
/// cannot stand in for the history (empty, cut off, a refusal) is an error.
async fn compact_with_usage<F>(
    client: &reqwest::Client,
    resolved: &Resolved,
    request: &CompletionRequest,
    token: &crate::tasks::CancellationToken,
    ledger: &mut TurnLedger,
    on_event: &mut F,
) -> Result<String>
where
    F: FnMut(AgentEvent),
{
    ledger.usage.preview(Usage::default(), on_event);
    let mut attempt = 0;
    let mut allowance = ledger.retries.request_allowance();
    let response = loop {
        match compact::compact_history(client, resolved, request, token).await {
            Err(error) if should_retry(&error, allowance, false) => {
                allowance = allowance.saturating_sub(1);
                ledger.retries.spend();
                on_event(AgentEvent::Retry {
                    attempt: attempt + 1,
                    max: ledger.retries.per_request,
                });
                wait_to_retry(ledger.retries.wait(&error, attempt), token).await?;
                attempt = attempt.saturating_add(1);
            }
            other => break other?,
        }
    };
    // The call is billed whether or not its answer is usable.
    ledger.usage.record(response.usage, on_event);
    compact::usable_summary(&response)
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
    total.reasoning = match (total.reasoning, addition.reasoning) {
        (Some(total), Some(addition)) => Some(total.saturating_add(addition)),
        (total, addition) => total.or(addition),
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

/// The wait before a retry: the backoff, or the provider's `Retry-After`
/// (capped) when that is longer.
fn retry_wait(error: &AgentError, backoff: Duration, long_run: bool) -> Duration {
    let cap = if long_run {
        MAX_LONG_RUN_RETRY_AFTER
    } else {
        MAX_RETRY_AFTER
    };
    error
        .retry_after()
        .map_or(backoff, |asked| backoff.max(asked.min(cap)))
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
    // 0.4.8 L: callers map the kind (auth, transport, …) to their own errors.
    result.error_kind = Some(error.kind().into());
    on_event(AgentEvent::Error {
        message: error.to_string(),
        retryable: error.retryable(),
    });
    result
}

/// `continuing` is set right after a `pause_turn`, when this step carries on
/// the same answer.
fn record_stream_outcome(result: &mut RunOutcome, outcome: &StreamOutcome, continuing: bool) {
    result.steps = result.steps.saturating_add(1);
    result.stop_reason.clone_from(&outcome.stop_reason);
    if continuing {
        result.text.push_str(&outcome.text);
    } else if !outcome.text.is_empty() {
        result.text.clone_from(&outcome.text);
    }
}

fn finish_without_tools(mut result: RunOutcome, outcome: &StreamOutcome) -> RunOutcome {
    if empty(outcome) && result.text.is_empty() {
        let reason = outcome.stop_reason.as_deref();
        result.error = Some(if is_refusal_stop(reason) {
            match &outcome.refusal_category {
                Some(category) => format!("The model declined this request. Category: {category}."),
                None => "The model declined this request.".into(),
            }
        } else if is_output_limit_stop(reason) {
            "The model used its whole output limit before it answered. Choose a lower effort or ask for less.".into()
        } else {
            "The model returned nothing.".into()
        });
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
    request.messages.push(assistant_message(outcome));
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
                matches!(events.last(), Some(AgentEvent::Usage { usage, .. }) if usage.reported_input().is_none() && usage.reported_output().is_none())
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
    fn a_failed_attempt_without_usage_neither_records_nor_previews_unknown_counters() {
        let known = Usage {
            input: 10,
            output: 5,
            input_known: Some(true),
            output_known: Some(true),
            cache_read: Some(2),
            cache_write: Some(0),
            input_semantics: InputTokenSemantics::Inclusive,
            reasoning: None,
        };
        let mut total = TurnUsage::default();
        let mut events = Vec::new();
        total.record(known, &mut |event| events.push(event));
        total.preview(Usage::default(), &mut |event| events.push(event));
        assert!(matches!(events.last(), Some(AgentEvent::Usage { usage, .. }) if *usage == known));
        total.record(known, &mut |event| events.push(event));
        assert_eq!(total.total.reported_input(), Some(20));
        assert_eq!(total.total.reported_output(), Some(10));
        assert_eq!(total.total.cache_read, Some(4));
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
        let message = assistant_message(&outcome);
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
            caps: crate::caps::ModelCaps::default(),
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

    #[tokio::test]
    async fn calls_past_the_turn_limit_are_answered_not_fatal() {
        use std::sync::atomic::{AtomicUsize, Ordering};
        let total = MAX_TOOL_CALLS_PER_TURN + 8;
        let resolved = Resolved {
            provider_id: "custom".into(),
            model_id: "test-model".into(),
            credential: String::new(),
            auth: None,
            wire: Wire::OpenAiChat {
                base_url: "http://127.0.0.1:1/v1".into(),
                reasoning_content: false,
            },
            caps: crate::caps::ModelCaps::default(),
        };
        let mut request = CompletionRequest::prompt("system", "read them all");
        let outcome = StreamOutcome {
            tool_calls: (0..total)
                .map(|index| ToolCall {
                    id: format!("call-{index}"),
                    name: "read_file".into(),
                    arguments: "{}".into(),
                    ..Default::default()
                })
                .collect(),
            ..Default::default()
        };
        let ran = Arc::new(AtomicUsize::new(0));
        let counter = ran.clone();
        let runner: ToolRunner = Arc::new(move |_| {
            counter.fetch_add(1, Ordering::SeqCst);
            Box::pin(async { ToolOutput::text("contents") })
        });
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

        assert_eq!(ran.load(Ordering::SeqCst), MAX_TOOL_CALLS_PER_TURN);
        // The assistant message keeps every call and the answer has a result
        // for each, in order, so the next request is valid.
        let calls = request.messages[1].content.len();
        let results = &request.messages[2].content;
        assert_eq!((calls, results.len()), (total, total));
        for (index, part) in results.iter().enumerate() {
            let ContentPart::ToolResult { id, output, .. } = part else {
                panic!("expected a tool result, got {part:?}");
            };
            assert_eq!(id, &format!("call-{index}"));
            assert_eq!(
                output.contains("did not run"),
                index >= MAX_TOOL_CALLS_PER_TURN,
                "{index}: {output}"
            );
        }
        // Every call the stream showed gets an outcome, so none stays open.
        let outcomes = events
            .iter()
            .filter(|event| matches!(event, AgentEvent::ToolOutcome { .. }))
            .count();
        assert_eq!(outcomes, total);
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
        let message = assistant_message(&outcome);
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

    fn call(id: &str) -> ToolCall {
        ToolCall {
            id: id.into(),
            name: "write_file".into(),
            arguments: "{}".into(),
            ..Default::default()
        }
    }

    #[test]
    fn tool_images_stay_with_their_result() {
        let message = results_turn(vec![
            (
                call("a"),
                ToolOutput {
                    output: "checked".into(),
                    images: vec!["data:image/png;base64,AA".into()],
                },
            ),
            (call("b"), ToolOutput::text("body")),
        ]);
        assert_eq!(message.role, Role::User);
        assert!(
            matches!(&message.content[0], ContentPart::ToolResult { images, .. } if images.len() == 1)
        );
        assert_eq!(message.content.len(), 2);
    }

    #[test]
    fn an_anthropic_assistant_turn_replays_its_blocks_in_stream_order() {
        let outcome = StreamOutcome {
            blocks: vec![
                AssistantBlock::Thinking {
                    thinking: String::new(),
                    signature: "s".into(),
                },
                AssistantBlock::Text("Reading".into()),
                AssistantBlock::ToolUse {
                    id: "t1".into(),
                    name: "read_file".into(),
                    arguments: r#"{"path":"a"}"#.into(),
                },
                AssistantBlock::Native(json!({"type":"server_tool_use","id":"srvtoolu_1"})),
            ],
            ..Default::default()
        };
        let message = assistant_message(&outcome);
        assert!(matches!(
            message.content.as_slice(),
            [
                ContentPart::Thinking { .. },
                ContentPart::Text { .. },
                ContentPart::ToolUse { .. },
                ContentPart::ProviderBlock { .. }
            ]
        ));
    }

    #[tokio::test]
    async fn invalid_arguments_never_reach_the_runner() {
        use std::sync::atomic::{AtomicBool, Ordering};
        let ran = Arc::new(AtomicBool::new(false));
        let flag = ran.clone();
        let inner: ToolRunner = Arc::new(move |_| {
            flag.store(true, Ordering::SeqCst);
            Box::pin(async { ToolOutput::text("ran") })
        });
        let cut = guard_tool_arguments(inner.clone(), true)(ToolCall {
            arguments: "{\"path\":".into(),
            ..call("w")
        })
        .await;
        assert!(cut.output.contains("output limit") && !ran.load(Ordering::SeqCst));
        let broken = guard_tool_arguments(inner.clone(), false)(ToolCall {
            arguments: "[1]".into(),
            ..call("w")
        })
        .await;
        assert!(broken.output.contains("not valid JSON"));
        assert_eq!(
            guard_tool_arguments(inner, false)(ToolCall {
                arguments: String::new(),
                ..call("w")
            })
            .await
            .output,
            "ran"
        );
    }

    #[test]
    fn empty_replies_explain_refusals_and_output_limits() {
        let refused = finish_without_tools(
            RunOutcome::default(),
            &StreamOutcome {
                stop_reason: Some("refusal".into()),
                refusal_category: Some("cyber".into()),
                ..Default::default()
            },
        );
        let error = refused.error.unwrap();
        assert!(
            error.contains("declined") && error.contains("cyber"),
            "{error}"
        );
        let limited = finish_without_tools(
            RunOutcome::default(),
            &StreamOutcome {
                stop_reason: Some("max_tokens".into()),
                ..Default::default()
            },
        );
        assert!(limited.error.unwrap().contains("output limit"));
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

        let fatal = crate::error::AgentError::provider(401, "bad key");
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

    // 0.4.8 L: suspending at a step boundary and keeping the error kind.
    mod suspend {
        use super::*;
        use crate::tasks::CancellationToken;
        use std::io::{Read, Write};
        use std::net::{SocketAddr, TcpListener, TcpStream};
        use std::sync::Mutex;

        struct Script {
            address: SocketAddr,
            requests: Arc<Mutex<Vec<serde_json::Value>>>,
        }

        fn read_request(stream: &mut TcpStream) -> String {
            stream
                .set_read_timeout(Some(Duration::from_secs(2)))
                .unwrap();
            let mut bytes = Vec::new();
            let mut chunk = [0u8; 4096];
            loop {
                let read = stream.read(&mut chunk).unwrap_or(0);
                if read == 0 {
                    break;
                }
                bytes.extend_from_slice(&chunk[..read]);
                let Some(end) = bytes.windows(4).position(|part| part == b"\r\n\r\n") else {
                    continue;
                };
                let headers = String::from_utf8_lossy(&bytes[..end]);
                let length = headers
                    .lines()
                    .find_map(|line| {
                        let (name, value) = line.split_once(':')?;
                        name.eq_ignore_ascii_case("content-length")
                            .then(|| value.trim().parse::<usize>().ok())
                            .flatten()
                    })
                    .unwrap_or(0);
                if bytes.len() >= end + 4 + length {
                    break;
                }
            }
            String::from_utf8_lossy(&bytes).into_owned()
        }

        /// Answers one request per scripted response, in order, then stops
        /// listening (a further request fails to connect).
        fn serve(responses: Vec<(&'static str, &'static str, String)>) -> Script {
            let listener = TcpListener::bind("127.0.0.1:0").unwrap();
            let address = listener.local_addr().unwrap();
            let requests = Arc::new(Mutex::new(Vec::new()));
            let seen = requests.clone();
            std::thread::spawn(move || {
                for (status, content_type, body) in responses {
                    let Ok((mut stream, _)) = listener.accept() else {
                        return;
                    };
                    let raw = read_request(&mut stream);
                    if let Some(start) = raw.find("\r\n\r\n") {
                        if let Ok(value) = serde_json::from_str(&raw[start + 4..]) {
                            seen.lock().unwrap().push(value);
                        }
                    }
                    let _ = write!(
                        stream,
                        "HTTP/1.1 {status}\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                        body.len()
                    );
                    let _ = stream.flush();
                }
            });
            Script { address, requests }
        }

        fn resolved(address: SocketAddr) -> Resolved {
            Resolved {
                provider_id: "custom".into(),
                model_id: "test-model".into(),
                credential: String::new(),
                auth: None,
                wire: Wire::OpenAiChat {
                    base_url: format!("http://{address}/v1"),
                    reasoning_content: false,
                },
                caps: crate::caps::ModelCaps::default(),
            }
        }

        fn tool_call_stream(name: &str) -> String {
            format!(
                "data: {}\n\ndata: {}\n\ndata: [DONE]\n\n",
                json!({"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call-1","type":"function","function":{"name":name,"arguments":"{}"}}]}}]}),
                json!({"choices":[{"delta":{},"finish_reason":"tool_calls"}]}),
            )
        }

        fn text_stream(text: &str) -> String {
            format!(
                "data: {}\n\ndata: {}\n\ndata: [DONE]\n\n",
                json!({"choices":[{"delta":{"content":text}}]}),
                json!({"choices":[{"delta":{},"finish_reason":"stop"}]}),
            )
        }

        async fn run_with(
            script: &Script,
            request: CompletionRequest,
            pipeline: ToolPipeline,
            runner: ToolRunner,
        ) -> RunOutcome {
            tokio::time::timeout(
                Duration::from_secs(10),
                crate::run::run_agent_with_pipeline(
                    &crate::build_client().unwrap(),
                    &resolved(script.address),
                    request,
                    &RunConfig {
                        max_retries: 0,
                        ..RunConfig::default()
                    },
                    pipeline,
                    None,
                    runner,
                    |_| {},
                ),
            )
            .await
            .expect("the run did not finish")
            .unwrap()
        }

        fn quiet_runner() -> ToolRunner {
            Arc::new(|_| Box::pin(async { ToolOutput::text("contents") }))
        }

        #[tokio::test]
        async fn a_suspend_signal_returns_before_the_next_step_with_the_whole_history() {
            let script = serve(vec![(
                "200 OK",
                "text/event-stream",
                tool_call_stream("read_file"),
            )]);
            let suspend = CancellationToken::new();
            let signal = suspend.clone();
            // The suspend arrives while the first tool runs.
            let runner: ToolRunner = Arc::new(move |_| {
                signal.cancel();
                Box::pin(async { ToolOutput::text("contents") })
            });
            let outcome = run_with(
                &script,
                CompletionRequest::prompt("system", "read the file"),
                ToolPipeline {
                    suspend: Some(suspend),
                    ..ToolPipeline::default()
                },
                runner,
            )
            .await;
            assert!(outcome.suspended);
            assert_eq!(script.requests.lock().unwrap().len(), 1);
            let last = outcome.history.last().unwrap();
            assert!(
                matches!(last.content[0], ContentPart::ToolResult { ref output, .. } if output == "contents")
            );
            assert_eq!(outcome.history.len(), 3);
        }

        #[tokio::test]
        async fn a_run_started_from_a_saved_history_sends_it_unchanged() {
            let script = serve(vec![("200 OK", "text/event-stream", text_stream("done"))]);
            let saved_history = vec![
                Message::user("read the file"),
                Message {
                    role: Role::Assistant,
                    content: vec![ContentPart::ToolUse {
                        id: "call-1".into(),
                        name: "read_file".into(),
                        arguments: "{}".into(),
                        thought_signature: None,
                    }],
                },
                Message {
                    role: Role::User,
                    content: vec![ContentPart::ToolResult {
                        id: "call-1".into(),
                        name: "read_file".into(),
                        output: "contents".into(),
                        images: Vec::new(),
                    }],
                },
            ];
            let outcome = run_with(
                &script,
                CompletionRequest {
                    system: Some("system".into()),
                    messages: saved_history.clone(),
                    ..CompletionRequest::default()
                },
                ToolPipeline::default(),
                quiet_runner(),
            )
            .await;
            assert_eq!(outcome.text, "done");
            let requests = script.requests.lock().unwrap();
            // The system prompt, then the saved conversation as it was.
            assert_eq!(
                requests[0]["messages"].as_array().unwrap().len(),
                saved_history.len() + 1
            );
            assert_eq!(requests[0]["messages"][3]["content"], "contents");
        }

        #[tokio::test]
        async fn a_stream_error_keeps_its_kind() {
            let script = serve(vec![(
                "401 Unauthorized",
                "application/json",
                json!({"error":{"message":"bad key"}}).to_string(),
            )]);
            let outcome = run_with(
                &script,
                CompletionRequest::prompt("system", "hi"),
                ToolPipeline::default(),
                quiet_runner(),
            )
            .await;
            assert!(outcome.error.is_some());
            assert_eq!(outcome.error_kind.as_deref(), Some("auth"));
            assert!(!outcome.suspended);
        }

        #[tokio::test]
        async fn without_a_suspend_token_nothing_changes() {
            let script = serve(vec![
                ("200 OK", "text/event-stream", tool_call_stream("read_file")),
                ("200 OK", "text/event-stream", text_stream("finished")),
            ]);
            let outcome = run_with(
                &script,
                CompletionRequest::prompt("system", "read the file"),
                ToolPipeline::default(),
                quiet_runner(),
            )
            .await;
            assert!(!outcome.suspended);
            assert_eq!(outcome.error_kind, None);
            assert_eq!(outcome.text, "finished");
            assert_eq!(script.requests.lock().unwrap().len(), 2);
        }

        #[tokio::test]
        async fn a_suspend_requested_before_the_run_returns_at_once() {
            let script = serve(Vec::new());
            let suspend = CancellationToken::new();
            suspend.cancel();
            let outcome = run_with(
                &script,
                CompletionRequest::prompt("system", "start"),
                ToolPipeline {
                    suspend: Some(suspend),
                    ..ToolPipeline::default()
                },
                quiet_runner(),
            )
            .await;
            assert!(outcome.suspended);
            assert_eq!(outcome.history.len(), 1);
            assert!(script.requests.lock().unwrap().is_empty());
        }

        #[tokio::test]
        async fn a_transient_error_in_each_step_does_not_use_up_the_next_steps_retries() {
            let overloaded = || {
                (
                    "503 Service Unavailable",
                    "application/json",
                    json!({"error":{"message":"overloaded"}}).to_string(),
                )
            };
            let script = serve(vec![
                overloaded(),
                ("200 OK", "text/event-stream", tool_call_stream("read_file")),
                overloaded(),
                ("200 OK", "text/event-stream", text_stream("finished")),
            ]);
            let mut events = Vec::new();
            let outcome = tokio::time::timeout(
                Duration::from_secs(10),
                crate::run::run_agent_with_pipeline(
                    &crate::build_client().unwrap(),
                    &resolved(script.address),
                    CompletionRequest::prompt("system", "read the file"),
                    // One retry for each request: the old run-wide budget of
                    // one ended the run at the second step.
                    &RunConfig {
                        max_retries: 1,
                        retry_base_ms: 1,
                        ..RunConfig::default()
                    },
                    ToolPipeline::default(),
                    None,
                    quiet_runner(),
                    |event| events.push(event),
                ),
            )
            .await
            .expect("the run did not finish")
            .unwrap();
            assert_eq!(outcome.error, None);
            assert_eq!(outcome.text, "finished");
            assert_eq!(script.requests.lock().unwrap().len(), 4);
            assert_eq!(
                events
                    .iter()
                    .filter(|event| matches!(event, AgentEvent::Retry { attempt: 1, max: 1 }))
                    .count(),
                2
            );
        }

        #[tokio::test]
        async fn a_request_that_uses_its_retries_still_fails_the_run() {
            let overloaded = || {
                (
                    "503 Service Unavailable",
                    "application/json",
                    json!({"error":{"message":"overloaded"}}).to_string(),
                )
            };
            let script = serve(vec![overloaded(), overloaded(), overloaded()]);
            let outcome = tokio::time::timeout(
                Duration::from_secs(10),
                crate::run::run_agent_with_pipeline(
                    &crate::build_client().unwrap(),
                    &resolved(script.address),
                    CompletionRequest::prompt("system", "hi"),
                    &RunConfig {
                        max_retries: 2,
                        retry_base_ms: 1,
                        ..RunConfig::default()
                    },
                    ToolPipeline::default(),
                    None,
                    quiet_runner(),
                    |_| {},
                ),
            )
            .await
            .expect("the run did not finish")
            .unwrap();
            assert!(outcome.error.is_some());
            assert_eq!(outcome.error_kind.as_deref(), Some("provider"));
            assert_eq!(script.requests.lock().unwrap().len(), 3);
        }
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
            reasoning: None,
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
                reasoning: None,
            },
            true,
        );

        assert_eq!(usage.input, u32::MAX);
        assert_eq!(usage.output, u32::MAX);
        assert_eq!(usage.cache_read, Some(u32::MAX));
        assert_eq!(usage.cache_write, Some(5));
    }

    #[test]
    fn reasoning_tokens_add_up_across_steps() {
        let step = |reasoning: Option<u32>| Usage {
            input: 1,
            output: 10,
            input_known: Some(true),
            output_known: Some(true),
            reasoning,
            ..Usage::default()
        };
        let mut total = step(Some(4));
        accumulate_usage(&mut total, step(Some(6)), true);
        assert_eq!(total.reasoning, Some(10));
        // A step that reports none keeps what the others reported.
        accumulate_usage(&mut total, step(None), true);
        assert_eq!(total.reasoning, Some(10));
        let mut unreported = step(None);
        accumulate_usage(&mut unreported, step(Some(3)), true);
        assert_eq!(unreported.reasoning, Some(3));
        let mut none = step(None);
        accumulate_usage(&mut none, step(None), true);
        assert_eq!(none.reasoning, None);
    }

    #[test]
    fn a_request_starts_with_its_own_retries_and_the_run_has_a_larger_total() {
        let config = RunConfig::default();
        let mut budget = RetryBudget::new(&config);
        assert_eq!(budget.per_request, 4);
        assert_eq!(budget.request_allowance(), 4);
        // Spending on one request does not shrink the next one's allowance.
        budget.spend();
        budget.spend();
        assert_eq!(budget.request_allowance(), 4);
        // The run's total still bounds a provider that keeps failing.
        for _ in 0..MAX_RUN_RETRIES {
            budget.spend();
        }
        assert_eq!(budget.request_allowance(), 0);

        let long = RetryBudget::new(&RunConfig {
            allow_long_runs: true,
            ..config.clone()
        });
        assert_eq!(long.per_request, MAX_AGENT_RETRIES);
        assert_eq!(long.total, MAX_LONG_RUN_RETRIES);

        let none = RetryBudget::new(&RunConfig {
            max_retries: 0,
            allow_long_runs: true,
            ..config
        });
        assert_eq!((none.request_allowance(), none.total), (0, 0));
    }

    #[test]
    fn a_retry_after_longer_than_the_backoff_sets_the_wait_up_to_a_cap() {
        let backoff = Duration::from_millis(800);
        let asked = |seconds: u64| AgentError::Provider {
            status: 429,
            message: String::new(),
            retry_after: Some(Duration::from_secs(seconds)),
        };
        assert_eq!(
            retry_wait(&asked(30), backoff, false),
            Duration::from_secs(30)
        );
        // A shorter ask never shortens the backoff.
        let short = AgentError::Provider {
            status: 429,
            message: String::new(),
            retry_after: Some(Duration::from_millis(10)),
        };
        assert_eq!(retry_wait(&short, backoff, false), backoff);
        // No hint: the backoff.
        assert_eq!(
            retry_wait(&AgentError::provider(503, ""), backoff, false),
            backoff
        );
        // A very long ask is capped, higher for a long run.
        assert_eq!(retry_wait(&asked(3_600), backoff, false), MAX_RETRY_AFTER);
        assert_eq!(
            retry_wait(&asked(3_600), backoff, true),
            MAX_LONG_RUN_RETRY_AFTER
        );
    }

    #[test]
    fn a_failed_compaction_keeps_the_limit_and_says_why() {
        let limit = crate::session::context_window::history_limit_error("agent message count");
        let reported = compaction_failure(
            limit.clone(),
            AgentError::Decode("the model returned an empty summary".into()),
        );
        let text = reported.to_string();
        assert!(
            text.contains("agent message count exceeded its safety limit"),
            "{text}"
        );
        assert!(text.contains("empty summary"), "{text}");
        // Still a history limit, so callers that match on it keep working.
        assert!(is_history_limit(&reported));
        assert_eq!(
            compaction_failure(limit, AgentError::Cancelled),
            AgentError::Cancelled
        );
    }
}
