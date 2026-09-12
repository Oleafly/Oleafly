//! On-demand BibTeX library cleaning: normalize citation keys to the app's
//! `firstauthorYEARfirstword` scheme, dedupe compatible DOI entries and flag
//! similar titles. Preview fingerprints the source before citations are updated.

use biblatex::{Bibliography, ChunksExt, Entry, Person, RawBibliography};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, HashMap};
use std::io::Write;
use std::path::{Path, PathBuf};

const FUZZY_TITLE_THRESHOLD: f64 = 0.9;
const YEAR_WINDOW: i64 = 1;

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CleanAction {
    /// "renamed-key" | "removed-duplicate" | "advisory"
    pub kind: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub old: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub new: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub removed: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub kept: Option<String>,
    /// How a duplicate was detected: "doi", "title", or "similar title".
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

#[derive(serde::Serialize)]
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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub project_state: Option<crate::project::ProjectStateChanged>,
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
        .map(|y| crate::citation::year_of(&y))
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

/// Suffix a/b/... when a normalized key collides, mirroring the TS
/// collisionSuffix helper.
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

/// Apply disjoint edits against the original text, so a renamed key cannot
/// accidentally be rewritten again by a later mapping.
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

fn rewrite_citations_with_quotes(
    source: &str,
    extension: &str,
    renames: &HashMap<String, String>,
) -> (String, bool) {
    let mut quoted_reference = false;
    // Mask comments and code without changing byte offsets. The original text
    // supplies every replacement, preserving formatting and comment contents.
    let mut masked = source.as_bytes().to_vec();
    let mut i = 0;
    while i < masked.len() {
        let tail = &source[i..];
        let skip = if extension == "tex" && tail.starts_with('%') {
            Some(tail.find('\n').unwrap_or(tail.len()))
        } else if extension == "tex"
            && tail.starts_with("\\verb")
            && tail
                .as_bytes()
                .get(5)
                .is_some_and(|c| !c.is_ascii_alphabetic())
        {
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
        } else if extension == "tex"
            && ["verbatim", "Verbatim", "lstlisting", "minted", "comment"]
                .iter()
                .any(|env| tail.starts_with(&format!("\\begin{{{env}}}")))
        {
            ["verbatim", "Verbatim", "lstlisting", "minted", "comment"]
                .iter()
                .find_map(|env| {
                    let end = format!("\\end{{{env}}}");
                    tail.starts_with(&format!("\\begin{{{env}}}"))
                        .then(|| tail.find(&end).map_or(tail.len(), |n| n + end.len()))
                })
        } else if extension != "tex" && tail.starts_with('`') {
            let count = tail.bytes().take_while(|b| *b == b'`').count();
            let fence = "`".repeat(count);
            Some(
                tail[count..]
                    .find(&fence)
                    .map_or(tail.len(), |n| n + 2 * count),
            )
        } else if extension == "typ" && tail.starts_with('"') {
            let mut end = i + 1;
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
            // Quotes may delimit code strings or quoted markup. Preserve
            // both, and refuse a project rewrite if that ambiguity could
            // leave a renamed citation unresolved.
            let quoted = &source[i..end];
            for (at, marker) in quoted
                .char_indices()
                .filter(|(_, ch)| matches!(ch, '@' | '<'))
            {
                if marker == '@' && at > 0 && quoted[..at].chars().next_back().is_some_and(key_char)
                {
                    continue;
                }
                let start = at + 1;
                let mut stop = start;
                for ch in quoted[start..].chars().take_while(|ch| key_char(*ch)) {
                    stop += ch.len_utf8();
                }
                while stop > start
                    && !renames.contains_key(&quoted[start..stop])
                    && quoted.as_bytes()[stop - 1] == b'.'
                {
                    stop -= 1;
                }
                if renames.contains_key(&quoted[start..stop]) {
                    quoted_reference = true;
                }
            }
            Some(end - i)
        } else if extension == "md"
            && (i == 0 || source.as_bytes()[i - 1] == b'\n')
            && (tail.starts_with("    ") || tail.starts_with('\t'))
        {
            Some(tail.find('\n').unwrap_or(tail.len()))
        } else if extension == "md"
            && (i == 0 || source.as_bytes()[i - 1] == b'\n')
            && tail.trim_start_matches(' ').starts_with("~~~")
        {
            let opening = tail.trim_start_matches(' ');
            let count = opening.bytes().take_while(|b| *b == b'~').count();
            let mut length = tail.find('\n').map_or(tail.len(), |n| n + 1);
            for line in tail[length..].split_inclusive('\n') {
                length += line.len();
                let closing = line.trim_start_matches(' ');
                let closing_count = closing.bytes().take_while(|b| *b == b'~').count();
                if line.len() - closing.len() <= 3
                    && closing_count >= count
                    && closing[closing_count..].trim().is_empty()
                {
                    break;
                }
            }
            Some(length)
        } else if extension == "md" && tail.starts_with("<!--") {
            Some(tail.find("-->").map_or(tail.len(), |n| n + 3))
        } else if extension == "typ" && tail.starts_with("//") {
            Some(tail.find('\n').unwrap_or(tail.len()))
        } else if extension == "typ" && tail.starts_with("/*") {
            let mut depth = 1;
            let mut end = i + 2;
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
            Some(end - i)
        } else {
            None
        };
        if let Some(length) = skip {
            masked[i..i + length].fill(b' ');
            i += length;
        } else if tail.starts_with('\\')
            && !tail.starts_with("\\cite")
            && tail
                .as_bytes()
                .get(1)
                .is_some_and(|b| !b.is_ascii_alphabetic())
        {
            i += 1 + tail[1..].chars().next().map_or(0, char::len_utf8);
        } else {
            i += tail.chars().next().unwrap().len_utf8();
        }
    }
    let mask = String::from_utf8(masked).expect("mask preserves UTF-8");
    let mut edits = Vec::new();
    if extension == "tex" {
        let bytes = mask.as_bytes();
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
            let command = mask[start..cursor].to_ascii_lowercase();
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
                continue;
            }
            let multiple = command != single;
            let volume = single.ends_with("volcite");
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
                if depth > 0 {
                    break;
                }
                if open == b'{' {
                    arguments += 1;
                    if !volume || arguments % 2 == 0 {
                        edits.extend(citation_argument_edits(
                            &source[start..cursor],
                            start,
                            renames,
                        ));
                    }
                }
                cursor += 1;
                if !multiple && arguments >= if volume { 2 } else { 1 } {
                    break;
                }
            }
        }
    } else {
        for (at, _) in mask.match_indices('@') {
            let suppressed_author = extension == "md"
                && at > 0
                && source.as_bytes()[at - 1] == b'-'
                && (at == 1
                    || source[..at - 1]
                        .chars()
                        .next_back()
                        .is_some_and(|c| !key_char(c)));
            if !suppressed_author
                && at > 0
                && source[..at]
                    .chars()
                    .next_back()
                    .is_some_and(|c| key_char(c) || c == '\\' || c == '@')
            {
                continue;
            }
            let start = at + 1;
            let mut end = start;
            for ch in source[start..].chars().take_while(|c| key_char(*c)) {
                end += ch.len_utf8();
            }
            // A sentence-ending period is not part of a citation unless that
            // exact key exists in the plan.
            while end > start
                && !renames.contains_key(&source[start..end])
                && source.as_bytes()[end - 1] == b'.'
            {
                end -= 1;
            }
            if let Some(new) = renames.get(&source[start..end]) {
                edits.push((start..end, new.clone()));
            }
        }
        if extension == "typ" {
            for (at, _) in mask.match_indices("cite") {
                if at > 0 && mask[..at].chars().next_back().is_some_and(key_char) {
                    continue;
                }
                let tail = &mask[at + 4..];
                let tail = tail.trim_start();
                let Some(tail) = tail.strip_prefix('(').map(str::trim_start) else {
                    continue;
                };
                let Some(key) = tail.strip_prefix('<') else {
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
        }
    }
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
                crate::sandbox::resolve_within(
                    root,
                    &path.strip_prefix(root).unwrap().to_string_lossy(),
                )?;
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

/// The pure cleaning pass: parse `source`, plan every action, and emit the
/// rewritten library. Exposed separately so it is unit-testable.
pub(crate) fn clean_bibtex_source(source: &str) -> Result<CleanOutcome, String> {
    let bib =
        Bibliography::parse(source).map_err(|e| format!("the library could not be parsed: {e}"))?;
    let entries_before = bib.len();
    if let Some(entry) = bib.iter().find(|entry| !entry.key.chars().all(key_char)) {
        return Err(format!("Citation key {} uses punctuation that cannot be rewritten safely. Rename it before cleaning.", entry.key));
    }
    let mut actions: Vec<CleanAction> = Vec::new();

    let raw = RawBibliography::parse(source).map_err(|e| e.to_string())?;
    let commented: std::collections::HashSet<_> = raw
        .entries
        .iter()
        .filter(|entry| source[entry.span.clone()].contains('%'))
        .map(|entry| entry.v.key.v)
        .collect();
    let mut kept: Vec<Entry> = Vec::new();
    let mut seen_dois: HashMap<String, usize> = HashMap::new();
    // Only remove entries whose fields are fully preserved by their keeper.
    // Similar titles are review hints; they are not sufficient evidence to
    // delete a reference, especially across editions or different authors.
    for entry in bib.into_iter() {
        let doi = field_string(&entry, "doi")
            .map(|d| normalize_doi(&d))
            .filter(|d| !d.is_empty());
        if let Some(index) = doi.as_ref().and_then(|doi| seen_dois.get(doi)).copied() {
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
            seen_dois.insert(doi, kept.len());
        }
        kept.push(entry);
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
    // Bound expensive fuzzy comparisons in large libraries; exact DOI matching
    // remains linear regardless of library size.
    if kept.len() <= 500 {
        let mut flagged_titles = std::collections::HashSet::new();
        for i in 0..kept.len() {
            for j in i + 1..kept.len() {
                if flagged_titles.contains(&j) {
                    continue;
                }
                let (a, year_a) = &titles[i];
                let (b, year_b) = &titles[j];
                if !a.is_empty()
                    && !b.is_empty()
                    && a.len() <= 1_000
                    && b.len() <= 1_000
                    && (year_a == &0 || year_b == &0 || (year_a - year_b).abs() <= YEAR_WINDOW)
                    && rapidfuzz::distance::levenshtein::normalized_similarity(a.chars(), b.chars())
                        >= FUZZY_TITLE_THRESHOLD
                {
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
    } else {
        actions.push(CleanAction::advisory(
            String::new(),
            "Title comparisons were skipped because this library has more than 500 entries.".into(),
        ));
    }

    // Pass 3: rename keys to the app scheme, keeping each key unique.
    let mut taken: std::collections::HashSet<String> =
        kept.iter().map(|entry| entry.key.clone()).collect();
    for entry in &mut kept {
        let (entry_key, author, year, title, has_author, has_title) = {
            (
                entry.key.clone(),
                author_string(entry),
                year_string(entry),
                field_string(entry, "title").unwrap_or_default(),
                field_string(entry, "author").is_some(),
                field_string(entry, "title").is_some(),
            )
        };
        if !has_author {
            actions.push(CleanAction::advisory(
                entry_key.clone(),
                "missing author".into(),
            ));
        }
        if !has_title {
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
        let desired = crate::citation::cite_key(&author, &year, &title);
        if desired.is_empty() || desired == entry_key {
            taken.insert(entry_key);
            continue;
        }
        taken.remove(&entry_key);
        let mut final_key = desired.clone();
        let mut n = 0;
        while taken.contains(&final_key) {
            final_key = format!("{}{}", desired, collision_suffix(n));
            n += 1;
        }
        actions.push(CleanAction::renamed_key(entry_key, final_key.clone()));
        entry.key = final_key.clone();
        taken.insert(final_key);
    }

    let renames = citation_renames(&actions);
    let removed: std::collections::HashSet<_> = actions
        .iter()
        .filter_map(|a| a.removed.as_deref())
        .collect();
    let mut edits = Vec::new();
    for entry in raw.entries {
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
        for field in entry.v.fields {
            if matches!(
                field.key.v.to_ascii_lowercase().as_str(),
                "crossref" | "xref" | "xdata" | "related" | "entryset"
            ) {
                edits.extend(key_edits(
                    &source[field.value.span.clone()],
                    field.value.span.start,
                    &renames,
                ));
            }
        }
    }
    let cleaned = edit_text(source, edits);
    Bibliography::parse(&cleaned)
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
        project_state: None,
    })
}

struct FileChange {
    path: PathBuf,
    original: String,
    updated: String,
}
struct CleanPlan {
    root: PathBuf,
    outcome: CleanOutcome,
    changes: Vec<FileChange>,
}

fn plan_project(root: &Path, bib_path: &str) -> Result<CleanPlan, String> {
    let target = crate::sandbox::resolve_within(root, bib_path)?;
    if target.extension().and_then(|e| e.to_str()) != Some("bib") {
        return Err("Choose a .bib file to clean.".into());
    }
    let paths = project_text_files(root)?;
    if !paths.contains(&target) {
        return Err("The bibliography is not a regular project file.".into());
    }
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
            ));
        }
        let content = std::fs::read_to_string(&path)
            .map_err(|e| format!("Could not read {}: {e}", path.display()))?;
        snapshots.insert(path, content);
    }
    let mut outcome = clean_bibtex_source(
        snapshots
            .get(&target)
            .ok_or("The bibliography is missing.")?,
    )?;
    let renames = citation_renames(&outcome.actions);
    let renamed_targets: std::collections::HashSet<_> =
        renames.values().map(String::as_str).collect();
    // A key shared by another library is ambiguous. Preserve both libraries
    // and ask the user to resolve the collision before rewriting citations.
    for (path, source) in &snapshots {
        if path != &target && path.extension().and_then(|e| e.to_str()) == Some("bib") {
            let raw = RawBibliography::parse(source)
                .map_err(|e| format!("Could not parse {}: {e}", path.display()))?;
            if raw.entries.iter().any(|entry| {
                renames.contains_key(entry.v.key.v) || renamed_targets.contains(entry.v.key.v)
            }) {
                return Err(format!("Citation keys overlap with {}. Give those entries distinct keys before cleaning.", path.strip_prefix(root).unwrap().display()));
            }
        }
    }
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
        let extension = path.extension().and_then(|e| e.to_str()).unwrap_or("");
        let updated = if path == target {
            outcome.cleaned.clone()
        } else if extension == "bib" {
            let raw = RawBibliography::parse(&source).map_err(|e| e.to_string())?;
            let mut edits = Vec::new();
            for entry in raw.entries {
                for field in entry.v.fields {
                    if matches!(
                        field.key.v.to_ascii_lowercase().as_str(),
                        "crossref" | "xref" | "xdata" | "related" | "entryset"
                    ) {
                        edits.extend(key_edits(
                            &source[field.value.span.clone()],
                            field.value.span.start,
                            &renames,
                        ));
                    }
                }
            }
            edit_text(&source, edits)
        } else {
            let (updated, quoted_reference) =
                rewrite_citations_with_quotes(&source, extension, &renames);
            if quoted_reference {
                return Err(format!("{relative} contains a citation key inside quotation marks. Update those references manually before cleaning; quoted text is left unchanged."));
            }
            updated
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

fn apply_plan(mut plan: CleanPlan, expected: &str) -> Result<CleanOutcome, String> {
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
        let relative = format!(
            ".oleafly/backups/reference-clean-{:032x}",
            rand::random::<u128>()
        );
        let backup = crate::sandbox::resolve_within(&plan.root, &relative)?;
        for change in &plan.changes {
            let destination = backup.join(
                change
                    .path
                    .strip_prefix(&plan.root)
                    .map_err(|e| e.to_string())?,
            );
            std::fs::create_dir_all(destination.parent().unwrap()).map_err(|e| e.to_string())?;
            crate::sandbox::atomic_write(&destination, change.original.as_bytes())?;
        }
        plan.outcome.backup_path = Some(relative);
    }
    // Stage every replacement before touching any destination. Keep originals
    // for rollback if publishing a later file fails.
    let mut staged = Vec::new();
    for change in &plan.changes {
        let mut file = crate::sandbox::AtomicFile::new(&change.path)?;
        file.staging_file_mut()
            .write_all(change.updated.as_bytes())
            .map_err(|e| e.to_string())?;
        staged.push(file);
    }
    for (index, file) in staged.into_iter().enumerate() {
        if let Err(error) = file.commit() {
            let mut failures = Vec::new();
            for change in plan.changes[..index].iter().rev() {
                if let Err(rollback) =
                    crate::sandbox::atomic_write(&change.path, change.original.as_bytes())
                {
                    failures.push(rollback);
                }
            }
            return Err(if failures.is_empty() {
                error
            } else {
                format!(
                    "{error}. Some files could not be restored: {}",
                    failures.join("; ")
                )
            });
        }
    }
    plan.outcome.applied = true;
    Ok(plan.outcome)
}

/// Preview is read-only. Apply must carry the reviewed snapshot token and uses
/// the same project mutation barrier as saves, restores and task application.
#[tauri::command]
pub async fn clean_bibtex_library(
    app: tauri::AppHandle,
    state: tauri::State<'_, crate::state::AppState>,
    project_id: String,
    bib_path: String,
    apply: bool,
    preview_token: Option<String>,
    expected_generation: Option<u64>,
) -> Result<CleanOutcome, String> {
    if !apply {
        return tauri::async_runtime::spawn_blocking(move || {
            let _lock = crate::worktree_lock::ProjectWorktreeLock::shared(&project_id)?;
            let root = crate::paths::project_dir(&project_id)?;
            Ok(plan_project(&root, &bib_path)?.outcome)
        })
        .await
        .map_err(|e| e.to_string())?;
    }
    let token = preview_token.ok_or("Preview the changes before applying them.")?;
    let mutation = crate::project::mutate_project_worktree(
        &state,
        project_id.clone(),
        expected_generation,
        move |root| {
            let plan = plan_project(root, &bib_path)?;
            let changed = !plan.changes.is_empty();
            Ok((apply_plan(plan, &token)?, changed))
        },
    )
    .await?;
    let event = crate::project::publish_project_state_changed(
        &app,
        &state,
        &project_id,
        mutation.project,
        "clean-reference-library",
        true,
        Some(mutation.generation),
    )?;
    let mut outcome = mutation.value?;
    outcome.project_state = Some(event);
    Ok(outcome)
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
            .contains("could not be parsed"));
    }
}
