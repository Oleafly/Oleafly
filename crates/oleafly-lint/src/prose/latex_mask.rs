use std::sync::LazyLock;

use oleafly_preflight::jsre::JsRegex;
use oleafly_preflight::latex::lexical::is_command_unit;
use oleafly_preflight::text::{
    index_of_units, is_js_space_unit, is_letter_unit, is_number_unit, js_trim, last_index_of_units,
    to_units, SourceText,
};
use unicode_normalization::UnicodeNormalization;

use super::spelling_words::{email_address_pattern, spelling_word_spans};
use super::{
    blank_into, lossy, MaskSpan, ProseMask, JS_SPACE_CLASS, PROSE_PLACEHOLDER,
    PROSE_SHORT_PLACEHOLDER,
};

const BACKSLASH: u16 = b'\\' as u16;
const NEWLINE: u16 = b'\n' as u16;
const SPACE: u16 = b' ' as u16;
const TAB: u16 = b'\t' as u16;
const CARRIAGE_RETURN: u16 = b'\r' as u16;
const OPEN_BRACE: u16 = b'{' as u16;
const CLOSE_BRACE: u16 = b'}' as u16;
const OPEN_BRACKET: u16 = b'[' as u16;
const CLOSE_BRACKET: u16 = b']' as u16;
const OPEN_PAREN: u16 = b'(' as u16;
const CLOSE_PAREN: u16 = b')' as u16;
const DOLLAR: u16 = b'$' as u16;
const PERCENT: u16 = b'%' as u16;
const STAR: u16 = b'*' as u16;
const QUOTE: u16 = b'"' as u16;
const EQUALS: u16 = b'=' as u16;

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

