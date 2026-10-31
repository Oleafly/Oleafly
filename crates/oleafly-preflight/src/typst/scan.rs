use std::collections::HashMap;
use std::sync::{Arc, LazyLock, Mutex};

use crate::jsre::JsRegex;
use crate::text::{
    index_of_units, is_js_space_unit, is_letter_unit, is_mark_unit, is_number_unit, js_trim,
    js_trim_start, starts_with_units, utf16_len, SourceText, NEWLINE, SPACE,
};

#[repr(u8)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Kind {
    Markup = 0,
    Code = 1,
    String = 2,
    Comment = 3,
    Raw = 4,
    Math = 5,
    Escape = 6,
}

pub const MARKUP: u8 = Kind::Markup as u8;
pub const CODE: u8 = Kind::Code as u8;
pub const STRING: u8 = Kind::String as u8;
pub const COMMENT: u8 = Kind::Comment as u8;
pub const RAW: u8 = Kind::Raw as u8;
pub const MATH: u8 = Kind::Math as u8;
pub const ESCAPE: u8 = Kind::Escape as u8;

pub const TYPST_LABEL: &str = r"[\p{L}\p{M}\p{N}\p{Pc}][\p{L}\p{M}\p{N}\p{Pc}.:-]*";

const LINE_KEYWORDS: &[&str] = &[
    "let", "set", "show", "import", "include", "if", "for", "while", "context", "return",
];
const AUTOLINK_TRAILING: &str = "!,.:;?'";

const BACKSLASH: u16 = b'\\' as u16;
const DOLLAR: u16 = b'$' as u16;
const HASH: u16 = b'#' as u16;
const QUOTE: u16 = b'"' as u16;
const BACKTICK: u16 = b'`' as u16;
const OPEN_PAREN: u16 = b'(' as u16;
const CLOSE_PAREN: u16 = b')' as u16;
const OPEN_BRACKET: u16 = b'[' as u16;
const CLOSE_BRACKET: u16 = b']' as u16;
const OPEN_BRACE: u16 = b'{' as u16;
const CLOSE_BRACE: u16 = b'}' as u16;
const UNDERSCORE: u16 = b'_' as u16;
const HYPHEN: u16 = b'-' as u16;
const DOT: u16 = b'.' as u16;
const COMMA: u16 = b',' as u16;

pub struct TypstScan {
    pub text: SourceText,
    pub kinds: Vec<u8>,
    pub masked: SourceText,
    pub code: SourceText,
    pub markup: SourceText,
    pub comments: Vec<(usize, usize)>,
    pub strings: Vec<(usize, usize)>,
}

impl TypstScan {
    pub fn kind_at(&self, offset: usize) -> Option<u8> {
        self.kinds.get(offset).copied()
    }

    pub fn code_unit(&self, offset: usize) -> Option<u16> {
        self.code.units().get(offset).copied()
    }
}

#[derive(Clone, Copy, Debug)]
enum Frame {
    Markup {
        in_brackets: bool,
        depth: usize,
    },
    Math,
    Expr {
        line: bool,
        parens: usize,
        braces: usize,
        started: bool,
        in_ident: bool,
    },
}

fn ident_start(unit: Option<u16>) -> bool {
    unit.is_some_and(|unit| unit == UNDERSCORE || is_letter_unit(unit))
}

fn ident_continue(unit: Option<u16>) -> bool {
    unit.is_some_and(|unit| {
        unit == UNDERSCORE
            || unit == HYPHEN
            || is_letter_unit(unit)
            || is_mark_unit(unit)
            || is_number_unit(unit)
    })
}

fn autolink_unit(unit: u16) -> bool {
    char::from_u32(u32::from(unit))
        .is_some_and(|ch| ch.is_ascii_alphanumeric() || "!#$%&*+,-./:;=?@_~'".contains(ch))
}

fn is_autolink_trailing(unit: u16) -> bool {
    char::from_u32(u32::from(unit)).is_some_and(|ch| AUTOLINK_TRAILING.contains(ch))
}

