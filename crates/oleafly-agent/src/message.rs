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
        #[serde(
            rename = "thoughtSignature",
            default,
            skip_serializing_if = "Option::is_none"
        )]
        thought_signature: Option<String>,
    },
    ToolResult {
        id: String,
        name: String,
        output: String,
        /// Images the tool returned (data URLs). They travel with this
        /// result, nested inside it where the wire allows.
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        images: Vec<String>,
    },
    /// A file the renderer stored by content hash. Resolved into an image,
    /// a document or text before a run; never sent as is.
    Attachment {
        sha256: String,
        name: String,
        mime: String,
    },
    /// A document such as a PDF, as base64 without a `data:` prefix.
    Document {
        mime: String,
        data: String,
        name: String,
    },
    /// An Anthropic thinking block, replayed unchanged (the signature binds
    /// it; the text may be empty).
    Thinking {
        thinking: String,
        signature: String,
    },
    RedactedThinking {
        data: String,
    },
    Reasoning {
        text: String,
    },
    /// A block only one wire understands (server tool calls, their results,
    /// cited text), replayed verbatim on that wire and skipped on others.
    ProviderBlock {
        wire: ProviderWire,
        block: Value,
    },
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ProviderWire {
    Anthropic,
}

impl ContentPart {
    pub fn text(text: impl Into<String>) -> Self {
        ContentPart::Text { text: text.into() }
    }

    pub fn tool_result(
        id: impl Into<String>,
        name: impl Into<String>,
        output: impl Into<String>,
    ) -> Self {
        ContentPart::ToolResult {
            id: id.into(),
            name: name.into(),
            output: output.into(),
            images: Vec::new(),
        }
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

#[derive(Debug)]
pub(crate) struct DataUrl<'a> {
    pub media_type: &'a str,
    pub base64: &'a str,
}

/// The image types every provider accepts.
pub const SUPPORTED_IMAGE_TYPES: [&str; 4] = ["image/png", "image/jpeg", "image/gif", "image/webp"];

pub(crate) fn validate_image_type(media_type: &str) -> Result<()> {
    if SUPPORTED_IMAGE_TYPES.contains(&media_type.to_ascii_lowercase().as_str()) {
        Ok(())
    } else {
        Err(AgentError::Decode(format!(
            "image type {media_type} is not supported"
        )))
    }
}

/// A data URL whose image type every provider accepts.
pub(crate) fn parse_image_url(url: &str) -> Result<DataUrl<'_>> {
    let data = parse_data_url(url)?;
    validate_image_type(data.media_type)?;
    Ok(data)
}

pub(crate) fn unresolved_attachment() -> AgentError {
    AgentError::Decode("attachment parts must be resolved before sending".into())
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
    fn a_tool_use_part_round_trips_its_thought_signature_in_camel_case() {
        let part = ContentPart::ToolUse {
            id: "c1".into(),
            name: "read_file".into(),
            arguments: "{}".into(),
            thought_signature: Some("sig".into()),
        };
        let json = serde_json::to_value(&part).unwrap();
        assert_eq!(json["thoughtSignature"], "sig");
        assert!(json.get("thought_signature").is_none());
        assert_eq!(serde_json::from_value::<ContentPart>(json).unwrap(), part);
    }

    #[test]
    fn a_tool_use_part_without_a_signature_stays_wire_compatible() {
        let unsigned: ContentPart = serde_json::from_str(
            r#"{"type":"toolUse","id":"c1","name":"read_file","arguments":"{}"}"#,
        )
        .unwrap();
        assert!(matches!(
            unsigned,
            ContentPart::ToolUse { ref thought_signature, .. } if thought_signature.is_none()
        ));
        assert!(serde_json::to_value(&unsigned)
            .unwrap()
            .get("thoughtSignature")
            .is_none());
    }

    #[test]
    fn new_content_parts_round_trip_in_camel_case() {
        let parts = [
            ContentPart::Thinking {
                thinking: String::new(),
                signature: "sig".into(),
            },
            ContentPart::RedactedThinking { data: "d".into() },
            ContentPart::Document {
                mime: "application/pdf".into(),
                data: "JVBE".into(),
                name: "a.pdf".into(),
            },
            ContentPart::Attachment {
                sha256: "ab".repeat(32),
                name: "a.pdf".into(),
                mime: "application/pdf".into(),
            },
            ContentPart::ProviderBlock {
                wire: ProviderWire::Anthropic,
                block: serde_json::json!({"type":"server_tool_use","id":"srvtoolu_1"}),
            },
        ];
        let tags: Vec<_> = parts
            .iter()
            .map(|part| serde_json::to_value(part).unwrap()["type"].clone())
            .collect();
        assert_eq!(
            tags,
            [
                serde_json::json!("thinking"),
                serde_json::json!("redactedThinking"),
                serde_json::json!("document"),
                serde_json::json!("attachment"),
                serde_json::json!("providerBlock")
            ]
        );
        for part in parts {
            assert_eq!(
                serde_json::from_value::<ContentPart>(serde_json::to_value(&part).unwrap())
                    .unwrap(),
                part
            );
        }
        assert_eq!(
            serde_json::to_value(&ContentPart::Thinking {
                thinking: String::new(),
                signature: "sig".into()
            })
            .unwrap()["thinking"],
            ""
        );
    }

    #[test]
    fn a_reasoning_part_round_trips_apart_from_anthropic_thinking() {
        let part: ContentPart =
            serde_json::from_str(r#"{"type":"reasoning","text":"checked the units"}"#).unwrap();
        assert_eq!(
            part,
            ContentPart::Reasoning {
                text: "checked the units".into()
            }
        );
        assert_eq!(
            serde_json::to_value(&part).unwrap(),
            serde_json::json!({"type":"reasoning","text":"checked the units"})
        );
    }

    #[test]
    fn a_tool_result_without_images_keeps_its_old_wire_shape() {
        let old: ContentPart =
            serde_json::from_str(r#"{"type":"toolResult","id":"c","name":"n","output":"o"}"#)
                .unwrap();
        assert_eq!(old, ContentPart::tool_result("c", "n", "o"));
        assert!(serde_json::to_value(&old).unwrap().get("images").is_none());
    }

    #[test]
    fn only_widely_supported_image_types_pass() {
        assert!(parse_image_url("data:image/webp;base64,AA").is_ok());
        assert!(parse_image_url("data:image/PNG;base64,AA").is_ok());
        let error = parse_image_url("data:image/svg+xml;base64,AA").unwrap_err();
        assert!(error.to_string().contains("image/svg+xml"), "{error}");
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
