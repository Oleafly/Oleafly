//! Auto-compaction: when the context window is exhausted and the turn must
//! continue, the older history is summarized in one non-streaming provider
//! call and replaced by the summary plus a short kept tail. The summary is
//! injected before the kept tail so the most recent user message is never
//! summarized away.

use crate::complete::CompletionRequest;
use crate::error::Result;
use crate::message::Message;
use crate::provider::Resolved;
use crate::tasks::CancellationToken;

/// How many trailing messages survive a compaction verbatim.
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
    let keep = request.messages.len().min(KEEP_LAST_MESSAGES);
    let dropped = request.messages.len().saturating_sub(keep);
    let tail = request.messages.split_off(request.messages.len() - keep);
    request.messages.clear();
    request.messages.push(Message::user(format!(
        "<context_compaction>\n{summary}\n</context_compaction>"
    )));
    request.messages.extend(tail);
    request.openai_responses_input = None;
    dropped
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::message::Role;

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
}
