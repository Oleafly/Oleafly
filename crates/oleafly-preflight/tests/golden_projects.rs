//! Whole-project goldens: snapshot, index, contexts and preflight against the
//! app's own pipeline (the TypeScript generator runs the real project
//! analyzer and the preflight store's context builders on the same files).

mod support;

use std::io::Read;
use std::path::Path;

use oleafly_preflight::check::{check_project, CheckRequest};
use oleafly_preflight::engine::SourceProfile;
use oleafly_preflight::snapshot::{ProjectSnapshot, SnapshotLimits};
use oleafly_preflight::text::normalize_line_endings;
use oleafly_preflight::types::{CompileContext, CompileStatus, PdfFacts, PreflightEngine};
use serde_json::{json, Value};
use support::{
    assert_golden, fixture_root, optional_string, parse, parse_optional, read_json, string,
};

const MAX_LOG_BYTES: usize = 4 * 1024 * 1024;

/// The head of a build log, as the CLI reads it: at most 4 MiB, cut at a
/// character boundary, decoded lossily, LF line endings.
fn read_log_head(path: &Path) -> String {
    let mut bytes = Vec::new();
    std::fs::File::open(path)
        .unwrap()
        .take(MAX_LOG_BYTES as u64)
        .read_to_end(&mut bytes)
        .unwrap();
    let text = String::from_utf8_lossy(&bytes);
    normalize_line_endings(&text).into_owned()
}

fn project_json(outcome: &oleafly_preflight::CheckOutcome) -> Value {
    let files: Vec<Value> = outcome
        .project
        .files
        .iter()
        .map(|file| {
            let mut entry = json!({ "path": file.path, "hasContent": file.content.is_some() });
            if let Some(size) = file.size {
                entry["size"] = json!(size);
            }
            entry
        })
        .collect();
    json!({ "mainFile": outcome.project.main_file, "files": files })
}

#[test]
fn golden_projects() {
    let root = fixture_root().join("projects");
    let pdf_facts = read_json(&fixture_root().join("expected/pdf-facts.json"));
    let mut fixtures: Vec<_> = std::fs::read_dir(&root)
        .unwrap()
        .flatten()
        .filter(|entry| entry.path().is_dir())
        .map(|entry| entry.path())
        .collect();
    fixtures.sort();
    assert!(
        fixtures.len() >= 10,
        "only {} project fixtures",
        fixtures.len()
    );
    let mut checked = 0;
    for fixture in fixtures {
        let name = fixture.file_name().unwrap().to_string_lossy().into_owned();
        let description = read_json(&fixture.join("fixture.json"));
        let main_document = string(&description, "mainDocument");
        let project = fixture.join("project");
        let snapshot =
            ProjectSnapshot::load(&project, main_document, SnapshotLimits::default()).unwrap();
        for case in description["cases"].as_array().unwrap() {
            let case_name = string(case, "name");
            let compile = optional_string(case, "buildLog").map(|log| CompileContext {
                status: parse_optional::<CompileStatus>(case, "buildStatus")
                    .unwrap_or(CompileStatus::Success),
                log: read_log_head(&project.join(log)),
            });
            let facts: Option<PdfFacts> = optional_string(case, "pdfFacts").map(|file| {
                parse(pdf_facts.get(file).unwrap_or_else(|| {
                    panic!("no PDF facts for {file}. Run `{}`.", support::REGENERATE)
                }))
            });
            let outcome = check_project(&CheckRequest {
                snapshot: &snapshot,
                source_profile: parse::<SourceProfile>(&case["sourceProfile"]),
                engine: parse::<PreflightEngine>(&case["engine"]),
                submission_profile: parse_optional(case, "profile"),
                anonymous_review: case["anonymousReview"].as_bool().unwrap_or(false),
                typst_version: optional_string(case, "typstVersion").map(str::to_string),
                compile,
                pdf_facts: facts,
            });
            let actual = json!({
                "profile": outcome.submission_profile,
                "refs": outcome.refs,
                "project": project_json(&outcome),
                "report": outcome.report,
            });
            let expected_path = fixture.join("expected").join(format!("{case_name}.json"));
            let expected = read_json(&expected_path);
            // Compare the facts first, so an index difference fails with a
            // precise diff before the findings that depend on it.
            assert_golden(
                &format!("{name}/{case_name} refs"),
                &actual["refs"],
                &expected["refs"],
            );
            assert_golden(
                &format!("{name}/{case_name} project"),
                &actual["project"],
                &expected["project"],
            );
            assert_golden(&format!("{name}/{case_name}"), &actual, &expected);
            checked += 1;
        }
    }
    assert!(checked >= 20, "only {checked} project cases");
}
