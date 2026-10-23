//! Auto-compaction: when the context window is exhausted and the turn must
//! continue, the older history is summarized in one non-streaming provider
//! call and replaced by the summary plus a short kept tail. The summary is
//! injected before the kept tail so the most recent user message is never
//! summarized away.

use std::collections::HashSet;

use serde_json::Value;

use crate::complete::{CompletionRequest, CompletionResponse};
use crate::effort::Effort;
use crate::error::{AgentError, Result};
use crate::message::{ContentPart, Message, Role};
use crate::provider::Resolved;
use crate::stream::{is_output_limit_stop, is_refusal_stop};
use crate::tasks::CancellationToken;

pub(crate) const KEEP_LAST_MESSAGES: usize = 10;

/// The opening tag of the message that holds a summary in history.
const COMPACTION_OPEN: &str = "<context_compaction>";
const COMPACTION_CLOSE: &str = "</context_compaction>";

pub(crate) const DEFAULT_COMPACT_PROMPT: &str = "Summarize the conversation \
transcript in the user message for your own continued use. Preserve: the \
user's goal and constraints, decisions made, files or resources already read \
or changed (with paths), open problems, and the exact next steps in flight. \
If the transcript starts with an earlier <context_compaction> summary, carry \
forward what still matters from it. A line such as [12 messages omitted] marks \
history that did not fit; do not guess what it held. Be terse and factual; \
omit pleasantries. This summary replaces the earlier transcript, so anything \
you omit is gone. Reply with the summary only.";

// The summarizer's input must itself fit in one provider call: compaction
// runs precisely because the history grew too large, so shipping it verbatim
// fails in the one case that matters. The input is a plain-text transcript in
// one user message (a provider rejects tool calls without tools, and a
// conversation that does not open with a user turn), sized to the model's
// window. The first request and any earlier summary always stay in it; the
// newest messages win the rest of the budget.
/// The transcript budget in characters when the model's window is unknown.
pub(crate) const SUMMARY_INPUT_CHAR_BUDGET: usize = 400_000;
/// The most the transcript gets, however large the window.
const MAX_SUMMARY_INPUT_CHARS: usize = 1_000_000;
/// The least it gets, so a tiny window still sees something.
const MIN_SUMMARY_INPUT_CHARS: usize = 8_000;
/// Characters per token assumed when sizing the transcript: low, so code,
/// LaTeX and CJK text still fit the window.
const SUMMARY_CHARS_PER_TOKEN: usize = 2;
/// Tokens kept free for the instructions and the transcript's markup.
const SUMMARY_OVERHEAD_TOKENS: u32 = 4_000;
/// The summary's own output ceiling.
pub(crate) const SUMMARY_MAX_TOKENS: u32 = 16_000;
/// Web results named in a summary-input marker.
const MAX_SUMMARY_RESULTS: usize = 5;
/// What one tool call's arguments, one tool result and one text part add to
/// the transcript at most; the middle of a longer one is cut.
const MAX_TOOL_ARGUMENT_CHARS: usize = 2_000;
const MAX_TOOL_OUTPUT_CHARS: usize = 8_000;
const MAX_TEXT_CHARS: usize = 32_000;
const SEPARATOR: &str = "\n\n";
const TRUNCATED: &str = "\n[truncated]";

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

fn floor_boundary(text: &str, index: usize) -> usize {
    let mut index = index.min(text.len());
    while !text.is_char_boundary(index) {
        index -= 1;
    }
    index
}

fn ceil_boundary(text: &str, index: usize) -> usize {
    let mut index = index.min(text.len());
    while !text.is_char_boundary(index) {
        index += 1;
    }
    index
}

/// `text` within `max` bytes: when it is longer, its start and its end with
/// a note in between (a log or a file is most useful at both ends).
fn clip(text: &str, max: usize) -> String {
    if text.len() <= max {
        return text.to_string();
    }
    let head = floor_boundary(text, max / 3 * 2);
    let tail = ceil_boundary(text, text.len().saturating_sub(max - head));
    let omitted = text[head..tail].chars().count();
    format!(
        "{}\n[... {omitted} characters omitted ...]\n{}",
        &text[..head],
        &text[tail..]
    )
}

