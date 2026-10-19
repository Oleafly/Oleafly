//! Auto-compaction: when the context window is exhausted and the turn must
//! continue, the older history is summarized in one non-streaming provider
//! call and replaced by the summary plus a short kept tail. The summary is
//! injected before the kept tail so the most recent user message is never
//! summarized away.

use serde_json::Value;

use crate::complete::{CompletionRequest, Usage};
use crate::effort::Effort;
use crate::error::Result;
use crate::message::{ContentPart, Message};
use crate::provider::Resolved;
use crate::tasks::CancellationToken;

pub(crate) const KEEP_LAST_MESSAGES: usize = 10;

pub(crate) const DEFAULT_COMPACT_PROMPT: &str = "Summarize the conversation \
above for your own continued use. Preserve: the user's goal and constraints, \
decisions made, files or resources already read or changed (with paths), \
open problems, and the exact next steps in flight. Be terse and factual; \
omit pleasantries. This summary replaces the earlier transcript, so anything \
you omit is gone.";

// The summarizer's input must itself fit in one provider call: compaction
// runs precisely because the history grew too large, so shipping it verbatim
// fails in the one case that matters. Newest messages win the budget.
pub(crate) const SUMMARY_INPUT_CHAR_BUDGET: usize = 400_000;
/// The summary's own output ceiling.
pub(crate) const SUMMARY_MAX_TOKENS: u32 = 16_000;
/// Web results named in a summary-input marker.
const MAX_SUMMARY_RESULTS: usize = 5;

fn block_text(block: &Value, key: &str) -> String {
    block
        .get(key)
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string()
}

/// A server block as plain text the summarizer can read.
fn provider_block_text(block: &Value) -> String {
    match block
        .get("type")
        .and_then(Value::as_str)
        .unwrap_or_default()
    {
        "server_tool_use" => match block_text(block, "name").as_str() {
            "web_search" => format!(
                "[web_search: \"{}\"]",
                block
                    .pointer("/input/query")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
            ),
            "web_fetch" => format!(
                "[web_fetch: {}]",
                block
                    .pointer("/input/url")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
            ),
            name => format!("[{name} call]"),
        },
        "web_search_tool_result" => {
            let results: Vec<String> = block
                .get("content")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .take(MAX_SUMMARY_RESULTS)
                .map(|result| {
                    format!(
                        "{} ({})",
                        block_text(result, "title"),
                        block_text(result, "url")
                    )
                })
                .collect();
            format!("[web results: {}]", results.join("; "))
        }
        "web_fetch_tool_result" => format!(
            "[fetched {}]",
            block
                .pointer("/content/url")
                .and_then(Value::as_str)
                .unwrap_or_default()
        ),
        "text" => block_text(block, "text"),
        _ => "[provider block omitted]".to_string(),
    }
}

/// What the summarizer sees of a message: no thinking, media and server
/// blocks as short text markers.
fn summary_parts(message: &Message) -> Message {
    let content = message
        .content
        .iter()
        .filter_map(|part| match part {
            ContentPart::Image { .. } => Some(ContentPart::Text {
                text: "[image omitted from summary input]".to_string(),
            }),
            ContentPart::Thinking { .. } | ContentPart::RedactedThinking { .. } => None,
            ContentPart::Document { name, .. } => Some(ContentPart::Text {
                text: format!("[document \"{name}\" omitted from summary input]"),
            }),
            ContentPart::Attachment { name, .. } => Some(ContentPart::Text {
                text: format!("[attachment \"{name}\" omitted from summary input]"),
            }),
            ContentPart::ToolResult {
                id,
                name,
                output,
                images,
            } => {
                let mut output = output.clone();
                if !images.is_empty() {
                    output.push_str(&format!(
                        "\n[{} image(s) omitted from summary input]",
                        images.len()
                    ));
                }
                Some(ContentPart::ToolResult {
                    id: id.clone(),
                    name: name.clone(),
                    output,
                    images: Vec::new(),
                })
            }
            ContentPart::ProviderBlock { block, .. } => Some(ContentPart::Text {
                text: provider_block_text(block),
            }),
            other => Some(other.clone()),
        })
        .collect();
    Message {
        role: message.role,
        content,
    }
}

