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

/// `title` without HTML tags.
fn strip_html_tags(title: &str) -> String {
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
    without_tags
}

/// The `[text](target)` link that starts at `start`: where its text closes
/// and where its target ends.
fn link_bounds(chars: &[char], start: usize) -> Option<(usize, usize)> {
    if chars[start] != '[' {
        return None;
    }
    let close = (start + 1..chars.len()).find(|at| chars[*at] == ']' || chars[*at] == '[')?;
    if chars[close] != ']' || chars.get(close + 1) != Some(&'(') {
        return None;
    }
    let paren = (close + 2..chars.len()).find(|at| chars[*at] == ')')?;
    Some((close, paren))
}

/// Links and images keep their text.
fn keep_link_text(text: &str) -> String {
    let chars: Vec<char> = text.chars().collect();
    let mut linked = String::new();
    let mut index = 0;
    while index < chars.len() {
        let start = if chars[index] == '!' && chars.get(index + 1) == Some(&'[') {
            index + 1
        } else {
            index
        };
        if let Some((close, paren)) = link_bounds(&chars, start) {
            linked.extend(&chars[start + 1..close]);
            index = paren + 1;
            continue;
        }
        linked.push(chars[index]);
        index += 1;
    }
    linked
}

/// Underscores at word edges and markup characters go.
fn strip_markup_characters(text: &str) -> String {
    let chars: Vec<char> = text.chars().collect();
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

fn markdown_heading_text(title: &str) -> String {
    strip_markup_characters(&keep_link_text(&strip_html_tags(title)))
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

/// A heading: its title, the offset of the title, its level (the first is
/// 0) and its line.
type Heading = (String, usize, u32, usize);

/// A file's facts, as the scans below add them.
struct Facts<'a> {
    file: &'a str,
    source: &'a Source,
    facts: FileFacts,
}

impl Facts<'_> {
    fn def(
        &mut self,
        kind: DefKind,
        name: String,
        from: usize,
        level: Option<u32>,
        explicit: bool,
    ) {
        let line = self.source.line_of(from);
        self.facts.defs.push(Def {
            kind,
            name,
            file: self.file.to_string(),
            from,
            line,
            level,
            explicit,
        });
    }

    fn use_(&mut self, kind: UseKind, name: String, from: usize, target: Option<String>) {
        let line = self.source.line_of(from);
        self.facts.uses.push(Use {
            kind,
            name,
            file: self.file.to_string(),
            from,
            line,
            target,
            typst_at: false,
        });
    }

    /// A `bibliography:` entry in the front matter.
    fn bibliography(&mut self, raw: String, from: usize) {
        let target = resolve_project_path(self.file, &raw, None);
        self.use_(UseKind::Bibliography, raw, from, target);
    }
}

/// The fence a fence line opens or closes: a line of the same character, at
/// least as long, closes the open one.
fn toggle_fence(fence: Option<Fence>, character: char, run: usize) -> Option<Fence> {
    match fence {
        None => Some(Fence {
            character,
            length: run,
        }),
        Some(open) if character == open.character && run >= open.length => None,
        Some(open) => Some(open),
    }
}

/// `# Title`, from the line and its code-span-masked copy.
fn atx_heading(line: &str, visible: &str, offset: usize, index: usize) -> Option<Heading> {
    let hashes = visible
        .chars()
        .take_while(|character| *character == '#')
        .count();
    if !(1..=6).contains(&hashes) || !visible.chars().nth(hashes).is_some_and(char::is_whitespace) {
        return None;
    }
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
    Some((name, offset + title_start, (hashes - 1) as u32, index))
}

/// A line underlined with `===` or `---`.
fn setext_heading(lines: &[&str], index: usize, visible: &str, offset: usize) -> Option<Heading> {
    let line = lines[index];
    let underline = lines.get(index + 1)?.trim();
    let setext = (underline.len() >= 2 && underline.chars().all(|character| character == '='))
        || (underline.len() >= 2 && underline.chars().all(|character| character == '-'));
    if !setext || visible.trim().is_empty() {
        return None;
    }
    let leading = line.chars().count() - line.trim_start().chars().count();
    let name = strip_trailing_attributes(line.trim())
        .trim_end()
        .to_string();
    let level = if underline.starts_with('=') { 0 } else { 1 };
    Some((name, offset + leading, level, index))
}

