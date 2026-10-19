//! Typst labels and references for the index: the editor's Typst masks
//! (`packages/editor/src/typst-syntax.ts`, `maskTypstSource`), the legacy
//! label and `@reference` extraction (`src/lib/index/parse-typst.ts`) and the
//! explicit `#ref(<label>)` uses `analyze-file.ts` adds.

use std::sync::LazyLock;

use super::{Definition, FileSymbols, Reference, SymKind};
use crate::jsre::JsRegex;
use crate::text::{
    index_of_units, is_js_space_unit, starts_with_units, to_units, SourceText, NEWLINE, SPACE,
};

/// `TYPST_LABEL_PATTERN` of the editor (with ZWNJ and ZWJ).
const LABEL_PATTERN: &str = r"[\p{L}\p{M}\p{N}\p{Pc}][\p{L}\p{M}\p{N}\p{Pc}\x{200C}\x{200D}.:-]*";

const BACKSLASH: u16 = b'\\' as u16;
const BACKTICK: u16 = b'`' as u16;
const QUOTE: u16 = b'"' as u16;
const HASH: u16 = b'#' as u16;
const OPEN_BRACKET: u16 = b'[' as u16;
const CLOSE_BRACKET: u16 = b']' as u16;
const OPEN_PAREN: u16 = b'(' as u16;
const CLOSE_PAREN: u16 = b')' as u16;
const OPEN_BRACE: u16 = b'{' as u16;
const CLOSE_BRACE: u16 = b'}' as u16;

const AUTOLINK_TRAILING: &str = "!,.:;?'";
const LINE_CODE_KEYWORDS: &[&str] = &["let", "set", "show", "import", "include"];

fn autolink_character(unit: u16) -> bool {
    char::from_u32(u32::from(unit))
        .is_some_and(|ch| ch.is_ascii_alphanumeric() || "!#$%&*+,-./:;=?@_~'".contains(ch))
}

/// `typstAutolinkEnd`: brackets inside a URL must balance.
pub fn typst_autolink_end(text: &[u16], from: usize) -> Option<usize> {
    if text.get(from) != Some(&(b'h' as u16))
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
        && char::from_u32(u32::from(text[end - 1])).is_some_and(|ch| AUTOLINK_TRAILING.contains(ch))
    {
        end -= 1;
    }
    Some(end)
}

fn block_comment_end(text: &[u16], from: usize) -> usize {
    let mut depth = 0usize;
    let mut i = from;
    while i < text.len() {
        if starts_with_units(text, i, "/*") {
            depth += 1;
            i += 2;
        } else if starts_with_units(text, i, "*/") {
            depth = depth.saturating_sub(1);
            i += 2;
            if depth == 0 {
                return i;
            }
        } else {
            i += 1;
        }
    }
    text.len()
}

/// `typstRawEnd`.
pub fn typst_raw_end(text: &[u16], from: usize) -> usize {
    let mut width = 1;
    while text.get(from + width) == Some(&BACKTICK) {
        width += 1;
    }
    if width == 2 {
        return from + 2;
    }
    let fence = vec![BACKTICK; width];
    match index_of_units(text, &fence, from + width) {
        Some(close) => close + width,
        None => from + width,
    }
}

fn opaque_end(text: &[u16], i: usize) -> Option<usize> {
    if starts_with_units(text, i, "//") {
        return Some(index_of_units(text, &[NEWLINE], i).unwrap_or(text.len()));
    }
    if starts_with_units(text, i, "/*") {
        return Some(block_comment_end(text, i));
    }
    if text[i] == BACKTICK {
        return Some(typst_raw_end(text, i));
    }
    None
}

struct Masks {
    text: Vec<u16>,
    code: Vec<u16>,
}

fn blank_opaque(source: &[u16], masks: &mut Masks, from: usize, to: usize) -> usize {
    let end = to.min(source.len());
    for (index, &unit) in source.iter().enumerate().take(end).skip(from) {
        if unit == NEWLINE {
            continue;
        }
        masks.text[index] = SPACE;
        masks.code[index] = SPACE;
    }
    to
}

#[derive(Clone, Copy)]
enum Frame {
    Markup {
        close: bool,
        brackets: i64,
    },
    Code {
        line: bool,
        started: bool,
        parens: i64,
        braces: i64,
        quoted: bool,
    },
}

fn is_word_unit(unit: u16) -> bool {
    unit < 0x80 && ((unit as u8).is_ascii_alphanumeric() || unit == b'_' as u16)
}

