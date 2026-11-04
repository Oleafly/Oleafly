//! Compilation units: which LaTeX files are typeset together.
//!
//! A folder can hold several documents side by side, such as `manuscript.tex`
//! next to `manuscript_v1.tex`. Their labels must not collide, and a `\ref`
//! must not reach into a document it is never compiled with. A unit is an
//! independent root (a document no other root reaches) plus everything it pulls
//! in. A file no root reaches is an orphan and keeps seeing the whole project,
//! so a fragment that is not included anywhere yet gets no false "undefined
//! reference".
//!
//! Units only exist with two or more independent roots: one document gets
//! `None`, and every caller runs the code it ran before units existed.
//!
//! This is the twin of `src/lib/project-intelligence/latex-units.ts`.
//! `tests/fixtures/latex-units.json` holds both to the same answers.

use std::cell::{OnceCell, RefCell};
use std::collections::{BTreeSet, HashMap, HashSet};
use std::rc::Rc;

use super::latex::mask_ignored;
use super::text::{dirname, has_extension, is_js_space, starts_with_at, trim_js};
use super::{engine_for, fold, Engine};
use crate::detect::tex_magic_comments;

const LATEXDIFF_BANNER: &str = "%DIF LATEXDIFF DIFFERENCE FILE";
const CONDITIONAL_BRANCH_ENDS: [&str; 3] = ["\\fi", "\\else", "\\or"];
const ARGUMENT_WINDOW: usize = 1024;
/// Below this many owners per viewer unit, testing every owner beats walking
/// one unit's owners.
const OWNER_SCAN_RATIO: usize = 8;
/// A deep chain of imports asks about folder pairs no file sits in.
const MAX_FOLDED_PATHS: usize = 1 << 18;
const MAX_STEPS: usize = 16_000_000;

const ONE_ARGUMENT_INCLUDES: [&str; 8] = [
    "input",
    "@input",
    "include",
    "subfile",
    "subfileinclude",
    "InputIfFileExists",
    "includestandalone",
    "loadglsentries",
];

/// `subfiles.sty` builds these on `\\subimport` and `\\subincludefrom`.
fn is_subfile_include(name: &str) -> bool {
    matches!(name, "subfile" | "subfileinclude")
}

/// Whether the path starts from the enclosing import path.
fn two_argument_include(name: &str) -> Option<bool> {
    match name {
        "import" | "inputfrom" | "includefrom" => Some(false),
        "subimport" | "subinputfrom" | "subincludefrom" => Some(true),
        _ => None,
    }
}

fn package_extension(name: &str) -> Option<&'static str> {
    match name {
        "usepackage" | "RequirePackage" | "RequirePackageWithOptions" => Some(".sty"),
        "documentclass" | "LoadClass" | "LoadClassWithOptions" => Some(".cls"),
        _ => None,
    }
}

fn is_latex_source(path: &str) -> bool {
    let lower = path.to_lowercase();
    [".tex", ".ltx", ".latex"]
        .iter()
        .any(|extension| lower.ends_with(extension))
}

