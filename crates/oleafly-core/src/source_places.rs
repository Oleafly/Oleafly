use std::cell::OnceCell;
use std::collections::{HashMap, HashSet, VecDeque};
use std::path::{Path, PathBuf};
use std::time::SystemTime;

use crate::compile_log::{
    is_build_file, is_nullfont_missing_character, missing_character_key, LogCategory,
    LogDiagnostic, LogSeverity, MAX_MISSING_CHARACTER_DIAGNOSTICS,
};
use crate::tex_errors::{code_point, read_source_lines, CompileError};

const MAX_SOURCE_FILES: usize = 256;
const MAX_ALL_SOURCE_BYTES: usize = 32 * 1024 * 1024;
const MAX_BUILD_FILES: usize = 4096;
const MAX_BUILD_DEPTH: usize = 6;
const MAX_WRAPPED_LINES: usize = 4;
const MAX_TYPED_PLACES: usize = 8;
const MAX_BOX_SEARCHES: usize = 24;
const MAX_LOST_TAIL: usize = 8;
const UNDEFINED_COMMAND: &str = "Undefined control sequence";
const MISSING_DOLLAR: &str = "Missing $ inserted";
const FILE_ENDED: &str = "File ended while scanning use of ";
const PARAGRAPH_ENDED: &str = "Paragraph ended before ";
const EMERGENCY_STOP: &str = "Emergency stop";
const FATAL_ERROR: &str = "==> Fatal error occurred";
const NO_PAGES: &str = "No pages of output";
const FLOAT_TOO_LARGE: &str = "Float too large for page";
const FLOAT_MOVED: &str = "float specifier changed to";
const MIN_BOX_WORD: usize = 10;
const LOADERS: [&str; 3] = ["\\usepackage", "\\RequirePackage", "\\documentclass"];
const BIBLIOGRAPHY_LOADERS: [&str; 4] = [
    "\\bibliography",
    "\\addbibresource",
    "\\addglobalbib",
    "\\addsectionbib",
];
const CONTENTS_FILES: [&str; 3] = [".toc", ".lof", ".lot"];
const LISTED_IN_CONTENTS: [&str; 6] = [
    "section{",
    "section[",
    "\\chapter",
    "\\part",
    "\\caption",
    "\\addcontentsline",
];
const BUILD_FILE_DAMAGED_CODE: &str = "tex.build_file_damaged";
const BUILD_FILE_DAMAGED: &str = "A file left over from an earlier compile is damaged or out of date, and LaTeX stopped while reading it. Recompile from scratch to build it again. If the same error comes back, a line in the document is the cause, usually a command or special character inside a section title, caption, label or bibliography entry.";
const BUILD_FILE_UNREADABLE_CODE: &str = "tex.build_file_unreadable";
const BUILD_FILE_UNREADABLE: &str = "LaTeX wrote a line to one of its own working files and could not read it back. Recompiling from scratch will not help, because the document writes the same line again. The cause is usually a command or special character inside a section title, caption, label or bibliography entry. The compile log shows the line.";

#[derive(Clone, Copy)]
pub struct BuildFolders<'a> {
    pub project_dir: &'a Path,
    pub compile_dir: &'a Path,
    pub out_dir: &'a Path,
}

type Stamp = (Option<SystemTime>, u64);

fn stamp(path: &Path) -> Option<Stamp> {
    let found = std::fs::metadata(path).ok()?;
    Some((found.modified().ok(), found.len()))
}

#[derive(Default)]
pub struct BuildBefore {
    files: Option<HashMap<PathBuf, Stamp>>,
}

impl BuildBefore {
    pub fn take(out_dir: &Path) -> Self {
        let mut files = HashMap::new();
        let mut folders: Vec<(PathBuf, usize)> = out_dir
            .canonicalize()
            .map(|root| (root, 0))
            .into_iter()
            .collect();
        while let Some((folder, depth)) = folders.pop() {
            let Ok(entries) = std::fs::read_dir(&folder) else {
                continue;
            };
            for entry in entries.flatten() {
                let Ok(kind) = entry.file_type() else {
                    continue;
                };
                if kind.is_dir() && depth < MAX_BUILD_DEPTH {
                    folders.push((entry.path(), depth + 1));
                } else if kind.is_file() {
                    if files.len() == MAX_BUILD_FILES {
                        return Self::default();
                    }
                    if let Some(found) = stamp(&entry.path()) {
                        files.insert(entry.path(), found);
                    }
                }
            }
        }
        Self { files: Some(files) }
    }

    pub(crate) fn left_untouched(&self, path: &Path) -> bool {
        let (Some(files), Ok(path)) = (&self.files, path.canonicalize()) else {
            return false;
        };
        files
            .get(&path)
            .is_some_and(|earlier| stamp(&path) == Some(*earlier))
    }
}

struct Place {
    file: String,
    line: u32,
    start: usize,
    end: usize,
    text: String,
}

struct SourceFile {
    name: String,
    lines: Vec<String>,
}

enum Origin {
    Source(usize),
    Built,
    Outside,
    Bundled,
}

struct Sources {
    files: Vec<SourceFile>,
    named: HashMap<String, Origin>,
    bytes: usize,
}

fn plain(name: &str) -> &str {
    let mut name = name;
    while let Some(rest) = name.strip_prefix("./") {
        name = rest;
    }
    name
}

fn code_part(line: &str) -> &str {
    let mut escaped = false;
    for (index, character) in line.char_indices() {
        match character {
            '\\' => escaped = !escaped,
            '%' if !escaped => return &line[..index],
            _ => escaped = false,
        }
    }
    line
}

fn is_command_letter(character: char) -> bool {
    character.is_ascii_alphabetic() || character == '@'
}

fn needles<'a>(text: &'a str, needle: &'a str) -> impl Iterator<Item = usize> + 'a {
    let command = needle.starts_with('\\');
    text.match_indices(needle)
        .map(|(index, _)| index)
        .filter(move |index| {
            !command
                || !text[index + needle.len()..]
                    .chars()
                    .next()
                    .is_some_and(is_command_letter)
        })
}

fn find_needle(text: &str, needle: &str) -> Option<usize> {
    needles(text, needle).next()
}

impl SourceFile {
    fn line(&self, line: u32) -> Option<&str> {
        self.lines
            .get(usize::try_from(line).ok()?.checked_sub(1)?)
            .map(String::as_str)
    }

    fn place(&self, index: usize, start: usize, end: usize) -> Place {
        Place {
            file: self.name.clone(),
            line: index as u32 + 1,
            start,
            end,
            text: self.lines[index].clone(),
        }
    }

    fn found(&self, index: usize, needle: &str, code_only: bool) -> Option<Place> {
        let line = &self.lines[index];
        let text = if code_only { code_part(line) } else { line };
        let start = find_needle(text, needle)?;
        Some(self.place(index, start, start + needle.len()))
    }

    fn above(&self, line: u32, needle: &str, mut skip: usize) -> Option<Place> {
        let last = usize::try_from(line).ok()?.checked_sub(1)?;
        for index in (0..last.min(self.lines.len())).rev() {
            let starts: Vec<usize> = needles(code_part(&self.lines[index]), needle).collect();
            for start in starts.into_iter().rev() {
                if skip == 0 {
                    return Some(self.place(index, start, start + needle.len()));
                }
                skip -= 1;
            }
        }
        None
    }
}

fn on_disk(folders: BuildFolders<'_>, name: &str) -> Option<PathBuf> {
    let with_extension = format!("{name}.tex");
    [folders.compile_dir, folders.project_dir]
        .iter()
        .flat_map(|folder| [folder.join(name), folder.join(&with_extension)])
        .find(|path| path.is_file())
}

fn rejoined(folders: BuildFolders<'_>, log: &str, name: &str) -> Option<String> {
    let cut = plain(name);
    let mut lines = log.lines();
    while let Some(line) = lines.next() {
        let Some((_, opened)) = line.rsplit_once('(') else {
            continue;
        };
        let whole_token = !opened.is_empty() && !opened.contains([' ', '\t', ')']);
        if !whole_token || !cut.ends_with(plain(opened)) {
            continue;
        }
        let mut whole = name.to_owned();
        for rest in lines.clone().take(MAX_WRAPPED_LINES) {
            let part = rest
                .split(|character: char| character.is_whitespace() || "()".contains(character))
                .next()
                .unwrap_or_default();
            whole.push_str(part);
            if on_disk(folders, plain(&whole)).is_some() {
                return Some(whole);
            }
            if part.is_empty() || part.len() != rest.len() {
                break;
            }
        }
    }
    None
}

fn rejoin_wrapped_names(
    folders: BuildFolders<'_>,
    log: &str,
    errors: &mut [CompileError],
    diagnostics: &mut [LogDiagnostic],
) {
    let mut whole: HashMap<String, Option<String>> = HashMap::new();
    let mut rejoin = |file: &mut Option<String>| {
        let Some(name) = file.as_deref() else {
            return;
        };
        let found = whole.entry(name.to_owned()).or_insert_with(|| {
            on_disk(folders, plain(name))
                .is_none()
                .then(|| rejoined(folders, log, name))
                .flatten()
        });
        if found.is_some() {
            file.clone_from(found);
        }
    };
    errors.iter_mut().for_each(|error| rejoin(&mut error.file));
    diagnostics.iter_mut().for_each(|row| rejoin(&mut row.file));
}

impl Sources {
    fn origin(
        &mut self,
        folders: BuildFolders<'_>,
        root: &Path,
        built: Option<&Path>,
        token: &str,
    ) -> Option<Origin> {
        let Some(found) = on_disk(folders, token) else {
            return (!token.contains(['/', '\\'])).then_some(Origin::Bundled);
        };
        let path = found.canonicalize().ok()?;
        if built.is_some_and(|build| path.starts_with(build)) {
            return Some(Origin::Built);
        }
        let Ok(relative) = path.strip_prefix(root) else {
            return Some(Origin::Outside);
        };
        let name = crate::slash_path(relative);
        if name.split('/').next() == Some(crate::workspace::INTERNAL_DIR) {
            return Some(Origin::Built);
        }
        if let Some(index) = self.files.iter().position(|file| file.name == name) {
            return Some(Origin::Source(index));
        }
        if self.files.len() == MAX_SOURCE_FILES || self.bytes > MAX_ALL_SOURCE_BYTES {
            return None;
        }
        let lines = read_source_lines(&path)?;
        self.bytes += lines.iter().map(String::len).sum::<usize>();
        self.files.push(SourceFile { name, lines });
        Some(Origin::Source(self.files.len() - 1))
    }

    fn read(folders: BuildFolders<'_>, log: &str, named: &[&str]) -> Self {
        let mut sources = Self {
            files: Vec::new(),
            named: HashMap::new(),
            bytes: 0,
        };
        let Ok(root) = folders.project_dir.canonicalize() else {
            return sources;
        };
        let built = folders.out_dir.canonicalize().ok();
        let nearby = |token: &str| {
            let path = Path::new(token);
            path.is_relative()
                || [folders.project_dir, folders.compile_dir, root.as_path()]
                    .iter()
                    .any(|folder| path.starts_with(folder))
        };
        let opened = log.split('(').skip(1).map(|token| {
            token
                .split(|character: char| character.is_whitespace() || character == ')')
                .next()
                .unwrap_or_default()
                .trim_matches('"')
        });
        let opened = opened.filter(|token| !token.contains('\\') && nearby(token));
        let tokens = opened
            .map(|token| (token, false))
            .chain(named.iter().map(|name| (*name, true)));
        let mut missed = HashSet::new();
        for (token, named) in tokens {
            let key = plain(token);
            let known = sources.named.contains_key(key) || (!named && missed.contains(key));
            if key.is_empty() || key.len() >= 512 || known {
                continue;
            }
            match sources.origin(folders, &root, built.as_deref(), key) {
                Some(Origin::Source(index)) => {
                    sources.named.insert(key.to_owned(), Origin::Source(index));
                }
                Some(origin) if named => {
                    sources.named.insert(key.to_owned(), origin);
                }
                _ => {
                    missed.insert(key);
                }
            }
        }
        sources
    }

