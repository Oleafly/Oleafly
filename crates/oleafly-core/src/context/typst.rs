use super::text::{
    is_js_space, is_mark, is_name_character, resolve_project_path, starts_with_at, string_of,
    trim_js, Source,
};
use super::{Def, DefKind, FileFacts, Use, UseKind};

fn is_label_start(character: char) -> bool {
    is_name_character(character)
}

fn is_label_continue(character: char) -> bool {
    is_name_character(character) || matches!(character, '.' | ':' | '-' | '\u{200C}' | '\u{200D}')
}

fn is_identifier_start(character: char) -> bool {
    character.is_alphabetic() || character == '_'
}

fn is_identifier_continue(character: char) -> bool {
    character.is_alphanumeric()
        || is_mark(character)
        || character == '_'
        || character == '-'
        || character == '\u{200C}'
        || character == '\u{200D}'
}

fn is_autolink_character(character: char) -> bool {
    character.is_ascii_alphanumeric() || "!#$%&*+,-./:;=?@_~'".contains(character)
}

fn autolink_end(text: &[char], from: usize) -> Option<usize> {
    if text.get(from) != Some(&'h')
        || !(starts_with_at(text, from, "http://") || starts_with_at(text, from, "https://"))
    {
        return None;
    }
    let mut brackets: Vec<char> = Vec::new();
    let mut end = from;
    while end < text.len() {
        let character = text[end];
        if character == '[' || character == '(' {
            brackets.push(character);
        } else if character == ']' || character == ')' {
            let wanted = if character == ']' { '[' } else { '(' };
            if brackets.pop() != Some(wanted) {
                break;
            }
        } else if !is_autolink_character(character) {
            break;
        }
        end += 1;
    }
    while end > from && "!,.:;?'".contains(text[end - 1]) {
        end -= 1;
    }
    Some(end)
}

fn block_comment_end(text: &[char], from: usize) -> usize {
    let mut depth = 0;
    let mut index = from;
    while index < text.len() {
        if starts_with_at(text, index, "/*") {
            depth += 1;
            index += 2;
        } else if starts_with_at(text, index, "*/") {
            depth -= 1;
            index += 2;
            if depth == 0 {
                return index;
            }
        } else {
            index += 1;
        }
    }
    text.len()
}

fn raw_end(text: &[char], from: usize) -> usize {
    let mut width = 1;
    while text.get(from + width) == Some(&'`') {
        width += 1;
    }
    if width == 2 {
        return from + 2;
    }
    let fence: Vec<char> = std::iter::repeat_n('`', width).collect();
    match (from + width..text.len()).find(|index| text[*index..].starts_with(&fence)) {
        Some(close) => close + width,
        None => from + width,
    }
}

fn opaque_end(text: &[char], index: usize) -> Option<usize> {
    if starts_with_at(text, index, "//") {
        return Some(
            (index..text.len())
                .find(|cursor| text[*cursor] == '\n')
                .unwrap_or(text.len()),
        );
    }
    if starts_with_at(text, index, "/*") {
        return Some(block_comment_end(text, index));
    }
    if text[index] == '`' {
        return Some(raw_end(text, index));
    }
    None
}

enum Frame {
    Markup { close: bool, brackets: i32 },
    Code(CodeFrame),
}

struct CodeFrame {
    line: bool,
    started: bool,
    parens: i32,
    braces: i32,
    quoted: bool,
}

impl CodeFrame {
    fn new(line: bool) -> Self {
        Self {
            line,
            started: false,
            parens: 0,
            braces: 0,
            quoted: false,
        }
    }
}

const LINE_CODE_KEYWORDS: [&str; 5] = ["let", "set", "show", "import", "include"];

fn opens_line_code(text: &[char], hash: usize) -> bool {
    let mut start = hash + 1;
    while text
        .get(start)
        .is_some_and(|character| *character == ' ' || *character == '\t')
    {
        start += 1;
    }
    LINE_CODE_KEYWORDS.iter().any(|word| {
        if !starts_with_at(text, start, word) {
            return false;
        }
        match text.get(start + word.len()) {
            None => true,
            Some(next) => !(next.is_ascii_alphanumeric() || *next == '_'),
        }
    })
}

enum Step {
    Advance(usize),
    Pop,
    PopAdvance(usize),
    Push(Frame, usize),
}

struct Masks {
    text: Vec<char>,
    code: Vec<char>,
}

impl Masks {
    fn blank(&mut self, raw: &[char], from: usize, to: usize) {
        for (index, character) in raw.iter().enumerate().take(to).skip(from) {
            if *character != '\n' {
                self.text[index] = ' ';
                self.code[index] = ' ';
            }
        }
    }
}

fn markup_step(
    raw: &[char],
    index: usize,
    masks: &mut Masks,
    close: bool,
    brackets: &mut i32,
) -> Step {
    let character = raw[index];
    if character == '\\' {
        Step::Advance(index + 2)
    } else if let Some(link) = autolink_end(raw, index) {
        for cell in masks.code.iter_mut().take(link).skip(index) {
            *cell = ' ';
        }
        Step::Advance(link.max(index + 1))
    } else if let Some(end) = opaque_end(raw, index) {
        masks.blank(raw, index, end);
        Step::Advance(end.max(index + 1))
    } else if close && character == ']' && *brackets == 0 {
        Step::PopAdvance(index + 1)
    } else if close && character == '[' {
        *brackets += 1;
        Step::Advance(index + 1)
    } else if close && character == ']' {
        *brackets -= 1;
        Step::Advance(index + 1)
    } else if character == '#' {
        let frame = Frame::Code(CodeFrame::new(opens_line_code(raw, index)));
        Step::Push(frame, index + 1)
    } else {
        Step::Advance(index + 1)
    }
}

fn quoted_step(raw: &[char], index: usize, code: &mut [char], quoted: &mut bool) -> Step {
    let character = raw[index];
    let mut cursor = index;
    if character != '\n' {
        code[cursor] = ' ';
    }
    if character == '\\' && cursor + 1 < raw.len() {
        cursor += 1;
        if raw[cursor] != '\n' {
            code[cursor] = ' ';
        }
    } else if character == '"' {
        *quoted = false;
    }
    Step::Advance(cursor + 1)
}

fn code_step(raw: &[char], index: usize, masks: &mut Masks, frame: &mut CodeFrame) -> Step {
    let character = raw[index];
    if frame.quoted {
        quoted_step(raw, index, &mut masks.code, &mut frame.quoted)
    } else if let Some(end) = opaque_end(raw, index) {
        frame.started = true;
        masks.blank(raw, index, end);
        Step::Advance(end.max(index + 1))
    } else if character == '"' {
        frame.quoted = true;
        masks.code[index] = ' ';
        frame.started = true;
        Step::Advance(index + 1)
    } else if character == '[' {
        frame.started = true;
        Step::Push(
            Frame::Markup {
                close: true,
                brackets: 0,
            },
            index + 1,
        )
    } else if character == '(' {
        frame.parens += 1;
        frame.started = true;
        Step::Advance(index + 1)
    } else if character == '{' {
        frame.braces += 1;
        frame.started = true;
        Step::Advance(index + 1)
    } else if character == ')' && frame.parens > 0 {
        frame.parens -= 1;
        Step::Advance(index + 1)
    } else if character == '}' && frame.braces > 0 {
        frame.braces -= 1;
        Step::Advance(index + 1)
    } else if (character == '\n' && frame.line)
        || (frame.started
            && !frame.line
            && frame.parens == 0
            && frame.braces == 0
            && is_js_space(character))
    {
        Step::Pop
    } else {
        if !is_js_space(character) {
            frame.started = true;
        }
        Step::Advance(index + 1)
    }
}

