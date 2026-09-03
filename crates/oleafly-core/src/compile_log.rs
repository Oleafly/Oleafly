use regex::Regex;
use serde::{Deserialize, Serialize};
use std::sync::OnceLock;

pub const MAX_COMPILE_LOG_BYTES: usize = 4 * 1024 * 1024;

const MAX_ERROR_CONTEXT_LINES: usize = 12;

const BIBER_RERUN_MESSAGE: &str = "Bibliography needs Biber (biblatex). Oleafly should run pinned tectonic-biber automatically. If citations stay undefined, see [Oleafly] notes in this log.";

const ANY: &str = r"[^\r\n\u{2028}\u{2029}]";

macro_rules! js_space {
    () => {
        r"\t\n\v\f\r \u{a0}\u{1680}\u{2000}-\u{200a}\u{2028}\u{2029}\u{202f}\u{205f}\u{3000}\u{feff}"
    };
}

const SPACE: &str = concat!("[", js_space!(), "]");
const NON_SPACE: &str = concat!("[^", js_space!(), "]");

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq, Hash)]
#[serde(rename_all = "lowercase")]
pub enum LogSeverity {
    Error,
    Warning,
    Info,
    Typesetting,
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq, Hash)]
#[serde(rename_all = "kebab-case")]
pub enum LogCategory {
    Error,
    UndefinedReference,
    UndefinedCitation,
    PackageWarning,
    OverfullBox,
    UnderfullBox,
    MissingCharacter,
    Info,
    Bibtex,
    Biber,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct LogDiagnostic {
    pub severity: LogSeverity,
    pub message: String,
    pub file: Option<String>,
    pub line: Option<u32>,
    pub category: LogCategory,
    #[serde(
        rename = "errorContext",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub error_context: Option<String>,
}

struct Patterns {
    latex_error: Regex,
    overfull_box: Regex,
    overfull_box_alt: Regex,
    overfull_box_output: Regex,
    underfull_box: Regex,
    underfull_box_alt: Regex,
    underfull_box_output: Regex,
    latex_info: Regex,
    latex_warn: Regex,
    package_warning_extra_lines: Regex,
    missing_char: Regex,
    bib_empty: Regex,
    biber_warn: Regex,
    biblatex_rerun_biber: Regex,
    oleafly_biber_mode_a: Regex,
    oleafly_biber_mode_b: Regex,
    oleafly_biber_gap: Regex,
    oleafly_prefix: Regex,
    undefined_reference: Regex,
    message_line: Regex,
    leading_whitespace: Regex,
    paren: Regex,
    path: Regex,
    miktex_path: Regex,
}

fn compile(pattern: String) -> Regex {
    Regex::new(&pattern).unwrap_or_else(|error| panic!("invalid compile log pattern: {error}"))
}

fn patterns() -> &'static Patterns {
    static PATTERNS: OnceLock<Patterns> = OnceLock::new();
    PATTERNS.get_or_init(|| Patterns {
        latex_error: compile(format!(
            r"^(?:({ANY}*):([0-9]+):|!)(?:{SPACE}?({ANY}+) [Ee]rror:)? ({ANY}+?)$"
        )),
        overfull_box: compile(
            r"^(Overfull \\[vh]box \([^)]*\)) in paragraph at lines ([0-9]+)--([0-9]+)$".into(),
        ),
        overfull_box_alt: compile(
            r"^(Overfull \\[vh]box \([^)]*\)) detected at line ([0-9]+)$".into(),
        ),
        overfull_box_output: compile(
            r"^(Overfull \\[vh]box \([^)]*\)) has occurred while \\output is active(?: \[([0-9]+)\])?"
                .into(),
        ),
        underfull_box: compile(
            r"^(Underfull \\[vh]box \([^)]*\)) in paragraph at lines ([0-9]+)--([0-9]+)$".into(),
        ),
        underfull_box_alt: compile(
            r"^(Underfull \\[vh]box \([^)]*\)) detected at line ([0-9]+)$".into(),
        ),
        underfull_box_output: compile(
            r"^(Underfull \\[vh]box \([^)]*\)) has occurred while \\output is active(?: \[([0-9]+)\])?"
                .into(),
        ),
        latex_info: compile(format!(
            r"^((?:(?:Class|Package|Module) {NON_SPACE}*)|LaTeX(?: {NON_SPACE}*)?|LaTeX3) (Info):{SPACE}+({ANY}*?)(?: on(?: input)? line ([0-9]+))?(\.|\?|)$"
        )),
        latex_warn: compile(format!(
            r"^((?:(?:Class|Package|Module) {NON_SPACE}*)|LaTeX(?: {NON_SPACE}*)?|LaTeX3) (Warning):{SPACE}+({ANY}*?)(?: on(?: input)? line ([0-9]+))?(\.|\?|)$"
        )),
        package_warning_extra_lines: compile(format!(
            r"^\(({ANY}*)\){SPACE}+({ANY}*?)(?: +on input line ([0-9]+))?(\.)?$"
        )),
        missing_char: compile(format!(r"^{SPACE}*(Missing character:{ANY}*?!)")),
        bib_empty: compile(r"^Empty `thebibliography' environment".into()),
        biber_warn: compile(format!(
            r"^Biber warning:{ANY}*WARN - I didn't find a database entry for '([^']+)'"
        )),
        biblatex_rerun_biber: compile(
            r"^Package biblatex Warning: Please \(re\)run Biber on the file:".into(),
        ),
        oleafly_biber_mode_a: compile(r"^\[Oleafly\] Biber was not found \(mode A\)".into()),
        oleafly_biber_mode_b: compile(
            r"^\[Oleafly\] Biber/biblatex version mismatch \(mode B\)".into(),
        ),
        oleafly_biber_gap: compile(r"^\[Oleafly\] Bibliography needs Biber".into()),
        oleafly_prefix: compile(format!(r"^\[Oleafly\]{SPACE}*")),
        undefined_reference: compile(format!(
            r"^LaTeX Warning: (Reference|Citation) `({ANY}*?)' on page (?:[0-9]+) undefined on input line ([0-9]+){ANY}$"
        )),
        message_line: compile(format!(r"^l\.([0-9]+){SPACE}(\.\.\.)?({ANY}*)$")),
        leading_whitespace: compile(format!("^{SPACE}")),
        paren: compile(r"[()]".into()),
        path: compile(r#"^"?((?:(?:[a-zA-Z]:|\.|/)?(?:/|\\\\?))[^"()\[\]]*)"#.into()),
        miktex_path: compile(r#"^"?([^"()\[\]]*\.[a-z]{3,})"#.into()),
    })
}

struct Entry {
    severity: LogSeverity,
    category: LogCategory,
    file: Option<String>,
    line: Option<u32>,
    text: String,
    context: Option<Vec<String>>,
}

impl Entry {
    fn finalize(self) -> LogDiagnostic {
        let error_context = self
            .context
            .map(|lines| trim_end_js(&lines.join("\n")).to_string())
            .filter(|context| !context.is_empty());
        LogDiagnostic {
            severity: self.severity,
            message: trim_end_js(&self.text).to_string(),
            file: self.file,
            line: self.line,
            category: self.category,
            error_context,
        }
    }
}

struct Parser<'a> {
    search_empty_line: bool,
    inside_box_warn: bool,
    inside_error: bool,
    current: Option<Entry>,
    nested: usize,
    root_file: Option<&'a str>,
    file_stack: Vec<String>,
    out: Vec<LogDiagnostic>,
}

enum Step {
    Stop,
    Resume(usize),
}

fn is_js_space(c: char) -> bool {
    matches!(
        c,
        '\t' | '\n' | '\u{b}' | '\u{c}' | '\r' | ' ' | '\u{a0}' | '\u{1680}' | '\u{2000}'
            ..='\u{200a}'
                | '\u{2028}'
                | '\u{2029}'
                | '\u{202f}'
                | '\u{205f}'
                | '\u{3000}'
                | '\u{feff}'
    )
}

fn trim_js(text: &str) -> &str {
    text.trim_matches(is_js_space)
}

fn trim_end_js(text: &str) -> &str {
    text.trim_end_matches(is_js_space)
}

fn parse_number(capture: Option<regex::Match<'_>>) -> Option<u32> {
    capture.and_then(|m| m.as_str().parse::<u32>().ok())
}

fn head(log: &str) -> &str {
    if log.len() <= MAX_COMPILE_LOG_BYTES {
        return log;
    }
    let mut end = MAX_COMPILE_LOG_BYTES;
    while !log.is_char_boundary(end) {
        end -= 1;
    }
    &log[..end]
}

pub fn parse_latex_log(log: &str, root_file: Option<&str>) -> Vec<LogDiagnostic> {
    let mut parser = Parser {
        search_empty_line: false,
        inside_box_warn: false,
        inside_error: false,
        current: None,
        nested: 0,
        root_file,
        file_stack: root_file
            .map(|root| vec![root.to_string()])
            .unwrap_or_default(),
        out: Vec::new(),
    };
    for line in head(log).split('\n') {
        parser.parse_line(line);
    }
    if let Some(current) = parser.current.take() {
        if !patterns().bib_empty.is_match(&current.text) {
            parser.out.push(current.finalize());
        }
    }
    parser.out
}

impl Parser<'_> {
    fn push_current(&mut self) {
        if let Some(current) = self.current.take() {
            self.out.push(current.finalize());
        }
    }

