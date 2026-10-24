//! Regular expressions with JavaScript's iteration semantics.
//!
//! Patterns keep the TypeScript source and change only flavour differences
//! (`\d` → `[0-9]`, `\w` → `[0-9A-Za-z_]`, `\b` → `(?-u:\b)`, `.` → a class
//! without line terminators). Look-around and back-references need
//! `fancy-regex`, which backtracks; a pattern that hits its backtrack limit is
//! treated as "no match" and recorded so the caller can warn instead of
//! panicking.
//!
//! Matching mirrors `matchAll` / `exec` with the `g` flag: after an empty match
//! the search moves one character on, and an empty match right after a
//! non-empty one is reported (Rust's own iterators skip it).

use std::cell::{Cell, RefCell};

use crate::text::SourceText;

pub enum JsRegex {
    Std(regex::Regex),
    Fancy(fancy_regex::Regex),
}

/// A match in byte offsets of the searched `&str`. `groups[0]` is the whole
/// match; unmatched groups are `None`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ByteMatch {
    pub start: usize,
    pub end: usize,
    pub groups: Vec<Option<(usize, usize)>>,
}

impl ByteMatch {
    pub fn group<'t>(&self, text: &'t str, index: usize) -> Option<&'t str> {
        self.groups
            .get(index)
            .copied()
            .flatten()
            .map(|(start, end)| &text[start..end])
    }

    pub fn as_str<'t>(&self, text: &'t str) -> &'t str {
        &text[self.start..self.end]
    }
}

/// A match in UTF-16 offsets of a [`SourceText`]. `groups[0]` is the whole
/// match.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct JsMatch {
    pub from: usize,
    pub to: usize,
    pub groups: Vec<Option<(usize, usize)>>,
    pub bytes: ByteMatch,
}

impl JsMatch {
    /// The text of a capture group, borrowed from the searched text.
    pub fn text<'t>(&self, source: &'t SourceText, index: usize) -> Option<&'t str> {
        self.bytes.group(source.as_str(), index)
    }

    pub fn group(&self, index: usize) -> Option<(usize, usize)> {
        self.groups.get(index).copied().flatten()
    }
}

#[derive(Clone, Debug, Default)]
pub struct JsMatches {
    pub matches: Vec<JsMatch>,
    pub limit_hit: bool,
}

thread_local! {
    static SCOPE: Cell<&'static str> = const { Cell::new("preflight") };
    static LIMIT_HITS: RefCell<Vec<&'static str>> = const { RefCell::new(Vec::new()) };
}

/// Runs `f` with `scope` as the name recorded for regex limit hits, so a
/// warning can say which rule family gave up.
pub fn with_scope<T>(scope: &'static str, f: impl FnOnce() -> T) -> T {
    let previous = SCOPE.replace(scope);
    let out = f();
    SCOPE.set(previous);
    out
}

/// The scopes whose regexes hit the backtrack limit since the last call.
pub fn take_limit_hits() -> Vec<&'static str> {
    LIMIT_HITS.with(|hits| std::mem::take(&mut *hits.borrow_mut()))
}

fn record_limit_hit() {
    let scope = SCOPE.get();
    LIMIT_HITS.with(|hits| {
        let mut hits = hits.borrow_mut();
        if !hits.contains(&scope) {
            hits.push(scope);
        }
    });
}

fn next_char_boundary(text: &str, at: usize) -> usize {
    text[at..]
        .chars()
        .next()
        .map(|ch| at + ch.len_utf8())
        .unwrap_or(text.len() + 1)
}

impl JsRegex {
    /// Patterns are constants: an invalid one is a bug the tests catch.
    pub fn std(pattern: &str) -> Self {
        match regex::Regex::new(pattern) {
            Ok(regex) => Self::Std(regex),
            Err(error) => panic!("invalid regex {pattern:?}: {error}"),
        }
    }

    pub fn fancy(pattern: &str) -> Self {
        match fancy_regex::Regex::new(pattern) {
            Ok(regex) => Self::Fancy(regex),
            Err(error) => panic!("invalid fancy regex {pattern:?}: {error}"),
        }
    }

    pub fn fancy_with_backtrack_limit(pattern: &str, limit: usize) -> Self {
        match fancy_regex::RegexBuilder::new(pattern)
            .backtrack_limit(limit)
            .build()
        {
            Ok(regex) => Self::Fancy(regex),
            Err(error) => panic!("invalid fancy regex {pattern:?}: {error}"),
        }
    }

    fn byte_match_at(&self, text: &str, start: usize) -> Result<Option<ByteMatch>, ()> {
        match self {
            Self::Std(regex) => Ok(regex.captures_at(text, start).map(|captures| {
                let whole = captures
                    .get(0)
                    .map(|m| (m.start(), m.end()))
                    .unwrap_or((0, 0));
                ByteMatch {
                    start: whole.0,
                    end: whole.1,
                    groups: (0..captures.len())
                        .map(|index| captures.get(index).map(|m| (m.start(), m.end())))
                        .collect(),
                }
            })),
            Self::Fancy(regex) => match regex.captures_from_pos(text, start) {
                Ok(found) => Ok(found.map(|captures| {
                    let whole = captures
                        .get(0)
                        .map(|m| (m.start(), m.end()))
                        .unwrap_or((0, 0));
                    ByteMatch {
                        start: whole.0,
                        end: whole.1,
                        groups: (0..captures.len())
                            .map(|index| captures.get(index).map(|m| (m.start(), m.end())))
                            .collect(),
                    }
                })),
                Err(_) => Err(()),
            },
        }
    }

