//! TeX log errors and Pandoc diagnostics, shared by the app and the CLI so
//! both report the same file, line and plain-English explanation.
use std::path::Path;

use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq, Eq)]
pub struct CompileError {
    pub line: Option<u32>,
    pub file: Option<String>,
    pub message: String,
    pub kind: String,
    /// Deterministic plain-English explanation for common errors, when known.
    pub explanation: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub column: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub end_column: Option<u32>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub hints: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_line: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub code: Option<String>,
}

// A TeX log token after `(` looks like an input file if it carries a path
// separator or a file extension. Font/date/version parens ("(Font)", "(2021/01/01)")
// do not, so they never masquerade as the source file for an error.
fn looks_like_tex_path(token: &str) -> bool {
    token.starts_with('/')
        || token.starts_with("./")
        || (token.contains('.') && token.contains('/'))
        || is_bare_relative_path(token)
        || token.rsplit('.').next().is_some_and(|ext| {
            matches!(
                ext,
                "tex" | "sty" | "cls" | "def" | "ldf" | "bbl" | "bib" | "clo" | "fd" | "cfg"
            )
        })
}

fn is_bare_relative_path(token: &str) -> bool {
    let Some((head, tail)) = token.split_once('/') else {
        return false;
    };
    head.chars()
        .find(|c| !c.is_numeric() && *c != '-')
        .is_some_and(|first| first.is_alphabetic() || first == '_')
        && !head.contains(':')
        && !token.contains(char::is_whitespace)
        && !tail.is_empty()
        && !tail.ends_with('/')
}

fn tex_path_token_end(bytes: &[u8], start: usize) -> usize {
    let quoted = bytes.get(start) == Some(&b'"');
    let spaced = quoted || bytes[start..].starts_with(b"./") || bytes.get(start) == Some(&b'/');
    let mut end = start + usize::from(quoted);
    while end < bytes.len() {
        let stop = match bytes[end] {
            b'(' | b')' | b'[' | b']' => true,
            b'"' | b'{' | b'}' | b'<' | b'>' => spaced,
            b' ' | b'\t' => !spaced,
            _ => false,
        };
        if stop {
            break;
        }
        end += 1;
    }
    end
}

fn has_file_extension(path: &str) -> bool {
    path.rsplit('/')
        .next()
        .and_then(|name| name.rsplit_once('.'))
        .is_some_and(|(stem, extension)| {
            !stem.is_empty()
                && !extension.is_empty()
                && extension.chars().all(|c| c.is_ascii_alphanumeric())
        })
}

fn path_before_trailing_text(token: &str) -> &str {
    if !token.contains([' ', '\t']) || has_file_extension(token) {
        return token;
    }
    token
        .match_indices([' ', '\t'])
        .rev()
        .map(|(index, _)| &token[..index])
        .find(|prefix| has_file_extension(prefix))
        .unwrap_or_else(|| token.split([' ', '\t']).next().unwrap_or(token))
}

// TeX marks the file it is reading with balanced parens: `(path` on open, `)` on
// close. Track the nesting so an error can be attributed to the right file in a
// multi-file (\input/\include) project. Every `(` pushes and every `)` pops to
// keep the stack balanced; the current file is the innermost path-like entry.
fn update_tex_file_stack(line: &str, stack: &mut Vec<String>) {
    let bytes = line.as_bytes();
    let mut idx = 0;
    while idx < bytes.len() {
        match bytes[idx] {
            b'(' => {
                let start = idx + 1;
                let end = tex_path_token_end(bytes, start);
                let token = line[start..end].trim_start_matches('"').trim_end();
                let token = if bytes.get(start) == Some(&b'"') {
                    token
                } else {
                    path_before_trailing_text(token)
                };
                stack.push(token.trim_start_matches("./").to_owned());
                idx = end;
            }
            b')' => {
                stack.pop();
                idx += 1;
            }
            _ => idx += 1,
        }
    }
}

fn current_tex_file(stack: &[String]) -> Option<String> {
    stack
        .iter()
        .rev()
        .find(|token| looks_like_tex_path(token))
        .cloned()
}

