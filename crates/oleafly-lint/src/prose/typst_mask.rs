use std::sync::LazyLock;

use oleafly_preflight::jsre::JsRegex;
use oleafly_preflight::text::{
    index_of_units, is_js_space, is_js_space_unit, is_letter, is_letter_unit, is_number,
    starts_with_units, to_units, SourceText,
};

use super::latex_mask::{write_decoded_words, write_prose_placeholder, DecodedProse};
use super::spelling_words::email_address_pattern;
use super::typst_syntax::{
    is_typst_identifier_continue_at, typst_autolink_end, typst_identifier_end, typst_reference_end,
};
use super::{code_point_at, MaskSpan, ProseMask, JS_SPACE_CLASS};

const NEWLINE: u16 = b'\n' as u16;
const CARRIAGE_RETURN: u16 = b'\r' as u16;
const SPACE: u16 = b' ' as u16;
const TAB: u16 = b'\t' as u16;
const BACKSLASH: u16 = b'\\' as u16;
const BACKTICK: u16 = b'`' as u16;
const QUOTE: u16 = b'"' as u16;
const DOLLAR: u16 = b'$' as u16;
const HASH: u16 = b'#' as u16;
const AT: u16 = b'@' as u16;
const LESS_THAN: u16 = b'<' as u16;
const GREATER_THAN: u16 = b'>' as u16;
const OPEN_BRACKET: u16 = b'[' as u16;
const CLOSE_BRACKET: u16 = b']' as u16;
const OPEN_PAREN: u16 = b'(' as u16;
const CLOSE_PAREN: u16 = b')' as u16;
const OPEN_BRACE: u16 = b'{' as u16;
const CLOSE_BRACE: u16 = b'}' as u16;
const DOT: u16 = b'.' as u16;
const COLON: u16 = b':' as u16;
const SEMICOLON: u16 = b';' as u16;
const STAR: u16 = b'*' as u16;
const UNDERSCORE: u16 = b'_' as u16;
const EQUALS: u16 = b'=' as u16;
const MINUS: u16 = b'-' as u16;
const PLUS: u16 = b'+' as u16;
const SLASH: u16 = b'/' as u16;
const PERCENT: u16 = b'%' as u16;
const LINE_SEPARATOR: u16 = 0x2028;
const PARAGRAPH_SEPARATOR: u16 = 0x2029;

const STATEMENT_KEYWORDS: &[&str] = &["let", "set", "show", "import", "return"];
const CONTROL_KEYWORDS: &[&str] = &["if", "for", "while"];
const EXPRESSION_KEYWORDS: &[&str] = &["context", "include"];

static REMOTE_URL: LazyLock<JsRegex> = LazyLock::new(|| {
    JsRegex::std(&format!(
        r"(?i)(?:https?://|www\.)[^{JS_SPACE_CLASS}<>()\[\]{{}}]+"
    ))
});

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum RegionKind {
    Block,
    Inline,
}

#[derive(Clone, Copy, Debug)]
struct TypstRegion {
    from: usize,
    to: usize,
    kind: RegionKind,
}

#[derive(Clone, Debug)]
struct TypstConstruct {
    from: usize,
    to: usize,
    text: Vec<u16>,
}

struct Owner {
    run_start: usize,
    kind: RegionKind,
    has_content: bool,
    segments: Vec<MaskSpan>,
}

#[derive(Clone, Copy, Default)]
struct OpenCode {
    paren: usize,
    brace: usize,
}

impl OpenCode {
    fn slot(&mut self, close: u16) -> &mut usize {
        if close == CLOSE_PAREN {
            &mut self.paren
        } else {
            &mut self.brace
        }
    }

    fn get(&self, close: u16) -> usize {
        if close == CLOSE_PAREN {
            self.paren
        } else {
            self.brace
        }
    }
}

struct MarkupFrame {
    owner: Option<usize>,
    closes: bool,
    depth: usize,
    parent: Option<usize>,
    saved_code: OpenCode,
}

#[derive(Clone, Copy)]
enum Frame {
    Markup(usize),
    Code {
        owner: usize,
        close: u16,
    },
    Statement {
        owner: usize,
    },
    Control {
        owner: usize,
        is_loop: bool,
        after_body: bool,
    },
    Chain {
        owner: usize,
    },
    Expression {
        owner: usize,
        root: bool,
        skip_space: bool,
        started: bool,
    },
}

