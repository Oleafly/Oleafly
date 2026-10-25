use std::io::Read;
use std::path::{Path, PathBuf};

use super::{
    CompileError, CompileOptions, CompileTarget, CompilerPrerequisite, ConversionExport,
    DocumentEngine, DocumentEngineId, EngineArtifacts, EngineCapabilities, EngineCompileSpec,
    EngineEnvironment, EngineExecutable, EngineFeature, EngineInput, FormattingProfile,
    SourcePreflightProfile, TemplateKind,
};
use crate::app_error::AppError;
use crate::notebook_toolchain::NotebookTool;

pub(super) struct QuartoEngine;
pub(super) static QUARTO_ENGINE: QuartoEngine = QuartoEngine;

pub(crate) const CODE_SKIPPED_CODE: &str = "notebook.code_skipped";
const SOURCE_LIMIT: u64 = 4 * 1024 * 1024;
const YAML_LIMIT: u64 = 256 * 1024;
const PROJECT_FILES: [&str; 4] = [
    "_metadata.yml",
    "_metadata.yaml",
    "_quarto.yml",
    "_quarto.yaml",
];
const EXTENSIONS_DIRECTORY: &str = "_extensions";
const EXECUTABLE_KEYS: [&str; 4] = ["filters", "shortcodes", "pre-render", "post-render"];
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
        let quarto = crate::notebook_toolchain::find_tool(NotebookTool::Quarto)
            .ok_or_else(|| String::from(AppError::new(NotebookTool::Quarto.missing_code())))?;
        let input = project_dir.join(main_document);
        let source = read_bounded(&input, SOURCE_LIMIT).unwrap_or_default();
        let yaml = project_yaml(project_dir, &input);
        let output = quarto_target(&source, &yaml);
        let mut artifacts = self.artifacts(out_dir, target);
        if output.html {
            artifacts.pdf = None;
            artifacts.html = Some(out_dir.join(format!("{}.html", crate::paths::ENTRY_STEM)));
        }
        let plan = QuartoRun {
            quarto,
            input,
            out_dir: out_dir.to_owned(),
            project_dir: project_dir.to_owned(),
            output,
            extension: None,
            allow_code: options.allow_shell_escape,
        };
        plan.spec(&source, &yaml, artifacts, options.source_date_epoch)
    }

    fn parse_errors(&self, log: &str) -> Vec<CompileError> {
        parse_quarto_log(log)
    }

    fn compile_notes(
        &self,
        spec: &EngineCompileSpec,
        options: &CompileOptions,
    ) -> Vec<CompileError> {
        if options.allow_shell_escape || !spec.args.iter().any(|arg| arg == "--no-execute") {
            return Vec::new();
        }
        let source = read_bounded(spec.input.path(), SOURCE_LIMIT).unwrap_or_default();
        if !has_executable_cells(&source) {
            return Vec::new();
        }
        vec![CompileError {
            message: "Code chunks were shown but not run, because code is off for this project."
                .into(),
            kind: "warning".into(),
            code: Some(CODE_SKIPPED_CODE.into()),
            ..CompileError::default()
        }]
    }
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
        source: &str,
        yaml: &[String],
        artifacts: EngineArtifacts,
        source_date_epoch: Option<u64>,
    ) -> Result<EngineCompileSpec, String> {
        reject_project_local(&self.quarto, &self.project_dir)?;
        if !self.allow_code {
            let root = self
                .project_dir
                .canonicalize()
                .unwrap_or_else(|_| self.project_dir.clone());
            if runs_project_code(source, yaml, &root, &self.input) {
                return Err(AppError::new("notebook.code_needed")
                    .param("engine", NotebookTool::Quarto.label())
                    .into());
            }
        }
        let extension = self.extension.unwrap_or(self.output.extension());
        let args = quarto_args(
            &self.input,
            &self.output.format,
            &format!("{}.{extension}", crate::paths::ENTRY_STEM),
            &self.out_dir,
            self.allow_code,
        );
        let mut environment = EngineEnvironment::inherited(source_date_epoch);
        for (name, value) in crate::notebook_toolchain::quarto_runtime_variables() {
            environment = environment.with_variable(name, value);
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
            working_dir: self.project_dir.clone(),
            environment,
        })
    }
}

