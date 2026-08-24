use serde_json::{json, Value};

use crate::complete::CompletionRequest;
use crate::error::Result;
use crate::message::{parse_arguments, parse_data_url, ContentPart, Message, Role};
use crate::provider::{Resolved, Wire};
use crate::tool::{anthropic_tools, google_tools, openai_responses_tools, openai_tools};

pub(crate) const DEFAULT_MAX_TOKENS: u32 = 4096;

fn role_str(role: Role) -> &'static str {
    match role {
        Role::User => "user",
        Role::Assistant => "assistant",
    }
}

fn openai_tool_results(message: &Message, messages: &mut Vec<Value>) {
    for part in &message.content {
        if let ContentPart::ToolResult { id, output, .. } = part {
            messages.push(json!({
                "role": "tool",
                "tool_call_id": id,
                "content": output,
            }));
        }
    }
}

fn openai_tool_calls(rest: &[&ContentPart]) -> Vec<Value> {
    rest.iter()
        .filter_map(|part| match part {
            ContentPart::ToolUse {
                id,
                name,
                arguments,
                ..
            } => Some(json!({
                "id": id,
                "type": "function",
                "function": { "name": name, "arguments": arguments },
            })),
            _ => None,
        })
        .collect()
}

fn openai_visible_content(rest: &[&ContentPart]) -> Result<Value> {
    let visible: Vec<&&ContentPart> = rest
        .iter()
        .filter(|p| !matches!(p, ContentPart::ToolUse { .. }))
        .collect();
    Ok(match visible.as_slice() {
        [] => Value::Null,
        [ContentPart::Text { text }] => json!(text),
        parts => {
            let mut out = Vec::with_capacity(parts.len());
            for part in parts {
                out.push(match part {
                    ContentPart::Text { text } => json!({ "type": "text", "text": text }),
                    ContentPart::Image { image } => {
                        parse_data_url(image)?;
                        json!({ "type": "image_url", "image_url": { "url": image } })
                    }
                    _ => continue,
                });
            }
            json!(out)
        }
    })
}

pub(crate) fn openai_body(resolved: &Resolved, req: &CompletionRequest) -> Result<Value> {
    let mut messages: Vec<Value> = Vec::new();
    if let Some(system) = req.system.as_ref().filter(|s| !s.is_empty()) {
        messages.push(json!({ "role": "system", "content": system }));
    }
    for message in &req.messages {
        openai_tool_results(message, &mut messages);
        let rest: Vec<&ContentPart> = message
            .content
            .iter()
            .filter(|p| !matches!(p, ContentPart::ToolResult { .. }))
            .collect();
        if rest.is_empty() {
            continue;
        }
        let calls = openai_tool_calls(&rest);
        let mut entry = json!({
            "role": role_str(message.role),
            "content": openai_visible_content(&rest)?,
        });
        if !calls.is_empty() {
            entry["tool_calls"] = Value::Array(calls);
        }
        messages.push(entry);
    }

    let mut body = json!({ "model": resolved.model_id, "messages": messages });
    if let Some(t) = req.temperature {
        body["temperature"] = json!(t);
    }
    if let Some(m) = req.max_tokens {
        body["max_tokens"] = json!(m);
    }
    if !req.tools.is_empty() {
        body["tools"] = openai_tools(&req.tools);
    }
    Ok(body)
}

fn responses_message(message: &Message, parts: &[&ContentPart]) -> Result<Option<Value>> {
    let mut content = Vec::new();
    for part in parts {
        match part {
            ContentPart::Text { text } => content.push(match message.role {
                Role::User => json!({ "type": "input_text", "text": text }),
                Role::Assistant => json!({ "type": "output_text", "text": text }),
            }),
            ContentPart::Image { image } => {
                parse_data_url(image)?;
                content.push(json!({ "type": "input_image", "image_url": image }));
            }
            _ => {}
        }
    }
    if content.is_empty() {
        return Ok(None);
    }
    Ok(Some(json!({
        "type": "message",
        "role": role_str(message.role),
        "content": content,
    })))
}

