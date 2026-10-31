use serde_json::{json, Value};

use crate::complete::CompletionRequest;
use crate::effort::effective_effort;
use crate::error::{AgentError, Result};
use crate::message::{
    parse_arguments, parse_image_url, unresolved_attachment, ContentPart, Message, Role,
};
use crate::provider::{Resolved, Wire};
use crate::tool::{google_tools, openai_responses_tools, openai_tools, ToolSchema};

mod anthropic;
pub(crate) mod reasoning;
pub mod server_tools;

pub(crate) use anthropic::{anthropic_beta_header, anthropic_body};
use reasoning::{
    chat_reasoning_fields, default_max_tokens, google_thinking_config, joined_system,
    message_reasoning, responses_reasoning, STREAMING_MAX_TOKENS_CAP,
};
use server_tools::{native_web, responses_web_tool};

pub(crate) fn role_str(role: Role) -> &'static str {
    match role {
        Role::User => "user",
        Role::Assistant => "assistant",
    }
}

pub(crate) fn sorted_tools(tools: &[ToolSchema]) -> Vec<&ToolSchema> {
    let mut sorted: Vec<&ToolSchema> = tools.iter().collect();
    sorted.sort_by(|left, right| left.name.cmp(&right.name));
    sorted
}

fn owned_sorted_tools(tools: &[ToolSchema]) -> Vec<ToolSchema> {
    sorted_tools(tools).into_iter().cloned().collect()
}

fn no_documents() -> AgentError {
    AgentError::Decode("this provider does not accept documents".into())
}

fn data_url(mime: &str, data: &str) -> String {
    format!("data:{mime};base64,{data}")
}

