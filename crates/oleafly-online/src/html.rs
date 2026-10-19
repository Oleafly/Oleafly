//! Reads `<meta>` tags from the service's pages.
use std::collections::HashMap;

pub fn meta_tags(html: &str) -> HashMap<String, String> {
    let mut tags = HashMap::new();
    let bytes = html.as_bytes();
    let mut index = 0;
    while let Some(start) = find_tag(bytes, index) {
        let (attributes, next) = read_attributes(html, start + 5);
        if let (Some(name), Some(content)) = (attributes.get("name"), attributes.get("content")) {
            tags.entry(name.clone()).or_insert_with(|| content.clone());
        }
        index = next;
    }
    tags
}

pub fn meta_text(tags: &HashMap<String, String>, name: &str) -> Option<String> {
    let raw = tags.get(name)?.trim();
    let text = match serde_json::from_str::<serde_json::Value>(raw) {
        Ok(serde_json::Value::String(text)) => text,
        _ => raw.to_string(),
    };
    Some(text).filter(|text| !text.is_empty())
}

fn find_tag(bytes: &[u8], from: usize) -> Option<usize> {
    let needle = b"<meta";
    (from..bytes.len().saturating_sub(needle.len() - 1)).find(|&at| {
        bytes[at..at + needle.len()].eq_ignore_ascii_case(needle)
            && bytes
                .get(at + needle.len())
                .is_some_and(|next| next.is_ascii_whitespace() || *next == b'/' || *next == b'>')
    })
}

fn read_attributes(html: &str, mut index: usize) -> (HashMap<String, String>, usize) {
    let bytes = html.as_bytes();
    let mut attributes = HashMap::new();
    loop {
        while bytes
            .get(index)
            .is_some_and(|byte| byte.is_ascii_whitespace() || *byte == b'/')
        {
            index += 1;
        }
        match bytes.get(index) {
            None => return (attributes, index),
            Some(b'>') => return (attributes, index + 1),
            _ => {}
        }
        let name_start = index;
        while bytes
            .get(index)
            .is_some_and(|byte| !byte.is_ascii_whitespace() && !matches!(byte, b'=' | b'>' | b'/'))
        {
            index += 1;
        }
        let name = html[name_start..index].to_ascii_lowercase();
        while bytes.get(index).is_some_and(u8::is_ascii_whitespace) {
            index += 1;
        }
        if bytes.get(index) != Some(&b'=') {
            if !name.is_empty() {
                attributes.entry(name).or_insert_with(String::new);
            }
            continue;
        }
        index += 1;
        while bytes.get(index).is_some_and(u8::is_ascii_whitespace) {
            index += 1;
        }
        let value = match bytes.get(index) {
            Some(quote @ (b'"' | b'\'')) => {
                let value_start = index + 1;
                let value_end = html[value_start..]
                    .find(*quote as char)
                    .map_or(html.len(), |offset| value_start + offset);
                index = (value_end + 1).min(html.len());
                &html[value_start..value_end]
            }
            _ => {
                let value_start = index;
                while bytes
                    .get(index)
                    .is_some_and(|byte| !byte.is_ascii_whitespace() && *byte != b'>')
                {
                    index += 1;
                }
                &html[value_start..index]
            }
        };
        if !name.is_empty() {
            attributes
                .entry(name)
                .or_insert_with(|| decode_entities(value));
        }
    }
}

pub fn decode_entities(text: &str) -> String {
    if !text.contains('&') {
        return text.to_string();
    }
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(at) = rest.find('&') {
        out.push_str(&rest[..at]);
        let tail = &rest[at..];
        match tail.find(';').filter(|end| *end <= 12) {
            Some(end) => match decode_entity(&tail[1..end]) {
                Some(decoded) => {
                    out.push(decoded);
                    rest = &tail[end + 1..];
                }
                None => {
                    out.push('&');
                    rest = &tail[1..];
                }
            },
            None => {
                out.push('&');
                rest = &tail[1..];
            }
        }
    }
    out.push_str(rest);
    out
}

fn decode_entity(entity: &str) -> Option<char> {
    match entity {
        "quot" => Some('"'),
        "amp" => Some('&'),
        "lt" => Some('<'),
        "gt" => Some('>'),
        "apos" => Some('\''),
        "nbsp" => Some('\u{a0}'),
        _ => {
            let number = entity.strip_prefix('#')?;
            let code = match number.strip_prefix(['x', 'X']) {
                Some(hex) => u32::from_str_radix(hex, 16).ok()?,
                None => number.parse::<u32>().ok()?,
            };
            char::from_u32(code)
        }
    }
}