// Deterministic plain-English explanations for high-frequency TeX errors. This is
// intentionally a small, curated set (Humanized Errors Milestone 1), not an
// exhaustive catalog. Returns None for anything not recognized.
pub fn humanize_tex_error(message: &str) -> Option<&'static str> {
    let m = message.trim();
    if m.starts_with("Undefined control sequence") {
        return Some("LaTeX does not recognize this command. Check for a typo, or load the package that defines it.");
    }
    if m.starts_with("Missing $ inserted") {
        return Some("A math-only symbol (such as _, ^, or a Greek letter) was used outside math mode. Wrap it in $...$.");
    }
    if m.starts_with("Missing } inserted") || m.starts_with("Missing { inserted") {
        return Some("Unbalanced braces. Make sure every { has a matching }.");
    }
    if m.starts_with("Runaway argument") {
        return Some("A command argument was never closed, usually a missing } or \\end{...} above this point.");
    }
    if m.starts_with("Double superscript") {
        return Some("Two ^ in a row. Group them, for example x^{a}^{b} becomes x^{ab}.");
    }
    if m.starts_with("Double subscript") {
        return Some("Two _ in a row. Group them, for example x_{a}_{b} becomes x_{ab}.");
    }
    if m.starts_with("Extra alignment tab") {
        return Some("A table row has more & separators than the column specification allows.");
    }
    if m.starts_with("Misplaced alignment tab character &") {
        return Some(
            "An & appeared outside a table or alignment. Write \\& for a literal ampersand.",
        );
    }
    if m.starts_with("There's no line here to end") {
        return Some("\\\\ was used where LaTeX did not expect a line break, for example in ordinary paragraph text.");
    }
    if let Some(rest) = m.strip_prefix("LaTeX Error: ") {
        if rest.starts_with("Too many unprocessed floats") {
            return Some("LaTeX ran out of room to place figures/tables. Add a \\clearpage before continuing, shrink the floats, or use [htbp] placement so they can move.");
        }
        if rest.contains("not found") {
            return Some("A file or package could not be found. Check the name and path, or install the missing package.");
        }
        if rest.starts_with("Environment ") && rest.contains("undefined") {
            return Some("This environment is not defined. Check the spelling, or load the package that provides it.");
        }
        if rest.starts_with("\\begin{") && rest.contains("ended by") {
            return Some(
                "Environment mismatch: a \\begin{...} was closed by a different \\end{...}.",
            );
        }
        if rest.contains("missing \\item") {
            return Some(
                "A list (itemize/enumerate/description) has content before its first \\item.",
            );
        }
    }
    if m.starts_with("Package ") && m.contains(" Error:") {
        return Some(
            "A LaTeX package reported an error. The package name and detail follow in the log.",
        );
    }
    None
}

// Deterministic float placement warnings surfaced from the log (Float Advisor
// Milestone 1). These are LaTeX Warnings, not `!` errors, so they are matched
// separately and always carry an explanation.
fn float_warning(line: &str) -> Option<&'static str> {
    let l = line.trim();
    if l.contains("float specifier changed to") {
        return Some("LaTeX could not place this float where you asked and moved it. Use [htbp] to give it more placement options.");
    }
    if l.starts_with("LaTeX Warning: Float too large for page") {
        return Some("A figure or table is taller than the text area, so LaTeX cannot place it. Scale it down (for example width=\\linewidth) or make it a full-page float.");
    }
    None
}

/// The line before the engine's raw output in a log Oleafly assembles.
pub const ENGINE_OUTPUT_MARKER: &str = "[Oleafly] Engine output:";

