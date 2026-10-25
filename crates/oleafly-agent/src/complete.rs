use std::borrow::Cow;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::effort::Effort;
use crate::error::{AgentError, Result};
use crate::message::Message;
use crate::provider::{Resolved, Wire};
use crate::tool::ToolSchema;

pub(crate) use crate::wire::{
    anthropic_body, auth_headers, google_body, openai_body, openai_responses_body,
};
pub use crate::wire::{request_builder, wire_body};

const DEFAULT_TIMEOUT: Duration = Duration::from_secs(180);
pub(crate) const MAX_COMPLETION_DURATION: Duration = Duration::from_secs(10 * 60);

const MAX_ERROR_CHARS: usize = 300;
pub(crate) const MAX_COMPLETION_BODY_BYTES: usize = 16 * 1024 * 1024;
pub(crate) const MAX_ERROR_BODY_BYTES: usize = 1024 * 1024;

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
    /// Internal stateless Responses API continuation. Renderer input is always
    /// ignored; the Rust agent builds this only from provider-returned items.
    #[doc(hidden)]
    #[serde(default, skip_deserializing, skip_serializing_if = "Option::is_none")]
    pub openai_responses_input: Option<Vec<Value>>,
    /// How hard the model thinks; `None` is the provider's default. Unknown
    /// names from a newer renderer read as `None`.
    #[serde(default, deserialize_with = "crate::effort::lenient_effort")]
    pub effort: Option<Effort>,
    /// Web search and fetch for this run.
    #[serde(default)]
    pub web: Option<WebTools>,
    /// Ask the model for readable reasoning summaries.
    #[serde(default)]
    pub reasoning_summary: Option<bool>,
    /// Per-run context sent after the system prompt, so the stable prompt
    /// before it stays cacheable.
    #[serde(default)]
    pub system_suffix: Option<String>,
    /// The Anthropic code-execution container to keep using. Set by the run
    /// from the provider's replies only.
    #[doc(hidden)]
    #[serde(default, skip_deserializing, skip_serializing_if = "Option::is_none")]
    pub anthropic_container: Option<String>,
}

/// The web tools a run may use.
#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct WebTools {
    #[serde(default)]
    pub search: bool,
    #[serde(default)]
    pub fetch: bool,
}

impl WebTools {
    pub fn any(self) -> bool {
        self.search || self.fetch
    }
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

fn completion_timeout(req: &CompletionRequest) -> Duration {
    req.timeout_ms
        .map(Duration::from_millis)
        .unwrap_or(DEFAULT_TIMEOUT)
        .min(MAX_COMPLETION_DURATION)
}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum InputTokenSemantics {
    Inclusive,
    Exclusive,
    #[default]
    Unknown,
}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Usage {
    pub input: u32,
    pub output: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub input_known: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub output_known: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cache_read: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cache_write: Option<u32>,
    #[serde(default, skip_serializing_if = "is_unknown_input_semantics")]
    pub input_semantics: InputTokenSemantics,
    /// Tokens spent on reasoning, when the provider reports them. They are
    /// part of `output` too.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reasoning: Option<u32>,
}

impl Usage {
    pub fn reported_input(&self) -> Option<u32> {
        self.input_known
            .unwrap_or_else(|| self.has_legacy_observation())
            .then_some(self.input)
    }

    pub fn reported_output(&self) -> Option<u32> {
        self.output_known
            .unwrap_or_else(|| self.has_legacy_observation())
            .then_some(self.output)
    }

    fn has_legacy_observation(&self) -> bool {
        self.input != 0
            || self.output != 0
            || self.cache_read.is_some()
            || self.cache_write.is_some()
            || self.input_semantics != InputTokenSemantics::Unknown
    }

    pub fn is_observed(&self) -> bool {
        self.reported_input().is_some()
            || self.reported_output().is_some()
            || self.cache_read.is_some()
            || self.cache_write.is_some()
    }