#[cfg(test)]
pub(crate) fn mask_source(raw: &[char]) -> (Vec<char>, Vec<char>) {
    let (text, code, _) = mask_source_with_code_regions(raw);
    (text, code)
}

fn mask_source_with_code_regions(raw: &[char]) -> (Vec<char>, Vec<char>, Vec<bool>) {
    let mut masks = Masks {
        text: raw.to_vec(),
        code: raw.to_vec(),
    };
    let mut in_code = vec![false; raw.len()];
    let mut frames = vec![Frame::Markup {
        close: false,
        brackets: 0,
    }];
    let mut index = 0;
    while index < raw.len() {
        let (step, code_frame) = match frames.last_mut().expect("the markup frame stays") {
            Frame::Markup { close, brackets } => {
                (markup_step(raw, index, &mut masks, *close, brackets), false)
            }
            Frame::Code(frame) => (code_step(raw, index, &mut masks, frame), true),
        };
        let next = match &step {
            Step::Advance(next) | Step::PopAdvance(next) | Step::Push(_, next) => *next,
            Step::Pop => index,
        };
        if code_frame {
            for cell in in_code.iter_mut().take(next).skip(index) {
                *cell = true;
            }
        }
        match step {
            Step::Advance(next) => index = next,
            Step::Pop => {
                frames.pop();
            }
            Step::PopAdvance(next) => {
                frames.pop();
                index = next;
            }
            Step::Push(frame, next) => {
                frames.push(frame);
                index = next;
            }
        }
    }
    (masks.text, masks.code, in_code)
}

fn mask_quoted_contents(source: &[char]) -> Vec<char> {
    let mut chars = source.to_vec();
    let mut quoted = false;
    let mut index = 0;
    while index < chars.len() {
        if !quoted {
            if chars[index] == '"' {
                quoted = true;
            }
            index += 1;
            continue;
        }
        if chars[index] == '\\' {
            chars[index] = ' ';
            if index + 1 < chars.len() && chars[index + 1] != '\n' {
                chars[index + 1] = ' ';
            }
            index += 2;
            continue;
        }
        if chars[index] == '"' {
            quoted = false;
            index += 1;
            continue;
        }
        if chars[index] != '\n' {
            chars[index] = ' ';
        }
        index += 1;
    }
    chars
}

fn is_escaped(text: &[char], offset: usize) -> bool {
    let mut backslashes = 0;
    let mut cursor = offset;
    while cursor > 0 && text[cursor - 1] == '\\' {
        backslashes += 1;
        cursor -= 1;
    }
    backslashes % 2 == 1
}

fn trim_reference(name: &str) -> &str {
    name.trim_end_matches(['.', ':'])
}

/// `resolveImport` from the legacy Typst parser: relative to the file (or
/// to the project root for a `/`-rooted path, as Typst reads it), `.typ`
/// added when the last segment has no extension. A path that climbs out of
/// the project resolves to nothing.
fn resolve_import(from: &str, raw: &str) -> Option<String> {
    if raw.starts_with('@') || raw.contains("://") {
        return None;
    }
    let mut parts: Vec<&str> = Vec::new();
    match raw.strip_prefix('/') {
        Some(rooted) => parts.extend(rooted.split('/')),
        None => {
            parts.extend(from.split('/'));
            parts.pop();
            parts.extend(raw.strip_prefix("./").unwrap_or(raw).split('/'));
        }
    }
    let mut normalized: Vec<&str> = Vec::new();
    for part in parts {
        if part.is_empty() || part == "." {
            continue;
        }
        if part == ".." {
            normalized.pop()?;
        } else {
            normalized.push(part);
        }
    }
    if normalized.is_empty() {
        return None;
    }
    let target = normalized.join("/");
    let last = target.rfind('/').map_or(0, |index| index + 1);
    let has_extension = match target[last..].find('.') {
        Some(dot) => last + dot < target.len() - 1,
        None => false,
    };
    Some(if has_extension {
        target
    } else {
        format!("{target}.typ")
    })
}

fn label_run(code: &[char], from: usize) -> usize {
    if !code.get(from).copied().is_some_and(is_label_start) {
        return from;
    }
    let mut end = from + 1;
    while code.get(end).copied().is_some_and(is_label_continue) {
        end += 1;
    }
    end
}

fn citation_keys(arguments: &[char], offset: usize) -> Vec<(String, usize)> {
    let mut keys = Vec::new();
    let mut index = 0;
    while index < arguments.len() {
        if arguments[index] == '<' {
            let end = label_run(arguments, index + 1);
            if end > index + 1 && arguments.get(end) == Some(&'>') {
                keys.push((string_of(&arguments[index + 1..end]), offset + index + 1));
                index = end + 1;
                continue;
            }
        }
        if arguments[index] == '"' {
            let mut back = index;
            while back > 0 && is_js_space(arguments[back - 1]) {
                back -= 1;
            }
            let leading = back == 0 || matches!(arguments[back - 1], '[' | '(' | ',');
            let labelled = {
                let before = string_of(&arguments[..back]);
                before.trim_end().ends_with("label(") || before.trim_end().ends_with("label (")
            };
            if leading || labelled {
                let end = label_run(arguments, index + 1);
                if end > index + 1 && arguments.get(end) == Some(&'"') {
                    keys.push((string_of(&arguments[index + 1..end]), offset + index + 1));
                    index = end + 1;
                    continue;
                }
            }
        }
        index += 1;
    }
    keys
}

struct Facts<'a> {
    file: &'a str,
    source: &'a Source,
    facts: FileFacts,
}

impl Facts<'_> {
    fn def(&mut self, kind: DefKind, name: String, from: usize, level: Option<u32>) {
        let line = self.source.line_of(from);
        self.facts.defs.push(Def {
            kind,
            name,
            file: self.file.to_string(),
            from,
            line,
            level,
            explicit: true,
        });
    }

    fn use_(
        &mut self,
        kind: UseKind,
        name: String,
        from: usize,
        target: Option<String>,
        typst_at: bool,
    ) {
        let line = self.source.line_of(from);
        self.facts.uses.push(Use {
            kind,
            name,
            file: self.file.to_string(),
            from,
            line,
            target,
            typst_at,
        });
    }
}

fn skip_spaces(chars: &[char], mut cursor: usize) -> usize {
    while chars
        .get(cursor)
        .is_some_and(|character| is_js_space(*character))
    {
        cursor += 1;
    }
    cursor
}

const KIND_MARKUP: u8 = 0;
const KIND_CODE: u8 = 1;
const KIND_STRING: u8 = 2;
const KIND_COMMENT: u8 = 3;
const KIND_RAW: u8 = 4;
const KIND_MATH: u8 = 5;
const KIND_ESCAPE: u8 = 6;

const HEADING_LINE_KEYWORDS: [&str; 10] = [
    "let", "set", "show", "import", "include", "if", "for", "while", "context", "return",
];

