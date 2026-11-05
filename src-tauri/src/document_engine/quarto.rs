use std::path::{Path, PathBuf};

use super::{
    CompileError, CompileOptions, CompileTarget, CompilerPrerequisite, ConversionExport,
    DocumentEngine, DocumentEngineId, EngineArtifacts, EngineCapabilities, EngineCompileSpec,
    EngineEnvironment, EngineExecutable, EngineFeature, EngineInput, FormattingProfile,
    SourcePreflightProfile, TemplateKind,
};
use crate::app_error::AppError;
use crate::notebook_toolchain::NotebookTool;

mod code_off;
mod siblings;

pub(crate) use siblings::SiblingHold;

pub(super) struct QuartoEngine;
pub(super) static QUARTO_ENGINE: QuartoEngine = QuartoEngine;

pub(crate) const CODE_SKIPPED_CODE: &str = "notebook.code_skipped";
pub(super) const SETUP_CODES: [&str; 8] = [
    "notebook.quarto_needs_tex",
    "notebook.r_package_missing",
    "notebook.r_missing",
    "notebook.python_missing",
    JUPYTER_COMMAND_CODE,
    "notebook.chrome_missing",
    "notebook.quarto_no_input",
    "notebook.not_project_input",
];
const JUPYTER_CODE: &str = "notebook.jupyter_missing";
const JUPYTER_COMMAND_CODE: &str = "notebook.jupyter_missing_command";
const JUPYTER_HINT: &str = "This document's Python code needs Jupyter to run. Install it with {{command}}, then compile again. Or turn code off in the Compile menu to show the code without running it.";
const MISSING_GLYPHS_CODE: &str = "notebook.missing_glyphs";
const MISSING_GLYPHS_CJK_CODE: &str = "notebook.missing_glyphs_cjk";
const MISSING_GLYPH_SAMPLE: usize = 8;
const KOREAN_FONT: &str = "UnBatang.ttf";
const CHINESE_FONT: &str = "FandolSong-Regular.otf";
const JULIA_NOT_RUN_CODE: &str = "notebook.julia_not_run";
const OUTPUT_DIR_REFUSAL: &str = "--output-dir flag can only be used when rendering projects";
const EMBED_RESOURCES: &str = "embed-resources:true";
const SOURCE_LIMIT: u64 = 4 * 1024 * 1024;
const YAML_LIMIT: u64 = 256 * 1024;
const PROJECT_FILES: [&str; 4] = [
    "_metadata.yml",
    "_metadata.yaml",
    "_quarto.yml",
    "_quarto.yaml",
];
const EXTENSIONS_DIRECTORY: &str = "_extensions";
const FREEZE_DIRECTORY: &str = "_freeze";
const DIAGRAM_CELLS: [&str; 2] = ["mermaid", "dot"];
const MAX_ERRORS: usize = 200;

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct QuartoTarget {
    pub(crate) format: String,
    pub(crate) html: bool,
}

impl QuartoTarget {
    fn html_default() -> Self {
        Self {
            format: "html".to_owned(),
            html: true,
        }
    }

    pub(crate) fn extension(&self) -> &'static str {
        if self.html {
            "html"
        } else {
            "pdf"
        }
    }
}

impl DocumentEngine for QuartoEngine {
    fn id(&self) -> DocumentEngineId {
        DocumentEngineId::Quarto
    }

    fn capabilities(&self) -> EngineCapabilities {
        EngineCapabilities {
            produces_pdf: true,
            supports_synctex: false,
            supports_offline: false,
            supports_isolated_compile: false,
            formatting_profile: FormattingProfile::Markdown,
            source_preflight_profile: SourcePreflightProfile::None,
            features: &[EngineFeature::Citations, EngineFeature::DocumentIndex],
            conversion_exports: &[ConversionExport::Docx, ConversionExport::Html],
            template_kinds: &[TemplateKind::Document],
            compiler_prerequisite: Some(CompilerPrerequisite::Quarto),
        }
    }

    fn accepts_metadata_name(&self, name: &str) -> bool {
        matches!(name.trim().to_ascii_lowercase().as_str(), "quarto" | "qmd")
    }

    fn source_extensions(&self) -> &'static [&'static str] {
        &["qmd", "rmd"]
    }

    fn accepts_main_document(&self, main_document: &str) -> bool {
        Path::new(main_document)
            .extension()
            .is_some_and(|extension| {
                self.source_extensions()
                    .iter()
                    .any(|known| extension.eq_ignore_ascii_case(known))
            })
    }

    fn artifacts(&self, out_dir: &Path, _target: CompileTarget<'_>) -> EngineArtifacts {
        EngineArtifacts {
            output_dir: out_dir.to_owned(),
            pdf: Some(out_dir.join(format!("{}.pdf", crate::paths::ENTRY_STEM))),
            log: None,
            synctex: None,
            html: None,
        }
    }

    fn compile_spec(
        &self,
        out_dir: &Path,
        project_dir: &Path,
        target: CompileTarget<'_>,
        options: CompileOptions,
    ) -> Result<EngineCompileSpec, String> {
        let CompileTarget::Main { main_document } = target else {
            return Err("Quarto does not support isolated compilation".into());
        };
        let input = project_dir.join(main_document);
        let quarto = usable_quarto(project_dir, &input)?;
        let source = read_bounded(&input, SOURCE_LIMIT).unwrap_or_default();
        let yaml = project_yaml(project_dir, &input);
        let output = quarto_target(&source, &yaml);
        let mut artifacts = self.artifacts(out_dir, target);
        if output.html {
            artifacts.pdf = None;
            artifacts.html = Some(html_artifact(out_dir, &input));
        }
        let format = output.format.clone();
        let plan = QuartoRun {
            quarto,
            input,
            out_dir: out_dir.to_owned(),
            project_dir: project_dir.to_owned(),
            output,
            extension: None,
            allow_code: options.allow_shell_escape,
        };
        let mut spec = plan.spec(artifacts, options.source_date_epoch)?;
        siblings::refuse_overwrite(project_dir, &plan.input, out_dir, &format, &source, &yaml)?;
        if siblings::keeps_aux_files(&format, &source, &yaml) {
            spec.args
                .extend(["-M".to_owned(), siblings::KEEP_AUX_METADATA.to_owned()]);
        }
        Ok(spec)
    }

    fn parse_errors(&self, log: &str) -> Vec<CompileError> {
        parse_quarto_log(log)
    }

    fn compile_notes(
        &self,
        spec: &EngineCompileSpec,
        options: &CompileOptions,
        log: &str,
    ) -> Vec<CompileError> {
        let source = read_bounded(spec.input.path(), SOURCE_LIMIT).unwrap_or_default();
        let mut notes: Vec<CompileError> = tex_log_glyph_warning(spec).into_iter().collect();
        notes.extend(julia_note(&source, options, log).filter(|_| !frozen(spec.input.path())));
        if !options.allow_shell_escape
            && spec.args.iter().any(|arg| arg == "--no-execute")
            && has_executable_cells(&source)
        {
            notes.push(CompileError {
                message:
                    "Code chunks were shown but not run, because code is off for this project."
                        .into(),
                kind: "warning".into(),
                code: Some(CODE_SKIPPED_CODE.into()),
                ..CompileError::default()
            });
        }
        notes
    }
}

fn flag_value<'a>(args: &'a [String], flag: &str) -> Option<&'a str> {
    args.windows(2)
        .find(|pair| pair[0] == flag)
        .map(|pair| pair[1].as_str())
}

fn format_argument(args: &[String]) -> Option<&str> {
    flag_value(args, "--to")
}

pub(super) fn document_render_spec(
    spec: &EngineCompileSpec,
    log: &str,
    exit_code: Option<i32>,
) -> Option<EngineCompileSpec> {
    let refused = exit_code != Some(0) && log.contains(OUTPUT_DIR_REFUSAL);
    let flag = spec.args.iter().position(|arg| arg == "--output-dir")?;
    if !refused {
        return None;
    }
    let mut fallback = spec.clone();
    fallback.args.drain(flag..=flag + 1);
    if spec.artifacts.html.is_some() && !spec.args.iter().any(|arg| arg == EMBED_RESOURCES) {
        fallback
            .args
            .extend(["-M".to_owned(), EMBED_RESOURCES.to_owned()]);
    }
    fallback.working_dir = placement(spec.input.path()).document;
    Some(fallback)
}

pub(super) fn collect_document_render(spec: &EngineCompileSpec) -> std::io::Result<()> {
    let Some(name) = flag_value(&spec.args, "--output") else {
        return Ok(());
    };
    let rendered = placement(spec.input.path()).document.join(name);
    if !rendered.is_file() {
        return Ok(());
    }
    let target = spec
        .artifacts
        .html
        .clone()
        .or_else(|| spec.artifacts.pdf.clone())
        .unwrap_or_else(|| spec.artifacts.output_dir.join(name));
    if let Some(folder) = target.parent() {
        std::fs::create_dir_all(folder)?;
    }
    let _ = std::fs::remove_file(&target);
    if std::fs::rename(&rendered, &target).is_err() {
        std::fs::copy(&rendered, &target)?;
        std::fs::remove_file(&rendered)?;
    }
    Ok(())
}

pub(super) fn hold_siblings(spec: &EngineCompileSpec) -> Result<Option<SiblingHold>, String> {
    let Some(format) = format_argument(&spec.args) else {
        return Ok(None);
    };
    let remove_aux = spec
        .args
        .iter()
        .any(|arg| arg == siblings::KEEP_AUX_METADATA);
    let input = spec.input.path();
    let source = read_bounded(input, SOURCE_LIMIT).unwrap_or_default();
    let yaml = project_yaml(
        spec.environment.path_excluded_root(&spec.working_dir),
        input,
    );
    siblings::hold(
        input,
        format,
        &spec.artifacts.output_dir,
        remove_aux,
        &source,
        &yaml,
    )
}

fn usable_quarto(project_dir: &Path, input: &Path) -> Result<PathBuf, String> {
    let quarto = crate::notebook_toolchain::find_tool(NotebookTool::Quarto)
        .ok_or_else(|| String::from(AppError::new(NotebookTool::Quarto.missing_code())))?;
    if let Some((version, minimum)) =
        crate::notebook_toolchain::outdated_version(NotebookTool::Quarto, &quarto)
    {
        if !in_quarto_project(project_dir, input) {
            return Err(AppError::new("notebook.quarto_outdated")
                .param("version", version)
                .param("minimum", minimum)
                .into());
        }
    }
    Ok(quarto)
}

fn in_quarto_project(project_dir: &Path, input: &Path) -> bool {
    project_directories(project_dir, input)
        .iter()
        .any(|directory| {
            ["_quarto.yml", "_quarto.yaml"]
                .iter()
                .any(|name| directory.join(name).is_file())
        })
}

struct Placement {
    document: PathBuf,
    root: PathBuf,
    nested: PathBuf,
}

fn real_folder(path: &Path, windows: bool) -> PathBuf {
    if windows {
        return oleafly_core::plain_path(path).components().collect();
    }
    path.ancestors()
        .find_map(|ancestor| {
            let real = ancestor.canonicalize().ok()?;
            Some(real.join(path.strip_prefix(ancestor).ok()?))
        })
        .unwrap_or_else(|| path.to_path_buf())
}