    fn current_file(&self) -> Option<String> {
        self.file_stack
            .last()
            .cloned()
            .or_else(|| self.root_file.map(str::to_string))
    }

    fn start(&mut self, entry: Entry) {
        self.push_current();
        self.current = Some(entry);
    }

    fn parse_line(&mut self, line: &str) {
        let mut rest = line;
        while let Step::Resume(end) = self.parse_line_once(rest) {
            rest = &rest[end..];
        }
    }

    fn parse_line_once(&mut self, line: &str) -> Step {
        let p = patterns();
        let filename = self.current_file();
        if self.inside_box_warn {
            self.inside_box_warn = false;
            return Step::Stop;
        }
        if line.starts_with("[Oleafly]")
            && (p.oleafly_biber_mode_a.is_match(line)
                || p.oleafly_biber_mode_b.is_match(line)
                || p.oleafly_biber_gap.is_match(line))
        {
            self.push_current();
            self.search_empty_line = false;
            self.inside_error = false;
            self.current = Some(Entry {
                severity: LogSeverity::Error,
                category: LogCategory::Biber,
                file: None,
                line: None,
                text: trim_js(&p.oleafly_prefix.replace(line, "")).to_string(),
                context: None,
            });
            return Step::Stop;
        }
        if self.search_empty_line {
            self.continue_current(line);
            return Step::Stop;
        }
        if self.parse_undefined_reference(line, filename.as_deref()) {
            return Step::Stop;
        }
        if let Some(step) = self.parse_bad_box(line, filename.as_deref()) {
            return step;
        }
        if line == "No pages of output." {
            self.start(Entry {
                severity: LogSeverity::Error,
                category: LogCategory::Error,
                file: filename,
                line: None,
                text: line.to_string(),
                context: None,
            });
            self.search_empty_line = true;
            self.inside_error = true;
            return Step::Stop;
        }
        if let Some(caps) = line
            .contains("Missing character:")
            .then(|| p.missing_char.captures(line))
            .flatten()
        {
            self.start(Entry {
                severity: LogSeverity::Warning,
                category: LogCategory::MissingCharacter,
                file: filename,
                line: None,
                text: caps[1].to_string(),
                context: None,
            });
            self.search_empty_line = false;
            return Step::Stop;
        }
        if let Some(caps) = line
            .contains(" Info:")
            .then(|| p.latex_info.captures(line))
            .flatten()
        {
            self.start(Entry {
                severity: LogSeverity::Info,
                category: LogCategory::Info,
                file: filename,
                line: parse_number(caps.get(4)),
                text: format!(
                    "{}: {}{}",
                    &caps[1],
                    &caps[3],
                    caps.get(5).map_or("", |m| m.as_str())
                ),
                context: None,
            });
            self.search_empty_line = true;
            return Step::Stop;
        }
        if let Some(caps) = line
            .contains(" Warning:")
            .then(|| p.latex_warn.captures(line))
            .flatten()
        {
            if p.biblatex_rerun_biber.is_match(line) {
                self.start(Entry {
                    severity: LogSeverity::Warning,
                    category: LogCategory::Biber,
                    file: None,
                    line: None,
                    text: BIBER_RERUN_MESSAGE.to_string(),
                    context: None,
                });
                self.search_empty_line = false;
                return Step::Stop;
            }
            self.start(Entry {
                severity: LogSeverity::Warning,
                category: LogCategory::PackageWarning,
                file: filename,
                line: parse_number(caps.get(4)),
                text: format!(
                    "{}: {}{}",
                    &caps[1],
                    &caps[3],
                    caps.get(5).map_or("", |m| m.as_str())
                ),
                context: None,
            });
            self.search_empty_line = true;
            return Step::Stop;
        }
        if let Some(caps) = line
            .starts_with("Biber warning:")
            .then(|| p.biber_warn.captures(line))
            .flatten()
        {
            self.start(Entry {
                severity: LogSeverity::Warning,
                category: LogCategory::Biber,
                file: None,
                line: None,
                text: format!("No bib entry found for '{}'", &caps[1]),
                context: None,
            });
            self.search_empty_line = false;
            let end = caps.get(0).map_or(line.len(), |m| m.end());
            return Step::Resume(end);
        }
        if (line.starts_with('!') || line.contains(':')) && !line.contains("ignored error") {
            if let Some(caps) = p.latex_error.captures(line) {
                let text = match caps.get(3) {
                    Some(kind) if kind.as_str() != "LaTeX" => {
                        format!("{}: {}", kind.as_str(), &caps[4])
                    }
                    _ => caps[4].to_string(),
                };
                let file = caps
                    .get(1)
                    .map(|m| m.as_str())
                    .filter(|value| !value.is_empty())
                    .map(str::to_string)
                    .or(filename);
                self.start(Entry {
                    severity: LogSeverity::Error,
                    category: LogCategory::Error,
                    file,
                    line: parse_number(caps.get(2)),
                    text,
                    context: Some(vec![line.to_string()]),
                });
                self.search_empty_line = true;
                self.inside_error = true;
                return Step::Stop;
            }
        }
        self.nested = parse_file_stack(line, &mut self.file_stack, self.nested);
        if self.file_stack.is_empty() {
            if let Some(root) = self.root_file {
                self.file_stack.push(root.to_string());
            }
        }
        Step::Stop
    }

