use std::collections::{BTreeMap, BTreeSet};

use crate::context::{build_project_context, build_refs_context, ContextInput};
use crate::doc_type::looks_like_resume_source;
use crate::engine::{run_preflight, PreflightInput, SourceProfile};
use crate::index::build_index;
use crate::jsre;
use crate::profiles::{detect_submission_profile, SubmissionProfileId};
use crate::refs_rules::RefsContext;
use crate::score::finding_applies_to;
use crate::snapshot::ProjectSnapshot;
use crate::types::{
    CheckId, CompileContext, Finding, PdfFacts, PreflightEngine, PreflightReport, ProjectContext,
    CHECK_IDS,
};
use crate::typst::typst_referenced_images;

pub const MAX_MEASURED_IMAGES: usize = 256;

pub struct CheckRequest<'a> {
    pub snapshot: &'a ProjectSnapshot,
    pub source_profile: SourceProfile,
    pub engine: PreflightEngine,
    pub submission_profile: Option<SubmissionProfileId>,
    pub anonymous_review: bool,
    pub typst_version: Option<String>,
    pub compile: Option<CompileContext>,
    pub pdf_facts: Option<PdfFacts>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum CheckWarning {
    OversizedFile { path: String },
    UnreadableFile { path: String, message: String },
    RegexLimit { rule: String },
    MissingMainDocument { path: String },
}

#[derive(Clone, Debug)]
pub struct CheckOutcome {
    pub report: PreflightReport,
    pub submission_profile: SubmissionProfileId,
    pub profile_detected: bool,
    pub refs: Option<RefsContext>,
    pub project: ProjectContext,
    pub warnings: Vec<CheckWarning>,
}

fn with_image_sizes(snapshot: &ProjectSnapshot, mut project: ProjectContext) -> ProjectContext {
    let mut requested: Vec<String> = Vec::new();
    for path in typst_referenced_images(&project) {
        if !requested.contains(&path) {
            requested.push(path);
        }
        if requested.len() == MAX_MEASURED_IMAGES {
            break;
        }
    }
    let sizes: BTreeMap<String, u64> = requested
        .into_iter()
        .filter_map(|path| snapshot.file_size(&path).map(|size| (path, size)))
        .collect();
    for file in &mut project.files {
        if let Some(size) = sizes.get(&file.path) {
            file.size = Some(*size);
        }
    }
    project
}

pub fn check_project(request: &CheckRequest) -> CheckOutcome {
    jsre::take_limit_hits();
    let snapshot = request.snapshot;
    let mut warnings = Vec::new();
    let main_source = snapshot
        .texts
        .get(&snapshot.main_document)
        .map(String::as_str)
        .unwrap_or("");
    let main_listed = snapshot.tree_paths.contains(&snapshot.main_document)
        || snapshot.texts.contains_key(&snapshot.main_document);
    if !main_listed {
        warnings.push(CheckWarning::MissingMainDocument {
            path: snapshot.main_document.clone(),
        });
    }
    let submission_profile = request
        .submission_profile
        .unwrap_or_else(|| detect_submission_profile(main_source));

    let index = build_index(&snapshot.texts);
    let open_texts = BTreeMap::new();
    let input = ContextInput {
        main_doc: &snapshot.main_document,
        tree_paths: &snapshot.tree_paths,
        index_texts: &snapshot.texts,
        open_texts: &open_texts,
        index: Some(&index),
    };
    let refs = build_refs_context(&input);
    let mut project = build_project_context(&input);
    if request.source_profile == SourceProfile::Typst {
        project = with_image_sizes(snapshot, project);
    }

    let report = run_preflight(&PreflightInput {
        source: main_source,
        source_profile: request.source_profile,
        typst_version: request.typst_version.as_deref(),
        refs: Some(&refs),
        facts: request.pdf_facts.as_ref(),
        project: Some(&project),
        compile: request.compile.as_ref(),
        submission_profile,
        anonymous_review: request.anonymous_review,
        engine: request.engine,
    });

    warnings.extend(
        snapshot
            .oversized
            .iter()
            .map(|path| CheckWarning::OversizedFile { path: path.clone() }),
    );
    warnings.extend(
        snapshot
            .unreadable
            .iter()
            .map(|issue| CheckWarning::UnreadableFile {
                path: issue.path.clone(),
                message: issue.message.clone(),
            }),
    );
    warnings.extend(
        jsre::take_limit_hits()
            .into_iter()
            .map(|rule| CheckWarning::RegexLimit {
                rule: rule.to_string(),
            }),
    );

    CheckOutcome {
        report,
        submission_profile,
        profile_detected: request.submission_profile.is_none(),
        refs: (request.source_profile != SourceProfile::None).then_some(refs),
        project,
        warnings,
    }
}

