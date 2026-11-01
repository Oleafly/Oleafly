use std::sync::LazyLock;

use serde::{Deserialize, Serialize};

use crate::compile_rules::run_compile_rules;
use crate::jsre::{self, JsRegex};
use crate::profiles::SubmissionProfileId;
use crate::refs_rules::{run_refs_rules, RefsContext, RefsOptions};
use crate::score::compute_scores;
use crate::source_rules::run_source_rules;
use crate::submission_rules::{run_submission_rules, SubmissionRuleInput};
use crate::types::{
    CheckCoverage, CheckId, CompileContext, CompileStatus, Coverage, Finding, PdfFacts,
    PreflightEngine, PreflightReport, ProjectContext,
};
use crate::typst::{
    run_typst_refs_rules, run_typst_source_rules, run_typst_submission_rules,
    typst_metadata_findings, typst_project_sources,
};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SourceProfile {
    Latex,
    Typst,
    None,
}

impl SourceProfile {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Latex => "latex",
            Self::Typst => "typst",
            Self::None => "none",
        }
    }
}

pub struct PreflightInput<'a> {
    pub source: &'a str,
    pub source_profile: SourceProfile,
    pub typst_version: Option<&'a str>,
    pub refs: Option<&'a RefsContext>,
    pub facts: Option<&'a PdfFacts>,
    pub project: Option<&'a ProjectContext>,
    pub compile: Option<&'a CompileContext>,
    pub submission_profile: SubmissionProfileId,
    pub anonymous_review: bool,
    pub engine: PreflightEngine,
}

static LATEX_SOURCE: LazyLock<JsRegex> =
    LazyLock::new(|| JsRegex::std(r"(?i)\.(?:tex|ltx|sty|cls)$"));

struct LatexSource {
    path: Option<String>,
    content: String,
}

fn latex_project_sources(project: Option<&ProjectContext>, fallback: &str) -> Vec<LatexSource> {
    let Some(project) = project else {
        return vec![LatexSource {
            path: None,
            content: fallback.to_string(),
        }];
    };
    let mut files: Vec<_> = project
        .files
        .iter()
        .filter(|file| file.content.is_some() && LATEX_SOURCE.is_match(&file.path))
        .collect();
    files.sort_by_key(|file| file.path != project.main_file);
    if files.is_empty() {
        return vec![LatexSource {
            path: Some(project.main_file.clone()),
            content: fallback.to_string(),
        }];
    }
    files
        .into_iter()
        .map(|file| LatexSource {
            path: Some(file.path.clone()),
            content: file.content.clone().unwrap_or_default(),
        })
        .collect()
}

fn latex_source_findings(input: &PreflightInput) -> Vec<Finding> {
    latex_project_sources(input.project, input.source)
        .into_iter()
        .flat_map(|file| {
            run_source_rules(&file.content, input.engine)
                .into_iter()
                .map(move |mut finding| {
                    if let Some(path) = file.path.as_ref().filter(|path| !path.is_empty()) {
                        finding.file = Some(path.clone());
                    }
                    finding
                })
                .collect::<Vec<_>>()
        })
        .collect()
}

fn latex_refs_findings(input: &PreflightInput, refs: &RefsContext) -> Vec<Finding> {
    latex_project_sources(input.project, input.source)
        .into_iter()
        .enumerate()
        .flat_map(|(index, file)| {
            let path = file.path.clone().filter(|path| !path.is_empty());
            let options = RefsOptions {
                include_project_quality: index == 0,
                file: path.clone(),
            };
            run_refs_rules(&file.content, refs, &options)
                .into_iter()
                .map(move |mut finding| {
                    if let Some(path) = &path {
                        if finding.from.is_some() && finding.file.is_none() {
                            finding.file = Some(path.clone());
                        }
                    }
                    finding
                })
                .collect::<Vec<_>>()
        })
        .collect()
}

fn typst_source_findings(input: &PreflightInput) -> Vec<Finding> {
    let sources = typst_project_sources(input.project, input.source);
    let mut out: Vec<Finding> = sources
        .iter()
        .flat_map(|file| {
            run_typst_source_rules(&file.content, input.typst_version)
                .into_iter()
                .map(|mut finding| {
                    if let Some(path) = file.path.as_ref().filter(|path| !path.is_empty()) {
                        finding.file = Some(path.clone());
                    }
                    finding
                })
                .collect::<Vec<_>>()
        })
        .collect();
    let metadata_sources: Vec<(String, String)> = sources
        .iter()
        .map(|file| (file.path.clone().unwrap_or_default(), file.content.clone()))
        .collect();
    out.extend(typst_metadata_findings(
        &metadata_sources,
        input.anonymous_review,
    ));
    out
}

fn source_findings(input: &PreflightInput) -> Vec<Finding> {
    match input.source_profile {
        SourceProfile::Latex => jsre::with_scope("source-rules", || latex_source_findings(input)),
        SourceProfile::Typst => {
            jsre::with_scope("typst-source-rules", || typst_source_findings(input))
        }
        SourceProfile::None => Vec::new(),
    }
}

fn refs_findings(input: &PreflightInput, refs: &RefsContext) -> Vec<Finding> {
    match input.source_profile {
        SourceProfile::Latex => jsre::with_scope("refs-rules", || latex_refs_findings(input, refs)),
        SourceProfile::Typst => jsre::with_scope("typst-refs-rules", || {
            run_typst_refs_rules(&typst_project_sources(input.project, input.source), refs)
        }),
        SourceProfile::None => Vec::new(),
    }
}

