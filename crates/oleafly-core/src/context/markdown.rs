//! Markdown (Pandoc): headings, `{#id}` and automatic heading anchors,
//! `@key` citations, front-matter `bibliography:` and `!include` lines.
use super::text::{is_js_space, resolve_project_path, string_of, trim_js, Source};
use super::{Def, DefKind, FileFacts, Use, UseKind};

struct Fence {
    character: char,
    length: usize,
}

fn fence_marker(line: &str) -> Option<(char, usize)> {
    let trimmed = line.trim_start();
    let character = trimmed.chars().next()?;
    if character != '`' && character != '~' {
        return None;
    }
    let length = trimmed
        .chars()
        .take_while(|current| *current == character)
        .count();
    (length >= 3).then_some((character, length))
}

fn strip_trailing_attributes(title: &str) -> String {
    // `(?<!\s)\s+\{[^{}]*\}\s*$`
    let trimmed_end = title.trim_end();
    if trimmed_end.ends_with('}') {
        if let Some(open) = trimmed_end.rfind('{') {
            let inner = &trimmed_end[open + 1..trimmed_end.len() - 1];
            let before = &trimmed_end[..open];
            if !inner.contains(['{', '}'])
                && before.ends_with(char::is_whitespace)
                && !before.trim_end().is_empty()
            {
                return before.trim_end().to_string();
            }
        }
    }
    title.to_string()
}

fn strip_closing_hashes(title: &str) -> String {
    // `(?<!\s)\s+#+\s*$`
    let trimmed_end = title.trim_end();
    let without = trimmed_end.trim_end_matches('#');
    if without.len() < trimmed_end.len()
        && without.ends_with(char::is_whitespace)
        && !without.trim_end().is_empty()
    {
        return without.trim_end().to_string();
    }
    title.to_string()
}

fn mask_code_spans(line: &str) -> String {
    let chars: Vec<char> = line.chars().collect();
    let mut out = chars.clone();
    let mut index = 0;
    while index < chars.len() {
        if chars[index] != '`' {
            index += 1;
            continue;
        }
        let run = chars[index..]
            .iter()
            .take_while(|character| **character == '`')
            .count();
        let fence: Vec<char> = std::iter::repeat_n('`', run).collect();
        match (index + run..chars.len()).find(|at| chars[*at..].starts_with(&fence)) {
            Some(close) => {
                for cell in out.iter_mut().take(close + run).skip(index) {
                    *cell = ' ';
                }
                index = close + run;
            }
            None => index += run,
        }
    }
    string_of(&out)
}

fn markdown_heading_text(title: &str) -> String {
    let mut without_tags = String::new();
    let mut inside = false;
    for character in title.chars() {
        if character == '<' {
            inside = true;
        } else if character == '>' && inside {
            inside = false;
        } else if !inside {
            without_tags.push(character);
        }
    }
    // Links and images keep their text.
    let chars: Vec<char> = without_tags.chars().collect();
    let mut linked = String::new();
    let mut index = 0;
    while index < chars.len() {
        let start = if chars[index] == '!' && chars.get(index + 1) == Some(&'[') {
            index + 1
        } else {
            index
        };
        if chars[start] == '[' {
            if let Some(close) =
                (start + 1..chars.len()).find(|at| chars[*at] == ']' || chars[*at] == '[')
            {
                if chars[close] == ']' && chars.get(close + 1) == Some(&'(') {
                    if let Some(paren) = (close + 2..chars.len()).find(|at| chars[*at] == ')') {
                        linked.extend(&chars[start + 1..close]);
                        index = paren + 1;
                        continue;
                    }
                }
            }
        }
        linked.push(chars[index]);
        index += 1;
    }
    // Underscores at word edges and markup characters go.
    let chars: Vec<char> = linked.chars().collect();
    let mut out = String::new();
    for (index, character) in chars.iter().enumerate() {
        if *character == '_' {
            let mut start = index;
            while start > 0 && chars[start - 1] == '_' {
                start -= 1;
            }
            let mut end = index;
            while end + 1 < chars.len() && chars[end + 1] == '_' {
                end += 1;
            }
            let before = start
                .checked_sub(1)
                .map(|at| chars[at])
                .is_some_and(char::is_alphanumeric);
            let after = chars
                .get(end + 1)
                .is_some_and(|next| next.is_alphanumeric());
            if !before || !after {
                continue;
            }
        }
        if matches!(character, '`' | '*' | '~' | '[' | ']') {
            continue;
        }
        out.push(*character);
    }
    out
}

