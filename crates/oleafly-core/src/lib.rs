mod build;
mod compile_log;
mod error;
mod manifest;
mod tree;
mod workspace;

pub use build::PreparedBuild;
pub use compile_log::{
    parse_latex_log, LogCategory, LogDiagnostic, LogSeverity, MAX_COMPILE_LOG_BYTES,
};
pub use error::{Error, ErrorKind, Result};
pub use manifest::{
    CheckpointCaptureMode, CheckpointPolicy, Engine, ExportRecord, ProjectManifest, TexSpec,
};
pub use tree::{
    is_generated_directory, slash_path, walk_source_tree, GENERATED_DIRECTORIES,
    MAX_DISCOVERY_DEPTH,
};
pub use workspace::{DoctorCheck, DoctorReport, DoctorStatus, InitOptions, ProjectInfo, Workspace};
