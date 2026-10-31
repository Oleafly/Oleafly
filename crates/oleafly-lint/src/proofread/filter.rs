use std::collections::BTreeSet;
use std::sync::LazyLock;

use icu_properties::props::GeneralCategory;
use icu_properties::CodePointMapData;
use oleafly_preflight::jsre::JsRegex;
use oleafly_preflight::text::{js_trim, utf16_len};
use unicode_normalization::UnicodeNormalization;

use super::config::BUILTIN_PROOFREADING_WORDS;
use crate::prose::{trim_to_word_characters, without_soft_hyphens, PROSE_PLACEHOLDER};

static IMPORTABLE_WORD: LazyLock<JsRegex> = LazyLock::new(|| JsRegex::std(r"\A[\p{L}'’-]+\z"));

fn nfkc(text: &str) -> String {
    text.nfkc().collect()
}

fn is_uppercase_letter(ch: char) -> bool {
    CodePointMapData::<GeneralCategory>::new().get(ch) == GeneralCategory::UppercaseLetter
}

pub fn normalize_word(word: &str) -> String {
    js_trim(&without_soft_hyphens(&nfkc(word))).to_lowercase()
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct IgnoredWords(BTreeSet<String>);

impl IgnoredWords {
    pub fn from_lines(text: &str) -> Self {
        let mut words = Self::default();
        for line in text.lines() {
            words.insert(line);
        }
        words
    }

    pub fn insert(&mut self, word: &str) {
        let normalized = normalize_word(word);
        if !normalized.is_empty() {
            self.0.insert(normalized);
        }
    }

    pub fn extend(&mut self, other: &IgnoredWords) {
        self.0.extend(other.0.iter().cloned());
    }

    pub fn contains(&self, normalized: &str) -> bool {
        self.0.contains(normalized)
    }

    pub fn len(&self) -> usize {
        self.0.len()
    }

    pub fn is_empty(&self) -> bool {
        self.0.is_empty()
    }

    pub fn iter(&self) -> impl Iterator<Item = &str> {
        self.0.iter().map(String::as_str)
    }
}

pub fn is_session_ignored_word(word: &str) -> bool {
    let normalized = nfkc(word).to_lowercase();
    if BUILTIN_PROOFREADING_WORDS.contains(&normalized.as_str()) {
        return true;
    }
    if word.chars().any(|ch| ch.is_ascii_digit()) {
        return true;
    }
    utf16_len(word) >= 2 && word == word.to_uppercase() && word.chars().any(is_uppercase_letter)
}

pub fn is_ignored_token(word: &str, ignored: &IgnoredWords) -> bool {
    let trimmed = trim_to_word_characters(&without_soft_hyphens(&nfkc(word)));
    let normalized = normalize_word(&trimmed);
    if normalized.is_empty() {
        return true;
    }
    ignored.contains(&normalized) || is_session_ignored_word(word)
}

pub fn imported_words(ignored: &IgnoredWords) -> Vec<String> {
    let mut words: BTreeSet<String> = BTreeSet::new();
    words.insert(PROSE_PLACEHOLDER.to_string());
    words.extend(
        BUILTIN_PROOFREADING_WORDS
            .iter()
            .map(|word| word.to_string()),
    );
    words.extend(ignored.iter().map(str::to_string));
    words
        .into_iter()
        .filter(|word| IMPORTABLE_WORD.is_match(word))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn words_with_digits_or_all_caps_are_ignored_like_the_app() {
        assert!(is_session_ignored_word("IEEE754"));
        assert!(is_session_ignored_word("API"));
        assert!(is_session_ignored_word("LaTeX".to_lowercase().as_str()));
        assert!(!is_session_ignored_word("Paper"));
        assert!(!is_session_ignored_word("A"));
    }

    #[test]
    fn reference_abbreviations_are_ignored_like_the_app() {
        for word in ["Eq", "Fig", "Sec", "selectable"] {
            assert!(is_session_ignored_word(word), "{word}");
        }
    }

    #[test]
    fn ignored_words_are_normalised() {
        let words = IgnoredWords::from_lines("Oleafly\u{00AD}\n\n  Zotero  \r\n");
        assert!(words.contains("oleafly"));
        assert!(words.contains("zotero"));
        assert_eq!(words.len(), 2);
        assert!(is_ignored_token("Oleafly,", &words));
        assert!(is_ignored_token("—", &words));
        assert!(!is_ignored_token("Paper", &words));
    }

    #[test]
    fn imported_words_are_plain_words() {
        let mut words = IgnoredWords::default();
        words.insert("o'neill");
        words.insert("c++");
        let imported = imported_words(&words);
        assert!(imported.contains(&"Dummy".to_string()));
        assert!(imported.contains(&"o'neill".to_string()));
        assert!(!imported.iter().any(|word| word == "c++"));
        assert!(imported.windows(2).all(|pair| pair[0] < pair[1]));
    }
}
