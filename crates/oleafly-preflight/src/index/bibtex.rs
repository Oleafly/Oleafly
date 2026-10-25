//! Bibliography keys for the index: the BibTeX scanner of
//! `src/lib/project-intelligence/parse-bibtex.ts` (entry heads, field values
//! and recovery, so an `@` inside a value is never an entry) and Hayagriva
//! entries that have a `type` or a `title`.

use super::{Definition, FileSymbols, SymKind};
use crate::bib::{hayagriva_entry_keys, is_bibtex_directive};
use crate::text::{is_js_space_unit, last_index_of_units, to_units};

const AT: u16 = b'@' as u16;
const COMMA: u16 = b',' as u16;
const EQUALS: u16 = b'=' as u16;
const QUOTE: u16 = b'"' as u16;
const BACKSLASH: u16 = b'\\' as u16;
const OPEN_BRACE: u16 = b'{' as u16;
const CLOSE_BRACE: u16 = b'}' as u16;
const OPEN_PAREN: u16 = b'(' as u16;
const CLOSE_PAREN: u16 = b')' as u16;
const NEWLINE: u16 = b'\n' as u16;

fn is_ascii_letter(unit: u16) -> bool {
    unit < 0x80 && (unit as u8).is_ascii_alphabetic()
}

fn is_name_continue(unit: u16) -> bool {
    unit < 0x80
        && ((unit as u8).is_ascii_alphanumeric() || unit == b'_' as u16 || unit == b'-' as u16)
}

/// `/^@?([A-Za-z][A-Za-z0-9_-]*)\s*/` at `at`: the name's end and the offset
/// after the trailing whitespace.
fn name_at(source: &[u16], at: usize) -> Option<(usize, usize)> {
    if !source.get(at).copied().is_some_and(is_ascii_letter) {
        return None;
    }
    let mut end = at + 1;
    while end < source.len() && is_name_continue(source[end]) {
        end += 1;
    }
    let mut after = end;
    while after < source.len() && is_js_space_unit(source[after]) {
        after += 1;
    }
    Some((end, after))
}

fn closing_for(open: u16) -> u16 {
    if open == OPEN_PAREN {
        CLOSE_PAREN
    } else {
        CLOSE_BRACE
    }
}

fn index_of(source: &[u16], unit: u16, from: usize) -> Option<usize> {
    source
        .iter()
        .skip(from)
        .position(|&candidate| candidate == unit)
        .map(|offset| from + offset)
}

fn skip_whitespace_and_commas(source: &[u16], offset: usize) -> usize {
    let mut cursor = offset;
    while cursor < source.len() && (is_js_space_unit(source[cursor]) || source[cursor] == COMMA) {
        cursor += 1;
    }
    cursor
}

fn looks_like_entry_start(source: &[u16], offset: usize) -> bool {
    if source.get(offset) != Some(&AT) {
        return false;
    }
    let line_start = if offset == 0 {
        0
    } else {
        last_index_of_units(source, &[NEWLINE], offset - 1).map_or(0, |newline| newline + 1)
    };
    if !source[line_start..offset]
        .iter()
        .all(|&unit| is_js_space_unit(unit))
    {
        return false;
    }
    match name_at(source, offset + 1) {
        Some((_, after)) => matches!(source.get(after), Some(&OPEN_BRACE) | Some(&OPEN_PAREN)),
        None => false,
    }
}

fn find_directive_end(source: &[u16], open_offset: usize, open: u16) -> usize {
    let close = closing_for(open);
    let mut depth = 1usize;
    let mut quoted = false;
    let mut cursor = open_offset + 1;
    while cursor < source.len() {
        let unit = source[cursor];
        if unit == BACKSLASH && quoted {
            cursor += 2;
            continue;
        }
        if unit == QUOTE {
            quoted = !quoted;
            cursor += 1;
            continue;
        }
        if !quoted {
            if unit == open {
                depth += 1;
            } else if unit == close {
                depth -= 1;
                if depth == 0 {
                    return cursor + 1;
                }
            }
        }
        cursor += 1;
    }
    source.len()
}

fn braced_field_end(source: &[u16], cursor: usize) -> usize {
    let mut depth = 1usize;
    let mut end = cursor + 1;
    while end < source.len() && depth > 0 {
        if depth == 1 && looks_like_entry_start(source, end) {
            break;
        }
        if source[end] == BACKSLASH {
            end += 2;
            continue;
        }
        if source[end] == OPEN_BRACE {
            depth += 1;
        } else if source[end] == CLOSE_BRACE {
            depth -= 1;
        }
        end += 1;
    }
    end
}

fn quoted_field_next(source: &[u16], cursor: usize) -> usize {
    let mut end = cursor + 1;
    while end < source.len() {
        if looks_like_entry_start(source, end) {
            return end;
        }
        if source[end] == BACKSLASH {
            end += 2;
            continue;
        }
        if source[end] == QUOTE {
            return end + 1;
        }
        end += 1;
    }
    end
}

fn field_value_next(source: &[u16], offset: usize) -> usize {
    let cursor = skip_whitespace_and_commas(source, offset);
    match source.get(cursor) {
        Some(&OPEN_BRACE) => braced_field_end(source, cursor),
        Some(&QUOTE) => quoted_field_next(source, cursor),
        _ => {
            let mut end = cursor;
            while end < source.len() && !matches!(source[end], COMMA | CLOSE_BRACE | CLOSE_PAREN) {
                end += 1;
            }
            end
        }
    }
}

