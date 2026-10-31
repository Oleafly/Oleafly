use std::sync::LazyLock;

use oleafly_preflight::jsre::JsRegex;
use oleafly_preflight::text::{index_of_units, is_js_space_unit, last_index_of_units, SourceText};

use super::math_scan::scan_markdown_math;
use super::spelling_words::email_address_pattern;
use super::{blank_into, char_at, JS_SPACE_CLASS};

const NEWLINE: u16 = b'\n' as u16;
const CARRIAGE_RETURN: u16 = b'\r' as u16;
const SPACE: u16 = b' ' as u16;
const TAB: u16 = b'\t' as u16;
const BACKSLASH: u16 = b'\\' as u16;
const BACKTICK: u16 = b'`' as u16;
const OPEN_BRACKET: u16 = b'[' as u16;
const CLOSE_BRACKET: u16 = b']' as u16;
const OPEN_PAREN: u16 = b'(' as u16;
const CLOSE_PAREN: u16 = b')' as u16;
const LESS_THAN: u16 = b'<' as u16;
const GREATER_THAN: u16 = b'>' as u16;
const SLASH: u16 = b'/' as u16;
const COLON: u16 = b':' as u16;
const BANG: u16 = b'!' as u16;
const AT: u16 = b'@' as u16;
const LINE_SEPARATOR: u16 = 0x2028;
const PARAGRAPH_SEPARATOR: u16 = 0x2029;

const TRAILING_PUNCT: &[u8] = b".,:!?)]}'";

const PANDOC_ATTRIBUTES: &str =
    r"\{[ \t]*(?:[#.=][^{}\n]*|-[ \t]*|[\p{L}\p{N}_:-]+[ \t]*=[^{}\n]*)\}";

static FRONTMATTER: LazyLock<JsRegex> = LazyLock::new(|| {
    JsRegex::std(r"\A(?:\x{FEFF})?---[ \t]*\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|\z)")
});
static FENCE_MARKER: LazyLock<JsRegex> =
    LazyLock::new(|| JsRegex::std(r"\A(?:(?:[ \t]{0,3}>[ \t]?)+)?[ \t]{0,3}(`{3,}|~{3,})"));
static FOOTNOTE_DEFINITION: LazyLock<JsRegex> =
    LazyLock::new(|| JsRegex::std(r"\A[ \t]{0,3}\[\^[^\]\n]+\]:[ \t]*"));
static INDENTED_CODE: LazyLock<JsRegex> =
    LazyLock::new(|| JsRegex::std(&format!(r"\A(?: {{4}}|\t)[^{JS_SPACE_CLASS}]")));
static REFERENCE_DEFINITION: LazyLock<JsRegex> = LazyLock::new(|| {
    JsRegex::std(&format!(
        r"\A[ \t]{{0,3}}\[[^\]\n^][^\]\n]*\]:[ \t]*[^{JS_SPACE_CLASS}]"
    ))
});
static HTML_COMMENT: LazyLock<JsRegex> = LazyLock::new(|| JsRegex::std(r"<!--[\s\S]*?-->"));
static HTML_TAG: LazyLock<JsRegex> = LazyLock::new(|| JsRegex::std(r"</?[A-Za-z][^>\n]*>"));
static INLINE_ATTRIBUTES: LazyLock<JsRegex> =
    LazyLock::new(|| JsRegex::fancy(&format!(r"(?<=[\])`]){PANDOC_ATTRIBUTES}")));
static ATX_HEADING_ATTRIBUTES: LazyLock<JsRegex> = LazyLock::new(|| {
    JsRegex::std(&format!(
        r"(?m)^([ \t]{{0,3}}#{{1,6}}[ \t][^\n]*?[ \t]){PANDOC_ATTRIBUTES}[ \t]*\r?$"
    ))
});
static SETEXT_HEADING_ATTRIBUTES: LazyLock<JsRegex> = LazyLock::new(|| {
    JsRegex::fancy(&format!(
        r"(?m)^([^\n]*?[^{JS_SPACE_CLASS}][ \t]+){PANDOC_ATTRIBUTES}[ \t]*(?=\r?\n[ \t]{{0,3}}(?:=+|-+)[ \t]*\r?$)"
    ))
});
static FOOTNOTE_REFERENCE: LazyLock<JsRegex> =
    LazyLock::new(|| JsRegex::std(&format!(r"\[\^[^\[\]{JS_SPACE_CLASS}]+\]")));