fn is_space(unit: Option<u16>) -> bool {
    matches!(unit, Some(SPACE) | Some(TAB))
}

fn is_digit(unit: Option<u16>) -> bool {
    unit.is_some_and(|unit| (u16::from(b'0')..=u16::from(b'9')).contains(&unit))
}

fn is_hex_digit(unit: Option<u16>) -> bool {
    unit.is_some_and(|unit| unit < 0x80 && (unit as u8).is_ascii_hexdigit())
}

fn end_of_line(text: &[u16], from: usize) -> usize {
    index_of_units(text, &[NEWLINE], from).unwrap_or(text.len())
}

fn closing_quote(text: &[u16], from: usize) -> usize {
    let mut cursor = from;
    while cursor < text.len() {
        if text[cursor] == BACKSLASH {
            cursor += 2;
            continue;
        }
        if text[cursor] == QUOTE {
            return cursor + 1;
        }
        cursor += 1;
    }
    text.len()
}

fn closing_block_comment(text: &[u16], from: usize) -> usize {
    let mut depth = 1usize;
    let mut cursor = from + 2;
    while cursor < text.len() {
        if starts_with_units(text, cursor, "/*") {
            depth += 1;
            cursor += 2;
            continue;
        }
        if !starts_with_units(text, cursor, "*/") {
            cursor += 1;
            continue;
        }
        depth -= 1;
        if depth == 0 {
            return cursor + 2;
        }
        cursor += 2;
    }
    text.len()
}

fn closing_raw_span(text: &[u16], from: usize) -> usize {
    let mut width = 1;
    while text.get(from + width) == Some(&BACKTICK) {
        width += 1;
    }
    let fence = vec![BACKTICK; width];
    index_of_units(text, &fence, from + width).map_or(text.len(), |close| close + width)
}

fn closing_math(text: &[u16], from: usize) -> usize {
    let mut cursor = from + 1;
    while cursor < text.len() {
        if text[cursor] == BACKSLASH {
            cursor += 2;
            continue;
        }
        if text[cursor] == DOLLAR {
            return cursor + 1;
        }
        cursor += 1;
    }
    text.len()
}

fn number_end(text: &[u16], from: usize) -> usize {
    let mut end = from;
    while is_digit(text.get(end).copied()) {
        end += 1;
    }
    if text.get(end) == Some(&DOT) && is_digit(text.get(end + 1).copied()) {
        end += 1;
        while is_digit(text.get(end).copied()) {
            end += 1;
        }
    }
    while end < text.len() && (is_letter_unit(text[end]) || text[end] == PERCENT) {
        end += 1;
    }
    end
}

fn raw_kind(text: &[u16], from: usize, to: usize) -> RegionKind {
    if starts_with_units(text, from, "```") || text[from..to.min(text.len())].contains(&NEWLINE) {
        RegionKind::Block
    } else {
        RegionKind::Inline
    }
}

fn math_kind(text: &[u16], from: usize, to: usize) -> RegionKind {
    let display = to - from >= 3
        && text.get(to - 1) == Some(&DOLLAR)
        && text.get(from + 1).copied().is_some_and(is_js_space_unit)
        && text.get(to - 2).copied().is_some_and(is_js_space_unit);
    if display {
        RegionKind::Block
    } else {
        RegionKind::Inline
    }
}

fn label_end(text: &[u16], from: usize) -> Option<usize> {
    let mut end = typst_reference_end(text, from + 1);
    if end == from + 1 {
        return None;
    }
    while matches!(text.get(end), Some(&DOT) | Some(&COLON)) {
        end += 1;
    }
    (text.get(end) == Some(&GREATER_THAN)).then_some(end + 1)
}

fn code_opaque_end(text: &[u16], cursor: usize) -> Option<usize> {
    let unit = text[cursor];
    if unit == QUOTE {
        return Some(closing_quote(text, cursor + 1));
    }
    if starts_with_units(text, cursor, "//") {
        return Some(end_of_line(text, cursor));
    }
    if starts_with_units(text, cursor, "/*") {
        return Some(closing_block_comment(text, cursor));
    }
    if unit == BACKTICK {
        return Some(closing_raw_span(text, cursor));
    }
    if unit == DOLLAR {
        return Some(closing_math(text, cursor));
    }
    None
}

