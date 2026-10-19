//! Math recognition for Markdown (`packages/editor/src/math-source.ts`,
//! `scanMathExpressions` with `format: "markdown"` and the helpers it
//! reaches). Escaped delimiters, code, comments, tags, link destinations and
//! URLs are skipped; an unterminated opener stops at the end of its line.

use std::sync::LazyLock;

use oleafly_preflight::jsre::JsRegex;
use oleafly_preflight::text::{
    index_of_units, is_js_space_unit, last_index_of_units, starts_with_units, SourceText,
};

use super::{MaskSpan, JS_SPACE_CLASS};

const MAX_SCANNED_EXPRESSIONS: usize = 10_000;

const BACKSLASH: u16 = b'\\' as u16;
const NEWLINE: u16 = b'\n' as u16;
const SPACE: u16 = b' ' as u16;
const TAB: u16 = b'\t' as u16;
const BACKTICK: u16 = b'`' as u16;
const TILDE: u16 = b'~' as u16;
const DOLLAR: u16 = b'$' as u16;
const OPEN_PAREN: u16 = b'(' as u16;
const CLOSE_PAREN: u16 = b')' as u16;
const CLOSE_BRACKET: u16 = b']' as u16;
const LESS_THAN: u16 = b'<' as u16;
const GREATER_THAN: u16 = b'>' as u16;

static PLAIN_URL: LazyLock<JsRegex> =
    LazyLock::new(|| JsRegex::std(&format!(r"\A(?i:https?://|www\.)[^{JS_SPACE_CLASS}<>()]+")));

fn is_digit(unit: Option<u16>) -> bool {
    unit.is_some_and(|unit| (u16::from(b'0')..=u16::from(b'9')).contains(&unit))
}

fn is_escaped(text: &[u16], index: usize) -> bool {
    let mut slashes = 0;
    let mut cursor = index;
    while cursor > 0 && text[cursor - 1] == BACKSLASH {
        slashes += 1;
        cursor -= 1;
    }
    slashes % 2 == 1
}

fn before(text: &[u16], index: usize) -> Option<u16> {
    index.checked_sub(1).and_then(|at| text.get(at).copied())
}

fn starts_at_line_prefix(text: &[u16], index: usize) -> bool {
    let line_start = if index == 0 {
        0
    } else {
        last_index_of_units(text, &[NEWLINE], index - 1).map_or(0, |at| at + 1)
    };
    if line_start > index {
        return true;
    }
    let prefix = &text[line_start..index];
    prefix.len() <= 3 && prefix.iter().all(|&unit| unit == SPACE || unit == TAB)
}

/// `(char, length)` of a fence opening at `index`.
fn fence_at(text: &[u16], index: usize) -> Option<(u16, usize)> {
    if !starts_at_line_prefix(text, index) {
        return None;
    }
    let marker = *text.get(index)?;
    if marker != BACKTICK && marker != TILDE {
        return None;
    }
    let length = text[index..]
        .iter()
        .take_while(|&&unit| unit == marker)
        .count();
    (length >= 3).then_some((marker, length))
}

/// `/^[ \t]{0,3}(`{3,}|~{3,})[ \t]*$/u` on a line.
fn closing_fence(line: &[u16]) -> Option<(u16, usize)> {
    let indent = line
        .iter()
        .take_while(|&&unit| unit == SPACE || unit == TAB)
        .count();
    if indent > 3 {
        return None;
    }
    let marker = *line.get(indent)?;
    if marker != BACKTICK && marker != TILDE {
        return None;
    }
    let length = line[indent..]
        .iter()
        .take_while(|&&unit| unit == marker)
        .count();
    if length < 3 {
        return None;
    }
    line[indent + length..]
        .iter()
        .all(|&unit| unit == SPACE || unit == TAB)
        .then_some((marker, length))
}

fn after_markdown_fence(text: &[u16], index: usize, limit: usize, fence: (u16, usize)) -> usize {
    let mut cursor = match index_of_units(text, &[NEWLINE], index + fence.1) {
        Some(at) if at < limit => at + 1,
        _ => return limit,
    };
    while cursor < limit {
        let end = match index_of_units(text, &[NEWLINE], cursor) {
            Some(at) if at <= limit => at,
            _ => limit,
        };
        if let Some((marker, length)) = closing_fence(&text[cursor..end]) {
            if marker == fence.0 && length >= fence.1 {
                return if end < limit { end + 1 } else { end };
            }
        }
        if end >= limit {
            break;
        }
        cursor = end + 1;
    }
    limit
}

