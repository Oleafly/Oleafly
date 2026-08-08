use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::error::{AgentError, Result};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum ContentPart {
    Text {
        text: String,
    },
    Image {
        image: String,
    },
    ToolUse {
        id: String,
        name: String,
        arguments: String,
    },
    ToolResult {
        id: String,
        name: String,
        output: String,
    },
}

impl ContentPart {
    pub fn text(text: impl Into<String>) -> Self {
        ContentPart::Text { text: text.into() }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Role {
    User,
    Assistant,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Message {
    pub role: Role,
    pub content: Vec<ContentPart>,
}

impl Message {
    pub fn user(text: impl Into<String>) -> Self {
        Message {
            role: Role::User,
            content: vec![ContentPart::text(text)],
        }
    }
}

pub(crate) fn parse_arguments(raw: &str) -> Value {
    if raw.trim().is_empty() {
        return Value::Object(Default::default());
    }
    serde_json::from_str(raw).unwrap_or_else(|_| Value::Object(Default::default()))
}

pub(crate) struct DataUrl<'a> {
    pub media_type: &'a str,
    pub base64: &'a str,
}

pub(crate) fn parse_data_url(url: &str) -> Result<DataUrl<'_>> {
    let rest = url
        .strip_prefix("data:")
        .ok_or_else(|| AgentError::Decode("image must be a data: URL".into()))?;
    let (meta, payload) = rest
        .split_once(',')
        .ok_or_else(|| AgentError::Decode("malformed data: URL".into()))?;
    let media_type = meta
        .strip_suffix(";base64")
        .ok_or_else(|| AgentError::Decode("image data URL must be base64 encoded".into()))?;
    if media_type.is_empty() {
        return Err(AgentError::Decode(
            "image data URL has no media type".into(),
        ));
    }
    Ok(DataUrl {
        media_type,
        base64: payload,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tool_arguments_that_are_not_json_become_an_empty_object() {
        assert_eq!(parse_arguments(""), serde_json::json!({}));
        assert_eq!(parse_arguments("   "), serde_json::json!({}));
        assert_eq!(parse_arguments("{\"a\":1}"), serde_json::json!({"a":1}));
        assert_eq!(parse_arguments("{truncated"), serde_json::json!({}));
    }

    #[test]
    fn parses_a_base64_data_url() {
        let parsed = parse_data_url("data:image/png;base64,AAAB").unwrap();
        assert_eq!(parsed.media_type, "image/png");
        assert_eq!(parsed.base64, "AAAB");
    }

    #[test]
    fn rejects_urls_the_backend_would_have_to_fetch() {
        for url in [
            "https://example.com/cat.png",
            "data:image/png,notbase64",
            "data:;base64,AAAB",
            "data:image/png;base64",
        ] {
            assert!(parse_data_url(url).is_err(), "should reject {url}");
        }
    }

    #[test]
    fn keeps_commas_inside_the_payload() {
        let parsed = parse_data_url("data:image/jpeg;base64,AA,BB").unwrap();
        assert_eq!(parsed.base64, "AA,BB");
    }
}