enum LexFrame {
    Markup {
        in_brackets: bool,
        depth: usize,
    },
    Math,
    Code {
        line: bool,
        parens: usize,
        braces: usize,
        started: bool,
        in_ident: bool,
    },
}

struct SectionHit {
    from: usize,
    to: usize,
    name_from: usize,
    name: String,
    level: u32,
}

struct CallArg {
    name: Option<String>,
    value_from: usize,
    value_to: usize,
}

fn comment_end_at(raw: &[char], index: usize) -> Option<usize> {
    if starts_with_at(raw, index, "//") {
        return Some(
            (index..raw.len())
                .find(|cursor| raw[*cursor] == '\n')
                .unwrap_or(raw.len()),
        );
    }
    if starts_with_at(raw, index, "/*") {
        return Some(block_comment_end(raw, index));
    }
    None
}

fn closed_string_end(raw: &[char], from: usize) -> Option<usize> {
    let mut index = from + 1;
    while index < raw.len() {
        if raw[index] == '\\' {
            index += 2;
        } else if raw[index] == '"' {
            return Some(index);
        } else {
            index += 1;
        }
    }
    None
}

fn identifier_end_at(raw: &[char], from: usize) -> usize {
    if !raw.get(from).copied().is_some_and(is_identifier_start) {
        return from;
    }
    let mut end = from + 1;
    while raw.get(end).copied().is_some_and(is_identifier_continue) {
        end += 1;
    }
    end
}

fn has_line_keyword(raw: &[char], hash: usize) -> bool {
    let mut start = hash + 1;
    while matches!(raw.get(start), Some(' ' | '\t')) {
        start += 1;
    }
    let end = identifier_end_at(raw, start);
    if end == start {
        return false;
    }
    let word = string_of(&raw[start..end]);
    HEADING_LINE_KEYWORDS.contains(&word.as_str())
}

fn inside_bracket_markup(stack: &[LexFrame]) -> bool {
    for frame in stack.iter().rev() {
        if let LexFrame::Markup { in_brackets, .. } = frame {
            return *in_brackets;
        }
    }
    false
}

fn scan_typst_kinds(raw: &[char]) -> Vec<u8> {
    let mut kinds = vec![KIND_MARKUP; raw.len()];
    let mut stack = vec![LexFrame::Markup {
        in_brackets: false,
        depth: 0,
    }];
    let mut index = 0;

    while index < raw.len() {
        if stack.is_empty() {
            stack.push(LexFrame::Markup {
                in_brackets: false,
                depth: 0,
            });
        }
        let ch = raw[index];
        let top = stack.len() - 1;

        match &mut stack[top] {
            LexFrame::Markup { in_brackets, depth } => {
                if ch == '\\' {
                    let end = match raw.get(index + 1) {
                        None | Some('\n' | '\r') => index + 1,
                        Some(_) => (index + 2).min(raw.len()),
                    };
                    kinds[index..end].fill(KIND_ESCAPE);
                    index = end;
                } else if let Some(link) = autolink_end(raw, index) {
                    kinds[index..link].fill(KIND_ESCAPE);
                    index = link.max(index + 1);
                } else if let Some(end) = comment_end_at(raw, index) {
                    kinds[index..end].fill(KIND_COMMENT);
                    index = end.max(index + 1);
                } else if ch == '`' {
                    let end = raw_end(raw, index);
                    kinds[index..end].fill(KIND_RAW);
                    index = end.max(index + 1);
                } else if ch == '$' {
                    kinds[index] = KIND_MATH;
                    stack.push(LexFrame::Math);
                    index += 1;
                } else if ch == '#' {
                    kinds[index] = KIND_CODE;
                    let line = has_line_keyword(raw, index);
                    stack.push(LexFrame::Code {
                        line,
                        parens: 0,
                        braces: 0,
                        started: false,
                        in_ident: false,
                    });
                    index += 1;
                } else if *in_brackets && ch == '[' {
                    *depth += 1;
                    index += 1;
                } else if *in_brackets && ch == ']' {
                    if *depth == 0 {
                        kinds[index] = KIND_CODE;
                        stack.pop();
                    } else {
                        *depth -= 1;
                    }
                    index += 1;
                } else {
                    index += 1;
                }
            }
            LexFrame::Math => {
                if ch == '\\' {
                    let end = match raw.get(index + 1) {
                        None | Some('\n' | '\r') => index + 1,
                        Some(_) => (index + 2).min(raw.len()),
                    };
                    kinds[index..end].fill(KIND_MATH);
                    index = end;
                } else if let Some(end) = comment_end_at(raw, index) {
                    kinds[index..end].fill(KIND_COMMENT);
                    index = end.max(index + 1);
                } else if ch == '"' {
                    if let Some(close) = closed_string_end(raw, index) {
                        kinds[index..=close].fill(KIND_STRING);
                        index = close + 1;
                    } else {
                        kinds[index] = KIND_MATH;
                        index += 1;
                    }
                } else if ch == '#' {
                    kinds[index] = KIND_CODE;
                    let line = has_line_keyword(raw, index);
                    stack.push(LexFrame::Code {
                        line,
                        parens: 0,
                        braces: 0,
                        started: false,
                        in_ident: false,
                    });
                    index += 1;
                } else {
                    kinds[index] = KIND_MATH;
                    if ch == '$' {
                        stack.pop();
                    }
                    index += 1;
                }
            }
            LexFrame::Code { .. } => {
                let (line, parens, braces, started) = match stack[top] {
                    LexFrame::Code {
                        line,
                        parens,
                        braces,
                        started,
                        ..
                    } => (line, parens, braces, started),
                    _ => unreachable!(),
                };
                if let Some(end) = comment_end_at(raw, index) {
                    if parens == 0 && braces == 0 && !line {
                        stack.pop();
                        continue;
                    }
                    if let LexFrame::Code { started: s, .. } = &mut stack[top] {
                        *s = true;
                    }
                    kinds[index..end].fill(KIND_COMMENT);
                    index = end.max(index + 1);
                    continue;
                }
                if ch == '`' {
                    if parens == 0 && braces == 0 && !line && started {
                        stack.pop();
                        continue;
                    }
                    if let LexFrame::Code {
                        started: s,
                        in_ident: id,
                        ..
                    } = &mut stack[top]
                    {
                        *s = true;
                        *id = false;
                    }
                    let end = raw_end(raw, index);
                    kinds[index..end].fill(KIND_RAW);
                    index = end.max(index + 1);
                    continue;
                }
                if parens == 0 && braces == 0 {
                    if line {
                        if matches!(ch, '\n' | '\r') {
                            stack.pop();
                            continue;
                        }
                        if ch == ';' {
                            kinds[index] = KIND_CODE;
                            stack.pop();
                            index += 1;
                            continue;
                        }
                        if (ch == ']' && inside_bracket_markup(&stack[..top]))
                            || matches!(ch, ')' | '}')
                        {
                            stack.pop();
                            continue;
                        }
                    } else if !started {
                        let ident_end = identifier_end_at(raw, index);
                        if ident_end > index {
                            if let LexFrame::Code {
                                started: s,
                                in_ident: id,
                                ..
                            } = &mut stack[top]
                            {
                                *s = true;
                                *id = true;
                            }
                            kinds[index..ident_end].fill(KIND_CODE);
                            index = ident_end;
                            continue;
                        }
                        if !matches!(ch, '(' | '[' | '{' | '"') {
                            stack.pop();
                            continue;
                        }
                    } else {
                        if ch == '.' {
                            let member_end = identifier_end_at(raw, index + 1);
                            if member_end > index + 1 {
                                if let LexFrame::Code { in_ident: id, .. } = &mut stack[top] {
                                    *id = true;
                                }
                                kinds[index..member_end].fill(KIND_CODE);
                                index = member_end;
                                continue;
                            }
                        }
                        if !matches!(ch, '(' | '[') {
                            stack.pop();
                            continue;
                        }
                    }
                }
                if let LexFrame::Code {
                    started: s,
                    in_ident: id,
                    parens: p,
                    braces: b,
                    ..
                } = &mut stack[top]
                {
                    *s = true;
                    *id = false;
                    if ch == '"' {
                        if let Some(close) = closed_string_end(raw, index) {
                            kinds[index] = KIND_CODE;
                            kinds[index + 1..close].fill(KIND_STRING);
                            kinds[close] = KIND_CODE;
                            index = close + 1;
                        } else {
                            kinds[index] = KIND_CODE;
                            index += 1;
                        }
                    } else if ch == '[' {
                        kinds[index] = KIND_CODE;
                        stack.push(LexFrame::Markup {
                            in_brackets: true,
                            depth: 0,
                        });
                        index += 1;
                    } else {
                        kinds[index] = KIND_CODE;
                        if ch == '(' {
                            *p += 1;
                        } else if ch == '{' {
                            *b += 1;
                        } else if ch == ')' && *p > 0 {
                            *p -= 1;
                        } else if ch == '}' && *b > 0 {
                            *b -= 1;
                        }
                        index += 1;
                    }
                }
            }
        }
    }
    kinds
}

