use std::collections::{BTreeMap, BTreeSet, HashSet};
use std::sync::LazyLock;

use serde::{Deserialize, Serialize};

use crate::jsre::JsRegex;
use crate::mask::mask_comments;
use crate::text::{is_js_space, js_trim, js_trim_end, strip_quotes, utf16_len, SourceText};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum BibliographyEngine {
    Latex,
    Biblatex,
    Markdown,
    Typst,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum BibliographyCommand {
    Bibliography,
    Addbibresource,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct BibliographyDeclaration {
    pub raw: String,
    pub from: usize,
    pub to: usize,
    pub command: BibliographyCommand,
}

static DECLARATION: LazyLock<JsRegex> = LazyLock::new(|| {
    JsRegex::std(r"\\(bibliography|addbibresource)\*?\s*(?:\[[^\]]*\]\s*)?\{([^}]*)\}")
});
static HAS_EXTENSION: LazyLock<JsRegex> = LazyLock::new(|| JsRegex::std(r"(?i)\.[a-z0-9]+$"));
static BIB_SUFFIX: LazyLock<JsRegex> = LazyLock::new(|| JsRegex::std(r"(?i)\.bib$"));
static URL_LIKE: LazyLock<JsRegex> = LazyLock::new(|| JsRegex::std(r"(?i)^[a-z][a-z0-9+.-]*:"));
static DRIVE_PATH: LazyLock<JsRegex> = LazyLock::new(|| JsRegex::std(r"^[A-Za-z]:/"));

fn normalize_relative_path(path: &str) -> Option<String> {
    let replaced = path.replace('\\', "/");
    let has_control = replaced
        .chars()
        .any(|ch| (ch as u32) <= 0x1f || ch as u32 == 0x7f);
    if replaced.starts_with('/') || DRIVE_PATH.is_match(&replaced) || has_control {
        return None;
    }
    let mut parts: Vec<&str> = Vec::new();
    for part in replaced.split('/') {
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

fn spellings_for(base: &str, engine: BibliographyEngine) -> Vec<String> {
    if engine == BibliographyEngine::Biblatex || BIB_SUFFIX.is_match(base) {
        return vec![base.to_string()];
    }
    if engine == BibliographyEngine::Latex || !HAS_EXTENSION.is_match(base) {
        return vec![base.to_string(), format!("{base}.bib")];
    }
    vec![base.to_string()]
}

fn directory_of(path: &str) -> &str {
    match path.rfind('/') {
        Some(index) => &path[..index],
        None => "",
    }
}

pub fn normalize_bibliography_target(raw: &str) -> String {
    strip_quotes(js_trim(raw)).to_string()
}

pub fn bibliography_engine_for_command(command: BibliographyCommand) -> BibliographyEngine {
    match command {
        BibliographyCommand::Addbibresource => BibliographyEngine::Biblatex,
        BibliographyCommand::Bibliography => BibliographyEngine::Latex,
    }
}

pub fn bibliography_display_name(raw: &str, engine: BibliographyEngine) -> String {
    let raw = normalize_bibliography_target(raw);
    if engine == BibliographyEngine::Biblatex || HAS_EXTENSION.is_match(&raw) {
        return raw;
    }
    format!("{raw}.bib")
}

pub fn bibliography_declarations(source: &str) -> Vec<BibliographyDeclaration> {
    let text = SourceText::new(source.to_string());
    let mut declarations = Vec::new();
    for found in DECLARATION.find_all(&text).matches {
        let command = if found.text(&text, 1) == Some("addbibresource") {
            BibliographyCommand::Addbibresource
        } else {
            BibliographyCommand::Bibliography
        };
        for declared in found.text(&text, 2).unwrap_or("").split(',') {
            let raw = normalize_bibliography_target(declared);
            if raw.is_empty() || URL_LIKE.is_match(&raw) {
                continue;
            }
            declarations.push(BibliographyDeclaration {
                raw,
                from: found.from,
                to: found.to,
                command,
            });
        }
    }
    declarations
}

pub fn bibliography_candidate_paths(
    raw: &str,
    from_file: &str,
    engine: BibliographyEngine,
) -> Vec<String> {
    let raw = normalize_bibliography_target(raw);
    if raw.is_empty()
        || raw.starts_with('#')
        || raw.starts_with('@')
        || raw.starts_with('/')
        || URL_LIKE.is_match(&raw)
    {
        return Vec::new();
    }
    let relative = raw.strip_prefix("./").unwrap_or(&raw);
    let directory = directory_of(from_file);
    let root_first = matches!(
        engine,
        BibliographyEngine::Latex | BibliographyEngine::Biblatex
    );
    let bases = if directory.is_empty() {
        vec![relative.to_string()]
    } else if root_first {
        vec![relative.to_string(), format!("{directory}/{relative}")]
    } else {
        vec![format!("{directory}/{relative}"), relative.to_string()]
    };
    let mut candidates: Vec<String> = Vec::new();
    for base in bases {
        for spelling in spellings_for(&base, engine) {
            if let Some(normalized) = normalize_relative_path(&spelling) {
                if !candidates.contains(&normalized) {
                    candidates.push(normalized);
                }
            }
        }
    }
    candidates
}

pub fn resolve_bibliography_path(
    raw: &str,
    from_file: &str,
    known: &[String],
    engine: BibliographyEngine,
) -> Option<String> {
    let exact: HashSet<&str> = known.iter().map(String::as_str).collect();
    let mut by_lower: BTreeMap<String, &str> = BTreeMap::new();
    for file in known {
        by_lower.entry(file.to_lowercase()).or_insert(file.as_str());
    }
    for candidate in bibliography_candidate_paths(raw, from_file, engine) {
        if exact.contains(candidate.as_str()) {
            return Some(candidate);
        }
        if let Some(insensitive) = by_lower.get(&candidate.to_lowercase()) {
            return Some((*insensitive).to_string());
        }
    }
    None
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct BibtexEntryType {
    pub name: &'static str,
    pub required: Vec<&'static [&'static str]>,
    #[serde(skip)]
    pub optional: Vec<&'static str>,
}

const CREATOR: &[&str] = &["author", "editor"];
const JOURNAL: &[&str] = &["journal", "journaltitle"];
const SCHOOL: &[&str] = &["school", "institution"];
const WEB_LOCATOR: &[&str] = &["url", "doi", "eprint"];
const YEAR: &[&str] = &["year", "date"];
const AUTHOR: &[&str] = &["author"];
const TITLE: &[&str] = &["title"];
const EDITOR: &[&str] = &["editor"];
const PUBLISHER: &[&str] = &["publisher"];
const BOOKTITLE: &[&str] = &["booktitle"];
const INSTITUTION: &[&str] = &["institution"];
const NUMBER: &[&str] = &["number"];
const NOTE: &[&str] = &["note"];
const CHAPTER_OR_PAGES: &[&str] = &["chapter", "pages"];

const GENERAL_FIELDS: &[&str] = &[
    "addendum",
    "doi",
    "eprint",
    "eprintclass",
    "eprinttype",
    "key",
    "keywords",
    "language",
    "month",
    "note",
    "pubstate",
    "url",
    "urldate",
];
const TITLE_FIELDS: &[&str] = &["shorttitle", "subtitle", "titleaddon"];
const LINK_FIELDS: &[&str] = &["crossref", "entryset", "related", "xdata", "xref"];
const CONTRIBUTOR_FIELDS: &[&str] = &[
    "afterword",
    "annotator",
    "commentator",
    "editor",
    "foreword",
    "introduction",
    "translator",
];
const IMPRINT_FIELDS: &[&str] = &[
    "address",
    "edition",
    "isbn",
    "location",
    "number",
    "pages",
    "pagetotal",
    "part",
    "publisher",
    "series",
    "volume",
    "volumes",
];
const PERIODICAL_FIELDS: &[&str] = &[
    "issn",
    "issue",
    "issuetitle",
    "journalsubtitle",
    "number",
    "pages",
    "volume",
];
const EVENT_FIELDS: &[&str] = &["eventdate", "eventtitle", "organization", "venue"];
const WORK_FIELDS: &[&str] = &["booktitle", "chapter", "howpublished", "type", "version"];

fn entry_type(
    name: &'static str,
    required: &[&'static [&'static str]],
    extra_optional: &[&[&'static str]],
) -> BibtexEntryType {
    let required_names: HashSet<&str> = required
        .iter()
        .flat_map(|group| group.iter().copied())
        .collect();
    let mut seen = HashSet::new();
    let mut optional: Vec<&'static str> = GENERAL_FIELDS
        .iter()
        .chain(TITLE_FIELDS)
        .chain(LINK_FIELDS)
        .chain(extra_optional.iter().flat_map(|group| group.iter()))
        .copied()
        .filter(|field| seen.insert(*field))
        .filter(|field| !required_names.contains(field))
        .collect();
    optional.sort_unstable();
    BibtexEntryType {
        name,
        required: required.to_vec(),
        optional,
    }
}

fn alias_of(name: &'static str, source: &BibtexEntryType) -> BibtexEntryType {
    BibtexEntryType {
        name,
        required: source.required.clone(),
        optional: source.optional.clone(),
    }
}

static ENTRY_TYPES: LazyLock<Vec<BibtexEntryType>> = LazyLock::new(|| {
    let article = entry_type(
        "article",
        &[AUTHOR, TITLE, JOURNAL, YEAR],
        &[PERIODICAL_FIELDS, CONTRIBUTOR_FIELDS, &["series"]],
    );
    let book = entry_type(
        "book",
        &[CREATOR, TITLE, PUBLISHER, YEAR],
        &[
            IMPRINT_FIELDS,
            CONTRIBUTOR_FIELDS,
            &["maintitle", "chapter"],
        ],
    );
    let inbook = entry_type(
        "inbook",
        &[CREATOR, TITLE, CHAPTER_OR_PAGES, PUBLISHER, YEAR],
        &[
            IMPRINT_FIELDS,
            CONTRIBUTOR_FIELDS,
            &["booktitle", "maintitle"],
        ],
    );
    let inproceedings = entry_type(
        "inproceedings",
        &[AUTHOR, TITLE, BOOKTITLE, YEAR],
        &[IMPRINT_FIELDS, CONTRIBUTOR_FIELDS, EVENT_FIELDS],
    );
    let proceedings = entry_type(
        "proceedings",
        &[TITLE, YEAR],
        &[IMPRINT_FIELDS, CONTRIBUTOR_FIELDS, EVENT_FIELDS],
    );
    let collection = entry_type(
        "collection",
        &[EDITOR, TITLE, YEAR],
        &[IMPRINT_FIELDS, CONTRIBUTOR_FIELDS, &["maintitle"]],
    );
    let thesis = entry_type(
        "thesis",
        &[AUTHOR, TITLE, SCHOOL, YEAR],
        &[IMPRINT_FIELDS, WORK_FIELDS],
    );
    let report = entry_type(
        "report",
        &[AUTHOR, TITLE, INSTITUTION, YEAR],
        &[IMPRINT_FIELDS, WORK_FIELDS, &["isrn"]],
    );
    let online = entry_type(
        "online",
        &[TITLE, WEB_LOCATOR],
        &[
            CONTRIBUTOR_FIELDS,
            WORK_FIELDS,
            &["author", "organization", "year", "date"],
        ],
    );
    let dataset = entry_type(
        "dataset",
        &[TITLE, YEAR],
        &[
            CONTRIBUTOR_FIELDS,
            WORK_FIELDS,
            &["author", "publisher", "organization"],
        ],
    );
    let mut types = vec![
        alias_of("bookinbook", &inbook),
        alias_of("conference", &inproceedings),
        alias_of("electronic", &online),
        alias_of("mastersthesis", &thesis),
        alias_of("phdthesis", &thesis),
        alias_of("reference", &collection),
        alias_of("suppbook", &inbook),
        alias_of("techreport", &report),
        alias_of("www", &online),
        entry_type(
            "booklet",
            &[TITLE],
            &[IMPRINT_FIELDS, &["author", "year", "date", "howpublished"]],
        ),
        entry_type(
            "incollection",
            &[AUTHOR, TITLE, BOOKTITLE, PUBLISHER, YEAR],
            &[IMPRINT_FIELDS, CONTRIBUTOR_FIELDS, &["maintitle"]],
        ),
        entry_type(
            "inreference",
            &[CREATOR, TITLE, BOOKTITLE, YEAR],
            &[IMPRINT_FIELDS, CONTRIBUTOR_FIELDS, &["maintitle"]],
        ),
        entry_type(
            "manual",
            &[TITLE],
            &[
                IMPRINT_FIELDS,
                WORK_FIELDS,
                &["author", "organization", "year", "date"],
            ],
        ),
        entry_type(
            "misc",
            &[],
            &[
                IMPRINT_FIELDS,
                CONTRIBUTOR_FIELDS,
                WORK_FIELDS,
                &["author", "organization", "year", "date"],
            ],
        ),
        entry_type(
            "mvbook",
            &[AUTHOR, TITLE, YEAR],
            &[IMPRINT_FIELDS, CONTRIBUTOR_FIELDS, &["maintitle"]],
        ),
        entry_type(
            "patent",
            &[AUTHOR, TITLE, NUMBER, YEAR],
            &[IMPRINT_FIELDS, WORK_FIELDS, &["holder", "version"]],
        ),
        entry_type(
            "periodical",
            &[EDITOR, TITLE, YEAR],
            &[PERIODICAL_FIELDS, &["issuesubtitle", "series"]],
        ),
        entry_type(
            "software",
            &[TITLE, YEAR],
            &[IMPRINT_FIELDS, WORK_FIELDS, &["author", "organization"]],
        ),
        entry_type(
            "unpublished",
            &[AUTHOR, TITLE, NOTE],
            &[WORK_FIELDS, &["year", "date", "pages"]],
        ),
    ];
    types.extend([
        article,
        book,
        inbook,
        inproceedings,
        proceedings,
        collection,
        thesis,
        report,
        online,
        dataset,
    ]);
    types.sort_by(|left, right| left.name.cmp(right.name));
    types
});

pub const BIBTEX_DIRECTIVES: &[&str] = &["comment", "preamble", "string"];

pub fn bibtex_entry_types() -> &'static [BibtexEntryType] {
    &ENTRY_TYPES
}

pub fn bibtex_entry_type(name: &str) -> Option<&'static BibtexEntryType> {
    let lower = name.to_lowercase();
    ENTRY_TYPES.iter().find(|entry| entry.name == lower)
}

pub fn is_bibtex_directive(name: &str) -> bool {
    BIBTEX_DIRECTIVES.contains(&name.to_lowercase().as_str())
}

pub fn missing_bibtex_required_fields(
    name: &str,
    present: &BTreeSet<String>,
) -> Vec<&'static [&'static str]> {
    let Some(entry) = bibtex_entry_type(name) else {
        return Vec::new();
    };
    entry
        .required
        .iter()
        .copied()
        .filter(|group| !group.iter().any(|field| present.contains(*field)))
        .collect()
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ParsedBib {
    pub key: String,
    #[serde(rename = "type")]
    pub r#type: String,
    pub fields: BTreeMap<String, String>,
}

static ENTRY_HEAD: LazyLock<JsRegex> =
    LazyLock::new(|| JsRegex::std(r"^@([0-9A-Za-z_]+)\s*\{\s*([^,\s}]+)\s*,"));
static FIELD_NAME: LazyLock<JsRegex> =
    LazyLock::new(|| JsRegex::fancy(r"(?<![A-Za-z])([A-Za-z]+)\s*=\s*"));

fn last_char_start(text: &str, end: usize) -> usize {
    text[..end]
        .char_indices()
        .last()
        .map(|(index, _)| index)
        .unwrap_or(0)
}

fn entry_value(body: &str, i: usize) -> (String, usize) {
    let bytes = body.as_bytes();
    match bytes.get(i) {
        Some(b'{') => {
            let mut depth = 0i64;
            let mut j = i;
            let mut closed = false;
            while j < bytes.len() {
                match bytes[j] {
                    b'{' => depth += 1,
                    b'}' => {
                        depth -= 1;
                        if depth == 0 {
                            j += 1;
                            closed = true;
                            break;
                        }
                    }
                    _ => {}
                }
                j += 1;
            }
            let end = if closed {
                j - 1
            } else {
                last_char_start(body, j)
            };
            let value = if end > i + 1 { &body[i + 1..end] } else { "" };
            (value.to_string(), j)
        }
        Some(b'"') => {
            let close = body[i + 1..]
                .find('"')
                .map(|at| i + 1 + at)
                .unwrap_or(body.len());
            (body[i + 1..close].to_string(), close + 1)
        }
        _ => {
            let end = body[i..]
                .find([',', '}', '\n'])
                .map(|at| i + at)
                .unwrap_or(body.len());
            (body[i..end].to_string(), end)
        }
    }
}

fn parse_entry_fields(body: &str) -> BTreeMap<String, String> {
    let mut fields = BTreeMap::new();
    let mut i = 0;
    while i < body.len() {
        let rest = &body[i..];
        let Some(found) = FIELD_NAME.first_str(rest) else {
            break;
        };
        let name = found.group(rest, 1).unwrap_or("").to_lowercase();
        i += found.end;
        let (value, next) = entry_value(body, i);
        i = next;
        fields.insert(name, js_trim(&value).to_string());
        match body.get(i..).and_then(|tail| tail.find(',')) {
            Some(at) => i += at + 1,
            None => break,
        }
    }
    fields
}

pub fn parse_entry(bibtex: &str) -> Option<ParsedBib> {
    let text = js_trim(bibtex);
    let head = ENTRY_HEAD.first_str(text)?;
    Some(ParsedBib {
        r#type: head.group(text, 1).unwrap_or("").to_lowercase(),
        key: head.group(text, 2).unwrap_or("").to_string(),
        fields: parse_entry_fields(&text[head.end..]),
    })
}

static ENTRY_SPLIT: LazyLock<JsRegex> = LazyLock::new(|| JsRegex::std(r"@[0-9A-Za-z_]+\s*\{"));

pub fn split_bib_entries(content: &str) -> Vec<&str> {
    let (heads, _) = ENTRY_SPLIT.captures_str(content);
    let mut pieces = Vec::new();
    let mut start = 0;
    for head in heads {
        if head.start > start {
            pieces.push(&content[start..head.start]);
            start = head.start;
        }
    }
    pieces.push(&content[start..]);
    pieces
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct LegacyBibKey {
    pub key: String,
    pub line: u32,
    pub from: usize,
    pub to: usize,
}

static LEGACY_ENTRY: LazyLock<JsRegex> =
    LazyLock::new(|| JsRegex::std(r"@([0-9A-Za-z_]+)\s*\{\s*([^,\s}]+)"));

pub fn legacy_bib_keys(bib_text: &str) -> Vec<LegacyBibKey> {
    let masked = SourceText::new(mask_comments(bib_text));
    let mut keys = Vec::new();
    for found in LEGACY_ENTRY.find_all(&masked).matches {
        let kind = found.text(&masked, 1).unwrap_or("").to_lowercase();
        if matches!(kind.as_str(), "comment" | "string" | "preamble") {
            continue;
        }
        keys.push(LegacyBibKey {
            key: found.text(&masked, 2).unwrap_or("").to_string(),
            line: masked.position(found.from).line,
            from: found.from,
            to: found.to,
        });
    }
    keys
}

pub const MAX_BIBLIOGRAPHY_YAML_CHARACTERS: usize = 1_000_000;
const SNIFF_WINDOW: usize = 8192;

static HAYAGRIVA_EXTENSION: LazyLock<JsRegex> = LazyLock::new(|| JsRegex::std(r"(?i)\.ya?ml$"));
static LOCKFILE_YAML: LazyLock<JsRegex> =
    LazyLock::new(|| JsRegex::std(r"(?:^|[-_.])lock\.ya?ml$"));

pub fn is_hayagriva_path(path: &str) -> bool {
    HAYAGRIVA_EXTENSION.is_match(path)
}

pub fn is_bibliography_yaml_candidate(path: &str) -> bool {
    if !is_hayagriva_path(path) {
        return false;
    }
    let replaced = path.replace('\\', "/");
    let parts: Vec<&str> = replaced.split('/').collect();
    if parts.iter().any(|part| part.starts_with('.')) {
        return false;
    }
    !LOCKFILE_YAML.is_match(&parts.last().copied().unwrap_or("").to_lowercase())
}

struct YamlLine<'a> {
    text: &'a str,
    indent: usize,
    blank: bool,
}

fn yaml_lines(source: &str) -> Vec<YamlLine<'_>> {
    source
        .split('\n')
        .map(|raw| {
            let text = raw.strip_suffix('\r').unwrap_or(raw);
            let indent = text
                .bytes()
                .take_while(|&b| b == b' ' || b == b'\t')
                .count();
            let rest = &text[indent..];
            YamlLine {
                text,
                indent,
                blank: js_trim(rest).is_empty() || rest.starts_with('#'),
            }
        })
        .collect()
}

fn char_at(text: &str, at: usize) -> Option<char> {
    text.get(at..).and_then(|rest| rest.chars().next())
}

fn is_blank_char(ch: Option<char>) -> bool {
    ch.is_none_or(is_js_space)
}

fn closing_quote(text: &str, start: usize, quote: u8) -> Option<usize> {
    let bytes = text.as_bytes();
    let mut index = start + 1;
    while index < bytes.len() {
        let byte = bytes[index];
        if quote == b'"' && byte == b'\\' {
            index += 2;
            continue;
        }
        if byte == quote {
            if quote == b'\'' && bytes.get(index + 1) == Some(&b'\'') {
                index += 2;
                continue;
            }
            return Some(index);
        }
        index += 1;
    }
    None
}

fn decode_double_quoted(body: &str) -> String {
    let mut value = String::new();
    let mut chars = body.char_indices().peekable();
    while let Some((index, ch)) = chars.next() {
        if ch != '\\' {
            value.push(ch);
            continue;
        }
        let next = chars.peek().map(|&(_, next)| next);
        let hex_length = match next {
            Some('x') => 2,
            Some('u') => 4,
            Some('U') => 8,
            _ => 0,
        };
        let hex_start = index + 2;
        let hex = body.get(hex_start..hex_start + hex_length).unwrap_or("");
        if hex_length > 0 && hex.len() == hex_length && hex.bytes().all(|b| b.is_ascii_hexdigit()) {
            let code = u32::from_str_radix(hex, 16).unwrap_or(0xfffd);
            value.push(char::from_u32(code).unwrap_or('\u{fffd}'));
            chars.next();
            for _ in 0..hex_length {
                chars.next();
            }
            continue;
        }
        chars.next();
        match next {
            Some('0') => value.push('\0'),
            Some('b') => value.push('\u{8}'),
            Some('f') => value.push('\u{c}'),
            Some('n') => value.push('\n'),
            Some('r') => value.push('\r'),
            Some('t') => value.push('\t'),
            Some('N') => value.push('\u{85}'),
            Some('_') => value.push('\u{a0}'),
            Some('L') => value.push('\u{2028}'),
            Some('P') => value.push('\u{2029}'),
            Some(other) => value.push(other),
            None => {}
        }
    }
    value
}

fn yaml_scalar(raw: &str) -> String {
    let text = js_trim(raw);
    let quote = text.as_bytes().first().copied();
    if let Some(quote @ (b'"' | b'\'')) = quote {
        let close = closing_quote(text, 0, quote).unwrap_or(text.len());
        let body = text.get(1..close).unwrap_or("");
        return if quote == b'"' {
            decode_double_quoted(body)
        } else {
            body.replace("''", "'")
        };
    }
    text.to_string()
}

fn strip_comment(text: &str) -> &str {
    let bytes = text.as_bytes();
    let mut quote: Option<u8> = None;
    let mut index = 0;
    while index < bytes.len() {
        let byte = bytes[index];
        match quote {
            Some(open) => {
                if open == b'"' && byte == b'\\' {
                    index += 1;
                } else if byte == open {
                    quote = None;
                }
            }
            None => {
                if byte == b'"' || byte == b'\'' {
                    quote = Some(byte);
                } else if byte == b'#'
                    && (index == 0 || is_blank_char(text[..index].chars().next_back()))
                {
                    return js_trim_end(&text[..index]);
                }
            }
        }
        index += 1;
    }
    js_trim_end(text)
}

struct MappingKey {
    key: String,
    value_start: usize,
}

fn quoted_mapping_key(text: &str, start: usize, quote: u8) -> Option<MappingKey> {
    let close = closing_quote(text, start, quote)?;
    let key = yaml_scalar(&text[start..=close]);
    let mut after = close + 1;
    while matches!(text.as_bytes().get(after), Some(b' ') | Some(b'\t')) {
        after += 1;
    }
    if text.as_bytes().get(after) != Some(&b':') || key.is_empty() {
        return None;
    }
    Some(MappingKey {
        key,
        value_start: after + 1,
    })
}

fn plain_key_colon(text: &str, start: usize) -> Option<usize> {
    for (index, ch) in text[start..].char_indices() {
        let index = start + index;
        if ch == ':' && is_blank_char(char_at(text, index + 1)) {
            return Some(index);
        }
        if ch == '#' && index > start && is_blank_char(text[..index].chars().next_back()) {
            return None;
        }
    }
    None
}

fn plain_mapping_key(text: &str, start: usize) -> Option<MappingKey> {
    let colon = plain_key_colon(text, start)?;
    let key = js_trim_end(&text[start..colon]);
    if key.is_empty() {
        return None;
    }
    Some(MappingKey {
        key: key.to_string(),
        value_start: colon + 1,
    })
}

fn read_mapping_key(text: &str, start: usize) -> Option<MappingKey> {
    let first = char_at(text, start)?;
    if "-?[]{}#&*!|>%@`,".contains(first) {
        return None;
    }
    match first {
        '"' => quoted_mapping_key(text, start, b'"'),
        '\'' => quoted_mapping_key(text, start, b'\''),
        _ => plain_mapping_key(text, start),
    }
}

fn split_flow(body: &str) -> Vec<&str> {
    let bytes = body.as_bytes();
    let mut items = Vec::new();
    let mut depth = 0i64;
    let mut quote: Option<u8> = None;
    let mut start = 0;
    let mut index = 0;
    while index < bytes.len() {
        let byte = bytes[index];
        match quote {
            Some(open) => {
                if open == b'"' && byte == b'\\' {
                    index += 1;
                } else if byte == open {
                    quote = None;
                }
            }
            None => match byte {
                b'"' | b'\'' => quote = Some(byte),
                b'[' | b'{' => depth += 1,
                b']' | b'}' => depth -= 1,
                b',' if depth == 0 => {
                    items.push(js_trim(&body[start..index]));
                    start = index + 1;
                }
                _ => {}
            },
        }
        index += 1;
    }
    items.push(js_trim(body.get(start..).unwrap_or("")));
    items.into_iter().filter(|item| !item.is_empty()).collect()
}

fn flow_body(text: &str, open: char, close: char) -> Option<&str> {
    let trimmed = js_trim(text);
    if !trimmed.starts_with(open) || !trimmed.ends_with(close) || trimmed.len() < 2 {
        return None;
    }
    Some(&trimmed[open.len_utf8()..trimmed.len() - close.len_utf8()])
}

fn flow_map_keys(text: &str) -> Option<Vec<String>> {
    let body = flow_body(text, '{', '}')?;
    Some(
        split_flow(body)
            .into_iter()
            .filter_map(|item| read_mapping_key(item, 0).map(|key| key.key))
            .collect(),
    )
}

fn field_block_names(lines: &[&YamlLine<'_>]) -> Vec<String> {
    let content: Vec<&YamlLine<'_>> = lines.iter().copied().filter(|line| !line.blank).collect();
    let Some(first) = content.first() else {
        return Vec::new();
    };
    let indent = first.indent;
    let mut names = Vec::new();
    let mut index = 0;
    while index < content.len() {
        let line = content[index];
        if line.indent == indent {
            if let Some(key) = read_mapping_key(line.text, line.indent) {
                while index + 1 < content.len() {
                    let next = content[index + 1];
                    let sequence =
                        next.indent == indent && next.text[next.indent..].starts_with('-');
                    if next.indent <= indent && !sequence {
                        break;
                    }
                    index += 1;
                }
                names.push(key.key);
            }
        }
        index += 1;
    }
    names
}

fn is_document_marker(text: &str) -> bool {
    text.starts_with("---") || text.starts_with("...") || text.starts_with('%')
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct HayagrivaKey {
    pub key: String,
    pub line_from: usize,
    pub is_entry: bool,
}

pub fn hayagriva_entry_keys(source: &str) -> Vec<HayagrivaKey> {
    let lines = yaml_lines(source);
    let mut line_offsets = Vec::with_capacity(lines.len());
    let mut offset = 0;
    for raw in source.split('\n') {
        line_offsets.push(offset);
        offset += utf16_len(raw) + 1;
    }
    let mut entries = Vec::new();
    let mut index = 0;
    while index < lines.len() {
        let line = &lines[index];
        let line_index = index;
        index += 1;
        if line.blank || line.indent > 0 || is_document_marker(line.text) {
            continue;
        }
        let Some(key) = read_mapping_key(line.text, 0) else {
            continue;
        };
        let mut body: Vec<&YamlLine<'_>> = Vec::new();
        while index < lines.len() && (lines[index].blank || lines[index].indent > 0) {
            body.push(&lines[index]);
            index += 1;
        }
        let inline = js_trim(strip_comment(
            &line.text[key.value_start.min(line.text.len())..],
        ));
        let names = if inline.is_empty() {
            field_block_names(&body)
        } else {
            flow_map_keys(inline).unwrap_or_default()
        };
        entries.push(HayagrivaKey {
            key: key.key,
            line_from: line_offsets[line_index],
            is_entry: names.iter().any(|name| name == "type" || name == "title"),
        });
    }
    entries
}

pub fn hayagriva_keys(source: &str) -> BTreeSet<String> {
    hayagriva_entry_keys(source)
        .into_iter()
        .map(|entry| entry.key)
        .collect()
}

fn utf16_prefix(text: &str, units: usize) -> &str {
    let mut count = 0;
    for (index, ch) in text.char_indices() {
        count += ch.len_utf16();
        if count > units {
            return &text[..index];
        }
    }
    text
}

pub fn looks_like_hayagriva(text: &str) -> bool {
    let window = utf16_prefix(text, SNIFF_WINDOW);
    let lines = yaml_lines(window);
    let mut index = 0;
    while index < lines.len() && (lines[index].blank || is_document_marker(lines[index].text)) {
        index += 1;
    }
    let Some(first) = lines.get(index) else {
        return false;
    };
    if first.indent > 0 {
        return false;
    }
    let Some(key) = read_mapping_key(first.text, 0) else {
        return false;
    };
    let inline = js_trim(strip_comment(
        &first.text[key.value_start.min(first.text.len())..],
    ));
    if !inline.is_empty() {
        return flow_map_keys(inline)
            .is_some_and(|keys| keys.iter().any(|name| name == "type" || name == "title"));
    }
    let body: Vec<&YamlLine<'_>> = lines[index + 1..]
        .iter()
        .take_while(|line| line.blank || line.indent > 0)
        .collect();
    field_block_names(&body)
        .iter()
        .any(|name| name == "type" || name == "title")
}

pub fn accepts_bibliography_yaml(text: &str, referenced: impl FnOnce() -> bool) -> bool {
    utf16_len(text) <= MAX_BIBLIOGRAPHY_YAML_CHARACTERS
        && (looks_like_hayagriva(text) || referenced())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn candidate_paths_follow_the_engine() {
        assert_eq!(
            bibliography_candidate_paths("refs", "chapters/a.tex", BibliographyEngine::Latex),
            vec!["refs", "refs.bib", "chapters/refs", "chapters/refs.bib"]
        );
        assert_eq!(
            bibliography_candidate_paths("refs.bib", "", BibliographyEngine::Biblatex),
            vec!["refs.bib"]
        );
        assert!(bibliography_candidate_paths("/abs.bib", "", BibliographyEngine::Latex).is_empty());
        assert!(bibliography_candidate_paths("C:/x.bib", "", BibliographyEngine::Latex).is_empty());
        assert!(bibliography_candidate_paths("../x", "", BibliographyEngine::Latex).is_empty());
    }

    #[test]
    fn declarations_split_names_and_skip_urls() {
        let found = bibliography_declarations("\\bibliography{a, b,https://x}");
        let names: Vec<_> = found.iter().map(|d| d.raw.as_str()).collect();
        assert_eq!(names, vec!["a", "b"]);
        assert_eq!((found[0].from, found[0].to), (0, 29));
    }

    #[test]
    fn parse_entry_reads_nested_quoted_and_bare_values() {
        let entry =
            parse_entry("@Article{key,\n title = {A {B} c},\n year = 2020,\n note = \"x\"}")
                .unwrap();
        assert_eq!(entry.r#type, "article");
        assert_eq!(entry.key, "key");
        assert_eq!(entry.fields["title"], "A {B} c");
        assert_eq!(entry.fields["year"], "2020");
        assert_eq!(entry.fields["note"], "x");
    }

    #[test]
    fn entry_types_are_sorted_and_aliases_share_groups() {
        let names: Vec<_> = bibtex_entry_types()
            .iter()
            .map(|entry| entry.name)
            .collect();
        let mut sorted = names.clone();
        sorted.sort_unstable();
        assert_eq!(names, sorted);
        assert_eq!(names.len(), 29);
        assert_eq!(
            bibtex_entry_type("PHDTHESIS").unwrap().required,
            bibtex_entry_type("thesis").unwrap().required
        );
    }

    #[test]
    fn splits_bib_content_at_entry_heads() {
        let pieces = split_bib_entries("% c\n@a{x,}\n@b {y,}");
        assert_eq!(pieces, vec!["% c\n", "@a{x,}\n", "@b {y,}"]);
    }

    #[test]
    fn legacy_keys_skip_directives_and_comments() {
        let keys = legacy_bib_keys("@string{a = b}\n% @misc{hidden,}\n@misc{kept,\n}");
        assert_eq!(keys.len(), 1);
        assert_eq!((keys[0].key.as_str(), keys[0].line), ("kept", 3));
    }

    #[test]
    fn hayagriva_keys_and_sniffing() {
        let yaml =
            "---\n# c\nsmith2020:\n  type: article\n  title: X\n\"quoted key\": { type: book }\n";
        assert_eq!(
            hayagriva_keys(yaml).into_iter().collect::<Vec<_>>(),
            vec!["quoted key".to_string(), "smith2020".to_string()]
        );
        assert!(looks_like_hayagriva(yaml));
        assert!(!looks_like_hayagriva("name: app\nversion: 2\n"));
    }
}
