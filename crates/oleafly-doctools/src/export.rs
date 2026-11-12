use std::path::{Path, PathBuf};

use oleafly_core::Engine;

use crate::conversion::{
    apply_markdown_layout, export_args, export_reads_raw_frames, export_renders_citations,
    export_settles_source_images, export_uses_filter, fixup_typst_source, ExportCitations,
    ExportSource,
};
use crate::pandoc_citations::{
    declared_bibliographies, export_failure, prepare_export_filter, BibliographySource,
    ExportFilter,
};
use crate::typst_html::{add_source_media_args, stage_source_images_filter, SourceMedia};
use crate::{DocError, ToolRunner};

const RAW_FRAMES_READER: &str = "--from=latex+raw_tex";
const PROJECT_IMAGES_VARIABLE: &str = "OLEAFLY_EXPORT_PROJECT_IMAGES";
const PROJECT_FOLDER_VARIABLE: &str = "OLEAFLY_EXPORT_PROJECT_FOLDER";
const MAX_EXPORT_WARNINGS: usize = 50;
const MAX_WARNING_TEXT: usize = 160;
const IMAGE_MISSING_MARKER: &str = "[oleafly:image-missing]";
const IMAGE_UNCONVERTED_MARKER: &str = "[oleafly:image-unconverted]";
const REFERENCES_UNNUMBERED_MARKER: &str = "[oleafly:references-unnumbered]";
const BEAMER_TEXT_COMMANDS: [&str; 7] = [
    "only",
    "uncover",
    "visible",
    "invisible",
    "onslide",
    "alt",
    "structure",
];

pub fn export_formats(engine: Engine) -> &'static [&'static str] {
    match engine {
        Engine::Tectonic | Engine::Latexmk => {
            &["docx", "html", "md", "txt", "pptx", "epub", "typst"]
        }
        Engine::Typst => &["tex", "docx", "html", "md", "txt", "epub"],
        Engine::Markdown => &["docx", "html", "txt", "pptx", "epub", "typst", "tex"],
        Engine::Quarto | Engine::Calepin => &[],
    }
}

pub struct ExportJob<'a> {
    pub root: &'a Path,
    pub build_dir: Option<PathBuf>,
    pub main_doc: &'a str,
    pub format: &'a str,
    pub output: &'a str,
    pub staging_dir: Option<PathBuf>,
    pub temp_dir: Option<&'a Path>,
    pub typst: Option<PathBuf>,
}

pub struct ExportLog {
    folder: Option<tempfile::TempDir>,
}

impl ExportLog {
    pub fn create() -> Self {
        Self {
            folder: tempfile::Builder::new()
                .prefix("oleafly-export-log-")
                .tempdir()
                .ok(),
        }
    }

    fn file(&self) -> Option<PathBuf> {
        self.folder
            .as_ref()
            .map(|folder| folder.path().join("pandoc-log.json"))
    }

    pub fn argument(&self) -> Option<String> {
        self.file()
            .map(|file| format!("--log={}", file.to_string_lossy()))
    }

    pub fn warnings(&self, format: &str) -> Vec<DocError> {
        self.file()
            .and_then(|file| std::fs::read_to_string(file).ok())
            .map(|log| export_warnings(&log, format))
            .unwrap_or_default()
    }
}

fn short_text(text: &str) -> String {
    let flat = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if flat.chars().count() <= MAX_WARNING_TEXT {
        return flat;
    }
    let kept: String = flat.chars().take(MAX_WARNING_TEXT).collect();
    format!("{kept}…")
}

fn other_warning(text: &str) -> DocError {
    let text = short_text(text);
    DocError::new("export.warning_other", text.clone()).param("text", text)
}

fn missing_image_warning(name: &str) -> DocError {
    DocError::new(
        "export.warning_image_missing",
        format!("Couldn't find the image {name}, so it's missing from the export."),
    )
    .param("name", name)
}

fn unconverted_image_warning(name: &str) -> DocError {
    DocError::new(
        "export.warning_image_unconverted",
        format!("Couldn't convert the image {name}, so it may not show in this format."),
    )
    .param("name", name)
}

fn beamer_text_command(contents: &str) -> Option<&str> {
    if !contents.contains('{') {
        return None;
    }
    let command = contents.strip_prefix('\\')?.split(['{', '<', '[']).next()?;
    BEAMER_TEXT_COMMANDS.contains(&command).then_some(command)
}

