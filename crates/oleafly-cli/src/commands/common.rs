//! Pieces several commands share: argument types, install hints, how a
//! build result is printed.
use std::path::Path;

use clap::ValueEnum;
use oleafly_core::{Engine, TexFlavor};
use serde_json::{json, Value};

use crate::contract::{Context, LogMode};
use crate::native::BuildResult;

/// JSON logs default to the last 16 KiB.
pub const JSON_LOG_TAIL_BYTES: usize = 16 * 1024;
/// People see the last 40 lines of a failed build's log.
pub const HUMAN_LOG_TAIL_LINES: usize = 40;
const LOG_TRUNCATION_MARKER: &str = "[Oleafly: compiler output truncated]";

#[derive(Clone, Copy, Debug, PartialEq, Eq, ValueEnum)]
pub enum CliEngine {
    #[value(alias = "xetex", alias = "latex")]
    Tectonic,
    Latexmk,
    Typst,
    #[value(alias = "pandoc", alias = "md")]
    Markdown,
}

impl From<CliEngine> for Engine {
    fn from(value: CliEngine) -> Self {
        match value {
            CliEngine::Tectonic => Self::Tectonic,
            CliEngine::Latexmk => Self::Latexmk,
            CliEngine::Typst => Self::Typst,
            CliEngine::Markdown => Self::Markdown,
        }
    }
}

/// The LaTeX compiler latexmk runs.
#[derive(Clone, Copy, Debug, PartialEq, Eq, ValueEnum)]
pub enum CliCompiler {
    Pdflatex,
    Xelatex,
    Lualatex,
    Uplatex,
    Platex,
}

impl From<CliCompiler> for TexFlavor {
    fn from(value: CliCompiler) -> Self {
        match value {
            CliCompiler::Pdflatex => Self::Pdflatex,
            CliCompiler::Xelatex => Self::Xelatex,
            CliCompiler::Lualatex => Self::Lualatex,
            CliCompiler::Uplatex => Self::Uplatex,
            CliCompiler::Platex => Self::Platex,
        }
    }
}

/// How to install an engine on this computer.
pub fn install_hint(tool: &str) -> Option<String> {
    let (macos, linux, windows, home) = match tool {
        "tectonic" => (
            Some("brew install tectonic"),
            Some("cargo install tectonic"),
            Some("winget install TectonicTypesetting.Tectonic"),
            "https://tectonic-typesetting.github.io/en-US/install.html",
        ),
        "typst" => (
            Some("brew install typst"),
            Some("cargo install typst-cli"),
            Some("winget install Typst.Typst"),
            "https://github.com/typst/typst/releases",
        ),
        "pandoc" => (
            Some("brew install pandoc"),
            Some("sudo apt install pandoc"),
            Some("winget install JohnMacFarlane.Pandoc"),
            "https://pandoc.org/installing.html",
        ),
        "latexmk" => (
            Some("brew install texlive"),
            Some("sudo apt install latexmk"),
            None,
            "https://www.tug.org/texlive/acquire.html",
        ),
        _ => return None,
    };
    let command = if cfg!(target_os = "macos") {
        macos
    } else if cfg!(target_os = "windows") {
        windows
    } else {
        linux
    };
    Some(match command {
        Some(command) => format!("Install it with `{command}`, or see {home}"),
        None => format!("See {home}"),
    })
}

/// The last `max_bytes` of a log, starting at a line.
pub fn log_tail_bytes(log: &str, max_bytes: usize) -> (String, bool) {
    if log.len() <= max_bytes {
        return (log.to_string(), false);
    }
    let mut start = log.len() - max_bytes;
    while !log.is_char_boundary(start) {
        start += 1;
    }
    let window = &log[start..];
    let window = match window.find('\n') {
        Some(newline) if newline + 1 < window.len() => &window[newline + 1..],
        _ => window,
    };
    (window.to_string(), true)
}

fn last_lines(text: &str, count: usize) -> String {
    let lines: Vec<&str> = text.lines().collect();
    lines[lines.len().saturating_sub(count)..].join("\n")
}

