pub mod config;
pub mod filter;
pub mod fix;

use std::collections::BTreeMap;
use std::fmt;

use oleafly_preflight::text::{is_js_space_unit, js_trim, SourceText};
use oleafly_preflight::types::Severity;

pub use config::{
    build_lint_config, is_lint_rule_name, Dialect, ACADEMIC_PROFILE_RULES,
    BUILTIN_PROOFREADING_WORDS, GRAMMAR_CHARACTER_LIMIT, HARPER_PANICKING_RULES,
};
pub use filter::{
    imported_words, is_ignored_token, is_session_ignored_word, normalize_word, IgnoredWords,
};
pub use fix::{is_safe_fix_kind, safe_fix, SAFE_FIX_KINDS};

use crate::diagnostic::{FixSuggestion, LintDiagnostic, LintMessage, LintSource};
use crate::prose::{intersects_masked_region, prose_for, ProseFormat, ProseInput};

pub const AVAILABLE: bool = cfg!(feature = "proofread");

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RawLint {
    pub rule: String,
    pub kind: String,
    pub from: usize,
    pub to: usize,
    pub message: String,
    pub suggestions: Vec<FixSuggestion>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ProofreadError {
    Unavailable,
    Panicked(String),
}

impl fmt::Display for ProofreadError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Unavailable => {
                f.write_str("spelling and grammar checks are not part of this build")
            }
            Self::Panicked(message) => write!(f, "the grammar checker failed: {message}"),
        }
    }
}

impl std::error::Error for ProofreadError {}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SkipReason {
    TooLarge { characters: usize },
}

#[derive(Clone, Debug, PartialEq)]
pub struct ProofreadOutcome {
    pub diagnostics: Vec<LintDiagnostic>,
    pub malformed: usize,
    pub skipped: Option<SkipReason>,
}

impl ProofreadOutcome {
    fn empty() -> Self {
        Self {
            diagnostics: Vec::new(),
            malformed: 0,
            skipped: None,
        }
    }
}

pub fn harper_version() -> Option<&'static str> {
    #[cfg(feature = "proofread")]
    {
        Some(harper_core::core_version())
    }
    #[cfg(not(feature = "proofread"))]
    {
        None
    }
}

pub(crate) fn lint_range(
    start: usize,
    end: usize,
    prose_length: usize,
    map: Option<&[u32]>,
    text_length: usize,
) -> Option<(usize, usize)> {
    let prose_from = start.min(prose_length);
    let prose_to = end.min(prose_length).max(prose_from + 1);
    let (from, to) = match map {
        Some(map) => {
            if prose_from >= map.len() {
                return None;
            }
            let from = map[prose_from] as usize;
            let last = prose_to.min(map.len()) - 1;
            (
                from,
                map.get(last).map_or(from, |&mapped| mapped as usize) + 1,
            )
        }
        None => (prose_from, prose_to),
    };
    (to > from && to <= text_length).then_some((from, to))
}

const SPELLING_SPAN_LIMIT: usize = 40;
const GRAMMAR_SPAN_LIMIT: usize = 300;
const SAME_WORD_LIMIT: usize = 20;

fn is_spelling_kind(kind: &str) -> bool {
    kind.is_empty() || kind == "Spelling"
}

fn bounded_sentence_end(text: &SourceText, from: usize, cap: usize) -> usize {
    for index in from + 1..cap {
        if !matches!(text.unit(index), Some(0x2E | 0x3F | 0x21)) {
            continue;
        }
        let next = index + 1;
        if next >= cap || text.unit(next).is_some_and(is_js_space_unit) {
            return next;
        }
    }
    cap
}

fn renderable_span_end(kind: &str, from: usize, to: usize, text: &SourceText) -> Option<usize> {
    if to <= from || to > text.len_utf16() {
        return None;
    }
    if is_spelling_kind(kind) {
        let one_line = !text.units()[from..to].contains(&0x0A);
        return (to - from <= SPELLING_SPAN_LIMIT && one_line).then_some(to);
    }
    let bounded = bounded_sentence_end(text, from, to.min(from + GRAMMAR_SPAN_LIMIT));
    (bounded > from).then_some(bounded)
}

