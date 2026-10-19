//! `oleafly lint`: the editor's LaTeX and BibTeX checks plus spelling and
//! grammar (Harper), with human, JSON and SARIF reports. `--fix` repairs the
//! spelling and grammar problems whose fix is certain.
pub mod fix_writer;
pub mod select;

use std::path::PathBuf;

use clap::{Args, Subcommand, ValueEnum};
use oleafly_lint::proofread::{
    safe_fix, Dialect, IgnoredWords, ProofreadError, Proofreader, SkipReason, AVAILABLE,
};
use oleafly_lint::{
    editor_catalog, format_for_path, is_bibtex_source_path, is_latex_source_path, lint_bibtex_text,
    lint_latex_text, prose_for, render, LintDiagnostic, LintMessage, LintSource,
};
use oleafly_preflight::{describe_template, Severity, SourceText};
use serde_json::{json, Value};

use crate::check::report::{
    deliver, summary, Delivery, Level, ReportArgs, ReportRow, RowRange, RuleMeta,
};
use crate::check::sarif::sarif_base;
use crate::commands::CommandModule;
use crate::contract::{CliError, Context, ErrorKind, Outcome, Warning};
use fix_writer::{
    apply_fixes, without_overlaps, write_if_unchanged, FileStamp, FixError, LineEndingMap,
};

const MAX_FILE_BYTES: u64 = 2_000_000;

#[derive(Debug, Subcommand)]
pub enum Commands {
    /// Find LaTeX, BibTeX, spelling and grammar problems
    Lint(LintArgs),
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, ValueEnum)]
pub enum DialectArg {
    #[default]
    American,
    British,
    Australian,
    Canadian,
    Indian,
}

impl DialectArg {
    fn dialect(self) -> Dialect {
        match self {
            Self::American => Dialect::American,
            Self::British => Dialect::British,
            Self::Australian => Dialect::Australian,
            Self::Canadian => Dialect::Canadian,
            Self::Indian => Dialect::Indian,
        }
    }

    fn as_str(self) -> &'static str {
        match self {
            Self::American => "american",
            Self::British => "british",
            Self::Australian => "australian",
            Self::Canadian => "canadian",
            Self::Indian => "indian",
        }
    }
}

#[derive(Debug, Args)]
pub struct LintArgs {
    #[arg(value_name = "PATH", value_parser = crate::contract::path_arg, help = "Files or folders to lint (default: the whole project)")]
    pub paths: Vec<PathBuf>,
    #[arg(
        long,
        help = "Fix repeated words, typos, punctuation and capitalization when the fix is certain"
    )]
    pub fix: bool,
    #[arg(long, help = "Skip spelling and grammar")]
    pub no_prose: bool,
    #[arg(long, value_enum, default_value_t = DialectArg::American, help = "English dialect for spelling and grammar")]
    pub dialect: DialectArg,
    #[arg(long, value_name = "FILE", value_parser = crate::contract::path_arg, help = "A file of extra accepted words, one per line")]
    pub words: Vec<PathBuf>,
    #[command(flatten)]
    pub report: ReportArgs,
}

impl CommandModule for Commands {
    fn name(&self) -> &'static str {
        "lint"
    }

    async fn run(self, ctx: &Context) -> Result<Outcome, CliError> {
        let Self::Lint(args) = self;
        run(ctx, args).await
    }
}

/// Everything one lint run needs, owned.
pub struct LintInput {
    pub root: PathBuf,
    pub cwd: PathBuf,
    pub paths: Vec<PathBuf>,
    pub fix: bool,
    pub prose: bool,
    pub dialect: DialectArg,
    pub words: String,
}

pub struct LintRun {
    pub rows: Vec<ReportRow>,
    pub rules: Vec<RuleMeta>,
    pub payload: Value,
    pub warnings: Vec<Warning>,
    pub fixed: usize,
    pub fixed_files: usize,
}

fn level_of(severity: Severity) -> Level {
    match severity {
        Severity::Error => Level::Error,
        Severity::Warning => Level::Warning,
        Severity::Info => Level::Note,
    }
}

