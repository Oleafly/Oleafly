pub mod artifacts;
pub mod human;
pub mod mcp;
pub mod report;
pub mod sarif;

use std::collections::{BTreeSet, HashMap};
use std::path::{Path, PathBuf};
use std::rc::Rc;

use clap::{Args, Subcommand, ValueEnum};
use oleafly_core::Engine;
use oleafly_preflight::{
    check_project, describe_rule, render_detail, suggested_checks, visible, Catalog, Certainty,
    CheckId, CheckRequest, CheckWarning, CompileContext, Finding, FindingMethod, PreflightEngine,
    ProjectSnapshot, Severity, SnapshotLimits, SourceProfile, SourceText, SubmissionProfileId,
    APP_ONLY_RULES, CHECK_IDS,
};
use serde_json::{json, Map, Value};

use report::{deliver, fingerprint_line, Delivery, Level, ReportRow, RowRange, RuleMeta};
pub use report::{FailOn, FormatArg, ReportArgs};

use crate::commands::CommandModule;
use crate::contract::{CliError, Context, ErrorKind, Outcome, Warning};

const MAX_TEXT_BYTES: usize = 2_000_000;
const MAX_INCLUDE_DEPTH: usize = 64;

#[derive(Debug, Subcommand)]
pub enum Commands {
    /// Check the project before you submit it
    Check(CheckArgs),
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, ValueEnum)]
pub enum ProfileArg {
    Generic,
    Arxiv,
    Ieee,
    Acm,
    Journal,
    Thesis,
}

impl From<ProfileArg> for SubmissionProfileId {
    fn from(value: ProfileArg) -> Self {
        match value {
            ProfileArg::Generic => Self::Generic,
            ProfileArg::Arxiv => Self::Arxiv,
            ProfileArg::Ieee => Self::Ieee,
            ProfileArg::Acm => Self::Acm,
            ProfileArg::Journal => Self::Journal,
            ProfileArg::Thesis => Self::Thesis,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, ValueEnum)]
pub enum CheckArg {
    Compile,
    Submission,
    Ats,
    A11y,
    Refs,
    Privacy,
    All,
}

#[derive(Debug, Args)]
pub struct CheckArgs {
    #[arg(
        long,
        value_enum,
        value_name = "PROFILE",
        help = "The venue to check for: generic, arxiv, ieee, acm, journal or thesis (default: detected)"
    )]
    pub profile: Option<ProfileArg>,
    #[arg(
        long,
        help = "Check for anonymous review (no author names or acknowledgements)"
    )]
    pub anonymous: bool,
    #[arg(
        long,
        value_enum,
        value_delimiter = ',',
        value_name = "CHECKS",
        help = "compile, submission, ats, a11y, refs, privacy or all (default: what suits the document)"
    )]
    pub checks: Vec<CheckArg>,
    #[command(flatten)]
    pub report: ReportArgs,
    #[arg(long, value_name = "FILE", value_parser = crate::contract::path_arg, help = "Check this build log instead of the last build's (a TeX error or an `error:` line in it counts as a failed build)")]
    pub build_log: Option<PathBuf>,
    #[arg(long, value_name = "FILE", value_parser = crate::contract::path_arg, help = "Check this PDF instead of the last build's")]
    pub pdf: Option<PathBuf>,
    #[arg(long, conflicts_with_all = ["build_log", "pdf"], help = "Check the sources only")]
    pub no_build_output: bool,
}

impl CommandModule for Commands {
    fn name(&self) -> &'static str {
        "check"
    }

    async fn run(self, ctx: &Context) -> Result<Outcome, CliError> {
        let Self::Check(args) = self;
        run(ctx, args).await
    }
}

pub struct CheckInput {
    pub root: PathBuf,
    pub main_document: String,
    pub engine: Engine,
    pub tex_flavor: Option<String>,
    pub typst_version: Option<String>,
    pub build_dir: PathBuf,
    pub profile: Option<SubmissionProfileId>,
    pub anonymous: bool,
    pub checks: Vec<CheckArg>,
    pub build_log: Option<PathBuf>,
    pub pdf: Option<PathBuf>,
    pub no_build_output: bool,
}

