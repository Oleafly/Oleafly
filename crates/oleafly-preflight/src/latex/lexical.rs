use crate::text::{
    index_of_units, is_js_space_unit, is_letter_unit, is_mark_unit, units_eq_str, BACKSLASH,
    CARRIAGE_RETURN, CLOSE_BRACE, NEWLINE, OPEN_BRACE, PERCENT, SPACE, TAB,
};

const AT: u16 = b'@' as u16;
const STAR: u16 = b'*' as u16;
const OPEN_BRACKET: u16 = b'[' as u16;
const CLOSE_BRACKET: u16 = b']' as u16;

const OPAQUE_ENVIRONMENTS: &[&str] = &[
    "verbatim",
    "verbatim*",
    "Verbatim",
    "Verbatim*",
    "lstlisting",
    "minted",
    "comment",
];

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum IgnoredKind {
    Comment,
    VerbatimEnvironment,
    InlineVerbatim,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct IgnoredRange {
    pub from: usize,
    pub to: usize,
    pub kind: IgnoredKind,
    pub complete: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum InlineVerbatimCommand {
    Verb,
    Lstinline,
    Mintinline,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct InlineVerbatimSpan {
    pub from: usize,
    pub to: usize,
    pub command: InlineVerbatimCommand,
    pub complete: bool,
}

pub fn is_command_unit(unit: Option<u16>) -> bool {
    unit.is_some_and(|unit| unit == AT || is_letter_unit(unit) || is_mark_unit(unit))
}

fn inline_whitespace(unit: Option<u16>) -> bool {
    matches!(unit, Some(SPACE) | Some(TAB))
}

fn skip_inline_whitespace(text: &[u16], start: usize) -> usize {
    let mut cursor = start;
    while inline_whitespace(text.get(cursor).copied()) {
        cursor += 1;
    }
    cursor
}

pub fn latex_balanced_group_end(
    text: &[u16],
    start: usize,
    opening: u16,
    closing: u16,
) -> Option<usize> {
    if text.get(start) != Some(&opening) {
        return None;
    }
    let mut depth = 1usize;
    let mut cursor = start + 1;
    while cursor < text.len() {
        let unit = text[cursor];
        if unit == BACKSLASH {
            cursor += 2;
            continue;
        }
        if unit == opening {
            depth += 1;
        } else if unit == closing {
            depth -= 1;
            if depth == 0 {
                return Some(cursor + 1);
            }
        }
        cursor += 1;
    }
    None
}

fn paragraph_end(text: &[u16], start: usize) -> usize {
    let mut cursor = start;
    while let Some(newline) = index_of_units(text, &[NEWLINE], cursor) {
        let mut after = newline + 1;
        while matches!(text.get(after), Some(&(SPACE | TAB | CARRIAGE_RETURN))) {
            after += 1;
        }
        if text.get(after) == Some(&NEWLINE) {
            return newline;
        }
        cursor = newline + 1;
    }
    text.len()
}

pub fn latex_heading_title_brace(text: &[u16], from: usize) -> Option<usize> {
    let mut cursor = from;
    if text.get(cursor) == Some(&OPEN_BRACKET) {
        let end = paragraph_end(text, cursor);
        cursor += 1;
        while cursor < end && text[cursor] != CLOSE_BRACKET {
            cursor = match text[cursor] {
                BACKSLASH => cursor + 2,
                OPEN_BRACE => latex_balanced_group_end(text, cursor, OPEN_BRACE, CLOSE_BRACE)
                    .filter(|after| *after <= end)?,
                _ => cursor + 1,
            };
        }
        if cursor >= end {
            return None;
        }
        cursor += 1;
        while text.get(cursor).copied().is_some_and(is_js_space_unit) {
            cursor += 1;
        }
    }
    (text.get(cursor) == Some(&OPEN_BRACE)).then_some(cursor)
}

pub fn line_end(text: &[u16], start: usize) -> usize {
    index_of_units(text, &[NEWLINE], start).unwrap_or(text.len())
}

fn delimited_body_end(text: &[u16], start: usize) -> Option<(usize, bool)> {
    let first = *text.get(start)?;
    if is_js_space_unit(first) {
        return None;
    }
    let surrogate_pair = (0xd800..=0xdbff).contains(&first)
        && text
            .get(start + 1)
            .is_some_and(|second| (0xdc00..=0xdfff).contains(second));
    let body = start + if surrogate_pair { 2 } else { 1 };
    let delimiter = &text[start..body];
    let end_of_line = line_end(text, body);
    match index_of_units(text, delimiter, body) {
        Some(closing) if closing <= end_of_line => Some((closing + delimiter.len(), true)),
        _ => Some((end_of_line, false)),
    }
}

fn inline_verbatim_head(text: &[u16], start: usize) -> Option<(InlineVerbatimCommand, usize)> {
    if text.get(start) != Some(&BACKSLASH) {
        return None;
    }
    let mut command_end = start + 1;
    while is_command_unit(text.get(command_end).copied()) {
        command_end += 1;
    }
    let name = String::from_utf16_lossy(&text[start + 1..command_end]);
    let command = match name.as_str() {
        "verb" => InlineVerbatimCommand::Verb,
        "lstinline" => InlineVerbatimCommand::Lstinline,
        "mintinline" => InlineVerbatimCommand::Mintinline,
        _ => return None,
    };
    // listings takes a star as its delimiter.
    let star = command != InlineVerbatimCommand::Lstinline && text.get(command_end) == Some(&STAR);
    Some((command, if star { command_end + 1 } else { command_end }))
}

/// listings ends a braced body at the first `}`: it does not nest or read
/// escapes, and it stops with an error at the end of the line.
fn lstinline_body_end(text: &[u16], opening: usize) -> Option<usize> {
    (opening + 1..line_end(text, opening + 1))
        .find(|index| text[*index] == CLOSE_BRACE)
        .map(|close| close + 1)
}

fn listings_verbatim_span(
    text: &[u16],
    start: usize,
    from: usize,
    command: InlineVerbatimCommand,
) -> Option<InlineVerbatimSpan> {
    let mut cursor = skip_inline_whitespace(text, from);
    if text.get(cursor) == Some(&OPEN_BRACKET) {
        match latex_balanced_group_end(text, cursor, OPEN_BRACKET, CLOSE_BRACKET) {
            None => {
                return Some(InlineVerbatimSpan {
                    from: start,
                    to: line_end(text, cursor + 1),
                    command,
                    complete: false,
                });
            }
            Some(option_end) => cursor = skip_inline_whitespace(text, option_end),
        }
    }
    if command == InlineVerbatimCommand::Mintinline {
        let language_end = latex_balanced_group_end(text, cursor, OPEN_BRACE, CLOSE_BRACE)?;
        cursor = skip_inline_whitespace(text, language_end);
    }
    if text.get(cursor) == Some(&OPEN_BRACE) {
        let body_end = if command == InlineVerbatimCommand::Lstinline {
            lstinline_body_end(text, cursor)
        } else {
            latex_balanced_group_end(text, cursor, OPEN_BRACE, CLOSE_BRACE)
        };
        return Some(InlineVerbatimSpan {
            from: start,
            to: body_end.unwrap_or_else(|| line_end(text, cursor + 1)),
            command,
            complete: body_end.is_some(),
        });
    }
    let (to, complete) = delimited_body_end(text, cursor)?;
    Some(InlineVerbatimSpan {
        from: start,
        to,
        command,
        complete,
    })
}

pub fn latex_inline_verbatim_span(text: &[u16], start: usize) -> Option<InlineVerbatimSpan> {
    let (command, cursor) = inline_verbatim_head(text, start)?;
    if command == InlineVerbatimCommand::Verb {
        let (to, complete) = delimited_body_end(text, cursor)?;
        return Some(InlineVerbatimSpan {
            from: start,
            to,
            command,
            complete,
        });
    }
    listings_verbatim_span(text, start, cursor, command)
}

fn simple_braced_value(text: &[u16], start: usize) -> Option<(String, usize)> {
    let opening = skip_inline_whitespace(text, start);
    let end = latex_balanced_group_end(text, opening, OPEN_BRACE, CLOSE_BRACE)?;
    Some((String::from_utf16_lossy(&text[opening + 1..end - 1]), end))
}

fn opaque_environment_range(
    text: &[u16],
    cursor: usize,
    command_end: usize,
) -> Option<(IgnoredRange, usize)> {
    let (environment, environment_to) = simple_braced_value(text, command_end)?;
    if !OPAQUE_ENVIRONMENTS.contains(&environment.as_str()) {
        return None;
    }
    let closing: Vec<u16> = format!("\\end{{{environment}}}").encode_utf16().collect();
    let to = match index_of_units(text, &closing, environment_to) {
        Some(at) => at + closing.len(),
        None => text.len(),
    };
    let complete = to >= closing.len() && text[to - closing.len()..to] == closing[..];
    Some((
        IgnoredRange {
            from: cursor,
            to,
            kind: IgnoredKind::VerbatimEnvironment,
            complete,
        },
        to,
    ))
}

fn lex_ignored_step(text: &[u16], cursor: usize) -> (Option<IgnoredRange>, usize) {
    let unit = text[cursor];
    if unit == PERCENT {
        let to = line_end(text, cursor + 1);
        return (
            Some(IgnoredRange {
                from: cursor,
                to,
                kind: IgnoredKind::Comment,
                complete: text.get(to) == Some(&NEWLINE),
            }),
            to,
        );
    }
    if unit != BACKSLASH {
        return (None, cursor + 1);
    }
    if let Some(inline) = latex_inline_verbatim_span(text, cursor) {
        return (
            Some(IgnoredRange {
                from: inline.from,
                to: inline.to,
                kind: IgnoredKind::InlineVerbatim,
                complete: inline.complete,
            }),
            (cursor + 1).max(inline.to),
        );
    }
    let mut command_end = cursor + 1;
    while is_command_unit(text.get(command_end).copied()) {
        command_end += 1;
    }
    if units_eq_str(&text[cursor + 1..command_end], "begin") {
        if let Some((range, to)) = opaque_environment_range(text, cursor, command_end) {
            return (Some(range), to);
        }
    }
    let next = if command_end > cursor + 1 {
        command_end
    } else {
        text.len().min(cursor + 2)
    };
    (None, next)
}

pub fn latex_ignored_ranges(text: &[u16]) -> Vec<IgnoredRange> {
    let mut ranges = Vec::new();
    let mut cursor = 0;
    while cursor < text.len() {
        let (range, next) = lex_ignored_step(text, cursor);
        if let Some(range) = range {
            ranges.push(range);
        }
        cursor = next;
    }
    ranges
}

pub fn mask_latex_ignored_regions(text: &[u16], ranges: &[IgnoredRange]) -> Vec<u16> {
    let mut out = text.to_vec();
    for range in ranges {
        let to = range.to.min(out.len());
        for unit in out.iter_mut().take(to).skip(range.from) {
            if *unit != NEWLINE {
                *unit = SPACE;
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::text::to_units;

    #[test]
    fn ignored_ranges_cover_comments_and_verbatim_bodies() {
        let text = to_units("\\verb|%|x % c\n\\begin{verbatim}\\label{a}\\end{verbatim}");
        let ranges = latex_ignored_ranges(&text);
        let kinds: Vec<_> = ranges.iter().map(|range| range.kind).collect();
        assert_eq!(
            kinds,
            vec![
                IgnoredKind::InlineVerbatim,
                IgnoredKind::Comment,
                IgnoredKind::VerbatimEnvironment
            ]
        );
        assert_eq!((ranges[0].from, ranges[0].to), (0, 8));
        assert!(ranges[2].complete);
    }

    #[test]
    fn a_star_is_the_delimiter_of_lstinline_only() {
        let span = |source: &str| {
            let text = to_units(source);
            let range = latex_ignored_ranges(&text)[0];
            (range.from, range.to)
        };
        assert_eq!(span("\\lstinline*a*b"), (0, 13));
        assert_eq!(span("\\verb*|a|b"), (0, 9));
    }

    #[test]
    fn escaped_percent_is_not_a_comment() {
        let ranges = latex_ignored_ranges(&to_units("50\\% off"));
        assert!(ranges.is_empty());
    }

    #[test]
    fn masking_keeps_newlines_and_length() {
        let text = to_units("a % x\nb");
        let masked = mask_latex_ignored_regions(&text, &latex_ignored_ranges(&text));
        assert_eq!(String::from_utf16_lossy(&masked), "a    \nb");
    }

    #[test]
    fn balanced_groups_skip_escaped_braces() {
        let text = to_units("{a\\}b}c");
        assert_eq!(
            latex_balanced_group_end(&text, 0, OPEN_BRACE, CLOSE_BRACE),
            Some(6)
        );
    }
}