fn rule_meta(
    diagnostic: &LintDiagnostic,
    harper: &std::collections::BTreeMap<String, String>,
) -> RuleMeta {
    let (short, full) = match &diagnostic.message {
        LintMessage::Catalog(message) => {
            let text = editor_catalog()
                .template(&message.key)
                .map(describe_template)
                .unwrap_or_else(|| diagnostic.rule_id.clone());
            (text.clone(), text)
        }
        LintMessage::Text(text) => {
            let name = diagnostic
                .rule_id
                .rsplit('/')
                .next()
                .unwrap_or(&diagnostic.rule_id);
            let description = harper.get(name).cloned().unwrap_or_else(|| text.clone());
            (description.clone(), description)
        }
    };
    RuleMeta {
        id: diagnostic.rule_id.clone(),
        short,
        full,
        default_level: level_of(diagnostic.severity),
        tags: vec![diagnostic.source.as_str().to_string()],
        precision: if diagnostic.source == LintSource::Harper {
            "medium"
        } else {
            "high"
        },
        help_uri: None,
    }
}

fn row_of(diagnostic: &LintDiagnostic, file: &str, source: &SourceText) -> ReportRow {
    let title = render(&diagnostic.message);
    let range = RowRange {
        from: diagnostic.from,
        to: diagnostic.to,
        start: source.position(diagnostic.from),
        end: source.position(diagnostic.to),
    };
    let json = json!({
        "rule_id": diagnostic.rule_id,
        "source": diagnostic.source.as_str(),
        "severity": diagnostic.severity.as_str(),
        "title": title,
        "file": file,
        "range": {
            "from": range.from,
            "to": range.to,
            "start": {"line": range.start.line, "column": range.start.column},
            "end": {"line": range.end.line, "column": range.end.column},
        },
        "suggestions": diagnostic.suggestions,
        "fixable": diagnostic.fixable,
    });
    ReportRow {
        rule_id: diagnostic.rule_id.clone(),
        level: level_of(diagnostic.severity),
        title,
        detail: None,
        file: Some(file.to_string()),
        range: Some(range),
        line_text: Some(source.line_text(diagnostic.from)),
        json,
    }
}

