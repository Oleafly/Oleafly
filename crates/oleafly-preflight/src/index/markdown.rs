//! Markdown anchors and same-project links for the index.
//!
//! This is a smaller version of the app's Markdown analysis: ATX headings get
//! their explicit `{#id}` or Pandoc's automatic identifier, `{#id}` attribute
//! blocks define anchors, and `[text](#anchor)` / `[text](file#anchor)` links
//! are references. Markdown only feeds preflight through unreferenced-float
//! labels, and Markdown documents get no source rules.

use std::collections::HashSet;
use std::sync::LazyLock;

use super::{Definition, FileSymbols, Reference, SymKind};
use crate::jsre::JsRegex;
use crate::text::{is_letter, is_letter_or_number, js_trim, lines_with_offsets, utf16_len};

static FENCE: LazyLock<JsRegex> = LazyLock::new(|| JsRegex::std(r"^ {0,3}(`{3,}|~{3,})"));
static ATX_HEADING: LazyLock<JsRegex> =
    LazyLock::new(|| JsRegex::std(r"^ {0,3}#{1,6}[ \t]+(.*?)[ \t]*$"));
static HEADING_ATTRIBUTES: LazyLock<JsRegex> = LazyLock::new(|| {
    JsRegex::std(r"\{[ \t]*#([\p{L}][\p{L}\p{N}_.:-]*)[^{}]*\}[ \t]*(?:#+[ \t]*)?$")
});
static ATTRIBUTE_BLOCK: LazyLock<JsRegex> =
    LazyLock::new(|| JsRegex::std(r"\{[ \t]*#([\p{L}][\p{L}\p{N}_.:-]*)[^{}\n]*\}"));
static CLOSING_HASHES: LazyLock<JsRegex> = LazyLock::new(|| JsRegex::std(r"[ \t]+#+[ \t]*$"));
static LINK: LazyLock<JsRegex> = LazyLock::new(|| {
    JsRegex::std(r#"(!?)\[([^\]\n]*)\]\(\s*<?([^)\s>]+)>?(?:\s+["'][^"']*["'])?\s*\)"#)
});
static HTML_LINK: LazyLock<JsRegex> = LazyLock::new(|| JsRegex::std(r"!?\[([^\]\[]*)\]\([^)]*\)"));
static EXTERNAL: LazyLock<JsRegex> =
    LazyLock::new(|| JsRegex::std(r"(?i)^(?:[a-z][a-z0-9+.-]*:|//)"));

fn without_html_tags(title: &str) -> String {
    let mut out = String::new();
    let mut inside = false;
    for ch in title.chars() {
        if ch == '<' {
            inside = true;
        } else if ch == '>' && inside {
            inside = false;
        } else if !inside {
            out.push(ch);
        }
    }
    out
}

/// Pandoc's automatic identifier.
fn markdown_slug(title: &str) -> String {
    let text = without_html_tags(title);
    let text = HTML_LINK
        .captures_str(&text)
        .0
        .iter()
        .rev()
        .fold(text.clone(), |mut out, found| {
            let label = found.group(&text, 1).unwrap_or("").to_string();
            out.replace_range(found.start..found.end, &label);
            out
        });
    let chars: Vec<char> = text.chars().collect();
    let mut cleaned = String::new();
    for (index, &ch) in chars.iter().enumerate() {
        if matches!(ch, '`' | '*' | '~' | '[' | ']') {
            continue;
        }
        if ch == '_' {
            let before = index.checked_sub(1).map(|i| chars[i]);
            let after = chars.get(index + 1).copied();
            let inner =
                before.is_some_and(is_letter_or_number) && after.is_some_and(is_letter_or_number);
            if !inner {
                continue;
            }
        }
        cleaned.push(ch);
    }
    let lowered: String = cleaned
        .to_lowercase()
        .chars()
        .filter(|&ch| {
            is_letter_or_number(ch) || ch.is_whitespace() || matches!(ch, '_' | '.' | '-')
        })
        .collect();
    let dashed = js_trim(&lowered)
        .split(char::is_whitespace)
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join("-");
    let identifier: String = dashed
        .trim_start_matches(|ch: char| !is_letter(ch))
        .to_string();
    if identifier.is_empty() {
        "section".to_string()
    } else {
        identifier
    }
}

fn unique_identifier(base: String, used: &HashSet<String>) -> String {
    if !used.contains(&base) {
        return base;
    }
    let mut suffix = 1;
    while used.contains(&format!("{base}-{suffix}")) {
        suffix += 1;
    }
    format!("{base}-{suffix}")
}

fn directory_of(path: &str) -> &str {
    match path.rfind('/') {
        Some(slash) => &path[..slash],
        None => "",
    }
}

fn resolve_link(file: &str, target: &str) -> Option<String> {
    let target = js_trim(target);
    if target.is_empty()
        || target.starts_with('#')
        || target.starts_with('/')
        || EXTERNAL.is_match(target)
    {
        return None;
    }
    let relative = target.strip_prefix("./").unwrap_or(target);
    let directory = directory_of(file);
    let joined = if directory.is_empty() {
        relative.to_string()
    } else {
        format!("{directory}/{relative}")
    };
    let mut parts: Vec<&str> = Vec::new();
    for part in joined.split('/') {
        if part.is_empty() || part == "." {
            continue;
        }
        if part == ".." {
            parts.pop()?;
            continue;
        }
        parts.push(part);
    }
    (!parts.is_empty()).then(|| parts.join("/"))
}

/// The name of a heading: its explicit `{#id}`, or a slug of its title that
/// no earlier heading uses.
fn heading_name(title: &str, used: &HashSet<String>) -> String {
    let explicit = HEADING_ATTRIBUTES
        .first_str(title)
        .and_then(|found| found.group(title, 1).map(str::to_string));
    match explicit {
        Some(explicit) => explicit,
        None => {
            let without_closing = match CLOSING_HASHES.first_str(title) {
                Some(found) => &title[..found.start],
                None => title,
            };
            unique_identifier(markdown_slug(without_closing), used)
        }
    }
}

/// Opens a code fence with `marker`, or closes the open one it matches.
fn toggle_fence(fence: &mut Option<String>, marker: &str) {
    match fence {
        None => *fence = Some(marker.to_string()),
        Some(open) if marker.starts_with(open.as_str()) => *fence = None,
        Some(_) => {}
    }
}

/// Adds a definition for each heading outside code fences and returns the
/// lines outside code fences.
fn heading_definitions<'a>(text: &'a str, symbols: &mut FileSymbols) -> Vec<(usize, &'a str)> {
    let mut used = HashSet::new();
    let mut fence: Option<String> = None;
    let mut visible_lines: Vec<(usize, &str)> = Vec::new();
    for (offset, line) in lines_with_offsets(text) {
        if let Some(found) = FENCE.first_str(line) {
            toggle_fence(&mut fence, found.group(line, 1).unwrap_or(""));
            continue;
        }
        if fence.is_some() {
            continue;
        }
        visible_lines.push((offset, line));
        let Some(heading) = ATX_HEADING.first_str(line) else {
            continue;
        };
        let title = heading.group(line, 1).unwrap_or("");
        let name = heading_name(title, &used);
        used.insert(name.clone());
        symbols.defs.push(Definition {
            kind: SymKind::Label,
            name,
            from: offset,
            to: offset + utf16_len(line),
        });
    }
    visible_lines
}