    pub(crate) fn merge_snapshot(&mut self, next: Self) {
        if let Some(input) = next.reported_input() {
            self.input = input;
            self.input_known = Some(true);
        } else if self.input_known.is_none() {
            self.input_known = Some(false);
        }
        if let Some(output) = next.reported_output() {
            self.output = output;
            self.output_known = Some(true);
        } else if self.output_known.is_none() {
            self.output_known = Some(false);
        }
        self.cache_read = next.cache_read.or(self.cache_read);
        self.cache_write = next.cache_write.or(self.cache_write);
        self.reasoning = next.reasoning.or(self.reasoning);
        if next.input_semantics != InputTokenSemantics::Unknown {
            self.input_semantics = next.input_semantics;
        }
    }
}

fn is_unknown_input_semantics(value: &InputTokenSemantics) -> bool {
    *value == InputTokenSemantics::Unknown
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompletionResponse {
    pub text: String,
    pub usage: Usage,
    pub provider_id: String,
    pub model_id: String,
    /// Why the reply ended, as the provider said it (`stop`, `length`,
    /// `max_tokens`, `refusal`, ...). `None` when the reply carries none.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stop_reason: Option<String>,
}

fn as_u32(value: Option<&Value>) -> u32 {
    value
        .and_then(|v| v.as_u64())
        .map(|number| u32::try_from(number).unwrap_or(u32::MAX))
        .unwrap_or(0)
}

fn as_optional_u32(value: Option<&Value>) -> Option<u32> {
    value
        .and_then(|value| value.as_u64())
        .map(|number| u32::try_from(number).unwrap_or(u32::MAX))
}

pub(crate) fn openai_cached_tokens(usage: &Value) -> Option<u32> {
    as_optional_u32(usage.pointer("/prompt_tokens_details/cached_tokens"))
        .or_else(|| as_optional_u32(usage.get("prompt_cache_hit_tokens")))
}

pub(crate) fn google_output_tokens(meta: &Value) -> Option<u32> {
    let candidates = as_optional_u32(meta.get("candidatesTokenCount"));
    let thoughts = as_optional_u32(meta.get("thoughtsTokenCount"));
    match (candidates, thoughts) {
        (None, None) => None,
        (candidates, thoughts) => Some(
            candidates
                .unwrap_or(0)
                .saturating_add(thoughts.unwrap_or(0)),
        ),
    }
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
        input_known: Some(as_optional_u32(body.pointer("/usage/prompt_tokens")).is_some()),
        output_known: Some(as_optional_u32(body.pointer("/usage/completion_tokens")).is_some()),
        cache_read: body.get("usage").and_then(openai_cached_tokens),
        cache_write: (as_optional_u32(body.pointer("/usage/prompt_tokens")).is_some()
            || as_optional_u32(body.pointer("/usage/completion_tokens")).is_some())
        .then_some(0),
        input_semantics: InputTokenSemantics::Inclusive,
        reasoning: as_optional_u32(
            body.pointer("/usage/completion_tokens_details/reasoning_tokens"),
        ),
    };
    Ok((
        text,
        if body.get("usage").is_some_and(Value::is_object) {
            usage
        } else {
            Usage::default()
        },
    ))
}

pub(crate) fn parse_openai_responses(body: &Value) -> Result<(String, Usage)> {
    let output = body
        .get("output")
        .and_then(|output| output.as_array())
        .ok_or_else(|| AgentError::Decode("response carried no output items".into()))?;
    let text = output
        .iter()
        .filter(|item| item.get("type").and_then(|kind| kind.as_str()) == Some("message"))
        .filter_map(|item| item.get("content").and_then(|content| content.as_array()))
        .flatten()
        .filter_map(
            |part| match part.get("type").and_then(|kind| kind.as_str()) {
                Some("output_text") => part.get("text").and_then(|text| text.as_str()),
                Some("refusal") => part.get("refusal").and_then(|text| text.as_str()),
                _ => None,
            },
        )
        .collect::<Vec<_>>()
        .join("");
    let usage = Usage {
        input: as_u32(body.pointer("/usage/input_tokens")),
        output: as_u32(body.pointer("/usage/output_tokens")),
        input_known: Some(as_optional_u32(body.pointer("/usage/input_tokens")).is_some()),
        output_known: Some(as_optional_u32(body.pointer("/usage/output_tokens")).is_some()),
        cache_read: as_optional_u32(body.pointer("/usage/input_tokens_details/cached_tokens")),
        cache_write: (as_optional_u32(body.pointer("/usage/input_tokens")).is_some()
            || as_optional_u32(body.pointer("/usage/output_tokens")).is_some())
        .then_some(0),
        input_semantics: InputTokenSemantics::Inclusive,
        reasoning: as_optional_u32(body.pointer("/usage/output_tokens_details/reasoning_tokens")),
    };
    Ok((
        text,
        if body.get("usage").is_some_and(Value::is_object) {
            usage
        } else {
            Usage::default()
        },
    ))
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
        input_known: Some(as_optional_u32(body.pointer("/usage/input_tokens")).is_some()),
        output_known: Some(as_optional_u32(body.pointer("/usage/output_tokens")).is_some()),
        cache_read: as_optional_u32(body.pointer("/usage/cache_read_input_tokens")),
        cache_write: as_optional_u32(body.pointer("/usage/cache_creation_input_tokens")),
        input_semantics: InputTokenSemantics::Exclusive,
        reasoning: None,
    };
    Ok((
        text,
        if body.get("usage").is_some_and(Value::is_object) {
            usage
        } else {
            Usage::default()
        },
    ))
}