fn skipped_block_name(contents: &str) -> Option<&str> {
    if let Some(command) = beamer_text_command(contents) {
        return Some(command);
    }
    if let Some(rest) = contents.strip_prefix("\\begin{") {
        let (name, _) = rest.split_once('}')?;
        let complete = contents.ends_with(&format!("\\end{{{name}}}"));
        return (complete && name != "comment").then_some(name);
    }
    if contents.starts_with("\\includepdf") {
        return Some("includepdf");
    }
    let shorthand = contents.strip_prefix("\\frame")?.trim_start();
    (shorthand.starts_with(['{', '[', '<']) && !shorthand.starts_with("{\\titlepage}"))
        .then_some("frame")
}

fn skipped_warning(contents: &str, source: &str, line: Option<u64>) -> Option<DocError> {
    let name = skipped_block_name(contents.trim())?;
    let warning = match line.filter(|_| !source.is_empty()) {
        Some(line) => {
            let place = format!("{source}:{line}");
            DocError::new(
                "export.warning_content_skipped_at",
                format!("This format can't show the {name} block at {place}, so it was left out."),
            )
            .param("place", place)
        }
        None => DocError::new(
            "export.warning_content_skipped",
            format!("This format can't show the {name} block, so it was left out."),
        ),
    };
    Some(warning.param("name", name))
}

fn citation_warning(message: &str) -> DocError {
    let key = message
        .strip_prefix("citation ")
        .and_then(|rest| rest.strip_suffix(" not found"));
    match key {
        Some(key) => DocError::new(
            "export.warning_citation_missing",
            format!("The citation {key} isn't in the bibliography."),
        )
        .param("name", key),
        None => other_warning(message),
    }
}

fn math_warning(formula: &str) -> DocError {
    let formula = short_text(formula);
    DocError::new(
        "export.warning_math_unconverted",
        format!("This math stayed as TeX: {formula}"),
    )
    .param("formula", formula)
}

fn filter_warning(message: &str) -> DocError {
    if let Some(name) = message.strip_prefix(IMAGE_MISSING_MARKER) {
        return missing_image_warning(name.trim());
    }
    if let Some(name) = message.strip_prefix(IMAGE_UNCONVERTED_MARKER) {
        return unconverted_image_warning(name.trim());
    }
    if message.starts_with(REFERENCES_UNNUMBERED_MARKER) {
        return DocError::new(
            "export.warning_references_unnumbered",
            "Some references have no number yet. Compile the document, then export again.",
        );
    }
    other_warning(message)
}

fn export_warning(entry: &serde_json::Value, format: &str) -> Option<DocError> {
    let text = |field: &str| entry[field].as_str().unwrap_or_default();
    match text("type") {
        "CouldNotFetchResource" => Some(missing_image_warning(text("path"))),
        "SkippedContent" => {
            skipped_warning(text("contents"), text("source"), entry["line"].as_u64())
        }
        "CiteprocWarning" => Some(citation_warning(text("message"))),
        "CouldNotConvertTeXMath" if format != "txt" => Some(math_warning(text("contents"))),
        "ScriptingWarning" => Some(filter_warning(text("message"))),
        "BlockNotRendered" if entry["contents"]["t"].as_str() != Some("RawBlock") => {
            Some(DocError::new(
                "export.warning_block_dropped",
                "Part of the document couldn't be written to this format, so it was left out.",
            ))
        }
        "CouldNotConvertTeXMath"
        | "CouldNotConvertImage"
        | "CouldNotHighlight"
        | "Deprecated"
        | "NoTitleElement" => None,
        _ if text("verbosity") == "WARNING" => Some(other_warning(text("pretty"))),
        _ => None,
    }
}

pub fn export_warnings(log: &str, format: &str) -> Vec<DocError> {
    let Ok(entries) = serde_json::from_str::<Vec<serde_json::Value>>(log) else {
        return Vec::new();
    };
    let mut warnings: Vec<DocError> = Vec::new();
    for warning in entries
        .iter()
        .filter_map(|entry| export_warning(entry, format))
    {
        if warnings.len() == MAX_EXPORT_WARNINGS {
            break;
        }
        if !warnings.contains(&warning) {
            warnings.push(warning);
        }
    }
    warnings
}

