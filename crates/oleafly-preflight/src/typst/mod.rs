pub mod references;
pub mod refs_rules;
pub mod scan;
pub mod source_rules;
pub mod submission_rules;

use std::sync::LazyLock;

use crate::jsre::JsRegex;
use crate::types::ProjectContext;

pub use refs_rules::run_typst_refs_rules;
pub use scan::{resolve_typst_path, scan_typst, typst_version_at_least, Kind, TypstScan};
pub use source_rules::{run_typst_source_rules, typst_metadata_findings};
pub use submission_rules::{run_typst_submission_rules, typst_referenced_images};

pub const DEFAULT_TYPST_VERSION: &str = "0.15.1";
pub const LARGE_IMAGE_BYTES: u64 = 5 * 1024 * 1024;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TypstSourceFile {
    pub path: Option<String>,
    pub content: String,
}

static TYP_PATH: LazyLock<JsRegex> = LazyLock::new(|| JsRegex::std(r"(?i)\.typ$"));

pub fn typst_project_sources(
    project: Option<&ProjectContext>,
    fallback: &str,
) -> Vec<TypstSourceFile> {
    let Some(project) = project else {
        return vec![TypstSourceFile {
            path: None,
            content: fallback.to_string(),
        }];
    };
    let mut files: Vec<_> = project
        .files
        .iter()
        .filter(|file| file.content.is_some() && TYP_PATH.is_match(&file.path))
        .collect();
    files.sort_by_key(|file| file.path != project.main_file);
    let sources: Vec<TypstSourceFile> = files
        .into_iter()
        .map(|file| TypstSourceFile {
            path: Some(file.path.clone()),
            content: file.content.clone().unwrap_or_default(),
        })
        .collect();
    if sources.is_empty() {
        return vec![TypstSourceFile {
            path: Some(project.main_file.clone()),
            content: fallback.to_string(),
        }];
    }
    sources
}
