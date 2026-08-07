use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::error::{AgentError, Result};
use crate::message::{parse_data_url, ContentPart, Message, Role};
use crate::provider::{Resolved, Wire};

/// Anthropic rejects a request that does not declare a token ceiling, so one
/// has to be chosen when the caller expresses no preference.
const DEFAULT_MAX_TOKENS: u32 = 4096;

/// Longest a single one-shot completion may take. Generous enough for a
/// reasoning model on a long paper, short enough that a wedged connection
/// surfaces as an error rather than a spinner that never resolves.
const DEFAULT_TIMEOUT: Duration = Duration::from_secs(180);

/// How much of an unrecognized error body to keep. Provider errors reach the
/// user in a toast, and some services answer with an entire HTML page.
const MAX_ERROR_CHARS: usize = 300;

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct CompletionRequest {
    #[serde(default)]
    pub system: Option<String>,
    pub messages: Vec<Message>,
    #[serde(default)]
    pub temperature: Option<f32>,
    #[serde(default)]
    pub max_tokens: Option<u32>,
    #[serde(default)]
    pub timeout_ms: Option<u64>,
}

impl CompletionRequest {
    /// The single-prompt shape used by most call sites.
    pub fn prompt(system: impl Into<String>, user: impl Into<String>) -> Self {
        CompletionRequest {
            system: Some(system.into()),
            messages: vec![Message::user(user)],
            ..Default::default()
        }
    }
}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct Usage {
    pub input: u32,
    pub output: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompletionResponse {
    pub text: String,
    pub usage: Usage,
    pub provider_id: String,
    pub model_id: String,
}

fn role_str(role: Role) -> &'static str {
    match role {
        Role::User => "user",
        Role::Assistant => "assistant",
    }
}

// --- request bodies -------------------------------------------------------

pub(crate) fn openai_body(resolved: &Resolved, req: &CompletionRequest) -> Result<Value> {
    let mut messages: Vec<Value> = Vec::new();
    if let Some(system) = req.system.as_ref().filter(|s| !s.is_empty()) {
        messages.push(json!({ "role": "system", "content": system }));
    }
    for message in &req.messages {
        // A lone text part goes out as a bare string. Some OpenAI-compatible
        // servers (older Ollama builds among them) only accept that form.
        let content = match message.content.as_slice() {
            [ContentPart::Text { text }] => json!(text),
            parts => {
                let mut out = Vec::with_capacity(parts.len());
                for part in parts {
                    out.push(match part {
                        ContentPart::Text { text } => json!({ "type": "text", "text": text }),
                        ContentPart::Image { image } => {
                            // Validated even though the URL passes through
                            // whole, so a bad image fails here rather than as
                            // an opaque 400 from the provider.
                            parse_data_url(image)?;
                            json!({ "type": "image_url", "image_url": { "url": image } })
                        }
                    });
                }
                json!(out)
            }
        };
        messages.push(json!({ "role": role_str(message.role), "content": content }));
    }

    let mut body = json!({ "model": resolved.model_id, "messages": messages });
    if let Some(t) = req.temperature {
        body["temperature"] = json!(t);
    }
    if let Some(m) = req.max_tokens {
        body["max_tokens"] = json!(m);
    }
    Ok(body)
}

