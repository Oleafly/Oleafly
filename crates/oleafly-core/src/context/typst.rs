//! Typst: headings, labels, `@` references, `#cite`, `#include`/`#import`,
//! `#let` bindings and `#bibliography`, after the app's masking
//! (`packages/editor/src/typst-syntax.ts`).
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

/// The state of a `#` code expression.
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

/// The two masks `mask_source` builds.
struct Masks {
    text: Vec<char>,
    code: Vec<char>,
}

impl Masks {
    /// Blanks `from..to` in both masks (line breaks kept).
    fn blank(&mut self, raw: &[char], from: usize, to: usize) {
        for (index, character) in raw.iter().enumerate().take(to).skip(from) {
            if *character != '\n' {
                self.text[index] = ' ';
                self.code[index] = ' ';
            }
        }
    }
}

/// One step in markup. `close` marks a `[...]` block that ends at its
/// matching `]`, and `brackets` counts the `[` opened inside it.
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

/// One step inside a string of a code expression: the contents are blanked
/// in `code`, up to the closing quote.
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

/// One step in a `#` code expression.
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

/// `maskTypstSource`: `text` without comments and raw blocks; `code` also
/// without string contents and autolinks.
pub(crate) fn mask_source(raw: &[char]) -> (Vec<char>, Vec<char>) {
    let mut masks = Masks {
        text: raw.to_vec(),
        code: raw.to_vec(),
    };
    let mut frames = vec![Frame::Markup {
        close: false,
        brackets: 0,
    }];
    let mut index = 0;
    while index < raw.len() {
        let step = match frames.last_mut().expect("the markup frame stays") {
            Frame::Markup { close, brackets } => {
                markup_step(raw, index, &mut masks, *close, brackets)
            }
            Frame::Code(frame) => code_step(raw, index, &mut masks, frame),
        };
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
    (masks.text, masks.code)
}

/// `maskQuotedContents`: string contents blanked, quotes kept.
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

/// `resolveImport` from the legacy Typst parser: relative to the file,
/// `.typ` added when the last segment has no extension.
fn resolve_import(from: &str, raw: &str) -> Option<String> {
    if raw.starts_with('@') || raw.contains("://") || raw.starts_with('/') {
        return None;
    }
    let mut parts: Vec<&str> = from.split('/').collect();
    parts.pop();
    parts.extend(raw.strip_prefix("./").unwrap_or(raw).split('/'));
    let mut normalized: Vec<&str> = Vec::new();
    for part in parts {
        if part.is_empty() || part == "." {
            continue;
        }
        if part == ".." {
            normalized.pop();
        } else {
            normalized.push(part);
        }
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

/// The keys inside a `#cite(...)` argument: `<key>` or `"key"` (as the
/// first item, after `[`, `(` or `,`, or in `label("key")`).
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

/// A file's facts, as the scans below add them.
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

/// The first index at or after `cursor` that isn't white space.
fn skip_spaces(chars: &[char], mut cursor: usize) -> usize {
    while chars
        .get(cursor)
        .is_some_and(|character| is_js_space(*character))
    {
        cursor += 1;
    }
    cursor
}

/// Whether the `<` at `open` in `title` starts a `<label>` that ends it,
/// set off by a space.
fn ends_with_label(title: &str, open: usize) -> bool {
    let tail = &title[open..];
    let closes = tail.trim_end_matches([' ', '\t']).ends_with('>') && !tail[1..].contains('<');
    let spaced = title[..open].ends_with([' ', '\t'])
        && !title[..open].trim_end_matches([' ', '\t']).is_empty();
    closes && spaced
}

/// `= Title` at the start of a line: the title, its offset in the line and
/// its level (the first is 0). A trailing `<label>` isn't part of the title.
fn heading_in_line(line: &[char]) -> Option<(String, usize, u32)> {
    let equals = line
        .iter()
        .take_while(|character| **character == '=')
        .count();
    let spaced = line
        .get(equals)
        .is_some_and(|character| *character == ' ' || *character == '\t');
    if !(1..=6).contains(&equals) || !spaced {
        return None;
    }
    let rest = string_of(&line[equals..]);
    let content = rest.trim_start_matches([' ', '\t']);
    let content_offset = equals + (rest.chars().count() - content.chars().count());
    let mut title = content.to_string();
    if let Some(open) = title.rfind('<') {
        if ends_with_label(&title, open) {
            title.truncate(open);
        }
    }
    let title = trim_js(&title).to_string();
    if title.is_empty() {
        return None;
    }
    let lead = content
        .chars()
        .take_while(|character| is_js_space(*character))
        .count();
    Some((title, content_offset + lead, equals as u32 - 1))
}

/// Headings: `= Title` at the start of a line.
fn headings(facts: &mut Facts<'_>, text: &[char]) {
    let mut line_start = 0;
    while line_start <= text.len() {
        let line_end = (line_start..text.len())
            .find(|index| text[*index] == '\n')
            .unwrap_or(text.len());
        if let Some((title, offset, level)) = heading_in_line(&text[line_start..line_end]) {
            facts.def(DefKind::Section, title, line_start + offset, Some(level));
        }
        line_start = line_end + 1;
    }
}

/// Whether the `<` at `index` sits in the unfinished arguments of `#ref(`,
/// `#link(` or `#cite(`.
fn in_reference_call(raw: &[char], index: usize) -> bool {
    let window = string_of(&raw[index.saturating_sub(80)..index]);
    ["#ref", "#link", "#cite"].iter().any(|call| {
        window.rfind(call).is_some_and(|at| {
            let after = window[at + call.len()..].trim_start();
            after.starts_with('(') && !after.contains(')')
        })
    })
}

/// Labels `<name>` (not inside `#ref(...)`, `#link(...)` or `#cite(...)`).
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

/// `@name` references.
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

/// A `"..."` string after at least one space at `from`: where it opens and
/// where it closes.
fn quoted_after_space(text: &[char], from: usize) -> Option<(usize, usize)> {
    let cursor = skip_spaces(text, from);
    if cursor == from || text.get(cursor) != Some(&'"') {
        return None;
    }
    let close = (cursor + 1..text.len()).find(|position| text[*position] == '"')?;
    Some((cursor, close))
}

/// `#include "x"` and `#import "x"`.
fn includes(facts: &mut Facts<'_>, text: &[char]) {
    for keyword in ["include", "import"] {
        let pattern = format!("#{keyword}");
        let kind = if keyword == "import" {
            UseKind::Import
        } else {
            UseKind::Include
        };
        let mut index = 0;
        while index < text.len() {
            if starts_with_at(text, index, &pattern) {
                if let Some((open, close)) = quoted_after_space(text, index + pattern.len()) {
                    let raw_target = string_of(&text[open + 1..close]);
                    if !raw_target.is_empty() {
                        if let Some(target) = resolve_import(facts.file, &raw_target) {
                            facts.use_(kind, raw_target, open + 1, Some(target), false);
                        }
                    }
                    index = close + 1;
                    continue;
                }
            }
            index += 1;
        }
    }
}

/// `#let name` bindings.
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

/// The `<label>` that opens a call's arguments, for a call whose name ends
/// at `from`: the label and where it starts.
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

/// `#ref(<x>)` and `#link(<x>)`.
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

/// The end of the arguments that start at `content_from`, just after a
/// call's `(`: the matching `)`, or the end of the text when it never closes.
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

/// `#cite(...)`.
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

/// The end of the arguments that open at `open`: the matching `)`, or the
/// end of the text.
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

/// The string arguments of `#bibliography(...)` before any `name:` argument.
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

/// `#bibliography("a.bib")` / `#bibliography(("a.bib", "b.yml"))`.
fn bibliography_calls(facts: &mut Facts<'_>, text: &[char], code_mask: &[char]) {
    let mut index = 0;
    while index < code_mask.len() {
        if starts_with_at(code_mask, index, "#bibliography") {
            let cursor = skip_spaces(text, index + "#bibliography".len());
            if text.get(cursor) == Some(&'(') {
                let end = bibliography_arguments_end(text, code_mask, cursor);
                bibliography_paths(facts, text, cursor + 1, end);
                index = end;
                continue;
            }
        }
        index += 1;
    }
}

/// The `"path"` string that opens the arguments of an `#image` call whose
/// name ends at `from`: where it opens and where it closes.
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

/// `#image("x")` (missing figures).
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

/// Everything the project map needs from one Typst file.
pub(crate) fn analyze(file: &str, raw_text: &str) -> FileFacts {
    let source = Source::new(raw_text);
    let raw = source.chars.clone();
    let (text, code) = mask_source(&raw);
    let code_mask = mask_quoted_contents(&text);
    let mut facts = Facts {
        file,
        source: &source,
        facts: FileFacts::default(),
    };
    headings(&mut facts, &text);
    labels(&mut facts, &raw, &code);
    references(&mut facts, &code);
    includes(&mut facts, &text);
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
                ("Tab".to_string(), Some(0)),
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
        assert_eq!(
            named(UseKind::Include),
            [("../up".to_string(), Some("up.typ".to_string()))]
        );
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