fn stands_alone(text: &[u16], from: usize, to: usize) -> bool {
    let mut before = from as isize - 1;
    while before >= 0 && is_space(Some(text[before as usize])) {
        before -= 1;
    }
    let mut after = to;
    while is_space(text.get(after).copied()) {
        after += 1;
    }
    (before < 0 || text[before as usize] == NEWLINE)
        && (after >= text.len() || text[after] == NEWLINE || text[after] == CARRIAGE_RETURN)
}

fn blank(characters: &mut [u16], from: usize, to: usize) {
    for unit in characters.iter_mut().take(to).skip(from) {
        if *unit != NEWLINE && *unit != CARRIAGE_RETURN {
            *unit = SPACE;
        }
    }
}

struct Scanner<'a> {
    text: &'a [u16],
    characters: Vec<u16>,
    regions: Vec<TypstRegion>,
    constructs: Vec<TypstConstruct>,
    stack: Vec<Frame>,
    owners: Vec<Owner>,
    markups: Vec<MarkupFrame>,
    markup: usize,
    open_code: OpenCode,
}

impl<'a> Scanner<'a> {
    fn new(text: &'a [u16]) -> Self {
        let root = MarkupFrame {
            owner: None,
            closes: false,
            depth: 0,
            parent: None,
            saved_code: OpenCode::default(),
        };
        Self {
            text,
            characters: text.to_vec(),
            regions: Vec::new(),
            constructs: Vec::new(),
            stack: vec![Frame::Markup(0)],
            owners: Vec::new(),
            markups: vec![root],
            markup: 0,
            open_code: OpenCode::default(),
        }
    }

    fn run(&mut self) {
        let mut cursor = 0;
        while cursor < self.text.len() {
            cursor = self.step(cursor);
        }
        while self.stack.len() > 1 {
            self.pop(self.text.len());
        }
    }

    fn mask(&mut self, from: usize, to: usize, kind: RegionKind) -> usize {
        if to <= from {
            return to;
        }
        blank(&mut self.characters, from, to);
        let standalone = kind == RegionKind::Inline && stands_alone(self.text, from, to);
        self.regions.push(TypstRegion {
            from,
            to,
            kind: if standalone { RegionKind::Block } else { kind },
        });
        to
    }

    fn top(&self) -> Frame {
        self.stack
            .last()
            .copied()
            .unwrap_or(Frame::Markup(self.markup))
    }

    fn step(&mut self, cursor: usize) -> usize {
        let top = self.stack.len() - 1;
        match self.top() {
            Frame::Markup(markup) => self.markup_step(markup, cursor),
            Frame::Chain { owner } => self.chain_step(owner, cursor),
            Frame::Expression {
                owner,
                root,
                skip_space,
                started,
            } => self.expression_step(top, owner, root, skip_space, started, cursor),
            Frame::Control {
                owner,
                is_loop,
                after_body,
            } => self.control_step(top, owner, is_loop, after_body, cursor),
            Frame::Statement { owner } => self.statement_step(owner, cursor),
            Frame::Code { owner, close } => self.code_step(owner, close, cursor),
        }
    }

    fn push_code(&mut self, owner: usize, close: u16) {
        *self.open_code.slot(close) += 1;
        self.stack.push(Frame::Code { owner, close });
    }

    fn open_content(&mut self, owner: usize, at: usize) {
        self.owners[owner].has_content = true;
        self.close_run(owner, at + 1);
        self.markups.push(MarkupFrame {
            owner: Some(owner),
            closes: true,
            depth: 0,
            parent: Some(self.markup),
            saved_code: self.open_code,
        });
        self.markup = self.markups.len() - 1;
        self.open_code = OpenCode::default();
        self.stack.push(Frame::Markup(self.markup));
    }

    fn pop(&mut self, at: usize) {
        let Some(frame) = self.stack.pop() else {
            return;
        };
        match frame {
            Frame::Markup(markup) => {
                let popped = &self.markups[markup];
                let (parent, saved, owner) = (popped.parent, popped.saved_code, popped.owner);
                self.markup = parent.unwrap_or(self.markup);
                self.open_code = saved;
                if let Some(owner) = owner {
                    self.owners[owner].run_start = at;
                }
            }
            Frame::Code { close, .. } => {
                let slot = self.open_code.slot(close);
                *slot = slot.saturating_sub(1);
            }
            Frame::Expression {
                owner, root: true, ..
            } => self.finish(owner, at),
            _ => {}
        }
    }

