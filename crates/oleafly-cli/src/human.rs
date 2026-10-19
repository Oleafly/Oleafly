//! Output for people: labelled, colour-aware lines on stderr. Colour follows
//! `--color`, `NO_COLOR`, `CLICOLOR` and whether stderr is a terminal.
use anstyle::{AnsiColor, Style};

use crate::contract::ColorMode;

pub fn init_color(mode: ColorMode) {
    let choice = match mode {
        ColorMode::Auto => anstream::ColorChoice::Auto,
        ColorMode::Always => anstream::ColorChoice::Always,
        ColorMode::Never => anstream::ColorChoice::Never,
    };
    choice.write_global();
}

fn labelled(label: &str, color: AnsiColor, message: &str) {
    let style = Style::new().bold().fg_color(Some(color.into()));
    anstream::eprintln!("{style}{label}:{style:#} {message}");
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

/// `PASS`, `WARN` or `FAIL`, coloured for a terminal.
pub fn status_label(status: CheckStatus) -> String {
    let (text, color) = match status {
        CheckStatus::Pass => ("PASS", AnsiColor::Green),
        CheckStatus::Warning => ("WARN", AnsiColor::Yellow),
        CheckStatus::Fail => ("FAIL", AnsiColor::Red),
    };
    let style = Style::new().bold().fg_color(Some(color.into()));
    format!("{style}{text}{style:#}")
}
