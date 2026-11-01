pub mod fix_writer;
pub mod select;

use std::collections::{BTreeMap, HashMap};
use std::path::PathBuf;

use clap::{Args, Subcommand, ValueEnum};
use oleafly_lint::proofread::{
    safe_fix, Dialect, IgnoredWords, ProofreadError, Proofreader, SkipReason, AVAILABLE,
};
use oleafly_lint::{
    editor_catalog, format_for_path, is_bibtex_source_path, is_latex_source_path, lint_bibtex_text,
    lint_latex_text, prose_for, render, LintDiagnostic, LintMessage, LintSource, ProseFormat,
};
use oleafly_preflight::{describe_template, Severity, SourceText};
use serde_json::{json, Value};

use crate::check::report::{
    deliver, fingerprint_line, summary, Delivery, Level, ReportArgs, ReportRow, RowRange, RuleMeta,
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

fn row_of(
    diagnostic: &LintDiagnostic,
    file: &str,
    source: &SourceText,
    lines: &mut HashMap<usize, String>,
) -> ReportRow {
    let title = render(&diagnostic.message);
    let range = RowRange {
        from: diagnostic.from,
        to: diagnostic.to,
        start: source.editor_position(diagnostic.from),
        end: source.editor_position(diagnostic.to),
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
        line_text: Some(fingerprint_line(source, diagnostic.from, lines)),
        json,
    }
}

fn diagnose(
    target: &str,
    source: &SourceText,
    proofreader: Option<&mut Proofreader>,
    warnings: &mut Vec<Warning>,
) -> Vec<LintDiagnostic> {
    let mut diagnostics = Vec::new();
    if is_latex_source_path(target) {
        diagnostics.extend(lint_latex_text(source));
    }
    if is_bibtex_source_path(target) {
        diagnostics.extend(lint_bibtex_text(source));
    }
    if let (Some(checker), Some(format)) = (proofreader, format_for_path(target)) {
        match checker.check(source, format) {
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
    diagnostics
}

fn start_proofreader(
    dialect: DialectArg,
    ignored: &IgnoredWords,
    warnings: &mut Vec<Warning>,
) -> Option<Proofreader> {
    match Proofreader::new(dialect.dialect(), ignored) {
        Ok(built) => Some(built),
        Err(ProofreadError::Unavailable) => {
            warnings.push(Warning::new(
                "lint.proofread_unavailable",
                "This build of oleafly has no spelling and grammar checks.",
            ));
            None
        }
        Err(ProofreadError::Panicked(message)) => {
            warnings.push(Warning::new(
                "lint.proofread_failed",
                format!("Spelling and grammar couldn't start: {message}"),
            ));
            None
        }
    }
}

fn decode(bytes: Vec<u8>) -> (String, bool) {
    match String::from_utf8(bytes) {
        Ok(text) => (text, true),
        Err(error) => (
            String::from_utf8_lossy(error.as_bytes()).into_owned(),
            false,
        ),
    }
}

type PlannedEdit = (usize, usize, (String, usize));

fn planned_edits(
    diagnostics: &[LintDiagnostic],
    source: &SourceText,
    format: Option<ProseFormat>,
) -> Vec<PlannedEdit> {
    let Some(prose) = format.map(|format| prose_for(format, source)) else {
        return Vec::new();
    };
    let edits = diagnostics
        .iter()
        .enumerate()
        .filter_map(|(index, diagnostic)| {
            safe_fix(diagnostic, source, &prose)
                .map(|(from, to, replacement)| (from, to, (replacement, index)))
        })
        .collect();
    without_overlaps(edits)
}

fn applied_fixes(
    target: &str,
    diagnostics: &[LintDiagnostic],
    edits: &[PlannedEdit],
    source: &SourceText,
) -> Vec<Value> {
    edits
        .iter()
        .filter_map(|(from, to, (replacement, index))| {
            let diagnostic = diagnostics.get(*index)?;
            Some(json!({
                "file": target,
                "rule_id": diagnostic.rule_id,
                "range": {"from": from, "to": to, "start": source.editor_position(*from), "end": source.editor_position(*to)},
                "replacement": replacement,
            }))
        })
        .collect()
}

fn add_new_warnings(warnings: &mut Vec<Warning>, more: Vec<Warning>) {
    for warning in more {
        let known = warnings
            .iter()
            .any(|seen| seen.code == warning.code && seen.message == warning.message);
        if !known {
            warnings.push(warning);
        }
    }
}

fn fix_warning(target: &str, error: &FixError) -> Warning {
    match error {
        FixError::ChangedOnDisk => Warning::new(
            "lint.fix_changed",
            format!("Didn't fix {target} because it changed while oleafly was checking it."),
        ),
        FixError::NotUtf8 => Warning::new(
            "lint.fix_not_utf8",
            format!("Didn't fix {target} because it isn't valid UTF-8."),
        ),
        _ => Warning::new(
            "lint.fix_write_failed",
            format!("Couldn't write {target}: {error}"),
        ),
    }
}

fn unreadable_warning(target: &str, error: &std::io::Error) -> Warning {
    Warning::new(
        "lint.file_unreadable",
        format!("Skipped {target} because oleafly couldn't read it ({error})."),
    )
}

pub fn execute_lint(input: LintInput) -> Result<LintRun, CliError> {
    execute_lint_until(input, &std::sync::atomic::AtomicBool::new(false))
}

pub fn execute_lint_until(
    input: LintInput,
    cancel: &std::sync::atomic::AtomicBool,
) -> Result<LintRun, CliError> {
    let (targets, walk_cut) = select::lint_targets(&input.root, &input.paths, &input.cwd)?;
    let mut warnings = Vec::new();
    if walk_cut {
        warnings.push(Warning::new(
            "lint.too_many_files",
            format!(
                "Linted only the first {} files, or folders up to {} levels deep. Name the folders to lint to check the rest.",
                select::MAX_FILES,
                select::MAX_DEPTH
            ),
        ));
    }
    let ignored = IgnoredWords::from_lines(&input.words);
    let mut proofreader = if input.prose {
        start_proofreader(input.dialect, &ignored, &mut warnings)
    } else {
        None
    };
    let harper_rules = if proofreader.is_some() {
        oleafly_lint::proofread::rule_descriptions()
    } else {
        BTreeMap::new()
    };
    let mut rows = Vec::new();
    let mut rules: Vec<RuleMeta> = Vec::new();
    let mut fixed: Vec<Value> = Vec::new();
    let mut fixed_files = 0;
    let root = dunce::canonicalize(&input.root).map_err(CliError::from)?;
    for target in &targets {
        if cancel.load(std::sync::atomic::Ordering::Acquire) {
            return Err(CliError::new(
                ErrorKind::Interrupted,
                "interrupted",
                "Stopped.",
            ));
        }
        let path = root.join(target);
        let metadata = match std::fs::metadata(&path) {
            Ok(metadata) => metadata,
            Err(error) => {
                warnings.push(unreadable_warning(target, &error));
                continue;
            }
        };
        if metadata.len() > MAX_FILE_BYTES {
            warnings.push(Warning::new(
                "lint.file_too_large",
                format!("Skipped {target} because it is larger than 2 MB."),
            ));
            continue;
        }
        let read =
            FileStamp::of(&path).and_then(|stamp| std::fs::read(&path).map(|bytes| (stamp, bytes)));
        let (stamp, bytes) = match read {
            Ok(read) => read,
            Err(error) => {
                warnings.push(unreadable_warning(target, &error));
                continue;
            }
        };
        let (original, utf8) = decode(bytes);
        if !utf8 {
            warnings.push(Warning::new(
                "lint.not_utf8",
                format!(
                    "Skipped {target} because it isn't valid UTF-8. Save it as UTF-8 to lint it."
                ),
            ));
            continue;
        }
        let (normalized, map) = LineEndingMap::new(&original);
        let mut source = SourceText::new(normalized);
        let format = format_for_path(target);
        let mut diagnostics = diagnose(target, &source, proofreader.as_mut(), &mut warnings);
        if input.fix {
            let edits = planned_edits(&diagnostics, &source, format);
            if !edits.is_empty() {
                let replacements: Vec<(usize, usize, String)> = edits
                    .iter()
                    .map(|(from, to, (replacement, _))| (*from, *to, replacement.clone()))
                    .collect();
                let result =
                    apply_fixes(&original, &map, &source, &replacements).and_then(|text| {
                        write_if_unchanged(&path, &stamp, text.as_bytes()).map(|()| text)
                    });
                match result {
                    Ok(fixed_text) => {
                        fixed_files += 1;
                        fixed.extend(applied_fixes(target, &diagnostics, &edits, &source));
                        let (after, _) = LineEndingMap::new(&fixed_text);
                        source = SourceText::new(after);
                        let mut recheck = Vec::new();
                        diagnostics = diagnose(target, &source, proofreader.as_mut(), &mut recheck);
                        add_new_warnings(&mut warnings, recheck);
                    }
                    Err(error) => warnings.push(fix_warning(target, &error)),
                }
            }
        }
        let mut lines: HashMap<usize, String> = HashMap::new();
        for diagnostic in &diagnostics {
            rows.push(row_of(diagnostic, target, &source, &mut lines));
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
    let _project_lock = if args.fix {
        crate::commands::cite::app_project_lock(ctx, workspace)?
    } else {
        None
    };
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
    fn a_cancelled_lint_stops_before_its_next_file() {
        use std::sync::atomic::AtomicBool;
        let project = tempfile::tempdir().unwrap();
        std::fs::write(project.path().join("main.tex"), "\\begin{figure}\nx\n").unwrap();
        let error = execute_lint_until(input(project.path()), &AtomicBool::new(true))
            .err()
            .unwrap();
        assert_eq!(error.code, "interrupted");
        let run = execute_lint_until(input(project.path()), &AtomicBool::new(false)).unwrap();
        assert!(!run.rows.is_empty());
    }

    #[test]
    fn invalid_utf8_is_read_with_replacement_characters_and_flagged() {
        assert_eq!(decode(b"abc".to_vec()), ("abc".to_string(), true));
        assert_eq!(
            decode(vec![b'a', 0xff, b'b']),
            ("a\u{fffd}b".to_string(), false)
        );
    }

    fn codes(run: &LintRun) -> Vec<&str> {
        run.warnings
            .iter()
            .map(|warning| warning.code.as_ref())
            .collect()
    }

    #[test]
    fn a_file_that_is_not_utf8_is_skipped_with_a_warning() {
        let project = tempfile::tempdir().unwrap();
        std::fs::write(
            project.path().join("latin1.tex"),
            b"\\begin{figure}caf\xe9\n".as_slice(),
        )
        .unwrap();
        let run = execute_lint(input(project.path())).unwrap();
        assert!(run.rows.is_empty());
        assert_eq!(codes(&run), ["lint.not_utf8"]);
    }

    #[cfg(unix)]
    #[test]
    fn an_unreadable_file_is_a_warning_and_the_others_are_linted() {
        use std::os::unix::fs::PermissionsExt;
        let project = tempfile::tempdir().unwrap();
        let locked = project.path().join("locked.tex");
        std::fs::write(&locked, "x").unwrap();
        std::fs::set_permissions(&locked, std::fs::Permissions::from_mode(0o000)).unwrap();
        std::fs::write(
            project.path().join("main.tex"),
            "\\begin{document}\n\\begin{figure}\n",
        )
        .unwrap();
        let readable_anyway = std::fs::read(&locked).is_ok();
        let run = execute_lint(input(project.path()));
        std::fs::set_permissions(&locked, std::fs::Permissions::from_mode(0o644)).unwrap();
        if readable_anyway {
            return;
        }
        let run = run.unwrap();
        assert_eq!(codes(&run), ["lint.file_unreadable"]);
        assert!(run
            .rows
            .iter()
            .all(|row| row.file.as_deref() == Some("main.tex")));
        assert!(!run.rows.is_empty());
    }

    #[test]
    fn a_byte_order_mark_takes_no_column() {
        let project = tempfile::tempdir().unwrap();
        std::fs::write(
            project.path().join("main.tex"),
            "\u{feff}\\begin{figure}\nx\n",
        )
        .unwrap();
        let run = execute_lint(input(project.path())).unwrap();
        let row = run
            .rows
            .iter()
            .find(|row| row.range.is_some_and(|range| range.start.line == 1))
            .expect("a finding on the first line");
        assert_eq!(row.range.unwrap().start.column, 1);
        assert_eq!(row.json["range"]["start"]["column"], 1);
    }

    #[test]
    fn a_finding_on_a_very_long_line_keeps_a_digest_of_it() {
        let project = tempfile::tempdir().unwrap();
        let long = format!("\\begin{{figure}}{}\n", "x".repeat(100_000));
        std::fs::write(project.path().join("main.tex"), &long).unwrap();
        let run = execute_lint(input(project.path())).unwrap();
        assert!(!run.rows.is_empty());
        for row in &run.rows {
            assert!(row.line_text.as_deref().is_some_and(|text| text.len() < 64));
        }
        let short = SourceText::new("  \\cite{x}\nnext".to_string());
        assert_eq!(
            fingerprint_line(&short, 3, &mut HashMap::new()),
            "  \\cite{x}"
        );
    }

    #[test]
    fn two_findings_on_one_span_make_one_fix() {
        let finding = |rule: &str| LintDiagnostic {
            from: 3,
            to: 6,
            severity: Severity::Warning,
            message: LintMessage::Text("Repeated word".into()),
            source: LintSource::Harper,
            rule_id: format!("harper/{rule}"),
            suggestions: Vec::new(),
            fixable: true,
        };
        let diagnostics = [finding("RepeatedWords"), finding("Other")];
        let source = SourceText::new("the the".to_string());
        let edits: Vec<PlannedEdit> = vec![(3, 6, (String::new(), 0))];
        let fixed = applied_fixes("main.md", &diagnostics, &edits, &source);
        assert_eq!(fixed.len(), 1);
        assert_eq!(fixed[0]["rule_id"], "harper/RepeatedWords");
        let planned = without_overlaps(vec![
            (3, 6, ("a".to_string(), 1)),
            (3, 6, ("b".to_string(), 0)),
        ]);
        assert_eq!(planned, [(3, 6, ("a".to_string(), 1))]);
    }

    #[test]
    fn a_warning_already_given_is_not_repeated() {
        let mut warnings = vec![Warning::new("lint.prose_too_large", "Skipped a.md")];
        add_new_warnings(
            &mut warnings,
            vec![
                Warning::new("lint.prose_too_large", "Skipped a.md"),
                Warning::new("lint.proofread_failed", "Stopped in a.md"),
            ],
        );
        assert_eq!(warnings.len(), 2);
        assert_eq!(warnings[1].code, "lint.proofread_failed");
    }

    #[test]
    fn a_file_left_unfixed_gets_a_warning_that_says_why() {
        let code = |error: FixError| fix_warning("main.tex", &error).code.to_string();
        assert_eq!(code(FixError::ChangedOnDisk), "lint.fix_changed");
        assert_eq!(code(FixError::NotUtf8), "lint.fix_not_utf8");
        assert_eq!(code(FixError::Overlap), "lint.fix_write_failed");
    }

    #[test]
    fn nothing_is_planned_for_a_file_that_is_not_prose() {
        let source = SourceText::new("x".to_string());
        assert!(planned_edits(&[], &source, None).is_empty());
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

    fn lint_args(fix: bool) -> LintArgs {
        LintArgs {
            paths: Vec::new(),
            fix,
            no_prose: false,
            dialect: DialectArg::American,
            words: Vec::new(),
            report: ReportArgs {
                format: None,
                output: None,
                fail_on: crate::check::report::FailOn::Error,
                exit_code: false,
            },
        }
    }

    #[tokio::test]
    async fn fix_leaves_a_project_alone_while_the_app_restores_a_checkpoint() {
        if !AVAILABLE {
            return;
        }
        let data = tempfile::tempdir().unwrap();
        let project = data.path().join("projects").join("project-1");
        std::fs::create_dir_all(project.join(".oleafly")).unwrap();
        let notes = project.join("main.tex");
        let source = "\\documentclass{article}\n\\begin{document}\nWe compare the the results.\n\\end{document}\n";
        std::fs::write(&notes, source).unwrap();
        std::fs::write(project.join(".oleafly/checkpoint-restore-pending"), "").unwrap();
        let ctx = Context::for_test(crate::contract::ContextOptions {
            project: project.clone(),
            data_root: Some(data.path().to_path_buf()),
            ..Default::default()
        });
        let error = run(&ctx, lint_args(true)).await.unwrap_err();
        assert_eq!(error.code, "conflict.restore_pending");
        assert_eq!(std::fs::read_to_string(&notes).unwrap(), source);
        assert!(run(&ctx, lint_args(false)).await.is_ok());
    }

    #[test]
    fn what_is_left_after_a_fix_is_where_the_fixed_file_has_it() {
        if !AVAILABLE {
            return;
        }
        let project = tempfile::tempdir().unwrap();
        let notes = project.path().join("main.tex");
        std::fs::write(
            &notes,
            "\\documentclass{article}\n\\begin{document}\nWe compare the\nthe results.\n\\begin{figure}\nx\n\\end{document}\n",
        )
        .unwrap();
        let line_of = |run: &LintRun| -> Vec<u32> {
            run.rows
                .iter()
                .filter(|row| row.rule_id.starts_with("latex/"))
                .filter_map(|row| row.range.map(|range| range.start.line))
                .collect()
        };
        let before = execute_lint(LintInput {
            prose: true,
            ..input(project.path())
        })
        .unwrap();
        let run = execute_lint(LintInput {
            prose: true,
            fix: true,
            ..input(project.path())
        })
        .unwrap();
        assert_eq!(run.fixed, 1, "{:?}", run.payload["findings"]);
        let after = std::fs::read_to_string(&notes).unwrap();
        let removed = 7 - u32::try_from(after.lines().count()).unwrap();
        assert_eq!(removed, 1, "{after:?}");
        let (was, now) = (line_of(&before), line_of(&run));
        assert!(!now.is_empty());
        assert_eq!(was.len(), now.len());
        for (was, now) in was.iter().zip(&now) {
            assert_eq!(*now + removed, *was, "{was} -> {now}");
        }
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