    fn continue_current(&mut self, line: &str) {
        let p = patterns();
        if trim_js(line).is_empty() || (self.inside_error && p.leading_whitespace.is_match(line)) {
            if let Some(current) = &mut self.current {
                current.text.push('\n');
            }
            self.search_empty_line = false;
            self.inside_error = false;
            return;
        }
        if let Some(caps) = p
            .package_warning_extra_lines
            .captures(line)
            .filter(|_| self.current.is_some())
        {
            if let Some(current) = &mut self.current {
                current.text.push_str(&format!(
                    "\n({})\t{}{}",
                    &caps[1],
                    &caps[2],
                    if caps.get(4).is_some() { "." } else { "" }
                ));
                current.line = parse_number(caps.get(3));
            }
            return;
        }
        if self.inside_error {
            if let Some(context) = self.current.as_mut().and_then(|c| c.context.as_mut()) {
                if context.len() < MAX_ERROR_CONTEXT_LINES {
                    context.push(line.to_string());
                }
            }
            if let Some(caps) = p.message_line.captures(line) {
                if let Some(current) = &mut self.current {
                    if current.line.is_none() {
                        current.line = parse_number(caps.get(1));
                    }
                }
                self.search_empty_line = false;
                self.inside_error = false;
                return;
            }
        }
        if let Some(current) = &mut self.current {
            current.text.push('\n');
            current.text.push_str(line);
        }
    }

