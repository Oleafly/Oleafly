//! LaTeX: the subset of the app's analyzer (`analyze-file.ts`,
//! `index/parse-file.ts`) that feeds the project map.
use std::collections::HashMap;

use super::text::{is_js_space, is_letter_mark, resolve_project_path, string_of, trim_js, Source};
use super::{Def, DefKind, FileFacts, PackageUse, Use, UseKind};

const SECTION_LEVELS: [(&str, u32); 7] = [
    ("part", 0),
    ("chapter", 1),
    ("section", 2),
    ("subsection", 3),
    ("subsubsection", 4),
    ("paragraph", 5),
    ("subparagraph", 6),
];

const OPAQUE_ENVIRONMENTS: [&str; 7] = [
    "verbatim",
    "verbatim*",
    "Verbatim",
    "Verbatim*",
    "lstlisting",
    "minted",
    "comment",
];

const REFERENCE_COMMANDS: [&str; 22] = [
    "crefrange",
    "Crefrange",
    "cpagerefrange",
    "vpagerefrange",
    "hyperlink",
    "ref",
    "eqref",
    "pageref",
    "autoref",
    "cref",
    "Cref",
    "cpageref",
    "vref",
    "Vref",
    "labelcref",
    "nameref",
    "namecref",
    "fref",
    "sref",
    "labelref",
    "hyperref",
    "subref",
];

const CITATION_COMMANDS: [&str; 32] = [
    "cite",
    "cites",
    "citep",
    "citet",
    "citealp",
    "citealt",
    "citeauthor",
    "citeauthor*",
    "citeyear",
    "citeyearpar",
    "parencite",
    "parencites",
    "textcite",
    "textcites",
    "autocite",
    "autocites",
    "footcite",
    "footcites",
    "smartcite",
    "smartcites",
    "supercite",
    "fullcite",
    "notecite",
    "nocite",
    "volcite",
    "volcites",
    "pvolcite",
    "pvolcites",
    "tvolcite",
    "tvolcites",
    "fvolcite",
    "fvolcites",
];

const IMPORT_COMMANDS: [&str; 6] = [
    "import",
    "subimport",
    "inputfrom",
    "subinputfrom",
    "includefrom",
    "subincludefrom",
];

/// `maskComments` from the legacy parser: per line, an unescaped `%` blanks
/// the rest of the line.
fn mask_comments_by_line(chars: &[char]) -> Vec<char> {
    let mut out = chars.to_vec();
    let mut line_start = 0;
    let mut index = 0;
    while index <= out.len() {
        if index == out.len() || out[index] == '\n' {
            let mut cursor = line_start;
            while cursor < index {
                if out[cursor] == '%' {
                    let mut slashes = 0;
                    let mut back = cursor;
                    while back > line_start && out[back - 1] == '\\' {
                        slashes += 1;
                        back -= 1;
                    }
                    if slashes % 2 == 0 {
                        for character in out.iter_mut().take(index).skip(cursor) {
                            *character = ' ';
                        }
                        break;
                    }
                }
                cursor += 1;
            }
            line_start = index + 1;
        }
        index += 1;
    }
    out
}

fn is_command_character(character: Option<&char>) -> bool {
    character.is_some_and(|character| is_letter_mark(*character) || *character == '@')
}

fn simple_braced_value(chars: &[char], at: usize) -> Option<(String, usize)> {
    let mut cursor = at;
    while chars
        .get(cursor)
        .is_some_and(|character| *character == ' ' || *character == '\t')
    {
        cursor += 1;
    }
    if chars.get(cursor) != Some(&'{') {
        return None;
    }
    let close = (cursor + 1..chars.len().min(cursor + 128)).find(|index| chars[*index] == '}')?;
    Some((string_of(&chars[cursor + 1..close]), close + 1))
}

/// Blanks `from..to`, keeping line breaks.
fn blank_span(chars: &mut [char], from: usize, to: usize) {
    for character in chars.iter_mut().take(to).skip(from) {
        if *character != '\n' {
            *character = ' ';
        }
    }
}

/// The end of a `\verb` span whose command name ends at `command_end`, or
/// `None` when no delimiter follows.
fn verb_span_end(chars: &[char], command_end: usize) -> Option<usize> {
    let mut delimiter_at = command_end;
    if chars.get(delimiter_at) == Some(&'*') {
        delimiter_at += 1;
    }
    let &delimiter = chars.get(delimiter_at)?;
    if delimiter.is_alphabetic() || is_js_space(delimiter) {
        return None;
    }
    Some(
        (delimiter_at + 1..chars.len())
            .find(|index| chars[*index] == delimiter || chars[*index] == '\n')
            .map_or(chars.len(), |index| index + 1),
    )
}

/// The end (exclusive) of the `open`..`close` group at `at`, escapes
/// skipped, or `None` when it doesn't close.
fn balanced_group_end(chars: &[char], at: usize, open: char, close: char) -> Option<usize> {
    if chars.get(at) != Some(&open) {
        return None;
    }
    let mut depth = 0usize;
    let mut cursor = at;
    while cursor < chars.len() {
        let character = chars[cursor];
        if character == '\\' {
            cursor += 2;
            continue;
        }
        if character == open {
            depth += 1;
        } else if character == close {
            depth -= 1;
            if depth == 0 {
                return Some(cursor + 1);
            }
        }
        cursor += 1;
    }
    None
}