struct Lexer<'a> {
    text: &'a [u16],
    kinds: Vec<u8>,
    stack: Vec<Frame>,
    comments: Vec<(usize, usize)>,
    strings: Vec<(usize, usize)>,
}

fn line_comment_end(text: &[u16], from: usize) -> usize {
    index_of_units(text, &[NEWLINE], from).unwrap_or(text.len())
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

fn raw_end(text: &[u16], from: usize) -> usize {
    let mut ticks = 0;
    while text.get(from + ticks) == Some(&BACKTICK) {
        ticks += 1;
    }
    if ticks == 2 {
        return from + 2;
    }
    let fence = vec![BACKTICK; ticks];
    match index_of_units(text, &fence, from + ticks) {
        Some(close) => close + ticks,
        None => text.len(),
    }
}

fn autolink_end(text: &[u16], i: usize) -> Option<usize> {
    if !starts_with_units(text, i, "http://") && !starts_with_units(text, i, "https://") {
        return None;
    }
    let mut end = i;
    while end < text.len() && autolink_unit(text[end]) {
        end += 1;
    }
    while end > i && is_autolink_trailing(text[end - 1]) {
        end -= 1;
    }
    Some(end)
}

fn identifier_at(text: &[u16], from: usize) -> String {
    if !ident_start(text.get(from).copied()) {
        return String::new();
    }
    let mut end = from + 1;
    while end < text.len() && ident_continue(Some(text[end])) {
        end += 1;
    }
    String::from_utf16_lossy(&text[from..end])
}

fn opens_expression(text: &[u16], i: usize) -> bool {
    let next = text.get(i + 1).copied();
    ident_start(next) || matches!(next, Some(OPEN_PAREN | OPEN_BRACE | OPEN_BRACKET | QUOTE))
}

impl Lexer<'_> {
    fn mark(&mut self, from: usize, to: usize, kind: u8) {
        let to = to.min(self.text.len());
        if from < to {
            self.kinds[from..to].fill(kind);
        }
    }

    fn trivia(&mut self, i: usize, allow_raw: bool) -> Option<usize> {
        if starts_with_units(self.text, i, "//") {
            let end = line_comment_end(self.text, i);
            self.mark(i, end, COMMENT);
            self.comments.push((i, end));
            return Some(end);
        }
        if starts_with_units(self.text, i, "/*") {
            let end = block_comment_end(self.text, i);
            self.mark(i, end, COMMENT);
            self.comments.push((i, end));
            return Some(end);
        }
        if allow_raw && self.text[i] == BACKTICK {
            let end = raw_end(self.text, i);
            self.mark(i, end, RAW);
            return Some(end);
        }
        None
    }

    fn push_expression(&mut self, i: usize) -> usize {
        let keyword = identifier_at(self.text, i + 1);
        self.mark(i, i + 1, CODE);
        self.stack.push(Frame::Expr {
            line: LINE_KEYWORDS.contains(&keyword.as_str()),
            parens: 0,
            braces: 0,
            started: false,
            in_ident: false,
        });
        i + 1
    }

    fn markup_step(&mut self, top: usize, i: usize) -> usize {
        let unit = self.text[i];
        if unit == BACKSLASH {
            let end = match self.text.get(i + 1) {
                None | Some(&NEWLINE) => i + 1,
                Some(_) => i + 2,
            };
            self.mark(i, end, ESCAPE);
            return end;
        }
        if let Some(link) = autolink_end(self.text, i) {
            self.mark(i, link, ESCAPE);
            return link;
        }
        if let Some(skipped) = self.trivia(i, true) {
            return skipped;
        }
        if unit == DOLLAR {
            self.mark(i, i + 1, MATH);
            self.stack.push(Frame::Math);
            return i + 1;
        }
        if unit == HASH && opens_expression(self.text, i) {
            return self.push_expression(i);
        }
        if let Frame::Markup {
            in_brackets: true,
            depth,
        } = &mut self.stack[top]
        {
            if unit == OPEN_BRACKET {
                *depth += 1;
            }
            if unit == CLOSE_BRACKET {
                if *depth == 0 {
                    self.mark(i, i + 1, CODE);
                    self.stack.pop();
                    return i + 1;
                }
                *depth -= 1;
            }
        }
        i + 1
    }

    fn math_step(&mut self, i: usize) -> usize {
        let unit = self.text[i];
        if unit == BACKSLASH {
            let end = self.text.len().min(i + 2);
            self.mark(i, end, MATH);
            return end;
        }
        if let Some(skipped) = self.trivia(i, false) {
            return skipped;
        }
        if unit == HASH && opens_expression(self.text, i) {
            return self.push_expression(i);
        }
        self.mark(i, i + 1, MATH);
        if unit == DOLLAR {
            self.stack.pop();
        }
        i + 1
    }

    fn consume_string(&mut self, i: usize) -> usize {
        let close = string_end(self.text, i);
        self.mark(i, i + 1, CODE);
        self.mark(i + 1, close, STRING);
        self.strings.push((i + 1, close));
        if close < self.text.len() {
            self.mark(close, close + 1, CODE);
        }
        self.text.len().min(close + 1)
    }

    fn open_content(&mut self, i: usize) -> usize {
        self.mark(i, i + 1, CODE);
        self.stack.push(Frame::Markup {
            in_brackets: true,
            depth: 0,
        });
        i + 1
    }

    fn inside_brackets(&self) -> bool {
        self.stack
            .iter()
            .rev()
            .find_map(|frame| match frame {
                Frame::Markup { in_brackets, .. } => Some(*in_brackets),
                _ => None,
            })
            .unwrap_or(false)
    }

    fn shallow_expression_step(&mut self, top: usize, i: usize) -> Option<usize> {
        let unit = self.text[i];
        let Frame::Expr {
            line,
            started,
            in_ident,
            ..
        } = self.stack[top]
        else {
            return None;
        };
        if line {
            if unit == NEWLINE {
                self.stack.pop();
                return Some(i);
            }
            if (unit == CLOSE_BRACKET && self.inside_brackets())
                || unit == CLOSE_PAREN
                || unit == CLOSE_BRACE
            {
                self.stack.pop();
                return Some(i);
            }
            return None;
        }
        if (!started || in_ident)
            && ident_continue(Some(unit))
            && (in_ident || ident_start(Some(unit)))
        {
            if let Frame::Expr {
                started, in_ident, ..
            } = &mut self.stack[top]
            {
                *started = true;
                *in_ident = true;
            }
            self.mark(i, i + 1, CODE);
            return Some(i + 1);
        }
        if started && unit == DOT && ident_start(self.text.get(i + 1).copied()) {
            if let Frame::Expr { in_ident, .. } = &mut self.stack[top] {
                *in_ident = true;
            }
            self.mark(i, i + 1, CODE);
            return Some(i + 1);
        }
        if unit == OPEN_PAREN
            || unit == OPEN_BRACKET
            || unit == OPEN_BRACE
            || (unit == QUOTE && !started)
        {
            return None;
        }
        self.stack.pop();
        Some(i)
    }

    fn expression_step(&mut self, top: usize, i: usize) -> usize {
        if let Some(skipped) = self.trivia(i, true) {
            return skipped;
        }
        if let Frame::Expr {
            parens: 0,
            braces: 0,
            ..
        } = self.stack[top]
        {
            if let Some(shallow) = self.shallow_expression_step(top, i) {
                return shallow;
            }
        }
        let unit = self.text[i];
        if let Frame::Expr {
            started, in_ident, ..
        } = &mut self.stack[top]
        {
            *in_ident = false;
            *started = true;
        }
        if unit == QUOTE {
            return self.consume_string(i);
        }
        if unit == OPEN_BRACKET {
            return self.open_content(i);
        }
        self.mark(i, i + 1, CODE);
        if let Frame::Expr { parens, braces, .. } = &mut self.stack[top] {
            if unit == OPEN_PAREN {
                *parens += 1;
            } else if unit == OPEN_BRACE {
                *braces += 1;
            } else if unit == CLOSE_PAREN && *parens > 0 {
                *parens -= 1;
            } else if unit == CLOSE_BRACE && *braces > 0 {
                *braces -= 1;
            }
        }
        i + 1
    }
}

