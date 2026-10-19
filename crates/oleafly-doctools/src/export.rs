//! Exporting a project's main document with Pandoc (DOCX, HTML, EPUB, ...),
//! the same way for the app and the CLI.
use std::path::{Path, PathBuf};

use oleafly_core::Engine;

use crate::conversion::{
    export_args, export_renders_citations, fixup_typst_source, ExportCitations, ExportSource,
};
use crate::pandoc_citations::{export_failure, prepare_export_filter, ExportFilter};
use crate::{DocError, ToolRunner};

/// The Pandoc formats each engine exports (the app's
/// `EngineCapabilities::conversion_exports`).
pub fn export_formats(engine: Engine) -> &'static [&'static str] {
    match engine {
        Engine::Tectonic | Engine::Latexmk => {
            &["docx", "html", "md", "txt", "pptx", "epub", "typst"]
        }
        Engine::Typst => &["tex", "docx", "html", "md", "txt", "epub"],
        Engine::Markdown => &["docx", "html", "txt", "pptx", "epub", "typst", "tex"],
    }
}

/// One Pandoc export of a project's main document into `output`.
pub struct ExportJob<'a> {
    pub root: &'a Path,
    /// The project's build folder (the last compile's `.aux` numbering).
    pub build_dir: Option<PathBuf>,
    pub main_doc: &'a str,
    pub format: &'a str,
    pub output: &'a str,
    /// Where the citation filter is staged (the project's data area).
    pub staging_dir: Option<PathBuf>,
    /// The fallback folder for the filter; `None` is the system's.
    pub temp_dir: Option<&'a Path>,
}

/// The folders an export reads from, as the compile searches them: the main
/// document's folder first, then the project root. Returns Pandoc's
/// `--resource-path` (absolute folders, the platform's separator) and the
/// matching `TEXINPUTS` (relative to the project root, `:`-separated).
pub fn export_search_path(root: &Path, main_doc: &str) -> (String, String) {
    let root = oleafly_core::plain_path(root);
    let main_dir = root
        .join(main_doc)
        .parent()
        .map(Path::to_path_buf)
        .unwrap_or_else(|| root.clone());
    let mut dirs = vec![main_dir.clone()];
    if main_dir != root {
        dirs.push(root.clone());
    }
    let resource_path = std::env::join_paths(&dirs)
        .map(|joined| joined.to_string_lossy().into_owned())
        .unwrap_or_else(|_| ".".into());
    let relative = main_dir.strip_prefix(&root).ok().and_then(|relative| {
        relative
            .components()
            .map(|component| match component {
                std::path::Component::Normal(part) => part.to_str(),
                _ => None,
            })
            .collect::<Option<Vec<_>>>()
    });
    let texinputs = match relative {
        Some(parts) if !parts.is_empty() && parts.iter().all(|part| !part.contains(':')) => {
            format!("{}:.", parts.join("/"))
        }
        _ => ".".into(),
    };
    (resource_path, texinputs)
}

pub fn is_markdown_document(main_doc: &str) -> bool {
    Path::new(main_doc)
        .extension()
        .and_then(std::ffi::OsStr::to_str)
        .is_some_and(|extension| {
            extension.eq_ignore_ascii_case("md") || extension.eq_ignore_ascii_case("markdown")
        })
}

pub fn export_would_write_inside_project(project_root: &Path, destination: &str) -> bool {
    let Ok(project_root) = project_root.canonicalize() else {
        return false;
    };
    let destination = Path::new(destination);
    let canonical_destination = destination.canonicalize().ok().or_else(|| {
        destination.parent().and_then(|parent| {
            parent
                .canonicalize()
                .ok()
                .and_then(|parent| destination.file_name().map(|name| parent.join(name)))
        })
    });
    canonical_destination.is_some_and(|destination| destination.starts_with(&project_root))
}

pub fn require_export_destination_outside_project(
    project_root: &Path,
    destination: &str,
) -> Result<(), DocError> {
    if export_would_write_inside_project(project_root, destination) {
        return Err(DocError::new(
            "export.inside_project",
            "Choose an export destination outside this project.",
        ));
    }
    Ok(())
}

