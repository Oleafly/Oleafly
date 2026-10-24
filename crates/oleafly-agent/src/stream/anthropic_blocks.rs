//! Ordered capture of an Anthropic reply's content blocks, so the next step
//! can replay them exactly: thinking with its signature, text with its
//! citations, client tool calls, and the server's own tool calls and
//! results.
use std::collections::BTreeMap;

use serde_json::{json, Value};

use crate::event::AgentEvent;

#[derive(Debug, Clone, PartialEq)]
pub(crate) enum AssistantBlock {
    Text(String),
    /// A text block with citations, kept whole.
    Cited(Value),
    Thinking {
        thinking: String,
        signature: String,
    },
    RedactedThinking(String),
    ToolUse {
        id: String,
        name: String,
        arguments: String,
    },
    /// A server tool call, its result, or a block type this client does not
    /// know, kept verbatim.
    Native(Value),
}

#[derive(Debug)]
enum Open {
    Text {
        text: String,
        citations: Vec<Value>,
    },
    Thinking {
        thinking: String,
        signature: String,
    },
    RedactedThinking(String),
    ToolUse {
        id: String,
        name: String,
        arguments: String,
    },
    ServerToolUse {
        block: Value,
        input: String,
    },
    Raw(Value),
}

/// Cited sources appended to the visible answer, per text block.
const MAX_SOURCE_LINKS: usize = 3;

fn text_of(value: &Value, key: &str) -> String {
    value
        .get(key)
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string()
}

fn web_tool(name: &str) -> bool {
    matches!(name, "web_search" | "web_fetch")
}

/// What the user sees of a server web tool's result: titles and addresses,
/// never the encrypted page content.
fn result_summary(block: &Value) -> Option<String> {
    let kind = block.get("type").and_then(Value::as_str)?;
    let content = block.get("content")?;
    if let Some(code) = content
        .get("error_code")
        .and_then(Value::as_str)
        .filter(|_| content.is_object())
    {
        return Some(json!({ "error": code }).to_string());
    }
    match kind {
        "web_search_tool_result" => {
            let results: Vec<Value> = content
                .as_array()
                .into_iter()
                .flatten()
                .map(|result| {
                    let mut entry = json!({
                        "title": text_of(result, "title"),
                        "url": text_of(result, "url"),
                    });
                    if let Some(age) = result.get("page_age").and_then(Value::as_str) {
                        entry["page_age"] = json!(age);
                    }
                    entry
                })
                .collect();
            Some(json!({ "results": results }).to_string())
        }
        "web_fetch_tool_result" => {
            let mut summary = json!({ "url": text_of(content, "url") });
            if let Some(title) = content
                .pointer("/content/title")
                .and_then(Value::as_str)
                .filter(|title| !title.is_empty())
            {
                summary["title"] = json!(title);
            }
            Some(summary.to_string())
        }
        _ => None,
    }
}

fn source_links(citations: &[Value]) -> Vec<String> {
    let mut seen: Vec<&str> = Vec::new();
    let mut links = Vec::new();
    for citation in citations {
        if citation.get("type").and_then(Value::as_str) != Some("web_search_result_location") {
            continue;
        }
        let Some(url) = citation.get("url").and_then(Value::as_str) else {
            continue;
        };
        if seen.contains(&url) || links.len() >= MAX_SOURCE_LINKS {
            continue;
        }
        seen.push(url);
        let title = citation
            .get("title")
            .and_then(Value::as_str)
            .filter(|title| !title.is_empty())
            .unwrap_or(url)
            .replace('[', "(")
            .replace(']', ")");
        links.push(format!(" ([{title}]({url}))"));
    }
    links
}

