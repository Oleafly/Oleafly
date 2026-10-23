//! The URLs a conversation has seen. `web_fetch` reads only these, so text
//! on a page cannot send the agent to an address of its own choosing (for
//! example one that carries the user's data out in its query).
use std::collections::HashSet;

use reqwest::Url;

const MAX_URLS: usize = 10_000;
/// Characters a sentence puts after a URL that are not part of it.
const TRAILING: &[char] = &['.', ',', ';', ':', '!', '?', ')', ']', '}', '>', '\'', '"'];
/// How many of them are peeled off one written URL, one at a time.
const MAX_TRAILING_PEELED: usize = 8;

/// A URL in the form the set compares: lowercase scheme and host, https
/// for http, no default port, no fragment. Nothing is trimmed from the end:
/// a URL that differs by a character is a different address, so appending
/// punctuation to a seen URL cannot reach a new one.
pub(crate) fn normalize_url(raw: &str) -> Option<String> {
    let mut url = Url::parse(raw.trim()).ok()?;
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

/// A URL that passed the check: the normalized form (the cache key) and the
/// address to fetch.
#[derive(Debug, PartialEq, Eq)]
pub(crate) struct SeenUrl {
    pub(crate) key: String,
    pub(crate) target: String,
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

    /// Every http(s) URL written in `text`. A URL at the end of a sentence
    /// may or may not own the punctuation after it (`Foo_(bar)` does,
    /// `a?x=1).` does not), so it is recorded as written and with the
    /// trailing punctuation peeled off one character at a time.
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
                let mut written = &candidate[..end];
                self.add(written);
                for _ in 0..MAX_TRAILING_PEELED {
                    match written.strip_suffix(TRAILING) {
                        Some(shorter) => written = shorter,
                        None => break,
                    }
                    self.add(written);
                }
                rest = &candidate[end..];
            } else {
                rest = &candidate[4..];
            }
        }
    }

    /// The address this conversation has seen for `url`, when it has: the
    /// one a fetch must use, exactly what was checked and nothing appended
    /// to it.
    pub(crate) fn seen(&self, url: &str) -> Option<SeenUrl> {
        let key = normalize_url(url)?;
        if !self.urls.contains(&key) {
            return None;
        }
        // The check treats http and https alike (a fetch goes over https
        // either way); the address keeps the scheme it was asked for.
        let mut target = Url::parse(&key).ok()?;
        if Url::parse(url.trim()).is_ok_and(|written| written.scheme() == "http") {
            let _ = target.set_scheme("http");
        }
        Some(SeenUrl {
            key,
            target: target.to_string(),
        })
    }

    #[cfg(test)]
    pub(crate) fn contains(&self, url: &str) -> bool {
        self.seen(url).is_some()
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
    fn punctuation_appended_to_a_seen_url_is_another_address() {
        let mut provenance = Provenance::default();
        provenance.add_from_text("Read https://attacker.example/page please");
        assert!(provenance.contains("https://attacker.example/page"));
        // A page cannot spell data into the URL with trailing punctuation.
        for appended in [".", ".,;:)", "?", "!)", "..."] {
            let url = format!("https://attacker.example/page{appended}");
            assert!(!provenance.contains(&url), "{url}");
            assert_eq!(provenance.seen(&url), None);
        }
    }

    #[test]
    fn a_url_that_ends_in_a_parenthesis_is_read_whole() {
        let mut provenance = Provenance::default();
        provenance
            .add_from_text("(see https://en.wikipedia.org/wiki/Rust_(programming_language)).");
        // The page the sentence names, and the sentence-final forms.
        assert_eq!(
            provenance
                .seen("https://en.wikipedia.org/wiki/Rust_(programming_language)")
                .map(|seen| seen.target)
                .as_deref(),
            Some("https://en.wikipedia.org/wiki/Rust_(programming_language)")
        );
        assert!(provenance.contains("https://en.wikipedia.org/wiki/Rust_(programming_language))."));
        assert!(
            !provenance.contains("https://en.wikipedia.org/wiki/Rust_(programming_language))))")
        );
    }

    #[test]
    fn what_is_fetched_is_the_form_that_was_seen() {
        let mut provenance = Provenance::default();
        provenance.add_from_text("http://Example.COM:80/a?x=1#top");
        assert_eq!(
            provenance.seen("HTTPS://example.com/a?x=1#other"),
            Some(SeenUrl {
                key: "https://example.com/a?x=1".into(),
                target: "https://example.com/a?x=1".into(),
            })
        );
        // The scheme asked for is kept; the rest is what was checked.
        assert_eq!(
            provenance
                .seen("http://example.com:80/a?x=1")
                .unwrap()
                .target,
            "http://example.com/a?x=1"
        );
    }

    #[test]
    fn markdown_links_and_angle_brackets_are_read() {
        let mut provenance = Provenance::default();
        provenance.add_from_text("[paper](https://arxiv.org/abs/2401.00001) and <https://e.org/p>");
        assert!(provenance.contains("https://arxiv.org/abs/2401.00001"));
        assert!(provenance.contains("https://e.org/p"));
    }
}
