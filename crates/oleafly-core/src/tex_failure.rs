use crate::tex_errors::{CompileError, ENGINE_OUTPUT_MARKER};

const TECTONIC_FORMAT_FAILURE: &str = "failed to open input file \"tectonic-format-";
const BUNDLE_UNREACHABLE: [&str; 2] = [
    "this bundle isn't cached",
    "couldn't get it from the internet",
];
const UNOPENED_PATH_PREFIX: &str = "error: can't open path ";
const BIBER_ERROR_MARKER: &str = "ERROR - ";
const LATEXMK_SUMMARY: &str = "Collected error summary";
const NO_PAGES: &str = "No pages of output.";
const ERROR_LINE_PREFIX: &str = "error: ";
const HELPER_EXIT_PREFIX: &str = "error: the external tool exited with error code";
const ERROR_FRAMING: [&str; 3] = [
    "error: its stderr was",
    "error: its stdout was",
    "error: the external tool exited with an error code;",
];
const PIPE_INPUT_REFUSAL: &str = "can't find file `\"|";

fn failure(message: impl Into<String>, explanation: &str) -> CompileError {
    CompileError {
        message: message.into(),
        kind: "error".to_owned(),
        explanation: Some(explanation.to_owned()),
        ..Default::default()
    }
}

fn coded(mut error: CompileError, code: &str) -> CompileError {
    error.code = Some(code.to_owned());
    error
}

fn package_failure(lines: &[&str]) -> Option<CompileError> {
    if lines
        .iter()
        .any(|line| line.contains(TECTONIC_FORMAT_FAILURE))
    {
        return Some(coded(
            failure(
                "Tectonic has no cached packages yet",
                "Build once with a network connection, then --offline works.",
            ),
            "tex.packages_not_cached",
        ));
    }
    lines
        .iter()
        .any(|line| BUNDLE_UNREACHABLE.iter().any(|text| line.contains(text)))
        .then(|| {
            coded(
                failure(
                    "Tectonic couldn't download its TeX packages",
                    "Check the connection or proxy, then build again.",
                ),
                "tex.packages_unreachable",
            )
        })
}

fn unopened_path(lines: &[&str]) -> Option<CompileError> {
    let path = lines
        .iter()
        .find_map(|line| line.trim_start().strip_prefix(UNOPENED_PATH_PREFIX))?;
    Some(failure(
        format!("Can't open {}", path.trim()),
        "Check that the file exists, and that \\addbibresource or \\bibliography names it correctly.",
    ))
}

fn biber_failure(lines: &[&str]) -> Option<CompileError> {
    let message = lines.iter().find_map(|line| {
        let at = line.find(BIBER_ERROR_MARKER)?;
        Some(line[at + BIBER_ERROR_MARKER.len()..].trim())
    })?;
    Some(failure(
        format!("Biber: {message}"),
        "Biber stopped before it wrote the bibliography. Fix this, then build again.",
    ))
}

fn latexmk_failure(lines: &[&str]) -> Option<CompileError> {
    let summary = lines
        .iter()
        .position(|line| line.contains(LATEXMK_SUMMARY))?;
    let first = lines[summary + 1..]
        .iter()
        .map(|line| line.trim())
        .find(|line| !line.is_empty())?;
    Some(failure(
        first,
        "latexmk stopped because a program it ran failed. The build log has that program's output.",
    ))
}

fn empty_document(lines: &[&str]) -> Option<CompileError> {
    lines
        .iter()
        .take_while(|line| line.trim_end() != ENGINE_OUTPUT_MARKER)
        .any(|line| line.contains(NO_PAGES))
        .then(|| {
            failure(
                "The document has no pages",
                "Put some content between \\begin{document} and \\end{document}.",
            )
        })
}

fn is_framing(line: &str) -> bool {
    ERROR_FRAMING.iter().any(|text| line.starts_with(text))
}

fn reported_error(lines: &[&str]) -> Option<CompileError> {
    let mut reported = lines
        .iter()
        .map(|line| line.trim_start())
        .filter(|line| line.starts_with(ERROR_LINE_PREFIX) && !is_framing(line));
    let first = reported
        .clone()
        .find(|line| !line.starts_with(HELPER_EXIT_PREFIX));
    if let Some(line) = first {
        return Some(failure(
            line[ERROR_LINE_PREFIX.len()..].trim(),
            "The compiler stopped before it could write the PDF. The build log has the details.",
        ));
    }
    let line = reported.next()?;
    Some(failure(
        line[ERROR_LINE_PREFIX.len()..].trim(),
        "A helper the compiler started, such as Biber, stopped with an error. The build log has its output.",
    ))
}

