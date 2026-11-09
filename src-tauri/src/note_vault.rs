use std::cell::{Cell, RefCell};
use std::collections::{HashMap, HashSet};
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock, PoisonError};

use oleafly_core::front_matter::{key_of, scalar_value, value_of};
use oleafly_core::portable::fold;
use serde::{Deserialize, Serialize};

use crate::app_error::AppError;
use crate::note_links::{has_scheme, is_linkable_id, scan_note, LinkKind};
use crate::project::{NOTE_ASSETS, NOTE_KIND};

const MAX_NOTE_BYTES: u64 = 5 * 1024 * 1024;
const MAX_ATTACHMENT_BYTES: u64 = 64 * 1024 * 1024;
const MAX_IMPORT_ATTACHMENT_BYTES: u64 = 2 * 1024 * 1024 * 1024;
const KEEP_FREE_BYTES: u64 = 2 * 1024 * 1024 * 1024;
const MAX_ORIGIN_BYTES: u64 = 64 * 1024;
const MAX_ENTRIES: usize = 200_000;
const MAX_DEPTH: usize = 64;
const FILE_IMPORT_DEPTH: usize = 1;
const MAX_TITLE_CHARS: usize = 200;
const MAX_STEM_CHARS: usize = 120;
const MAX_NAME_ATTEMPTS: usize = 999;
const MAX_RUN_ID_CHARS: usize = 64;
const MAX_PENDING: usize = 16;
const HISTORY_FILE: &str = "note-imports.json";
const HISTORY_LIMIT: usize = 200;
const NOTE_SCHEME: &str = "oleafly://note/";
const NOTEBOOK_INFO: &str = "notebook";
const ATTACHMENTS: &str = "attachments";
const UNTITLED: &str = "Untitled";
const IMAGE_EXTENSIONS: &[&str] = &[
    "apng", "avif", "bmp", "gif", "jpeg", "jpg", "png", "svg", "webp",
];
const MAX_NOT_COPIED: usize = 100;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ImportPhase {
    Read,
    Write,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportProgress {
    pub phase: ImportPhase,
    pub done: usize,
    pub total: usize,
    pub file: String,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportSummary {
    pub notes: usize,
    pub attachments: usize,
    pub unresolved: usize,
    pub skipped: usize,
    pub cancelled: bool,
    pub not_copied: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum ImportOutcome {
    Dismissed,
    Seen { imported_at: i64, notes: usize },
    Done(ImportSummary),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportSummary {
    pub folder: String,
    pub notes: usize,
    pub attachments: usize,
    pub skipped: usize,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NotesImportRequest {
    pub run_id: String,
    #[serde(default)]
    pub folder_tags: bool,
    #[serde(default)]
    pub again: bool,
    #[serde(default)]
    pub files: bool,
    #[serde(default)]
    pub title: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NotesExportRequest {
    #[serde(default)]
    pub note_id: Option<String>,
    pub folder_name: String,
    #[serde(default)]
    pub title: Option<String>,
}

#[derive(Debug, Clone, Copy, Default)]
pub(crate) struct ImportOptions {
    pub folder_tags: bool,
}

#[derive(Debug, Default)]
pub(crate) struct ImportReport {
    pub summary: ImportSummary,
    pub created: Vec<String>,
    pub error: Option<String>,
}

#[derive(Debug, Clone)]
struct VaultFile {
    rel: String,
    path: PathBuf,
    size: u64,
}

#[derive(Debug, Default)]
struct Vault {
    notes: Vec<VaultFile>,
    files: Vec<VaultFile>,
    skipped: usize,
    beside_only: bool,
}

fn new_note_id() -> String {
    use rand::RngCore;
    let mut bytes = [0u8; 16];
    rand::thread_rng().fill_bytes(&mut bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    let hex: String = bytes.iter().map(|byte| format!("{byte:02x}")).collect();
    format!(
        "{}-{}-{}-{}-{}",
        &hex[0..8],
        &hex[8..12],
        &hex[12..16],
        &hex[16..20],
        &hex[20..32]
    )
}

fn normalize_text(text: &str) -> String {
    let text = text.strip_prefix('\u{feff}').unwrap_or(text);
    text.replace("\r\n", "\n").replace('\r', "\n")
}

fn extension_of(name: &str) -> Option<String> {
    match name.rsplit_once('.') {
        Some((stem, extension)) if !stem.is_empty() && !extension.is_empty() => {
            Some(extension.to_ascii_lowercase())
        }
        _ => None,
    }
}

fn is_markdown(name: &str) -> bool {
    extension_of(name).as_deref() == Some("md")
}

fn is_image(name: &str) -> bool {
    extension_of(name).is_some_and(|extension| IMAGE_EXTENSIONS.contains(&extension.as_str()))
}

fn is_notebook(name: &str) -> bool {
    extension_of(name).as_deref() == Some("ipynb")
}

fn base_name(path: &str) -> &str {
    path.rsplit('/').next().unwrap_or(path)
}

fn file_stem(name: &str) -> &str {
    match name.rsplit_once('.') {
        Some((stem, _)) if !stem.is_empty() => stem,
        _ => name,
    }
}

fn truncate_chars(text: &str, limit: usize) -> String {
    text.chars().take(limit).collect()
}

fn file_sha256(path: &Path) -> Option<String> {
    oleafly_research::isolation::hash_file(path)
        .ok()
        .map(|(hash, _)| hash)
}

fn percent_decode(text: &str) -> String {
    let bytes = text.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' && index + 2 < bytes.len() {
            let hex = |byte: u8| (byte as char).to_digit(16);
            if let (Some(high), Some(low)) = (hex(bytes[index + 1]), hex(bytes[index + 2])) {
                out.push((high * 16 + low) as u8);
                index += 3;
                continue;
            }
        }
        out.push(bytes[index]);
        index += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn relative_destination(destination: &str) -> bool {
    !destination.is_empty()
        && !destination.starts_with('#')
        && !destination.starts_with('/')
        && !destination.starts_with('\\')
        && !has_scheme(destination)
}

fn normalize_path(path: &str) -> Option<String> {
    let mut parts: Vec<&str> = Vec::new();
    for part in path.split('/') {
        match part {
            "" | "." => {}
            ".." => {
                parts.pop()?;
            }
            part => parts.push(part),
        }
    }
    (!parts.is_empty()).then(|| parts.join("/"))
}

fn escape_label(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for c in text.chars() {
        if matches!(c, '[' | ']' | '\\') {
            out.push('\\');
        }
        out.push(c);
    }
    out
}

fn unescape(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut chars = text.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '\\' {
            if let Some(next) = chars.peek().copied().filter(char::is_ascii_punctuation) {
                out.push(next);
                chars.next();
                continue;
            }
        }
        out.push(c);
    }
    out
}

fn link_labels(text: &str) -> String {
    let chars: Vec<char> = text.chars().collect();
    let mut out = String::with_capacity(text.len());
    let mut index = 0;
    while index < chars.len() {
        let c = chars[index];
        if c == '\\' && index + 1 < chars.len() {
            out.push(c);
            out.push(chars[index + 1]);
            index += 2;
            continue;
        }
        if c == '[' && chars.get(index + 1) == Some(&'[') {
            if let Some(close) = (index + 2..chars.len().saturating_sub(1))
                .find(|&at| chars[at] == ']' && chars[at + 1] == ']')
            {
                let inner: String = chars[index + 2..close].iter().collect();
                let shown = inner
                    .split_once('|')
                    .map_or(inner.as_str(), |(_, alias)| alias);
                out.push_str(shown);
                index = close + 2;
                continue;
            }
        }
        let image = c == '!' && chars.get(index + 1) == Some(&'[');
        let open = if image { index + 1 } else { index };
        if c == '[' || image {
            let close = (open + 1..chars.len()).find(|&at| chars[at] == ']');
            if let Some(close) = close.filter(|close| chars.get(close + 1) == Some(&'(')) {
                if let Some(end) = (close + 2..chars.len()).find(|&at| chars[at] == ')') {
                    out.extend(&chars[open + 1..close]);
                    index = end + 1;
                    continue;
                }
            }
        }
        out.push(c);
        index += 1;
    }
    out
}

fn code_contents(text: &str) -> String {
    let bytes = text.as_bytes();
    let mut out = String::with_capacity(text.len());
    let mut copied = 0;
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] != b'`' {
            index += 1;
            continue;
        }
        let run = bytes[index..]
            .iter()
            .take_while(|byte| **byte == b'`')
            .count();
        let end = code_span_end(bytes, index);
        if end > index + run {
            out.push_str(&text[copied..index]);
            out.push_str(&text[index + run..end - run]);
            copied = end;
        }
        index = end;
    }
    out.push_str(&text[copied..]);
    out
}

fn without_tags(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(open) = rest.find('<') {
        let Some(close) = rest[open + 1..].find('>').filter(|close| *close > 0) else {
            break;
        };
        out.push_str(&rest[..open]);
        rest = &rest[open + close + 2..];
    }
    out.push_str(rest);
    out
}

fn unwrap_pair(text: &str, marker: &str) -> Option<String> {
    let mut from = 0;
    while let Some(found) = text[from..].find(marker) {
        let open = from + found;
        let inner = open + marker.len();
        if text[inner..]
            .chars()
            .next()
            .is_some_and(|c| !c.is_whitespace())
        {
            let mut search = inner + 1;
            while let Some(next) = text.get(search..).and_then(|rest| rest.find(marker)) {
                let close = search + next;
                if text[..close]
                    .chars()
                    .next_back()
                    .is_some_and(|c| !c.is_whitespace())
                {
                    return Some(format!(
                        "{}{}{}",
                        &text[..open],
                        &text[inner..close],
                        &text[close + marker.len()..]
                    ));
                }
                search = close + 1;
            }
        }
        from = open + 1;
        while !text.is_char_boundary(from) {
            from += 1;
        }
    }
    None
}

fn plain_heading(text: &str) -> String {
    let mut plain = without_tags(&code_contents(&link_labels(text)));
    'unwrap: loop {
        for marker in ["**", "__", "~~", "==", "*", "_"] {
            if let Some(next) = unwrap_pair(&plain, marker) {
                plain = next;
                continue 'unwrap;
            }
        }
        break;
    }
    unescape(&plain)
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

pub(crate) fn heading_slug(text: &str) -> String {
    text.trim()
        .to_lowercase()
        .chars()
        .filter_map(|c| {
            if c == ' ' {
                Some('-')
            } else if c.is_alphanumeric()
                || unicode_normalization::char::is_combining_mark(c)
                || c == '_'
                || c == '-'
            {
                Some(c)
            } else {
                None
            }
        })
        .collect()
}

fn encode_component(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for byte in text.bytes() {
        if byte.is_ascii_alphanumeric()
            || matches!(
                byte,
                b'-' | b'_' | b'.' | b'!' | b'~' | b'*' | b'\'' | b'(' | b')'
            )
        {
            out.push(byte as char);
        } else {
            out.push_str(&format!("%{byte:02X}"));
        }
    }
    out
}

fn atx_heading(line: &str) -> Option<(usize, &str)> {
    let trimmed = line.trim_start_matches(' ');
    if line.len() - trimmed.len() > 3 {
        return None;
    }
    let level = trimmed.bytes().take_while(|byte| *byte == b'#').count();
    if level == 0 || level > 6 {
        return None;
    }
    let rest = &trimmed[level..];
    if !(rest.is_empty() || rest.starts_with([' ', '\t'])) {
        return None;
    }
    let rest = rest.trim();
    let without_closing = rest.trim_end_matches('#');
    let text = if without_closing.is_empty() || without_closing.ends_with([' ', '\t']) {
        without_closing.trim_end()
    } else {
        rest
    };
    Some((level, text))
}

fn headings(body: &str) -> Vec<(String, String)> {
    let mut seen: HashMap<String, usize> = HashMap::new();
    let mut found = Vec::new();
    for block in blocks(body) {
        let Block::Line(line) = block else {
            continue;
        };
        let Some((_, text)) = atx_heading(line) else {
            continue;
        };
        let plain = plain_heading(text);
        let original = heading_slug(&plain);
        let count = seen.entry(original.clone()).or_insert(0);
        let slug = if *count == 0 {
            original
        } else {
            format!("{original}-{count}")
        };
        *count += 1;
        found.push((slug, plain));
    }
    found
}

fn first_title_heading(body: &str) -> Option<String> {
    blocks(body).into_iter().find_map(|block| match block {
        Block::Line(line) => atx_heading(line)
            .filter(|(level, _)| *level == 1)
            .map(|(_, text)| plain_heading(text))
            .filter(|text| !text.is_empty()),
        Block::Fence { .. } => None,
    })
}

struct FrontMatter<'a> {
    lines: Option<Vec<&'a str>>,
    body: &'a str,
}

fn split_front_matter(text: &str) -> FrontMatter<'_> {
    match oleafly_core::front_matter::split(text) {
        Some(front) => {
            let (lines, body) = front.into_parts();
            FrontMatter {
                lines: Some(lines),
                body,
            }
        }
        None => FrontMatter {
            lines: None,
            body: text,
        },
    }
}

fn front_value(lines: &[&str], key: &str) -> Option<String> {
    oleafly_core::front_matter::scalar(lines, key)
}

fn plain_safe(value: &str) -> bool {
    if value.is_empty() || value != value.trim() || value.contains('\n') {
        return false;
    }
    if value.starts_with([
        '-', '?', ':', ',', '[', ']', '{', '}', '#', '&', '*', '!', '|', '>', '\'', '"', '%', '@',
        '`',
    ]) {
        return false;
    }
    if value.contains(": ") || value.contains(" #") || value.ends_with(':') {
        return false;
    }
    let lower = value.to_ascii_lowercase();
    if matches!(
        lower.as_str(),
        "true" | "false" | "yes" | "no" | "on" | "off" | "null" | "~"
    ) {
        return false;
    }
    let digits = value.strip_prefix(['+', '-']).unwrap_or(value);
    let numeric = !digits.is_empty()
        && digits.split_once('.').map_or_else(
            || digits.bytes().all(|byte| byte.is_ascii_digit()),
            |(whole, fraction)| {
                !whole.is_empty()
                    && !fraction.is_empty()
                    && whole.bytes().all(|byte| byte.is_ascii_digit())
                    && fraction.bytes().all(|byte| byte.is_ascii_digit())
            },
        );
    !numeric
}

fn yaml_scalar(value: &str) -> String {
    if plain_safe(value) {
        value.to_string()
    } else {
        serde_json::to_string(value).unwrap_or_else(|_| "\"\"".to_string())
    }
}

fn continues(line: &str) -> bool {
    line.starts_with([' ', '\t']) || line == "-" || line.starts_with("- ")
}

fn without_keys(lines: &[&str], keys: &[&str]) -> Vec<String> {
    let mut kept = Vec::with_capacity(lines.len());
    let mut skipping = false;
    for line in lines {
        if skipping && continues(line) {
            continue;
        }
        skipping = key_of(line).is_some_and(|key| keys.contains(&key));
        if !skipping {
            kept.push((*line).to_string());
        }
    }
    kept
}

fn same_tag(item: &str, tag: &str) -> bool {
    let item = item.trim().trim_matches(['"', '\'']).trim();
    let item = item.strip_prefix('#').unwrap_or(item);
    item.to_lowercase() == tag.to_lowercase()
}

fn add_tag(lines: &mut Vec<String>, tag: &str) {
    let Some(at) = lines.iter().position(|line| key_of(line) == Some("tags")) else {
        lines.push("tags:".to_string());
        lines.push(format!("  - {tag}"));
        return;
    };
    let value = value_of(&lines[at]).to_string();
    if value.is_empty() {
        let mut end = at + 1;
        let mut indent = None;
        while end < lines.len() && continues(&lines[end]) {
            let trimmed = lines[end].trim_start();
            if let Some(item) = trimmed.strip_prefix('-') {
                if indent.is_none() {
                    indent = Some(lines[end][..lines[end].len() - trimmed.len()].to_string());
                }
                if same_tag(item, tag) {
                    return;
                }
            }
            end += 1;
        }
        let indent = indent.unwrap_or_else(|| "  ".to_string());
        lines.insert(end, format!("{indent}- {tag}"));
        return;
    }
    if let Some(inner) = value
        .strip_prefix('[')
        .and_then(|rest| rest.strip_suffix(']'))
    {
        let inner = inner.trim();
        if inner.split(',').any(|item| same_tag(item, tag)) {
            return;
        }
        lines[at] = if inner.is_empty() {
            format!("tags: [{tag}]")
        } else {
            format!("tags: [{inner}, {tag}]")
        };
        return;
    }
    let text = scalar_value(&value).unwrap_or_default();
    if text
        .split([',', ' '])
        .filter(|item| !item.trim().is_empty())
        .any(|item| same_tag(item, tag))
    {
        return;
    }
    let joined = if text.contains(',') {
        format!("{text}, {tag}")
    } else if text.is_empty() {
        tag.to_string()
    } else {
        format!("{text} {tag}")
    };
    lines[at] = format!("tags: {}", yaml_scalar(&joined));
}

fn folder_tag(rel: &str) -> Option<String> {
    let (folder, _) = rel.rsplit_once('/')?;
    let parts: Vec<String> = folder
        .split('/')
        .map(|part| {
            let cleaned: String = part
                .chars()
                .map(|c| if c.is_whitespace() { '-' } else { c })
                .filter(|c| c.is_alphanumeric() || matches!(c, '-' | '_'))
                .collect();
            cleaned.trim_matches('-').to_string()
        })
        .filter(|part| !part.is_empty())
        .collect();
    let tag = parts.join("/");
    tag.chars().any(|c| !c.is_ascii_digit()).then_some(tag)
}

fn full_note_title(front: Option<&[&str]>, body: &str, rel: &str) -> String {
    let title = front
        .and_then(|lines| front_value(lines, "title"))
        .or_else(|| first_title_heading(body))
        .unwrap_or_else(|| file_stem(base_name(rel)).trim().to_string());
    let title = title.trim();
    if title.is_empty() {
        UNTITLED.to_string()
    } else {
        title.to_string()
    }
}

fn note_title(front: Option<&[&str]>, body: &str, rel: &str) -> String {
    truncate_chars(&full_note_title(front, body, rel), MAX_TITLE_CHARS)
        .trim()
        .to_string()
}

fn imported_source(
    front: Option<&[&str]>,
    title: &str,
    id: &str,
    tag: Option<&str>,
    body: &str,
) -> String {
    let mut lines = Vec::new();
    let mut titled = false;
    if let Some(front) = front {
        titled = front_value(front, "title").is_some();
        let mut managed = vec!["kind", "id"];
        if !titled {
            managed.push("title");
        }
        lines = without_keys(front, &managed);
        let declared = front_value(front, "kind").as_deref() == Some(NOTE_KIND);
        if let Some(old) = front_value(front, "id").filter(|_| !declared) {
            lines.push(format!("imported-id: {}", yaml_scalar(&old)));
        }
    }
    if !titled {
        lines.push(format!("title: {}", yaml_scalar(title)));
    }
    lines.push(format!("kind: {NOTE_KIND}"));
    lines.push(format!("id: {id}"));
    if let Some(tag) = tag {
        add_tag(&mut lines, tag);
    }
    let mut out = String::from("---\n");
    for line in lines {
        out.push_str(&line);
        out.push('\n');
    }
    out.push_str("---\n");
    if front.is_none() && !body.is_empty() && !body.starts_with('\n') {
        out.push('\n');
    }
    out.push_str(body);
    out
}

enum Block<'a> {
    Line(&'a str),
    Fence {
        open: &'a str,
        info: &'a str,
        lines: Vec<&'a str>,
        close: Option<&'a str>,
    },
}

fn fence_open(line: &str) -> Option<(u8, usize, &str)> {
    let trimmed = line.trim_start_matches(' ');
    if line.len() - trimmed.len() > 3 {
        return None;
    }
    let marker = *trimmed.as_bytes().first()?;
    if marker != b'`' && marker != b'~' {
        return None;
    }
    let run = trimmed.bytes().take_while(|byte| *byte == marker).count();
    if run < 3 {
        return None;
    }
    let info = trimmed[run..].trim();
    if marker == b'`' && info.contains('`') {
        return None;
    }
    Some((marker, run, info))
}

fn fence_closes(line: &str, marker: u8, run: usize) -> bool {
    let trimmed = line.trim_start_matches(' ');
    if line.len() - trimmed.len() > 3 {
        return false;
    }
    let count = trimmed.bytes().take_while(|byte| *byte == marker).count();
    count >= run && trimmed[count..].trim().is_empty()
}

fn blocks(body: &str) -> Vec<Block<'_>> {
    let mut found = Vec::new();
    let mut lines = body.split('\n');
    while let Some(line) = lines.next() {
        let Some((marker, run, info)) = fence_open(line) else {
            found.push(Block::Line(line));
            continue;
        };
        let mut inner = Vec::new();
        let mut close = None;
        for next in lines.by_ref() {
            if fence_closes(next, marker, run) {
                close = Some(next);
                break;
            }
            inner.push(next);
        }
        found.push(Block::Fence {
            open: line,
            info,
            lines: inner,
            close,
        });
    }
    found
}

fn join_blocks(parts: Vec<String>) -> String {
    parts.join("\n")
}

fn fence_lines(open: &str, lines: &[String], close: Option<&str>) -> String {
    let mut parts = vec![open.to_string()];
    parts.extend(lines.iter().cloned());
    if let Some(close) = close {
        parts.push(close.to_string());
    }
    parts.join("\n")
}

fn is_notebook_info(info: &str) -> bool {
    info.split_whitespace().next() == Some(NOTEBOOK_INFO)
}

enum Token<'a> {
    Wiki {
        embed: bool,
        inner: &'a str,
    },
    Link {
        embed: bool,
        label: &'a str,
        destination: String,
    },
}