fn matching_code_close(raw: &[char], kinds: &[u8], open: usize) -> Option<usize> {
    let expected = if raw.get(open) == Some(&'(') {
        ')'
    } else {
        ']'
    };
    let mut depth = 0usize;
    for index in open..raw.len() {
        if kinds[index] != KIND_CODE {
            continue;
        }
        match raw[index] {
            '(' | '[' | '{' => depth += 1,
            ')' | ']' | '}' => {
                depth = depth.saturating_sub(1);
                if depth == 0 {
                    return (raw[index] == expected).then_some(index);
                }
            }
            _ => {}
        }
    }
    None
}

fn skip_ignorable(raw: &[char], kinds: &[u8], from: usize, to: usize) -> usize {
    let mut cursor = from;
    while cursor < to && (is_js_space(raw[cursor]) || kinds[cursor] == KIND_COMMENT) {
        cursor += 1;
    }
    cursor
}

fn trim_ignorable_end(raw: &[char], kinds: &[u8], from: usize, to: usize) -> usize {
    let mut cursor = to;
    while cursor > from && (is_js_space(raw[cursor - 1]) || kinds[cursor - 1] == KIND_COMMENT) {
        cursor -= 1;
    }
    cursor
}

fn split_call_args(
    raw: &[char],
    kinds: &[u8],
    open_paren: usize,
    close_paren: usize,
) -> Vec<CallArg> {
    let mut args = Vec::new();
    let mut depth = 0usize;
    let mut seg_start = open_paren + 1;

    let mut push_arg = |seg_from: usize, seg_end: usize| {
        let start = skip_ignorable(raw, kinds, seg_from, seg_end);
        let end = trim_ignorable_end(raw, kinds, start, seg_end);
        if start >= end {
            return;
        }
        if kinds[start] == KIND_CODE {
            let ident_end = identifier_end_at(raw, start);
            if ident_end > start {
                let colon = skip_ignorable(raw, kinds, ident_end, end);
                if colon < end && raw[colon] == ':' && kinds[colon] == KIND_CODE {
                    let value_from = skip_ignorable(raw, kinds, colon + 1, end);
                    args.push(CallArg {
                        name: Some(string_of(&raw[start..ident_end])),
                        value_from,
                        value_to: end,
                    });
                    return;
                }
            }
        }
        if starts_with_at(raw, start, "..") && kinds[start] == KIND_CODE {
            return;
        }
        args.push(CallArg {
            name: None,
            value_from: start,
            value_to: end,
        });
    };

    for index in open_paren + 1..close_paren {
        if kinds[index] != KIND_CODE {
            continue;
        }
        match raw[index] {
            '(' | '[' | '{' => depth += 1,
            ')' | ']' | '}' => depth = depth.saturating_sub(1),
            ',' if depth == 0 => {
                push_arg(seg_start, index);
                seg_start = index + 1;
            }
            _ => {}
        }
    }
    push_arg(seg_start, close_paren);
    args
}

fn code_value_text(raw: &[char], kinds: &[u8], from: usize, to: usize) -> String {
    let mut out = String::new();
    for index in from..to {
        if kinds[index] != KIND_COMMENT && !is_js_space(raw[index]) {
            out.push(raw[index]);
        }
    }
    out
}

fn collapse_spaces(text: &str) -> String {
    let mut out = String::new();
    let mut in_space = false;
    for ch in trim_js(text).chars() {
        if is_js_space(ch) {
            if !in_space {
                out.push(' ');
                in_space = true;
            }
        } else {
            out.push(ch);
            in_space = false;
        }
    }
    out
}

fn decode_typst_string(body: &[char]) -> String {
    let mut out = String::new();
    let mut index = 0;
    while index < body.len() {
        if body[index] != '\\' {
            out.push(body[index]);
            index += 1;
            continue;
        }
        let Some(&esc) = body.get(index + 1) else {
            out.push('\\');
            break;
        };
        if starts_with_at(body, index + 1, "u{") {
            if let Some(rel_close) = body[index + 3..].iter().position(|&ch| ch == '}') {
                let hex_slice = &body[index + 3..index + 3 + rel_close];
                if !hex_slice.is_empty() && hex_slice.iter().all(|ch| ch.is_ascii_hexdigit()) {
                    let hex = string_of(hex_slice);
                    if let Some(decoded) =
                        u32::from_str_radix(&hex, 16).ok().and_then(char::from_u32)
                    {
                        out.push(decoded);
                    }
                    index += 4 + rel_close;
                    continue;
                }
            }
        }
        if matches!(esc, 'n' | 'r' | 't') {
            out.push(' ');
        } else {
            out.push(esc);
        }
        index += 2;
    }
    out
}

fn extract_content_title(
    raw: &[char],
    kinds: &[u8],
    from: usize,
    to: usize,
) -> Option<(String, usize)> {
    let name_from = skip_ignorable(raw, kinds, from, to);
    let name_to = trim_ignorable_end(raw, kinds, name_from, to);
    if name_from >= name_to {
        return None;
    }
    let cleaned: String = (name_from..name_to)
        .map(|index| {
            if kinds[index] == KIND_COMMENT {
                ' '
            } else {
                raw[index]
            }
        })
        .collect();
    let name = collapse_spaces(&cleaned);
    (!name.is_empty()).then_some((name, name_from))
}

