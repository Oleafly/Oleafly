//! Auto-compaction: when the context window is exhausted and the turn must
//! continue, the older history is summarized in one non-streaming provider
//! call and replaced by the summary plus a short kept tail. The summary is
//! injected before the kept tail so the most recent user message is never
//! summarized away.

use crate::complete::CompletionRequest;
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

/// Summarize the full history into a compact continuation text. Runs under
/// the turn's cancellation token so an interrupt does not wait on the
/// summarization call.
pub(crate) async fn compact_history(
    client: &reqwest::Client,
    resolved: &Resolved,
    request: &CompletionRequest,
    token: &CancellationToken,
) -> Result<String> {
    let summary_request = CompletionRequest {
        system: Some(DEFAULT_COMPACT_PROMPT.to_string()),
        messages: request.messages.clone(),
        tools: Vec::new(),
        ..CompletionRequest::default()
    };
    let call = crate::complete(client, resolved, &summary_request);
    tokio::select! {
        response = call => Ok(response?.text),
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
}