/// `text` cut to `max` bytes, with a note when it was longer.
fn hard_truncate(mut text: String, max: usize) -> String {
    if text.len() <= max {
        return text;
    }
    text.truncate(floor_boundary(&text, max.saturating_sub(TRUNCATED.len())));
    text.push_str(TRUNCATED);
    text
}

/// What the summarizer reads of one message, as plain lines: no thinking,
/// media and server blocks as short markers, tool calls and results as
/// sentences with their arguments and output cut to a sensible length.
/// `None` when nothing of the message is left.
fn render_message(message: &Message, text_cap: usize) -> Option<String> {
    let speaker = match message.role {
        Role::User => "User",
        Role::Assistant => "Assistant",
    };
    let lines: Vec<String> = message
        .content
        .iter()
        .filter_map(|part| match part {
            ContentPart::Text { text } => {
                let text = text.trim();
                (!text.is_empty()).then(|| format!("{speaker}: {}", clip(text, text_cap)))
            }
            ContentPart::Image { .. } => {
                Some(format!("{speaker}: [image omitted from summary input]"))
            }
            ContentPart::Thinking { .. } | ContentPart::RedactedThinking { .. } => None,
            ContentPart::Document { name, .. } => Some(format!(
                "{speaker}: [document \"{name}\" omitted from summary input]"
            )),
            ContentPart::Attachment { name, .. } => Some(format!(
                "{speaker}: [attachment \"{name}\" omitted from summary input]"
            )),
            ContentPart::ToolUse {
                name, arguments, ..
            } => {
                let arguments = arguments.trim();
                Some(if arguments.is_empty() || arguments == "{}" {
                    format!("Assistant called tool {name} with no arguments")
                } else {
                    format!(
                        "Assistant called tool {name} with arguments: {}",
                        clip(arguments, MAX_TOOL_ARGUMENT_CHARS)
                    )
                })
            }
            ContentPart::ToolResult {
                name,
                output,
                images,
                ..
            } => {
                let output = output.trim();
                let mut line = if output.is_empty() {
                    format!("Tool {name} returned no output")
                } else {
                    format!(
                        "Tool {name} returned: {}",
                        clip(output, MAX_TOOL_OUTPUT_CHARS)
                    )
                };
                if !images.is_empty() {
                    line.push_str(&format!(
                        "\n[{} image(s) omitted from summary input]",
                        images.len()
                    ));
                }
                Some(line)
            }
            ContentPart::ProviderBlock { block, .. } => {
                Some(format!("{speaker}: {}", provider_block_text(block)))
            }
        })
        .collect();
    (!lines.is_empty()).then(|| lines.join("\n"))
}

/// The message `apply_compaction` wrote for an earlier summary.
fn is_compaction_summary(message: &Message) -> bool {
    matches!(
        message.content.first(),
        Some(ContentPart::Text { text }) if text.starts_with(COMPACTION_OPEN)
    )
}