fn code_span_end(bytes: &[u8], start: usize) -> usize {
    let run = bytes[start..]
        .iter()
        .take_while(|byte| **byte == b'`')
        .count();
    let mut index = start + run;
    while index < bytes.len() {
        if bytes[index] != b'`' {
            index += 1;
            continue;
        }
        let close = bytes[index..]
            .iter()
            .take_while(|byte| **byte == b'`')
            .count();
        if close == run {
            return index + close;
        }
        index += close;
    }
    start + run
}

struct LineMarks {
    brackets: HashMap<usize, usize>,
    wiki_closes: Vec<usize>,
}

impl LineMarks {
    fn of(line: &str) -> Self {
        let bytes = line.as_bytes();
        if !bytes.contains(&b'[') {
            return Self {
                brackets: HashMap::new(),
                wiki_closes: Vec::new(),
            };
        }
        Self {
            brackets: crate::note_links::matching_brackets(bytes, b'[', b']', b'\\'),
            wiki_closes: bytes
                .windows(2)
                .enumerate()
                .filter(|(_, pair)| *pair == b"]]")
                .map(|(at, _)| at)
                .collect(),
        }
    }

    fn wiki_close(&self, from: usize) -> Option<usize> {
        let at = self.wiki_closes.partition_point(|close| *close < from);
        self.wiki_closes.get(at).copied()
    }
}

fn skip_spaces(bytes: &[u8], start: usize) -> usize {
    let mut index = start;
    while matches!(bytes.get(index), Some(b' ' | b'\t')) {
        index += 1;
    }
    index
}

fn destination_at(line: &str, start: usize) -> Option<(String, usize)> {
    let bytes = line.as_bytes();
    if bytes.get(start) == Some(&b'<') {
        let mut index = start + 1;
        while index < bytes.len() && bytes[index] != b'>' && bytes[index] != b'<' {
            index += if bytes[index] == b'\\' { 2 } else { 1 };
        }
        if bytes.get(index) != Some(&b'>') {
            return None;
        }
        return Some((line[start + 1..index].to_string(), index + 1));
    }
    let mut index = start;
    let mut depth = 0usize;
    while index < bytes.len() {
        match bytes[index] {
            b' ' | b'\t' => break,
            b'\\' => {
                index += 2;
                continue;
            }
            b'(' => depth += 1,
            b')' if depth == 0 => break,
            b')' => depth -= 1,
            _ => {}
        }
        index += 1;
    }
    let end = index.min(bytes.len());
    Some((line.get(start..end)?.to_string(), end))
}

fn title_end(bytes: &[u8], start: usize) -> Option<usize> {
    let quote = match bytes.get(start) {
        Some(quote @ (b'"' | b'\'')) => *quote,
        _ => return Some(start),
    };
    let mut index = start + 1;
    while index < bytes.len() && bytes[index] != quote {
        index += if bytes[index] == b'\\' { 2 } else { 1 };
    }
    (index < bytes.len()).then_some(index + 1)
}

fn token_at<'a>(
    line: &'a str,
    open: usize,
    embed: bool,
    marks: &LineMarks,
) -> Option<(Token<'a>, usize)> {
    let bytes = line.as_bytes();
    if bytes.get(open + 1) == Some(&b'[') {
        let inner_start = open + 2;
        if let Some(close) = marks.wiki_close(inner_start) {
            let inner = &line[inner_start..close];
            if !inner.trim().is_empty() && !inner.contains('[') && !inner.contains(']') {
                return Some((Token::Wiki { embed, inner }, close + 2));
            }
        }
    }
    let close = *marks.brackets.get(&open)?;
    if bytes.get(close + 1) != Some(&b'(') {
        return None;
    }
    let (destination, end) = destination_at(line, skip_spaces(bytes, close + 2))?;
    let index = title_end(bytes, skip_spaces(bytes, end))?;
    let index = skip_spaces(bytes, index);
    if bytes.get(index) != Some(&b')') {
        return None;
    }
    Some((
        Token::Link {
            embed,
            label: &line[open + 1..close],
            destination,
        },
        index + 1,
    ))
}

fn rewrite_inline<F>(line: &str, mut on_token: F) -> String
where
    F: FnMut(&Token<'_>) -> Option<String>,
{
    let bytes = line.as_bytes();
    let marks = LineMarks::of(line);
    let mut out = String::with_capacity(line.len());
    let mut copied = 0;
    let mut index = 0;
    while index < bytes.len() {
        let byte = bytes[index];
        if byte == b'\\' {
            index += 2;
            continue;
        }
        if byte == b'`' {
            index = code_span_end(bytes, index);
            continue;
        }
        let embed = byte == b'!' && bytes.get(index + 1) == Some(&b'[');
        if byte != b'[' && !embed {
            index += 1;
            continue;
        }
        let open = if embed { index + 1 } else { index };
        if let Some((token, end)) = token_at(line, open, embed, &marks) {
            if let Some(replacement) = on_token(&token) {
                out.push_str(&line[copied..index]);
                out.push_str(&replacement);
                copied = end;
            }
            index = end;
            continue;
        }
        index += 1;
    }
    out.push_str(&line[copied..]);
    out
}

fn split_wiki(inner: &str) -> (&str, Option<&str>) {
    match inner.find('|') {
        Some(at) => {
            let target = &inner[..at];
            (
                target.strip_suffix('\\').unwrap_or(target),
                Some(inner[at + 1..].trim()),
            )
        }
        None => (inner, None),
    }
}

fn split_fragment(target: &str) -> (&str, Option<&str>) {
    match target.split_once('#') {
        Some((name, fragment)) => (name.trim(), Some(fragment.trim())),
        None => (target.trim(), None),
    }
}

fn heading_fragment(fragment: Option<&str>) -> Option<String> {
    let fragment = fragment?;
    if fragment.starts_with('^') {
        return None;
    }
    let heading = fragment.rsplit('#').next().unwrap_or(fragment).trim();
    (!heading.is_empty()).then(|| heading.to_string())
}

fn size_alias(alias: &str) -> bool {
    let (width, height) = alias.split_once('x').unwrap_or((alias, "0"));
    !width.is_empty()
        && width.bytes().all(|byte| byte.is_ascii_digit())
        && height.bytes().all(|byte| byte.is_ascii_digit())
}

fn display_name(name: &str) -> String {
    let cut = name.len().saturating_sub(3);
    match (name.get(..cut), name.get(cut..)) {
        (Some(stem), Some(extension)) if extension.eq_ignore_ascii_case(".md") => stem.to_string(),
        _ => name.to_string(),
    }
}

struct Lookup {
    keys: Vec<String>,
    exact: HashMap<String, usize>,
    names: HashMap<String, Vec<usize>>,
}

impl Lookup {
    fn new(keys: Vec<String>) -> Self {
        let mut exact = HashMap::new();
        let mut names: HashMap<String, Vec<usize>> = HashMap::new();
        for (index, key) in keys.iter().enumerate() {
            names
                .entry(base_name(key).to_string())
                .or_default()
                .push(index);
            exact.entry(key.clone()).or_insert(index);
        }
        Self { keys, exact, names }
    }

    fn find(&self, key: &str, source_dir: &str) -> Option<usize> {
        if !source_dir.is_empty() {
            if let Some(found) = normalize_path(&format!("{source_dir}/{key}"))
                .and_then(|path| self.exact.get(&path))
            {
                return Some(*found);
            }
        }
        let path = normalize_path(key)?;
        if let Some(found) = self.exact.get(&path) {
            return Some(*found);
        }
        let suffix = format!("/{path}");
        let mut candidates = self
            .names
            .get(base_name(&path))?
            .iter()
            .copied()
            .filter(|&index| self.keys[index] == path || self.keys[index].ends_with(&suffix));
        let first = candidates.next()?;
        candidates.next().is_none().then_some(first)
    }

    fn find_beside(&self, key: &str, source_dir: &str) -> Option<usize> {
        if source_dir.is_empty() {
            return self.exact.get(&normalize_path(key)?).copied();
        }
        let path = normalize_path(&format!("{source_dir}/{key}"))?;
        path.starts_with(&format!("{source_dir}/"))
            .then(|| self.exact.get(&path).copied())
            .flatten()
    }
}

enum Target {
    Note(usize),
    File(usize),
}

struct Lookups {
    notes: Lookup,
    files: Lookup,
    beside_only: bool,
}

impl Lookups {
    fn new(vault: &Vault) -> Self {
        let note_keys = vault
            .notes
            .iter()
            .map(|file| {
                let key = fold(&file.rel);
                key.strip_suffix(".md").unwrap_or(&key).to_string()
            })
            .collect();
        let file_keys = vault.files.iter().map(|file| fold(&file.rel)).collect();
        Self {
            notes: Lookup::new(note_keys),
            files: Lookup::new(file_keys),
            beside_only: vault.beside_only,
        }
    }

    fn resolve(&self, raw: &str, source_dir: &str) -> Option<Target> {
        let cleaned = fold(&raw.trim().replace('\\', "/"));
        if cleaned.is_empty() {
            return None;
        }
        let note_key = cleaned.strip_suffix(".md").unwrap_or(&cleaned);
        if let Some(index) = self.notes.find(note_key, source_dir) {
            return Some(Target::Note(index));
        }
        if self.beside_only {
            return self
                .files
                .find_beside(&cleaned, source_dir)
                .map(Target::File);
        }
        self.files.find(&cleaned, source_dir).map(Target::File)
    }
}

struct ImportShared {
    hashes: RefCell<HashMap<usize, Option<String>>>,
    planned: Cell<u64>,
    budget: u64,
}

impl Default for ImportShared {
    fn default() -> Self {
        Self::with_budget(MAX_IMPORT_ATTACHMENT_BYTES)
    }
}

impl ImportShared {
    fn with_budget(budget: u64) -> Self {
        Self {
            hashes: RefCell::new(HashMap::new()),
            planned: Cell::new(0),
            budget,
        }
    }

    fn hash(&self, index: usize, file: &VaultFile) -> Option<String> {
        if let Some(known) = self.hashes.borrow().get(&index) {
            return known.clone();
        }
        let sha = file_sha256(&file.path);
        self.hashes.borrow_mut().insert(index, sha.clone());
        sha
    }

    fn reserve(&self, bytes: u64) -> bool {
        let total = self.planned.get().saturating_add(bytes);
        if total > self.budget {
            return false;
        }
        self.planned.set(total);
        true
    }
}

#[derive(Default)]
struct AssetPlanner {
    planned: HashMap<usize, Option<String>>,
    taken: HashMap<String, (String, String)>,
    copies: Vec<(usize, String)>,
    skipped: usize,
}

impl AssetPlanner {
    fn path_for(
        &mut self,
        shared: &ImportShared,
        files: &[VaultFile],
        index: usize,
    ) -> Option<String> {
        if let Some(known) = self.planned.get(&index) {
            return known.clone();
        }
        let planned = self.plan(shared, files, index);
        let path = planned.as_ref().map(|(path, _)| path.clone());
        match &planned {
            Some((path, true)) => self.copies.push((index, path.clone())),
            Some(_) => {}
            None => self.skipped += 1,
        }
        self.planned.insert(index, path.clone());
        path
    }

    fn plan(
        &mut self,
        shared: &ImportShared,
        files: &[VaultFile],
        index: usize,
    ) -> Option<(String, bool)> {
        let file = &files[index];
        if file.size > MAX_ATTACHMENT_BYTES {
            return None;
        }
        let sha = shared.hash(index, file)?;
        let name = base_name(&file.rel);
        for attempt in 1..=99 {
            let path = crate::project::note_asset_path(name, &sha, attempt);
            match self.taken.get(&fold(&path)) {
                None => {
                    if !shared.reserve(file.size) {
                        return None;
                    }
                    self.taken.insert(fold(&path), (path.clone(), sha.clone()));
                    return Some((path, true));
                }
                Some((existing, hash)) if *hash == sha => {
                    return Some((existing.clone(), false));
                }
                Some(_) => {}
            }
        }
        None
    }
}

struct ImportContext<'a> {
    vault: &'a Vault,
    lookups: &'a Lookups,
    ids: &'a [Option<String>],
    shared: &'a ImportShared,
}

struct NoteConversion<'a> {
    context: &'a ImportContext<'a>,
    self_id: &'a str,
    source_dir: String,
    assets: AssetPlanner,
    unresolved: usize,
    not_copied: Vec<String>,
}

enum LinkResult {
    Keep,
    Replace(String),
    Unresolved,
}

impl<'a> NoteConversion<'a> {
    fn new(context: &'a ImportContext<'a>, self_id: &'a str, rel: &str) -> Self {
        let source_dir = rel
            .rsplit_once('/')
            .map_or(String::new(), |(dir, _)| fold(dir));
        Self {
            context,
            self_id,
            source_dir,
            assets: AssetPlanner::default(),
            unresolved: 0,
            not_copied: Vec::new(),
        }
    }

