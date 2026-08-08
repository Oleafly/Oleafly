use serde_json::{json, Value};

use crate::complete::CompletionRequest;
use crate::error::Result;
use crate::message::{parse_arguments, parse_data_url, ContentPart, Message, Role};
use crate::provider::{Resolved, Wire};
use crate::tool::{anthropic_tools, google_tools, openai_tools};

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
            name, arguments, ..
        } => json!({
            "functionCall": { "name": name, "args": parse_arguments(arguments) }
        }),
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
        Wire::OpenAiChat { .. } => ("authorization", format!("Bearer {token}")),
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
        Wire::OpenAiChat { .. } => openai_body(resolved, req),
        Wire::Anthropic { .. } => anthropic_body(resolved, req),
        Wire::Google { .. } => google_body(req),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::message::ContentPart;
    use crate::provider::{ANTHROPIC_BASE, GOOGLE_BASE, OPENAI_BASE};
    use crate::complete::CompletionRequest;

    fn resolved(wire: Wire) -> Resolved {
        Resolved {
            provider_id: "test".into(),
            model_id: "m-1".into(),
            credential: "sk-test".into(),
            auth: Some("sk-test".into()),
            wire,
        }
    }

    fn openai() -> Resolved {
        resolved(Wire::OpenAiChat {
            base_url: OPENAI_BASE.into(),
            reasoning_content: false,
        })
    }

    fn vision_request() -> CompletionRequest {
        CompletionRequest {
            system: Some("transcribe".into()),
            messages: vec![Message {
                role: Role::User,
                content: vec![
                    ContentPart::text("What is this?"),
                    ContentPart::Image {
                        image: "data:image/png;base64,AAAB".into(),
                    },
                ],
            }],
            ..Default::default()
        }
    }

    #[test]
    fn a_single_text_part_goes_out_as_a_bare_string() {
        let body = openai_body(&openai(), &CompletionRequest::prompt("sys", "hi")).unwrap();
        assert_eq!(body["messages"][0]["role"], "system");
        assert_eq!(body["messages"][1]["content"], json!("hi"));
    }

    #[test]
    fn an_empty_system_prompt_is_omitted_everywhere() {
        let mut req = CompletionRequest::prompt("", "hi");
        assert_eq!(
            openai_body(&openai(), &req).unwrap()["messages"][0]["role"],
            "user"
        );
        assert!(anthropic_body(&openai(), &req)
            .unwrap()
            .get("system")
            .is_none());
        assert!(google_body(&req)
            .unwrap()
            .get("systemInstruction")
            .is_none());

        req.system = None;
        assert_eq!(
            openai_body(&openai(), &req).unwrap()["messages"]
                .as_array()
                .unwrap()
                .len(),
            1
        );
    }

    #[test]
    fn images_take_each_providers_own_shape() {
        let req = vision_request();

        let oa = openai_body(&openai(), &req).unwrap();
        assert_eq!(oa["messages"][1]["content"][1]["type"], "image_url");
        assert_eq!(
            oa["messages"][1]["content"][1]["image_url"]["url"],
            "data:image/png;base64,AAAB"
        );

        let an = anthropic_body(&openai(), &req).unwrap();
        assert_eq!(
            an["messages"][0]["content"][1]["source"]["media_type"],
            "image/png"
        );
        assert_eq!(an["messages"][0]["content"][1]["source"]["data"], "AAAB");

        let gg = google_body(&req).unwrap();
        assert_eq!(
            gg["contents"][0]["parts"][1]["inlineData"]["mimeType"],
            "image/png"
        );
        assert_eq!(gg["contents"][0]["parts"][1]["inlineData"]["data"], "AAAB");
    }

    #[test]
    fn a_remote_image_url_is_refused_before_any_request_leaves() {
        let req = CompletionRequest {
            messages: vec![Message {
                role: Role::User,
                content: vec![
                    ContentPart::text("look"),
                    ContentPart::Image {
                        image: "https://example.com/x.png".into(),
                    },
                ],
            }],
            ..Default::default()
        };
        assert!(openai_body(&openai(), &req).is_err());
        assert!(anthropic_body(&openai(), &req).is_err());
        assert!(google_body(&req).is_err());
    }

    fn tool_turn() -> CompletionRequest {
        CompletionRequest {
            system: Some("sys".into()),
            messages: vec![
                Message::user("read main.tex"),
                Message {
                    role: Role::Assistant,
                    content: vec![
                        ContentPart::text("Reading it now."),
                        ContentPart::ToolUse {
                            id: "call_1".into(),
                            name: "read_file".into(),
                            arguments: "{\"path\":\"main.tex\"}".into(),
                        },
                    ],
                },
                Message {
                    role: Role::User,
                    content: vec![ContentPart::ToolResult {
                        id: "call_1".into(),
                        name: "read_file".into(),
                        output: "\\documentclass{article}".into(),
                    }],
                },
            ],
            tools: vec![crate::tool::ToolSchema {
                name: "read_file".into(),
                description: "Read a file".into(),
                input_schema: json!({"type":"object","properties":{}}),
            }],
            ..Default::default()
        }
    }

    #[test]
    fn openai_puts_tool_calls_on_the_assistant_and_results_in_their_own_messages() {
        let body = openai_body(&openai(), &tool_turn()).unwrap();
        let messages = body["messages"].as_array().unwrap();

        assert_eq!(messages[0]["role"], "system");
        assert_eq!(messages[1]["role"], "user");

        let assistant = &messages[2];
        assert_eq!(assistant["role"], "assistant");
        assert_eq!(assistant["content"], "Reading it now.");
        assert_eq!(assistant["tool_calls"][0]["id"], "call_1");
        assert_eq!(assistant["tool_calls"][0]["function"]["name"], "read_file");
        assert_eq!(
            assistant["tool_calls"][0]["function"]["arguments"],
            "{\"path\":\"main.tex\"}"
        );

        let result = &messages[3];
        assert_eq!(result["role"], "tool");
        assert_eq!(result["tool_call_id"], "call_1");
        assert_eq!(result["content"], "\\documentclass{article}");
        assert_eq!(messages.len(), 4);
    }

    #[test]
    fn a_tool_result_only_turn_produces_no_empty_user_message() {
        let request = CompletionRequest {
            messages: vec![Message {
                role: Role::User,
                content: vec![ContentPart::ToolResult {
                    id: "c".into(),
                    name: "n".into(),
                    output: "out".into(),
                }],
            }],
            ..Default::default()
        };
        let body = openai_body(&openai(), &request).unwrap();
        let messages = body["messages"].as_array().unwrap();
        assert_eq!(messages.len(), 1);
        assert_eq!(messages[0]["role"], "tool");
    }

    #[test]
    fn an_assistant_turn_of_only_tool_calls_sends_null_content() {
        let request = CompletionRequest {
            messages: vec![Message {
                role: Role::Assistant,
                content: vec![ContentPart::ToolUse {
                    id: "c".into(),
                    name: "n".into(),
                    arguments: "{}".into(),
                }],
            }],
            ..Default::default()
        };
        let body = openai_body(&openai(), &request).unwrap();
        assert!(body["messages"][0]["content"].is_null());
        assert_eq!(body["messages"][0]["tool_calls"][0]["id"], "c");
    }

    #[test]
    fn anthropic_keeps_tool_blocks_inside_the_turn_and_parses_arguments() {
        let body = anthropic_body(&openai(), &tool_turn()).unwrap();
        let messages = body["messages"].as_array().unwrap();

        let assistant = &messages[1];
        assert_eq!(assistant["content"][0]["type"], "text");
        assert_eq!(assistant["content"][1]["type"], "tool_use");
        assert_eq!(assistant["content"][1]["id"], "call_1");
        assert_eq!(assistant["content"][1]["input"]["path"], "main.tex");

        let result = &messages[2];
        assert_eq!(result["role"], "user");
        assert_eq!(result["content"][0]["type"], "tool_result");
        assert_eq!(result["content"][0]["tool_use_id"], "call_1");
    }

    #[test]
    fn google_uses_function_call_and_response_parts() {
        let body = google_body(&tool_turn()).unwrap();
        let contents = body["contents"].as_array().unwrap();

        assert_eq!(contents[1]["role"], "model");
        assert_eq!(contents[1]["parts"][1]["functionCall"]["name"], "read_file");
        assert_eq!(
            contents[1]["parts"][1]["functionCall"]["args"]["path"],
            "main.tex"
        );

        assert_eq!(contents[2]["role"], "user");
        assert_eq!(
            contents[2]["parts"][0]["functionResponse"]["name"],
            "read_file"
        );
    }

    #[test]
    fn tool_schemas_reach_every_provider_in_its_own_shape() {
        let request = tool_turn();
        assert_eq!(
            openai_body(&openai(), &request).unwrap()["tools"][0]["function"]["name"],
            "read_file"
        );
        assert_eq!(
            anthropic_body(&openai(), &request).unwrap()["tools"][0]["name"],
            "read_file"
        );
        assert_eq!(
            google_body(&request).unwrap()["tools"][0]["functionDeclarations"][0]["name"],
            "read_file"
        );
    }

    #[test]
    fn a_request_without_tools_sends_no_tools_field() {
        let request = CompletionRequest::prompt("s", "u");
        assert!(openai_body(&openai(), &request)
            .unwrap()
            .get("tools")
            .is_none());
        assert!(anthropic_body(&openai(), &request)
            .unwrap()
            .get("tools")
            .is_none());
        assert!(google_body(&request).unwrap().get("tools").is_none());
    }

    #[test]
    fn truncated_tool_arguments_do_not_break_the_request() {
        let request = CompletionRequest {
            messages: vec![Message {
                role: Role::Assistant,
                content: vec![ContentPart::ToolUse {
                    id: "c".into(),
                    name: "n".into(),
                    arguments: "{\"path\":".into(),
                }],
            }],
            ..Default::default()
        };
        assert_eq!(
            anthropic_body(&openai(), &request).unwrap()["messages"][0]["content"][0]["input"],
            json!({})
        );
    }

    #[test]
    fn anthropic_always_declares_a_token_ceiling() {
        let req = CompletionRequest::prompt("s", "u");
        assert_eq!(
            anthropic_body(&openai(), &req).unwrap()["max_tokens"],
            DEFAULT_MAX_TOKENS
        );

        let capped = CompletionRequest {
            max_tokens: Some(64),
            ..CompletionRequest::prompt("s", "u")
        };
        assert_eq!(
            anthropic_body(&openai(), &capped).unwrap()["max_tokens"],
            64
        );
    }

    #[test]
    fn google_renames_the_assistant_turn() {
        let req = CompletionRequest {
            messages: vec![
                Message::user("hi"),
                Message {
                    role: Role::Assistant,
                    content: vec![ContentPart::text("hello")],
                },
            ],
            ..Default::default()
        };
        let body = google_body(&req).unwrap();
        assert_eq!(body["contents"][0]["role"], "user");
        assert_eq!(body["contents"][1]["role"], "model");
    }

    #[test]
    fn generation_config_is_omitted_when_nothing_was_asked_for() {
        let req = CompletionRequest::prompt("s", "u");
        assert!(google_body(&req).unwrap().get("generationConfig").is_none());
    }

    fn header_names(resolved: &Resolved) -> Vec<String> {
        auth_headers(resolved)
            .keys()
            .map(|k| k.as_str().to_string())
            .collect()
    }

    fn header_value(resolved: &Resolved, name: &str) -> Option<String> {
        auth_headers(resolved)
            .get(name)
            .map(|v| String::from_utf8_lossy(v.as_bytes()).to_string())
    }

    #[test]
    fn each_wire_authenticates_the_way_its_api_documents() {
        let openai_wire = openai();
        assert_eq!(
            header_value(&openai_wire, "authorization").as_deref(),
            Some("Bearer sk-test")
        );

        let anthropic_wire = resolved(Wire::Anthropic {
            base_url: ANTHROPIC_BASE.into(),
        });
        assert_eq!(
            header_value(&anthropic_wire, "x-api-key").as_deref(),
            Some("sk-test")
        );
        assert!(header_value(&anthropic_wire, "authorization").is_none());

        let google_wire = resolved(Wire::Google {
            base_url: GOOGLE_BASE.into(),
        });
        assert_eq!(
            header_value(&google_wire, "x-goog-api-key").as_deref(),
            Some("sk-test")
        );
    }

    #[test]
    fn a_provider_that_needs_no_credential_gets_no_auth_header() {
        let anonymous = Resolved {
            auth: None,
            ..openai()
        };
        assert!(header_names(&anonymous).is_empty());
    }

    #[test]
    fn the_credential_header_is_marked_sensitive_so_it_stays_out_of_logs() {
        let headers = auth_headers(&openai());
        assert!(headers.get("authorization").unwrap().is_sensitive());
    }

    #[test]
    fn endpoints_are_built_without_double_slashes() {
        for base in [OPENAI_BASE, "http://localhost:8000/v1/"] {
            let url = format!("{}/chat/completions", base.trim_end_matches('/'));
            assert!(!url.contains("//chat"), "bad url {url}");
        }
        assert_eq!(
            format!("{}/messages", ANTHROPIC_BASE.trim_end_matches('/')),
            "https://api.anthropic.com/v1/messages"
        );
        assert_eq!(
            format!("{}/models/{}:generateContent", GOOGLE_BASE.trim_end_matches('/'), "gemini-2.5-pro"),
            "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent"
        );
    }
}