/// Legacy headings (ATX and setext), outside front matter and fences.
fn legacy_headings(text: &str, lines: &[&str]) -> Vec<Heading> {
    let mut offset = 0;
    let mut fence: Option<Fence> = None;
    let mut yaml = text.starts_with("---\n");
    let mut headings = Vec::new();
    for (index, line) in lines.iter().enumerate() {
        let length = line.chars().count();
        let skip = if yaml {
            if index > 0 && matches!(line.trim_end(), "---" | "...") {
                yaml = false;
            }
            true
        } else if let Some((character, run)) = fence_marker(line) {
            fence = toggle_fence(fence, character, run);
            true
        } else {
            fence.is_some()
        };
        if !skip {
            let visible = mask_code_spans(line);
            let heading = atx_heading(line, &visible, offset, index)
                .or_else(|| setext_heading(lines, index, &visible, offset));
            headings.extend(heading);
        }
        offset += length + 1;
    }
    headings
}

fn mask(visible: &mut [char], from: usize, count: usize) {
    for cell in visible.iter_mut().skip(from).take(count) {
        *cell = ' ';
    }
}

/// Blanks the code spans of an ordinary line that starts at `offset`.
fn mask_line_code_spans(visible: &mut [char], line: &str, offset: usize) {
    let masked = mask_code_spans(line);
    for (position, character) in masked.chars().enumerate() {
        if character == ' '
            && !line
                .chars()
                .nth(position)
                .is_some_and(|original| original == ' ')
        {
            mask(visible, offset + position, 1);
        }
    }
}

/// `bibliography: refs.bib` or `bibliography: [a.bib, b.bib]` (the line,
/// which starts at `offset`, and the declared value).
fn bibliography_declaration(facts: &mut Facts<'_>, line: &str, offset: usize, value: &str) {
    let values: Vec<String> = if value.starts_with('[') && value.ends_with(']') {
        value[1..value.len() - 1]
            .split(',')
            .map(str::to_string)
            .collect()
    } else if value.is_empty() {
        Vec::new()
    } else {
        vec![value.to_string()]
    };
    for item in values {
        let raw = item.trim().trim_matches(['"', '\'']).to_string();
        if raw.is_empty() {
            continue;
        }
        let at = line
            .find(raw.as_str())
            .map_or(0, |byte| line[..byte].chars().count());
        facts.bibliography(raw, offset + at);
    }
}

/// An item (`- refs.bib`) of a `bibliography:` list.
fn bibliography_list_item(facts: &mut Facts<'_>, line: &str, offset: usize, item: &str) {
    let raw = item.trim().trim_matches(['"', '\'']).to_string();
    if raw.is_empty() {
        return;
    }
    let at = line
        .rfind(raw.as_str())
        .map_or(0, |byte| line[..byte].chars().count());
    facts.bibliography(raw, offset + at);
}

/// Notes the `bibliography:` declarations of a front matter line.
/// `in_list` is whether a list of them is open.
fn note_front_matter_line(facts: &mut Facts<'_>, line: &str, offset: usize, in_list: &mut bool) {
    let lower = line.to_ascii_lowercase();
    if let Some(rest) = lower
        .strip_prefix("bibliography")
        .map(str::trim_start)
        .filter(|rest| rest.starts_with(':'))
    {
        let value_start = line.len() - rest.len() + 1;
        let value = trim_js(&line[value_start..]).to_string();
        *in_list = value.is_empty();
        bibliography_declaration(facts, line, offset, &value);
    } else if *in_list {
        match line.trim_start().strip_prefix('-') {
            Some(item) => bibliography_list_item(facts, line, offset, item),
            None if line.starts_with(|character: char| !character.is_whitespace()) => {
                *in_list = false;
            }
            None => {}
        }
    }
}

/// The visible text: front matter, fences and code spans masked. The front
/// matter's `bibliography:` declarations are noted on the way.
fn visible_text(facts: &mut Facts<'_>, text: &str, lines: &[&str]) -> Vec<char> {
    let mut visible: Vec<char> = facts.source.chars.clone();
    let mut offset = 0;
    let mut fence: Option<Fence> = None;
    let mut yaml = text.starts_with("---\n");
    let mut bibliography_list = false;
    for (index, line) in lines.iter().enumerate() {
        let length = line.chars().count();
        if yaml {
            if index > 0 && matches!(line.trim_end(), "---" | "...") {
                yaml = false;
                bibliography_list = false;
            } else {
                note_front_matter_line(facts, line, offset, &mut bibliography_list);
                mask(&mut visible, offset, length);
            }
        } else if let Some((character, run)) = fence_marker(line) {
            fence = toggle_fence(fence, character, run);
            mask(&mut visible, offset, length);
        } else if fence.is_some() {
            mask(&mut visible, offset, length);
        } else {
            mask_line_code_spans(&mut visible, line, offset);
        }
        offset += length + 1;
    }
    visible
}