fn submission_findings(input: &PreflightInput, project: &ProjectContext) -> Vec<Finding> {
    let rule_input = SubmissionRuleInput {
        project,
        profile_id: input.submission_profile,
        pdf: input.facts,
        anonymous_review: input.anonymous_review,
    };
    match input.source_profile {
        SourceProfile::Latex => {
            jsre::with_scope("submission-rules", || run_submission_rules(&rule_input))
        }
        SourceProfile::Typst => jsre::with_scope("typst-submission-rules", || {
            run_typst_submission_rules(&rule_input)
        }),
        SourceProfile::None => Vec::new(),
    }
}

fn dedupe_untagged_finding(findings: Vec<Finding>) -> Vec<Finding> {
    let mut saw_untagged = false;
    findings
        .into_iter()
        .filter(|finding| {
            if finding.id != "pdf-untagged-output" {
                return true;
            }
            !std::mem::replace(&mut saw_untagged, true)
        })
        .collect()
}

fn submission_coverage(supported: bool, has_project: bool, has_facts: bool) -> Coverage {
    if !supported {
        Coverage::Unsupported
    } else if !has_project {
        Coverage::NotRun
    } else if has_facts {
        Coverage::Evaluated
    } else {
        Coverage::Partial
    }
}

fn privacy_coverage(supported: bool, has_project: bool, facts_pending: bool) -> Coverage {
    if !supported {
        Coverage::Unsupported
    } else if !has_project {
        Coverage::NotRun
    } else if facts_pending {
        Coverage::Partial
    } else {
        Coverage::Evaluated
    }
}

pub fn run_preflight(input: &PreflightInput) -> PreflightReport {
    let supported = input.source_profile != SourceProfile::None;
    let mut findings = source_findings(input);
    let refs = input
        .refs
        .map(|refs| refs_findings(input, refs))
        .unwrap_or_default();
    findings.extend(refs);
    findings.extend(jsre::with_scope("compile-rules", || {
        run_compile_rules(input.compile, input.facts)
    }));
    if let Some(project) = input.project {
        findings.extend(submission_findings(input, project));
    }
    let findings = dedupe_untagged_finding(findings);

    let scores = compute_scores(&findings);
    let compile_ran = input.compile.is_some_and(|compile| {
        matches!(
            compile.status,
            CompileStatus::Success | CompileStatus::Error
        )
    }) || input.facts.is_some();
    let mut coverage = CheckCoverage::new();
    coverage.insert(CheckId::Ats, Coverage::NotRun);
    coverage.insert(
        CheckId::Compile,
        if compile_ran {
            Coverage::Evaluated
        } else {
            Coverage::NotRun
        },
    );
    coverage.insert(CheckId::A11y, Coverage::NotRun);
    coverage.insert(
        CheckId::Refs,
        if supported && input.refs.is_some() {
            Coverage::Evaluated
        } else {
            Coverage::Unsupported
        },
    );
    coverage.insert(
        CheckId::Submission,
        submission_coverage(supported, input.project.is_some(), input.facts.is_some()),
    );
    coverage.insert(
        CheckId::Privacy,
        privacy_coverage(
            supported,
            input.project.is_some(),
            input.anonymous_review && input.facts.is_none(),
        ),
    );
    let score_or_null = |id: CheckId| -> Option<i64> {
        match coverage.get(&id) {
            Some(Coverage::NotRun) | Some(Coverage::Unsupported) | None => None,
            _ => scores.get(&id).copied(),
        }
    };
    PreflightReport {
        ats_score: score_or_null(CheckId::Ats),
        compile_score: score_or_null(CheckId::Compile),
        a11y_score: score_or_null(CheckId::A11y),
        refs_score: score_or_null(CheckId::Refs),
        submission_score: score_or_null(CheckId::Submission),
        privacy_score: score_or_null(CheckId::Privacy),
        findings,
        scores,
        coverage,
        has_pdf: false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn input<'a>(source: &'a str, profile: SourceProfile) -> PreflightInput<'a> {
        PreflightInput {
            source,
            source_profile: profile,
            typst_version: None,
            refs: None,
            facts: None,
            project: None,
            compile: None,
            submission_profile: SubmissionProfileId::Generic,
            anonymous_review: false,
            engine: PreflightEngine::Unknown,
        }
    }

    #[test]
    fn a_source_only_run_reports_coverage_like_the_app() {
        let report = run_preflight(&input("\\documentclass{article}", SourceProfile::Latex));
        assert_eq!(report.coverage[&CheckId::Refs], Coverage::Unsupported);
        assert_eq!(report.coverage[&CheckId::Submission], Coverage::NotRun);
        assert_eq!(report.coverage[&CheckId::Compile], Coverage::NotRun);
        assert_eq!(report.refs_score, None);
        assert!(!report.has_pdf);
    }

    #[test]
    fn markdown_gets_no_source_rules_but_still_reads_the_log() {
        let compile = CompileContext {
            status: CompileStatus::Error,
            log: String::new(),
        };
        let mut run = input("# Notes", SourceProfile::None);
        run.compile = Some(&compile);
        let report = run_preflight(&run);
        let ids: Vec<_> = report.findings.iter().map(|f| f.id.as_str()).collect();
        assert_eq!(ids, vec!["compile-failed"]);
        assert_eq!(report.compile_score, Some(85));
        assert_eq!(report.coverage[&CheckId::Privacy], Coverage::Unsupported);
    }
}
