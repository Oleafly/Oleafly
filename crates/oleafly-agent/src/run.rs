use std::future::Future;
use std::io::Write;
use std::pin::Pin;
use std::sync::Arc;
use std::time::Duration;

use serde::{Deserialize, Serialize};

use crate::complete::{CompletionRequest, Usage};
use crate::error::{AgentError, Result};
use crate::event::AgentEvent;
use crate::message::{ContentPart, Message, Role};
use crate::provider::Resolved;
use crate::stream::{stream_completion, StreamOutcome, ToolCall, MAX_STREAM_TOOL_CALLS};

const MAX_RETRY_DELAY_MS: u64 = 60_000;
const MAX_AGENT_RUN_DURATION: Duration = Duration::from_secs(30 * 60);
const MAX_AGENT_STEPS: u32 = 50;
const MAX_AGENT_RETRIES: u32 = 8;
const MAX_TOOL_EXECUTION_DURATION: Duration = Duration::from_secs(5 * 60);
const MAX_TOOL_OUTPUT_TEXT_BYTES: usize = 64 * 1024;
const MAX_TOOL_OUTPUT_IMAGES: usize = 6;
// A 10 MiB binary attachment occupies about 13.4 MiB once base64 encoded.
const MAX_TOOL_IMAGE_DATA_URL_BYTES: usize = 14 * 1024 * 1024;
const MAX_TOOL_OUTPUT_IMAGE_BYTES: usize = 84 * 1024 * 1024;
const MAX_TOOL_RESULT_BATCH_BYTES: usize = 96 * 1024 * 1024;
const MAX_AGENT_HISTORY_BYTES: usize = 128 * 1024 * 1024;
const MAX_AGENT_CONTEXT_CHARS: usize = 100_000;
const MAX_AGENT_IMAGES: usize = 12;
const MAX_AGENT_MESSAGES: usize = 128;
const MAX_TOOL_DEFINITIONS: usize = 128;
const MAX_AGENT_TOOL_CALLS: usize = 256;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RunConfig {
    pub max_steps: u32,
    pub max_retries: u32,
    pub retry_base_ms: u64,
}