pub(super) fn export_spec(
    project_dir: &Path,
    main_document: &str,
    format: &str,
    out_dir: &Path,
    allow_code: bool,
) -> Result<EngineCompileSpec, String> {
    let quarto = crate::notebook_toolchain::find_tool(NotebookTool::Quarto)
        .ok_or_else(|| String::from(AppError::new(NotebookTool::Quarto.missing_code())))?;
    let input = project_dir.join(main_document);
    let source = read_bounded(&input, SOURCE_LIMIT).unwrap_or_default();
    let yaml = project_yaml(project_dir, &input);
    let html = format == "html";
    let run = QuartoRun {
        quarto,
        input,
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
    let mut spec = run.spec(&source, &yaml, artifacts, None)?;
    if html {
        spec.args
            .extend(["-M".to_owned(), "embed-resources:true".to_owned()]);
    }
    Ok(spec)
}

pub(super) fn reject_project_local(tool: &Path, project_dir: &Path) -> Result<(), String> {
    let resolved_tool = tool.canonicalize().unwrap_or_else(|_| tool.to_path_buf());
    let resolved_project = project_dir
        .canonicalize()
        .unwrap_or_else(|_| project_dir.to_path_buf());
    if resolved_tool.starts_with(&resolved_project) {
        return Err("refusing to run a program stored inside the project".into());
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
    let file = std::fs::File::open(path).ok()?;
    let mut bytes = Vec::new();
    file.take(limit).read_to_end(&mut bytes).ok()?;
    let text = bytes.strip_prefix(&[0xEF, 0xBB, 0xBF]).unwrap_or(&bytes);
    Some(String::from_utf8_lossy(text).into_owned())
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

fn declares_hooks(text: &str) -> bool {
    text.lines().any(|line| {
        let key = line
            .trim_start()
            .trim_start_matches("- ")
            .trim_start_matches(['"', '\'']);
        EXECUTABLE_KEYS.iter().any(|name| {
            key.strip_prefix(name).is_some_and(|rest| {
                rest.trim_start_matches(['"', '\''])
                    .trim_start()
                    .starts_with(':')
            })
        })
    })
}

fn has_extensions(root: &Path, input: &Path) -> bool {
    project_directories(root, input)
        .iter()
        .any(|directory| directory.join(EXTENSIONS_DIRECTORY).exists())
}

pub(crate) fn inline_knitr(source: &str) -> bool {
    let mut fence: Option<usize> = None;
    for line in source.lines() {
        let trimmed = line.trim_start();
        let ticks = trimmed
            .chars()
            .take_while(|character| *character == '`')
            .count();
        if ticks >= 3 {
            match fence {
                Some(open) if ticks >= open && trimmed[ticks..].trim().is_empty() => fence = None,
                None => fence = Some(ticks),
                Some(_) => {}
            }
            continue;
        }
        if fence.is_some() {
            continue;
        }
        if line.contains("`r ") || line.contains("`{r}") || line.contains("`{r ") {
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

pub(crate) fn runs_project_code(
    source: &str,
    project_yaml: &[String],
    project_dir: &Path,
    input: &Path,
) -> bool {
    front_matter(source).is_some_and(declares_hooks)
        || project_yaml.iter().any(|text| declares_hooks(text))
        || has_extensions(project_dir, input)
        || inline_knitr(source)
}

fn strip_ansi(line: &str) -> String {
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

fn quarto_explanation(message: &str) -> Option<&'static str> {
    let lower = message.to_ascii_lowercase();
    if lower.contains("no tex installation") || lower.contains("no tex distribution") {
        return Some("This format needs LaTeX. Install TinyTeX from Settings > Engines > LaTeX, or switch the document to format: typst, which needs no TeX.");
    }
    if lower.contains("there is no package called") {
        return Some("An R package this document needs is missing. Install it in R, for example with install.packages(), then compile again.");
    }
    if lower.contains("jupyter is not available") || lower.contains("no module named 'jupyter") {
        return Some("Quarto needs Jupyter in the Python it uses. Install it with python3 -m pip install jupyter, then compile again.");
    }
    if lower.contains("no valid input files") {
        return Some("Quarto could not read the main document. Check that it is a .qmd or .Rmd file inside the project.");
    }
    None
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
    CompileError {
        explanation: quarto_explanation(&message).map(str::to_owned),
        message,
        kind: "error".into(),
        ..CompileError::default()
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
    (line.starts_with("Error in ") || line.starts_with("Error: ")).then(|| error(line))
}

pub(crate) fn parse_quarto_log(log: &str) -> Vec<CompileError> {
    let lines: Vec<String> = log.lines().map(strip_ansi).collect();
    let mut errors: Vec<CompileError> = Vec::new();
    let mut yaml_file: Option<String> = None;
    let mut index = 0;
    while index < lines.len() && errors.len() < MAX_ERRORS {
        let line = lines[index].trim();
        index += 1;
        if line.is_empty() {
            continue;
        }
        if let Some(message) = line.strip_prefix("ERROR:") {
            let message = message.trim();
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
        errors.extend(failure_line(line));
    }
    let mut seen = std::collections::HashSet::new();
    errors.retain(|error| seen.insert((error.kind.clone(), error.message.clone(), error.line)));
    errors.sort_by_key(|error| error.kind != "error");
    errors
}

#[cfg(test)]
mod tests {
    use super::*;

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
    fn inline_r_code_is_found_outside_code_blocks_only() {
        assert!(inline_knitr("The mean is `r mean(x)`.\n"));
        assert!(inline_knitr("The mean is `{r} mean(x)`.\n"));
        assert!(!inline_knitr("```{r}\nx <- 1\n```\n"));
        assert!(!inline_knitr(
            "```markdown\nThe mean is `r mean(x)`.\n```\n"
        ));
        assert!(!inline_knitr("Use `python` here.\n"));
    }

    #[test]
    fn filters_and_scripts_mean_the_project_runs_code() {
        assert!(declares_hooks("title: A\nfilters:\n  - lua/hook.lua\n"));
        assert!(declares_hooks("format:\n  html:\n    filters: [x.lua]\n"));
        assert!(declares_hooks("project:\n  pre-render: setup.py\n"));
        assert!(declares_hooks("\"shortcodes\": [a.lua]\n"));
        assert!(!declares_hooks("title: Filters for water\nformat: pdf\n"));
        let directory = tempfile::tempdir().unwrap();
        let input = directory.path().join("paper").join("main.qmd");
        std::fs::create_dir_all(input.parent().unwrap()).unwrap();
        std::fs::write(&input, "# Paper\n").unwrap();
        assert!(!runs_project_code(
            "# Paper\n",
            &[],
            directory.path(),
            &input
        ));
        std::fs::create_dir(directory.path().join("_extensions")).unwrap();
        assert!(runs_project_code(
            "# Paper\n",
            &[],
            directory.path(),
            &input
        ));
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
    fn tex_errors_from_the_pdf_step_are_errors() {
        let errors = parse_quarto_log("! LaTeX Error: File `fancy.sty' not found.\n");
        assert_eq!(errors.len(), 1);
        assert_eq!(
            errors[0].message,
            "LaTeX Error: File `fancy.sty' not found."
        );
    }
}