/// Pandoc's automatic identifier for a heading.
pub(crate) fn markdown_slug(title: &str) -> String {
    let text = markdown_heading_text(title).to_lowercase();
    let kept: String = text
        .chars()
        .filter(|character| {
            character.is_alphanumeric()
                || character.is_whitespace()
                || matches!(character, '_' | '.' | '-')
        })
        .collect();
    let mut joined = String::new();
    let mut in_space = false;
    for character in kept.trim().chars() {
        if character.is_whitespace() {
            if !in_space {
                joined.push('-');
            }
            in_space = true;
        } else {
            joined.push(character);
            in_space = false;
        }
    }
    let identifier: String = joined
        .trim_start_matches(|character: char| !character.is_alphabetic())
        .to_string();
    if identifier.is_empty() {
        "section".to_string()
    } else {
        identifier
    }
}

fn unique_identifier(base: &str, used: &[String]) -> String {
    if !used.iter().any(|name| name == base) {
        return base.to_string();
    }
    let mut suffix = 1;
    while used.iter().any(|name| *name == format!("{base}-{suffix}")) {
        suffix += 1;
    }
    format!("{base}-{suffix}")
}

/// `{#id .class key=value}` → `id` and its offset inside the braces.
fn attribute_identifier(attributes: &str) -> Option<(String, usize)> {
    let chars: Vec<char> = attributes.chars().collect();
    let mut index = 0;
    while index < chars.len() {
        let boundary = index == 0 || is_js_space(chars[index - 1]);
        if chars[index] == '#'
            && boundary
            && chars
                .get(index + 1)
                .is_some_and(|next| next.is_alphabetic())
        {
            let mut end = index + 2;
            while end < chars.len()
                && (chars[end].is_alphanumeric() || matches!(chars[end], '_' | '.' | ':' | '-'))
            {
                end += 1;
            }
            if end == chars.len() || is_js_space(chars[end]) {
                return Some((string_of(&chars[index + 1..end]), index + 1));
            }
        }
        index += 1;
    }
    None
}

/// Every `{...}` attribute block in the visible text (contents and the
/// offset of the contents).
fn attribute_blocks(visible: &[char]) -> Vec<(String, usize)> {
    let mut blocks = Vec::new();
    let mut index = 0;
    while index < visible.len() {
        if visible[index] == '{' {
            if let Some(close) = (index + 1..visible.len())
                .find(|at| visible[*at] == '}' || visible[*at] == '{' || visible[*at] == '\n')
            {
                if visible[close] == '}' {
                    let inner = string_of(&visible[index + 1..close]);
                    let trimmed = inner.trim();
                    let lead = inner.chars().count() - inner.trim_start().chars().count();
                    let valid = !trimmed.is_empty()
                        && trimmed
                            .split([' ', '\t'])
                            .filter(|part| !part.is_empty())
                            .all(|part| {
                                part.starts_with('#') || part.starts_with('.') || part.contains('=')
                            });
                    if valid {
                        blocks.push((trimmed.to_string(), index + 1 + lead));
                    }
                    index = close + 1;
                    continue;
                }
            }
        }
        index += 1;
    }
    blocks
}

fn url_ranges(visible: &[char]) -> Vec<(usize, usize)> {
    let mut ranges = Vec::new();
    let text = string_of(visible);
    // `](target)` link targets.
    for (index, _) in text
        .char_indices()
        .filter(|(_, character)| *character == ']')
    {
        let at = text[..index].chars().count();
        if visible.get(at + 1) == Some(&'(') {
            let from = at + 2;
            let to = (from..visible.len())
                .find(|cursor| visible[*cursor] == ')' || is_js_space(visible[*cursor]))
                .unwrap_or(visible.len());
            ranges.push((from, to));
        }
    }
    // Bare URLs.
    for scheme in ["http:", "https:", "ftp:", "mailto:"] {
        let mut search = 0;
        let lower = text.to_ascii_lowercase();
        while let Some(found) = lower[search..].find(scheme) {
            let byte = search + found;
            let from = lower[..byte].chars().count();
            let mut to = from;
            while to < visible.len() && !is_js_space(visible[to]) && !"<>()]".contains(visible[to])
            {
                to += 1;
            }
            ranges.push((from, to));
            search = byte + scheme.len();
        }
    }
    ranges
}