fn skip_inline_spaces(chars: &[char], mut at: usize) -> usize {
    while chars
        .get(at)
        .is_some_and(|character| *character == ' ' || *character == '\t')
    {
        at += 1;
    }
    at
}

/// The end of a `\lstinline` or `\mintinline` span whose command name ends
/// at `command_end` (`latexInlineVerbatimSpan`): options, the language for
/// `\mintinline`, then a body in braces or between two delimiters. `None`
/// when no body follows.
fn listing_span_end(chars: &[char], command_end: usize, minted: bool) -> Option<usize> {
    let line_end = |from: usize| {
        (from..chars.len())
            .find(|index| chars[*index] == '\n')
            .unwrap_or(chars.len())
    };
    let mut cursor = command_end;
    if chars.get(cursor) == Some(&'*') {
        cursor += 1;
    }
    cursor = skip_inline_spaces(chars, cursor);
    if chars.get(cursor) == Some(&'[') {
        match balanced_group_end(chars, cursor, '[', ']') {
            Some(end) => cursor = skip_inline_spaces(chars, end),
            None => return Some(line_end(cursor + 1)),
        }
    }
    if minted {
        cursor = skip_inline_spaces(chars, balanced_group_end(chars, cursor, '{', '}')?);
    }
    if chars.get(cursor) == Some(&'{') {
        return Some(
            balanced_group_end(chars, cursor, '{', '}').unwrap_or_else(|| line_end(cursor + 1)),
        );
    }
    let &delimiter = chars.get(cursor)?;
    if is_js_space(delimiter) {
        return None;
    }
    let end = line_end(cursor + 1);
    Some(
        (cursor + 1..end)
            .find(|index| chars[*index] == delimiter)
            .map_or(end, |index| index + 1),
    )
}

/// The end of the opaque environment a `\begin` opens (its name starts at
/// `command_end`), or `None` when the environment is an ordinary one.
fn opaque_environment_end(chars: &[char], command_end: usize) -> Option<usize> {
    let (environment, after) = simple_braced_value(chars, command_end)?;
    if !OPAQUE_ENVIRONMENTS.contains(&environment.as_str()) {
        return None;
    }
    let closing: Vec<char> = format!("\\end{{{environment}}}").chars().collect();
    Some(
        (after..chars.len())
            .find(|index| chars[*index..].starts_with(&closing))
            .map_or(chars.len(), |index| index + closing.len()),
    )
}

/// Comments, opaque environments (`verbatim`, `lstlisting`, ...) and
/// `\verb` spans, blanked (line breaks kept).
pub(crate) fn mask_ignored(chars: &[char]) -> Vec<char> {
    let mut out = chars.to_vec();
    let mut cursor = 0;
    while cursor < chars.len() {
        let character = chars[cursor];
        if character == '%' {
            let end = (cursor..chars.len())
                .find(|index| chars[*index] == '\n')
                .unwrap_or(chars.len());
            blank_span(&mut out, cursor, end);
            cursor = end;
            continue;
        }
        if character != '\\' {
            cursor += 1;
            continue;
        }
        let mut command_end = cursor + 1;
        while is_command_character(chars.get(command_end)) {
            command_end += 1;
        }
        let name = string_of(&chars[cursor + 1..command_end]);
        let inline_end = match name.as_str() {
            "verb" => verb_span_end(chars, command_end),
            "lstinline" => listing_span_end(chars, command_end, false),
            "mintinline" => listing_span_end(chars, command_end, true),
            _ => None,
        };
        if let Some(end) = inline_end {
            blank_span(&mut out, cursor, end);
            cursor = end.max(cursor + 1);
            continue;
        }
        if name == "begin" {
            if let Some(end) = opaque_environment_end(chars, command_end) {
                blank_span(&mut out, cursor, end);
                cursor = end;
                continue;
            }
        }
        cursor = if command_end > cursor + 1 {
            command_end
        } else {
            (cursor + 2).min(chars.len())
        };
    }
    out
}

/// Matching `]`/`}` (exclusive end) for every `[`/`{`, escapes skipped.
fn group_index(chars: &[char]) -> HashMap<usize, usize> {
    let mut closing = HashMap::new();
    let mut square = Vec::new();
    let mut brace = Vec::new();
    let mut cursor = 0;
    while cursor < chars.len() {
        match chars[cursor] {
            '\\' => cursor += 1,
            '[' => square.push(cursor),
            '{' => brace.push(cursor),
            ']' => {
                if let Some(open) = square.pop() {
                    closing.insert(open, cursor + 1);
                }
            }
            '}' => {
                if let Some(open) = brace.pop() {
                    closing.insert(open, cursor + 1);
                }
            }
            _ => {}
        }
        cursor += 1;
    }
    closing
}

#[derive(Clone, Copy, Debug)]
struct Group {
    open: char,
    content_from: usize,
    content_to: usize,
    complete: bool,
}

