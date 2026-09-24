use crate::tree::slash_path;
use aho_corasick::{AhoCorasick, MatchKind};
use memchr::memmem;
use std::collections::HashSet;
use std::fs::File;
use std::io::{BufReader, Read};
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

pub const MAX_IMAGE_CARDS: usize = 2;
pub const ASK_AI_ERROR_BUDGET: usize = 8;

const NOTE_OPENERS: [&str; 2] = ["[Oleafly] The image ", "[Oleafly] One of the "];
const LIBPNG_ERROR: &[u8] = b"libpng error";
const FATAL_MARKER: &[u8] = b":fatal:";
const MAX_ERROR_LINES: usize = 4096;
const MAX_SIGNALS_PER_LINE: usize = 64;
const MAX_NAMES: usize = 32;
const MAX_NAME_BYTES: usize = 1024;
const MAX_OPENED: usize = 256;
const MAX_SOURCE_FILES: usize = 64;
const MAX_SOURCE_BYTES: u64 = 4 * 1024 * 1024;
const MAX_SOURCE_FILE_BYTES: u64 = 1024 * 1024;
const MAX_REFERENCES: usize = 512;
const MAX_GRAPHICS_PATHS: usize = 16;
const MAX_PATH_PROBES: usize = 2048;
const MAX_GROUP_BYTES: usize = 1024;
const MAX_IMAGE_CHECKS: usize = 128;
const MAX_SCAN_BYTES: u64 = 32 * 1024 * 1024;
const MAX_FILE_DATA_BYTES: u64 = 16 * 1024 * 1024;
const READ_COST: u64 = 64;
const MAX_PNG_CHUNKS: usize = 10_000;
const MAX_JPEG_SEGMENTS: usize = 1_000;
const MAX_JPEG_FILL_BYTES: usize = 64;
const TEX_LINE_WIDTH: usize = 79;
const MAX_WRAPPED_LINES: usize = 4;
const SNIFF_BYTES: u64 = 1024;
const PDF_TAIL_BYTES: u64 = 64 * 1024;
const PDF_STRUCTURE: [&[u8]; 3] = [b"startxref", b"trailer", b"/XRef"];
const READ_BUFFER_BYTES: usize = 64 * 1024;
const PNG_SIGNATURE: [u8; 8] = [0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a];
const LFS_POINTER: &[u8] = b"version https://git-lfs.github.com/spec/";
const REFERENCE_EXTENSIONS: [&str; 8] = ["pdf", "png", "jpg", "jpeg", "PDF", "PNG", "JPG", "JPEG"];
const EXPORT_OR_REPLACE: &str = "Export the image again or replace the file.";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Signal {
    Quoted(char),
    File,
    Png,
    StrictPng,
    Jpeg,
    Pdf,
    AnyImage,
}

const SIGNALS: [(&str, Signal); 15] = [
    ("unable to load picture or pdf file '", Signal::Quoted('\'')),
    ("image inclusion failed for \"", Signal::Quoted('"')),
    ("(file ", Signal::File),
    ("libpng error", Signal::StrictPng),
    ("error reading png", Signal::StrictPng),
    ("libpng: ", Signal::Png),
    ("(readpng)", Signal::Png),
    ("(writepng)", Signal::Png),
    ("writepng: ", Signal::Png),
    ("reading jpeg image failed", Signal::Jpeg),
    ("(readjpg)", Signal::Jpeg),
    ("reading pdf image failed", Signal::Pdf),
    ("(pdf inclusion)", Signal::Pdf),
    ("reading image file failed", Signal::AnyImage),
    ("invalid image dimensions", Signal::AnyImage),
];

fn signals() -> &'static AhoCorasick {
    static SEARCHER: OnceLock<AhoCorasick> = OnceLock::new();
    SEARCHER.get_or_init(|| {
        AhoCorasick::builder()
            .ascii_case_insensitive(true)
            .match_kind(MatchKind::LeftmostFirst)
            .build(SIGNALS.iter().map(|(pattern, _)| pattern))
            .expect("image failure signals are valid patterns")
    })
}

