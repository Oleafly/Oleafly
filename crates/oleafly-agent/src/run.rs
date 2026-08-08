use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;
use std::time::Duration;

use serde::{Deserialize, Serialize};

use crate::complete::{CompletionRequest, Usage};
use crate::error::{AgentError, Result};
use crate::event::AgentEvent;
use crate::message::{ContentPart, Message, Role};
use crate::provider::Resolved;
use crate::stream::{stream_completion, StreamOutcome, ToolCall};

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

fn should_retry(error: &AgentError, attempt: u32, max_retries: u32, saw_output: bool) -> bool {
    error.retryable() && attempt < max_retries && !saw_output
}

pub async fn run_agent<F>(
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

    for step in 0..config.max_steps {
        on_event(AgentEvent::StepStart { step });

        let mut turn: Option<StreamOutcome> = None;
        let mut fatal: Option<AgentError> = None;

        for attempt in 0..=config.max_retries {
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
                stream_completion(client, resolved, &request, forward).await
            };

            match streamed {
                Ok(outcome) => {
                    turn = Some(outcome);
                    break;
                }
                Err(error) => {
                    if should_retry(&error, attempt, config.max_retries, saw_output) {
                        on_event(AgentEvent::Retry {
                            attempt: attempt + 1,
                            max: config.max_retries,
                        });
                        tokio::time::sleep(Duration::from_millis(
                            config.retry_base_ms * (attempt as u64 + 1),
                        ))
                        .await;
                        continue;
                    }
                    fatal = Some(error);
                    break;
                }
            }
        }

        let Some(outcome) = turn else {
            let error = fatal.unwrap_or(AgentError::Transport("stream failed".into()));
            result.error = Some(error.to_string());
            on_event(AgentEvent::Error {
                message: error.to_string(),
                retryable: error.retryable(),
            });
            return Ok(result);
        };

        result.usage.input += outcome.usage.input;
        result.usage.output += outcome.usage.output;
        result.steps += 1;
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

        request.messages.push(assistant_turn(&outcome));

        let mut results = Vec::with_capacity(outcome.tool_calls.len());
        for call in outcome.tool_calls {
            let output = run_tool(call.clone()).await;
            on_event(AgentEvent::ToolOutcome {
                id: call.id.clone(),
                output: output.output.clone(),
            });
            results.push((call, output));
        }
        request.messages.push(results_turn(results));
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
        assert!(should_retry(&error, 0, 4, false));
        assert!(!should_retry(&error, 0, 4, true));
        assert!(!should_retry(&error, 4, 4, false));

        let fatal = AgentError::Provider {
            status: 401,
            message: "bad key".into(),
        };
        assert!(!should_retry(&fatal, 0, 4, false));
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
