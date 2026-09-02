use serde::Serialize;
use std::path::{Path, PathBuf};
use tauri::Emitter;

use crate::proc::{isolate_process_tree, terminate_process_tree, NoConsole};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DocumentEngineId {
    Latex,
    Latexmk,
    Typst,
    Markdown,
}

impl DocumentEngineId {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Latex => "latex",
            Self::Latexmk => "latexmk",
            Self::Typst => "typst",
            Self::Markdown => "markdown",
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
    /// A system TeX distribution (MacTeX, TeX Live, MiKTeX, or TinyTeX) that
    /// provides `latexmk`. Used by engines Oleafly does not bundle.
    SystemTex,
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
    /// The project's pinned latexmk compiler ("pdflatex" | "xelatex" |
    /// "lualatex"); None means auto-detect. Filled in by `project_engine`
    /// from project.json, absent in engine-only contexts.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tex_flavor: Option<String>,
    pub allow_shell_escape: bool,
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

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct EngineEnvironment {
    clear_ambient: bool,
    variables: Vec<(String, String)>,
}

impl EngineEnvironment {
    fn inherited(source_date_epoch: Option<u64>) -> Self {
        let variables = source_date_epoch
            .map(|value| vec![("SOURCE_DATE_EPOCH".into(), value.to_string())])
            .unwrap_or_default();
        Self {
            clear_ambient: false,
            variables,
        }
    }

    fn checkpoint(
        out_dir: &Path,
        source_date_epoch: Option<u64>,
        persistent_cache: bool,
    ) -> Result<Self, String> {
        let epoch = source_date_epoch.ok_or_else(|| {
            "checkpoint compiler probes require a fixed source date epoch".to_string()
        })?;
        let probe_root = out_dir.parent().unwrap_or(out_dir);
        let home = probe_root.join("checkpoint-home");
        let config = home.join("config");
        let data = home.join("data");
        let cache = home.join("cache");
        let temp = home.join("tmp");
        let bin = home.join("bin");
        let tectonic_cache = if persistent_cache {
            crate::paths::tectonic_cache_root()?
        } else {
            cache.join("tectonic")
        };
        let display = |path: &Path| path.to_string_lossy().into_owned();
        Ok(Self {
            clear_ambient: true,
            variables: vec![
                ("SOURCE_DATE_EPOCH".into(), epoch.to_string()),
                ("HOME".into(), display(&home)),
                ("USERPROFILE".into(), display(&home)),
                ("XDG_CONFIG_HOME".into(), display(&config)),
                ("XDG_DATA_HOME".into(), display(&data)),
                ("XDG_CACHE_HOME".into(), display(&cache)),
                ("APPDATA".into(), display(&config)),
                ("LOCALAPPDATA".into(), display(&data)),
                ("TMPDIR".into(), display(&temp)),
                ("TMP".into(), display(&temp)),
                ("TEMP".into(), display(&temp)),
                ("PATH".into(), display(&bin)),
                ("TECTONIC_CACHE_DIR".into(), display(&tectonic_cache)),
                (
                    "TYPST_PACKAGE_PATH".into(),
                    display(&data.join("typst-packages")),
                ),
                (
                    "TYPST_PACKAGE_CACHE_PATH".into(),
                    display(&cache.join("typst-packages")),
                ),
            ],
        })
    }

    fn prepare(&self) -> Result<(), String> {
        if !self.clear_ambient {
            return Ok(());
        }
        for key in [
            "HOME",
            "XDG_CONFIG_HOME",
            "XDG_DATA_HOME",
            "XDG_CACHE_HOME",
            "TMPDIR",
            "PATH",
            "TECTONIC_CACHE_DIR",
            "TYPST_PACKAGE_PATH",
            "TYPST_PACKAGE_CACHE_PATH",
        ] {
            if let Some((_, value)) = self.variables.iter().find(|(name, _)| name == key) {
                std::fs::create_dir_all(value).map_err(|error| {
                    format!("failed to prepare checkpoint compiler environment {value}: {error}")
                })?;
            }
        }
        Ok(())
    }

    pub(crate) fn variable(&self, name: &str) -> Option<&str> {
        self.variables
            .iter()
            .find_map(|(candidate, value)| (candidate == name).then_some(value.as_str()))
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
            CompileTarget::Main { main_document } => EngineInput::Generated {
                path: out_dir.join(crate::paths::ENTRY_TEX),
                content: {
                    validate_latex_main_document(main_document)?;
                    format!(
                    "\\ifdefined\\pdfglyphtounicode\\else\\def\\pdfglyphtounicode#1#2{{}}\\fi\n\
                     \\ifdefined\\pdfgentounicode\\else\\newcount\\pdfgentounicode\\fi\n\
                     \\input{{\\detokenize{{{main_document}}}}}\n"
                    )
                },
            },
            CompileTarget::Isolated { source_path, .. } => {
                EngineInput::Direct(source_path.to_owned())
            }
        };
        let artifacts = self.artifacts(out_dir, target);
        let out = out_dir.to_string_lossy();
        let search_path = format!("search-path={}", project_dir.to_string_lossy());
        let entry = input.path().to_string_lossy();
        Ok(EngineCompileSpec {
            executable: EngineExecutable::BundledSidecar("tectonic"),
            args: tectonic_args(&out, &search_path, &entry, options),
            input,
            artifacts,
            working_dir: project_dir.to_owned(),
            environment: compile_environment(out_dir, options)?,
        })
    }

    fn parse_errors(&self, log: &str) -> Vec<CompileError> {
        parse_tex_log_errors(log)
    }
}

/// Which TeX engine latexmk should drive. Chosen from the source itself so an
/// Overleaf import compiles out of the box: a `% !TeX program = ...` magic
/// comment wins, fontspec-style packages force a Unicode engine, and everything
/// else gets pdfLaTeX (Overleaf's own default).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LatexmkFlavor {
    Pdflatex,
    Xelatex,
    Lualatex,
}

impl LatexmkFlavor {
    const fn as_arg(self) -> &'static str {
        match self {
            Self::Pdflatex => "-pdf",
            Self::Xelatex => "-xelatex",
            Self::Lualatex => "-lualatex",
        }
    }

    /// Parse the `project.json` `tex_flavor` value.
    pub fn parse(value: &str) -> Option<Self> {
        match value.trim() {
            "pdflatex" => Some(Self::Pdflatex),
            "xelatex" => Some(Self::Xelatex),
            "lualatex" => Some(Self::Lualatex),
            _ => None,
        }
    }
}

/// The user's pinned compiler wins over every source heuristic (magic comment
/// included); detection only runs for the default "auto" choice.
fn resolve_latexmk_flavor(pinned: Option<LatexmkFlavor>, source_head: &str) -> LatexmkFlavor {
    pinned.unwrap_or_else(|| detect_latexmk_flavor(source_head))
}

fn detect_tex_program_magic(source: &str) -> Option<LatexmkFlavor> {
    // TeXShop/latexmk convention: `% !TeX program = xelatex` near the top.
    for line in source.lines().take(100) {
        let trimmed = line.trim();
        let Some(rest) = trimmed.strip_prefix('%') else {
            continue;
        };
        let lower = rest.trim().trim_start_matches('!').to_ascii_lowercase();
        let Some(value) = lower
            .strip_prefix("tex program")
            .map(str::trim_start)
            .and_then(|v| v.strip_prefix('='))
        else {
            continue;
        };
        return match value.trim() {
            "xelatex" => Some(LatexmkFlavor::Xelatex),
            "lualatex" => Some(LatexmkFlavor::Lualatex),
            "pdflatex" | "latex" => Some(LatexmkFlavor::Pdflatex),
            _ => None,
        };
    }
    None
}

fn detect_latexmk_flavor(source: &str) -> LatexmkFlavor {
    if let Some(flavor) = detect_tex_program_magic(source) {
        return flavor;
    }
    // These packages hard-fail under pdfLaTeX; XeLaTeX also matches how the
    // bundled Tectonic (XeTeX-class) rendered the project before a switch.
    if source.contains("fontspec")
        || source.contains("polyglossia")
        || source.contains("unicode-math")
        || source.contains("\\setmainfont")
    {
        return LatexmkFlavor::Xelatex;
    }
    LatexmkFlavor::Pdflatex
}

/// a giant generated file cannot balloon compile preparation.
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

fn denied_shell_escape_feature(source: &str, log: &str) -> Option<&'static str> {
    let source = source.to_ascii_lowercase();
    let log = log.to_ascii_lowercase();
    if ["minted", "inputminted", "mintinline", "pygmentize"]
        .iter()
        .any(|needle| source.contains(needle) || log.contains(needle))
    {
        return Some("minted syntax highlighting");
    }
    if ["pythontex", "pycode", "pysub", "pygment"]
        .iter()
        .any(|needle| source.contains(needle) || log.contains(needle))
    {
        return Some("PythonTeX");
    }
    if ["\\write18", "\\shellescape", "\\input{|", "includesvg"]
        .iter()
        .any(|needle| source.contains(needle))
        || ["shell escape", "shell-escape", "runsystem"]
            .iter()
            .any(|needle| log.contains(needle))
    {
        return Some("a LaTeX shell command");
    }
    None
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

fn pythontex_job_arg(project_dir: &Path, out_dir: &Path, stem: &str) -> Result<String, String> {
    let relative = out_dir
        .strip_prefix(project_dir)
        .map_err(|_| "PythonTeX output must stay inside the project directory".to_string())?;
    Ok(relative.join(stem).to_string_lossy().into_owned())
}