/// Pandoc's Typst output, repaired for the Typst compiler.
pub fn apply_typst_fixup(path: &Path) -> Result<(), DocError> {
    let source = std::fs::read_to_string(path)?;
    let fixed = fixup_typst_source(&source);
    if fixed != source {
        oleafly_core::atomic::write_atomic(path, fixed.as_bytes())?;
    }
    Ok(())
}

/// Runs Pandoc for one export.
pub async fn run_export_pandoc(
    runner: &dyn ToolRunner,
    pandoc: &Path,
    job: ExportJob<'_>,
) -> Result<(), DocError> {
    let (resource_path, texinputs) = export_search_path(job.root, job.main_doc);
    let source = ExportSource {
        file_name: job.main_doc.to_string(),
        resource_path,
    };
    let renders = export_renders_citations(job.format);
    // The staged filter must outlive the Pandoc process.
    let (filter, bibliographies): (Option<ExportFilter>, Vec<PathBuf>) = {
        let root = job.root.to_path_buf();
        let main_doc = job.main_doc.to_string();
        let build_dir = job.build_dir.clone();
        let staging_dir = job.staging_dir.clone();
        let format = job.format.to_string();
        let temp_dir = job
            .temp_dir
            .map_or_else(std::env::temp_dir, Path::to_path_buf);
        tokio::task::spawn_blocking(move || -> Result<_, DocError> {
            let filter = renders
                .then(|| {
                    prepare_export_filter(
                        &root,
                        &main_doc,
                        build_dir.as_deref(),
                        staging_dir.as_deref(),
                        &temp_dir,
                    )
                })
                .transpose()?;
            // The Markdown compile passes every project .bib; so does its
            // export. A .tex export names them from the project root.
            let bibliographies: Vec<PathBuf> = if is_markdown_document(&main_doc) {
                oleafly_core::engine_spec::discover_bibliographies(&root)
                    .map_err(|error| DocError::other(error.to_string()))?
                    .into_iter()
                    .map(|relative| {
                        if format == "tex" {
                            PathBuf::from(relative)
                        } else {
                            root.join(relative)
                        }
                    })
                    .collect()
            } else {
                Vec::new()
            };
            Ok((filter, bibliographies))
        })
        .await
        .map_err(|error| DocError::other(error.to_string()))??
    };
    let citations = ExportCitations {
        filter: filter.as_ref().map(ExportFilter::argument),
        bibliographies: &bibliographies,
    };
    let args = export_args(job.format, &source, job.output, Some(&citations)).ok_or_else(|| {
        DocError::new(
            "export.unsupported_format",
            format!("unsupported export format: {}", job.format),
        )
    })?;
    // Set even for a root main document, so an inherited TEXINPUTS does not
    // change what the export reads.
    let variables = vec![("TEXINPUTS".to_string(), texinputs)];
    let outcome = runner.run(pandoc, &args, job.root, &variables).await;
    drop(filter);
    let (log, code) = outcome.map_err(DocError::other)?;
    if code != Some(0) {
        return Err(export_failure(&log, job.root));
    }
    if job.format == "typst" {
        apply_typst_fixup(Path::new(job.output))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn search_paths_list_the_main_folder_first() {
        let root = Path::new("/p");
        let (resources, texinputs) = export_search_path(root, "paper/main.tex");
        assert!(resources.starts_with("/p/paper"));
        assert_eq!(texinputs, "paper:.");
        assert_eq!(export_search_path(root, "main.tex").1, ".");
    }

    #[test]
    fn exports_must_land_outside_the_project() {
        let project = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        let inside = project.path().join("paper.docx");
        assert_eq!(
            require_export_destination_outside_project(project.path(), inside.to_str().unwrap())
                .unwrap_err()
                .code,
            "export.inside_project"
        );
        assert!(require_export_destination_outside_project(
            project.path(),
            outside.path().join("paper.docx").to_str().unwrap()
        )
        .is_ok());
    }

    #[test]
    fn formats_follow_each_engine() {
        assert!(export_formats(Engine::Typst).contains(&"tex"));
        assert!(!export_formats(Engine::Typst).contains(&"pptx"));
        assert!(export_formats(Engine::Markdown).contains(&"pptx"));
    }
}
