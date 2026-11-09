use std::collections::{BTreeMap, HashMap, HashSet};
use std::sync::{Arc, LazyLock, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;
use unicode_normalization::char::{decompose_canonical, is_combining_mark};

const DEFAULT_LIMIT: usize = 50;
const MAX_LIMIT: usize = 1000;
const MAX_SNIPPETS: usize = 3;
const SNIPPET_CHARS: usize = 140;
const SNIPPET_LEAD: usize = 40;
const SNAP_CHARS: usize = 16;
const MAX_TERMS: usize = 32;
const MAX_QUERY_CHARS: usize = 1000;
const MAX_COUNTED: usize = 64;
const MAX_LINE_SCAN: usize = 256;
const TITLE_WEIGHT: f64 = 1000.0;
const PHRASE_IN_TITLE_BONUS: f64 = 500.0;
const CJK_START: u32 = 0x2E80;

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct NoteSearchSnippet {
    pub text: String,
    pub ranges: Vec<[u32; 2]>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteSearchHit {
    pub id: String,
    pub note_id: Option<String>,
    pub title: String,
    pub title_ranges: Vec<[u32; 2]>,
    pub score: f64,
    pub snippets: Vec<NoteSearchSnippet>,
    pub tags: Vec<String>,
    pub aliases: Vec<String>,
    pub related_project: Option<String>,
    pub updated_at: f64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct NoteTagCount {
    pub tag: String,
    pub label: String,
    pub count: u32,
    pub notes: Vec<String>,
}

#[derive(Debug, PartialEq)]
pub(crate) struct ParsedNote {
    note_id: Option<String>,
    tags: Vec<String>,
    tag_labels: Vec<String>,
    aliases: Vec<String>,
    folded_aliases: Vec<String>,
    plain: String,
    plain_lines: Vec<(usize, usize)>,
    folded: String,
    folded_starts: Vec<usize>,
}

#[derive(Debug, Clone)]
pub(crate) struct IndexedNote {
    id: String,
    title: String,
    related_project: Option<String>,
    updated_at: f64,
    parsed: Arc<ParsedNote>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Field {
    Any,
    Title,
    Tag,
    Project,
    Is,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct Term {
    field: Field,
    value: String,
    phrase: bool,
    negated: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub(crate) struct Query {
    terms: Vec<Term>,
}

static CACHE: crate::note_index::ParsedCache<ParsedNote> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

#[tauri::command]
pub async fn note_search(query: String, limit: Option<u32>) -> Result<Vec<NoteSearchHit>, String> {
    tauri::async_runtime::spawn_blocking(move || note_search_blocking(&query, limit))
        .await
        .map_err(|error| format!("note search failed: {error}"))?
}

#[tauri::command]
pub async fn note_tags() -> Result<Vec<NoteTagCount>, String> {
    tauri::async_runtime::spawn_blocking(note_tags_blocking)
        .await
        .map_err(|error| format!("listing note tags failed: {error}"))?
}

pub(crate) fn note_search_blocking(
    query: &str,
    limit: Option<u32>,
) -> Result<Vec<NoteSearchHit>, String> {
    let query = parse_query(query);
    if query.terms.is_empty() {
        return Ok(Vec::new());
    }
    let limit = limit
        .map_or(DEFAULT_LIMIT, |limit| limit as usize)
        .clamp(1, MAX_LIMIT);
    Ok(search(&indexed_notes()?, &query, limit))
}

pub(crate) fn note_tags_blocking() -> Result<Vec<NoteTagCount>, String> {
    Ok(count_tags(&indexed_notes()?))
}

pub(crate) fn indexed_notes() -> Result<Vec<IndexedNote>, String> {
    let entries = crate::note_index::notes()?;
    let mut seen = HashSet::new();
    let mut notes = Vec::new();
    for entry in entries.iter() {
        match crate::note_index::read_parsed(
            &CACHE,
            entry,
            crate::note_index::LockMode::Try,
            parse_note,
        ) {
            Ok(Some((path, parsed, key))) => {
                seen.insert(path);
                notes.push(IndexedNote {
                    id: entry.id.clone(),
                    title: entry.title.clone(),
                    related_project: entry.related_project.clone(),
                    updated_at: key.modified().map_or(entry.updated_at, seconds),
                    parsed,
                });
            }
            Ok(None) => {}
            Err(error) => {
                let _ = crate::project::append_app_log(format!(
                    "Skipping note {:?} in search: {error}",
                    entry.id
                ));
            }
        }
    }
    crate::note_index::keep_only(&CACHE, &seen);
    Ok(notes)
}

fn seconds(time: SystemTime) -> f64 {
    time.duration_since(UNIX_EPOCH)
        .map_or(0.0, |duration| duration.as_secs_f64())
}

fn count_tags(notes: &[IndexedNote]) -> Vec<NoteTagCount> {
    let mut tags: BTreeMap<String, NoteTagCount> = BTreeMap::new();
    for note in notes {
        for (tag, label) in note.parsed.tags.iter().zip(&note.parsed.tag_labels) {
            let entry = tags.entry(tag.clone()).or_insert_with(|| NoteTagCount {
                tag: tag.clone(),
                label: label.clone(),
                count: 0,
                notes: Vec::new(),
            });
            entry.count += 1;
            entry.notes.push(note.id.clone());
        }
    }
    tags.into_values().collect()
}

pub(crate) fn fold_char(c: char, out: &mut String) {
    match c {
        '\n' => out.push('\n'),
        'ß' | 'ẞ' => out.push_str("ss"),
        'æ' | 'Æ' => out.push_str("ae"),
        'œ' | 'Œ' => out.push_str("oe"),
        'ø' | 'Ø' => out.push('o'),
        'ł' | 'Ł' => out.push('l'),
        'đ' | 'Đ' => out.push('d'),
        'ı' => out.push('i'),
        _ if c.is_ascii() => out.push(c.to_ascii_lowercase()),
        _ if c.is_whitespace() => out.push(' '),
        _ if strips_marks(c) => {
            for lower in c.to_lowercase() {
                decompose_canonical(lower, |part| {
                    if !is_combining_mark(part) {
                        out.push(part);
                    }
                });
            }
        }
        _ => out.extend(c.to_lowercase()),
    }
}

fn strips_marks(c: char) -> bool {
    let code = c as u32;
    code < 0x0530 || (0x1E00..=0x1FFF).contains(&code)
}

pub(crate) fn fold(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for c in text.chars() {
        fold_char(c, &mut out);
    }
    out
}

fn fold_mapped(chars: &[char]) -> (String, Vec<usize>) {
    let mut folded = String::with_capacity(chars.len());
    let mut origin = Vec::with_capacity(chars.len() + 1);
    for (index, c) in chars.iter().enumerate() {
        let before = folded.len();
        fold_char(*c, &mut folded);
        origin.extend(std::iter::repeat_n(index, folded.len() - before));
    }
    origin.push(chars.len());
    (folded, origin)
}

fn is_wordy(c: char) -> bool {
    c.is_alphanumeric() && (c as u32) < CJK_START
}

fn bounded_at(hay: &str, start: usize, end: usize, needle: &str) -> bool {
    let first = needle.chars().next().is_some_and(is_wordy);
    let last = needle.chars().next_back().is_some_and(is_wordy);
    let before_ok = !first || !hay[..start].chars().next_back().is_some_and(is_wordy);
    let after_ok = !last || !hay[end..].chars().next().is_some_and(is_wordy);
    before_ok && after_ok
}

fn find_all(hay: &str, needle: &str, bounded: bool, cap: usize) -> Vec<usize> {
    if needle.is_empty() {
        return Vec::new();
    }
    hay.match_indices(needle)
        .map(|(start, _)| start)
        .filter(|start| !bounded || bounded_at(hay, *start, start + needle.len(), needle))
        .take(cap)
        .collect()
}

fn contains(hay: &str, needle: &str, bounded: bool) -> bool {
    !find_all(hay, needle, bounded, 1).is_empty()
}

fn at_word_start(hay: &str, needle: &str, bounded: bool) -> bool {
    find_all(hay, needle, bounded, MAX_COUNTED)
        .into_iter()
        .any(|start| !hay[..start].chars().next_back().is_some_and(is_wordy))
}

pub(crate) fn parse_query(input: &str) -> Query {
    let chars: Vec<char> = input.chars().take(MAX_QUERY_CHARS).collect();
    let mut terms = Vec::new();
    let mut index = 0;
    while index < chars.len() && terms.len() < MAX_TERMS {
        if chars[index].is_whitespace() {
            index += 1;
            continue;
        }
        let negated = chars[index] == '-'
            && chars
                .get(index + 1)
                .is_some_and(|next| !next.is_whitespace());
        if negated {
            index += 1;
        }
        let (field, skip) = field_at(&chars[index..]);
        index += skip;
        let (raw, phrase, next) = if chars.get(index) == Some(&'"') {
            let close = chars[index + 1..]
                .iter()
                .position(|c| *c == '"')
                .map_or(chars.len(), |offset| index + 1 + offset);
            let raw: String = chars[index + 1..close].iter().collect();
            (raw, true, (close + 1).min(chars.len()))
        } else {
            let end = chars[index..]
                .iter()
                .position(|c| c.is_whitespace())
                .map_or(chars.len(), |offset| index + offset);
            (chars[index..end].iter().collect(), false, end)
        };
        index = next;
        let value = normalize_value(field, &raw);
        if !value.is_empty() {
            terms.push(Term {
                field,
                value,
                phrase,
                negated,
            });
        }
    }
    Query { terms }
}

fn field_at(chars: &[char]) -> (Field, usize) {
    for (name, field) in [
        ("tag", Field::Tag),
        ("title", Field::Title),
        ("project", Field::Project),
        ("is", Field::Is),
    ] {
        let len = name.len();
        let matches = chars.len() > len
            && chars[len] == ':'
            && chars[..len]
                .iter()
                .zip(name.chars())
                .all(|(a, b)| a.to_ascii_lowercase() == b);
        if matches {
            return (field, len + 1);
        }
    }
    (Field::Any, 0)
}

fn normalize_value(field: Field, raw: &str) -> String {
    match field {
        Field::Any | Field::Title => {
            let words: Vec<&str> = raw.split_whitespace().collect();
            fold(&words.join(" ")).trim().to_string()
        }
        Field::Tag => raw
            .trim()
            .trim_start_matches('#')
            .trim_matches('/')
            .to_lowercase(),
        Field::Project => raw.trim().to_string(),
        Field::Is => raw.trim().to_lowercase(),
    }
}

fn has_tag(tags: &[String], wanted: &str) -> bool {
    tags.iter().any(|tag| {
        tag == wanted
            || tag
                .strip_prefix(wanted)
                .is_some_and(|rest| rest.starts_with('/'))
    })
}

fn title_score(title: &str, term: &Term) -> f64 {
    if term.value == title {
        4.0
    } else if at_word_start(title, &term.value, term.phrase) {
        3.0
    } else if contains(title, &term.value, term.phrase) {
        2.0
    } else {
        0.0
    }
}

fn names_score(title: &str, aliases: &[String], term: &Term) -> f64 {
    let alias = aliases
        .iter()
        .map(|alias| title_score(alias, term) - 0.5)
        .fold(0.0, f64::max);
    title_score(title, term).max(alias)
}

fn evaluate(note: &IndexedNote, folded_title: &str, query: &Query) -> Option<f64> {
    let parsed = &note.parsed;
    let mut score = 0.0;
    let mut positive = Vec::new();
    for term in &query.terms {
        let matched = match term.field {
            Field::Any => {
                let names = names_score(folded_title, &parsed.folded_aliases, term);
                let found = find_all(&parsed.folded, &term.value, term.phrase, MAX_COUNTED);
                let count = found.len();
                if !term.negated {
                    let whole = found.iter().any(|start| {
                        bounded_at(
                            &parsed.folded,
                            *start,
                            start + term.value.len(),
                            &term.value,
                        )
                    });
                    let body = if count > 0 {
                        (1.0 + (count as f64).log2()).min(9.0) + if whole { 0.5 } else { 0.0 }
                    } else {
                        0.0
                    };
                    score += names * TITLE_WEIGHT + body;
                    positive.push(term.value.as_str());
                }
                names > 0.0 || count > 0
            }
            Field::Title => {
                let names = names_score(folded_title, &parsed.folded_aliases, term);
                if !term.negated {
                    score += names * TITLE_WEIGHT;
                }
                names > 0.0
            }
            Field::Tag => has_tag(&parsed.tags, &term.value),
            Field::Project => note.related_project.as_deref() == Some(term.value.as_str()),
            Field::Is => !term.negated,
        };
        if matched == term.negated {
            return None;
        }
    }
    if positive.len() > 1 && folded_title.contains(&positive.join(" ")) {
        score += PHRASE_IN_TITLE_BONUS;
    }
    Some(score)
}

pub(crate) fn search(notes: &[IndexedNote], query: &Query, limit: usize) -> Vec<NoteSearchHit> {
    let mut ranked: Vec<(f64, &IndexedNote)> = notes
        .iter()
        .filter_map(|note| evaluate(note, &fold(&note.title), query).map(|score| (score, note)))
        .collect();
    ranked.sort_by(|(left_score, left), (right_score, right)| {
        right_score
            .total_cmp(left_score)
            .then(right.updated_at.total_cmp(&left.updated_at))
            .then_with(|| left.title.cmp(&right.title))
            .then_with(|| left.id.cmp(&right.id))
    });
    ranked.truncate(limit);
    let body_terms: Vec<&Term> = query
        .terms
        .iter()
        .filter(|term| term.field == Field::Any && !term.negated)
        .collect();
    let title_terms: Vec<&Term> = query
        .terms
        .iter()
        .filter(|term| matches!(term.field, Field::Any | Field::Title) && !term.negated)
        .collect();
    ranked
        .into_iter()
        .map(|(score, note)| {
            let title: Vec<char> = note.title.chars().collect();
            NoteSearchHit {
                id: note.id.clone(),
                note_id: note.parsed.note_id.clone(),
                title_ranges: utf16_ranges(&title, 0, &highlights(&title, &title_terms), 0),
                title: note.title.clone(),
                score,
                snippets: snippets(&note.parsed, &body_terms),
                tags: note.parsed.tags.clone(),
                aliases: note.parsed.aliases.clone(),
                related_project: note.related_project.clone(),
                updated_at: note.updated_at,
            }
        })
        .collect()
}

fn highlights(chars: &[char], terms: &[&Term]) -> Vec<(usize, usize)> {
    let (folded, origin) = fold_mapped(chars);
    let mut ranges: Vec<(usize, usize)> = terms
        .iter()
        .flat_map(|term| {
            find_all(&folded, &term.value, term.phrase, MAX_LINE_SCAN)
                .into_iter()
                .map(|start| {
                    let end = start + term.value.len();
                    (origin[start], (origin[end - 1] + 1).max(origin[end]))
                })
        })
        .collect();
    ranges.sort_unstable();
    let mut merged: Vec<(usize, usize)> = Vec::new();
    for (start, end) in ranges {
        match merged.last_mut() {
            Some(last) if start <= last.1 => last.1 = last.1.max(end),
            _ => merged.push((start, end)),
        }
    }
    merged
}

fn utf16_ranges(
    chars: &[char],
    window_start: usize,
    ranges: &[(usize, usize)],
    prefix: u32,
) -> Vec<[u32; 2]> {
    let window_end = window_start + chars.len();
    let mut units = Vec::with_capacity(chars.len() + 1);
    let mut total = prefix;
    units.push(total);
    for c in chars {
        total += c.len_utf16() as u32;
        units.push(total);
    }
    ranges
        .iter()
        .filter(|(start, end)| *end > window_start && *start < window_end)
        .map(|(start, end)| {
            let start = start.max(&window_start) - window_start;
            let end = end.min(&window_end) - window_start;
            [units[start], units[end]]
        })
        .collect()
}

fn snippets(note: &ParsedNote, terms: &[&Term]) -> Vec<NoteSearchSnippet> {
    let mut lines: BTreeMap<usize, u64> = BTreeMap::new();
    for (bit, term) in terms.iter().enumerate() {
        for start in find_all(&note.folded, &term.value, term.phrase, MAX_LINE_SCAN) {
            let line = note.folded_starts.partition_point(|line| *line <= start) - 1;
            *lines.entry(line).or_default() |= 1 << bit.min(63);
        }
    }
    let mut chosen: Vec<(usize, u32)> = lines
        .into_iter()
        .map(|(line, mask)| (line, mask.count_ones()))
        .collect();
    chosen.sort_by(|(left, left_terms), (right, right_terms)| {
        right_terms.cmp(left_terms).then(left.cmp(right))
    });
    let mut out: Vec<NoteSearchSnippet> = chosen
        .into_iter()
        .take(MAX_SNIPPETS)
        .map(|(line, _)| {
            let (start, end) = note.plain_lines[line];
            let chars: Vec<char> = note.plain[start..end].chars().collect();
            let ranges = highlights(&chars, terms);
            snippet(&chars, &ranges)
        })
        .collect();
    if out.is_empty() {
        if let Some((start, end)) = note.plain_lines.first() {
            let chars: Vec<char> = note.plain[*start..*end].chars().collect();
            out.push(snippet(&chars, &[]));
        }
    }
    out
}

fn snippet(chars: &[char], ranges: &[(usize, usize)]) -> NoteSearchSnippet {
    if chars.len() <= SNIPPET_CHARS {
        return NoteSearchSnippet {
            text: chars.iter().collect(),
            ranges: utf16_ranges(chars, 0, ranges, 0),
        };
    }
    let first = ranges.first().map_or(0, |range| range.0);
    let mut start = first
        .saturating_sub(SNIPPET_LEAD)
        .min(chars.len() - SNIPPET_CHARS);
    if start > 0 {
        if let Some(space) = chars[start..first].iter().position(|c| *c == ' ') {
            if space < SNAP_CHARS {
                start += space + 1;
            }
        }
    }
    let mut end = (start + SNIPPET_CHARS).min(chars.len());
    if end < chars.len() {
        if let Some(space) = chars[start..end].iter().rposition(|c| *c == ' ') {
            if start + space + SNAP_CHARS > end && start + space > first {
                end = start + space;
            }
        }
    }
    let lead = if start > 0 { "…" } else { "" };
    let tail = if end < chars.len() { "…" } else { "" };
    let window = &chars[start..end];
    NoteSearchSnippet {
        text: format!("{lead}{}{tail}", window.iter().collect::<String>()),
        ranges: utf16_ranges(window, start, ranges, lead.encode_utf16().count() as u32),
    }
}

pub(crate) fn parse_note(text: &str) -> ParsedNote {
    let front = oleafly_core::front_matter::split(text);
    let body_text = front
        .as_ref()
        .map_or(text.strip_prefix('\u{feff}').unwrap_or(text), |front| {
            front.body()
        });
    let body: Vec<&str> = body_text
        .split('\n')
        .map(|line| line.strip_suffix('\r').unwrap_or(line))
        .collect();
    let front_matter: &[&str] = front.as_ref().map_or(&[], |front| front.lines());
    let mut tags = Vec::new();
    let mut tag_labels = Vec::new();
    let mut seen = HashSet::new();
    let mut add_tag = |label: &str| {
        let key = label.to_lowercase();
        if seen.insert(key.clone()) {
            tags.push(key);
            tag_labels.push(label.to_string());
        }
    };
    for tag in front_matter_list(front_matter, "tags", true) {
        add_tag(&tag);
    }
    let mut aliases = front_matter_list(front_matter, "aliases", false);
    for alias in front_matter_list(front_matter, "alias", false) {
        if !aliases.contains(&alias) {
            aliases.push(alias);
        }
    }
    let mut plain = String::new();
    let mut plain_lines = Vec::new();
    let mut folded = String::new();
    let mut folded_starts = Vec::new();
    let mut fence: Option<(char, usize)> = None;
    for line in &body {
        let marker = fence_marker(line);
        let text = if let Some((open, length)) = fence {
            if marker.is_some_and(|(close, run)| close == open && run >= length) {
                fence = None;
                continue;
            }
            collapse(line)
        } else if marker.is_some() {
            fence = marker;
            continue;
        } else {
            for tag in line_tags(line) {
                add_tag(&tag);
            }
            plain_line(line)
        };
        if text.is_empty() || is_table_rule(&text) {
            continue;
        }
        if !plain.is_empty() {
            plain.push('\n');
            folded.push('\n');
        }
        let start = plain.len();
        plain.push_str(&text);
        plain_lines.push((start, plain.len()));
        folded_starts.push(folded.len());
        for c in text.chars() {
            fold_char(c, &mut folded);
        }
    }
    ParsedNote {
        note_id: oleafly_core::front_matter::scalar(front_matter, "id"),
        tags,
        tag_labels,
        folded_aliases: aliases.iter().map(|alias| fold(alias)).collect(),
        aliases,
        plain,
        plain_lines,
        folded,
        folded_starts,
    }
}

fn key_value<'a>(line: &'a str, key: &str) -> Option<&'a str> {
    (oleafly_core::front_matter::key_of(line) == Some(key))
        .then(|| oleafly_core::front_matter::value_of(line))
}

fn list_item(raw: &str, tags: bool) -> Option<String> {
    let item = unquote_once(raw);
    let item = if tags {
        item.trim_start_matches('#').trim()
    } else {
        item
    };
    (!item.is_empty()).then(|| item.to_string())
}

fn unquote_once(raw: &str) -> &str {
    let trimmed = raw.trim();
    let mut chars = trimmed.chars();
    match (chars.next(), chars.next_back()) {
        (Some(first @ ('"' | '\'')), Some(last)) if first == last => {
            trimmed[1..trimmed.len() - 1].trim()
        }
        _ => trimmed,
    }
}

fn front_matter_list(lines: &[&str], key: &str, tags: bool) -> Vec<String> {
    let Some(at) = lines.iter().position(|line| key_value(line, key).is_some()) else {
        return Vec::new();
    };
    let value = key_value(lines[at], key).unwrap_or_default();
    let items: Vec<&str> = if let Some(inner) = value.strip_prefix('[') {
        inner
            .rsplit_once(']')
            .map_or(inner, |(head, _)| head)
            .split(',')
            .collect()
    } else if !value.is_empty() {
        let value = unquote_once(value);
        if tags {
            value.split(|c: char| c == ',' || is_space(c)).collect()
        } else {
            value.split(',').collect()
        }
    } else {
        lines[at + 1..]
            .iter()
            .filter(|line| !line.trim().is_empty())
            .map_while(|line| block_item(line))
            .collect()
    };
    items
        .into_iter()
        .filter_map(|item| list_item(item, tags))
        .collect()
}

fn block_item(line: &str) -> Option<&str> {
    let rest = line.trim_start_matches([' ', '\t']).strip_prefix('-')?;
    if rest.is_empty() {
        return Some("");
    }
    rest.starts_with([' ', '\t'])
        .then(|| rest.trim_start_matches([' ', '\t']))
}

fn fence_marker(line: &str) -> Option<(char, usize)> {
    let line = line.trim_start_matches([' ', '\t']);
    let first = line.chars().next().filter(|c| matches!(c, '`' | '~'))?;
    let run = line.chars().take_while(|c| *c == first).count();
    (run >= 3).then_some((first, run))
}

fn is_table_rule(text: &str) -> bool {
    text.chars().all(|c| matches!(c, '-' | ':' | ' '))
}

fn collapse(text: &str) -> String {
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn block_marker_len(text: &str) -> Option<usize> {
    let bytes = text.as_bytes();
    let spaces_after = |at: usize| {
        bytes[at..]
            .iter()
            .take_while(|b| matches!(b, b' ' | b'\t'))
            .count()
    };
    match bytes.first()? {
        b'#' => {
            let hashes = bytes.iter().take_while(|b| **b == b'#').count();
            let gap = spaces_after(hashes);
            (hashes <= 6 && (gap > 0 || hashes == bytes.len())).then_some(hashes + gap)
        }
        b'>' => Some(1 + usize::from(matches!(bytes.get(1), Some(b' ' | b'\t')))),
        b'-' | b'*' | b'+' => {
            let gap = spaces_after(1);
            if gap == 0 {
                return None;
            }
            let at = 1 + gap;
            let task = bytes.get(at) == Some(&b'[')
                && matches!(bytes.get(at + 1), Some(b' ' | b'x' | b'X'))
                && bytes.get(at + 2) == Some(&b']');
            let task_gap = if task { spaces_after(at + 3) } else { 0 };
            Some(if task && task_gap > 0 {
                at + 3 + task_gap
            } else {
                at
            })
        }
        b'0'..=b'9' => {
            let digits = bytes.iter().take_while(|b| b.is_ascii_digit()).count();
            if digits > 9 || !matches!(bytes.get(digits), Some(b'.' | b')')) {
                return None;
            }
            let gap = spaces_after(digits + 1);
            (gap > 0).then_some(digits + 1 + gap)
        }
        _ => None,
    }
}

fn callout_marker_len(text: &str) -> Option<usize> {
    let rest = text.strip_prefix("[!")?;
    let close = rest.find(']')?;
    let name = &rest[..close];
    if name.is_empty()
        || !name
            .chars()
            .all(|c| c.is_alphanumeric() || c == '-' || c == '_')
    {
        return None;
    }
    let after = &rest[close + 1..];
    let fold = usize::from(after.starts_with(['+', '-']));
    Some(2 + close + 1 + fold)
}

fn line_body(line: &str) -> &str {
    let mut rest = line.trim_start();
    while let Some(length) = block_marker_len(rest).or_else(|| callout_marker_len(rest)) {
        rest = rest[length..].trim_start();
    }
    rest
}

fn destination_end(chars: &[char], open: usize) -> Option<usize> {
    let mut index = open + 1;
    let mut depth = 0usize;
    while index < chars.len() {
        match chars[index] {
            '\\' => index += 1,
            '<' if index == open + 1 => {
                let close = chars[index..].iter().position(|c| *c == '>')?;
                index += close;
            }
            '"' | '\'' if index > open + 1 && chars[index - 1] == ' ' => {
                let quote = chars[index];
                let close = chars[index + 1..].iter().position(|c| *c == quote)?;
                index += close + 1;
            }
            '(' => depth += 1,
            ')' if depth == 0 => return Some(index + 1),
            ')' => depth -= 1,
            _ => {}
        }
        index += 1;
    }
    None
}

fn link_at(
    chars: &[char],
    start: usize,
    offset: usize,
    brackets: &HashMap<usize, usize>,
) -> Option<(usize, usize, usize)> {
    let close = brackets
        .get(&(start + offset))?
        .checked_sub(offset)
        .filter(|close| *close < chars.len())?;
    if chars.get(close + 1) != Some(&'(') {
        return None;
    }
    let end = destination_end(chars, close + 1)?;
    Some((start + 1, close, end))
}

fn autolink_end(chars: &[char], start: usize) -> Option<usize> {
    let scheme = scheme_len(chars.get(start + 1..)?)?;
    let mut index = start + 1 + scheme;
    while let Some(c) = chars.get(index) {
        match c {
            '>' => return Some(index + 1),
            '<' => return None,
            c if is_space(*c) => return None,
            _ => index += 1,
        }
    }
    None
}

fn is_scheme_char(c: char) -> bool {
    c.is_ascii_alphanumeric() || matches!(c, '+' | '.' | '-')
}

fn scheme_len(chars: &[char]) -> Option<usize> {
    if !chars.first()?.is_ascii_alphabetic() {
        return None;
    }
    let colon = chars.iter().position(|c| !is_scheme_char(*c))?;
    (chars[colon] == ':').then_some(colon + 1)
}

fn url_end(chars: &[char], start: usize) -> usize {
    if start > 0 && is_scheme_char(chars[start - 1]) {
        return start;
    }
    let Some(scheme) = scheme_len(&chars[start..]) else {
        return start;
    };
    if !chars[start + scheme..].starts_with(&['/', '/']) {
        return start;
    }
    chars[start..]
        .iter()
        .position(|c| is_space(*c))
        .map_or(chars.len(), |offset| start + offset)
}

fn code_span_end(chars: &[char], start: usize) -> Option<(usize, usize)> {
    let run = chars[start..].iter().take_while(|c| **c == '`').count();
    let mut index = start + run;
    while index < chars.len() {
        if chars[index] != '`' {
            index += 1;
            continue;
        }
        let close = chars[index..].iter().take_while(|c| **c == '`').count();
        if close == run {
            return Some((index, index + close));
        }
        index += close;
    }
    None
}

fn is_space(c: char) -> bool {
    c.is_whitespace() || c == '\u{feff}'
}

fn is_letter(c: char) -> bool {
    let code = c as u32;
    c.is_alphabetic()
        && !is_combining_mark(c)
        && !(0x24B6..=0x24E9).contains(&code)
        && !(0x1F130..=0x1F189).contains(&code)
}

fn is_tag_char(c: char) -> bool {
    is_letter(c) || c.is_numeric() || matches!(c, '_' | '-' | '/')
}

fn tag_at(chars: &[char], index: usize) -> Option<(String, usize)> {
    if chars[index] != '#'
        || (index > 0 && !(is_space(chars[index - 1]) || chars[index - 1] == '('))
    {
        return None;
    }
    let run = &chars[index + 1..];
    let length = run.iter().take_while(|c| is_tag_char(**c)).count();
    let lead = run[..length].iter().take_while(|c| **c == '/').count();
    let trail = run[lead..length]
        .iter()
        .rev()
        .take_while(|c| **c == '/')
        .count();
    let tag = &run[lead..length - trail];
    (!tag.is_empty() && tag.iter().any(|c| !c.is_numeric()))
        .then(|| (tag.iter().collect(), index + 1 + lead + tag.len()))
}

fn inline_link_end(chars: &[char], start: usize) -> Option<usize> {
    let close = start
        + 1
        + chars[start + 1..]
            .iter()
            .position(|c| matches!(c, '[' | ']'))?;
    if chars[close] != ']' || chars.get(close + 1) != Some(&'(') {
        return None;
    }
    let paren = chars[close + 2..].iter().position(|c| *c == ')')?;
    Some(close + 2 + paren + 1)
}

fn tag_skip(chars: &[char], index: usize) -> usize {
    match chars[index] {
        '\\' => (index + 2).min(chars.len()),
        '`' => code_span_end(chars, index).map_or_else(
            || index + chars[index..].iter().take_while(|c| **c == '`').count(),
            |(_, end)| end,
        ),
        '[' => inline_link_end(chars, index).unwrap_or(index),
        ']' if chars.get(index + 1) == Some(&'(') => chars[index + 2..]
            .iter()
            .position(|c| *c == ')')
            .map_or(chars.len(), |offset| index + 2 + offset + 1),
        '<' => autolink_end(chars, index).unwrap_or(index),
        _ => url_end(chars, index),
    }
}

fn line_tags(line: &str) -> Vec<String> {
    let chars: Vec<char> = line.chars().collect();
    let mut tags = Vec::new();
    let mut index = 0;
    while index < chars.len() {
        let skipped = tag_skip(&chars, index);
        if skipped > index {
            index = skipped;
        } else if let Some((tag, end)) = tag_at(&chars, index) {
            tags.push(tag);
            index = end;
        } else {
            index += 1;
        }
    }
    tags
}

fn plain_line(line: &str) -> String {
    let chars: Vec<char> = line_body(line).chars().collect();
    let brackets = if chars.contains(&'[') {
        crate::note_links::matching_brackets(&chars, '[', ']', '\\')
    } else {
        HashMap::new()
    };
    let mut out = String::new();
    plain_inline(&chars, 0, &brackets, &mut out);
    collapse(&out)
}

fn plain_inline(chars: &[char], offset: usize, brackets: &HashMap<usize, usize>, out: &mut String) {
    let mut index = 0;
    while index < chars.len() {
        let c = chars[index];
        let next = chars.get(index + 1).copied();
        if c == '\\' && next.is_some_and(|next| next.is_ascii_punctuation()) {
            out.extend(next);
            index += 2;
            continue;
        }
        if c == '`' {
            let run = chars[index..].iter().take_while(|c| **c == '`').count();
            match code_span_end(chars, index) {
                Some((close, end)) => {
                    out.push(' ');
                    out.extend(&chars[index + run..close]);
                    out.push(' ');
                    index = end;
                }
                None => {
                    out.extend(&chars[index..index + run]);
                    index += run;
                }
            }
            continue;
        }
        let image = c == '!' && next == Some('[');
        if c == '[' || image {
            if let Some((label_start, label_end, end)) = link_at(
                chars,
                if image { index + 1 } else { index },
                offset,
                brackets,
            ) {
                plain_inline(
                    &chars[label_start..label_end],
                    offset + label_start,
                    brackets,
                    out,
                );
                index = end;
                continue;
            }
        }
        if c == '<' {
            if let Some(end) = autolink_end(chars, index) {
                out.extend(&chars[index + 1..end - 1]);
                index = end;
                continue;
            }
        }
        if c == '~' && next == Some('~') {
            index += 2;
            continue;
        }
        match c {
            '*' => {}
            '|' => out.push(' '),
            _ => out.push(c),
        }
        index += 1;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn note(id: &str, title: &str, text: &str) -> IndexedNote {
        IndexedNote {
            id: id.into(),
            title: title.into(),
            related_project: None,
            updated_at: 0.0,
            parsed: Arc::new(parse_note(text)),
        }
    }

    fn ids(hits: &[NoteSearchHit]) -> Vec<&str> {
        hits.iter().map(|hit| hit.id.as_str()).collect()
    }

    fn run(notes: &[IndexedNote], query: &str) -> Vec<NoteSearchHit> {
        search(notes, &parse_query(query), DEFAULT_LIMIT)
    }

    fn marked(snippet: &NoteSearchSnippet) -> String {
        let units: Vec<u16> = snippet.text.encode_utf16().collect();
        let mut out = Vec::new();
        let mut at = 0usize;
        for [start, end] in &snippet.ranges {
            out.extend_from_slice(&units[at..*start as usize]);
            out.extend("[".encode_utf16());
            out.extend_from_slice(&units[*start as usize..*end as usize]);
            out.extend("]".encode_utf16());
            at = *end as usize;
        }
        out.extend_from_slice(&units[at..]);
        String::from_utf16(&out).unwrap()
    }

    #[test]
    fn reads_inline_and_front_matter_tags() {
        let parsed = parse_note(
            "---\ntags: [Draft, \"#ml\", '']\naliases: Encoder study, MAE\nid: n-7\n---\n# Heading #Ml/Vision\n- [ ] Run #exp-12 again (#todo) and x#not and #2024 and #2024-q1\nSee #Caf\u{e9} and #研究 and #a/b/ then.\n",
        );
        assert_eq!(
            parsed.tags,
            vec![
                "draft",
                "ml",
                "ml/vision",
                "exp-12",
                "todo",
                "2024-q1",
                "café",
                "研究",
                "a/b"
            ]
        );
        assert_eq!(
            parsed.tag_labels,
            vec![
                "Draft",
                "ml",
                "Ml/Vision",
                "exp-12",
                "todo",
                "2024-q1",
                "Café",
                "研究",
                "a/b"
            ]
        );
        assert_eq!(parsed.aliases, vec!["Encoder study", "MAE"]);
        assert_eq!(parsed.note_id.as_deref(), Some("n-7"));
    }

    #[test]
    fn reads_every_front_matter_list_shape() {
        let tags = |front: &str| parse_note(&format!("---\n{front}\n---\nBody\n")).tags;
        assert_eq!(
            tags("tags:\n  - one\n  - \"#two\"\n  -\nnext: x"),
            vec!["one", "two"]
        );
        assert_eq!(tags("tags: one, two three"), vec!["one", "two", "three"]);
        assert_eq!(tags("tags: \"#a #b\""), vec!["a", "b"]);
        assert_eq!(tags("tags: [x, y"), vec!["x", "y"]);
        assert_eq!(tags("tags: a\ntags: b"), vec!["a"]);
        assert_eq!(
            tags("tags :\n\n  - spaced\n\n  - blank\nother: x\n  - no"),
            vec!["spaced", "blank"]
        );
        assert_eq!(tags("tags:\n  -x\n  - y"), Vec::<String>::new());
        assert_eq!(tags("  tags: nested"), Vec::<String>::new());
        assert_eq!(tags("tagsx: no"), Vec::<String>::new());
        let parsed = parse_note("---\naliases:\n  - 'Masked encoders'\nalias: [MAE]\n---\n");
        assert_eq!(parsed.aliases, vec!["Masked encoders", "MAE"]);
        assert_eq!(parse_note("No front matter #tag").tags, vec!["tag"]);
        assert_eq!(
            parse_note("---\ntags: a\nno close").tags,
            Vec::<String>::new()
        );
    }

    #[test]
    fn reads_the_note_id_like_the_other_front_matter_readers() {
        assert_eq!(
            parse_note("---  \nid : abc # old\n---\nBody\n")
                .note_id
                .as_deref(),
            Some("abc")
        );
        assert_eq!(parse_note("---\nid: # none\n---\n").note_id, None);
        let nested = parse_note("[outer [inner](oleafly://note/a) text](oleafly://note/b)");
        assert_eq!(nested.plain, "outer inner text");
        let open = parse_note(&format!("{}[x](y) tail", "[".repeat(100_000)));
        assert!(
            open.plain.ends_with("x tail"),
            "{}",
            &open.plain[open.plain.len() - 20..]
        );
    }

    #[test]
    fn skips_tags_in_code_links_and_urls() {
        let parsed = parse_note(
            "```\n#fenced\n```\n~~~\n#tilde\n~~~\nUse `#code` and ``a #b`` [see #label](#anchor) ![#alt](x.png)\n<https://x.org/#auto> https://x.org/#bare (https://x.org/a#b) \\#escaped #real\n[unclosed #open\n",
        );
        assert_eq!(parsed.tags, vec!["real", "open"]);
        assert!(parsed.plain.contains("#fenced"));
        assert!(parsed.plain.contains("a #b"));
        assert!(parsed.plain.contains("see #label"));
    }

    #[test]
    fn turns_markdown_into_plain_searchable_lines() {
        let parsed = parse_note(
            "---\ntitle: x\n---\n## The **Masking** ~~old~~ ablation\n> [!note]+ Callout title\n>\n| a | b |\n|---|:-:|\n1. [Encoder](oleafly://note/n-1 \"tip (x)\") <oleafly://note/n-2> [a](b(c)d)\n* [x] done \\* star\n\n#\n[!bad name] kept\n",
        );
        let lines: Vec<&str> = parsed
            .plain_lines
            .iter()
            .map(|(start, end)| &parsed.plain[*start..*end])
            .collect();
        assert_eq!(
            lines,
            vec![
                "The Masking old ablation",
                "Callout title",
                "a b",
                "Encoder oleafly://note/n-2 a",
                "done * star",
                "[!bad name] kept",
            ]
        );
        assert!(!parsed.plain.contains("title: x"));
    }

    #[test]
    fn folds_case_and_accents_but_keeps_other_scripts() {
        assert_eq!(
            fold("Ça Façade ÉTÉ Straße Æon Œuvre Øre Łódź Đak ıi"),
            "ca facade ete strasse aeon oeuvre ore lodz dak ii"
        );
        assert_eq!(fold("e\u{301}cole\u{a0}x"), "ecole x");
        assert_eq!(fold("Ελληνικά ПРИВЕТ"), "ελληνικα привет");
        assert_eq!(fold("한국어 が ẞ Ǆ"), "한국어 が ss ǆ");
        assert_eq!(fold("Ⅻ"), "ⅻ");
        let (folded, origin) = fold_mapped(&"aßé".chars().collect::<Vec<_>>());
        assert_eq!(folded, "asse");
        assert_eq!(origin, vec![0, 1, 1, 2, 3]);
    }

    #[test]
    fn parses_every_operator() {
        let query = parse_query(
            "Masking \"Exact  Phrase\" -drop -\"no way\" tag:#ML/ -TAG:old title:\"Big plan\" project:p_9 is:Favorite unknown:x - \"\" tag: \"open",
        );
        let terms: Vec<(Field, &str, bool, bool)> = query
            .terms
            .iter()
            .map(|term| (term.field, term.value.as_str(), term.phrase, term.negated))
            .collect();
        assert_eq!(
            terms,
            vec![
                (Field::Any, "masking", false, false),
                (Field::Any, "exact phrase", true, false),
                (Field::Any, "drop", false, true),
                (Field::Any, "no way", true, true),
                (Field::Tag, "ml", false, false),
                (Field::Tag, "old", false, true),
                (Field::Title, "big plan", true, false),
                (Field::Project, "p_9", false, false),
                (Field::Is, "favorite", false, false),
                (Field::Any, "unknown:x", false, false),
                (Field::Any, "-", false, false),
                (Field::Any, "open", true, false),
            ]
        );
        assert!(parse_query("   ").terms.is_empty());
        assert!(parse_query("tag:#/").terms.is_empty());
        assert_eq!(parse_query("tag:2024").terms[0].value, "2024");
        let many = vec!["w"; MAX_TERMS + 5].join(" ");
        assert_eq!(parse_query(&many).terms.len(), MAX_TERMS);
        let long = "a".repeat(MAX_QUERY_CHARS * 2);
        assert_eq!(parse_query(&long).terms[0].value.len(), MAX_QUERY_CHARS);
    }

    #[test]
    fn needs_every_word_and_ranks_title_hits_first() {
        let mut body = note(
            "body",
            "Weekly log",
            "The masking ablation ran twice. Masking again.",
        );
        let title = note("title", "Masking ablation", "Results are in.");
        let other = note("other", "Other", "Only masking here.");
        Arc::get_mut(&mut body.parsed).unwrap();
        body.updated_at = 50.0;
        let notes = vec![body, title, other];
        assert_eq!(ids(&run(&notes, "masking ablation")), vec!["title", "body"]);
        assert_eq!(ids(&run(&notes, "MASKING")), vec!["title", "body", "other"]);
        assert_eq!(ids(&run(&notes, "mask abl")), vec!["title", "body"]);
        assert!(run(&notes, "masking missing").is_empty());
        let hits = run(&notes, "masking ablation");
        assert!(hits[0].score >= 2.0 * TITLE_WEIGHT + PHRASE_IN_TITLE_BONUS);
        assert!(hits[1].score < TITLE_WEIGHT);
        assert_eq!(hits[0].title_ranges, vec![[0, 7], [8, 16]]);
    }

    #[test]
    fn breaks_ties_by_recent_edits_then_title() {
        let mut old = note("old", "B", "same text");
        let mut new = note("new", "A", "same text");
        let mut twin = note("twin", "C", "same text");
        old.updated_at = 10.0;
        new.updated_at = 20.0;
        twin.updated_at = 10.0;
        let notes = vec![old, twin, new];
        assert_eq!(ids(&run(&notes, "same")), vec!["new", "old", "twin"]);
        assert_eq!(
            ids(&search(&notes, &parse_query("same"), 2)),
            vec!["new", "old"]
        );
    }

    #[test]
    fn prefers_exact_and_word_start_title_matches() {
        let notes = vec![
            note("inside", "Premasking", ""),
            note("start", "Masking notes", ""),
            note("exact", "Masking", ""),
            note("alias", "Unrelated", "---\naliases: [Masking]\n---\n"),
        ];
        assert_eq!(
            ids(&run(&notes, "masking")),
            vec!["exact", "alias", "start", "inside"]
        );
        assert_eq!(
            ids(&run(&notes, "title:masking")),
            vec!["exact", "alias", "start", "inside"]
        );
        assert_eq!(ids(&run(&notes, "-title:masking")), Vec::<&str>::new());
    }

    #[test]
    fn applies_exclusions_phrases_tags_and_projects() {
        let mut tagged = note(
            "tagged",
            "Vision run",
            "---\ntags: [ml/vision]\n---\nA masked encoder with patches. #draft",
        );
        tagged.related_project = Some("p_9".into());
        let plain = note(
            "plain",
            "Text run",
            "A maskedencoder without spaces. #mlops",
        );
        let nested = note("nested", "Nested", "#ml");
        let notes = vec![tagged, plain, nested];
        assert_eq!(ids(&run(&notes, "\"masked encoder\"")), vec!["tagged"]);
        assert_eq!(ids(&run(&notes, "\"masked\"")), vec!["tagged"]);
        assert_eq!(ids(&run(&notes, "masked")), vec!["tagged", "plain"]);
        assert_eq!(ids(&run(&notes, "masked -spaces")), vec!["tagged"]);
        assert_eq!(
            ids(&run(&notes, "masked -\"masked encoder\"")),
            vec!["plain"]
        );
        assert_eq!(ids(&run(&notes, "tag:ml")), vec!["nested", "tagged"]);
        assert_eq!(ids(&run(&notes, "tag:ml/vision")), vec!["tagged"]);
        assert_eq!(ids(&run(&notes, "tag:ML -tag:draft")), vec!["nested"]);
        assert_eq!(ids(&run(&notes, "tag:mlops")), vec!["plain"]);
        assert_eq!(ids(&run(&notes, "project:p_9")), vec!["tagged"]);
        assert_eq!(ids(&run(&notes, "-project:p_9 run")), vec!["plain"]);
        assert_eq!(
            ids(&run(&notes, "is:favorite run")),
            vec!["plain", "tagged"]
        );
        assert_eq!(run(&notes, "-is:favorite").len(), 3);
        let hit = &run(&notes, "tag:ml/vision")[0];
        assert_eq!(hit.tags, vec!["ml/vision", "draft"]);
        assert_eq!(hit.related_project.as_deref(), Some("p_9"));
        assert_eq!(hit.snippets.len(), 1);
        assert!(hit.snippets[0].ranges.is_empty());
    }

    #[test]
    fn matches_accented_unicode_and_reports_utf16_ranges() {
        let notes = vec![note(
            "u",
            "Résumé 📄",
            "Le café 😀 était fermé.\nNaïve façade.\n研究ノート の 研究",
        )];
        let hit = &run(&notes, "CAFE etait")[0];
        assert_eq!(marked(&hit.snippets[0]), "Le [café] 😀 [était] fermé.");
        assert_eq!(hit.snippets[0].ranges, vec![[3, 7], [11, 16]]);
        let hit = &run(&notes, "研究 resume")[0];
        assert_eq!(marked(&hit.snippets[0]), "[研究]ノート の [研究]");
        assert_eq!(hit.title_ranges, vec![[0, 6]]);
        let hit = &run(&notes, "\"naive facade\"")[0];
        assert_eq!(marked(&hit.snippets[0]), "[Naïve façade].");
        let decomposed = vec![note("d", "x", "e\u{301}te\u{301} ici")];
        assert_eq!(
            marked(&run(&decomposed, "ete")[0].snippets[0]),
            "[e\u{301}te\u{301}] ici"
        );
    }

    #[test]
    fn picks_up_to_three_lines_with_the_most_terms() {
        let text =
            "alpha only\nbeta only\nalpha and beta\nalpha again\nbeta again\nalpha beta last";
        let hit = &run(&[note("n", "T", text)], "alpha beta")[0];
        let snippets: Vec<String> = hit.snippets.iter().map(marked).collect();
        assert_eq!(
            snippets,
            vec!["[alpha] and [beta]", "[alpha] [beta] last", "[alpha] only"]
        );
    }

    #[test]
    fn cuts_long_lines_around_the_first_match() {
        let words = |count: usize, word: &str| vec![word; count].join(" ");
        let text = format!("{} target {}", words(30, "before"), words(30, "after"));
        let hit = &run(&[note("n", "T", &text)], "target")[0];
        let snippet = &hit.snippets[0];
        assert!(snippet.text.starts_with("…before"), "{}", snippet.text);
        assert!(snippet.text.ends_with("after…"), "{}", snippet.text);
        assert!(marked(snippet).contains("before [target] after"));
        assert!(snippet.text.chars().count() <= SNIPPET_CHARS + 2);
        let start = format!("target {}", words(40, "after"));
        let snippet = &run(&[note("n", "T", &start)], "target")[0].snippets[0];
        assert!(snippet.text.starts_with("target after"));
        assert!(snippet.text.ends_with('…'));
        let end = format!("{} target", words(40, "before"));
        let snippet = &run(&[note("n", "T", &end)], "target")[0].snippets[0];
        assert!(snippet.text.starts_with('…'));
        assert!(marked(snippet).ends_with("before [target]"));
        let unbroken = format!("{}target{}", "b".repeat(90), "a".repeat(200));
        let snippet = &run(&[note("n", "T", &unbroken)], "target")[0].snippets[0];
        assert_eq!(snippet.text.chars().count(), SNIPPET_CHARS + 2);
        let fallback = &run(&[note("n", "Target", &words(80, "x"))], "target")[0].snippets[0];
        assert!(fallback.ranges.is_empty());
        assert!(fallback.text.ends_with('…'));
        assert!(run(&[note("n", "Target", "")], "target")[0]
            .snippets
            .is_empty());
    }

    #[test]
    fn counts_tags_across_notes() {
        let notes = vec![
            note("a", "A", "#ML and #ml/vision"),
            note("b", "B", "---\ntags: ml\n---\n"),
            note("c", "C", "none"),
        ];
        assert_eq!(
            count_tags(&notes),
            vec![
                NoteTagCount {
                    tag: "ml".into(),
                    label: "ML".into(),
                    count: 2,
                    notes: vec!["a".into(), "b".into()],
                },
                NoteTagCount {
                    tag: "ml/vision".into(),
                    label: "ml/vision".into(),
                    count: 1,
                    notes: vec!["a".into()],
                },
            ]
        );
    }

    #[test]
    fn serializes_camel_case_fields() {
        let hit = &run(
            &[note("n", "Masking", "---\nid: n-1\n---\nmasking")],
            "masking",
        )[0];
        let json = serde_json::to_value(hit).unwrap();
        assert_eq!(json["noteId"], "n-1");
        assert_eq!(json["titleRanges"][0][1], 7);
        assert_eq!(json["snippets"][0]["ranges"][0][0], 0);
        assert!(json["relatedProject"].is_null());
        assert_eq!(json["updatedAt"], 0.0);
    }

    fn library_note(text: &str) -> crate::note_index::NoteEntry {
        let id =
            crate::project::create_note_project_from("Cached".into(), text.into(), None).unwrap();
        crate::note_index::NoteEntry {
            id,
            title: "Cached".into(),
            main_doc: crate::project::NOTE_FILE.into(),
            related_project: None,
            updated_at: 0.0,
        }
    }

    fn read(entry: &crate::note_index::NoteEntry) -> Result<Arc<ParsedNote>, String> {
        crate::note_index::read_parsed(&CACHE, entry, crate::note_index::LockMode::Try, parse_note)
            .map(|found| found.expect("the note is readable").1)
    }

    #[test]
    fn caches_parsed_text_until_the_file_changes() {
        let _env_guard = crate::paths::data_dir_env_lock();
        let root = test_dir("note-cache");
        std::env::set_var("OLEAFLY_DATA_DIR", &root);
        let entry = library_note("first #one");
        let first = read(&entry).unwrap();
        let again = read(&entry).unwrap();
        assert!(Arc::ptr_eq(&first, &again));
        assert_eq!(first.tags, vec!["one"]);
        let path = crate::paths::project_dir(&entry.id)
            .unwrap()
            .join(crate::project::NOTE_FILE);
        std::fs::write(&path, "second, longer #two").unwrap();
        let changed = read(&entry).unwrap();
        assert!(!Arc::ptr_eq(&first, &changed));
        assert_eq!(changed.tags, vec!["two"]);
        std::fs::remove_file(&path).unwrap();
        assert!(read(&entry).is_err());
        std::env::remove_var("OLEAFLY_DATA_DIR");
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn reads_only_the_first_two_megabytes() {
        let _env_guard = crate::paths::data_dir_env_lock();
        let root = test_dir("note-big");
        std::env::set_var("OLEAFLY_DATA_DIR", &root);
        let mut text = format!(
            "early {}",
            "x ".repeat(crate::note_index::MAX_NOTE_BYTES as usize / 2)
        );
        text.push_str("\nlate words");
        let entry = library_note(&text);
        let notes = vec![IndexedNote {
            id: "big".into(),
            title: "Big".into(),
            related_project: None,
            updated_at: 0.0,
            parsed: read(&entry).unwrap(),
        }];
        assert_eq!(ids(&run(&notes, "early")), vec!["big"]);
        assert!(run(&notes, "late").is_empty());
        std::env::remove_var("OLEAFLY_DATA_DIR");
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn stays_fast_over_thousands_of_notes() {
        let notes: Vec<IndexedNote> = (0..3000)
            .map(|index| {
                note(
                    &format!("n{index}"),
                    &format!("Experiment {index}"),
                    &format!(
                        "---\ntags: [run/{}]\n---\n{}\nThe result for trial {index} was ready.\n",
                        index % 7,
                        "Lorem ipsum dolor sit amet, consectetur adipiscing elit. ".repeat(40)
                    ),
                )
            })
            .collect();
        let hits = search(&notes, &parse_query("trial 2999 ready -missing"), 10);
        assert_eq!(ids(&hits), vec!["n2999"]);
        assert_eq!(
            search(&notes, &parse_query("tag:run/3"), MAX_LIMIT).len(),
            429
        );
    }

    fn test_dir(label: &str) -> std::path::PathBuf {
        tempfile::Builder::new()
            .prefix(&format!("oleafly-{label}-"))
            .tempdir()
            .unwrap()
            .keep()
    }

    #[test]
    fn searches_and_counts_every_library_note() {
        let _env_guard = crate::paths::data_dir_env_lock();
        let root = test_dir("note-search");
        std::env::set_var("OLEAFLY_DATA_DIR", &root);
        let paper = crate::project::create_note_project_from(
            "Paper plan".into(),
            "---\nkind: note\nid: n-1\ntags: [plan]\n---\nDraft the masking section. #writing\n"
                .into(),
            None,
        )
        .unwrap();
        let log = crate::project::create_note_project_from(
            "Lab log".into(),
            "---\nkind: note\nid: n-2\n---\nMasking ran overnight. #writing/daily\n".into(),
            Some(paper.clone()),
        )
        .unwrap();
        let hits = note_search_blocking("masking", None).unwrap();
        assert_eq!(hits.len(), 2);
        assert!(hits.iter().all(|hit| hit.updated_at > 0.0));
        let hits = note_search_blocking(&format!("masking project:{paper}"), Some(0)).unwrap();
        assert_eq!(ids(&hits), vec![log.as_str()]);
        assert_eq!(hits[0].note_id.as_deref(), Some("n-2"));
        assert!(note_search_blocking("  ", Some(5)).unwrap().is_empty());
        let tags = note_tags_blocking().unwrap();
        let summary: Vec<(&str, u32)> = tags
            .iter()
            .map(|tag| (tag.tag.as_str(), tag.count))
            .collect();
        assert_eq!(
            summary,
            vec![("plan", 1), ("writing", 1), ("writing/daily", 1)]
        );
        let dir = crate::paths::project_dir(&paper).unwrap();
        std::fs::remove_file(dir.join(crate::project::NOTE_FILE)).unwrap();
        let after = note_search_blocking("masking", None).unwrap();
        assert_eq!(ids(&after), vec![log.as_str()]);
        let cache = CACHE.lock().unwrap();
        assert!(cache.keys().all(|path| !path.starts_with(&dir)));
        drop(cache);
        std::env::remove_var("OLEAFLY_DATA_DIR");
        std::fs::remove_dir_all(root).unwrap();
    }
}
