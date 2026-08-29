//! Run facade: the public agent-run API. The turn loop lives in
//! `session::turn`, context-window accounting in `session::context_window`,
//! compaction in `session::compact`, and tool execution policy in `tools`.

use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;
use std::time::Duration;

use serde::{Deserialize, Serialize};

use crate::complete::{CompletionRequest, Usage};
use crate::error::{AgentError, Result};
use crate::event::AgentEvent;
use crate::provider::Resolved;
use crate::stream::ToolCall;
use crate::tasks::CancellationToken;
use crate::tools::parallel::ToolGate;
use crate::tools::registry::ToolRegistry;

const MAX_AGENT_RUN_DURATION: Duration = Duration::from_secs(30 * 60);
pub(crate) const MAX_TOOL_OUTPUT_TEXT_BYTES: usize = 64 * 1024;
const MAX_TOOL_OUTPUT_IMAGES: usize = 6;
const MAX_TOOL_IMAGE_DATA_URL_BYTES: usize = 14 * 1024 * 1024;
const MAX_TOOL_OUTPUT_IMAGE_BYTES: usize = 84 * 1024 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RunConfig {
    pub max_steps: u32,
    pub max_retries: u32,
    pub retry_base_ms: u64,
    /// Summarize older history instead of failing when the context window is
    /// exhausted mid-turn.
    #[serde(default = "default_auto_compact")]
    pub auto_compact: bool,
}

fn default_auto_compact() -> bool {
    true
}

impl Default for RunConfig {
    fn default() -> Self {
        RunConfig {
            max_steps: 50,
            max_retries: 4,
            retry_base_ms: 800,
            auto_compact: true,
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

/// Execution context one agent run shares across every tool batch: the
/// registry carrying per-tool parallel policy, the single gate serializing
/// exclusive tools, and the run's cancellation token. Defaults preserve the
/// historical behavior (unknown tools serialize; no cancellation source).
#[derive(Clone, Default)]
pub struct ToolPipeline {
    pub registry: ToolRegistry,
    pub gate: ToolGate,
    pub token: CancellationToken,
}

impl ToolPipeline {
    pub fn from_registry(registry: ToolRegistry) -> Self {
        Self {
            registry,
            gate: ToolGate::new(),
            token: CancellationToken::new(),
        }
    }
}

/// The sender half of a run's steer channel: the shell injects mid-run user
/// input and the turn loop delivers it at the next message boundary.
#[derive(Clone)]
pub struct SteerHandle {
    tx: std::sync::Arc<tokio::sync::mpsc::UnboundedSender<String>>,
}

impl SteerHandle {
    pub fn channel() -> (Self, tokio::sync::mpsc::UnboundedReceiver<String>) {
        let (tx, rx) = tokio::sync::mpsc::unbounded_channel();
        (
            Self {
                tx: std::sync::Arc::new(tx),
            },
            rx,
        )
    }

    pub fn steer(&self, text: impl Into<String>) {
        let _ = self.tx.send(text.into());
    }
}

pub fn validate_completion_request(request: &CompletionRequest) -> Result<()> {
    crate::session::context_window::validate_completion_request(request)
}

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

pub fn bound_tool_output(output: ToolOutput) -> ToolOutput {
    sanitize_tool_output(output, ToolOutputLimits::default())
}

pub(crate) fn tool_output_payload_bytes(output: &ToolOutput) -> Result<usize> {
    output
        .images
        .iter()
        .try_fold(output.output.len(), |total, image| {
            total.checked_add(image.len()).ok_or_else(|| {
                crate::session::context_window::history_limit_error("tool result batch")
            })
        })
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
    run_agent_with_pipeline(
        client,
        resolved,
        request,
        config,
        ToolPipeline::default(),
        None,
        run_tool,
        on_event,
    )
    .await
}

/// Like `run_agent`, but the caller supplies the tool pipeline (per-tool
/// parallel policy, shared gate, cancellation token) the run executes under
/// and may pass the receiver half of a steer channel for mid-run input.
#[allow(clippy::too_many_arguments)] // Turn plumbing; each arg is load-bearing.
pub async fn run_agent_with_pipeline<F>(
    client: &reqwest::Client,
    resolved: &Resolved,
    request: CompletionRequest,
    config: &RunConfig,
    pipeline: ToolPipeline,
    steer_rx: Option<tokio::sync::mpsc::UnboundedReceiver<String>>,
    run_tool: ToolRunner,
    on_event: F,
) -> Result<RunOutcome>
where
    F: FnMut(AgentEvent) + Send,
{
    tokio::time::timeout(
        MAX_AGENT_RUN_DURATION,
        crate::session::turn::run_turn(
            client, resolved, request, config, &pipeline, steer_rx, run_tool, on_event,
        ),
    )
    .await
    .map_err(|_| AgentError::Timeout)?
}

#[cfg(test)]
mod tests {
    use super::*;

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
    fn a_tool_output_deserializes_with_or_without_images() {
        let plain: ToolOutput = serde_json::from_str(r#"{"output":"ok"}"#).unwrap();
        assert_eq!(plain, ToolOutput::text("ok"));

        let with_images: ToolOutput =
            serde_json::from_str(r#"{"output":"ok","images":["data:image/png;base64,AA"]}"#)
                .unwrap();
        assert_eq!(with_images.images.len(), 1);
    }

    #[test]
    fn run_config_deserializes_without_the_compaction_flag_for_old_callers() {
        let config: RunConfig =
            serde_json::from_str(r#"{"max_steps": 10, "max_retries": 2, "retry_base_ms": 500}"#)
                .unwrap();
        assert_eq!(config.max_steps, 10);
        assert!(config.auto_compact);
    }
}