fn extract_string_title(
    raw: &[char],
    kinds: &[u8],
    from: usize,
    to: usize,
) -> Option<(String, usize)> {
    if to.saturating_sub(from) < 2
        || raw.get(from) != Some(&'"')
        || raw.get(to - 1) != Some(&'"')
        || kinds.get(from) != Some(&KIND_CODE)
        || kinds.get(to - 1) != Some(&KIND_CODE)
    {
        return None;
    }
    if !(from + 1..to - 1)
        .all(|index| kinds[index] == KIND_STRING || matches!(raw[index], '\n' | '\r'))
    {
        return None;
    }
    let name = collapse_spaces(&decode_typst_string(&raw[from + 1..to - 1]));
    (!name.is_empty()).then_some((name, from + 1))
}

fn preceded_by_rule_keyword(raw: &[char], kinds: &[u8], ident_start: usize) -> bool {
    let mut cursor = ident_start;
    while cursor > 0 && (is_js_space(raw[cursor - 1]) || kinds[cursor - 1] == KIND_COMMENT) {
        cursor -= 1;
    }
    if cursor == 0 || kinds[cursor - 1] != KIND_CODE {
        return false;
    }
    let word_end = cursor;
    let mut word_start = word_end - 1;
    while word_start > 0
        && kinds[word_start - 1] == KIND_CODE
        && is_identifier_continue(raw[word_start - 1])
    {
        word_start -= 1;
    }
    let word = string_of(&raw[word_start..word_end]);
    matches!(word.as_str(), "let" | "set" | "show")
}

fn collect_heading_calls(raw: &[char], kinds: &[u8]) -> Vec<SectionHit> {
    let mut hits = Vec::new();
    for index in 0..raw.len() {
        if kinds[index] != KIND_CODE || !starts_with_at(raw, index, "heading") {
            continue;
        }
        if index > 0 && (is_identifier_continue(raw[index - 1]) || raw[index - 1] == '.') {
            continue;
        }
        let after = index + 7;
        let Some(&opener) = raw.get(after) else {
            continue;
        };
        if !matches!(opener, '[' | '(') || kinds.get(after) != Some(&KIND_CODE) {
            continue;
        }
        if preceded_by_rule_keyword(raw, kinds, index) {
            continue;
        }
        let call_from = if index > 0 && raw[index - 1] == '#' && kinds[index - 1] == KIND_CODE {
            index - 1
        } else {
            index
        };

        if opener == '[' {
            let Some(close_bracket) = matching_code_close(raw, kinds, after) else {
                continue;
            };
            if let Some((name, name_from)) =
                extract_content_title(raw, kinds, after + 1, close_bracket)
            {
                hits.push(SectionHit {
                    from: call_from,
                    to: close_bracket + 1,
                    name_from,
                    name,
                    level: 0,
                });
            }
            continue;
        }

        let Some(close_paren) = matching_code_close(raw, kinds, after) else {
            continue;
        };
        let args = split_call_args(raw, kinds, after, close_paren);
        let mut outlined_arg = None;
        let mut level_arg = None;
        let mut depth_arg = None;
        let mut offset_arg = None;
        let mut positional_body = None;
        for arg in &args {
            match arg.name.as_deref() {
                Some("outlined") => outlined_arg = Some(arg),
                Some("level") => level_arg = Some(arg),
                Some("depth") => depth_arg = Some(arg),
                Some("offset") => offset_arg = Some(arg),
                None if positional_body.is_none() => positional_body = Some(arg),
                _ => {}
            }
        }
        if outlined_arg
            .is_some_and(|arg| code_value_text(raw, kinds, arg.value_from, arg.value_to) == "false")
        {
            continue;
        }

        let parse_uint = |arg: Option<&CallArg>| -> Option<u32> {
            let text = code_value_text(raw, kinds, arg?.value_from, arg?.value_to);
            (!text.is_empty() && text.chars().all(|ch| ch.is_ascii_digit()))
                .then(|| text.parse::<u32>().ok())
                .flatten()
        };
        let level = match parse_uint(level_arg) {
            Some(explicit) if explicit >= 1 => explicit - 1,
            _ => {
                let depth = parse_uint(depth_arg).filter(|&d| d >= 1).unwrap_or(1);
                let offset = parse_uint(offset_arg).unwrap_or(0);
                (offset + depth).saturating_sub(1)
            }
        };

        let trailing_open = close_paren + 1;
        if raw.get(trailing_open) == Some(&'[') && kinds.get(trailing_open) == Some(&KIND_CODE) {
            let Some(close_bracket) = matching_code_close(raw, kinds, trailing_open) else {
                continue;
            };
            if let Some((name, name_from)) =
                extract_content_title(raw, kinds, trailing_open + 1, close_bracket)
            {
                hits.push(SectionHit {
                    from: call_from,
                    to: close_bracket + 1,
                    name_from,
                    name,
                    level,
                });
            }
            continue;
        }

        let Some(pos) = positional_body else {
            continue;
        };
        let body = if raw.get(pos.value_from) == Some(&'[')
            && kinds.get(pos.value_from) == Some(&KIND_CODE)
            && matching_code_close(raw, kinds, pos.value_from)
                == Some(pos.value_to.saturating_sub(1))
        {
            extract_content_title(raw, kinds, pos.value_from + 1, pos.value_to - 1)
        } else {
            extract_string_title(raw, kinds, pos.value_from, pos.value_to)
        };
        if let Some((name, name_from)) = body {
            hits.push(SectionHit {
                from: call_from,
                to: close_paren + 1,
                name_from,
                name,
                level,
            });
        }
    }
    hits
}

fn strip_trailing_label_end(chars: &[char]) -> usize {
    let mut end = chars.len();
    while end > 0 && matches!(chars[end - 1], ' ' | '\t') {
        end -= 1;
    }
    if end == 0 || chars[end - 1] != '>' {
        return chars.len();
    }
    let Some(open_rel) = chars[..end - 1].iter().rposition(|&ch| ch == '<') else {
        return chars.len();
    };
    let mut before = open_rel;
    while before > 0 && matches!(chars[before - 1], ' ' | '\t') {
        before -= 1;
    }
    if before == open_rel || before == 0 {
        return chars.len();
    }
    before
}