/// Adds a definition for each `{#id}` attribute block in a line.
fn attribute_definitions(offset: usize, line: &str, symbols: &mut FileSymbols) {
    for found in ATTRIBUTE_BLOCK.captures_str(line).0 {
        if let (Some(name), Some((start, _))) = (found.group(line, 1), found.groups[1]) {
            symbols.defs.push(Definition {
                kind: SymKind::Label,
                name: name.to_string(),
                from: offset + utf16_len(&line[..start]),
                to: offset + utf16_len(&line[..start]) + utf16_len(name),
            });
        }
    }
}

/// Adds a reference for each link to an anchor in a line.
fn anchor_references(file: &str, offset: usize, line: &str, symbols: &mut FileSymbols) {
    for found in LINK.captures_str(line).0 {
        let target = found.group(line, 3).unwrap_or("");
        let Some(hash) = target.find('#') else {
            continue;
        };
        let anchor = &target[hash + 1..];
        if anchor.is_empty() {
            continue;
        }
        let path = &target[..hash];
        let from =
            offset + utf16_len(&line[..found.groups[3].map_or(found.start, |(start, _)| start)]);
        if path.is_empty() {
            symbols.uses.push(Reference {
                name: anchor.to_string(),
                from: from + 1,
                to: from + utf16_len(target),
                target: None,
            });
            continue;
        }
        if EXTERNAL.is_match(path) {
            continue;
        }
        symbols.uses.push(Reference {
            name: anchor.to_string(),
            from: from + utf16_len(path) + 1,
            to: from + utf16_len(target),
            target: resolve_link(file, path).map(|resolved| format!("{resolved}#{anchor}")),
        });
    }
}

pub(super) fn analyze(file: &str, text: &str) -> FileSymbols {
    let mut symbols = FileSymbols::default();
    let visible_lines = heading_definitions(text, &mut symbols);
    for (offset, line) in visible_lines {
        let headings_done = ATX_HEADING.is_match(line);
        if !headings_done {
            attribute_definitions(offset, line, &mut symbols);
        }
        anchor_references(file, offset, line, &mut symbols);
    }
    symbols
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn headings_get_pandoc_identifiers() {
        assert_eq!(
            markdown_slug("Results and *Discussion*"),
            "results-and-discussion"
        );
        assert_eq!(markdown_slug("1. Intro"), "intro");
        assert_eq!(markdown_slug("!!!"), "section");
        let symbols = analyze(
            "notes.md",
            "# Intro\n## Intro\n# Methods {#sec:methods}\n```\n# not\n```",
        );
        let names: Vec<_> = symbols.defs.iter().map(|d| d.name.as_str()).collect();
        assert_eq!(names, vec!["intro", "intro-1", "sec:methods"]);
    }

    #[test]
    fn links_to_anchors_are_references() {
        let symbols = analyze("notes.md", "See [x](#intro) and [y](paper.tex#fig:plot).");
        let uses: Vec<_> = symbols
            .uses
            .iter()
            .map(|u| (u.name.as_str(), u.target.as_deref()))
            .collect();
        assert_eq!(
            uses,
            vec![("intro", None), ("fig:plot", Some("paper.tex#fig:plot"))]
        );
    }
}