pub(crate) fn parse_google(body: &Value) -> Result<(String, Usage)> {
    let parts = body
        .pointer("/candidates/0/content/parts")
        .and_then(|p| p.as_array())
        .ok_or_else(|| AgentError::Decode("response carried no candidates".into()))?;
    let text = parts
        .iter()
        .filter(|p| p.get("thought").and_then(|t| t.as_bool()) != Some(true))
        .filter_map(|p| p.get("text").and_then(|t| t.as_str()))
        .collect::<Vec<_>>()
        .join("");
    let meta = body.get("usageMetadata").unwrap_or(&Value::Null);
    let output = google_output_tokens(meta);
    let counted = as_optional_u32(meta.get("promptTokenCount")).is_some() || output.is_some();
    let usage = Usage {
        input: as_u32(meta.get("promptTokenCount")),
        output: output.unwrap_or(0),
        input_known: Some(as_optional_u32(meta.get("promptTokenCount")).is_some()),
        output_known: Some(output.is_some()),
        cache_read: as_optional_u32(meta.get("cachedContentTokenCount")).or(counted.then_some(0)),
        cache_write: counted.then_some(0),
        input_semantics: InputTokenSemantics::Inclusive,
        reasoning: as_optional_u32(meta.get("thoughtsTokenCount")),
    };
    Ok((
        text,
        if body.get("usageMetadata").is_some_and(Value::is_object) {
            usage
        } else {
            Usage::default()
        },
    ))
}

/// Why a blocking reply ended, named the way the streaming path names it, so
/// `is_output_limit_stop` and `is_refusal_stop` read both.
pub(crate) fn blocking_stop_reason(wire: &Wire, body: &Value) -> Option<String> {
    let reason = match wire {
        Wire::OpenAiChat { .. } => body
            .pointer("/choices/0/finish_reason")
            .and_then(Value::as_str),
        Wire::OpenAiResponses { .. } => match body.get("status").and_then(Value::as_str) {
            Some("incomplete") => Some(
                body.pointer("/incomplete_details/reason")
                    .and_then(Value::as_str)
                    .unwrap_or("incomplete"),
            ),
            status => status,
        },
        Wire::Anthropic { .. } => body.get("stop_reason").and_then(Value::as_str),
        Wire::Google { .. } => body
            .pointer("/candidates/0/finishReason")
            .and_then(Value::as_str),
    };
    reason.map(str::to_string)
}

pub(crate) fn request_error(error: reqwest::Error) -> AgentError {
    if error.is_timeout() {
        AgentError::Timeout
    } else {
        AgentError::Transport(error.to_string())
    }
}

struct BoundedBody {
    bytes: Vec<u8>,
    max_bytes: usize,
    description: &'static str,
}

impl BoundedBody {
    fn new(max_bytes: usize, description: &'static str) -> Self {
        Self {
            bytes: Vec::new(),
            max_bytes,
            description,
        }
    }