fn result_images(message: &Message) -> Vec<&str> {
    message
        .content
        .iter()
        .filter_map(|part| match part {
            ContentPart::ToolResult { images, .. } => Some(images.iter().map(String::as_str)),
            _ => None,
        })
        .flatten()
        .collect()
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

fn openai_content_part(part: &ContentPart, files: bool) -> Result<Option<Value>> {
    Ok(match part {
        ContentPart::Text { text } => Some(json!({ "type": "text", "text": text })),
        ContentPart::Image { image } => {
            parse_image_url(image)?;
            Some(json!({ "type": "image_url", "image_url": { "url": image } }))
        }
        ContentPart::Document { mime, data, name } => {
            if !files {
                return Err(no_documents());
            }
            Some(json!({
                "type": "file",
                "file": { "filename": name, "file_data": data_url(mime, data) },
            }))
        }
        ContentPart::Attachment { .. } => return Err(unresolved_attachment()),
        ContentPart::ToolUse { .. }
        | ContentPart::ToolResult { .. }
        | ContentPart::Thinking { .. }
        | ContentPart::RedactedThinking { .. }
        | ContentPart::Reasoning { .. }
        | ContentPart::ProviderBlock { .. } => None,
    })
}

fn openai_visible_content(rest: &[&ContentPart], images: &[&str], files: bool) -> Result<Value> {
    let mut parts = Vec::with_capacity(rest.len() + images.len());
    for image in images {
        parse_image_url(image)?;
        parts.push(json!({ "type": "image_url", "image_url": { "url": image } }));
    }
    for part in rest {
        if let Some(value) = openai_content_part(part, files)? {
            parts.push(value);
        }
    }
    Ok(match parts.as_slice() {
        [] => Value::Null,
        [only] if only["type"] == "text" => only["text"].clone(),
        _ => Value::Array(parts),
    })
}

fn expects_reasoning_back(base_url: &str) -> bool {
    let Some(host) = reqwest::Url::parse(base_url)
        .ok()
        .and_then(|url| url.host_str().map(str::to_ascii_lowercase))
    else {
        return false;
    };
    [
        "deepseek.com",
        "moonshot.cn",
        "moonshot.ai",
        "bigmodel.cn",
        "z.ai",
    ]
    .iter()
    .any(|domain| host == *domain || host.ends_with(&format!(".{domain}")))
}

pub fn replays_reasoning(resolved: &Resolved) -> bool {
    match &resolved.wire {
        Wire::OpenAiChat {
            base_url,
            reasoning_content: true,
        } => {
            matches!(resolved.provider_id.as_str(), "deepseek" | "zai")
                || expects_reasoning_back(base_url)
        }
        _ => false,
    }
}

fn attach_reasoning(entry: &mut Value, message: &Message) {
    let reasoning = message_reasoning(message);
    if !reasoning.is_empty() {
        entry["reasoning_content"] = json!(reasoning);
    }
}

fn set_output_limit(resolved: &Resolved, req: &CompletionRequest, body: &mut Value) {
    if resolved.provider_id == "groq" {
        // Groq's default completion ceiling is small (1 024).
        let ceiling = req.max_tokens.or_else(|| {
            resolved
                .caps
                .output_limit
                .map(|_| default_max_tokens(&resolved.caps, STREAMING_MAX_TOKENS_CAP))
        });
        if let Some(ceiling) = ceiling {
            body["max_completion_tokens"] = json!(ceiling);
        }
    } else if let Some(m) = req.max_tokens {
        body["max_tokens"] = json!(m);
    }
}

fn set_deepseek_ceiling(resolved: &Resolved, req: &CompletionRequest, body: &mut Value) {
    if resolved.provider_id == "deepseek"
        && req.max_tokens.is_none()
        && body["thinking"]["type"] == "disabled"
    {
        body["max_tokens"] = json!(default_max_tokens(&resolved.caps, STREAMING_MAX_TOKENS_CAP));
    }
}

pub(crate) fn openai_body(resolved: &Resolved, req: &CompletionRequest) -> Result<Value> {
    let effort = effective_effort(resolved, req.effort);
    // OpenRouter parses PDFs itself; other chat providers take no files.
    let files = resolved.provider_id == "openrouter";
    let replays_reasoning = replays_reasoning(resolved);
    let mut has_documents = false;
    let mut messages: Vec<Value> = Vec::new();
    if let Some(system) = joined_system(req) {
        messages.push(json!({ "role": "system", "content": system }));
    }
    for message in &req.messages {
        openai_tool_results(message, &mut messages);
        let images = result_images(message);
        let rest: Vec<&ContentPart> = message
            .content
            .iter()
            .filter(|part| !matches!(part, ContentPart::ToolResult { .. }))
            .collect();
        has_documents |= rest
            .iter()
            .any(|part| matches!(part, ContentPart::Document { .. }));
        if rest.is_empty() && images.is_empty() {
            continue;
        }
        let calls = openai_tool_calls(&rest);
        let content = openai_visible_content(&rest, &images, files)?;
        if content.is_null() && calls.is_empty() {
            continue;
        }
        let role = if images.is_empty() {
            role_str(message.role)
        } else {
            "user"
        };
        let mut entry = json!({ "role": role, "content": content });
        if !calls.is_empty() {
            entry["tool_calls"] = Value::Array(calls);
        }
        if replays_reasoning && role == "assistant" {
            attach_reasoning(&mut entry, message);
        }
        messages.push(entry);
    }

    let mut body = json!({ "model": resolved.model_id, "messages": messages });
    if let Some(t) = req.temperature {
        body["temperature"] = json!(t);
    }
    set_output_limit(resolved, req, &mut body);
    for (key, value) in chat_reasoning_fields(resolved, req, effort) {
        body[key] = value;
    }
    set_deepseek_ceiling(resolved, req, &mut body);
    if has_documents && files {
        body["plugins"] = json!([{ "id": "file-parser", "pdf": { "engine": "native" } }]);
    }
    if !req.tools.is_empty() {
        body["tools"] = openai_tools(&owned_sorted_tools(&req.tools));
    }
    Ok(body)
}

fn responses_part(role: Role, part: &ContentPart) -> Result<Option<Value>> {
    Ok(match part {
        ContentPart::Text { text } => Some(match role {
            Role::User => json!({ "type": "input_text", "text": text }),
            Role::Assistant => json!({ "type": "output_text", "text": text }),
        }),
        ContentPart::Image { image } => {
            parse_image_url(image)?;
            Some(json!({ "type": "input_image", "image_url": image }))
        }
        ContentPart::Document { mime, data, name } => Some(json!({
            "type": "input_file",
            "filename": name,
            "file_data": data_url(mime, data),
        })),
        ContentPart::Attachment { .. } => return Err(unresolved_attachment()),
        _ => None,
    })
}

fn responses_message(role: Role, parts: &[&ContentPart]) -> Result<Option<Value>> {
    let mut content = Vec::new();
    for part in parts {
        if let Some(value) = responses_part(role, part)? {
            content.push(value);
        }
    }
    if content.is_empty() {
        return Ok(None);
    }
    Ok(Some(json!({
        "type": "message",
        "role": role_str(role),
        "content": content,
    })))
}

fn responses_images(images: &[&str]) -> Result<Option<Value>> {
    if images.is_empty() {
        return Ok(None);
    }
    let mut content = Vec::with_capacity(images.len());
    for image in images {
        parse_image_url(image)?;
        content.push(json!({ "type": "input_image", "image_url": image }));
    }
    Ok(Some(json!({
        "type": "message",
        "role": "user",
        "content": content,
    })))
}

pub(crate) fn openai_responses_input(messages: &[Message]) -> Result<Vec<Value>> {
    let mut input = Vec::new();
    for message in messages {
        let mut visible: Vec<&ContentPart> = Vec::new();
        for part in &message.content {
            match part {
                ContentPart::Text { .. }
                | ContentPart::Image { .. }
                | ContentPart::Document { .. }
                | ContentPart::Attachment { .. } => visible.push(part),
                ContentPart::ToolUse {
                    id,
                    name,
                    arguments,
                    ..
                } => {
                    if let Some(item) = responses_message(message.role, &visible)? {
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
                    if let Some(item) = responses_message(message.role, &visible)? {
                        input.push(item);
                    }
                    visible.clear();
                    input.push(json!({
                        "type": "function_call_output",
                        "call_id": id,
                        "output": output,
                    }));
                }
                ContentPart::Thinking { .. }
                | ContentPart::RedactedThinking { .. }
                | ContentPart::Reasoning { .. }
                | ContentPart::ProviderBlock { .. } => {}
            }
        }
        if let Some(item) = responses_images(&result_images(message))? {
            input.push(item);
        }
        if let Some(item) = responses_message(message.role, &visible)? {
            input.push(item);
        }
    }
    Ok(input)
}

pub(crate) fn openai_responses_body(resolved: &Resolved, req: &CompletionRequest) -> Result<Value> {
    let effort = effective_effort(resolved, req.effort);
    let native = native_web(
        &resolved.provider_id,
        &resolved.wire,
        &resolved.model_id,
        req.web,
    );
    let input = match &req.openai_responses_input {
        Some(input) => input.clone(),
        None => openai_responses_input(&req.messages)?,
    };

    let mut include = vec![json!("reasoning.encrypted_content")];
    if native.search {
        include.push(json!("web_search_call.action.sources"));
    }
    let mut body = json!({
        "model": resolved.model_id,
        "input": input,
        "include": include,
        "store": false,
    });
    if let Some(system) = joined_system(req) {
        body["instructions"] = json!(system);
    }
    if let Some(temperature) = req
        .temperature
        .filter(|_| openai_accepts_temperature(&resolved.model_id))
    {
        body["temperature"] = json!(temperature);
    }
    if let Some(max_tokens) = req.max_tokens {
        body["max_output_tokens"] = json!(max_tokens);
    }
    if let Some(reasoning) = responses_reasoning(resolved, req, effort, native.search) {
        body["reasoning"] = reasoning;
    }
    let mut tools = if req.tools.is_empty() {
        Vec::new()
    } else {
        match openai_responses_tools(&owned_sorted_tools(&req.tools)) {
            Value::Array(tools) => tools,
            _ => Vec::new(),
        }
    };
    if let Some(web) = responses_web_tool(native) {
        tools.retain(|tool| tool["name"] != "web_search");
        tools.push(web);
    }
    if !tools.is_empty() {
        body["tools"] = Value::Array(tools);
    }
    Ok(body)
}

fn google_part(part: &ContentPart) -> Result<Option<Value>> {
    Ok(match part {
        ContentPart::Text { text } => Some(json!({ "text": text })),
        ContentPart::Image { image } => {
            let data = parse_image_url(image)?;
            Some(json!({
                "inlineData": {
                    "mimeType": data.media_type,
                    "data": data.base64,
                }
            }))
        }
        ContentPart::Document { mime, data, .. } => Some(json!({
            "inlineData": { "mimeType": mime, "data": data }
        })),
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
            Some(part)
        }
        ContentPart::ToolResult { name, output, .. } => Some(json!({
            "functionResponse": {
                "name": name,
                "response": { "result": output }
            }
        })),
        ContentPart::Attachment { .. } => return Err(unresolved_attachment()),
        ContentPart::Thinking { .. }
        | ContentPart::RedactedThinking { .. }
        | ContentPart::Reasoning { .. }
        | ContentPart::ProviderBlock { .. } => None,
    })
}

/// OpenAI's reasoning models (GPT-5 on, the o-series) default to a reasoning
/// effort under which `temperature` is refused. Only the GPT-4 and GPT-3.5
/// families still take one.
fn openai_accepts_temperature(model_id: &str) -> bool {
    let id = model_id.to_ascii_lowercase();
    id.starts_with("gpt-4") || id.starts_with("gpt-3.5") || id.starts_with("chatgpt-4o")
}

/// Gemini 3 and later ignore `temperature` or loop below 1.0, and Google says
/// later generations will refuse it. Gemini 1.x, 2.x and Gemma still use it.
fn gemini_takes_temperature(model_id: &str) -> bool {
    match model_id.strip_prefix("gemini-") {
        Some(rest) => rest.starts_with("1.") || rest.starts_with("2."),
        None => true,
    }
}

fn google_generation_config(resolved: &Resolved, req: &CompletionRequest) -> Option<Value> {
    let effort = effective_effort(resolved, req.effort);
    let mut generation = serde_json::Map::new();
    if let Some(t) = req
        .temperature
        .filter(|_| gemini_takes_temperature(&resolved.model_id))
    {
        generation.insert("temperature".into(), json!(t));
    }
    let ceiling = req.max_tokens.or_else(|| {
        resolved
            .caps
            .output_limit
            .map(|_| default_max_tokens(&resolved.caps, STREAMING_MAX_TOKENS_CAP))
    });
    if let Some(m) = ceiling {
        generation.insert("maxOutputTokens".into(), json!(m));
    }
    if let Some(thinking) = google_thinking_config(resolved, req, effort) {
        generation.insert("thinkingConfig".into(), thinking);
    }
    if generation.is_empty() {
        None
    } else {
        Some(Value::Object(generation))
    }
}

pub(crate) fn google_body(resolved: &Resolved, req: &CompletionRequest) -> Result<Value> {
    let mut contents: Vec<Value> = Vec::new();
    for message in &req.messages {
        let mut parts = Vec::with_capacity(message.content.len());
        for part in &message.content {
            if let Some(value) = google_part(part)? {
                parts.push(value);
            }
        }
        for image in result_images(message) {
            let data = parse_image_url(image)?;
            parts.push(json!({
                "inlineData": { "mimeType": data.media_type, "data": data.base64 }
            }));
        }
        if parts.is_empty() {
            continue;
        }
        let role = match message.role {
            Role::User => "user",
            Role::Assistant => "model",
        };
        contents.push(json!({ "role": role, "parts": parts }));
    }

    let mut body = json!({ "contents": contents });
    let system_parts: Vec<Value> = [req.system.as_deref(), req.system_suffix.as_deref()]
        .into_iter()
        .flatten()
        .filter(|text| !text.is_empty())
        .map(|text| json!({ "text": text }))
        .collect();
    if !system_parts.is_empty() {
        body["systemInstruction"] = json!({ "parts": system_parts });
    }
    if let Some(generation) = google_generation_config(resolved, req) {
        body["generationConfig"] = generation;
    }
    if !req.tools.is_empty() {
        body["tools"] = google_tools(&owned_sorted_tools(&req.tools));
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
        Wire::Google { .. } => google_body(resolved, req),
    }
}

pub(crate) fn body_request(
    client: &reqwest::Client,
    resolved: &Resolved,
    streaming: bool,
    body: &Value,
) -> reqwest::RequestBuilder {
    let builder = request_builder(client, resolved, streaming).json(body);
    match anthropic_beta_header(body) {
        Some(beta) if matches!(resolved.wire, Wire::Anthropic { .. }) => {
            builder.header("anthropic-beta", beta)
        }
        _ => builder,
    }
}

#[cfg(test)]
mod tests;