fn chunk_crc(kind: &[u8; 4], data: &[u8]) -> u32 {
    let mut hasher = crc32fast::Hasher::new();
    hasher.update(kind);
    hasher.update(data);
    hasher.finalize()
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum ImageFormat {
    Png,
    Jpeg,
    Pdf,
}

impl ImageFormat {
    fn from_path(path: &Path) -> Option<Self> {
        let extension = path.extension()?.to_str()?.to_ascii_lowercase();
        match extension.as_str() {
            "png" => Some(Self::Png),
            "jpg" | "jpeg" => Some(Self::Jpeg),
            "pdf" => Some(Self::Pdf),
            _ => None,
        }
    }

    fn label(self) -> &'static str {
        match self {
            Self::Png => "PNG",
            Self::Jpeg => "JPEG",
            Self::Pdf => "PDF",
        }
    }

    fn noun(self) -> &'static str {
        match self {
            Self::Png => "PNG image",
            Self::Jpeg => "JPEG image",
            Self::Pdf => "PDF file",
        }
    }

    fn extension(self) -> &'static str {
        match self {
            Self::Png => "png",
            Self::Jpeg => "jpg",
            Self::Pdf => "pdf",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ImageContent {
    Image(ImageFormat),
    WebPage,
    Svg,
    Text,
    LfsPointer,
    Gif,
    Tiff,
    Webp,
    Heic,
    Avif,
    Eps,
    Unknown,
}

impl ImageContent {
    fn description(self) -> Option<&'static str> {
        match self {
            Self::Svg => Some("an SVG drawing"),
            Self::Text => Some("plain text"),
            Self::Gif => Some("a GIF image"),
            Self::Tiff => Some("a TIFF image"),
            Self::Webp => Some("a WebP image"),
            Self::Heic => Some("a HEIC photo"),
            Self::Avif => Some("an AVIF image"),
            Self::Eps => Some("an EPS drawing"),
            Self::Image(_) | Self::WebPage | Self::LfsPointer | Self::Unknown => None,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ImageProblem {
    Empty,
    Truncated(ImageFormat),
    Corrupt(ImageFormat),
    WrongContent {
        expected: ImageFormat,
        found: ImageContent,
    },
}

impl ImageProblem {
    fn rejected_by_every_engine(self) -> bool {
        match self {
            Self::Empty | Self::Truncated(_) | Self::Corrupt(_) => true,
            Self::WrongContent { found, .. } => !matches!(
                found,
                ImageContent::Image(_) | ImageContent::Eps | ImageContent::Unknown
            ),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct BrokenImage {
    pub path: String,
    pub problem: ImageProblem,
}

impl BrokenImage {
    pub fn message(&self) -> String {
        let path = &self.path;
        match self.problem {
            ImageProblem::Empty => format!("The image {path} is empty. {EXPORT_OR_REPLACE}"),
            ImageProblem::Truncated(_) => format!(
                "The image {path} is incomplete. Part of the file is missing, which can happen when a download or copy stops early. {EXPORT_OR_REPLACE}"
            ),
            ImageProblem::Corrupt(_) => {
                format!("The image {path} is damaged and cannot be read. {EXPORT_OR_REPLACE}")
            }
            ImageProblem::WrongContent {
                expected,
                found: ImageContent::Image(found),
            } => format!(
                "The image {path} contains a {} instead of a {}. Rename it to end in .{}, or export it again as {}.",
                found.noun(),
                expected.label(),
                found.extension(),
                expected.label()
            ),
            ImageProblem::WrongContent {
                found: ImageContent::LfsPointer,
                ..
            } => format!(
                "The image {path} is a Git LFS placeholder instead of the real image. Run git lfs pull to download it, or replace the file."
            ),
            ImageProblem::WrongContent {
                expected,
                found: ImageContent::WebPage,
            } => format!(
                "The image {path} contains a web page instead of a {}. This usually happens when a download returns an error page. Download or export the image again.",
                expected.label()
            ),
            ImageProblem::WrongContent { expected, found } => match found.description() {
                Some(description) => format!(
                    "The image {path} contains {description} instead of a {}. Export it again as {}.",
                    expected.label(),
                    expected.label()
                ),
                None => format!(
                    "The image {path} is not a readable {} file. Export it again as {} or replace the file.",
                    expected.label(),
                    expected.label()
                ),
            },
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ImageFinding {
    Broken(BrokenImage),
    Unidentified(Option<ImageFormat>),
}

impl ImageFinding {
    pub fn message(&self) -> String {
        match self {
            Self::Broken(image) => image.message(),
            Self::Unidentified(Some(format)) => format!(
                "One of the {} images in this document is damaged and stopped the compile. Oleafly could not tell which one. Export the document's {} images again, or replace the damaged one.",
                format.label(),
                format.label()
            ),
            Self::Unidentified(None) => "One of the images in this document is damaged and stopped the compile. Oleafly could not tell which one. Export the document's images again, or replace the damaged one.".to_string(),
        }
    }

    pub fn names_a_file(&self) -> bool {
        matches!(self, Self::Broken(_))
    }
}

pub fn image_failure_notes(findings: &[ImageFinding]) -> String {
    findings
        .iter()
        .map(|finding| format!("\n[Oleafly] {}\n", finding.message()))
        .collect()
}

pub(crate) fn is_image_note(line: &str) -> bool {
    NOTE_OPENERS.iter().any(|opener| line.starts_with(opener))
}

pub fn image_findings_lead(findings: &[ImageFinding], genuine_errors: usize) -> bool {
    !findings.is_empty()
        && findings.iter().all(ImageFinding::names_a_file)
        && genuine_errors + findings.len() <= ASK_AI_ERROR_BUDGET
}

pub fn place_image_findings<T>(
    errors: &mut Vec<T>,
    findings: &[ImageFinding],
    is_error: impl Fn(&T) -> bool,
    card: impl Fn(String) -> T,
) {
    let genuine = errors.iter().filter(|error| is_error(error)).count();
    let at = if image_findings_lead(findings, genuine) {
        0
    } else {
        errors.len()
    };
    errors.splice(
        at..at,
        findings.iter().map(|finding| card(finding.message())),
    );
}

pub fn diagnose_image_failures(
    project_root: &Path,
    main_document: Option<&str>,
    log: &str,
) -> Vec<ImageFinding> {
    image_failure_evidence(log)
        .map(|evidence| evidence.diagnose(project_root, main_document))
        .unwrap_or_default()
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct ImageEvidence {
    named: Vec<String>,
    formats: Vec<ImageFormat>,
    any_format: bool,
    strict_png: bool,
    opened: Vec<String>,
}

pub fn image_failure_evidence(log: &str) -> Option<ImageEvidence> {
    let log = crate::compile_log::head(log);
    if !has_image_error(log) {
        return None;
    }
    let mut evidence = ImageEvidence::default();
    for line in error_lines(log).into_iter().take(MAX_ERROR_LINES) {
        evidence.read_error_line(&line.joined(log));
    }
    evidence.opened = opened_images(log);
    (!evidence.named.is_empty() || evidence.hinted()).then_some(evidence)
}

fn has_image_error(log: &str) -> bool {
    let bytes = log.as_bytes();
    if memmem::find(bytes, LIBPNG_ERROR).is_some() {
        return true;
    }
    let mut floor = 0;
    for at in memmem::find_iter(bytes, FATAL_MARKER) {
        if at < floor {
            continue;
        }
        let line = LogicalLine::around(log, at, floor);
        floor = line.end;
        if line.has_image_signal(log) {
            return true;
        }
    }
    line_starts(bytes).any(|start| {
        starts_as_error(&log[start..]) && LogicalLine::from_start(log, start).has_image_signal(log)
    })
}

fn error_lines(log: &str) -> Vec<LogicalLine> {
    let bytes = log.as_bytes();
    let mut lines = Vec::new();
    for marker in [LIBPNG_ERROR, FATAL_MARKER] {
        let mut floor = 0;
        for at in memmem::find_iter(bytes, marker) {
            if at < floor {
                continue;
            }
            let line = LogicalLine::around(log, at, floor);
            floor = line.end;
            lines.push(line);
        }
    }
    lines.extend(
        line_starts(bytes)
            .filter(|start| starts_as_error(&log[*start..]))
            .map(|start| LogicalLine::from_start(log, start)),
    );
    lines.sort_by_key(|line| line.start);
    lines.dedup_by_key(|line| line.start);
    lines
}

fn line_starts(bytes: &[u8]) -> impl Iterator<Item = usize> + '_ {
    std::iter::once(0)
        .chain(memchr::memchr_iter(b'\n', bytes).map(|index| index + 1))
        .filter(move |start| *start < bytes.len())
}

#[derive(Clone, Copy, Debug)]
struct LogicalLine {
    start: usize,
    end: usize,
}

impl LogicalLine {
    fn from_start(log: &str, start: usize) -> Self {
        Self::around(log, start, start)
    }

    fn around(log: &str, offset: usize, floor: usize) -> Self {
        let bytes = log.as_bytes();
        let physical_start =
            memchr::memrchr(b'\n', &bytes[floor..offset]).map_or(floor, |index| floor + index + 1);
        let mut start = physical_start;
        for _ in 0..MAX_WRAPPED_LINES {
            if start <= floor {
                break;
            }
            let previous_end = start - 1;
            let window = previous_end
                .saturating_sub(4 * TEX_LINE_WIDTH + 2)
                .max(floor);
            let previous_start = match memchr::memrchr(b'\n', &bytes[window..previous_end]) {
                Some(index) => window + index + 1,
                None if window == floor => floor,
                None => break,
            };
            if !is_wrapped(&log[previous_start..previous_end]) {
                break;
            }
            start = previous_start;
        }
        let mut end = physical_end(bytes, offset);
        let mut line_start = physical_start;
        for _ in 0..MAX_WRAPPED_LINES {
            if end >= bytes.len() || !is_wrapped(&log[line_start..end]) {
                break;
            }
            line_start = end + 1;
            end = physical_end(bytes, line_start);
        }
        Self { start, end }
    }

    fn has_image_signal(self, log: &str) -> bool {
        let raw = &log[self.start..self.end];
        if raw.contains('\n') {
            signals().is_match(&self.joined(log))
        } else {
            signals().is_match(raw)
        }
    }

    fn joined(self, log: &str) -> String {
        log[self.start..self.end]
            .split('\n')
            .map(|part| part.strip_suffix('\r').unwrap_or(part))
            .collect()
    }
}

fn physical_end(bytes: &[u8], from: usize) -> usize {
    memchr::memchr(b'\n', &bytes[from..]).map_or(bytes.len(), |index| from + index)
}

fn is_wrapped(line: &str) -> bool {
    let line = line.strip_suffix('\r').unwrap_or(line);
    line.len() >= TEX_LINE_WIDTH
        && line.len() <= 4 * TEX_LINE_WIDTH
        && line.chars().count() == TEX_LINE_WIDTH
}

fn starts_as_error(text: &str) -> bool {
    let trimmed = text.trim_start_matches([' ', '\t']);
    trimmed.starts_with('!')
        || trimmed
            .get(..5)
            .is_some_and(|prefix| prefix.eq_ignore_ascii_case("error"))
}

impl ImageEvidence {
    fn read_error_line(&mut self, text: &str) {
        let mut hints = Vec::new();
        let mut named = false;
        for found in signals().find_iter(text).take(MAX_SIGNALS_PER_LINE) {
            let rest = &text[found.end()..];
            let name = match SIGNALS[found.pattern().as_usize()].1 {
                Signal::Quoted(quote) => {
                    let name = quoted_name(rest, quote);
                    if name.is_none() {
                        hints.push(None);
                    }
                    name
                }
                Signal::File => file_name(rest),
                Signal::StrictPng => {
                    self.strict_png = true;
                    hints.push(Some(ImageFormat::Png));
                    None
                }
                Signal::Png => {
                    hints.push(Some(ImageFormat::Png));
                    None
                }
                Signal::Jpeg => {
                    hints.push(Some(ImageFormat::Jpeg));
                    None
                }
                Signal::Pdf => {
                    hints.push(Some(ImageFormat::Pdf));
                    None
                }
                Signal::AnyImage => {
                    hints.push(None);
                    None
                }
            };
            if let Some(name) = name {
                named = true;
                self.name(name);
            }
        }
        if named {
            return;
        }
        for hint in hints {
            match hint {
                Some(format) if !self.formats.contains(&format) => self.formats.push(format),
                Some(_) => {}
                None => self.any_format = true,
            }
        }
    }

    fn name(&mut self, name: String) {
        if self.named.len() < MAX_NAMES && !self.named.contains(&name) {
            self.named.push(name);
        }
    }

    fn hinted(&self) -> bool {
        self.any_format || !self.formats.is_empty()
    }

    pub fn diagnose(&self, project_root: &Path, main_document: Option<&str>) -> Vec<ImageFinding> {
        let Ok(root) = project_root.canonicalize() else {
            return Vec::new();
        };
        let mut budget = Budget::new(MAX_SCAN_BYTES);
        let mut checked = HashSet::new();
        let mut findings = Vec::new();
        let mut formats = self.formats.clone();
        let mut any_format = self.any_format;
        for name in &self.named {
            let Some(file) = resolve_in(&root, name) else {
                match ImageFormat::from_path(Path::new(name)) {
                    Some(format) if !formats.contains(&format) => formats.push(format),
                    Some(_) => {}
                    None => any_format = true,
                }
                continue;
            };
            let Some(declared) = ImageFormat::from_path(&file) else {
                continue;
            };
            if findings.len() >= MAX_IMAGE_CARDS || !checked.insert(file.clone()) {
                continue;
            }
            if let Some(problem) = inspect(&file, declared, true, &mut budget) {
                findings.push(broken(&root, &file, problem));
            }
        }
        if (any_format || !formats.is_empty()) && findings.len() < MAX_IMAGE_CARDS {
            let wanted = |format: ImageFormat| any_format || formats.contains(&format);
            for file in self.candidates(&root, main_document) {
                if findings.len() >= MAX_IMAGE_CARDS || checked.len() >= MAX_IMAGE_CHECKS {
                    break;
                }
                let Some(declared) = ImageFormat::from_path(&file).filter(|format| wanted(*format))
                else {
                    continue;
                };
                if !checked.insert(file.clone()) {
                    continue;
                }
                match inspect(&file, declared, self.strict_png, &mut budget) {
                    Some(problem) if problem.rejected_by_every_engine() => {
                        findings.push(broken(&root, &file, problem));
                    }
                    _ => {}
                }
            }
        }
        if findings.is_empty() && self.named.is_empty() && self.hinted() {
            let format = match self.formats.as_slice() {
                [format] if !self.any_format => Some(*format),
                _ => None,
            };
            findings.push(ImageFinding::Unidentified(format));
        }
        findings
    }

    fn candidates(&self, root: &Path, main_document: Option<&str>) -> Vec<PathBuf> {
        let mut probes = MAX_PATH_PROBES;
        let mut seen = HashSet::new();
        let mut files = Vec::new();
        for name in &self.opened {
            if let Some(file) = probe(root, name, &mut probes) {
                if seen.insert(file.clone()) {
                    files.push(file);
                }
            }
        }
        for file in document_images(root, main_document, &mut probes) {
            if seen.insert(file.clone()) {
                files.push(file);
            }
        }
        files
    }
}

fn broken(root: &Path, file: &Path, problem: ImageProblem) -> ImageFinding {
    ImageFinding::Broken(BrokenImage {
        path: slash_path(file.strip_prefix(root).unwrap_or(file)),
        problem,
    })
}

fn name_window(rest: &str) -> &str {
    let mut end = rest.len().min(MAX_NAME_BYTES + 8);
    while !rest.is_char_boundary(end) {
        end -= 1;
    }
    &rest[..end]
}

fn quoted_name(rest: &str, quote: char) -> Option<String> {
    let window = name_window(rest);
    let end = window.rfind(quote)?;
    clean_name(&window[..end])
}

fn file_name(rest: &str) -> Option<String> {
    let window = name_window(rest);
    window
        .match_indices(')')
        .map(|(index, _)| &window[..index])
        .find(|name| ImageFormat::from_path(Path::new(name.trim())).is_some())
        .and_then(clean_name)
}

fn clean_name(raw: &str) -> Option<String> {
    let name = raw.trim();
    let name = name
        .strip_prefix('"')
        .and_then(|inner| inner.strip_suffix('"'))
        .unwrap_or(name)
        .trim();
    (!name.is_empty() && name.len() <= MAX_NAME_BYTES && !name.chars().any(char::is_control))
        .then(|| name.to_string())
}

fn opened_images(log: &str) -> Vec<String> {
    const OPENER: &str = "File: ";
    const MARKER: &str = " Graphic file (type ";
    let mut names = Vec::new();
    for index in memmem::find_iter(log.as_bytes(), OPENER.as_bytes()) {
        if names.len() >= MAX_OPENED {
            break;
        }
        if index > 0 && log.as_bytes()[index - 1] != b'\n' {
            continue;
        }
        let text = LogicalLine::around(log, index, index).joined(log);
        let Some(end) = text.find(MARKER) else {
            continue;
        };
        if let Some(name) = clean_name(&text[OPENER.len()..end]) {
            if !names.contains(&name) {
                names.push(name);
            }
        }
    }
    names
}

fn resolve_in(root: &Path, name: &str) -> Option<PathBuf> {
    let candidate = Path::new(name);
    let joined = if candidate.is_absolute() {
        candidate.to_path_buf()
    } else {
        root.join(candidate)
    };
    if !joined.is_file() {
        return None;
    }
    let resolved = joined.canonicalize().ok()?;
    resolved.starts_with(root).then_some(resolved)
}

fn probe(root: &Path, name: &str, probes: &mut usize) -> Option<PathBuf> {
    *probes = probes.checked_sub(1)?;
    resolve_in(root, name)
}

fn document_images(root: &Path, main_document: Option<&str>, probes: &mut usize) -> Vec<PathBuf> {
    let Some(main) = main_document.and_then(|main| probe(root, main, probes)) else {
        return Vec::new();
    };
    let mut sources = vec![main.clone()];
    let mut visited = HashSet::from([main]);
    let mut references = Vec::new();
    let mut graphics_paths = Vec::new();
    let mut remaining = MAX_SOURCE_BYTES;
    let mut next = 0;
    while next < sources.len() && remaining > 0 {
        let Some(text) = read_source(&sources[next], &mut remaining) else {
            next += 1;
            continue;
        };
        next += 1;
        let scan = scan_source(&text);
        for input in scan.inputs {
            if sources.len() >= MAX_SOURCE_FILES {
                break;
            }
            let has_extension = Path::new(&input).extension().is_some();
            let names = if has_extension {
                vec![input.clone()]
            } else {
                vec![format!("{input}.tex"), input.clone()]
            };
            if let Some(file) = names.iter().find_map(|name| probe(root, name, probes)) {
                if visited.insert(file.clone()) {
                    sources.push(file);
                }
            }
        }
        for path in scan.graphics_paths {
            if graphics_paths.len() < MAX_GRAPHICS_PATHS && !graphics_paths.contains(&path) {
                graphics_paths.push(path);
            }
        }
        for reference in scan.images {
            if references.len() < MAX_REFERENCES && !references.contains(&reference) {
                references.push(reference);
            }
        }
    }
    let mut seen = HashSet::new();
    references
        .iter()
        .filter_map(|reference| resolve_reference(root, reference, &graphics_paths, probes))
        .filter(|file| seen.insert(file.clone()))
        .collect()
}

fn read_source(path: &Path, remaining: &mut u64) -> Option<String> {
    let limit = MAX_SOURCE_FILE_BYTES.min(*remaining);
    let mut bytes = Vec::new();
    File::open(path)
        .ok()?
        .take(limit)
        .read_to_end(&mut bytes)
        .ok()?;
    *remaining = remaining.saturating_sub(bytes.len() as u64);
    Some(String::from_utf8_lossy(&bytes).into_owned())
}

fn resolve_reference(
    root: &Path,
    reference: &str,
    graphics_paths: &[String],
    probes: &mut usize,
) -> Option<PathBuf> {
    let bases = std::iter::once("").chain(graphics_paths.iter().map(String::as_str));
    if ImageFormat::from_path(Path::new(reference)).is_some() {
        for base in bases {
            if let Some(file) = probe(root, &format!("{base}{reference}"), probes) {
                return Some(file);
            }
        }
        return None;
    }
    let bases: Vec<&str> = bases.collect();
    for extension in REFERENCE_EXTENSIONS {
        for base in &bases {
            if let Some(file) = probe(root, &format!("{base}{reference}.{extension}"), probes) {
                return Some(file);
            }
        }
    }
    None
}

#[derive(Debug, Default, PartialEq, Eq)]
struct SourceScan {
    images: Vec<String>,
    inputs: Vec<String>,
    graphics_paths: Vec<String>,
}

fn scan_source(text: &str) -> SourceScan {
    let mut scan = SourceScan::default();
    for line in text.lines() {
        let code = strip_comment(line);
        let bytes = code.as_bytes();
        let mut index = 0;
        while let Some(offset) = bytes[index..].iter().position(|byte| *byte == b'\\') {
            let name_start = index + offset + 1;
            let name_end = bytes[name_start..]
                .iter()
                .position(|byte| !byte.is_ascii_alphabetic())
                .map_or(bytes.len(), |length| name_start + length);
            index = name_end.max(name_start + 1).min(bytes.len());
            let command = &code[name_start..name_end];
            let after = &code[name_end..];
            match command {
                "includegraphics" => {
                    if let Some(argument) = graphics_argument(after) {
                        scan.images.push(argument);
                    }
                }
                "input" | "include" | "subfile" => {
                    if let Some(argument) = group(after.trim_start()).and_then(reference_name) {
                        scan.inputs.push(argument);
                    }
                }
                "graphicspath" => {
                    if let Some(outer) = group(after.trim_start()) {
                        let mut rest = outer.trim_start();
                        while let Some(inner) = group(rest) {
                            if let Some(path) = reference_name(inner) {
                                scan.graphics_paths.push(path);
                            }
                            rest = rest[inner.len() + 2..].trim_start();
                        }
                    }
                }
                _ => {}
            }
        }
    }
    scan
}

fn strip_comment(line: &str) -> &str {
    let bytes = line.as_bytes();
    let mut escaped = false;
    for (index, byte) in bytes.iter().enumerate() {
        match byte {
            b'\\' => escaped = !escaped,
            b'%' if !escaped => return &line[..index],
            _ => escaped = false,
        }
    }
    line
}

fn graphics_argument(after: &str) -> Option<String> {
    let mut rest = after.strip_prefix('*').unwrap_or(after).trim_start();
    while rest.starts_with('[') {
        let close = rest
            .char_indices()
            .take(MAX_GROUP_BYTES)
            .find(|(_, c)| *c == ']')?;
        rest = rest[close.0 + 1..].trim_start();
    }
    group(rest).and_then(reference_name)
}

fn group(text: &str) -> Option<&str> {
    let rest = text.strip_prefix('{')?;
    let mut depth = 0_usize;
    for (index, character) in rest.char_indices() {
        if index > MAX_GROUP_BYTES {
            return None;
        }
        match character {
            '{' => depth += 1,
            '}' if depth == 0 => return Some(&rest[..index]),
            '}' => depth -= 1,
            _ => {}
        }
    }
    None
}

fn reference_name(raw: &str) -> Option<String> {
    if raw.contains(['\\', '#', '{', '}']) {
        return None;
    }
    clean_name(raw)
}

struct Budget {
    remaining: u64,
}

impl Budget {
    fn new(bytes: u64) -> Self {
        Self { remaining: bytes }
    }

    fn spend(&mut self, bytes: u64) -> Option<()> {
        self.remaining = self.remaining.checked_sub(bytes)?;
        Some(())
    }
}

struct Source<'a> {
    reader: BufReader<File>,
    length: u64,
    position: u64,
    budget: &'a mut Budget,
}

impl Source<'_> {
    fn read_at(&mut self, offset: u64, buffer: &mut [u8]) -> Option<()> {
        let end = offset.checked_add(buffer.len() as u64)?;
        if end > self.length {
            return None;
        }
        self.budget.spend(READ_COST + buffer.len() as u64)?;
        let delta = i64::try_from(offset).ok()? - i64::try_from(self.position).ok()?;
        if delta != 0 {
            self.reader.seek_relative(delta).ok()?;
        }
        self.reader.read_exact(buffer).ok()?;
        self.position = end;
        Some(())
    }

    fn stream(&mut self, offset: u64, length: u64, visit: &mut dyn FnMut(&[u8])) -> Option<()> {
        let mut buffer = vec![0_u8; READ_BUFFER_BYTES.min(usize::try_from(length).ok()?)];
        let mut at = offset;
        let end = offset.checked_add(length)?;
        while at < end {
            let take = (end - at).min(buffer.len() as u64) as usize;
            self.read_at(at, &mut buffer[..take])?;
            visit(&buffer[..take]);
            at += take as u64;
        }
        Some(())
    }
}

fn inspect(
    path: &Path,
    declared: ImageFormat,
    strict: bool,
    budget: &mut Budget,
) -> Option<ImageProblem> {
    let file = File::open(path).ok()?;
    let length = file.metadata().ok()?.len();
    if length == 0 {
        return Some(ImageProblem::Empty);
    }
    let mut source = Source {
        reader: BufReader::new(file),
        length,
        position: 0,
        budget,
    };
    let mut head = vec![0_u8; usize::try_from(length.min(SNIFF_BYTES)).ok()?];
    source.read_at(0, &mut head)?;
    match sniff(&head) {
        ImageContent::Image(found) => {
            let problem = match found {
                ImageFormat::Png => png(&mut source, strict),
                ImageFormat::Jpeg => jpeg(&mut source),
                ImageFormat::Pdf => pdf(&mut source),
            };
            problem.or_else(|| {
                (found != declared).then_some(ImageProblem::WrongContent {
                    expected: declared,
                    found: ImageContent::Image(found),
                })
            })
        }
        ImageContent::Unknown if signature_prefix(&head, declared) => {
            Some(ImageProblem::Truncated(declared))
        }
        ImageContent::Unknown if damaged_signature(&head, declared) => {
            Some(ImageProblem::Corrupt(declared))
        }
        found => Some(ImageProblem::WrongContent {
            expected: declared,
            found,
        }),
    }
}

fn find(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack
        .windows(needle.len())
        .position(|window| window == needle)
}

fn sniff(head: &[u8]) -> ImageContent {
    if head.starts_with(&PNG_SIGNATURE) {
        return ImageContent::Image(ImageFormat::Png);
    }
    if head.starts_with(&[0xff, 0xd8, 0xff]) {
        return ImageContent::Image(ImageFormat::Jpeg);
    }
    if find(head, b"%PDF-").is_some() {
        return ImageContent::Image(ImageFormat::Pdf);
    }
    if let Some(found) = binary_content(head) {
        return found;
    }
    let text = head.strip_prefix(b"\xef\xbb\xbf").unwrap_or(head);
    if !looks_textual(text) {
        return ImageContent::Unknown;
    }
    let start = text
        .iter()
        .position(|byte| !byte.is_ascii_whitespace())
        .unwrap_or(text.len());
    let trimmed = &text[start..];
    if trimmed.starts_with(LFS_POINTER) {
        return ImageContent::LfsPointer;
    }
    let lower = trimmed.to_ascii_lowercase();
    if lower.starts_with(b"<!doctype html") || find(&lower, b"<html").is_some() {
        return ImageContent::WebPage;
    }
    if find(&lower, b"<svg").is_some() {
        return ImageContent::Svg;
    }
    if lower.starts_with(b"%!ps") {
        return ImageContent::Eps;
    }
    ImageContent::Text
}

fn binary_content(head: &[u8]) -> Option<ImageContent> {
    if head.starts_with(b"GIF87a") || head.starts_with(b"GIF89a") {
        return Some(ImageContent::Gif);
    }
    if head.starts_with(b"II*\0") || head.starts_with(b"MM\0*") {
        return Some(ImageContent::Tiff);
    }
    if head.starts_with(&[0xc5, 0xd0, 0xd3, 0xc6]) {
        return Some(ImageContent::Eps);
    }
    if head.len() >= 12 && &head[0..4] == b"RIFF" && &head[8..12] == b"WEBP" {
        return Some(ImageContent::Webp);
    }
    if head.len() >= 12 && &head[4..8] == b"ftyp" {
        let brand = &head[8..12];
        if brand == b"avif" || brand == b"avis" {
            return Some(ImageContent::Avif);
        }
        let heif: [&[u8]; 6] = [b"heic", b"heix", b"hevc", b"hevx", b"mif1", b"msf1"];
        if heif.contains(&brand) {
            return Some(ImageContent::Heic);
        }
    }
    None
}

fn looks_textual(bytes: &[u8]) -> bool {
    if bytes.is_empty() {
        return false;
    }
    let printable = bytes.iter().all(|byte| {
        (*byte >= 0x20 && *byte != 0x7f) || matches!(byte, b'\t' | b'\n' | b'\r' | 0x0c)
    });
    let utf8 = match std::str::from_utf8(bytes) {
        Ok(_) => true,
        Err(error) => error.error_len().is_none(),
    };
    printable && utf8
}

fn signature_prefix(head: &[u8], declared: ImageFormat) -> bool {
    match declared {
        ImageFormat::Png => PNG_SIGNATURE.starts_with(head),
        ImageFormat::Jpeg => [0xff, 0xd8, 0xff].starts_with(head),
        ImageFormat::Pdf => false,
    }
}

fn damaged_signature(head: &[u8], declared: ImageFormat) -> bool {
    match declared {
        ImageFormat::Png => head.starts_with(&PNG_SIGNATURE[..4]),
        ImageFormat::Jpeg => head.starts_with(&[0xff, 0xd8]),
        ImageFormat::Pdf => false,
    }
}

struct PngChunk {
    size: u64,
    kind: [u8; 4],
}

impl PngChunk {
    fn read(source: &mut Source<'_>, offset: u64) -> Option<Self> {
        let mut header = [0_u8; 8];
        source.read_at(offset, &mut header)?;
        Some(Self {
            size: u64::from(u32::from_be_bytes([
                header[0], header[1], header[2], header[3],
            ])),
            kind: [header[4], header[5], header[6], header[7]],
        })
    }

    fn is_malformed(&self) -> bool {
        self.size > 0x7fff_ffff || !self.kind.iter().all(u8::is_ascii_alphabetic)
    }

    fn is(&self, kind: &[u8; 4]) -> bool {
        &self.kind == kind
    }
}

enum PngDataCheck {
    Fine,
    Corrupt,
    OverBudget,
}

fn png_chunk_out_of_order(index: usize, chunk: &PngChunk, data_seen: bool) -> bool {
    let is_header = chunk.is(b"IHDR");
    (index == 0) != is_header
        || (is_header && chunk.size != 13)
        || (chunk.is(b"IEND") && !data_seen)
}

fn png_small_chunk_is_corrupt(
    source: &mut Source<'_>,
    chunk: &PngChunk,
    data_offset: u64,
) -> Option<bool> {
    let mut body = vec![0_u8; usize::try_from(chunk.size + 4).ok()?];
    source.read_at(data_offset, &mut body)?;
    let (data, stored) = body.split_at(body.len() - 4);
    let stored = u32::from_be_bytes([stored[0], stored[1], stored[2], stored[3]]);
    Some(chunk_crc(&chunk.kind, data) != stored || (chunk.is(b"IHDR") && !valid_png_header(data)))
}

fn png_data_chunk(
    source: &mut Source<'_>,
    data_offset: u64,
    size: u64,
    first_data_chunk: bool,
    data_read: &mut u64,
) -> Option<PngDataCheck> {
    *data_read += size;
    if *data_read > MAX_FILE_DATA_BYTES {
        return Some(PngDataCheck::OverBudget);
    }
    let mut hasher = crc32fast::Hasher::new();
    hasher.update(b"IDAT");
    let mut first = [0_u8; 2];
    let mut first_len = 0;
    source.stream(data_offset, size, &mut |bytes| {
        let copy = bytes.len().min(2 - first_len);
        first[first_len..first_len + copy].copy_from_slice(&bytes[..copy]);
        first_len += copy;
        hasher.update(bytes);
    })?;
    let mut stored = [0_u8; 4];
    source.read_at(data_offset + size, &mut stored)?;
    let crc_mismatch = hasher.finalize() != u32::from_be_bytes(stored);
    let bad_zlib = first_data_chunk && first_len == 2 && !valid_zlib_header(first[0], first[1]);
    Some(if crc_mismatch || bad_zlib {
        PngDataCheck::Corrupt
    } else {
        PngDataCheck::Fine
    })
}

fn png(source: &mut Source<'_>, strict: bool) -> Option<ImageProblem> {
    let truncated = Some(ImageProblem::Truncated(ImageFormat::Png));
    let corrupt = Some(ImageProblem::Corrupt(ImageFormat::Png));
    let length = source.length;
    let mut offset = PNG_SIGNATURE.len() as u64;
    let mut data_seen = false;
    let mut data_read = 0_u64;
    for index in 0..MAX_PNG_CHUNKS {
        let checked = !data_seen || strict;
        if offset + 8 > length {
            return truncated.filter(|_| checked);
        }
        let chunk = PngChunk::read(source, offset)?;
        if chunk.is_malformed() {
            return corrupt.filter(|_| checked);
        }
        let is_data = chunk.is(b"IDAT");
        if !checked && !is_data {
            return None;
        }
        if png_chunk_out_of_order(index, &chunk, data_seen) {
            return corrupt;
        }
        let data_offset = offset + 8;
        let end = data_offset + chunk.size + 4;
        if end > length {
            return truncated;
        }
        let small = chunk.is(b"IHDR") || (!data_seen && chunk.is(b"PLTE") && chunk.size <= 768);
        if small && png_small_chunk_is_corrupt(source, &chunk, data_offset)? {
            return corrupt;
        }
        if is_data && strict {
            match png_data_chunk(source, data_offset, chunk.size, !data_seen, &mut data_read)? {
                PngDataCheck::Corrupt => return corrupt,
                PngDataCheck::OverBudget => return None,
                PngDataCheck::Fine => {}
            }
        }
        if chunk.is(b"IEND") {
            return None;
        }
        data_seen |= is_data;
        offset = end;
    }
    None
}

fn jpeg(source: &mut Source<'_>) -> Option<ImageProblem> {
    let truncated = Some(ImageProblem::Truncated(ImageFormat::Jpeg));
    let corrupt = Some(ImageProblem::Corrupt(ImageFormat::Jpeg));
    let length = source.length;
    let mut offset = 2_u64;
    let mut byte = [0_u8; 1];
    for _ in 0..MAX_JPEG_SEGMENTS {
        if offset >= length {
            return truncated;
        }
        source.read_at(offset, &mut byte)?;
        if byte[0] != 0xff {
            return corrupt;
        }
        let mut marker = 0xff;
        let mut fills = 0;
        while marker == 0xff {
            offset += 1;
            fills += 1;
            if offset >= length {
                return truncated;
            }
            if fills > MAX_JPEG_FILL_BYTES {
                return None;
            }
            source.read_at(offset, &mut byte)?;
            marker = byte[0];
        }
        offset += 1;
        match marker {
            0x01 | 0xd0..=0xd7 => continue,
            0x00 | 0xd8 | 0xd9 | 0xda => return corrupt,
            _ => {}
        }
        if offset + 2 > length {
            return truncated;
        }
        let mut size = [0_u8; 2];
        source.read_at(offset, &mut size)?;
        let size = u64::from(u16::from_be_bytes(size));
        if size < 2 {
            return corrupt;
        }
        if offset + size > length {
            return truncated;
        }
        if is_jpeg_frame(marker) {
            if size < 8 {
                return corrupt;
            }
            let mut frame = [0_u8; 6];
            source.read_at(offset + 2, &mut frame)?;
            let width = u16::from_be_bytes([frame[3], frame[4]]);
            if width == 0 || !matches!(frame[5], 1 | 3 | 4) {
                return corrupt;
            }
            return None;
        }
        offset += size;
    }
    None
}

fn pdf(source: &mut Source<'_>) -> Option<ImageProblem> {
    let length = source.length;
    let tail_start = length.saturating_sub(PDF_TAIL_BYTES);
    let mut tail = vec![0_u8; usize::try_from(length - tail_start).ok()?];
    source.read_at(tail_start, &mut tail)?;
    if has_pdf_structure(&tail) {
        return None;
    }
    if tail_start > 0 {
        if length > MAX_FILE_DATA_BYTES {
            return None;
        }
        let overlap = PDF_STRUCTURE
            .iter()
            .map(|word| word.len())
            .max()
            .unwrap_or(0) as u64;
        let mut carry: Vec<u8> = Vec::new();
        let mut found = false;
        source.stream(0, (tail_start + overlap).min(length), &mut |bytes| {
            if found {
                return;
            }
            carry.extend_from_slice(bytes);
            found = has_pdf_structure(&carry);
            let keep = carry.len().saturating_sub(overlap as usize);
            carry.drain(..keep);
        })?;
        if found {
            return None;
        }
    }
    Some(ImageProblem::Truncated(ImageFormat::Pdf))
}

fn has_pdf_structure(bytes: &[u8]) -> bool {
    PDF_STRUCTURE
        .iter()
        .any(|word| memmem::find(bytes, word).is_some())
}

fn valid_png_header(header: &[u8]) -> bool {
    if header.len() != 13 {
        return false;
    }
    let width = u32::from_be_bytes([header[0], header[1], header[2], header[3]]);
    let height = u32::from_be_bytes([header[4], header[5], header[6], header[7]]);
    let depth = header[8];
    let depth_ok = match header[9] {
        0 => matches!(depth, 1 | 2 | 4 | 8 | 16),
        3 => matches!(depth, 1 | 2 | 4 | 8),
        2 | 4 | 6 => matches!(depth, 8 | 16),
        _ => false,
    };
    (1..=0x7fff_ffff).contains(&width)
        && (1..=0x7fff_ffff).contains(&height)
        && depth_ok
        && header[10] == 0
        && header[11] == 0
        && header[12] <= 1
}

fn valid_zlib_header(method: u8, flags: u8) -> bool {
    method & 0x0f == 8
        && method >> 4 <= 7
        && ((u16::from(method) << 8) | u16::from(flags)) % 31 == 0
}

fn is_jpeg_frame(marker: u8) -> bool {
    matches!(marker, 0xc0..=0xcf) && !matches!(marker, 0xc4 | 0xc8 | 0xcc)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    const PNG: ImageFormat = ImageFormat::Png;
    const JPEG: ImageFormat = ImageFormat::Jpeg;
    const PDF: ImageFormat = ImageFormat::Pdf;

    fn chunk(kind: &[u8; 4], data: &[u8]) -> Vec<u8> {
        let mut out = (data.len() as u32).to_be_bytes().to_vec();
        out.extend_from_slice(kind);
        out.extend_from_slice(data);
        out.extend_from_slice(&chunk_crc(kind, data).to_be_bytes());
        out
    }

    fn zlib_stored(data: &[u8]) -> Vec<u8> {
        let length = data.len() as u16;
        let mut out = vec![0x78, 0x01, 0x01];
        out.extend_from_slice(&length.to_le_bytes());
        out.extend_from_slice(&(!length).to_le_bytes());
        out.extend_from_slice(data);
        let (mut a, mut b) = (1_u32, 0_u32);
        for byte in data {
            a = (a + u32::from(*byte)) % 65_521;
            b = (b + a) % 65_521;
        }
        out.extend_from_slice(&((b << 16) | a).to_be_bytes());
        out
    }

    const IHDR: [u8; 13] = [0, 0, 0, 1, 0, 0, 0, 1, 8, 0, 0, 0, 0];

    fn png_from(chunks: &[Vec<u8>]) -> Vec<u8> {
        let mut out = PNG_SIGNATURE.to_vec();
        for part in chunks {
            out.extend_from_slice(part);
        }
        out
    }

    fn png() -> Vec<u8> {
        png_from(&[
            chunk(b"IHDR", &IHDR),
            chunk(b"IDAT", &zlib_stored(&[0, 0x80])),
            chunk(b"IEND", &[]),
        ])
    }

    fn png_two_data_chunks() -> Vec<u8> {
        let data = zlib_stored(&[0, 0x80]);
        png_from(&[
            chunk(b"IHDR", &IHDR),
            chunk(b"IDAT", &data[..5]),
            chunk(b"IDAT", &data[5..]),
            chunk(b"IEND", &[]),
        ])
    }

    fn with_bad_crc(mut bytes: Vec<u8>, kind: &[u8; 4], nth: usize) -> Vec<u8> {
        let at = bytes
            .windows(4)
            .enumerate()
            .filter(|(_, window)| window == kind)
            .nth(nth)
            .unwrap()
            .0;
        let size = u32::from_be_bytes(bytes[at - 4..at].try_into().unwrap()) as usize;
        bytes[at + 4 + size] ^= 0xff;
        bytes
    }

    fn jpeg() -> Vec<u8> {
        let mut out = vec![0xff, 0xd8];
        out.extend([0xff, 0xe0, 0, 16]);
        out.extend(b"JFIF\0");
        out.extend([1, 1, 0, 0, 1, 0, 1, 0, 0]);
        out.extend([0xff, 0xdb, 0, 67, 0]);
        out.extend([1_u8; 64]);
        out.extend([0xff, 0xc0, 0, 11, 8, 0, 1, 0, 1, 1, 1, 0x11, 0]);
        out.extend([0xff, 0xda, 0, 8, 1, 1, 0, 0, 63, 0]);
        out.extend([0x12, 0xff, 0x00, 0x34]);
        out.extend([0xff, 0xd9]);
        out
    }

    fn jpeg_frame_at() -> usize {
        find(&jpeg(), &[0xff, 0xc0]).unwrap()
    }

    fn pdf() -> Vec<u8> {
        b"%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\nxref\n0 1\ntrailer\n<< /Root 1 0 R >>\nstartxref\n40\n%%EOF\n"
            .to_vec()
    }

    fn check_with(name: &str, bytes: &[u8], strict: bool) -> Option<ImageProblem> {
        let directory = TempDir::new().unwrap();
        let path = directory.path().join(name);
        std::fs::write(&path, bytes).unwrap();
        let declared = ImageFormat::from_path(&path).unwrap();
        inspect(&path, declared, strict, &mut Budget::new(MAX_SCAN_BYTES))
    }

    fn both(name: &str, bytes: &[u8]) -> (Option<ImageProblem>, Option<ImageProblem>) {
        (
            check_with(name, bytes, false),
            check_with(name, bytes, true),
        )
    }

    fn project(files: &[(&str, &[u8])]) -> TempDir {
        let directory = TempDir::new().unwrap();
        for (name, bytes) in files {
            let path = directory.path().join(name);
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(path, bytes).unwrap();
        }
        directory
    }

    fn messages(findings: &[ImageFinding]) -> Vec<String> {
        findings.iter().map(ImageFinding::message).collect()
    }

    fn paths(findings: &[ImageFinding]) -> Vec<String> {
        findings
            .iter()
            .filter_map(|finding| match finding {
                ImageFinding::Broken(image) => Some(image.path.clone()),
                ImageFinding::Unidentified(_) => None,
            })
            .collect()
    }

    fn evidence(log: &str) -> ImageEvidence {
        image_failure_evidence(log).unwrap()
    }

    #[test]
    fn well_formed_images_pass_in_both_modes() {
        for (name, bytes) in [
            ("plot.png", png()),
            ("plot.png", png_two_data_chunks()),
            ("photo.jpg", jpeg()),
            ("photo.JPEG", jpeg()),
            ("figure.pdf", pdf()),
        ] {
            assert_eq!(both(name, &bytes), (None, None), "{name}");
        }
    }

    #[test]
    fn png_damage_every_engine_rejects_is_reported_in_both_modes() {
        let corrupt = Some(ImageProblem::Corrupt(PNG));
        let damaged = [
            with_bad_crc(png(), b"IHDR", 0),
            png()
                .iter()
                .enumerate()
                .filter(|(index, _)| *index != 4)
                .map(|(_, byte)| *byte)
                .collect(),
            png_from(&[
                chunk(b"IHDR", &[0, 0, 0, 1, 0, 0, 0, 1, 3, 0, 0, 0, 0]),
                chunk(b"IDAT", &zlib_stored(&[0, 0])),
                chunk(b"IEND", &[]),
            ]),
            png_from(&[chunk(b"IHDR", &IHDR), chunk(b"IEND", &[])]),
            png_from(&[
                chunk(b"IHDR", &IHDR),
                chunk(b"a1b2", b"xx"),
                chunk(b"IDAT", &zlib_stored(&[0, 0x80])),
                chunk(b"IEND", &[]),
            ]),
            png_from(&[
                chunk(b"tEXt", b"a\0b"),
                chunk(b"IHDR", &IHDR),
                chunk(b"IDAT", &zlib_stored(&[0, 0x80])),
                chunk(b"IEND", &[]),
            ]),
            png_from(&[
                chunk(b"IHDR", &[0, 0, 0, 1, 0, 0, 0, 1, 8, 3, 0, 0, 0]),
                chunk(b"PLTE", &[0, 0, 0]),
                chunk(b"IDAT", &zlib_stored(&[0, 0])),
                chunk(b"IEND", &[]),
            ]),
        ];
        for (index, bytes) in damaged.iter().enumerate() {
            let bytes = if index == damaged.len() - 1 {
                with_bad_crc(bytes.clone(), b"PLTE", 0)
            } else {
                bytes.clone()
            };
            assert_eq!(both("plot.png", &bytes), (corrupt, corrupt), "case {index}");
        }
        let mut huge = png()[..33].to_vec();
        huge.extend(0x8000_0001_u32.to_be_bytes());
        huge.extend(b"tEXt");
        huge.extend([0_u8; 16]);
        assert_eq!(both("plot.png", &huge), (corrupt, corrupt));
    }

    #[test]
    fn png_cut_before_or_inside_the_image_data_is_truncated_in_both_modes() {
        let truncated = Some(ImageProblem::Truncated(PNG));
        let full = png();
        let two = png_two_data_chunks();
        let second_data = find(&two[40..], b"IDAT").unwrap() + 40;
        for bytes in [
            &full[..5],
            &full[..8],
            &full[..20],
            &full[..33],
            &full[..45],
            &full[..56],
            &two[..second_data + 6],
        ] {
            assert_eq!(
                both("plot.png", bytes),
                (truncated, truncated),
                "{}",
                bytes.len()
            );
        }
    }

    #[test]
    fn png_damage_only_strict_libpng_readers_reject_needs_strict_mode() {
        let corrupt = Some(ImageProblem::Corrupt(PNG));
        let truncated = Some(ImageProblem::Truncated(PNG));
        let full = png();
        let mut data_byte = full.clone();
        data_byte[33 + 8 + 5] ^= 0x01;
        let bad_zlib = png_from(&[
            chunk(b"IHDR", &IHDR),
            chunk(b"IDAT", &[0x78, 0x9d, 1, 2, 0, 0xfd, 0xff, 0, 0x80]),
            chunk(b"IEND", &[]),
        ]);
        let mut garbage_after_data = full[..58].to_vec();
        garbage_after_data.extend(chunk(b"a1b2", b"xx"));
        for (bytes, expected) in [
            (with_bad_crc(full.clone(), b"IDAT", 0), corrupt),
            (with_bad_crc(png_two_data_chunks(), b"IDAT", 1), corrupt),
            (data_byte, corrupt),
            (bad_zlib, corrupt),
            (garbage_after_data, corrupt),
            (full[..58].to_vec(), truncated),
            (full[..62].to_vec(), truncated),
            (full[..68].to_vec(), truncated),
        ] {
            assert_eq!(
                both("plot.png", &bytes),
                (None, expected),
                "{}",
                bytes.len()
            );
        }
    }

    #[test]
    fn png_damage_no_engine_rejects_is_never_reported() {
        let mut trailing = png();
        trailing.extend(b"garbage after the end");
        let ancillary_first = png_from(&[
            chunk(b"IHDR", &IHDR),
            chunk(b"tEXt", b"Comment\0hi"),
            chunk(b"IDAT", &zlib_stored(&[0, 0x80])),
            chunk(b"IEND", &[]),
        ]);
        let ancillary_last = png_from(&[
            chunk(b"IHDR", &IHDR),
            chunk(b"IDAT", &zlib_stored(&[0, 0x80])),
            chunk(b"tEXt", b"Comment\0hi"),
            chunk(b"IEND", &[]),
        ]);
        for bytes in [
            with_bad_crc(ancillary_first, b"tEXt", 0),
            with_bad_crc(ancillary_last, b"tEXt", 0),
            with_bad_crc(png(), b"IEND", 0),
            trailing,
        ] {
            assert_eq!(both("plot.png", &bytes), (None, None));
        }
    }

    #[test]
    fn jpeg_is_checked_only_up_to_its_frame_header() {
        let full = jpeg();
        let frame = jpeg_frame_at();
        let scan = find(&full, &[0xff, 0xda]).unwrap();
        let mut trailing = full.clone();
        trailing.extend(b"junk");
        for bytes in [
            &full[..full.len() - 2],
            &full[..scan],
            &full[..scan + 12],
            &trailing[..],
        ] {
            assert_eq!(both("photo.jpg", bytes), (None, None), "{}", bytes.len());
        }
        let truncated = Some(ImageProblem::Truncated(JPEG));
        for bytes in [&full[..2], &full[..12], &full[..frame], &full[..frame + 6]] {
            assert_eq!(
                both("photo.jpg", bytes),
                (truncated, truncated),
                "{}",
                bytes.len()
            );
        }
    }

    #[test]
    fn jpeg_structure_every_engine_rejects_is_corrupt() {
        let corrupt = Some(ImageProblem::Corrupt(JPEG));
        let full = jpeg();
        let frame = jpeg_frame_at();
        let mut lost = full.clone();
        lost[frame] = 0;
        let mut no_frame = full[..frame].to_vec();
        no_frame.extend_from_slice(&full[frame + 13..]);
        let mut zero_width = full.clone();
        zero_width[frame + 7] = 0;
        zero_width[frame + 8] = 0;
        let mut cases = vec![lost, no_frame, zero_width, vec![0xff, 0xd8, 0x00, 0x10]];
        for components in [0, 2, 7] {
            let mut bytes = full.clone();
            bytes[frame + 9] = components;
            cases.push(bytes);
        }
        for bytes in cases {
            assert_eq!(both("photo.jpg", &bytes), (corrupt, corrupt));
        }
    }

    #[test]
    fn pdf_is_truncated_only_without_any_cross_reference_structure() {
        let full = pdf();
        let truncated = Some(ImageProblem::Truncated(PDF));
        let mut trailing = full.clone();
        trailing.extend(vec![b'x'; 5_000]);
        let without_eof = &full[..find(&full, b"%%EOF").unwrap()];
        let without_startxref = &full[..find(&full, b"startxref").unwrap()];
        for bytes in [&trailing[..], without_eof, without_startxref] {
            assert_eq!(both("figure.pdf", bytes), (None, None));
        }
        let header_only = b"%PDF-1.4\n".to_vec();
        let cut = full[..find(&full, b"xref").unwrap()].to_vec();
        for bytes in [header_only, cut] {
            assert_eq!(both("figure.pdf", &bytes), (truncated, truncated));
        }
        let mut large = full.clone();
        large.extend(vec![b' '; 2 * PDF_TAIL_BYTES as usize]);
        assert_eq!(both("figure.pdf", &large), (None, None));
        let mut large_cut = b"%PDF-1.4\n".to_vec();
        large_cut.extend(vec![b' '; 2 * PDF_TAIL_BYTES as usize]);
        assert_eq!(both("figure.pdf", &large_cut), (truncated, truncated));
    }

    #[test]
    fn content_that_is_not_the_declared_format_is_named() {
        let wrong = |expected, found| Some(ImageProblem::WrongContent { expected, found });
        let check = |name, bytes: &[u8]| check_with(name, bytes, true);
        assert_eq!(check("empty.png", b""), Some(ImageProblem::Empty));
        assert_eq!(
            check("chart.png", &jpeg()),
            wrong(PNG, ImageContent::Image(JPEG))
        );
        assert_eq!(
            check("plot.pdf", &png()),
            wrong(PDF, ImageContent::Image(PNG))
        );
        assert_eq!(
            check(
                "figure.pdf",
                b"<!DOCTYPE html>\n<html><body>Not found</body></html>\n"
            ),
            wrong(PDF, ImageContent::WebPage)
        );
        assert_eq!(
            check("logo.png", b"<?xml version=\"1.0\"?><svg xmlns=\"x\"/>"),
            wrong(PNG, ImageContent::Svg)
        );
        assert_eq!(
            check(
                "logo.png",
                b"version https://git-lfs.github.com/spec/v1\noid sha256:00\n"
            ),
            wrong(PNG, ImageContent::LfsPointer)
        );
        assert_eq!(
            check("photo.jpg", b"RIFF\x10\0\0\0WEBPVP8 "),
            wrong(JPEG, ImageContent::Webp)
        );
        assert_eq!(
            check("photo.jpg", b"\0\0\0\x18ftypheic\0\0\0\0"),
            wrong(JPEG, ImageContent::Heic)
        );
        assert_eq!(
            check("logo.png", b"GIF89a\x01\0\x01\0"),
            wrong(PNG, ImageContent::Gif)
        );
        assert_eq!(
            check("logo.png", b"II*\0\x08\0\0\0"),
            wrong(PNG, ImageContent::Tiff)
        );
        assert_eq!(
            check("photo.jpg", b"BM\x1e\0\0\0\0\0\0\0\x1a\0\0\0\x0c\0"),
            wrong(JPEG, ImageContent::Unknown)
        );
    }

    #[test]
    fn scans_report_only_problems_every_engine_rejects() {
        let rejected = |found| {
            ImageProblem::WrongContent {
                expected: PNG,
                found,
            }
            .rejected_by_every_engine()
        };
        assert!(ImageProblem::Empty.rejected_by_every_engine());
        assert!(ImageProblem::Corrupt(PNG).rejected_by_every_engine());
        for found in [
            ImageContent::WebPage,
            ImageContent::LfsPointer,
            ImageContent::Svg,
            ImageContent::Text,
            ImageContent::Gif,
            ImageContent::Tiff,
            ImageContent::Webp,
        ] {
            assert!(rejected(found), "{found:?}");
        }
        for found in [
            ImageContent::Image(JPEG),
            ImageContent::Image(PDF),
            ImageContent::Eps,
            ImageContent::Unknown,
        ] {
            assert!(!rejected(found), "{found:?}");
        }
    }

    #[test]
    fn messages_name_the_file_say_what_is_wrong_and_how_to_fix_it() {
        let message = |problem| {
            BrokenImage {
                path: "figures/plot.png".into(),
                problem,
            }
            .message()
        };
        assert_eq!(
            message(ImageProblem::Empty),
            "The image figures/plot.png is empty. Export the image again or replace the file."
        );
        assert_eq!(
            message(ImageProblem::Truncated(JPEG)),
            "The image figures/plot.png is incomplete. Part of the file is missing, which can happen when a download or copy stops early. Export the image again or replace the file."
        );
        assert_eq!(
            message(ImageProblem::Corrupt(PNG)),
            "The image figures/plot.png is damaged and cannot be read. Export the image again or replace the file."
        );
        assert_eq!(
            message(ImageProblem::WrongContent { expected: PNG, found: ImageContent::Image(PDF) }),
            "The image figures/plot.png contains a PDF file instead of a PNG. Rename it to end in .pdf, or export it again as PNG."
        );
        assert_eq!(
            message(ImageProblem::WrongContent { expected: PNG, found: ImageContent::WebPage }),
            "The image figures/plot.png contains a web page instead of a PNG. This usually happens when a download returns an error page. Download or export the image again."
        );
        assert_eq!(
            message(ImageProblem::WrongContent { expected: PNG, found: ImageContent::LfsPointer }),
            "The image figures/plot.png is a Git LFS placeholder instead of the real image. Run git lfs pull to download it, or replace the file."
        );
        assert_eq!(
            message(ImageProblem::WrongContent {
                expected: PNG,
                found: ImageContent::Svg
            }),
            "The image figures/plot.png contains an SVG drawing instead of a PNG. Export it again as PNG."
        );
        assert_eq!(
            message(ImageProblem::WrongContent { expected: PNG, found: ImageContent::Unknown }),
            "The image figures/plot.png is not a readable PNG file. Export it again as PNG or replace the file."
        );
        assert_eq!(
            ImageFinding::Unidentified(Some(PNG)).message(),
            "One of the PNG images in this document is damaged and stopped the compile. Oleafly could not tell which one. Export the document's PNG images again, or replace the damaged one."
        );
        assert_eq!(
            ImageFinding::Unidentified(None).message(),
            "One of the images in this document is damaged and stopped the compile. Oleafly could not tell which one. Export the document's images again, or replace the damaged one."
        );
        let jargon = [
            "IEND", "IDAT", "EOI", "chunk", "marker", "CRC", "zlib", "xref",
        ];
        for problem in [
            ImageProblem::Empty,
            ImageProblem::Truncated(PNG),
            ImageProblem::Corrupt(JPEG),
            ImageProblem::WrongContent {
                expected: JPEG,
                found: ImageContent::Heic,
            },
        ] {
            let text = message(problem);
            assert!(!text.contains(';') && !text.contains('!') && !text.contains('\u{2014}'));
            assert!(jargon.iter().all(|word| !text.contains(word)), "{text}");
        }
    }

    #[test]
    fn evidence_reads_names_from_each_engines_error_lines() {
        let named = |log: &str| evidence(log).named;
        assert_eq!(
            named("! Unable to load picture or PDF file 'figures/photo.jpg'.\n"),
            ["figures/photo.jpg"]
        );
        assert_eq!(
            named("error: pdf: image inclusion failed for \"figures/empty.png\".\n"),
            ["figures/empty.png"]
        );
        assert_eq!(
            named("xdvipdfmx:fatal: Image inclusion failed for \"figures/photo.jpg\".\n"),
            ["figures/photo.jpg"]
        );
        assert_eq!(
            named("!pdfTeX error: pdflatex (file ./figures/photo.jpg): reading JPEG image failed (\nno marker found)\n"),
            ["./figures/photo.jpg"]
        );
        assert_eq!(
            named("! error:  (file figures/plot.png) (readpng): internal error\n"),
            ["figures/plot.png"]
        );
        assert_eq!(
            named(
                "!pdfTeX error: pdflatex (file ./figures/plot (1).png): libpng: internal error\n"
            ),
            ["./figures/plot (1).png"]
        );
    }

    #[test]
    fn evidence_keeps_quotes_that_are_part_of_a_file_name() {
        let named = |log: &str| evidence(log).named;
        assert_eq!(
            named("! Unable to load picture or PDF file '\"figures/it's.png\"'.\n"),
            ["figures/it's.png"]
        );
        assert_eq!(
            named("error: main.tex:6: Unable to load picture or PDF file '\"figures/it's.png\"'\n"),
            ["figures/it's.png"]
        );
        assert_eq!(
            named("error: pdf: image inclusion failed for \"figures/it's.png\".\n"),
            ["figures/it's.png"]
        );
        assert_eq!(
            named("! Unable to load picture or PDF file 'figures/Bob's plot.png'.\n"),
            ["figures/Bob's plot.png"]
        );
    }

    #[test]
    fn evidence_joins_names_that_tex_wrapped_at_79_columns() {
        let log = "! Unable to load picture or PDF file 'figures/chapter-three/experiment-results-\nfinal.png'.\n";
        assert_eq!(log.lines().next().unwrap().len(), TEX_LINE_WIDTH);
        assert_eq!(
            evidence(log).named,
            ["figures/chapter-three/experiment-results-final.png"]
        );
        let hint_on_continuation = format!(
            "! error:  (file {}\n.png) (readpng): internal error\n",
            "x".repeat(TEX_LINE_WIDTH - 16)
        );
        assert_eq!(
            hint_on_continuation.lines().next().unwrap().len(),
            TEX_LINE_WIDTH
        );
        assert_eq!(
            evidence(&hint_on_continuation).named,
            [format!("{}.png", "x".repeat(TEX_LINE_WIDTH - 16))]
        );
        let short = "! Unable to load picture or PDF file 'figures/a\nb.png'.\n";
        let unreadable = evidence(short);
        assert!(unreadable.named.is_empty());
        assert!(unreadable.any_format);
    }

    #[test]
    fn warnings_never_count_as_evidence() {
        let lualatex = "warning  (file figures/fig.pdf) (pdf inclusion): PDF inclusion: found PDF versio\nn '1.7', but at most version '1.4' allowed\n<figures/fig.pdf, id=1, 100.375pt x 50.1875pt>\nFile: figures/fig.pdf Graphic file (type pdf)\n! Undefined control sequence.\nl.9 \\foo\n";
        for log in [
            lualatex,
            "warning: JPEG: Not a JPEG file?\n",
            "warning: Tectonic was unable to detect an image's format\n",
            "libpng warning: iCCP: known incorrect sRGB profile\n",
            "xdvipdfmx:warning: Image inclusion failed for \"figures/a.png\".\n",
            "Package pdftex.def Warning: File `figures/a.png' not found (file figures/a.png)\n",
        ] {
            assert_eq!(image_failure_evidence(log), None, "{log}");
        }
    }

    #[test]
    fn logs_without_an_image_failure_have_no_evidence() {
        for log in [
            "",
            "! Undefined control sequence.\nl.4 \\foo\n",
            "!pdfTeX error: pdflatex (file ecrm1000): Font ecrm1000 at 600 not found\n",
            "File: figures/plot.png Graphic file (type png)\n",
            "! LaTeX Error: File `figures/plot.png' not found.\n",
            "error: File ended prematurely\n",
        ] {
            assert_eq!(image_failure_evidence(log), None, "{log}");
        }
    }

    #[test]
    fn evidence_without_a_name_hints_at_the_format_and_strictness() {
        let tectonic = evidence("(ts1cmr.fd)libpng error: IHDR: CRC error");
        assert!(tectonic.named.is_empty());
        assert_eq!(tectonic.formats, [PNG]);
        assert!(tectonic.strict_png);
        let read = evidence("warning: 96-byte read failed\nerror: error reading PNG\n");
        assert_eq!(
            (read.formats.as_slice(), read.strict_png),
            (&[PNG][..], true)
        );
        let lualatex = evidence("! error:  (writepng): reading chunk type failed\n");
        assert_eq!(
            (lualatex.formats.as_slice(), lualatex.strict_png),
            (&[PNG][..], false)
        );
        let dimensions = evidence("! pdfTeX error (ext1): invalid image dimensions.\n");
        assert!(dimensions.any_format && dimensions.formats.is_empty());
    }

    #[test]
    fn evidence_lists_images_the_log_shows_were_opened() {
        let long = format!("figures/{}.png", "n".repeat(70));
        let wrapped = format!("File: {long} Graphic file (type png)");
        let wrapped = format!(
            "{}\n{}",
            &wrapped[..TEX_LINE_WIDTH],
            &wrapped[TEX_LINE_WIDTH..]
        );
        let log = format!("File: size10.clo 2021/10/04 v1.4n Standard LaTeX file (size option)\nFile: figures/a.png Graphic file (type png)\n{wrapped}\nFile: figures/a.png Graphic file (type png)\n! error:  (writepng): reading chunk type failed\n");
        assert_eq!(evidence(&log).opened, ["figures/a.png".to_string(), long]);
    }

    #[test]
    fn a_named_image_is_checked_alone_and_strictly() {
        let directory = project(&[
            ("figures/chart.png", &jpeg()),
            ("figures/other.png", b""),
            ("figures/idat.png", &with_bad_crc(png(), b"IDAT", 0)),
        ]);
        let log = "! Unable to load picture or PDF file 'figures/chart.png'.\n";
        assert_eq!(
            paths(&diagnose_image_failures(directory.path(), None, log)),
            ["figures/chart.png"]
        );
        let log = "error: pdf: image inclusion failed for \"figures/idat.png\".\n";
        assert_eq!(
            diagnose_image_failures(directory.path(), None, log),
            [ImageFinding::Broken(BrokenImage {
                path: "figures/idat.png".into(),
                problem: ImageProblem::Corrupt(PNG)
            })]
        );
        let fine = project(&[("figures/photo.jpg", &jpeg()), ("figures/broken.jpg", b"")]);
        let log = "! Unable to load picture or PDF file 'figures/photo.jpg'.\n";
        assert!(diagnose_image_failures(fine.path(), None, log).is_empty());
    }

    #[test]
    fn a_scan_names_only_images_the_run_opened_or_the_document_uses() {
        let directory = project(&[
            ("main.tex", b"\\includegraphics{figures/plot.png}\n% \\includegraphics{figures/commented.png}\n"),
            ("figures/plot.png", &with_bad_crc(png(), b"IHDR", 0)),
            ("figures/commented.png", b""),
            ("figures/unused.png", b""),
            ("figures/opened.png", b""),
        ]);
        let log = "(ts1cmr.fd)libpng error: IHDR: CRC error\n";
        assert_eq!(
            paths(&diagnose_image_failures(
                directory.path(),
                Some("main.tex"),
                log
            )),
            ["figures/plot.png"]
        );
        let opened = "File: figures/opened.png Graphic file (type png)\n! error:  (writepng): reading chunk type failed\n";
        assert_eq!(
            paths(&diagnose_image_failures(directory.path(), None, opened)),
            ["figures/opened.png"]
        );
        let unused_only = project(&[("main.tex", b"text"), ("figures/unused.png", b"")]);
        assert_eq!(
            diagnose_image_failures(unused_only.path(), Some("main.tex"), log),
            [ImageFinding::Unidentified(Some(PNG))]
        );
    }

    #[test]
    fn a_culprit_the_checks_cannot_see_gets_a_hint_that_names_no_file() {
        let mut filter = png();
        filter[33 + 8 + 7] = 9;
        let data = zlib_stored(&[9, 0x80]);
        let valid_crc_bad_filter = png_from(&[
            chunk(b"IHDR", &IHDR),
            chunk(b"IDAT", &data),
            chunk(b"IEND", &[]),
        ]);
        let ancillary = with_bad_crc(
            png_from(&[
                chunk(b"IHDR", &IHDR),
                chunk(b"tEXt", b"a\0b"),
                chunk(b"IDAT", &zlib_stored(&[0, 0x80])),
                chunk(b"IEND", &[]),
            ]),
            b"tEXt",
            0,
        );
        let mut no_end = jpeg();
        no_end.truncate(no_end.len() - 2);
        let directory = project(&[
            ("main.tex", b"\\includegraphics{figures/plot.png}\\includegraphics{figures/notes.png}\\includegraphics{figures/photo.jpg}"),
            ("figures/plot.png", &valid_crc_bad_filter),
            ("figures/notes.png", &ancillary),
            ("figures/photo.jpg", &no_end),
            ("figures/unused-empty.png", b""),
        ]);
        let log = "(ts1cmr.fd)libpng error: bad adaptive filter value";
        let findings = diagnose_image_failures(directory.path(), Some("main.tex"), log);
        assert_eq!(findings, [ImageFinding::Unidentified(Some(PNG))]);
        assert!(!messages(&findings)[0].contains("unused-empty"));
        let any = "! pdfTeX error (ext1): invalid image dimensions.\n";
        assert_eq!(
            diagnose_image_failures(directory.path(), Some("main.tex"), any),
            [ImageFinding::Unidentified(None)]
        );
    }

    #[test]
    fn a_name_outside_the_project_is_never_read() {
        let outside = project(&[("secret.png", b"")]);
        let directory = project(&[
            ("main.tex", b"\\includegraphics{figures/used.png}"),
            ("figures/used.png", b""),
            ("figures/empty.png", b""),
        ]);
        for name in [
            outside.path().join("secret.png").display().to_string(),
            "../secret.png".to_string(),
        ] {
            let log = format!("! Unable to load picture or PDF file '{name}'.\n");
            assert_eq!(
                paths(&diagnose_image_failures(
                    directory.path(),
                    Some("main.tex"),
                    &log
                )),
                ["figures/used.png"]
            );
            assert!(diagnose_image_failures(directory.path(), None, &log).is_empty());
        }
    }

    #[test]
    fn document_references_follow_inputs_graphics_paths_and_engine_extension_order() {
        let scan = scan_source(
            "\\graphicspath{{figures/}{img/}}\n\\includegraphics*[width=2cm][x]{plot}% \\includegraphics{hidden}\n\\input{chapters/one}\\include{two}\n\\includegraphics{\\figname}\n100\\% \\includegraphics{\"my file\".png}\n",
        );
        assert_eq!(scan.graphics_paths, ["figures/", "img/"]);
        assert_eq!(scan.images, ["plot", "\"my file\".png"]);
        assert_eq!(scan.inputs, ["chapters/one", "two"]);
        let directory = project(&[
            (
                "main.tex",
                b"\\graphicspath{{figures/}}\n\\input{chapters/one}\n\\includegraphics{plot}\n",
            ),
            (
                "chapters/one.tex",
                b"\\includegraphics{photo.jpg}\n\\includegraphics{../outside.png}\n",
            ),
            ("figures/plot.pdf", &pdf()),
            ("figures/plot.png", &png()),
            ("figures/photo.jpg", &jpeg()),
        ]);
        let root = directory.path().canonicalize().unwrap();
        let mut probes = MAX_PATH_PROBES;
        let found: Vec<String> = document_images(&root, Some("main.tex"), &mut probes)
            .iter()
            .map(|file| slash_path(file.strip_prefix(&root).unwrap()))
            .collect();
        assert_eq!(found, ["figures/plot.pdf", "figures/photo.jpg"]);
    }

    #[test]
    fn reports_checks_and_bytes_are_capped() {
        let names: Vec<String> = (0..MAX_IMAGE_CARDS + 3)
            .map(|index| format!("figures/{index:02}.png"))
            .collect();
        let mut source = String::new();
        let mut files: Vec<(&str, &[u8])> = Vec::new();
        for name in &names {
            source.push_str(&format!("\\includegraphics{{{name}}}\n"));
            files.push((name.as_str(), b""));
        }
        files.push(("main.tex", source.as_bytes()));
        let directory = project(&files);
        let found = diagnose_image_failures(
            directory.path(),
            Some("main.tex"),
            "libpng error: Read Error\n",
        );
        assert_eq!(paths(&found), ["figures/00.png", "figures/01.png"]);

        let valid = png();
        let many: Vec<String> = (0..MAX_IMAGE_CHECKS)
            .map(|index| format!("figures/ok{index:03}.png"))
            .collect();
        let mut source = String::new();
        let mut files: Vec<(&str, &[u8])> = Vec::new();
        for name in &many {
            source.push_str(&format!("\\includegraphics{{{name}}}\n"));
            files.push((name.as_str(), &valid));
        }
        source.push_str("\\includegraphics{figures/late.png}\n");
        files.push(("figures/late.png", b""));
        files.push(("main.tex", source.as_bytes()));
        let directory = project(&files);
        assert_eq!(
            diagnose_image_failures(
                directory.path(),
                Some("main.tex"),
                "libpng error: Read Error\n"
            ),
            [ImageFinding::Unidentified(Some(PNG))]
        );

        let directory = project(&[("plot.png", &with_bad_crc(png(), b"IDAT", 0))]);
        let path = directory.path().join("plot.png");
        assert_eq!(inspect(&path, PNG, true, &mut Budget::new(200)), None);
        let mut budget = Budget::new(MAX_SCAN_BYTES);
        assert_eq!(
            inspect(&path, PNG, true, &mut budget),
            Some(ImageProblem::Corrupt(PNG))
        );
        assert!(budget.remaining < MAX_SCAN_BYTES);
    }

    #[test]
    fn image_cards_lead_only_when_certain_and_within_the_ask_ai_budget() {
        let named = ImageFinding::Broken(BrokenImage {
            path: "a.png".into(),
            problem: ImageProblem::Empty,
        });
        let hint = ImageFinding::Unidentified(Some(PNG));
        assert!(image_findings_lead(
            std::slice::from_ref(&named),
            ASK_AI_ERROR_BUDGET - 1
        ));
        assert!(!image_findings_lead(
            std::slice::from_ref(&named),
            ASK_AI_ERROR_BUDGET
        ));
        assert!(!image_findings_lead(
            &[named.clone(), named.clone()],
            ASK_AI_ERROR_BUDGET - 1
        ));
        assert!(!image_findings_lead(std::slice::from_ref(&hint), 0));
        assert!(!image_findings_lead(&[], 0));

        let mut errors = vec!["tex 1".to_string(), "warn".to_string(), "tex 2".to_string()];
        place_image_findings(
            &mut errors,
            std::slice::from_ref(&named),
            |e| e.starts_with("tex"),
            |m| m,
        );
        assert_eq!(errors[0], named.message());
        assert_eq!(errors[1..], ["tex 1", "warn", "tex 2"]);

        let mut errors: Vec<String> = (0..ASK_AI_ERROR_BUDGET)
            .map(|i| format!("tex {i}"))
            .collect();
        place_image_findings(
            &mut errors,
            std::slice::from_ref(&named),
            |e| e.starts_with("tex"),
            |m| m,
        );
        assert_eq!(errors.last().unwrap(), &named.message());
        assert!(errors[..ASK_AI_ERROR_BUDGET]
            .iter()
            .all(|e| e.starts_with("tex")));

        let mut errors = vec!["tex 1".to_string()];
        place_image_findings(
            &mut errors,
            std::slice::from_ref(&hint),
            |e| e.starts_with("tex"),
            |m| m,
        );
        assert_eq!(errors, ["tex 1".to_string(), hint.message()]);
    }

    #[test]
    fn notes_put_each_message_on_its_own_oleafly_line() {
        let findings = [
            ImageFinding::Broken(BrokenImage {
                path: "a.png".into(),
                problem: ImageProblem::Empty,
            }),
            ImageFinding::Unidentified(None),
        ];
        let notes = image_failure_notes(&findings);
        assert_eq!(
            notes,
            format!(
                "\n[Oleafly] {}\n\n[Oleafly] {}\n",
                findings[0].message(),
                findings[1].message()
            )
        );
        assert!(notes
            .lines()
            .filter(|line| !line.is_empty())
            .all(is_image_note));
        assert!(!is_image_note("[Oleafly] Engine output:"));
    }
}