fn after_inline_code(text: &[u16], index: usize, limit: usize) -> usize {
    let mut run = 1;
    while text.get(index + run) == Some(&BACKTICK) {
        run += 1;
    }
    let marker = vec![BACKTICK; run];
    match index_of_units(text, &marker, index + run) {
        Some(close) if close < limit => close + run,
        _ => match index_of_units(text, &[NEWLINE], index + run) {
            Some(line_end) if line_end <= limit => line_end,
            _ => limit,
        },
    }
}

fn after_markdown_link_destination(text: &[u16], opening_paren: usize, limit: usize) -> usize {
    let mut depth = 1usize;
    let mut cursor = opening_paren + 1;
    while cursor < limit {
        let unit = text[cursor];
        if unit == NEWLINE {
            return cursor;
        }
        if !is_escaped(text, cursor) {
            if unit == OPEN_PAREN {
                depth += 1;
            }
            if unit == CLOSE_PAREN {
                depth -= 1;
                if depth == 0 {
                    return cursor + 1;
                }
            }
        }
        cursor += 1;
    }
    limit
}

fn after_markdown_tag(text: &[u16], index: usize, limit: usize) -> usize {
    let close = index_of_units(text, &[GREATER_THAN], index + 1);
    let line_end = index_of_units(text, &[NEWLINE], index + 1);
    match close {
        Some(close) if close < limit && line_end.is_none_or(|line_end| line_end >= close) => {
            close + 1
        }
        _ => index + 1,
    }
}

/// `afterPlainUrl`. The scan always runs to the end of the text, so the
/// anchored match runs on the rest of the string instead of a copy of it.
fn after_plain_url(source: &SourceText, index: usize, limit: usize) -> Option<usize> {
    let unit = source.unit(index)?;
    if !matches!(unit, 0x68 | 0x48 | 0x77 | 0x57) {
        return None;
    }
    let start = source.byte_at(index);
    let found = PLAIN_URL.first_str(&source.as_str()[start..])?;
    Some(source.utf16_at(start + found.end).min(limit))
}

fn markdown_skip_end(source: &SourceText, cursor: usize, to: usize) -> Option<usize> {
    let text = source.units();
    if starts_with_units(text, cursor, "<!--") {
        return Some(
            match index_of_units(text, &[b'-' as u16, b'-' as u16, GREATER_THAN], cursor + 4) {
                Some(end) if end < to => end + 3,
                _ => to,
            },
        );
    }
    let unit = text[cursor];
    if unit == BACKTICK || unit == TILDE {
        if let Some(fence) = fence_at(text, cursor) {
            return Some(after_markdown_fence(text, cursor, to, fence));
        }
    }
    if unit == BACKTICK && !is_escaped(text, cursor) {
        return Some(after_inline_code(text, cursor, to));
    }
    if unit == CLOSE_BRACKET && text.get(cursor + 1) == Some(&OPEN_PAREN) {
        return Some(after_markdown_link_destination(text, cursor + 1, to));
    }
    if unit == LESS_THAN {
        return Some(after_markdown_tag(text, cursor, to));
    }
    after_plain_url(source, cursor, to)
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Opener {
    Dollar,
    DoubleDollar,
    Paren,
    Bracket,
}

impl Opener {
    fn length(self) -> usize {
        match self {
            Self::Dollar => 1,
            _ => 2,
        }
    }

    fn closing(self) -> &'static [u16] {
        const DOLLAR_CLOSE: &[u16] = &[b'$' as u16];
        const DOUBLE_DOLLAR_CLOSE: &[u16] = &[b'$' as u16, b'$' as u16];
        const PAREN_CLOSE: &[u16] = &[b'\\' as u16, b')' as u16];
        const BRACKET_CLOSE: &[u16] = &[b'\\' as u16, b']' as u16];
        match self {
            Self::Dollar => DOLLAR_CLOSE,
            Self::DoubleDollar => DOUBLE_DOLLAR_CLOSE,
            Self::Paren => PAREN_CLOSE,
            Self::Bracket => BRACKET_CLOSE,
        }
    }
}

fn markdown_dollar_can_open(text: &[u16], index: usize) -> bool {
    match text.get(index + 1) {
        Some(&next) => next != DOLLAR && !is_js_space_unit(next),
        None => false,
    }
}

fn markdown_dollar_can_close(text: &[u16], index: usize) -> bool {
    let Some(previous) = before(text, index) else {
        return false;
    };
    !is_js_space_unit(previous) && !is_digit(text.get(index + 1).copied())
}