fn guarded(found: Vec<(LintDiagnostic, String)>, text: &SourceText) -> Vec<LintDiagnostic> {
    let mut per_word: std::collections::HashMap<String, usize> = std::collections::HashMap::new();
    let mut output = Vec::new();
    for (mut diagnostic, kind) in found {
        let Some(to) = renderable_span_end(&kind, diagnostic.from, diagnostic.to, text) else {
            continue;
        };
        let key = js_trim(&text.slice(diagnostic.from, to)).to_lowercase();
        let seen = per_word.entry(key).or_insert(0);
        if *seen >= SAME_WORD_LIMIT {
            continue;
        }
        *seen += 1;
        if to != diagnostic.to {
            diagnostic.to = to;
            diagnostic.suggestions.clear();
            diagnostic.fixable = false;
        }
        output.push(diagnostic);
    }
    output
}

pub(crate) fn diagnostics_from(
    raw: Vec<RawLint>,
    text: &SourceText,
    input: &ProseInput,
    ignored: &IgnoredWords,
) -> (Vec<LintDiagnostic>, usize) {
    let mut diagnostics: Vec<(LintDiagnostic, String)> = Vec::new();
    let mut malformed = 0;
    for lint in raw {
        let Some((from, to)) = lint_range(
            lint.from,
            lint.to,
            input.prose.len_utf16(),
            input.map.as_deref(),
            text.len_utf16(),
        ) else {
            malformed += 1;
            continue;
        };
        if !input.masked.is_empty() && intersects_masked_region(&input.masked, from, to) {
            continue;
        }
        if is_ignored_token(&text.slice(from, to), ignored) {
            continue;
        }
        let fixable = lint.suggestions.len() == 1
            && is_safe_fix_kind(&lint.kind)
            && fix::source_matches_prose(text, input, from, to);
        diagnostics.push((
            LintDiagnostic {
                from,
                to,
                severity: Severity::Warning,
                message: LintMessage::Text(lint.message),
                source: LintSource::Harper,
                rule_id: format!("harper/{}", lint.rule),
                suggestions: lint.suggestions,
                fixable,
            },
            lint.kind,
        ));
    }
    diagnostics.sort_by_key(|(diagnostic, _)| (diagnostic.from, diagnostic.to));
    (guarded(diagnostics, text), malformed)
}

fn too_large(text: &SourceText) -> Option<ProofreadOutcome> {
    let characters = text.len_utf16();
    (characters > GRAMMAR_CHARACTER_LIMIT).then(|| ProofreadOutcome {
        diagnostics: Vec::new(),
        malformed: 0,
        skipped: Some(SkipReason::TooLarge { characters }),
    })
}

#[cfg(all(test, feature = "proofread"))]
thread_local! {
    static PANIC_NEXT: std::cell::Cell<bool> = const { std::cell::Cell::new(false) };
}

#[cfg(feature = "proofread")]
mod engine {
    use std::collections::{BTreeMap, BTreeSet};
    use std::panic::{catch_unwind, AssertUnwindSafe};
    use std::sync::{Arc, OnceLock};

    use harper_core::linting::{LintGroup, Suggestion};
    use harper_core::parsers::PlainEnglish;
    use harper_core::spell::{FstDictionary, MergedDictionary, MutableDictionary};
    use harper_core::{remove_overlaps_map, DialectFlags, DictWordMetadata, Document, Lrc};

    use super::config::{build_lint_config, Dialect};
    use super::filter::{imported_words, IgnoredWords};
    use super::RawLint;
    use crate::diagnostic::{FixSuggestion, SuggestionKind};

    const MAX_SUGGESTIONS: usize = 8;

    pub(super) fn harper_dialect(dialect: Dialect) -> harper_core::Dialect {
        match dialect {
            Dialect::American => harper_core::Dialect::American,
            Dialect::British => harper_core::Dialect::British,
            Dialect::Australian => harper_core::Dialect::Australian,
            Dialect::Canadian => harper_core::Dialect::Canadian,
            Dialect::Indian => harper_core::Dialect::Indian,
        }
    }

    struct CuratedRules {
        names: BTreeSet<String>,
        descriptions: BTreeMap<String, String>,
    }