fn message_chars(message: &Message) -> usize {
    message
        .content
        .iter()
        .map(|part| match part {
            ContentPart::Text { text } => text.len(),
            ContentPart::Image { image } => image.len(),
            ContentPart::ToolUse {
                name, arguments, ..
            } => name.len() + arguments.len(),
            ContentPart::ToolResult { name, output, .. } => name.len() + output.len(),
            ContentPart::Thinking { thinking, .. } => thinking.len(),
            ContentPart::ProviderBlock { block, .. } => block.to_string().len(),
            ContentPart::RedactedThinking { .. }
            | ContentPart::Document { .. }
            | ContentPart::Attachment { .. } => 0,
        })
        .sum()
}

fn truncate_to(message: &mut Message, budget: usize) {
    let mut remaining = budget;
    for part in &mut message.content {
        let text = match part {
            ContentPart::Text { text } => text,
            ContentPart::ToolResult { output, .. } => output,
            ContentPart::ToolUse { arguments, .. } => arguments,
            _ => continue,
        };
        if text.len() <= remaining {
            remaining -= text.len();
            continue;
        }
        let mut cut = remaining;
        while cut > 0 && !text.is_char_boundary(cut) {
            cut -= 1;
        }
        text.truncate(cut);
        remaining = 0;
    }
}

/// Drop leading messages whose tool result has no matching tool use inside
/// the selection. Newest-first budgeting can slice a tool-use/result pair in
/// half, and a provider rejects a tool result that opens the conversation
/// without its call, so the summary request would fail exactly when it is
/// needed most.
fn strip_leading_orphan_tool_results(messages: &mut Vec<Message>) {
    use std::collections::HashSet;
    let uses: HashSet<&str> = messages
        .iter()
        .flat_map(|message| &message.content)
        .filter_map(|part| match part {
            ContentPart::ToolUse { id, .. } => Some(id.as_str()),
            _ => None,
        })
        .collect();
    let orphan_result = |message: &Message| {
        message.content.iter().any(|part| {
            matches!(part, ContentPart::ToolResult { id, .. } if !uses.contains(id.as_str()))
        })
    };
    let drop_count = messages
        .iter()
        .take_while(|message| orphan_result(message))
        .count();
    messages.drain(..drop_count);
}

/// Newest-first selection of the history the summarizer sees: images become a
/// marker, whole oldest messages fall off once the character budget, the
/// message cap or the tool-call cap is spent, and a single oversized message
/// is truncated rather than shipped verbatim. The caps are the ones every
/// request is checked against, so a history compacted for reaching the
/// message cap still yields a summary request that fits.
pub(crate) fn summarizable_messages(messages: &[Message]) -> Vec<Message> {
    use crate::session::context_window::{MAX_AGENT_MESSAGES, MAX_AGENT_TOOL_CALLS};
    let mut kept: Vec<Message> = Vec::new();
    let mut chars = 0usize;
    let mut tool_calls = 0usize;
    for message in messages.iter().rev() {
        let mut candidate = summary_parts(message);
        if candidate.content.is_empty() {
            continue;
        }
        let calls = candidate
            .content
            .iter()
            .filter(|part| matches!(part, ContentPart::ToolUse { .. }))
            .count();
        if !kept.is_empty()
            && (kept.len() == MAX_AGENT_MESSAGES || tool_calls + calls > MAX_AGENT_TOOL_CALLS)
        {
            break;
        }
        let cost = message_chars(&candidate);
        if chars + cost > SUMMARY_INPUT_CHAR_BUDGET {
            if kept.is_empty() {
                truncate_to(&mut candidate, SUMMARY_INPUT_CHAR_BUDGET);
                kept.push(candidate);
            }
            break;
        }
        chars += cost;
        tool_calls += calls;
        kept.push(candidate);
    }
    kept.reverse();
    strip_leading_orphan_tool_results(&mut kept);
    kept
}