fn opener_at(text: &[u16], cursor: usize) -> Option<Opener> {
    let unit = text.get(cursor).copied();
    if starts_with_units(text, cursor, "$$")
        && !is_escaped(text, cursor)
        && before(text, cursor) != Some(DOLLAR)
        && text.get(cursor + 2) != Some(&DOLLAR)
    {
        return Some(Opener::DoubleDollar);
    }
    if unit == Some(DOLLAR)
        && !is_escaped(text, cursor)
        && before(text, cursor) != Some(DOLLAR)
        && text.get(cursor + 1) != Some(&DOLLAR)
        && markdown_dollar_can_open(text, cursor)
    {
        return Some(Opener::Dollar);
    }
    if starts_with_units(text, cursor, "\\(") && !is_escaped(text, cursor) {
        return Some(Opener::Paren);
    }
    if starts_with_units(text, cursor, "\\[") && !is_escaped(text, cursor) {
        return Some(Opener::Bracket);
    }
    None
}

fn closes_math(text: &[u16], found: usize, opener: Opener) -> bool {
    match opener {
        Opener::Dollar => {
            before(text, found) != Some(DOLLAR)
                && text.get(found + 1) != Some(&DOLLAR)
                && markdown_dollar_can_close(text, found)
        }
        Opener::DoubleDollar => {
            before(text, found) != Some(DOLLAR) && text.get(found + 2) != Some(&DOLLAR)
        }
        _ => true,
    }
}

fn find_closing_delimiter(
    text: &[u16],
    start: usize,
    limit: usize,
    opener: Opener,
) -> Option<usize> {
    let close = opener.closing();
    let mut cursor = start;
    while cursor < limit {
        let found = index_of_units(text, close, cursor).filter(|&found| found < limit)?;
        if !is_escaped(text, found) && closes_math(text, found, opener) {
            return Some(found);
        }
        cursor = found + close.len().max(1);
    }
    None
}

fn incomplete_end(text: &[u16], body_from: usize, limit: usize) -> usize {
    match index_of_units(text, &[NEWLINE], body_from) {
        Some(line_end) if line_end <= limit => line_end,
        _ => limit,
    }
}

/// `appendMathExpression`: the next cursor, pushing the expression's range.
fn append_expression(
    expressions: &mut Vec<MaskSpan>,
    text: &[u16],
    cursor: usize,
    to: usize,
    opener: Opener,
) -> usize {
    let opener_length = opener.length();
    let body_from = cursor + opener_length;
    if let Some(close_at) = find_closing_delimiter(text, body_from, to, opener) {
        let expression_to = close_at + opener_length;
        expressions.push(MaskSpan {
            from: cursor,
            to: expression_to,
        });
        return expression_to;
    }
    // Unmatched currency such as "$20" is not damaged math.
    if opener == Opener::Dollar && is_digit(text.get(body_from).copied()) {
        return cursor + opener_length;
    }
    let expression_to = incomplete_end(text, body_from, to);
    expressions.push(MaskSpan {
        from: cursor,
        to: expression_to,
    });
    (cursor + opener_length).max(expression_to)
}

/// The `[from, to)` range of every math expression in Markdown `text`.
pub fn scan_markdown_math(source: &SourceText) -> Vec<MaskSpan> {
    let text = source.units();
    let to = text.len();
    let mut expressions = Vec::new();
    let mut cursor = 0;
    while cursor < to && expressions.len() < MAX_SCANNED_EXPRESSIONS {
        if let Some(skipped) = markdown_skip_end(source, cursor, to) {
            cursor = skipped;
            continue;
        }
        match opener_at(text, cursor) {
            Some(opener) => cursor = append_expression(&mut expressions, text, cursor, to, opener),
            None => cursor += 1,
        }
    }
    expressions
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ranges(text: &str) -> Vec<(usize, usize)> {
        scan_markdown_math(&SourceText::new(text.to_string()))
            .into_iter()
            .map(|item| (item.from, item.to))
            .collect()
    }

    #[test]
    fn inline_and_display_math_are_found() {
        assert_eq!(
            ranges("a $x$ b $$y$$ c \\(z\\)"),
            vec![(2, 5), (8, 13), (16, 21)]
        );
    }

    #[test]
    fn currency_code_and_escapes_are_not_math() {
        assert!(ranges("costs $20 and $30").is_empty());
        assert!(ranges("`$x$` and \\$y$").is_empty());
        assert!(ranges("```\n$x$\n```\n").is_empty());
    }

    #[test]
    fn an_unterminated_opener_stops_at_the_line_end() {
        assert_eq!(ranges("a $x\nb"), vec![(2, 4)]);
    }
}