fn collect_marker_headings(raw: &[char], kinds: &[u8], calls: &[SectionHit]) -> Vec<SectionHit> {
    let mut hits = Vec::new();
    let mut line_start = 0;

    while line_start <= raw.len() {
        let newline = (line_start..raw.len()).find(|&index| raw[index] == '\n');
        let raw_line_end = newline.unwrap_or(raw.len());
        let line_end = if raw_line_end > line_start && raw[raw_line_end - 1] == '\r' {
            raw_line_end - 1
        } else {
            raw_line_end
        };

        let mut eq_start = line_start;
        while eq_start < line_end
            && (matches!(raw[eq_start], ' ' | '\t') || kinds[eq_start] == KIND_COMMENT)
        {
            eq_start += 1;
        }

        if eq_start < line_end && raw[eq_start] == '=' && kinds[eq_start] == KIND_MARKUP {
            let mut eq_end = eq_start;
            while eq_end < line_end && raw[eq_end] == '=' && kinds[eq_end] == KIND_MARKUP {
                eq_end += 1;
            }
            let has_separator = eq_end < line_end
                && (matches!(raw[eq_end], ' ' | '\t') || kinds[eq_end] == KIND_COMMENT);
            let inside_call = calls
                .iter()
                .any(|call| eq_start >= call.from && eq_start < call.to);

            if has_separator && !inside_call {
                let mut clean_rest = Vec::with_capacity(line_end - eq_end);
                let mut label_check_rest = Vec::with_capacity(line_end - eq_end);
                for index in eq_end..line_end {
                    let kind = kinds[index];
                    clean_rest.push(if kind == KIND_COMMENT {
                        ' '
                    } else {
                        raw[index]
                    });
                    label_check_rest.push(if kind == KIND_COMMENT {
                        ' '
                    } else if kind == KIND_RAW {
                        'a'
                    } else {
                        raw[index]
                    });
                }
                let body_end = strip_trailing_label_end(&label_check_rest);
                let body_chars = &clean_rest[..body_end];
                let lead = body_chars.iter().take_while(|&&ch| is_js_space(ch)).count();
                let mut tail = body_chars.len();
                while tail > lead && is_js_space(body_chars[tail - 1]) {
                    tail -= 1;
                }
                if lead < tail {
                    let name_from = eq_end + lead;
                    let mut name = String::new();
                    let mut idx = lead;
                    while idx < tail {
                        if matches!(body_chars[idx], ' ' | '\t') {
                            let run_start = idx;
                            while idx < tail && matches!(body_chars[idx], ' ' | '\t') {
                                idx += 1;
                            }
                            let has_comment = (eq_end + run_start..eq_end + idx)
                                .any(|abs| kinds[abs] == KIND_COMMENT);
                            if has_comment {
                                name.push(' ');
                            } else {
                                name.extend(&body_chars[run_start..idx]);
                            }
                        } else {
                            name.push(body_chars[idx]);
                            idx += 1;
                        }
                    }
                    hits.push(SectionHit {
                        from: eq_start,
                        to: line_end,
                        name_from,
                        name,
                        level: (eq_end - eq_start - 1) as u32,
                    });
                }
            }
        }

        let Some(nl) = newline else {
            break;
        };
        line_start = nl + 1;
    }

    hits
}

fn headings(facts: &mut Facts<'_>, raw: &[char]) {
    let kinds = scan_typst_kinds(raw);
    let calls = collect_heading_calls(raw, &kinds);
    let mut sections = collect_marker_headings(raw, &kinds, &calls);
    sections.extend(calls);
    sections.sort_by_key(|hit| hit.from);
    for section in sections {
        facts.def(
            DefKind::Section,
            section.name,
            section.name_from,
            Some(section.level),
        );
    }
}

fn in_reference_call(raw: &[char], index: usize) -> bool {
    let window = string_of(&raw[index.saturating_sub(80)..index]);
    ["#ref", "#link", "#cite"].iter().any(|call| {
        window.rfind(call).is_some_and(|at| {
            let after = window[at + call.len()..].trim_start();
            after.starts_with('(') && !after.contains(')')
        })
    })
}

fn labels(facts: &mut Facts<'_>, raw: &[char], code: &[char]) {
    let mut index = 0;
    while index < code.len() {
        if code[index] == '<' && !is_escaped(code, index) {
            let end = label_run(code, index + 1);
            if end > index + 1 && code.get(end) == Some(&'>') {
                if !in_reference_call(raw, index) {
                    let name = string_of(&code[index + 1..end]);
                    facts.def(DefKind::Label, name, index + 1, None);
                }
                index = end + 1;
                continue;
            }
        }
        index += 1;
    }
}

fn references(facts: &mut Facts<'_>, code: &[char]) {
    let mut index = 0;
    while index < code.len() {
        if code[index] == '@'
            && !is_escaped(code, index)
            && !(index > 0 && is_name_character(code[index - 1]))
        {
            let end = label_run(code, index + 1);
            if end > index + 1 {
                let name = trim_reference(&string_of(&code[index + 1..end])).to_string();
                if !name.is_empty() {
                    facts.use_(UseKind::Ref, name, index + 1, None, true);
                }
                index = end;
                continue;
            }
        }
        index += 1;
    }
}

fn quoted_after_space(text: &[char], from: usize) -> Option<(usize, usize)> {
    let cursor = skip_spaces(text, from);
    if cursor == from || text.get(cursor) != Some(&'"') {
        return None;
    }
    let close = (cursor + 1..text.len()).find(|position| text[*position] == '"')?;
    Some((cursor, close))
}

fn includes(facts: &mut Facts<'_>, text: &[char], in_code: &[bool]) {
    for (keyword, kind) in [("include", UseKind::Include), ("import", UseKind::Import)] {
        includes_of_keyword(facts, text, in_code, keyword, kind);
    }
}

fn includes_of_keyword(
    facts: &mut Facts<'_>,
    text: &[char],
    in_code: &[bool],
    keyword: &str,
    kind: UseKind,
) {
    let pattern = format!("#{keyword}");
    let mut index = 0;
    while index < text.len() {
        let Some(keyword_end) = keyword_end_at(text, in_code, index, keyword, &pattern) else {
            index += 1;
            continue;
        };
        let Some((open, close)) = quoted_after_space(text, keyword_end) else {
            index += 1;
            continue;
        };
        record_include(facts, kind, text, open, close);
        index = close + 1;
    }
}

fn keyword_end_at(
    text: &[char],
    in_code: &[bool],
    index: usize,
    keyword: &str,
    hashed_pattern: &str,
) -> Option<usize> {
    if starts_with_at(text, index, hashed_pattern) {
        return Some(index + hashed_pattern.len());
    }
    let bare = in_code.get(index) == Some(&true)
        && starts_with_at(text, index, keyword)
        && index.checked_sub(1).is_none_or(|before| {
            !(is_identifier_continue(text[before]) || matches!(text[before], '#' | '.'))
        });
    bare.then_some(index + keyword.len())
}

fn record_include(facts: &mut Facts<'_>, kind: UseKind, text: &[char], open: usize, close: usize) {
    let raw_target = string_of(&text[open + 1..close]);
    if raw_target.is_empty() {
        return;
    }
    if let Some(target) = resolve_import(facts.file, &raw_target) {
        facts.use_(kind, raw_target, open + 1, Some(target), false);
    }
}

fn let_bindings(facts: &mut Facts<'_>, code_mask: &[char]) {
    let mut index = 0;
    while index < code_mask.len() {
        if starts_with_at(code_mask, index, "#let") {
            let spaced = index + 4;
            let cursor = skip_spaces(code_mask, spaced);
            if cursor > spaced
                && code_mask
                    .get(cursor)
                    .copied()
                    .is_some_and(is_identifier_start)
            {
                let mut end = cursor + 1;
                while code_mask
                    .get(end)
                    .copied()
                    .is_some_and(is_identifier_continue)
                {
                    end += 1;
                }
                let name = string_of(&code_mask[cursor..end]);
                facts.def(DefKind::Macro, name, cursor, None);
                index = end;
                continue;
            }
        }
        index += 1;
    }
}