    fn push(&mut self, chunk: &[u8]) -> Result<()> {
        let next_len = self
            .bytes
            .len()
            .checked_add(chunk.len())
            .ok_or_else(|| body_limit_error(self.description, self.max_bytes))?;
        if next_len > self.max_bytes {
            return Err(body_limit_error(self.description, self.max_bytes));
        }
        self.bytes.extend_from_slice(chunk);
        Ok(())
    }

    fn finish(self) -> Vec<u8> {
        self.bytes
    }
}

fn body_limit_error(description: &str, max_bytes: usize) -> AgentError {
    AgentError::Decode(format!(
        "{description} exceeded the {max_bytes}-byte safety limit"
    ))
}

pub(crate) async fn read_body_limited(
    mut response: reqwest::Response,
    max_bytes: usize,
    description: &'static str,
) -> Result<Vec<u8>> {
    if response
        .content_length()
        .map(|length| length > max_bytes as u64)
        .unwrap_or(false)
    {
        return Err(body_limit_error(description, max_bytes));
    }

    let mut body = BoundedBody::new(max_bytes, description);
    while let Some(chunk) = response.chunk().await.map_err(request_error)? {
        body.push(&chunk)?;
    }
    Ok(body.finish())
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
    AgentError::provider(status, message)
}

fn provider_error_from_read(status: u16, body: Result<Vec<u8>>) -> AgentError {
    match body {
        Ok(raw) => error_message(status, &String::from_utf8_lossy(&raw)),
        Err(AgentError::Decode(message)) => AgentError::provider(status, message),
        Err(error) => error,
    }
}

/// The wait a provider asked for: `retry-after-ms` (OpenAI), else
/// `retry-after` in seconds. An HTTP date in `retry-after` is not read; the
/// caller's own backoff applies then.
pub(crate) fn retry_after(headers: &reqwest::header::HeaderMap) -> Option<Duration> {
    let number = |name: &str| {
        headers
            .get(name)?
            .to_str()
            .ok()?
            .trim()
            .parse::<f64>()
            .ok()
            .filter(|value| value.is_finite() && *value >= 0.0)
    };
    match number("retry-after-ms") {
        Some(millis) => Duration::try_from_secs_f64(millis / 1_000.0).ok(),
        None => number("retry-after").and_then(|seconds| Duration::try_from_secs_f64(seconds).ok()),
    }
}

pub(crate) async fn read_provider_error(
    response: reqwest::Response,
    status: u16,
    description: &'static str,
) -> AgentError {
    let wait = retry_after(response.headers());
    let error = provider_error_from_read(
        status,
        read_body_limited(response, MAX_ERROR_BODY_BYTES, description).await,
    );
    match error {
        AgentError::Provider {
            status, message, ..
        } => AgentError::Provider {
            status,
            message,
            retry_after: wait,
        },
        other => other,
    }
}

/// A blocking call gets a modest output ceiling when it sets none: always on
/// Anthropic (which requires one), and on Google and Groq when the model's
/// limit is known.
pub(crate) fn with_blocking_ceiling<'a>(
    resolved: &Resolved,
    req: &'a CompletionRequest,
) -> Cow<'a, CompletionRequest> {
    if req.max_tokens.is_some() {
        return Cow::Borrowed(req);
    }
    let needs = match &resolved.wire {
        Wire::Anthropic { .. } => true,
        Wire::Google { .. } => resolved.caps.output_limit.is_some(),
        Wire::OpenAiChat { .. } => {
            resolved.provider_id == "groq" && resolved.caps.output_limit.is_some()
        }
        Wire::OpenAiResponses { .. } => false,
    };
    if !needs {
        return Cow::Borrowed(req);
    }
    let mut owned = req.clone();
    owned.max_tokens = Some(crate::wire::reasoning::default_max_tokens(
        &resolved.caps,
        crate::wire::reasoning::BLOCKING_MAX_TOKENS_CAP,
    ));
    Cow::Owned(owned)
}