/// Lints the targets (blocking: reads files, runs Harper on this thread).
pub fn execute_lint(input: LintInput) -> Result<LintRun, CliError> {
    let targets = select::lint_targets(&input.root, &input.paths, &input.cwd)?;
    let mut warnings = Vec::new();
    let ignored = IgnoredWords::from_lines(&input.words);
    let mut proofreader = None;
    if input.prose {
        match Proofreader::new(input.dialect.dialect(), &ignored) {
            Ok(built) => proofreader = Some(built),
            Err(ProofreadError::Unavailable) => {
                warnings.push(Warning::new(
                    "lint.proofread_unavailable",
                    "This build of oleafly has no spelling and grammar checks.",
                ));
            }
            Err(ProofreadError::Panicked(message)) => {
                warnings.push(Warning::new(
                    "lint.proofread_failed",
                    format!("Spelling and grammar couldn't start: {message}"),
                ));
            }
        }
    }
    let harper_rules = oleafly_lint::proofread::rule_descriptions();
    let mut rows = Vec::new();
    let mut rules: Vec<RuleMeta> = Vec::new();
    let mut fixed: Vec<Value> = Vec::new();
    let mut fixed_files = 0;
    let root = dunce::canonicalize(&input.root).map_err(CliError::from)?;
    for target in &targets {
        let path = root.join(target);
        let Ok(metadata) = std::fs::metadata(&path) else {
            continue;
        };
        if metadata.len() > MAX_FILE_BYTES {
            warnings.push(Warning::new(
                "lint.file_too_large",
                format!("Skipped {target} because it is larger than 2 MB."),
            ));
            continue;
        }
        let stamp = FileStamp::of(&path).map_err(CliError::from)?;
        let bytes = std::fs::read(&path).map_err(CliError::from)?;
        let (original, utf8) = match String::from_utf8(bytes) {
            Ok(text) => (text, true),
            Err(error) => (
                String::from_utf8_lossy(error.as_bytes()).into_owned(),
                false,
            ),
        };
        let (normalized, map) = LineEndingMap::new(&original);
        let source = SourceText::new(normalized);
        let mut diagnostics = Vec::new();
        if is_latex_source_path(target) {
            diagnostics.extend(lint_latex_text(&source));
        }
        if is_bibtex_source_path(target) {
            diagnostics.extend(lint_bibtex_text(&source));
        }
        let format = format_for_path(target);
        if let (Some(checker), Some(format)) = (proofreader.as_mut(), format) {
            match checker.check(&source, format) {
                Ok(outcome) => {
                    if let Some(SkipReason::TooLarge { .. }) = outcome.skipped {
                        warnings.push(Warning::new(
                            "lint.prose_too_large",
                            format!("Skipped spelling and grammar in {target} because it has more than 500,000 characters."),
                        ));
                    }
                    diagnostics.extend(outcome.diagnostics);
                }
                Err(error) => {
                    warnings.push(Warning::new("lint.proofread_failed", format!("Spelling and grammar stopped early in {target} ({error}). Other results are still shown.")));
                }
            }
        }
        if input.fix {
            let prose = format.map(|format| prose_for(format, &source));
            let mut edits: Vec<(usize, usize, String)> = Vec::new();
            if let Some(prose) = &prose {
                edits = diagnostics
                    .iter()
                    .filter_map(|diagnostic| safe_fix(diagnostic, &source, prose))
                    .collect();
            }
            let edits = without_overlaps(edits);
            if !edits.is_empty() {
                let result = if utf8 {
                    apply_fixes(&original, &map, &source, &edits)
                        .and_then(|text| write_if_unchanged(&path, &stamp, text.as_bytes()))
                } else {
                    Err(FixError::NotUtf8)
                };
                match result {
                    Ok(()) => {
                        fixed_files += 1;
                        diagnostics.retain(|diagnostic| {
                            let applied = edits.iter().find(|(from, to, _)| *from == diagnostic.from && *to == diagnostic.to && diagnostic.source == LintSource::Harper);
                            match applied {
                                Some((from, to, replacement)) => {
                                    fixed.push(json!({
                                        "file": target,
                                        "rule_id": diagnostic.rule_id,
                                        "range": {"from": from, "to": to, "start": source.position(*from), "end": source.position(*to)},
                                        "replacement": replacement,
                                    }));
                                    false
                                }
                                None => true,
                            }
                        });
                    }
                    Err(FixError::ChangedOnDisk) => {
                        warnings.push(Warning::new("lint.fix_changed", format!("Didn't fix {target} because it changed while oleafly was checking it.")));
                    }
                    Err(FixError::NotUtf8) => {
                        warnings.push(Warning::new(
                            "lint.fix_not_utf8",
                            format!("Didn't fix {target} because it isn't valid UTF-8."),
                        ));
                    }
                    Err(error) => {
                        warnings.push(Warning::new(
                            "lint.fix_write_failed",
                            format!("Couldn't write {target}: {error}"),
                        ));
                    }
                }
            }
        }
        for diagnostic in &diagnostics {
            rows.push(row_of(diagnostic, target, &source));
            if !rules.iter().any(|rule| rule.id == diagnostic.rule_id) {
                rules.push(rule_meta(diagnostic, &harper_rules));
            }
        }
    }
    let payload = json!({
        "files_checked": targets.len(),
        "prose": proofreader.is_some(),
        "dialect": input.dialect.as_str(),
        "summary": summary(&rows),
        "findings": rows.iter().map(|row| row.json.clone()).collect::<Vec<_>>(),
        "fixed": fixed,
    });
    let fixed_count = payload["fixed"].as_array().map_or(0, Vec::len);
    Ok(LintRun {
        rows,
        rules,
        payload,
        warnings,
        fixed: fixed_count,
        fixed_files,
    })
}

fn read_words(files: &[PathBuf]) -> Result<String, CliError> {
    let mut words = String::new();
    for file in files {
        let text = std::fs::read_to_string(file).map_err(|error| {
            CliError::new(
                ErrorKind::InvalidInput,
                "lint.words_unreadable",
                format!("Oleafly couldn't read {}: {error}", file.display()),
            )
        })?;
        words.push_str(&text);
        words.push('\n');
    }
    Ok(words)
}

