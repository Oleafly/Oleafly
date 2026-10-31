use biblatex::{Bibliography, ChunksExt, Entry, Pair, Person, RawBibliography, RawEntry, Spanned};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, HashMap};
use std::ffi::OsStr;
use std::path::{Path, PathBuf};

use crate::DocError;

const FUZZY_TITLE_THRESHOLD: f64 = 0.9;
const YEAR_WINDOW: i64 = 1;

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CleanAction {
    pub kind: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub old: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub new: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub removed: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub kept: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub by: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub key: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub field: Option<String>,
}

impl CleanAction {
    fn renamed_key(old: String, new: String) -> Self {
        Self {
            kind: "renamed-key",
            old: Some(old),
            new: Some(new),
            removed: None,
            kept: None,
            by: None,
            key: None,
            field: None,
        }
    }

    fn removed_duplicate(removed: String, kept: String, by: &str) -> Self {
        Self {
            kind: "removed-duplicate",
            old: None,
            new: None,
            removed: Some(removed),
            kept: Some(kept),
            by: Some(by.to_string()),
            key: None,
            field: None,
        }
    }

    fn advisory(key: String, field: String) -> Self {
        Self {
            kind: "advisory",
            old: None,
            new: None,
            removed: None,
            kept: None,
            by: None,
            key: Some(key),
            field: Some(field),
        }
    }
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CleanOutcome {
    pub original: String,
    pub cleaned: String,
    pub entries_before: usize,
    pub entries_after: usize,
    pub actions: Vec<CleanAction>,
    pub applied: bool,
    pub preview_token: String,
    pub changed_files: Vec<String>,
    pub backup_path: Option<String>,
}

fn field_string(entry: &Entry, key: &str) -> Option<String> {
    entry
        .get(key)
        .map(|chunks| chunks.format_verbatim())
        .filter(|s| !s.trim().is_empty())
}

fn author_string(entry: &Entry) -> String {
    match entry.author() {
        Ok(persons) if !persons.is_empty() => persons
            .iter()
            .map(person_bibtex)
            .collect::<Vec<_>>()
            .join(" and "),
        _ => String::new(),
    }
}

fn person_bibtex(person: &Person) -> String {
    let family = person.name.trim();
    let given = person.given_name.trim();
    if given.is_empty() {
        family.to_string()
    } else {
        format!("{family}, {given}")
    }
}

fn year_string(entry: &Entry) -> String {
    field_string(entry, "year")
        .or_else(|| field_string(entry, "date"))
        .map(|y| oleafly_core::bibkey::year_of(&y))
        .unwrap_or_default()
        .trim()
        .to_string()
}

fn normalize_doi(raw: &str) -> String {
    raw.trim()
        .to_ascii_lowercase()
        .trim_start_matches("https://doi.org/")
        .trim_start_matches("http://doi.org/")
        .trim_start_matches("https://dx.doi.org/")
        .trim_start_matches("http://dx.doi.org/")
        .trim_start_matches("doi:")
        .trim()
        .to_ascii_lowercase()
}

fn normalize_title(raw: &str) -> String {
    let collapsed: String = raw
        .chars()
        .map(|c| if c.is_alphanumeric() { c } else { ' ' })
        .collect();
    collapsed
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_ascii_lowercase()
}

fn collision_suffix(mut n: usize) -> String {
    let mut s = String::new();
    loop {
        s.insert(0, char::from(b'a' + (n % 26) as u8));
        if n < 26 {
            return s;
        }
        n = n / 26 - 1;
    }
}

fn entry_richness(entry: &Entry) -> usize {
    entry
        .fields
        .iter()
        .filter(|(_, chunks)| !chunks.format_verbatim().trim().is_empty())
        .count()
}

fn edit_text(source: &str, mut edits: Vec<(std::ops::Range<usize>, String)>) -> String {
    edits.sort_by_key(|(range, _)| range.start);
    let mut out = String::new();
    let mut cursor = 0;
    for (range, replacement) in edits {
        if range.start < cursor {
            continue;
        }
        out.push_str(&source[cursor..range.start]);
        out.push_str(&replacement);
        cursor = range.end;
    }
    out.push_str(&source[cursor..]);
    out
}

fn key_char(c: char) -> bool {
    c.is_alphanumeric() || matches!(c, '.' | '_' | '+' | '-' | '/' | ':')
}

fn key_edits(
    source: &str,
    offset: usize,
    renames: &HashMap<String, String>,
) -> Vec<(std::ops::Range<usize>, String)> {
    let mut edits = Vec::new();
    let mut start = None;
    for (index, ch) in source
        .char_indices()
        .chain(std::iter::once((source.len(), ' ')))
    {
        if key_char(ch) {
            start.get_or_insert(index);
        } else if let Some(start) = start.take() {
            if let Some(new) = renames.get(&source[start..index]) {
                edits.push((offset + start..offset + index, new.clone()));
            }
        }
    }
    edits
}

fn citation_argument_edits(
    source: &str,
    offset: usize,
    renames: &HashMap<String, String>,
) -> Vec<(std::ops::Range<usize>, String)> {
    let mut edits = Vec::new();
    let mut cursor = 0;
    for part in source.split(',') {
        let key = part.trim();
        if let Some(new) = renames.get(key) {
            let start = cursor + part.len() - part.trim_start().len();
            edits.push((offset + start..offset + start + key.len(), new.clone()));
        }
        cursor += part.len() + 1;
    }
    edits
}

fn citation_renames(actions: &[CleanAction]) -> HashMap<String, String> {
    let mut aliases = HashMap::new();
    let mut renamed = HashMap::new();
    for action in actions {
        if let (Some(old), Some(new)) = (&action.old, &action.new) {
            renamed.insert(old.clone(), new.clone());
        }
        if let (Some(old), Some(new)) = (&action.removed, &action.kept) {
            aliases.insert(old.clone(), new.clone());
        }
    }
    let mut result = renamed.clone();
    for old in aliases.keys() {
        let mut target = old;
        for _ in 0..aliases.len() {
            match aliases.get(target) {
                Some(next) => target = next,
                None => break,
            }
        }
        result.insert(old.clone(), renamed.get(target).unwrap_or(target).clone());
    }
    result
}

/// The environments whose body LaTeX prints verbatim or discards.
const VERBATIM_ENVIRONMENTS: [&str; 5] =
    ["verbatim", "Verbatim", "lstlisting", "minted", "comment"];

struct CitationCommand {
    multiple: bool,
    volume: bool,
}

impl CitationCommand {
    fn groups(&self) -> usize {
        if self.volume {
            2
        } else {
            1
        }
    }
}

fn citation_command(name: &str) -> Option<CitationCommand> {
    let command = name.to_ascii_lowercase();
    let single = if matches!(
        command.as_str(),
        "defcitealias" | "citetalias" | "citepalias"
    ) {
        command.as_str()
    } else {
        command.strip_suffix('s').unwrap_or(&command)
    };
    if !matches!(
        single,
        "cite"
            | "citet"
            | "citep"
            | "citealt"
            | "citealp"
            | "citeauthor"
            | "citeyear"
            | "citeyearpar"
            | "citetitle"
            | "citeurl"
            | "autocite"
            | "parencite"
            | "textcite"
            | "footcite"
            | "footcitetext"
            | "supercite"
            | "smartcite"
            | "fullcite"
            | "footfullcite"
            | "nocite"
            | "notecite"
            | "pnotecite"
            | "fnotecite"
            | "citefield"
            | "defcitealias"
            | "citetalias"
            | "citepalias"
            | "bibentry"
            | "volcite"
            | "pvolcite"
            | "tvolcite"
            | "fvolcite"
            | "ftvolcite"
    ) {
        return None;
    }
    Some(CitationCommand {
        multiple: command != single,
        volume: single.ends_with("volcite"),
    })
}

fn reference_key_end(text: &str, start: usize, renames: &HashMap<String, String>) -> usize {
    let mut end = start;
    for ch in text[start..].chars().take_while(|c| key_char(*c)) {
        end += ch.len_utf8();
    }
    while end > start
        && !renames.contains_key(&text[start..end])
        && text.as_bytes()[end - 1] == b'.'
    {
        end -= 1;
    }
    end
}

fn tex_verb_length(tail: &str) -> Option<usize> {
    let start = if tail.as_bytes().get(5) == Some(&b'*') {
        6
    } else {
        5
    };
    tail.get(start..)
        .and_then(|s| s.chars().next())
        .and_then(|delimiter| {
            tail[start + delimiter.len_utf8()..]
                .find(delimiter)
                .map(|n| start + n + 2 * delimiter.len_utf8())
        })
}

fn tex_environment_length(tail: &str) -> Option<usize> {
    VERBATIM_ENVIRONMENTS.iter().find_map(|env| {
        tail.starts_with(&format!("\\begin{{{env}}}")).then(|| {
            let end = format!("\\end{{{env}}}");
            tail.find(&end).map_or(tail.len(), |n| n + end.len())
        })
    })
}

fn tex_masked_length(tail: &str) -> Option<usize> {
    if tail.starts_with('%') {
        Some(tail.find('\n').unwrap_or(tail.len()))
    } else if tail.starts_with("\\verb")
        && tail
            .as_bytes()
            .get(5)
            .is_some_and(|c| !c.is_ascii_alphabetic())
    {
        tex_verb_length(tail)
    } else {
        tex_environment_length(tail)
    }
}

fn code_span_length(tail: &str) -> Option<usize> {
    if !tail.starts_with('`') {
        return None;
    }
    let count = tail.bytes().take_while(|b| *b == b'`').count();
    let fence = "`".repeat(count);
    Some(
        tail[count..]
            .find(&fence)
            .map_or(tail.len(), |n| n + 2 * count),
    )
}

fn typst_string_end(source: &str, start: usize) -> usize {
    let mut end = start + 1;
    while end < source.len() {
        let ch = source[end..].chars().next().unwrap();
        end += ch.len_utf8();
        if ch == '"' {
            break;
        }
        if ch == char::from(92) && end < source.len() {
            end += source[end..].chars().next().unwrap().len_utf8();
        }
    }
    end
}

fn quotes_renamed_reference(quoted: &str, renames: &HashMap<String, String>) -> bool {
    quoted
        .char_indices()
        .filter(|(_, ch)| matches!(ch, '@' | '<'))
        .any(|(at, marker)| {
            if marker == '@' && at > 0 && quoted[..at].chars().next_back().is_some_and(key_char) {
                return false;
            }
            let start = at + 1;
            let stop = reference_key_end(quoted, start, renames);
            renames.contains_key(&quoted[start..stop])
        })
}

/// The end of the nested Typst block comment that opens at `start`.
fn typst_block_comment_end(source: &str, start: usize) -> usize {
    let mut depth = 1;
    let mut end = start + 2;
    while end < source.len() && depth > 0 {
        if source[end..].starts_with("/*") {
            depth += 1;
            end += 2;
        } else if source[end..].starts_with("*/") {
            depth -= 1;
            end += 2;
        } else {
            end += source[end..].chars().next().unwrap().len_utf8();
        }
    }
    end
}

fn typst_masked_length(
    source: &str,
    i: usize,
    renames: &HashMap<String, String>,
    quoted_reference: &mut bool,
) -> Option<usize> {
    let tail = &source[i..];
    if tail.starts_with('"') {
        let end = typst_string_end(source, i);
        if quotes_renamed_reference(&source[i..end], renames) {
            *quoted_reference = true;
        }
        Some(end - i)
    } else if tail.starts_with("//") {
        Some(tail.find('\n').unwrap_or(tail.len()))
    } else if tail.starts_with("/*") {
        Some(typst_block_comment_end(source, i) - i)
    } else {
        None
    }
}

fn tilde_fence_length(tail: &str) -> usize {
    let tildes = |text: &str| text.bytes().take_while(|b| *b == b'~').count();
    let count = tildes(tail.trim_start_matches(' '));
    let mut length = tail.find('\n').map_or(tail.len(), |n| n + 1);
    for line in tail[length..].split_inclusive('\n') {
        length += line.len();
        let closing = line.trim_start_matches(' ');
        let closing_count = tildes(closing);
        if line.len() - closing.len() <= 3
            && closing_count >= count
            && closing[closing_count..].trim().is_empty()
        {
            break;
        }
    }
    length
}

fn markdown_masked_length(source: &str, i: usize) -> Option<usize> {
    let tail = &source[i..];
    let line_start = i == 0 || source.as_bytes()[i - 1] == b'\n';
    if line_start && (tail.starts_with("    ") || tail.starts_with('\t')) {
        Some(tail.find('\n').unwrap_or(tail.len()))
    } else if line_start && tail.trim_start_matches(' ').starts_with("~~~") {
        Some(tilde_fence_length(tail))
    } else if tail.starts_with("<!--") {
        Some(tail.find("-->").map_or(tail.len(), |n| n + 3))
    } else {
        None
    }
}

fn masked_length(
    source: &str,
    i: usize,
    extension: &str,
    renames: &HashMap<String, String>,
    quoted_reference: &mut bool,
) -> Option<usize> {
    let tail = &source[i..];
    match extension {
        "tex" => tex_masked_length(tail),
        "typ" => code_span_length(tail)
            .or_else(|| typst_masked_length(source, i, renames, quoted_reference)),
        "md" => code_span_length(tail).or_else(|| markdown_masked_length(source, i)),
        _ => code_span_length(tail),
    }
}

/// How far to move past text that is not masked. A LaTeX control symbol
/// (`\%`) is one step, so its character is not read as a comment.
fn unmasked_step(tail: &str) -> usize {
    if tail.starts_with('\\')
        && !tail.starts_with("\\cite")
        && tail
            .as_bytes()
            .get(1)
            .is_some_and(|b| !b.is_ascii_alphabetic())
    {
        1 + tail[1..].chars().next().map_or(0, char::len_utf8)
    } else {
        tail.chars().next().unwrap().len_utf8()
    }
}

fn mask_source(source: &str, extension: &str, renames: &HashMap<String, String>) -> (String, bool) {
    let mut quoted_reference = false;
    let mut masked = source.as_bytes().to_vec();
    let mut i = 0;
    while i < masked.len() {
        if let Some(length) = masked_length(source, i, extension, renames, &mut quoted_reference) {
            masked[i..i + length].fill(b' ');
            i += length;
        } else {
            i += unmasked_step(&source[i..]);
        }
    }
    let mask = String::from_utf8(masked).expect("mask preserves UTF-8");
    (mask, quoted_reference)
}

fn matching_close(bytes: &[u8], mut cursor: usize, open: u8, close: u8) -> Option<usize> {
    let mut depth = 1;
    while cursor < bytes.len() && depth > 0 {
        if bytes[cursor] == open {
            depth += 1;
        }
        if bytes[cursor] == close {
            depth -= 1;
        }
        if depth > 0 {
            cursor += 1;
        }
    }
    (depth == 0).then_some(cursor)
}

fn citation_group_edits(
    source: &str,
    bytes: &[u8],
    mut cursor: usize,
    command: &CitationCommand,
    renames: &HashMap<String, String>,
    edits: &mut Vec<(std::ops::Range<usize>, String)>,
) -> usize {
    let mut arguments = 0;
    if bytes.get(cursor) == Some(&b'*') {
        cursor += 1;
    }
    loop {
        while bytes.get(cursor).is_some_and(u8::is_ascii_whitespace) {
            cursor += 1;
        }
        let Some(open) = bytes
            .get(cursor)
            .copied()
            .filter(|b| matches!(b, b'[' | b'{'))
        else {
            break;
        };
        let close = if open == b'[' { b']' } else { b'}' };
        cursor += 1;
        let start = cursor;
        let Some(end) = matching_close(bytes, cursor, open, close) else {
            return bytes.len();
        };
        if open == b'{' {
            arguments += 1;
            if !command.volume || arguments % 2 == 0 {
                edits.extend(citation_argument_edits(&source[start..end], start, renames));
            }
        }
        cursor = end + 1;
        if !command.multiple && arguments >= command.groups() {
            break;
        }
    }
    cursor
}

fn tex_citation_edits(
    source: &str,
    mask: &str,
    renames: &HashMap<String, String>,
) -> Vec<(std::ops::Range<usize>, String)> {
    let bytes = mask.as_bytes();
    let mut edits = Vec::new();
    let mut cursor = 0;
    while cursor < bytes.len() {
        if bytes[cursor] != b'\\' {
            cursor += 1;
            continue;
        }
        cursor += 1;
        let start = cursor;
        while cursor < bytes.len() && bytes[cursor].is_ascii_alphabetic() {
            cursor += 1;
        }
        if start == cursor {
            cursor = (cursor + 1).min(bytes.len());
            continue;
        }
        if let Some(command) = citation_command(&mask[start..cursor]) {
            cursor = citation_group_edits(source, bytes, cursor, &command, renames, &mut edits);
        }
    }
    edits
}

/// Whether the Markdown `@` at `at` follows `-` as a suppressed author.
fn is_suppressed_author(source: &str, at: usize) -> bool {
    at > 0
        && source.as_bytes()[at - 1] == b'-'
        && (at == 1
            || source[..at - 1]
                .chars()
                .next_back()
                .is_some_and(|c| !key_char(c)))
}

fn at_sign_is_embedded(source: &str, at: usize, extension: &str) -> bool {
    let suppressed_author = extension == "md" && is_suppressed_author(source, at);
    !suppressed_author
        && at > 0
        && source[..at]
            .chars()
            .next_back()
            .is_some_and(|c| key_char(c) || c == '\\' || c == '@')
}

fn at_sign_edits(
    source: &str,
    mask: &str,
    extension: &str,
    renames: &HashMap<String, String>,
) -> Vec<(std::ops::Range<usize>, String)> {
    let mut edits = Vec::new();
    for (at, _) in mask.match_indices('@') {
        if at_sign_is_embedded(source, at, extension) {
            continue;
        }
        let start = at + 1;
        let end = reference_key_end(source, start, renames);
        if let Some(new) = renames.get(&source[start..end]) {
            edits.push((start..end, new.clone()));
        }
    }
    edits
}

fn typst_cite_key(after_cite: &str) -> Option<&str> {
    after_cite
        .trim_start()
        .strip_prefix('(')?
        .trim_start()
        .strip_prefix('<')
}

fn typst_cite_edits(
    source: &str,
    mask: &str,
    renames: &HashMap<String, String>,
) -> Vec<(std::ops::Range<usize>, String)> {
    let mut edits = Vec::new();
    for (at, _) in mask.match_indices("cite") {
        if at > 0 && mask[..at].chars().next_back().is_some_and(key_char) {
            continue;
        }
        let Some(key) = typst_cite_key(&mask[at + 4..]) else {
            continue;
        };
        let Some(end) = key.find('>') else {
            continue;
        };
        if let Some(new) = renames.get(&key[..end]) {
            let start = source.len() - key.len();
            edits.push((start..start + end, new.clone()));
        }
    }
    edits
}

fn rewrite_citations_with_quotes(
    source: &str,
    extension: &str,
    renames: &HashMap<String, String>,
) -> (String, bool) {
    let (mask, quoted_reference) = mask_source(source, extension, renames);
    let edits = match extension {
        "tex" => tex_citation_edits(source, &mask, renames),
        "typ" => {
            let mut edits = at_sign_edits(source, &mask, extension, renames);
            edits.extend(typst_cite_edits(source, &mask, renames));
            edits
        }
        _ => at_sign_edits(source, &mask, extension, renames),
    };
    (edit_text(source, edits), quoted_reference)
}

#[cfg(test)]
fn rewrite_citations(source: &str, extension: &str, renames: &HashMap<String, String>) -> String {
    rewrite_citations_with_quotes(source, extension, renames).0
}

fn project_text_files(root: &Path) -> Result<Vec<PathBuf>, String> {
    fn walk(root: &Path, dir: &Path, out: &mut Vec<PathBuf>) -> Result<(), String> {
        if dir
            .strip_prefix(root)
            .map_err(|e| e.to_string())?
            .components()
            .count()
            > 64
        {
            return Err("The project has more than 64 nested folders. Move the source files closer to its root before cleaning.".into());
        }
        for entry in std::fs::read_dir(dir).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            let kind = entry.file_type().map_err(|e| e.to_string())?;
            let path = entry.path();
            let name = entry.file_name();
            let name = name.to_string_lossy();
            if kind.is_symlink() && path.is_dir() && !name.starts_with('.') {
                return Err(format!(
                    "Cannot clean references while {name} is a symbolic link to a folder."
                ));
            }
            if kind.is_dir() {
                if name.starts_with('.')
                    || matches!(name.as_ref(), "build" | "node_modules" | "target")
                    || (dir == root && name == crate::stats::VENDOR_DIR)
                {
                    continue;
                }
                walk(root, &path, out)?;
            } else if matches!(
                path.extension().and_then(|e| e.to_str()),
                Some("tex" | "typ" | "md" | "bib")
            ) {
                if kind.is_symlink() {
                    return Err(format!(
                        "Cannot clean references while {} is a symbolic link.",
                        path.strip_prefix(root).unwrap().display()
                    ));
                }
                if !kind.is_file() {
                    return Err(format!(
                        "{} is not a regular source file.",
                        path.strip_prefix(root).unwrap().display()
                    ));
                }
                let relative = path.strip_prefix(root).unwrap().to_string_lossy();
                // `resolve_within` intentionally accepts portable project paths
                // only. Windows produces native separators here, while Unix may
                // legitimately have a backslash in a file name.
                #[cfg(windows)]
                let relative = relative.replace('\\', "/");
                oleafly_core::resolve_project_path(root, relative.as_ref())
                    .map_err(|error| error.to_string())?;
                out.push(path);
                if out.len() > 10_000 {
                    return Err(
                        "The project has more than 10,000 source files. Clean a smaller project."
                            .into(),
                    );
                }
            }
        }
        Ok(())
    }
    let mut files = Vec::new();
    walk(root, root, &mut files)?;
    files.sort();
    Ok(files)
}