fn placement(input: &Path) -> Placement {
    let document = real_folder(input.parent().unwrap_or(input), cfg!(windows));
    let root = code_off::quarto_project_dir(&document);
    let nested = root
        .as_deref()
        .and_then(|root| document.strip_prefix(root).ok())
        .map(Path::to_path_buf)
        .unwrap_or_default();
    Placement {
        root: root.unwrap_or_else(|| document.clone()),
        document,
        nested,
    }
}

pub(crate) fn html_artifact(out_dir: &Path, input: &Path) -> PathBuf {
    out_dir
        .join(placement(input).nested)
        .join(format!("{}.html", crate::paths::ENTRY_STEM))
}

fn missing_characters(tex_log: &str) -> Vec<char> {
    let mut found = Vec::new();
    for line in tex_log.lines() {
        let Some(rest) = line
            .trim_start()
            .strip_prefix("Missing character: There is no ")
        else {
            continue;
        };
        if rest.starts_with("^^") || line.contains("in font nullfont") {
            continue;
        }
        if let Some(character) = rest.chars().next().filter(|next| !found.contains(next)) {
            found.push(character);
        }
    }
    found
}

fn hangul(character: char) -> bool {
    matches!(
        character,
        '\u{1100}'..='\u{11ff}' | '\u{3130}'..='\u{318f}' | '\u{a960}'..='\u{a97f}' | '\u{ac00}'..='\u{d7ff}'
    )
}

fn han_or_kana(character: char) -> bool {
    matches!(
        character,
        '\u{3040}'..='\u{30ff}'
            | '\u{3400}'..='\u{4dbf}'
            | '\u{4e00}'..='\u{9fff}'
            | '\u{f900}'..='\u{faff}'
            | '\u{20000}'..='\u{3134f}'
    )
}

fn suggested_cjk_font(characters: &[char]) -> Option<&'static str> {
    if characters.iter().copied().any(hangul) {
        Some(KOREAN_FONT)
    } else if characters.iter().copied().any(han_or_kana) {
        Some(CHINESE_FONT)
    } else {
        None
    }
}

fn missing_glyph_warning(characters: &[char]) -> CompileError {
    let sample = characters
        .iter()
        .take(MISSING_GLYPH_SAMPLE)
        .map(char::to_string)
        .collect::<Vec<_>>()
        .join(" ");
    let mut params = std::collections::BTreeMap::from([
        ("count".to_owned(), characters.len().to_string()),
        ("sample".to_owned(), sample.clone()),
    ]);
    let font = suggested_cjk_font(characters);
    if let Some(font) = font {
        params.insert("font".to_owned(), font.to_owned());
    }
    CompileError {
        message: format!("Characters are missing from the PDF: {sample}"),
        kind: "warning".into(),
        code: Some(
            font.map_or(MISSING_GLYPHS_CODE, |_| MISSING_GLYPHS_CJK_CODE)
                .to_owned(),
        ),
        params,
        ..CompileError::default()
    }
}

fn tex_log_glyph_warning(spec: &EngineCompileSpec) -> Option<CompileError> {
    let format = format_argument(&spec.args)?;
    let log = siblings::plan(spec.input.path(), format)?.tex_log()?;
    let text = super::read_log_bounded(&log).ok()?;
    let characters = missing_characters(&text);
    (!characters.is_empty()).then(|| missing_glyph_warning(&characters))
}

fn julia_ran(line: &str) -> bool {
    let line = strip_ansi(line);
    let line = line.trim();
    line.contains("Starting julia")
        || line.starts_with("Running [")
        || line.starts_with("Executing '")
}

fn frozen(input: &Path) -> bool {
    let place = placement(input);
    input.file_stem().is_some_and(|stem| {
        place
            .root
            .join(FREEZE_DIRECTORY)
            .join(&place.nested)
            .join(stem)
            .is_dir()
    })
}

fn julia_note(source: &str, options: &CompileOptions, log: &str) -> Option<CompileError> {
    let has_julia = source
        .lines()
        .filter_map(chunk_opener)
        .any(|inner| inner.to_ascii_lowercase().starts_with("julia"));
    (options.allow_shell_escape && has_julia && !log.lines().any(julia_ran)).then(|| CompileError {
        message: "The Julia code in this document did not run.".into(),
        kind: "warning".into(),
        code: Some(JULIA_NOT_RUN_CODE.into()),
        ..CompileError::default()
    })
}

pub(super) struct QuartoRun {
    pub(super) quarto: PathBuf,
    pub(super) input: PathBuf,
    pub(super) out_dir: PathBuf,
    pub(super) project_dir: PathBuf,
    pub(super) output: QuartoTarget,
    pub(super) extension: Option<&'static str>,
    pub(super) allow_code: bool,
}

impl QuartoRun {
    pub(super) fn spec(
        &self,
        artifacts: EngineArtifacts,
        source_date_epoch: Option<u64>,
    ) -> Result<EngineCompileSpec, String> {
        reject_project_local(&self.quarto, &self.project_dir)?;
        if !self.allow_code && code_off::code_needed(&self.project_dir, &self.input) {
            return Err(AppError::new("notebook.code_needed")
                .param("engine", NotebookTool::Quarto.label())
                .into());
        }
        let extension = self.extension.unwrap_or(self.output.extension());
        let place = placement(&self.input);
        let input = self
            .input
            .file_name()
            .map_or_else(|| self.input.clone(), |name| place.document.join(name));
        let mut args = quarto_args(
            &input,
            &self.output.format,
            &format!("{}.{extension}", crate::paths::ENTRY_STEM),
            &real_folder(&self.out_dir, cfg!(windows)),
            self.allow_code,
        );
        args.push("--no-clean".to_owned());
        if !self.allow_code && self.previews_without_r() {
            args.extend(["-M".to_owned(), "engine:markdown".to_owned()]);
        }
        let mut environment = EngineEnvironment::inherited(source_date_epoch)
            .with_time_limit(oleafly_core::compile_limit::NOTEBOOK_TIME_LIMIT)
            .with_project_root(&self.project_dir)
            .with_variable("NO_COLOR", "1".to_owned());
        for (name, value) in
            crate::notebook_toolchain::quarto_runtime_variables(&self.project_dir, self.allow_code)
        {
            environment = environment.with_variable(name, value);
        }
        if extension == "pdf" {
            environment = environment.with_variable("openin_any", "r".to_owned());
        }
        if !self.allow_code {
            for (name, value) in restricted_variables(&self.out_dir) {
                environment = environment.with_variable(name, value);
            }
        }
        Ok(EngineCompileSpec {
            executable: EngineExecutable::ExternalPath(self.quarto.clone()),
            args,
            input: EngineInput::Direct(self.input.clone()),
            artifacts,
            working_dir: if self.output.html {
                place.document
            } else {
                place.root
            },
            environment,
        })
    }

    fn previews_without_r(&self) -> bool {
        if crate::notebook_toolchain::r_installed() {
            return false;
        }
        let source = read_bounded(&self.input, SOURCE_LIMIT).unwrap_or_default();
        markdown_engine_stands_in(&self.input, &source)
            && code_off::uses_knitr(&self.project_dir, &self.input)
    }
}

fn markdown_engine_stands_in(input: &Path, source: &str) -> bool {
    let rmarkdown = input
        .extension()
        .and_then(std::ffi::OsStr::to_str)
        .is_some_and(|extension| {
            extension.eq_ignore_ascii_case("rmd") || extension.eq_ignore_ascii_case("rmarkdown")
        });
    !rmarkdown
        && front_matter(source)
            .and_then(yaml_mapping)
            .is_some_and(|mapping| {
                mapping
                    .get(serde_norway::Value::String("knitr".to_owned()))
                    .is_none()
            })
}

pub(super) fn export_spec(
    project_dir: &Path,
    main_document: &str,
    format: &str,
    out_dir: &Path,
    allow_code: bool,
) -> Result<EngineCompileSpec, String> {
    let input = project_dir.join(main_document);
    let quarto = usable_quarto(project_dir, &input)?;
    let source = read_bounded(&input, SOURCE_LIMIT).unwrap_or_default();
    let yaml = project_yaml(project_dir, &input);
    let html = format == "html";
    let run = QuartoRun {
        quarto,
        input: input.clone(),
        out_dir: out_dir.to_owned(),
        project_dir: project_dir.to_owned(),
        output: QuartoTarget {
            format: export_format(&source, &yaml, format),
            html,
        },
        extension: Some(if html { "html" } else { "docx" }),
        allow_code,
    };
    let artifacts = EngineArtifacts {
        output_dir: out_dir.to_owned(),
        pdf: None,
        log: None,
        synctex: None,
        html: None,
    };
    let mut spec = run.spec(artifacts, None)?;
    if html {
        embed_html_output(&mut spec, out_dir, &input);
    }
    Ok(spec)
}

fn embed_html_output(spec: &mut EngineCompileSpec, out_dir: &Path, input: &Path) {
    spec.args.extend([
        "-M".to_owned(),
        EMBED_RESOURCES.to_owned(),
        "-M".to_owned(),
        "self-contained-math:true".to_owned(),
    ]);
    spec.artifacts.html = Some(html_artifact(out_dir, input));
}

pub(super) fn reject_project_local(tool: &Path, project_dir: &Path) -> Result<(), String> {
    let resolved_tool = tool.canonicalize().unwrap_or_else(|_| tool.to_path_buf());
    let resolved_project = project_dir
        .canonicalize()
        .unwrap_or_else(|_| project_dir.to_path_buf());
    if resolved_tool.starts_with(&resolved_project) {
        return Err(AppError::new("notebook.program_in_project").into());
    }
    Ok(())
}

pub(super) fn quarto_args(
    input: &Path,
    format: &str,
    output_name: &str,
    out_dir: &Path,
    allow_code: bool,
) -> Vec<String> {
    let mut args = vec![
        "render".to_owned(),
        oleafly_core::plain_path(input)
            .to_string_lossy()
            .into_owned(),
        "--to".to_owned(),
        format.to_owned(),
        "--output".to_owned(),
        output_name.to_owned(),
        "--output-dir".to_owned(),
        oleafly_core::plain_path(out_dir)
            .to_string_lossy()
            .into_owned(),
    ];
    if !allow_code {
        args.push("--no-execute".to_owned());
    }
    args
}

fn restricted_variables(out_dir: &Path) -> Vec<(&'static str, String)> {
    let home = dirs::home_dir();
    let profile = |name: &str| {
        home.as_ref()
            .map(|home| home.join(name))
            .filter(|path| path.is_file())
            .unwrap_or_else(|| out_dir.join(format!("oleafly-no{name}")))
            .to_string_lossy()
            .into_owned()
    };
    vec![
        ("R_PROFILE_USER", profile(".Rprofile")),
        ("R_ENVIRON_USER", profile(".Renviron")),
        ("PYTHONSAFEPATH", "1".to_owned()),
    ]
}

pub(super) fn read_bounded(path: &Path, limit: u64) -> Option<String> {
    oleafly_core::read_bounded(path, limit).map(|read| source_text(&read))
}

fn source_text(read: &oleafly_core::BoundedRead) -> String {
    let text = read.lossy_text();
    match text.strip_prefix('\u{feff}') {
        Some(rest) => rest.to_owned(),
        None => text,
    }
}

pub(super) fn project_yaml(project_dir: &Path, input: &Path) -> Vec<String> {
    project_directories(project_dir, input)
        .into_iter()
        .flat_map(|directory| {
            PROJECT_FILES
                .iter()
                .filter_map(move |name| read_bounded(&directory.join(name), YAML_LIMIT))
                .collect::<Vec<_>>()
        })
        .collect()
}

