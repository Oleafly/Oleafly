mod build;
mod compile_log;
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
pub use error::{Error, ErrorKind, Result};
pub use image_check::{
    diagnose_image_failures, image_failure_evidence, image_failure_notes, image_findings_lead,
    place_image_findings, BrokenImage, ImageContent, ImageEvidence, ImageFinding, ImageFormat,
    ImageProblem, ASK_AI_ERROR_BUDGET,
};
pub use manifest::{
    CheckpointCaptureMode, CheckpointPolicy, Engine, ExportRecord, ProjectManifest, TexSpec,
};
pub use tree::{
    is_generated_directory, slash_path, walk_source_tree, GENERATED_DIRECTORIES,
    MAX_DISCOVERY_DEPTH,
};
pub use utf8_stream::{rejoin_split_utf8_lines, Utf8StreamDecoder};
pub use workspace::{DoctorCheck, DoctorReport, DoctorStatus, InitOptions, ProjectInfo, Workspace};