/// The transcript the summarizer reads, within `budget` bytes. The first
/// message (the user's request) and the latest earlier summary are always in
/// it, cut to a share of the budget; the rest of the budget goes to the
/// newest messages. Where messages were left out the transcript says how
/// many, so the summarizer does not invent them.
pub(crate) fn summary_transcript(messages: &[Message], budget: usize) -> String {
    let summary_at = messages.iter().rposition(is_compaction_summary);
    let mut anchors: Vec<(usize, usize)> = Vec::new();
    if !messages.is_empty() {
        let share = if summary_at == Some(0) {
            budget / 4
        } else {
            budget / 8
        };
        anchors.push((0, share));
    }
    if let Some(at) = summary_at.filter(|at| *at != 0) {
        anchors.push((at, budget / 4));
    }

    let mut chosen: Vec<(usize, String)> = Vec::new();
    let mut empty: HashSet<usize> = HashSet::new();
    let mut room = budget;
    for &(index, share) in &anchors {
        match render_message(&messages[index], share) {
            Some(text) => {
                let text = hard_truncate(text, share);
                room = room.saturating_sub(text.len() + SEPARATOR.len());
                chosen.push((index, text));
            }
            None => {
                empty.insert(index);
            }
        }
    }

    let text_cap = MAX_TEXT_CHARS.min(budget / 4);
    let mut newest: Vec<(usize, String)> = Vec::new();
    for index in (0..messages.len()).rev() {
        if anchors.iter().any(|(anchor, _)| *anchor == index) {
            continue;
        }
        let Some(text) = render_message(&messages[index], text_cap) else {
            empty.insert(index);
            continue;
        };
        let cost = text.len() + SEPARATOR.len();
        if cost > room {
            // A newest message larger than the whole room is cut, not shipped
            // whole; anything older that does not fit is left out.
            if newest.is_empty() && room > SEPARATOR.len() + TRUNCATED.len() {
                newest.push((index, hard_truncate(text, room - SEPARATOR.len())));
            }
            break;
        }
        room -= cost;
        newest.push((index, text));
    }
    chosen.extend(newest);
    chosen.sort_by_key(|(index, _)| *index);

    let mut body = String::new();
    let mut previous: Option<usize> = None;
    for (index, text) in chosen {
        if let Some(previous) = previous {
            let omitted = (previous + 1..index)
                .filter(|skipped| !empty.contains(skipped))
                .count();
            if omitted > 0 {
                let noun = if omitted == 1 { "message" } else { "messages" };
                body.push_str(&format!("[{omitted} {noun} omitted]{SEPARATOR}"));
            }
        }
        body.push_str(&text);
        body.push_str(SEPARATOR);
        previous = Some(index);
    }
    format!("<transcript>\n{}\n</transcript>", body.trim_end())
}

/// The output ceiling of the summary: what a call may produce, and no more
/// than a quarter of a small window.
fn summary_max_tokens(caps: &crate::caps::ModelCaps) -> u32 {
    let ceiling = crate::wire::reasoning::default_max_tokens(caps, SUMMARY_MAX_TOKENS);
    match caps.context_window {
        Some(window) if window > 0 => ceiling.min((window / 4).max(256)),
        _ => ceiling,
    }
}

/// How much transcript fits the model's window next to the instructions and
/// the summary it writes.
fn summary_input_budget(caps: &crate::caps::ModelCaps, max_tokens: u32) -> usize {
    let Some(window) = caps.context_window.filter(|window| *window > 0) else {
        return SUMMARY_INPUT_CHAR_BUDGET;
    };
    let room = window
        .saturating_sub(max_tokens)
        .saturating_sub(SUMMARY_OVERHEAD_TOKENS) as usize;
    room.saturating_mul(SUMMARY_CHARS_PER_TOKEN)
        .clamp(MIN_SUMMARY_INPUT_CHARS, MAX_SUMMARY_INPUT_CHARS)
}

/// Summarize the full history into a compact continuation text. Runs under
/// the turn's cancellation token so an interrupt does not wait on the
/// summarization call. The caller checks the reply with `usable_summary`.
pub(crate) async fn compact_history(
    client: &reqwest::Client,
    resolved: &Resolved,
    request: &CompletionRequest,
    token: &CancellationToken,
) -> Result<CompletionResponse> {
    let summary_request = summary_request(&request.messages, &resolved.caps);
    let call = crate::complete(client, resolved, &summary_request);
    tokio::select! {
        response = call => response,
        _ = token.cancelled() => Err(AgentError::Cancelled),
    }
}