fn pythontex_args(project_dir: &Path, out_dir: &Path, stem: &str) -> Result<Vec<String>, String> {
    Ok(vec![
        "--error-exit-code".into(),
        "true".into(),
        pythontex_job_arg(project_dir, out_dir, stem)?,
    ])
}

fn validate_latexmk_path_characters(path: &str) -> Result<(), String> {
    let safe = path.chars().all(|character| {
        if !character.is_ascii() {
            return !character.is_control();
        }
        character.is_ascii_alphanumeric()
            || matches!(
                character,
                '/' | '.' | '-' | '_' | ' ' | '(' | ')' | '[' | ']' | ',' | '+' | '=' | '@'
            )
    });
    if safe {
        Ok(())
    } else {
        Err(
            "latexmk paths may contain letters, numbers, spaces, and portable filename punctuation only"
                .into(),
        )
    }
}

fn latexmk_relative_path_arg(path: &Path) -> Result<String, String> {
    if path.as_os_str().is_empty()
        || path.is_absolute()
        || path.components().any(|component| {
            matches!(
                component,
                std::path::Component::ParentDir
                    | std::path::Component::RootDir
                    | std::path::Component::Prefix(_)
            )
        })
    {
        return Err("latexmk paths must stay project-relative".into());
    }
    let value = path.to_string_lossy().replace('\\', "/");
    validate_latexmk_path_characters(&value)?;
    Ok(format!("./{value}"))
}

fn latexmk_args(
    out_dir: &Path,
    entry: &Path,
    stem: &str,
    flavor: LatexmkFlavor,
    options: CompileOptions,
) -> Result<Vec<String>, String> {
    let out_dir = latexmk_relative_path_arg(out_dir)?;
    let mut args: Vec<String> = vec![
        "-norc".into(),
        if options.allow_shell_escape {
            "-shell-escape".into()
        } else {
            "-no-shell-escape".into()
        },
        flavor.as_arg().into(),
        "-interaction=nonstopmode".into(),
        "-synctex=1".into(),
        format!("-outdir={out_dir}"),
        format!("-jobname={stem}"),
    ];
    if options.halt_on_error {
        args.push("-halt-on-error".into());
    } else {
        // Push on to a best-effort PDF after TeX errors (Tectonic
        // continue-on-errors parity).
        args.push("-f".into());
    }
    if flavor == LatexmkFlavor::Lualatex && !options.allow_shell_escape {
        args.push("-latexoption=--nosocket".into());
    }
    // `options.fast` is intentionally ignored: deciding how many passes to run
    // is latexmk's whole job, and `-outdir` reuse already makes warm runs fast.
    args.push(latexmk_relative_path_arg(entry)?);
    Ok(args)
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
        let latexmk = crate::tex_distro::find_tex_tool("latexmk").ok_or_else(|| {
            "latexmk was not found on this machine. The latexmk engine needs a TeX \
             distribution (MacTeX, TeX Live, MiKTeX, or TinyTeX). Install one, or switch \
             this project back to the built-in Tectonic engine."
                .to_string()
        })?;
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
        let source_head = read_source_head(&input_path);
        let flavor = resolve_latexmk_flavor(options.latex_flavor, &source_head);
        let entry_path = input_path
            .strip_prefix(project_dir)
            .map_err(|_| "latexmk input must stay inside the project directory".to_string())?;
        let relative_out_dir = out_dir
            .strip_prefix(project_dir)
            .map_err(|_| "latexmk output must stay inside the project directory".to_string())?;
        let artifacts = self.artifacts(out_dir, target);
        let mut args = latexmk_args(relative_out_dir, entry_path, stem, flavor, options)?;
        // latexmk's dependency database is not portable across TeX
        // distributions: after a distro switch it can report "Nothing to do"
        // while replaying the previous run's error. Force one full rebuild
        // (-gg) whenever the resolved latexmk binary differs from the one
        // that produced this build directory.
        if latexmk_binary_changed(out_dir, &latexmk) {
            args.insert(0, "-gg".into());
        }
        Ok(EngineCompileSpec {
            executable: EngineExecutable::ExternalPath(latexmk),
            args,
            input: EngineInput::Direct(input_path),
            artifacts,
            working_dir: project_dir.to_owned(),
            environment: EngineEnvironment::inherited(options.source_date_epoch),
        })
    }

    fn parse_errors(&self, log: &str) -> Vec<CompileError> {
        parse_tex_log_errors(log)
    }
}

fn latexmk_binary_changed(out_dir: &Path, latexmk: &Path) -> bool {
    const MAX_MARKER_BYTES: u64 = 64 * 1024;
    let marker = out_dir.join(".oleafly-latexmk");
    let resolved = std::fs::canonicalize(latexmk).unwrap_or_else(|_| latexmk.to_owned());
    let current = resolved.to_string_lossy();
    let previous = std::fs::symlink_metadata(&marker)
        .ok()
        .filter(|metadata| {
            metadata.is_file()
                && !metadata.file_type().is_symlink()
                && metadata.len() <= MAX_MARKER_BYTES
        })
        .and_then(|_| std::fs::read_to_string(&marker).ok())
        .unwrap_or_default();
    previous.trim() != current
}

fn record_latexmk_binary(out_dir: &Path, latexmk: &Path) {
    let resolved = std::fs::canonicalize(latexmk).unwrap_or_else(|_| latexmk.to_owned());
    if std::fs::create_dir_all(out_dir).is_ok() {
        let _ = crate::sandbox::atomic_write(
            &out_dir.join(".oleafly-latexmk"),
            resolved.to_string_lossy().as_bytes(),
        );
    }
}

fn validate_latex_main_document(path: &str) -> Result<(), String> {
    if path.is_empty()
        || path.chars().any(|character| {
            character.is_control()
                || matches!(
                    character,
                    '{' | '}' | '\\' | '%' | '#' | '$' | '&' | '^' | '~'
                )
        })
    {
        return Err(
            "LaTeX main document contains characters unsafe for the generated wrapper".into(),
        );
    }
    Ok(())
}

impl DocumentEngine for TypstEngine {
    fn id(&self) -> DocumentEngineId {
        DocumentEngineId::Typst
    }