impl Default for RunConfig {
    fn default() -> Self {
        RunConfig {
            max_steps: 50,
            max_retries: 4,
            retry_base_ms: 800,
        }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct ToolOutput {
    pub output: String,
    #[serde(default)]
    pub images: Vec<String>,
}

impl ToolOutput {
    pub fn text(output: impl Into<String>) -> Self {
        ToolOutput {
            output: output.into(),
            images: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct RunOutcome {
    pub text: String,
    pub usage: Usage,
    pub steps: u32,
    pub stopped_at_cap: bool,
    pub error: Option<String>,
}

pub type BoxFuture<T> = Pin<Box<dyn Future<Output = T> + Send>>;
pub type ToolRunner = Arc<dyn Fn(ToolCall) -> BoxFuture<ToolOutput> + Send + Sync>;

#[derive(Clone, Copy)]
struct ToolOutputLimits {
    max_text_bytes: usize,
    max_images: usize,
    max_image_bytes: usize,
    max_total_image_bytes: usize,
}

impl Default for ToolOutputLimits {
    fn default() -> Self {
        Self {
            max_text_bytes: MAX_TOOL_OUTPUT_TEXT_BYTES,
            max_images: MAX_TOOL_OUTPUT_IMAGES,
            max_image_bytes: MAX_TOOL_IMAGE_DATA_URL_BYTES,
            max_total_image_bytes: MAX_TOOL_OUTPUT_IMAGE_BYTES,
        }
    }
}

struct LimitedWriter {
    bytes: usize,
    max_bytes: usize,
}

impl Write for LimitedWriter {
    fn write(&mut self, buffer: &[u8]) -> std::io::Result<usize> {
        let next = self
            .bytes
            .checked_add(buffer.len())
            .filter(|next| *next <= self.max_bytes)
            .ok_or_else(|| std::io::Error::other("serialized history limit exceeded"))?;
        self.bytes = next;
        Ok(buffer.len())
    }

    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

struct HistoryBudget {
    serialized_bytes: usize,
    context_chars: usize,
    images: usize,
    messages: usize,
    tool_calls: usize,
}

/// Reject renderer/provider requests that would create unbounded JSON or history state.
pub fn validate_completion_request(request: &CompletionRequest) -> Result<()> {
    HistoryBudget::new(request).map(|_| ())
}

impl HistoryBudget {
    fn new(request: &CompletionRequest) -> Result<Self> {
        if request.messages.len() > MAX_AGENT_MESSAGES {
            return Err(history_limit_error("agent message count"));
        }
        if request.tools.len() > MAX_TOOL_DEFINITIONS {
            return Err(history_limit_error("tool definition count"));
        }
        let tool_calls = count_tool_calls(&request.messages)?;
        if tool_calls > MAX_AGENT_TOOL_CALLS {
            return Err(history_limit_error("agent tool-call count"));
        }
        let context_chars = completion_context_chars(request)?;
        if context_chars > MAX_AGENT_CONTEXT_CHARS {
            return Err(history_limit_error("agent context"));
        }
        let images = count_images(&request.messages)?;
        if images > MAX_AGENT_IMAGES {
            return Err(history_limit_error("agent image count"));
        }
        Ok(Self {
            serialized_bytes: serialized_size_limited(request, MAX_AGENT_HISTORY_BYTES)?,
            context_chars,
            images,
            messages: request.messages.len(),
            tool_calls,
        })
    }

    fn append_message(&mut self, message: &Message, new_tool_calls: usize) -> Result<()> {
        let messages = self
            .messages
            .checked_add(1)
            .filter(|messages| *messages <= MAX_AGENT_MESSAGES)
            .ok_or_else(|| history_limit_error("agent message count"))?;
        let tool_calls = self
            .tool_calls
            .checked_add(new_tool_calls)
            .filter(|tool_calls| *tool_calls <= MAX_AGENT_TOOL_CALLS)
            .ok_or_else(|| history_limit_error("agent tool-call count"))?;
        let context_chars = self
            .context_chars
            .checked_add(message_context_chars(message)?)
            .filter(|chars| *chars <= MAX_AGENT_CONTEXT_CHARS)
            .ok_or_else(|| history_limit_error("agent context"))?;
        let images = self
            .images
            .checked_add(message_image_count(message))
            .filter(|images| *images <= MAX_AGENT_IMAGES)
            .ok_or_else(|| history_limit_error("agent image count"))?;
        let remaining = MAX_AGENT_HISTORY_BYTES.saturating_sub(self.serialized_bytes);
        let message_bytes = serialized_size_limited(message, remaining)?;
        let serialized_bytes = self
            .serialized_bytes
            .checked_add(message_bytes)
            .and_then(|bytes| bytes.checked_add(1))
            .filter(|bytes| *bytes <= MAX_AGENT_HISTORY_BYTES)
            .ok_or_else(|| history_limit_error("serialized agent history"))?;

        self.messages = messages;
        self.tool_calls = tool_calls;
        self.context_chars = context_chars;
        self.images = images;
        self.serialized_bytes = serialized_bytes;
        Ok(())
    }
}

fn history_limit_error(description: &str) -> AgentError {
    AgentError::Decode(format!("{description} exceeded its safety limit"))
}

fn serialized_size_limited<T: Serialize>(value: &T, max_bytes: usize) -> Result<usize> {
    let mut writer = LimitedWriter {
        bytes: 0,
        max_bytes,
    };
    serde_json::to_writer(&mut writer, value)
        .map_err(|_| history_limit_error("serialized agent history"))?;
    Ok(writer.bytes)
}

fn count_tool_calls(messages: &[Message]) -> Result<usize> {
    messages.iter().try_fold(0usize, |total, message| {
        let calls = message
            .content
            .iter()
            .filter(|part| matches!(part, ContentPart::ToolUse { .. }))
            .count();
        total
            .checked_add(calls)
            .ok_or_else(|| history_limit_error("agent tool-call count"))
    })
}

fn checked_chars(value: &str) -> Result<usize> {
    let chars = value.chars().count();
    (chars <= MAX_AGENT_CONTEXT_CHARS)
        .then_some(chars)
        .ok_or_else(|| history_limit_error("agent context"))
}

fn message_context_chars(message: &Message) -> Result<usize> {
    message.content.iter().try_fold(0usize, |total, part| {
        let chars = match part {
            ContentPart::Text { text } => checked_chars(text)?,
            ContentPart::Image { .. } => 0,
            ContentPart::ToolUse {
                id,
                name,
                arguments,
            } => {
                let id = checked_chars(id)?;
                let name = checked_chars(name)?;
                let arguments = checked_chars(arguments)?;
                id.checked_add(name)
                    .and_then(|sum| sum.checked_add(arguments))
                    .ok_or_else(|| history_limit_error("agent context"))?
            }
            ContentPart::ToolResult { id, name, output } => {
                let id = checked_chars(id)?;
                let name = checked_chars(name)?;
                let output = checked_chars(output)?;
                id.checked_add(name)
                    .and_then(|sum| sum.checked_add(output))
                    .ok_or_else(|| history_limit_error("agent context"))?
            }
        };
        total
            .checked_add(chars)
            .ok_or_else(|| history_limit_error("agent context"))
    })
}

fn completion_context_chars(request: &CompletionRequest) -> Result<usize> {
    let system = request
        .system
        .as_deref()
        .map(checked_chars)
        .transpose()?
        .unwrap_or(0);
    let messages = request.messages.iter().try_fold(0usize, |total, message| {
        total
            .checked_add(message_context_chars(message)?)
            .ok_or_else(|| history_limit_error("agent context"))
    })?;
    let tools = serialized_size_limited(&request.tools, MAX_AGENT_CONTEXT_CHARS)?;
    system
        .checked_add(messages)
        .and_then(|sum| sum.checked_add(tools))
        .ok_or_else(|| history_limit_error("agent context"))
}

fn message_image_count(message: &Message) -> usize {
    message
        .content
        .iter()
        .filter(|part| matches!(part, ContentPart::Image { .. }))
        .count()
}

fn count_images(messages: &[Message]) -> Result<usize> {
    messages.iter().try_fold(0usize, |total, message| {
        total
            .checked_add(message_image_count(message))
            .ok_or_else(|| history_limit_error("agent image count"))
    })
}

fn assistant_turn(outcome: &StreamOutcome) -> Message {
    let mut content = Vec::new();
    if !outcome.text.is_empty() {
        content.push(ContentPart::text(outcome.text.clone()));
    }
    for call in &outcome.tool_calls {
        content.push(ContentPart::ToolUse {
            id: call.id.clone(),
            name: call.name.clone(),
            arguments: call.arguments.clone(),
        });
    }
    Message {
        role: Role::Assistant,
        content,
    }
}

fn results_turn(results: Vec<(ToolCall, ToolOutput)>) -> Message {
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

fn should_retry(error: &AgentError, retries_remaining: u32, saw_output: bool) -> bool {
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

fn truncate_utf8(value: &mut String, max_bytes: usize) {
    if value.len() <= max_bytes {
        return;
    }
    let mut end = max_bytes;
    while !value.is_char_boundary(end) {
        end -= 1;
    }
    value.truncate(end);
}

fn fit_with_notice(value: &mut String, max_bytes: usize, notice: &str) {
    let mut notice = notice.to_string();
    truncate_utf8(&mut notice, max_bytes);
    truncate_utf8(value, max_bytes.saturating_sub(notice.len()));
    value.push_str(&notice);
}

fn sanitize_tool_output(mut output: ToolOutput, limits: ToolOutputLimits) -> ToolOutput {
    let text_truncated = output.output.len() > limits.max_text_bytes;
    let mut image_bytes = 0usize;
    let mut kept_images = Vec::with_capacity(output.images.len().min(limits.max_images));
    let mut omitted_images = 0usize;

    for image in std::mem::take(&mut output.images) {
        let next_total = image_bytes.checked_add(image.len());
        let allowed = kept_images.len() < limits.max_images
            && image.len() <= limits.max_image_bytes
            && next_total
                .map(|total| total <= limits.max_total_image_bytes)
                .unwrap_or(false);
        if allowed {
            image_bytes = next_total.unwrap_or(image_bytes);
            kept_images.push(image);
        } else {
            omitted_images = omitted_images.saturating_add(1);
        }
    }
    output.images = kept_images;

    if text_truncated || omitted_images > 0 {
        let notice = match (text_truncated, omitted_images) {
            (true, 0) => "\n[tool output truncated by backend safety limit]".to_string(),
            (false, count) => format!("\n[{count} tool image(s) omitted by backend safety limit]"),
            (true, count) => format!(
                "\n[tool output truncated and {count} image(s) omitted by backend safety limit]"
            ),
        };
        let was_json = serde_json::from_str::<serde_json::Value>(&output.output).is_ok();
        let json_notice = serde_json::json!({
            "error": "tool output exceeded the backend safety limit",
            "text_truncated": text_truncated,
            "omitted_images": omitted_images,
        })
        .to_string();
        if was_json && json_notice.len() <= limits.max_text_bytes {
            output.output = json_notice;
        } else {
            fit_with_notice(&mut output.output, limits.max_text_bytes, &notice);
        }
    }
    output
}

/// Apply the same retention limits at external trust boundaries and in the agent loop.
pub fn bound_tool_output(output: ToolOutput) -> ToolOutput {
    sanitize_tool_output(output, ToolOutputLimits::default())
}

fn tool_output_payload_bytes(output: &ToolOutput) -> Result<usize> {
    output
        .images
        .iter()
        .try_fold(output.output.len(), |total, image| {
            total
                .checked_add(image.len())
                .ok_or_else(|| history_limit_error("tool result batch"))
        })
}

fn add_tool_batch_bytes(total: &mut usize, bytes: usize, limit: usize) -> Result<()> {
    let next = total
        .checked_add(bytes)
        .filter(|next| *next <= limit)
        .ok_or_else(|| history_limit_error("tool result batch"))?;
    *total = next;
    Ok(())
}

fn validate_tool_calls_per_turn(calls: usize) -> Result<()> {
    if calls > MAX_STREAM_TOOL_CALLS {
        Err(history_limit_error("tool calls in one turn"))
    } else {
        Ok(())
    }
}

async fn run_tool_with_timeout(
    call: ToolCall,
    run_tool: &ToolRunner,
    timeout: Duration,
) -> ToolOutput {
    match tokio::time::timeout(timeout, run_tool(call)).await {
        Ok(output) => output,
        Err(_) => ToolOutput::text(
            serde_json::json!({ "error": "the tool execution timed out" }).to_string(),
        ),
    }
}

async fn run_tools<F>(
    calls: Vec<ToolCall>,
    run_tool: &ToolRunner,
    on_event: &mut F,
) -> Result<Vec<(ToolCall, ToolOutput)>>
where
    F: FnMut(AgentEvent) + Send,
{
    validate_tool_calls_per_turn(calls.len())?;
    let mut results = Vec::with_capacity(calls.len());
    let mut batch_bytes = 0usize;
    for call in calls {
        let output = bound_tool_output(
            run_tool_with_timeout(call.clone(), run_tool, MAX_TOOL_EXECUTION_DURATION).await,
        );
        add_tool_batch_bytes(
            &mut batch_bytes,
            tool_output_payload_bytes(&output)?,
            MAX_TOOL_RESULT_BATCH_BYTES,
        )?;
        on_event(AgentEvent::ToolOutcome {
            id: call.id.clone(),
            output: output.output.clone(),
        });
        results.push((call, output));
    }
    Ok(results)
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

pub async fn run_agent<F>(
    client: &reqwest::Client,
    resolved: &Resolved,
    request: CompletionRequest,
    config: &RunConfig,
    run_tool: ToolRunner,
    on_event: F,
) -> Result<RunOutcome>
where
    F: FnMut(AgentEvent) + Send,
{
    tokio::time::timeout(
        MAX_AGENT_RUN_DURATION,
        run_agent_inner(client, resolved, request, config, run_tool, on_event),
    )
    .await
    .map_err(|_| AgentError::Timeout)?
}

async fn run_agent_inner<F>(
    client: &reqwest::Client,
    resolved: &Resolved,
    request: CompletionRequest,
    config: &RunConfig,
    run_tool: ToolRunner,
    mut on_event: F,
) -> Result<RunOutcome>
where
    F: FnMut(AgentEvent) + Send,
{
    let mut request = request;
    let mut result = RunOutcome::default();
    let mut history = HistoryBudget::new(&request)?;
    let mut retries_remaining = config.max_retries.min(MAX_AGENT_RETRIES);

    for step in 0..config.max_steps.min(MAX_AGENT_STEPS) {
        on_event(AgentEvent::StepStart { step });

        let turn = stream_with_retries(
            client,
            resolved,
            &request,
            config,
            &mut retries_remaining,
            &mut on_event,
        )
        .await;

        let Ok(outcome) = turn else {
            let error = turn.unwrap_err();
            result.error = Some(error.to_string());
            on_event(AgentEvent::Error {
                message: error.to_string(),
                retryable: error.retryable(),
            });
            return Ok(result);
        };

        accumulate_usage(&mut result.usage, outcome.usage);
        result.steps = result.steps.saturating_add(1);
        on_event(AgentEvent::Usage {
            usage: result.usage,
        });

        if !outcome.text.is_empty() {
            result.text = outcome.text.clone();
        }

        if outcome.tool_calls.is_empty() {
            if empty(&outcome) {
                result.error = Some("The model returned nothing.".into());
            }
            return Ok(result);
        }

        validate_tool_calls_per_turn(outcome.tool_calls.len())?;
        let new_tool_calls = outcome.tool_calls.len();
        let assistant = assistant_turn(&outcome);
        history.append_message(&assistant, new_tool_calls)?;
        request.messages.push(assistant);

        let results = run_tools(outcome.tool_calls, &run_tool, &mut on_event).await?;
        let results = results_turn(results);
        history.append_message(&results, 0)?;
        request.messages.push(results);
    }

    result.stopped_at_cap = true;
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::stream::ToolCall;

    #[test]
    fn an_assistant_turn_carries_text_then_every_call() {
        let outcome = StreamOutcome {
            text: "Reading".into(),
            tool_calls: vec![
                ToolCall {
                    id: "a".into(),
                    name: "read_file".into(),
                    arguments: "{}".into(),
                },
                ToolCall {
                    id: "b".into(),
                    name: "list_files".into(),
                    arguments: "{}".into(),
                },
            ],
            ..Default::default()
        };
        let message = assistant_turn(&outcome);
        assert_eq!(message.role, Role::Assistant);
        assert!(matches!(message.content[0], ContentPart::Text { .. }));
        assert!(matches!(
            message.content[1],
            ContentPart::ToolUse { ref id, .. } if id == "a"
        ));
        assert!(matches!(
            message.content[2],
            ContentPart::ToolUse { ref id, .. } if id == "b"
        ));
    }

    #[test]
    fn a_tool_only_turn_carries_no_empty_text_part() {
        let outcome = StreamOutcome {
            tool_calls: vec![ToolCall {
                id: "a".into(),
                name: "n".into(),
                arguments: "{}".into(),
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
    }

    #[test]
    fn a_retryable_error_is_retried_only_before_any_output_streamed() {
        let error = AgentError::Transport("connection reset".into());
        assert!(should_retry(&error, 4, false));
        assert!(!should_retry(&error, 4, true));
        assert!(!should_retry(&error, 0, false));

        let fatal = AgentError::Provider {
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

    #[test]
    fn tool_outputs_are_bounded_before_entering_history() {
        let output = ToolOutput {
            output: "x".repeat(200),
            images: vec!["1234".into(), "1234567".into(), "5678".into(), "z".into()],
        };
        let sanitized = sanitize_tool_output(
            output,
            ToolOutputLimits {
                max_text_bytes: 128,
                max_images: 2,
                max_image_bytes: 6,
                max_total_image_bytes: 8,
            },
        );

        assert!(sanitized.output.len() <= 128);
        assert!(sanitized.output.contains("backend safety limit"));
        assert_eq!(sanitized.images, ["1234", "5678"]);
    }

    #[test]
    fn utf8_tool_text_is_truncated_only_at_character_boundaries() {
        let sanitized = sanitize_tool_output(
            ToolOutput::text("🧪".repeat(100)),
            ToolOutputLimits {
                max_text_bytes: 64,
                ..ToolOutputLimits::default()
            },
        );

        assert!(sanitized.output.len() <= 64);
        assert!(std::str::from_utf8(sanitized.output.as_bytes()).is_ok());
    }

    #[test]
    fn truncated_json_tool_output_remains_valid_json() {
        let sanitized = sanitize_tool_output(
            ToolOutput::text(serde_json::json!({ "value": "x".repeat(200) }).to_string()),
            ToolOutputLimits {
                max_text_bytes: 128,
                ..ToolOutputLimits::default()
            },
        );

        let value: serde_json::Value = serde_json::from_str(&sanitized.output).unwrap();
        assert_eq!(value["text_truncated"], true);
    }

    #[test]
    fn tool_result_batches_have_an_aggregate_ceiling() {
        let mut bytes = 0;
        add_tool_batch_bytes(&mut bytes, 5, 8).unwrap();
        let error = add_tool_batch_bytes(&mut bytes, 4, 8).unwrap_err();

        assert!(matches!(error, AgentError::Decode(_)));
        assert!(!error.retryable());
        assert_eq!(bytes, 5);
    }

    #[tokio::test]
    async fn tool_execution_has_a_backend_deadline() {
        let runner: ToolRunner = Arc::new(|_| Box::pin(std::future::pending()));
        let output = run_tool_with_timeout(ToolCall::default(), &runner, Duration::ZERO).await;

        let value: serde_json::Value = serde_json::from_str(&output.output).unwrap();
        assert_eq!(value["error"], "the tool execution timed out");
    }

    #[test]
    fn serialized_history_is_counted_without_allocating_a_copy() {
        let message = Message::user("a payload");
        let exact = serde_json::to_vec(&message).unwrap().len();
        assert_eq!(serialized_size_limited(&message, exact).unwrap(), exact);
        assert!(matches!(
            serialized_size_limited(&message, exact - 1),
            Err(AgentError::Decode(_))
        ));
    }

    #[test]
    fn history_and_tool_call_counts_are_backend_enforced() {
        let too_many_messages = CompletionRequest {
            messages: vec![Message::user(""); MAX_AGENT_MESSAGES + 1],
            ..Default::default()
        };
        assert!(matches!(
            HistoryBudget::new(&too_many_messages),
            Err(AgentError::Decode(_))
        ));

        let request = CompletionRequest::default();
        let mut history = HistoryBudget::new(&request).unwrap();
        assert!(matches!(
            history.append_message(&Message::user("next"), MAX_AGENT_TOOL_CALLS + 1),
            Err(AgentError::Decode(_))
        ));
        assert!(validate_tool_calls_per_turn(MAX_STREAM_TOOL_CALLS).is_ok());
        assert!(validate_tool_calls_per_turn(MAX_STREAM_TOOL_CALLS + 1).is_err());
        assert!(validate_completion_request(&too_many_messages).is_err());

        let excessive_context = CompletionRequest {
            messages: vec![Message::user("x".repeat(MAX_AGENT_CONTEXT_CHARS + 1))],
            ..Default::default()
        };
        assert!(validate_completion_request(&excessive_context).is_err());

        let excessive_images = CompletionRequest {
            messages: vec![Message {
                role: Role::User,
                content: (0..=MAX_AGENT_IMAGES)
                    .map(|_| ContentPart::Image {
                        image: "data:image/png;base64,AA".into(),
                    })
                    .collect(),
            }],
            ..Default::default()
        };
        assert!(validate_completion_request(&excessive_images).is_err());
    }

    #[test]
    fn a_tool_output_deserializes_with_or_without_images() {
        let plain: ToolOutput = serde_json::from_str(r#"{"output":"ok"}"#).unwrap();
        assert_eq!(plain, ToolOutput::text("ok"));

        let with_images: ToolOutput =
            serde_json::from_str(r#"{"output":"ok","images":["data:image/png;base64,AA"]}"#)
                .unwrap();
        assert_eq!(with_images.images.len(), 1);
    }
}
