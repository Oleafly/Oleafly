pub mod bib;
pub mod check;
pub mod collate;
pub mod compile_rules;
pub mod contact;
pub mod context;
pub mod doc_type;
pub mod document_metadata;
pub mod engine;
pub mod index;
pub mod jsre;
pub mod latex;
pub mod mask;
pub mod messages;
#[cfg(feature = "pdf")]
pub mod pdf;
pub mod profiles;
pub mod refs_rules;
pub mod resume;
pub mod score;
pub mod snapshot;
pub mod source_rules;
pub mod standards;
pub mod submission_rules;
pub mod text;
pub mod types;
pub mod typst;

pub use check::{
    check_project, suggested_checks, visible, CheckOutcome, CheckRequest, CheckWarning,
    APP_ONLY_RULES, PORTED_RULE_IDS,
};
pub use compile_rules::infer_compile_status;
pub use engine::{run_preflight, PreflightInput, SourceProfile};
pub use messages::{
    describe_rule, describe_template, message, render_detail, Catalog, MessageRef, ParamValue,
    Params,
};
#[cfg(feature = "pdf")]
pub use pdf::{read_pdf_facts, PdfFactsError, MAX_PDF_BYTES};
pub use profiles::{detect_submission_profile, submission_profile, SubmissionProfileId};
pub use refs_rules::RefsContext;
pub use snapshot::{ProjectSnapshot, SnapshotIssue, SnapshotLimits};
pub use text::{normalize_line_endings, Position, SourceText};
pub use types::{
    Certainty, CheckId, CompileContext, CompileStatus, Coverage, Finding, FindingMethod, Lens,
    PdfFacts, PreflightEngine, PreflightReport, ProjectContext, ProjectFile, Severity, CHECK_IDS,
};
