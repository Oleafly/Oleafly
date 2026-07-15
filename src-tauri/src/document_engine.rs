use serde::Serialize;
use std::path::{Path, PathBuf};
use tauri::Emitter;

use crate::proc::{isolate_process_tree, terminate_process_tree, NoConsole};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DocumentEngineId {
    Latex,
    Typst,
    Markdown,
}

impl DocumentEngineId {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Latex => "latex",
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
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EngineCompileSpec {
    pub executable: EngineExecutable,
    pub args: Vec<String>,
    pub input: EngineInput,
    pub artifacts: EngineArtifacts,
    pub working_dir: PathBuf,
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
        offline: bool,
    ) -> Result<EngineCompileSpec, String>;
    fn parse_errors(&self, log: &str) -> Vec<CompileError>;
}

struct LatexEngine;
static LATEX_ENGINE: LatexEngine = LatexEngine;

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
        offline: bool,
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
            args: tectonic_args(&out, &search_path, &entry, offline),
            input,
            artifacts,
            working_dir: project_dir.to_owned(),
        })
    }

    fn parse_errors(&self, log: &str) -> Vec<CompileError> {
        parse_tex_log_errors(log)
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
        _offline: bool,
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
            args: typst_args(&input, output, project_dir),
            input: EngineInput::Direct(input),
            artifacts,
            working_dir: project_dir.to_owned(),
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
        _offline: bool,
    ) -> Result<EngineCompileSpec, String> {
        let CompileTarget::Main { main_document } = target else {
            return Err("Markdown does not support isolated compilation".into());
        };
        let pandoc = crate::project::find_pandoc().ok_or_else(||
            "Pandoc is required to compile Markdown. Install it from Downloads, then compile again.".to_string()
        )?;
        let tectonic = find_bundled_tectonic().ok_or_else(||
            "OpenLeaf's bundled Tectonic PDF engine could not be located. Reinstall OpenLeaf, then compile again.".to_string()
        )?;
        markdown_compile_spec(
            self,
            out_dir,
            project_dir,
            main_document,
            PathBuf::from(pandoc),
            tectonic,
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
    let engine: &'static dyn DocumentEngine = if LATEX_ENGINE.accepts_metadata_name(metadata_name) {
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
        format!("--output={}", output.to_string_lossy()),
    ];
    let bibliographies = discover_bibliographies(project_dir)?;
    if !bibliographies.is_empty() {
        args.push("--citeproc".into());
        args.extend(
            bibliographies
                .into_iter()
                .map(|path| format!("--bibliography={path}")),
        );
    }
    args.extend(["--".into(), input.to_string_lossy().into_owned()]);
    Ok(EngineCompileSpec {
        executable: EngineExecutable::ExternalPath(pandoc),
        args,
        input: EngineInput::Direct(input),
        artifacts,
        working_dir: project_dir.to_owned(),
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
                if entry.file_name() != ".openleaf" {
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
            DocumentEngineId::Typst => "Typst",
            DocumentEngineId::Markdown => "Markdown / Pandoc",
        }
        .to_owned(),
        source_format: engine.id().as_str().to_owned(),
        main_document: main_document.to_owned(),
        source_extensions: engine
            .source_extensions()
            .iter()
            .map(|extension| (*extension).to_owned())
            .collect(),
        capabilities: engine.capabilities(),
    })
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
pub struct CompileError {
    pub line: Option<u32>,
    pub file: Option<String>,
    pub message: String,
    pub kind: String,
}

#[derive(Serialize, Default)]
pub struct CompileResult {
    pub ok: bool,
    pub has_pdf: bool,
    pub log: String,
    pub errors: Vec<CompileError>,
    pub synctex_path: Option<String>,
    pub out_dir: Option<String>,
    pub compile_time_ms: u64,
}

pub struct CompileRequest<'a> {
    pub app: &'a tauri::AppHandle,
    pub engine: &'a dyn DocumentEngine,
    pub out_dir: &'a Path,
    pub project_dir: &'a Path,
    pub target: CompileTarget<'a>,
    pub log_event: &'a str,
    pub offline: bool,
    pub prepared_spec: Option<EngineCompileSpec>,
}