    fn capabilities(&self) -> EngineCapabilities {
        EngineCapabilities {
            produces_pdf: true,
            supports_synctex: false,
            supports_offline: false,
            supports_isolated_compile: false,
            formatting_profile: FormattingProfile::Typst,
            source_preflight_profile: SourcePreflightProfile::None,
            features: &[EngineFeature::Citations, EngineFeature::DocumentIndex],
            conversion_exports: &[],
            template_kinds: &[TemplateKind::Document],
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
        Ok(EngineCompileSpec {
            executable: EngineExecutable::BundledSidecar("typst"),
            args: typst_args(&input, output, project_dir, out_dir, options),
            input: EngineInput::Direct(input),
            artifacts,
            working_dir: project_dir.to_owned(),
            environment: compile_environment(out_dir, options)?,
        })
    }

    fn parse_errors(&self, log: &str) -> Vec<CompileError> {
        parse_typst_short_diagnostics(log)
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
        let pandoc = crate::project::find_pandoc().ok_or_else(||
            "Pandoc is required to compile Markdown. Install it from Downloads, then compile again.".to_string()
        )?;
        let tectonic = find_bundled_tectonic().ok_or_else(||
            "Oleafly's bundled Tectonic PDF engine could not be located. Reinstall Oleafly, then compile again.".to_string()
        )?;
        markdown_compile_spec(
            self,
            out_dir,
            project_dir,
            main_document,
            PathBuf::from(pandoc),
            tectonic,
            options,
        )
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

fn tectonic_sidecar_candidates(
    current_exe: Option<&Path>,
    manifest_dir: &Path,
    executable: &str,
) -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    if let Some(parent) = current_exe.and_then(Path::parent) {
        candidates.push(parent.join(executable));
    }
    candidates.push(manifest_dir.join("target/debug").join(executable));
    candidates.push(manifest_dir.join("target/release").join(executable));
    candidates
}

fn markdown_compile_spec(
    engine: &MarkdownEngine,
    out_dir: &Path,
    project_dir: &Path,
    main_document: &str,
    pandoc: PathBuf,
    tectonic: PathBuf,
    options: CompileOptions,
) -> Result<EngineCompileSpec, String> {
    let target = CompileTarget::Main { main_document };
    let input = project_dir.join(main_document);
    let artifacts = engine.artifacts(out_dir, target);
    let output = artifacts
        .pdf
        .as_ref()
        .ok_or_else(|| "Markdown PDF artifact was not declared".to_string())?;
    let mut args = vec![
        "--from=markdown".into(),
        "--standalone".into(),
        format!("--resource-path={}", project_dir.to_string_lossy()),
        format!("--pdf-engine={}", tectonic.to_string_lossy()),
        "--pdf-engine-opt=--bundle".into(),
        format!("--pdf-engine-opt={}", tex_bundle_url()),
        format!("--output={}", output.to_string_lossy()),
        "--sandbox".into(),
        "--citeproc".into(),
    ];
    let bibliographies = if options.checkpoint_mode.enabled() {
        if project_dir.join("references.bib").is_file() {
            vec!["references.bib".to_string()]
        } else {
            Vec::new()
        }
    } else {
        discover_bibliographies(project_dir)?
    };
    args.extend(
        bibliographies
            .into_iter()
            .map(|path| format!("--bibliography={path}")),
    );
    if options.checkpoint_mode.enabled() {
        let data_dir = out_dir.join("checkpoint-pandoc-data");
        args.extend([
            "--verbose".into(),
            format!("--data-dir={}", data_dir.to_string_lossy()),
            format!(
                "--log={}",
                out_dir.join("checkpoint-pandoc-log.json").to_string_lossy()
            ),
            "--pdf-engine-opt=--makefile-rules".into(),
            format!(
                "--pdf-engine-opt={}",
                out_dir
                    .join("checkpoint-tectonic-deps.mk")
                    .to_string_lossy()
            ),
            "--pdf-engine-opt=--untrusted".into(),
        ]);
        if options.checkpoint_mode == CheckpointCompileMode::Replay {
            args.push("--pdf-engine-opt=--only-cached".into());
        }
    }
    args.extend(["--".into(), input.to_string_lossy().into_owned()]);
    Ok(EngineCompileSpec {
        executable: EngineExecutable::ExternalPath(pandoc),
        args,
        input: EngineInput::Direct(input),
        artifacts,
        working_dir: project_dir.to_owned(),
        environment: compile_environment(out_dir, options)?,
    })
}

fn discover_bibliographies(project_dir: &Path) -> Result<Vec<String>, String> {
    if !project_dir.is_dir() {
        return Ok(Vec::new());
    }
    fn walk(root: &Path, dir: &Path, depth: usize, output: &mut Vec<String>) -> Result<(), String> {
        if depth > 16 {
            return Err("bibliography search exceeded maximum depth".into());
        }
        for entry in std::fs::read_dir(dir).map_err(|error| error.to_string())? {
            let entry = entry.map_err(|error| error.to_string())?;
            let file_type = entry.file_type().map_err(|error| error.to_string())?;
            if file_type.is_symlink() {
                continue;
            }
            let path = entry.path();
            if file_type.is_dir() {
                if entry.file_name() != ".oleafly" {
                    walk(root, &path, depth + 1, output)?;
                }
            } else if file_type.is_file()
                && path
                    .extension()
                    .is_some_and(|extension| extension.eq_ignore_ascii_case("bib"))
            {
                let relative = path
                    .strip_prefix(root)
                    .map_err(|_| "bibliography escaped project root")?;
                output.push(
                    relative
                        .components()
                        .map(|component| component.as_os_str().to_string_lossy())
                        .collect::<Vec<_>>()
                        .join("/"),
                );
            }
        }
        Ok(())
    }
    let mut output = Vec::new();
    walk(project_dir, project_dir, 0, &mut output)?;
    output.sort();
    Ok(output)
}

fn parse_pandoc_diagnostics(log: &str) -> Vec<CompileError> {
    log.lines()
        .filter_map(|line| {
            let trimmed = line.trim();
            if trimmed.is_empty() {
                return None;
            }
            let lower = trimmed.to_ascii_lowercase();
            let kind = if lower.contains("warning") {
                "warning"
            } else if lower.contains("error") || lower.starts_with("pandoc:") {
                "error"
            } else {
                return None;
            };
            Some(CompileError {
                line: None,
                file: None,
                message: trimmed.to_owned(),
                kind: kind.to_owned(),
                explanation: None,
            })
        })
        .collect()
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
        }
        .to_owned(),
        source_format: match engine.id() {
            DocumentEngineId::Latexmk => "latex".to_owned(),
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
    })
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
pub struct CompileError {
    pub line: Option<u32>,
    pub file: Option<String>,
    pub message: String,
    pub kind: String,
    /// Deterministic plain-English explanation for common errors, when known.
    pub explanation: Option<String>,
}

#[derive(Serialize, Default)]
pub struct CompileResult {
    pub ok: bool,
    pub has_pdf: bool,
    /// Fingerprint of the exact fresh PDF observed while the compile lock is
    /// still held. The frontend verifies this before accepting IPC bytes.
    pub output_id: Option<String>,
    /// Assigned only to successful main-document outputs by the command layer.
    /// Isolated figure compiles leave this unset.
    pub output_revision: Option<u64>,
    pub log: String,
    pub errors: Vec<CompileError>,
    pub synctex_path: Option<String>,
    pub out_dir: Option<String>,
    pub compile_time_ms: u64,
    /// The user stopped this compile. Distinguishes an intentional stop from a
    /// document that genuinely failed to build.
    pub stopped: bool,
    /// Durable Checkpoint publication is supplementary to compilation. A
    /// skipped outcome never changes an otherwise successful compile result.
    pub checkpoint_publication: crate::checkpoint_publication::CheckpointPublicationOutcome,
}

/// Must stay byte-for-byte compatible with
/// `fingerprintCompileOutput` in `src/lib/compile-checkpoint.ts`.
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

/// User-selected compiler behaviour for one request. Engines that cannot honour
/// a flag ignore it; `supports_offline` already guards the offline case.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct CompileOptions {
    pub offline: bool,
    /// Single typesetting pass instead of reruns until the document stabilizes.
    pub fast: bool,
    /// Stop at the first TeX error rather than pushing on to a best-effort PDF.
    pub halt_on_error: bool,
    /// The project's pinned latexmk compiler; None means auto-detect from the
    /// source. Ignored by every other engine.
    pub latex_flavor: Option<LatexmkFlavor>,
    pub allow_shell_escape: bool,
    pub checkpoint_mode: CheckpointCompileMode,
    pub checkpoint_persistent_cache: bool,
    pub source_date_epoch: Option<u64>,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum CheckpointCompileMode {
    #[default]
    Disabled,
    Discovery,
    Replay,
}

impl CheckpointCompileMode {
    fn enabled(self) -> bool {
        !matches!(self, Self::Disabled)
    }
}

pub struct CompileRequest<'a> {
    pub app: &'a tauri::AppHandle,
    pub engine: &'a dyn DocumentEngine,
    pub out_dir: &'a Path,
    pub project_dir: &'a Path,
    pub target: CompileTarget<'a>,
    pub log_event: &'a str,
    pub options: CompileOptions,
    /// Set for main-document compiles so "Stop compilation" can reach them.
    /// Figure builds run in their own lane and pass `None`.
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
    let helper_args = pythontex_args(&spec.working_dir, &spec.artifacts.output_dir, stem)?;
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
            append_failure(notes, format!("failed to run PythonTeX helper: {error}"))
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
    match run_external(
        request.app,
        latexmk,
        &spec.args,
        &spec.working_dir,
        request.log_event,
        request.cancel,
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
                format!("failed to re-run latexmk after PythonTeX: {error}"),
            )
        }
    }
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
) -> Result<(String, Option<PathBuf>), String> {
    if request.engine.id() != DocumentEngineId::Latex
        || !matches!(request.target, CompileTarget::Main { .. })
    {
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
    if !bibliography_recovery_needed(&compile_log, out_dir, stem) {
        return Ok((String::new(), None));
    }
    if request.options.checkpoint_mode.enabled() {
        return Ok((
            "\n[Oleafly] Checkpoint evidence stopped before an untracked Biber pass.\n".into(),
            None,
        ));
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

fn bibliography_recovery_needed(log: &str, output_dir: &Path, stem: &str) -> bool {
    crate::biber_toolchain::bibliography_needs_biber(log, output_dir, stem)
        && crate::biber_toolchain::biber_output_missing(output_dir, stem)
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
    let outcome = run_supervised_process(
        biber,
        &biber_args,
        &spec.working_dir,
        Some((request.app.clone(), request.log_event.to_owned())),
        COMPILE_TIMEOUT,
        request.cancel,
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
            append_bounded(&mut notes, error.as_bytes());
            append_biber_diagnosis(&mut notes, &error, biber);
            Ok(notes)
        }
    }
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
            run_bundled(
                request.app,
                name,
                &spec.args,
                &spec.working_dir,
                request.log_event,
                request.cancel,
            )
            .await?
        }
        EngineExecutable::ExternalPath(path) => {
            run_external(
                request.app,
                path,
                &spec.args,
                &spec.working_dir,
                request.log_event,
                request.cancel,
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
        stdout_buf,
        exit_code,
        biber_notes,
        resolved_biber,
        pythontex_notes,
        pythontex_failure,
    } = finish;
    let mut log = combined_compile_log(&spec, stdout_buf, &biber_notes, &pythontex_notes);
    append_missing_biber_diagnosis(request, &spec, &mut log, resolved_biber);
    let output_id = verify_compile_output(capabilities, &spec, retained_stale).await?;
    let has_pdf = output_id.is_some();
    let mut errors = request.engine.parse_errors(&log);
    append_pythontex_error(&mut errors, stopped, pythontex_failure);
    append_shell_escape_error(
        request,
        &spec,
        stopped,
        has_pdf,
        exit_code,
        &mut log,
        &mut errors,
    );
    let ok = compile_succeeded(
        request, &spec, stopped, has_pdf, exit_code, &errors, &mut log,
    );
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
            log,
        },
    ))
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
    if ok && request.engine.id() == DocumentEngineId::Latexmk {
        if let EngineExecutable::ExternalPath(latexmk) = &spec.executable {
            record_latexmk_binary(&spec.artifacts.output_dir, latexmk);
        }
    }
    ok
}

fn combined_compile_log(
    spec: &EngineCompileSpec,
    stdout: String,
    biber_notes: &str,
    pythontex_notes: &str,
) -> String {
    let mut log = spec
        .artifacts
        .log
        .as_ref()
        .and_then(|path| read_log_bounded(path).ok())
        .unwrap_or(stdout);
    append_bounded(&mut log, biber_notes.as_bytes());
    append_bounded(&mut log, pythontex_notes.as_bytes());
    log
}