static ANGLE_URL: LazyLock<JsRegex> =
    LazyLock::new(|| JsRegex::std(r"(?i)<(?:https?://|mailto:)[^>\n]+>"));
static ANGLE_EMAIL: LazyLock<JsRegex> =
    LazyLock::new(|| JsRegex::std(r"(?i)<[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.\p{L}{2,}>"));
static BARE_URL: LazyLock<JsRegex> =
    LazyLock::new(|| JsRegex::std(&format!(r"(?i)(?:https?://|www\.)[^{JS_SPACE_CLASS}<>()]+")));
static BARE_CITATION: LazyLock<JsRegex> =
    LazyLock::new(|| JsRegex::std(r"(?m)(^|[^\p{L}\p{N}._%+-])@[-\p{L}\p{N}_:.#/+]+"));

fn blank(chars: &mut [u16], from: usize, to: usize) {
    blank_into(chars, from, to);
}

fn snapshot(chars: &[u16]) -> SourceText {
    SourceText::from_units(chars.to_vec())
}

fn lines(text: &[u16]) -> Vec<(usize, usize)> {
    let mut out = Vec::new();
    let mut start = 0;
    for (index, &unit) in text.iter().enumerate() {
        if unit == NEWLINE && index + 1 < text.len() {
            out.push((start, index + 1));
            start = index + 1;
        }
    }
    out.push((start, text.len()));
    out
}

/// Offsets where JavaScript's multiline `^` matches.
fn js_line_starts(text: &[u16]) -> Vec<usize> {
    let mut starts = vec![0];
    for (index, &unit) in text.iter().enumerate() {
        if matches!(
            unit,
            NEWLINE | CARRIAGE_RETURN | LINE_SEPARATOR | PARAGRAPH_SEPARATOR
        ) {
            starts.push(index + 1);
        }
    }
    starts
}

fn is_line_terminator(unit: u16) -> bool {
    matches!(
        unit,
        NEWLINE | CARRIAGE_RETURN | LINE_SEPARATOR | PARAGRAPH_SEPARATOR
    )
}

struct Fence {
    marker: u16,
    length: usize,
}

/// `continuesFootnote`: JavaScript's `$` without `m` is the end of the
/// line string, which still holds its `"\n"`.
fn continues_footnote(line: &[u16]) -> bool {
    line.iter().all(|&unit| unit == SPACE || unit == TAB)
        || line.starts_with(&[SPACE, SPACE])
        || line.first() == Some(&TAB)
}

fn mask_non_prose_line(chars: &mut [u16], line: &str, from: usize, to: usize) {
    if INDENTED_CODE.is_match(line) || REFERENCE_DEFINITION.is_match(line) {
        blank(chars, from, to);
    }
}

fn mask_block_lines(chars: &mut [u16], text: &[u16]) {
    let mut fence: Option<Fence> = None;
    let mut footnote_continuation = false;
    for (from, to) in lines(text) {
        let line_units = &text[from..to];
        let line = String::from_utf16_lossy(line_units);
        let marker = FENCE_MARKER.first_str(&line).and_then(|found| {
            let token = found.group(&line, 1)?;
            let marker = token.encode_utf16().next()?;
            Some(Fence {
                marker,
                length: token.encode_utf16().count(),
            })
        });
        let footnote = FOOTNOTE_DEFINITION
            .first_str(&line)
            .map(|found| line[..found.end].encode_utf16().count());
        if let Some(open) = &fence {
            blank(chars, from, to);
            if marker
                .as_ref()
                .is_some_and(|marker| marker.marker == open.marker && marker.length >= open.length)
            {
                fence = None;
            }
        } else if let Some(marker) = marker {
            fence = Some(marker);
            blank(chars, from, to);
            footnote_continuation = false;
        } else if let Some(length) = footnote {
            blank(chars, from, from + length);
            footnote_continuation = true;
        } else if footnote_continuation && continues_footnote(line_units) {
            // Indented footnote continuations stay visible prose.
        } else {
            footnote_continuation = false;
            mask_non_prose_line(chars, &line, from, to);
        }
    }
}