fn close(open: Open) -> (AssistantBlock, Vec<AgentEvent>) {
    match open {
        Open::Text { text, citations } if citations.is_empty() => {
            (AssistantBlock::Text(text), Vec::new())
        }
        Open::Text { text, citations } => {
            let events = source_links(&citations)
                .into_iter()
                .map(|text| AgentEvent::TextDelta { text })
                .collect();
            (
                AssistantBlock::Cited(json!({
                    "type": "text",
                    "text": text,
                    "citations": citations,
                })),
                events,
            )
        }
        Open::Thinking {
            thinking,
            signature,
        } => (
            AssistantBlock::Thinking {
                thinking,
                signature,
            },
            Vec::new(),
        ),
        Open::RedactedThinking(data) => (AssistantBlock::RedactedThinking(data), Vec::new()),
        Open::ToolUse {
            id,
            name,
            arguments,
        } => (
            AssistantBlock::ToolUse {
                id,
                name,
                arguments,
            },
            Vec::new(),
        ),
        Open::ServerToolUse { mut block, input } => {
            let parsed = if input.trim().is_empty() {
                block
                    .get("input")
                    .filter(|input| input.as_object().is_some_and(|object| !object.is_empty()))
                    .cloned()
                    .unwrap_or_else(|| json!({}))
            } else {
                serde_json::from_str(&input).unwrap_or_else(|_| json!({}))
            };
            block["input"] = parsed.clone();
            let name = text_of(&block, "name");
            let events = if web_tool(&name) {
                vec![AgentEvent::ToolCallEnd {
                    id: text_of(&block, "id"),
                    arguments: parsed.to_string(),
                }]
            } else {
                Vec::new()
            };
            (AssistantBlock::Native(block), events)
        }
        Open::Raw(block) => (AssistantBlock::Native(block), Vec::new()),
    }
}

#[derive(Debug, Default)]
pub(crate) struct AnthropicBlocks {
    open: BTreeMap<i64, Open>,
    done: BTreeMap<i64, AssistantBlock>,
}

impl AnthropicBlocks {
    pub(crate) fn start(&mut self, index: i64, block: &Value) -> Vec<AgentEvent> {
        let kind = block
            .get("type")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let mut events = Vec::new();
        let open = match kind {
            "text" => Open::Text {
                text: text_of(block, "text"),
                citations: block
                    .get("citations")
                    .and_then(Value::as_array)
                    .cloned()
                    .unwrap_or_default(),
            },
            "thinking" => Open::Thinking {
                thinking: text_of(block, "thinking"),
                signature: text_of(block, "signature"),
            },
            "redacted_thinking" => Open::RedactedThinking(text_of(block, "data")),
            "tool_use" => Open::ToolUse {
                id: text_of(block, "id"),
                name: text_of(block, "name"),
                arguments: String::new(),
            },
            "server_tool_use" => {
                let name = text_of(block, "name");
                if web_tool(&name) {
                    events.push(AgentEvent::ToolCallStart {
                        id: text_of(block, "id"),
                        name,
                    });
                }
                Open::ServerToolUse {
                    block: block.clone(),
                    input: String::new(),
                }
            }
            kind if kind.ends_with("_tool_result") => {
                if let Some(output) = result_summary(block) {
                    events.push(AgentEvent::ToolOutcome {
                        id: text_of(block, "tool_use_id"),
                        output,
                    });
                }
                Open::Raw(block.clone())
            }
            _ => Open::Raw(block.clone()),
        };
        self.open.insert(index, open);
        events
    }

    pub(crate) fn delta(&mut self, index: i64, delta: &Value) {
        let Some(open) = self.open.get_mut(&index) else {
            return;
        };
        let kind = delta
            .get("type")
            .and_then(Value::as_str)
            .unwrap_or_default();
        match (kind, open) {
            ("text_delta", Open::Text { text, .. }) => text.push_str(&text_of(delta, "text")),
            ("thinking_delta", Open::Thinking { thinking, .. }) => {
                thinking.push_str(&text_of(delta, "thinking"));
            }
            ("signature_delta", Open::Thinking { signature, .. }) => {
                *signature = text_of(delta, "signature");
            }
            ("input_json_delta", Open::ToolUse { arguments, .. }) => {
                arguments.push_str(&text_of(delta, "partial_json"));
            }
            ("input_json_delta", Open::ServerToolUse { input, .. }) => {
                input.push_str(&text_of(delta, "partial_json"));
            }
            ("citations_delta", Open::Text { citations, .. }) => {
                if let Some(citation) = delta.get("citation") {
                    citations.push(citation.clone());
                }
            }
            _ => {}
        }
    }

    pub(crate) fn stop(&mut self, index: i64) -> Vec<AgentEvent> {
        let Some(open) = self.open.remove(&index) else {
            return Vec::new();
        };
        let (block, events) = close(open);
        self.done.insert(index, block);
        events
    }

    /// Every block in stream order, closing any still open.
    pub(crate) fn finish(&mut self) -> Vec<AssistantBlock> {
        for (index, open) in std::mem::take(&mut self.open) {
            let (block, _) = close(open);
            self.done.insert(index, block);
        }
        std::mem::take(&mut self.done).into_values().collect()
    }
}