fn call_label(code_mask: &[char], from: usize) -> Option<(String, usize)> {
    let cursor = skip_spaces(code_mask, from);
    if code_mask.get(cursor) != Some(&'(') {
        return None;
    }
    let cursor = skip_spaces(code_mask, cursor + 1);
    if code_mask.get(cursor) != Some(&'<') {
        return None;
    }
    let end = label_run(code_mask, cursor + 1);
    if end <= cursor + 1 || code_mask.get(end) != Some(&'>') {
        return None;
    }
    Some((string_of(&code_mask[cursor + 1..end]), cursor + 1))
}

fn reference_calls(facts: &mut Facts<'_>, code_mask: &[char]) {
    for call in ["#ref", "#link"] {
        let mut index = 0;
        while index < code_mask.len() {
            if starts_with_at(code_mask, index, call) {
                if let Some((label, from)) = call_label(code_mask, index + call.len()) {
                    facts.use_(UseKind::Ref, label, from, None, false);
                }
            }
            index += 1;
        }
    }
}

fn call_arguments_end(code_mask: &[char], content_from: usize) -> usize {
    let mut depth = 1;
    let mut end = content_from;
    while end < code_mask.len() && depth > 0 {
        match code_mask[end] {
            '(' => depth += 1,
            ')' => depth -= 1,
            _ => {}
        }
        end += 1;
    }
    if depth == 0 {
        end - 1
    } else {
        end
    }
}

fn cite_calls(facts: &mut Facts<'_>, text: &[char], code_mask: &[char]) {
    let mut index = 0;
    while index < code_mask.len() {
        if starts_with_at(code_mask, index, "#cite") {
            let cursor = skip_spaces(code_mask, index + 5);
            if code_mask.get(cursor) == Some(&'(') {
                let content_from = cursor + 1;
                let content_to = call_arguments_end(code_mask, content_from);
                for (key, from) in citation_keys(&text[content_from..content_to], content_from) {
                    facts.use_(UseKind::Cite, key, from, None, false);
                }
                index = content_to;
                continue;
            }
        }
        index += 1;
    }
}

fn bibliography_arguments_end(text: &[char], code_mask: &[char], open: usize) -> usize {
    let mut depth = 0;
    let mut end = open;
    while end < text.len() {
        match code_mask[end] {
            '(' => depth += 1,
            ')' => {
                depth -= 1;
                if depth == 0 {
                    break;
                }
            }
            _ => {}
        }
        end += 1;
    }
    end
}

fn bibliography_paths(facts: &mut Facts<'_>, text: &[char], from: usize, end: usize) {
    let mut position = from;
    while position < end {
        if text[position] == '"' {
            if let Some(close) = (position + 1..end).find(|at| text[*at] == '"') {
                let path = string_of(&text[position + 1..close]);
                let target = resolve_project_path(facts.file, &path, None);
                facts.use_(UseKind::Bibliography, path, position + 1, target, false);
                position = close + 1;
                continue;
            }
        }
        if text[position] == ':' {
            break;
        }
        position += 1;
    }
}

fn cites_full(code_mask: &[char], from: usize, end: usize) -> bool {
    (from..end).any(|at| {
        starts_with_at(code_mask, at, "full")
            && !code_mask
                .get(at.wrapping_sub(1))
                .is_some_and(|before| is_identifier_continue(*before))
            && {
                let colon = skip_spaces(code_mask, at + 4);
                code_mask.get(colon) == Some(&':')
                    && starts_with_at(code_mask, skip_spaces(code_mask, colon + 1), "true")
            }
    })
}

fn bibliography_calls(facts: &mut Facts<'_>, text: &[char], code_mask: &[char]) {
    let mut index = 0;
    while index < code_mask.len() {
        if starts_with_at(code_mask, index, "#bibliography") {
            let cursor = skip_spaces(text, index + "#bibliography".len());
            if text.get(cursor) == Some(&'(') {
                let end = bibliography_arguments_end(text, code_mask, cursor);
                bibliography_paths(facts, text, cursor + 1, end);
                if cites_full(code_mask, cursor + 1, end) {
                    facts.facts.cites_all = true;
                }
                index = end;
                continue;
            }
        }
        index += 1;
    }
}

fn image_path(text: &[char], from: usize) -> Option<(usize, usize)> {
    let cursor = skip_spaces(text, from);
    if text.get(cursor) != Some(&'(') {
        return None;
    }
    let cursor = skip_spaces(text, cursor + 1);
    if text.get(cursor) != Some(&'"') {
        return None;
    }
    let close = (cursor + 1..text.len()).find(|at| text[*at] == '"')?;
    Some((cursor, close))
}

fn image_calls(facts: &mut Facts<'_>, text: &[char], code_mask: &[char]) {
    let mut index = 0;
    while index < text.len() {
        if starts_with_at(text, index, "#image") && code_mask.get(index) == Some(&'#') {
            if let Some((open, close)) = image_path(text, index + "#image".len()) {
                let path = string_of(&text[open + 1..close]);
                let target = resolve_project_path(facts.file, &path, None);
                facts.use_(UseKind::Asset, path, open + 1, target, false);
                index = close + 1;
                continue;
            }
        }
        index += 1;
    }
}