fn project_directories(project_dir: &Path, input: &Path) -> Vec<PathBuf> {
    let root = project_dir
        .canonicalize()
        .unwrap_or_else(|_| project_dir.to_path_buf());
    let mut directories = Vec::new();
    let mut current = input.parent().map(|parent| {
        parent
            .canonicalize()
            .unwrap_or_else(|_| parent.to_path_buf())
    });
    while let Some(directory) = current {
        if !directory.starts_with(&root) {
            break;
        }
        let at_root = directory == root;
        directories.push(directory.clone());
        if at_root {
            break;
        }
        current = directory.parent().map(Path::to_path_buf);
    }
    if directories.is_empty() {
        directories.push(root);
    }
    directories
}

pub(crate) fn target_for_file(input: &Path, project_dir: Option<&Path>) -> QuartoTarget {
    let source = read_bounded(input, SOURCE_LIMIT).unwrap_or_default();
    let yaml = match project_dir {
        Some(project_dir) => project_yaml(project_dir, input),
        None => Vec::new(),
    };
    quarto_target(&source, &yaml)
}

pub(crate) fn front_matter(source: &str) -> Option<&str> {
    let source = source.strip_prefix('\u{feff}').unwrap_or(source);
    let mut lines = source.split_inclusive('\n');
    let first = lines.next()?;
    if first.trim_end() != "---" {
        return None;
    }
    let start = first.len();
    let mut end = start;
    for line in lines {
        let trimmed = line.trim_end();
        if trimmed == "---" || trimmed == "..." {
            return Some(&source[start..end]);
        }
        end += line.len();
    }
    None
}

fn yaml_mapping(text: &str) -> Option<serde_norway::Mapping> {
    match serde_norway::from_str::<serde_norway::Value>(text).ok()? {
        serde_norway::Value::Mapping(mapping) => Some(mapping),
        _ => None,
    }
}

fn names(value: &serde_norway::Value) -> Vec<String> {
    match value {
        serde_norway::Value::String(name) => vec![name.trim().to_owned()],
        serde_norway::Value::Mapping(entries) => entries
            .iter()
            .filter_map(|(key, _)| key.as_str().map(|name| name.trim().to_owned()))
            .collect(),
        serde_norway::Value::Sequence(items) => items
            .iter()
            .filter_map(|item| item.as_str().map(|name| name.trim().to_owned()))
            .collect(),
        _ => Vec::new(),
    }
}

fn rmarkdown_format(name: &str) -> Option<&'static str> {
    let lower = name.trim().to_ascii_lowercase();
    let function = lower.rsplit("::").next().unwrap_or(lower.as_str());
    match function {
        "pdf_document" | "pdf_document2" | "pdf_book" => Some("pdf"),
        "beamer_presentation" => Some("beamer"),
        "html_document" | "html_document2" | "html_notebook" | "html_vignette" => Some("html"),
        "revealjs_presentation" => Some("revealjs"),
        _ => None,
    }
}

fn declared_formats(mapping: &serde_norway::Mapping) -> Vec<String> {
    let field = |key: &str| mapping.get(serde_norway::Value::String(key.to_owned()));
    if let Some(format) = field("format") {
        return names(format);
    }
    field("output")
        .map(names)
        .unwrap_or_default()
        .iter()
        .filter_map(|name| rmarkdown_format(name))
        .map(str::to_owned)
        .collect()
}

fn format_is_html(name: &str) -> Option<bool> {
    let lower = name.trim().to_ascii_lowercase();
    let base = lower.rsplit('-').next().unwrap_or(lower.as_str());
    match base {
        "pdf" | "typst" | "beamer" => Some(false),
        "html" | "revealjs" | "dashboard" => Some(true),
        _ => None,
    }
}

fn first_target(formats: &[String]) -> Option<QuartoTarget> {
    formats.iter().find_map(|name| {
        format_is_html(name).map(|html| QuartoTarget {
            format: name.clone(),
            html,
        })
    })
}

pub(crate) fn quarto_target(source: &str, project_yaml: &[String]) -> QuartoTarget {
    let declared = front_matter(source)
        .and_then(yaml_mapping)
        .map(|mapping| declared_formats(&mapping))
        .unwrap_or_default();
    if let Some(target) = first_target(&declared) {
        return target;
    }
    if declared.is_empty() {
        let project = project_yaml.iter().find_map(|text| {
            yaml_mapping(text)
                .map(|mapping| declared_formats(&mapping))
                .and_then(|formats| first_target(&formats))
        });
        if let Some(target) = project {
            return target;
        }
    }
    QuartoTarget::html_default()
}

pub(crate) fn export_format(source: &str, project_yaml: &[String], format: &str) -> String {
    match format {
        "html" => {
            let target = quarto_target(source, project_yaml);
            if target.html {
                target.format
            } else {
                "html".to_owned()
            }
        }
        other => other.to_owned(),
    }
}

fn fence_ticks(line: &str) -> (usize, &str) {
    let trimmed = line.trim_start_matches([' ', '\t', '>']);
    let ticks = trimmed
        .chars()
        .take_while(|character| *character == '`')
        .count();
    (ticks, &trimmed[ticks..])
}

pub(super) fn chunk_opener(line: &str) -> Option<&str> {
    let (ticks, rest) = fence_ticks(line);
    if ticks < 3 {
        return None;
    }
    let inner = rest
        .trim()
        .strip_prefix('{')?
        .strip_suffix('}')?
        .trim_start();
    inner
        .starts_with(|character: char| character.is_ascii_alphanumeric() || character == '_')
        .then_some(inner)
}

pub(crate) fn inline_knitr(source: &str) -> bool {
    let mut chunk = false;
    for line in source.lines() {
        if chunk {
            let (ticks, rest) = fence_ticks(line);
            chunk = !(ticks >= 3 && rest.trim().is_empty());
            continue;
        }
        if chunk_opener(line).is_some() {
            chunk = true;
            continue;
        }
        if ["`r ", "`r#", "`{r}", "`{r "]
            .iter()
            .any(|pattern| line.contains(pattern))
        {
            return true;
        }
    }
    false
}

pub(crate) fn has_executable_cells(source: &str) -> bool {
    source.lines().any(|line| {
        let Some(rest) = line.trim_start().strip_prefix("```") else {
            return false;
        };
        let Some(inner) = rest.trim_start_matches('`').trim_start().strip_prefix('{') else {
            return false;
        };
        let language: String = inner
            .trim_start()
            .chars()
            .take_while(|character| character.is_ascii_alphanumeric() || *character == '_')
            .collect();
        !language.is_empty()
            && !DIAGRAM_CELLS
                .iter()
                .any(|diagram| language.eq_ignore_ascii_case(diagram))
    })
}

pub(super) fn setup_failure_code(code: &str) -> &str {
    if code == JUPYTER_CODE {
        JUPYTER_COMMAND_CODE
    } else {
        code
    }
}

pub(super) fn strip_ansi(line: &str) -> String {
    let mut plain = String::with_capacity(line.len());
    let mut characters = line.chars().peekable();
    while let Some(character) = characters.next() {
        if character == '\u{1b}' {
            if characters.peek() == Some(&'[') {
                characters.next();
                for next in characters.by_ref() {
                    if next.is_ascii_alphabetic() {
                        break;
                    }
                }
            }
            continue;
        }
        plain.push(character);
    }
    plain
}

// Each explanation carries a code, so the app shows it in the user's language.
// The English here is the fallback.
fn quarto_explanation(message: &str) -> Option<(&'static str, &'static str)> {
    let lower = message.to_ascii_lowercase();
    if lower.contains("no tex installation") || lower.contains("no tex distribution") {
        return Some(("notebook.quarto_needs_tex", "This format needs LaTeX. Install TinyTeX, or add pdf-engine: tectonic to the document, which needs no TeX install. You can also switch the document to format: typst."));
    }
    if lower.contains("there is no package called")
        || lower.contains("is not available in this r installation")
    {
        return Some(("notebook.r_package_missing", "An R package this document needs is missing. Install it in R, for example with install.packages(), then compile again."));
    }
    if lower.contains("jupyter is not available") || lower.contains("no module named 'jupyter") {
        return Some((JUPYTER_CODE, JUPYTER_HINT));
    }
    if lower.contains("no valid input files") {
        return Some(("notebook.quarto_no_input", "Quarto could not read the main document. Check that it is a .qmd or .Rmd file inside the project."));
    }
    if lower.contains("--output-dir flag can only be used") {
        return Some(("notebook.not_project_input", "Quarto doesn't count this file as part of the project in this folder. It skips files and folders whose names start with _, and files left out of project: render. Rename the file or add it to project: render in _quarto.yml, then compile again."));
    }
    None
}

const FOLLOW_UP_LINES: [(&str, &str, &str); 3] = [
    ("Unable to locate an installed version of R", "notebook.r_missing", "This document has R code, and building it needs R even with code off. Oleafly can't find R. Install it from https://cloud.r-project.org/, then compile again."),
    ("Unable to locate an installed version of Python", "notebook.python_missing", "This document's Python code needs Python, and Oleafly can't find it. Install it from https://www.python.org/downloads/, then compile again. Or turn code off in the Compile menu to show the code without running it."),
    ("No Chrome or Chromium installation was detected", "notebook.chrome_missing", "Quarto needs Chrome, Chromium or Edge to draw this diagram in this format. Install one, then compile again, or switch the document to format: html."),
];

fn explain_with_follow_up(errors: &mut Vec<CompileError>, line: &str) -> bool {
    let Some((_, code, text)) = FOLLOW_UP_LINES
        .iter()
        .find(|(start, ..)| line.starts_with(start))
    else {
        return false;
    };
    let latest = errors
        .iter_mut()
        .rev()
        .find(|error| error.kind == "error" && error.code.is_none());
    match latest {
        Some(found) => {
            found.code = Some((*code).to_owned());
            found.explanation = Some((*text).to_owned());
        }
        None => errors.push(CompileError {
            code: Some((*code).to_owned()),
            explanation: Some((*text).to_owned()),
            ..error(line)
        }),
    }
    true
}

fn default_jupyter_install() -> &'static str {
    if cfg!(windows) {
        "python -m pip install jupyter"
    } else {
        "python3 -m pip install jupyter"
    }
}

fn with_jupyter_command(mut found: CompileError, command: &str) -> CompileError {
    found.explanation = Some(JUPYTER_HINT.replace("{{command}}", command));
    found
        .params
        .insert("command".to_owned(), command.to_owned());
    found
}

fn jupyter_install_line(lines: &[String], index: usize) -> Option<String> {
    lines[index..]
        .iter()
        .map(|line| line.trim())
        .find(|line| !line.is_empty())?
        .strip_prefix("Install with ")
        .map(|command| command.trim().to_owned())
        .filter(|command| !command.is_empty())
}

fn unrepresentable_character(line: &str) -> Option<char> {
    line.strip_prefix("warning: could not represent character \"")?
        .chars()
        .next()
}