pub fn tex_failure_reason(log: &str) -> Option<CompileError> {
    let lines: Vec<&str> = log.lines().collect();
    package_failure(&lines)
        .or_else(|| unopened_path(&lines))
        .or_else(|| biber_failure(&lines))
        .or_else(|| latexmk_failure(&lines))
        .or_else(|| empty_document(&lines))
        .or_else(|| reported_error(&lines))
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DeniedShellEscape {
    Minted,
    PythonTex,
    Command,
}

impl DeniedShellEscape {
    pub fn feature(self) -> &'static str {
        match self {
            Self::Minted => "minted syntax highlighting",
            Self::PythonTex => "PythonTeX",
            Self::Command => "a LaTeX shell command",
        }
    }

    pub fn code(self) -> &'static str {
        match self {
            Self::Minted => "tex.shell_escape_denied_minted",
            Self::PythonTex => "tex.shell_escape_denied_pythontex",
            Self::Command => "tex.shell_escape_denied_command",
        }
    }

    pub fn reason(self) -> &'static str {
        match self {
            Self::Minted => {
                "minted needs to run another program to highlight code, and this project blocks that."
            }
            Self::PythonTex => "PythonTeX needs to run Python, and this project blocks that.",
            Self::Command => "This document runs a shell command, and this project blocks that.",
        }
    }
}

pub fn denied_shell_escape_feature(source: &str, log: &str) -> Option<DeniedShellEscape> {
    let source = source.to_ascii_lowercase();
    let log = log.to_ascii_lowercase();
    if ["minted", "inputminted", "mintinline", "pygmentize"]
        .iter()
        .any(|needle| source.contains(needle) || log.contains(needle))
    {
        return Some(DeniedShellEscape::Minted);
    }
    if ["pythontex", "pycode", "pysub", "pygment"]
        .iter()
        .any(|needle| source.contains(needle) || log.contains(needle))
    {
        return Some(DeniedShellEscape::PythonTex);
    }
    if ["\\write18", "\\shellescape", "\\input{|", "includesvg"]
        .iter()
        .any(|needle| source.contains(needle))
        || log_refused_a_shell_command(&log)
    {
        return Some(DeniedShellEscape::Command);
    }
    None
}

pub fn log_refused_a_shell_command(log: &str) -> bool {
    const REFUSALS: [&str; 4] = [
        "shell escape feature is not enabled",
        "shell-escape feature is not enabled",
        "shell escape is disabled",
        "-shell-escape flag",
    ];
    if REFUSALS.iter().any(|needle| log.contains(needle)) {
        return true;
    }
    runsystem_statuses(log)
        .iter()
        .any(|status| status.starts_with("disabled"))
}

pub fn runsystem_statuses(log: &str) -> Vec<String> {
    const MARKER: &str = "runsystem(";
    const CLOSE: &str = ")...";
    const RECORD_LIMIT: usize = 400;
    let mut statuses = Vec::new();
    let mut rest = log;
    while let Some(at) = rest.find(MARKER) {
        let tail = &rest[at + MARKER.len()..];
        rest = tail;
        let joined: String = tail
            .chars()
            .take(RECORD_LIMIT)
            .filter(|ch| *ch != '\n' && *ch != '\r')
            .collect();
        let record = match joined.find(MARKER) {
            Some(next) => &joined[..next],
            None => &joined[..],
        };
        let Some(close) = record.find(CLOSE) else {
            continue;
        };
        let status = &record[close + CLOSE.len()..];
        let status = match status.find('.') {
            Some(end) => &status[..end],
            None => status,
        };
        statuses.push(status.trim().to_ascii_lowercase());
    }
    statuses
}

