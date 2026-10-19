//! Fixes that are safe to apply without a person looking: one suggestion, a
//! mechanical kind of problem, and source text that reads exactly like the
//! prose Harper saw.

use oleafly_preflight::text::SourceText;

use crate::diagnostic::{LintDiagnostic, LintSource, SuggestionKind};
use crate::prose::ProseInput;

/// Harper lint kinds whose single suggestion can be applied unattended.
pub const SAFE_FIX_KINDS: &[&str] = &[
    "Repetition",
    "Typo",
    "Punctuation",
    "Capitalization",
    "Formatting",
];

pub fn is_safe_fix_kind(kind: &str) -> bool {
    SAFE_FIX_KINDS.contains(&kind)
}

/// The prose range that reads the source range `[from, to)`: the identity
/// without a map; with a Markdown map, from the last prose unit that maps to
/// `from` (skipping a collapsed space) to the one that maps to `to - 1`.
pub(crate) fn prose_range(input: &ProseInput, from: usize, to: usize) -> Option<(usize, usize)> {
    let Some(map) = &input.map else {
        return Some((from, to));
    };
    if to <= from {
        return None;
    }
    let last_at = |value: usize| -> Option<usize> {
        let after = map.partition_point(|&mapped| (mapped as usize) <= value);
        let index = after.checked_sub(1)?;
        (map[index] as usize == value).then_some(index)
    };
    let start = last_at(from)?;
    let end = last_at(to - 1)? + 1;
    (end > start).then_some((start, end))
}

/// The source text under `[from, to)` equals the prose under the range
/// Harper read.
pub(crate) fn source_matches_prose(
    source: &SourceText,
    input: &ProseInput,
    from: usize,
    to: usize,
) -> bool {
    let Some((prose_from, prose_to)) = prose_range(input, from, to) else {
        return false;
    };
    let prose = input.prose.units();
    let units = source.units();
    if to > units.len() || prose_to > prose.len() {
        return false;
    }
    units[from..to] == prose[prose_from..prose_to]
}

/// The edit a safe fix makes, as a UTF-16 range of the source and its
/// replacement; `None` unless the diagnostic is a fixable Harper finding
/// whose source still reads like the prose.
pub fn safe_fix(
    diagnostic: &LintDiagnostic,
    source: &SourceText,
    input: &ProseInput,
) -> Option<(usize, usize, String)> {
    if diagnostic.source != LintSource::Harper
        || !diagnostic.fixable
        || diagnostic.suggestions.len() != 1
    {
        return None;
    }
    let (from, to) = (diagnostic.from, diagnostic.to);
    if !source_matches_prose(source, input, from, to) {
        return None;
    }
    let suggestion = &diagnostic.suggestions[0];
    let replacement = match suggestion.kind {
        SuggestionKind::Replace => suggestion.text.clone(),
        SuggestionKind::Remove => String::new(),
        SuggestionKind::InsertAfter => format!("{}{}", source.slice(from, to), suggestion.text),
    };
    Some((from, to, replacement))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::diagnostic::{FixSuggestion, LintMessage};
    use crate::prose::{prose_for, ProseFormat};
    use oleafly_preflight::types::Severity;

    fn harper(from: usize, to: usize, kind: SuggestionKind, text: &str) -> LintDiagnostic {
        LintDiagnostic {
            from,
            to,
            severity: Severity::Warning,
            message: LintMessage::Text("Did you mean…".into()),
            source: LintSource::Harper,
            rule_id: "harper/Test".into(),
            suggestions: vec![FixSuggestion {
                kind,
                text: text.into(),
            }],
            fixable: true,
        }
    }

    #[test]
    fn a_fix_is_refused_when_prose_differs_from_source() {
        let text = SourceText::new("See \\cite{knuth} now.".to_string());
        let input = prose_for(ProseFormat::Latex, &text);
        // "Dummy" stands in for the citation in the prose, not in the source.
        assert_eq!(
            safe_fix(
                &harper(4, 9, SuggestionKind::Replace, "Dumb"),
                &text,
                &input
            ),
            None
        );
        let fix = safe_fix(
            &harper(17, 20, SuggestionKind::Replace, "then"),
            &text,
            &input,
        );
        assert_eq!(fix, Some((17, 20, "then".to_string())));
    }

    #[test]
    fn removals_and_insertions_build_the_replacement() {
        let text = SourceText::new("We compare the the results.".to_string());
        let input = prose_for(ProseFormat::Latex, &text);
        assert_eq!(
            safe_fix(&harper(11, 18, SuggestionKind::Remove, ""), &text, &input),
            Some((11, 18, String::new()))
        );
        assert_eq!(
            safe_fix(
                &harper(3, 10, SuggestionKind::InsertAfter, "d"),
                &text,
                &input
            ),
            Some((3, 10, "compared".to_string()))
        );
        let mut unfixable = harper(11, 18, SuggestionKind::Replace, "the");
        unfixable.fixable = false;
        assert_eq!(safe_fix(&unfixable, &text, &input), None);
    }

    #[test]
    fn markdown_fixes_need_contiguous_prose() {
        let text = SourceText::new("A  `x`  teh end.".to_string());
        let input = prose_for(ProseFormat::Markdown, &text);
        // Prose "A teh end." maps "teh" back to source units 8..11.
        assert_eq!(prose_range(&input, 8, 11), Some((2, 5)));
        assert_eq!(
            safe_fix(
                &harper(8, 11, SuggestionKind::Replace, "the"),
                &text,
                &input
            ),
            Some((8, 11, "the".to_string()))
        );
        // The range spans a collapsed gap, so the prose reads differently.
        assert_eq!(
            safe_fix(&harper(0, 11, SuggestionKind::Replace, "x"), &text, &input),
            None
        );
    }
}
