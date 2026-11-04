use std::collections::BTreeMap;
use std::path::Path;

use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq, Eq)]
pub struct CompileError {
    pub line: Option<u32>,
    pub file: Option<String>,
    pub message: String,
    pub kind: String,
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
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub params: BTreeMap<String, String>,
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

const LOST_CHARACTER: &str = "Missing character: There is no ";
const MAX_LOST_SAMPLE: usize = 3;
const BANNER_LINES: usize = 64;

const TRADITIONAL_CHINESE_SETUP: &str =
    "% Traditional Chinese\n\\usepackage{xeCJK}\n\\setCJKmainfont[AutoFakeBold]{bsmi00lp.ttf}";
const SIMPLIFIED_CHINESE_SETUP: &str =
    "% Simplified Chinese\n\\usepackage{xeCJK}\n\\setCJKmainfont[AutoFakeBold]{gbsn00lp.ttf}";
const JAPANESE_SETUP: &str =
    "% Japanese\n\\usepackage{xeCJK}\n\\setCJKmainfont{ipaexm.ttf}[BoldFont=ipaexg.ttf]";
// Plain xeCJK drops the spaces between Hangul words.
const KOREAN_SETUP: &str =
    "% Korean\n\\usepackage[space]{xeCJK}\n\\setCJKmainfont[AutoFakeBold]{UnBatang.ttf}";

fn code_point(glyph: &str) -> Option<char> {
    let (_, code) = glyph.split_once("(U+")?;
    u32::from_str_radix(code.split(')').next()?, 16)
        .ok()
        .and_then(char::from_u32)
}

fn only_char(token: &str) -> Option<char> {
    let mut characters = token.chars();
    let first = characters.next()?;
    characters.next().is_none().then_some(first)
}

// TeX leaves out a character its font has no glyph for and still reports
// success, so a whole script can vanish from the PDF. The log repeats this for
// every character, and one warning covers them all. In `nullfont` it is stray
// text inside a TikZ picture, which is a different problem.
#[derive(Default)]
struct LostCharacters {
    count: usize,
    sample: Vec<String>,
    han: bool,
    kana: bool,
    hangul: bool,
}

impl LostCharacters {
    fn observe(&mut self, line: &str) {
        let Some(rest) = line.trim_start().strip_prefix(LOST_CHARACTER) else {
            return;
        };
        if rest.contains("in font nullfont") {
            return;
        }
        self.count += 1;
        let token = rest.split_whitespace().next().unwrap_or_default();
        let Some(character) = code_point(rest).or_else(|| only_char(token)) else {
            self.remember(token);
            return;
        };
        match character as u32 {
            0x1100..=0x11FF | 0x3130..=0x318F | 0xA960..=0xA97F | 0xAC00..=0xD7FF => {
                self.hangul = true;
            }
            0x3040..=0x30FF | 0x31F0..=0x31FF | 0xFF65..=0xFF9F => self.kana = true,
            0x3000..=0x303F
            | 0x3400..=0x4DBF
            | 0x4E00..=0x9FFF
            | 0xF900..=0xFAFF
            | 0xFF00..=0xFF64
            | 0x20000..=0x3FFFF => self.han = true,
            _ => {}
        }
        if !character.is_whitespace() && character != char::REPLACEMENT_CHARACTER {
            self.remember(&character.to_string());
        }
    }

    fn remember(&mut self, glyph: &str) {
        let known = self.sample.iter().any(|seen| seen == glyph);
        if self.sample.len() < MAX_LOST_SAMPLE && !known && !glyph.is_empty() {
            self.sample.push(glyph.chars().take(8).collect());
        }
    }

    fn setups(&self) -> Vec<String> {
        let mut setups = Vec::new();
        if self.kana {
            setups.push(JAPANESE_SETUP);
        } else if self.han {
            setups.extend([TRADITIONAL_CHINESE_SETUP, SIMPLIFIED_CHINESE_SETUP]);
        }
        if self.hangul {
            setups.push(KOREAN_SETUP);
        }
        setups.into_iter().map(str::to_owned).collect()
    }

