use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};
use std::path::Path;

use icu_properties::props::{GeneralCategory, GeneralCategoryGroup, Script};
use icu_properties::CodePointMapData;
use serde::{Deserialize, Serialize};

use crate::project_sources::{read_project_sources_sync, ProjectSourcesRequest, SourceLimits};

const MAX_INCLUDE_DEPTH: usize = 8;
const MAX_SCANNED_EXPRESSIONS: usize = 10_000;
const COMMAND_NAME_WINDOW: usize = 31;

const BACKSLASH: u16 = b'\\' as u16;
const NEWLINE: u16 = b'\n' as u16;
const CARRIAGE_RETURN: u16 = b'\r' as u16;
const TAB: u16 = b'\t' as u16;
const SPACE: u16 = b' ' as u16;
const PERCENT: u16 = b'%' as u16;
const DOLLAR: u16 = b'$' as u16;
const OPEN_BRACE: u16 = b'{' as u16;
const CLOSE_BRACE: u16 = b'}' as u16;
const OPEN_BRACKET: u16 = b'[' as u16;
const CLOSE_BRACKET: u16 = b']' as u16;
const OPEN_PAREN: u16 = b'(' as u16;
const CLOSE_PAREN: u16 = b')' as u16;
const STAR: u16 = b'*' as u16;
const AT: u16 = b'@' as u16;
const DOT: u16 = b'.' as u16;
const HASH: u16 = b'#' as u16;
const QUOTE: u16 = b'"' as u16;
const APOSTROPHE: u16 = b'\'' as u16;
const UNDERSCORE: u16 = b'_' as u16;
const BACKTICK: u16 = b'`' as u16;
const TILDE: u16 = b'~' as u16;
const GREATER: u16 = b'>' as u16;
const LESS: u16 = b'<' as u16;
const BANG: u16 = b'!' as u16;
const LATIN_SMALL_LONG_S: u16 = 0x017f;
const EQUALS: u16 = b'=' as u16;
const AMPERSAND: u16 = b'&' as u16;
const CARET: u16 = b'^' as u16;
const DOTLESS_I: u16 = b'i' as u16;
const DOTLESS_J: u16 = b'j' as u16;
const OPTION_SCAN_LIMIT: usize = 1000;

const HEADING_CMDS: &[&str] = &[
    "part",
    "chapter",
    "section",
    "subsection",
    "subsubsection",
    "paragraph",
    "subparagraph",
];

const OUTSIDE_TEXT_CMDS: &[&str] = &["caption", "captionof", "footnote", "footnotetext", "thanks"];

const FIGURE_ENVS: &[&str] = &["figure", "figure*", "wrapfigure", "SCfigure"];

const DISPLAY_MATH_ENVS: &[&str] = &[
    "displaymath",
    "equation",
    "equation*",
    "align",
    "align*",
    "alignat",
    "alignat*",
    "gather",
    "gather*",
    "multline",
    "multline*",
    "flalign",
    "flalign*",
    "eqnarray",
    "eqnarray*",
    "dmath",
    "dmath*",
];

const OPAQUE_ENVS: &[&str] = &[
    "math",
    "displaymath",
    "equation",
    "align",
    "gather",
    "multline",
    "eqnarray",
    "alignat",
    "flalign",
    "gathered",
    "aligned",
    "split",
    "cases",
    "array",
    "verbatim",
    "Verbatim",
    "lstlisting",
    "minted",
    "alltt",
    "tikzpicture",
    "comment",
    "luacode",
    "pycode",
    "python",
    "asy",
    "filecontents",
];

const OPAQUE_ARG_CMDS: &[&str] = &[
    "label",
    "ref",
    "eqref",
    "pageref",
    "autoref",
    "cref",
    "Cref",
    "vref",
    "nameref",
    "cite",
    "citep",
    "citet",
    "citeauthor",
    "citeyear",
    "citealt",
    "nocite",
    "usepackage",
    "RequirePackage",
    "documentclass",
    "includegraphics",
    "input",
    "include",
    "includeonly",
    "bibliography",
    "bibliographystyle",
    "lstinputlisting",
    "inputminted",
    "addbibresource",
    "printbibliography",
    "url",
    "path",
    "email",
    "hypersetup",
    "geometry",
    "usetikzlibrary",
    "setlength",
    "setlist",
    "titleformat",
    "titlespacing",
    "pagenumbering",
    "pagestyle",
    "thispagestyle",
    "newcommand",
    "renewcommand",
    "providecommand",
    "newenvironment",
    "def",
    "definecolor",
    "graphicspath",
    "usetheme",
    "IEEEkeywords",
    "SI",
    "SIrange",
    "qty",
    "qtyrange",
    "num",
    "numrange",
    "unit",
    "ang",
    "ce",
    "ch",
    "chemfig",
    "gls",
    "Gls",
    "glspl",
    "Glspl",
    "acrshort",
    "Acrshort",
    "acrlong",
    "Acrlong",
    "acrfull",
    "Acrfull",
    "index",
    "vspace",
    "hspace",
    "vskip",
    "hskip",
    "addvspace",
    "addtolength",
    "title",
    "subtitle",
    "author",
    "date",
    "subject",
    "keywords",
    "institute",
    "affiliation",
    "renewenvironment",
];

const REF_ARG_CMDS: &[&str] = &[
    "cpageref",
    "Cpageref",
    "labelcref",
    "labelcpageref",
    "Vref",
    "vpageref",
    "Vpageref",
    "namecref",
    "nameCref",
    "lcnamecref",
    "namecrefs",
    "nameCrefs",
    "fref",
    "Fref",
    "sref",
    "labelref",
    "crefrange",
    "Crefrange",
    "cpagerefrange",
    "Cpagerefrange",
];

const FIRST_ARG_OPAQUE_CMDS: &[&str] = &[
    "textcolor",
    "colorbox",
    "fcolorbox",
    "hyperref",
    "href",
    "bibitem",
    "color",
    "pagecolor",
    "hyperlink",
    "hypertarget",
    "foreignlanguage",
    "selectlanguage",
    "setdefaultlanguage",
    "setmainlanguage",
    "setotherlanguage",
    "setotherlanguages",
    "babelprovide",
    "includesvg",
    "includepdf",
    "includestandalone",
    "subfile",
    "externaldocument",
    "import",
    "subimport",
    "inputfrom",
    "subinputfrom",
    "includefrom",
    "subincludefrom",
    "lstset",
    "tikzset",
    "pgfplotsset",
    "tcbset",
    "pgfkeys",
    "pgfqkeys",
    "setkeys",
    "newgeometry",
    "newcounter",
    "setcounter",
    "addtocounter",
    "stepcounter",
    "refstepcounter",
    "addcontentsline",
    "crefname",
    "Crefname",
    "newtheorem",
    "newacronym",
    "newglossaryentry",
    "DeclareMathOperator",
    "setmainfont",
    "setsansfont",
    "setmonofont",
    "setmathfont",
    "fontspec",
    "newfontfamily",
    "babelfont",
    "fontsize",
    "usefont",
    "newlength",
];

const CONTROL_WORD_ARG_CMDS: &[&str] = &[
    "newcommand",
    "renewcommand",
    "providecommand",
    "setlength",
    "addtolength",
    "newlength",
    "DeclareMathOperator",
    "newfontfamily",
];

const ACCENT_MACROS: &[&str] = &[
    "'", "`", "^", "\"", "~", "=", ".", "u", "v", "H", "c", "d", "b", "r", "k", "t",
];

const LETTER_MACROS: &[&str] = &[
    "ss", "o", "O", "l", "L", "ae", "AE", "oe", "OE", "aa", "AA", "i", "j",
];

const VERBATIM_ENV_NAMES: &[&str] = &["verbatim*", "verbatim", "Verbatim", "lstlisting", "minted"];

const IGNORED_ENVIRONMENTS: &[&str] = &[
    "verbatim",
    "verbatim*",
    "Verbatim",
    "Verbatim*",
    "lstlisting",
    "minted",
    "comment",
];

const INCLUDE_EXTENSIONS: &[&str] = &[".tex", ".ltx", ".latex", ".typ", ".md", ".markdown"];