fn located(location: &str) -> Option<(String, u32, Option<u32>)> {
    let location = location.trim();
    let (file, position) = match location.rsplit_once(", ") {
        Some((file, position)) => (file, position),
        None => {
            let mut parts = location.rsplitn(3, ':');
            let last = parts.next()?;
            let middle = parts.next()?;
            match parts.next() {
                Some(file) => {
                    return Some((
                        file.trim().to_owned(),
                        middle.trim().parse().ok()?,
                        last.trim().parse().ok(),
                    ))
                }
                None => return Some((middle.trim().to_owned(), last.trim().parse().ok()?, None)),
            }
        }
    };
    let (line, column) = match position.split_once(':') {
        Some((line, column)) => (line, column.trim().parse().ok()),
        None => (position, None),
    };
    Some((file.trim().to_owned(), line.trim().parse().ok()?, column))
}

fn trailing_location(message: &str) -> Option<(String, String, u32, Option<u32>)> {
    let (text, tail) = message.rsplit_once(" (")?;
    let (file, line, column) = located(tail.strip_suffix(')')?)?;
    let file = source_file(&file)?;
    Some((text.trim().to_owned(), file, line, column))
}

fn knitr_location(line: &str) -> Option<(Option<String>, u32)> {
    let rest = line.strip_prefix("Quitting from ")?;
    if let Some(lines) = rest.strip_prefix("lines ") {
        let start = lines
            .split(|character: char| !character.is_ascii_digit())
            .next()?
            .parse::<u32>()
            .ok()?;
        let file = lines
            .rsplit_once('(')
            .and_then(|(_, tail)| tail.split_once(')'))
            .map(|(file, _)| file.trim().to_owned())
            .filter(|file| !file.is_empty());
        return Some((file, start));
    }
    let location = rest.split_whitespace().next()?;
    let (file, range) = location.rsplit_once(':')?;
    let start = range
        .split(|character: char| !character.is_ascii_digit())
        .next()?
        .parse::<u32>()
        .ok()?;
    Some((Some(file.to_owned()), start))
}

fn source_file(file: &str) -> Option<String> {
    let lower = file.to_ascii_lowercase();
    (lower.ends_with(".qmd") || lower.ends_with(".rmd") || lower.ends_with(".md"))
        .then(|| file.to_owned())
}

fn python_exception(line: &str) -> bool {
    let Some((name, _)) = line.split_once(':') else {
        return false;
    };
    let name = name.trim();
    !name.is_empty()
        && !name.contains(char::is_whitespace)
        && name
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || matches!(character, '_' | '.'))
        && (name.ends_with("Error") || name.ends_with("Exception"))
}

fn error(message: impl Into<String>) -> CompileError {
    let message = message.into();
    let explained = quarto_explanation(&message);
    let found = CompileError {
        explanation: explained.map(|(_, text)| text.to_owned()),
        code: explained.map(|(code, _)| code.to_owned()),
        message,
        kind: "error".into(),
        ..CompileError::default()
    };
    if found.code.as_deref() == Some(JUPYTER_CODE) {
        with_jupyter_command(found, default_jupyter_install())
    } else {
        found
    }
}

fn warning(message: impl Into<String>) -> CompileError {
    CompileError {
        message: message.into(),
        kind: "warning".into(),
        ..CompileError::default()
    }
}

fn located_error(message: &str) -> CompileError {
    match trailing_location(message) {
        Some((text, file, line, column)) => CompileError {
            file: Some(file),
            line: Some(line),
            column,
            ..error(text)
        },
        None => error(message),
    }
}

fn yaml_error(rest: &str, file: Option<String>) -> CompileError {
    let number = rest
        .split(|character: char| !character.is_ascii_digit())
        .next()
        .and_then(|number| number.parse::<u32>().ok());
    let column = rest
        .split_once("columns ")
        .or_else(|| rest.split_once("column "))
        .and_then(|(_, tail)| {
            tail.split(|character: char| !character.is_ascii_digit())
                .next()
                .and_then(|number| number.parse::<u32>().ok())
        });
    let message = rest.split_once(')').map_or(rest, |(_, text)| text).trim();
    CompileError {
        file,
        line: number,
        column,
        ..error(message)
    }
}

fn warning_line(line: &str) -> Option<CompileError> {
    if let Some(message) = line.strip_prefix("WARN:") {
        return Some(warning(message.trim()));
    }
    if let Some(rest) = line.strip_prefix("WARNING ") {
        let message = rest
            .strip_prefix('(')
            .and_then(|tail| tail.split_once(')'))
            .map_or(rest, |(_, text)| text)
            .trim();
        return Some(warning(message));
    }
    line.strip_prefix("[WARNING]")
        .map(|message| warning(message.trim()))
}

fn knitr_error(
    lines: &[String],
    index: &mut usize,
    file: Option<&str>,
    start: u32,
) -> CompileError {
    let mut message = String::new();
    while *index < lines.len() {
        let next = lines[*index].trim();
        if next.is_empty() || next.starts_with("Execution halted") {
            break;
        }
        if !message.is_empty() {
            message.push(' ');
        }
        message.push_str(next.trim_start_matches("! "));
        *index += 1;
    }
    if message.is_empty() {
        message = "R code failed here.".to_owned();
    }
    CompileError {
        file: file.and_then(source_file),
        line: Some(start),
        ..error(message)
    }
}

fn cell_error(lines: &[String], index: &mut usize) -> CompileError {
    let mut code = Vec::new();
    let mut separators = 0;
    let mut exception = None;
    while *index < lines.len() {
        let next = lines[*index].trim_end();
        *index += 1;
        if separators < 2 {
            if next.trim().starts_with("------------------") {
                separators += 1;
            } else if separators == 1 && !next.trim().is_empty() {
                code.push(next.to_owned());
            }
            continue;
        }
        if next.trim().starts_with("ERROR:") {
            *index -= 1;
            break;
        }
        if python_exception(next.trim()) {
            exception = Some(next.trim().to_owned());
        }
    }
    CompileError {
        hints: code.into_iter().take(3).collect(),
        ..error(exception.unwrap_or_else(|| "A code cell failed while running.".to_owned()))
    }
}

fn failure_line(line: &str) -> Option<CompileError> {
    if let Some(message) = line.strip_prefix("! ") {
        return Some(error(message.trim()));
    }
    // Quarto prints this bare, after the Python traceback, when the Python it
    // found has no Jupyter.
    if line.starts_with("Jupyter is not available") {
        return Some(error(line));
    }
    if line.starts_with("No TeX installation was detected")
        || line.ends_with("is not available in this R installation.")
    {
        return Some(error(line));
    }
    (line.starts_with("Error in ") || line.starts_with("Error: ")).then(|| error(line))
}

fn pdf_failure(lines: &[String], index: &mut usize) -> CompileError {
    let mut summary = None;
    let mut collected: Vec<String> = Vec::new();
    while *index < lines.len() {
        let line = lines[*index].trim();
        if line.starts_with("WARN:") || line.starts_with("ERROR:") {
            break;
        }
        *index += 1;
        if line.starts_with("see ") && line.ends_with("for more information.") {
            break;
        }
        if line.starts_with("compilation failed") {
            summary = Some(line.to_owned());
        } else if !line.is_empty() {
            collected.push(line.trim_start_matches("! ").to_owned());
        }
    }
    let hint = collected.iter().find(|line| {
        line.strip_prefix("l.")
            .is_some_and(|rest| rest.starts_with(|next: char| next.is_ascii_digit()))
    });
    let message = collected
        .iter()
        .find(|line| line.contains("Error:"))
        .or(collected.first())
        .cloned()
        .or(summary)
        .unwrap_or_else(|| "The PDF step stopped without naming a problem.".to_owned());
    CompileError {
        hints: hint.cloned().into_iter().collect(),
        ..error(message)
    }
}