fn append_missing_biber_diagnosis(
    request: &CompileRequest<'_>,
    spec: &EngineCompileSpec,
    log: &mut String,
    resolved_biber: Option<PathBuf>,
) {
    let needs_diagnosis = request.engine.id() == DocumentEngineId::Latex
        && matches!(request.target, CompileTarget::Main { .. })
        && bibliography_recovery_needed(log, &spec.artifacts.output_dir, crate::paths::ENTRY_STEM)
        && !log.contains("[Oleafly] Bibliography needs Biber");
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
            "Install PythonTeX in the same TeX distribution that provides latexmk, or disable PythonTeX in this document. PythonTeX runs project code and therefore also requires explicit shell-command consent.".into(),
        ),
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
    let Some(feature) = denied_shell_escape_feature(&source_head, log) else {
        return;
    };
    let message = format!(
        "{feature} needs LaTeX shell escape, but host command execution is disabled for this project."
    );
    let explanation = "Enable “Allow LaTeX shell commands” in this project's compiler settings only if you trust every project file. Enabling it permits arbitrary commands and persistent background programs to run on your computer. Cancellation cleanup is best-effort for programs that deliberately detach.".to_string();
    append_bounded(
        log,
        format!("\n[Oleafly] {message} {explanation}\n").as_bytes(),
    );
    errors.push(CompileError {
        line: None,
        file: None,
        message,
        kind: "error".into(),
        explanation: Some(explanation),
    });
}

struct CompileResultParts {
    stopped: bool,
    ok: bool,
    has_pdf: bool,
    output_id: Option<String>,
    errors: Vec<CompileError>,
    log: String,
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
        log: parts.log,
        synctex_path,
        out_dir: Some(spec.artifacts.output_dir.to_string_lossy().into_owned()),
        compile_time_ms: compile_start.elapsed().as_millis() as u64,
        checkpoint_publication: Default::default(),
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
        request.options,
    )
    .await
}

async fn prepare_compile_artifacts(
    request: &CompileRequest<'_>,
    spec: &EngineCompileSpec,
) -> Result<Vec<RetainedArtifact>, String> {
    spec.environment.prepare()?;
    if spec.environment.clear_ambient {
        std::fs::create_dir_all(spec.artifacts.output_dir.join("checkpoint-pandoc-data"))
            .map_err(|error| format!("failed to prepare checkpoint compiler data: {error}"))?;
    }
    let cleanup_artifacts = spec.artifacts.clone();
    let biber_control = (request.engine.id() == DocumentEngineId::Latex
        && matches!(request.target, CompileTarget::Main { .. }))
    .then(|| {
        spec.artifacts
            .output_dir
            .join(format!("{}.bcf", crate::paths::ENTRY_STEM))
    });
    let retained = tokio::task::spawn_blocking(move || {
        clear_stale_compile_artifacts(&cleanup_artifacts, biber_control.as_deref())
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
        std::fs::write(path, content)
            .map_err(|error| format!("failed to write engine entry {}: {error}", path.display()))?;
    }
    Ok(retained)
}

async fn execute_compile_spec(
    request: &CompileRequest<'_>,
    spec: &EngineCompileSpec,
) -> Result<(String, Option<i32>), String> {
    match &spec.executable {
        EngineExecutable::BundledSidecar(name) => {
            let (output, exit_code) = run_bundled_with_environment(
                request.app,
                name,
                &spec.args,
                &spec.working_dir,
                request.log_event,
                request.cancel,
                &spec.environment,
            )
            .await?;
            // Mirror outage (or a pre-mirror cache in offline mode): one retry
            // against Tectonic's default upstream bundle. Gated on the log so
            // ordinary TeX errors never trigger a second run.
            if name == &"tectonic"
                && !request.options.checkpoint_mode.enabled()
                && exit_code != Some(0)
                && spec.args.iter().any(|arg| arg == "--bundle")
                && is_bundle_fetch_failure(&output)
            {
                let fallback_args = args_without_bundle(&spec.args);
                let (retry_output, retry_code) = run_bundled_with_environment(
                    request.app,
                    name,
                    &fallback_args,
                    &spec.working_dir,
                    request.log_event,
                    request.cancel,
                    &spec.environment,
                )
                .await?;
                let mut combined = String::new();
                append_bounded(
                    &mut combined,
                    b"[Oleafly] The TeX package mirror was unreachable; retried with the upstream bundle.\n",
                );
                append_bounded(&mut combined, retry_output.as_bytes());
                return Ok((combined, retry_code));
            }
            Ok((output, exit_code))
        }
        EngineExecutable::ExternalPath(path) => {
            let (output, exit_code) = run_external_with_environment(
                request.app,
                path,
                &spec.args,
                &spec.working_dir,
                request.log_event,
                request.cancel,
                &spec.environment,
            )
            .await?;
            if request.engine.id() == DocumentEngineId::Markdown
                && !request.options.checkpoint_mode.enabled()
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
                    &spec.working_dir,
                    request.log_event,
                    request.cancel,
                    &spec.environment,
                )
                .await?;
                let mut combined = String::new();
                append_bounded(&mut combined, output.as_bytes());
                append_bounded(
                    &mut combined,
                    b"[Oleafly] The TeX package mirror was unreachable; retried with the upstream bundle.\n",
                );
                append_bounded(&mut combined, retry_output.as_bytes());
                return Ok((combined, retry_code));
            }
            Ok((output, exit_code))
        }
    }
}

pub async fn compile(request: CompileRequest<'_>) -> Result<CompileResult, String> {
    let cancel_scope = CompileCancelScope::new(request.cancel);
    let capabilities = request.engine.capabilities();
    validate_compile_capabilities(&request, capabilities)?;
    let spec = resolve_compile_spec(&request).await?;
    let _tex_runtime = if request.engine.id() == DocumentEngineId::Latexmk {
        Some(crate::latex_engine::acquire_tex_runtime_read()?)
    } else {
        None
    };
    let retained_stale = prepare_compile_artifacts(&request, &spec).await?;
    let compile_start = std::time::Instant::now();
    let (mut stdout_buf, mut exit_code) = execute_compile_spec(&request, &spec).await?;

    let (biber_notes, resolved_biber) =
        recover_bibliography(&request, &spec, &mut stdout_buf, &mut exit_code).await?;
    let (pythontex_notes, pythontex_failure) =
        recover_pythontex(&request, &spec, &mut stdout_buf, &mut exit_code).await?;
    let finish = CompileFinish {
        capabilities,
        spec,
        retained_stale,
        compile_start,
        stdout_buf,
        exit_code,
        biber_notes,
        resolved_biber,
        pythontex_notes,
        pythontex_failure,
    };
    finish_compile(&request, finish, cancel_scope.finish()).await
}

const COMPILE_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(300);
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
    append_bounded(&mut output, &bytes);
    Ok(output)
}

async fn run_bundled(
    app: &tauri::AppHandle,
    name: &str,
    args: &[String],
    working_dir: &Path,
    log_event: &str,
    cancel: Option<&crate::state::CompileCancel>,
) -> Result<(String, Option<i32>), String> {
    run_bundled_with_environment(
        app,
        name,
        args,
        working_dir,
        log_event,
        cancel,
        &EngineEnvironment::default(),
    )
    .await
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
        COMPILE_TIMEOUT,
        cancel,
        environment,
    )
    .await
}

pub(crate) fn resolve_bundled_sidecar(name: &str) -> Result<PathBuf, String> {
    if name.is_empty() || Path::new(name).components().count() != 1 {
        return Err("invalid bundled sidecar name".into());
    }
    let executable = std::env::current_exe()
        .map_err(|error| format!("failed to locate application executable: {error}"))?;
    let executable_dir = executable
        .parent()
        .ok_or("application executable has no parent")?;
    let base_dir = if executable_dir.ends_with("deps") {
        executable_dir.parent().unwrap_or(executable_dir)
    } else {
        executable_dir
    };
    #[cfg(not(windows))]
    let path = base_dir.join(name);
    #[cfg(windows)]
    let mut path = base_dir.join(name);
    #[cfg(windows)]
    path.as_mut_os_string().push(".exe");
    path.is_file()
        .then_some(path.clone())
        .ok_or_else(|| format!("bundled sidecar not found: {}", path.display()))
}

#[derive(Default)]
struct Utf8StreamDecoder {
    pending: Vec<u8>,
}