/// Everything the project map needs from one Markdown file.
pub(crate) fn analyze(file: &str, text: &str) -> FileFacts {
    let source = Source::new(text);
    let mut facts = FileFacts::default();
    let lines: Vec<&str> = text.split('\n').collect();
    let def = |facts: &mut FileFacts,
               kind: DefKind,
               name: String,
               from: usize,
               level: Option<u32>,
               explicit: bool| {
        facts.defs.push(Def {
            kind,
            name,
            file: file.to_string(),
            from,
            line: source.line_of(from),
            level,
            explicit,
        });
    };

    // Legacy headings (ATX and setext), outside front matter and fences.
    let mut offset = 0;
    let mut fence: Option<Fence> = None;
    let mut yaml = text.starts_with("---\n");
    let mut headings: Vec<(String, usize, u32, usize)> = Vec::new();
    for (index, line) in lines.iter().enumerate() {
        let length = line.chars().count();
        let skip = if yaml {
            if index > 0 && matches!(line.trim_end(), "---" | "...") {
                yaml = false;
            }
            true
        } else if let Some((character, run)) = fence_marker(line) {
            fence = match fence {
                None => Some(Fence {
                    character,
                    length: run,
                }),
                Some(open) if character == open.character && run >= open.length => None,
                Some(open) => Some(open),
            };
            true
        } else {
            fence.is_some()
        };
        if !skip {
            let visible = mask_code_spans(line);
            let hashes = visible
                .chars()
                .take_while(|character| *character == '#')
                .count();
            if (1..=6).contains(&hashes)
                && visible.chars().nth(hashes).is_some_and(char::is_whitespace)
            {
                let title_start = hashes
                    + visible
                        .chars()
                        .skip(hashes)
                        .take_while(|character| character.is_whitespace())
                        .count();
                let raw_title: String = line.chars().skip(title_start).collect();
                let name = strip_trailing_attributes(&strip_closing_hashes(&raw_title))
                    .trim_end()
                    .to_string();
                headings.push((name, offset + title_start, (hashes - 1) as u32, index));
            } else if let Some(next) = lines.get(index + 1) {
                let underline = next.trim();
                let setext = (underline.len() >= 2
                    && underline.chars().all(|character| character == '='))
                    || (underline.len() >= 2
                        && underline.chars().all(|character| character == '-'));
                if setext && !visible.trim().is_empty() {
                    let leading = line.chars().count() - line.trim_start().chars().count();
                    let name = strip_trailing_attributes(line.trim())
                        .trim_end()
                        .to_string();
                    let level = if underline.starts_with('=') { 0 } else { 1 };
                    headings.push((name, offset + leading, level, index));
                }
            }
        }
        offset += length + 1;
    }
    for (name, from, level, _) in &headings {
        def(
            &mut facts,
            DefKind::Section,
            name.clone(),
            *from,
            Some(*level),
            true,
        );
    }

    // The visible text: front matter, fences and code spans masked; the
    // front matter's `bibliography:` declarations noted.
    let mut visible: Vec<char> = source.chars.clone();
    let mut offset = 0;
    let mut fence: Option<Fence> = None;
    let mut yaml = text.starts_with("---\n");
    let mut bibliography_list = false;
    for (index, line) in lines.iter().enumerate() {
        let length = line.chars().count();
        let mut mask = |from: usize, count: usize| {
            for cell in visible.iter_mut().skip(from).take(count) {
                *cell = ' ';
            }
        };
        if yaml {
            if index > 0 && matches!(line.trim_end(), "---" | "...") {
                yaml = false;
                bibliography_list = false;
            } else {
                let lower = line.to_ascii_lowercase();
                if let Some(rest) = lower
                    .strip_prefix("bibliography")
                    .map(|rest| rest.trim_start())
                    .filter(|rest| rest.starts_with(':'))
                {
                    let value_start = line.len() - rest.len() + 1;
                    let value = trim_js(&line[value_start..]).to_string();
                    bibliography_list = value.is_empty();
                    let values: Vec<String> = if value.starts_with('[') && value.ends_with(']') {
                        value[1..value.len() - 1]
                            .split(',')
                            .map(str::to_string)
                            .collect()
                    } else if value.is_empty() {
                        Vec::new()
                    } else {
                        vec![value.clone()]
                    };
                    for item in values {
                        let raw = item.trim().trim_matches(['"', '\'']).to_string();
                        if raw.is_empty() {
                            continue;
                        }
                        let at = line
                            .find(raw.as_str())
                            .map_or(0, |byte| line[..byte].chars().count());
                        let target = resolve_project_path(file, &raw, None);
                        let from = offset + at;
                        facts.uses.push(Use {
                            kind: UseKind::Bibliography,
                            name: raw,
                            file: file.to_string(),
                            from,
                            line: source.line_of(from),
                            target,
                            typst_at: false,
                        });
                    }
                } else if bibliography_list {
                    let trimmed = line.trim_start();
                    if let Some(item) = trimmed.strip_prefix('-') {
                        let raw = item.trim().trim_matches(['"', '\'']).to_string();
                        if !raw.is_empty() {
                            let at = line
                                .rfind(raw.as_str())
                                .map_or(0, |byte| line[..byte].chars().count());
                            let target = resolve_project_path(file, &raw, None);
                            let from = offset + at;
                            facts.uses.push(Use {
                                kind: UseKind::Bibliography,
                                name: raw,
                                file: file.to_string(),
                                from,
                                line: source.line_of(from),
                                target,
                                typst_at: false,
                            });
                        }
                    } else if line.starts_with(|character: char| !character.is_whitespace()) {
                        bibliography_list = false;
                    }
                }
                mask(offset, length);
            }
        } else if let Some((character, run)) = fence_marker(line) {
            fence = match fence {
                None => Some(Fence {
                    character,
                    length: run,
                }),
                Some(open) if character == open.character && run >= open.length => None,
                Some(open) => Some(open),
            };
            mask(offset, length);
        } else if fence.is_some() {
            mask(offset, length);
        } else {
            let masked = mask_code_spans(line);
            for (position, character) in masked.chars().enumerate() {
                if character == ' '
                    && !line
                        .chars()
                        .nth(position)
                        .is_some_and(|original| original == ' ')
                {
                    mask(offset + position, 1);
                }
            }
        }
        offset += length + 1;
    }
    let urls = url_ranges(&visible);
    let in_url = |offset: usize| {
        urls.iter()
            .any(|(from, to)| offset >= *from && offset < *to)
    };

    // Citations: `@key` / `-@key` after a non-word character.
    let mut index = 0;
    while index < visible.len() {
        if visible[index] == '@' {
            let start = if index > 0 && visible[index - 1] == '-' {
                index - 1
            } else {
                index
            };
            let boundary = start == 0 || {
                let before = visible[start - 1];
                !(before.is_alphanumeric() || before == '_' || before == '\\')
            };
            let mut end = index + 1;
            while end < visible.len()
                && (visible[end].is_alphanumeric() || "_:.#$%&+?~/-".contains(visible[end]))
            {
                end += 1;
            }
            if boundary && end > index + 1 {
                let raw = string_of(&visible[index + 1..end]);
                let key = raw.trim_end_matches(['.', ',', ';', '!', '?']).to_string();
                let previous = index.checked_sub(1).map(|at| visible[at]);
                if !key.is_empty()
                    && !in_url(index)
                    && previous != Some('/')
                    && previous != Some('\\')
                {
                    facts.uses.push(Use {
                        kind: UseKind::Cite,
                        name: key,
                        file: file.to_string(),
                        from: index + 1,
                        line: source.line_of(index + 1),
                        target: None,
                        typst_at: false,
                    });
                }
                index = end;
                continue;
            }
        }
        index += 1;
    }

    // Explicit `{#id}` anchors.
    let mut used: Vec<String> = Vec::new();
    let mut explicit: Vec<(String, u32)> = Vec::new();
    for (attributes, from) in attribute_blocks(&visible) {
        if in_url(from) {
            continue;
        }
        if let Some((name, at)) = attribute_identifier(&attributes) {
            let position = from + at;
            explicit.push((name.clone(), source.line_of(position)));
            def(&mut facts, DefKind::Label, name, position, None, true);
        }
    }
    // Heading anchors: the explicit id, else Pandoc's automatic one.
    for (name, from, _, line_index) in &headings {
        let line = lines[*line_index];
        let explicit_id = attribute_blocks(&line.chars().collect::<Vec<_>>())
            .last()
            .and_then(|(attributes, _)| attribute_identifier(attributes))
            .map(|(name, _)| name);
        let anchor = explicit_id
            .clone()
            .unwrap_or_else(|| unique_identifier(&markdown_slug(name), &used));
        used.push(anchor.clone());
        let line_number = source.line_of(*from);
        if explicit
            .iter()
            .any(|(existing, line)| *existing == anchor && *line == line_number)
        {
            continue;
        }
        def(
            &mut facts,
            DefKind::Label,
            anchor,
            *from,
            None,
            explicit_id.is_some(),
        );
    }

    // `!include file` lines.
    for (index, line) in lines.iter().enumerate() {
        let trimmed = line.trim_start();
        let rest = trimmed
            .strip_prefix("!include")
            .filter(|rest| rest.starts_with(char::is_whitespace))
            .map(str::trim_start);
        if let Some(rest) = rest {
            let raw: String = rest
                .trim_matches(['"', '\''])
                .chars()
                .take_while(|character| !is_js_space(*character) && !"\"'}%>".contains(*character))
                .collect();
            if !raw.is_empty() {
                let line_offset: usize = lines[..index]
                    .iter()
                    .map(|line| line.chars().count() + 1)
                    .sum();
                let at = line
                    .find(raw.as_str())
                    .map_or(0, |byte| line[..byte].chars().count());
                let from = line_offset + at;
                let target = resolve_project_path(file, &raw, None);
                facts.uses.push(Use {
                    kind: UseKind::Include,
                    name: raw,
                    file: file.to_string(),
                    from,
                    line: source.line_of(from),
                    target,
                    typst_at: false,
                });
            }
        }
    }
    facts
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn headings_anchors_and_citations() {
        let facts = analyze(
            "notes.md",
            "---\ntitle: Notes\nbibliography: refs.bib\n---\n\n# Intro {#sec:intro}\n\nAs [@knuth; @lamport] show, see `@code`.\n\n## Method Two\n\n```\n@fenced\n```\nmail me@example.com\n",
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
                ("Intro".to_string(), Some(0)),
                ("Method Two".to_string(), Some(1))
            ]
        );
        let labels: Vec<&str> = facts
            .defs
            .iter()
            .filter(|def| def.kind == DefKind::Label)
            .map(|def| def.name.as_str())
            .collect();
        assert_eq!(labels, ["sec:intro", "method-two"]);
        let cites: Vec<&str> = facts
            .uses
            .iter()
            .filter(|use_| use_.kind == UseKind::Cite)
            .map(|use_| use_.name.as_str())
            .collect();
        assert_eq!(cites, ["knuth", "lamport"]);
        let bibliography = facts
            .uses
            .iter()
            .find(|use_| use_.kind == UseKind::Bibliography)
            .unwrap();
        assert_eq!(
            (bibliography.name.as_str(), bibliography.target.as_deref()),
            ("refs.bib", Some("refs.bib"))
        );
    }

    #[test]
    fn slugs_follow_pandoc() {
        assert_eq!(markdown_slug("Method Two"), "method-two");
        assert_eq!(markdown_slug("1. Intro to *X*"), "intro-to-x");
        assert_eq!(markdown_slug("!!!"), "section");
    }
}