fn string_end(text: &[u16], from: usize) -> usize {
    let mut i = from + 1;
    while i < text.len() {
        if text[i] == BACKSLASH {
            i += 2;
        } else if text[i] == QUOTE {
            return i;
        } else {
            i += 1;
        }
    }
    text.len()
}

fn keep(text: &[u16], kinds: &[u8], accept: impl Fn(u8) -> bool) -> SourceText {
    let units = text
        .iter()
        .zip(kinds)
        .map(|(&unit, &kind)| {
            if unit == NEWLINE || accept(kind) {
                unit
            } else {
                SPACE
            }
        })
        .collect();
    SourceText::from_units(units)
}

pub fn scan_typst(text: &str) -> TypstScan {
    let source = SourceText::new(text.to_string());
    let units = source.units();
    let mut lexer = Lexer {
        text: units,
        kinds: vec![MARKUP; units.len()],
        stack: vec![Frame::Markup {
            in_brackets: false,
            depth: 0,
        }],
        comments: Vec::new(),
        strings: Vec::new(),
    };
    let mut i = 0;
    while i < units.len() {
        if lexer.stack.is_empty() {
            lexer.stack.push(Frame::Markup {
                in_brackets: false,
                depth: 0,
            });
        }
        let top = lexer.stack.len() - 1;
        i = match lexer.stack[top] {
            Frame::Markup { .. } => lexer.markup_step(top, i),
            Frame::Math => lexer.math_step(i),
            Frame::Expr { .. } => lexer.expression_step(top, i),
        };
    }
    let Lexer {
        kinds,
        comments,
        strings,
        ..
    } = lexer;
    let masked = keep(units, &kinds, |kind| kind != COMMENT && kind != RAW);
    let code = keep(units, &kinds, |kind| kind == CODE);
    let markup = keep(units, &kinds, |kind| kind == MARKUP);
    TypstScan {
        text: source,
        kinds,
        masked,
        code,
        markup,
        comments,
        strings,
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TypstArgument {
    pub name: Option<String>,
    pub from: usize,
    pub to: usize,
    pub value_from: usize,
    pub value_to: usize,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TypstCall {
    pub name: String,
    pub from: usize,
    pub open: usize,
    pub close: usize,
    pub args: Vec<TypstArgument>,
}

fn is_opener(unit: u16) -> bool {
    matches!(unit, OPEN_PAREN | OPEN_BRACKET | OPEN_BRACE)
}

fn is_closer(unit: u16) -> bool {
    matches!(unit, CLOSE_PAREN | CLOSE_BRACKET | CLOSE_BRACE)
}

fn matching_close(code: &[u16], open: usize) -> usize {
    let mut depth: i64 = 0;
    for (index, &unit) in code.iter().enumerate().skip(open) {
        if is_opener(unit) {
            depth += 1;
        } else if is_closer(unit) {
            depth -= 1;
            if depth == 0 {
                return index;
            }
        }
    }
    code.len()
}

pub fn trimmed_range(code: &[u16], from: usize, to: usize) -> (usize, usize) {
    let mut start = from;
    let mut end = to.min(code.len());
    while start < end && is_js_space_unit(code[start]) {
        start += 1;
    }
    while end > start && is_js_space_unit(code[end - 1]) {
        end -= 1;
    }
    (start, end)
}

static NAMED_ARGUMENT: LazyLock<JsRegex> =
    LazyLock::new(|| JsRegex::std(r"^([\p{L}_][\p{L}\p{N}_-]*)\s*:"));

fn argument(code: &SourceText, from: usize, to: usize) -> Option<TypstArgument> {
    let (start, end) = trimmed_range(code.units(), from, to);
    if start >= end {
        return None;
    }
    let slice = code.slice(start, end);
    match NAMED_ARGUMENT.first_str(&slice) {
        None => Some(TypstArgument {
            name: None,
            from: start,
            to: end,
            value_from: start,
            value_to: end,
        }),
        Some(named) => {
            let consumed = utf16_len(named.as_str(&slice));
            let (value_from, value_to) = trimmed_range(code.units(), start + consumed, end);
            Some(TypstArgument {
                name: named.group(&slice, 1).map(str::to_string),
                from: start,
                to: end,
                value_from,
                value_to,
            })
        }
    }
}

fn split_arguments(code: &SourceText, open: usize, close: usize) -> Vec<TypstArgument> {
    let units = code.units();
    let mut args = Vec::new();
    let mut depth: i64 = 0;
    let mut start = open + 1;
    let end = close.min(units.len());
    for (index, &unit) in units.iter().enumerate().take(end).skip(open + 1) {
        if is_opener(unit) {
            depth += 1;
        } else if is_closer(unit) {
            depth -= 1;
        } else if unit == COMMA && depth == 0 {
            args.extend(argument(code, start, index));
            start = index + 1;
        }
    }
    args.extend(argument(code, start, close));
    args
}

fn escape_name(name: &str) -> String {
    let mut out = String::with_capacity(name.len());
    for ch in name.chars() {
        if ".*+?^${}()|[]\\".contains(ch) {
            out.push('\\');
        }
        out.push(ch);
    }
    out
}

pub fn call_at(scan: &TypstScan, name: &str, from: usize, open: usize) -> TypstCall {
    let close = matching_close(scan.code.units(), open);
    TypstCall {
        name: name.to_string(),
        from,
        open,
        close,
        args: split_arguments(&scan.code, open, close),
    }
}

pub fn closing_bracket(scan: &TypstScan, open: usize) -> usize {
    matching_close(scan.code.units(), open)
}

static CALL_PATTERNS: LazyLock<Mutex<HashMap<String, Arc<JsRegex>>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

fn call_pattern(names: &[&str]) -> Arc<JsRegex> {
    let alternation = names
        .iter()
        .map(|name| escape_name(name))
        .collect::<Vec<_>>()
        .join("|");
    let mut cache = CALL_PATTERNS
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    cache
        .entry(alternation.clone())
        .or_insert_with(|| {
            Arc::new(JsRegex::fancy(&format!(
                r"(?<![\p{{L}}\p{{N}}_.\-])({alternation})\s*\("
            )))
        })
        .clone()
}

fn calls_from(scan: &TypstScan, regex: &JsRegex, source: &SourceText) -> Vec<TypstCall> {
    regex
        .find_all(source)
        .matches
        .into_iter()
        .map(|found| {
            let name = found.text(source, 1).unwrap_or("").to_string();
            call_at(scan, &name, found.from, found.to - 1)
        })
        .collect()
}

pub fn typst_calls(scan: &TypstScan, names: &[&str]) -> Vec<TypstCall> {
    if names.is_empty() {
        return Vec::new();
    }
    let regex = call_pattern(names);
    calls_from(scan, &regex, &scan.code)
}

pub fn typst_method_calls(scan: &TypstScan, method: &str) -> Vec<TypstCall> {
    let regex = JsRegex::std(&format!(r"\.({})\s*\(", escape_name(method)));
    calls_from(scan, &regex, &scan.code)
}

static SHOW_RULE_CALL: LazyLock<JsRegex> = LazyLock::new(|| {
    JsRegex::fancy(concat!(
        r"(?<![\p{L}\p{N}_.-])show\s*:\s*(?:[\p{L}_][\p{L}\p{N}_-]*\s*=>\s*)?",
        r"([\p{L}_][\p{L}\p{N}_.-]*)\s*\(",
    ))
});

pub fn typst_show_rule_calls(scan: &TypstScan) -> Vec<TypstCall> {
    calls_from(scan, &SHOW_RULE_CALL, &scan.code)
}

pub fn named_argument<'c>(call: &'c TypstCall, name: &str) -> Option<&'c TypstArgument> {
    call.args
        .iter()
        .find(|arg| arg.name.as_deref() == Some(name))
}

pub fn positional_argument<'c>(
    scan: &TypstScan,
    call: &'c TypstCall,
    index: usize,
) -> Option<&'c TypstArgument> {
    call.args
        .iter()
        .filter(|arg| arg.name.is_none() && !starts_with_units(scan.code.units(), arg.from, ".."))
        .nth(index)
}

