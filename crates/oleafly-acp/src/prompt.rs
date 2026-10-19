//! The content blocks of one `session/prompt`: the user's text, a skill's
//! instructions, images, links to files and embedded file text, checked
//! against what the agent accepts and the frame budget.
use base64::Engine as _;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::capabilities::AgentCapabilities;
use crate::limits::PROMPT_BUDGET;

/// Files, images and selections one message may carry.
pub const MAX_ATTACHMENTS: usize = 10;
/// The longest message text.
pub const MAX_PROMPT_TEXT: usize = 256 * 1024;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ImagePrompt {
    pub mime_type: String,
    pub data: String,
}

/// A file the agent reads itself (`resource_link`).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ResourceLink {
    pub uri: String,
    pub name: String,
    pub mime_type: Option<String>,
    pub size: Option<u64>,
}

/// File text sent inside the message (`resource`), or quoted when the agent
/// cannot take embedded context.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct EmbeddedText {
    pub uri: Option<String>,
    pub name: String,
    pub mime_type: Option<String>,
    pub text: String,
}

pub struct PromptParts<'a> {
    pub text: &'a str,
    pub skill_block: Option<&'a str>,
    pub images: &'a [ImagePrompt],
    pub links: &'a [ResourceLink],
    pub texts: &'a [EmbeddedText],
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PromptError {
    Empty,
    TooMany,
    TooLarge,
    ImagesUnsupported,
    BadImage,
}

impl PromptError {
    pub fn message(self) -> &'static str {
        match self {
            Self::Empty => "Write a message before sending.",
            Self::TooMany => "Attach at most 10 files to one message.",
            Self::TooLarge => {
                "This message is too large. Shorten it or attach fewer or smaller files."
            }
            Self::ImagesUnsupported => "This agent does not accept images.",
            Self::BadImage => "Use a PNG, JPEG, WebP or GIF image.",
        }
    }
}

impl std::fmt::Display for PromptError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.message())
    }
}

fn fenced(text: &EmbeddedText) -> String {
    let longest = text
        .text
        .split('\n')
        .map(|line| line.chars().take_while(|c| *c == '`').count())
        .max()
        .unwrap_or(0);
    let fence = "`".repeat(longest.max(2) + 1);
    format!(
        "\n\n{} ({}):\n{fence}\n{}\n{fence}",
        "Attached file", text.name, text.text
    )
}