    fn warning(&self, lines: &[&str]) -> Option<CompileError> {
        if self.count == 0 {
            return None;
        }
        let sample = match self.sample.as_slice() {
            [] => "?".to_owned(),
            glyphs => glyphs.join(" "),
        };
        let hints = if log_runs_xetex(lines) {
            self.setups()
        } else {
            Vec::new()
        };
        let (code, explanation) = if hints.is_empty() {
            (
                "tex.missing_characters",
                format!("Some characters, such as {sample}, are missing from the PDF because the font has no glyphs for them. Switch to a font that covers them."),
            )
        } else if lines
            .iter()
            .any(|line| line.starts_with("Package: CJKutf8 ") || line.starts_with("Package: CJK "))
        {
            (
                "tex.missing_characters_cjk_package",
                format!("Text such as {sample} is missing from the PDF because CJKutf8 and CJK only work on pdfLaTeX. Switch this project to pdfLaTeX, or remove the package and its CJK environment and add one of the setups listed in the compile log."),
            )
        } else {
            (
                "tex.missing_characters_cjk",
                format!("Some characters, such as {sample}, are missing from the PDF because the font has no Chinese, Japanese or Korean glyphs. Add one of the setups listed in the compile log."),
            )
        };
        let message = match self.count {
            1 => "1 character is missing from the PDF".to_owned(),
            count => format!("{count} characters are missing from the PDF"),
        };
        Some(CompileError {
            message,
            kind: "warning".into(),
            explanation: Some(explanation),
            hints,
            code: Some(code.into()),
            params: BTreeMap::from([("sample".to_owned(), sample)]),
            ..Default::default()
        })
    }
}

/// Tectonic always runs XeTeX and writes no banner to its log.
fn log_runs_xetex(lines: &[&str]) -> bool {
    lines
        .iter()
        .take(BANNER_LINES)
        .find(|line| line.starts_with("This is "))
        .is_none_or(|line| line.starts_with("This is XeTeX"))
}

pub const ENGINE_OUTPUT_MARKER: &str = "[Oleafly] Engine output:";

/// Errors (`! ...` with their `l.NN` line), float warnings and lost characters
/// in a TeX log, attributed to the innermost open input file.
pub fn parse_tex_log_errors(log: &str) -> Vec<CompileError> {
    let mut out = Vec::new();
    let lines: Vec<&str> = log.lines().collect();
    let mut stack: Vec<String> = Vec::new();
    let mut in_engine_output = false;
    let mut lost_characters = LostCharacters::default();
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
        lost_characters.observe(lines[i]);
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
    out.extend(lost_characters.warning(&lines));
    out.extend(compiler_crash_error(&lines));
    out
}

/// The crash note `engine_spec::compiler_crash_note` appends, as an error.
/// Tectonic 0.17 segfaults on some lookups of a font that isn't installed
/// (where XeTeX reports the missing font), and its last output is then the
/// "Requested font" trace for that font. When anything came after the trace,
/// the crash is reported without naming a font.
fn compiler_crash_error(lines: &[&str]) -> Option<CompileError> {
    let crash = lines
        .iter()
        .position(|line| line.starts_with(crate::engine_spec::COMPILER_CRASH_LINE))?;
    let last = lines[..crash]
        .iter()
        .rposition(|line| !line.trim().is_empty());
    let Some((font, file, line)) = last.and_then(|index| requested_font(lines, index)) else {
        let note = lines[crash].strip_prefix("error: ").unwrap_or(lines[crash]);
        return Some(CompileError {
            message: note.trim_end().to_owned(),
            kind: "error".into(),
            explanation: Some("The compiler crashed before it finished, so the log ends where it stopped. Try building again. If it crashes every time, build with another compiler.".into()),
            code: Some("tex.compiler_crashed".into()),
            ..Default::default()
        });
    };
    Some(CompileError {
        line,
        file,
        message: format!("Tectonic crashed while looking for the font \"{font}\""),
        kind: "error".into(),
        explanation: Some(format!("Tectonic crashed while looking for the font \"{font}\", which probably isn't installed on this computer. Install the font, or build with XeLaTeX or LuaLaTeX. They report a missing font instead of crashing.")),
        code: Some("tex.compiler_crashed_font".into()),
        params: BTreeMap::from([("font".to_owned(), font)]),
        ..Default::default()
    })
}

/// The font a `Requested font "…" at …pt` trace on `lines[index]` names, and
/// the `warning: file:line:` it was reported under. Tectonic sometimes breaks
/// the line after that prefix.
fn requested_font(lines: &[&str], index: usize) -> Option<(String, Option<String>, Option<u32>)> {
    const TRACE: &str = "Requested font \"";
    let text = lines[index];
    let at = text.find(TRACE)?;
    let request = &text[at + TRACE.len()..];
    let font = font_display_name(&request[..request.find('"')?])?;
    let prefix = match text[..at].trim() {
        "" => index.checked_sub(1).map_or("", |previous| lines[previous]),
        prefix => prefix,
    };
    let (file, line) = prefix
        .rfind("warning: ")
        .map(|start| prefix[start + "warning: ".len()..].trim())
        .and_then(|location| location.strip_suffix(':'))
        .and_then(|location| location.rsplit_once(':'))
        .and_then(|(file, line)| Some((file.to_owned(), line.parse::<u32>().ok()?)))
        .map_or((None, None), |(file, line)| (Some(file), Some(line)));
    Some((font, file, line))
}

fn font_display_name(request: &str) -> Option<String> {
    let name = match request.strip_prefix('[') {
        Some(file) => {
            let path = file.split(']').next().unwrap_or(file);
            let path = path
                .rsplit_once(':')
                .filter(|(_, index)| !index.is_empty() && index.bytes().all(|b| b.is_ascii_digit()))
                .map_or(path, |(path, _)| path);
            path.rsplit(['/', '\\']).next().unwrap_or(path)
        }
        None => request.split(['/', ':']).next().unwrap_or(request),
    };
    let name = name.trim();
    (!name.is_empty()).then(|| name.to_owned())
}

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
        let log = "(./main.tex (./chapters/intro.tex\n! Missing $ inserted.\nl.7 x_1\n))\n";
        let errors = parse_tex_log_errors(log);
        assert_eq!(errors.len(), 1);
        assert_eq!(errors[0].file.as_deref(), Some("chapters/intro.tex"));
        assert_eq!(errors[0].line, Some(7));
        assert!(errors[0].explanation.as_deref().unwrap().contains("math"));
    }

    #[test]
    fn tex_file_stack_ignores_non_path_parens() {
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

    // What Tectonic 0.17 printed before it segfaulted looking up a font that
    // isn't installed: stdout, then stderr, then the supervisor's crash note.
    const FONT_CRASH: &str = concat!(
        "note: Running TeX ...\n",
        "(main.tex (FiraMono.sty (fontspec.sty (fontspec.cfg))))",
        "warning: FiraMono.sty:96: \n",
        "Requested font \"[FiraMono-Regular.otf]/OT\" at 9.99997pt\n",
        "warning: FiraMono.sty:96: Requested font \"[FiraMono-Bold.otf]/OT:script=latn;language=dflt;\" at 10.00003pt\n",
        "warning: main.tex:5: \n",
        "Requested font \"Fira Sans Light\" at 9.99997pt\n",
        "\nerror: the compiler crashed (SIGSEGV) before it finished, so this log ends early",
    );

    #[test]
    fn a_crash_during_a_font_lookup_names_the_font_and_its_line() {
        let errors = parse_tex_log_errors(FONT_CRASH);
        assert_eq!(errors.len(), 1, "{errors:?}");
        let crash = &errors[0];
        assert_eq!(crash.kind, "error");
        assert_eq!(crash.code.as_deref(), Some("tex.compiler_crashed_font"));
        assert_eq!(
            crash.params.get("font").map(String::as_str),
            Some("Fira Sans Light")
        );
        assert_eq!(crash.file.as_deref(), Some("main.tex"));
        assert_eq!(crash.line, Some(5));
        assert_eq!(
            crash.message,
            "Tectonic crashed while looking for the font \"Fira Sans Light\""
        );
        assert!(crash
            .explanation
            .as_deref()
            .unwrap()
            .contains("\"Fira Sans Light\""));
    }

    #[test]
    fn the_crash_note_the_supervisor_writes_is_recognized() {
        #[cfg(unix)]
        let status = {
            use std::os::unix::process::ExitStatusExt;
            std::process::ExitStatus::from_raw(libc::SIGSEGV)
        };
        #[cfg(windows)]
        let status = {
            use std::os::windows::process::ExitStatusExt;
            std::process::ExitStatus::from_raw(0xC000_0005)
        };
        let note = crate::engine_spec::compiler_crash_note(&status).unwrap();
        let log = format!(
            "(main.tex (fontspec.sty))warning: main.tex:5: Requested font \"Fira Sans Light\" at 10pt\n{note}"
        );
        let errors = parse_tex_log_errors(&log);
        assert_eq!(errors.len(), 1, "{errors:?}");
        assert_eq!(errors[0].code.as_deref(), Some("tex.compiler_crashed_font"));
        assert_eq!(errors[0].line, Some(5));
    }

    #[test]
    fn font_names_lose_xetex_style_and_feature_suffixes() {
        let crash = |request: &str| {
            let log = format!(
                "warning: a.tex:1: Requested font \"{request}\" at 10pt\nerror: the compiler crashed (SIGSEGV) before it finished, so this log ends early\n"
            );
            parse_tex_log_errors(&log)[0].params.get("font").cloned()
        };
        assert_eq!(crash("Helvetica/B/AAT").as_deref(), Some("Helvetica"));
        assert_eq!(
            crash("Source Sans Pro Light:mapping=tex-text;").as_deref(),
            Some("Source Sans Pro Light")
        );
        assert_eq!(
            crash("[fonts/Cochineal-Roman.otf:0]/OT").as_deref(),
            Some("Cochineal-Roman.otf")
        );
        assert_eq!(
            crash("[C:\\Fonts\\My Font.ttf]").as_deref(),
            Some("My Font.ttf")
        );
    }

    #[test]
    fn a_crash_after_other_output_does_not_blame_a_font() {
        let log = FONT_CRASH.replace(
            "\nerror: the compiler",
            "warning: main.tex:9: Overfull \\hbox in paragraph\n\nerror: the compiler",
        );
        let errors = parse_tex_log_errors(&log);
        assert_eq!(errors.len(), 1, "{errors:?}");
        assert_eq!(errors[0].code.as_deref(), Some("tex.compiler_crashed"));
        assert!(errors[0].params.is_empty());
        assert_eq!(errors[0].line, None);
        assert_eq!(
            errors[0].message,
            "the compiler crashed (SIGSEGV) before it finished, so this log ends early"
        );
        assert!(errors[0]
            .explanation
            .as_deref()
            .unwrap()
            .contains("crashed before it finished"));
    }

    #[test]
    fn a_crash_inside_appended_engine_output_is_still_reported() {
        let log =
            format!("This is the file log\n{ENGINE_OUTPUT_MARKER}\n{FONT_CRASH}\n[Oleafly] note\n");
        let errors = parse_tex_log_errors(&log);
        assert_eq!(errors.len(), 1, "{errors:?}");
        assert_eq!(errors[0].code.as_deref(), Some("tex.compiler_crashed_font"));
    }

    #[test]
    fn a_log_without_a_crash_note_has_no_crash_error() {
        let log = FONT_CRASH.replace("error: the compiler crashed", "the compiler crashed");
        assert!(parse_tex_log_errors(&log).is_empty());
        assert!(parse_tex_log_errors("Requested font \"X\" at 10pt\n").is_empty());
    }

    const TECTONIC_LOST_HAN: &str = "**\n(main.tex\nMissing character: There is no 大 (U+5927) in font [lmroman12-bold]:mapping=tex-\ntext;!\nMissing character: There is no 綱 (U+7DB1) in font [lmroman12-bold]:mapping=tex-\ntext;!\n";

    fn lost(glyphs: &[(&str, &str)]) -> String {
        glyphs
            .iter()
            .map(|(glyph, code)| {
                format!("Missing character: There is no {glyph} (U+{code}) in font [lmroman12-regular]:mapping=tex-\ntext;!\n")
            })
            .collect()
    }

    #[test]
    fn lost_han_text_gets_one_warning_with_traditional_and_simplified_setups() {
        let errors = parse_tex_log_errors(TECTONIC_LOST_HAN);
        assert_eq!(errors.len(), 1, "{errors:?}");
        let warning = &errors[0];
        assert_eq!(warning.kind, "warning");
        assert_eq!(warning.message, "2 characters are missing from the PDF");
        assert_eq!(warning.code.as_deref(), Some("tex.missing_characters_cjk"));
        assert_eq!(warning.params["sample"], "大 綱");
        assert_eq!(warning.hints.len(), 2);
        assert!(warning.hints[0].contains("bsmi00lp.ttf"));
        assert!(warning.hints[1].contains("gbsn00lp.ttf"));
        assert!(warning.explanation.as_deref().unwrap().contains("大 綱"));
    }

    #[test]
    fn the_cjk_package_on_xetex_names_pdflatex_as_the_way_out() {
        let log = format!("Package: CJKutf8 2021/10/16 4.8.5\n{TECTONIC_LOST_HAN}");
        let warning = parse_tex_log_errors(&log).remove(0);
        assert_eq!(
            warning.code.as_deref(),
            Some("tex.missing_characters_cjk_package")
        );
        assert!(warning.explanation.as_deref().unwrap().contains("pdfLaTeX"));
        assert_eq!(warning.hints.len(), 2);
        let log = format!("Package: CJK 2021/10/16 4.8.5\n{TECTONIC_LOST_HAN}");
        assert_eq!(
            parse_tex_log_errors(&log)[0].code.as_deref(),
            Some("tex.missing_characters_cjk_package")
        );
    }

    #[test]
    fn each_script_gets_a_setup_that_keeps_its_text() {
        let japanese = parse_tex_log_errors(&lost(&[("漢", "6F22"), ("か", "304B")]));
        assert_eq!(japanese[0].hints.len(), 1);
        assert!(japanese[0].hints[0].contains("ipaexm.ttf"));
        let korean = parse_tex_log_errors(&lost(&[("한", "D55C")]));
        assert_eq!(korean[0].message, "1 character is missing from the PDF");
        assert_eq!(korean[0].hints.len(), 1);
        assert!(korean[0].hints[0].contains("[space]{xeCJK}"));
        assert!(korean[0].hints[0].contains("UnBatang.ttf"));
        let mixed = parse_tex_log_errors(&lost(&[("中", "4E2D"), ("한", "D55C")]));
        assert_eq!(mixed[0].hints.len(), 3);
    }

    #[test]
    fn characters_outside_cjk_have_no_setup_to_offer() {
        let errors = parse_tex_log_errors(&lost(&[("😀", "1F600")]));
        assert_eq!(errors[0].code.as_deref(), Some("tex.missing_characters"));
        assert!(errors[0].hints.is_empty());
        assert_eq!(errors[0].params["sample"], "😀");
    }

    #[test]
    fn the_xecjk_setups_are_only_offered_on_xetex() {
        let pdftex = format!(
            "This is pdfTeX, Version 3.141592653-2.6-1.40.29\nPackage: CJKutf8 2021/10/16 4.8.5\n{}",
            lost(&[("大", "5927")])
        );
        let errors = parse_tex_log_errors(&pdftex);
        assert_eq!(errors[0].code.as_deref(), Some("tex.missing_characters"));
        assert!(errors[0].hints.is_empty());
        let xetex = format!(
            "This is XeTeX, Version 3.141592653-2.6-0.999995\n{}",
            lost(&[("大", "5927")])
        );
        assert_eq!(
            parse_tex_log_errors(&xetex)[0].code.as_deref(),
            Some("tex.missing_characters_cjk")
        );
    }

    #[test]
    fn stray_tikz_text_in_nullfont_is_not_lost_text() {
        let log = "Missing character: There is no x in font nullfont!\n";
        assert!(parse_tex_log_errors(log).is_empty());
    }

    #[test]
    fn engine_output_does_not_count_the_same_characters_twice() {
        let log = format!(
            "{TECTONIC_LOST_HAN}{ENGINE_OUTPUT_MARKER}\nwarning: main.tex:6: Missing character: There is no 大 (U+5927) in font x!\n"
        );
        assert_eq!(
            parse_tex_log_errors(&log)[0].message,
            "2 characters are missing from the PDF"
        );
    }

    #[test]
    fn eight_bit_glyph_names_stay_readable_in_the_sample() {
        let log = "Missing character: There is no ^^e5 in font ecrm1000!\n";
        let errors = parse_tex_log_errors(log);
        assert_eq!(errors[0].params["sample"], "^^e5");
        assert_eq!(errors[0].code.as_deref(), Some("tex.missing_characters"));
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