async fn run(ctx: &Context, args: LintArgs) -> Result<Outcome, CliError> {
    if args.fix && !AVAILABLE {
        return Err(CliError::usage(
            "--fix needs spelling and grammar, which this build doesn't include.",
        ));
    }
    let opened = crate::engine::open_project(ctx.project(), None, None)?;
    for warning in &opened.warnings {
        ctx.warn(warning.code.clone(), warning.message.clone());
    }
    let workspace = &opened.workspace;
    let input = LintInput {
        root: workspace.root().to_path_buf(),
        cwd: std::env::current_dir().map_err(CliError::from)?,
        paths: args.paths.clone(),
        fix: args.fix,
        prose: !args.no_prose,
        dialect: args.dialect,
        words: read_words(&args.words)?,
    };
    let linted = tokio::task::spawn_blocking(move || execute_lint(input))
        .await
        .map_err(|error| {
            CliError::new(
                ErrorKind::Internal,
                "internal",
                format!("The lint stopped: {error}"),
            )
        })??;
    let base = sarif_base(workspace.root());
    let mut human = crate::check::human::render_human(&linted.rows, ctx.quiet());
    if linted.fixed > 0 {
        let problems = if linted.fixed == 1 {
            "1 problem".to_string()
        } else {
            format!("{} problems", linted.fixed)
        };
        let files = if linted.fixed_files == 1 {
            "1 file".to_string()
        } else {
            format!("{} files", linted.fixed_files)
        };
        human.push_str(&format!("Fixed {problems} in {files}.\n"));
    }
    deliver(
        ctx,
        &args.report,
        Delivery {
            command: "lint",
            key: "lint",
            automation_id: "oleafly/lint/",
            rows: &linted.rows,
            rules: &linted.rules,
            payload: linted.payload,
            warnings: linted.warnings,
            base: &base,
            main_document: &workspace.manifest().main_doc,
            human,
        },
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn input(root: &std::path::Path) -> LintInput {
        LintInput {
            root: root.to_path_buf(),
            cwd: root.to_path_buf(),
            paths: Vec::new(),
            fix: false,
            prose: false,
            dialect: DialectArg::American,
            words: String::new(),
        }
    }

    #[test]
    fn latex_and_bibtex_problems_are_reported() {
        let project = tempfile::tempdir().unwrap();
        std::fs::write(
            project.path().join("main.tex"),
            "\\documentclass{article}\n\\begin{document}\n\\begin{figure}\nx\n\\end{document}\n",
        )
        .unwrap();
        std::fs::write(
            project.path().join("refs.bib"),
            "@article{a,\n  author = {Ada Lovelace},\n  year = {1843}\n}\n",
        )
        .unwrap();
        let run = execute_lint(input(project.path())).unwrap();
        let ids: Vec<&str> = run.rows.iter().map(|row| row.rule_id.as_str()).collect();
        assert!(ids.iter().any(|id| id.starts_with("latex/")), "{ids:?}");
        assert!(ids.iter().any(|id| id.starts_with("bibtex/")), "{ids:?}");
        assert_eq!(run.payload["files_checked"], 2);
        assert_eq!(run.payload["prose"], false);
    }

    #[test]
    fn without_spelling_the_warning_comes_once() {
        if AVAILABLE {
            return;
        }
        let project = tempfile::tempdir().unwrap();
        std::fs::write(project.path().join("a.md"), "Some text.").unwrap();
        std::fs::write(project.path().join("b.md"), "More text.").unwrap();
        let run = execute_lint(LintInput {
            prose: true,
            ..input(project.path())
        })
        .unwrap();
        assert_eq!(
            run.warnings
                .iter()
                .filter(|warning| warning.code == "lint.proofread_unavailable")
                .count(),
            1
        );
    }

    #[test]
    fn fix_repairs_a_repeated_word_and_keeps_crlf() {
        if !AVAILABLE {
            return;
        }
        let project = tempfile::tempdir().unwrap();
        let notes = project.path().join("notes.md");
        std::fs::write(&notes, "We compare the the results.\r\nNext line.\r\n").unwrap();
        let run = execute_lint(LintInput {
            prose: true,
            fix: true,
            ..input(project.path())
        })
        .unwrap();
        assert_eq!(
            std::fs::read_to_string(&notes).unwrap(),
            "We compare the results.\r\nNext line.\r\n"
        );
        assert_eq!(run.fixed, 1);
    }
}