fn string_of(chars: &[char]) -> String {
    chars.iter().collect()
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
struct IncludeKind {
    /// Starts from the enclosing import path: `\\subimport` and friends.
    local: bool,
    /// The folder of an `\\import` or `\\subfile`, which joins TeX's search path.
    folder: Option<String>,
}

fn subfile_kind(value: Option<&str>) -> IncludeKind {
    let folder = value
        .and_then(|value| value.rfind('/').map(|slash| &value[..=slash]))
        .unwrap_or("");
    IncludeKind {
        local: true,
        folder: Some(folder.to_string()),
    }
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
struct Include {
    raw: String,
    kind: IncludeKind,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
struct Facts {
    document: bool,
    subfiles_parent: Option<String>,
    magic_root: Option<String>,
    includes: Vec<Include>,
    packages: Vec<String>,
    open: bool,
    /// A path computed at compile time. A class or package keeps those to itself.
    dynamic: bool,
}

impl Facts {
    fn declared_parent(&self) -> Option<&str> {
        self.subfiles_parent
            .as_deref()
            .or(self.magic_root.as_deref())
    }
}

fn skip_blanks(text: &[char], from: usize, limit: usize) -> usize {
    let mut at = from;
    while at < limit && matches!(text[at], ' ' | '\t' | '\n' | '\r') {
        at += 1;
    }
    at
}

/// Where the argument window ends. The app counts UTF-16 units.
fn window_end(text: &[char], from: usize) -> usize {
    let mut units = 0;
    let mut at = from;
    while at < text.len() && units + text[at].len_utf16() <= ARGUMENT_WINDOW {
        units += text[at].len_utf16();
        at += 1;
    }
    at
}

fn is_escaped(text: &[char], at: usize) -> bool {
    let backslashes = text[..at]
        .iter()
        .rev()
        .take_while(|character| **character == '\\')
        .count();
    backslashes % 2 == 1
}

struct Argument {
    /// `None` when the group holds another group, so its value is unknown.
    value: Option<String>,
    end: usize,
}

fn braced_argument(text: &[char], from: usize) -> Option<Argument> {
    let limit = window_end(text, from);
    let mut at = skip_blanks(text, from, limit);
    if text.get(at) == Some(&'*') {
        at = skip_blanks(text, at + 1, limit);
    }
    while at < limit && text[at] == '[' {
        let close = (at..limit).find(|index| text[*index] == ']')?;
        at = skip_blanks(text, close + 1, limit);
    }
    if at >= limit || text[at] != '{' {
        return None;
    }
    for cursor in at + 1..limit {
        match text[cursor] {
            '{' => {
                return Some(Argument {
                    value: None,
                    end: cursor,
                })
            }
            '}' => {
                return Some(Argument {
                    value: Some(trim_js(&string_of(&text[at + 1..cursor])).to_string()),
                    end: cursor + 1,
                })
            }
            _ => {}
        }
    }
    None
}

fn bare_argument(text: &[char], from: usize) -> Option<String> {
    let limit = window_end(text, from);
    let start = skip_blanks(text, from, limit);
    let mut end = start;
    let mut quoted = false;
    while end < limit
        && (quoted || !is_js_space(text[end]) && !matches!(text[end], '}' | '\\' | '%' | '{'))
    {
        if text[end] == '"' {
            quoted = !quoted;
        }
        end += 1;
    }
    let value = string_of(&text[start..end]);
    (!quoted && end > start && value != "\"\"").then_some(value)
}

/// A command whose path is computed at compile time: `\input\chapter`, or the
/// output of `\input|"script"` under shell escape.
fn starts_with_dynamic_token(text: &[char], from: usize) -> bool {
    let at = skip_blanks(text, from, window_end(text, from));
    matches!(text.get(at), Some('\\' | '#' | '|'))
}

fn is_dynamic_target(value: &str) -> bool {
    value.contains('\\')
        || value.contains('#')
        || value
            .strip_prefix(['"', '\''])
            .unwrap_or(value)
            .starts_with('|')
}

struct DocumentClass {
    option: String,
    name: String,
}

fn class_arguments(text: &[char], from: usize) -> Option<DocumentClass> {
    let limit = window_end(text, from);
    let mut at = skip_blanks(text, from, limit);
    let mut option = String::new();
    if text.get(at) == Some(&'[') {
        let close = (at..limit).find(|index| text[*index] == ']')?;
        option = trim_js(&string_of(&text[at + 1..close])).to_string();
        at = skip_blanks(text, close + 1, limit);
    }
    if at >= limit || text[at] != '{' {
        return None;
    }
    let close = (at..limit).find(|index| text[*index] == '}')?;
    let name = trim_js(&string_of(&text[at + 1..close])).to_string();
    (!name.is_empty()).then_some(DocumentClass { option, name })
}

fn names_document(text: &[char], after: usize) -> bool {
    starts_with_at(text, skip_blanks(text, after, text.len()), "{document}")
}

fn is_command_at(text: &[char], at: usize, command: &str) -> bool {
    starts_with_at(text, at, command)
        && !text
            .get(at + command.chars().count())
            .is_some_and(char::is_ascii_alphabetic)
}

fn brace_depth(text: &[char], from: usize, to: usize, start: i64) -> i64 {
    let mut depth = start;
    let mut at = from;
    while at < to {
        match text[at] {
            '\\' => at += 1,
            '{' => depth += 1,
            '}' => depth -= 1,
            _ => {}
        }
        at += 1;
    }
    depth
}

/// TeX stops here, unless a conditional skips this branch. The scan cannot tell
/// a taken branch from a skipped one, so a close on the same line keeps it
/// reading, as does a close within the window once a conditional is open. Both
/// err towards more files.
fn ends_document(text: &[char], after: usize, in_conditional: bool) -> bool {
    if !names_document(text, after) {
        return false;
    }
    let close = skip_blanks(text, after, text.len()) + "{document}".len();
    let next = skip_blanks(text, close, text.len());
    let limit = window_end(text, next);
    let mut at = next;
    while at < limit && (in_conditional || text[at] != '\n') {
        if text[at] == '\\' {
            if CONDITIONAL_BRANCH_ENDS
                .iter()
                .any(|command| is_command_at(text, at, command))
            {
                return false;
            }
            at += 1;
        }
        at += 1;
    }
    true
}

/// `\\let\\stop\\endinput` and `\\newcommand{\\stop}\\endinput` only name the
/// command, so neither stops anything. The closing brace of an include is the
/// one brace that is known to end a statement.
fn starts_statement(text: &[char], at: usize, include_end: Option<usize>) -> bool {
    let before = text[..at]
        .iter()
        .rposition(|character| !matches!(character, ' ' | '\t'));
    match before {
        None => true,
        Some(index) => text[index] == '\n' || Some(index + 1) == include_end,
    }
}

fn ends_line(text: &[char], from: usize) -> bool {
    let next = text[from.min(text.len())..]
        .iter()
        .find(|character| !matches!(character, ' ' | '\t' | '\r'));
    matches!(next, None | Some('\n'))
}

// TeX drops every double quote from a file name, wherever it sits.
fn unquoted(value: &str) -> String {
    trim_js(value).replace('"', "")
}

fn names_aux(value: &str) -> bool {
    let lower = value.to_lowercase();
    lower
        .strip_suffix(['"', '\''])
        .unwrap_or(&lower)
        .ends_with(".aux")
}

fn add_target(facts: &mut Facts, value: Option<String>, kind: IncludeKind) {
    let Some(value) = value else {
        facts.dynamic = true;
        return;
    };
    if is_dynamic_target(&value) {
        facts.dynamic = true;
    } else if value.is_empty() {
    } else if names_aux(&value) {
        facts.open = true;
    } else {
        facts.includes.push(Include { raw: value, kind });
    }
}

fn add_packages(facts: &mut Facts, value: &str, extension: &str) {
    for name in value.split(',').map(trim_js) {
        if name.is_empty() || is_dynamic_target(name) {
            continue;
        }
        let file = format!("{name}{extension}");
        if !facts.packages.contains(&file) {
            facts.packages.push(file);
        }
    }
}

fn scan_command(
    facts: &mut Facts,
    masked: &[char],
    name: &str,
    after: usize,
    class: &mut Option<DocumentClass>,
    include_end: &mut Option<usize>,
) {
    if name == "externaldocument" {
        facts.open = true;
        return;
    }
    if (name == "documentclass" || name == "documentstyle") && class.is_none() {
        *class = class_arguments(masked, after);
        if let Some(style) = class.as_ref().filter(|_| name == "documentstyle") {
            // LaTeX 2.09 loads every option as a style file, and the style
            // itself as a class, or as a style file if there is no such class.
            // Keeping both spellings errs towards more files.
            add_packages(facts, &format!("{},{}", style.option, style.name), ".sty");
            add_packages(facts, &style.name, ".cls");
        }
    }
    if let Some(extension) = package_extension(name) {
        if let Some(value) = braced_argument(masked, after).and_then(|argument| argument.value) {
            add_packages(facts, &value, extension);
        }
        return;
    }
    if ONE_ARGUMENT_INCLUDES.contains(&name) {
        scan_one_argument_include(facts, masked, name, after, include_end);
    } else if let Some(local) = two_argument_include(name) {
        scan_two_argument_include(facts, masked, after, local, include_end);
    }
}

fn scan_one_argument_include(
    facts: &mut Facts,
    masked: &[char],
    name: &str,
    after: usize,
    include_end: &mut Option<usize>,
) {
    if let Some(argument) = braced_argument(masked, after) {
        *include_end = Some(argument.end);
        let kind = if is_subfile_include(name) {
            subfile_kind(argument.value.as_deref())
        } else {
            IncludeKind::default()
        };
        add_target(facts, argument.value, kind);
    } else if starts_with_dynamic_token(masked, after) {
        facts.dynamic = true;
    } else if name == "input" {
        if let Some(bare) = bare_argument(masked, after) {
            add_target(facts, Some(bare), IncludeKind::default());
        }
    }
}

fn scan_two_argument_include(
    facts: &mut Facts,
    masked: &[char],
    after: usize,
    local: bool,
    include_end: &mut Option<usize>,
) {
    let directory = braced_argument(masked, after);
    let target = directory
        .as_ref()
        .and_then(|directory| braced_argument(masked, directory.end));
    if let Some(target) = &target {
        *include_end = Some(target.end);
    }
    match (directory, target) {
        (Some(directory), Some(target)) => match (directory.value, target.value) {
            (Some(directory), Some(target)) => {
                let directory = unquoted(&directory);
                let folder = directory.trim_end_matches('/');
                let file = unquoted(&target);
                let joined = if folder.is_empty() {
                    file
                } else {
                    format!("{folder}/{file}")
                };
                let kind = IncludeKind {
                    local,
                    folder: Some(folder.to_string()),
                };
                add_target(facts, Some(joined), kind);
            }
            _ => facts.dynamic = true,
        },
        _ => {
            if starts_with_dynamic_token(masked, after) {
                facts.dynamic = true;
            }
        }
    }
}

/// The command at a backslash, as a name and where it ends. `\\@input` is the
/// kernel's quiet input, the classic way to read another document's .aux.
/// `\\input@path` is a macro, not a command of this kind, but `\\if@twoside` is
/// a conditional like any other.
fn command_at(masked: &[char], start: usize) -> Option<(String, usize)> {
    let at_input = starts_with_at(masked, start, "@input");
    let first = if at_input {
        start + "@input".len()
    } else {
        start
    };
    let conditional = !at_input && starts_with_at(masked, start, "if");
    let mut end = first;
    while end < masked.len()
        && (masked[end].is_ascii_alphabetic() || conditional && masked[end] == '@')
    {
        end += 1;
    }
    if end == start || masked.get(end) == Some(&'@') {
        return None;
    }
    Some((string_of(&masked[start..end]), end))
}

/// The masked text in the app's units: it blanks UTF-16 units, so a blanked
/// astral character is two spaces.
fn masked_units(chars: &[char]) -> Vec<char> {
    let masked = mask_ignored(chars);
    if chars.iter().all(|character| character.len_utf16() == 1) {
        return masked;
    }
    let mut units = Vec::with_capacity(masked.len());
    for (original, blanked) in chars.iter().zip(masked) {
        units.push(blanked);
        if blanked == ' ' && original.len_utf16() == 2 {
            units.push(' ');
        }
    }
    units
}

/// Brace depth at `from`, counted only when a stop asks.
#[derive(Default)]
struct BraceScan {
    depth: i64,
    from: usize,
}

impl BraceScan {
    fn outside(&mut self, masked: &[char], at: usize) -> bool {
        self.depth = brace_depth(masked, self.from, at, self.depth);
        self.from = at;
        self.depth <= 0
    }
}

fn file_facts(file: &str, text: &str) -> Facts {
    let chars: Vec<char> = text.chars().collect();
    let masked = masked_units(&chars);
    let mut facts = Facts {
        open: text.contains(LATEXDIFF_BANNER),
        ..Facts::default()
    };
    let mut class: Option<DocumentClass> = None;
    let mut begins_document = false;
    let mut braces = BraceScan::default();
    let mut conditionals = 0usize;
    let mut include_end = None;
    let mut cursor = 0;
    while cursor < masked.len() {
        if masked[cursor] != '\\' {
            cursor += 1;
            continue;
        }
        let backslash = cursor;
        let start = cursor + 1;
        cursor = start;
        let Some((name, end)) = command_at(&masked, start) else {
            continue;
        };
        cursor = end;
        if is_escaped(&masked, backslash) {
            continue;
        }
        if name == "fi" {
            conditionals = conditionals.saturating_sub(1);
        } else if name.starts_with("if") {
            conditionals += 1;
        }
        if name == "endinput" {
            // Inside a conditional or braces it may never run, and an `\\input`
            // later on its line takes the stop with it, so the scan keeps
            // reading, which errs towards more files.
            if conditionals == 0
                && starts_statement(&masked, backslash, include_end)
                && ends_line(&masked, end)
                && braces.outside(&masked, backslash)
            {
                break;
            }
        } else if name == "begin" {
            begins_document = begins_document || names_document(&masked, end);
        } else if name != "end" || !begins_document {
            scan_command(
                &mut facts,
                &masked,
                &name,
                end,
                &mut class,
                &mut include_end,
            );
        } else if ends_document(&masked, end, conditionals > 0)
            && braces.outside(&masked, backslash)
        {
            break;
        }
    }
    settle_document(&mut facts, file, text, class, begins_document);
    facts
}

/// A class settles what a file is. A bare `\\begin{document}` can be a mention
/// in prose, so a file that names its root keeps the fact and the walk decides.
fn settle_document(
    facts: &mut Facts,
    file: &str,
    text: &str,
    class: Option<DocumentClass>,
    begins_document: bool,
) {
    let subfiles = class.as_ref().is_some_and(|class| class.name == "subfiles");
    let latex_source = is_latex_source(file);
    facts.document = latex_source
        && match &class {
            Some(_) => !subfiles,
            None => begins_document,
        };
    facts.open |= facts.dynamic && latex_source;
    if subfiles {
        facts.subfiles_parent = Some(class.map(|class| class.option).unwrap_or_default());
    } else if !(latex_source && class.is_some()) {
        facts.magic_root = tex_magic_comments(text).root;
    }
}

/// A relative path. `rest` is empty when it names a folder above.
#[derive(Clone, Debug, Default)]
struct ParsedTarget {
    ups: usize,
    rest: String,
}

/// A URL or a drive path. `sec:intro` is a file name, so a colon alone is not.
fn is_url_or_drive(value: &str) -> bool {
    let bytes = value.as_bytes();
    if bytes.len() >= 3
        && bytes[0].is_ascii_alphabetic()
        && bytes[1] == b':'
        && matches!(bytes[2], b'/' | b'\\')
    {
        return true;
    }
    value.split_once("://").is_some_and(|(scheme, _)| {
        scheme.starts_with(|character: char| character.is_ascii_alphabetic())
            && scheme.chars().all(|character| {
                character.is_ascii_alphanumeric() || matches!(character, '+' | '.' | '-')
            })
    })
}

fn parse_path(raw: &str) -> Option<ParsedTarget> {
    let cleaned = unquoted(raw);
    let value = cleaned.strip_prefix('\'').unwrap_or(&cleaned);
    let value = value.strip_suffix('\'').unwrap_or(value);
    if value.starts_with(['#', '/'])
        || is_url_or_drive(value)
        || value
            .chars()
            .any(|character| (character as u32) <= 0x1f || character as u32 == 0x7f)
    {
        return None;
    }
    let replaced = value.replace('\\', "/");
    let mut parts: Vec<&str> = Vec::new();
    let mut ups = 0;
    for part in replaced.split('/') {
        match part {
            "" | "." => {}
            ".." => {
                if parts.pop().is_none() {
                    ups += 1;
                }
            }
            _ => parts.push(part),
        }
    }
    Some(ParsedTarget {
        ups,
        rest: parts.join("/"),
    })
}

fn parse_target(raw: &str) -> Option<ParsedTarget> {
    parse_path(raw).filter(|path| !path.rest.is_empty())
}

fn join_paths(base: &ParsedTarget, path: &ParsedTarget) -> ParsedTarget {
    let mut ups = base.ups;
    let mut rest = base.rest.as_str();
    for _ in 0..path.ups {
        if rest.is_empty() {
            ups += 1;
        } else {
            rest = &rest[..rest.rfind('/').unwrap_or(0)];
        }
    }
    let rest = match (rest.is_empty(), path.rest.is_empty()) {
        (_, true) => rest.to_string(),
        (true, false) => path.rest.clone(),
        (false, false) => format!("{rest}/{}", path.rest),
    };
    ParsedTarget { ups, rest }
}

/// `folder` as a path from `root`, both from the project root.
fn path_within(root: &str, folder: &str) -> ParsedTarget {
    let from: Vec<&str> = root.split('/').filter(|part| !part.is_empty()).collect();
    let to: Vec<&str> = folder.split('/').filter(|part| !part.is_empty()).collect();
    let shared = from
        .iter()
        .zip(&to)
        .take_while(|(left, right)| left == right)
        .count();
    ParsedTarget {
        ups: from.len() - shared,
        rest: to[shared..].join("/"),
    }
}

/// The folder `path` names from `root`. `None` above the project.
fn folder_at(root: &str, path: &ParsedTarget) -> Option<String> {
    let mut folder = root;
    for _ in 0..path.ups {
        if folder.is_empty() {
            return None;
        }
        folder = dirname(folder);
    }
    Some(match (folder.is_empty(), path.rest.is_empty()) {
        (_, true) => folder.to_string(),
        (true, false) => path.rest.clone(),
        (false, false) => format!("{folder}/{}", path.rest),
    })
}

/// kpathsea takes a name with one of these suffixes as written.
const WRITTEN_SUFFIXES: [&str; 9] = [
    ".tex", ".sty", ".cls", ".def", ".fd", ".bbl", ".clo", ".ldf", ".aux",
];

/// TeX opens name.tex, then name. The editor also lists .ltx and .latex files
/// as sources, which TeX only finds under their full name.
fn input_spellings(rest: &str) -> Vec<String> {
    let lower = rest.to_lowercase();
    if WRITTEN_SUFFIXES
        .iter()
        .any(|suffix| lower.ends_with(suffix))
    {
        return vec![rest.to_string(), format!("{rest}.tex")];
    }
    let mut spellings = vec![format!("{rest}.tex"), rest.to_string()];
    if !has_extension(rest) {
        spellings.push(format!("{rest}.ltx"));
        spellings.push(format!("{rest}.latex"));
    }
    spellings
}

fn leaf_of(path: &str) -> &str {
    path.rsplit('/').next().unwrap_or(path)
}

fn spelled_exactly(path: &str, spelling: &str) -> bool {
    path == spelling
        || path
            .strip_suffix(spelling)
            .is_some_and(|head| head.ends_with('/'))
}

fn prefers_spelling(path: &str, best: &str, spelling: &str) -> bool {
    let exact = spelled_exactly(path, spelling);
    let best_exact = spelled_exactly(best, spelling);
    if exact != best_exact {
        return exact;
    }
    path < best
}

fn folder_above(path: &str, depth: usize) -> &str {
    let mut folder = path;
    for _ in 0..depth {
        folder = dirname(folder);
    }
    folder
}

/// The best file for a path, per folder.
#[derive(Default)]
struct FolderChoice {
    best: HashMap<String, (String, usize)>,
}

impl FolderChoice {
    fn offer(&mut self, folder: &str, path: &str, rank: usize, spelling: &str) {
        if let Some((best, best_rank)) = self.best.get(folder) {
            if *best_rank < rank || !prefers_spelling(path, best, spelling) {
                return;
            }
        }
        self.best
            .insert(folder.to_string(), (path.to_string(), rank));
    }

    fn get(&self, folder: &str) -> Option<&str> {
        self.best.get(folder).map(|(path, _)| path.as_str())
    }
}

#[derive(Default)]
struct FolderTable {
    /// By the folder as spelled on disk, which tells `Paper/` from `paper/`.
    exact: FolderChoice,
    folded: FolderChoice,
}

/// One `\\import` or `\\subfile` around a file, the newest first.
struct ImportFrame {
    /// The import path, from the root's folder.
    path: ParsedTarget,
    outer: Imports,
}

type Imports = Option<Rc<ImportFrame>>;

fn include_start(kind: &IncludeKind, imports: &Imports) -> ParsedTarget {
    match imports {
        Some(frame) if kind.local => frame.path.clone(),
        _ => ParsedTarget::default(),
    }
}

/// Include lookup for one project. A target's folder depends on the root that
/// reaches it, so a walk asks "does this path exist under that folder" once per
/// root. Each answer is one map read here: the first question about a path
/// finds every folder that holds it, and the rest look the folder up.
#[derive(Default)]
struct Resolver {
    by_leaf: HashMap<String, Vec<String>>,
    tables: HashMap<String, Rc<FolderTable>>,
    parsed: HashMap<String, Option<Rc<ParsedTarget>>>,
    folded: HashMap<String, String>,
    /// What the lookups cost, which the walk's step budget counts.
    work: usize,
}

impl Resolver {
    fn new(known: &[String]) -> Resolver {
        let mut resolver = Resolver::default();
        for path in known {
            let folded = resolver.fold(path);
            resolver
                .by_leaf
                .entry(leaf_of(&folded).to_string())
                .or_default()
                .push(path.clone());
        }
        resolver
    }

    fn fold(&mut self, path: &str) -> String {
        if let Some(folded) = self.folded.get(path) {
            return folded.clone();
        }
        let folded = fold(path);
        if self.folded.len() < MAX_FOLDED_PATHS {
            self.folded.insert(path.to_string(), folded.clone());
        }
        folded
    }

    fn table(&mut self, rest: &str) -> Rc<FolderTable> {
        if let Some(table) = self.tables.get(rest) {
            return Rc::clone(table);
        }
        let mut table = FolderTable::default();
        let depth = rest.split('/').count();
        for (rank, spelling) in input_spellings(rest).iter().enumerate() {
            let folded = self.fold(spelling);
            let paths = self
                .by_leaf
                .get(leaf_of(&folded))
                .cloned()
                .unwrap_or_default();
            self.work += paths.len();
            for path in paths {
                let candidate = self.fold(&path);
                if candidate != folded && !candidate.ends_with(&format!("/{folded}")) {
                    continue;
                }
                let folder = &candidate[..candidate.len().saturating_sub(folded.len() + 1)];
                table.folded.offer(folder, &path, rank, spelling);
                table
                    .exact
                    .offer(folder_above(&path, depth), &path, rank, spelling);
            }
        }
        let table = Rc::new(table);
        self.tables.insert(rest.to_string(), Rc::clone(&table));
        table
    }

    fn target(&mut self, raw: &str) -> Option<Rc<ParsedTarget>> {
        if let Some(target) = self.parsed.get(raw) {
            return target.clone();
        }
        let target = parse_target(raw).map(Rc::new);
        self.parsed.insert(raw.to_string(), target.clone());
        target
    }

    fn lookup(&mut self, folder: &str, target: &ParsedTarget) -> Option<String> {
        self.work += 1 + target.ups;
        let mut base = folder;
        for _ in 0..target.ups {
            if base.is_empty() {
                return None;
            }
            base = dirname(base);
        }
        let table = self.table(&target.rest);
        if let Some(found) = table.exact.get(base) {
            return Some(found.to_string());
        }
        if table.folded.best.is_empty() {
            return None;
        }
        let folded = self.fold(base);
        table.folded.get(&folded).map(str::to_string)
    }

    fn lookup_at(
        &mut self,
        root_folder: &str,
        path: &ParsedTarget,
        target: &ParsedTarget,
    ) -> Option<String> {
        self.work += 1;
        let folder = folder_at(root_folder, path)?;
        self.lookup(&folder, target)
    }

    /// The import path inside this include. `import.sty` keeps every enclosing
    /// path on TeX's search path, and `\\import` starts a new one where
    /// `\\subimport` and `\\subfile` extend the current one.
    fn imports_inside(kind: &IncludeKind, imports: &Imports) -> Imports {
        let Some(folder) = kind.folder.as_deref().and_then(parse_path) else {
            return imports.clone();
        };
        let path = join_paths(&include_start(kind, imports), &folder);
        Some(Rc::new(ImportFrame {
            path,
            outer: imports.clone(),
        }))
    }

    /// What TeX opens, which pdflatex settles because the search runs twice.
    /// The first finds the name from the root's folder or an import path, and
    /// the second searches the import paths again for the name it found.
    fn on_search_path(
        &mut self,
        root_folder: &str,
        start: &ParsedTarget,
        target: &ParsedTarget,
        imports: &Imports,
    ) -> Option<String> {
        let mut written = start.clone();
        let mut found = self.lookup_at(root_folder, &written, target);
        let mut frame = imports.as_ref();
        while let (None, Some(current)) = (&found, frame) {
            written = join_paths(&current.path, start);
            found = self.lookup_at(root_folder, &written, target);
            frame = current.outer.as_ref();
        }
        let found = found?;
        let mut frame = imports.as_ref();
        while let Some(current) = frame {
            let path = join_paths(&current.path, &written);
            if let Some(deeper) = self.lookup_at(root_folder, &path, target) {
                return Some(deeper);
            }
            frame = current.outer.as_ref();
        }
        Some(found)
    }

    /// The file an include opens when TeX compiles from `folders.compile`, then,
    /// for a project TeX cannot compile yet, the project root, the root's own
    /// folder and the including file's folder.
    fn resolve(
        &mut self,
        raw: &str,
        kind: &IncludeKind,
        folders: &RootFolders,
        from_folder: &str,
        imports: &Imports,
    ) -> Option<String> {
        let target = self.target(raw)?;
        let start = include_start(kind, imports);
        let inside = Self::imports_inside(kind, imports);
        if let Some(found) = self.on_search_path(&folders.compile, &start, &target, &inside) {
            return Some(found);
        }
        let fallbacks = if kind.local {
            vec![from_folder, &folders.compile, "", &folders.own]
        } else {
            vec!["", &folders.own, from_folder]
        };
        fallbacks
            .into_iter()
            .find_map(|folder| self.lookup(folder, &target))
    }

    fn resolve_parent(&mut self, raw: &str, from_folder: &str) -> Option<String> {
        let target = self.target(raw)?;
        self.lookup(from_folder, &target)
            .or_else(|| self.lookup("", &target))
    }

    /// Whether the path exists in some other folder of the project.
    fn exists_elsewhere(&mut self, raw: &str) -> bool {
        self.target(raw)
            .is_some_and(|target| !self.table(&target.rest).folded.best.is_empty())
    }
}

/// Which tier of the fallback chain answered a lookup.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum UnitTier {
    /// Definitions compiled with the viewer.
    Unit,
    /// A fragment nothing includes yet.
    Orphans,
    /// The viewer's unit may pull in files the graph cannot see.
    Open,
    /// The viewer is an orphan.
    All,
    /// Nothing: a real unresolved name.
    None,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct UnitSummary {
    pub root: String,
    pub files: Vec<String>,
    pub open: bool,
}

/// The definitions of one name, indexed so a lookup does not walk them all.
pub struct UnitPool<'a> {
    files: Rc<Vec<&'a str>>,
    by_unit: HashMap<u32, Vec<usize>>,
    /// Definitions in files shared by several units, by the files' group.
    shared: HashMap<u32, Vec<usize>>,
    orphans: Rc<Vec<&'a str>>,
    in_group: RefCell<HashMap<u32, Rc<Vec<&'a str>>>>,
    owners_by_unit: OnceCell<HashMap<u32, Vec<u32>>>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LatexUnits {
    roots: Vec<String>,
    groups: Vec<Vec<u32>>,
    file_groups: HashMap<String, u32>,
    open_units: Vec<u32>,
    open_groups: Vec<bool>,
    /// Units as a bit set, for groups of more than one unit.
    unit_bits: HashMap<u32, Vec<u64>>,
}

struct Walked {
    files: Vec<String>,
    open: bool,
}

struct WalkStep {
    file: String,
    imports: Imports,
}

/// Where TeX compiles a root, and the root's own folder.
struct RootFolders {
    compile: String,
    own: String,
}

impl RootFolders {
    /// The project's compile folder holds only the documents inside it. Any
    /// other document compiles from the project root.
    fn of(root: &str, compile_folder: &str) -> Self {
        let inside = !compile_folder.is_empty()
            && root
                .strip_prefix(compile_folder)
                .is_some_and(|rest| rest.starts_with('/'));
        RootFolders {
            compile: if inside { compile_folder } else { "" }.to_string(),
            own: dirname(root).to_string(),
        }
    }
}

struct Walker<'a> {
    facts: &'a HashMap<String, Facts>,
    read: &'a HashSet<String>,
    children: &'a HashMap<String, Vec<String>>,
    compile_folder: &'a str,
    resolver: Resolver,
    last_walk: HashMap<String, usize>,
    walk_id: usize,
    steps: usize,
    max_steps: usize,
}

impl Walker<'_> {
    fn enter(&mut self, file: String, imports: Imports, stack: &mut Vec<WalkStep>) {
        if self.last_walk.get(&file) != Some(&self.walk_id) {
            self.last_walk.insert(file.clone(), self.walk_id);
            stack.push(WalkStep { file, imports });
        }
    }

    fn walk(&mut self, root: &str) -> Option<Walked> {
        self.walk_id += 1;
        let folders = RootFolders::of(root, self.compile_folder);
        let mut files = Vec::new();
        let mut stack = Vec::new();
        let mut declared = Vec::new();
        let mut open = false;
        self.enter(root.to_string(), None, &mut stack);
        while let Some(WalkStep { file, imports }) = self.next(&mut stack, &mut declared) {
            open |= self.visit(&file, &imports, &folders, &mut stack, &mut declared);
            files.push(file);
            self.steps += 1;
            if self.exhausted() {
                return None;
            }
        }
        Some(Walked { files, open })
    }

    /// A file reached by an include takes the search path of that include, as
    /// TeX sees it. A declared link only counts for a file no include reaches.
    fn next(
        &mut self,
        stack: &mut Vec<WalkStep>,
        declared: &mut Vec<WalkStep>,
    ) -> Option<WalkStep> {
        while stack.is_empty() {
            let WalkStep { file, imports } = declared.pop()?;
            self.enter(file, imports, stack);
        }
        stack.pop()
    }

    fn exhausted(&self) -> bool {
        self.steps + self.resolver.work > self.max_steps
    }

    /// Queues what a file pulls in, and says whether it opens the unit.
    fn visit(
        &mut self,
        file: &str,
        imports: &Imports,
        folders: &RootFolders,
        stack: &mut Vec<WalkStep>,
        declared: &mut Vec<WalkStep>,
    ) -> bool {
        let from_folder = dirname(file).to_string();
        let facts = self.facts;
        let children = self.children;
        if let Some(child_files) = children.get(file) {
            for child in child_files {
                let subfile = facts
                    .get(child)
                    .is_some_and(|facts| facts.subfiles_parent.is_some());
                let frame = if subfile {
                    Some(Rc::new(ImportFrame {
                        path: path_within(&folders.compile, dirname(child)),
                        outer: imports.clone(),
                    }))
                } else {
                    imports.clone()
                };
                declared.push(WalkStep {
                    file: child.clone(),
                    imports: frame,
                });
            }
        }
        let Some(file_facts) = facts.get(file) else {
            return false;
        };
        let mut open = file_facts.open;
        for include in &file_facts.includes {
            self.steps += 1;
            if self.exhausted() {
                return open;
            }
            let target =
                self.resolver
                    .resolve(&include.raw, &include.kind, folders, &from_folder, imports);
            match target {
                Some(target) if self.read.contains(&target) => {
                    let inside = Resolver::imports_inside(&include.kind, imports);
                    self.enter(target, inside, stack);
                }
                Some(_) => open = true,
                None => open |= self.resolver.exists_elsewhere(&include.raw),
            }
        }
        for raw in &file_facts.packages {
            self.steps += 1;
            if self.exhausted() {
                return open;
            }
            if let Some(target) =
                self.resolver
                    .resolve(raw, &IncludeKind::default(), folders, &from_folder, imports)
            {
                if self.read.contains(&target) {
                    self.enter(target, imports.clone(), stack);
                }
            }
        }
        open
    }
}

fn has_unit(units: &[u32], unit: u32) -> bool {
    units.binary_search(&unit).is_ok()
}

impl LatexUnits {
    /// `sources` are the files whose text was read; `known` is every path in
    /// the project, read or not.
    pub fn build<'a>(
        sources: impl Iterator<Item = (&'a str, &'a str)>,
        known: &[String],
        main_document: &str,
    ) -> Option<LatexUnits> {
        Self::build_within(sources, known, main_document, "", MAX_STEPS)
    }

    /// `compile_folder` is where TeX runs when that is not the project root.
    pub fn build_in<'a>(
        sources: impl Iterator<Item = (&'a str, &'a str)>,
        known: &[String],
        main_document: &str,
        compile_folder: &str,
    ) -> Option<LatexUnits> {
        Self::build_within(sources, known, main_document, compile_folder, MAX_STEPS)
    }

    pub fn build_within<'a>(
        sources: impl Iterator<Item = (&'a str, &'a str)>,
        known: &[String],
        main_document: &str,
        compile_folder: &str,
        max_steps: usize,
    ) -> Option<LatexUnits> {
        let mut read: HashSet<String> = HashSet::new();
        let mut facts: HashMap<String, Facts> = HashMap::new();
        let mut candidates: BTreeSet<String> = BTreeSet::new();
        let mut declared: Vec<(String, String)> = Vec::new();
        for (path, text) in sources {
            read.insert(path.to_string());
            if engine_for(path) != Some(Engine::Latex) {
                continue;
            }
            let file = file_facts(path, text);
            if let Some(parent) = file.declared_parent() {
                declared.push((path.to_string(), parent.to_string()));
            } else if file.document {
                candidates.insert(path.to_string());
            }
            facts.insert(path.to_string(), file);
        }
        let main_is_subfile = facts
            .get(main_document)
            .is_some_and(|facts| facts.subfiles_parent.is_some());
        if read.contains(main_document) && is_latex_source(main_document) && !main_is_subfile {
            candidates.insert(main_document.to_string());
        }
        if candidates.len() < 2 && declared.is_empty() {
            return None;
        }
        declared.sort();

        let mut all_known: Vec<String> = known.to_vec();
        all_known.extend(read.iter().cloned());
        all_known.sort();
        all_known.dedup();
        let mut resolver = Resolver::new(&all_known);
        let mut children: HashMap<String, Vec<String>> = HashMap::new();
        for (file, raw) in &declared {
            let parent = resolver
                .resolve_parent(raw, dirname(file))
                .filter(|parent| {
                    parent != file && read.contains(parent) && is_latex_source(parent)
                });
            let Some(parent) = parent else {
                if facts.get(file).is_some_and(|facts| facts.document) {
                    candidates.insert(file.clone());
                }
                continue;
            };
            children
                .entry(parent.clone())
                .or_default()
                .push(file.clone());
            let own = facts.get(&parent).and_then(Facts::declared_parent);
            if own.is_none() {
                candidates.insert(parent);
            }
        }
        if candidates.len() < 2 {
            return None;
        }

        let mut walker = Walker {
            facts: &facts,
            read: &read,
            compile_folder,
            children: &children,
            resolver,
            last_walk: HashMap::new(),
            walk_id: 0,
            steps: 0,
            max_steps,
        };
        let mut kept: Vec<(String, Walked)> = Vec::new();
        let mut covered: HashSet<String> = HashSet::new();
        for root in &candidates {
            if covered.contains(root) {
                continue;
            }
            let walked = walker.walk(root)?;
            let before = covered.len();
            for file in &walked.files {
                if file != root && candidates.contains(file) {
                    covered.insert(file.clone());
                }
            }
            if covered.len() > before {
                kept.retain(|(earlier, _)| !covered.contains(earlier));
            }
            kept.push((root.clone(), walked));
        }
        if kept.len() < 2 {
            return None;
        }
        Some(Self::from_walks(kept))
    }

    fn from_walks(kept: Vec<(String, Walked)>) -> LatexUnits {
        let mut units_of: HashMap<String, Vec<u32>> = HashMap::new();
        let mut roots = Vec::with_capacity(kept.len());
        let mut open_units = Vec::new();
        for (unit, (root, walked)) in kept.into_iter().enumerate() {
            let unit = unit as u32;
            roots.push(root);
            if walked.open {
                open_units.push(unit);
            }
            for file in walked.files {
                units_of.entry(file).or_default().push(unit);
            }
        }
        let mut files: Vec<(String, Vec<u32>)> = units_of.into_iter().collect();
        files.sort();
        let mut groups: Vec<Vec<u32>> = Vec::new();
        let mut group_ids: HashMap<Vec<u32>, u32> = HashMap::new();
        let mut file_groups = HashMap::with_capacity(files.len());
        for (file, units) in files {
            let group = *group_ids.entry(units).or_insert_with_key(|units| {
                groups.push(units.clone());
                (groups.len() - 1) as u32
            });
            file_groups.insert(file, group);
        }
        let open_groups = groups
            .iter()
            .map(|group| group.iter().any(|unit| open_units.contains(unit)))
            .collect();
        let words = roots.len() / 64 + 1;
        let unit_bits = groups
            .iter()
            .enumerate()
            .filter(|(_, group)| group.len() > 1)
            .map(|(id, group)| {
                let mut row = vec![0u64; words];
                for unit in group {
                    row[*unit as usize / 64] |= 1 << (*unit % 64);
                }
                (id as u32, row)
            })
            .collect();
        LatexUnits {
            roots,
            groups,
            file_groups,
            open_units,
            open_groups,
            unit_bits,
        }
    }

    fn group_of(&self, file: &str) -> Option<u32> {
        self.file_groups.get(file).copied()
    }

    fn units(&self, group: u32) -> &[u32] {
        &self.groups[group as usize]
    }

    fn overlap(&self, left: u32, right: u32) -> bool {
        if left == right {
            return true;
        }
        match (self.unit_bits.get(&left), self.unit_bits.get(&right)) {
            (Some(a), Some(b)) => a.iter().zip(b).any(|(a, b)| a & b != 0),
            (None, _) => has_unit(self.units(right), self.units(left)[0]),
            (_, None) => has_unit(self.units(left), self.units(right)[0]),
        }
    }

    /// One entry per unit, in order, for tests and goldens.
    pub fn summary(&self) -> Vec<UnitSummary> {
        self.roots
            .iter()
            .enumerate()
            .map(|(unit, root)| {
                let unit = unit as u32;
                let mut files: Vec<String> = self
                    .file_groups
                    .iter()
                    .filter(|(_, group)| has_unit(self.units(**group), unit))
                    .map(|(file, _)| file.clone())
                    .collect();
                files.sort();
                UnitSummary {
                    root: root.clone(),
                    files,
                    open: self.open_units.contains(&unit),
                }
            })
            .collect()
    }

    /// Whether a file belongs to no unit.
    pub fn is_orphan(&self, file: &str) -> bool {
        !self.file_groups.contains_key(file)
    }

    /// Same unit, or either file outside every unit.
    pub fn connected(&self, left: &str, right: &str) -> bool {
        match (self.group_of(left), self.group_of(right)) {
            (Some(left), Some(right)) => self.overlap(left, right),
            _ => true,
        }
    }

    /// Whether a link from `viewer` may name `file`.
    pub fn reaches(&self, viewer: &str, file: &str) -> bool {
        match self.group_of(viewer) {
            None => true,
            Some(group) => self.open_groups[group as usize] || self.connected(viewer, file),
        }
    }

    pub fn pool<'a>(&self, files: impl IntoIterator<Item = &'a str>) -> UnitPool<'a> {
        let files: Vec<&'a str> = files.into_iter().collect();
        let mut by_unit: HashMap<u32, Vec<usize>> = HashMap::new();
        let mut shared: HashMap<u32, Vec<usize>> = HashMap::new();
        let mut orphans: Vec<&'a str> = Vec::new();
        for (ordinal, file) in files.iter().enumerate() {
            match self.group_of(file) {
                None => orphans.push(file),
                Some(group) if self.units(group).len() > 1 => {
                    shared.entry(group).or_default().push(ordinal);
                }
                Some(group) => by_unit
                    .entry(self.units(group)[0])
                    .or_default()
                    .push(ordinal),
            }
        }
        UnitPool {
            files: Rc::new(files),
            by_unit,
            shared,
            orphans: Rc::new(orphans),
            in_group: RefCell::new(HashMap::new()),
            owners_by_unit: OnceCell::new(),
        }
    }

    fn overlapping_owners(&self, group: u32, pool: &UnitPool<'_>) -> Vec<u32> {
        let units = self.units(group);
        if units.len() * OWNER_SCAN_RATIO >= pool.shared.len() {
            return pool
                .shared
                .keys()
                .copied()
                .filter(|owner| self.overlap(group, *owner))
                .collect();
        }
        let by_unit = pool.owners_by_unit.get_or_init(|| {
            let mut owners: HashMap<u32, Vec<u32>> = HashMap::new();
            for owner in pool.shared.keys() {
                for unit in self.units(*owner) {
                    owners.entry(*unit).or_default().push(*owner);
                }
            }
            owners
        });
        let mut owners: Vec<u32> = units
            .iter()
            .filter_map(|unit| by_unit.get(unit))
            .flatten()
            .copied()
            .collect();
        owners.sort_unstable();
        owners.dedup();
        owners
    }

    fn in_units<'a>(&self, group: u32, pool: &UnitPool<'a>) -> Rc<Vec<&'a str>> {
        if let Some(hits) = pool.in_group.borrow().get(&group) {
            return Rc::clone(hits);
        }
        let units = self.units(group);
        let mut ordinals: Vec<usize> = Vec::new();
        if pool.by_unit.len() < units.len() {
            for (unit, list) in &pool.by_unit {
                if has_unit(units, *unit) {
                    ordinals.extend(list);
                }
            }
        } else {
            for unit in units {
                if let Some(list) = pool.by_unit.get(unit) {
                    ordinals.extend(list);
                }
            }
        }
        for owner in self.overlapping_owners(group, pool) {
            if let Some(list) = pool.shared.get(&owner) {
                ordinals.extend(list);
            }
        }
        ordinals.sort_unstable();
        let hits: Rc<Vec<&'a str>> = Rc::new(
            ordinals
                .into_iter()
                .map(|index| pool.files[index])
                .collect(),
        );
        pool.in_group.borrow_mut().insert(group, Rc::clone(&hits));
        hits
    }

    /// What a use in `viewer` can see of a name's definitions. A citation never
    /// comes back empty, because `.bib` keys stay pooled across documents.
    pub fn select<'a>(
        &self,
        viewer: &str,
        pool: &UnitPool<'a>,
        citation: bool,
    ) -> (Rc<Vec<&'a str>>, UnitTier) {
        let Some(group) = self.group_of(viewer) else {
            return (Rc::clone(&pool.files), UnitTier::All);
        };
        if !pool.files.is_empty() {
            let hits = self.in_units(group, pool);
            if !hits.is_empty() {
                return (hits, UnitTier::Unit);
            }
            if !pool.orphans.is_empty() {
                return (Rc::clone(&pool.orphans), UnitTier::Orphans);
            }
            if self.open_groups[group as usize] || citation {
                return (Rc::clone(&pool.files), UnitTier::Open);
            }
        }
        (Rc::new(Vec::new()), UnitTier::None)
    }

    /// Whether two candidates of a use collide where the viewer can see them.
    pub fn is_ambiguous(&self, viewer: &str, candidates: &[&str]) -> bool {
        if candidates.len() < 2 {
            return false;
        }
        let visible = self.group_of(viewer).map(|group| self.units(group));
        let mut seen: HashSet<u32> = HashSet::new();
        let mut orphans = 0;
        for candidate in candidates {
            let Some(owner) = self.group_of(candidate) else {
                orphans += 1;
                if visible.is_none() && orphans > 1 {
                    return true;
                }
                continue;
            };
            for unit in self.units(owner) {
                if visible.is_some_and(|units| !has_unit(units, *unit)) {
                    continue;
                }
                if !seen.insert(*unit) {
                    return true;
                }
            }
        }
        false
    }

    /// One row per unit (then the orphans) holding two or more of `files`.
    pub fn duplicate_rows(&self, files: &[String]) -> Vec<Vec<String>> {
        let mut ordinals: HashMap<u32, Vec<usize>> = HashMap::new();
        let mut file_groups: Vec<u32> = Vec::new();
        let mut orphans: Vec<String> = Vec::new();
        for (ordinal, file) in files.iter().enumerate() {
            match self.group_of(file) {
                None => orphans.push(file.clone()),
                Some(group) => {
                    let list = ordinals.entry(group).or_default();
                    if list.is_empty() {
                        file_groups.push(group);
                    }
                    list.push(ordinal);
                }
            }
        }
        let mut groups_in_unit: HashMap<u32, Vec<u32>> = HashMap::new();
        for group in file_groups {
            for unit in self.units(group) {
                groups_in_unit.entry(*unit).or_default().push(group);
            }
        }
        let mut units: Vec<u32> = groups_in_unit.keys().copied().collect();
        units.sort_unstable();
        let mut rows: Vec<Vec<String>> = Vec::new();
        let mut seen: HashSet<Vec<u32>> = HashSet::new();
        for unit in units {
            let members = groups_in_unit.remove(&unit).unwrap_or_default();
            let mut row: Vec<usize> = members
                .iter()
                .filter_map(|group| ordinals.get(group))
                .flatten()
                .copied()
                .collect();
            if seen.insert(members) && row.len() > 1 {
                row.sort_unstable();
                rows.push(row.into_iter().map(|at| files[at].clone()).collect());
            }
        }
        if orphans.len() > 1 {
            rows.push(orphans);
        }
        rows
    }
}
