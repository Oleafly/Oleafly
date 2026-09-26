const MAGIC_COMMENT_LINES: usize = 50;
const TITLE_CHARACTERS: usize = 80;
const ARGUMENT_WINDOW: usize = 1024;

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct TexMagicComments {
    pub root: Option<String>,
    pub program: Option<String>,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum MagicKey {
    Root,
    Program,
}

pub fn tex_magic_comments(text: &str) -> TexMagicComments {
    let mut found = TexMagicComments::default();
    for line in text.lines().take(MAGIC_COMMENT_LINES) {
        match magic_comment(line) {
            Some((MagicKey::Root, value)) if found.root.is_none() => {
                found.root = Some(value.to_owned());
            }
            Some((MagicKey::Program, value)) if found.program.is_none() => {
                found.program = Some(value.to_owned());
            }
            _ => {}
        }
    }
    found
}

fn magic_comment(line: &str) -> Option<(MagicKey, &str)> {
    let rest = line.trim_start().strip_prefix('%')?.trim_start();
    let rest = rest.strip_prefix('!').unwrap_or(rest).trim_start();
    let rest = strip_prefix_ignore_case(rest, "tex")?;
    let spaced = rest.trim_start();
    if spaced.len() == rest.len() {
        return None;
    }
    let (key, rest) = strip_prefix_ignore_case(spaced, "root")
        .map(|rest| (MagicKey::Root, rest))
        .or_else(|| {
            strip_prefix_ignore_case(spaced, "program").map(|rest| (MagicKey::Program, rest))
        })?;
    let value = rest.trim_start().strip_prefix('=')?.trim();
    (!value.is_empty()).then_some((key, value))
}

fn strip_prefix_ignore_case<'a>(text: &'a str, prefix: &str) -> Option<&'a str> {
    let (head, rest) = text.split_at_checked(prefix.len())?;
    head.eq_ignore_ascii_case(prefix).then_some(rest)
}

pub(super) fn normalize_project_path(path: &str) -> Option<String> {
    let replaced = path.replace('\\', "/");
    if replaced
        .chars()
        .any(|character| character.is_ascii_control())
    {
        return None;
    }
    let bytes = replaced.as_bytes();
    let drive =
        bytes.len() >= 3 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':' && bytes[2] == b'/';
    if replaced.starts_with('/') || drive {
        return None;
    }
    let mut parts: Vec<&str> = Vec::new();
    for part in replaced.split('/') {
        match part {
            "" | "." => {}
            ".." => {
                parts.pop()?;
            }
            _ => parts.push(part),
        }
    }
    (!parts.is_empty()).then(|| parts.join("/"))
}

pub(super) fn parent_of(path: &str) -> &str {
    path.rsplit_once('/').map_or("", |(parent, _)| parent)
}

pub(super) fn has_extension(path: &str) -> bool {
    path.rsplit_once('.').is_some_and(|(_, suffix)| {
        !suffix.is_empty() && suffix.bytes().all(|byte| byte.is_ascii_alphanumeric())
    })
}

fn has_scheme(raw: &str) -> bool {
    let mut characters = raw.char_indices();
    if !characters
        .next()
        .is_some_and(|(_, first)| first.is_ascii_alphabetic())
    {
        return false;
    }
    for (_, character) in characters {
        if character == ':' {
            return true;
        }
        if !(character.is_ascii_alphanumeric() || matches!(character, '+' | '.' | '-')) {
            return false;
        }
    }
    false
}

pub(super) fn resolve_in(directory: &str, raw: &str) -> Option<String> {
    let trimmed = raw.trim();
    let unquoted = trimmed.strip_prefix(['"', '\'']).unwrap_or(trimmed);
    let unquoted = unquoted.strip_suffix(['"', '\'']).unwrap_or(unquoted);
    if unquoted.is_empty() || unquoted.starts_with(['#', '@', '/']) || has_scheme(unquoted) {
        return None;
    }
    let relative = unquoted.strip_prefix("./").unwrap_or(unquoted);
    if directory.is_empty() {
        normalize_project_path(relative)
    } else {
        normalize_project_path(&format!("{directory}/{relative}"))
    }
}