pub struct CheckRun {
    pub rows: Vec<ReportRow>,
    pub rules: Vec<RuleMeta>,
    pub payload: Value,
    pub warnings: Vec<Warning>,
}

pub fn source_profile(engine: Engine) -> SourceProfile {
    match engine {
        Engine::Tectonic | Engine::Latexmk => SourceProfile::Latex,
        Engine::Typst => SourceProfile::Typst,
        Engine::Markdown | Engine::Quarto | Engine::Calepin => SourceProfile::None,
    }
}

pub fn preflight_engine(engine: Engine, tex_flavor: Option<&str>) -> PreflightEngine {
    match (engine, tex_flavor) {
        (Engine::Tectonic, _) => PreflightEngine::Bundled,
        (Engine::Latexmk, Some("pdflatex")) => PreflightEngine::Pdflatex,
        (Engine::Latexmk, Some("lualatex")) => PreflightEngine::Lualatex,
        (Engine::Latexmk, Some("xelatex")) => PreflightEngine::Xelatex,
        (Engine::Typst, _) => PreflightEngine::Typst,
        _ => PreflightEngine::Unknown,
    }
}

fn level_of(severity: Severity) -> Level {
    match severity {
        Severity::Error => Level::Error,
        Severity::Warning => Level::Warning,
        Severity::Info => Level::Note,
    }
}

fn precision(certainty: Option<Certainty>) -> &'static str {
    match certainty {
        Some(Certainty::Verified) => "high",
        Some(Certainty::Manual) => "low",
        _ => "medium",
    }
}

fn method_name(method: Option<FindingMethod>) -> Option<&'static str> {
    method.map(FindingMethod::as_str)
}

fn checks_selected(requested: &[CheckArg], main_source: &str) -> BTreeSet<CheckId> {
    if requested.is_empty() {
        return suggested_checks(main_source);
    }
    if requested.contains(&CheckArg::All) {
        return CHECK_IDS.into_iter().collect();
    }
    requested
        .iter()
        .filter_map(|check| match check {
            CheckArg::Compile => Some(CheckId::Compile),
            CheckArg::Submission => Some(CheckId::Submission),
            CheckArg::Ats => Some(CheckId::Ats),
            CheckArg::A11y => Some(CheckId::A11y),
            CheckArg::Refs => Some(CheckId::Refs),
            CheckArg::Privacy => Some(CheckId::Privacy),
            CheckArg::All => None,
        })
        .collect()
}

fn warning_of(warning: &CheckWarning) -> Warning {
    match warning {
        CheckWarning::OversizedFile { path } => Warning::new(
            "check.file_too_large",
            format!("{path} is too large to check, so it was skipped."),
        ),
        CheckWarning::UnreadableFile { path, message } => Warning::new(
            "check.file_unreadable",
            format!("Oleafly couldn't read {path}: {message}"),
        ),
        CheckWarning::RegexLimit { rule } => Warning::new(
            "check.rule_limited",
            format!("The {rule} rule stopped early on a very long passage."),
        ),
        CheckWarning::MissingMainDocument { path } => Warning::new(
            "check.missing_main",
            format!("The main document {path} doesn't exist."),
        ),
    }
}