/// ASCII case folding plus `ſ`, which JavaScript's `iu` folding maps to `s`.
fn folded(unit: u16) -> u16 {
    if unit == 0x017F {
        return u16::from(b's');
    }
    if (u16::from(b'A')..=u16::from(b'Z')).contains(&unit) {
        return unit + 32;
    }
    unit
}

fn matches_folded(text: &[u16], at: usize, name: &str) -> bool {
    name.bytes().enumerate().all(|(offset, byte)| {
        text.get(at + offset)
            .is_some_and(|&unit| folded(unit) == u16::from(byte))
    })
}

fn is_word_unit_iu(unit: Option<u16>) -> bool {
    unit.is_some_and(|unit| {
        unit == 0x017F
            || unit == 0x212A
            || unit == u16::from(b'_')
            || (unit < 0x80 && (unit as u8).is_ascii_alphanumeric())
    })
}

fn raw_html_block_at(text: &[u16], open: usize) -> Option<usize> {
    let name_start = open + 1;
    let name = ["script", "style", "pre"]
        .into_iter()
        .find(|name| matches_folded(text, name_start, name))?;
    let after_name = name_start + name.len();
    if is_word_unit_iu(text.get(after_name).copied()) {
        return None;
    }
    let tag_end = index_of_units(text, &[GREATER_THAN], after_name)?;
    let mut cursor = tag_end + 1;
    while let Some(less_than) = index_of_units(text, &[LESS_THAN], cursor) {
        if text.get(less_than + 1) == Some(&SLASH) && matches_folded(text, less_than + 2, name) {
            let mut end = less_than + 2 + name.len();
            while text.get(end).copied().is_some_and(is_js_space_unit) {
                end += 1;
            }
            if text.get(end) == Some(&GREATER_THAN) {
                return Some(end + 1);
            }
        }
        cursor = less_than + 1;
    }
    None
}

fn mask_raw_html_blocks(chars: &mut [u16]) {
    let source = chars.to_vec();
    let mut index = 0;
    while let Some(open) = index_of_units(&source, &[LESS_THAN], index) {
        match raw_html_block_at(&source, open) {
            Some(end) => {
                blank(chars, open, end);
                index = end;
            }
            None => index = open + 1,
        }
    }
}

fn mask_matches(chars: &mut [u16], pattern: &JsRegex) {
    let source = snapshot(chars);
    for found in pattern.find_all(&source).matches {
        blank(chars, found.from, found.to);
    }
}

fn mask_inline_code(chars: &mut [u16]) {
    let code = chars.to_vec();
    let mut index = 0;
    while index < code.len() {
        if code[index] != BACKTICK {
            index += 1;
            continue;
        }
        let mut run_end = index + 1;
        while code.get(run_end) == Some(&BACKTICK) {
            run_end += 1;
        }
        let delimiter = &code[index..run_end];
        let mut close = index_of_units(&code, delimiter, run_end);
        while let Some(at) = close {
            let touches_backtick = code.get(at.wrapping_sub(1)) == Some(&BACKTICK)
                || code.get(at + delimiter.len()) == Some(&BACKTICK);
            if !touches_backtick {
                break;
            }
            close = index_of_units(&code, delimiter, at + delimiter.len());
        }
        let Some(close) = close else {
            index = run_end;
            continue;
        };
        let end = close + delimiter.len();
        blank(chars, index, end);
        index = end;
    }
}

fn bracketed_span_open(source: &[u16], close: usize) -> Option<usize> {
    let mut depth = 0isize;
    let mut index = close as isize;
    while index >= 0 && source[index as usize] != NEWLINE {
        let unit = source[index as usize];
        if unit == CLOSE_BRACKET {
            depth += 1;
        } else if unit == OPEN_BRACKET {
            depth -= 1;
            if depth == 0 {
                return Some(index as usize);
            }
        }
        index -= 1;
    }
    None
}

/// `/^[ \t]*:::.*$/gmu`: `.*` always ends at a line terminator or the end,
/// where multiline `$` holds, so every JavaScript line start is tried.
fn fenced_divs(source: &[u16]) -> Vec<(usize, usize)> {
    let mut out = Vec::new();
    for start in js_line_starts(source) {
        let mut cursor = start;
        while matches!(source.get(cursor), Some(&SPACE) | Some(&TAB)) {
            cursor += 1;
        }
        if source.get(cursor..cursor + 3) != Some(&[COLON, COLON, COLON][..]) {
            continue;
        }
        let mut end = cursor + 3;
        while end < source.len() && !is_line_terminator(source[end]) {
            end += 1;
        }
        out.push((start, end));
    }
    out
}