fn contains_fields(keeper: &Entry, other: &Entry) -> bool {
    keeper.entry_type == other.entry_type
        && other.fields.iter().all(|(field, value)| {
            keeper.fields.get(field).is_some_and(|kept| {
                if field == "doi" {
                    normalize_doi(&kept.format_verbatim())
                        == normalize_doi(&value.format_verbatim())
                } else {
                    kept.format_verbatim() == value.format_verbatim()
                }
            })
        })
}

fn relation_key_edits(
    source: &str,
    fields: Vec<Pair<'_>>,
    renames: &HashMap<String, String>,
) -> Vec<(std::ops::Range<usize>, String)> {
    fields
        .into_iter()
        .filter(|field| {
            matches!(
                field.key.v.to_ascii_lowercase().as_str(),
                "crossref" | "xref" | "xdata" | "related" | "entryset"
            )
        })
        .flat_map(|field| {
            key_edits(
                &source[field.value.span.clone()],
                field.value.span.start,
                renames,
            )
        })
        .collect()
}

fn merge_doi_duplicates(
    bib: Bibliography,
    commented: &std::collections::HashSet<&str>,
    links: &HashMap<&str, Vec<String>>,
    actions: &mut Vec<CleanAction>,
) -> Vec<Entry> {
    let mut kept: Vec<Entry> = Vec::new();
    let mut seen_dois: HashMap<String, usize> = HashMap::new();
    for entry in bib.into_iter() {
        let doi = field_string(&entry, "doi")
            .map(|d| normalize_doi(&d))
            .filter(|d| !d.is_empty());
        let duplicate_of = doi
            .as_ref()
            .and_then(|doi| seen_dois.get(doi))
            .copied()
            .filter(|&index| !linked(links, &kept[index].key, &entry.key));
        if let Some(index) = duplicate_of {
            let keeper = &mut kept[index];
            if !commented.contains(keeper.key.as_str())
                && !commented.contains(entry.key.as_str())
                && (contains_fields(keeper, &entry) || contains_fields(&entry, keeper))
            {
                if entry_richness(&entry) > entry_richness(keeper) {
                    let removed = std::mem::replace(keeper, entry);
                    actions.push(CleanAction::removed_duplicate(
                        removed.key,
                        keeper.key.clone(),
                        "doi",
                    ));
                } else {
                    actions.push(CleanAction::removed_duplicate(
                        entry.key,
                        keeper.key.clone(),
                        "doi",
                    ));
                }
                continue;
            }
            actions.push(CleanAction::advisory(
                entry.key.clone(),
                format!(
                    "Shares a DOI with {}; both entries have details worth keeping.",
                    keeper.key
                ),
            ));
        } else if let Some(doi) = doi {
            seen_dois.entry(doi).or_insert(kept.len());
        }
        kept.push(entry);
    }
    kept
}