/// A build result as JSON, its log cut to `--log`.
pub fn build_json(result: &BuildResult, mode: LogMode) -> Value {
    let mut value = serde_json::to_value(result).unwrap_or_else(|_| json!({}));
    let Some(fields) = value.as_object_mut() else {
        return value;
    };
    match mode {
        LogMode::None => {
            fields.remove("log");
            fields.insert("log_truncated".into(), json!(false));
        }
        LogMode::Tail => {
            let (tail, truncated) = log_tail_bytes(&result.log, JSON_LOG_TAIL_BYTES);
            fields.insert("log".into(), json!(tail));
            fields.insert(
                "log_truncated".into(),
                json!(truncated || result.log.contains(LOG_TRUNCATION_MARKER)),
            );
        }
        LogMode::Full => {
            fields.insert(
                "log_truncated".into(),
                json!(result.log.contains(LOG_TRUNCATION_MARKER)),
            );
        }
    }
    value
}

fn location(file: Option<&str>, line: Option<u32>) -> String {
    match (file, line) {
        (Some(file), Some(line)) => format!("{file}:{line}: "),
        (Some(file), None) => format!("{file}: "),
        (None, Some(line)) => format!("line {line}: "),
        (None, None) => String::new(),
    }
}

/// The lines a person sees after a build (stdout for success, stderr for
/// the failure summary). Warnings go through `ctx.warn` first.
pub fn print_build(ctx: &Context, result: &BuildResult, streamed: bool) {
    if ctx.json() {
        return;
    }
    if result.ok {
        if let Some(output) = &result.output {
            let shown = result.copied_to.as_ref().unwrap_or(output);
            if ctx.quiet() {
                ctx.say(shown.display().to_string());
            } else {
                ctx.say(format!(
                    "Built {} in {} ms",
                    shown.display(),
                    result.compile_time_ms
                ));
                if result.copied_to.is_some() {
                    ctx.note(format!("The build folder keeps {} too.", output.display()));
                }
            }
        }
        return;
    }
    if !streamed && ctx.log_mode() == LogMode::Tail && !ctx.quiet() {
        let tail = last_lines(&result.log, HUMAN_LOG_TAIL_LINES);
        if !tail.trim().is_empty() {
            eprintln!("{tail}");
        }
    }
    crate::human::error(&format!("Build failed in {} ms", result.compile_time_ms));
    for error in result
        .errors
        .iter()
        .filter(|error| error.kind == "error")
        .take(20)
    {
        eprintln!(
            "{}{}",
            location(error.file.as_deref(), error.line),
            error.message
        );
    }
    if let Some(previous) = &result.previous_output {
        if !ctx.quiet() {
            ctx.note(format!(
                "The last good PDF is still at {}.",
                previous.display()
            ));
        }
    }
}

pub fn listed(items: Vec<String>) -> String {
    if items.is_empty() {
        "none".to_string()
    } else {
        items.join(", ")
    }
}

pub fn assignments(inputs: &std::collections::BTreeMap<String, String>) -> Vec<String> {
    inputs
        .iter()
        .map(|(key, value)| format!("{key}={value}"))
        .collect()
}

pub fn on_off(value: bool) -> String {
    if value { "on" } else { "off" }.to_string()
}

/// A path for display, relative to `base` when it is inside it.
pub fn display_path(path: &Path, base: &Path) -> String {
    path.strip_prefix(base).map_or_else(
        |_| path.display().to_string(),
        |relative| relative.display().to_string(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_engine_tool_has_an_install_hint() {
        for tool in ["tectonic", "latexmk", "typst", "pandoc"] {
            let hint = install_hint(tool).unwrap_or_else(|| panic!("no install hint for {tool}"));
            assert!(
                hint.contains("https://"),
                "the {tool} hint must name a source: {hint}"
            );
        }
        assert!(install_hint("not-a-compiler").is_none());
    }

    #[test]
    fn log_tails_start_at_a_line() {
        let log = (0..5_000)
            .map(|line| format!("line {line}"))
            .collect::<Vec<_>>()
            .join("\n");
        let (tail, truncated) = log_tail_bytes(&log, JSON_LOG_TAIL_BYTES);
        assert!(truncated);
        assert!(tail.len() <= JSON_LOG_TAIL_BYTES);
        assert!(tail.starts_with("line "));
        assert!(tail.ends_with("line 4999"));
    }
}