const IMPORT_COMMANDS: &[&str] = &[
    "import",
    "subimport",
    "inputfrom",
    "subinputfrom",
    "includefrom",
    "subincludefrom",
];

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DocumentStatsRequest {
    pub main_document: String,
    #[serde(default)]
    pub overrides: BTreeMap<String, String>,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentStats {
    pub words: u64,
    pub words_in_text: u64,
    pub words_in_headers: u64,
    pub words_outside_text: u64,
    pub headers: u64,
    pub figures: u64,
    pub math_inline: u64,
    pub math_displayed: u64,
    pub characters: u64,
    pub lines: u64,
}

impl DocumentStats {
    fn add(&mut self, other: &DocumentStats) {
        self.words += other.words;
        self.words_in_text += other.words_in_text;
        self.words_in_headers += other.words_in_headers;
        self.words_outside_text += other.words_outside_text;
        self.headers += other.headers;
        self.figures += other.figures;
        self.math_inline += other.math_inline;
        self.math_displayed += other.math_displayed;
        self.characters += other.characters;
        self.lines += other.lines;
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileDocumentStats {
    pub path: String,
    pub stats: DocumentStats,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentStatsResult {
    pub root: String,
    pub file_count: usize,
    pub unreadable: Vec<String>,
    pub stats: DocumentStats,
    pub files: Vec<FileDocumentStats>,
}

fn is_js_space(unit: u16) -> bool {
    matches!(
        unit,
        0x09..=0x0d
            | 0x20
            | 0xa0
            | 0x1680
            | 0x2000..=0x200a
            | 0x2028
            | 0x2029
            | 0x202f
            | 0x205f
            | 0x3000
            | 0xfeff
    )
}

fn is_js_space_char(character: char) -> bool {
    u32::from(character) <= 0xffff && is_js_space(character as u16)
}

fn js_trim_str(text: &str) -> &str {
    text.trim_matches(is_js_space_char)
}

fn is_ascii_letter(unit: u16) -> bool {
    matches!(unit, 0x41..=0x5a | 0x61..=0x7a)
}

fn is_command_char(unit: u16) -> bool {
    is_ascii_letter(unit) || unit == AT
}

fn code_point_at(text: &[u16], at: usize) -> (u32, usize) {
    let first = text[at];
    if (0xd800..=0xdbff).contains(&first) {
        if let Some(&second) = text.get(at + 1) {
            if (0xdc00..=0xdfff).contains(&second) {
                let code_point =
                    0x10000 + ((u32::from(first) - 0xd800) << 10) + (u32::from(second) - 0xdc00);
                return (code_point, 2);
            }
        }
    }
    (u32::from(first), 1)
}

fn general_category(code_point: u32) -> GeneralCategory {
    CodePointMapData::<GeneralCategory>::new().get32(code_point)
}

fn ascii_byte(code_point: u32) -> Option<u8> {
    u8::try_from(code_point).ok().filter(u8::is_ascii)
}

fn is_letter(code_point: u32) -> bool {
    if let Some(byte) = ascii_byte(code_point) {
        return byte.is_ascii_alphabetic();
    }
    GeneralCategoryGroup::Letter.contains(general_category(code_point))
}

fn is_number(code_point: u32) -> bool {
    if let Some(byte) = ascii_byte(code_point) {
        return byte.is_ascii_digit();
    }
    GeneralCategoryGroup::Number.contains(general_category(code_point))
}

fn is_letter_or_mark(code_point: u32) -> bool {
    if let Some(byte) = ascii_byte(code_point) {
        return byte.is_ascii_alphabetic();
    }
    let category = general_category(code_point);
    GeneralCategoryGroup::Letter.contains(category) || GeneralCategoryGroup::Mark.contains(category)
}

fn is_letter_mark_or_number(code_point: u32) -> bool {
    if let Some(byte) = ascii_byte(code_point) {
        return byte.is_ascii_alphanumeric();
    }
    let category = general_category(code_point);
    GeneralCategoryGroup::Letter.contains(category)
        || GeneralCategoryGroup::Mark.contains(category)
        || GeneralCategoryGroup::Number.contains(category)
}

fn to_units(text: &str) -> Vec<u16> {
    text.encode_utf16().collect()
}

fn js_trim(units: &[u16]) -> &[u16] {
    let mut start = 0;
    let mut end = units.len();
    while start < end && is_js_space(units[start]) {
        start += 1;
    }
    while end > start && is_js_space(units[end - 1]) {
        end -= 1;
    }
    &units[start..end]
}

fn starts_with_ascii(text: &[u16], at: usize, needle: &str) -> bool {
    needle
        .bytes()
        .enumerate()
        .all(|(offset, byte)| text.get(at + offset) == Some(&u16::from(byte)))
}

fn starts_with_ascii_ci(text: &[u16], at: usize, needle: &str) -> bool {
    needle.bytes().enumerate().all(|(offset, byte)| {
        text.get(at + offset).is_some_and(|&unit| {
            unit == u16::from(byte.to_ascii_lowercase())
                || unit == u16::from(byte.to_ascii_uppercase())
        })
    })
}

fn starts_with_units(text: &[u16], at: usize, needle: &[u16]) -> bool {
    text.len() >= at + needle.len() && &text[at..at + needle.len()] == needle
}

fn index_of_unit(text: &[u16], unit: u16, from: usize) -> Option<usize> {
    text.iter()
        .skip(from)
        .position(|&candidate| candidate == unit)
        .map(|offset| offset + from)
}

fn index_of_ascii(text: &[u16], needle: &str, from: usize) -> Option<usize> {
    let bytes = needle.as_bytes();
    if bytes.is_empty() {
        return Some(from.min(text.len()));
    }
    let first = u16::from(bytes[0]);
    let mut at = from;
    while at + bytes.len() <= text.len() {
        if text[at] == first && starts_with_ascii(text, at, needle) {
            return Some(at);
        }
        at += 1;
    }
    None
}

fn last_index_of_unit(text: &[u16], unit: u16, from: isize) -> Option<usize> {
    if text.is_empty() {
        return None;
    }
    let mut at = usize::try_from(from.max(0))
        .unwrap_or(0)
        .min(text.len() - 1);
    loop {
        if text[at] == unit {
            return Some(at);
        }
        if at == 0 {
            return None;
        }
        at -= 1;
    }
}

fn blank_run(chars: &mut [u16], from: usize, to: usize) {
    let end = to.min(chars.len());
    if from >= end {
        return;
    }
    for unit in chars[from..end].iter_mut() {
        if *unit != NEWLINE {
            *unit = SPACE;
        }
    }
}

fn url_prefix_length(text: &[u16], at: usize) -> Option<usize> {
    let ci = |offset: usize, lower: u8| {
        text.get(at + offset).is_some_and(|&unit| {
            unit == u16::from(lower) || unit == u16::from(lower.to_ascii_uppercase())
        })
    };
    if ci(0, b'h') && ci(1, b't') && ci(2, b't') && ci(3, b'p') {
        let long_s = text.get(at + 4) == Some(&LATIN_SMALL_LONG_S);
        if (ci(4, b's') || long_s) && starts_with_ascii(text, at + 5, "://") {
            return Some(8);
        }
        if starts_with_ascii(text, at + 4, "://") {
            return Some(7);
        }
        return None;
    }
    if ci(0, b'w') && ci(1, b'w') && ci(2, b'w') && text.get(at + 3) == Some(&DOT) {
        return Some(4);
    }
    None
}

fn is_url_body(code_point: u32) -> bool {
    if code_point <= 0xffff && is_js_space(code_point as u16) {
        return false;
    }
    !matches!(code_point, 0x3c | 0x3e | 0x7b | 0x7d | 0x5c)
}

fn url_spans(text: &[u16]) -> Vec<Span> {
    let mut spans = Vec::new();
    let mut at = 0;
    while at < text.len() {
        if let Some(prefix) = url_prefix_length(text, at) {
            let mut end = at + prefix;
            while end < text.len() {
                let (code_point, width) = code_point_at(text, end);
                if !is_url_body(code_point) {
                    break;
                }
                end += width;
            }
            if end > at + prefix {
                spans.push(Span { from: at, to: end });
                at = end;
                continue;
            }
        }
        at += code_point_at(text, at).1;
    }
    spans
}

fn is_email_local(code_point: u32) -> bool {
    is_letter_mark_or_number(code_point) || matches!(code_point, 0x2e | 0x5f | 0x25 | 0x2b | 0x2d)
}

fn is_email_domain(code_point: u32) -> bool {
    is_letter_mark_or_number(code_point) || matches!(code_point, 0x2e | 0x2d)
}

fn email_domain_end(text: &[u16], domain_start: usize) -> Option<usize> {
    let mut dots = Vec::new();
    let mut end = domain_start;
    while end < text.len() {
        let (code_point, width) = code_point_at(text, end);
        if !is_email_domain(code_point) {
            break;
        }
        if code_point == u32::from(DOT) {
            dots.push(end);
        }
        end += width;
    }
    for &dot in dots.iter().rev() {
        if dot == domain_start || dot + 1 >= text.len() {
            continue;
        }
        let (first, width) = code_point_at(text, dot + 1);
        if !is_letter(first) {
            continue;
        }
        let run_start = dot + 1 + width;
        let mut run_end = run_start;
        while run_end < text.len() {
            let (code_point, width) = code_point_at(text, run_end);
            if !is_letter_or_mark(code_point) {
                break;
            }
            run_end += width;
        }
        if run_end == run_start
            || (run_end < text.len() && is_number(code_point_at(text, run_end).0))
        {
            continue;
        }
        return Some(run_end);
    }
    None
}

fn code_point_before(text: &[u16], end: usize) -> (u32, usize) {
    let last = text[end - 1];
    if (0xdc00..=0xdfff).contains(&last) && end >= 2 && (0xd800..=0xdbff).contains(&text[end - 2]) {
        return (code_point_at(text, end - 2).0, 2);
    }
    (u32::from(last), 1)
}

fn email_spans(text: &[u16]) -> Vec<Span> {
    let mut spans = Vec::new();
    let mut matched_to = 0;
    let mut search = 0;
    while let Some(at) = index_of_unit(text, AT, search) {
        search = at + 1;
        let mut start = at;
        while start > 0 {
            let (code_point, width) = code_point_before(text, start);
            if !is_email_local(code_point) {
                break;
            }
            start -= width;
        }
        if start == at || start < matched_to {
            continue;
        }
        if let Some(end) = email_domain_end(text, at + 1) {
            spans.push(Span {
                from: start,
                to: end,
            });
            matched_to = end;
            search = end;
        }
    }
    spans
}

fn skip_inline_space(chars: &[u16], mut k: usize) -> usize {
    while k < chars.len() && (chars[k] == SPACE || chars[k] == TAB) {
        k += 1;
    }
    k
}

fn match_group(chars: &[u16], open: usize) -> usize {
    let opener = chars[open];
    let closer = if opener == OPEN_BRACE {
        CLOSE_BRACE
    } else {
        CLOSE_BRACKET
    };
    let mut depth = 0i64;
    let mut k = open;
    while k < chars.len() {
        let unit = chars[k];
        if unit == BACKSLASH {
            k += 2;
            continue;
        }
        if unit == opener {
            depth += 1;
        } else if unit == closer {
            depth -= 1;
            if depth == 0 {
                return k + 1;
            }
        }
        k += 1;
    }
    chars.len()
}

fn control_word_end(chars: &[u16], k: usize) -> usize {
    if chars.get(k) != Some(&BACKSLASH) || !chars.get(k + 1).copied().is_some_and(is_command_char) {
        return k;
    }
    let mut end = k + 1;
    while end < chars.len() && is_command_char(chars[end]) {
        end += 1;
    }
    end
}

fn find_env_end(text: &[u16], from: usize, env: &[u16]) -> usize {
    let mut depth = 1i64;
    let mut at = from;
    while at < text.len() {
        if text[at] != BACKSLASH {
            at += 1;
            continue;
        }
        let (skip, is_begin) = if starts_with_ascii(text, at + 1, "begin") {
            (6, true)
        } else if starts_with_ascii(text, at + 1, "end") {
            (4, false)
        } else {
            at += 1;
            continue;
        };
        let mut cursor = at + skip;
        while cursor < text.len() && is_js_space(text[cursor]) {
            cursor += 1;
        }
        if text.get(cursor) == Some(&OPEN_BRACE) && starts_with_units(text, cursor + 1, env) {
            let mut close = cursor + 1 + env.len();
            if text.get(close) == Some(&STAR) {
                close += 1;
            }
            if text.get(close) == Some(&CLOSE_BRACE) {
                if is_begin {
                    depth += 1;
                } else {
                    depth -= 1;
                    if depth == 0 {
                        return close + 1;
                    }
                }
                at = close + 1;
                continue;
            }
        }
        at += 1;
    }
    text.len()
}

fn is_cite_like(name: &str) -> bool {
    let folded: String = name
        .chars()
        .map(|character| {
            if character == '\u{17f}' {
                's'
            } else {
                character.to_ascii_lowercase()
            }
        })
        .collect();
    folded.starts_with("cite") || folded.ends_with("cite") || folded.ends_with("cites")
}

fn is_setup_command(name: &str) -> bool {
    name.len() > "setup".len() && name.ends_with("setup")
}

fn is_opaque_arg_command(name: &str) -> bool {
    OPAQUE_ARG_CMDS.contains(&name) || REF_ARG_CMDS.contains(&name)
}

fn opaque_brace_prefix_count(name: &str) -> usize {
    match name {
        "usefont" => 4,
        "fcolorbox"
        | "import"
        | "subimport"
        | "inputfrom"
        | "subinputfrom"
        | "includefrom"
        | "subincludefrom"
        | "setkeys"
        | "setcounter"
        | "addtocounter"
        | "addcontentsline"
        | "newacronym"
        | "newglossaryentry"
        | "DeclareMathOperator"
        | "newfontfamily"
        | "babelfont"
        | "fontsize" => 2,
        _ => 1,
    }
}

fn has_option_assignment(inner: &[u16]) -> bool {
    let dollars = inner.iter().filter(|&&unit| unit == DOLLAR).count();
    let unpaired = if dollars % 2 == 1 {
        inner.iter().rposition(|&unit| unit == DOLLAR)
    } else {
        None
    };
    let mut in_math = false;
    for (index, &unit) in inner.iter().enumerate() {
        if unit == DOLLAR && Some(index) != unpaired {
            in_math = !in_math;
        } else if unit == EQUALS && !in_math {
            return true;
        }
    }
    false
}

fn is_name_unit(unit: u16) -> bool {
    unit == AT || is_letter_or_mark(u32::from(unit))
}

fn trim_inline_space(units: &[u16]) -> &[u16] {
    let start = units
        .iter()
        .position(|&unit| unit != SPACE && unit != TAB)
        .unwrap_or(units.len());
    let end = units
        .iter()
        .rposition(|&unit| unit != SPACE && unit != TAB)
        .map_or(start, |at| at + 1);
    &units[start..end]
}

fn accent_letters(inner: &[u16], most: usize) -> bool {
    let letters = trim_inline_space(inner);
    let mut count = 0;
    let mut at = 0;
    while at < letters.len() {
        let (code_point, width) = code_point_at(letters, at);
        if !is_letter(code_point) {
            return false;
        }
        count += 1;
        at += width;
    }
    (1..=most).contains(&count)
}

fn dotless_accent_argument(inner: &[u16]) -> bool {
    let start = skip_inline_space(inner, 0);
    if inner.get(start) != Some(&BACKSLASH)
        || !matches!(
            inner.get(start + 1).copied(),
            Some(DOTLESS_I) | Some(DOTLESS_J)
        )
    {
        return false;
    }
    let mut rest = skip_inline_space(inner, start + 2);
    if inner.get(rest) == Some(&OPEN_BRACE) && inner.get(rest + 1) == Some(&CLOSE_BRACE) {
        rest = skip_inline_space(inner, rest + 2);
    }
    rest == inner.len()
}

fn argument_brace(text: &[u16], open: usize) -> bool {
    if is_escaped(text, open) {
        return true;
    }
    let mut k = open;
    while k > 0 && is_js_space(text[k - 1]) {
        k -= 1;
    }
    if k == 0 {
        return false;
    }
    let previous = text[k - 1];
    if previous == CLOSE_BRACKET || previous == CLOSE_BRACE {
        return true;
    }
    if !is_command_char(previous) {
        return is_escaped(text, k - 1);
    }
    while k > 0 && is_command_char(text[k - 1]) {
        k -= 1;
    }
    k > 0 && text[k - 1] == BACKSLASH && !is_escaped(text, k - 1)
}

fn env_name(text: &[u16], open: usize, end: usize) -> &[u16] {
    if end > open + 1 {
        js_trim(&text[open + 1..end - 1])
    } else {
        &[]
    }
}

fn verbatim_span_end(chars: &[u16], n: usize, name: &str, j: usize) -> usize {
    let mut k = j;
    if chars.get(k) == Some(&STAR) {
        k += 1;
    }
    k = skip_inline_space(chars, k);
    if chars.get(k) == Some(&OPEN_BRACKET) {
        k = match_group(chars, k);
    }
    k = skip_inline_space(chars, k);
    if name == "mintinline" && chars.get(k) == Some(&OPEN_BRACE) {
        k = match_group(chars, k);
        k = skip_inline_space(chars, k);
    }
    if chars.get(k) == Some(&OPEN_BRACE) {
        return match_group(chars, k);
    }
    let Some(&delimiter) = chars.get(k) else {
        return k;
    };
    if delimiter == NEWLINE {
        return k;
    }
    k += 1;
    while k < n && chars[k] != NEWLINE {
        if chars[k] == delimiter && chars[k - 1] != BACKSLASH {
            k += 1;
            break;
        }
        k += 1;
    }
    k
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum MathMode {
    Dollar,
    DoubleDollar,
    Paren,
    Bracket,
}

struct MaskRegion {
    from: usize,
    to: usize,
    blanks: std::ops::Range<usize>,
}

struct LatexRegions<'a> {
    text: &'a [u16],
    chars: Vec<u16>,
    regions: Vec<MaskRegion>,
    blanks: Vec<Span>,
}

impl<'a> LatexRegions<'a> {
    fn collect(text: &'a [u16]) -> Self {
        let mut scan = LatexRegions {
            text,
            chars: text.to_vec(),
            regions: Vec::new(),
            blanks: Vec::new(),
        };
        let urls = url_spans(text);
        let emails = email_spans(text);
        for span in urls.into_iter().chain(emails) {
            scan.push_full(span.from, span.to);
            blank_run(&mut scan.chars, span.from, span.to);
        }
        let n = scan.chars.len();
        let mut i = 0;
        while i < n {
            i = scan.step(i);
        }
        scan.regions.sort_by(|left, right| {
            left.from
                .cmp(&right.from)
                .then_with(|| right.to.cmp(&left.to))
        });
        scan
    }

    fn step(&mut self, i: usize) -> usize {
        match self.chars[i] {
            NEWLINE => i + 1,
            PERCENT => {
                let stop = self.end_of_line(i);
                self.push_full(i, stop);
                stop
            }
            BACKSLASH => self.backslash_region(i),
            DOLLAR => {
                let (mode, opener) = if self.chars.get(i + 1) == Some(&DOLLAR) {
                    (MathMode::DoubleDollar, 2)
                } else {
                    (MathMode::Dollar, 1)
                };
                let stop = self.end_of_math(i + opener, mode);
                self.push_full(i, stop);
                stop
            }
            OPEN_BRACE | CLOSE_BRACE | OPEN_BRACKET | CLOSE_BRACKET | TILDE | AMPERSAND | HASH
            | CARET | UNDERSCORE => {
                self.push_full(i, i + 1);
                i + 1
            }
            _ => i + 1,
        }
    }

    fn push_region(&mut self, raw_from: usize, raw_to: usize, first: usize) {
        let n = self.chars.len();
        let from = raw_from.min(n);
        let to = raw_to.min(n).max(from);
        if to <= from {
            self.blanks.truncate(first);
            return;
        }
        let mut kept = first;
        for index in first..self.blanks.len() {
            let span = self.blanks[index];
            let span_from = span.from.min(n);
            let span_to = span.to.min(n).max(span_from);
            if span_to > span_from {
                self.blanks[kept] = Span {
                    from: span_from,
                    to: span_to,
                };
                kept += 1;
            }
        }
        self.blanks.truncate(kept);
        self.regions.push(MaskRegion {
            from,
            to,
            blanks: first..kept,
        });
    }

    fn push_full(&mut self, from: usize, to: usize) {
        let first = self.blanks.len();
        self.blanks.push(Span { from, to });
        self.push_region(from, to, first);
    }

    fn blank(&mut self, from: usize, to: usize) {
        self.blanks.push(Span { from, to });
    }

    fn end_of_line(&self, k: usize) -> usize {
        index_of_unit(&self.chars, NEWLINE, k).unwrap_or(self.chars.len())
    }

    fn closed_option_end(&self, open: usize) -> Option<usize> {
        let n = self.chars.len();
        let limit = n.min(open + OPTION_SCAN_LIMIT);
        let mut depth = 0i64;
        let mut k = open;
        while k < limit {
            let unit = self.chars[k];
            if unit == BACKSLASH {
                k += 2;
                continue;
            }
            if unit == OPEN_BRACKET {
                depth += 1;
            } else if unit == CLOSE_BRACKET {
                depth -= 1;
                if depth == 0 {
                    return Some(k + 1);
                }
            } else if unit == NEWLINE {
                let mut next = k + 1;
                while next < n && matches!(self.chars[next], SPACE | TAB | CARRIAGE_RETURN) {
                    next += 1;
                }
                if self.chars.get(next) == Some(&NEWLINE) {
                    return None;
                }
            }
            k += 1;
        }
        None
    }

    fn end_of_args(&mut self, mut k: usize, control_word: bool) -> usize {
        if self.chars.get(k) == Some(&STAR) {
            self.blank(k, k + 1);
            k += 1;
        }
        if control_word {
            let start = skip_inline_space(&self.chars, k);
            let end = control_word_end(&self.chars, start);
            if end > start {
                self.blank(start, end);
                k = end;
            }
        }
        loop {
            let start = skip_inline_space(&self.chars, k);
            if !matches!(
                self.chars.get(start),
                Some(&OPEN_BRACE) | Some(&OPEN_BRACKET)
            ) {
                return k;
            }
            let end = match_group(&self.chars, start);
            self.blank(start, end);
            k = end;
        }
    }

    fn end_of_opaque_prefix(&mut self, mut k: usize, name: &str) -> usize {
        if self.chars.get(k) == Some(&STAR) {
            self.blank(k, k + 1);
            k += 1;
        }
        if name == "hyperref" {
            let start = skip_inline_space(&self.chars, k);
            if !matches!(
                self.chars.get(start),
                Some(&OPEN_BRACE) | Some(&OPEN_BRACKET)
            ) {
                return k;
            }
            let end = match_group(&self.chars, start);
            self.blank(start, end);
            return end;
        }
        let braces = opaque_brace_prefix_count(name);
        let control_word = CONTROL_WORD_ARG_CMDS.contains(&name);
        let mut consumed = 0;
        loop {
            let start = skip_inline_space(&self.chars, k);
            let word = if control_word && consumed < braces {
                control_word_end(&self.chars, start)
            } else {
                start
            };
            if word > start {
                self.blank(start, word);
                consumed += 1;
                k = word;
                continue;
            }
            match self.chars.get(start) {
                Some(&OPEN_BRACKET) => {
                    let end = match_group(&self.chars, start);
                    self.blank(start, end);
                    k = end;
                }
                Some(&OPEN_BRACE) if consumed < braces => {
                    let end = match_group(&self.chars, start);
                    self.blank(start, end);
                    consumed += 1;
                    k = end;
                }
                _ => return k,
            }
        }
    }

    fn math_close_at(&self, k: usize, mode: MathMode) -> Option<usize> {
        let unit = self.chars[k];
        let next = self.chars.get(k + 1).copied();
        if unit == NEWLINE {
            return (mode == MathMode::Dollar).then_some(k);
        }
        if unit == BACKSLASH && matches!(next, Some(CLOSE_PAREN) | Some(CLOSE_BRACKET)) {
            return Some(k + 2);
        }
        if unit == DOLLAR {
            if mode == MathMode::DoubleDollar && next == Some(DOLLAR) {
                return Some(k + 2);
            }
            if mode == MathMode::Dollar {
                return Some(k + 1);
            }
        }
        None
    }

    fn end_of_math(&self, start: usize, mode: MathMode) -> usize {
        let n = self.chars.len();
        let mut k = start;
        while k < n {
            if let Some(close) = self.math_close_at(k, mode) {
                return close;
            }
            k = if self.chars[k] == PERCENT {
                self.end_of_line(k)
            } else {
                k + 1
            };
        }
        n
    }

    fn begin_region(&mut self, start: usize, j: usize) -> usize {
        let text = self.text;
        let s = skip_inline_space(&self.chars, j);
        if self.chars.get(s) != Some(&OPEN_BRACE) {
            self.push_full(start, j);
            return j;
        }
        let group_end = match_group(&self.chars, s);
        let mut env = env_name(text, s, group_end);
        if env.last() == Some(&STAR) {
            env = &env[..env.len() - 1];
        }
        if OPAQUE_ENVS.contains(&String::from_utf16_lossy(env).as_str()) {
            let env_end = find_env_end(text, group_end, env);
            self.push_full(start, env_end);
            return env_end;
        }
        let first = self.blanks.len();
        self.blank(start, j);
        let end = self.end_of_args(j, false);
        self.push_region(start, end, first);
        end
    }

    fn named_command_region(&mut self, start: usize, j: usize, name: &str) -> usize {
        if matches!(name, "verb" | "Verb" | "lstinline" | "mintinline") {
            let k = verbatim_span_end(&self.chars, self.chars.len(), name, j);
            self.push_full(start, k);
            return k.max(j);
        }
        if name == "begin" {
            return self.begin_region(start, j);
        }
        let first = self.blanks.len();
        self.blank(start, j);
        if name == "end" {
            let end = self.end_of_args(j, false);
            self.push_region(start, end, first);
            return end;
        }
        if is_opaque_arg_command(name) || is_cite_like(name) {
            let end = self.end_of_args(j, CONTROL_WORD_ARG_CMDS.contains(&name));
            self.push_region(start, end, first);
            return end;
        }
        if FIRST_ARG_OPAQUE_CMDS.contains(&name) || is_setup_command(name) {
            let end = self.end_of_opaque_prefix(j, name);
            self.push_region(start, end, first);
            return end;
        }
        let option = skip_inline_space(&self.chars, j);
        if self.chars.get(option) == Some(&OPEN_BRACKET) {
            if let Some(end) = self.closed_option_end(option) {
                if has_option_assignment(&self.chars[option + 1..end - 1]) {
                    self.blank(option, end);
                    self.push_region(start, end, first);
                    return end;
                }
            }
        }
        self.push_region(start, j, first);
        j
    }

    fn letter_macro_end(&self, k: usize) -> usize {
        if self.chars.get(k) == Some(&OPEN_BRACE) && self.chars.get(k + 1) == Some(&CLOSE_BRACE) {
            k + 2
        } else {
            skip_inline_space(&self.chars, k)
        }
    }

    fn accent_argument(&self, k: usize, control_word: bool, tie: bool) -> Option<usize> {
        let at = if control_word {
            skip_inline_space(&self.chars, k)
        } else {
            k
        };
        let unit = *self.chars.get(at)?;
        if unit == OPEN_BRACE {
            let end = match_group(&self.chars, at);
            let inner = if end > at + 1 {
                &self.chars[at + 1..end - 1]
            } else {
                &[]
            };
            let most = if tie { 2 } else { 1 };
            return (accent_letters(inner, most) || dotless_accent_argument(inner)).then_some(end);
        }
        if unit == BACKSLASH
            && control_word_end(&self.chars, at) == at + 2
            && matches!(self.chars[at + 1], DOTLESS_I | DOTLESS_J)
        {
            return Some(self.letter_macro_end(at + 2));
        }
        is_letter(u32::from(unit)).then_some(at + 1)
    }

    fn add_construct(&mut self, from: usize, to: usize) -> usize {
        let wrapped = from > 0
            && self.chars[from - 1] == OPEN_BRACE
            && self.chars.get(to) == Some(&CLOSE_BRACE)
            && !argument_brace(self.text, from - 1);
        let (start, end) = if wrapped {
            (from - 1, to + 1)
        } else {
            (from, to)
        };
        self.push_full(start, end);
        end
    }

    fn accent_construct(&mut self, start: usize, j: usize, name: &str) -> Option<usize> {
        if LETTER_MACROS.contains(&name) {
            let end = self.letter_macro_end(j);
            return Some(self.add_construct(start, end));
        }
        if name == "-" || name == "/" {
            return Some(self.add_construct(start, j));
        }
        if !ACCENT_MACROS.contains(&name) {
            return None;
        }
        let control_word = name.bytes().any(|byte| byte.is_ascii_alphabetic());
        let end = self.accent_argument(j, control_word, name == "t")?;
        Some(self.add_construct(start, end))
    }

    fn backslash_region(&mut self, start: usize) -> usize {
        let next = self.chars.get(start + 1).copied();
        if matches!(next, Some(OPEN_PAREN) | Some(OPEN_BRACKET)) {
            let mode = if next == Some(OPEN_PAREN) {
                MathMode::Paren
            } else {
                MathMode::Bracket
            };
            let stop = self.end_of_math(start + 2, mode);
            self.push_full(start, stop);
            return stop;
        }
        if next == Some(BACKSLASH) {
            let first = self.blanks.len();
            self.blank(start, start + 2);
            let mut k = skip_inline_space(&self.chars, start + 2);
            if self.chars.get(k) == Some(&OPEN_BRACKET) {
                let end = match_group(&self.chars, k);
                self.blank(k, end);
                k = end;
            }
            self.push_region(start, k, first);
            return k;
        }
        if !next.is_some_and(is_name_unit) {
            let mut buffer = [0u8; 4];
            let symbol = match next.and_then(|unit| char::from_u32(u32::from(unit))) {
                Some(character) => &*character.encode_utf8(&mut buffer),
                None => "",
            };
            if let Some(end) = self.accent_construct(start, start + 2, symbol) {
                return end;
            }
            self.push_full(start, start + 2);
            return start + 2;
        }
        let n = self.chars.len();
        let mut j = start + 1;
        while j < n && is_name_unit(self.chars[j]) {
            j += 1;
        }
        let name = String::from_utf16_lossy(&self.text[start + 1..j]);
        match self.accent_construct(start, j, &name) {
            Some(end) => end,
            None => self.named_command_region(start, j, &name),
        }
    }
}

pub(crate) fn mask_latex(text: &[u16]) -> Vec<u16> {
    let scan = LatexRegions::collect(text);
    let mut out = text.to_vec();
    let mut applied = 0;
    for region in &scan.regions {
        if region.to <= applied {
            continue;
        }
        for span in &scan.blanks[region.blanks.clone()] {
            let from = span.from.max(applied);
            if span.to > from {
                blank_run(&mut out, from, span.to);
            }
        }
        applied = region.to;
    }
    out
}

fn is_trailing_punct(unit: u16) -> bool {
    matches!(
        unit,
        DOT | 0x2c
            | 0x3b
            | 0x3a
            | BANG
            | 0x3f
            | CLOSE_PAREN
            | CLOSE_BRACKET
            | CLOSE_BRACE
            | APOSTROPHE
    )
}

fn prose_length(masked: &[u16]) -> u64 {
    let mut count = 0u64;
    let mut pending = false;
    for &unit in masked {
        if matches!(unit, SPACE | NEWLINE | TAB | CARRIAGE_RETURN) {
            if count > 0 {
                pending = true;
            }
            continue;
        }
        if pending {
            pending = false;
            if !is_trailing_punct(unit) {
                count += 1;
            }
        }
        count += 1;
    }
    count
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum WordClass {
    Letter,
    Ideograph,
    Clustered,
    Mark,
    Other,
}

const IDEOGRAPHIC_SCRIPTS: [Script; 3] = [Script::Han, Script::Hiragana, Script::Katakana];
const CLUSTERED_SCRIPTS: [Script; 5] = [
    Script::Thai,
    Script::Lao,
    Script::Khmer,
    Script::Myanmar,
    Script::Tibetan,
];

fn script_of(code_point: u32) -> Script {
    CodePointMapData::<Script>::new().get32(code_point)
}

fn word_class(code_point: u32) -> WordClass {
    if let Ok(unit) = u8::try_from(code_point) {
        if unit.is_ascii() {
            return if unit.is_ascii_alphabetic() {
                WordClass::Letter
            } else {
                WordClass::Other
            };
        }
    }
    let category = CodePointMapData::<GeneralCategory>::new().get32(code_point);
    if GeneralCategoryGroup::Mark.contains(category) {
        return WordClass::Mark;
    }
    if !GeneralCategoryGroup::Letter.contains(category) {
        return WordClass::Other;
    }
    let script = script_of(code_point);
    if IDEOGRAPHIC_SCRIPTS.contains(&script) {
        WordClass::Ideograph
    } else if CLUSTERED_SCRIPTS.contains(&script) {
        WordClass::Clustered
    } else {
        WordClass::Letter
    }
}

fn is_word_joiner(unit: u16) -> bool {
    matches!(
        unit,
        APOSTROPHE | 0x2019 | 0x02bc | 0x05f3 | 0x05f4 | 0x00b7 | 0x00ad | 0x200c | 0x200d
    )
}

fn run_end(masked: &[u16], mut at: usize) -> usize {
    while at < masked.len() {
        let (code_point, length) = code_point_at(masked, at);
        if !matches!(word_class(code_point), WordClass::Letter | WordClass::Mark) {
            break;
        }
        at += length;
    }
    at
}

fn joiner_end(masked: &[u16], at: usize) -> Option<usize> {
    let &unit = masked.get(at)?;
    if unit == QUOTE {
        let next = at + 1;
        return (next < masked.len() && script_of(code_point_at(masked, next).0) == Script::Hebrew)
            .then_some(next);
    }
    let mut end = at;
    while end < masked.len() && is_word_joiner(masked[end]) {
        end += 1;
    }
    (end > at).then_some(end)
}

fn word_end(masked: &[u16], start: usize) -> usize {
    let mut end = run_end(masked, start);
    while let Some(next) = joiner_end(masked, end) {
        if next >= masked.len() || word_class(code_point_at(masked, next).0) != WordClass::Letter {
            break;
        }
        end = run_end(masked, next);
    }
    end
}

fn clustered_end(masked: &[u16], mut at: usize) -> usize {
    while at < masked.len() {
        let (code_point, length) = code_point_at(masked, at);
        let class = word_class(code_point);
        let joins = matches!(class, WordClass::Clustered)
            || (class == WordClass::Mark && CLUSTERED_SCRIPTS.contains(&script_of(code_point)));
        if !joins {
            break;
        }
        at += length;
    }
    at
}

fn word_spans(masked: &[u16]) -> Vec<(usize, usize)> {
    let mut spans = Vec::new();
    let mut at = 0;
    while at < masked.len() {
        let (code_point, length) = code_point_at(masked, at);
        let end = match word_class(code_point) {
            WordClass::Letter => word_end(masked, at),
            WordClass::Ideograph => at + length,
            WordClass::Clustered => clustered_end(masked, at + length),
            WordClass::Mark | WordClass::Other => {
                at += length;
                continue;
            }
        };
        spans.push((at, end));
        at = end;
    }
    spans
}

fn word_starts(masked: &[u16]) -> Vec<usize> {
    word_spans(masked)
        .into_iter()
        .map(|(start, _)| start)
        .collect()
}

fn non_blank_lines(masked: &[u16]) -> u64 {
    masked
        .split(|&unit| unit == NEWLINE)
        .filter(|line| line.iter().any(|&unit| !is_js_space(unit)))
        .count() as u64
}

#[derive(Debug, Clone, Copy)]
struct Span {
    from: usize,
    to: usize,
}

fn in_spans(spans: &[Span], offset: usize) -> bool {
    let mut low = 0usize;
    let mut high = spans.len();
    while low < high {
        let mid = (low + high) / 2;
        let span = spans[mid];
        if offset < span.from {
            high = mid;
        } else if offset >= span.to {
            low = mid + 1;
        } else {
            return true;
        }
    }
    false
}

fn group_end(text: &[u16], open: usize) -> Option<usize> {
    let opener = text[open];
    let closer = if opener == OPEN_BRACE {
        CLOSE_BRACE
    } else {
        CLOSE_BRACKET
    };
    let mut depth = 0i64;
    let mut i = open;
    while i < text.len() {
        let unit = text[i];
        if unit == BACKSLASH {
            i += 2;
            continue;
        }
        if unit == opener {
            depth += 1;
        } else if unit == closer {
            depth -= 1;
            if depth == 0 {
                return Some(i + 1);
            }
        }
        i += 1;
    }
    None
}

fn skip_space(text: &[u16], mut i: usize) -> usize {
    while i < text.len() && is_js_space(text[i]) {
        i += 1;
    }
    i
}

#[derive(Debug, Default)]
struct StructureScan {
    header_args: Vec<Span>,
    outside_args: Vec<Span>,
    headers: u64,
    figures: u64,
    display_math_envs: u64,
}

fn scan_environment_command(
    text: &[u16],
    scan: &mut StructureScan,
    name: &str,
    cursor: usize,
    i: usize,
) -> usize {
    let open = skip_space(text, cursor);
    if text.get(open) != Some(&OPEN_BRACE) {
        return i + 1;
    }
    let Some(close) = group_end(text, open) else {
        return i + 1;
    };
    let env = String::from_utf16_lossy(env_name(text, open, close));
    if name == "begin" {
        if FIGURE_ENVS.contains(&env.as_str()) {
            scan.figures += 1;
        }
        if DISPLAY_MATH_ENVS.contains(&env.as_str()) {
            scan.display_math_envs += 1;
        }
    }
    close
}

fn scan_command_arguments(
    text: &[u16],
    scan: &mut StructureScan,
    name: &str,
    heading: bool,
    mut cursor: usize,
) -> usize {
    let mut groups_to_skip = usize::from(name == "captionof");
    loop {
        let open = skip_space(text, cursor);
        let opener = text.get(open).copied();
        if opener != Some(OPEN_BRACE) && opener != Some(OPEN_BRACKET) {
            break;
        }
        let Some(close) = group_end(text, open) else {
            break;
        };
        if opener == Some(OPEN_BRACKET) {
            cursor = close;
            continue;
        }
        if groups_to_skip > 0 {
            groups_to_skip -= 1;
            cursor = close;
            continue;
        }
        let span = Span {
            from: open + 1,
            to: close - 1,
        };
        if heading {
            scan.header_args.push(span);
            scan.headers += 1;
        } else {
            scan.outside_args.push(span);
        }
        cursor = close;
        break;
    }
    cursor
}

fn scan_structure(text: &[u16]) -> StructureScan {
    let n = text.len();
    let mut scan = StructureScan::default();
    let mut i = 0;
    while i < n {
        let c = text[i];
        if c == PERCENT && (i == 0 || text[i - 1] != BACKSLASH) {
            i = index_of_unit(text, NEWLINE, i).unwrap_or(n) + 1;
            continue;
        }
        if c != BACKSLASH {
            i += 1;
            continue;
        }
        let mut name_end = i + 1;
        let window_end = n.min(i + 1 + COMMAND_NAME_WINDOW);
        while name_end < window_end && is_ascii_letter(text[name_end]) {
            name_end += 1;
        }
        if name_end == i + 1 {
            i += 2;
            continue;
        }
        let name = String::from_utf16_lossy(&text[i + 1..name_end]);
        let mut cursor = name_end;

        if name == "begin" || name == "end" {
            i = scan_environment_command(text, &mut scan, &name, cursor, i);
            continue;
        }

        if text.get(cursor) == Some(&STAR) {
            cursor += 1;
        }
        let heading = HEADING_CMDS.contains(&name.as_str());
        let outside = OUTSIDE_TEXT_CMDS.contains(&name.as_str());
        if !heading && !outside {
            i += 1;
            continue;
        }
        i = scan_command_arguments(text, &mut scan, &name, heading, cursor);
    }
    scan.header_args.sort_by_key(|span| span.from);
    scan.outside_args.sort_by_key(|span| span.from);
    scan
}

fn is_escaped(text: &[u16], index: usize) -> bool {
    let mut slashes = 0;
    let mut i = index;
    while i > 0 && text[i - 1] == BACKSLASH {
        slashes += 1;
        i -= 1;
    }
    slashes % 2 == 1
}

fn after_latex_verb(text: &[u16], index: usize, limit: usize) -> Option<usize> {
    if !starts_with_ascii(text, index, "\\verb") || is_escaped(text, index) {
        return None;
    }
    let mut delimiter_index = index + 5;
    if text.get(delimiter_index) == Some(&STAR) {
        delimiter_index += 1;
    }
    let delimiter = *text.get(delimiter_index)?;
    if is_js_space(delimiter) {
        return None;
    }
    match index_of_unit(text, delimiter, delimiter_index + 1) {
        Some(close) if close < limit => Some(close + 1),
        _ => Some(limit),
    }
}

fn after_latex_verbatim(text: &[u16], index: usize, limit: usize) -> Option<usize> {
    if !starts_with_ascii(text, index, "\\begin{") || is_escaped(text, index) {
        return None;
    }
    let environment = VERBATIM_ENV_NAMES.iter().find(|name| {
        starts_with_ascii(text, index + 7, name)
            && text.get(index + 7 + name.len()) == Some(&CLOSE_BRACE)
    })?;
    let after_opener = index + 8 + environment.len();
    let close = format!("\\end{{{environment}}}");
    match index_of_ascii(text, &close, after_opener) {
        Some(at) if at < limit => Some(at + close.len()),
        _ => Some(limit),
    }
}

fn is_in_latex_comment(text: &[u16], index: usize, lower_bound: usize) -> bool {
    let line_start = last_index_of_unit(text, NEWLINE, index as isize - 1).map_or(0, |at| at + 1);
    let mut cursor = lower_bound.max(line_start);
    while cursor < index {
        if text[cursor] == PERCENT && !is_escaped(text, cursor) {
            return true;
        }
        cursor += 1;
    }
    false
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum MathDelimiter {
    Dollar,
    DoubleDollar,
    Paren,
    Bracket,
}

impl MathDelimiter {
    fn opener_length(self) -> usize {
        match self {
            MathDelimiter::Dollar => 1,
            _ => 2,
        }
    }

    fn display(self) -> bool {
        matches!(self, MathDelimiter::DoubleDollar | MathDelimiter::Bracket)
    }

    fn close(self) -> &'static str {
        match self {
            MathDelimiter::Dollar => "$",
            MathDelimiter::DoubleDollar => "$$",
            MathDelimiter::Paren => "\\)",
            MathDelimiter::Bracket => "\\]",
        }
    }
}

fn find_closing_delimiter(
    text: &[u16],
    start: usize,
    limit: usize,
    delimiter: MathDelimiter,
) -> Option<usize> {
    let close = delimiter.close();
    let mut cursor = start;
    while cursor < limit {
        let found = index_of_ascii(text, close, cursor)?;
        if found >= limit {
            return None;
        }
        if !is_escaped(text, found) && !is_in_latex_comment(text, found, start) {
            match delimiter {
                MathDelimiter::Dollar => {
                    if (found == 0 || text[found - 1] != DOLLAR)
                        && text.get(found + 1) != Some(&DOLLAR)
                    {
                        return Some(found);
                    }
                }
                MathDelimiter::DoubleDollar => {
                    if (found == 0 || text[found - 1] != DOLLAR)
                        && text.get(found + 2) != Some(&DOLLAR)
                    {
                        return Some(found);
                    }
                }
                _ => return Some(found),
            }
        }
        cursor = found + close.len().max(1);
    }
    None
}

fn incomplete_end(text: &[u16], body_from: usize, limit: usize) -> usize {
    match index_of_unit(text, NEWLINE, body_from) {
        Some(line_end) if line_end <= limit => line_end,
        _ => limit,
    }
}

fn count_math(text: &[u16]) -> (u64, u64) {
    let limit = text.len();
    let mut inline = 0u64;
    let mut display = 0u64;
    let mut scanned = 0usize;
    let mut cursor = 0;
    while cursor < limit && scanned < MAX_SCANNED_EXPRESSIONS {
        if text[cursor] == PERCENT && !is_escaped(text, cursor) {
            cursor = match index_of_unit(text, NEWLINE, cursor + 1) {
                Some(line_end) if line_end < limit => line_end + 1,
                _ => limit,
            };
            continue;
        }
        if let Some(end) = after_latex_verb(text, cursor, limit) {
            cursor = end;
            continue;
        }
        if let Some(end) = after_latex_verbatim(text, cursor, limit) {
            cursor = end;
            continue;
        }

        let previous_is_dollar = cursor > 0 && text[cursor - 1] == DOLLAR;
        let delimiter = if starts_with_ascii(text, cursor, "$$")
            && !is_escaped(text, cursor)
            && !previous_is_dollar
            && text.get(cursor + 2) != Some(&DOLLAR)
        {
            Some(MathDelimiter::DoubleDollar)
        } else if text[cursor] == DOLLAR
            && !is_escaped(text, cursor)
            && !previous_is_dollar
            && text.get(cursor + 1) != Some(&DOLLAR)
        {
            Some(MathDelimiter::Dollar)
        } else if starts_with_ascii(text, cursor, "\\(") && !is_escaped(text, cursor) {
            Some(MathDelimiter::Paren)
        } else if starts_with_ascii(text, cursor, "\\[") && !is_escaped(text, cursor) {
            Some(MathDelimiter::Bracket)
        } else {
            None
        };
        let Some(delimiter) = delimiter else {
            cursor += 1;
            continue;
        };

        let opener_length = delimiter.opener_length();
        let body_from = cursor + opener_length;
        scanned += 1;
        if delimiter.display() {
            display += 1;
        } else {
            inline += 1;
        }
        if let Some(close_at) = find_closing_delimiter(text, body_from, limit, delimiter) {
            cursor = close_at + opener_length;
            continue;
        }
        let expression_to = incomplete_end(text, body_from, limit);
        cursor = (cursor + opener_length).max(expression_to);
    }
    (inline, display)
}

pub(crate) fn document_stats_for_units(text: &[u16]) -> DocumentStats {
    let masked = mask_latex(text);
    let starts = word_starts(&masked);
    let characters = prose_length(&masked);
    let lines = non_blank_lines(&masked);
    let structure = scan_structure(text);

    let mut words_in_headers = 0u64;
    let mut words_outside_text = 0u64;
    for &start in &starts {
        if in_spans(&structure.header_args, start) {
            words_in_headers += 1;
        } else if in_spans(&structure.outside_args, start) {
            words_outside_text += 1;
        }
    }
    let (math_inline, math_displayed) = count_math(text);
    let words = starts.len() as u64;
    DocumentStats {
        words,
        words_in_text: words - words_in_headers - words_outside_text,
        words_in_headers,
        words_outside_text,
        headers: structure.headers,
        figures: structure.figures,
        math_inline,
        math_displayed: math_displayed + structure.display_math_envs,
        characters,
        lines,
    }
}

pub(crate) fn document_stats_for_text(text: &str) -> DocumentStats {
    document_stats_for_units(&to_units(text))
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Engine {
    Latex,
    Typst,
    Markdown,
}

fn engine_for_path(path: &str) -> Option<Engine> {
    let lower = path.to_lowercase();
    if lower.ends_with(".typ") {
        return Some(Engine::Typst);
    }
    if lower.ends_with(".md") || lower.ends_with(".markdown") {
        return Some(Engine::Markdown);
    }
    if [".tex", ".ltx", ".latex", ".sty", ".cls"]
        .iter()
        .any(|extension| lower.ends_with(extension))
    {
        return Some(Engine::Latex);
    }
    None
}

fn is_drive_prefixed(path: &str) -> bool {
    let bytes = path.as_bytes();
    bytes.len() >= 3 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':' && bytes[2] == b'/'
}

pub(crate) fn normalize_project_path(path: &str) -> Option<String> {
    let replaced = path.replace('\\', "/");
    if replaced
        .chars()
        .any(|character| u32::from(character) <= 0x1f || character == '\u{7f}')
    {
        return None;
    }
    if replaced.starts_with('/') || is_drive_prefixed(&replaced) {
        return None;
    }
    let mut parts: Vec<&str> = Vec::new();
    for part in replaced.split('/') {
        if part.is_empty() || part == "." {
            continue;
        }
        if part == ".." {
            parts.pop()?;
            continue;
        }
        parts.push(part);
    }
    if parts.is_empty() {
        None
    } else {
        Some(parts.join("/"))
    }
}

fn dirname(path: &str) -> &str {
    match path.rfind('/') {
        Some(index) => &path[..index],
        None => "",
    }
}

fn has_scheme_prefix(raw: &str) -> bool {
    let bytes = raw.as_bytes();
    if bytes.is_empty() || !bytes[0].is_ascii_alphabetic() {
        return false;
    }
    bytes[1..]
        .iter()
        .position(|&byte| !(byte.is_ascii_alphanumeric() || matches!(byte, b'+' | b'.' | b'-')))
        .is_some_and(|index| bytes[index + 1] == b':')
}

fn has_extension_suffix(path: &str) -> bool {
    let Some(dot) = path.rfind('.') else {
        return false;
    };
    let suffix = &path[dot + 1..];
    !suffix.is_empty() && suffix.bytes().all(|byte| byte.is_ascii_alphanumeric())
}

pub(crate) fn resolve_project_path(from_file: &str, raw_target: &str) -> Option<String> {
    let mut raw = js_trim_str(raw_target);
    if let Some(stripped) = raw.strip_prefix(['"', '\'']) {
        raw = stripped;
    }
    if let Some(stripped) = raw.strip_suffix(['"', '\'']) {
        raw = stripped;
    }
    if raw.is_empty() || raw.starts_with(['#', '@', '/']) || has_scheme_prefix(raw) {
        return None;
    }
    let relative = raw.strip_prefix("./").unwrap_or(raw);
    let directory = dirname(from_file);
    let joined = if directory.is_empty() {
        relative.to_string()
    } else {
        format!("{directory}/{relative}")
    };
    normalize_project_path(&joined)
}

fn resolve_typst_import(from_file: &str, raw: &str) -> Option<String> {
    if raw.starts_with('@') || raw.contains("://") || raw.starts_with('/') {
        return None;
    }
    let mut parts: Vec<&str> = Vec::new();
    let directory: Vec<&str> = from_file.split('/').collect();
    let relative = raw.strip_prefix("./").unwrap_or(raw);
    for part in directory[..directory.len() - 1]
        .iter()
        .copied()
        .chain(relative.split('/'))
    {
        if part.is_empty() || part == "." {
            continue;
        }
        if part == ".." {
            parts.pop();
        } else {
            parts.push(part);
        }
    }
    let target = parts.join("/");
    let last_segment = target.rsplit('/').next().unwrap_or("");
    let has_extension = last_segment
        .find('.')
        .is_some_and(|index| index + 1 < last_segment.len());
    if has_extension {
        Some(target)
    } else {
        Some(format!("{target}.typ"))
    }
}

struct RawEdge {
    from: usize,
    name: String,
    target: Option<String>,
}

fn mask_comments(text: &[u16]) -> Vec<u16> {
    let mut masked = text.to_vec();
    let mut line_start = 0;
    while line_start <= text.len() {
        let line_end = index_of_unit(text, NEWLINE, line_start).unwrap_or(text.len());
        let mut i = line_start;
        while i < line_end {
            if text[i] == PERCENT {
                let mut backslashes = 0;
                let mut j = i;
                while j > line_start && text[j - 1] == BACKSLASH {
                    backslashes += 1;
                    j -= 1;
                }
                if backslashes % 2 == 0 {
                    for unit in masked[i..line_end].iter_mut() {
                        *unit = SPACE;
                    }
                    break;
                }
            }
            i += 1;
        }
        line_start = line_end + 1;
    }
    masked
}

fn braced_content(text: &[u16], brace: usize) -> Option<(usize, usize)> {
    if text.get(brace) != Some(&OPEN_BRACE) {
        return None;
    }
    let close = index_of_unit(text, CLOSE_BRACE, brace + 1)?;
    Some((brace + 1, close))
}

fn last_open_brace(text: &[u16], from: usize, to: usize) -> usize {
    text[from..to]
        .iter()
        .rposition(|&unit| unit == OPEN_BRACE)
        .map_or(from, |offset| from + offset + 1)
}

fn latex_legacy_edges(file: &str, source: &[u16], edges: &mut Vec<RawEdge>) {
    let text = mask_comments(source);
    let mut at = 0;
    while at < text.len() {
        if text[at] != BACKSLASH {
            at += 1;
            continue;
        }
        let name_length = if starts_with_ascii(&text, at + 1, "input") {
            5
        } else if starts_with_ascii(&text, at + 1, "include") {
            7
        } else {
            at += 1;
            continue;
        };
        let brace = skip_space(&text, at + 1 + name_length);
        let Some((content_from, content_to)) = braced_content(&text, brace) else {
            at += 1;
            continue;
        };
        let raw = String::from_utf16_lossy(js_trim(&text[content_from..content_to]));
        edges.push(RawEdge {
            from: content_from,
            target: resolve_project_path(file, &raw),
            name: raw,
        });
        at = content_to + 1;
    }
}

fn delimited_body_end(text: &[u16], start: usize) -> Option<(usize, bool)> {
    let delimiter = *text.get(start)?;
    if is_js_space(delimiter) {
        return None;
    }
    let end_of_line = index_of_unit(text, NEWLINE, start + 1).unwrap_or(text.len());
    match index_of_unit(text, delimiter, start + 1) {
        Some(closing) if closing <= end_of_line => Some((closing + 1, true)),
        _ => Some((end_of_line, false)),
    }
}

fn balanced_group_end(text: &[u16], start: usize, opening: u16, closing: u16) -> Option<usize> {
    if text.get(start) != Some(&opening) {
        return None;
    }
    let mut depth = 1i64;
    let mut cursor = start + 1;
    while cursor < text.len() {
        if text[cursor] == BACKSLASH {
            cursor += 2;
            continue;
        }
        if text[cursor] == opening {
            depth += 1;
        } else if text[cursor] == closing {
            depth -= 1;
            if depth == 0 {
                return Some(cursor + 1);
            }
        }
        cursor += 1;
    }
    None
}

fn line_end(text: &[u16], start: usize) -> usize {
    index_of_unit(text, NEWLINE, start).unwrap_or(text.len())
}

fn inline_verbatim_end(text: &[u16], start: usize) -> Option<usize> {
    if text.get(start) != Some(&BACKSLASH) {
        return None;
    }
    let mut command_end = start + 1;
    while command_end < text.len() && is_command_char(text[command_end]) {
        command_end += 1;
    }
    let command = String::from_utf16_lossy(&text[start + 1..command_end]);
    if !matches!(command.as_str(), "verb" | "lstinline" | "mintinline") {
        return None;
    }
    let mut cursor = command_end;
    if text.get(cursor) == Some(&STAR) {
        cursor += 1;
    }
    if command == "verb" {
        return delimited_body_end(text, cursor).map(|(to, _)| to);
    }
    cursor = skip_inline_space(text, cursor);
    if text.get(cursor) == Some(&OPEN_BRACKET) {
        match balanced_group_end(text, cursor, OPEN_BRACKET, CLOSE_BRACKET) {
            Some(option_end) => cursor = skip_inline_space(text, option_end),
            None => return Some(line_end(text, cursor + 1)),
        }
    }
    if command == "mintinline" {
        let language_end = balanced_group_end(text, cursor, OPEN_BRACE, CLOSE_BRACE)?;
        cursor = skip_inline_space(text, language_end);
        if text.get(cursor) == Some(&OPEN_BRACE) {
            return Some(
                balanced_group_end(text, cursor, OPEN_BRACE, CLOSE_BRACE)
                    .unwrap_or_else(|| line_end(text, cursor + 1)),
            );
        }
    }
    delimited_body_end(text, cursor).map(|(to, _)| to)
}

fn mask_latex_ignored_regions(text: &[u16]) -> Vec<u16> {
    let mut masked = text.to_vec();
    let mut cursor = 0;
    while cursor < text.len() {
        let unit = text[cursor];
        if unit == PERCENT {
            let to = line_end(text, cursor + 1);
            blank_run(&mut masked, cursor, to);
            cursor = to;
            continue;
        }
        if unit != BACKSLASH {
            cursor += 1;
            continue;
        }
        if let Some(to) = inline_verbatim_end(text, cursor) {
            blank_run(&mut masked, cursor, to);
            cursor = (cursor + 1).max(to);
            continue;
        }
        let mut command_end = cursor + 1;
        while command_end < text.len() && is_command_char(text[command_end]) {
            command_end += 1;
        }
        if starts_with_ascii(text, cursor + 1, "begin") && command_end == cursor + 6 {
            let opening = skip_inline_space(text, command_end);
            if let Some(end) = balanced_group_end(text, opening, OPEN_BRACE, CLOSE_BRACE) {
                let environment = String::from_utf16_lossy(env_name(text, opening, end));
                if IGNORED_ENVIRONMENTS.contains(&environment.as_str()) {
                    let close = format!("\\end{{{environment}}}");
                    let to =
                        index_of_ascii(text, &close, end).map_or(text.len(), |at| at + close.len());
                    blank_run(&mut masked, cursor, to);
                    cursor = to;
                    continue;
                }
            }
        }
        cursor = if command_end > cursor + 1 {
            command_end
        } else {
            text.len().min(cursor + 2)
        };
    }
    masked
}

fn latex_additional_edges(file: &str, source: &[u16], edges: &mut Vec<RawEdge>) {
    let masked = mask_latex_ignored_regions(source);
    let mut at = 0;
    while at < masked.len() {
        if masked[at] != BACKSLASH {
            at += 1;
            continue;
        }
        let command = ["input", "include", "subfile", "InputIfFileExists"]
            .iter()
            .find(|name| starts_with_ascii(&masked, at + 1, name));
        if let Some(command) = command {
            let brace = skip_space(&masked, at + 1 + command.len());
            if let Some((content_from, content_to)) = braced_content(&masked, brace) {
                if !matches!(*command, "input" | "include") {
                    let raw = String::from_utf16_lossy(js_trim(&masked[content_from..content_to]));
                    edges.push(RawEdge {
                        from: last_open_brace(&masked, at, content_to),
                        target: resolve_project_path(file, &raw),
                        name: raw,
                    });
                }
                at = content_to + 1;
                continue;
            }
        }
        let import = IMPORT_COMMANDS
            .iter()
            .find(|name| starts_with_ascii_ci(&masked, at + 1, name));
        if let Some(import) = import {
            let mut cursor = at + 1 + import.len();
            if masked.get(cursor) == Some(&STAR) {
                cursor += 1;
            }
            let first = skip_space(&masked, cursor);
            if let Some((directory_from, directory_to)) = braced_content(&masked, first) {
                let second = skip_space(&masked, directory_to + 1);
                if let Some((file_from, file_to)) = braced_content(&masked, second) {
                    let directory =
                        String::from_utf16_lossy(js_trim(&masked[directory_from..directory_to]));
                    let name = String::from_utf16_lossy(js_trim(&masked[file_from..file_to]));
                    let raw = format!("{}/{}", directory.trim_end_matches('/'), name);
                    edges.push(RawEdge {
                        from: last_open_brace(&masked, at, file_to),
                        target: resolve_project_path(file, &raw),
                        name: raw,
                    });
                    at = file_to + 1;
                    continue;
                }
            }
        }
        at += 1;
    }
}

fn mask_typst_comments(text: &[u16]) -> Vec<u16> {
    let mut out = Vec::with_capacity(text.len());
    let mut i = 0;
    let mut block_depth = 0usize;
    while i < text.len() {
        if block_depth > 0 {
            if starts_with_ascii(text, i, "/*") {
                block_depth += 1;
                out.extend_from_slice(&[SPACE, SPACE]);
                i += 2;
            } else if starts_with_ascii(text, i, "*/") {
                block_depth -= 1;
                out.extend_from_slice(&[SPACE, SPACE]);
                i += 2;
            } else {
                out.push(if text[i] == NEWLINE { NEWLINE } else { SPACE });
                i += 1;
            }
        } else if starts_with_ascii(text, i, "//") {
            let stop = index_of_unit(text, NEWLINE, i).unwrap_or(text.len());
            out.resize(out.len() + (stop - i), SPACE);
            i = stop;
        } else if starts_with_ascii(text, i, "/*") {
            block_depth = 1;
            out.extend_from_slice(&[SPACE, SPACE]);
            i += 2;
        } else {
            out.push(text[i]);
            i += 1;
        }
    }
    out
}

fn typst_edges(file: &str, source: &[u16], edges: &mut Vec<RawEdge>) {
    let text = mask_typst_comments(source);
    let mut at = 0;
    while at < text.len() {
        if text[at] != HASH {
            at += 1;
            continue;
        }
        let name_length = if starts_with_ascii(&text, at + 1, "include") {
            7
        } else if starts_with_ascii(&text, at + 1, "import") {
            6
        } else {
            at += 1;
            continue;
        };
        let mut cursor = at + 1 + name_length;
        let after_name = cursor;
        cursor = skip_space(&text, cursor);
        if cursor == after_name || text.get(cursor) != Some(&QUOTE) {
            at += 1;
            continue;
        }
        let content_from = cursor + 1;
        let Some(content_to) = index_of_unit(&text, QUOTE, content_from) else {
            at += 1;
            continue;
        };
        if content_to == content_from {
            at += 1;
            continue;
        }
        let raw = String::from_utf16_lossy(&text[content_from..content_to]);
        if let Some(target) = resolve_typst_import(file, &raw) {
            edges.push(RawEdge {
                from: content_from,
                name: raw,
                target: Some(target),
            });
        }
        at = content_to + 1;
    }
}

fn is_fence_marker(line: &[u16]) -> Option<(u16, usize)> {
    let start = skip_space(line, 0);
    let marker = *line.get(start)?;
    if marker != BACKTICK && marker != TILDE {
        return None;
    }
    let mut end = start;
    while end < line.len() && line[end] == marker {
        end += 1;
    }
    if end - start >= 3 {
        Some((marker, end - start))
    } else {
        None
    }
}

fn is_front_matter_end(line: &[u16]) -> bool {
    let body = if starts_with_ascii(line, 0, "---") || starts_with_ascii(line, 0, "...") {
        &line[3..]
    } else {
        return false;
    };
    body.iter().all(|&unit| is_js_space(unit))
}

fn blank_inline_code(line: &mut [u16]) {
    let mut at = 0;
    while at < line.len() {
        if line[at] != BACKTICK {
            at += 1;
            continue;
        }
        let mut run = at;
        while run < line.len() && line[run] == BACKTICK {
            run += 1;
        }
        let max_length = run - at;
        let mut matched = None;
        for length in (1..=max_length).rev() {
            let marker = vec![BACKTICK; length];
            let mut search = at + length;
            while search + length <= line.len() {
                if starts_with_units(line, search, &marker) {
                    matched = Some(search + length);
                    break;
                }
                search += 1;
            }
            if matched.is_some() {
                break;
            }
        }
        match matched {
            Some(end) => {
                for unit in line[at..end].iter_mut() {
                    *unit = SPACE;
                }
                at = end;
            }
            None => at += 1,
        }
    }
}

fn markdown_visible_text(source: &[u16]) -> Vec<u16> {
    let mut chars = source.to_vec();
    let mut yaml = starts_with_ascii(source, 0, "---\n");
    let mut fence: Option<(u16, usize)> = None;
    let mut offset = 0;
    let mut line_index = 0usize;
    while offset <= source.len() {
        let end = index_of_unit(source, NEWLINE, offset).unwrap_or(source.len());
        let line = &source[offset..end];
        if yaml {
            if line_index > 0 && is_front_matter_end(line) {
                yaml = false;
            } else {
                blank_run(&mut chars, offset, end);
            }
        } else if let Some((marker, length)) = is_fence_marker(line) {
            match fence {
                None => fence = Some((marker, length)),
                Some((open_marker, open_length))
                    if marker == open_marker && length >= open_length =>
                {
                    fence = None
                }
                Some(_) => {}
            }
            blank_run(&mut chars, offset, end);
        } else if fence.is_some() {
            blank_run(&mut chars, offset, end);
        } else {
            blank_inline_code(&mut chars[offset..end]);
        }
        offset = end + 1;
        line_index += 1;
    }
    chars
}

fn is_include_name_unit(unit: u16) -> bool {
    !(unit == QUOTE
        || unit == APOSTROPHE
        || is_js_space(unit)
        || matches!(unit, CLOSE_BRACE | PERCENT | GREATER))
}

fn markdown_include_at(text: &[u16], line_start: usize) -> Option<(usize, usize, usize)> {
    let cursor = skip_space(text, line_start);
    let after_keyword =
        if text.get(cursor) == Some(&BANG) && starts_with_ascii(text, cursor + 1, "include") {
            cursor + 8
        } else if starts_with_ascii(text, cursor, "{{") {
            let mut inner = cursor + 2;
            if text.get(inner) == Some(&LESS) {
                inner += 1;
            }
            inner = skip_space(text, inner);
            if !starts_with_ascii(text, inner, "include") {
                return None;
            }
            inner + 7
        } else if starts_with_ascii(text, cursor, "{%") {
            let inner = skip_space(text, cursor + 2);
            if !starts_with_ascii(text, inner, "include") {
                return None;
            }
            inner + 7
        } else {
            return None;
        };
    let name_start = skip_space(text, after_keyword);
    if name_start == after_keyword {
        return None;
    }
    let quote = text
        .get(name_start)
        .copied()
        .filter(|&unit| unit == QUOTE || unit == APOSTROPHE);
    let raw_from = if quote.is_some() {
        name_start + 1
    } else {
        name_start
    };
    let mut raw_to = raw_from;
    while raw_to < text.len() && is_include_name_unit(text[raw_to]) {
        raw_to += 1;
    }
    if raw_to == raw_from {
        return None;
    }
    let match_end = match quote {
        Some(unit) => {
            if text.get(raw_to) != Some(&unit) {
                return None;
            }
            raw_to + 1
        }
        None => raw_to,
    };
    Some((raw_from, raw_to, match_end))
}

fn markdown_edges(file: &str, source: &[u16], edges: &mut Vec<RawEdge>) {
    let text = markdown_visible_text(source);
    let mut at = 0;
    while at <= text.len() {
        let at_line_start =
            at == 0 || matches!(text[at - 1], NEWLINE | CARRIAGE_RETURN | 0x2028 | 0x2029);
        if at_line_start {
            if let Some((raw_from, raw_to, match_end)) = markdown_include_at(&text, at) {
                let raw = String::from_utf16_lossy(&text[raw_from..raw_to]);
                edges.push(RawEdge {
                    from: raw_from,
                    target: resolve_project_path(file, &raw),
                    name: raw,
                });
                at = match_end.max(at + 1);
                continue;
            }
        }
        at += 1;
    }
}

struct KnownFiles {
    exact: HashSet<String>,
    by_lower: HashMap<String, Vec<String>>,
}

impl KnownFiles {
    fn from_paths(paths: impl IntoIterator<Item = String>) -> Self {
        let mut exact: BTreeSet<String> = BTreeSet::new();
        for path in paths {
            if let Some(normalized) = normalize_project_path(&path) {
                exact.insert(normalized);
            }
        }
        let mut by_lower: HashMap<String, Vec<String>> = HashMap::new();
        for path in &exact {
            by_lower
                .entry(path.to_lowercase())
                .or_default()
                .push(path.clone());
        }
        Self {
            exact: exact.into_iter().collect(),
            by_lower,
        }
    }

    fn collect(&self, candidate: &str, into: &mut BTreeSet<String>) {
        if self.exact.contains(candidate) {
            into.insert(candidate.to_string());
        }
        if let Some(matches) = self.by_lower.get(&candidate.to_lowercase()) {
            into.extend(matches.iter().cloned());
        }
    }

    fn resolve(&self, target: &str) -> Option<String> {
        let normalized = normalize_project_path(target)?;
        let mut candidates = BTreeSet::new();
        self.collect(&normalized, &mut candidates);
        if !has_extension_suffix(&normalized) {
            for extension in INCLUDE_EXTENSIONS {
                self.collect(&format!("{normalized}{extension}"), &mut candidates);
            }
        }
        if candidates.len() == 1 {
            candidates.into_iter().next()
        } else {
            None
        }
    }
}

fn collect_project_files(root: &Path, directory: &Path, out: &mut Vec<String>, depth: usize) {
    if depth >= crate::project::MAX_WALK_DEPTH {
        return;
    }
    let Ok(entries) = std::fs::read_dir(directory) else {
        return;
    };
    let mut items: Vec<_> = entries.flatten().collect();
    items.sort_by_key(std::fs::DirEntry::file_name);
    for entry in items {
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if name == ".oleafly" || name == ".git" {
            continue;
        }
        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        if file_type.is_symlink() {
            continue;
        }
        let path = entry.path();
        if file_type.is_dir() {
            collect_project_files(root, &path, out, depth + 1);
        } else {
            out.push(crate::project::rel_slash(root, &path));
        }
    }
}

fn known_files(project_id: &str) -> Result<KnownFiles, String> {
    let root = crate::paths::project_dir(project_id)?;
    let mut paths = Vec::new();
    collect_project_files(&root, &root, &mut paths, 0);
    Ok(KnownFiles::from_paths(paths))
}

fn parse_edges(path: &str, text: &str, known: &KnownFiles) -> Vec<String> {
    let Some(engine) = engine_for_path(path) else {
        return Vec::new();
    };
    if normalize_project_path(path).as_deref() != Some(path) {
        return Vec::new();
    }
    let units = to_units(text);
    let mut raw_edges = Vec::new();
    match engine {
        Engine::Latex => {
            latex_legacy_edges(path, &units, &mut raw_edges);
            latex_additional_edges(path, &units, &mut raw_edges);
        }
        Engine::Typst => typst_edges(path, &units, &mut raw_edges),
        Engine::Markdown => markdown_edges(path, &units, &mut raw_edges),
    }
    raw_edges.sort_by_key(|edge| edge.from);
    raw_edges
        .into_iter()
        .map(|edge| match edge.target {
            Some(target) => known.resolve(&target).unwrap_or(target),
            None => edge.name,
        })
        .collect()
}

fn normalize_newlines(text: String) -> String {
    if !text.contains('\r') {
        return text;
    }
    text.replace("\r\n", "\n").replace('\r', "\n")
}

fn read_whole_file(project_id: &str, path: &str) -> Result<String, String> {
    let _worktree = crate::worktree_lock::ProjectWorktreeLock::shared(project_id)?;
    let resolved = crate::sandbox::resolve(project_id, path)?;
    std::fs::read(&resolved)
        .map(|bytes| String::from_utf8_lossy(&bytes).into_owned())
        .map_err(|error| error.to_string())
}

fn load_texts(
    project_id: &str,
    paths: &[String],
    overrides: &BTreeMap<String, String>,
    limits: SourceLimits,
    texts: &mut HashMap<String, String>,
    unreadable: &mut HashSet<String>,
) -> Result<(), String> {
    let mut disk = Vec::new();
    for path in paths {
        if texts.contains_key(path) || unreadable.contains(path) {
            continue;
        }
        match overrides.get(path) {
            Some(text) => {
                texts.insert(path.clone(), text.clone());
            }
            None => disk.push(path.clone()),
        }
    }
    if disk.is_empty() {
        return Ok(());
    }
    let result = read_project_sources_sync(
        project_id,
        ProjectSourcesRequest {
            paths: disk,
            known: Vec::new(),
        },
        limits,
    )?;
    for file in result.files {
        texts.insert(file.path, normalize_newlines(file.text));
    }
    for entry in result.unreadable {
        unreadable.insert(entry.path);
    }
    for path in result.oversized {
        match read_whole_file(project_id, &path) {
            Ok(text) => {
                texts.insert(path, normalize_newlines(text));
            }
            Err(_) => {
                unreadable.insert(path);
            }
        }
    }
    Ok(())
}

fn walk_document(
    file: &str,
    depth: usize,
    edges: &HashMap<String, Vec<String>>,
    visited: &mut HashSet<String>,
    paths: &mut Vec<String>,
) {
    if depth > MAX_INCLUDE_DEPTH || visited.contains(file) {
        return;
    }
    visited.insert(file.to_string());
    paths.push(file.to_string());
    if let Some(targets) = edges.get(file) {
        for target in targets {
            walk_document(target, depth + 1, edges, visited, paths);
        }
    }
}

pub(crate) fn document_stats_with_limits(
    project_id: &str,
    request: DocumentStatsRequest,
    limits: SourceLimits,
) -> Result<DocumentStatsResult, String> {
    let known = known_files(project_id)?;
    let root = request.main_document;
    let mut texts: HashMap<String, String> = HashMap::new();
    let mut unreadable: HashSet<String> = HashSet::new();
    let mut edges: HashMap<String, Vec<String>> = HashMap::new();
    let mut seen: HashSet<String> = HashSet::from([root.clone()]);
    let mut frontier = vec![root.clone()];
    for _ in 0..=MAX_INCLUDE_DEPTH {
        if frontier.is_empty() {
            break;
        }
        load_texts(
            project_id,
            &frontier,
            &request.overrides,
            limits,
            &mut texts,
            &mut unreadable,
        )?;
        let mut next = Vec::new();
        for path in &frontier {
            let Some(text) = texts.get(path) else {
                continue;
            };
            let targets = parse_edges(path, text, &known);
            for target in &targets {
                if seen.insert(target.clone()) {
                    next.push(target.clone());
                }
            }
            edges.insert(path.clone(), targets);
        }
        frontier = next;
    }

    let mut ordered = Vec::new();
    let mut visited = HashSet::new();
    walk_document(&root, 0, &edges, &mut visited, &mut ordered);

    let mut files = Vec::new();
    let mut missing = Vec::new();
    let mut total = DocumentStats::default();
    for path in ordered {
        match texts.get(&path) {
            Some(text) => {
                let stats = document_stats_for_text(text);
                total.add(&stats);
                files.push(FileDocumentStats { path, stats });
            }
            None => missing.push(path),
        }
    }
    missing.sort();
    Ok(DocumentStatsResult {
        root,
        file_count: files.len(),
        unreadable: missing,
        stats: total,
        files,
    })
}

pub(crate) fn document_stats_sync(
    project_id: &str,
    request: DocumentStatsRequest,
) -> Result<DocumentStatsResult, String> {
    document_stats_with_limits(project_id, request, SourceLimits::DEFAULT)
}

#[tauri::command]
pub async fn document_stats(
    project_id: String,
    request: DocumentStatsRequest,
) -> Result<DocumentStatsResult, String> {
    tauri::async_runtime::spawn_blocking(move || document_stats_sync(&project_id, request))
        .await
        .map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    use std::time::Instant;

    struct TestProject {
        _directory: tempfile::TempDir,
        _env_guard: std::sync::MutexGuard<'static, ()>,
        id: String,
        root: PathBuf,
    }

    impl Drop for TestProject {
        fn drop(&mut self) {
            std::env::remove_var("OLEAFLY_DATA_DIR");
        }
    }

    fn project(id: &str) -> TestProject {
        let env_guard = crate::paths::data_dir_env_lock();
        let directory = tempfile::tempdir().unwrap();
        std::env::set_var("OLEAFLY_DATA_DIR", directory.path());
        let root = crate::paths::create_project_dir(id).unwrap();
        TestProject {
            _directory: directory,
            _env_guard: env_guard,
            id: id.to_string(),
            root,
        }
    }

    fn write(project: &TestProject, rel: &str, bytes: &[u8]) {
        let full = project.root.join(rel);
        std::fs::create_dir_all(full.parent().unwrap()).unwrap();
        std::fs::write(full, bytes).unwrap();
    }

    fn request(main: &str, overrides: &[(&str, &str)]) -> DocumentStatsRequest {
        DocumentStatsRequest {
            main_document: main.to_string(),
            overrides: overrides
                .iter()
                .map(|(path, text)| (path.to_string(), text.to_string()))
                .collect(),
        }
    }

    fn collect(project: &TestProject, main: &str) -> DocumentStatsResult {
        document_stats_sync(&project.id, request(main, &[])).unwrap()
    }

    fn masked(text: &str) -> String {
        String::from_utf16_lossy(&mask_latex(&to_units(text)))
    }

    fn words(text: &str) -> Vec<String> {
        let units = to_units(text);
        let masked = mask_latex(&units);
        word_spans(&masked)
            .into_iter()
            .map(|(from, to)| String::from_utf16_lossy(&units[from..to]))
            .collect()
    }

    fn fixture_root() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("src")
            .join("fixtures")
            .join("document-stats")
    }

    fn copy_tree(from: &Path, base: &Path, project: &TestProject) {
        for entry in std::fs::read_dir(from).unwrap() {
            let entry = entry.unwrap();
            let path = entry.path();
            if path.is_dir() {
                copy_tree(&path, base, project);
                continue;
            }
            let rel = path
                .strip_prefix(base)
                .unwrap()
                .to_string_lossy()
                .replace('\\', "/");
            write(project, &rel, &std::fs::read(&path).unwrap());
        }
    }

    #[test]
    fn every_golden_fixture_matches_the_typescript_counter_byte_for_byte() {
        let mut names: Vec<String> = std::fs::read_dir(fixture_root())
            .unwrap()
            .flatten()
            .filter(|entry| entry.path().is_dir())
            .map(|entry| entry.file_name().to_string_lossy().into_owned())
            .collect();
        names.sort();
        assert!(names.len() >= 20, "only {} fixtures found", names.len());
        for name in names {
            let directory = fixture_root().join(&name);
            let expected = std::fs::read_to_string(directory.join("expected.json")).unwrap();
            let parsed: serde_json::Value = serde_json::from_str(&expected).unwrap();
            let root = parsed["root"].as_str().unwrap().to_string();
            let project = project(&format!("stats-{name}"));
            copy_tree(
                &directory.join("project"),
                &directory.join("project"),
                &project,
            );
            let result = document_stats_sync(&project.id, request(&root, &[])).unwrap();
            let actual = serde_json::to_string(&result).unwrap();
            assert_eq!(actual, expected.trim_end(), "fixture {name}");
        }
    }

    #[test]
    fn javascript_whitespace_and_trim_semantics() {
        assert!(is_js_space(0xfeff));
        assert!(is_js_space(0x3000));
        assert!(is_js_space(0x2028));
        assert!(!is_js_space(0x85));
        assert_eq!(js_trim_str("\u{feff} x \u{3000}"), "x");
        assert_eq!(js_trim_str("\u{85}x"), "\u{85}x");
        assert_eq!(non_blank_lines(&to_units("a\n\u{a0}\n\t\nb\n")), 2);
    }

    #[test]
    fn utf16_offsets_and_lengths_match_javascript_strings() {
        let text = "\u{1F600} caf\u{e9} \u{4e2d}\u{6587} plain";
        assert_eq!(to_units(text).len(), text.encode_utf16().count());
        let stats = document_stats_for_text(text);
        assert_eq!(stats.characters, 16);
        assert_eq!(stats.words, 4);
        assert_eq!(stats.lines, 1);
    }

    #[test]
    fn words_follow_the_unicode_spelling_tokenizer() {
        assert_eq!(
            words("Na pap\u{ed}ru \u{10d}esky, l\u{2019}homme don't well-known"),
            vec![
                "Na",
                "pap\u{ed}ru",
                "\u{10d}esky",
                "l\u{2019}homme",
                "don't",
                "well",
                "known"
            ]
        );
        assert_eq!(
            words("\u{939}\u{93f}\u{902}\u{926}\u{940} \u{92d}\u{93e}\u{937}\u{93e}"),
            vec![
                "\u{939}\u{93f}\u{902}\u{926}\u{940}",
                "\u{92d}\u{93e}\u{937}\u{93e}"
            ]
        );
        assert_eq!(
            words("\u{645}\u{6cc}\u{200c}\u{62e}\u{648}\u{627}\u{647}\u{645} Silben\u{ad}trennung"),
            vec![
                "\u{645}\u{6cc}\u{200c}\u{62e}\u{648}\u{627}\u{647}\u{645}",
                "Silben\u{ad}trennung"
            ]
        );
        assert_eq!(
            words("\u{5e6}\u{5d4}\"\u{5dc} \"quoted\""),
            vec!["\u{5e6}\u{5d4}\"\u{5dc}", "quoted"]
        );
        assert_eq!(words("cafe\u{301} \u{301}x"), vec!["cafe\u{301}", "x"]);
    }

    #[test]
    fn scripts_without_spaces_count_by_character_or_run() {
        assert_eq!(
            words("\u{8fd9}\u{662f}\u{6d4b}\u{8bd5}\u{3002}"),
            vec!["\u{8fd9}", "\u{662f}", "\u{6d4b}", "\u{8bd5}"]
        );
        assert_eq!(
            words("\u{30c6}\u{30b9}\u{30c8}\u{3067}\u{3059}"),
            vec!["\u{30c6}", "\u{30b9}", "\u{30c8}", "\u{3067}", "\u{3059}"]
        );
        assert_eq!(
            words("\u{e19}\u{e35}\u{e48}\u{e04}\u{e37}\u{e2d} \u{e07}\u{e48}\u{e32}\u{e22}"),
            vec![
                "\u{e19}\u{e35}\u{e48}\u{e04}\u{e37}\u{e2d}",
                "\u{e07}\u{e48}\u{e32}\u{e22}"
            ]
        );
        assert_eq!(
            words("\u{c774}\u{ac83}\u{c740} \u{d14c}\u{c2a4}\u{d2b8}"),
            vec!["\u{c774}\u{ac83}\u{c740}", "\u{d14c}\u{c2a4}\u{d2b8}"]
        );
    }

    #[test]
    fn urls_and_emails_are_blanked_before_masking() {
        assert_eq!(
            words("See https://x.org/a{b} and www.Example.org/x or a.b+c@d.co now"),
            vec!["See", "b", "and", "or", "now"]
        );
        assert_eq!(words("HTTP\u{17f}://x.org tail"), vec!["tail"]);
        assert_eq!(
            words("nobody@example.\u{434}\u{43e}\u{43c} tail"),
            vec!["tail"]
        );
        assert_eq!(
            words("Napi\u{161}te na \u{43f}\u{440}\u{438}\u{43c}\u{435}\u{440}@\u{43f}\u{43e}\u{447}\u{442}\u{430}.\u{440}\u{444} nebo \u{159}editel@firma.cz dnes."),
            vec!["Napi\u{161}te", "na", "nebo", "dnes"]
        );
        assert_eq!(words("x@y.co1 z"), vec!["x", "y", "co", "z"]);
        assert_eq!(words("dot.name@sub.example.co.uk"), Vec::<String>::new());
        assert_eq!(words("https:// nothing"), vec!["https", "nothing"]);
    }

    #[test]
    fn masking_keeps_prose_and_drops_machine_text() {
        assert_eq!(
            masked("Text \\cite{smith2020a} and $\\alpha$."),
            "Text                   and         ."
        );
        assert_eq!(
            words("\\section*{Title} body \\verb|code words| tail"),
            vec!["Title", "body", "tail"]
        );
        assert_eq!(
            words("\\begin{equation}\nx = y\n\\end{equation}\nafter"),
            vec!["after"]
        );
        assert_eq!(
            words("\\href{https://x.org}{shown text} \\textcolor{red}{red words}"),
            vec!["shown", "text", "red", "words"]
        );
        assert_eq!(
            words("% comment words\nreal \\% not a comment"),
            vec!["real", "not", "a", "comment"]
        );
        assert_eq!(
            words("\\mycites{a,b} \\Citep{c} \\citeauthor{d} x"),
            vec!["x"]
        );
        assert_eq!(
            words("\\begin{align*}\na &= b\n\\end{align*} after"),
            vec!["after"]
        );
    }

    #[test]
    fn command_arguments_follow_the_typescript_mask_rules() {
        assert_eq!(
            words("viz \\labelcref{obr:udoli} a \\cpageref{obr:hora} and \\Crefrange{a}{b}."),
            vec!["viz", "a", "and"]
        );
        assert_eq!(
            words("\\setcounter{secnumdepth}{3} Text \\usefont{T1}{cmr}{m}{n} more"),
            vec!["Text", "more"]
        );
        assert_eq!(
            words(
                "\\addcontentsline{toc}{section}{\u{da}vod} \\foreignlanguage{english}{the crease}"
            ),
            vec!["\u{da}vod", "the", "crease"]
        );
        assert_eq!(
            words("\\bibitem[Nov20]{novak} Kniha \\newtheorem{lemma}[theorem]{Lemma} \\hypertarget{sec}{Shown}"),
            vec!["Kniha", "Lemma", "Shown"]
        );
        assert_eq!(
            words("\\newcommand\\foo{bodyword} \\DeclareMathOperator*\\argmin{argmin} \\newfontfamily\\cyrfont{Times New Roman}[Script=Cyrillic] Text"),
            vec!["Text"]
        );
        assert_eq!(
            words("\\captionsetup{font=footnotesize} Body \\setup{kept} \\svgsetup{inkscapeexe={env X= y}} tail"),
            vec!["Body", "kept", "tail"]
        );
        assert_eq!(
            words("\\custommacro[width=3cm, keepaspectratio]{Visible prose} \\item[Label] tail \\mycmd[Label $a=b$] x"),
            vec!["Visible", "prose", "Label", "tail", "Label", "x"]
        );
        assert_eq!(
            words("Start \\section[Short = x\n\nLater prose with a = b"),
            vec!["Start", "Short", "x", "Later", "prose", "with", "a", "b"]
        );
        let unclosed = format!("\\mycmd[a=b {}", "x ".repeat(600));
        assert_eq!(words(&unclosed).len(), 602);
        let near = format!("\\mycmd[a=b {}] after", "x ".repeat(497));
        assert_eq!(words(&near), vec!["after"]);
        let far = format!("\\mycmd[a=b {}] after", "x ".repeat(498));
        assert_eq!(words(&far).len(), 501);
        assert_eq!(
            words("\\renewenvironment{abstract}{a}{b} after"),
            vec!["after"]
        );
        assert_eq!(masked("\\label{a}\t{b} x"), "         \t    x");
    }

    #[test]
    fn accent_macros_and_unicode_command_names_are_masked_like_typescript() {
        assert_eq!(masked("Kate\\v{r}ina caf\\'e"), "Kate     ina caf   ");
        assert_eq!(
            words("gr\\\"o\\ss er {\\\"o}k p\\v{r}\\'{\\i}klad \\t{oo}x hyphen\\-ation Dvo\\v r\u{e1}k \\vr x"),
            vec!["gr", "er", "k", "p", "klad", "x", "hyphen", "ation", "Dvo", "\u{e1}k", "x"]
        );
        assert_eq!(
            words("\\emph{\\'e}tatt \\{\\'e} \\\\{\\'e} x{\\\"o}y"),
            vec!["tatt", "x", "y"]
        );
        assert_eq!(
            words("Text \\v\u{fd}sledek konec a \\\u{3b1}\u{3b2} d\u{e1}le"),
            vec!["Text", "konec", "a", "d\u{e1}le"]
        );
    }

    #[test]
    fn a_trailing_backslash_does_not_grow_the_mask() {
        assert_eq!(masked("end\\").len(), 4);
        assert_eq!(document_stats_for_text("end\\").words, 1);
    }

    #[test]
    fn buckets_follow_the_typescript_tests() {
        let stats = document_stats_for_text(
            "\\section{Results of the study}\nThe measured response was clearly nonlinear.\n\\begin{figure}\n\\caption{Response curve for the sample}\n\\end{figure}",
        );
        assert_eq!(stats.words_in_headers, 4);
        assert_eq!(stats.words_outside_text, 5);
        assert_eq!(stats.words_in_text, 6);
        assert_eq!(stats.figures, 1);

        let stats = document_stats_for_text(
            "\\chapter{Introduction}\nSome body prose here.\n\\subsection[Short]{A longer subsection title}\nMore body prose with a \\footnote{footnote aside} attached.",
        );
        assert_eq!(
            stats.words_in_text + stats.words_in_headers + stats.words_outside_text,
            stats.words
        );
        assert_eq!(stats.headers, 2);
        assert_eq!(stats.words_in_headers, 5);
        assert_eq!(stats.words_outside_text, 2);

        let stats = document_stats_for_text("\\section[Short form]{The full section title}\n");
        assert_eq!(stats.headers, 1);
        assert_eq!(stats.words_in_headers, 4);

        let stats = document_stats_for_text(
            "\\part{One}\n\\chapter{Two}\n\\section*{Three}\n\\subsection{Four}\n\\subsubsection{Five}\n\\paragraph{Six}\n\\subparagraph{Seven}",
        );
        assert_eq!(stats.headers, 7);

        let stats = document_stats_for_text(
            "\\begin{figure}\\end{figure}\n\\begin{figure*}\\end{figure*}\n\\begin{wrapfigure}{r}{0.4\\textwidth}\\end{wrapfigure}\n\\begin{table}\\end{table}",
        );
        assert_eq!(stats.figures, 3);
    }

    #[test]
    fn math_is_counted_like_the_typescript_scanner() {
        let stats = document_stats_for_text(
            "Inline $a^2 + b^2$ and \\( c^2 \\) here.\n\\[ E = mc^2 \\]\n\\begin{equation}x = 1\\end{equation}\n\\begin{align*}y &= 2\\end{align*}",
        );
        assert_eq!(stats.math_inline, 2);
        assert_eq!(stats.math_displayed, 3);

        let stats = document_stats_for_text(
            "\\begin{equation}\\begin{split}a &= b\\end{split}\\end{equation}\n",
        );
        assert_eq!(stats.math_displayed, 1);

        let stats =
            document_stats_for_text("% $ commented\n\\verb|$ not math|\n$$ open\nlater $x$");
        assert_eq!(stats.math_displayed, 1);
        assert_eq!(stats.math_inline, 1);

        let stats =
            document_stats_for_text("\\begin{lstlisting}\nprint(\"$a$\")\n\\end{lstlisting}\n$b$");
        assert_eq!(stats.math_inline, 1);
    }

    #[test]
    fn commented_and_escaped_structure_follows_the_typescript_tests() {
        let stats =
            document_stats_for_text("% \\section{Not a heading}\n% \\begin{figure}\nReal prose.");
        assert_eq!(stats.headers, 0);
        assert_eq!(stats.figures, 0);

        let stats = document_stats_for_text("Growth of 40\\% overall.\n\\section{After}\n");
        assert_eq!(stats.headers, 1);

        let stats = document_stats_for_text("\\section{Never closed\nStill some prose.\n");
        assert_eq!(stats.headers, 0);
        assert!(stats.words > 0);

        assert_eq!(
            document_stats_for_text("Text \\cite{smith2020a} and $\\alpha\\beta\\gamma$.\n").words,
            2
        );
        assert_eq!(document_stats_for_text(""), DocumentStats::default());
    }

    #[test]
    fn project_paths_resolve_like_the_frontend_index() {
        assert_eq!(
            normalize_project_path("a\\b/./c/../d"),
            Some("a/b/d".to_string())
        );
        assert_eq!(normalize_project_path("../x"), None);
        assert_eq!(normalize_project_path("/abs"), None);
        assert_eq!(normalize_project_path("C:/x"), None);
        assert_eq!(normalize_project_path("a\u{1}b"), None);
        assert_eq!(
            resolve_project_path("chapters/one.tex", " \"../shared/notes\" "),
            Some("shared/notes".to_string())
        );
        assert_eq!(resolve_project_path("main.tex", "/etc/hosts"), None);
        assert_eq!(resolve_project_path("main.tex", "https://x.org/a"), None);
        assert_eq!(resolve_project_path("main.tex", "#anchor"), None);
        assert_eq!(
            resolve_project_path("main.tex", "./sections/intro"),
            Some("sections/intro".to_string())
        );
        assert_eq!(
            resolve_typst_import("main.typ", "sections/method"),
            Some("sections/method.typ".to_string())
        );
        assert_eq!(
            resolve_typst_import("sections/a.typ", "../lib.typ"),
            Some("lib.typ".to_string())
        );
        assert_eq!(resolve_typst_import("main.typ", "@preview/x:1.0.0"), None);
        assert_eq!(engine_for_path("A/B.TEX"), Some(Engine::Latex));
        assert_eq!(engine_for_path("notes.markdown"), Some(Engine::Markdown));
        assert_eq!(engine_for_path("refs.bib"), None);
    }

    #[test]
    fn known_files_pick_a_single_candidate_with_extension_and_case_fallbacks() {
        let known = KnownFiles::from_paths(vec![
            "sections/Intro.tex".to_string(),
            "sections/method.tex".to_string(),
            "sections/method.md".to_string(),
            "lib.typ".to_string(),
        ]);
        assert_eq!(
            known.resolve("sections/intro"),
            Some("sections/Intro.tex".to_string())
        );
        assert_eq!(known.resolve("sections/method"), None);
        assert_eq!(known.resolve("lib"), Some("lib.typ".to_string()));
        assert_eq!(known.resolve("lib.typ"), Some("lib.typ".to_string()));
        assert_eq!(known.resolve("missing"), None);
    }

    #[test]
    fn dirty_buffers_override_disk_and_extend_the_walk() {
        let project = project("stats-overrides");
        write(&project, "main.tex", b"\\section{Disk}\nDisk words only.\n");
        write(&project, "extra.tex", b"Extra words from disk.\n");
        let disk = collect(&project, "main.tex");
        assert_eq!(disk.file_count, 1);
        assert_eq!(disk.stats.words, 4);

        let result = document_stats_sync(
            &project.id,
            request(
                "main.tex",
                &[(
                    "main.tex",
                    "\\section{Buffer}\nBuffer words here now.\n\\input{extra}\n",
                )],
            ),
        )
        .unwrap();
        assert_eq!(result.file_count, 2);
        assert_eq!(
            result
                .files
                .iter()
                .map(|f| f.path.as_str())
                .collect::<Vec<_>>(),
            vec!["main.tex", "extra.tex"]
        );
        assert_eq!(result.stats.words, 9);
        assert_eq!(result.stats.headers, 1);
    }

    #[test]
    fn missing_absolute_and_remote_includes_are_unreadable_by_name() {
        let project = project("stats-unreadable");
        write(
            &project,
            "main.tex",
            b"\\input{gone}\n\\input{/etc/hosts}\n\\input{https://x.org/a}\nRoot words.\n",
        );
        let result = collect(&project, "main.tex");
        assert_eq!(result.file_count, 1);
        assert_eq!(
            result.unreadable,
            vec!["/etc/hosts", "gone", "https://x.org/a"]
        );
        assert_eq!(result.stats.words, 2);
    }

    #[test]
    fn a_missing_root_counts_nothing_and_a_missing_project_is_an_error() {
        let project = project("stats-missing-root");
        let result = collect(&project, "main.tex");
        assert_eq!(result.file_count, 0);
        assert_eq!(result.unreadable, vec!["main.tex"]);
        assert_eq!(result.stats, DocumentStats::default());
        assert_eq!(result.root, "main.tex");
        assert!(document_stats_sync("stats-absent", request("main.tex", &[])).is_err());
    }

    #[test]
    fn oversized_files_fall_back_to_a_whole_read_like_the_frontend() {
        let project = project("stats-oversized");
        write(
            &project,
            "main.tex",
            b"Alpha beta gamma delta epsilon.\n\\input{part}\n",
        );
        write(&project, "part.tex", b"tiny\n");
        let limits = SourceLimits {
            file_bytes: 8,
            batch_bytes: 1_000,
            batch_paths: 100,
        };
        let result =
            document_stats_with_limits(&project.id, request("main.tex", &[]), limits).unwrap();
        assert_eq!(result.file_count, 2);
        assert_eq!(result.stats.words, 6);
        assert!(result.unreadable.is_empty());
    }

    #[test]
    fn include_depth_and_cycles_are_bounded_like_the_frontend_walk() {
        let project = project("stats-depth");
        write(&project, "main.tex", b"root\n\\input{d1}\n");
        for level in 1..=10 {
            let next = if level < 10 {
                format!("d{}", level + 1)
            } else {
                "main".to_string()
            };
            write(
                &project,
                &format!("d{level}.tex"),
                format!("level\n\\input{{{next}}}\n").as_bytes(),
            );
        }
        let result = collect(&project, "main.tex");
        assert_eq!(result.file_count, 9);
        assert_eq!(result.files.last().unwrap().path, "d8.tex");
        assert!(result.unreadable.is_empty());
    }

    #[test]
    fn typst_and_markdown_roots_walk_their_own_include_syntax() {
        let project = project("stats-typst-markdown");
        write(
            &project,
            "main.typ",
            b"#import \"lib.typ\": *\n#include \"sections/intro\"\n// #include \"never.typ\"\nBody words.\n",
        );
        write(&project, "lib.typ", b"#let x = 1\n");
        write(
            &project,
            "sections/intro.typ",
            b"= Intro\nIntro words here.\n",
        );
        let result = collect(&project, "main.typ");
        assert_eq!(
            result
                .files
                .iter()
                .map(|f| f.path.as_str())
                .collect::<Vec<_>>(),
            vec!["main.typ", "lib.typ", "sections/intro.typ"]
        );

        write(
            &project,
            "notes.md",
            b"---\ntitle: x\n---\n!include parts/one.md\n{{< include parts/two >}}\n```\n!include parts/never.md\n```\n",
        );
        write(&project, "parts/one.md", b"One words.\n");
        write(&project, "parts/two.md", b"Two words.\n");
        let result = collect(&project, "notes.md");
        assert_eq!(
            result
                .files
                .iter()
                .map(|f| f.path.as_str())
                .collect::<Vec<_>>(),
            vec!["notes.md", "parts/one.md", "parts/two.md"]
        );
    }

    #[test]
    fn crlf_sources_count_like_the_frontend_normalizes_them() {
        let project = project("stats-crlf");
        write(
            &project,
            "main.tex",
            b"\\section{A}\r\nline one\r\n\r\nline two\r\n",
        );
        let result = collect(&project, "main.tex");
        assert_eq!(result.stats.lines, 3);
        assert_eq!(result.stats.words, 5);
        assert_eq!(result.stats.characters, 19);
    }

    #[test]
    fn request_and_result_use_camel_case_and_reject_unknown_fields() {
        let parsed: DocumentStatsRequest =
            serde_json::from_str(r#"{"mainDocument":"main.tex"}"#).unwrap();
        assert!(parsed.overrides.is_empty());
        let parsed: DocumentStatsRequest =
            serde_json::from_str(r#"{"mainDocument":"main.tex","overrides":{"a.tex":"text"}}"#)
                .unwrap();
        assert_eq!(
            parsed.overrides.get("a.tex").map(String::as_str),
            Some("text")
        );
        assert!(serde_json::from_str::<DocumentStatsRequest>(
            r#"{"mainDocument":"main.tex","extra":1}"#
        )
        .is_err());

        let value = serde_json::to_value(DocumentStatsResult {
            root: "main.tex".into(),
            file_count: 1,
            unreadable: vec![],
            stats: DocumentStats {
                words_in_text: 2,
                math_displayed: 1,
                ..DocumentStats::default()
            },
            files: vec![FileDocumentStats {
                path: "main.tex".into(),
                stats: DocumentStats::default(),
            }],
        })
        .unwrap();
        assert_eq!(value["fileCount"], 1);
        assert_eq!(value["stats"]["wordsInText"], 2);
        assert_eq!(value["stats"]["mathDisplayed"], 1);
        assert_eq!(value["files"][0]["path"], "main.tex");
        assert_eq!(value["files"][0]["stats"]["wordsOutsideText"], 0);
    }

    #[test]
    fn the_command_counts_off_the_blocking_pool() {
        let project = project("stats-command");
        write(&project, "main.tex", b"\\section{One}\nAlpha beta.\n");
        let result = tauri::async_runtime::block_on(document_stats(
            project.id.clone(),
            request("main.tex", &[]),
        ))
        .unwrap();
        assert_eq!(result.stats.words, 3);
        assert_eq!(result.stats.headers, 1);
        let error = tauri::async_runtime::block_on(document_stats(
            "stats-command-absent".to_string(),
            request("main.tex", &[]),
        ))
        .unwrap_err();
        assert!(error.contains("stats-command-absent"));
    }

    fn seed_thesis_root() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("fixtures")
            .join("research-seeds")
            .join("computational-physics-phd-thesis")
    }

    fn collect_files(root: &Path, base: &Path, out: &mut Vec<(String, Vec<u8>)>) {
        for entry in std::fs::read_dir(root).unwrap() {
            let entry = entry.unwrap();
            let path = entry.path();
            if path.is_dir() {
                collect_files(&path, base, out);
                continue;
            }
            let rel = path
                .strip_prefix(base)
                .unwrap()
                .to_string_lossy()
                .replace('\\', "/");
            out.push((rel, std::fs::read(&path).unwrap()));
        }
    }

    fn suffix_labels(text: &str, suffix: &str) -> String {
        const COMMANDS: [&str; 7] = [
            "\\label{",
            "\\eqref{",
            "\\ref{",
            "\\cref{",
            "\\Cref{",
            "\\autoref{",
            "\\pageref{",
        ];
        let mut out = String::with_capacity(text.len());
        let mut rest = text;
        while let Some(at) = rest.find('\\') {
            out.push_str(&rest[..at]);
            let tail = &rest[at..];
            let found = COMMANDS
                .iter()
                .find(|command| tail.starts_with(*command))
                .and_then(|command| {
                    tail[command.len()..]
                        .find('}')
                        .map(|close| (*command, close))
                });
            match found {
                Some((command, close)) => {
                    out.push_str(command);
                    out.push_str(&tail[command.len()..command.len() + close]);
                    out.push('-');
                    out.push_str(suffix);
                    out.push('}');
                    rest = &tail[command.len() + close + 1..];
                }
                None => {
                    out.push('\\');
                    rest = &tail[1..];
                }
            }
        }
        out.push_str(rest);
        out
    }

    fn scaled_thesis(project: &TestProject, copies: usize) -> usize {
        let mut base = Vec::new();
        collect_files(&seed_thesis_root(), &seed_thesis_root(), &mut base);
        let mut inputs = Vec::new();
        let mut written = 0;
        let mut main = String::new();
        for (rel, bytes) in &base {
            let scalable = rel.starts_with("chapters/") || rel.starts_with("appendices/");
            if scalable {
                let text = String::from_utf8_lossy(bytes);
                for copy in 0..copies {
                    let target = if copy == 0 {
                        rel.clone()
                    } else {
                        rel.replace(".tex", &format!("-{copy}.tex"))
                    };
                    write(
                        project,
                        &target,
                        suffix_labels(&text, &format!("c{copy}")).as_bytes(),
                    );
                    inputs.push(format!("\\input{{{}}}", target.trim_end_matches(".tex")));
                    written += 1;
                }
            } else if rel == "main.tex" {
                main = String::from_utf8_lossy(bytes).into_owned();
            } else {
                write(project, rel, bytes);
                written += 1;
            }
        }
        let begin = main.find("\\begin{document}").unwrap() + "\\begin{document}".len();
        let end = main.rfind("\\end{document}").unwrap();
        let rewritten = format!(
            "{}\n\\input{{frontmatter/titlepage}}\n\\input{{frontmatter/abstract}}\n{}\n\\bibliography{{refs}}\n{}",
            &main[..begin],
            inputs.join("\n"),
            &main[end..]
        );
        write(project, "main.tex", rewritten.as_bytes());
        written + 1
    }

    fn median(samples: &mut [f64]) -> f64 {
        samples.sort_by(|a, b| a.partial_cmp(b).unwrap());
        samples[samples.len() / 2]
    }

    #[test]
    fn the_scaled_thesis_walks_every_copy() {
        let project = project("stats-scaled");
        let files = scaled_thesis(&project, 2);
        let result = collect(&project, "main.tex");
        assert_eq!(result.file_count, files - 2);
        assert!(result.unreadable.is_empty());
        assert!(result
            .files
            .iter()
            .any(|f| f.path == "chapters/results-1.tex"));
        assert!(result.stats.words > 0);
    }

    #[test]
    #[ignore = "benchmark: run with cargo test -p oleafly document_stats_benchmark -- --ignored --nocapture"]
    fn document_stats_benchmark() {
        let project = project("stats-bench");
        let corpus = std::env::var_os("OLEAFLY_DOCUMENT_STATS_CORPUS").map(PathBuf::from);
        let files = match &corpus {
            Some(corpus) => {
                let mut out = Vec::new();
                collect_files(corpus, corpus, &mut out);
                for (rel, bytes) in &out {
                    write(&project, rel, bytes);
                }
                out.len()
            }
            None => scaled_thesis(&project, 32),
        };
        let first = collect(&project, "main.tex");
        let json = serde_json::to_string(&first).unwrap().len();
        let mut samples = Vec::new();
        for _ in 0..10 {
            let start = Instant::now();
            let result = collect(&project, "main.tex");
            samples.push(start.elapsed().as_secs_f64() * 1000.0);
            assert_eq!(result.file_count, first.file_count);
        }
        let text_bytes: u64 = first
            .files
            .iter()
            .map(|f| std::fs::metadata(project.root.join(&f.path)).unwrap().len())
            .sum();
        let min = samples.iter().copied().fold(f64::INFINITY, f64::min);
        let max = samples.iter().copied().fold(0.0, f64::max);
        println!(
            "document_stats over {} project files: walked {} files, {} bytes of source, {} words, response JSON {} bytes",
            files, first.file_count, text_bytes, first.stats.words, json
        );
        println!(
            "document_stats_sync (walk + batch read + mask + count, no IPC): median {:.2} ms, min {:.2} ms, max {:.2} ms over 10 runs",
            median(&mut samples),
            min,
            max
        );
        let paths: Vec<String> = first.files.iter().map(|f| f.path.clone()).collect();
        let mut listing = Vec::new();
        let mut reading = Vec::new();
        let mut counting = Vec::new();
        let mut texts = HashMap::new();
        for _ in 0..10 {
            let start = Instant::now();
            known_files(&project.id).unwrap();
            listing.push(start.elapsed().as_secs_f64() * 1000.0);
            let start = Instant::now();
            texts.clear();
            let mut unreadable = HashSet::new();
            load_texts(
                &project.id,
                &paths,
                &BTreeMap::new(),
                SourceLimits::DEFAULT,
                &mut texts,
                &mut unreadable,
            )
            .unwrap();
            reading.push(start.elapsed().as_secs_f64() * 1000.0);
            let start = Instant::now();
            let mut total = DocumentStats::default();
            for path in &paths {
                total.add(&document_stats_for_text(&texts[path]));
            }
            counting.push(start.elapsed().as_secs_f64() * 1000.0);
            assert_eq!(total, first.stats);
        }
        println!(
            "phases: project listing median {:.2} ms, batch read of {} files median {:.2} ms, mask + count over texts in memory median {:.2} ms",
            median(&mut listing),
            paths.len(),
            median(&mut reading),
            median(&mut counting)
        );
        let units: Vec<Vec<u16>> = paths.iter().map(|path| to_units(&texts[path])).collect();
        let mut stages = [Vec::new(), Vec::new(), Vec::new(), Vec::new(), Vec::new()];
        for _ in 0..10 {
            let start = Instant::now();
            for path in &paths {
                std::hint::black_box(to_units(&texts[path]));
            }
            stages[0].push(start.elapsed().as_secs_f64() * 1000.0);
            let start = Instant::now();
            for text in &units {
                std::hint::black_box((url_spans(text), email_spans(text)));
            }
            stages[1].push(start.elapsed().as_secs_f64() * 1000.0);
            let start = Instant::now();
            for text in &units {
                std::hint::black_box(mask_latex(text));
            }
            stages[2].push(start.elapsed().as_secs_f64() * 1000.0);
            let start = Instant::now();
            for text in &units {
                std::hint::black_box(scan_structure(text));
            }
            stages[3].push(start.elapsed().as_secs_f64() * 1000.0);
            let start = Instant::now();
            for text in &units {
                std::hint::black_box(count_math(text));
            }
            stages[4].push(start.elapsed().as_secs_f64() * 1000.0);
        }
        println!(
            "stages: utf16 {:.2} ms, url+email pre-pass {:.2} ms, mask_latex (incl pre-pass) {:.2} ms, scan_structure {:.2} ms, count_math {:.2} ms",
            median(&mut stages[0]),
            median(&mut stages[1]),
            median(&mut stages[2]),
            median(&mut stages[3]),
            median(&mut stages[4])
        );
    }
}
