use std::collections::hash_map::DefaultHasher;
use std::collections::BTreeMap;
use std::hash::{Hash, Hasher};
use std::path::{Component, Path, PathBuf};

use oleafly_core::typst_toolchain::ToolchainVersion;

use crate::synctex::SynctexRect;

pub(super) const MIN_SYNC_TINYMIST: (u64, u64, u64) = (0, 13, 30);
const FORWARD_ASCENT: f64 = 9.0;
const FORWARD_HEIGHT: f64 = 12.0;
const FORWARD_WIDTH: f64 = 96.0;
const CURSOR_LINE_CANDIDATES: usize = 4;
const NEIGHBOUR_LINE_CANDIDATES: usize = 2;
const NEIGHBOUR_LINE_REACH: usize = 3;
pub(super) const MAX_FORWARD_PROBES: usize = 8;
const INVERSE_OFFSETS: [(f64, f64); 7] = [
    (0.0, 0.0),
    (0.0, -4.0),
    (0.0, 4.0),
    (0.0, -8.0),
    (0.0, 8.0),
    (-6.0, 0.0),
    (6.0, 0.0),
];

pub(super) fn tinymist_supports_sync(version: &ToolchainVersion) -> bool {
    (version.major, version.minor, version.patch) >= MIN_SYNC_TINYMIST
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum CompileStatus {
    Compiling,
    Success,
    Error,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub(super) struct DocumentPoint {
    pub(super) page: u32,
    pub(super) x: f64,
    pub(super) y: f64,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) struct SourcePoint {
    pub(super) filepath: String,
    pub(super) line: u32,
    pub(super) character: u32,
}

#[derive(Clone, Debug, PartialEq)]
pub(super) enum PreviewEvent {
    Jump(DocumentPoint),
    EditorScrollTo(SourcePoint),
    Compile(CompileStatus),
    Closed,
}

pub(super) fn parse_data_message(bytes: &[u8]) -> Option<PreviewEvent> {
    let rest = bytes.strip_prefix(b"jump,")?;
    let text = std::str::from_utf8(rest).ok()?;
    let mut parts = text.split_whitespace();
    let page: u32 = parts.next()?.parse().ok()?;
    let x: f64 = parts.next()?.parse().ok()?;
    let y: f64 = parts.next()?.parse().ok()?;
    if page == 0 || !x.is_finite() || !y.is_finite() || parts.next().is_some() {
        return None;
    }
    Some(PreviewEvent::Jump(DocumentPoint { page, x, y }))
}

fn position_pair(value: &serde_json::Value) -> Option<(u32, u32)> {
    let pair = value.as_array()?;
    if pair.len() != 2 {
        return None;
    }
    let line = u32::try_from(pair[0].as_u64()?).ok()?;
    let character = u32::try_from(pair[1].as_u64()?).ok()?;
    Some((line, character))
}

pub(super) fn parse_control_message(bytes: &[u8]) -> Option<PreviewEvent> {
    let value: serde_json::Value = serde_json::from_slice(bytes).ok()?;
    match value.get("event")?.as_str()? {
        "editorScrollTo" => {
            let filepath = value.get("filepath")?.as_str()?.to_owned();
            let (line, character) = position_pair(value.get("start")?)?;
            Some(PreviewEvent::EditorScrollTo(SourcePoint {
                filepath,
                line,
                character,
            }))
        }
        "compileStatus" => match value.get("kind")?.as_str()? {
            "Compiling" => Some(PreviewEvent::Compile(CompileStatus::Compiling)),
            "CompileSuccess" => Some(PreviewEvent::Compile(CompileStatus::Success)),
            "CompileError" => Some(PreviewEvent::Compile(CompileStatus::Error)),
            _ => None,
        },
        _ => None,
    }
}

pub(super) fn panel_scroll_to(filepath: &str, line: usize, character: usize) -> String {
    serde_json::json!({
        "event": "panelScrollTo",
        "filepath": filepath,
        "line": line,
        "character": character,
    })
    .to_string()
}

pub(super) fn src_point(point: DocumentPoint) -> String {
    format!(
        "src-point {}",
        serde_json::json!({
            "page_no": point.page,
            "x": point.x,
            "y": point.y,
        })
    )
}

pub(super) fn sync_memory_files(files: &BTreeMap<String, String>) -> String {
    serde_json::json!({
        "event": "syncMemoryFiles",
        "files": files,
    })
    .to_string()
}

pub(super) fn sources_fingerprint(files: &BTreeMap<String, String>) -> Option<u64> {
    if files.is_empty() {
        return None;
    }
    let mut hasher = DefaultHasher::new();
    files.hash(&mut hasher);
    Some(hasher.finish())
}

pub(super) fn source_lines(text: &str) -> Vec<&str> {
    text.split('\n')
        .map(|line| line.strip_suffix('\r').unwrap_or(line))
        .collect()
}

pub(super) fn utf16_to_char_column(line: &str, utf16: usize) -> usize {
    let mut units = 0;
    for (index, character) in line.chars().enumerate() {
        if units >= utf16 {
            return index;
        }
        units += character.len_utf16();
    }
    line.chars().count()
}

pub(super) fn char_to_utf16_column(line: &str, chars: usize) -> usize {
    line.chars().take(chars).map(char::len_utf16).sum()
}

fn word_ranges(chars: &[char]) -> Vec<(usize, usize)> {
    let mut ranges = Vec::new();
    let mut index = 0;
    while index < chars.len() {
        if !chars[index].is_alphanumeric() {
            index += 1;
            continue;
        }
        let start = index;
        while index < chars.len() && chars[index].is_alphanumeric() {
            index += 1;
        }
        let call = start > 0 && chars[start - 1] == '#';
        let number = chars[start..index].iter().all(char::is_ascii_digit);
        if !call && !number {
            ranges.push((start, index));
        }
    }
    ranges
}

fn code_line(line: &str) -> bool {
    line.trim_start().starts_with('#') && !line.contains('[')
}

fn line_candidates(line: &str, cursor: Option<usize>, limit: usize) -> Vec<usize> {
    if code_line(line) {
        return Vec::new();
    }
    let chars: Vec<char> = line.chars().collect();
    let mut columns = Vec::new();
    if let Some(cursor) = cursor.filter(|cursor| *cursor > 0 && *cursor <= chars.len()) {
        if chars[cursor - 1].is_alphanumeric() {
            columns.push(cursor);
        }
    }
    let mut middles: Vec<usize> = word_ranges(&chars)
        .into_iter()
        .map(|(start, end)| start + (end - start).div_ceil(2))
        .collect();
    if let Some(cursor) = cursor {
        middles.sort_by_key(|middle| middle.abs_diff(cursor));
    }
    for middle in middles {
        if columns.len() >= limit {
            break;
        }
        if !columns.contains(&middle) {
            columns.push(middle);
        }
    }
    columns.truncate(limit);
    columns
}

pub(super) fn forward_candidates(
    text: &str,
    line: usize,
    utf16_column: Option<usize>,
) -> Vec<(usize, usize)> {
    let lines = source_lines(text);
    let Some(current) = lines.get(line) else {
        return Vec::new();
    };
    let cursor = utf16_column.map(|column| utf16_to_char_column(current, column));
    let mut candidates: Vec<(usize, usize)> =
        line_candidates(current, cursor, CURSOR_LINE_CANDIDATES)
            .into_iter()
            .map(|column| (line, column))
            .collect();
    for distance in 1..=NEIGHBOUR_LINE_REACH {
        let neighbours = [line.checked_add(distance), line.checked_sub(distance)];
        for neighbour in neighbours.into_iter().flatten() {
            let Some(text) = lines.get(neighbour) else {
                continue;
            };
            candidates.extend(
                line_candidates(text, None, NEIGHBOUR_LINE_CANDIDATES)
                    .into_iter()
                    .map(|column| (neighbour, column)),
            );
        }
    }
    candidates.truncate(MAX_FORWARD_PROBES);
    candidates
}

pub(super) fn rect_for_jump(point: DocumentPoint) -> SynctexRect {
    SynctexRect {
        page: i32::try_from(point.page).unwrap_or(i32::MAX),
        x: point.x.max(0.0),
        y: (point.y - FORWARD_ASCENT).max(0.0),
        width: FORWARD_WIDTH,
        height: FORWARD_HEIGHT,
    }
}

pub(super) fn inverse_probes(point: DocumentPoint) -> Vec<DocumentPoint> {
    INVERSE_OFFSETS
        .iter()
        .map(|(dx, dy)| DocumentPoint {
            page: point.page,
            x: (point.x + dx).max(0.0),
            y: (point.y + dy).max(0.0),
        })
        .collect()
}

pub(super) fn validate_relative(path: &str) -> Option<PathBuf> {
    if path.is_empty() || path.contains('\0') || path.contains('\\') {
        return None;
    }
    let candidate = Path::new(path);
    let mut clean = PathBuf::new();
    for component in candidate.components() {
        match component {
            Component::Normal(part) => clean.push(part),
            _ => return None,
        }
    }
    (!clean.as_os_str().is_empty()).then_some(clean)
}

pub(super) fn relative_source(filepath: &Path, roots: &[PathBuf]) -> Option<String> {
    roots.iter().find_map(|root| {
        let relative = filepath.strip_prefix(root).ok()?;
        let parts: Vec<String> = relative
            .components()
            .map(|component| match component {
                Component::Normal(part) => part.to_str().map(str::to_owned),
                _ => None,
            })
            .collect::<Option<_>>()?;
        (!parts.is_empty()).then(|| parts.join("/"))
    })
}