fn in_url(urls: &[(usize, usize)], offset: usize) -> bool {
    urls.iter()
        .any(|(from, to)| offset >= *from && offset < *to)
}

/// Whether the `@` at `index` (with a `-` in front of it, when there is one)
/// follows a non-word character.
fn citation_boundary(visible: &[char], index: usize) -> bool {
    let start = if index > 0 && visible[index - 1] == '-' {
        index - 1
    } else {
        index
    };
    start == 0 || {
        let before = visible[start - 1];
        !(before.is_alphanumeric() || before == '_' || before == '\\')
    }
}

/// Where the key of the citation at `index` ends.
fn citation_key_end(visible: &[char], index: usize) -> usize {
    let mut end = index + 1;
    while end < visible.len()
        && (visible[end].is_alphanumeric() || "_:.#$%&+?~/-".contains(visible[end]))
    {
        end += 1;
    }
    end
}

/// Citations: `@key` / `-@key` after a non-word character.
fn citations(facts: &mut Facts<'_>, visible: &[char], urls: &[(usize, usize)]) {
    let mut index = 0;
    while index < visible.len() {
        if visible[index] == '@' {
            let boundary = citation_boundary(visible, index);
            let end = citation_key_end(visible, index);
            if boundary && end > index + 1 {
                let raw = string_of(&visible[index + 1..end]);
                let key = raw.trim_end_matches(['.', ',', ';', '!', '?']).to_string();
                let previous = index.checked_sub(1).map(|at| visible[at]);
                if !key.is_empty()
                    && !in_url(urls, index)
                    && previous != Some('/')
                    && previous != Some('\\')
                {
                    facts.use_(UseKind::Cite, key, index + 1, None);
                }
                index = end;
                continue;
            }
        }
        index += 1;
    }
}

/// Explicit `{#id}` anchors, with the line each is on.
fn explicit_anchors(
    facts: &mut Facts<'_>,
    visible: &[char],
    urls: &[(usize, usize)],
) -> Vec<(String, u32)> {
    let mut explicit = Vec::new();
    for (attributes, from) in attribute_blocks(visible) {
        if in_url(urls, from) {
            continue;
        }
        if let Some((name, at)) = attribute_identifier(&attributes) {
            let position = from + at;
            explicit.push((name.clone(), facts.source.line_of(position)));
            facts.def(DefKind::Label, name, position, None, true);
        }
    }
    explicit
}

/// Heading anchors: the explicit id, else Pandoc's automatic one.
fn heading_anchors(
    facts: &mut Facts<'_>,
    lines: &[&str],
    headings: &[Heading],
    explicit: &[(String, u32)],
) {
    let mut used: Vec<String> = Vec::new();
    for (name, from, _, line_index) in headings {
        let line = lines[*line_index];
        let explicit_id = attribute_blocks(&line.chars().collect::<Vec<_>>())
            .last()
            .and_then(|(attributes, _)| attribute_identifier(attributes))
            .map(|(name, _)| name);
        let anchor = explicit_id
            .clone()
            .unwrap_or_else(|| unique_identifier(&markdown_slug(name), &used));
        used.push(anchor.clone());
        let line_number = facts.source.line_of(*from);
        if explicit
            .iter()
            .any(|(existing, line)| *existing == anchor && *line == line_number)
        {
            continue;
        }
        facts.def(DefKind::Label, anchor, *from, None, explicit_id.is_some());
    }
}

/// `!include file` lines.
fn include_lines(facts: &mut Facts<'_>, lines: &[&str]) {
    for (index, line) in lines.iter().enumerate() {
        let trimmed = line.trim_start();
        let rest = trimmed
            .strip_prefix("!include")
            .filter(|rest| rest.starts_with(char::is_whitespace))
            .map(str::trim_start);
        let Some(rest) = rest else {
            continue;
        };
        let raw: String = rest
            .trim_matches(['"', '\''])
            .chars()
            .take_while(|character| !is_js_space(*character) && !"\"'}%>".contains(*character))
            .collect();
        if raw.is_empty() {
            continue;
        }
        let line_offset: usize = lines[..index]
            .iter()
            .map(|line| line.chars().count() + 1)
            .sum();
        let at = line
            .find(raw.as_str())
            .map_or(0, |byte| line[..byte].chars().count());
        let target = resolve_project_path(facts.file, &raw, None);
        facts.use_(UseKind::Include, raw, line_offset + at, target);
    }
}