pub async fn complete(
    client: &reqwest::Client,
    resolved: &Resolved,
    req: &CompletionRequest,
) -> Result<CompletionResponse> {
    crate::run::validate_completion_request(req)?;
    let timeout = completion_timeout(req);
    let req = with_blocking_ceiling(resolved, req);

    let body = wire_body(resolved, &req)?;
    let builder = crate::wire::body_request(client, resolved, false, &body);

    let response = builder
        .timeout(timeout)
        .send()
        .await
        .map_err(request_error)?;

    let status = response.status().as_u16();
    if !(200..300).contains(&status) {
        return Err(read_provider_error(response, status, "completion error response body").await);
    }
    let raw = read_body_limited(
        response,
        MAX_COMPLETION_BODY_BYTES,
        "completion response body",
    )
    .await?;

    let body: Value =
        serde_json::from_slice(&raw).map_err(|e| AgentError::Decode(e.to_string()))?;
    let (text, usage) = match &resolved.wire {
        Wire::OpenAiResponses { .. } => parse_openai_responses(&body)?,
        Wire::OpenAiChat { .. } => parse_openai(&body)?,
        Wire::Anthropic { .. } => parse_anthropic(&body)?,
        Wire::Google { .. } => parse_google(&body)?,
    };

    Ok(CompletionResponse {
        text,
        usage,
        provider_id: resolved.provider_id.clone(),
        model_id: resolved.model_id.clone(),
        stop_reason: blocking_stop_reason(&resolved.wire, &body),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn missing_usage_and_partial_counters_do_not_become_reported_zero() {
        let samples = [
            (
                parse_openai as fn(&Value) -> Result<(String, Usage)>,
                json!({"choices":[{"message":{"content":"answer"}}]}),
                "usage",
                "prompt_tokens",
                "completion_tokens",
            ),
            (
                parse_openai_responses,
                json!({"output":[]}),
                "usage",
                "input_tokens",
                "output_tokens",
            ),
            (
                parse_anthropic,
                json!({"content":[]}),
                "usage",
                "input_tokens",
                "output_tokens",
            ),
            (
                parse_google,
                json!({"candidates":[{"content":{"parts":[]}}]}),
                "usageMetadata",
                "promptTokenCount",
                "candidatesTokenCount",
            ),
        ];
        for (parse, mut body, key, input_key, output_key) in samples {
            let absent = parse(&body).unwrap().1;
            assert_eq!(absent, Usage::default());
            assert_eq!(absent.reported_input(), None);
            assert_eq!(absent.reported_output(), None);
            body[key] = json!({});
            let empty = parse(&body).unwrap().1;
            assert_eq!(empty.reported_input(), None);
            assert_eq!(empty.reported_output(), None);
            assert_eq!(empty.cache_read, None);
            assert_eq!(empty.cache_write, None);
            body[key] = json!({input_key: 0});
            let input_only = parse(&body).unwrap().1;
            assert_eq!(input_only.reported_input(), Some(0));
            assert_eq!(input_only.reported_output(), None);
            body[key] = json!({output_key: 0});
            let output_only = parse(&body).unwrap().1;
            assert_eq!(output_only.reported_input(), None);
            assert_eq!(output_only.reported_output(), Some(0));
            body[key] = json!({input_key: 0, output_key: 0});
            let zero = parse(&body).unwrap().1;
            assert_eq!(zero.reported_input(), Some(0));
            assert_eq!(zero.reported_output(), Some(0));
        }
    }

    #[test]
    fn openai_reply_and_usage_are_read_from_the_documented_shape() {
        let body = json!({
            "choices": [{ "message": { "role": "assistant", "content": "x^2" } }],
            "usage": {
                "prompt_tokens": 12,
                "completion_tokens": 3,
                "prompt_tokens_details": { "cached_tokens": 4 }
            }
        });
        let (text, usage) = parse_openai(&body).unwrap();
        assert_eq!(text, "x^2");
        assert_eq!(
            usage,
            Usage {
                input: 12,
                output: 3,
                input_known: Some(true),
                output_known: Some(true),
                cache_read: Some(4),
                cache_write: Some(0),
                input_semantics: InputTokenSemantics::Inclusive,
                reasoning: None,
            }
        );
    }

    #[test]
    fn responses_reply_and_usage_are_read_from_output_items() {
        let body = json!({
            "output": [
                { "type": "reasoning", "summary": [] },
                {
                    "type": "message",
                    "role": "assistant",
                    "content": [
                        { "type": "output_text", "text": "part one " },
                        { "type": "output_text", "text": "part two" }
                    ]
                }
            ],
            "usage": {
                "input_tokens": 17,
                "output_tokens": 5,
                "input_tokens_details": { "cached_tokens": 6 }
            }
        });
        let (text, usage) = parse_openai_responses(&body).unwrap();
        assert_eq!(text, "part one part two");
        assert_eq!(
            usage,
            Usage {
                input: 17,
                output: 5,
                input_known: Some(true),
                output_known: Some(true),
                cache_read: Some(6),
                cache_write: Some(0),
                input_semantics: InputTokenSemantics::Inclusive,
                reasoning: None,
            }
        );
    }

    #[test]
    fn an_older_request_without_the_new_fields_still_deserializes() {
        let request: CompletionRequest = serde_json::from_str(r#"{"messages":[]}"#).unwrap();
        assert_eq!(
            (
                request.effort,
                request.web,
                request.reasoning_summary,
                request.system_suffix
            ),
            (None, None, None, None)
        );
    }

    #[test]
    fn unknown_effort_strings_mean_auto() {
        let parse = |raw: &str| {
            serde_json::from_str::<CompletionRequest>(raw)
                .unwrap()
                .effort
        };
        assert_eq!(parse(r#"{"messages":[],"effort":"ultra"}"#), None);
        assert_eq!(
            parse(r#"{"messages":[],"effort":"xhigh"}"#),
            Some(Effort::Xhigh)
        );
        assert_eq!(parse(r#"{"messages":[],"effort":7}"#), None);
        assert_eq!(parse(r#"{"messages":[],"effort":null}"#), None);
    }

    #[test]
    fn web_tools_default_to_off() {
        let request: CompletionRequest =
            serde_json::from_str(r#"{"messages":[],"web":{}}"#).unwrap();
        assert_eq!(
            request.web,
            Some(WebTools {
                search: false,
                fetch: false
            })
        );
    }

    #[test]
    fn the_renderer_cannot_set_the_internal_container() {
        let request: CompletionRequest =
            serde_json::from_str(r#"{"messages":[],"anthropic_container":"c1"}"#).unwrap();
        assert_eq!(request.anthropic_container, None);
    }

    #[test]
    fn reasoning_tokens_merge_and_serialize_only_when_known() {
        let mut usage = Usage::default();
        usage.merge_snapshot(Usage {
            reasoning: Some(12),
            ..Usage::default()
        });
        assert_eq!(usage.reasoning, Some(12));
        assert!(serde_json::to_value(Usage::default())
            .unwrap()
            .get("reasoning")
            .is_none());
        let body = json!({
            "choices": [{ "message": { "content": "a" } }],
            "usage": { "prompt_tokens": 1, "completion_tokens": 20, "completion_tokens_details": { "reasoning_tokens": 12 } }
        });
        assert_eq!(parse_openai(&body).unwrap().1.reasoning, Some(12));
    }

    #[test]
    fn provider_usage_counters_saturate_instead_of_wrapping() {
        assert_eq!(as_u32(Some(&json!(u64::MAX))), u32::MAX);
    }

    #[test]
    fn oversized_error_documents_preserve_provider_retryability() {
        let transient = provider_error_from_read(
            503,
            Err(body_limit_error(
                "provider error body",
                MAX_ERROR_BODY_BYTES,
            )),
        );
        assert!(transient.retryable());
        assert_eq!(transient.status(), Some(503));

        let rejected = provider_error_from_read(
            401,
            Err(body_limit_error(
                "provider error body",
                MAX_ERROR_BODY_BYTES,
            )),
        );
        assert!(!rejected.retryable());
        assert_eq!(rejected.status(), Some(401));
    }

    #[test]
    fn a_retry_after_header_is_read_in_seconds_or_milliseconds() {
        use reqwest::header::{HeaderMap, HeaderValue};
        let headers = |pairs: &[(&'static str, &'static str)]| {
            let mut map = HeaderMap::new();
            for (name, value) in pairs {
                map.insert(*name, HeaderValue::from_static(value));
            }
            map
        };
        assert_eq!(retry_after(&HeaderMap::new()), None);
        assert_eq!(
            retry_after(&headers(&[("retry-after", "30")])),
            Some(Duration::from_secs(30))
        );
        assert_eq!(
            retry_after(&headers(&[("retry-after", " 1.5 ")])),
            Some(Duration::from_millis(1_500))
        );
        // The millisecond header wins where a provider sends both.
        assert_eq!(
            retry_after(&headers(&[
                ("retry-after", "30"),
                ("retry-after-ms", "250")
            ])),
            Some(Duration::from_millis(250))
        );
        // A date, a negative number and a word are not waits.
        for value in ["Wed, 21 Oct 2026 07:28:00 GMT", "-5", "soon", "NaN"] {
            assert_eq!(retry_after(&headers(&[("retry-after", value)])), None);
        }
    }

    #[test]
    fn completion_timeout_honors_shorter_requests_and_caps_longer_ones() {
        let mut request = CompletionRequest::default();
        assert_eq!(completion_timeout(&request), DEFAULT_TIMEOUT);

        request.timeout_ms = Some(1_500);
        assert_eq!(completion_timeout(&request), Duration::from_millis(1_500));

        request.timeout_ms = Some(u64::MAX);
        assert_eq!(completion_timeout(&request), MAX_COMPLETION_DURATION);
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
            "usage": {
                "input_tokens": 5,
                "output_tokens": 7,
                "cache_read_input_tokens": 2,
                "cache_creation_input_tokens": 3
            }
        });
        let (text, usage) = parse_anthropic(&body).unwrap();
        assert_eq!(text, "part one part two");
        assert_eq!(
            usage,
            Usage {
                input: 5,
                output: 7,
                input_known: Some(true),
                output_known: Some(true),
                cache_read: Some(2),
                cache_write: Some(3),
                input_semantics: InputTokenSemantics::Exclusive,
                reasoning: None,
            }
        );
    }

    #[test]
    fn google_joins_visible_candidate_parts_and_skips_thoughts() {
        let body = json!({
            "candidates": [{ "content": { "parts": [
                { "text": "private reasoning", "thought": true },
                { "text": "a" },
                { "text": "b" }
            ] } }],
            "usageMetadata": {
                "promptTokenCount": 9,
                "candidatesTokenCount": 2,
                "cachedContentTokenCount": 4
            }
        });
        let (text, usage) = parse_google(&body).unwrap();
        assert_eq!(text, "ab");
        assert_eq!(
            usage,
            Usage {
                input: 9,
                output: 2,
                input_known: Some(true),
                output_known: Some(true),
                cache_read: Some(4),
                cache_write: Some(0),
                input_semantics: InputTokenSemantics::Inclusive,
                reasoning: None,
            }
        );
    }

    #[test]
    fn google_thinking_tokens_count_as_output_and_absent_cache_reads_as_zero() {
        let body = json!({
            "candidates": [{ "content": { "parts": [{ "text": "a" }] } }],
            "usageMetadata": {
                "promptTokenCount": 9,
                "candidatesTokenCount": 2,
                "thoughtsTokenCount": 30
            }
        });
        let (_, usage) = parse_google(&body).unwrap();
        assert_eq!(usage.reported_output(), Some(32));
        assert_eq!(usage.cache_read, Some(0));
        assert_eq!(usage.cache_write, Some(0));

        let thoughts_only = json!({
            "candidates": [{ "content": { "parts": [] } }],
            "usageMetadata": { "promptTokenCount": 9, "thoughtsTokenCount": 5 }
        });
        assert_eq!(
            parse_google(&thoughts_only).unwrap().1.reported_output(),
            Some(5)
        );
    }

    #[test]
    fn openai_compatible_cache_hits_are_read_from_either_documented_key() {
        let deepseek = json!({
            "choices": [{ "message": { "content": "x" } }],
            "usage": { "prompt_tokens": 12, "completion_tokens": 3, "prompt_cache_hit_tokens": 8 }
        });
        assert_eq!(parse_openai(&deepseek).unwrap().1.cache_read, Some(8));
        let unreported = json!({
            "choices": [{ "message": { "content": "x" } }],
            "usage": { "prompt_tokens": 12, "completion_tokens": 3 }
        });
        assert_eq!(parse_openai(&unreported).unwrap().1.cache_read, None);
    }

    #[test]
    fn usage_observation_presence_ignores_unreported_zero_counters() {
        assert!(!Usage::default().is_observed());
        assert!(!Usage {
            input_known: Some(false),
            output_known: Some(false),
            ..Usage::default()
        }
        .is_observed());
        assert!(Usage {
            input_known: Some(true),
            ..Usage::default()
        }
        .is_observed());
        assert!(Usage {
            cache_read: Some(0),
            ..Usage::default()
        }
        .is_observed());
    }

    #[test]
    fn a_content_free_reply_is_empty_text_rather_than_an_error() {
        let body = json!({ "choices": [{ "message": { "role": "assistant" } }] });
        assert_eq!(parse_openai(&body).unwrap().0, "");
    }

    #[test]
    fn a_blocking_reply_names_why_it_ended_the_way_the_stream_does() {
        use crate::stream::{is_output_limit_stop, is_refusal_stop};
        let base = || "https://example.test".to_string();
        let chat = Wire::OpenAiChat {
            base_url: base(),
            reasoning_content: false,
        };
        let responses = Wire::OpenAiResponses { base_url: base() };
        let anthropic = Wire::Anthropic { base_url: base() };
        let google = Wire::Google { base_url: base() };

        let reason = |wire: &Wire, body: Value| blocking_stop_reason(wire, &body);
        let cut_chat = reason(
            &chat,
            json!({"choices":[{"message":{"content":""},"finish_reason":"length"}]}),
        );
        assert!(is_output_limit_stop(cut_chat.as_deref()));
        assert_eq!(
            reason(&chat, json!({"choices":[{"message":{"content":"a"}}]})),
            None
        );
        let cut_responses = reason(
            &responses,
            json!({"status":"incomplete","incomplete_details":{"reason":"max_output_tokens"},"output":[]}),
        );
        assert!(is_output_limit_stop(cut_responses.as_deref()));
        assert_eq!(
            reason(&responses, json!({"status":"completed","output":[]})).as_deref(),
            Some("completed")
        );
        let cut_anthropic = reason(&anthropic, json!({"stop_reason":"max_tokens","content":[]}));
        assert!(is_output_limit_stop(cut_anthropic.as_deref()));
        let refused = reason(&anthropic, json!({"stop_reason":"refusal","content":[]}));
        assert!(is_refusal_stop(refused.as_deref()));
        let cut_google = reason(
            &google,
            json!({"candidates":[{"finishReason":"MAX_TOKENS","content":{"parts":[]}}]}),
        );
        assert!(is_output_limit_stop(cut_google.as_deref()));
    }

    #[test]
    fn a_completion_response_without_a_stop_reason_stays_wire_compatible() {
        let response = CompletionResponse {
            text: "x".into(),
            usage: Usage::default(),
            provider_id: "p".into(),
            model_id: "m".into(),
            stop_reason: None,
        };
        let json = serde_json::to_value(&response).unwrap();
        assert!(json.get("stop_reason").is_none());
        let back: CompletionResponse = serde_json::from_value(json).unwrap();
        assert_eq!(back.stop_reason, None);
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
        assert_eq!(err, AgentError::provider(401, "Incorrect API key provided"));
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
    fn body_collection_accepts_the_limit_and_rejects_the_next_byte() {
        let mut body = BoundedBody::new(5, "test body");
        body.push(b"12").unwrap();
        body.push(b"345").unwrap();
        assert_eq!(body.bytes, b"12345");

        let error = body.push(b"6").unwrap_err();
        assert!(matches!(error, AgentError::Decode(_)));
        assert!(!error.retryable());
        assert_eq!(body.bytes, b"12345");
    }
}