/// The text of a summary reply, or why it cannot replace the history: an
/// empty reply, a refusal and a reply cut off at the output limit would each
/// leave the run with nothing of what it did.
pub(crate) fn usable_summary(response: &CompletionResponse) -> Result<String> {
    let reason = response.stop_reason.as_deref();
    if is_refusal_stop(reason) {
        return Err(AgentError::Decode(
            "the model declined to summarize the conversation".into(),
        ));
    }
    if is_output_limit_stop(reason) {
        return Err(AgentError::Decode(
            "the summary was cut off at the model's output limit".into(),
        ));
    }
    let summary = response.text.trim();
    if summary.is_empty() {
        return Err(AgentError::Decode(
            "the model returned an empty summary".into(),
        ));
    }
    Ok(summary.to_string())
}

/// The one-shot request that summarizes `messages`: the history as a text
/// transcript in a single user message, low effort, no visible reasoning, no
/// tools or web, and no more output than the model allows.
pub(crate) fn summary_request(
    messages: &[Message],
    caps: &crate::caps::ModelCaps,
) -> CompletionRequest {
    let max_tokens = summary_max_tokens(caps);
    CompletionRequest {
        system: Some(DEFAULT_COMPACT_PROMPT.to_string()),
        messages: vec![Message::user(summary_transcript(
            messages,
            summary_input_budget(caps, max_tokens),
        ))],
        tools: Vec::new(),
        effort: Some(Effort::Low),
        reasoning_summary: Some(false),
        max_tokens: Some(max_tokens),
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
        "{COMPACTION_OPEN}\n{summary}\n{COMPACTION_CLOSE}"
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

    fn transcript_of(request: &CompletionRequest) -> &str {
        assert_eq!(request.messages.len(), 1, "one message carries the history");
        assert_eq!(request.messages[0].role, Role::User);
        text_of(&request.messages[0])
    }

    fn tool_call(id: &str, arguments: &str) -> Message {
        Message {
            role: Role::Assistant,
            content: vec![ContentPart::ToolUse {
                id: id.into(),
                name: "read_file".into(),
                arguments: arguments.into(),
                thought_signature: None,
            }],
        }
    }

    fn tool_result(id: &str, output: &str) -> Message {
        Message {
            role: Role::User,
            content: vec![ContentPart::tool_result(id, "read_file", output)],
        }
    }

    #[test]
    fn summary_input_drops_the_middle_beyond_the_budget_and_says_so() {
        let mut messages = vec![Message::user("the task".to_string())];
        for index in 0..20 {
            messages.push(Message::user(format!(
                "middle-{index:02} {}",
                "x".repeat(900)
            )));
        }
        messages.push(Message::user("recent-1".to_string()));
        messages.push(Message::user("recent-2".to_string()));
        let transcript = summary_transcript(&messages, 4_000);
        assert!(transcript.len() <= 4_000);
        assert!(transcript.contains("User: the task"));
        assert!(transcript.contains("User: recent-1"));
        assert!(transcript.contains("User: recent-2"));
        // The oldest of the middle fell off first; the newest of it stayed.
        assert!(!transcript.contains("middle-00"));
        assert!(transcript.contains("middle-19"));
        assert!(transcript.contains("messages omitted]"));
        // Oldest first, with the gap between the request and the tail.
        let gap = transcript.find(" omitted]").unwrap();
        assert!(transcript.find("the task").unwrap() < gap);
        assert!(gap < transcript.find("middle-19").unwrap());
    }

    #[test]
    fn summary_input_cuts_a_single_oversized_message_to_the_budget() {
        let messages = vec![Message::user("y".repeat(SUMMARY_INPUT_CHAR_BUDGET + 5))];
        let transcript = summary_transcript(&messages, SUMMARY_INPUT_CHAR_BUDGET);
        assert!(transcript.len() <= SUMMARY_INPUT_CHAR_BUDGET);
        assert!(transcript.contains("characters omitted") || transcript.contains("[truncated]"));
        assert!(transcript.starts_with("<transcript>\nUser: yyyy"));
    }

    #[test]
    fn a_newest_message_larger_than_the_room_is_cut_not_dropped() {
        let messages = vec![
            Message::user("the task".to_string()),
            Message::user("z".repeat(50_000)),
        ];
        let transcript = summary_transcript(&messages, 10_000);
        assert!(transcript.len() <= 10_000);
        assert!(transcript.contains("User: the task"));
        assert!(transcript.contains("zzzz"));
    }

    #[test]
    fn summary_input_reads_a_tool_result_whose_call_fell_off_as_plain_text() {
        // No pairing rule applies to a transcript, so an orphan is harmless.
        let messages = vec![
            Message::user("task".to_string()),
            tool_result("call-9", "orphaned"),
            Message::user("recent".to_string()),
        ];
        let transcript = summary_transcript(&messages, SUMMARY_INPUT_CHAR_BUDGET);
        assert!(transcript.contains("Tool read_file returned: orphaned"));
        assert!(transcript.contains("User: recent"));
    }

    #[test]
    fn summary_input_renders_a_call_and_its_result_in_order() {
        let messages = vec![
            Message::user("task".to_string()),
            tool_call("call-1", r#"{"path":"main.tex"}"#),
            tool_result("call-1", "kept"),
        ];
        let transcript = summary_transcript(&messages, SUMMARY_INPUT_CHAR_BUDGET);
        let call = transcript
            .find(r#"Assistant called tool read_file with arguments: {"path":"main.tex"}"#)
            .unwrap();
        let result = transcript.find("Tool read_file returned: kept").unwrap();
        assert!(call < result);
    }

    #[test]
    fn long_tool_output_and_arguments_keep_their_start_and_end() {
        let output = format!("BEGIN{}END", "m".repeat(50_000));
        let arguments = format!(r#"{{"content":"{}"}}"#, "a".repeat(10_000));
        let messages = vec![
            Message::user("task".to_string()),
            tool_call("c", &arguments),
            tool_result("c", &output),
        ];
        let transcript = summary_transcript(&messages, SUMMARY_INPUT_CHAR_BUDGET);
        assert!(transcript.contains("BEGIN") && transcript.contains("END"));
        assert!(transcript.contains("characters omitted"));
        assert!(transcript.len() < 12_000);
    }

    #[test]
    fn a_history_over_the_message_cap_is_one_user_message_with_the_whole_history() {
        use crate::session::context_window::{validate_completion_request, MAX_AGENT_MESSAGES};
        let long = request_with(MAX_AGENT_MESSAGES + 1);
        assert!(validate_completion_request(&long).is_err());

        let summary = summary_request(&long.messages, &crate::caps::ModelCaps::default());
        let transcript = transcript_of(&summary);
        assert!(transcript.contains("User: message 0"));
        assert!(transcript.contains(&format!("User: message {MAX_AGENT_MESSAGES}")));
        assert!(!transcript.contains("omitted"));
        validate_completion_request(&summary).unwrap();
    }

    #[test]
    fn a_history_over_the_tool_call_cap_is_one_user_message_with_every_call() {
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
        let transcript = transcript_of(&summary);
        assert_eq!(
            transcript
                .matches("Assistant called tool read_file")
                .count(),
            300
        );
        assert_eq!(
            transcript.matches("Tool read_file returned: ok").count(),
            300
        );
    }

    #[test]
    fn the_summary_request_has_no_tool_parts_and_opens_with_a_user_message() {
        // A tool loop that crossed the message cap: the newest 128 messages
        // used to start on an assistant tool call.
        let mut messages = vec![Message::user("task".to_string())];
        for turn in 0..70 {
            let id = format!("call-{turn}");
            messages.push(tool_call(&id, "{}"));
            messages.push(tool_result(&id, "ok"));
        }
        let request = summary_request(&messages, &crate::caps::ModelCaps::default());
        assert_eq!(request.messages[0].role, Role::User);
        assert!(request.messages.iter().all(|message| message
            .content
            .iter()
            .all(|part| matches!(part, ContentPart::Text { .. }))));
        assert!(request.tools.is_empty());
    }

    #[test]
    fn the_summary_request_is_a_valid_anthropic_conversation() {
        let resolved = Resolved {
            provider_id: "anthropic".into(),
            model_id: "claude-opus-5-5".into(),
            credential: "key".into(),
            auth: Some("key".into()),
            wire: crate::provider::Wire::Anthropic {
                base_url: "https://api.anthropic.com/v1".into(),
            },
            caps: crate::caps::ModelCaps::default(),
        };
        let mut messages = vec![Message::user("task".to_string())];
        for turn in 0..70 {
            let id = format!("call-{turn}");
            messages.push(tool_call(&id, "{}"));
            messages.push(tool_result(&id, "ok"));
        }
        let request = summary_request(&messages, &resolved.caps);
        let body = crate::wire::anthropic_body(&resolved, &request).unwrap();
        let sent = body["messages"].as_array().unwrap();
        assert_eq!(sent.len(), 1);
        assert_eq!(sent[0]["role"], "user");
        // Anthropic rejects tool_use and tool_result blocks when no tools
        // are declared.
        assert!(body.get("tools").is_none());
        let text = body.to_string();
        assert!(!text.contains("\"tool_use\"") && !text.contains("\"tool_result\""));
    }

    #[test]
    fn the_first_request_and_an_earlier_summary_survive_a_huge_history() {
        let mut messages = vec![Message::user(format!(
            "{COMPACTION_OPEN}\nGoal: port the paper to Typst.\n{COMPACTION_CLOSE}"
        ))];
        for turn in 0..40 {
            let id = format!("call-{turn}");
            messages.push(tool_call(&id, "{}"));
            messages.push(tool_result(&id, &"f".repeat(6_000)));
        }
        let transcript = summary_transcript(&messages, 60_000);
        assert!(transcript.len() <= 60_000);
        assert!(transcript.contains("Goal: port the paper to Typst."));
        assert!(transcript.contains("<context_compaction>"));
        assert!(transcript.contains("messages omitted]"));
        // The newest messages fill what the anchors leave.
        assert!(transcript.contains("Tool read_file returned: ffff"));
    }

    #[test]
    fn the_original_task_stays_ahead_of_the_newest_messages() {
        let mut messages = vec![Message::user("Port the paper to Typst.".to_string())];
        for turn in 0..40 {
            messages.push(Message::user(format!("step {turn} {}", "s".repeat(4_000))));
        }
        let transcript = summary_transcript(&messages, 30_000);
        assert!(transcript.contains("User: Port the paper to Typst."));
        assert!(transcript.contains("step 39"));
        assert!(!transcript.contains("step 1 "));
    }

    #[test]
    fn a_later_summary_in_the_middle_is_kept_too() {
        let mut messages = vec![Message::user("original task".to_string())];
        messages.push(Message::user(format!(
            "{COMPACTION_OPEN}\nearlier summary\n{COMPACTION_CLOSE}"
        )));
        for turn in 0..30 {
            messages.push(Message::user(format!("turn {turn} {}", "t".repeat(3_000))));
        }
        let transcript = summary_transcript(&messages, 20_000);
        assert!(transcript.contains("original task"));
        assert!(transcript.contains("earlier summary"));
        assert!(transcript.contains("turn 29"));
    }

    #[test]
    fn the_transcript_budget_follows_the_models_window() {
        let caps = |window: Option<u32>| crate::caps::ModelCaps {
            context_window: window,
            ..crate::caps::ModelCaps::default()
        };
        assert_eq!(
            summary_input_budget(&caps(None), 16_000),
            SUMMARY_INPUT_CHAR_BUDGET
        );
        // A 32k window leaves little room: well under the old fixed budget.
        let small = summary_input_budget(&caps(Some(32_768)), 8_192);
        assert!(small < 60_000, "{small}");
        // A 200k window is about the old budget; a 1M window gets more.
        let medium = summary_input_budget(&caps(Some(200_000)), 16_000);
        assert!((300_000..=400_000).contains(&medium), "{medium}");
        let large = summary_input_budget(&caps(Some(1_000_000)), 16_000);
        assert!(
            large > medium && large <= MAX_SUMMARY_INPUT_CHARS,
            "{large}"
        );
        // Never zero, even for a window the summary alone would fill.
        assert_eq!(
            summary_input_budget(&caps(Some(4_000)), 1_000),
            MIN_SUMMARY_INPUT_CHARS
        );
    }

    #[test]
    fn a_small_window_gets_a_summary_request_that_fits_it() {
        let caps = crate::caps::ModelCaps {
            context_window: Some(32_768),
            output_limit: Some(8_192),
            ..crate::caps::ModelCaps::default()
        };
        let messages: Vec<Message> = (0..60)
            .map(|index| Message::user(format!("{index} {}", "w".repeat(20_000))))
            .collect();
        let request = summary_request(&messages, &caps);
        let sent =
            request.system.as_deref().map_or(0, str::len) + text_of(&request.messages[0]).len();
        // Two characters per token is the planning ratio.
        let tokens = sent / 2 + request.max_tokens.unwrap() as usize;
        assert!(tokens < 32_768, "{tokens}");
    }

    #[test]
    fn an_empty_cut_off_or_declined_summary_is_not_usable() {
        let response = |text: &str, stop: Option<&str>| CompletionResponse {
            text: text.into(),
            usage: crate::complete::Usage::default(),
            provider_id: "p".into(),
            model_id: "m".into(),
            stop_reason: stop.map(str::to_string),
        };
        assert_eq!(
            usable_summary(&response("  a summary \n", Some("stop"))).unwrap(),
            "a summary"
        );
        assert_eq!(usable_summary(&response("fine", None)).unwrap(), "fine");
        assert!(usable_summary(&response("", Some("stop"))).is_err());
        assert!(usable_summary(&response(" \n ", None)).is_err());
        for stop in ["length", "max_tokens", "max_output_tokens", "MAX_TOKENS"] {
            let error = usable_summary(&response("half a summ", Some(stop))).unwrap_err();
            assert!(error.to_string().contains("cut off"), "{stop}: {error}");
        }
        for stop in ["refusal", "content_filter", "SAFETY"] {
            assert!(usable_summary(&response("I cannot help", Some(stop))).is_err());
        }
    }

    #[test]
    fn a_provider_context_overflow_is_recognized() {
        use crate::error::AgentError;
        assert!(
            AgentError::provider(400, "This model's maximum context length is 8192 tokens")
                .is_context_overflow()
        );
        assert!(AgentError::provider(413, "prompt is too long").is_context_overflow());
        assert!(!AgentError::provider(400, "invalid api key").is_context_overflow());
        assert!(!AgentError::provider(500, "context length exceeded").is_context_overflow());
    }

    #[test]
    fn summary_input_strips_images() {
        let messages = vec![Message {
            role: Role::User,
            content: vec![ContentPart::Image {
                image: "data:image/png;base64,AAAA".to_string(),
            }],
        }];
        let transcript = summary_transcript(&messages, SUMMARY_INPUT_CHAR_BUDGET);
        assert!(transcript.contains("User: [image omitted from summary input]"));
        assert!(!transcript.contains("AAAA"));
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
        let transcript = summary_transcript(&request.messages, SUMMARY_INPUT_CHAR_BUDGET);
        assert!(!transcript.contains("plan"));
        assert!(!transcript.contains("sig"));
        assert!(transcript.contains("Assistant: [web_search: \"q\"]"));
        assert!(transcript.contains("Assistant: Reading."));
        assert!(transcript.contains("Assistant called tool read_file with no arguments"));
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
        let transcript = summary_transcript(
            &[
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
            ],
            SUMMARY_INPUT_CHAR_BUDGET,
        );
        assert!(
            transcript.contains("Tool n returned: out\n[2 image(s) omitted from summary input]")
        );
        assert!(transcript.contains("User: [document \"paper.pdf\" omitted from summary input]"));
        assert!(!transcript.contains("JVBE") && !transcript.contains("base64"));
    }
}