/// Everything the project map needs from one Markdown file.
pub(crate) fn analyze(file: &str, text: &str) -> FileFacts {
    let source = Source::new(text);
    let lines: Vec<&str> = text.split('\n').collect();
    let mut facts = Facts {
        file,
        source: &source,
        facts: FileFacts::default(),
    };
    let headings = legacy_headings(text, &lines);
    for (name, from, level, _) in &headings {
        facts.def(DefKind::Section, name.clone(), *from, Some(*level), true);
    }
    let visible = visible_text(&mut facts, text, &lines);
    let urls = url_ranges(&visible);
    citations(&mut facts, &visible, &urls);
    let explicit = explicit_anchors(&mut facts, &visible, &urls);
    heading_anchors(&mut facts, &lines, &headings, &explicit);
    include_lines(&mut facts, &lines);
    facts.facts
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

    fn names(facts: &FileFacts, kind: DefKind) -> Vec<String> {
        facts
            .defs
            .iter()
            .filter(|def| def.kind == kind)
            .map(|def| def.name.clone())
            .collect()
    }

    fn uses(facts: &FileFacts, kind: UseKind) -> Vec<(String, Option<String>)> {
        facts
            .uses
            .iter()
            .filter(|use_| use_.kind == kind)
            .map(|use_| (use_.name.clone(), use_.target.clone()))
            .collect()
    }

    #[test]
    fn setext_headings_closing_hashes_and_explicit_ids() {
        let facts = analyze(
            "notes.md",
            "Title\n=====\n\nSub\n---\n\n## Closed ##\n\n# Attr {#custom .x}\n",
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
                ("Title".to_string(), Some(0)),
                ("Sub".to_string(), Some(1)),
                ("Closed".to_string(), Some(1)),
                ("Attr".to_string(), Some(0)),
            ]
        );
        assert_eq!(
            names(&facts, DefKind::Label),
            ["custom", "title", "sub", "closed"]
        );
    }

    #[test]
    fn front_matter_bibliography_takes_inline_lists_and_block_lists() {
        let facts = analyze(
            "notes/main.md",
            "---\nbibliography:\n  - one.bib\n  - \"two.bib\"\ntitle: t\nnote: @hidden\n---\nbody @k\n",
        );
        assert_eq!(
            uses(&facts, UseKind::Bibliography),
            [
                ("one.bib".to_string(), Some("notes/one.bib".to_string())),
                ("two.bib".to_string(), Some("notes/two.bib".to_string())),
            ]
        );
        assert_eq!(uses(&facts, UseKind::Cite), [("k".to_string(), None)]);
        let inline = analyze("main.md", "---\nbibliography: [a.bib, 'b.bib']\n---\n");
        let names: Vec<String> = uses(&inline, UseKind::Bibliography)
            .into_iter()
            .map(|(name, _)| name)
            .collect();
        assert_eq!(names, ["a.bib", "b.bib"]);
    }

    #[test]
    fn citations_skip_urls_and_includes_resolve_beside_the_file() {
        let facts = analyze(
            "notes/main.md",
            "see http://x.org/@nope and @real and a/@no and me@x.org\n!include parts/a.md\n  !include \"b.md\" tail\n",
        );
        assert_eq!(uses(&facts, UseKind::Cite), [("real".to_string(), None)]);
        assert_eq!(
            uses(&facts, UseKind::Include),
            [
                (
                    "parts/a.md".to_string(),
                    Some("notes/parts/a.md".to_string())
                ),
                ("b.md".to_string(), Some("notes/b.md".to_string())),
            ]
        );
    }

    #[test]
    fn slugs_drop_links_images_tags_and_markup() {
        assert_eq!(
            markdown_slug("A [link](u) and ![img](s) with _emph_ and snake_case"),
            "a-link-and-img-with-emph-and-snake_case"
        );
        assert_eq!(markdown_slug("<b>Bold</b> `code` ~~x~~"), "bold-code-x");
    }

    #[test]
    fn slugs_follow_pandoc() {
        assert_eq!(markdown_slug("Method Two"), "method-two");
        assert_eq!(markdown_slug("1. Intro to *X*"), "intro-to-x");
        assert_eq!(markdown_slug("!!!"), "section");
    }
}