fn row_of(
    finding: &Finding,
    main_document: &str,
    text_of: &mut dyn FnMut(&str) -> Option<Rc<SourceText>>,
    lines: &mut HashMap<String, HashMap<usize, String>>,
) -> ReportRow {
    let catalog = Catalog::preflight();
    let title = catalog.render(&finding.title);
    let detail = Some(render_detail(catalog, finding)).filter(|detail| !detail.trim().is_empty());
    let file = finding
        .file
        .as_deref()
        .map(|file| file.replace('\\', "/"))
        .or_else(|| finding.from.map(|_| main_document.to_string()));
    let mut range = None;
    let mut line_text = None;
    if let (Some(path), Some(from)) = (&file, finding.from) {
        if let Some(text) = text_of(path) {
            let to = finding.to.unwrap_or(from).max(from);
            range = Some(RowRange {
                from,
                to,
                start: text.position(from),
                end: text.position(to),
            });
            line_text = Some(fingerprint_line(
                &text,
                from,
                lines.entry(path.clone()).or_default(),
            ));
        }
    }
    let json = json!({
        "rule_id": finding.id,
        "lens": finding.lens.as_str(),
        "severity": finding.severity.as_str(),
        "certainty": finding.certainty.map(Certainty::as_str),
        "method": method_name(finding.method),
        "title": title,
        "detail": detail,
        "file": file,
        "range": range.map(|range| json!({
            "from": range.from,
            "to": range.to,
            "start": {"line": range.start.line, "column": range.start.column},
            "end": {"line": range.end.line, "column": range.end.column},
        })),
        "standards": finding.standards.clone().unwrap_or_default(),
        "message": {"title": finding.title, "detail": finding.detail, "detail_parts": finding.detail_parts.clone().unwrap_or_default()},
    });
    ReportRow {
        rule_id: finding.id.clone(),
        level: level_of(finding.severity),
        title,
        detail,
        file,
        range,
        line_text,
        json,
    }
}

fn rule_meta(finding: &Finding) -> RuleMeta {
    let (short, full) = describe_rule(&finding.id);
    let mut tags = vec![finding.lens.as_str().to_string()];
    if let Some(method) = method_name(finding.method) {
        tags.push(method.to_string());
    }
    RuleMeta {
        id: finding.id.clone(),
        short,
        full,
        default_level: level_of(finding.severity),
        tags,
        precision: precision(finding.certainty),
        help_uri: None,
    }
}

fn read_pdf(path: &Path, warnings: &mut Vec<Warning>) -> Option<oleafly_preflight::PdfFacts> {
    let unreadable = |warnings: &mut Vec<Warning>, reason: String| {
        warnings.push(Warning::new(
            "check.pdf_unreadable",
            format!("Oleafly couldn't read the PDF, so its checks were skipped: {reason}"),
        ));
    };
    if std::fs::metadata(path)
        .is_ok_and(|metadata| metadata.len() > oleafly_preflight::MAX_PDF_BYTES)
    {
        unreadable(warnings, "it is larger than 256 MB".into());
        return None;
    }
    let mut bytes = Vec::new();
    let read = std::fs::File::open(path).and_then(|file| {
        use std::io::Read;
        file.take(oleafly_preflight::MAX_PDF_BYTES + 1)
            .read_to_end(&mut bytes)
    });
    if let Err(error) = read {
        unreadable(warnings, error.to_string());
        return None;
    }
    if bytes.len() as u64 > oleafly_preflight::MAX_PDF_BYTES {
        unreadable(warnings, "it is larger than 256 MB".into());
        return None;
    }
    match oleafly_preflight::read_pdf_facts(&bytes) {
        Ok(facts) => Some(facts),
        Err(error) => {
            unreadable(warnings, format!("{error:?}"));
            None
        }
    }
}

fn stale_output_warning(found: &artifacts::BuildArtifacts) -> Warning {
    let message = match (found.log_stale, found.pdf_stale) {
        (false, true) => "The PDF is older than the sources, so it wasn't checked. Run `oleafly build` first.",
        (true, false) => "The build log is older than the sources, so it wasn't checked. Run `oleafly build` first.",
        _ => "The last build is older than the sources, so its log and PDF weren't checked. Run `oleafly build` first.",
    };
    Warning::new("check.stale_build_output", message)
}

pub fn execute(input: CheckInput) -> Result<CheckRun, CliError> {
    execute_until(input, &std::sync::atomic::AtomicBool::new(false))
}