pub async fn prepare_compile_spec(
    engine_id: DocumentEngineId,
    out_dir: PathBuf,
    project_dir: PathBuf,
    target: CompileTarget<'_>,
    offline: bool,
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
                offline,
            ),
            (None, Some(source_path), Some(output_stem)) => engine.compile_spec(
                &out_dir,
                &project_dir,
                CompileTarget::Isolated {
                    source_path: &source_path,
                    output_stem: &output_stem,
                },
                offline,
            ),
            _ => Err("invalid compiler target".into()),
        }
    })
    .await
    .map_err(|error| format!("failed to prepare compiler command: {error}"))?
}

pub async fn compile(request: CompileRequest<'_>) -> Result<CompileResult, String> {
    let capabilities = request.engine.capabilities();
    if request.offline && !capabilities.supports_offline {
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
    let spec = match request.prepared_spec {
        Some(spec) => spec,
        None => {
            prepare_compile_spec(
                request.engine.id(),
                request.out_dir.to_owned(),
                request.project_dir.to_owned(),
                request.target,
                request.offline,
            )
            .await?
        }
    };
    let cleanup_artifacts = spec.artifacts.clone();
    let retained_stale =
        tokio::task::spawn_blocking(move || clear_stale_artifacts(&cleanup_artifacts))
            .await
            .map_err(|error| format!("failed to clear compiler artifacts: {error}"))?;
    if let EngineInput::Generated { path, content } = &spec.input {
        std::fs::write(path, content)
            .map_err(|e| format!("failed to write engine entry {}: {e}", path.display()))?;
    }
    let compile_start = std::time::Instant::now();
    let (stdout_buf, exit_code) = match &spec.executable {
        EngineExecutable::BundledSidecar(name) => {
            run_bundled(
                request.app,
                name,
                &spec.args,
                &spec.working_dir,
                request.log_event,
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
            )
            .await?
        }
    };

    let log = spec
        .artifacts
        .log
        .as_ref()
        .and_then(|path| read_log_bounded(path).ok())
        .unwrap_or(stdout_buf);
    let pdf_path = spec.artifacts.pdf.clone();
    let has_pdf = if capabilities.produces_pdf {
        tokio::task::spawn_blocking(move || {
            pdf_path
                .as_ref()
                .is_some_and(|path| artifact_is_fresh(path, &retained_stale))
        })
        .await
        .map_err(|error| format!("failed to verify compiler output: {error}"))?
    } else {
        false
    };
    Ok(CompileResult {
        ok: has_pdf && exit_code.unwrap_or(-1) == 0,
        has_pdf,
        errors: request.engine.parse_errors(&log),
        log,
        synctex_path: capabilities
            .supports_synctex
            .then_some(spec.artifacts.synctex)
            .flatten()
            .filter(|path| path.exists())
            .map(|path| path.to_string_lossy().into_owned()),
        out_dir: Some(spec.artifacts.output_dir.to_string_lossy().into_owned()),
        compile_time_ms: compile_start.elapsed().as_millis() as u64,
    })
}

const COMPILE_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(300);
const MAX_LOG_BYTES: usize = 1024 * 1024;
const MAX_EMITTED_LOG_BYTES: usize = 256 * 1024;
const LOG_TRUNCATED: &str = "\n[OpenLeaf: compiler output truncated]\n";

fn append_bounded(output: &mut String, bytes: &[u8]) {
    if output.len() >= MAX_LOG_BYTES {
        return;
    }
    let remaining = MAX_LOG_BYTES - output.len();
    let text = String::from_utf8_lossy(bytes);
    let take = (0..=remaining.min(text.len()))
        .rev()
        .find(|index| text.is_char_boundary(*index))
        .unwrap_or(0);
    output.push_str(&text[..take]);
    if text.len() > take && !output.ends_with(LOG_TRUNCATED) {
        let keep = MAX_LOG_BYTES.saturating_sub(LOG_TRUNCATED.len());
        let boundary = (0..=keep)
            .rev()
            .find(|index| output.is_char_boundary(*index))
            .unwrap_or(0);
        output.truncate(boundary);
        output.push_str(LOG_TRUNCATED);
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
) -> Result<(String, Option<i32>), String> {
    let path = resolve_bundled_sidecar(name)?;
    run_supervised_process(
        &path,
        args,
        working_dir,
        Some((app.clone(), log_event.to_owned())),
        COMPILE_TIMEOUT,
    )
    .await
}

fn resolve_bundled_sidecar(name: &str) -> Result<PathBuf, String> {
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
    let mut chunk = [0_u8; 8192];
    loop {
        match reader.read(&mut chunk).await {
            Ok(0) | Err(_) => break,
            Ok(read) => {
                if let Some(app) = &app {
                    let emit_len = claim_emit_budget(&emitted, read);
                    if emit_len > 0 {
                        let text = String::from_utf8_lossy(&chunk[..emit_len]);
                        let _ = app.emit(&log_event, text.as_ref());
                    }
                }
                append_bounded(&mut collected, &chunk[..read]);
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
) -> Result<(String, Option<i32>), String> {
    run_supervised_process(
        path,
        args,
        working_dir,
        Some((app.clone(), log_event.to_owned())),
        COMPILE_TIMEOUT,
    )
    .await
}

pub async fn run_supervised_external(
    path: &Path,
    args: &[String],
    working_dir: &Path,
) -> Result<(String, Option<i32>), String> {
    run_supervised_process(path, args, working_dir, None, COMPILE_TIMEOUT).await
}

async fn run_supervised_process(
    path: &Path,
    args: &[String],
    working_dir: &Path,
    emitter: Option<(tauri::AppHandle, String)>,
    timeout: std::time::Duration,
) -> Result<(String, Option<i32>), String> {
    use std::process::Stdio;
    let mut command = tokio::process::Command::new(path);
    command
        .no_console()
        .args(args)
        .current_dir(working_dir)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    isolate_process_tree(&mut command);
    let mut child = command
        .spawn()
        .map_err(|e| format!("failed to spawn {}: {e}", path.display()))?;
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
        Ok(status) => status
            .map_err(|e| format!("failed waiting for {}: {e}", path.display()))?
            .code(),
        Err(_) => {
            if let Some(pid) = child.id() {
                terminate_process_tree(pid).await;
            }
            let _ = child.kill().await;
            let _ = child.wait().await;
            let mut log = out.await.unwrap_or_default();
            append_bounded(&mut log, err.await.unwrap_or_default().as_bytes());
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
            return Ok((log, Some(-1)));
        }
    };
    let mut log = out.await.unwrap_or_default();
    append_bounded(&mut log, err.await.unwrap_or_default().as_bytes());
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

fn tectonic_args(out_dir: &str, search_path: &str, entry: &str, offline: bool) -> Vec<String> {
    let mut args = vec![
        "-X".into(),
        "compile".into(),
        "--synctex".into(),
        "--keep-logs".into(),
        "--print".into(),
        "--outdir".into(),
        out_dir.into(),
        "-Z".into(),
        search_path.into(),
        entry.into(),
    ];
    if offline {
        args.insert(2, "--only-cached".into());
    }
    args
}

fn typst_args(input: &Path, output: &Path, project_dir: &Path) -> Vec<String> {
    vec![
        "--color".into(),
        "never".into(),
        "compile".into(),
        input.to_string_lossy().into_owned(),
        output.to_string_lossy().into_owned(),
        "--root".into(),
        project_dir.to_string_lossy().into_owned(),
        "--diagnostic-format".into(),
        "short".into(),
    ]
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
        });
    }
    diagnostics
}

fn parse_tex_log_errors(log: &str) -> Vec<CompileError> {
    let mut out = Vec::new();
    let lines: Vec<&str> = log.lines().collect();
    let mut i = 0;
    while i < lines.len() {
        if let Some(message) = lines[i].strip_prefix("! ") {
            let mut line_no = None;
            for following in lines
                .iter()
                .skip(i + 1)
                .take(4.min(lines.len().saturating_sub(i + 1)))
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
                file: None,
                message: message.to_owned(),
                kind: "error".to_owned(),
            });
        }
        i += 1;
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
        let root = std::env::temp_dir().join(format!(
            "openleaf-process-tree-{}-{}",
            std::process::id(),
            rand::random::<u64>()
        ));
        std::fs::create_dir_all(&root).unwrap();
        let marker = root.join("grandchild-survived");
        let script = format!("(sleep 0.35; touch '{}') & wait", marker.display());
        let (log, code) = run_supervised_process(
            Path::new("/bin/sh"),
            &["-c".into(), script],
            &root,
            None,
            std::time::Duration::from_millis(75),
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

    #[cfg(windows)]
    #[tokio::test]
    async fn timeout_terminates_windows_grandchild_tree() {
        let root = std::env::temp_dir().join(format!(
            "openleaf-process-tree-{}-{}",
            std::process::id(),
            rand::random::<u64>()
        ));
        std::fs::create_dir_all(&root).unwrap();
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
                true,
            )
            .unwrap();
        assert_eq!(
            spec.executable,
            EngineExecutable::BundledSidecar("tectonic")
        );
        assert_eq!(
            spec.input,
            EngineInput::Generated {
                path: PathBuf::from("/build/_openleaf_entry.tex"),
                content: "\\ifdefined\\pdfglyphtounicode\\else\\def\\pdfglyphtounicode#1#2{}\\fi\n\\ifdefined\\pdfgentounicode\\else\\newcount\\pdfgentounicode\\fi\n\\input{\\detokenize{main.tex}}\n".into(),
            }
        );
        assert_eq!(
            spec.artifacts.pdf,
            Some(PathBuf::from("/build/_openleaf_entry.pdf"))
        );
        assert_eq!(
            spec.artifacts.log,
            Some(PathBuf::from("/build/_openleaf_entry.log"))
        );
        assert_eq!(
            spec.args,
            [
                "-X",
                "compile",
                "--only-cached",
                "--synctex",
                "--keep-logs",
                "--print",
                "--outdir",
                "/build",
                "-Z",
                "search-path=/project",
                "/build/_openleaf_entry.tex"
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
                false,
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
                false,
            )
            .unwrap();
        assert!(!spec.args.iter().any(|arg| arg == "--only-cached"));
        assert_eq!(&spec.args[..2], ["-X", "compile"]);
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
        let dir = std::env::temp_dir().join(format!("openleaf-artifact-test-{unique}"));
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
    fn retained_stale_artifact_is_not_accepted_until_contents_change() {
        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = std::env::temp_dir().join(format!("openleaf-retained-test-{unique}.pdf"));
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
                false,
            )
            .unwrap();
        assert_eq!(spec.executable, EngineExecutable::BundledSidecar("typst"));
        assert_eq!(
            spec.input,
            EngineInput::Direct(PathBuf::from("/project/chapters/main.typ"))
        );
        assert_eq!(
            spec.artifacts.pdf,
            Some(PathBuf::from("/build/_openleaf_entry.pdf"))
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
                "/project/chapters/main.typ",
                "/build/_openleaf_entry.pdf",
                "--root",
                "/project",
                "--diagnostic-format",
                "short",
            ]
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
            Some(PathBuf::from("/build/_openleaf_entry.pdf"))
        );
        assert_eq!(spec.artifacts.log, None);
        assert_eq!(
            spec.args,
            [
                "--from=markdown",
                "--standalone",
                "--resource-path=/project",
                "--pdf-engine=/app/tectonic",
                "--output=/build/_openleaf_entry.pdf",
                "--",
                "/project/chapters/main.md",
            ]
        );
    }

    #[test]
    fn markdown_compile_enables_citeproc_for_safe_project_bibliography() {
        let dir = std::env::temp_dir().join(format!("openleaf-md-cites-{}", std::process::id()));
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
        let _ = std::fs::remove_dir_all(dir);
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
                "/Applications/OpenLeaf.app/Contents/MacOS/openleaf",
            )),
            Path::new("/src/src-tauri"),
            "tectonic",
        );
        assert_eq!(
            candidates[0],
            PathBuf::from("/Applications/OpenLeaf.app/Contents/MacOS/tectonic")
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
}
