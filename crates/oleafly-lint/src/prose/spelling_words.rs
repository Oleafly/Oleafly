use std::sync::LazyLock;

use oleafly_preflight::jsre::JsRegex;
use oleafly_preflight::text::SourceText;

const UNSEGMENTED_SCRIPTS: &str = r"\p{sc=Han}\p{sc=Hiragana}\p{sc=Katakana}\p{sc=Thai}\p{sc=Lao}\p{sc=Khmer}\p{sc=Myanmar}\p{sc=Tibetan}";

fn word_pattern() -> String {
    let letter = format!(r"[\p{{L}}--[{UNSEGMENTED_SCRIPTS}]]");
    let run_tail = format!(r"(?:{letter}|\p{{M}})*");
    let run = format!("{letter}{run_tail}");
    let joiner = r"['’ʼ׳״·\x{AD}\x{200C}\x{200D}]+";
    let hebrew_run = format!(r#""[\p{{L}}&&\p{{sc=Hebrew}}]{run_tail}"#);
    format!("{run}(?:{joiner}{run}|{hebrew_run})*")
}

static WORD: LazyLock<JsRegex> = LazyLock::new(|| JsRegex::std(&word_pattern()));
static COMPOUND: LazyLock<JsRegex> = LazyLock::new(|| {
    let word = word_pattern();
    JsRegex::std(&format!(r"{word}(?:[-\x{{2010}}]{word})*"))
});

const EMAIL_ADDRESS: &str = r"(?<![\p{L}\p{M}\p{N}._%+-])[\p{L}\p{M}\p{N}._%+-]+@[\p{L}\p{M}\p{N}.-]+\.\p{L}[\p{L}\p{M}]+(?![\p{L}\p{M}\p{N}])";

static EMAIL: LazyLock<JsRegex> = LazyLock::new(|| JsRegex::fancy(EMAIL_ADDRESS));

/// `EMAIL_ADDRESS_PATTERN` (look-behind and look-ahead, so fancy-regex).
pub fn email_address_pattern() -> &'static JsRegex {
    &EMAIL
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SpellingWordSpan {
    pub from: usize,
    pub to: usize,
    pub word: String,
    pub compound: Option<(usize, usize, String)>,
}

pub fn spelling_word_spans(masked: &SourceText) -> Vec<SpellingWordSpan> {
    let mut output = Vec::new();
    for compound in COMPOUND.find_all(masked).matches {
        let start = compound.from;
        let text = masked.slice(compound.from, compound.to);
        let whole = SourceText::new(text.clone());
        let parts = WORD.find_all(&whole).matches;
        if parts.len() == 1 {
            output.push(SpellingWordSpan {
                from: start,
                to: compound.to,
                word: text,
                compound: None,
            });
            continue;
        }
        for part in parts {
            let from = start + part.from;
            output.push(SpellingWordSpan {
                from,
                to: start + part.to,
                word: whole.slice(part.from, part.to),
                compound: Some((start, compound.to, text.clone())),
            });
        }
    }
    output
}

#[cfg(test)]
mod tests {
    use super::*;

    fn words(text: &str) -> Vec<(usize, usize, String, bool)> {
        spelling_word_spans(&SourceText::new(text.to_string()))
            .into_iter()
            .map(|span| (span.from, span.to, span.word, span.compound.is_some()))
            .collect()
    }

    #[test]
    fn compounds_split_into_parts() {
        assert_eq!(
            words("state-of-the-art don’t"),
            vec![
                (0, 5, "state".into(), true),
                (6, 8, "of".into(), true),
                (9, 12, "the".into(), true),
                (13, 16, "art".into(), true),
                (17, 22, "don’t".into(), false),
            ]
        );
    }

    #[test]
    fn unsegmented_scripts_and_hebrew_joiners() {
        assert!(words("漢字").is_empty());
        assert_eq!(words("צה\"ל")[0].2, "צה\"ל");
        assert_eq!(words("a\"b").len(), 2);
    }

    #[test]
    fn email_addresses_need_a_domain() {
        let text = SourceText::new("mail ana@example.org or x@y now".to_string());
        let found = email_address_pattern().find_all(&text).matches;
        assert_eq!(found.len(), 1);
        assert_eq!((found[0].from, found[0].to), (5, 20));
    }
}
