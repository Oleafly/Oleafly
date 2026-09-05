//! Run facade: the public agent-run API. The turn loop lives in
//! `session::turn`, context-window accounting in `session::context_window`,
//! compaction in `session::compact`, and tool execution policy in `tools`.

use std::future::Future;
use std::pin::Pin;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use serde::{Deserialize, Serialize};

use crate::complete::{CompletionRequest, Usage};
use crate::error::{AgentError, Result};
use crate::event::AgentEvent;
use crate::message::Message;
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
    tx: std::sync::Arc<tokio::sync::mpsc::UnboundedSender<SteeredInput>>,
}

pub struct SteeredInput {
    pub(crate) message: Message,
    pub(crate) delivered: tokio::sync::oneshot::Sender<()>,
    claimed: Arc<AtomicBool>,
}

impl SteeredInput {
    pub(crate) fn try_claim(&self) -> bool {
        !self.claimed.swap(true, Ordering::AcqRel)
    }
}

struct SteerReceipt {
    claimed: Arc<AtomicBool>,
}

impl Drop for SteerReceipt {
    fn drop(&mut self) {
        self.claimed.store(true, Ordering::Release);
    }
}

impl SteerHandle {
    pub fn channel() -> (Self, tokio::sync::mpsc::UnboundedReceiver<SteeredInput>) {
        let (tx, rx) = tokio::sync::mpsc::unbounded_channel();
        (
            Self {
                tx: std::sync::Arc::new(tx),
            },
            rx,
        )
    }

    pub async fn steer(&self, message: Message) -> bool {
        let (delivered, receipt) = tokio::sync::oneshot::channel();
        let claimed = Arc::new(AtomicBool::new(false));
        let _receipt = SteerReceipt {
            claimed: claimed.clone(),
        };
        if self
            .tx
            .send(SteeredInput {
                message,
                delivered,
                claimed,
            })
            .is_err()
        {
            return false;
        }
        receipt.await.is_ok()
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
    steer_rx: Option<tokio::sync::mpsc::UnboundedReceiver<SteeredInput>>,
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
    use crate::message::{ContentPart, Message, Role};
    use crate::provider::Wire;
    use std::io::{Read, Write};
    use std::net::{TcpListener, TcpStream};
    use std::sync::{mpsc, Mutex};

    fn local_resolved(addr: std::net::SocketAddr) -> Resolved {
        Resolved {
            provider_id: "custom".into(),
            model_id: "test-model".into(),
            credential: String::new(),
            auth: None,
            wire: Wire::OpenAiChat {
                base_url: format!("http://{addr}/v1"),
                reasoning_content: false,
            },
        }
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
            let Some(header_end) = bytes.windows(4).position(|part| part == b"\r\n\r\n") else {
                continue;
            };
            let headers = String::from_utf8_lossy(&bytes[..header_end]);
            let content_length = headers
                .lines()
                .find_map(|line| {
                    let (name, value) = line.split_once(':')?;
                    name.eq_ignore_ascii_case("content-length")
                        .then(|| value.trim().parse::<usize>().ok())
                        .flatten()
                })
                .unwrap_or(0);
            if bytes.len() >= header_end + 4 + content_length {
                break;
            }
        }
        String::from_utf8_lossy(&bytes).into_owned()
    }

    fn respond(stream: &mut TcpStream, status: &str, content_type: &str, body: &str) {
        write!(
            stream,
            "HTTP/1.1 {status}\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
            body.len()
        )
        .unwrap();
        stream.flush().unwrap();
    }

    async fn receive_signal<T>(receiver: &mpsc::Receiver<T>) -> T {
        tokio::time::timeout(Duration::from_secs(2), async {
            loop {
                match receiver.try_recv() {
                    Ok(value) => return value,
                    Err(mpsc::TryRecvError::Empty) => {
                        tokio::time::sleep(Duration::from_millis(5)).await;
                    }
                    Err(mpsc::TryRecvError::Disconnected) => panic!("signal channel closed"),
                }
            }
        })
        .await
        .expect("signal timed out")
    }

    fn no_tools() -> ToolRunner {
        Arc::new(|_| Box::pin(async { ToolOutput::text("unused") }))
    }