/// Errors (`! ...` with their `l.NN` line) and float warnings in a TeX log,
/// attributed to the innermost open input file.
pub fn parse_tex_log_errors(log: &str) -> Vec<CompileError> {
    let mut out = Vec::new();
    let lines: Vec<&str> = log.lines().collect();
    let mut stack: Vec<String> = Vec::new();
    let mut in_engine_output = false;
    for i in 0..lines.len() {
        if lines[i].trim_end() == ENGINE_OUTPUT_MARKER {
            in_engine_output = true;
            continue;
        }
        if in_engine_output {
            if !lines[i].starts_with("[Oleafly]") {
                continue;
            }
            in_engine_output = false;
        }
        update_tex_file_stack(lines[i], &mut stack);
        if let Some(explanation) = float_warning(lines[i]) {
            out.push(CompileError {
                line: None,
                file: current_tex_file(&stack),
                message: lines[i].trim().to_owned(),
                kind: "warning".to_owned(),
                explanation: Some(explanation.to_owned()),
                ..Default::default()
            });
            continue;
        }
        if let Some(message) = lines[i].strip_prefix("! ") {
            let mut line_no = None;
            for following in lines
                .iter()
                .skip(i + 1)
                .take(20.min(lines.len().saturating_sub(i + 1)))
            {
                if following.starts_with('!') {
                    break;
                }
                if let Some(rest) = following.strip_prefix("l.") {
                    let digits: String = rest.chars().take_while(char::is_ascii_digit).collect();
                    if let Ok(number) = digits.parse::<u32>() {
                        line_no = Some(number);
                        break;
                    }
                }
            }
            out.push(CompileError {
                line: line_no,
                file: current_tex_file(&stack),
                message: message.to_owned(),
                kind: "error".to_owned(),
                explanation: humanize_tex_error(message).map(str::to_owned),
                ..Default::default()
            });
        }
    }
    out
}

/// Warnings and errors Pandoc (and the Tectonic it drives) printed.
pub fn parse_pandoc_diagnostics(log: &str) -> Vec<CompileError> {
    log.lines()
        .filter_map(|line| {
            let trimmed = line.trim();
            if trimmed.is_empty() {
                return None;
            }
            let lower = trimmed.to_ascii_lowercase();
            // Tectonic on Windows can emit this Fontconfig initialization
            // message and still successfully resolve bundled fonts and write
            // the PDF. Pandoc forwards it verbatim. Keep it visible without
            // rejecting valid output; a nonzero exit still fails compilation.
            let kind = if lower.contains("warning")
                || lower.starts_with("fontconfig error: cannot load default config file:")
            {
                "warning"
            } else if lower.contains("error") || lower.starts_with("pandoc:") {
                "error"
            } else {
                return None;
            };
            Some(CompileError {
                line: None,
                file: None,
                message: trimmed.to_owned(),
                kind: kind.to_owned(),
                explanation: None,
                ..Default::default()
            })
        })
        .collect()
}

fn with_tex_extension(project_dir: &Path, file: &str) -> Option<String> {
    let relative = file.strip_prefix("./").unwrap_or(file);
    let path = Path::new(relative);
    if relative.is_empty() || path.is_absolute() || path.extension().is_some() {
        return None;
    }
    project_dir
        .join(format!("{relative}.tex"))
        .is_file()
        .then(|| format!("{file}.tex"))
}

/// Makes file names in a log that ran in `log_dir` relative to the project.
pub fn rebase_log_files(
    project_dir: &Path,
    log_dir: &Path,
    root_file: Option<&str>,
    errors: &mut [CompileError],
    diagnostics: &mut [crate::LogDiagnostic],
) {
    let Some(base) = log_dir
        .strip_prefix(project_dir)
        .ok()
        .map(|relative| relative.to_string_lossy().replace('\\', "/"))
        .filter(|base| !base.is_empty())
    else {
        return;
    };
    let rebase = |file: &mut Option<String>| {
        let Some(name) = file.as_deref() else {
            return;
        };
        if Some(name) == root_file || Path::new(name).is_absolute() {
            return;
        }
        let mut relative = name;
        while let Some(rest) = relative.strip_prefix("./") {
            relative = rest;
        }
        *file = Some(format!("{base}/{relative}"));
    };
    for error in errors.iter_mut() {
        rebase(&mut error.file);
    }
    for diagnostic in diagnostics.iter_mut() {
        rebase(&mut diagnostic.file);
    }
}

