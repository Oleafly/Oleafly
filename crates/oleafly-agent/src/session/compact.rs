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
const UNKNOWN_WINDOW_TOKENS: u32 = 32_000;
const TAIL_WINDOW_DIVISOR: usize = 4;
const MIN_TAIL_CHARS: usize = 8_000;
const MAX_TAIL_CHARS: usize = 400_000;
const MIN_TAIL_RESULT_CHARS: usize = 1_000;
pub(crate) const MAX_SUMMARY_HALVINGS: u32 = 3;

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

pub(crate) const SUMMARY_INPUT_CHAR_BUDGET: usize = 64_000;
const MAX_SUMMARY_INPUT_CHARS: usize = 1_000_000;
pub(crate) const MIN_SUMMARY_INPUT_CHARS: usize = 8_000;
const SUMMARY_CHARS_PER_TOKEN: usize = 2;
const SUMMARY_OVERHEAD_TOKENS: u32 = 4_000;
pub(crate) const SUMMARY_MAX_TOKENS: u32 = 16_000;
const MAX_SUMMARY_RESULTS: usize = 5;
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

fn hard_truncate(mut text: String, max: usize) -> String {
    if text.len() <= max {
        return text;
    }
    text.truncate(floor_boundary(&text, max.saturating_sub(TRUNCATED.len())));
    text.push_str(TRUNCATED);
    text
}

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
            ContentPart::Thinking { .. }
            | ContentPart::RedactedThinking { .. }
            | ContentPart::Reasoning { .. } => None,
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

fn is_compaction_summary(message: &Message) -> bool {
    matches!(
        message.content.first(),
        Some(ContentPart::Text { text }) if text.starts_with(COMPACTION_OPEN)
    )
}

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

fn summary_max_tokens(caps: &crate::caps::ModelCaps) -> u32 {
    let ceiling = crate::wire::reasoning::default_max_tokens(caps, SUMMARY_MAX_TOKENS);
    match caps.context_window {
        Some(window) if window > 0 => ceiling.min((window / 4).max(256)),
        _ => ceiling,
    }
}

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

pub(crate) fn summary_budget(caps: &crate::caps::ModelCaps) -> usize {
    summary_input_budget(caps, summary_max_tokens(caps))
}

pub(crate) async fn compact_history(
    client: &reqwest::Client,
    resolved: &Resolved,
    request: &CompletionRequest,
    budget: usize,
    token: &CancellationToken,
) -> Result<CompletionResponse> {
    let summary_request = summary_request_within(&request.messages, &resolved.caps, budget);
    let call = crate::complete(client, resolved, &summary_request);
    tokio::select! {
        response = call => response,
        _ = token.cancelled() => Err(AgentError::Cancelled),
    }
}

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

#[cfg(test)]
pub(crate) fn summary_request(
    messages: &[Message],
    caps: &crate::caps::ModelCaps,
) -> CompletionRequest {
    summary_request_within(messages, caps, summary_budget(caps))
}

fn summary_request_within(
    messages: &[Message],
    caps: &crate::caps::ModelCaps,
    budget: usize,
) -> CompletionRequest {
    let max_tokens = summary_max_tokens(caps);
    CompletionRequest {
        system: Some(DEFAULT_COMPACT_PROMPT.to_string()),
        messages: vec![Message::user(summary_transcript(messages, budget))],
        tools: Vec::new(),
        effort: Some(Effort::Low),
        reasoning_summary: Some(false),
        max_tokens: Some(max_tokens),
        timeout_ms: Some(
            u64::try_from(crate::complete::MAX_COMPLETION_DURATION.as_millis()).unwrap_or(u64::MAX),
        ),
        web: None,
        ..CompletionRequest::default()
    }
}

fn tail_char_budget(caps: &crate::caps::ModelCaps) -> usize {
    let window = caps
        .context_window
        .filter(|window| *window > 0)
        .unwrap_or(UNKNOWN_WINDOW_TOKENS) as usize;
    (window.saturating_mul(SUMMARY_CHARS_PER_TOKEN) / TAIL_WINDOW_DIVISOR)
        .clamp(MIN_TAIL_CHARS, MAX_TAIL_CHARS)
}

fn message_size(message: &Message) -> usize {
    message
        .content
        .iter()
        .map(|part| match part {
            ContentPart::Text { text } => text.len(),
            ContentPart::ToolUse { arguments, .. } => arguments.len(),
            ContentPart::ToolResult { output, .. } => output.len(),
            ContentPart::Thinking { thinking, .. } => thinking.len(),
            ContentPart::Reasoning { text } => text.len(),
            ContentPart::ProviderBlock { block, .. } => {
                serde_json::to_string(block).map_or(0, |text| text.len())
            }
            ContentPart::Image { .. }
            | ContentPart::RedactedThinking { .. }
            | ContentPart::Document { .. }
            | ContentPart::Attachment { .. } => 0,
        })
        .fold(0, usize::saturating_add)
}