const INLINE_ARG_CMDS: &[&str] = &[
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
    "url",
    "path",
    "email",
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

const OPAQUE_BRACE_PREFIX_COUNTS: &[(&str, usize)] = &[
    ("textcolor", 1),
    ("colorbox", 1),
    ("fcolorbox", 2),
    ("href", 1),
    ("import", 2),
    ("subimport", 2),
    ("inputfrom", 2),
    ("subinputfrom", 2),
    ("includefrom", 2),
    ("subincludefrom", 2),
    ("setkeys", 2),
    ("setcounter", 2),
    ("addtocounter", 2),
    ("addcontentsline", 2),
    ("newacronym", 2),
    ("newglossaryentry", 2),
    ("DeclareMathOperator", 2),
    ("newfontfamily", 2),
    ("babelfont", 2),
    ("fontsize", 2),
    ("usefont", 4),
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

const OPTION_SCAN_LIMIT: usize = 1000;

const ACCENT_MARKS: &[(&str, char)] = &[
    ("'", '\u{0301}'),
    ("`", '\u{0300}'),
    ("^", '\u{0302}'),
    ("\"", '\u{0308}'),
    ("~", '\u{0303}'),
    ("=", '\u{0304}'),
    (".", '\u{0307}'),
    ("u", '\u{0306}'),
    ("v", '\u{030C}'),
    ("H", '\u{030B}'),
    ("c", '\u{0327}'),
    ("d", '\u{0323}'),
    ("b", '\u{0331}'),
    ("r", '\u{030A}'),
    ("k", '\u{0328}'),
    ("t", '\u{0361}'),
];

const LETTER_MACROS: &[(&str, &str)] = &[
    ("ss", "ß"),
    ("o", "ø"),
    ("O", "Ø"),
    ("l", "ł"),
    ("L", "Ł"),
    ("ae", "æ"),
    ("AE", "Æ"),
    ("oe", "œ"),
    ("OE", "Œ"),
    ("aa", "å"),
    ("AA", "Å"),
    ("i", "ı"),
    ("j", "ȷ"),
];

const GERMAN_SHORTHANDS: &[(u16, &str)] = &[
    (b'a' as u16, "ä"),
    (b'o' as u16, "ö"),
    (b'u' as u16, "ü"),
    (b'A' as u16, "Ä"),
    (b'O' as u16, "Ö"),
    (b'U' as u16, "Ü"),
    (b's' as u16, "ß"),
    (b'z' as u16, "ß"),
    (b'S' as u16, "SS"),
    (b'Z' as u16, "SZ"),
    (b'-' as u16, ""),
    (b'|' as u16, ""),
    (b'"' as u16, ""),
    (b'=' as u16, "-"),
    (b'~' as u16, "-"),
];

const LATEX_SPECIAL: &[u8] = b"{}[]~&#^_";

const VERBATIM_CMDS: &[&str] = &["verb", "Verb", "lstinline", "mintinline"];

static CITE_LIKE: LazyLock<JsRegex> = LazyLock::new(|| JsRegex::std(r"(?i)(?:^cite|cites?$)"));
static URL: LazyLock<JsRegex> = LazyLock::new(|| {
    JsRegex::std(&format!(
        r"(?i)(?:https?://|www\.)[^{JS_SPACE_CLASS}<>{{}}\\]+"
    ))
});
static SINGLE_LETTER: LazyLock<JsRegex> =
    LazyLock::new(|| JsRegex::std(r"\A[ \t]*(\p{L})[ \t]*\z"));
static TIE_LETTERS: LazyLock<JsRegex> =
    LazyLock::new(|| JsRegex::std(r"\A[ \t]*(\p{L}{1,2})[ \t]*\z"));
static DOTLESS: LazyLock<JsRegex> =
    LazyLock::new(|| JsRegex::std(r"\A[ \t]*\\([ij])[ \t]*(?:\{\}[ \t]*)?\z"));
static BABEL_OPTION_LIST: LazyLock<JsRegex> = LazyLock::new(|| {
    JsRegex::std(&format!(
        r"\\(?:usepackage|documentclass)[{JS_SPACE_CLASS}]*\[([^\]\\]*)\]"
    ))
});
static GERMAN_BABEL_OPTION: LazyLock<JsRegex> =
    LazyLock::new(|| JsRegex::std(r"(?-u:\b)n?(?:german|austrian|swissgerman)(?-u:\b)"));
static GERMAN_BABEL_PACKAGE: LazyLock<JsRegex> = LazyLock::new(|| {
    JsRegex::std(&format!(
        r"\\usepackage[{JS_SPACE_CLASS}]*\{{[{JS_SPACE_CLASS}]*n?german[{JS_SPACE_CLASS}]*\}}"
    ))
});

fn is_opaque_arg_cmd(name: &str) -> bool {
    OPAQUE_ARG_CMDS.contains(&name) || REF_ARG_CMDS.contains(&name)
}

fn is_inline_arg_cmd(name: &str) -> bool {
    INLINE_ARG_CMDS.contains(&name) || REF_ARG_CMDS.contains(&name)
}

fn is_setup_cmd(name: &str) -> bool {
    name.len() > "setup".len() && name.ends_with("setup")
}

fn is_ascii_command_unit(unit: Option<u16>) -> bool {
    unit.is_some_and(|unit| {
        unit == u16::from(b'@') || (unit < 0x80 && (unit as u8).is_ascii_alphabetic())
    })
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum MaskKind {
    Block,
    Inline,
}

#[derive(Clone, Debug)]
struct MaskRegion {
    from: usize,
    to: usize,
    kind: MaskKind,
    blanks: Vec<MaskSpan>,
}

#[derive(Clone, Debug)]
struct LatexConstruct {
    from: usize,
    to: usize,
    text: Vec<u16>,
}

struct LatexScan {
    regions: Vec<MaskRegion>,
    constructs: Vec<LatexConstruct>,
}

fn span(from: usize, to: usize) -> MaskSpan {
    MaskSpan { from, to }
}

fn find_env_end(text: &[u16], from: usize, env: &str) -> usize {
    let env: Vec<u16> = to_units(env);
    let mut depth = 1usize;
    let mut cursor = from;
    while let Some(slash) = index_of_units(text, &[BACKSLASH], cursor) {
        let Some((begin, end)) = env_marker_at(text, slash, &env) else {
            cursor = slash + 1;
            continue;
        };
        if begin {
            depth += 1;
        } else {
            depth -= 1;
            if depth == 0 {
                return end;
            }
        }
        cursor = end;
    }
    text.len()
}

fn env_marker_at(text: &[u16], at: usize, env: &[u16]) -> Option<(bool, usize)> {
    let starts = |offset: usize, word: &str| {
        let word = to_units(word);
        text.get(offset..offset + word.len()) == Some(&word[..])
    };
    let (begin, mut cursor) = if starts(at + 1, "begin") {
        (true, at + 6)
    } else if starts(at + 1, "end") {
        (false, at + 4)
    } else {
        return None;
    };
    while text.get(cursor).copied().is_some_and(is_js_space_unit) {
        cursor += 1;
    }
    if text.get(cursor) != Some(&OPEN_BRACE) {
        return None;
    }
    cursor += 1;
    if text.get(cursor..cursor + env.len()) != Some(env) {
        return None;
    }
    cursor += env.len();
    if text.get(cursor) == Some(&STAR) && text.get(cursor + 1) == Some(&CLOSE_BRACE) {
        return Some((begin, cursor + 2));
    }
    (text.get(cursor) == Some(&CLOSE_BRACE)).then_some((begin, cursor + 1))
}

struct Collector<'a> {
    text: &'a [u16],
    chars: Vec<u16>,
    n: usize,
    regions: Vec<MaskRegion>,
    constructs: Vec<LatexConstruct>,
    document_class_at: Option<usize>,
    preamble_end: Option<usize>,
}

struct Args {
    end: usize,
    spans: Vec<MaskSpan>,
}

impl<'a> Collector<'a> {
    fn new(text: &'a [u16]) -> Self {
        Self {
            text,
            chars: text.to_vec(),
            n: text.len(),
            regions: Vec::new(),
            constructs: Vec::new(),
            document_class_at: None,
            preamble_end: None,
        }
    }

    fn at(&self, index: usize) -> Option<u16> {
        self.chars.get(index).copied()
    }

    fn blank_source(&mut self, from: usize, to: usize) {
        for unit in self.chars.iter_mut().take(to).skip(from) {
            if *unit != NEWLINE {
                *unit = SPACE;
            }
        }
    }

    fn clamp_spans(&self, spans: Vec<MaskSpan>) -> Vec<MaskSpan> {
        let mut output = Vec::with_capacity(spans.len());
        for item in spans {
            let from = item.from.min(self.n);
            let to = from.max(item.to.min(self.n));
            if to > from {
                output.push(span(from, to));
            }
        }
        output
    }

    fn push(
        &mut self,
        raw_from: usize,
        raw_to: usize,
        kind: MaskKind,
        spans: Option<Vec<MaskSpan>>,
    ) {
        let from = raw_from.min(self.n);
        let to = from.max(raw_to.min(self.n));
        if to <= from {
            return;
        }
        let blanks = match spans {
            Some(spans) => self.clamp_spans(spans),
            None => vec![span(from, to)],
        };
        self.regions.push(MaskRegion {
            from,
            to,
            kind,
            blanks,
        });
    }

    fn match_group(&self, open: usize) -> usize {
        let opening = self.chars[open];
        let closing = if opening == OPEN_BRACE {
            CLOSE_BRACE
        } else {
            CLOSE_BRACKET
        };
        let mut depth = 0isize;
        let mut k = open;
        while k < self.n {
            let ch = self.chars[k];
            if ch == BACKSLASH {
                k += 2;
                continue;
            }
            if ch == opening {
                depth += 1;
            } else if ch == closing {
                depth -= 1;
                if depth == 0 {
                    return k + 1;
                }
            }
            k += 1;
        }
        self.n
    }

    fn closed_option_end(&self, open: usize) -> Option<usize> {
        let mut depth = 0isize;
        let limit = self.n.min(open + OPTION_SCAN_LIMIT);
        let mut k = open;
        while k < limit {
            let ch = self.chars[k];
            if ch == BACKSLASH {
                k += 1;
            } else if ch == OPEN_BRACKET {
                depth += 1;
            } else if ch == CLOSE_BRACKET {
                depth -= 1;
                if depth == 0 {
                    return Some(k + 1);
                }
            } else if ch == NEWLINE {
                let mut next = k + 1;
                while next < self.n && matches!(self.chars[next], SPACE | TAB | CARRIAGE_RETURN) {
                    next += 1;
                }
                if self.at(next) == Some(NEWLINE) {
                    return None;
                }
            }
            k += 1;
        }
        None
    }

    fn skip_inline_space(&self, mut k: usize) -> usize {
        while k < self.n && matches!(self.chars[k], SPACE | TAB) {
            k += 1;
        }
        k
    }

    fn control_word_end(&self, k: usize) -> usize {
        if self.at(k) != Some(BACKSLASH) || !is_ascii_command_unit(self.at(k + 1)) {
            return k;
        }
        let mut end = k + 1;
        while end < self.n && is_ascii_command_unit(self.at(end)) {
            end += 1;
        }
        end
    }

    fn end_of_args(&self, mut k: usize, control_word: bool) -> Args {
        let mut spans = Vec::new();
        if self.at(k) == Some(STAR) {
            spans.push(span(k, k + 1));
            k += 1;
        }
        if control_word {
            let start = self.skip_inline_space(k);
            let end = self.control_word_end(start);
            if end > start {
                spans.push(span(start, end));
                k = end;
            }
        }
        loop {
            let start = self.skip_inline_space(k);
            let ch = self.at(start);
            if ch != Some(OPEN_BRACE) && ch != Some(OPEN_BRACKET) {
                break;
            }
            let end = self.match_group(start);
            spans.push(span(start, end));
            k = end;
        }
        Args { end: k, spans }
    }

    fn end_of_hyperref_prefix(&self, k: usize, mut spans: Vec<MaskSpan>) -> Args {
        let start = self.skip_inline_space(k);
        if self.at(start) != Some(OPEN_BRACE) && self.at(start) != Some(OPEN_BRACKET) {
            return Args { end: k, spans };
        }
        let end = self.match_group(start);
        spans.push(span(start, end));
        Args { end, spans }
    }

    fn end_of_opaque_prefix(&self, mut k: usize, name: &str) -> Args {
        let mut spans = Vec::new();
        if self.at(k) == Some(STAR) {
            spans.push(span(k, k + 1));
            k += 1;
        }
        if name == "hyperref" {
            return self.end_of_hyperref_prefix(k, spans);
        }
        let braces = OPAQUE_BRACE_PREFIX_COUNTS
            .iter()
            .find(|(command, _)| *command == name)
            .map_or(1, |(_, count)| *count);
        let control_word = CONTROL_WORD_ARG_CMDS.contains(&name);
        let mut consumed = 0usize;
        loop {
            let start = self.skip_inline_space(k);
            let word = if control_word && consumed < braces {
                self.control_word_end(start)
            } else {
                start
            };
            if word > start {
                spans.push(span(start, word));
                consumed += 1;
                k = word;
                continue;
            }
            if self.at(start) == Some(OPEN_BRACKET) {
                let end = self.match_group(start);
                spans.push(span(start, end));
                k = end;
                continue;
            }
            if self.at(start) == Some(OPEN_BRACE) && consumed < braces {
                let end = self.match_group(start);
                spans.push(span(start, end));
                consumed += 1;
                k = end;
                continue;
            }
            return Args { end: k, spans };
        }
    }

    fn end_of_line(&self, k: usize) -> usize {
        index_of_units(&self.chars, &[NEWLINE], k).unwrap_or(self.n)
    }

    fn math_close_at(&self, k: usize, mode: u8) -> Option<usize> {
        let ch = self.chars[k];
        if ch == NEWLINE {
            return (mode == 1).then_some(k);
        }
        if ch == BACKSLASH && matches!(self.at(k + 1), Some(CLOSE_PAREN) | Some(CLOSE_BRACKET)) {
            return Some(k + 2);
        }
        if ch == DOLLAR {
            if mode == 2 && self.at(k + 1) == Some(DOLLAR) {
                return Some(k + 2);
            }
            if mode == 1 {
                return Some(k + 1);
            }
        }
        None
    }

    fn end_of_math(&self, start: usize, mode: u8) -> usize {
        let mut k = start;
        while k < self.n {
            if let Some(close) = self.math_close_at(k, mode) {
                return close;
            }
            k = if self.chars[k] == PERCENT {
                self.end_of_line(k)
            } else {
                k + 1
            };
        }
        self.n
    }

    fn verbatim_delimited_end(&self, start: usize, delimiter: u16) -> usize {
        let mut k = start + 1;
        while k < self.n && self.chars[k] != NEWLINE {
            if self.chars[k] == delimiter && self.chars[k - 1] != BACKSLASH {
                k += 1;
                break;
            }
            k += 1;
        }
        k
    }

    fn end_of_verbatim(&self, j: usize, name: &str) -> usize {
        let mut k = j;
        if self.at(k) == Some(STAR) {
            k += 1;
        }
        k = self.skip_inline_space(k);
        if self.at(k) == Some(OPEN_BRACKET) {
            k = self.match_group(k);
        }
        k = self.skip_inline_space(k);
        if name == "mintinline" && self.at(k) == Some(OPEN_BRACE) {
            k = self.match_group(k);
            k = self.skip_inline_space(k);
        }
        if self.at(k) == Some(OPEN_BRACE) {
            return self.match_group(k);
        }
        match self.at(k) {
            None | Some(NEWLINE) => k,
            Some(delimiter) => self.verbatim_delimited_end(k, delimiter),
        }
    }

    fn begin_region(&mut self, start: usize, j: usize) -> usize {
        let s = self.skip_inline_space(j);
        if self.at(s) != Some(OPEN_BRACE) {
            self.push(start, j, MaskKind::Block, None);
            return j;
        }
        let group_end = self.match_group(s);
        let raw = lossy(self.text, s + 1, group_end.saturating_sub(1));
        let trimmed = js_trim(&raw);
        let env = trimmed.strip_suffix('*').unwrap_or(trimmed).to_string();
        if OPAQUE_ENVS.contains(&env.as_str()) {
            let env_end = find_env_end(self.text, group_end, &env);
            self.push(start, env_end, MaskKind::Block, None);
            return env_end;
        }
        if env == "document" && self.document_class_at.is_some() && self.preamble_end.is_none() {
            self.preamble_end = Some(start);
        }
        let args = self.end_of_args(j, false);
        let mut spans = vec![span(start, j)];
        spans.extend(args.spans);
        self.push(start, args.end, MaskKind::Block, Some(spans));
        args.end
    }

    fn option_has_assignment(units: &[u16]) -> bool {
        let mut index = 0;
        while index < units.len() {
            if units[index] == DOLLAR {
                if let Some(close) = index_of_units(units, &[DOLLAR], index + 1) {
                    index = close + 1;
                    continue;
                }
            }
            if units[index] == EQUALS {
                return true;
            }
            index += 1;
        }
        false
    }

    fn named_command_region(&mut self, start: usize, j: usize, name: &str) -> usize {
        if VERBATIM_CMDS.contains(&name) {
            let k = self.end_of_verbatim(j, name);
            self.push(start, k, MaskKind::Inline, None);
            return k.max(j);
        }
        if name == "begin" {
            return self.begin_region(start, j);
        }
        if name == "end" {
            let args = self.end_of_args(j, false);
            let mut spans = vec![span(start, j)];
            spans.extend(args.spans);
            self.push(start, args.end, MaskKind::Block, Some(spans));
            return args.end;
        }
        if name == "documentclass" && self.document_class_at.is_none() {
            self.document_class_at = Some(start);
        }
        let opaque_args = is_opaque_arg_cmd(name);
        let cite_like = CITE_LIKE.is_match(name);
        if opaque_args || cite_like {
            let args = self.end_of_args(j, CONTROL_WORD_ARG_CMDS.contains(&name));
            let inline = is_inline_arg_cmd(name) || (!opaque_args && cite_like);
            let mut spans = vec![span(start, j)];
            spans.extend(args.spans);
            let kind = if inline {
                MaskKind::Inline
            } else {
                MaskKind::Block
            };
            self.push(start, args.end, kind, Some(spans));
            return args.end;
        }
        if FIRST_ARG_OPAQUE_CMDS.contains(&name) || is_setup_cmd(name) {
            let prefix = self.end_of_opaque_prefix(j, name);
            let mut spans = vec![span(start, j)];
            spans.extend(prefix.spans);
            self.push(start, prefix.end, MaskKind::Block, Some(spans));
            return prefix.end;
        }
        let option = self.skip_inline_space(j);
        let end = if self.at(option) == Some(OPEN_BRACKET) {
            self.closed_option_end(option)
        } else {
            None
        };
        if let Some(end) = end.filter(|&end| end > option) {
            let inner = &self.chars[(option + 1).min(end - 1)..end - 1];
            if Self::option_has_assignment(inner) {
                self.push(
                    start,
                    end,
                    MaskKind::Block,
                    Some(vec![span(start, j), span(option, end)]),
                );
                return end;
            }
        }
        self.push(start, j, MaskKind::Block, None);
        j
    }

    fn escaped_at(&self, k: usize) -> bool {
        let mut slashes = 0;
        while k > slashes && self.text[k - slashes - 1] == BACKSLASH {
            slashes += 1;
        }
        slashes % 2 == 1
    }

    fn argument_brace(&self, open: usize) -> bool {
        if self.escaped_at(open) {
            return true;
        }
        let mut k = open as isize - 1;
        while k >= 0 && is_js_space_unit(self.text[k as usize]) {
            k -= 1;
        }
        if k < 0 {
            return false;
        }
        let unit = self.text[k as usize];
        if unit == CLOSE_BRACKET || unit == CLOSE_BRACE {
            return true;
        }
        if !is_ascii_command_unit(Some(unit)) {
            return self.escaped_at(k as usize);
        }
        while k >= 0 && is_ascii_command_unit(Some(self.text[k as usize])) {
            k -= 1;
        }
        k >= 0 && self.text[k as usize] == BACKSLASH && !self.escaped_at(k as usize)
    }

    fn add_construct(&mut self, from: usize, to: usize, decoded: Vec<u16>) -> usize {
        let wrapped = from > 0
            && self.at(from - 1) == Some(OPEN_BRACE)
            && self.at(to) == Some(CLOSE_BRACE)
            && !self.argument_brace(from - 1);
        let start = if wrapped { from - 1 } else { from };
        let end = if wrapped { to + 1 } else { to };
        self.push(start, end, MaskKind::Block, None);
        self.constructs.push(LatexConstruct {
            from: start,
            to: end,
            text: decoded,
        });
        end
    }

    fn letter_macro_end(&self, k: usize) -> usize {
        if self.at(k) == Some(OPEN_BRACE) && self.at(k + 1) == Some(CLOSE_BRACE) {
            k + 2
        } else {
            self.skip_inline_space(k)
        }
    }

    fn accent_argument(
        &self,
        k: usize,
        control_word: bool,
        tie: bool,
    ) -> Option<(Vec<u16>, usize)> {
        let at = if control_word {
            self.skip_inline_space(k)
        } else {
            k
        };
        let ch = self.at(at);
        if ch == Some(OPEN_BRACE) {
            let end = self.match_group(at);
            let inner = lossy(&self.chars, at + 1, end.saturating_sub(1));
            let letters = if tie { &TIE_LETTERS } else { &SINGLE_LETTER };
            if let Some(found) = letters.first_str(&inner) {
                return Some((to_units(found.group(&inner, 1).unwrap_or("")), end));
            }
            return DOTLESS
                .first_str(&inner)
                .map(|found| (to_units(found.group(&inner, 1).unwrap_or("")), end));
        }
        if ch == Some(BACKSLASH)
            && self.control_word_end(at) == at + 2
            && matches!(self.at(at + 1), Some(unit) if unit == u16::from(b'i') || unit == u16::from(b'j'))
        {
            return Some((vec![self.chars[at + 1]], self.letter_macro_end(at + 2)));
        }
        match ch {
            Some(unit) if is_letter_unit(unit) => Some((vec![unit], at + 1)),
            _ => None,
        }
    }

    fn accent_construct(&mut self, start: usize, j: usize, name: &str) -> Option<usize> {
        if let Some((_, letter)) = LETTER_MACROS
            .iter()
            .find(|(macro_name, _)| *macro_name == name)
        {
            let end = self.letter_macro_end(j);
            return Some(self.add_construct(start, end, to_units(letter)));
        }
        if name == "-" || name == "/" {
            return Some(self.add_construct(start, j, Vec::new()));
        }
        let (_, mark) = ACCENT_MARKS.iter().find(|(accent, _)| *accent == name)?;
        let control_word = name.chars().any(|ch| ch.is_ascii_alphabetic());
        let (base, end) = self.accent_argument(j, control_word, name == "t")?;
        let mut combined = vec![base[0]];
        combined.extend(mark.encode_utf16(&mut [0; 2]).iter());
        combined.extend_from_slice(&base[1..]);
        let normalized: String = String::from_utf16_lossy(&combined).nfc().collect();
        Some(self.add_construct(start, end, to_units(&normalized)))
    }

    fn backslash_region(&mut self, start: usize, next: Option<u16>) -> usize {
        if next == Some(OPEN_PAREN) || next == Some(OPEN_BRACKET) {
            let inline = next == Some(OPEN_PAREN);
            let stop = self.end_of_math(start + 2, if inline { 3 } else { 4 });
            let kind = if inline {
                MaskKind::Inline
            } else {
                MaskKind::Block
            };
            self.push(start, stop, kind, None);
            return stop;
        }
        if next == Some(BACKSLASH) {
            let mut spans = vec![span(start, start + 2)];
            let mut k = self.skip_inline_space(start + 2);
            if self.at(k) == Some(OPEN_BRACKET) {
                let end = self.match_group(k);
                spans.push(span(k, end));
                k = end;
            }
            self.push(start, k, MaskKind::Block, Some(spans));
            return k;
        }
        if !is_command_unit(next) {
            let name = next
                .map(|unit| String::from_utf16_lossy(&[unit]))
                .unwrap_or_default();
            if let Some(construct) = self.accent_construct(start, start + 2, &name) {
                return construct;
            }
            self.push(start, start + 2, MaskKind::Block, None);
            return start + 2;
        }
        let mut j = start + 1;
        while j < self.n && is_command_unit(self.at(j)) {
            j += 1;
        }
        let name = lossy(self.text, start + 1, j);
        match self.accent_construct(start, j, &name) {
            Some(end) => end,
            None => self.named_command_region(start, j, &name),
        }
    }

    fn dollar_region(&mut self, start: usize, next: Option<u16>) -> usize {
        let mode = if next == Some(DOLLAR) { 2 } else { 1 };
        let stop = self.end_of_math(start + usize::from(mode), mode);
        let kind = if mode == 2 {
            MaskKind::Block
        } else {
            MaskKind::Inline
        };
        self.push(start, stop, kind, None);
        stop
    }

    fn region_at(&mut self, i: usize) -> usize {
        let c = self.chars[i];
        let next = self.at(i + 1);
        if c == PERCENT {
            let stop = self.end_of_line(i);
            self.push(i, stop, MaskKind::Block, None);
            return stop;
        }
        if c == BACKSLASH {
            return self.backslash_region(i, next);
        }
        if c == DOLLAR {
            return self.dollar_region(i, next);
        }
        if c < 0x80 && LATEX_SPECIAL.contains(&(c as u8)) {
            self.push(i, i + 1, MaskKind::Block, None);
        }
        i + 1
    }
}

fn collect_latex_regions(text: &[u16], preamble: bool) -> LatexScan {
    let mut collector = Collector::new(text);
    let source = SourceText::from_units(text.to_vec());
    for pattern in [&*URL, email_address_pattern()] {
        for found in pattern.find_all(&source).matches {
            collector.push(found.from, found.to, MaskKind::Inline, None);
            collector.blank_source(found.from, found.to);
        }
    }
    let mut i = 0;
    while i < collector.n {
        i = collector.region_at(i);
    }
    let masked_preamble_end = if preamble {
        collector.preamble_end
    } else {
        None
    };
    if let Some(end) = masked_preamble_end.filter(|&end| end > 0) {
        collector.push(0, end, MaskKind::Block, None);
    }
    let mut regions = collector.regions;
    regions.sort_by(|left, right| left.from.cmp(&right.from).then(right.to.cmp(&left.to)));
    let constructs = collector
        .constructs
        .into_iter()
        .filter(|construct| masked_preamble_end.is_none_or(|end| construct.from >= end))
        .collect();
    LatexScan {
        regions,
        constructs,
    }
}

fn mask_regions(text: &[u16], regions: &[MaskRegion]) -> Vec<u16> {
    let mut out = text.to_vec();
    let mut applied = 0;
    for region in regions {
        if region.to <= applied {
            continue;
        }
        for blank in &region.blanks {
            let from = blank.from.max(applied);
            if blank.to > from {
                blank_into(&mut out, from, blank.to);
            }
        }
        applied = region.to;
    }
    out
}

#[derive(Clone, Debug)]
pub(crate) struct DecodedProse {
    pub text: Vec<u16>,
    pub decoded: bool,
    pub starts: Vec<usize>,
    pub ends: Vec<usize>,
    pub source_length: usize,
}

impl DecodedProse {
    pub fn plain(masked: Vec<u16>, source_length: usize) -> Self {
        Self {
            text: masked,
            decoded: false,
            starts: Vec::new(),
            ends: Vec::new(),
            source_length,
        }
    }

    pub fn start(&self, index: usize) -> usize {
        if !self.decoded {
            return index;
        }
        self.starts
            .get(index)
            .copied()
            .unwrap_or(self.source_length)
    }

    pub fn end(&self, index: usize) -> usize {
        if !self.decoded {
            return index + 1;
        }
        self.ends.get(index).copied().unwrap_or(self.source_length)
    }
}

fn uncommented(text: &[u16], index: usize) -> bool {
    let line_start = last_index_of_units(text, &[NEWLINE], index).map_or(0, |at| at + 1);
    let line = &text[line_start.min(index)..index];
    for (position, &unit) in line.iter().enumerate() {
        if unit != PERCENT {
            continue;
        }
        let slashes = line[..position]
            .iter()
            .rev()
            .take_while(|&&unit| unit == BACKSLASH)
            .count();
        if slashes % 2 == 0 {
            return false;
        }
    }
    true
}

fn german_babel_indices(source: &SourceText) -> Vec<usize> {
    let options: Vec<_> = BABEL_OPTION_LIST
        .find_all(source)
        .matches
        .into_iter()
        .filter(|found| GERMAN_BABEL_OPTION.is_match(found.text(source, 1).unwrap_or("")))
        .collect();
    let mut indices: Vec<usize> = options.iter().map(|found| found.from).collect();
    let mut next = 0;
    for package in GERMAN_BABEL_PACKAGE.find_all(source).matches {
        let index = package.from;
        while next < options.len() && options[next].to <= index {
            next += 1;
        }
        match options.get(next) {
            Some(option) if option.from <= index => {}
            _ => indices.push(index),
        }
    }
    indices
}

fn german_shorthands(text: &[u16], masked: &[u16]) -> Vec<LatexConstruct> {
    let source = SourceText::from_units(text.to_vec());
    let active = german_babel_indices(&source)
        .into_iter()
        .any(|index| uncommented(text, index));
    if !active {
        return Vec::new();
    }
    let mut constructs = Vec::new();
    let mut index = index_of_units(masked, &[QUOTE], 0);
    while let Some(mut at) = index {
        let decoded = masked
            .get(at + 1)
            .and_then(|next| GERMAN_SHORTHANDS.iter().find(|(key, _)| key == next));
        if let Some((_, decoded)) = decoded {
            constructs.push(LatexConstruct {
                from: at,
                to: at + 2,
                text: to_units(decoded),
            });
            at += 1;
        }
        index = index_of_units(masked, &[QUOTE], at + 1);
    }
    constructs
}

fn decode_scan(text: &[u16], scan: &LatexScan) -> DecodedProse {
    let masked = mask_regions(text, &scan.regions);
    let mut constructs: Vec<LatexConstruct> = scan.constructs.clone();
    constructs.extend(german_shorthands(text, &masked));
    if constructs.is_empty() {
        return DecodedProse::plain(masked, text.len());
    }
    constructs.sort_by_key(|construct| construct.from);
    let mut decoded = Vec::with_capacity(masked.len());
    let mut starts = Vec::with_capacity(masked.len());
    let mut ends = Vec::with_capacity(masked.len());
    let mut cursor = 0;
    for construct in &constructs {
        if construct.from < cursor {
            continue;
        }
        while cursor < construct.from {
            decoded.push(masked[cursor]);
            starts.push(cursor);
            ends.push(cursor + 1);
            cursor += 1;
        }
        decoded.extend_from_slice(&construct.text);
        starts.extend(std::iter::repeat_n(construct.from, construct.text.len()));
        ends.extend(std::iter::repeat_n(construct.to, construct.text.len()));
        cursor = construct.to;
    }
    while cursor < masked.len() {
        decoded.push(masked[cursor]);
        starts.push(cursor);
        ends.push(cursor + 1);
        cursor += 1;
    }
    DecodedProse {
        text: decoded,
        decoded: true,
        starts,
        ends,
        source_length: text.len(),
    }
}

pub(crate) struct LocatedWord {
    pub from: usize,
    pub to: usize,
    pub word: Vec<u16>,
}

pub(crate) struct DecodedWord {
    pub word: LocatedWord,
    pub compound: Option<LocatedWord>,
}

pub(crate) fn decoded_words(prose: &DecodedProse, source: &[u16]) -> Vec<DecodedWord> {
    let text = SourceText::from_units(prose.text.clone());
    let locate = |from: usize, to: usize, word: &str| {
        let source_from = prose.start(from);
        let source_to = prose.end(to - 1);
        let word = if prose.decoded {
            to_units(word)
        } else {
            source[source_from.min(source.len())..source_to.min(source.len())].to_vec()
        };
        LocatedWord {
            from: source_from,
            to: source_to,
            word,
        }
    };
    spelling_word_spans(&text)
        .into_iter()
        .map(|item| DecodedWord {
            word: locate(item.from, item.to, &item.word),
            compound: item
                .compound
                .as_ref()
                .map(|(from, to, word)| locate(*from, *to, word)),
        })
        .collect()
}

fn write_decoded_units(out: &mut [u16], text: &[u16], prose: &DecodedProse) -> Vec<MaskSpan> {
    let mut written: Vec<MaskSpan> = Vec::new();
    for item in decoded_words(prose, text) {
        let unit = item.compound.as_ref().unwrap_or(&item.word);
        if written.last().is_some_and(|last| last.from == unit.from) {
            continue;
        }
        let original = &text
            [unit.from.min(text.len())..unit.to.min(text.len()).max(unit.from.min(text.len()))];
        if unit.word.as_slice() == original {
            continue;
        }
        if unit.to < unit.from || unit.word.len() > unit.to - unit.from {
            continue;
        }
        blank_into(out, unit.from, unit.to);
        for (offset, &value) in unit.word.iter().enumerate() {
            out[unit.from + offset] = value;
        }
        written.push(span(unit.from, unit.to));
    }
    written
}

pub(crate) fn write_decoded_words(
    out: &mut [u16],
    masked: Vec<MaskSpan>,
    text: &[u16],
    prose: &DecodedProse,
) -> Vec<MaskSpan> {
    if !prose.decoded {
        return masked;
    }
    let written = write_decoded_units(out, text, prose);
    if written.is_empty() {
        return masked;
    }
    let mut all = masked;
    all.extend(written);
    all.sort_by_key(|item| item.from);
    let mut merged: Vec<MaskSpan> = Vec::with_capacity(all.len());
    for item in all {
        match merged.last_mut() {
            Some(last) if item.from < last.to => last.to = last.to.max(item.to),
            _ => merged.push(item),
        }
    }
    merged
}

fn is_letter_or_number_unit(unit: u16) -> bool {
    is_letter_unit(unit) || is_number_unit(unit)
}

pub(crate) fn write_prose_placeholder(out: &mut [u16], text: &[u16], from: usize, to: usize) {
    let length = to.saturating_sub(from);
    let placeholder = if length >= PROSE_PLACEHOLDER.len() {
        PROSE_PLACEHOLDER
    } else {
        PROSE_SHORT_PLACEHOLDER
    };
    let placeholder = to_units(placeholder);
    let before = if from > 0 {
        text.get(from - 1).copied()
    } else {
        Some(SPACE)
    };
    let after = if length == placeholder.len() {
        text.get(to).copied().unwrap_or(SPACE)
    } else {
        SPACE
    };
    let crosses_line =
        text[from.min(text.len())..(from + placeholder.len()).min(text.len())].contains(&NEWLINE);
    if length < placeholder.len()
        || before.is_some_and(is_letter_or_number_unit)
        || is_letter_or_number_unit(after)
        || crosses_line
    {
        return;
    }
    out[from..from + placeholder.len()].copy_from_slice(&placeholder);
}

fn blank_region_spans(out: &mut [u16], blanks: &[MaskSpan], from: usize) {
    for item in blanks {
        let start = item.from.max(from);
        if item.to > start {
            blank_into(out, start, item.to);
        }
    }
}

pub fn mask_latex_for_prose_regions(text: &[u16]) -> ProseMask {
    let mut out = text.to_vec();
    let mut masked = Vec::new();
    let mut applied = 0;
    let scan = collect_latex_regions(text, true);
    for region in &scan.regions {
        if region.to <= applied {
            continue;
        }
        let from = region.from.max(applied);
        applied = region.to;
        masked.push(span(from, region.to));
        if region.kind == MaskKind::Block {
            blank_region_spans(&mut out, &region.blanks, from);
            continue;
        }
        blank_into(&mut out, from, region.to);
        write_prose_placeholder(&mut out, text, from, region.to);
    }
    let decoded = decode_scan(text, &scan);
    let masked = write_decoded_words(&mut out, masked, text, &decoded);
    ProseMask { prose: out, masked }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn prose(text: &str) -> String {
        String::from_utf16_lossy(&mask_latex_for_prose_regions(&to_units(text)).prose)
    }

    #[test]
    fn math_and_citations_leave_placeholders() {
        assert_eq!(
            prose("We add $x$ here."),
            format!("We add X{} here.", " ".repeat(2))
        );
        assert_eq!(
            prose("See \\cite{knuth} now."),
            format!("See Dummy{} now.", " ".repeat(7))
        );
    }

    #[test]
    fn opaque_environments_and_comments_are_blank() {
        let text = "A\n\\begin{equation}\nx\n\\end{equation}\nB % note\n";
        let expected = format!(
            "A\n{}\n \n{}\nB{}\n",
            " ".repeat(16),
            " ".repeat(14),
            " ".repeat(7)
        );
        assert_eq!(prose(text), expected);
    }

    #[test]
    fn accents_are_decoded_in_place() {
        assert_eq!(prose("caf\\'e bar"), "café   bar");
    }

    #[test]
    fn the_preamble_is_masked() {
        let text = "\\documentclass{article}\nHello\n\\begin{document}\nWorld\n\\end{document}\n";
        let out = prose(text);
        assert!(!out.contains("Hello"));
        assert!(out.contains("World"));
        assert_eq!(out.encode_utf16().count(), text.encode_utf16().count());
    }
}