    fn parse_undefined_reference(&mut self, line: &str, filename: Option<&str>) -> bool {
        if line == "LaTeX Warning: There were undefined references." {
            return true;
        }
        if !line.starts_with("LaTeX Warning: ") {
            return false;
        }
        let Some(caps) = patterns().undefined_reference.captures(line) else {
            return false;
        };
        let kind = &caps[1];
        self.start(Entry {
            severity: LogSeverity::Warning,
            category: if kind == "Citation" {
                LogCategory::UndefinedCitation
            } else {
                LogCategory::UndefinedReference
            },
            file: filename.map(str::to_string),
            line: parse_number(caps.get(3)),
            text: format!("Cannot find {} `{}`.", kind.to_lowercase(), &caps[2]),
            context: None,
        });
        self.search_empty_line = false;
        true
    }

    fn parse_bad_box(&mut self, line: &str, filename: Option<&str>) -> Option<Step> {
        if !(line.starts_with("Overfull \\") || line.starts_with("Underfull \\")) {
            return None;
        }
        let p = patterns();
        let candidates = [
            (&p.overfull_box, LogCategory::OverfullBox, false),
            (&p.overfull_box_alt, LogCategory::OverfullBox, false),
            (&p.overfull_box_output, LogCategory::OverfullBox, true),
            (&p.underfull_box, LogCategory::UnderfullBox, false),
            (&p.underfull_box_alt, LogCategory::UnderfullBox, false),
            (&p.underfull_box_output, LogCategory::UnderfullBox, true),
        ];
        for (regex, category, is_output) in candidates {
            let Some(caps) = regex.captures(line) else {
                continue;
            };
            if is_output {
                let text = match caps.get(2) {
                    Some(page) => format!("{} in page {}", &caps[1], page.as_str()),
                    None => caps[1].to_string(),
                };
                self.start(Entry {
                    severity: LogSeverity::Typesetting,
                    category,
                    file: filename.map(str::to_string),
                    line: None,
                    text,
                    context: None,
                });
                let end = caps.get(0).map_or(line.len(), |m| m.end());
                return Some(Step::Resume(end));
            }
            self.start(Entry {
                severity: LogSeverity::Typesetting,
                category,
                file: filename.map(str::to_string),
                line: parse_number(caps.get(2)),
                text: caps[1].to_string(),
                context: None,
            });
            self.inside_box_warn = true;
            self.search_empty_line = false;
            return Some(Step::Stop);
        }
        None
    }
}

fn parse_file_stack(line: &str, file_stack: &mut Vec<String>, mut nested: usize) -> usize {
    let p = patterns();
    let mut rest = line;
    loop {
        let Some(found) = p.paren.find(rest) else {
            return nested;
        };
        let paren = found.as_str();
        rest = &rest[found.end()..];
        if paren == "(" {
            if let Some(caps) = p.path.captures(rest) {
                file_stack.push(trim_js(&caps[1]).to_string());
            } else if let Some(caps) = p.miktex_path.captures(rest) {
                file_stack.push(format!("./{}", trim_js(&caps[1])));
            } else {
                nested += 1;
            }
        } else if nested > 0 {
            nested -= 1;
        } else {
            file_stack.pop();
        }
    }
}