    fn missed_file(&mut self, target: &str) {
        let target = target.trim();
        if !self.context.lookups.beside_only
            || is_markdown(base_name(target))
            || extension_of(base_name(target)).is_none()
        {
            return;
        }
        if !self.not_copied.iter().any(|known| known == target) {
            self.not_copied.push(target.to_string());
        }
    }

    fn body(&mut self, body: &str) -> String {
        let mut parts = Vec::new();
        for block in blocks(body) {
            match block {
                Block::Line(line) => parts.push(self.line(line)),
                Block::Fence {
                    open,
                    info,
                    lines,
                    close,
                } => {
                    let rewritten = if is_notebook_info(info) {
                        self.notebook_fence(&lines)
                    } else {
                        lines.iter().map(|line| (*line).to_string()).collect()
                    };
                    parts.push(fence_lines(open, &rewritten, close));
                }
            }
        }
        join_blocks(parts)
    }

    fn notebook_fence(&mut self, lines: &[&str]) -> Vec<String> {
        let mut out: Vec<String> = lines.iter().map(|line| (*line).to_string()).collect();
        let Some(at) = lines.iter().position(|line| !line.trim().is_empty()) else {
            return out;
        };
        let raw = lines[at].trim();
        if !relative_destination(raw) {
            return out;
        }
        let indent = &lines[at][..lines[at].len() - lines[at].trim_start().len()];
        let decoded = percent_decode(raw);
        match self.file_path(&decoded) {
            Some(path) => out[at] = format!("{indent}{path}"),
            None => {
                self.unresolved += 1;
                self.missed_file(&decoded);
            }
        }
        out
    }

    fn file_path(&mut self, raw: &str) -> Option<String> {
        match self.context.lookups.resolve(raw, &self.source_dir)? {
            Target::File(index) => {
                self.assets
                    .path_for(self.context.shared, &self.context.vault.files, index)
            }
            Target::Note(_) => None,
        }
    }

    fn notebook_line(&mut self, line: &str) -> Option<String> {
        let trimmed = line.trim();
        let indent = &line[..line.len() - line.trim_start().len()];
        let target = if let Some(inner) = trimmed
            .strip_prefix("![[")
            .and_then(|rest| rest.strip_suffix("]]"))
        {
            let (target, _) = split_wiki(inner);
            split_fragment(target).0.to_string()
        } else {
            if !trimmed.starts_with("![") {
                return None;
            }
            let (
                Token::Link {
                    embed: true,
                    destination,
                    ..
                },
                end,
            ) = token_at(trimmed, 1, true, &LineMarks::of(trimmed))?
            else {
                return None;
            };
            if end != trimmed.len() || !relative_destination(&destination) {
                return None;
            }
            percent_decode(&destination)
        };
        if !is_notebook(&target) {
            return None;
        }
        let Some(Target::File(index)) = self.context.lookups.resolve(&target, &self.source_dir)
        else {
            return None;
        };
        let path = self
            .assets
            .path_for(self.context.shared, &self.context.vault.files, index)?;
        Some(format!(
            "{indent}```{NOTEBOOK_INFO}\n{indent}{path}\n{indent}```"
        ))
    }

    fn line(&mut self, line: &str) -> String {
        if let Some(fence) = self.notebook_line(line) {
            return fence;
        }
        let mut unresolved = 0;
        let rewritten = rewrite_inline(line, |token| {
            let result = match token {
                Token::Wiki { embed, inner } => self.wiki(*embed, inner),
                Token::Link {
                    embed,
                    label,
                    destination,
                } => self.markdown_link(*embed, label, destination),
            };
            match result {
                LinkResult::Keep => None,
                LinkResult::Replace(text) => Some(text),
                LinkResult::Unresolved => {
                    unresolved += 1;
                    None
                }
            }
        });
        self.unresolved += unresolved;
        rewritten
    }

    fn note_link(embed: bool, text: &str, id: &str, heading: Option<&str>) -> String {
        let fragment = heading
            .map(|heading| heading_slug(&plain_heading(heading)))
            .filter(|slug| !slug.is_empty())
            .map(|slug| format!("#{}", encode_component(&slug)))
            .unwrap_or_default();
        format!(
            "{}[{}]({NOTE_SCHEME}{id}{fragment})",
            if embed { "!" } else { "" },
            escape_label(text)
        )
    }

    fn note_id(&self, index: usize) -> Option<&str> {
        self.context.ids.get(index)?.as_deref()
    }

    fn wiki(&mut self, embed: bool, inner: &str) -> LinkResult {
        let (target, alias) = split_wiki(inner);
        let alias = alias.filter(|alias| !alias.is_empty());
        let (name, fragment) = split_fragment(target);
        let heading = heading_fragment(fragment);
        if name.is_empty() {
            let Some(heading) = heading else {
                return LinkResult::Unresolved;
            };
            let text = alias.unwrap_or(&heading).to_string();
            return LinkResult::Replace(Self::note_link(
                embed,
                &text,
                self.self_id,
                Some(&heading),
            ));
        }
        match self.context.lookups.resolve(name, &self.source_dir) {
            Some(Target::Note(index)) => {
                let Some(id) = self.note_id(index).map(str::to_string) else {
                    return LinkResult::Unresolved;
                };
                let shown = display_name(name);
                let text = match (alias, &heading) {
                    (Some(alias), _) => alias.to_string(),
                    (None, Some(heading)) => format!("{shown} > {heading}"),
                    (None, None) => shown,
                };
                LinkResult::Replace(Self::note_link(embed, &text, &id, heading.as_deref()))
            }
            Some(Target::File(index)) => {
                let Some(path) =
                    self.assets
                        .path_for(self.context.shared, &self.context.vault.files, index)
                else {
                    self.missed_file(name);
                    return LinkResult::Unresolved;
                };
                let written = base_name(name).to_string();
                let text = alias
                    .filter(|alias| !size_alias(alias))
                    .map_or(written, str::to_string);
                let image = embed && is_image(name);
                LinkResult::Replace(format!(
                    "{}[{}]({path})",
                    if image { "!" } else { "" },
                    escape_label(&text)
                ))
            }
            None => {
                self.missed_file(name);
                LinkResult::Unresolved
            }
        }
    }

    fn markdown_link(&mut self, embed: bool, label: &str, destination: &str) -> LinkResult {
        if !relative_destination(destination) {
            return LinkResult::Keep;
        }
        let decoded = percent_decode(destination);
        let (path, fragment) = split_fragment(&decoded);
        if path.is_empty() {
            return LinkResult::Keep;
        }
        match self.context.lookups.resolve(path, &self.source_dir) {
            Some(Target::Note(index)) => {
                let Some(id) = self.note_id(index).map(str::to_string) else {
                    return LinkResult::Unresolved;
                };
                let fragment = heading_fragment(fragment)
                    .map(|heading| heading_slug(&plain_heading(&heading)))
                    .filter(|slug| !slug.is_empty())
                    .map(|slug| format!("#{}", encode_component(&slug)))
                    .unwrap_or_default();
                LinkResult::Replace(format!(
                    "{}[{label}]({NOTE_SCHEME}{id}{fragment})",
                    if embed { "!" } else { "" }
                ))
            }
            Some(Target::File(index)) => {
                let Some(asset) =
                    self.assets
                        .path_for(self.context.shared, &self.context.vault.files, index)
                else {
                    self.missed_file(path);
                    return LinkResult::Unresolved;
                };
                let image = embed && is_image(path);
                let label = if label.trim().is_empty() && !image {
                    escape_label(base_name(path))
                } else {
                    label.to_string()
                };
                LinkResult::Replace(format!(
                    "{}[{label}]({asset})",
                    if image { "!" } else { "" }
                ))
            }
            None => {
                self.missed_file(path);
                LinkResult::Unresolved
            }
        }
    }
}

fn reparse_allows_import(class: std::io::Result<crate::paths::ReparseClass>) -> bool {
    matches!(
        class,
        Ok(crate::paths::ReparseClass::None | crate::paths::ReparseClass::Cloud)
    )
}

fn imports_entry(path: &Path, metadata: &std::fs::Metadata) -> bool {
    if metadata.file_type().is_symlink() {
        return false;
    }
    !crate::paths::is_reparse_point(metadata)
        || reparse_allows_import(crate::paths::reparse_class(path))
}

fn scan_vault(root: &Path, cancel: &AtomicBool) -> Result<Option<Vault>, String> {
    let mut vault = Vault::default();
    let mut stack = vec![(root.to_path_buf(), String::new(), 0usize)];
    let mut entries = 0usize;
    'scan: while let Some((dir, prefix, depth)) = stack.pop() {
        if cancel.load(Ordering::SeqCst) {
            return Ok(None);
        }
        let read = match std::fs::read_dir(&dir) {
            Ok(read) => read,
            Err(error) if prefix.is_empty() => {
                return Err(AppError::new("notes.import_folder_unreadable")
                    .detail(error)
                    .into());
            }
            Err(_) => {
                vault.skipped += 1;
                continue;
            }
        };
        for entry in read.flatten() {
            entries += 1;
            if entries > MAX_ENTRIES {
                vault.skipped += 1;
                break 'scan;
            }
            let name = entry.file_name().to_string_lossy().into_owned();
            if name.starts_with('.') {
                continue;
            }
            let Ok(metadata) = std::fs::symlink_metadata(entry.path()) else {
                continue;
            };
            if !imports_entry(&entry.path(), &metadata) {
                continue;
            }
            let rel = if prefix.is_empty() {
                name.clone()
            } else {
                format!("{prefix}/{name}")
            };
            if metadata.is_dir() {
                if depth < MAX_DEPTH {
                    stack.push((entry.path(), rel, depth + 1));
                }
                continue;
            }
            if !metadata.is_file() {
                continue;
            }
            let file = VaultFile {
                rel,
                path: entry.path(),
                size: metadata.len(),
            };
            if !is_markdown(&name) {
                vault.files.push(file);
            } else if file.size > MAX_NOTE_BYTES {
                vault.skipped += 1;
            } else {
                vault.notes.push(file);
            }
        }
    }
    vault.notes.sort_by(|left, right| left.rel.cmp(&right.rel));
    vault.files.sort_by(|left, right| left.rel.cmp(&right.rel));
    Ok(Some(vault))
}

fn common_folder(paths: &[PathBuf]) -> Option<PathBuf> {
    let mut parents = paths.iter().filter_map(|path| path.parent());
    let first = parents.next()?.to_path_buf();
    Some(parents.fold(first, |common, parent| {
        let mut shared = PathBuf::new();
        for (left, right) in common.components().zip(parent.components()) {
            if left != right {
                break;
            }
            shared.push(left.as_os_str());
        }
        shared
    }))
}

fn relative_name(root: &Path, path: &Path) -> String {
    path.strip_prefix(root)
        .unwrap_or(path)
        .components()
        .map(|part| part.as_os_str().to_string_lossy().into_owned())
        .collect::<Vec<_>>()
        .join("/")
}

fn collect_attachments(
    vault: &mut Vault,
    root: &Path,
    dir: &Path,
    depth: usize,
    entries: &mut usize,
    cancel: &AtomicBool,
) -> bool {
    if cancel.load(Ordering::SeqCst) {
        return false;
    }
    let Ok(read) = std::fs::read_dir(dir) else {
        vault.skipped += 1;
        return true;
    };
    for entry in read.flatten() {
        if *entries >= MAX_ENTRIES {
            vault.skipped += 1;
            return true;
        }
        *entries += 1;
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.starts_with('.') {
            continue;
        }
        let Ok(metadata) = std::fs::symlink_metadata(entry.path()) else {
            continue;
        };
        if !imports_entry(&entry.path(), &metadata) {
            continue;
        }
        if metadata.is_dir() {
            if depth < FILE_IMPORT_DEPTH
                && !collect_attachments(vault, root, &entry.path(), depth + 1, entries, cancel)
            {
                return false;
            }
        } else if metadata.is_file() && (is_image(&name) || is_notebook(&name)) {
            vault.files.push(VaultFile {
                rel: relative_name(root, &entry.path()),
                path: entry.path(),
                size: metadata.len(),
            });
        }
    }
    true
}

fn scan_files(picked: &[PathBuf], cancel: &AtomicBool) -> Result<Option<Vault>, String> {
    let mut vault = Vault {
        beside_only: true,
        ..Vault::default()
    };
    let mut notes: Vec<(PathBuf, u64)> = Vec::new();
    for path in picked {
        let Ok(canonical) = path.canonicalize() else {
            vault.skipped += 1;
            continue;
        };
        refuse_data_folder(&canonical)
            .map_err(|_| String::from(AppError::new("notes.import_files_in_library")))?;
        let name = canonical
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_default();
        let Ok(metadata) = std::fs::metadata(&canonical) else {
            vault.skipped += 1;
            continue;
        };
        if !metadata.is_file() || !is_markdown(&name) || metadata.len() > MAX_NOTE_BYTES {
            vault.skipped += 1;
            continue;
        }
        if !notes.iter().any(|(seen, _)| seen == &canonical) {
            notes.push((canonical, metadata.len()));
        }
    }
    let paths: Vec<PathBuf> = notes.iter().map(|(path, _)| path.clone()).collect();
    let Some(root) = common_folder(&paths) else {
        return Ok(Some(vault));
    };
    let mut folders: Vec<PathBuf> = Vec::new();
    for (path, size) in notes {
        if let Some(parent) = path.parent() {
            if !folders.iter().any(|folder| folder == parent) {
                folders.push(parent.to_path_buf());
            }
        }
        vault.notes.push(VaultFile {
            rel: relative_name(&root, &path),
            path,
            size,
        });
    }
    let mut entries = 0usize;
    for folder in &folders {
        if !collect_attachments(&mut vault, &root, folder, 0, &mut entries, cancel) {
            return Ok(None);
        }
    }
    vault.notes.sort_by(|left, right| left.rel.cmp(&right.rel));
    vault.files.sort_by(|left, right| left.rel.cmp(&right.rel));
    vault.files.dedup_by(|left, right| left.rel == right.rel);
    Ok(Some(vault))
}

fn read_markdown(file: &VaultFile) -> Option<String> {
    let mut bytes = Vec::new();
    std::fs::File::open(&file.path)
        .and_then(|handle| handle.take(MAX_NOTE_BYTES + 1).read_to_end(&mut bytes))
        .ok()?;
    if bytes.len() as u64 > MAX_NOTE_BYTES {
        return None;
    }
    String::from_utf8(bytes)
        .ok()
        .map(|text| normalize_text(&text))
}

struct ReadNote {
    file: usize,
    id: String,
    title: String,
    full_title: String,
    text: String,
}

fn cancelled_report(created: Vec<String>, skipped: usize) -> ImportReport {
    ImportReport {
        summary: ImportSummary {
            skipped,
            cancelled: true,
            ..ImportSummary::default()
        },
        created,
        error: None,
    }
}

#[derive(Debug, Clone, Default)]
pub(crate) struct CreatedNotes(Arc<Mutex<Vec<String>>>);

impl CreatedNotes {
    fn push(&self, project_id: &str) {
        self.0
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .push(project_id.to_string());
    }

    fn take(&self) -> Vec<String> {
        std::mem::take(&mut *self.0.lock().unwrap_or_else(PoisonError::into_inner))
    }
}

struct PlannedNote {
    file: usize,
    source: String,
    unresolved: usize,
    skipped: usize,
    copies: Vec<(usize, String)>,
    not_copied: Vec<String>,
}

fn size_text(bytes: u64) -> String {
    format!("{:.1}", bytes as f64 / 1_000_000_000.0)
}

fn room_for(needed: u64, available: u64) -> Result<(), String> {
    if available.saturating_sub(needed) >= KEEP_FREE_BYTES {
        return Ok(());
    }
    Err(AppError::new("notes.import_no_space")
        .param("size", size_text(needed))
        .into())
}

fn disk_room(needed: u64) -> Result<(), String> {
    let target = crate::paths::projects_root()?;
    match fs4::available_space(&target) {
        Ok(available) => room_for(needed, available),
        Err(_) => Ok(()),
    }
}

fn import_vault_with(
    root: &Path,
    options: ImportOptions,
    cancel: &AtomicBool,
    progress: &mut dyn FnMut(ImportProgress),
    room: &dyn Fn(u64) -> Result<(), String>,
    journal: &CreatedNotes,
) -> Result<ImportReport, String> {
    let Some(vault) = scan_vault(root, cancel)? else {
        return Ok(cancelled_report(Vec::new(), 0));
    };
    import_scanned(vault, options, cancel, progress, room, journal)
}

fn import_files_with(
    files: &[PathBuf],
    options: ImportOptions,
    cancel: &AtomicBool,
    progress: &mut dyn FnMut(ImportProgress),
    room: &dyn Fn(u64) -> Result<(), String>,
    journal: &CreatedNotes,
) -> Result<ImportReport, String> {
    let Some(vault) = scan_files(files, cancel)? else {
        return Ok(cancelled_report(Vec::new(), 0));
    };
    import_scanned(vault, options, cancel, progress, room, journal)
}

fn note_not_copied(summary: &mut ImportSummary, target: String) {
    if summary.not_copied.len() < MAX_NOT_COPIED && !summary.not_copied.contains(&target) {
        summary.not_copied.push(target);
    }
}

