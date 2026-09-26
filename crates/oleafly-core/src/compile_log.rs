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
const SPACE_CHARS: &str = js_space!();
const ENGINE_OUTPUT_MARKER: &str = "[Oleafly] Engine output:";
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
    biber_missing_entry_raw: Regex,
    biber_cannot_find: Regex,
    biber_version_mismatch: Regex,
    biber_bibtex_line: Regex,
    tectonic_cannot_open: Regex,
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
    bare_path: Regex,
    leading_paren: Regex,
    tectonic_summary: Regex,
    error_help: Regex,
    wrapped_reference: Regex,
    trailing_input_line: Regex,
    wrapped_line_number: Regex,
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
        biber_missing_entry_raw: compile(
            r"^WARN - I didn't find a database entry for '([^']+)'".into(),
        ),
        biber_cannot_find: compile(r"^ERROR - Cannot find '([^']+)'".into()),
        biber_version_mismatch: compile(
            r"^ERROR - Error: Found biblatex control file version ([^,]+), expected version ([0-9][0-9.]*[0-9])"
                .into(),
        ),
        biber_bibtex_line: compile(
            r"^ERROR - BibTeX subsystem: (.+?), line ([0-9]+), (.*)$".into(),
        ),
        tectonic_cannot_open: compile(r"^error: can't open path `([^`]+)`".into()),
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
        bare_path: compile(format!(
            r#"^"?([\p{{N}}_-]*[\p{{L}}_][^{SPACE_CHARS}"()\[\]/:]*/[^{SPACE_CHARS}"()\[\]]*[^{SPACE_CHARS}"()\[\]./])"#
        )),
        leading_paren: compile(format!(r"^{SPACE}*[()]")),
        tectonic_summary: compile(format!(r"^(?:error|warning): {ANY}+:[0-9]+: ")),
        error_help: compile(format!(
            r"^(?:See the {ANY}+ for explanation\.|Type {{2}}H <return> {{2}}for immediate help\.?)$"
        )),
        wrapped_reference: compile(
            r"(?s)^LaTeX: (Reference|Citation) `(.*?)' on page [0-9]+ undefined on input line ([0-9]+)\.$"
                .into(),
        ),
        trailing_input_line: compile(r"on input line ([0-9]+)\.?$".into()),
        wrapped_line_number: compile(r"^([^\n]*)\n([0-9]+)(\.?)$".into()),
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
    fn unwrap_warning(&mut self) {
        let text = trim_end_js(&self.text);
        let unwrappable = matches!(
            self.category,
            LogCategory::PackageWarning | LogCategory::Info
        );
        if !unwrappable || !text.contains('\n') || text.contains("\n(") {
            return;
        }
        let p = patterns();
        if let (Some(caps), Some(line)) = (p.wrapped_line_number.captures(text), self.line) {
            self.line = format!("{line}{}", &caps[2]).parse().ok();
            self.text = format!("{}{}", &caps[1], &caps[3]);
            return;
        }
        let joined = text.replace('\n', "");
        let reference = (self.category == LogCategory::PackageWarning)
            .then(|| p.wrapped_reference.captures(&joined))
            .flatten();
        if let Some(caps) = reference {
            let kind = &caps[1];
            self.category = if kind == "Citation" {
                LogCategory::UndefinedCitation
            } else {
                LogCategory::UndefinedReference
            };
            self.line = parse_number(caps.get(3));
            self.text = format!("Cannot find {} `{}`.", kind.to_lowercase(), &caps[2]);
            return;
        }
        if let Some(caps) = p.trailing_input_line.captures(&joined) {
            self.line = parse_number(caps.get(1));
        }
    }

    fn finalize(mut self) -> LogDiagnostic {
        self.unwrap_warning();
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
    awaiting_error_line: bool,
    awaited_lines: usize,
    in_engine_output: bool,
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

pub(crate) fn head(log: &str) -> &str {
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
        awaiting_error_line: false,
        awaited_lines: 0,
        in_engine_output: false,
        current: None,
        nested: 0,
        root_file,
        file_stack: root_file
            .map(|root| vec![root.to_string()])
            .unwrap_or_default(),
        out: Vec::new(),
    };
    for line in head(log).split('\n') {
        // Windows compiler pipes use CRLF. Keep the line terminator out of
        // anchored patterns and diagnostic context, matching the LF path.
        parser.parse_line(line.strip_suffix('\r').unwrap_or(line));
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

    fn end_entry(&mut self) {
        self.search_empty_line = false;
        self.inside_error = false;
        self.awaiting_error_line = false;
        self.awaited_lines = 0;
    }

    fn skip_engine_output(&mut self, p: &Patterns, line: &str) -> bool {
        if trim_end_js(line) == ENGINE_OUTPUT_MARKER {
            self.push_current();
            self.end_entry();
            self.in_engine_output = true;
            return true;
        }
        if !self.in_engine_output {
            return false;
        }
        if line.starts_with("[Oleafly]") {
            self.in_engine_output = false;
            return false;
        }
        !p.tectonic_cannot_open.is_match(line)
    }

    fn starts_new_entry(p: &Patterns, line: &str, inside_error: bool) -> bool {
        if line.starts_with('!') {
            return true;
        }
        if inside_error {
            return false;
        }
        p.leading_paren.is_match(line)
            || p.undefined_reference.is_match(line)
            || p.latex_info.is_match(line)
            || p.latex_warn.is_match(line)
            || line == "No pages of output."
            || p.missing_char.is_match(line)
            || [
                &p.overfull_box,
                &p.overfull_box_alt,
                &p.overfull_box_output,
                &p.underfull_box,
                &p.underfull_box_alt,
                &p.underfull_box_output,
            ]
            .iter()
            .any(|regex| regex.is_match(line))
    }

    fn start(&mut self, entry: Entry) {
        self.push_current();
        self.current = Some(entry);
    }

    fn biber_entry(&self, p: &Patterns, line: &str) -> Option<Entry> {
        let biber =
            |severity: LogSeverity, file: Option<String>, line: Option<u32>, text: String| Entry {
                severity,
                category: LogCategory::Biber,
                file,
                line,
                text,
                context: None,
            };
        if let Some(caps) = p.biber_missing_entry_raw.captures(line) {
            return Some(biber(
                LogSeverity::Warning,
                None,
                None,
                format!("No bib entry found for '{}'", &caps[1]),
            ));
        }
        if let Some(caps) = p.biber_cannot_find.captures(line) {
            return Some(biber(
                LogSeverity::Error,
                None,
                None,
                format!(
                    "Biber could not find {}. Check the file name in \\addbibresource and that the file is in the project.",
                    &caps[1]
                ),
            ));
        }
        if let Some(caps) = p.biber_version_mismatch.captures(line) {
            return Some(biber(
                LogSeverity::Error,
                None,
                None,
                format!(
                    "Biber and biblatex versions do not match (control file {}, expected {}). Oleafly uses its pinned Biber for the built-in engine; if this appears, report it with the compile log.",
                    &caps[1], &caps[2]
                ),
            ));
        }
        if let Some(caps) = p.biber_bibtex_line.captures(line) {
            return Some(biber(
                LogSeverity::Error,
                Some(caps[1].to_string()),
                caps[2].parse().ok(),
                caps[3].to_string(),
            ));
        }
        None
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
        if self.skip_engine_output(p, line) {
            return Step::Stop;
        }
        if let Some(entry) = oleafly_note(p, line) {
            self.push_current();
            self.end_entry();
            self.current = Some(entry);
            return Step::Stop;
        }
        if self.search_empty_line {
            return self.continue_current(line);
        }
        if p.tectonic_summary.is_match(line) {
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
        if let Some(caps) = p.tectonic_cannot_open.captures(line) {
            self.start(Entry {
                severity: LogSeverity::Error,
                category: LogCategory::Error,
                file: None,
                line: None,
                text: format!(
                    "The compile could not open {}. Check the file name and that the file is in the project.",
                    &caps[1]
                ),
                context: None,
            });
            self.search_empty_line = false;
            self.inside_error = false;
            return Step::Stop;
        }
        if line.starts_with("ERROR - ") || line.starts_with("WARN - ") {
            if let Some(entry) = self.biber_entry(p, line) {
                self.start(entry);
                self.search_empty_line = false;
                self.inside_error = false;
                return Step::Stop;
            }
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

    fn continue_current(&mut self, line: &str) -> Step {
        let p = patterns();
        if self.awaiting_error_line {
            return self.await_error_line(line);
        }
        if p.tectonic_summary.is_match(line) {
            return Step::Stop;
        }
        if trim_js(line).is_empty() || (self.inside_error && p.leading_whitespace.is_match(line)) {
            if let Some(current) = &mut self.current {
                current.text.push('\n');
            }
            if self.inside_error && self.current.as_ref().is_some_and(|c| c.line.is_none()) {
                self.awaiting_error_line = true;
                return Step::Stop;
            }
            self.end_entry();
            return Step::Stop;
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
            return Step::Stop;
        }
        if Self::starts_new_entry(p, line, self.inside_error) {
            self.end_entry();
            return self.parse_line_once(line);
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
                self.end_entry();
                return Step::Stop;
            }
        }
        if let Some(current) = &mut self.current {
            current.text.push('\n');
            current.text.push_str(line);
        }
        Step::Stop
    }

    fn await_error_line(&mut self, line: &str) -> Step {
        let p = patterns();
        if let Some(caps) = p.message_line.captures(line) {
            if let Some(current) = &mut self.current {
                if let Some(context) = current.context.as_mut() {
                    if context.len() < MAX_ERROR_CONTEXT_LINES {
                        context.push(line.to_string());
                    }
                }
                if current.line.is_none() {
                    current.line = parse_number(caps.get(1));
                }
            }
            self.end_entry();
            return Step::Stop;
        }
        let help_shaped = trim_js(line).is_empty()
            || (p.leading_whitespace.is_match(line) && !p.leading_paren.is_match(line))
            || p.error_help.is_match(line);
        if help_shaped && self.awaited_lines < MAX_ERROR_CONTEXT_LINES {
            self.awaited_lines += 1;
            return Step::Stop;
        }
        self.end_entry();
        self.parse_line_once(line)
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

fn oleafly_note(p: &Patterns, line: &str) -> Option<Entry> {
    let category = if line.starts_with("[Oleafly]")
        && (p.oleafly_biber_mode_a.is_match(line)
            || p.oleafly_biber_mode_b.is_match(line)
            || p.oleafly_biber_gap.is_match(line))
    {
        LogCategory::Biber
    } else if crate::image_check::is_image_note(line) {
        LogCategory::Error
    } else {
        return None;
    };
    Some(Entry {
        severity: LogSeverity::Error,
        category,
        file: None,
        line: None,
        text: trim_js(&p.oleafly_prefix.replace(line, "")).to_string(),
        context: None,
    })
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
            } else if let Some(caps) = p.bare_path.captures(rest) {
                file_stack.push(format!("./{}", &caps[1]));
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