/// The `[...]`/`{...}` groups following a command.
fn command_groups(masked: &[char], offset: usize, closing: &HashMap<usize, usize>) -> Vec<Group> {
    let mut groups = Vec::new();
    let mut cursor = offset;
    loop {
        while cursor < masked.len() && is_js_space(masked[cursor]) {
            cursor += 1;
        }
        let Some(&open) = masked.get(cursor) else {
            break;
        };
        if open != '[' && open != '{' {
            break;
        }
        let to = closing.get(&cursor).copied();
        groups.push(Group {
            open,
            content_from: cursor + 1,
            content_to: to.map_or(cursor + 1, |to| to - 1),
            complete: to.is_some(),
        });
        match to {
            Some(to) => cursor = to,
            None => break,
        }
    }
    groups
}

/// Adds the trimmed text collected in `logical` to `result` as one token
/// (nothing for a blank one or `*`), and empties `logical`.
fn flush_token(logical: &mut Vec<(char, usize)>, result: &mut Vec<(String, usize)>) {
    let start = logical
        .iter()
        .position(|(character, _)| !is_js_space(*character));
    let end = logical
        .iter()
        .rposition(|(character, _)| !is_js_space(*character));
    if let (Some(start), Some(end)) = (start, end) {
        let name: String = logical[start..=end]
            .iter()
            .map(|(character, _)| character)
            .collect();
        if !name.is_empty() && name != "*" {
            result.push((name, logical[start].1));
        }
    }
    logical.clear();
}

/// Where scanning resumes after the `%` comment at `cursor` in `group`, or
/// `None` when the `%` is escaped (an odd run of backslashes before it).
fn comment_end(source: &[char], group: &Group, cursor: usize) -> Option<usize> {
    let mut slashes = 0;
    let mut back = cursor;
    while back > group.content_from && source[back - 1] == '\\' {
        slashes += 1;
        back -= 1;
    }
    if slashes % 2 != 0 {
        return None;
    }
    let mut next = cursor + 1;
    while next < group.content_to && source[next] != '\n' && source[next] != '\r' {
        next += 1;
    }
    Some(
        if next < group.content_to && source[next] == '\r' && source.get(next + 1) == Some(&'\n') {
            next + 2
        } else if next < group.content_to {
            next + 1
        } else {
            next
        },
    )
}

/// `latexLogicalGroupTokens`: the group's text with `%` comments removed,
/// split on `,` and `;` when asked, each piece trimmed.
fn logical_tokens(source: &[char], group: &Group, split: bool) -> Vec<(String, usize)> {
    if !group.complete {
        return Vec::new();
    }
    let mut result = Vec::new();
    let mut logical: Vec<(char, usize)> = Vec::new();
    let mut cursor = group.content_from;
    while cursor < group.content_to {
        let character = source[cursor];
        if character == '%' {
            if let Some(next) = comment_end(source, group, cursor) {
                cursor = next;
                continue;
            }
        }
        if split && (character == ',' || character == ';') {
            flush_token(&mut logical, &mut result);
            cursor += 1;
            continue;
        }
        logical.push((character, cursor));
        cursor += 1;
    }
    flush_token(&mut logical, &mut result);
    result
}

/// A `\name` command at `at`: its name and where it ends (letters, marks and
/// `@`), or `None` when `at` isn't a backslash.
fn command_at(chars: &[char], at: usize) -> Option<(String, usize)> {
    if chars.get(at) != Some(&'\\') {
        return None;
    }
    let mut end = at + 1;
    while is_command_character(chars.get(end)) {
        end += 1;
    }
    (end > at + 1).then(|| (string_of(&chars[at + 1..end]), end))
}

/// Every `\command` (name, start, end after an optional `*`).
fn commands(chars: &[char]) -> Vec<(String, usize, usize)> {
    let mut found = Vec::new();
    let mut cursor = 0;
    while cursor < chars.len() {
        if chars[cursor] == '\\' {
            if let Some((name, end)) = command_at(chars, cursor) {
                let after = if chars.get(end) == Some(&'*') {
                    end + 1
                } else {
                    end
                };
                found.push((name, cursor, after));
                cursor = end;
                continue;
            }
            cursor += 2;
            continue;
        }
        cursor += 1;
    }
    found
}

fn match_brace(chars: &[char], open: usize) -> Option<usize> {
    let mut depth = 0i32;
    let mut index = open;
    while index < chars.len() {
        match chars[index] {
            '\\' => index += 1,
            '{' => depth += 1,
            '}' => {
                depth -= 1;
                if depth == 0 {
                    return Some(index);
                }
            }
            _ => {}
        }
        index += 1;
    }
    None
}

fn skip_spaces(chars: &[char], mut at: usize) -> usize {
    while at < chars.len() && is_js_space(chars[at]) {
        at += 1;
    }
    at
}