pub fn suggested_checks(main_source: &str) -> BTreeSet<CheckId> {
    if looks_like_resume_source(main_source) {
        [CheckId::Ats, CheckId::Compile].into_iter().collect()
    } else {
        [
            CheckId::Compile,
            CheckId::A11y,
            CheckId::Refs,
            CheckId::Submission,
            CheckId::Privacy,
        ]
        .into_iter()
        .collect()
    }
}

pub fn visible(finding: &Finding, checks: &BTreeSet<CheckId>) -> bool {
    CHECK_IDS
        .iter()
        .any(|id| checks.contains(id) && finding_applies_to(finding, *id))
}

pub const PORTED_RULE_IDS: &[&str] = &[
    "multi-column",
    "multi-column-reading-order-risk",
    "no-glyphtounicode",
    "mathml-export-hint",
    "icon-near-contact",
    "layout-table",
    "contact-in-header",
    "figure-alt",
    "link-text",
    "no-lang",
    "no-title",
    "heading-skip",
    "nonstandard-headings",
    "color-only",
    "reading-order-risk",
    "ua-standard-without-title",
    "ua-standard-on-tectonic",
    "table-header-rows",
    "refs-undefined-cite",
    "refs-undefined-ref",
    "refs-duplicate-label",
    "refs-missing-asset",
    "refs-bib-missing",
    "refs-duplicate-bib",
    "refs-incomplete-metadata",
    "refs-malformed-doi",
    "refs-duplicate-title",
    "refs-uncited-entries",
    "refs-project-duplicate-label",
    "refs-unreferenced-floats",
    "refs-duplicate-bib-key",
    "refs-no-bibliography",
    "submission-nonportable-filename",
    "submission-absolute-path",
    "submission-shell-escape",
    "submission-generated-file",
    "submission-document-class",
    "submission-no-abstract",
    "submission-no-keywords",
    "submission-figure-format",
    "submission-placeholder",
    "submission-path-case",
    "submission-missing-project-file",
    "submission-missing-caption",
    "submission-label-before-caption",
    "submission-large-image",
    "privacy-sensitive-file",
    "privacy-credential",
    "privacy-internal-comment",
    "privacy-draft-artifact",
    "privacy-blind-author",
    "privacy-blind-acknowledgements",
    "privacy-blind-email",
    "empty-heading",
    "todo-in-text",
    "privacy-local-path",
    "no-author",
    "compile-failed",
    "compile-overfull-box",
    "compile-missing-glyph",
    "compile-unresolved-references",
    "compile-rerun-required",
    "compile-duplicate-destination",
    "output-tagpdf-warning",
    "output-tagging-status",
    "submission-pdf-version",
    "submission-bookmarks",
    "submission-links",
    "submission-attachments",
    "submission-security",
    "submission-unembedded-font",
    "submission-font-inspection-incomplete",
    "privacy-pdf-author",
    "compile-mixed-page-sizes",
];

const NEEDS_PAGE_TEXT: &str = "Needs the positioned PDF text and reading order the app extracts.";
const NEEDS_METADATA_STATUS: &str =
    "Depends on how the app's PDF reader extracts metadata, XMP and MarkInfo.";
const NEEDS_PAGE_PASS: &str = "Runs inside the app's PDF page-text pass.";
const NEEDS_TAG_TREE: &str = "Walks the PDF tag tree and marked content, which only the app reads.";
const NEEDS_READER_TEXT: &str = "Needs the reader-order text the app extracts for résumé parsing.";