    fn curated_rules() -> &'static CuratedRules {
        static CURATED: OnceLock<CuratedRules> = OnceLock::new();
        CURATED.get_or_init(|| {
            let group = LintGroup::new_curated(
                Arc::new(MutableDictionary::new()),
                harper_core::Dialect::American,
            );
            let names = match serde_json::to_value(&group.config) {
                Ok(serde_json::Value::Object(map)) => map.keys().cloned().collect(),
                _ => BTreeSet::new(),
            };
            let descriptions = group
                .all_descriptions()
                .into_iter()
                .map(|(rule, description)| (rule.to_string(), description.to_string()))
                .collect();
            CuratedRules {
                names,
                descriptions,
            }
        })
    }

    /// The rule names of Harper's default config (`getDefaultLintConfig`).
    pub(super) fn known_rules() -> &'static BTreeSet<String> {
        &curated_rules().names
    }

    pub(super) fn rule_descriptions() -> &'static BTreeMap<String, String> {
        &curated_rules().descriptions
    }

    /// harper-wasm's `Linter` after `setDialect`, `setLintConfig`,
    /// `clearWords` and `importWords`, as the worker leaves it.
    pub(super) struct Engine {
        lint_group: LintGroup,
        dictionary: Arc<MergedDictionary>,
    }

    impl Engine {
        pub(super) fn new(dialect: Dialect, ignored: &IgnoredWords) -> Self {
            let dialect = harper_dialect(dialect);
            let mut user = MutableDictionary::new();
            user.extend_words(imported_words(ignored).iter().map(|word| {
                (
                    word.chars().collect::<Vec<char>>(),
                    DictWordMetadata {
                        dialects: DialectFlags::from_dialect(dialect),
                        ..Default::default()
                    },
                )
            }));
            let mut merged = MergedDictionary::new();
            merged.add_dictionary(FstDictionary::curated());
            merged.add_dictionary(Arc::new(user));
            let dictionary = Arc::new(merged);
            let mut lint_group = LintGroup::new_curated_empty_config(dictionary.clone(), dialect);
            for (rule, enabled) in build_lint_config(&[], &[], Some(known_rules())) {
                lint_group.config.set_rule_enabled(rule, enabled);
            }
            Self {
                lint_group,
                dictionary,
            }
        }

        /// `organized_lints(text, Language::Plain, false, None, true, false)`
        /// with spans converted to UTF-16 like `char_idx_to_js_str_idx`.
        pub(super) fn lint(&mut self, prose: &str) -> Vec<RawLint> {
            let chars: Vec<char> = prose.chars().collect();
            let mut utf16 = Vec::with_capacity(chars.len() + 1);
            let mut total = 0usize;
            utf16.push(0);
            for ch in &chars {
                total += ch.len_utf16();
                utf16.push(total);
            }
            let source: Lrc<[char]> = chars.into();
            let document = Document::new_from_chars(source, &PlainEnglish, &*self.dictionary);
            let saved = self.lint_group.config.clone();
            self.lint_group.config.fill_with_curated();
            let mut organized = self.lint_group.organized_lints(&document);
            self.lint_group.config = saved;
            remove_overlaps_map(&mut organized);
            let at = |index: usize| utf16[index.min(utf16.len() - 1)];
            let mut out = Vec::new();
            for (rule, lints) in organized {
                for lint in lints {
                    out.push(RawLint {
                        rule: rule.clone(),
                        kind: lint.lint_kind.to_string_key(),
                        from: at(lint.span.start),
                        to: at(lint.span.end),
                        message: lint.message.clone(),
                        suggestions: mapped_suggestions(&lint.suggestions),
                    });
                }
            }
            out
        }
    }

    fn mapped_suggestions(suggestions: &[Suggestion]) -> Vec<FixSuggestion> {
        let mut out = Vec::new();
        for suggestion in suggestions.iter().take(MAX_SUGGESTIONS) {
            let (kind, text) = match suggestion {
                Suggestion::ReplaceWith(chars) => {
                    (SuggestionKind::Replace, chars.iter().collect::<String>())
                }
                Suggestion::InsertAfter(chars) => (
                    SuggestionKind::InsertAfter,
                    chars.iter().collect::<String>(),
                ),
                Suggestion::Remove => (SuggestionKind::Remove, String::new()),
            };
            if text.is_empty() && kind != SuggestionKind::Remove {
                continue;
            }
            out.push(FixSuggestion { kind, text });
        }
        out
    }

    pub(super) fn guarded<T>(run: impl FnOnce() -> T) -> Result<T, String> {
        catch_unwind(AssertUnwindSafe(run)).map_err(|payload| {
            if let Some(message) = payload.downcast_ref::<&str>() {
                (*message).to_string()
            } else if let Some(message) = payload.downcast_ref::<String>() {
                message.clone()
            } else {
                "unknown panic".to_string()
            }
        })
    }
}

pub struct Proofreader {
    dialect: Dialect,
    ignored: IgnoredWords,
    #[cfg(feature = "proofread")]
    engine: engine::Engine,
}