/// Whether one entry names the other in `crossref` or `xdata`. A chapter
/// inherits its book's DOI that way, but the two aren't duplicates.
fn linked(links: &HashMap<&str, Vec<String>>, a: &str, b: &str) -> bool {
    let names = |from: &str, to: &str| {
        links
            .get(from)
            .is_some_and(|targets| targets.iter().any(|target| target == to))
    };
    names(a, b) || names(b, a)
}

fn titles_are_similar(first: &(String, i64), second: &(String, i64)) -> bool {
    let (a, year_a) = first;
    let (b, year_b) = second;
    !a.is_empty()
        && !b.is_empty()
        && a.len() <= 1_000
        && b.len() <= 1_000
        && (year_a == &0 || year_b == &0 || (year_a - year_b).abs() <= YEAR_WINDOW)
        && rapidfuzz::distance::levenshtein::normalized_similarity(a.chars(), b.chars())
            >= FUZZY_TITLE_THRESHOLD
}

fn flag_similar_titles(kept: &[Entry], actions: &mut Vec<CleanAction>) {
    if kept.len() > 500 {
        actions.push(CleanAction::advisory(
            String::new(),
            "Title comparisons were skipped because this library has more than 500 entries.".into(),
        ));
        return;
    }
    let titles: Vec<_> = kept
        .iter()
        .map(|entry| {
            (
                normalize_title(&field_string(entry, "title").unwrap_or_default()),
                year_string(entry).parse::<i64>().unwrap_or(0),
            )
        })
        .collect();
    let mut flagged_titles = std::collections::HashSet::new();
    for i in 0..kept.len() {
        for j in i + 1..kept.len() {
            if flagged_titles.contains(&j) || !titles_are_similar(&titles[i], &titles[j]) {
                continue;
            }
            flagged_titles.insert(j);
            actions.push(CleanAction::advisory(
                kept[j].key.clone(),
                format!(
                    "Similar title to {}; review these entries before merging them.",
                    kept[i].key
                ),
            ));
        }
    }
}