pub const APP_ONLY_RULES: &[(&str, &str)] = &[
    ("output-clipped-content", NEEDS_PAGE_TEXT),
    ("output-small-text", NEEDS_PAGE_TEXT),
    ("pdf-garbled", NEEDS_PAGE_TEXT),
    ("pdf-selectable", NEEDS_PAGE_TEXT),
    ("pdf-reading-order", NEEDS_PAGE_TEXT),
    ("pdf-lang-title", NEEDS_METADATA_STATUS),
    ("pdf-metadata-extraction-failed", NEEDS_METADATA_STATUS),
    ("pdf-mark-info-extraction-failed", NEEDS_METADATA_STATUS),
    ("pdf-no-bookmarks", NEEDS_PAGE_PASS),
    ("output-figure-alt", NEEDS_TAG_TREE),
    ("output-formula-alt", NEEDS_TAG_TREE),
    ("output-heading-skip", NEEDS_TAG_TREE),
    ("output-table-headers", NEEDS_TAG_TREE),
    ("pdf-display-doc-title", NEEDS_TAG_TREE),
    ("pdf-link-alt", NEEDS_TAG_TREE),
    ("pdf-structure-extraction-failed", NEEDS_TAG_TREE),
    ("pdf-structure-missing", NEEDS_TAG_TREE),
    ("pdf-structure-single-pass", NEEDS_TAG_TREE),
    ("pdf-suspects", NEEDS_TAG_TREE),
    ("pdf-ua-claim-mismatch", NEEDS_TAG_TREE),
    ("pdf-untagged-content", NEEDS_TAG_TREE),
    ("pdf-untagged-output", NEEDS_TAG_TREE),
    ("pdf-xmp-title", NEEDS_TAG_TREE),
    ("ats-long-resume", NEEDS_READER_TEXT),
    ("ats-no-email", NEEDS_READER_TEXT),
    ("ats-no-experience", NEEDS_READER_TEXT),
    ("ats-no-name", NEEDS_READER_TEXT),
    ("ats-no-phone", NEEDS_READER_TEXT),
];

#[cfg(test)]
mod tests {
    use super::*;
    use crate::messages::describe_rule;
    use crate::snapshot::SnapshotLimits;

    #[test]
    fn every_ported_rule_has_catalog_text() {
        for id in PORTED_RULE_IDS {
            let (short, _) = describe_rule(id);
            assert!(!short.is_empty() && short != *id, "{id}");
        }
    }

    #[test]
    fn ported_and_app_only_rule_lists_are_disjoint() {
        let ported: BTreeSet<&str> = PORTED_RULE_IDS.iter().copied().collect();
        assert_eq!(ported.len(), PORTED_RULE_IDS.len(), "duplicate ported id");
        for (id, reason) in APP_ONLY_RULES {
            assert!(!ported.contains(id), "{id}");
            assert!(!reason.is_empty());
        }
    }

    #[test]
    fn default_checks_follow_the_document_type() {
        let resume = "\\documentclass{deedy-resume}\n\\section{Experience}\n\\section{Education}";
        assert_eq!(
            suggested_checks(resume),
            [CheckId::Ats, CheckId::Compile].into_iter().collect()
        );
        let paper = suggested_checks("\\documentclass{article}");
        assert!(!paper.contains(&CheckId::Ats));
        assert_eq!(paper.len(), 5);
    }

    #[test]
    fn missing_main_document_still_checks_the_project() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("other.tex"), "\\documentclass{article}").unwrap();
        let snapshot =
            ProjectSnapshot::load(dir.path(), "main.tex", SnapshotLimits::default()).unwrap();
        let outcome = check_project(&CheckRequest {
            snapshot: &snapshot,
            source_profile: SourceProfile::Latex,
            engine: PreflightEngine::Bundled,
            submission_profile: None,
            anonymous_review: false,
            typst_version: None,
            compile: None,
            pdf_facts: None,
        });
        assert!(outcome
            .warnings
            .contains(&CheckWarning::MissingMainDocument {
                path: "main.tex".into()
            }));
        assert!(outcome
            .report
            .findings
            .iter()
            .any(|f| f.file.as_deref() == Some("other.tex")));
    }

    #[test]
    fn oversized_sources_become_warnings() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("main.tex"), "x").unwrap();
        std::fs::write(dir.path().join("big.tex"), vec![b'a'; 2_000_001]).unwrap();
        let snapshot =
            ProjectSnapshot::load(dir.path(), "main.tex", SnapshotLimits::default()).unwrap();
        let outcome = check_project(&CheckRequest {
            snapshot: &snapshot,
            source_profile: SourceProfile::Latex,
            engine: PreflightEngine::Unknown,
            submission_profile: Some(SubmissionProfileId::Generic),
            anonymous_review: false,
            typst_version: None,
            compile: None,
            pdf_facts: None,
        });
        assert!(outcome.warnings.contains(&CheckWarning::OversizedFile {
            path: "big.tex".into()
        }));
        assert!(!outcome.profile_detected);
    }
}
