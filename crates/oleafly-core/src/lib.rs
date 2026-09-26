mod build;
mod compile_log;
mod detect;
mod error;
mod image_check;
pub mod locking;
mod manifest;
mod tree;
mod utf8_stream;
mod workspace;

pub use build::PreparedBuild;
pub use compile_log::{
    parse_latex_log, LogCategory, LogDiagnostic, LogSeverity, MAX_COMPILE_LOG_BYTES,
};
pub use detect::{
    compile_dir_for, detect_main_document, tex_magic_comments, Candidate, Decision, DetectLimits,
    DetectOptions, Detection, DetectionSource, DocumentKind, Reason, SourceFamily,
    TexMagicComments, Tier, DETECT_DEADLINE, DETECT_MAX_DEPTH, DETECT_MAX_ENTRIES,
    DETECT_MAX_SOURCES,
};
pub use error::{Error, ErrorKind, Result};
pub use image_check::{
    diagnose_image_failures, image_failure_evidence, image_failure_notes, image_findings_lead,
    place_image_findings, BrokenImage, ImageContent, ImageEvidence, ImageFinding, ImageFormat,
    ImageProblem, ASK_AI_ERROR_BUDGET,
};
pub use manifest::{
    is_oleafly_manifest, sniff_oleafly_manifest, CheckpointCaptureMode, CheckpointPolicy, Engine,
    ExportRecord, ProjectManifest, TexSpec, MAX_MANIFEST_BYTES,
};
pub use tree::{
    is_cloud_placeholder, is_dataless_flags, is_generated_directory, is_placeholder_attributes,
    is_skipped_scan_directory, slash_path, walk_source_tree, GENERATED_DIRECTORIES,
    MAX_DISCOVERY_DEPTH,
};
pub use utf8_stream::{rejoin_split_utf8_lines, Utf8StreamDecoder};
pub use workspace::{
    BuildLocation, DoctorCheck, DoctorReport, DoctorStatus, InitOptions, ProjectInfo, Workspace,
};
