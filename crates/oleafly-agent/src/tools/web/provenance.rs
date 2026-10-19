//! The URLs a conversation has seen. `web_fetch` reads only these, so text
//! on a page cannot send the agent to an address of its own choosing (for
//! example one that carries the user's data out in its query).
use std::collections::HashSet;

use reqwest::Url;

const MAX_URLS: usize = 10_000;
const TRAILING: &[char] = &['.', ',', ';', ':', '!', '?', ')', ']', '}', '>', '\'', '"'];

/// A URL in the form the set compares: lowercase scheme and host, https
/// for http, no default port, no fragment, trailing punctuation trimmed.
pub(crate) fn normalize_url(raw: &str) -> Option<String> {
    let trimmed = raw.trim().trim_end_matches(TRAILING);
    let mut url = Url::parse(trimmed).ok()?;
    match url.scheme() {
        "https" => {}
        "http" => url.set_scheme("https").ok()?,
        _ => return None,
    }
    url.host_str()?;
    url.set_fragment(None);
    if url.port() == Some(443) || url.port() == Some(80) {
        url.set_port(None).ok()?;
    }
    Some(url.to_string())
}

#[derive(Debug, Default)]
pub(crate) struct Provenance {
    urls: HashSet<String>,
}

impl Provenance {
    pub(crate) fn add(&mut self, url: &str) {
        if self.urls.len() >= MAX_URLS {
            return;
        }
        if let Some(normalized) = normalize_url(url) {
            self.urls.insert(normalized);
        }
    }

    /// Every http(s) URL written in `text`.
    pub(crate) fn add_from_text(&mut self, text: &str) {
        let mut rest = text;
        while let Some(at) = rest.find("http") {
            let candidate = &rest[at..];
            let lower = candidate.get(..8).unwrap_or(candidate).to_ascii_lowercase();
            if lower.starts_with("https://") || lower.starts_with("http://") {
                let end = candidate
                    .find(|character: char| {
                        character.is_whitespace() || matches!(character, '<' | '>' | '"' | '`')
                    })
                    .unwrap_or(candidate.len());
                self.add(&candidate[..end]);
                rest = &candidate[end..];
            } else {
                rest = &candidate[4..];
            }
        }
    }

    pub(crate) fn contains(&self, url: &str) -> bool {
        normalize_url(url).is_some_and(|normalized| self.urls.contains(&normalized))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn urls_are_recorded_from_text_and_normalized() {
        let mut provenance = Provenance::default();
        provenance.add_from_text(
            "See https://Example.com:443/a?x=1). Also http://b.org/x. Not C:\\Users\\me\\file.pdf or file:///etc/passwd",
        );
        assert!(provenance.contains("https://example.com/a?x=1#frag"));
        assert!(provenance.contains("https://b.org/x"));
        assert!(!provenance.contains("file:///etc/passwd"));
        assert!(!provenance.contains("https://example.com/a?x=2"));
    }

    #[test]
    fn markdown_links_and_angle_brackets_are_read() {
        let mut provenance = Provenance::default();
        provenance.add_from_text("[paper](https://arxiv.org/abs/2401.00001) and <https://e.org/p>");
        assert!(provenance.contains("https://arxiv.org/abs/2401.00001"));
        assert!(provenance.contains("https://e.org/p"));
    }
}
