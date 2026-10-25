//! What a headless run reports as it goes. With `--events` each event is one
//! JSON line (`{schema_version, type: "event", command, event, ...}`) before
//! the result; people see the text as it streams and a line per tool.
use serde_json::{json, Value};

#[derive(Clone, Debug, PartialEq)]
pub enum RunEvent {
    Started {
        run_id: String,
        provider: String,
        model: String,
        /// `read`, `review` or `apply`.
        mode: &'static str,
        review_dir: Option<String>,
    },
    Text {
        text: String,
    },
    Reasoning {
        text: String,
    },
    ToolCall {
        id: String,
        name: String,
        arguments: String,
    },
    ToolResult {
        id: String,
        /// `ok` or `error`.
        status: &'static str,
        bytes: usize,
    },
    Usage {
        input_tokens: Option<u32>,
        output_tokens: Option<u32>,
    },
    Step {
        step: u32,
    },
}

/// Tool arguments longer than this are cut in events.
const MAX_EVENT_ARGUMENTS: usize = 4 * 1024;

/// At most `max` bytes from the start of `text`, cut at a character.
pub(crate) fn head(text: &str, max: usize) -> (&str, bool) {
    if text.len() <= max {
        return (text, false);
    }
    let mut end = max;
    while !text.is_char_boundary(end) {
        end -= 1;
    }
    (&text[..end], true)
}

impl RunEvent {
    /// The `event` field.
    pub fn name(&self) -> &'static str {
        match self {
            Self::Started { .. } => "started",
            Self::Text { .. } => "text",
            Self::Reasoning { .. } => "reasoning",
            Self::ToolCall { .. } => "tool_call",
            Self::ToolResult { .. } => "tool_result",
            Self::Usage { .. } => "usage",
            Self::Step { .. } => "step",
        }
    }

    /// The event's own fields (camelCase).
    pub fn fields(&self) -> Value {
        match self {
            Self::Started {
                run_id,
                provider,
                model,
                mode,
                review_dir,
            } => {
                json!({"runId": run_id, "provider": provider, "model": model, "mode": mode, "reviewDir": review_dir})
            }
            Self::Text { text } | Self::Reasoning { text } => json!({"text": text}),
            Self::ToolCall {
                id,
                name,
                arguments,
            } => {
                let (arguments, truncated) = head(arguments, MAX_EVENT_ARGUMENTS);
                json!({"id": id, "name": name, "arguments": arguments, "truncated": truncated})
            }
            Self::ToolResult { id, status, bytes } => {
                json!({"id": id, "status": status, "bytes": bytes})
            }
            Self::Usage {
                input_tokens,
                output_tokens,
            } => json!({"inputTokens": input_tokens, "outputTokens": output_tokens}),
            Self::Step { step } => json!({"step": step}),
        }
    }

    /// The same event with every secret replaced.
    pub fn redacted(self, redact: &dyn Fn(&str) -> String) -> Self {
        match self {
            Self::Text { text } => Self::Text {
                text: redact(&text),
            },
            Self::Reasoning { text } => Self::Reasoning {
                text: redact(&text),
            },
            Self::ToolCall {
                id,
                name,
                arguments,
            } => Self::ToolCall {
                id,
                name,
                arguments: redact(&arguments),
            },
            other => other,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn event_names_and_fields_are_stable() {
        let started = RunEvent::Started {
            run_id: "1-00ab".into(),
            provider: "openai".into(),
            model: "m".into(),
            mode: "review",
            review_dir: Some("/p/.oleafly/agent-runs/1-00ab".into()),
        };
        assert_eq!(started.name(), "started");
        assert_eq!(
            started.fields()["reviewDir"],
            "/p/.oleafly/agent-runs/1-00ab"
        );
        let call = RunEvent::ToolCall {
            id: "c1".into(),
            name: "read_file".into(),
            arguments: "{\"path\":\"main.tex\"}".into(),
        };
        assert_eq!(
            (call.name(), call.fields()["name"].clone()),
            ("tool_call", json!("read_file"))
        );
        assert_eq!(RunEvent::Step { step: 3 }.fields()["step"], 3);
        assert_eq!(
            RunEvent::ToolResult {
                id: "c1".into(),
                status: "ok",
                bytes: 12
            }
            .name(),
            "tool_result"
        );
    }

    #[test]
    fn long_arguments_are_cut_and_secrets_are_redacted() {
        let call = RunEvent::ToolCall {
            id: "c".into(),
            name: "write_file".into(),
            arguments: format!("sk-live-1 {}", "x".repeat(10_000)),
        };
        let call = call.redacted(&|text: &str| text.replace("sk-live-1", "[redacted]"));
        let fields = call.fields();
        assert!(fields["arguments"].as_str().unwrap().len() <= MAX_EVENT_ARGUMENTS + 4);
        assert_eq!(fields["truncated"], true);
        assert!(!fields.to_string().contains("sk-live-1"));
    }
}
