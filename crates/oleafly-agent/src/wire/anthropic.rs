//! The Anthropic Messages body: thinking and effort, prompt caching,
//! documents, tool-result images, replayed thinking and server blocks, and
//! hosted web tools.
use serde_json::{json, Map, Value};

use crate::complete::CompletionRequest;
use crate::effort::{effective_effort, Effort};
use crate::error::Result;
use crate::message::{
    parse_arguments, parse_image_url, unresolved_attachment, ContentPart, Message, ProviderWire,
    Role,
};
use crate::provider::Resolved;
use crate::tool::ToolSchema;
use crate::wire::reasoning::{
    anthropic_checks_output_room, anthropic_thinking, default_max_tokens, OUTPUT_ROOM_MAX_TOKENS,
    STREAMING_MAX_TOKENS_CAP,
};
use crate::wire::server_tools::{anthropic_server_tools, native_web};
use crate::wire::{role_str, sorted_tools};

/// Lets a request replay thinking with a drop-on-mismatch safety net.
pub(crate) const THINKING_BINDING_BETA: &str = "thinking-binding-controls-2026-08-01";

/// The `anthropic-beta` header a body needs, if any.
pub(crate) fn anthropic_beta_header(body: &Value) -> Option<&'static str> {
    body.pointer("/thinking/block_binding")
        .is_some()
        .then_some(THINKING_BINDING_BETA)
}

fn ephemeral() -> Value {
    json!({ "type": "ephemeral" })
}

fn image_block(image: &str) -> Result<Value> {
    let data = parse_image_url(image)?;
    Ok(json!({
        "type": "image",
        "source": {
            "type": "base64",
            "media_type": data.media_type,
            "data": data.base64,
        }
    }))
}

fn tool_result_block(id: &str, output: &str, images: &[String]) -> Result<Value> {
    if images.is_empty() {
        return Ok(json!({
            "type": "tool_result",
            "tool_use_id": id,
            "content": output,
        }));
    }
    let mut content = Vec::with_capacity(images.len() + 1);
    // The API refuses empty text blocks.
    if !output.trim().is_empty() {
        content.push(json!({ "type": "text", "text": output }));
    }
    for image in images {
        content.push(image_block(image)?);
    }
    Ok(json!({
        "type": "tool_result",
        "tool_use_id": id,
        "content": content,
    }))
}

fn message_blocks(message: &Message) -> Result<Vec<Value>> {
    let mut blocks = Vec::with_capacity(message.content.len());
    for part in &message.content {
        match part {
            ContentPart::Text { text } => {
                if message.role == Role::Assistant && text.trim().is_empty() {
                    continue;
                }
                blocks.push(json!({ "type": "text", "text": text }));
            }
            ContentPart::Image { image } => blocks.push(image_block(image)?),
            ContentPart::ToolUse {
                id,
                name,
                arguments,
                ..
            } => blocks.push(json!({
                "type": "tool_use",
                "id": id,
                "name": name,
                "input": parse_arguments(arguments),
            })),
            ContentPart::ToolResult {
                id, output, images, ..
            } => blocks.push(tool_result_block(id, output, images)?),
            ContentPart::Document { mime, data, name } => blocks.push(json!({
                "type": "document",
                "source": { "type": "base64", "media_type": mime, "data": data },
                "title": name,
            })),
            ContentPart::Thinking {
                thinking,
                signature,
            } => blocks.push(json!({
                "type": "thinking",
                "thinking": thinking,
                "signature": signature,
            })),
            ContentPart::RedactedThinking { data } => {
                blocks.push(json!({ "type": "redacted_thinking", "data": data }));
            }
            ContentPart::ProviderBlock {
                wire: ProviderWire::Anthropic,
                block,
            } => blocks.push(block.clone()),
            ContentPart::Attachment { .. } => return Err(unresolved_attachment()),
        }
    }
    Ok(blocks)
}

