use serde::{Deserialize, Serialize};

use crate::error::{AgentError, Result};

/// One piece of a user turn. Providers disagree on how images travel, so the
/// caller hands over a data URL and each wire format reshapes it.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum ContentPart {
    Text {
        text: String,
    },
    /// A `data:<media-type>;base64,<payload>` URL, matching what the browser
    /// FileReader produces on the desktop side.
    Image {
        image: String,
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

/// A data URL split into the two halves every provider needs separately.
pub(crate) struct DataUrl<'a> {
    pub media_type: &'a str,
    pub base64: &'a str,
}

/// Split `data:image/png;base64,AAAA` into its media type and payload.
///
/// Only base64 data URLs are accepted. A remote `https://` image would need
/// the backend to fetch it, which turns a completion into an outbound request
/// to an address the model chose, so it is refused rather than followed.
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
        // Base64 never contains a comma, but splitting on the last one instead
        // of the first would silently corrupt the payload if it ever did.
        let parsed = parse_data_url("data:image/jpeg;base64,AA,BB").unwrap();
        assert_eq!(parsed.base64, "AA,BB");
    }
}