impl Proofreader {
    pub fn new(dialect: Dialect, ignored: &IgnoredWords) -> Result<Self, ProofreadError> {
        #[cfg(feature = "proofread")]
        {
            let built = engine::guarded(|| engine::Engine::new(dialect, ignored))
                .map_err(ProofreadError::Panicked)?;
            Ok(Self {
                dialect,
                ignored: ignored.clone(),
                engine: built,
            })
        }
        #[cfg(not(feature = "proofread"))]
        {
            let _ = (dialect, ignored);
            Err(ProofreadError::Unavailable)
        }
    }

    pub fn dialect(&self) -> Dialect {
        self.dialect
    }

    pub fn ignored(&self) -> &IgnoredWords {
        &self.ignored
    }

    pub fn raw_lints(&mut self, prose: &str) -> Result<Vec<RawLint>, ProofreadError> {
        #[cfg(feature = "proofread")]
        {
            let active = &mut self.engine;
            let outcome = engine::guarded(|| {
                #[cfg(test)]
                if PANIC_NEXT.with(|flag| flag.replace(false)) {
                    panic!("injected test panic");
                }
                active.lint(prose)
            });
            match outcome {
                Ok(lints) => Ok(lints),
                Err(message) => {
                    let rebuilt =
                        engine::guarded(|| engine::Engine::new(self.dialect, &self.ignored))
                            .map_err(ProofreadError::Panicked)?;
                    self.engine = rebuilt;
                    Err(ProofreadError::Panicked(message))
                }
            }
        }
        #[cfg(not(feature = "proofread"))]
        {
            let _ = prose;
            Err(ProofreadError::Unavailable)
        }
    }

    pub fn check(
        &mut self,
        text: &SourceText,
        format: ProseFormat,
    ) -> Result<ProofreadOutcome, ProofreadError> {
        if !AVAILABLE {
            return Err(ProofreadError::Unavailable);
        }
        if let Some(skipped) = too_large(text) {
            return Ok(skipped);
        }
        let input = prose_for(format, text);
        if input.prose.is_empty() {
            return Ok(ProofreadOutcome::empty());
        }
        let raw = self.raw_lints(input.prose.as_str())?;
        let (diagnostics, malformed) = diagnostics_from(raw, text, &input, &self.ignored);
        Ok(ProofreadOutcome {
            diagnostics,
            malformed,
            skipped: None,
        })
    }
}

