//! `\DocumentMetadata` parsing (`packages/preflight/src/document-metadata.ts`).

use std::collections::HashMap;
use std::sync::LazyLock;

use crate::jsre::JsRegex;
use crate::mask::mask_comments;
use crate::text::{js_trim, utf16_len};

/// `start` and `end` are UTF-16 offsets of the whole command; `body` is the
/// text between its braces.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DocumentMetadataMatch {
    pub body: String,
    pub start: usize,
    pub end: usize,
}

static HEAD: LazyLock<JsRegex> = LazyLock::new(|| JsRegex::std(r"\\DocumentMetadata\s{0,20}\{"));

pub fn find_document_metadata(source: &str) -> Option<DocumentMetadataMatch> {
    let head = HEAD.first_str(source)?;
    let open = head.end;
    let mut depth = 1usize;
    for (offset, byte) in source.as_bytes()[open..].iter().enumerate() {
        match byte {
            b'{' => depth += 1,
            b'}' => {
                depth -= 1;
                if depth == 0 {
                    let close = open + offset;
                    return Some(DocumentMetadataMatch {
                        body: source[open..close].to_string(),
                        start: utf16_len(&source[..head.start]),
                        end: utf16_len(&source[..close]) + 1,
                    });
                }
            }
            _ => {}
        }
    }
    None
}

/// Splits on commas outside braces.
pub fn split_top_level(body: &str) -> Vec<String> {
    let mut parts = Vec::new();
    let mut depth = 0usize;
    let mut current = String::new();
    for ch in body.chars() {
        if ch == '{' {
            depth += 1;
        }
        if ch == '}' {
            depth = depth.saturating_sub(1);
        }
        if ch == ',' && depth == 0 {
            parts.push(std::mem::take(&mut current));
            continue;
        }
        current.push(ch);
    }
    parts.push(current);
    parts
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct MetadataKeys {
    pub order: Vec<String>,
    pub map: HashMap<String, String>,
}

pub fn parse_metadata_keys(body: &str) -> MetadataKeys {
    let mut keys = MetadataKeys::default();
    for part in split_top_level(body) {
        let Some(eq) = part.find('=') else {
            continue;
        };
        let key = js_trim(&part[..eq]).to_string();
        let value = js_trim(&part[eq + 1..]).to_string();
        if key.is_empty() {
            continue;
        }
        if !keys.map.contains_key(&key) {
            keys.order.push(key.clone());
        }
        keys.map.insert(key, value);
    }
    keys
}

pub fn unwrap_braces(value: &str) -> &str {
    let trimmed = js_trim(value);
    if trimmed.len() >= 2 && trimmed.starts_with('{') && trimmed.ends_with('}') {
        &trimmed[1..trimmed.len() - 1]
    } else {
        trimmed
    }
}

static UA_STANDARD: LazyLock<JsRegex> = LazyLock::new(|| JsRegex::std(r"(?i)(?-u:\b)ua-[0-9]"));

/// Whether the document asks LaTeX for a tagged PDF.
pub fn requests_tagged_pdf(source: &str) -> bool {
    if !source.contains("\\DocumentMetadata") {
        return false;
    }
    let Some(metadata) = find_document_metadata(&mask_comments(source)) else {
        return false;
    };
    let keys = parse_metadata_keys(&metadata.body).map;
    let tagging =
        unwrap_braces(keys.get("tagging").map(String::as_str).unwrap_or("")).to_lowercase();
    if !tagging.is_empty() {
        return tagging != "off";
    }
    if keys.contains_key("testphase") {
        return true;
    }
    UA_STANDARD.is_match(unwrap_braces(
        keys.get("pdfstandard").map(String::as_str).unwrap_or(""),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_the_metadata_block_with_nested_braces() {
        let found =
            find_document_metadata("é\\DocumentMetadata{lang=en,pdfstandard={ua-1}}x").unwrap();
        assert_eq!(found.body, "lang=en,pdfstandard={ua-1}");
        assert_eq!((found.start, found.end), (1, 46));
    }

    #[test]
    fn tagging_requests_follow_the_keys() {
        assert!(requests_tagged_pdf("\\DocumentMetadata{pdfstandard=ua-1}"));
        assert!(requests_tagged_pdf("\\DocumentMetadata{testphase=latest}"));
        assert!(!requests_tagged_pdf(
            "\\DocumentMetadata{tagging=off,testphase=latest}"
        ));
        assert!(!requests_tagged_pdf(
            "% \\DocumentMetadata{testphase=latest}"
        ));
    }
}
