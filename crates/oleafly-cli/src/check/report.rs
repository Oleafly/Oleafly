//! Findings as rows, the `--exit-code` rule, and where a report goes
//! (people, JSON or SARIF; stdout or `--output`). Shared by `check` and
//! `lint`.
use std::collections::HashMap;
use std::path::{Path, PathBuf};

use clap::{Args, ValueEnum};
use oleafly_preflight::{Position, SourceText};
use serde_json::{json, Value};

use super::sarif::{line_hash, sarif_document, SarifBase};
use crate::contract::{envelope, CliError, Context, ErrorKind, Exit, Outcome, Warning};

#[derive(Clone, Copy, Debug, PartialEq, Eq, ValueEnum)]
pub enum FormatArg {
    Human,
    Json,
    Sarif,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, ValueEnum)]
pub enum FailOn {
    #[default]
    Error,
    Warning,
    Info,
}

/// Report options `check` and `lint` share.
#[derive(Clone, Debug, Args)]
pub struct ReportArgs {
    #[arg(
        long,
        value_enum,
        value_name = "FORMAT",
        help = "human, json or sarif (default: json with --json, else human)"
    )]
    pub format: Option<FormatArg>,
    #[arg(short = 'o', long, value_name = "FILE", value_parser = crate::contract::path_arg, help = "Write the report to this file")]
    pub output: Option<PathBuf>,
    #[arg(long, help = "Exit with 9 when findings reach --fail-on")]
    pub exit_code: bool,
    #[arg(long, value_enum, default_value_t = FailOn::Error, value_name = "LEVEL", help = "The lowest level that fails with --exit-code: error, warning or info")]
    pub fail_on: FailOn,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum Level {
    Error,
    Warning,
    Note,
}

impl Level {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Error => "error",
            Self::Warning => "warning",
            Self::Note => "note",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct RowRange {
    /// UTF-16 offsets in the LF-normalised file.
    pub from: usize,
    pub to: usize,
    pub start: Position,
    pub end: Position,
}

#[derive(Clone, Debug)]
pub struct ReportRow {
    pub rule_id: String,
    pub level: Level,
    pub title: String,
    pub detail: Option<String>,
    /// Project-relative, forward slashes; `None` for project-wide findings.
    pub file: Option<String>,
    pub range: Option<RowRange>,
    /// The start line, for SARIF fingerprints only (never printed); a digest
    /// of it when it is longer than [`MAX_LINE_TEXT_BYTES`].
    pub line_text: Option<String>,
    /// The row in the command's JSON report.
    pub json: Value,
}

/// The longest start line a row keeps for its SARIF fingerprint. A longer
/// one is kept as a digest, so the findings on a 2 MB single-line file don't
/// each hold a copy of it.
pub const MAX_LINE_TEXT_BYTES: usize = 512;

/// What a row keeps of the line at `unit` (its `line_text`), made once per
/// line of a file: `made` holds the file's lines so far, by line index.
pub fn fingerprint_line(
    source: &SourceText,
    unit: usize,
    made: &mut HashMap<usize, String>,
) -> String {
    let line = source.line_index(unit.min(source.len_utf16()));
    made.entry(line)
        .or_insert_with(|| {
            let text = source.line_text(unit);
            if text.len() <= MAX_LINE_TEXT_BYTES {
                text
            } else {
                format!("\u{0}{}", line_hash("", &text))
            }
        })
        .clone()
}

/// A rule as SARIF describes it.
#[derive(Clone, Debug)]
pub struct RuleMeta {
    pub id: String,
    pub short: String,
    pub full: String,
    pub default_level: Level,
    pub tags: Vec<String>,
    /// `high`, `medium` or `low`.
    pub precision: &'static str,
    pub help_uri: Option<String>,
}

fn meets(level: Level, fail_on: FailOn) -> bool {
    match fail_on {
        FailOn::Error => level == Level::Error,
        FailOn::Warning => matches!(level, Level::Error | Level::Warning),
        FailOn::Info => true,
    }
}

/// 9 with `--exit-code` when a row reaches `--fail-on`, else 0.
pub fn exit_for(rows: &[ReportRow], args: &ReportArgs) -> Exit {
    if args.exit_code && rows.iter().any(|row| meets(row.level, args.fail_on)) {
        Exit::Findings
    } else {
        Exit::Ok
    }
}

/// `{errors, warnings, notes}`.
pub fn summary(rows: &[ReportRow]) -> Value {
    let count = |level: Level| rows.iter().filter(|row| row.level == level).count();
    json!({"errors": count(Level::Error), "warnings": count(Level::Warning), "notes": count(Level::Note)})
}

fn write_out(output: Option<&Path>, bytes: &[u8]) -> Result<(), CliError> {
    match output {
        Some(path) => oleafly_core::atomic::write_atomic(path, bytes).map_err(CliError::from),
        None => {
            use std::io::Write as _;
            let mut stdout = std::io::stdout().lock();
            stdout
                .write_all(bytes)
                .map_err(crate::human::stdout_failed)?;
            stdout.flush().map_err(crate::human::stdout_failed)
        }
    }
}

/// What one report needs to be delivered.
pub struct Delivery<'a> {
    pub command: &'static str,
    /// The JSON key the payload sits under (`check`, `lint`).
    pub key: &'static str,
    pub automation_id: &'static str,
    pub rows: &'a [ReportRow],
    pub rules: &'a [RuleMeta],
    pub payload: Value,
    pub warnings: Vec<Warning>,
    pub base: &'a SarifBase,
    pub main_document: &'a str,
    /// The human report (already rendered).
    pub human: String,
}