pub(crate) fn parse_quarto_log(log: &str) -> Vec<CompileError> {
    let lines: Vec<String> = log.lines().map(strip_ansi).collect();
    let mut errors: Vec<CompileError> = Vec::new();
    let mut yaml_file: Option<String> = None;
    let mut missing: Vec<char> = Vec::new();
    let mut index = 0;
    while index < lines.len() && errors.len() < MAX_ERRORS {
        let line = lines[index].trim();
        index += 1;
        if line.is_empty() {
            continue;
        }
        if let Some(character) = unrepresentable_character(line) {
            if !missing.contains(&character) {
                missing.push(character);
            }
            continue;
        }
        if explain_with_follow_up(&mut errors, line) {
            continue;
        }
        if let Some(message) = line.strip_prefix("ERROR:") {
            let message = message.trim();
            if message.is_empty() {
                errors.push(pdf_failure(&lines, &mut index));
                continue;
            }
            match message.strip_prefix("In file ") {
                Some(file) => yaml_file = Some(file.trim().to_owned()),
                None => errors.push(located_error(message)),
            }
            continue;
        }
        if let Some(rest) = line.strip_prefix("(line ") {
            errors.push(yaml_error(rest, yaml_file.clone()));
            continue;
        }
        if let Some(found) = warning_line(line) {
            errors.push(found);
            continue;
        }
        if let Some((file, start)) = knitr_location(line) {
            errors.push(knitr_error(&lines, &mut index, file.as_deref(), start));
            continue;
        }
        if line.starts_with("An error occurred while executing the following cell") {
            errors.push(cell_error(&lines, &mut index));
            continue;
        }
        errors.extend(failure_line(line).map(|found| {
            let command = (found.code.as_deref() == Some(JUPYTER_CODE))
                .then(|| jupyter_install_line(&lines, index))
                .flatten();
            match command {
                Some(command) => with_jupyter_command(found, &command),
                None => found,
            }
        }));
    }
    if !missing.is_empty() {
        errors.push(missing_glyph_warning(&missing));
    }
    let mut seen = std::collections::HashSet::new();
    errors.retain(|error| {
        let identity = error.code.clone().unwrap_or_else(|| error.message.clone());
        seen.insert((error.kind.clone(), identity, error.line))
    });
    errors.sort_by_key(|error| error.kind != "error");
    errors
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn notebook_runs_get_the_notebook_time_limit() {
        let project = tempfile::tempdir().unwrap();
        let input = project.path().join("main.qmd");
        std::fs::write(&input, "# Title\n").unwrap();
        let tools = tempfile::tempdir().unwrap();
        let out_dir = project.path().join("build");
        let run = QuartoRun {
            quarto: tools.path().join("quarto"),
            input,
            out_dir: out_dir.clone(),
            project_dir: project.path().to_owned(),
            output: QuartoTarget {
                format: "pdf".into(),
                html: false,
            },
            extension: None,
            allow_code: true,
        };
        let artifacts = EngineArtifacts {
            output_dir: out_dir,
            pdf: None,
            log: None,
            synctex: None,
            html: None,
        };
        let spec = run.spec(artifacts, None).unwrap();
        assert_eq!(
            spec.environment.time_limit(),
            oleafly_core::compile_limit::NOTEBOOK_TIME_LIMIT
        );
    }

    fn target(source: &str) -> (String, bool) {
        let target = quarto_target(source, &[]);
        (target.format, target.html)
    }

    #[test]
    fn the_first_declared_format_decides_the_output() {
        assert_eq!(
            target("---\ntitle: A\nformat: pdf\n---\nText\n"),
            ("pdf".into(), false)
        );
        assert_eq!(
            target("---\nformat:\n  revealjs:\n    theme: dark\n  pdf: default\n---\n"),
            ("revealjs".into(), true)
        );
        assert_eq!(
            target("---\nformat:\n  docx: default\n  typst:\n    toc: true\n---\n"),
            ("typst".into(), false)
        );
        assert_eq!(
            target("---\nformat: acm-pdf\n---\n"),
            ("acm-pdf".into(), false)
        );
        assert_eq!(
            target("---\nformat: [html, pdf]\n---\n"),
            ("html".into(), true)
        );
        assert_eq!(target("# No front matter\n"), ("html".into(), true));
        assert_eq!(target("---\nformat: docx\n---\n"), ("html".into(), true));
        assert_eq!(
            target("\u{feff}---\nformat: beamer\n...\nBody\n"),
            ("beamer".into(), false)
        );
    }

    #[test]
    fn r_markdown_outputs_map_to_quarto_formats() {
        assert_eq!(
            target("---\noutput: pdf_document\n---\n"),
            ("pdf".into(), false)
        );
        assert_eq!(
            target("---\noutput:\n  bookdown::html_document2:\n    toc: true\n---\n"),
            ("html".into(), true)
        );
        assert_eq!(
            target("---\noutput: word_document\n---\n"),
            ("html".into(), true)
        );
    }

    #[test]
    fn project_files_decide_only_when_the_document_declares_nothing() {
        let project = vec!["project:\n  type: default\nformat:\n  pdf: default\n".to_owned()];
        assert_eq!(quarto_target("# Body\n", &project).format, "pdf");
        assert_eq!(
            quarto_target("---\nformat: revealjs\n---\n", &project).format,
            "revealjs"
        );
    }

    #[test]
    fn html_exports_keep_a_declared_slide_format() {
        assert_eq!(
            export_format("---\nformat: revealjs\n---\n", &[], "html"),
            "revealjs"
        );
        assert_eq!(
            export_format("---\nformat: pdf\n---\n", &[], "html"),
            "html"
        );
        assert_eq!(
            export_format("---\nformat: pdf\n---\n", &[], "docx"),
            "docx"
        );
    }

    #[test]
    fn arguments_render_into_the_build_folder_and_skip_code_when_off() {
        let args = quarto_args(
            Path::new("/work/paper/main.qmd"),
            "pdf",
            "_oleafly_entry.pdf",
            Path::new("/work/build"),
            false,
        );
        assert_eq!(
            args,
            [
                "render",
                "/work/paper/main.qmd",
                "--to",
                "pdf",
                "--output",
                "_oleafly_entry.pdf",
                "--output-dir",
                "/work/build",
                "--no-execute",
            ]
        );
        let trusted = quarto_args(
            Path::new("/work/main.qmd"),
            "revealjs",
            "_oleafly_entry.html",
            Path::new("/work/build"),
            true,
        );
        assert!(!trusted.iter().any(|arg| arg == "--no-execute"));
        assert!(trusted.windows(2).any(|pair| pair == ["--to", "revealjs"]));
    }

    #[test]
    fn executable_cells_are_told_apart_from_display_code_and_diagrams() {
        assert!(has_executable_cells("```{r}\n1 + 1\n```\n"));
        assert!(has_executable_cells(
            "```{python}\n#| echo: false\nprint(1)\n```\n"
        ));
        assert!(has_executable_cells(
            "```{r setup, include=FALSE}\nlibrary(x)\n```\n"
        ));
        assert!(!has_executable_cells("```python\nprint(1)\n```\n"));
        assert!(!has_executable_cells("```{.python}\nprint(1)\n```\n"));
        assert!(!has_executable_cells(
            "```{mermaid}\ngraph TD; A-->B\n```\n"
        ));
        assert!(!has_executable_cells("```{=html}\n<b>x</b>\n```\n"));
    }

    #[test]
    fn inline_r_code_is_found_everywhere_knitr_reads_it() {
        assert!(inline_knitr("The mean is `r mean(x)`.\n"));
        assert!(inline_knitr("The mean is `{r} mean(x)`.\n"));
        assert!(inline_knitr("The mean is `r#mean(x)`.\n"));
        assert!(inline_knitr("```markdown\nThe mean is `r mean(x)`.\n```\n"));
        assert!(inline_knitr(
            "```{r}\nx <- 1\n```\n\n> The mean is `r mean(x)`.\n"
        ));
        assert!(!inline_knitr("```{r}\nx <- `r 1`\n```\n"));
        assert!(!inline_knitr("Use `python` here.\n"));
    }

    #[test]
    fn code_off_refuses_a_project_with_extensions() {
        let directory = tempfile::tempdir().unwrap();
        let input = directory.path().join("paper").join("main.qmd");
        std::fs::create_dir_all(input.parent().unwrap()).unwrap();
        std::fs::write(&input, "# Paper\n").unwrap();
        assert!(!code_off::code_needed(directory.path(), &input));
        std::fs::create_dir(directory.path().join("_extensions")).unwrap();
        assert!(code_off::code_needed(directory.path(), &input));
    }

    #[test]
    fn project_yaml_is_read_from_the_document_folder_up_to_the_project() {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path();
        std::fs::create_dir_all(root.join("chapters")).unwrap();
        std::fs::write(root.join("_quarto.yml"), "format: pdf\n").unwrap();
        std::fs::write(
            root.join("chapters").join("_metadata.yml"),
            "format: revealjs\n",
        )
        .unwrap();
        let input = root.join("chapters").join("one.qmd");
        std::fs::write(&input, "# One\n").unwrap();
        let yaml = project_yaml(root, &input);
        assert_eq!(yaml, ["format: revealjs\n", "format: pdf\n"]);
        assert_eq!(target_for_file(&input, Some(root)).format, "revealjs");
    }

    #[test]
    fn quarto_errors_and_warnings_are_parsed() {
        let log = "\u{1b}[31mERROR: No TeX installation was detected.\u{1b}[39m\n\
                   WARN: Unable to resolve crossref @fig-missing\n\
                   WARNING (/opt/quarto/share/filters/main.lua:10) Raw LaTeX was ignored\n\
                   [WARNING] Could not convert TeX math \\foo, rendering as TeX\n";
        let errors = parse_quarto_log(log);
        assert_eq!(errors.len(), 4);
        assert_eq!(errors[0].kind, "error");
        assert_eq!(errors[0].message, "No TeX installation was detected.");
        assert!(errors[0]
            .explanation
            .as_deref()
            .unwrap()
            .contains("TinyTeX"));
        assert_eq!(errors[1].message, "Unable to resolve crossref @fig-missing");
        assert_eq!(errors[2].message, "Raw LaTeX was ignored");
        assert!(errors.iter().skip(1).all(|error| error.kind == "warning"));
    }

    #[test]
    fn yaml_validation_errors_carry_file_and_line() {
        let log = "ERROR: In file paper.qmd\n\
                   (line 3, columns 6--9) Field \"toc\" has value yess, which must instead be `true` or `false`\n\
                   3: toc: yess\n";
        let errors = parse_quarto_log(log);
        assert_eq!(errors.len(), 1);
        assert_eq!(errors[0].file.as_deref(), Some("paper.qmd"));
        assert_eq!(errors[0].line, Some(3));
        assert_eq!(errors[0].column, Some(6));
        assert!(errors[0].message.starts_with("Field \"toc\""));

        let exception = parse_quarto_log(
            "ERROR: YAMLException: bad indentation of a mapping entry (paper.qmd, 4:9)\n",
        );
        assert_eq!(
            exception[0].message,
            "YAMLException: bad indentation of a mapping entry"
        );
        assert_eq!(exception[0].file.as_deref(), Some("paper.qmd"));
        assert_eq!((exception[0].line, exception[0].column), (Some(4), Some(9)));

        let elsewhere = parse_quarto_log("ERROR: Render failed (see log, 2:1)\n");
        assert_eq!(elsewhere[0].message, "Render failed (see log, 2:1)");
        assert_eq!(elsewhere[0].file, None);
    }

    #[test]
    fn knitr_failures_point_at_the_chunk_lines() {
        let modern = parse_quarto_log(
            "Quitting from analysis.qmd:12-15 [summary]\nError in `foo()`:\n! could not find function \"foo\"\n\nExecution halted\n",
        );
        assert_eq!(modern.len(), 1);
        assert_eq!(modern[0].file.as_deref(), Some("analysis.qmd"));
        assert_eq!(modern[0].line, Some(12));
        assert!(modern[0].message.contains("could not find function"));

        let classic = parse_quarto_log(
            "Quitting from lines 7-9 [setup] (report.Rmd)\nError in library(missing): there is no package called 'missing'\nExecution halted\n",
        );
        assert_eq!(classic[0].file.as_deref(), Some("report.Rmd"));
        assert_eq!(classic[0].line, Some(7));
        assert!(classic[0].explanation.is_some());
    }

    #[test]
    fn jupyter_cell_failures_report_the_exception() {
        let log = "An error occurred while executing the following cell:\n\
                   ------------------\n\
                   print(value)\n\
                   ------------------\n\
                   \n\
                   ---------------------------------------------------------------------------\n\
                   NameError                                 Traceback (most recent call last)\n\
                   Cell In[1], line 1\n\
                   ----> 1 print(value)\n\
                   \n\
                   NameError: name 'value' is not defined\n";
        let errors = parse_quarto_log(log);
        assert_eq!(errors.len(), 1);
        assert_eq!(errors[0].message, "NameError: name 'value' is not defined");
        assert_eq!(errors[0].hints, ["print(value)"]);
    }

    #[test]
    fn missing_jupyter_is_an_error_with_the_fix() {
        let log = "Starting python3 kernel...Traceback (most recent call last):\n\
                   ModuleNotFoundError: No module named 'nbformat'\n\
                   \n\
                   Jupyter is not available in this Python installation.\n\
                   Install with \u{1b}[1mpython3 -m pip install jupyter\u{1b}[22m\n\
                   \n\
                   \u{1b}[33mWARN: Error encountered when rendering files\u{1b}[39m\n";
        let errors = parse_quarto_log(log);
        assert_eq!(errors.len(), 2);
        assert_eq!(errors[0].kind, "error");
        assert_eq!(
            errors[0].message,
            "Jupyter is not available in this Python installation."
        );
        assert!(errors[0]
            .explanation
            .as_deref()
            .is_some_and(|text| text.contains("python3 -m pip install jupyter")));
        assert_eq!(errors[0].code.as_deref(), Some("notebook.jupyter_missing"));
        assert_eq!(errors[1].kind, "warning");
    }

    #[test]
    fn tex_errors_from_the_pdf_step_are_errors() {
        let errors = parse_quarto_log("! LaTeX Error: File `fancy.sty' not found.\n");
        assert_eq!(errors.len(), 1);
        assert_eq!(
            errors[0].message,
            "LaTeX Error: File `fancy.sty' not found."
        );
    }

    fn error_codes(log: &str) -> Vec<Option<String>> {
        parse_quarto_log(log)
            .into_iter()
            .filter(|error| error.kind == "error")
            .map(|error| error.code)
            .collect()
    }

    #[test]
    fn the_bare_no_tex_line_from_real_quarto_gets_the_tinytex_hint() {
        let log = "running lualatex - 1\n\nNo TeX installation was detected.\n\nPlease run 'quarto install tinytex' to install TinyTex.\nIf you prefer, you may install TexLive or another TeX distribution.\n\n\u{1b}[33mWARN: Error encountered when rendering files\u{1b}[39m\n";
        let errors = parse_quarto_log(log);
        assert_eq!(errors[0].kind, "error");
        assert_eq!(errors[0].code.as_deref(), Some("notebook.quarto_needs_tex"));
        assert!(errors[0]
            .explanation
            .as_deref()
            .unwrap()
            .contains("TinyTeX"));
    }

    #[test]
    fn a_latex_failure_shows_the_reason_printed_after_the_blank_error_line() {
        let log = "\u{1b}[31mERROR: \u{1b}[39m\n\
                   \u{1b}[31mcompilation failed- missing packages (automatic installed disabled)\u{1b}[39m\n\
                   LaTeX Error: File `nonexistentpkgxyz.sty' not found.\n\
                   \n\
                   Type X to quit or <RETURN> to proceed,\n\
                   ! Emergency stop.\n\
                   <read *>\n\
                   \n\
                   see /work/main.log for more information.\n\
                   WARN: Error encountered when rendering files\n";
        let errors = parse_quarto_log(log);
        assert_eq!(errors.len(), 2);
        assert_eq!(
            errors[0].message,
            "LaTeX Error: File `nonexistentpkgxyz.sty' not found."
        );
        assert_eq!(errors[0].file, None);
        assert_eq!(errors[1].kind, "warning");
    }

    #[test]
    fn an_undefined_macro_keeps_its_line_as_a_hint_without_a_source_location() {
        let log = "ERROR: \ncompilation failed- error\nUndefined control sequence.\nl.176 \\undefinedmacro\n\nsee /work/main.log for more information.\n";
        let errors = parse_quarto_log(log);
        assert_eq!(errors.len(), 1);
        assert_eq!(errors[0].message, "Undefined control sequence.");
        assert_eq!(errors[0].hints, ["l.176 \\undefinedmacro"]);
        assert_eq!(errors[0].line, None);
    }

    #[test]
    fn a_blank_error_line_never_gives_a_blank_card() {
        let bare = parse_quarto_log("ERROR: \n");
        assert!(!bare[0].message.is_empty());
        let summary = parse_quarto_log(
            "ERROR: \ncompilation failed- error\nsee /work/main.log for more information.\n",
        );
        assert_eq!(summary[0].message, "compilation failed- error");
        let next = parse_quarto_log("ERROR: \nERROR: Render stopped\n");
        assert_eq!(next.len(), 2);
    }

    #[test]
    fn missing_knitr_and_rmarkdown_make_one_card_with_the_package_hint() {
        let log = "The knitr package is not available in this R installation.\nInstall with install.packages(\"knitr\")\n\nThe rmarkdown package is not available in this R installation.\n";
        let errors = parse_quarto_log(log);
        assert_eq!(errors.len(), 1);
        assert_eq!(
            errors[0].code.as_deref(),
            Some("notebook.r_package_missing")
        );
    }

    #[test]
    fn missing_runtimes_use_quartos_follow_up_line_and_keep_the_spawn_message() {
        let r = parse_quarto_log(
            "ERROR: Error executing 'Rscript': Failed to spawn 'Rscript': entity not found\n\nUnable to locate an installed version of R.\nInstall R from https://cloud.r-project.org/\n\n\u{1b}[33mWARN: Error encountered when rendering files\u{1b}[39m\n",
        );
        assert_eq!(r[0].code.as_deref(), Some("notebook.r_missing"));
        assert!(r[0].message.contains("Failed to spawn"));
        assert!(r[0]
            .explanation
            .as_deref()
            .unwrap()
            .contains("cloud.r-project.org"));

        let python = parse_quarto_log(
            "ERROR: Error executing 'python3': Failed to spawn 'python3': program not found\n\nUnable to locate an installed version of Python 3.\nInstall Python 3 from https://www.python.org/downloads/\n",
        );
        assert_eq!(python[0].code.as_deref(), Some("notebook.python_missing"));

        let chrome = parse_quarto_log(
            "ERROR: Chrome not found\n\nNo Chrome or Chromium installation was detected.\n\nPlease run 'quarto install chrome-headless-shell' to install a headless browser.\n",
        );
        assert_eq!(chrome.len(), 1);
        assert_eq!(chrome[0].code.as_deref(), Some("notebook.chrome_missing"));
        assert_eq!(chrome[0].message, "Chrome not found");

        let alone = parse_quarto_log("No Chrome or Chromium installation was detected.\n");
        assert_eq!(alone[0].kind, "error");
        assert_eq!(alone[0].code.as_deref(), Some("notebook.chrome_missing"));
    }

    #[test]
    fn the_jupyter_hint_uses_the_install_line_quarto_printed() {
        for command in [
            "python -m pip install jupyter",
            "py -m pip install jupyter",
            "conda install jupyter",
        ] {
            let log = format!(
                "Jupyter is not available in this Python installation.\n\nInstall with \u{1b}[1m{command}\u{1b}[22m\n"
            );
            let errors = parse_quarto_log(&log);
            assert_eq!(errors[0].params["command"], command);
            assert!(errors[0].explanation.as_deref().unwrap().contains(command));
            assert!(!errors[0].explanation.as_deref().unwrap().contains("{{"));
        }
        let bare = parse_quarto_log("Jupyter is not available in this Python installation.\n");
        assert_eq!(bare[0].params["command"], default_jupyter_install());
    }

    #[test]
    fn a_file_outside_the_project_inputs_gets_a_coded_error() {
        let codes =
            error_codes("ERROR: The --output-dir flag can only be used when rendering projects.\n");
        assert_eq!(codes, [Some("notebook.not_project_input".to_owned())]);
    }

    #[test]
    fn characters_tectonic_could_not_set_become_one_warning() {
        let log = "warning: could not represent character \"글\" (0xae00) in font \"[lmroman10-regular]:mapping=tex-text;\"\n\
                   warning: could not represent character \"数\" (0x6570) in font \"[lmroman10-regular]:mapping=tex-text;\"\n\
                   warning: could not represent character \"글\" (0xae00) in font \"[lmroman10-regular]:mapping=tex-text;\"\n";
        let errors = parse_quarto_log(log);
        assert_eq!(errors.len(), 1);
        assert_eq!(errors[0].kind, "warning");
        assert_eq!(errors[0].code.as_deref(), Some(MISSING_GLYPHS_CJK_CODE));
        assert_eq!(errors[0].params["count"], "2");
        assert_eq!(errors[0].params["sample"], "글 数");
        assert_eq!(errors[0].params["font"], KOREAN_FONT);
    }

    #[test]
    fn the_tex_log_names_the_dropped_characters_and_the_font_that_has_them() {
        let log = "Missing character: There is no 数 (U+6570) in font [lmroman10-regular]:mapping=t\n\
                   ex-text;!\n\
                   Missing character: There is no 数 (U+6570) in font [lmroman10-regular]:mapping=tex-text;!\n\
                   Missing character: There is no x in font nullfont!\n\
                   Missing character: There is no ^^c3 in font ec-lmr10!\n";
        assert_eq!(missing_characters(log), ['数']);
        let chinese = missing_glyph_warning(&['数', 'か']);
        assert_eq!(chinese.params["font"], CHINESE_FONT);
        assert_eq!(chinese.code.as_deref(), Some(MISSING_GLYPHS_CJK_CODE));
        let other = missing_glyph_warning(&['Ω']);
        assert_eq!(other.code.as_deref(), Some(MISSING_GLYPHS_CODE));
        assert!(!other.params.contains_key("font"));
        let many: Vec<char> = "一二三四五六七八九十".chars().collect();
        let long = missing_glyph_warning(&many);
        assert_eq!(long.params["count"], "10");
        assert_eq!(
            long.params["sample"].split(' ').count(),
            MISSING_GLYPH_SAMPLE
        );
    }

    fn pdf_spec(input: &Path, format: &str) -> EngineCompileSpec {
        EngineCompileSpec {
            executable: EngineExecutable::ExternalPath(PathBuf::from("quarto")),
            args: vec!["render".to_owned(), "--to".to_owned(), format.to_owned()],
            input: EngineInput::Direct(input.to_owned()),
            artifacts: EngineArtifacts {
                output_dir: PathBuf::new(),
                pdf: None,
                log: None,
                synctex: None,
                html: None,
            },
            working_dir: PathBuf::new(),
            environment: EngineEnvironment::default(),
        }
    }

    #[test]
    fn a_kept_tex_log_is_read_only_for_latex_targets() {
        let project = tempfile::tempdir().unwrap();
        let input = project.path().join("main.qmd");
        std::fs::write(&input, "한글\n").unwrap();
        std::fs::write(
            project.path().join("main.log"),
            "Missing character: There is no 한 (U+D55C) in font [lmroman10-regular]:mapping=tex-text;!\n",
        )
        .unwrap();
        let warning = tex_log_glyph_warning(&pdf_spec(&input, "pdf")).unwrap();
        assert_eq!(warning.params["font"], KOREAN_FONT);
        assert_eq!(tex_log_glyph_warning(&pdf_spec(&input, "typst")), None);
        assert_eq!(tex_log_glyph_warning(&pdf_spec(&input, "html")), None);
    }

    fn options(allow_code: bool) -> CompileOptions {
        CompileOptions {
            allow_shell_escape: allow_code,
            ..CompileOptions::default()
        }
    }

    #[test]
    fn julia_code_that_never_started_is_reported_when_code_is_on() {
        let source = "```{julia}\n1 + 1\n```\n";
        assert_eq!(
            julia_note(source, &options(true), "Output created: x.pdf\n")
                .unwrap()
                .code
                .as_deref(),
            Some(JULIA_NOT_RUN_CODE)
        );
        assert_eq!(
            julia_note(
                source,
                &options(true),
                "Starting julia-1.11 kernel...Done\n"
            ),
            None
        );
        assert_eq!(julia_note(source, &options(false), ""), None);
        assert_eq!(
            julia_note("```{python}\n1\n```\n", &options(true), ""),
            None
        );
    }

    #[test]
    fn julia_code_on_a_reused_server_counts_as_having_run() {
        let source = "```{julia}\n1 + 1\n```\n";
        for log in [
            "Running [1/1] at line 7:  1 + 1\n",
            "Running [ 1/12] at line 7:  1 + 1\n",
            "\u{1b}[1mRunning [1/1] at line 7:  1 + 1\u{1b}[0m\n",
            "\nExecuting 'main.quarto_ipynb'\n  Cell 1/1: ...Done\n",
        ] {
            assert_eq!(julia_note(source, &options(true), log), None, "{log}");
        }
        assert!(julia_note(source, &options(true), "Running the filters\n").is_some());
    }

    #[test]
    fn a_frozen_document_needs_no_julia_note() {
        let layout = Layout::new(&[
            "_quarto.yml",
            "paper/main.qmd",
            "paper/other.qmd",
            "_freeze/paper/main/execute-results/pdf.json",
        ]);
        assert!(frozen(&layout.root.join("paper").join("main.qmd")));
        assert!(!frozen(&layout.root.join("paper").join("other.qmd")));
    }

    #[test]
    fn the_markdown_engine_stands_in_only_where_quarto_honours_it() {
        let qmd = Path::new("report.qmd");
        assert!(markdown_engine_stands_in(qmd, "---\ntitle: A\n---\n"));
        assert!(!markdown_engine_stands_in(qmd, "# No front matter\n"));
        assert!(!markdown_engine_stands_in(qmd, "---\n---\n"));
        assert!(!markdown_engine_stands_in(
            qmd,
            "---\nknitr:\n  opts_chunk:\n    echo: false\n---\n"
        ));
        assert!(!markdown_engine_stands_in(
            Path::new("report.Rmd"),
            "---\ntitle: A\n---\n"
        ));
    }

    #[test]
    fn r_chunks_are_told_apart_from_other_languages() {
        let project = tempfile::tempdir().unwrap();
        let r = project.path().join("r.qmd");
        std::fs::write(&r, "---\ntitle: A\n---\n\n```{r}\n1\n```\n").unwrap();
        let python = project.path().join("python.qmd");
        std::fs::write(&python, "---\ntitle: A\n---\n\n```{python}\n1\n```\n").unwrap();
        let rmd = project.path().join("plain.Rmd");
        std::fs::write(&rmd, "---\ntitle: A\n---\n\nText\n").unwrap();
        assert!(code_off::uses_knitr(project.path(), &r));
        assert!(!code_off::uses_knitr(project.path(), &python));
        assert!(code_off::uses_knitr(project.path(), &rmd));
    }

    struct Layout {
        _temp: tempfile::TempDir,
        root: PathBuf,
    }

    impl Layout {
        fn new(files: &[&str]) -> Self {
            Self::under("project", files)
        }

        fn under(folder: &str, files: &[&str]) -> Self {
            let temp = tempfile::Builder::new()
                .prefix("oleafly-quarto-")
                .tempdir()
                .unwrap();
            let root = oleafly_core::plain_path(&temp.path().canonicalize().unwrap()).join(folder);
            for file in files {
                let path = root.join(file);
                std::fs::create_dir_all(path.parent().unwrap()).unwrap();
                std::fs::write(path, "# File\n").unwrap();
            }
            Self { _temp: temp, root }
        }

        fn spec(&self, document: &str, format: &str, html: bool) -> EngineCompileSpec {
            let run = QuartoRun {
                quarto: self.root.parent().unwrap().join("quarto"),
                input: self.root.join(document),
                out_dir: self.root.join("build"),
                project_dir: self.root.clone(),
                output: QuartoTarget {
                    format: format.to_owned(),
                    html,
                },
                extension: None,
                allow_code: true,
            };
            run.spec(
                EngineArtifacts {
                    output_dir: self.root.join("build"),
                    pdf: None,
                    log: None,
                    synctex: None,
                    html: None,
                },
                None,
            )
            .unwrap()
        }

        fn html(&self, document: &str) -> PathBuf {
            html_artifact(&self.root.join("build"), &self.root.join(document))
        }
    }

    fn entry_html(folder: &Path) -> PathBuf {
        folder.join(format!("{}.html", crate::paths::ENTRY_STEM))
    }

    #[test]
    fn a_document_without_a_quarto_project_runs_from_its_own_folder() {
        let layout = Layout::new(&["a/b/main.qmd"]);
        let folder = layout.root.join("a").join("b");
        assert_eq!(
            layout.spec("a/b/main.qmd", "pdf", false).working_dir,
            folder
        );
        assert_eq!(
            layout.spec("a/b/main.qmd", "html", true).working_dir,
            folder
        );
        assert_eq!(
            layout.html("a/b/main.qmd"),
            entry_html(&layout.root.join("build"))
        );
    }

    #[test]
    fn a_project_at_the_root_runs_pdf_from_the_root_and_html_from_the_document() {
        let layout = Layout::new(&["_quarto.yml", "paper/main.qmd"]);
        let spec = layout.spec("paper/main.qmd", "typst", false);
        assert_eq!(spec.working_dir, layout.root);
        assert_eq!(
            layout.spec("paper/main.qmd", "html", true).working_dir,
            layout.root.join("paper")
        );
        assert_eq!(
            layout.html("paper/main.qmd"),
            entry_html(&layout.root.join("build").join("paper"))
        );
    }

    #[test]
    fn a_project_file_beside_or_above_the_document_sets_the_html_folder() {
        let beside = Layout::new(&["paper/_quarto.yaml", "paper/main.qmd"]);
        assert_eq!(
            beside.spec("paper/main.qmd", "pdf", false).working_dir,
            beside.root.join("paper")
        );
        assert_eq!(
            beside.html("paper/main.qmd"),
            entry_html(&beside.root.join("build"))
        );
        let middle = Layout::new(&["a/_quarto.yml", "a/b/c/main.qmd"]);
        assert_eq!(
            middle.spec("a/b/c/main.qmd", "pdf", false).working_dir,
            middle.root.join("a")
        );
        assert_eq!(
            middle.html("a/b/c/main.qmd"),
            entry_html(&middle.root.join("build").join("b").join("c"))
        );
        let above = Layout::new(&["main.qmd"]);
        std::fs::write(above.root.parent().unwrap().join("_quarto.yml"), "").unwrap();
        assert_eq!(
            above.spec("main.qmd", "pdf", false).working_dir,
            above.root.parent().unwrap()
        );
    }

    #[test]
    fn the_path_exclusion_still_covers_the_whole_project() {
        let layout = Layout::new(&["a/main.qmd"]);
        let spec = layout.spec("a/main.qmd", "pdf", false);
        assert_ne!(spec.working_dir, layout.root);
        assert_eq!(
            spec.environment.path_excluded_root(&spec.working_dir),
            layout.root
        );
    }

    #[test]
    fn every_run_keeps_the_build_folder_and_asks_for_plain_output() {
        let layout = Layout::new(&["main.qmd"]);
        let spec = layout.spec("main.qmd", "pdf", false);
        assert!(spec.args.iter().any(|arg| arg == "--no-clean"));
        assert!(spec
            .environment
            .variables()
            .iter()
            .any(|(name, value)| name == "NO_COLOR" && value == "1"));
    }

    #[test]
    fn html_exports_embed_math_and_follow_the_document_folder() {
        let layout = Layout::new(&["_quarto.yml", "paper/main.qmd"]);
        let out_dir = layout.root.join("build");
        let input = layout.root.join("paper").join("main.qmd");
        let mut spec = layout.spec("paper/main.qmd", "html", true);
        embed_html_output(&mut spec, &out_dir, &input);
        assert!(spec
            .args
            .windows(2)
            .any(|pair| pair == ["-M", "embed-resources:true"]));
        assert!(spec
            .args
            .windows(2)
            .any(|pair| pair == ["-M", "self-contained-math:true"]));
        assert_eq!(
            spec.artifacts.html,
            Some(entry_html(&out_dir.join("paper")))
        );
    }

    #[test]
    fn the_reported_format_comes_from_the_arguments() {
        let args = ["render", "x.qmd", "--to", "acm-pdf"].map(str::to_owned);
        assert_eq!(format_argument(&args), Some("acm-pdf"));
        assert_eq!(format_argument(&["render".to_owned()]), None);
    }

    #[test]
    fn only_pdf_runs_limit_what_tex_may_read() {
        let layout = Layout::new(&["main.qmd"]);
        let launched_with = |spec: EngineCompileSpec| {
            let command = crate::document_engine::supervised_command(
                &layout.root.join("quarto"),
                &spec.args,
                &spec.working_dir,
                std::ffi::OsStr::new("/usr/bin"),
                None,
                &spec.environment,
            );
            command
                .as_std()
                .get_envs()
                .find(|(name, _)| *name == "openin_any")
                .and_then(|(_, value)| value.map(std::ffi::OsStr::to_os_string))
        };
        assert_eq!(
            launched_with(layout.spec("main.qmd", "pdf", false)),
            Some("r".into())
        );
        assert_eq!(
            launched_with(layout.spec("main.qmd", "typst", false)),
            Some("r".into())
        );
        assert_eq!(launched_with(layout.spec("main.qmd", "html", true)), None);
    }

    #[test]
    fn holding_reads_keep_settings_from_the_document_and_the_project() {
        let layout = Layout::new(&[
            "report.qmd",
            "report.tex",
            "keep/report.qmd",
            "keep/report.tex",
        ]);
        let leftover = "% Options for packages loaded elsewhere\n% old\n";
        std::fs::write(layout.root.join("report.tex"), leftover).unwrap();
        std::fs::write(layout.root.join("keep/report.tex"), leftover).unwrap();
        std::fs::write(
            layout.root.join("keep/_metadata.yml"),
            "format:\n  pdf:\n    keep-tex: true\n",
        )
        .unwrap();

        let hold = hold_siblings(&layout.spec("report.qmd", "pdf", false))
            .unwrap()
            .unwrap();
        std::fs::remove_file(layout.root.join("report.tex")).unwrap();
        drop(hold);
        assert_eq!(
            std::fs::read_to_string(layout.root.join("report.tex")).unwrap(),
            leftover
        );

        let hold = hold_siblings(&layout.spec("keep/report.qmd", "pdf", false))
            .unwrap()
            .unwrap();
        std::fs::write(layout.root.join("keep/report.tex"), "% fresh\n").unwrap();
        drop(hold);
        assert_eq!(
            std::fs::read_to_string(layout.root.join("keep/report.tex")).unwrap(),
            "% fresh\n"
        );
    }

    #[test]
    fn only_a_quarto_project_file_counts_as_a_project() {
        let bare = Layout::new(&["_metadata.yml", "a/main.qmd"]);
        assert!(!in_quarto_project(
            &bare.root,
            &bare.root.join("a/main.qmd")
        ));
        let project = Layout::new(&["_quarto.yml", "a/main.qmd"]);
        assert!(in_quarto_project(
            &project.root,
            &project.root.join("a/main.qmd")
        ));
    }

    const REFUSAL_LOG: &str = "ERROR: The --output-dir flag can only be used when rendering projects.\n\nStack trace:\n    at validateDocumentRenderFlags\n";

    #[test]
    fn quartos_project_refusal_renders_the_file_as_a_plain_document() {
        let layout = Layout::new(&["_quarto.yml", "paper/main.qmd"]);
        let mut spec = layout.spec("paper/main.qmd", "typst", false);
        spec.args.extend(["-M".to_owned(), "x:y".to_owned()]);
        let fallback = document_render_spec(&spec, REFUSAL_LOG, Some(1)).unwrap();
        assert!(!fallback.args.iter().any(|arg| arg == "--output-dir"));
        assert_eq!(
            flag_value(&fallback.args, "--output"),
            Some("_oleafly_entry.pdf")
        );
        assert_eq!(fallback.args.len(), spec.args.len() - 2);
        assert_eq!(fallback.working_dir, layout.root.join("paper"));
        assert!(!fallback.args.iter().any(|arg| arg == EMBED_RESOURCES));
    }

    #[test]
    fn only_that_refusal_on_a_failed_run_starts_the_plain_document_render() {
        let layout = Layout::new(&["main.qmd"]);
        let spec = layout.spec("main.qmd", "typst", false);
        assert_eq!(document_render_spec(&spec, REFUSAL_LOG, Some(0)), None);
        assert_eq!(document_render_spec(&spec, "ERROR: other\n", Some(1)), None);
        let second = document_render_spec(&spec, REFUSAL_LOG, Some(1)).unwrap();
        assert_eq!(document_render_spec(&second, REFUSAL_LOG, Some(1)), None);
    }

    #[test]
    fn a_plain_document_render_of_html_stays_a_single_file() {
        let layout = Layout::new(&["_quarto.yml", "paper/main.qmd"]);
        let mut spec = layout.spec("paper/main.qmd", "html", true);
        spec.artifacts.html = Some(layout.html("paper/main.qmd"));
        let fallback = document_render_spec(&spec, REFUSAL_LOG, Some(1)).unwrap();
        assert!(fallback
            .args
            .windows(2)
            .any(|pair| pair == ["-M", EMBED_RESOURCES]));

        let mut exported = spec.clone();
        embed_html_output(
            &mut exported,
            &layout.root.join("build"),
            &layout.root.join("paper/main.qmd"),
        );
        let fallback = document_render_spec(&exported, REFUSAL_LOG, Some(1)).unwrap();
        let embedded = fallback
            .args
            .iter()
            .filter(|arg| *arg == EMBED_RESOURCES)
            .count();
        assert_eq!(embedded, 1);
    }

    #[test]
    fn the_rendered_file_moves_into_the_build_folder() {
        let layout = Layout::new(&["_quarto.yml", "paper/main.qmd"]);
        let mut spec = layout.spec("paper/main.qmd", "html", true);
        let target = layout.html("paper/main.qmd");
        spec.artifacts.html = Some(target.clone());
        let rendered = layout.root.join("paper").join("_oleafly_entry.html");
        std::fs::write(&rendered, "page").unwrap();
        collect_document_render(&spec).unwrap();
        assert_eq!(std::fs::read_to_string(&target).unwrap(), "page");
        assert!(!rendered.exists());
        collect_document_render(&spec).unwrap();
        assert_eq!(std::fs::read_to_string(&target).unwrap(), "page");

        let mut docx = layout.spec("paper/main.qmd", "docx", false);
        let name = "_oleafly_entry.docx";
        docx.args.iter_mut().for_each(|arg| {
            if arg == "_oleafly_entry.pdf" {
                *arg = name.to_owned();
            }
        });
        std::fs::write(layout.root.join("paper").join(name), "word").unwrap();
        collect_document_render(&docx).unwrap();
        assert_eq!(
            std::fs::read_to_string(layout.root.join("build").join(name)).unwrap(),
            "word"
        );
    }

    #[test]
    fn windows_paths_stay_as_given_so_a_mapped_drive_never_becomes_a_network_path() {
        assert_eq!(
            real_folder(Path::new("relative/./paper"), true),
            Path::new("relative/paper")
        );
    }

    #[test]
    fn a_folder_that_does_not_exist_yet_keeps_its_real_parent() {
        let project = tempfile::tempdir().unwrap();
        let real = project.path().canonicalize().unwrap();
        assert_eq!(
            real_folder(&project.path().join("a").join("b"), false),
            real.join("a").join("b")
        );
    }

    #[cfg(unix)]
    #[test]
    fn a_linked_project_path_gives_quarto_real_paths_everywhere() {
        let layout = Layout::new(&["paper/main.qmd"]);
        let alias = layout.root.parent().unwrap().join("alias");
        std::os::unix::fs::symlink(&layout.root, &alias).unwrap();
        let spec = QuartoRun {
            quarto: layout.root.parent().unwrap().join("quarto"),
            input: alias.join("paper").join("main.qmd"),
            out_dir: alias.join("build"),
            project_dir: alias.clone(),
            output: QuartoTarget {
                format: "typst".to_owned(),
                html: false,
            },
            extension: None,
            allow_code: true,
        }
        .spec(
            EngineArtifacts {
                output_dir: alias.join("build"),
                pdf: None,
                log: None,
                synctex: None,
                html: None,
            },
            None,
        )
        .unwrap();
        let real_input = layout.root.join("paper").join("main.qmd");
        let real_out = layout.root.join("build");
        assert_eq!(spec.working_dir, layout.root.join("paper"));
        assert_eq!(spec.args[1], real_input.to_string_lossy());
        assert!(spec
            .args
            .windows(2)
            .any(|pair| pair[0] == "--output-dir" && pair[1] == real_out.to_string_lossy()));
    }

    async fn run_real(quarto: &Path, spec: &EngineCompileSpec) -> (String, Option<i32>) {
        super::super::run_supervised_process_with_environment(
            quarto,
            &spec.args,
            &spec.working_dir,
            None,
            spec.environment.time_limit(),
            None,
            &spec.environment,
        )
        .await
        .unwrap()
    }

    fn real_spec(
        quarto: &Path,
        project: &Path,
        input: PathBuf,
        format: &str,
        html: bool,
    ) -> EngineCompileSpec {
        let out_dir = project.join("build");
        std::fs::create_dir_all(&out_dir).unwrap();
        QuartoRun {
            quarto: quarto.to_owned(),
            input,
            out_dir: out_dir.clone(),
            project_dir: project.to_owned(),
            output: QuartoTarget {
                format: format.to_owned(),
                html,
            },
            extension: None,
            allow_code: false,
        }
        .spec(
            EngineArtifacts {
                output_dir: out_dir,
                pdf: None,
                log: None,
                synctex: None,
                html: None,
            },
            None,
        )
        .unwrap()
    }

    #[tokio::test]
    async fn a_real_quarto_run_leaves_the_files_beside_the_document_alone() {
        let Some(quarto) = crate::program_locator::locate_native("quarto") else {
            return;
        };
        let layout = Layout::new(&["paper/report.qmd", "paper/report.pdf"]);
        let input = layout.root.join("paper").join("report.qmd");
        let report = layout.root.join("paper").join("report.pdf");
        std::fs::write(&input, "---\nformat: typst\n---\n\nHello.\n").unwrap();
        std::fs::write(&report, "mine").unwrap();
        let spec = real_spec(&quarto.path, &layout.root, input, "typst", false);
        let hold = hold_siblings(&spec).unwrap();
        let (log, code) = run_real(&quarto.path, &spec).await;
        drop(hold);
        assert_eq!(code, Some(0), "{log}");
        assert!(
            layout.root.join("build/_oleafly_entry.pdf").is_file(),
            "{log}"
        );
        assert_eq!(std::fs::read_to_string(&report).unwrap(), "mine");
        assert!(!layout.root.join("paper").join("report.typ").exists());
    }

    #[tokio::test]
    async fn a_real_latex_run_restores_the_siblings_and_reports_dropped_characters() {
        let Some(quarto) = crate::program_locator::locate_native("quarto") else {
            return;
        };
        if crate::program_locator::locate_native("xelatex").is_none() {
            return;
        }
        let layout = Layout::new(&["report.qmd"]);
        let input = layout.root.join("report.qmd");
        std::fs::write(
            &input,
            "---\nformat:\n  pdf:\n    pdf-engine: xelatex\nlatex-auto-install: false\n---\n\nKorean 한글.\n",
        )
        .unwrap();
        std::fs::write(layout.root.join("report.log"), "my log").unwrap();
        std::fs::write(layout.root.join("report.pdf"), "my pdf").unwrap();
        let mut spec = real_spec(&quarto.path, &layout.root, input, "pdf", false);
        spec.args
            .extend(["-M".to_owned(), siblings::KEEP_AUX_METADATA.to_owned()]);
        let mut hold = hold_siblings(&spec).unwrap().unwrap();
        let (log, code) = run_real(&quarto.path, &spec).await;
        let warning = tex_log_glyph_warning(&spec);
        hold.set_succeeded(code == Some(0));
        drop(hold);
        assert_eq!(code, Some(0), "{log}");
        assert!(layout.root.join("build/_oleafly_entry.pdf").is_file());
        let warning = warning.unwrap();
        assert_eq!(warning.params["font"], KOREAN_FONT);
        assert!(warning.params["sample"].contains('한'));
        let read = |name: &str| std::fs::read_to_string(layout.root.join(name)).ok();
        assert_eq!(read("report.log").as_deref(), Some("my log"));
        assert_eq!(read("report.pdf").as_deref(), Some("my pdf"));
        assert_eq!(read("report.aux"), None);
        assert_eq!(read("report.tex"), None);
    }

    #[tokio::test]
    async fn a_real_working_file_from_an_earlier_compile_is_recognised_and_put_back() {
        let Some(quarto) = crate::program_locator::locate_native("quarto") else {
            return;
        };
        let layout = Layout::new(&["report.qmd"]);
        let input = layout.root.join("report.qmd");
        let leftover = layout.root.join("report.typ");
        std::fs::write(&input, "---\nformat: typst\n---\n\nHello.\n").unwrap();
        let mut earlier = real_spec(&quarto.path, &layout.root, input.clone(), "typst", false);
        earlier
            .args
            .extend(["-M".to_owned(), "keep-typ:true".to_owned()]);
        let (log, code) = run_real(&quarto.path, &earlier).await;
        assert_eq!(code, Some(0), "{log}");
        let written = std::fs::read_to_string(&leftover).unwrap();

        std::fs::write(&input, "---\nformat: typst\n---\n\nHello again.\n").unwrap();
        let spec = real_spec(&quarto.path, &layout.root, input.clone(), "typst", false);
        let source = std::fs::read_to_string(&input).unwrap();
        siblings::refuse_overwrite(
            &layout.root,
            &input,
            &spec.artifacts.output_dir,
            "typst",
            &source,
            &[],
        )
        .unwrap();
        let hold = hold_siblings(&spec).unwrap();
        let (log, code) = run_real(&quarto.path, &spec).await;
        drop(hold);
        assert_eq!(code, Some(0), "{log}");
        assert_eq!(std::fs::read_to_string(&leftover).unwrap(), written);
    }

    #[tokio::test]
    async fn a_real_quarto_project_under_a_hidden_folder_still_compiles() {
        let Some(quarto) = crate::program_locator::locate_native("quarto") else {
            return;
        };
        let layout = Layout::under(".library/project", &["_quarto.yml", "paper/main.qmd"]);
        std::fs::write(
            layout.root.join("_quarto.yml"),
            "project:\n  type: default\n",
        )
        .unwrap();
        let input = layout.root.join("paper").join("main.qmd");
        std::fs::write(&input, "---\nformat: typst\n---\n\nHello.\n").unwrap();
        let spec = real_spec(&quarto.path, &layout.root, input.clone(), "typst", false);
        let (log, code) = run_real(&quarto.path, &spec).await;
        assert_eq!(code, Some(1), "{log}");
        let fallback = document_render_spec(&spec, &log, code).unwrap();
        let (log, code) = run_real(&quarto.path, &fallback).await;
        assert_eq!(code, Some(0), "{log}");
        let mut with_target = fallback.clone();
        with_target.artifacts.pdf = Some(layout.root.join("build").join("_oleafly_entry.pdf"));
        collect_document_render(&with_target).unwrap();
        assert!(
            layout.root.join("build/_oleafly_entry.pdf").is_file(),
            "{log}"
        );
        assert!(!layout.root.join("paper/_oleafly_entry.pdf").exists());
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn a_real_quarto_run_through_a_linked_folder_writes_into_the_build_folder() {
        let Some(quarto) = crate::program_locator::locate_native("quarto") else {
            return;
        };
        let layout = Layout::new(&["_quarto.yml", "paper/main.qmd"]);
        std::fs::write(
            layout.root.join("_quarto.yml"),
            "project:\n  type: default\n",
        )
        .unwrap();
        let alias = layout.root.parent().unwrap().join("alias");
        std::os::unix::fs::symlink(&layout.root, &alias).unwrap();
        let input = alias.join("paper").join("main.qmd");
        std::fs::write(&input, "---\nformat: html\n---\n\nHello.\n").unwrap();
        let expected = html_artifact(&alias.join("build"), &input);
        let spec = real_spec(&quarto.path, &alias, input, "html", true);
        let (log, code) = run_real(&quarto.path, &spec).await;
        assert_eq!(code, Some(0), "{log}");
        assert!(expected.is_file(), "{log}");
        assert!(
            layout
                .root
                .join("build/paper/_oleafly_entry.html")
                .is_file(),
            "{log}"
        );
    }
}