/// The blocks in order: text (when not blank, or when there is no skill),
/// the skill block, images, file links and embedded texts.
pub fn prompt_blocks(
    session_id: &str,
    parts: &PromptParts<'_>,
    caps: &AgentCapabilities,
) -> Result<Vec<Value>, PromptError> {
    let has_text = !parts.text.trim().is_empty();
    let attachments = parts.images.len() + parts.links.len() + parts.texts.len();
    if !has_text && parts.skill_block.is_none() && attachments == 0 {
        return Err(PromptError::Empty);
    }
    if attachments > MAX_ATTACHMENTS {
        return Err(PromptError::TooMany);
    }
    if parts.text.len() > MAX_PROMPT_TEXT {
        return Err(PromptError::TooLarge);
    }
    if !parts.images.is_empty() && !caps.image {
        return Err(PromptError::ImagesUnsupported);
    }
    // Text files the agent cannot take as embedded context, and that have no
    // file to link to, are quoted after the message.
    let mut text = parts.text.to_owned();
    let mut embedded = Vec::new();
    let mut extra_links = Vec::new();
    for item in parts.texts {
        if caps.embedded_context {
            embedded.push(item);
        } else if let Some(uri) = &item.uri {
            extra_links.push(ResourceLink {
                uri: uri.clone(),
                name: item.name.clone(),
                mime_type: item.mime_type.clone(),
                size: Some(item.text.len() as u64),
            });
        } else {
            text.push_str(&fenced(item));
        }
    }
    let mut blocks = Vec::new();
    if !text.trim().is_empty() || parts.skill_block.is_none() {
        blocks.push(json!({"type": "text", "text": text}));
    }
    if let Some(skill) = parts.skill_block {
        blocks.push(json!({"type": "text", "text": skill}));
    }
    for image in parts.images {
        if !matches!(
            image.mime_type.as_str(),
            "image/png" | "image/jpeg" | "image/webp" | "image/gif"
        ) || base64::engine::general_purpose::STANDARD
            .decode(&image.data)
            .is_err()
        {
            return Err(PromptError::BadImage);
        }
        blocks.push(json!({"type": "image", "mimeType": image.mime_type, "data": image.data}));
    }
    for link in parts.links.iter().chain(extra_links.iter()) {
        let mut block = json!({"type": "resource_link", "uri": link.uri, "name": link.name});
        if let Some(mime) = &link.mime_type {
            block["mimeType"] = json!(mime);
        }
        if let Some(size) = link.size {
            block["size"] = json!(size);
        }
        blocks.push(block);
    }
    for item in embedded {
        let mut resource = json!({
            "uri": item.uri.clone().unwrap_or_else(|| format!("oleafly-attachment:{}", item.name)),
            "text": item.text,
        });
        if let Some(mime) = &item.mime_type {
            resource["mimeType"] = json!(mime);
        }
        blocks.push(json!({"type": "resource", "resource": resource}));
    }
    let size = serde_json::to_vec(&json!({"sessionId": session_id, "prompt": blocks}))
        .map_err(|_| PromptError::TooLarge)?
        .len();
    if size > PROMPT_BUDGET {
        return Err(PromptError::TooLarge);
    }
    Ok(blocks)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn caps(image: bool, embedded: bool) -> AgentCapabilities {
        AgentCapabilities {
            image,
            embedded_context: embedded,
            ..Default::default()
        }
    }

    fn image(bytes: usize) -> ImagePrompt {
        ImagePrompt {
            mime_type: "image/png".into(),
            data: base64::engine::general_purpose::STANDARD.encode(vec![7u8; bytes]),
        }
    }

    fn link(name: &str) -> ResourceLink {
        ResourceLink {
            uri: format!("file:///p/{name}"),
            name: name.into(),
            mime_type: Some("application/pdf".into()),
            size: Some(10),
        }
    }

    #[test]
    fn blocks_put_text_then_skill_then_images_then_links() {
        let images = [image(10)];
        let links = [link("a.pdf")];
        let blocks = prompt_blocks(
            "s",
            &PromptParts {
                text: "hi",
                skill_block: Some("skill"),
                images: &images,
                links: &links,
                texts: &[],
            },
            &caps(true, false),
        )
        .unwrap();
        let kinds: Vec<_> = blocks.iter().map(|b| b["type"].as_str().unwrap()).collect();
        assert_eq!(kinds, ["text", "text", "image", "resource_link"]);
        assert_eq!(blocks[1]["text"], "skill");
    }

    #[test]
    fn resource_links_carry_file_uris_size_and_mime() {
        let links = [link("a.pdf")];
        let blocks = prompt_blocks(
            "s",
            &PromptParts {
                text: "x",
                skill_block: None,
                images: &[],
                links: &links,
                texts: &[],
            },
            &caps(false, false),
        )
        .unwrap();
        assert_eq!(
            blocks[1],
            json!({"type": "resource_link", "uri": "file:///p/a.pdf", "name": "a.pdf", "mimeType": "application/pdf", "size": 10})
        );
    }

    #[test]
    fn embedded_text_needs_embedded_context() {
        let texts = [EmbeddedText {
            uri: None,
            name: "notes.md".into(),
            mime_type: Some("text/markdown".into()),
            text: "body".into(),
        }];
        let parts = PromptParts {
            text: "x",
            skill_block: None,
            images: &[],
            links: &[],
            texts: &texts,
        };
        let embedded = prompt_blocks("s", &parts, &caps(false, true)).unwrap();
        assert_eq!(embedded[1]["type"], "resource");
        assert_eq!(embedded[1]["resource"]["text"], "body");
        let quoted = prompt_blocks("s", &parts, &caps(false, false)).unwrap();
        assert_eq!(quoted.len(), 1);
        assert!(quoted[0]["text"].as_str().unwrap().contains("notes.md"));
        let linked = [EmbeddedText {
            uri: Some("file:///p/notes.md".into()),
            ..texts[0].clone()
        }];
        let as_link = prompt_blocks(
            "s",
            &PromptParts {
                text: "x",
                skill_block: None,
                images: &[],
                links: &[],
                texts: &linked,
            },
            &caps(false, false),
        )
        .unwrap();
        assert_eq!(as_link[1]["type"], "resource_link");
    }

    #[test]
    fn the_frame_budget_replaces_the_four_image_limit() {
        let six: Vec<_> = (0..6).map(|_| image(100 * 1024)).collect();
        let parts = PromptParts {
            text: "x",
            skill_block: None,
            images: &six,
            links: &[],
            texts: &[],
        };
        assert!(prompt_blocks("s", &parts, &caps(true, false)).is_ok());
        let big = [image(1200 * 1024)];
        let parts = PromptParts {
            text: "x",
            skill_block: None,
            images: &big,
            links: &[],
            texts: &[],
        };
        assert_eq!(
            prompt_blocks("s", &parts, &caps(true, false)),
            Err(PromptError::TooLarge)
        );
    }

    #[test]
    fn images_need_the_image_capability() {
        let images = [image(10)];
        let parts = PromptParts {
            text: "x",
            skill_block: None,
            images: &images,
            links: &[],
            texts: &[],
        };
        assert_eq!(
            prompt_blocks("s", &parts, &caps(false, false)),
            Err(PromptError::ImagesUnsupported)
        );
    }

    #[test]
    fn eleven_attachments_are_refused() {
        let links: Vec<_> = (0..11).map(|index| link(&format!("{index}.pdf"))).collect();
        let parts = PromptParts {
            text: "x",
            skill_block: None,
            images: &[],
            links: &links,
            texts: &[],
        };
        assert_eq!(
            prompt_blocks("s", &parts, &caps(false, false)),
            Err(PromptError::TooMany)
        );
    }

    #[test]
    fn an_empty_message_without_anything_is_refused() {
        let parts = PromptParts {
            text: "  ",
            skill_block: None,
            images: &[],
            links: &[],
            texts: &[],
        };
        assert_eq!(
            prompt_blocks("s", &parts, &caps(false, false)),
            Err(PromptError::Empty)
        );
    }
}