fn import_scanned(
    vault: Vault,
    options: ImportOptions,
    cancel: &AtomicBool,
    progress: &mut dyn FnMut(ImportProgress),
    room: &dyn Fn(u64) -> Result<(), String>,
    journal: &CreatedNotes,
) -> Result<ImportReport, String> {
    let total = vault.notes.len();
    let mut skipped = vault.skipped;
    let mut read = Vec::with_capacity(total);
    let mut ids: Vec<Option<String>> = vec![None; total];
    for (index, file) in vault.notes.iter().enumerate() {
        if cancel.load(Ordering::SeqCst) {
            return Ok(cancelled_report(Vec::new(), skipped));
        }
        match read_markdown(file) {
            Some(text) => {
                let split = split_front_matter(&text);
                let full_title = full_note_title(split.lines.as_deref(), split.body, &file.rel);
                let title = note_title(split.lines.as_deref(), split.body, &file.rel);
                let id = new_note_id();
                ids[index] = Some(id.clone());
                read.push(ReadNote {
                    file: index,
                    id,
                    title,
                    full_title,
                    text,
                });
            }
            None => skipped += 1,
        }
        progress(ImportProgress {
            phase: ImportPhase::Read,
            done: index + 1,
            total,
            file: file.rel.clone(),
        });
    }
    let lookups = Lookups::new(&vault);
    let shared = ImportShared::default();
    let context = ImportContext {
        vault: &vault,
        lookups: &lookups,
        ids: &ids,
        shared: &shared,
    };
    let mut plans = Vec::with_capacity(read.len());
    for note in &read {
        if cancel.load(Ordering::SeqCst) {
            return Ok(cancelled_report(Vec::new(), skipped));
        }
        let file = &vault.notes[note.file];
        let split = split_front_matter(&note.text);
        let mut conversion = NoteConversion::new(&context, &note.id, &file.rel);
        let body = conversion.body(split.body);
        let tag = options.folder_tags.then(|| folder_tag(&file.rel)).flatten();
        plans.push(PlannedNote {
            file: note.file,
            source: imported_source(
                split.lines.as_deref(),
                &note.full_title,
                &note.id,
                tag.as_deref(),
                &body,
            ),
            unresolved: conversion.unresolved,
            skipped: conversion.assets.skipped,
            copies: std::mem::take(&mut conversion.assets.copies),
            not_copied: std::mem::take(&mut conversion.not_copied),
        });
    }
    let needed = plans
        .iter()
        .map(|plan| {
            let attachments: u64 = plan
                .copies
                .iter()
                .map(|(index, _)| vault.files[*index].size)
                .sum();
            plan.source.len() as u64 + attachments
        })
        .sum();
    room(needed)?;
    let mut report = ImportReport::default();
    let count = plans.len();
    for (done, (note, plan)) in read.iter().zip(plans).enumerate() {
        if cancel.load(Ordering::SeqCst) {
            return Ok(cancelled_report(report.created, skipped));
        }
        let file = &vault.notes[plan.file];
        let source = plan.source;
        let project_id = match crate::project::create_note_project_without_git(
            note.title.clone(),
            source.clone(),
            None,
        ) {
            Ok(project_id) => project_id,
            Err(error) => {
                report.error = Some(error);
                return Ok(report);
            }
        };
        journal.push(&project_id);
        report.created.push(project_id.clone());
        report.summary.notes += 1;
        report.summary.unresolved += plan.unresolved;
        skipped += plan.skipped;
        for target in plan.not_copied {
            note_not_copied(&mut report.summary, target);
        }
        let mut moved = Vec::new();
        for (index, planned) in &plan.copies {
            let attachment = &vault.files[*index];
            match crate::project::import_file_into_note(&project_id, &attachment.path) {
                Ok(copy) => {
                    if !copy.reused {
                        report.summary.attachments += 1;
                    }
                    if copy.path != *planned {
                        moved.push((planned.clone(), copy.path));
                    }
                }
                Err(_) => {
                    skipped += 1;
                    if vault.beside_only {
                        note_not_copied(&mut report.summary, attachment.rel.clone());
                    }
                }
            }
        }
        if !moved.is_empty() {
            let mut fixed = source.clone();
            for (planned, actual) in &moved {
                fixed = fixed.replace(planned.as_str(), actual);
            }
            let written = crate::sandbox::resolve_readable(&project_id, crate::project::NOTE_FILE)
                .and_then(|target| crate::sandbox::atomic_write(&target, fixed.as_bytes()));
            if let Err(error) = written {
                report.error = Some(error);
                return Ok(report);
            }
        }
        progress(ImportProgress {
            phase: ImportPhase::Write,
            done: done + 1,
            total: count,
            file: file.rel.clone(),
        });
    }
    report.summary.skipped = skipped;
    Ok(report)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct HistoryEntry {
    key: String,
    imported_at: i64,
    notes: usize,
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct History {
    #[serde(default)]
    folders: Vec<HistoryEntry>,
}

fn history_lock() -> &'static Mutex<()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(Default::default)
}

fn history_path() -> Result<PathBuf, String> {
    Ok(crate::paths::oleafly_root()?.join(HISTORY_FILE))
}

fn folder_key(root: &Path) -> String {
    crate::collab::disk::sha256_hex(root.to_string_lossy().as_bytes())
}

fn read_history() -> History {
    history_path()
        .ok()
        .and_then(|path| std::fs::read(path).ok())
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default()
}

pub(crate) fn previous_import(root: &Path) -> Option<HistoryEntry> {
    let _guard = history_lock()
        .lock()
        .unwrap_or_else(PoisonError::into_inner);
    let key = folder_key(root);
    read_history()
        .folders
        .into_iter()
        .find(|entry| entry.key == key)
}

pub(crate) fn record_import(root: &Path, notes: usize) -> Result<(), String> {
    let _guard = history_lock()
        .lock()
        .unwrap_or_else(PoisonError::into_inner);
    let key = folder_key(root);
    let mut history = read_history();
    history.folders.retain(|entry| entry.key != key);
    history.folders.push(HistoryEntry {
        key,
        imported_at: crate::collab::commands::now_ms(),
        notes,
    });
    let excess = history.folders.len().saturating_sub(HISTORY_LIMIT);
    history.folders.drain(..excess);
    let path = history_path()?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let json = serde_json::to_vec_pretty(&history).map_err(|error| error.to_string())?;
    crate::sandbox::atomic_write(&path, &json)
}

fn safe_part(text: &str, limit: usize) -> String {
    use unicode_normalization::UnicodeNormalization;
    let cleaned: String = text
        .nfc()
        .filter(|c| !oleafly_core::portable::is_ignorable_code_point(*c))
        .map(|c| {
            if c.is_control()
                || matches!(
                    c,
                    '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' | '#' | '^' | '[' | ']'
                )
            {
                ' '
            } else {
                c
            }
        })
        .collect();
    let collapsed = cleaned.split_whitespace().collect::<Vec<_>>().join(" ");
    let trimmed = truncate_chars(collapsed.trim_start_matches('.'), limit);
    trimmed.trim().trim_end_matches('.').trim().to_string()
}

pub(crate) fn safe_stem(title: &str) -> String {
    let stem = safe_part(title, MAX_STEM_CHARS);
    if stem.is_empty() {
        return UNTITLED.to_string();
    }
    let (first, rest) = stem
        .split_once('.')
        .map_or((stem.as_str(), None), |(first, rest)| (first, Some(rest)));
    let first = first.trim_end();
    if !oleafly_core::portable::is_windows_reserved_component(first) {
        return stem;
    }
    match rest {
        Some(rest) => format!("{first} note.{rest}"),
        None => format!("{first} note"),
    }
}

fn safe_file_name(name: &str) -> String {
    let base = base_name(&name.replace('\\', "/")).to_string();
    let (stem, extension) = match base.rsplit_once('.') {
        Some((stem, extension)) if !stem.is_empty() => (stem.to_string(), extension.to_string()),
        _ => (base.clone(), String::new()),
    };
    let extension: String = extension
        .chars()
        .filter(char::is_ascii_alphanumeric)
        .take(12)
        .collect::<String>()
        .to_ascii_lowercase();
    let stem = safe_stem(&stem);
    if extension.is_empty() {
        stem
    } else {
        format!("{stem}.{extension}")
    }
}

fn numbered(name: &str, attempt: usize) -> String {
    if attempt <= 1 {
        return name.to_string();
    }
    match name.rsplit_once('.') {
        Some((stem, extension)) if !stem.is_empty() => format!("{stem} {attempt}.{extension}"),
        _ => format!("{name} {attempt}"),
    }
}

#[derive(Debug, Clone)]
pub(crate) struct ExportAsset {
    pub rel: String,
    pub path: PathBuf,
    pub original: Option<String>,
}

#[derive(Debug, Clone)]
pub(crate) struct ExportNote {
    pub note_id: Option<String>,
    pub title: String,
    pub text: String,
    pub assets: Vec<ExportAsset>,
}

#[derive(Debug, Clone)]
pub(crate) struct OutsideNote {
    pub title: String,
    pub text: String,
}

struct LinkTarget {
    stem: String,
    title: String,
    headings: Vec<(String, String)>,
}

struct ExportConversion<'a> {
    targets: &'a HashMap<String, LinkTarget>,
    assets: &'a HashMap<String, String>,
}

fn wiki_safe(text: &str) -> String {
    text.replace("[[", "[")
        .replace("]]", "]")
        .replace('|', "-")
        .replace('\n', " ")
}

fn note_destination(destination: &str) -> Option<(&str, Option<&str>)> {
    let trimmed = destination.trim();
    let head = trimmed.get(..NOTE_SCHEME.len())?;
    if !head.eq_ignore_ascii_case(NOTE_SCHEME) {
        return None;
    }
    let rest = &trimmed[NOTE_SCHEME.len()..];
    let (path, fragment) = match rest.split_once('#') {
        Some((path, fragment)) => (path, Some(fragment)),
        None => (rest, None),
    };
    let id = path.strip_suffix('/').unwrap_or(path);
    is_linkable_id(id).then_some((id, fragment.filter(|fragment| !fragment.is_empty())))
}

fn asset_key(destination: &str) -> Option<String> {
    let decoded = percent_decode(destination.trim());
    let clean = decoded.strip_prefix("./").unwrap_or(&decoded);
    let path = normalize_path(clean)?;
    path.starts_with(&format!("{NOTE_ASSETS}/")).then_some(path)
}

impl ExportConversion<'_> {
    fn body(&self, body: &str) -> String {
        let mut parts = Vec::new();
        for block in blocks(body) {
            match block {
                Block::Line(line) => {
                    let table = line.trim_start().starts_with('|');
                    parts.push(rewrite_inline(line, |token| match token {
                        Token::Link {
                            embed,
                            label,
                            destination,
                        } => self.link(*embed, label, destination, table),
                        Token::Wiki { .. } => None,
                    }));
                }
                Block::Fence {
                    open,
                    info,
                    lines,
                    close,
                } => parts.push(self.fence(open, info, &lines, close)),
            }
        }
        join_blocks(parts)
    }

    fn fence(&self, open: &str, info: &str, lines: &[&str], close: Option<&str>) -> String {
        let mut out: Vec<String> = lines.iter().map(|line| (*line).to_string()).collect();
        if !is_notebook_info(info) {
            return fence_lines(open, &out, close);
        }
        let filled: Vec<usize> = (0..lines.len())
            .filter(|&at| !lines[at].trim().is_empty())
            .collect();
        let Some(&first) = filled.first() else {
            return fence_lines(open, &out, close);
        };
        let Some(name) = asset_key(lines[first]).and_then(|key| self.assets.get(&key)) else {
            return fence_lines(open, &out, close);
        };
        let indent = &open[..open.len() - open.trim_start().len()];
        if filled.len() == 1 && close.is_some() {
            return format!("{indent}![[{name}]]");
        }
        let line_indent = &lines[first][..lines[first].len() - lines[first].trim_start().len()];
        out[first] = format!("{line_indent}{ATTACHMENTS}/{name}");
        fence_lines(open, &out, close)
    }

    fn link(&self, embed: bool, label: &str, destination: &str, table: bool) -> Option<String> {
        let pipe = if table { "\\|" } else { "|" };
        let bang = if embed { "!" } else { "" };
        let text = unescape(label).trim().to_string();
        if let Some((id, fragment)) = note_destination(destination) {
            let target = self.targets.get(id)?;
            let heading = fragment.map(|fragment| {
                let slug = percent_decode(fragment);
                target
                    .headings
                    .iter()
                    .find(|(candidate, _)| *candidate == slug)
                    .map_or(slug, |(_, text)| text.clone())
            });
            let mut defaults = vec![target.stem.clone(), target.title.clone()];
            let link = match &heading {
                Some(heading) => {
                    defaults.push(format!("{} > {heading}", target.stem));
                    defaults.push(format!("{} > {heading}", target.title));
                    defaults.push(heading.clone());
                    format!("{}#{}", target.stem, wiki_safe(heading).replace('#', " "))
                }
                None => target.stem.clone(),
            };
            let alias = if text.is_empty() || defaults.contains(&text) {
                String::new()
            } else {
                format!("{pipe}{}", wiki_safe(&text))
            };
            return Some(format!("{bang}[[{link}{alias}]]"));
        }
        let key = asset_key(destination)?;
        let name = self.assets.get(&key)?;
        let defaults = [name.clone(), base_name(&key).to_string()];
        let alias = if text.is_empty() || defaults.contains(&text) {
            String::new()
        } else {
            format!("{pipe}{}", wiki_safe(&text))
        };
        Some(format!("{bang}[[{name}{alias}]]"))
    }
}

fn exported_front_matter(text: &str) -> (String, &str) {
    let split = split_front_matter(text);
    let Some(lines) = split.lines else {
        return (String::new(), text);
    };
    let kept = without_keys(&lines, &["kind", "id"]);
    if kept.iter().all(|line| line.trim().is_empty()) {
        return (String::new(), split.body.trim_start_matches('\n'));
    }
    let mut out = String::from("---\n");
    for line in kept {
        out.push_str(&line);
        out.push('\n');
    }
    out.push_str("---\n");
    (out, split.body)
}

fn create_new(path: &Path) -> std::io::Result<std::fs::File> {
    std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
}

fn copy_new(from: &Path, to: &Path) -> std::io::Result<()> {
    let mut source = std::fs::File::open(from)?;
    let mut target = create_new(to)?;
    if let Err(error) = std::io::copy(&mut source, &mut target) {
        drop(target);
        let _ = std::fs::remove_file(to);
        return Err(error);
    }
    Ok(())
}

fn reserve_note_files(selected: &[ExportNote], folder: &Path) -> Result<Vec<String>, String> {
    let mut stems = Vec::with_capacity(selected.len());
    let mut taken: HashSet<String> = HashSet::new();
    for note in selected {
        let base = safe_stem(&note.title);
        let mut chosen = None;
        for attempt in 1..=MAX_NAME_ATTEMPTS {
            let candidate = numbered(&base, attempt);
            if !taken.insert(fold(&candidate)) {
                continue;
            }
            match create_new(&folder.join(format!("{candidate}.md"))) {
                Ok(_) => {
                    chosen = Some(candidate);
                    break;
                }
                Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {}
                Err(error) => {
                    return Err(AppError::new("notes.export_write_failed")
                        .param("name", format!("{candidate}.md"))
                        .detail(error)
                        .into())
                }
            }
        }
        stems.push(chosen.ok_or_else(|| AppError::new("notes.export_too_many_titles"))?);
    }
    Ok(stems)
}

struct ExportedAttachments {
    folder: PathBuf,
    names: HashMap<String, (String, String)>,
    copied: usize,
    skipped: usize,
}

impl ExportedAttachments {
    fn place(&mut self, asset: &ExportAsset) -> Result<Option<String>, String> {
        let Some(sha) = file_sha256(&asset.path) else {
            self.skipped += 1;
            return Ok(None);
        };
        let base = safe_file_name(asset.original.as_deref().unwrap_or(base_name(&asset.rel)));
        for attempt in 1..=MAX_NAME_ATTEMPTS {
            let candidate = numbered(&base, attempt);
            let key = fold(&candidate);
            match self.names.get(&key) {
                None => {
                    std::fs::create_dir_all(&self.folder).map_err(|error| {
                        String::from(AppError::new("notes.export_attachments_failed").detail(error))
                    })?;
                    match copy_new(&asset.path, &self.folder.join(&candidate)) {
                        Ok(()) => {
                            self.names.insert(key, (candidate.clone(), sha));
                            self.copied += 1;
                            return Ok(Some(candidate));
                        }
                        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
                            self.names.insert(key, (candidate, String::new()));
                        }
                        Err(error) => {
                            return Err(AppError::new("notes.export_copy_failed")
                                .param("name", candidate)
                                .detail(error)
                                .into())
                        }
                    }
                }
                Some((existing, hash)) if *hash == sha => return Ok(Some(existing.clone())),
                Some(_) => {}
            }
        }
        self.skipped += 1;
        Ok(None)
    }
}

