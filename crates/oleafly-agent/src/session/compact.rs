//! Auto-compaction: when the context window is exhausted and the turn must
//! continue, the older history is summarized in one non-streaming provider
//! call and replaced by the summary plus a short kept tail. The summary is
//! injected before the kept tail so the most recent user message is never
//! summarized away.

use crate::complete::{CompletionRequest, Usage};
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

fn strip_images(message: &Message) -> Message {
    Message {
        role: message.role,
        content: message
            .content
            .iter()
            .map(|part| match part {
                ContentPart::Image { .. } => ContentPart::Text {
                    text: "[image omitted from summary input]".to_string(),
                },
                other => other.clone(),
            })
            .collect(),
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
            ContentPart::Image { .. } => continue,
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
/// marker, whole oldest messages fall off once the character budget is spent,
/// and a single oversized message is truncated rather than shipped verbatim.
pub(crate) fn summarizable_messages(messages: &[Message]) -> Vec<Message> {
    let mut kept: Vec<Message> = Vec::new();
    let mut chars = 0usize;
    for message in messages.iter().rev() {
        let mut candidate = strip_images(message);
        let cost = message_chars(&candidate);
        if chars + cost > SUMMARY_INPUT_CHAR_BUDGET {
            if kept.is_empty() {
                truncate_to(&mut candidate, SUMMARY_INPUT_CHAR_BUDGET);
                kept.push(candidate);
            }
            break;
        }
        chars += cost;
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
    let summary_request = CompletionRequest {
        system: Some(DEFAULT_COMPACT_PROMPT.to_string()),
        messages: summarizable_messages(&request.messages),
        tools: Vec::new(),
        ..CompletionRequest::default()
    };
    let call = crate::complete(client, resolved, &summary_request);
    tokio::select! {
        response = call => response.map(|response| (response.text, response.usage)),
        _ = token.cancelled() => Err(crate::error::AgentError::Cancelled),
    }
}

/// Rewrite the request around the summary: `[summary, …kept tail]`. The
/// stateless Responses continuation cannot survive summarization, so it is
/// dropped and rebuilt from messages on the next tool turn. Returns how many
/// messages were summarized away.
pub(crate) fn apply_compaction(request: &mut CompletionRequest, summary: String) -> usize {
    let tail_start = compaction_tail_start(&request.messages);
    let dropped = tail_start;
    let tail = request.messages.split_off(tail_start);
    request.messages.clear();
    request.messages.push(Message::user(format!(
        "<context_compaction>\n{summary}\n</context_compaction>"
    )));
    request.messages.extend(tail);
    request.openai_responses_input = None;
    dropped
}

fn compaction_tail_start(messages: &[Message]) -> usize {
    let mut start = messages.len().saturating_sub(KEEP_LAST_MESSAGES);
    loop {
        let tail_uses: std::collections::HashSet<&str> = messages[start..]
            .iter()
            .flat_map(|message| &message.content)
            .filter_map(|part| match part {
                ContentPart::ToolUse { id, .. } => Some(id.as_str()),
                _ => None,
            })
            .collect();
        let tail_results: std::collections::HashSet<&str> = messages[start..]
            .iter()
            .flat_map(|message| &message.content)
            .filter_map(|part| match part {
                ContentPart::ToolResult { id, .. } if !tail_uses.contains(id.as_str()) => {
                    Some(id.as_str())
                }
                _ => None,
            })
            .collect();
        let earlier_use = messages[..start]
            .iter()
            .enumerate()
            .filter(|(_, message)| {
                message.content.iter().any(|part| {
                    matches!(part, ContentPart::ToolUse { id, .. } if tail_results.contains(id.as_str()))
                })
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
                }],
            },
        ];
        let kept = summarizable_messages(&messages);
        assert_eq!(kept.len(), 2);
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
}