/// Summarize the full history into a compact continuation text. Runs under
/// the turn's cancellation token so an interrupt does not wait on the
/// summarization call.
pub(crate) async fn compact_history(
    client: &reqwest::Client,
    resolved: &Resolved,
    request: &CompletionRequest,
    token: &CancellationToken,
) -> Result<(String, Usage)> {
    let summary_request = summary_request(&request.messages, &resolved.caps);
    let call = crate::complete(client, resolved, &summary_request);
    tokio::select! {
        response = call => response.map(|response| (response.text, response.usage)),
        _ = token.cancelled() => Err(crate::error::AgentError::Cancelled),
    }
}

/// The one-shot request that summarizes `messages`: low effort, no visible
/// reasoning, no tools or web, and no more output than the model allows.
pub(crate) fn summary_request(
    messages: &[Message],
    caps: &crate::caps::ModelCaps,
) -> CompletionRequest {
    CompletionRequest {
        system: Some(DEFAULT_COMPACT_PROMPT.to_string()),
        messages: summarizable_messages(messages),
        tools: Vec::new(),
        effort: Some(Effort::Low),
        reasoning_summary: Some(false),
        max_tokens: Some(crate::wire::reasoning::default_max_tokens(
            caps,
            SUMMARY_MAX_TOKENS,
        )),
        web: None,
        ..CompletionRequest::default()
    }
}

/// Rewrite the request around the summary: `[summary, …kept tail]`. The
/// stateless Responses continuation cannot survive summarization, so it is
/// dropped and rebuilt from messages on the next tool turn. Returns how many
/// messages were summarized away.
pub(crate) fn apply_compaction(request: &mut CompletionRequest, summary: String) -> usize {
    let tail_start = compaction_tail_start(&request.messages);
    let dropped = tail_start;
    let mut tail = request.messages.split_off(tail_start);
    // Thinking is bound to the history before it, which the summary
    // replaces; it is removed rather than replayed against a new prefix.
    for message in &mut tail {
        message.content.retain(|part| {
            !matches!(
                part,
                ContentPart::Thinking { .. } | ContentPart::RedactedThinking { .. }
            )
        });
    }
    tail.retain(|message| !message.content.is_empty());
    request.messages.clear();
    request.messages.push(Message::user(format!(
        "<context_compaction>\n{summary}\n</context_compaction>"
    )));
    request.messages.extend(tail);
    request.openai_responses_input = None;
    dropped
}

/// The id of a tool call, client or server.
fn call_id(part: &ContentPart) -> Option<&str> {
    match part {
        ContentPart::ToolUse { id, .. } => Some(id.as_str()),
        ContentPart::ProviderBlock { block, .. }
            if block.get("type").and_then(Value::as_str) == Some("server_tool_use") =>
        {
            block.get("id").and_then(Value::as_str)
        }
        _ => None,
    }
}

/// The call a result answers, client or server.
fn result_id(part: &ContentPart) -> Option<&str> {
    match part {
        ContentPart::ToolResult { id, .. } => Some(id.as_str()),
        ContentPart::ProviderBlock { block, .. } => {
            block.get("tool_use_id").and_then(Value::as_str)
        }
        _ => None,
    }
}