fn block_type(block: &Value) -> &str {
    block
        .get("type")
        .and_then(Value::as_str)
        .unwrap_or_default()
}

fn hosted_fetch_ids(tail: &[Message]) -> HashSet<String> {
    tail.iter()
        .flat_map(|message| &message.content)
        .filter_map(|part| match part {
            ContentPart::ProviderBlock { block, .. }
                if block_type(block) == "web_fetch_tool_result" =>
            {
                block
                    .get("tool_use_id")
                    .and_then(Value::as_str)
                    .map(str::to_string)
            }
            _ => None,
        })
        .collect()
}

fn cites_a_document(block: &Value) -> bool {
    block_type(block) == "text"
        && block
            .get("citations")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .any(|citation| {
                citation.get("type").and_then(Value::as_str) != Some("web_search_result_location")
            })
}

fn hosted_fetches_as_text(tail: &mut [Message]) {
    let fetched = hosted_fetch_ids(tail);
    if fetched.is_empty() {
        return;
    }
    for message in tail.iter_mut() {
        for part in &mut message.content {
            let ContentPart::ProviderBlock { block, .. } = part else {
                continue;
            };
            let text = match block_type(block) {
                "web_fetch_tool_result" => provider_block_text(block),
                "server_tool_use"
                    if block
                        .get("id")
                        .and_then(Value::as_str)
                        .is_some_and(|id| fetched.contains(id)) =>
                {
                    provider_block_text(block)
                }
                _ if cites_a_document(block) => block_text(block, "text"),
                _ => continue,
            };
            *part = ContentPart::text(text);
        }
        message
            .content
            .retain(|part| !matches!(part, ContentPart::Text { text } if text.is_empty()));
    }
}

fn tail_result_cap(tail: &[Message], budget: usize) -> Option<usize> {
    let total = tail.iter().map(message_size).fold(0, usize::saturating_add);
    if total <= budget {
        return None;
    }
    let results: Vec<usize> = tail
        .iter()
        .flat_map(|message| &message.content)
        .filter_map(|part| match part {
            ContentPart::ToolResult { output, .. } => Some(output.len()),
            _ => None,
        })
        .collect();
    if results.is_empty() {
        return None;
    }
    let other = total.saturating_sub(results.iter().sum());
    let cap = (budget.saturating_sub(other) / results.len()).max(MIN_TAIL_RESULT_CHARS);
    results.iter().any(|size| *size > cap).then_some(cap)
}

pub(crate) fn compaction_would_shrink(messages: &[Message], caps: &crate::caps::ModelCaps) -> bool {
    let budget = tail_char_budget(caps);
    let start = compaction_tail_start(messages, budget);
    let tail = &messages[start..];
    start > 0 || tail_result_cap(tail, budget).is_some() || !hosted_fetch_ids(tail).is_empty()
}

