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
    Markup {
        close: bool,
        brackets: i32,
    },
    Code {
        line: bool,
        started: bool,
        parens: i32,
        braces: i32,
        quoted: bool,
    },
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

/// `maskTypstSource`: `text` without comments and raw blocks; `code` also
/// without string contents and autolinks.
pub(crate) fn mask_source(raw: &[char]) -> (Vec<char>, Vec<char>) {
    let mut text = raw.to_vec();
    let mut code = raw.to_vec();
    let mut frames = vec![Frame::Markup {
        close: false,
        brackets: 0,
    }];
    let blank = |text: &mut Vec<char>, code: &mut Vec<char>, from: usize, to: usize| {
        for index in from..to.min(raw.len()) {
            if raw[index] != '\n' {
                text[index] = ' ';
                code[index] = ' ';
            }
        }
    };
    let mut index = 0;
    while index < raw.len() {
        let character = raw[index];
        let step = match frames.last_mut().expect("the markup frame stays") {
            Frame::Markup { close, brackets } => {
                if character == '\\' {
                    Step::Advance(index + 2)
                } else if let Some(link) = autolink_end(raw, index) {
                    for cell in code.iter_mut().take(link).skip(index) {
                        *cell = ' ';
                    }
                    Step::Advance(link.max(index + 1))
                } else if let Some(end) = opaque_end(raw, index) {
                    blank(&mut text, &mut code, index, end);
                    Step::Advance(end.max(index + 1))
                } else if *close && character == ']' && *brackets == 0 {
                    Step::PopAdvance(index + 1)
                } else if *close && character == '[' {
                    *brackets += 1;
                    Step::Advance(index + 1)
                } else if *close && character == ']' {
                    *brackets -= 1;
                    Step::Advance(index + 1)
                } else if character == '#' {
                    let frame = Frame::Code {
                        line: opens_line_code(raw, index),
                        started: false,
                        parens: 0,
                        braces: 0,
                        quoted: false,
                    };
                    Step::Push(frame, index + 1)
                } else {
                    Step::Advance(index + 1)
                }
            }
            Frame::Code {
                line,
                started,
                parens,
                braces,
                quoted,
            } => {
                if *quoted {
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
                } else if let Some(end) = opaque_end(raw, index) {
                    *started = true;
                    blank(&mut text, &mut code, index, end);
                    Step::Advance(end.max(index + 1))
                } else if character == '"' {
                    *quoted = true;
                    code[index] = ' ';
                    *started = true;
                    Step::Advance(index + 1)
                } else if character == '[' {
                    *started = true;
                    Step::Push(
                        Frame::Markup {
                            close: true,
                            brackets: 0,
                        },
                        index + 1,
                    )
                } else if character == '(' {
                    *parens += 1;
                    *started = true;
                    Step::Advance(index + 1)
                } else if character == '{' {
                    *braces += 1;
                    *started = true;
                    Step::Advance(index + 1)
                } else if character == ')' && *parens > 0 {
                    *parens -= 1;
                    Step::Advance(index + 1)
                } else if character == '}' && *braces > 0 {
                    *braces -= 1;
                    Step::Advance(index + 1)
                } else if (character == '\n' && *line)
                    || (*started
                        && !*line
                        && *parens == 0
                        && *braces == 0
                        && is_js_space(character))
                {
                    Step::Pop
                } else {
                    if !is_js_space(character) {
                        *started = true;
                    }
                    Step::Advance(index + 1)
                }
            }
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
    (text, code)
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

/// Everything the project map needs from one Typst file.
pub(crate) fn analyze(file: &str, raw_text: &str) -> FileFacts {
    let source = Source::new(raw_text);
    let raw = source.chars.clone();
    let (text, code) = mask_source(&raw);
    let code_mask = mask_quoted_contents(&text);
    let mut facts = FileFacts::default();
    let def =
        |facts: &mut FileFacts, kind: DefKind, name: String, from: usize, level: Option<u32>| {
            facts.defs.push(Def {
                kind,
                name,
                file: file.to_string(),
                from,
                line: source.line_of(from),
                level,
                explicit: true,
            });
        };
    let use_ = |facts: &mut FileFacts,
                kind: UseKind,
                name: String,
                from: usize,
                target: Option<String>,
                typst_at: bool| {
        facts.uses.push(Use {
            kind,
            name,
            file: file.to_string(),
            from,
            line: source.line_of(from),
            target,
            typst_at,
        });
    };

    // Headings: `= Title` at the start of a line; a trailing `<label>` isn't
    // part of the title.
    let mut line_start = 0;
    while line_start <= text.len() {
        let line_end = (line_start..text.len())
            .find(|index| text[*index] == '\n')
            .unwrap_or(text.len());
        let line = &text[line_start..line_end];
        let equals = line
            .iter()
            .take_while(|character| **character == '=')
            .count();
        if (1..=6).contains(&equals)
            && line
                .get(equals)
                .is_some_and(|character| *character == ' ' || *character == '\t')
        {
            let rest = string_of(&line[equals..]);
            let content = rest.trim_start_matches([' ', '\t']);
            let content_offset = equals + (rest.chars().count() - content.chars().count());
            let mut title = content.to_string();
            if let Some(open) = title.rfind('<') {
                let tail = &title[open..];
                let closes =
                    tail.trim_end_matches([' ', '\t']).ends_with('>') && !tail[1..].contains('<');
                let spaced = title[..open].ends_with([' ', '\t'])
                    && !title[..open].trim_end_matches([' ', '\t']).is_empty();
                if closes && spaced {
                    title.truncate(open);
                }
            }
            let title = trim_js(&title).to_string();
            if !title.is_empty() {
                let lead = content
                    .chars()
                    .take_while(|character| is_js_space(*character))
                    .count();
                def(
                    &mut facts,
                    DefKind::Section,
                    title,
                    line_start + content_offset + lead,
                    Some(equals as u32 - 1),
                );
            }
        }
        line_start = line_end + 1;
    }

    // Labels `<name>` (not inside `#ref(...)`, `#link(...)` or `#cite(...)`).
    let mut index = 0;
    while index < code.len() {
        if code[index] == '<' && !is_escaped(&code, index) {
            let end = label_run(&code, index + 1);
            if end > index + 1 && code.get(end) == Some(&'>') {
                let window_start = index.saturating_sub(80);
                let window = string_of(&raw[window_start..index]);
                let in_call = ["#ref", "#link", "#cite"].iter().any(|call| {
                    window.rfind(call).is_some_and(|at| {
                        let after = &window[at + call.len()..];
                        let after = after.trim_start();
                        after.starts_with('(') && !after.contains(')')
                    })
                });
                if !in_call {
                    def(
                        &mut facts,
                        DefKind::Label,
                        string_of(&code[index + 1..end]),
                        index + 1,
                        None,
                    );
                }
                index = end + 1;
                continue;
            }
        }
        index += 1;
    }

    // `@name` references.
    let mut index = 0;
    while index < code.len() {
        if code[index] == '@'
            && !is_escaped(&code, index)
            && !(index > 0 && is_name_character(code[index - 1]))
        {
            let end = label_run(&code, index + 1);
            if end > index + 1 {
                let name = trim_reference(&string_of(&code[index + 1..end])).to_string();
                if !name.is_empty() {
                    use_(&mut facts, UseKind::Ref, name, index + 1, None, true);
                }
                index = end;
                continue;
            }
        }
        index += 1;
    }

    // `#include "x"` and `#import "x"`.
    for keyword in ["include", "import"] {
        let pattern = format!("#{keyword}");
        let mut index = 0;
        while index < text.len() {
            if starts_with_at(&text, index, &pattern) {
                let mut cursor = index + pattern.len();
                let spaced = cursor;
                while text
                    .get(cursor)
                    .is_some_and(|character| is_js_space(*character))
                {
                    cursor += 1;
                }
                if cursor > spaced && text.get(cursor) == Some(&'"') {
                    if let Some(close) =
                        (cursor + 1..text.len()).find(|position| text[*position] == '"')
                    {
                        let raw_target = string_of(&text[cursor + 1..close]);
                        if !raw_target.is_empty() {
                            if let Some(target) = resolve_import(file, &raw_target) {
                                let kind = if keyword == "import" {
                                    UseKind::Import
                                } else {
                                    UseKind::Include
                                };
                                use_(
                                    &mut facts,
                                    kind,
                                    raw_target,
                                    cursor + 1,
                                    Some(target),
                                    false,
                                );
                            }
                        }
                        index = close + 1;
                        continue;
                    }
                }
            }
            index += 1;
        }
    }

    // `#let name` bindings.
    let mut index = 0;
    while index < code_mask.len() {
        if starts_with_at(&code_mask, index, "#let") {
            let mut cursor = index + 4;
            let spaced = cursor;
            while code_mask
                .get(cursor)
                .is_some_and(|character| is_js_space(*character))
            {
                cursor += 1;
            }
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
                def(
                    &mut facts,
                    DefKind::Macro,
                    string_of(&code_mask[cursor..end]),
                    cursor,
                    None,
                );
                index = end;
                continue;
            }
        }
        index += 1;
    }

    // `#ref(<x>)` and `#link(<x>)`.
    for call in ["#ref", "#link"] {
        let mut index = 0;
        while index < code_mask.len() {
            if starts_with_at(&code_mask, index, call) {
                let mut cursor = index + call.len();
                while code_mask
                    .get(cursor)
                    .is_some_and(|character| is_js_space(*character))
                {
                    cursor += 1;
                }
                if code_mask.get(cursor) == Some(&'(') {
                    cursor += 1;
                    while code_mask
                        .get(cursor)
                        .is_some_and(|character| is_js_space(*character))
                    {
                        cursor += 1;
                    }
                    if code_mask.get(cursor) == Some(&'<') {
                        let end = label_run(&code_mask, cursor + 1);
                        if end > cursor + 1 && code_mask.get(end) == Some(&'>') {
                            use_(
                                &mut facts,
                                UseKind::Ref,
                                string_of(&code_mask[cursor + 1..end]),
                                cursor + 1,
                                None,
                                false,
                            );
                        }
                    }
                }
            }
            index += 1;
        }
    }

    // `#cite(...)`.
    let mut index = 0;
    while index < code_mask.len() {
        if starts_with_at(&code_mask, index, "#cite") {
            let mut cursor = index + 5;
            while code_mask
                .get(cursor)
                .is_some_and(|character| is_js_space(*character))
            {
                cursor += 1;
            }
            if code_mask.get(cursor) == Some(&'(') {
                let content_from = cursor + 1;
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
                let content_to = if depth == 0 { end - 1 } else { end };
                for (key, from) in citation_keys(&text[content_from..content_to], content_from) {
                    use_(&mut facts, UseKind::Cite, key, from, None, false);
                }
                index = content_to;
                continue;
            }
        }
        index += 1;
    }

    // `#bibliography("a.bib")` / `#bibliography(("a.bib", "b.yml"))`.
    let mut index = 0;
    while index < code_mask.len() {
        if starts_with_at(&code_mask, index, "#bibliography") {
            let mut cursor = index + "#bibliography".len();
            while text
                .get(cursor)
                .is_some_and(|character| is_js_space(*character))
            {
                cursor += 1;
            }
            if text.get(cursor) == Some(&'(') {
                let mut depth = 0;
                let mut end = cursor;
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
                // String arguments before any `name:` argument.
                let mut position = cursor + 1;
                while position < end {
                    if text[position] == '"' {
                        if let Some(close) = (position + 1..end).find(|at| text[*at] == '"') {
                            let path = string_of(&text[position + 1..close]);
                            let target = resolve_project_path(file, &path, None);
                            use_(
                                &mut facts,
                                UseKind::Bibliography,
                                path,
                                position + 1,
                                target,
                                false,
                            );
                            position = close + 1;
                            continue;
                        }
                    }
                    if text[position] == ':' {
                        break;
                    }
                    position += 1;
                }
                index = end;
                continue;
            }
        }
        index += 1;
    }

    // `#image("x")` (missing figures).
    let mut index = 0;
    while index < text.len() {
        if starts_with_at(&text, index, "#image") && code_mask.get(index) == Some(&'#') {
            let mut cursor = index + "#image".len();
            while text
                .get(cursor)
                .is_some_and(|character| is_js_space(*character))
            {
                cursor += 1;
            }
            if text.get(cursor) == Some(&'(') {
                cursor += 1;
                while text
                    .get(cursor)
                    .is_some_and(|character| is_js_space(*character))
                {
                    cursor += 1;
                }
                if text.get(cursor) == Some(&'"') {
                    if let Some(close) = (cursor + 1..text.len()).find(|at| text[*at] == '"') {
                        let path = string_of(&text[cursor + 1..close]);
                        let target = resolve_project_path(file, &path, None);
                        use_(&mut facts, UseKind::Asset, path, cursor + 1, target, false);
                        index = close + 1;
                        continue;
                    }
                }
            }
        }
        index += 1;
    }
    facts
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