    #[tokio::test]
    async fn compaction_usage_is_counted_once_and_missing_summary_usage_stays_unknown() {
        for (provider_overflow, summary_reported) in [(false, true), (false, false), (true, true)] {
            let listener = TcpListener::bind("127.0.0.1:0").unwrap();
            let address = listener.local_addr().unwrap();
            let server = std::thread::spawn(move || {
                let mut requests = Vec::new();
                if provider_overflow {
                    let (mut stream, _) = listener.accept().unwrap();
                    requests.push(read_request(&mut stream));
                    respond(&mut stream, "400 Bad Request", "application/json", "{\"error\":{\"message\":\"maximum context length exceeded\",\"code\":\"context_length_exceeded\"}}");
                }
                let (mut summary, _) = listener.accept().unwrap();
                requests.push(read_request(&mut summary));
                let mut body = serde_json::json!({"choices":[{"message":{"content":"summary"}}]});
                if summary_reported {
                    body["usage"] = serde_json::json!({"prompt_tokens":40,"completion_tokens":7,"prompt_tokens_details":{"cached_tokens":10}});
                }
                respond(
                    &mut summary,
                    "200 OK",
                    "application/json",
                    &body.to_string(),
                );
                let (mut sampled, _) = listener.accept().unwrap();
                requests.push(read_request(&mut sampled));
                respond(&mut sampled, "200 OK", "text/event-stream", "data: {\"choices\":[{\"delta\":{\"content\":\"answer\"}}],\"usage\":{\"prompt_tokens\":60,\"completion_tokens\":3,\"prompt_tokens_details\":{\"cached_tokens\":20}}}\n\ndata: [DONE]\n\n");
                requests
            });
            let mut request = CompletionRequest::prompt("system", "prompt");
            if !provider_overflow {
                request.messages = (0..129).map(|_| Message::user("x".repeat(4000))).collect();
            }
            let mut events = Vec::new();
            let outcome = tokio::time::timeout(
                Duration::from_secs(5),
                run_agent_with_pipeline(
                    &crate::build_client().unwrap(),
                    &local_resolved(address),
                    request,
                    &RunConfig {
                        max_steps: 1,
                        max_retries: 0,
                        ..RunConfig::default()
                    },
                    ToolPipeline::default(),
                    None,
                    no_tools(),
                    |event| events.push(event),
                ),
            )
            .await
            .unwrap()
            .unwrap();
            let requests = server.join().unwrap();
            assert_eq!(requests.len(), if provider_overflow { 3 } else { 2 });
            let summary_request: serde_json::Value = serde_json::from_str(
                requests[usize::from(provider_overflow)]
                    .split_once("\r\n\r\n")
                    .unwrap()
                    .1,
            )
            .unwrap();
            assert_ne!(summary_request["stream"], true);
            assert_eq!(outcome.steps, 1);
            assert_eq!(outcome.text, "answer");
            assert!(outcome.error.is_none());
            assert_eq!(outcome.usage.input, if summary_reported { 100 } else { 60 });
            assert_eq!(outcome.usage.output, if summary_reported { 10 } else { 3 });
            if summary_reported && !provider_overflow {
                assert_eq!(outcome.usage.reported_input(), Some(100));
                assert_eq!(outcome.usage.reported_output(), Some(10));
                assert_eq!(outcome.usage.cache_read, Some(30));
                assert_eq!(outcome.usage.cache_write, Some(0));
            } else {
                assert_eq!(outcome.usage.reported_input(), None);
                assert_eq!(outcome.usage.reported_output(), None);
            }
            assert_eq!(
                events
                    .iter()
                    .filter(|event| matches!(event, AgentEvent::Compacted { .. }))
                    .count(),
                1
            );
            let latest = events
                .iter()
                .rev()
                .find_map(|event| match event {
                    AgentEvent::Usage { usage } => Some(usage),
                    _ => None,
                })
                .unwrap();
            assert_eq!(*latest, outcome.usage);
        }
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

    #[tokio::test]
    async fn cancellation_interrupts_a_provider_wait() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        let (seen_tx, seen_rx) = mpsc::channel();
        let (release_tx, release_rx) = mpsc::channel();
        std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let _ = read_request(&mut stream);
            seen_tx.send(()).unwrap();
            let _ = release_rx.recv_timeout(Duration::from_secs(2));
        });

        let token = CancellationToken::new();
        let run_token = token.clone();
        let mut handle = tokio::spawn(async move {
            let client = crate::build_client().unwrap();
            let mut request = CompletionRequest::prompt("system", "prompt");
            request.timeout_ms = Some(5_000);
            run_agent_with_pipeline(
                &client,
                &local_resolved(addr),
                request,
                &RunConfig::default(),
                ToolPipeline {
                    token: run_token,
                    ..ToolPipeline::default()
                },
                None,
                no_tools(),
                |_| {},
            )
            .await
        });

        receive_signal(&seen_rx).await;
        token.cancel();
        let result = tokio::time::timeout(Duration::from_secs(1), &mut handle).await;
        let _ = release_tx.send(());
        let outcome = match result {
            Ok(result) => result.unwrap().unwrap(),
            Err(_) => {
                handle.abort();
                panic!("cancelled provider wait did not finish promptly");
            }
        };
        assert_eq!(outcome.error.as_deref(), Some("The request was cancelled."));
    }

    #[tokio::test]
    async fn cancellation_interrupts_retry_backoff() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let _ = read_request(&mut stream);
            respond(&mut stream, "503 Service Unavailable", "text/plain", "busy");
        });

        let token = CancellationToken::new();
        let run_token = token.clone();
        let (retry_tx, mut retry_rx) = tokio::sync::mpsc::unbounded_channel();
        let mut handle = tokio::spawn(async move {
            let client = crate::build_client().unwrap();
            run_agent_with_pipeline(
                &client,
                &local_resolved(addr),
                CompletionRequest::prompt("system", "prompt"),
                &RunConfig {
                    max_retries: 1,
                    retry_base_ms: 10_000,
                    ..RunConfig::default()
                },
                ToolPipeline {
                    token: run_token,
                    ..ToolPipeline::default()
                },
                None,
                no_tools(),
                move |event| {
                    if matches!(event, AgentEvent::Retry { .. }) {
                        let _ = retry_tx.send(());
                    }
                },
            )
            .await
        });

        tokio::time::timeout(Duration::from_secs(2), retry_rx.recv())
            .await
            .expect("retry event timed out")
            .expect("retry event channel closed");
        token.cancel();
        let result = tokio::time::timeout(Duration::from_secs(1), &mut handle).await;
        match result {
            Ok(result) => {
                let outcome = result.unwrap().unwrap();
                assert_eq!(outcome.error.as_deref(), Some("The request was cancelled."));
            }
            Err(_) => {
                handle.abort();
                panic!("cancelled retry backoff did not finish promptly");
            }
        }
    }

    #[tokio::test]
    async fn a_final_text_sample_delivers_the_full_steered_message_as_a_followup() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        let (first_tx, first_rx) = mpsc::channel();
        let (release_tx, release_rx) = mpsc::channel();
        let (second_tx, second_rx) = mpsc::channel();
        std::thread::spawn(move || {
            let (mut first, _) = listener.accept().unwrap();
            let _ = read_request(&mut first);
            first_tx.send(()).unwrap();
            release_rx.recv_timeout(Duration::from_secs(2)).unwrap();
            respond(
                &mut first,
                "200 OK",
                "text/event-stream",
                "data: {\"choices\":[{\"delta\":{\"content\":\"first\"}}]}\n\ndata: [DONE]\n\n",
            );

            let (mut second, _) = listener.accept().unwrap();
            second_tx.send(read_request(&mut second)).unwrap();
            respond(
                &mut second,
                "200 OK",
                "text/event-stream",
                "data: {\"choices\":[{\"delta\":{\"content\":\"second\"}}]}\n\ndata: [DONE]\n\n",
            );
        });

        let (steer, steer_rx) = SteerHandle::channel();
        let events = Arc::new(Mutex::new(Vec::new()));
        let event_sink = events.clone();
        let mut handle = tokio::spawn(async move {
            let client = crate::build_client().unwrap();
            run_agent_with_pipeline(
                &client,
                &local_resolved(addr),
                CompletionRequest::prompt("system", "prompt"),
                &RunConfig::default(),
                ToolPipeline::default(),
                Some(steer_rx),
                no_tools(),
                move |event| event_sink.lock().unwrap().push(event),
            )
            .await
        });

        receive_signal(&first_rx).await;
        let steer_task = tokio::spawn(async move {
            steer
                .steer(Message {
                    role: Role::User,
                    content: vec![
                        ContentPart::text("change direction"),
                        ContentPart::Image {
                            image: "data:image/png;base64,AA".into(),
                        },
                    ],
                })
                .await
        });
        tokio::task::yield_now().await;
        release_tx.send(()).unwrap();

        assert!(tokio::time::timeout(Duration::from_secs(2), steer_task)
            .await
            .expect("steer acknowledgement timed out")
            .unwrap());
        let second_request = receive_signal(&second_rx).await;
        assert!(second_request.contains("change direction"));
        assert!(second_request.contains("data:image/png;base64,AA"));
        let outcome = tokio::time::timeout(Duration::from_secs(2), &mut handle)
            .await
            .expect("followup turn timed out")
            .unwrap()
            .unwrap();
        assert_eq!(outcome.text, "second");
        assert!(events.lock().unwrap().iter().any(
            |event| matches!(event, AgentEvent::Steered { text } if text == "change direction")
        ));
    }
}