fn unused_key(desired: &str, taken: &std::collections::HashSet<String>) -> String {
    let mut final_key = desired.to_string();
    let mut n = 0;
    while taken.contains(&final_key) {
        final_key = format!("{}{}", desired, collision_suffix(n));
        n += 1;
    }
    final_key
}

fn rename_keys(kept: &mut [Entry], actions: &mut Vec<CleanAction>) {
    let mut taken: std::collections::HashSet<String> =
        kept.iter().map(|entry| entry.key.clone()).collect();
    for entry in kept {
        let entry_key = entry.key.clone();
        let author = author_string(entry);
        let year = year_string(entry);
        let title = field_string(entry, "title");
        if field_string(entry, "author").is_none() {
            actions.push(CleanAction::advisory(
                entry_key.clone(),
                "missing author".into(),
            ));
        }
        if title.is_none() {
            actions.push(CleanAction::advisory(
                entry_key.clone(),
                "missing title".into(),
            ));
        }
        if year.is_empty() {
            actions.push(CleanAction::advisory(
                entry_key.clone(),
                "missing year".into(),
            ));
        }
        let desired = oleafly_core::bibkey::cite_key(&author, &year, &title.unwrap_or_default());
        if desired.is_empty() || desired == entry_key {
            taken.insert(entry_key);
            continue;
        }
        taken.remove(&entry_key);
        let final_key = unused_key(&desired, &taken);
        actions.push(CleanAction::renamed_key(entry_key, final_key.clone()));
        entry.key = final_key.clone();
        taken.insert(final_key);
    }
}

