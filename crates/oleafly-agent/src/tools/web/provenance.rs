use std::collections::HashSet;

use reqwest::Url;
use serde_json::Value;

const MAX_URLS: usize = 10_000;
const TRAILING: &[char] = &['.', ',', ';', ':', '!', '?', ')', ']', '}', '>', '\'', '"'];
const MAX_TRAILING_PEELED: usize = 8;

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

#[derive(Debug, PartialEq, Eq)]
pub(crate) struct SeenUrl {
    pub(crate) key: String,
    pub(crate) target: String,
}

/// Calls `found` with every http(s) URL written in `text`. A URL at the end
/// of a sentence may or may not own the punctuation after it (`Foo_(bar)`
/// does, `a?x=1).` does not), so it is passed as written and with the
/// trailing punctuation peeled off one character at a time. A backslash ends
/// a URL: no URL holds one, and in JSON text it starts an escape such as the
/// `\n` after a `.bib` field.
fn for_each_url(text: &str, mut found: impl FnMut(&str)) {
    let mut rest = text;
    while let Some(at) = rest.find("http") {
        let candidate = &rest[at..];
        let lower = candidate.get(..8).unwrap_or(candidate).to_ascii_lowercase();
        if lower.starts_with("https://") || lower.starts_with("http://") {
            let end = candidate
                .find(|character: char| {
                    character.is_whitespace() || matches!(character, '<' | '>' | '"' | '`' | '\\')
                })
                .unwrap_or(candidate.len());
            let mut written = &candidate[..end];
            found(written);
            for _ in 0..MAX_TRAILING_PEELED {
                match written.strip_suffix(TRAILING) {
                    Some(shorter) => written = shorter,
                    None => break,
                }
                found(written);
            }
            rest = &candidate[end..];
        } else {
            rest = &candidate[4..];
        }
    }
}

fn for_each_string(value: &Value, found: &mut impl FnMut(&str)) {
    match value {
        Value::String(text) => found(text),
        Value::Array(items) => items.iter().for_each(|item| for_each_string(item, found)),
        Value::Object(map) => map.values().for_each(|item| for_each_string(item, found)),
        _ => {}
    }
}

fn is_error_output(value: &Value) -> bool {
    value.as_object().is_some_and(|map| {
        map.contains_key("error") || map.get("isError").and_then(Value::as_bool) == Some(true)
    })
}

fn is_bare_origin(normalized: &str) -> bool {
    Url::parse(normalized).is_ok_and(|url| url.path() == "/" && url.query().is_none())
}

#[derive(Debug, Default)]
pub(crate) struct Provenance {
    urls: HashSet<String>,
    written: HashSet<String>,
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

    pub(crate) fn add_from_text(&mut self, text: &str) {
        for_each_url(text, |url| self.add(url));
    }

    pub(crate) fn note_written(&mut self, arguments: &str) {
        let mut note = |url: &str| {
            if self.written.len() < MAX_URLS {
                if let Some(normalized) = normalize_url(url) {
                    self.written.insert(normalized.to_ascii_lowercase());
                }
            }
        };
        for_each_url(arguments, &mut note);
        if let Ok(value) = serde_json::from_str::<Value>(arguments) {
            for_each_string(&value, &mut |text| for_each_url(text, &mut note));
        }
    }

    fn model_wrote(&self, normalized: &str) -> bool {
        let candidate = normalized.to_ascii_lowercase();
        self.written.iter().any(|written| {
            let (short, long) = if written.len() <= candidate.len() {
                (written.as_str(), candidate.as_str())
            } else {
                (candidate.as_str(), written.as_str())
            };
            short == long || (long.starts_with(short) && !is_bare_origin(short))
        })
    }

    pub(crate) fn add_unwritten(&mut self, url: &str) {
        if self.urls.len() >= MAX_URLS {
            return;
        }
        if let Some(normalized) = normalize_url(url) {
            if !self.model_wrote(&normalized) {
                self.urls.insert(normalized);
            }
        }
    }