pub(crate) fn openai_responses_input(messages: &[Message]) -> Result<Vec<Value>> {
    let mut input = Vec::new();
    for message in messages {
        let mut visible: Vec<&ContentPart> = Vec::new();
        for part in &message.content {
            match part {
                ContentPart::Text { .. } | ContentPart::Image { .. } => visible.push(part),
                ContentPart::ToolUse {
                    id,
                    name,
                    arguments,
                    ..
                } => {
                    if let Some(item) = responses_message(message, &visible)? {
                        input.push(item);
                    }
                    visible.clear();
                    input.push(json!({
                        "type": "function_call",
                        "call_id": id,
                        "name": name,
                        "arguments": arguments,
                    }));
                }
                ContentPart::ToolResult { id, output, .. } => {
                    if let Some(item) = responses_message(message, &visible)? {
                        input.push(item);
                    }
                    visible.clear();
                    input.push(json!({
                        "type": "function_call_output",
                        "call_id": id,
                        "output": output,
                    }));
                }
            }
        }
        if let Some(item) = responses_message(message, &visible)? {
            input.push(item);
        }
    }
    Ok(input)
}

pub(crate) fn openai_responses_body(resolved: &Resolved, req: &CompletionRequest) -> Result<Value> {
    let input = match &req.openai_responses_input {
        Some(input) => input.clone(),
        None => openai_responses_input(&req.messages)?,
    };

    let mut body = json!({
        "model": resolved.model_id,
        "input": input,
        "include": ["reasoning.encrypted_content"],
        "store": false,
    });
    if let Some(system) = req.system.as_ref().filter(|system| !system.is_empty()) {
        body["instructions"] = json!(system);
    }
    if let Some(temperature) = req.temperature {
        body["temperature"] = json!(temperature);
    }
    if let Some(max_tokens) = req.max_tokens {
        body["max_output_tokens"] = json!(max_tokens);
    }
    if !req.tools.is_empty() {
        body["tools"] = openai_responses_tools(&req.tools);
    }
    Ok(body)
}

fn anthropic_part(part: &ContentPart) -> Result<Value> {
    Ok(match part {
        ContentPart::Text { text } => json!({ "type": "text", "text": text }),
        ContentPart::Image { image } => {
            let data = parse_data_url(image)?;
            json!({
                "type": "image",
                "source": {
                    "type": "base64",
                    "media_type": data.media_type,
                    "data": data.base64,
                }
            })
        }
        ContentPart::ToolUse {
            id,
            name,
            arguments,
            ..
        } => json!({
            "type": "tool_use",
            "id": id,
            "name": name,
            "input": parse_arguments(arguments),
        }),
        ContentPart::ToolResult { id, output, .. } => json!({
            "type": "tool_result",
            "tool_use_id": id,
            "content": output,
        }),
    })
}

pub(crate) fn anthropic_body(resolved: &Resolved, req: &CompletionRequest) -> Result<Value> {
    let mut messages: Vec<Value> = Vec::new();
    for message in &req.messages {
        let mut parts = Vec::with_capacity(message.content.len());
        for part in &message.content {
            parts.push(anthropic_part(part)?);
        }
        messages.push(json!({ "role": role_str(message.role), "content": parts }));
    }

    let mut body = json!({
        "model": resolved.model_id,
        "messages": messages,
        "max_tokens": req.max_tokens.unwrap_or(DEFAULT_MAX_TOKENS),
    });
    if let Some(system) = req.system.as_ref().filter(|s| !s.is_empty()) {
        body["system"] = json!(system);
    }
    if let Some(t) = req.temperature {
        body["temperature"] = json!(t);
    }
    if !req.tools.is_empty() {
        body["tools"] = anthropic_tools(&req.tools);
    }
    Ok(body)
}

fn google_part(part: &ContentPart) -> Result<Value> {
    Ok(match part {
        ContentPart::Text { text } => json!({ "text": text }),
        ContentPart::Image { image } => {
            let data = parse_data_url(image)?;
            json!({
                "inlineData": {
                    "mimeType": data.media_type,
                    "data": data.base64,
                }
            })
        }
        ContentPart::ToolUse {
            name,
            arguments,
            thought_signature,
            ..
        } => {
            let mut part = json!({
                "functionCall": { "name": name, "args": parse_arguments(arguments) }
            });
            if let Some(signature) = thought_signature {
                part["thoughtSignature"] = json!(signature);
            }
            part
        }
        ContentPart::ToolResult { name, output, .. } => json!({
            "functionResponse": {
                "name": name,
                "response": { "result": output }
            }
        }),
    })
}