/// The bodies of macro definitions, where a `\section` is not a section.
fn definition_bodies(chars: &[char]) -> Vec<(usize, usize)> {
    let mut spans = Vec::new();
    for (name, _, after) in commands(chars) {
        let defines = matches!(
            name.as_str(),
            "newcommand"
                | "renewcommand"
                | "providecommand"
                | "DeclareRobustCommand"
                | "def"
                | "gdef"
                | "edef"
                | "xdef"
        );
        if !defines {
            continue;
        }
        let mut cursor = skip_spaces(chars, after);
        // The defined name: `\name` or `{\name}`.
        if chars.get(cursor) == Some(&'{') {
            match match_brace(chars, cursor) {
                Some(close) => cursor = close + 1,
                None => continue,
            }
        } else if let Some((_, end)) = command_at(chars, cursor) {
            cursor = end;
        } else {
            continue;
        }
        // Arguments (`[2]`, `[default]`, `#1#2`).
        loop {
            cursor = skip_spaces(chars, cursor);
            match chars.get(cursor) {
                Some('[') => match (cursor..chars.len()).find(|index| chars[*index] == ']') {
                    Some(close) => cursor = close + 1,
                    None => break,
                },
                Some('#') => cursor += 2,
                _ => break,
            }
        }
        if chars.get(cursor) == Some(&'{') {
            if let Some(close) = match_brace(chars, cursor) {
                spans.push((cursor, close + 1));
            }
        }
    }
    spans
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
}

/// `\section{...}` and friends, from the comment-masked text.
fn sections(facts: &mut Facts<'_>, legacy: &[char]) {
    let bodies = definition_bodies(legacy);
    let mut cursor = 0;
    while cursor < legacy.len() {
        if legacy[cursor] != '\\' {
            cursor += 1;
            continue;
        }
        let Some((name, end)) = command_at(legacy, cursor) else {
            cursor += 2;
            continue;
        };
        let Some(level) = SECTION_LEVELS
            .iter()
            .find(|(section, _)| *section == name)
            .map(|(_, level)| *level)
        else {
            cursor = end;
            continue;
        };
        let mut open = end;
        if legacy.get(open) == Some(&'*') {
            open += 1;
        }
        open = skip_spaces(legacy, open);
        if legacy.get(open) != Some(&'{')
            || bodies
                .iter()
                .any(|(from, to)| cursor >= *from && cursor < *to)
        {
            cursor = end;
            continue;
        }
        let Some(close) = match_brace(legacy, open) else {
            cursor = end;
            continue;
        };
        let title = trim_js(&string_of(&legacy[open + 1..close])).to_string();
        facts.def(DefKind::Section, title, open + 1, Some(level));
        cursor = close + 1;
    }
}

/// `{...}` contents right after a command (spaces allowed), for the legacy
/// regexes `\cmd\s*\{([^}]*)\}`.
fn simple_group_after(chars: &[char], at: usize) -> Option<(usize, usize)> {
    let open = skip_spaces(chars, at);
    if chars.get(open) != Some(&'{') {
        return None;
    }
    let close = (open + 1..chars.len()).find(|index| chars[*index] == '}')?;
    Some((open + 1, close))
}

/// `\newacronym`, `\newglossaryentry` (labels, as the app files them) and
/// `\bibitem` (citation keys), from the comment-masked text.
fn legacy_brace_definitions(facts: &mut Facts<'_>, legacy: &[char]) {
    for (name, start, _) in commands(legacy) {
        let kind = match name.as_str() {
            "newglossaryentry" | "newacronym" => DefKind::Label,
            "bibitem" => DefKind::Bibentry,
            _ => continue,
        };
        let end = start + 1 + name.chars().count();
        if legacy.get(end) == Some(&'*') {
            // The legacy patterns take no star for these.
            continue;
        }
        let mut cursor = skip_spaces(legacy, end);
        if name != "newglossaryentry" && legacy.get(cursor) == Some(&'[') {
            match (cursor..legacy.len()).find(|index| legacy[*index] == ']') {
                Some(close) => cursor = skip_spaces(legacy, close + 1),
                None => continue,
            }
        }
        let Some((from, to)) = simple_group_after(legacy, cursor) else {
            continue;
        };
        let raw = string_of(&legacy[from..to]);
        facts.def(kind, trim_js(&raw).to_string(), from, None);
        if kind == DefKind::Label {
            // A glossary entry, filed as a label by the app: never a
            // cross-reference target, so never an "unused label".
            if let Some(def) = facts.facts.defs.last_mut() {
                def.explicit = false;
            }
        }
    }
}

/// `\input` and `\include` (the legacy parser's edges): include uses with
/// the target relative to the referring file.
fn legacy_inputs(facts: &mut Facts<'_>, legacy: &[char], raw_source: &[char]) {
    for (name, start, _) in commands(legacy) {
        if name != "input" && name != "include" {
            continue;
        }
        let end = start + 1 + name.chars().count();
        let Some((from, to)) = simple_group_after(legacy, end) else {
            continue;
        };
        let raw = trim_js(&string_of(&legacy[from..to])).to_string();
        let whole = string_of(&raw_source[start..(to + 1).min(raw_source.len())]);
        let kind = if whole.contains("import") {
            UseKind::Import
        } else {
            UseKind::Include
        };
        let target = resolve_project_path(facts.file, &raw, None);
        facts.use_(kind, raw, from, target);
    }
}

fn add_macro_definitions(facts: &mut Facts<'_>, masked: &[char]) {
    for (name, _, after) in commands(masked) {
        let defined = match name.as_str() {
            "newcommand"
            | "renewcommand"
            | "providecommand"
            | "DeclareRobustCommand"
            | "NewDocumentCommand"
            | "RenewDocumentCommand"
            | "ProvideDocumentCommand"
            | "DeclareDocumentCommand" => command_definition(masked, &name, after),
            "def" | "gdef" | "edef" | "xdef" => primitive_definition(masked, after),
            "DeclareMathOperator" => math_operator_definition(masked, after),
            _ => None,
        };
        if let Some((macro_name, from)) = defined {
            facts.def(DefKind::Macro, macro_name, from, None);
        }
    }
}

