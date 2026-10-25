//! The app's Harper profile (`src/lib/proofreading/lint-profile.ts`), its
//! built-in words (`ignored.ts`) and limits (`proofreading.ts`).

use std::collections::BTreeSet;
use std::sync::LazyLock;

use oleafly_preflight::jsre::JsRegex;

/// The longest prose the proofreader checks (`PROOFREADING_LIMITS.grammarCharacters`).
pub const GRAMMAR_CHARACTER_LIMIT: usize = 500_000;

/// Rules the academic profile turns off (`ACADEMIC_PROFILE_RULES`).
pub const ACADEMIC_PROFILE_RULES: &[&str] = &[
    "Spaces",
    "NoFrenchSpaces",
    "TransposedSpace",
    "ExpandMemoryShorthands",
    "ExpandTimeShorthands",
    "ExpandStandardInputAndOutput",
    "ExpandAlgorithm",
    "ExpandArgument",
    "ExpandParameter",
    "ExpandCoordinate",
    "MoreAdjective",
    "AvoidContractions",
    "LongSentences",
    "Hedging",
    "FillerWords",
    "DiscourseMarkers",
    "ExplainLikeImFive",
    "SplitWords",
    "MergeWords",
    "CompoundNouns",
    "OxfordComma",
    "NoOxfordComma",
    "Dashes",
    "EllipsisLength",
    "NumericRangeEnDash",
    "SentenceCapitalization",
];

/// Rules that panic in harper-core 2.10.0 and therefore stay off.
pub const HARPER_PANICKING_RULES: &[&str] = &["BoringWords"];

/// Words every check accepts (`BUILTIN_PROOFREADING_WORDS`).
pub const BUILTIN_PROOFREADING_WORDS: &[&str] = &[
    "api",
    "argv",
    "backend",
    "begin",
    "bibtex",
    "boolean",
    "config",
    "end",
    "enum",
    "filename",
    "frontend",
    "hayagriva",
    "href",
    "ieee",
    "inline",
    "latex",
    "localhost",
    "luatex",
    "pdf",
    "pdflatex",
    "stdin",
    "stdout",
    "string",
    "tectonic",
    "tex",
    "tinymist",
    "typlite",
    "typst",
    "typstfmt",
    "typstyle",
    "url",
    "xelatex",
    "xetex",
];

/// English dialects Harper checks against.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash)]
pub enum Dialect {
    #[default]
    American,
    British,
    Australian,
    Canadian,
    Indian,
}

impl Dialect {
    pub const ALL: [Dialect; 5] = [
        Dialect::American,
        Dialect::British,
        Dialect::Australian,
        Dialect::Canadian,
        Dialect::Indian,
    ];

    pub fn as_str(self) -> &'static str {
        match self {
            Self::American => "american",
            Self::British => "british",
            Self::Australian => "australian",
            Self::Canadian => "canadian",
            Self::Indian => "indian",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        Self::ALL
            .into_iter()
            .find(|dialect| dialect.as_str().eq_ignore_ascii_case(value))
    }
}

static LINT_RULE_NAME: LazyLock<JsRegex> =
    LazyLock::new(|| JsRegex::std(r"\A[A-Za-z][0-9A-Za-z_]{0,63}\z"));

/// `isLintRuleName`: `/^[A-Za-z]\w{0,63}$/u`.
pub fn is_lint_rule_name(value: &str) -> bool {
    LINT_RULE_NAME.is_match(value)
}

/// `buildLintConfig`: explicit rule values layered over the curated
/// defaults. The academic rules go off, then the user's choices apply, and
/// the panicking rules always end off. Names Harper does not know are
/// dropped when `known` is given.
pub fn build_lint_config(
    user_disabled: &[&str],
    user_enabled: &[&str],
    known: Option<&BTreeSet<String>>,
) -> Vec<(String, bool)> {
    let mut config: Vec<(String, bool)> = Vec::new();
    let mut assign = |rule: &str, value: bool| {
        if !is_lint_rule_name(rule) {
            return;
        }
        if known.is_some_and(|known| !known.contains(rule)) {
            return;
        }
        match config.iter_mut().find(|(name, _)| name == rule) {
            Some(entry) => entry.1 = value,
            None => config.push((rule.to_string(), value)),
        }
    };
    for rule in ACADEMIC_PROFILE_RULES {
        assign(rule, false);
    }
    for rule in user_enabled {
        assign(rule, true);
    }
    for rule in user_disabled {
        assign(rule, false);
    }
    for rule in HARPER_PANICKING_RULES {
        assign(rule, false);
    }
    config
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_profile_tables_have_their_sizes() {
        assert_eq!(ACADEMIC_PROFILE_RULES.len(), 26);
        assert_eq!(BUILTIN_PROOFREADING_WORDS.len(), 33);
    }

    #[test]
    fn the_config_turns_academic_and_panicking_rules_off() {
        let config = build_lint_config(&["RepeatedWords"], &["LongSentences", "bad name"], None);
        let value = |rule: &str| {
            config
                .iter()
                .find(|(name, _)| name == rule)
                .map(|(_, value)| *value)
        };
        assert_eq!(value("Spaces"), Some(false));
        assert_eq!(value("LongSentences"), Some(true));
        assert_eq!(value("RepeatedWords"), Some(false));
        assert_eq!(value("BoringWords"), Some(false));
        assert_eq!(value("bad name"), None);
        let known: BTreeSet<String> = ["Spaces".to_string()].into();
        let limited = build_lint_config(&[], &[], Some(&known));
        assert_eq!(limited, vec![("Spaces".to_string(), false)]);
    }

    #[test]
    fn dialects_parse_case_insensitively() {
        assert_eq!(Dialect::parse("British"), Some(Dialect::British));
        assert_eq!(Dialect::parse("klingon"), None);
    }
}