fn google_generation_config(req: &CompletionRequest) -> Option<Value> {
    let mut generation = serde_json::Map::new();
    if let Some(t) = req.temperature {
        generation.insert("temperature".into(), json!(t));
    }
    if let Some(m) = req.max_tokens {
        generation.insert("maxOutputTokens".into(), json!(m));
    }
    if generation.is_empty() {
        None
    } else {
        Some(Value::Object(generation))
    }
}

pub(crate) fn google_body(req: &CompletionRequest) -> Result<Value> {
    let mut contents: Vec<Value> = Vec::new();
    for message in &req.messages {
        let mut parts = Vec::with_capacity(message.content.len());
        for part in &message.content {
            parts.push(google_part(part)?);
        }
        let role = match message.role {
            Role::User => "user",
            Role::Assistant => "model",
        };
        contents.push(json!({ "role": role, "parts": parts }));
    }

    let mut body = json!({ "contents": contents });
    if let Some(system) = req.system.as_ref().filter(|s| !s.is_empty()) {
        body["systemInstruction"] = json!({ "parts": [{ "text": system }] });
    }
    if let Some(generation) = google_generation_config(req) {
        body["generationConfig"] = generation;
    }
    if !req.tools.is_empty() {
        body["tools"] = google_tools(&req.tools);
    }
    Ok(body)
}

pub(crate) fn auth_headers(resolved: &Resolved) -> reqwest::header::HeaderMap {
    use reqwest::header::{HeaderMap, HeaderName, HeaderValue};
    let mut headers = HeaderMap::new();
    let Some(token) = resolved.auth.as_deref() else {
        return headers;
    };
    let (name, value) = match resolved.wire {
        Wire::OpenAiResponses { .. } | Wire::OpenAiChat { .. } => {
            ("authorization", format!("Bearer {token}"))
        }
        Wire::Anthropic { .. } => ("x-api-key", token.to_string()),
        Wire::Google { .. } => ("x-goog-api-key", token.to_string()),
    };
    if let (Ok(name), Ok(mut value)) = (
        HeaderName::from_bytes(name.as_bytes()),
        HeaderValue::from_str(&value),
    ) {
        value.set_sensitive(true);
        headers.insert(name, value);
    }
    headers
}

pub fn request_builder(
    client: &reqwest::Client,
    resolved: &Resolved,
    streaming: bool,
) -> reqwest::RequestBuilder {
    let builder = match &resolved.wire {
        Wire::OpenAiResponses { base_url } => {
            client.post(format!("{}/responses", base_url.trim_end_matches('/')))
        }
        Wire::OpenAiChat { base_url, .. } => client.post(format!(
            "{}/chat/completions",
            base_url.trim_end_matches('/')
        )),
        Wire::Anthropic { base_url } => client
            .post(format!("{}/messages", base_url.trim_end_matches('/')))
            .header("anthropic-version", "2023-06-01"),
        Wire::Google { base_url } => {
            let action = if streaming {
                "streamGenerateContent?alt=sse"
            } else {
                "generateContent"
            };
            client.post(format!(
                "{}/models/{}:{action}",
                base_url.trim_end_matches('/'),
                resolved.model_id
            ))
        }
    };
    builder.headers(auth_headers(resolved))
}

pub fn wire_body(resolved: &Resolved, req: &CompletionRequest) -> Result<serde_json::Value> {
    match &resolved.wire {
        Wire::OpenAiResponses { .. } => openai_responses_body(resolved, req),
        Wire::OpenAiChat { .. } => openai_body(resolved, req),
        Wire::Anthropic { .. } => anthropic_body(resolved, req),
        Wire::Google { .. } => google_body(req),
    }
}

#[cfg(test)]
mod tests;