fn mask_pandoc_attributes(chars: &mut [u16]) {
    let source = snapshot(chars);
    let units = source.units();
    for found in INLINE_ATTRIBUTES.find_all(&source).matches {
        let at = found.from;
        blank(chars, at, found.to);
        if at == 0 || units[at - 1] != CLOSE_BRACKET {
            continue;
        }
        let Some(open) = bracketed_span_open(units, at - 1) else {
            continue;
        };
        blank(chars, open, open + 1);
        blank(chars, at - 1, at);
    }
    for pattern in [&*ATX_HEADING_ATTRIBUTES, &*SETEXT_HEADING_ATTRIBUTES] {
        for found in pattern.find_all(&source).matches {
            let Some((_, prefix_end)) = found.group(1) else {
                continue;
            };
            blank(chars, prefix_end, found.to);
        }
    }
    for (from, to) in fenced_divs(units) {
        blank(chars, from, to);
    }
}

fn reference_bracket_end(source: &[u16], from: usize) -> Option<usize> {
    let mut cursor = from;
    while cursor < source.len() {
        match source[cursor] {
            CLOSE_BRACKET => return Some(cursor),
            NEWLINE => return None,
            _ => cursor += 1,
        }
    }
    None
}

fn reference_link_end(source: &[u16], start: usize) -> Option<usize> {
    let mut at = start;
    if source.get(start) == Some(&BANG) {
        at += 1;
    }
    if source.get(at) != Some(&OPEN_BRACKET) {
        return None;
    }
    let label = reference_bracket_end(source, at + 1)?;
    if source.get(label + 1) != Some(&OPEN_BRACKET) {
        return None;
    }
    let reference = reference_bracket_end(source, label + 2)?;
    Some(reference + 1)
}

fn mask_reference_links(chars: &mut [u16]) {
    let source = chars.to_vec();
    let mut index = 0;
    while index < source.len() {
        let Some(end) = reference_link_end(&source, index) else {
            index += 1;
            continue;
        };
        let open = last_index_of_units(&source, &[OPEN_BRACKET], end - 1).unwrap_or(0);
        blank(chars, open, end);
        index = end;
    }
}

fn link_destination_end(links: &[u16], index: usize) -> usize {
    let mut depth = 1usize;
    let mut cursor = index + 2;
    while cursor < links.len() && links[cursor] != NEWLINE {
        if links[cursor] == BACKSLASH {
            cursor += 2;
            continue;
        }
        if links[cursor] == OPEN_PAREN {
            depth += 1;
        }
        if links[cursor] == CLOSE_PAREN {
            depth -= 1;
            if depth == 0 {
                cursor += 1;
                break;
            }
        }
        cursor += 1;
    }
    cursor
}

fn mask_link_destinations(chars: &mut [u16]) {
    let links = chars.to_vec();
    let mut index = 0;
    while index + 1 < links.len() {
        if links[index] != CLOSE_BRACKET || links[index + 1] != OPEN_PAREN {
            index += 1;
            continue;
        }
        let cursor = link_destination_end(&links, index);
        blank(chars, index + 1, cursor);
        index = index.max(cursor - 1) + 1;
    }
}

fn is_citation_key_at(text: &[u16], index: usize) -> bool {
    char_at(text, index).is_some_and(|(ch, _)| {
        matches!(ch, '-' | '_' | ':' | '.' | '#' | '/' | '+')
            || oleafly_preflight::text::is_letter(ch)
            || oleafly_preflight::text::is_number(ch)
    })
}

fn mask_bracketed_citations(chars: &mut [u16]) {
    let source = chars.to_vec();
    let mut index = 0;
    while let Some(open) = index_of_units(&source, &[OPEN_BRACKET], index) {
        let mut cursor = open + 1;
        let mut cites = false;
        while cursor < source.len() && source[cursor] != CLOSE_BRACKET && source[cursor] != NEWLINE
        {
            if source[cursor] == AT && is_citation_key_at(&source, cursor + 1) {
                cites = true;
            }
            cursor += 1;
        }
        if cites && source.get(cursor) == Some(&CLOSE_BRACKET) {
            blank(chars, open, cursor + 1);
            index = cursor + 1;
        } else {
            index = open + 1;
        }
    }
}