fn nearest(comma: Option<usize>, end: Option<usize>, otherwise: usize) -> usize {
    match (comma, end) {
        (None, None) => otherwise,
        (None, Some(end)) => end,
        (Some(comma), None) => comma,
        (Some(comma), Some(end)) => comma.min(end),
    }
}

/// The position after an entry's field list.
fn parse_entry_fields(source: &[u16], start: usize, close: u16) -> usize {
    let mut position = start;
    while position < source.len() && source[position] != AT {
        position = skip_whitespace_and_commas(source, position);
        if source.get(position) == Some(&close) {
            position += 1;
            break;
        }
        if position >= source.len() || source[position] == AT {
            break;
        }
        let Some((_, after_name)) = name_at(source, position) else {
            position = nearest(
                index_of(source, COMMA, position + 1),
                index_of(source, close, position + 1),
                source.len(),
            );
            continue;
        };
        position = after_name;
        if source.get(position) != Some(&EQUALS) {
            position = nearest(
                index_of(source, COMMA, position),
                index_of(source, close, position),
                source.len(),
            );
            continue;
        }
        position = field_value_next(source, position + 1);
    }
    position
}

fn trimmed(source: &[u16], from: usize, to: usize) -> (usize, usize) {
    let mut start = from;
    let mut end = to;
    while start < end && is_js_space_unit(source[start]) {
        start += 1;
    }
    while end > start && is_js_space_unit(source[end - 1]) {
        end -= 1;
    }
    (start, end)
}

/// `(key, keyFrom, keyTo)` of every entry with a key, in source order.
pub fn bibtex_keys(text: &str) -> Vec<(String, usize, usize)> {
    let source = to_units(text);
    let mut keys = Vec::new();
    let mut cursor = 0;
    while let Some(at) = index_of(&source, AT, cursor) {
        let Some((type_end, open_offset)) = name_at(&source, at + 1) else {
            cursor = at + 1;
            continue;
        };
        let open = match source.get(open_offset) {
            Some(&OPEN_BRACE) => OPEN_BRACE,
            Some(&OPEN_PAREN) => OPEN_PAREN,
            _ => {
                cursor = open_offset + 1;
                continue;
            }
        };
        let kind = String::from_utf16_lossy(&source[at + 1..type_end]);
        if is_bibtex_directive(&kind) {
            cursor = find_directive_end(&source, open_offset, open);
            continue;
        }
        let close = closing_for(open);
        let after_open = open_offset + 1;
        let key_delimiter = source
            .iter()
            .skip(after_open)
            .position(|&unit| unit == COMMA || unit == close || unit == AT)
            .map_or(source.len(), |offset| after_open + offset);
        let (key_from, key_to) = trimmed(&source, after_open, key_delimiter);
        let has_field_list = source.get(key_delimiter) == Some(&COMMA);
        let start = if has_field_list {
            key_delimiter + 1
        } else {
            key_delimiter
        };
        let position = parse_entry_fields(&source, start, close);
        if key_from < key_to {
            keys.push((
                String::from_utf16_lossy(&source[key_from..key_to]),
                key_from,
                key_to,
            ));
        }
        cursor = position.max(at + 1);
    }
    keys
}

pub(super) fn analyze_bibtex(text: &str) -> FileSymbols {
    FileSymbols {
        defs: bibtex_keys(text)
            .into_iter()
            .map(|(name, from, to)| Definition {
                kind: SymKind::Bibentry,
                name,
                from,
                to,
            })
            .collect(),
        uses: Vec::new(),
    }
}

pub(super) fn analyze_hayagriva(text: &str) -> FileSymbols {
    FileSymbols {
        defs: hayagriva_entry_keys(text)
            .into_iter()
            .filter(|entry| entry.is_entry)
            .map(|entry| Definition {
                kind: SymKind::Bibentry,
                to: entry.line_from + crate::text::utf16_len(&entry.key),
                name: entry.key,
                from: entry.line_from,
            })
            .collect(),
        uses: Vec::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_at_sign_in_a_value_is_not_an_entry() {
        let keys =
            bibtex_keys("@misc{a,\n  note = {mail me@example.com},\n}\n@book{b, title = \"x\"}");
        let names: Vec<_> = keys.iter().map(|(key, _, _)| key.as_str()).collect();
        assert_eq!(names, vec!["a", "b"]);
    }

    #[test]
    fn an_unterminated_entry_recovers_at_the_next_entry() {
        let keys = bibtex_keys("@article{x, title = {open\n@book{y, title={z}}");
        let names: Vec<_> = keys.iter().map(|(key, _, _)| key.as_str()).collect();
        assert_eq!(names, vec!["x", "y"]);
    }

    #[test]
    fn directives_and_strings_are_skipped() {
        let keys =
            bibtex_keys("@string{me = \"@fake{no,}\"}\n@comment{@misc{hidden,}}\n@misc{real,}");
        let names: Vec<_> = keys.iter().map(|(key, _, _)| key.as_str()).collect();
        assert_eq!(names, vec!["real"]);
    }
}
