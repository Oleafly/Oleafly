use grep_matcher::Matcher as _;
use grep_regex::{RegexMatcher, RegexMatcherBuilder};
use nucleo_matcher::pattern::{CaseMatching, Normalization, Pattern};
use nucleo_matcher::{Config, Matcher, Utf32Str};
use serde::Deserialize;

const REGEX_SIZE_LIMIT: usize = 32 << 20;
const DFA_SIZE_LIMIT: usize = 64 << 20;
const MAX_PATTERN_CHARS: usize = 1000;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SearchMode {
    #[default]
    Ranked,
    Exact,
    Regex,
    Fuzzy,
}

impl SearchMode {
    pub(crate) fn greps(self) -> bool {
        matches!(self, Self::Exact | Self::Regex)
    }
}

#[derive(Debug, Clone)]
pub(crate) struct TextPattern {
    matcher: RegexMatcher,
}

fn builder(mode: SearchMode) -> RegexMatcherBuilder {
    let mut builder = RegexMatcherBuilder::new();
    builder
        .case_smart(true)
        .fixed_strings(mode != SearchMode::Regex)
        .multi_line(true)
        .crlf(true)
        .line_terminator(Some(b'\n'))
        .size_limit(REGEX_SIZE_LIMIT)
        .dfa_size_limit(DFA_SIZE_LIMIT);
    builder
}

impl TextPattern {
    pub(crate) fn new(pattern: &str, mode: SearchMode) -> Result<Self, String> {
        Self::many(&[pattern], mode)
    }

    pub(crate) fn many(patterns: &[&str], mode: SearchMode) -> Result<Self, String> {
        if patterns
            .iter()
            .any(|pattern| pattern.chars().count() > MAX_PATTERN_CHARS)
        {
            return Err("The search pattern is too long.".into());
        }
        builder(mode)
            .build_many(patterns)
            .map(|matcher| Self { matcher })
            .map_err(|error| format!("Not a valid pattern: {error}"))
    }

    pub(crate) fn matcher(&self) -> &RegexMatcher {
        &self.matcher
    }

    pub(crate) fn is_match(&self, text: &str) -> bool {
        self.matcher.is_match(text.as_bytes()).unwrap_or(false)
    }

    pub(crate) fn find_all(&self, text: &str, cap: usize) -> Vec<(usize, usize)> {
        let mut found = Vec::new();
        if cap == 0 {
            return found;
        }
        let _ = self.matcher.find_iter(text.as_bytes(), |hit| {
            if hit.start() < hit.end() {
                found.push((hit.start(), hit.end()));
            }
            found.len() < cap
        });
        found
    }
}

pub(crate) fn char_ranges(text: &str, bytes: &[(usize, usize)]) -> Vec<(usize, usize)> {
    if bytes.is_empty() {
        return Vec::new();
    }
    let mut starts: Vec<usize> = text.char_indices().map(|(at, _)| at).collect();
    starts.push(text.len());
    let char_at = |byte: usize| starts.partition_point(|start| *start < byte);
    bytes
        .iter()
        .map(|(start, end)| (char_at(*start), char_at(*end)))
        .filter(|(start, end)| start < end)
        .collect()
}

pub(crate) fn utf16_ranges(text: &str, bytes: &[(usize, usize)]) -> Vec<[u32; 2]> {
    if bytes.is_empty() {
        return Vec::new();
    }
    let mut offsets: Vec<(usize, u32)> = Vec::with_capacity(text.len() + 1);
    let mut units = 0u32;
    for (at, c) in text.char_indices() {
        offsets.push((at, units));
        units += c.len_utf16() as u32;
    }
    offsets.push((text.len(), units));
    let unit_at = |byte: usize| {
        offsets[offsets
            .partition_point(|(at, _)| *at < byte)
            .min(offsets.len() - 1)]
        .1
    };
    bytes
        .iter()
        .map(|(start, end)| [unit_at(*start), unit_at(*end)])
        .filter(|[start, end]| start < end)
        .collect()
}

pub(crate) struct FuzzyPattern {
    pattern: Pattern,
}

impl FuzzyPattern {
    pub(crate) fn new(text: &str) -> Self {
        Self {
            pattern: Pattern::parse(text, CaseMatching::Smart, Normalization::Smart),
        }
    }

    pub(crate) fn is_empty(&self) -> bool {
        self.pattern.atoms.is_empty()
    }

    pub(crate) fn score(
        &self,
        haystack: &str,
        matcher: &mut Matcher,
        buffer: &mut Vec<char>,
    ) -> Option<u32> {
        self.pattern.score(Utf32Str::new(haystack, buffer), matcher)
    }

