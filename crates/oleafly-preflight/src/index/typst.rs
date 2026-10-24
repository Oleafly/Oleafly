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
struct CodeFrame {
    line: bool,
    started: bool,
    parens: i64,
    braces: i64,
    quoted: bool,
}

#[derive(Clone, Copy)]
enum Frame {
    Markup { close: bool, brackets: i64 },
    Code(CodeFrame),
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

/// The state of `mask_typst_source`: the masks so far and the nesting of
/// markup and code around the unit being read.
struct Masker<'a> {
    raw: &'a [u16],
    masks: Masks,
    frames: Vec<Frame>,
}

impl Masker<'_> {
    /// Reads one unit of markup and returns the index to continue from.
    fn markup_step(&mut self, i: usize, close: bool, brackets: i64) -> usize {
        let raw = self.raw;
        let unit = raw[i];
        if unit == BACKSLASH {
            return i + 2;
        }
        if let Some(link) = typst_autolink_end(raw, i) {
            self.masks.code[i..link].fill(SPACE);
            return link;
        }
        if let Some(opaque) = opaque_end(raw, i) {
            return blank_opaque(raw, &mut self.masks, i, opaque);
        }
        let top = self.frames.len() - 1;
        if close && unit == CLOSE_BRACKET && brackets == 0 {
            self.frames.pop();
        } else if close && unit == OPEN_BRACKET {
            self.frames[top] = Frame::Markup {
                close,
                brackets: brackets + 1,
            };
        } else if close && unit == CLOSE_BRACKET {
            self.frames[top] = Frame::Markup {
                close,
                brackets: brackets - 1,
            };
        } else if unit == HASH {
            self.frames.push(Frame::Code(CodeFrame {
                line: opens_line_code(raw, i),
                started: false,
                parens: 0,
                braces: 0,
                quoted: false,
            }));
        }
        i + 1
    }

    /// Reads one unit inside a string in code and returns the index to
    /// continue from.
    fn string_step(&mut self, i: usize, frame: CodeFrame) -> usize {
        let raw = self.raw;
        let unit = raw[i];
        let mut cursor = i;
        let mut still_quoted = true;
        if unit != NEWLINE {
            self.masks.code[cursor] = SPACE;
        }
        if unit == BACKSLASH && cursor + 1 < raw.len() {
            cursor += 1;
            if raw[cursor] != NEWLINE {
                self.masks.code[cursor] = SPACE;
            }
        } else if unit == QUOTE {
            still_quoted = false;
        }
        let top = self.frames.len() - 1;
        self.frames[top] = Frame::Code(CodeFrame {
            quoted: still_quoted,
            ..frame
        });
        cursor + 1
    }

    /// Reads one unit of code outside strings and returns the index to
    /// continue from. Leaving the code ends it without moving on.
    fn code_step(&mut self, i: usize, frame: CodeFrame) -> usize {
        let raw = self.raw;
        let unit = raw[i];
        let top = self.frames.len() - 1;
        if let Some(opaque) = opaque_end(raw, i) {
            self.frames[top] = Frame::Code(CodeFrame {
                started: true,
                ..frame
            });
            return blank_opaque(raw, &mut self.masks, i, opaque);
        }
        let CodeFrame {
            line,
            started,
            parens,
            braces,
            ..
        } = frame;
        match unit {
            QUOTE => {
                self.masks.code[i] = SPACE;
                self.frames[top] = Frame::Code(CodeFrame {
                    started: true,
                    quoted: true,
                    ..frame
                });
            }
            OPEN_BRACKET => {
                self.frames[top] = Frame::Code(CodeFrame {
                    started: true,
                    ..frame
                });
                self.frames.push(Frame::Markup {
                    close: true,
                    brackets: 0,
                });
            }
            OPEN_PAREN => {
                self.frames[top] = Frame::Code(CodeFrame {
                    started: true,
                    parens: parens + 1,
                    ..frame
                });
            }
            OPEN_BRACE => {
                self.frames[top] = Frame::Code(CodeFrame {
                    started: true,
                    braces: braces + 1,
                    ..frame
                });
            }
            CLOSE_PAREN if parens > 0 => {
                self.frames[top] = Frame::Code(CodeFrame {
                    parens: parens - 1,
                    ..frame
                });
            }
            CLOSE_BRACE if braces > 0 => {
                self.frames[top] = Frame::Code(CodeFrame {
                    braces: braces - 1,
                    ..frame
                });
            }
            NEWLINE if line => {
                self.frames.pop();
                return i;
            }
            _ if started && !line && parens == 0 && braces == 0 && is_js_space_unit(unit) => {
                self.frames.pop();
                return i;
            }
            _ => {
                if !is_js_space_unit(unit) {
                    self.frames[top] = Frame::Code(CodeFrame {
                        started: true,
                        ..frame
                    });
                }
            }
        }
        i + 1
    }
}