fn library_edits(
    source: &str,
    entries: Vec<Spanned<RawEntry<'_>>>,
    removed: &std::collections::HashSet<&str>,
    renames: &HashMap<String, String>,
) -> Result<Vec<(std::ops::Range<usize>, String)>, DocError> {
    let mut edits = Vec::new();
    for entry in entries {
        if removed.contains(entry.v.key.v) {
            let end = entry.span.end
                + source[entry.span.end..]
                    .find('}')
                    .ok_or("The library entry is incomplete.")?
                + 1;
            edits.push((entry.span.start..end, String::new()));
            continue;
        }
        if let Some(new) = renames.get(entry.v.key.v) {
            edits.push((entry.v.key.span, new.clone()));
        }
        edits.extend(relation_key_edits(source, entry.v.fields, renames));
    }
    Ok(edits)
}

pub fn clean_bibtex_source(source: &str) -> Result<CleanOutcome, DocError> {
    let bib = crate::bib_parse::parse_library(source)
        .map_err(|e| format!("the library could not be parsed: {e}"))?;
    let entries_before = bib.len();
    if let Some(entry) = bib.iter().find(|entry| !entry.key.chars().all(key_char)) {
        return Err(format!("Citation key {} uses punctuation that cannot be rewritten safely. Rename it before cleaning.", entry.key).into());
    }
    let mut actions: Vec<CleanAction> = Vec::new();

    let raw = RawBibliography::parse(source).map_err(|e| e.to_string())?;
    let commented: std::collections::HashSet<_> = raw
        .entries
        .iter()
        .filter(|entry| source[entry.span.clone()].contains('%'))
        .map(|entry| entry.v.key.v)
        .collect();
    let links = crate::bib_parse::entry_links(source, &raw);
    let mut kept = merge_doi_duplicates(bib, &commented, &links, &mut actions);
    flag_similar_titles(&kept, &mut actions);
    rename_keys(&mut kept, &mut actions);

    let renames = citation_renames(&actions);
    let removed: std::collections::HashSet<_> = actions
        .iter()
        .filter_map(|a| a.removed.as_deref())
        .collect();
    let edits = library_edits(source, raw.entries, &removed, &renames)?;
    let cleaned = edit_text(source, edits);
    crate::bib_parse::parse_library(&cleaned)
        .map_err(|e| format!("The cleaned library could not be parsed: {e}"))?;
    Ok(CleanOutcome {
        original: source.to_string(),
        cleaned,
        entries_before,
        entries_after: kept.len(),
        actions,
        applied: false,
        preview_token: String::new(),
        changed_files: Vec::new(),
        backup_path: None,
    })
}

struct FileChange {
    path: PathBuf,
    original: String,
    updated: String,
}
pub struct CleanPlan {
    root: PathBuf,
    outcome: CleanOutcome,
    changes: Vec<FileChange>,
}

fn read_project_sources(
    root: &Path,
    paths: Vec<PathBuf>,
) -> Result<BTreeMap<PathBuf, String>, DocError> {
    let mut snapshots = BTreeMap::new();
    let mut total_bytes = 0;
    for path in paths {
        let metadata = std::fs::metadata(&path).map_err(|e| e.to_string())?;
        total_bytes += metadata.len();
        if total_bytes > 64 * 1024 * 1024 {
            return Err("The project source exceeds 64 MB. Clean a smaller project.".into());
        }
        if metadata.len() > 16 * 1024 * 1024 {
            return Err(format!(
                "{} is too large to clean safely (16 MB limit).",
                path.strip_prefix(root).unwrap().display()
            )
            .into());
        }
        let content = std::fs::read_to_string(&path)
            .map_err(|e| format!("Could not read {}: {e}", path.display()))?;
        snapshots.insert(path, content);
    }
    Ok(snapshots)
}

fn check_other_libraries(
    root: &Path,
    target: &Path,
    snapshots: &BTreeMap<PathBuf, String>,
    renames: &HashMap<String, String>,
) -> Result<(), DocError> {
    let renamed_targets: std::collections::HashSet<_> =
        renames.values().map(String::as_str).collect();
    for (path, source) in snapshots {
        if path != target && path.extension().and_then(OsStr::to_str) == Some("bib") {
            let raw = RawBibliography::parse(source)
                .map_err(|e| format!("Could not parse {}: {e}", path.display()))?;
            if raw.entries.iter().any(|entry| {
                renames.contains_key(entry.v.key.v) || renamed_targets.contains(entry.v.key.v)
            }) {
                return Err(format!("Citation keys overlap with {}. Give those entries distinct keys before cleaning.", path.strip_prefix(root).unwrap().display()).into());
            }
        }
    }
    Ok(())
}

fn rewrite_project_source(
    source: &str,
    extension: &str,
    relative: &str,
    renames: &HashMap<String, String>,
) -> Result<String, DocError> {
    if extension == "bib" {
        let raw = RawBibliography::parse(source).map_err(|e| e.to_string())?;
        let edits = raw
            .entries
            .into_iter()
            .flat_map(|entry| relation_key_edits(source, entry.v.fields, renames))
            .collect();
        return Ok(edit_text(source, edits));
    }
    let (updated, quoted_reference) = rewrite_citations_with_quotes(source, extension, renames);
    if quoted_reference {
        return Err(format!("{relative} contains a citation key inside quotation marks. Update those references manually before cleaning; quoted text is left unchanged.").into());
    }
    Ok(updated)
}