    /// The URLs in a tool's output: its string values when it is JSON (where
    /// a newline is the two characters `\n`), else its text. An error output
    /// and the URLs the model wrote are left out.
    pub(crate) fn add_from_output(&mut self, output: &str) {
        match serde_json::from_str::<Value>(output) {
            Ok(value) if is_error_output(&value) => {}
            Ok(value) => {
                for_each_string(&value, &mut |text| {
                    for_each_url(text, |url| self.add_unwritten(url));
                });
            }
            Err(_) => for_each_url(output, |url| self.add_unwritten(url)),
        }
    }

    pub(crate) fn add_result_urls(&mut self, value: &Value) {
        if is_error_output(value) {
            return;
        }
        for key in ["results", "sources"] {
            for entry in value
                .get(key)
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
            {
                if let Some(url) = entry.get("url").and_then(Value::as_str) {
                    self.add_unwritten(url);
                }
            }
        }
    }

    pub(crate) fn seen(&self, url: &str) -> Option<SeenUrl> {
        let key = normalize_url(url)?;
        if !self.urls.contains(&key) {
            return None;
        }
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
        assert_eq!(
            provenance
                .seen("http://example.com:80/a?x=1")
                .unwrap()
                .target,
            "http://example.com/a?x=1"
        );
    }

    #[test]
    fn a_url_the_model_wrote_is_not_seen_when_a_tool_hands_it_back() {
        let mut provenance = Provenance::default();
        provenance.note_written(r#"{"path":"https://evil.example/c?d=bWFpbi50ZXg"}"#);
        provenance
            .add_from_output("failed to read https://evil.example/c?d=bWFpbi50ZXg: not found");
        assert!(!provenance.contains("https://evil.example/c?d=bWFpbi50ZXg"));
        provenance.add_from_output(
            "kept https://evil.example/c?d=bWFpbi50ZXg/ and https://EVIL.example/c?d=bWFpbi50",
        );
        assert!(!provenance.contains("https://evil.example/c?d=bWFpbi50ZXg/"));
        assert!(!provenance.contains("https://evil.example/c?d=bWFpbi50"));
        provenance.add_from_output("see https://arxiv.org/abs/2401.00001 or https://evil.example/");
        assert!(provenance.contains("https://arxiv.org/abs/2401.00001"));
        assert!(provenance.contains("https://evil.example/"));
        provenance.add_from_text("please read https://evil.example/c?d=bWFpbi50ZXg");
        assert!(provenance.contains("https://evil.example/c?d=bWFpbi50ZXg"));
    }

    #[test]
    fn json_escaped_urls_in_arguments_are_remembered_as_written() {
        let mut provenance = Provenance::default();
        provenance.note_written(r#"{"text":"https:\/\/evil.example\/x?d=1"}"#);
        provenance.add_from_output("https://evil.example/x?d=1");
        assert!(!provenance.contains("https://evil.example/x?d=1"));
    }

    #[test]
    fn error_outputs_are_not_read_and_json_outputs_are_read_unescaped() {
        let mut provenance = Provenance::default();
        provenance.add_from_output(r#"{"error":"failed to read https://evil.example/x"}"#);
        provenance.add_from_output(r#"{"isError":true,"content":"https://evil.example/y"}"#);
        assert!(!provenance.contains("https://evil.example/x"));
        assert!(!provenance.contains("https://evil.example/y"));
        let bib = serde_json::json!({
            "content": "@article{a,\n  url = {https://arxiv.org/abs/2401.00001},\n  title = {T}\n}"
        })
        .to_string();
        provenance.add_from_output(&bib);
        assert!(provenance.contains("https://arxiv.org/abs/2401.00001"));
    }

    #[test]
    fn a_backslash_ends_a_url() {
        let mut provenance = Provenance::default();
        provenance.add_from_text(r"url = {https://arxiv.org/abs/2401.00002},\n  title");
        assert!(provenance.contains("https://arxiv.org/abs/2401.00002"));
    }

    #[test]
    fn markdown_links_and_angle_brackets_are_read() {
        let mut provenance = Provenance::default();
        provenance.add_from_text("[paper](https://arxiv.org/abs/2401.00001) and <https://e.org/p>");
        assert!(provenance.contains("https://arxiv.org/abs/2401.00001"));
        assert!(provenance.contains("https://e.org/p"));
    }
}