/// Prints or writes the report in the chosen format and returns the
/// outcome, whose exit follows `--exit-code`.
pub fn deliver(
    ctx: &Context,
    args: &ReportArgs,
    delivery: Delivery<'_>,
) -> Result<Outcome, CliError> {
    let format = args.format.unwrap_or(if ctx.json() {
        FormatArg::Json
    } else {
        FormatArg::Human
    });
    if matches!(format, FormatArg::Sarif | FormatArg::Human) && ctx.json() && args.output.is_none()
    {
        let name = if format == FormatArg::Sarif {
            "sarif"
        } else {
            "human"
        };
        return Err(CliError::new(
            ErrorKind::Usage,
            "usage.invalid",
            format!("Use --output with --format {name} when --json is set."),
        ));
    }
    let exit = exit_for(delivery.rows, args);
    let fields = json!({ delivery.key: delivery.payload });
    let mut outcome = if exit == Exit::Ok {
        Outcome::success(fields)
    } else {
        Outcome::failure(exit, fields)
    };
    match format {
        FormatArg::Human => {
            write_out(args.output.as_deref(), delivery.human.as_bytes())?;
            // With --json (and --output), stdout still gets the envelope.
            outcome.print_envelope = ctx.json();
        }
        FormatArg::Json if ctx.json() => {
            if let Some(path) = &args.output {
                let mut warnings = ctx.warnings();
                warnings.extend(delivery.warnings.iter().cloned());
                let mut bytes =
                    serde_json::to_vec_pretty(&envelope(delivery.command, &outcome, &warnings))
                        .map_err(|error| CliError::internal(error.to_string()))?;
                bytes.push(b'\n');
                write_out(Some(path), &bytes)?;
            }
        }
        FormatArg::Json => {
            let mut warnings = ctx.warnings();
            warnings.extend(delivery.warnings.iter().cloned());
            let mut bytes =
                serde_json::to_vec_pretty(&envelope(delivery.command, &outcome, &warnings))
                    .map_err(|error| CliError::internal(error.to_string()))?;
            bytes.push(b'\n');
            write_out(args.output.as_deref(), &bytes)?;
            outcome.print_envelope = false;
        }
        FormatArg::Sarif => {
            let document = sarif_document(
                delivery.automation_id,
                delivery.rules,
                delivery.rows,
                delivery.base,
                delivery.main_document,
            );
            let mut bytes = serde_json::to_vec_pretty(&document)
                .map_err(|error| CliError::internal(error.to_string()))?;
            bytes.push(b'\n');
            write_out(args.output.as_deref(), &bytes)?;
            // With --json (and --output), stdout still gets the envelope.
            outcome.print_envelope = ctx.json();
        }
    }
    for warning in delivery.warnings {
        ctx.warn(warning.code, warning.message);
    }
    Ok(outcome)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn row(level: Level) -> ReportRow {
        ReportRow {
            rule_id: "x".into(),
            level,
            title: "t".into(),
            detail: None,
            file: None,
            range: None,
            line_text: None,
            json: json!({}),
        }
    }

    fn args(exit_code: bool, fail_on: FailOn) -> ReportArgs {
        ReportArgs {
            format: None,
            output: None,
            exit_code,
            fail_on,
        }
    }

    #[test]
    fn fail_on_threshold_decides_exit_nine() {
        let warnings = [row(Level::Warning), row(Level::Note)];
        assert_eq!(exit_for(&warnings, &args(true, FailOn::Error)), Exit::Ok);
        assert_eq!(
            exit_for(&warnings, &args(true, FailOn::Warning)),
            Exit::Findings
        );
        assert_eq!(exit_for(&warnings, &args(false, FailOn::Info)), Exit::Ok);
        assert_eq!(
            exit_for(&[row(Level::Note)], &args(true, FailOn::Info)),
            Exit::Findings
        );
    }

    #[test]
    fn json_with_a_human_report_keeps_the_envelope_on_stdout() {
        let folder = tempfile::tempdir().unwrap();
        let ctx = Context::for_test(crate::contract::ContextOptions {
            project: folder.path().to_path_buf(),
            json: true,
            ..Default::default()
        });
        let base = SarifBase {
            base_dir: folder.path().to_path_buf(),
            project_prefix: String::new(),
        };
        let delivery = || Delivery {
            command: "check",
            key: "check",
            automation_id: "oleafly-check",
            rows: &[],
            rules: &[],
            payload: json!({}),
            warnings: Vec::new(),
            base: &base,
            main_document: "main.tex",
            human: "No problems.\n".into(),
        };
        let mut with_output = args(false, FailOn::Error);
        with_output.format = Some(FormatArg::Human);
        with_output.output = Some(folder.path().join("report.txt"));
        let outcome = deliver(&ctx, &with_output, delivery()).unwrap();
        assert!(outcome.print_envelope);
        assert_eq!(
            std::fs::read_to_string(folder.path().join("report.txt")).unwrap(),
            "No problems.\n"
        );
        let mut without_output = args(false, FailOn::Error);
        without_output.format = Some(FormatArg::Human);
        assert_eq!(
            deliver(&ctx, &without_output, delivery()).unwrap_err().code,
            "usage.invalid"
        );
    }

    #[test]
    fn summaries_count_each_level() {
        let rows = [row(Level::Error), row(Level::Error), row(Level::Note)];
        assert_eq!(
            summary(&rows),
            json!({"errors": 2, "warnings": 0, "notes": 1})
        );
    }
}
