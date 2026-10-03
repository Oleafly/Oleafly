use crate::compile_log::LogCategory;
use serde::Serialize;
use std::path::Path;

#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq, Hash)]
#[serde(rename_all = "lowercase")]
pub enum TypstSeverity {
    Error,
    Warning,
}

impl TypstSeverity {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Error => "error",
            Self::Warning => "warning",
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TypstSpan {
    pub file: String,
    pub line: u32,
    pub column: u32,
    pub width: Option<u32>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TypstDiagnostic {
    pub severity: TypstSeverity,
    pub message: String,
    pub span: Option<TypstSpan>,
    pub hints: Vec<String>,
    pub trace: Vec<TypstSpan>,
}

impl TypstDiagnostic {
    pub fn user_span(&self) -> Option<&TypstSpan> {
        match &self.span {
            Some(span) if !is_typst_package_path(&span.file) => Some(span),
            span => self
                .trace
                .iter()
                .find(|point| !is_typst_package_path(&point.file))
                .or(span.as_ref()),
        }
    }

    pub fn category(&self) -> LogCategory {
        typst_log_category(self.severity, &self.message)
    }
}

pub fn is_typst_package_path(file: &str) -> bool {
    file.trim_start().starts_with('@')
}

pub fn is_unresolved_typst_label(message: &str) -> bool {
    message.starts_with("label `<") && message.contains("` does not exist in the document")
}

pub fn is_unresolved_typst_citation(message: &str) -> bool {
    (message.starts_with("key `") && message.contains("` does not exist in the bibliography"))
        || (message.starts_with("citation key `")
            && message.contains("` is not present in the bibliography"))
}

pub fn typst_log_category(severity: TypstSeverity, message: &str) -> LogCategory {
    let message = message.trim();
    if is_unresolved_typst_label(message) {
        LogCategory::UndefinedReference
    } else if is_unresolved_typst_citation(message) {
        LogCategory::UndefinedCitation
    } else if severity == TypstSeverity::Error {
        LogCategory::Error
    } else {
        LogCategory::PackageWarning
    }
}

pub fn parse_typst_location(text: &str) -> Option<TypstSpan> {
    let text = text.trim();
    let (rest, column) = text.rsplit_once(':')?;
    let (file, line) = rest.rsplit_once(':')?;
    let column = column.parse::<u32>().ok()?;
    let line = line.parse::<u32>().ok().filter(|line| *line > 0)?;
    if file.trim().is_empty() {
        return None;
    }
    Some(TypstSpan {
        file: file.to_owned(),
        line,
        column,
        width: None,
    })
}

fn normalized_path(path: &str) -> String {
    let mut normalized = path.trim().replace('\\', "/");
    while let Some(rest) = normalized.strip_prefix("./") {
        normalized = rest.to_owned();
    }
    normalized
}

fn absolute_like(path: &str) -> bool {
    let bytes = path.as_bytes();
    path.starts_with('/')
        || (bytes.len() >= 3
            && bytes[0].is_ascii_alphabetic()
            && bytes[1] == b':'
            && bytes[2] == b'/')
}

fn without_verbatim_prefix(path: String) -> String {
    if let Some(rest) = path.strip_prefix("//?/UNC/") {
        return format!("//{rest}");
    }
    match path.strip_prefix("//?/") {
        Some(rest) => rest.to_owned(),
        None => path,
    }
}

pub fn typst_path_relative_to(reported: &str, directory: &Path) -> String {
    let reported = without_verbatim_prefix(normalized_path(reported));
    if !absolute_like(&reported) {
        return reported;
    }
    let base = without_verbatim_prefix(normalized_path(&directory.to_string_lossy()));
    let base = base.trim_end_matches('/');
    if base.is_empty() {
        return reported;
    }
    let drive_like = base.as_bytes().get(1) == Some(&b':') || base.starts_with("//");
    let comparable = |text: &str| {
        if drive_like {
            text.to_ascii_lowercase()
        } else {
            text.to_owned()
        }
    };
    let stripped = comparable(&reported)
        .strip_prefix(&comparable(base))
        .and_then(|rest| rest.strip_prefix('/'))
        .map(str::len);
    match stripped {
        Some(length) if length > 0 => reported[reported.len() - length..].to_owned(),
        _ => reported,
    }
}

pub fn typst_paths_match(reported: &str, expected: &str) -> bool {
    let reported = normalized_path(reported);
    let expected = normalized_path(expected);
    if reported.is_empty() || expected.is_empty() || is_typst_package_path(&reported) {
        return false;
    }
    reported == expected
        || (absolute_like(&reported) && reported.ends_with(&format!("/{expected}")))
}

fn wide_character(character: char) -> bool {
    matches!(
        u32::from(character),
        0x1100..=0x115F
            | 0x2E80..=0x303E
            | 0x3041..=0x33FF
            | 0x3400..=0x4DBF
            | 0x4E00..=0x9FFF
            | 0xA000..=0xA4CF
            | 0xAC00..=0xD7A3
            | 0xF900..=0xFAFF
            | 0xFE30..=0xFE4F
            | 0xFF00..=0xFF60
            | 0xFFE0..=0xFFE6
            | 0x1F300..=0x1F64F
            | 0x1F900..=0x1F9FF
            | 0x20000..=0x3FFFD
    )
}

fn zero_width_character(character: char) -> bool {
    matches!(
        u32::from(character),
        0x0300..=0x036F | 0x200B..=0x200F | 0xFE00..=0xFE0F | 0xFE20..=0xFE2F
    )
}

fn advance_display(column: u32, character: char) -> u32 {
    if character == '\t' {
        column + 2 - column % 2
    } else if zero_width_character(character) {
        column
    } else if wide_character(character) {
        column + 2
    } else {
        column + 1
    }
}

pub fn typst_display_end(line: &str, start: usize, width: u32) -> usize {
    let characters: Vec<char> = line.chars().collect();
    let start = start.min(characters.len());
    let mut column = characters[..start]
        .iter()
        .fold(0, |column, character| advance_display(column, *character));
    let target = column + width;
    let mut end = start;
    while end < characters.len() && column < target {
        column = advance_display(column, characters[end]);
        end += 1;
    }
    end
}

#[derive(Clone, Copy)]
enum Block {
    None,
    Diagnostic,
    Help { located: bool },
}

fn header(line: &str) -> Option<(Option<TypstSeverity>, &str)> {
    [
        ("error: ", Some(TypstSeverity::Error)),
        ("warning: ", Some(TypstSeverity::Warning)),
        ("help: ", None),
    ]
    .into_iter()
    .find_map(|(label, severity)| line.strip_prefix(label).map(|message| (severity, message)))
}

fn short_line(line: &str) -> Option<(Option<TypstSeverity>, TypstSpan, &str)> {
    [
        (": error: ", Some(TypstSeverity::Error)),
        (": warning: ", Some(TypstSeverity::Warning)),
        (": help: ", None),
    ]
    .into_iter()
    .find_map(|(label, severity)| {
        let (location, message) = line.split_once(label)?;
        Some((severity, parse_typst_location(location)?, message))
    })
}

fn locus(trimmed: &str) -> Option<&str> {
    trimmed
        .strip_prefix("┌─")
        .or_else(|| trimmed.strip_prefix("-->"))
        .map(str::trim)
}

fn gutter(trimmed: &str) -> Option<&str> {
    trimmed
        .strip_prefix('│')
        .or_else(|| trimmed.strip_prefix('|'))
}

fn source_line(trimmed: &str) -> bool {
    let rest = trimmed.trim_start_matches(|character: char| character.is_ascii_digit());
    rest.len() < trimmed.len() && (rest.starts_with(" │") || rest.starts_with(" |"))
}

fn trace_point(trimmed: &str) -> Option<TypstSpan> {
    let (_, location) = trimmed.rsplit_once(" at ")?;
    parse_typst_location(location)
}

fn apply_caret(span: &mut TypstSpan, markers: &str, multiline: &mut bool) {
    if !markers.contains('^') || *multiline {
        return;
    }
    if markers.contains(['╭', '╰', '─', '_']) {
        *multiline = true;
        span.width = None;
        return;
    }
    if span.width.is_none() {
        let width = markers
            .chars()
            .filter(|character| *character == '^')
            .count();
        span.width = u32::try_from(width).ok();
    }
}

fn new_diagnostic(
    severity: TypstSeverity,
    message: &str,
    span: Option<TypstSpan>,
) -> TypstDiagnostic {
    TypstDiagnostic {
        severity,
        message: message.trim().to_owned(),
        span,
        hints: Vec::new(),
        trace: Vec::new(),
    }
}

fn help_line(
    current: &mut TypstDiagnostic,
    trimmed: &str,
    located: bool,
    multiline: &mut bool,
) -> bool {
    if let Some(location) = locus(trimmed) {
        if located {
            return false;
        }
        let Some(point) = parse_typst_location(location) else {
            return false;
        };
        current.trace.push(point);
        return true;
    }
    if let Some(markers) = gutter(trimmed) {
        if let (true, Some(point)) = (located, current.trace.last_mut()) {
            apply_caret(point, markers, multiline);
        }
    }
    false
}

fn diagnostic_detail(current: &mut TypstDiagnostic, trimmed: &str, multiline: &mut bool) {
    if let Some(location) = locus(trimmed) {
        if current.span.is_none() {
            current.span = parse_typst_location(location);
        }
    } else if let Some(markers) = gutter(trimmed) {
        if let Some(span) = current.span.as_mut() {
            apply_caret(span, markers, multiline);
        }
    } else if !source_line(trimmed) {
        if let Some(point) = trace_point(trimmed) {
            current.trace.push(point);
        }
    }
}

fn diagnostic_line(
    current: &mut TypstDiagnostic,
    trimmed: &str,
    indent: usize,
    hint_indent: Option<usize>,
    multiline: &mut bool,
) -> Option<usize> {
    if hint_indent.is_some_and(|start| indent > start) {
        if let Some(hint) = current.hints.last_mut() {
            hint.push('\n');
            hint.push_str(trimmed.trim_end());
        }
        return hint_indent;
    }
    if let Some(hint) = trimmed.strip_prefix("= hint:") {
        current.hints.push(hint.trim().to_owned());
        return Some(indent);
    }
    diagnostic_detail(current, trimmed, multiline);
    None
}

struct DiagnosticParser {
    diagnostics: Vec<TypstDiagnostic>,
    block: Block,
    multiline: bool,
    hint_indent: Option<usize>,
}

impl DiagnosticParser {
    const fn new() -> Self {
        Self {
            diagnostics: Vec::new(),
            block: Block::None,
            multiline: false,
            hint_indent: None,
        }
    }

    fn line(&mut self, raw: &str) {
        let line = raw.trim_end_matches('\r');
        let trimmed = line.trim_start();
        let indent = line.len() - trimmed.len();
        if trimmed.trim_end().is_empty() || (indent == 0 && source_line(trimmed)) {
            self.hint_indent = None;
        } else if indent == 0 {
            self.top_level_line(line);
        } else {
            self.indented_line(trimmed, indent);
        }
    }

    fn top_level_line(&mut self, line: &str) {
        self.hint_indent = None;
        self.multiline = false;
        if let Some((severity, message)) = header(line) {
            self.block = self.open_block(severity, message);
            return;
        }
        self.block = Block::None;
        if let Some((severity, span, message)) = short_line(line) {
            self.short_diagnostic(severity, span, message);
        }
    }

    fn open_block(&mut self, severity: Option<TypstSeverity>, message: &str) -> Block {
        match severity {
            Some(severity) => {
                self.diagnostics
                    .push(new_diagnostic(severity, message, None));
                Block::Diagnostic
            }
            None if self.diagnostics.is_empty() => Block::None,
            None => Block::Help { located: false },
        }
    }

    fn short_diagnostic(
        &mut self,
        severity: Option<TypstSeverity>,
        span: TypstSpan,
        message: &str,
    ) {
        match severity {
            Some(severity) => self
                .diagnostics
                .push(new_diagnostic(severity, message, Some(span))),
            None => {
                if let Some(last) = self.diagnostics.last_mut() {
                    last.trace.push(span);
                }
            }
        }
    }

    fn indented_line(&mut self, trimmed: &str, indent: usize) {
        let Some(current) = self.diagnostics.last_mut() else {
            return;
        };
        match self.block {
            Block::None => {}
            Block::Help { located } => {
                if help_line(current, trimmed, located, &mut self.multiline) {
                    self.block = Block::Help { located: true };
                }
            }
            Block::Diagnostic => {
                self.hint_indent = diagnostic_line(
                    current,
                    trimmed,
                    indent,
                    self.hint_indent,
                    &mut self.multiline,
                );
            }
        }
    }
}

pub fn parse_typst_diagnostics(log: &str) -> Vec<TypstDiagnostic> {
    let mut parser = DiagnosticParser::new();
    for raw in log.lines() {
        parser.line(raw);
    }
    parser.diagnostics
}