fn compaction_tail_start(messages: &[Message]) -> usize {
    let mut start = messages.len().saturating_sub(KEEP_LAST_MESSAGES);
    loop {
        let tail_uses: std::collections::HashSet<&str> = messages[start..]
            .iter()
            .flat_map(|message| &message.content)
            .filter_map(call_id)
            .collect();
        let tail_results: std::collections::HashSet<&str> = messages[start..]
            .iter()
            .flat_map(|message| &message.content)
            .filter_map(result_id)
            .filter(|id| !tail_uses.contains(id))
            .collect();
        let earlier_use = messages[..start]
            .iter()
            .enumerate()
            .filter(|(_, message)| {
                message
                    .content
                    .iter()
                    .filter_map(call_id)
                    .any(|id| tail_results.contains(id))
            })
            .map(|(index, _)| index)
            .min();
        match earlier_use {
            Some(index) => start = index,
            None => return start,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::message::{ContentPart, Role};

    fn request_with(n: usize) -> CompletionRequest {
        CompletionRequest {
            messages: (0..n)
                .map(|i| Message::user(format!("message {i}")))
                .collect(),
            openai_responses_input: Some(vec![serde_json::json!({"type": "message"})]),
            ..CompletionRequest::default()
        }
    }

    fn text_of(message: &Message) -> &str {
        match &message.content[0] {
            crate::message::ContentPart::Text { text } => text,
            other => panic!("expected a text part, got {other:?}"),
        }
    }

    #[test]
    fn compaction_keeps_the_tail_and_injects_the_summary_before_it() {
        let mut request = request_with(25);
        let dropped = apply_compaction(&mut request, "the summary".into());

        assert_eq!(dropped, 15);
        assert_eq!(request.messages.len(), KEEP_LAST_MESSAGES + 1);
        // Summary first, then the untouched tail in order.
        assert!(text_of(&request.messages[0]).contains("the summary"));
        assert!(text_of(&request.messages[0]).contains("<context_compaction>"));
        assert!(text_of(&request.messages[1]).contains("message 15"));
        assert!(text_of(request.messages.last().unwrap()).contains("message 24"));
        // The stateless continuation cannot survive summarization.
        assert!(request.openai_responses_input.is_none());
    }

    #[test]
    fn compaction_of_a_short_history_keeps_everything_and_adds_the_summary() {
        let mut request = request_with(3);
        let dropped = apply_compaction(&mut request, "s".into());
        assert_eq!(dropped, 0);
        assert_eq!(request.messages.len(), 4);
        assert_eq!(request.messages[0].role, Role::User);
        assert!(text_of(&request.messages[1]).contains("message 0"));
    }

    #[test]
    fn compaction_keeps_a_tool_use_with_its_result_across_the_tail_boundary() {
        let mut request = request_with(12);
        request.messages[1] = Message {
            role: Role::Assistant,
            content: vec![ContentPart::ToolUse {
                id: "call-1".into(),
                name: "read_file".into(),
                arguments: r#"{"path":"main.tex"}"#.into(),
                thought_signature: None,
            }],
        };
        request.messages[2] = Message {
            role: Role::User,
            content: vec![ContentPart::ToolResult {
                id: "call-1".into(),
                name: "read_file".into(),
                output: "contents".into(),
                images: Vec::new(),
            }],
        };

        let dropped = apply_compaction(&mut request, "summary".into());

        assert_eq!(dropped, 1);
        assert!(matches!(
            request.messages[1].content.as_slice(),
            [ContentPart::ToolUse { id, .. }] if id == "call-1"
        ));
        assert!(matches!(
            request.messages[2].content.as_slice(),
            [ContentPart::ToolResult { id, .. }] if id == "call-1"
        ));
    }

    #[test]
    fn summary_input_drops_oldest_beyond_the_budget() {
        let messages = vec![
            Message::user("x".repeat(SUMMARY_INPUT_CHAR_BUDGET)),
            Message::user("recent-1".to_string()),
            Message::user("recent-2".to_string()),
        ];
        let kept = summarizable_messages(&messages);
        assert_eq!(kept.len(), 2);
        assert_eq!(text_of(&kept[0]), "recent-1");
        assert_eq!(text_of(&kept[1]), "recent-2");
    }

    #[test]
    fn summary_input_truncates_a_single_oversized_message() {
        let messages = vec![Message::user("y".repeat(SUMMARY_INPUT_CHAR_BUDGET + 5))];
        let kept = summarizable_messages(&messages);
        assert_eq!(kept.len(), 1);
        assert_eq!(text_of(&kept[0]).len(), SUMMARY_INPUT_CHAR_BUDGET);
    }

    #[test]
    fn summary_input_drops_a_leading_orphan_tool_result() {
        // The budget kept the result but its call fell off the front.
        let messages = vec![
            Message {
                role: Role::User,
                content: vec![ContentPart::ToolResult {
                    id: "call-9".into(),
                    name: "read_file".into(),
                    output: "orphaned".into(),
                    images: Vec::new(),
                }],
            },
            Message::user("recent".to_string()),
        ];
        let kept = summarizable_messages(&messages);
        assert_eq!(kept.len(), 1);
        assert_eq!(text_of(&kept[0]), "recent");
    }

    #[test]
    fn summary_input_keeps_a_result_whose_call_survived() {
        let messages = vec![
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
                    output: "kept".into(),
                    images: Vec::new(),
                }],
            },
        ];
        let kept = summarizable_messages(&messages);
        assert_eq!(kept.len(), 2);
    }

    #[test]
    fn a_history_over_the_message_cap_gets_a_summary_request_that_fits() {
        use crate::session::context_window::{validate_completion_request, MAX_AGENT_MESSAGES};
        let long = request_with(MAX_AGENT_MESSAGES + 1);
        assert!(validate_completion_request(&long).is_err());

        let summary = summary_request(&long.messages, &crate::caps::ModelCaps::default());
        assert_eq!(summary.messages.len(), MAX_AGENT_MESSAGES);
        assert_eq!(text_of(&summary.messages[0]), "message 1");
        validate_completion_request(&summary).unwrap();
    }

    #[test]
    fn a_history_over_the_tool_call_cap_gets_a_summary_request_that_fits() {
        use crate::session::context_window::validate_completion_request;
        // 50 turns of six calls each: 300 calls in 100 messages, over the
        // 256-call cap.
        let mut messages = Vec::new();
        for turn in 0..50 {
            let ids: Vec<String> = (0..6).map(|n| format!("call-{turn}-{n}")).collect();
            messages.push(Message {
                role: Role::Assistant,
                content: ids
                    .iter()
                    .map(|id| ContentPart::ToolUse {
                        id: id.clone(),
                        name: "read_file".into(),
                        arguments: "{}".into(),
                        thought_signature: None,
                    })
                    .collect(),
            });
            messages.push(Message {
                role: Role::User,
                content: ids
                    .iter()
                    .map(|id| ContentPart::tool_result(id.clone(), "read_file", "ok"))
                    .collect(),
            });
        }

        let summary = summary_request(&messages, &crate::caps::ModelCaps::default());
        validate_completion_request(&summary).unwrap();
        // The newest 42 turns fit (252 calls); the 43rd turn's results lost
        // their call and went with it.
        assert_eq!(summary.messages.len(), 84);
        assert!(matches!(
            &summary.messages[0].content[0],
            ContentPart::ToolUse { id, .. } if id == "call-8-0"
        ));
    }

    #[test]
    fn a_provider_context_overflow_is_recognized() {
        use crate::error::AgentError;
        assert!(AgentError::Provider {
            status: 400,
            message: "This model's maximum context length is 8192 tokens".into(),
        }
        .is_context_overflow());
        assert!(AgentError::Provider {
            status: 413,
            message: "prompt is too long".into(),
        }
        .is_context_overflow());
        assert!(!AgentError::Provider {
            status: 400,
            message: "invalid api key".into(),
        }
        .is_context_overflow());
        assert!(!AgentError::Provider {
            status: 500,
            message: "context length exceeded".into(),
        }
        .is_context_overflow());
    }

    #[test]
    fn summary_input_strips_images() {
        let messages = vec![Message {
            role: Role::User,
            content: vec![ContentPart::Image {
                image: "data:image/png;base64,AAAA".to_string(),
            }],
        }];
        let kept = summarizable_messages(&messages);
        assert!(text_of(&kept[0]).contains("image omitted"));
    }

    fn provider(block: serde_json::Value) -> ContentPart {
        ContentPart::ProviderBlock {
            wire: crate::message::ProviderWire::Anthropic,
            block,
        }
    }

    fn history_with_thinking_tail() -> CompletionRequest {
        let mut request = request_with(25);
        request.messages[22] = Message {
            role: Role::Assistant,
            content: vec![
                ContentPart::Thinking {
                    thinking: "plan".into(),
                    signature: "sig".into(),
                },
                ContentPart::text("Reading."),
                ContentPart::ToolUse {
                    id: "t1".into(),
                    name: "read_file".into(),
                    arguments: "{}".into(),
                    thought_signature: None,
                },
                provider(
                    serde_json::json!({"type":"server_tool_use","id":"srvtoolu_1","name":"web_search","input":{"query":"q"}}),
                ),
            ],
        };
        request.messages[23] = Message {
            role: Role::User,
            content: vec![ContentPart::tool_result("t1", "read_file", "ok")],
        };
        request
    }

    #[test]
    fn compaction_strips_thinking_from_the_kept_tail_only() {
        let mut request = history_with_thinking_tail();
        apply_compaction(&mut request, "summary".into());
        assert!(!request
            .messages
            .iter()
            .flat_map(|message| &message.content)
            .any(|part| matches!(
                part,
                ContentPart::Thinking { .. } | ContentPart::RedactedThinking { .. }
            )));
        assert!(request
            .messages
            .iter()
            .flat_map(|message| &message.content)
            .any(|part| matches!(part, ContentPart::ProviderBlock { .. })));
    }

    #[test]
    fn summary_input_has_no_thinking_and_describes_server_tools_in_text() {
        let request = history_with_thinking_tail();
        let input = summarizable_messages(&request.messages);
        let parts: Vec<&ContentPart> = input.iter().flat_map(|message| &message.content).collect();
        assert!(!parts.iter().any(|part| matches!(
            part,
            ContentPart::Thinking { .. } | ContentPart::ProviderBlock { .. }
        )));
        assert!(parts.iter().any(
            |part| matches!(part, ContentPart::Text { text } if text == "[web_search: \"q\"]")
        ));
    }

    #[test]
    fn compaction_keeps_a_server_tool_call_with_its_result() {
        let mut request = request_with(25);
        request.messages[13] = Message {
            role: Role::Assistant,
            content: vec![provider(
                serde_json::json!({"type":"server_tool_use","id":"srvtoolu_9","name":"web_fetch","input":{"url":"https://e.org"}}),
            )],
        };
        request.messages[15] = Message {
            role: Role::Assistant,
            content: vec![
                provider(
                    serde_json::json!({"type":"web_fetch_tool_result","tool_use_id":"srvtoolu_9","content":{"type":"web_fetch_result","url":"https://e.org"}}),
                ),
                ContentPart::text("Read it."),
            ],
        };
        assert_eq!(compaction_tail_start(&request.messages), 13);
    }

    #[test]
    fn the_summary_request_runs_at_low_effort() {
        let request = summary_request(&[Message::user("x")], &crate::caps::ModelCaps::default());
        assert_eq!(
            (
                request.effort,
                request.reasoning_summary,
                request.max_tokens
            ),
            (Some(Effort::Low), Some(false), Some(16_000))
        );
        assert!(request.tools.is_empty() && request.web.is_none());
    }

    #[test]
    fn the_summary_fits_the_models_output_limit() {
        let limited = crate::caps::ModelCaps {
            output_limit: Some(4_096),
            ..crate::caps::ModelCaps::default()
        };
        assert_eq!(
            summary_request(&[Message::user("x")], &limited).max_tokens,
            Some(4_096)
        );
        let large = crate::caps::ModelCaps {
            output_limit: Some(64_000),
            ..crate::caps::ModelCaps::default()
        };
        assert_eq!(
            summary_request(&[Message::user("x")], &large).max_tokens,
            Some(16_000)
        );
    }

    #[test]
    fn tool_images_and_documents_become_markers_in_the_summary_input() {
        let message = Message {
            role: Role::User,
            content: vec![
                ContentPart::ToolResult {
                    id: "t".into(),
                    name: "n".into(),
                    output: "out".into(),
                    images: vec!["data:image/png;base64,AA".into(); 2],
                },
                ContentPart::Document {
                    mime: "application/pdf".into(),
                    data: "JVBE".into(),
                    name: "paper.pdf".into(),
                },
            ],
        };
        let input = summarizable_messages(&[
            Message {
                role: Role::Assistant,
                content: vec![ContentPart::ToolUse {
                    id: "t".into(),
                    name: "n".into(),
                    arguments: "{}".into(),
                    thought_signature: None,
                }],
            },
            message,
        ]);
        let last = &input.last().unwrap().content;
        assert!(matches!(
            &last[0],
            ContentPart::ToolResult { output, images, .. }
                if images.is_empty() && output.ends_with("[2 image(s) omitted from summary input]")
        ));
        assert!(matches!(
            &last[1],
            ContentPart::Text { text } if text == "[document \"paper.pdf\" omitted from summary input]"
        ));
    }
}