pub fn plan_project(root: &Path, bib_path: &str) -> Result<CleanPlan, DocError> {
    let target = oleafly_core::resolve_project_path(root, bib_path)
        .map_err(|error| DocError::other(error.to_string()))?;
    if target.extension().and_then(OsStr::to_str) != Some("bib") {
        return Err("Choose a .bib file to clean.".into());
    }
    let paths = project_text_files(root)?;
    if !paths.contains(&target) {
        return Err("The bibliography is not a regular project file.".into());
    }
    let snapshots = read_project_sources(root, paths)?;
    let mut outcome = clean_bibtex_source(
        snapshots
            .get(&target)
            .ok_or("The bibliography is missing.")?,
    )?;
    let renames = citation_renames(&outcome.actions);
    check_other_libraries(root, &target, &snapshots, &renames)?;
    let mut digest = Sha256::new();
    digest.update(bib_path.as_bytes());
    let mut changes = Vec::new();
    for (path, source) in snapshots {
        let relative = path
            .strip_prefix(root)
            .unwrap()
            .to_string_lossy()
            .replace('\\', "/");
        for value in [relative.as_bytes(), source.as_bytes()] {
            digest.update((value.len() as u64).to_le_bytes());
            digest.update(value);
        }
        let updated = if path == target {
            outcome.cleaned.clone()
        } else {
            let extension = path.extension().and_then(OsStr::to_str).unwrap_or("");
            rewrite_project_source(&source, extension, &relative, &renames)?
        };
        if updated != source {
            outcome.changed_files.push(relative);
            changes.push(FileChange {
                path,
                original: source,
                updated,
            });
        }
    }
    outcome.preview_token = format!("{:x}", digest.finalize());
    Ok(CleanPlan {
        root: root.to_path_buf(),
        outcome,
        changes,
    })
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum BackupLocation {
    InProject,
    External(PathBuf),
}

#[cfg(test)]
fn apply_plan(plan: CleanPlan, expected: &str) -> Result<CleanOutcome, DocError> {
    apply_plan_to(plan, expected, &BackupLocation::InProject)
}

pub fn apply_plan_to(
    mut plan: CleanPlan,
    expected: &str,
    backups: &BackupLocation,
) -> Result<CleanOutcome, DocError> {
    if plan.outcome.preview_token != expected {
        return Err(
            "The project changed after the preview. Preview the changes again before applying."
                .into(),
        );
    }
    for change in &plan.changes {
        let current = std::fs::read_to_string(&change.path)
            .map_err(|e| format!("Could not recheck {}: {e}", change.path.display()))?;
        if current != change.original {
            return Err("A source file changed while the cleanup was being prepared. Preview the changes again.".into());
        }
    }
    if !plan.changes.is_empty() {
        let name = format!("reference-clean-{:032x}", rand::random::<u128>());
        let (backup, reported) = match backups {
            BackupLocation::InProject => {
                let relative = format!(".oleafly/backups/{name}");
                (
                    oleafly_core::resolve_project_path(&plan.root, &relative)
                        .map_err(|error| DocError::other(error.to_string()))?,
                    Some(relative),
                )
            }
            BackupLocation::External(directory) => (directory.join(&name), None),
        };
        for change in &plan.changes {
            let destination = backup.join(
                change
                    .path
                    .strip_prefix(&plan.root)
                    .map_err(|e| e.to_string())?,
            );
            std::fs::create_dir_all(destination.parent().unwrap()).map_err(|e| e.to_string())?;
            oleafly_core::atomic::write_atomic(&destination, change.original.as_bytes())?;
        }
        plan.outcome.backup_path = reported;
    }
    let mut staged = Vec::new();
    for change in &plan.changes {
        staged.push(oleafly_core::atomic::stage_beside(
            &change.path,
            change.updated.as_bytes(),
        )?);
    }
    for (index, file) in staged.into_iter().enumerate() {
        if let Err(error) = oleafly_core::atomic::commit_staged(file, &plan.changes[index].path) {
            let mut failures = Vec::new();
            for change in plan.changes[..index].iter().rev() {
                if let Err(rollback) =
                    oleafly_core::atomic::write_atomic(&change.path, change.original.as_bytes())
                {
                    failures.push(rollback.to_string());
                }
            }
            return Err(DocError::other(if failures.is_empty() {
                error.to_string()
            } else {
                format!(
                    "{error}. Some files could not be restored: {}",
                    failures.join("; ")
                )
            }));
        }
    }
    plan.outcome.applied = true;
    Ok(plan.outcome)
}

impl CleanPlan {
    pub fn outcome(&self) -> &CleanOutcome {
        &self.outcome
    }

    pub fn token(&self) -> &str {
        &self.outcome.preview_token
    }

    pub fn changes_files(&self) -> bool {
        !self.changes.is_empty()
    }

    pub fn into_outcome(self) -> CleanOutcome {
        self.outcome
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mapping(pairs: &[(&str, &str)]) -> HashMap<String, String> {
        pairs
            .iter()
            .map(|(a, b)| (a.to_string(), b.to_string()))
            .collect()
    }
    fn article(key: &str, extra: &str) -> String {
        format!("@article{{{key}, author={{Smith, Jane}}, title={{Safe References}}, year={{2020}}, doi={{10.1/test}}, {extra}}}\n")
    }
    #[test]
    fn compatible_duplicates_use_final_key_and_preserve_details() {
        let outcome =
            clean_bibtex_source(&(article("old", "") + &article("richer", "journal={Journal},")))
                .unwrap();
        assert_eq!(outcome.entries_after, 1);
        assert!(outcome.cleaned.contains("Journal"));
        assert_eq!(
            citation_renames(&outcome.actions).get("old").unwrap(),
            "smith2020safe"
        );
        assert_eq!(Bibliography::parse(&outcome.cleaned).unwrap().len(), 1);
    }
    #[test]
    fn conflicting_fields_and_similar_titles_are_kept_for_review() {
        let outcome = clean_bibtex_source(
            &(article("a", "note={keep me},") + &article("b", "note={keep me too},")),
        )
        .unwrap();
        assert_eq!(outcome.entries_after, 2);
        assert!(outcome.cleaned.contains("keep me too"));
        assert!(outcome.actions.iter().any(|a| a.kind == "advisory"));
    }
    #[test]
    fn preserves_comments_preamble_strings_and_entry_formatting() {
        let source = "% notes\n@preamble{\"\\newcommand{\\test}{x}\"}\n@string{j = \"Journal\"}\n@article{old, author={Smith, Jane}, title={Safe References}, year={2020}, journal=j}\n% end\n";
        let out = clean_bibtex_source(source).unwrap();
        assert_eq!(
            out.cleaned,
            source.replace("@article{old,", "@article{smith2020safe,")
        );
    }
    #[test]
    fn entries_linked_by_crossref_or_xdata_are_never_merged() {
        // A child shares its parent's DOI through crossref or xdata. Merging the
        // two pointed the kept entry's link at itself, and parsing that library
        // overflowed the stack.
        let explicit = "@inproceedings{parent, author={Smith, Jane}, title={The Art}, doi={10.1/test},}\n\
                        @inproceedings{k1, author={Smith, Jane}, title={The Art}, doi={10.1/test}, crossref={parent},}";
        let shared = "@xdata{press, publisher={Press}, doi={10.3/x}}\n\
                      @book{uses, xdata={press}, author={Roe, Al}, title={Uses}}";
        let inherited = "@book{book, author={Doe, Ann}, title={Big Book}, doi={10.2/book}}\n\
                         @inbook{chapter, crossref={book}, chapter={3}}";
        for source in [explicit, shared, inherited] {
            let out = clean_bibtex_source(source).unwrap();
            assert_eq!(out.entries_after, 2, "{source}");
            assert!(
                !out.actions
                    .iter()
                    .any(|action| action.kind == "removed-duplicate"
                        || action
                            .field
                            .as_deref()
                            .is_some_and(|note| note.starts_with("Shares a DOI"))),
                "{source}: {:?}",
                out.actions
            );
        }
    }

    #[test]
    fn a_library_that_links_back_to_itself_is_refused() {
        let error = clean_bibtex_source("@book{x, title={T}, crossref={x}}").unwrap_err();
        assert!(
            error.to_string().contains("leads back to itself"),
            "{error}"
        );
    }

    #[test]
    fn rewrites_bibliography_crossrefs() {
        let source = "@proceedings{old,author={Smith, Jane},title={Safe References},year={2020}}\n@inproceedings{child,author={Doe, John},title={Different Paper},crossref={old}}";
        let out = clean_bibtex_source(source).unwrap();
        assert!(out.cleaned.contains("crossref={smith2020safe}"));
    }
    #[test]
    fn replacements_do_not_cascade_or_touch_prose_labels_and_comments() {
        let source = "old \\label{old} \\citep[see][p. 1]{old,other} \\autocites{other}{old}\n% \\cite{old}\n\\verb|\\cite{old}|";
        let out = rewrite_citations(
            source,
            "tex",
            &mapping(&[("old", "other"), ("other", "new")]),
        );
        assert_eq!(out, "old \\label{old} \\citep[see][p. 1]{other,new} \\autocites{new}{other}\n% \\cite{old}\n\\verb|\\cite{old}|");
    }
    #[test]
    fn typst_and_markdown_citations_leave_code_and_email_unchanged() {
        let renames = mapping(&[("old", "new")]);
        assert_eq!(
            rewrite_citations(
                "@old. #cite(<old>) // @old\n`@old` /* @old */",
                "typ",
                &renames
            ),
            "@new. #cite(<new>) // @old\n`@old` /* @old */"
        );
        assert_eq!(
            rewrite_citations(
                "[@old; -@old] @old a@old `@old`\n```\n@old\n```\n<!-- @old -->",
                "md",
                &renames
            ),
            "[@new; -@new] @new a@old `@old`\n```\n@old\n```\n<!-- @old -->"
        );
    }
    #[test]
    fn latex_arguments_do_not_rewrite_styles_macros_or_neighboring_groups() {
        let source = r"\citestyle{old} \cite{old}{old} \citefield{old}{old} \defcitealias{old}{old} \cite{\old} \volcite{old}{old}";
        assert_eq!(
            rewrite_citations(source, "tex", &mapping(&[("old", "new")])),
            r"\citestyle{old} \cite{new}{old} \citefield{new}{old} \defcitealias{new}{old} \cite{\old} \volcite{old}{new}"
        );
        assert_eq!(
            rewrite_citations(
                r#"#let text = "@old" and "@old""#,
                "typ",
                &mapping(&[("old", "new")])
            ),
            r#"#let text = "@old" and "@old""#
        );
    }
    #[test]
    fn typst_quotes_are_preserved_in_all_contexts() {
        let renames = mapping(&[("old", "new")]);
        for source in [
            r#"#show: it => "@old""#,
            r#"#let text = "@old" + "@old""#,
            r#"#let text = if true { "@old" } else { "@old" }"#,
            r#"#let texts = ("@old", "escaped \" @old")"#,
            r#"He said "@old" in quoted prose."#,
            r##"#show: it => "#cite(<old>)""##,
        ] {
            let (updated, ambiguous) = rewrite_citations_with_quotes(source, "typ", &renames);
            assert_eq!(updated, source);
            assert!(ambiguous, "{source}");
        }
        assert_eq!(
            rewrite_citations(r#""ordinary prose" @old "more prose""#, "typ", &renames),
            r#""ordinary prose" @new "more prose""#
        );
    }
    #[test]
    fn quoted_typst_citation_stops_project_cleanup_without_writes() {
        let dir = tempfile::tempdir().unwrap();
        let bib = article("old", "");
        std::fs::write(dir.path().join("refs.bib"), &bib).unwrap();
        std::fs::write(dir.path().join("main.typ"), r#"He said "@old"."#).unwrap();
        assert!(plan_project(dir.path(), "refs.bib")
            .err()
            .unwrap()
            .message
            .contains("quotation marks"));
        assert_eq!(
            std::fs::read_to_string(dir.path().join("refs.bib")).unwrap(),
            bib
        );
        assert!(!dir.path().join(".oleafly").exists());
    }
    #[test]
    fn markdown_indented_and_tilde_code_blocks_are_not_rewritten() {
        let source = "    @old\n\t@old\n  ~~~text\n@old\n   ~~~\n@old";
        assert_eq!(
            rewrite_citations(source, "md", &mapping(&[("old", "new")])),
            "    @old\n\t@old\n  ~~~text\n@old\n   ~~~\n@new"
        );
    }
    #[test]
    fn titles_keep_unicode_and_distinguishing_endings() {
        assert_ne!(normalize_title("研究一"), normalize_title("研究二"));
        let prefix = "An exceptionally long common title which goes on for sixty characters ";
        assert_ne!(
            normalize_title(&format!("{prefix}one")),
            normalize_title(&format!("{prefix}two"))
        );
    }
    #[test]
    fn preview_does_not_write_and_apply_rewrites_nested_sources_and_keeps_backup() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        std::fs::create_dir(root.join("assets")).unwrap();
        let original = article("old", "");
        std::fs::write(root.join("refs.bib"), &original).unwrap();
        std::fs::write(root.join("assets/chapter.tex"), "\\cite{old}").unwrap();
        let plan = plan_project(root, "refs.bib").unwrap();
        assert_eq!(
            std::fs::read_to_string(root.join("refs.bib")).unwrap(),
            original
        );
        assert_eq!(plan.outcome.changed_files.len(), 2);
        let token = plan.outcome.preview_token.clone();
        let outcome = apply_plan(plan, &token).unwrap();
        assert!(outcome.applied);
        assert!(outcome
            .backup_path
            .as_deref()
            .unwrap()
            .starts_with(".oleafly/backups/reference-clean-"));
        assert_eq!(
            std::fs::read_to_string(root.join("assets/chapter.tex")).unwrap(),
            "\\cite{smith2020safe}"
        );
        assert_eq!(
            std::fs::read_to_string(root.join(outcome.backup_path.unwrap()).join("refs.bib"))
                .unwrap(),
            original
        );
    }
    #[test]
    fn external_backups_keep_originals_outside_the_project() {
        let dir = tempfile::tempdir().unwrap();
        let state = tempfile::tempdir().unwrap();
        let root = dir.path();
        let original = article("old", "");
        std::fs::write(root.join("refs.bib"), &original).unwrap();
        std::fs::write(root.join("main.tex"), "\\cite{old}").unwrap();
        let plan = plan_project(root, "refs.bib").unwrap();
        let token = plan.outcome.preview_token.clone();

        let outcome = apply_plan_to(
            plan,
            &token,
            &BackupLocation::External(state.path().join("backups")),
        )
        .unwrap();

        assert!(outcome.applied);
        assert_eq!(outcome.backup_path, None);
        assert!(!root.join(".oleafly").exists());
        let backups: Vec<_> = std::fs::read_dir(state.path().join("backups"))
            .unwrap()
            .flatten()
            .collect();
        assert_eq!(backups.len(), 1);
        assert_eq!(
            std::fs::read_to_string(backups[0].path().join("refs.bib")).unwrap(),
            original
        );
    }

    #[test]
    fn stale_preview_rejects_before_writing() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        std::fs::write(root.join("refs.bib"), article("old", "")).unwrap();
        let token = plan_project(root, "refs.bib")
            .unwrap()
            .outcome
            .preview_token;
        std::fs::write(root.join("new.tex"), "new user content").unwrap();
        assert!(apply_plan(plan_project(root, "refs.bib").unwrap(), &token).is_err());
        assert!(std::fs::read_to_string(root.join("refs.bib"))
            .unwrap()
            .contains("{old,"));
        assert!(!root.join(".oleafly").exists());
    }
    #[test]
    fn external_edit_after_planning_is_preserved() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        let bib = article("old", "");
        std::fs::write(root.join("refs.bib"), &bib).unwrap();
        std::fs::write(root.join("main.tex"), "\\cite{old}").unwrap();
        let plan = plan_project(root, "refs.bib").unwrap();
        let token = plan.outcome.preview_token.clone();
        std::fs::write(root.join("main.tex"), "An external edit").unwrap();
        assert!(apply_plan(plan, &token).is_err());
        assert_eq!(std::fs::read_to_string(root.join("refs.bib")).unwrap(), bib);
        assert_eq!(
            std::fs::read_to_string(root.join("main.tex")).unwrap(),
            "An external edit"
        );
    }
    #[test]
    fn rejects_overlapping_libraries_and_escaping_paths() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("refs.bib"), article("old", "")).unwrap();
        std::fs::write(dir.path().join("other.bib"), article("old", "")).unwrap();
        assert!(plan_project(dir.path(), "refs.bib")
            .err()
            .unwrap()
            .message
            .contains("overlap"));
        assert!(plan_project(dir.path(), "../refs.bib").is_err());
    }
    #[cfg(unix)]
    #[test]
    fn rejects_symlink_bibliography_and_sources() {
        use std::os::unix::fs::symlink;
        let dir = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        std::fs::write(outside.path().join("refs.bib"), article("old", "")).unwrap();
        symlink(outside.path().join("refs.bib"), dir.path().join("refs.bib")).unwrap();
        assert!(plan_project(dir.path(), "refs.bib").is_err());
        std::fs::remove_file(dir.path().join("refs.bib")).unwrap();
        std::fs::write(dir.path().join("refs.bib"), article("old", "")).unwrap();
        symlink(
            outside.path().join("refs.bib"),
            dir.path().join("chapter.tex"),
        )
        .unwrap();
        assert!(plan_project(dir.path(), "refs.bib").is_err());
    }
    #[test]
    fn vendored_typst_packages_are_never_read_or_rewritten() {
        let dir = tempfile::tempdir().unwrap();
        let package = dir.path().join("typst-packages/preview/cetz/0.5.2");
        std::fs::create_dir_all(&package).unwrap();
        std::fs::write(package.join("lib.typ"), "@old").unwrap();
        std::fs::write(package.join("refs.bib"), article("old", "")).unwrap();
        std::fs::create_dir_all(dir.path().join("chapters/typst-packages")).unwrap();
        std::fs::write(dir.path().join("chapters/typst-packages/notes.typ"), "@old").unwrap();
        std::fs::write(dir.path().join("main.typ"), "@old").unwrap();
        let mut files: Vec<String> = project_text_files(dir.path())
            .unwrap()
            .iter()
            .map(|path| {
                path.strip_prefix(dir.path())
                    .unwrap()
                    .to_string_lossy()
                    .replace('\\', "/")
            })
            .collect();
        files.sort();
        assert_eq!(files, ["chapters/typst-packages/notes.typ", "main.typ"]);
    }
    #[cfg(unix)]
    #[test]
    fn refuses_named_pipes_without_opening_them() {
        use std::os::unix::ffi::OsStrExt;
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("blocked.tex");
        let path = std::ffi::CString::new(path.as_os_str().as_bytes()).unwrap();
        // SAFETY: the path is a valid terminated string; mkfifo only creates
        // this test's temporary filesystem entry.
        assert_eq!(unsafe { libc::mkfifo(path.as_ptr(), 0o600) }, 0);
        assert!(project_text_files(dir.path())
            .err()
            .unwrap()
            .contains("not a regular"));
    }
    #[test]
    fn biblatex_date_supplies_the_citation_year() {
        let outcome = clean_bibtex_source(
            "@article{old,author={Smith, Jane},title={Safe References},date={2020-01-05}}",
        )
        .unwrap();
        assert!(outcome.cleaned.contains("smith2020safe"));
        assert!(!outcome
            .actions
            .iter()
            .any(|action| action.field.as_deref() == Some("missing year")));
    }
    #[test]
    fn broken_libraries_error_clearly() {
        assert!(clean_bibtex_source("@article{a,\n title={Unclosed\n}")
            .err()
            .unwrap()
            .message
            .contains("could not be parsed"));
    }
}