pub fn unescape_typst_string(raw: &str) -> String {
    let mut out = String::with_capacity(raw.len());
    let mut chars = raw.chars().peekable();
    while let Some(ch) = chars.next() {
        if ch != '\\' {
            out.push(ch);
            continue;
        }
        match chars.peek().copied() {
            Some(next) if !matches!(next, '\n' | '\r' | '\u{2028}' | '\u{2029}') => {
                chars.next();
                out.push(match next {
                    'n' => '\n',
                    't' => '\t',
                    other => other,
                });
            }
            _ => out.push(ch),
        }
    }
    out
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TypstStringValue {
    pub value: String,
    pub from: usize,
    pub to: usize,
}

pub fn string_value(scan: &TypstScan, from: usize, to: usize) -> Option<TypstStringValue> {
    let code = scan.code.units();
    let (start, end) = trimmed_range(code, from, to);
    if end < start + 2 || code.get(start) != Some(&QUOTE) || code.get(end - 1) != Some(&QUOTE) {
        return None;
    }
    let &(literal_from, literal_to) = scan
        .strings
        .iter()
        .find(|&&(item_from, item_to)| item_from == start + 1 && item_to == end - 1)?;
    Some(TypstStringValue {
        value: unescape_typst_string(&scan.text.slice(literal_from, literal_to)),
        from: literal_from,
        to: literal_to,
    })
}

pub fn strings_within(scan: &TypstScan, from: usize, to: usize) -> Vec<TypstStringValue> {
    scan.strings
        .iter()
        .filter(|&&(item_from, item_to)| item_from >= from && item_to <= to)
        .map(|&(item_from, item_to)| TypstStringValue {
            value: unescape_typst_string(&scan.text.slice(item_from, item_to)),
            from: item_from,
            to: item_to,
        })
        .collect()
}

pub fn is_blank_value(scan: &TypstScan, from: usize, to: usize) -> bool {
    let (start, end) = trimmed_range(scan.code.units(), from, to);
    let compact: String = scan
        .code
        .slice(start, end)
        .chars()
        .filter(|&ch| !crate::text::is_js_space(ch))
        .collect();
    match compact.as_str() {
        "none" | "()" | "" => true,
        "\"\"" => {
            string_value(scan, start, end).is_some_and(|value| js_trim(&value.value).is_empty())
        }
        "[]" => js_trim(&scan.text.slice(start + 1, end.saturating_sub(1))).is_empty(),
        _ => false,
    }
}

pub fn is_code_at(scan: &TypstScan, offset: usize) -> bool {
    scan.kind_at(offset) == Some(CODE)
}

fn parse_int(part: &str) -> Option<f64> {
    let digits: String = js_trim_start(part)
        .chars()
        .take_while(char::is_ascii_digit)
        .collect();
    if digits.is_empty() {
        return None;
    }
    digits.parse::<f64>().ok()
}

pub fn typst_version_at_least(version: Option<&str>, minimum: &[u32]) -> bool {
    let Some(version) = version.filter(|version| !version.is_empty()) else {
        return true;
    };
    let trimmed = js_trim(version);
    let without_v = trimmed
        .strip_prefix('v')
        .or_else(|| trimmed.strip_prefix('V'))
        .unwrap_or(trimmed);
    let parts: Vec<Option<f64>> = without_v
        .split(['.', '+', '-'])
        .take(minimum.len())
        .map(parse_int)
        .collect();
    if parts.iter().any(Option::is_none) {
        return true;
    }
    for (index, &wanted) in minimum.iter().enumerate() {
        let actual = parts.get(index).copied().flatten().unwrap_or(0.0);
        let wanted = f64::from(wanted);
        if actual != wanted {
            return actual > wanted;
        }
    }
    true
}

pub fn directory_of(path: &str) -> &str {
    match path.rfind('/') {
        Some(slash) => &path[..=slash],
        None => "",
    }
}

pub fn normalize_project_path(path: &str) -> Option<String> {
    let replaced = path.replace('\\', "/");
    let mut parts: Vec<&str> = Vec::new();
    for part in replaced.split('/') {
        if part.is_empty() || part == "." {
            continue;
        }
        if part == ".." {
            parts.pop()?;
        } else {
            parts.push(part);
        }
    }
    Some(parts.join("/"))
}

static URL_SCHEME: LazyLock<JsRegex> = LazyLock::new(|| JsRegex::std(r"(?i)^[a-z][a-z0-9+.-]*://"));

pub fn is_external_typst_path(raw: &str) -> bool {
    raw.starts_with('@') || URL_SCHEME.is_match(raw)
}

/// A Typst path relative to the file that names it, or to the project root
/// when it starts with `/`.
pub fn resolve_typst_path(from_file: Option<&str>, raw: &str) -> Option<String> {
    if is_external_typst_path(raw) {
        return None;
    }
    let base = match raw.strip_prefix('/') {
        Some(rooted) => rooted.to_string(),
        None => format!("{}{raw}", directory_of(from_file.unwrap_or(""))),
    };
    normalize_project_path(&base)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scan_kinds_have_one_entry_per_utf16_unit() {
        let scan = scan_typst("😀 #let x = \"a\\\"b\"");
        assert_eq!(scan.kinds.len(), scan.text.len_utf16());
        assert_eq!(scan.code.len_utf16(), scan.text.len_utf16());
    }

    #[test]
    fn string_literals_survive_escaped_quotes() {
        let scan = scan_typst("#let x = \"a\\\"b\"");
        let (from, to) = scan.strings[0];
        assert_eq!(scan.text.slice(from, to), "a\\\"b");
    }

    #[test]
    fn calls_split_named_and_positional_arguments() {
        let scan = scan_typst("#image(\"a.png\", alt: \"A chart\")");
        let calls = typst_calls(&scan, &["image"]);
        assert_eq!(calls.len(), 1);
        let alt = named_argument(&calls[0], "alt").unwrap();
        assert_eq!(
            string_value(&scan, alt.value_from, alt.value_to)
                .unwrap()
                .value,
            "A chart"
        );
        let path = positional_argument(&scan, &calls[0], 0).unwrap();
        assert_eq!(
            string_value(&scan, path.value_from, path.value_to)
                .unwrap()
                .value,
            "a.png"
        );
    }

    #[test]
    fn comments_and_raw_text_are_masked() {
        let scan = scan_typst("a // c\n`raw` b");
        assert_eq!(scan.masked.as_str(), "a     \n      b");
        assert_eq!(scan.comments, vec![(2, 6)]);
    }

    #[test]
    fn versions_compare_numerically() {
        assert!(typst_version_at_least(Some("0.14.0"), &[0, 14, 0]));
        assert!(!typst_version_at_least(Some("v0.13.1"), &[0, 14, 0]));
        assert!(typst_version_at_least(None, &[0, 14, 0]));
        assert!(typst_version_at_least(Some("nightly"), &[0, 14, 0]));
    }

    #[test]
    fn typst_paths_resolve_from_the_naming_file() {
        assert_eq!(
            resolve_typst_path(Some("ch/a.typ"), "../img/x.png").as_deref(),
            Some("img/x.png")
        );
        assert_eq!(
            resolve_typst_path(Some("ch/a.typ"), "/x.png").as_deref(),
            Some("x.png")
        );
        assert_eq!(resolve_typst_path(None, "@preview/x:1.0.0"), None);
        assert_eq!(resolve_typst_path(None, "../x"), None);
    }
}