fn mask_bare_citations(chars: &mut [u16]) {
    let source = snapshot(chars);
    for found in BARE_CITATION.find_all(&source).matches {
        let prefix = found.group(1).map_or(0, |(from, to)| to - from);
        blank(chars, found.from + prefix, found.to);
    }
}

pub fn mask_markdown(text: &[u16]) -> Vec<u16> {
    let mut chars = text.to_vec();
    let source = SourceText::from_units(text.to_vec());
    if let Some(found) = FRONTMATTER.find_first(&source) {
        blank(&mut chars, 0, found.to);
    }
    mask_block_lines(&mut chars, text);
    mask_matches(&mut chars, &HTML_COMMENT);
    mask_raw_html_blocks(&mut chars);
    mask_matches(&mut chars, &HTML_TAG);
    mask_pandoc_attributes(&mut chars);
    mask_inline_code(&mut chars);
    mask_link_destinations(&mut chars);
    mask_reference_links(&mut chars);
    mask_matches(&mut chars, &FOOTNOTE_REFERENCE);
    for pattern in [
        &*ANGLE_URL,
        &*ANGLE_EMAIL,
        &*BARE_URL,
        email_address_pattern(),
    ] {
        mask_matches(&mut chars, pattern);
    }
    // Pandoc citations are references, not visible prose: bracketed
    // multi-cites first, then bare `@key`s (e-mail addresses are gone).
    mask_bracketed_citations(&mut chars);
    mask_bare_citations(&mut chars);
    let math = scan_markdown_math(&snapshot(&chars));
    for expression in math {
        blank(&mut chars, expression.from, expression.to);
    }
    chars
}

pub fn markdown_to_prose(text: &[u16]) -> (Vec<u16>, Vec<u32>) {
    let masked = mask_markdown(text);
    let mut prose = Vec::with_capacity(masked.len());
    let mut map = Vec::with_capacity(masked.len());
    let mut pending = false;
    for (index, &unit) in masked.iter().enumerate() {
        if is_js_space_unit(unit) {
            if !prose.is_empty() {
                pending = true;
            }
            continue;
        }
        if pending {
            pending = false;
            if !(unit < 0x80 && TRAILING_PUNCT.contains(&(unit as u8))) {
                prose.push(SPACE);
                map.push(index as u32);
            }
        }
        prose.push(unit);
        map.push(index as u32);
    }
    (prose, map)
}

#[cfg(test)]
mod tests {
    use super::*;
    use oleafly_preflight::text::to_units;

    fn masked(text: &str) -> String {
        String::from_utf16_lossy(&mask_markdown(&to_units(text)))
    }

    fn prose(text: &str) -> String {
        String::from_utf16_lossy(&markdown_to_prose(&to_units(text)).0)
    }

    #[test]
    fn front_matter_code_and_comments_are_blank() {
        let text = "---\ntitle: x\n---\nBody `code` <!-- note --> end\n```\nfenced\n```\n";
        assert_eq!(prose(text), "Body end");
    }

    #[test]
    fn links_keep_their_text_and_lose_their_targets() {
        assert_eq!(
            prose("See [the docs](https://example.com/a(b)) now."),
            "See [the docs] now."
        );
        assert_eq!(prose("A [ref][id] here."), "A [ref] here.");
    }

    #[test]
    fn citations_math_and_attributes_are_blank() {
        assert_eq!(
            prose("As [see @knuth, p. 3] said, $x+y$ is @doe's."),
            "As said, is's."
        );
        assert_eq!(prose("# Heading {#sec:intro}\n"), "# Heading");
        assert_eq!(
            masked("<script>\nalert(1)\n</SCRIPT> ok"),
            format!("{}\n{}\n{} ok", " ".repeat(8), " ".repeat(8), " ".repeat(9))
        );
    }

    #[test]
    fn the_map_points_at_source_units() {
        let (prose, map) = markdown_to_prose(&to_units("a  `x`  b"));
        assert_eq!(String::from_utf16_lossy(&prose), "a b");
        assert_eq!(map, vec![0, 8, 8]);
    }
}