    fn get(&self, name: &str) -> Option<&SourceFile> {
        let name = plain(name);
        match self.named.get(name) {
            Some(Origin::Source(index)) => self.files.get(*index),
            Some(_) => None,
            None => self.files.iter().find(|file| file.name == name),
        }
    }

    fn origin_of(&self, name: &str) -> Option<&Origin> {
        self.named.get(plain(name))
    }

    fn is_built(&self, name: &str) -> bool {
        is_build_file(plain(name)) || matches!(self.origin_of(name), Some(Origin::Built))
    }

    fn places(&self, needle: &str) -> Vec<Place> {
        self.files
            .iter()
            .flat_map(|file| {
                (0..file.lines.len()).filter_map(move |index| file.found(index, needle, true))
            })
            .collect()
    }
}

fn error_text(message: &str) -> &str {
    let line = message.lines().next().unwrap_or_default().trim();
    let line = line.strip_prefix("! ").unwrap_or(line);
    let line = line
        .strip_prefix("LaTeX Error: ")
        .or_else(|| line.strip_prefix("LaTeX: "))
        .unwrap_or(line);
    let from_package = ["Package ", "Class "]
        .iter()
        .any(|kind| line.starts_with(kind));
    let line = line
        .split_once(": ")
        .filter(|_| from_package)
        .map_or(line, |(_, rest)| rest);
    line.trim_end_matches('.')
}

fn context_lines(row: &LogDiagnostic) -> Vec<&str> {
    row.error_context
        .as_deref()
        .map(|context| context.lines().skip(1).collect())
        .unwrap_or_default()
}

fn last_command(text: &str) -> Option<&str> {
    let text = text.trim_end();
    let start = text.rfind('\\')?;
    let name = &text[start..];
    (name.len() > 1 && name[1..].chars().all(is_command_letter)).then_some(name)
}

fn read_so_far<'a>(context: &[&'a str], line: u32) -> Option<&'a str> {
    let prefix = format!("l.{line} ");
    context.iter().find_map(|text| text.strip_prefix(&prefix))
}

fn split_point(source: &str, upper: &str) -> Option<usize> {
    let upper = upper.strip_prefix("...").unwrap_or(upper).trim_end();
    if upper.is_empty() {
        return None;
    }
    for length in [40, 24, 12, 6] {
        let start = upper
            .char_indices()
            .rev()
            .nth(length - 1)
            .map_or(0, |(index, _)| index);
        let tail = upper[start..].trim_start();
        let mut found = source.match_indices(tail);
        if let (Some((index, _)), None) = (found.next(), found.next()) {
            return Some(index + tail.len());
        }
        if start == 0 {
            break;
        }
    }
    None
}

fn token_before(source: &str, end: usize) -> usize {
    let head = &source[..end];
    let letters = head
        .char_indices()
        .rev()
        .take_while(|(_, character)| is_command_letter(*character))
        .last()
        .map_or(end, |(index, _)| index);
    if letters < end && head[..letters].ends_with('\\') {
        return letters - 1;
    }
    head.char_indices()
        .next_back()
        .map_or(end, |(index, _)| index)
}

fn reported_place(file: &SourceFile, line: u32, context: &[&str]) -> Option<Place> {
    let index = usize::try_from(line).ok()?.checked_sub(1)?;
    let source = file.line(line)?;
    let end = split_point(source, read_so_far(context, line)?)?;
    Some(file.place(index, token_before(source, end), end))
}

fn undefined_command(
    row: &LogDiagnostic,
    file: Option<&SourceFile>,
    sources: &Sources,
) -> Option<Place> {
    let context = context_lines(row);
    let needle = last_command(context.first()?)?;
    if let (Some(file), Some(line)) = (file, row.line) {
        let here = file
            .line(line)
            .is_some_and(|text| find_needle(code_part(text), needle).is_some());
        if here {
            return None;
        }
        let later = context
            .get(1)
            .filter(|rest| !rest.starts_with("l."))
            .map_or(0, |rest| needles(rest, needle).count());
        if let Some(place) = file.above(line, needle, later) {
            return Some(place);
        }
    }
    only(sources.places(needle))
}

fn unescaped(text: &str, wanted: char) -> Vec<usize> {
    let mut found = Vec::new();
    let mut escaped = false;
    for (index, character) in text.char_indices() {
        match character {
            '\\' => escaped = !escaped,
            other => {
                if other == wanted && !escaped {
                    found.push(index);
                }
                escaped = false;
            }
        }
    }
    found
}

fn unclosed_dollar(row: &LogDiagnostic, file: &SourceFile) -> Option<Place> {
    let blank = |index: &usize| file.lines[*index].trim().is_empty();
    let end = usize::try_from(row.line?).ok()?.checked_sub(1)?;
    if end >= file.lines.len() || !blank(&end) {
        return None;
    }
    let start = (0..end).rev().find(blank).map_or(0, |index| index + 1);
    let mut open = None;
    for index in start..end {
        for at in unescaped(code_part(&file.lines[index]), '$') {
            open = match open {
                None => Some((index, at)),
                Some(_) => None,
            };
        }
    }
    open.map(|(index, at)| file.place(index, at, at + 1))
}

fn scanned_command(text: &str) -> Option<(&str, bool)> {
    let (rest, to_the_end) = match text.strip_prefix(FILE_ENDED) {
        Some(rest) => (rest, true),
        None => (text.strip_prefix(PARAGRAPH_ENDED)?, false),
    };
    let name = rest.split_whitespace().next()?;
    name.starts_with('\\').then_some((name, to_the_end))
}

fn unclosed_in(
    file: &SourceFile,
    command: &str,
    to_the_end: bool,
    until: Option<usize>,
) -> Option<Place> {
    let last = until.map_or(file.lines.len(), |until| until.min(file.lines.len()));
    let mut open: Option<(Place, usize)> = None;
    for index in 0..last {
        let text = code_part(&file.lines[index]);
        let mut from = 0;
        if open.is_none() {
            let Some(start) = find_needle(text, command) else {
                continue;
            };
            from = start + command.len();
            if !text[from..].trim_start().starts_with(['{', '[']) {
                continue;
            }
            open = Some((file.place(index, start, from), 0));
        } else if text.trim().is_empty() && !to_the_end {
            if until.is_none() {
                break;
            }
            open = None;
            continue;
        }
        let Some((place, mut depth)) = open.take() else {
            continue;
        };
        let mut closed = false;
        let mut escaped = false;
        for character in text[from..].chars() {
            match character {
                '\\' => escaped = !escaped,
                '{' if !escaped => depth += 1,
                '}' if !escaped => {
                    depth = depth.saturating_sub(1);
                    closed = depth == 0;
                    if closed {
                        break;
                    }
                }
                _ => escaped = false,
            }
        }
        if !closed {
            open = Some((place, depth));
        }
    }
    open.map(|(place, _)| place)
}

fn never_closed(
    sources: &Sources,
    command: &str,
    to_the_end: bool,
    reported: Option<(&SourceFile, u32)>,
) -> Option<Place> {
    let own = reported.and_then(|(file, line)| {
        let until = (!to_the_end).then_some(line.saturating_sub(1) as usize);
        unclosed_in(file, command, to_the_end, until)
    });
    own.or_else(|| {
        sources
            .files
            .iter()
            .find_map(|file| unclosed_in(file, command, to_the_end, None))
    })
}

fn missing_file(text: &str) -> Option<&str> {
    let (_, rest) = text.split_once("File `")?;
    let (name, rest) = rest.split_once('\'')?;
    let stem = [".tex", ".sty", ".cls"]
        .iter()
        .find_map(|extension| name.strip_suffix(extension))
        .unwrap_or(name);
    (rest.trim_start().starts_with("not found") && stem.len() > 1).then_some(stem)
}

fn only(mut places: Vec<Place>) -> Option<Place> {
    (places.len() == 1).then(|| places.remove(0))
}

fn loaded_package(sources: &Sources, file: &str) -> Option<Place> {
    let name = Path::new(file).file_stem()?.to_str()?;
    let loading = sources.places(name).into_iter().filter(|place| {
        let head = &place.text[..place.start];
        let tail = &place.text[place.end..];
        LOADERS.iter().any(|command| head.contains(command))
            && head.ends_with(['{', ',', ' '])
            && tail.starts_with(['}', ',', ' '])
    });
    only(loading.collect())
}

fn cited_key(bbl: &[String], line: usize) -> Option<&str> {
    let item = (0..line.min(bbl.len()))
        .rev()
        .find(|index| bbl[*index].contains("\\bibitem") || bbl[*index].contains("\\entry{"))?;
    for text in bbl.iter().skip(item).take(4) {
        let rest = match text.split_once("\\entry") {
            Some((_, rest)) => rest,
            None => text
                .rsplit_once("]")
                .map_or(text.as_str(), |(_, rest)| rest),
        };
        let rest = rest.split_once("\\bibitem").map_or(rest, |(_, rest)| rest);
        if let Some(key) = rest
            .strip_prefix('{')
            .and_then(|rest| rest.split('}').next())
        {
            return Some(key);
        }
    }
    None
}

fn entry_key(text: &str) -> Option<&str> {
    let (_, rest) = text.trim_start().strip_prefix('@')?.split_once('{')?;
    Some(rest.split(',').next().unwrap_or(rest).trim())
}

fn named_as_bibliography(sources: &Sources, name: &str) -> bool {
    let stem = name.strip_suffix(".bib").unwrap_or(name);
    sources.places(stem).iter().any(|place| {
        let head = &place.text[..place.start];
        let tail = &place.text[place.end..];
        BIBLIOGRAPHY_LOADERS
            .iter()
            .any(|command| head.contains(command))
            && head.ends_with(['{', ',', ' '])
            && tail.starts_with(['}', ',', ' ', '.'])
    })
}

fn lost_in_entry(file: &SourceFile, first: usize, last: usize, upper: &str) -> Place {
    let search =
        |needle: &str, from: usize| (from..last).find_map(|index| file.found(index, needle, false));
    if let Some(place) = last_command(upper).and_then(|command| search(command, first)) {
        return place;
    }
    let word = upper.rsplit(char::is_whitespace).next().unwrap_or(upper);
    let starts: Vec<usize> = word.char_indices().map(|(index, _)| index).collect();
    let tails = starts.iter().rev().take(MAX_LOST_TAIL).rev();
    let found = tails.clone().find_map(|start| {
        let tail = &word[*start..];
        let from = first + usize::from(tail.chars().nth(1).is_none());
        search(tail, from)
    });
    let found = found.or_else(|| {
        starts
            .last()
            .and_then(|start| search(&word[*start..], first))
    });
    let last = word.chars().next_back().map_or(0, char::len_utf8);
    found.map_or_else(
        || file.place(first, 0, 0),
        |place| Place {
            start: place.end - last,
            ..place
        },
    )
}