pub fn execute_until(
    input: CheckInput,
    cancel: &std::sync::atomic::AtomicBool,
) -> Result<CheckRun, CliError> {
    let stopped = || {
        if cancel.load(std::sync::atomic::Ordering::Acquire) {
            Err(CliError::new(
                ErrorKind::Interrupted,
                "interrupted",
                "Stopped.",
            ))
        } else {
            Ok(())
        }
    };
    let profile = source_profile(input.engine);
    let engine = preflight_engine(input.engine, input.tex_flavor.as_deref());
    // Sources in dependency, generated and hidden folders are not the
    // project's: `oleafly lint` and a linked folder's checkpoints skip them
    // too (a repository's `node_modules` holds thousands of Markdown files).
    // Their files stay in the tree, for figures a document includes from there.
    let snapshot = ProjectSnapshot::load_with(
        &input.root,
        &input.main_document,
        SnapshotLimits {
            max_text_bytes: MAX_TEXT_BYTES,
            max_depth: MAX_INCLUDE_DEPTH,
            ..SnapshotLimits::default()
        },
        &oleafly_core::exclude::is_linked_skipped_directory,
    )
    .map_err(CliError::from)?;
    stopped()?;
    let mut warnings = Vec::new();
    let (log, pdf) = if input.no_build_output {
        (None, None)
    } else {
        let found = artifacts::discover(
            &input.build_dir,
            &input.main_document,
            snapshot.newest_text_modified(),
        );
        if found.stale && input.build_log.is_none() && input.pdf.is_none() {
            warnings.push(stale_output_warning(&found));
        }
        if let Some(other) = &found.other_document {
            if input.build_log.is_none() && input.pdf.is_none() {
                warnings.push(Warning::new(
                    "check.other_document_build",
                    format!(
                        "The last build was of {other}, so its log and PDF weren't checked. Build {} first.",
                        input.main_document
                    ),
                ));
            }
        }
        let log = match &input.build_log {
            Some(path) => Some((path.clone(), None)),
            None => found.log.map(|(path, status)| (path, Some(status))),
        };
        (log, input.pdf.clone().or(found.pdf))
    };
    let compile = match log {
        Some((path, known)) => {
            let text = artifacts::read_log_head(&path).map_err(CliError::from)?;
            // TeX writes its fatal lines near the end, so a long log is
            // judged by its end too.
            let status = match known {
                Some(status) => status,
                None => match artifacts::read_log_tail(&path).map_err(CliError::from)? {
                    Some(tail) => {
                        oleafly_preflight::infer_compile_status(&format!("{text}\n{tail}"))
                    }
                    None => oleafly_preflight::infer_compile_status(&text),
                },
            };
            Some((path, CompileContext { status, log: text }))
        }
        None => None,
    };
    stopped()?;
    let pdf_facts = pdf
        .as_deref()
        .and_then(|path| read_pdf(path, &mut warnings));
    stopped()?;
    let outcome = check_project(&CheckRequest {
        snapshot: &snapshot,
        source_profile: profile,
        engine,
        submission_profile: input.profile,
        anonymous_review: input.anonymous,
        typst_version: input.typst_version.clone(),
        compile: compile.as_ref().map(|(_, context)| context.clone()),
        pdf_facts,
    });
    warnings.extend(outcome.warnings.iter().map(warning_of));
    stopped()?;
    let main_source = snapshot
        .texts
        .get(&snapshot.main_document)
        .map(String::as_str)
        .unwrap_or("");
    let checks = checks_selected(&input.checks, main_source);
    let mut cache: std::collections::HashMap<String, Option<Rc<SourceText>>> =
        std::collections::HashMap::new();
    let mut text_of = |path: &str| -> Option<Rc<SourceText>> {
        cache
            .entry(path.to_string())
            .or_insert_with(|| {
                snapshot.texts.get(path).map(|text| {
                    Rc::new(SourceText::new(
                        oleafly_preflight::normalize_line_endings(text).into_owned(),
                    ))
                })
            })
            .clone()
    };
    let shown: Vec<&Finding> = outcome
        .report
        .findings
        .iter()
        .filter(|finding| visible(finding, &checks))
        .collect();
    let mut lines = HashMap::new();
    let rows: Vec<ReportRow> = shown
        .iter()
        .map(|finding| row_of(finding, &snapshot.main_document, &mut text_of, &mut lines))
        .collect();
    let mut rules: Vec<RuleMeta> = Vec::new();
    for finding in &shown {
        if !rules.iter().any(|rule| rule.id == finding.id) {
            rules.push(rule_meta(finding));
        }
    }
    let scores: Map<String, Value> = CHECK_IDS
        .iter()
        .map(|id| {
            (
                id.as_str().to_string(),
                json!(outcome.report.scores.get(id)),
            )
        })
        .collect();
    let coverage: Map<String, Value> = CHECK_IDS
        .iter()
        .map(|id| {
            (
                id.as_str().to_string(),
                json!(outcome
                    .report
                    .coverage
                    .get(id)
                    .map(|coverage| coverage.as_str())),
            )
        })
        .collect();
    let profile_info = oleafly_preflight::submission_profile(outcome.submission_profile);
    let payload = json!({
        "project": input.root,
        "main_document": input.main_document,
        "source_profile": match profile { SourceProfile::Latex => "latex", SourceProfile::Typst => "typst", SourceProfile::None => "none" },
        "engine": engine.as_str(),
        "profile": {"id": outcome.submission_profile.as_str(), "label": profile_info.label, "detected": outcome.profile_detected},
        "anonymous_review": input.anonymous,
        "checks": checks.iter().map(|id| id.as_str()).collect::<Vec<_>>(),
        "inputs": {
            "build_log": compile.as_ref().map(|(path, _)| path.clone()),
            "build_status": compile.as_ref().map(|(_, context)| match context.status {
                oleafly_preflight::CompileStatus::Success => "success",
                oleafly_preflight::CompileStatus::Error => "error",
                oleafly_preflight::CompileStatus::Idle => "idle",
                oleafly_preflight::CompileStatus::Unavailable => "unavailable",
            }),
            "pdf": pdf,
        },
        "summary": report::summary(&rows),
        "scores": scores,
        "coverage": coverage,
        "findings": rows.iter().map(|row| row.json.clone()).collect::<Vec<_>>(),
        "app_only_rules": APP_ONLY_RULES.iter().map(|(id, _)| *id).collect::<Vec<_>>(),
    });
    Ok(CheckRun {
        rows,
        rules,
        payload,
        warnings,
    })
}