pub(super) fn resolve_project_path(
    from_file: &str,
    raw: &str,
    default_extension: Option<&str>,
) -> Option<String> {
    let mut resolved = resolve_in(parent_of(from_file), raw)?;
    if let Some(extension) = default_extension {
        if !has_extension(&resolved) {
            resolved.push_str(extension);
        }
    }
    Some(resolved)
}

pub(super) fn mask_latex_comments(text: &str) -> String {
    text.split('\n')
        .map(|line| &line[..latex_comment_start(line).unwrap_or(line.len())])
        .collect::<Vec<_>>()
        .join("\n")
}

fn latex_comment_start(line: &str) -> Option<usize> {
    let mut backslashes = 0usize;
    for (index, byte) in line.bytes().enumerate() {
        match byte {
            b'\\' => backslashes += 1,
            b'%' if backslashes.is_multiple_of(2) => return Some(index),
            _ => backslashes = 0,
        }
    }
    None
}

pub(super) fn document_class(masked: &str) -> Option<(Option<String>, String)> {
    for (at, _) in masked.match_indices("\\document") {
        let rest = &masked[at + "\\document".len()..];
        let Some(rest) = rest
            .strip_prefix("class")
            .or_else(|| rest.strip_prefix("style"))
        else {
            continue;
        };
        if let Some(parsed) = class_arguments(rest) {
            return Some(parsed);
        }
    }
    None
}

fn class_arguments(text: &str) -> Option<(Option<String>, String)> {
    let mut rest = text.trim_start();
    let mut option = None;
    if let Some(inner) = rest.strip_prefix('[') {
        let (value, after) = inner.split_once(']')?;
        option = Some(value.trim().to_owned());
        rest = after.trim_start();
    }
    let (class, _) = rest.strip_prefix('{')?.split_once('}')?;
    let class = class.trim();
    (!class.is_empty()).then(|| (option, class.to_owned()))
}

pub(super) fn has_begin_document(masked: &str) -> bool {
    masked.match_indices("\\begin").any(|(at, _)| {
        masked[at + "\\begin".len()..]
            .trim_start()
            .starts_with("{document}")
    })
}

pub(super) fn has_bibliography(masked: &str) -> bool {
    [
        "\\bibliography{",
        "\\addbibresource",
        "\\printbibliography",
        "\\begin{thebibliography}",
    ]
    .iter()
    .any(|needle| masked.contains(needle))
}

pub(super) fn latex_title(masked: &str) -> Option<String> {
    for (at, _) in masked.match_indices("\\title") {
        let rest = &masked[at + "\\title".len()..];
        if rest.starts_with(|character: char| character.is_ascii_alphabetic()) {
            continue;
        }
        let mut rest = rest.trim_start();
        if let Some(inner) = rest.strip_prefix('[') {
            let Some((_, after)) = inner.split_once(']') else {
                continue;
            };
            rest = after.trim_start();
        }
        let Some(body) = rest.strip_prefix('{').and_then(balanced_group) else {
            continue;
        };
        let title = clean_title(body);
        if !title.is_empty() {
            return Some(title);
        }
    }
    None
}

fn balanced_group(text: &str) -> Option<&str> {
    let mut depth = 1usize;
    for (index, character) in text.char_indices() {
        match character {
            '{' => depth += 1,
            '}' => {
                depth -= 1;
                if depth == 0 {
                    return Some(&text[..index]);
                }
            }
            _ => {}
        }
    }
    None
}

