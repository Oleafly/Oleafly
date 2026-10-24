//! The BibTeX linter (`packages/editor/src/bibtex-linter.ts`): a line-led
//! entry scan that recovers at the next `@type{` line, then per-entry checks
//! for unknown types, missing required fields, repeated fields and years.

use std::collections::{BTreeSet, HashSet};

use oleafly_preflight::bib::{
    bibtex_entry_type, is_bibtex_directive, missing_bibtex_required_fields,
};
use oleafly_preflight::latex::novalidate::{novalidate_directive, Novalidate};
use oleafly_preflight::messages::MessageRef;
use oleafly_preflight::msg;
use oleafly_preflight::text::{index_of_units, is_js_space_unit, js_trim, SourceText};
use oleafly_preflight::types::Severity;

use crate::diagnostic::{compare, LintDiagnostic, LintSource};

const HEAD_LOOKAHEAD: usize = 128;

const AT: u16 = b'@' as u16;
const BACKSLASH: u16 = b'\\' as u16;
const OPEN_BRACE: u16 = b'{' as u16;
const CLOSE_BRACE: u16 = b'}' as u16;
const OPEN_PAREN: u16 = b'(' as u16;
const CLOSE_PAREN: u16 = b')' as u16;
const QUOTE: u16 = b'"' as u16;
const COMMA: u16 = b',' as u16;
const EQUALS: u16 = b'=' as u16;
const NEWLINE: u16 = b'\n' as u16;
const SPACE: u16 = b' ' as u16;
const TAB: u16 = b'\t' as u16;
const CARRIAGE_RETURN: u16 = b'\r' as u16;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct BibtexRange {
    pub from: usize,
    pub to: usize,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct BibtexFieldSpan {
    pub name: String,
    pub from: usize,
    pub to: usize,
    pub value: String,
    pub value_from: usize,
    pub value_to: usize,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct BibtexEntrySpan {
    pub entry_type: String,
    pub type_range: BibtexRange,
    pub key: String,
    pub key_range: BibtexRange,
    pub fields: Vec<BibtexFieldSpan>,
    pub complete: bool,
}

fn is_ascii_letter(unit: u16) -> bool {
    matches!(unit, 0x41..=0x5a | 0x61..=0x7a)
}

fn is_ascii_digit(unit: u16) -> bool {
    matches!(unit, 0x30..=0x39)
}

fn is_type_unit(unit: u16) -> bool {
    is_ascii_letter(unit)
        || is_ascii_digit(unit)
        || unit == u16::from(b'_')
        || unit == u16::from(b'-')
}

fn is_field_name_unit(unit: u16) -> bool {
    is_type_unit(unit) || unit == u16::from(b'+') || unit == u16::from(b':')
}

fn lossy(units: &[u16]) -> String {
    String::from_utf16_lossy(units)
}

/// `text.slice(from, to)` with JavaScript's clamping.
fn slice(text: &[u16], from: usize, to: usize) -> &[u16] {
    let to = to.min(text.len());
    &text[from.min(to)..to]
}

fn line_end_from(text: &[u16], cursor: usize) -> usize {
    index_of_units(text, &[NEWLINE], cursor).unwrap_or(text.len())
}

/// `ENTRY_START`: `/^[ \t]*@[A-Za-z][A-Za-z0-9_-]*[ \t]*[{(]/u` on the line.
fn entry_start_matches(line: &[u16]) -> bool {
    let mut index = 0;
    while matches!(line.get(index), Some(&SPACE) | Some(&TAB)) {
        index += 1;
    }
    if line.get(index) != Some(&AT) {
        return false;
    }
    index += 1;
    if !line.get(index).copied().is_some_and(is_ascii_letter) {
        return false;
    }
    index += 1;
    while line.get(index).copied().is_some_and(is_type_unit) {
        index += 1;
    }
    while matches!(line.get(index), Some(&SPACE) | Some(&TAB)) {
        index += 1;
    }
    matches!(line.get(index), Some(&OPEN_BRACE) | Some(&OPEN_PAREN))
}

/// The `@` of an entry that starts the line, if any.
fn starts_entry(text: &[u16], line_start: usize, line_end: usize) -> Option<usize> {
    let line = slice(text, line_start, line_end);
    if !entry_start_matches(line) {
        return None;
    }
    index_of_units(line, &[AT], 0).map(|at| line_start + at)
}

fn skip_blank(text: &[u16], cursor: usize, limit: usize) -> usize {
    let mut index = cursor;
    while index < limit && text.get(index).copied().is_some_and(is_js_space_unit) {
        index += 1;
    }
    index
}

fn braced_value_end(text: &[u16], cursor: usize, limit: usize) -> usize {
    let mut depth = 1usize;
    let mut index = cursor + 1;
    while index < limit && depth > 0 {
        match text.get(index).copied() {
            Some(BACKSLASH) => index += 1,
            Some(OPEN_BRACE) => depth += 1,
            Some(CLOSE_BRACE) => depth -= 1,
            _ => {}
        }
        index += 1;
    }
    index
}

fn quoted_value_end(text: &[u16], cursor: usize, limit: usize) -> usize {
    let mut index = cursor + 1;
    while index < limit && text.get(index) != Some(&QUOTE) {
        index += if text.get(index) == Some(&BACKSLASH) {
            2
        } else {
            1
        };
    }
    (index + 1).min(limit)
}

fn bare_value_end(text: &[u16], cursor: usize, limit: usize) -> usize {
    let mut index = cursor;
    while index < limit && text.get(index) != Some(&COMMA) && text.get(index) != Some(&NEWLINE) {
        index += 1;
    }
    index
}

fn value_end(text: &[u16], cursor: usize, limit: usize) -> usize {
    match text.get(cursor) {
        Some(&OPEN_BRACE) => braced_value_end(text, cursor, limit),
        Some(&QUOTE) => quoted_value_end(text, cursor, limit),
        _ => bare_value_end(text, cursor, limit),
    }
}

fn unwrap_value(raw: &str) -> String {
    let trimmed = js_trim(raw);
    let wrapped = (trimmed.starts_with('{') && trimmed.ends_with('}'))
        || (trimmed.starts_with('"') && trimmed.ends_with('"'));
    if !wrapped {
        return trimmed.to_string();
    }
    // `slice(1, -1)`: a lone `"` both starts and ends the value and leaves
    // nothing behind.
    if trimmed.len() < 2 {
        return String::new();
    }
    js_trim(&trimmed[1..trimmed.len() - 1]).to_string()
}

/// `FIELD_HEAD`: `/^([A-Za-z][A-Za-z0-9_+:-]*)[ \t\r\n]*=/u` within the
/// lookahead window, as `(name length, head length)`.
fn field_head(text: &[u16], cursor: usize, limit: usize) -> Option<(usize, usize)> {
    let window = slice(text, cursor, limit.min(cursor + HEAD_LOOKAHEAD));
    if !window.first().copied().is_some_and(is_ascii_letter) {
        return None;
    }
    let mut index = 1;
    while window.get(index).copied().is_some_and(is_field_name_unit) {
        index += 1;
    }
    let name_length = index;
    while matches!(
        window.get(index),
        Some(&SPACE) | Some(&TAB) | Some(&CARRIAGE_RETURN) | Some(&NEWLINE)
    ) {
        index += 1;
    }
    (window.get(index) == Some(&EQUALS)).then_some((name_length, index + 1))
}

fn skip_to_field_boundary(text: &[u16], cursor: usize, limit: usize) -> usize {
    let mut index = cursor;
    while index < limit && text.get(index) != Some(&COMMA) {
        index += 1;
    }
    index + 1
}

fn parse_fields(text: &[u16], from: usize, limit: usize) -> Vec<BibtexFieldSpan> {
    let mut fields = Vec::new();
    let mut cursor = from;
    while cursor < limit {
        cursor = skip_blank(text, cursor, limit);
        if cursor >= limit {
            break;
        }
        if text.get(cursor) == Some(&COMMA) {
            cursor += 1;
            continue;
        }
        let Some((name_length, head_length)) = field_head(text, cursor, limit) else {
            cursor = skip_to_field_boundary(text, cursor, limit);
            continue;
        };
        let name_from = cursor;
        let value_from = skip_blank(text, cursor + head_length, limit);
        let value_to = value_end(text, value_from, limit);
        fields.push(BibtexFieldSpan {
            name: lossy(&text[name_from..name_from + name_length]).to_ascii_lowercase(),
            from: name_from,
            to: name_from + name_length,
            value: unwrap_value(&lossy(slice(text, value_from, value_to))),
            value_from,
            value_to: value_to.max(value_from + 1),
        });
        cursor = value_to.max(name_from + 1);
    }
    fields
}

fn next_entry_follows(text: &[u16], newline: usize) -> bool {
    let line_start = newline + 1;
    starts_entry(text, line_start, line_end_from(text, line_start)).is_some()
}

/// The closing delimiter of an entry body, or the newline before the next
/// entry when the body never closes.
fn entry_body_end(text: &[u16], body_from: usize, close: u16) -> (usize, bool) {
    let open = if close == CLOSE_PAREN {
        OPEN_PAREN
    } else {
        OPEN_BRACE
    };
    let mut depth = 1isize;
    let mut index = body_from;
    while index < text.len() {
        let unit = text[index];
        if unit == BACKSLASH {
            index += 2;
            continue;
        }
        if unit == OPEN_BRACE || unit == open {
            depth += 1;
        } else if unit == CLOSE_BRACE || unit == close {
            depth -= 1;
        } else if unit == NEWLINE && next_entry_follows(text, index) {
            return (index, false);
        }
        if depth == 0 {
            return (index, true);
        }
        index += 1;
    }
    (text.len(), false)
}

/// `ENTRY_HEAD`: `/^@([A-Za-z][A-Za-z0-9_-]*)[ \t]*([{(])/u` within the
/// lookahead window, as `(type length, head length, opening delimiter)`.
fn entry_head(text: &[u16], at: usize) -> Option<(usize, usize, u16)> {
    let window = slice(text, at, at + HEAD_LOOKAHEAD);
    if window.first() != Some(&AT) || !window.get(1).copied().is_some_and(is_ascii_letter) {
        return None;
    }
    let mut index = 2;
    while window.get(index).copied().is_some_and(is_type_unit) {
        index += 1;
    }
    let type_length = index - 1;
    while matches!(window.get(index), Some(&SPACE) | Some(&TAB)) {
        index += 1;
    }
    match window.get(index).copied() {
        Some(opening @ (OPEN_BRACE | OPEN_PAREN)) => Some((type_length, index + 1, opening)),
        _ => None,
    }
}

fn parse_entry(text: &[u16], at: usize) -> (Option<BibtexEntrySpan>, usize) {
    let Some((type_length, head_length, opening)) = entry_head(text, at) else {
        return (None, at + 1);
    };
    let body_from = at + head_length;
    let close = if opening == OPEN_PAREN {
        CLOSE_PAREN
    } else {
        CLOSE_BRACE
    };
    let (end, complete) = entry_body_end(text, body_from, close);
    let key_from = skip_blank(text, body_from, end);
    let mut key_to = key_from;
    while key_to < end
        && text.get(key_to) != Some(&COMMA)
        && !text.get(key_to).copied().is_some_and(is_js_space_unit)
    {
        key_to += 1;
    }
    let fields_from = match index_of_units(text, &[COMMA], key_from) {
        Some(comma) if comma < end => comma + 1,
        _ => end,
    };
    let entry = BibtexEntrySpan {
        entry_type: lossy(&text[at + 1..at + 1 + type_length]).to_ascii_lowercase(),
        type_range: BibtexRange {
            from: at + 1,
            to: at + 1 + type_length,
        },
        key: lossy(slice(text, key_from, key_to)),
        key_range: BibtexRange {
            from: key_from,
            to: (key_from + 1).max(key_to),
        },
        fields: parse_fields(text, fields_from, end),
        complete,
    };
    (Some(entry), if complete { end + 1 } else { end })
}

/// Every entry outside `% novalidate` regions; nothing when the file opts out.
pub fn scan_bibtex_entries(text: &[u16]) -> Vec<BibtexEntrySpan> {
    let mut entries = Vec::new();
    let mut suppressed = false;
    let mut line_start = 0;
    while line_start < text.len() {
        let line_end = line_end_from(text, line_start);
        match novalidate_directive(&text[line_start..line_end]) {
            Some(Novalidate::File) => return Vec::new(),
            Some(directive @ (Novalidate::Begin | Novalidate::End)) => {
                suppressed = directive == Novalidate::Begin;
                line_start = line_end + 1;
                continue;
            }
            None => {}
        }
        let Some(at) = starts_entry(text, line_start, line_end) else {
            line_start = line_end + 1;
            continue;
        };
        let (entry, next) = parse_entry(text, at);
        if let Some(entry) = entry {
            if !suppressed {
                entries.push(entry);
            }
        }
        line_start = next.max(line_end + 1);
    }
    entries
}

fn diagnostic(range: BibtexRange, severity: Severity, message: MessageRef) -> LintDiagnostic {
    LintDiagnostic::catalog(range.from, range.to, severity, message, LintSource::Bibtex)
}

fn check_required_fields(entry: &BibtexEntrySpan) -> Vec<LintDiagnostic> {
    if !entry.complete || entry.key.is_empty() {
        return Vec::new();
    }
    let present: BTreeSet<String> = entry
        .fields
        .iter()
        .map(|field| field.name.clone())
        .collect();
    missing_bibtex_required_fields(&entry.entry_type, &present)
        .into_iter()
        .map(|group| {
            diagnostic(
                entry.key_range,
                Severity::Error,
                msg!(
                    "bibtex.lint.missingRequiredField",
                    "entry" => format!("@{}{{{}}}", entry.entry_type, entry.key),
                    "fields" => group.join(" or ")
                ),
            )
        })
        .collect()
}

fn check_repeated_fields(entry: &BibtexEntrySpan) -> Vec<LintDiagnostic> {
    let mut seen: HashSet<&str> = HashSet::new();
    let mut diagnostics = Vec::new();
    for field in &entry.fields {
        if seen.contains(field.name.as_str()) {
            diagnostics.push(diagnostic(
                BibtexRange {
                    from: field.from,
                    to: field.to,
                },
                Severity::Warning,
                msg!("bibtex.lint.fieldRepeated", "name" => field.name.as_str(), "key" => entry.key.as_str()),
            ));
        }
        seen.insert(field.name.as_str());
    }
    diagnostics
}

/// `YEAR_VALUE`: `/^\d{4}[a-z]?$/u`.
fn valid_year(value: &str) -> bool {
    let bytes = value.as_bytes();
    match bytes.len() {
        4 => bytes.iter().all(u8::is_ascii_digit),
        5 => bytes[..4].iter().all(u8::is_ascii_digit) && bytes[4].is_ascii_lowercase(),
        _ => false,
    }
}

fn check_year(entry: &BibtexEntrySpan) -> Vec<LintDiagnostic> {
    let Some(year) = entry.fields.iter().find(|field| field.name == "year") else {
        return Vec::new();
    };
    if year.value.is_empty() || valid_year(&year.value) {
        return Vec::new();
    }
    vec![diagnostic(
        BibtexRange {
            from: year.value_from,
            to: year.value_to,
        },
        Severity::Warning,
        msg!("bibtex.lint.invalidYear", "year" => year.value.as_str()),
    )]
}

fn entry_diagnostics(entry: &BibtexEntrySpan) -> Vec<LintDiagnostic> {
    if is_bibtex_directive(&entry.entry_type) {
        return Vec::new();
    }
    if bibtex_entry_type(&entry.entry_type).is_none() {
        return vec![diagnostic(
            entry.type_range,
            Severity::Warning,
            msg!("bibtex.lint.unknownEntryType", "type" => entry.entry_type.as_str()),
        )];
    }
    let mut diagnostics = check_required_fields(entry);
    diagnostics.extend(check_repeated_fields(entry));
    diagnostics.extend(check_year(entry));
    diagnostics
}

pub fn lint_bibtex_text(text: &SourceText) -> Vec<LintDiagnostic> {
    let mut diagnostics: Vec<LintDiagnostic> = scan_bibtex_entries(text.units())
        .iter()
        .flat_map(entry_diagnostics)
        .collect();
    diagnostics.sort_by(compare);
    diagnostics
}

#[cfg(test)]
mod tests {
    use super::*;

    fn keys(text: &str) -> Vec<(usize, usize, String)> {
        lint_bibtex_text(&SourceText::new(text.to_string()))
            .into_iter()
            .map(|d| (d.from, d.to, d.key().unwrap_or("").to_string()))
            .collect()
    }

    #[test]
    fn a_complete_article_is_clean() {
        assert!(keys("@article{k, author={A}, title={T}, journal={J}, year={2020}}").is_empty());
    }

    #[test]
    fn missing_fields_mark_the_key() {
        let found = keys("@article{key1, title={T}}");
        assert_eq!(found.len(), 3);
        assert!(found
            .iter()
            .all(|(from, to, key)| (*from, *to) == (9, 13)
                && key == "bibtex.lint.missingRequiredField"));
    }

    #[test]
    fn unknown_types_repeats_and_years() {
        assert_eq!(
            keys("@foo{k,}"),
            vec![(1, 4, "bibtex.lint.unknownEntryType".to_string())]
        );
        let found = keys("@misc{k, year={20x}, note={a}, note={b}}");
        let names: Vec<&str> = found.iter().map(|(_, _, key)| key.as_str()).collect();
        assert_eq!(
            names,
            vec!["bibtex.lint.invalidYear", "bibtex.lint.fieldRepeated"]
        );
    }

    #[test]
    fn an_unclosed_entry_recovers_at_the_next_entry() {
        let entries = scan_bibtex_entries(&oleafly_preflight::text::to_units(
            "@misc{a, note={x}\n@misc{b,}\n",
        ));
        assert_eq!(entries.len(), 2);
        assert!(!entries[0].complete);
        assert!(entries[1].complete);
    }

    #[test]
    fn novalidate_skips_the_file_and_regions() {
        assert!(keys("% novalidate\n@foo{k,}").is_empty());
        assert!(keys("% begin novalidate\n@foo{k,}\n% end novalidate\n").is_empty());
    }

    #[test]
    fn years_follow_the_pattern() {
        assert!(valid_year("2020"));
        assert!(valid_year("2020a"));
        assert!(!valid_year("2020A"));
        assert!(!valid_year("20201"));
        assert!(!valid_year("٢٠٢٠"));
    }
}