    pub(crate) fn indices(
        &self,
        haystack: &str,
        matcher: &mut Matcher,
        buffer: &mut Vec<char>,
    ) -> Vec<usize> {
        let mut indices = Vec::new();
        self.pattern
            .indices(Utf32Str::new(haystack, buffer), matcher, &mut indices);
        indices.sort_unstable();
        indices.dedup();
        indices.into_iter().map(|index| index as usize).collect()
    }
}

pub(crate) fn fuzzy_matcher(paths: bool) -> Matcher {
    let mut config = Config::DEFAULT;
    if paths {
        config.set_match_paths();
    }
    Matcher::new(config)
}

pub(crate) fn index_ranges(indices: &[usize]) -> Vec<(usize, usize)> {
    let mut ranges: Vec<(usize, usize)> = Vec::new();
    for index in indices {
        match ranges.last_mut() {
            Some(last) if last.1 == *index => last.1 += 1,
            _ => ranges.push((*index, index + 1)),
        }
    }
    ranges
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn exact_patterns_are_literal_and_smart_about_case() {
        let pattern = TextPattern::new("a.b", SearchMode::Exact).unwrap();
        assert!(pattern.is_match("x A.B y"));
        assert!(!pattern.is_match("axb"));
        let upper = TextPattern::new("Mask", SearchMode::Exact).unwrap();
        assert!(upper.is_match("Mask ratio") && !upper.is_match("mask ratio"));
        assert_eq!(pattern.find_all("a.b and A.b", 10), vec![(0, 3), (8, 11)]);
        assert_eq!(pattern.find_all("a.b and a.b", 1).len(), 1);
    }

    #[test]
    fn regex_patterns_match_per_line_and_report_bad_syntax() {
        let pattern = TextPattern::new(r"^ratio \d+", SearchMode::Regex).unwrap();
        assert!(pattern.is_match("intro\nratio 75 here"));
        assert!(!pattern.is_match("the ratio 75"));
        assert!(TextPattern::new("(", SearchMode::Regex)
            .unwrap_err()
            .starts_with("Not a valid pattern"));
        assert!(TextPattern::new(&"a".repeat(2000), SearchMode::Exact).is_err());
        assert!(SearchMode::Regex.greps() && !SearchMode::Fuzzy.greps());
    }

    #[test]
    fn regex_line_ends_match_before_crlf() {
        let pattern = TextPattern::new(r"\}$", SearchMode::Regex).unwrap();
        assert!(pattern.is_match("\\begin{x}\r\nnext\r\n"));
        assert_eq!(pattern.find_all("a}\r\nb}\r\n", 10), vec![(1, 2), (5, 6)]);
        assert!(!pattern.is_match("a}b\r\n"));
    }

    #[test]
    fn converts_byte_ranges_to_char_ranges() {
        assert_eq!(char_ranges("é mask", &[(3, 7)]), vec![(2, 6)]);
        assert_eq!(utf16_ranges("😀 mask", &[(5, 9)]), vec![[3, 7]]);
        let many = TextPattern::many(&["a.b", "c"], SearchMode::Exact).unwrap();
        assert_eq!(many.find_all("xa.b c", 10), vec![(1, 4), (5, 6)]);
        assert!(char_ranges("abc", &[]).is_empty());
        assert_eq!(index_ranges(&[1, 2, 3, 7, 8]), vec![(1, 4), (7, 9)]);
    }

    #[test]
    fn fuzzy_patterns_score_like_fzf() {
        let mut matcher = fuzzy_matcher(false);
        let mut buffer = Vec::new();
        let pattern = FuzzyPattern::new("msk rpt");
        assert!(pattern
            .score("Masking strategy report", &mut matcher, &mut buffer)
            .is_some());
        assert!(pattern
            .score("Abstract draft", &mut matcher, &mut buffer)
            .is_none());
        let exact = FuzzyPattern::new("'draft");
        assert!(exact
            .score("Abstract draft", &mut matcher, &mut buffer)
            .is_some());
        assert!(exact
            .score("Abstract drift", &mut matcher, &mut buffer)
            .is_none());
        let indices = pattern.indices("Masking strategy report", &mut matcher, &mut buffer);
        assert!(indices.contains(&0));
        assert!(FuzzyPattern::new("  ").is_empty());
        let mut paths = fuzzy_matcher(true);
        assert!(FuzzyPattern::new("lab/nts")
            .score("Lab/2024/notes", &mut paths, &mut buffer)
            .is_some());
    }
}