impl Utf8StreamDecoder {
    fn push(&mut self, bytes: &[u8], finish: bool) -> String {
        self.pending.extend_from_slice(bytes);
        let mut output = String::new();
        let mut consumed = 0;
        while consumed < self.pending.len() {
            match std::str::from_utf8(&self.pending[consumed..]) {
                Ok(valid) => {
                    output.push_str(valid);
                    consumed = self.pending.len();
                }
                Err(error) => {
                    let valid_end = consumed + error.valid_up_to();
                    output.push_str(
                        std::str::from_utf8(&self.pending[consumed..valid_end])
                            .expect("valid_up_to must identify valid UTF-8"),
                    );
                    consumed = valid_end;
                    match error.error_len() {
                        Some(invalid_len) => {
                            output.push('\u{fffd}');
                            consumed += invalid_len;
                        }
                        None if finish => {
                            output.push_str(&String::from_utf8_lossy(&self.pending[consumed..]));
                            consumed = self.pending.len();
                        }
                        None => break,
                    }
                }
            }
        }
        if consumed > 0 {
            self.pending.drain(..consumed);
        }
        output
    }
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
) -> String
where
    R: tokio::io::AsyncRead + Unpin,
{
    use tokio::io::AsyncReadExt;
    let mut collected = String::new();
    let mut decoder = Utf8StreamDecoder::default();
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

async fn run_external(
    app: &tauri::AppHandle,
    path: &Path,
    args: &[String],
    working_dir: &Path,
    log_event: &str,
    cancel: Option<&crate::state::CompileCancel>,
) -> Result<(String, Option<i32>), String> {
    run_external_with_environment(
        app,
        path,
        args,
        working_dir,
        log_event,
        cancel,
        &EngineEnvironment::default(),
    )
    .await
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
        COMPILE_TIMEOUT,
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

fn is_luatex_invocation(path: &Path, args: &[String]) -> bool {
    args.iter().any(|argument| argument == "-lualatex")
        || path
            .file_stem()
            .and_then(|name| name.to_str())
            .is_some_and(|name| {
                matches!(
                    name.to_ascii_lowercase().as_str(),
                    "lualatex" | "luatex" | "luahbtex"
                )
            })
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

async fn run_supervised_process_with_environment(
    path: &Path,
    args: &[String],
    working_dir: &Path,
    emitter: Option<(tauri::AppHandle, String)>,
    timeout: std::time::Duration,
    cancel: Option<&crate::state::CompileCancel>,
    environment: &EngineEnvironment,
) -> Result<(String, Option<i32>), String> {
    use std::process::Stdio;
    let is_luatex = is_luatex_invocation(path, args);
    let mut command = tokio::process::Command::new(path);
    command.no_console();
    if environment.clear_ambient {
        command.env_clear();
    }
    command
        .args(args)
        .current_dir(working_dir)
        // TeX bin dirs + tectonic-biber for all supervised children (LaTeX primary;
        // Typst/others ignore extra PATH entries that are not present or unused).
        .env(
            "PATH",
            crate::biber_toolchain::compile_path_env_for(path, working_dir),
        )
        .env("NoDefaultCurrentDirectoryInExePath", "1")
        .env("openout_any", "p");
    for (name, value) in &environment.variables {
        command.env(name, value);
    }
    if !is_luatex {
        command.env("openin_any", "p");
    }
    if !args.iter().any(|argument| argument == "-shell-escape") {
        command.env("shell_escape", "f");
    }
    command
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    if environment.clear_ambient {
        crate::proc::isolate_process_tree_low_priority(&mut command);
    } else {
        isolate_process_tree(&mut command);
    }

    let mut child = command
        .spawn()
        .map_err(|e| format!("failed to spawn {}: {e}", path.display()))?;
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
        // A stop can land between the request and the spawn. `attach` reports
        // that case so the child we just started is ended immediately.
        if !cancel.attach(child_pid) {
            terminate_process_tree(child_pid).await;
        }
    }
    let stdout = child.stdout.take().ok_or("stdout was not captured")?;
    let stderr = child.stderr.take().ok_or("stderr was not captured")?;
    let emitted = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let (app, event) = emitter.map_or((None, String::new()), |(app, event)| (Some(app), event));
    let out = tokio::spawn(pump_external_output(
        stdout,
        app.clone(),
        event.clone(),
        emitted.clone(),
    ));
    let err = tokio::spawn(pump_external_output(
        stderr,
        app.clone(),
        event.clone(),
        emitted.clone(),
    ));
    let code = match tokio::time::timeout(timeout, child.wait()).await {
        Ok(Ok(status)) => status.code(),
        Ok(Err(error)) => {
            terminate_process_tree(child_pid).await;
            let _ = child.start_kill();
            let _ = tokio::time::timeout(COMPILER_PIPE_CLOSE_TIMEOUT, child.wait()).await;
            let _ = drain_compiler_output(out, err, Some(child_pid)).await;
            return Err(format!("failed waiting for {}: {error}", path.display()));
        }
        Err(_) => {
            terminate_process_tree(child_pid).await;
            let _ = child.kill().await;
            let _ = child.wait().await;
            let (mut log, pipes_stalled) = drain_compiler_output(out, err, Some(child_pid)).await;
            let message = format!(
                "error: process timed out after {:.3}s and was stopped",
                timeout.as_secs_f64()
            );
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
    Ok((log, code))
}

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

fn clear_stale_artifacts(artifacts: &EngineArtifacts) -> Vec<RetainedArtifact> {
    let mut retained = Vec::new();
    for path in [&artifacts.pdf, &artifacts.log, &artifacts.synctex]
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

/// Oleafly's mirror of the Tectonic TeX package bundle. Upstream's relay
/// rate-limits (HTTP 429) and is a single point of failure for every first
/// compile; the mirror serves the same tar (same content digest) from
/// Cloudflare, so Tectonic's content-addressed cache is shared across origins.
const TEX_BUNDLE_MIRROR_URL: &str = "https://mirrors.oleafly.com/tex-bundles/tlextras-2022.0r0.tar";

pub(crate) fn tex_bundle_url() -> String {
    std::env::var("OLEAFLY_TEX_BUNDLE_URL")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| TEX_BUNDLE_MIRROR_URL.into())
}

/// True when a failed Tectonic run died acquiring bundle resources rather
/// than on a TeX error — the only case where retrying against the upstream
/// bundle can help.
fn is_bundle_fetch_failure(log: &str) -> bool {
    [
        "couldn't get it from the internet",
        "this bundle isn't cached",
        "unexpected HTTP response code",
        "failed to download",
        "error connecting to",
    ]
    .iter()
    .any(|marker| log.contains(marker))
}

fn args_without_bundle(args: &[String]) -> Vec<String> {
    let mut out = Vec::with_capacity(args.len());
    let mut skip_next = false;
    for arg in args {
        if skip_next {
            skip_next = false;
            continue;
        }
        if arg == "--bundle" || arg == "--pdf-engine-opt=--bundle" {
            skip_next = true;
            continue;
        }
        out.push(arg.clone());
    }
    out
}

fn tectonic_args(
    out_dir: &str,
    search_path: &str,
    entry: &str,
    options: CompileOptions,
) -> Vec<String> {
    let mut args: Vec<String> = vec!["-X".into(), "compile".into()];
    // Pinned in offline mode too: a cache populated from either origin
    // satisfies --only-cached, and the upstream fallback below covers a cache
    // whose URL mapping predates the mirror.
    args.extend(["--bundle".into(), tex_bundle_url()]);
    if options.offline || options.checkpoint_mode == CheckpointCompileMode::Replay {
        args.push("--only-cached".into());
    }
    args.extend([
        "--synctex".into(),
        "--keep-logs".into(),
        // Write .aux/.toc to the build dir: reference numbering reads
        // \newlabel entries from the last compile's aux files.
        "--keep-intermediates".into(),
        "--print".into(),
        "--outdir".into(),
        out_dir.into(),
    ]);
    if options.fast {
        // One typesetting pass instead of reruns until the document stabilizes.
        // Cross-references, citations, and the table of contents can lag a run
        // behind; that is the trade the draft mode is asking for.
        args.extend(["--reruns".into(), "0".into()]);
    }
    if !options.halt_on_error {
        args.extend(["-Z".into(), "continue-on-errors".into()]);
    }
    if options.checkpoint_mode.enabled() {
        args.extend([
            "--makefile-rules".into(),
            Path::new(out_dir)
                .join("checkpoint-tectonic-deps.mk")
                .to_string_lossy()
                .into_owned(),
        ]);
    }
    args.extend(["-Z".into(), search_path.into(), entry.into()]);
    args
}

fn typst_args(
    input: &Path,
    output: &Path,
    project_dir: &Path,
    out_dir: &Path,
    options: CompileOptions,
) -> Vec<String> {
    let mut args = vec![
        "--color".into(),
        "never".into(),
        "compile".into(),
        input.to_string_lossy().into_owned(),
        output.to_string_lossy().into_owned(),
        "--root".into(),
        project_dir.to_string_lossy().into_owned(),
        "--diagnostic-format".into(),
        "short".into(),
    ];
    if options.checkpoint_mode.enabled() {
        args.extend([
            "--deps".into(),
            out_dir
                .join("checkpoint-typst-deps.zero")
                .to_string_lossy()
                .into_owned(),
            "--deps-format".into(),
            "zero".into(),
            "--ignore-system-fonts".into(),
        ]);
    }
    args
}

fn compile_environment(
    out_dir: &Path,
    options: CompileOptions,
) -> Result<EngineEnvironment, String> {
    if options.checkpoint_mode.enabled() {
        EngineEnvironment::checkpoint(
            out_dir,
            options.source_date_epoch,
            options.checkpoint_persistent_cache,
        )
    } else {
        Ok(EngineEnvironment::inherited(options.source_date_epoch))
    }
}

fn parse_typst_short_diagnostics(log: &str) -> Vec<CompileError> {
    let mut diagnostics = Vec::new();
    for line in log.lines() {
        let Some((location, kind, message)) = ["error", "warning"].into_iter().find_map(|kind| {
            let marker = format!(": {kind}: ");
            line.rsplit_once(&marker)
                .map(|(location, message)| (location, kind, message))
        }) else {
            continue;
        };
        let mut fields = location.rsplitn(3, ':');
        let column = fields.next().and_then(|value| value.parse::<u32>().ok());
        let line_number = fields.next().and_then(|value| value.parse::<u32>().ok());
        let file = fields.next().map(str::to_owned);
        if column.is_none() || line_number.is_none() || file.as_deref().map_or(true, str::is_empty)
        {
            continue;
        }
        diagnostics.push(CompileError {
            line: line_number,
            file,
            message: message.to_owned(),
            kind: kind.to_owned(),
            explanation: None,
        });
    }
    diagnostics
}

// A TeX log token after `(` looks like an input file if it carries a path
// separator or a file extension. Font/date/version parens ("(Font)", "(2021/01/01)")
// do not, so they never masquerade as the source file for an error.
fn looks_like_tex_path(token: &str) -> bool {
    token.starts_with('/')
        || token.starts_with("./")
        || (token.contains('.') && token.contains('/'))
        || token.rsplit('.').next().is_some_and(|ext| {
            matches!(
                ext,
                "tex" | "sty" | "cls" | "def" | "ldf" | "bbl" | "bib" | "clo" | "fd" | "cfg"
            )
        })
}

// TeX marks the file it is reading with balanced parens: `(path` on open, `)` on
// close. Track the nesting so an error can be attributed to the right file in a
// multi-file (\input/\include) project. Every `(` pushes and every `)` pops to
// keep the stack balanced; the current file is the innermost path-like entry.
fn update_tex_file_stack(line: &str, stack: &mut Vec<String>) {
    let bytes = line.as_bytes();
    let mut idx = 0;
    while idx < bytes.len() {
        match bytes[idx] {
            b'(' => {
                let start = idx + 1;
                let mut end = start;
                while end < bytes.len()
                    && !matches!(bytes[end], b'(' | b')' | b' ' | b'\t' | b'[' | b']')
                {
                    end += 1;
                }
                stack.push(line[start..end].trim_start_matches("./").to_owned());
                idx = end;
            }
            b')' => {
                stack.pop();
                idx += 1;
            }
            _ => idx += 1,
        }
    }
}

fn current_tex_file(stack: &[String]) -> Option<String> {
    stack
        .iter()
        .rev()
        .find(|token| looks_like_tex_path(token))
        .cloned()
}

// Deterministic plain-English explanations for high-frequency TeX errors. This is
// intentionally a small, curated set (Humanized Errors Milestone 1), not an
// exhaustive catalog. Returns None for anything not recognized.
fn humanize_tex_error(message: &str) -> Option<&'static str> {
    let m = message.trim();
    if m.starts_with("Undefined control sequence") {
        return Some("LaTeX does not recognize this command. Check for a typo, or load the package that defines it.");
    }
    if m.starts_with("Missing $ inserted") {
        return Some("A math-only symbol (such as _, ^, or a Greek letter) was used outside math mode. Wrap it in $...$.");
    }
    if m.starts_with("Missing } inserted") || m.starts_with("Missing { inserted") {
        return Some("Unbalanced braces. Make sure every { has a matching }.");
    }
    if m.starts_with("Runaway argument") {
        return Some("A command argument was never closed, usually a missing } or \\end{...} above this point.");
    }
    if m.starts_with("Double superscript") {
        return Some("Two ^ in a row. Group them, for example x^{a}^{b} becomes x^{ab}.");
    }
    if m.starts_with("Double subscript") {
        return Some("Two _ in a row. Group them, for example x_{a}_{b} becomes x_{ab}.");
    }
    if m.starts_with("Extra alignment tab") {
        return Some("A table row has more & separators than the column specification allows.");
    }
    if m.starts_with("Misplaced alignment tab character &") {
        return Some(
            "An & appeared outside a table or alignment. Write \\& for a literal ampersand.",
        );
    }
    if m.starts_with("There's no line here to end") {
        return Some("\\\\ was used where LaTeX did not expect a line break, for example in ordinary paragraph text.");
    }
    if let Some(rest) = m.strip_prefix("LaTeX Error: ") {
        if rest.starts_with("Too many unprocessed floats") {
            return Some("LaTeX ran out of room to place figures/tables. Add a \\clearpage before continuing, shrink the floats, or use [htbp] placement so they can move.");
        }
        if rest.contains("not found") {
            return Some("A file or package could not be found. Check the name and path, or install the missing package.");
        }
        if rest.starts_with("Environment ") && rest.contains("undefined") {
            return Some("This environment is not defined. Check the spelling, or load the package that provides it.");
        }
        if rest.starts_with("\\begin{") && rest.contains("ended by") {
            return Some(
                "Environment mismatch: a \\begin{...} was closed by a different \\end{...}.",
            );
        }
        if rest.contains("missing \\item") {
            return Some(
                "A list (itemize/enumerate/description) has content before its first \\item.",
            );
        }
    }
    if m.starts_with("Package ") && m.contains(" Error:") {
        return Some(
            "A LaTeX package reported an error. The package name and detail follow in the log.",
        );
    }
    None
}

// Deterministic float placement warnings surfaced from the log (Float Advisor
// Milestone 1). These are LaTeX Warnings, not `!` errors, so they are matched
// separately and always carry an explanation.
fn float_warning(line: &str) -> Option<&'static str> {
    let l = line.trim();
    if l.contains("float specifier changed to") {
        return Some("LaTeX could not place this float where you asked and moved it. Use [htbp] to give it more placement options.");
    }
    if l.starts_with("LaTeX Warning: Float too large for page") {
        return Some("A figure or table is taller than the text area, so LaTeX cannot place it. Scale it down (for example width=\\linewidth) or make it a full-page float.");
    }
    None
}

fn parse_tex_log_errors(log: &str) -> Vec<CompileError> {
    let mut out = Vec::new();
    let lines: Vec<&str> = log.lines().collect();
    let mut stack: Vec<String> = Vec::new();
    for i in 0..lines.len() {
        update_tex_file_stack(lines[i], &mut stack);
        if let Some(explanation) = float_warning(lines[i]) {
            out.push(CompileError {
                line: None,
                file: current_tex_file(&stack),
                message: lines[i].trim().to_owned(),
                kind: "warning".to_owned(),
                explanation: Some(explanation.to_owned()),
            });
            continue;
        }
        if let Some(message) = lines[i].strip_prefix("! ") {
            let mut line_no = None;
            for following in lines
                .iter()
                .skip(i + 1)
                .take(20.min(lines.len().saturating_sub(i + 1)))
            {
                if following.starts_with('!') {
                    break;
                }
                if let Some(rest) = following.strip_prefix("l.") {
                    let digits: String = rest.chars().take_while(char::is_ascii_digit).collect();
                    if let Ok(number) = digits.parse::<u32>() {
                        line_no = Some(number);
                        break;
                    }
                }
            }
            out.push(CompileError {
                line: line_no,
                file: current_tex_file(&stack),
                message: message.to_owned(),
                kind: "error".to_owned(),
                explanation: humanize_tex_error(message).map(str::to_owned),
            });
        }
    }
    out
}

pub fn compiled_pdf_path(
    project_id: &str,
    metadata_name: &str,
    main_document: &str,
) -> Result<PathBuf, String> {
    let engine = engine_for(metadata_name, main_document)?;
    let build = crate::paths::build_dir(project_id)?;
    engine
        .artifacts(&build, CompileTarget::Main { main_document })
        .pdf
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

    fn joined(dir: &str, name: &str) -> String {
        Path::new(dir).join(name).to_string_lossy().into_owned()
    }

    #[test]
    fn compiler_output_utf8_decoder_preserves_split_codepoints() {
        let mut decoder = Utf8StreamDecoder::default();
        assert_eq!(decoder.push(b"prefix \xf0\x9f", false), "prefix ");
        assert_eq!(decoder.push(b"\x98\x80 suffix", false), "😀 suffix");
        assert_eq!(decoder.push(&[], true), "");

        let mut truncated = Utf8StreamDecoder::default();
        assert_eq!(truncated.push(b"bad \xe2\x82", false), "bad ");
        assert_eq!(truncated.push(&[], true), "�");
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

    #[test]
    fn tex_errors_get_plain_english_explanations() {
        let log = "! Undefined control sequence.\nl.42 \\foo\n";
        let errors = parse_tex_log_errors(log);
        assert_eq!(errors.len(), 1);
        assert_eq!(errors[0].line, Some(42));
        assert_eq!(errors[0].kind, "error");
        assert!(errors[0]
            .explanation
            .as_deref()
            .unwrap()
            .contains("does not recognize"));
    }

    #[test]
    fn tex_errors_find_line_number_past_tectonic_v2_cli_preamble() {
        // Real tectonic -X compile --print output interleaves several lines
        // (including a duplicated "error: file:line:" summary from the V2
        // CLI itself) between the "! " trigger and the "l.NN" reference,
        // well past a short lookahead window.
        let log = concat!(
            "! LaTeX Error: Environment align undefined.\n",
            "\n",
            "See the LaTeX manual or LaTeX Companion for explanation.\n",
            "Type  H <return>  for immediate help.\n",
            " ...                                              \n",
            "                                                  \n",
            "l.5 \\begin{align}\n",
            "                 \n",
            "No pages of output.\n",
        );
        let errors = parse_tex_log_errors(log);
        assert_eq!(errors.len(), 1);
        assert_eq!(errors[0].line, Some(5));
    }

    #[test]
    fn tex_errors_without_a_known_pattern_have_no_explanation() {
        let log = "! Some novel engine failure.\nl.3 x\n";
        let errors = parse_tex_log_errors(log);
        assert_eq!(errors.len(), 1);
        assert_eq!(errors[0].explanation, None);
    }

    #[test]
    fn tex_errors_attribute_to_the_innermost_open_file() {
        // main opens chapter, the error occurs inside chapter, then chapter closes.
        let log = "(./main.tex (./chapters/intro.tex\n! Missing $ inserted.\nl.7 x_1\n))\n";
        let errors = parse_tex_log_errors(log);
        assert_eq!(errors.len(), 1);
        assert_eq!(errors[0].file.as_deref(), Some("chapters/intro.tex"));
        assert_eq!(errors[0].line, Some(7));
        assert!(errors[0].explanation.as_deref().unwrap().contains("math"));
    }

    #[test]
    fn tex_file_stack_ignores_non_path_parens() {
        // Font/version parens must not be mistaken for the source file.
        let log = "(./main.tex (Font) (2021/01/01)\n! Undefined control sequence.\nl.9 \\bad\n)\n";
        let errors = parse_tex_log_errors(log);
        assert_eq!(errors[0].file.as_deref(), Some("main.tex"));
    }

    #[test]
    fn float_placement_warnings_are_surfaced_and_explained() {
        let log = "(./main.tex\nLaTeX Warning: `h' float specifier changed to `ht'.\n)\n";
        let errors = parse_tex_log_errors(log);
        assert_eq!(errors.len(), 1);
        assert_eq!(errors[0].kind, "warning");
        assert_eq!(errors[0].file.as_deref(), Some("main.tex"));
        assert!(errors[0].explanation.as_deref().unwrap().contains("htbp"));
    }

    #[test]
    fn too_many_floats_error_is_explained() {
        let log = "! LaTeX Error: Too many unprocessed floats.\nl.120 \\end{figure}\n";
        let errors = parse_tex_log_errors(log);
        assert_eq!(errors.len(), 1);
        assert_eq!(errors[0].kind, "error");
        assert!(errors[0]
            .explanation
            .as_deref()
            .unwrap()
            .contains("clearpage"));
    }

    #[test]
    fn tectonic_args_pin_the_bundle_to_the_oleafly_mirror() {
        let args = tectonic_args(
            "out",
            "-Zsearch-path=src",
            "main.tex",
            CompileOptions::default(),
        );
        let position = args
            .iter()
            .position(|arg| arg == "--bundle")
            .expect("--bundle flag present");
        assert_eq!(args[position + 1], tex_bundle_url());
        assert!(tex_bundle_url().starts_with("https://mirrors.oleafly.com/"));
    }

    #[test]
    fn offline_compiles_keep_the_bundle_pin_alongside_only_cached() {
        // The mirror tar shares upstream's content digest, so Tectonic's
        // content-addressed cache satisfies --only-cached for either origin.
        let options = CompileOptions {
            offline: true,
            ..Default::default()
        };
        let args = tectonic_args("out", "-Zsearch-path=src", "main.tex", options);
        assert!(args.iter().any(|arg| arg == "--only-cached"));
        assert!(args.iter().any(|arg| arg == "--bundle"));
    }

    #[test]
    fn bundle_fetch_failures_are_distinguished_from_tex_errors() {
        for log in [
            "error: this bundle isn't cached, and we couldn't get it from the internet",
            "caused by: unexpected HTTP response code 429 Too Many Requests for URL https://mirrors.oleafly.com/tex-bundles/tlextras-2022.0r0.tar",
            "note: failed to download \"msbm10.tfm\"",
        ] {
            assert!(is_bundle_fetch_failure(log), "{log}");
        }
        for log in [
            "! Undefined control sequence.\nl.19 \\oops",
            "main.tex:4: Package fontspec Error: The font \"Nope\" cannot be found.",
            "",
        ] {
            assert!(!is_bundle_fetch_failure(log), "{log:?}");
        }
    }

    #[test]
    fn stripping_the_bundle_flag_removes_the_flag_and_its_url() {
        let args: Vec<String> = [
            "-X",
            "compile",
            "--bundle",
            "https://example.test/b.tar",
            "main.tex",
        ]
        .into_iter()
        .map(String::from)
        .collect();
        let stripped = args_without_bundle(&args);
        assert_eq!(stripped, vec!["-X", "compile", "main.tex"]);
        assert_eq!(args_without_bundle(&stripped), stripped);

        let pandoc: Vec<String> = [
            "--standalone",
            "--pdf-engine-opt=--bundle",
            "--pdf-engine-opt=https://example.test/b.tar",
            "main.md",
        ]
        .into_iter()
        .map(String::from)
        .collect();
        assert_eq!(
            args_without_bundle(&pandoc),
            vec!["--standalone", "main.md"]
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
    fn latex_wrapper_rejects_tex_interpolation_characters() {
        for path in [
            "main}.tex",
            "main%comment.tex",
            "main\\evil.tex",
            "main\n.tex",
        ] {
            assert!(validate_latex_main_document(path).is_err(), "{path:?}");
        }
        assert!(validate_latex_main_document("chapters/my paper-1.tex").is_ok());
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
        let marker = root.join("descendant-survived");
        let script = format!("(sleep 1.6; touch '{}') & exit 0", marker.display());
        let started = std::time::Instant::now();
        let (log, code) = run_supervised_process(
            Path::new("/bin/sh"),
            &["-c".into(), script],
            &root,
            None,
            std::time::Duration::from_secs(5),
            None,
        )
        .await
        .unwrap();

        assert_eq!(code, Some(-1));
        assert!(log.contains("kept output pipes open"), "{log}");
        assert!(started.elapsed() < std::time::Duration::from_secs(3));
        tokio::time::sleep(std::time::Duration::from_millis(800)).await;
        assert!(!marker.exists(), "the inherited-pipe descendant survived");
        let _ = std::fs::remove_dir_all(root);
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
                    "conversion_exports": ["docx", "html", "md", "txt", "pptx", "epub"],
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
                content: "\\ifdefined\\pdfglyphtounicode\\else\\def\\pdfglyphtounicode#1#2{}\\fi\n\\ifdefined\\pdfgentounicode\\else\\newcount\\pdfgentounicode\\fi\n\\input{\\detokenize{main.tex}}\n".into(),
            }
        );
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
                    ConversionExport::Epub
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

    #[test]
    fn tectonic_checkpoint_probe_emits_a_machine_dependency_report() {
        let spec = engine_for("tectonic", "main.tex")
            .unwrap()
            .compile_spec(
                Path::new("/evidence"),
                Path::new("/project"),
                CompileTarget::Main {
                    main_document: "main.tex",
                },
                CompileOptions {
                    checkpoint_mode: CheckpointCompileMode::Replay,
                    source_date_epoch: Some(1_788_288_000),
                    ..Default::default()
                },
            )
            .unwrap();

        assert_eq!(
            arg_pair(&spec.args, "--makefile-rules").as_deref(),
            Some(joined("/evidence", "checkpoint-tectonic-deps.mk").as_str())
        );
        assert!(spec.environment.clear_ambient);
        assert!(spec
            .environment
            .variables
            .contains(&("SOURCE_DATE_EPOCH".into(), "1788288000".into())));
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
                supports_synctex: false,
                supports_offline: false,
                supports_isolated_compile: false,
                formatting_profile: FormattingProfile::Typst,
                source_preflight_profile: SourcePreflightProfile::None,
                features: &[EngineFeature::Citations, EngineFeature::DocumentIndex],
                conversion_exports: &[],
                template_kinds: &[TemplateKind::Document],
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
                "--color",
                "never",
                "compile",
                joined("/project", "chapters/main.typ").as_str(),
                joined("/build", "_oleafly_entry.pdf").as_str(),
                "--root",
                "/project",
                "--diagnostic-format",
                "short",
            ]
        );
    }

    #[test]
    fn typst_checkpoint_probe_is_hermetic_and_reports_all_non_font_files() {
        let engine = engine_for("typst", "chapters/main.typ").unwrap();
        let spec = engine
            .compile_spec(
                Path::new("/evidence"),
                Path::new("/project"),
                CompileTarget::Main {
                    main_document: "chapters/main.typ",
                },
                CompileOptions {
                    checkpoint_mode: CheckpointCompileMode::Discovery,
                    source_date_epoch: Some(1_788_288_000),
                    ..Default::default()
                },
            )
            .unwrap();

        assert_eq!(
            arg_pair(&spec.args, "--deps").as_deref(),
            Some(joined("/evidence", "checkpoint-typst-deps.zero").as_str())
        );
        assert_eq!(
            arg_pair(&spec.args, "--deps-format").as_deref(),
            Some("zero")
        );
        assert!(spec.args.iter().any(|arg| arg == "--ignore-system-fonts"));
        assert!(spec.environment.clear_ambient);
        assert!(Path::new(spec.environment.variable("PATH").unwrap())
            .ends_with(Path::new("checkpoint-home").join("bin")));
    }

    #[tokio::test]
    async fn bundled_typst_checkpoint_probe_replays_with_identical_pdf_and_dependencies() {
        let temp = tempfile::tempdir().unwrap();
        let project = temp.path().join("project");
        let primary_out = temp.path().join("primary");
        let discovery_out = temp.path().join("discovery");
        let replay_out = temp.path().join("replay");
        std::fs::create_dir(&project).unwrap();
        std::fs::create_dir(&primary_out).unwrap();
        std::fs::create_dir(&discovery_out).unwrap();
        std::fs::create_dir(&replay_out).unwrap();
        std::fs::write(
            project.join("project.json"),
            br#"{"main_doc":"main.typ","engine":"typst"}"#,
        )
        .unwrap();
        std::fs::write(project.join("main.typ"), b"#include \"chapter.typ\"\n").unwrap();
        std::fs::write(project.join("chapter.typ"), b"= Replayed\n").unwrap();
        let engine = engine_for("typst", "main.typ").unwrap();
        let options = CompileOptions {
            checkpoint_mode: CheckpointCompileMode::Discovery,
            source_date_epoch: Some(1_788_288_000),
            ..Default::default()
        };
        let spec = |root: &Path, out_dir: &Path, mode: CheckpointCompileMode| {
            let mut options = options;
            options.checkpoint_mode = mode;
            engine
                .compile_spec(
                    out_dir,
                    root,
                    CompileTarget::Main {
                        main_document: "main.typ",
                    },
                    options,
                )
                .unwrap()
        };
        let primary = spec(&project, &primary_out, CheckpointCompileMode::Disabled);
        let discovery = spec(&project, &discovery_out, CheckpointCompileMode::Discovery);
        let typst = resolve_bundled_sidecar("typst").unwrap();

        for spec in [&primary, &discovery] {
            spec.environment.prepare().unwrap();
            let (log, code) = run_supervised_process_with_environment(
                &typst,
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
        }

        let discovery_deps =
            std::fs::read(discovery_out.join("checkpoint-typst-deps.zero")).unwrap();
        let canonical_project = project.canonicalize().unwrap();
        let mut relative_dependencies = Vec::new();
        let mut inputs = vec![oleafly_history::CaptureInput::explicit("project.json").unwrap()];
        for dependency in discovery_deps
            .split(|byte| *byte == 0)
            .filter(|path| !path.is_empty())
        {
            let dependency = PathBuf::from(String::from_utf8(dependency.to_vec()).unwrap());
            let resolved = if dependency.is_absolute() {
                dependency
            } else {
                project.join(dependency)
            }
            .canonicalize()
            .unwrap();
            let relative = resolved
                .strip_prefix(&canonical_project)
                .unwrap()
                .to_string_lossy()
                .replace(std::path::MAIN_SEPARATOR, "/");
            relative_dependencies.push(relative.clone());
            inputs.push(
                oleafly_history::CaptureInput::replay_required(
                    &relative,
                    &resolved,
                    oleafly_history::ContentHash::digest_file(&resolved).unwrap(),
                )
                .unwrap(),
            );
        }
        relative_dependencies.sort();
        let store = oleafly_history::Store::open(temp.path().join("history")).unwrap();
        let candidate = store.stage_candidate(&project, &inputs).unwrap();
        std::fs::write(project.join("chapter.typ"), b"= Mutated after sealing\n").unwrap();
        let replay = spec(
            candidate.sealed_root(),
            &replay_out,
            CheckpointCompileMode::Replay,
        );
        replay.environment.prepare().unwrap();
        let (log, code) = run_supervised_process_with_environment(
            &typst,
            &replay.args,
            &replay.working_dir,
            None,
            COMPILE_TIMEOUT,
            None,
            &replay.environment,
        )
        .await
        .unwrap();
        assert_eq!(code, Some(0), "{log}");

        let primary_pdf = std::fs::read(primary_out.join("_oleafly_entry.pdf")).unwrap();
        let discovery_pdf = std::fs::read(discovery_out.join("_oleafly_entry.pdf")).unwrap();
        let replay_pdf = std::fs::read(replay_out.join("_oleafly_entry.pdf")).unwrap();
        assert_eq!(primary_pdf, discovery_pdf);
        assert_eq!(discovery_pdf, replay_pdf);

        let canonical_sealed = candidate.sealed_root().canonicalize().unwrap();
        let mut replay_dependencies = std::fs::read(replay_out.join("checkpoint-typst-deps.zero"))
            .unwrap()
            .split(|byte| *byte == 0)
            .filter(|path| !path.is_empty())
            .map(|path| {
                let dependency = PathBuf::from(String::from_utf8(path.to_vec()).unwrap());
                let dependency = if dependency.is_absolute() {
                    dependency
                } else {
                    candidate.sealed_root().join(dependency)
                };
                dependency
                    .canonicalize()
                    .unwrap()
                    .strip_prefix(&canonical_sealed)
                    .unwrap()
                    .to_string_lossy()
                    .replace(std::path::MAIN_SEPARATOR, "/")
            })
            .collect::<Vec<_>>();
        replay_dependencies.sort();
        assert_eq!(relative_dependencies, replay_dependencies);
        assert_eq!(
            relative_dependencies,
            ["chapter.typ".to_string(), "main.typ".to_string()]
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
                    ConversionExport::Epub
                ],
                template_kinds: &[TemplateKind::Document],
                compiler_prerequisite: Some(CompilerPrerequisite::Pandoc),
            }
        );
    }

    #[test]
    fn markdown_compile_is_direct_and_uses_declared_artifacts() {
        let spec = markdown_compile_spec(
            &MARKDOWN_ENGINE,
            Path::new("/build"),
            Path::new("/project"),
            "chapters/main.md",
            PathBuf::from("/cache/pandoc"),
            PathBuf::from("/app/tectonic"),
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
        assert_eq!(
            spec.args,
            [
                "--from=markdown",
                "--standalone",
                "--resource-path=/project",
                "--pdf-engine=/app/tectonic",
                "--pdf-engine-opt=--bundle",
                format!("--pdf-engine-opt={}", tex_bundle_url()).as_str(),
                format!("--output={}", joined("/build", "_oleafly_entry.pdf")).as_str(),
                "--sandbox",
                "--citeproc",
                "--",
                joined("/project", "chapters/main.md").as_str(),
            ]
        );
    }

    #[test]
    fn ordinary_markdown_preserves_legacy_bibliographies_while_checkpoint_probe_is_explicit() {
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
        let engine = MarkdownEngine;
        let spec = markdown_compile_spec(
            &engine,
            &dir.join("build"),
            &dir,
            "main.md",
            PathBuf::from("/pandoc"),
            PathBuf::from("/tectonic"),
            CompileOptions::default(),
        )
        .unwrap();
        assert!(spec.args.iter().any(|arg| arg == "--citeproc"));
        assert!(spec
            .args
            .iter()
            .any(|arg| arg == "--bibliography=references.bib"));
        let bibliography_args: Vec<_> = spec
            .args
            .iter()
            .filter(|arg| arg.starts_with("--bibliography="))
            .collect();
        assert_eq!(
            bibliography_args,
            [
                "--bibliography=references.bib",
                "--bibliography=sources/refs.bib"
            ]
        );

        let checkpoint = markdown_compile_spec(
            &engine,
            &dir.join("checkpoint"),
            &dir,
            "main.md",
            PathBuf::from("/pandoc"),
            PathBuf::from("/tectonic"),
            CompileOptions {
                checkpoint_mode: CheckpointCompileMode::Discovery,
                source_date_epoch: Some(1_788_288_000),
                ..Default::default()
            },
        )
        .unwrap();
        let checkpoint_bibliographies = checkpoint
            .args
            .iter()
            .filter(|arg| arg.starts_with("--bibliography="))
            .collect::<Vec<_>>();
        assert_eq!(checkpoint_bibliographies, ["--bibliography=references.bib"]);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn markdown_checkpoint_probe_controls_pandoc_and_downstream_tectonic() {
        let spec = markdown_compile_spec(
            &MARKDOWN_ENGINE,
            Path::new("/evidence"),
            Path::new("/project"),
            "main.md",
            PathBuf::from("/cache/pandoc"),
            PathBuf::from("/app/tectonic"),
            CompileOptions {
                checkpoint_mode: CheckpointCompileMode::Replay,
                source_date_epoch: Some(1_788_288_000),
                ..Default::default()
            },
        )
        .unwrap();

        for expected in [
            "--sandbox",
            "--citeproc",
            "--verbose",
            "--pdf-engine-opt=--makefile-rules",
            "--pdf-engine-opt=--untrusted",
        ] {
            assert!(spec.args.iter().any(|arg| arg == expected), "{expected}");
        }
        assert!(spec.args.iter().any(|arg| {
            arg == &format!(
                "--log={}",
                joined("/evidence", "checkpoint-pandoc-log.json")
            )
        }));
        assert!(spec.args.iter().any(|arg| {
            arg == &format!(
                "--pdf-engine-opt={}",
                joined("/evidence", "checkpoint-tectonic-deps.mk")
            )
        }));
        assert!(spec.environment.clear_ambient);
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
    fn packaged_tectonic_candidates_cover_tauri_and_cargo_layouts() {
        let candidates = tectonic_sidecar_candidates(
            Some(Path::new(
                "/Applications/Oleafly.app/Contents/MacOS/oleafly",
            )),
            Path::new("/src/src-tauri"),
            "tectonic",
        );
        assert_eq!(
            candidates[0],
            PathBuf::from("/Applications/Oleafly.app/Contents/MacOS/tectonic")
        );
        assert_eq!(
            candidates[1],
            PathBuf::from("/src/src-tauri/target/debug/tectonic")
        );
        assert_eq!(
            candidates[2],
            PathBuf::from("/src/src-tauri/target/release/tectonic")
        );
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
        // The frontend keys LaTeX behavior off source_format, not the id.
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
        // First compile in a fresh build dir: no marker yet, rebuild once.
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
        // An explicit per-project compiler wins over the magic comment and the
        // fontspec upgrade; auto (None) falls back to detection.
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
        assert_eq!(LatexmkFlavor::parse("tectonic"), None);
        assert_eq!(LatexmkFlavor::parse(""), None);
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
        assert!(args.contains(&"-no-shell-escape".to_string()));
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
        assert!(untrusted_lualatex.contains(&"-no-shell-escape".to_string()));
        assert!(untrusted_lualatex.contains(&"-latexoption=--nosocket".to_string()));
    }

    #[test]
    fn luatex_invocation_detection_covers_latexmk_and_direct_platform_names() {
        assert!(is_luatex_invocation(
            Path::new("/tex/bin/latexmk"),
            &["-lualatex".into()]
        ));
        assert!(is_luatex_invocation(Path::new("C:/tex/LUALATEX.EXE"), &[]));
        assert!(is_luatex_invocation(Path::new("/tex/bin/luahbtex"), &[]));
        assert!(!is_luatex_invocation(
            Path::new("/tex/bin/latexmk"),
            &["-pdf".into()]
        ));
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
            "paper's.tex",
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

        let args = pythontex_args(&project, &out, crate::paths::ENTRY_STEM).unwrap();
        assert_eq!(&args[..2], ["--error-exit-code", "true"]);
        assert_eq!(
            Path::new(&args[2]),
            Path::new(".oleafly")
                .join("build")
                .join(crate::paths::ENTRY_STEM)
        );
        assert!(pythontex_args(&project, &root.join("outside"), "job").is_err());

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
}