/// `\newcommand{\name}...` and its relatives (`name` is the defining
/// command, which ends at `after`): the macro's name and where it starts.
/// `None` when the definition is incomplete.
fn command_definition(masked: &[char], name: &str, after: usize) -> Option<(String, usize)> {
    let mut cursor = skip_spaces(masked, after);
    let braced = masked.get(cursor) == Some(&'{');
    if braced {
        cursor = skip_spaces(masked, cursor + 1);
    }
    let (macro_name, end) = command_at(masked, cursor)?;
    let mut next = end;
    if braced {
        next = skip_spaces(masked, next);
        if masked.get(next) != Some(&'}') {
            return None;
        }
        next += 1;
    }
    let has_body = if name.ends_with("DocumentCommand") {
        has_xparse_body(masked, next)
    } else {
        has_classic_body(masked, next)
    };
    has_body.then_some((macro_name, cursor + 1))
}

/// `{arg spec}{body}`
fn has_xparse_body(masked: &[char], at: usize) -> bool {
    skip_group(masked, at).is_some_and(|spec_close| skip_group(masked, spec_close).is_some())
}

/// `[n][default]{body}`
fn has_classic_body(masked: &[char], at: usize) -> bool {
    let mut cursor = skip_spaces(masked, at);
    let mut optional = 0;
    while masked.get(cursor) == Some(&'[') && optional < 2 {
        match (cursor..masked.len()).find(|index| masked[*index] == ']') {
            Some(close) => cursor = skip_spaces(masked, close + 1),
            None => break,
        }
        optional += 1;
    }
    masked.get(cursor) == Some(&'{')
}

/// `\def\name#1#2{...}` and its relatives: the macro's name and where it
/// starts. `None` when the definition is incomplete.
fn primitive_definition(masked: &[char], after: usize) -> Option<(String, usize)> {
    let cursor = skip_spaces(masked, after);
    if masked.get(cursor) != Some(&'\\') {
        return None;
    }
    let (macro_name, mut next) = match command_at(masked, cursor) {
        Some(found) => found,
        None => {
            let symbol = masked.get(cursor + 1)?;
            (symbol.to_string(), cursor + 2)
        }
    };
    loop {
        let spaced = skip_spaces(masked, next);
        if masked.get(spaced) == Some(&'#')
            && masked
                .get(spaced + 1)
                .is_some_and(|digit| ('1'..='9').contains(digit))
        {
            next = spaced + 2;
        } else {
            break;
        }
    }
    let open = skip_spaces(masked, next);
    let complete = masked.get(open) == Some(&'{') && match_brace(masked, open).is_some();
    complete.then_some((macro_name, cursor + 1))
}

/// `\DeclareMathOperator{\name}{...}`: the operator's name and where it
/// starts. `None` when the definition is incomplete.
fn math_operator_definition(masked: &[char], after: usize) -> Option<(String, usize)> {
    let cursor = skip_spaces(masked, after);
    if masked.get(cursor) != Some(&'{') {
        return None;
    }
    let inner = skip_spaces(masked, cursor + 1);
    let (operator, end) = command_at(masked, inner)?;
    let close = skip_spaces(masked, end);
    if masked.get(close) != Some(&'}') {
        return None;
    }
    let has_body = masked.get(skip_spaces(masked, close + 1)) == Some(&'{');
    has_body.then_some((operator, inner + 1))
}

/// The end (exclusive) of a `{...}` group starting after spaces at `at`.
fn skip_group(chars: &[char], at: usize) -> Option<usize> {
    let open = skip_spaces(chars, at);
    if chars.get(open) != Some(&'{') {
        return None;
    }
    match_brace(chars, open).map(|close| close + 1)
}

fn citation_key_groups(command: &str, braced: Vec<Group>) -> Vec<Group> {
    let all = command.ends_with("cites");
    if command.contains("volcite") {
        return if all {
            braced
                .into_iter()
                .enumerate()
                .filter(|(index, _)| index % 2 == 1)
                .map(|(_, group)| group)
                .collect()
        } else {
            braced.into_iter().last().into_iter().collect()
        };
    }
    if all {
        braced
    } else {
        braced.into_iter().take(1).collect()
    }
}

fn key_uses(
    facts: &mut Facts<'_>,
    source: &[char],
    masked: &[char],
    closing: &HashMap<usize, usize>,
) {
    for (name, _, after) in commands(masked) {
        if name == "label" || name == "hypertarget" {
            label_defs(facts, source, &command_groups(masked, after, closing));
        } else if name == "hyperref" {
            hyperref_uses(facts, source, &command_groups(masked, after, closing));
        } else if REFERENCE_COMMANDS.contains(&name.as_str()) {
            let groups = command_groups(masked, after, closing);
            reference_uses(facts, source, &name, &groups);
        } else {
            let lower = name.to_lowercase();
            if CITATION_COMMANDS.contains(&lower.as_str()) {
                let groups = command_groups(masked, after, closing);
                citation_uses(facts, source, &lower, groups);
            }
        }
    }
}