pub fn rule_descriptions() -> BTreeMap<String, String> {
    #[cfg(feature = "proofread")]
    {
        engine::rule_descriptions().clone()
    }
    #[cfg(not(feature = "proofread"))]
    {
        BTreeMap::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::diagnostic::SuggestionKind;

    #[test]
    fn availability_matches_the_feature() {
        assert_eq!(AVAILABLE, cfg!(feature = "proofread"));
        assert_eq!(harper_version().is_some(), AVAILABLE);
    }

    #[test]
    fn lint_ranges_follow_the_worker() {
        assert_eq!(lint_range(2, 2, 10, None, 10), Some((2, 3)));
        assert_eq!(lint_range(9, 20, 10, None, 10), Some((9, 10)));
        assert_eq!(lint_range(10, 12, 10, None, 10), None);
        let map = [0u32, 4, 4, 5];
        assert_eq!(lint_range(1, 3, 4, Some(&map), 6), Some((4, 5)));
        assert_eq!(lint_range(4, 5, 4, Some(&map), 6), None);
    }

    fn raw(rule: &str, kind: &str, from: usize, to: usize, suggestion: Option<&str>) -> RawLint {
        RawLint {
            rule: rule.into(),
            kind: kind.into(),
            from,
            to,
            message: format!("{rule} message"),
            suggestions: suggestion
                .map(|text| {
                    vec![FixSuggestion {
                        kind: SuggestionKind::Replace,
                        text: text.into(),
                    }]
                })
                .unwrap_or_default(),
        }
    }

    #[test]
    fn findings_over_masks_and_accepted_words_are_dropped() {
        let text = SourceText::new("We add \\cite{k} and the the API test.".to_string());
        let input = prose_for(ProseFormat::Latex, &text);
        let lints = vec![
            raw("RepeatedWords", "Repetition", 20, 27, Some("the")),
            raw("SpellCheck", "Spelling", 28, 31, Some("APT")),
            raw("Overlap", "Grammar", 5, 9, None),
            raw("Outside", "Grammar", 90, 95, None),
        ];
        let (found, malformed) = diagnostics_from(lints, &text, &input, &IgnoredWords::default());
        assert_eq!(malformed, 1);
        assert_eq!(found.len(), 1);
        assert_eq!((found[0].from, found[0].to), (20, 27));
        assert_eq!(found[0].rule_id, "harper/RepeatedWords");
        assert!(found[0].fixable);
    }

    #[test]
    fn findings_are_guarded_like_the_app_shows_them() {
        let sentence = "We recieve it. ";
        let text = SourceText::new(format!(
            "{}{} Then more text here.",
            sentence.repeat(25),
            "word ".repeat(20)
        ));
        let input = prose_for(ProseFormat::Markdown, &text);
        let mut lints: Vec<RawLint> = (0..25)
            .map(|index| {
                let from = index * sentence.len() + 3;
                raw("SpellCheck", "Spelling", from, from + 7, Some("receive"))
            })
            .collect();
        let words = 25 * sentence.len();
        lints.push(raw("Long", "Grammar", 0, 20, Some("x")));
        lints.push(raw("SpellCheck", "Spelling", words, words + 45, Some("y")));
        let (found, _) = diagnostics_from(lints, &text, &input, &IgnoredWords::default());
        let spelling = found
            .iter()
            .filter(|diagnostic| diagnostic.rule_id == "harper/SpellCheck")
            .count();
        assert_eq!(spelling, 20);
        let cut = found
            .iter()
            .find(|diagnostic| diagnostic.rule_id == "harper/Long")
            .expect("the cut grammar finding");
        assert_eq!((cut.from, cut.to), (0, 14));
        assert!(cut.suggestions.is_empty());
        assert!(!cut.fixable);
    }

    #[cfg(not(feature = "proofread"))]
    #[test]
    fn the_stub_says_unavailable() {
        assert!(matches!(
            Proofreader::new(Dialect::American, &IgnoredWords::default()),
            Err(ProofreadError::Unavailable)
        ));
        assert!(rule_descriptions().is_empty());
    }

    #[cfg(feature = "proofread")]
    mod harper {
        use super::super::*;

        fn proofreader() -> Proofreader {
            Proofreader::new(Dialect::American, &IgnoredWords::default()).expect("harper builds")
        }

        #[test]
        fn a_repeated_word_is_reported_and_safely_fixable() {
            let mut proofreader = proofreader();
            let text = SourceText::new("We compare the the results.".to_string());
            let outcome = proofreader.check(&text, ProseFormat::Latex).unwrap();
            let repeated = outcome
                .diagnostics
                .iter()
                .find(|diagnostic| diagnostic.rule_id == "harper/RepeatedWords")
                .expect("a repeated word finding");
            assert!(repeated.fixable);
            let input = prose_for(ProseFormat::Latex, &text);
            assert_eq!(
                safe_fix(repeated, &text, &input),
                Some((11, 18, "the".to_string()))
            );
        }

        #[test]
        fn a_lint_over_a_masked_equation_is_dropped() {
            let mut proofreader = proofreader();
            let text = SourceText::new("We add and \\(c+d\\) and then stop.".to_string());
            let outcome = proofreader.check(&text, ProseFormat::Latex).unwrap();
            assert!(!outcome
                .diagnostics
                .iter()
                .any(|diagnostic| diagnostic.rule_id == "harper/RepeatedWords"));
        }

        #[test]
        fn prose_over_the_character_limit_is_skipped_with_a_warning() {
            let mut proofreader = proofreader();
            let text = SourceText::new("a ".repeat(GRAMMAR_CHARACTER_LIMIT / 2) + "a");
            let outcome = proofreader.check(&text, ProseFormat::Latex).unwrap();
            assert_eq!(
                outcome.skipped,
                Some(SkipReason::TooLarge {
                    characters: GRAMMAR_CHARACTER_LIMIT + 1
                })
            );
            assert!(outcome.diagnostics.is_empty());
        }

        #[test]
        fn a_panicking_rule_is_isolated() {
            let mut proofreader = proofreader();
            PANIC_NEXT.with(|flag| flag.set(true));
            assert!(matches!(
                proofreader.raw_lints("A short sentence."),
                Err(ProofreadError::Panicked(_))
            ));
            assert!(proofreader.raw_lints("A short sentence.").is_ok());
        }

        #[test]
        fn rule_descriptions_cover_the_profile() {
            let descriptions = rule_descriptions();
            assert!(descriptions.contains_key("RepeatedWords"));
            assert!(descriptions.contains_key("SpellCheck"));
        }
    }
}
