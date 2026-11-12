use serde::Serialize;
use std::path::{Path, PathBuf};
use tauri::Emitter;

use crate::proc::{isolate_process_tree, terminate_process_tree, NoConsole};
use oleafly_core::tex_failure::{denied_shell_escape_feature, DeniedShellEscape};
#[cfg(test)]
use oleafly_core::tex_failure::{log_refused_a_shell_command, runsystem_statuses};
use oleafly_core::tex_outputs::{
    bibliography_above_main_error, jobname_bibliography_warning, latexmk_biber_mismatch_error,
    nested_input_error, seed_shipped_bibliography, shipped_bibliography, shipped_bibliography_note,
    unbuilt_index_warnings, unicode_engine_error,
};

mod calepin;
mod quarto;
mod typst_diagnostics;

pub(crate) use quarto::html_artifact as quarto_html_artifact;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DocumentEngineId {
    Latex,
    Latexmk,
    Typst,
    Markdown,
    Quarto,
    Calepin,
}

impl DocumentEngineId {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Latex => "latex",
            Self::Latexmk => "latexmk",
            Self::Typst => "typst",
            Self::Markdown => "markdown",
            Self::Quarto => "quarto",
            Self::Calepin => "calepin",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum FormattingProfile {
    Latex,
    Typst,
    Markdown,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum SourcePreflightProfile {
    Latex,
    Typst,
    None,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum EngineFeature {
    Citations,
    DocumentIndex,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ConversionExport {
    Docx,
    Html,
    Md,
    Txt,
    Pptx,
    Epub,
    Typst,
    Tex,
}

impl ConversionExport {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Docx => "docx",
            Self::Html => "html",
            Self::Md => "md",
            Self::Txt => "txt",
            Self::Pptx => "pptx",
            Self::Epub => "epub",
            Self::Typst => "typst",
            Self::Tex => "tex",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum TemplateKind {
    Document,
    Image,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum CompilerPrerequisite {
    Pandoc,
    SystemTex,
    Quarto,
    Calepin,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct EngineCapabilities {
    pub produces_pdf: bool,
    pub supports_synctex: bool,
    pub supports_offline: bool,
    pub supports_isolated_compile: bool,
    pub formatting_profile: FormattingProfile,
    pub source_preflight_profile: SourcePreflightProfile,
    pub features: &'static [EngineFeature],
    pub conversion_exports: &'static [ConversionExport],
    pub template_kinds: &'static [TemplateKind],
    pub compiler_prerequisite: Option<CompilerPrerequisite>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct EngineDescriptor {
    pub id: String,
    pub label: String,
    pub source_format: String,
    pub main_document: String,
    pub source_extensions: Vec<String>,
    pub capabilities: EngineCapabilities,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tex_flavor: Option<String>,
    pub allow_shell_escape: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub typst_version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub typst_resolved: Option<TypstResolvedDescriptor>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub typst_missing: Option<String>,
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub typst_vendor_packages: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub typst_options: Option<crate::typst_options::TypstOptionsDescriptor>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub notebook_output: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct TypstResolvedDescriptor {
    pub version: String,
    pub source: oleafly_core::typst_toolchain::TypstSource,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EngineCompileSpec {
    pub executable: EngineExecutable,
    pub args: Vec<String>,
    pub input: EngineInput,
    pub artifacts: EngineArtifacts,
    pub working_dir: PathBuf,
    pub environment: EngineEnvironment,
}

impl EngineCompileSpec {
    /// Where the engine process starts. `working_dir` stays the folder that
    /// paths in its log and its helper tools resolve against.
    fn launch_dir(&self) -> &Path {
        self.environment
            .launch_dir
            .as_deref()
            .unwrap_or(&self.working_dir)
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct EngineEnvironment {
    variables: Vec<(String, String)>,
    scratch: Option<std::sync::Arc<oleafly_core::EngineScratch>>,
    project_root: Option<PathBuf>,
    time_limit: Option<std::time::Duration>,
    stdin: Option<String>,
    launch_dir: Option<PathBuf>,
}

impl EngineEnvironment {
    fn with_time_limit(mut self, limit: std::time::Duration) -> Self {
        self.time_limit = Some(limit);
        self
    }

    fn with_project_root(mut self, project_root: &Path) -> Self {
        self.project_root = Some(project_root.to_owned());
        self
    }

    fn with_stdin(mut self, text: String) -> Self {
        self.stdin = Some(text);
        self
    }

    fn time_limit(&self) -> std::time::Duration {
        self.time_limit.unwrap_or(COMPILE_TIMEOUT)
    }

    fn build_lock_stale_after(&self) -> std::time::Duration {
        oleafly_core::compile_limit::extended_limit(self.time_limit()) + DIR_LOCK_SLACK
    }

    fn inherited(source_date_epoch: Option<u64>) -> Self {
        let variables = source_date_epoch
            .map(|value| vec![("SOURCE_DATE_EPOCH".into(), value.to_string())])
            .unwrap_or_default();
        Self {
            variables,
            ..Self::default()
        }
    }

    fn with_variable(mut self, name: &str, value: String) -> Self {
        self.variables.push((name.to_owned(), value));
        self
    }

    fn in_scratch(mut self, scratch: oleafly_core::EngineScratch, project_root: &Path) -> Self {
        let value = scratch.path().to_string_lossy().into_owned();
        for name in oleafly_core::TEMP_DIRECTORY_VARIABLES {
            self.variables.push((name.to_owned(), value.clone()));
        }
        self.scratch = Some(std::sync::Arc::new(scratch));
        self.project_root = Some(project_root.to_owned());
        self
    }

    /// Tectonic looks for `./tectonic-biber` in its working directory before it
    /// reads PATH, so it must not start inside the project it compiles.
    fn launched_from(mut self, scratch: oleafly_core::EngineScratch, project_root: &Path) -> Self {
        self.launch_dir = Some(scratch.path().to_owned());
        self.scratch = Some(std::sync::Arc::new(scratch));
        self.project_root = Some(project_root.to_owned());
        self
    }

    fn path_excluded_root<'a>(&'a self, working_dir: &'a Path) -> &'a Path {
        self.project_root.as_deref().unwrap_or(working_dir)
    }

    pub(crate) fn variables(&self) -> &[(String, String)] {
        &self.variables
    }

    fn set_bibtex_search_entry(&mut self, entry: &str) {
        self.variables
            .retain(|(name, _)| !oleafly_core::BIBTEX_SEARCH_VARIABLES.contains(&name.as_str()));
        for (name, value) in oleafly_core::bibtex_search_environment(entry) {
            self.variables.push((name.to_owned(), value));
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum EngineExecutable {
    BundledSidecar(&'static str),
    ExternalPath(PathBuf),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum EngineInput {
    Direct(PathBuf),
    Generated { path: PathBuf, content: String },
}

impl EngineInput {
    fn path(&self) -> &Path {
        match self {
            Self::Direct(path) | Self::Generated { path, .. } => path,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EngineArtifacts {
    pub output_dir: PathBuf,
    pub pdf: Option<PathBuf>,
    pub log: Option<PathBuf>,
    pub synctex: Option<PathBuf>,
    pub html: Option<PathBuf>,
}

#[derive(Debug, Clone, Copy)]
pub enum CompileTarget<'a> {
    Main {
        main_document: &'a str,
    },
    Isolated {
        source_path: &'a Path,
        output_stem: &'a str,
    },
}

pub trait DocumentEngine: Sync {
    fn id(&self) -> DocumentEngineId;
    fn capabilities(&self) -> EngineCapabilities;
    fn accepts_metadata_name(&self, name: &str) -> bool;
    fn source_extensions(&self) -> &'static [&'static str];
    fn accepts_main_document(&self, main_document: &str) -> bool;
    fn artifacts(&self, out_dir: &Path, target: CompileTarget<'_>) -> EngineArtifacts;
    fn compile_spec(
        &self,
        out_dir: &Path,
        project_dir: &Path,
        target: CompileTarget<'_>,
        options: CompileOptions,
    ) -> Result<EngineCompileSpec, String>;
    fn parse_errors(&self, log: &str) -> Vec<CompileError>;
    fn compile_notes(
        &self,
        _spec: &EngineCompileSpec,
        _options: &CompileOptions,
        _log: &str,
    ) -> Vec<CompileError> {
        Vec::new()
    }
}

struct LatexEngine;
static LATEX_ENGINE: LatexEngine = LatexEngine;

struct LatexmkEngine;
static LATEXMK_ENGINE: LatexmkEngine = LatexmkEngine;

struct TypstEngine;
static TYPST_ENGINE: TypstEngine = TypstEngine;

struct MarkdownEngine;
static MARKDOWN_ENGINE: MarkdownEngine = MarkdownEngine;

impl DocumentEngine for LatexEngine {
    fn id(&self) -> DocumentEngineId {
        DocumentEngineId::Latex
    }

    fn capabilities(&self) -> EngineCapabilities {
        EngineCapabilities {
            produces_pdf: true,
            supports_synctex: true,
            supports_offline: true,
            supports_isolated_compile: true,
            formatting_profile: FormattingProfile::Latex,
            source_preflight_profile: SourcePreflightProfile::Latex,
            features: &[EngineFeature::Citations, EngineFeature::DocumentIndex],
            conversion_exports: &[
                ConversionExport::Docx,
                ConversionExport::Html,
                ConversionExport::Md,
                ConversionExport::Txt,
                ConversionExport::Pptx,
                ConversionExport::Epub,
                ConversionExport::Typst,
            ],
            template_kinds: &[TemplateKind::Document, TemplateKind::Image],
            compiler_prerequisite: None,
        }
    }

    fn accepts_metadata_name(&self, name: &str) -> bool {
        matches!(
            name.trim().to_ascii_lowercase().as_str(),
            "" | "latex" | "tex" | "tectonic" | "xetex" | "luatex"
        )
    }

    fn accepts_main_document(&self, main_document: &str) -> bool {
        Path::new(main_document).extension().is_some_and(|ext| {
            self.source_extensions()
                .iter()
                .any(|known| ext.eq_ignore_ascii_case(known))
        })
    }

    fn source_extensions(&self) -> &'static [&'static str] {
        &["tex", "ltx", "latex"]
    }

    fn artifacts(&self, out_dir: &Path, target: CompileTarget<'_>) -> EngineArtifacts {
        let stem = match target {
            CompileTarget::Main { .. } => crate::paths::ENTRY_STEM,
            CompileTarget::Isolated { output_stem, .. } => output_stem,
        };
        EngineArtifacts {
            output_dir: out_dir.to_owned(),
            pdf: Some(out_dir.join(format!("{stem}.pdf"))),
            log: Some(out_dir.join(format!("{stem}.log"))),
            synctex: Some(out_dir.join(format!("{stem}.synctex.gz"))),
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
        let input = match target {
            CompileTarget::Main { main_document } => {
                validate_latex_main_document(main_document)?;
                let shipped = shipped_bibliography(project_dir, main_document);
                EngineInput::Generated {
                    path: out_dir.join(crate::paths::ENTRY_TEX),
                    content: oleafly_core::engine_spec::latex_entry_source_with(
                        main_document,
                        shipped.as_deref(),
                        !options.offline,
                    )
                    .map_err(|error| error.to_string())?,
                }
            }
            CompileTarget::Isolated { source_path, .. } => {
                EngineInput::Direct(source_path.to_owned())
            }
        };
        let artifacts = self.artifacts(out_dir, target);
        let scratch = oleafly_core::EngineScratch::create(&engine_scratch_bases(out_dir)).map_err(
            |error| format!("Oleafly could not create a temporary folder for Tectonic: {error}"),
        )?;
        let environment = EngineEnvironment::inherited(options.source_date_epoch)
            .launched_from(scratch, project_dir);
        let tex_defaults = out_dir.join(oleafly_core::engine_spec::TEX_DEFAULTS_DIR);
        let mut search_paths = vec![project_dir];
        if !options.offline {
            search_paths.push(&tex_defaults);
        }
        let args = oleafly_core::engine_spec::tectonic_args(
            out_dir,
            &search_paths,
            input.path(),
            Some(&tex_bundle_url()),
            engine_flags(&options),
        )
        .into_iter()
        .map(|arg| arg.to_string_lossy().into_owned())
        .collect();
        Ok(EngineCompileSpec {
            executable: EngineExecutable::BundledSidecar("tectonic"),
            args,
            input,
            artifacts,
            working_dir: project_dir.to_owned(),
            environment,
        })
    }

    fn parse_errors(&self, log: &str) -> Vec<CompileError> {
        parse_tectonic_log_errors(log)
    }
}

pub type LatexmkFlavor = oleafly_core::TexFlavor;

#[cfg(test)]
fn resolve_latexmk_flavor(pinned: Option<LatexmkFlavor>, source_head: &str) -> LatexmkFlavor {
    pinned.unwrap_or_else(|| detect_latexmk_flavor(source_head))
}

#[cfg(test)]
fn detect_tex_program_magic(source: &str) -> Option<LatexmkFlavor> {
    // TeXShop/latexmk convention: `% !TeX program = xelatex` near the top.
    oleafly_core::tex_program_flavor(source)
}

#[cfg(test)]
fn detect_latexmk_flavor(source: &str) -> LatexmkFlavor {
    oleafly_core::detect_tex_flavor(source)
}

fn read_source_head(path: &Path) -> String {
    use std::io::Read;
    const MAX_SNIFF_BYTES: u64 = 512 * 1024;
    let Ok(file) = std::fs::File::open(path) else {
        return String::new();
    };
    let mut bytes = Vec::new();
    let _ = file.take(MAX_SNIFF_BYTES).read_to_end(&mut bytes);
    String::from_utf8_lossy(&bytes).into_owned()
}

fn shell_escape_denial(denied: DeniedShellEscape) -> CompileError {
    CompileError {
        message: format!(
            "{} needs to run an outside program, which this project does not allow.",
            denied.feature()
        ),
        kind: "error".into(),
        explanation: Some(format!(
            "{} To allow it, click \"Allow external commands\" in the banner above the editor. Only do this if you trust every file in the project. LaTeX can then run any program with your permissions, and a program it starts may keep running after you stop the compile.",
            denied.reason()
        )),
        code: Some(denied.code().into()),
        ..Default::default()
    }
}

fn pythontex_job_present(log: &str, code_path: &Path) -> bool {
    let metadata = match std::fs::symlink_metadata(code_path) {
        Ok(metadata) => metadata,
        Err(_) => return false,
    };
    if !metadata.is_file() || metadata.file_type().is_symlink() {
        return false;
    }
    let log = log.to_ascii_lowercase();
    log.contains("pythontex.sty")
        || log.contains("package pythontex")
        || log.contains("run pythontex")
}

fn clear_pythontex_code_artifact(out_dir: &Path, stem: &str) -> Result<PathBuf, String> {
    let path = out_dir.join(format!("{stem}.pytxcode"));
    match std::fs::symlink_metadata(&path) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(path),
        Err(error) => Err(format!("failed to inspect stale PythonTeX code: {error}")),
        Ok(metadata) if metadata.is_dir() && !metadata.file_type().is_symlink() => {
            Err("PythonTeX code artifact is unexpectedly a directory".into())
        }
        Ok(_) => {
            std::fs::remove_file(&path)
                .map_err(|error| format!("failed to clear stale PythonTeX code: {error}"))?;
            Ok(path)
        }
    }
}

fn pythontex_tool_for_latexmk(latexmk: &Path) -> Option<PathBuf> {
    let candidate = latexmk.parent()?.join(crate::tex_distro::exe("pythontex"));
    candidate.is_file().then_some(candidate)
}

fn pythontex_job_arg(
    project_dir: &Path,
    out_dir: &Path,
    stem: &str,
    owned_output: bool,
) -> Result<String, String> {
    if let Ok(relative) = out_dir.strip_prefix(project_dir) {
        return Ok(relative.join(stem).to_string_lossy().into_owned());
    }
    if owned_output {
        return Ok(out_dir.join(stem).to_string_lossy().into_owned());
    }
    Err("PythonTeX output must stay inside the project directory".to_string())
}

fn pythontex_args(
    project_dir: &Path,
    out_dir: &Path,
    stem: &str,
    owned_output: bool,
) -> Result<Vec<String>, String> {
    Ok(vec![
        "--error-exit-code".into(),
        "true".into(),
        pythontex_job_arg(project_dir, out_dir, stem, owned_output)?,
    ])
}

fn latexmk_absolute_path_arg(path: &Path) -> Result<String, String> {
    latexmk_absolute_path_text(path, cfg!(windows))
        .ok_or_else(|| crate::app_error::AppError::new("tex.latexmk_build_path").into())
}

/// latexmk runs on Perl, which opens paths through the ANSI code page on
/// Windows, so a build folder outside the project whose path isn't ASCII (Oleafly
/// data under C:\Users\Jörg) came out mangled and every compile stopped. The
/// folder's 8.3 short spelling is ASCII when the volume keeps short names.
fn latexmk_owned_path_arg(path: &Path) -> Result<String, String> {
    owned_path_text(
        path,
        cfg!(windows),
        &crate::project_availability::short_spelling,
    )
    .ok_or_else(|| crate::app_error::AppError::new("tex.latexmk_build_path").into())
}

fn owned_path_text(
    path: &Path,
    windows: bool,
    short_spelling: &dyn Fn(&Path) -> Option<PathBuf>,
) -> Option<String> {
    let text = latexmk_absolute_path_text(path, windows)?;
    if !windows || text.is_ascii() {
        return Some(text);
    }
    // A file the compile writes later has no short name yet, so shorten the
    // nearest folder that exists and keep the names below it.
    let mut below = Vec::new();
    let mut existing = path;
    let short = loop {
        if let Some(short) = short_spelling(existing) {
            break short;
        }
        below.push(existing.file_name()?);
        existing = existing.parent()?;
    };
    let shortened = below
        .into_iter()
        .rev()
        .fold(short, |folder, name| folder.join(name));
    latexmk_absolute_path_text(&shortened, windows).filter(|text| text.is_ascii())
}

fn windows_network_path(path: &Path) -> bool {
    crate::project_availability::without_verbatim_prefix(path)
        .to_string_lossy()
        .starts_with(r"\\")
}

fn latexmk_path_arg(
    project_dir: &Path,
    path: &Path,
    owned: Option<&Path>,
    role: &str,
) -> Result<String, String> {
    if let Ok(relative) = path.strip_prefix(project_dir) {
        return latexmk_relative_path_arg(relative);
    }
    match owned {
        Some(owned) if path.starts_with(owned) && !owned.starts_with(project_dir) => {
            latexmk_owned_path_arg(path)
        }
        _ => Err(format!(
            "latexmk {role} must stay inside the project directory"
        )),
    }
}

#[cfg(test)]
fn latexmk_args(
    out_dir: &Path,
    entry: &Path,
    stem: &str,
    flavor: LatexmkFlavor,
    options: CompileOptions,
) -> Result<Vec<String>, String> {
    let out_dir = latexmk_relative_path_arg(out_dir)?;
    let entry = latexmk_relative_path_arg(entry)?;
    Ok(latexmk_args_from(
        out_dir, entry, stem, flavor, options, "texlive",
    ))
}

fn latexmk_args_from(
    out_dir: String,
    entry: String,
    stem: &str,
    flavor: LatexmkFlavor,
    options: CompileOptions,
    distribution_kind: &str,
) -> Vec<String> {
    oleafly_core::engine_spec::latexmk_args(
        &out_dir,
        &entry,
        stem,
        flavor,
        engine_flags(&options),
        options.allow_shell_escape,
        distribution_kind,
    )
}

fn engine_flags(options: &CompileOptions) -> oleafly_core::engine_spec::EngineFlags {
    oleafly_core::engine_spec::EngineFlags {
        offline: options.offline,
        fast: options.fast,
        halt_on_error: options.halt_on_error,
    }
}

fn latexmk_relative_path_arg(path: &Path) -> Result<String, String> {
    oleafly_core::engine_spec::latexmk_relative_path_arg(path).map_err(|error| {
        if error.kind() == oleafly_core::ErrorKind::InvalidInput {
            crate::app_error::AppError::new("tex.latexmk_path_characters")
                .param("path", path.display())
                .into()
        } else {
            error.to_string()
        }
    })
}

use oleafly_core::engine_spec::latexmk_absolute_path_text;
#[cfg(test)]
use oleafly_core::engine_spec::shell_escape_arg;

fn latexmk_invocation(
    project_dir: &Path,
    out_dir: &Path,
    input_path: &Path,
    stem: &str,
    flavor: LatexmkFlavor,
    options: CompileOptions,
    distribution_kind: &str,
) -> Result<(Vec<String>, EngineEnvironment), String> {
    let owned = options.external_build.then_some(out_dir);
    if owned.is_some() && cfg!(windows) && windows_network_path(project_dir) {
        return Err(crate::app_error::AppError::new("tex.latexmk_network_folder").into());
    }
    let entry_arg = latexmk_path_arg(project_dir, input_path, owned, "input")?;
    let out_arg = latexmk_path_arg(project_dir, out_dir, owned, "output")?;
    let environment = if out_dir.starts_with(project_dir) {
        EngineEnvironment::inherited(options.source_date_epoch)
    } else {
        EngineEnvironment::inherited(options.source_date_epoch)
            .with_variable("TEXMFOUTPUT", out_arg.clone())
    };
    let args = latexmk_args_from(out_arg, entry_arg, stem, flavor, options, distribution_kind);
    Ok((args, environment))
}

#[cfg(unix)]
const BIBTEX_PROJECT_LINK: &str = "oleafly-project";

fn with_bibtex_search_path(mut spec: EngineCompileSpec) -> EngineCompileSpec {
    let working_dir = &spec.working_dir;
    let out_dir = &spec.artifacts.output_dir;
    if !oleafly_core::breaks_tex_search_path(working_dir) {
        return spec;
    }
    let entry = oleafly_core::bibtex_search_entry(working_dir, out_dir).or_else(|| {
        (!out_dir.starts_with(working_dir))
            .then(|| link_for_bibtex(out_dir, working_dir))
            .flatten()
    });
    if let Some(entry) = entry {
        spec.environment.set_bibtex_search_entry(&entry);
    }
    spec
}

#[cfg(unix)]
fn link_for_bibtex(out_dir: &Path, target: &Path) -> Option<String> {
    let link = out_dir.join(BIBTEX_PROJECT_LINK);
    if std::fs::read_link(&link).ok().as_deref() != Some(target) {
        if std::fs::symlink_metadata(&link).is_ok() {
            std::fs::remove_file(&link).ok()?;
        }
        std::fs::create_dir_all(out_dir).ok()?;
        std::os::unix::fs::symlink(target, &link).ok()?;
    }
    Some(BIBTEX_PROJECT_LINK.to_owned())
}

#[cfg(not(unix))]
fn link_for_bibtex(_out_dir: &Path, _target: &Path) -> Option<String> {
    None
}

impl DocumentEngine for LatexmkEngine {
    fn id(&self) -> DocumentEngineId {
        DocumentEngineId::Latexmk
    }

    fn capabilities(&self) -> EngineCapabilities {
        EngineCapabilities {
            produces_pdf: true,
            supports_synctex: true,
            // latexmk itself never touches the network; "offline" is simply
            // its normal mode, so the flag is accepted and has no effect.
            supports_offline: true,
            supports_isolated_compile: true,
            formatting_profile: FormattingProfile::Latex,
            source_preflight_profile: SourcePreflightProfile::Latex,
            features: &[EngineFeature::Citations, EngineFeature::DocumentIndex],
            conversion_exports: &[
                ConversionExport::Docx,
                ConversionExport::Html,
                ConversionExport::Md,
                ConversionExport::Txt,
                ConversionExport::Pptx,
                ConversionExport::Epub,
                ConversionExport::Typst,
            ],
            template_kinds: &[TemplateKind::Document, TemplateKind::Image],
            compiler_prerequisite: Some(CompilerPrerequisite::SystemTex),
        }
    }

    fn accepts_metadata_name(&self, name: &str) -> bool {
        name.trim().eq_ignore_ascii_case("latexmk")
    }

    fn accepts_main_document(&self, main_document: &str) -> bool {
        LATEX_ENGINE.accepts_main_document(main_document)
    }

    fn source_extensions(&self) -> &'static [&'static str] {
        LATEX_ENGINE.source_extensions()
    }

    fn artifacts(&self, out_dir: &Path, target: CompileTarget<'_>) -> EngineArtifacts {
        LATEX_ENGINE.artifacts(out_dir, target)
    }

    fn compile_spec(
        &self,
        out_dir: &Path,
        project_dir: &Path,
        target: CompileTarget<'_>,
        options: CompileOptions,
    ) -> Result<EngineCompileSpec, String> {
        let latexmk = usable_latexmk()?;
        let resolved_latexmk = latexmk.canonicalize().unwrap_or_else(|_| latexmk.clone());
        let resolved_project = project_dir
            .canonicalize()
            .unwrap_or_else(|_| project_dir.to_path_buf());
        if resolved_latexmk.starts_with(&resolved_project) {
            return Err("refusing to run a project-local latexmk executable".into());
        }
        // No generated wrapper: latexmk drives the real main document directly so
        // Biber, makeindex, and multi-pass logic all see the project's own jobs.
        // `-jobname` keeps every artifact on the same paths Tectonic uses.
        let (input_path, stem) = match target {
            CompileTarget::Main { main_document } => {
                validate_latex_main_document(main_document)?;
                (project_dir.join(main_document), crate::paths::ENTRY_STEM)
            }
            CompileTarget::Isolated {
                source_path,
                output_stem,
            } => (source_path.to_owned(), output_stem),
        };
        let flavor = options
            .latex_flavor
            .unwrap_or_else(|| oleafly_core::project_tex_flavor(project_dir, &input_path));
        require_dvi_toolchain(flavor, &latexmk)?;
        let (mut args, environment) = latexmk_invocation(
            project_dir,
            out_dir,
            &input_path,
            stem,
            flavor,
            options,
            &crate::tex_distro::distribution_kind_for_tool(&latexmk),
        )?;
        require_latex_compiler(flavor, &latexmk, &environment, project_dir)?;
        let artifacts = self.artifacts(out_dir, target);
        // latexmk's dependency database is not portable across TeX
        // distributions: after a distro switch it can report "Nothing to do"
        // while replaying the previous run's error. Force one full rebuild
        // (-gg) whenever the resolved latexmk binary differs from the one
        // that produced this build directory.
        if latexmk_binary_changed(out_dir, &latexmk) {
            args.insert(0, "-gg".into());
        }
        Ok(with_bibtex_search_path(EngineCompileSpec {
            executable: EngineExecutable::ExternalPath(latexmk),
            args,
            input: EngineInput::Direct(input_path),
            artifacts,
            working_dir: project_dir.to_owned(),
            environment,
        }))
    }

    fn parse_errors(&self, log: &str) -> Vec<CompileError> {
        parse_tex_log_errors(log)
    }
}

fn usable_latexmk() -> Result<PathBuf, String> {
    crate::tex_distro::resolve_latexmk()
        .or_else(|_| {
            crate::program_locator::refresh();
            crate::program_locator::wait_for_login_probe();
            crate::tex_distro::resolve_latexmk()
        })
        .map_err(|blocker| crate::tex_distro::blocker_error(blocker).into())
}

fn require_latex_compiler(
    flavor: LatexmkFlavor,
    latexmk: &Path,
    environment: &EngineEnvironment,
    project_dir: &Path,
) -> Result<(), String> {
    let path_env = crate::biber_toolchain::compile_path_env_for(
        latexmk,
        environment.path_excluded_root(project_dir),
    );
    match oleafly_core::engine_spec::latex_compiler_missing(flavor, &path_env) {
        None => Ok(()),
        Some(compiler) => Err(crate::tex_distro::blocker_error(
            crate::tex_distro::compiler_blocker(latexmk, flavor, compiler),
        )
        .into()),
    }
}

fn require_dvi_toolchain(flavor: LatexmkFlavor, latexmk: &Path) -> Result<(), String> {
    match oleafly_core::engine_spec::dvi_toolchain_missing(flavor, latexmk) {
        None => Ok(()),
        Some(compiler) => Err(japanese_compiler_error(flavor, compiler, latexmk)),
    }
}

fn japanese_compiler_error(flavor: LatexmkFlavor, compiler: &str, latexmk: &Path) -> String {
    let can_install = crate::tex_distro::distribution_for_tool(latexmk)
        .and_then(|distribution| distribution.tlmgr)
        .is_some_and(|tlmgr| crate::latex_engine::tlmgr_can_add_binaries(&tlmgr));
    if can_install {
        return crate::app_error::AppError::new("tex.japanese_compiler_installable")
            .param("compiler", compiler)
            .param(
                "packages",
                oleafly_core::engine_spec::dvi_toolchain_packages(flavor).join(","),
            )
            .into();
    }
    crate::tex_distro::blocker_error(crate::tex_distro::japanese_compiler_blocker(
        latexmk, compiler,
    ))
    .into()
}

use oleafly_core::engine_spec::{
    forget_latexmk_run, latexmk_binary_changed, record_latexmk_binary,
    restricted_miktex_shell_commands, MIKTEX_SHELL_COMMANDS_VARIABLE,
};

fn validate_latex_main_document(path: &str) -> Result<(), String> {
    oleafly_core::engine_spec::validate_latex_main_document(path).map_err(|_| {
        crate::app_error::AppError::new("tex.main_document_characters")
            .param("path", path)
            .into()
    })
}

impl DocumentEngine for TypstEngine {
    fn id(&self) -> DocumentEngineId {
        DocumentEngineId::Typst
    }

    fn capabilities(&self) -> EngineCapabilities {
        EngineCapabilities {
            produces_pdf: true,
            supports_synctex: true,
            supports_offline: true,
            supports_isolated_compile: false,
            formatting_profile: FormattingProfile::Typst,
            source_preflight_profile: SourcePreflightProfile::Typst,
            features: &[EngineFeature::Citations, EngineFeature::DocumentIndex],
            conversion_exports: &[
                ConversionExport::Tex,
                ConversionExport::Docx,
                ConversionExport::Html,
                ConversionExport::Md,
                ConversionExport::Txt,
                ConversionExport::Epub,
            ],
            template_kinds: &[TemplateKind::Document, TemplateKind::Image],
            compiler_prerequisite: None,
        }
    }

    fn accepts_metadata_name(&self, name: &str) -> bool {
        matches!(name.trim().to_ascii_lowercase().as_str(), "typst" | "typ")
    }

    fn source_extensions(&self) -> &'static [&'static str] {
        &["typ"]
    }

    fn accepts_main_document(&self, main_document: &str) -> bool {
        Path::new(main_document)
            .extension()
            .is_some_and(|extension| extension.eq_ignore_ascii_case("typ"))
    }

    fn artifacts(&self, out_dir: &Path, target: CompileTarget<'_>) -> EngineArtifacts {
        let stem = match target {
            CompileTarget::Main { .. } => crate::paths::ENTRY_STEM,
            CompileTarget::Isolated { output_stem, .. } => output_stem,
        };
        EngineArtifacts {
            output_dir: out_dir.to_owned(),
            pdf: Some(out_dir.join(format!("{stem}.pdf"))),
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
            return Err("Typst does not support isolated compilation".into());
        };
        let input = project_dir.join(main_document);
        let artifacts = self.artifacts(out_dir, target);
        let output = artifacts
            .pdf
            .as_ref()
            .ok_or_else(|| "Typst PDF artifact was not declared".to_string())?;
        let (executable, capabilities) = match options.typst.as_deref() {
            Some(resolved)
                if resolved.source != oleafly_core::typst_toolchain::TypstSource::Bundled =>
            {
                (
                    EngineExecutable::ExternalPath(resolved.path.clone()),
                    &resolved.capabilities,
                )
            }
            Some(resolved) => (
                EngineExecutable::BundledSidecar("typst"),
                &resolved.capabilities,
            ),
            None => (
                EngineExecutable::BundledSidecar("typst"),
                oleafly_core::typst_toolchain::capabilities_for(
                    &oleafly_core::typst_toolchain::bundled_typst_version().to_string(),
                ),
            ),
        };
        let mut package_flags = options
            .typst_packages
            .as_ref()
            .map(|packages| packages.compile_flags(capabilities))
            .unwrap_or_default();
        if let Some(settings) = &options.typst_settings {
            package_flags.extend(settings.compile_flags(capabilities));
        }
        if options.external_build && capabilities.supports_flag("--deps") {
            package_flags.push(oleafly_core::typst_toolchain::TypstCompileFlag::Deps(
                crate::typst_options::dependency_file(out_dir),
            ));
        }
        let args = oleafly_core::typst_toolchain::typst_compile_args(
            capabilities,
            &input,
            output,
            project_dir,
            oleafly_core::typst_toolchain::TypstDiagnosticFormat::Human,
            &package_flags,
        )
        .map_err(|error| error.to_string())?
        .into_iter()
        .map(|argument| argument.to_string_lossy().into_owned())
        .collect();
        let mut environment = EngineEnvironment::inherited(
            options
                .typst_settings
                .as_ref()
                .map_or(options.source_date_epoch, |settings| {
                    settings.source_date_epoch(options.source_date_epoch)
                }),
        );
        if let Some(packages) = &options.typst_packages {
            for (name, value) in packages.environment() {
                environment = environment.with_variable(name, value.to_string_lossy().into_owned());
            }
        }
        if options.offline {
            for (name, value) in crate::typst_packages::offline_environment() {
                environment = environment.with_variable(name, value.to_owned());
            }
        }
        Ok(EngineCompileSpec {
            executable,
            args,
            input: EngineInput::Direct(input),
            artifacts,
            working_dir: project_dir.to_owned(),
            environment,
        })
    }

    fn parse_errors(&self, log: &str) -> Vec<CompileError> {
        typst_diagnostics::parse_typst_errors(log)
    }
}

impl DocumentEngine for MarkdownEngine {
    fn id(&self) -> DocumentEngineId {
        DocumentEngineId::Markdown
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
            conversion_exports: &[
                ConversionExport::Docx,
                ConversionExport::Html,
                ConversionExport::Txt,
                ConversionExport::Pptx,
                ConversionExport::Epub,
                ConversionExport::Typst,
                ConversionExport::Tex,
            ],
            template_kinds: &[TemplateKind::Document],
            compiler_prerequisite: Some(CompilerPrerequisite::Pandoc),
        }
    }

    fn accepts_metadata_name(&self, name: &str) -> bool {
        matches!(
            name.trim().to_ascii_lowercase().as_str(),
            "markdown" | "md" | "pandoc"
        )
    }

    fn source_extensions(&self) -> &'static [&'static str] {
        &["md", "markdown"]
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

    fn artifacts(&self, out_dir: &Path, target: CompileTarget<'_>) -> EngineArtifacts {
        let stem = match target {
            CompileTarget::Main { .. } => crate::paths::ENTRY_STEM,
            CompileTarget::Isolated { output_stem, .. } => output_stem,
        };
        EngineArtifacts {
            output_dir: out_dir.to_owned(),
            pdf: Some(out_dir.join(format!("{stem}.pdf"))),
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
            return Err("Markdown does not support isolated compilation".into());
        };
        let pandoc = crate::project::find_pandoc()
            .ok_or_else(|| String::from(crate::app_error::AppError::new("tools.pandoc_missing")))?;
        let tectonic = find_bundled_tectonic().ok_or_else(||
            "Oleafly's bundled Tectonic PDF engine could not be located. Reinstall Oleafly, then compile again.".to_string()
        )?;
        let tools = MarkdownTools {
            pandoc: PathBuf::from(pandoc),
            tectonic,
            typst: find_bundled_typst(),
            scratch: pandoc_scratch(&engine_scratch_bases(out_dir))?,
        };
        markdown_compile_spec(self, out_dir, project_dir, main_document, tools, options)
    }

    fn parse_errors(&self, log: &str) -> Vec<CompileError> {
        parse_pandoc_diagnostics(log)
    }
}

pub fn engine_for(
    metadata_name: &str,
    main_document: &str,
) -> Result<&'static dyn DocumentEngine, String> {
    let engine: &'static dyn DocumentEngine = if LATEXMK_ENGINE.accepts_metadata_name(metadata_name)
    {
        &LATEXMK_ENGINE
    } else if LATEX_ENGINE.accepts_metadata_name(metadata_name) {
        &LATEX_ENGINE
    } else if TYPST_ENGINE.accepts_metadata_name(metadata_name) {
        &TYPST_ENGINE
    } else if MARKDOWN_ENGINE.accepts_metadata_name(metadata_name) {
        &MARKDOWN_ENGINE
    } else if quarto::QUARTO_ENGINE.accepts_metadata_name(metadata_name) {
        &quarto::QUARTO_ENGINE
    } else if calepin::CALEPIN_ENGINE.accepts_metadata_name(metadata_name) {
        &calepin::CALEPIN_ENGINE
    } else {
        return Err(format!(
            "unsupported document engine `{metadata_name}` for {main_document}"
        ));
    };
    if !engine.accepts_main_document(main_document) {
        return Err(format!(
            "engine `{}` cannot compile main document `{main_document}`",
            engine.id().as_str()
        ));
    }
    Ok(engine)
}

fn find_bundled_tectonic() -> Option<PathBuf> {
    let executable = if cfg!(windows) {
        "tectonic.exe"
    } else {
        "tectonic"
    };
    let current = std::env::current_exe().ok();
    let candidates = tectonic_sidecar_candidates(
        current.as_deref(),
        Path::new(env!("CARGO_MANIFEST_DIR")),
        executable,
    );
    candidates.into_iter().find(|path| path.is_file())
}

fn find_bundled_typst() -> Option<PathBuf> {
    let executable = if cfg!(windows) { "typst.exe" } else { "typst" };
    let current = std::env::current_exe().ok();
    let candidates = tectonic_sidecar_candidates(
        current.as_deref(),
        Path::new(env!("CARGO_MANIFEST_DIR")),
        executable,
    );
    candidates.into_iter().find(|path| path.is_file())
}

fn tectonic_sidecar_candidates(
    current_exe: Option<&Path>,
    manifest_dir: &Path,
    executable: &str,
) -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    if let Some(parent) = current_exe.and_then(Path::parent) {
        candidates.extend(
            oleafly_core::sidecar::bundled_tool_dirs(parent)
                .into_iter()
                .map(|folder| folder.join(executable)),
        );
    }
    candidates.push(manifest_dir.join("target/debug").join(executable));
    candidates.push(manifest_dir.join("target/release").join(executable));
    candidates
}

fn engine_scratch_bases(out_dir: &Path) -> oleafly_core::EngineScratchBases {
    let owned = crate::paths::oleafly_root()
        .ok()
        .map(|root| root.join(oleafly_core::ENGINE_TEMP_DIR));
    oleafly_core::EngineScratchBases::new(owned, out_dir)
}

fn pandoc_scratch(
    bases: &oleafly_core::EngineScratchBases,
) -> Result<oleafly_core::EngineScratch, String> {
    oleafly_core::EngineScratch::create(bases).map_err(pandoc_scratch_error)
}

fn pandoc_scratch_error(error: std::io::Error) -> String {
    format!("Oleafly could not create a temporary folder for Pandoc: {error}")
}

use oleafly_core::engine_spec::MARKDOWN_TYPST_VARIABLE;

struct MarkdownTools {
    pandoc: PathBuf,
    tectonic: PathBuf,
    typst: Option<PathBuf>,
    scratch: oleafly_core::EngineScratch,
}

fn markdown_compile_spec(
    engine: &MarkdownEngine,
    out_dir: &Path,
    project_dir: &Path,
    main_document: &str,
    tools: MarkdownTools,
    options: CompileOptions,
) -> Result<EngineCompileSpec, String> {
    let MarkdownTools {
        pandoc,
        tectonic,
        typst,
        scratch,
    } = tools;
    let target = CompileTarget::Main { main_document };
    let input = project_dir.join(main_document);
    let artifacts = engine.artifacts(out_dir, target);
    let output = artifacts
        .pdf
        .as_ref()
        .ok_or_else(|| "Markdown PDF artifact was not declared".to_string())?;
    let project = oleafly_core::plain_path(project_dir);
    let search_folders = oleafly_core::document_search_folders(&project, Path::new(main_document));
    let resources = scratch
        .pandoc_search_path(&project, &search_folders)
        .map_err(pandoc_scratch_error)?;
    oleafly_core::engine_spec::write_markdown_filters(scratch.path())
        .map_err(|error| format!("Oleafly could not prepare the Markdown filters: {error}"))?;
    let bibliographies: Vec<PathBuf> = discover_bibliographies(project_dir)?
        .into_iter()
        .map(PathBuf::from)
        .collect();
    let plain_output = oleafly_core::plain_path(output);
    let main = project.join(main_document);
    let bundle_url = tex_bundle_url();
    let args =
        oleafly_core::engine_spec::markdown_pdf_args(&oleafly_core::engine_spec::MarkdownPdfArgs {
            resource_argument: &resources.argument,
            tectonic: &tectonic,
            project: &project,
            search_folders: &search_folders,
            output: &plain_output,
            main: &main,
            bibliographies: &bibliographies,
            bundle_url: Some(&bundle_url),
            layout: oleafly_core::engine_spec::markdown_layout(&input),
        })
        .into_iter()
        .map(|arg| arg.to_string_lossy().into_owned())
        .collect();
    let mut environment = EngineEnvironment::inherited(options.source_date_epoch)
        .with_time_limit(oleafly_core::compile_limit::MARKDOWN_PDF_TIME_LIMIT);
    if let Some((name, value)) = resources.variable {
        environment = environment.with_variable(name, value.to_string_lossy().into_owned());
    }
    if let Some(typst) = typst {
        environment = environment.with_variable(
            MARKDOWN_TYPST_VARIABLE,
            typst.to_string_lossy().into_owned(),
        );
    }
    Ok(EngineCompileSpec {
        executable: EngineExecutable::ExternalPath(pandoc),
        args,
        input: EngineInput::Direct(input),
        artifacts,
        working_dir: scratch.path().to_owned(),
        environment: environment.in_scratch(scratch, project_dir),
    })
}

pub(crate) fn discover_bibliographies(project_dir: &Path) -> Result<Vec<String>, String> {
    let mut found = oleafly_core::engine_spec::discover_bibliographies(project_dir)
        .map_err(|error| error.to_string())?;
    found.retain(|relative| !crate::cloud_files::path_is_placeholder(&project_dir.join(relative)));
    Ok(found)
}

pub fn descriptor_for(
    metadata_name: &str,
    main_document: &str,
) -> Result<EngineDescriptor, String> {
    let engine = engine_for(metadata_name, main_document)?;
    Ok(EngineDescriptor {
        id: engine.id().as_str().to_owned(),
        label: match engine.id() {
            DocumentEngineId::Latex => "LaTeX",
            DocumentEngineId::Latexmk => "LaTeX (latexmk)",
            DocumentEngineId::Typst => "Typst",
            DocumentEngineId::Markdown => "Markdown / Pandoc",
            DocumentEngineId::Quarto => "Quarto",
            DocumentEngineId::Calepin => "Calepin",
        }
        .to_owned(),
        source_format: match engine.id() {
            DocumentEngineId::Latexmk => "latex".to_owned(),
            DocumentEngineId::Quarto => "markdown".to_owned(),
            DocumentEngineId::Calepin => "typst".to_owned(),
            id => id.as_str().to_owned(),
        },
        main_document: main_document.to_owned(),
        source_extensions: engine
            .source_extensions()
            .iter()
            .map(|extension| (*extension).to_owned())
            .collect(),
        capabilities: engine.capabilities(),
        tex_flavor: None,
        allow_shell_escape: false,
        typst_version: None,
        typst_resolved: None,
        typst_missing: None,
        typst_vendor_packages: false,
        typst_options: None,
        notebook_output: match engine.id() {
            DocumentEngineId::Calepin => Some("pdf".to_owned()),
            _ => None,
        },
    })
}

fn notebook_engine(metadata_name: &str, main_document: &str) -> Option<DocumentEngineId> {
    engine_for(metadata_name, main_document)
        .ok()
        .map(DocumentEngine::id)
        .filter(|id| matches!(id, DocumentEngineId::Quarto | DocumentEngineId::Calepin))
}

pub(crate) fn require_notebook_trust(
    project_id: &str,
    metadata_name: &str,
    main_document: &str,
) -> Result<(), String> {
    if notebook_engine(metadata_name, main_document).is_some() {
        crate::trust::require_trusted(project_id, crate::trust::Capability::Notebook)?;
    }
    Ok(())
}

pub(crate) fn describe_notebook_output(
    descriptor: &mut EngineDescriptor,
    project_id: &str,
    main_document: &str,
) {
    if descriptor.id != DocumentEngineId::Quarto.as_str() {
        return;
    }
    let Ok(input) = crate::project::resolve_in_project(project_id, main_document) else {
        return;
    };
    let root = crate::project_location::locate(project_id)
        .ok()
        .map(|location| location.root);
    let target = quarto::target_for_file(&input, root.as_deref());
    descriptor.notebook_output = Some(if target.html { "html" } else { "pdf" }.to_owned());
}

pub(crate) fn exports_through_engine(metadata_name: &str, main_document: &str) -> bool {
    notebook_engine(metadata_name, main_document).is_some()
}

pub(crate) struct NotebookExport<'a> {
    pub(crate) engine: &'a str,
    pub(crate) project_dir: &'a Path,
    pub(crate) main_document: &'a str,
    pub(crate) format: &'a str,
    pub(crate) destination: &'a Path,
    pub(crate) allow_code: bool,
    pub(crate) cancel: Option<&'a crate::state::CompileCancel>,
    pub(crate) log: Option<&'a tauri::AppHandle>,
}

pub(crate) const EXPORT_LOG_EVENT: &str = "export:log";

fn notebook_export_spec(
    engine: DocumentEngineId,
    project_dir: &Path,
    main_document: &str,
    format: &str,
    out_dir: &Path,
    allow_code: bool,
) -> Result<(EngineCompileSpec, PathBuf), String> {
    let extension = match format {
        "docx" if engine == DocumentEngineId::Quarto => "docx",
        "html" => "html",
        other => return Err(format!("unsupported export format: {other}")),
    };
    let entry_output = out_dir.join(format!("{}.{extension}", crate::paths::ENTRY_STEM));
    let artifacts = EngineArtifacts {
        output_dir: out_dir.to_owned(),
        pdf: None,
        log: None,
        synctex: None,
        html: None,
    };
    let spec = match engine {
        DocumentEngineId::Quarto => {
            quarto::export_spec(project_dir, main_document, format, out_dir, allow_code)?
        }
        DocumentEngineId::Calepin if allow_code => calepin::calepin_spec(
            project_dir,
            main_document,
            &entry_output,
            format,
            artifacts,
            None,
        )?,
        DocumentEngineId::Calepin => {
            return Err(crate::app_error::AppError::new("notebook.code_needed")
                .param("engine", "Calepin")
                .into())
        }
        _ => return Err(format!("unsupported export format: {format}")),
    };
    let output = spec.artifacts.html.clone().unwrap_or(entry_output);
    Ok((spec, output))
}

fn notebook_setup_failure(errors: &[CompileError]) -> Option<String> {
    let first = errors.iter().find(|error| error.kind == "error")?;
    let code = quarto::setup_failure_code(first.code.as_deref()?);
    let known = quarto::SETUP_CODES
        .iter()
        .chain(calepin::SETUP_CODES.iter())
        .copied()
        .find(|known| *known == code)?;
    let coded = first.params.iter().fold(
        crate::app_error::AppError::new(known),
        |coded, (name, value)| coded.param(name, value),
    );
    Some(coded.into())
}

fn notebook_failure(label: &str, errors: &[CompileError], log: &str) -> String {
    if let Some(minutes) = oleafly_core::compile_limit::timed_out_line_in(log)
        .and_then(oleafly_core::compile_limit::timed_out_minutes)
    {
        return crate::app_error::AppError::new("notebook.timed_out")
            .param("minutes", minutes)
            .into();
    }
    if let Some(failure) = notebook_setup_failure(errors) {
        return failure;
    }
    let reason = errors
        .iter()
        .find(|error| error.kind == "error")
        .map(|error| error.message.clone())
        .unwrap_or_else(|| {
            let tail: Vec<&str> = log
                .lines()
                .rev()
                .filter(|line| !line.trim().is_empty())
                .take(3)
                .collect();
            tail.into_iter().rev().collect::<Vec<_>>().join(" ")
        });
    crate::app_error::AppError::new("notebook.export_failed")
        .param("label", label)
        .param("reason", reason)
        .into()
}

fn no_notebook_output(label: &str, error: std::io::Error) -> String {
    crate::app_error::AppError::new("notebook.no_output")
        .param("label", label)
        .detail(error)
        .into()
}

async fn run_notebook_export(
    program: &Path,
    spec: &EngineCompileSpec,
    export: &NotebookExport<'_>,
) -> Result<(String, Option<i32>), String> {
    run_supervised_process_with_environment(
        program,
        &spec.args,
        &spec.working_dir,
        export
            .log
            .map(|app| (app.clone(), EXPORT_LOG_EVENT.to_owned())),
        spec.environment.time_limit(),
        export.cancel,
        &spec.environment,
    )
    .await
}

pub(crate) async fn export_notebook(export: NotebookExport<'_>) -> Result<(), String> {
    let engine = engine_for(export.engine, export.main_document)?;
    let scratch = tempfile::Builder::new()
        .prefix("oleafly-export-")
        .tempdir()
        .map_err(|error| {
            String::from(
                crate::app_error::AppError::new("notebook.export_save_failed").detail(error),
            )
        })?;
    let (spec, output) = {
        let id = engine.id();
        let project_dir = export.project_dir.to_owned();
        let main_document = export.main_document.to_owned();
        let format = export.format.to_owned();
        let out_dir = scratch.path().to_owned();
        let allow_code = export.allow_code;
        tokio::task::spawn_blocking(move || {
            notebook_export_spec(
                id,
                &project_dir,
                &main_document,
                &format,
                &out_dir,
                allow_code,
            )
        })
        .await
        .map_err(|error| format!("failed to prepare the export: {error}"))??
    };
    let EngineExecutable::ExternalPath(program) = &spec.executable else {
        return Err("the export needs an external program".into());
    };
    let scope = CompileCancelScope::new(export.cancel);
    let mut run = run_notebook_export(program, &spec, &export).await;
    let document_render = run
        .as_ref()
        .ok()
        .filter(|_| engine.id() == DocumentEngineId::Quarto)
        .and_then(|(log, code)| quarto::document_render_spec(&spec, log, *code));
    if let Some(document_render) = document_render {
        run = run_notebook_export(program, &document_render, &export).await;
        if let Err(error) = quarto::collect_document_render(&document_render) {
            run = Err(no_notebook_output("Quarto", error));
        }
    }
    if scope.finish() {
        return Err(crate::app_error::AppError::new("notebook.export_stopped").into());
    }
    let (log, exit_code) = run?;
    if exit_code != Some(0) || !output.is_file() {
        let label = match engine.id() {
            DocumentEngineId::Calepin => "Calepin",
            _ => "Quarto",
        };
        if exit_code == Some(0) {
            return Err(crate::app_error::AppError::new("notebook.no_output")
                .param("label", label)
                .into());
        }
        return Err(notebook_failure(label, &engine.parse_errors(&log), &log));
    }
    tokio::fs::copy(&output, export.destination)
        .await
        .map_err(|error| {
            String::from(
                crate::app_error::AppError::new("notebook.export_save_failed").detail(error),
            )
        })?;
    Ok(())
}

pub use oleafly_core::tex_errors::CompileError;
use oleafly_core::tex_errors::{
    parse_pandoc_diagnostics, parse_tectonic_log_errors, parse_tex_log_errors, rebase_log_files,
    resolve_extensionless_inputs, ENGINE_OUTPUT_MARKER,
};

#[derive(Serialize, Default)]
pub struct CompileResult {
    pub ok: bool,
    pub has_pdf: bool,
    pub output_id: Option<String>,
    pub output_revision: Option<u64>,
    pub log: String,
    pub errors: Vec<CompileError>,
    pub diagnostics: Vec<oleafly_core::LogDiagnostic>,
    pub synctex_path: Option<String>,
    pub out_dir: Option<String>,
    pub compile_time_ms: u64,
    pub stopped: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub html_output: Option<String>,
}

pub(crate) fn fingerprint_compile_output(bytes: &[u8]) -> String {
    let mut first = 0x811c_9dc5_u32;
    let mut second = 0x9e37_79b9_u32;
    for byte in bytes {
        first = (first ^ u32::from(*byte)).wrapping_mul(0x0100_0193);
        second = (second ^ u32::from(*byte)).wrapping_mul(0x85eb_ca6b);
        second = second.rotate_left(13);
    }
    format!("pdf-v1:{}:{first:08x}{second:08x}", bytes.len())
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct CompileOptions {
    pub offline: bool,
    pub fast: bool,
    pub halt_on_error: bool,
    pub latex_flavor: Option<LatexmkFlavor>,
    pub allow_shell_escape: bool,
    pub source_date_epoch: Option<u64>,
    pub external_build: bool,
    pub typst: Option<std::sync::Arc<oleafly_core::typst_toolchain::ResolvedTypst>>,
    pub typst_packages: Option<crate::typst_packages::TypstPackageDirs>,
    pub typst_settings: Option<crate::typst_options::TypstCompileSettings>,
}

pub struct CompileRequest<'a> {
    pub app: &'a tauri::AppHandle,
    pub engine: &'a dyn DocumentEngine,
    pub out_dir: &'a Path,
    pub project_dir: &'a Path,
    pub target: CompileTarget<'a>,
    pub log_event: &'a str,
    pub options: CompileOptions,
    pub cancel: Option<&'a crate::state::CompileCancel>,
    pub prepared_spec: Option<EngineCompileSpec>,
}

pub async fn prepare_compile_spec(
    engine_id: DocumentEngineId,
    out_dir: PathBuf,
    project_dir: PathBuf,
    target: CompileTarget<'_>,
    options: CompileOptions,
) -> Result<EngineCompileSpec, String> {
    let owned_target = match target {
        CompileTarget::Main { main_document } => (Some(main_document.to_owned()), None, None),
        CompileTarget::Isolated {
            source_path,
            output_stem,
        } => (
            None,
            Some(source_path.to_owned()),
            Some(output_stem.to_owned()),
        ),
    };
    tokio::task::spawn_blocking(move || {
        let engine: &'static dyn DocumentEngine = match engine_id {
            DocumentEngineId::Latex => &LATEX_ENGINE,
            DocumentEngineId::Latexmk => &LATEXMK_ENGINE,
            DocumentEngineId::Typst => &TYPST_ENGINE,
            DocumentEngineId::Markdown => &MARKDOWN_ENGINE,
            DocumentEngineId::Quarto => &quarto::QUARTO_ENGINE,
            DocumentEngineId::Calepin => &calepin::CALEPIN_ENGINE,
        };
        match owned_target {
            (Some(main_document), None, None) => engine.compile_spec(
                &out_dir,
                &project_dir,
                CompileTarget::Main {
                    main_document: &main_document,
                },
                options,
            ),
            (None, Some(source_path), Some(output_stem)) => engine.compile_spec(
                &out_dir,
                &project_dir,
                CompileTarget::Isolated {
                    source_path: &source_path,
                    output_stem: &output_stem,
                },
                options,
            ),
            _ => Err("invalid compiler target".into()),
        }
    })
    .await
    .map_err(|error| format!("failed to prepare compiler command: {error}"))?
}

pub(crate) struct CompileCancelScope<'a> {
    cancel: Option<&'a crate::state::CompileCancel>,
    active: bool,
}

impl<'a> CompileCancelScope<'a> {
    pub(crate) fn new(cancel: Option<&'a crate::state::CompileCancel>) -> Self {
        if let Some(cancel) = cancel {
            cancel.begin();
        }
        Self {
            cancel,
            active: true,
        }
    }

    pub(crate) fn finish(mut self) -> bool {
        self.active = false;
        self.cancel.is_some_and(crate::state::CompileCancel::detach)
    }
}

impl Drop for CompileCancelScope<'_> {
    fn drop(&mut self) {
        if self.active {
            if let Some(cancel) = self.cancel {
                let _ = cancel.detach();
            }
        }
    }
}

async fn recover_pythontex(
    request: &CompileRequest<'_>,
    spec: &EngineCompileSpec,
    stdout_buf: &mut String,
    exit_code: &mut Option<i32>,
) -> Result<(String, Option<String>), String> {
    if !pythontex_recovery_allowed(request, *exit_code) {
        return Ok((String::new(), None));
    }
    let stem = crate::paths::ENTRY_STEM;
    let code_path = spec.artifacts.output_dir.join(format!("{stem}.pytxcode"));
    let initial_log = spec
        .artifacts
        .log
        .as_ref()
        .and_then(|path| read_log_bounded(path).ok())
        .unwrap_or_else(|| stdout_buf.clone());
    if !pythontex_job_present(&initial_log, &code_path) {
        return Ok((String::new(), None));
    }
    let EngineExecutable::ExternalPath(latexmk) = &spec.executable else {
        return Err("latexmk unexpectedly resolved to a bundled compiler".into());
    };
    let Some(pythontex) = pythontex_tool_for_latexmk(latexmk) else {
        return Ok(missing_pythontex(latexmk, exit_code));
    };
    run_pythontex_recovery(request, spec, stdout_buf, exit_code, latexmk, &pythontex).await
}

fn pythontex_recovery_allowed(request: &CompileRequest<'_>, exit_code: Option<i32>) -> bool {
    request.engine.id() == DocumentEngineId::Latexmk
        && matches!(request.target, CompileTarget::Main { .. })
        && request.options.allow_shell_escape
        && exit_code == Some(0)
}

fn missing_pythontex(latexmk: &Path, exit_code: &mut Option<i32>) -> (String, Option<String>) {
    let message = format!(
        "PythonTeX is required, but the active TeX distribution ({}) does not provide its pythontex helper.",
        latexmk.display()
    );
    *exit_code = Some(-1);
    (format!("\n[Oleafly] {message}\n"), Some(message))
}

async fn run_pythontex_recovery(
    request: &CompileRequest<'_>,
    spec: &EngineCompileSpec,
    stdout_buf: &mut String,
    exit_code: &mut Option<i32>,
    latexmk: &Path,
    pythontex: &Path,
) -> Result<(String, Option<String>), String> {
    let stem = crate::paths::ENTRY_STEM;
    let helper_args = pythontex_args(
        &spec.working_dir,
        &spec.artifacts.output_dir,
        stem,
        request.options.external_build || spec.working_dir != request.project_dir,
    )?;
    let mut notes = format!(
        "\n[Oleafly] Running PythonTeX ({}) on {stem}...\n",
        pythontex.display()
    );
    let outcome = run_supervised_process(
        pythontex,
        &helper_args,
        &spec.working_dir,
        Some((request.app.clone(), request.log_event.to_owned())),
        COMPILE_TIMEOUT,
        request.cancel,
    )
    .await;
    match outcome {
        Ok((helper_log, Some(0))) => {
            append_bounded(&mut notes, helper_log.as_bytes());
            rerun_after_pythontex(request, spec, stdout_buf, exit_code, latexmk, notes).await
        }
        Ok((helper_log, helper_code)) => {
            append_bounded(&mut notes, helper_log.as_bytes());
            let message = format!(
                "PythonTeX helper failed with exit code {}.",
                helper_code.unwrap_or(-1)
            );
            *exit_code = helper_code.or(Some(-1));
            append_failure(notes, message)
        }
        Err(error) => {
            *exit_code = Some(-1);
            append_failure(notes, step_failure("run PythonTeX helper", &error))
        }
    }
}

async fn rerun_after_pythontex(
    request: &CompileRequest<'_>,
    spec: &EngineCompileSpec,
    stdout_buf: &mut String,
    exit_code: &mut Option<i32>,
    latexmk: &Path,
    mut notes: String,
) -> Result<(String, Option<String>), String> {
    append_bounded(
        &mut notes,
        b"\n[Oleafly] Re-running latexmk after PythonTeX...\n",
    );
    match run_external_with_environment(
        request.app,
        latexmk,
        &spec.args,
        &spec.working_dir,
        request.log_event,
        request.cancel,
        &spec.environment,
    )
    .await
    {
        Ok((retry_log, retry_code)) => {
            *stdout_buf = retry_log;
            *exit_code = retry_code;
            Ok((notes, None))
        }
        Err(error) => {
            *exit_code = Some(-1);
            append_failure(
                notes,
                step_failure("re-run latexmk after PythonTeX", &error),
            )
        }
    }
}

fn step_failure(step: &str, error: &str) -> String {
    format!(
        "failed to {step}: {}",
        crate::app_error::english_error(error)
    )
}

fn append_failure(mut notes: String, message: String) -> Result<(String, Option<String>), String> {
    append_bounded(&mut notes, format!("\n[Oleafly] {message}\n").as_bytes());
    Ok((notes, Some(message)))
}

async fn recover_bibliography(
    request: &CompileRequest<'_>,
    spec: &EngineCompileSpec,
    stdout_buf: &mut String,
    exit_code: &mut Option<i32>,
    bbl_before: Option<crate::biber_toolchain::BblStamp>,
) -> Result<(String, Option<PathBuf>), String> {
    if !matches!(request.target, CompileTarget::Main { .. }) {
        return Ok((String::new(), None));
    }
    if request.engine.id() == DocumentEngineId::Latexmk && *exit_code != Some(0) {
        return Ok((
            biber_log_notes(&spec.artifacts.output_dir, crate::paths::ENTRY_STEM),
            None,
        ));
    }
    if request.engine.id() != DocumentEngineId::Latex {
        return Ok((String::new(), None));
    }
    let out_dir = &spec.artifacts.output_dir;
    let stem = crate::paths::ENTRY_STEM;
    let compile_log = spec
        .artifacts
        .log
        .as_ref()
        .and_then(|path| read_log_bounded(path).ok())
        .unwrap_or_else(|| stdout_buf.clone());
    if !bibliography_recovery_needed(out_dir, stem, bbl_before) {
        return Ok((biber_log_notes(out_dir, stem), None));
    }
    let Some(biber) = crate::biber_toolchain::find_tectonic_biber() else {
        return Ok((
            crate::biber_toolchain::diagnose_biber_gap(&compile_log, None),
            None,
        ));
    };
    let notes = run_biber_recovery(request, spec, stdout_buf, exit_code, &biber).await?;
    Ok((notes, Some(biber)))
}

fn biber_diagnosis_needed(
    log: &str,
    output_dir: &Path,
    stem: &str,
    bbl_before: Option<crate::biber_toolchain::BblStamp>,
) -> bool {
    !log.contains("[Oleafly] Bibliography needs Biber")
        && (crate::biber_toolchain::tectonic_biber_step_failed(log)
            || bibliography_recovery_needed(output_dir, stem, bbl_before))
}

fn bibliography_recovery_needed(
    output_dir: &Path,
    stem: &str,
    bbl_before: Option<crate::biber_toolchain::BblStamp>,
) -> bool {
    output_dir.join(format!("{stem}.bcf")).is_file()
        && !crate::biber_toolchain::bbl_refreshed(output_dir, stem, bbl_before)
}

fn biber_log_notes(output_dir: &Path, stem: &str) -> String {
    let path = output_dir.join(format!("{stem}.blg"));
    let Ok(log) = read_log_bounded(&path) else {
        return String::new();
    };
    let excerpt = crate::biber_toolchain::biber_message_excerpt(&log);
    if excerpt.is_empty() {
        return String::new();
    }
    format!("\n[Oleafly] Biber messages ({stem}.blg):\n{excerpt}")
}

const ENGINE_OUTPUT_TAIL_BYTES: usize = 8 * 1024;
const LOG_NOTES_RESERVE_BYTES: usize = 96 * 1024;

fn reserve_log_budget(mut log: String, reserve: usize) -> String {
    let keep = MAX_LOG_BYTES.saturating_sub(reserve);
    if log.len() <= keep {
        return log;
    }
    let boundary = (0..=keep)
        .rev()
        .find(|index| log.is_char_boundary(*index))
        .unwrap_or(0);
    log.truncate(boundary);
    log.push_str("\n[Oleafly] Log truncated to keep room for the notes below.\n");
    log
}

fn append_engine_output_on_failure(
    mut log: String,
    stdout: &str,
    exit_code: Option<i32>,
) -> String {
    if exit_code == Some(0) || stdout.trim().is_empty() {
        return log;
    }
    let start = stdout.len().saturating_sub(ENGINE_OUTPUT_TAIL_BYTES);
    let start = stdout
        .char_indices()
        .map(|(index, _)| index)
        .find(|index| *index >= start)
        .unwrap_or(stdout.len());
    append_bounded(&mut log, format!("\n{ENGINE_OUTPUT_MARKER}\n").as_bytes());
    append_bounded(&mut log, &stdout.as_bytes()[start..]);
    log
}

async fn run_biber_recovery(
    request: &CompileRequest<'_>,
    spec: &EngineCompileSpec,
    stdout_buf: &mut String,
    exit_code: &mut Option<i32>,
    biber: &Path,
) -> Result<String, String> {
    let stem = crate::paths::ENTRY_STEM;
    let mut notes = format!(
        "\n[Oleafly] Running pinned Biber ({}) on {stem}...\n",
        biber.display()
    );
    let biber_args = crate::biber_toolchain::biber_cli_args(&spec.artifacts.output_dir, stem);
    let outcome = run_supervised_process_with_environment(
        biber,
        &biber_args,
        &spec.working_dir,
        Some((request.app.clone(), request.log_event.to_owned())),
        COMPILE_TIMEOUT,
        request.cancel,
        &EngineEnvironment::default()
            .with_variable(oleafly_core::biber_env::DIRECT_ENV, "1".to_owned()),
    )
    .await;
    match outcome {
        Ok((biber_log, Some(0))) => {
            append_bounded(&mut notes, biber_log.as_bytes());
            rerun_after_biber(request, spec, stdout_buf, exit_code, notes).await
        }
        Ok((biber_log, _)) => {
            append_bounded(&mut notes, biber_log.as_bytes());
            append_biber_diagnosis(&mut notes, &biber_log, biber);
            Ok(notes)
        }
        Err(error) => {
            append_biber_failure(&mut notes, &error, biber);
            Ok(notes)
        }
    }
}

fn append_biber_failure(notes: &mut String, error: &str, biber: &Path) {
    let error = crate::app_error::english_error(error);
    append_bounded(notes, error.as_bytes());
    append_biber_diagnosis(notes, &error, biber);
}

fn append_biber_diagnosis(notes: &mut String, log: &str, biber: &Path) {
    let diagnosis = crate::biber_toolchain::diagnose_biber_gap(log, Some(biber));
    append_bounded(notes, diagnosis.as_bytes());
}

async fn rerun_after_biber(
    request: &CompileRequest<'_>,
    spec: &EngineCompileSpec,
    stdout_buf: &mut String,
    exit_code: &mut Option<i32>,
    mut notes: String,
) -> Result<String, String> {
    append_bounded(
        &mut notes,
        b"\n[Oleafly] Re-running Tectonic after Biber...\n",
    );
    let (retry_out, retry_code) = match &spec.executable {
        EngineExecutable::BundledSidecar(name) => {
            run_bundled_with_environment(
                request.app,
                name,
                &spec.args,
                spec.launch_dir(),
                request.log_event,
                request.cancel,
                &spec.environment,
            )
            .await?
        }
        EngineExecutable::ExternalPath(path) => {
            run_external_with_environment(
                request.app,
                path,
                &spec.args,
                spec.launch_dir(),
                request.log_event,
                request.cancel,
                &spec.environment,
            )
            .await?
        }
    };
    *stdout_buf = retry_out;
    *exit_code = retry_code;
    Ok(notes)
}

struct CompileFinish {
    capabilities: EngineCapabilities,
    spec: EngineCompileSpec,
    retained_stale: Vec<RetainedArtifact>,
    compile_start: std::time::Instant,
    bbl_before: Option<crate::biber_toolchain::BblStamp>,
    stdout_buf: String,
    exit_code: Option<i32>,
    biber_notes: String,
    resolved_biber: Option<PathBuf>,
    pythontex_notes: String,
    pythontex_failure: Option<String>,
}

async fn finish_compile(
    request: &CompileRequest<'_>,
    finish: CompileFinish,
    stopped: bool,
) -> Result<CompileResult, String> {
    let CompileFinish {
        capabilities,
        spec,
        retained_stale,
        compile_start,
        bbl_before,
        stdout_buf,
        exit_code,
        biber_notes,
        resolved_biber,
        pythontex_notes,
        pythontex_failure,
    } = finish;
    let setup_gap = latexmk_setup_gap(request, &spec, &stdout_buf, exit_code, stopped, bbl_before);
    let mut log =
        combined_compile_log(&spec, stdout_buf, exit_code, &biber_notes, &pythontex_notes);
    if matches!(
        request.engine.id(),
        DocumentEngineId::Quarto | DocumentEngineId::Calepin
    ) {
        log = quarto::strip_ansi(&log);
    }
    append_missing_biber_diagnosis(request, &spec, &mut log, resolved_biber, bbl_before);
    let html_output = fresh_html_output(&spec, &retained_stale);
    let output_id = verify_compile_output(capabilities, &spec, retained_stale).await?;
    let has_pdf = output_id.is_some();
    let has_output = has_pdf || html_output.is_some();
    let mut errors = request.engine.parse_errors(&log);
    errors.extend(request.engine.compile_notes(&spec, &request.options, &log));
    if has_pdf && !errors.iter().any(|error| error.kind == "error") {
        errors.extend(typst_glyph_warnings(request, &spec).await);
    }
    if request.engine.id() == DocumentEngineId::Latexmk && !stopped {
        errors.extend(bibtex_folder_brace_error(&spec, exit_code));
    }
    append_pythontex_error(&mut errors, stopped, pythontex_failure);
    append_shell_escape_error(
        request,
        &spec,
        stopped,
        has_output,
        exit_code,
        &mut log,
        &mut errors,
    );
    append_setup_gap(setup_gap, &mut log, &mut errors);
    if !stopped {
        let failed = !has_output || exit_code != Some(0);
        append_tex_output_notes(request, &spec, failed, &mut log, &mut errors);
    }
    let ok = compile_succeeded(
        request, &spec, stopped, has_output, exit_code, &errors, &mut log,
    );
    append_unreported_failure(request.engine.id(), &log, ok, stopped, &mut errors);
    if let Some(main_document) =
        image_check_main_document(request.engine.id(), request.target, ok, stopped)
    {
        explain_image_failures(request.project_dir, main_document, &mut log, &mut errors).await;
    }
    let root_file = match request.target {
        CompileTarget::Main { main_document } => Some(main_document.to_string()),
        CompileTarget::Isolated { .. } => None,
    };
    let (log, diagnostics, errors) = parse_log_diagnostics(
        request.engine.id(),
        log,
        root_file,
        request.project_dir.to_owned(),
        spec.working_dir.clone(),
        errors,
    )
    .await?;
    Ok(build_compile_result(
        capabilities,
        spec,
        compile_start,
        CompileResultParts {
            stopped,
            ok,
            has_pdf,
            output_id,
            errors,
            diagnostics,
            log,
            html_output,
        },
    ))
}

/// latexmk can't write `\include` aux files into build subfolders that don't
/// exist yet, so a first build that includes from five or more folders used
/// to fail. A failure here only costs the old behaviour, so it is logged.
fn create_include_output_dirs(tex_working_dir: &Path, out_dir: &Path) {
    if let Err(error) =
        oleafly_core::engine_spec::create_include_output_dirs(tex_working_dir, out_dir)
    {
        let _ = crate::project::append_app_log(format!(
            "Could not create build folders for included files: {error}"
        ));
    }
}

fn seed_project_bibliography(project_dir: &Path, main_document: &str, out_dir: &Path) {
    let Some(bbl) = shipped_bibliography(project_dir, main_document) else {
        return;
    };
    if let Err(error) = seed_shipped_bibliography(project_dir, &bbl, out_dir) {
        let _ = crate::project::append_app_log(format!("Could not use {bbl}: {error}"));
    }
}

fn append_tex_output_notes(
    request: &CompileRequest<'_>,
    spec: &EngineCompileSpec,
    failed: bool,
    log: &mut String,
    errors: &mut Vec<CompileError>,
) {
    let engine = request.engine.id();
    let CompileTarget::Main { main_document } = request.target else {
        return;
    };
    if !matches!(engine, DocumentEngineId::Latex | DocumentEngineId::Latexmk) {
        return;
    }
    if let Some(bbl) = shipped_bibliography(request.project_dir, main_document) {
        append_bounded(log, shipped_bibliography_note(&bbl).as_bytes());
    }
    let source = read_source_head(&request.project_dir.join(main_document));
    errors.extend(jobname_bibliography_warning(&source));
    errors.extend(unbuilt_index_warnings(
        log,
        &spec.artifacts.output_dir,
        crate::paths::ENTRY_STEM,
        engine == DocumentEngineId::Latex,
    ));
    if !failed {
        return;
    }
    let mut causes = Vec::new();
    if engine == DocumentEngineId::Latexmk {
        causes = latexmk_failure_causes(
            log,
            &spec.artifacts.output_dir,
            request.options.latex_flavor.is_none(),
        );
    }
    causes.extend(nested_input_error(request.project_dir, main_document, log));
    errors.splice(0..0, causes);
}

fn latexmk_failure_causes(log: &str, output_dir: &Path, auto_flavor: bool) -> Vec<CompileError> {
    let mut causes: Vec<CompileError> = latexmk_biber_mismatch_error(log).into_iter().collect();
    causes.extend(bibliography_above_main_error(
        output_dir,
        crate::paths::ENTRY_STEM,
    ));
    if auto_flavor {
        causes.extend(unicode_engine_error(log));
    }
    causes
}

fn fresh_html_output(spec: &EngineCompileSpec, retained: &[RetainedArtifact]) -> Option<String> {
    spec.artifacts
        .html
        .as_ref()
        .filter(|path| artifact_is_fresh(path, retained))
        .map(|path| path.to_string_lossy().into_owned())
}

fn image_check_main_document(
    engine: DocumentEngineId,
    target: CompileTarget<'_>,
    ok: bool,
    stopped: bool,
) -> Option<&str> {
    let tex = matches!(engine, DocumentEngineId::Latex | DocumentEngineId::Latexmk);
    if ok || stopped || !tex {
        return None;
    }
    match target {
        CompileTarget::Main { main_document } => Some(main_document),
        CompileTarget::Isolated { .. } => None,
    }
}

async fn explain_image_failures(
    project_dir: &Path,
    main_document: &str,
    log: &mut String,
    errors: &mut Vec<CompileError>,
) {
    let Some(evidence) = oleafly_core::image_failure_evidence(log) else {
        return;
    };
    let project_dir = project_dir.to_path_buf();
    let main_document = main_document.to_string();
    if let Ok(findings) =
        tokio::task::spawn_blocking(move || evidence.diagnose(&project_dir, Some(&main_document)))
            .await
    {
        apply_image_findings(&findings, log, errors);
    }
}

fn apply_image_findings(
    findings: &[oleafly_core::ImageFinding],
    log: &mut String,
    errors: &mut Vec<CompileError>,
) {
    if findings.is_empty() {
        return;
    }
    append_bounded(log, oleafly_core::image_failure_notes(findings).as_bytes());
    oleafly_core::place_image_findings(
        errors,
        findings,
        |error| error.kind == "error",
        |message| CompileError {
            line: None,
            file: None,
            message,
            kind: "error".into(),
            explanation: None,
            ..Default::default()
        },
    );
}

type ParsedCompileLog = (String, Vec<oleafly_core::LogDiagnostic>, Vec<CompileError>);

async fn typst_glyph_warnings(
    request: &CompileRequest<'_>,
    spec: &EngineCompileSpec,
) -> Vec<CompileError> {
    let CompileTarget::Main { main_document } = request.target else {
        return Vec::new();
    };
    let (Some(settings), Some(pdf), DocumentEngineId::Typst) = (
        request.options.typst_settings.clone(),
        spec.artifacts.pdf.clone(),
        request.engine.id(),
    ) else {
        return Vec::new();
    };
    run_glyph_check(crate::typst_options::GlyphCheck {
        pdf,
        project_dir: request.project_dir.to_owned(),
        main_document: main_document.to_owned(),
        settings,
    })
    .await
}

async fn run_glyph_check(check: crate::typst_options::GlyphCheck) -> Vec<CompileError> {
    tokio::task::spawn_blocking(move || check.warnings())
        .await
        .unwrap_or_default()
}

pub(crate) async fn typst_log_errors(
    log: String,
    main_document: &str,
    project_dir: PathBuf,
    log_dir: PathBuf,
) -> Result<ParsedCompileLog, String> {
    typst_checked_log_errors(log, main_document, project_dir, log_dir, None).await
}

pub(crate) async fn typst_checked_log_errors(
    log: String,
    main_document: &str,
    project_dir: PathBuf,
    log_dir: PathBuf,
    glyph_check: Option<crate::typst_options::GlyphCheck>,
) -> Result<ParsedCompileLog, String> {
    let mut errors = TYPST_ENGINE.parse_errors(&log);
    if let Some(check) = glyph_check.filter(|_| !errors.iter().any(|error| error.kind == "error")) {
        errors.extend(run_glyph_check(check).await);
    }
    parse_log_diagnostics(
        DocumentEngineId::Typst,
        log,
        Some(main_document.to_owned()),
        project_dir,
        log_dir,
        errors,
    )
    .await
}

async fn parse_log_diagnostics(
    engine: DocumentEngineId,
    log: String,
    root_file: Option<String>,
    project_dir: PathBuf,
    log_dir: PathBuf,
    mut errors: Vec<CompileError>,
) -> Result<ParsedCompileLog, String> {
    if matches!(
        engine,
        DocumentEngineId::Typst | DocumentEngineId::Calepin | DocumentEngineId::Quarto
    ) {
        return tokio::task::spawn_blocking(move || {
            typst_diagnostics::attach_typst_sources(&project_dir, &log_dir, &mut errors);
            let diagnostics = typst_diagnostics::typst_log_diagnostics(&errors);
            (log, diagnostics, errors)
        })
        .await
        .map_err(|error| format!("failed to parse the compile log: {error}"));
    }
    let is_tex = matches!(engine, DocumentEngineId::Latex | DocumentEngineId::Latexmk);
    if !is_tex {
        return Ok((log, Vec::new(), errors));
    }
    tokio::task::spawn_blocking(move || {
        let mut diagnostics = match root_file.as_deref() {
            Some(root) => oleafly_core::parse_latex_log(&log, Some(root)),
            None => Vec::new(),
        };
        rebase_log_files(
            &project_dir,
            &log_dir,
            root_file.as_deref(),
            &mut errors,
            &mut diagnostics,
        );
        resolve_extensionless_inputs(&project_dir, &mut errors, &mut diagnostics);
        (log, diagnostics, errors)
    })
    .await
    .map_err(|error| format!("failed to parse the compile log: {error}"))
}

fn compile_succeeded(
    request: &CompileRequest<'_>,
    spec: &EngineCompileSpec,
    stopped: bool,
    has_pdf: bool,
    exit_code: Option<i32>,
    errors: &[CompileError],
    log: &mut String,
) -> bool {
    if stopped {
        append_bounded(log, b"\nOleafly stopped the compile on request.\n");
    }
    let reported_errors = errors.iter().any(|error| error.kind == "error");
    let ok = !stopped && has_pdf && exit_code.unwrap_or(-1) == 0 && !reported_errors;
    if request.engine.id() == DocumentEngineId::Latexmk {
        settle_latexmk_run(spec, stopped, ok);
    }
    ok
}

fn bibtex_folder_brace_error(
    spec: &EngineCompileSpec,
    exit_code: Option<i32>,
) -> Option<CompileError> {
    if exit_code == Some(0) || !oleafly_core::has_unmatched_brace(&spec.working_dir) {
        return None;
    }
    let bibtex_log = read_log_bounded(&spec.artifacts.log.as_ref()?.with_extension("blg")).ok()?;
    bibtex_log
        .contains("I couldn't open database file")
        .then(|| CompileError {
            message: "BibTeX can't read files in a folder whose name has a lone brace.".into(),
            kind: "error".into(),
            explanation: Some(
                "Rename the folder so its { and } come in pairs, or remove them, then compile again."
                    .into(),
            ),
            code: Some("tex.bibtex_folder_brace".into()),
            ..Default::default()
        })
}

fn settle_latexmk_run(spec: &EngineCompileSpec, stopped: bool, ok: bool) {
    if stopped {
        return;
    }
    let EngineExecutable::ExternalPath(latexmk) = &spec.executable else {
        return;
    };
    if ok {
        record_latexmk_binary(&spec.artifacts.output_dir, latexmk);
    } else if let Some(log) = &spec.artifacts.log {
        forget_latexmk_run(log);
    }
}

fn combined_compile_log(
    spec: &EngineCompileSpec,
    stdout: String,
    exit_code: Option<i32>,
    biber_notes: &str,
    pythontex_notes: &str,
) -> String {
    let mut log = match spec
        .artifacts
        .log
        .as_ref()
        .and_then(|path| read_log_bounded(path).ok())
    {
        Some(file_log) => {
            let mut log = append_engine_output_on_failure(
                reserve_log_budget(file_log, LOG_NOTES_RESERVE_BYTES),
                &stdout,
                exit_code,
            );
            append_bundle_fetch_notes(&mut log, &stdout, exit_code);
            log
        }
        None => reserve_log_budget(stdout, LOG_NOTES_RESERVE_BYTES),
    };
    append_bounded(&mut log, biber_notes.as_bytes());
    append_bounded(&mut log, pythontex_notes.as_bytes());
    log
}

fn append_bundle_fetch_notes(log: &mut String, stdout: &str, exit_code: Option<i32>) {
    if exit_code != Some(0) {
        return;
    }
    if stdout.contains(oleafly_core::engine_spec::BUNDLE_FALLBACK_NOTE) {
        append_bounded(
            log,
            format!("\n{}", oleafly_core::engine_spec::BUNDLE_FALLBACK_NOTE).as_bytes(),
        );
    }
    if let Some(excerpt) = oleafly_core::engine_spec::bundle_fetch_excerpt(stdout) {
        append_bounded(
            log,
            format!("\n{ENGINE_OUTPUT_MARKER}\n{excerpt}").as_bytes(),
        );
    }
}

fn append_missing_biber_diagnosis(
    request: &CompileRequest<'_>,
    spec: &EngineCompileSpec,
    log: &mut String,
    resolved_biber: Option<PathBuf>,
    bbl_before: Option<crate::biber_toolchain::BblStamp>,
) {
    let needs_diagnosis = request.engine.id() == DocumentEngineId::Latex
        && matches!(request.target, CompileTarget::Main { .. })
        && biber_diagnosis_needed(
            log,
            &spec.artifacts.output_dir,
            crate::paths::ENTRY_STEM,
            bbl_before,
        );
    if !needs_diagnosis {
        return;
    }
    let biber = resolved_biber.or_else(crate::biber_toolchain::find_tectonic_biber);
    let diagnosis = crate::biber_toolchain::diagnose_biber_gap(log, biber.as_deref());
    append_bounded(log, diagnosis.as_bytes());
}

async fn verify_compile_output(
    capabilities: EngineCapabilities,
    spec: &EngineCompileSpec,
    retained_stale: Vec<RetainedArtifact>,
) -> Result<Option<String>, String> {
    if !capabilities.produces_pdf {
        return Ok(None);
    }
    let pdf_path = spec.artifacts.pdf.clone();
    tokio::task::spawn_blocking(move || {
        let path = pdf_path
            .as_ref()
            .filter(|path| artifact_is_fresh(path, &retained_stale))?;
        let bytes = std::fs::read(path).ok()?;
        Some(fingerprint_compile_output(&bytes))
    })
    .await
    .map_err(|error| format!("failed to verify compiler output: {error}"))
}

fn append_pythontex_error(errors: &mut Vec<CompileError>, stopped: bool, failure: Option<String>) {
    let Some(message) = failure.filter(|_| !stopped) else {
        return;
    };
    errors.push(CompileError {
        line: None,
        file: None,
        message,
        kind: "error".into(),
        explanation: Some(
            "Install PythonTeX in the same TeX distribution that provides latexmk, or remove PythonTeX from this document. PythonTeX runs code from the project, so you also have to allow external commands for it.".into(),
        ),
        code: Some("tex.explain.pythontex_failed".into()),
        ..Default::default()
    });
}

const TIMED_OUT_LOG_PREFIX: &str = oleafly_core::compile_limit::TIMED_OUT_LINE;
const UNREPORTED_LINE_CHARS: usize = 300;

fn coded_compile_card(
    code: &'static str,
    message: String,
    params: &[(&str, String)],
) -> CompileError {
    let mut coded = crate::app_error::AppError::new(code);
    for (name, value) in params {
        coded = coded.param(name, value);
    }
    CompileError {
        message,
        kind: "error".into(),
        explanation: crate::app_error::english(&coded.to_string()),
        code: Some(code.to_string()),
        params: params
            .iter()
            .map(|(name, value)| ((*name).to_string(), value.clone()))
            .collect(),
        ..Default::default()
    }
}

fn missing_latexmk_tool(
    stdout: &str,
    path_env: &std::ffi::OsStr,
    biber_needed: bool,
) -> Option<String> {
    let mut programs = oleafly_core::tex_errors::latexmk_programs_run(stdout);
    if biber_needed {
        programs.push("biber".into());
    }
    programs
        .into_iter()
        .find(|program| !oleafly_core::tex_distro::tool_on_path(path_env, program))
}

fn tex_blocker_card(blocker: &crate::tex_distro::TexBlocker, message: String) -> CompileError {
    let params: Vec<(&str, String)> = blocker
        .params
        .iter()
        .map(|(name, value)| (name.as_str(), value.clone()))
        .collect();
    coded_compile_card(blocker.code, message, &params)
}

fn latexmk_setup_gap(
    request: &CompileRequest<'_>,
    spec: &EngineCompileSpec,
    stdout: &str,
    exit_code: Option<i32>,
    stopped: bool,
    bbl_before: Option<crate::biber_toolchain::BblStamp>,
) -> Option<CompileError> {
    if stopped || exit_code == Some(0) || request.engine.id() != DocumentEngineId::Latexmk {
        return None;
    }
    let EngineExecutable::ExternalPath(latexmk) = &spec.executable else {
        return None;
    };
    let path_env = crate::biber_toolchain::compile_path_env_for(
        latexmk,
        spec.environment.path_excluded_root(&spec.working_dir),
    );
    let biber_needed = matches!(request.target, CompileTarget::Main { .. })
        && bibliography_recovery_needed(
            &spec.artifacts.output_dir,
            crate::paths::ENTRY_STEM,
            bbl_before,
        );
    let tool = missing_latexmk_tool(stdout, &path_env, biber_needed)?;
    Some(tex_blocker_card(
        &crate::tex_distro::tool_blocker(latexmk, &tool),
        format!("latexmk could not find {tool}"),
    ))
}

fn append_setup_gap(gap: Option<CompileError>, log: &mut String, errors: &mut Vec<CompileError>) {
    let Some(error) = gap else {
        return;
    };
    append_bounded(
        log,
        format!(
            "\n[Oleafly] {}\n",
            error.explanation.as_deref().unwrap_or(&error.message)
        )
        .as_bytes(),
    );
    errors.push(error);
}

fn timed_out_card(engine: DocumentEngineId, line: &str) -> CompileError {
    use oleafly_core::compile_limit::{timed_out_during_download, timed_out_minutes};
    let code = if matches!(engine, DocumentEngineId::Quarto | DocumentEngineId::Calepin) {
        "notebook.timed_out"
    } else if timed_out_during_download(line) {
        "compile.timed_out_downloading"
    } else {
        "compile.timed_out"
    };
    let minutes = timed_out_minutes(line)
        .unwrap_or(COMPILE_TIMEOUT.as_secs() / 60)
        .to_string();
    coded_compile_card(code, line.to_string(), &[("minutes", minutes)])
}

fn append_unreported_failure(
    engine: DocumentEngineId,
    log: &str,
    ok: bool,
    stopped: bool,
    errors: &mut Vec<CompileError>,
) {
    if ok || stopped {
        return;
    }
    let last_line = |matches: &dyn Fn(&str) -> bool| {
        log.lines().rev().map(str::trim).find(|line| matches(line))
    };
    if let Some(line) = last_line(&|line| line.starts_with(TIMED_OUT_LOG_PREFIX)) {
        errors.retain(|error| !line.ends_with(error.message.as_str()));
        errors.push(timed_out_card(engine, line));
        return;
    }
    if errors.iter().any(|error| error.kind == "error") {
        return;
    }
    errors.push(match last_line(&|line| !line.is_empty()) {
        Some(line) => {
            let line: String = line.chars().take(UNREPORTED_LINE_CHARS).collect();
            coded_compile_card("compile.no_diagnostic", line.clone(), &[("line", line)])
        }
        None => coded_compile_card("compile.no_output", "no compiler output".into(), &[]),
    });
}

fn append_shell_escape_error(
    request: &CompileRequest<'_>,
    spec: &EngineCompileSpec,
    stopped: bool,
    has_pdf: bool,
    exit_code: Option<i32>,
    log: &mut String,
    errors: &mut Vec<CompileError>,
) {
    let failed = !has_pdf
        || exit_code.unwrap_or(-1) != 0
        || errors.iter().any(|error| error.kind == "error");
    if stopped
        || !failed
        || request.engine.id() != DocumentEngineId::Latexmk
        || request.options.allow_shell_escape
    {
        return;
    }
    let source_head = read_source_head(spec.input.path());
    let Some(denied) = denied_shell_escape_feature(&source_head, log) else {
        return;
    };
    let error = shell_escape_denial(denied);
    append_bounded(
        log,
        format!(
            "\n[Oleafly] {} {}\n",
            error.message,
            error.explanation.as_deref().unwrap_or_default()
        )
        .as_bytes(),
    );
    errors.push(error);
}

struct CompileResultParts {
    stopped: bool,
    ok: bool,
    has_pdf: bool,
    output_id: Option<String>,
    errors: Vec<CompileError>,
    diagnostics: Vec<oleafly_core::LogDiagnostic>,
    log: String,
    html_output: Option<String>,
}

fn build_compile_result(
    capabilities: EngineCapabilities,
    spec: EngineCompileSpec,
    compile_start: std::time::Instant,
    parts: CompileResultParts,
) -> CompileResult {
    let synctex_path = capabilities
        .supports_synctex
        .then_some(spec.artifacts.synctex)
        .flatten()
        .filter(|path| path.exists())
        .map(|path| path.to_string_lossy().into_owned());
    CompileResult {
        stopped: parts.stopped,
        ok: parts.ok,
        has_pdf: parts.has_pdf,
        output_id: parts.output_id,
        output_revision: None,
        errors: parts.errors,
        diagnostics: parts.diagnostics,
        log: parts.log,
        synctex_path,
        out_dir: Some(spec.artifacts.output_dir.to_string_lossy().into_owned()),
        compile_time_ms: compile_start.elapsed().as_millis() as u64,
        html_output: parts.html_output,
    }
}

fn validate_compile_capabilities(
    request: &CompileRequest<'_>,
    capabilities: EngineCapabilities,
) -> Result<(), String> {
    if request.options.offline && !capabilities.supports_offline {
        return Err(format!(
            "engine `{}` does not support offline compilation",
            request.engine.id().as_str()
        ));
    }
    if matches!(request.target, CompileTarget::Isolated { .. })
        && !capabilities.supports_isolated_compile
    {
        return Err(format!(
            "engine `{}` does not support isolated compilation",
            request.engine.id().as_str()
        ));
    }
    Ok(())
}

async fn resolve_compile_spec(request: &CompileRequest<'_>) -> Result<EngineCompileSpec, String> {
    if let Some(spec) = &request.prepared_spec {
        return Ok(spec.clone());
    }
    prepare_compile_spec(
        request.engine.id(),
        request.out_dir.to_owned(),
        request.project_dir.to_owned(),
        request.target,
        request.options.clone(),
    )
    .await
}

async fn prepare_compile_artifacts(
    request: &CompileRequest<'_>,
    spec: &EngineCompileSpec,
) -> Result<Vec<RetainedArtifact>, String> {
    let cleanup_artifacts = spec.artifacts.clone();
    let biber_control = (request.engine.id() == DocumentEngineId::Latex
        && matches!(request.target, CompileTarget::Main { .. }))
    .then(|| {
        spec.artifacts
            .output_dir
            .join(format!("{}.bcf", crate::paths::ENTRY_STEM))
    });
    let engine = request.engine.id();
    let shipped_bibliography_source = (engine == DocumentEngineId::Latexmk)
        .then_some(request.target)
        .and_then(|target| match target {
            CompileTarget::Main { main_document } => Some(main_document.to_owned()),
            CompileTarget::Isolated { .. } => None,
        })
        .map(|main_document| (request.project_dir.to_owned(), main_document));
    let tex_working_dir = spec.working_dir.clone();
    let retained = tokio::task::spawn_blocking(move || {
        clear_latexmk_page_files(engine, &cleanup_artifacts);
        let retained = clear_stale_compile_artifacts(&cleanup_artifacts, biber_control.as_deref());
        if let Some((project_dir, main_document)) = shipped_bibliography_source {
            seed_project_bibliography(&project_dir, &main_document, &cleanup_artifacts.output_dir);
            create_include_output_dirs(&tex_working_dir, &cleanup_artifacts.output_dir);
        }
        retained
    })
    .await
    .map_err(|error| format!("failed to clear compiler artifacts: {error}"))?;
    if request.engine.id() == DocumentEngineId::Latexmk
        && matches!(request.target, CompileTarget::Main { .. })
        && request.options.allow_shell_escape
    {
        clear_pythontex_code_artifact(&spec.artifacts.output_dir, crate::paths::ENTRY_STEM)?;
    }
    if let EngineInput::Generated { path, content } = &spec.input {
        tokio::fs::write(path, content)
            .await
            .map_err(|error| format!("failed to write engine entry {}: {error}", path.display()))?;
    }
    if request.engine.id() == DocumentEngineId::Latex && !request.options.offline {
        let tex_defaults = spec
            .artifacts
            .output_dir
            .join(oleafly_core::engine_spec::TEX_DEFAULTS_DIR);
        tokio::task::spawn_blocking(move || {
            oleafly_core::engine_spec::write_tex_defaults(&tex_defaults)
        })
        .await
        .map_err(|error| format!("failed to write TeX defaults: {error}"))?
        .map_err(|error| error.to_string())?;
    }
    Ok(retained)
}

static TECTONIC_PREFETCH_SEEDED: std::sync::Once = std::sync::Once::new();
const TECTONIC_CACHE_PROBE_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(10);

fn seed_tectonic_prefetch_with(tectonic: &Path) {
    let mut command = std::process::Command::new(tectonic);
    command
        .args(oleafly_core::engine_spec::TECTONIC_CACHE_DIR_ARGS)
        .no_console();
    crate::proc::clear_appimage_env(&mut command);
    let Ok(output) =
        crate::proc::output_contained_with_timeout(command, TECTONIC_CACHE_PROBE_TIMEOUT)
    else {
        return;
    };
    if output.status.success() {
        oleafly_core::engine_spec::seed_tectonic_prefetch(&String::from_utf8_lossy(&output.stdout));
    }
}

async fn seed_tectonic_prefetch(args: &[String]) {
    if TECTONIC_PREFETCH_SEEDED.is_completed() || args.iter().any(|arg| arg == "--only-cached") {
        return;
    }
    let Ok(tectonic) = resolve_bundled_sidecar("tectonic") else {
        return;
    };
    let _ = tokio::task::spawn_blocking(move || {
        TECTONIC_PREFETCH_SEEDED.call_once(|| seed_tectonic_prefetch_with(&tectonic));
    })
    .await;
}

async fn first_run_log(spec: &EngineCompileSpec) -> Option<Vec<u8>> {
    tokio::fs::read(spec.artifacts.log.as_ref()?).await.ok()
}

async fn restore_first_run_log(spec: &EngineCompileSpec, log: Option<Vec<u8>>) {
    if let (Some(path), Some(log)) = (&spec.artifacts.log, log) {
        let _ = tokio::fs::write(path, log).await;
    }
}

async fn execute_compile_spec(
    request: &CompileRequest<'_>,
    spec: &EngineCompileSpec,
) -> Result<(String, Option<i32>), String> {
    match &spec.executable {
        EngineExecutable::BundledSidecar(name) => {
            if name == &"tectonic" {
                seed_tectonic_prefetch(&spec.args).await;
            }
            let (output, exit_code) = run_bundled_with_environment(
                request.app,
                name,
                &spec.args,
                spec.launch_dir(),
                request.log_event,
                request.cancel,
                &spec.environment,
            )
            .await?;
            if name == &"tectonic"
                && spec.args.iter().any(|arg| arg == "--bundle")
                && oleafly_core::engine_spec::bundle_retry_needed(exit_code == Some(0), &output)
            {
                let fallback_args = args_without_bundle(&spec.args);
                let first_log = first_run_log(spec).await;
                let retry = run_bundled_with_environment(
                    request.app,
                    name,
                    &fallback_args,
                    spec.launch_dir(),
                    request.log_event,
                    request.cancel,
                    &spec.environment,
                )
                .await;
                let first_built = exit_code == Some(0);
                let (retry_output, retry_code) = match retry {
                    Ok(retry)
                        if oleafly_core::engine_spec::bundle_retry_replaces_first_run(
                            first_built,
                            retry.1 == Some(0),
                        ) =>
                    {
                        retry
                    }
                    Err(error) if !first_built => return Err(error),
                    _ => {
                        restore_first_run_log(spec, first_log).await;
                        return Ok((output, exit_code));
                    }
                };
                let mut combined = String::new();
                append_bounded(
                    &mut combined,
                    oleafly_core::engine_spec::BUNDLE_FALLBACK_NOTE.as_bytes(),
                );
                append_bounded(&mut combined, retry_output.as_bytes());
                return Ok((combined, retry_code));
            }
            Ok((output, exit_code))
        }
        EngineExecutable::ExternalPath(path) => {
            if request.engine.id() == DocumentEngineId::Markdown {
                seed_tectonic_prefetch(&spec.args).await;
            }
            let (output, exit_code) = run_external_with_environment(
                request.app,
                path,
                &spec.args,
                spec.launch_dir(),
                request.log_event,
                request.cancel,
                &spec.environment,
            )
            .await?;
            if request.engine.id() == DocumentEngineId::Markdown
                && exit_code != Some(0)
                && spec
                    .args
                    .iter()
                    .any(|arg| arg == "--pdf-engine-opt=--bundle")
                && is_bundle_fetch_failure(&output)
            {
                let fallback_args = args_without_bundle(&spec.args);
                let (retry_output, retry_code) = run_external_with_environment(
                    request.app,
                    path,
                    &fallback_args,
                    spec.launch_dir(),
                    request.log_event,
                    request.cancel,
                    &spec.environment,
                )
                .await?;
                let mut combined = String::new();
                append_bounded(&mut combined, output.as_bytes());
                append_bounded(
                    &mut combined,
                    oleafly_core::engine_spec::BUNDLE_FALLBACK_NOTE.as_bytes(),
                );
                append_bounded(&mut combined, retry_output.as_bytes());
                return Ok((combined, retry_code));
            }
            Ok((output, exit_code))
        }
    }
}

enum BuildLockWait {
    Held(Option<BuildGuard>),
    Stopped,
}

#[derive(Debug)]
struct BuildGuard {
    _file: Option<oleafly_core::build_output::BuildLock>,
    _folder: Option<oleafly_core::build_output::DirLock>,
}

impl BuildGuard {
    fn file(lock: oleafly_core::build_output::BuildLock) -> Self {
        Self {
            _file: Some(lock),
            _folder: None,
        }
    }

    fn folder(lock: oleafly_core::build_output::DirLock) -> Self {
        Self {
            _file: None,
            _folder: Some(lock),
        }
    }
}

const DIR_LOCK_SLACK: std::time::Duration = std::time::Duration::from_secs(60);

fn try_build_lock(
    build_dir: &Path,
    file_locks: bool,
    stale_after: std::time::Duration,
) -> std::io::Result<(Option<BuildGuard>, bool)> {
    use oleafly_core::build_output::{locks_unsupported, BuildLock, DirLock};
    std::fs::create_dir_all(build_dir)?;
    if file_locks {
        match BuildLock::try_acquire(build_dir) {
            Ok(lock) => return Ok((lock.map(BuildGuard::file), true)),
            Err(error) if !locks_unsupported(&error) => return Err(error),
            Err(_) => {}
        }
    }
    DirLock::try_acquire(build_dir, stale_after).map(|lock| (lock.map(BuildGuard::folder), false))
}

async fn wait_for_build_lock(
    build_dir: &Path,
    timeout: std::time::Duration,
    stale_after: std::time::Duration,
    stopped: impl Fn() -> bool,
    mut on_wait: impl FnMut(),
) -> Result<BuildLockWait, String> {
    let deadline = std::time::Instant::now() + timeout;
    let mut announced = false;
    let mut file_locks = true;
    loop {
        let dir = build_dir.to_path_buf();
        let attempt = tauri::async_runtime::spawn_blocking(move || {
            try_build_lock(&dir, file_locks, stale_after)
        })
        .await
        .map_err(|error| error.to_string())?;
        match attempt {
            Ok((Some(guard), _)) => return Ok(BuildLockWait::Held(Some(guard))),
            Ok((None, files)) => file_locks = files,
            Err(error) => {
                return Err(format!(
                    "Oleafly couldn't lock the build folder, so the build didn't run: {error}"
                ))
            }
        }
        if stopped() {
            return Ok(BuildLockWait::Stopped);
        }
        if !announced {
            announced = true;
            on_wait();
        }
        if std::time::Instant::now() >= deadline {
            return Err(
                "Another build of this project is still running. Try again when it finishes."
                    .into(),
            );
        }
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
    }
}

async fn acquire_build_lock(
    request: &CompileRequest<'_>,
    spec: &EngineCompileSpec,
) -> Result<BuildLockWait, String> {
    if !matches!(request.target, CompileTarget::Main { .. }) {
        return Ok(BuildLockWait::Held(None));
    }
    wait_for_build_lock(
        &spec.artifacts.output_dir,
        COMPILE_TIMEOUT,
        spec.environment.build_lock_stale_after(),
        || {
            request
                .cancel
                .is_some_and(crate::state::CompileCancel::is_requested)
        },
        || {
            let _ = request.app.emit(
                request.log_event,
                "[Oleafly] Waiting for another build of this project to finish…\n",
            );
        },
    )
    .await
}

async fn hold_quarto_siblings(
    request: &CompileRequest<'_>,
    spec: &EngineCompileSpec,
) -> Result<Option<quarto::SiblingHold>, String> {
    if request.engine.id() != DocumentEngineId::Quarto {
        return Ok(None);
    }
    let spec = spec.clone();
    tokio::task::spawn_blocking(move || quarto::hold_siblings(&spec))
        .await
        .map_err(|error| format!("failed to set aside the files beside the document: {error}"))?
}

async fn release_quarto_siblings(hold: Option<quarto::SiblingHold>, succeeded: bool) {
    let Some(mut hold) = hold else {
        return;
    };
    hold.set_succeeded(succeeded);
    let _ = tokio::task::spawn_blocking(move || drop(hold)).await;
}

pub async fn compile(request: CompileRequest<'_>) -> Result<CompileResult, String> {
    let cancel_scope = CompileCancelScope::new(request.cancel);
    let capabilities = request.engine.capabilities();
    validate_compile_capabilities(&request, capabilities)?;
    let spec = resolve_compile_spec(&request).await?;
    let _build_lock = match acquire_build_lock(&request, &spec).await? {
        BuildLockWait::Held(lock) => lock,
        BuildLockWait::Stopped => {
            cancel_scope.finish();
            let mut log = String::new();
            append_bounded(
                &mut log,
                b"[Oleafly] Stopped while waiting for another build of this project.\nOleafly stopped the compile on request.\n",
            );
            return Ok(build_compile_result(
                capabilities,
                spec,
                std::time::Instant::now(),
                CompileResultParts {
                    stopped: true,
                    ok: false,
                    has_pdf: false,
                    html_output: None,
                    output_id: None,
                    errors: Vec::new(),
                    diagnostics: Vec::new(),
                    log,
                },
            ));
        }
    };
    let _tex_runtime = if request.engine.id() == DocumentEngineId::Latexmk {
        Some(crate::latex_engine::acquire_tex_runtime_read()?)
    } else {
        None
    };
    let retained_stale = prepare_compile_artifacts(&request, &spec).await?;
    let sibling_hold = hold_quarto_siblings(&request, &spec).await?;
    let compile_start = std::time::Instant::now();
    let bbl_before =
        crate::biber_toolchain::bbl_stamp(&spec.artifacts.output_dir, crate::paths::ENTRY_STEM);
    let (mut stdout_buf, mut exit_code) = execute_compile_spec(&request, &spec).await?;
    let document_render = (request.engine.id() == DocumentEngineId::Quarto)
        .then(|| quarto::document_render_spec(&spec, &stdout_buf, exit_code))
        .flatten();
    if let Some(document_render) = document_render {
        (stdout_buf, exit_code) = execute_compile_spec(&request, &document_render).await?;
        quarto::collect_document_render(&document_render)
            .map_err(|error| no_notebook_output("Quarto", error))?;
    }

    let (biber_notes, resolved_biber) =
        recover_bibliography(&request, &spec, &mut stdout_buf, &mut exit_code, bbl_before).await?;
    let (pythontex_notes, pythontex_failure) =
        recover_pythontex(&request, &spec, &mut stdout_buf, &mut exit_code).await?;
    let finish = CompileFinish {
        capabilities,
        spec,
        retained_stale,
        compile_start,
        bbl_before,
        stdout_buf,
        exit_code,
        biber_notes,
        resolved_biber,
        pythontex_notes,
        pythontex_failure,
    };
    let result = finish_compile(&request, finish, cancel_scope.finish()).await;
    release_quarto_siblings(sibling_hold, exit_code == Some(0)).await;
    result
}

const COMPILE_TIMEOUT: std::time::Duration = oleafly_core::compile_limit::COMPILE_TIME_LIMIT;
const COMPILER_PIPE_CLOSE_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(1);
const MAX_LOG_BYTES: usize = 1024 * 1024;
const MAX_EMITTED_LOG_BYTES: usize = 256 * 1024;
const LOG_TRUNCATED: &str = "\n[Oleafly: compiler output truncated]\n";

fn mark_log_truncated(output: &mut String) {
    if output.ends_with(LOG_TRUNCATED) {
        return;
    }
    let keep = MAX_LOG_BYTES.saturating_sub(LOG_TRUNCATED.len());
    let boundary = (0..=keep.min(output.len()))
        .rev()
        .find(|index| output.is_char_boundary(*index))
        .unwrap_or(0);
    output.truncate(boundary);
    output.push_str(LOG_TRUNCATED);
}

fn append_bounded(output: &mut String, bytes: &[u8]) {
    if bytes.is_empty() {
        return;
    }
    if output.len() >= MAX_LOG_BYTES {
        mark_log_truncated(output);
        return;
    }
    let remaining = MAX_LOG_BYTES - output.len();
    let text = String::from_utf8_lossy(bytes);
    let take = (0..=remaining.min(text.len()))
        .rev()
        .find(|index| text.is_char_boundary(*index))
        .unwrap_or(0);
    output.push_str(&text[..take]);
    if text.len() > take {
        mark_log_truncated(output);
    }
}

fn claim_emit_budget(counter: &std::sync::atomic::AtomicUsize, requested: usize) -> usize {
    let mut granted = 0;
    let _ = counter.fetch_update(
        std::sync::atomic::Ordering::Relaxed,
        std::sync::atomic::Ordering::Relaxed,
        |current| {
            granted = requested.min(MAX_EMITTED_LOG_BYTES.saturating_sub(current));
            Some(current.saturating_add(granted).min(MAX_EMITTED_LOG_BYTES))
        },
    );
    granted
}

fn read_log_bounded(path: &Path) -> std::io::Result<String> {
    use std::io::Read;
    let mut file = std::fs::File::open(path)?;
    let mut bytes = Vec::with_capacity(MAX_LOG_BYTES.min(64 * 1024));
    file.by_ref()
        .take((MAX_LOG_BYTES + 1) as u64)
        .read_to_end(&mut bytes)?;
    let mut output = String::new();
    append_bounded(&mut output, &oleafly_core::rejoin_split_utf8_lines(&bytes));
    Ok(output)
}

async fn run_bundled_with_environment(
    app: &tauri::AppHandle,
    name: &str,
    args: &[String],
    working_dir: &Path,
    log_event: &str,
    cancel: Option<&crate::state::CompileCancel>,
    environment: &EngineEnvironment,
) -> Result<(String, Option<i32>), String> {
    let path = resolve_bundled_sidecar(name)?;
    run_supervised_process_with_environment(
        &path,
        args,
        working_dir,
        Some((app.clone(), log_event.to_owned())),
        environment.time_limit(),
        cancel,
        environment,
    )
    .await
}

pub(crate) fn resolve_bundled_sidecar(name: &str) -> Result<PathBuf, String> {
    if name.is_empty() || Path::new(name).components().count() != 1 {
        return Err("invalid bundled sidecar name".into());
    }
    let base_dir = oleafly_core::sidecar::executable_dir()
        .ok_or("failed to locate the application executable")?;
    oleafly_core::sidecar::sidecar_in(&base_dir, name).ok_or_else(|| {
        crate::app_error::AppError::new("compile.tool_missing")
            .param("tool", name)
            .into()
    })
}

fn emit_and_collect_compiler_text(
    text: &str,
    app: Option<&tauri::AppHandle>,
    event: &str,
    emitted: &std::sync::atomic::AtomicUsize,
    collected: &mut String,
) {
    if let Some(app) = app {
        let claimed = claim_emit_budget(emitted, text.len());
        let boundary = (0..=claimed.min(text.len()))
            .rev()
            .find(|index| text.is_char_boundary(*index))
            .unwrap_or(0);
        if boundary > 0 {
            let _ = app.emit(event, &text[..boundary]);
        }
    }
    append_bounded(collected, text.as_bytes());
}

async fn pump_external_output<R>(
    mut reader: R,
    app: Option<tauri::AppHandle>,
    log_event: String,
    emitted: std::sync::Arc<std::sync::atomic::AtomicUsize>,
    clock: std::sync::Arc<oleafly_core::compile_limit::CompileClock>,
) -> String
where
    R: tokio::io::AsyncRead + Unpin,
{
    use tokio::io::AsyncReadExt;
    let mut collected = String::new();
    let mut decoder = oleafly_core::Utf8StreamDecoder::default();
    let mut chunk = [0_u8; 8192];
    loop {
        match reader.read(&mut chunk).await {
            Ok(0) | Err(_) => {
                let tail = decoder.push(&[], true);
                emit_and_collect_compiler_text(
                    &tail,
                    app.as_ref(),
                    &log_event,
                    &emitted,
                    &mut collected,
                );
                break;
            }
            Ok(read) => {
                let text = decoder.push(&chunk[..read], false);
                clock.observe(&text);
                emit_and_collect_compiler_text(
                    &text,
                    app.as_ref(),
                    &log_event,
                    &emitted,
                    &mut collected,
                );
            }
        }
    }
    collected
}

async fn run_external_with_environment(
    app: &tauri::AppHandle,
    path: &Path,
    args: &[String],
    working_dir: &Path,
    log_event: &str,
    cancel: Option<&crate::state::CompileCancel>,
    environment: &EngineEnvironment,
) -> Result<(String, Option<i32>), String> {
    run_supervised_process_with_environment(
        path,
        args,
        working_dir,
        Some((app.clone(), log_event.to_owned())),
        environment.time_limit(),
        cancel,
        environment,
    )
    .await
}

pub async fn run_supervised_external(
    path: &Path,
    args: &[String],
    working_dir: &Path,
) -> Result<(String, Option<i32>), String> {
    run_supervised_process(path, args, working_dir, None, COMPILE_TIMEOUT, None).await
}

pub(crate) async fn run_supervised_external_with_variables(
    path: &Path,
    args: &[String],
    working_dir: &Path,
    variables: &[(String, String)],
) -> Result<(String, Option<i32>), String> {
    let environment = variables.iter().fold(
        EngineEnvironment::default(),
        |environment, (name, value)| environment.with_variable(name, value.clone()),
    );
    run_supervised_process_with_environment(
        path,
        args,
        working_dir,
        None,
        COMPILE_TIMEOUT,
        None,
        &environment,
    )
    .await
}

pub(crate) async fn run_supervised_external_with_stdin(
    path: &Path,
    args: &[String],
    working_dir: &Path,
    variables: &[(String, String)],
    stdin: &str,
) -> Result<(String, Option<i32>), String> {
    let environment = variables
        .iter()
        .fold(
            EngineEnvironment::default(),
            |environment, (name, value)| environment.with_variable(name, value.clone()),
        )
        .with_stdin(stdin.to_owned());
    run_supervised_process_with_environment(
        path,
        args,
        working_dir,
        None,
        COMPILE_TIMEOUT,
        None,
        &environment,
    )
    .await
}

pub(crate) async fn run_supervised_external_cancellable(
    path: &Path,
    args: &[String],
    working_dir: &Path,
    cancel: &crate::state::CompileCancel,
) -> Result<(String, Option<i32>), String> {
    run_supervised_process(path, args, working_dir, None, COMPILE_TIMEOUT, Some(cancel)).await
}

struct CompileChildRegistration<'a> {
    cancel: Option<&'a crate::state::CompileCancel>,
    pid: Option<u32>,
}

impl Drop for CompileChildRegistration<'_> {
    fn drop(&mut self) {
        if let (Some(cancel), Some(pid)) = (self.cancel, self.pid) {
            cancel.unregister(pid);
        }
    }
}

async fn drain_output_task(
    mut task: tokio::task::JoinHandle<String>,
    timeout: std::time::Duration,
) -> Result<String, ()> {
    match tokio::time::timeout(timeout, &mut task).await {
        Ok(result) => result.map_err(|_| ()),
        Err(_) => {
            task.abort();
            let _ = task.await;
            Err(())
        }
    }
}

async fn drain_compiler_output(
    stdout: tokio::task::JoinHandle<String>,
    stderr: tokio::task::JoinHandle<String>,
    process_group: Option<u32>,
) -> (String, bool) {
    let mut stalled = false;
    let mut log = match drain_output_task(stdout, COMPILER_PIPE_CLOSE_TIMEOUT).await {
        Ok(output) => output,
        Err(()) => {
            stalled = true;
            if let Some(pid) = process_group {
                terminate_process_tree(pid).await;
            }
            String::new()
        }
    };
    match drain_output_task(stderr, COMPILER_PIPE_CLOSE_TIMEOUT).await {
        Ok(output) => append_bounded(&mut log, output.as_bytes()),
        Err(()) => {
            if !stalled {
                if let Some(pid) = process_group {
                    terminate_process_tree(pid).await;
                }
            }
            stalled = true;
        }
    }
    (log, stalled)
}

async fn run_supervised_process(
    path: &Path,
    args: &[String],
    working_dir: &Path,
    emitter: Option<(tauri::AppHandle, String)>,
    timeout: std::time::Duration,
    cancel: Option<&crate::state::CompileCancel>,
) -> Result<(String, Option<i32>), String> {
    run_supervised_process_with_environment(
        path,
        args,
        working_dir,
        emitter,
        timeout,
        cancel,
        &EngineEnvironment::default(),
    )
    .await
}

async fn prepare_child_biber(
    program: &Path,
    path_env: &std::ffi::OsStr,
) -> Option<crate::biber_toolchain::ChildBiber> {
    let root = crate::paths::oleafly_root().ok()?;
    let program = program.to_path_buf();
    let path_env = path_env.to_os_string();
    tokio::task::spawn_blocking(move || {
        crate::biber_toolchain::prepare_child_biber(&root, &program, &path_env)
    })
    .await
    .ok()
    .flatten()
}

fn supervised_command(
    path: &Path,
    args: &[String],
    working_dir: &Path,
    path_env: &std::ffi::OsStr,
    child_biber: Option<&crate::biber_toolchain::ChildBiber>,
    environment: &EngineEnvironment,
) -> tokio::process::Command {
    use std::process::Stdio;
    let mut command = tokio::process::Command::new(path);
    command.no_console();
    command
        .args(args)
        .current_dir(working_dir)
        // TeX bin dirs + tectonic-biber for all supervised children (LaTeX primary;
        // Typst/others ignore extra PATH entries that are not present or unused).
        .env("PATH", path_env)
        .env("NoDefaultCurrentDirectoryInExePath", "1")
        .env("openout_any", "p");
    if let Some(child_biber) = child_biber {
        command.env(crate::biber_toolchain::UNPACK_ENV, &child_biber.unpack_dir);
    }
    command.env_remove("openin_any");
    for (name, value) in &environment.variables {
        command.env(name, value);
    }
    if !args.iter().any(|argument| argument == "-shell-escape") {
        command.env("shell_escape", "f").env(
            MIKTEX_SHELL_COMMANDS_VARIABLE,
            restricted_miktex_shell_commands(),
        );
    }
    crate::proc::clear_appimage_env(command.as_std_mut());
    command
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    if environment.stdin.is_some() {
        command.stdin(Stdio::piped());
    }
    isolate_process_tree(&mut command);
    command
}

async fn wait_within_limit(
    child: &mut tokio::process::Child,
    clock: &oleafly_core::compile_limit::CompileClock,
) -> Option<std::io::Result<std::process::ExitStatus>> {
    loop {
        let deadline = tokio::time::Instant::from_std(clock.deadline());
        match tokio::time::timeout_at(deadline, child.wait()).await {
            Ok(result) => return Some(result),
            Err(_) if clock.expired(std::time::Instant::now()) => return None,
            Err(_) => {}
        }
    }
}

async fn run_supervised_process_with_environment(
    path: &Path,
    args: &[String],
    working_dir: &Path,
    emitter: Option<(tauri::AppHandle, String)>,
    timeout: std::time::Duration,
    cancel: Option<&crate::state::CompileCancel>,
    environment: &EngineEnvironment,
) -> Result<(String, Option<i32>), String> {
    let path_env = crate::biber_toolchain::compile_path_env_for(
        path,
        environment.path_excluded_root(working_dir),
    );
    let child_biber = prepare_child_biber(path, &path_env).await;
    let path_env = match &child_biber {
        Some(child_biber) => child_biber.path_env(&path_env),
        None => path_env,
    };
    let mut command = supervised_command(
        path,
        args,
        working_dir,
        &path_env,
        child_biber.as_ref(),
        environment,
    );

    let mut child = command.spawn().map_err(|error| {
        let tool = path
            .file_stem()
            .map(|stem| stem.to_string_lossy().into_owned())
            .unwrap_or_else(|| path.display().to_string());
        String::from(
            crate::app_error::AppError::new("compile.tool_blocked")
                .param("tool", tool)
                .detail(error),
        )
    })?;
    let child_pid = match child.id() {
        Some(pid) => pid,
        None => {
            let _ = child.start_kill();
            return Err(format!(
                "spawned compiler {} did not expose a process id",
                path.display()
            ));
        }
    };
    let _containment = match crate::proc::contain_process_tree(child_pid) {
        Ok(containment) => containment,
        Err(error) => {
            let _ = tokio::time::timeout(
                COMPILER_PIPE_CLOSE_TIMEOUT,
                terminate_process_tree(child_pid),
            )
            .await;
            let _ = child.start_kill();
            let _ = tokio::time::timeout(COMPILER_PIPE_CLOSE_TIMEOUT, child.wait()).await;
            return Err(format!(
                "failed to contain compiler process tree for {}: {error}",
                path.display()
            ));
        }
    };
    let _registration = CompileChildRegistration {
        cancel,
        pid: Some(child_pid),
    };
    if let Some(cancel) = cancel {
        if !cancel.attach(child_pid) {
            terminate_process_tree(child_pid).await;
        }
    }
    if let (Some(text), Some(mut stdin)) = (environment.stdin.clone(), child.stdin.take()) {
        tokio::spawn(async move {
            use tokio::io::AsyncWriteExt;
            let _ = stdin.write_all(text.as_bytes()).await;
        });
    }
    let stdout = child.stdout.take().ok_or("stdout was not captured")?;
    let stderr = child.stderr.take().ok_or("stderr was not captured")?;
    let emitted = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let clock = std::sync::Arc::new(oleafly_core::compile_limit::CompileClock::start(timeout));
    let (app, event) = emitter.map_or((None, String::new()), |(app, event)| (Some(app), event));
    let out = tokio::spawn(pump_external_output(
        stdout,
        app.clone(),
        event.clone(),
        emitted.clone(),
        clock.clone(),
    ));
    let err = tokio::spawn(pump_external_output(
        stderr,
        app.clone(),
        event.clone(),
        emitted.clone(),
        clock.clone(),
    ));
    let status = match wait_within_limit(&mut child, &clock).await {
        Some(Ok(status)) => status,
        Some(Err(error)) => {
            terminate_process_tree(child_pid).await;
            let _ = child.start_kill();
            let _ = tokio::time::timeout(COMPILER_PIPE_CLOSE_TIMEOUT, child.wait()).await;
            let _ = drain_compiler_output(out, err, Some(child_pid)).await;
            return Err(format!("failed waiting for {}: {error}", path.display()));
        }
        None => {
            let line = clock.timed_out_line(std::time::Instant::now());
            terminate_process_tree(child_pid).await;
            let _ = child.kill().await;
            let _ = child.wait().await;
            let (log, pipes_stalled) = drain_compiler_output(out, err, Some(child_pid)).await;
            let mut log = reserve_log_budget(log, LOG_NOTES_RESERVE_BYTES + line.len());
            let message = if log.is_empty() || log.ends_with('\n') {
                line
            } else {
                format!("\n{line}")
            };
            if let Some(app) = app {
                let emit_len = claim_emit_budget(&emitted, message.len());
                if emit_len > 0 {
                    let text = String::from_utf8_lossy(&message.as_bytes()[..emit_len]);
                    let _ = app.emit(&event, text.as_ref());
                }
            }
            append_bounded(&mut log, message.as_bytes());
            if pipes_stalled {
                append_bounded(
                    &mut log,
                    b"\nerror: compiler descendants kept output pipes open and were stopped",
                );
            }
            return Ok((log, Some(-1)));
        }
    };
    let (mut log, pipes_stalled) = drain_compiler_output(out, err, Some(child_pid)).await;
    if pipes_stalled {
        append_bounded(
            &mut log,
            b"\nerror: compiler descendants kept output pipes open and were stopped",
        );
        return Ok((log, Some(-1)));
    }
    if let Some(note) = compiler_crash_note(&status) {
        if let Some(app) = app {
            let emit_len = claim_emit_budget(&emitted, note.len());
            if emit_len > 0 {
                let text = String::from_utf8_lossy(&note.as_bytes()[..emit_len]);
                let _ = app.emit(&event, text.as_ref());
            }
        }
        append_bounded(&mut log, note.as_bytes());
    }
    Ok((log, status.code()))
}

use oleafly_core::engine_spec::compiler_crash_note;

#[derive(Clone, PartialEq, Eq)]
struct ArtifactIdentity {
    len: u64,
    modified: Option<std::time::SystemTime>,
    digest: Option<[u8; 32]>,
}

#[derive(Clone, PartialEq, Eq)]
enum RetainedArtifactIdentity {
    Known(ArtifactIdentity),
    Unreadable,
}

#[derive(Clone, PartialEq, Eq)]
struct RetainedArtifact {
    path: PathBuf,
    identity: RetainedArtifactIdentity,
}

fn artifact_identity(path: &Path) -> Option<ArtifactIdentity> {
    use sha2::Digest;
    use std::io::Read;

    let metadata = std::fs::metadata(path).ok()?;
    let digest = std::fs::File::open(path).ok().and_then(|mut file| {
        let mut hasher = sha2::Sha256::new();
        let mut buffer = [0_u8; 64 * 1024];
        loop {
            match file.read(&mut buffer) {
                Ok(0) => break Some(hasher.finalize().into()),
                Ok(read) => hasher.update(&buffer[..read]),
                Err(_) => break None,
            }
        }
    })?;
    Some(ArtifactIdentity {
        len: metadata.len(),
        modified: metadata.modified().ok(),
        digest: Some(digest),
    })
}

fn clear_latexmk_page_files(engine: DocumentEngineId, artifacts: &EngineArtifacts) {
    if engine != DocumentEngineId::Latexmk {
        return;
    }
    let Some(pdf) = &artifacts.pdf else {
        return;
    };
    for extension in ["xdv", "dvi"] {
        let _ = std::fs::remove_file(pdf.with_extension(extension));
    }
}

fn clear_stale_artifacts(artifacts: &EngineArtifacts) -> Vec<RetainedArtifact> {
    let mut retained = Vec::new();
    for path in [
        &artifacts.pdf,
        &artifacts.log,
        &artifacts.synctex,
        &artifacts.html,
    ]
    .into_iter()
    .flatten()
    {
        match std::fs::remove_file(path) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(_) => {
                retained.push(RetainedArtifact {
                    path: path.clone(),
                    identity: artifact_identity(path).map_or(
                        RetainedArtifactIdentity::Unreadable,
                        RetainedArtifactIdentity::Known,
                    ),
                });
            }
        }
    }
    retained
}

fn clear_stale_compile_artifacts(
    artifacts: &EngineArtifacts,
    biber_control: Option<&Path>,
) -> Vec<RetainedArtifact> {
    let mut retained = clear_stale_artifacts(artifacts);
    if let Some(path) = biber_control {
        let _ = std::fs::remove_file(path.with_extension("blg"));
        if let Some(build_dir) = path.parent() {
            oleafly_core::build_output::clear_biber_source_copies(
                build_dir,
                crate::paths::ENTRY_STEM,
            );
        }
        match std::fs::remove_file(path) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(_) => retained.push(RetainedArtifact {
                path: path.to_path_buf(),
                identity: artifact_identity(path).map_or(
                    RetainedArtifactIdentity::Unreadable,
                    RetainedArtifactIdentity::Known,
                ),
            }),
        }
    }
    retained
}

fn artifact_is_fresh_with(
    path: &Path,
    retained: &[RetainedArtifact],
    exists: impl FnOnce(&Path) -> bool,
    identity: impl FnOnce(&Path) -> Option<ArtifactIdentity>,
) -> bool {
    let Some(stale) = retained.iter().find(|stale| stale.path == path) else {
        return exists(path);
    };
    match &stale.identity {
        RetainedArtifactIdentity::Known(old) => {
            identity(path).is_some_and(|current| &current != old)
        }
        RetainedArtifactIdentity::Unreadable => false,
    }
}

fn artifact_is_fresh(path: &Path, retained: &[RetainedArtifact]) -> bool {
    artifact_is_fresh_with(path, retained, Path::exists, artifact_identity)
}

pub(crate) fn tex_bundle_url() -> String {
    oleafly_core::engine_spec::tex_bundle_url()
}

use oleafly_core::engine_spec::{args_without_bundle, is_bundle_fetch_failure};

pub(crate) fn place_in_compile_directory(
    engine: DocumentEngineId,
    spec: EngineCompileSpec,
    project_dir: &Path,
    compile_dir: &Path,
) -> Result<EngineCompileSpec, String> {
    match engine {
        DocumentEngineId::Latex => Ok(search_compile_directory_first(
            spec,
            project_dir,
            compile_dir,
        )),
        DocumentEngineId::Latexmk => {
            run_latexmk_from_compile_directory(spec, project_dir, compile_dir)
        }
        _ => Ok(spec),
    }
}

fn run_latexmk_from_compile_directory(
    mut spec: EngineCompileSpec,
    project_dir: &Path,
    compile_dir: &Path,
) -> Result<EngineCompileSpec, String> {
    let EngineInput::Direct(input) = &spec.input else {
        return Ok(spec);
    };
    let Ok(entry) = input.strip_prefix(compile_dir) else {
        return Ok(spec);
    };
    if !compile_dir.starts_with(project_dir) {
        return Ok(spec);
    }
    let from_root = latexmk_path_arg(project_dir, input, None, "input")?;
    let from_compile_dir = latexmk_relative_path_arg(entry)?;
    if spec.args.last() != Some(&from_root) {
        return Ok(spec);
    }
    if spec.artifacts.output_dir.starts_with(project_dir)
        && !write_in_tree_build_by_absolute_path(&mut spec, project_dir)
    {
        return Ok(spec);
    }
    if let Some(last) = spec.args.last_mut() {
        *last = from_compile_dir;
    }
    spec.working_dir = compile_dir.to_owned();
    Ok(with_bibtex_search_path(spec))
}

fn write_in_tree_build_by_absolute_path(spec: &mut EngineCompileSpec, project_dir: &Path) -> bool {
    if cfg!(windows) && windows_network_path(project_dir) {
        return false;
    }
    let Ok(absolute) = latexmk_absolute_path_arg(&spec.artifacts.output_dir) else {
        return false;
    };
    if !in_tree_absolute_path_reaches_latexmk(&absolute, cfg!(windows)) {
        return false;
    }
    let Some(argument) = spec.args.iter_mut().find(|arg| arg.starts_with("-outdir=")) else {
        return false;
    };
    *argument = format!("-outdir={absolute}");
    let mut environment =
        std::mem::take(&mut spec.environment).with_variable("TEXMFOUTPUT", absolute);
    for (name, value) in oleafly_core::project_search_environment(project_dir) {
        environment = environment.with_variable(name, value);
    }
    spec.environment = environment;
    true
}

fn in_tree_absolute_path_reaches_latexmk(absolute: &str, windows: bool) -> bool {
    !windows || absolute.is_ascii()
}

pub(crate) fn search_compile_directory_first(
    mut spec: EngineCompileSpec,
    project_dir: &Path,
    compile_dir: &Path,
) -> EngineCompileSpec {
    let project = format!("search-path={}", project_dir.to_string_lossy());
    if let Some(position) = spec.args.iter().position(|argument| *argument == project) {
        if position > 0 && spec.args[position - 1] == "-Z" {
            spec.args.splice(
                position - 1..position - 1,
                [
                    "-Z".to_string(),
                    format!("search-path={}", compile_dir.to_string_lossy()),
                ],
            );
        }
    }
    spec
}

pub fn existing_compiled_pdf_path(
    project_id: &str,
    metadata_name: &str,
    main_document: &str,
) -> Result<Option<PathBuf>, String> {
    let engine = engine_for(metadata_name, main_document)?;
    let Some(build) = crate::paths::existing_build_dir(project_id)? else {
        return Ok(None);
    };
    engine
        .artifacts(&build, CompileTarget::Main { main_document })
        .pdf
        .map(Some)
        .ok_or_else(|| {
            format!(
                "engine `{}` does not produce PDF output",
                engine.id().as_str()
            )
        })
}

#[cfg(test)]
mod tests {
    use super::*;
    use oleafly_core::engine_spec::{MERMAID_FIGURES_FILTER, MERMAID_FIGURES_FILTER_NAME};

    #[test]
    fn a_timed_out_compile_gets_its_own_card_even_after_a_tex_error() {
        let log = "! Undefined control sequence.\nerror: process timed out after 300.000s and was stopped";
        let mut errors = vec![CompileError {
            kind: "error".into(),
            message: "Undefined control sequence.".into(),
            ..Default::default()
        }];
        append_unreported_failure(DocumentEngineId::Latex, log, false, false, &mut errors);
        let card = errors.last().unwrap();
        assert_eq!(card.code.as_deref(), Some("compile.timed_out"));
        assert_eq!(card.params.get("minutes").map(String::as_str), Some("5"));
        assert!(card
            .explanation
            .as_deref()
            .unwrap()
            .starts_with("The compile ran longer than 5 minutes"));
    }

    #[test]
    fn a_failure_with_no_error_line_shows_the_last_line_the_compiler_printed() {
        let mut errors = Vec::new();
        append_unreported_failure(
            DocumentEngineId::Latex,
            "note: starting\nsh: 1: xelatex: not found\n\n",
            false,
            false,
            &mut errors,
        );
        assert_eq!(errors.len(), 1);
        assert_eq!(errors[0].kind, "error");
        assert_eq!(errors[0].code.as_deref(), Some("compile.no_diagnostic"));
        assert_eq!(errors[0].message, "sh: 1: xelatex: not found");
        assert_eq!(
            errors[0].params.get("line").map(String::as_str),
            Some("sh: 1: xelatex: not found")
        );
        assert!(errors[0]
            .explanation
            .as_deref()
            .unwrap()
            .ends_with("sh: 1: xelatex: not found"));
    }

    #[test]
    fn a_silent_failure_says_nothing_was_printed() {
        let mut errors = Vec::new();
        append_unreported_failure(DocumentEngineId::Latex, "  \n", false, false, &mut errors);
        assert_eq!(errors[0].code.as_deref(), Some("compile.no_output"));
    }

    #[test]
    fn reported_stopped_or_successful_compiles_get_no_extra_card() {
        let reported = CompileError {
            kind: "error".into(),
            message: "! Missing $ inserted.".into(),
            ..Default::default()
        };
        let mut errors = vec![reported.clone()];
        append_unreported_failure(
            DocumentEngineId::Latex,
            "last line",
            false,
            false,
            &mut errors,
        );
        assert_eq!(errors, vec![reported]);
        let mut errors = Vec::new();
        append_unreported_failure(
            DocumentEngineId::Latex,
            "last line",
            false,
            true,
            &mut errors,
        );
        append_unreported_failure(
            DocumentEngineId::Latex,
            "last line",
            true,
            false,
            &mut errors,
        );
        assert!(errors.is_empty());
    }

    #[test]
    fn an_unreported_line_is_cut_on_a_character_boundary() {
        let mut errors = Vec::new();
        append_unreported_failure(
            DocumentEngineId::Latex,
            &"错".repeat(400),
            false,
            false,
            &mut errors,
        );
        assert_eq!(errors[0].message.chars().count(), UNREPORTED_LINE_CHARS);
    }

    #[test]
    fn a_missing_sidecar_is_coded_without_the_full_path() {
        let error = resolve_bundled_sidecar("no-such-sidecar").unwrap_err();
        assert!(error.contains("compile.tool_missing"), "{error}");
        assert_eq!(
            crate::app_error::english(&error)
                .map(|text| text.starts_with("Oleafly's no-such-sidecar is missing.")),
            Some(true)
        );
    }

    #[test]
    fn entry_names_match_core() {
        assert_eq!(
            crate::paths::ENTRY_STEM,
            oleafly_core::engine_spec::ENTRY_STEM
        );
        assert_eq!(
            crate::paths::ENTRY_TEX,
            oleafly_core::engine_spec::ENTRY_TEX
        );
    }
    #[cfg(unix)]
    use crate::test_wait;

    #[test]
    fn bibliography_discovery_leaves_cloud_placeholders_alone() {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path();
        std::fs::create_dir(root.join("refs")).unwrap();
        std::fs::write(root.join("refs/local.bib"), "@misc{a}").unwrap();
        std::fs::write(root.join("refs/evicted.bib"), "@misc{b}").unwrap();
        crate::cloud_files::test_support::mark(&root.join("refs/evicted.bib"));

        assert_eq!(discover_bibliographies(root).unwrap(), ["refs/local.bib"]);
    }

    #[test]
    fn tex_program_magic_never_names_an_arbitrary_program() {
        assert_eq!(detect_tex_program_magic("% !TeX program = /bin/sh\n"), None);
        assert_eq!(
            detect_tex_program_magic("% !TeX program = lualatex --shell-escape\n"),
            None
        );
    }

    fn joined(dir: &str, name: &str) -> String {
        Path::new(dir).join(name).to_string_lossy().into_owned()
    }

    #[tokio::test]
    async fn timed_out_output_drain_aborts_and_drops_the_reader_task() {
        struct DropFlag(std::sync::Arc<std::sync::atomic::AtomicBool>);
        impl Drop for DropFlag {
            fn drop(&mut self) {
                self.0.store(true, std::sync::atomic::Ordering::SeqCst);
            }
        }

        let dropped = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
        let (started_tx, started_rx) = tokio::sync::oneshot::channel();
        let task_dropped = dropped.clone();
        let task = tokio::spawn(async move {
            let _guard = DropFlag(task_dropped);
            let _ = started_tx.send(());
            std::future::pending::<()>().await;
            String::new()
        });
        started_rx.await.unwrap();

        assert!(
            drain_output_task(task, std::time::Duration::from_millis(10))
                .await
                .is_err()
        );
        assert!(dropped.load(std::sync::atomic::Ordering::SeqCst));
    }

    fn image_project() -> tempfile::TempDir {
        let project = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(project.path().join("figures")).unwrap();
        std::fs::write(project.path().join("figures/empty.png"), b"").unwrap();
        std::fs::write(project.path().join("figures/unused.png"), b"").unwrap();
        std::fs::write(
            project.path().join("main.tex"),
            "\\includegraphics{figures/empty.png}\n",
        )
        .unwrap();
        project
    }

    const EMPTY_IMAGE: &str =
        "The image figures/empty.png is empty. Export the image again or replace the file.";

    #[tokio::test]
    async fn failed_compiles_name_the_broken_image_first_and_in_the_log() {
        let project = image_project();
        let mut log = "! Unable to load picture or PDF file 'figures/empty.png'.\nl.6 \\includegraphics{figures/empty.png}\n".to_string();
        let mut errors = parse_tex_log_errors(&log);
        let original = errors.clone();
        explain_image_failures(project.path(), "main.tex", &mut log, &mut errors).await;
        assert_eq!(errors[0].message, EMPTY_IMAGE);
        assert_eq!(errors[0].kind, "error");
        assert_eq!(errors[1..], original[..]);
        assert!(log.ends_with(&format!("\n[Oleafly] {EMPTY_IMAGE}\n")));
        let diagnostics = oleafly_core::parse_latex_log(&log, Some("main.tex"));
        assert!(diagnostics
            .iter()
            .any(|diagnostic| diagnostic.message == EMPTY_IMAGE));
    }

    #[tokio::test]
    async fn an_unnamed_image_failure_is_traced_through_the_main_document() {
        let project = image_project();
        let mut log = "(ts1cmr.fd)libpng error: IHDR: CRC error".to_string();
        let mut errors = parse_tex_log_errors(&log);
        explain_image_failures(project.path(), "main.tex", &mut log, &mut errors).await;
        assert_eq!(
            errors
                .iter()
                .map(|error| error.message.as_str())
                .collect::<Vec<_>>(),
            [EMPTY_IMAGE]
        );
    }

    #[tokio::test]
    async fn compiles_without_a_broken_image_keep_their_log_and_errors() {
        let project = image_project();
        for original in [
            "! Undefined control sequence.\nl.4 \\foo\n",
            "warning  (file figures/empty.png) (pdf inclusion): odd\n! Undefined control sequence.\nl.4 \\foo\n",
        ] {
            let mut log = original.to_string();
            let mut errors = parse_tex_log_errors(&log);
            let before_errors = errors.clone();
            explain_image_failures(project.path(), "main.tex", &mut log, &mut errors).await;
            assert_eq!(log, original);
            assert_eq!(errors, before_errors);
        }
    }

    #[test]
    fn image_cards_never_push_tex_errors_out_of_the_ask_ai_budget() {
        let findings = [oleafly_core::ImageFinding::Broken(
            oleafly_core::BrokenImage {
                path: "figures/empty.png".into(),
                problem: oleafly_core::ImageProblem::Empty,
            },
        )];
        let crowded: String = (0..oleafly_core::ASK_AI_ERROR_BUDGET)
            .map(|index| format!("! Error number {index}.\n"))
            .collect();
        let mut log = crowded.clone();
        let mut errors = parse_tex_log_errors(&log);
        apply_image_findings(&findings, &mut log, &mut errors);
        let messages: Vec<&str> = errors.iter().map(|error| error.message.as_str()).collect();
        assert_eq!(messages.last(), Some(&EMPTY_IMAGE));
        assert!(messages[..oleafly_core::ASK_AI_ERROR_BUDGET]
            .iter()
            .all(|message| message.starts_with("Error number")));
        let ask_ai = std::fs::read_to_string(
            Path::new(env!("CARGO_MANIFEST_DIR")).join("../src/features/ask-ai-compile-errors.ts"),
        )
        .unwrap();
        assert!(ask_ai.contains(".filter((error) => error.kind === \"error\")"));
        assert!(ask_ai.contains(&format!(".slice(0, {})", oleafly_core::ASK_AI_ERROR_BUDGET)));
    }

    #[test]
    fn image_check_runs_only_for_failed_main_latex_compiles() {
        let main = CompileTarget::Main {
            main_document: "main.tex",
        };
        let isolated = CompileTarget::Isolated {
            source_path: Path::new("chapter.tex"),
            output_stem: "chapter",
        };
        for engine in [DocumentEngineId::Latex, DocumentEngineId::Latexmk] {
            assert_eq!(
                image_check_main_document(engine, main, false, false),
                Some("main.tex")
            );
            assert_eq!(image_check_main_document(engine, main, true, false), None);
            assert_eq!(image_check_main_document(engine, main, false, true), None);
            assert_eq!(
                image_check_main_document(engine, isolated, false, false),
                None
            );
        }
        for engine in [DocumentEngineId::Typst, DocumentEngineId::Markdown] {
            assert_eq!(image_check_main_document(engine, main, false, false), None);
        }
    }

    #[test]
    fn extensionless_inputs_resolve_to_tex_files_in_the_project() {
        let project = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(project.path().join("kapitoly")).unwrap();
        std::fs::write(project.path().join("kapitoly/\u{fa}vod.tex"), "x").unwrap();
        std::fs::create_dir_all(project.path().join("data")).unwrap();
        std::fs::write(project.path().join("data/table"), "x").unwrap();
        let error = |file: &str| CompileError {
            line: Some(2),
            file: Some(file.to_string()),
            message: "Undefined control sequence.".into(),
            kind: "error".into(),
            explanation: None,
            ..Default::default()
        };
        let mut errors = vec![
            error("kapitoly/\u{fa}vod"),
            error("data/table"),
            error("main.tex"),
            error("article.cls"),
        ];
        let mut diagnostics = oleafly_core::parse_latex_log(
            "(./main.tex (kapitoly/\u{fa}vod\n! Undefined control sequence.\nl.2 \\bad\n\n))",
            Some("main.tex"),
        );
        resolve_extensionless_inputs(project.path(), &mut errors, &mut diagnostics);
        let files: Vec<_> = errors.iter().map(|error| error.file.as_deref()).collect();
        assert_eq!(
            files,
            [
                Some("kapitoly/\u{fa}vod.tex"),
                Some("data/table"),
                Some("main.tex"),
                Some("article.cls"),
            ]
        );
        assert_eq!(
            diagnostics[0].file.as_deref(),
            Some("./kapitoly/\u{fa}vod.tex")
        );
    }

    #[test]
    fn log_files_of_a_nested_latexmk_run_are_named_from_the_project_root() {
        let project = latexmk_test_home().join("repo");
        let error = |file: &str| CompileError {
            line: Some(3),
            file: Some(file.to_string()),
            message: "Undefined control sequence.".into(),
            kind: "error".into(),
            explanation: None,
            ..Default::default()
        };
        let absolute = latexmk_test_home().join("texmf").join("article.cls");
        let absolute = absolute.to_string_lossy().into_owned();
        let mut errors = vec![
            error("./sections/intro.tex"),
            error("main.tex"),
            error("paper/main.tex"),
            error(&absolute),
        ];
        let mut diagnostics = oleafly_core::parse_latex_log(
            "(./main.tex (./sections/intro.tex\n! Undefined control sequence.\nl.3 \\bad\n\n))",
            Some("paper/main.tex"),
        );
        rebase_log_files(
            &project,
            &project.join("paper"),
            Some("paper/main.tex"),
            &mut errors,
            &mut diagnostics,
        );
        let files: Vec<_> = errors.iter().map(|error| error.file.as_deref()).collect();
        assert_eq!(
            files,
            [
                Some("paper/sections/intro.tex"),
                Some("paper/main.tex"),
                Some("paper/main.tex"),
                Some(absolute.as_str()),
            ]
        );
        assert_eq!(
            diagnostics[0].file.as_deref(),
            Some("paper/sections/intro.tex")
        );

        let mut untouched = vec![error("./sections/intro.tex")];
        rebase_log_files(
            &project,
            &project,
            Some("main.tex"),
            &mut untouched,
            &mut [],
        );
        assert_eq!(untouched[0].file.as_deref(), Some("./sections/intro.tex"));
    }

    #[test]
    fn log_files_rejoin_characters_split_by_the_tex_line_wrap() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("x.log");
        let warning =
            "LaTeX Warning: Reference `\u{17e}\u{17e}' on page 1 undefined on input line 3.";
        let bytes = warning.as_bytes();
        let cut = warning.find('`').unwrap() + 2;
        std::fs::write(&path, [&bytes[..cut], b"\n", &bytes[cut..]].concat()).unwrap();
        let log = read_log_bounded(&path).unwrap();
        assert_eq!(log, warning);
        let diagnostics = oleafly_core::parse_latex_log(&log, Some("main.tex"));
        assert_eq!(diagnostics[0].line, Some(3));
        assert_eq!(
            diagnostics[0].message,
            "Cannot find reference `\u{17e}\u{17e}`."
        );
    }

    #[test]
    fn legacy_latex_names_dispatch_to_canonical_engine() {
        for name in ["", "latex", "tex", "tectonic", "xetex", "XeTeX", "luatex"] {
            let engine = engine_for(name, "chapters/main.tex").unwrap();
            assert_eq!(engine.id(), DocumentEngineId::Latex);
        }
    }

    #[test]
    fn latex_source_extensions_remain_compatible() {
        for document in ["main.tex", "main.ltx", "main.latex", "MAIN.TEX"] {
            assert!(engine_for("latex", document).is_ok(), "{document}");
        }
    }

    #[test]
    fn compiler_log_retention_is_bounded_and_marks_truncation() {
        let mut output = String::new();
        append_bounded(&mut output, &vec![b'x'; MAX_LOG_BYTES + 4096]);
        assert!(output.len() <= MAX_LOG_BYTES);
        assert!(output.ends_with(LOG_TRUNCATED));
        let length = output.len();
        append_bounded(&mut output, b"ignored");
        assert_eq!(output.len(), length);

        let mut exact = "x".repeat(MAX_LOG_BYTES);
        append_bounded(&mut exact, b"overflow");
        assert_eq!(exact.len(), MAX_LOG_BYTES);
        assert!(exact.ends_with(LOG_TRUNCATED));
    }

    #[test]
    fn compiler_log_truncation_preserves_utf8_boundaries() {
        let mut output = "x".repeat(MAX_LOG_BYTES - 2);
        append_bounded(&mut output, "界界".as_bytes());
        assert!(output.len() <= MAX_LOG_BYTES);
        assert!(output.ends_with(LOG_TRUNCATED));
        assert!(std::str::from_utf8(output.as_bytes()).is_ok());
    }

    #[test]
    fn compiler_ipc_emission_budget_is_global_and_bounded() {
        let counter = std::sync::atomic::AtomicUsize::new(0);
        assert_eq!(
            claim_emit_budget(&counter, MAX_EMITTED_LOG_BYTES - 7),
            MAX_EMITTED_LOG_BYTES - 7
        );
        assert_eq!(claim_emit_budget(&counter, 100), 7);
        assert_eq!(claim_emit_budget(&counter, 100), 0);
        assert_eq!(
            counter.load(std::sync::atomic::Ordering::Relaxed),
            MAX_EMITTED_LOG_BYTES
        );
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn a_crashed_compiler_says_so_and_a_killed_one_does_not() {
        async fn run(root: &Path, script: &str) -> (String, Option<i32>) {
            let args = vec!["-c".to_string(), script.to_string()];
            run_supervised_process(
                Path::new("/bin/sh"),
                &args,
                root,
                None,
                std::time::Duration::from_secs(10),
                None,
            )
            .await
            .unwrap()
        }
        let root = tempfile::tempdir().unwrap();
        let run = |script: &'static str| run(root.path(), script);
        let (log, code) = run("printf 'Running TeX ...'; kill -ABRT $$").await;
        assert_eq!(code, None);
        assert!(log.starts_with("Running TeX ..."), "{log}");
        assert!(
            log.contains("error: the compiler crashed (SIGABRT) before it finished"),
            "{log}"
        );
        let (log, code) = run("kill -SEGV $$").await;
        assert_eq!(code, None);
        assert!(log.contains("crashed (SIGSEGV)"), "{log}");
        let (log, code) = run("kill -KILL $$").await;
        assert_eq!(code, None);
        assert!(!log.contains("crashed"), "{log}");
        let (log, code) = run("printf 'error'; exit 1").await;
        assert_eq!(code, Some(1));
        assert!(!log.contains("crashed"), "{log}");
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn a_compiler_that_crashes_looking_up_a_font_gets_an_error_naming_it() {
        let root = tempfile::tempdir().unwrap();
        let script = "printf '(main.tex (fontspec.sty))'; printf 'warning: main.tex:5: \\nRequested font \"Fira Sans Light\" at 9.99997pt\\n' >&2; kill -SEGV $$";
        let args = vec!["-c".to_string(), script.to_string()];
        let (log, code) = run_supervised_process(
            Path::new("/bin/sh"),
            &args,
            root.path(),
            None,
            std::time::Duration::from_secs(10),
            None,
        )
        .await
        .unwrap();
        assert_eq!(code, None);
        let errors = LATEX_ENGINE.parse_errors(&log);
        assert_eq!(errors.len(), 1, "{log}");
        assert_eq!(errors[0].code.as_deref(), Some("tex.compiler_crashed_font"));
        assert_eq!(
            errors[0].params.get("font").map(String::as_str),
            Some("Fira Sans Light")
        );
        assert_eq!(
            (errors[0].file.as_deref(), errors[0].line),
            (Some("main.tex"), Some(5))
        );
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn stop_ends_the_wait_for_another_builds_lock() {
        use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
        let root = tempfile::tempdir().unwrap();
        let build = root.path().join("build");
        std::fs::create_dir_all(&build).unwrap();
        let held = oleafly_core::build_output::BuildLock::try_acquire(&build)
            .unwrap()
            .unwrap();
        let stop = AtomicBool::new(false);
        let announced = AtomicUsize::new(0);
        let started = std::time::Instant::now();
        let waiting = wait_for_build_lock(
            &build,
            std::time::Duration::from_secs(30),
            COMPILE_TIMEOUT,
            || stop.load(Ordering::SeqCst),
            || {
                announced.fetch_add(1, Ordering::SeqCst);
                stop.store(true, Ordering::SeqCst);
            },
        )
        .await
        .unwrap();
        assert!(matches!(waiting, BuildLockWait::Stopped));
        assert_eq!(announced.load(Ordering::SeqCst), 1);
        assert!(started.elapsed() < std::time::Duration::from_secs(5));
        drop(held);

        let free = wait_for_build_lock(
            &build,
            std::time::Duration::from_secs(30),
            COMPILE_TIMEOUT,
            || true,
            || {},
        )
        .await
        .unwrap();
        assert!(matches!(free, BuildLockWait::Held(Some(_))));
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn a_lock_file_that_cannot_be_used_stops_the_build() {
        let root = tempfile::tempdir().unwrap();
        let build = root.path().join("build");
        std::fs::create_dir_all(&build).unwrap();
        let elsewhere = root.path().join("elsewhere");
        std::fs::write(&elsewhere, b"keep").unwrap();
        std::os::unix::fs::symlink(
            &elsewhere,
            oleafly_core::build_output::build_lock_path(&build),
        )
        .unwrap();
        let error = wait_for_build_lock(
            &build,
            std::time::Duration::from_secs(5),
            COMPILE_TIMEOUT,
            || false,
            || {},
        )
        .await
        .err()
        .expect("a build must not run without its lock");
        assert!(error.contains("couldn't lock the build folder"), "{error}");
        assert_eq!(std::fs::read(&elsewhere).unwrap(), b"keep");
    }

    #[tokio::test]
    async fn the_lock_wait_still_times_out_when_nobody_stops_it() {
        let root = tempfile::tempdir().unwrap();
        let build = root.path().join("build");
        std::fs::create_dir_all(&build).unwrap();
        let _held = oleafly_core::build_output::BuildLock::try_acquire(&build)
            .unwrap()
            .unwrap();
        let error = wait_for_build_lock(
            &build,
            std::time::Duration::from_millis(250),
            COMPILE_TIMEOUT,
            || false,
            || {},
        )
        .await
        .err()
        .expect("the wait must time out");
        assert!(error.contains("still running"), "{error}");
    }

    #[test]
    fn a_folder_lock_outlives_every_limit_the_build_can_reach() {
        let plain = EngineEnvironment::default();
        assert_eq!(plain.time_limit(), COMPILE_TIMEOUT);
        assert!(plain.build_lock_stale_after() > oleafly_core::compile_limit::DOWNLOAD_TIME_LIMIT);
        let notebook = EngineEnvironment::default()
            .with_time_limit(oleafly_core::compile_limit::NOTEBOOK_TIME_LIMIT);
        assert_eq!(
            notebook.time_limit(),
            oleafly_core::compile_limit::NOTEBOOK_TIME_LIMIT
        );
        assert!(notebook.build_lock_stale_after() > notebook.time_limit());
    }

    #[cfg(unix)]
    #[test]
    fn a_folder_lock_younger_than_the_limit_is_not_taken_as_stale() {
        let root = tempfile::tempdir().unwrap();
        let build = root.path().join("build");
        let (held, _) = try_build_lock(&build, false, COMPILE_TIMEOUT).unwrap();
        assert!(held.is_some());
        let (second, _) = try_build_lock(&build, false, COMPILE_TIMEOUT).unwrap();
        assert!(second.is_none());
    }

    #[test]
    fn a_warm_cache_fetch_failure_stays_in_the_log_after_a_clean_exit() {
        let root = tempfile::tempdir().unwrap();
        let log_path = root.path().join("main.log");
        std::fs::write(&log_path, "! LaTeX Error: File `biblatex.sty' not found.\n").unwrap();
        let spec = EngineCompileSpec {
            executable: EngineExecutable::BundledSidecar("tectonic"),
            args: Vec::new(),
            input: EngineInput::Direct(root.path().join("main.tex")),
            artifacts: EngineArtifacts {
                output_dir: root.path().to_owned(),
                pdf: None,
                log: Some(log_path),
                synctex: None,
                html: None,
            },
            working_dir: root.path().to_owned(),
            environment: EngineEnvironment::default(),
        };
        let fetch = "warning: failure fetching \"biblatex.sty\" from network (1/3)\ncaused by: unexpected HTTP response code 403 Forbidden for URL https://x/y.tar\nwarning: open of input biblatex.sty failed\ncaused by: failed to download \"biblatex.sty\"; please check your network connection.\n";
        let stdout = format!("{fetch}{}", "tex output line\n".repeat(2000));
        assert!(stdout.len() > ENGINE_OUTPUT_TAIL_BYTES + fetch.len());
        let log = combined_compile_log(&spec, stdout, Some(0), "", "");
        assert!(log.contains("please check your network connection"));
        assert!(log.contains("response code 403"));
        assert!(!log.contains("tex output line"));
        assert!(log.contains(ENGINE_OUTPUT_MARKER));
    }

    #[test]
    fn a_successful_retry_keeps_the_fallback_note_in_the_log() {
        let root = tempfile::tempdir().unwrap();
        let log_path = root.path().join("main.log");
        std::fs::write(&log_path, "This is the file log\n").unwrap();
        let spec = EngineCompileSpec {
            executable: EngineExecutable::BundledSidecar("tectonic"),
            args: Vec::new(),
            input: EngineInput::Direct(root.path().join("main.tex")),
            artifacts: EngineArtifacts {
                output_dir: root.path().to_owned(),
                pdf: None,
                log: Some(log_path),
                synctex: None,
                html: None,
            },
            working_dir: root.path().to_owned(),
            environment: EngineEnvironment::default(),
        };
        let stdout = format!(
            "{}note: Running TeX ...\n",
            oleafly_core::engine_spec::BUNDLE_FALLBACK_NOTE
        );
        let log = combined_compile_log(&spec, stdout, Some(0), "", "");
        assert!(log.contains(oleafly_core::engine_spec::BUNDLE_FALLBACK_NOTE));
        assert!(!log.contains("note: Running TeX"));
    }

    #[tokio::test]
    async fn a_failed_retry_puts_the_first_runs_file_log_back() {
        let root = tempfile::tempdir().unwrap();
        let log_path = root.path().join("main.log");
        std::fs::write(&log_path, "first run\n").unwrap();
        let spec = EngineCompileSpec {
            executable: EngineExecutable::BundledSidecar("tectonic"),
            args: Vec::new(),
            input: EngineInput::Direct(root.path().join("main.tex")),
            artifacts: EngineArtifacts {
                output_dir: root.path().to_owned(),
                pdf: None,
                log: Some(log_path.clone()),
                synctex: None,
                html: None,
            },
            working_dir: root.path().to_owned(),
            environment: EngineEnvironment::default(),
        };
        let first = first_run_log(&spec).await;
        std::fs::write(&log_path, "! Emergency stop.\n").unwrap();
        restore_first_run_log(&spec, first).await;
        assert_eq!(std::fs::read_to_string(&log_path).unwrap(), "first run\n");
    }

    #[test]
    fn a_clean_run_adds_nothing_to_the_file_log() {
        let root = tempfile::tempdir().unwrap();
        let log_path = root.path().join("main.log");
        std::fs::write(&log_path, "This is the file log\n").unwrap();
        let spec = EngineCompileSpec {
            executable: EngineExecutable::BundledSidecar("tectonic"),
            args: Vec::new(),
            input: EngineInput::Direct(root.path().join("main.tex")),
            artifacts: EngineArtifacts {
                output_dir: root.path().to_owned(),
                pdf: None,
                log: Some(log_path),
                synctex: None,
                html: None,
            },
            working_dir: root.path().to_owned(),
            environment: EngineEnvironment::default(),
        };
        let log = combined_compile_log(&spec, "note: fine\n".into(), Some(0), "", "");
        assert_eq!(log, "This is the file log\n");
    }

    #[test]
    fn a_timeout_during_downloads_gets_the_download_card() {
        let mut errors = Vec::new();
        append_unreported_failure(
            DocumentEngineId::Latex,
            "note: downloading a.sty\nerror: process timed out after 1800.000s while TeX packages were downloading and was stopped\n",
            false,
            false,
            &mut errors,
        );
        assert_eq!(errors.len(), 1);
        assert_eq!(
            errors[0].code.as_deref(),
            Some("compile.timed_out_downloading")
        );
        assert_eq!(
            errors[0].params.get("minutes").map(String::as_str),
            Some("30")
        );
        assert!(errors[0]
            .explanation
            .as_deref()
            .unwrap()
            .contains("picks up where it stopped"));
    }

    #[test]
    fn a_notebook_timeout_gets_its_own_card_and_replaces_the_raw_line() {
        let mut errors = vec![CompileError {
            kind: "error".into(),
            message: "process timed out after 3600.000s and was stopped".into(),
            ..Default::default()
        }];
        append_unreported_failure(
            DocumentEngineId::Calepin,
            "Cell 2/3: 'slow'...\nerror: process timed out after 3600.000s and was stopped\n",
            false,
            false,
            &mut errors,
        );
        assert_eq!(errors.len(), 1);
        assert_eq!(errors[0].code.as_deref(), Some("notebook.timed_out"));
        assert_eq!(
            errors[0].params.get("minutes").map(String::as_str),
            Some("60")
        );
    }

    #[test]
    fn a_notebook_export_that_timed_out_returns_a_coded_error() {
        let message = notebook_failure(
            "Quarto",
            &[],
            "Cell 2/3: 'slow'...\nerror: process timed out after 3600.000s and was stopped",
        );
        assert_eq!(
            crate::app_error::code(&message).as_deref(),
            Some("notebook.timed_out")
        );
    }

    #[test]
    fn a_notebook_export_that_needs_setup_returns_the_coded_guidance() {
        let errors = quarto::parse_quarto_log(
            "Jupyter is not available in this Python installation.\nInstall with py -m pip install jupyter\n",
        );
        let message = notebook_failure("Quarto", &errors, "");
        assert_eq!(
            crate::app_error::code(&message).as_deref(),
            Some("notebook.jupyter_missing_command")
        );
        assert!(message.contains("py -m pip install jupyter"), "{message}");

        let r = quarto::parse_quarto_log(
            "ERROR: Error executing 'Rscript': Failed to spawn 'Rscript': entity not found\n\nUnable to locate an installed version of R.\n",
        );
        assert_eq!(
            crate::app_error::code(&notebook_failure("Quarto", &r, "")).as_deref(),
            Some("notebook.r_missing")
        );
    }

    #[test]
    fn a_notebook_export_failure_without_a_known_cause_keeps_the_tools_reason() {
        let errors = vec![CompileError {
            message: "Something broke".into(),
            kind: "error".into(),
            ..CompileError::default()
        }];
        let message = notebook_failure("Quarto", &errors, "");
        assert_eq!(
            crate::app_error::code(&message).as_deref(),
            Some("notebook.export_failed")
        );
        assert!(message.contains("Something broke"), "{message}");

        let tail = notebook_failure("Calepin", &[], "one\n\ntwo\nthree\nfour\n");
        assert!(tail.contains("two three four"), "{tail}");
    }

    #[test]
    fn notebook_engines_keep_quarto_from_passing_paranoid_reads_to_lualatex() {
        let working = tempfile::tempdir().unwrap();
        let command = supervised_command(
            Path::new("/usr/local/bin/quarto"),
            &["render".to_owned(), "main.qmd".to_owned()],
            working.path(),
            std::ffi::OsStr::new("/usr/bin"),
            None,
            &EngineEnvironment::inherited(None),
        );
        let openin = command
            .as_std()
            .get_envs()
            .find(|(name, _)| *name == "openin_any");
        assert_eq!(openin.map(|(_, value)| value), Some(None));
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn a_timeout_message_starts_its_own_line() {
        let root = tempfile::tempdir().unwrap();
        let (log, code) = run_supervised_process(
            Path::new("/bin/sh"),
            &[
                "-c".into(),
                "printf \"Cell 2/3: 'slow'...\"; sleep 5".into(),
            ],
            root.path(),
            None,
            std::time::Duration::from_millis(200),
            None,
        )
        .await
        .unwrap();
        assert_eq!(code, Some(-1));
        assert_eq!(
            log,
            "Cell 2/3: 'slow'...\nerror: process timed out after 0.200s and was stopped"
        );
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn download_progress_extends_the_limit_past_the_plain_timeout() {
        let root = tempfile::tempdir().unwrap();
        let script =
            "for i in 1 2 3 4; do echo \"note: downloading f$i.sty\"; sleep 0.2; done; echo done";
        let (log, code) = run_supervised_process(
            Path::new("/bin/sh"),
            &["-c".into(), script.into()],
            root.path(),
            None,
            std::time::Duration::from_millis(500),
            None,
        )
        .await
        .unwrap();
        assert_eq!(code, Some(0), "{log}");
        assert!(log.ends_with("done\n"), "{log}");
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn output_that_is_not_a_download_does_not_extend_the_limit() {
        let root = tempfile::tempdir().unwrap();
        let script = "while true; do echo \"note: Running TeX ...\"; sleep 0.05; done";
        let (log, code) = run_supervised_process(
            Path::new("/bin/sh"),
            &["-c".into(), script.into()],
            root.path(),
            None,
            std::time::Duration::from_millis(300),
            None,
        )
        .await
        .unwrap();
        assert_eq!(code, Some(-1));
        assert!(log.contains("timed out"), "{log}");
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn timeout_terminates_grandchild_process_group() {
        let root = tempfile::tempdir().unwrap().keep();
        let marker = root.join("grandchild-survived");
        let script = format!("(sleep 0.35; touch '{}') & wait", marker.display());
        let (log, code) = run_supervised_process(
            Path::new("/bin/sh"),
            &["-c".into(), script],
            &root,
            None,
            std::time::Duration::from_millis(75),
            None,
        )
        .await
        .unwrap();
        assert_eq!(code, Some(-1));
        assert!(log.contains("timed out"));
        tokio::time::sleep(std::time::Duration::from_millis(450)).await;
        assert!(
            !marker.exists(),
            "grandchild survived its process-group timeout"
        );
        let _ = std::fs::remove_dir_all(root);
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn exited_compiler_cannot_hang_on_inherited_output_pipes() {
        let root = tempfile::tempdir().unwrap().keep();
        let pid_path = root.join("descendant.pid");
        let script = format!(
            "sleep {} & printf '%s' \"$!\" > '{}'; exit 0",
            (2 * test_wait::CHILD_PATIENCE).as_secs(),
            pid_path.display()
        );
        let started = std::time::Instant::now();
        let (log, code) = run_supervised_process(
            Path::new("/bin/sh"),
            &["-c".into(), script],
            &root,
            None,
            test_wait::CHILD_PATIENCE,
            None,
        )
        .await
        .unwrap();

        assert_eq!(code, Some(-1));
        assert!(log.contains("kept output pipes open"), "{log}");
        assert!(started.elapsed() < test_wait::CHILD_PATIENCE);
        let pid = test_wait::read_until(&pid_path, test_wait::CHILD_PATIENCE, test_wait::pid)
            .await
            .expect("the shell must record its background descendant's process id");
        let stopped = tokio::time::timeout(test_wait::CHILD_PATIENCE, async {
            while unsafe { libc::kill(pid, 0) } == 0 {
                tokio::time::sleep(std::time::Duration::from_millis(10)).await;
            }
        })
        .await
        .is_ok();
        if !stopped {
            unsafe {
                libc::kill(pid, libc::SIGKILL);
            }
        }
        assert!(stopped, "the inherited-pipe descendant survived");
        let _ = std::fs::remove_dir_all(root);
    }

    #[allow(clippy::await_holding_lock)]
    #[tokio::test]
    async fn supervised_children_unpack_biber_under_the_data_root() {
        let _env_guard = crate::paths::data_dir_env_lock();
        let data = tempfile::tempdir().unwrap();
        let previous = std::env::var_os("OLEAFLY_DATA_DIR");
        std::env::set_var("OLEAFLY_DATA_DIR", data.path());
        #[cfg(unix)]
        let (program, args) = (
            Path::new("sh"),
            vec![
                "-c".to_string(),
                "printf %s \"$PAR_GLOBAL_TMPDIR\"".to_string(),
            ],
        );
        #[cfg(windows)]
        let (program, args) = (
            Path::new("powershell.exe"),
            vec![
                "-NoProfile".to_string(),
                "-Command".to_string(),
                "[Console]::Out.Write($env:PAR_GLOBAL_TMPDIR)".to_string(),
            ],
        );
        let outcome = run_supervised_process(
            program,
            &args,
            data.path(),
            None,
            std::time::Duration::from_secs(30),
            None,
        )
        .await;
        match previous {
            Some(value) => std::env::set_var("OLEAFLY_DATA_DIR", value),
            None => std::env::remove_var("OLEAFLY_DATA_DIR"),
        }
        let (log, code) = outcome.unwrap();
        let path_env = crate::biber_toolchain::compile_path_env_for(program, data.path());
        let expected = crate::biber_toolchain::biber_for_child(program, &path_env)
            .and_then(|biber| crate::biber_toolchain::unpack_dir_for(data.path(), &biber));
        assert_eq!(code, Some(0), "{log}");
        match expected {
            Some(expected) => {
                assert_eq!(log.trim(), expected.display().to_string());
                assert!(expected.starts_with(crate::biber_toolchain::unpack_root(data.path())));
                assert!(expected.is_dir());
                let kept = crate::biber_toolchain::bibers_for_programs(&[program.to_path_buf()]);
                assert!(
                    kept.iter().any(|biber| {
                        crate::biber_toolchain::unpack_dir_for(data.path(), biber).as_ref()
                            == Some(&expected)
                    }),
                    "{kept:?}"
                );
            }
            None => assert_eq!(log.trim(), ""),
        }
    }

    #[cfg(unix)]
    #[allow(clippy::await_holding_lock)]
    #[tokio::test]
    async fn latexmk_children_unpack_for_the_biber_on_their_path() {
        let _env_guard = crate::paths::data_dir_env_lock();
        let data = tempfile::tempdir().unwrap();
        let tools = tempfile::tempdir().unwrap();
        let latexmk = tools.path().join("latexmk");
        std::os::unix::fs::symlink("/bin/sh", &latexmk).unwrap();
        let biber = tools.path().join("biber");
        std::fs::write(&biber, b"#!/bin/sh\nexit 0\n").unwrap();
        let previous = std::env::var_os("OLEAFLY_DATA_DIR");
        std::env::set_var("OLEAFLY_DATA_DIR", data.path());
        let outcome = run_supervised_process(
            &latexmk,
            &[
                "-c".to_string(),
                "printf %s \"$PAR_GLOBAL_TMPDIR\"".to_string(),
            ],
            data.path(),
            None,
            std::time::Duration::from_secs(30),
            None,
        )
        .await;
        match previous {
            Some(value) => std::env::set_var("OLEAFLY_DATA_DIR", value),
            None => std::env::remove_var("OLEAFLY_DATA_DIR"),
        }
        let (log, code) = outcome.unwrap();
        let expected = crate::biber_toolchain::unpack_dir_for(data.path(), &biber).unwrap();
        assert_eq!(code, Some(0), "{log}");
        assert_eq!(log.trim(), expected.display().to_string());
        assert!(expected.is_dir());
        assert!(
            crate::biber_toolchain::bibers_for_programs(std::slice::from_ref(&latexmk))
                .contains(&biber)
        );
        if let Some(bundled) = crate::biber_toolchain::find_tectonic_biber() {
            assert_ne!(
                crate::biber_toolchain::unpack_dir_for(data.path(), &bundled),
                Some(expected)
            );
        }
    }

    #[cfg(target_os = "macos")]
    #[allow(clippy::await_holding_lock)]
    #[tokio::test]
    async fn latexmk_children_run_the_host_slice_of_a_universal_biber() {
        use std::os::unix::fs::PermissionsExt;
        let _env_guard = crate::paths::data_dir_env_lock();
        let data = tempfile::tempdir().unwrap();
        let tools = tempfile::tempdir().unwrap();
        let latexmk = tools.path().join("latexmk");
        std::os::unix::fs::symlink("/bin/sh", &latexmk).unwrap();
        let intel: &[u8] = b"#!/bin/sh\necho x86_64\n";
        let apple: &[u8] = b"#!/bin/sh\necho arm64\n";
        let mut universal = Vec::new();
        universal.extend_from_slice(&0xcafe_babe_u32.to_be_bytes());
        universal.extend_from_slice(&2_u32.to_be_bytes());
        for (cpu_type, subtype, offset, slice) in [
            (0x0100_0007_u32, 3_u32, 4096_u32, intel),
            (0x0100_000c, 0, 8192, apple),
        ] {
            for word in [cpu_type, subtype, offset, slice.len() as u32, 12] {
                universal.extend_from_slice(&word.to_be_bytes());
            }
        }
        for (offset, slice) in [(4096, intel), (8192, apple)] {
            universal.resize(offset, 0);
            universal.extend_from_slice(slice);
        }
        let biber = tools.path().join("biber");
        std::fs::write(&biber, &universal).unwrap();
        std::fs::set_permissions(&biber, std::fs::Permissions::from_mode(0o755)).unwrap();
        let previous = std::env::var_os("OLEAFLY_DATA_DIR");
        std::env::set_var("OLEAFLY_DATA_DIR", data.path());
        let outcome = run_supervised_process(
            &latexmk,
            &["-c".to_string(), "command -v biber && biber".to_string()],
            data.path(),
            None,
            std::time::Duration::from_secs(30),
            None,
        )
        .await;
        match previous {
            Some(value) => std::env::set_var("OLEAFLY_DATA_DIR", value),
            None => std::env::remove_var("OLEAFLY_DATA_DIR"),
        }
        let (log, code) = outcome.unwrap();
        let thin = crate::biber_toolchain::unpack_dir_for(data.path(), &biber)
            .unwrap()
            .join("bin")
            .join("biber");
        let (host, arch) = if cfg!(target_arch = "aarch64") {
            (apple, "arm64")
        } else {
            (intel, "x86_64")
        };
        assert_eq!(code, Some(0), "{log}");
        assert_eq!(
            log.lines().collect::<Vec<_>>(),
            vec![thin.display().to_string().as_str(), arch],
            "{log}"
        );
        assert_eq!(std::fs::read(&thin).unwrap(), host);
        assert_eq!(std::fs::read(&biber).unwrap(), universal);
        assert!(
            crate::biber_toolchain::bibers_for_programs(std::slice::from_ref(&latexmk))
                .contains(&biber)
        );
    }

    #[cfg(windows)]
    #[tokio::test]
    async fn timeout_terminates_windows_grandchild_tree() {
        let root = tempfile::tempdir().unwrap().keep();
        let marker = root.join("grandchild-survived");
        let escaped = marker.display().to_string().replace('\'', "''");
        let script = format!(
            "$p=Start-Process powershell.exe -PassThru -ArgumentList '-NoProfile','-Command','Start-Sleep -Milliseconds 350; Set-Content -LiteralPath ''{escaped}'' survived'; Wait-Process -Id $p.Id"
        );
        let (log, code) = run_supervised_process(
            Path::new("powershell.exe"),
            &["-NoProfile".into(), "-Command".into(), script],
            &root,
            None,
            std::time::Duration::from_millis(100),
            None,
        )
        .await
        .unwrap();
        assert_eq!(code, Some(-1));
        assert!(log.contains("timed out"));
        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
        assert!(
            !marker.exists(),
            "Windows grandchild survived task-tree timeout"
        );
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn descriptor_exposes_canonical_identity_and_capabilities() {
        let descriptor = descriptor_for("luatex", "main.ltx").unwrap();
        assert_eq!(descriptor.id, "latex");
        assert_eq!(descriptor.main_document, "main.ltx");
        assert_eq!(descriptor.source_extensions, ["tex", "ltx", "latex"]);
        assert!(descriptor.capabilities.produces_pdf);
        assert!(descriptor.capabilities.supports_synctex);
        assert_eq!(
            serde_json::to_value(&descriptor).unwrap(),
            serde_json::json!({
                "id": "latex",
                "label": "LaTeX",
                "source_format": "latex",
                "main_document": "main.ltx",
                "source_extensions": ["tex", "ltx", "latex"],
                "allow_shell_escape": false,
                "capabilities": {
                    "produces_pdf": true,
                    "supports_synctex": true,
                    "supports_offline": true,
                    "supports_isolated_compile": true,
                    "formatting_profile": "latex",
                    "source_preflight_profile": "latex",
                    "features": ["citations", "document_index"],
                    "conversion_exports": ["docx", "html", "md", "txt", "pptx", "epub", "typst"],
                    "template_kinds": ["document", "image"],
                    "compiler_prerequisite": null
                }
            })
        );
    }

    #[test]
    fn selection_rejects_unknown_engine_and_wrong_extension() {
        assert!(engine_for("unknown", "main.typ").is_err());
        assert!(engine_for("xetex", "main.md").is_err());
        assert!(engine_for("typst", "main.tex").is_err());
    }

    #[test]
    fn a_nested_compile_directory_is_searched_before_the_project_root() {
        let engine = engine_for("xetex", "paper/main.tex").unwrap();
        let spec = engine
            .compile_spec(
                Path::new("/build"),
                Path::new("/project"),
                CompileTarget::Main {
                    main_document: "paper/main.tex",
                },
                CompileOptions::default(),
            )
            .unwrap();
        let untouched = spec.args.clone();
        let nested = search_compile_directory_first(
            spec.clone(),
            Path::new("/project"),
            Path::new("/project/paper"),
        );
        assert_eq!(nested.args.len(), untouched.len() + 2);
        assert_eq!(
            nested.args[nested.args.len() - 7..],
            [
                "-Z".to_string(),
                "search-path=/project/paper".to_string(),
                "-Z".to_string(),
                "search-path=/project".to_string(),
                "-Z".to_string(),
                format!(
                    "search-path={}",
                    joined("/build", oleafly_core::engine_spec::TEX_DEFAULTS_DIR)
                ),
                joined("/build", "_oleafly_entry.tex"),
            ]
        );
        assert_eq!(nested.working_dir, spec.working_dir);
        let elsewhere =
            search_compile_directory_first(spec, Path::new("/other"), Path::new("/other/paper"));
        assert_eq!(elsewhere.args, untouched);
    }

    #[test]
    fn tex_defaults_are_searched_last_and_only_when_online() {
        let engine = engine_for("xetex", "main.tex").unwrap();
        let search_paths = |offline: bool| -> Vec<String> {
            engine
                .compile_spec(
                    Path::new("/build"),
                    Path::new("/project"),
                    CompileTarget::Main {
                        main_document: "main.tex",
                    },
                    CompileOptions {
                        offline,
                        ..Default::default()
                    },
                )
                .unwrap()
                .args
                .into_iter()
                .filter(|argument| argument.starts_with("search-path="))
                .collect()
        };
        assert_eq!(
            search_paths(false),
            [
                "search-path=/project".to_string(),
                format!(
                    "search-path={}",
                    joined("/build", oleafly_core::engine_spec::TEX_DEFAULTS_DIR)
                ),
            ]
        );
        assert_eq!(search_paths(true), ["search-path=/project"]);
    }

    #[test]
    fn tectonic_starts_outside_the_project_it_compiles() {
        let project = tempfile::tempdir().unwrap();
        let build = tempfile::tempdir().unwrap();
        std::fs::write(project.path().join("tectonic-biber"), "").unwrap();
        let spec = engine_for("xetex", "main.tex")
            .unwrap()
            .compile_spec(
                build.path(),
                project.path(),
                CompileTarget::Main {
                    main_document: "main.tex",
                },
                CompileOptions::default(),
            )
            .unwrap();

        let launch = spec.launch_dir();
        assert!(!launch.starts_with(project.path()));
        assert_eq!(std::fs::read_dir(launch).unwrap().count(), 0);
        // Log paths and the Biber recovery step still resolve in the project,
        // and the project stays off the compile's PATH.
        assert_eq!(spec.working_dir, project.path());
        assert_eq!(spec.environment.path_excluded_root(launch), project.path());
    }

    #[test]
    fn a_biber_failure_is_diagnosed_though_tectonic_left_no_control_file() {
        let build = tempfile::tempdir().unwrap();
        let log = "note: Running external tool /usr/bin/tectonic-biber ...\n\
                   error: the external tool exited with error code 1\n";

        assert!(biber_diagnosis_needed(log, build.path(), "main", None));
        assert!(!biber_diagnosis_needed(
            "[Oleafly] Bibliography needs Biber\n",
            build.path(),
            "main",
            None
        ));
        assert!(!biber_diagnosis_needed(
            "all fine",
            build.path(),
            "main",
            None
        ));
    }

    #[test]
    fn latex_contract_preserves_wrapper_args_outputs_and_capabilities() {
        let engine = engine_for("xetex", "main.tex").unwrap();
        let spec = engine
            .compile_spec(
                Path::new("/build"),
                Path::new("/project"),
                CompileTarget::Main {
                    main_document: "main.tex",
                },
                CompileOptions {
                    offline: true,
                    ..Default::default()
                },
            )
            .unwrap();
        assert_eq!(
            spec.executable,
            EngineExecutable::BundledSidecar("tectonic")
        );
        assert_eq!(
            spec.input,
            EngineInput::Generated {
                path: PathBuf::from("/build/_oleafly_entry.tex"),
                content: "\\ifdefined\\pdfglyphtounicode\\else\\def\\pdfglyphtounicode#1#2{}\\fi\n\\ifdefined\\pdfgentounicode\\else\\newcount\\pdfgentounicode\\fi\n\\ifdefined\\pdfminorversion\\else\\newcount\\pdfminorversion\\fi\n\\ifdefined\\pdfmajorversion\\else\\newcount\\pdfmajorversion\\fi\n\\ifdefined\\pdfcompresslevel\\else\\newcount\\pdfcompresslevel\\fi\n\\ifdefined\\pdfobjcompresslevel\\else\\newcount\\pdfobjcompresslevel\\fi\n\\ifdefined\\pdfsuppressptexinfo\\else\\newcount\\pdfsuppressptexinfo\\fi\n\\ifdefined\\pdfsuppresswarningpagegroup\\else\\newcount\\pdfsuppresswarningpagegroup\\fi\n\\ifdefined\\pdfinclusioncopyfonts\\else\\newcount\\pdfinclusioncopyfonts\\fi\n\\ifdefined\\pdfinclusionerrorlevel\\else\\newcount\\pdfinclusionerrorlevel\\fi\n\\ifdefined\\pdfimageresolution\\else\\newcount\\pdfimageresolution\\fi\n\\ifdefined\\pdfpkresolution\\else\\newcount\\pdfpkresolution\\fi\n\\ifdefined\\pdfdecimaldigits\\else\\newcount\\pdfdecimaldigits\\fi\n\\ifdefined\\pdfmapfile\\else\\def\\pdfmapfile#1{}\\fi\n\\ifdefined\\pdfmapline\\else\\def\\pdfmapline#1{}\\fi\n\\ifdefined\\pdftrailerid\\else\\def\\pdftrailerid#1{}\\fi\n\\ifdefined\\pdfinfo\\else\\def\\pdfinfo#1{}\\fi\n\\ifdefined\\DocumentMetadata\\else\\def\\DocumentMetadata#1{\\typeout{Tagging is off: tagged PDF needs LaTeX 2025-11-01 or newer.}}\\fi\n\\ifdefined\\pdfoutput\\AddToHook{package/iftex/before}{\\global\\pdfoutput=0 }\\fi\n\\input{\\detokenize{main.tex}}\n".into(),
            }
        );
        let online = engine
            .compile_spec(
                Path::new("/build"),
                Path::new("/project"),
                CompileTarget::Main {
                    main_document: "main.tex",
                },
                CompileOptions::default(),
            )
            .unwrap();
        let EngineInput::Generated { content, .. } = &online.input else {
            panic!("{:?}", online.input);
        };
        assert!(content.starts_with("\\ifdefined\\pdfglyphtounicode"));
        assert!(content.contains(oleafly_core::engine_spec::T1_ENCODING_SHIM));
        assert!(content.contains("\\AddToHook{package/fontenc/after}"));
        assert!(content.ends_with("\\input{\\detokenize{main.tex}}\n"));
        assert_eq!(
            spec.artifacts.pdf,
            Some(PathBuf::from("/build/_oleafly_entry.pdf"))
        );
        assert_eq!(
            spec.artifacts.log,
            Some(PathBuf::from("/build/_oleafly_entry.log"))
        );
        assert_eq!(
            spec.args,
            [
                "-X",
                "compile",
                "--bundle",
                "https://mirrors.oleafly.com/tex-bundles/tlextras-2022.0r0.tar",
                "--only-cached",
                "--synctex",
                "--keep-logs",
                "--keep-intermediates",
                "--print",
                "--outdir",
                "/build",
                "-Z",
                "continue-on-errors",
                "-Z",
                "search-path=/project",
                joined("/build", "_oleafly_entry.tex").as_str()
            ]
        );
        assert_eq!(
            engine.capabilities(),
            EngineCapabilities {
                produces_pdf: true,
                supports_synctex: true,
                supports_offline: true,
                supports_isolated_compile: true,
                formatting_profile: FormattingProfile::Latex,
                source_preflight_profile: SourcePreflightProfile::Latex,
                features: &[EngineFeature::Citations, EngineFeature::DocumentIndex],
                conversion_exports: &[
                    ConversionExport::Docx,
                    ConversionExport::Html,
                    ConversionExport::Md,
                    ConversionExport::Txt,
                    ConversionExport::Pptx,
                    ConversionExport::Epub,
                    ConversionExport::Typst
                ],
                template_kinds: &[TemplateKind::Document, TemplateKind::Image],
                compiler_prerequisite: None,
            }
        );
    }

    #[test]
    fn isolated_compile_is_direct_and_names_artifacts_before_args() {
        let engine = engine_for("latex", "main.tex").unwrap();
        let spec = engine
            .compile_spec(
                Path::new("/figbuild"),
                Path::new("/project"),
                CompileTarget::Isolated {
                    source_path: Path::new("/figbuild/_figure.tex"),
                    output_stem: "_figure",
                },
                CompileOptions::default(),
            )
            .unwrap();
        assert_eq!(
            spec.input,
            EngineInput::Direct(PathBuf::from("/figbuild/_figure.tex"))
        );
        assert_eq!(
            spec.artifacts.pdf,
            Some(PathBuf::from("/figbuild/_figure.pdf"))
        );
        assert_eq!(spec.args.last().unwrap(), "/figbuild/_figure.tex");
    }

    #[test]
    fn online_latex_args_do_not_enable_cached_only_mode() {
        let engine = engine_for("latex", "main.tex").unwrap();
        let spec = engine
            .compile_spec(
                Path::new("/build"),
                Path::new("/project"),
                CompileTarget::Main {
                    main_document: "main.tex",
                },
                CompileOptions::default(),
            )
            .unwrap();
        assert!(!spec.args.iter().any(|arg| arg == "--only-cached"));
        assert_eq!(&spec.args[..2], ["-X", "compile"]);
    }

    fn latex_args(options: CompileOptions) -> Vec<String> {
        engine_for("latex", "main.tex")
            .unwrap()
            .compile_spec(
                Path::new("/build"),
                Path::new("/project"),
                CompileTarget::Main {
                    main_document: "main.tex",
                },
                options,
            )
            .unwrap()
            .args
    }

    fn arg_pair(args: &[String], flag: &str) -> Option<String> {
        args.iter()
            .position(|arg| arg == flag)
            .and_then(|index| args.get(index + 1))
            .cloned()
    }

    #[test]
    fn fast_mode_requests_a_single_typesetting_pass() {
        assert_eq!(
            arg_pair(&latex_args(CompileOptions::default()), "--reruns"),
            None
        );
        assert_eq!(
            arg_pair(
                &latex_args(CompileOptions {
                    fast: true,
                    ..Default::default()
                }),
                "--reruns",
            )
            .as_deref(),
            Some("0"),
        );
    }

    #[test]
    fn halting_on_the_first_error_drops_continue_on_errors() {
        assert!(latex_args(CompileOptions::default())
            .iter()
            .any(|arg| arg == "continue-on-errors"));
        assert!(!latex_args(CompileOptions {
            halt_on_error: true,
            ..Default::default()
        })
        .iter()
        .any(|arg| arg == "continue-on-errors"));
    }

    #[test]
    fn compiler_flags_never_displace_the_entry_file() {
        // The entry must stay last: tectonic reads it positionally.
        let args = latex_args(CompileOptions {
            offline: true,
            fast: true,
            halt_on_error: true,
            latex_flavor: None,
            allow_shell_escape: false,
            ..Default::default()
        });
        assert!(args.last().unwrap().ends_with(crate::paths::ENTRY_TEX));
        assert_eq!(&args[..2], ["-X", "compile"]);
    }

    #[test]
    fn a_stop_landing_before_the_spawn_still_reaches_the_child() {
        let cancel = crate::state::CompileCancel::default();
        cancel.begin();
        assert_eq!(cancel.request(), None, "no compiler is running yet");
        assert!(
            !cancel.attach(4242),
            "a stop requested before the spawn must terminate the new child",
        );
        assert!(cancel.detach(), "the stop is reported to the caller");
        assert!(!cancel.detach(), "and is cleared for the next compile");
    }

    #[test]
    fn a_stop_during_a_compile_returns_the_running_pid() {
        let cancel = crate::state::CompileCancel::default();
        cancel.begin();
        assert!(cancel.attach(99), "no stop is pending");
        assert_eq!(cancel.request(), Some(99));
        assert!(cancel.detach());
    }

    #[test]
    fn a_finished_child_does_not_leave_a_stale_pid_between_compile_passes() {
        let cancel = crate::state::CompileCancel::default();
        cancel.begin();
        assert!(cancel.attach(99));
        cancel.unregister(99);
        assert_eq!(
            cancel.request(),
            None,
            "a finished process must no longer be targeted"
        );
        assert!(
            !cancel.attach(100),
            "the pending stop still reaches the next pass"
        );
        cancel.unregister(100);
        assert!(cancel.detach());
    }

    #[test]
    fn compile_cancel_scope_clears_pending_stop_on_error_exit() {
        let cancel = crate::state::CompileCancel::default();
        {
            let _scope = CompileCancelScope::new(Some(&cancel));
            assert_eq!(cancel.request(), None);
        }
        cancel.begin();
        assert!(
            cancel.attach(101),
            "an error from the previous compile must not stop the next one"
        );
        cancel.unregister(101);
        assert!(!cancel.detach());
    }

    #[test]
    fn an_idle_stop_cannot_poison_the_next_compile() {
        let cancel = crate::state::CompileCancel::default();
        assert_eq!(cancel.request(), None);
        cancel.begin();
        assert!(cancel.attach(202));
        cancel.unregister(202);
        assert!(!cancel.detach());
    }

    #[test]
    fn a_nested_cancel_scope_preserves_stops_between_compile_passes() {
        let cancel = crate::state::CompileCancel::default();
        cancel.begin();
        cancel.begin();
        assert!(!cancel.detach(), "the inner pass completed normally");

        assert_eq!(cancel.request(), None, "no child is running in the gap");
        cancel.begin();
        assert!(
            !cancel.attach(303),
            "the next pass must observe a stop requested in the gap"
        );
        cancel.unregister(303);
        assert!(cancel.detach());
        assert!(cancel.detach());
        assert!(!cancel.detach(), "the completed pipeline clears the stop");
    }

    #[test]
    fn external_executable_provenance_retains_discovered_path() {
        let executable = EngineExecutable::ExternalPath(PathBuf::from("/cache/pandoc"));
        assert_eq!(
            executable,
            EngineExecutable::ExternalPath(PathBuf::from("/cache/pandoc"))
        );
    }

    #[test]
    fn stale_artifacts_are_removed_before_a_compile_can_publish_results() {
        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("oleafly-artifact-test-{unique}"));
        std::fs::create_dir_all(&dir).unwrap();
        let artifacts = EngineArtifacts {
            output_dir: dir.clone(),
            pdf: Some(dir.join("old.pdf")),
            log: Some(dir.join("old.log")),
            synctex: Some(dir.join("old.synctex.gz")),
            html: None,
        };
        for path in [&artifacts.pdf, &artifacts.log, &artifacts.synctex]
            .into_iter()
            .flatten()
        {
            std::fs::write(path, b"stale").unwrap();
        }

        let retained = clear_stale_artifacts(&artifacts);
        assert!(retained.is_empty());
        assert!(!artifacts.pdf.unwrap().exists());
        assert!(!artifacts.log.unwrap().exists());
        assert!(!artifacts.synctex.unwrap().exists());
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn stale_biber_control_is_removed_before_a_direct_tectonic_compile() {
        let directory = tempfile::tempdir().unwrap();
        let artifacts = EngineArtifacts {
            output_dir: directory.path().to_path_buf(),
            pdf: Some(directory.path().join("output.pdf")),
            log: Some(directory.path().join("output.log")),
            synctex: None,
            html: None,
        };
        let biber_control = directory
            .path()
            .join(format!("{}.bcf", crate::paths::ENTRY_STEM));
        std::fs::write(&biber_control, b"stale biblatex control").unwrap();

        let retained = clear_stale_compile_artifacts(&artifacts, Some(&biber_control));

        assert!(retained.is_empty());
        assert!(!biber_control.exists());
    }

    #[test]
    fn retained_stale_artifact_is_not_accepted_until_contents_change() {
        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = std::env::temp_dir().join(format!("oleafly-retained-test-{unique}.pdf"));
        std::fs::write(&path, b"old").unwrap();
        let retained = vec![RetainedArtifact {
            path: path.clone(),
            identity: RetainedArtifactIdentity::Known(artifact_identity(&path).unwrap()),
        }];
        assert!(!artifact_is_fresh(&path, &retained));
        std::fs::write(&path, b"new").unwrap();
        assert!(artifact_is_fresh(&path, &retained));
        std::fs::remove_file(path).unwrap();
    }

    #[test]
    fn normal_artifact_check_does_not_load_identity() {
        let path = Path::new("output.pdf");
        let fresh = artifact_is_fresh_with(
            path,
            &[],
            |_| true,
            |_| panic!("identity should not be loaded"),
        );
        assert!(fresh);
    }

    #[test]
    fn unreadable_retained_artifact_is_never_accepted() {
        let path = PathBuf::from("output.pdf");
        let retained = vec![RetainedArtifact {
            path: path.clone(),
            identity: RetainedArtifactIdentity::Unreadable,
        }];
        assert!(!artifact_is_fresh_with(
            &path,
            &retained,
            |_| true,
            |_| {
                Some(ArtifactIdentity {
                    len: 3,
                    modified: None,
                    digest: Some([1; 32]),
                })
            }
        ));
    }

    #[test]
    fn latex_diagnostics_remain_normalized() {
        let engine = engine_for("tectonic", "main.tex").unwrap();
        let errors = engine.parse_errors(
            "This is the transcript.\n! Undefined control sequence.\nl.42 \\badcmd\n",
        );
        assert_eq!(errors.len(), 1);
        assert_eq!(errors[0].line, Some(42));
        assert_eq!(errors[0].kind, "error");
        assert_eq!(errors[0].message, "Undefined control sequence.");
    }

    #[test]
    fn latex_diagnostic_edge_cases_remain_compatible() {
        let engine = engine_for("latex", "main.tex").unwrap();
        let errors = engine.parse_errors("! Emergency stop.\n");
        assert_eq!(errors.len(), 1);
        assert_eq!(errors[0].line, None);
        assert!(engine
            .parse_errors("Overfull \\hbox\nOutput written on doc.pdf\n")
            .is_empty());

        let errors = engine.parse_errors("! First error.\n! Second error.\nl.7 foo\n");
        assert_eq!(errors.len(), 2);
        assert_eq!(errors[0].line, None);
        assert_eq!(errors[1].line, Some(7));
    }

    #[test]
    fn typst_identity_aliases_extensions_and_capabilities_are_exact() {
        for name in ["typst", "typ", "TYPST"] {
            let engine = engine_for(name, "chapters/main.typ").unwrap();
            assert_eq!(engine.id(), DocumentEngineId::Typst);
        }
        let descriptor = descriptor_for("typ", "main.typ").unwrap();
        assert_eq!(descriptor.id, "typst");
        assert_eq!(descriptor.source_extensions, ["typ"]);
        assert_eq!(
            descriptor.capabilities,
            EngineCapabilities {
                produces_pdf: true,
                supports_synctex: true,
                supports_offline: true,
                supports_isolated_compile: false,
                formatting_profile: FormattingProfile::Typst,
                source_preflight_profile: SourcePreflightProfile::Typst,
                features: &[EngineFeature::Citations, EngineFeature::DocumentIndex],
                conversion_exports: &[
                    ConversionExport::Tex,
                    ConversionExport::Docx,
                    ConversionExport::Html,
                    ConversionExport::Md,
                    ConversionExport::Txt,
                    ConversionExport::Epub
                ],
                template_kinds: &[TemplateKind::Document, TemplateKind::Image],
                compiler_prerequisite: None,
            }
        );
        assert!(engine_for("typst", "MAIN.TYP").is_ok());
    }

    #[test]
    fn typst_compile_is_direct_and_targets_declared_pdf() {
        let engine = engine_for("typst", "chapters/main.typ").unwrap();
        let spec = engine
            .compile_spec(
                Path::new("/build"),
                Path::new("/project"),
                CompileTarget::Main {
                    main_document: "chapters/main.typ",
                },
                CompileOptions::default(),
            )
            .unwrap();
        assert_eq!(spec.executable, EngineExecutable::BundledSidecar("typst"));
        assert_eq!(
            spec.input,
            EngineInput::Direct(PathBuf::from("/project/chapters/main.typ"))
        );
        assert_eq!(
            spec.artifacts.pdf,
            Some(PathBuf::from("/build/_oleafly_entry.pdf"))
        );
        assert_eq!(spec.artifacts.log, None);
        assert_eq!(spec.working_dir, PathBuf::from("/project"));
        assert_eq!(spec.artifacts.synctex, None);
        assert_eq!(
            spec.args,
            [
                "--color=never",
                "compile",
                joined("/project", "chapters/main.typ").as_str(),
                joined("/build", "_oleafly_entry.pdf").as_str(),
                "--root",
                "/project",
                "--diagnostic-format",
                "human",
            ]
        );
    }

    fn resolved_typst(
        path: &str,
        version: &str,
        source: oleafly_core::typst_toolchain::TypstSource,
    ) -> CompileOptions {
        CompileOptions {
            typst: Some(std::sync::Arc::new(
                oleafly_core::typst_toolchain::ResolvedTypst {
                    path: PathBuf::from(path),
                    version: oleafly_core::typst_toolchain::ToolchainVersion::parse(version)
                        .unwrap(),
                    source,
                    capabilities: oleafly_core::typst_toolchain::capabilities_for(version).clone(),
                },
            )),
            ..CompileOptions::default()
        }
    }

    #[test]
    fn typst_compiles_with_the_resolved_binary_and_keeps_the_bundled_sidecar_for_bundled() {
        use oleafly_core::typst_toolchain::TypstSource;
        let engine = engine_for("typst", "main.typ").unwrap();
        let spec_for = |options: CompileOptions| {
            engine
                .compile_spec(
                    Path::new("/build"),
                    Path::new("/project"),
                    CompileTarget::Main {
                        main_document: "main.typ",
                    },
                    options,
                )
                .unwrap()
        };
        let unresolved = spec_for(CompileOptions::default());
        let bundled = spec_for(resolved_typst("/app/typst", "0.15.1", TypstSource::Bundled));
        assert_eq!(
            bundled.executable,
            EngineExecutable::BundledSidecar("typst")
        );
        assert_eq!(bundled.args, unresolved.args);

        let downloaded = spec_for(resolved_typst(
            "/data/toolchains/typst/0.13.1/typst",
            "0.13.1",
            TypstSource::Downloaded,
        ));
        assert_eq!(
            downloaded.executable,
            EngineExecutable::ExternalPath(PathBuf::from("/data/toolchains/typst/0.13.1/typst"))
        );
        assert_eq!(downloaded.args, unresolved.args);
        assert_eq!(downloaded.input, unresolved.input);
        assert_eq!(downloaded.artifacts, unresolved.artifacts);

        let system = spec_for(resolved_typst(
            "/opt/homebrew/bin/typst",
            "0.12.0",
            TypstSource::System,
        ));
        assert_eq!(
            system.executable,
            EngineExecutable::ExternalPath(PathBuf::from("/opt/homebrew/bin/typst"))
        );
        assert_eq!(system.args, unresolved.args);
    }

    fn typst_spec_with(
        version: &str,
        packages: Option<crate::typst_packages::TypstPackageDirs>,
        offline: bool,
    ) -> EngineCompileSpec {
        let options = CompileOptions {
            typst_packages: packages,
            offline,
            source_date_epoch: Some(1_700_000_000),
            ..resolved_typst(
                "/data/toolchains/typst/x/typst",
                version,
                oleafly_core::typst_toolchain::TypstSource::Downloaded,
            )
        };
        engine_for("typst", "main.typ")
            .unwrap()
            .compile_spec(
                Path::new("/build"),
                Path::new("/project"),
                CompileTarget::Main {
                    main_document: "main.typ",
                },
                options,
            )
            .unwrap()
    }

    fn package_dirs() -> crate::typst_packages::TypstPackageDirs {
        crate::typst_packages::TypstPackageDirs::for_project(
            Path::new("/data"),
            Path::new("/project"),
            true,
        )
    }

    #[test]
    fn typst_compiles_name_the_package_directories_in_flags_and_environment() {
        let spec = typst_spec_with("0.15.1", Some(package_dirs()), false);
        let vendored = joined("/project", "typst-packages");
        let cache = package_dirs().cache_path.to_string_lossy().into_owned();
        let tail: Vec<&str> = spec.args.iter().skip(8).map(String::as_str).collect();
        assert_eq!(
            tail,
            [
                "--package-path",
                vendored.as_str(),
                "--package-cache-path",
                cache.as_str(),
            ]
        );
        assert_eq!(
            spec.environment.variables,
            vec![
                ("SOURCE_DATE_EPOCH".to_string(), "1700000000".to_string()),
                ("TYPST_PACKAGE_PATH".to_string(), vendored),
                ("TYPST_PACKAGE_CACHE_PATH".to_string(), cache),
            ]
        );
    }

    #[test]
    fn typst_versions_without_package_flags_still_get_the_environment() {
        let spec = typst_spec_with("0.11.1", Some(package_dirs()), false);
        assert_eq!(spec.args.len(), 8);
        assert!(!spec
            .args
            .iter()
            .any(|argument| argument.starts_with("--package")));
        let names: Vec<&str> = spec
            .environment
            .variables
            .iter()
            .map(|(name, _)| name.as_str())
            .collect();
        assert_eq!(
            names,
            [
                "SOURCE_DATE_EPOCH",
                "TYPST_PACKAGE_PATH",
                "TYPST_PACKAGE_CACHE_PATH"
            ]
        );
    }

    fn typst_spec_with_settings(version: &str, external_build: bool) -> EngineCompileSpec {
        let options = CompileOptions {
            external_build,
            source_date_epoch: Some(1_700_000_000),
            typst_settings: Some(crate::typst_options::TypstCompileSettings {
                font_dirs: vec![PathBuf::from("/project/fonts")],
                ignore_system_fonts: true,
                inputs: vec![("draft".into(), "true".into())],
                creation_timestamp: Some(42),
                system_font_mirror: None,
            }),
            ..resolved_typst(
                "/data/toolchains/typst/x/typst",
                version,
                oleafly_core::typst_toolchain::TypstSource::Downloaded,
            )
        };
        engine_for("typst", "main.typ")
            .unwrap()
            .compile_spec(
                Path::new("/build"),
                Path::new("/project"),
                CompileTarget::Main {
                    main_document: "main.typ",
                },
                options,
            )
            .unwrap()
    }

    #[test]
    fn typst_compiles_carry_fonts_inputs_timestamps_and_dependency_lists_the_version_takes() {
        let newest = typst_spec_with_settings("0.15.1", true);
        let deps = crate::typst_options::dependency_file(Path::new("/build"))
            .to_string_lossy()
            .into_owned();
        let tail: Vec<&str> = newest.args.iter().skip(8).map(String::as_str).collect();
        assert_eq!(
            tail,
            [
                "--font-path",
                "/project/fonts",
                "--ignore-system-fonts",
                "--input",
                "draft=true",
                "--creation-timestamp",
                "42",
                "--deps",
                deps.as_str(),
                "--deps-format",
                "json",
            ]
        );
        assert_eq!(&newest.args[6..8], ["--diagnostic-format", "human"]);
        assert!(newest
            .environment
            .variables
            .contains(&("SOURCE_DATE_EPOCH".to_string(), "42".to_string())));
        let library = typst_spec_with_settings("0.15.1", false);
        assert!(!library.args.iter().any(|argument| argument == "--deps"));
        let oldest = typst_spec_with_settings("0.11.1", true);
        let tail: Vec<&str> = oldest.args.iter().skip(8).map(String::as_str).collect();
        assert_eq!(
            tail,
            ["--font-path", "/project/fonts", "--input", "draft=true"]
        );
    }

    #[test]
    fn offline_typst_compiles_cannot_reach_the_package_registry() {
        let online = typst_spec_with("0.15.1", None, false);
        assert!(!online
            .environment
            .variables
            .iter()
            .any(|(name, _)| name.eq_ignore_ascii_case("https_proxy")));
        let offline = typst_spec_with("0.15.1", None, true);
        for (name, value) in crate::typst_packages::offline_environment() {
            assert!(
                offline
                    .environment
                    .variables
                    .contains(&(name.to_string(), value.to_string())),
                "{name} is missing"
            );
        }
        assert_eq!(offline.args, online.args);
    }

    #[test]
    fn typst_descriptors_start_without_version_details() {
        let descriptor = descriptor_for("typst", "main.typ").unwrap();
        assert_eq!(descriptor.typst_version, None);
        assert_eq!(descriptor.typst_resolved, None);
        assert_eq!(descriptor.typst_missing, None);
        let json = serde_json::to_value(&descriptor).unwrap();
        assert!(json.get("typst_version").is_none());
        assert!(json.get("typst_missing").is_none());
        let described = EngineDescriptor {
            typst_version: Some("0.13.1".into()),
            typst_resolved: Some(TypstResolvedDescriptor {
                version: "0.13.1".into(),
                source: oleafly_core::typst_toolchain::TypstSource::Downloaded,
            }),
            ..descriptor
        };
        let json = serde_json::to_value(&described).unwrap();
        assert_eq!(json["typst_version"], "0.13.1");
        assert_eq!(
            json["typst_resolved"],
            serde_json::json!({"version": "0.13.1", "source": "downloaded"})
        );
    }

    #[test]
    fn typst_short_diagnostics_are_normalized_including_windows_paths() {
        let engine = engine_for("typst", "main.typ").unwrap();
        let errors = engine.parse_errors(
            "/project/main.typ:7:12: error: unknown variable: foo\n\
             C:\\work\\main.typ:9:2: warning: unused label\n\
             hint: a continuation is not a separate diagnostic\n",
        );
        assert_eq!(errors.len(), 2);
        assert_eq!(errors[0].file.as_deref(), Some("/project/main.typ"));
        assert_eq!(errors[0].line, Some(7));
        assert_eq!(errors[0].kind, "error");
        assert_eq!(errors[0].message, "unknown variable: foo");
        assert_eq!(errors[1].file.as_deref(), Some("C:\\work\\main.typ"));
        assert_eq!(errors[1].line, Some(9));
        assert_eq!(errors[1].kind, "warning");
        assert_eq!((errors[0].column, errors[1].column), (Some(13), Some(3)));

        let human = engine.parse_errors(
            "error: unknown variable: foo\n  ┌─ C:\\work\\chapters\\intro.typ:7:12\n  │\n7 │ Hello world #foo\n  │             ^^^\n\nwarning: unused label\n  ┌─ chapters\\intro.typ:9:2\n  │\n9 │ x <a>\n  │   ^^^\n",
        );
        assert_eq!(human.len(), 2);
        assert_eq!(
            human[0].file.as_deref(),
            Some("C:\\work\\chapters\\intro.typ")
        );
        assert_eq!(
            (human[0].line, human[0].column, human[0].end_column),
            (Some(7), Some(13), Some(16))
        );
        assert_eq!(human[1].file.as_deref(), Some("chapters\\intro.typ"));
        assert_eq!((human[1].line, human[1].column), (Some(9), Some(3)));
    }

    #[tokio::test]
    async fn typst_compiles_return_excerpts_and_grouped_structured_diagnostics() {
        let project = tempfile::tempdir().unwrap();
        std::fs::write(project.path().join("main.typ"), "See @nolabel.\n").unwrap();
        let engine = engine_for("typst", "main.typ").unwrap();
        let log = "error: label `<nolabel>` does not exist in the document\n  ┌─ main.typ:1:4\n  │\n1 │ See @nolabel.\n  │     ^^^^^^^^\n".to_string();
        let errors = engine.parse_errors(&log);
        let (_, diagnostics, errors) = parse_log_diagnostics(
            DocumentEngineId::Typst,
            log,
            Some("main.typ".into()),
            project.path().to_owned(),
            project.path().to_owned(),
            errors,
        )
        .await
        .unwrap();
        assert_eq!(errors[0].source_line.as_deref(), Some("See @nolabel."));
        assert_eq!(
            (errors[0].column, errors[0].end_column),
            (Some(5), Some(13))
        );
        assert!(errors[0].explanation.is_some());
        assert_eq!(diagnostics.len(), 1);
        assert_eq!(
            diagnostics[0].category,
            oleafly_core::LogCategory::UndefinedReference
        );
        let json = serde_json::to_value(&errors[0]).unwrap();
        assert_eq!(json["column"], 5);
        assert_eq!(json["end_column"], 13);
        assert_eq!(json["source_line"], "See @nolabel.");
        assert!(json.get("hints").is_none());
    }

    #[test]
    fn typst_descriptor_reports_the_typst_source_preflight_profile() {
        let descriptor = descriptor_for("typst", "main.typ").unwrap();
        assert_eq!(
            serde_json::to_value(&descriptor).unwrap()["capabilities"]["source_preflight_profile"],
            "typst"
        );
    }

    #[test]
    fn markdown_identity_aliases_extensions_and_capabilities_are_exact() {
        for name in ["markdown", "md", "pandoc", "MARKDOWN"] {
            let engine = engine_for(name, "chapters/main.md").unwrap();
            assert_eq!(engine.id(), DocumentEngineId::Markdown);
        }
        let descriptor = descriptor_for("md", "main.markdown").unwrap();
        assert_eq!(descriptor.id, "markdown");
        assert_eq!(descriptor.source_extensions, ["md", "markdown"]);
        assert_eq!(
            descriptor.capabilities,
            EngineCapabilities {
                produces_pdf: true,
                supports_synctex: false,
                supports_offline: false,
                supports_isolated_compile: false,
                formatting_profile: FormattingProfile::Markdown,
                source_preflight_profile: SourcePreflightProfile::None,
                features: &[EngineFeature::Citations, EngineFeature::DocumentIndex],
                conversion_exports: &[
                    ConversionExport::Docx,
                    ConversionExport::Html,
                    ConversionExport::Txt,
                    ConversionExport::Pptx,
                    ConversionExport::Epub,
                    ConversionExport::Typst,
                    ConversionExport::Tex
                ],
                template_kinds: &[TemplateKind::Document],
                compiler_prerequisite: Some(CompilerPrerequisite::Pandoc),
            }
        );
    }

    fn test_scratch(bases: &Path) -> oleafly_core::EngineScratch {
        oleafly_core::EngineScratch::create(&oleafly_core::EngineScratchBases {
            system: bases.to_path_buf(),
            owned: None,
            build: bases.join("build"),
        })
        .unwrap()
    }

    fn temp_variables(spec: &EngineCompileSpec) -> Vec<(&str, &str)> {
        spec.environment
            .variables
            .iter()
            .filter(|(name, _)| oleafly_core::TEMP_DIRECTORY_VARIABLES.contains(&name.as_str()))
            .map(|(name, value)| (name.as_str(), value.as_str()))
            .collect()
    }

    fn resource_variable(spec: &EngineCompileSpec) -> Option<&str> {
        spec.environment
            .variables
            .iter()
            .find(|(name, _)| name == oleafly_core::PANDOC_RESOURCE_PATH_VARIABLE)
            .map(|(_, value)| value.as_str())
    }

    #[cfg(unix)]
    fn defaults_argument(spec: &EngineCompileSpec) -> Option<PathBuf> {
        spec.args
            .first()
            .and_then(|arg| arg.strip_prefix("--defaults="))
            .map(PathBuf::from)
    }

    fn markdown_spec_with(
        out: &Path,
        project: &Path,
        scratch: oleafly_core::EngineScratch,
    ) -> EngineCompileSpec {
        markdown_compile_spec(
            &MARKDOWN_ENGINE,
            out,
            project,
            "main.md",
            MarkdownTools {
                pandoc: PathBuf::from("/pandoc"),
                tectonic: PathBuf::from("/tectonic"),
                typst: None,
                scratch,
            },
            CompileOptions::default(),
        )
        .unwrap()
    }

    #[test]
    fn markdown_runs_get_a_longer_limit_because_pandoc_hides_tectonic_downloads() {
        let bases = tempfile::tempdir().unwrap();
        let spec = markdown_spec_with(
            Path::new("/build"),
            Path::new("/project"),
            test_scratch(bases.path()),
        );
        assert_eq!(
            spec.environment.time_limit(),
            oleafly_core::compile_limit::MARKDOWN_PDF_TIME_LIMIT
        );
    }

    #[test]
    fn a_markdown_deck_compiles_to_beamer_slides() {
        let bases = tempfile::tempdir().unwrap();
        let project = tempfile::tempdir().unwrap();
        std::fs::write(
            project.path().join("main.md"),
            "---\ntype: slide\n---\n## One\n",
        )
        .unwrap();
        let spec = markdown_spec_with(
            Path::new("/build"),
            project.path(),
            test_scratch(bases.path()),
        );
        assert!(spec.args.iter().any(|arg| arg == "--to=beamer"));
    }

    #[test]
    fn markdown_compile_is_direct_and_uses_declared_artifacts() {
        let bases = tempfile::tempdir().unwrap();
        let scratch = test_scratch(bases.path());
        let scratch_path = scratch.path().to_path_buf();
        let spec = markdown_compile_spec(
            &MARKDOWN_ENGINE,
            Path::new("/build"),
            Path::new("/project"),
            "chapters/main.md",
            MarkdownTools {
                pandoc: PathBuf::from("/cache/pandoc"),
                tectonic: PathBuf::from("/app/tectonic"),
                typst: Some(PathBuf::from("/app/typst")),
                scratch,
            },
            CompileOptions::default(),
        )
        .unwrap();
        assert_eq!(
            spec.executable,
            EngineExecutable::ExternalPath(PathBuf::from("/cache/pandoc"))
        );
        assert_eq!(
            spec.input,
            EngineInput::Direct(PathBuf::from("/project/chapters/main.md"))
        );
        assert_eq!(
            spec.artifacts.pdf,
            Some(PathBuf::from("/build/_oleafly_entry.pdf"))
        );
        assert_eq!(spec.artifacts.log, None);
        assert_eq!(spec.working_dir, scratch_path);
        assert_eq!(
            spec.environment.path_excluded_root(&spec.working_dir),
            Path::new("/project")
        );
        assert_eq!(
            EngineEnvironment::default().path_excluded_root(Path::new("/project")),
            Path::new("/project")
        );
        let chapters = joined("/project", "chapters");
        let separator = if cfg!(windows) { ';' } else { ':' };
        let resource_path = format!("--resource-path={chapters}{separator}/project");
        assert_eq!(
            spec.args,
            [
                resource_path.as_str(),
                "--from=markdown",
                "--standalone",
                "--pdf-engine=/app/tectonic",
                "--pdf-engine-opt=--bundle",
                format!("--pdf-engine-opt={}", tex_bundle_url()).as_str(),
                format!("--pdf-engine-opt=-Zsearch-path={chapters}").as_str(),
                "--pdf-engine-opt=-Zsearch-path=/project",
                format!("--output={}", joined("/build", "_oleafly_entry.pdf")).as_str(),
                "--sandbox",
                "--lua-filter=oleafly-mermaid-figures.lua",
                "--lua-filter=oleafly-image-compat.lua",
                "--lua-filter=oleafly-markdown-bibliography.lua",
                "--citeproc",
                "--lua-filter=oleafly-default-fonts.lua",
                "--",
                joined("/project", "chapters/main.md").as_str(),
            ]
        );
        assert_eq!(
            std::fs::read_to_string(scratch_path.join(MERMAID_FIGURES_FILTER_NAME)).unwrap(),
            MERMAID_FIGURES_FILTER
        );
        for (name, filter) in oleafly_core::engine_spec::MARKDOWN_FILTERS {
            assert_eq!(
                std::fs::read_to_string(scratch_path.join(name)).unwrap(),
                filter
            );
        }
        assert!(spec
            .environment
            .variables
            .contains(&(MARKDOWN_TYPST_VARIABLE.to_owned(), "/app/typst".to_owned())));
        let retry = args_without_bundle(&spec.args);
        assert_eq!(retry[0], resource_path);
        assert!(retry
            .iter()
            .any(|arg| arg == "--pdf-engine-opt=-Zsearch-path=/project"));
        assert!(retry
            .iter()
            .any(|arg| arg == "--lua-filter=oleafly-mermaid-figures.lua"));
        assert_eq!(resource_variable(&spec), None);
        let scratch_text = scratch_path.to_string_lossy().into_owned();
        assert_eq!(
            temp_variables(&spec),
            ["TMP", "TEMP", "TMPDIR"].map(|name| (name, scratch_text.as_str()))
        );
        assert!(scratch_path.is_dir());
        drop(spec);
        assert!(!scratch_path.exists());
    }

    fn bundled_pandoc() -> Option<PathBuf> {
        let triple = crate::biber_toolchain::host_triple_guess()?;
        let path = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("binaries")
            .join(format!("pandoc-{triple}{}", std::env::consts::EXE_SUFFIX));
        path.is_file().then_some(path)
    }

    const MERMAID_FLOWCHART: &str = "flowchart TD\n    A --> B";
    const MERMAID_FLOWCHART_FIGURE: &str = "figures/mermaid-a8a349062462ae46.png";

    fn pandoc_args_writing(spec: &EngineCompileSpec, to: &str, output: &Path) -> Vec<String> {
        let mut args: Vec<String> = spec
            .args
            .iter()
            .filter(|arg| !arg.starts_with("--pdf-engine") && !arg.starts_with("--output="))
            .cloned()
            .collect();
        let separator = args.iter().position(|arg| arg == "--").unwrap();
        args.splice(
            separator..separator,
            [
                format!("--to={to}"),
                format!("--output={}", output.to_string_lossy()),
            ],
        );
        args
    }

    fn mermaid_markdown() -> String {
        format!(
            "# Notes\n\n```mermaid\n{MERMAID_FLOWCHART}\n```\n\n```mermaid\nflowchart LR\n    C --> D\n```\n"
        )
    }

    #[tokio::test]
    async fn real_pandoc_swaps_a_mermaid_block_for_its_saved_figure_and_keeps_unsaved_blocks() {
        let Some(pandoc) = bundled_pandoc() else {
            eprintln!("Pandoc sidecar is not staged; skipping the Mermaid figure filter check");
            return;
        };
        let separator = if cfg!(windows) { ';' } else { ':' };
        let base = tempfile::tempdir().unwrap();
        let base_path = oleafly_core::plain_path(&base.path().canonicalize().unwrap());
        for name in [
            "Notes".to_string(),
            format!("Notes{separator} draft"),
            format!("Notes{separator} ${{draft}}"),
        ] {
            let project = base_path.join(&name);
            std::fs::create_dir_all(project.join("figures")).unwrap();
            std::fs::write(project.join("main.md"), mermaid_markdown()).unwrap();
            std::fs::write(project.join(MERMAID_FLOWCHART_FIGURE), b"png").unwrap();
            let bases = tempfile::tempdir().unwrap();
            let spec = markdown_compile_spec(
                &MARKDOWN_ENGINE,
                &base_path.join("build"),
                &project,
                "main.md",
                MarkdownTools {
                    pandoc: pandoc.clone(),
                    tectonic: PathBuf::from("/tectonic"),
                    typst: None,
                    scratch: test_scratch(bases.path()),
                },
                CompileOptions::default(),
            )
            .unwrap();
            let latex = project.join("main.tex");
            let (log, code) = run_supervised_process_with_environment(
                &pandoc,
                &pandoc_args_writing(&spec, "latex", &latex),
                &spec.working_dir,
                None,
                COMPILE_TIMEOUT,
                None,
                &spec.environment,
            )
            .await
            .unwrap();
            assert_eq!(code, Some(0), "{log}");
            let tex = std::fs::read_to_string(&latex).unwrap();
            assert_eq!(tex.matches("\\includegraphics").count(), 1, "{tex}");
            assert!(
                tex.contains(&format!("{{{MERMAID_FLOWCHART_FIGURE}}}")),
                "{tex}"
            );
            assert!(tex.contains("\\begin{center}"), "{tex}");
            assert!(!tex.contains("flowchart TD"), "{tex}");
            assert!(tex.contains("flowchart LR"), "{tex}");
        }
    }

    #[tokio::test]
    async fn real_pandoc_leaves_mermaid_blocks_as_code_when_no_figure_was_saved() {
        let Some(pandoc) = bundled_pandoc() else {
            eprintln!("Pandoc sidecar is not staged; skipping the Mermaid figure filter check");
            return;
        };
        let base = tempfile::tempdir().unwrap();
        let project = oleafly_core::plain_path(&base.path().canonicalize().unwrap()).join("Notes");
        std::fs::create_dir_all(project.join("figures")).unwrap();
        std::fs::write(project.join("main.md"), mermaid_markdown()).unwrap();
        std::fs::write(project.join("figures/mermaid-0000000000000000.png"), b"png").unwrap();
        let bases = tempfile::tempdir().unwrap();
        let spec = markdown_spec_with(&project.join("build"), &project, test_scratch(bases.path()));
        let output = project.join("main.native");
        let (log, code) = run_supervised_process_with_environment(
            &pandoc,
            &pandoc_args_writing(&spec, "native", &output),
            &spec.working_dir,
            None,
            COMPILE_TIMEOUT,
            None,
            &spec.environment,
        )
        .await
        .unwrap();
        assert_eq!(code, Some(0), "{log}");
        let native = std::fs::read_to_string(&output).unwrap();
        assert_eq!(native.matches("CodeBlock").count(), 2, "{native}");
        assert!(!native.contains("Image"), "{native}");
    }

    #[test]
    fn markdown_bibliographies_cover_every_project_bib_file_exactly_once() {
        let dir = std::env::temp_dir().join(format!("oleafly-md-cites-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("main.md"), "See [@demo].").unwrap();
        std::fs::write(dir.join("references.bib"), "@article{demo,title={Demo}}").unwrap();
        std::fs::create_dir_all(dir.join("sources")).unwrap();
        std::fs::write(
            dir.join("sources/refs.bib"),
            "@article{nested,title={Nested}}",
        )
        .unwrap();
        #[cfg(unix)]
        std::os::unix::fs::symlink(dir.join("references.bib"), dir.join("linked.bib")).unwrap();
        let bases = tempfile::tempdir().unwrap();
        let spec = markdown_spec_with(&dir.join("build"), &dir, test_scratch(bases.path()));
        assert!(spec.args.iter().any(|arg| arg == "--citeproc"));
        let bibliography_args: Vec<_> = spec
            .args
            .iter()
            .filter(|arg| arg.starts_with("--metadata=oleafly-fallback-bibliography="))
            .cloned()
            .collect();
        assert!(!spec
            .args
            .iter()
            .any(|arg| arg.starts_with("--bibliography=")));
        assert_eq!(
            bibliography_args,
            [
                format!(
                    "--metadata=oleafly-fallback-bibliography={}",
                    dir.join("references.bib").to_string_lossy()
                ),
                format!(
                    "--metadata=oleafly-fallback-bibliography={}",
                    dir.join("sources").join("refs.bib").to_string_lossy()
                ),
            ]
        );
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn markdown_pandoc_scratch_folder_is_fresh_safe_for_tex_and_outside_the_project() {
        let base = tempfile::Builder::new()
            .prefix("oleafly-pandoc-temp-")
            .tempdir()
            .unwrap();
        let project = base.path().join("folders").join("Paper #2 {50% & more}");
        std::fs::create_dir_all(&project).unwrap();
        std::fs::write(project.join("main.md"), "# Notes\n").unwrap();
        let out = base
            .path()
            .join("data")
            .join("linked")
            .join("linked-0123456789abcdef0123456789abcdef")
            .join("build");
        let production = engine_scratch_bases(&out);
        assert_eq!(production.build, out);
        assert_eq!(production.system, std::env::temp_dir());
        assert!(production
            .owned
            .as_deref()
            .is_some_and(|owned| owned.ends_with(oleafly_core::ENGINE_TEMP_DIR)));
        let root = oleafly_core::plain_path(&base.path().canonicalize().unwrap());
        let system = base.path().join("system tmp");
        std::fs::create_dir_all(&system).unwrap();
        let owned = base.path().join("data").join(oleafly_core::ENGINE_TEMP_DIR);
        let bases = oleafly_core::EngineScratchBases {
            system: system.clone(),
            owned: Some(owned),
            build: out.clone(),
        };
        let expected_parent = oleafly_core::tex_safe_path(&root)
            .then(|| oleafly_core::plain_path(&system.canonicalize().unwrap()));
        let before = crate::linked_registry::folder_snapshot_for_test(&project);
        let spec = |scratch| {
            markdown_compile_spec(
                &MARKDOWN_ENGINE,
                &out,
                &project,
                "main.md",
                MarkdownTools {
                    pandoc: PathBuf::from("/pandoc"),
                    tectonic: PathBuf::from("/tectonic"),
                    typst: None,
                    scratch,
                },
                CompileOptions {
                    source_date_epoch: Some(1_700_000_000),
                    ..Default::default()
                },
            )
            .unwrap()
        };
        let first = spec(pandoc_scratch(&bases).unwrap());
        let second = spec(pandoc_scratch(&bases).unwrap());
        assert_eq!(
            first.environment.variables[0],
            ("SOURCE_DATE_EPOCH".to_string(), "1700000000".to_string())
        );
        let first_scratch = PathBuf::from(temp_variables(&first)[0].1);
        let second_scratch = PathBuf::from(temp_variables(&second)[0].1);
        assert_ne!(first_scratch, second_scratch);
        assert_eq!(first.working_dir, first_scratch);
        assert_eq!(second.working_dir, second_scratch);
        assert_eq!(
            first.environment.path_excluded_root(&first.working_dir),
            project
        );
        let canonical_project = project.canonicalize().unwrap();
        for (name, value) in temp_variables(&first) {
            let value = Path::new(value);
            assert_eq!(value, first_scratch, "{name}");
            assert!(value.is_dir(), "{name}");
            assert!(value.starts_with(&root), "{}", value.display());
            match &expected_parent {
                Some(parent) => {
                    assert_eq!(value.parent(), Some(parent.as_path()));
                    assert!(oleafly_core::tex_safe_path(value), "{}", value.display());
                }
                None => assert!(value.to_string_lossy().ends_with('~')),
            }
            assert!(!value.starts_with(&project), "{name}");
            assert!(!value.starts_with(&canonical_project), "{name}");
        }
        drop(first);
        assert!(!first_scratch.exists());
        assert!(second_scratch.is_dir());
        drop(second);
        assert!(!second_scratch.exists());
        assert_eq!(
            crate::linked_registry::folder_snapshot_for_test(&project),
            before
        );
    }

    #[test]
    fn markdown_arguments_do_not_depend_on_which_scratch_base_was_safe() {
        let base = tempfile::tempdir().unwrap();
        let project = base.path().join("Paper #2");
        std::fs::create_dir_all(project.join("sources")).unwrap();
        std::fs::write(project.join("main.md"), "See [@demo].").unwrap();
        std::fs::write(project.join("sources/refs.bib"), "@misc{demo}").unwrap();
        let system = base.path().join("tmp #1");
        std::fs::create_dir(&system).unwrap();
        let out = base.path().join("build 50%");
        let unsafe_scratch =
            oleafly_core::EngineScratch::create(&oleafly_core::EngineScratchBases {
                system: system.clone(),
                owned: Some(base.path().join("data {x}").join("engine-tmp")),
                build: out.clone(),
            })
            .unwrap();
        let unsafe_path = unsafe_scratch.path().to_path_buf();
        assert!(unsafe_path.to_string_lossy().ends_with('~'));
        let safe_bases = tempfile::tempdir().unwrap();
        let safe = markdown_spec_with(&out, &project, test_scratch(safe_bases.path()));
        let fallback = markdown_spec_with(&out, &project, unsafe_scratch);
        assert_eq!(fallback.args, safe.args);
        assert_eq!(fallback.working_dir, unsafe_path);
        assert_eq!(
            fallback
                .environment
                .path_excluded_root(&fallback.working_dir),
            project
        );
        assert!(safe.args.contains(&format!(
            "--metadata=oleafly-fallback-bibliography={}",
            project.join("sources").join("refs.bib").to_string_lossy()
        )));
        let scratch_text = unsafe_path.to_string_lossy().into_owned();
        assert_eq!(
            temp_variables(&fallback),
            ["TMP", "TEMP", "TMPDIR"].map(|name| (name, scratch_text.as_str()))
        );
        assert_eq!(std::fs::read_dir(&system).unwrap().count(), 0);
        drop(fallback);
        assert!(!unsafe_path.exists());
    }

    #[cfg(windows)]
    #[test]
    fn markdown_hands_pandoc_project_paths_without_the_verbatim_prefix() {
        let base = tempfile::tempdir().unwrap();
        let project = std::fs::canonicalize(base.path()).unwrap().join("Paper");
        std::fs::create_dir_all(project.join("sources")).unwrap();
        std::fs::write(project.join("main.md"), "See [@demo].").unwrap();
        std::fs::write(project.join("sources").join("refs.bib"), "@misc{demo}").unwrap();
        assert!(project.to_string_lossy().starts_with(r"\\?\"));
        let bases = tempfile::tempdir().unwrap();
        let out = project.join(".oleafly").join("build");
        let spec = markdown_spec_with(&out, &project, test_scratch(bases.path()));
        let plain = oleafly_core::plain_path(&project);
        let plain_text = plain.to_string_lossy();
        assert!(plain_text.starts_with(|letter: char| letter.is_ascii_alphabetic()));
        assert_eq!(resource_variable(&spec), None);
        for expected in [
            format!("--resource-path={plain_text}"),
            format!("--pdf-engine-opt=-Zsearch-path={plain_text}"),
            format!(
                "--metadata=oleafly-fallback-bibliography={}",
                plain.join("sources").join("refs.bib").to_string_lossy()
            ),
            format!(
                "--output={}",
                oleafly_core::plain_path(&out)
                    .join("_oleafly_entry.pdf")
                    .to_string_lossy()
            ),
            plain.join("main.md").to_string_lossy().into_owned(),
        ] {
            assert!(spec.args.contains(&expected), "{expected} {:?}", spec.args);
        }
        assert!(
            spec.args.iter().all(|arg| !arg.contains(r"\\?\")),
            "{:?}",
            spec.args
        );
    }

    #[cfg(unix)]
    const FAKE_TECTONIC: &str = r#"#!/bin/sh
outdir=
search=
while [ $# -gt 0 ]; do
  case $1 in
    --outdir) outdir=$2; shift ;;
    -Zsearch-path=*) search=${1#-Zsearch-path=} ;;
  esac
  shift
done
cat > "$outdir/texput.tex"
cp "$outdir/texput.tex" '{record}.tex'
pwd -P > '{record}.cwd'
(cd "$outdir" && pwd -P) > '{record}.outdir'
printf '%s\n' "$outdir" > '{record}.outdir-argument'
printf '%s\n' "$TMP" "$TEMP" "$TMPDIR" > '{record}.env'
found() {
  case $1 in
    /*) [ -f "$1" ] ;;
    *) [ -f "$1" ] || { [ -n "$search" ] && [ -f "$search/$1" ]; } ;;
  esac
}
grep -oE '\\includegraphics(\[[^]]*\])?\{[^}]*\}' "$outdir/texput.tex" | sed 's/.*{//; s/}$//' > '{record}.images'
while IFS= read -r image; do
  if printf '%s' "$image" | grep -q '[#%^{}~&$\\]'; then
    echo "unsafe image path: $image" >&2
    exit 1
  fi
  if ! found "$image"; then
    echo "missing image: $image" >&2
    exit 1
  fi
done < '{record}.images'
grep -oE '\\input\{[^}]*\}' "$outdir/texput.tex" | sed 's/.*{//; s/}$//' > '{record}.inputs'
while IFS= read -r input; do
  if ! found "$input" && ! found "$input.tex"; then
    echo "missing input: $input" >&2
    exit 1
  fi
done < '{record}.inputs'
printf '%s\n' '%PDF-1.4' '%%EOF' > "$outdir/texput.pdf"
"#;

    #[cfg(unix)]
    const ONE_PIXEL_PNG: [u8; 70] = [
        137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6,
        0, 0, 0, 31, 21, 196, 137, 0, 0, 0, 13, 73, 68, 65, 84, 120, 156, 99, 248, 207, 192, 240,
        31, 0, 5, 0, 1, 255, 137, 153, 61, 29, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130,
    ];

    #[cfg(unix)]
    const MARKER_CSL: &str = r#"<?xml version="1.0" encoding="utf-8"?>
<style xmlns="http://purl.org/net/xbiblio/csl" class="in-text" version="1.0">
  <info><title>Marker</title><id>marker</id><updated>2026-01-01T00:00:00+00:00</updated></info>
  <citation><layout prefix="[CSLMARK " suffix="]" delimiter=", "><text variable="citation-number"/></layout></citation>
  <bibliography><layout><text variable="title"/></layout></bibliography>
</style>
"#;

    #[cfg(unix)]
    struct RealPandocRun {
        base: PathBuf,
        _directory: tempfile::TempDir,
        pandoc: PathBuf,
        tectonic: PathBuf,
        record: PathBuf,
    }

    #[cfg(unix)]
    impl RealPandocRun {
        fn new() -> Option<Self> {
            let triple = crate::biber_toolchain::host_triple_guess()?;
            let pandoc = Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("binaries")
                .join(format!("pandoc-{triple}"));
            if !pandoc.is_file() {
                return None;
            }
            let directory = tempfile::Builder::new()
                .prefix("oleafly-real-pandoc-")
                .tempdir()
                .unwrap();
            let base = directory.path().canonicalize().unwrap();
            let bin = base.join("bin");
            std::fs::create_dir_all(&bin).unwrap();
            let record = base.join("tectonic-run");
            let tectonic = bin.join("tectonic");
            Self::script(
                &tectonic,
                &FAKE_TECTONIC.replace("{record}", &record.to_string_lossy()),
            );
            Some(Self {
                base,
                _directory: directory,
                pandoc,
                tectonic,
                record,
            })
        }

        fn script(path: &Path, content: &str) {
            use std::os::unix::fs::PermissionsExt;
            std::fs::write(path, content).unwrap();
            std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o755)).unwrap();
        }

        fn file(project: &Path, relative: &str, content: &[u8]) {
            let path = project.join(relative);
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(path, content).unwrap();
        }

        fn project(&self, name: &str) -> PathBuf {
            let project = self.base.join("folders").join(name);
            Self::file(
                &project,
                "main.md",
                concat!(
                    "---\n",
                    "title: Notes\n",
                    "csl: styles/marker.csl\n",
                    "header-includes:\n",
                    "  - \\input{macros}\n",
                    "  - \\input{tex/extra}\n",
                    "---\n\n",
                    "\\MACROTEXT{} and \\EXTRATEXT{}.\n\n",
                    "As @knuth shows.\n\n",
                    "![Root](root.png)\n\n",
                    "![A plot](figs/plot.png)\n\n",
                    "\\includegraphics{figs/raw.png}\n",
                )
                .as_bytes(),
            );
            for image in ["root.png", "figs/plot.png", "figs/raw.png"] {
                Self::file(&project, image, &ONE_PIXEL_PNG);
            }
            Self::file(&project, "macros.tex", b"\\newcommand{\\MACROTEXT}{M}\n");
            Self::file(&project, "tex/extra.tex", b"\\newcommand{\\EXTRATEXT}{E}\n");
            Self::file(
                &project,
                "sources/refs.bib",
                b"@book{knuth, author={Donald Knuth}, title={KnuthTitle}, year={1984}}\n",
            );
            Self::file(&project, "styles/marker.csl", MARKER_CSL.as_bytes());
            project
        }

        fn spec(
            &self,
            out: &Path,
            project: &Path,
            scratch: oleafly_core::EngineScratch,
        ) -> EngineCompileSpec {
            self.spec_for(out, project, "main.md", None, scratch)
        }

        fn spec_for(
            &self,
            out: &Path,
            project: &Path,
            main_document: &str,
            typst: Option<PathBuf>,
            scratch: oleafly_core::EngineScratch,
        ) -> EngineCompileSpec {
            markdown_compile_spec(
                &MARKDOWN_ENGINE,
                out,
                project,
                main_document,
                MarkdownTools {
                    pandoc: self.pandoc.clone(),
                    tectonic: self.tectonic.clone(),
                    typst,
                    scratch,
                },
                CompileOptions::default(),
            )
            .unwrap()
        }

        fn typst() -> Option<PathBuf> {
            let triple = crate::biber_toolchain::host_triple_guess()?;
            let typst = Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("binaries")
                .join(format!("typst-{triple}"));
            typst.is_file().then_some(typst)
        }

        async fn generated_tex(&self, name: &str, source: &str) -> String {
            let project = self.base.join("generated").join(name);
            Self::file(&project, "main.md", source.as_bytes());
            let out = self.base.join("data").join("build");
            let created = self.scratch(&out);
            let spec = self.spec(&out, &project, created);
            self.run(&spec, &[]).await;
            self.recorded("tex")
        }

        fn scratch(&self, out: &Path) -> oleafly_core::EngineScratch {
            let system = self.base.join("tmp");
            std::fs::create_dir_all(&system).unwrap();
            pandoc_scratch(&oleafly_core::EngineScratchBases {
                system,
                owned: Some(self.base.join("data").join(oleafly_core::ENGINE_TEMP_DIR)),
                build: out.to_path_buf(),
            })
            .unwrap()
        }

        async fn run(&self, spec: &EngineCompileSpec, inherited: &[(&str, String)]) {
            let (log, code) = self.attempt(spec, inherited).await;
            assert_eq!(code, Some(0), "{log}");
        }

        async fn attempt(
            &self,
            spec: &EngineCompileSpec,
            inherited: &[(&str, String)],
        ) -> (String, Option<i32>) {
            let EngineExecutable::ExternalPath(pandoc) = &spec.executable else {
                panic!("{:?}", spec.executable);
            };
            let mut environment = spec.environment.clone();
            environment.variables = inherited
                .iter()
                .map(|(name, value)| ((*name).to_owned(), value.clone()))
                .chain(spec.environment.variables.iter().cloned())
                .collect();
            run_supervised_process_with_environment(
                pandoc,
                &spec.args,
                &spec.working_dir,
                None,
                COMPILE_TIMEOUT,
                None,
                &environment,
            )
            .await
            .unwrap()
        }

        fn recorded(&self, kind: &str) -> String {
            std::fs::read_to_string(format!("{}.{kind}", self.record.display())).unwrap()
        }

        fn assert_everything_resolved(&self, scratch: &Path) {
            let images = self.recorded("images");
            let images: Vec<_> = images.lines().collect();
            assert_eq!(images.len(), 3, "{images:?}");
            assert!(images.contains(&"figs/raw.png"), "{images:?}");
            let media: Vec<_> = images
                .iter()
                .filter(|image| **image != "figs/raw.png")
                .collect();
            for image in &media {
                let image = Path::new(image);
                assert!(
                    image.is_relative() || image.starts_with(scratch),
                    "{}",
                    image.display()
                );
            }
            assert!(media.iter().any(|image| image.ends_with("/root.png")));
            assert!(media.iter().any(|image| image.ends_with("/figs/plot.png")));
            assert_eq!(
                self.recorded("inputs").lines().collect::<Vec<_>>(),
                ["macros", "tex/extra"]
            );
            let tex = self.recorded("tex");
            assert!(tex.contains("CSLMARK"), "{tex}");
            assert!(tex.contains("KnuthTitle"), "{tex}");
            assert_eq!(Path::new(self.recorded("cwd").trim_end()), scratch);
            assert!(Path::new(self.recorded("outdir").trim_end()).starts_with(scratch));
        }
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn real_pandoc_adds_no_font_setup_to_a_latin_document() {
        let Some(run) = RealPandocRun::new() else {
            return;
        };
        let tex = run
            .generated_tex(
                "latin",
                "---\ntitle: Plain Latin\n---\n\nRésumé, “quotes” — and €5, Tiếng Việt → done.\n",
            )
            .await;
        for absent in ["\\setmainfont", "xeCJK", "oleafly", "newunicodechar"] {
            assert!(!tex.contains(absent), "{absent} {tex}");
        }
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn real_pandoc_picks_bundled_fonts_for_the_scripts_it_finds() {
        let Some(run) = RealPandocRun::new() else {
            return;
        };
        for (name, body, expected) in [
            (
                "korean",
                "대한민국의 수도는 서울입니다.",
                &["\\setCJKmainfont", "UnBatang.ttf", "CJKspace=true"][..],
            ),
            (
                "japanese",
                "これは日本語のテスト文書です。",
                &["HaranoAjiMincho-Regular.otf", "AutoFallBack=true"][..],
            ),
            (
                "simplified",
                "这是一个中文文档。",
                &["FandolSong-Regular.otf"][..],
            ),
            (
                "traditional",
                "這是一個中文文件,們來為時。",
                &["bsmi00lp.ttf"][..],
            ),
            (
                "cyrillic",
                "Русский текст.",
                &["cmunrm.otf", "cmuntt.otf"][..],
            ),
            ("greek", "Ελληνικά κείμενο.", &["cmunbx.otf"][..]),
            (
                "symbols",
                "Status ✓ done, p ≥ 0.05.",
                &[
                    "\\newunicodechar{✓}",
                    "\\newunicodechar{≥}",
                    "FreeSerif.otf",
                ][..],
            ),
            ("emoji", "Launch 😀 today.", &["NotoEmoji-Regular.ttf"][..]),
            (
                "embedded-arabic",
                "English with مرحبا بالعالم inside.",
                &[
                    "\\oleaflyrunarabic{مرحبا بالعالم}",
                    "Amiri-Regular.ttf",
                    "\\beginR",
                ][..],
            ),
            (
                "embedded-thai",
                "English with สวัสดีชาวโลก inside.",
                &["\\oleaflyrunthai{สวัสดีชาวโลก}", "Norasi.otf"][..],
            ),
            (
                "embedded-hindi",
                "English with नमस्ते दुनिया inside.",
                &["\\oleaflyrundevanagari{नमस्ते दुनिया}", "Shobhika-Regular.otf"][..],
            ),
            (
                "mostly-arabic",
                "مرحبا بالعالم الجميل، هذا نص عربي طويل.",
                &["pdflang={ar}", "\\babelfont{rm}", "Amiri-Regular.ttf"][..],
            ),
            (
                "mostly-hebrew",
                "שלום עולם יפה, זה טקסט עברי.",
                &["pdflang={he}", "\\babelfont{rm}", "FreeSerif.otf"][..],
            ),
        ] {
            let tex = run.generated_tex(name, &format!("{body}\n")).await;
            for wanted in expected {
                assert!(tex.contains(wanted), "{name}: {wanted}\n{tex}");
            }
        }
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn real_pandoc_keeps_the_fonts_a_document_sets_for_itself() {
        let Some(run) = RealPandocRun::new() else {
            return;
        };
        let tex = run
            .generated_tex(
                "own-fonts",
                "---\nmainfont: FreeSerif.otf\nCJKmainfont: FandolHei-Regular.otf\n---\n\nПривет 中文.\n",
            )
            .await;
        assert!(tex.contains("{FreeSerif.otf}"), "{tex}");
        assert!(tex.contains("{FandolHei-Regular.otf}"), "{tex}");
        assert!(!tex.contains("cmunrm.otf"), "{tex}");
        assert!(!tex.contains("FandolSong-Regular.otf"), "{tex}");

        let tex = run
            .generated_tex(
                "own-preamble",
                "---\nheader-includes: |\n  \\usepackage{xeCJK}\n  \\setCJKmainfont{FandolHei-Regular.otf}\n---\n\n中文 Привет.\n",
            )
            .await;
        assert!(!tex.contains("FandolSong-Regular.otf"), "{tex}");
        assert!(tex.contains("cmunrm.otf"), "{tex}");
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn real_pandoc_keeps_a_run_in_a_font_that_covers_its_script() {
        let Some(run) = RealPandocRun::new() else {
            return;
        };
        for (name, source) in [
            (
                "own-mainfont",
                "---\nmainfont: DejaVuSans.ttf\n---\n\nEnglish with שלום inside.\n",
            ),
            (
                "own-setmainfont",
                "---\nheader-includes: |\n  \\setmainfont{DejaVuSans.ttf}\n---\n\nEnglish with שלום inside.\n",
            ),
        ] {
            let tex = run.generated_tex(name, source).await;
            assert!(
                tex.contains(
                    "\\iffontchar\\font\"5D0 \\addfontfeatures{Script=Hebrew}\\else\\oleaflyfonthebrew\\fi"
                ),
                "{name}: {tex}"
            );
        }
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn real_pandoc_leaves_a_character_the_preamble_defines_to_the_preamble() {
        let Some(run) = RealPandocRun::new() else {
            return;
        };
        let tex = run
            .generated_tex(
                "claimed-symbol",
                "---\nheader-includes: |\n  \\usepackage{newunicodechar}\n  \\newunicodechar{✓}{\\textbf{OK}}\n---\n\nDone ✓ then ≥ next.\n",
            )
            .await;
        assert!(tex.contains("\\newunicodechar{✓}{\\textbf{OK}}"), "{tex}");
        assert!(
            !tex.contains("\\newunicodechar{✓}{\\oleaflysymbolglyph"),
            "{tex}"
        );
        assert!(
            tex.contains("\\newunicodechar{≥}{\\oleaflysymbolglyph"),
            "{tex}"
        );

        let tex = run
            .generated_tex(
                "claimed-emoji",
                "---\nheader-includes: |\n  \\usepackage{newunicodechar}\n  \\newunicodechar{😀}{:)}\n---\n\nLaunch 😀 today.\n",
            )
            .await;
        assert!(!tex.contains("NotoEmoji-Regular.ttf"), "{tex}");
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn real_pandoc_defines_the_keyword_macro_before_the_template_uses_it() {
        let Some(run) = RealPandocRun::new() else {
            return;
        };
        let tex = run
            .generated_tex("keywords", "---\nkeywords: [foo, bar]\n---\n\nBody.\n")
            .await;
        let defined = tex.find("\\providecommand{\\xmpquote}[1]{#1}");
        assert!(defined.is_some(), "{tex}");
        assert!(defined < tex.find("pdfkeywords"), "{tex}");

        let tex = run.generated_tex("no-keywords", "Body.\n").await;
        assert!(!tex.contains("xmpquote"), "{tex}");
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn real_pandoc_keeps_a_declared_bibliography_over_stray_bib_files() {
        let Some(run) = RealPandocRun::new() else {
            return;
        };
        let project = run.base.join("declared");
        RealPandocRun::file(
            &project,
            "main.md",
            b"---\nbibliography: refs/refs.json\n---\n\nAs @lamport shows.\n",
        );
        RealPandocRun::file(
            &project,
            "refs/refs.json",
            br#"[{"id":"lamport","type":"book","title":"LamportTitle","author":[{"family":"Lamport"}]}]"#,
        );
        RealPandocRun::file(
            &project,
            "archive/old.bib",
            b"@article{broken, title={Unfinished\n",
        );
        let out = run.base.join("data").join("build");
        let created = run.scratch(&out);
        let spec = run.spec(&out, &project, created);
        run.run(&spec, &[]).await;
        let tex = run.recorded("tex");
        assert!(tex.contains("LamportTitle"), "{tex}");
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn real_pandoc_reads_only_the_bib_files_that_define_a_cited_key() {
        let Some(run) = RealPandocRun::new() else {
            return;
        };
        let project = run.base.join("cited");
        RealPandocRun::file(&project, "main.md", b"As @knuth shows.\n");
        RealPandocRun::file(
            &project,
            "sources/refs.bib",
            b"@book{knuth, author={Donald Knuth}, title={KnuthTitle}, year={1984}}\n",
        );
        RealPandocRun::file(
            &project,
            "archive/old.bib",
            b"@article{broken, title={Unfinished\n",
        );
        RealPandocRun::file(
            &project,
            "archive/latin1.bib",
            b"@misc{x, title={caf\xe9}}\n",
        );
        let out = run.base.join("data").join("build");
        let created = run.scratch(&out);
        let spec = run.spec(&out, &project, created);
        run.run(&spec, &[]).await;
        let tex = run.recorded("tex");
        assert!(tex.contains("KnuthTitle"), "{tex}");
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn real_pandoc_skips_a_broken_bib_that_only_names_a_cited_key_in_a_field() {
        let Some(run) = RealPandocRun::new() else {
            return;
        };
        for (name, stray) in [
            (
                "mention-entry",
                &b"@article{other, author = {Smith, John}, title={Unfinished\n"[..],
            ),
            ("mention-field", &b"author = {Smith, John}\n"[..]),
        ] {
            let project = run.base.join(name);
            RealPandocRun::file(&project, "main.md", b"As @smith shows.\n");
            RealPandocRun::file(
                &project,
                "good.bib",
                b"@book{smith, author={Jane Smith}, title={SmithTitle}, year={2020}}\n",
            );
            RealPandocRun::file(&project, "archive/old.bib", stray);
            let out = run.base.join("data").join("build");
            let created = run.scratch(&out);
            let spec = run.spec(&out, &project, created);
            run.run(&spec, &[]).await;
            let tex = run.recorded("tex");
            assert!(tex.contains("SmithTitle"), "{name}: {tex}");
        }
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn real_pandoc_reads_no_bibliography_for_a_document_that_cites_nothing() {
        let Some(run) = RealPandocRun::new() else {
            return;
        };
        let project = run.base.join("uncited");
        RealPandocRun::file(&project, "main.md", b"Nothing cited here.\n");
        RealPandocRun::file(
            &project,
            "archive/old.bib",
            b"@article{broken, title={Unfinished\n",
        );
        let out = run.base.join("data").join("build");
        let created = run.scratch(&out);
        let spec = run.spec(&out, &project, created);
        run.run(&spec, &[]).await;
        assert!(run.recorded("tex").contains("Nothing cited here."));
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn real_pandoc_leaves_a_handle_alone_when_the_project_has_no_bibliography() {
        let Some(run) = RealPandocRun::new() else {
            return;
        };
        let tex = run
            .generated_tex("handle", "Contact @jgm on GitHub.\n")
            .await;
        assert!(tex.contains("@jgm"), "{tex}");
        assert!(!tex.contains("jgm?"), "{tex}");
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn real_pandoc_reads_files_beside_a_nested_main_document() {
        let Some(run) = RealPandocRun::new() else {
            return;
        };
        let project = run.base.join("nested");
        RealPandocRun::file(
            &project,
            "notes/main.md",
            b"---\ncsl: styles/marker.csl\nbibliography: local.json\n---\n\nAs @lamport shows.\n\n![Beside](figures/plot.png)\n\n![Above](../images/parent.png)\n\n![Root](root.png)\n",
        );
        RealPandocRun::file(&project, "notes/figures/plot.png", &ONE_PIXEL_PNG);
        RealPandocRun::file(&project, "images/parent.png", &ONE_PIXEL_PNG);
        RealPandocRun::file(&project, "root.png", &ONE_PIXEL_PNG);
        RealPandocRun::file(&project, "notes/styles/marker.csl", MARKER_CSL.as_bytes());
        RealPandocRun::file(
            &project,
            "notes/local.json",
            br#"[{"id":"lamport","type":"book","title":"LamportTitle","author":[{"family":"Lamport"}]}]"#,
        );
        let out = run.base.join("data").join("build");
        let created = run.scratch(&out);
        let spec = run.spec_for(&out, &project, "notes/main.md", None, created);
        run.run(&spec, &[]).await;
        assert_eq!(run.recorded("images").lines().count(), 3);
        let tex = run.recorded("tex");
        assert!(tex.contains("CSLMARK"), "{tex}");
        assert!(tex.contains("LamportTitle"), "{tex}");
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn real_pandoc_reads_beside_a_nested_main_when_the_project_path_needs_a_variable() {
        let Some(run) = RealPandocRun::new() else {
            return;
        };
        for name in ["Thesis 2024:25", "Draft 1:2 ${HOME} ${.}"] {
            let project = run.base.join("variable").join(name);
            RealPandocRun::file(&project, "notes/main.md", b"![Beside](figures/plot.png)\n");
            RealPandocRun::file(&project, "notes/figures/plot.png", &ONE_PIXEL_PNG);
            let out = run.base.join("data").join("build");
            let created = run.scratch(&out);
            let spec = run.spec_for(&out, &project, "notes/main.md", None, created);
            run.run(&spec, &[]).await;
            assert_eq!(run.recorded("images").lines().count(), 1, "{name}");
        }
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn real_pandoc_turns_web_images_into_pdf_through_typst() {
        let (Some(run), Some(typst)) = (RealPandocRun::new(), RealPandocRun::typst()) else {
            return;
        };
        let project = run.base.join("Fig folder #2 한글");
        RealPandocRun::file(
            &project,
            "main.md",
            b"![Vector](figs/s.svg)\n\n![Animated](figs/g.gif)\n\n![Web](figs/w.webp)\n",
        );
        RealPandocRun::file(
            &project,
            "figs/s.svg",
            br##"<svg xmlns="http://www.w3.org/2000/svg" width="20" height="10"><rect width="20" height="10" fill="#39c"/></svg>"##,
        );
        let decode = |text: &str| {
            base64::Engine::decode(&base64::engine::general_purpose::STANDARD, text).unwrap()
        };
        RealPandocRun::file(
            &project,
            "figs/g.gif",
            &decode("R0lGODdhAgACAIAAAAAAAP///ywAAAAAAgACAAACAoRRADs="),
        );
        RealPandocRun::file(
            &project,
            "figs/w.webp",
            &decode("UklGRiIAAABXRUJQVlA4TBUAAAAvAAAAEAcQERGIiP4HAA=="),
        );
        let out = run.base.join("data").join("build");
        let created = run.scratch(&out);
        let spec = run.spec_for(&out, &project, "main.md", Some(typst), created);
        run.run(&spec, &[]).await;
        let images = run.recorded("images");
        assert_eq!(images.lines().count(), 3, "{images}");
        assert!(
            images.lines().all(|image| image.ends_with(".pdf")),
            "{images}"
        );
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn real_pandoc_stops_on_an_image_it_cannot_use_and_names_it() {
        let Some(run) = RealPandocRun::new() else {
            return;
        };
        let project = run.base.join("tiff");
        RealPandocRun::file(&project, "main.md", b"![Scan](figs/scan.tiff)\n");
        RealPandocRun::file(&project, "figs/scan.tiff", b"II*\0");
        let out = run.base.join("data").join("build");
        let created = run.scratch(&out);
        let spec = run.spec(&out, &project, created);
        let (log, code) = run.attempt(&spec, &[]).await;
        assert_ne!(code, Some(0), "{log}");
        let errors = MARKDOWN_ENGINE.parse_errors(&log);
        assert_eq!(errors.len(), 1, "{log}");
        assert_eq!(
            errors[0].code.as_deref(),
            Some("markdown.image_unsupported")
        );
        assert_eq!(errors[0].params["path"], "figs/scan.tiff");
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn real_pandoc_refuses_phone_and_new_web_images_with_one_card() {
        let Some(run) = RealPandocRun::new() else {
            return;
        };
        for image in ["a.avif", "IMG_1.HEIC", "b.heif", "c.jxl"] {
            let project = run.base.join("refused").join(image);
            let relative = format!("figs/{image}");
            RealPandocRun::file(
                &project,
                "main.md",
                format!("![Photo]({relative})\n").as_bytes(),
            );
            RealPandocRun::file(&project, &relative, b"\0\0\0\x1cftyp");
            let out = run.base.join("data").join("build");
            let created = run.scratch(&out);
            let spec = run.spec(&out, &project, created);
            let (log, code) = run.attempt(&spec, &[]).await;
            assert_ne!(code, Some(0), "{log}");
            let errors = MARKDOWN_ENGINE.parse_errors(&log);
            assert_eq!(errors.len(), 1, "{log}");
            assert_eq!(
                errors[0].code.as_deref(),
                Some("markdown.image_unsupported")
            );
            assert_eq!(errors[0].params["path"], relative);
        }
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn real_pandoc_reports_a_web_image_when_typst_is_not_there() {
        let Some(run) = RealPandocRun::new() else {
            return;
        };
        let project = run.base.join("no-typst");
        RealPandocRun::file(&project, "main.md", b"![Vector](figs/s.svg)\n");
        RealPandocRun::file(
            &project,
            "figs/s.svg",
            br#"<svg xmlns="http://www.w3.org/2000/svg" width="20" height="10"/>"#,
        );
        let out = run.base.join("data").join("build");
        let created = run.scratch(&out);
        let spec = run.spec(&out, &project, created);
        let (log, code) = run.attempt(&spec, &[]).await;
        assert_ne!(code, Some(0), "{log}");
        let errors = MARKDOWN_ENGINE.parse_errors(&log);
        assert_eq!(
            errors[0].code.as_deref(),
            Some("markdown.image_conversion_failed"),
            "{log}"
        );
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn real_pandoc_keeps_its_scratch_folder_out_of_the_project_when_the_inherited_temp_path_has_a_tilde(
    ) {
        let Some(run) = RealPandocRun::new() else {
            return;
        };
        let project = run.project("Bob's notes");
        let out = run
            .base
            .join("data")
            .join("linked")
            .join("linked-0123456789abcdef0123456789abcdef")
            .join("build");
        let inherited_temp = run.base.join("oleafly~tmp");
        std::fs::create_dir_all(&inherited_temp).unwrap();
        let before = crate::linked_registry::folder_snapshot_for_test(&project);
        let created = run.scratch(&out);
        let scratch = created.path().canonicalize().unwrap();
        let spec = run.spec(&out, &project, created);
        let inherited = oleafly_core::TEMP_DIRECTORY_VARIABLES
            .map(|name| (name, inherited_temp.to_string_lossy().into_owned()));
        run.run(&spec, &inherited).await;
        run.assert_everything_resolved(&scratch);
        assert!(Path::new(run.recorded("outdir-argument").trim_end()).is_absolute());
        assert!(out
            .join(format!("{}.pdf", crate::paths::ENTRY_STEM))
            .is_file());
        assert_eq!(
            crate::linked_registry::folder_snapshot_for_test(&project),
            before
        );
        assert_eq!(std::fs::read_dir(&inherited_temp).unwrap().count(), 0);
        drop(spec);
        assert!(!scratch.exists());
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn real_pandoc_hands_tectonic_the_saved_mermaid_figure() {
        let Some(run) = RealPandocRun::new() else {
            return;
        };
        let project = run.base.join("folders").join("Diagrams");
        RealPandocRun::file(&project, "main.md", mermaid_markdown().as_bytes());
        RealPandocRun::file(&project, MERMAID_FLOWCHART_FIGURE, &ONE_PIXEL_PNG);
        let out = run.base.join("build");
        std::fs::create_dir_all(&out).unwrap();
        let created = run.scratch(&out);
        let spec = run.spec(&out, &project, created);
        run.run(&spec, &[]).await;
        let images = run.recorded("images");
        let images: Vec<_> = images.lines().collect();
        assert_eq!(images.len(), 1, "{images:?}");
        assert!(images[0].ends_with(MERMAID_FLOWCHART_FIGURE), "{images:?}");
        let tex = run.recorded("tex");
        assert!(tex.contains("\\begin{center}"), "{tex}");
        assert!(tex.contains("flowchart LR"), "{tex}");
        assert!(!tex.contains("flowchart TD"), "{tex}");
        assert!(out
            .join(format!("{}.pdf", crate::paths::ENTRY_STEM))
            .is_file());
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn real_pandoc_compiles_a_project_whose_folder_name_tex_cannot_read() {
        let Some(run) = RealPandocRun::new() else {
            return;
        };
        let project = run.project("Paper #2 {50% & more}");
        let out = project.join(".oleafly").join("build");
        std::fs::create_dir_all(&out).unwrap();
        let before = crate::linked_registry::folder_snapshot_for_test(&project);
        let created = run.scratch(&out);
        let scratch = created.path().canonicalize().unwrap();
        let spec = run.spec(&out, &project, created);
        assert!(!scratch.starts_with(&project));
        run.run(&spec, &[]).await;
        run.assert_everything_resolved(&scratch);
        assert!(out
            .join(format!("{}.pdf", crate::paths::ENTRY_STEM))
            .is_file());
        drop(spec);
        assert!(!scratch.exists());
        std::fs::remove_file(out.join(format!("{}.pdf", crate::paths::ENTRY_STEM))).unwrap();
        assert_eq!(
            crate::linked_registry::folder_snapshot_for_test(&project)
                .into_iter()
                .filter(|(path, _, _)| !path.starts_with(".oleafly"))
                .collect::<Vec<_>>(),
            before
                .into_iter()
                .filter(|(path, _, _)| !path.starts_with(".oleafly"))
                .collect::<Vec<_>>()
        );
        assert_eq!(std::fs::read_dir(&out).unwrap().count(), 0);
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn real_pandoc_uses_relative_media_paths_when_no_temp_folder_is_safe_for_tex() {
        let Some(run) = RealPandocRun::new() else {
            return;
        };
        let project = run.project("Paper #2 {50% & more}");
        let system = run.base.join("tmp #1");
        std::fs::create_dir_all(&system).unwrap();
        let out = run.base.join("linked 50%").join("build");
        let created = oleafly_core::EngineScratch::create(&oleafly_core::EngineScratchBases {
            system: system.clone(),
            owned: Some(run.base.join("data {x}").join("engine-tmp")),
            build: out.clone(),
        })
        .unwrap();
        let scratch = created.path().to_path_buf();
        assert!(scratch.to_string_lossy().ends_with('~'));
        let before = crate::linked_registry::folder_snapshot_for_test(&project);
        let spec = run.spec(&out, &project, created);
        run.run(&spec, &[]).await;
        run.assert_everything_resolved(&scratch);
        assert!(Path::new(run.recorded("outdir-argument").trim_end()).is_relative());
        assert!(!run.recorded("tex").contains(&*run.base.to_string_lossy()));
        assert!(out
            .join(format!("{}.pdf", crate::paths::ENTRY_STEM))
            .is_file());
        assert_eq!(
            crate::linked_registry::folder_snapshot_for_test(&project),
            before
        );
        assert_eq!(std::fs::read_dir(&system).unwrap().count(), 0);
        drop(spec);
        assert!(!scratch.exists());
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn real_pandoc_with_a_cygwin_uname_on_the_path_writes_nothing_into_the_project() {
        let Some(run) = RealPandocRun::new() else {
            return;
        };
        let project = run.project("Cygwin notes");
        let cygwin = run.base.join("cygwin").join("bin");
        std::fs::create_dir_all(&cygwin).unwrap();
        RealPandocRun::script(&cygwin.join("uname"), "#!/bin/sh\necho Cygwin\n");
        let out = run.base.join("data").join("build");
        let before = crate::linked_registry::folder_snapshot_for_test(&project);
        let created = run.scratch(&out);
        let scratch = created.path().canonicalize().unwrap();
        let spec = run.spec(&out, &project, created);
        let path = format!(
            "{}:{}",
            cygwin.display(),
            std::env::var("PATH").unwrap_or_default()
        );
        run.run(&spec, &[("PATH", path)]).await;
        run.assert_everything_resolved(&scratch);
        assert!(Path::new(run.recorded("outdir-argument").trim_end()).is_relative());
        assert_eq!(
            crate::linked_registry::folder_snapshot_for_test(&project),
            before
        );
        drop(spec);
        assert!(!scratch.exists());
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn real_pandoc_reads_a_yaml_bibliography_and_style_through_the_resource_path() {
        let Some(run) = RealPandocRun::new() else {
            return;
        };
        let project = run.base.join("folders").join("Yaml {refs}");
        RealPandocRun::file(
            &project,
            "main.md",
            b"---\nbibliography: refs/refs.json\ncsl: styles/marker.csl\n---\n\nAs @lamport shows.\n",
        );
        RealPandocRun::file(
            &project,
            "refs/refs.json",
            br#"[{"id": "lamport", "type": "book", "title": "LamportTitle", "issued": {"date-parts": [[1986]]}}]"#,
        );
        RealPandocRun::file(&project, "styles/marker.csl", MARKER_CSL.as_bytes());
        let out = run.base.join("data").join("build");
        let before = crate::linked_registry::folder_snapshot_for_test(&project);
        let created = run.scratch(&out);
        let scratch = created.path().canonicalize().unwrap();
        let spec = run.spec(&out, &project, created);
        assert!(!spec
            .args
            .iter()
            .any(|arg| arg.starts_with("--bibliography=")));
        run.run(&spec, &[]).await;
        let tex = run.recorded("tex");
        assert!(tex.contains("CSLMARK"), "{tex}");
        assert!(tex.contains("LamportTitle"), "{tex}");
        assert_eq!(Path::new(run.recorded("cwd").trim_end()), scratch);
        assert_eq!(
            crate::linked_registry::folder_snapshot_for_test(&project),
            before
        );
        drop(spec);
        assert!(!scratch.exists());
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn real_pandoc_finds_project_files_when_the_folder_name_has_a_path_separator_or_a_variable(
    ) {
        let Some(run) = RealPandocRun::new() else {
            return;
        };
        for (index, name) in [
            "Thesis 2024:25",
            "Notes ${HOME} x",
            "Draft 1:2 ${HOME} $x ${.} ${USERDATA} ${OLEAFLY_UNDEFINED}",
        ]
        .into_iter()
        .enumerate()
        {
            let project = run.project(name);
            let out = if index == 0 {
                run.base.join("data").join("build")
            } else {
                project.join(".oleafly").join("build")
            };
            let outside_the_build =
                |snapshot: Vec<(String, u64, Option<std::time::SystemTime>)>| {
                    snapshot
                        .into_iter()
                        .filter(|(path, _, _)| !path.starts_with(".oleafly"))
                        .collect::<Vec<_>>()
                };
            std::fs::create_dir_all(&out).unwrap();
            let before = crate::linked_registry::folder_snapshot_for_test(&project);
            let created = run.scratch(&out);
            let scratch = created.path().canonicalize().unwrap();
            let spec = run.spec(&out, &project, created);
            let defaults = defaults_argument(&spec);
            assert_eq!(
                defaults.as_deref().and_then(Path::parent),
                name.contains(':').then_some(scratch.as_path()),
                "{name}"
            );
            assert_eq!(
                resource_variable(&spec),
                (name.contains(':') && name.contains("${"))
                    .then(|| project.to_string_lossy())
                    .as_deref(),
                "{name}"
            );
            run.run(&spec, &[]).await;
            run.assert_everything_resolved(&scratch);
            let pdf = out.join(format!("{}.pdf", crate::paths::ENTRY_STEM));
            assert!(pdf.is_file(), "{name}");
            std::fs::remove_file(pdf).unwrap();
            drop(spec);
            assert!(!scratch.exists(), "{name}");
            assert_eq!(
                outside_the_build(crate::linked_registry::folder_snapshot_for_test(&project)),
                outside_the_build(before),
                "{name}"
            );
        }
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn real_pandoc_never_runs_a_program_from_the_project_folder() {
        let Some(run) = RealPandocRun::new() else {
            return;
        };
        let project = run.project("Tools inside");
        let tools = project.join("tools");
        std::fs::create_dir_all(&tools).unwrap();
        let ran = run.base.join("project-uname-ran");
        RealPandocRun::script(
            &tools.join("uname"),
            &format!("#!/bin/sh\ntouch '{}'\necho Cygwin\n", ran.display()),
        );
        let pandoc = tools.join("pandoc");
        std::os::unix::fs::symlink(&run.pandoc, &pandoc).unwrap();
        let out = run.base.join("data").join("build");
        let before = crate::linked_registry::folder_snapshot_for_test(&project);
        let created = run.scratch(&out);
        let scratch = created.path().canonicalize().unwrap();
        let mut spec = run.spec(&out, &project, created);
        spec.executable = EngineExecutable::ExternalPath(pandoc);
        run.run(&spec, &[]).await;
        run.assert_everything_resolved(&scratch);
        assert!(!ran.exists());
        assert_eq!(
            crate::linked_registry::folder_snapshot_for_test(&project),
            before
        );
        drop(spec);
        assert!(!scratch.exists());
    }

    #[test]
    fn markdown_diagnostics_are_generic_and_non_speculative() {
        let errors = MARKDOWN_ENGINE
            .parse_errors("warning: missing title\npandoc: PDF creation failed\nordinary output\n");
        assert_eq!(errors.len(), 2);
        assert_eq!(errors[0].kind, "warning");
        assert_eq!(errors[1].kind, "error");
        assert_eq!(errors[1].line, None);
    }

    #[test]
    fn markdown_fontconfig_fallback_is_a_warning_but_pdf_errors_remain_errors() {
        let diagnostics = MARKDOWN_ENGINE.parse_errors(
            "Fontconfig error: Cannot load default config file: No such file: (null)\n\
             Error producing PDF.\npandoc: PDF creation failed\n",
        );
        assert_eq!(diagnostics.len(), 3);
        assert_eq!(diagnostics[0].kind, "warning");
        assert_eq!(diagnostics[1].kind, "error");
        assert_eq!(diagnostics[2].kind, "error");
    }

    #[test]
    fn packaged_tectonic_candidates_cover_tauri_and_cargo_layouts() {
        let candidates = tectonic_sidecar_candidates(
            Some(Path::new(
                "/Applications/Oleafly.app/Contents/MacOS/oleafly",
            )),
            Path::new("/src/src-tauri"),
            "tectonic",
        );
        let first = usize::from(cfg!(target_os = "linux"));
        assert_eq!(
            candidates[first],
            PathBuf::from("/Applications/Oleafly.app/Contents/MacOS/tectonic")
        );
        assert_eq!(
            candidates[first + 1],
            PathBuf::from("/src/src-tauri/target/debug/tectonic")
        );
        assert_eq!(
            candidates[first + 2],
            PathBuf::from("/src/src-tauri/target/release/tectonic")
        );
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn linux_packages_are_searched_before_the_folder_beside_the_app() {
        let candidates = tectonic_sidecar_candidates(
            Some(Path::new("/usr/bin/oleafly-desktop")),
            Path::new("/src/src-tauri"),
            "tectonic",
        );
        assert_eq!(
            candidates[0],
            PathBuf::from("/usr/libexec/oleafly/tectonic")
        );
        assert_eq!(candidates[1], PathBuf::from("/usr/bin/tectonic"));
    }

    #[test]
    fn compile_output_fingerprint_matches_the_frontend_contract() {
        assert_eq!(
            fingerprint_compile_output(&[0, 1, 2, 255]),
            "pdf-v1:4:6fab6075b28eda84"
        );
    }

    #[test]
    fn latexmk_engine_resolves_with_latex_capabilities() {
        let engine = engine_for("latexmk", "main.tex").unwrap();
        assert_eq!(engine.id(), DocumentEngineId::Latexmk);
        let capabilities = engine.capabilities();
        assert!(capabilities.produces_pdf);
        assert!(capabilities.supports_synctex);
        assert!(capabilities.supports_isolated_compile);
        assert_eq!(capabilities.formatting_profile, FormattingProfile::Latex);
        assert_eq!(
            capabilities.compiler_prerequisite,
            Some(CompilerPrerequisite::SystemTex)
        );
        let descriptor = descriptor_for("latexmk", "main.tex").unwrap();
        assert_eq!(descriptor.label, "LaTeX (latexmk)");
        assert_eq!(descriptor.source_format, "latex");
    }

    #[test]
    fn latexmk_flavor_honors_magic_program_comment() {
        assert_eq!(
            detect_latexmk_flavor("% !TeX program = xelatex\n\\documentclass{article}"),
            LatexmkFlavor::Xelatex
        );
        assert_eq!(
            detect_latexmk_flavor("%!TEX program = lualatex\n"),
            LatexmkFlavor::Lualatex
        );
        assert_eq!(
            detect_latexmk_flavor("% !TeX program = pdflatex\n\\usepackage{fontspec}"),
            LatexmkFlavor::Pdflatex
        );
    }

    #[test]
    fn latexmk_flavor_upgrades_for_unicode_font_packages() {
        assert_eq!(
            detect_latexmk_flavor("\\usepackage{fontspec}"),
            LatexmkFlavor::Xelatex
        );
        assert_eq!(
            detect_latexmk_flavor("\\setmainfont{Georgia}"),
            LatexmkFlavor::Xelatex
        );
        // Overleaf's default: plain projects compile with pdfLaTeX.
        assert_eq!(
            detect_latexmk_flavor("\\documentclass{article}"),
            LatexmkFlavor::Pdflatex
        );
    }

    #[test]
    fn latexmk_binary_change_forces_one_rebuild() {
        let dir = std::env::temp_dir().join(format!("oleafly-lmk-marker-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let tinytex = Path::new("/tiny/bin/latexmk");
        let mactex = Path::new("/mactex/bin/latexmk");
        assert!(latexmk_binary_changed(&dir, tinytex));
        assert!(latexmk_binary_changed(&dir, tinytex));
        record_latexmk_binary(&dir, tinytex);
        assert!(!latexmk_binary_changed(&dir, tinytex));
        assert!(latexmk_binary_changed(&dir, mactex));
        assert!(latexmk_binary_changed(&dir, mactex));
        record_latexmk_binary(&dir, mactex);
        assert!(!latexmk_binary_changed(&dir, mactex));
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn pinned_flavor_beats_every_source_heuristic() {
        let source = "% !TeX program = xelatex\n\\usepackage{fontspec}";
        assert_eq!(
            resolve_latexmk_flavor(Some(LatexmkFlavor::Pdflatex), source),
            LatexmkFlavor::Pdflatex
        );
        assert_eq!(
            resolve_latexmk_flavor(Some(LatexmkFlavor::Lualatex), source),
            LatexmkFlavor::Lualatex
        );
        assert_eq!(resolve_latexmk_flavor(None, source), LatexmkFlavor::Xelatex);
    }

    #[test]
    fn latexmk_flavor_parse_accepts_only_known_compilers() {
        assert_eq!(
            LatexmkFlavor::parse("pdflatex"),
            Some(LatexmkFlavor::Pdflatex)
        );
        assert_eq!(
            LatexmkFlavor::parse(" xelatex "),
            Some(LatexmkFlavor::Xelatex)
        );
        assert_eq!(
            LatexmkFlavor::parse("lualatex"),
            Some(LatexmkFlavor::Lualatex)
        );
        assert_eq!(
            LatexmkFlavor::parse("uplatex"),
            Some(LatexmkFlavor::Uplatex)
        );
        assert_eq!(LatexmkFlavor::parse("platex"), Some(LatexmkFlavor::Platex));
        assert_eq!(LatexmkFlavor::parse("tectonic"), None);
        assert_eq!(LatexmkFlavor::parse(""), None);
    }

    #[test]
    fn latexmk_flavor_detects_japanese_and_chinese_documents() {
        assert_eq!(
            detect_latexmk_flavor("\\documentclass[uplatex,dvipdfmx]{jsarticle}"),
            LatexmkFlavor::Uplatex
        );
        assert_eq!(
            detect_latexmk_flavor("\\documentclass{jsbook}"),
            LatexmkFlavor::Platex
        );
        assert_eq!(
            detect_latexmk_flavor("\\documentclass{ltjsarticle}"),
            LatexmkFlavor::Lualatex
        );
        assert_eq!(
            detect_latexmk_flavor("\\documentclass[UTF8]{ctexart}"),
            LatexmkFlavor::Xelatex
        );
        assert_eq!(
            detect_latexmk_flavor("% !TeX program = platex\n\\documentclass[uplatex]{jsarticle}"),
            LatexmkFlavor::Platex
        );
        assert_eq!(
            detect_latexmk_flavor("% !TeX program = uplatex\n\\documentclass{article}"),
            LatexmkFlavor::Uplatex
        );
    }

    #[test]
    fn japanese_compilers_run_latexmk_through_dvipdfmx() {
        let args = latexmk_args(
            Path::new(".oleafly/build"),
            Path::new("main.tex"),
            crate::paths::ENTRY_STEM,
            LatexmkFlavor::Uplatex,
            CompileOptions::default(),
        )
        .unwrap();
        assert_eq!(&args[..3], ["-norc", "-shell-restricted", "-pdfdvi"]);
        assert!(args.contains(&"-latex=uplatex %O %S".to_string()));
        assert!(args.contains(&"$dvipdf = q/dvipdfmx %O -o %D %S/".to_string()));
        assert!(args.contains(&"-synctex=1".to_string()));
        assert!(!args.contains(&"-pdf".to_string()));
        assert_eq!(args.last().unwrap(), "./main.tex");
    }

    #[test]
    fn a_missing_japanese_compiler_is_reported_before_latexmk_runs() {
        let dir = tempfile::tempdir().unwrap();
        let latexmk = dir.path().join(crate::tex_distro::exe("latexmk"));
        std::fs::write(&latexmk, b"tool").unwrap();
        assert!(require_dvi_toolchain(LatexmkFlavor::Xelatex, &latexmk).is_ok());
        let missing = require_dvi_toolchain(LatexmkFlavor::Uplatex, &latexmk).unwrap_err();
        assert!(missing.contains("\"code\":\"tex.japanese_compiler_missing"));
        assert!(missing.contains("upLaTeX"));
        for tool in ["uplatex", "dvipdfmx"] {
            std::fs::write(dir.path().join(crate::tex_distro::exe(tool)), b"tool").unwrap();
        }
        assert!(require_dvi_toolchain(LatexmkFlavor::Uplatex, &latexmk).is_ok());
        assert!(require_dvi_toolchain(LatexmkFlavor::Platex, &latexmk)
            .unwrap_err()
            .contains("pLaTeX"));
    }

    #[test]
    fn latexmk_args_carry_engine_outdir_jobname_and_error_mode() {
        let args = latexmk_args(
            Path::new(".oleafly/build"),
            Path::new("main.tex"),
            crate::paths::ENTRY_STEM,
            LatexmkFlavor::Pdflatex,
            CompileOptions::default(),
        )
        .unwrap();
        assert!(args.contains(&"-pdf".to_string()));
        assert!(args.contains(&"-outdir=./.oleafly/build".to_string()));
        assert!(args.contains(&format!("-jobname={}", crate::paths::ENTRY_STEM)));
        assert!(args.contains(&"-norc".to_string()));
        assert!(args.contains(&"-shell-restricted".to_string()));
        assert!(!args.contains(&"-shell-escape".to_string()));
        assert!(!args.contains(&"-latexoption=--nosocket".to_string()));
        assert!(args.contains(&"-f".to_string()));
        assert_eq!(args.last().unwrap(), "./main.tex");

        let halt = latexmk_args(
            Path::new(".oleafly/build"),
            Path::new("main.tex"),
            "_figure",
            LatexmkFlavor::Xelatex,
            CompileOptions {
                halt_on_error: true,
                ..Default::default()
            },
        )
        .unwrap();
        assert!(halt.contains(&"-xelatex".to_string()));
        assert!(halt.contains(&"-halt-on-error".to_string()));
        assert!(!halt.contains(&"-f".to_string()));
        assert!(!halt.contains(&"-shell-escape".to_string()));

        let trusted = latexmk_args(
            Path::new(".oleafly/build"),
            Path::new("main.tex"),
            crate::paths::ENTRY_STEM,
            LatexmkFlavor::Lualatex,
            CompileOptions {
                allow_shell_escape: true,
                ..Default::default()
            },
        )
        .unwrap();
        assert!(trusted.contains(&"-shell-escape".to_string()));
        assert!(!trusted.contains(&"-no-shell-escape".to_string()));
        assert!(!trusted.contains(&"-shell-restricted".to_string()));
        assert!(!trusted.contains(&"-latexoption=--nosocket".to_string()));
        assert!(trusted.contains(&"-norc".to_string()));

        let untrusted_lualatex = latexmk_args(
            Path::new(".oleafly/build"),
            Path::new("main.tex"),
            crate::paths::ENTRY_STEM,
            LatexmkFlavor::Lualatex,
            CompileOptions::default(),
        )
        .unwrap();
        assert!(untrusted_lualatex.contains(&"-shell-restricted".to_string()));
        assert!(untrusted_lualatex.contains(&"-latexoption=--nosocket".to_string()));
    }

    #[test]
    fn shell_escape_denials_name_the_banner_button() {
        let catalog: serde_json::Value =
            serde_json::from_str(include_str!("../../src/i18n/locales/en/errors.json")).unwrap();
        let shell: serde_json::Value =
            serde_json::from_str(include_str!("../../src/i18n/locales/en/shell.json")).unwrap();
        let setting = shell["shellCommands"]["allow"].as_str().unwrap();
        for (denied, code, key) in [
            (
                DeniedShellEscape::Minted,
                "tex.shell_escape_denied_minted",
                "shell_escape_denied_minted",
            ),
            (
                DeniedShellEscape::PythonTex,
                "tex.shell_escape_denied_pythontex",
                "shell_escape_denied_pythontex",
            ),
            (
                DeniedShellEscape::Command,
                "tex.shell_escape_denied_command",
                "shell_escape_denied_command",
            ),
        ] {
            let error = shell_escape_denial(denied);
            assert_eq!(error.code.as_deref(), Some(code));
            assert_eq!(error.kind, "error");
            let english = catalog["tex"][key]
                .as_str()
                .unwrap()
                .replace("{{setting}}", setting);
            assert_eq!(error.explanation.as_deref(), Some(english.as_str()));
            assert!(english.contains(setting), "{english}");
        }
    }

    #[test]
    fn shell_escape_denials_come_from_refusals_not_from_allowed_helpers() {
        for allowed in [
            "runsystem(repstopdf --outfile=./logo-eps-converted-to.pdf ./logo.eps)...executed.\n! undefined control sequence.\nl.42 \\oops",
            "runsystem(repstopdf disabled.eps)...executed.",
            "runsystem(repstopdf a.eps)...executed safely (allowed).",
        ] {
            assert_eq!(
                denied_shell_escape_feature("\\documentclass{article}", allowed),
                None,
                "{allowed}"
            );
        }

        for denial in [
            "runsystem(rm -rf /tmp/x)...disabled (restricted).",
            "runsystem(bibtex --very-long-argument-list that-wraps-the-log-line-at-seventy-nine-c\nolumns)...disabled\n(restricted).",
            "runsystem(mv executed.tex safe.tex)...disabled (restricted).",
            "package epstopdf warning: shell escape feature is not enabled.",
            "package svg error: you must invoke latex with the -shell-escape flag.",
        ] {
            assert_eq!(
                denied_shell_escape_feature("\\documentclass{article}", denial),
                Some(DeniedShellEscape::Command),
                "{denial}"
            );
        }

        let mixed =
            "runsystem(repstopdf a.eps)...executed.\nrunsystem(inkscape)...disabled (restricted).";
        assert!(log_refused_a_shell_command(mixed));
        assert!(!log_refused_a_shell_command(
            "restricted \\write18 enabled.\nrunsystem(repstopdf a.eps)...executed."
        ));
    }

    #[test]
    fn shell_command_status_is_read_after_the_command_text_never_inside_it() {
        assert_eq!(
            runsystem_statuses("runsystem(repstopdf disabled.eps)...executed."),
            ["executed"]
        );
        assert_eq!(
            runsystem_statuses("runsystem(mv executed.tex safe.tex)...disabled (restricted)."),
            ["disabled (restricted)"]
        );
        assert_eq!(
            runsystem_statuses("runsystem(inkscape logo.svg)...disa\nbled (restricted)."),
            ["disabled (restricted)"]
        );
        assert_eq!(
            runsystem_statuses(
                "runsystem(a.eps)...executed.\nrunsystem(b.svg)...disabled.\nrunsystem(c.py)...failed."
            ),
            ["executed", "disabled", "failed"]
        );
        assert!(runsystem_statuses("runsystem(epstopdf a.eps)").is_empty());
    }

    #[cfg(unix)]
    #[test]
    fn engine_spawns_drop_the_appimage_launcher_paths_for_host_programs() {
        let image = crate::proc::SimulatedAppImage::start();
        let working = tempfile::tempdir().unwrap();
        let environment = EngineEnvironment::inherited(None)
            .with_variable("QUARTO_PYTHON", "/usr/bin/python3".to_owned());
        let applied =
            |program: &Path| -> std::collections::HashMap<String, Option<std::ffi::OsString>> {
                supervised_command(
                    program,
                    &["render".to_owned()],
                    working.path(),
                    std::ffi::OsStr::new("/usr/bin"),
                    None,
                    &environment,
                )
                .as_std()
                .get_envs()
                .map(|(name, value)| {
                    (
                        name.to_string_lossy().into_owned(),
                        value.map(std::ffi::OsStr::to_os_string),
                    )
                })
                .collect()
            };
        let quarto = applied(Path::new("/opt/quarto/bin/quarto"));
        assert_eq!(quarto["PYTHONHOME"], None);
        assert_eq!(quarto["PYTHONPATH"], None);
        assert_eq!(quarto["LD_LIBRARY_PATH"], None);
        assert_eq!(quarto["QUARTO_PYTHON"], Some("/usr/bin/python3".into()));
        assert_eq!(quarto["shell_escape"], Some("f".into()));
        let bundled = applied(&image.root.join("usr/bin/tectonic"));
        assert!(!bundled.contains_key("PYTHONHOME"));
        assert!(!bundled.contains_key("LD_LIBRARY_PATH"));
    }

    #[test]
    fn latexmk_keeps_restricted_shell_escape_off_miktex_and_out_of_trusted_runs() {
        assert_eq!(shell_escape_arg(false, "texlive"), "-shell-restricted");
        assert_eq!(
            shell_escape_arg(false, "oleafly-tinytex"),
            "-shell-restricted"
        );
        assert_eq!(shell_escape_arg(false, "miktex"), "-no-shell-escape");
        for kind in ["texlive", "miktex", "other"] {
            assert_eq!(shell_escape_arg(true, kind), "-shell-escape");
        }
        let miktex = latexmk_args_from(
            "./.oleafly/build".into(),
            "./main.tex".into(),
            crate::paths::ENTRY_STEM,
            LatexmkFlavor::Pdflatex,
            CompileOptions::default(),
            "miktex",
        );
        assert!(miktex.contains(&"-no-shell-escape".to_string()));
        assert!(!miktex.contains(&"-shell-restricted".to_string()));

        let restricted = latexmk_args(
            Path::new(".oleafly/build"),
            Path::new("main.tex"),
            crate::paths::ENTRY_STEM,
            LatexmkFlavor::Pdflatex,
            CompileOptions::default(),
        )
        .unwrap();
        assert!(restricted.contains(&"-shell-restricted".to_string()));
        assert!(!restricted.contains(&"-no-shell-escape".to_string()));
    }

    fn supervised_latexmk_environment(
        args: &[String],
    ) -> std::collections::HashMap<String, Option<std::ffi::OsString>> {
        let working = tempfile::tempdir().unwrap();
        supervised_command(
            Path::new("/tex/bin/latexmk"),
            args,
            working.path(),
            std::ffi::OsStr::new("/usr/bin"),
            None,
            &EngineEnvironment::default(),
        )
        .as_std()
        .get_envs()
        .map(|(name, value)| {
            (
                name.to_string_lossy().into_owned(),
                value.map(std::ffi::OsStr::to_os_string),
            )
        })
        .collect()
    }

    #[test]
    fn tex_may_read_the_build_folder_and_keeps_its_write_and_shell_limits() {
        for flavor in ["-pdf", "-xelatex", "-lualatex"] {
            let restricted =
                supervised_latexmk_environment(&["-shell-restricted".into(), flavor.into()]);
            assert_eq!(restricted["openin_any"], None, "{flavor}");
            assert_eq!(restricted["openout_any"], Some("p".into()), "{flavor}");
            assert_eq!(restricted["shell_escape"], Some("f".into()), "{flavor}");
            assert_eq!(
                restricted[MIKTEX_SHELL_COMMANDS_VARIABLE],
                Some(restricted_miktex_shell_commands().into()),
                "{flavor}"
            );
        }
    }

    #[test]
    fn a_trusted_run_keeps_the_distribution_shell_settings() {
        let trusted = supervised_latexmk_environment(&["-shell-escape".into(), "-pdf".into()]);
        assert_eq!(trusted["openin_any"], None);
        assert_eq!(trusted["openout_any"], Some("p".into()));
        assert!(!trusted.contains_key("shell_escape"));
        assert!(!trusted.contains_key(MIKTEX_SHELL_COMMANDS_VARIABLE));
    }

    fn latexmk_artifacts(dir: &Path, stem: &str) -> EngineArtifacts {
        EngineArtifacts {
            output_dir: dir.to_path_buf(),
            pdf: Some(dir.join(format!("{stem}.pdf"))),
            log: Some(dir.join(format!("{stem}.log"))),
            synctex: Some(dir.join(format!("{stem}.synctex.gz"))),
            html: None,
        }
    }

    fn latexmk_spec(dir: &Path, stem: &str) -> EngineCompileSpec {
        EngineCompileSpec {
            executable: EngineExecutable::ExternalPath(dir.join("latexmk")),
            args: Vec::new(),
            input: EngineInput::Direct(dir.join("main.tex")),
            artifacts: latexmk_artifacts(dir, stem),
            working_dir: dir.to_path_buf(),
            environment: EngineEnvironment::default(),
        }
    }

    #[test]
    fn a_failed_latexmk_run_forgets_its_database_and_keeps_the_binary_marker() {
        let dir = tempfile::tempdir().unwrap();
        let spec = latexmk_spec(dir.path(), crate::paths::ENTRY_STEM);
        let database = dir.path().join("_oleafly_entry.fdb_latexmk");
        let aux = dir.path().join("_oleafly_entry.aux");
        std::fs::write(&database, b"state").unwrap();
        std::fs::write(&aux, b"aux").unwrap();
        settle_latexmk_run(&spec, false, true);
        assert!(database.is_file());
        assert!(!latexmk_binary_changed(
            dir.path(),
            &dir.path().join("latexmk")
        ));

        settle_latexmk_run(&spec, false, false);
        assert!(!database.exists());
        assert!(aux.is_file());
        assert!(!latexmk_binary_changed(
            dir.path(),
            &dir.path().join("latexmk")
        ));
    }

    #[test]
    fn a_stopped_latexmk_run_keeps_its_database() {
        let dir = tempfile::tempdir().unwrap();
        let spec = latexmk_spec(dir.path(), crate::paths::ENTRY_STEM);
        let database = dir.path().join("_oleafly_entry.fdb_latexmk");
        std::fs::write(&database, b"state").unwrap();
        settle_latexmk_run(&spec, true, false);
        assert_eq!(std::fs::read(&database).unwrap(), b"state");
        assert!(latexmk_binary_changed(
            dir.path(),
            &dir.path().join("latexmk")
        ));
    }

    #[test]
    fn a_pythontex_failure_is_coded_with_the_catalog_english() {
        let catalog: serde_json::Value =
            serde_json::from_str(include_str!("../../src/i18n/locales/en/errors.json")).unwrap();
        let mut errors = Vec::new();
        append_pythontex_error(&mut errors, false, Some("PythonTeX helper failed.".into()));
        assert_eq!(errors.len(), 1);
        assert_eq!(
            errors[0].code.as_deref(),
            Some("tex.explain.pythontex_failed")
        );
        assert_eq!(
            errors[0].explanation.as_deref(),
            catalog["tex"]["explain"]["pythontex_failed"].as_str()
        );
    }

    #[tokio::test]
    async fn a_helper_that_cannot_start_leaves_plain_text_in_the_log_and_card() {
        let root = tempfile::tempdir().unwrap();
        let missing = root.path().join("no-such-helper");
        let error = run_supervised_external(&missing, &[], root.path())
            .await
            .unwrap_err();
        assert_eq!(
            crate::app_error::code(&error).as_deref(),
            Some("compile.tool_blocked")
        );
        let (notes, failure) =
            append_failure(String::new(), step_failure("run PythonTeX helper", &error)).unwrap();
        let mut errors = Vec::new();
        append_pythontex_error(&mut errors, false, failure);
        let mut biber_notes = String::new();
        append_biber_failure(&mut biber_notes, &error, &missing);
        for text in [
            notes.as_str(),
            errors[0].message.as_str(),
            biber_notes.as_str(),
        ] {
            assert!(!text.contains(crate::app_error::PREFIX), "{text}");
            assert!(text.contains("no-such-helper couldn't start."), "{text}");
        }
    }

    #[test]
    fn a_stopped_compile_adds_no_pythontex_error() {
        let mut errors = Vec::new();
        append_pythontex_error(&mut errors, true, Some("PythonTeX helper failed.".into()));
        assert!(errors.is_empty());
    }

    #[test]
    fn the_built_in_engine_does_not_say_to_install_a_missing_package() {
        let log = "! LaTeX Error: File `x.sty' not found.\nl.1 \\usepackage{x}\n";
        assert_eq!(
            LatexEngine.parse_errors(log)[0].code.as_deref(),
            Some("tex.explain.file_not_found_tectonic")
        );
        assert_eq!(
            LatexmkEngine.parse_errors(log)[0].code.as_deref(),
            Some("tex.explain.file_not_found")
        );
    }

    #[test]
    fn a_lone_brace_in_the_folder_name_is_named_when_bibtex_cannot_open_the_bibliography() {
        let failed = "I couldn't open database file refs.bib\n";
        let home = tempfile::tempdir().unwrap();
        let lone = home.path().join("notes{draft");
        let paired = home.path().join("{draft}");
        std::fs::create_dir_all(&lone).unwrap();
        std::fs::create_dir_all(&paired).unwrap();
        let spec = latexmk_spec(&lone, crate::paths::ENTRY_STEM);
        let bibtex_log = lone.join("_oleafly_entry.blg");
        assert!(bibtex_folder_brace_error(&spec, Some(12)).is_none());

        std::fs::write(&bibtex_log, failed).unwrap();
        let error = bibtex_folder_brace_error(&spec, Some(12)).unwrap();
        assert_eq!(error.code.as_deref(), Some("tex.bibtex_folder_brace"));
        assert_eq!(error.kind, "error");
        assert!(bibtex_folder_brace_error(&spec, Some(0)).is_none());

        std::fs::write(&bibtex_log, "fine").unwrap();
        assert!(bibtex_folder_brace_error(&spec, Some(12)).is_none());

        let spec = latexmk_spec(&paired, crate::paths::ENTRY_STEM);
        std::fs::write(paired.join("_oleafly_entry.blg"), failed).unwrap();
        assert!(bibtex_folder_brace_error(&spec, Some(12)).is_none());
    }

    #[test]
    fn the_bibtex_folder_error_reads_the_blg_beside_an_isolated_log() {
        let home = tempfile::tempdir().unwrap();
        let lone = home.path().join("notes{draft");
        std::fs::create_dir_all(&lone).unwrap();
        std::fs::write(
            lone.join("figure.v2.blg"),
            "I couldn't open database file refs.bib\n",
        )
        .unwrap();
        let spec = latexmk_spec(&lone, "figure.v2");
        assert!(bibtex_folder_brace_error(&spec, None).is_some());
    }

    #[test]
    fn a_failed_isolated_latexmk_run_forgets_its_own_database() {
        let dir = tempfile::tempdir().unwrap();
        let isolated = dir.path().join("figure.v2.fdb_latexmk");
        let main = dir.path().join("_oleafly_entry.fdb_latexmk");
        std::fs::write(&isolated, b"state").unwrap();
        std::fs::write(&main, b"state").unwrap();
        settle_latexmk_run(&latexmk_spec(dir.path(), "figure.v2"), false, false);
        assert!(!isolated.exists());
        assert!(main.is_file());
    }

    #[test]
    fn latexmk_recompiles_start_from_the_tex_pass_on_every_route() {
        let dir = tempfile::tempdir().unwrap();
        let artifacts = latexmk_artifacts(dir.path(), "figure.v2");
        let xdv = dir.path().join("figure.v2.xdv");
        let dvi = dir.path().join("figure.v2.dvi");
        let aux = dir.path().join("figure.v2.aux");
        for path in [&xdv, &dvi, &aux] {
            std::fs::write(path, b"stale").unwrap();
        }
        clear_latexmk_page_files(DocumentEngineId::Latex, &artifacts);
        assert!(xdv.is_file() && dvi.is_file());
        clear_latexmk_page_files(DocumentEngineId::Latexmk, &artifacts);
        assert!(!xdv.exists() && !dvi.exists());
        assert!(aux.is_file());
        clear_latexmk_page_files(DocumentEngineId::Latexmk, &artifacts);
    }

    #[test]
    fn latexmk_leading_dash_entry_is_forced_to_a_positional_path() {
        let hostile = Path::new("-pdflatex=sh evil.tex");
        let args = latexmk_args(
            Path::new(".oleafly/build"),
            hostile,
            crate::paths::ENTRY_STEM,
            LatexmkFlavor::Pdflatex,
            CompileOptions::default(),
        )
        .unwrap();
        let entry = args.last().unwrap();
        assert!(!entry.starts_with('-'));
        assert_eq!(entry, "./-pdflatex=sh evil.tex");
        assert!(latexmk_args(
            Path::new(".oleafly/build"),
            Path::new("../outside.tex"),
            crate::paths::ENTRY_STEM,
            LatexmkFlavor::Pdflatex,
            CompileOptions::default(),
        )
        .is_err());
        for hostile in [
            "paper`touch marker`.tex",
            "paper\"; touch marker; \".tex",
            "paper|touch marker.tex",
            "paper';touch marker;'.tex",
        ] {
            assert!(latexmk_args(
                Path::new(".oleafly/build"),
                Path::new(hostile),
                crate::paths::ENTRY_STEM,
                LatexmkFlavor::Pdflatex,
                CompileOptions::default(),
            )
            .is_err());
        }
    }

    #[test]
    fn latexmk_takes_an_apostrophe_in_a_main_document() {
        let args = latexmk_args(
            Path::new(".oleafly/build"),
            Path::new("Bob's thesis/l'article.tex"),
            crate::paths::ENTRY_STEM,
            LatexmkFlavor::Pdflatex,
            CompileOptions::default(),
        )
        .unwrap();
        assert_eq!(args.last().unwrap(), "./Bob's thesis/l'article.tex");
    }

    #[test]
    fn a_refused_latexmk_path_is_coded_and_names_the_file() {
        let refusal = latexmk_relative_path_arg(Path::new("notes|draft.tex")).unwrap_err();
        assert_eq!(
            crate::app_error::code(&refusal).as_deref(),
            Some("tex.latexmk_path_characters")
        );
        assert!(refusal.contains("notes|draft.tex"), "{refusal}");
        let escape = latexmk_relative_path_arg(Path::new("../outside.tex")).unwrap_err();
        assert_eq!(crate::app_error::code(&escape), None);
    }

    #[test]
    fn a_main_document_tex_would_misread_is_coded_and_named_on_both_tex_engines() {
        let refusal = validate_latex_main_document("notes & drafts.tex").unwrap_err();
        assert_eq!(
            crate::app_error::code(&refusal).as_deref(),
            Some("tex.main_document_characters")
        );
        assert!(refusal.contains("notes & drafts.tex"), "{refusal}");
        let dir = tempfile::tempdir().unwrap();
        let tectonic = LATEX_ENGINE
            .compile_spec(
                dir.path(),
                dir.path(),
                CompileTarget::Main {
                    main_document: "notes & drafts.tex",
                },
                CompileOptions::default(),
            )
            .unwrap_err();
        assert_eq!(
            crate::app_error::code(&tectonic).as_deref(),
            Some("tex.main_document_characters")
        );
    }

    #[test]
    fn a_non_ascii_owned_build_folder_reaches_latexmk_by_its_short_name() {
        let build = Path::new("C:/Users/Jörg/.oleafly/linked/p/build");
        let short = |path: &Path| {
            (path == build).then(|| PathBuf::from("C:/Users/JRG~1/.oleafly/linked/p/build"))
        };
        assert_eq!(
            owned_path_text(build, true, &short).as_deref(),
            Some("C:/Users/JRG~1/.oleafly/linked/p/build")
        );
        assert_eq!(
            owned_path_text(&build.join("_figure.tex"), true, &short).as_deref(),
            Some("C:/Users/JRG~1/.oleafly/linked/p/build/_figure.tex")
        );
    }

    #[test]
    fn a_non_ascii_owned_build_folder_without_a_short_name_is_refused() {
        let build = Path::new("C:/Users/张三/.oleafly/linked/p/build");
        assert_eq!(owned_path_text(build, true, &|_| None), None);
        let unchanged = |path: &Path| Some(path.to_path_buf());
        assert_eq!(owned_path_text(build, true, &unchanged), None);
    }

    #[test]
    fn an_ascii_owned_build_folder_keeps_its_own_name() {
        let build = Path::new("C:/Users/ada/.oleafly/linked/p/build");
        let never = |_: &Path| -> Option<PathBuf> { panic!("no short name needed") };
        assert_eq!(
            owned_path_text(build, true, &never).as_deref(),
            Some("C:/Users/ada/.oleafly/linked/p/build")
        );
        let unix = Path::new("/home/jörg/.oleafly/linked/p/build");
        assert_eq!(
            owned_path_text(unix, false, &never).as_deref(),
            Some("/home/jörg/.oleafly/linked/p/build")
        );
    }

    #[cfg(unix)]
    #[test]
    fn latexmk_writes_an_owned_external_build_directory_by_absolute_path() {
        let project = Path::new("/Users/ada/Bob's Thèse v2");
        let out =
            Path::new("/Users/ada/.oleafly/linked/linked-0123456789abcdef0123456789abcdef/build");
        let owned = Some(out);
        assert_eq!(
            latexmk_path_arg(project, &project.join("main.tex"), owned, "input").unwrap(),
            "./main.tex"
        );
        assert_eq!(
            latexmk_path_arg(project, out, owned, "output").unwrap(),
            out.to_str().unwrap()
        );
        let figure = out.join("_figure.tex");
        assert_eq!(
            latexmk_path_arg(project, &figure, owned, "input").unwrap(),
            figure.to_str().unwrap()
        );
        assert_eq!(
            latexmk_path_arg(project, out, None, "output").unwrap_err(),
            "latexmk output must stay inside the project directory"
        );
        assert_eq!(
            latexmk_path_arg(project, Path::new("/elsewhere/build"), owned, "output").unwrap_err(),
            "latexmk output must stay inside the project directory"
        );
        assert_eq!(
            latexmk_path_arg(project, Path::new("/elsewhere/main.tex"), owned, "input")
                .unwrap_err(),
            "latexmk input must stay inside the project directory"
        );
        let args = latexmk_args_from(
            out.to_str().unwrap().to_owned(),
            "./main.tex".into(),
            crate::paths::ENTRY_STEM,
            LatexmkFlavor::Pdflatex,
            CompileOptions {
                external_build: true,
                ..Default::default()
            },
            "texlive",
        );
        assert!(args.contains(&format!("-outdir={}", out.display())));
        assert_eq!(args.last().unwrap(), "./main.tex");
    }

    fn latexmk_test_home() -> PathBuf {
        if cfg!(windows) {
            PathBuf::from(r"C:\Users\ada")
        } else {
            PathBuf::from("/Users/ada")
        }
    }

    #[test]
    fn latexmk_library_builds_keep_relative_paths_and_the_inherited_environment() {
        let project = latexmk_test_home()
            .join("Oleafly")
            .join("projects")
            .join("paper");
        let options = CompileOptions {
            source_date_epoch: Some(1_700_000_000),
            ..Default::default()
        };
        let build = project.join(".oleafly").join("build");
        let (args, environment) = latexmk_invocation(
            &project,
            &build,
            &project.join("main.tex"),
            crate::paths::ENTRY_STEM,
            LatexmkFlavor::Pdflatex,
            options.clone(),
            "texlive",
        )
        .unwrap();
        assert_eq!(
            args,
            latexmk_args(
                Path::new(".oleafly/build"),
                Path::new("main.tex"),
                crate::paths::ENTRY_STEM,
                LatexmkFlavor::Pdflatex,
                options.clone(),
            )
            .unwrap()
        );
        assert!(args.contains(&"-outdir=./.oleafly/build".to_string()));
        assert_eq!(args.last().unwrap(), "./main.tex");
        assert_eq!(
            environment.variables,
            vec![("SOURCE_DATE_EPOCH".to_string(), "1700000000".to_string())]
        );

        let figures = project.join(".oleafly").join("figbuild");
        let (args, environment) = latexmk_invocation(
            &project,
            &figures,
            &figures.join("_figure.tex"),
            "_figure",
            LatexmkFlavor::Xelatex,
            CompileOptions::default(),
            "texlive",
        )
        .unwrap();
        assert!(args.contains(&"-outdir=./.oleafly/figbuild".to_string()));
        assert_eq!(args.last().unwrap(), "./.oleafly/figbuild/_figure.tex");
        assert!(environment.variables.is_empty());
    }

    #[test]
    fn latexmk_linked_builds_name_the_owned_directory_in_outdir_and_texmfoutput() {
        let home = latexmk_test_home();
        let project = home.join("Bob's Thèse v2");
        let build = home
            .join(".oleafly")
            .join("linked")
            .join("linked-0123456789abcdef0123456789abcdef")
            .join("build");
        let absolute = build.to_str().unwrap().replace('\\', "/");
        let options = CompileOptions {
            external_build: true,
            source_date_epoch: Some(1_700_000_000),
            ..Default::default()
        };
        let (args, environment) = latexmk_invocation(
            &project,
            &build,
            &project.join("main.tex"),
            crate::paths::ENTRY_STEM,
            LatexmkFlavor::Pdflatex,
            options.clone(),
            "texlive",
        )
        .unwrap();
        assert!(args.contains(&format!("-outdir={absolute}")));
        assert_eq!(args.last().unwrap(), "./main.tex");
        assert_eq!(
            environment.variables,
            vec![
                ("SOURCE_DATE_EPOCH".to_string(), "1700000000".to_string()),
                ("TEXMFOUTPUT".to_string(), absolute.clone()),
            ]
        );

        let scratch = home.join("tmp").join("oleafly-figure-abc123");
        let scratch_text = scratch.to_str().unwrap().replace('\\', "/");
        let (args, environment) = latexmk_invocation(
            &project,
            &scratch,
            &scratch.join("_figure.tex"),
            "_figure",
            LatexmkFlavor::Xelatex,
            CompileOptions {
                external_build: true,
                ..Default::default()
            },
            "texlive",
        )
        .unwrap();
        assert!(args.contains(&format!("-outdir={scratch_text}")));
        assert_eq!(args.last().unwrap(), &format!("{scratch_text}/_figure.tex"));
        assert_eq!(
            environment.variables,
            vec![("TEXMFOUTPUT".to_string(), scratch_text)]
        );

        assert_eq!(
            latexmk_invocation(
                &project,
                &build,
                &project.join("main.tex"),
                crate::paths::ENTRY_STEM,
                LatexmkFlavor::Pdflatex,
                CompileOptions::default(),
                "texlive",
            )
            .unwrap_err(),
            "latexmk output must stay inside the project directory"
        );
        if cfg!(windows) {
            let share = PathBuf::from(r"\\server\share\thesis");
            let refusal = latexmk_invocation(
                &share,
                &build,
                &share.join("main.tex"),
                crate::paths::ENTRY_STEM,
                LatexmkFlavor::Pdflatex,
                options.clone(),
                "texlive",
            )
            .unwrap_err();
            assert!(
                refusal.contains("\"code\":\"tex.latexmk_network_folder\""),
                "{refusal}"
            );
        }
    }

    #[cfg(unix)]
    #[test]
    fn bibtex_finds_the_project_when_its_folder_name_has_a_colon() {
        let home = tempfile::tempdir().unwrap();
        let project = home.path().join("Thesis 2024:25");
        let paper = project.join("paper");
        std::fs::create_dir_all(&paper).unwrap();
        let first_entries = |spec: &EngineCompileSpec| -> Vec<(String, String)> {
            spec.environment
                .variables()
                .iter()
                .filter(|(name, _)| oleafly_core::BIBTEX_SEARCH_VARIABLES.contains(&name.as_str()))
                .map(|(name, value)| (name.clone(), value.split(':').next().unwrap().into()))
                .collect()
        };
        let expected = |entry: &str| {
            vec![
                ("BIBINPUTS".to_string(), entry.to_string()),
                ("BSTINPUTS".to_string(), entry.to_string()),
            ]
        };

        let in_tree = project.join(".oleafly").join("build");
        let (args, environment) = latexmk_invocation(
            &project,
            &in_tree,
            &project.join("main.tex"),
            crate::paths::ENTRY_STEM,
            LatexmkFlavor::Pdflatex,
            CompileOptions::default(),
            "texlive",
        )
        .unwrap();
        let library = with_bibtex_search_path(EngineCompileSpec {
            executable: EngineExecutable::ExternalPath(PathBuf::from("latexmk")),
            args,
            input: EngineInput::Direct(project.join("main.tex")),
            artifacts: LATEX_ENGINE.artifacts(
                &in_tree,
                CompileTarget::Main {
                    main_document: "main.tex",
                },
            ),
            working_dir: project.clone(),
            environment,
        });
        assert_eq!(first_entries(&library), expected("../.."));
        assert!(std::fs::symlink_metadata(in_tree.join(BIBTEX_PROJECT_LINK)).is_err());

        let build = home.path().join("linked").join("build");
        let linked =
            with_bibtex_search_path(latexmk_spec_for_test(&project, &build, "paper/main.tex"));
        let link = build.join(BIBTEX_PROJECT_LINK);
        assert_eq!(first_entries(&linked), expected(BIBTEX_PROJECT_LINK));
        assert_eq!(std::fs::read_link(&link).unwrap(), project);

        let nested =
            place_in_compile_directory(DocumentEngineId::Latexmk, linked, &project, &paper)
                .unwrap();
        assert_eq!(nested.working_dir, paper);
        assert_eq!(first_entries(&nested), expected(BIBTEX_PROJECT_LINK));
        assert_eq!(std::fs::read_link(&link).unwrap(), paper);

        let plain = latexmk_spec_for_test(&home.path().join("Thesis 2024-25"), &build, "main.tex");
        assert_eq!(with_bibtex_search_path(plain.clone()), plain);
    }

    fn latexmk_spec_for_test(
        project: &Path,
        build: &Path,
        main_document: &str,
    ) -> EngineCompileSpec {
        let input = project.join(main_document);
        let (args, environment) = latexmk_invocation(
            project,
            build,
            &input,
            crate::paths::ENTRY_STEM,
            LatexmkFlavor::Pdflatex,
            CompileOptions {
                external_build: true,
                ..Default::default()
            },
            "texlive",
        )
        .unwrap();
        EngineCompileSpec {
            executable: EngineExecutable::ExternalPath(PathBuf::from("latexmk")),
            args,
            input: EngineInput::Direct(input),
            artifacts: LATEX_ENGINE.artifacts(build, CompileTarget::Main { main_document }),
            working_dir: project.to_owned(),
            environment,
        }
    }

    #[test]
    fn a_nested_compile_directory_becomes_the_latexmk_working_directory() {
        let home = latexmk_test_home();
        let project = home.join("repo");
        let paper = project.join("paper");
        let build = home
            .join(".oleafly")
            .join("linked")
            .join("linked-0123456789abcdef0123456789abcdef")
            .join("build");
        let absolute = build.to_str().unwrap().replace('\\', "/");
        let spec = latexmk_spec_for_test(&project, &build, "paper/main.tex");
        assert_eq!(spec.args.last().unwrap(), "./paper/main.tex");
        let placed =
            place_in_compile_directory(DocumentEngineId::Latexmk, spec.clone(), &project, &paper)
                .unwrap();
        assert_eq!(placed.working_dir, paper);
        assert_eq!(placed.args.last().unwrap(), "./main.tex");
        assert!(placed.args.contains(&format!("-outdir={absolute}")));
        assert_eq!(placed.args.len(), spec.args.len());
        assert_eq!(placed.environment, spec.environment);

        let outside = latexmk_spec_for_test(&project, &build, "top.tex");
        let kept = place_in_compile_directory(
            DocumentEngineId::Latexmk,
            outside.clone(),
            &project,
            &paper,
        )
        .unwrap();
        assert_eq!(
            (kept.working_dir, kept.args),
            (outside.working_dir, outside.args)
        );

        let in_tree = project.join(".oleafly").join("build");
        let (args, environment) = latexmk_invocation(
            &project,
            &in_tree,
            &paper.join("main.tex"),
            crate::paths::ENTRY_STEM,
            LatexmkFlavor::Pdflatex,
            CompileOptions::default(),
            "texlive",
        )
        .unwrap();
        let library = EngineCompileSpec {
            args,
            environment,
            artifacts: LATEX_ENGINE.artifacts(
                &in_tree,
                CompileTarget::Main {
                    main_document: "paper/main.tex",
                },
            ),
            ..spec
        };
        let placed = place_in_compile_directory(
            DocumentEngineId::Latexmk,
            library.clone(),
            &project,
            &paper,
        )
        .unwrap();
        let absolute_in_tree = in_tree.to_str().unwrap().replace('\\', "/");
        assert_eq!(placed.working_dir, paper);
        assert_eq!(placed.args.last().unwrap(), "./main.tex");
        assert!(placed.args.contains(&format!("-outdir={absolute_in_tree}")));
        assert_eq!(placed.args.len(), library.args.len());
        let variable = |name: &str| {
            placed
                .environment
                .variables()
                .iter()
                .find(|(key, _)| key == name)
                .map(|(_, value)| value.clone())
        };
        assert_eq!(variable("TEXMFOUTPUT"), Some(absolute_in_tree));
        let root = project.to_str().unwrap().replace('\\', "/");
        for name in ["TEXINPUTS", "BIBINPUTS"] {
            assert!(variable(name).unwrap().contains(&root), "{name}");
        }
    }

    #[test]
    fn windows_keeps_a_non_ascii_in_tree_build_on_the_project_root() {
        assert!(in_tree_absolute_path_reaches_latexmk(
            "C:/Users/ana/thesis/.oleafly/build",
            true
        ));
        assert!(!in_tree_absolute_path_reaches_latexmk(
            "C:/Users/李华/thesis/.oleafly/build",
            true
        ));
        assert!(in_tree_absolute_path_reaches_latexmk(
            "/home/李华/thesis/.oleafly/build",
            false
        ));
    }

    #[cfg(unix)]
    #[test]
    fn a_library_path_latexmk_cannot_take_keeps_the_project_root_as_working_directory() {
        let project = latexmk_test_home().join("co$t");
        let paper = project.join("paper");
        let in_tree = project.join(".oleafly").join("build");
        let input = paper.join("main.tex");
        let (args, environment) = latexmk_invocation(
            &project,
            &in_tree,
            &input,
            crate::paths::ENTRY_STEM,
            LatexmkFlavor::Pdflatex,
            CompileOptions::default(),
            "texlive",
        )
        .unwrap();
        let library = EngineCompileSpec {
            executable: EngineExecutable::ExternalPath(PathBuf::from("latexmk")),
            args,
            input: EngineInput::Direct(input),
            artifacts: LATEX_ENGINE.artifacts(
                &in_tree,
                CompileTarget::Main {
                    main_document: "paper/main.tex",
                },
            ),
            working_dir: project.clone(),
            environment,
        };
        let kept = place_in_compile_directory(
            DocumentEngineId::Latexmk,
            library.clone(),
            &project,
            &paper,
        )
        .unwrap();
        assert_eq!(kept, library);
    }

    #[test]
    fn a_kept_bib_copy_goes_before_a_tectonic_compile_and_the_bbl_stays() {
        let directory = tempfile::tempdir().unwrap();
        let artifacts = EngineArtifacts {
            output_dir: directory.path().to_path_buf(),
            pdf: Some(directory.path().join("output.pdf")),
            log: None,
            synctex: None,
            html: None,
        };
        let stem = crate::paths::ENTRY_STEM;
        let control = directory.path().join(format!("{stem}.bcf"));
        let copy = directory.path().join("refs.bib");
        let list = directory.path().join(format!("{stem}.bbl"));
        for file in [&control, &copy, &list] {
            std::fs::write(file, b"x").unwrap();
        }
        clear_stale_compile_artifacts(&artifacts, None);
        assert!(copy.exists());
        clear_stale_compile_artifacts(&artifacts, Some(&control));
        assert!(!copy.exists());
        assert!(list.exists());
    }

    #[test]
    fn latexmk_builds_get_a_build_folder_for_each_included_folder() {
        let _env_guard = crate::paths::data_dir_env_lock();
        let data = tempfile::tempdir().unwrap();
        std::env::set_var("OLEAFLY_DATA_DIR", data.path());
        let project = tempfile::tempdir().unwrap();
        for index in 1..=6 {
            let folder = project.path().join(format!("Ch{index}"));
            std::fs::create_dir(&folder).unwrap();
            std::fs::write(folder.join(format!("ch{index}.tex")), "Text.").unwrap();
        }
        let out = tempfile::tempdir().unwrap();
        create_include_output_dirs(project.path(), out.path());
        for index in 1..=6 {
            assert!(out.path().join(format!("Ch{index}")).is_dir(), "Ch{index}");
        }

        // A build folder that can't hold folders leaves the build to latexmk,
        // as before, and the app log says why.
        let blocked = out.path().join("blocked");
        std::fs::write(&blocked, "").unwrap();
        create_include_output_dirs(project.path(), &blocked);
        let log = std::fs::read_to_string(data.path().join("app.log")).unwrap();
        assert!(
            log.contains("Could not create build folders for included files"),
            "{log}"
        );
    }

    #[test]
    fn a_shipped_bbl_reaches_both_engines_only_when_no_bib_file_exists() {
        let project = tempfile::tempdir().unwrap();
        let out = tempfile::tempdir().unwrap();
        let source = "\\documentclass{article}\n\\begin{document}\n\\cite{k}\n\\bibliography{refs}\n\\end{document}\n";
        std::fs::write(project.path().join("main.tex"), source).unwrap();
        std::fs::write(project.path().join("main.bbl"), "shipped").unwrap();
        let entry_text = || {
            let spec = LATEX_ENGINE
                .compile_spec(
                    out.path(),
                    project.path(),
                    CompileTarget::Main {
                        main_document: "main.tex",
                    },
                    CompileOptions::default(),
                )
                .unwrap();
            match spec.input {
                EngineInput::Generated { content, .. } => content,
                EngineInput::Direct(_) => unreachable!("Tectonic compiles a generated entry"),
            }
        };
        let seeded = out.path().join(format!("{}.bbl", crate::paths::ENTRY_STEM));

        assert!(entry_text().contains("\\input{\\detokenize{main.bbl}}"));
        seed_project_bibliography(project.path(), "main.tex", out.path());
        assert_eq!(std::fs::read_to_string(&seeded).unwrap(), "shipped");

        std::fs::remove_file(&seeded).unwrap();
        std::fs::write(project.path().join("refs.bib"), "").unwrap();
        assert!(!entry_text().contains("main.bbl"));
        seed_project_bibliography(project.path(), "main.tex", out.path());
        assert!(!seeded.exists());
    }

    #[test]
    fn a_failed_latexmk_build_names_the_bibliography_path_bibtex_cannot_follow() {
        let out = tempfile::tempdir().unwrap();
        let codes = |log: &str, auto: bool| -> Vec<String> {
            latexmk_failure_causes(log, out.path(), auto)
                .into_iter()
                .filter_map(|cause| cause.code)
                .collect()
        };
        assert!(codes("", true).is_empty());
        std::fs::write(
            out.path().join(format!("{}.blg", crate::paths::ENTRY_STEM)),
            "I couldn't open database file ../refs.bib\n",
        )
        .unwrap();
        assert_eq!(codes("", true), ["tex.bibliography_above_main"]);
        let refused =
            "! Fatal Package fontspec Error: The fontspec package requires either XeTeX or\n";
        assert_eq!(
            codes(refused, true),
            ["tex.bibliography_above_main", "tex.needs_unicode_engine"]
        );
        assert_eq!(codes(refused, false), ["tex.bibliography_above_main"]);
    }

    #[test]
    fn auto_latexmk_reads_the_preamble_file_a_main_file_inputs() {
        let project = tempfile::tempdir().unwrap();
        let main = project.path().join("main.tex");
        std::fs::write(
            &main,
            "\\documentclass{article}\n\\input{preamble}\n\\begin{document}\nx\n\\end{document}\n",
        )
        .unwrap();
        std::fs::write(
            project.path().join("preamble.tex"),
            "\\usepackage{fontspec}\n",
        )
        .unwrap();
        assert_eq!(
            oleafly_core::project_tex_flavor(project.path(), &main),
            LatexmkFlavor::Xelatex
        );
    }

    #[cfg(unix)]
    fn write_real_tex_fixture(project: &Path, biber: bool) {
        std::fs::create_dir_all(project.join("sections")).unwrap();
        std::fs::create_dir_all(project.join("chapters")).unwrap();
        std::fs::write(
            project.join("refs.bib"),
            "@book{knuth,\n  author = {Donald E. Knuth},\n  title = {The TeXbook},\n  publisher = {Addison-Wesley},\n  year = {1984}\n}\n",
        )
        .unwrap();
        std::fs::write(
            project.join("sections").join("intro.tex"),
            "Intro text.\\index{section}\n",
        )
        .unwrap();
        std::fs::write(
            project.join("chapters").join("one.tex"),
            "Chapter one \\cite{knuth}.\\index{chapter}\n",
        )
        .unwrap();
        let main = if biber {
            "\\documentclass{article}\n\\usepackage[backend=biber]{biblatex}\n\\addbibresource{refs.bib}\n\\usepackage{imakeidx}\n\\makeindex\n\\begin{document}\nHello \\cite{knuth}\\index{hello}.\n\\input{sections/intro}\n\\include{chapters/one}\n\\printbibliography\n\\printindex\n\\end{document}\n"
        } else {
            "\\documentclass{article}\n\\usepackage{makeidx}\n\\makeindex\n\\begin{document}\nHello \\cite{knuth}\\index{hello}.\n\\input{sections/intro}\n\\include{chapters/one}\n\\bibliographystyle{plain}\n\\bibliography{refs}\n\\printindex\n\\end{document}\n"
        };
        std::fs::write(project.join("main.tex"), main).unwrap();
    }

    #[cfg(unix)]
    async fn real_latexmk_compile(
        project: &Path,
        out: &Path,
        flavor: LatexmkFlavor,
        extra_variables: &[(&str, String)],
    ) -> (EngineCompileSpec, String, Option<i32>) {
        let mut spec = LATEXMK_ENGINE
            .compile_spec(
                out,
                project,
                CompileTarget::Main {
                    main_document: "main.tex",
                },
                CompileOptions {
                    latex_flavor: Some(flavor),
                    ..Default::default()
                },
            )
            .unwrap();
        for (name, value) in extra_variables {
            spec.environment =
                std::mem::take(&mut spec.environment).with_variable(name, value.clone());
        }
        clear_latexmk_page_files(DocumentEngineId::Latexmk, &spec.artifacts);
        assert!(clear_stale_artifacts(&spec.artifacts).is_empty());
        let EngineExecutable::ExternalPath(latexmk) = spec.executable.clone() else {
            unreachable!()
        };
        let (log, code) = run_supervised_process_with_environment(
            &latexmk,
            &spec.args,
            &spec.working_dir,
            None,
            COMPILE_TIMEOUT,
            None,
            &spec.environment,
        )
        .await
        .unwrap();
        settle_latexmk_run(&spec, false, code == Some(0));
        (spec, log, code)
    }

    #[cfg(unix)]
    fn real_tex_flavors() -> Vec<(LatexmkFlavor, &'static str)> {
        let mut flavors = vec![
            (LatexmkFlavor::Pdflatex, "\\documentclass{article}\n"),
            (
                LatexmkFlavor::Xelatex,
                "\\documentclass{article}\n\\usepackage{fontspec}\n",
            ),
            (LatexmkFlavor::Lualatex, "\\documentclass{article}\n"),
        ];
        if crate::tex_distro::find_tex_tool("uplatex").is_some() {
            flavors.push((
                LatexmkFlavor::Uplatex,
                "\\documentclass[uplatex]{jsarticle}\n",
            ));
        }
        if crate::tex_distro::find_tex_tool("platex").is_some() {
            flavors.push((LatexmkFlavor::Platex, "\\documentclass{jsarticle}\n"));
        }
        flavors
    }

    #[cfg(unix)]
    #[ignore = "runs the installed TeX distribution"]
    #[tokio::test]
    async fn real_latexmk_recompiles_keep_the_log_and_recover_after_a_failure() {
        if crate::tex_distro::find_tex_tool("latexmk").is_none() {
            return;
        }
        for (flavor, preamble) in real_tex_flavors() {
            let scratch = tempfile::Builder::new()
                .prefix("oleafly-real-tex-")
                .tempdir()
                .unwrap();
            let project = scratch.path().canonicalize().unwrap().join("project");
            let out = project.join(".oleafly/build");
            let packages = scratch.path().canonicalize().unwrap().join("packages");
            std::fs::create_dir_all(&out).unwrap();
            std::fs::create_dir_all(&packages).unwrap();
            let main = project.join("main.tex");
            let body = "\\begin{document}\nHello\n\\end{document}\n";
            std::fs::write(&main, format!("{preamble}{body}")).unwrap();
            let case = format!("{flavor:?}");
            for run in ["first", "unchanged"] {
                let (spec, log, code) = real_latexmk_compile(&project, &out, flavor, &[]).await;
                assert_eq!(code, Some(0), "{case} {run}\n{log}");
                assert!(spec.artifacts.pdf.unwrap().is_file(), "{case} {run}");
                assert!(spec.artifacts.log.unwrap().is_file(), "{case} {run}");
                assert!(spec.artifacts.synctex.unwrap().is_file(), "{case} {run}");
            }

            std::fs::write(
                &main,
                format!("{preamble}\\usepackage{{oleaflymissing}}\n{body}"),
            )
            .unwrap();
            for run in ["broken", "broken again"] {
                let (spec, log, code) = real_latexmk_compile(&project, &out, flavor, &[]).await;
                assert_ne!(code, Some(0), "{case} {run}\n{log}");
                assert!(!log.contains("previous invocation"), "{case} {run}\n{log}");
                let tex_log = std::fs::read_to_string(spec.artifacts.log.unwrap()).unwrap();
                assert!(tex_log.contains("oleaflymissing.sty"), "{case} {run}");
            }

            std::fs::write(
                packages.join("oleaflymissing.sty"),
                "\\ProvidesPackage{oleaflymissing}\n",
            )
            .unwrap();
            let search = [("TEXINPUTS", format!("{}:", packages.display()))];
            let (spec, log, code) = real_latexmk_compile(&project, &out, flavor, &search).await;
            assert_eq!(code, Some(0), "{case} installed\n{log}");
            assert!(spec.artifacts.pdf.unwrap().is_file(), "{case} installed");
            assert!(spec.artifacts.log.unwrap().is_file(), "{case} installed");
        }
    }

    #[cfg(unix)]
    #[ignore = "runs the installed TeX distribution"]
    #[tokio::test]
    async fn real_minted_reads_its_cache_under_the_dotted_build_folder() {
        let Some(pdftotext) = crate::tex_distro::find_tex_tool("pdftotext").or_else(|| {
            ["/opt/homebrew/bin/pdftotext", "/usr/bin/pdftotext"]
                .into_iter()
                .map(PathBuf::from)
                .find(|path| path.is_file())
        }) else {
            return;
        };
        if crate::tex_distro::find_tex_tool("latexmk").is_none()
            || crate::tex_distro::find_tex_tool("latexminted").is_none()
        {
            return;
        }
        let scratch = tempfile::Builder::new()
            .prefix("oleafly-real-tex-")
            .tempdir()
            .unwrap();
        let project = scratch.path().canonicalize().unwrap().join("project");
        let out = project.join(".oleafly/build");
        std::fs::create_dir_all(&out).unwrap();
        std::fs::write(
            project.join("main.tex"),
            "\\documentclass{article}\n\\usepackage{minted}\n\\begin{document}\n\\begin{minted}{python}\nprint(\"oleafly\")\n\\end{minted}\n\\end{document}\n",
        )
        .unwrap();
        let (spec, log, code) =
            real_latexmk_compile(&project, &out, LatexmkFlavor::Pdflatex, &[]).await;
        assert_eq!(code, Some(0), "{log}");
        assert!(!log.contains("openin_any"), "{log}");
        let text = std::process::Command::new(pdftotext)
            .arg(spec.artifacts.pdf.unwrap())
            .arg("-")
            .output()
            .unwrap();
        let text = String::from_utf8_lossy(&text.stdout);
        assert!(text.contains("oleafly"), "{text}");
        assert!(!text.contains("<MINTED>"), "{text}");
    }

    #[cfg(unix)]
    #[ignore = "runs the installed TeX distribution"]
    #[tokio::test]
    async fn real_bibtex_finds_the_bibliography_in_a_folder_with_kpathsea_syntax() {
        if crate::tex_distro::find_tex_tool("latexmk").is_none() {
            return;
        }
        for folder in [
            "Thesis {draft}",
            "budget $HOME notes",
            "Smith, Jones",
            "a;b",
        ] {
            let scratch = tempfile::Builder::new()
                .prefix("oleafly-real-tex-")
                .tempdir()
                .unwrap();
            let project = scratch.path().canonicalize().unwrap().join(folder);
            let out = project.join(".oleafly/build");
            std::fs::create_dir_all(&out).unwrap();
            write_real_tex_fixture(&project, false);
            let (_, log, code) =
                real_latexmk_compile(&project, &out, LatexmkFlavor::Pdflatex, &[]).await;
            assert_eq!(code, Some(0), "{folder}\n{log}");
            assert!(
                std::fs::read_to_string(out.join("_oleafly_entry.bbl"))
                    .unwrap()
                    .contains("Knuth"),
                "{folder}"
            );
        }
    }

    #[cfg(unix)]
    #[ignore = "runs the installed TeX distribution"]
    #[tokio::test]
    async fn real_bibtex_failure_in_a_lone_brace_folder_is_named_after_a_long_preamble() {
        if crate::tex_distro::find_tex_tool("latexmk").is_none() {
            return;
        }
        let scratch = tempfile::Builder::new()
            .prefix("oleafly-real-tex-")
            .tempdir()
            .unwrap();
        let project = scratch.path().canonicalize().unwrap().join("open{b");
        let out = project.join(".oleafly/build");
        std::fs::create_dir_all(&out).unwrap();
        write_real_tex_fixture(&project, false);
        let main = project.join("main.tex");
        let source = std::fs::read_to_string(&main).unwrap().replace(
            "\\documentclass{article}\n",
            "\\documentclass{article}\n\\usepackage{amsmath,hyperref,tikz,pgfplots,siunitx,cleveref,listings}\n\\pgfplotsset{compat=1.18}\n",
        );
        std::fs::write(&main, source).unwrap();
        let (spec, log, code) =
            real_latexmk_compile(&project, &out, LatexmkFlavor::Pdflatex, &[]).await;
        assert_ne!(code, Some(0), "{log}");
        let combined = combined_compile_log(&spec, log, code, "", "");
        assert!(!combined.contains("I couldn't open database file"));
        let error = bibtex_folder_brace_error(&spec, code).unwrap();
        assert_eq!(error.code.as_deref(), Some("tex.bibtex_folder_brace"));
    }

    #[cfg(unix)]
    #[ignore = "runs the installed TeX distribution"]
    #[tokio::test]
    async fn real_stopped_latexmk_rebuild_keeps_the_earlier_database() {
        if crate::tex_distro::find_tex_tool("latexmk").is_none() {
            return;
        }
        let scratch = tempfile::Builder::new()
            .prefix("oleafly-real-tex-")
            .tempdir()
            .unwrap();
        let project = scratch.path().canonicalize().unwrap().join("project");
        let out = project.join(".oleafly/build");
        std::fs::create_dir_all(&out).unwrap();
        write_real_tex_fixture(&project, false);
        let main = project.join("main.tex");
        let source = std::fs::read_to_string(&main).unwrap();
        let (_, log, code) =
            real_latexmk_compile(&project, &out, LatexmkFlavor::Pdflatex, &[]).await;
        assert_eq!(code, Some(0), "{log}");
        let database = out.join("_oleafly_entry.fdb_latexmk");
        let finished = std::fs::read(&database).unwrap();

        std::fs::write(&main, source.replace("Hello", "Hello again")).unwrap();
        let spec = LATEXMK_ENGINE
            .compile_spec(
                &out,
                &project,
                CompileTarget::Main {
                    main_document: "main.tex",
                },
                CompileOptions {
                    latex_flavor: Some(LatexmkFlavor::Pdflatex),
                    ..Default::default()
                },
            )
            .unwrap();
        clear_latexmk_page_files(DocumentEngineId::Latexmk, &spec.artifacts);
        assert!(clear_stale_artifacts(&spec.artifacts).is_empty());
        let cancel = crate::state::CompileCancel::default();
        cancel.begin();
        let stopper = {
            let cancel = cancel.clone();
            let tex_log = spec.artifacts.log.clone().unwrap();
            tokio::spawn(async move {
                while !tex_log.exists() {
                    tokio::time::sleep(std::time::Duration::from_millis(5)).await;
                }
                terminate_process_tree(cancel.request().unwrap()).await;
            })
        };
        let EngineExecutable::ExternalPath(latexmk) = &spec.executable else {
            unreachable!()
        };
        let (_, code) = run_supervised_process_with_environment(
            latexmk,
            &spec.args,
            &spec.working_dir,
            None,
            COMPILE_TIMEOUT,
            Some(&cancel),
            &spec.environment,
        )
        .await
        .unwrap();
        stopper.await.unwrap();
        assert_ne!(code, Some(0));
        settle_latexmk_run(&spec, true, false);
        assert_eq!(std::fs::read(&database).unwrap(), finished);

        let (spec, log, code) =
            real_latexmk_compile(&project, &out, LatexmkFlavor::Pdflatex, &[]).await;
        assert_eq!(code, Some(0), "{log}");
        assert!(spec.artifacts.pdf.unwrap().is_file());
        assert!(log.contains("rule 'pdflatex'"), "{log}");
        assert!(!log.contains("rule 'bibtex"), "{log}");
        assert!(!log.contains("rule 'makeindex"), "{log}");
    }

    #[cfg(unix)]
    #[ignore = "runs the installed TeX distribution"]
    #[tokio::test]
    async fn real_latexmk_compiles_a_main_document_with_an_apostrophe() {
        if crate::tex_distro::find_tex_tool("latexmk").is_none() {
            return;
        }
        let scratch = tempfile::Builder::new()
            .prefix("oleafly-real-tex-")
            .tempdir()
            .unwrap();
        let project = scratch.path().canonicalize().unwrap().join("project");
        let out = project.join(".oleafly/build");
        std::fs::create_dir_all(&out).unwrap();
        write_real_tex_fixture(&project, false);
        std::fs::rename(project.join("main.tex"), project.join("l'article.tex")).unwrap();
        let spec = LATEXMK_ENGINE
            .compile_spec(
                &out,
                &project,
                CompileTarget::Main {
                    main_document: "l'article.tex",
                },
                CompileOptions {
                    latex_flavor: Some(LatexmkFlavor::Pdflatex),
                    ..Default::default()
                },
            )
            .unwrap();
        let EngineExecutable::ExternalPath(latexmk) = &spec.executable else {
            unreachable!()
        };
        let (log, code) = run_supervised_process_with_environment(
            latexmk,
            &spec.args,
            &spec.working_dir,
            None,
            COMPILE_TIMEOUT,
            None,
            &spec.environment,
        )
        .await
        .unwrap();
        assert_eq!(code, Some(0), "{log}");
        assert!(out.join("_oleafly_entry.pdf").is_file());
    }

    #[cfg(unix)]
    #[ignore = "runs the installed TeX distribution"]
    #[tokio::test]
    async fn real_latexmk_builds_a_nested_main_from_its_own_folder() {
        if crate::tex_distro::find_tex_tool("latexmk").is_none() {
            return;
        }
        let biber_works = crate::tex_distro::find_tex_tool("biber").is_some_and(|biber| {
            std::process::Command::new(biber)
                .arg("--version")
                .output()
                .is_ok_and(|output| output.status.success())
        });
        let scratch = tempfile::Builder::new()
            .prefix("oleafly-real-tex-")
            .tempdir()
            .unwrap();
        let base = scratch.path().canonicalize().unwrap();
        let project = base.join("folders").join("Bob's repo");
        let paper = project.join("paper");
        let out = base.join(".oleafly/linked/linked-0123456789abcdef0123456789abcdef/build");
        for (flavor, biber) in [
            (LatexmkFlavor::Pdflatex, false),
            (LatexmkFlavor::Xelatex, false),
            (LatexmkFlavor::Lualatex, false),
            (LatexmkFlavor::Pdflatex, true),
        ] {
            if biber && !biber_works {
                continue;
            }
            let _ = std::fs::remove_dir_all(&project);
            let _ = std::fs::remove_dir_all(&out);
            write_real_tex_fixture(&paper, biber);
            std::fs::create_dir_all(&out).unwrap();
            let before = crate::linked_registry::folder_snapshot_for_test(&project);
            let spec = LATEXMK_ENGINE
                .compile_spec(
                    &out,
                    &project,
                    CompileTarget::Main {
                        main_document: "paper/main.tex",
                    },
                    CompileOptions {
                        latex_flavor: Some(flavor),
                        external_build: true,
                        ..Default::default()
                    },
                )
                .unwrap();
            let spec =
                place_in_compile_directory(DocumentEngineId::Latexmk, spec, &project, &paper)
                    .unwrap();
            let EngineExecutable::ExternalPath(latexmk) = &spec.executable else {
                unreachable!()
            };
            let (log, code) = run_supervised_process_with_environment(
                latexmk,
                &spec.args,
                &spec.working_dir,
                None,
                COMPILE_TIMEOUT,
                None,
                &spec.environment,
            )
            .await
            .unwrap();
            let case = format!("{flavor:?} biber={biber}");
            assert_eq!(code, Some(0), "{case}\n{log}");
            assert!(out.join("_oleafly_entry.pdf").is_file(), "{case}");
            assert!(
                std::fs::read_to_string(out.join("_oleafly_entry.bbl"))
                    .unwrap()
                    .contains("Knuth"),
                "{case}"
            );
            assert!(out.join("chapters").join("one.aux").is_file(), "{case}");
            assert_eq!(
                crate::linked_registry::folder_snapshot_for_test(&project),
                before,
                "{case}"
            );
        }
    }

    #[cfg(unix)]
    #[ignore = "runs the installed TeX distribution"]
    #[tokio::test]
    async fn real_latexmk_builds_linked_folders_in_an_owned_external_directory() {
        if crate::tex_distro::find_tex_tool("latexmk").is_none() {
            return;
        }
        let biber_works = crate::tex_distro::find_tex_tool("biber").is_some_and(|biber| {
            std::process::Command::new(biber)
                .arg("--version")
                .output()
                .is_ok_and(|output| output.status.success())
        });
        let scratch = tempfile::Builder::new()
            .prefix("oleafly-real-tex-")
            .tempdir()
            .unwrap();
        let base = scratch.path().canonicalize().unwrap();
        let cases = [
            (
                "Bob's Thèse v2",
                ".oleafly/linked/linked-0123456789abcdef0123456789abcdef/build",
            ),
            (
                "論文 #1 50% ~draft & notes",
                "Home Dir/.oleafly/linked/linked-0123456789abcdef0123456789abcdef/build",
            ),
            (
                "thesis",
                "O'Brien Jürgen/.oleafly/linked/linked-0123456789abcdef0123456789abcdef/build",
            ),
            (
                "Smith, Jones {v2} $HOME",
                ".oleafly/linked/linked-0123456789abcdef0123456789abcdef/build",
            ),
        ];
        for (folder, build) in cases {
            for flavor in [
                LatexmkFlavor::Pdflatex,
                LatexmkFlavor::Xelatex,
                LatexmkFlavor::Lualatex,
            ] {
                for biber in [false, true] {
                    if biber && !biber_works {
                        continue;
                    }
                    let project = base.join("folders").join(folder);
                    let out = base.join(build);
                    let _ = std::fs::remove_dir_all(&project);
                    let _ = std::fs::remove_dir_all(&out);
                    write_real_tex_fixture(&project, biber);
                    std::fs::create_dir_all(&out).unwrap();
                    let before = crate::linked_registry::folder_snapshot_for_test(&project);
                    let spec = LATEXMK_ENGINE
                        .compile_spec(
                            &out,
                            &project,
                            CompileTarget::Main {
                                main_document: "main.tex",
                            },
                            CompileOptions {
                                latex_flavor: Some(flavor),
                                external_build: true,
                                ..Default::default()
                            },
                        )
                        .unwrap();
                    assert!(spec
                        .environment
                        .variables
                        .iter()
                        .any(|(name, value)| name == "TEXMFOUTPUT" && Path::new(value) == out));
                    let EngineExecutable::ExternalPath(latexmk) = &spec.executable else {
                        unreachable!()
                    };
                    let (log, code) = run_supervised_process_with_environment(
                        latexmk,
                        &spec.args,
                        &spec.working_dir,
                        None,
                        COMPILE_TIMEOUT,
                        None,
                        &spec.environment,
                    )
                    .await
                    .unwrap();
                    let case = format!("{folder} -> {build} {flavor:?} biber={biber}");
                    assert_eq!(code, Some(0), "{case}\n{log}");
                    assert!(out.join("_oleafly_entry.pdf").is_file(), "{case}");
                    assert!(
                        std::fs::read_to_string(out.join("_oleafly_entry.bbl"))
                            .unwrap()
                            .contains("Knuth"),
                        "{case}"
                    );
                    assert!(
                        std::fs::read_to_string(out.join("_oleafly_entry.ind"))
                            .unwrap()
                            .contains("hello"),
                        "{case}"
                    );
                    assert!(out.join("chapters").join("one.aux").is_file(), "{case}");
                    assert!(
                        !std::fs::read_to_string(out.join("_oleafly_entry.log"))
                            .unwrap()
                            .contains("undefined"),
                        "{case}"
                    );
                    assert_eq!(
                        crate::linked_registry::folder_snapshot_for_test(&project),
                        before,
                        "{case}"
                    );
                }
            }
        }
    }

    #[cfg(unix)]
    #[ignore = "runs the installed TeX distribution"]
    #[tokio::test]
    async fn real_latexmk_compiles_a_linked_figure_from_a_private_scratch_folder() {
        if crate::tex_distro::find_tex_tool("latexmk").is_none() {
            return;
        }
        let folders = tempfile::Builder::new()
            .prefix("oleafly-real-tex-")
            .tempdir()
            .unwrap();
        let project = folders
            .path()
            .canonicalize()
            .unwrap()
            .join("Bob's Thèse v2");
        write_real_tex_fixture(&project, false);
        let before = crate::linked_registry::folder_snapshot_for_test(&project);
        let scratch = tempfile::Builder::new()
            .prefix("oleafly-figure-")
            .tempdir_in(std::env::temp_dir().canonicalize().unwrap())
            .unwrap();
        let source = scratch.path().join("_figure.tex");
        std::fs::write(
            &source,
            "\\documentclass{standalone}\n\\begin{document}\nFigure \\input{sections/intro}\n\\end{document}\n",
        )
        .unwrap();
        let spec = LATEXMK_ENGINE
            .compile_spec(
                scratch.path(),
                &project,
                CompileTarget::Isolated {
                    source_path: &source,
                    output_stem: "_figure",
                },
                CompileOptions {
                    external_build: true,
                    ..Default::default()
                },
            )
            .unwrap();
        let EngineExecutable::ExternalPath(latexmk) = &spec.executable else {
            unreachable!()
        };
        let (log, code) = run_supervised_process_with_environment(
            latexmk,
            &spec.args,
            &spec.working_dir,
            None,
            COMPILE_TIMEOUT,
            None,
            &spec.environment,
        )
        .await
        .unwrap();
        assert_eq!(code, Some(0), "{log}");
        assert!(scratch.path().join("_figure.pdf").is_file());
        assert_eq!(
            crate::linked_registry::folder_snapshot_for_test(&project),
            before
        );
    }

    #[test]
    fn a_tlmgr_beside_latexmk_lists_the_japanese_packages_to_install() {
        let dir = tempfile::tempdir().unwrap();
        let latexmk = dir.path().join(crate::tex_distro::exe("latexmk"));
        std::fs::write(&latexmk, b"tool").unwrap();
        let tlmgr = if cfg!(windows) { "tlmgr.bat" } else { "tlmgr" };
        std::fs::write(dir.path().join(tlmgr), b"#!/usr/bin/env perl\n").unwrap();
        std::fs::create_dir(dir.path().join("tlpkg")).unwrap();
        let missing = require_dvi_toolchain(LatexmkFlavor::Uplatex, &latexmk).unwrap_err();
        assert!(missing.contains("\"code\":\"tex.japanese_compiler_installable\""));
        assert!(missing.contains("collection-langjapanese,upmendex"));
        let missing = require_dvi_toolchain(LatexmkFlavor::Platex, &latexmk).unwrap_err();
        assert!(missing.contains("\"packages\":\"collection-langjapanese\""));
    }

    #[test]
    fn a_tree_without_room_for_binaries_keeps_the_japanese_install_command() {
        let dir = tempfile::tempdir().unwrap();
        let latexmk = dir.path().join(crate::tex_distro::exe("latexmk"));
        std::fs::write(&latexmk, b"tool").unwrap();
        let tlmgr = if cfg!(windows) { "tlmgr.bat" } else { "tlmgr" };
        std::fs::write(dir.path().join(tlmgr), b"#!/usr/bin/env perl\n").unwrap();
        let missing = require_dvi_toolchain(LatexmkFlavor::Uplatex, &latexmk).unwrap_err();
        assert!(
            missing.contains("tex.japanese_compiler_missing"),
            "{missing}"
        );
        assert!(
            !missing.contains("tex.japanese_compiler_installable"),
            "{missing}"
        );
    }

    #[cfg(unix)]
    #[test]
    fn a_read_only_tree_gets_no_japanese_install_button() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        let latexmk = dir.path().join("latexmk");
        std::fs::write(&latexmk, b"tool").unwrap();
        std::fs::write(dir.path().join("tlmgr"), b"#!/usr/bin/env perl\n").unwrap();
        let tlpkg = dir.path().join("tlpkg");
        std::fs::create_dir(&tlpkg).unwrap();
        std::fs::set_permissions(&tlpkg, std::fs::Permissions::from_mode(0o555)).unwrap();
        let writable_anyway = tempfile::tempfile_in(&tlpkg).is_ok();
        let missing = require_dvi_toolchain(LatexmkFlavor::Uplatex, &latexmk).unwrap_err();
        std::fs::set_permissions(&tlpkg, std::fs::Permissions::from_mode(0o755)).unwrap();
        assert_eq!(
            missing.contains("tex.japanese_compiler_installable"),
            writable_anyway,
            "{missing}"
        );
    }

    #[test]
    fn a_distro_tex_gets_no_japanese_install_offer() {
        let dir = tempfile::tempdir().unwrap();
        let latexmk = dir.path().join(crate::tex_distro::exe("latexmk"));
        std::fs::write(&latexmk, b"tool").unwrap();
        let tlmgr = dir
            .path()
            .join(if cfg!(windows) { "tlmgr.bat" } else { "tlmgr" });
        for script in [
            "destroy the Fedora TeXLive install",
            "running on Debian, switching to user mode",
        ] {
            std::fs::write(&tlmgr, script).unwrap();
            let missing = require_dvi_toolchain(LatexmkFlavor::Uplatex, &latexmk).unwrap_err();
            assert!(
                missing.contains("tex.japanese_compiler_missing"),
                "{missing}"
            );
            assert!(
                !missing.contains("collection-langjapanese,upmendex"),
                "{missing}"
            );
        }
    }

    #[test]
    fn latexmk_setup_codes_all_have_english_messages() {
        for code in [
            "tex.latexmk_missing",
            "tex.latexmk_not_in_distribution",
            "tex.latexmk_not_in_distribution_command",
            "tex.latexmk_needs_perl",
            "tex.compiler_missing",
            "tex.compiler_missing_command",
            "tex.biber_missing",
            "tex.biber_missing_command",
            "tex.tool_missing",
        ] {
            let error = crate::app_error::AppError::new(code)
                .param("binDir", "/usr/bin")
                .param("command", "sudo apt install latexmk")
                .param("compiler", "XeLaTeX")
                .param("tool", "makeindex");
            let english = crate::app_error::english(&error.to_string()).expect(code);
            assert!(!english.contains("{{"), "{code}: {english}");
        }
    }

    #[test]
    fn a_missing_compiler_refusal_is_coded() {
        let dir = tempfile::tempdir().unwrap();
        let latexmk = dir.path().join(crate::tex_distro::exe("latexmk"));
        std::fs::write(&latexmk, b"tool").unwrap();
        let blocker =
            crate::tex_distro::compiler_blocker(&latexmk, LatexmkFlavor::Xelatex, "XeLaTeX");
        assert_eq!(
            blocker.params.get("compiler").map(String::as_str),
            Some("XeLaTeX")
        );
        let error = String::from(crate::tex_distro::blocker_error(blocker));
        assert!(crate::app_error::code(&error)
            .is_some_and(|code| code.starts_with("tex.compiler_missing")));
    }

    #[test]
    fn a_failed_latexmk_names_the_program_the_shell_could_not_find() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join(crate::tex_distro::exe("pdflatex")), b"tool").unwrap();
        let path = std::env::join_paths([dir.path()]).unwrap();
        let stdout = "Running 'pdflatex  -recorder \"main.tex\"'\nRunning 'makeindex  main.idx'\n";
        assert_eq!(
            missing_latexmk_tool(stdout, &path, false).as_deref(),
            Some("makeindex")
        );
        assert_eq!(
            missing_latexmk_tool("Running 'pdflatex  main.tex'\n", &path, false),
            None
        );
        assert_eq!(missing_latexmk_tool("", &path, false), None);
    }

    #[test]
    fn a_stale_bibliography_with_no_biber_is_reported_without_a_running_line() {
        let dir = tempfile::tempdir().unwrap();
        let path = std::env::join_paths([dir.path()]).unwrap();
        assert_eq!(
            missing_latexmk_tool("", &path, true).as_deref(),
            Some("biber")
        );
        std::fs::write(dir.path().join(crate::tex_distro::exe("biber")), b"tool").unwrap();
        assert_eq!(missing_latexmk_tool("", &path, true), None);
    }

    #[test]
    fn a_setup_gap_lands_in_the_log_and_the_error_list() {
        let dir = tempfile::tempdir().unwrap();
        let latexmk = dir.path().join(crate::tex_distro::exe("latexmk"));
        let blocker = crate::tex_distro::tool_blocker(&latexmk, "makeindex");
        let card = tex_blocker_card(&blocker, "latexmk could not find makeindex".into());
        assert_eq!(card.code.as_deref(), Some("tex.tool_missing"));
        assert_eq!(
            card.params.get("tool").map(String::as_str),
            Some("makeindex")
        );
        assert!(card
            .explanation
            .as_deref()
            .is_some_and(|text| text.contains("makeindex")));

        let mut log = String::from("before");
        let mut errors = Vec::new();
        append_setup_gap(Some(card), &mut log, &mut errors);
        append_setup_gap(None, &mut log, &mut errors);
        assert_eq!(errors.len(), 1);
        assert!(log.contains("[Oleafly]"));
        assert!(log.contains("makeindex"));
    }

    #[test]
    fn latexmk_refusals_have_english_messages() {
        let catalog: serde_json::Value =
            serde_json::from_str(include_str!("../../src/i18n/locales/en/errors.json")).unwrap();
        for key in [
            "latexmk_build_path",
            "latexmk_network_folder",
            "latexmk_path_characters",
            "main_document_characters",
            "bibtex_folder_brace",
            "japanese_compiler_missing",
        ] {
            assert!(
                catalog["tex"][key]
                    .as_str()
                    .is_some_and(|text| !text.is_empty()),
                "{key}"
            );
        }
    }

    #[test]
    fn pythontex_helper_is_exactly_scoped_to_a_current_project_job() {
        let root = std::env::temp_dir().join(format!(
            "oleafly-pythontex-helper-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let project = root.join("project");
        let out = project.join(".oleafly/build");
        let bin = root.join("texbin");
        std::fs::create_dir_all(&out).unwrap();
        std::fs::create_dir_all(&bin).unwrap();
        let code = out.join("_oleafly_entry.pytxcode");
        std::fs::write(&code, "stale pythontex code").unwrap();
        assert_eq!(
            clear_pythontex_code_artifact(&out, crate::paths::ENTRY_STEM).unwrap(),
            code
        );
        assert!(!code.exists());
        std::fs::write(&code, "current pythontex code").unwrap();
        assert!(!pythontex_job_present("ordinary latex log", &code));
        assert!(pythontex_job_present(
            "(/texmf-dist/tex/latex/pythontex/pythontex.sty)",
            &code
        ));

        let args = pythontex_args(&project, &out, crate::paths::ENTRY_STEM, false).unwrap();
        assert_eq!(&args[..2], ["--error-exit-code", "true"]);
        assert_eq!(
            Path::new(&args[2]),
            Path::new(".oleafly")
                .join("build")
                .join(crate::paths::ENTRY_STEM)
        );
        assert!(pythontex_args(&project, &root.join("outside"), "job", false).is_err());
        assert_eq!(
            pythontex_args(&project, &root.join("outside"), "job", true).unwrap()[2],
            root.join("outside").join("job").to_string_lossy()
        );

        let latexmk = bin.join(crate::tex_distro::exe("latexmk"));
        let pythontex = bin.join(crate::tex_distro::exe("pythontex"));
        std::fs::write(&latexmk, "latexmk").unwrap();
        assert_eq!(pythontex_tool_for_latexmk(&latexmk), None);
        std::fs::write(&pythontex, "pythontex").unwrap();
        assert_eq!(pythontex_tool_for_latexmk(&latexmk), Some(pythontex));
        std::fs::remove_file(&code).unwrap();
        std::fs::create_dir(&code).unwrap();
        assert!(clear_pythontex_code_artifact(&out, crate::paths::ENTRY_STEM).is_err());
        std::fs::remove_dir_all(root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn latexmk_marker_detects_a_retargeted_distribution_symlink() {
        use std::os::unix::fs::symlink;

        let directory = tempfile::tempdir().unwrap();
        let dir = directory.path();
        std::fs::create_dir_all(dir.join("one")).unwrap();
        std::fs::create_dir_all(dir.join("two")).unwrap();
        std::fs::write(dir.join("one/latexmk"), b"one").unwrap();
        std::fs::write(dir.join("two/latexmk"), b"two").unwrap();
        let link = dir.join("latexmk");
        symlink(dir.join("one/latexmk"), &link).unwrap();
        let build = dir.join("build");
        assert!(latexmk_binary_changed(&build, &link));
        record_latexmk_binary(&build, &link);
        assert!(!latexmk_binary_changed(&build, &link));
        std::fs::remove_file(&link).unwrap();
        symlink(dir.join("two/latexmk"), &link).unwrap();
        assert!(latexmk_binary_changed(&build, &link));
        let _ = std::fs::remove_dir_all(dir);
    }

    #[cfg(unix)]
    #[test]
    fn latexmk_marker_publication_replaces_instead_of_following_symlinks() {
        use std::os::unix::fs::symlink;

        let directory = tempfile::tempdir().unwrap();
        let dir = directory.path();
        let build = dir.join("build");
        std::fs::create_dir_all(&build).unwrap();
        let outside = dir.join("project-source.tex");
        std::fs::write(&outside, "do not overwrite").unwrap();
        let marker = build.join(".oleafly-latexmk");
        symlink(&outside, &marker).unwrap();

        record_latexmk_binary(&build, Path::new("/reviewed/bin/latexmk"));

        assert_eq!(
            std::fs::read_to_string(&outside).unwrap(),
            "do not overwrite"
        );
        assert!(!std::fs::symlink_metadata(&marker)
            .unwrap()
            .file_type()
            .is_symlink());
        assert_eq!(
            std::fs::read_to_string(&marker).unwrap(),
            "/reviewed/bin/latexmk"
        );
        let _ = std::fs::remove_dir_all(dir);
    }

    const DIAGNOSTIC_LOG: &str = concat!(
        "! Undefined control sequence.\n",
        "l.33 \\badmacro\n",
        "               \n",
        "\n",
        "LaTeX Warning: Reference `fig:x' on page 1 undefined on input line 10.\n",
    );

    #[tokio::test]
    async fn only_tex_engines_parse_structured_log_diagnostics() {
        for engine in [DocumentEngineId::Typst, DocumentEngineId::Markdown] {
            let (log, diagnostics, _) = parse_log_diagnostics(
                engine,
                DIAGNOSTIC_LOG.to_string(),
                Some("main.tex".to_string()),
                PathBuf::new(),
                PathBuf::new(),
                Vec::new(),
            )
            .await
            .unwrap();
            assert_eq!(log, DIAGNOSTIC_LOG, "{}", engine.as_str());
            assert!(diagnostics.is_empty(), "{}", engine.as_str());
        }
    }

    #[tokio::test]
    async fn an_isolated_compile_has_no_root_file_to_attribute_diagnostics_to() {
        let (log, diagnostics, _) = parse_log_diagnostics(
            DocumentEngineId::Latex,
            DIAGNOSTIC_LOG.to_string(),
            None,
            PathBuf::new(),
            PathBuf::new(),
            Vec::new(),
        )
        .await
        .unwrap();
        assert_eq!(log, DIAGNOSTIC_LOG);
        assert!(diagnostics.is_empty());
    }

    #[tokio::test]
    async fn a_tex_compile_returns_errors_and_warnings_against_the_root_file() {
        for engine in [DocumentEngineId::Latex, DocumentEngineId::Latexmk] {
            let (log, diagnostics, _) = parse_log_diagnostics(
                engine,
                DIAGNOSTIC_LOG.to_string(),
                Some("main.tex".to_string()),
                PathBuf::new(),
                PathBuf::new(),
                Vec::new(),
            )
            .await
            .unwrap();

            assert_eq!(log, DIAGNOSTIC_LOG, "{}", engine.as_str());
            assert_eq!(diagnostics.len(), 2, "{}", engine.as_str());
            assert_eq!(
                diagnostics[0].severity,
                oleafly_core::LogSeverity::Error,
                "{}",
                engine.as_str()
            );
            assert_eq!(diagnostics[0].message, "Undefined control sequence.");
            assert_eq!(diagnostics[0].line, Some(33));
            assert_eq!(diagnostics[0].file.as_deref(), Some("main.tex"));
            assert_eq!(diagnostics[1].severity, oleafly_core::LogSeverity::Warning);
            assert_eq!(diagnostics[1].line, Some(10));
            assert_eq!(diagnostics[1].file.as_deref(), Some("main.tex"));
        }
    }

    #[tokio::test]
    async fn an_empty_log_parses_to_no_diagnostics() {
        let (log, diagnostics, _) = parse_log_diagnostics(
            DocumentEngineId::Latex,
            String::new(),
            Some("main.tex".to_string()),
            PathBuf::new(),
            PathBuf::new(),
            Vec::new(),
        )
        .await
        .unwrap();
        assert!(log.is_empty());
        assert!(diagnostics.is_empty());
    }

    #[test]
    fn a_missing_biber_control_file_is_not_a_retained_artifact() {
        let directory = tempfile::tempdir().unwrap();
        let artifacts = EngineArtifacts {
            output_dir: directory.path().to_path_buf(),
            pdf: None,
            log: None,
            synctex: None,
            html: None,
        };
        let biber_control = directory.path().join("never-written.bcf");

        let retained = clear_stale_compile_artifacts(&artifacts, Some(&biber_control));

        assert!(retained.is_empty());
        assert!(!biber_control.exists());
    }

    #[test]
    fn a_biber_control_path_that_cannot_be_removed_is_retained() {
        let directory = tempfile::tempdir().unwrap();
        let artifacts = EngineArtifacts {
            output_dir: directory.path().to_path_buf(),
            pdf: None,
            log: None,
            synctex: None,
            html: None,
        };
        let biber_control = directory.path().join("stubborn.bcf");
        std::fs::create_dir(&biber_control).unwrap();

        let retained = clear_stale_compile_artifacts(&artifacts, Some(&biber_control));

        assert_eq!(retained.len(), 1);
        assert_eq!(retained[0].path, biber_control);
        assert!(matches!(
            retained[0].identity,
            RetainedArtifactIdentity::Unreadable
        ));
        assert!(biber_control.exists());
    }

    #[test]
    fn stale_biber_log_is_removed_with_the_control_file() {
        let directory = tempfile::tempdir().unwrap();
        let artifacts = EngineArtifacts {
            output_dir: directory.path().to_path_buf(),
            pdf: None,
            log: None,
            synctex: None,
            html: None,
        };
        let stem = crate::paths::ENTRY_STEM;
        let biber_control = directory.path().join(format!("{stem}.bcf"));
        let biber_log = directory.path().join(format!("{stem}.blg"));
        let bbl = directory.path().join(format!("{stem}.bbl"));
        std::fs::write(&biber_control, b"stale").unwrap();
        std::fs::write(&biber_log, b"INFO - stale").unwrap();
        std::fs::write(&bbl, b"\\entry{a}{article}{}").unwrap();

        let retained = clear_stale_compile_artifacts(&artifacts, Some(&biber_control));

        assert!(retained.is_empty());
        assert!(!biber_control.exists());
        assert!(!biber_log.exists());
        assert!(bbl.exists());
    }

    fn recovery_fixture(stem: &str, bbl: Option<&str>) -> tempfile::TempDir {
        let directory = tempfile::tempdir().unwrap();
        std::fs::write(
            directory.path().join(format!("{stem}.bcf")),
            "<bcf:controlfile><bcf:citekey order=\"1\">a</bcf:citekey></bcf:controlfile>",
        )
        .unwrap();
        if let Some(content) = bbl {
            std::fs::write(directory.path().join(format!("{stem}.bbl")), content).unwrap();
        }
        directory
    }

    #[test]
    fn recovery_runs_when_this_compile_wrote_no_bbl() {
        let stem = crate::paths::ENTRY_STEM;
        let dir = recovery_fixture(stem, None);
        assert!(bibliography_recovery_needed(dir.path(), stem, None));
    }

    #[test]
    fn recovery_is_skipped_when_this_compile_wrote_the_bbl() {
        let stem = crate::paths::ENTRY_STEM;
        let dir = recovery_fixture(stem, Some("\\refsection{0}\n\\endrefsection\n"));
        assert!(!bibliography_recovery_needed(dir.path(), stem, None));
    }

    #[test]
    fn recovery_runs_for_a_bbl_left_over_from_an_earlier_compile() {
        let stem = crate::paths::ENTRY_STEM;
        let dir = recovery_fixture(
            stem,
            Some("\\refsection{0}\n\\entry{a}{article}{}\n\\endrefsection\n"),
        );
        let before = crate::biber_toolchain::bbl_stamp(dir.path(), stem);
        assert!(before.is_some());
        assert!(bibliography_recovery_needed(dir.path(), stem, before));
    }

    #[test]
    fn recovery_needs_a_control_file() {
        let directory = tempfile::tempdir().unwrap();
        assert!(!bibliography_recovery_needed(
            directory.path(),
            crate::paths::ENTRY_STEM,
            None
        ));
    }

    #[test]
    fn log_budget_is_reserved_for_notes() {
        let big = "x".repeat(MAX_LOG_BYTES);
        let trimmed = reserve_log_budget(big, LOG_NOTES_RESERVE_BYTES);
        assert!(trimmed.len() <= MAX_LOG_BYTES - LOG_NOTES_RESERVE_BYTES + 80);
        assert!(trimmed.ends_with("notes below.\n"));
        let small = "short".to_string();
        assert_eq!(
            reserve_log_budget(small.clone(), LOG_NOTES_RESERVE_BYTES),
            small
        );
    }

    #[test]
    fn engine_output_is_appended_to_the_log_when_the_engine_fails() {
        let spec_log = "This is TeX, Version 3.14\nOutput written on x.xdv.\n".to_string();
        let stdout = "note: Running external tool biber ...\nerror: the external tool exited with an error code; its stdout was:\nERROR - Cannot find 'references.bib'!\n".to_string();
        let combined = append_engine_output_on_failure(spec_log.clone(), &stdout, Some(1));
        assert!(combined.starts_with(&spec_log));
        assert!(combined.contains("[Oleafly] Engine output:"));
        assert!(combined.contains("ERROR - Cannot find 'references.bib'!"));
        let clean = append_engine_output_on_failure(spec_log.clone(), &stdout, Some(0));
        assert_eq!(clean, spec_log);
    }

    const BIBLATEX_MAIN: &str = "\\documentclass{article}\n\\usepackage[backend=biber,style=numeric]{biblatex}\n\\addbibresource{references.bib}\n\\begin{document}\nHello \\cite{miles2004laddering}.\n\\printbibliography\n\\end{document}\n";
    const BIBLATEX_BIB: &str = "@article{miles2004laddering,\n  author = {Miles, Sarah and Rowe, Gene},\n  title = {The laddering technique},\n  journal = {Doing Social Psychology Research},\n  year = {2004}\n}\n";

    #[test]
    #[ignore = "runs the real Tectonic and Biber sidecars: cargo test --lib -- --ignored an_edited_bib_file"]
    fn an_edited_bib_file_reaches_the_next_tectonic_build() {
        let Some(triple) = crate::biber_toolchain::host_triple_guess() else {
            return;
        };
        let manifest = Path::new(env!("CARGO_MANIFEST_DIR"));
        let suffix = std::env::consts::EXE_SUFFIX;
        let sidecar = |name: &str| {
            manifest
                .join("binaries")
                .join(format!("{name}-{triple}{suffix}"))
        };
        let (tectonic, biber) = (sidecar("tectonic"), sidecar("tectonic-biber"));
        if !tectonic.is_file() || !biber.is_file() {
            return;
        }
        let project = tempfile::tempdir().unwrap();
        let root = project.path();
        std::fs::write(root.join("main.tex"), BIBLATEX_MAIN).unwrap();
        std::fs::write(root.join("references.bib"), BIBLATEX_BIB).unwrap();
        let build = root.join(".oleafly").join("build");
        std::fs::create_dir_all(&build).unwrap();
        let stem = crate::paths::ENTRY_STEM;
        let entry = build.join(format!("{stem}.tex"));
        std::fs::write(&entry, "\\input{\\detokenize{main.tex}}\n").unwrap();
        let bin = root.join("bin");
        std::fs::create_dir_all(&bin).unwrap();
        std::fs::copy(&biber, bin.join(format!("tectonic-biber{suffix}"))).unwrap();
        let path = std::env::join_paths(
            std::iter::once(bin.clone()).chain(
                std::env::var_os("PATH")
                    .map(|path| std::env::split_paths(&path).collect::<Vec<_>>())
                    .unwrap_or_default(),
            ),
        )
        .unwrap();
        let args = oleafly_core::engine_spec::tectonic_args(
            &build,
            &[root],
            &entry,
            Some(&tex_bundle_url()),
            oleafly_core::engine_spec::EngineFlags::default(),
        );
        let compile = || {
            let output = std::process::Command::new(&tectonic)
                .args(&args)
                .current_dir(root)
                .env("PATH", &path)
                .output()
                .unwrap();
            assert!(
                output.status.success(),
                "tectonic failed: {}",
                String::from_utf8_lossy(&output.stdout)
            );
            std::fs::read_to_string(build.join(format!("{stem}.bbl"))).unwrap()
        };
        assert!(compile().contains("{2004}"));
        std::fs::write(
            root.join("references.bib"),
            BIBLATEX_BIB.replace("{2004}", "{2019}"),
        )
        .unwrap();
        let artifacts = LATEX_ENGINE.artifacts(
            &build,
            CompileTarget::Main {
                main_document: "main.tex",
            },
        );
        clear_stale_compile_artifacts(&artifacts, Some(&build.join(format!("{stem}.bcf"))));
        assert!(compile().contains("{2019}"));
    }

    #[test]
    #[ignore = "runs the real Tectonic and Biber sidecars: cargo test --lib -- --ignored biblatex_pipeline"]
    fn biblatex_pipeline_resolves_references_bib_and_recovers_a_stale_bbl() {
        let Some(triple) = crate::biber_toolchain::host_triple_guess() else {
            return;
        };
        let manifest = Path::new(env!("CARGO_MANIFEST_DIR"));
        let suffix = std::env::consts::EXE_SUFFIX;
        let tectonic = manifest
            .join("binaries")
            .join(format!("tectonic-{triple}{suffix}"));
        let biber = manifest
            .join("binaries")
            .join(format!("tectonic-biber-{triple}{suffix}"));
        if !tectonic.is_file() || !biber.is_file() {
            return;
        }
        let project = tempfile::tempdir().unwrap();
        let root = project.path();
        std::fs::write(root.join("main.tex"), BIBLATEX_MAIN).unwrap();
        std::fs::write(root.join("references.bib"), BIBLATEX_BIB).unwrap();
        let build = root.join(".oleafly").join("build");
        std::fs::create_dir_all(&build).unwrap();
        let stem = crate::paths::ENTRY_STEM;
        let entry = build.join(format!("{stem}.tex"));
        std::fs::write(&entry, "\\input{\\detokenize{main.tex}}\n").unwrap();
        let bin = root.join("bin");
        std::fs::create_dir_all(&bin).unwrap();
        let shim = bin.join(format!("tectonic-biber{suffix}"));
        std::fs::copy(&biber, &shim).unwrap();
        let mut path_entries = vec![bin.clone()];
        path_entries.extend(
            std::env::var_os("PATH")
                .map(|p| std::env::split_paths(&p).collect::<Vec<_>>())
                .unwrap_or_default(),
        );
        let path = std::env::join_paths(path_entries).unwrap();
        let args = oleafly_core::engine_spec::tectonic_args(
            &build,
            &[root],
            &entry,
            Some(&tex_bundle_url()),
            oleafly_core::engine_spec::EngineFlags::default(),
        );
        let before = crate::biber_toolchain::bbl_stamp(&build, stem);
        let output = std::process::Command::new(&tectonic)
            .args(&args)
            .current_dir(root)
            .env("PATH", &path)
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "tectonic failed: {}\n{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
        let log = std::fs::read_to_string(build.join(format!("{stem}.log"))).unwrap();
        assert!(!log.contains("Please (re)run Biber"));
        assert!(!bibliography_recovery_needed(&build, stem, before));
        let bbl = build.join(format!("{stem}.bbl"));
        assert!(std::fs::read_to_string(&bbl).unwrap().contains("\\entry{"));

        let stale = crate::biber_toolchain::bbl_stamp(&build, stem);
        std::fs::remove_file(build.join(format!("{stem}.blg"))).unwrap();
        assert!(bibliography_recovery_needed(&build, stem, stale));
        let recovery = std::process::Command::new(&biber)
            .args(crate::biber_toolchain::biber_cli_args(&build, stem))
            .env(oleafly_core::biber_env::DIRECT_ENV, "1")
            .current_dir(root)
            .output()
            .unwrap();
        assert!(
            recovery.status.success(),
            "biber failed: {}",
            String::from_utf8_lossy(&recovery.stdout)
        );
        assert!(std::fs::read_to_string(&bbl).unwrap().contains("\\entry{"));
        assert!(!bibliography_recovery_needed(&build, stem, stale));
    }
}