fn opens_line_code(text: &[u16], hash: usize) -> bool {
    let mut start = hash + 1;
    while matches!(text.get(start), Some(&SPACE) | Some(&0x09)) {
        start += 1;
    }
    LINE_CODE_KEYWORDS.iter().any(|word| {
        if !starts_with_units(text, start, word) {
            return false;
        }
        text.get(start + word.len())
            .is_none_or(|&next| !is_word_unit(next))
    })
}

/// `maskTypstSource`: `text` blanks comments and raw text; `code` also blanks
/// string contents and bare URLs in markup. Both keep every newline.
pub fn mask_typst_source(raw: &[u16]) -> (Vec<u16>, Vec<u16>) {
    let mut masks = Masks {
        text: raw.to_vec(),
        code: raw.to_vec(),
    };
    let mut frames = vec![Frame::Markup {
        close: false,
        brackets: 0,
    }];
    let mut i = 0;
    while i < raw.len() {
        let top = frames.len() - 1;
        let unit = raw[i];
        match frames[top] {
            Frame::Markup { close, brackets } => {
                if unit == BACKSLASH {
                    i += 2;
                    continue;
                }
                if let Some(link) = typst_autolink_end(raw, i) {
                    for index in i..link {
                        masks.code[index] = SPACE;
                    }
                    i = link;
                    continue;
                }
                if let Some(opaque) = opaque_end(raw, i) {
                    i = blank_opaque(raw, &mut masks, i, opaque);
                    continue;
                }
                if close && unit == CLOSE_BRACKET && brackets == 0 {
                    frames.pop();
                    i += 1;
                    continue;
                }
                if close && unit == OPEN_BRACKET {
                    frames[top] = Frame::Markup {
                        close,
                        brackets: brackets + 1,
                    };
                    i += 1;
                    continue;
                }
                if close && unit == CLOSE_BRACKET {
                    frames[top] = Frame::Markup {
                        close,
                        brackets: brackets - 1,
                    };
                    i += 1;
                    continue;
                }
                if unit == HASH {
                    frames.push(Frame::Code {
                        line: opens_line_code(raw, i),
                        started: false,
                        parens: 0,
                        braces: 0,
                        quoted: false,
                    });
                }
                i += 1;
            }
            Frame::Code {
                line,
                started,
                parens,
                braces,
                quoted: true,
            } => {
                let mut cursor = i;
                let mut still_quoted = true;
                if unit != NEWLINE {
                    masks.code[cursor] = SPACE;
                }
                if unit == BACKSLASH && cursor + 1 < raw.len() {
                    cursor += 1;
                    if raw[cursor] != NEWLINE {
                        masks.code[cursor] = SPACE;
                    }
                } else if unit == QUOTE {
                    still_quoted = false;
                }
                frames[top] = Frame::Code {
                    line,
                    started,
                    parens,
                    braces,
                    quoted: still_quoted,
                };
                i = cursor + 1;
            }
            Frame::Code {
                line,
                started,
                parens,
                braces,
                quoted: false,
            } => {
                if let Some(opaque) = opaque_end(raw, i) {
                    frames[top] = Frame::Code {
                        line,
                        started: true,
                        parens,
                        braces,
                        quoted: false,
                    };
                    i = blank_opaque(raw, &mut masks, i, opaque);
                    continue;
                }
                let set = |started: bool, parens: i64, braces: i64, quoted: bool| Frame::Code {
                    line,
                    started,
                    parens,
                    braces,
                    quoted,
                };
                if unit == QUOTE {
                    masks.code[i] = SPACE;
                    frames[top] = set(true, parens, braces, true);
                    i += 1;
                    continue;
                }
                if unit == OPEN_BRACKET {
                    frames[top] = set(true, parens, braces, false);
                    frames.push(Frame::Markup {
                        close: true,
                        brackets: 0,
                    });
                    i += 1;
                    continue;
                }
                if unit == OPEN_PAREN {
                    frames[top] = set(true, parens + 1, braces, false);
                    i += 1;
                    continue;
                }
                if unit == OPEN_BRACE {
                    frames[top] = set(true, parens, braces + 1, false);
                    i += 1;
                    continue;
                }
                if unit == CLOSE_PAREN && parens > 0 {
                    frames[top] = set(started, parens - 1, braces, false);
                    i += 1;
                    continue;
                }
                if unit == CLOSE_BRACE && braces > 0 {
                    frames[top] = set(started, parens, braces - 1, false);
                    i += 1;
                    continue;
                }
                if unit == NEWLINE && line {
                    frames.pop();
                    continue;
                }
                if started && !line && parens == 0 && braces == 0 && is_js_space_unit(unit) {
                    frames.pop();
                    continue;
                }
                if !is_js_space_unit(unit) {
                    frames[top] = set(true, parens, braces, false);
                }
                i += 1;
            }
        }
    }
    (masks.text, masks.code)
}