fn shipped_bibliography(folders: BuildFolders<'_>, built: &[String], line: u32) -> Option<Place> {
    let index = usize::try_from(line).ok()?.checked_sub(1)?;
    let root = folders.project_dir.canonicalize().ok()?;
    let entries = std::fs::read_dir(folders.compile_dir).ok()?;
    entries.flatten().take(MAX_SOURCE_FILES).find_map(|entry| {
        let path = entry.path().canonicalize().ok()?;
        let lines = (path.extension()? == "bbl").then(|| read_source_lines(&path))??;
        let file = crate::slash_path(path.strip_prefix(&root).ok()?);
        let text = lines.get(index)?.clone();
        (lines == built).then_some(Place {
            file,
            line,
            start: 0,
            end: 0,
            text,
        })
    })
}

#[derive(Default)]
struct Bibliographies {
    files: OnceCell<Vec<SourceFile>>,
}

impl Bibliographies {
    fn entry(
        &self,
        folders: BuildFolders<'_>,
        sources: &Sources,
        key: &str,
    ) -> Option<(&SourceFile, usize)> {
        let files = self.files.get_or_init(|| {
            crate::engine_spec::discover_bibliographies(folders.project_dir)
                .unwrap_or_default()
                .into_iter()
                .filter_map(|name| {
                    let lines = read_source_lines(&folders.project_dir.join(&name))?;
                    Some(SourceFile { name, lines })
                })
                .collect()
        });
        let holds = |file: &SourceFile| {
            file.lines
                .iter()
                .position(|text| entry_key(text) == Some(key))
        };
        let mut found: Vec<(&SourceFile, usize)> = files
            .iter()
            .filter_map(|file| Some((file, holds(file)?)))
            .collect();
        if found.len() > 1 {
            found.retain(|(file, _)| named_as_bibliography(sources, &file.name));
        }
        match found[..] {
            [only] => Some(only),
            _ => None,
        }
    }

    fn place(
        &self,
        folders: BuildFolders<'_>,
        sources: &Sources,
        row: &LogDiagnostic,
    ) -> Option<Place> {
        let name = Path::new(row.file.as_deref()?).file_name()?;
        let line = row.line?;
        let built = read_source_lines(&folders.out_dir.join(name))?;
        let context = context_lines(row);
        let upper = read_so_far(&context, line)?.trim_end();
        let entry = cited_key(&built, usize::try_from(line).ok()?)
            .and_then(|key| self.entry(folders, sources, key));
        let Some((file, first)) = entry else {
            return shipped_bibliography(folders, &built, line);
        };
        let last = file.lines[first + 1..]
            .iter()
            .position(|text| text.trim_start().starts_with('@'))
            .map_or(file.lines.len(), |next| first + 1 + next);
        Some(lost_in_entry(file, first, last, upper))
    }
}

enum Outcome {
    Keep,
    Mark(Place),
    Move(Place),
    Unline,
    Unplace,
    Damaged,
}

fn place_error(
    folders: BuildFolders<'_>,
    sources: &Sources,
    bibliographies: &Bibliographies,
    row: &LogDiagnostic,
) -> Outcome {
    let text = error_text(&row.message);
    let named = row.file.as_deref().map(plain);
    let built = named.is_some_and(|name| sources.is_built(name));
    let file = named.filter(|_| !built).and_then(|name| sources.get(name));
    let moved = if let Some((command, to_the_end)) = scanned_command(text) {
        never_closed(sources, command, to_the_end, file.zip(row.line))
    } else if let Some(stem) = missing_file(text) {
        only(sources.places(&format!("{{{stem}}}")))
            .filter(|place| Some(place.line) != row.line || file.is_none())
    } else if text.starts_with(MISSING_DOLLAR) {
        file.and_then(|file| unclosed_dollar(row, file))
    } else if text.starts_with(UNDEFINED_COMMAND) {
        undefined_command(row, file, sources)
    } else {
        None
    };
    if let Some(place) = moved {
        return Outcome::Move(place);
    }
    if built {
        let name = named.unwrap_or_default();
        if name.ends_with(".bbl") {
            let place = bibliographies.place(folders, sources, row);
            return place.map_or(Outcome::Unplace, Outcome::Move);
        }
        return if name.ends_with(crate::engine_spec::ENTRY_TEX) {
            Outcome::Unplace
        } else {
            Outcome::Damaged
        };
    }
    match (file, named, row.line) {
        (Some(file), _, Some(line)) => {
            reported_place(file, line, &context_lines(row)).map_or(Outcome::Keep, Outcome::Mark)
        }
        (None, Some(name), Some(_)) => {
            match (sources.origin_of(name), loaded_package(sources, name)) {
                (Some(Origin::Outside | Origin::Bundled), Some(place)) => Outcome::Move(place),
                (Some(Origin::Bundled), None) => Outcome::Unline,
                _ => Outcome::Keep,
            }
        }
        _ => Outcome::Keep,
    }
}

fn holds_line(path: &Path, row: &LogDiagnostic) -> bool {
    let context = context_lines(row);
    let read = row.line.and_then(|line| read_so_far(&context, line));
    let read = read.map(|read| read.strip_prefix("...").unwrap_or(read).trim());
    let index = row
        .line
        .and_then(|line| usize::try_from(line).ok()?.checked_sub(1));
    match (read, index, read_source_lines(path)) {
        (Some(read), Some(index), Some(lines)) => {
            !read.is_empty() && lines.get(index).is_some_and(|text| text.contains(read))
        }
        _ => false,
    }
}

fn written_by_this_compile(
    folders: BuildFolders<'_>,
    before: &BuildBefore,
    row: &LogDiagnostic,
) -> bool {
    let (Some(files), Some(name), Ok(out)) = (
        &before.files,
        row.file.as_deref().map(plain),
        folders.out_dir.canonicalize(),
    ) else {
        return false;
    };
    let found = on_disk(folders, name)
        .and_then(|path| path.canonicalize().ok())
        .filter(|path| path.starts_with(&out));
    let Some(path) = found.or_else(|| Some(out.join(Path::new(name).file_name()?))) else {
        return false;
    };
    match files.get(&path) {
        None => true,
        Some(earlier) => stamp(&path).is_some_and(|now| now != *earlier) && holds_line(&path, row),
    }
}

fn utf16(text: &str, index: usize) -> Option<u32> {
    u32::try_from(text.get(..index)?.encode_utf16().count() + 1).ok()
}

fn move_row(row: &mut LogDiagnostic, place: &Place) {
    row.file = Some(format!("./{}", place.file));
    row.line = Some(place.line);
}

fn move_card(error: &mut CompileError, place: &Place) {
    let marked = place.end > place.start;
    error.file = Some(place.file.clone());
    error.line = Some(place.line);
    error.column = utf16(&place.text, place.start).filter(|_| marked);
    error.end_column = utf16(&place.text, place.end).filter(|_| marked);
    error.source_line = error.column.map(|_| place.text.clone());
}

fn unplace_card(error: &mut CompileError) {
    error.file = None;
    error.line = None;
}

fn unplace(row: &mut LogDiagnostic, card: Option<&mut CompileError>) {
    row.file = None;
    row.line = None;
    if let Some(error) = card {
        unplace_card(error);
    }
}

fn name_the_build_file(error: &mut CompileError, written_now: bool) {
    let (code, explanation) = if written_now {
        (BUILD_FILE_UNREADABLE_CODE, BUILD_FILE_UNREADABLE)
    } else {
        (BUILD_FILE_DAMAGED_CODE, BUILD_FILE_DAMAGED)
    };
    unplace_card(error);
    error.code = Some(code.to_owned());
    error.explanation = Some(explanation.to_owned());
}

fn as_row(error: &CompileError) -> LogDiagnostic {
    LogDiagnostic {
        severity: LogSeverity::Error,
        message: error.message.clone(),
        file: error.file.clone(),
        line: error.line,
        category: LogCategory::Error,
        error_context: None,
    }
}

fn pair_cards(errors: &[CompileError], rows: &[LogDiagnostic]) -> Vec<Option<usize>> {
    let mut waiting: HashMap<&str, VecDeque<usize>> = HashMap::new();
    for (index, error) in errors.iter().enumerate() {
        waiting
            .entry(error_text(&error.message))
            .or_default()
            .push_back(index);
    }
    rows.iter()
        .map(|row| {
            if row.severity != LogSeverity::Error {
                return None;
            }
            let queue = waiting.get_mut(error_text(&row.message))?;
            let at = queue
                .iter()
                .position(|index| errors[*index].line == row.line)
                .unwrap_or(0);
            queue.remove(at)
        })
        .collect()
}

fn after_a_missing_file<T>(
    entries: &mut Vec<T>,
    is_error: impl Fn(&T) -> bool,
    place: impl Fn(&T) -> (Option<String>, Option<u32>),
    text: impl Fn(&T) -> &str,
) {
    let mut not_found = HashSet::new();
    entries.retain(|entry| {
        let at = place(entry);
        if !is_error(entry) || at.1.is_none() {
            return true;
        }
        if not_found.contains(&at) {
            return false;
        }
        if missing_file(error_text(text(entry))).is_some() {
            not_found.insert(at);
        }
        true
    });
}

fn is_echo(message: &str) -> bool {
    let text = error_text(message);
    text.starts_with(EMERGENCY_STOP)
        || text.starts_with(NO_PAGES)
        || text.trim_start().starts_with(FATAL_ERROR)
}

fn tidy_cards(errors: &mut Vec<CompileError>) {
    let mut seen = HashSet::new();
    let mut damaged = false;
    errors.retain(|error| {
        let code = error.code.as_deref();
        if code == Some(BUILD_FILE_DAMAGED_CODE) || code == Some(BUILD_FILE_UNREADABLE_CODE) {
            return !std::mem::replace(&mut damaged, true);
        }
        seen.insert((
            error.file.clone(),
            error.line,
            error.message.clone(),
            error.kind.clone(),
            error.code.clone(),
        ))
    });
    let real = |error: &CompileError| error.kind == "error" && !is_echo(&error.message);
    if errors.iter().any(real) {
        errors.retain(|error| error.kind != "error" || !is_echo(&error.message));
    }
}

fn tidy_rows(rows: &mut Vec<LogDiagnostic>) {
    let mut seen = HashSet::new();
    rows.retain(|row| {
        row.severity != LogSeverity::Error
            || seen.insert((row.file.clone(), row.line, row.message.clone()))
    });
    let real = |row: &LogDiagnostic| row.severity == LogSeverity::Error && !is_echo(&row.message);
    if rows.iter().any(real) {
        rows.retain(|row| row.severity != LogSeverity::Error || !is_echo(&row.message));
    }
}

fn label_key(message: &str) -> Option<&str> {
    let (_, rest) = message.split_once("Label `")?;
    let (key, rest) = rest.split_once('\'')?;
    rest.trim_start()
        .starts_with("multiply defined")
        .then_some(key)
}

fn typed_places(sources: &Sources, row: &LogDiagnostic, anywhere: bool) -> Vec<Place> {
    let Some(character) = missing_character_key(&row.message)
        .and_then(code_point)
        .filter(|character| !character.is_ascii())
    else {
        return Vec::new();
    };
    let own = row
        .file
        .as_deref()
        .filter(|name| !anywhere && !sources.is_built(name))
        .and_then(|name| sources.get(name));
    let search = |wanted: char| -> Vec<Place> {
        sources
            .places(wanted.encode_utf8(&mut [0; 4]))
            .into_iter()
            .filter(|place| own.is_none_or(|file| place.file == file.name))
            .collect()
    };
    let typed = search(character);
    let mut places = if typed.is_empty() {
        character
            .to_lowercase()
            .chain(character.to_uppercase())
            .find(|other| *other != character)
            .map(search)
            .unwrap_or_default()
    } else {
        typed
    };
    let from_contents = row
        .file
        .as_deref()
        .is_some_and(|name| CONTENTS_FILES.iter().any(|kind| name.ends_with(kind)));
    let listed = |place: &Place| {
        LISTED_IN_CONTENTS
            .iter()
            .any(|command| place.text.contains(command))
    };
    if from_contents && places.iter().any(listed) {
        places.retain(listed);
    }
    if places.len() > MAX_TYPED_PLACES {
        return Vec::new();
    }
    places
}