pub(crate) fn apply_compaction(
    request: &mut CompletionRequest,
    summary: String,
    caps: &crate::caps::ModelCaps,
) -> usize {
    let budget = tail_char_budget(caps);
    let tail_start = compaction_tail_start(&request.messages, budget);
    let dropped = tail_start;
    let mut tail = request.messages.split_off(tail_start);
    for message in &mut tail {
        message.content.retain(|part| {
            !matches!(
                part,
                ContentPart::Thinking { .. } | ContentPart::RedactedThinking { .. }
            )
        });
    }
    hosted_fetches_as_text(&mut tail);
    if let Some(cap) = tail_result_cap(&tail, budget) {
        for part in tail.iter_mut().flat_map(|message| &mut message.content) {
            if let ContentPart::ToolResult { output, .. } = part {
                if output.len() > cap {
                    *output = clip(output, cap);
                }
            }
        }
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

fn result_id(part: &ContentPart) -> Option<&str> {
    match part {
        ContentPart::ToolResult { id, .. } => Some(id.as_str()),
        ContentPart::ProviderBlock { block, .. } => {
            block.get("tool_use_id").and_then(Value::as_str)
        }
        _ => None,
    }
}

fn compaction_tail_start(messages: &[Message], budget: usize) -> usize {
    let mut start = messages.len();
    let mut used = 0usize;
    while start > 0 && messages.len() - start < KEEP_LAST_MESSAGES {
        let size = message_size(&messages[start - 1]);
        if start < messages.len() && used.saturating_add(size) > budget {
            break;
        }
        used = used.saturating_add(size);
        start -= 1;
    }
    loop {
        let mut earliest = start;
        for at in start..messages.len() {
            for id in messages[at].content.iter().filter_map(result_id) {
                let call = (0..=at).rev().find(|index| {
                    messages[*index]
                        .content
                        .iter()
                        .filter_map(call_id)
                        .any(|call| call == id)
                });
                if let Some(call) = call {
                    earliest = earliest.min(call);
                }
            }
        }
        if earliest == start {
            return start;
        }
        start = earliest;
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
        let dropped = apply_compaction(&mut request, "the summary".into(), &caps());

        assert_eq!(dropped, 15);
        assert_eq!(request.messages.len(), KEEP_LAST_MESSAGES + 1);
        assert!(text_of(&request.messages[0]).contains("the summary"));
        assert!(text_of(&request.messages[0]).contains("<context_compaction>"));
        assert!(text_of(&request.messages[1]).contains("message 15"));
        assert!(text_of(request.messages.last().unwrap()).contains("message 24"));
        assert!(request.openai_responses_input.is_none());
    }

    #[test]
    fn compaction_of_a_short_history_keeps_everything_and_adds_the_summary() {
        let mut request = request_with(3);
        let dropped = apply_compaction(&mut request, "s".into(), &caps());
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

        let dropped = apply_compaction(&mut request, "summary".into(), &caps());

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
        assert!(!transcript.contains("middle-00"));
        assert!(transcript.contains("middle-19"));
        assert!(transcript.contains("messages omitted]"));
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
        let small = summary_input_budget(&caps(Some(32_768)), 8_192);
        assert!(small < 60_000, "{small}");
        let medium = summary_input_budget(&caps(Some(200_000)), 16_000);
        assert!((300_000..=400_000).contains(&medium), "{medium}");
        let large = summary_input_budget(&caps(Some(1_000_000)), 16_000);
        assert!(
            large > medium && large <= MAX_SUMMARY_INPUT_CHARS,
            "{large}"
        );
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
        apply_compaction(&mut request, "summary".into(), &caps());
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
    fn chat_reasoning_stays_out_of_the_summary_and_on_the_kept_tail() {
        let mut request = history_with_thinking_tail();
        request.messages[22].content.insert(
            0,
            ContentPart::Reasoning {
                text: "weighing the options".into(),
            },
        );
        let transcript = summary_transcript(&request.messages, SUMMARY_INPUT_CHAR_BUDGET);
        assert!(!transcript.contains("weighing the options"));
        apply_compaction(&mut request, "summary".into(), &caps());
        assert!(request
            .messages
            .iter()
            .flat_map(|message| &message.content)
            .any(|part| matches!(part, ContentPart::Reasoning { text } if text == "weighing the options")));
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
        assert_eq!(
            compaction_tail_start(&request.messages, tail_char_budget(&caps())),
            13
        );
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

    fn caps() -> crate::caps::ModelCaps {
        crate::caps::ModelCaps::default()
    }

    fn window(tokens: u32) -> crate::caps::ModelCaps {
        crate::caps::ModelCaps {
            context_window: Some(tokens),
            ..crate::caps::ModelCaps::default()
        }
    }

    fn tool_round(id: &str, outputs: &[usize]) -> [Message; 2] {
        let ids: Vec<String> = (0..outputs.len()).map(|n| format!("{id}-{n}")).collect();
        [
            Message {
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
            },
            Message {
                role: Role::User,
                content: ids
                    .iter()
                    .zip(outputs)
                    .map(|(id, size)| {
                        ContentPart::tool_result(id.clone(), "read_file", "c".repeat(*size))
                    })
                    .collect(),
            },
        ]
    }

    fn tail_size(request: &CompletionRequest) -> usize {
        request.messages[1..].iter().map(message_size).sum()
    }

    #[test]
    fn large_recent_tool_results_are_cut_so_the_kept_tail_fits_the_window() {
        let mut request = CompletionRequest {
            messages: vec![Message::user("port the chapters".to_string())],
            ..CompletionRequest::default()
        };
        for round in 0..5 {
            request
                .messages
                .extend(tool_round(&format!("r{round}"), &[60_000, 60_000]));
        }
        let caps = window(200_000);
        assert!(compaction_would_shrink(&request.messages, &caps));
        let dropped = apply_compaction(&mut request, "summary".into(), &caps);
        assert!(dropped > 0);
        let budget = tail_char_budget(&caps);
        assert!(
            tail_size(&request) <= budget + 2 * 64,
            "{}",
            tail_size(&request)
        );
        assert!(matches!(
            request.messages[1].content.first(),
            Some(ContentPart::ToolUse { .. })
        ));
        let kept = request.messages.last().unwrap();
        assert!(matches!(
            &kept.content[0],
            ContentPart::ToolResult { output, .. } if output.contains("characters omitted")
        ));
    }

    #[test]
    fn the_kept_tail_holds_fewer_messages_when_they_are_large() {
        let mut request = request_with(5);
        for index in 0..10 {
            request
                .messages
                .push(Message::user(format!("{index} {}", "t".repeat(30_000))));
        }
        let caps = window(200_000);
        let dropped = apply_compaction(&mut request, "summary".into(), &caps);
        assert_eq!(request.messages.len(), 4);
        assert_eq!(dropped, 12);
        assert!(text_of(request.messages.last().unwrap()).starts_with("9 "));
    }

    #[test]
    fn a_history_that_compaction_cannot_shrink_is_not_summarized() {
        let single = vec![Message::user("x".repeat(500_000))];
        assert!(!compaction_would_shrink(&single, &window(200_000)));
        let mut cut = vec![Message::user("task".to_string())];
        cut.extend(tool_round("r", &[400_000]));
        assert!(compaction_would_shrink(&cut, &window(200_000)));
        assert!(compaction_would_shrink(&request_with(25).messages, &caps()));
    }

    #[test]
    fn a_repeated_call_id_pulls_the_tail_back_to_the_nearest_call() {
        // Gemini-style ids that repeat in every reply.
        let mut messages = vec![Message::user("task".to_string())];
        for _ in 0..12 {
            messages.push(tool_call("call_read_file_1", "{}"));
            messages.push(tool_result("call_read_file_1", "ok"));
        }
        messages.push(Message::user("next".to_string()));
        let start = compaction_tail_start(&messages, tail_char_budget(&caps()));
        assert_eq!(start, messages.len() - KEEP_LAST_MESSAGES - 1);
        assert!(matches!(
            messages[start].content[0],
            ContentPart::ToolUse { .. }
        ));
    }

    #[test]
    fn hosted_fetch_results_in_the_kept_tail_become_markers() {
        let pdf = "J".repeat(200_000);
        let mut request = request_with(3);
        request.messages.push(Message {
            role: Role::Assistant,
            content: vec![
                provider(
                    serde_json::json!({"type":"server_tool_use","id":"srvtoolu_1","name":"web_fetch","input":{"url":"https://e.org/p.pdf"}}),
                ),
                provider(serde_json::json!({
                    "type":"web_fetch_tool_result","tool_use_id":"srvtoolu_1",
                    "content":{"type":"web_fetch_result","url":"https://e.org/p.pdf",
                        "content":{"type":"document","source":{"type":"base64","data":pdf}}}
                })),
                provider(serde_json::json!({
                    "type":"text","text":"The paper says so.",
                    "citations":[{"type":"char_location","document_index":0,"cited_text":"so"}]
                })),
                provider(
                    serde_json::json!({"type":"server_tool_use","id":"srvtoolu_2","name":"web_search","input":{"query":"q"}}),
                ),
            ],
        });
        request.messages.push(Message::user("go on".to_string()));
        assert!(compaction_would_shrink(
            &request.messages,
            &window(1_000_000)
        ));
        apply_compaction(&mut request, "summary".into(), &window(1_000_000));
        let parts: Vec<&ContentPart> = request
            .messages
            .iter()
            .flat_map(|message| &message.content)
            .collect();
        let texts: Vec<&str> = parts
            .iter()
            .filter_map(|part| match part {
                ContentPart::Text { text } => Some(text.as_str()),
                _ => None,
            })
            .collect();
        assert!(texts.contains(&"[web_fetch: https://e.org/p.pdf]"));
        assert!(texts.contains(&"[fetched https://e.org/p.pdf]"));
        assert!(texts.contains(&"The paper says so."));
        let blocks: Vec<&Value> = parts
            .iter()
            .filter_map(|part| match part {
                ContentPart::ProviderBlock { block, .. } => Some(block),
                _ => None,
            })
            .collect();
        assert_eq!(blocks.len(), 1);
        assert_eq!(blocks[0]["id"], "srvtoolu_2");
        assert!(tail_size(&request) < 1_000);
    }

    #[test]
    fn the_summary_call_gets_the_longest_blocking_timeout() {
        let request = summary_request(&[Message::user("x")], &caps());
        assert_eq!(
            request.timeout_ms,
            Some(crate::complete::MAX_COMPLETION_DURATION.as_millis() as u64)
        );
    }

    #[test]
    fn an_unknown_window_gets_a_transcript_a_small_model_can_hold() {
        assert_eq!(summary_budget(&caps()), 64_000);
        assert_eq!(tail_char_budget(&caps()), 16_000);
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
