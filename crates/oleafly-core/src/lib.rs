pub mod atomic;
pub mod biber_env;
pub mod bibkey;
mod bounded_read;
mod build;
pub mod build_output;
mod compile_log;
pub mod content;
pub mod context;
mod detect;
pub mod engine_spec;
mod engine_temp;
mod error;
pub mod exclude;
pub mod hlc;
pub mod ids;
mod image_check;
mod latexmk_env;
pub mod linked_capture;
pub mod locking;
mod manifest;
pub mod pandoc;
pub mod portable;
pub mod process_probe;
pub mod sidecar;
pub mod templates;
pub mod tex_distro;
pub mod tex_errors;
mod tex_flavor;
mod tree;
pub mod typst_forms;
pub mod typst_log;
pub mod typst_toolchain;
mod utf8_stream;
mod workspace;

pub use bounded_read::{read_bounded, BoundedRead};
pub use build::PreparedBuild;
pub use compile_log::{
    parse_latex_log, LogCategory, LogDiagnostic, LogSeverity, MAX_COMPILE_LOG_BYTES,
};
pub use detect::{
    compile_dir_for, detect_main_document, tex_magic_comments, typst_uses_calepin, Candidate,
    Decision, DetectLimits, DetectOptions, Detection, DetectionSource, DocumentKind, Reason,
    SourceFamily, TexMagicComments, Tier, DETECT_DEADLINE, DETECT_MAX_DEPTH, DETECT_MAX_ENTRIES,
    DETECT_MAX_SOURCES,
};
#[cfg(windows)]
pub use engine_temp::long_path_name;
pub use engine_temp::{
    plain_path, short_path_name, tex_safe_path, EngineScratch, EngineScratchBases,
    PandocResourcePath, ENGINE_TEMP_DIR, PANDOC_RESOURCE_PATH_VARIABLE, TEMP_DIRECTORY_VARIABLES,
};
pub use error::{Error, ErrorKind, Result};
pub use image_check::{
    diagnose_image_failures, image_failure_evidence, image_failure_notes, image_findings_lead,
    place_image_findings, BrokenImage, ImageContent, ImageEvidence, ImageFinding, ImageFormat,
    ImageProblem, ASK_AI_ERROR_BUDGET,
};
pub use latexmk_env::{
    bibtex_search_entry, bibtex_search_environment, breaks_tex_search_path, BIBTEX_SEARCH_VARIABLES,
};
pub use manifest::valid_typst_input_key;
pub use manifest::{
    is_oleafly_manifest, sniff_oleafly_manifest, CheckpointCaptureMode, CheckpointPolicy, Engine,
    ExportRecord, ProjectManifest, TexSpec, TypstSpec, TypstVariant, MAX_MANIFEST_BYTES,
};
pub use tex_flavor::{source_tex_flavor, TexFlavor};
pub use tree::{
    is_cloud_placeholder, is_dataless_flags, is_generated_directory, is_placeholder_attributes,
    is_skipped_scan_directory, slash_path, walk_source_tree, GENERATED_DIRECTORIES,
    MAX_DISCOVERY_DEPTH,
};
pub use utf8_stream::{rejoin_split_utf8_lines, Utf8StreamDecoder};
pub use workspace::{
    resolve_project_path, BuildLocation, DoctorCheck, DoctorReport, DoctorStatus, InitOptions,
    ProjectInfo, Workspace,
};