/// `\label{...}` and `\hypertarget{...}`: the first braced group names a
/// label.
fn label_defs(facts: &mut Facts<'_>, source: &[char], groups: &[Group]) {
    if let Some(group) = groups.iter().find(|group| group.open == '{') {
        for (token, from) in logical_tokens(source, group, false) {
            facts.def(DefKind::Label, token, from, None);
        }
    }
}

/// `\hyperref[...]{...}`: the optional group holds the reference.
fn hyperref_uses(facts: &mut Facts<'_>, source: &[char], groups: &[Group]) {
    if let Some(group) = groups.iter().find(|group| group.open == '[') {
        for (token, from) in logical_tokens(source, group, false) {
            facts.use_(UseKind::Ref, token, from, None);
        }
    }
}

/// `\ref` and its relatives: the first braced group, or two for a range.
fn reference_uses(facts: &mut Facts<'_>, source: &[char], name: &str, groups: &[Group]) {
    let take = if name.to_ascii_lowercase().ends_with("range") {
        2
    } else {
        1
    };
    for group in groups.iter().filter(|group| group.open == '{').take(take) {
        for (token, from) in logical_tokens(source, group, true) {
            facts.use_(UseKind::Ref, token, from, None);
        }
    }
}

/// `\cite` and its relatives (`lower` is the lowercased name): the braced
/// groups that hold keys depend on the command.
fn citation_uses(facts: &mut Facts<'_>, source: &[char], lower: &str, groups: Vec<Group>) {
    let braced: Vec<Group> = groups
        .into_iter()
        .filter(|group| group.open == '{')
        .collect();
    if braced.is_empty() {
        return;
    }
    // `\nocite{*}` cites every entry of the bibliography.
    if lower == "nocite"
        && braced.iter().any(|group| {
            group.complete
                && string_of(&source[group.content_from..group.content_to])
                    .split(',')
                    .any(|key| trim_js(key) == "*")
        })
    {
        facts.facts.cites_all = true;
    }
    for group in citation_key_groups(lower, braced) {
        for (token, from) in logical_tokens(source, &group, true) {
            facts.use_(UseKind::Cite, token, from, None);
        }
    }
}

fn edge_uses(
    facts: &mut Facts<'_>,
    source: &[char],
    masked: &[char],
    closing: &HashMap<usize, usize>,
) {
    for (name, start, after) in commands(masked) {
        match name.as_str() {
            "subfile" | "InputIfFileExists" => {
                include_use(facts, masked, start + 1 + name.chars().count());
            }
            _ if IMPORT_COMMANDS
                .iter()
                .any(|command| command.eq_ignore_ascii_case(&name)) =>
            {
                import_use(facts, masked, after);
            }
            // `\graphicspath{{figures/}{img/}}`: folders figures are also
            // looked for in.
            "graphicspath" | "svgpath" => graphics_search_paths(facts, masked, after, closing),
            "includegraphics" | "includesvg" => {
                graphic_uses(facts, source, masked, after, closing);
            }
            "bibliography" | "addbibresource" | "addglobalbib" | "addsectionbib" => {
                bibliography_uses(facts, source, masked, &name, after, closing);
            }
            "usepackage" | "RequirePackage" => {
                package_uses(facts, source, masked, after, closing);
            }
            _ => {}
        }
    }
}

/// The first `{...}` group among the arguments that follow a command.
fn first_braced_group(
    masked: &[char],
    after: usize,
    closing: &HashMap<usize, usize>,
) -> Option<Group> {
    command_groups(masked, after, closing)
        .into_iter()
        .find(|group| group.open == '{')
}

/// `\subfile{path}` and `\InputIfFileExists{path}`: the path starts at
/// `from`, just past the command name.
fn include_use(facts: &mut Facts<'_>, masked: &[char], from: usize) {
    let Some((group_from, group_to)) = simple_group_after(masked, from) else {
        return;
    };
    let raw = trim_js(&string_of(&masked[group_from..group_to])).to_string();
    let target = resolve_project_path(facts.file, &raw, None);
    facts.use_(UseKind::Include, raw, group_from, target);
}

/// `\import{dir}{file}` and its relatives: the file is joined to its folder.
fn import_use(facts: &mut Facts<'_>, masked: &[char], after: usize) {
    let Some((dir_from, dir_to)) = simple_group_after(masked, after) else {
        return;
    };
    let Some((file_from, file_to)) = simple_group_after(masked, dir_to + 1) else {
        return;
    };
    let directory = trim_js(&string_of(&masked[dir_from..dir_to]))
        .trim_end_matches('/')
        .to_string();
    let raw = format!(
        "{directory}/{}",
        trim_js(&string_of(&masked[file_from..file_to]))
    );
    let target = resolve_project_path(facts.file, &raw, None);
    facts.use_(UseKind::Import, raw, file_from, target);
}

/// `\graphicspath{{figures/}{img/}}`: each complete inner group names a
/// folder that figures are also looked for in.
fn graphics_search_paths(
    facts: &mut Facts<'_>,
    masked: &[char],
    after: usize,
    closing: &HashMap<usize, usize>,
) {
    let Some(outer) = first_braced_group(masked, after, closing) else {
        return;
    };
    let inner = command_groups(masked, outer.content_from, closing);
    for group in inner
        .iter()
        .filter(|group| group.open == '{' && group.complete)
    {
        let folder =
            trim_js(&string_of(&masked[group.content_from..group.content_to])).replace('"', "");
        if !folder.is_empty() && !facts.facts.search_paths.contains(&folder) {
            facts.facts.search_paths.push(folder);
        }
    }
}