pub fn blocked_shell_escape(source: &str, log: &str) -> Option<DeniedShellEscape> {
    let lowered = log.to_ascii_lowercase();
    if !log_refused_a_shell_command(&lowered) && !lowered.contains(PIPE_INPUT_REFUSAL) {
        return None;
    }
    Some(denied_shell_escape_feature(source, log).unwrap_or(DeniedShellEscape::Command))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn reason(log: &str) -> CompileError {
        tex_failure_reason(log).unwrap_or_else(|| panic!("no reason in {log:?}"))
    }

    #[test]
    fn an_empty_tectonic_cache_says_to_build_online_once() {
        let error =
            reason("(texputerror: failed to open input file \"tectonic-format-latex.tex\"\n");
        assert_eq!(error.kind, "error");
        assert_eq!(error.code.as_deref(), Some("tex.packages_not_cached"));
        assert_eq!(error.message, "Tectonic has no cached packages yet");
        assert!(error.explanation.unwrap().contains("--offline"));
    }

    #[test]
    fn an_unreachable_bundle_points_at_the_network() {
        for line in [
            "thread 'main' panicked at src/config.rs:154:18: this bundle isn't cached, and we couldn't get it from the internet",
            "error: this bundle isn't cached",
            "error: we couldn't get it from the internet",
        ] {
            assert_eq!(
                reason(line).code.as_deref(),
                Some("tex.packages_unreachable")
            );
        }
    }

    #[test]
    fn a_path_tectonic_cannot_open_is_named() {
        let error = reason("error: can't open path `refs.bib`\nerror: the external tool exited with error code 2\n");
        assert_eq!(error.message, "Can't open `refs.bib`");
        assert!(error.explanation.unwrap().contains("\\addbibresource"));
    }

    #[test]
    fn a_biber_error_loses_its_log_prefix() {
        let error = reason(
            "INFO - This is Biber 2.20\n[71] Utils.pm:410> ERROR - Cannot find 'refs.bib'!\nerror: the external tool exited with error code 2\n",
        );
        assert_eq!(error.message, "Biber: Cannot find 'refs.bib'!");
    }

    #[test]
    fn latexmk_gives_the_first_line_of_its_summary() {
        let error = reason(
            "Latexmk: Errors, so I did not complete making targets\nCollected error summary (may duplicate other messages):\n  biber _oleafly_entry: Command for 'biber _oleafly_entry' gave return code 2\n      Refer to '_oleafly_entry.blg' for details\n",
        );
        assert_eq!(
            error.message,
            "biber _oleafly_entry: Command for 'biber _oleafly_entry' gave return code 2"
        );
        assert!(tex_failure_reason("Collected error summary (may duplicate):\n").is_none());
    }

    #[test]
    fn an_empty_document_is_read_from_the_log_only() {
        assert_eq!(
            reason("No pages of output.\nTranscript written on x.log.\n").message,
            "The document has no pages"
        );
        assert!(tex_failure_reason(&format!(
            "This is the log.\n{ENGINE_OUTPUT_MARKER}\nNo pages of output.\n"
        ))
        .is_none());
    }

    #[test]
    fn the_first_real_error_line_wins_over_tectonic_framing() {
        let error = reason(
            "error: its stderr was:\nerror: its stdout was:\nerror: the external tool exited with an error code; its output follows\nerror: failed to create the staging folder\nerror: the external tool exited with error code 3\n",
        );
        assert_eq!(error.message, "failed to create the staging folder");
    }

    #[test]
    fn a_helpers_exit_code_is_the_last_resort() {
        let error =
            reason("note: running biber\nerror: the external tool exited with error code 255\n");
        assert_eq!(
            error.message,
            "the external tool exited with error code 255"
        );
        assert!(error.explanation.unwrap().contains("Biber"));
    }

    #[test]
    fn framing_alone_or_a_quiet_log_gives_no_reason() {
        assert!(tex_failure_reason("error: its stderr was:\n").is_none());
        assert!(tex_failure_reason("This is XeTeX\nOutput written on x.pdf\n").is_none());
        assert!(tex_failure_reason("").is_none());
    }

    #[test]
    fn package_problems_outrank_every_other_line() {
        let error = reason(
            "error: can't open path `refs.bib`\n(texputerror: failed to open input file \"tectonic-format-latex.tex\"\n",
        );
        assert_eq!(error.code.as_deref(), Some("tex.packages_not_cached"));
    }

    #[test]
    fn crlf_logs_keep_clean_messages() {
        let error = reason("error: can't open path `refs.bib`\r\n");
        assert_eq!(error.message, "Can't open `refs.bib`");
    }

    #[test]
    fn a_refused_command_is_blocked_shell_escape() {
        let log = "runsystem(echo generated > gen.tex)...disabled (restricted).\n";
        assert_eq!(
            blocked_shell_escape("\\documentclass{article}", log),
            Some(DeniedShellEscape::Command)
        );
    }

    #[test]
    fn pipe_input_is_blocked_shell_escape_without_a_refusal_line() {
        let log = "! I can't find file `\"|echo hi\"'.\n";
        assert_eq!(
            blocked_shell_escape("\\input{|\"echo hi\"}", log),
            Some(DeniedShellEscape::Command)
        );
        assert_eq!(
            blocked_shell_escape("\\input|\"echo hi\"", log),
            Some(DeniedShellEscape::Command)
        );
    }

    #[test]
    fn a_minted_failure_needs_a_refusal_to_count_as_blocked() {
        let source = "\\usepackage{minted}";
        assert_eq!(
            blocked_shell_escape(source, "! Undefined control sequence.\n"),
            None
        );
        assert_eq!(
            blocked_shell_escape(
                source,
                "! Package minted Error: You must invoke LaTeX with the -shell-escape flag.\n"
            ),
            Some(DeniedShellEscape::Minted)
        );
    }

    #[test]
    fn an_ordinary_failure_is_not_blocked_shell_escape() {
        assert_eq!(
            blocked_shell_escape("\\documentclass{article}", "! Emergency stop.\n"),
            None
        );
        assert_eq!(
            blocked_shell_escape(
                "\\documentclass{article}",
                "runsystem(epstopdf a.eps)...executed.\n"
            ),
            None
        );
    }
}
