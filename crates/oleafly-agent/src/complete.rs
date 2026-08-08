use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::error::{AgentError, Result};
use crate::message::Message;
use crate::provider::{Resolved, Wire};
use crate::tool::ToolSchema;

pub(crate) use crate::wire::{anthropic_body, auth_headers, google_body, openai_body};
pub use crate::wire::{request_builder, wire_body};


const DEFAULT_TIMEOUT: Duration = Duration::from_secs(180);

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
    #[serde(default)]
    pub idle_timeout_ms: Option<u64>,
    #[serde(default)]
    pub tools: Vec<ToolSchema>,
}

impl CompletionRequest {
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


fn as_u32(value: Option<&Value>) -> u32 {
    value.and_then(|v| v.as_u64()).unwrap_or(0) as u32
}

pub(crate) fn parse_openai(body: &Value) -> Result<(String, Usage)> {
    let message = body
        .pointer("/choices/0/message")
        .ok_or_else(|| AgentError::Decode("response carried no choices".into()))?;
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


pub(crate) fn request_error(error: reqwest::Error) -> AgentError {
    if error.is_timeout() {
        AgentError::Timeout
    } else {
        AgentError::Transport(error.to_string())
    }
}

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



pub async fn complete(
    client: &reqwest::Client,
    resolved: &Resolved,
    req: &CompletionRequest,
) -> Result<CompletionResponse> {
    let timeout = req
        .timeout_ms
        .map(Duration::from_millis)
        .unwrap_or(DEFAULT_TIMEOUT);

    let builder = request_builder(client, resolved, false).json(&wire_body(resolved, req)?);

    let response = builder
        .timeout(timeout)
        .send()
        .await
        .map_err(request_error)?;

    let status = response.status().as_u16();
    let raw = response.text().await.map_err(request_error)?;

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
    use serde_json::json;

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
}