    /// Every match, `matchAll` style, in byte offsets. The flag is true when
    /// the backtrack limit stopped the search early.
    pub fn captures_str(&self, text: &str) -> (Vec<ByteMatch>, bool) {
        let mut out = Vec::new();
        let mut position = 0;
        while position <= text.len() {
            match self.byte_match_at(text, position) {
                Ok(Some(found)) => {
                    position = if found.end == found.start {
                        next_char_boundary(text, found.end)
                    } else {
                        found.end
                    };
                    out.push(found);
                }
                Ok(None) => break,
                Err(()) => {
                    record_limit_hit();
                    return (out, true);
                }
            }
        }
        (out, false)
    }

    /// The first match (`exec` without `g`), in byte offsets.
    pub fn first_str(&self, text: &str) -> Option<ByteMatch> {
        self.first_str_at(text, 0)
    }

    /// The first match starting the search at byte `start` (`lastIndex`).
    pub fn first_str_at(&self, text: &str, start: usize) -> Option<ByteMatch> {
        if start > text.len() {
            return None;
        }
        match self.byte_match_at(text, start) {
            Ok(found) => found,
            Err(()) => {
                record_limit_hit();
                None
            }
        }
    }

    /// `regex.test(text)`. A backtrack-limit error counts as no match.
    pub fn is_match(&self, text: &str) -> bool {
        match self {
            Self::Std(regex) => regex.is_match(text),
            Self::Fancy(regex) => match regex.is_match(text) {
                Ok(found) => found,
                Err(_) => {
                    record_limit_hit();
                    false
                }
            },
        }
    }

    /// `matchAll` over a [`SourceText`] with UTF-16 offsets.
    pub fn find_all(&self, text: &SourceText) -> JsMatches {
        let (found, limit_hit) = self.captures_str(text.as_str());
        JsMatches {
            matches: found
                .into_iter()
                .map(|bytes| to_js_match(text, bytes))
                .collect(),
            limit_hit,
        }
    }

    pub fn find_first(&self, text: &SourceText) -> Option<JsMatch> {
        self.first_str(text.as_str())
            .map(|bytes| to_js_match(text, bytes))
    }

    /// `String.prototype.search`: the UTF-16 offset of the first match.
    pub fn search(&self, text: &SourceText) -> Option<usize> {
        self.first_str(text.as_str())
            .map(|found| text.utf16_at(found.start))
    }
}

fn to_js_match(text: &SourceText, bytes: ByteMatch) -> JsMatch {
    JsMatch {
        from: text.utf16_at(bytes.start),
        to: text.utf16_at(bytes.end),
        groups: bytes
            .groups
            .iter()
            .map(|group| group.map(|(start, end)| (text.utf16_at(start), text.utf16_at(end))))
            .collect(),
        bytes,
    }
}

/// `text.split(regex)` for a separator regex without capture groups that
/// always consumes at least one character.
pub fn split<'t>(regex: &JsRegex, text: &'t str) -> Vec<&'t str> {
    let (found, _) = regex.captures_str(text);
    let mut out = Vec::with_capacity(found.len() + 1);
    let mut start = 0;
    for separator in found {
        if separator.end == separator.start {
            continue;
        }
        out.push(&text[start..separator.start]);
        start = separator.end;
    }
    out.push(&text[start..]);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fancy_lookbehind_retries_like_javascript() {
        let m = JsRegex::fancy(r"(?<![a-z])bib").find_all(&SourceText::new("xbib bib".into()));
        assert_eq!(
            m.matches.iter().map(|m| m.from).collect::<Vec<_>>(),
            vec![5]
        );
    }

    #[test]
    fn backtrack_limit_becomes_a_warning_not_a_panic() {
        let regex = JsRegex::fancy_with_backtrack_limit(r"(?=(a+)+b)a", 1);
        let found = with_scope("test-scope", || {
            regex.find_all(&SourceText::new("aaaaaaaaaaaaaaaaaaaaaaac".into()))
        });
        assert!(found.limit_hit);
        assert!(found.matches.is_empty());
        assert_eq!(take_limit_hits(), vec!["test-scope"]);
    }

    #[test]
    fn match_offsets_after_an_emoji_are_utf16() {
        let found = JsRegex::std(r"cite").find_first(&SourceText::new("😀 cite".into()));
        assert_eq!(found.map(|m| m.from), Some(3));
    }

    #[test]
    fn empty_matches_after_a_match_are_reported_like_javascript() {
        let (found, _) = JsRegex::std(r"a|").captures_str("ab");
        let spans: Vec<_> = found.iter().map(|m| (m.start, m.end)).collect();
        assert_eq!(spans, vec![(0, 1), (1, 1), (2, 2)]);
    }

    #[test]
    fn groups_carry_utf16_ranges_and_text() {
        let source = SourceText::new("é \\cite{key}".into());
        let found = JsRegex::std(r"\\cite\{([^}]*)\}")
            .find_first(&source)
            .unwrap();
        assert_eq!((found.from, found.to), (2, 12));
        assert_eq!(found.group(1), Some((8, 11)));
        assert_eq!(found.text(&source, 1), Some("key"));
    }
}