    fn close_run(&mut self, owner: usize, to: usize) {
        let expression = &mut self.owners[owner];
        if to > expression.run_start {
            expression.segments.push(MaskSpan {
                from: expression.run_start,
                to,
            });
        }
        expression.run_start = to;
    }

    fn finish(&mut self, owner: usize, at: usize) {
        self.close_run(owner, at);
        let expression = &self.owners[owner];
        let kind = if expression.has_content {
            RegionKind::Block
        } else {
            expression.kind
        };
        let segments = expression.segments.clone();
        for segment in segments {
            self.mask(segment.from, segment.to, kind);
        }
    }

    fn markup_step(&mut self, markup: usize, cursor: usize) -> usize {
        let unit = self.text[cursor];
        if unit == OPEN_BRACKET {
            self.markups[markup].depth += 1;
            return cursor + 1;
        }
        if unit == CLOSE_BRACKET {
            if self.markups[markup].depth > 0 {
                self.markups[markup].depth -= 1;
            } else if self.markups[markup].closes {
                self.pop(cursor);
            }
            return cursor + 1;
        }
        if unit == HASH {
            return self.start_expression(cursor);
        }
        self.markup_token(cursor)
    }

    fn markup_token(&mut self, cursor: usize) -> usize {
        let text = self.text;
        let unit = text[cursor];
        if unit == BACKSLASH {
            return self.escape(cursor);
        }
        if let Some(link) = typst_autolink_end(text, cursor) {
            return self.mask(cursor, link, RegionKind::Inline);
        }
        if starts_with_units(text, cursor, "//") {
            return self.mask(cursor, end_of_line(text, cursor), RegionKind::Block);
        }
        if starts_with_units(text, cursor, "/*") {
            return self.mask(
                cursor,
                closing_block_comment(text, cursor),
                RegionKind::Block,
            );
        }
        if unit == BACKTICK {
            let end = closing_raw_span(text, cursor);
            return self.mask(cursor, end, raw_kind(text, cursor, end));
        }
        if unit == DOLLAR {
            let end = closing_math(text, cursor);
            return self.mask(cursor, end, math_kind(text, cursor, end));
        }
        if unit == LESS_THAN {
            if let Some(end) = label_end(text, cursor) {
                return self.mask(cursor, end, RegionKind::Block);
            }
        }
        if unit == AT {
            let end = typst_reference_end(text, cursor + 1);
            if end > cursor + 1 {
                return self.mask(cursor, end, RegionKind::Inline);
            }
        }
        cursor + 1
    }

    fn escape(&mut self, cursor: usize) -> usize {
        if starts_with_units(self.text, cursor + 1, "u{") {
            return self.unicode_escape(cursor);
        }
        let Some((code, length)) = code_point_at(self.text, cursor + 1) else {
            return self.mask(cursor, cursor + 1, RegionKind::Block);
        };
        let keeps_character = code == u32::from(AT)
            || char::from_u32(code)
                .is_some_and(|ch| is_letter(ch) || is_number(ch) || is_js_space(ch));
        if keeps_character {
            return self.mask(cursor, cursor + 1, RegionKind::Block);
        }
        self.mask(cursor, cursor + 1 + length, RegionKind::Block)
    }

    fn unicode_escape(&mut self, cursor: usize) -> usize {
        let digits_start = cursor + 3;
        let mut end = digits_start;
        while is_hex_digit(self.text.get(end).copied()) {
            end += 1;
        }
        if self.text.get(end) != Some(&CLOSE_BRACE) {
            return self.mask(cursor, end, RegionKind::Block);
        }
        let digits = end - digits_start;
        let value = if (1..=6).contains(&digits) {
            u32::from_str_radix(&String::from_utf16_lossy(&self.text[digits_start..end]), 16).ok()
        } else {
            None
        };
        self.mask(cursor, end + 1, RegionKind::Block);
        if let Some(ch) = value.and_then(char::from_u32) {
            self.constructs.push(TypstConstruct {
                from: cursor,
                to: end + 1,
                text: to_units(&ch.to_string()),
            });
        }
        end + 1
    }

    fn start_expression(&mut self, cursor: usize) -> usize {
        self.owners.push(Owner {
            run_start: cursor,
            kind: RegionKind::Inline,
            has_content: false,
            segments: Vec::new(),
        });
        self.stack.push(Frame::Expression {
            owner: self.owners.len() - 1,
            root: true,
            skip_space: false,
            started: false,
        });
        cursor + 1
    }