fn spread(rows: Vec<LogDiagnostic>, sources: &Sources, log: &str) -> Vec<LogDiagnostic> {
    let anywhere = log
        .lines()
        .take(8)
        .any(|line| line.starts_with("This is Lua"));
    let listed = rows
        .iter()
        .filter(|row| {
            row.category == LogCategory::MissingCharacter
                && !is_nullfont_missing_character(&row.message)
        })
        .count();
    let mut spare = MAX_MISSING_CHARACTER_DIAGNOSTICS.saturating_sub(listed);
    let mut out = Vec::with_capacity(rows.len());
    for row in rows {
        let lost = row.category == LogCategory::MissingCharacter;
        let mut places = if row.line.is_some() {
            Vec::new()
        } else if lost && !is_nullfont_missing_character(&row.message) {
            typed_places(sources, &row, anywhere)
        } else if row.severity == LogSeverity::Warning {
            label_key(&row.message)
                .map(|key| sources.places(&format!("\\label{{{key}}}")))
                .unwrap_or_default()
        } else {
            Vec::new()
        };
        if lost {
            places.truncate(spare + 1);
            spare -= places.len().saturating_sub(1);
        } else {
            places.truncate(MAX_TYPED_PLACES);
        }
        if places.is_empty() {
            out.push(row);
            continue;
        }
        out.extend(places.iter().map(|place| {
            let mut placed = row.clone();
            move_row(&mut placed, place);
            placed
        }));
    }
    out
}

fn float_place(
    sources: &Sources,
    message: &str,
    file: Option<&str>,
    line: Option<u32>,
) -> Option<Place> {
    if message.contains(FLOAT_TOO_LARGE) {
        let file = sources.get(file?)?;
        let (_, rest) = file.line(line?)?.rsplit_once("\\end{")?;
        let name = rest.split('}').next()?;
        return file.above(line? + 1, &format!("\\begin{{{name}}}"), 0);
    }
    if !message.contains(FLOAT_MOVED) || line.is_some() {
        return None;
    }
    let (_, rest) = message.split_once('`')?;
    let specifier = rest.split('\'').next()?;
    only(
        sources
            .places(&format!("}}[{specifier}]"))
            .into_iter()
            .filter(|place| place.text[..place.start].contains("\\begin{"))
            .collect(),
    )
}

fn box_word(text: &str) -> Option<&str> {
    text.split_whitespace()
        .map(|word| word.trim_start_matches("[]"))
        .filter(|word| !word.starts_with('\\') && word.chars().count() >= MIN_BOX_WORD)
        .max_by_key(|word| word.chars().count())
}

fn box_texts(log: &str) -> Vec<(u32, u32, &str)> {
    let mut lines = log.lines().peekable();
    let mut found = Vec::new();
    while let Some(line) = lines.next() {
        if !line.starts_with("Overfull \\") && !line.starts_with("Underfull \\") {
            continue;
        }
        let range = match line.rsplit_once(" in paragraph at lines ") {
            Some((_, range)) => range.split_once("--"),
            None => line
                .rsplit_once(" detected at line ")
                .map(|(_, line)| (line, line)),
        };
        let Some((Ok(first), Ok(last))) =
            range.map(|(first, last)| (first.parse(), last.trim().parse()))
        else {
            continue;
        };
        let text = lines
            .peek()
            .copied()
            .filter(|_| line.contains("\\hbox"))
            .unwrap_or_default();
        found.push((first, last, text));
    }
    found
}

fn place_boxes(sources: &Sources, log: &str, rows: &mut [LogDiagnostic]) {
    let boxes = box_texts(log);
    let bad = rows.iter_mut().filter(|row| {
        row.line.is_some()
            && matches!(
                row.category,
                LogCategory::OverfullBox | LogCategory::UnderfullBox
            )
    });
    let mut searches = MAX_BOX_SEARCHES;
    for (row, (first, last, text)) in bad.zip(boxes) {
        if row.line != Some(first) {
            return;
        }
        let own = row.file.as_deref().and_then(|name| sources.get(name));
        let (Some(own), Some(word)) = (own, box_word(text)) else {
            continue;
        };
        let joined = word.replace('-', "");
        let holds = |line: &String| code_part(line).replace('-', "").contains(&joined);
        let range = first.saturating_sub(1) as usize..(last as usize).min(own.lines.len());
        let mut here = range.filter(|index| holds(&own.lines[*index]));
        if let (Some(index), None) = (here.next(), here.next()) {
            row.line = Some(index as u32 + 1);
            continue;
        }
        if searches == 0 {
            continue;
        }
        searches -= 1;
        let mut typed = sources.files.iter().flat_map(|file| {
            let lines = file.lines.iter().enumerate();
            lines.filter_map(move |(index, line)| holds(line).then_some((file, index)))
        });
        if let (Some((file, index)), None) = (typed.next(), typed.next()) {
            row.file = Some(format!("./{}", file.name));
            row.line = Some(index as u32 + 1);
        }
    }
}

fn echo_of(row: &LogDiagnostic) -> (&str, Option<&str>) {
    let command = context_lines(row).first().copied().and_then(last_command);
    (error_text(&row.message), command)
}

fn place_warning(sources: &Sources, row: &mut LogDiagnostic) {
    let Some(name) = row.file.as_deref().filter(|_| row.line.is_some()) else {
        return;
    };
    let bundled = match sources.origin_of(name) {
        Some(Origin::Bundled) => true,
        Some(Origin::Outside) => false,
        _ => return,
    };
    match loaded_package(sources, plain(name)) {
        Some(place) => move_row(row, &place),
        None if bundled => row.line = None,
        None => {}
    }
}

struct Placing<'a> {
    folders: BuildFolders<'a>,
    before: &'a BuildBefore,
    sources: &'a Sources,
    bibliographies: &'a Bibliographies,
}

impl Placing<'_> {
    fn outcome(&self, row: &LogDiagnostic) -> Outcome {
        place_error(self.folders, self.sources, self.bibliographies, row)
    }

    fn in_a_source(&self, file: Option<&str>) -> bool {
        file.is_some_and(|name| self.sources.get(name).is_some())
    }

    fn row_echoed(&self, diagnostics: &[LogDiagnostic], index: usize) -> bool {
        let echo = echo_of(&diagnostics[index]);
        diagnostics.iter().enumerate().any(|(other, row)| {
            other != index
                && row.severity == LogSeverity::Error
                && echo_of(row) == echo
                && self.in_a_source(row.file.as_deref())
        })
    }

    fn card_echoed(&self, errors: &[CompileError], index: usize) -> bool {
        let text = error_text(&errors[index].message);
        errors.iter().enumerate().any(|(other, error)| {
            other != index
                && error.kind == "error"
                && error_text(&error.message) == text
                && self.in_a_source(error.file.as_deref())
        })
    }

    fn place_row(
        &self,
        index: usize,
        card: Option<&mut CompileError>,
        diagnostics: &mut [LogDiagnostic],
    ) -> bool {
        match self.outcome(&diagnostics[index]) {
            Outcome::Keep => {}
            Outcome::Mark(place) => {
                card.into_iter().for_each(|error| move_card(error, &place));
            }
            Outcome::Move(place) => {
                move_row(&mut diagnostics[index], &place);
                card.into_iter().for_each(|error| move_card(error, &place));
            }
            Outcome::Unline => {
                diagnostics[index].line = None;
                card.into_iter().for_each(|error| error.line = None);
            }
            Outcome::Unplace => unplace(&mut diagnostics[index], card),
            Outcome::Damaged => {
                if self.row_echoed(diagnostics, index) {
                    return true;
                }
                let written =
                    written_by_this_compile(self.folders, self.before, &diagnostics[index]);
                unplace(&mut diagnostics[index], None);
                card.into_iter()
                    .for_each(|error| name_the_build_file(error, written));
            }
        }
        false
    }

    fn place_lone_card(&self, index: usize, errors: &mut [CompileError]) -> bool {
        let row = as_row(&errors[index]);
        match self.outcome(&row) {
            Outcome::Keep => {}
            Outcome::Mark(place) | Outcome::Move(place) => move_card(&mut errors[index], &place),
            Outcome::Unline => errors[index].line = None,
            Outcome::Unplace => unplace_card(&mut errors[index]),
            Outcome::Damaged => {
                if self.card_echoed(errors, index) {
                    return true;
                }
                let written = written_by_this_compile(self.folders, self.before, &row);
                name_the_build_file(&mut errors[index], written);
            }
        }
        false
    }
}

fn drop_marked<T>(entries: &mut Vec<T>, dropped: &HashSet<usize>) {
    let mut index = 0;
    entries.retain(|_| {
        index += 1;
        !dropped.contains(&(index - 1))
    });
}

fn place_floats(sources: &Sources, errors: &mut [CompileError], diagnostics: &mut [LogDiagnostic]) {
    for error in errors.iter_mut() {
        let file = error.file.as_deref();
        if let Some(place) = float_place(sources, &error.message, file, error.line) {
            error.file = Some(place.file);
            error.line = Some(place.line);
        }
    }
    for row in diagnostics.iter_mut() {
        let file = row.file.as_deref();
        if let Some(place) = float_place(sources, &row.message, file, row.line) {
            move_row(row, &place);
        }
    }
}

