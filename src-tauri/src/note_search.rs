use std::collections::{BTreeMap, HashMap, HashSet};
use std::sync::{Arc, LazyLock, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use oleafly_core::front_matter::quoted_scalar;
use oleafly_core::markdown_scan::{
    autolink_end, block_id_suffix, block_marker_len, is_scheme_char, is_space, run_at, scheme_len,
    CodeSpans, FenceLine, Fences,
};
use serde::Serialize;
use unicode_normalization::char::{decompose_canonical, is_combining_mark};

use crate::search_modes::{
    char_ranges, fuzzy_matcher, index_ranges, FuzzyPattern, SearchMode, TextPattern,
};

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
const MAX_BLOCK_HITS: usize = 20;
const FUZZY_WEIGHT: f64 = 10.0;

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
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub blocks: Vec<NoteBlockHit>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct NoteBlockHit {
    pub line: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub block: Option<String>,
    pub kind: &'static str,
    pub text: String,
    pub ranges: Vec<[u32; 2]>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum BlockKind {
    Paragraph,
    Item,
    Row,
    Heading,
    Quote,
    Code,
}

impl BlockKind {
    fn name(self) -> &'static str {
        match self {
            Self::Paragraph => "paragraph",
            Self::Item => "item",
            Self::Row => "row",
            Self::Heading => "heading",
            Self::Quote => "quote",
            Self::Code => "code",
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
struct BlockSpan {
    kind: BlockKind,
    line: u32,
    first: usize,
    last: usize,
    id: Option<String>,
    tags: Vec<String>,
}

#[derive(Debug, Clone, Copy, Default)]
pub(crate) struct SearchOptions {
    pub limit: Option<u32>,
    pub mode: SearchMode,
    pub blocks: bool,
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
    blocks: Vec<BlockSpan>,
    head: crate::note_facts::HeadFacts,
    task_digest: String,
}

impl ParsedNote {
    pub(crate) fn note_id(&self) -> Option<&str> {
        self.note_id.as_deref()
    }

    pub(crate) fn tags(&self) -> &[String] {
        &self.tags
    }

    pub(crate) fn tag_labels(&self) -> &[String] {
        &self.tag_labels
    }

    pub(crate) fn aliases(&self) -> &[String] {
        &self.aliases
    }

    pub(crate) fn head(&self) -> &crate::note_facts::HeadFacts {
        &self.head
    }

    pub(crate) fn task_digest(&self) -> &str {
        &self.task_digest
    }
}

#[derive(Debug, Clone)]
pub(crate) struct IndexedNote {
    id: String,
    title: String,
    related_project: Option<String>,
    updated_at: f64,
    parsed: Arc<ParsedNote>,
}

impl IndexedNote {
    pub(crate) fn id(&self) -> &str {
        &self.id
    }

    pub(crate) fn title(&self) -> &str {
        &self.title
    }

    pub(crate) fn related_project(&self) -> Option<&str> {
        self.related_project.as_deref()
    }

    pub(crate) fn updated_at(&self) -> f64 {
        self.updated_at
    }

    pub(crate) fn parsed(&self) -> &ParsedNote {
        &self.parsed
    }
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
    raw: String,
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
pub async fn note_search(
    query: String,
    limit: Option<u32>,
    mode: Option<SearchMode>,
    blocks: Option<bool>,
) -> Result<Vec<NoteSearchHit>, String> {
    let options = SearchOptions {
        limit,
        mode: mode.unwrap_or_default(),
        blocks: blocks.unwrap_or(false),
    };
    tauri::async_runtime::spawn_blocking(move || note_search_with(&query, options))
        .await
        .map_err(|error| format!("note search failed: {error}"))?
}

#[tauri::command]
pub async fn note_tags() -> Result<Vec<NoteTagCount>, String> {
    tauri::async_runtime::spawn_blocking(note_tags_blocking)
        .await
        .map_err(|error| format!("listing note tags failed: {error}"))?
}

pub(crate) fn note_search_with(
    query: &str,
    options: SearchOptions,
) -> Result<Vec<NoteSearchHit>, String> {
    let query = parse_query(query);
    if query.terms.is_empty() {
        return Ok(Vec::new());
    }
    let compiled = Compiled::new(&query, options.mode)?;
    Ok(search_compiled(
        &indexed_notes()?,
        &query,
        &compiled,
        options,
    ))
}

pub(crate) fn note_tags_blocking() -> Result<Vec<NoteTagCount>, String> {
    Ok(count_tags(&indexed_notes()?))
}

pub(crate) fn forget_cache() {
    crate::note_index::forget(&CACHE);
}

pub(crate) fn indexed_notes() -> Result<Vec<IndexedNote>, String> {
    let entries = crate::note_index::notes()?;
    let mut seen = HashSet::new();
    let notes = read_entries(entries.iter(), &mut seen)
        .into_iter()
        .map(|(_, note)| note)
        .collect();
    crate::note_index::keep_only(&CACHE, &seen);
    Ok(notes)
}

pub(crate) fn index_entries<'a>(
    entries: impl Iterator<Item = &'a crate::note_index::NoteEntry>,
) -> Vec<(&'a crate::note_index::NoteEntry, IndexedNote)> {
    read_entries(entries, &mut HashSet::new())
}

fn read_entries<'a>(
    entries: impl Iterator<Item = &'a crate::note_index::NoteEntry>,
    seen: &mut HashSet<std::path::PathBuf>,
) -> Vec<(&'a crate::note_index::NoteEntry, IndexedNote)> {
    let mut notes = Vec::new();
    for entry in entries {
        match crate::note_index::read_parsed(&CACHE, entry, parse_note) {
            Ok(Some((path, parsed, key))) => {
                seen.insert(path);
                notes.push((
                    entry,
                    IndexedNote {
                        id: entry.id.clone(),
                        title: entry.title.clone(),
                        related_project: entry.related_project.clone(),
                        updated_at: key.modified().map_or(entry.updated_at, seconds),
                        parsed,
                    },
                ));
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
    notes
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
                raw: raw.trim().to_string(),
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

struct Compiled {
    mode: SearchMode,
    patterns: Vec<Option<TextPattern>>,
    fuzzy: Vec<Option<FuzzyPattern>>,
}

impl Compiled {
    fn new(query: &Query, mode: SearchMode) -> Result<Self, String> {
        let mut patterns = Vec::with_capacity(query.terms.len());
        let mut fuzzy = Vec::with_capacity(query.terms.len());
        for term in &query.terms {
            let text = matches!(term.field, Field::Any | Field::Title);
            patterns.push(if text && mode.greps() {
                Some(TextPattern::new(&term.raw, mode)?)
            } else {
                None
            });
            fuzzy.push((text && mode == SearchMode::Fuzzy).then(|| FuzzyPattern::new(&term.raw)));
        }
        Ok(Self {
            mode,
            patterns,
            fuzzy,
        })
    }

    fn positive_patterns<'a>(&'a self, query: &Query, any_only: bool) -> Vec<&'a TextPattern> {
        query
            .terms
            .iter()
            .zip(&self.patterns)
            .filter(|(term, _)| !term.negated && (!any_only || term.field == Field::Any))
            .filter_map(|(_, pattern)| pattern.as_ref())
            .collect()
    }
}

struct Scorer {
    matcher: nucleo_matcher::Matcher,
    buffer: Vec<char>,
}

impl Scorer {
    fn new() -> Self {
        Self {
            matcher: fuzzy_matcher(false),
            buffer: Vec::new(),
        }
    }

    fn best(&mut self, pattern: &FuzzyPattern, names: &[&str]) -> Option<u32> {
        names
            .iter()
            .filter_map(|name| pattern.score(name, &mut self.matcher, &mut self.buffer))
            .max()
    }
}

fn grep_term(note: &IndexedNote, term: &Term, pattern: &TextPattern) -> (bool, f64) {
    let parsed = &note.parsed;
    let names =
        pattern.is_match(&note.title) || parsed.aliases.iter().any(|alias| pattern.is_match(alias));
    let count = if term.field == Field::Any {
        pattern.find_all(&parsed.plain, MAX_COUNTED).len()
    } else {
        0
    };
    let body = if count > 0 {
        (1.0 + (count as f64).log2()).min(9.0)
    } else {
        0.0
    };
    (
        names || count > 0,
        if names { TITLE_WEIGHT } else { 0.0 } + body,
    )
}

fn evaluate_mode(
    note: &IndexedNote,
    folded_title: &str,
    query: &Query,
    compiled: &Compiled,
    scorer: &mut Scorer,
) -> Option<f64> {
    if compiled.mode == SearchMode::Ranked {
        return evaluate(note, folded_title, query);
    }
    let parsed = &note.parsed;
    let mut score = 0.0;
    for (index, term) in query.terms.iter().enumerate() {
        let (matched, gained) = match term.field {
            Field::Any | Field::Title => {
                if let Some(pattern) = &compiled.patterns[index] {
                    grep_term(note, term, pattern)
                } else if let Some(pattern) = compiled.fuzzy[index]
                    .as_ref()
                    .filter(|pattern| !pattern.is_empty())
                {
                    let mut names = vec![note.title.as_str()];
                    names.extend(parsed.aliases.iter().map(String::as_str));
                    let best = scorer.best(pattern, &names);
                    (
                        best.is_some(),
                        best.map_or(0.0, |found| f64::from(found) * FUZZY_WEIGHT),
                    )
                } else {
                    (true, 0.0)
                }
            }
            Field::Tag => (has_tag(&parsed.tags, &term.value), 0.0),
            Field::Project => (
                note.related_project.as_deref() == Some(term.value.as_str()),
                0.0,
            ),
            Field::Is => (!term.negated, 0.0),
        };
        if matched == term.negated {
            return None;
        }
        if !term.negated {
            score += gained;
        }
    }
    Some(score)
}

fn grep_ranges(text: &str, patterns: &[&TextPattern]) -> Vec<(usize, usize)> {
    let bytes: Vec<(usize, usize)> = patterns
        .iter()
        .flat_map(|pattern| pattern.find_all(text, MAX_LINE_SCAN))
        .collect();
    merged(char_ranges(text, &bytes))
}

fn merged(mut ranges: Vec<(usize, usize)>) -> Vec<(usize, usize)> {
    ranges.sort_unstable();
    let mut out: Vec<(usize, usize)> = Vec::new();
    for (start, end) in ranges {
        match out.last_mut() {
            Some(last) if start <= last.1 => last.1 = last.1.max(end),
            _ => out.push((start, end)),
        }
    }
    out
}

fn title_ranges(
    note: &IndexedNote,
    query: &Query,
    compiled: &Compiled,
    scorer: &mut Scorer,
) -> Vec<[u32; 2]> {
    let title: Vec<char> = note.title.chars().collect();
    let ranges = match compiled.mode {
        SearchMode::Ranked => {
            let terms: Vec<&Term> = query
                .terms
                .iter()
                .filter(|term| matches!(term.field, Field::Any | Field::Title) && !term.negated)
                .collect();
            highlights(&title, &terms)
        }
        SearchMode::Exact | SearchMode::Regex => {
            grep_ranges(&note.title, &compiled.positive_patterns(query, false))
        }
        SearchMode::Fuzzy => {
            let mut indices = Vec::new();
            for (term, pattern) in query.terms.iter().zip(&compiled.fuzzy) {
                if let Some(pattern) = pattern.as_ref().filter(|_| !term.negated) {
                    indices.extend(pattern.indices(
                        &note.title,
                        &mut scorer.matcher,
                        &mut scorer.buffer,
                    ));
                }
            }
            indices.sort_unstable();
            indices.dedup();
            index_ranges(&indices)
        }
    };
    utf16_ranges(&title, 0, &ranges, 0)
}

fn search_compiled(
    notes: &[IndexedNote],
    query: &Query,
    compiled: &Compiled,
    options: SearchOptions,
) -> Vec<NoteSearchHit> {
    let limit = options
        .limit
        .map_or(DEFAULT_LIMIT, |limit| limit as usize)
        .clamp(1, MAX_LIMIT);
    let mut scorer = Scorer::new();
    let mut ranked: Vec<(f64, &IndexedNote)> = notes
        .iter()
        .filter_map(|note| {
            evaluate_mode(note, &fold(&note.title), query, compiled, &mut scorer)
                .map(|score| (score, note))
        })
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
    let body_patterns = compiled.positive_patterns(query, true);
    ranked
        .into_iter()
        .map(|(score, note)| NoteSearchHit {
            id: note.id.clone(),
            note_id: note.parsed.note_id.clone(),
            title_ranges: title_ranges(note, query, compiled, &mut scorer),
            title: note.title.clone(),
            score,
            snippets: match compiled.mode {
                SearchMode::Ranked => snippets(&note.parsed, &body_terms),
                SearchMode::Exact | SearchMode::Regex => {
                    grep_snippets(&note.parsed, &body_patterns)
                }
                SearchMode::Fuzzy => snippets(&note.parsed, &[]),
            },
            tags: note.parsed.tags.clone(),
            aliases: note.parsed.aliases.clone(),
            related_project: note.related_project.clone(),
            updated_at: note.updated_at,
            blocks: if options.blocks {
                block_hits(&note.parsed, query, compiled)
            } else {
                Vec::new()
            },
        })
        .collect()
}

fn grep_snippets(note: &ParsedNote, patterns: &[&TextPattern]) -> Vec<NoteSearchSnippet> {
    let mut chosen: Vec<(usize, usize)> = note
        .plain_lines
        .iter()
        .enumerate()
        .filter_map(|(line, (start, end))| {
            let text = &note.plain[*start..*end];
            let count = patterns
                .iter()
                .filter(|pattern| pattern.is_match(text))
                .count();
            (count > 0).then_some((line, count))
        })
        .collect();
    chosen.sort_by(|(left, left_count), (right, right_count)| {
        right_count.cmp(left_count).then(left.cmp(right))
    });
    let out: Vec<NoteSearchSnippet> = chosen
        .into_iter()
        .take(MAX_SNIPPETS)
        .map(|(line, _)| {
            let (start, end) = note.plain_lines[line];
            let text = &note.plain[start..end];
            let chars: Vec<char> = text.chars().collect();
            snippet(&chars, &grep_ranges(text, patterns))
        })
        .collect();
    if out.is_empty() {
        return snippets(note, &[]);
    }
    out
}

fn block_text(note: &ParsedNote, block: &BlockSpan) -> (String, std::ops::Range<usize>) {
    let start = note.plain_lines[block.first].0;
    let end = note.plain_lines[block.last].1;
    let folded_start = note.folded_starts[block.first];
    let folded_end = note
        .folded_starts
        .get(block.last + 1)
        .map_or(note.folded.len(), |next| next - 1);
    (
        note.plain[start..end].replace('\n', " "),
        folded_start..folded_end,
    )
}

fn block_hits(note: &ParsedNote, query: &Query, compiled: &Compiled) -> Vec<NoteBlockHit> {
    let tags: Vec<&Term> = query
        .terms
        .iter()
        .filter(|term| term.field == Field::Tag && !term.negated)
        .collect();
    let texts: Vec<(&Term, Option<&TextPattern>)> = query
        .terms
        .iter()
        .zip(&compiled.patterns)
        .filter(|(term, _)| term.field == Field::Any && !term.negated)
        .map(|(term, pattern)| (term, pattern.as_ref()))
        .collect();
    let texts_count = compiled.mode != SearchMode::Fuzzy && !texts.is_empty();
    if tags.is_empty() && !texts_count {
        return Vec::new();
    }
    let marks: Vec<Term> = tags
        .iter()
        .map(|term| Term {
            field: Field::Any,
            value: format!("#{}", term.value),
            raw: String::new(),
            phrase: false,
            negated: false,
        })
        .collect();
    let mut found = Vec::new();
    for block in &note.blocks {
        if !tags.is_empty() && !tags.iter().any(|term| has_tag(&block.tags, &term.value)) {
            continue;
        }
        let (text, folded) = block_text(note, block);
        let holds = !texts_count
            || texts.iter().all(|(term, pattern)| match pattern {
                Some(pattern) => pattern.is_match(&text),
                None => {
                    !find_all(&note.folded[folded.clone()], &term.value, term.phrase, 1).is_empty()
                }
            });
        if !holds {
            continue;
        }
        let chars: Vec<char> = text.chars().collect();
        let mut highlight_terms: Vec<&Term> = marks.iter().collect();
        if compiled.mode == SearchMode::Ranked {
            highlight_terms.extend(texts.iter().map(|(term, _)| *term));
        }
        let mut ranges = highlights(&chars, &highlight_terms);
        if compiled.mode.greps() {
            let patterns: Vec<&TextPattern> =
                texts.iter().filter_map(|(_, pattern)| *pattern).collect();
            ranges.extend(grep_ranges(&text, &patterns));
            ranges = merged(ranges);
        }
        let shown = snippet(&chars, &ranges);
        found.push(NoteBlockHit {
            line: block.line,
            block: block.id.clone(),
            kind: block.kind.name(),
            text: shown.text,
            ranges: shown.ranges,
        });
        if found.len() == MAX_BLOCK_HITS {
            break;
        }
    }
    found
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
    let mut fences = Fences::default();
    let mut blocks = BlockBuilder::default();
    let first_line = text[..text.len() - body_text.len()].matches('\n').count() + 1;
    for (index, line) in body.iter().enumerate() {
        let file_line = u32::try_from(first_line + index).unwrap_or(u32::MAX);
        let text = match fences.line(line) {
            FenceLine::Opens => {
                blocks.start(BlockKind::Code, file_line);
                continue;
            }
            FenceLine::Closes => {
                blocks.close();
                continue;
            }
            FenceLine::Inside => collapse(line),
            FenceLine::Text => {
                let tags = line_tags(line);
                for tag in &tags {
                    add_tag(tag);
                }
                blocks.line(line, file_line, &tags);
                plain_line(line)
            }
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
        blocks.add_plain(plain_lines.len() - 1);
        folded_starts.push(folded.len());
        for c in text.chars() {
            fold_char(c, &mut folded);
        }
    }
    blocks.close();
    ParsedNote {
        head: crate::note_facts::head_facts(front_matter, &body),
        note_id: oleafly_core::front_matter::scalar(front_matter, "id"),
        tags,
        tag_labels,
        folded_aliases: aliases.iter().map(|alias| fold(alias)).collect(),
        aliases,
        plain,
        plain_lines,
        folded,
        folded_starts,
        blocks: blocks.blocks,
        task_digest: crate::note_facts::task_digest(text),
    }
}

#[derive(Default)]
struct BlockBuilder {
    blocks: Vec<BlockSpan>,
    open: Option<BlockSpan>,
}

impl BlockBuilder {
    fn close(&mut self) {
        if let Some(block) = self.open.take().filter(|block| block.first != usize::MAX) {
            self.blocks.push(block);
        }
    }

    fn start(&mut self, kind: BlockKind, line: u32) {
        self.close();
        self.open = Some(BlockSpan {
            kind,
            line,
            first: usize::MAX,
            last: 0,
            id: None,
            tags: Vec::new(),
        });
    }

    fn add_plain(&mut self, index: usize) {
        if let Some(open) = &mut self.open {
            if open.first == usize::MAX {
                open.first = index;
            }
            open.last = index;
        }
    }

    fn lone_id(&mut self, id: &str) {
        let Some(last) = self.blocks.last() else {
            return;
        };
        let kind = last.kind;
        if !matches!(kind, BlockKind::Row | BlockKind::Quote | BlockKind::Code) {
            return;
        }
        for block in self
            .blocks
            .iter_mut()
            .rev()
            .take_while(|block| block.kind == kind)
        {
            block.id.get_or_insert_with(|| id.to_string());
            if kind != BlockKind::Row {
                break;
            }
        }
    }

    fn line(&mut self, line: &str, file_line: u32, tags: &[String]) {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            self.close();
            return;
        }
        if let Some((0, id)) = block_id_suffix(trimmed) {
            self.close();
            self.lone_id(id);
            return;
        }
        let open = self.open.as_ref().map(|block| block.kind);
        match line_kind(line) {
            Some(BlockKind::Quote) if open == Some(BlockKind::Quote) => {}
            Some(kind) => self.start(kind, file_line),
            None if matches!(
                open,
                Some(BlockKind::Paragraph | BlockKind::Item | BlockKind::Quote)
            ) => {}
            None => self.start(BlockKind::Paragraph, file_line),
        }
        if let Some(open) = &mut self.open {
            if open.id.is_none() {
                open.id = block_id_suffix(line).map(|(_, id)| id.to_string());
            }
            open.tags.extend(tags.iter().map(|tag| tag.to_lowercase()));
        }
    }
}

fn line_kind(line: &str) -> Option<BlockKind> {
    let trimmed = line.trim_start();
    let indent = line.len() - trimmed.len();
    if trimmed.starts_with('|') {
        return Some(BlockKind::Row);
    }
    block_marker_len(trimmed)?;
    match trimmed.as_bytes()[0] {
        b'#' if indent <= 3 => Some(BlockKind::Heading),
        b'#' => None,
        b'>' => Some(BlockKind::Quote),
        _ => Some(BlockKind::Item),
    }
}

fn key_value<'a>(line: &'a str, key: &str) -> Option<&'a str> {
    (oleafly_core::front_matter::key_of(line) == Some(key))
        .then(|| oleafly_core::front_matter::value_of(line))
}

fn list_item(raw: &str, tags: bool) -> Option<String> {
    let item = raw.trim();
    let item = if tags {
        item.trim_start_matches('#').trim()
    } else {
        item
    };
    (!item.is_empty()).then(|| item.to_string())
}

fn scalar_item(raw: &str) -> String {
    let trimmed = raw.trim();
    quoted_scalar(trimmed).map_or_else(|| trimmed.to_string(), |(value, _)| value)
}

fn flow_items(value: &str) -> Vec<String> {
    let mut items = Vec::new();
    let mut index = 1;
    while index < value.len() && !value[index..].starts_with(']') {
        index = value.len() - value[index..].trim_start().len();
        let quoted = quoted_scalar(&value[index..]);
        let start = quoted.as_ref().map_or(index, |(_, length)| index + length);
        let end = value[start..]
            .find([',', ']'])
            .map_or(value.len(), |at| start + at);
        items.push(quoted.map_or_else(|| value[index..end].to_string(), |(text, _)| text));
        index = if value[end..].starts_with(',') {
            end + 1
        } else {
            end
        };
    }
    items
}

fn front_matter_list(lines: &[&str], key: &str, tags: bool) -> Vec<String> {
    let Some(at) = lines.iter().position(|line| key_value(line, key).is_some()) else {
        return Vec::new();
    };
    let value = key_value(lines[at], key).unwrap_or_default();
    let items: Vec<String> = if value.starts_with('[') {
        flow_items(value)
    } else if !value.is_empty() {
        let value = scalar_item(value);
        if tags {
            value
                .split(|c: char| c == ',' || is_space(c))
                .map(str::to_string)
                .collect()
        } else {
            value.split(',').map(str::to_string).collect()
        }
    } else {
        lines[at + 1..]
            .iter()
            .filter(|line| !line.trim().is_empty())
            .map_while(|line| block_item(line))
            .map(scalar_item)
            .collect()
    };
    items
        .iter()
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

fn is_table_rule(text: &str) -> bool {
    text.chars().all(|c| matches!(c, '-' | ':' | ' '))
}

fn collapse(text: &str) -> String {
    text.split_whitespace().collect::<Vec<_>>().join(" ")
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

fn tag_skip(chars: &[char], spans: &CodeSpans, index: usize) -> usize {
    match chars[index] {
        '\\' => (index + 2).min(chars.len()),
        '`' => {
            let run = run_at(chars, index, b'`');
            spans
                .close(index, run, chars.len())
                .map_or(index + run, |close| close + run)
        }
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
    let spans = CodeSpans::new(&chars);
    let mut tags = Vec::new();
    let mut index = 0;
    while index < chars.len() {
        let skipped = tag_skip(&chars, &spans, index);
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
    collapse(&String::from_iter(
        oleafly_core::markdown_scan::plain_line(line).text,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn search(notes: &[IndexedNote], query: &Query, limit: usize) -> Vec<NoteSearchHit> {
        let compiled = Compiled::new(query, SearchMode::Ranked).unwrap();
        let options = SearchOptions {
            limit: Some(u32::try_from(limit).unwrap_or(u32::MAX)),
            ..SearchOptions::default()
        };
        search_compiled(notes, query, &compiled, options)
    }

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
        assert_eq!(tags("tags: []"), Vec::<String>::new());
        assert_eq!(tags("tags: [ , ]"), Vec::<String>::new());
        assert_eq!(tags("tags: [a, \"b c\", '#d']"), vec!["a", "b c", "d"]);
        let parsed = parse_note("---\naliases:\n  - 'Masked encoders'\nalias: [MAE]\n---\n");
        assert_eq!(parsed.aliases, vec!["Masked encoders", "MAE"]);
        assert_eq!(parse_note("No front matter #tag").tags, vec!["tag"]);
        assert_eq!(
            parse_note("---\ntags: a\nno close").tags,
            Vec::<String>::new()
        );
    }

    #[test]
    fn tag_list_items_follow_the_quoted_scalar_rules() {
        let parsed = |front: &str| parse_note(&format!("---\n{front}\n---\nBody\n"));
        let tags = |front: &str| parsed(front).tags;
        assert_eq!(tags("tags: [\"a, b\"]"), vec!["a, b"]);
        assert_eq!(tags("tags: ['it''s']"), vec!["it's"]);
        assert_eq!(tags("tags: [a, \"b c\"]"), vec!["a", "b c"]);
        assert_eq!(
            tags("tags: ['it''s', \"x\\\"y\", plain]"),
            vec!["it's", "x\"y", "plain"]
        );
        assert_eq!(tags("tags: [\"a]b\", c]"), vec!["a]b", "c"]);
        assert_eq!(tags("tags: [\"caf\\u00e9\" x, d]"), vec!["caf\u{e9}", "d"]);
        assert_eq!(
            tags("tags:\n  - \"a, b\"\n  - 'c' \n  - 'it''s'\n  - \"#d\""),
            vec!["a, b", "c", "it's", "d"]
        );
        assert_eq!(parsed("tags: [\"A, b\", C]").tag_labels, vec!["A, b", "C"]);
        assert_eq!(tags("tags: \"#a #b\""), vec!["a", "b"]);
        assert_eq!(tags("tags: 'one, two'"), vec!["one", "two"]);
        assert_eq!(
            parsed("aliases: [\"Smith, J.\", 'O''Brien']").aliases,
            vec!["Smith, J.", "O'Brien"]
        );
        assert_eq!(
            parsed("aliases:\n  - \"Masking, study\"").aliases,
            vec!["Masking, study"]
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
    fn deeply_nested_link_labels_do_not_overflow_the_stack() {
        let depth = 200_000;
        let line = format!("{}deep{} after", "[".repeat(depth), "](x)".repeat(depth));
        let parsed = std::thread::Builder::new()
            .stack_size(256 * 1024)
            .spawn(move || parse_note(&line))
            .unwrap()
            .join()
            .unwrap();
        assert_eq!(parsed.plain, "deep after");
    }

    #[test]
    fn a_fence_closes_only_on_a_bare_marker_of_the_same_kind() {
        let parsed = parse_note(
            "```\n``` js\n#hidden\n~~~\n#also\n```\n#shown\n~~~~\n```\n#quiet\n~~~~~\n#last\n",
        );
        assert_eq!(parsed.tags, vec!["shown", "last"]);
        assert!(parsed.plain.contains("#hidden"));
        assert!(parsed.plain.contains("#quiet"));
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
        crate::note_index::read_parsed(&CACHE, entry, parse_note)
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
        crate::note_index::notes_release_caches();
        assert!(CACHE.lock().unwrap().is_empty());
        let reread = read(&entry).unwrap();
        assert!(!Arc::ptr_eq(&changed, &reread));
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
        let hits = note_search_with(
            "masking",
            SearchOptions {
                limit: None,
                ..SearchOptions::default()
            },
        )
        .unwrap();
        assert_eq!(hits.len(), 2);
        assert!(hits.iter().all(|hit| hit.updated_at > 0.0));
        let hits = note_search_with(
            &format!("masking project:{paper}"),
            SearchOptions {
                limit: Some(0),
                ..SearchOptions::default()
            },
        )
        .unwrap();
        assert_eq!(ids(&hits), vec![log.as_str()]);
        assert_eq!(hits[0].note_id.as_deref(), Some("n-2"));
        assert!(note_search_with(
            "  ",
            SearchOptions {
                limit: Some(5),
                ..SearchOptions::default()
            }
        )
        .unwrap()
        .is_empty());
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
        let after = note_search_with(
            "masking",
            SearchOptions {
                limit: None,
                ..SearchOptions::default()
            },
        )
        .unwrap();
        assert_eq!(ids(&after), vec![log.as_str()]);
        let cache = CACHE.lock().unwrap();
        assert!(cache.keys().all(|path| !path.starts_with(&dir)));
        drop(cache);
        std::env::remove_var("OLEAFLY_DATA_DIR");
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn waits_briefly_for_a_note_whose_project_is_locked() {
        let _library = crate::collab::testing::TempLibrary::new();
        let locked = crate::project::create_note_project_from(
            "Locked".into(),
            "First draft.\n".into(),
            None,
        )
        .unwrap();
        assert!(note_search_with(
            "masking",
            SearchOptions {
                limit: None,
                ..SearchOptions::default()
            }
        )
        .unwrap()
        .is_empty());
        let path = crate::paths::project_dir(&locked)
            .unwrap()
            .join(crate::project::NOTE_FILE);
        std::fs::write(path, "Masking held during a checkpoint.\n").unwrap();
        let held = crate::worktree_lock::ProjectWorktreeLock::try_exclusive(&locked)
            .unwrap()
            .unwrap();
        let (sender, receiver) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            let _ = sender.send(
                note_search_with(
                    "masking",
                    SearchOptions {
                        limit: None,
                        ..SearchOptions::default()
                    },
                )
                .unwrap(),
            );
        });
        let early = receiver.recv_timeout(std::time::Duration::from_millis(100));
        drop(held);
        let hits = early.or_else(|_| receiver.recv()).unwrap();
        assert_eq!(ids(&hits), vec![locked.as_str()]);
    }
    fn run_with(notes: &[IndexedNote], query: &str, mode: SearchMode) -> Vec<NoteSearchHit> {
        let query = parse_query(query);
        let compiled = Compiled::new(&query, mode).unwrap();
        let options = SearchOptions {
            limit: None,
            mode,
            blocks: true,
        };
        search_compiled(notes, &query, &compiled, options)
    }

    fn block_rows(hit: &NoteSearchHit) -> Vec<(u32, &str, Option<&str>, &str)> {
        hit.blocks
            .iter()
            .map(|block| {
                (
                    block.line,
                    block.kind,
                    block.block.as_deref(),
                    block.text.as_str(),
                )
            })
            .collect()
    }

    const LAB: &str = "---\nid: lab\ntags: [project]\n---\nIntro paragraph #lab with a\nsecond line ^intro\n\n- [ ] Check the cable #lab/wiring\n  still loose\n- Plain item\n\n| run | note |\n| --- | --- |\n| 3 | #lab ok |\n\n^tbl\n\n## Results #lab\n\n> quoted #lab\n> more\n\n```\n#lab in code\n```\n";

    #[test]
    fn splits_a_note_into_blocks_with_lines_ids_and_tags() {
        let parsed = parse_note(LAB);
        let blocks: Vec<(BlockKind, u32, Option<&str>, Vec<&str>)> = parsed
            .blocks
            .iter()
            .map(|block| {
                (
                    block.kind,
                    block.line,
                    block.id.as_deref(),
                    block.tags.iter().map(String::as_str).collect(),
                )
            })
            .collect();
        assert_eq!(
            blocks,
            vec![
                (BlockKind::Paragraph, 5, Some("intro"), vec!["lab"]),
                (BlockKind::Item, 8, None, vec!["lab/wiring"]),
                (BlockKind::Item, 10, None, vec![]),
                (BlockKind::Row, 12, Some("tbl"), vec![]),
                (BlockKind::Row, 14, Some("tbl"), vec!["lab"]),
                (BlockKind::Heading, 18, None, vec!["lab"]),
                (BlockKind::Quote, 20, None, vec!["lab"]),
                (BlockKind::Code, 23, None, vec![]),
            ]
        );
    }

    #[test]
    fn tag_searches_list_the_blocks_that_carry_the_tag() {
        let notes = vec![
            note("a", "Lab log", LAB),
            note("b", "Other", "No tags here.\n"),
        ];
        let hits = run_with(&notes, "tag:lab", SearchMode::Ranked);
        assert_eq!(ids(&hits), vec!["a"]);
        assert_eq!(
            block_rows(&hits[0]),
            vec![
                (
                    5,
                    "paragraph",
                    Some("intro"),
                    "Intro paragraph #lab with a second line"
                ),
                (8, "item", None, "Check the cable #lab/wiring still loose"),
                (14, "row", Some("tbl"), "3 #lab ok"),
                (18, "heading", None, "Results #lab"),
                (20, "quote", None, "quoted #lab more"),
            ]
        );
        let first = &hits[0].blocks[0];
        let marked_text = marked(&NoteSearchSnippet {
            text: first.text.clone(),
            ranges: first.ranges.clone(),
        });
        assert_eq!(marked_text, "Intro paragraph [#lab] with a second line");
        let wiring = run_with(&notes, "tag:lab/wiring cable", SearchMode::Ranked);
        assert_eq!(block_rows(&wiring[0]).len(), 1);
        assert!(run_with(&notes, "tag:project", SearchMode::Ranked)[0]
            .blocks
            .is_empty());
        assert!(search(&notes, &parse_query("tag:lab"), DEFAULT_LIMIT)[0]
            .blocks
            .is_empty());
        let json = serde_json::to_value(&hits[0]).unwrap();
        assert_eq!(json["blocks"][0]["block"], "intro");
        assert!(json["blocks"][1].get("block").is_none());
        let plain = serde_json::to_value(&run(&notes, "lab")[0]).unwrap();
        assert!(plain.get("blocks").is_none());
    }

    #[test]
    fn exact_and_regex_modes_match_literal_text_with_smart_case() {
        let notes = vec![
            note(
                "a",
                "Mask ratios",
                "Ran a.b tests at ratio 75.\nRatio 60 next.\n",
            ),
            note("b", "Other", "axb and nothing else\n"),
        ];
        assert_eq!(ids(&run_with(&notes, "a.b", SearchMode::Exact)), vec!["a"]);
        assert_eq!(
            ids(&run_with(&notes, "a.b", SearchMode::Regex)),
            vec!["a", "b"]
        );
        let regex = run_with(&notes, r"ratio\s\d+", SearchMode::Regex);
        assert_eq!(ids(&regex), vec!["a"]);
        assert_eq!(
            marked(&regex[0].snippets[0]),
            "Ran a.b tests at [ratio 75]."
        );
        assert_eq!(regex[0].snippets.len(), 2);
        assert_eq!(
            ids(&run_with(&notes, "Ratio", SearchMode::Exact)),
            vec!["a"]
        );
        assert_eq!(
            run_with(&notes, "Ratio", SearchMode::Exact)[0]
                .snippets
                .len(),
            1
        );
        assert!(run_with(&notes, "-ratio", SearchMode::Exact)
            .iter()
            .all(|hit| hit.id == "b"));
        assert_eq!(
            run_with(&notes, "mask", SearchMode::Exact)[0].title_ranges,
            vec![[0, 4]]
        );
        assert!(Compiled::new(&parse_query("(unclosed"), SearchMode::Regex).is_err());
        assert_eq!(
            block_rows(&run_with(&notes, "ratio", SearchMode::Exact)[0]),
            vec![(
                1,
                "paragraph",
                None,
                "Ran a.b tests at ratio 75. Ratio 60 next."
            )]
        );
    }

    #[test]
    fn fuzzy_mode_matches_titles_and_aliases_like_fzf() {
        let notes = vec![
            note("a", "Masking strategy report", "body\n"),
            note(
                "b",
                "Abstract draft",
                "---\naliases: [msk notes]\n---\nmasking\n",
            ),
            note("c", "Reading list", "masking\n"),
        ];
        let hits = run_with(&notes, "msk rpt", SearchMode::Fuzzy);
        assert_eq!(ids(&hits), vec!["a"]);
        assert!(!hits[0].title_ranges.is_empty());
        let both = run_with(&notes, "msk", SearchMode::Fuzzy);
        assert!(ids(&both).contains(&"a") && ids(&both).contains(&"b"));
        assert!(!ids(&both).contains(&"c"));
        assert_eq!(
            ids(&run_with(&notes, "'draft", SearchMode::Fuzzy)),
            vec!["b"]
        );
        assert!(run_with(&notes, "msk", SearchMode::Fuzzy)[0]
            .blocks
            .is_empty());
    }
    fn generated_vault(count: usize) -> Vec<IndexedNote> {
        let words = [
            "mask", "ratio", "encoder", "decoder", "patch", "loss", "batch", "schedule", "warmup",
            "token", "vision", "sweep",
        ];
        (0..count)
            .map(|index| {
                let mut text = format!(
                    "---\nid: n{index}\ntags: [project/{}]\n---\n# Note {index}\n\n",
                    index % 7
                );
                for line in 0..40 {
                    let word = words[(index + line) % words.len()];
                    let other = words[(index * 7 + line) % words.len()];
                    if line % 5 == 0 {
                        text.push_str(&format!(
                            "- [ ] Check the {word} run {line} #lab/{other} ^b{line}\n"
                        ));
                    } else {
                        text.push_str(&format!(
                            "The {word} at step {line} beat the {other} baseline by {}.\n\n",
                            (index + line) % 97
                        ));
                    }
                }
                note(
                    &format!("lib-{index}"),
                    &format!("Run {index} {}", words[index % words.len()]),
                    &text,
                )
            })
            .collect()
    }

    #[test]
    #[ignore = "timing run, prints how long each search mode takes over 5,000 generated notes"]
    fn timing_over_a_generated_vault() {
        let started = std::time::Instant::now();
        let notes = generated_vault(5_000);
        eprintln!("parse 5000 notes: {:?}", started.elapsed());
        for (label, query, mode, blocks) in [
            ("ranked text", "mask ratio", SearchMode::Ranked, false),
            (
                "ranked tag + blocks",
                "tag:lab/encoder",
                SearchMode::Ranked,
                true,
            ),
            ("exact", "beat the mask", SearchMode::Exact, false),
            ("regex", r"step \d{2} beat", SearchMode::Regex, false),
            ("regex + blocks", r"step 3\d", SearchMode::Regex, true),
            ("fuzzy titles", "rn 42 msk", SearchMode::Fuzzy, false),
        ] {
            let parsed = parse_query(query);
            let compiled = Compiled::new(&parsed, mode).unwrap();
            let options = SearchOptions {
                limit: Some(50),
                mode,
                blocks,
            };
            let started = std::time::Instant::now();
            let hits = search_compiled(&notes, &parsed, &compiled, options);
            eprintln!("{label}: {} hits in {:?}", hits.len(), started.elapsed());
            assert!(!hits.is_empty(), "{label}");
        }
    }
}