    fn expression_step(
        &mut self,
        top: usize,
        owner: usize,
        root: bool,
        skip_space: bool,
        started: bool,
        cursor: usize,
    ) -> usize {
        if started {
            self.pop(cursor);
            return cursor;
        }
        if let Frame::Expression { started, .. } = &mut self.stack[top] {
            *started = true;
        }
        let mut at = cursor;
        if skip_space {
            while is_space(self.text.get(at).copied()) {
                at += 1;
            }
        }
        if let Some(end) = self.start_atom(owner, at) {
            return end;
        }
        if root {
            self.owners[owner].kind = RegionKind::Block;
        }
        self.pop(at);
        at
    }

    fn start_atom(&mut self, owner: usize, at: usize) -> Option<usize> {
        let text = self.text;
        let unit = text.get(at).copied();
        let identifier_end = typst_identifier_end(text, at);
        if identifier_end > at {
            return Some(self.start_identifier(owner, at, identifier_end));
        }
        if unit == Some(OPEN_BRACKET) {
            self.stack.push(Frame::Chain { owner });
            self.open_content(owner, at);
            return Some(at + 1);
        }
        if !matches!(unit, Some(OPEN_BRACE) | Some(OPEN_PAREN) | Some(QUOTE)) && !is_digit(unit) {
            return None;
        }
        self.stack.push(Frame::Chain { owner });
        if unit == Some(OPEN_BRACE) {
            self.push_code(owner, CLOSE_BRACE);
        }
        if unit == Some(OPEN_PAREN) {
            self.push_code(owner, CLOSE_PAREN);
        }
        if unit == Some(QUOTE) {
            return Some(closing_quote(text, at + 1));
        }
        Some(if is_digit(unit) {
            number_end(text, at)
        } else {
            at + 1
        })
    }

    fn start_identifier(&mut self, owner: usize, at: usize, end: usize) -> usize {
        let name = String::from_utf16_lossy(&self.text[at..end]);
        let name = name.as_str();
        if STATEMENT_KEYWORDS.contains(&name) {
            self.owners[owner].kind = RegionKind::Block;
            self.stack.push(Frame::Statement { owner });
        } else if CONTROL_KEYWORDS.contains(&name) {
            self.owners[owner].kind = RegionKind::Block;
            self.stack.push(Frame::Control {
                owner,
                is_loop: name != "if",
                after_body: false,
            });
        } else if EXPRESSION_KEYWORDS.contains(&name) {
            if name == "include" {
                self.owners[owner].kind = RegionKind::Block;
            }
            self.stack.push(Frame::Expression {
                owner,
                root: false,
                skip_space: true,
                started: false,
            });
        } else {
            self.stack.push(Frame::Chain { owner });
        }
        end
    }

    fn chain_step(&mut self, owner: usize, cursor: usize) -> usize {
        let unit = self.text[cursor];
        if unit == OPEN_PAREN {
            self.push_code(owner, CLOSE_PAREN);
            return cursor + 1;
        }
        if unit == OPEN_BRACKET {
            self.open_content(owner, cursor);
            return cursor + 1;
        }
        if unit == DOT {
            let end = typst_identifier_end(self.text, cursor + 1);
            if end > cursor + 1 {
                return end;
            }
        }
        self.pop(cursor);
        cursor
    }

    fn code_step(&mut self, owner: usize, close: u16, cursor: usize) -> usize {
        if self.text[cursor] == close {
            self.pop(cursor + 1);
            return cursor + 1;
        }
        self.code_token(owner, cursor)
    }

    fn statement_step(&mut self, owner: usize, cursor: usize) -> usize {
        let unit = self.text[cursor];
        if unit == NEWLINE {
            self.pop(cursor);
            return cursor;
        }
        if unit == SEMICOLON {
            self.pop(cursor + 1);
            return cursor + 1;
        }
        self.code_token(owner, cursor)
    }

    fn set_after_body(&mut self, top: usize, value: bool) {
        if let Frame::Control { after_body, .. } = &mut self.stack[top] {
            *after_body = value;
        }
    }

    fn control_step(
        &mut self,
        top: usize,
        owner: usize,
        is_loop: bool,
        after_body: bool,
        cursor: usize,
    ) -> usize {
        if after_body {
            return self.after_control_body(top, is_loop, cursor);
        }
        let unit = self.text[cursor];
        if unit == NEWLINE || unit == SEMICOLON {
            self.pop(cursor);
            return cursor;
        }
        if unit == OPEN_BRACKET {
            self.set_after_body(top, true);
            self.open_content(owner, cursor);
            return cursor + 1;
        }
        if unit == OPEN_BRACE {
            self.set_after_body(top, true);
            self.push_code(owner, CLOSE_BRACE);
            return cursor + 1;
        }
        self.code_token(owner, cursor)
    }