/// `maskTypstSource`: `text` blanks comments and raw text; `code` also blanks
/// string contents and bare URLs in markup. Both keep every newline.
pub fn mask_typst_source(raw: &[u16]) -> (Vec<u16>, Vec<u16>) {
    let mut masker = Masker {
        raw,
        masks: Masks {
            text: raw.to_vec(),
            code: raw.to_vec(),
        },
        frames: vec![Frame::Markup {
            close: false,
            brackets: 0,
        }],
    };
    let mut i = 0;
    while i < raw.len() {
        let top = masker.frames.len() - 1;
        i = match masker.frames[top] {
            Frame::Markup { close, brackets } => masker.markup_step(i, close, brackets),
            Frame::Code(frame) if frame.quoted => masker.string_step(i, frame),
            Frame::Code(frame) => masker.code_step(i, frame),
        };
    }
    (masker.masks.text, masker.masks.code)
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

    fn masks(source: &str) -> (String, String) {
        let (text, code) = mask_typst_source(&to_units(source));
        (
            String::from_utf16_lossy(&text),
            String::from_utf16_lossy(&code),
        )
    }

    #[test]
    fn strings_in_nested_calls_are_masked_but_markup_quotes_are_not() {
        let source = "#f[a \"x\" #g(\"y\") <l>] <m>";
        let (text, code) = masks(source);
        assert_eq!(text, source);
        assert_eq!(code, "#f[a \"x\" #g(   ) <l>] <m>");
    }

    #[test]
    fn urls_and_nested_block_comments_are_masked() {
        let (text, code) =
            masks("see http://a.org/p(q)). <c> // note <d>\n/* a /* b */ <e> */ <f>");
        let tail = format!("). <c>{}\n{}<f>", " ".repeat(12), " ".repeat(20));
        assert_eq!(text, format!("see http://a.org/p(q){tail}"));
        assert_eq!(code, format!("see {}{tail}", " ".repeat(17)));
    }

    #[test]
    fn escaped_quotes_and_raw_text_are_masked() {
        let (text, code) = masks("#f(a, \"q\\\"<z>\") <g> `raw <r>` ```<s>``` <h>");
        assert_eq!(
            text,
            format!("#f(a, \"q\\\"<z>\") <g>{}<h>", " ".repeat(21))
        );
        assert_eq!(
            code,
            format!("#f(a,{}) <g>{}<h>", " ".repeat(9), " ".repeat(21))
        );
    }

    #[test]
    fn comments_inside_code_blocks_are_masked() {
        let (text, code) = masks("#{ let x = \"a\" // <b>\n <c> }  <d>");
        assert_eq!(
            text,
            format!("#{{ let x = \"a\"{}\n <c> }}  <d>", " ".repeat(7))
        );
        assert_eq!(code, format!("#{{ let x ={}\n <c> }}  <d>", " ".repeat(11)));
    }

    #[test]
    fn labels_inside_ref_calls_are_not_definitions() {
        let symbols = analyze("#ref(<a>) <b>");
        let names: Vec<_> = symbols.defs.iter().map(|d| d.name.as_str()).collect();
        assert_eq!(names, vec!["b"]);
    }
}