/// Claude models from Opus 4.7 on answer a `temperature` with a 400 (Sonnet
/// 5.5 and Haiku 5.5 accept only the default), so it goes only to the older
/// models that still honour it. An id that is not a Claude model keeps it.
pub(crate) fn anthropic_accepts_temperature(model_id: &str) -> bool {
    let id = model_id.to_ascii_lowercase();
    let Some(at) = id.find("claude-") else {
        return true;
    };
    let rest = &id[at + "claude-".len()..];
    if rest.starts_with('2') || rest.starts_with('3') || rest.starts_with("instant") {
        return true;
    }
    // "sonnet-4", "sonnet-4-20250514", "opus-4-1-20250805", "haiku-4-5"
    let mut version = rest.split('-').skip(1);
    let major = version.next();
    let minor = version.next().unwrap_or("0");
    major == Some("4") && (minor.len() == 8 || minor.parse::<u32>().is_ok_and(|minor| minor <= 6))
}

fn system_field(req: &CompletionRequest) -> Option<Value> {
    let system = req.system.as_deref().filter(|text| !text.is_empty());
    let suffix = req.system_suffix.as_deref().filter(|text| !text.is_empty());
    match (system, suffix) {
        (Some(system), None) => Some(json!(system)),
        (Some(system), Some(suffix)) => Some(json!([
            { "type": "text", "text": system, "cache_control": ephemeral() },
            { "type": "text", "text": suffix },
        ])),
        (None, Some(suffix)) => Some(json!(suffix)),
        (None, None) => None,
    }
}

fn client_tool(tool: &ToolSchema) -> Value {
    json!({
        "name": tool.name,
        "description": tool.description,
        "input_schema": tool.input_schema,
    })
}

pub(crate) fn anthropic_body(resolved: &Resolved, req: &CompletionRequest) -> Result<Value> {
    let effort = effective_effort(resolved, req.effort);
    let mut messages = Vec::with_capacity(req.messages.len());
    let mut replays_thinking = false;
    for message in &req.messages {
        replays_thinking |= message.content.iter().any(|part| {
            matches!(
                part,
                ContentPart::Thinking { .. } | ContentPart::RedactedThinking { .. }
            )
        });
        let blocks = message_blocks(message)?;
        if blocks.is_empty() {
            continue;
        }
        messages.push(json!({ "role": role_str(message.role), "content": blocks }));
    }

    let model = resolved.model_id.as_str();
    let mut body = Map::new();
    body.insert("model".into(), json!(model));
    body.insert("messages".into(), Value::Array(messages));
    body.insert(
        "max_tokens".into(),
        json!(req.max_tokens.unwrap_or_else(|| {
            let ceiling = default_max_tokens(&resolved.caps, STREAMING_MAX_TOKENS_CAP);
            // A large default would leave older models no room for the
            // input; they get one closer to what they used to.
            if anthropic_checks_output_room(model) {
                ceiling.min(OUTPUT_ROOM_MAX_TOKENS)
            } else {
                ceiling
            }
        })),
    );
    if let Some(system) = system_field(req) {
        body.insert("system".into(), system);
    }
    let thinking = anthropic_thinking(resolved, req, effort, replays_thinking);
    let adaptive = thinking
        .as_ref()
        .is_some_and(|thinking| thinking["type"] == "adaptive");
    if let Some(temperature) = req
        .temperature
        .filter(|_| anthropic_accepts_temperature(model) && !adaptive)
    {
        body.insert("temperature".into(), json!(temperature));
    }

    let native = native_web(&resolved.provider_id, &resolved.wire, model, req.web);
    let server_tools = anthropic_server_tools(model, native);
    let hosted: Vec<&str> = server_tools
        .iter()
        .filter_map(|tool| tool["name"].as_str())
        .collect();
    let mut tools: Vec<Value> = sorted_tools(&req.tools)
        .into_iter()
        .filter(|tool| !hosted.contains(&tool.name.as_str()))
        .map(client_tool)
        .collect();
    if let Some(last) = tools.last_mut() {
        last["cache_control"] = ephemeral();
    }
    tools.extend(server_tools);
    if !tools.is_empty() {
        body.insert("tools".into(), Value::Array(tools));
    }
    if let Some(thinking) = thinking {
        body.insert("thinking".into(), thinking);
    }
    if let Some(effort) = effort.filter(|effort| *effort != Effort::Off) {
        body.insert("output_config".into(), json!({ "effort": effort.as_str() }));
    }
    // Automatic caching of the conversation so far.
    body.insert("cache_control".into(), ephemeral());
    if let Some(container) = &req.anthropic_container {
        body.insert("container".into(), json!(container));
    }
    Ok(Value::Object(body))
}