    fn after_control_body(&mut self, top: usize, is_loop: bool, cursor: usize) -> usize {
        self.set_after_body(top, false);
        let mut at = cursor;
        while !is_loop && is_space(self.text.get(at).copied()) {
            at += 1;
        }
        if !is_loop
            && starts_with_units(self.text, at, "else")
            && !is_typst_identifier_continue_at(self.text, at + 4)
        {
            return at + 4;
        }
        self.pop(cursor);
        cursor
    }

    fn code_token(&mut self, owner: usize, cursor: usize) -> usize {
        let unit = self.text[cursor];
        if let Some(end) = code_opaque_end(self.text, cursor) {
            return end;
        }
        if unit == OPEN_PAREN || unit == OPEN_BRACE {
            self.push_code(
                owner,
                if unit == OPEN_PAREN {
                    CLOSE_PAREN
                } else {
                    CLOSE_BRACE
                },
            );
            return cursor + 1;
        }
        if unit == OPEN_BRACKET {
            self.open_content(owner, cursor);
            return cursor + 1;
        }
        if unit == CLOSE_PAREN || unit == CLOSE_BRACE || unit == CLOSE_BRACKET {
            return self.stray_closer(unit, cursor);
        }
        cursor + 1
    }

    fn accepts(&self, unit: u16, frame: Frame) -> bool {
        match frame {
            Frame::Markup(_) => unit == CLOSE_BRACKET,
            Frame::Code { close, .. } => unit != CLOSE_BRACKET && close == unit,
            _ => false,
        }
    }