pub(crate) fn anthropic_body(resolved: &Resolved, req: &CompletionRequest) -> Result<Value> {
    let mut messages: Vec<Value> = Vec::new();
    for message in &req.messages {
        let mut parts = Vec::with_capacity(message.content.len());
        for part in &message.content {
            parts.push(match part {
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
            });
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
    Ok(body)
}

pub(crate) fn google_body(req: &CompletionRequest) -> Result<Value> {
    let mut contents: Vec<Value> = Vec::new();
    for message in &req.messages {
        let mut parts = Vec::with_capacity(message.content.len());
        for part in &message.content {
            parts.push(match part {
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
            });
        }
        // Gemini names the assistant turn "model".
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
    let mut generation = serde_json::Map::new();
    if let Some(t) = req.temperature {
        generation.insert("temperature".into(), json!(t));
    }
    if let Some(m) = req.max_tokens {
        generation.insert("maxOutputTokens".into(), json!(m));
    }
    if !generation.is_empty() {
        body["generationConfig"] = Value::Object(generation);
    }
    Ok(body)
}

// --- response parsing -----------------------------------------------------

fn as_u32(value: Option<&Value>) -> u32 {
    value.and_then(|v| v.as_u64()).unwrap_or(0) as u32
}

pub(crate) fn parse_openai(body: &Value) -> Result<(String, Usage)> {
    let message = body
        .pointer("/choices/0/message")
        .ok_or_else(|| AgentError::Decode("response carried no choices".into()))?;
    // Reasoning models put the visible answer in `content` and their thinking
    // in a sibling field, so only `content` is the reply.
    let text = message
        .get("content")
        .and_then(|c| c.as_str())
        .unwrap_or_default()
        .to_string();
    let usage = Usage {
        input: as_u32(body.pointer("/usage/prompt_tokens")),
        output: as_u32(body.pointer("/usage/completion_tokens")),
    };
    Ok((text, usage))
}

pub(crate) fn parse_anthropic(body: &Value) -> Result<(String, Usage)> {
    let blocks = body
        .get("content")
        .and_then(|c| c.as_array())
        .ok_or_else(|| AgentError::Decode("response carried no content blocks".into()))?;
    // A reply can arrive as several text blocks, and a thinking block sits in
    // the same array, so blocks are filtered by type rather than concatenated.
    let text = blocks
        .iter()
        .filter(|b| b.get("type").and_then(|t| t.as_str()) == Some("text"))
        .filter_map(|b| b.get("text").and_then(|t| t.as_str()))
        .collect::<Vec<_>>()
        .join("");
    let usage = Usage {
        input: as_u32(body.pointer("/usage/input_tokens")),
        output: as_u32(body.pointer("/usage/output_tokens")),
    };
    Ok((text, usage))
}

pub(crate) fn parse_google(body: &Value) -> Result<(String, Usage)> {
    let parts = body
        .pointer("/candidates/0/content/parts")
        .and_then(|p| p.as_array())
        .ok_or_else(|| AgentError::Decode("response carried no candidates".into()))?;
    let text = parts
        .iter()
        .filter_map(|p| p.get("text").and_then(|t| t.as_str()))
        .collect::<Vec<_>>()
        .join("");
    let usage = Usage {
        input: as_u32(body.pointer("/usageMetadata/promptTokenCount")),
        output: as_u32(body.pointer("/usageMetadata/candidatesTokenCount")),
    };
    Ok((text, usage))
}

/// Pull the human-readable part out of an error body.
///
/// All three formats nest the useful sentence under `error.message`; anything
/// else is truncated raw text, because an unparsed body still beats a bare
/// status code when a user reports a problem.
pub(crate) fn error_message(status: u16, raw: &str) -> AgentError {
    let message = serde_json::from_str::<Value>(raw)
        .ok()
        .and_then(|v| {
            v.pointer("/error/message")
                .or_else(|| v.pointer("/message"))
                .and_then(|m| m.as_str())
                .map(|s| s.to_string())
        })
        .unwrap_or_else(|| {
            let trimmed = raw.trim();
            if trimmed.chars().count() > MAX_ERROR_CHARS {
                let cut: String = trimmed.chars().take(MAX_ERROR_CHARS).collect();
                format!("{cut}...")
            } else {
                trimmed.to_string()
            }
        });
    AgentError::Provider { status, message }
}

// --- the call ------------------------------------------------------------

/// Run one completion against the resolved provider.
///
/// Cancellation is the caller's job: abort the task holding this future and
/// the in-flight request drops with it.
pub async fn complete(
    client: &reqwest::Client,
    resolved: &Resolved,
    req: &CompletionRequest,
) -> Result<CompletionResponse> {
    let timeout = req
        .timeout_ms
        .map(Duration::from_millis)
        .unwrap_or(DEFAULT_TIMEOUT);

    let builder = match &resolved.wire {
        Wire::OpenAiChat { base_url, .. } => client
            .post(format!(
                "{}/chat/completions",
                base_url.trim_end_matches('/')
            ))
            .bearer_auth(&resolved.credential)
            .json(&openai_body(resolved, req)?),
        Wire::Anthropic { base_url } => client
            .post(format!("{}/messages", base_url.trim_end_matches('/')))
            .header("x-api-key", &resolved.credential)
            .header("anthropic-version", "2023-06-01")
            .json(&anthropic_body(resolved, req)?),
        Wire::Google { base_url } => client
            .post(format!(
                "{}/models/{}:generateContent",
                base_url.trim_end_matches('/'),
                resolved.model_id
            ))
            // Gemini takes the key in a header as well as a query parameter,
            // and the header keeps it out of proxy and server access logs.
            .header("x-goog-api-key", &resolved.credential)
            .json(&google_body(req)?),
    };

    let response = builder.timeout(timeout).send().await.map_err(|e| {
        if e.is_timeout() {
            AgentError::Timeout
        } else {
            AgentError::Transport(e.to_string())
        }
    })?;

    let status = response.status().as_u16();
    let raw = response
        .text()
        .await
        .map_err(|e| AgentError::Transport(e.to_string()))?;

    if !(200..300).contains(&status) {
        return Err(error_message(status, &raw));
    }

    let body: Value = serde_json::from_str(&raw).map_err(|e| AgentError::Decode(e.to_string()))?;
    let (text, usage) = match &resolved.wire {
        Wire::OpenAiChat { .. } => parse_openai(&body)?,
        Wire::Anthropic { .. } => parse_anthropic(&body)?,
        Wire::Google { .. } => parse_google(&body)?,
    };

    Ok(CompletionResponse {
        text,
        usage,
        provider_id: resolved.provider_id.clone(),
        model_id: resolved.model_id.clone(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::message::ContentPart;
    use crate::provider::{ANTHROPIC_BASE, GOOGLE_BASE, OPENAI_BASE};

    fn resolved(wire: Wire) -> Resolved {
        Resolved {
            provider_id: "test".into(),
            model_id: "m-1".into(),
            credential: "sk-test".into(),
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

    #[test]
    fn openai_reply_and_usage_are_read_from_the_documented_shape() {
        let body = json!({
            "choices": [{ "message": { "role": "assistant", "content": "x^2" } }],
            "usage": { "prompt_tokens": 12, "completion_tokens": 3 }
        });
        let (text, usage) = parse_openai(&body).unwrap();
        assert_eq!(text, "x^2");
        assert_eq!(
            usage,
            Usage {
                input: 12,
                output: 3
            }
        );
    }

    #[test]
    fn a_reasoning_reply_yields_only_the_visible_answer() {
        let body = json!({
            "choices": [{ "message": {
                "content": "the answer",
                "reasoning_content": "long private thinking"
            }}]
        });
        assert_eq!(parse_openai(&body).unwrap().0, "the answer");
    }

    #[test]
    fn anthropic_joins_text_blocks_and_skips_thinking() {
        let body = json!({
            "content": [
                { "type": "thinking", "thinking": "hmm" },
                { "type": "text", "text": "part one " },
                { "type": "text", "text": "part two" }
            ],
            "usage": { "input_tokens": 5, "output_tokens": 7 }
        });
        let (text, usage) = parse_anthropic(&body).unwrap();
        assert_eq!(text, "part one part two");
        assert_eq!(
            usage,
            Usage {
                input: 5,
                output: 7
            }
        );
    }

    #[test]
    fn google_joins_candidate_parts() {
        let body = json!({
            "candidates": [{ "content": { "parts": [{ "text": "a" }, { "text": "b" }] } }],
            "usageMetadata": { "promptTokenCount": 9, "candidatesTokenCount": 2 }
        });
        let (text, usage) = parse_google(&body).unwrap();
        assert_eq!(text, "ab");
        assert_eq!(
            usage,
            Usage {
                input: 9,
                output: 2
            }
        );
    }

    #[test]
    fn a_content_free_reply_is_empty_text_rather_than_an_error() {
        // A refusal or a pure tool turn has no content. The caller decides what
        // an empty reply means; parsing must not invent a failure.
        let body = json!({ "choices": [{ "message": { "role": "assistant" } }] });
        assert_eq!(parse_openai(&body).unwrap().0, "");
    }

    #[test]
    fn a_shapeless_reply_is_a_decode_error() {
        assert!(parse_openai(&json!({ "choices": [] })).is_err());
        assert!(parse_anthropic(&json!({})).is_err());
        assert!(parse_google(&json!({ "candidates": [] })).is_err());
    }

    #[test]
    fn provider_errors_surface_their_own_sentence() {
        let err = error_message(401, r#"{"error":{"message":"Incorrect API key provided"}}"#);
        assert_eq!(
            err,
            AgentError::Provider {
                status: 401,
                message: "Incorrect API key provided".into()
            }
        );
        assert!(!err.retryable());
    }

    #[test]
    fn an_html_error_page_is_truncated_not_dumped() {
        let raw = "<html>".to_string() + &"x".repeat(5_000);
        match error_message(502, &raw) {
            AgentError::Provider { message, .. } => {
                assert!(message.chars().count() <= MAX_ERROR_CHARS + 3);
                assert!(message.ends_with("..."));
            }
            other => panic!("expected a provider error, got {other:?}"),
        }
    }

    #[test]
    fn endpoints_are_built_without_double_slashes() {
        // Users paste custom bases with a trailing slash; the URL still has to
        // come out well formed.
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