/// `isTypstEscaped`: an odd number of backslashes before `offset`.
fn is_escaped(text: &[u16], offset: usize) -> bool {
    text[..offset]
        .iter()
        .rev()
        .take_while(|&&unit| unit == BACKSLASH)
        .count()
        % 2
        == 1
}

/// `maskQuotedContents` of `analyze-file.ts`: string contents (and escaped
/// characters in them) become spaces, wherever a `"` opens one.
fn mask_quoted_contents(source: &[u16]) -> Vec<u16> {
    let mut chars = source.to_vec();
    let mut quoted = false;
    let mut index = 0;
    while index < chars.len() {
        if !quoted {
            if chars[index] == QUOTE {
                quoted = true;
            }
            index += 1;
            continue;
        }
        let mut next = index;
        if chars[index] == BACKSLASH {
            chars[index] = SPACE;
            if index + 1 < chars.len() {
                next = index + 1;
                if chars[next] != NEWLINE {
                    chars[next] = SPACE;
                }
            }
        } else if chars[index] == QUOTE {
            quoted = false;
        } else if chars[index] != NEWLINE {
            chars[index] = SPACE;
        }
        index = next + 1;
    }
    chars
}

static LABEL: LazyLock<JsRegex> = LazyLock::new(|| JsRegex::std(&format!("<({LABEL_PATTERN})>")));
static AT_USE: LazyLock<JsRegex> = LazyLock::new(|| {
    JsRegex::fancy(&format!(
        r"(?<![\p{{L}}\p{{M}}\p{{N}}\p{{Pc}}])@({LABEL_PATTERN})"
    ))
});
static EXPLICIT_REFERENCE: LazyLock<JsRegex> =
    LazyLock::new(|| JsRegex::std(&format!(r"#(?:ref|link)\s*\(\s*<({LABEL_PATTERN})>")));
static INSIDE_CALL: LazyLock<JsRegex> =
    LazyLock::new(|| JsRegex::std(r"#(?:ref|link|cite)\s*\([^)]*$"));

fn trim_reference(name: &str) -> &str {
    name.trim_end_matches(['.', ':'])
}

pub(super) fn analyze(text: &str) -> FileSymbols {
    let units = to_units(text);
    let source = SourceText::new(text.to_string());
    let (text_mask, code_mask) = mask_typst_source(&units);
    let code = SourceText::from_units(code_mask);
    let mut symbols = FileSymbols::default();

    for found in LABEL.find_all(&code).matches {
        if is_escaped(code.units(), found.from) {
            continue;
        }
        // A label inside `#ref(`, `#link(` or `#cite(` is a use, not a
        // definition.
        let before = source.slice(found.from.saturating_sub(80), found.from);
        if INSIDE_CALL.is_match(&before) {
            continue;
        }
        let (name_from, name_to) = found.group(1).unwrap_or((found.from + 1, found.to - 1));
        symbols.defs.push(Definition {
            kind: SymKind::Label,
            name: found.text(&code, 1).unwrap_or("").to_string(),
            from: name_from,
            to: name_to,
        });
    }

    for found in AT_USE.find_all(&code).matches {
        if is_escaped(code.units(), found.from) {
            continue;
        }
        let name = trim_reference(found.text(&code, 1).unwrap_or(""));
        symbols.uses.push(Reference {
            name: name.to_string(),
            from: found.from,
            to: found.from + 1 + crate::text::utf16_len(name),
            target: None,
        });
    }

    let quoted = SourceText::from_units(mask_quoted_contents(&text_mask));
    for found in EXPLICIT_REFERENCE.find_all(&quoted).matches {
        let (from, to) = found.group(1).unwrap_or((found.from, found.to));
        symbols.uses.push(Reference {
            name: found.text(&quoted, 1).unwrap_or("").to_string(),
            from,
            to,
            target: None,
        });
    }
    symbols.uses.sort_by_key(|reference| reference.from);
    symbols
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strings_and_comments_are_masked_in_code() {
        let (text, code) = mask_typst_source(&to_units("#let x = \"<a>\" // <b>\n<c>"));
        assert_eq!(
            String::from_utf16_lossy(&text),
            format!("#let x = \"<a>\"{}\n<c>", " ".repeat(7))
        );
        assert_eq!(
            String::from_utf16_lossy(&code),
            format!("#let x ={}\n<c>", " ".repeat(13))
        );
    }

    #[test]
    fn labels_inside_ref_calls_are_not_definitions() {
        let symbols = analyze("#ref(<a>) <b>");
        let names: Vec<_> = symbols.defs.iter().map(|d| d.name.as_str()).collect();
        assert_eq!(names, vec!["b"]);
    }
}