pub(crate) fn export_notes(
    selected: &[ExportNote],
    outside: &HashMap<String, OutsideNote>,
    folder: &Path,
) -> Result<ExportSummary, String> {
    let stems = reserve_note_files(selected, folder)?;
    let mut targets = HashMap::new();
    for (id, note) in outside {
        let split = split_front_matter(&note.text);
        targets.insert(
            id.clone(),
            LinkTarget {
                stem: safe_stem(&note.title),
                title: note.title.clone(),
                headings: headings(split.body),
            },
        );
    }
    for (note, stem) in selected.iter().zip(&stems) {
        if let Some(id) = &note.note_id {
            let split = split_front_matter(&note.text);
            targets.insert(
                id.clone(),
                LinkTarget {
                    stem: stem.clone(),
                    title: note.title.clone(),
                    headings: headings(split.body),
                },
            );
        }
    }
    let mut attachments = ExportedAttachments {
        folder: folder.join(ATTACHMENTS),
        names: HashMap::new(),
        copied: 0,
        skipped: 0,
    };
    let mut written = 0usize;
    for (note, stem) in selected.iter().zip(&stems) {
        let mut assets = HashMap::new();
        for asset in &note.assets {
            if let Some(name) = attachments.place(asset)? {
                assets.insert(asset.rel.clone(), name);
            }
        }
        let conversion = ExportConversion {
            targets: &targets,
            assets: &assets,
        };
        let (front, body) = exported_front_matter(&note.text);
        let text = format!("{front}{}", conversion.body(body));
        let name = format!("{stem}.md");
        std::fs::write(folder.join(&name), text).map_err(|error| {
            String::from(
                AppError::new("notes.export_write_failed")
                    .param("name", name.as_str())
                    .detail(error),
            )
        })?;
        written += 1;
    }
    Ok(ExportSummary {
        folder: folder.to_string_lossy().into_owned(),
        notes: written,
        attachments: attachments.copied,
        skipped: attachments.skipped,
    })
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct OriginName {
    #[serde(default)]
    file_name: Option<String>,
    #[serde(default)]
    source_path: Option<String>,
}

fn origin_name(project_id: &str, rel: &str) -> Option<String> {
    let path = crate::sandbox::resolve_readable(project_id, &crate::project::note_origin_path(rel))
        .ok()?;
    let mut bytes = Vec::new();
    std::fs::File::open(path)
        .and_then(|file| file.take(MAX_ORIGIN_BYTES).read_to_end(&mut bytes))
        .ok()?;
    let origin: OriginName = serde_json::from_slice(&bytes).ok()?;
    origin
        .file_name
        .or(origin.source_path)
        .map(|name| base_name(&name.replace('\\', "/")).to_string())
        .filter(|name| !name.trim().is_empty())
}

fn note_assets(project_id: &str) -> Vec<ExportAsset> {
    let Ok(dir) = crate::sandbox::resolve_readable(project_id, NOTE_ASSETS) else {
        return Vec::new();
    };
    let Ok(read) = std::fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut assets: Vec<ExportAsset> = read
        .flatten()
        .filter_map(|entry| {
            let name = entry.file_name().to_str()?.to_string();
            let metadata = std::fs::symlink_metadata(entry.path()).ok()?;
            if name.starts_with('.') || !metadata.is_file() || metadata.file_type().is_symlink() {
                return None;
            }
            let rel = format!("{NOTE_ASSETS}/{name}");
            Some(ExportAsset {
                original: origin_name(project_id, &rel),
                path: entry.path(),
                rel,
            })
        })
        .collect();
    assets.sort_by(|left, right| left.rel.cmp(&right.rel));
    assets
}

fn library_notes() -> Result<Vec<crate::project::ProjectInfo>, String> {
    Ok(crate::project::list_projects_blocking()?
        .into_iter()
        .filter(|project| project.kind == NOTE_KIND && !project.recovery_pending)
        .collect())
}

fn read_note_text(project: &crate::project::ProjectInfo) -> Result<String, String> {
    crate::project::read_file_blocking(&project.id, &project.main_doc)
        .map(|text| normalize_text(&text))
}

pub(crate) fn collect_export(
    selection: Option<&str>,
) -> Result<(Vec<ExportNote>, HashMap<String, OutsideNote>), String> {
    let projects = library_notes()?;
    if let Some(id) = selection {
        if !projects.iter().any(|project| project.id == id) {
            return Err(AppError::new("notes.export_note_missing").into());
        }
    }
    let mut selected = Vec::new();
    for project in projects
        .iter()
        .filter(|project| selection.is_none_or(|id| project.id == id))
    {
        let text = match read_note_text(project) {
            Ok(text) => text,
            Err(error) if selection.is_some() => return Err(error),
            Err(error) => {
                let _ = crate::project::append_app_log(format!(
                    "Skipping note {:?} in the Markdown export: {error}",
                    project.id
                ));
                continue;
            }
        };
        let scanned = scan_note(project.id.clone(), project.name.clone(), &text);
        selected.push(ExportNote {
            note_id: scanned.note_id,
            title: project.name.clone(),
            assets: note_assets(&project.id),
            text,
        });
    }
    let mut outside = HashMap::new();
    if selection.is_none() {
        return Ok((selected, outside));
    }
    let wanted: HashSet<String> = selected
        .iter()
        .flat_map(|note| scan_note(String::new(), String::new(), &note.text).links)
        .filter(|link| link.kind == LinkKind::Note)
        .map(|link| link.id)
        .collect();
    if wanted.is_empty() {
        return Ok((selected, outside));
    }
    for listed in crate::note_links::note_links_blocking()? {
        if Some(listed.project_id.as_str()) == selection {
            continue;
        }
        let Some(note_id) = listed.note_id else {
            continue;
        };
        if !wanted.contains(&note_id) {
            continue;
        }
        let Some(project) = projects
            .iter()
            .find(|project| project.id == listed.project_id)
        else {
            continue;
        };
        if let Ok(text) = read_note_text(project) {
            outside.insert(
                note_id,
                OutsideNote {
                    title: project.name.clone(),
                    text,
                },
            );
        }
    }
    Ok((selected, outside))
}

fn refuse_data_folder(folder: &Path) -> Result<(), String> {
    let data = crate::paths::oleafly_root()?;
    let data = data.canonicalize().unwrap_or(data);
    if folder.starts_with(&data) {
        return Err(AppError::new("notes.folder_in_library").into());
    }
    Ok(())
}

fn chosen_folder(picked: &Path) -> Result<PathBuf, String> {
    let folder = picked
        .canonicalize()
        .map_err(|error| String::from(AppError::new("notes.folder_unopenable").detail(error)))?;
    if !folder.is_dir() {
        return Err(AppError::new("notes.folder_not_folder").into());
    }
    refuse_data_folder(&folder)?;
    Ok(folder)
}

pub(crate) fn create_export_folder(parent: &Path, name: &str) -> Result<PathBuf, String> {
    let parent = chosen_folder(parent)?;
    let base = safe_stem(name);
    for attempt in 1..=MAX_NAME_ATTEMPTS {
        let candidate = parent.join(numbered(&base, attempt));
        match std::fs::create_dir(&candidate) {
            Ok(()) => {
                return candidate.canonicalize().map_err(|error| {
                    String::from(AppError::new("notes.folder_unopenable").detail(error))
                });
            }
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => {
                return Err(AppError::new("notes.folder_create_failed")
                    .detail(error)
                    .into())
            }
        }
    }
    Err(AppError::new("notes.folder_no_free_name").into())
}

fn running() -> &'static Mutex<HashMap<String, Arc<AtomicBool>>> {
    static RUNNING: OnceLock<Mutex<HashMap<String, Arc<AtomicBool>>>> = OnceLock::new();
    RUNNING.get_or_init(Default::default)
}

fn pending() -> &'static Mutex<Vec<(String, PathBuf)>> {
    static PENDING: OnceLock<Mutex<Vec<(String, PathBuf)>>> = OnceLock::new();
    PENDING.get_or_init(Default::default)
}

fn valid_run_id(run_id: &str) -> bool {
    !run_id.is_empty()
        && run_id.len() <= MAX_RUN_ID_CHARS
        && run_id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
}

fn take_pending(run_id: &str) -> Option<PathBuf> {
    let mut pending = pending().lock().unwrap_or_else(PoisonError::into_inner);
    let at = pending.iter().position(|(id, _)| id == run_id)?;
    Some(pending.remove(at).1)
}

fn hold_pending(run_id: &str, root: PathBuf) {
    let mut pending = pending().lock().unwrap_or_else(PoisonError::into_inner);
    pending.retain(|(id, _)| id != run_id);
    pending.push((run_id.to_string(), root));
    let excess = pending.len().saturating_sub(MAX_PENDING);
    pending.drain(..excess);
}

fn start_run(run_id: &str) -> Result<Arc<AtomicBool>, String> {
    let mut running = running().lock().unwrap_or_else(PoisonError::into_inner);
    if running.contains_key(run_id) {
        return Err(AppError::new("notes.import_running").into());
    }
    let cancel = Arc::new(AtomicBool::new(false));
    running.insert(run_id.to_string(), Arc::clone(&cancel));
    Ok(cancel)
}

fn finish_run(run_id: &str) {
    running()
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .remove(run_id);
}

fn dialog_title(title: Option<String>) -> Option<String> {
    title
        .map(|title| truncate_chars(title.trim(), MAX_TITLE_CHARS))
        .filter(|title| !title.is_empty())
}

async fn pick_folder(
    webview: &tauri::Webview,
    title: Option<String>,
) -> Result<Option<PathBuf>, String> {
    use tauri_plugin_dialog::DialogExt;
    let mut dialog = webview.dialog().file();
    if let Some(title) = title {
        dialog = dialog.set_title(title);
    }
    if cfg!(any(windows, target_os = "macos")) {
        dialog = dialog.set_parent(&webview.window());
    }
    let (sender, receiver) = tokio::sync::oneshot::channel();
    dialog.pick_folder(move |picked| {
        let _ = sender.send(picked);
    });
    let Some(picked) = receiver
        .await
        .map_err(|_| String::from(AppError::new("notes.picker_closed")))?
    else {
        return Ok(None);
    };
    picked
        .into_path()
        .map(Some)
        .map_err(|_| String::from(AppError::new("notes.folder_not_local")))
}

async fn pick_markdown_files(
    webview: &tauri::Webview,
    title: Option<String>,
) -> Result<Option<Vec<PathBuf>>, String> {
    use tauri_plugin_dialog::DialogExt;
    let mut dialog = webview.dialog().file().add_filter("Markdown", &["md"]);
    if let Some(title) = title {
        dialog = dialog.set_title(title);
    }
    if cfg!(any(windows, target_os = "macos")) {
        dialog = dialog.set_parent(&webview.window());
    }
    let (sender, receiver) = tokio::sync::oneshot::channel();
    dialog.pick_files(move |picked| {
        let _ = sender.send(picked);
    });
    let Some(picked) = receiver
        .await
        .map_err(|_| String::from(AppError::new("notes.picker_closed")))?
    else {
        return Ok(None);
    };
    picked
        .into_iter()
        .map(|file| file.into_path())
        .collect::<Result<Vec<_>, _>>()
        .map(Some)
        .map_err(|_| String::from(AppError::new("notes.files_not_local")))
}

async fn run_import(
    state: &crate::state::AppState,
    run_id: &str,
    work: impl FnOnce(&AtomicBool, &CreatedNotes) -> Result<ImportReport, String> + Send + 'static,
) -> Result<ImportReport, String> {
    let cancel = start_run(run_id)?;
    let journal = CreatedNotes::default();
    let task_journal = journal.clone();
    let outcome = tauri::async_runtime::spawn_blocking(move || work(&cancel, &task_journal)).await;
    finish_run(run_id);
    match outcome {
        Ok(Ok(report)) => Ok(report),
        Ok(Err(error)) => {
            roll_back(state, journal.take()).await;
            Err(error)
        }
        Err(error) => {
            roll_back(state, journal.take()).await;
            Err(AppError::new("notes.import_stopped").detail(error).into())
        }
    }
}

async fn finish_import(
    state: &crate::state::AppState,
    report: ImportReport,
) -> Result<ImportOutcome, String> {
    if report.summary.cancelled || report.error.is_some() {
        roll_back(state, report.created).await;
        if let Some(error) = report.error {
            return Err(error);
        }
        return Ok(ImportOutcome::Done(ImportSummary {
            cancelled: true,
            ..ImportSummary::default()
        }));
    }
    crate::project::initialize_git_for_imported_notes(report.created);
    Ok(ImportOutcome::Done(report.summary))
}

async fn import_picked_files(
    webview: &tauri::Webview,
    state: &crate::state::AppState,
    request: NotesImportRequest,
    on_progress: tauri::ipc::Channel<ImportProgress>,
) -> Result<ImportOutcome, String> {
    let Some(files) = pick_markdown_files(webview, request.title).await? else {
        return Ok(ImportOutcome::Dismissed);
    };
    if files.is_empty() {
        return Ok(ImportOutcome::Dismissed);
    }
    let options = ImportOptions {
        folder_tags: request.folder_tags,
    };
    let report = run_import(state, &request.run_id, move |cancel, journal| {
        import_files_with(
            &files,
            options,
            cancel,
            &mut |progress| {
                let _ = on_progress.send(progress);
            },
            &disk_room,
            journal,
        )
    })
    .await?;
    finish_import(state, report).await
}

async fn roll_back(state: &crate::state::AppState, created: Vec<String>) {
    for project_id in created {
        if let Err(error) =
            crate::project::recycle_project_synchronized(state, project_id.clone()).await
        {
            let _ = crate::project::append_app_log(format!(
                "Could not remove note {project_id:?} after a stopped import: {error}"
            ));
        }
    }
}

#[tauri::command]
pub async fn notes_import_folder(
    webview: tauri::Webview,
    state: tauri::State<'_, crate::state::AppState>,
    request: NotesImportRequest,
    on_progress: tauri::ipc::Channel<ImportProgress>,
) -> Result<ImportOutcome, String> {
    if !valid_run_id(&request.run_id) {
        return Err(AppError::new("notes.import_invalid_run").into());
    }
    if request.files {
        return import_picked_files(&webview, state.inner(), request, on_progress).await;
    }
    let held = take_pending(&request.run_id).filter(|_| request.again);
    let picked = match held {
        Some(root) => Some(root),
        None => pick_folder(&webview, dialog_title(request.title)).await?,
    };
    let Some(picked) = picked else {
        return Ok(ImportOutcome::Dismissed);
    };
    let root = chosen_folder(&picked)?;
    if !request.again {
        if let Some(previous) = previous_import(&root) {
            hold_pending(&request.run_id, root);
            return Ok(ImportOutcome::Seen {
                imported_at: previous.imported_at,
                notes: previous.notes,
            });
        }
    }
    let options = ImportOptions {
        folder_tags: request.folder_tags,
    };
    let task_root = root.clone();
    let report = run_import(state.inner(), &request.run_id, move |cancel, journal| {
        import_vault_with(
            &task_root,
            options,
            cancel,
            &mut |progress| {
                let _ = on_progress.send(progress);
            },
            &disk_room,
            journal,
        )
    })
    .await?;
    let notes = report.summary.notes;
    let outcome = finish_import(state.inner(), report).await?;
    if notes > 0 && matches!(&outcome, ImportOutcome::Done(summary) if !summary.cancelled) {
        if let Err(error) = record_import(&root, notes) {
            let _ = crate::project::append_app_log(format!(
                "Could not remember the imported folder: {error}"
            ));
        }
    }
    Ok(outcome)
}

#[tauri::command]
pub fn notes_import_cancel(run_id: String) -> bool {
    let held = take_pending(&run_id).is_some();
    let stopped = running()
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .get(&run_id)
        .map(|cancel| cancel.store(true, Ordering::SeqCst))
        .is_some();
    held || stopped
}

