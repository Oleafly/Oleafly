//! Typst identifiers, references and autolinks
//! (`packages/editor/src/typst-syntax.ts:14-95`), over UTF-16 units and
//! testing whole code points like the TypeScript `codePointAt` loops.

use oleafly_preflight::text::{
    is_connector, is_letter, is_letter_number, is_mark, is_number, starts_with_units,
};

use super::char_at;

const OPEN_BRACKET: u16 = b'[' as u16;
const CLOSE_BRACKET: u16 = b']' as u16;
const OPEN_PAREN: u16 = b'(' as u16;
const CLOSE_PAREN: u16 = b')' as u16;

fn is_joiner(ch: char) -> bool {
    ch == '\u{200C}' || ch == '\u{200D}'
}

fn identifier_start(ch: char) -> bool {
    is_letter(ch) || is_letter_number(ch) || ch == '_'
}

fn identifier_continue(ch: char) -> bool {
    is_letter(ch) || is_mark(ch) || is_number(ch) || is_connector(ch) || ch == '-' || is_joiner(ch)
}

fn label_start(ch: char) -> bool {
    is_letter(ch) || is_mark(ch) || is_number(ch) || is_connector(ch)
}

fn label_continue(ch: char) -> bool {
    label_start(ch) || ch == '.' || ch == ':' || ch == '-' || is_joiner(ch)
}

fn run_end(text: &[u16], from: usize, start: fn(char) -> bool, rest: fn(char) -> bool) -> usize {
    let Some((ch, length)) = char_at(text, from) else {
        return from;
    };
    if !start(ch) {
        return from;
    }
    let mut end = from + length;
    while let Some((ch, length)) = char_at(text, end) {
        if !rest(ch) {
            break;
        }
        end += length;
    }
    end
}

/// `isTypstIdentifierContinueAt`.
pub fn is_typst_identifier_continue_at(text: &[u16], index: usize) -> bool {
    char_at(text, index).is_some_and(|(ch, _)| identifier_continue(ch))
}

/// `typstIdentifierEnd`.
pub fn typst_identifier_end(text: &[u16], from: usize) -> usize {
    run_end(text, from, identifier_start, identifier_continue)
}

/// `typstReferenceEnd`: a label run without trailing `.` and `:`.
pub fn typst_reference_end(text: &[u16], from: usize) -> usize {
    let mut end = run_end(text, from, label_start, label_continue);
    while end > from && matches!(text[end - 1], 0x2E | 0x3A) {
        end -= 1;
    }
    end
}

fn autolink_character(unit: u16) -> bool {
    unit < 0x80 && {
        let byte = unit as u8;
        byte.is_ascii_alphanumeric() || b"!#$%&*+,-./:;=?@_~'".contains(&byte)
    }
}

/// `typstAutolinkEnd`: an `http://` or `https://` URL whose brackets
/// balance, without trailing punctuation.
pub fn typst_autolink_end(text: &[u16], from: usize) -> Option<usize> {
    if text.get(from) != Some(&u16::from(b'h'))
        || (!starts_with_units(text, from, "http://") && !starts_with_units(text, from, "https://"))
    {
        return None;
    }
    let mut brackets: Vec<u16> = Vec::new();
    let mut end = from;
    while end < text.len() {
        let unit = text[end];
        if unit == OPEN_BRACKET || unit == OPEN_PAREN {
            brackets.push(unit);
        } else if unit == CLOSE_BRACKET || unit == CLOSE_PAREN {
            let wanted = if unit == CLOSE_BRACKET {
                OPEN_BRACKET
            } else {
                OPEN_PAREN
            };
            if brackets.pop() != Some(wanted) {
                break;
            }
        } else if !autolink_character(unit) {
            break;
        }
        end += 1;
    }
    while end > from
        && b"!,.:;?'"
            .iter()
            .any(|&byte| u16::from(byte) == text[end - 1])
    {
        end -= 1;
    }
    Some(end)
}

#[cfg(test)]
mod tests {
    use super::*;
    use oleafly_preflight::text::to_units;

    #[test]
    fn identifiers_references_and_links() {
        let text = to_units("let my-var_2 = 1");
        assert_eq!(typst_identifier_end(&text, 4), 12);
        assert!(!is_typst_identifier_continue_at(&text, 12));
        let reference = to_units("@fig:plot. next");
        assert_eq!(typst_reference_end(&reference, 1), 9);
        let link = to_units("see https://example.com/a_(b). ok");
        assert_eq!(typst_autolink_end(&link, 4), Some(29));
        assert_eq!(typst_autolink_end(&link, 0), None);
    }
}
