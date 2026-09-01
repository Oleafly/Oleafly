//! Context-window accounting: the serialized-history, message, tool-call,
//! image, and character budgets every sampling request must fit. Exceeding a
//! budget aborts the run unless the turn can compact first (see
//! `session::compact`).

use std::io::Write;

use serde::Serialize;

use crate::complete::CompletionRequest;
use crate::error::{AgentError, Result};
use crate::message::{ContentPart, Message};

pub(crate) const MAX_AGENT_HISTORY_BYTES: usize = 128 * 1024 * 1024;
// Keep the character guard within the serialized-history ceiling while leaving
// room for every individually permitted text tool result. A fixed 100k guard
// could reject an ordinary multi-step run after only a handful of searches.
pub(crate) const MAX_AGENT_CONTEXT_CHARS: usize = MAX_AGENT_HISTORY_BYTES / 4;
pub(crate) const MAX_AGENT_MESSAGES: usize = 128;
pub(crate) const MAX_TOOL_DEFINITIONS: usize = 128;
pub(crate) const MAX_AGENT_TOOL_CALLS: usize = 256;
pub(crate) const MAX_AGENT_IMAGES: usize = 12;

pub fn validate_completion_request(request: &CompletionRequest) -> Result<()> {
    HistoryBudget::new(request).map(|_| ())
}

// The incremental ledger the rollout store keeps per thread; the turn loop
// currently revalidates the whole request each batch instead of appending.
#[allow(dead_code)]
#[derive(Debug, Clone)]
pub(crate) struct HistoryBudget {
    pub(crate) serialized_bytes: usize,
    pub(crate) context_chars: usize,
    pub(crate) images: usize,
    pub(crate) messages: usize,
    pub(crate) tool_calls: usize,
}

impl HistoryBudget {
    pub(crate) fn new(request: &CompletionRequest) -> Result<Self> {
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

    #[allow(dead_code)]
    pub(crate) fn append_message(
        &mut self,
        message: &Message,
        new_tool_calls: usize,
    ) -> Result<()> {
        let messages = bounded_add(self.messages, 1, MAX_AGENT_MESSAGES, "agent message count")?;
        let tool_calls = bounded_add(
            self.tool_calls,
            new_tool_calls,
            MAX_AGENT_TOOL_CALLS,
            "agent tool-call count",
        )?;
        let context_chars = bounded_add(
            self.context_chars,
            message_context_chars(message)?,
            MAX_AGENT_CONTEXT_CHARS,
            "agent context",
        )?;
        let images = bounded_add(
            self.images,
            message_image_count(message),
            MAX_AGENT_IMAGES,
            "agent image count",
        )?;
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

pub(crate) fn history_limit_error(description: &str) -> AgentError {
    AgentError::Decode(format!("{description} exceeded its safety limit"))
}

pub(crate) fn is_history_limit(error: &AgentError) -> bool {
    matches!(error, AgentError::Decode(message) if message.contains("exceeded its safety limit"))
}

#[allow(dead_code)]
pub(crate) fn bounded_add(
    current: usize,
    added: usize,
    limit: usize,
    description: &str,
) -> Result<usize> {
    current
        .checked_add(added)
        .filter(|value| *value <= limit)
        .ok_or_else(|| history_limit_error(description))
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

pub(crate) fn serialized_size_limited<T: Serialize>(value: &T, max_bytes: usize) -> Result<usize> {
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
        let chars = part_context_chars(part)?;
        total
            .checked_add(chars)
            .ok_or_else(|| history_limit_error("agent context"))
    })
}

fn part_context_chars(part: &ContentPart) -> Result<usize> {
    match part {
        ContentPart::Text { text } => checked_chars(text),
        ContentPart::Image { .. } => Ok(0),
        ContentPart::ToolUse {
            id,
            name,
            arguments,
            ..
        } => checked_context_fields([id.as_str(), name.as_str(), arguments.as_str()]),
        ContentPart::ToolResult { id, name, output } => {
            checked_context_fields([id.as_str(), name.as_str(), output.as_str()])
        }
    }
}

fn checked_context_fields<const N: usize>(fields: [&str; N]) -> Result<usize> {
    fields.into_iter().try_fold(0usize, |total, field| {
        total
            .checked_add(checked_chars(field)?)
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::message::Role;

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
    fn aggregate_context_guard_can_hold_all_permitted_text_tool_results() {
        let maximum_tool_output_chars =
            MAX_AGENT_TOOL_CALLS * crate::run::MAX_TOOL_OUTPUT_TEXT_BYTES;
        assert!(MAX_AGENT_CONTEXT_CHARS >= maximum_tool_output_chars);
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
    fn limit_errors_are_recognizable_for_the_compaction_hook() {
        let error = HistoryBudget::new(&CompletionRequest {
            messages: vec![Message::user("x".repeat(MAX_AGENT_CONTEXT_CHARS + 1))],
            ..Default::default()
        })
        .unwrap_err();
        assert!(is_history_limit(&error));
        assert!(!is_history_limit(&AgentError::Transport("reset".into())));
    }
}