    fn stray_closer(&mut self, unit: u16, cursor: usize) -> usize {
        let open = if unit == CLOSE_BRACKET {
            self.markups[self.markup].closes
        } else {
            self.open_code.get(unit) > 0
        };
        if !open {
            return cursor + 1;
        }
        while self.stack.len() > 1 && !self.accepts(unit, self.top()) {
            self.pop(cursor);
        }
        cursor
    }
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

fn mask_remote_targets(scanner: &mut Scanner<'_>, source: &[u16]) {
    let masked = SourceText::from_units(scanner.characters.clone());
    let original = SourceText::from_units(source.to_vec());
    let urls = REMOTE_URL.find_all(&masked).matches;
    let emails = email_address_pattern().find_all(&original).matches;
    for found in urls.into_iter().chain(emails) {
        scanner.mask(found.from, found.to, RegionKind::Inline);
    }
}

fn mask_typst_markup_markers(scanner: &mut Scanner<'_>) {
    let markup = scanner.characters.clone();
    let starts = js_line_starts(&markup);
    let marker_at = |start: usize, pattern: usize| -> Option<(usize, usize)> {
        let mut cursor = start;
        while is_space(markup.get(cursor).copied()) {
            cursor += 1;
        }
        let end = match pattern {
            0 => {
                let run = markup[cursor.min(markup.len())..]
                    .iter()
                    .take_while(|&&unit| unit == EQUALS)
                    .count();
                (run > 0).then_some(cursor + run)?
            }
            1 => matches!(markup.get(cursor), Some(&MINUS) | Some(&PLUS)).then_some(cursor + 1)?,
            _ => (markup.get(cursor) == Some(&SLASH)).then_some(cursor + 1)?,
        };
        is_space(markup.get(end).copied()).then_some((cursor, end))
    };
    for pattern in 0..3 {
        for &start in &starts {
            if let Some((from, to)) = marker_at(start, pattern) {
                scanner.mask(from, to, RegionKind::Block);
            }
        }
    }
}

fn mask_typst_delimiters(scanner: &mut Scanner<'_>) {
    for index in 0..scanner.characters.len() {
        let unit = scanner.characters[index];
        if matches!(unit, OPEN_BRACKET | CLOSE_BRACKET | STAR | UNDERSCORE)
            && (index == 0 || scanner.characters[index - 1] != BACKSLASH)
        {
            scanner.mask(index, index + 1, RegionKind::Block);
        }
    }
}

fn separate_regions(regions: &[TypstRegion]) -> Vec<TypstRegion> {
    let mut sorted = regions.to_vec();
    sorted.sort_by(|left, right| left.from.cmp(&right.from).then(right.to.cmp(&left.to)));
    let mut separated = Vec::with_capacity(sorted.len());
    let mut applied = 0;
    for region in sorted {
        if region.to <= applied {
            continue;
        }
        separated.push(TypstRegion {
            from: region.from.max(applied),
            ..region
        });
        applied = region.to;
    }
    separated
}

struct TypstScan {
    masked: Vec<u16>,
    regions: Vec<TypstRegion>,
    constructs: Vec<TypstConstruct>,
}

fn scan_typst(text: &[u16]) -> TypstScan {
    let mut scanner = Scanner::new(text);
    scanner.run();
    mask_remote_targets(&mut scanner, text);
    mask_typst_markup_markers(&mut scanner);
    mask_typst_delimiters(&mut scanner);
    TypstScan {
        regions: separate_regions(&scanner.regions),
        masked: scanner.characters,
        constructs: scanner.constructs,
    }
}

#[derive(Default)]
struct DecodeTables {
    decoded: Vec<u16>,
    starts: Vec<usize>,
    ends: Vec<usize>,
}

impl DecodeTables {
    fn keep_until(&mut self, masked: &[u16], cursor: &mut usize, to: usize) {
        if to > *cursor {
            self.decoded
                .extend_from_slice(&masked[*cursor..to.min(masked.len())]);
        }
        while *cursor < to {
            self.starts.push(*cursor);
            self.ends.push(*cursor + 1);
            *cursor += 1;
        }
    }
}

fn decode_scan(text: &[u16], scan: &TypstScan) -> DecodedProse {
    let masked = &scan.masked;
    if scan.constructs.is_empty() {
        return DecodedProse::plain(masked.clone(), text.len());
    }
    let mut tables = DecodeTables::default();
    let mut cursor = 0;
    for construct in &scan.constructs {
        tables.keep_until(masked, &mut cursor, construct.from);
        tables.decoded.extend_from_slice(&construct.text);
        tables
            .starts
            .extend(std::iter::repeat_n(construct.from, construct.text.len()));
        tables
            .ends
            .extend(std::iter::repeat_n(construct.to, construct.text.len()));
        cursor = construct.to;
    }
    tables.keep_until(masked, &mut cursor, masked.len());
    DecodedProse {
        text: tables.decoded,
        decoded: true,
        starts: tables.starts,
        ends: tables.ends,
        source_length: text.len(),
    }
}

pub fn mask_typst_for_prose_regions(text: &[u16]) -> ProseMask {
    let scan = scan_typst(text);
    let mut out = scan.masked.clone();
    let mut masked = Vec::with_capacity(scan.regions.len());
    for region in &scan.regions {
        masked.push(MaskSpan {
            from: region.from,
            to: region.to,
        });
        if region.kind == RegionKind::Inline {
            write_prose_placeholder(&mut out, text, region.from, region.to);
        }
    }
    let decoded = decode_scan(text, &scan);
    let masked = write_decoded_words(&mut out, masked, text, &decoded);
    ProseMask { prose: out, masked }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn prose(text: &str) -> String {
        String::from_utf16_lossy(&mask_typst_for_prose_regions(&to_units(text)).prose)
    }

    #[test]
    fn markers_math_and_references_are_masked() {
        assert_eq!(
            prose("= Title\nText with $x$ and @key.\n"),
            format!(
                "  Title\nText with X{} and X{}.\n",
                " ".repeat(2),
                " ".repeat(3)
            )
        );
    }

    #[test]
    fn code_is_blank_and_content_stays_prose() {
        let out = prose("#let x = 1\nWord #emph[inner] end\n");
        let lines: Vec<&str> = out.split('\n').collect();
        assert!(lines[0].trim().is_empty());
        assert_eq!(lines[1], format!("Word {}inner  end", " ".repeat(6)));
    }

    #[test]
    fn unicode_escapes_are_decoded() {
        assert_eq!(prose("caf\\u{e9} ok"), format!("café{} ok", " ".repeat(5)));
    }

    #[test]
    fn the_prose_keeps_the_source_length() {
        let text = "#set page(width: 10cm)\n// note\nA `raw` and https://x.org/a. <lbl> 😀 _b_\n";
        assert_eq!(
            mask_typst_for_prose_regions(&to_units(text)).prose.len(),
            to_units(text).len()
        );
    }
}
