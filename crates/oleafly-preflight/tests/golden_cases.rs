mod support;

use std::collections::BTreeMap;

use oleafly_preflight::bib::{
    bibliography_candidate_paths, bibliography_declarations, bibliography_display_name,
    bibtex_entry_types, hayagriva_keys, looks_like_hayagriva, parse_entry,
    resolve_bibliography_path, BibliographyEngine, BIBTEX_DIRECTIVES,
};
use oleafly_preflight::compile_rules::run_compile_rules;
use oleafly_preflight::contact::{contains_contact_token, extract_email, extract_phone_number};
use oleafly_preflight::doc_type::looks_like_resume_source;
use oleafly_preflight::document_metadata::requests_tagged_pdf;
use oleafly_preflight::engine::{run_preflight, PreflightInput, SourceProfile};
use oleafly_preflight::mask::mask_comments;
use oleafly_preflight::messages::message;
use oleafly_preflight::profiles::{
    detect_submission_profile, extract_document_class, extract_typst_templates,
    submission_profiles, SubmissionProfileId,
};
use oleafly_preflight::refs_rules::{run_refs_rules, RefsContext, RefsOptions};
use oleafly_preflight::resume::match_resume_section_heading;
use oleafly_preflight::source_rules::run_source_rules;
use oleafly_preflight::standards::{annotate, STANDARD_IDS};
use oleafly_preflight::submission_rules::{run_submission_rules, SubmissionRuleInput};
use oleafly_preflight::types::{
    CompileContext, Finding, FindingMethod, Lens, PdfFacts, PreflightEngine, ProjectContext,
    Severity,
};
use oleafly_preflight::typst::{
    resolve_typst_path, run_typst_refs_rules, run_typst_source_rules, run_typst_submission_rules,
    typst_metadata_findings, typst_version_at_least, TypstSourceFile,
};
use serde_json::{json, Value};
use support::{bool_or, optional_string, parse, parse_optional, run_suite, string};

fn findings(found: Vec<Finding>) -> Value {
    serde_json::to_value(found).unwrap()
}

#[test]
fn golden_source_rules() {
    run_suite("source-rules", 45, |case| {
        let engine =
            parse_optional::<PreflightEngine>(case, "engine").unwrap_or(PreflightEngine::Unknown);
        findings(run_source_rules(string(case, "text"), engine))
    });
}

#[test]
fn golden_refs_rules() {
    run_suite("refs-rules", 30, |case| {
        let ctx: RefsContext = parse(&case["ctx"]);
        let options = case.get("options").cloned().unwrap_or(json!({}));
        let options = RefsOptions {
            include_project_quality: bool_or(&options, "includeProjectQuality", true),
            file: optional_string(&options, "file").map(str::to_string),
        };
        findings(run_refs_rules(string(case, "source"), &ctx, &options))
    });
}

fn submission_input(case: &Value) -> (ProjectContext, SubmissionProfileId, Option<PdfFacts>, bool) {
    (
        parse(&case["project"]),
        parse(&case["profileId"]),
        parse_optional(case, "pdf"),
        bool_or(case, "anonymousReview", false),
    )
}

#[test]
fn golden_submission_rules() {
    run_suite("submission-rules", 30, |case| {
        let (project, profile_id, pdf, anonymous_review) = submission_input(case);
        findings(run_submission_rules(&SubmissionRuleInput {
            project: &project,
            profile_id,
            pdf: pdf.as_ref(),
            anonymous_review,
        }))
    });
}

#[test]
fn golden_compile_rules() {
    run_suite("compile-rules", 15, |case| {
        let compile: Option<CompileContext> = parse_optional(case, "compile");
        let pdf: Option<PdfFacts> = parse_optional(case, "pdf");
        findings(run_compile_rules(compile.as_ref(), pdf.as_ref()))
    });
}

#[test]
fn golden_typst_source_rules() {
    run_suite("typst-source-rules", 25, |case| {
        findings(run_typst_source_rules(
            string(case, "text"),
            optional_string(case, "version"),
        ))
    });
}

#[test]
fn golden_typst_metadata() {
    run_suite("typst-metadata", 8, |case| {
        let sources: Vec<(String, String)> = case["sources"]
            .as_array()
            .unwrap()
            .iter()
            .map(|source| {
                (
                    string(source, "path").to_string(),
                    string(source, "content").to_string(),
                )
            })
            .collect();
        findings(typst_metadata_findings(
            &sources,
            bool_or(case, "anonymousReview", false),
        ))
    });
}

#[test]
fn golden_typst_refs_rules() {
    run_suite("typst-refs-rules", 20, |case| {
        let sources: Vec<TypstSourceFile> = case["sources"]
            .as_array()
            .unwrap()
            .iter()
            .map(|source| TypstSourceFile {
                path: optional_string(source, "path").map(str::to_string),
                content: string(source, "content").to_string(),
            })
            .collect();
        let ctx: RefsContext = parse(&case["ctx"]);
        findings(run_typst_refs_rules(&sources, &ctx))
    });
}

#[test]
fn golden_typst_submission_rules() {
    run_suite("typst-submission-rules", 20, |case| {
        let (project, profile_id, pdf, anonymous_review) = submission_input(case);
        findings(run_typst_submission_rules(&SubmissionRuleInput {
            project: &project,
            profile_id,
            pdf: pdf.as_ref(),
            anonymous_review,
        }))
    });
}