pub fn export_search_path(root: &Path, main_doc: &str) -> (String, String) {
    let root = oleafly_core::plain_path(root);
    let dirs = oleafly_core::document_search_folders(&root, Path::new(main_doc));
    let main_dir = dirs[0].clone();
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

pub fn apply_typst_fixup(path: &Path) -> Result<(), DocError> {
    let source = std::fs::read_to_string(path)?;
    let fixed = fixup_typst_source(&source);
    if fixed != source {
        oleafly_core::atomic::write_atomic(path, fixed.as_bytes())?;
    }
    Ok(())
}

fn declares_bibliography(root: &Path, main_doc: &str) -> bool {
    std::fs::read_to_string(root.join(main_doc))
        .is_ok_and(|text| !declared_bibliographies(BibliographySource::Markdown, &text).is_empty())
}

fn source_bibliography(relative: String, main_doc: &str) -> PathBuf {
    let path = PathBuf::from(relative);
    let main_folder = Path::new(main_doc).parent().unwrap_or(Path::new(""));
    path.strip_prefix(main_folder)
        .map(Path::to_path_buf)
        .unwrap_or(path)
}

pub async fn run_export_pandoc(
    runner: &dyn ToolRunner,
    pandoc: &Path,
    job: ExportJob<'_>,
) -> Result<Vec<DocError>, DocError> {
    run_export_with_media(runner, pandoc, job, None).await
}

pub async fn run_export_with_media(
    runner: &dyn ToolRunner,
    pandoc: &Path,
    job: ExportJob<'_>,
    media: Option<SourceMedia<'_>>,
) -> Result<Vec<DocError>, DocError> {
    let (resource_path, texinputs) = export_search_path(job.root, job.main_doc);
    let file_name = match &media {
        Some(_) => oleafly_core::plain_path(job.root)
            .join(job.main_doc)
            .to_string_lossy()
            .into_owned(),
        None => job.main_doc.to_string(),
    };
    let source = ExportSource {
        file_name,
        resource_path,
    };
    let renders = export_renders_citations(job.format);
    let staged = export_uses_filter(job.format, job.main_doc);
    let (filter, bibliographies, raw_frames, layout): (
        Option<ExportFilter>,
        Vec<PathBuf>,
        bool,
        oleafly_core::engine_spec::MarkdownLayout,
    ) = {
        let root = job.root.to_path_buf();
        let main_doc = job.main_doc.to_string();
        let build_dir = job.build_dir.clone();
        let staging_dir = job.staging_dir.clone();
        let format = job.format.to_string();
        let temp_dir = job
            .temp_dir
            .map_or_else(std::env::temp_dir, Path::to_path_buf);
        tokio::task::spawn_blocking(move || -> Result<_, DocError> {
            let filter = staged
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
            let discovers = !renders
                && is_markdown_document(&main_doc)
                && !declares_bibliography(&root, &main_doc);
            let bibliographies: Vec<PathBuf> = if discovers {
                oleafly_core::engine_spec::discover_bibliographies(&root)
                    .map_err(|error| DocError::other(error.to_string()))?
                    .into_iter()
                    .map(|relative| {
                        if matches!(format.as_str(), "tex" | "typst") {
                            source_bibliography(relative, &main_doc)
                        } else {
                            root.join(relative)
                        }
                    })
                    .collect()
            } else {
                Vec::new()
            };
            let raw_frames = std::fs::read_to_string(root.join(&main_doc))
                .is_ok_and(|text| export_reads_raw_frames(&format, &main_doc, &text));
            let layout = if is_markdown_document(&main_doc) {
                oleafly_core::engine_spec::markdown_layout(&root.join(&main_doc))
            } else {
                oleafly_core::engine_spec::MarkdownLayout::default()
            };
            Ok((filter, bibliographies, raw_frames, layout))
        })
        .await
        .map_err(|error| DocError::other(error.to_string()))??
    };
    let citations = ExportCitations {
        filter: filter.as_ref().map(ExportFilter::argument),
        bibliographies: &bibliographies,
    };
    let mut args =
        export_args(job.format, &source, job.output, Some(&citations)).ok_or_else(|| {
            DocError::new(
                "export.unsupported_format",
                format!("unsupported export format: {}", job.format),
            )
            .param("format", job.format)
        })?;
    apply_markdown_layout(
        &mut args,
        job.format,
        layout,
        filter.as_ref().map(ExportFilter::argument),
    );
    if raw_frames {
        args.insert(0, RAW_FRAMES_READER.to_string());
    }
    if let Some(filter) = filter
        .as_ref()
        .filter(|_| export_settles_source_images(job.format, job.main_doc))
    {
        args.insert(
            0,
            format!("--lua-filter={}", filter.argument().to_string_lossy()),
        );
    }
    let pandoc_log = ExportLog::create();
    if let Some(argument) = pandoc_log.argument() {
        args.insert(0, argument);
    }
    let mut variables = vec![
        ("TEXINPUTS".to_string(), texinputs),
        (PROJECT_IMAGES_VARIABLE.to_string(), "1".to_string()),
    ];
    if let Some(typst) = &job.typst {
        variables.push((
            oleafly_core::engine_spec::MARKDOWN_TYPST_VARIABLE.to_string(),
            oleafly_core::plain_path(typst)
                .to_string_lossy()
                .into_owned(),
        ));
    }
    if let Some(media) = &media {
        stage_source_images_filter(media.staging).map_err(DocError::other)?;
        add_source_media_args(&mut args, media.folder);
        variables.push((
            PROJECT_FOLDER_VARIABLE.to_string(),
            oleafly_core::plain_path(job.root)
                .to_string_lossy()
                .into_owned(),
        ));
    }
    let working_dir = media.as_ref().map_or(job.root, |media| media.staging);
    let outcome = runner.run(pandoc, &args, working_dir, &variables).await;
    drop(filter);
    let (log, code) = outcome.map_err(DocError::other)?;
    if code != Some(0) {
        return Err(export_failure(&log, job.root));
    }
    if job.format == "typst" {
        apply_typst_fixup(Path::new(job.output))?;
    }
    Ok(pandoc_log.warnings(job.format))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn search_paths_list_the_main_folder_first() {
        let root = Path::new("/p");
        let (resources, texinputs) = export_search_path(root, "paper/main.tex");
        // The platform's own list: `;` and backslashes on Windows.
        let expected = std::env::join_paths([root.join("paper"), root.to_path_buf()]).unwrap();
        assert_eq!(resources, expected.to_string_lossy());
        // Pandoc splits TEXINPUTS on ':' on every platform.
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
        assert!(export_formats(Engine::Quarto).is_empty());
        assert!(export_formats(Engine::Calepin).is_empty());
    }

    fn codes(warnings: &[DocError]) -> Vec<&'static str> {
        warnings.iter().map(|warning| warning.code).collect()
    }

    #[test]
    fn warnings_keep_real_losses_and_drop_routine_notes() {
        let log = serde_json::json!([
            {"type": "SkippedContent", "verbosity": "INFO", "contents": "\\centering", "source": "main.tex", "line": 3},
            {"type": "SkippedContent", "verbosity": "INFO", "contents": "\\begin{frame}", "source": "main.tex", "line": 4},
            {"type": "SkippedContent", "verbosity": "INFO", "contents": "\\begin{tikzpicture}\\draw (0,0);\\end{tikzpicture}", "source": "paper/main.tex", "line": 23},
            {"type": "SkippedContent", "verbosity": "INFO", "contents": "\\includepdf[pages=-]{a.pdf}", "source": "main.tex", "line": 30},
            {"type": "SkippedContent", "verbosity": "INFO", "contents": "\\frame{\\titlepage}", "source": "main.tex", "line": 31},
            {"type": "SkippedContent", "verbosity": "INFO", "contents": "\\frame{\\frametitle{A} text}", "source": "main.tex", "line": 32},
            {"type": "NoTitleElement", "verbosity": "WARNING", "fallback": "main", "pretty": "This document format requires a nonempty title"},
            {"type": "CouldNotConvertImage", "verbosity": "WARNING", "path": "a.svg", "message": "no rsvg", "pretty": "Could not convert image a.svg"},
            {"type": "LoadedResource", "verbosity": "INFO", "for": "a", "from": "b", "pretty": "Loaded"},
            {"type": "CiteprocWarning", "verbosity": "WARNING", "message": "citation csl1 not found"},
            {"type": "CouldNotFetchResource", "verbosity": "WARNING", "path": "figs/missing", "message": ""},
            {"type": "CouldNotFetchResource", "verbosity": "WARNING", "path": "figs/missing", "message": ""},
            {"type": "CouldNotConvertTeXMath", "verbosity": "WARNING", "contents": "\\begin{align}\n x\n\\end{align}", "message": ""},
            {"type": "ScriptingWarning", "verbosity": "WARNING", "message": "[oleafly:image-unconverted] figs/a.pdf"},
            {"type": "ScriptingWarning", "verbosity": "WARNING", "message": "[oleafly:image-missing] raster"},
            {"type": "ScriptingWarning", "verbosity": "WARNING", "message": "[oleafly:references-unnumbered]"},
            {"type": "SomethingNew", "verbosity": "WARNING", "pretty": "Something new\n  happened"}
        ])
        .to_string();
        let warnings = export_warnings(&log, "docx");
        assert_eq!(
            codes(&warnings),
            [
                "export.warning_content_skipped_at",
                "export.warning_content_skipped_at",
                "export.warning_content_skipped_at",
                "export.warning_citation_missing",
                "export.warning_image_missing",
                "export.warning_math_unconverted",
                "export.warning_image_unconverted",
                "export.warning_image_missing",
                "export.warning_references_unnumbered",
                "export.warning_other",
            ]
        );
        assert!(warnings[0]
            .params
            .contains(&("place", "paper/main.tex:23".to_string())));
        assert!(warnings[0]
            .params
            .contains(&("name", "tikzpicture".to_string())));
        assert!(warnings[3].params.contains(&("name", "csl1".to_string())));
        assert!(warnings[5]
            .params
            .contains(&("formula", "\\begin{align} x \\end{align}".to_string())));
        assert!(warnings[9]
            .params
            .contains(&("text", "Something new happened".to_string())));
    }

    #[test]
    fn beamer_commands_that_lose_text_are_reported() {
        let log = serde_json::json!([
            {"type": "SkippedContent", "verbosity": "INFO", "contents": "\\uncover{uncover text}", "source": "main.tex", "line": 81},
            {"type": "SkippedContent", "verbosity": "INFO", "contents": "\\only{only two}", "source": "main.tex", "line": 87},
            {"type": "SkippedContent", "verbosity": "INFO", "contents": "\\only<2>{only two}"},
            {"type": "SkippedContent", "verbosity": "INFO", "contents": "\\structure[1]{struct}"},
            {"type": "SkippedContent", "verbosity": "INFO", "contents": "\\centering"},
            {"type": "SkippedContent", "verbosity": "INFO", "contents": "\\pause "},
            {"type": "SkippedContent", "verbosity": "INFO", "contents": "\\onslide"},
            {"type": "SkippedContent", "verbosity": "INFO", "contents": "\\onlyone{text}"},
            {"type": "SkippedContent", "verbosity": "INFO", "contents": "\\note{speaker note text}"}
        ])
        .to_string();
        let warnings = export_warnings(&log, "pptx");
        assert_eq!(
            codes(&warnings),
            [
                "export.warning_content_skipped_at",
                "export.warning_content_skipped_at",
                "export.warning_content_skipped",
                "export.warning_content_skipped",
            ]
        );
        let names: Vec<&str> = warnings
            .iter()
            .flat_map(|warning| &warning.params)
            .filter(|(key, _)| *key == "name")
            .map(|(_, value)| value.as_str())
            .collect();
        assert_eq!(names, ["uncover", "only", "only", "structure"]);
        assert!(warnings[0]
            .params
            .contains(&("place", "main.tex:81".to_string())));
    }

    #[test]
    fn blocks_the_writer_refused_are_reported_unless_they_are_raw() {
        let log = serde_json::json!([
            {"type": "BlockNotRendered", "verbosity": "INFO", "contents": {"t": "RawBlock", "c": ["tex", "\\newpage"]}, "pretty": "Not rendering RawBlock"},
            {"type": "BlockNotRendered", "verbosity": "INFO", "contents": {"t": "Div", "c": [["", ["column"], []], []]}, "pretty": "Not rendering Div"},
            {"type": "BlockNotRendered", "verbosity": "INFO", "contents": {"t": "Div", "c": [["", ["column"], []], []]}, "pretty": "Not rendering Div"}
        ])
        .to_string();
        assert_eq!(
            codes(&export_warnings(&log, "pptx")),
            ["export.warning_block_dropped"]
        );
        let raw = r#"[{"type":"BlockNotRendered","verbosity":"INFO","contents":{"t":"RawBlock","c":["tex","\\newpage"]}}]"#;
        assert_eq!(codes(&export_warnings(raw, "docx")), [""; 0]);
    }

    #[test]
    fn plain_text_exports_do_not_warn_about_math_they_cannot_show() {
        let log = r#"[{"type":"CouldNotConvertTeXMath","verbosity":"WARNING","contents":"x"}]"#;
        assert_eq!(codes(&export_warnings(log, "txt")), [""; 0]);
    }

    #[test]
    fn long_informational_logs_do_not_hide_later_warnings() {
        let mut entries: Vec<serde_json::Value> = (0..500)
            .map(|line| {
                serde_json::json!({
                    "type": "SkippedContent",
                    "verbosity": "INFO",
                    "contents": "\\centering",
                    "source": "main.tex",
                    "line": line
                })
            })
            .collect();
        entries.push(serde_json::json!({
            "type": "SkippedContent",
            "verbosity": "INFO",
            "contents": "\\begin{tikzpicture}\\end{tikzpicture}"
        }));
        entries.push(serde_json::json!({
            "type": "CiteprocWarning",
            "verbosity": "WARNING",
            "message": "citation a not found"
        }));
        let log = serde_json::Value::from(entries).to_string();
        assert_eq!(
            codes(&export_warnings(&log, "html")),
            [
                "export.warning_content_skipped",
                "export.warning_citation_missing"
            ]
        );
    }

    #[test]
    fn warnings_stop_at_the_cap_after_duplicates_are_gone() {
        let entries: Vec<serde_json::Value> = (0..MAX_EXPORT_WARNINGS + 20)
            .flat_map(|index| {
                let entry = serde_json::json!({
                    "type": "CiteprocWarning",
                    "verbosity": "WARNING",
                    "message": format!("citation key{index} not found")
                });
                [entry.clone(), entry]
            })
            .collect();
        let log = serde_json::Value::from(entries).to_string();
        assert_eq!(export_warnings(&log, "docx").len(), MAX_EXPORT_WARNINGS);
    }

    #[test]
    fn an_unreadable_log_gives_no_warnings() {
        assert!(export_warnings("not json", "docx").is_empty());
        assert!(export_warnings("", "docx").is_empty());
        let log = ExportLog { folder: None };
        assert!(log.argument().is_none());
        assert!(log.warnings("docx").is_empty());
        assert!(ExportLog::create().warnings("docx").is_empty());
    }

    #[test]
    fn source_bibliographies_are_named_from_the_main_folder() {
        assert_eq!(
            source_bibliography("paper/refs.bib".into(), "paper/main.md"),
            Path::new("refs.bib")
        );
        assert_eq!(
            source_bibliography("paper/sources/refs.bib".into(), "paper/main.md"),
            Path::new("sources/refs.bib")
        );
        assert_eq!(
            source_bibliography("refs.bib".into(), "paper/main.md"),
            Path::new("refs.bib")
        );
        assert_eq!(
            source_bibliography("refs.bib".into(), "main.md"),
            Path::new("refs.bib")
        );
    }

    #[derive(Default)]
    struct RecordingRunner {
        args: std::sync::Mutex<Vec<String>>,
        variables: std::sync::Mutex<Vec<(String, String)>>,
        working_dir: std::sync::Mutex<PathBuf>,
    }

    impl ToolRunner for RecordingRunner {
        fn run<'a>(
            &'a self,
            _program: &'a Path,
            args: &'a [String],
            working_dir: &'a Path,
            variables: &'a [(String, String)],
        ) -> crate::RunFuture<'a> {
            Box::pin(async move {
                *self.args.lock().unwrap() = args.to_vec();
                *self.variables.lock().unwrap() = variables.to_vec();
                *self.working_dir.lock().unwrap() = working_dir.to_path_buf();
                if let Some(file) = args.iter().find_map(|arg| arg.strip_prefix("--log=")) {
                    std::fs::write(
                        file,
                        r#"[{"type":"CiteprocWarning","verbosity":"WARNING","message":"citation a not found"}]"#,
                    )
                    .unwrap();
                }
                Ok((String::new(), Some(0)))
            })
        }
    }

    fn job<'a>(
        root: &'a Path,
        main_doc: &'a str,
        format: &'a str,
        output: &'a str,
    ) -> ExportJob<'a> {
        ExportJob {
            root,
            build_dir: None,
            main_doc,
            format,
            output,
            staging_dir: None,
            temp_dir: Some(root),
            typst: None,
        }
    }

    #[tokio::test]
    async fn exports_return_the_warnings_pandoc_logged_and_keep_the_log_out_of_the_project() {
        let project = tempfile::tempdir().unwrap();
        let root = project.path();
        std::fs::write(root.join("main.tex"), "\\documentclass{article}\n").unwrap();
        let runner = RecordingRunner::default();
        let mut export = job(root, "main.tex", "docx", "out.docx");
        export.typst = Some(PathBuf::from("/app/typst"));
        let warnings = run_export_pandoc(&runner, Path::new("pandoc"), export)
            .await
            .unwrap();
        assert_eq!(codes(&warnings), ["export.warning_citation_missing"]);
        let args = runner.args.lock().unwrap().clone();
        assert!(args[0].starts_with("--log="), "{args:?}");
        assert!(runner.variables.lock().unwrap().contains(&(
            oleafly_core::engine_spec::MARKDOWN_TYPST_VARIABLE.to_string(),
            "/app/typst".to_string()
        )));
        let names: Vec<_> = std::fs::read_dir(root)
            .unwrap()
            .flatten()
            .map(|entry| entry.file_name())
            .collect();
        assert_eq!(names, ["main.tex"]);
    }

    #[tokio::test]
    async fn typst_source_exports_extract_media_outside_the_project() {
        let project = tempfile::tempdir().unwrap();
        let staging = tempfile::tempdir().unwrap();
        let root = project.path();
        std::fs::write(root.join("main.typ"), "= Title\n").unwrap();
        let runner = RecordingRunner::default();
        run_export_with_media(
            &runner,
            Path::new("pandoc"),
            job(root, "main.typ", "tex", "out.tex"),
            Some(SourceMedia {
                staging: staging.path(),
                folder: "paper-media",
            }),
        )
        .await
        .unwrap();
        assert_eq!(*runner.working_dir.lock().unwrap(), staging.path());
        assert!(staging
            .path()
            .join(crate::typst_html::SOURCE_IMAGES_FILTER_NAME)
            .is_file());
        let args = runner.args.lock().unwrap().clone();
        assert!(args.contains(&"--extract-media=paper-media".to_string()));
        assert!(args.contains(&"--lua-filter=typst-source-images.lua".to_string()));
        assert!(runner.variables.lock().unwrap().contains(&(
            PROJECT_FOLDER_VARIABLE.to_string(),
            oleafly_core::plain_path(root)
                .to_string_lossy()
                .into_owned()
        )));
        let main_doc = oleafly_core::plain_path(root).join("main.typ");
        assert_eq!(
            args.last().map(String::as_str),
            main_doc.to_str(),
            "{args:?}"
        );

        let plain = RecordingRunner::default();
        run_export_pandoc(
            &plain,
            Path::new("pandoc"),
            job(root, "main.typ", "tex", "out.tex"),
        )
        .await
        .unwrap();
        assert_eq!(*plain.working_dir.lock().unwrap(), root);
        let args = plain.args.lock().unwrap().clone();
        assert!(!args.iter().any(|arg| arg.starts_with("--extract-media")));
        assert_eq!(args.last().map(String::as_str), Some("main.typ"));
    }

    #[tokio::test]
    async fn source_formats_from_latex_run_the_filter_without_citeproc() {
        let project = tempfile::tempdir().unwrap();
        let root = project.path();
        std::fs::write(root.join("main.tex"), "\\documentclass{article}\n").unwrap();
        for format in ["md", "typst"] {
            let runner = RecordingRunner::default();
            let staged = root.join("out.typ");
            std::fs::write(&staged, "").unwrap();
            let output = staged.to_string_lossy().into_owned();
            run_export_pandoc(
                &runner,
                Path::new("pandoc"),
                job(root, "main.tex", format, &output),
            )
            .await
            .unwrap();
            let args = runner.args.lock().unwrap().clone();
            assert!(
                args.iter().any(|arg| arg.starts_with("--lua-filter=")),
                "{args:?}"
            );
            assert!(!args.iter().any(|arg| arg == "--citeproc"), "{args:?}");
        }
    }

    #[tokio::test]
    async fn only_decks_using_the_frame_shorthand_read_raw_latex() {
        let project = tempfile::tempdir().unwrap();
        let root = project.path();
        std::fs::write(
            root.join("short.tex"),
            "\\documentclass{beamer}\n\\begin{document}\n\\frame{\\frametitle{A} body}\n\\end{document}\n",
        )
        .unwrap();
        std::fs::write(
            root.join("long.tex"),
            "\\documentclass{beamer}\n\\begin{document}\n\\frame{\\titlepage}\n\\begin{frame}{A}\nbody\n\\end{frame}\n\\end{document}\n",
        )
        .unwrap();
        for (main, format, raw) in [
            ("short.tex", "pptx", true),
            ("short.tex", "docx", false),
            ("long.tex", "pptx", false),
        ] {
            let runner = RecordingRunner::default();
            run_export_pandoc(&runner, Path::new("pandoc"), job(root, main, format, "out"))
                .await
                .unwrap();
            let args = runner.args.lock().unwrap().clone();
            assert_eq!(
                args.iter().any(|arg| arg == RAW_FRAMES_READER),
                raw,
                "{main} {format}"
            );
        }
    }

    #[tokio::test]
    async fn markdown_exports_follow_the_document_kind() {
        let project = tempfile::tempdir().unwrap();
        let root = project.path();
        std::fs::write(
            root.join("talk.md"),
            "---\ntype: slides\nslide-level: 1\n---\n# A\n",
        )
        .unwrap();
        std::fs::write(root.join("letter.md"), "---\ntype: letter\n---\nHello\n").unwrap();
        std::fs::write(root.join("paper.md"), "# Paper\n").unwrap();
        let exported = |main: &'static str, format: &'static str| {
            let root = root.to_path_buf();
            async move {
                let runner = RecordingRunner::default();
                let output = root.join("out").to_string_lossy().into_owned();
                run_export_pandoc(
                    &runner,
                    Path::new("pandoc"),
                    job(&root, main, format, &output),
                )
                .await
                .unwrap();
                let args = runner.args.lock().unwrap().clone();
                args
            }
        };
        let talk = exported("talk.md", "tex").await;
        assert!(talk.iter().any(|arg| arg == "--to=beamer"), "{talk:?}");
        assert!(!talk.iter().any(|arg| arg == "--to=latex"), "{talk:?}");
        assert!(talk.iter().any(|arg| arg == "--slide-level=1"), "{talk:?}");
        assert!(talk
            .iter()
            .any(|arg| arg == "--metadata=oleafly-document-kind=slides"));
        let kind_filter = talk
            .iter()
            .filter_map(|arg| arg.strip_prefix("--lua-filter="))
            .find(|path| path.ends_with("oleafly-document-kind.lua"));
        assert!(kind_filter.is_some(), "{talk:?}");
        let separator = talk.iter().rposition(|arg| arg == "--").unwrap();
        assert!(
            talk.iter()
                .position(|arg| arg == "--slide-level=1")
                .unwrap()
                < separator
        );
        let letter = exported("letter.md", "tex").await;
        assert!(letter.iter().any(|arg| arg == "--to=latex"), "{letter:?}");
        assert!(letter
            .iter()
            .any(|arg| arg == "--metadata=oleafly-document-kind=letter"));
        let pptx = exported("talk.md", "pptx").await;
        let level = pptx.iter().position(|arg| arg == "--slide-level").unwrap();
        assert_eq!(pptx[level + 1], "1");
        let paper = exported("paper.md", "tex").await;
        assert!(
            !paper
                .iter()
                .any(|arg| arg.contains("oleafly-document-kind")),
            "{paper:?}"
        );
        assert!(paper.iter().any(|arg| arg == "--to=latex"));
        let docx = exported("talk.md", "docx").await;
        assert!(
            !docx.iter().any(|arg| arg.contains("oleafly-document-kind")),
            "{docx:?}"
        );
    }

    #[tokio::test]
    async fn an_unknown_format_names_itself_in_a_coded_error() {
        let project = tempfile::tempdir().unwrap();
        let runner = RecordingRunner::default();
        let error = run_export_pandoc(
            &runner,
            Path::new("pandoc"),
            job(project.path(), "main.tex", "odt", "out"),
        )
        .await
        .unwrap_err();
        assert_eq!(error.code, "export.unsupported_format");
        assert_eq!(error.params, [("format", "odt".to_string())]);
    }
}