/// `\input{chapter}` shows up as `chapter` in the log; name the `.tex` file.
pub fn resolve_extensionless_inputs(
    project_dir: &Path,
    errors: &mut [CompileError],
    diagnostics: &mut [crate::LogDiagnostic],
) {
    let mut resolved: std::collections::HashMap<String, Option<String>> =
        std::collections::HashMap::new();
    let mut resolve = |file: &mut Option<String>| {
        let Some(name) = file.as_deref() else {
            return;
        };
        let replacement = resolved
            .entry(name.to_string())
            .or_insert_with(|| with_tex_extension(project_dir, name))
            .clone();
        if replacement.is_some() {
            *file = replacement;
        }
    };
    for error in errors.iter_mut() {
        resolve(&mut error.file);
    }
    for diagnostic in diagnostics.iter_mut() {
        resolve(&mut diagnostic.file);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tex_errors_get_plain_english_explanations() {
        let log = "! Undefined control sequence.\nl.42 \\foo\n";
        let errors = parse_tex_log_errors(log);
        assert_eq!(errors.len(), 1);
        assert_eq!(errors[0].line, Some(42));
        assert_eq!(errors[0].kind, "error");
        assert!(errors[0]
            .explanation
            .as_deref()
            .unwrap()
            .contains("does not recognize"));
    }

    #[test]
    fn tex_errors_find_line_number_past_tectonic_v2_cli_preamble() {
        // Real tectonic -X compile --print output interleaves several lines
        // (including a duplicated "error: file:line:" summary from the V2
        // CLI itself) between the "! " trigger and the "l.NN" reference,
        // well past a short lookahead window.
        let log = concat!(
            "! LaTeX Error: Environment align undefined.\n",
            "\n",
            "See the LaTeX manual or LaTeX Companion for explanation.\n",
            "Type  H <return>  for immediate help.\n",
            " ...                                              \n",
            "                                                  \n",
            "l.5 \\begin{align}\n",
            "                 \n",
            "No pages of output.\n",
        );
        let errors = parse_tex_log_errors(log);
        assert_eq!(errors.len(), 1);
        assert_eq!(errors[0].line, Some(5));
    }

    #[test]
    fn tex_errors_without_a_known_pattern_have_no_explanation() {
        let log = "! Some novel engine failure.\nl.3 x\n";
        let errors = parse_tex_log_errors(log);
        assert_eq!(errors.len(), 1);
        assert_eq!(errors[0].explanation, None);
    }

    #[test]
    fn tex_errors_attribute_to_the_innermost_open_file() {
        // main opens chapter, the error occurs inside chapter, then chapter closes.
        let log = "(./main.tex (./chapters/intro.tex\n! Missing $ inserted.\nl.7 x_1\n))\n";
        let errors = parse_tex_log_errors(log);
        assert_eq!(errors.len(), 1);
        assert_eq!(errors[0].file.as_deref(), Some("chapters/intro.tex"));
        assert_eq!(errors[0].line, Some(7));
        assert!(errors[0].explanation.as_deref().unwrap().contains("math"));
    }

    #[test]
    fn tex_file_stack_ignores_non_path_parens() {
        // Font/version parens must not be mistaken for the source file.
        let log = "(./main.tex (Font) (2021/01/01)\n! Undefined control sequence.\nl.9 \\bad\n)\n";
        let errors = parse_tex_log_errors(log);
        assert_eq!(errors[0].file.as_deref(), Some("main.tex"));
    }

    #[test]
    fn tex_errors_attribute_to_tectonic_extensionless_inputs() {
        let log = "(_oleafly_entry.tex (main.tex (article.cls\n) (2021/01/01)\n(kapitoly/\u{fa}vod\n! Undefined control sequence.\nl.2 \\bad\n) (chapters/intro\n! Missing $ inserted.\nl.5 x_1\n)\n! Emergency stop.\n";
        let files: Vec<_> = parse_tex_log_errors(log)
            .into_iter()
            .map(|error| (error.file, error.line))
            .collect();
        assert_eq!(
            files,
            [
                (Some("kapitoly/\u{fa}vod".to_string()), Some(2)),
                (Some("chapters/intro".to_string()), Some(5)),
                (Some("main.tex".to_string()), None),
            ]
        );
    }

    #[test]
    fn tex_errors_keep_input_paths_with_spaces_or_quotes() {
        for log in [
            "(./main.tex (./kapitoly/\u{fa}vod pr\u{e1}ce.tex\n! Undefined control sequence.\nl.2 \\bad\n))\n",
            "(./main.tex (\"./kapitoly/\u{fa}vod pr\u{e1}ce.tex\"\n! Undefined control sequence.\nl.2 \\bad\n))\n",
        ] {
            let errors = parse_tex_log_errors(log);
            assert_eq!(
                errors[0].file.as_deref(),
                Some("kapitoly/\u{fa}vod pr\u{e1}ce.tex")
            );
        }
    }

    #[test]
    fn tex_errors_ignore_text_printed_after_an_input_path() {
        for (log, file) in [
            (
                "(./main.tex (./sec.tex Chapter 1.\n! Undefined control sequence.\nl.2 \\bad\n))\n",
                "sec.tex",
            ),
            (
                "(./main.tex (./kapitoly/\u{fa}vod pr\u{e1}ce.tex ABD: EveryShipout\n! Undefined control sequence.\nl.2 \\bad\n))\n",
                "kapitoly/\u{fa}vod pr\u{e1}ce.tex",
            ),
            (
                "(_oleafly_entry.tex (main.tex (01-uvod/text\n! Undefined control sequence.\nl.2 \\bad\n)))\n",
                "01-uvod/text",
            ),
        ] {
            let errors = parse_tex_log_errors(log);
            assert_eq!(errors[0].file.as_deref(), Some(file), "{log}");
        }
        let dated = parse_tex_log_errors(
            "(main.tex (2021-01/01)\n! Undefined control sequence.\nl.2 \\bad\n)\n",
        );
        assert_eq!(dated[0].file.as_deref(), Some("main.tex"));
    }

    #[test]
    fn tex_errors_skip_the_engine_output_tail() {
        let log = concat!(
            "(main.tex\n! Undefined control sequence.\nl.2 \\bad\n)\n",
            "\n[Oleafly] Engine output:\n",
            "(main.tex\nerror: main.tex:2: Undefined control sequence\n",
            "! Undefined control sequence.\nl.2 \\bad\n)\n",
            "[Oleafly] Running pinned Biber on _oleafly_entry...\n",
            "! Undefined control sequence.\nl.7 \\later\n",
        );
        let lines: Vec<_> = parse_tex_log_errors(log)
            .into_iter()
            .map(|error| error.line)
            .collect();
        assert_eq!(lines, [Some(2), Some(7)]);
    }

    #[test]
    fn float_placement_warnings_are_surfaced_and_explained() {
        let log = "(./main.tex\nLaTeX Warning: `h' float specifier changed to `ht'.\n)\n";
        let errors = parse_tex_log_errors(log);
        assert_eq!(errors.len(), 1);
        assert_eq!(errors[0].kind, "warning");
        assert_eq!(errors[0].file.as_deref(), Some("main.tex"));
        assert!(errors[0].explanation.as_deref().unwrap().contains("htbp"));
    }

    #[test]
    fn too_many_floats_error_is_explained() {
        let log = "! LaTeX Error: Too many unprocessed floats.\nl.120 \\end{figure}\n";
        let errors = parse_tex_log_errors(log);
        assert_eq!(errors.len(), 1);
        assert_eq!(errors[0].kind, "error");
        assert!(errors[0]
            .explanation
            .as_deref()
            .unwrap()
            .contains("clearpage"));
    }

    #[test]
    fn pandoc_diagnostics_keep_fontconfig_noise_as_warnings() {
        let diagnostics = parse_pandoc_diagnostics(
            "Fontconfig error: Cannot load default config file: No such file: (null)\npandoc: could not convert\n",
        );
        assert_eq!(diagnostics.len(), 2);
        assert_eq!(diagnostics[0].kind, "warning");
        assert_eq!(diagnostics[1].kind, "error");
    }
}