/// TeX reports where it noticed a problem. For the body of `align`, a beamer
/// frame, `tabularx` or a long argument that is the closing line, and for a
/// file it wrote itself it is that file.
pub fn place_in_sources(
    folders: BuildFolders<'_>,
    before: &BuildBefore,
    log: &str,
    errors: &mut Vec<CompileError>,
    diagnostics: &mut Vec<LogDiagnostic>,
) {
    rejoin_wrapped_names(folders, log, errors, diagnostics);
    after_a_missing_file(
        errors,
        |error| error.kind == "error",
        |error| {
            (
                error.file.as_deref().map(|name| plain(name).to_owned()),
                error.line,
            )
        },
        |error| &error.message,
    );
    after_a_missing_file(
        diagnostics,
        |row| row.severity == LogSeverity::Error,
        |row| {
            (
                row.file.as_deref().map(|name| plain(name).to_owned()),
                row.line,
            )
        },
        |row| &row.message,
    );
    let named: Vec<&str> = errors
        .iter()
        .filter_map(|error| error.file.as_deref())
        .chain(diagnostics.iter().filter_map(|row| row.file.as_deref()))
        .collect();
    let sources = Sources::read(folders, log, &named);
    let bibliographies = Bibliographies::default();
    let placing = Placing {
        folders,
        before,
        sources: &sources,
        bibliographies: &bibliographies,
    };
    let pairs = pair_cards(errors, diagnostics);
    let mut dropped_rows = HashSet::new();
    let mut dropped_cards = HashSet::new();
    for index in 0..diagnostics.len() {
        let card = pairs[index];
        match diagnostics[index].severity {
            LogSeverity::Error => {
                let error = card.map(|card| &mut errors[card]);
                if placing.place_row(index, error, diagnostics) {
                    dropped_rows.insert(index);
                    dropped_cards.extend(card);
                }
            }
            LogSeverity::Warning => place_warning(&sources, &mut diagnostics[index]),
            _ => {}
        }
    }
    let paired: HashSet<usize> = pairs.iter().flatten().copied().collect();
    for index in 0..errors.len() {
        let lone = errors[index].kind == "error" && !paired.contains(&index);
        if lone && placing.place_lone_card(index, errors) {
            dropped_cards.insert(index);
        }
    }
    drop_marked(diagnostics, &dropped_rows);
    drop_marked(errors, &dropped_cards);
    place_floats(&sources, errors, diagnostics);
    place_boxes(&sources, log, diagnostics);
    *diagnostics = spread(std::mem::take(diagnostics), &sources, log);
    let built = |row: &&mut LogDiagnostic| {
        row.file
            .as_deref()
            .is_some_and(|name| sources.is_built(name))
    };
    for row in diagnostics.iter_mut().filter(built) {
        row.file = None;
        row.line = None;
    }
    tidy_rows(diagnostics);
    tidy_cards(errors);
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Project {
        folder: tempfile::TempDir,
        before: BuildBefore,
    }

    impl Project {
        fn new(files: &[(&str, &str)]) -> Self {
            let folder = tempfile::tempdir().unwrap();
            for (name, text) in files {
                let path = folder.path().join(name);
                std::fs::create_dir_all(path.parent().unwrap()).unwrap();
                std::fs::write(path, text).unwrap();
            }
            std::fs::create_dir_all(folder.path().join("build")).unwrap();
            Self {
                folder,
                before: BuildBefore::default(),
            }
        }

        fn place(&self, log: &str, errors: &mut Vec<CompileError>, rows: &mut Vec<LogDiagnostic>) {
            let build = self.folder.path().join("build");
            let folders = BuildFolders {
                project_dir: self.folder.path(),
                compile_dir: self.folder.path(),
                out_dir: &build,
            };
            place_in_sources(folders, &self.before, log, errors, rows);
        }
    }

    fn row(file: Option<&str>, line: Option<u32>, context: &[&str]) -> LogDiagnostic {
        let message = context[0].trim_start_matches("! ").to_owned();
        LogDiagnostic {
            severity: LogSeverity::Error,
            message,
            file: file.map(str::to_owned),
            line,
            category: LogCategory::Error,
            error_context: Some(context.join("\n")),
        }
    }

    fn card(file: Option<&str>, line: Option<u32>, message: &str) -> CompileError {
        CompileError {
            line,
            file: file.map(str::to_owned),
            message: message.to_owned(),
            kind: "error".to_owned(),
            explanation: Some("explained".to_owned()),
            code: Some("tex.explain.some".to_owned()),
            ..Default::default()
        }
    }

    fn warning(file: &str, line: Option<u32>, message: &str) -> LogDiagnostic {
        LogDiagnostic {
            severity: LogSeverity::Warning,
            message: message.to_owned(),
            file: Some(file.to_owned()),
            line,
            category: LogCategory::PackageWarning,
            error_context: None,
        }
    }

    fn lost(file: &str, line: Option<u32>, character: char, font: &str) -> LogDiagnostic {
        LogDiagnostic {
            severity: LogSeverity::Warning,
            message: format!(
                "Missing character: There is no {character} (U+{:04X}) in font {font}!",
                character as u32
            ),
            file: Some(file.to_owned()),
            line,
            category: LogCategory::MissingCharacter,
            error_context: None,
        }
    }

    fn at(rows: &[LogDiagnostic]) -> Vec<(Option<&str>, Option<u32>)> {
        rows.iter()
            .map(|row| (row.file.as_deref(), row.line))
            .collect()
    }

    const UNDEFINED: &str = "Undefined control sequence.";

    #[test]
    fn an_error_inside_a_collected_body_moves_from_the_closing_line_to_its_own() {
        let project = Project::new(&[(
            "main.tex",
            "\\documentclass{article}\n\\begin{document}\n\\begin{align}\n  a &= b \\\\\n  d &= \\undefinedalign + e\n\\end{align}\n\\begin{frame}\n  Second \\undefinedinframe line.\n\\end{frame}\n\\end{document}\n",
        )]);
        let mut rows = vec![
            row(
                Some("./main.tex"),
                Some(6),
                &[
                    "! Undefined control sequence.",
                    "<argument>  a &= b \\\\ d &= \\undefinedalign ",
                    "l.6 \\end{align}",
                ],
            ),
            row(
                Some("./main.tex"),
                Some(9),
                &[
                    "! Undefined control sequence.",
                    "\\beamer@doifinframe ...r Second \\undefinedinframe ",
                    "l.9 \\end{frame}",
                ],
            ),
        ];
        let mut errors = vec![
            card(Some("main.tex"), Some(6), UNDEFINED),
            card(Some("main.tex"), Some(9), UNDEFINED),
        ];
        project.place("(./main.tex)", &mut errors, &mut rows);
        assert_eq!(
            at(&rows),
            [(Some("./main.tex"), Some(5)), (Some("./main.tex"), Some(8))]
        );
        assert_eq!(
            (errors[0].line, errors[0].column, errors[0].end_column),
            (Some(5), Some(8), Some(23))
        );
        assert_eq!(
            errors[0].source_line.as_deref(),
            Some("  d &= \\undefinedalign + e")
        );
        assert_eq!(errors[1].line, Some(8));
    }

    #[test]
    fn an_error_inside_a_command_moves_to_where_the_command_is_written() {
        let project = Project::new(&[(
            "main.tex",
            "\\documentclass{article}\n\\newcommand{\\myterm}{\\undefinedinner}\n\\begin{document}\nFirst use: \\myterm.\n\nSecond use: \\myterm.\n\\end{document}\n",
        )]);
        let use_of = |line: u32, text: &str| {
            row(
                Some("./main.tex"),
                Some(line),
                &[
                    "! Undefined control sequence.",
                    "\\myterm ->\\undefinedinner ",
                    text,
                ],
            )
        };
        let mut rows = vec![
            use_of(4, "l.4 First use: \\myterm"),
            use_of(6, "l.6 Second use: \\myterm"),
        ];
        let mut errors = vec![
            card(Some("main.tex"), Some(4), UNDEFINED),
            card(Some("main.tex"), Some(6), UNDEFINED),
        ];
        project.place("(./main.tex)", &mut errors, &mut rows);
        assert_eq!(at(&rows), [(Some("./main.tex"), Some(2))]);
        assert_eq!(errors.len(), 1);
        assert_eq!(errors[0].line, Some(2));
    }

    #[test]
    fn an_error_on_its_own_line_gets_a_mark_under_what_tex_just_read() {
        let project = Project::new(&[(
            "chapters/one.tex",
            "\\chapter{One}\nA \\undefinedinchapter command and c & d.\n",
        )]);
        let mut rows = vec![
            row(
                Some("./chapters/one.tex"),
                Some(2),
                &[
                    "! Undefined control sequence.",
                    "l.2 A \\undefinedinchapter",
                ],
            ),
            row(
                Some("./chapters/one.tex"),
                Some(2),
                &[
                    "! Misplaced alignment tab character &.",
                    "l.2 ...finedinchapter command and c &",
                ],
            ),
        ];
        let mut errors = vec![
            card(Some("chapters/one.tex"), Some(2), UNDEFINED),
            card(
                Some("chapters/one.tex"),
                Some(2),
                "Misplaced alignment tab character &.",
            ),
        ];
        project.place("", &mut errors, &mut rows);
        assert_eq!(
            at(&rows),
            [
                (Some("./chapters/one.tex"), Some(2)),
                (Some("./chapters/one.tex"), Some(2))
            ]
        );
        assert_eq!(
            (errors[0].column, errors[0].end_column),
            (Some(3), Some(22))
        );
        assert_eq!(
            (errors[1].column, errors[1].end_column),
            (Some(37), Some(38))
        );
    }

    #[test]
    fn math_that_is_never_closed_points_at_its_dollar() {
        let project = Project::new(&[(
            "main.tex",
            "\\begin{document}\nPrice is \\$5 and $x = 1 with no end.\n\nNext.\n\\end{document}\n",
        )]);
        let mut rows = vec![row(
            Some("./main.tex"),
            Some(3),
            &["! Missing $ inserted.", "<inserted text> ", "l.3"],
        )];
        let mut errors = vec![card(Some("main.tex"), Some(3), "Missing $ inserted.")];
        project.place("(./main.tex)", &mut errors, &mut rows);
        assert_eq!(at(&rows), [(Some("./main.tex"), Some(2))]);
        assert_eq!(
            (errors[0].line, errors[0].column, errors[0].end_column),
            (Some(2), Some(18), Some(19))
        );
    }

    #[test]
    fn a_brace_that_is_never_closed_is_found_from_the_wrapper_or_from_nowhere() {
        let source = "\\begin{document}\nFine \\textbf{closed} text.\nSome \\textbf{bold that never closes\nand goes on.\n\nNext.\n\\end{document}\n";
        let scanning = "File ended while scanning use of \\textbf .";
        let project = Project::new(&[("main.tex", source)]);
        let mut rows = vec![row(
            Some("./_oleafly_entry.tex"),
            Some(28),
            &[
                "! File ended while scanning use of \\textbf .",
                "<inserted text> ",
                "l.28 \\input{\\detokenize{main.tex}}",
            ],
        )];
        let mut errors = vec![card(Some("_oleafly_entry.tex"), Some(28), scanning)];
        project.place("(_oleafly_entry.tex (main.tex", &mut errors, &mut rows);
        assert_eq!(at(&rows), [(Some("./main.tex"), Some(3))]);
        assert_eq!(
            (errors[0].file.as_deref(), errors[0].line, errors[0].column),
            (Some("main.tex"), Some(3), Some(6))
        );

        let mut rows = vec![row(
            Some("main.tex"),
            None,
            &[
                "! Paragraph ended before \\textbf was complete.",
                "<to be read again> ",
            ],
        )];
        let mut errors = vec![card(
            None,
            None,
            "Paragraph ended before \\textbf was complete.",
        )];
        project.place("(./main.tex", &mut errors, &mut rows);
        assert_eq!(at(&rows), [(Some("./main.tex"), Some(3))]);
        assert_eq!(errors[0].line, Some(3));
    }

    #[test]
    fn an_error_in_the_built_bibliography_moves_to_the_entry_in_the_bib_file() {
        let project = Project::new(&[
            ("main.tex", "\\cite{amp01}\n"),
            (
                "refs/all.bib",
                "@article{other,\n  title = {A & B},\n}\n@article{amp01,\n  author = {A. Author},\n  title = {Research & Development},\n}\n",
            ),
            (
                "build/_oleafly_entry.bbl",
                "\\begin{thebibliography}{1}\n\n\\bibitem[Author and Someone Else With A Long Name(2001)Author and\n  Else]{amp01}\nA.~Author.\n\\newblock Research & development.\n\\end{thebibliography}\n",
            ),
        ]);
        let mut rows = vec![row(
            Some("./_oleafly_entry.bbl"),
            Some(6),
            &[
                "! Misplaced alignment tab character &.",
                "l.6 \\newblock Research &",
            ],
        )];
        let mut errors = vec![card(
            Some("_oleafly_entry.bbl"),
            Some(6),
            "Misplaced alignment tab character &.",
        )];
        project.place("(./main.tex)", &mut errors, &mut rows);
        assert_eq!(at(&rows), [(Some("./refs/all.bib"), Some(6))]);
        assert_eq!(
            (errors[0].file.as_deref(), errors[0].line, errors[0].column),
            (Some("refs/all.bib"), Some(6), Some(21))
        );
        assert_eq!(errors[0].code.as_deref(), Some("tex.explain.some"));
    }

    #[test]
    fn a_damaged_build_file_gets_one_card_that_names_no_file() {
        let project = Project::new(&[("main.tex", "\\begin{document}\nText.\n\\end{document}\n")]);
        let mut rows = vec![
            row(
                Some("/home/u/.oleafly/linked/linked-1/build/_oleafly_entry.aux"),
                Some(42),
                &["! Undefined control sequence.", "l.42 \\newlabe"],
            ),
            row(
                Some("/home/u/.oleafly/linked/linked-1/build/_oleafly_entry.aux"),
                Some(42),
                &["! Missing \\begin{document}.", "l.42 \\newlabe"],
            ),
        ];
        let mut errors = vec![
            card(
                Some("/home/u/.oleafly/linked/linked-1/build/_oleafly_entry.aux"),
                Some(42),
                UNDEFINED,
            ),
            card(
                Some("/home/u/.oleafly/linked/linked-1/build/_oleafly_entry.aux"),
                Some(42),
                "Missing \\begin{document}.",
            ),
        ];
        project.place("(./main.tex", &mut errors, &mut rows);
        assert_eq!(at(&rows), [(None, None), (None, None)]);
        assert_eq!(errors.len(), 1);
        assert_eq!(
            (
                errors[0].file.as_deref(),
                errors[0].line,
                errors[0].code.as_deref()
            ),
            (None, None, Some(BUILD_FILE_DAMAGED_CODE))
        );
        assert_eq!(errors[0].explanation.as_deref(), Some(BUILD_FILE_DAMAGED));
    }

    #[test]
    fn an_error_repeated_from_the_contents_file_is_listed_once_at_its_heading() {
        let project = Project::new(&[(
            "main.tex",
            "\\begin{document}\n\\tableofcontents\n\\section{Bad \\undefinedtitle title}\n\\end{document}\n",
        )]);
        let unicode = "Unicode character \u{26a} (U+026A)";
        let mut rows = vec![
            row(
                Some("./.oleafly/build/_oleafly_entry.toc"),
                Some(1),
                &[
                    &format!("! LaTeX Error: {unicode}"),
                    "l.1 ...line {section}{x}",
                ],
            ),
            row(
                Some("./main.tex"),
                Some(3),
                &[&format!("! LaTeX Error: {unicode}"), "l.3 \\section{Bad"],
            ),
            row(
                Some("./.oleafly/build/_oleafly_entry.toc"),
                Some(1),
                &[
                    "! Undefined control sequence.",
                    "l.1 ...{section}{\\numberline {1}Bad \\undefinedtitle",
                ],
            ),
        ];
        let mut errors = vec![
            card(
                Some(".oleafly/build/_oleafly_entry.toc"),
                Some(1),
                &format!("LaTeX Error: {unicode}"),
            ),
            card(
                Some("main.tex"),
                Some(3),
                &format!("LaTeX Error: {unicode}"),
            ),
            card(
                Some(".oleafly/build/_oleafly_entry.toc"),
                Some(1),
                UNDEFINED,
            ),
        ];
        project.place("(./main.tex)", &mut errors, &mut rows);
        assert_eq!(
            at(&rows),
            [(Some("./main.tex"), Some(3)), (Some("./main.tex"), Some(3))]
        );
        assert_eq!(errors.len(), 2);
        assert!(errors
            .iter()
            .all(|error| error.file.as_deref() == Some("main.tex") && error.line == Some(3)));
        assert!(errors
            .iter()
            .all(|error| error.code.as_deref() == Some("tex.explain.some")));
    }

    #[test]
    fn a_label_defined_twice_lists_both_places() {
        let project = Project::new(&[
            (
                "main.tex",
                "\\section{One}\\label{sec:a}\n\\input{two}\n% \\label{sec:a}\n",
            ),
            ("two.tex", "\\section{Two}\\label{sec:a}\n"),
        ]);
        let mut rows = vec![warning(
            "./_oleafly_entry.aux",
            None,
            "LaTeX: Label `sec:a' multiply defined.",
        )];
        project.place("(./main.tex (./two.tex))", &mut Vec::new(), &mut rows);
        assert_eq!(
            at(&rows),
            [(Some("./main.tex"), Some(1)), (Some("./two.tex"), Some(1))]
        );
    }

    #[test]
    fn a_missing_character_with_no_line_is_looked_up_where_it_is_typed() {
        let project = Project::new(&[
            (
                "main.tex",
                "\\chapter{Sounds \u{26a}}\n\\newcommand{\\long}{\u{2d0}}\nA vowel i\u{2d0} and a\\long.\n\\input{phon}\naaaa\n",
            ),
            ("phon.tex", "Has \u{251} here.\n"),
        ]);
        let regular = "[lmroman10-regular]:mapping=tex-text;";
        let mut rows = vec![
            lost("./main.tex", None, '\u{2d0}', regular),
            lost(
                "./main.tex",
                None,
                '\u{a7ae}',
                "[lmromanslant10-regular]:mapping=tex-text;",
            ),
            lost(
                "./_oleafly_entry.toc",
                None,
                '\u{26a}',
                "[lmroman10-bold]:mapping=tex-text;",
            ),
            lost("./main.tex", None, '\u{251}', regular),
            lost("./main.tex", None, 'a', "nullfont"),
        ];
        project.place(
            "This is XeTeX\n(./main.tex (./phon.tex))",
            &mut Vec::new(),
            &mut rows,
        );
        assert_eq!(
            at(&rows),
            [
                (Some("./main.tex"), Some(2)),
                (Some("./main.tex"), Some(3)),
                (Some("./main.tex"), Some(1)),
                (Some("./main.tex"), Some(1)),
                (Some("./main.tex"), None),
                (Some("./main.tex"), None),
            ]
        );

        let mut rows = vec![lost(
            "./main.tex",
            None,
            '\u{251}',
            "[lmroman10-regular]:+tlig;",
        )];
        project.place(
            "This is LuaHBTeX, Version 1.21.0\n(./main.tex (./phon.tex))",
            &mut Vec::new(),
            &mut rows,
        );
        assert_eq!(at(&rows), [(Some("./phon.tex"), Some(1))]);
    }

    #[test]
    fn a_character_lost_in_the_contents_list_is_looked_up_in_the_headings() {
        let project = Project::new(&[(
            "main.tex",
            "\\tableofcontents\n\\section{Vowels like \u{251}}\nBody has \u{251} too.\n",
        )]);
        let font = "[lmroman10-bold]:mapping=tex-text;";
        let mut rows = vec![
            lost("./build/_oleafly_entry.toc", None, '\u{251}', font),
            lost("./build/_oleafly_entry.toc", None, '\u{292}', font),
        ];
        project.place("(./main.tex)", &mut Vec::new(), &mut rows);
        assert_eq!(at(&rows), [(Some("./main.tex"), Some(2)), (None, None)]);
    }

    #[test]
    fn a_character_typed_all_over_the_document_is_not_given_a_line() {
        let text = "caf\u{e9}\n".repeat(MAX_TYPED_PLACES + 1);
        let project = Project::new(&[("main.tex", &text)]);
        let mut rows = vec![lost("./main.tex", None, '\u{e9}', "[x]:y;")];
        project.place("(./main.tex)", &mut Vec::new(), &mut rows);
        assert_eq!(at(&rows), [(Some("./main.tex"), None)]);
    }

    #[test]
    fn a_warning_from_inside_a_package_points_at_the_line_that_loads_it() {
        let project = Project::new(&[(
            "main.tex",
            "\\documentclass{article}\n\\usepackage{amsmath, shellesc}\n\\usepackage{hyperref}\n",
        )]);
        let mut rows = vec![
            warning(
                "./shellesc.sty",
                Some(73),
                "Package shellesc: Shell escape disabled.",
            ),
            warning(
                "./pdftexcmds.sty",
                Some(12),
                "Package pdftexcmds: Something.",
            ),
            warning("./main.tex", Some(3), "Package hyperref: Stays."),
        ];
        project.place(
            "(./main.tex (shellesc.sty) (pdftexcmds.sty))",
            &mut Vec::new(),
            &mut rows,
        );
        assert_eq!(
            at(&rows),
            [
                (Some("./main.tex"), Some(2)),
                (Some("./pdftexcmds.sty"), None),
                (Some("./main.tex"), Some(3)),
            ]
        );
    }

    #[test]
    fn what_follows_a_file_that_is_not_found_on_the_same_line_is_left_out() {
        let project = Project::new(&[(
            "main.tex",
            "\\documentclass{article}\n\\usepackage{nosuchpackagexyz}\n\\begin{document}\n\\end{document}\n",
        )]);
        let not_found = "! LaTeX Error: File `nosuchpackagexyz.sty' not found..";
        let mut rows = vec![
            row(
                Some("./main.tex"),
                Some(3),
                &[
                    &format!("! {not_found}"),
                    "\\@missingfileerror ...or: File `#1.#2' not found.}",
                    "l.3 \\begin",
                ],
            ),
            row(
                Some("./main.tex"),
                Some(3),
                &[
                    "! Undefined control sequence.",
                    "<argument> @pkg-disable@\\@currname ",
                    "l.3 \\begin",
                ],
            ),
        ];
        let mut errors = vec![card(Some("main.tex"), Some(3), not_found)];
        errors.extend((0..40).map(|_| card(Some("main.tex"), Some(3), UNDEFINED)));
        errors.push(card(
            Some("main.tex"),
            Some(3),
            "LaTeX Error: The package . failed to load.",
        ));
        project.place("(./main.tex", &mut errors, &mut rows);
        assert_eq!(at(&rows), [(Some("./main.tex"), Some(2))]);
        assert_eq!(errors.len(), 1);
        assert_eq!(
            (errors[0].message.as_str(), errors[0].line),
            (not_found, Some(2))
        );
    }

    #[test]
    fn the_stop_that_follows_an_error_is_only_shown_when_it_is_all_there_is() {
        let project = Project::new(&[("main.tex", "\\input{nofile}\n")]);
        let stop = "Emergency stop.";
        let fatal = " ==> Fatal error occurred, no output PDF file produced!";
        let mut rows = vec![
            row(
                Some("main.tex"),
                None,
                &["! LaTeX Error: File `nofile.tex' not found."],
            ),
            row(
                Some("./main.tex"),
                Some(1),
                &["! Emergency stop.", "<read *> "],
            ),
            row(
                Some("main.tex"),
                None,
                &["!  ==> Fatal error occurred, no output PDF file produced!"],
            ),
        ];
        let mut errors = vec![
            card(
                Some("main.tex"),
                Some(1),
                "LaTeX Error: File `nofile.tex' not found.",
            ),
            card(Some("main.tex"), Some(1), stop),
            card(Some("main.tex"), None, fatal),
        ];
        project.place("(./main.tex", &mut errors, &mut rows);
        assert_eq!(at(&rows), [(Some("./main.tex"), Some(1))]);
        assert_eq!(errors.len(), 1);
        assert_eq!(errors[0].line, Some(1));

        let mut rows = vec![row(
            Some("./main.tex"),
            Some(1),
            &["! Emergency stop.", "<*> main.tex"],
        )];
        let mut errors = vec![card(None, None, stop)];
        project.place("(./main.tex", &mut errors, &mut rows);
        assert_eq!((rows.len(), errors.len()), (1, 1));
    }

    #[test]
    fn a_float_warning_points_at_the_float() {
        let project = Project::new(&[(
            "main.tex",
            "Text.\n\\begin{figure}[h]\n\\rule{5cm}{9cm}\n\\end{figure}\n\\begin{table}[p]\n\\rule{5cm}{30cm}\n\\caption{Tall}\n\\end{table}\n",
        )]);
        let large = "LaTeX Warning: Float too large for page by 134.0583pt on input line 8.";
        let moved = "LaTeX Warning: `h' float specifier changed to `ht'.";
        let mut errors = vec![
            card(Some("main.tex"), Some(8), large),
            card(Some("main.tex"), None, moved),
        ];
        let mut rows = vec![
            warning(
                "./main.tex",
                Some(8),
                "LaTeX: Float too large for page by 134.0583pt.",
            ),
            warning(
                "./main.tex",
                None,
                "LaTeX: `h' float specifier changed to `ht'.",
            ),
        ];
        project.place("(./main.tex)", &mut errors, &mut rows);
        assert_eq!(
            at(&rows),
            [(Some("./main.tex"), Some(5)), (Some("./main.tex"), Some(2))]
        );
        assert_eq!((errors[0].line, errors[1].line), (Some(5), Some(2)));
    }

    #[test]
    fn a_line_that_is_too_wide_is_found_by_its_own_words() {
        let long = "C".repeat(40);
        let project = Project::new(&[
            ("main.tex", "\\include{chapters/two}\nMore.\n"),
            (
                "chapters/two.tex",
                &format!("\\chapter{{Two}}\nSee this.\n{long}\n"),
            ),
            (
                "solo.tex",
                "A paragraph with\nan unbreakable-word-that-is-long\nthat overflows.\n",
            ),
        ]);
        let log = format!(
            "(./main.tex (./chapters/two.tex)\nOverfull \\hbox (182.06pt too wide) in paragraph at lines 2--5\n\\TU/lmr/m/n/10 {long}\n []\n\n(./solo.tex\nOverfull \\hbox (9.0pt too wide) in paragraph at lines 1--3\n[]\\TU/lmr/m/n/10 A para-graph with an un-break-able-word-that-is-long that\n"
        );
        let too_wide = |file: &str, line: u32| LogDiagnostic {
            severity: LogSeverity::Typesetting,
            message: "Overfull \\hbox (9.0pt too wide)".to_owned(),
            file: Some(file.to_owned()),
            line: Some(line),
            category: LogCategory::OverfullBox,
            error_context: None,
        };
        let mut rows = vec![too_wide("./main.tex", 2), too_wide("./solo.tex", 1)];
        project.place(&log, &mut Vec::new(), &mut rows);
        assert_eq!(
            at(&rows),
            [
                (Some("./chapters/two.tex"), Some(3)),
                (Some("./solo.tex"), Some(2))
            ]
        );
    }

    #[test]
    fn a_warning_left_in_a_build_file_names_no_file() {
        let project = Project::new(&[("main.tex", "\\cite{missingkey}\n")]);
        let mut rows = vec![warning(
            "./.oleafly/build/_oleafly_entry.bbl",
            None,
            "Package biblatex: The following entry could not be found",
        )];
        project.place("(./main.tex)", &mut Vec::new(), &mut rows);
        assert_eq!(at(&rows), [(None, None)]);
    }

    #[test]
    fn a_project_file_the_log_never_opened_keeps_its_place() {
        let project = Project::new(&[("deep/part.tex", "one\ntwo \\badcommand here\n")]);
        let mut rows = vec![row(
            Some("./deep/part.tex"),
            Some(2),
            &["! Undefined control sequence.", "l.2 two \\badcommand"],
        )];
        let mut errors = vec![card(Some("deep/part.tex"), Some(2), UNDEFINED)];
        project.place("", &mut errors, &mut rows);
        assert_eq!(at(&rows), [(Some("./deep/part.tex"), Some(2))]);
        assert_eq!(
            (errors[0].file.as_deref(), errors[0].line, errors[0].column),
            (Some("deep/part.tex"), Some(2), Some(5))
        );
    }

    #[test]
    fn a_file_that_cannot_be_looked_up_keeps_the_place_the_log_gave() {
        let nowhere = Path::new("");
        let folders = BuildFolders {
            project_dir: nowhere,
            compile_dir: nowhere,
            out_dir: nowhere,
        };
        let mut rows = vec![
            row(
                Some("main.tex"),
                Some(33),
                &["! Undefined control sequence.", "l.33 \\foo"],
            ),
            warning("main.tex", Some(10), "Reference `fig:x' undefined"),
        ];
        let mut errors = vec![card(Some("main.tex"), Some(33), UNDEFINED)];
        place_in_sources(
            folders,
            &BuildBefore::default(),
            "(./main.tex",
            &mut errors,
            &mut rows,
        );
        assert_eq!(
            at(&rows),
            [(Some("main.tex"), Some(33)), (Some("main.tex"), Some(10))]
        );
        assert_eq!(
            (errors[0].file.as_deref(), errors[0].line),
            (Some("main.tex"), Some(33))
        );
    }

    #[test]
    fn a_working_file_of_an_included_chapter_counts_as_a_build_file() {
        let project = Project::new(&[
            ("main.tex", "\\include{sections/intro}\n"),
            ("build/sections/intro.aux", "\\relax \n\\newlabe"),
        ]);
        let mut rows = vec![
            row(
                Some("./build/sections/intro.aux"),
                Some(2),
                &["! Undefined control sequence.", "l.2 \\newlabe"],
            ),
            warning(
                "./build/sections/intro.aux",
                Some(2),
                "Package x: Left over.",
            ),
        ];
        let mut errors = vec![card(Some("build/sections/intro.aux"), Some(2), UNDEFINED)];
        project.place("(./main.tex", &mut errors, &mut rows);
        assert_eq!(at(&rows), [(None, None), (None, None)]);
        assert_eq!(
            (
                errors[0].file.as_deref(),
                errors[0].line,
                errors[0].code.as_deref()
            ),
            (None, None, Some(BUILD_FILE_DAMAGED_CODE))
        );
    }

    #[test]
    fn a_card_with_no_row_is_still_taken_off_a_build_file() {
        let project = Project::new(&[("main.tex", "Text.\n")]);
        let mut errors = vec![
            card(
                Some(".oleafly/build/_oleafly_entry.aux"),
                Some(2),
                UNDEFINED,
            ),
            card(Some("main.tex"), Some(1), "Missing $ inserted."),
        ];
        project.place("(./main.tex)", &mut errors, &mut Vec::new());
        assert_eq!(
            (
                errors[0].file.as_deref(),
                errors[0].line,
                errors[0].code.as_deref()
            ),
            (None, None, Some(BUILD_FILE_DAMAGED_CODE))
        );
        assert_eq!(
            (errors[1].file.as_deref(), errors[1].line),
            (Some("main.tex"), Some(1))
        );
    }

    fn boxed(file: &str, line: u32) -> LogDiagnostic {
        LogDiagnostic {
            severity: LogSeverity::Typesetting,
            message: "Overfull \\hbox (15.0pt too wide)".to_owned(),
            file: Some(file.to_owned()),
            line: Some(line),
            category: LogCategory::OverfullBox,
            error_context: None,
        }
    }

    fn aux_error(file: &str, text: &str) -> (Vec<CompileError>, Vec<LogDiagnostic>) {
        let read = format!("l.2 {text}");
        let rows = vec![row(
            Some(file),
            Some(2),
            &["! Undefined control sequence.", &read],
        )];
        (vec![card(Some(file), Some(2), UNDEFINED)], rows)
    }

    #[test]
    fn a_project_file_past_the_file_limit_keeps_its_place() {
        let names: Vec<String> = (0..=MAX_SOURCE_FILES)
            .map(|index| format!("part{index}.tex"))
            .collect();
        let files: Vec<(&str, &str)> = names.iter().map(|name| (name.as_str(), "text\n")).collect();
        let project = Project::new(&files);
        let log: String = names.iter().map(|name| format!("(./{name})")).collect();
        let last = format!("./{}", names[MAX_SOURCE_FILES]);
        let mut rows = vec![
            row(
                Some(&last),
                Some(7),
                &["! Undefined control sequence.", "l.7 \\foo"],
            ),
            warning(&last, Some(9), "Package hyperref: Something."),
        ];
        project.place(&log, &mut Vec::new(), &mut rows);
        assert_eq!(
            at(&rows),
            [
                (Some(last.as_str()), Some(7)),
                (Some(last.as_str()), Some(9))
            ]
        );
    }

    #[test]
    fn a_file_name_the_log_wrapped_is_put_back_together() {
        let project = Project::new(&[
            ("main.tex", "Text.\n"),
            ("build/_oleafly_entry.aux", "\\relax \n\\newlabe"),
        ]);
        let root = project.folder.path().canonicalize().unwrap();
        let aux = root.join("build/_oleafly_entry.aux");
        let aux = aux.to_str().unwrap();
        let (cut, rest) = aux.split_at(aux.len() - 12);
        let log = format!("(./main.tex\n({cut}\n{rest}\n! Undefined control sequence.\n");
        let (mut errors, mut rows) = aux_error(cut, "\\newlabe");
        project.place(&log, &mut errors, &mut rows);
        assert_eq!(at(&rows), [(None, None)]);
        assert_eq!(
            (errors[0].file.as_deref(), errors[0].code.as_deref()),
            (None, Some(BUILD_FILE_DAMAGED_CODE))
        );
    }

    #[test]
    fn a_name_that_ends_like_an_extension_still_finds_its_tex_file() {
        let project = Project::new(&[("sections/sec1.2.tex", "one\ntwo \\badcommand here\n")]);
        let mut rows = vec![row(
            Some("./sections/sec1.2"),
            Some(2),
            &["! Undefined control sequence.", "l.2 two \\badcommand"],
        )];
        let mut errors = vec![card(Some("sections/sec1.2"), Some(2), UNDEFINED)];
        project.place("(sections/sec1.2", &mut errors, &mut rows);
        assert_eq!(at(&rows), [(Some("./sections/sec1.2"), Some(2))]);
        assert_eq!(errors[0].column, Some(5));
    }

    #[test]
    fn a_file_outside_the_project_keeps_its_place() {
        let project = Project::new(&[("main.tex", "\\addbibresource{library.bib}\n")]);
        let elsewhere = tempfile::tempdir().unwrap();
        let library = elsewhere.path().join("library.bib");
        std::fs::write(&library, "@misc{a,\n  title = {T}\n").unwrap();
        let library = library.to_str().unwrap();
        let mut errors = vec![card(
            Some(library),
            Some(2),
            "Biber could not read the file.",
        )];
        let mut rows = vec![warning(library, Some(2), "Package biblatex: Something.")];
        project.place("(./main.tex)", &mut errors, &mut rows);
        assert_eq!(at(&rows), [(Some(library), Some(2))]);
        assert_eq!(
            (errors[0].file.as_deref(), errors[0].line),
            (Some(library), Some(2))
        );
    }

    #[test]
    fn an_error_inside_a_package_the_document_does_not_load_keeps_the_package_name() {
        let project = Project::new(&[("main.tex", "\\usepackage{hyperref}\n")]);
        let mut rows = vec![row(
            Some("./pdftexcmds.sty"),
            Some(12),
            &["! Undefined control sequence.", "l.12 \\ltx@IfUndefined"],
        )];
        let mut errors = vec![card(Some("pdftexcmds.sty"), Some(12), UNDEFINED)];
        project.place("(./main.tex (pdftexcmds.sty", &mut errors, &mut rows);
        assert_eq!(at(&rows), [(Some("./pdftexcmds.sty"), None)]);
        assert_eq!(
            (errors[0].file.as_deref(), errors[0].line),
            (Some("pdftexcmds.sty"), None)
        );
    }

    #[test]
    fn each_command_that_is_never_closed_points_at_its_own_start() {
        let project = Project::new(&[("main.tex", "\\textbf{a\n\nfine\n\\textbf{b\n\nend\n")]);
        let message = "! Paragraph ended before \\textbf was complete.";
        let mut rows = vec![
            row(Some("./main.tex"), Some(2), &[message, "l.2 "]),
            row(Some("./main.tex"), Some(5), &[message, "l.5 "]),
        ];
        project.place("(./main.tex", &mut Vec::new(), &mut rows);
        assert_eq!(
            at(&rows),
            [(Some("./main.tex"), Some(1)), (Some("./main.tex"), Some(4))]
        );
    }

    #[test]
    fn the_same_command_wrong_twice_in_one_body_gets_two_places() {
        let project = Project::new(&[(
            "main.tex",
            "\\begin{align}\n  a &= \\foo \\\\\n  b &= \\foo\n\\end{align}\n",
        )]);
        let mut rows = vec![
            row(
                Some("./main.tex"),
                Some(4),
                &[
                    "! Undefined control sequence.",
                    "<argument>  a &= \\foo ",
                    "            \\\\ b &= \\foo ",
                    "l.4 \\end{align}",
                ],
            ),
            row(
                Some("./main.tex"),
                Some(4),
                &[
                    "! Undefined control sequence.",
                    "<argument>  a &= \\foo \\\\ b &= \\foo ",
                    "                 ",
                    "l.4 \\end{align}",
                ],
            ),
        ];
        project.place("(./main.tex", &mut Vec::new(), &mut rows);
        assert_eq!(
            at(&rows),
            [(Some("./main.tex"), Some(2)), (Some("./main.tex"), Some(3))]
        );
    }

    #[test]
    fn math_left_open_on_a_later_line_points_at_that_dollar() {
        let project = Project::new(&[("main.tex", "Let $a + b\n= c$ and then $x\n\nnext\n")]);
        let mut rows = vec![row(
            Some("./main.tex"),
            Some(3),
            &["! Missing $ inserted.", "l.3 "],
        )];
        let mut errors = vec![card(Some("main.tex"), Some(3), "Missing $ inserted.")];
        project.place("(./main.tex", &mut errors, &mut rows);
        assert_eq!(at(&rows), [(Some("./main.tex"), Some(2))]);
        assert_eq!(errors[0].column, Some(15));
    }

    #[test]
    fn a_bibliography_error_finds_a_one_line_entry_and_the_field_it_is_in() {
        let project = Project::new(&[
            ("main.tex", "\\bibliography{refs}\n"),
            (
                "refs.bib",
                "@misc{amp_01, title = {R and D}}\n@article{smith_2020,\n  title = {T},\n  doi = {10.1/a_b}\n}\n",
            ),
            (
                "build/_oleafly_entry.bbl",
                "\\bibitem{amp_01}\nR # D.\n\\bibitem{smith_2020}\nSmith.\n\\newblock doi:10.1/a_b.\n",
            ),
        ]);
        let bbl = "./build/_oleafly_entry.bbl";
        let mut rows = vec![
            row(
                Some(bbl),
                Some(5),
                &["! Missing $ inserted.", "l.5 \\newblock doi:10.1/a_"],
            ),
            row(
                Some(bbl),
                Some(2),
                &["! You can't use `macro parameter character #'.", "l.2 R #"],
            ),
        ];
        let mut errors = vec![card(Some(bbl), Some(5), "Missing $ inserted.")];
        project.place("(./main.tex", &mut errors, &mut rows);
        assert_eq!(
            at(&rows),
            [(Some("./refs.bib"), Some(4)), (Some("./refs.bib"), Some(1))]
        );
        assert_eq!(
            (errors[0].file.as_deref(), errors[0].line, errors[0].column),
            (Some("refs.bib"), Some(4), Some(16))
        );
    }

    #[test]
    fn an_entry_defined_in_two_files_opens_only_in_the_one_the_document_names() {
        let entry = "@misc{k,\n  title = {R & D}\n}\n";
        let files = [
            ("main.tex", "\\bibliography{refs}\n"),
            ("refs.bib", entry),
            ("archive/refs.bib", entry),
            ("build/_oleafly_entry.bbl", "\\bibitem{k}\nR & D.\n"),
        ];
        let context = ["! Misplaced alignment tab character &.", "l.2 R &"];
        let bbl = "./build/_oleafly_entry.bbl";
        let project = Project::new(&files);
        let mut rows = vec![row(Some(bbl), Some(2), &context)];
        project.place("(./main.tex", &mut Vec::new(), &mut rows);
        assert_eq!(at(&rows), [(Some("./refs.bib"), Some(2))]);

        let unnamed = Project::new(&[("main.tex", "Text.\n"), files[1], files[2], files[3]]);
        let mut rows = vec![row(Some(bbl), Some(2), &context)];
        let mut errors = vec![card(
            Some(bbl),
            Some(2),
            "Misplaced alignment tab character &.",
        )];
        unnamed.place("(./main.tex", &mut errors, &mut rows);
        assert_eq!(at(&rows), [(None, None)]);
        assert_eq!(
            (errors[0].file.as_deref(), errors[0].code.as_deref()),
            (None, Some("tex.explain.some"))
        );
    }

    #[test]
    fn an_error_in_a_bibliography_the_project_ships_opens_that_file() {
        let bbl = "\\begin{thebibliography}{1}\n\\bibitem{k}\nR & D.\n\\end{thebibliography}\n";
        let project = Project::new(&[
            ("main.tex", "Text.\n"),
            ("main.bbl", bbl),
            ("build/_oleafly_entry.bbl", bbl),
        ]);
        let built = "./build/_oleafly_entry.bbl";
        let mut rows = vec![row(
            Some(built),
            Some(3),
            &["! Misplaced alignment tab character &.", "l.3 R &"],
        )];
        let mut errors = vec![card(
            Some(built),
            Some(3),
            "Misplaced alignment tab character &.",
        )];
        project.place("(./main.tex", &mut errors, &mut rows);
        assert_eq!(at(&rows), [(Some("./main.bbl"), Some(3))]);
        assert_eq!(
            (
                errors[0].file.as_deref(),
                errors[0].line,
                errors[0].code.as_deref()
            ),
            (Some("main.bbl"), Some(3), Some("tex.explain.some"))
        );
    }

    #[test]
    fn boxes_are_matched_to_their_own_lines_in_the_log() {
        let project = Project::new(&[(
            "main.tex",
            "Representations\n\\begin{tabular}{l}\nx\n\\end{tabular}\nfive\nA line with averyveryverylongword in it.\nseven\n",
        )]);
        let log = concat!(
            "(./main.tex\n",
            "Overfull \\hbox (4.0pt too wide) in alignment at lines 2--4\n[] \n",
            "Overfull \\hbox (9.0pt too wide) detected at line 4\n[]\n",
            "Overfull \\hbox (15.0pt too wide) in paragraph at lines 5--7\n",
            "[]\\OT1/cmr/m/n/10 A line with avery-very-very-long-word in it.\n",
            "Underfull \\hbox (badness 10000) in paragraph at lines 9--9\n",
            "[]\\OT1/cmr/m/n/10 Rep-re-sen-ta-tions\n",
        );
        let mut rows = vec![
            boxed("./main.tex", 4),
            boxed("./main.tex", 5),
            boxed("./build/_oleafly_entry.bbl", 9),
        ];
        project.place(log, &mut Vec::new(), &mut rows);
        assert_eq!(
            at(&rows),
            [
                (Some("./main.tex"), Some(4)),
                (Some("./main.tex"), Some(6)),
                (None, None)
            ]
        );
    }

    #[test]
    fn a_package_error_repeated_from_a_build_file_is_listed_once() {
        let project = Project::new(&[("main.tex", "\\section{\\boldsymbol{x}}\n")]);
        let message = "! Package amsmath: \\boldsymbol allowed only in math mode.";
        let toc = "./build/_oleafly_entry.toc";
        let mut rows = vec![
            row(
                Some("./main.tex"),
                Some(1),
                &[message, "l.1 \\section{\\boldsymbol{x}}"],
            ),
            row(
                Some(toc),
                Some(1),
                &[message, "l.1 ...ine {1}\\boldsymbol {x}}{1}{}"],
            ),
        ];
        let text = "Package amsmath Error: \\boldsymbol allowed only in math mode.";
        let mut errors = vec![
            card(Some("main.tex"), Some(1), text),
            card(Some(toc), Some(1), text),
        ];
        project.place("(./main.tex", &mut errors, &mut rows);
        assert_eq!(at(&rows), [(Some("./main.tex"), Some(1))]);
        assert_eq!(errors.len(), 1);
        assert_eq!(errors[0].file.as_deref(), Some("main.tex"));

        let mut errors = vec![
            card(Some("main.tex"), Some(1), text),
            card(Some(toc), Some(1), text),
        ];
        project.place("(./main.tex", &mut errors, &mut Vec::new());
        assert_eq!(errors.len(), 1);
        assert_eq!(errors[0].file.as_deref(), Some("main.tex"));
    }

    #[test]
    fn a_build_file_this_compile_wrote_blames_the_document() {
        let bad = "\\relax \n\\newlabel{bad\\relax x}{{1}{1}}\n";
        let aux = "./build/_oleafly_entry.aux";
        let read = "\\newlabel{bad\\relax x}";

        let mut fresh = Project::new(&[("main.tex", "Text.\n")]);
        fresh.before = BuildBefore::take(&fresh.folder.path().join("build"));
        std::fs::write(fresh.folder.path().join("build/_oleafly_entry.aux"), bad).unwrap();
        let (mut errors, mut rows) = aux_error(aux, read);
        fresh.place("(./main.tex)", &mut errors, &mut rows);
        assert_eq!(at(&rows), [(None, None)]);
        assert_eq!(
            (errors[0].file.as_deref(), errors[0].explanation.as_deref()),
            (None, Some(BUILD_FILE_UNREADABLE))
        );

        let mut kept = Project::new(&[("main.tex", "Text.\n"), ("build/_oleafly_entry.aux", bad)]);
        kept.before = BuildBefore::take(&kept.folder.path().join("build"));
        let (mut errors, mut rows) = aux_error(aux, read);
        kept.place("(./main.tex)", &mut errors, &mut rows);
        assert_eq!(errors[0].code.as_deref(), Some(BUILD_FILE_DAMAGED_CODE));

        let longer = format!("{bad}\\gdef \\@abspage@last{{1}}\n");
        std::fs::write(kept.folder.path().join("build/_oleafly_entry.aux"), longer).unwrap();
        let (mut errors, mut rows) = aux_error(aux, read);
        kept.place("(./main.tex)", &mut errors, &mut rows);
        assert_eq!(errors[0].code.as_deref(), Some(BUILD_FILE_UNREADABLE_CODE));

        std::fs::write(
            kept.folder.path().join("build/_oleafly_entry.aux"),
            "\\relax \nfine\n",
        )
        .unwrap();
        let (mut errors, mut rows) = aux_error(aux, read);
        kept.place("(./main.tex)", &mut errors, &mut rows);
        assert_eq!(errors[0].code.as_deref(), Some(BUILD_FILE_DAMAGED_CODE));
    }

    #[test]
    fn the_build_file_cards_match_the_catalog_word_for_word() {
        let catalog: serde_json::Value =
            serde_json::from_str(include_str!("../../../src/i18n/locales/en/errors.json")).unwrap();
        for (code, text) in [
            (BUILD_FILE_DAMAGED_CODE, BUILD_FILE_DAMAGED),
            (BUILD_FILE_UNREADABLE_CODE, BUILD_FILE_UNREADABLE),
        ] {
            let key = code.strip_prefix("tex.").unwrap();
            assert_eq!(catalog["tex"][key].as_str(), Some(text), "{code}");
        }
    }
}