pub(super) fn clean_title(text: &str) -> String {
    let mut words = String::new();
    let mut characters = text.chars().peekable();
    while let Some(character) = characters.next() {
        match character {
            '{' | '}' | '~' => words.push(' '),
            '\\' => {
                let mut command = false;
                while characters
                    .peek()
                    .is_some_and(|next| next.is_ascii_alphabetic())
                {
                    characters.next();
                    command = true;
                }
                if !command {
                    characters.next();
                }
                words.push(' ');
            }
            _ => words.push(character),
        }
    }
    words
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .chars()
        .take(TITLE_CHARACTERS)
        .collect()
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub(super) struct LatexReferences {
    pub(super) inputs: Vec<String>,
    pub(super) graphics: Vec<String>,
    pub(super) bibliographies: Vec<String>,
}

pub(super) fn latex_references(masked: &str) -> LatexReferences {
    let mut found = LatexReferences::default();
    let mut cursor = 0usize;
    while let Some(offset) = masked[cursor..].find('\\') {
        let start = cursor + offset + 1;
        let name_end = start
            + masked[start..]
                .bytes()
                .take_while(u8::is_ascii_alphabetic)
                .count();
        cursor = name_end.max(start);
        match &masked[start..name_end] {
            name @ ("input" | "include" | "subfile" | "InputIfFileExists") => {
                if let Some((argument, end)) = braced_argument(masked, name_end) {
                    found.inputs.push(argument.to_owned());
                    cursor = end;
                } else if name == "input" {
                    if let Some(argument) = bare_argument(&masked[name_end..]) {
                        found.inputs.push(argument.to_owned());
                    }
                }
            }
            "import" | "subimport" | "inputfrom" | "subinputfrom" | "includefrom"
            | "subincludefrom" => {
                if let Some((directory, end)) = braced_argument(masked, name_end) {
                    if let Some((file, end)) = braced_argument(masked, end) {
                        found
                            .inputs
                            .push(format!("{}/{file}", directory.trim_end_matches('/')));
                        cursor = end;
                    }
                }
            }
            "includegraphics" => {
                if let Some((argument, end)) = braced_argument(masked, name_end) {
                    found.graphics.push(argument.to_owned());
                    cursor = end;
                }
            }
            "bibliography" => {
                if let Some((argument, end)) = braced_argument(masked, name_end) {
                    found.bibliographies.extend(
                        argument
                            .split(',')
                            .map(str::trim)
                            .filter(|name| !name.is_empty())
                            .map(|name| {
                                if has_extension(name) {
                                    name.to_owned()
                                } else {
                                    format!("{name}.bib")
                                }
                            }),
                    );
                    cursor = end;
                }
            }
            "addbibresource" => {
                if let Some((argument, end)) = braced_argument(masked, name_end) {
                    found.bibliographies.push(argument.to_owned());
                    cursor = end;
                }
            }
            _ => {}
        }
    }
    found
}

fn braced_argument(text: &str, from: usize) -> Option<(&str, usize)> {
    let window_end = floor_boundary(text, from.saturating_add(ARGUMENT_WINDOW));
    let window = &text[from..window_end];
    let mut rest = window.trim_start();
    rest = rest.strip_prefix('*').unwrap_or(rest).trim_start();
    while let Some(inner) = rest.strip_prefix('[') {
        let (_, after) = inner.split_once(']')?;
        rest = after.trim_start();
    }
    let body = rest.strip_prefix('{')?;
    let close = body.find(['{', '}'])?;
    if body.as_bytes()[close] != b'}' {
        return None;
    }
    let argument = body[..close].trim();
    let consumed = window.len() - body.len() + close + 1;
    (!argument.is_empty()).then_some((argument, from + consumed))
}

fn bare_argument(text: &str) -> Option<&str> {
    if !text.starts_with([' ', '\t']) {
        return None;
    }
    let token = text.trim_start_matches([' ', '\t']);
    let end = token
        .find(|character: char| {
            character.is_whitespace() || matches!(character, '}' | '\\' | '%' | '{')
        })
        .unwrap_or(token.len());
    let argument = &token[..end];
    (!argument.is_empty()).then_some(argument)
}

fn floor_boundary(text: &str, index: usize) -> usize {
    let mut index = index.min(text.len());
    while !text.is_char_boundary(index) {
        index -= 1;
    }
    index
}

pub(super) fn mask_typst_comments(text: &str) -> String {
    let mut masked = String::with_capacity(text.len());
    let mut characters = text.chars().peekable();
    let mut depth = 0usize;
    let mut line_comment = false;
    while let Some(character) = characters.next() {
        if character == '\n' {
            line_comment = false;
            masked.push('\n');
            continue;
        }
        if line_comment {
            masked.push(' ');
            continue;
        }
        let next = characters.peek().copied();
        if depth == 0 && character == '/' && next == Some('/') {
            line_comment = true;
            masked.push(' ');
            continue;
        }
        if character == '/' && next == Some('*') {
            characters.next();
            depth += 1;
            masked.push_str("  ");
            continue;
        }
        if depth > 0 && character == '*' && next == Some('/') {
            characters.next();
            depth -= 1;
            masked.push_str("  ");
            continue;
        }
        masked.push(if depth > 0 { ' ' } else { character });
    }
    masked
}

pub(super) fn typst_references(masked: &str) -> Vec<String> {
    let mut found = Vec::new();
    for keyword in ["#include", "#import"] {
        for (at, _) in masked.match_indices(keyword) {
            let rest = &masked[at + keyword.len()..];
            if !rest.starts_with(char::is_whitespace) {
                continue;
            }
            let Some((target, _)) = rest
                .trim_start()
                .strip_prefix('"')
                .and_then(|body| body.split_once('"'))
            else {
                continue;
            };
            if !target.is_empty() && !target.starts_with('@') {
                found.push(target.to_owned());
            }
        }
    }
    found
}

pub(super) fn typst_library_like(stem: &str, masked: &str) -> bool {
    if matches!(
        stem,
        "lib" | "template" | "utils" | "util" | "conf" | "config" | "style" | "styles"
    ) {
        return true;
    }
    !masked.lines().any(|line| {
        let trimmed = line.trim_end();
        !trimmed.is_empty()
            && !line.starts_with(char::is_whitespace)
            && !["#let", "#import", "#set", "#show", "}", ")", "]"]
                .iter()
                .any(|prefix| trimmed.starts_with(prefix))
    })
}

pub(super) fn typst_title(masked: &str) -> Option<String> {
    let from_document = masked.find("#set document(").and_then(|at| {
        let rest = &masked[at..];
        let rest = &rest[..rest.find(')').unwrap_or(rest.len())];
        let after = &rest[rest.find("title:")? + "title:".len()..];
        let (title, _) = after.trim_start().strip_prefix('"')?.split_once('"')?;
        Some(clean_title(title))
    });
    from_document.filter(|title| !title.is_empty()).or_else(|| {
        masked
            .lines()
            .find_map(|line| line.strip_prefix("= "))
            .map(clean_title)
            .filter(|title| !title.is_empty())
    })
}

pub(super) fn markdown_references(text: &str) -> Vec<String> {
    let mut found = Vec::new();
    let mut fence: Option<&str> = None;
    for line in text.lines() {
        let trimmed = line.trim_start();
        if let Some(marker) = fence {
            if trimmed.starts_with(marker) {
                fence = None;
            }
            continue;
        }
        if let Some(marker) = ["```", "~~~"]
            .into_iter()
            .find(|marker| trimmed.starts_with(marker))
        {
            fence = Some(marker);
            continue;
        }
        let rest = trimmed
            .strip_prefix("!include")
            .or_else(|| include_keyword(trimmed.strip_prefix("{{<")?))
            .or_else(|| include_keyword(trimmed.strip_prefix("{%")?));
        if let Some(target) = rest.and_then(include_target) {
            found.push(target.to_owned());
        }
    }
    found
}

fn include_keyword(text: &str) -> Option<&str> {
    text.trim_start().strip_prefix("include")
}

fn include_target(text: &str) -> Option<&str> {
    if !text.starts_with(char::is_whitespace) {
        return None;
    }
    let text = text.trim_start();
    let target = match text.chars().next() {
        Some(quote @ ('"' | '\'')) => text[1..].split_once(quote)?.0,
        _ => {
            let end = text
                .find(|character: char| {
                    character.is_whitespace() || matches!(character, '>' | '%' | '}')
                })
                .unwrap_or(text.len());
            &text[..end]
        }
    };
    (!target.is_empty()).then_some(target)
}

pub(super) fn markdown_title(text: &str) -> Option<String> {
    let mut lines = text.lines();
    if lines.next().map(str::trim_end) == Some("---") {
        for line in lines.by_ref() {
            let line = line.trim_end();
            if line == "---" || line == "..." {
                break;
            }
            if let Some(value) = line.strip_prefix("title:") {
                let title = clean_title(value.trim().trim_matches(['"', '\'']));
                if !title.is_empty() {
                    return Some(title);
                }
            }
        }
    }
    text.lines()
        .find_map(|line| line.strip_prefix("# "))
        .map(clean_title)
        .filter(|title| !title.is_empty())
}

fn strip_hash_comment(line: &str) -> &str {
    let mut quote: Option<char> = None;
    for (index, character) in line.char_indices() {
        match (quote, character) {
            (None, '#') => return &line[..index],
            (None, '\'' | '"') => quote = Some(character),
            (Some(open), _) if character == open => quote = None,
            _ => {}
        }
    }
    line
}

pub(super) fn latexmk_default_files(text: &str) -> Vec<String> {
    let code = text
        .lines()
        .map(strip_hash_comment)
        .collect::<Vec<_>>()
        .join("\n");
    let mut files = Vec::new();
    for (at, _) in code.match_indices("@default_files") {
        if let Some(parsed) = default_files_assignment(&code[at + "@default_files".len()..]) {
            files = parsed;
        }
    }
    files
        .into_iter()
        .filter(|file| !file.is_empty() && !file.contains(['*', '?']))
        .collect()
}

fn default_files_assignment(text: &str) -> Option<Vec<String>> {
    let rest = text.trim_start().strip_prefix('=')?.trim_start();
    if let Some(list) = rest.strip_prefix("qw") {
        let list = list.trim_start();
        let open = list.chars().next()?;
        let close = match open {
            '(' => ')',
            '[' => ']',
            '{' => '}',
            '<' => '>',
            other => other,
        };
        let (body, _) = list[open.len_utf8()..].split_once(close)?;
        return Some(body.split_whitespace().map(str::to_owned).collect());
    }
    let (body, _) = rest.strip_prefix('(')?.split_once(')')?;
    Some(quoted_strings(body))
}

fn quoted_strings(text: &str) -> Vec<String> {
    let mut found = Vec::new();
    let mut rest = text;
    while let Some(start) = rest.find(['\'', '"']) {
        let quote = rest[start..].chars().next().unwrap_or('"');
        let body = &rest[start + 1..];
        let Some((value, after)) = body.split_once(quote) else {
            break;
        };
        found.push(value.trim().to_owned());
        rest = after;
    }
    found
}

pub(super) fn arxiv_toplevel_sources(text: &str) -> Vec<String> {
    let Ok(value) = serde_json::from_str::<serde_json::Value>(text) else {
        return Vec::new();
    };
    value
        .get("sources")
        .and_then(serde_json::Value::as_array)
        .into_iter()
        .flatten()
        .filter(|source| {
            source.get("usage").and_then(serde_json::Value::as_str) == Some("toplevel")
        })
        .filter_map(|source| source.get("filename").and_then(serde_json::Value::as_str))
        .map(str::to_owned)
        .collect()
}

pub(super) fn typst_template_entrypoint(text: &str) -> Option<String> {
    let mut section = String::new();
    let mut path = None;
    let mut entrypoint = None;
    for line in text.lines() {
        let line = strip_hash_comment(line).trim();
        if let Some(header) = line
            .strip_prefix('[')
            .and_then(|rest| rest.strip_suffix(']'))
        {
            section = header.trim().to_owned();
            continue;
        }
        if section != "template" {
            continue;
        }
        let Some((key, value)) = line.split_once('=') else {
            continue;
        };
        let value = toml_string(value.trim());
        match key.trim() {
            "path" => path = value,
            "entrypoint" => entrypoint = value,
            _ => {}
        }
    }
    let entrypoint = entrypoint.filter(|value| !value.is_empty())?;
    Some(match path.filter(|value| !value.is_empty()) {
        Some(path) => format!("{}/{entrypoint}", path.trim_end_matches('/')),
        None => entrypoint,
    })
}

fn toml_string(value: &str) -> Option<String> {
    let quote = value
        .chars()
        .next()
        .filter(|first| matches!(first, '"' | '\''))?;
    let (inner, _) = value[1..].split_once(quote)?;
    Some(inner.to_owned())
}
