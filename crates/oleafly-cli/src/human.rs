use std::borrow::Cow;
use std::io::Write;

use anstyle::{AnsiColor, Style};

use crate::contract::{CliError, ColorMode};

pub fn init_color(mode: ColorMode) {
    let choice = match mode {
        ColorMode::Auto => anstream::ColorChoice::Auto,
        ColorMode::Always => anstream::ColorChoice::Always,
        ColorMode::Never => anstream::ColorChoice::Never,
    };
    choice.write_global();
}

/// `text` with what a terminal would act on made visible. Messages carry
/// text from the project (a citation key, a file name, a line of the
/// compiler's log), and a project can put an escape sequence in any of them:
/// one that sets the clipboard, or rewrites the lines above. Escapes, bells,
/// backspaces and the rest of the control characters become their Unicode
/// pictures (`␛`), the 8-bit controls become U+FFFD, and a carriage return
/// that doesn't end a line becomes `␍` (one that does is dropped, so CRLF
/// reads as LF). Tabs and line feeds stay.
pub fn plain(text: &str) -> Cow<'_, str> {
    let acts = |character: char| character.is_control() && !matches!(character, '\n' | '\t' | '\r');
    if !text.chars().any(acts) && !text.contains('\r') {
        return Cow::Borrowed(text);
    }
    let mut out = String::with_capacity(text.len());
    let mut characters = text.chars().peekable();
    while let Some(character) = characters.next() {
        match character {
            '\r' if characters.peek().is_none_or(|next| *next == '\n') => {}
            '\r' => out.push('\u{240D}'),
            '\u{7f}' => out.push('\u{2421}'),
            '\u{00}'..='\u{1f}' if !matches!(character, '\n' | '\t') => {
                out.push(char::from_u32(0x2400 + u32::from(character)).unwrap_or('\u{FFFD}'));
            }
            '\u{80}'..='\u{9f}' => out.push('\u{FFFD}'),
            other => out.push(other),
        }
    }
    Cow::Owned(out)
}

fn labelled(label: &str, color: AnsiColor, message: &str) {
    let style = Style::new().bold().fg_color(Some(color.into()));
    let mut stderr = anstream::stderr().lock();
    let _ = writeln!(stderr, "{style}{label}:{style:#} {}", plain(message));
}

pub fn stream(text: &str) {
    let mut stderr = std::io::stderr().lock();
    let _ = write!(stderr, "{}", plain(text));
}

pub fn stderr_line(text: &str) {
    let mut stderr = anstream::stderr().lock();
    let _ = writeln!(stderr, "{}", plain(text));
}

pub fn out_line(text: &str) {
    let mut stdout = anstream::stdout().lock();
    let _ = writeln!(stdout, "{text}");
}

/// A write to stdout failed. When the reader has gone (`oleafly completions
/// zsh | head`) that is no failure: the process ends quietly, as a filter
/// does. Anything else is an error.
pub fn stdout_failed(error: std::io::Error) -> CliError {
    if error.kind() == std::io::ErrorKind::BrokenPipe
        || (cfg!(windows) && matches!(error.raw_os_error(), Some(109 | 232)))
    {
        std::process::exit(0);
    }
    CliError::from(error)
}

pub fn write_stdout(bytes: &[u8]) -> Result<(), CliError> {
    let mut stdout = std::io::stdout().lock();
    stdout
        .write_all(bytes)
        .and_then(|()| stdout.flush())
        .map_err(stdout_failed)
}

pub fn error(message: &str) {
    labelled("error", AnsiColor::Red, message);
}

pub fn warning(message: &str) {
    labelled("warning", AnsiColor::Yellow, message);
}

pub fn note(message: &str) {
    labelled("note", AnsiColor::Cyan, message);
}

pub fn hint(message: &str) {
    labelled("hint", AnsiColor::Green, message);
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CheckStatus {
    Pass,
    Warning,
    Fail,
}

pub fn status_label(status: CheckStatus) -> String {
    let (text, color) = match status {
        CheckStatus::Pass => ("PASS", AnsiColor::Green),
        CheckStatus::Warning => ("WARN", AnsiColor::Yellow),
        CheckStatus::Fail => ("FAIL", AnsiColor::Red),
    };
    let style = Style::new().bold().fg_color(Some(color.into()));
    format!("{style}{text}{style:#}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn terminal_control_sequences_are_made_visible() {
        let hostile = "key\u{1b}]52;c;ZXZpbA==\u{7}\u{1b}[2Kdone\u{8}\u{9b}31m\u{7f}";
        let shown = plain(hostile);
        assert_eq!(
            shown,
            "key\u{241b}]52;c;ZXZpbA==\u{2407}\u{241b}[2Kdone\u{2408}\u{fffd}31m\u{2421}"
        );
        assert!(!shown.chars().any(|character| character.is_control()));
        for text in ["plain", "tab\tseparated\nlines\n", "Книга 机器学 é"] {
            assert_eq!(plain(text), text);
        }
        assert_eq!(plain("crlf\r\nline"), "crlf\nline");
        assert!(matches!(plain("nothing to do"), Cow::Borrowed(_)));
        assert_eq!(plain("fake ok\rreal"), "fake ok\u{240d}real");
        assert_eq!(plain("trailing\r"), "trailing");
    }

    #[test]
    fn a_closed_stdout_pipe_is_not_an_error_but_other_failures_are() {
        let other = stdout_failed(std::io::Error::from(std::io::ErrorKind::PermissionDenied));
        assert_eq!(other.code, "io.failed");
    }
}