/// `\includegraphics{a,b}` and `\includesvg{a}`: every file named is an asset.
fn graphic_uses(
    facts: &mut Facts<'_>,
    source: &[char],
    masked: &[char],
    after: usize,
    closing: &HashMap<usize, usize>,
) {
    let Some(group) = first_braced_group(masked, after, closing) else {
        return;
    };
    for (token, from) in logical_tokens(source, &group, false) {
        let target = resolve_project_path(facts.file, &token, None);
        facts.use_(UseKind::Asset, token, from, target);
    }
}

/// `\bibliography{a,b}` and the biblatex resource commands, where `name` is
/// the command and `after` the offset just past it. Only `\bibliography`
/// splits its argument on commas and defaults to the `.bib` extension.
fn bibliography_uses(
    facts: &mut Facts<'_>,
    source: &[char],
    masked: &[char],
    name: &str,
    after: usize,
    closing: &HashMap<usize, usize>,
) {
    let Some(group) = first_braced_group(masked, after, closing) else {
        return;
    };
    let split = name == "bibliography";
    for (token, from) in logical_tokens(source, &group, split) {
        let extension = (name == "bibliography").then_some(".bib");
        let target = resolve_project_path(facts.file, &token, extension);
        facts.use_(UseKind::Bibliography, token, from, target);
    }
}

/// `\usepackage{a,b}` and `\RequirePackage{a}`: every package named is
/// recorded with its line.
fn package_uses(
    facts: &mut Facts<'_>,
    source: &[char],
    masked: &[char],
    after: usize,
    closing: &HashMap<usize, usize>,
) {
    let Some(group) = first_braced_group(masked, after, closing) else {
        return;
    };
    for (token, from) in logical_tokens(source, &group, true) {
        let line = facts.source.line_of(from);
        facts.facts.packages.push(PackageUse {
            name: token,
            file: facts.file.to_string(),
            line,
        });
    }
}

/// Everything the project map needs from one LaTeX file.
pub(crate) fn analyze(file: &str, text: &str) -> FileFacts {
    let source = Source::new(text);
    let chars = source.chars.clone();
    let legacy = mask_comments_by_line(&chars);
    let masked = mask_ignored(&chars);
    let closing = group_index(&masked);
    let mut facts = Facts {
        file,
        source: &source,
        facts: FileFacts::default(),
    };
    sections(&mut facts, &legacy);
    legacy_brace_definitions(&mut facts, &legacy);
    legacy_inputs(&mut facts, &legacy, &chars);
    add_macro_definitions(&mut facts, &masked);
    key_uses(&mut facts, &chars, &masked, &closing);
    edge_uses(&mut facts, &chars, &masked, &closing);
    facts.facts
}

#[cfg(test)]
mod tests {
    use super::*;

    fn names(facts: &FileFacts, kind: DefKind) -> Vec<String> {
        facts
            .defs
            .iter()
            .filter(|def| def.kind == kind)
            .map(|def| def.name.clone())
            .collect()
    }

    fn uses(facts: &FileFacts, kind: UseKind) -> Vec<String> {
        facts
            .uses
            .iter()
            .filter(|use_| use_.kind == kind)
            .map(|use_| use_.name.clone())
            .collect()
    }

    #[test]
    fn sections_labels_and_references() {
        let facts = analyze(
            "main.tex",
            "\\section{Intro to \\texttt{x}}\\label{sec:intro}\n\\subsection*{Aside}\nSee \\ref{sec:intro}, \\cref{a,b} and \\eqref{eq}.\n",
        );
        assert_eq!(
            names(&facts, DefKind::Section),
            ["Intro to \\texttt{x}", "Aside"]
        );
        assert_eq!(
            facts
                .defs
                .iter()
                .find(|def| def.name == "Aside")
                .unwrap()
                .level,
            Some(3)
        );
        assert_eq!(names(&facts, DefKind::Label), ["sec:intro"]);
        assert_eq!(uses(&facts, UseKind::Ref), ["sec:intro", "a", "b", "eq"]);
    }

    #[test]
    fn citations_take_their_key_groups() {
        let facts = analyze(
            "main.tex",
            "\\cite{a, b}\\citep[p.~2]{c}\\textcites{d}{e}\\citeauthor*{f}\n",
        );
        assert_eq!(uses(&facts, UseKind::Cite), ["a", "b", "c", "d", "e", "f"]);
    }

    #[test]
    fn comments_and_verbatim_hide_commands() {
        let facts = analyze(
            "main.tex",
            "% \\label{hidden}\n\\begin{verbatim}\n\\cite{nope}\n\\end{verbatim}\n50\\% \\cite{yes}\n\\verb|\\cite{no}|\n",
        );
        assert!(names(&facts, DefKind::Label).is_empty());
        assert_eq!(uses(&facts, UseKind::Cite), ["yes"]);
    }

