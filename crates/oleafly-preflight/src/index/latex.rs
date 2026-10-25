//! LaTeX labels, `\bibitem` keys and reference uses, the way
//! `analyze-file.ts` re-extracts them: on the text with comments and verbatim
//! masked, reading each key from the original source so a comment inside a
//! group is spliced out.

use std::collections::HashMap;
use std::sync::LazyLock;

use super::{Definition, FileSymbols, Reference, SymKind};
use crate::jsre::JsRegex;
use crate::latex::lexical::{latex_ignored_ranges, mask_latex_ignored_regions};
use crate::mask::mask_comments;
use crate::text::{is_js_space_unit, js_trim, to_units, SourceText};

const BACKSLASH: u16 = b'\\' as u16;
const OPEN_BRACKET: u16 = b'[' as u16;
const CLOSE_BRACKET: u16 = b']' as u16;
const OPEN_BRACE: u16 = b'{' as u16;
const CLOSE_BRACE: u16 = b'}' as u16;
const PERCENT: u16 = b'%' as u16;
const NEWLINE: u16 = b'\n' as u16;
const CARRIAGE_RETURN: u16 = b'\r' as u16;
const COMMA: u16 = b',' as u16;
const SEMICOLON: u16 = b';' as u16;

/// Opening offset → offset just past its closing bracket, for `[]` and `{}`
/// separately, skipping escaped characters.
fn build_command_group_index(source: &[u16]) -> HashMap<usize, usize> {
    let mut closing_by_opening = HashMap::new();
    let mut square = Vec::new();
    let mut brace = Vec::new();
    let mut cursor = 0;
    while cursor < source.len() {
        match source[cursor] {
            BACKSLASH => cursor += 1,
            OPEN_BRACKET => square.push(cursor),
            OPEN_BRACE => brace.push(cursor),
            CLOSE_BRACKET => {
                if let Some(opening) = square.pop() {
                    closing_by_opening.insert(opening, cursor + 1);
                }
            }
            CLOSE_BRACE => {
                if let Some(opening) = brace.pop() {
                    closing_by_opening.insert(opening, cursor + 1);
                }
            }
            _ => {}
        }
        cursor += 1;
    }
    closing_by_opening
}

#[derive(Clone, Copy)]
struct DelimitedGroup {
    open: u16,
    content_from: usize,
    content_to: usize,
    complete: bool,
}

fn command_groups(
    source: &[u16],
    offset: usize,
    closing: &HashMap<usize, usize>,
) -> Vec<DelimitedGroup> {
    let mut groups = Vec::new();
    let mut cursor = offset;
    loop {
        while cursor < source.len() && is_js_space_unit(source[cursor]) {
            cursor += 1;
        }
        let Some(&open) = source.get(cursor) else {
            break;
        };
        if open != OPEN_BRACKET && open != OPEN_BRACE {
            break;
        }
        let from = cursor;
        match closing.get(&from) {
            Some(&to) => {
                groups.push(DelimitedGroup {
                    open,
                    content_from: from + 1,
                    content_to: to - 1,
                    complete: true,
                });
                cursor = to;
            }
            None => {
                groups.push(DelimitedGroup {
                    open,
                    content_from: from + 1,
                    content_to: from + 1,
                    complete: false,
                });
                break;
            }
        }
    }
    groups
}

struct Token {
    name: String,
    from: usize,
    to: usize,
}

fn flush_logical_token(logical: &[(u16, usize)], out: &mut Vec<Token>) {
    let mut from_index = 0;
    let mut to_index = logical.len();
    while from_index < to_index && is_js_space_unit(logical[from_index].0) {
        from_index += 1;
    }
    while to_index > from_index && is_js_space_unit(logical[to_index - 1].0) {
        to_index -= 1;
    }
    let visible = &logical[from_index..to_index];
    let units: Vec<u16> = visible.iter().map(|(unit, _)| *unit).collect();
    let name = String::from_utf16_lossy(&units);
    if let (false, Some(first), Some(last)) = (
        name.is_empty() || name == "*",
        visible.first(),
        visible.last(),
    ) {
        out.push(Token {
            name,
            from: first.1,
            to: last.1 + 1,
        });
    }
}

fn skip_group_comment(source: &[u16], cursor: usize, content_to: usize) -> usize {
    let mut next = cursor + 1;
    while next < content_to && source[next] != NEWLINE && source[next] != CARRIAGE_RETURN {
        next += 1;
    }
    if next < content_to
        && source[next] == CARRIAGE_RETURN
        && source.get(next + 1) == Some(&NEWLINE)
    {
        return next + 2;
    }
    if next < content_to {
        return next + 1;
    }
    next
}

/// The keys in a group of the original source: comments spliced out, split
/// on `,` and `;` when `split`, whitespace trimmed, `*` dropped.
fn logical_group_tokens(source: &[u16], group: DelimitedGroup, split: bool) -> Vec<Token> {
    if !group.complete {
        return Vec::new();
    }
    let mut out = Vec::new();
    let mut logical: Vec<(u16, usize)> = Vec::new();
    let mut cursor = group.content_from;
    while cursor < group.content_to {
        let unit = source[cursor];
        if unit == PERCENT {
            let slashes = (group.content_from..cursor)
                .rev()
                .take_while(|&index| source[index] == BACKSLASH)
                .count();
            if slashes % 2 == 0 {
                cursor = skip_group_comment(source, cursor, group.content_to);
                continue;
            }
        }
        if split && (unit == COMMA || unit == SEMICOLON) {
            flush_logical_token(&logical, &mut out);
            logical.clear();
            cursor += 1;
            continue;
        }
        logical.push((unit, cursor));
        cursor += 1;
    }
    flush_logical_token(&logical, &mut out);
    out
}