fn arg(case: &Value, index: usize) -> &Value {
    &case["args"][index]
}

fn text_arg(case: &Value, index: usize) -> &str {
    arg(case, index).as_str().unwrap_or("")
}

fn engine_arg(case: &Value, index: usize) -> BibliographyEngine {
    parse(arg(case, index))
}

fn helper(case: &Value) -> Value {
    let function = string(case, "fn");
    match function {
        "extractPhoneNumber" => json!(extract_phone_number(text_arg(case, 0))),
        "containsContactToken" => json!(contains_contact_token(text_arg(case, 0))),
        "extractEmail" => json!(extract_email(text_arg(case, 0))),
        "matchResumeSectionHeading" => json!(match_resume_section_heading(text_arg(case, 0))),
        "looksLikeResumeSource" => json!(looks_like_resume_source(text_arg(case, 0))),
        "detectSubmissionProfile" => json!(detect_submission_profile(text_arg(case, 0))),
        "extractDocumentClass" => json!(extract_document_class(text_arg(case, 0))),
        "extractTypstTemplates" => json!(extract_typst_templates(text_arg(case, 0))),
        "maskComments" => json!(mask_comments(text_arg(case, 0))),
        "requestsTaggedPdf" => json!(requests_tagged_pdf(text_arg(case, 0))),
        "bibliographyDeclarations" => json!(bibliography_declarations(text_arg(case, 0))),
        "bibliographyCandidatePaths" => json!(bibliography_candidate_paths(
            text_arg(case, 0),
            text_arg(case, 1),
            engine_arg(case, 2)
        )),
        "resolveBibliographyPath" => {
            let known: Vec<String> = parse(arg(case, 2));
            json!(resolve_bibliography_path(
                text_arg(case, 0),
                text_arg(case, 1),
                &known,
                engine_arg(case, 3)
            ))
        }
        "bibliographyDisplayName" => json!(bibliography_display_name(
            text_arg(case, 0),
            engine_arg(case, 1)
        )),
        "parseEntry" => json!(parse_entry(text_arg(case, 0))),
        "hayagrivaKeys" => json!(hayagriva_keys(text_arg(case, 0))
            .into_iter()
            .collect::<Vec<_>>()),
        "looksLikeHayagriva" => json!(looks_like_hayagriva(text_arg(case, 0))),
        "typstVersionAtLeast" => {
            let minimum: Vec<u32> = parse(arg(case, 1));
            json!(typst_version_at_least(arg(case, 0).as_str(), &minimum))
        }
        "resolveTypstPath" => json!(resolve_typst_path(arg(case, 0).as_str(), text_arg(case, 1))),
        other => panic!("unknown helper {other}"),
    }
}

#[test]
fn golden_helpers() {
    run_suite("helpers", 65, helper);
}

#[test]
fn golden_engine() {
    run_suite("engine", 10, |case| {
        let input = &case["input"];
        let source_profile =
            parse_optional::<SourceProfile>(input, "sourceProfile").unwrap_or(SourceProfile::Latex);
        let refs: Option<RefsContext> = parse_optional(input, "refs");
        let project: Option<ProjectContext> = parse_optional(input, "project");
        let compile: Option<CompileContext> = parse_optional(input, "compile");
        let facts: Option<PdfFacts> = parse_optional(input, "facts");
        let report = run_preflight(&PreflightInput {
            source: string(input, "source"),
            source_profile,
            typst_version: optional_string(input, "typstVersion"),
            refs: refs.as_ref(),
            facts: facts.as_ref(),
            project: project.as_ref(),
            compile: compile.as_ref(),
            submission_profile: parse_optional(input, "submissionProfile")
                .unwrap_or(SubmissionProfileId::Generic),
            anonymous_review: bool_or(input, "anonymousReview", false),
            engine: parse_optional(input, "engine").unwrap_or(PreflightEngine::Unknown),
        });
        serde_json::to_value(report).unwrap()
    });
}

#[test]
fn golden_tables_match_the_typescript_tables() {
    let expected = support::read_json(&support::fixture_root().join("expected/tables.json"));
    let mut standards = serde_json::Map::new();
    for id in STANDARD_IDS {
        let finding = annotate(
            Finding::new(
                id,
                Lens::A11y,
                Severity::Info,
                message("rules.figure-alt.title"),
                message("rules.figure-alt.detail"),
            ),
            FindingMethod::SourceHeuristic,
        );
        standards.insert(
            id.to_string(),
            json!({ "standards": finding.standards, "machineCheckable": finding.machine_checkable }),
        );
    }
    let profiles: BTreeMap<String, Value> = submission_profiles()
        .iter()
        .map(|profile| {
            (
                profile.id.as_str().to_string(),
                serde_json::to_value(profile).unwrap(),
            )
        })
        .collect();
    let entry_types: Vec<Value> = bibtex_entry_types()
        .iter()
        .map(|entry| json!({ "name": entry.name, "required": entry.required }))
        .collect();
    let actual = json!({
        "standards": standards,
        "profiles": profiles,
        "bibtexEntryTypes": entry_types,
        "bibtexDirectives": BIBTEX_DIRECTIVES,
    });
    support::assert_golden("tables", &actual, &expected);
}