    #[test]
    fn macros_glossaries_and_inputs() {
        let facts = analyze(
            "chapters/main.tex",
            "\\newcommand{\\R}{\\mathbb{R}}\\newcommand\\N[1]{x}\\DeclareMathOperator{\\argmax}{arg\\,max}\\def\\foo#1{#1}\n\\newacronym{gpu}{GPU}{graphics}\n\\input{intro}\\include{methods.tex}\\subimport{parts/}{x}\n",
        );
        assert_eq!(names(&facts, DefKind::Macro), ["R", "N", "argmax", "foo"]);
        assert_eq!(names(&facts, DefKind::Label), ["gpu"]);
        let inputs: Vec<(String, Option<String>)> = facts
            .uses
            .iter()
            .filter(|use_| matches!(use_.kind, UseKind::Include | UseKind::Import))
            .map(|use_| (use_.name.clone(), use_.target.clone()))
            .collect();
        assert_eq!(
            inputs,
            [
                ("intro".to_string(), Some("chapters/intro".to_string())),
                (
                    "methods.tex".to_string(),
                    Some("chapters/methods.tex".to_string())
                ),
                ("parts/x".to_string(), Some("chapters/parts/x".to_string())),
            ]
        );
    }

    #[test]
    fn verb_spans_and_opaque_environments_are_blanked_but_keep_their_line_breaks() {
        let source = "a\\verb*|x y|b\n\\begin{lstlisting}\nk\n\\end{lstlisting}c\\verb x";
        let chars: Vec<char> = source.chars().collect();
        let masked: String = mask_ignored(&chars).into_iter().collect();
        assert_eq!(
            masked,
            format!(
                "a{}b\n{}\n \n{}c\\verb x",
                " ".repeat(11),
                " ".repeat(18),
                " ".repeat(16)
            )
        );
    }

    #[test]
    fn key_groups_skip_comments_but_keep_escaped_percent_signs() {
        let facts = analyze("main.tex", "\\cite{a % note\n, b\\%c}\n");
        assert_eq!(uses(&facts, UseKind::Cite), ["a", "b\\%c"]);
    }

    #[test]
    fn every_macro_definition_form_names_its_macro_once_it_has_a_body() {
        let facts = analyze(
            "main.tex",
            "\\NewDocumentCommand{\\xa}{m}{b}\\DeclareDocumentCommand\\xb{O{x}m}{c}\\NewDocumentCommand{\\xc}{m}\n\\newcommand{\\ya}[2][d]{z}\\newcommand{\\yb}[1]\n\\def\\za#1#2{y}\\def\\!{z}\\def\\zb#1\n\\DeclareMathOperator{\\op}{x}\\DeclareMathOperator{\\opx}\n",
        );
        assert_eq!(
            names(&facts, DefKind::Macro),
            ["xa", "xb", "ya", "za", "!", "op"]
        );
    }

    #[test]
    fn reference_and_citation_commands_pick_their_groups() {
        let facts = analyze(
            "main.tex",
            "\\label{l1}\\hypertarget{h1}{t}\\crefrange{a}{b}{c}\\ref{x,y}{z}\\hyperref[r1]{text}\\volcite{1}{k}\\volcites{1}{k}{2}{j}\n",
        );
        assert_eq!(names(&facts, DefKind::Label), ["l1", "h1"]);
        assert_eq!(uses(&facts, UseKind::Ref), ["a", "b", "x", "y", "r1"]);
        assert_eq!(uses(&facts, UseKind::Cite), ["k", "k", "j"]);
    }

    #[test]
    fn inline_listings_are_masked_like_verb() {
        let facts = analyze(
            "main.tex",
            "\\lstinline|\\cite{x}| \\lstinline[language=C]{a % \\cite{y}} \\mintinline{python}|\\cite{z}| \\mintinline[o]{c}{\\cite{w}}\n\\lstinline|a%b| see \\cref{alg:a}\n",
        );
        assert!(uses(&facts, UseKind::Cite).is_empty());
        assert_eq!(uses(&facts, UseKind::Ref), ["alg:a"]);
    }

    #[test]
    fn nocite_star_cites_everything_and_subref_is_a_reference() {
        let facts = analyze("main.tex", "\\nocite{*}\\subref{fig:a}\n");
        assert!(facts.cites_all);
        assert!(uses(&facts, UseKind::Cite).is_empty());
        assert_eq!(uses(&facts, UseKind::Ref), ["fig:a"]);
        assert!(!analyze("main.tex", "\\nocite{a}\n").cites_all);
    }

    #[test]
    fn graphicspath_folders_are_collected() {
        let facts = analyze(
            "main.tex",
            "\\graphicspath{{figures/}{\"img dir/\"}}\\svgpath{{svg/}}\n% \\graphicspath{{hidden/}}\n",
        );
        assert_eq!(facts.search_paths, ["figures/", "img dir/", "svg/"]);
    }

    #[test]
    fn packages_split_on_commas() {
        let facts = analyze(
            "main.tex",
            "\\usepackage[utf8]{inputenc}\n\\usepackage{graphicx,hyperref}\n",
        );
        let names: Vec<&str> = facts
            .packages
            .iter()
            .map(|package| package.name.as_str())
            .collect();
        assert_eq!(names, ["inputenc", "graphicx", "hyperref"]);
        assert_eq!(facts.packages[1].line, 2);
    }
}