static KEYED_DEFINITION: LazyLock<JsRegex> =
    LazyLock::new(|| JsRegex::fancy(r"\\(label|hypertarget)\*?(?![A-Za-z@])"));
static REFERENCE_COMMAND: LazyLock<JsRegex> = LazyLock::new(|| {
    JsRegex::fancy(concat!(
        r"\\(crefrange|Crefrange|cpagerefrange|vpagerefrange|hyperlink|ref|eqref|pageref|autoref",
        r"|cref|Cref|cpageref|vref|Vref|labelcref|nameref|namecref|fref|sref|labelref)\*?(?![A-Za-z@])",
    ))
});
static HYPERREF: LazyLock<JsRegex> =
    LazyLock::new(|| JsRegex::fancy(r"\\hyperref\*?(?![A-Za-z@])"));
static GLOSSARY_ENTRY: LazyLock<JsRegex> =
    LazyLock::new(|| JsRegex::std(r"\\newglossaryentry\s*\{([^}]*)\}"));
static ACRONYM: LazyLock<JsRegex> =
    LazyLock::new(|| JsRegex::std(r"\\newacronym\s*(?:\[[^\]]*\]\s*)?\{([^}]*)\}"));
static BIBITEM: LazyLock<JsRegex> =
    LazyLock::new(|| JsRegex::std(r"\\bibitem\s*(?:\[[^\]]*\]\s*)?\{([^}]*)\}"));

/// `\newglossaryentry`, `\newacronym` (labels in the legacy index) and
/// `\bibitem` keys, from the comment-masked text.
fn legacy_definitions(text: &str, out: &mut Vec<Definition>) {
    let masked = SourceText::new(mask_comments(text));
    let sources: [(&JsRegex, SymKind); 3] = [
        (&GLOSSARY_ENTRY, SymKind::Label),
        (&ACRONYM, SymKind::Label),
        (&BIBITEM, SymKind::Bibentry),
    ];
    for (regex, kind) in sources {
        for found in regex.find_all(&masked).matches {
            let whole = found.text(&masked, 0).unwrap_or("");
            let brace = whole.rfind('{').unwrap_or(0);
            let name_from = masked.utf16_at(found.bytes.start + brace + 1);
            let raw = found.text(&masked, 1).unwrap_or("");
            out.push(Definition {
                kind,
                name: js_trim(raw).to_string(),
                from: name_from,
                to: name_from + crate::text::utf16_len(raw),
            });
        }
    }
}

pub(super) fn analyze(text: &str) -> FileSymbols {
    let units = to_units(text);
    let ignored = latex_ignored_ranges(&units);
    let masked_units = mask_latex_ignored_regions(&units, &ignored);
    let closing = build_command_group_index(&masked_units);
    let masked = SourceText::from_units(masked_units);
    let mut symbols = FileSymbols::default();

    legacy_definitions(text, &mut symbols.defs);

    for found in KEYED_DEFINITION.find_all(&masked).matches {
        let group = command_groups(masked.units(), found.to, &closing)
            .into_iter()
            .find(|group| group.open == OPEN_BRACE);
        let Some(group) = group else {
            continue;
        };
        for token in logical_group_tokens(&units, group, false) {
            symbols.defs.push(Definition {
                kind: SymKind::Label,
                name: token.name,
                from: token.from,
                to: token.to,
            });
        }
    }

    for found in REFERENCE_COMMAND.find_all(&masked).matches {
        let command = found.text(&masked, 1).unwrap_or("");
        let braced: Vec<DelimitedGroup> = command_groups(masked.units(), found.to, &closing)
            .into_iter()
            .filter(|group| group.open == OPEN_BRACE)
            .collect();
        let take = if command.to_lowercase().ends_with("range") {
            2
        } else {
            1
        };
        for group in braced.into_iter().take(take) {
            for token in logical_group_tokens(&units, group, true) {
                symbols.uses.push(Reference {
                    name: token.name,
                    from: token.from,
                    to: token.to,
                    target: None,
                });
            }
        }
    }

    for found in HYPERREF.find_all(&masked).matches {
        let group = command_groups(masked.units(), found.to, &closing)
            .into_iter()
            .find(|group| group.open == OPEN_BRACKET);
        let Some(group) = group else {
            continue;
        };
        for token in logical_group_tokens(&units, group, false) {
            symbols.uses.push(Reference {
                name: token.name,
                from: token.from,
                to: token.to,
                target: None,
            });
        }
    }
    symbols.uses.sort_by_key(|reference| reference.from);
    symbols
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_comment_inside_a_label_group_is_spliced_out() {
        let symbols = analyze("\\label{fig:%x\nplot}");
        assert_eq!(symbols.defs[0].name, "fig:plot");
    }

    #[test]
    fn range_commands_read_two_groups() {
        let symbols = analyze("\\crefrange{a}{b} \\hyperref[sec:x]{text} \\ref*{c}");
        let names: Vec<_> = symbols.uses.iter().map(|u| u.name.as_str()).collect();
        assert_eq!(names, vec!["a", "b", "sec:x", "c"]);
    }

    #[test]
    fn glossary_entries_count_as_labels_and_bibitems_as_keys() {
        let symbols = analyze("\\newglossaryentry{gpu}{name=GPU}\n\\bibitem[S]{smith}");
        let kinds: Vec<_> = symbols
            .defs
            .iter()
            .map(|d| (d.kind, d.name.as_str()))
            .collect();
        assert_eq!(
            kinds,
            vec![(SymKind::Label, "gpu"), (SymKind::Bibentry, "smith")]
        );
    }
}