pub(crate) fn analyze(file: &str, raw_text: &str) -> FileFacts {
    let source = Source::new(raw_text);
    let raw = source.chars.clone();
    let (text, code, in_code) = mask_source_with_code_regions(&raw);
    let code_mask = mask_quoted_contents(&text);
    let mut facts = Facts {
        file,
        source: &source,
        facts: FileFacts::default(),
    };
    headings(&mut facts, &raw);
    labels(&mut facts, &raw, &code);
    references(&mut facts, &code);
    includes(&mut facts, &text, &in_code);
    let_bindings(&mut facts, &code_mask);
    reference_calls(&mut facts, &code_mask);
    cite_calls(&mut facts, &text, &code_mask);
    bibliography_calls(&mut facts, &text, &code_mask);
    image_calls(&mut facts, &text, &code_mask);
    facts.facts
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn headings_labels_references_and_citations() {
        let facts = analyze(
            "main.typ",
            "= Introduction <sec:intro>\n== Results\nSee @sec:intro. #cite(<knuth>) // @hidden\n#figure([x]) <fig:a>\n@fig:a\n#bibliography(\"refs.bib\")\n#include \"chapter.typ\"\n#let title = \"x @nope\"\n",
        );
        let sections: Vec<(String, Option<u32>)> = facts
            .defs
            .iter()
            .filter(|def| def.kind == DefKind::Section)
            .map(|def| (def.name.clone(), def.level))
            .collect();
        assert_eq!(
            sections,
            [
                ("Introduction".to_string(), Some(0)),
                ("Results".to_string(), Some(1))
            ]
        );
        let labels: Vec<&str> = facts
            .defs
            .iter()
            .filter(|def| def.kind == DefKind::Label)
            .map(|def| def.name.as_str())
            .collect();
        assert_eq!(labels, ["sec:intro", "fig:a"]);
        let refs: Vec<&str> = facts
            .uses
            .iter()
            .filter(|use_| use_.kind == UseKind::Ref)
            .map(|use_| use_.name.as_str())
            .collect();
        assert_eq!(refs, ["sec:intro", "fig:a"]);
        let cites: Vec<&str> = facts
            .uses
            .iter()
            .filter(|use_| use_.kind == UseKind::Cite)
            .map(|use_| use_.name.as_str())
            .collect();
        assert_eq!(cites, ["knuth"]);
        let include = facts
            .uses
            .iter()
            .find(|use_| use_.kind == UseKind::Include)
            .unwrap();
        assert_eq!(include.target.as_deref(), Some("chapter.typ"));
        assert!(facts
            .uses
            .iter()
            .any(|use_| use_.kind == UseKind::Bibliography && use_.name == "refs.bib"));
        assert!(facts
            .defs
            .iter()
            .any(|def| def.kind == DefKind::Macro && def.name == "title"));
    }

    #[test]
    fn headings_need_a_space_and_drop_a_trailing_label() {
        let facts = analyze(
            "main.typ",
            "= One <a>\n==Two\n=== Three <b> and <c>\n======= Seven\n=\tTab\n",
        );
        let sections: Vec<(String, Option<u32>)> = facts
            .defs
            .iter()
            .filter(|def| def.kind == DefKind::Section)
            .map(|def| (def.name.clone(), def.level))
            .collect();
        assert_eq!(
            sections,
            [
                ("One".to_string(), Some(0)),
                ("Three <b> and".to_string(), Some(2)),
                ("Seven".to_string(), Some(6)),
                ("Tab".to_string(), Some(0)),
            ]
        );
    }

    #[test]
    fn headings_cover_indented_deep_and_call_forms_while_ignoring_non_outlined() {
        let facts = analyze(
            "main.typ",
            "= One\n  = Indented\n======= Seven\n#heading[Call]\n#heading(level: 2)[Second]\n#heading(outlined: false)[Hidden]\n#set heading(numbering: \"1.\")\n// = Commented\n```typ\n= Raw\n#heading[Raw call]\n```\n#let s = \"a\n  = In string\"\n$\n  x\n  = y\n$\n",
        );
        let sections: Vec<(String, Option<u32>, u32)> = facts
            .defs
            .iter()
            .filter(|def| def.kind == DefKind::Section)
            .map(|def| (def.name.clone(), def.level, def.line))
            .collect();
        assert_eq!(
            sections,
            [
                ("One".to_string(), Some(0), 1),
                ("Indented".to_string(), Some(0), 2),
                ("Seven".to_string(), Some(6), 3),
                ("Call".to_string(), Some(0), 4),
                ("Second".to_string(), Some(1), 5),
            ]
        );
    }

    #[test]
    fn calls_take_their_labels_keys_paths_and_stop_at_named_arguments() {
        let facts = analyze(
            "main.typ",
            "#ref(<r1>) #link( <l1> ) #ref(<broken\n#cite(<c1>, \"c2\", label(\"c3\"))\n#bibliography((\"a.bib\", \"b.yml\"), title: \"skip.bib\")\n#bibliography(style: \"ieee\", \"late.bib\")\n#image(\"fig.png\")\n#image(width: 1cm, \"x.png\")\n#include \"../up\" #import \"lib.typ\": *\n",
        );
        let named = |kind: UseKind| -> Vec<(String, Option<String>)> {
            facts
                .uses
                .iter()
                .filter(|use_| use_.kind == kind)
                .map(|use_| (use_.name.clone(), use_.target.clone()))
                .collect()
        };
        assert_eq!(
            named(UseKind::Ref),
            [("r1".to_string(), None), ("l1".to_string(), None)]
        );
        assert_eq!(
            named(UseKind::Cite),
            [
                ("c1".to_string(), None),
                ("c2".to_string(), None),
                ("c3".to_string(), None)
            ]
        );
        assert_eq!(
            named(UseKind::Bibliography),
            [
                ("a.bib".to_string(), Some("a.bib".to_string())),
                ("b.yml".to_string(), Some("b.yml".to_string())),
            ]
        );
        assert_eq!(
            named(UseKind::Asset),
            [("fig.png".to_string(), Some("fig.png".to_string()))]
        );
        assert!(named(UseKind::Include).is_empty());
        assert_eq!(
            named(UseKind::Import),
            [("lib.typ".to_string(), Some("lib.typ".to_string()))]
        );
    }

    #[test]
    fn labels_inside_an_unfinished_reference_call_are_not_definitions() {
        let facts = analyze("main.typ", "#ref(<inside>) <outside>\n#cite( <also>\n");
        let labels: Vec<&str> = facts
            .defs
            .iter()
            .filter(|def| def.kind == DefKind::Label)
            .map(|def| def.name.as_str())
            .collect();
        assert_eq!(labels, ["outside"]);
    }

    #[test]
    fn masks_blank_comments_raw_blocks_strings_and_autolinks() {
        let source =
            "a // c\nb /* x /* y */ z */ `raw` #let s = \"q[\" [t]\nsee https://x.org/a) end";
        let chars: Vec<char> = source.chars().collect();
        let (text, code) = mask_source(&chars);
        let blank = |count: usize| " ".repeat(count);
        assert_eq!(
            text.iter().collect::<String>(),
            format!(
                "a {}\nb {} {} #let s = \"q[\" [t]\nsee https://x.org/a) end",
                blank(4),
                blank(17),
                blank(5)
            )
        );
        assert_eq!(
            code.iter().collect::<String>(),
            format!(
                "a {}\nb {} {} #let s = {} [t]\nsee {}) end",
                blank(4),
                blank(17),
                blank(5),
                blank(4),
                blank(15)
            )
        );
    }

    #[test]
    fn rooted_imports_start_at_the_project_and_climbing_out_resolves_nothing() {
        assert_eq!(
            resolve_import("chapters/a.typ", "/template.typ").as_deref(),
            Some("template.typ")
        );
        assert_eq!(resolve_import("a.typ", "../outside.typ"), None);
        assert_eq!(resolve_import("chapters/a.typ", "../../outside"), None);
    }

    #[test]
    fn code_mode_includes_are_edges_but_prose_is_not() {
        let facts = analyze(
            "main.typ",
            "#let ch = include \"ch.typ\"\n#{\n  include \"b.typ\"\n}\nWe include \"prose.typ\" here.\n#import \"/lib.typ\": *\n",
        );
        let inputs: Vec<(UseKind, Option<String>)> = facts
            .uses
            .iter()
            .filter(|use_| matches!(use_.kind, UseKind::Include | UseKind::Import))
            .map(|use_| (use_.kind, use_.target.clone()))
            .collect();
        assert_eq!(
            inputs,
            [
                (UseKind::Include, Some("ch.typ".to_string())),
                (UseKind::Include, Some("b.typ".to_string())),
                (UseKind::Import, Some("lib.typ".to_string())),
            ]
        );
    }

    #[test]
    fn a_full_bibliography_cites_everything() {
        assert!(analyze("main.typ", "#bibliography(\"refs.bib\", full: true)\n").cites_all);
        assert!(!analyze("main.typ", "#bibliography(\"refs.bib\", full: false)\n").cites_all);
        assert!(!analyze("main.typ", "#bibliography(\"refs.bib\")\n").cites_all);
    }

    #[test]
    fn imports_resolve_relative_to_the_file_with_a_default_extension() {
        assert_eq!(
            resolve_import("chapters/a.typ", "../lib").as_deref(),
            Some("lib.typ")
        );
        assert_eq!(resolve_import("a.typ", "@preview/x:0.1.0"), None);
        assert_eq!(
            resolve_import("a.typ", "data/x.json").as_deref(),
            Some("data/x.json")
        );
    }
}