async fn run(ctx: &Context, args: CheckArgs) -> Result<Outcome, CliError> {
    let opened = crate::engine::open_project(ctx.project(), None, None)?;
    for warning in &opened.warnings {
        ctx.warn(warning.code.clone(), warning.message.clone());
    }
    let workspace = &opened.workspace;
    let manifest = workspace.manifest();
    let engine = manifest.engine()?;
    if engine == Engine::Markdown {
        ctx.note("Markdown projects get the build-log and PDF checks; the source checks are for LaTeX and Typst.");
    }
    let input = CheckInput {
        root: workspace.root().to_path_buf(),
        main_document: manifest.main_doc.clone(),
        engine,
        tex_flavor: manifest.normalized_tex_flavor().ok().flatten(),
        typst_version: manifest.typst_version_pin().map(str::to_string),
        build_dir: workspace.build_dir_path(),
        profile: args.profile.map(Into::into),
        anonymous: args.anonymous,
        checks: args.checks.clone(),
        build_log: args.build_log.clone(),
        pdf: args.pdf.clone(),
        no_build_output: args.no_build_output,
    };
    let checked = tokio::task::spawn_blocking(move || execute(input))
        .await
        .map_err(|error| {
            CliError::new(
                ErrorKind::Internal,
                "internal",
                format!("The check stopped: {error}"),
            )
        })??;
    let base = sarif::sarif_base(workspace.root());
    let human = human::render_human(&checked.rows, ctx.quiet());
    deliver(
        ctx,
        &args.report,
        Delivery {
            command: "check",
            key: "check",
            automation_id: "oleafly/check/",
            rows: &checked.rows,
            rules: &checked.rules,
            payload: checked.payload,
            warnings: checked.warnings,
            base: &base,
            main_document: &manifest.main_doc,
            human,
        },
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn engine_and_source_profile_follow_the_app() {
        assert_eq!(
            (
                preflight_engine(Engine::Tectonic, None),
                source_profile(Engine::Tectonic)
            ),
            (PreflightEngine::Bundled, SourceProfile::Latex)
        );
        assert_eq!(
            preflight_engine(Engine::Latexmk, Some("xelatex")),
            PreflightEngine::Xelatex
        );
        assert_eq!(
            preflight_engine(Engine::Latexmk, Some("uplatex")),
            PreflightEngine::Unknown
        );
        assert_eq!(
            preflight_engine(Engine::Latexmk, None),
            PreflightEngine::Unknown
        );
        assert_eq!(
            (
                preflight_engine(Engine::Typst, None),
                source_profile(Engine::Typst)
            ),
            (PreflightEngine::Typst, SourceProfile::Typst)
        );
        assert_eq!(
            (
                preflight_engine(Engine::Markdown, None),
                source_profile(Engine::Markdown)
            ),
            (PreflightEngine::Unknown, SourceProfile::None)
        );
    }

    #[test]
    fn checks_default_to_what_suits_the_document() {
        let resume = "\\documentclass{moderncv}\n\\name{Ada}{Lovelace}\n\\section{Experience}";
        let all = checks_selected(&[CheckArg::All], resume);
        assert_eq!(all.len(), CHECK_IDS.len());
        let only = checks_selected(&[CheckArg::Refs, CheckArg::Privacy], resume);
        assert_eq!(
            only.iter().map(|id| id.as_str()).collect::<Vec<_>>(),
            ["refs", "privacy"]
        );
        assert_eq!(
            checks_selected(&[], "\\documentclass{article}"),
            suggested_checks("\\documentclass{article}")
        );
    }

    fn check_with_log(project: &Path, log: &Path) -> CheckRun {
        execute(CheckInput {
            root: project.to_path_buf(),
            main_document: "main.tex".into(),
            engine: Engine::Tectonic,
            tex_flavor: None,
            typst_version: None,
            build_dir: project.join(".oleafly/build"),
            profile: None,
            anonymous: false,
            checks: vec![CheckArg::All],
            build_log: Some(log.to_path_buf()),
            pdf: None,
            no_build_output: false,
        })
        .unwrap()
    }

    #[test]
    fn a_build_log_that_shows_a_failed_build_fails_the_check() {
        let project = tempfile::tempdir().unwrap();
        std::fs::write(
            project.path().join("main.tex"),
            "\\documentclass{article}\n\\usepackage{missing}\n\\begin{document}x\\end{document}\n",
        )
        .unwrap();
        let failed = project.path().join("failed.log");
        std::fs::write(
            &failed,
            "(./main.tex\n! LaTeX Error: File `missing.sty' not found.\n\nType X to quit.\n!  ==> Fatal error occurred, no output PDF file produced!\n",
        )
        .unwrap();
        let run = check_with_log(project.path(), &failed);
        assert_eq!(run.payload["inputs"]["build_status"], "error");
        assert!(
            run.rows.iter().any(|row| row.rule_id == "compile-failed"),
            "{:?}",
            run.rows.iter().map(|row| &row.rule_id).collect::<Vec<_>>()
        );

        let good = project.path().join("good.log");
        std::fs::write(
            &good,
            "(./main.tex\nOverfull \\hbox (2.0pt too wide) in paragraph at lines 3--4\nOutput written on main.pdf (1 page, 1234 bytes).\n",
        )
        .unwrap();
        let run = check_with_log(project.path(), &good);
        assert_eq!(run.payload["inputs"]["build_status"], "success");
        assert!(!run.rows.iter().any(|row| row.rule_id == "compile-failed"));
    }

    #[test]
    fn sources_in_dependency_folders_are_not_checked_as_the_projects() {
        let project = tempfile::tempdir().unwrap();
        std::fs::write(
            project.path().join("main.tex"),
            "\\documentclass{article}\n\\begin{document}\n\\section{A}\\label{sec:a}\n\\end{document}\n",
        )
        .unwrap();
        std::fs::create_dir_all(project.path().join("node_modules/pkg")).unwrap();
        std::fs::write(
            project.path().join("node_modules/pkg/vendored.tex"),
            "\\section{B}\\label{sec:a} TODO\n",
        )
        .unwrap();
        let run = execute(CheckInput {
            root: project.path().to_path_buf(),
            main_document: "main.tex".into(),
            engine: Engine::Tectonic,
            tex_flavor: None,
            typst_version: None,
            build_dir: project.path().join(".oleafly/build"),
            profile: None,
            anonymous: false,
            checks: vec![CheckArg::All],
            build_log: None,
            pdf: None,
            no_build_output: true,
        })
        .unwrap();
        let reported = serde_json::to_string(&run.payload).unwrap();
        assert!(!reported.contains("node_modules"), "{reported}");
    }

    #[test]
    fn stale_output_names_what_was_left_out() {
        let found = |log_stale, pdf_stale| artifacts::BuildArtifacts {
            stale: true,
            log_stale,
            pdf_stale,
            ..Default::default()
        };
        let pdf_only = stale_output_warning(&found(false, true)).message;
        assert!(pdf_only.contains("The PDF is older") && !pdf_only.contains("log"));
        let log_only = stale_output_warning(&found(true, false)).message;
        assert!(log_only.contains("build log is older") && !log_only.contains("PDF"));
        assert!(stale_output_warning(&found(true, true))
            .message
            .contains("log and PDF"));
    }

    #[test]
    fn a_latex_project_is_checked_from_its_sources() {
        let project = tempfile::tempdir().unwrap();
        std::fs::write(
            project.path().join("main.tex"),
            "\\documentclass{article}\n\\begin{document}\nSee \\cite{missing} and \\ref{nowhere}.\n\\end{document}\n",
        )
        .unwrap();
        let run = execute(CheckInput {
            root: project.path().to_path_buf(),
            main_document: "main.tex".into(),
            engine: Engine::Tectonic,
            tex_flavor: None,
            typst_version: None,
            build_dir: project.path().join(".oleafly/build"),
            profile: None,
            anonymous: false,
            checks: vec![CheckArg::All],
            build_log: None,
            pdf: None,
            no_build_output: true,
        })
        .unwrap();
        assert!(run.payload["findings"].as_array().is_some());
        assert_eq!(run.payload["source_profile"], "latex");
        for row in &run.rows {
            if let Some(range) = row.range {
                assert!(range.start.line >= 1 && range.start.column >= 1);
            }
        }
        assert!(!serde_json::to_string(&run.payload)
            .unwrap()
            .contains("sk-proj-"));
    }

    #[test]
    fn a_finding_on_a_very_long_line_keeps_a_digest_of_it() {
        let project = tempfile::tempdir().unwrap();
        let short = "See \\ref{gone}.";
        let long = format!("See \\ref{{nowhere}}{}.", " x".repeat(50_000));
        std::fs::write(
            project.path().join("main.tex"),
            format!("\\documentclass{{article}}\n\\begin{{document}}\n{short}\n{long}\n\\end{{document}}\n"),
        )
        .unwrap();
        let run = execute(CheckInput {
            root: project.path().to_path_buf(),
            main_document: "main.tex".into(),
            engine: Engine::Tectonic,
            tex_flavor: None,
            typst_version: None,
            build_dir: project.path().join(".oleafly/build"),
            profile: None,
            anonymous: false,
            checks: vec![CheckArg::Refs],
            build_log: None,
            pdf: None,
            no_build_output: true,
        })
        .unwrap();
        let on_line = |line: u32| {
            run.rows
                .iter()
                .filter(|row| row.range.is_some_and(|range| range.start.line == line))
                .filter_map(|row| row.line_text.as_deref())
                .collect::<Vec<_>>()
        };
        assert!(!on_line(3).is_empty(), "{:?}", run.payload["findings"]);
        assert!(on_line(3).iter().all(|text| *text == short));
        assert!(!on_line(4).is_empty(), "{:?}", run.payload["findings"]);
        assert!(on_line(4).iter().all(|text| text.len() < 64));
    }
}