#[tauri::command]
pub async fn notes_export_folder(
    webview: tauri::Webview,
    state: tauri::State<'_, crate::state::AppState>,
    request: NotesExportRequest,
) -> Result<Option<ExportSummary>, String> {
    if let Some(note_id) = &request.note_id {
        crate::paths::validate_project_id(note_id)?;
    }
    let Some(parent) = pick_folder(&webview, dialog_title(request.title)).await? else {
        return Ok(None);
    };
    let NotesExportRequest {
        note_id,
        folder_name,
        ..
    } = request;
    let summary = tauri::async_runtime::spawn_blocking(move || {
        let (selected, outside) = collect_export(note_id.as_deref())?;
        let folder = create_export_folder(&parent, &folder_name)?;
        export_notes(&selected, &outside, &folder)
    })
    .await
    .map_err(|error| String::from(AppError::new("notes.export_stopped").detail(error)))??;
    crate::commands::allow_reveal_export(&summary.folder, &state).await;
    Ok(Some(summary))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn import_vault(
        root: &Path,
        options: ImportOptions,
        cancel: &AtomicBool,
        progress: &mut dyn FnMut(ImportProgress),
    ) -> Result<ImportReport, String> {
        import_vault_with(
            root,
            options,
            cancel,
            progress,
            &disk_room,
            &CreatedNotes::default(),
        )
    }

    fn import_markdown_files(
        files: &[PathBuf],
        options: ImportOptions,
        cancel: &AtomicBool,
        progress: &mut dyn FnMut(ImportProgress),
    ) -> Result<ImportReport, String> {
        import_files_with(
            files,
            options,
            cancel,
            progress,
            &disk_room,
            &CreatedNotes::default(),
        )
    }

    fn file(rel: &str) -> VaultFile {
        VaultFile {
            rel: rel.to_string(),
            path: PathBuf::from(rel),
            size: 1,
        }
    }

    fn vault(notes: &[&str], files: &[&str]) -> Vault {
        Vault {
            notes: notes.iter().map(|rel| file(rel)).collect(),
            files: files.iter().map(|rel| file(rel)).collect(),
            skipped: 0,
            beside_only: false,
        }
    }

    fn note_index(lookups: &Lookups, raw: &str, dir: &str) -> Option<usize> {
        match lookups.resolve(raw, dir) {
            Some(Target::Note(index)) => Some(index),
            _ => None,
        }
    }

    fn file_index(lookups: &Lookups, raw: &str, dir: &str) -> Option<usize> {
        match lookups.resolve(raw, dir) {
            Some(Target::File(index)) => Some(index),
            _ => None,
        }
    }

    #[test]
    fn resolves_names_the_way_obsidian_does() {
        let vault = vault(
            &[
                "Inbox.md",
                "Projects/Alpha.md",
                "Projects/Notes/Alpha.md",
                "Archive/Beta.md",
                "Daily/2024-01-01.md",
                "Daily/Beta.md",
            ],
            &[
                "attachments/Figure 1.png",
                "data/table.csv",
                "other/table.csv",
            ],
        );
        let lookups = Lookups::new(&vault);
        assert_eq!(note_index(&lookups, "Inbox", ""), Some(0));
        assert_eq!(note_index(&lookups, "inbox.MD", ""), Some(0));
        assert_eq!(note_index(&lookups, "projects/alpha", ""), Some(1));
        assert_eq!(note_index(&lookups, "Alpha", ""), None);
        assert_eq!(note_index(&lookups, "Alpha", "projects/notes"), Some(2));
        assert_eq!(note_index(&lookups, "Notes/Alpha", ""), Some(2));
        assert_eq!(note_index(&lookups, "Beta", ""), None);
        assert_eq!(note_index(&lookups, "Beta", "daily"), Some(5));
        assert_eq!(note_index(&lookups, "../Archive/Beta", "daily"), Some(3));
        assert_eq!(note_index(&lookups, "2024-01-01", ""), Some(4));
        assert_eq!(note_index(&lookups, "../../Inbox", ""), None);
        assert_eq!(note_index(&lookups, "   ", ""), None);
        assert_eq!(note_index(&lookups, "Missing", ""), None);
        assert_eq!(file_index(&lookups, "Figure 1.png", "daily"), Some(0));
        assert_eq!(
            file_index(&lookups, "attachments\\figure 1.PNG", ""),
            Some(0)
        );
        assert_eq!(file_index(&lookups, "table.csv", ""), None);
        assert_eq!(file_index(&lookups, "data/table.csv", ""), Some(1));
    }

    fn convert(text: &str, rel: &str, vault: &Vault) -> (String, usize) {
        let lookups = Lookups::new(vault);
        let ids: Vec<Option<String>> = (0..vault.notes.len())
            .map(|index| Some(format!("id-{index}")))
            .collect();
        let shared = ImportShared::default();
        let context = ImportContext {
            vault,
            lookups: &lookups,
            ids: &ids,
            shared: &shared,
        };
        let mut conversion = NoteConversion::new(&context, "self", rel);
        let body = conversion.body(text);
        (body, conversion.unresolved)
    }

    #[test]
    fn converts_wikilinks_embeds_headings_and_block_refs() {
        let vault = vault(&["Alpha.md", "Sub/Beta.md"], &[]);
        let text = "See [[Alpha]], [[Alpha|the alpha]], [[Beta#Methods and *Data*]], [[Beta#^abc123]] and [[Beta#^abc|ref]].\n![[Alpha]] ![[Beta#Results]] [[#Local heading]] [[Alpha.md]]\n";
        let (body, unresolved) = convert(text, "Inbox.md", &vault);
        assert_eq!(
            body,
            "See [Alpha](oleafly://note/id-0), [the alpha](oleafly://note/id-0), [Beta > Methods and *Data*](oleafly://note/id-1#methods-and-data), [Beta](oleafly://note/id-1) and [ref](oleafly://note/id-1).\n![Alpha](oleafly://note/id-0) ![Beta > Results](oleafly://note/id-1#results) [Local heading](oleafly://note/self#local-heading) [Alpha](oleafly://note/id-0)\n"
        );
        assert_eq!(unresolved, 0);
    }

    #[test]
    fn leaves_unresolved_links_and_code_alone() {
        let vault = vault(&["Alpha.md"], &[]);
        let text = "[[Missing]] and ![[Gone.png]] and [x](Nope.md)\n`[[Alpha]]` ``[[Alpha]]``\n```\n[[Alpha]]\n```\n~~~~md\n[[Alpha]]\n~~~~\n\\[[Alpha]] [[]] [[#^block]] [web](https://example.org/a.md) [top](#heading)\n| a | [[Alpha\\|alias]] |\n";
        let (body, unresolved) = convert(text, "Inbox.md", &vault);
        assert_eq!(
            body,
            "[[Missing]] and ![[Gone.png]] and [x](Nope.md)\n`[[Alpha]]` ``[[Alpha]]``\n```\n[[Alpha]]\n```\n~~~~md\n[[Alpha]]\n~~~~\n\\[[Alpha]] [[]] [[#^block]] [web](https://example.org/a.md) [top](#heading)\n| a | [alias](oleafly://note/id-0) |\n"
        );
        assert_eq!(unresolved, 4);
    }

    #[test]
    fn converts_relative_markdown_links_to_notes() {
        let vault = vault(&["Notes/Alpha Beta.md", "Gamma.md"], &[]);
        let text = "[ab](Alpha%20Beta.md#Some%20Heading) [g](../Gamma.md) [block](<Alpha Beta.md#^x>) ![embed](Gamma.md)";
        let (body, unresolved) = convert(text, "Notes/Inbox.md", &vault);
        assert_eq!(
            body,
            "[ab](oleafly://note/id-0#some-heading) [g](oleafly://note/id-1) [block](oleafly://note/id-0) ![embed](oleafly://note/id-1)"
        );
        assert_eq!(unresolved, 0);
    }

    fn write(root: &Path, rel: &str, bytes: &[u8]) {
        let path = root.join(rel);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, bytes).unwrap();
    }

    #[test]
    fn plans_attachment_paths_with_content_hashes() {
        let root = tempfile::tempdir().unwrap();
        write(root.path(), "img/Fig 1.png", b"png-bytes");
        write(root.path(), "copy/Fig 1.png", b"png-bytes");
        write(root.path(), "data.csv", b"a,b\n");
        write(root.path(), "run.ipynb", b"{}");
        write(root.path(), "doc.pdf", b"%PDF");
        let cancel = AtomicBool::new(false);
        let scanned = scan_vault(root.path(), &cancel).unwrap().unwrap();
        let sha = file_sha256(&root.path().join("img/Fig 1.png")).unwrap();
        let hash = &sha[..8];
        let text = "![[Fig 1.png|300]] ![[img/Fig 1.png|A figure]] ![](copy/Fig%201.png) [[data.csv]]\n![[run.ipynb]]\n![[doc.pdf]] [paper](doc.pdf)\n";
        let (body, unresolved) = convert(text, "Inbox.md", &scanned);
        assert_eq!(unresolved, 1);
        let lookups = Lookups::new(&scanned);
        let ids: Vec<Option<String>> = Vec::new();
        let shared = ImportShared::default();
        let context = ImportContext {
            vault: &scanned,
            lookups: &lookups,
            ids: &ids,
            shared: &shared,
        };
        let mut conversion = NoteConversion::new(&context, "self", "Inbox.md");
        let converted = conversion.body("![[img/Fig 1.png]] ![](copy/Fig%201.png) [d](data.csv)");
        assert_eq!(
            converted,
            format!("![Fig 1.png](assets/Fig-1-{hash}.png) ![](assets/Fig-1-{hash}.png) [d](assets/data-{}.csv)", &file_sha256(&root.path().join("data.csv")).unwrap()[..8])
        );
        assert_eq!(conversion.assets.copies.len(), 2);
        assert!(body.starts_with("![[Fig 1.png|300]] "), "{body}");
        assert!(
            body.contains(&format!("![A figure](assets/Fig-1-{hash}.png)")),
            "{body}"
        );
        assert!(body.contains("```notebook\nassets/run-"), "{body}");
        assert!(body.contains("[doc.pdf](assets/doc-"), "{body}");
        assert!(body.contains("[paper](assets/doc-"), "{body}");
    }

    #[test]
    fn resolves_links_whatever_the_unicode_form_or_case() {
        let composed = vault(
            &["Caf\u{e9}.md", "Notes/R\u{e9}sum\u{e9}.md"],
            &["img/\u{c9}t\u{e9}.png"],
        );
        let lookups = Lookups::new(&composed);
        assert_eq!(note_index(&lookups, "Cafe\u{301}", ""), Some(0));
        assert_eq!(note_index(&lookups, "CAF\u{c9}", ""), Some(0));
        assert_eq!(note_index(&lookups, "Re\u{301}sume\u{301}", ""), Some(1));
        assert_eq!(file_index(&lookups, "E\u{301}te\u{301}.PNG", ""), Some(0));
        let decomposed = vault(&["Notes/Cafe\u{301}.md"], &[]);
        let lookups = Lookups::new(&decomposed);
        assert_eq!(note_index(&lookups, "Caf\u{e9}", "notes"), Some(0));
    }

    #[test]
    fn reuses_one_attachment_for_names_that_differ_only_in_case() {
        let root = tempfile::tempdir().unwrap();
        write(root.path(), "a/Fig.png", b"same");
        write(root.path(), "b/fig.png", b"same");
        let scanned = scan_vault(root.path(), &AtomicBool::new(false))
            .unwrap()
            .unwrap();
        let lookups = Lookups::new(&scanned);
        let ids: Vec<Option<String>> = Vec::new();
        let shared = ImportShared::default();
        let context = ImportContext {
            vault: &scanned,
            lookups: &lookups,
            ids: &ids,
            shared: &shared,
        };
        let mut conversion = NoteConversion::new(&context, "one", "One.md");
        let body = conversion.body("![](a/Fig.png) ![](b/fig.png)");
        let hash = &file_sha256(&root.path().join("a/Fig.png")).unwrap()[..8];
        assert_eq!(
            body,
            format!("![](assets/Fig-{hash}.png) ![](assets/Fig-{hash}.png)")
        );
        assert_eq!(conversion.assets.copies.len(), 1);
    }

    #[test]
    fn imports_cloud_placeholders_but_not_links_or_other_reparse_points() {
        use crate::paths::{classify_reparse_tag, ReparseClass};
        assert!(reparse_allows_import(Ok(ReparseClass::None)));
        assert!(reparse_allows_import(Ok(classify_reparse_tag(
            0x400,
            0x9000_601A
        ))));
        assert!(reparse_allows_import(Ok(classify_reparse_tag(
            0x400,
            0x8000_0021
        ))));
        assert!(!reparse_allows_import(Ok(classify_reparse_tag(
            0x400,
            0xA000_000C
        ))));
        assert!(!reparse_allows_import(Ok(classify_reparse_tag(
            0x400,
            0x8000_0017
        ))));
        assert!(!reparse_allows_import(Err(std::io::Error::other("gone"))));
    }

    #[cfg(unix)]
    #[test]
    fn counts_folders_it_cannot_read_as_skipped() {
        use std::os::unix::fs::PermissionsExt;
        let root = tempfile::tempdir().unwrap();
        write(root.path(), "Keep.md", b"# Keep\n");
        write(root.path(), "Locked/Inside.md", b"# Inside\n");
        let locked = root.path().join("Locked");
        std::fs::set_permissions(&locked, std::fs::Permissions::from_mode(0o000)).unwrap();
        let readable = std::fs::read_dir(&locked).is_ok();
        let scanned = scan_vault(root.path(), &AtomicBool::new(false));
        std::fs::set_permissions(&locked, std::fs::Permissions::from_mode(0o755)).unwrap();
        if readable {
            return;
        }
        let scanned = scanned.unwrap().unwrap();
        assert_eq!(scanned.notes.len(), 1);
        assert_eq!(scanned.skipped, 1);
    }

    #[test]
    fn notes_share_one_hash_per_file_and_one_attachment_budget() {
        let root = tempfile::tempdir().unwrap();
        write(root.path(), "a.png", b"aaaaaa");
        write(root.path(), "b.png", b"bbbbbb");
        let cancel = AtomicBool::new(false);
        let scanned = scan_vault(root.path(), &cancel).unwrap().unwrap();
        let lookups = Lookups::new(&scanned);
        let ids: Vec<Option<String>> = Vec::new();
        let shared = ImportShared::with_budget(10);
        let context = ImportContext {
            vault: &scanned,
            lookups: &lookups,
            ids: &ids,
            shared: &shared,
        };
        let mut first = NoteConversion::new(&context, "one", "One.md");
        let one = first.body("![](a.png) ![](a.png)");
        assert_eq!(first.assets.copies.len(), 1);
        assert_eq!(shared.planned.get(), 6);
        std::fs::remove_file(root.path().join("a.png")).unwrap();
        let mut second = NoteConversion::new(&context, "two", "Two.md");
        let two = second.body("![](a.png) ![](b.png)");
        assert!(one.contains("](assets/a-"), "{one}");
        assert!(!two.contains("](assets/"), "{two}");
        assert!(second.assets.copies.is_empty());
        assert_eq!(second.assets.skipped, 2);
        assert_eq!(shared.planned.get(), 6);
        assert_eq!(shared.hashes.borrow().len(), 2);
        let roomy = ImportShared::with_budget(12);
        let context = ImportContext {
            shared: &roomy,
            ..context
        };
        let mut third = NoteConversion::new(&context, "three", "Three.md");
        third.body("![](b.png)");
        assert_eq!(third.assets.copies.len(), 1);
        assert_eq!(roomy.planned.get(), 6);
        assert_eq!(ImportShared::default().budget, MAX_IMPORT_ATTACHMENT_BYTES);
    }

    #[test]
    fn refuses_an_import_that_would_leave_too_little_free_space() {
        let gib = 1024 * 1024 * 1024;
        assert!(room_for(gib, 4 * gib).is_ok());
        assert!(room_for(2 * gib, 4 * gib).is_ok());
        let tight = crate::app_error::english(&room_for(3 * gib, 4 * gib).unwrap_err()).unwrap();
        assert!(
            tight.contains("3.2 GB") && tight.contains("2 GB free"),
            "{tight}"
        );
        assert!(room_for(5 * gib, 4 * gib).is_err());
        assert!(room_for(0, gib).is_err());
    }

    #[test]
    fn checks_free_space_for_every_note_and_attachment_before_writing() {
        let _env_guard = crate::paths::data_dir_env_lock();
        let data = tempfile::tempdir().unwrap();
        std::env::set_var("OLEAFLY_DATA_DIR", data.path());
        let vault = tempfile::tempdir().unwrap();
        write(vault.path(), "One.md", b"# One\n![[pic.png]]\n");
        write(vault.path(), "Two.md", b"# Two\n![[pic.png]]\n");
        write(vault.path(), "pic.png", b"0123456789");
        let asked = std::cell::Cell::new(0u64);
        let refused = import_vault_with(
            vault.path(),
            ImportOptions::default(),
            &AtomicBool::new(false),
            &mut |_| {},
            &|needed| {
                asked.set(needed);
                Err("full".into())
            },
            &CreatedNotes::default(),
        );
        assert_eq!(refused.unwrap_err(), "full");
        assert!(asked.get() > 20, "{}", asked.get());
        assert!(crate::project::list_projects_blocking()
            .unwrap_or_default()
            .is_empty());
        let report = import_vault_with(
            vault.path(),
            ImportOptions::default(),
            &AtomicBool::new(false),
            &mut |_| {},
            &|_| Ok(()),
            &CreatedNotes::default(),
        )
        .unwrap();
        assert_eq!(report.summary.notes, 2);
        assert_eq!(report.summary.attachments, 2);
        std::env::remove_var("OLEAFLY_DATA_DIR");
    }

    #[test]
    fn skips_hidden_folders_large_notes_and_links() {
        let root = tempfile::tempdir().unwrap();
        write(root.path(), "Keep.md", b"# Keep\n");
        write(root.path(), ".obsidian/workspace.md", b"x");
        write(root.path(), ".trash/Old.md", b"x");
        write(root.path(), "Sub/.hidden/Secret.md", b"x");
        write(root.path(), "Sub/.dot.md", b"x");
        write(
            root.path(),
            "Big.md",
            &vec![b'a'; (MAX_NOTE_BYTES + 1) as usize],
        );
        write(root.path(), "Sub/Note.MD", b"text");
        #[cfg(unix)]
        std::os::unix::fs::symlink(root.path().join("Keep.md"), root.path().join("Link.md"))
            .unwrap();
        let cancel = AtomicBool::new(false);
        let scanned = scan_vault(root.path(), &cancel).unwrap().unwrap();
        let notes: Vec<&str> = scanned.notes.iter().map(|file| file.rel.as_str()).collect();
        assert_eq!(notes, vec!["Keep.md", "Sub/Note.MD"]);
        assert_eq!(scanned.skipped, 1);
        cancel.store(true, Ordering::SeqCst);
        assert!(scan_vault(root.path(), &cancel).unwrap().is_none());
        assert!(scan_vault(&root.path().join("missing"), &AtomicBool::new(false)).is_err());
    }

    #[test]
    fn reads_titles_and_keeps_the_original_front_matter() {
        let text = "---\ntitle: \"Deep: learning\"\ntags: [ml]\nid: zettel-42\nkind: page\n---\n# Heading\n";
        let split = split_front_matter(text);
        let front = split.lines.as_deref();
        assert_eq!(note_title(front, split.body, "x/File.md"), "Deep: learning");
        let source = imported_source(front, "Deep: learning", "new-id", Some("x"), split.body);
        assert_eq!(
            source,
            "---\ntitle: \"Deep: learning\"\ntags: [ml, x]\nimported-id: zettel-42\nkind: note\nid: new-id\n---\n# Heading\n"
        );
        let plain = "Intro\n\n# **First** title #\n";
        assert_eq!(note_title(None, plain, "Folder/Name.md"), "First title");
        assert_eq!(
            imported_source(None, "First title", "n", None, plain),
            "---\ntitle: First title\nkind: note\nid: n\n---\n\nIntro\n\n# **First** title #\n"
        );
        assert_eq!(
            note_title(None, "## Only h2\n```\n# code\n```\n", "Folder/Name.md"),
            "Name"
        );
        assert_eq!(note_title(Some(&["title: ''"]), "", "A.md"), "A");
        assert_eq!(note_title(Some(&["title: 'It''s'"]), "", "A.md"), "It's");
        assert_eq!(note_title(None, "", " .md"), UNTITLED);
        let empty_title =
            imported_source(Some(&["title:", "aliases:", "  - x"]), "T", "n", None, "");
        assert_eq!(
            empty_title,
            "---\naliases:\n  - x\ntitle: T\nkind: note\nid: n\n---\n"
        );
        let oleafly = imported_source(Some(&["kind: note", "id: old"]), "T", "n", None, "\nBody");
        assert_eq!(oleafly, "---\ntitle: T\nkind: note\nid: n\n---\n\nBody");
    }

    #[test]
    fn keeps_a_long_title_whole_in_the_front_matter() {
        let heading = format!("{} {}", "A".repeat(150), "B".repeat(80));
        let body = format!("# {heading}\n\nText\n");
        let name = note_title(None, &body, "Long.md");
        assert_eq!(name.chars().count(), MAX_TITLE_CHARS);
        assert_eq!(full_note_title(None, &body, "Long.md"), heading);
        assert_eq!(full_note_title(None, "", " .md"), UNTITLED);
        let source = imported_source(
            None,
            &full_note_title(None, &body, "Long.md"),
            "n",
            None,
            &body,
        );
        assert!(source.starts_with(&format!("---\ntitle: {heading}\n")));
    }

    #[test]
    fn adds_folder_tags_to_every_tags_shape() {
        let tag = |lines: &[&str]| {
            let mut lines: Vec<String> = lines.iter().map(|line| line.to_string()).collect();
            add_tag(&mut lines, "lab/2024");
            lines
        };
        assert_eq!(tag(&[]), vec!["tags:", "  - lab/2024"]);
        assert_eq!(
            tag(&["tags:", "- a", "- b", "next: 1"]),
            vec!["tags:", "- a", "- b", "- lab/2024", "next: 1"]
        );
        assert_eq!(
            tag(&["tags:", "    - Lab/2024"]),
            vec!["tags:", "    - Lab/2024"]
        );
        assert_eq!(tag(&["tags:"]), vec!["tags:", "  - lab/2024"]);
        assert_eq!(tag(&["tags: []"]), vec!["tags: [lab/2024]"]);
        assert_eq!(
            tag(&["tags: [a, \"#lab/2024\"]"]),
            vec!["tags: [a, \"#lab/2024\"]"]
        );
        assert_eq!(tag(&["tags: a, b"]), vec!["tags: a, b, lab/2024"]);
        assert_eq!(tag(&["tags: a b"]), vec!["tags: a b lab/2024"]);
        assert_eq!(tag(&["tags: \"a\""]), vec!["tags: a lab/2024"]);
        assert_eq!(tag(&["tags: lab/2024"]), vec!["tags: lab/2024"]);
        assert_eq!(
            folder_tag("Lab notes/2024 Q1/Run.md").as_deref(),
            Some("Lab-notes/2024-Q1")
        );
        assert_eq!(folder_tag("2024/11/Run.md").as_deref(), Some("2024/11"));
        assert_eq!(folder_tag("Run.md"), None);
        assert_eq!(folder_tag("123/Run.md"), None);
        assert_eq!(folder_tag("!!!/Run.md"), None);
    }

    #[test]
    fn slugs_headings_like_github() {
        assert_eq!(heading_slug("Methods and Data"), "methods-and-data");
        assert_eq!(heading_slug("Über: Größe?"), "über-größe");
        assert_eq!(heading_slug("snake_case-name"), "snake_case-name");
        let body = "# Intro\n## Intro\n### Intro\n```\n# Not a heading\n```\n#Nope\n## [Linked](x) `code` _em_ ~~gone~~ ==mark== [[Note|alias]] ##\n####### seven\n";
        assert_eq!(
            headings(body),
            vec![
                ("intro".to_string(), "Intro".to_string()),
                ("intro-1".to_string(), "Intro".to_string()),
                ("intro-2".to_string(), "Intro".to_string()),
                (
                    "linked-code-em-gone-mark-alias".to_string(),
                    "Linked code em gone mark alias".to_string()
                ),
            ]
        );
        assert_eq!(
            plain_heading("a \\* b ![img](x.png) snake_case"),
            "a * b img snake_case"
        );
    }

    #[test]
    fn makes_safe_unique_file_names() {
        assert_eq!(
            safe_stem("A/B: testing? <draft> #1 [x]|y^"),
            "A B testing draft 1 x y"
        );
        assert_eq!(safe_stem("..hidden."), "hidden");
        assert_eq!(safe_stem("  "), UNTITLED);
        assert_eq!(safe_stem("con"), "con note");
        assert_eq!(safe_stem("con.backup"), "con note.backup");
        assert_eq!(safe_stem("Con. Lecture"), "Con note. Lecture");
        assert_eq!(safe_stem("aux.final"), "aux note.final");
        assert_eq!(safe_stem("COM\u{b9}"), "COM\u{b9} note");
        assert_eq!(safe_stem("lpt9"), "lpt9 note");
        assert_eq!(safe_stem("console"), "console");
        assert_eq!(safe_stem("com10"), "com10");
        assert_eq!(safe_stem("a\u{ad}b\u{200b}c\u{202e}d"), "abcd");
        assert_eq!(safe_stem("Cafe\u{301}"), "Caf\u{e9}");
        assert_eq!(safe_file_name("con.png"), "con note.png");
        assert_eq!(safe_stem(&"x".repeat(300)).len(), MAX_STEM_CHARS);
        assert_eq!(safe_file_name("dir/Fig: 1.PNG"), "Fig 1.png");
        assert_eq!(safe_file_name("README"), "README");
        assert_eq!(numbered("Fig.png", 2), "Fig 2.png");
        assert_eq!(numbered("Notes", 3), "Notes 3");
    }

    fn export_note(id: &str, title: &str, text: &str, assets: Vec<ExportAsset>) -> ExportNote {
        ExportNote {
            note_id: Some(id.to_string()),
            title: title.to_string(),
            text: text.to_string(),
            assets,
        }
    }

    #[test]
    fn exports_links_back_to_wikilinks() {
        let folder = tempfile::tempdir().unwrap();
        let assets_dir = tempfile::tempdir().unwrap();
        write(assets_dir.path(), "fig-1a2b3c4d.png", b"png");
        write(assets_dir.path(), "other-1a2b3c4d.png", b"other");
        write(assets_dir.path(), "run-00000000.ipynb", b"{}");
        let asset = |rel: &str, file: &str, original: Option<&str>| ExportAsset {
            rel: rel.to_string(),
            path: assets_dir.path().join(file),
            original: original.map(str::to_string),
        };
        let alpha = export_note(
            "a",
            "Alpha: one",
            "---\ntitle: \"Alpha: one\"\nkind: note\nid: a\ncolor: mint\n---\n# Alpha\n[Beta](oleafly://note/b) [the beta](oleafly://note/b) [Beta > Methods](oleafly://note/b#methods) [x](oleafly://note/b#unknown-slug) ![Beta](oleafly://note/b#results-1)\n![Fig](assets/fig-1a2b3c4d.png) ![fig.png](assets/fig-1a2b3c4d.png) [data](./assets/missing.csv) [Gone](oleafly://note/zzz) [[Kept]] [p](oleafly://project/p)\n| t | [alias](oleafly://note/b) |\n```notebook\nassets/run-00000000.ipynb\n```\n```notebook\nassets/run-00000000.ipynb\ncells: 1-2\n```\n`[c](oleafly://note/b)`\n",
            vec![
                asset("assets/fig-1a2b3c4d.png", "fig-1a2b3c4d.png", Some("fig.png")),
                asset("assets/run-00000000.ipynb", "run-00000000.ipynb", None),
            ],
        );
        let beta = export_note(
            "b",
            "Beta",
            "---\nkind: note\nid: b\n---\n## Methods\n## Results\n## Results\n![Other](assets/other-1a2b3c4d.png)\n",
            vec![asset("assets/other-1a2b3c4d.png", "other-1a2b3c4d.png", Some("fig.png"))],
        );
        let twin = export_note("c", "Beta", "Twin", Vec::new());
        let summary = export_notes(&[alpha, beta, twin], &HashMap::new(), folder.path()).unwrap();
        assert_eq!(summary.notes, 3);
        assert_eq!(summary.attachments, 3);
        let alpha = std::fs::read_to_string(folder.path().join("Alpha one.md")).unwrap();
        assert_eq!(
            alpha,
            "---\ntitle: \"Alpha: one\"\ncolor: mint\n---\n# Alpha\n[[Beta]] [[Beta|the beta]] [[Beta#Methods]] [[Beta#unknown-slug|x]] ![[Beta#Results]]\n![[fig.png|Fig]] ![[fig.png]] [data](./assets/missing.csv) [Gone](oleafly://note/zzz) [[Kept]] [p](oleafly://project/p)\n| t | [[Beta\\|alias]] |\n![[run-00000000.ipynb]]\n```notebook\nattachments/run-00000000.ipynb\ncells: 1-2\n```\n`[c](oleafly://note/b)`\n"
        );
        let beta = std::fs::read_to_string(folder.path().join("Beta.md")).unwrap();
        assert_eq!(
            beta,
            "## Methods\n## Results\n## Results\n![[fig 2.png|Other]]\n"
        );
        assert_eq!(
            std::fs::read_to_string(folder.path().join("Beta 2.md")).unwrap(),
            "Twin"
        );
        assert_eq!(
            std::fs::read(folder.path().join("attachments/fig.png")).unwrap(),
            b"png"
        );
        assert_eq!(
            std::fs::read(folder.path().join("attachments/fig 2.png")).unwrap(),
            b"other"
        );
    }

    #[test]
    fn exports_never_overwrite_and_count_attachments_left_behind() {
        let folder = tempfile::tempdir().unwrap();
        write(folder.path(), "Alpha.md", b"keep");
        write(folder.path(), "attachments/Fig.png", b"other");
        let assets_dir = tempfile::tempdir().unwrap();
        write(assets_dir.path(), "fig.png", b"png");
        let asset = |rel: &str, file: &str, original: Option<&str>| ExportAsset {
            rel: rel.to_string(),
            path: assets_dir.path().join(file),
            original: original.map(str::to_string),
        };
        let notes = [
            export_note(
                "a",
                "Alpha",
                "![x](assets/fig.png)",
                vec![
                    asset("assets/fig.png", "fig.png", Some("Fig.png")),
                    asset("assets/gone.png", "gone.png", None),
                ],
            ),
            export_note("c", "Caf\u{e9}", "composed", Vec::new()),
            export_note("d", "Cafe\u{301}", "decomposed", Vec::new()),
            export_note("e", "CAF\u{c9}", "upper", Vec::new()),
        ];
        let summary = export_notes(&notes, &HashMap::new(), folder.path()).unwrap();
        assert_eq!(summary.notes, 4);
        assert_eq!(summary.attachments, 1);
        assert_eq!(summary.skipped, 1);
        let read = |name: &str| std::fs::read_to_string(folder.path().join(name)).unwrap();
        assert_eq!(read("Alpha.md"), "keep");
        assert_eq!(read("Alpha 2.md"), "![[Fig 2.png|x]]");
        assert_eq!(read("attachments/Fig.png"), "other");
        assert_eq!(read("attachments/Fig 2.png"), "png");
        assert_eq!(read("Caf\u{e9}.md"), "composed");
        assert_eq!(read("Caf\u{e9} 2.md"), "decomposed");
        assert_eq!(read("CAF\u{c9} 3.md"), "upper");
    }

    #[test]
    fn finds_linked_notes_whose_id_sits_past_the_first_kilobytes() {
        let _env_guard = crate::paths::data_dir_env_lock();
        let data = tempfile::tempdir().unwrap();
        std::env::set_var("OLEAFLY_DATA_DIR", data.path());
        let padding = format!("summary: {}\n", "x".repeat(9 * 1024));
        crate::project::create_note_project_from(
            "Far".into(),
            format!("---\nkind: note\n{padding}id: far-id\n---\n# Far\n"),
            None,
        )
        .unwrap();
        let near = crate::project::create_note_project_from(
            "Near".into(),
            "---\nkind: note\nid: near-id\n---\n[Far](oleafly://note/far-id)\n".into(),
            None,
        )
        .unwrap();
        let (selected, outside) = collect_export(Some(&near)).unwrap();
        std::env::remove_var("OLEAFLY_DATA_DIR");
        assert_eq!(selected.len(), 1);
        assert_eq!(
            outside.get("far-id").map(|note| note.title.as_str()),
            Some("Far")
        );
    }

    #[test]
    fn exports_one_note_with_links_to_notes_outside_it() {
        let folder = tempfile::tempdir().unwrap();
        let note = export_note(
            "a",
            "Alpha",
            "[B](oleafly://note/b#two) ![B](oleafly://note/b)",
            Vec::new(),
        );
        let outside = HashMap::from([(
            "b".to_string(),
            OutsideNote {
                title: "Beta/Gamma".to_string(),
                text: "# One\n# Two\n".to_string(),
            },
        )]);
        export_notes(&[note], &outside, folder.path()).unwrap();
        assert_eq!(
            std::fs::read_to_string(folder.path().join("Alpha.md")).unwrap(),
            "[[Beta Gamma#Two|B]] ![[Beta Gamma|B]]"
        );
    }

    #[test]
    fn remembers_imported_folders() {
        let _env_guard = crate::paths::data_dir_env_lock();
        let data = tempfile::tempdir().unwrap();
        std::env::set_var("OLEAFLY_DATA_DIR", data.path());
        let vault = tempfile::tempdir().unwrap();
        assert!(previous_import(vault.path()).is_none());
        record_import(vault.path(), 3).unwrap();
        record_import(vault.path(), 4).unwrap();
        let seen = previous_import(vault.path()).unwrap();
        assert_eq!(seen.notes, 4);
        assert!(seen.imported_at > 0);
        assert!(previous_import(data.path()).is_none());
        for index in 0..HISTORY_LIMIT + 5 {
            record_import(&vault.path().join(index.to_string()), 1).unwrap();
        }
        assert_eq!(read_history().folders.len(), HISTORY_LIMIT);
        assert!(chosen_folder(data.path()).is_err());
        assert!(chosen_folder(vault.path()).is_ok());
        assert!(chosen_folder(&vault.path().join("missing")).is_err());
        let created = create_export_folder(vault.path(), "Notes/one").unwrap();
        assert_eq!(created.file_name().unwrap(), "Notes one");
        let second = create_export_folder(vault.path(), "Notes/one").unwrap();
        assert_eq!(second.file_name().unwrap(), "Notes one 2");
        std::env::remove_var("OLEAFLY_DATA_DIR");
    }

    #[test]
    fn tracks_runs_and_pending_folders() {
        assert!(valid_run_id("run-1"));
        assert!(!valid_run_id(""));
        assert!(!valid_run_id("a/b"));
        assert!(!valid_run_id(&"a".repeat(MAX_RUN_ID_CHARS + 1)));
        let cancel = start_run("t-run").unwrap();
        assert!(start_run("t-run").is_err());
        assert!(notes_import_cancel("t-run".into()));
        assert!(cancel.load(Ordering::SeqCst));
        finish_run("t-run");
        assert!(!notes_import_cancel("t-run".into()));
        hold_pending("t-held", PathBuf::from("/a"));
        hold_pending("t-held", PathBuf::from("/b"));
        assert!(notes_import_cancel("t-held".into()));
        assert!(take_pending("t-held").is_none());
        hold_pending("t-take", PathBuf::from("/c"));
        assert_eq!(take_pending("t-take"), Some(PathBuf::from("/c")));
        for index in 0..MAX_PENDING + 2 {
            hold_pending(&format!("t-many-{index}"), PathBuf::from("/d"));
        }
        assert!(take_pending("t-many-0").is_none());
        assert!(take_pending(&format!("t-many-{}", MAX_PENDING + 1)).is_some());
        assert_eq!(dialog_title(Some("  ".into())), None);
        assert_eq!(dialog_title(Some(" Pick ".into())).as_deref(), Some("Pick"));
        let outcome = serde_json::to_value(ImportOutcome::Seen {
            imported_at: 5,
            notes: 2,
        })
        .unwrap();
        assert_eq!(
            outcome,
            serde_json::json!({ "kind": "seen", "importedAt": 5, "notes": 2 })
        );
        let done = serde_json::to_value(ImportOutcome::Done(ImportSummary {
            notes: 1,
            ..ImportSummary::default()
        }))
        .unwrap();
        assert_eq!(done["kind"], "done");
        assert_eq!(done["notes"], 1);
        assert_eq!(
            serde_json::to_value(ImportOutcome::Dismissed).unwrap(),
            serde_json::json!({ "kind": "dismissed" })
        );
    }

    fn library_note(id: &str) -> (String, String) {
        let dir = crate::paths::project_dir(id).unwrap();
        let meta = crate::project::read_meta(id).unwrap();
        (
            meta.name,
            std::fs::read_to_string(dir.join(crate::project::NOTE_FILE)).unwrap(),
        )
    }

    fn links_by_title(ids: &[String]) -> Vec<(String, Vec<(&'static str, String)>)> {
        let notes: Vec<(String, String, Option<String>)> = ids
            .iter()
            .map(|id| {
                let (title, text) = library_note(id);
                let note_id = scan_note(id.clone(), title.clone(), &text).note_id;
                (title, text, note_id)
            })
            .collect();
        let title_of: HashMap<String, String> = notes
            .iter()
            .filter_map(|(title, _, id)| id.clone().map(|id| (id, title.clone())))
            .collect();
        let mut listed: Vec<(String, Vec<(&'static str, String)>)> = notes
            .iter()
            .map(|(title, text, _)| {
                let links = scan_note(String::new(), String::new(), text)
                    .links
                    .into_iter()
                    .map(|link| {
                        let kind = if link.kind == LinkKind::Note {
                            "note"
                        } else {
                            "project"
                        };
                        (kind, title_of.get(&link.id).cloned().unwrap_or(link.id))
                    })
                    .collect();
                (title.clone(), links)
            })
            .collect();
        listed.sort();
        listed
    }

    #[test]
    fn finds_the_shared_folder_of_picked_files() {
        let one = PathBuf::from("/notes/Inbox/One.md");
        let two = PathBuf::from("/notes/Lab/2024/Two.md");
        assert_eq!(
            common_folder(std::slice::from_ref(&one)),
            Some(PathBuf::from("/notes/Inbox"))
        );
        assert_eq!(
            common_folder(&[one, two.clone()]),
            Some(PathBuf::from("/notes"))
        );
        assert_eq!(common_folder(&[]), None);
        assert_eq!(relative_name(Path::new("/notes"), &two), "Lab/2024/Two.md");
    }

    #[test]
    fn scans_picked_markdown_files_and_the_attachments_beside_them() {
        let root = tempfile::tempdir().unwrap();
        write(root.path(), "Inbox/One.md", b"# One\n");
        write(root.path(), "Inbox/Unpicked.md", b"# Unpicked\n");
        write(root.path(), "Inbox/data.csv", b"a,b\n");
        write(root.path(), "Inbox/pics/plot.png", b"png");
        write(root.path(), "Inbox/pics/deeper/far.png", b"png");
        write(root.path(), "Inbox/.hidden.png", b"png");
        write(root.path(), "Lab/Two.md", b"# Two\n");
        write(root.path(), "Lab/table.csv", b"a\n");
        write(root.path(), "Elsewhere/skip.png", b"png");
        write(root.path(), "Inbox/notes.txt", b"text");
        write(
            root.path(),
            "Lab/Big.md",
            &vec![b'a'; (MAX_NOTE_BYTES + 1) as usize],
        );
        let picked = [
            root.path().join("Inbox/One.md"),
            root.path().join("Lab/Two.md"),
            root.path().join("Inbox/One.md"),
            root.path().join("Inbox/notes.txt"),
            root.path().join("Lab/Big.md"),
            root.path().join("Missing.md"),
        ];
        let vault = scan_files(&picked, &AtomicBool::new(false))
            .unwrap()
            .unwrap();
        let notes: Vec<&str> = vault.notes.iter().map(|file| file.rel.as_str()).collect();
        let files: Vec<&str> = vault.files.iter().map(|file| file.rel.as_str()).collect();
        assert_eq!(notes, ["Inbox/One.md", "Lab/Two.md"]);
        assert_eq!(files, ["Inbox/pics/plot.png"]);
        assert_eq!(vault.skipped, 3);
        assert!(scan_files(&picked, &AtomicBool::new(true))
            .unwrap()
            .is_none());
        let empty = scan_files(
            &[root.path().join("Inbox/notes.txt")],
            &AtomicBool::new(false),
        )
        .unwrap()
        .unwrap();
        assert!(empty.notes.is_empty() && empty.files.is_empty());
        assert_eq!(empty.skipped, 1);
    }

    #[test]
    fn refuses_files_inside_the_library() {
        let _env_guard = crate::paths::data_dir_env_lock();
        let data = tempfile::tempdir().unwrap();
        std::env::set_var("OLEAFLY_DATA_DIR", data.path());
        let inside = crate::paths::oleafly_root()
            .unwrap()
            .join("projects/x/note.md");
        write(inside.parent().unwrap(), "note.md", b"# Inside\n");
        let refused = scan_files(&[inside], &AtomicBool::new(false)).unwrap_err();
        std::env::remove_var("OLEAFLY_DATA_DIR");
        assert_eq!(
            crate::app_error::english(&refused).as_deref(),
            Some("Choose files outside the Oleafly library.")
        );
    }

    #[test]
    fn imports_picked_markdown_files_with_their_links_and_attachments() {
        let _env_guard = crate::paths::data_dir_env_lock();
        let data = tempfile::tempdir().unwrap();
        std::env::set_var("OLEAFLY_DATA_DIR", data.path());
        let folder = tempfile::tempdir().unwrap();
        write(
            folder.path(),
            "Alpha.md",
            b"# Alpha\nSee [[Beta]] and [[Gamma]].\n![[plot.png]]\n",
        );
        write(folder.path(), "Beta.md", b"# Beta\nBack to [[Alpha]].\n");
        write(folder.path(), "Gamma.md", b"# Gamma\n");
        write(folder.path(), "plot.png", b"png-data");
        let picked = [
            folder.path().join("Alpha.md"),
            folder.path().join("Beta.md"),
        ];
        let mut events = Vec::new();
        let report = import_files_with(
            &picked,
            ImportOptions::default(),
            &AtomicBool::new(false),
            &mut |event| events.push(event),
            &|_| Ok(()),
            &CreatedNotes::default(),
        )
        .unwrap();
        assert_eq!(
            report.summary,
            ImportSummary {
                notes: 2,
                attachments: 1,
                unresolved: 1,
                skipped: 0,
                cancelled: false,
                not_copied: Vec::new(),
            }
        );
        assert_eq!(events.first().unwrap().total, 2);
        let (alpha_title, alpha) = library_note(&report.created[0]);
        let (_, beta) = library_note(&report.created[1]);
        assert_eq!(alpha_title, "Alpha");
        let beta_id = scan_note(String::new(), String::new(), &beta)
            .note_id
            .unwrap();
        assert!(
            alpha.contains(&format!("(oleafly://note/{beta_id})")),
            "{alpha}"
        );
        assert!(alpha.contains("Gamma"), "{alpha}");
        let cancelled = import_markdown_files(
            &picked,
            ImportOptions::default(),
            &AtomicBool::new(true),
            &mut |_| {},
        )
        .unwrap();
        std::env::remove_var("OLEAFLY_DATA_DIR");
        assert!(cancelled.summary.cancelled);
    }

    #[test]
    fn picked_files_copy_only_images_and_notebooks_named_beside_them() {
        let _env_guard = crate::paths::data_dir_env_lock();
        let data = tempfile::tempdir().unwrap();
        std::env::set_var("OLEAFLY_DATA_DIR", data.path());
        let folder = tempfile::tempdir().unwrap();
        write(
            folder.path(),
            "Inbox/One.md",
            b"# One\n![](pics/plot.png) ![[plot.png]] [[passport.pdf]] ![](../Lab/secret.png) [doc](doc.pdf)\n![[run.ipynb]]\n",
        );
        write(folder.path(), "Inbox/pics/plot.png", b"png-data");
        write(folder.path(), "Inbox/passport.pdf", b"secret");
        write(folder.path(), "Inbox/doc.pdf", b"doc");
        write(folder.path(), "Inbox/run.ipynb", b"{}");
        write(folder.path(), "Lab/Two.md", b"# Two\n");
        write(folder.path(), "Lab/secret.png", b"lab");
        let picked = [
            folder.path().join("Inbox/One.md"),
            folder.path().join("Lab/Two.md"),
        ];
        let journal = CreatedNotes::default();
        let report = import_files_with(
            &picked,
            ImportOptions::default(),
            &AtomicBool::new(false),
            &mut |_| {},
            &|_| Ok(()),
            &journal,
        )
        .unwrap();
        assert_eq!(journal.take(), report.created);
        assert_eq!(report.summary.notes, 2);
        assert_eq!(report.summary.attachments, 2);
        assert_eq!(report.summary.unresolved, 4);
        assert_eq!(
            report.summary.not_copied,
            ["plot.png", "passport.pdf", "../Lab/secret.png", "doc.pdf"]
        );
        let (_, one) = library_note(&report.created[0]);
        assert!(one.contains("![](assets/plot-"), "{one}");
        assert!(one.contains("```notebook\nassets/run-"), "{one}");
        assert!(one.contains("[[passport.pdf]]"), "{one}");
        let assets = crate::paths::project_dir(&report.created[0])
            .unwrap()
            .join("assets");
        let mut names: Vec<String> = std::fs::read_dir(assets)
            .unwrap()
            .flatten()
            .map(|entry| entry.file_name().to_string_lossy().into_owned())
            .filter(|name| name != "origins")
            .collect();
        names.sort();
        assert_eq!(names.len(), 2, "{names:?}");
        assert!(names
            .iter()
            .all(|name| !name.contains("pdf") && !name.starts_with("secret")));
        std::env::remove_var("OLEAFLY_DATA_DIR");
    }

    #[test]
    fn imports_a_vault_and_round_trips_through_export() {
        let _env_guard = crate::paths::data_dir_env_lock();
        let data = tempfile::tempdir().unwrap();
        std::env::set_var("OLEAFLY_DATA_DIR", data.path());
        let vault = tempfile::tempdir().unwrap();
        write(vault.path(), "Alpha.md", b"---\ntags: [x]\n---\n# Alpha\nSee [[Beta#Methods|methods]] and ![[Beta]].\n![[pics/plot.png]]\n[[Nowhere]]\n");
        write(
            vault.path(),
            "Lab/Beta.md",
            b"# Beta\n## Methods\nBack to [[Alpha]].\n[data](../data.csv)\n",
        );
        write(vault.path(), "pics/plot.png", b"png-data");
        write(vault.path(), "data.csv", b"a,b\n");
        write(vault.path(), "bad.md", &[0xff, 0xfe, 0x00]);
        write(vault.path(), ".obsidian/app.json", b"{}");
        let mut events = Vec::new();
        let report = import_vault(
            vault.path(),
            ImportOptions { folder_tags: true },
            &AtomicBool::new(false),
            &mut |event| events.push(event),
        )
        .unwrap();
        assert_eq!(
            report.summary,
            ImportSummary {
                notes: 2,
                attachments: 2,
                unresolved: 1,
                skipped: 1,
                cancelled: false,
                not_copied: Vec::new(),
            }
        );
        assert_eq!(events.len(), 5);
        assert_eq!(events[0].phase, ImportPhase::Read);
        assert_eq!(events[0].total, 3);
        assert_eq!(events.last().unwrap().phase, ImportPhase::Write);
        assert_eq!(events.last().unwrap().done, 2);
        let (alpha_title, alpha) = library_note(&report.created[0]);
        let (beta_title, beta) = library_note(&report.created[1]);
        assert_eq!(alpha_title, "Alpha");
        assert_eq!(beta_title, "Beta");
        assert!(
            alpha.starts_with("---\ntags: [x]\ntitle: Alpha\nkind: note\nid: "),
            "{alpha}"
        );
        assert!(beta.contains("tags:\n  - Lab\n"), "{beta}");
        let beta_id = scan_note(String::new(), String::new(), &beta)
            .note_id
            .unwrap();
        assert!(
            alpha.contains(&format!("[methods](oleafly://note/{beta_id}#methods)")),
            "{alpha}"
        );
        assert!(
            alpha.contains(&format!("![Beta](oleafly://note/{beta_id})")),
            "{alpha}"
        );
        assert!(alpha.contains("![plot.png](assets/plot-"), "{alpha}");
        assert!(alpha.contains("[[Nowhere]]"), "{alpha}");
        let alpha_dir = crate::paths::project_dir(&report.created[0]).unwrap();
        let assets: Vec<String> = std::fs::read_dir(alpha_dir.join("assets"))
            .unwrap()
            .flatten()
            .map(|entry| entry.file_name().to_string_lossy().into_owned())
            .collect();
        assert_eq!(assets.len(), 2, "{assets:?}");
        let origin_name = assets
            .iter()
            .find(|name| name.as_str() != "origins")
            .unwrap();
        let origin =
            std::fs::read_to_string(alpha_dir.join(format!("assets/origins/{origin_name}.json")))
                .unwrap();
        assert!(origin.contains("\"fileName\": \"plot.png\""), "{origin}");
        assert!(
            !origin.contains(&vault.path().to_string_lossy().into_owned()),
            "{origin}"
        );

        let (selected, outside) = collect_export(None).unwrap();
        assert!(outside.is_empty());
        let out = tempfile::tempdir().unwrap();
        let exported = export_notes(&selected, &outside, out.path()).unwrap();
        assert_eq!(exported.notes, 2);
        assert_eq!(exported.attachments, 2);
        let alpha_md = std::fs::read_to_string(out.path().join("Alpha.md")).unwrap();
        assert!(
            alpha_md.contains("See [[Beta#Methods|methods]] and ![[Beta]]."),
            "{alpha_md}"
        );
        assert!(alpha_md.contains("![[plot.png]]"), "{alpha_md}");
        assert!(!alpha_md.contains("id: "), "{alpha_md}");
        let beta_md = std::fs::read_to_string(out.path().join("Beta.md")).unwrap();
        assert!(beta_md.contains("Back to [[Alpha]]."), "{beta_md}");
        assert!(beta_md.contains("[[data.csv|data]]"), "{beta_md}");
        assert!(out.path().join("attachments/plot.png").is_file());

        let before = links_by_title(&report.created);
        let again = import_vault(
            out.path(),
            ImportOptions::default(),
            &AtomicBool::new(false),
            &mut |_| {},
        )
        .unwrap();
        assert_eq!(again.summary.notes, 2);
        assert_eq!(again.summary.unresolved, 1);
        assert_eq!(links_by_title(&again.created), before);
        let (_, alpha_again) = library_note(&again.created[0]);
        let asset_line = |text: &str| {
            text.lines()
                .find(|line| line.contains("assets/plot-"))
                .map(str::to_string)
        };
        assert_eq!(asset_line(&alpha_again), asset_line(&alpha));

        let single = tempfile::tempdir().unwrap();
        let (one, outside) = collect_export(Some(&report.created[1])).unwrap();
        assert_eq!(one.len(), 1);
        assert_eq!(outside.len(), 1);
        export_notes(&one, &outside, single.path()).unwrap();
        assert!(std::fs::read_to_string(single.path().join("Beta.md"))
            .unwrap()
            .contains("[[Alpha]]"));
        assert!(collect_export(Some("missing-note")).is_err());
        std::env::remove_var("OLEAFLY_DATA_DIR");
    }

    #[test]
    fn stops_when_cancelled() {
        let _env_guard = crate::paths::data_dir_env_lock();
        let data = tempfile::tempdir().unwrap();
        std::env::set_var("OLEAFLY_DATA_DIR", data.path());
        let vault = tempfile::tempdir().unwrap();
        write(vault.path(), "One.md", b"1");
        write(vault.path(), "Two.md", b"2");
        write(vault.path(), "Three.md", b"3");
        let cancel = AtomicBool::new(true);
        let report =
            import_vault(vault.path(), ImportOptions::default(), &cancel, &mut |_| {}).unwrap();
        assert!(report.summary.cancelled);
        assert!(report.created.is_empty());
        let cancel = AtomicBool::new(false);
        let report = import_vault(
            vault.path(),
            ImportOptions::default(),
            &cancel,
            &mut |event| {
                if event.phase == ImportPhase::Read && event.done == 2 {
                    cancel.store(true, Ordering::SeqCst);
                }
            },
        )
        .unwrap();
        assert!(report.summary.cancelled);
        assert!(report.created.is_empty());
        let cancel = AtomicBool::new(false);
        let report = import_vault(
            vault.path(),
            ImportOptions::default(),
            &cancel,
            &mut |event| {
                if event.phase == ImportPhase::Write {
                    cancel.store(true, Ordering::SeqCst);
                }
            },
        )
        .unwrap();
        assert!(report.summary.cancelled);
        assert_eq!(report.created.len(), 1);
        assert_eq!(report.summary.notes, 0);
        std::env::remove_var("OLEAFLY_DATA_DIR");
    }
}
